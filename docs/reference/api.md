# API reference

REST API served by `api.py` on port **5001**. All JSON responses unless noted. CORS allows all origins (development default).

**Base URL:** `http://localhost:5001`

---

## Static and index

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | React SPA (`dashboard/dist/index.html`) or JSON endpoint index |
| GET | `/assets/<path>` | Vite build assets |
| GET | `/<path>` | SPA fallback for client routes |

---

## Live dashboard

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/summary` | Summary cards: in process, completed today, avg dwell, reader status |
| GET | `/api/live` | Open sessions (`open`, `exit_only`) from `vw_live_part_status` |
| GET | `/api/completed` | Closed sessions. Query: `limit` (default 25) |
| GET | `/api/ibus` | Part journeys grouped by IBUS work order |
| GET | `/api/raw-reads/recent` | Recent raw RFID reads. Query: `limit` |
| POST | `/api/sessions/<id>/end` | Manually abandon session; returns `dwell_seconds` |
| POST | `/api/notify` | Internal refresh ping (simulator); triggers Socket.IO emit |

### Example: `/api/summary`

```json
{
  "station_name": "Gannomat",
  "parts_in_process": 3,
  "completed_today": 12,
  "average_dwell_seconds_today": 862.0,
  "average_dwell_display_today": "14 min 22 sec",
  "missing_exit_count": 0,
  "active_alerts": 0,
  "last_rfid_read_time": "2026-07-17T17:30:00+00:00",
  "reader_status": "Active"
}
```

### Example: live session (abbreviated)

```json
{
  "session_id": 42,
  "epc": "1D40463947",
  "ibus_number": "IBUS463947",
  "work_order": "463947",
  "station_name": "Gannomat",
  "session_status": "open",
  "entry_time": "2026-07-17T17:25:00+00:00",
  "dwell_seconds": null,
  "progress_fraction": 0.67,
  "operators": []
}
```

---

## Catalog

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/stations` | Station list |
| GET | `/api/station-specifications` | Targets vs actual dwell per station |
| PUT | `/api/station-specifications/<station_id>` | Update station spec |
| GET | `/api/readers` | RFID readers |
| GET | `/api/antennas` | Antenna ports and roles |
| GET | `/api/parts` | Parts registry |
| GET | `/api/tags` | RFID tags |
| GET | `/api/work-orders` | Work order list |
| GET | `/api/work-orders/<ibus>` | Single work order detail |
| GET | `/api/work-orders/<ibus>/components` | BOM components |
| POST | `/api/work-orders/ingest` | Trigger R41/work order ingest |

---

## Floor plan / layout

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/machine-shapes` | Machine polygons JSON |
| PUT | `/api/machine-shapes` | Save machine polygons |
| GET | `/api/antenna-placements` | Antenna marker positions |
| PUT | `/api/antenna-placements` | Save antenna placements |
| GET | `/api/station-placements` | Station label positions |
| PUT | `/api/station-placements` | Save station placements |

---

## Operators

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/operators` | Operator registry |
| GET | `/api/operators/<id>/presence` | Presence history |
| GET | `/api/sessions/<id>/operators` | Operators assigned to session |

---

## Reporting and analytics

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/report/stations` | Station-level report |
| GET | `/api/report/sessions` | Session history with filters |
| GET | `/api/analytics` | Dashboard analytics aggregates |
| GET | `/api/analytics/operators` | Operator summary list |
| GET | `/api/analytics/operators/<id>` | Single operator drill-down |

Query parameters vary by endpoint (date range, station, limit) — inspect `api.py` for current filters.

---

## RTLS

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/rtls/health` | Ingest enabled, WebSocket state |
| GET | `/api/rtls/live` | Live badge positions |
| POST | `/api/rtls/demo` | Start demo operators |
| DELETE | `/api/rtls/demo` | Clear demo data |
| POST | `/api/rtls/sim-zone` | Move badge to zone (testing) |

---

## Listener (separate process, port 5000)

Not part of `api.py` but documented here for completeness:

| Method | Path | Description |
|--------|------|-------------|
| POST | `/tags` | Zebra tag event ingest |
| GET | `/healthz` | Listener health and antenna hit counts |

---

## WebSocket (Socket.IO)

**URL:** same origin as API (`http://localhost:5001`)

### Server → client events

| Event | Payload | When |
|-------|---------|------|
| `rfid_update` | `{ "ts": "<ISO datetime>" }` | DB change detected (~0.5s poll) |

Additional emit reasons include manual `/api/notify` and some session mutations (`session_ended` direct emit on manual end).

### Client → server

Standard connect/disconnect only. Clients refetch REST data on `rfid_update`.

---

## Error responses

| Code | Body | When |
|------|------|------|
| 404 | `{ "error": "..." }` | Missing session or resource |
| 422 | validation detail | Invalid POST body (where validated) |
| 503 | health JSON | Listener DB not writable |

---

## Related

- [Architecture](../explanation/architecture.md)
- [Database schema](database-schema.md)
- Legacy monolith: [CODEBASE_REFERENCE.md](../CODEBASE_REFERENCE.md) (partially outdated)
