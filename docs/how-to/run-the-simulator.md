# How to run the simulator

Exercise the full RFID pipeline — database, sessions, API, and dashboard — without a Zebra reader or HTTP listener.

---

## When to use it

- Demo the live floor plan to stakeholders
- Develop dashboard features with predictable data
- Regression-test session logic after config changes
- Load a multi-part work order (e.g. 34-part IBUS462064)

---

## Prerequisites

1. API running: `python api.py` or `.\start.ps1` (listener optional for sim-only runs)
2. Python venv with dependencies installed
3. Work order data in the database (from `.R41` ingest) or bundled sample files

---

## Quick auto run

```powershell
python sim/run.py --ibus IBUS462064 --auto --duration 90
```

This:

- Clears prior **session** history (keeps work orders and station catalog)
- Loads parts for the specified IBUS work order
- Walks each part through antennas `4 → 6 → 1 → 2 → 3` (Tennoner table → LBD → Gannomat → exit → Insert)
- Optionally simulates operator RTLS movement between zones
- POSTs to `http://127.0.0.1:5001/api/notify` so the dashboard refreshes

Keep `--duration` long enough for all parts to complete (60–120 seconds typical for large orders).

---

## Interactive mode

```powershell
python sim/run.py
```

Commands at the prompt:

| Command | Action |
|---------|--------|
| `1 4` | Move part #1 to antenna port 4 |
| `S17 1` | Move part with ref S17 to antenna 1 |
| `move 1 3` | Same as numeric move syntax |
| `move end` | Send all parts to Insert (100% complete) |
| `auto 60` | Auto-pipeline all parts over ~60 seconds |

---

## Options

| Flag | Effect |
|------|--------|
| `--ibus IBUS######` | Select work order |
| `--auto` | Run automatic pipeline |
| `--duration N` | Seconds for auto mode |
| `--no-clear` | Keep existing session history |
| `--no-operators` | Skip RTLS operator simulation |

---

## What the sim does internally

The simulator calls `DwellTracker.ingest_batch()` — the **same** code path as `tracking/listener.py`. Only the HTTP layer is bypassed; fake events use the Zebra JSON shape with synthetic timestamps and RSSI `-45`.

Cleared tables on start (unless `--no-clear`):

- `part_station_sessions`, `part_station_events`, `rfid_raw_reads`
- Operator tracking tables linked to sessions

**Not** cleared: `parts`, work order components, `stations`, `rfid_antennas`.

---

## Seed a test work order

If no work order exists in the DB:

```powershell
python sim/seed_test_wo.py
```

Or ingest R41 files:

```powershell
python r41/ingest.py
```

---

## Verify results

- Dashboard live map shows moving chips
- `curl http://localhost:5001/api/live` returns open sessions
- `curl http://localhost:5001/api/ibus` groups parts by work order
- Listener logs are **not** required; sim writes directly to SQLite

---

## Related

- [Getting started](../tutorials/getting-started.md)
- [Session lifecycle](../explanation/session-lifecycle.md)
- [CLI reference](../reference/cli-and-scripts.md)
