import sqlite3, sys
sys.path.insert(0, '.')
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass
from config import (DB_PATH, STATION_NAME, STATION_TYPE, STATION_LOCATION,
                    READER_NAME, READER_IP, ENTRY_ANTENNA, EXIT_ANTENNA)
from database.migrate import run_migrations

c = sqlite3.connect(str(DB_PATH), isolation_level=None)
c.execute("PRAGMA journal_mode=WAL")
c.execute("PRAGMA foreign_keys=OFF")

# In-place clean reset (file is locked by OneDrive, so we drop objects instead of deleting the file)
views = [r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='view'")]
for v in views:
    c.execute(f'DROP VIEW IF EXISTS "{v}"')
tables = [r[0] for r in c.execute(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")]
for t in tables:
    c.execute(f'DROP TABLE IF EXISTS "{t}"')
print("dropped views:", views)
print("dropped tables:", tables)

c.execute("PRAGMA foreign_keys=ON")
run_migrations(c, station_name=STATION_NAME, station_type=STATION_TYPE,
               station_location=STATION_LOCATION, reader_name=READER_NAME,
               reader_ip=READER_IP, entry_antenna=ENTRY_ANTENNA, exit_antenna=EXIT_ANTENNA)

print("TABLES:", [r[0] for r in c.execute(
    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")])
print("VIEWS:", [r[0] for r in c.execute(
    "SELECT name FROM sqlite_master WHERE type='view'")])
print("MIGRATIONS:", [r[0] for r in c.execute(
    "SELECT version FROM schema_migrations ORDER BY version")])
print("STATIONS:", c.execute("SELECT COUNT(*) FROM stations").fetchone()[0])
print("READERS:", c.execute("SELECT reader_name, location_description FROM rfid_readers").fetchall())
print("ANTENNAS:", c.execute("SELECT antenna_port, antenna_role FROM rfid_antennas").fetchall())
c.close()
