"""
test_timezone.py — Timezone correctness tests
Tests:
  - API stores timestamps as UTC ISO-8601
  - Timestamps survive round-trip (POST → DB → GET) without drift
  - dwell_time_seconds is calculated correctly regardless of local TZ
  - DB created_at is close to UTC now (not local time)

Requires: API running on localhost:5001
Run:      python tests/test_timezone.py
"""

import json
import sys
import time
import urllib.request
import sqlite3
from datetime import datetime, timezone, timedelta
from pathlib import Path

# Force UTF-8 output so box-drawing chars work on Windows cp1252 consoles
try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except (AttributeError, ValueError):
    pass

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from config import DB_PATH

PASS = "\033[92m  PASS\033[0m"
FAIL = "\033[91m  FAIL\033[0m"
_failures = []

BASE = "http://localhost:5001"


def check(label, condition, detail=""):
    if condition:
        print(f"{PASS}  {label}")
    else:
        msg = f"{FAIL}  {label}" + (f"  ->  {detail}" if detail else "")
        print(msg)
        _failures.append(label)


def section(title):
    print(f"\n-- {title} {'-' * max(0, 55 - len(title))}")


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


def parse_iso(ts):
    """Parse ISO-8601 with or without timezone suffix."""
    if not ts:
        return None
    ts = ts.strip()
    # Python 3.7+ fromisoformat doesn't handle trailing Z
    ts = ts.replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(ts)
    except ValueError:
        return None


# ── 0. API reachable ──────────────────────────────────────────────────────────

section("0. API reachability")
try:
    with urllib.request.urlopen(BASE + "/", timeout=3) as r:
        check("API is reachable", r.status == 200)
except Exception as e:
    print(f"\033[91m  FATAL: Cannot reach API at {BASE}\033[0m  ({e})")
    sys.exit(1)

# ── 1. Send event with explicit UTC time, verify round-trip ──────────────────

section("1. UTC timestamp round-trip")

IBUS = f"S6IBUS{int(time.time()) % 1000000:06d}"
entrance_utc = datetime.now(timezone.utc).replace(microsecond=0)
entrance_iso = entrance_utc.isoformat()

_, r_entrance = _post("/api/rfid/events", {
    "epc": IBUS,
    "ibus_number": IBUS,
    "station_name": "Gannomat",
    "antenna_location": "Entrance",
    "reader_id": "TZ_TEST",
    "antenna_id": 1,
    "read_time": entrance_iso,
    "rssi": -35,
})
check("Entrance accepted", r_entrance.get("action") in ("session_created", "session_updated"),
      str(r_entrance))

time.sleep(1)  # ensure measurable dwell

exit_utc = datetime.now(timezone.utc).replace(microsecond=0)
exit_iso = exit_utc.isoformat()
expected_dwell = int((exit_utc - entrance_utc).total_seconds())

_, r_exit = _post("/api/rfid/events", {
    "epc": IBUS,
    "ibus_number": IBUS,
    "station_name": "Gannomat",
    "antenna_location": "Exit",
    "reader_id": "TZ_TEST",
    "antenna_id": 2,
    "read_time": exit_iso,
    "rssi": -38,
})
check("Exit accepted", r_exit.get("action") == "session_completed", str(r_exit))
actual_dwell = r_exit.get("dwell_time_seconds")
check(f"Dwell time correct (expected ~{expected_dwell}s, got {actual_dwell}s)",
      actual_dwell is not None and abs(actual_dwell - expected_dwell) <= 2,
      f"expected={expected_dwell}, actual={actual_dwell}")

# ── 2. Check timestamps via GET /completed ────────────────────────────────────

section("2. Timestamps in API response")
_, completed = _get("/api/gannomat/completed?limit=50")
match = next((s for s in completed if s.get("ibus_number") == IBUS), None)
check(f"Session {IBUS} in completed list", match is not None)

if match:
    ent = parse_iso(match["entrance_time"])
    ext = parse_iso(match["exit_time"])

    check("entrance_time parseable", ent is not None, str(match["entrance_time"]))
    check("exit_time parseable", ext is not None, str(match["exit_time"]))

    if ent and ext:
        # Make timezone-aware if naive (treat as UTC)
        if ent.tzinfo is None:
            ent = ent.replace(tzinfo=timezone.utc)
        if ext.tzinfo is None:
            ext = ext.replace(tzinfo=timezone.utc)

        drift_entrance = abs((ent - entrance_utc).total_seconds())
        drift_exit = abs((ext - exit_utc).total_seconds())

        check(f"entrance_time matches posted UTC (drift={drift_entrance:.1f}s)",
              drift_entrance <= 2, f"stored={ent.isoformat()}, sent={entrance_utc.isoformat()}")
        check(f"exit_time matches posted UTC (drift={drift_exit:.1f}s)",
              drift_exit <= 2, f"stored={ext.isoformat()}, sent={exit_utc.isoformat()}")

        api_dwell = match.get("dwell_time_seconds")
        check(f"API dwell matches timestamp difference",
              api_dwell is not None and abs(api_dwell - expected_dwell) <= 2,
              f"api_dwell={api_dwell}, expected={expected_dwell}")

# ── 3. DB-level timestamp check ───────────────────────────────────────────────

section("3. DB-level UTC check")
conn = sqlite3.connect(str(DB_PATH), check_same_thread=False)
conn.row_factory = sqlite3.Row

row = conn.execute(
    "SELECT entrance_time, exit_time, dwell_time_seconds, created_at "
    "FROM station_sessions WHERE ibus_number = ? ORDER BY session_id DESC LIMIT 1",
    (IBUS,)
).fetchone()

check("Session row found in DB", row is not None)
if row:
    db_ent = parse_iso(row["entrance_time"])
    db_ext = parse_iso(row["exit_time"])
    db_created = parse_iso(row["created_at"])

    check("DB entrance_time parseable", db_ent is not None, str(row["entrance_time"]))
    check("DB exit_time parseable", db_ext is not None, str(row["exit_time"]))

    if db_ent:
        if db_ent.tzinfo is None:
            db_ent = db_ent.replace(tzinfo=timezone.utc)
        drift = abs((db_ent - entrance_utc).total_seconds())
        check(f"DB entrance_time is UTC (drift={drift:.1f}s)", drift <= 2,
              f"db={db_ent.isoformat()}, expected={entrance_utc.isoformat()}")

    if db_created:
        if db_created.tzinfo is None:
            db_created = db_created.replace(tzinfo=timezone.utc)
        now_utc = datetime.now(timezone.utc)
        age = abs((now_utc - db_created).total_seconds())
        check(f"DB created_at is recent UTC (age={age:.0f}s)", age < 120,
              f"db_created={db_created.isoformat()}, now={now_utc.isoformat()}")

# ── 4. created_at on rfid_events is UTC ──────────────────────────────────────

section("4. rfid_events timestamps are UTC")
events = conn.execute(
    "SELECT read_time, created_at FROM rfid_events WHERE ibus_number = ? ORDER BY event_id DESC LIMIT 2",
    (IBUS,)
).fetchall()
check("rfid_events rows exist for this IBUS", len(events) > 0)
for ev in events:
    rt = parse_iso(ev["read_time"])
    if rt:
        if rt.tzinfo is None:
            rt = rt.replace(tzinfo=timezone.utc)
        now = datetime.now(timezone.utc)
        age = abs((now - rt).total_seconds())
        check(f"read_time is recent (age={age:.0f}s < 120s)", age < 120,
              f"read_time={rt.isoformat()}")

conn.close()

# ── 5. dwell_display format check ────────────────────────────────────────────

section("5. dwell_time_display format")
_, completed2 = _get("/api/gannomat/completed?limit=50")
match2 = next((s for s in completed2 if s.get("ibus_number") == IBUS), None)
if match2:
    dwell_disp = match2.get("dwell_time_display")
    check("dwell_time_display is set", dwell_disp is not None, str(dwell_disp))
    if dwell_disp:
        check("dwell_time_display contains 'min' or 'sec'",
              "min" in dwell_disp or "sec" in dwell_disp,
              dwell_disp)
        print(f"         dwell_time_display = '{dwell_disp}'")

# ── Summary ───────────────────────────────────────────────────────────────────

print("\n" + "=" * 60)
if _failures:
    print(f"\033[91m  {len(_failures)} FAILED:\033[0m")
    for f in _failures:
        print(f"    - {f}")
    sys.exit(1)
else:
    print(f"\033[92m  All timezone tests passed.\033[0m")
