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
from config import (
    RSSI_MIN, EPC_FILTER_PATTERN, LISTENER_HOST, LISTENER_PORT,
    STATION_NAME, READER_NAME,
    ENTRY_ANTENNA, EXIT_ANTENNA, THIRD_ANTENNA, THIRD_ANTENNA_NAME,
)
from storage import DwellTracker
from epc_type_map import format_tag_id, parse_tag_id

# ── Helpers ───────────────────────────────────────────────────────────────────

def decode_epc(epc: str) -> str:
    try:
        raw = bytes.fromhex(epc).rstrip(b"\x00").decode("ascii", errors="replace")
    except Exception:
        raw = epc
    return format_tag_id(raw)

def epc_matches_filter(epc: str) -> bool:
    decoded = decode_epc(epc)
    if not parse_tag_id(decoded)["is_known"]:
        return False
    if not EPC_FILTER_PATTERN:
        return True
    return re.fullmatch(EPC_FILTER_PATTERN, decoded) is not None

def ts():
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")

def divider(label=""):
    line = "=" * 50
    print(f"\n{line}")
    if label:
        print(f"  {label}")
        print(line)


def _antenna_role(port: int) -> str:
    if port == ENTRY_ANTENNA:
        return "Entry"
    if port == EXIT_ANTENNA:
        return "Exit"
    if port == THIRD_ANTENNA:
        return THIRD_ANTENNA_NAME
    return "Unknown"


def _antenna_label(port: int) -> str:
    role = _antenna_role(port)
    return f"Ant{port} ({role})"


def _tag_detail(epc_readable: str) -> str:
    p = parse_tag_id(epc_readable)
    if p["is_known"]:
        return (
            f"Qty:{p['qty']}  Part#:{p['part_number']}  "
            f"Type:{p['type_label']}  WO#:{p['work_order']}  "
            f"[{p['formatted']}]"
        )
    return f"Tag:{epc_readable}"


def _passes_filters(ev) -> bool:
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


def _group_reads(events: list) -> dict:
    """Collapse batch to one line per (tag, antenna) with best RSSI."""
    grouped = {}
    for ev in events:
        if not _passes_filters(ev):
            continue
        d = ev.get("data", {})
        epc = d.get("idHex", "")
        try:
            antenna = int(d.get("antenna") or 0)
        except (TypeError, ValueError):
            continue
        try:
            rssi = int(d.get("peakRssi", 0))
        except (TypeError, ValueError):
            rssi = 0
        key = (decode_epc(epc), antenna)
        g = grouped.get(key)
        if g is None:
            grouped[key] = {"count": 1, "best_rssi": rssi}
        else:
            g["count"] += 1
            if rssi > g["best_rssi"]:
                g["best_rssi"] = rssi
    return grouped


def _print_reads(grouped: dict, stamp: str) -> None:
    for (epc_readable, antenna), g in sorted(grouped.items()):
        suffix = f"  (x{g['count']})" if g["count"] > 1 else ""
        print(
            f"[{stamp}] {_tag_detail(epc_readable)}  "
            f"{_antenna_label(antenna)}  RSSI:{g['best_rssi']}dBm{suffix}",
            flush=True,
        )


def _summarize_batch(events: list) -> dict:
    """Count raw antennas/RSSI in a batch before display filters."""
    summary = {"total": 0, "antennas": {}}
    for ev in events or []:
        if not isinstance(ev, dict):
            continue
        d = ev.get("data") or ev
        summary["total"] += 1
        try:
            antenna = int(d.get("antenna") or 0)
        except (TypeError, ValueError):
            antenna = 0
        if antenna:
            summary["antennas"][antenna] = summary["antennas"].get(antenna, 0) + 1
    return summary


def _local_post_urls() -> list[str]:
    """Best-guess URLs the FX9600 reader should POST to."""
    import socket
    urls: list[str] = []
    seen: set[str] = set()

    def _add(ip: str) -> None:
        if ip and ip not in seen and not ip.startswith("127."):
            seen.add(ip)
            urls.append(f"http://{ip}:{LISTENER_PORT}/tags")

    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("10.255.255.255", 1))
            _add(s.getsockname()[0])
    except OSError:
        pass

    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            _add(info[4][0])
    except OSError:
        pass

    urls.sort(key=lambda u: (0 if ".25." in u or u.startswith("http://10.25.") else 1, u))
    return urls

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
        "antenna_hits":    {str(ENTRY_ANTENNA): 0, str(EXIT_ANTENNA): 0, str(THIRD_ANTENNA): 0},
        "third_antenna_last_at": None,
        "reader_source":   None,
    }

    def _bump_antenna_hit(antenna: int) -> None:
        key = str(antenna)
        state["antenna_hits"][key] = state["antenna_hits"].get(key, 0) + 1
        if antenna == THIRD_ANTENNA:
            state["third_antenna_last_at"] = ts()

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
            "antenna_hits":            state["antenna_hits"],
            "third_antenna":           THIRD_ANTENNA,
            "third_antenna_last_at":   state["third_antenna_last_at"],
        }
        return jsonify(body), (200 if db_ok else 503)

    @app.route("/tags", methods=["POST"])
    def receive_tags():
        raw = request.get_data(as_text=True)
        stamp = ts()

        try:
            data = json.loads(raw)
            events = data if isinstance(data, list) else [data]
            batch = _summarize_batch(events)

            print(
                f"[{stamp}] POST from {request.remote_addr}: "
                f"{batch['total']} event(s)"
                + (f"  antennas={batch['antennas']}" if batch["antennas"] else ""),
                flush=True,
            )

            for ev in events:
                if not isinstance(ev, dict):
                    continue
                try:
                    antenna = int((ev.get("data") or {}).get("antenna") or 0)
                except (TypeError, ValueError):
                    continue
                if antenna:
                    _bump_antenna_hit(antenna)

            grouped = _group_reads(events)
            _print_reads(grouped, stamp)

            if batch["total"] and not grouped:
                print(
                    f"  (no reads passed filters — RSSI_MIN={RSSI_MIN}, "
                    f"EPC_FILTER={EPC_FILTER_PATTERN or 'any known tag'})",
                    flush=True,
                )

            # Persist + dwell tracking (1→2→3 path: Gannomat entry/exit, Insert Station entry)
            summary = tracker.ingest_batch(events)
            state["batches_total"] += 1
            state["events_total"]  += len(events)
            state["last_event_at"]  = time.time()
            if state["reader_source"] is None:
                state["reader_source"] = request.remote_addr
                print(f"  Reader connected from {state['reader_source']}", flush=True)
            
            if summary['raw_inserted'] > 0 or summary['session_opened'] > 0 or summary['session_closed'] > 0:
                print(f"  DB: +{summary['raw_inserted']} reads, "
                      f"+{summary['session_opened']} sessions, "
                      f"+{summary['session_closed']} completed",
                      flush=True)

        except Exception as exc:
            print(f"\n  [{stamp}] POST failed to parse/ingest: {exc}", flush=True)
            if raw:
                preview = raw[:200].replace("\n", " ")
                print(f"  Body preview: {preview}", flush=True)

        return "OK", 200

    divider("Zebra FX9600 — HTTP Listener")
    print(f"\n  Station: {STATION_NAME}   Reader: {READER_NAME}")
    print(f"  Antennas: {_antenna_label(ENTRY_ANTENNA)}  |  "
          f"{_antenna_label(EXIT_ANTENNA)}  |  {_antenna_label(THIRD_ANTENNA)}")
    print(f"  Listening on  http://{LISTENER_HOST}:{LISTENER_PORT}/tags")
    post_urls = _local_post_urls()
    print(f"  Point the reader's HTTP POST target to:")
    if post_urls:
        for url in post_urls:
            print(f"    {url}")
    else:
        print(f"    http://YOUR_PC_IP:{LISTENER_PORT}/tags")
    print(f"\n  Waiting for tag events...")
    print(f"  Filters: RSSI_MIN={RSSI_MIN}  EPC={EPC_FILTER_PATTERN or 'any known tag'}\n", flush=True)
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
    hits = body.get("antenna_hits") or {}
    print(f"  Antenna hits        : {hits}")
    print(f"  Ant{body.get('third_antenna', THIRD_ANTENNA)} last seen : "
          f"{body.get('third_antenna_last_at') or 'never'}")
    print()

    return 0 if status == "ok" else 1


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import logging

    try:
        sys.stdout.reconfigure(line_buffering=True)
    except (AttributeError, ValueError):
        pass
    
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
