# Architecture

How the Material Tracking system is structured, how data flows from the shop floor to the browser, and which technologies are involved.

---

## System purpose

Bobrick washroom equipment parts carry RFID tags. Fixed readers at production stations detect when a part enters, dwells, and exits. The system:

- Records every valid read and derives **station sessions** with dwell times
- Groups parts by **IBUS work order** for batch visibility
- Optionally tracks **operators** via Sewio RTLS badges
- Exposes data through a **REST API** and **live React dashboard**

The first production path is the Gannomat drilling station; the schema and antenna catalog support Tennoner, LBD, Insert Station, and future stations.

---

## Component diagram

```
┌─────────────────┐     HTTP POST /tags      ┌──────────────────┐
│ Zebra FX9600    │ ────────────────────────►│ listener.py      │
│ (antennas 1–7)  │                          │ Flask :5000      │
└─────────────────┘                          └────────┬─────────┘
                                                      │
                        ┌─────────────────────────────┤
                        │                             │
                        ▼                             ▼
               ┌──────────────────┐          ┌──────────────────┐
               │ DwellTracker     │          │ Sewio RTLS       │
               │ storage.py       │          │ (optional WS)    │
               └────────┬─────────┘          └────────┬─────────┘
                        │                             │
                        └──────────────┬──────────────┘
                                       ▼
                              ┌──────────────────┐
                              │ rfid_reads.db    │
                              │ SQLite (WAL)     │
                              └────────┬─────────┘
                                       │
                        ┌──────────────┴──────────────┐
                        ▼                             ▼
               ┌──────────────────┐          ┌──────────────────┐
               │ api.py           │◄─────────│ DB poller thread │
               │ Flask+SocketIO   │  0.5s    │ rfid_update emit │
               │ :5001            │          └──────────────────┘
               └────────┬─────────┘
                        │ REST + Socket.IO
                        ▼
               ┌──────────────────┐
               │ React dashboard  │
               │ (Vite build)     │
               └──────────────────┘
```

See also [architecture.html](../architecture.html) for an interactive diagram.

---

## Process boundaries

| Process | Port | Responsibility |
|---------|------|----------------|
| `tracking/listener.py` | 5000 | Ingest Zebra HTTP POST, console logging, `/healthz` |
| `api.py` | 5001 | REST API, Socket.IO, serve `dashboard/dist`, RTLS ingest thread |
| `sim/run.py` | — | Offline testing; writes directly via `DwellTracker` |

Both listener and API share one SQLite file (`DB_PATH`). WAL mode allows concurrent read/write.

---

## Data pipeline (normalized schema)

Every tag read flows through layered tables:

```
rfid_raw_reads          ← append-only audit log
       ↓
rfid_tags + parts       ← auto-created from EPC decode
       ↓
part_station_events     ← ENTER / EXIT events
       ↓
part_station_sessions   ← dwell + session_status
       ↓
vw_live_part_status     ← dashboard view (joins parts, tags, stations)
```

The API reads **sessions and views**, not raw reads, for live status. Raw reads power recent-activity feeds and debugging.

---

## Production spine

Parts progress along a configured spine (`PROGRESS_STATIONS` in `config.py`):

1. **Tenoner** (Tennoner entry, antenna 7)
2. **LBD** (presence station, antenna 6)
3. **Gannomat** (dwell: ant 1 entry, ant 2 exit marker, ant 3 Insert closes)
4. **Insert Station** (presence)

Dashboard progress bars use the furthest spine station a part has reached.

---

## Real-time strategy

The API does not push full session payloads over WebSocket. A background thread polls SQLite every ~0.5s; when row counts or timestamps change, it emits:

```json
{ "event": "rfid_update", "data": { "ts": "..." } }
```

Clients refetch REST endpoints. This avoids stale partial state and keeps the listener decoupled from Socket.IO.

---

## Technology stack

| Layer | Technology |
|-------|------------|
| RFID ingest | Python 3, Flask |
| Persistence | SQLite 3 (WAL), `database/migrate.py` |
| API | Flask, flask-cors, flask-socketio (threading) |
| Config | python-dotenv, `config.py` |
| Frontend | React 19, Vite 8, Tailwind 4 |
| Real-time client | socket.io-client |
| RTLS | websockets/httpx → Sewio sensmapserver |
| Labels | ZPL over TCP or Windows spooler (pywin32) |
| Work orders | R41 file parse + ingest (`r41/`) |

---

## Key directories

| Path | Role |
|------|------|
| `tracking/` | Listener, `DwellTracker`, RTLS client helpers |
| `database/` | SQLite file, migrations, connection helper |
| `dashboard/` | React SPA |
| `RTLS/` | Zone maps, floor plan JSON, operator names |
| `sim/` | Offline RFID + operator simulator |
| `r41/` | Work order file parser and ingest |
| `printer/` | Label encode and print scripts |
| `tests/` | Integration tests |

---

## Design principles

- **Single writer path for reads** — listener (or sim) → `DwellTracker`; API is read-mostly with explicit write endpoints for admin actions
- **Idempotent migrations** — safe concurrent startup from listener and API
- **Station modes** — dwell stations vs presence stations (see [Session lifecycle](session-lifecycle.md))
- **Fail-soft ingest** — listener returns HTTP 200 even on parse errors to avoid reader retry storms; errors log to console

---

## Related

- [Session lifecycle](session-lifecycle.md)
- [Data model](data-model.md)
- [RTLS and operators](rtls-and-operators.md)
- [API reference](../reference/api.md)
