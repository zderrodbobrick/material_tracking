"""
test_database.py — Direct SQLite database checks
Tests: schema correctness, row counts, FK integrity, WAL mode, data written by API.

Does NOT require the API to be running (reads DB directly).
Run:  python tests/test_database.py
"""

import sqlite3
import sys
from pathlib import Path

# Force UTF-8 output so box-drawing chars work on Windows cp1252 consoles
try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except (AttributeError, ValueError):
    pass

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from config import DB_PATH
from database.schema import get_connection

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


# ── 0. File exists ────────────────────────────────────────────────────────────

section("0. Database file")
db_path = Path(DB_PATH)
check(f"DB file exists at {db_path}", db_path.exists(), str(db_path))
if not db_path.exists():
    print("\033[91m  FATAL: Database not found. Start the API and ingest at least one event first.\033[0m")
    sys.exit(1)

check("DB file is non-empty", db_path.stat().st_size > 0,
      f"size={db_path.stat().st_size}")

conn = get_connection(str(db_path))

# ── 1. PRAGMA / WAL mode ─────────────────────────────────────────────────────

section("1. PRAGMA settings")
journal = conn.execute("PRAGMA journal_mode").fetchone()[0]
check("WAL journal mode enabled", journal == "wal", journal)

fk = conn.execute("PRAGMA foreign_keys").fetchone()[0]
check("Foreign keys enabled", fk == 1, str(fk))

# ── 2. Schema — all required tables exist ────────────────────────────────────

section("2. Schema - tables")
tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
for t in ("rfid_events", "station_sessions", "station_alerts", "label_prints"):
    check(f"Table '{t}' exists", t in tables, f"found: {tables}")

# ── 3. Schema — column checks ────────────────────────────────────────────────

section("3. Schema - columns")

def cols(table):
    return {r["name"] for r in conn.execute(f"PRAGMA table_info({table})")}

rfid_cols = cols("rfid_events")
for c in ("event_id", "epc", "ibus_number", "station_name", "antenna_location",
          "read_time", "rssi", "created_at"):
    check(f"rfid_events.{c}", c in rfid_cols)

sess_cols = cols("station_sessions")
for c in ("session_id", "ibus_number", "status", "entrance_time", "exit_time",
          "dwell_time_seconds", "operator_name", "last_seen_time", "alert_flag"):
    check(f"station_sessions.{c}", c in sess_cols)

alert_cols = cols("station_alerts")
for c in ("alert_id", "session_id", "ibus_number", "alert_type", "severity",
          "status", "created_at", "resolved_at"):
    check(f"station_alerts.{c}", c in alert_cols)

# ── 4. Indexes ────────────────────────────────────────────────────────────────

section("4. Indexes")
indexes = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='index'")}
for idx in ("idx_rfid_events_ibus_time", "idx_station_sessions_ibus_status",
            "idx_station_alerts_status"):
    check(f"Index '{idx}' exists", idx in indexes)

# ── 5. Row counts ─────────────────────────────────────────────────────────────

section("5. Row counts")
for table in ("rfid_events", "station_sessions", "station_alerts"):
    count = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
    check(f"{table} has rows", count > 0, f"count={count}")
    print(f"         ({table}: {count} rows)")

# ── 6. Status values are valid ────────────────────────────────────────────────

section("6. Data integrity - valid status values")
valid_statuses = {"In Process", "Completed", "Missing Exit", "Missing Entrance"}
bad = conn.execute(
    "SELECT DISTINCT status FROM station_sessions WHERE status NOT IN "
    "('In Process','Completed','Missing Exit','Missing Entrance')"
).fetchall()
check("All session statuses are valid", len(bad) == 0,
      f"invalid: {[r[0] for r in bad]}")

valid_alert_statuses = {"Open", "Resolved"}
bad_a = conn.execute(
    "SELECT DISTINCT status FROM station_alerts WHERE status NOT IN ('Open','Resolved')"
).fetchall()
check("All alert statuses are valid", len(bad_a) == 0,
      f"invalid: {[r[0] for r in bad_a]}")

# ── 7. Completed sessions have exit_time and dwell ────────────────────────────

section("7. Completed session integrity")
bad_completed = conn.execute(
    """SELECT COUNT(*) FROM station_sessions
       WHERE status = 'Completed' AND (exit_time IS NULL OR dwell_time_seconds IS NULL)"""
).fetchone()[0]
check("All Completed sessions have exit_time + dwell_time_seconds",
      bad_completed == 0, f"{bad_completed} rows missing")

# ── 8. In Process sessions have entrance_time ────────────────────────────────

bad_inprocess = conn.execute(
    """SELECT COUNT(*) FROM station_sessions
       WHERE status = 'In Process' AND entrance_time IS NULL"""
).fetchone()[0]
check("All 'In Process' sessions have entrance_time",
      bad_inprocess == 0, f"{bad_inprocess} rows missing")

# ── 9. FK integrity — all alerts reference valid sessions ─────────────────────

section("8. Foreign key integrity")
orphan_alerts = conn.execute(
    """SELECT COUNT(*) FROM station_alerts a
       LEFT JOIN station_sessions s ON a.session_id = s.session_id
       WHERE a.session_id IS NOT NULL AND s.session_id IS NULL"""
).fetchone()[0]
check("No orphaned alerts (all session_ids exist)", orphan_alerts == 0,
      f"{orphan_alerts} orphaned alerts")

# ── 10. Timestamps look like ISO-8601 UTC ────────────────────────────────────

section("9. Timestamp format - recent rfid_events")
recent = conn.execute(
    "SELECT read_time, created_at FROM rfid_events ORDER BY event_id DESC LIMIT 10"
).fetchall()
check("Recent rfid_events exist", len(recent) > 0)
for row in recent:
    for ts in (row["read_time"], row["created_at"]):
        if ts:
            check(f"Timestamp '{ts[:19]}' is ISO-8601 format",
                  "T" in ts or " " in ts, ts)
            break
    break  # just check one row

conn.close()

# ── Summary ───────────────────────────────────────────────────────────────────

print("\n" + "=" * 60)
if _failures:
    print(f"\033[91m  {len(_failures)} FAILED:\033[0m")
    for f in _failures:
        print(f"    - {f}")
    sys.exit(1)
else:
    print(f"\033[92m  All database tests passed.\033[0m")
