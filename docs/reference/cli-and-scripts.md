# CLI and scripts reference

Command-line tools and helper scripts in the project root and subfolders.

---

## `start.ps1`

**Purpose:** Start API + listener with unified log stream.

```powershell
.\start.ps1
```

| Step | Action |
|------|--------|
| 1 | Kill processes on ports 5000, 5001 |
| 2 | Load `.env` into process environment |
| 3 | Background job: `python api.py` |
| 4 | Background job: `python tracking/listener.py` |
| 5 | Stream color-coded logs until Ctrl+C |
| 6 | Stop jobs and ports on exit |

---

## `api.py`

**Purpose:** REST API + Socket.IO + dashboard static files.

```powershell
python api.py
```

Listens on **5001**. Applies DB migrations on first connection.

---

## `tracking/listener.py`

**Purpose:** Zebra HTTP POST ingest.

```powershell
python tracking/listener.py
python tracking/listener.py --health    # exit 0 if /healthz ok
python tracking/listener.py --verbose   # Flask access logs
```

Listens on **5000**. Endpoints: `POST /tags`, `GET /healthz`.

---

## `sim/run.py`

**Purpose:** Offline RFID pipeline simulator.

```powershell
python sim/run.py
python sim/run.py --ibus IBUS462064 --auto --duration 90
python sim/run.py --no-clear --no-operators
```

See [How to run the simulator](../how-to/run-the-simulator.md).

---

## `sim/seed_test_wo.py`

**Purpose:** Seed a test work order into the database.

```powershell
python sim/seed_test_wo.py
```

---

## `sim/operator_move.py`

**Purpose:** RTLS operator movement thread (used by sim, not run directly in normal use).

---

## `r41/ingest.py` / `r41/parse_r41.py`

**Purpose:** Parse Bobrick `.R41` work order files and load components.

```powershell
python r41/ingest.py
python r41/show_parts.py
```

Sample files under `r41/inbox/` and `.R41/`.

---

## `printer/encode_rfid_only.py`

**Purpose:** Network ZPL RFID encode.

```powershell
python printer/encode_rfid_only.py [--epc HEX] [--ip IP] [--dry-run]
```

---

## `printer/print_labels.py`

**Purpose:** Windows spooler test label print.

```powershell
python printer/print_labels.py
```

---

## `check_db.py`

**Purpose:** Quick `tag_reads` / session table inspection.

```powershell
python check_db.py
```

---

## `tests/run_all.ps1`

**Purpose:** Run full test suite.

```powershell
.\tests\run_all.ps1
```

Individual tests: `python tests/test_api.py`, etc.

---

## `tests/check_live.py`

**Purpose:** Snapshot of recent DB activity.

```powershell
python tests/check_live.py
```

---

## `archive/read.py`

**Purpose:** Legacy LLRP reader via `sllurp`. **Deprecated** — do not use for FX9600 HTTP deployments.

---

## `_verify.py`

Ad-hoc verification script (project-specific checks). Run only when documented in commit or task context.

---

## Dashboard npm scripts

From `dashboard/`:

| Script | Command | Purpose |
|--------|---------|---------|
| dev | `npm run dev` | Vite dev server :5173 |
| build | `npm run build` | Production bundle → `dist/` |
| lint | `npm run lint` | oxlint |
| preview | `npm run preview` | Preview production build |

---

## Related

- [Run locally](../how-to/run-locally.md)
- [Configuration](configuration.md)
