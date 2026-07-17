# Material Tracking

Track RFID-labeled parts and operator badges through Bobrick production stations. Measure dwell time, visualize live floor status, and analyze throughput from Gannomat through Tennoner, LBD, and Insert Station.

## Documentation

Full documentation follows the [Diátaxis framework](https://diataxis.fr/) — tutorials, how-to guides, explanations, and reference:

**[→ docs/README.md](docs/README.md)** · **Web app:** `pip install -r requirements-docs.txt && mkdocs serve` → http://127.0.0.1:8000

| Start here | Link |
|------------|------|
| First-time setup | [Getting started](docs/tutorials/getting-started.md) |
| Run the stack | [Run locally](docs/how-to/run-locally.md) |
| System overview | [Architecture](docs/explanation/architecture.md) |
| API & config | [API reference](docs/reference/api.md) · [Configuration](docs/reference/configuration.md) |

## Quick start

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env

cd dashboard && npm install && npm run build && cd ..

.\start.ps1
```

- **Dashboard:** http://localhost:5001  
- **Reader POST:** http://\<your-ip\>:5000/tags  
- **Health:** http://localhost:5000/healthz  

Demo without hardware:

```powershell
python sim/run.py --ibus IBUS462064 --auto --duration 60
```

## Architecture (summary)

```
Zebra FX9600  ──POST /tags──►  listener.py (:5000)
                                      │
                                      ▼
                               DwellTracker / SQLite
                                      │
                    ┌─────────────────┴─────────────────┐
                    ▼                                   ▼
              api.py (:5001)                    Sewio RTLS (optional)
                    │
                    ▼
            React dashboard (Vite)
```

See [Architecture](docs/explanation/architecture.md) and [architecture.html](docs/architecture.html) for detail.

## Project layout

```
material_tracking/
├── api.py                 # REST API + Socket.IO + dashboard host
├── config.py              # Environment configuration
├── start.ps1              # Start API + listener
├── tracking/              # Listener, session logic, RTLS clients
├── database/              # SQLite + migrations
├── dashboard/             # React SPA (Vite)
├── sim/                   # Offline RFID simulator
├── RTLS/                  # Floor plan JSON, zone mappings
├── r41/                   # Work order ingest
├── printer/               # Label encode/print
├── tests/                 # Integration tests
└── docs/                  # Documentation (Diátaxis)
```

## Tests

```powershell
.\start.ps1          # in one terminal
.\tests\run_all.ps1  # in another
```

See [How to run tests](docs/how-to/run-tests.md).

## License / context

Proof-of-concept for Bobrick Washroom Equipment shop-floor visibility. Internal deployment — adjust `.env` per station.
