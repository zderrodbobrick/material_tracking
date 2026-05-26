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
import threading
from datetime import datetime, timezone

from storage import DwellTracker

# ── Helpers ───────────────────────────────────────────────────────────────────

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
        divider(f"Event received at {ts()}")

        # Headers
        print("\n  Headers:")
        for key, value in request.headers:
            print(f"    {key}: {value}")

        # Raw body
        raw = request.get_data(as_text=True)
        print(f"\n  Raw body:\n  {raw}")

        # Pretty-print if JSON
        try:
            data = json.loads(raw)
            print(f"\n  Parsed JSON:")
            print(json.dumps(data, indent=4))

            # Pull out tag reads if present (only for dict-shaped payloads)
            if isinstance(data, dict):
                tags = (
                    data.get("tag_reads")
                    or data.get("tagReads")
                    or data.get("data", {}).get("tagReads")
                    or []
                )
            else:
                tags = []
            if tags:
                print(f"\n  ── Tag summary ({len(tags)} read(s)) ──")
                for t in tags:
                    epc  = t.get("epc") or t.get("EPC") or t.get("idHex") or "unknown"
                    rssi = t.get("peakRssi") or t.get("rssi") or t.get("PeakRSSI") or "n/a"
                    ant  = t.get("antennaPort") or t.get("antenna") or "?"
                    print(f"    EPC: {epc}  |  RSSI: {rssi} dBm  |  Antenna: {ant}")

            # Persist + dwell tracking. The reader sends a top-level list of
            # events; tag_reads-style payloads are not used by FX9600 webhooks.
            events = data if isinstance(data, list) else [data]
            summary = tracker.ingest_batch(events)
            state["batches_total"] += 1
            state["events_total"]  += len(events)
            state["last_event_at"]  = time.time()
            print(
                f"\n  DB: tag_reads+{summary['raw_inserted']} "
                f"throttled={summary['raw_throttled']} "
                f"rejected={summary['raw_rejected']} "
                f"opened+{summary['session_opened']} "
                f"closed+{summary['session_closed']}"
            )

        except Exception as exc:
            print(f"\n  (body is not JSON or ingest failed: {exc})")

        return "OK", 200

    divider("Zebra FX9600 — HTTP Listener")
    print(f"\n  Listening on  http://0.0.0.0:5000/tags")
    print(f"  Point the reader's HTTP POST target to:")
    print(f"  http://YOUR_PC_IP:5000/tags")
    print(f"\n  Waiting for tag events...\n")
    app.run(host="0.0.0.0", port=5000, debug=False)


# ══════════════════════════════════════════════════════════════════════════════
# MODE 2 — Health check client (queries a running listener)
# ══════════════════════════════════════════════════════════════════════════════

HEALTH_URL = "http://127.0.0.1:5000/healthz"

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
    if "--health" in sys.argv:
        sys.exit(run_health_check())
    else:
        run_http()