"""Persist Sewio RTLS zone events and link operators to open part sessions."""

from __future__ import annotations

import sqlite3
import sys
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Callable, Optional

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from config import (
    DB_PATH,
    ENABLE_LIVE_INGESTION,
    RTLS_OPERATOR_CONFIRM_SECS,
    RTLS_TEST_FEED_ID,
    SEWIO_FEED_ID,
    SEWIO_LIVE_OFFSET_HOURS,
    STATUS_OPEN,
    STATION_NAME,
)
from database.migrate import run_migrations
from rtls_lookup import operator_name, operator_names, station_for_zone, zone_label

_on_change: Optional[Callable[[str], None]] = None
_lock = threading.Lock()
_sweeper_thread: Optional[threading.Thread] = None
_sweeper_stop = threading.Event()

_live_state = {
    "connected": False,
    "last_message_at": None,
    "positions": {},
    "zone_presence": {},
}

STALE_POSITION_SECS = 90


def _test_feed_ids() -> set[int]:
    ids: set[int] = set()
    for raw in (RTLS_TEST_FEED_ID, SEWIO_FEED_ID):
        if raw and str(raw).isdigit():
            ids.add(int(raw))
    for tid, name in operator_names().items():
        if "TEST" in name.upper() and str(tid).isdigit():
            ids.add(int(tid))
    return ids


def _position_at_ts(at: str | None) -> float:
    if not at:
        return 0.0
    raw = at.strip()
    for fmt in (
        "%Y-%m-%d %H:%M:%S.%f",
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%dT%H:%M:%S.%fZ",
        "%Y-%m-%dT%H:%M:%SZ",
    ):
        try:
            return datetime.strptime(raw, fmt).timestamp()
        except ValueError:
            continue
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return 0.0


def _accept_position(tag_id: int, at: str | None) -> bool:
    """Drop stale bulk snapshots; keep only the newest update per tag."""
    new_ts = _position_at_ts(at)
    is_test = tag_id in _test_feed_ids()

    if not is_test and new_ts > 0:
        age = time.time() - new_ts
        if age > STALE_POSITION_SECS:
            return False

    with _lock:
        prev = _live_state["positions"].get(tag_id)
    if prev and new_ts > 0:
        prev_ts = _position_at_ts(prev.get("at"))
        if new_ts < prev_ts:
            return False

    return True


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


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _parse_iso(ts: str | None) -> datetime | None:
    if not ts:
        return None
    raw = ts.strip().replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(raw)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except ValueError:
        return None


def _parse_sewio_ts(at: str | None) -> str:
    if not at:
        return _now_iso()
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
        (operator_id, zone_id, station_name, zone_label(zone_id), status, updated_at),
    )


def _confirm_assignment(
    conn: sqlite3.Connection,
    session_id: int,
    operator_id: int,
    confirmed_at: str,
    station_id: int | None = None,
) -> bool:
    """Record confirmed work — one row per operator per session."""
    exists = conn.execute(
        "SELECT 1 FROM part_operator_assignments "
        "WHERE session_id = ? AND operator_id = ?",
        (session_id, operator_id),
    ).fetchone()
    if exists:
        return False

    zone_id = None
    zone_name = None
    station_name = None
    if station_id:
        st = conn.execute(
            "SELECT station_name FROM stations WHERE station_id = ?",
            (station_id,),
        ).fetchone()
        station_name = st["station_name"] if st else None

    ocz = conn.execute(
        """SELECT zone_id, zone_name, station_name FROM operator_current_zone
           WHERE operator_id = ? AND status = 'in'""",
        (operator_id,),
    ).fetchone()
    if ocz and (not station_name or ocz["station_name"] == station_name):
        zone_id = ocz["zone_id"]
        zone_name = ocz["zone_name"]
        station_name = ocz["station_name"] or station_name

    conn.execute(
        """INSERT INTO part_operator_assignments
           (session_id, operator_id, assignment_method, confidence_score,
            assigned_at, zone_id, zone_name, station_name)
           VALUES (?, ?, 'rtls_dwell', 1.0, ?, ?, ?, ?)""",
        (session_id, operator_id, confirmed_at, zone_id, zone_name, station_name),
    )
    return True


def _start_presence(
    conn: sqlite3.Connection,
    session_id: int,
    operator_id: int,
    station_id: int,
    entered_at: str,
) -> bool:
    """Begin tracking operator at a session (live until confirmed or left)."""
    active = conn.execute(
        """SELECT presence_id FROM session_operator_presence
           WHERE session_id = ? AND operator_id = ? AND left_at IS NULL""",
        (session_id, operator_id),
    ).fetchone()
    if active:
        return False
    # Use server wall clock for dwell timer (avoids Sewio/reader clock skew)
    timer_start = _now_iso()
    conn.execute(
        """INSERT INTO session_operator_presence
           (session_id, operator_id, station_id, entered_at)
           VALUES (?, ?, ?, ?)""",
        (session_id, operator_id, station_id, timer_start),
    )
    return True


def _open_sessions_at_station(conn: sqlite3.Connection, station_id: int) -> list[sqlite3.Row]:
    return conn.execute(
        """SELECT session_id, entry_time FROM part_station_sessions
           WHERE station_id = ? AND session_status = ?""",
        (station_id, STATUS_OPEN),
    ).fetchall()


def _operators_in_station_zone(conn: sqlite3.Connection, station_id: int) -> list[sqlite3.Row]:
    return conn.execute(
        """SELECT ocz.operator_id, ocz.updated_at AS zone_entered_at
           FROM operator_current_zone ocz
           JOIN stations s ON s.station_id = ?
           WHERE ocz.status = 'in' AND ocz.station_name = s.station_name""",
        (station_id,),
    ).fetchall()


def _link_operator_to_open_sessions(
    conn: sqlite3.Connection,
    operator_id: int,
    station_id: int,
    entered_at: str,
) -> int:
    """Start presence tracking for all open sessions when operator enters station zone."""
    started = 0
    for row in _open_sessions_at_station(conn, station_id):
        if _start_presence(conn, int(row["session_id"]), operator_id, station_id, entered_at):
            started += 1
    return started


def _end_presence_at_station(
    conn: sqlite3.Connection,
    operator_id: int,
    station_id: int,
    left_at: str,
) -> int:
    """Mark operator as left for all active presences at this station."""
    cur = conn.execute(
        """UPDATE session_operator_presence
           SET left_at = ?
           WHERE operator_id = ? AND station_id = ? AND left_at IS NULL""",
        (left_at, operator_id, station_id),
    )
    return cur.rowcount


def _confirm_ready_presences(conn: sqlite3.Connection) -> int:
    """Promote presences that met the dwell threshold to confirmed assignments."""
    now = datetime.now(timezone.utc)
    threshold = timedelta(seconds=RTLS_OPERATOR_CONFIRM_SECS)
    rows = conn.execute(
        """SELECT sop.presence_id, sop.session_id, sop.operator_id,
                  sop.station_id, sop.entered_at
           FROM session_operator_presence sop
           WHERE sop.left_at IS NULL AND sop.confirmed_at IS NULL"""
    ).fetchall()

    confirmed = 0
    for row in rows:
        entered = _parse_iso(row["entered_at"])
        if not entered or now - entered < threshold:
            continue
        confirmed_at = _now_iso()
        if _confirm_assignment(
            conn,
            row["session_id"],
            row["operator_id"],
            confirmed_at,
            int(row["station_id"]),
        ):
            confirmed += 1
        conn.execute(
            "UPDATE session_operator_presence SET confirmed_at = ? WHERE presence_id = ?",
            (confirmed_at, row["presence_id"]),
        )
    return confirmed


def _sweeper_loop() -> None:
    while not _sweeper_stop.wait(1.0):
        try:
            conn = _conn()
            try:
                n = _confirm_ready_presences(conn)
                conn.commit()
                if n:
                    _notify("rtls_assignment")
            finally:
                conn.close()
        except Exception:
            pass


def start_presence_sweeper() -> None:
    global _sweeper_thread
    if _sweeper_thread and _sweeper_thread.is_alive():
        return
    _sweeper_stop.clear()
    _sweeper_thread = threading.Thread(
        target=_sweeper_loop, daemon=True, name="rtls-presence-sweeper"
    )
    _sweeper_thread.start()


def try_assign_on_session_open(session_id: int, station_id: int) -> bool:
    """When a part enters, link any operators already in the station zone."""
    conn = _conn()
    try:
        entry_row = conn.execute(
            "SELECT entry_time FROM part_station_sessions WHERE session_id = ?",
            (session_id,),
        ).fetchone()
        entry_at = entry_row["entry_time"] if entry_row else _now_iso()
        started = 0
        for op in _operators_in_station_zone(conn, station_id):
            if _start_presence(
                conn, session_id, int(op["operator_id"]), station_id, entry_at
            ):
                started += 1
        conn.commit()
        if started:
            _notify("rtls_presence")
        return started > 0
    finally:
        conn.close()


def bootstrap_current_zones_from_rest() -> int:
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
            at = str(tag.get("at") or _now_iso())
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
            if station_name:
                st_id = _station_id(conn, station_name)
                if st_id:
                    _link_operator_to_open_sessions(conn, op_id, st_id, detected_at)
        conn.commit()
    finally:
        conn.close()
    return count


def bootstrap_positions_from_rest() -> int:
    """Load current tag positions from Sewio REST (WebSocket only sends changes)."""
    import httpx
    from config import SEWIO_API_KEY, SEWIO_REST_URL, SEWIO_VERIFY_SSL
    from sewio_client import parse_feed_tag

    if not SEWIO_API_KEY:
        return 0

    try:
        resp = httpx.get(
            f"{SEWIO_REST_URL.rstrip('/')}/feeds",
            headers={"X-ApiKey": SEWIO_API_KEY, "Accept": "application/json"},
            verify=SEWIO_VERIFY_SSL,
            timeout=10,
        )
        if resp.status_code != 200:
            return 0
        body = resp.json()
        feeds = body if isinstance(body, list) else body.get("results", [])
    except Exception:
        return 0

    known = {int(k) for k in operator_names() if str(k).isdigit()} | _test_feed_ids()
    if SEWIO_FEED_ID and str(SEWIO_FEED_ID).isdigit():
        known = {int(SEWIO_FEED_ID)}

    loaded = 0
    for feed in feeds:
        pos = parse_feed_tag(feed)
        if not pos or pos["tag_id"] not in known:
            continue
        record_position(**pos)
        loaded += 1

    return loaded


def record_position(tag_id: int, x: float, y: float, at: str | None, **extra) -> None:
    if not _accept_position(tag_id, at):
        return
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
    _notify("rtls_position")


def record_zone_event(
    tag_id: int,
    zone_id: int,
    status: str,
    at: str | None,
    duration: float | None = None,
) -> dict:
    detected_at = _parse_sewio_ts(at)
    station_name = station_for_zone(zone_id)
    summary = {
        "tag_id": tag_id,
        "operator_name": operator_name(tag_id),
        "zone_id": zone_id,
        "zone_name": zone_label(zone_id),
        "status": status,
        "station_name": station_name,
        "presence_started": 0,
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

    conn = _conn()
    try:
        op_id = _operator_id(conn, tag_id)
        st_id = _station_id(conn, station_name) if station_name else None

        if op_id:
            _upsert_current_zone(conn, op_id, zone_id, station_name, status, detected_at)

        if op_id and st_id:
            conn.execute(
                """INSERT INTO operator_station_presence
                   (operator_id, station_id, detected_at, confidence_score)
                   VALUES (?, ?, ?, ?)""",
                (op_id, st_id, detected_at, 1.0),
            )
            if status == "in":
                summary["presence_started"] = _link_operator_to_open_sessions(
                    conn, op_id, st_id, detected_at
                )
            elif status == "out":
                _end_presence_at_station(conn, op_id, st_id, detected_at)

        conn.commit()
    finally:
        conn.close()

    _notify("rtls_zone" if status == "in" else "rtls_presence")
    return summary


def set_connected(connected: bool) -> None:
    with _lock:
        _live_state["connected"] = connected


def get_live_state() -> dict:
    with _lock:
        return {
            "enabled": ENABLE_LIVE_INGESTION,
            "connected": _live_state["connected"],
            "last_message_at": _live_state["last_message_at"],
            "positions": list(_live_state["positions"].values()),
            "zone_presence": list(_live_state["zone_presence"].values()),
            "station_name": STATION_NAME,
            "confirm_seconds": RTLS_OPERATOR_CONFIRM_SECS,
        }


def rest_health(api_key: str, rest_url: str, verify_ssl: bool) -> dict:
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
        tags = [f for f in body.get("results", []) if f.get("type") == "tag"]
        return {"ok": resp.status_code == 200, "status_code": resp.status_code, "tag_count": len(tags)}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}
