# Database schema reference

SQLite database at `database/rfid_reads.db`. Schema managed by numbered migrations in `database/migrate.py`.

---

## Connection settings

Applied on every connection (`database/schema.py`, `api.get_db()`, `DwellTracker`):

```sql
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;
PRAGMA busy_timeout=5000;
```

---

## Migration system

- Table `_schema_migrations(version, description, applied_at)` tracks applied versions
- Migrations `_m001` … `_mNNN` run once, idempotent DDL
- Both `api.py` and `DwellTracker` call `run_migrations()` on startup
- New migrations: add function + append to `_MIGRATIONS` list in `migrate.py`

---

## Core tables (migration 001)

### `rfid_tags`

| Column | Type | Notes |
|--------|------|-------|
| `tag_id` | INTEGER PK | |
| `epc` | TEXT UNIQUE NOT NULL | Hex EPC |
| `tid` | TEXT | Optional tag TID |
| `tag_status` | TEXT | Default `active` |
| `created_at` | TEXT UTC | |

### `parts`

| Column | Type | Notes |
|--------|------|-------|
| `part_id` | INTEGER PK | |
| `part_number` | TEXT | |
| `part_name` | TEXT | |
| `part_type` | TEXT | |
| `ibus_number` | TEXT | |
| `job_number` | TEXT | Work order |
| `quantity_required` | INTEGER | |
| `created_at` | TEXT UTC | |

### `part_tag_assignments`

Links `part_id` ↔ `tag_id` with `assigned_at`, optional `unassigned_at`.

### `stations`

| Column | Type | Notes |
|--------|------|-------|
| `station_id` | INTEGER PK | |
| `station_name` | TEXT UNIQUE | |
| `station_type` | TEXT | |
| `is_active` | INTEGER | 1 = active |

### `rfid_readers`

Reader metadata, FK `station_id`, `reader_ip`, `location_description`.

### `rfid_antennas`

| Column | Type | Notes |
|--------|------|-------|
| `antenna_port` | INTEGER | Physical port |
| `antenna_role` | TEXT | Entry / Exit |
| `reader_id`, `station_id` | INTEGER FK | |

### `rfid_raw_reads`

| Column | Type | Notes |
|--------|------|-------|
| `read_id` | INTEGER PK | |
| `epc` | TEXT NOT NULL | |
| `antenna_port` | INTEGER | |
| `rssi` | REAL | dBm |
| `reader_timestamp` | TEXT | From reader |
| `server_received_at` | TEXT UTC | |
| `raw_payload` | TEXT | Original JSON |
| `read_status` | TEXT | e.g. `valid` |
| `is_stale` | INTEGER | 0/1 |

### `part_station_events`

| Column | Type | Notes |
|--------|------|-------|
| `event_type` | TEXT NOT NULL | `ENTER` or `EXIT` |
| `event_time` | TEXT NOT NULL | |
| `source_read_id` | INTEGER FK | → raw reads |

### `part_station_sessions`

| Column | Type | Notes |
|--------|------|-------|
| `session_status` | TEXT | `open`, `closed`, `abandoned`, `exit_only` |
| `entry_time`, `exit_time` | TEXT | |
| `dwell_seconds` | INTEGER | |
| `entry_event_id`, `exit_event_id` | INTEGER FK | |

---

## Operator tables (migration 002+)

- `operators` — `employee_number`, `operator_name`, `rtls_badge_id`
- `operator_station_presence` — detections with `distance_meters`
- `part_operator_assignments` — `session_id`, `operator_id`, `assignment_method`

Extended RTLS tables added in later migrations:

- `operator_zone_visits`
- `operator_current_zone`
- `session_operator_presence`

---

## View: `vw_live_part_status`

Denormalized dashboard read model joining sessions, parts, tags, stations.

Key columns exposed to API:

- `session_id`, `part_id`, `epc`, `ibus_number`, `job_number`
- `part_name`, `part_number`, `part_type`
- `station_name`, `session_status`
- `entry_time`, `exit_time`, `dwell_seconds`

Dropped and recreated by migration `_m004_live_view` when schema changes.

---

## Indexes (migration 003)

| Index | Table | Columns |
|-------|-------|---------|
| `IX_raw_reads_epc_time` | rfid_raw_reads | epc, reader_timestamp |
| `IX_raw_reads_reader_time` | rfid_raw_reads | reader_id, reader_timestamp |
| `IX_raw_reads_antenna_time` | rfid_raw_reads | antenna_id, reader_timestamp |
| `IX_sessions_tag_station_status` | part_station_sessions | tag_id, station_id, session_status |
| `IX_events_tag_station_time` | part_station_events | tag_id, station_id, event_time |
| `IX_tags_epc` | rfid_tags | epc |
| `IX_assignments_tag` | part_tag_assignments | tag_id |
| `IX_presence_operator_time` | operator_station_presence | operator_id, detected_at |
| `IX_part_operator_session` | part_operator_assignments | session_id |

---

## Session status enum

Valid values for `part_station_sessions.session_status`:

| Value | Meaning |
|-------|---------|
| `open` | Active session |
| `closed` | Normal completion |
| `abandoned` | Timed out or manual end |
| `exit_only` | Exit without entry |

---

## Utilities

| Script | Purpose |
|--------|---------|
| `python check_db.py` | Inspect schema and sample rows |
| `python tests/check_live.py` | Live activity snapshot |
| `database/schema.get_connection()` | Test helper connection |

---

## Backup notes

- Stop listener and API before copying `.db` files for cold backup
- WAL mode creates `-wal` and `-shm` sidecar files — copy all three together
- Sim start clears session tables by default — use `--no-clear` to preserve history

---

## Related

- [Data model](../explanation/data-model.md)
- [Session lifecycle](../explanation/session-lifecycle.md)
- [API reference](api.md)
