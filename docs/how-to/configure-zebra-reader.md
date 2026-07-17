# How to configure the Zebra reader

Point a **Zebra FX9600** fixed reader at the Python HTTP listener so tag events flow into the tracking database.

---

## Network requirements

| Device | Port | Direction |
|--------|------|-----------|
| FX9600 | — | Must reach the PC running the listener on the plant LAN |
| Listener | **5000** | Inbound HTTP POST from reader |
| API / dashboard | **5001** | Browser access (separate from reader) |

The listener binds to `0.0.0.0` by default (`LISTENER_HOST` in `.env`), accepting connections on all interfaces.

---

## Find the POST URL

When you run `.\start.ps1`, the banner prints:

```
Reader POST target  ->  http://10.25.x.x:5000/tags
```

Use your plant LAN IP (preferably `10.25.*`). Override display IP with `LISTENER_ADVERTISE_IP` in `.env` if auto-detection picks the wrong interface.

**Endpoint:** `POST http://<PC_IP>:5000/tags`

---

## Expected JSON payload

The listener accepts a single object or an array of objects in Zebra HTTP POST format:

```json
{
  "timestamp": "2026-05-22T23:40:14.471+0000",
  "data": {
    "idHex": "3144343036343633393437",
    "antenna": 1,
    "peakRssi": -48
  }
}
```

| Field | Meaning |
|-------|---------|
| `timestamp` | Reader time (ISO-8601) |
| `data.idHex` | EPC as hex (decoded to ASCII for filtering and storage) |
| `data.antenna` | Physical antenna port (1–7 in this deployment) |
| `data.peakRssi` | Signal strength in dBm (must be ≥ `RSSI_MIN` and ≤ 0) |

---

## Antenna port map

Configured in `config.py` (`ANTENNA_CATALOG`):

| Port | Station | Role |
|------|---------|------|
| 1 | Gannomat | Entry |
| 2 | Gannomat | Exit (does not close Gannomat dwell) |
| 3 | Insert Station | Closes Gannomat session |
| 4 | Tennoner | Exit table A |
| 5 | Tennoner | Exit table B |
| 6 | LBD | Entry (presence) |
| 7 | Tennoner | Entry |

Match physical wiring to these ports or update `ENTRY_ANTENNA`, `EXIT_ANTENNA`, and related env vars.

---

## Reader configuration (FX9600)

In Zebra RFID reader management (fixed reader web UI or RFID SDK):

1. Enable **HTTP POST** (or equivalent event forwarding) for tag reads
2. Set destination URL to `http://<PC_IP>:5000/tags`
3. Include fields: EPC hex, antenna ID, peak RSSI, timestamp
4. Configure antenna ports and power to match station layout
5. Tune read power so `peakRssi` stays above `RSSI_MIN` (-65 dBm typical) for valid passes only

Consult Zebra FX9600 documentation for your firmware version — menu names vary.

---

## Filtering on the server

The listener and `DwellTracker` apply:

- **RSSI floor** — `RSSI_MIN` (entrance), `EXIT_RSSI_MIN`, `THIRD_RSSI_MIN` for specific antennas
- **EPC pattern** — `EPC_FILTER_PATTERN` regex on decoded ASCII (default `.*` accepts all)
- **Sustained reads** — `MIN_READS_FOR_SESSION` before opening a session
- **Throttle** — `RAW_THROTTLE_SEC` deduplication per (EPC, antenna)

Adjust `.env` if you see stray sessions from distant tags or cross-antenna bleed.

---

## Verify reads arrive

1. Run `.\start.ps1`
2. Wave a tagged part at an antenna
3. Console shows lines like `[HH:MM:SS] Tag: 1D40463947 Ant1 RSSI:-48dBm`
4. Check `GET http://localhost:5001/api/summary` — `reader_status` should be **Active**
5. Run `python tracking/listener.py --health` — `last_event_seconds_ago` should be small

---

## Legacy LLRP mode

Direct LLRP via `sllurp` exists only in `archive/read.py` and is **not** the production path. Use HTTP POST for FX9600 deployments.

---

## Related

- [Session lifecycle](../explanation/session-lifecycle.md) — what happens after a read arrives
- [Configuration](../reference/configuration.md) — RSSI and timeout tuning
- [Print RFID labels](print-rfid-labels.md) — create test tags
