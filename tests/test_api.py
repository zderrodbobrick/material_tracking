"""
test_api.py — API endpoint tests
Tests: RFID ingest, session lifecycle, live-status, completed, alerts, stats, resolve.

Requires: API running on localhost:5001
Run:      python tests/test_api.py
"""

import json
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone, timedelta

# Force UTF-8 output so box-drawing chars work on Windows cp1252 consoles
try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except (AttributeError, ValueError):
    pass

BASE = "http://localhost:5001"
PASS = "\033[92m  PASS\033[0m"
FAIL = "\033[91m  FAIL\033[0m"

_failures = []


def _post(path, body):
    data = json.dumps(body).encode()
    req = urllib.request.Request(
        BASE + path, data=data, method="POST",
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=5) as r:
        return r.status, json.loads(r.read())


def _get(path):
    with urllib.request.urlopen(BASE + path, timeout=5) as r:
        return r.status, json.loads(r.read())


def check(label, condition, detail=""):
    if condition:
        print(f"{PASS}  {label}")
    else:
        msg = f"{FAIL}  {label}" + (f"  ->  {detail}" if detail else "")
        print(msg)
        _failures.append(label)


def section(title):
    print(f"\n-- {title} {'-' * max(0, 55 - len(title))}")


# ── 0. Reachability ───────────────────────────────────────────────────────────

section("0. API reachability")
try:
    status, body = _get("/")
    check("GET / returns 200", status == 200)
    check("Service name in response", "RFID" in str(body))
except Exception as e:
    print(f"\033[91m  FATAL: Cannot reach API at {BASE} - is it running?\033[0m")
    print(f"  Detail: {e}")
    sys.exit(1)

# ── 1. RFID Ingest — Entrance ─────────────────────────────────────────────────

section("1. RFID ingest - entrance read")
IBUS = f"S6IBUS{int(time.time()) % 1000000:06d}"
now_utc = datetime.now(timezone.utc)
entrance_iso = now_utc.isoformat()

status, r = _post("/api/rfid/events", {
    "epc": IBUS,
    "ibus_number": IBUS,
    "station_name": "Gannomat",
    "antenna_location": "Entrance",
    "reader_id": "TEST_READER",
    "antenna_id": 1,
    "read_time": entrance_iso,
    "rssi": -35,
})
check("POST /api/rfid/events returns 201", status == 201)
check("Action is session_created or session_updated",
      r.get("action") in ("session_created", "session_updated"),
      r.get("action"))
session_id = r.get("session_id")
check("session_id returned", session_id is not None, str(r))

# ── 2. RFID Ingest — Duplicate suppression ────────────────────────────────────

section("2. Duplicate suppression (same IBUS + antenna within 5s)")
status2, r2 = _post("/api/rfid/events", {
    "epc": IBUS,
    "ibus_number": IBUS,
    "station_name": "Gannomat",
    "antenna_location": "Entrance",
    "reader_id": "TEST_READER",
    "antenna_id": 1,
    "read_time": entrance_iso,
    "rssi": -35,
})
check("Duplicate returns 201", status2 == 201)
check("Duplicate is suppressed", r2.get("status") == "suppressed", str(r2))

# ── 3. Live status shows the new session ─────────────────────────────────────

section("3. Live status")
status3, live = _get("/api/gannomat/live-status")
check("GET /api/gannomat/live-status returns 200", status3 == 200)
check("Response is a list", isinstance(live, list))
matching = [s for s in live if s.get("ibus_number") == IBUS]
check(f"New session {IBUS} appears in live-status", len(matching) > 0,
      f"found {len(matching)} matching rows")
if matching:
    s = matching[0]
    check("Status is 'In Process'", s["status"] == "In Process", s["status"])
    check("entrance_time is set", s["entrance_time"] is not None)
    check("exit_time is None", s["exit_time"] is None)

# ── 4. RFID Ingest — Exit ─────────────────────────────────────────────────────

section("4. RFID ingest - exit read")
exit_iso = datetime.now(timezone.utc).isoformat()
status4, r4 = _post("/api/rfid/events", {
    "epc": IBUS,
    "ibus_number": IBUS,
    "station_name": "Gannomat",
    "antenna_location": "Exit",
    "reader_id": "TEST_READER",
    "antenna_id": 2,
    "read_time": exit_iso,
    "rssi": -38,
})
check("Exit POST returns 201", status4 == 201)
check("Action is session_completed", r4.get("action") == "session_completed", str(r4))
check("dwell_time_seconds >= 0",
      isinstance(r4.get("dwell_time_seconds"), int) and r4["dwell_time_seconds"] >= 0,
      str(r4.get("dwell_time_seconds")))

# ── 5. Completed sessions ─────────────────────────────────────────────────────

section("5. Completed sessions")
status5, completed = _get("/api/gannomat/completed?limit=50")
check("GET /api/gannomat/completed returns 200", status5 == 200)
check("Response is a list", isinstance(completed, list))
comp_match = [s for s in completed if s.get("ibus_number") == IBUS]
check(f"{IBUS} appears in completed list", len(comp_match) > 0,
      f"found {len(comp_match)} matching rows")
if comp_match:
    s = comp_match[0]
    check("Status is 'Completed'", s["status"] == "Completed", s["status"])
    check("exit_time is set", s["exit_time"] is not None)
    check("dwell_time_display is set", s["dwell_time_display"] is not None, str(s.get("dwell_time_display")))

# ── 6. Missing Entrance alert ─────────────────────────────────────────────────

section("6. Missing Entrance - exit with no prior entrance")
IBUS_ME = f"S6IBUS{(int(time.time()) + 1) % 1000000:06d}"
status6, r6 = _post("/api/rfid/events", {
    "epc": IBUS_ME,
    "ibus_number": IBUS_ME,
    "station_name": "Gannomat",
    "antenna_location": "Exit",
    "reader_id": "TEST_READER",
    "antenna_id": 2,
    "read_time": datetime.now(timezone.utc).isoformat(),
    "rssi": -40,
})
check("Missing Entrance POST returns 201", status6 == 201)
check("Action is missing_entrance_alert",
      r6.get("action") == "missing_entrance_alert", str(r6))

# ── 7. Alerts endpoint ────────────────────────────────────────────────────────

section("7. Alerts")
status7, alerts = _get("/api/gannomat/alerts")
check("GET /api/gannomat/alerts returns 200", status7 == 200)
check("Response is a list", isinstance(alerts, list))
me_alerts = [a for a in alerts if a.get("ibus_number") == IBUS_ME]
check(f"Missing Entrance alert exists for {IBUS_ME}", len(me_alerts) > 0,
      f"found {len(me_alerts)}")
if me_alerts:
    a = me_alerts[0]
    check("alert_type is 'Missing Entrance'", a["alert_type"] == "Missing Entrance", a["alert_type"])
    check("severity is 'High'", a["severity"] == "High", a["severity"])
    alert_id = a["alert_id"]

    # ── 8. Resolve alert ──────────────────────────────────────────────────────
    section("8. Resolve alert")
    status8, r8 = _post(f"/api/gannomat/alerts/{alert_id}/resolve", {})
    check("Resolve returns 200", status8 == 200)
    check("Response has status=ok", r8.get("status") == "ok", str(r8))
    check("resolved_at is set", r8.get("resolved_at") is not None)

    status8b, alerts_after = _get("/api/gannomat/alerts")
    still_open = [a for a in alerts_after if a.get("alert_id") == alert_id]
    check("Alert no longer in open alerts", len(still_open) == 0,
          f"still found {len(still_open)} open")

# ── 9. Stats ──────────────────────────────────────────────────────────────────

section("9. Stats")
status9, stats = _get("/api/gannomat/stats")
check("GET /api/gannomat/stats returns 200", status9 == 200)
for key in ("parts_in_process", "parts_completed_today", "open_alerts", "missing_exit_count"):
    check(f"stats has key '{key}'", key in stats, str(list(stats.keys())))

# ── 10. Bad request handling ──────────────────────────────────────────────────

section("10. Bad request handling")
try:
    _post("/api/rfid/events", {"ibus_number": "IBUS999", "antenna_location": "BadAntenna"})
    check("Invalid antenna_location rejected", False, "Expected 422, got 201")
except urllib.error.HTTPError as e:
    check("Invalid antenna_location returns 422", e.code == 422, str(e.code))

try:
    _post("/api/rfid/events", {"antenna_location": "Entrance"})
    check("Missing ibus_number rejected", False, "Expected 422, got 201")
except urllib.error.HTTPError as e:
    check("Missing ibus_number returns 422", e.code == 422, str(e.code))

# ── Summary ───────────────────────────────────────────────────────────────────

print("\n" + "=" * 60)
if _failures:
    print(f"\033[91m  {len(_failures)} FAILED:\033[0m")
    for f in _failures:
        print(f"    - {f}")
    sys.exit(1)
else:
    print(f"\033[92m  All API tests passed.\033[0m")
