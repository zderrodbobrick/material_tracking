"""Quick DB health check - dumps the normalized schema, seeds, and recent activity."""
import sys
from pathlib import Path
try:
    sys.stdout.reconfigure(encoding="utf-8")
except (AttributeError, ValueError):
    pass
sys.path.insert(0, str(Path(__file__).parent))
from config import DB_PATH
import sqlite3

CORE_TABLES = [
    "rfid_tags", "parts", "part_tag_assignments",
    "stations", "rfid_readers", "rfid_antennas",
    "rfid_raw_reads", "part_station_events", "part_station_sessions",
]
OPERATOR_TABLES = ["operators", "operator_station_presence", "part_operator_assignments"]

try:
    conn = sqlite3.connect(DB_PATH)
    print(f"Database: {DB_PATH}")

    tables = {r[0] for r in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table'")}
    views = {r[0] for r in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='view'")}

    print("\n=== schema_migrations ===")
    for row in conn.execute(
        "SELECT version, name, applied_at FROM schema_migrations ORDER BY version"
    ):
        print(f"  v{row[0]:2}  {row[1]:26}  {row[2]}")

    print("\n=== Core tables (9) ===")
    for t in CORE_TABLES:
        mark = "OK " if t in tables else "!! "
        n = conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0] if t in tables else "-"
        print(f"  [{mark}] {t:24} rows={n}")

    print("\n=== Operator tables (3) ===")
    for t in OPERATOR_TABLES:
        mark = "OK " if t in tables else "!! "
        n = conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0] if t in tables else "-"
        print(f"  [{mark}] {t:24} rows={n}")

    print("\n=== View ===")
    print(f"  [{'OK ' if 'vw_live_part_status' in views else '!! '}] vw_live_part_status")

    print("\n=== stations ===")
    for row in conn.execute(
        "SELECT station_id, station_name, station_type, is_active FROM stations ORDER BY station_id"
    ):
        print(f"  {row}")

    print("\n=== readers ===")
    for row in conn.execute(
        "SELECT r.reader_id, r.reader_name, r.reader_ip, s.station_name "
        "FROM rfid_readers r LEFT JOIN stations s ON r.station_id = s.station_id"
    ):
        print(f"  {row}")

    print("\n=== antennas ===")
    for row in conn.execute(
        "SELECT antenna_id, antenna_port, antenna_name, antenna_role FROM rfid_antennas ORDER BY antenna_id"
    ):
        print(f"  {row}")

    print("\n=== Session counts ===")
    total = conn.execute("SELECT COUNT(*) FROM part_station_sessions").fetchone()[0]
    print(f"  Total sessions : {total}")
    for status in ("open", "closed", "abandoned", "exit_only"):
        n = conn.execute(
            "SELECT COUNT(*) FROM part_station_sessions WHERE session_status=?", (status,)
        ).fetchone()[0]
        print(f"  {status:14} : {n}")

    print(f"\n  Raw reads      : {conn.execute('SELECT COUNT(*) FROM rfid_raw_reads').fetchone()[0]}")
    print(f"  Events         : {conn.execute('SELECT COUNT(*) FROM part_station_events').fetchone()[0]}")
    print(f"  Tags / Parts   : {conn.execute('SELECT COUNT(*) FROM rfid_tags').fetchone()[0]}"
          f" / {conn.execute('SELECT COUNT(*) FROM parts').fetchone()[0]}")

    print("\n=== Recent sessions (last 10, via vw_live_part_status) ===")
    for r in conn.execute(
        "SELECT session_id, epc, part_name, station_name, session_status, "
        "       entry_time, exit_time, dwell_seconds "
        "FROM vw_live_part_status ORDER BY session_id DESC LIMIT 10"
    ):
        epc = (r[1] or "-")[:18]
        part = (r[2] or "-")[:8]
        enter = (r[5] or "-")[:19]
        exit_ = (r[6] or "-")[:19]
        dwell = f"{r[7]}s" if r[7] is not None else "-"
        print(f"  ID:{r[0]:4} | {epc:20} | {part:8} | {r[3] or '-':14} | "
              f"{r[4]:9} | In:{enter:19} | Out:{exit_:19} | {dwell}")

    conn.close()
except Exception as e:
    print(f"Error: {e}")
    print("Database may not exist yet. Run the listener or migrations first.")
