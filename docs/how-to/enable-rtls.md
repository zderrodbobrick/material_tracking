# How to enable RTLS

Connect **Sewio** real-time location data so operator badges appear on the live floor plan and link to part sessions.

---

## Overview

RTLS (Real-Time Location System) tracks Sewio badge tags in factory zones. When enabled, the API:

1. Opens a WebSocket to the Sewio sensmapserver
2. Maps zone IDs to station names via `RTLS/zoneMappings.json`
3. Records operator presence and assigns operators to open part sessions after a confirmation dwell

RFID part tracking and RTLS operator tracking run in parallel; they merge in the dashboard and `part_operator_assignments` table.

---

## Prerequisites

- Sewio server reachable on plant LAN (default `wss://10.25.80.13`)
- Valid `SEWIO_API_KEY` from your Sewio administrator
- Zone mappings configured in `RTLS/zoneMappings.json`
- Operator names in `RTLS/operator-names.json` (optional, improves UI labels)
- API running with network access to Sewio

---

## Configuration

Edit `.env`:

```env
ENABLE_LIVE_INGESTION=true
SEWIO_WS_HOST=wss://10.25.80.13
SEWIO_API_KEY=your-api-key-here
SEWIO_FEED_ID=
RTLS_TEST_FEED_ID=35
SEWIO_VERIFY_SSL=false
RTLS_OPERATOR_CONFIRM_SECS=10
```

| Variable | Purpose |
|----------|---------|
| `ENABLE_LIVE_INGESTION` | Master switch — must be `true` |
| `SEWIO_WS_HOST` | WebSocket base (API appends `/sensmapserver/api`) |
| `SEWIO_API_KEY` | Authentication for Sewio REST/WebSocket |
| `SEWIO_FEED_ID` | Optional — subscribe to one badge feed only |
| `RTLS_TEST_FEED_ID` | Feed ID used for demo/sim modes |
| `SEWIO_VERIFY_SSL` | Set `false` for self-signed plant certs |
| `RTLS_OPERATOR_CONFIRM_SECS` | Seconds in zone before operator counts as working a part |

Restart the API after changing `.env`.

---

## Verify connection

```powershell
curl http://localhost:5001/api/rtls/health
```

Expected when enabled:

```json
{
  "enabled": true,
  "websocket_connected": true,
  "feeds_subscribed": 1
}
```

`start.ps1` prints RTLS status on startup when the health endpoint responds.

---

## Zone and station mapping

Edit `RTLS/zoneMappings.json` to map Sewio zone IDs to station names used in the dashboard (e.g. `"Gannomat"`, `"Tennoner"`).

Station placements on the floor plan come from `RTLS/stationPlacements.json`. Machine polygons from `RTLS/machineShapes.json`.

After JSON edits, restart the API or use the dashboard placement tools (which write via API).

---

## Demo mode (no live Sewio)

For UI development without the Sewio server:

```powershell
curl -X POST http://localhost:5001/api/rtls/demo
```

Clears demo with:

```powershell
curl -X DELETE http://localhost:5001/api/rtls/demo
```

The simulator (`sim/run.py`) can also move fake operators when operator simulation is enabled.

---

## Floor plan alignment

Vite env vars in `.env` (rebuild dashboard after changes):

```env
VITE_FLOOR_PLAN_ORIGIN_X=7
VITE_FLOOR_PLAN_ORIGIN_Y=2.5
VITE_FLOOR_PLAN_PIXEL_X=131
VITE_FLOOR_PLAN_PIXEL_Y=81
VITE_FLOOR_PLAN_SCALE=18
```

These map Sewio meter coordinates to pixels on `floor_plan.png`. See `.env.example` comments.

---

## Troubleshooting

| Symptom | Check |
|---------|-------|
| `enabled: false` | `ENABLE_LIVE_INGESTION=true` in `.env`, restart API |
| WebSocket never connects | Firewall, API key, Sewio host URL |
| Operators not on map | Zone mapping, feed ID, `GET /api/rtls/live` |
| Operators not linked to parts | `RTLS_OPERATOR_CONFIRM_SECS`, open part session at same station |
| SSL errors | `SEWIO_VERIFY_SSL=false` for internal certs |

---

## Related

- [RTLS and operators](../explanation/rtls-and-operators.md)
- [Explore the dashboard](../tutorials/explore-the-dashboard.md)
- [API reference — RTLS endpoints](../reference/api.md)
