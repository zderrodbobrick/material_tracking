"""
Zebra FX9600 - Tag Event Listener (HTTP mode)

The reader is configured to POST tag events to /tags on this server.
Events are persisted via DwellTracker into database/rfid_reads.db.

Usage:
    python listener.py            # run the HTTP listener
    python listener.py --health   # query a running listener's /healthz

Requirements:
    pip install flask
"""

import sys
import json
import re
import threading
from datetime import datetime, timezone

sys.path.insert(0, str(__file__).rsplit('\\', 2)[0])
from config import RSSI_MIN, EPC_FILTER_PATTERN, LISTENER_HOST, LISTENER_PORT
from storage import DwellTracker

# ── Helpers ───────────────────────────────────────────────────────────────────

def decode_epc(epc: str) -> str:
    try:
        return bytes.fromhex(epc).rstrip(b"\x00").decode("ascii", errors="replace")
    except Exception:
        return epc

def epc_matches_filter(epc: str) -> bool:
    if not EPC_FILTER_PATTERN:
        return True
    return re.fullmatch(EPC_FILTER_PATTERN, decode_epc(epc)) is not None

def ts():
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")

def divider(label=""):
    line = "=" * 50
    print(f"\n{line}")
    if label:
        print(f"  {label}")
        print(line)


# ══════════════════════════════════════════════════════════════════════════════
# MODE 1 — HTTP POST listener (reader pushes events to us)
# ══════════════════════════════════════════════════════════════════════════════

def run_http():
    import time
    from flask import Flask, request, jsonify

    app = Flask(__name__)
    tracker = DwellTracker()

    state = {
        "started_at":      time.time(),
        "last_event_at":   None,    # epoch seconds; None until first POST
        "events_total":    0,
        "batches_total":   0,
    }

    @app.route("/healthz", methods=["GET"])
    def healthz():
        now = time.time()
        # Confirm DB is writable by pinging it through the tracker.
        try:
            open_n = tracker.open_session_count()
            db_ok = True
        except Exception as exc:
            open_n = -1
            db_ok = False

        last_evt = state["last_event_at"]
        last_evt_ago = (now - last_evt) if last_evt is not None else None

        body = {
            "status":                  "ok" if db_ok else "degraded",
            "uptime_seconds":          int(now - state["started_at"]),
            "open_sessions":           open_n,
            "events_total":            state["events_total"],
            "batches_total":           state["batches_total"],
            "last_event_seconds_ago":  (
                int(last_evt_ago) if last_evt_ago is not None else None
            ),
            "db_writable":             db_ok,
        }
        return jsonify(body), (200 if db_ok else 503)

    @app.route("/tags", methods=["POST"])
    def receive_tags():
        raw = request.get_data(as_text=True)

        try:
            data = json.loads(raw)
            events = data if isinstance(data, list) else [data]

            def _passes_filters(ev):
                if not isinstance(ev, dict):
                    return False
                rssi = (ev.get("data") or {}).get("peakRssi")
                try:
                    if not (RSSI_MIN <= int(rssi) <= 0):
                        return False
                except (TypeError, ValueError):
                    return False
                epc = ((ev.get("data") or {}).get("idHex") or "").lower()
                if not epc_matches_filter(epc):
                    return False
                return True

            shown = [ev for ev in events if _passes_filters(ev)]

            # Only print tag reads (clean output)
            for ev in shown:
                d = ev.get("data", {})
                epc = d.get("idHex", "")
                antenna = d.get("antenna", 0)
                rssi = d.get("peakRssi", 0)
                epc_readable = decode_epc(epc)
                print(f"[{ts()}] Tag: {epc_readable} (hex:{epc[:16]}..) Ant{antenna} RSSI:{rssi}dBm")

            # Persist + dwell tracking
            summary = tracker.ingest_batch(events)
            state["batches_total"] += 1
            state["events_total"]  += len(events)
            state["last_event_at"]  = time.time()
            
            if summary['raw_inserted'] > 0 or summary['session_opened'] > 0:
                print(f"  DB: +{summary['raw_inserted']} reads, "
                      f"+{summary['session_opened']} sessions, "
                      f"+{summary['session_closed']} completed")

        except Exception as exc:
            print(f"\n  (body is not JSON or ingest failed: {exc})")

        return "OK", 200

    divider("Zebra FX9600 — HTTP Listener")
    print(f"\n  Listening on  http://{LISTENER_HOST}:{LISTENER_PORT}/tags")
    print(f"  Point the reader's HTTP POST target to:")
    print(f"  http://YOUR_PC_IP:{LISTENER_PORT}/tags")
    print(f"\n  Waiting for tag events...\n")
    app.run(host=LISTENER_HOST, port=LISTENER_PORT, debug=False)


# ══════════════════════════════════════════════════════════════════════════════
# MODE 2 — Health check client (queries a running listener)
# ══════════════════════════════════════════════════════════════════════════════

HEALTH_URL = f"http://127.0.0.1:{LISTENER_PORT}/healthz"

def run_health_check() -> int:
    """Hit /healthz on the running listener and print a readable summary.

    Returns a process exit code: 0 healthy, 1 degraded, 2 unreachable.
    """
    import urllib.request
    import urllib.error

    divider("Listener Health Check")
    print(f"\n  GET {HEALTH_URL}\n")

    try:
        with urllib.request.urlopen(HEALTH_URL, timeout=3) as resp:
            raw = resp.read().decode("utf-8")
            code = resp.getcode()
    except urllib.error.URLError as exc:
        print(f"  UNREACHABLE — is the listener running?")
        print(f"  Detail: {exc.reason}")
        return 2
    except Exception as exc:
        print(f"  UNREACHABLE — {exc}")
        return 2

    try:
        body = json.loads(raw)
    except Exception:
        print(f"  HTTP {code}, non-JSON body:\n{raw}")
        return 1

    status = body.get("status", "unknown")
    print(f"  Status              : {status.upper()}  (HTTP {code})")
    print(f"  Uptime (s)          : {body.get('uptime_seconds')}")
    print(f"  Open sessions       : {body.get('open_sessions')}")
    print(f"  Events total        : {body.get('events_total')}")
    print(f"  Batches total       : {body.get('batches_total')}")
    print(f"  Last event (s ago)  : {body.get('last_event_seconds_ago')}")
    print(f"  DB writable         : {body.get('db_writable')}")
    print()

    return 0 if status == "ok" else 1


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import logging
    
    # Check for verbose flag
    VERBOSE = "--verbose" in sys.argv or "-v" in sys.argv
    
    if "--health" in sys.argv:
        sys.exit(run_health_check())
    else:
        # Suppress Flask/Werkzeug request logging unless verbose
        if not VERBOSE:
            log = logging.getLogger('werkzeug')
            log.setLevel(logging.ERROR)  # Only show errors, not INFO logs
        
        run_http()