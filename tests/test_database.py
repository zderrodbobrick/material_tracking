"""
test_database.py — Schema, seed, and integrity checks for the normalized RFID schema.

Validates the 12-table POC schema from Database.md (9 core + 3 operator),
the vw_live_part_status view, recommended indexes, seed data, and FK integrity.

Runs against a fresh in-memory database built by database.migrate.run_migrations,
so it does NOT require the listener/API to be running.

Run:  python tests/test_database.py
"""

import sqlite3
import sys
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except (AttributeError, ValueError):
    pass

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from database.migrate import run_migrations

PASS = "\033[92m  PASS\033[0m"
FAIL = "\033[91m  FAIL\033[0m"
_failures = []


def check(label, condition, detail=""):
    if condition:
        print(f"{PASS}  {label}")
    else:
        print(f"{FAIL}  {label}" + (f"  ->  {detail}" if detail else ""))
        _failures.append(label)


def section(title):
    print(f"\n-- {title} {'-' * max(0, 55 - len(title))}")


def cols(conn, table):
    return {r[1] for r in conn.execute(f"PRAGMA table_info({table})")}


# ── Build a fresh schema in-memory ────────────────────────────────────────────

conn = sqlite3.connect(":memory:")
conn.execute("PRAGMA foreign_keys=ON")
run_migrations(
    conn,
    station_name="Gannomat",
    station_type="Drilling",
    station_location="TPF CL",
    reader_name="FX9600-Gannomat",
    reader_ip="192.168.1.50",
    entry_antenna=1,
    exit_antenna=2,
)

tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
views = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='view'")}
indexes = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='index'")}

# ── 1. Migration system ───────────────────────────────────────────────────────

section("1. Migration system")
check("schema_migrations table exists", "schema_migrations" in tables)
applied = [r[0] for r in conn.execute("SELECT version FROM schema_migrations ORDER BY version")]
check("All 11 migrations applied", len(applied) == 11, f"applied: {applied}")
for v in range(1, 12):
    check(f"Migration v{v} applied", v in applied)

# ── 2. Core tables (9) ────────────────────────────────────────────────────────

section("2. Core tables (9)")
CORE = [
    "rfid_tags", "parts", "part_tag_assignments",
    "stations", "rfid_readers", "rfid_antennas",
    "rfid_raw_reads", "part_station_events", "part_station_sessions",
]
for t in CORE:
    check(f"Table '{t}' exists", t in tables)

# ── 3. Operator tables (3) ────────────────────────────────────────────────────

section("3. Operator tables (3)")
OPS = ["operators", "operator_station_presence", "part_operator_assignments"]
for t in OPS:
    check(f"Table '{t}' exists", t in tables)

# ── 4. Key columns ────────────────────────────────────────────────────────────

section("4. Key columns")
check("rfid_tags.epc", "epc" in cols(conn, "rfid_tags"))
for c in ("part_number", "part_name", "part_type", "ibus_number", "job_number", "quantity_required"):
    check(f"parts.{c}", c in cols(conn, "parts"))
for c in ("antenna_role", "antenna_port", "station_id", "reader_id"):
    check(f"rfid_antennas.{c}", c in cols(conn, "rfid_antennas"))
for c in ("antenna_id", "antenna_port", "rssi", "reader_timestamp", "server_received_at",
          "read_status", "is_stale"):
    check(f"rfid_raw_reads.{c}", c in cols(conn, "rfid_raw_reads"))
for c in ("entry_time", "exit_time", "dwell_seconds", "session_status",
          "entry_event_id", "exit_event_id"):
    check(f"part_station_sessions.{c}", c in cols(conn, "part_station_sessions"))
for c in ("employee_number", "operator_name", "rtls_badge_id", "is_active"):
    check(f"operators.{c}", c in cols(conn, "operators"))
for c in ("zone_id", "station_name", "zone_name", "status", "updated_at"):
    check(f"operator_current_zone.{c}", c in cols(conn, "operator_current_zone"))
for c in ("session_id", "operator_id", "station_id", "entered_at", "confirmed_at", "left_at"):
    check(f"session_operator_presence.{c}", c in cols(conn, "session_operator_presence"))

# ── 5. View ───────────────────────────────────────────────────────────────────

section("5. Live status view")
check("vw_live_part_status exists", "vw_live_part_status" in views)
view_cols = cols(conn, "vw_live_part_status")
for c in ("session_id", "part_name", "part_type", "ibus_number", "job_number",
          "epc", "station_name", "entry_time", "exit_time", "dwell_seconds", "session_status"):
    check(f"view.{c}", c in view_cols)

# ── 6. Indexes ────────────────────────────────────────────────────────────────

section("6. Indexes")
for idx in ("IX_raw_reads_epc_time", "IX_raw_reads_reader_time", "IX_raw_reads_antenna_time",
            "IX_sessions_tag_station_status", "IX_events_tag_station_time"):
    check(f"Index '{idx}' exists", idx in indexes)

# ── 7. Seed data ──────────────────────────────────────────────────────────────

section("7. Seed data")
station_names = {r[0] for r in conn.execute("SELECT station_name FROM stations")}
for s in ("Gannomat", "Tennoner", "Insert Station", "Anderson", "Final Packing"):
    check(f"Station '{s}' seeded", s in station_names)

reader = conn.execute(
    "SELECT reader_id, station_id FROM rfid_readers WHERE reader_name = 'FX9600-Gannomat'"
).fetchone()
check("Gannomat reader seeded", reader is not None)

roles = {r[0]: r[1] for r in conn.execute(
    "SELECT antenna_port, antenna_role FROM rfid_antennas"
)}
check("Entry antenna on port 1", roles.get(1) == "Entry", str(roles))
check("Exit antenna on port 2", roles.get(2) == "Exit", str(roles))
check("Insert entry antenna on port 3", roles.get(3) == "Entry", str(roles))

insert_ant = conn.execute(
    "SELECT a.station_id, s.station_name FROM rfid_antennas a "
    "JOIN stations s ON a.station_id = s.station_id "
    "WHERE a.antenna_port = 3"
).fetchone()
check("Antenna 3 bound to Insert Station", insert_ant is not None and insert_ant[1] == "Insert Station", str(insert_ant))

op_count = conn.execute("SELECT COUNT(*) FROM operators").fetchone()[0]
check("Operators seeded from RTLS map", op_count >= 10, f"count={op_count}")

# ── 8. FK integrity (full pipeline insert) ────────────────────────────────────

section("8. FK integrity — pipeline round-trip")
station_id = conn.execute(
    "SELECT station_id FROM stations WHERE station_name='Gannomat'").fetchone()[0]
reader_id = reader[0]
antenna_id = conn.execute(
    "SELECT antenna_id FROM rfid_antennas WHERE reader_id=? AND antenna_port=1",
    (reader_id,)).fetchone()[0]

tag_id = conn.execute("INSERT INTO rfid_tags (epc) VALUES ('1D40463947')").lastrowid
part_id = conn.execute(
    "INSERT INTO parts (part_number, part_name, part_type, ibus_number, job_number, quantity_required) "
    "VALUES ('D4','D4','IBUS','1D40463947','463947',1)").lastrowid
conn.execute("INSERT INTO part_tag_assignments (part_id, tag_id) VALUES (?, ?)", (part_id, tag_id))
read_id = conn.execute(
    "INSERT INTO rfid_raw_reads (tag_id, epc, reader_id, antenna_id, antenna_port, rssi, reader_timestamp) "
    "VALUES (?, '1D40463947', ?, ?, 1, -42.0, '2026-07-02T10:00:00Z')",
    (tag_id, reader_id, antenna_id)).lastrowid
enter_ev = conn.execute(
    "INSERT INTO part_station_events (part_id, tag_id, station_id, event_type, event_time, source_read_id) "
    "VALUES (?, ?, ?, 'ENTER', '2026-07-02T10:00:00Z', ?)",
    (part_id, tag_id, station_id, read_id)).lastrowid
session_id = conn.execute(
    "INSERT INTO part_station_sessions (part_id, tag_id, station_id, entry_event_id, entry_time, session_status) "
    "VALUES (?, ?, ?, ?, '2026-07-02T10:00:00Z', 'open')",
    (part_id, tag_id, station_id, enter_ev)).lastrowid
conn.commit()

check("Tag/part/assignment/read/event/session inserted", session_id is not None)

vw = conn.execute(
    "SELECT part_name, part_type, station_name, epc, session_status "
    "FROM vw_live_part_status WHERE session_id = ?", (session_id,)
).fetchone()
check("Session visible in vw_live_part_status", vw is not None)
if vw:
    check("View joins part_name", vw[0] == "D4", str(vw))
    check("View joins station_name", vw[2] == "Gannomat", str(vw))
    check("View exposes epc", vw[3] == "1D40463947", str(vw))
    check("View exposes status", vw[4] == "open", str(vw))

# FK enforcement: inserting an event with a bogus station should fail
try:
    conn.execute(
        "INSERT INTO part_station_events (tag_id, station_id, event_type, event_time) "
        "VALUES (?, 99999, 'ENTER', '2026-07-02T10:00:00Z')", (tag_id,))
    conn.commit()
    check("FK rejects bad station_id", False, "insert unexpectedly succeeded")
except sqlite3.IntegrityError:
    check("FK rejects bad station_id", True)

conn.close()

# ── Summary ───────────────────────────────────────────────────────────────────

print("\n" + "=" * 60)
if _failures:
    print(f"\033[91m  {len(_failures)} FAILED:\033[0m")
    for f in _failures:
        print(f"    - {f}")
    sys.exit(1)
else:
    print("\033[92m  All database tests passed.\033[0m")
