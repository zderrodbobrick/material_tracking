"""
Show all parts from .R41 work-order files in r41/inbox/ (or a given path).

Usage:
    python r41/show_parts.py
    python r41/show_parts.py path/to/IBUS376814.R41
    python r41/show_parts.py --json
    python r41/show_parts.py --ref S32
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

# Allow `python r41/show_parts.py` from repo root
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from r41.parse_r41 import (  # noqa: E402
    inbox_dir,
    list_r41_files,
    parse_inbox,
    parse_r41_file,
    station_progress_pct,
)


def _print_order(order: dict, ref_filter: str | None = None) -> None:
    parts = order["parts"]
    if ref_filter:
        needle = ref_filter.strip().upper()
        parts = [p for p in parts if (p.get("ref") or "").upper() == needle]

    print("=" * 100)
    print(f"  {order['ibus'] or '(no IBUS)'}   WO={order['work_order'] or '-'}")
    print(f"  Customer : {order['customer'] or '-'}")
    print(f"  Job site : {order['job_site'] or '-'}")
    print(f"  Prod date: {order['prod_date'] or '-'}")
    if order.get("source"):
        print(f"  Source   : {order['source']}")
    t = order["totals"]
    print(
        f"  Totals   : {t['parts']} parts, {t['pieces']} pieces"
        + (f", {t['boards']} boards" if t.get("boards") is not None else "")
        + (f", {t['layouts']} layouts" if t.get("layouts") is not None else "")
    )
    prog = order["progress"]
    print(
        f"  Progress : {prog['start_station']} -> {prog['end_station']} "
        f"({len(prog['stations'])} stations x ~{prog['pct_per_station']}% each)"
    )
    if order.get("materials"):
        mats = ", ".join(m["mat"] for m in order["materials"][:12])
        more = f" (+{len(order['materials']) - 12} more)" if len(order["materials"]) > 12 else ""
        print(f"  Materials: {mats}{more}")
    print("=" * 100)

    if not parts:
        print("  (no parts matched)")
        print()
        return

    hdr = (
        f"{'#':>3}  {'REF':6}  {'Qty':>3}  {'Size':18}  {'Room':14}  "
        f"{'Operation':22}  {'Tag label':22}  EPC"
    )
    print(hdr)
    print("-" * len(hdr))

    for p in parts:
        print(
            f"{p['index']:3d}  {p['ref'] or '?':6}  {p['qty']:3d}  "
            f"{(p.get('size') or '-')[:18]:18}  {(p.get('room') or '-')[:14]:14}  "
            f"{(p.get('operation') or '-')[:22]:22}  "
            f"{(p.get('tag_label') or '-')[:22]:22}  {p.get('epc') or '-'}"
        )

    print()
    print("Detail (all fields per part)")
    print("-" * 100)
    for p in parts:
        print(f"\n[{p['index']}] {p.get('tag_label') or p.get('ref')}")
        detail_keys = [
            ("ref", "REF"),
            ("qty", "Qty"),
            ("size", "Size"),
            ("room", "Room"),
            ("operation", "Operation"),
            ("drawing_desc", "Drawing"),
            ("product", "Product"),
            ("material_family", "Material"),
            ("color", "Color"),
            ("job_label", "Job label"),
            ("job_number", "Job #"),
            ("po", "PO"),
            ("hardware_note", "Hardware"),
            ("length", "L (cut)"),
            ("width", "B (cut)"),
            ("dim_w", "W (BEM3)"),
            ("dim_l", "L (BEM3)"),
            ("part_id", "PartID"),
            ("material_nr", "MATNR"),
            ("seq_no", "SEQNO"),
            ("ibus", "IBUS"),
            ("work_order", "Work order"),
            ("epc", "EPC"),
            ("tag_label", "Tag label"),
            ("bem", "BEM"),
            ("bem2", "BEM2"),
            ("bem3", "BEM3"),
            ("drawing", "DRAWING"),
        ]
        for key, label in detail_keys:
            val = p.get(key)
            if val is None or val == "":
                continue
            print(f"  {label:12}: {val}")

    print()
    print("Station progress scale (first detection at LBD = start)")
    for i, st in enumerate(prog["stations"], start=1):
        pct = station_progress_pct(st)
        print(f"  {i:2d}. {st:24}  {pct:6.1f}%")
    print()


def main() -> int:
    parser = argparse.ArgumentParser(description="Show parts from .R41 work-order files")
    parser.add_argument(
        "path",
        nargs="?",
        help="Path to a .R41 file, or a folder of them (default: r41/inbox)",
    )
    parser.add_argument("--json", action="store_true", help="Print JSON instead of a table")
    parser.add_argument("--ref", help="Only show this REF (e.g. S32)")
    args = parser.parse_args()

    orders: list[dict]
    if args.path:
        target = Path(args.path)
        if target.is_file():
            orders = [parse_r41_file(target)]
        elif target.is_dir():
            files = list_r41_files(target)
            if not files:
                print(f"No .R41 files in {target}")
                return 1
            orders = [parse_r41_file(p) for p in files]
        else:
            print(f"Not found: {target}")
            return 1
    else:
        inbox = inbox_dir()
        inbox.mkdir(parents=True, exist_ok=True)
        files = list_r41_files(inbox)
        if not files:
            print(f"No .R41 files in {inbox}")
            print("Drop Cut Rite .R41 files into that folder, then re-run.")
            return 1
        orders = parse_inbox(inbox)

    if args.json:
        if args.ref:
            needle = args.ref.strip().upper()
            for o in orders:
                o["parts"] = [p for p in o["parts"] if (p.get("ref") or "").upper() == needle]
        # Drop bulky raw field for JSON unless useful — keep raw for completeness
        print(json.dumps(orders if len(orders) > 1 else orders[0], indent=2))
        return 0

    for order in orders:
        _print_order(order, ref_filter=args.ref)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
