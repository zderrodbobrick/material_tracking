"""
test_websocket.py — Live WebSocket push test
Tests: Socket.IO connects, rfid_update event fires within 3s of a POST to /api/rfid/events.

Requires: API running on localhost:5001, pip install python-socketio[client]
Run:      python tests/test_websocket.py
"""

import json
import sys
import time
import threading
import urllib.request
from datetime import datetime, timezone

# Force UTF-8 output so box-drawing chars work on Windows cp1252 consoles
try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except (AttributeError, ValueError):
    pass

PASS = "\033[92m  PASS\033[0m"
FAIL = "\033[91m  FAIL\033[0m"
_failures = []


def check(label, condition, detail=""):
    if condition:
        print(f"{PASS}  {label}")
    else:
        msg = f"{FAIL}  {label}" + (f"  ->  {detail}" if detail else "")
        print(msg)
        _failures.append(label)


def section(title):
    print(f"\n-- {title} {'-' * max(0, 55 - len(title))}")


# ── Check dependency ──────────────────────────────────────────────────────────

try:
    import socketio as sio_lib
except ImportError:
    print("\033[91m  FATAL: python-socketio[client] not installed.\033[0m")
    print("  Run: pip install \"python-socketio[client]\"")
    sys.exit(1)

BASE = "http://localhost:5001"

# ── 0. Basic connectivity ─────────────────────────────────────────────────────

section("0. API reachability")
try:
    with urllib.request.urlopen(BASE + "/", timeout=3) as r:
        check("API is reachable", r.status == 200)
except Exception as e:
    print(f"\033[91m  FATAL: Cannot reach API at {BASE}\033[0m  ({e})")
    sys.exit(1)

# ── 1. WebSocket connection ───────────────────────────────────────────────────

section("1. WebSocket connection")

connected_event = threading.Event()
disconnected_event = threading.Event()
received_events = []

sio = sio_lib.Client(reconnection=False)

@sio.event
def connect():
    connected_event.set()

@sio.event
def disconnect():
    disconnected_event.set()

@sio.on("rfid_update")
def on_rfid_update(data):
    received_events.append({"time": time.time(), "data": data})

try:
    sio.connect(BASE, transports=["websocket", "polling"], wait_timeout=5)
except Exception as e:
    check("Socket.IO connects to API", False, str(e))
    print("\033[91m  FATAL: Cannot establish WebSocket. Remaining tests skipped.\033[0m")
    sys.exit(1)

connected = connected_event.wait(timeout=5)
check("Socket.IO connect event fires", connected)

# ── 2. rfid_update event fires on RFID ingest ────────────────────────────────

section("2. rfid_update push on RFID ingest")

IBUS = f"S6IBUS{int(time.time()) % 1000000:06d}"
t_before = time.time()

def post_rfid():
    body = json.dumps({
        "epc": IBUS,
        "ibus_number": IBUS,
        "station_name": "Gannomat",
        "antenna_location": "Entrance",
        "reader_id": "WS_TEST",
        "antenna_id": 1,
        "read_time": datetime.now(timezone.utc).isoformat(),
        "rssi": -35,
    }).encode()
    req = urllib.request.Request(
        BASE + "/api/rfid/events", data=body, method="POST",
        headers={"Content-Type": "application/json"},
    )
    urllib.request.urlopen(req, timeout=5)

post_thread = threading.Thread(target=post_rfid, daemon=True)
post_thread.start()
post_thread.join(timeout=5)

# Wait up to 3s for the WebSocket push
deadline = time.time() + 3
while time.time() < deadline and not received_events:
    time.sleep(0.05)

check("rfid_update event received within 3s", len(received_events) > 0,
      f"received {len(received_events)} events after 3s")

if received_events:
    ev = received_events[-1]
    latency = ev["time"] - t_before
    check(f"Latency < 3s (actual: {latency:.2f}s)", latency < 3.0, f"{latency:.3f}s")
    check("Event payload has 'action' key", "action" in ev["data"], str(ev["data"]))
    print(f"         action={ev['data'].get('action')}, latency={latency*1000:.0f}ms")

# ── 3. rfid_update fires on alert resolve ────────────────────────────────────

section("3. rfid_update fires on alert resolve")

# First create a Missing Entrance so there's something to resolve
received_events.clear()
IBUS2 = f"S6IBUS{(int(time.time()) + 77) % 1000000:06d}"

def post_exit():
    body = json.dumps({
        "epc": IBUS2,
        "ibus_number": IBUS2,
        "station_name": "Gannomat",
        "antenna_location": "Exit",
        "reader_id": "WS_TEST",
        "antenna_id": 2,
        "read_time": datetime.now(timezone.utc).isoformat(),
        "rssi": -38,
    }).encode()
    req = urllib.request.Request(
        BASE + "/api/rfid/events", data=body, method="POST",
        headers={"Content-Type": "application/json"},
    )
    urllib.request.urlopen(req, timeout=5)

threading.Thread(target=post_exit, daemon=True).start()
time.sleep(0.5)

# Find the alert
with urllib.request.urlopen(BASE + "/api/gannomat/alerts", timeout=5) as r:
    alerts = json.loads(r.read())
target = next((a for a in alerts if a.get("ibus_number") == IBUS2), None)

if target:
    received_events.clear()
    t_resolve = time.time()

    def resolve():
        body = b"{}"
        req = urllib.request.Request(
            BASE + f"/api/gannomat/alerts/{target['alert_id']}/resolve",
            data=body, method="POST",
            headers={"Content-Type": "application/json"},
        )
        urllib.request.urlopen(req, timeout=5)

    threading.Thread(target=resolve, daemon=True).start()

    deadline = time.time() + 3
    while time.time() < deadline and not received_events:
        time.sleep(0.05)

    check("rfid_update fires after alert resolve", len(received_events) > 0,
          f"received {len(received_events)} events")
    if received_events:
        ev = received_events[-1]
        check("action is alert_resolved", ev["data"].get("action") == "alert_resolved",
              str(ev["data"]))
else:
    check("Alert found for resolve test", False, "No alert for IBUS2 - skipping resolve test")

# ── 4. Disconnect cleanly ─────────────────────────────────────────────────────

section("4. Clean disconnect")
sio.disconnect()
clean = disconnected_event.wait(timeout=3)
check("Disconnects cleanly", clean)

# ── Summary ───────────────────────────────────────────────────────────────────

print("\n" + "=" * 60)
if _failures:
    print(f"\033[91m  {len(_failures)} FAILED:\033[0m")
    for f in _failures:
        print(f"    - {f}")
    sys.exit(1)
else:
    print(f"\033[92m  All WebSocket tests passed.\033[0m")
