"""
Centralized configuration for RFID Tracking System.
Loads from environment variables and .env file.
"""

import os
from pathlib import Path
from dotenv import load_dotenv

# Load .env file if present
load_dotenv()

# Base paths
BASE_DIR = Path(__file__).resolve().parent

# ── Listener Settings ─────────────────────────────────────────────────────────
LISTENER_HOST = os.getenv("LISTENER_HOST", "0.0.0.0")
LISTENER_PORT = int(os.getenv("LISTENER_PORT", "5000"))

# ── Database ────────────────────────────────────────────────────────────────
DB_PATH = Path(os.getenv("DB_PATH", BASE_DIR / "database" / "rfid_reads.db"))

# ── Antenna Configuration ───────────────────────────────────────────────────
ENTRY_ANTENNA = int(os.getenv("ENTRY_ANTENNA", "1"))
EXIT_ANTENNA = int(os.getenv("EXIT_ANTENNA", "2"))

# ── RSSI Filter ───────────────────────────────────────────────────────────────
# Valid reads must satisfy: RSSI_MIN <= rssi <= 0
# Lower = greater range, Higher = more selective (less cross-antenna reads)
# Use -55 if antennas are close, -65 if far apart
RSSI_MIN = int(os.getenv("RSSI_MIN", "-60"))

# Temporal filtering: require N reads within throttle window before session starts
# Prevents stray/distant tags from creating sessions (1=disabled, 3=balanced, 5=strict)
MIN_READS_FOR_SESSION = int(os.getenv("MIN_READS_FOR_SESSION", "0"))

# EPC whitelist filter - only process tags matching this readable pattern.
# Default accepts values like S6IBUS459302.
EPC_FILTER_PATTERN = os.getenv("EPC_FILTER_PATTERN", r".*IBUS.*")  # Only require IBUS in tag value

# ── Session Management ────────────────────────────────────────────────────────
# Fast-moving tags: lower throttle for higher resolution, shorter timeouts
RAW_THROTTLE_SEC = float(os.getenv("RAW_THROTTLE_SEC", "0.05"))     # 50ms between stored reads
IDLE_TIMEOUT_SEC = float(os.getenv("IDLE_TIMEOUT_SEC", "5.0"))      # Idle after last read before sweeper acts
ABANDON_TIMEOUT_SEC = float(os.getenv("ABANDON_TIMEOUT_SEC", "14400"))  # 4 h — keep alive until antenna 2
SWEEP_INTERVAL_SEC = float(os.getenv("SWEEP_INTERVAL_SEC", "1.0"))  # Check every second

# ── Database Pruning ──────────────────────────────────────────────────────────
RAW_MAX_ROWS = int(os.getenv("RAW_MAX_ROWS", "20000"))
PRUNE_EVERY_N_INSERTS = int(os.getenv("PRUNE_EVERY_N_INSERTS", "200"))

# ── Printer Configuration ───────────────────────────────────────────────────
PRINTER_IP = os.getenv("PRINTER_IP", "10.25.100.157")
PRINTER_PORT = int(os.getenv("PRINTER_PORT", "9100"))

# ── Status Constants ─────────────────────────────────────────────────────────
STATUS_OPEN = "IN_PROGRESS"
STATUS_CLOSED = "COMPLETE"
STATUS_ABANDONED = "ABANDONED"
STATUS_EXIT_ONLY = "EXIT_ONLY"
