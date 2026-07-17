# Tutorial: Getting started

This tutorial walks you through a first successful run of the Material Tracking system. By the end you will have the API and RFID listener running, the dashboard open in a browser, and a way to verify that data is flowing.

**Time:** about 20 minutes  
**Prerequisites:** Windows 10+, Python 3.11+, Node.js 20+ (for dashboard dev/build)

---

## What you are building

The system tracks parts with RFID tags as they move through production stations (Gannomat, Tennoner, Insert Station, LBD, and others). A Zebra FX9600 reader sends tag reads to a Python listener; the listener writes to SQLite; a Flask API serves data to a React dashboard with live updates over Socket.IO.

You do not need a physical reader to complete this tutorial — the [simulator](../how-to/run-the-simulator.md) can inject fake reads instead.

---

## Step 1: Clone and open the project

```powershell
cd C:\path\to\material_tracking
```

The project root contains `api.py`, `config.py`, `start.ps1`, and folders `tracking/`, `dashboard/`, and `database/`.

---

## Step 2: Create a Python virtual environment

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

This installs Flask, Flask-SocketIO, python-dotenv, and other backend dependencies.

---

## Step 3: Configure environment variables

Copy the example file and review defaults:

```powershell
copy .env.example .env
```

For a first run, the defaults in `.env.example` are fine. Key values:

| Variable | Purpose |
|----------|---------|
| `LISTENER_PORT` | Port the Zebra reader POSTs to (5000) |
| `DB_PATH` | SQLite file location |
| `RSSI_MIN` | Minimum signal strength to accept a read |
| `MIN_READS_FOR_SESSION` | Reads required before opening a session |

See [Configuration reference](../reference/configuration.md) for the full list.

---

## Step 4: Build the dashboard (one-time)

The API serves the built React app from `dashboard/dist`:

```powershell
cd dashboard
npm install
npm run build
cd ..
```

If you skip this step, the API still runs but shows a JSON index at `http://localhost:5001` instead of the UI.

---

## Step 5: Start all services

From the project root:

```powershell
.\start.ps1
```

The launcher:

1. Stops anything already listening on ports 5000 and 5001
2. Starts `api.py` on port **5001**
3. Starts `tracking/listener.py` on port **5000**
4. Prints your LAN IP for reader configuration
5. Streams colored live logs until you press **Ctrl+C**

Expected output includes:

```
API ready             -> http://localhost:5001
Listener ready        -> http://localhost:5000/tags
Reader POST target  ->  http://10.25.x.x:5000/tags
Dashboard           ->  http://localhost:5001
```

---

## Step 6: Open the dashboard

1. Browse to **http://localhost:5001**
2. Click through the landing page to enter the live view
3. Confirm the header shows a connection indicator (live / reconnecting)

The live map shows part chips on a floor plan when sessions exist. With no scans yet, the map may be empty — that is normal.

---

## Step 7: Verify the listener health

In a **second terminal** (leave `start.ps1` running):

```powershell
python tracking/listener.py --health
```

A healthy listener returns exit code **0** and JSON like:

```json
{
  "status": "ok",
  "open_sessions": 0,
  "db_writable": true
}
```

You can also open **http://localhost:5000/healthz** in a browser.

---

## Step 8: Inject test data (no reader required)

With the API still running, open a third terminal:

```powershell
python sim/run.py --ibus IBUS462064 --auto --duration 60
```

The simulator clears prior session history (by default), loads work-order parts, and walks them through the antenna path. Watch `start.ps1` logs for `Tag:` lines and session open/close messages.

Refresh the dashboard — part chips should appear on the floor plan and move along the production spine.

---

## Step 9: Confirm API data

```powershell
curl http://localhost:5001/api/summary
curl http://localhost:5001/api/live
```

`parts_in_process` and live session arrays should reflect simulator activity.

---

## What you learned

- Backend runs as two processes: **listener (5000)** for ingest, **API (5001)** for queries and the dashboard
- Configuration lives in `.env`, loaded by `config.py`
- The dashboard is a static React build served by Flask, updated via Socket.IO `rfid_update` events
- `sim/run.py` exercises the same code path as a real Zebra reader

---

## Next steps

| Goal | Document |
|------|----------|
| Tour the UI in detail | [Explore the dashboard](explore-the-dashboard.md) |
| Connect a real FX9600 | [Configure the Zebra reader](../how-to/configure-zebra-reader.md) |
| Understand scan → session logic | [Session lifecycle](../explanation/session-lifecycle.md) |
| Look up endpoints | [API reference](../reference/api.md) |
