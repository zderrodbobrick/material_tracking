"""
test_api.py — Endpoint tests for the normalized RFID API.

Exercises the schema-aware read endpoints and the manual session-end write path.
Ingest happens through the listener/DwellTracker (not the API), so these tests
seed a session directly into the DB, then assert the API surfaces it correctly.

Requires: API running on localhost:5001
Run:      python tests/test_api.py
"""

import json
import sqlite3
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except (AttributeError, ValueError):
    pass

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from config import DB_PATH, STATUS_OPEN, STATUS_CLOSED

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
        print(f"{FAIL}  {label}" + (f"  ->  {detail}" if detail else ""))
        _failures.append(label)


def section(title):
    print(f"\n-- {title} {'-' * max(0, 55 - len(title))}")


def _seed_session(epc, status, entry_time, exit_time=None, dwell=None):
    """Insert a tag/part/session directly so the API has something to serve."""
    conn = sqlite3.connect(str(DB_PATH))
    conn.execute("PRAGMA foreign_keys=ON")
    station_id = conn.execute(
        "SELECT station_id FROM stations WHERE station_name='Gannomat'").fetchone()[0]
    tag_id = conn.execute("INSERT INTO rfid_tags (epc) VALUES (?)", (epc,)).lastrowid
    part_id = conn.execute(
        "INSERT INTO parts (part_number, part_name, part_type, ibus_number, job_number) "
        "VALUES ('S6','S6','IBUS',?,?)", (epc, epc[-6:])).lastrowid
    conn.execute("INSERT INTO part_tag_assignments (part_id, tag_id) VALUES (?, ?)",
                 (part_id, tag_id))
    sid = conn.execute(
        "INSERT INTO part_station_sessions "
        "(part_id, tag_id, station_id, entry_time, exit_time, dwell_seconds, session_status) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (part_id, tag_id, station_id, entry_time, exit_time, dwell, status)).lastrowid
    conn.commit()
    conn.close()
    return sid


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

# ── 1. Catalog endpoints ──────────────────────────────────────────────────────

section("1. Catalog endpoints")
for path, key in [
    ("/api/stations", "station_name"),
    ("/api/readers", "reader_name"),
    ("/api/antennas", "antenna_role"),
]:
    st, rows = _get(path)
    check(f"GET {path} returns 200", st == 200)
    check(f"{path} is a non-empty list", isinstance(rows, list) and len(rows) > 0, str(rows)[:80])
    if rows:
        check(f"{path} rows have '{key}'", key in rows[0], str(list(rows[0].keys())))

st, ants = _get("/api/antennas")
roles = {a["antenna_role"] for a in ants}
check("Antennas include Entry + Exit roles", {"Entry", "Exit"} <= roles, str(roles))

# ── 2. Operator endpoints (read-only) ─────────────────────────────────────────

section("2. Operator endpoints")
st, ops = _get("/api/operators")
check("GET /api/operators returns 200", st == 200)
check("Operators response is a list", isinstance(ops, list))

# ── 3. Live session appears ───────────────────────────────────────────────────

section("3. Live sessions")
EPC = f"S6IBUS{int(time.time()) % 1000000:06d}"
entry_iso = datetime.now(timezone.utc).isoformat()
open_sid = _seed_session(EPC, STATUS_OPEN, entry_iso)

st, live = _get("/api/live")
check("GET /api/live returns 200", st == 200)
check("Response is a list", isinstance(live, list))
match = [s for s in live if s.get("session_id") == open_sid]
check(f"Seeded open session appears in /api/live", len(match) == 1, f"found {len(match)}")
if match:
    s = match[0]
    check("status is 'open'", s["status"] == STATUS_OPEN, s["status"])
    check("entry_time set", s["entry_time"] is not None)
    check("exit_time is None", s["exit_time"] is None)
    check("part_name surfaced", s["part_name"] == "S6", str(s.get("part_name")))
    check("station_name surfaced", s["station_name"] == "Gannomat", str(s.get("station_name")))

# ── 4. Completed session + dwell ──────────────────────────────────────────────

section("4. Completed sessions")
comp_epc = f"S6DONE{int(time.time()) % 1000000:06d}"
closed_sid = _seed_session(
    comp_epc, STATUS_CLOSED,
    "2026-07-02T10:00:00Z", "2026-07-02T10:07:30Z", 450)
st, completed = _get("/api/completed?limit=100")
check("GET /api/completed returns 200", st == 200)
cmatch = [s for s in completed if s.get("session_id") == closed_sid]
check("Closed session appears in /api/completed", len(cmatch) == 1, f"found {len(cmatch)}")
if cmatch:
    s = cmatch[0]
    check("status is 'closed'", s["status"] == STATUS_CLOSED, s["status"])
    check("dwell_seconds == 450", s["dwell_seconds"] == 450, str(s["dwell_seconds"]))
    check("dwell_time_display set", s["dwell_time_display"] is not None)

# ── 5. Raw reads feed ─────────────────────────────────────────────────────────

section("5. Raw reads feed")
st, reads = _get("/api/raw-reads/recent?limit=10")
check("GET /api/raw-reads/recent returns 200", st == 200)
check("Response is a list", isinstance(reads, list))
if reads:
    r = reads[0]
    for k in ("epc", "rssi", "antenna_port", "role", "read_time"):
        check(f"raw read has '{k}'", k in r, str(list(r.keys())))

# ── 6. Summary ────────────────────────────────────────────────────────────────

section("6. Summary")
st, summ = _get("/api/summary")
check("GET /api/summary returns 200", st == 200)
for key in ("parts_in_process", "completed_today", "average_dwell_display_today",
            "reader_status", "station_name"):
    check(f"summary has '{key}'", key in summ, str(list(summ.keys())))
check("parts_in_process >= 1 (seeded open session)", summ["parts_in_process"] >= 1,
      str(summ["parts_in_process"]))

# ── 7. Report + analytics ─────────────────────────────────────────────────────

section("7. Report + analytics")
st, rep = _get("/api/report/sessions?limit=10")
check("GET /api/report/sessions returns 200", st == 200)
check("report has total + sessions", "total" in rep and "sessions" in rep)

st, reps = _get("/api/report/stations")
check("GET /api/report/stations returns 200", st == 200)
check("stations grouping returned", "stations" in reps and len(reps["stations"]) >= 1)

st, an = _get("/api/analytics")
check("GET /api/analytics returns 200", st == 200)
for key in ("totals", "dwell", "stations", "throughput_by_day", "dwell_distribution"):
    check(f"analytics has '{key}'", key in an, str(list(an.keys())))
check("analytics totals.complete >= 1", an["totals"]["complete"] >= 1, str(an["totals"]))

# ── 8. Manual session end ─────────────────────────────────────────────────────

section("8. Manual session end")
st, r = _post(f"/api/sessions/{open_sid}/end", {})
check("POST /api/sessions/<id>/end returns 200", st == 200)
check("Response success=True", r.get("success") is True, str(r))

st, live_after = _get("/api/live")
still_open = [s for s in live_after if s.get("session_id") == open_sid]
check("Ended session removed from /api/live", len(still_open) == 0, f"still {len(still_open)}")

# ── 9. Not-found handling ─────────────────────────────────────────────────────

section("9. Error handling")
try:
    _post("/api/sessions/999999999/end", {})
    check("Ending unknown session returns 404", False, "expected 404")
except urllib.error.HTTPError as e:
    check("Ending unknown session returns 404", e.code == 404, str(e.code))

# ── Summary ───────────────────────────────────────────────────────────────────

print("\n" + "=" * 60)
if _failures:
    print(f"\033[91m  {len(_failures)} FAILED:\033[0m")
    for f in _failures:
        print(f"    - {f}")
    sys.exit(1)
else:
    print("\033[92m  All API tests passed.\033[0m")
