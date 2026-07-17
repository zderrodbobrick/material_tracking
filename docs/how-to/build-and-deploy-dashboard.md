# How to build and deploy the dashboard

Serve the React dashboard in development or production.

---

## Stack

| Tool | Version | Role |
|------|---------|------|
| React | 19 | UI components |
| Vite | 8 | Build tool and dev server |
| Tailwind CSS | 4 | Styling |
| socket.io-client | 4 | Live updates from API |

Source lives in `dashboard/src/`. Production output goes to `dashboard/dist/`.

---

## Development (hot reload)

Terminal 1 — API:

```powershell
python api.py
```

Terminal 2 — Vite:

```powershell
cd dashboard
npm install
npm run dev
```

Open **http://localhost:5173**. API requests go to **http://localhost:5001**.

---

## Production build (served by Flask)

```powershell
cd dashboard
npm install
npm run build
```

Flask in `api.py` serves `dashboard/dist/` at **http://localhost:5001**.

---

## Floor plan env vars

Sewio-to-pixel mapping uses Vite env vars from the project root `.env`:

```env
VITE_FLOOR_PLAN_ORIGIN_X=7
VITE_FLOOR_PLAN_ORIGIN_Y=2.5
VITE_FLOOR_PLAN_PIXEL_X=131
VITE_FLOOR_PLAN_PIXEL_Y=81
VITE_FLOOR_PLAN_SCALE=18
```

Run `npm run build` again after changes.

---

## Related

- [Run locally](run-locally.md)
- [API reference](../reference/api.md)
