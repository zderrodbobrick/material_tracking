# Configuration reference

All environment variables loaded by `config.py` from `.env` (via python-dotenv). Values shown are **code defaults** when the variable is unset — your `.env.example` may differ.

---

## Paths and listener

| Variable | Default | Description |
|----------|---------|-------------|
| `LISTENER_HOST` | `0.0.0.0` | Bind address for RFID HTTP listener |
| `LISTENER_PORT` | `5000` | Port for Zebra POST `/tags` |
| `LISTENER_ADVERTISE_IP` | *(auto)* | IP shown in `start.ps1` banner for reader config |
| `DB_PATH` | `database/rfid_reads.db` | SQLite path relative to project root |

---

## Antennas and stations

| Variable | Default | Description |
|----------|---------|-------------|
| `ENTRY_ANTENNA` | `1` | Gannomat entry port |
| `EXIT_ANTENNA` | `2` | Gannomat exit port (does not close session) |
| `THIRD_ANTENNA` | `3` | Insert Station — closes Gannomat dwell |
| `THIRD_ANTENNA_NAME` | `Insert Station` | Display name for port 3 |
| `INSERT_STATION_NAME` | `Insert Station` | Presence station name |
| `TENONER_ENTRY_ANTENNA` | `7` | Tennoner entry |
| `TENONER_EXIT_ANTENNAS` | `4,5` | Tennoner exit table ports |
| `LBD_ANTENNA` | `6` | LBD presence port |

### Station identity (per deployment)

| Variable | Default | Description |
|----------|---------|-------------|
| `STATION_NAME` | `Gannomat` | Primary station for this listener instance |
| `STATION_TYPE` | `Drilling` | Station type label |
| `STATION_LOCATION` | `TPF CL` | Plant/site description |
| `READER_NAME` | `FX9600-Gannomat` | Reader record name |
| `READER_IP` | *(empty)* | Reader device IP |

---

## RFID filtering

| Variable | Default | Description |
|----------|---------|-------------|
| `RSSI_MIN` | `-65` | Min dBm for entrance/general reads |
| `EXIT_RSSI_MIN` | `-65` | Exit antenna floor (warn-only reads) |
| `THIRD_RSSI_MIN` | same as exit | Insert antenna — must be strong to close Gannomat |
| `MIN_READS_FOR_SESSION` | `5` | Sustained reads before session opens (`1` = faster, less strict) |
| `EPC_FILTER_PATTERN` | `.*` | Regex on **decoded ASCII** EPC; use `.*IBUS.*` to filter IBUS only |

---

## Session timing

| Variable | Default | Description |
|----------|---------|-------------|
| `RAW_THROTTLE_SEC` | `0.05` | Min seconds between stored reads per (EPC, antenna) |
| `IDLE_TIMEOUT_SEC` | `60.0` | Idle before sweeper acts (presence stations) |
| `EXIT_IDLE_TIMEOUT_SEC` | `0` | Deprecated |
| `ABANDON_TIMEOUT_SEC` | `14400` | 4 h — Gannomat wait for Insert close |
| `SWEEP_INTERVAL_SEC` | `1.0` | Sweeper loop interval |

---

## Database pruning

| Variable | Default | Description |
|----------|---------|-------------|
| `RAW_MAX_ROWS` | `20000` | Prune threshold (partially implemented) |
| `PRUNE_EVERY_N_INSERTS` | `200` | Prune trigger interval |

---

## Dashboard / visibility

| Variable | Default | Description |
|----------|---------|-------------|
| `HIDDEN_IBUS_ORDERS` | *(empty)* | Comma-separated IBUS IDs hidden from live map |

---

## Printer

| Variable | Default | Description |
|----------|---------|-------------|
| `PRINTER_IP` | `10.25.100.157` | Zebra network printer |
| `PRINTER_PORT` | `9100` | Raw ZPL port |

---

## Sewio RTLS

| Variable | Default | Description |
|----------|---------|-------------|
| `ENABLE_LIVE_INGESTION` | `false` | Enable Sewio WebSocket ingest |
| `SEWIO_WS_HOST` | `wss://10.25.80.13` | WebSocket host |
| `SEWIO_WS_URL` | *(derived)* | Full sensmapserver API URL |
| `SEWIO_REST_URL` | *(derived)* | HTTPS REST base |
| `SEWIO_API_KEY` | *(empty)* | API key |
| `SEWIO_FEED_ID` | *(empty)* | Single-feed subscription |
| `RTLS_TEST_FEED_ID` | `35` | Demo/sim feed |
| `SEWIO_STATION_ZONE_IDS` | *(empty)* | Extra zone IDs for this station |
| `SEWIO_LIVE_OFFSET_HOURS` | `0` | Timestamp offset |
| `SEWIO_VERIFY_SSL` | `false` | TLS certificate verification |
| `RTLS_DATA_DIR` | `RTLS/` | JSON config directory |
| `RTLS_OPERATOR_CONFIRM_SECS` | `10` | Zone dwell before assignment |
| `MAX_OPERATORS_PER_PART` | `1` | Cap assignments per session |
| `MAX_OPERATORS_PER_STATION` | `1` | Cap concurrent operators per zone |

---

## Simulator

| Variable | Default | Description |
|----------|---------|-------------|
| `SIM_OPERATOR_MIN_DWELL_SEC` | `12` | Min sim operator zone time |
| `SIM_OPERATOR_MAX_DWELL_SEC` | `30` | Max sim operator zone time |

---

## Dashboard build (Vite)

Read at **build time** from project root `.env`:

| Variable | Example | Description |
|----------|---------|-------------|
| `VITE_FLOOR_PLAN_ORIGIN_X` | `7` | Sewio meter X anchor |
| `VITE_FLOOR_PLAN_ORIGIN_Y` | `2.5` | Sewio meter Y anchor |
| `VITE_FLOOR_PLAN_PIXEL_X` | `131` | Pixel X on floor plan image |
| `VITE_FLOOR_PLAN_PIXEL_Y` | `81` | Pixel Y on floor plan image |
| `VITE_FLOOR_PLAN_SCALE` | `18` | Pixels per meter |

Rebuild dashboard after changes: `cd dashboard && npm run build`.

---

## Python constants (not env)

Defined only in `config.py`:

| Name | Value | Description |
|------|-------|-------------|
| `ANTENNA_CATALOG` | ports 1–7 | Port → name, role, station, type |
| `DWELL_STATIONS` | Gannomat, Tennoner | Dwell-mode set |
| `PRESENCE_STATIONS` | LBD, Insert Station | Presence-mode set |
| `PROGRESS_STATIONS` | Tenoner, LBD, Gannomat, Insert Station | Spine order |
| `STATUS_OPEN` | `open` | Session status |
| `STATUS_CLOSED` | `closed` | Session status |
| `STATUS_ABANDONED` | `abandoned` | Session status |
| `STATUS_EXIT_ONLY` | `exit_only` | Session status |

---

## Setup

```powershell
copy .env.example .env
# edit .env
```

Both `api.py` and `tracking/listener.py` import `config` at startup. Restart processes after changes.

---

## Related

- [How to configure Zebra reader](../how-to/configure-zebra-reader.md)
- [Session lifecycle](../explanation/session-lifecycle.md)
