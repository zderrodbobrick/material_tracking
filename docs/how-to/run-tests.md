# How to run tests

Execute automated checks for the API, database schema, timezones, and WebSocket push.

---

## Prerequisites

1. Python venv with `pip install -r requirements.txt`
2. **API running** on `localhost:5001` — start with `.\start.ps1` or `python api.py`
3. Writable `database/rfid_reads.db` (tests may insert data)

---

## Run all tests

```powershell
.\tests\run_all.ps1
```

Runs in order:

1. `test_api.py`
2. `test_database.py`
3. `test_timezone.py`
4. `test_websocket.py`

Exits with code 1 if any suite fails. Uses `.venv\Scripts\python.exe` when present.

---

## Run individual suites

From project root:

```powershell
python tests/test_api.py
python tests/test_database.py
python tests/test_timezone.py
python tests/test_websocket.py
```

---

## What each suite covers

### `test_api.py`

REST lifecycle: session creation from RFID events, duplicate suppression, live/completed lists, alerts, resolve, stats, validation errors.

Requires API on port 5001.

### `test_database.py`

Schema integrity: WAL mode, foreign keys, table columns, indexes, valid status enums, completed sessions have dwell, no orphaned alerts.

Uses `database/schema.py` `get_connection()` — no API required.

### `test_timezone.py`

UTC timestamp storage, round-trip drift ≤ 2s, dwell calculation accuracy, display formatting.

Requires API and DB.

### `test_websocket.py`

Socket.IO connect, `rfid_update` latency after DB changes, disconnect cleanup.

Requires `python-socketio[client]` (in `requirements.txt`).

---

## Live DB snapshot

Quick manual check without the full suite:

```powershell
python tests/check_live.py
```

Prints recent `rfid_events`, session counts, open alerts.

---

## Troubleshooting

| Failure | Likely cause |
|---------|----------------|
| Connection refused | API not running on 5001 |
| Schema mismatch | Run API once to apply migrations, or delete DB for clean migrate |
| WebSocket timeout | Firewall, or poller not detecting DB change |
| Import errors | Run from project root, venv activated |

---

## Related

- [Database schema reference](../reference/database-schema.md)
- [API reference](../reference/api.md)
- Legacy detail: [tests/README.md on GitHub](https://github.com/zderrodbobrick/material_tracking/blob/main/tests/README.md)
