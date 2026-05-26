"""
Zebra FX9600 - Tag Event Listener
Two modes in one script:

  1. HTTP POST listener  — reader pushes events to this server (passive)
  2. LLRP server mode   — reader connects TO this script (passive listen)

Usage:
    python listener.py            # HTTP mode (default)
    python listener.py --llrp     # LLRP server listen mode

Requirements:
    pip install flask sllurp
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
    from flask import Flask, request

    app = Flask(__name__)
    tracker = DwellTracker()

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
# MODE 2 — LLRP server mode (reader connects TO us)
# ══════════════════════════════════════════════════════════════════════════════

LISTEN_HOST = "0.0.0.0"   # listen on all interfaces
LISTEN_PORT = 5084         # standard LLRP port
STATION     = "station_a"  # label stamped on every event

def on_tag_report(reader, tag_list):
    """Called by sllurp each time the reader reports tag reads."""
    divider(f"Tag report at {ts()}  —  {len(tag_list)} read(s)")
    for tag in tag_list:
        try:
            epc = tag.get("EPC-96") or tag.get("EPC")
            if isinstance(epc, (bytes, bytearray)):
                epc = epc.hex().upper()

            rssi     = tag.get("PeakRSSI", "n/a")
            antenna  = tag.get("AntennaID", "?")
            seen_us  = tag.get("LastSeenTimestampUTC", 0)
            seen_iso = (
                datetime.fromtimestamp(seen_us / 1e6, tz=timezone.utc).isoformat()
                if seen_us else ts()
            )
            count    = tag.get("TagSeenCount", 1)

            event = {
                "epc":       epc,
                "station":   STATION,
                "rssi":      rssi,
                "antenna":   antenna,
                "count":     count,
                "timestamp": seen_iso,
            }

            print(f"\n  {json.dumps(event, indent=4)}")

        except Exception as exc:
            print(f"  [parse error] {exc}  raw={tag}")


def run_llrp():
    try:
        from sllurp.llrp import LLRPReaderClient, LLRPReaderConfig
        from sllurp.llrp_proto import Capability_Name2Type
    except ImportError:
        print("  sllurp not installed.  Run:  pip install sllurp")
        sys.exit(1)

    import asyncio
    import socket

    divider("Zebra FX9600 — LLRP Server (listening)")
    print(f"\n  Listening on  0.0.0.0:{LISTEN_PORT}")
    print(f"  Station label: {STATION}")
    print(f"\n  Reader should be set to:")
    print(f"    Operation Mode: Client")
    print(f"    Server IP:      your PC's ethernet IP  (169.254.114.233)")
    print(f"    Client Port:    {LISTEN_PORT}")
    print(f"\n  Waiting for reader to connect...  (Ctrl-C to stop)\n")

    # Use a raw TCP server to accept the reader connection
    # then hand the socket to sllurp
    server_sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server_sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server_sock.bind((LISTEN_HOST, LISTEN_PORT))
    server_sock.listen(1)

    print(f"  Socket bound. Waiting for FX9600 to connect on port {LISTEN_PORT}...")

    try:
        conn, addr = server_sock.accept()
        print(f"\n  Reader connected from {addr[0]}:{addr[1]}")
        print(f"  Listening for tag events...\n")

        config = LLRPReaderConfig({
            "start_inventory": True,
            "tag_content_selector": {
                "EnableROSpecID":                   False,
                "EnableSpecIndex":                  False,
                "EnableInventoryParameterSpecID":   False,
                "EnableAntennaID":                  True,
                "EnableChannelIndex":               False,
                "EnablePeakRSSI":                   True,
                "EnableFirstSeenTimestamp":         False,
                "EnableLastSeenTimestamp":          True,
                "EnableTagSeenCount":               True,
                "EnableAccessSpecID":               False,
            },
        })

        # Pass the already-connected socket to sllurp
        client = LLRPReaderClient(None, LISTEN_PORT, config, sock=conn)
        client.add_tag_report_callback(on_tag_report)
        client.connect()
        client.join()

    except KeyboardInterrupt:
        print("\n\n  Stopped by user.")
    except Exception as exc:
        print(f"\n  Error: {exc}")
        print(f"\n  Things to check:")
        print(f"    • Reader LLRP set to Client mode pointing at this PC")
        print(f"    • Port {LISTEN_PORT} not blocked by Windows Firewall")
        print(f"    • Run as Administrator if port binding fails")
    finally:
        server_sock.close()


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    if "--llrp" in sys.argv:
        run_llrp()
    else:
        run_http()