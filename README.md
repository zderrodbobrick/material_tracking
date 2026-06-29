# RFID Tracking System

Track RFID labels as they pass between two antennas, measuring dwell time from entry to exit.

## Quick Start

```bash
# 1. Install dependencies
pip install -r requirements.txt

# 2. Configure environment
copy .env.example .env
# Edit .env with your settings (antenna numbers, RSSI threshold, etc.)

# 3. Start the listener
python tracking/listener.py

# 4. Point your Zebra reader to http://YOUR_PC_IP:5000/tags
```

## Architecture

- **listener.py** - HTTP server receiving tag reads from the RFID reader
- **storage.py** - SQLite database with session tracking and dwell time calculation
- **config.py** - Centralized configuration loaded from `.env`

## Database

Tables:
- `tag_reads` - Raw filtered reads (EPC, antenna, RSSI, timestamp)
- `component_sessions` - One row per pass with dwell time calculation

Session statuses:
- `IN_PROGRESS` - Tag seen on entry antenna only
- `COMPLETE` - Tag passed both antennas (dwell calculated)
- `ABANDONED` - Tag never reached exit antenna
- `EXIT_ONLY` - Tag seen on exit without matching entry

## Printer Utilities

```bash
# Encode a random RFID tag
python printer/encode_rfid_only.py

# Encode specific EPC
python printer/encode_rfid_only.py --epc AABBCCDDEEFF001122334455

# Print test labels
python printer/print_labels.py
```

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `LISTENER_HOST` | 0.0.0.0 | Bind address for HTTP server |
| `LISTENER_PORT` | 5000 | Port for HTTP server |
| `ENTRY_ANTENNA` | 1 | Antenna ID for entry reads |
| `EXIT_ANTENNA` | 2 | Antenna ID for exit reads |
| `RSSI_MIN` | -40 | Minimum valid signal strength (dBm) |
| `IDLE_TIMEOUT_SEC` | 60 | Auto-close sessions after idle time |

## Health Check

```bash
python tracking/listener.py --health
```

## File Structure

```
RFID_Tracking/
├── .env                  # Your local configuration (not in git)
├── .env.example          # Template for configuration
├── config.py             # Configuration loader
├── requirements.txt      # Python dependencies
├── tracking/
│   ├── listener.py       # HTTP server for RFID events
│   ├── storage.py        # Database and session logic
│   └── labels.json       # EPC to part metadata mapping
├── database/
│   └── rfid_reads.db     # SQLite database
├── printer/
│   ├── encode_rfid_only.py
│   ├── print_labels.py
│   └── RFID-Test-ZEBRA.lbl
├── docs/
│   └── architecture.html # System diagrams
└── archive/              # Deprecated code
```
