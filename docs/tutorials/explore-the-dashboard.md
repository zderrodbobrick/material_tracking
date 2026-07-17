# Tutorial: Explore the dashboard

After [getting started](getting-started.md), use this walkthrough to learn what each part of the React dashboard shows and how it connects to backend data.

**Prerequisites:** API running on port 5001, dashboard built (`npm run build`) or running in dev mode, and some live or simulated sessions.

---

## Entering the app

1. Open **http://localhost:5001** (or **http://localhost:5173** in dev mode with API on 5001)
2. The **landing page** shows summary teaser cards and connection status
3. Click **Enter** — your choice is stored in `sessionStorage` so refresh keeps you in the app
4. Use **Home** in the header to return to the landing page

---

## Header and navigation

The header includes:

- **Live connection indicator** — `connecting`, `live`, `reconnecting`, or `offline` based on Socket.IO state
- **Last updated** — timestamp of the most recent data fetch
- **Tab navigation** — switches main views without losing socket connection

Tabs:

| Tab | Page | Purpose |
|-----|------|---------|
| Live | `LiveDashboard` | Floor plan map, machine status, IBUS sidebar |
| Completed | `CompletedIbusPage` | Finished IBUS work orders |
| Report | `FullReport` | Station and session reporting |
| Analytics | `AnalyticsPage` | Dwell and throughput charts |
| Operators | `OperatorAnalyticsPage` | RTLS operator metrics (when enabled) |
| Settings | `StationSettingsPage` | Station dwell targets and specifications |

---

## Live dashboard — floor plan

The live view is the operational center.

### Part chips

Each open session appears as a **chip** on the floor plan, positioned by station. Chips show:

- Part / IBUS label (from decoded EPC)
- Progress along the production spine (Tenoner → LBD → Gannomat → Insert Station)
- Dwell timer while a part is inside a dwell station

Data source: `GET /api/live` (backed by `vw_live_part_status`).

### Machine overlays

Colored regions represent machines (Gannomat, Tennoner, LBD, etc.). Status colors reflect whether parts or operators are present. Shapes load from `GET /api/machine-shapes` (stored in `RTLS/machineShapes.json`).

### Operator markers

When RTLS is enabled, white pulsing dots show operator badge positions from `GET /api/rtls/live`. Names come from `RTLS/operator-names.json`.

### IBUS orders sidebar

Groups live parts by work order (e.g. `IBUS462064`). Click an order to filter the map. Orders listed in `HIDDEN_IBUS_ORDERS` in `.env` are excluded from the map and sidebar.

### Map editing modes

Toolbar toggles (stored in localStorage):

- **Antenna placement** — drag RFID antenna markers; saves to `PUT /api/antenna-placements`
- **Station placement** — reposition station labels; saves to `PUT /api/station-placements`

Use these in commissioning, not during normal production monitoring.

---

## Completed IBUS page

Lists work orders whose parts have finished the tracking spine or closed sessions. Useful for shift handoff and verifying a batch completed.

Data: `GET /api/ibus` and related completed-session queries.

---

## Full report

Tabular export-oriented view of station activity and session history with filters. Backed by `GET /api/report/stations` and `GET /api/report/sessions`.

---

## Analytics

Charts for dwell times, completion counts, and station comparisons. Uses `GET /api/analytics` and station specification targets from `GET /api/station-specifications`.

Green/red indicators compare **actual average dwell** to **target dwell** per station.

---

## Operator analytics

Visible when RTLS data exists. Shows time in zone, assignments to parts, and per-operator drill-down via `GET /api/analytics/operators`.

---

## Station settings

Edit target dwell times and specification metadata per station. Changes persist through `PUT /api/station-specifications/<station_id>`.

---

## Real-time updates

The dashboard uses `useLiveSocket`:

1. Connects Socket.IO to the API (port 5001)
2. On `rfid_update`, increments a tick counter
3. Pages refetch REST data when the tick changes

There is no per-field push payload — the client re-queries HTTP endpoints after any DB change. This keeps the server simple and ensures consistency.

---

## Theme

Light/dark theme toggles via `useTheme` and persists in `localStorage`.

---

## Dev vs production URLs

| Mode | Dashboard URL | API URL |
|------|---------------|---------|
| Production | `http://localhost:5001` | same origin |
| Dev (`npm run dev`) | `http://localhost:5173` | `http://localhost:5001` (see `dashboard/src/api.js`) |

Always keep the API running when using the dashboard.

---

## Next steps

- [Run the simulator](../how-to/run-the-simulator.md) to populate all views with realistic data
- [Architecture](../explanation/architecture.md) — how map coordinates and progress spine work
- [API reference](../reference/api.md) — exact JSON shapes for each endpoint
