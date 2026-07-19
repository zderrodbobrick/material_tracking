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
    MAX_OPERATORS_PER_PART,
    MAX_OPERATORS_PER_STATION,
    RTLS_OPERATOR_CONFIRM_SECS,
    SEWIO_FEED_ID,
    SEWIO_LIVE_OFFSET_HOURS,
    STATUS_OPEN,
    STATION_NAME,
)
from database.migrate import run_migrations
from rtls_lookup import station_for_zone, zone_label
import rtls_live

_on_change: Optional[Callable[..., None]] = None
_sweeper_thread: Optional[threading.Thread] = None
_sweeper_stop = threading.Event()
_lock = threading.Lock()


def set_change_callback(fn: Callable[..., None]) -> None:
    global _on_change
    _on_change = fn
    rtls_live.set_change_callback(fn)


def _notify(action: str, **extra) -> None:
    if _on_change:
        try:
            _on_change(action, **extra)
        except TypeError:
            try:
                _on_change(action)
            except Exception:
                pass
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


# Zone map / UI names → DB stations.station_name
_STATION_NAME_ALIASES = {
    "Tenoner": ("Tennoner", "Tenoner"),
    "Tennoner": ("Tennoner", "Tenoner"),
    "Pack out": ("Final Packing", "Pack out", "Packing"),
    "Final Packing": ("Final Packing", "Pack out", "Packing"),
}


def _station_name_candidates(station_name: str | None) -> list[str]:
    if not station_name:
        return []
    aliases = _STATION_NAME_ALIASES.get(station_name)
    if aliases:
        return list(aliases)
    return [station_name]


def _station_id(conn: sqlite3.Connection, station_name: str | None) -> int | None:
    for name in _station_name_candidates(station_name):
        row = conn.execute(
            "SELECT station_id FROM stations WHERE station_name = ?",
            (name,),
        ).fetchone()
        if row:
            return int(row["station_id"])
    return None


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


def _active_presence_count(conn: sqlite3.Connection, session_id: int) -> int:
    """Operators currently on this part session (pending or confirmed, not left)."""
    row = conn.execute(
        """SELECT COUNT(*) FROM session_operator_presence
           WHERE session_id = ? AND left_at IS NULL""",
        (session_id,),
    ).fetchone()
    return int(row[0] or 0)


def _stations_match(a: str | None, b: str | None) -> bool:
    if not a or not b:
        return False
    if a == b:
        return True
    return b in _station_name_candidates(a) or a in _station_name_candidates(b)


def _part_operator_slots_available(conn: sqlite3.Connection, session_id: int) -> int:
    if MAX_OPERATORS_PER_PART <= 0:
        return 999
    return max(0, MAX_OPERATORS_PER_PART - _active_presence_count(conn, session_id))


def _session_has_operator(conn: sqlite3.Connection, session_id: int) -> bool:
    """True if this session has a pending or confirmed operator."""
    row = conn.execute(
        """SELECT 1 FROM session_operator_presence
           WHERE session_id = ? AND left_at IS NULL
           LIMIT 1""",
        (session_id,),
    ).fetchone()
    if row:
        return True
    row = conn.execute(
        "SELECT 1 FROM part_operator_assignments WHERE session_id = ? LIMIT 1",
        (session_id,),
    ).fetchone()
    return row is not None


def _active_operators_at_station(conn: sqlite3.Connection, station_id: int) -> set[int]:
    """Operators currently working at this station (presence on open sessions or in zone)."""
    active: set[int] = set()
    for r in conn.execute(
        """SELECT DISTINCT sop.operator_id
           FROM session_operator_presence sop
           JOIN part_station_sessions s ON s.session_id = sop.session_id
           WHERE s.station_id = ? AND s.session_status = ?
             AND sop.left_at IS NULL""",
        (station_id, STATUS_OPEN),
    ):
        active.add(int(r["operator_id"]))

    st = conn.execute(
        "SELECT station_name FROM stations WHERE station_id = ?",
        (station_id,),
    ).fetchone()
    if not st:
        return active
    names = _station_name_candidates(st["station_name"])
    placeholders = ",".join("?" * len(names))
    for r in conn.execute(
        f"""SELECT operator_id, station_name FROM operator_current_zone
            WHERE status = 'in' AND station_name IN ({placeholders})""",
        names,
    ):
        if _stations_match(st["station_name"], r["station_name"]):
            active.add(int(r["operator_id"]))
    return active


def _can_operator_work_at_station(
    conn: sqlite3.Connection,
    operator_id: int,
    station_id: int,
) -> bool:
    """Enforce MAX_OPERATORS_PER_STATION — only one operator per machine at a time."""
    if MAX_OPERATORS_PER_STATION <= 0:
        return True
    active = _active_operators_at_station(conn, station_id)
    if not active:
        return True
    if operator_id in active and len(active) <= MAX_OPERATORS_PER_STATION:
        return True
    return len(active) < MAX_OPERATORS_PER_STATION


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
    aliases = set(_station_name_candidates(station_name))
    if ocz and (
        not station_name
        or ocz["station_name"] in aliases
        or station_name in set(_station_name_candidates(ocz["station_name"]))
    ):
        zone_id = ocz["zone_id"]
        zone_name = ocz["zone_name"]
        station_name = station_name or ocz["station_name"]

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
    if not _can_operator_work_at_station(conn, operator_id, station_id):
        return False
    if _part_operator_slots_available(conn, session_id) <= 0:
        return False
    active = conn.execute(
        """SELECT presence_id FROM session_operator_presence
           WHERE session_id = ? AND operator_id = ? AND left_at IS NULL""",
        (session_id, operator_id),
    ).fetchone()
    if active:
        return False
    timer_start = _now_iso()
    try:
        # UNIQUE(session_id, operator_id) WHERE left_at IS NULL — race-safe vs sweeper
        conn.execute(
            """INSERT INTO session_operator_presence
               (session_id, operator_id, station_id, entered_at)
               VALUES (?, ?, ?, ?)""",
            (session_id, operator_id, station_id, timer_start),
        )
    except sqlite3.IntegrityError:
        return False
    return True


def _open_sessions_at_station(conn: sqlite3.Connection, station_id: int) -> list[sqlite3.Row]:
    return conn.execute(
        """SELECT session_id, entry_time FROM part_station_sessions
           WHERE station_id = ? AND session_status = ?""",
        (station_id, STATUS_OPEN),
    ).fetchall()


def _operators_in_station_zone(conn: sqlite3.Connection, station_id: int) -> list[sqlite3.Row]:
    st = conn.execute(
        "SELECT station_name FROM stations WHERE station_id = ?",
        (station_id,),
    ).fetchone()
    if not st:
        return []
    names = _station_name_candidates(st["station_name"])
    placeholders = ",".join("?" * len(names))
    return conn.execute(
        f"""SELECT ocz.operator_id, ocz.updated_at AS zone_entered_at
            FROM operator_current_zone ocz
            WHERE ocz.status = 'in' AND ocz.station_name IN ({placeholders})""",
        names,
    ).fetchall()


def _link_operator_to_open_sessions(
    conn: sqlite3.Connection,
    operator_id: int,
    station_id: int,
    entered_at: str,
) -> int:
    """Start presence for open sessions at this station when operator enters zone."""
    if not _can_operator_work_at_station(conn, operator_id, station_id):
        return 0
    started = 0
    for row in _open_sessions_at_station(conn, station_id):
        session_id = int(row["session_id"])
        if _session_has_operator(conn, session_id):
            continue
        if _part_operator_slots_available(conn, session_id) <= 0:
            continue
        if _start_presence(conn, session_id, operator_id, station_id, entered_at):
            started += 1
    return started


def _relink_unassigned_open_sessions(conn: sqlite3.Connection) -> int:
    """Retry linking zone operators to open parts missing operator coverage."""
    started = 0
    for row in conn.execute(
        """SELECT s.session_id, s.station_id
           FROM part_station_sessions s
           WHERE s.session_status = ?""",
        (STATUS_OPEN,),
    ):
        session_id = int(row["session_id"])
        station_id = int(row["station_id"])
        if _session_has_operator(conn, session_id):
            continue
        zone_ops = list(_operators_in_station_zone(conn, station_id))
        zone_ops.sort(key=lambda r: r["zone_entered_at"] or "")
        for op in zone_ops:
            op_id = int(op["operator_id"])
            if not _can_operator_work_at_station(conn, op_id, station_id):
                continue
            if _start_presence(conn, session_id, op_id, station_id, op["zone_entered_at"] or _now_iso()):
                started += 1
                break
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
                relinked = _relink_unassigned_open_sessions(conn)
                n = _confirm_ready_presences(conn)
                conn.commit()
                if relinked or n:
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
    """When a part enters, link the operator already in the station zone (one per station)."""
    conn = _conn()
    try:
        entry_row = conn.execute(
            "SELECT entry_time FROM part_station_sessions WHERE session_id = ?",
            (session_id,),
        ).fetchone()
        entry_at = entry_row["entry_time"] if entry_row else _now_iso()
        started = 0
        zone_ops = list(_operators_in_station_zone(conn, station_id))
        zone_ops.sort(key=lambda r: r["zone_entered_at"] or "")
        for op in zone_ops:
            op_id = int(op["operator_id"])
            if not _can_operator_work_at_station(conn, op_id, station_id):
                continue
            if _start_presence(conn, session_id, op_id, station_id, entry_at):
                started += 1
                break
        conn.commit()
        if started:
            _notify("rtls_presence")
        return started > 0
    finally:
        conn.close()


def finalize_session_operators(session_id: int) -> None:
    """Confirm operator work when a part session closes (even if confirm timer not met)."""
    conn = _conn()
    try:
        rows = conn.execute(
            """SELECT presence_id, operator_id, station_id
               FROM session_operator_presence
               WHERE session_id = ? AND left_at IS NULL""",
            (session_id,),
        ).fetchall()
        if not rows:
            return
        closed_at = _now_iso()
        for row in rows:
            confirmed_at = closed_at
            _confirm_assignment(
                conn,
                session_id,
                int(row["operator_id"]),
                confirmed_at,
                int(row["station_id"]) if row["station_id"] else None,
            )
            conn.execute(
                """UPDATE session_operator_presence
                   SET confirmed_at = COALESCE(confirmed_at, ?), left_at = ?
                   WHERE presence_id = ?""",
                (confirmed_at, closed_at, row["presence_id"]),
            )
        conn.commit()
        _notify("rtls_assignment")
    finally:
        conn.close()


def bootstrap_current_zones_from_rest() -> int:
    """Refresh in-memory zone state from Sewio REST (same as rtls_viewer)."""
    loaded = rtls_live.bootstrap_zones_from_rest()
    if not loaded:
        return 0

    snapshot = rtls_live.get_snapshot()
    conn = _conn()
    count = 0
    try:
        for z in snapshot["zone_presence"]:
            tid = int(z["tag_id"])
            zid = int(z["zone_id"])
            station_name = z.get("station_name") or station_for_zone(zid)
            zname = z.get("zone_name") or zone_label(zid)
            detected_at = _parse_sewio_ts(z.get("at"))
            op_id = _operator_id(conn, tid)
            if not op_id:
                continue
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
    return loaded


def sync_zone_presence_from_db() -> int:
    """Reload API in-memory zone chips from operator_current_zone after external writers (sim)."""
    conn = _conn()
    try:
        rows = conn.execute(
            """SELECT o.rtls_badge_id, o.operator_name, ocz.zone_id, ocz.station_name,
                      ocz.zone_name, ocz.updated_at
               FROM operator_current_zone ocz
               JOIN operators o ON o.operator_id = ocz.operator_id
               WHERE ocz.status = 'in' AND o.is_active = 1
                 AND o.rtls_badge_id IS NOT NULL AND o.rtls_badge_id != ''"""
        ).fetchall()
    finally:
        conn.close()

    entries = []
    for r in rows:
        try:
            tag_id = int(r["rtls_badge_id"])
        except (TypeError, ValueError):
            continue
        entries.append({
            "tag_id": tag_id,
            "zone_id": int(r["zone_id"]),
            "station_name": r["station_name"],
            "zone_name": r["zone_name"] or zone_label(int(r["zone_id"])),
            "operator_name": r["operator_name"],
            "at": r["updated_at"],
        })
    return rtls_live.hydrate_zone_presence(entries)


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

    known = rtls_live.known_tag_ids()
    if SEWIO_FEED_ID and str(SEWIO_FEED_ID).isdigit():
        known = {int(SEWIO_FEED_ID)}

    loaded = 0
    for feed in feeds:
        pos = parse_feed_tag(feed)
        if not pos or pos["tag_id"] not in known:
            continue
        if rtls_live.record_position(**pos):
            loaded += 1

    return loaded


def record_position(tag_id: int, x: float, y: float, at: str | None, **extra) -> None:
    rtls_live.record_position(tag_id, x, y, at, **extra)


def _close_open_zone_visit(
    conn: sqlite3.Connection,
    operator_id: int,
    exited_at: str,
) -> int | None:
    """Close the operator's open zone visit and return dwell seconds."""
    row = conn.execute(
        """SELECT visit_id, entered_at FROM operator_zone_visits
           WHERE operator_id = ? AND exited_at IS NULL
           ORDER BY entered_at DESC LIMIT 1""",
        (operator_id,),
    ).fetchone()
    if not row:
        return None
    ent = _parse_iso(row["entered_at"])
    ex = _parse_iso(exited_at)
    dwell = None
    if ent and ex and ex >= ent:
        dwell = int((ex - ent).total_seconds())
    conn.execute(
        """UPDATE operator_zone_visits
           SET exited_at = ?, dwell_seconds = ?
           WHERE visit_id = ?""",
        (exited_at, dwell, row["visit_id"]),
    )
    return dwell


def _open_zone_visit(
    conn: sqlite3.Connection,
    operator_id: int,
    tag_id: int,
    zone_id: int,
    station_name: str | None,
    zone_name: str | None,
    entered_at: str,
    source: str = "rtls",
) -> None:
    conn.execute(
        """INSERT INTO operator_zone_visits
           (operator_id, tag_id, zone_id, station_name, zone_name, entered_at, source)
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        (operator_id, tag_id, zone_id, station_name, zone_name, entered_at, source),
    )


def record_zone_event(
    tag_id: int,
    zone_id: int,
    status: str,
    at: str | None,
    duration: float | None = None,
    *,
    source: str = "rtls",
) -> dict:
    detected_at = _parse_sewio_ts(at)
    station_name = station_for_zone(zone_id)
    zone_entry = rtls_live.record_zone_event(
        tag_id, zone_id, status, at=at, duration=duration,
    )
    summary = {
        **zone_entry,
        "presence_started": 0,
    }

    conn = _conn()
    try:
        op_id = _operator_id(conn, tag_id)
        st_id = _station_id(conn, station_name) if station_name else None

        if op_id:
            _upsert_current_zone(conn, op_id, zone_id, station_name, status, detected_at)

            if status == "out":
                _close_open_zone_visit(conn, op_id, detected_at)
            elif status == "in" and zone_id > 0 and station_name:
                _close_open_zone_visit(conn, op_id, detected_at)
                _open_zone_visit(
                    conn, op_id, tag_id, zone_id, station_name,
                    zone_label(zone_id), detected_at, source=source,
                )

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

    return summary


def set_connected(connected: bool) -> None:
    rtls_live.set_connected(connected)


def get_live_state() -> dict:
    snap = rtls_live.get_snapshot()
    return {
        "enabled": ENABLE_LIVE_INGESTION,
        "connected": snap["connected"],
        "last_message_at": snap["last_message_at"],
        "positions": snap["positions"],
        "zone_presence": snap["zone_presence"],
        "station_name": STATION_NAME,
        "confirm_seconds": RTLS_OPERATOR_CONFIRM_SECS,
        "max_operators_per_part": MAX_OPERATORS_PER_PART,
        "max_operators_per_station": MAX_OPERATORS_PER_STATION,
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
