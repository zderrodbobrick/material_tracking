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
# Paths in DB_PATH are relative to the project root (BASE_DIR), not the
# process cwd — so the listener (started from tracking/) and api.py share one DB.
_raw_db = os.getenv("DB_PATH", "database/rfid_reads.db")
_db_path = Path(_raw_db)
DB_PATH = _db_path if _db_path.is_absolute() else BASE_DIR / _db_path

# ── Antenna Configuration ───────────────────────────────────────────────────
ENTRY_ANTENNA = int(os.getenv("ENTRY_ANTENNA", "1"))
EXIT_ANTENNA = int(os.getenv("EXIT_ANTENNA", "2"))

# ── RSSI Filter ───────────────────────────────────────────────────────────────
# Valid reads must satisfy: RSSI_MIN <= rssi <= 0
# Lower = greater range, Higher = more selective (less cross-antenna reads)
# Use -55 if antennas are close, -65 if far apart
RSSI_MIN = int(os.getenv("RSSI_MIN", "-65"))

# Exit antenna (port 2): only reads with rssi >= EXIT_RSSI_MIN set exit_time.
# The last such valid read wins; weaker reads are logged but ignored for close.
EXIT_RSSI_MIN = int(os.getenv("EXIT_RSSI_MIN", "-65"))

# Temporal filtering: require N reads within throttle window before session starts
# Prevents stray/distant tags from creating sessions (1=disabled, 3=balanced, 5=strict)
MIN_READS_FOR_SESSION = int(os.getenv("MIN_READS_FOR_SESSION", "3"))

# Set to True to only process tags containing "IBUS" in their EPC value.
# Set to False to accept all tags regardless of EPC content.
CHECK_FOR_IBUS = False

# EPC whitelist filter - only process tags matching this readable pattern.
# Automatically set based on CHECK_FOR_IBUS above; override with EPC_FILTER_PATTERN env var if needed.
EPC_FILTER_PATTERN = os.getenv("EPC_FILTER_PATTERN", r".*IBUS.*" if CHECK_FOR_IBUS else r".*")

# ── Session Management ────────────────────────────────────────────────────────
# Fast-moving tags: lower throttle for higher resolution, shorter timeouts
RAW_THROTTLE_SEC = float(os.getenv("RAW_THROTTLE_SEC", "0.05"))     # 50ms between stored reads
IDLE_TIMEOUT_SEC = float(os.getenv("IDLE_TIMEOUT_SEC", "60.0"))      # Idle (non-exit) before sweeper acts
# After the last valid exit-antenna read (>= EXIT_RSSI_MIN), wait this long with no
# new exit reads before closing. Keeps the session live while the tag passes ant 2;
# exit_time stays the timestamp of that last valid read. Set to 0 to close immediately.
EXIT_IDLE_TIMEOUT_SEC = float(os.getenv("EXIT_IDLE_TIMEOUT_SEC", "5.0"))
ABANDON_TIMEOUT_SEC = float(os.getenv("ABANDON_TIMEOUT_SEC", "14400"))  # 4 h — keep alive until antenna 2
SWEEP_INTERVAL_SEC = float(os.getenv("SWEEP_INTERVAL_SEC", "1.0"))  # Check every second

# ── Database Pruning ──────────────────────────────────────────────────────────
RAW_MAX_ROWS = int(os.getenv("RAW_MAX_ROWS", "20000"))
PRUNE_EVERY_N_INSERTS = int(os.getenv("PRUNE_EVERY_N_INSERTS", "200"))

# ── Station / Reader Identity ────────────────────────────────────────────────
# Set these per-machine so every read is traceable to a physical station + reader.
# Each machine runs its own listener bound to one station. Override via env / .env
# when deploying to a new station (e.g. Tennoner, Anderson).
STATION_NAME     = os.getenv("STATION_NAME", "Gannomat")        # must match a stations row
STATION_TYPE     = os.getenv("STATION_TYPE", "Drilling")
STATION_LOCATION = os.getenv("STATION_LOCATION", "TPF CL")      # plant/site, stored on the reader
READER_NAME      = os.getenv("READER_NAME",  "FX9600-Gannomat")
READER_IP        = os.getenv("READER_IP",    "")                # reader device IP

# ── Printer Configuration ───────────────────────────────────────────────────
PRINTER_IP = os.getenv("PRINTER_IP", "10.25.100.157")
PRINTER_PORT = int(os.getenv("PRINTER_PORT", "9100"))

# ── Event Type Constants (part_station_events.event_type) ────────────────────
ENTER_EVENT = "ENTER"
EXIT_EVENT = "EXIT"

# ── Session Status Constants (part_station_sessions.session_status) ───────────
STATUS_OPEN = "open"
STATUS_CLOSED = "closed"
STATUS_ABANDONED = "abandoned"
STATUS_EXIT_ONLY = "exit_only"

# ── Sewio RTLS ────────────────────────────────────────────────────────────────
def _env_bool(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in ("1", "true", "yes", "on")


ENABLE_LIVE_INGESTION = _env_bool("ENABLE_LIVE_INGESTION", False)

_sewio_host = os.getenv("SEWIO_WS_HOST", "wss://10.25.80.13").rstrip("/")
if not _sewio_host.endswith("/sensmapserver/api"):
    _sewio_api_base = f"{_sewio_host}/sensmapserver/api"
else:
    _sewio_api_base = _sewio_host

SEWIO_WS_URL = os.getenv("SEWIO_WS_URL", _sewio_api_base)
SEWIO_REST_URL = os.getenv(
    "SEWIO_REST_URL",
    SEWIO_WS_URL.replace("wss://", "https://").replace("ws://", "http://"),
)
SEWIO_API_KEY = os.getenv("SEWIO_API_KEY", "")
SEWIO_FEED_ID = os.getenv("SEWIO_FEED_ID", "").strip()
SEWIO_LIVE_OFFSET_HOURS = int(os.getenv("SEWIO_LIVE_OFFSET_HOURS", "0"))
SEWIO_VERIFY_SSL = _env_bool("SEWIO_VERIFY_SSL", False)

# Optional extra zone IDs for this machine's station (zone→station map is in RTLS/zoneMappings.json)
_raw_zone_ids = os.getenv("SEWIO_STATION_ZONE_IDS", "")
SEWIO_STATION_ZONE_IDS: set[int] = {
    int(z.strip()) for z in _raw_zone_ids.split(",") if z.strip().isdigit()
}

RTLS_DATA_DIR = Path(os.getenv("RTLS_DATA_DIR", BASE_DIR / "RTLS"))
