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
    ENTRY_ANTENNA, EXIT_ANTENNA,
    EXIT_IDLE_TIMEOUT_SEC,
    STATUS_OPEN, STATUS_CLOSED, STATUS_ABANDONED, STATUS_EXIT_ONLY,
    ENABLE_LIVE_INGESTION,
    SEWIO_API_KEY, SEWIO_REST_URL, SEWIO_VERIFY_SSL,
)
from database.migrate import run_migrations

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
    }


def _attach_operators(db: sqlite3.Connection, sessions: list[dict]) -> list[dict]:
    if not sessions:
        return sessions
    ids = [s["session_id"] for s in sessions]
    placeholders = ",".join("?" * len(ids))
    rows = db.execute(
        f"""SELECT poa.session_id, o.operator_name
            FROM part_operator_assignments poa
            JOIN operators o ON poa.operator_id = o.operator_id
            WHERE poa.session_id IN ({placeholders})
            ORDER BY poa.assigned_at DESC""",
        ids,
    ).fetchall()
    by_session: dict[int, str] = {}
    for row in rows:
        sid = row["session_id"]
        if sid not in by_session:
            by_session[sid] = row["operator_name"]
    for s in sessions:
        s["operator_name"] = by_session.get(s["session_id"])
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
            "GET  /api/raw-reads/recent",
            "GET  /api/summary",
            "GET  /api/analytics",
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
            "POST /api/sessions/<id>/end",
        ],
    })


@app.route("/assets/<path:filename>")
def serve_assets(filename):
    return send_from_directory(str(DASH_DIST / "assets"), filename)


@app.route("/<path:filename>")
def serve_static(filename):
    if DASH_DIST.exists():
        p = DASH_DIST / filename
        if p.exists():
            return send_from_directory(str(DASH_DIST), filename)
    return jsonify({"error": "not found"}), 404


# ── GET /api/live  (open sessions) ────────────────────────────────────────────

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
    _attach_operators(db, sessions)
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
        "exit_idle_timeout_sec":       EXIT_IDLE_TIMEOUT_SEC,
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
        out.append({
            "station": STATION_NAME, "in_process": 0, "completed_today": 0,
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
    limit  = min(request.args.get("limit", 100, type=int), 500)
    offset = max(request.args.get("offset", 0, type=int), 0)
    search = (request.args.get("search") or "").strip()
    status = (request.args.get("status") or "ALL").strip().upper()

    where = []
    params: list = []
    if search:
        where.append("(epc LIKE ? OR ibus_number LIKE ? OR part_name LIKE ?)")
        like = f"%{search}%"
        params.extend([like, like, like])
    if status and status != "ALL":
        db_status = _STATUS_ALIASES.get(status, status.lower())
        where.append("session_status = ?")
        params.append(db_status)
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
    db.close()

    return jsonify({
        "total":    total,
        "limit":    limit,
        "offset":   offset,
        "sessions": [_session_dict(r) for r in rows],
    })


# ── GET /api/analytics ────────────────────────────────────────────────────────

def _median(values: list[int]):
    if not values:
        return None
    s = sorted(values)
    n = len(s)
    mid = n // 2
    if n % 2:
        return float(s[mid])
    return (s[mid - 1] + s[mid]) / 2.0


@app.route("/api/analytics")
def analytics():
    db = get_db()

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
    db.close()

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
        stations.append({
            "station":           name,
            "completed":         len(ds),
            "avg_dwell_seconds": round(s_avg, 1),
            "avg_dwell_display": _dwell_display(s_avg),
            "max_dwell_seconds": max(ds),
            "max_dwell_display": _dwell_display(max(ds)),
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

    return jsonify({
        "generated_at": _now_utc(),
        "totals": {
            "total":       total,
            "complete":    counts[STATUS_CLOSED],
            "in_progress": counts[STATUS_OPEN],
            "exit_only":   counts[STATUS_EXIT_ONLY],
            "abandoned":   counts[STATUS_ABANDONED],
        },
        "completion_rate": completion_rate,
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
        "longest_station":    longest_station,
        "throughput_by_day":  throughput_by_day,
        "throughput_by_hour": throughput_by_hour,
        "busiest_hour":       busiest_hour,
        "dwell_distribution": distribution,
        "longest_parts":      longest_parts,
        "exit_idle_timeout_sec": EXIT_IDLE_TIMEOUT_SEC,
    })


# ── Background DB polling (push socket updates on change) ──────────────────────

_bg_state = {"count": -1, "last_ts": ""}
_last_direct_emit: float = 0.0


def _direct_emit(action: str) -> None:
    global _last_direct_emit
    _last_direct_emit = _time.time()
    socketio.emit("rfid_update", {"ts": _now_utc(), "action": action})


def _background_poll():
    while True:
        _time.sleep(0.5)
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
                if _time.time() - _last_direct_emit > 2.0:
                    socketio.emit("rfid_update",
                                  {"ts": datetime.now().isoformat(), "action": "db_change"})
        except Exception:
            pass


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
    print("=" * 50)

    sys.path.insert(0, str(Path(__file__).parent / "tracking"))
    from rtls_storage import set_change_callback
    from sewio_client import start as start_sewio

    set_change_callback(_direct_emit)
    start_sewio(on_log=lambda msg: print(f"  [RTLS] {msg}"))

    threading.Thread(target=_background_poll, daemon=True, name="db-poller").start()
    socketio.run(app, host="0.0.0.0", port=5001, debug=False, allow_unsafe_werkzeug=True)
