"""
REST API for RFID Tracking data.
Run: python api.py
Access: http://localhost:5001
"""

import sys
import threading
import time as _time
from pathlib import Path
from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS
from flask_socketio import SocketIO, emit
from datetime import datetime, timedelta

sys.path.insert(0, str(Path(__file__).parent))
from config import DB_PATH, LISTENER_HOST

DASH_DIST = Path(__file__).parent / 'dashboard' / 'dist'

# Import storage functions if needed (from tracking module)
# from tracking.storage import DwellTracker

app = Flask(__name__, static_folder=None)
CORS(app, origins='*')  # Allow all origins for development
socketio = SocketIO(app, cors_allowed_origins='*', async_mode='threading')

# Reuse storage connection for queries
def get_db():
    import sqlite3
    conn = sqlite3.connect(DB_PATH)
    # Ensure tables exist
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

@app.route('/')
def index():
    if DASH_DIST.exists():
        return send_from_directory(str(DASH_DIST), 'index.html')
    return jsonify({
        "endpoints": [
            "/api/sessions - List recent sessions",
            "/api/sessions/<id> - Get session details",
            "/api/sessions/open - Currently open sessions",
            "/api/tag/<epc> - All sessions for a tag",
            "/api/stats - Summary statistics",
            "/api/reads/recent - Recent tag reads"
        ]
    })

@app.route('/assets/<path:filename>')
def serve_assets(filename):
    return send_from_directory(str(DASH_DIST / 'assets'), filename)

@app.route('/api/sessions')
def list_sessions():
    limit = request.args.get('limit', 50, type=int)
    db = get_db()
    rows = db.execute(
        """SELECT id, "IBUS #", first_enter_at_ant1, last_exit_at_ant2,
                   dwell_seconds, status
           FROM tag_reads
           ORDER BY first_enter_at_ant1 DESC
           LIMIT ?""", (limit,)
    ).fetchall()
    db.close()
    
    return jsonify([{
        "id": r[0],
        "epc": r[1],
        "entered": r[2],
        "exited": r[3],
        "dwell_seconds": r[4],
        "status": r[5]
    } for r in rows])

@app.route('/api/sessions/<int:session_id>')
def get_session(session_id):
    db = get_db()
    row = db.execute(
        """SELECT * FROM tag_reads WHERE id = ?""", (session_id,)
    ).fetchone()
    db.close()
    
    if not row:
        return jsonify({"error": "Session not found"}), 404
    
    return jsonify({
        "id": row[0],
        "IBUS #": row[1],
        "dwell_seconds": row[2],
        "status": row[3],
        "first_enter_at_ant1": row[4],
        "first_enter_rssi_ant1": row[5],
        "last_enter_at_ant1": row[6],
        "last_enter_rssi_ant1": row[7],
        "first_exit_at_ant2": row[8],
        "first_exit_rssi_ant2": row[9],
        "last_exit_at_ant2": row[10],
        "last_exit_rssi_ant2": row[11]
    })

@app.route('/api/sessions/open')
def open_sessions():
    db = get_db()
    rows = db.execute(
        """SELECT id, "IBUS #", first_enter_at_ant1, last_enter_at_ant1, status
           FROM tag_reads
           WHERE status = 'IN_PROGRESS'
           ORDER BY COALESCE(first_enter_at_ant1, first_exit_at_ant2) DESC"""
    ).fetchall()
    db.close()
    
    return jsonify([{
        "id": r[0],
        "epc": r[1],
        "entered": r[2],
        "last_seen": r[3],
        "status": r[4]
    } for r in rows])

@app.route('/api/tag/<epc>')
def tag_history(epc):
    db = get_db()
    rows = db.execute(
        """SELECT id, first_enter_at_ant1, first_exit_at_ant2,
                   dwell_seconds, status
           FROM tag_reads
           WHERE "IBUS #" = ?
           ORDER BY COALESCE(first_enter_at_ant1, first_exit_at_ant2) DESC""", (epc,)
    ).fetchall()
    db.close()
    
    return jsonify({
        "epc": epc,
        "sessions": [{
            "id": r[0],
            "entered": r[1],
            "exited": r[2],
            "dwell_seconds": r[3],
            "status": r[4]
        } for r in rows],
        "count": len(rows)
    })

@app.route('/api/stats')
def stats():
    db = get_db()
    total = db.execute("SELECT COUNT(*) FROM tag_reads").fetchone()[0]
    complete = db.execute(
        "SELECT COUNT(*) FROM tag_reads WHERE status = 'COMPLETE'"
    ).fetchone()[0]
    open_count = db.execute(
        "SELECT COUNT(*) FROM tag_reads WHERE status = 'IN_PROGRESS'"
    ).fetchone()[0]
    avg_dwell = db.execute(
        "SELECT AVG(dwell_seconds) FROM tag_reads WHERE dwell_seconds IS NOT NULL"
    ).fetchone()[0]
    recent_reads = total
    db.close()
    
    return jsonify({
        "total_sessions": total,
        "complete": complete,
        "in_progress": open_count,
        "avg_dwell_seconds": round(avg_dwell, 2) if avg_dwell else None,
        "reads_last_hour": recent_reads
    })

@app.route('/api/reads/recent')
def recent_reads():
    limit = request.args.get('limit', 50, type=int)
    seconds = request.args.get('seconds', 60, type=int)  # Default: last 60 seconds
    db = get_db()
    
    rows = db.execute(
        """SELECT "IBUS #", first_enter_at_ant1, first_enter_rssi_ant1, status
           FROM tag_reads
           ORDER BY COALESCE(first_enter_at_ant1, first_exit_at_ant2) DESC
           LIMIT ?""", (limit,)
    ).fetchall()
    db.close()
    
    return jsonify([{
        "IBUS #": r[0],
        "first_enter_at_ant1": r[1],
        "first_enter_rssi_ant1": r[2],
        "status": r[3]
    } for r in rows])

# ── New dashboard endpoints ───────────────────────────────────────────────────

@app.route('/api/dashboard/summary')
def dashboard_summary():
    today = datetime.now().strftime('%Y-%m-%d')
    db = get_db()

    in_process = db.execute(
        "SELECT COUNT(*) FROM tag_reads WHERE status = 'IN_PROGRESS'"
    ).fetchone()[0]

    completed_today = db.execute(
        "SELECT COUNT(*) FROM tag_reads "
        "WHERE status = 'COMPLETE' AND last_exit_at_ant2 >= ?",
        (today,)
    ).fetchone()[0]

    avg_row = db.execute(
        "SELECT AVG(dwell_seconds) FROM tag_reads "
        "WHERE status = 'COMPLETE' AND last_exit_at_ant2 >= ?",
        (today,)
    ).fetchone()
    avg_dwell = avg_row[0] if avg_row else None

    last_read_row = db.execute(
        """SELECT MAX(COALESCE(last_enter_at_ant1, last_exit_at_ant2,
                               first_enter_at_ant1, first_exit_at_ant2))
           FROM tag_reads"""
    ).fetchone()
    last_read = last_read_row[0] if last_read_row else None
    db.close()

    reader_status = "Waiting for Reads"
    if last_read:
        try:
            last_dt = datetime.fromisoformat(last_read.replace('Z', ''))
            diff = (datetime.now() - last_dt.replace(tzinfo=None)).total_seconds()
            reader_status = "Active" if diff < 60 else "No Recent Reads"
        except Exception:
            pass

    avg_display = None
    if avg_dwell:
        m, s = divmod(int(avg_dwell), 60)
        avg_display = f"{m} min {s} sec" if m else f"{s} sec"

    return jsonify({
        "parts_in_process":            in_process,
        "completed_today":             completed_today,
        "average_dwell_seconds_today": round(avg_dwell, 1) if avg_dwell else None,
        "average_dwell_display_today": avg_display,
        "active_alerts":               0,
        "last_rfid_read_time":         last_read,
        "reader_status":               reader_status,
    })


@app.route('/api/gannomat/live-status')
def gannomat_live_status():
    db = get_db()
    rows = db.execute(
        """SELECT id, "IBUS #", status,
                  first_enter_at_ant1, last_enter_at_ant1, last_enter_rssi_ant1,
                  first_exit_at_ant2,  last_exit_at_ant2,  last_exit_rssi_ant2,
                  dwell_seconds
           FROM tag_reads
           WHERE status IN ('IN_PROGRESS', 'EXIT_ONLY')
           ORDER BY COALESCE(first_enter_at_ant1, first_exit_at_ant2) ASC"""
    ).fetchall()
    db.close()
    def _to_epoch_ms(iso_str):
        if not iso_str:
            return None
        try:
            from datetime import datetime, timezone
            v = iso_str.strip()
            if len(v) >= 5 and (v[-5] in '+-') and v[-3] != ':':
                v = v[:-2] + ':' + v[-2:]
            dt = datetime.fromisoformat(v)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return int(dt.timestamp() * 1000)
        except Exception:
            return None

    return jsonify([{
        "id":              r[0],
        "ibus_number":     r[1],
        "status":          r[2],
        "entrance_time":   r[3],
        "entrance_epoch_ms": _to_epoch_ms(r[3]),
        "last_seen":       r[4],
        "last_rssi":       r[5],
        "exit_time":       r[6],
        "last_exit_time":  r[7],
        "last_exit_rssi":  r[8],
        "dwell_seconds":   r[9],
    } for r in rows])


@app.route('/api/sessions/<int:session_id>/end', methods=['POST'])
def end_session(session_id):
    db = get_db()
    row = db.execute(
        "SELECT first_enter_at_ant1 FROM tag_reads WHERE id = ?",
        (session_id,)
    ).fetchone()
    if not row:
        db.close()
        return jsonify({"error": "Session not found"}), 404
    dwell = None
    if row[0]:
        try:
            from datetime import datetime, timezone
            v = row[0].strip()
            if len(v) >= 5 and v[-5] in '+-' and v[-3] != ':':
                v = v[:-2] + ':' + v[-2:]
            start_dt = datetime.fromisoformat(v)
            if start_dt.tzinfo is None:
                start_dt = start_dt.replace(tzinfo=timezone.utc)
            dwell = int((datetime.now(timezone.utc) - start_dt).total_seconds())
        except Exception:
            pass
    db.execute(
        "UPDATE tag_reads SET status = 'ABANDONED', dwell_seconds = ? WHERE id = ?",
        (dwell, session_id)
    )
    db.commit()
    db.close()
    return jsonify({"success": True, "dwell_seconds": dwell})


@app.route('/api/gannomat/completed')
def gannomat_completed():
    db = get_db()
    rows = db.execute(
        """SELECT id, "IBUS #", status,
                  first_enter_at_ant1, last_exit_at_ant2,
                  dwell_seconds,
                  first_enter_rssi_ant1, last_exit_rssi_ant2
           FROM tag_reads
           WHERE status IN ('COMPLETE', 'ABANDONED', 'EXIT_ONLY')
           ORDER BY COALESCE(last_exit_at_ant2, last_enter_at_ant1) DESC
           LIMIT 25"""
    ).fetchall()
    db.close()
    return jsonify([{
        "id":            r[0],
        "ibus_number":   r[1],
        "status":        r[2],
        "entrance_time": r[3],
        "exit_time":     r[4],
        "dwell_seconds": r[5],
        "entry_rssi":    r[6],
        "exit_rssi":     r[7],
    } for r in rows])


# ── Background DB polling — emit rfid_update when data changes ────────────────

_bg_state = {"count": -1, "last_ts": ""}


def _background_poll():
    """Poll every 0.5 s; emit rfid_update when tag_reads changes."""
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
            count = row[0] if row else -1
            last_ts = (row[1] or "") if row else ""
            if count != _bg_state["count"] or last_ts != _bg_state["last_ts"]:
                _bg_state["count"] = count
                _bg_state["last_ts"] = last_ts
                socketio.emit('rfid_update', {"ts": datetime.now().isoformat()})
        except Exception:
            pass


if __name__ == '__main__':
    print("=" * 50)
    print("RFID Tracking API Server")
    print("=" * 50)
    print(f"Database: {DB_PATH}")
    print(f"API URL:  http://localhost:5001")
    print(f"Docs:     http://localhost:5001/")
    print("=" * 50)
    threading.Thread(target=_background_poll, daemon=True, name="db-poller").start()
    socketio.run(app, host='0.0.0.0', port=5001, debug=False, allow_unsafe_werkzeug=True)
