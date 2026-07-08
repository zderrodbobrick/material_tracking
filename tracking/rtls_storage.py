"""Persist Sewio RTLS zone events and link operators to open part sessions."""

from __future__ import annotations

import sqlite3
import sys
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Callable, Optional

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from config import (
    DB_PATH,
    SEWIO_LIVE_OFFSET_HOURS,
    STATUS_OPEN,
    STATION_NAME,
)
from database.migrate import run_migrations
from rtls_lookup import operator_name, station_for_zone, zone_label

_on_change: Optional[Callable[[str], None]] = None
_lock = threading.Lock()

# In-memory live state (thread-safe reads via lock)
_live_state = {
    "connected": False,
    "last_message_at": None,
    "positions": {},      # tag_id -> dict
    "zone_presence": {},  # tag_id -> dict (status in/out)
}


def set_change_callback(fn: Callable[[str], None]) -> None:
    global _on_change
    _on_change = fn


def _notify(action: str) -> None:
    if _on_change:
        try:
            _on_change(action)
        except Exception:
            pass


def _conn() -> sqlite3.Connection:
    conn = sqlite3.connect(str(DB_PATH), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA busy_timeout=5000")
    run_migrations(conn)
    return conn


def _parse_sewio_ts(at: str | None) -> str:
    """Normalize Sewio timestamp to ISO UTC string for SQLite."""
    if not at:
        return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    raw = at.strip()
    for fmt in (
        "%Y-%m-%d %H:%M:%S.%f",
        "%Y-%m-%d %H:%M:%S",
    ):
        try:
            dt = datetime.strptime(raw, fmt).replace(tzinfo=timezone.utc)
            if SEWIO_LIVE_OFFSET_HOURS:
                dt += timedelta(hours=SEWIO_LIVE_OFFSET_HOURS)
            return dt.strftime("%Y-%m-%dT%H:%M:%SZ")
        except ValueError:
            continue
    return raw


def _operator_id(conn: sqlite3.Connection, tag_id: int) -> int | None:
    row = conn.execute(
        "SELECT operator_id FROM operators WHERE rtls_badge_id = ? AND is_active = 1",
        (str(tag_id),),
    ).fetchone()
    return int(row["operator_id"]) if row else None


def _station_id(conn: sqlite3.Connection, station_name: str) -> int | None:
    row = conn.execute(
        "SELECT station_id FROM stations WHERE station_name = ?",
        (station_name,),
    ).fetchone()
    return int(row["station_id"]) if row else None


def _assign_operator_to_session(
    conn: sqlite3.Connection,
    session_id: int,
    operator_id: int,
    method: str,
    assigned_at: str,
) -> bool:
    exists = conn.execute(
        "SELECT 1 FROM part_operator_assignments WHERE session_id = ?",
        (session_id,),
    ).fetchone()
    if exists:
        return False
    conn.execute(
        """INSERT INTO part_operator_assignments
           (session_id, operator_id, assignment_method, confidence_score, assigned_at)
           VALUES (?, ?, ?, 1.0, ?)""",
        (session_id, operator_id, method, assigned_at),
    )
    return True


def _upsert_current_zone(
    conn: sqlite3.Connection,
    operator_id: int,
    zone_id: int,
    station_name: str | None,
    status: str,
    updated_at: str,
) -> None:
    conn.execute(
        """INSERT INTO operator_current_zone
           (operator_id, zone_id, station_name, zone_name, status, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(operator_id) DO UPDATE SET
             zone_id = excluded.zone_id,
             station_name = excluded.station_name,
             zone_name = excluded.zone_name,
             status = excluded.status,
             updated_at = excluded.updated_at""",
        (
            operator_id,
            zone_id,
            station_name,
            zone_label(zone_id),
            status,
            updated_at,
        ),
    )


def find_operator_at_station(conn: sqlite3.Connection, station_id: int) -> int | None:
    row = conn.execute(
        """SELECT ocz.operator_id
           FROM operator_current_zone ocz
           JOIN stations s ON s.station_id = ?
           WHERE ocz.status = 'in'
             AND ocz.station_name = s.station_name
           ORDER BY ocz.updated_at DESC
           LIMIT 1""",
        (station_id,),
    ).fetchone()
    return int(row["operator_id"]) if row else None


def try_assign_on_session_open(session_id: int, station_id: int) -> bool:
    """Link a newly opened part session to the operator currently at that station."""
    conn = _conn()
    try:
        op_id = find_operator_at_station(conn, station_id)
        if not op_id:
            return False
        assigned_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        assigned = _assign_operator_to_session(
            conn, session_id, op_id, "session_open", assigned_at
        )
        conn.commit()
        if assigned:
            _notify("rtls_assignment")
        return assigned
    finally:
        conn.close()


def bootstrap_current_zones_from_rest() -> int:
    """Seed operator_current_zone from Sewio REST (same source as rtls_viewer)."""
    import httpx
    from config import SEWIO_API_KEY, SEWIO_REST_URL, SEWIO_VERIFY_SSL

    if not SEWIO_API_KEY:
        return 0

    try:
        resp = httpx.get(
            f"{SEWIO_REST_URL.rstrip('/')}/zones",
            headers={"X-ApiKey": SEWIO_API_KEY, "Accept": "application/json"},
            verify=SEWIO_VERIFY_SSL,
            timeout=10,
        )
        if resp.status_code != 200:
            return 0
        body = resp.json()
        zones = body if isinstance(body, list) else body.get("results", [])
    except Exception:
        return 0

    latest: dict[int, tuple[str, int, str, str]] = {}
    for zone in zones:
        try:
            zid = int(zone["id"])
        except (TypeError, ValueError, KeyError):
            continue
        station_name = station_for_zone(zid)
        zname = zone.get("name") or zone_label(zid)
        for tag in zone.get("tags") or []:
            if tag.get("status") != "in":
                continue
            try:
                tid = int(tag["id"])
            except (TypeError, ValueError, KeyError):
                continue
            at = str(tag.get("at") or datetime.now(timezone.utc).isoformat())
            op_id = None
            conn_probe = _conn()
            try:
                op_id = _operator_id(conn_probe, tid)
            finally:
                conn_probe.close()
            if not op_id:
                continue
            if op_id not in latest or at > latest[op_id][0]:
                latest[op_id] = (at, zid, station_name, zname)

    if not latest:
        return 0

    conn = _conn()
    count = 0
    try:
        for op_id, (at, zid, station_name, zname) in latest.items():
            detected_at = _parse_sewio_ts(at)
            conn.execute(
                """INSERT INTO operator_current_zone
                   (operator_id, zone_id, station_name, zone_name, status, updated_at)
                   VALUES (?, ?, ?, ?, 'in', ?)
                   ON CONFLICT(operator_id) DO UPDATE SET
                     zone_id = excluded.zone_id,
                     station_name = excluded.station_name,
                     zone_name = excluded.zone_name,
                     status = excluded.status,
                     updated_at = excluded.updated_at""",
                (op_id, zid, station_name, zname, detected_at),
            )
            count += 1
        conn.commit()
    finally:
        conn.close()
    return count


def record_position(tag_id: int, x: float, y: float, at: str | None, **extra) -> None:
    with _lock:
        _live_state["last_message_at"] = datetime.now(timezone.utc).isoformat()
        _live_state["positions"][tag_id] = {
            "tag_id": tag_id,
            "operator_name": operator_name(tag_id),
            "x": x,
            "y": y,
            "at": at,
            **{k: v for k, v in extra.items() if v is not None},
        }


def record_zone_event(
    tag_id: int,
    zone_id: int,
    status: str,
    at: str | None,
    duration: float | None = None,
) -> dict:
    """Handle a Sewio zone in/out event. Returns summary dict for logging."""
    detected_at = _parse_sewio_ts(at)
    station_name = station_for_zone(zone_id)
    summary = {
        "tag_id": tag_id,
        "operator_name": operator_name(tag_id),
        "zone_id": zone_id,
        "zone_name": zone_label(zone_id),
        "status": status,
        "station_name": station_name,
        "assigned_sessions": 0,
    }

    with _lock:
        _live_state["last_message_at"] = datetime.now(timezone.utc).isoformat()
        _live_state["zone_presence"][tag_id] = {
            "tag_id": tag_id,
            "operator_name": operator_name(tag_id),
            "zone_id": zone_id,
            "zone_name": zone_label(zone_id),
            "status": status,
            "at": detected_at,
            "duration": duration,
        }

    if not station_name:
        return summary

    conn = _conn()
    try:
        op_id = _operator_id(conn, tag_id)
        st_id = _station_id(conn, station_name) if station_name else None

        if op_id:
            _upsert_current_zone(
                conn, op_id, zone_id, station_name, status, detected_at
            )

        if op_id and st_id and status == "in":
            conn.execute(
                """INSERT INTO operator_station_presence
                   (operator_id, station_id, detected_at, confidence_score)
                   VALUES (?, ?, ?, ?)""",
                (op_id, st_id, detected_at, 1.0),
            )

            open_rows = conn.execute(
                """SELECT s.session_id
                   FROM part_station_sessions s
                   WHERE s.station_id = ? AND s.session_status = ?
                     AND NOT EXISTS (
                       SELECT 1 FROM part_operator_assignments poa
                       WHERE poa.session_id = s.session_id
                     )""",
                (st_id, STATUS_OPEN),
            ).fetchall()

            for row in open_rows:
                if _assign_operator_to_session(
                    conn, row["session_id"], op_id, "rtls_zone", detected_at
                ):
                    summary["assigned_sessions"] += 1

        conn.commit()
    finally:
        conn.close()

    if summary["assigned_sessions"]:
        _notify("rtls_assignment")
    else:
        _notify("rtls_zone")
    return summary


def set_connected(connected: bool) -> None:
    with _lock:
        _live_state["connected"] = connected


def get_live_state() -> dict:
    with _lock:
        return {
            "connected": _live_state["connected"],
            "last_message_at": _live_state["last_message_at"],
            "positions": list(_live_state["positions"].values()),
            "zone_presence": list(_live_state["zone_presence"].values()),
            "station_name": STATION_NAME,
        }


def rest_health(api_key: str, rest_url: str, verify_ssl: bool) -> dict:
    """Ping Sewio REST /feeds for connectivity check."""
    import httpx

    if not api_key:
        return {"ok": False, "error": "SEWIO_API_KEY not set"}

    try:
        resp = httpx.get(
            f"{rest_url.rstrip('/')}/feeds",
            headers={"X-ApiKey": api_key, "Accept": "application/json"},
            verify=verify_ssl,
            timeout=10,
        )
        body = resp.json() if resp.headers.get("content-type", "").startswith("application/json") else {}
        tags = [
            f for f in body.get("results", [])
            if f.get("type") == "tag"
        ]
        return {
            "ok": resp.status_code == 200,
            "status_code": resp.status_code,
            "tag_count": len(tags),
        }
    except Exception as exc:
        return {"ok": False, "error": str(exc)}
