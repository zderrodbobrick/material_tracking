# RFID Tracking System — Codebase Reference

## 1. Project Overview

The RFID Tracking System is a Python + React application that tracks manufacturing parts through a **Gannomat station** at Bobrick Washroom Equipment. RFID tags on parts are read by a **Zebra FX9600** reader at two antenna zones (entrance and exit). The system records when each tagged part enters and exits the station, calculates **dwell time** (how long the part remained inside), and exposes that data through a REST API and a live React dashboard.

**Business context:** Bobrick manufactures washroom equipment. Parts moving through CNC/machining stations (starting with the Gannomat POC) are identified by IBUS numbers encoded on RFID labels. Tracking dwell time and queue status supports shop-floor visibility, process timing analysis, and future expansion to additional stations (Tenoner, Anderson, etc.).

**Key capabilities:**

- Receive RFID tag events from a Zebra reader via HTTP POST
- Filter reads by RSSI strength, EPC pattern, and temporal deduplication
- Track per-tag **sessions** from entrance antenna → exit antenna
- Persist sessions in SQLite with statuses: `IN_PROGRESS`, `COMPLETE`, `ABANDONED`, `EXIT_ONLY`
- Background session sweeper for idle/abandoned sessions
- REST API for session queries and dashboard metrics
- Socket.IO push (`rfid_update`) when database changes
- React live dashboard with summary cards, live queue, completed history, and recent reads
- Zebra label printer utilities for encoding and printing RFID test labels

---

## 2. Architecture Overview

### Component diagram (prose)

```
┌─────────────────┐     HTTP POST /tags      ┌──────────────────┐
│ Zebra FX9600    │ ────────────────────────►│ listener.py      │
│ RFID Reader     │   (tag events JSON)      │ (Flask, :5000)   │
└─────────────────┘                          └────────┬─────────┘
                                                      │
                                                      ▼
                                             ┌──────────────────┐
                                             │ storage.py       │
                                             │ DwellTracker     │
                                             └────────┬─────────┘
                                                      │
                                                      ▼
                                             ┌──────────────────┐
                                             │ rfid_reads.db    │
                                             │ (SQLite, WAL)    │
                                             └────────┬─────────┘
                                                      │
                        ┌─────────────────────────────┤
                        ▼                             ▼
               ┌──────────────────┐          ┌──────────────────┐
               │ api.py           │          │ Background       │
               │ (Flask+SocketIO  │◄─────────│ DB poller thread │
               │  :5001)          │  poll    │ (0.5s interval)  │
               └────────┬─────────┘          └──────────────────┘
                        │
          REST + Socket.IO│
                        ▼
               ┌──────────────────┐
               │ React Dashboard  │
               │ (Vite, :5173 dev │
               │  or dist/:5001)  │
               └──────────────────┘
```

### Data flow: physical scan → dashboard

1. A part with an RFID tag passes the **entrance antenna** (antenna 1 by default).
2. The Zebra FX9600 reader POSTs a JSON event batch to `http://<host>:5000/tags`.
3. `listener.py` filters events (RSSI, EPC pattern), logs accepted reads, and calls `DwellTracker.ingest_batch()`.
4. `storage.py` applies strongest-signal-wins deduplication, throttle, and session logic:
   - First sustained entrance read → new row in `tag_reads` with `status = IN_PROGRESS`
   - Subsequent entrance reads → update `last_enter_at_ant1`
   - First exit read on antenna 2 → calculate dwell, set `status = COMPLETE`
5. Data is written to `database/rfid_reads.db`.
6. `api.py` background thread polls the DB every 0.5s; on change it emits `rfid_update` via Socket.IO.
7. The React dashboard receives `rfid_update`, re-fetches HTTP endpoints, and re-renders tables and cards.

### Technology stack

| Layer | Language / Framework | Library | Purpose |
|-------|---------------------|---------|---------|
| RFID ingest | Python 3 | Flask | HTTP listener on port 5000 |
| Session logic | Python 3 | sqlite3 | Dwell tracking, persistence |
| API server | Python 3 | Flask, flask-cors, flask-socketio | REST + WebSocket on port 5001 |
| Config | Python 3 | python-dotenv | `.env` loading |
| Dashboard | JavaScript (ESM) | React 19, Vite 8 | SPA frontend |
| Styling | CSS | Tailwind CSS 4 | Utility-first UI |
| Real-time client | JavaScript | socket.io-client 4 | Live updates |
| Icons | JavaScript | lucide-react | Header/card icons |
| Database | SQLite | WAL mode | `database/rfid_reads.db` |
| Printer (Windows) | Python 3 | pywin32 | Raw ZPL to named printer |
| Printer (network) | Python 3 | socket (stdlib) | TCP ZPL to printer IP:9100 |
| Legacy reader | Python 3 | sllurp (archived) | Direct LLRP connection |

---

## 3. Configuration & Environment

### `config.py` variables

| Variable | Type | Default | Meaning |
|----------|------|---------|---------|
| `BASE_DIR` | `Path` | Parent of `config.py` | Project root directory |
| `LISTENER_HOST` | `str` | `"0.0.0.0"` | Bind address for RFID HTTP listener |
| `LISTENER_PORT` | `int` | `5000` | Port for RFID HTTP listener |
| `DB_PATH` | `Path` | `database/rfid_reads.db` | SQLite database file path |
| `ENTRY_ANTENNA` | `int` | `1` | Antenna ID treated as entrance |
| `EXIT_ANTENNA` | `int` | `2` | Antenna ID treated as exit |
| `RSSI_MIN` | `int` | `-60` | Minimum valid RSSI (dBm); valid range is `RSSI_MIN <= rssi <= 0` |
| `MIN_READS_FOR_SESSION` | `int` | `0` | Sustained reads required before opening a session (`0` = disabled) |
| `EPC_FILTER_PATTERN` | `str` (regex) | `r".*IBUS.*"` | Full-match regex against **decoded** EPC ASCII; empty = accept all |
| `RAW_THROTTLE_SEC` | `float` | `0.05` | Minimum seconds between stored reads per (EPC, antenna) |
| `IDLE_TIMEOUT_SEC` | `float` | `5.0` | Idle time before sweeper acts on open session |
| `ABANDON_TIMEOUT_SEC` | `float` | `14400` | Seconds (4h) before entrance-only session is abandoned |
| `SWEEP_INTERVAL_SEC` | `float` | `1.0` | Background sweeper check interval |
| `RAW_MAX_ROWS` | `int` | `20000` | Pruning threshold (defined but pruning stub in code) |
| `PRUNE_EVERY_N_INSERTS` | `int` | `200` | Prune trigger interval (defined but pruning stub) |
| `PRINTER_IP` | `str` | `"10.25.100.157"` | Zebra printer IP for TCP ZPL |
| `PRINTER_PORT` | `int` | `9100` | Zebra printer raw port |
| `STATUS_OPEN` | `str` | `"IN_PROGRESS"` | Session status constant |
| `STATUS_CLOSED` | `str` | `"COMPLETE"` | Session status constant |
| `STATUS_ABANDONED` | `str` | `"ABANDONED"` | Session status constant |
| `STATUS_EXIT_ONLY` | `str` | `"EXIT_ONLY"` | Session status constant |

### `.env.example` variables

| Variable | Example value | Notes |
|----------|---------------|-------|
| `LISTENER_HOST` | `0.0.0.0` | Same as config default |
| `LISTENER_PORT` | `5000` | Reader POST target port |
| `DB_PATH` | `database/rfid_reads.db` | Relative to project root |
| `ENTRY_ANTENNA` | `1` | Entrance zone |
| `EXIT_ANTENNA` | `2` | Exit zone |
| `RSSI_MIN` | `-65` | Stricter than code default (`-60`) |
| `MIN_READS_FOR_SESSION` | `3` | Requires 3 reads to start session |
| `EPC_FILTER_PATTERN` | `49425553` | Hex pattern for "IBUS" (note: code matches decoded ASCII, not hex) |
| `RAW_THROTTLE_SEC` | `0.05` | 50ms throttle |
| `IDLE_TIMEOUT_SEC` | `2.0` | Faster idle close than code default |
| `ABANDON_TIMEOUT_SEC` | `5.0` | Much shorter than code default (4h) |
| `SWEEP_INTERVAL_SEC` | `0.5` | Faster sweeper |
| `RAW_MAX_ROWS` | `20000` | Pruning config |
| `PRUNE_EVERY_N_INSERTS` | `200` | Pruning config |
| `PRINTER_IP` | `10.25.100.157` | Network printer |
| `PRINTER_PORT` | `9100` | Raw socket port |

> **Note:** `.env.example` values differ from `config.py` defaults in several places (RSSI, timeouts, EPC pattern). Copy to `.env` and adjust for your deployment.

### New environment setup (step-by-step)

1. Clone/copy the project to your machine.
2. Create a Python virtual environment: `python -m venv .venv`
3. Activate it and install dependencies: `pip install -r requirements.txt`
4. Copy configuration: `copy .env.example .env` (Windows) and edit values for your reader IP, antennas, RSSI, and printer.
5. Ensure `database/` directory exists (created automatically on first DB write).
6. Start services: `.\start.ps1` from project root (starts API on 5001, listener on 5000).
7. Configure the Zebra FX9600 reader to POST tag events to `http://<YOUR_PC_IP>:5000/tags`.
8. (Optional) Build dashboard: `cd dashboard && npm install && npm run build` — API serves `dashboard/dist` at `http://localhost:5001/`.
9. (Optional) Dev dashboard: `cd dashboard && npm run dev` — Vite on port 5173 (API still on 5001).
10. Verify: `python tracking/listener.py --health` or `python check_db.py`.

---

## 4. Backend — `api.py`

### Purpose and role

`api.py` is the **read/query and dashboard API server** running on port **5001**. It:

- Serves the built React dashboard from `dashboard/dist` (if present)
- Exposes REST endpoints over the `tag_reads` SQLite table
- Runs Flask-SocketIO with a background DB poller that emits `rfid_update` on data changes
- Does **not** receive RFID events directly (that is `listener.py`'s job)

### Flask app setup

```python
app = Flask(__name__, static_folder=None)
CORS(app, origins='*')
socketio = SocketIO(app, cors_allowed_origins='*', async_mode='threading')
```

- CORS: all origins allowed (development)
- SocketIO: threading mode, all origins
- `get_db()`: opens SQLite, ensures `tag_reads` table exists via inline DDL

### REST endpoints

#### `GET /`

**Purpose:** Serve dashboard or API index.

**Response (no dist build):**
```json
{
  "endpoints": [
    "/api/sessions - List recent sessions",
    "/api/sessions/<id> - Get session details",
    "/api/sessions/open - Currently open sessions",
    "/api/tag/<epc> - All sessions for a tag",
    "/api/stats - Summary statistics",
    "/api/reads/recent - Recent tag reads"
  ]
}
```

---

#### `GET /assets/<path:filename>`

Serves static assets from `dashboard/dist/assets/`.

---

#### `GET /api/sessions`

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `limit` | int | 50 | Max rows |

**Response:** Array of:
```json
{
  "id": 1,
  "epc": "S6IBUS459302",
  "entered": "2026-06-26T08:42:15+00:00",
  "exited": "2026-06-26T08:47:11+00:00",
  "dwell_seconds": 296,
  "status": "COMPLETE"
}
```

---

#### `GET /api/sessions/<session_id>`

**Response:** Full row from `tag_reads` (all columns). **404** if not found.

---

#### `GET /api/sessions/open`

**Response:** Array of `IN_PROGRESS` sessions:
```json
{
  "id": 1,
  "epc": "S6IBUS459302",
  "entered": "...",
  "last_seen": "...",
  "status": "IN_PROGRESS"
}
```

---

#### `GET /api/tag/<epc>`

**Response:**
```json
{
  "epc": "S6IBUS459302",
  "sessions": [{ "id": 1, "entered": "...", "exited": "...", "dwell_seconds": 296, "status": "COMPLETE" }],
  "count": 3
}
```

---

#### `GET /api/stats`

**Response:**
```json
{
  "total_sessions": 100,
  "complete": 80,
  "in_progress": 5,
  "avg_dwell_seconds": 862.5,
  "reads_last_hour": 100
}
```

> **Note:** `reads_last_hour` currently returns total session count, not actually filtered to the last hour.

---

#### `GET /api/reads/recent`

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `limit` | int | 50 | Max rows |
| `seconds` | int | 60 | Declared but **not used** in query |

**Response:**
```json
[{
  "IBUS #": "S6IBUS459302",
  "first_enter_at_ant1": "...",
  "first_enter_rssi_ant1": -48,
  "status": "IN_PROGRESS"
}]
```

---

#### `GET /api/dashboard/summary`

Dashboard summary cards data.

**Response:**
```json
{
  "parts_in_process": 3,
  "completed_today": 42,
  "average_dwell_seconds_today": 862.0,
  "average_dwell_display_today": "14 min 22 sec",
  "active_alerts": 0,
  "last_rfid_read_time": "2026-06-26T09:41:55",
  "reader_status": "Active"
}
```

**Reader status logic:**
- `"Waiting for Reads"` — no reads ever
- `"Active"` — last read within 60 seconds
- `"No Recent Reads"` — last read > 60 seconds ago

---

#### `GET /api/gannomat/live-status`

Active sessions (`IN_PROGRESS`, `EXIT_ONLY`), sorted oldest entrance first.

**Response:**
```json
[{
  "id": 1,
  "ibus_number": "S6IBUS459302",
  "status": "IN_PROGRESS",
  "entrance_time": "...",
  "entrance_epoch_ms": 1719398535000,
  "last_seen": "...",
  "last_rssi": -48,
  "exit_time": null,
  "last_exit_time": null,
  "last_exit_rssi": null,
  "dwell_seconds": null
}]
```

---

#### `POST /api/sessions/<session_id>/end`

Manually end a session (sets `ABANDONED`, calculates dwell from entrance to now).

**Response:**
```json
{ "success": true, "dwell_seconds": 7200 }
```

**404** if session not found.

---

#### `GET /api/gannomat/completed`

Last 25 sessions with status `COMPLETE`, `ABANDONED`, or `EXIT_ONLY`.

**Response:**
```json
[{
  "id": 1,
  "ibus_number": "S6IBUS459302",
  "status": "COMPLETE",
  "entrance_time": "...",
  "exit_time": "...",
  "dwell_seconds": 1026,
  "entry_rssi": -48,
  "exit_rssi": -52
}]
```

---

### WebSocket events

**Emitted (server → client):**

| Event | Payload | When |
|-------|---------|------|
| `rfid_update` | `{ "ts": "<ISO datetime>" }` | DB row count or max timestamp changes (polled every 0.5s) |

**Received (client → server):** None explicitly handled (standard Socket.IO connect/disconnect only).

**Not implemented** (described in `Plan.md` but absent from code):
- `rfid_event_received`, `station_session_created`, `station_session_updated`, `station_session_completed`, `alert_created`, `alert_resolved`, `dashboard_summary_updated`
- Endpoints: `/api/rfid/events`, `/api/gannomat/alerts`, `/api/gannomat/stats`, `/api/rfid/recent-events`

### Background threads

- **`_background_poll`** (daemon, name `db-poller`): loops every 0.5s, compares `COUNT(*)` and `MAX(timestamp)` against cached state; emits `rfid_update` on change. Exceptions are silently swallowed.

### Error handling patterns

- Missing sessions → `404` with `{"error": "Session not found"}`
- Background poller → bare `except Exception: pass`
- Timestamp parsing in summary/live-status → bare `except Exception: pass`
- No global error handler; invalid requests may return Flask default 404/500

---

## 5. Backend — `tracking/listener.py`

### Purpose

HTTP server that receives tag events from a **Zebra FX9600** reader configured for HTTP POST mode. Persists events via `DwellTracker` and exposes a health endpoint.

### LLRP / sllurp integration

**Not used in the active listener.** The production path is **HTTP POST** (`/tags`). Direct LLRP via `sllurp` exists only in `archive/read.py` (deprecated).

The reader is configured to POST JSON batches to:
```
http://<HOST>:5000/tags
```

### Tag read callback flow

1. `POST /tags` receives raw JSON body (single object or array).
2. `_passes_filters(ev)` checks:
   - `data.peakRssi` is int in `[RSSI_MIN, 0]`
   - `data.idHex` (lowercased) matches `EPC_FILTER_PATTERN` against **decoded ASCII** EPC
3. Filtered reads are printed to console.
4. Full batch (including unfiltered) passed to `tracker.ingest_batch(events)`.
5. State counters updated; returns `"OK", 200` always (even on parse failure).

**Expected event shape (Zebra FX9600 HTTP):**
```json
{
  "timestamp": "2026-05-22T23:40:14.471+0000",
  "data": {
    "idHex": "533649425553343539333032",
    "antenna": 1,
    "peakRssi": -48
  }
}
```

### Deduplication / filtering

**At listener level (display only):**
- RSSI range filter
- EPC regex filter on decoded hex→ASCII

**At storage level (via `DwellTracker.ingest_batch`):**
- Strongest-signal-wins within 100ms per EPC
- Per-(EPC, antenna) throttle (`RAW_THROTTLE_SEC`)
- `MIN_READS_FOR_SESSION` temporal filter before session creation

### Events forwarded to storage and WebSocket

- Storage: all events in batch go to `ingest_batch()` (storage re-filters)
- WebSocket: **not directly** — listener does not talk to SocketIO; API poller detects DB changes

### Additional endpoints

#### `GET /healthz`

**Response:**
```json
{
  "status": "ok",
  "uptime_seconds": 3600,
  "open_sessions": 2,
  "events_total": 1500,
  "batches_total": 800,
  "last_event_seconds_ago": 3,
  "db_writable": true
}
```

Returns **503** if DB is not writable.

### CLI modes

| Command | Behavior |
|---------|----------|
| `python tracking/listener.py` | Start HTTP listener |
| `python tracking/listener.py --health` | Query `/healthz`, exit 0/1/2 |
| `python tracking/listener.py --verbose` | Show Flask request logs |

### Helpers

- `decode_epc(epc)` — hex → ASCII, strip nulls
- `epc_matches_filter(epc)` — regex fullmatch on decoded EPC

---

## 6. Backend — `tracking/storage.py`

### Purpose

SQLite persistence and **dwell/session tracking** for RFID reads. The `DwellTracker` class manages in-memory open sessions, writes to `tag_reads`, and runs a background sweeper thread.

### SQLite schema

**Table: `tag_reads`** (single table for sessions)

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | Session ID |
| `"IBUS #"` | TEXT | NOT NULL | Decoded EPC / IBUS identifier |
| `dwell_seconds` | INTEGER | nullable | Calculated dwell (seconds) |
| `status` | TEXT | NOT NULL, DEFAULT `'IN_PROGRESS'` | Session status |
| `first_enter_at_ant1` | TEXT | nullable | ISO timestamp, first entrance read |
| `first_enter_rssi_ant1` | INTEGER | nullable | RSSI at first entrance |
| `last_enter_at_ant1` | TEXT | nullable | ISO timestamp, last entrance read |
| `last_enter_rssi_ant1` | INTEGER | nullable | RSSI at last entrance |
| `first_exit_at_ant2` | TEXT | nullable | ISO timestamp, first exit read |
| `first_exit_rssi_ant2` | INTEGER | nullable | RSSI at first exit |
| `last_exit_at_ant2` | TEXT | nullable | ISO timestamp, last exit read |
| `last_exit_rssi_ant2` | INTEGER | nullable | RSSI at last exit |

**Indexes:**
- `idx_reads_ibus` on `"IBUS #"`
- `idx_reads_status` on `status`

**PRAGMA settings:** WAL journal, NORMAL synchronous, 5000ms busy timeout.

**Schema migration:** `_ensure_columns()` idempotently adds antenna-suffixed columns, copies from legacy column names (`entered_at`, `first_enter_at`, etc.), drops old columns, and drops `component_sessions_display` view if present.

### Public API — `DwellTracker`

#### `__init__(db_path=_DEFAULT_DB)`

Creates DB directory, connects SQLite, runs migration, recovers open sessions, starts sweeper daemon thread.

#### `ingest_batch(events: Iterable[dict]) -> dict`

Processes a batch of reader events.

**Returns:**
```python
{
    "raw_inserted": int,      # reads passing throttle
    "raw_throttled": int,     # duplicate within throttle window
    "raw_rejected": int,      # failed RSSI filter
    "session_opened": int,
    "session_closed": int,
}
```

**Session logic:**
- **Entrance (`ENTRY_ANTENNA`):** open new session or update last entrance; if re-entry after exit seen, finalize previous session first
- **Exit (`EXIT_ANTENNA`):** first exit read immediately closes session with dwell = exit − entrance; sets `COMPLETE` or `EXIT_ONLY`
- Ignores exit reads with no open session or exit before entrance timestamp

#### `open_session_count() -> int`

Returns count of in-memory open sessions.

#### `close() -> None`

Stops sweeper, closes DB connection.

### Transaction handling

- `isolation_level=None` (autocommit mode)
- Each INSERT/UPDATE executes immediately
- `threading.RLock` protects concurrent access
- Sweeper and ingest share the same connection with `check_same_thread=False`

### Background sweeper

Runs every `SWEEP_INTERVAL_SEC`. On idle >= `IDLE_TIMEOUT_SEC`:
- No entrance reads → finalize as `EXIT_ONLY`
- Has exit reads → finalize as `COMPLETE`
- Entrance only, idle >= `ABANDON_TIMEOUT_SEC` → `ABANDONED`

### Internal classes / functions

| Name | Purpose |
|------|---------|
| `_Session` | In-memory session state |
| `_parse_ts(value)` | Parse ISO timestamps from reader |
| `_valid_rssi(rssi)` | RSSI range check |
| `_decode_epc(epc)` | Hex → ASCII |
| `_epc_matches_filter(epc)` | Regex filter |
| `_recover_open_sessions()` | Reload `IN_PROGRESS`/`EXIT_ONLY` from DB on startup |
| `_finalize(sess, status)` | Close session in DB and memory |
| `_sweep_loop()` / `_sweep_once()` | Background idle cleanup |
| `_prune_raw()` | Stub (only runs `SELECT 1`) |

---

## 7. Backend — `config.py`

Every constant is documented in **Section 3** above. Summary by category:

| Category | Constants |
|----------|-----------|
| Paths | `BASE_DIR`, `DB_PATH` |
| Listener | `LISTENER_HOST`, `LISTENER_PORT` |
| Antennas | `ENTRY_ANTENNA`, `EXIT_ANTENNA` |
| Filtering | `RSSI_MIN`, `MIN_READS_FOR_SESSION`, `EPC_FILTER_PATTERN` |
| Session timing | `RAW_THROTTLE_SEC`, `IDLE_TIMEOUT_SEC`, `ABANDON_TIMEOUT_SEC`, `SWEEP_INTERVAL_SEC` |
| Pruning (unused) | `RAW_MAX_ROWS`, `PRUNE_EVERY_N_INSERTS` |
| Printer | `PRINTER_IP`, `PRINTER_PORT` |
| Status strings | `STATUS_OPEN`, `STATUS_CLOSED`, `STATUS_ABANDONED`, `STATUS_EXIT_ONLY` |

Loaded via `load_dotenv()` at import time; environment variables override defaults.

---

## 8. Frontend — Dashboard

> **Note on filenames:** The codebase uses `SummaryCards.jsx`, `DwellTimer.jsx`, `CompletedTable.jsx`, and `RecentReadsPanel.jsx`.

### 8.1 Entry point (`main.jsx`, `App.jsx`)

#### `main.jsx`

- Bootstraps React 19 with `createRoot`
- Wraps `App` in `StrictMode`
- Imports `index.css` (Tailwind)

#### `App.jsx`

**State:**

| State | Type | Purpose |
|-------|------|---------|
| `summary` | object \| null | Dashboard summary cards |
| `liveSessions` | array | Active queue |
| `completedSessions` | array | Recently completed |
| `recentReads` | array | Recent activity feed |
| `wsStatus` | string | `'connecting'`, `'live'`, `'reconnecting'`, `'offline'` |
| `lastUpdated` | Date \| null | Last successful data fetch |

**Socket connection lifecycle:**
1. On mount: `fetchAll()` loads 4 HTTP endpoints in parallel
2. Creates `io('http://localhost:5001', { transports: ['polling', 'websocket'] })`
3. `connect` → set status `'live'`, re-fetch all data
4. `disconnect` → `'reconnecting'`
5. `connect_error` → `'offline'`
6. `rfid_update` → `fetchAll()`
7. Fallback: `setInterval(fetchAll, 3000)` every 3 seconds
8. Cleanup: disconnect socket, clear interval

**API base:** `http://localhost:5001`

**Layout:** Header → SummaryCards → LiveQueueTable → (CompletedTable + RecentReadsPanel in 2-column grid)

> **Note:** `App.jsx` does **not** use `useSocketData.js` or `lib/socket.js`; it creates its own Socket.IO instance inline.

### 8.2 Custom hook — `useSocketData.js`

**Purpose:** Reusable hook for socket-driven data fetching (currently unused by `App.jsx`).

**Parameters:** `fetcher` — async function returning data

**State returned:**

| Key | Description |
|-----|-------------|
| `data` | Fetched result |
| `error` | Fetch error |
| `loading` | Initial load flag |
| `connected` | Socket connected boolean |
| `refresh` | Manual re-fetch function |

**Socket events subscribed:** `rfid_update` → re-run fetcher, `connect` / `disconnect` → update `connected`.

Uses shared `socket` from `lib/socket.js`.

### 8.3 `lib/socket.js`

```javascript
export const socket = io('http://localhost:5001', { transports: ['polling'] })
```

- Single shared Socket.IO client instance
- Polling transport only (no websocket fallback in this module)
- Used by `useSocketData.js` only

### 8.4 Components

#### `Header.jsx`

**Props:**

| Prop | Type | Description |
|------|------|-------------|
| `wsStatus` | string | Connection status |
| `lastUpdated` | Date \| null | Last data refresh time |

**State:** `now` — current clock, updated every 1 second

**UI:** Dark slate header with title "RFID Gannomat Live Dashboard", subtitle, live clock, "Last Updated" timestamp, and `ConnectionIndicator` (green/yellow/gray/red dot + label).

---

#### `StatusBadge.jsx`

**Props:** `status` — session status string

**UI:** Colored pill badge mapping:

| Status | Label | Color |
|--------|-------|-------|
| `IN_PROGRESS` | In Process | Blue |
| `COMPLETE` | Completed | Green |
| `ABANDONED` | Abandoned | Gray |
| `EXIT_ONLY` | Exit Only | Orange |

---

#### `SummaryCards.jsx`

**Props:** `summary` — object from `/api/dashboard/summary` or null

**State:** None (shows 6 skeleton cards while loading)

**UI:** 6-card grid:
1. Parts In Process
2. Completed Today
3. Avg Dwell Today
4. Active Alerts
5. Last RFID Read (formatted time)
6. Reader Status (color-coded)

Uses lucide-react icons.

---

#### `DwellTimer.jsx`

**Props:**

| Prop | Type | Description |
|------|------|-------------|
| `entranceTime` | ISO string | Entrance timestamp |
| `entranceEpochMs` | number | Pre-computed epoch ms (preferred) |
| `exitTime` | ISO string \| null | Exit time (stops timer) |
| `dwellSeconds` | number \| null | Final dwell for completed sessions |

**State:** `elapsed` — live seconds counter

**Logic:**
- If no entrance → show `—`
- If exit + dwellSeconds → show formatted static dwell
- Otherwise → 1-second interval timer from entrance (clamped if reader clock ahead of browser)

**Exported:** `formatDwell(totalSec)` — formats as `Xm Ys` or `Xh Ym Zs`

---

#### `LiveQueueTable.jsx`

**Props:**

| Prop | Type | Description |
|------|------|-------------|
| `sessions` | array | From `/api/gannomat/live-status` |
| `onEndSession` | function | Callback `(sessionId) => void` |

**State:** `search` (IBUS filter), `statusFilter` (`ALL`, `IN_PROGRESS`, `EXIT_ONLY`)

**UI:** Table with columns: IBUS #, Status, Entrance, Last Seen, RSSI, Current Dwell (live `DwellTimer`), End button. Orange row highlight for `EXIT_ONLY`. Search and status filter in header. Sorted oldest-first (API order).

**End button:** Confirms, calls `POST /api/sessions/<id>/end`.

---

#### `CompletedTable.jsx`

**Props:** `sessions` — from `/api/gannomat/completed`

**State:** `search` — IBUS filter

**UI:** Table: IBUS #, Status, Entrance, Exit, Dwell (formatted), In RSSI, Out RSSI. Shows last 25 per API.

---

#### `RecentReadsPanel.jsx`

**Props:** `reads` — from `/api/reads/recent?limit=20`

**UI:** Table: Read Time, IBUS #, Status, RSSI. Uses `first_enter_at_ant1` as read time (session-level, not per-antenna raw events).

---

### Build configuration

**`package.json` scripts:**
- `dev` — Vite dev server
- `build` — production build to `dist/`
- `lint` — oxlint
- `preview` — preview production build

**`vite.config.js`:** React plugin, Tailwind v4 plugin, dev server on `0.0.0.0:5173`.

---

## 9. Printer / Label Encoding

### `printer/print_labels.py`

**Purpose:** Print RFID test labels to a locally installed Zebra printer via Windows spooler.

**Printer:** Hardcoded `PRINTER_NAME = "ZDesigner ZT411R-300dpi ZPL"`

**Inputs:** Generates one random IBUS label per run in format `{prefix}-{station}-IBUS{number}` (e.g. `1-S1-IBUS1234`).

**ZPL generated:**
- 4×6 label with "4x6 RFID TEST" and "PROPERTY OF BOBRICK" text
- RFID write: `^RFW,H,2,12,1^FD424F25249434B3030313030^FS` (fixed hex payload)
- `generate_zpl(label_text)` computes hex from `label_text` but the ZPL uses a **hardcoded** RFID payload, not the generated label text

**Communication:** `win32print.OpenPrinter` → `StartDocPrinter` → `WritePrinter` with raw ZPL bytes.

---

### `printer/encode_rfid_only.py`

**Purpose:** Send encode-only ZPL to a network Zebra ZT411R (no visible print).

**Encoding approach:**
```zpl
^XA
^RS8
^RFW,H,,,A^FD<EPC>^FS
^XZ
```
- `^RS8` — UHF Gen2 RFID setup
- `^RFW,H,,,A` — write hex EPC to EPC memory bank

**CLI flags:**

| Flag | Description |
|------|-------------|
| `--epc` | 24-char hex EPC (else random 96-bit generated) |
| `--ip` | Printer IP (default from `config.PRINTER_IP`) |
| `--port` | Printer port (default 9100) |
| `--dry-run` | Print ZPL without sending |

**Communication:** TCP socket to `PRINTER_IP:PRINTER_PORT`.

---

### `printer/RFID-Test-ZEBRA.lbl`

Zebra Designer / CADmatic label template file (`.lbl` format, version 6).

**Contents:**
- 80×80 mm label layout with border rectangle
- **Barcode:** CODE128 encoding `"RFID" + Addinfo.001`
- **RFID encode block** (identifier `RFID-Contend`): ZPL sequence `${^RS4^RFW,A^FD"RFID"+Addinfo.001^FS}$`
- Text fields: Run/Plan/PartNo, print datetime (`PRN: DD.MM.YY-HH:MM:SS`)
- Variables: `AddInfo.001`, `PartIsRotated`, `PartNumberAsText`, `Plan`, `Run`

Used as a template reference for Bobrick RFID label design; not invoked directly by Python scripts.

---

## 10. Database

### File location and format

- **Path:** `database/rfid_reads.db` (configurable via `DB_PATH`)
- **Format:** SQLite 3 with WAL journal mode
- **Created:** Automatically on first `DwellTracker` or `api.py` connection

### Full schema — all 5 tables

#### Table: `tag_reads`

The legacy/low-level session table written by `storage.py` / `DwellTracker`.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | Session ID |
| `"IBUS #"` | TEXT | NOT NULL | Decoded EPC / IBUS identifier |
| `dwell_seconds` | INTEGER | nullable | Calculated dwell (seconds) |
| `status` | TEXT | NOT NULL DEFAULT `'IN_PROGRESS'` | Session status |
| `first_enter_at_ant1` | TEXT | nullable | ISO timestamp, first entrance read |
| `first_enter_rssi_ant1` | INTEGER | nullable | RSSI at first entrance |
| `last_enter_at_ant1` | TEXT | nullable | ISO timestamp, last entrance read |
| `last_enter_rssi_ant1` | INTEGER | nullable | RSSI at last entrance |
| `first_exit_at_ant2` | TEXT | nullable | ISO timestamp, first exit read |
| `first_exit_rssi_ant2` | INTEGER | nullable | RSSI at first exit |
| `last_exit_at_ant2` | TEXT | nullable | ISO timestamp, last exit read |
| `last_exit_rssi_ant2` | INTEGER | nullable | RSSI at last exit |

**Indexes:** `idx_reads_ibus` on `"IBUS #"`, `idx_reads_status` on `status`

---

#### Table: `rfid_events`

Raw per-read event log (one row per individual tag read event).

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | Event ID |
| `epc` | TEXT | NOT NULL | Raw hex EPC |
| `ibus_number` | TEXT | NOT NULL | Decoded IBUS identifier |
| `station_name` | TEXT | NOT NULL | Station name (e.g. `"Gannomat"`) |
| `antenna_location` | TEXT | NOT NULL | `"entrance"` or `"exit"` |
| `reader_id` | TEXT | nullable | Reader device identifier |
| `antenna_id` | TEXT | nullable | Physical antenna number |
| `read_time` | DATETIME | NOT NULL | Timestamp of the read |
| `raw` | — | — | (additional raw payload columns) |

**Indexes:** `idx_rfid_events_epc_time` on `(epc, read_time)`, `idx_rfid_events_ibus_time` on `(ibus_number, read_time)`, `idx_rfid_events_station_antenna` on `(station_name, antenna_location)`

---

#### Table: `station_sessions`

Higher-level session table aligned with the Plan.md API design. Tracks entrance-to-exit trips per station.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | Session ID |
| `ibus_number` | TEXT | NOT NULL | IBUS part identifier |
| `status` | TEXT | NOT NULL DEFAULT `'In Process'` | `'In Process'`, `'Completed'`, `'Abandoned'`, `'Exit Only'` |
| `entrance_time` | DATETIME | nullable | First entrance antenna read time |
| `exit_time` | DATETIME | nullable | First exit antenna read time |
| `dwell_time_seconds` | INTEGER | nullable | Calculated dwell in seconds |
| `dwell_time_display` | TEXT | nullable | Human-readable dwell (e.g. `"14 min 22 sec"`) |
| `epc` | TEXT | nullable | Raw hex EPC |
| (other columns) | — | — | See actual schema for full column list |

**Indexes:** `idx_station_sessions_ibus_status` on `(ibus_number, status)`, `idx_station_sessions_station_status` on `(station_name, status)`

> **Note:** Status values in `station_sessions` use Title Case (`"In Process"`, `"Completed"`) while `tag_reads` uses SCREAMING_SNAKE_CASE (`IN_PROGRESS`, `COMPLETE`). These are parallel representations of the same concept.

---

#### Table: `station_alerts`

Alerts generated for anomalous events (e.g. exit without entrance).

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `alert_id` | INTEGER | PRIMARY KEY AUTOINCREMENT | Alert ID |
| `session_id` | INTEGER | nullable | FK → `station_sessions.id` |
| `ibus_number` | TEXT | nullable | Associated IBUS part |
| `station_name` | TEXT | nullable | Station where alert occurred |
| `alert_type` | TEXT | NOT NULL | e.g. `"missing_entrance"` |
| `alert_message` | TEXT | NOT NULL | Human-readable description |
| `severity` | TEXT | NOT NULL DEFAULT `'Medium'` | `'Low'`, `'Medium'`, `'High'` |
| `status` | TEXT | NOT NULL DEFAULT `'Open'` | `'Open'`, `'Resolved'` |

**Index:** `idx_station_alerts_status` on `status`

---

#### Table: `label_prints`

Audit log of every label printed or encoded.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | Record ID |
| `ibus_number` | TEXT | NOT NULL | Part IBUS number printed |
| `epc` | TEXT | nullable | EPC encoded on the label |
| `part_name` | TEXT | nullable | Part name |
| `part_type` | TEXT | nullable | Part type/category |
| `printer_id` | TEXT | nullable | Printer used |
| `encoding_status` | TEXT | NOT NULL DEFAULT `'Unknown'` | `'Success'`, `'Failed'`, `'Unknown'` |
| `print_time` | DATETIME | nullable | When print was sent |
| `created_at` | DATETIME | DEFAULT `CURRENT_TIMESTAMP` | Record creation time |

---

### Record lifecycle

| Action | Trigger | DB effect |
|--------|---------|-----------|
| **Create** | First sustained entrance read | INSERT into `tag_reads` (`IN_PROGRESS`) + INSERT into `station_sessions` (`In Process`) |
| **Update (entrance)** | Subsequent entrance reads | UPDATE last entrance columns in `tag_reads`; INSERT into `rfid_events` |
| **Update (exit)** | First exit read | UPDATE exit columns + dwell in both tables; `COMPLETE` / `Completed` |
| **Close (re-entry)** | Entrance after exit on same EPC | Finalize previous session, open new session |
| **Abandon** | Sweeper idle timeout | `ABANDONED` / `Abandoned` in respective tables |
| **Exit only** | Exit without entrance | `EXIT_ONLY` / `Exit Only`; alert in `station_alerts` |
| **Manual end** | `POST /api/sessions/<id>/end` | `ABANDONED`, dwell calculated |
| **Label print** | `print_labels.py` or encoder | INSERT into `label_prints` |

### Query patterns

- `api.py` reads primarily from `tag_reads` and `station_sessions` via `get_db()`
- `listener.py` / `storage.py` (`DwellTracker`) writes to `tag_reads` and `rfid_events`
- `check_db.py` — ad-hoc schema and sample inspection
- Tests query `rfid_events`, `station_sessions`, `station_alerts` directly

---

## 11. Tests

### Test strategy overview

Tests live in `tests/` and are designed for a **planned/expanded API** (multi-table schema, RFID ingest endpoint, alerts). Several tests **do not match the current `api.py` implementation** and will fail against the codebase as-is.

| Script | Needs API? | Needs DB? | Matches current code? |
|--------|-----------|-----------|----------------------|
| `test_api.py` | Yes (:5001) | No | **Partial** — expects `/api/rfid/events` endpoint (not yet in `api.py`) |
| `test_database.py` | No | Yes | **Yes** — tables `rfid_events`, `station_sessions`, `station_alerts`, `label_prints` all exist |
| `test_timezone.py` | Yes | Yes | **Partial** — DB tables exist; some API endpoints may be missing |
| `test_websocket.py` | Yes | No | **Partial** — connect works; `rfid_update` payload shape differs |
| `check_live.py` | No | Yes | **Yes** — all queried tables exist in DB |

### `test_api.py`

**Intended coverage:**
- API reachability (`GET /`)
- `POST /api/rfid/events` entrance → session created
- Duplicate suppression within 5s
- Live status shows "In Process"
- Exit completes session with dwell
- Completed list includes session
- Missing Entrance alert on exit-only read
- Alerts list and resolve
- Stats endpoint keys
- Bad request 422 validation

**Key assertions:** HTTP 201 on ingest, `action` fields (`session_created`, `session_completed`, `missing_entrance_alert`), status strings `"In Process"` / `"Completed"`.

### `test_database.py`

**Intended coverage:**
- DB file exists, non-empty
- WAL mode, foreign keys on
- Tables: `rfid_events`, `station_sessions`, `station_alerts`, `label_prints`
- Column and index validation
- Row counts > 0
- Valid status enums
- Completed sessions have exit + dwell
- FK integrity for alerts

> **Dependency:** `from database.schema import get_connection` — this module path may not exist; tests may need to be updated to import directly from `storage.py` or connect to the DB path from `config.py`.

### `test_websocket.py`

**Intended coverage:**
- Socket.IO connects to `:5001`
- `rfid_update` fires within 3s of `POST /api/rfid/events`
- Latency < 3s, payload has `action` key
- `rfid_update` on alert resolve with `action=alert_resolved`
- Clean disconnect

**Current reality:** `rfid_update` payload is only `{ts}`; no `action` key. Trigger requires DB change (not `/api/rfid/events`).

### `test_timezone.py`

**Intended coverage:**
- UTC ISO-8601 storage
- Timestamp round-trip ≤2s drift
- Dwell calculation accuracy
- `dwell_time_display` format
- DB `created_at` is UTC

Queries `station_sessions` and `rfid_events` tables.

### `check_live.py`

**Purpose:** Quick CLI snapshot of live DB activity.

**Usage:** `python tests/check_live.py`

**Output:** Last 10 `rfid_events`, session counts by status, open alerts.

All queried tables (`rfid_events`, `station_sessions`, `station_alerts`) exist in the database.

### `run_all.ps1`

**Usage:** `.\tests\run_all.ps1` from project root

**Steps:**
1. Resolves `.venv\Scripts\python.exe`
2. Runs in order: `test_api.py`, `test_database.py`, `test_timezone.py`, `test_websocket.py`
3. Prints output with PASSED/FAILED per suite
4. Exits 1 if any failed

Requires API running on `localhost:5001`.

---

## 12. Scripts & Utilities

### `start.ps1`

Step-by-step:

1. Set `$Root` to script directory, `$Python` to `.venv\Scripts\python.exe`
2. **Install dependencies:** `pip install -r requirements.txt --quiet`
3. **Start API** (port 5001) as PowerShell background job running `api.py`
4. **Wait 3 seconds** for API readiness
5. **Start listener** (port 5000) as background job running `tracking/listener.py`
6. Print job IDs and service URLs
7. **Stream logs** in a loop (every 500ms): prefix `[LISTENER]` / `[API]` on job output
8. On Ctrl+C (finally block): print `Stop-Job` commands to kill background jobs (jobs keep running after log stream stops)

---

### `check_db.py`

**Purpose:** Inspect `tag_reads` schema and sample data.

**Usage:** `python check_db.py`

**Output:**
- `PRAGMA table_info(tag_reads)` columns
- Up to 3 sample rows
- Counts by status (`IN_PROGRESS`, `COMPLETE`, `EXIT_ONLY`)
- Last 10 sessions formatted

---

### `archive/read.py`

**Purpose:** Legacy **direct LLRP** reader client using `sllurp`.

**Behavior:**
- Connects to `READER_IP = "169.254.135.83"` on LLRP default port
- `tag_callback` prints EPC (hex), RSSI, antenna for tags above `RSSI_THRESHOLD = -55`
- Impinj search mode dual-target for repeated reads
- Does **not** persist to database or integrate with current system

**Status:** Deprecated; replaced by HTTP POST listener for FX9600.

---

## 13. Data Models & Key Concepts

### RFID tag data structure

**Reader HTTP event:**
```json
{
  "timestamp": "2026-05-22T23:40:14.471+0000",
  "data": {
    "idHex": "533649425553343539333032",
    "antenna": 1,
    "peakRssi": -48
  }
}
```

**Decoded EPC:** Hex `idHex` → ASCII, e.g. `S6IBUS459302` (stored as `"IBUS #"` column).

### Trip / dwell concept

A **session** (trip) represents one pass of a tagged part through the station:

1. **Enter** — first valid read on entrance antenna → session opens (`IN_PROGRESS`)
2. **Dwell** — time between first entrance and first exit
3. **Exit** — first valid read on exit antenna → session closes (`COMPLETE`), `dwell_seconds` calculated
4. **Edge cases:**
   - `EXIT_ONLY` — exit without prior entrance
   - `ABANDONED` — entrance only, timed out (sweeper or manual end)
   - Re-entry after exit starts a new session

**Dwell formula:** `dwell_seconds = first_exit_at_ant2 − first_enter_at_ant1` (integer seconds).

### Label data structure (`tracking/labels.json`)

Maps hex EPC keys to part metadata:

```json
{
  "424F422D434F4D502D303031": {
    "part_name": "B-2111 Bracket",
    "part_number": "2111-001",
    "description": "Stainless Steel Mounting Bracket"
  }
}
```

10 sample Bobrick parts (B-2111 through B-2120). **Not currently loaded** by listener, storage, or API — reference data only.

### Antenna zones

| Antenna ID | Config constant | Role |
|------------|----------------|------|
| 1 | `ENTRY_ANTENNA` | Entrance / "into Gannomat" |
| 2 | `EXIT_ANTENNA` | Exit / "out of Gannomat" |

Physical placement: antennas bracket the Gannomat station; a part read on ant 1 then ant 2 constitutes a complete trip.

---

## 14. Known Patterns & Conventions

### Naming conventions

- Python: `snake_case` functions/variables, `PascalCase` classes (`DwellTracker`, `_Session`)
- DB column `"IBUS #"` — quoted identifier with space (legacy naming)
- Status values: `SCREAMING_SNAKE` (`IN_PROGRESS`, `COMPLETE`, etc.)
- React: `PascalCase` components, `camelCase` props/state
- API JSON: mix of `snake_case` (`ibus_number`) and legacy keys (`"IBUS #"`)

### Error handling approach

- Listener: catch-all on ingest, print error, still return 200
- Storage sweeper: log and continue on exception
- API poller: silent `pass` on exception
- Frontend: `Promise.allSettled` — failed fetches don't block others
- Printer scripts: try/except with user-friendly messages

### Logging approach

- Listener: `print()` with `[timestamp]` prefix for accepted tags
- Flask request logging suppressed unless `--verbose`
- Sweeper errors: `print(f"[dwell-sweeper] error: {exc}")`
- API: minimal startup banner only

### TODOs and known limitations

1. **Dual-table design:** The DB has both `tag_reads` (written by `storage.py`/`DwellTracker`) and `station_sessions` / `rfid_events` (planned higher-level tables). These may not be kept in sync by all code paths — verify which tables `api.py` reads from for each endpoint.
2. **Missing API endpoints:** `/api/rfid/events`, `/api/gannomat/alerts`, `/api/gannomat/stats`, `/api/rfid/recent-events` not yet exposed in `api.py` even though the underlying tables exist.
3. **WebSocket richness:** Only `rfid_update` with timestamp; Plan.md message types (`station_session_created`, `alert_created`, etc.) not implemented.
4. **Alerts:** `active_alerts` hardcoded to `0` in dashboard summary even though `station_alerts` table exists and may have rows.
5. **Operator / RTLS:** Not implemented; Plan.md references operator association.
6. **Pruning:** `_prune_raw()` is a stub; `RAW_MAX_ROWS` unused.
7. **`reads_last_hour`:** Returns total count, not time-filtered.
8. **`/api/reads/recent`:** `seconds` param ignored.
9. **`labels.json`:** Not integrated into runtime.
10. **`useSocketData.js` / `lib/socket.js`:** Exist but unused by main `App.jsx`.
11. **`test_database.py`:** `from database.schema import get_connection` import path needs verification.
12. **`EPC_FILTER_PATTERN` in `.env.example`:** Value `49425553` is hex for "IBUS" but filter matches decoded ASCII regex.
13. **`print_labels.py`:** RFID write payload doesn't use generated label text.
14. **No sllurp in requirements.txt;** LLRP only in archive.
15. **`App.css`:** Contains unused Vite template styles (not imported by `App.jsx`).

---

## 15. Glossary

| Term | Definition |
|------|------------|
| **RFID** | Radio-Frequency Identification; wireless tag reading |
| **EPC** | Electronic Product Code; unique identifier stored on RFID tag (often hex-encoded) |
| **IBUS** | Internal Bobrick part numbering scheme embedded in tag EPC (e.g. `S6IBUS459302`) |
| **LLRP** | Low-Level Reader Protocol; standard protocol for speaking directly to RFID readers |
| **sllurp** | Python LLRP client library (used in archived `read.py`) |
| **FX9600** | Zebra fixed RFID reader model used at the Gannomat station |
| **HTTP POST mode** | Reader configuration that pushes tag events to a URL (current production path) |
| **Dwell time** | Duration a part spends between entrance and exit antenna reads |
| **Session / trip** | One complete (or partial) pass of a tag through the station |
| **Antenna zone** | Physical reader antenna mapped to entrance (1) or exit (2) |
| **RSSI** | Received Signal Strength Indicator; dBm value; stronger (closer to 0) = closer tag |
| **ZPL** | Zebra Programming Language; printer command format |
| **Gannomat** | CNC/machining station being tracked in this POC |
| **WAL** | Write-Ahead Logging; SQLite journal mode for concurrent read/write |
| **Socket.IO** | WebSocket abstraction used for `rfid_update` push events |
| **RTLS** | Real-Time Location System; planned operator/badge association (not implemented) |
| **POC** | Proof of Concept; current deployment scope |
| **Throttle** | Time-based deduplication preventing duplicate reads within `RAW_THROTTLE_SEC` |
| **Sweeper** | Background thread closing idle/abandoned sessions |
| **EXIT_ONLY** | Status when exit antenna reads occur without a matching entrance |
| **ABANDONED** | Status when a part entered but never exited within timeout |

---

*Document generated June 29, 2026. Source: `C:\Users\zane.derrod\OneDrive - Bobrick Washroom Equipment\Desktop\RFID_Tracking`*
