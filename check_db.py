"""Check database schema"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from config import DB_PATH
import sqlite3

try:
    conn = sqlite3.connect(DB_PATH)
    print(f"Database: {DB_PATH}")
    print("\n=== tag_reads ===")
    for row in conn.execute("PRAGMA table_info(tag_reads)"):
        print(f"  {row[0]:3} {row[1]:30} {row[2]}")
    
    print("\n=== Sample Data ===")
    rows = conn.execute("SELECT * FROM tag_reads LIMIT 3").fetchall()
    if rows:
        for r in rows:
            print(f"  {r}")
    else:
        print("  (no data)")
    
    print("\n=== Count ===")
    count = conn.execute("SELECT COUNT(*) FROM tag_reads").fetchone()[0]
    print(f"  Total sessions: {count}")
    open_count = conn.execute("SELECT COUNT(*) FROM tag_reads WHERE status='IN_PROGRESS'").fetchone()[0]
    print(f"  Open (IN_PROGRESS): {open_count}")
    complete_count = conn.execute("SELECT COUNT(*) FROM tag_reads WHERE status='COMPLETE'").fetchone()[0]
    print(f"  Complete: {complete_count}")
    exit_only_count = conn.execute("SELECT COUNT(*) FROM tag_reads WHERE status='EXIT_ONLY'").fetchone()[0]
    print(f"  Exit Only: {exit_only_count}")
    
    print("\n=== Recent Sessions (last 10) ===")
    recent = conn.execute("SELECT id, \"IBUS #\", status, first_enter_at_ant1, first_exit_at_ant2, dwell_seconds FROM tag_reads ORDER BY id DESC LIMIT 10").fetchall()
    for r in recent:
        epc_short = r[1][:20] if r[1] else '-'
        enter = r[3][:19] if r[3] else '-'
        exit = r[4][:19] if r[4] else '-'
        dwell = f"{r[5]}s" if r[5] else '-'
        print(f"  ID:{r[0]:3} | {epc_short:22} | {r[2]:12} | Enter:{enter:19} | Exit:{exit:19} | Dwell:{dwell}")
    
    conn.close()
except Exception as e:
    print(f"Error: {e}")
    print(f"Database may not exist yet. Run listener first.")
