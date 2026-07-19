"""
REST API for RFID Tracking data (normalized schema).

Serves the React dashboard off the layered POC schema from Database.md:

    rfid_raw_reads  ->  part_station_events  ->  part_station_sessions
                                                      |
                                                vw_live_part_status  ->  dashboard

Live status is always read from sessions / the view, never from raw reads.

Run:    python api.py
Access: http://localhost:5001
"""

import sys
import re
import sqlite3
import threading
import time as _time
from pathlib import Path
from datetime import datetime, timedelta, timezone

from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS
from flask_socketio import SocketIO

sys.path.insert(0, str(Path(__file__).parent))
from config import (
    DB_PATH,
    STATION_NAME, STATION_TYPE, STATION_LOCATION,
    READER_NAME, READER_IP,
    ENTRY_ANTENNA, EXIT_ANTENNA, THIRD_ANTENNA, INSERT_STATION_NAME,
    STATUS_OPEN, STATUS_CLOSED, STATUS_ABANDONED, STATUS_EXIT_ONLY,
    ENABLE_LIVE_INGESTION,
    RTLS_OPERATOR_CONFIRM_SECS,
    SEWIO_API_KEY, SEWIO_REST_URL, SEWIO_VERIFY_SSL,
    PROGRESS_STATIONS,
    HIDDEN_IBUS_ORDERS,
)
from database.migrate import run_migrations
from tracking.station_specs import (
    canonical_station,
    compare_to_target,
    fetch_specs_by_name,
    part_weighted_progress,
    position_progress,
    progress_spine_names,
    spec_row_to_api,
    spine_sort_key,
    upsert_spec,
    estimate_order_pipeline,
)

DASH_DIST = Path(__file__).parent / "dashboard" / "dist"

app = Flask(__name__, static_folder=None)
CORS(app, origins="*")
socketio = SocketIO(app, cors_allowed_origins="*", async_mode="threading")


# ── DB helpers ────────────────────────────────────────────────────────────────

_migrations_applied = False


def get_db() -> sqlite3.Connection:
    """Open a WAL-mode connection, running schema migrations once per process."""
    global _migrations_applied
    conn = sqlite3.connect(str(DB_PATH), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA busy_timeout=5000")
    if not _migrations_applied:
        run_migrations(
            conn,
            station_name=STATION_NAME,
            station_type=STATION_TYPE,
            station_location=STATION_LOCATION,
            reader_name=READER_NAME,
            reader_ip=READER_IP,
            entry_antenna=ENTRY_ANTENNA,
            exit_antenna=EXIT_ANTENNA,
            third_antenna=THIRD_ANTENNA,
            insert_station_name=INSERT_STATION_NAME,
        )
        _migrations_applied = True
    return conn


def _now_utc() -> str:
    return datetime.now(timezone.utc).isoformat()


def _dwell_display(seconds) -> str | None:
    if seconds is None:
        return None
    seconds = int(seconds)
    if seconds < 60:
        return f"{seconds} sec"
    m, s = divmod(seconds, 60)
    if m < 60:
        return f"{m} min {s} sec"
    h, m = divmod(m, 60)
    return f"{h}h {m}m {s}s"


def _variance_display(delta_seconds: int | None) -> str | None:
    if delta_seconds is None:
        return None
    if delta_seconds == 0:
        return "on estimate"
    sign = "+" if delta_seconds > 0 else "−"
    return f"{sign}{_dwell_display(abs(delta_seconds))}"


def _work_order_parts_by_ibus(db: sqlite3.Connection) -> dict[str, int]:
    """IBUS key → expected part count from work_orders / BOM."""
    out: dict[str, int] = {}
    rows = db.execute(
        "SELECT work_order_id, UPPER(ibus_number) AS ibus, parts_count "
        "FROM work_orders WHERE ibus_number IS NOT NULL AND TRIM(ibus_number) != ''"
    ).fetchall()
    for r in rows:
        ibus = (r["ibus"] or "").strip().upper()
        if not ibus:
            continue
        bom = db.execute(
            "SELECT COUNT(*) FROM work_order_components WHERE work_order_id = ?",
            (r["work_order_id"],),
        ).fetchone()[0]
        expected = int(r["parts_count"] or bom or 0)
        if expected > 0:
            out[ibus] = expected
    return out


def _attach_order_time_estimates(
    journey: dict,
    specs_by_name: dict,
    part_actuals: dict[str, float] | None,
    wo_parts_by_ibus: dict[str, int] | None,
) -> None:
    key = (journey.get("key") or journey.get("ibus_order") or "").upper()
    bom_expected = (wo_parts_by_ibus or {}).get(key)
    tracked = journey.get("part_count") or len(journey.get("parts") or [])
    est_parts = bom_expected or tracked or 1

    est = estimate_order_pipeline(
        est_parts,
        specs_by_name,
        part_actuals=part_actuals,
    )
    journey["expected_parts"] = bom_expected
    journey["estimated_parts"] = est_parts
    journey["estimated_transit_seconds"] = est["transit_seconds"]
    journey["estimated_machine_dwell_seconds"] = est["machine_dwell_seconds"]
    journey["estimated_per_part_seconds"] = est["per_part_seconds"]
    journey["estimated_per_part_display"] = _dwell_display(est["per_part_seconds"])
    journey["estimated_total_seconds"] = est["estimated_total_seconds"]
    journey["estimated_total_display"] = (
        _dwell_display(est["estimated_total_seconds"])
        if est["estimated_total_seconds"] is not None
        else None
    )
    journey["station_time_estimates"] = est["station_breakdown"]

    actual = journey.get("total_production_seconds")
    if actual is not None and est.get("estimated_total_seconds"):
        diff = int(actual) - int(est["estimated_total_seconds"])
        journey["actual_vs_estimated_seconds"] = diff
        journey["actual_vs_estimated_display"] = _variance_display(diff)


def _to_epoch_ms(iso_str) -> int | None:
    if not iso_str:
        return None
    try:
        v = iso_str.strip().replace("Z", "+00:00")
        if len(v) >= 5 and (v[-5] in "+-") and v[-3] != ":":
            v = v[:-2] + ":" + v[-2:]
        dt = datetime.fromisoformat(v)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return int(dt.timestamp() * 1000)
    except Exception:
        return None


def _parse_ts(ts: str | None) -> datetime | None:
    if not ts:
        return None
    try:
        v = ts.strip().replace("Z", "+00:00")
        if len(v) >= 5 and v[-5] in "+-" and v[-3] != ":":
            v = v[:-2] + ":" + v[-2:]
        dt = datetime.fromisoformat(v)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        return None


def _session_dict(r: sqlite3.Row) -> dict:
    """Shape a row from vw_live_part_status into a dashboard-friendly dict."""
    dwell = int(r["dwell_seconds"]) if r["dwell_seconds"] is not None else None
    return {
        "id":                 r["session_id"],
        "session_id":         r["session_id"],
        "part_id":            r["part_id"],
        "epc":                r["epc"],
        "part_name":          r["part_name"],
        "part_type":          r["part_type"],
        "part_number":        r["part_number"],
        "ibus_number":        r["ibus_number"],
        "work_order":         r["job_number"],
        "station_name":       r["station_name"],
        "entry_time":         r["entry_time"],
        "entry_epoch_ms":     _to_epoch_ms(r["entry_time"]),
        "exit_time":          r["exit_time"],
        "dwell_seconds":      dwell,
        "dwell_time_display": _dwell_display(dwell),
        "status":             r["session_status"],
        "operator_name":      None,
        "operator_id":        None,
        "operator_zone":      None,
        "assignment_method":  None,
        "rtls_match":         None,
        "operators_present":  [],
        "operators_worked":   [],
    }


def _operator_dict(
    row: sqlite3.Row,
    *,
    live_positions: dict[int, dict],
    entered_at: str | None = None,
    confirmed: bool = False,
    seconds_in_zone: float | None = None,
) -> dict:
    badge = row["rtls_badge_id"]
    op: dict = {
        "operator_id":   row["operator_id"],
        "operator_name": row["operator_name"],
        "zone_name":     row["zone_name"],
        "station_name":  row["station_name"] if "station_name" in row.keys() else None,
        "confirmed":     confirmed,
    }
    if entered_at:
        op["entered_at"] = entered_at
    if seconds_in_zone is not None:
        op["seconds_in_zone"] = round(seconds_in_zone, 1)
        remaining = max(0.0, min(RTLS_OPERATOR_CONFIRM_SECS, RTLS_OPERATOR_CONFIRM_SECS - seconds_in_zone))
        op["seconds_until_confirmed"] = round(remaining, 1)
        op["confirm_seconds"] = RTLS_OPERATOR_CONFIRM_SECS
    if badge and str(badge).isdigit():
        pos = live_positions.get(int(badge))
        if pos:
            op["x"] = pos.get("x")
            op["y"] = pos.get("y")
    if confirmed and row["assigned_at"]:
        op["assigned_at"] = row["assigned_at"]
        op["assignment_method"] = row["assignment_method"]
    return op


def _attach_operators(db: sqlite3.Connection, sessions: list[dict]) -> list[dict]:
    if not sessions:
        return sessions
    ids = [s["session_id"] for s in sessions]
    placeholders = ",".join("?" * len(ids))
    now = datetime.now(timezone.utc)

    worked_rows = db.execute(
        f"""SELECT poa.session_id, poa.assignment_method, poa.assigned_at,
                   o.operator_id, o.operator_name, o.rtls_badge_id,
                   COALESCE(poa.zone_name, ocz.zone_name) AS zone_name,
                   COALESCE(poa.station_name, st.station_name) AS station_name
            FROM part_operator_assignments poa
            JOIN operators o ON poa.operator_id = o.operator_id
            JOIN part_station_sessions s ON poa.session_id = s.session_id
            JOIN stations st ON s.station_id = st.station_id
            LEFT JOIN operator_current_zone ocz
              ON ocz.operator_id = o.operator_id
             AND ocz.station_name = st.station_name
            WHERE poa.session_id IN ({placeholders})
            ORDER BY poa.assigned_at ASC""",
        ids,
    ).fetchall()

    present_rows = db.execute(
        f"""SELECT sop.session_id, sop.entered_at, sop.confirmed_at,
                   o.operator_id, o.operator_name, o.rtls_badge_id,
                   ocz.zone_name, st.station_name, ocz.status AS zone_status
            FROM session_operator_presence sop
            JOIN operators o ON sop.operator_id = o.operator_id
            JOIN stations st ON sop.station_id = st.station_id
            LEFT JOIN operator_current_zone ocz
              ON ocz.operator_id = o.operator_id
             AND ocz.station_name = st.station_name
             AND ocz.status = 'in'
            WHERE sop.session_id IN ({placeholders})
              AND sop.left_at IS NULL
              AND sop.confirmed_at IS NULL
            ORDER BY sop.entered_at ASC""",
        ids,
    ).fetchall()

    # Full RTLS presence history (including left) for completed IBUS drill-down.
    rtls_hist_rows = db.execute(
        f"""SELECT sop.session_id, sop.entered_at, sop.confirmed_at, sop.left_at,
                   o.operator_id, o.operator_name, o.rtls_badge_id,
                   st.station_name,
                   COALESCE(poa.zone_name, ocz.zone_name) AS zone_name,
                   poa.zone_id AS zone_id,
                   poa.assignment_method
            FROM session_operator_presence sop
            JOIN operators o ON sop.operator_id = o.operator_id
            JOIN stations st ON sop.station_id = st.station_id
            LEFT JOIN part_operator_assignments poa
              ON poa.session_id = sop.session_id
             AND poa.operator_id = sop.operator_id
            LEFT JOIN operator_current_zone ocz
              ON ocz.operator_id = o.operator_id
             AND ocz.station_name = st.station_name
            WHERE sop.session_id IN ({placeholders})
            ORDER BY sop.entered_at ASC""",
        ids,
    ).fetchall()

    live_positions: dict[int, dict] = {}
    if ENABLE_LIVE_INGESTION:
        try:
            sys.path.insert(0, str(Path(__file__).parent / "tracking"))
            from rtls_storage import get_live_state
            for p in get_live_state().get("positions", []):
                live_positions[int(p["tag_id"])] = p
        except Exception:
            pass

    worked_by_session: dict[int, list] = {}
    for row in worked_rows:
        worked_by_session.setdefault(row["session_id"], []).append(
            _operator_dict(row, live_positions=live_positions, confirmed=True)
        )

    present_by_session: dict[int, list] = {}
    for row in present_rows:
        entered = _parse_ts(row["entered_at"])
        secs = max(0.0, (now - entered).total_seconds()) if entered else 0.0
        present_by_session.setdefault(row["session_id"], []).append(
            _operator_dict(
                row,
                live_positions=live_positions,
                entered_at=row["entered_at"],
                confirmed=False,
                seconds_in_zone=secs,
            )
        )

    rtls_by_session: dict[int, list] = {}
    for row in rtls_hist_rows:
        badge = row["rtls_badge_id"]
        rtls_by_session.setdefault(row["session_id"], []).append({
            "operator_id": row["operator_id"],
            "operator_name": row["operator_name"],
            "rtls_badge_id": badge,
            "station_name": row["station_name"],
            "zone_name": row["zone_name"],
            "zone_id": row["zone_id"],
            "entered_at": row["entered_at"],
            "left_at": row["left_at"],
            "confirmed_at": row["confirmed_at"],
            "assignment_method": row["assignment_method"],
            "confirmed": bool(row["confirmed_at"]),
        })

    zone_rows = db.execute(
        """SELECT o.operator_id, o.operator_name, o.rtls_badge_id,
                  ocz.zone_name, ocz.station_name, ocz.updated_at
           FROM operator_current_zone ocz
           JOIN operators o ON o.operator_id = ocz.operator_id
           WHERE ocz.status = 'in' AND o.is_active = 1
           ORDER BY ocz.updated_at ASC"""
    ).fetchall()

    for s in sessions:
        sid = s["session_id"]
        worked = worked_by_session.get(sid, [])
        present = present_by_session.get(sid, [])
        s["operators_worked"] = worked
        s["operators_present"] = present
        s["operators_rtls"] = rtls_by_session.get(sid, [])

        if worked:
            primary = worked[-1]
            s["operator_name"] = primary["operator_name"]
            s["operator_id"] = primary["operator_id"]
            s["operator_zone"] = primary.get("zone_name")
            s["assignment_method"] = primary.get("assignment_method")
            s["rtls_match"] = True
            s["has_operator"] = True
            if primary.get("x") is not None:
                s["operator_x"] = primary["x"]
                s["operator_y"] = primary["y"]
        elif present:
            primary = present[0]
            s["operator_name"] = primary["operator_name"]
            s["operator_id"] = primary["operator_id"]
            s["operator_zone"] = primary.get("zone_name")
            s["rtls_match"] = None  # pending, not confirmed
            s["has_operator"] = True
            if primary.get("x") is not None:
                s["operator_x"] = primary["x"]
                s["operator_y"] = primary["y"]
        elif s.get("status") == STATUS_OPEN:
            st_name = s.get("station_name")
            zone_op = None
            for zrow in zone_rows:
                zst = zrow["station_name"]
                if st_name and zst and (
                    st_name == zst
                    or (canonical_station(st_name) or st_name) == (canonical_station(zst) or zst)
                ):
                    zone_op = zrow
                    break
            if zone_op:
                entered = zone_op["updated_at"]
                entered_dt = _parse_ts(entered)
                secs = max(0.0, (now - entered_dt).total_seconds()) if entered_dt else 0.0
                fallback = _operator_dict(
                    zone_op,
                    live_positions=live_positions,
                    entered_at=entered,
                    confirmed=False,
                    seconds_in_zone=secs,
                )
                s["operators_present"] = [fallback]
                s["operator_name"] = fallback["operator_name"]
                s["operator_id"] = fallback["operator_id"]
                s["operator_zone"] = fallback.get("zone_name")
                s["rtls_match"] = None
                s["has_operator"] = True
            else:
                s["rtls_match"] = False
                s["has_operator"] = False
        else:
            s["has_operator"] = bool(worked or present)
    return sessions


# ── Static / root ─────────────────────────────────────────────────────────────

@app.route("/")
def index():
    accept = request.headers.get("Accept", "")
    if DASH_DIST.exists() and "text/html" in accept:
        return send_from_directory(str(DASH_DIST), "index.html")
    return jsonify({
        "service": "RFID Tracking API",
        "RFID": True,
        "schema": "normalized (Database.md)",
        "endpoints": [
            "GET  /api/live",
            "GET  /api/completed",
            "GET  /api/ibus",
            "GET  /api/raw-reads/recent",
            "GET  /api/summary",
            "GET  /api/analytics",
            "GET  /api/analytics/operators",
            "GET  /api/analytics/operators/trends",
            "GET  /api/analytics/operators/trends/sessions",
            "GET  /api/report/stations",
            "GET  /api/report/sessions",
            "GET  /api/stations",
            "GET  /api/readers",
            "GET  /api/antennas",
            "GET  /api/parts",
            "GET  /api/tags",
            "GET  /api/operators",
            "GET  /api/operators/<id>/presence",
            "GET  /api/sessions/<id>/operators",
            "GET  /api/rtls/health",
            "GET  /api/rtls/live",
            "POST /api/rtls/demo",
            "DELETE /api/rtls/demo",
            "GET  /api/machine-shapes",
            "PUT  /api/machine-shapes",
            "GET  /api/antenna-placements",
            "PUT  /api/antenna-placements",
            "GET  /api/station-placements",
            "PUT  /api/station-placements",
            "GET  /api/work-orders",
            "GET  /api/work-orders/<ibus>",
            "GET  /api/work-orders/<ibus>/components",
            "POST /api/work-orders/ingest",
            "POST /api/notify",
            "POST /api/sessions/<id>/end",
        ],
    })


@app.route("/assets/<path:filename>")
def serve_assets(filename):
    return send_from_directory(str(DASH_DIST / "assets"), filename)


# ── GET /api/live  (open sessions) ────────────────────────────────────────────

def _is_hidden_ibus(session_or_key) -> bool:
    """True if this session / IBUS key is in HIDDEN_IBUS_ORDERS (.env)."""
    if not HIDDEN_IBUS_ORDERS:
        return False
    if isinstance(session_or_key, dict):
        key = _ibus_order_key(session_or_key)
    else:
        key = str(session_or_key or "").strip().upper()
    if not key:
        return False
    return key.upper() in HIDDEN_IBUS_ORDERS


@app.route("/api/live")
def live_sessions():
    db = get_db()
    rows = db.execute(
        """SELECT * FROM vw_live_part_status
           WHERE session_status IN (?, ?)
           ORDER BY entry_time ASC""",
        (STATUS_OPEN, STATUS_EXIT_ONLY),
    ).fetchall()
    sessions = [_session_dict(r) for r in rows]
    if HIDDEN_IBUS_ORDERS:
        sessions = [s for s in sessions if not _is_hidden_ibus(s)]
    _attach_operators(db, sessions)
    _attach_last_antennas(db, sessions)
    db.close()
    return jsonify(sessions)


# ── GET /api/completed  (closed sessions) ─────────────────────────────────────

@app.route("/api/completed")
def completed_sessions():
    limit = request.args.get("limit", 25, type=int)
    db = get_db()
    rows = db.execute(
        """SELECT * FROM vw_live_part_status
           WHERE session_status IN (?, ?, ?)
           ORDER BY COALESCE(exit_time, entry_time) DESC
           LIMIT ?""",
        (STATUS_CLOSED, STATUS_ABANDONED, STATUS_EXIT_ONLY, limit),
    ).fetchall()
    sessions = [_session_dict(r) for r in rows]
    _attach_operators(db, sessions)
    db.close()
    return jsonify(sessions)


# ── GET /api/ibus  (part journeys grouped by EPC / IBUS) ───────────────────────

# Progress starts at Tennoner (= 0%). DB may store "Tennoner".
_STATION_PROGRESS_ALIASES = {
    "Tennoner": "Tenoner",
    "Final Packing": "Pack out",
    "Packing": "Pack out",
    "Outswing Latch Drilling": "LB Installation",
}


def _station_progress_index(name: str | None) -> int:
    if not name:
        return -1
    n = str(name).strip()
    n = _STATION_PROGRESS_ALIASES.get(n, n)
    if n in PROGRESS_STATIONS:
        return PROGRESS_STATIONS.index(n)
    return -1


def _progress_fraction(max_idx: int) -> float:
    """One part: Tenoner = 0.0 … last spine station = 1.0 (by furthest arrival)."""
    denom = max(len(PROGRESS_STATIONS) - 1, 1)
    if max_idx < 0:
        return 0.0
    return min(1.0, max_idx / denom)


def _part_progress_at_station(station_name: str | None) -> float:
    """Progress for one part from its current (arrival) station on the spine."""
    return _progress_fraction(_station_progress_index(station_name))


def _ibus_order_key(session: dict) -> str:
    """Order-level IBUS id (IBUS463947). Multiple part tags share one work order."""
    wo = session.get("work_order") or session.get("job_number")
    if wo:
        digits = re.sub(r"\D", "", str(wo))[-6:]
        if digits:
            return f"IBUS{digits}"

    epc = (session.get("epc") or session.get("ibus_number") or "").strip()
    m = re.search(r"IBUS(\d{6})", epc, re.I)
    if m:
        return f"IBUS{m.group(1)}"

    if len(epc) >= 6 and epc[-6:].isdigit():
        return f"IBUS{epc[-6:]}"

    sid = session.get("session_id")
    return f"part-{sid}" if sid else epc or "unknown"


def _part_tag_label(session: dict) -> str:
    """Part-level label, e.g. 1-D4-IBUS463947 or S6IBUS380612."""
    epc = (session.get("epc") or session.get("ibus_number") or "").strip()
    if not epc:
        return session.get("part_number") or "—"
    # Standard compact EPC: 1D40463947 -> 1-D4-IBUS463947
    if len(epc) >= 7 and epc[0].isdigit() and epc[-7] == "0" and epc[-6:].isdigit():
        qty = epc[0]
        part_no = epc[1:-7]
        wo = epc[-6:]
        return f"{qty}-{part_no}-IBUS{wo}"
    return epc


def _build_ibus_journeys(
    sessions: list[dict],
    specs_by_name: dict | None = None,
    part_actuals: dict[str, float] | None = None,
    wo_parts_by_ibus: dict[str, int] | None = None,
) -> list[dict]:
    """Group station sessions by IBUS order (work order), not individual part EPC."""
    groups: dict[str, list[dict]] = {}
    for s in sessions:
        key = _ibus_order_key(s)
        groups.setdefault(key, []).append(s)

    journeys = []
    now = datetime.now(timezone.utc)

    for key, sess_list in groups.items():
        sess_list.sort(key=lambda x: x.get("entry_time") or "")
        has_open = any(s.get("status") == STATUS_OPEN for s in sess_list)
        status = "open" if has_open else "completed"

        machines = []
        op_map: dict[int, dict] = {}
        part_map: dict[str, dict] = {}
        max_idx = -1
        stations_touched = set()

        for s in sess_list:
            st_name = s.get("station_name") or "—"
            stations_touched.add(st_name)
            idx = _station_progress_index(st_name)
            if idx > max_idx:
                max_idx = idx

            tag = _part_tag_label(s)
            epc = s.get("epc") or s.get("ibus_number") or tag
            if epc not in part_map:
                part_map[epc] = {
                    "epc": s.get("epc"),
                    "part_tag": tag,
                    "part_number": s.get("part_number"),
                    "part_name": s.get("part_name"),
                    "part_type": s.get("part_type"),
                    "work_order": s.get("work_order"),
                    "ibus_number": s.get("ibus_number") or tag,
                }

            machine_ops = []
            for op in (s.get("operators_worked") or []):
                oid = op.get("operator_id")
                if oid is None:
                    continue
                machine_ops.append({
                    "operator_id": op.get("operator_id"),
                    "operator_name": op.get("operator_name"),
                    "assigned_at": op.get("assigned_at"),
                    "assignment_method": op.get("assignment_method"),
                    "zone_name": op.get("zone_name"),
                    "station_name": op.get("station_name") or st_name,
                    "confirmed": True,
                })
                if oid not in op_map:
                    op_map[oid] = {
                        "operator_id": oid,
                        "operator_name": op.get("operator_name"),
                        "stations": [],
                    }
                if st_name not in op_map[oid]["stations"]:
                    op_map[oid]["stations"].append(st_name)

            if s.get("operator_name") and not machine_ops:
                machine_ops.append({
                    "operator_id": s.get("operator_id"),
                    "operator_name": s.get("operator_name"),
                    "zone_name": s.get("operator_zone"),
                    "station_name": st_name,
                    "confirmed": True,
                })

            # Prefer full RTLS presence history; fall back to worked assignments.
            rtls_ops = list(s.get("operators_rtls") or [])
            if not rtls_ops:
                for op in machine_ops:
                    rtls_ops.append({
                        "operator_id": op.get("operator_id"),
                        "operator_name": op.get("operator_name"),
                        "station_name": st_name,
                        "zone_name": op.get("zone_name"),
                        "entered_at": s.get("entry_time"),
                        "left_at": s.get("exit_time"),
                        "confirmed_at": op.get("assigned_at"),
                        "assignment_method": op.get("assignment_method"),
                        "confirmed": True,
                    })

            machines.append({
                "session_id": s.get("session_id"),
                "station_name": st_name,
                "epc": epc,
                "part_tag": tag,
                "part_number": s.get("part_number"),
                "part_name": s.get("part_name"),
                "part_type": s.get("part_type"),
                "work_order": s.get("work_order"),
                "ibus_number": s.get("ibus_number") or tag,
                "entry_time": s.get("entry_time"),
                "exit_time": s.get("exit_time"),
                "dwell_seconds": s.get("dwell_seconds"),
                "dwell_time_display": s.get("dwell_time_display"),
                "status": s.get("status"),
                "operators": machine_ops,
                "rtls": rtls_ops,
                "part": {
                    "epc": s.get("epc"),
                    "part_tag": tag,
                    "part_number": s.get("part_number"),
                    "part_name": s.get("part_name"),
                    "part_type": s.get("part_type"),
                    "work_order": s.get("work_order"),
                    "ibus_number": s.get("ibus_number") or tag,
                },
            })

        entries = [_parse_ts(s.get("entry_time")) for s in sess_list]
        exits = [_parse_ts(s.get("exit_time")) for s in sess_list]
        entries = [t for t in entries if t]
        exits = [t for t in exits if t]
        start = min(entries) if entries else None
        end = max(exits) if exits else (None if has_open else None)
        if has_open and start:
            total_sec = max(0, int((now - start).total_seconds()))
        elif start and end:
            total_sec = max(0, int((end - start).total_seconds()))
        else:
            dwell_sum = sum(int(s["dwell_seconds"]) for s in sess_list if s.get("dwell_seconds") is not None)
            total_sec = dwell_sum or None

        open_sess = next((s for s in reversed(sess_list) if s.get("status") == STATUS_OPEN), None)
        current_station = (open_sess or sess_list[-1]).get("station_name")

        wo = key[4:] if key.startswith("IBUS") else (sess_list[0].get("work_order") or "")

        # Nest machines under each part and compute per-part production window.
        parts_out = []
        part_progresses: list[float] = []
        for epc, meta in part_map.items():
            part_machines = [m for m in machines if m.get("epc") == epc]
            p_entries = [_parse_ts(m.get("entry_time")) for m in part_machines]
            p_exits = [_parse_ts(m.get("exit_time")) for m in part_machines]
            p_entries = [t for t in p_entries if t]
            p_exits = [t for t in p_exits if t]
            p_start = min(p_entries) if p_entries else None
            p_end = max(p_exits) if p_exits else None
            if has_open and p_start and not p_end:
                p_total = max(0, int((now - p_start).total_seconds()))
            elif p_start and p_end:
                p_total = max(0, int((p_end - p_start).total_seconds()))
            else:
                p_total = sum(
                    int(m["dwell_seconds"]) for m in part_machines
                    if m.get("dwell_seconds") is not None
                ) or None

            part_ops: dict[int, dict] = {}
            for m in part_machines:
                st = m.get("station_name")
                for op in list(m.get("operators") or []) + list(m.get("rtls") or []):
                    oid = op.get("operator_id")
                    if oid is None:
                        continue
                    if oid not in part_ops:
                        part_ops[oid] = {
                            "operator_id": oid,
                            "operator_name": op.get("operator_name"),
                            "rtls_badge_id": op.get("rtls_badge_id"),
                            "stations": [],
                        }
                    elif not part_ops[oid].get("operator_name") and op.get("operator_name"):
                        part_ops[oid]["operator_name"] = op.get("operator_name")
                    if st and st not in part_ops[oid]["stations"]:
                        part_ops[oid]["stations"].append(st)

            open_m = next(
                (m for m in reversed(part_machines) if m.get("status") == STATUS_OPEN),
                None,
            )
            part_station = (open_m or (part_machines[-1] if part_machines else {})).get(
                "station_name"
            )
            part_status = "open" if open_m else "completed"
            p_prog_pos = position_progress(part_station)
            p_prog_weighted = (
                part_weighted_progress(part_machines, specs_by_name or {})
                if specs_by_name is not None
                else None
            )
            p_prog = p_prog_weighted if p_prog_weighted is not None else p_prog_pos
            part_progresses.append(p_prog)

            parts_out.append({
                **meta,
                "entry_time": p_start.isoformat() if p_start else None,
                "exit_time": p_end.isoformat() if p_end else None,
                "total_production_seconds": p_total,
                "total_production_display": _dwell_display(p_total),
                "operators": list(part_ops.values()),
                "machines": part_machines,
                "machine_count": len(part_machines),
                "current_station": part_station,
                "status": part_status,
                "progress": round(p_prog, 3),
                "progress_position": round(p_prog_pos, 3),
                "progress_method": "weighted" if p_prog_weighted is not None else "position",
            })

        # Order bar = average of tracked parts only (BOM lines never seen are ignored)
        if part_progresses:
            progress = sum(part_progresses) / len(part_progresses)
        else:
            progress = _progress_fraction(max_idx)

        spine = progress_spine_names(specs_by_name or {}) if specs_by_name else list(PROGRESS_STATIONS)

        journey = {
            "key": key,
            "ibus_order": key,
            "ibus_number": key,
            "work_order": wo,
            "epc": sess_list[0].get("epc"),
            "part_id": sess_list[0].get("part_id"),
            "part_number": sess_list[0].get("part_number"),
            "part_name": sess_list[0].get("part_name"),
            "part_type": sess_list[0].get("part_type"),
            "parts": parts_out,
            "part_count": len(parts_out),
            "status": status,
            "current_station": current_station,
            "progress": round(progress, 3),
            "progress_method": "weighted" if specs_by_name else "position",
            "stations_done": len(stations_touched),
            "stations_total": len(spine),
            "entry_time": start.isoformat() if start else sess_list[0].get("entry_time"),
            "exit_time": end.isoformat() if end else None,
            "total_production_seconds": total_sec,
            "total_production_display": _dwell_display(total_sec),
            "machines": machines,
            "operators": list(op_map.values()),
            "session_count": len(sess_list),
        }
        if specs_by_name:
            _attach_order_time_estimates(
                journey, specs_by_name, part_actuals, wo_parts_by_ibus
            )
        else:
            # Still expose BOM size so the UI can show "34 parts" without specs.
            key_u = (journey.get("key") or "").upper()
            bom = (wo_parts_by_ibus or {}).get(key_u)
            journey["expected_parts"] = bom
            journey["estimated_parts"] = bom or journey.get("part_count") or 1
        journeys.append(journey)

    journeys.sort(key=lambda j: j.get("entry_time") or "", reverse=True)
    return journeys


@app.route("/api/ibus")
def ibus_journeys():
    """Open or completed IBUS orders grouped by work order (IBUS123456)."""
    status = (request.args.get("status") or "all").strip().lower()
    limit = min(request.args.get("limit", 80, type=int), 300)
    db = get_db()
    rows = db.execute(
        """SELECT * FROM vw_live_part_status
           ORDER BY COALESCE(exit_time, entry_time) DESC
           LIMIT ?""",
        (max(limit * 12, 600),),
    ).fetchall()
    sessions = [_session_dict(r) for r in rows]
    _attach_operators(db, sessions)
    specs_by_name = fetch_specs_by_name(db)
    part_actuals, _ = _station_actual_dwells(db)
    wo_parts_by_ibus = _work_order_parts_by_ibus(db)
    db.close()

    journeys = _build_ibus_journeys(
        sessions, specs_by_name, part_actuals, wo_parts_by_ibus
    )
    if status in ("open", "live", "in"):
        journeys = [j for j in journeys if j["status"] == "open"]
    elif status in ("completed", "closed", "done"):
        journeys = [j for j in journeys if j["status"] == "completed"]

    if HIDDEN_IBUS_ORDERS:
        journeys = [
            j for j in journeys
            if not _is_hidden_ibus(j.get("key") or j.get("ibus_order"))
        ]

    return jsonify(journeys[:limit])


# ── GET /api/raw-reads/recent  (antenna + role + rssi feed) ───────────────────

@app.route("/api/raw-reads/recent")
def recent_raw_reads():
    limit = request.args.get("limit", 50, type=int)
    db = get_db()
    rows = db.execute(
        """SELECT rr.read_id, rr.epc, rr.rssi, rr.antenna_port,
                  rr.reader_timestamp, rr.server_received_at,
                  rr.read_status, rr.is_stale,
                  a.antenna_name, a.antenna_role,
                  rd.reader_name, st.station_name
           FROM rfid_raw_reads rr
           LEFT JOIN rfid_antennas a  ON rr.antenna_id = a.antenna_id
           LEFT JOIN rfid_readers  rd ON rr.reader_id  = rd.reader_id
           LEFT JOIN stations      st ON a.station_id   = st.station_id
           ORDER BY rr.read_id DESC
           LIMIT ?""",
        (limit,),
    ).fetchall()
    db.close()
    return jsonify([{
        "read_id":       r["read_id"],
        "epc":           r["epc"],
        "rssi":          r["rssi"],
        "antenna_port":  r["antenna_port"],
        "antenna_name":  r["antenna_name"],
        "role":          r["antenna_role"],
        "reader_name":   r["reader_name"],
        "station_name":  r["station_name"],
        "read_time":     r["reader_timestamp"] or r["server_received_at"],
        "read_status":   r["read_status"],
        "is_stale":      bool(r["is_stale"]),
    } for r in rows])


# ── POST /api/sessions/<id>/end  (manual session close) ───────────────────────

@app.route("/api/sessions/<int:session_id>/end", methods=["POST"])
def end_session(session_id):
    db = get_db()
    row = db.execute(
        "SELECT entry_time, exit_time FROM part_station_sessions WHERE session_id = ?",
        (session_id,),
    ).fetchone()
    if not row:
        db.close()
        return jsonify({"error": "Session not found"}), 404

    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()
    dwell = None
    start_dt = _parse_ts(row["entry_time"])
    if start_dt:
        dwell = int((now - start_dt).total_seconds())

    db.execute(
        "UPDATE part_station_sessions "
        "SET session_status = ?, dwell_seconds = ?, exit_time = COALESCE(exit_time, ?), "
        "    updated_at = ? "
        "WHERE session_id = ?",
        (STATUS_ABANDONED, dwell, now_iso, now_iso, session_id),
    )
    db.commit()
    db.close()
    _direct_emit("session_ended")
    return jsonify({"success": True, "dwell_seconds": dwell})


# ── GET /api/summary  (dashboard cards) ───────────────────────────────────────

@app.route("/api/summary")
def summary():
    today = datetime.now().strftime("%Y-%m-%d")
    db = get_db()

    in_process = db.execute(
        "SELECT COUNT(*) FROM part_station_sessions WHERE session_status = ?",
        (STATUS_OPEN,),
    ).fetchone()[0]

    completed_today = db.execute(
        "SELECT COUNT(*) FROM part_station_sessions "
        "WHERE session_status = ? AND exit_time >= ?",
        (STATUS_CLOSED, today),
    ).fetchone()[0]

    avg_dwell = db.execute(
        "SELECT AVG(dwell_seconds) FROM part_station_sessions "
        "WHERE session_status = ? AND exit_time >= ?",
        (STATUS_CLOSED, today),
    ).fetchone()[0]

    missing_exit = db.execute(
        "SELECT COUNT(*) FROM part_station_sessions WHERE session_status = ?",
        (STATUS_EXIT_ONLY,),
    ).fetchone()[0]

    last_read = db.execute(
        "SELECT MAX(COALESCE(reader_timestamp, server_received_at)) FROM rfid_raw_reads"
    ).fetchone()[0]

    db.close()

    reader_status = "Waiting for Reads"
    if last_read:
        last_dt = _parse_ts(last_read)
        if last_dt:
            diff = (datetime.now(timezone.utc) - last_dt).total_seconds()
            reader_status = "Active" if diff < 60 else "No Recent Reads"

    return jsonify({
        "station_name":                STATION_NAME,
        "parts_in_process":            in_process,
        "completed_today":             completed_today,
        "average_dwell_seconds_today": round(float(avg_dwell), 1) if avg_dwell else None,
        "average_dwell_display_today": _dwell_display(int(avg_dwell)) if avg_dwell else None,
        "missing_exit_count":          missing_exit,
        "active_alerts":               0,
        "last_rfid_read_time":         last_read,
        "reader_status":               reader_status,
    })


# ── Config / catalog endpoints ────────────────────────────────────────────────

@app.route("/api/stations")
def list_stations():
    db = get_db()
    rows = db.execute(
        "SELECT station_id, station_name, station_type, is_active "
        "FROM stations ORDER BY station_id"
    ).fetchall()
    db.close()
    return jsonify([dict(r) for r in rows])


def _station_actual_dwells(db: sqlite3.Connection) -> tuple[dict[str, float], dict[str, float]]:
    """Return (part_avg_by_station, operator_avg_by_station) keyed by station_name."""
    part_map: dict[str, float] = {}
    for r in db.execute(
        """SELECT st.station_name, AVG(s.dwell_seconds) AS avg_dwell
           FROM part_station_sessions s
           JOIN stations st ON st.station_id = s.station_id
           WHERE s.session_status = ? AND s.dwell_seconds IS NOT NULL
           GROUP BY st.station_name""",
        (STATUS_CLOSED,),
    ):
        part_map[r["station_name"]] = float(r["avg_dwell"])
        canon = canonical_station(r["station_name"])
        if canon:
            part_map.setdefault(canon, float(r["avg_dwell"]))

    op_map: dict[str, float] = {}
    for r in db.execute(
        """SELECT station_name, AVG(dwell_seconds) AS avg_dwell
           FROM operator_zone_visits
           WHERE exited_at IS NOT NULL AND dwell_seconds IS NOT NULL
             AND station_name IS NOT NULL
           GROUP BY station_name"""
    ):
        op_map[r["station_name"]] = float(r["avg_dwell"])
        canon = canonical_station(r["station_name"])
        if canon:
            op_map.setdefault(canon, float(r["avg_dwell"]))

    return part_map, op_map


@app.route("/api/station-specifications")
def list_station_specifications():
    db = get_db()
    specs = fetch_specs_by_name(db)
    part_actuals, op_actuals = _station_actual_dwells(db)
    db.close()

    seen_ids: set[int] = set()
    out = []
    for row in sorted(specs.values(), key=spine_sort_key):
        sid = row["station_id"]
        if sid in seen_ids:
            continue
        seen_ids.add(sid)
        name = row["station_name"]
        out.append(spec_row_to_api(
            row,
            part_actuals.get(name) or part_actuals.get(canonical_station(name) or ""),
            op_actuals.get(name) or op_actuals.get(canonical_station(name) or ""),
        ))
    return jsonify({
        "specifications": out,
        "progress_spine": progress_spine_names(specs),
    })


@app.route("/api/station-specifications/<int:station_id>", methods=["PUT"])
def update_station_specification(station_id: int):
    db = get_db()
    row = db.execute(
        "SELECT station_id FROM stations WHERE station_id = ?", (station_id,)
    ).fetchone()
    if not row:
        db.close()
        return jsonify({"error": "Station not found"}), 404

    body = request.get_json(silent=True) or {}
    upsert_spec(db, station_id, body)
    db.commit()

    specs = fetch_specs_by_name(db)
    part_actuals, op_actuals = _station_actual_dwells(db)
    spec_row = next((r for r in specs.values() if r["station_id"] == station_id), None)
    db.close()
    if not spec_row:
        return jsonify({"error": "Specification not found"}), 404
    name = spec_row["station_name"]
    return jsonify(spec_row_to_api(
        spec_row,
        part_actuals.get(name) or part_actuals.get(canonical_station(name) or ""),
        op_actuals.get(name) or op_actuals.get(canonical_station(name) or ""),
    ))


@app.route("/api/readers")
def list_readers():
    db = get_db()
    rows = db.execute(
        """SELECT r.reader_id, r.reader_name, r.reader_ip, r.location_description,
                  r.is_active, s.station_name
           FROM rfid_readers r
           LEFT JOIN stations s ON r.station_id = s.station_id
           ORDER BY r.reader_id"""
    ).fetchall()
    db.close()
    return jsonify([dict(r) for r in rows])


@app.route("/api/antennas")
def list_antennas():
    db = get_db()
    rows = db.execute(
        """SELECT a.antenna_id, a.antenna_port, a.antenna_name, a.antenna_role,
                  r.reader_name, s.station_name
           FROM rfid_antennas a
           LEFT JOIN rfid_readers r ON a.reader_id  = r.reader_id
           LEFT JOIN stations     s ON a.station_id = s.station_id
           ORDER BY a.antenna_id"""
    ).fetchall()
    db.close()
    return jsonify([dict(r) for r in rows])


@app.route("/api/parts")
def list_parts():
    limit = min(request.args.get("limit", 200, type=int), 1000)
    db = get_db()
    rows = db.execute(
        """SELECT part_id, part_number, part_name, part_type, ibus_number,
                  job_number, quantity_required, created_at
           FROM parts ORDER BY part_id DESC LIMIT ?""",
        (limit,),
    ).fetchall()
    db.close()
    return jsonify([dict(r) for r in rows])


@app.route("/api/tags")
def list_tags():
    limit = min(request.args.get("limit", 200, type=int), 1000)
    db = get_db()
    rows = db.execute(
        """SELECT t.tag_id, t.epc, t.tid, t.tag_status, t.created_at,
                  pa.part_id
           FROM rfid_tags t
           LEFT JOIN part_tag_assignments pa
             ON pa.tag_id = t.tag_id AND pa.unassigned_at IS NULL
           ORDER BY t.tag_id DESC LIMIT ?""",
        (limit,),
    ).fetchall()
    db.close()
    return jsonify([dict(r) for r in rows])


# ── Work orders / R41 BOM ─────────────────────────────────────────────────────

@app.route("/api/work-orders")
def list_work_orders():
    status = request.args.get("status")
    db = get_db()
    if status:
        rows = db.execute(
            "SELECT * FROM work_orders WHERE status = ? ORDER BY ingested_at DESC",
            (status,),
        ).fetchall()
    else:
        rows = db.execute(
            "SELECT * FROM work_orders ORDER BY ingested_at DESC"
        ).fetchall()
    db.close()
    return jsonify([dict(r) for r in rows])


@app.route("/api/work-orders/<ibus>")
def get_work_order(ibus: str):
    key = ibus.strip().upper()
    if not key.startswith("IBUS"):
        key = f"IBUS{key}"
    db = get_db()
    row = db.execute(
        "SELECT * FROM work_orders WHERE ibus_number = ?", (key,)
    ).fetchone()
    if not row:
        # Also try bare work-order digits
        digits = re.sub(r"\D", "", ibus)[-6:]
        if digits:
            row = db.execute(
                "SELECT * FROM work_orders WHERE work_order = ? OR ibus_number = ?",
                (digits, f"IBUS{digits}"),
            ).fetchone()
    if not row:
        db.close()
        return jsonify({"error": f"Work order not found: {ibus}"}), 404
    order = dict(row)
    comps = db.execute(
        "SELECT component_id, line_index, ref, qty, epc, tag_label, status, "
        "       size, room, operation, product, material_family, color "
        "FROM work_order_components WHERE work_order_id = ? "
        "ORDER BY line_index",
        (order["work_order_id"],),
    ).fetchall()
    db.close()
    order["components"] = [dict(c) for c in comps]
    return jsonify(order)


@app.route("/api/work-orders/<ibus>/components")
def list_work_order_components(ibus: str):
    key = ibus.strip().upper()
    if not key.startswith("IBUS"):
        key = f"IBUS{key}"
    db = get_db()
    wo = db.execute(
        "SELECT work_order_id, ibus_number FROM work_orders WHERE ibus_number = ?",
        (key,),
    ).fetchone()
    if not wo:
        digits = re.sub(r"\D", "", ibus)[-6:]
        if digits:
            wo = db.execute(
                "SELECT work_order_id, ibus_number FROM work_orders "
                "WHERE work_order = ? OR ibus_number = ?",
                (digits, f"IBUS{digits}"),
            ).fetchone()
    if not wo:
        db.close()
        return jsonify({"error": f"Work order not found: {ibus}"}), 404
    rows = db.execute(
        "SELECT * FROM work_order_components WHERE work_order_id = ? ORDER BY line_index",
        (wo["work_order_id"],),
    ).fetchall()
    db.close()
    return jsonify({
        "ibus_number": wo["ibus_number"],
        "count": len(rows),
        "components": [dict(r) for r in rows],
    })


@app.route("/api/work-orders/ingest", methods=["POST"])
def ingest_work_orders():
    """Ingest .R41 file(s) into work_orders + work_order_components.

    JSON body (all optional):
      { "path": ".R41/IBUS462064.R41", "replace": true }
    Defaults to .R41/ then r41/inbox/.
    """
    body = request.get_json(silent=True) or {}
    path_raw = body.get("path")
    replace = bool(body.get("replace", False))
    target = Path(path_raw) if path_raw else None
    if target and not target.is_absolute():
        target = (Path(__file__).parent / target).resolve()

    try:
        from r41.ingest import ingest_path
        results = ingest_path(target, replace=replace)
    except FileNotFoundError as exc:
        return jsonify({"error": str(exc)}), 404
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500
    return jsonify({"ok": True, "orders": results})


@app.route("/api/notify", methods=["POST"])
def notify_clients():
    """Wake the dashboard after an external writer (e.g. sim/run.py) changes the DB."""
    body = request.get_json(silent=True) or {}
    action = str(body.get("action") or "sim_update")
    _direct_emit(action)
    return jsonify({"ok": True, "action": action})


# ── Sewio RTLS endpoints ──────────────────────────────────────────────────────

@app.route("/api/rtls/health")
def rtls_health():
    sys.path.insert(0, str(Path(__file__).parent / "tracking"))
    from rtls_storage import get_live_state, rest_health
    from sewio_client import is_running

    rest = rest_health(SEWIO_API_KEY, SEWIO_REST_URL, SEWIO_VERIFY_SSL)
    live = get_live_state()
    return jsonify({
        "enabled":           ENABLE_LIVE_INGESTION,
        "client_running":    is_running(),
        "websocket_connected": live.get("connected", False),
        "last_message_at":   live.get("last_message_at"),
        "rest":              rest,
    })


@app.route("/api/rtls/live")
def rtls_live():
    sys.path.insert(0, str(Path(__file__).parent / "tracking"))
    from rtls_storage import get_live_state
    return jsonify(get_live_state())


@app.route("/api/rtls/demo", methods=["POST", "DELETE"])
def rtls_demo():
    """Seed or clear fake zone operators for offline dashboard testing."""
    sys.path.insert(0, str(Path(__file__).parent / "tracking"))
    import rtls_live

    if request.method == "DELETE":
        removed = rtls_live.clear_demo_zones()
        return jsonify({"ok": True, "cleared": removed})

    seeded = rtls_live.seed_demo_zones()
    return jsonify({
        "ok": True,
        "count": len(seeded),
        "zone_presence": seeded,
    })


@app.route("/api/rtls/sim-zone", methods=["POST"])
def rtls_sim_zone():
    """Apply a zone in/out from the offline sim (updates API memory + DB + websocket)."""
    sys.path.insert(0, str(Path(__file__).parent / "tracking"))
    from rtls_storage import record_zone_event

    body = request.get_json(silent=True) or {}
    try:
        tag_id = int(body["tag_id"])
    except (KeyError, TypeError, ValueError):
        return jsonify({"error": "tag_id required"}), 400
    zone_id = int(body.get("zone_id") or 0)
    status = str(body.get("status") or "in").strip().lower()
    if status not in ("in", "out"):
        return jsonify({"error": "status must be in or out"}), 400
    source = str(body.get("source") or "sim")

    entry = record_zone_event(
        tag_id, zone_id, status, at=body.get("at"), source=source,
    )
    ts = _now_utc()
    if status == "in":
        socketio.emit("rtls_zone", {"ts": ts, "zone": entry})
    else:
        socketio.emit("rtls_zone", {"ts": ts, "zone": {"tag_id": tag_id, "status": "out"}})
    return jsonify({"ok": True, **entry})


def _attach_last_antennas(db: sqlite3.Connection, sessions: list[dict]) -> list[dict]:
    """Attach the most recent RFID antenna sighting for each live session EPC."""
    if not sessions:
        return sessions

    epcs = list({s["epc"] for s in sessions if s.get("epc")})
    by_epc: dict[str, dict] = {}
    if epcs:
        placeholders = ",".join("?" * len(epcs))
        rows = db.execute(
            f"""SELECT rr.epc, rr.antenna_port, rr.antenna_id, rr.rssi,
                       rr.reader_timestamp, rr.server_received_at,
                       a.antenna_name, a.antenna_role, st.station_name AS antenna_station
                FROM rfid_raw_reads rr
                LEFT JOIN rfid_antennas a ON rr.antenna_id = a.antenna_id
                LEFT JOIN stations st ON a.station_id = st.station_id
                WHERE rr.read_id IN (
                    SELECT MAX(read_id) FROM rfid_raw_reads
                    WHERE epc IN ({placeholders})
                    GROUP BY epc
                )""",
            epcs,
        ).fetchall()
        for r in rows:
            by_epc[r["epc"]] = {
                "last_antenna_id": r["antenna_id"],
                "last_antenna_port": r["antenna_port"],
                "last_antenna_name": r["antenna_name"],
                "last_antenna_role": r["antenna_role"],
                "last_antenna_station": r["antenna_station"],
                "last_rssi": r["rssi"],
                "last_read_time": r["reader_timestamp"] or r["server_received_at"],
            }

    # Catalog fallback by station + role when no raw read is available
    ant_rows = db.execute(
        """SELECT a.antenna_id, a.antenna_port, a.antenna_name, a.antenna_role,
                  s.station_name
           FROM rfid_antennas a
           LEFT JOIN stations s ON a.station_id = s.station_id"""
    ).fetchall()
    by_station_role: dict[tuple[str, str], dict] = {}
    for a in ant_rows:
        if a["station_name"] and a["antenna_role"]:
            by_station_role[(a["station_name"], a["antenna_role"])] = {
                "last_antenna_id": a["antenna_id"],
                "last_antenna_port": a["antenna_port"],
                "last_antenna_name": a["antenna_name"],
                "last_antenna_role": a["antenna_role"],
                "last_antenna_station": a["station_name"],
            }

    for s in sessions:
        hit = by_epc.get(s.get("epc") or "")
        if hit:
            s.update(hit)
            continue
        role = "Exit" if s.get("exit_time") else "Entry"
        station = s.get("station_name") or ""
        fb = by_station_role.get((station, role))
        if fb:
            s.update(fb)
            s["last_rssi"] = None
            s["last_read_time"] = s.get("exit_time") or s.get("entry_time")
        else:
            s.update({
                "last_antenna_id": None,
                "last_antenna_port": None,
                "last_antenna_name": None,
                "last_antenna_role": role,
                "last_antenna_station": station or None,
                "last_rssi": None,
                "last_read_time": s.get("exit_time") or s.get("entry_time"),
            })
    return sessions


# ── Machine floor-plan shapes (polygons in image pixels) ──────────────────────

MACHINE_SHAPES_PATH = Path(__file__).parent / "RTLS" / "machineShapes.json"


def _load_machine_shapes() -> dict:
    if not MACHINE_SHAPES_PATH.exists():
        return {}
    import json
    try:
        data = json.loads(MACHINE_SHAPES_PATH.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def _normalize_polygon(points) -> list | None:
    if not isinstance(points, list) or len(points) < 3:
        return None
    out = []
    for pt in points:
        if isinstance(pt, (list, tuple)) and len(pt) >= 2:
            x, y = float(pt[0]), float(pt[1])
        elif isinstance(pt, dict) and "x" in pt and "y" in pt:
            x, y = float(pt["x"]), float(pt["y"])
        else:
            return None
        if not (x == x and y == y):  # NaN check
            return None
        out.append([round(x, 2), round(y, 2)])
    return out


@app.route("/api/machine-shapes")
def get_machine_shapes():
    return jsonify(_load_machine_shapes())


@app.route("/api/machine-shapes", methods=["PUT"])
def put_machine_shapes():
    import json

    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        return jsonify({"error": "Expected a JSON object of station -> shape"}), 400

    cleaned = {}
    for station, shape in body.items():
        if not isinstance(station, str) or not station.strip():
            continue
        if not isinstance(shape, dict):
            continue
        poly = _normalize_polygon(shape.get("polygon"))
        if poly is None:
            continue
        cleaned[station.strip()] = {"polygon": poly}

    MACHINE_SHAPES_PATH.parent.mkdir(parents=True, exist_ok=True)
    MACHINE_SHAPES_PATH.write_text(
        json.dumps(cleaned, indent=2) + "\n",
        encoding="utf-8",
    )
    return jsonify(cleaned)


# ── Antenna floor-plan placements (image pixels) ──────────────────────────────

ANTENNA_PLACEMENTS_PATH = Path(__file__).parent / "RTLS" / "antennaPlacements.json"


def _load_antenna_placements() -> dict:
    if not ANTENNA_PLACEMENTS_PATH.exists():
        return {}
    import json
    try:
        data = json.loads(ANTENNA_PLACEMENTS_PATH.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


@app.route("/api/antenna-placements")
def get_antenna_placements():
    return jsonify(_load_antenna_placements())


@app.route("/api/antenna-placements", methods=["PUT"])
def put_antenna_placements():
    import json

    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        return jsonify({"error": "Expected a JSON object of antenna_id -> {x,y,visible}"}), 400

    cleaned = {}
    for key, val in body.items():
        if not isinstance(val, dict):
            continue
        try:
            x = float(val.get("x"))
            y = float(val.get("y"))
        except (TypeError, ValueError):
            continue
        if not (x == x and y == y):
            continue
        cleaned[str(key)] = {
            "x": round(x, 2),
            "y": round(y, 2),
            "visible": bool(val.get("visible", True)),
        }

    ANTENNA_PLACEMENTS_PATH.parent.mkdir(parents=True, exist_ok=True)
    ANTENNA_PLACEMENTS_PATH.write_text(
        json.dumps(cleaned, indent=2) + "\n",
        encoding="utf-8",
    )
    return jsonify(cleaned)


# ── Station floor-plan pins (operator map anchors, image pixels) ───────────────

STATION_PLACEMENTS_PATH = Path(__file__).parent / "RTLS" / "stationPlacements.json"


def _load_station_placements() -> dict:
    if not STATION_PLACEMENTS_PATH.exists():
        return {}
    import json
    try:
        data = json.loads(STATION_PLACEMENTS_PATH.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


@app.route("/api/station-placements")
def get_station_placements():
    return jsonify(_load_station_placements())


@app.route("/api/station-placements", methods=["PUT"])
def put_station_placements():
    import json

    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        return jsonify({"error": "Expected a JSON object of station -> {x,y,visible}"}), 400

    cleaned = {}
    for key, val in body.items():
        if not isinstance(val, dict):
            continue
        station = str(key).strip()
        if not station:
            continue
        try:
            x = float(val.get("x"))
            y = float(val.get("y"))
        except (TypeError, ValueError):
            continue
        if not (x == x and y == y):
            continue
        cleaned[station] = {
            "x": round(x, 2),
            "y": round(y, 2),
            "visible": bool(val.get("visible", True)),
        }

    STATION_PLACEMENTS_PATH.parent.mkdir(parents=True, exist_ok=True)
    STATION_PLACEMENTS_PATH.write_text(
        json.dumps(cleaned, indent=2) + "\n",
        encoding="utf-8",
    )
    return jsonify(cleaned)


# ── Operator endpoints (read only — assignment logic deferred) ────────────────

@app.route("/api/operators")
def list_operators():
    db = get_db()
    rows = db.execute(
        "SELECT operator_id, employee_number, operator_name, rtls_badge_id, is_active "
        "FROM operators ORDER BY operator_id"
    ).fetchall()
    db.close()
    return jsonify([dict(r) for r in rows])


@app.route("/api/operators/<int:operator_id>/presence")
def operator_presence(operator_id):
    limit = min(request.args.get("limit", 100, type=int), 500)
    db = get_db()
    rows = db.execute(
        """SELECT p.presence_id, p.operator_id, p.station_id, p.detected_at,
                  p.distance_meters, p.confidence_score, s.station_name
           FROM operator_station_presence p
           LEFT JOIN stations s ON p.station_id = s.station_id
           WHERE p.operator_id = ?
           ORDER BY p.detected_at DESC LIMIT ?""",
        (operator_id, limit),
    ).fetchall()
    db.close()
    return jsonify([dict(r) for r in rows])


@app.route("/api/sessions/<int:session_id>/operators")
def session_operators(session_id):
    db = get_db()
    rows = db.execute(
        """SELECT poa.assignment_id, poa.operator_id, poa.assignment_method,
                  poa.confidence_score, poa.assigned_at,
                  o.operator_name, o.employee_number
           FROM part_operator_assignments poa
           LEFT JOIN operators o ON poa.operator_id = o.operator_id
           WHERE poa.session_id = ?
           ORDER BY poa.assigned_at DESC""",
        (session_id,),
    ).fetchall()
    db.close()
    return jsonify([dict(r) for r in rows])


# ── GET /api/report/stations  (grouped by station) ────────────────────────────

_STATUS_TO_BUCKET = {
    STATUS_OPEN:      "in_process",
    STATUS_CLOSED:    "completed",
    STATUS_EXIT_ONLY: "exit_only",
    STATUS_ABANDONED: "abandoned",
}


@app.route("/api/report/stations")
def report_stations():
    today = datetime.now().strftime("%Y-%m-%d")
    db = get_db()
    rows = db.execute(
        """SELECT * FROM vw_live_part_status
           ORDER BY COALESCE(exit_time, entry_time) DESC"""
    ).fetchall()
    db.close()

    stations: dict[str, dict] = {}

    def _bucket(name: str) -> dict:
        if name not in stations:
            stations[name] = {
                "station": name, "in_process": 0, "completed_today": 0,
                "completed_total": 0, "exit_only": 0, "abandoned": 0,
                "total": 0, "_dwells": [], "parts": [],
            }
        return stations[name]

    for r in rows:
        name = r["station_name"] or STATION_NAME
        st = _bucket(name)
        st["total"] += 1
        status = r["session_status"]
        sess = _session_dict(r)
        # keep a lean part payload for on-floor tables
        part = {
            "id":             sess["id"],
            "epc":            sess["epc"],
            "part_name":      sess["part_name"],
            "part_type":      sess["part_type"],
            "work_order":     sess["work_order"],
            "ibus_number":    sess["ibus_number"],
            "status":         sess["status"],
            "entry_time":     sess["entry_time"],
            "entry_epoch_ms": sess["entry_epoch_ms"],
            "exit_time":      sess["exit_time"],
        }

        if status == STATUS_OPEN:
            st["in_process"] += 1
            st["parts"].append(part)
        elif status == STATUS_EXIT_ONLY:
            st["exit_only"] += 1
            st["parts"].append(part)
        elif status == STATUS_ABANDONED:
            st["abandoned"] += 1
        elif status == STATUS_CLOSED:
            st["completed_total"] += 1
            if r["exit_time"] and r["exit_time"] >= today:
                st["completed_today"] += 1
            if r["dwell_seconds"] is not None:
                st["_dwells"].append(int(r["dwell_seconds"]))

    out = []
    for st in stations.values():
        dwells = st.pop("_dwells")
        avg = sum(dwells) / len(dwells) if dwells else None
        st["avg_dwell_seconds"] = round(avg, 1) if avg is not None else None
        st["avg_dwell_display"] = _dwell_display(avg)
        out.append(st)

    out.sort(key=lambda s: s["station"])
    if not out:
        for name in (STATION_NAME, INSERT_STATION_NAME):
            out.append({
                "station": name, "in_process": 0, "completed_today": 0,
                "completed_total": 0, "exit_only": 0, "abandoned": 0, "total": 0,
                "avg_dwell_seconds": None, "avg_dwell_display": None, "parts": [],
            })
    return jsonify({"stations": out})


# ── GET /api/report/sessions  (paged, searchable) ─────────────────────────────

_STATUS_ALIASES = {
    "OPEN": STATUS_OPEN, "IN_PROGRESS": STATUS_OPEN,
    "CLOSED": STATUS_CLOSED, "COMPLETE": STATUS_CLOSED,
    "EXIT_ONLY": STATUS_EXIT_ONLY,
    "ABANDONED": STATUS_ABANDONED,
}


@app.route("/api/report/sessions")
def report_sessions():
    export = (request.args.get("export") or "").strip().lower() in ("1", "true", "csv")
    max_limit = 5000 if export else 500
    limit  = min(request.args.get("limit", 100, type=int), max_limit)
    offset = max(request.args.get("offset", 0, type=int), 0)
    search = (request.args.get("search") or "").strip()
    status = (request.args.get("status") or "ALL").strip().upper()
    date_from = (request.args.get("date_from") or "").strip()
    date_to = (request.args.get("date_to") or "").strip()
    station = (request.args.get("station") or "").strip()
    work_order = (request.args.get("work_order") or "").strip()
    operator_id = request.args.get("operator_id", type=int)

    where = []
    params: list = []
    if search:
        where.append(
            "(epc LIKE ? OR ibus_number LIKE ? OR part_name LIKE ? OR job_number LIKE ?)"
        )
        like = f"%{search}%"
        params.extend([like, like, like, like])
    if status and status != "ALL":
        db_status = _STATUS_ALIASES.get(status, status.lower())
        where.append("session_status = ?")
        params.append(db_status)
    if date_from:
        where.append("date(COALESCE(exit_time, entry_time)) >= date(?)")
        params.append(date_from)
    if date_to:
        where.append("date(COALESCE(exit_time, entry_time)) <= date(?)")
        params.append(date_to)
    if station:
        where.append("station_name = ?")
        params.append(station)
    if work_order:
        where.append("(job_number LIKE ? OR ibus_number LIKE ?)")
        like_wo = f"%{work_order}%"
        params.extend([like_wo, like_wo])
    if operator_id is not None:
        where.append(
            """session_id IN (
                SELECT session_id FROM part_operator_assignments WHERE operator_id = ?
            )"""
        )
        params.append(operator_id)

    where_sql = ("WHERE " + " AND ".join(where)) if where else ""

    db = get_db()
    total = db.execute(
        f"SELECT COUNT(*) FROM vw_live_part_status {where_sql}", params
    ).fetchone()[0]

    rows = db.execute(
        f"""SELECT * FROM vw_live_part_status
            {where_sql}
            ORDER BY COALESCE(exit_time, entry_time) DESC
            LIMIT ? OFFSET ?""",
        (*params, limit, offset),
    ).fetchall()
    sessions = [_session_dict(r) for r in rows]
    _attach_operators(db, sessions)
    db.close()

    return jsonify({
        "total":    total,
        "limit":    limit,
        "offset":   offset,
        "sessions": sessions,
    })


# ── GET /api/analytics ────────────────────────────────────────────────────────

def _build_operator_analytics(
    db: sqlite3.Connection,
    *,
    today_only: bool = False,
) -> dict:
    """Aggregate per-operator counts (distinct parts), dwell, and per-station breakdown.

    When today_only=True, only sessions with exit/entry/assigned timestamps on the
    local calendar day are counted (Live “Parts today”).
    """
    rows = db.execute(
        """SELECT o.operator_id, o.operator_name, st.station_name,
                  s.session_id, s.dwell_seconds, s.session_status, t.epc,
                  s.exit_time, s.entry_time, poa.assigned_at
           FROM part_operator_assignments poa
           JOIN operators o ON poa.operator_id = o.operator_id
           JOIN part_station_sessions s ON poa.session_id = s.session_id
           JOIN stations st ON s.station_id = st.station_id
           LEFT JOIN rfid_tags t ON t.tag_id = s.tag_id"""
    ).fetchall()

    today = datetime.now().astimezone().date()
    op_acc: dict[int, dict] = {}
    for r in rows:
        if today_only:
            day = (
                _local_date(r["exit_time"])
                or _local_date(r["assigned_at"])
                or _local_date(r["entry_time"])
            )
            if day != today:
                continue
        oid = r["operator_id"]
        if oid not in op_acc:
            op_acc[oid] = {
                "operator_id":   oid,
                "operator_name": r["operator_name"],
                "closed":        [],
                "open":          0,
                "stations":      {},
                "epcs_closed":   set(),
                "epcs_open":     set(),
            }
        acc = op_acc[oid]
        station = r["station_name"] or STATION_NAME
        epc = r["epc"] or f"session-{r['session_id']}"
        st_acc = acc["stations"].setdefault(
            station,
            {"pieces": 0, "dwells": [], "epcs": set()},
        )
        if r["session_status"] == STATUS_CLOSED:
            acc["closed"].append(int(r["dwell_seconds"] or 0))
            st_acc["pieces"] += 1
            st_acc["epcs"].add(epc)
            acc["epcs_closed"].add(epc)
            if r["dwell_seconds"] is not None:
                st_acc["dwells"].append(int(r["dwell_seconds"]))
        elif r["session_status"] == STATUS_OPEN:
            acc["open"] += 1
            st_acc["pieces"] += 1
            st_acc["epcs"].add(epc)
            acc["epcs_open"].add(epc)

    leaderboard = []
    for acc in op_acc.values():
        dwells = acc["closed"]
        total_closed = len(dwells)
        unique_closed = len(acc["epcs_closed"])
        unique_open = len(acc["epcs_open"] - acc["epcs_closed"])
        avg = sum(dwells) / total_closed if dwells else None
        stations = []
        for name, st in acc["stations"].items():
            s_avg = sum(st["dwells"]) / len(st["dwells"]) if st["dwells"] else None
            stations.append({
                "station":           name,
                "pieces":            len(st["epcs"]),
                "sessions":          st["pieces"],
                "completed":         len(st["dwells"]),
                "avg_dwell_seconds": round(s_avg, 1) if s_avg is not None else None,
                "avg_dwell_display": _dwell_display(s_avg),
            })
        stations.sort(key=lambda s: s["pieces"], reverse=True)
        leaderboard.append({
            "operator_id":       acc["operator_id"],
            "operator_name":     acc["operator_name"],
            "total_pieces":      unique_closed + unique_open,
            "completed_pieces":  unique_closed,
            "completed_sessions": total_closed,
            "in_progress":       unique_open,
            "stations_worked":   len(acc["stations"]),
            "avg_dwell_seconds": round(avg, 1) if avg is not None else None,
            "avg_dwell_display": _dwell_display(avg),
            "stations":          stations,
        })
    leaderboard.sort(key=lambda o: (o["completed_pieces"], o["total_pieces"]), reverse=True)

    open_total = db.execute(
        "SELECT COUNT(*) AS c FROM part_station_sessions WHERE session_status = ?",
        (STATUS_OPEN,),
    ).fetchone()["c"]
    open_matched = db.execute(
        """SELECT COUNT(DISTINCT s.session_id) AS c
           FROM part_station_sessions s
           JOIN part_operator_assignments poa ON poa.session_id = s.session_id
           WHERE s.session_status = ?""",
        (STATUS_OPEN,),
    ).fetchone()["c"]
    rtls_match_rate = (
        round(100.0 * open_matched / open_total, 1) if open_total else None
    )

    total_attributed = sum(o["completed_pieces"] for o in leaderboard)
    top = leaderboard[0] if leaderboard else None

    return {
        "summary": {
            "active_operators":        len(leaderboard),
            "total_pieces_attributed": total_attributed,
            "top_operator": {
                "operator_id":   top["operator_id"],
                "operator_name": top["operator_name"],
                "pieces":        top["completed_pieces"],
            } if top else None,
            "rtls_match_rate":         rtls_match_rate,
            "open_sessions":           open_total,
            "open_with_operator":      open_matched,
        },
        "leaderboard": leaderboard,
    }


def _build_operator_analytics_extended(db: sqlite3.Connection) -> dict:
    """Full operator analytics for the dedicated Live Operators page (today-scoped)."""
    base = _build_operator_analytics(db, today_only=True)
    all_time = _build_operator_analytics(db, today_only=False)

    # Who is in which zone right now (RTLS / demo seeds).
    in_zone = db.execute(
        """SELECT o.operator_id, o.operator_name, o.rtls_badge_id,
                  ocz.station_name, ocz.zone_name, ocz.updated_at
           FROM operator_current_zone ocz
           JOIN operators o ON o.operator_id = ocz.operator_id
           WHERE ocz.status = 'in' AND o.is_active = 1
           ORDER BY ocz.station_name, o.operator_name"""
    ).fetchall()

    # Station coverage — how many operators and pieces per machine.
    station_rows = db.execute(
        """SELECT COALESCE(poa.station_name, st.station_name, ?) AS station_name,
                  COUNT(DISTINCT poa.operator_id) AS operator_count,
                  COUNT(*) AS assignment_count,
                  COUNT(DISTINCT poa.session_id) AS session_count
           FROM part_operator_assignments poa
           JOIN part_station_sessions s ON s.session_id = poa.session_id
           JOIN stations st ON st.station_id = s.station_id
           GROUP BY COALESCE(poa.station_name, st.station_name, ?)
           ORDER BY assignment_count DESC""",
        (STATION_NAME, STATION_NAME),
    ).fetchall()

    # Hourly assignment volume today (local wall-clock — not UTC strftime).
    today = datetime.now().astimezone().date()
    assign_ts = []
    for r in db.execute(
        "SELECT assigned_at FROM part_operator_assignments WHERE assigned_at IS NOT NULL"
    ):
        if _local_date(r["assigned_at"]) == today:
            assign_ts.append(r["assigned_at"])
    by_hour = _hourly_buckets_from_timestamps(assign_ts)

    # RTLS presence confirmation stats.
    pres = db.execute(
        """SELECT
             COUNT(*) AS total,
             SUM(CASE WHEN confirmed_at IS NOT NULL THEN 1 ELSE 0 END) AS confirmed,
             SUM(CASE WHEN confirmed_at IS NULL AND left_at IS NULL THEN 1 ELSE 0 END) AS pending,
             SUM(CASE WHEN left_at IS NOT NULL AND confirmed_at IS NULL THEN 1 ELSE 0 END) AS left_unconfirmed
           FROM session_operator_presence"""
    ).fetchone()
    confirm_secs = []
    for r in db.execute(
        """SELECT entered_at, confirmed_at FROM session_operator_presence
           WHERE confirmed_at IS NOT NULL"""
    ):
        ent = _parse_ts(r["entered_at"])
        conf = _parse_ts(r["confirmed_at"])
        if ent and conf and conf >= ent:
            confirm_secs.append(int((conf - ent).total_seconds()))
    avg_confirm = sum(confirm_secs) / len(confirm_secs) if confirm_secs else None

    # Full roster — every operator, even with zero assignments.
    roster_rows = db.execute(
        """SELECT o.operator_id, o.operator_name, o.employee_number, o.rtls_badge_id,
                  o.is_active,
                  COUNT(DISTINCT poa.session_id) AS sessions,
                  COUNT(DISTINCT poa.station_name) AS stations,
                  MAX(poa.assigned_at) AS last_assigned_at
           FROM operators o
           LEFT JOIN part_operator_assignments poa ON poa.operator_id = o.operator_id
           GROUP BY o.operator_id
           ORDER BY sessions DESC, o.operator_name"""
    ).fetchall()

    # Recent confirmed assignments (audit trail).
    recent = db.execute(
        """SELECT poa.assigned_at, o.operator_name, o.rtls_badge_id,
                  COALESCE(poa.station_name, st.station_name) AS station_name,
                  poa.zone_name, t.epc, s.dwell_seconds, s.session_status
           FROM part_operator_assignments poa
           JOIN operators o ON o.operator_id = poa.operator_id
           JOIN part_station_sessions s ON s.session_id = poa.session_id
           JOIN stations st ON st.station_id = s.station_id
           LEFT JOIN rfid_tags t ON t.tag_id = s.tag_id
           ORDER BY poa.assigned_at DESC
           LIMIT 30"""
    ).fetchall()

    # Multi-station operators (versatility) — all-time for context.
    multi = [
        o for o in all_time["leaderboard"]
        if o.get("stations_worked", 0) >= 2
    ]

    total_pres = int(pres["total"] or 0)
    confirmed_pres = int(pres["confirmed"] or 0)
    confirm_rate = round(100.0 * confirmed_pres / total_pres, 1) if total_pres else None

    today_by_id = {o["operator_id"]: o for o in base["leaderboard"]}

    return {
        **base,
        "summary": {
            **base["summary"],
            "scope": "today",
            "active_operators": len([
                z for z in in_zone
            ]) or base["summary"].get("active_operators", 0),
        },
        "presence": {
            "total_records":      total_pres,
            "confirmed":            confirmed_pres,
            "pending":              int(pres["pending"] or 0),
            "left_unconfirmed":     int(pres["left_unconfirmed"] or 0),
            "confirmation_rate":    confirm_rate,
            "avg_confirm_seconds":  round(avg_confirm, 1) if avg_confirm is not None else None,
            "avg_confirm_display":  _dwell_display(avg_confirm),
        },
        "currently_in_zone": [dict(r) for r in in_zone],
        "station_coverage": [
            {
                "station":          r["station_name"],
                "operator_count":   int(r["operator_count"]),
                "assignment_count": int(r["assignment_count"]),
                "session_count":    int(r["session_count"]),
            }
            for r in station_rows
        ],
        "assignments_by_hour": by_hour,
        "roster": [
            {
                "operator_id":      r["operator_id"],
                "operator_name":    r["operator_name"],
                "employee_number":  r["employee_number"],
                "rtls_badge_id":    r["rtls_badge_id"],
                "is_active":        bool(r["is_active"]),
                "sessions":         int(r["sessions"] or 0),
                "stations":         int(r["stations"] or 0),
                "last_assigned_at": r["last_assigned_at"],
                "parts_today":      (today_by_id.get(r["operator_id"]) or {}).get(
                    "completed_pieces", 0
                ),
                "stations_today":   (today_by_id.get(r["operator_id"]) or {}).get(
                    "stations_worked", 0
                ),
                "in_progress":      (today_by_id.get(r["operator_id"]) or {}).get(
                    "in_progress", 0
                ),
            }
            for r in roster_rows
        ],
        "recent_assignments": [
            {
                "assigned_at":    r["assigned_at"],
                "operator_name":  r["operator_name"],
                "rtls_badge_id":  r["rtls_badge_id"],
                "station_name":   r["station_name"],
                "zone_name":      r["zone_name"],
                "epc":            r["epc"],
                "dwell_seconds":  r["dwell_seconds"],
                "dwell_display":  _dwell_display(r["dwell_seconds"]),
                "session_status": r["session_status"],
            }
            for r in recent
        ],
        "multi_station_operators": multi,
    }


_ACTIVE_HOUR_MIN_SEC = 60  # need ≥1 min active time for parts/hour


def _parse_trends_range(args) -> tuple[datetime, datetime, str, str, bool]:
    """Return (start_utc, end_utc, date_from_iso, date_to_iso, all_time) local-date based.

    ``days=all`` (or ``0``) means all-time: start far in the past so filters include
    every row; callers should clamp ``date_from`` to the first day with data.
    """
    now_local = datetime.now().astimezone()
    date_to_s = (args.get("date_to") or "").strip()
    date_from_s = (args.get("date_from") or "").strip()
    days_raw = args.get("days")
    days_s = str(days_raw).strip().lower() if days_raw is not None else ""
    all_time = days_s in ("all", "0")
    days = None if all_time else args.get("days", type=int)

    if date_to_s:
        try:
            end_d = datetime.fromisoformat(date_to_s).date()
        except ValueError:
            end_d = now_local.date()
    else:
        end_d = now_local.date()

    if date_from_s:
        try:
            start_d = datetime.fromisoformat(date_from_s).date()
            all_time = False
        except ValueError:
            start_d = end_d - timedelta(days=max((days or 14) - 1, 0))
    elif all_time:
        start_d = end_d.replace(year=max(2000, end_d.year - 20))
    else:
        span = max((days or 14) - 1, 0)
        start_d = end_d - timedelta(days=span)

    if start_d > end_d:
        start_d, end_d = end_d, start_d

    start_local = datetime.combine(start_d, datetime.min.time(), tzinfo=now_local.tzinfo)
    end_local = datetime.combine(end_d, datetime.max.time(), tzinfo=now_local.tzinfo)
    return (
        start_local.astimezone(timezone.utc),
        end_local.astimezone(timezone.utc),
        start_d.isoformat(),
        end_d.isoformat(),
        all_time,
    )


def _ts_in_range(ts: str | None, start_utc: datetime, end_utc: datetime) -> bool:
    dt = _parse_ts(ts)
    if not dt:
        return False
    return start_utc <= dt <= end_utc


def _parts_per_active_hour(parts: int, active_seconds: float | None) -> float | None:
    if not active_seconds or active_seconds < _ACTIVE_HOUR_MIN_SEC:
        return None
    return round(parts / (active_seconds / 3600.0), 2)


def _metric_bundle(value, peer, *, kind: str) -> dict:
    delta = None
    delta_pct = None
    if value is not None and peer is not None:
        delta = round(value - peer, 2 if kind in ("rate", "pct") else 1)
        if peer != 0 and kind in ("rate", "count", "seconds"):
            delta_pct = round(100.0 * (value - peer) / abs(peer), 1)
        elif kind == "pct":
            delta_pct = round(value - peer, 1)

    def _fmt(v):
        if v is None:
            return None
        if kind == "seconds":
            return _dwell_display(v)
        if kind == "pct":
            return f"{v:.1f}%"
        if kind == "rate":
            return f"{v:.1f}"
        return str(int(v) if kind == "count" else v)

    delta_display = None
    if delta is not None:
        if kind == "seconds":
            if delta == 0:
                delta_display = "0"
            elif delta > 0:
                delta_display = f"+{_dwell_display(abs(int(delta)))}"
            else:
                delta_display = f"-{_dwell_display(abs(int(delta)))}"
        elif kind == "pct":
            sign = "+" if delta > 0 else ""
            delta_display = f"{sign}{delta:.1f} pts"
        elif kind == "rate":
            sign = "+" if delta > 0 else ""
            pct = f" ({sign}{delta_pct}%)" if delta_pct is not None else ""
            delta_display = f"{sign}{delta:.1f}{pct}"
        else:
            sign = "+" if delta > 0 else ""
            pct = f" ({sign}{delta_pct}%)" if delta_pct is not None else ""
            delta_display = f"{sign}{int(delta) if float(delta).is_integer() else delta}{pct}"

    return {
        "value": value,
        "peer": peer,
        "delta": delta,
        "delta_pct": delta_pct,
        "display": _fmt(value),
        "peer_display": _fmt(peer),
        "delta_display": delta_display,
    }


_WEEKDAY_LABELS = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")


def _build_operator_trends(db: sqlite3.Connection, args) -> dict:
    """Date-scoped operator trends vs station peers."""
    operator_id = args.get("operator_id", type=int)
    station_filter = (args.get("station") or "").strip() or None
    work_order = (args.get("work_order") or "").strip() or None
    part_type = (args.get("part_type") or "").strip() or None
    metric = (args.get("metric") or "parts_per_active_hour").strip()
    start_utc, end_utc, date_from, date_to, all_time = _parse_trends_range(args)

    specs = fetch_specs_by_name(db)

    op_row = None
    if operator_id:
        op_row = db.execute(
            "SELECT operator_id, operator_name, employee_number, rtls_badge_id, is_active "
            "FROM operators WHERE operator_id = ?",
            (operator_id,),
        ).fetchone()

    assign_rows = db.execute(
        """SELECT poa.operator_id, o.operator_name, o.rtls_badge_id,
                  poa.session_id, poa.assigned_at,
                  COALESCE(poa.station_name, st.station_name) AS station_name,
                  s.dwell_seconds, s.session_status, s.entry_time, s.exit_time,
                  t.epc, p.part_type, p.ibus_number, p.job_number
           FROM part_operator_assignments poa
           JOIN operators o ON o.operator_id = poa.operator_id
           JOIN part_station_sessions s ON s.session_id = poa.session_id
           JOIN stations st ON st.station_id = s.station_id
           LEFT JOIN rfid_tags t ON t.tag_id = s.tag_id
           LEFT JOIN parts p ON p.part_id = s.part_id"""
    ).fetchall()

    zone_rows = db.execute(
        """SELECT operator_id, station_name, entered_at, exited_at, dwell_seconds
           FROM operator_zone_visits
           WHERE station_name IS NOT NULL AND dwell_seconds IS NOT NULL"""
    ).fetchall()

    # Filter assignments into range (+ optional WO / part type).
    filtered = []
    for r in assign_rows:
        ts = r["exit_time"] or r["assigned_at"] or r["entry_time"]
        if not _ts_in_range(ts, start_utc, end_utc):
            continue
        if work_order:
            wo = (r["ibus_number"] or r["job_number"] or "").upper()
            if work_order.upper() not in wo and work_order.upper() not in (
                f"IBUS{(r['job_number'] or '')}"
            ).upper():
                continue
        if part_type and (r["part_type"] or "").lower() != part_type.lower():
            continue
        filtered.append(r)

    # Active seconds from zone visits (fallback: closed session dwells).
    def _active_seconds(oid: int, station: str | None, day=None) -> float:
        total = 0.0
        used_zone = False
        for z in zone_rows:
            if z["operator_id"] != oid:
                continue
            if station and (z["station_name"] or "") != station:
                continue
            ts = z["exited_at"] or z["entered_at"]
            if not _ts_in_range(ts, start_utc, end_utc):
                continue
            if day is not None and _local_date(ts) != day:
                continue
            total += float(z["dwell_seconds"] or 0)
            used_zone = True
        if used_zone:
            return total
        # Fallback: sum attributed closed part dwells
        for r in filtered:
            if r["operator_id"] != oid:
                continue
            if station and (r["station_name"] or "") != station:
                continue
            if r["session_status"] != STATUS_CLOSED:
                continue
            ts = r["exit_time"] or r["assigned_at"]
            if day is not None and _local_date(ts) != day:
                continue
            total += float(r["dwell_seconds"] or 0)
        return total

    def _op_station_stats(oid: int, station: str | None) -> dict:
        epcs: set[str] = set()
        sessions = 0
        dwells: list[int] = []
        over = 0
        days_active: set = set()
        by_day: dict = {}
        for r in filtered:
            if r["operator_id"] != oid:
                continue
            st = r["station_name"] or STATION_NAME
            if station and st != station:
                continue
            ts = r["exit_time"] or r["assigned_at"] or r["entry_time"]
            day = _local_date(ts)
            if day:
                days_active.add(day)
            if r["session_status"] != STATUS_CLOSED:
                continue
            sessions += 1
            epc = r["epc"] or f"session-{r['session_id']}"
            epcs.add(epc)
            dwell = int(r["dwell_seconds"]) if r["dwell_seconds"] is not None else None
            if dwell is not None:
                dwells.append(dwell)
                spec = _spec_for_station(specs, st)
                target = spec.get("target_part_dwell_seconds") if spec else None
                if target and dwell > int(target):
                    over += 1
            if day:
                bucket = by_day.setdefault(
                    day,
                    {"epcs": set(), "dwells": [], "over": 0, "sessions": 0, "station": st},
                )
                bucket["epcs"].add(epc)
                bucket["sessions"] += 1
                if dwell is not None:
                    bucket["dwells"].append(dwell)
                    spec = _spec_for_station(specs, st)
                    target = spec.get("target_part_dwell_seconds") if spec else None
                    if target and dwell > int(target):
                        bucket["over"] += 1

        parts = len(epcs)
        active = _active_seconds(oid, station)
        op_dwells = []
        for z in zone_rows:
            if z["operator_id"] != oid:
                continue
            if station and (z["station_name"] or "") != station:
                continue
            ts = z["exited_at"] or z["entered_at"]
            if not _ts_in_range(ts, start_utc, end_utc):
                continue
            if z["dwell_seconds"] is not None:
                op_dwells.append(int(z["dwell_seconds"]))
        if not op_dwells:
            op_dwells = list(dwells)

        over_pct = round(100.0 * over / sessions, 1) if sessions else None
        within_pct = round(100.0 * (sessions - over) / sessions, 1) if sessions else None
        return {
            "parts": parts,
            "sessions": sessions,
            "active_seconds": active,
            "parts_per_active_hour": _parts_per_active_hour(parts, active),
            "median_operator_dwell_seconds": _median(op_dwells),
            "median_part_dwell_seconds": _median(dwells),
            "parts_over_target_pct": over_pct,
            "within_target_pct": within_pct,
            "over_target": over,
            "active_days": len(days_active),
            "by_day": by_day,
            "days_active": days_active,
        }

    # Primary station = most attributed closed parts in range (any station).
    primary_station = station_filter
    if operator_id and not primary_station:
        counts: dict[str, int] = {}
        for r in filtered:
            if r["operator_id"] != operator_id or r["session_status"] != STATUS_CLOSED:
                continue
            st = r["station_name"] or STATION_NAME
            counts[st] = counts.get(st, 0) + 1
        if counts:
            primary_station = max(counts.items(), key=lambda x: x[1])[0]

    station = primary_station

    # Operators with activity at this station in range.
    peer_ids: set[int] = set()
    names: dict[int, str] = {}
    for r in filtered:
        st = r["station_name"] or STATION_NAME
        if station and st != station:
            continue
        peer_ids.add(r["operator_id"])
        names[r["operator_id"]] = r["operator_name"]

    peer_stats = {oid: _op_station_stats(oid, station) for oid in peer_ids}
    selected = peer_stats.get(operator_id) if operator_id else None
    if selected is None and operator_id:
        selected = _op_station_stats(operator_id, station)

    def _metric_value(st: dict) -> float | None:
        if metric == "parts":
            return float(st["parts"])
        if metric == "median_operator_dwell":
            return st["median_operator_dwell_seconds"]
        if metric == "median_part_dwell":
            return st["median_part_dwell_seconds"]
        if metric == "pct_within_target":
            return st["within_target_pct"]
        if metric == "active_time":
            return st["active_seconds"]
        if metric == "exception_rate":
            return st["parts_over_target_pct"]
        return st["parts_per_active_hour"]  # default

    peer_metric_vals = []
    for oid, st in peer_stats.items():
        if operator_id is not None and oid == operator_id:
            continue
        v = _metric_value(st)
        if v is not None:
            peer_metric_vals.append(v)
    peer_avg = (
        round(sum(peer_metric_vals) / len(peer_metric_vals), 2)
        if peer_metric_vals else None
    )
    peer_operator_count = sum(
        1 for oid in peer_ids if operator_id is None or oid != operator_id
    )

    # Summary uses fixed five metrics vs station peer averages of those metrics.
    def _peer_avg_of(key: str):
        vals = [
            st[key]
            for oid, st in peer_stats.items()
            if (operator_id is None or oid != operator_id) and st.get(key) is not None
        ]
        return round(sum(vals) / len(vals), 2) if vals else None

    sel = selected or {
        "parts": 0,
        "sessions": 0,
        "active_seconds": 0,
        "parts_per_active_hour": None,
        "median_operator_dwell_seconds": None,
        "parts_over_target_pct": None,
        "by_day": {},
        "active_days": 0,
    }

    summary = {
        "parts_per_active_hour": _metric_bundle(
            sel.get("parts_per_active_hour"),
            _peer_avg_of("parts_per_active_hour"),
            kind="rate",
        ),
        "median_operator_dwell_seconds": _metric_bundle(
            sel.get("median_operator_dwell_seconds"),
            _peer_avg_of("median_operator_dwell_seconds"),
            kind="seconds",
        ),
        "parts_over_target_pct": _metric_bundle(
            sel.get("parts_over_target_pct"),
            _peer_avg_of("parts_over_target_pct"),
            kind="pct",
        ),
        "active_station_seconds": _metric_bundle(
            sel.get("active_seconds"),
            _peer_avg_of("active_seconds"),
            kind="seconds",
        ),
        "rfid_associated_parts": _metric_bundle(
            sel.get("parts"),
            _peer_avg_of("parts"),
            kind="count",
        ),
    }

    def _day_metric(oid: int | None, day, day_b: dict | None) -> float | None:
        """Metric value for one operator on one calendar day at the selected station."""
        if oid is None:
            return None
        op_parts = len(day_b["epcs"]) if day_b else 0
        op_active = _active_seconds(oid, station, day)
        op_med = _median(day_b["dwells"]) if day_b and day_b["dwells"] else None
        op_over = day_b["over"] if day_b else 0
        if metric == "parts":
            return float(op_parts) if op_parts else None
        if metric == "median_operator_dwell":
            day_op_dwells = [
                int(z["dwell_seconds"])
                for z in zone_rows
                if z["operator_id"] == oid
                and (not station or z["station_name"] == station)
                and _local_date(z["exited_at"] or z["entered_at"]) == day
                and z["dwell_seconds"] is not None
            ]
            return _median(day_op_dwells) if day_op_dwells else op_med
        if metric == "median_part_dwell":
            return op_med
        if metric == "pct_within_target":
            sess = day_b["sessions"] if day_b else 0
            return round(100.0 * (sess - op_over) / sess, 1) if sess else None
        if metric == "active_time":
            return op_active if op_active else None
        if metric == "exception_rate":
            sess = day_b["sessions"] if day_b else 0
            return round(100.0 * op_over / sess, 1) if sess else None
        return _parts_per_active_hour(op_parts, op_active)

    # Clamp all-time date_from to first day with activity (keeps UI honest).
    activity_days = sorted({
        day
        for st in peer_stats.values()
        for day in (st.get("days_active") or set())
    })
    if all_time and activity_days:
        date_from = activity_days[0].isoformat()

    d0 = datetime.fromisoformat(date_from).date()
    d1 = datetime.fromisoformat(date_to).date()
    span_days = (d1 - d0).days + 1
    # Long ranges: calendar series is activity-only; short ranges fill every day.
    if all_time or span_days > 90:
        series_days = list(activity_days)
    else:
        series_days = []
        cur = d0
        while cur <= d1:
            series_days.append(cur)
            cur += timedelta(days=1)

    # Weekday averages sample every day that had station activity (any peer).
    scan_days = activity_days if activity_days else series_days

    op_weekday_vals: dict[int, list[float]] = {i: [] for i in range(7)}
    peer_weekday_vals: dict[int, list[float]] = {i: [] for i in range(7)}
    day_cache: dict = {}

    for day in scan_days:
        op_day = (sel.get("by_day") or {}).get(day)
        op_val = _day_metric(operator_id, day, op_day)
        peer_day_vals = []
        for oid, st in peer_stats.items():
            if operator_id and oid == operator_id:
                continue
            v = _day_metric(oid, day, (st.get("by_day") or {}).get(day))
            if v is not None:
                peer_day_vals.append(v)
        peer_val = (
            round(sum(peer_day_vals) / len(peer_day_vals), 2)
            if peer_day_vals else None
        )
        if op_val is not None:
            op_weekday_vals[day.weekday()].append(float(op_val))
        if peer_val is not None:
            peer_weekday_vals[day.weekday()].append(float(peer_val))
        day_cache[day] = {
            "op_day": op_day,
            "op_val": op_val,
            "peer_val": peer_val,
        }

    daily = []
    for day in series_days:
        cached = day_cache.get(day)
        if cached:
            op_day = cached["op_day"]
            op_val = cached["op_val"]
            peer_val = cached["peer_val"]
        else:
            op_day = (sel.get("by_day") or {}).get(day)
            op_val = _day_metric(operator_id, day, op_day)
            peer_day_vals = []
            for oid, st in peer_stats.items():
                if operator_id and oid == operator_id:
                    continue
                v = _day_metric(oid, day, (st.get("by_day") or {}).get(day))
                if v is not None:
                    peer_day_vals.append(v)
            peer_val = (
                round(sum(peer_day_vals) / len(peer_day_vals), 2)
                if peer_day_vals else None
            )
        op_parts = len(op_day["epcs"]) if op_day else 0
        op_active = _active_seconds(operator_id, station, day) if operator_id else 0
        op_med = _median(op_day["dwells"]) if op_day and op_day["dwells"] else None
        op_over = op_day["over"] if op_day else 0
        daily.append({
            "date": day.isoformat(),
            "label": day.strftime("%b %d"),
            "weekday": _WEEKDAY_LABELS[day.weekday()],
            "operator_value": op_val,
            "peer_value": peer_val,
            "parts": op_parts,
            "active_seconds": op_active,
            "over_target": op_over,
            "median_dwell_seconds": op_med,
        })

    by_weekday = []
    for wd in range(7):
        op_samples = op_weekday_vals[wd]
        peer_samples = peer_weekday_vals[wd]
        by_weekday.append({
            "weekday": wd,
            "label": _WEEKDAY_LABELS[wd],
            "operator_value": (
                round(sum(op_samples) / len(op_samples), 2) if op_samples else None
            ),
            "peer_value": (
                round(sum(peer_samples) / len(peer_samples), 2) if peer_samples else None
            ),
            "samples": len(op_samples),
            "peer_samples": len(peer_samples),
        })

    # Peer comparison bars for selected metric (include selected even if null → 0).
    peer_bars = []
    for oid, st in peer_stats.items():
        v = _metric_value(st)
        if v is None and metric == "parts_per_active_hour":
            # Still rank by parts when active time is too short for a rate.
            v = float(st.get("parts") or 0)
        if v is None:
            continue
        peer_bars.append({
            "operator_id": oid,
            "operator_name": names.get(oid, f"#{oid}"),
            "value": v,
            "is_selected": bool(operator_id and oid == operator_id),
            "is_median": False,
        })
    peer_bars.sort(key=lambda x: x["value"], reverse=True)
    med_vals = [p["value"] for p in peer_bars]
    if med_vals:
        station_median = _median_float(med_vals)
        insert_at = sum(1 for p in peer_bars if p["value"] > station_median)
        peer_bars.insert(insert_at, {
            "operator_id": None,
            "operator_name": "Station median",
            "value": round(station_median, 2),
            "is_selected": False,
            "is_median": True,
        })

    # Station breakdown for selected operator (all stations in range).
    stations_out = []
    if operator_id:
        st_names = sorted({
            (r["station_name"] or STATION_NAME)
            for r in filtered
            if r["operator_id"] == operator_id
        })
        for st_name in st_names:
            st = _op_station_stats(operator_id, st_name)
            stations_out.append({
                "station": st_name,
                "sessions": st["sessions"],
                "parts": st["parts"],
                "parts_per_active_hour": st["parts_per_active_hour"],
                "median_dwell_seconds": st["median_operator_dwell_seconds"],
                "median_dwell_display": _dwell_display(st["median_operator_dwell_seconds"]),
                "within_target_pct": st["within_target_pct"],
            })
        stations_out.sort(key=lambda s: s["parts"], reverse=True)

    # Daily history rows (operator × day × station). Prefer activity days so
    # all-time / long ranges do not emit empty calendar shells.
    history_days = list(reversed(activity_days if activity_days else series_days))
    days_out = []
    if operator_id:
        for day in history_days:
            by_st: dict[str, dict] = {}
            for r in filtered:
                if r["operator_id"] != operator_id or r["session_status"] != STATUS_CLOSED:
                    continue
                ts = r["exit_time"] or r["assigned_at"]
                if _local_date(ts) != day:
                    continue
                st = r["station_name"] or STATION_NAME
                if station and st != station:
                    continue
                b = by_st.setdefault(st, {"epcs": set(), "dwells": [], "over": 0})
                epc = r["epc"] or f"session-{r['session_id']}"
                b["epcs"].add(epc)
                if r["dwell_seconds"] is not None:
                    dwell = int(r["dwell_seconds"])
                    b["dwells"].append(dwell)
                    spec = _spec_for_station(specs, st)
                    target = spec.get("target_part_dwell_seconds") if spec else None
                    if target and dwell > int(target):
                        b["over"] += 1
            for st, b in by_st.items():
                parts = len(b["epcs"])
                active = _active_seconds(operator_id, st, day)
                days_out.append({
                    "date": day.isoformat(),
                    "label": day.strftime("%b %d"),
                    "weekday": _WEEKDAY_LABELS[day.weekday()],
                    "station": st,
                    "active_seconds": active,
                    "active_display": _dwell_display(active),
                    "parts": parts,
                    "parts_per_active_hour": _parts_per_active_hour(parts, active),
                    "median_dwell_seconds": _median(b["dwells"]),
                    "median_dwell_display": _dwell_display(_median(b["dwells"])),
                    "over_target": b["over"],
                })

    # Filter option lists
    wo_opts = sorted({
        (r["ibus_number"] or (f"IBUS{r['job_number']}" if r["job_number"] else None))
        for r in filtered
        if r["ibus_number"] or r["job_number"]
    } - {None})
    pt_opts = sorted({r["part_type"] for r in filtered if r["part_type"]})
    station_opts = sorted({
        (r["station_name"] or STATION_NAME) for r in filtered
    })

    return {
        "operator": {
            "operator_id": op_row["operator_id"] if op_row else operator_id,
            "operator_name": op_row["operator_name"] if op_row else None,
            "employee_number": op_row["employee_number"] if op_row else None,
            "rtls_badge_id": op_row["rtls_badge_id"] if op_row else None,
            "primary_station": primary_station,
            "active_days": sel.get("active_days", 0),
        } if operator_id else None,
        "filters": {
            "station": station,
            "date_from": date_from,
            "date_to": date_to,
            "all_time": all_time,
            "work_order": work_order,
            "part_type": part_type,
            "metric": metric,
            "compare": "station_average",
            "peer_count": peer_operator_count,
        },
        "filter_options": {
            "stations": station_opts,
            "work_orders": wo_opts,
            "part_types": pt_opts,
            "ranges": [
                {"id": "all", "label": "All time"},
                {"id": "7", "label": "1 week"},
                {"id": "14", "label": "2 weeks"},
                {"id": "30", "label": "30 days"},
                {"id": "90", "label": "90 days"},
            ],
            "operators": [
                {
                    "operator_id": r["operator_id"],
                    "operator_name": r["operator_name"],
                    "rtls_badge_id": r["rtls_badge_id"],
                }
                for r in db.execute(
                    "SELECT operator_id, operator_name, rtls_badge_id FROM operators "
                    "WHERE is_active = 1 ORDER BY operator_name"
                )
            ],
            "metrics": [
                {"id": "parts_per_active_hour", "label": "Parts per active hour"},
                {"id": "parts", "label": "Parts completed"},
                {"id": "median_operator_dwell", "label": "Median operator dwell"},
                {"id": "median_part_dwell", "label": "Median part dwell"},
                {"id": "pct_within_target", "label": "Percentage within target"},
                {"id": "active_time", "label": "Active time"},
                {"id": "exception_rate", "label": "Exception rate"},
            ],
        },
        "summary": summary,
        "by_weekday": by_weekday,
        "daily": daily,
        "peers": peer_bars,
        "stations": stations_out,
        "days": days_out,
        "peer_average": peer_avg,
    }


def _operator_trend_day_sessions(db: sqlite3.Connection, args) -> list[dict]:
    operator_id = args.get("operator_id", type=int)
    day_s = (args.get("date") or "").strip()
    station = (args.get("station") or "").strip() or None
    if not operator_id or not day_s:
        return []
    try:
        day = datetime.fromisoformat(day_s).date()
    except ValueError:
        return []

    rows = db.execute(
        """SELECT poa.session_id, poa.assigned_at,
                  COALESCE(poa.station_name, st.station_name) AS station_name,
                  poa.zone_name, t.epc, s.dwell_seconds, s.session_status,
                  s.entry_time, s.exit_time, p.part_type, p.ibus_number
           FROM part_operator_assignments poa
           JOIN part_station_sessions s ON s.session_id = poa.session_id
           JOIN stations st ON st.station_id = s.station_id
           LEFT JOIN rfid_tags t ON t.tag_id = s.tag_id
           LEFT JOIN parts p ON p.part_id = s.part_id
           WHERE poa.operator_id = ?
           ORDER BY COALESCE(s.exit_time, poa.assigned_at, s.entry_time) DESC""",
        (operator_id,),
    ).fetchall()

    out = []
    for r in rows:
        ts = r["exit_time"] or r["assigned_at"] or r["entry_time"]
        if _local_date(ts) != day:
            continue
        if station and (r["station_name"] or "") != station:
            continue
        out.append({
            "session_id": r["session_id"],
            "assigned_at": r["assigned_at"],
            "station_name": r["station_name"],
            "zone_name": r["zone_name"],
            "epc": r["epc"],
            "dwell_seconds": r["dwell_seconds"],
            "dwell_display": _dwell_display(r["dwell_seconds"]),
            "session_status": r["session_status"],
            "entry_time": r["entry_time"],
            "exit_time": r["exit_time"],
            "part_type": r["part_type"],
            "ibus_number": r["ibus_number"],
        })
    return out


@app.route("/api/analytics/operators/trends")
def analytics_operators_trends():
    db = get_db()
    data = _build_operator_trends(db, request.args)
    db.close()
    return jsonify(data)


@app.route("/api/analytics/operators/trends/sessions")
def analytics_operators_trends_sessions():
    db = get_db()
    sessions = _operator_trend_day_sessions(db, request.args)
    db.close()
    return jsonify({"sessions": sessions})


@app.route("/api/analytics/operators")
def analytics_operators():
    db = get_db()
    data = _build_operator_analytics_extended(db)
    db.close()
    return jsonify(data)


@app.route("/api/analytics/operators/<int:operator_id>")
def analytics_operator_detail(operator_id: int):
    db = get_db()
    row = db.execute(
        "SELECT operator_id, operator_name, employee_number, rtls_badge_id, is_active "
        "FROM operators WHERE operator_id = ?",
        (operator_id,),
    ).fetchone()
    if not row:
        db.close()
        return jsonify({"error": "Operator not found"}), 404

    base = _build_operator_analytics(db)
    stats = next(
        (o for o in base["leaderboard"] if o["operator_id"] == operator_id),
        None,
    )

    in_zone = db.execute(
        """SELECT ocz.station_name, ocz.zone_name, ocz.updated_at
           FROM operator_current_zone ocz
           WHERE ocz.operator_id = ? AND ocz.status = 'in'""",
        (operator_id,),
    ).fetchone()

    station_rows = db.execute(
        """SELECT COALESCE(poa.station_name, st.station_name) AS station_name,
                  COUNT(*) AS pieces,
                  COUNT(DISTINCT poa.session_id) AS sessions,
                  AVG(s.dwell_seconds) AS avg_dwell
           FROM part_operator_assignments poa
           JOIN part_station_sessions s ON s.session_id = poa.session_id
           JOIN stations st ON st.station_id = s.station_id
           WHERE poa.operator_id = ?
           GROUP BY COALESCE(poa.station_name, st.station_name)
           ORDER BY pieces DESC""",
        (operator_id,),
    ).fetchall()

    assign_ts = [
        r["assigned_at"]
        for r in db.execute(
            "SELECT assigned_at FROM part_operator_assignments "
            "WHERE operator_id = ? AND assigned_at IS NOT NULL",
            (operator_id,),
        )
    ]
    by_hour = _hourly_buckets_from_timestamps(assign_ts)

    recent = db.execute(
        """SELECT poa.assigned_at,
                  COALESCE(poa.station_name, st.station_name) AS station_name,
                  poa.zone_name, t.epc, s.dwell_seconds, s.session_status
           FROM part_operator_assignments poa
           JOIN part_station_sessions s ON s.session_id = poa.session_id
           JOIN stations st ON st.station_id = s.station_id
           LEFT JOIN rfid_tags t ON t.tag_id = s.tag_id
           WHERE poa.operator_id = ?
           ORDER BY poa.assigned_at DESC LIMIT 40""",
        (operator_id,),
    ).fetchall()

    pres = db.execute(
        """SELECT COUNT(*) AS total,
                  SUM(CASE WHEN confirmed_at IS NOT NULL THEN 1 ELSE 0 END) AS confirmed
           FROM session_operator_presence WHERE operator_id = ?""",
        (operator_id,),
    ).fetchone()

    zone_dwell_rows = db.execute(
        """SELECT station_name,
                  COUNT(*) AS visits,
                  SUM(COALESCE(dwell_seconds, 0)) AS total_dwell,
                  AVG(dwell_seconds) AS avg_dwell
           FROM operator_zone_visits
           WHERE operator_id = ? AND exited_at IS NOT NULL AND station_name IS NOT NULL
           GROUP BY station_name
           ORDER BY visits DESC""",
        (operator_id,),
    ).fetchall()

    recent_visits = db.execute(
        """SELECT station_name, zone_name, entered_at, exited_at,
                  dwell_seconds, source
           FROM operator_zone_visits
           WHERE operator_id = ?
           ORDER BY entered_at DESC LIMIT 60""",
        (operator_id,),
    ).fetchall()

    db.close()

    stations = []
    for r in station_rows:
        avg = r["avg_dwell"]
        stations.append({
            "station":           r["station_name"],
            "pieces":            int(r["pieces"]),
            "sessions":          int(r["sessions"]),
            "avg_dwell_seconds": round(float(avg), 1) if avg is not None else None,
            "avg_dwell_display": _dwell_display(avg),
        })

    return jsonify({
        "operator": dict(row),
        "stats": stats,
        "currently_in_zone": dict(in_zone) if in_zone else None,
        "stations": stations,
        "assignments_by_hour": by_hour,
        "recent_assignments": [
            {
                "assigned_at":    r["assigned_at"],
                "station_name":   r["station_name"],
                "zone_name":      r["zone_name"],
                "epc":            r["epc"],
                "dwell_seconds":  r["dwell_seconds"],
                "dwell_display":  _dwell_display(r["dwell_seconds"]),
                "session_status": r["session_status"],
            }
            for r in recent
        ],
        "presence": {
            "total":     int(pres["total"] or 0),
            "confirmed": int(pres["confirmed"] or 0),
        },
        "zone_dwell_by_station": [
            {
                "station":           r["station_name"],
                "visits":            int(r["visits"]),
                "total_dwell_seconds": int(r["total_dwell"] or 0),
                "total_dwell_display": _dwell_display(r["total_dwell"]),
                "avg_dwell_seconds": round(float(r["avg_dwell"]), 1) if r["avg_dwell"] is not None else None,
                "avg_dwell_display": _dwell_display(r["avg_dwell"]),
            }
            for r in zone_dwell_rows
        ],
        "zone_visits": [
            {
                "station_name":  r["station_name"],
                "zone_name":     r["zone_name"],
                "entered_at":    r["entered_at"],
                "exited_at":     r["exited_at"],
                "dwell_seconds": r["dwell_seconds"],
                "dwell_display": _dwell_display(r["dwell_seconds"]),
                "source":        r["source"],
            }
            for r in recent_visits
        ],
    })


def _build_parts_summary(db: sqlite3.Connection, completed: list) -> dict:
    """Part-level aggregates beyond per-session dwell stats."""
    epcs_closed = {r["epc"] for r in completed if r["epc"]}
    ibus_keys = set()
    type_counts: dict[str, int] = {}
    for r in completed:
        pt = r["part_type"] or "Unknown"
        type_counts[pt] = type_counts.get(pt, 0) + 1
        key = r["job_number"] or r["ibus_number"]
        if key:
            ibus_keys.add(key)

    all_sessions = db.execute(
        """SELECT epc, station_name, entry_time, exit_time, dwell_seconds, session_status
           FROM vw_live_part_status
           WHERE session_status = ?""",
        (STATUS_CLOSED,),
    ).fetchall()

    epc_acc: dict[str, dict] = {}
    for r in all_sessions:
        epc = r["epc"]
        if not epc:
            continue
        acc = epc_acc.setdefault(epc, {
            "stations": set(),
            "dwell_sum": 0,
            "entries":   [],
            "exits":     [],
        })
        acc["stations"].add(r["station_name"])
        if r["dwell_seconds"] is not None:
            acc["dwell_sum"] += int(r["dwell_seconds"])
        if r["entry_time"]:
            acc["entries"].append(r["entry_time"])
        if r["exit_time"]:
            acc["exits"].append(r["exit_time"])

    line_times = []
    for epc, acc in epc_acc.items():
        line_sec = acc["dwell_sum"]
        if acc["entries"] and acc["exits"]:
            entry_dt = min(_parse_ts(t) for t in acc["entries"] if _parse_ts(t))
            exit_dt = max(_parse_ts(t) for t in acc["exits"] if _parse_ts(t))
            if entry_dt and exit_dt and exit_dt > entry_dt:
                line_sec = int((exit_dt - entry_dt).total_seconds())
        line_times.append({
            "epc":                 epc,
            "stations_visited":    len(acc["stations"]),
            "total_line_seconds":  line_sec,
            "total_line_display":  _dwell_display(line_sec),
        })
    line_times.sort(key=lambda x: x["total_line_seconds"], reverse=True)
    top_line_times = line_times[:10]

    avg_stations = (
        sum(lt["stations_visited"] for lt in line_times) / len(line_times)
        if line_times else None
    )

    return {
        "unique_epcs_completed":  len(epcs_closed),
        "unique_ibus_orders":     len(ibus_keys),
        "avg_stations_per_part":  round(avg_stations, 1) if avg_stations is not None else None,
        "part_type_distribution": [
            {"part_type": k, "count": v}
            for k, v in sorted(type_counts.items(), key=lambda x: x[1], reverse=True)
        ],
        "longest_line_times": top_line_times,
    }


def _median(values: list[int]):
    if not values:
        return None
    s = sorted(values)
    n = len(s)
    mid = n // 2
    if n % 2:
        return float(s[mid])
    return (s[mid - 1] + s[mid]) / 2.0


def _median_float(values: list[float]):
    if not values:
        return None
    s = sorted(float(v) for v in values)
    n = len(s)
    mid = n // 2
    if n % 2:
        return s[mid]
    return (s[mid - 1] + s[mid]) / 2.0


def _percentile(values: list[int], pct: float):
    if not values:
        return None
    s = sorted(values)
    k = (len(s) - 1) * pct / 100.0
    lo = int(k)
    hi = min(lo + 1, len(s) - 1)
    if lo == hi:
        return float(s[lo])
    return s[lo] + (s[hi] - s[lo]) * (k - lo)


def _local_dt(ts: str | None) -> datetime | None:
    dt = _parse_ts(ts)
    return dt.astimezone() if dt else None


def _local_hour(ts: str | None) -> int | None:
    dt = _local_dt(ts)
    return dt.hour if dt else None


def _local_date(ts: str | None):
    dt = _local_dt(ts)
    return dt.date() if dt else None


def _in_analytics_period(ts: str | None, days: int | None) -> bool:
    if days is None:
        return True
    dt = _parse_ts(ts)
    if not dt:
        return False
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    return dt >= cutoff


def _hourly_buckets_from_timestamps(timestamps: list[str | None]) -> list[dict]:
    """Bucket timestamps into local wall-clock hours (fixes UTC strftime bug)."""
    counts = [0] * 24
    for ts in timestamps:
        h = _local_hour(ts)
        if h is not None:
            counts[h] += 1
    return [{"hour": h, "assignments": counts[h], "completed": counts[h]} for h in range(24)]


def _spec_for_station(specs_by_name: dict, station_name: str) -> dict | None:
    return specs_by_name.get(station_name) or specs_by_name.get(canonical_station(station_name) or "")


def _build_machine_analytics(
    db: sqlite3.Connection,
    specs_by_name: dict,
    days: int | None = None,
) -> list[dict]:
    """Per-station efficiency: dwell stats, throughput, WIP, vs targets."""
    now = datetime.now(timezone.utc)
    today = datetime.now().astimezone().date()
    one_hour_ago = now - timedelta(hours=1)

    wip_map: dict[str, int] = {}
    for r in db.execute(
        """SELECT COALESCE(st.station_name, ?) AS station_name, COUNT(*) AS c
           FROM part_station_sessions s
           JOIN stations st ON st.station_id = s.station_id
           WHERE s.session_status = ?
           GROUP BY st.station_name""",
        (STATION_NAME, STATUS_OPEN),
    ):
        wip_map[r["station_name"]] = int(r["c"])

    status_rows = db.execute(
        """SELECT st.station_name, s.session_status, s.dwell_seconds, s.exit_time,
                  s.entry_time, t.epc
           FROM part_station_sessions s
           JOIN stations st ON st.station_id = s.station_id
           LEFT JOIN rfid_tags t ON t.tag_id = s.tag_id"""
    ).fetchall()

    station_data: dict[str, dict] = {}
    repeat_pairs: dict[tuple[str, str], int] = {}
    epc_visits: dict[str, list[tuple[str, str]]] = {}

    for r in status_rows:
        name = r["station_name"] or STATION_NAME
        acc = station_data.setdefault(name, {
            "closed_dwells": [],
            "completed_epcs": set(),
            "completed_today_epcs": set(),
            "completed_last_hour_epcs": set(),
            "exit_only": 0,
            "abandoned": 0,
            "exceeding_target": 0,
            "exceeding_max": 0,
        })
        status = r["session_status"]
        spec = _spec_for_station(specs_by_name, name)
        target = spec.get("target_part_dwell_seconds") if spec else None
        max_dwell = spec.get("max_dwell_seconds") if spec else None
        epc = r["epc"] or ""

        if status == STATUS_CLOSED and r["dwell_seconds"] is not None:
            if not _in_analytics_period(r["exit_time"], days):
                pass
            else:
                dwell = int(r["dwell_seconds"])
                acc["closed_dwells"].append(dwell)
                if epc:
                    acc["completed_epcs"].add(epc)
                exit_local = _local_dt(r["exit_time"])
                if exit_local and exit_local.date() == today and epc:
                    acc["completed_today_epcs"].add(epc)
                exit_dt = _parse_ts(r["exit_time"])
                if exit_dt and exit_dt >= one_hour_ago and epc:
                    acc["completed_last_hour_epcs"].add(epc)
                if target and dwell > target:
                    acc["exceeding_target"] += 1
                if max_dwell and dwell > max_dwell:
                    acc["exceeding_max"] += 1
                if epc:
                    key = (epc, name)
                    repeat_pairs[key] = repeat_pairs.get(key, 0) + 1
                    epc_visits.setdefault(epc, []).append((name, r["entry_time"] or ""))
        elif status == STATUS_EXIT_ONLY:
            acc["exit_only"] += 1
        elif status == STATUS_ABANDONED:
            acc["abandoned"] += 1

    repeat_visits = sum(c - 1 for c in repeat_pairs.values() if c > 1)

    spine = progress_spine_names(specs_by_name)
    spine_idx = {
        canonical_station(s) or s: i
        for i, s in enumerate(spine)
    }
    skipped_parts = 0
    wrong_order_parts = 0
    for epc, visits in epc_visits.items():
        ordered = sorted(visits, key=lambda x: x[1])
        visited_indices = []
        prev_idx = -1
        for st_name, _ in ordered:
            canon = canonical_station(st_name) or st_name
            if canon not in spine_idx:
                continue
            idx = spine_idx[canon]
            if idx < prev_idx:
                wrong_order_parts += 1
                break
            prev_idx = max(prev_idx, idx)
            if idx not in visited_indices:
                visited_indices.append(idx)
        if visited_indices:
            max_idx = max(visited_indices)
            expected = set(range(max_idx + 1))
            if set(visited_indices) != expected:
                skipped_parts += 1

    seen_ids: set[int] = set()
    machines = []
    for spec in sorted(
        specs_by_name.values(),
        key=spine_sort_key,
    ):
        sid = spec["station_id"]
        if sid in seen_ids:
            continue
        seen_ids.add(sid)
        name = spec["station_name"]
        acc = station_data.get(name, {
            "closed_dwells": [], "completed_epcs": set(),
            "completed_today_epcs": set(), "completed_last_hour_epcs": set(),
            "exit_only": 0, "abandoned": 0,
            "exceeding_target": 0, "exceeding_max": 0,
        })
        dwells = acc["closed_dwells"]
        completed = len(acc["completed_epcs"])
        completed_today = len(acc["completed_today_epcs"])
        completed_last_hour = len(acc["completed_last_hour_epcs"])
        target = spec.get("target_part_dwell_seconds")
        target_pph = spec.get("target_pieces_per_hour")
        avg = sum(dwells) / len(dwells) if dwells else None
        med = _median(dwells)
        p90 = _percentile(dwells, 90)
        mn = min(dwells) if dwells else None
        mx = max(dwells) if dwells else None
        cmp_ = compare_to_target(avg, target)
        actual_pph = float(completed_last_hour) if completed_last_hour else None
        pph_cmp = (
            compare_to_target(actual_pph, int(target_pph))
            if actual_pph is not None and target_pph
            else {"vs_target_pct": None, "vs_target_status": None}
        )

        machines.append({
            "station_id":              sid,
            "station":                 name,
            "station_type":            spec.get("station_type"),
            "on_progress_spine":       bool(spec.get("on_progress_spine")),
            "progress_spine_index":    spec.get("progress_spine_index"),
            "in_process":              wip_map.get(name, 0),
            "completed":               completed,
            "completed_today":         completed_today,
            "completed_last_hour":     completed_last_hour,
            "exit_only":               acc["exit_only"],
            "abandoned":               acc["abandoned"],
            "exceeding_target":        acc["exceeding_target"],
            "exceeding_max":           acc["exceeding_max"],
            "avg_dwell_seconds":       round(avg, 1) if avg is not None else None,
            "avg_dwell_display":       _dwell_display(avg),
            "median_dwell_seconds":    med,
            "median_dwell_display":    _dwell_display(med),
            "p90_dwell_seconds":       round(p90, 1) if p90 is not None else None,
            "p90_dwell_display":       _dwell_display(p90),
            "min_dwell_seconds":       mn,
            "min_dwell_display":       _dwell_display(mn),
            "max_dwell_seconds":       mx,
            "max_dwell_display":       _dwell_display(mx),
            "target_part_dwell_seconds": target,
            "target_part_dwell_display": _dwell_display(target),
            "max_dwell_limit_seconds": spec.get("max_dwell_seconds"),
            "target_pieces_per_hour":    target_pph,
            "actual_pieces_per_hour":    actual_pph,
            "vs_target_pct":           cmp_["vs_target_pct"],
            "vs_target_status":        cmp_["vs_target_status"],
            "throughput_vs_target_pct": pph_cmp["vs_target_pct"],
            "throughput_vs_target_status": pph_cmp["vs_target_status"],
        })

    for m in machines:
        m["repeat_visits"] = repeat_visits
        m["skipped_parts"] = skipped_parts
        m["wrong_order_parts"] = wrong_order_parts

    machines.sort(
        key=lambda m: (
            not m.get("on_progress_spine"),
            m.get("progress_spine_index") if m.get("progress_spine_index") is not None else 99,
        ),
    )
    return machines


def _build_ibus_order_analytics(db: sqlite3.Connection, specs_by_name: dict) -> list[dict]:
    """Work-order progress: BOM expected vs RFID-completed parts."""
    spine = progress_spine_names(specs_by_name)
    # Prefer Insert Station when it is on the spine — later off-line machines
    # (e.g. Anderson) must not redefine "RFID complete".
    final_station = INSERT_STATION_NAME
    if spine:
        insert_canon = canonical_station(INSERT_STATION_NAME) or INSERT_STATION_NAME
        for name in spine:
            if (canonical_station(name) or name) == insert_canon or name == INSERT_STATION_NAME:
                final_station = name
                break
        else:
            final_station = spine[-1]

    orders = db.execute(
        "SELECT * FROM work_orders ORDER BY ingested_at DESC"
    ).fetchall()

    session_rows = db.execute(
        """SELECT v.epc, v.ibus_number, v.job_number, v.station_name,
                  v.session_status, v.dwell_seconds, v.entry_time, v.exit_time
           FROM vw_live_part_status v
           WHERE v.epc IS NOT NULL"""
    ).fetchall()

    ibus_acc: dict[str, dict] = {}
    for r in session_rows:
        key = (r["ibus_number"] or r["job_number"] or "").strip().upper()
        if not key:
            continue
        if not key.startswith("IBUS") and r["job_number"]:
            key = f"IBUS{r['job_number']}"
        acc = ibus_acc.setdefault(key, {
            "epcs": set(),
            "completed_epcs": set(),
            "open_epcs": set(),
            "stations_touched": set(),
            "dwell_sum": 0,
            "closed_count": 0,
            "entries": [],
            "exits": [],
        })
        epc = r["epc"]
        acc["epcs"].add(epc)
        st = r["station_name"] or ""
        acc["stations_touched"].add(st)
        if r["session_status"] == STATUS_CLOSED:
            acc["closed_count"] += 1
            if r["dwell_seconds"]:
                acc["dwell_sum"] += int(r["dwell_seconds"])
            acc["exits"].append(r["exit_time"])
            if st == final_station or canonical_station(st) == canonical_station(final_station):
                acc["completed_epcs"].add(epc)
        elif r["session_status"] == STATUS_OPEN:
            acc["open_epcs"].add(epc)
        if r["entry_time"]:
            acc["entries"].append(r["entry_time"])

    out = []
    seen_ibus: set[str] = set()
    for wo in orders:
        ibus = (wo["ibus_number"] or "").strip().upper()
        if not ibus or ibus in seen_ibus:
            continue
        seen_ibus.add(ibus)
        if HIDDEN_IBUS_ORDERS and ibus in HIDDEN_IBUS_ORDERS:
            continue

        comp_row = db.execute(
            """SELECT COUNT(*) AS total,
                      SUM(CASE WHEN status = 'complete' THEN 1 ELSE 0 END) AS bom_complete,
                      SUM(CASE WHEN status = 'in_process' THEN 1 ELSE 0 END) AS bom_in_process
               FROM work_order_components WHERE work_order_id = ?""",
            (wo["work_order_id"],),
        ).fetchone()
        bom_total = int(comp_row["total"] or 0)
        bom_complete = int(comp_row["bom_complete"] or 0)

        rfid = ibus_acc.get(ibus, {})
        expected = int(wo["parts_count"] or bom_total or 0)
        rfid_completed = len(rfid.get("completed_epcs", set()))
        rfid_unique = len(rfid.get("epcs", set()))
        rfid_in_progress = len(rfid.get("open_epcs", set()))
        completion_base = expected or rfid_unique or 1
        completion_pct = round(100.0 * rfid_completed / completion_base, 1) if completion_base else None
        bom_pct = round(100.0 * bom_complete / bom_total, 1) if bom_total else None

        entries = rfid.get("entries", [])
        exits = rfid.get("exits", [])
        cycle_sec = None
        if entries and exits:
            entry_dt = min(_parse_ts(t) for t in entries if _parse_ts(t))
            exit_dt = max(_parse_ts(t) for t in exits if _parse_ts(t))
            if entry_dt and exit_dt and exit_dt > entry_dt:
                cycle_sec = int((exit_dt - entry_dt).total_seconds())

        stations_done = len(rfid.get("stations_touched", set()) & set(spine))
        progress = round(stations_done / len(spine), 3) if spine else None

        out.append({
            "ibus_number":            ibus,
            "work_order":             wo["work_order"],
            "customer":               wo["customer"],
            "prod_date":              wo["prod_date"],
            "status":                 wo["status"],
            "expected_parts":         expected,
            "bom_total":              bom_total,
            "bom_complete":           bom_complete,
            "bom_in_process":         int(comp_row["bom_in_process"] or 0),
            "bom_completion_pct":     bom_pct,
            "rfid_completed":         rfid_completed,
            "rfid_unique_tags":       rfid_unique,
            "rfid_in_progress":       rfid_in_progress,
            "completion_pct":         completion_pct,
            "stations_done":          stations_done,
            "stations_total":         len(spine),
            "progress":               progress,
            "avg_cycle_seconds":      round(rfid["dwell_sum"] / rfid["closed_count"], 1) if rfid.get("closed_count") else None,
            "avg_cycle_display":      _dwell_display(rfid["dwell_sum"] / rfid["closed_count"]) if rfid.get("closed_count") else None,
            "total_cycle_seconds":      cycle_sec,
            "total_cycle_display":    _dwell_display(cycle_sec),
        })

    for key, rfid in ibus_acc.items():
        if key in seen_ibus or (HIDDEN_IBUS_ORDERS and key in HIDDEN_IBUS_ORDERS):
            continue
        if not rfid.get("epcs"):
            continue
        expected = len(rfid["epcs"])
        rfid_completed = len(rfid.get("completed_epcs", set()))
        out.append({
            "ibus_number":        key,
            "work_order":         None,
            "customer":           None,
            "prod_date":          None,
            "status":             "open" if rfid.get("open_epcs") else "completed",
            "expected_parts":     expected,
            "bom_total":          0,
            "bom_complete":       0,
            "bom_in_process":     0,
            "bom_completion_pct": None,
            "rfid_completed":     rfid_completed,
            "rfid_unique_tags":   expected,
            "rfid_in_progress":   len(rfid.get("open_epcs", set())),
            "completion_pct":     round(100.0 * rfid_completed / max(expected, 1), 1),
            "stations_done":      len(rfid.get("stations_touched", set()) & set(spine)),
            "stations_total":     len(spine),
            "progress":           round(len(rfid.get("stations_touched", set()) & set(spine)) / len(spine), 3) if spine else None,
            "avg_cycle_seconds":  None,
            "avg_cycle_display":  None,
            "total_cycle_seconds": None,
            "total_cycle_display": None,
        })

    out.sort(key=lambda o: (o["completion_pct"] or 0, o["rfid_completed"]), reverse=True)
    return out


@app.route("/api/analytics")
def analytics():
    db = get_db()
    days = request.args.get("days", type=int)

    counts = {STATUS_CLOSED: 0, STATUS_OPEN: 0, STATUS_EXIT_ONLY: 0, STATUS_ABANDONED: 0}
    for r in db.execute(
        "SELECT session_status, COUNT(*) AS c FROM part_station_sessions GROUP BY session_status"
    ):
        counts[r["session_status"]] = r["c"]
    total = sum(counts.values())

    completed = db.execute(
        """SELECT * FROM vw_live_part_status
           WHERE session_status = ? AND dwell_seconds IS NOT NULL""",
        (STATUS_CLOSED,),
    ).fetchall()
    if days is not None:
        completed = [r for r in completed if _in_analytics_period(r["exit_time"], days)]

    operators = _build_operator_analytics(db)
    parts_summary = _build_parts_summary(db, completed)
    specs_by_name = fetch_specs_by_name(db)
    machines = _build_machine_analytics(db, specs_by_name, days=days)
    ibus_orders = _build_ibus_order_analytics(db, specs_by_name)

    dwells = [int(r["dwell_seconds"]) for r in completed if r["dwell_seconds"] is not None]
    avg = sum(dwells) / len(dwells) if dwells else None
    med = _median(dwells)
    fastest = min(dwells) if dwells else None
    slowest = max(dwells) if dwells else None

    station_acc: dict[str, list[int]] = {}
    for r in completed:
        name = r["station_name"] or STATION_NAME
        if r["dwell_seconds"] is not None:
            station_acc.setdefault(name, []).append(int(r["dwell_seconds"]))
    stations = []
    for name, ds in station_acc.items():
        s_avg = sum(ds) / len(ds)
        spec = specs_by_name.get(name) or specs_by_name.get(canonical_station(name) or "")
        target = spec.get("target_part_dwell_seconds") if spec else None
        cmp_ = compare_to_target(s_avg, target)
        stations.append({
            "station":           name,
            "completed":         len(ds),
            "avg_dwell_seconds": round(s_avg, 1),
            "avg_dwell_display": _dwell_display(s_avg),
            "max_dwell_seconds": max(ds),
            "max_dwell_display": _dwell_display(max(ds)),
            "target_part_dwell_seconds": target,
            "target_part_dwell_display": _dwell_display(target),
            "vs_target_pct": cmp_["vs_target_pct"],
            "vs_target_status": cmp_["vs_target_status"],
        })
    stations.sort(key=lambda s: s["avg_dwell_seconds"], reverse=True)
    longest_station = stations[0] if stations else None

    day_counts: dict[str, int] = {}
    hour_counts = [0] * 24
    for r in completed:
        dt = _parse_ts(r["exit_time"])
        if not dt:
            continue
        local = dt.astimezone()
        key = local.strftime("%Y-%m-%d")
        day_counts[key] = day_counts.get(key, 0) + 1
        hour_counts[local.hour] += 1

    today = datetime.now()
    throughput_by_day = [
        {"date": (today - timedelta(days=i)).strftime("%Y-%m-%d"),
         "completed": day_counts.get((today - timedelta(days=i)).strftime("%Y-%m-%d"), 0)}
        for i in range(13, -1, -1)
    ]
    throughput_by_hour = [{"hour": h, "completed": hour_counts[h]} for h in range(24)]
    busiest_hour = None
    if any(hour_counts):
        bh = max(range(24), key=lambda h: hour_counts[h])
        busiest_hour = {"hour": bh, "completed": hour_counts[bh]}

    buckets = [
        ("< 1 min",   0,    60),
        ("1-5 min",   60,   300),
        ("5-15 min",  300,  900),
        ("15-30 min", 900,  1800),
        ("30-60 min", 1800, 3600),
        ("> 60 min",  3600, None),
    ]
    distribution = [
        {"label": label, "count": sum(1 for d in dwells if d >= lo and (hi is None or d < hi))}
        for label, lo, hi in buckets
    ]

    longest_parts = sorted(
        completed,
        key=lambda r: int(r["dwell_seconds"]) if r["dwell_seconds"] is not None else 0,
        reverse=True,
    )[:10]
    longest_parts = [{
        "epc":                r["epc"],
        "part_name":          r["part_name"],
        "part_type":          r["part_type"],
        "ibus_number":        r["ibus_number"],
        "work_order":         r["job_number"],
        "station_name":       r["station_name"],
        "dwell_seconds":      int(r["dwell_seconds"]),
        "dwell_time_display": _dwell_display(int(r["dwell_seconds"])),
        "exit_time":          r["exit_time"],
    } for r in longest_parts]

    completion_base = counts[STATUS_CLOSED] + counts[STATUS_ABANDONED] + counts[STATUS_EXIT_ONLY]
    completion_rate = (
        round(100.0 * counts[STATUS_CLOSED] / completion_base, 1)
        if completion_base else None
    )

    progress_spine = progress_spine_names(specs_by_name)
    bottleneck = max(machines, key=lambda m: m.get("avg_dwell_seconds") or 0) if machines else None
    total_exceeding = sum(m.get("exceeding_target", 0) for m in machines)
    db.close()

    return jsonify({
        "generated_at": _now_utc(),
        "period_days": days,
        "totals": {
            "total":       total,
            "complete":    counts[STATUS_CLOSED],
            "in_progress": counts[STATUS_OPEN],
            "exit_only":   counts[STATUS_EXIT_ONLY],
            "abandoned":   counts[STATUS_ABANDONED],
        },
        "completion_rate": completion_rate,
        "exceptions": {
            "exit_only":        counts[STATUS_EXIT_ONLY],
            "abandoned":        counts[STATUS_ABANDONED],
            "exceeding_target": total_exceeding,
            "repeat_visits":    machines[0]["repeat_visits"] if machines else 0,
            "skipped_parts":    machines[0]["skipped_parts"] if machines else 0,
            "wrong_order_parts": machines[0]["wrong_order_parts"] if machines else 0,
        },
        "dwell": {
            "avg_seconds":     round(avg, 1) if avg is not None else None,
            "avg_display":     _dwell_display(avg),
            "median_seconds":  med,
            "median_display":  _dwell_display(med),
            "fastest_seconds": fastest,
            "fastest_display": _dwell_display(fastest),
            "slowest_seconds": slowest,
            "slowest_display": _dwell_display(slowest),
            "sample_size":     len(dwells),
        },
        "stations":           stations,
        "machines":           machines,
        "ibus_orders":        ibus_orders,
        "bottleneck":         bottleneck,
        "longest_station":    longest_station,
        "throughput_by_day":  throughput_by_day,
        "throughput_by_hour": throughput_by_hour,
        "busiest_hour":       busiest_hour,
        "dwell_distribution": distribution,
        "longest_parts":      longest_parts,
        "operators":          operators,
        "parts_summary":      parts_summary,
        "progress_spine":     progress_spine,
        "progress_method":    "weighted",
    })


# ── Background DB polling (push socket updates on change) ──────────────────────

_bg_state = {"count": -1, "last_ts": ""}
_last_direct_emit: float = 0.0
_last_rfid_emit: float = 0.0
_RFID_EMIT_DEBOUNCE_SEC = 2.0


def _direct_emit(action: str, **extra) -> None:
    global _last_direct_emit
    # Live XY arrives many times per second — do not wake the whole dashboard.
    if action == "rtls_position":
        return
    _last_direct_emit = _time.time()
    ts = _now_utc()
    socketio.emit("rfid_update", {"ts": ts, "action": action})
    if action in ("rtls_zone", "rtls_presence", "rtls_zone_refresh"):
        sys.path.insert(0, str(Path(__file__).parent / "tracking"))
        from rtls_storage import sync_zone_presence_from_db
        sync_zone_presence_from_db()
        zone = extra.get("zone")
        if zone:
            socketio.emit("rtls_zone", {"ts": ts, "zone": zone})
        else:
            _emit_rtls_snapshot(ts)


def _emit_rtls_snapshot(ts: str) -> None:
    sys.path.insert(0, str(Path(__file__).parent / "tracking"))
    from rtls_storage import get_live_state
    live = get_live_state()
    socketio.emit("rtls_update", {
        "ts": ts,
        "connected": live.get("connected", False),
        "positions": [],
        "zone_presence": live.get("zone_presence", []),
    })


def _background_poll():
    while True:
        _time.sleep(1.5)
        try:
            db = get_db()
            row = db.execute(
                "SELECT COUNT(*), MAX(COALESCE(updated_at, entry_time, '')) "
                "FROM part_station_sessions"
            ).fetchone()
            reads = db.execute(
                "SELECT MAX(COALESCE(reader_timestamp, server_received_at, '')) "
                "FROM rfid_raw_reads"
            ).fetchone()
            db.close()
            count   = (row[0] or 0)
            last_ts = f"{row[1] or ''}|{reads[0] or ''}"
            if count != _bg_state["count"] or last_ts != _bg_state["last_ts"]:
                _bg_state["count"]   = count
                _bg_state["last_ts"] = last_ts
                now = _time.time()
                if now - _last_direct_emit > _RFID_EMIT_DEBOUNCE_SEC and now - _last_rfid_emit > _RFID_EMIT_DEBOUNCE_SEC:
                    _last_rfid_emit = now
                    socketio.emit("rfid_update",
                                  {"ts": datetime.now().isoformat(), "action": "db_change"})
        except Exception:
            pass


@app.route("/<path:filename>")
def serve_static(filename):
    """Serve dashboard static files (bobrick-logo.png, favicon, etc.). Must be last."""
    # Never let the SPA catch-all swallow API routes (e.g. missing route → opaque 404).
    if filename == "api" or filename.startswith("api/"):
        return jsonify({"error": f"Unknown API endpoint: /{filename}"}), 404
    if DASH_DIST.exists():
        p = DASH_DIST / filename
        if p.exists():
            return send_from_directory(str(DASH_DIST), filename)
    return jsonify({"error": "not found"}), 404


if __name__ == "__main__":
    print("=" * 50)
    print("RFID Tracking API Server")
    print("=" * 50)
    print(f"Database:  {DB_PATH}")
    print(f"Station:   {STATION_NAME}")
    print(f"Reader:    {READER_NAME}")
    print(f"API URL:   http://localhost:5001")
    if ENABLE_LIVE_INGESTION:
        print(f"RTLS:      Sewio live ingest ENABLED")
    else:
        print(f"RTLS:      Sewio live ingest DISABLED (ENABLE_LIVE_INGESTION in .env)")
    print("=" * 50)

    sys.path.insert(0, str(Path(__file__).parent / "tracking"))
    from rtls_storage import bootstrap_positions_from_rest, bootstrap_current_zones_from_rest, set_change_callback, start_presence_sweeper
    from sewio_client import start as start_sewio

    set_change_callback(_direct_emit)
    loaded = bootstrap_current_zones_from_rest()
    if loaded:
        print(f"  RTLS zone bootstrap: {loaded} operator(s) in zone")
    pos_loaded = bootstrap_positions_from_rest()
    if pos_loaded:
        print(f"  RTLS position bootstrap: {pos_loaded} operator(s) on map")
    start_presence_sweeper()
    start_sewio(on_log=lambda msg: print(f"  [RTLS] {msg}"))

    threading.Thread(target=_background_poll, daemon=True, name="db-poller").start()
    socketio.run(app, host="0.0.0.0", port=5001, debug=False, allow_unsafe_werkzeug=True)
