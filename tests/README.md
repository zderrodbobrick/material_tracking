# RFID Tracking — Test Suite

## Prerequisites

1. API running on `localhost:5001` — start with `.\start.ps1` from project root
2. Dependencies installed — `pip install -r requirements.txt`

> The WebSocket test also needs `python-socketio[client]` (already in requirements.txt).

---

## Run all tests

```powershell
.\tests\run_all.ps1
```

---

## Individual tests

| Script | What it checks | Needs API? | Needs DB? |
|---|---|---|---|
| `test_api.py` | All REST endpoints, RFID ingest lifecycle, alerts, resolve | ✅ | — |
| `test_database.py` | Schema, indexes, FK integrity, valid status values, row counts | — | ✅ |
| `test_timezone.py` | UTC storage, timestamp round-trip, dwell calculation accuracy | ✅ | ✅ |
| `test_websocket.py` | Socket.IO connection, `rfid_update` push latency, resolve push | ✅ | — |

Run individually from the **project root**:

```powershell
python tests/test_api.py
python tests/test_database.py
python tests/test_timezone.py
python tests/test_websocket.py
```

---

## What each test covers

### `test_api.py`
- `GET /` index reachable
- `POST /api/rfid/events` entrance → creates session
- Duplicate suppression (same IBUS + antenna within 5s)
- Live status shows new session as "In Process"
- Exit read completes session with dwell time
- Completed sessions list includes the closed session
- Missing Entrance alert created on exit-only read
- Alert appears in `GET /api/gannomat/alerts`
- `POST /api/gannomat/alerts/<id>/resolve` marks resolved, removes from open list
- Stats endpoint has all required keys
- Bad requests return 422

### `test_database.py`
- DB file exists and is non-empty
- WAL journal mode + foreign keys enabled
- All 4 tables exist with correct columns
- Indexes present
- All status values are valid enums
- Completed sessions have `exit_time` + `dwell_time_seconds`
- In Process sessions have `entrance_time`
- No orphaned alerts

### `test_timezone.py`
- Sends events with explicit UTC timestamps
- Verifies timestamps survive API round-trip without drift (≤2s)
- Checks DB stores UTC (not local machine time)
- `dwell_time_seconds` matches actual elapsed UTC seconds
- `dwell_time_display` is formatted as "X min Y sec"

### `test_websocket.py`
- Socket.IO connects to API
- `rfid_update` event fires within 3s of a `POST /api/rfid/events`
- Push latency < 2s
- `rfid_update` fires after alert resolve with `action=alert_resolved`
- Clean disconnect
