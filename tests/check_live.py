import sys, sqlite3
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))
from config import DB_PATH

conn = sqlite3.connect(str(DB_PATH))

print("=== Last 10 rfid_events ===")
for r in conn.execute(
    "SELECT event_id, ibus_number, antenna_location, rssi, read_time "
    "FROM rfid_events ORDER BY event_id DESC LIMIT 10"
).fetchall():
    print(f"  [{r[0]}] {r[1]} | {r[2]} | RSSI:{r[3]} | {r[4]}")

print()
print("=== Session counts by status ===")
for r in conn.execute(
    "SELECT status, COUNT(*) FROM station_sessions GROUP BY status"
).fetchall():
    print(f"  {r[0]}: {r[1]}")

print()
print("=== Open alerts ===")
for r in conn.execute(
    "SELECT alert_type, ibus_number, severity, created_at "
    "FROM station_alerts WHERE status='Open' ORDER BY alert_id DESC LIMIT 10"
).fetchall():
    print(f"  [{r[2]}] {r[0]} - {r[1]} at {r[3]}")

conn.close()
