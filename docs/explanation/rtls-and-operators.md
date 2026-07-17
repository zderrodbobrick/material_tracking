# RTLS and operators

How Sewio badge tracking integrates with RFID part sessions and what appears on the dashboard.

---

## Why two tracking systems

| System | Tracks | Hardware |
|--------|--------|----------|
| **RFID** | Parts (IBUS tags) | Zebra FX9600 fixed readers |
| **RTLS** | People (badge tags) | Sewio anchors + sensmapserver |

Parts and operators are correlated when an operator stays in a station zone long enough while a part session is open at that station.

---

## Sewio connection

When `ENABLE_LIVE_INGESTION=true`, `api.py` starts RTLS ingest (see `tracking/rtls_live.py`, `tracking/sewio_client.py`):

1. Authenticate with `SEWIO_API_KEY`
2. Subscribe to WebSocket feed(s) at `SEWIO_WS_URL`
3. Receive tag position updates with zone IDs
4. Map zones → station names via `RTLS/zoneMappings.json`
5. Update `operator_current_zone`, `operator_zone_visits`, and related tables

REST calls to `SEWIO_REST_URL` supplement WebSocket data where needed.

---

## Operator confirmation

`RTLS_OPERATOR_CONFIRM_SECS` (default 10) prevents flicker assignments:

- Operator must remain in a station zone for at least this many seconds
- Only then are they eligible for `part_operator_assignments`

Limits from config:

- `MAX_OPERATORS_PER_PART` — default 1
- `MAX_OPERATORS_PER_STATION` — default 1 active at a zone

---

## Assignment on session open

When `DwellTracker` opens a part session, `rtls_storage.try_assign_on_session_open()` checks for confirmed operators at that station and writes `part_operator_assignments` with method and confidence metadata.

On session close, `finalize_session_operators()` completes operator presence records.

---

## Floor plan visualization

`GET /api/rtls/live` returns badge positions in Sewio coordinates. The dashboard converts to pixels using:

- `dashboard/src/utils/floorPlanCoords.js`
- Vite env vars `VITE_FLOOR_PLAN_*` from `.env`

Operator display names resolve through `RTLS/operator-names.json`.

White pulsing markers on the live map represent operators; part chips use separate styling from `PartChipLayer`.

---

## Operator analytics

`GET /api/analytics/operators` and `/api/analytics/operators/<id>` aggregate zone dwell, station time, and assignment history for the Operators tab.

Uses `operator_zone_visits.dwell_seconds` where `exited_at` is set.

---

## Simulation

`sim/operator_move.py` moves fake operators between zones when running `sim/run.py` without Sewio. Dwell parameters:

- `SIM_OPERATOR_MIN_DWELL_SEC` / `SIM_OPERATOR_MAX_DWELL_SEC` — must exceed `RTLS_OPERATOR_CONFIRM_SECS` or assignments never confirm

---

## Demo API

| Method | Endpoint | Effect |
|--------|----------|--------|
| POST | `/api/rtls/demo` | Inject demo operator positions |
| DELETE | `/api/rtls/demo` | Clear demo data |
| POST | `/api/rtls/sim-zone` | Move a badge to a zone (testing) |

---

## Configuration files (`RTLS/`)

| File | Purpose |
|------|---------|
| `zoneMappings.json` | Sewio zone ID → station name |
| `zoneNames.json` | Zone ID → display label |
| `stationPlacements.json` | Station label positions on floor plan |
| `machineShapes.json` | Machine polygon overlays |
| `antennaPlacements.json` | RFID antenna marker positions |
| `operator-names.json` | Badge ID → person name |
| `stationBenchmarks.json` | Target dwell benchmarks |

Most can be edited via Station Settings / map editor UI, which persists through API PUT endpoints.

---

## Health monitoring

`GET /api/rtls/health` reports:

- Whether ingest is enabled
- WebSocket connected state
- Subscribed feed count

Printed by `start.ps1` on launch.

---

## Related

- [How to enable RTLS](../how-to/enable-rtls.md)
- [Explore the dashboard](../tutorials/explore-the-dashboard.md)
- [API reference — RTLS](../reference/api.md)
