# Data model

Normalized SQLite schema, EPC encoding, views, and how work orders relate to tracked parts.

---

## Database file

- **Path:** `database/rfid_reads.db` (override with `DB_PATH`)
- **Mode:** WAL journal, foreign keys ON, 5s busy timeout
- **Migrations:** `database/migrate.py` — versioned, idempotent, run on first `get_db()` or `DwellTracker` init

---

## Entity relationship (core)

```
stations ─────┬──── rfid_readers ──── rfid_antennas
              │
parts ────────┼──── part_tag_assignments ──── rfid_tags
              │
              └──── part_station_sessions ──── part_station_events
                         │
                         └── part_operator_assignments ──── operators
```

---

## Core tables

### `rfid_tags`

One row per unique EPC hex string. Status `active` by default.

### `parts`

Manufacturing part identity: `part_number`, `part_name`, `part_type`, `ibus_number`, `job_number` (work order). Auto-created when unknown tags are first seen.

### `part_tag_assignments`

Links parts to tags over time (`unassigned_at` for history).

### `stations`

Catalog: Gannomat, Tennoner, Insert Station, Anderson, Final Packing, LBD (seeded by migration).

### `rfid_readers` / `rfid_antennas`

Physical reader identity and antenna port → station mapping. Seeded from env on migrate (`STATION_NAME`, `ENTRY_ANTENNA`, etc.).

### `rfid_raw_reads`

Append-only log of every accepted read: EPC, antenna, RSSI, reader timestamp, raw JSON payload, `read_status`, `is_stale`.

### `part_station_events`

Typed events: `ENTER` or `EXIT` (constants `ENTER_EVENT`, `EXIT_EVENT`). Links to `source_read_id`.

### `part_station_sessions`

Session state machine:

| Column | Description |
|--------|-------------|
| `entry_time` / `exit_time` | Session boundaries |
| `dwell_seconds` | Set on close |
| `session_status` | `open`, `closed`, `abandoned`, `exit_only` |
| `entry_event_id` / `exit_event_id` | FK to events |

---

## Operator tables

| Table | Purpose |
|-------|---------|
| `operators` | Employee / badge registry |
| `operator_station_presence` | Point-in-time presence detections |
| `part_operator_assignments` | Links operators to part sessions |
| `operator_zone_visits` | RTLS zone enter/exit with dwell |
| `operator_current_zone` | Latest zone per badge |
| `session_operator_presence` | Operators tied to session timeline |

Populated when RTLS ingest is enabled and via simulator.

---

## Work order tables

R41 ingest populates component lists for IBUS orders (e.g. 34 parts for IBUS462064). Used by simulator and IBUS sidebar grouping — not every column documented here; see `r41/ingest.py` and migration scripts for `work_order_components`.

---

## Dashboard view: `vw_live_part_status`

Primary read model for live UI. Joins:

- `part_station_sessions`
- `parts`, `rfid_tags`, `stations`

Exposes: `session_id`, `epc`, `ibus_number`, `job_number`, `station_name`, `entry_time`, `exit_time`, `dwell_seconds`, `session_status`, part metadata.

API endpoints `/api/live`, `/api/completed`, and report queries use this view.

---

## EPC tag format

Defined in `epc_type_map.py`. Decoded ASCII structure:

```
Position:  [Qty][PartNumber…][TypeCode][WorkOrder 6 digits]

Example:   1D40463947
           │ │       │ └─ 463947
           │ │       └── type 0 → label "IBUS"
           │ └─ part number D4
           └── quantity 1
```

Type codes map through `EPC_TYPE_CODES` (currently `"0"` → `"IBUS"`).

Hex on the wire (`idHex` from Zebra) is decoded to ASCII before filtering and storage.

---

## Status naming history

Older docs reference `IN_PROGRESS` / `COMPLETE` on a legacy `tag_reads` table. The current schema uses lowercase `open` / `closed` on `part_station_sessions`. API JSON may expose both styles in different endpoints during transition — prefer `session_status` from the view for new integrations.

---

## Indexes

Created in migration `_m003_indexes`: time-series indexes on raw reads, composite indexes on sessions and events, EPC lookup on tags. See [Database schema reference](../reference/database-schema.md).

---

## Hidden orders

Set `HIDDEN_IBUS_ORDERS=IBUS462064` in `.env` to exclude an order from live map and sidebar. Data remains in the database.

---

## Related

- [Database schema reference](../reference/database-schema.md)
- [Session lifecycle](session-lifecycle.md)
- [Print RFID labels](../how-to/print-rfid-labels.md)
