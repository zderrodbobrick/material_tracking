"""
REST API for RFID Tracking data.
Run: python api.py
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
from config import DB_PATH

DASH_DIST = Path(__file__).parent / "dashboard" / "dist"

app = Flask(__name__, static_folder=None)
CORS(app, origins="*")
socketio = SocketIO(app, cors_allowed_origins="*", async_mode="threading")


# ── DB helpers ────────────────────────────────────────────────────────────────

def get_db() -> sqlite3.Connection:
    conn = sqlite3.connect(str(DB_PATH), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA busy_timeout=5000")
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS tag_reads (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            "IBUS #" TEXT NOT NULL,
            dwell_seconds INTEGER,
            status TEXT NOT NULL DEFAULT 'IN_PROGRESS',
            first_enter_at_ant1 TEXT,
            first_enter_rssi_ant1 INTEGER,
            last_enter_at_ant1 TEXT,
            last_enter_rssi_ant1 INTEGER,
            first_exit_at_ant2 TEXT,
            first_exit_rssi_ant2 INTEGER,
            last_exit_at_ant2 TEXT,
            last_exit_rssi_ant2 INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_reads_ibus ON tag_reads("IBUS #");
        CREATE INDEX IF NOT EXISTS idx_reads_status ON tag_reads(status);
    """)
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


# ── Static / root ─────────────────────────────────────────────────────────────

@app.route("/")
def index():
    # Serve dashboard HTML only to browsers (Accept: text/html).
    # Python urllib / curl get the JSON index so tests can parse it.
    accept = request.headers.get("Accept", "")
    if DASH_DIST.exists() and "text/html" in accept:
        return send_from_directory(str(DASH_DIST), "index.html")
    return jsonify({
        "service": "RFID Tracking API",
        "RFID": True,
        "endpoints": [
            "POST /api/rfid/events",
            "GET  /api/gannomat/live-status",
            "GET  /api/gannomat/completed",
            "GET  /api/gannomat/alerts",
            "POST /api/gannomat/alerts/<id>/resolve",
            "GET  /api/gannomat/stats",
            "GET  /api/dashboard/summary",
            "GET  /api/report/stations",
            "GET  /api/report/sessions",
            "GET  /api/analytics",
            "GET  /api/sessions",
            "GET  /api/stats",
            "GET  /api/reads/recent",
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


# ── POST /api/rfid/events ─────────────────────────────────────────────────────

@app.route("/api/rfid/events", methods=["POST"])
def rfid_events():
    body = request.get_json(force=True, silent=True) or {}

    ibus = body.get("ibus_number")
    antenna = body.get("antenna_location")

    if not ibus:
        return jsonify({"error": "ibus_number is required"}), 422
    if antenna not in ("Entrance", "Exit"):
        return jsonify({"error": "antenna_location must be 'Entrance' or 'Exit'"}), 422

    epc = body.get("epc") or ibus
    station = body.get("station_name") or "Gannomat"
    reader_id = body.get("reader_id")
    antenna_id = body.get("antenna_id")
    read_time = body.get("read_time") or _now_utc()
    rssi = body.get("rssi")
    now_iso = _now_utc()

    db = get_db()

    # Insert raw event
    db.execute(
        """INSERT INTO rfid_events
               (epc, ibus_number, station_name, antenna_location,
                reader_id, antenna_id, read_time, rssi, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (epc, ibus, station, antenna,
         reader_id, str(antenna_id) if antenna_id is not None else None,
         read_time, rssi, now_iso),
    )
    db.commit()

    result = {}

    if antenna == "Entrance":
        open_sess = db.execute(
            """SELECT session_id, last_seen_time FROM station_sessions
               WHERE ibus_number = ? AND status = 'In Process'
               ORDER BY session_id DESC LIMIT 1""",
            (ibus,),
        ).fetchone()

        if open_sess:
            session_id = open_sess["session_id"]
            suppress = False
            lt = _parse_ts(open_sess["last_seen_time"])
            if lt and (datetime.now(timezone.utc) - lt).total_seconds() < 5:
                suppress = True

            db.execute(
                """UPDATE station_sessions
                   SET last_seen_time=?, last_antenna_location=?, last_rssi=?, updated_at=?
                   WHERE session_id=?""",
                (now_iso, antenna, rssi, now_iso, session_id),
            )
            db.commit()

            if suppress:
                result = {"action": "session_updated", "status": "suppressed", "session_id": session_id}
            else:
                result = {"action": "session_updated", "session_id": session_id}
        else:
            cur = db.execute(
                """INSERT INTO station_sessions
                       (ibus_number, epc, station_name, status,
                        entrance_time, last_seen_time, last_antenna_location,
                        last_rssi, alert_flag, created_at, updated_at)
                   VALUES (?, ?, ?, 'In Process', ?, ?, ?, ?, 0, ?, ?)""",
                (ibus, epc, station, read_time, now_iso, antenna, rssi, now_iso, now_iso),
            )
            db.commit()
            result = {"action": "session_created", "session_id": cur.lastrowid}

    else:  # Exit
        open_sess = db.execute(
            """SELECT session_id, entrance_time FROM station_sessions
               WHERE ibus_number = ? AND status = 'In Process'
               ORDER BY session_id DESC LIMIT 1""",
            (ibus,),
        ).fetchone()

        if open_sess:
            session_id = open_sess["session_id"]
            dwell = None
            ent_dt = _parse_ts(open_sess["entrance_time"])
            ext_dt = _parse_ts(read_time)
            if ent_dt and ext_dt:
                dwell = max(0, int((ext_dt - ent_dt).total_seconds()))

            db.execute(
                """UPDATE station_sessions
                   SET status='Completed', exit_time=?, dwell_time_seconds=?,
                       last_seen_time=?, last_antenna_location=?, last_rssi=?, updated_at=?
                   WHERE session_id=?""",
                (read_time, dwell, now_iso, antenna, rssi, now_iso, session_id),
            )
            db.commit()
            result = {
                "action": "session_completed",
                "session_id": session_id,
                "dwell_time_seconds": dwell,
            }
        else:
            cur = db.execute(
                """INSERT INTO station_sessions
                       (ibus_number, epc, station_name, status,
                        exit_time, last_seen_time, last_antenna_location,
                        last_rssi, alert_flag, created_at, updated_at)
                   VALUES (?, ?, ?, 'Missing Entrance', ?, ?, ?, ?, 1, ?, ?)""",
                (ibus, epc, station, read_time, now_iso, antenna, rssi, now_iso, now_iso),
            )
            session_id = cur.lastrowid
            db.commit()

            db.execute(
                """INSERT INTO station_alerts
                       (session_id, ibus_number, station_name,
                        alert_type, alert_message, severity, status, created_at)
                   VALUES (?, ?, ?, 'Missing Entrance', ?, 'High', 'Open', ?)""",
                (session_id, ibus, station,
                 f"Exit read for {ibus} with no prior entrance at {station}",
                 now_iso),
            )
            db.commit()
            result = {"action": "missing_entrance_alert", "session_id": session_id}

    db.close()
    _direct_emit(result.get("action", "db_change"))
    return jsonify(result), 201


# ── GET /api/gannomat/live-status ─────────────────────────────────────────────

@app.route("/api/gannomat/live-status")
def gannomat_live_status():
    db = get_db()
    rows = db.execute(
        """SELECT id, "IBUS #", status,
                  first_enter_at_ant1, last_enter_at_ant1, last_enter_rssi_ant1,
                  first_exit_at_ant2, dwell_seconds
           FROM tag_reads
           WHERE status IN ('IN_PROGRESS', 'EXIT_ONLY')
           ORDER BY COALESCE(first_enter_at_ant1, first_exit_at_ant2) ASC"""
    ).fetchall()
    db.close()
    return jsonify([{
        "id":                r["id"],
        "ibus_number":       r["IBUS #"],
        "status":            r["status"],
        "entrance_time":     r["first_enter_at_ant1"],
        "entrance_epoch_ms": _to_epoch_ms(r["first_enter_at_ant1"]),
        "last_seen":         r["last_enter_at_ant1"],
        "last_rssi":         r["last_enter_rssi_ant1"],
        "exit_time":         r["first_exit_at_ant2"],
        "last_exit_time":    r["first_exit_at_ant2"],
        "last_exit_rssi":    r["last_enter_rssi_ant1"],
        "dwell_seconds":     r["dwell_seconds"],
    } for r in rows])


# ── POST /api/sessions/<id>/end (manual session close) ───────────────────────

@app.route("/api/sessions/<int:session_id>/end", methods=["POST"])
def end_session(session_id):
    db = get_db()
    row = db.execute(
        "SELECT first_enter_at_ant1 FROM tag_reads WHERE id = ?", (session_id,)
    ).fetchone()
    if not row:
        db.close()
        return jsonify({"error": "Session not found"}), 404
    dwell = None
    start_dt = _parse_ts(row["first_enter_at_ant1"])
    if start_dt:
        dwell = int((datetime.now(timezone.utc) - start_dt).total_seconds())
    db.execute(
        "UPDATE tag_reads SET status='ABANDONED', dwell_seconds=? WHERE id=?",
        (dwell, session_id),
    )
    db.commit()
    db.close()
    _direct_emit("session_ended")
    return jsonify({"success": True, "dwell_seconds": dwell})


# ── GET /api/gannomat/completed ───────────────────────────────────────────────

@app.route("/api/gannomat/completed")
def gannomat_completed():
    limit = request.args.get("limit", 25, type=int)
    db = get_db()
    rows = db.execute(
        """SELECT id, "IBUS #", status,
                  first_enter_at_ant1, first_exit_at_ant2, dwell_seconds,
                  first_enter_rssi_ant1, last_exit_rssi_ant2
           FROM tag_reads
           WHERE status IN ('COMPLETE', 'ABANDONED', 'EXIT_ONLY')
           ORDER BY COALESCE(first_exit_at_ant2, last_enter_at_ant1) DESC
           LIMIT ?""",
        (limit,),
    ).fetchall()
    db.close()
    return jsonify([{
        "id":                 r["id"],
        "ibus_number":        r["IBUS #"],
        "status":             r["status"],
        "entrance_time":      r["first_enter_at_ant1"],
        "exit_time":          r["first_exit_at_ant2"],
        "dwell_seconds":      r["dwell_seconds"],
        "dwell_time_seconds": r["dwell_seconds"],
        "dwell_time_display": _dwell_display(r["dwell_seconds"]),
        "entry_rssi":         r["first_enter_rssi_ant1"],
        "exit_rssi":          r["last_exit_rssi_ant2"],
    } for r in rows])


# ── GET /api/gannomat/alerts ──────────────────────────────────────────────────

@app.route("/api/gannomat/alerts")
def gannomat_alerts():
    db = get_db()
    rows = db.execute(
        """SELECT alert_id, session_id, ibus_number, station_name,
                  alert_type, alert_message, severity, status, created_at, resolved_at
           FROM station_alerts
           WHERE status = 'Open'
           ORDER BY created_at DESC"""
    ).fetchall()
    db.close()
    return jsonify([dict(r) for r in rows])


# ── POST /api/gannomat/alerts/<id>/resolve ────────────────────────────────────

@app.route("/api/gannomat/alerts/<int:alert_id>/resolve", methods=["POST"])
def resolve_alert(alert_id):
    resolved_at = _now_utc()
    db = get_db()
    result = db.execute(
        "UPDATE station_alerts SET status='Resolved', resolved_at=? WHERE alert_id=?",
        (resolved_at, alert_id),
    )
    db.commit()
    db.close()
    if result.rowcount == 0:
        return jsonify({"error": "Alert not found"}), 404
    _direct_emit("alert_resolved")
    return jsonify({"status": "ok", "resolved_at": resolved_at})


# ── GET /api/gannomat/stats ───────────────────────────────────────────────────

@app.route("/api/gannomat/stats")
def gannomat_stats():
    today = datetime.now().strftime("%Y-%m-%d")
    db = get_db()

    in_process = db.execute(
        "SELECT COUNT(*) FROM tag_reads WHERE status='IN_PROGRESS'"
    ).fetchone()[0]

    completed_today = db.execute(
        "SELECT COUNT(*) FROM tag_reads WHERE status='COMPLETE' AND first_exit_at_ant2 >= ?",
        (today,),
    ).fetchone()[0]

    missing_exit = db.execute(
        "SELECT COUNT(*) FROM tag_reads WHERE status='EXIT_ONLY'"
    ).fetchone()[0]

    db.close()
    return jsonify({
        "parts_in_process":      in_process,
        "parts_completed_today": completed_today,
        "open_alerts":           0,
        "missing_exit_count":    missing_exit,
    })


# ── GET /api/dashboard/summary ────────────────────────────────────────────────

@app.route("/api/dashboard/summary")
def dashboard_summary():
    today = datetime.now().strftime("%Y-%m-%d")
    db = get_db()

    in_process = db.execute(
        "SELECT COUNT(*) FROM tag_reads WHERE status='IN_PROGRESS'"
    ).fetchone()[0]

    completed_today = db.execute(
        "SELECT COUNT(*) FROM tag_reads WHERE status='COMPLETE' AND first_exit_at_ant2 >= ?",
        (today,),
    ).fetchone()[0]

    avg_row = db.execute(
        "SELECT AVG(dwell_seconds) FROM tag_reads WHERE status='COMPLETE' AND first_exit_at_ant2 >= ?",
        (today,),
    ).fetchone()
    avg_dwell = avg_row[0] if avg_row else None

    last_read_row = db.execute(
        """SELECT MAX(COALESCE(last_enter_at_ant1, first_enter_at_ant1,
                               last_exit_at_ant2,  first_exit_at_ant2))
           FROM tag_reads"""
    ).fetchone()
    last_read = last_read_row[0] if last_read_row else None

    db.close()

    reader_status = "Waiting for Reads"
    if last_read:
        try:
            last_dt = _parse_ts(last_read)
            if last_dt:
                diff = (datetime.now(timezone.utc) - last_dt).total_seconds()
                reader_status = "Active" if diff < 60 else "No Recent Reads"
        except Exception:
            pass

    return jsonify({
        "parts_in_process":            in_process,
        "completed_today":             completed_today,
        "average_dwell_seconds_today": round(avg_dwell, 1) if avg_dwell else None,
        "average_dwell_display_today": _dwell_display(avg_dwell),
        "active_alerts":               0,
        "last_rfid_read_time":         last_read,
        "reader_status":               reader_status,
    })


# ── Legacy endpoints (tag_reads table) ───────────────────────────────────────

@app.route("/api/sessions")
def list_sessions():
    limit = request.args.get("limit", 50, type=int)
    db = get_db()
    rows = db.execute(
        """SELECT id, "IBUS #", first_enter_at_ant1, last_exit_at_ant2,
                  dwell_seconds, status
           FROM tag_reads ORDER BY first_enter_at_ant1 DESC LIMIT ?""",
        (limit,),
    ).fetchall()
    db.close()
    return jsonify([{
        "id": r["id"], "epc": r["IBUS #"],
        "entered": r["first_enter_at_ant1"], "exited": r["last_exit_at_ant2"],
        "dwell_seconds": r["dwell_seconds"], "status": r["status"],
    } for r in rows])


@app.route("/api/sessions/open")
def open_sessions():
    db = get_db()
    rows = db.execute(
        """SELECT id, "IBUS #", first_enter_at_ant1, last_enter_at_ant1, status
           FROM tag_reads WHERE status='IN_PROGRESS'
           ORDER BY COALESCE(first_enter_at_ant1, first_exit_at_ant2) DESC"""
    ).fetchall()
    db.close()
    return jsonify([{
        "id": r["id"], "epc": r["IBUS #"],
        "entered": r["first_enter_at_ant1"], "last_seen": r["last_enter_at_ant1"],
        "status": r["status"],
    } for r in rows])


@app.route("/api/sessions/<int:session_id>")
def get_session(session_id):
    db = get_db()
    row = db.execute("SELECT * FROM tag_reads WHERE id=?", (session_id,)).fetchone()
    db.close()
    if not row:
        return jsonify({"error": "Session not found"}), 404
    return jsonify(dict(row))


@app.route("/api/tag/<epc>")
def tag_history(epc):
    db = get_db()
    rows = db.execute(
        """SELECT id, first_enter_at_ant1, first_exit_at_ant2, dwell_seconds, status
           FROM tag_reads WHERE "IBUS #"=?
           ORDER BY COALESCE(first_enter_at_ant1, first_exit_at_ant2) DESC""",
        (epc,),
    ).fetchall()
    db.close()
    return jsonify({
        "epc": epc,
        "sessions": [{"id": r["id"], "entered": r["first_enter_at_ant1"],
                      "exited": r["first_exit_at_ant2"],
                      "dwell_seconds": r["dwell_seconds"], "status": r["status"]}
                     for r in rows],
        "count": len(rows),
    })


@app.route("/api/stats")
def stats():
    db = get_db()
    total     = db.execute("SELECT COUNT(*) FROM tag_reads").fetchone()[0]
    complete  = db.execute("SELECT COUNT(*) FROM tag_reads WHERE status='COMPLETE'").fetchone()[0]
    in_prog   = db.execute("SELECT COUNT(*) FROM tag_reads WHERE status='IN_PROGRESS'").fetchone()[0]
    avg_dwell = db.execute("SELECT AVG(dwell_seconds) FROM tag_reads WHERE dwell_seconds IS NOT NULL").fetchone()[0]
    db.close()
    return jsonify({
        "total_sessions": total, "complete": complete, "in_progress": in_prog,
        "avg_dwell_seconds": round(avg_dwell, 2) if avg_dwell else None,
        "reads_last_hour": total,
    })


@app.route("/api/reads/recent")
def recent_reads():
    limit = request.args.get("limit", 50, type=int)
    db = get_db()
    rows = db.execute(
        """SELECT "IBUS #", first_enter_at_ant1, first_enter_rssi_ant1, status
           FROM tag_reads
           ORDER BY COALESCE(first_enter_at_ant1, first_exit_at_ant2) DESC LIMIT ?""",
        (limit,),
    ).fetchall()
    db.close()
    return jsonify([{
        "IBUS #":                r["IBUS #"],
        "first_enter_at_ant1":   r["first_enter_at_ant1"],
        "first_enter_rssi_ant1": r["first_enter_rssi_ant1"],
        "status":                r["status"],
    } for r in rows])


# ── GET /api/report/stations ──────────────────────────────────────────────────
# Per-station rollup + the parts currently sitting at each station.
# tag_reads has no station column yet (single Gannomat line), so every part is
# attributed to DEFAULT_STATION. Structured this way so adding more stations /
# an operator column later only changes the grouping key.

DEFAULT_STATION = "Gannomat"


def _station_of(row) -> str:
    try:
        s = row["station_name"]
    except (IndexError, KeyError):
        s = None
    return s or DEFAULT_STATION


@app.route("/api/report/stations")
def report_stations():
    today = datetime.now().strftime("%Y-%m-%d")
    db = get_db()

    rows = db.execute(
        """SELECT id, "IBUS #", status,
                  first_enter_at_ant1, last_enter_at_ant1, last_enter_rssi_ant1,
                  first_exit_at_ant2, dwell_seconds
           FROM tag_reads
           ORDER BY COALESCE(first_enter_at_ant1, first_exit_at_ant2) DESC"""
    ).fetchall()
    db.close()

    stations: dict[str, dict] = {}

    def _bucket(name: str) -> dict:
        if name not in stations:
            stations[name] = {
                "station": name,
                "in_process": 0,
                "completed_today": 0,
                "completed_total": 0,
                "exit_only": 0,
                "abandoned": 0,
                "total": 0,
                "_dwells": [],
                "parts": [],   # parts currently at the station (live)
            }
        return stations[name]

    for r in rows:
        st = _bucket(_station_of(r))
        st["total"] += 1
        status = r["status"]

        if status == "IN_PROGRESS":
            st["in_process"] += 1
            st["parts"].append({
                "id":                r["id"],
                "ibus_number":       r["IBUS #"],
                "status":            status,
                "entrance_time":     r["first_enter_at_ant1"],
                "entrance_epoch_ms": _to_epoch_ms(r["first_enter_at_ant1"]),
                "last_seen":         r["last_enter_at_ant1"],
                "last_rssi":         r["last_enter_rssi_ant1"],
            })
        elif status == "EXIT_ONLY":
            st["exit_only"] += 1
            st["parts"].append({
                "id":                r["id"],
                "ibus_number":       r["IBUS #"],
                "status":            status,
                "entrance_time":     r["first_enter_at_ant1"],
                "entrance_epoch_ms": _to_epoch_ms(r["first_enter_at_ant1"]),
                "last_seen":         r["first_exit_at_ant2"],
                "last_rssi":         None,
            })
        elif status == "ABANDONED":
            st["abandoned"] += 1
        elif status == "COMPLETE":
            st["completed_total"] += 1
            if r["first_exit_at_ant2"] and r["first_exit_at_ant2"] >= today:
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
            "station": DEFAULT_STATION, "in_process": 0, "completed_today": 0,
            "completed_total": 0, "exit_only": 0, "abandoned": 0, "total": 0,
            "avg_dwell_seconds": None, "avg_dwell_display": None, "parts": [],
        })
    return jsonify({"stations": out})


# ── GET /api/report/sessions ──────────────────────────────────────────────────
# Full browsable view of the database with search / status filter / pagination.

@app.route("/api/report/sessions")
def report_sessions():
    limit  = min(request.args.get("limit", 100, type=int), 500)
    offset = max(request.args.get("offset", 0, type=int), 0)
    search = (request.args.get("search") or "").strip()
    status = (request.args.get("status") or "ALL").strip().upper()

    where = []
    params: list = []
    if search:
        where.append('"IBUS #" LIKE ?')
        params.append(f"%{search}%")
    if status and status != "ALL":
        where.append("status = ?")
        params.append(status)
    where_sql = ("WHERE " + " AND ".join(where)) if where else ""

    db = get_db()
    total = db.execute(
        f"SELECT COUNT(*) FROM tag_reads {where_sql}", params
    ).fetchone()[0]

    rows = db.execute(
        f"""SELECT id, "IBUS #", status,
                   first_enter_at_ant1, last_enter_at_ant1,
                   first_exit_at_ant2, last_exit_at_ant2,
                   dwell_seconds,
                   first_enter_rssi_ant1, last_exit_rssi_ant2
            FROM tag_reads
            {where_sql}
            ORDER BY COALESCE(first_enter_at_ant1, first_exit_at_ant2) DESC
            LIMIT ? OFFSET ?""",
        (*params, limit, offset),
    ).fetchall()
    db.close()

    return jsonify({
        "total":  total,
        "limit":  limit,
        "offset": offset,
        "sessions": [{
            "id":                 r["id"],
            "ibus_number":        r["IBUS #"],
            "station":            _station_of(r),
            "status":             r["status"],
            "entrance_time":      r["first_enter_at_ant1"],
            "last_seen":          r["last_enter_at_ant1"],
            "exit_time":          r["first_exit_at_ant2"],
            "last_exit_time":     r["last_exit_at_ant2"],
            "dwell_seconds":      r["dwell_seconds"],
            "dwell_time_display": _dwell_display(r["dwell_seconds"]),
            "entry_rssi":         r["first_enter_rssi_ant1"],
            "exit_rssi":          r["last_exit_rssi_ant2"],
        } for r in rows],
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

    # Status totals
    counts = {"COMPLETE": 0, "IN_PROGRESS": 0, "EXIT_ONLY": 0, "ABANDONED": 0}
    for r in db.execute("SELECT status, COUNT(*) AS c FROM tag_reads GROUP BY status"):
        counts[r["status"]] = r["c"]
    total = sum(counts.values())

    # All completed sessions with usable timestamps/dwell
    completed = db.execute(
        """SELECT "IBUS #" AS ibus, dwell_seconds, first_exit_at_ant2,
                  first_enter_at_ant1
           FROM tag_reads
           WHERE status = 'COMPLETE' AND dwell_seconds IS NOT NULL"""
    ).fetchall()
    db.close()

    dwells = [int(r["dwell_seconds"]) for r in completed]
    avg = sum(dwells) / len(dwells) if dwells else None
    med = _median(dwells)
    fastest = min(dwells) if dwells else None
    slowest = max(dwells) if dwells else None

    # Per-station rollup (single station for now → ready to expand)
    station_acc: dict[str, list[int]] = {}
    for r in completed:
        station_acc.setdefault(_station_of(r), []).append(int(r["dwell_seconds"]))
    stations = []
    for name, ds in station_acc.items():
        s_avg = sum(ds) / len(ds)
        stations.append({
            "station":            name,
            "completed":          len(ds),
            "avg_dwell_seconds":  round(s_avg, 1),
            "avg_dwell_display":  _dwell_display(s_avg),
            "max_dwell_seconds":  max(ds),
            "max_dwell_display":  _dwell_display(max(ds)),
        })
    stations.sort(key=lambda s: s["avg_dwell_seconds"], reverse=True)
    longest_station = stations[0] if stations else None

    # Throughput by calendar day (last 14 days) + hour-of-day distribution
    day_counts: dict[str, int] = {}
    hour_counts = [0] * 24
    for r in completed:
        dt = _parse_ts(r["first_exit_at_ant2"])
        if not dt:
            continue
        local = dt.astimezone()
        day_counts[local.strftime("%Y-%m-%d")] = day_counts.get(local.strftime("%Y-%m-%d"), 0) + 1
        hour_counts[local.hour] += 1

    today = datetime.now()
    throughput_by_day = []
    for i in range(13, -1, -1):
        d = (today - timedelta(days=i)).strftime("%Y-%m-%d")
        throughput_by_day.append({"date": d, "completed": day_counts.get(d, 0)})

    throughput_by_hour = [
        {"hour": h, "completed": hour_counts[h]} for h in range(24)
    ]
    busiest_hour = None
    if any(hour_counts):
        bh = max(range(24), key=lambda h: hour_counts[h])
        busiest_hour = {"hour": bh, "completed": hour_counts[bh]}

    # Dwell-time distribution buckets
    buckets = [
        ("< 1 min",    0,      60),
        ("1–5 min",    60,     300),
        ("5–15 min",   300,    900),
        ("15–30 min",  900,    1800),
        ("30–60 min",  1800,   3600),
        ("> 60 min",   3600,   None),
    ]
    distribution = []
    for label, lo, hi in buckets:
        n = sum(1 for d in dwells if d >= lo and (hi is None or d < hi))
        distribution.append({"label": label, "count": n})

    # Longest individual dwells (slowest parts)
    longest_parts = sorted(
        completed, key=lambda r: int(r["dwell_seconds"]), reverse=True
    )[:10]
    longest_parts = [{
        "ibus_number":        r["ibus"],
        "dwell_seconds":      int(r["dwell_seconds"]),
        "dwell_time_display": _dwell_display(r["dwell_seconds"]),
        "exit_time":          r["first_exit_at_ant2"],
    } for r in longest_parts]

    completion_base = counts["COMPLETE"] + counts["ABANDONED"] + counts["EXIT_ONLY"]
    completion_rate = (
        round(100.0 * counts["COMPLETE"] / completion_base, 1)
        if completion_base else None
    )

    return jsonify({
        "generated_at": _now_utc(),
        "totals": {
            "total":       total,
            "complete":    counts["COMPLETE"],
            "in_progress": counts["IN_PROGRESS"],
            "exit_only":   counts["EXIT_ONLY"],
            "abandoned":   counts["ABANDONED"],
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
    })


# ── Background DB polling ─────────────────────────────────────────────────────

_bg_state = {"count": -1, "last_ts": ""}
_last_direct_emit: float = 0.0


def _direct_emit(action: str) -> None:
    """Emit rfid_update from a request handler and suppress the poller for 2 s."""
    global _last_direct_emit
    _last_direct_emit = _time.time()
    socketio.emit("rfid_update", {"ts": _now_utc(), "action": action})


def _background_poll():
    """Poll every 0.5 s; emit rfid_update on any change in tag_reads."""
    while True:
        _time.sleep(0.5)
        try:
            db = get_db()
            row = db.execute(
                """SELECT COUNT(*),
                          MAX(COALESCE(last_enter_at_ant1, last_exit_at_ant2,
                                       first_enter_at_ant1, first_exit_at_ant2, ''))
                   FROM tag_reads"""
            ).fetchone()
            db.close()
            count   = row[0] or 0
            last_ts = row[1] or ""
            if count != _bg_state["count"] or last_ts != _bg_state["last_ts"]:
                _bg_state["count"]   = count
                _bg_state["last_ts"] = last_ts
                if _time.time() - _last_direct_emit > 2.0:
                    socketio.emit("rfid_update", {"ts": datetime.now().isoformat(), "action": "db_change"})
        except Exception:
            pass


if __name__ == "__main__":
    print("=" * 50)
    print("RFID Tracking API Server")
    print("=" * 50)
    print(f"Database: {DB_PATH}")
    print(f"API URL:  http://localhost:5001")
    print("=" * 50)
    threading.Thread(target=_background_poll, daemon=True, name="db-poller").start()
    socketio.run(app, host="0.0.0.0", port=5001, debug=False, allow_unsafe_werkzeug=True)
