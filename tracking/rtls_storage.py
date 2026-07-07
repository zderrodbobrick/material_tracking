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
        st_id = _station_id(conn, station_name)
        if op_id and st_id and status == "in":
            conn.execute(
                """INSERT INTO operator_station_presence
                   (operator_id, station_id, detected_at, confidence_score)
                   VALUES (?, ?, ?, ?)""",
                (op_id, st_id, detected_at, 1.0),
            )

            # Assign operator to open sessions at this station without an assignment yet
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
                conn.execute(
                    """INSERT INTO part_operator_assignments
                       (session_id, operator_id, assignment_method, confidence_score, assigned_at)
                       VALUES (?, ?, 'rtls_zone', 1.0, ?)""",
                    (row["session_id"], op_id, detected_at),
                )
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
