"""End-to-end smoke test for Sewio RTLS + core API."""
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tracking"))

from rtls_lookup import station_for_zone, zones_for_station

BASE = "http://localhost:5001"


def get(path):
    with urllib.request.urlopen(BASE + path, timeout=10) as r:
        return r.getcode(), json.loads(r.read())


def main() -> int:
    checks: list[tuple[str, bool]] = []
    print("=== RTLS & core API smoke test ===\n")

    code, h = get("/api/rtls/health")
    checks.append(("GET /api/rtls/health", code == 200))
    checks.append(("RTLS enabled", h.get("enabled") is True))
    checks.append(("REST feeds OK", h.get("rest", {}).get("ok") is True))
    checks.append(("REST tag count > 0", (h.get("rest", {}).get("tag_count") or 0) > 0))
    checks.append(("RTLS client running", h.get("client_running") is True))

    time.sleep(4)
    _, h2 = get("/api/rtls/health")
    checks.append(("WebSocket connected", h2.get("websocket_connected") is True))

    _, live = get("/api/rtls/live")
    checks.append(("GET /api/rtls/live", True))
    checks.append(("Live state has positions", "positions" in live))
    checks.append(("Live state has zone_presence", "zone_presence" in live))

    _, ops = get("/api/operators")
    checks.append(("Operators loaded (>=16)", len(ops) >= 16))
    checks.append((
        "Benjamin Salas in operators",
        any(o.get("operator_name") == "Benjamin Salas" for o in ops),
    ))

    checks.append(("Zone 7 -> Gannomat", station_for_zone(7) == "Gannomat"))
    checks.append(("Gannomat zones include 7", 7 in zones_for_station("Gannomat")))

    for path in ("/api/live", "/api/summary", "/api/completed"):
        c, _ = get(path)
        checks.append((f"GET {path}", c == 200))

    try:
        with urllib.request.urlopen("http://localhost:5000/healthz", timeout=3) as r:
            lh = json.loads(r.read())
        checks.append(("Listener /healthz", r.getcode() == 200))
        checks.append(("Listener DB writable", lh.get("db_writable") is True))
    except (urllib.error.URLError, OSError):
        checks.append(("Listener running on :5000", False))

    passed = 0
    failed_names = []
    for name, ok in checks:
        mark = "PASS" if ok else "FAIL"
        print(f"  [{mark}] {name}")
        if ok:
            passed += 1
        else:
            failed_names.append(name)

    print()
    print(f"RTLS websocket_connected : {h2.get('websocket_connected')}")
    print(f"RTLS last_message_at     : {h2.get('last_message_at')}")
    print(f"Positions in memory      : {len(live.get('positions', []))}")
    print(f"Zone presence in memory  : {len(live.get('zone_presence', []))}")
    if live.get("positions"):
        p = live["positions"][0]
        print(f"Sample position          : tag {p.get('tag_id')} ({p.get('operator_name')}) "
              f"x={p.get('x')}, y={p.get('y')}")
    if live.get("zone_presence"):
        z = live["zone_presence"][0]
        print(f"Sample zone event        : {z.get('operator_name')} {z.get('status')} {z.get('zone_name')}")
    print()

    if failed_names:
        print(f"FAILED: {len(failed_names)} / {len(checks)}")
        for n in failed_names:
            print(f"  - {n}")
        return 1

    print(f"ALL {passed} CHECKS PASSED")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
