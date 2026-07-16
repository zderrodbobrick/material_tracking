"""
Seed a small test work order (IBUS900001) with 4 parts at Tennoner entrance.

Usage (from repo root, API running recommended):
    python sim/seed_test_wo.py
"""

from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tracking"))

from config import DB_PATH, MIN_READS_FOR_SESSION  # noqa: E402
from database.migrate import run_migrations  # noqa: E402
from r41.ingest import _connect, ingest_order  # noqa: E402
from storage import DwellTracker  # noqa: E402

TEST_IBUS = "IBUS900001"
TEST_WO = "900001"
START_ANTENNA = 7  # Tennoner Entry
DEFAULT_RSSI = -45
NOTIFY_URL = "http://127.0.0.1:5001/api/notify"

TEST_PARTS = [
    {"ref": "T1", "qty": 1, "product": "TEST PANEL A"},
    {"ref": "T2", "qty": 1, "product": "TEST PANEL B"},
    {"ref": "T3", "qty": 1, "product": "TEST PANEL C"},
    {"ref": "T4", "qty": 1, "product": "TEST PANEL D"},
]


def _build_epc(qty: int, ref: str, work_order: str) -> str:
    wo = str(work_order).zfill(6)[-6:]
    q = str(max(1, min(int(qty), 9)))
    return f"{q}{ref}0{wo}"


def _tag_label(qty: int, ref: str, work_order: str) -> str:
    wo = str(work_order).zfill(6)[-6:]
    q = str(max(1, min(int(qty), 9)))
    return f"{q}-{ref}-IBUS{wo}"


def _notify() -> bool:
    try:
        body = json.dumps({"action": "seed_test_wo"}).encode("utf-8")
        req = urllib.request.Request(
            NOTIFY_URL,
            data=body,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=2) as resp:
            return 200 <= getattr(resp, "status", 200) < 300
    except (urllib.error.URLError, TimeoutError, OSError):
        return False


def _epc_to_hex(epc: str) -> str:
    return epc.encode("ascii").hex()


def _inject(tracker: DwellTracker, epc: str, antenna: int, burst: int) -> None:
    id_hex = _epc_to_hex(epc)
    base = datetime.now(timezone.utc)
    for i in range(burst):
        stamp = base + timedelta(milliseconds=15 * i)
        ts = stamp.strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "+0000"
        tracker.ingest_batch([{
            "timestamp": ts,
            "data": {
                "idHex": id_hex,
                "antenna": antenna,
                "peakRssi": DEFAULT_RSSI,
            },
        }])


def main() -> None:
    parts = []
    for i, spec in enumerate(TEST_PARTS, start=1):
        epc = _build_epc(spec["qty"], spec["ref"], TEST_WO)
        parts.append({
            "index": i,
            "ref": spec["ref"],
            "qty": spec["qty"],
            "epc": epc,
            "tag_label": _tag_label(spec["qty"], spec["ref"], TEST_WO),
            "product": spec["product"],
            "ibus": TEST_IBUS,
            "work_order": TEST_WO,
            "operation": "TEST",
            "material_family": "TEST",
            "color": "SKY",
            "room": "TEST",
            "size": "",
            "length": None,
            "width": None,
            "part_id": None,
            "job_number": TEST_WO,
            "po": "TEST",
            "drawing": "",
            "bem": "",
            "bem2": "",
            "bem3": f";;;;;{TEST_IBUS}",
        })

    order = {
        "ibus": TEST_IBUS,
        "work_order": TEST_WO,
        "customer": "TEST CUSTOMER",
        "job_site": "TEST SITE",
        "prod_date": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "source": "sim/seed_test_wo.py",
        "parts": parts,
        "totals": {"parts": len(parts), "pieces": len(parts)},
    }

    conn = _connect(DB_PATH)
    try:
        run_migrations(conn)
        result = ingest_order(conn, order, replace=True)
        conn.commit()
        print(f"Ingested {TEST_IBUS}: {result.get('parts_count', len(parts))} components")
    finally:
        conn.close()

    tracker = DwellTracker()
    burst = max(MIN_READS_FOR_SESSION, 3)
    for p in parts:
        _inject(tracker, p["epc"], START_ANTENNA, burst)
        print(f"  seeded {p['tag_label']} @ ant {START_ANTENNA}")

    live = _notify()
    print(
        f"Done — {len(parts)} parts at Tennoner entrance (ant {START_ANTENNA}). "
        f"{'Dashboard updated.' if live else 'API offline — start api.py then refresh.'}"
    )


if __name__ == "__main__":
    main()
