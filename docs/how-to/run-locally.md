# How to run locally

Start the Material Tracking backend and dashboard on a Windows development machine.

---

## Prerequisites

- Python 3.11+ with `pip`
- Node.js 20+ with `npm` (for dashboard build or dev server)
- PowerShell (project scripts target Windows)

---

## One-command start (recommended)

```powershell
cd C:\path\to\material_tracking
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env   # first time only
.\start.ps1
```

`start.ps1` starts both services and tails logs. **Ctrl+C** stops the listener and API cleanly.

---

## Manual start (two terminals)

**Terminal 1 — API (port 5001):**

```powershell
.\.venv\Scripts\Activate.ps1
python api.py
```

**Terminal 2 — Listener (port 5000):**

```powershell
.\.venv\Scripts\Activate.ps1
cd tracking
python listener.py
```

---

## Dashboard options

### Production build (served by API)

```powershell
cd dashboard
npm install
npm run build
```

Open **http://localhost:5001**.

### Dev server (hot reload)

```powershell
cd dashboard
npm run dev
```

Open **http://localhost:5173**. The Vite dev server proxies API calls to port 5001.

---

## Verify services

| Check | Command / URL |
|-------|----------------|
| Listener health | `python tracking/listener.py --health` |
| Listener HTTP | http://localhost:5000/healthz |
| API summary | http://localhost:5001/api/summary |
| RTLS status | http://localhost:5001/api/rtls/health |

---

## Common issues

**Port already in use** — `start.ps1` kills processes on 5000/5001 before starting. If manual processes remain, stop them in Task Manager or run `Stop-Process` on the PID from `netstat -ano | findstr :5001`.

**Empty dashboard** — Run `npm run build` in `dashboard/`. Without `dist/`, the API returns JSON instead of the SPA.

**No parts on map** — Start the [simulator](run-the-simulator.md) or connect a Zebra reader. The map only shows active sessions.

**Database locked** — Only one writer should hold long transactions. Both listener and API use WAL mode with busy timeout; avoid copying `rfid_reads.db` while services run.

---

## Related

- [Getting started tutorial](../tutorials/getting-started.md)
- [Configuration reference](../reference/configuration.md)
