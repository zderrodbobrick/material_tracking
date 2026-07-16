"""
Ingest Cut Rite .R41 work orders into work_orders + work_order_components.

Also creates matching rows in parts / rfid_tags / part_tag_assignments so
RFID reads and the simulator can resolve every BOM line.

Usage (from repo root):
    python r41/ingest.py
    python r41/ingest.py .R41/IBUS462064.R41
    python r41/ingest.py .R41 --replace
"""

from __future__ import annotations

import argparse
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from config import DB_PATH  # noqa: E402
from database.migrate import run_migrations  # noqa: E402
from epc_type_map import parse_tag_id  # noqa: E402
from r41.parse_r41 import list_r41_files, parse_r41_file  # noqa: E402


def _utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _connect(db_path: Path | None = None) -> sqlite3.Connection:
    path = Path(db_path or DB_PATH)
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON;")
    run_migrations(conn)
    return conn


def _ensure_tag_and_part(conn: sqlite3.Connection, epc: str, part_meta: dict[str, Any]) -> tuple[int, int]:
    """Find or create rfid_tags + parts + assignment for this EPC."""
    row = conn.execute("SELECT tag_id FROM rfid_tags WHERE epc = ?", (epc,)).fetchone()
    if row:
        tag_id = row["tag_id"]
    else:
        cur = conn.execute("INSERT INTO rfid_tags (epc) VALUES (?)", (epc,))
        tag_id = cur.lastrowid

    asg = conn.execute(
        "SELECT part_id FROM part_tag_assignments "
        "WHERE tag_id = ? AND unassigned_at IS NULL "
        "ORDER BY assignment_id DESC LIMIT 1",
        (tag_id,),
    ).fetchone()
    if asg:
        return tag_id, asg["part_id"]

    parsed = parse_tag_id(epc)
    qty = part_meta.get("qty")
    try:
        qty_i = int(qty) if qty is not None else (int(parsed["qty"]) if parsed.get("qty") else None)
    except (TypeError, ValueError):
        qty_i = None

    cur = conn.execute(
        "INSERT INTO parts (part_number, part_name, part_type, ibus_number, "
        "                   job_number, quantity_required) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        (
            part_meta.get("ref") or parsed.get("part_number"),
            part_meta.get("tag_label") or part_meta.get("ref") or parsed.get("part_number"),
            parsed.get("type_label") or "IBUS",
            part_meta.get("ibus") or parsed.get("raw") or epc,
            part_meta.get("work_order") or parsed.get("work_order"),
            qty_i,
        ),
    )
    part_id = cur.lastrowid
    conn.execute(
        "INSERT INTO part_tag_assignments (part_id, tag_id) VALUES (?, ?)",
        (part_id, tag_id),
    )
    return tag_id, part_id


def ingest_order(
    conn: sqlite3.Connection,
    order: dict[str, Any],
    *,
    replace: bool = False,
) -> dict[str, Any]:
    """Upsert one parsed R41 order and all of its component lines."""
    ibus = (order.get("ibus") or "").strip()
    if not ibus and order.get("work_order"):
        ibus = f"IBUS{order['work_order']}"
    if not ibus:
        raise ValueError("Order has no IBUS / work order name")

    now = _utc_now()
    existing = conn.execute(
        "SELECT work_order_id FROM work_orders WHERE ibus_number = ?", (ibus,)
    ).fetchone()

    totals = order.get("totals") or {}
    parts_count = int(totals.get("parts") or len(order.get("parts") or []))
    pieces_count = int(
        totals.get("pieces")
        or sum(int(p.get("qty") or 1) for p in (order.get("parts") or []))
    )

    if existing and replace:
        wo_id = existing["work_order_id"]
        conn.execute("DELETE FROM work_order_components WHERE work_order_id = ?", (wo_id,))
        conn.execute(
            "UPDATE work_orders SET work_order=?, customer=?, job_site=?, prod_date=?, "
            "project_id=?, source_file=?, parts_count=?, pieces_count=?, "
            "ingested_at=?, updated_at=? WHERE work_order_id=?",
            (
                order.get("work_order") or "",
                order.get("customer") or "",
                order.get("job_site") or "",
                order.get("prod_date") or "",
                order.get("project_id") or "",
                order.get("source") or "",
                parts_count,
                pieces_count,
                now,
                now,
                wo_id,
            ),
        )
    elif existing:
        wo_id = existing["work_order_id"]
        conn.execute(
            "UPDATE work_orders SET customer=?, job_site=?, prod_date=?, project_id=?, "
            "source_file=?, parts_count=?, pieces_count=?, ingested_at=?, updated_at=? "
            "WHERE work_order_id=?",
            (
                order.get("customer") or "",
                order.get("job_site") or "",
                order.get("prod_date") or "",
                order.get("project_id") or "",
                order.get("source") or "",
                parts_count,
                pieces_count,
                now,
                now,
                wo_id,
            ),
        )
    else:
        cur = conn.execute(
            "INSERT INTO work_orders "
            "(ibus_number, work_order, customer, job_site, prod_date, project_id, "
            " source_file, parts_count, pieces_count, status, ingested_at, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)",
            (
                ibus,
                order.get("work_order") or "",
                order.get("customer") or "",
                order.get("job_site") or "",
                order.get("prod_date") or "",
                order.get("project_id") or "",
                order.get("source") or "",
                parts_count,
                pieces_count,
                now,
                now,
                now,
            ),
        )
        wo_id = cur.lastrowid

    inserted = 0
    updated = 0
    for p in order.get("parts") or []:
        epc = (p.get("epc") or "").strip()
        line_index = int(p.get("index") or 0)
        tag_id = part_id = None
        if epc:
            tag_id, part_id = _ensure_tag_and_part(conn, epc, p)

        row = conn.execute(
            "SELECT component_id FROM work_order_components "
            "WHERE work_order_id = ? AND line_index = ?",
            (wo_id, line_index),
        ).fetchone()

        fields = (
            p.get("ref") or "",
            int(p.get("qty") or 1),
            epc or None,
            p.get("tag_label") or "",
            part_id,
            tag_id,
            p.get("size") or "",
            p.get("room") or "",
            p.get("operation") or "",
            p.get("product") or "",
            p.get("material_family") or "",
            p.get("color") or "",
            p.get("length") or "",
            p.get("width") or "",
            p.get("part_id") or "",
            p.get("job_number") or "",
            p.get("po") or "",
            p.get("drawing") or "",
            p.get("bem") or "",
            p.get("bem2") or "",
            p.get("bem3") or "",
            now,
        )

        if row:
            conn.execute(
                "UPDATE work_order_components SET "
                "ref=?, qty=?, epc=?, tag_label=?, part_id=?, tag_id=?, "
                "size=?, room=?, operation=?, product=?, material_family=?, color=?, "
                "length_cut=?, width_cut=?, part_erp_id=?, job_number=?, po=?, drawing=?, "
                "bem=?, bem2=?, bem3=?, updated_at=? "
                "WHERE component_id=?",
                (*fields, row["component_id"]),
            )
            updated += 1
        else:
            conn.execute(
                "INSERT INTO work_order_components "
                "(work_order_id, line_index, ref, qty, epc, tag_label, part_id, tag_id, "
                " size, room, operation, product, material_family, color, "
                " length_cut, width_cut, part_erp_id, job_number, po, drawing, "
                " bem, bem2, bem3, status, created_at, updated_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, "
                "        'pending', ?, ?)",
                (wo_id, line_index, *fields[:-1], now, now),
            )
            inserted += 1

    # Refresh counts from actual component rows
    cnt = conn.execute(
        "SELECT COUNT(*) AS n, COALESCE(SUM(qty),0) AS pieces "
        "FROM work_order_components WHERE work_order_id = ?",
        (wo_id,),
    ).fetchone()
    conn.execute(
        "UPDATE work_orders SET parts_count=?, pieces_count=?, updated_at=? WHERE work_order_id=?",
        (cnt["n"], cnt["pieces"], now, wo_id),
    )

    return {
        "work_order_id": wo_id,
        "ibus_number": ibus,
        "components_inserted": inserted,
        "components_updated": updated,
        "parts_count": cnt["n"],
        "pieces_count": cnt["pieces"],
        "source": order.get("source"),
    }


def ingest_path(
    path: Path | None = None,
    *,
    replace: bool = False,
    db_path: Path | None = None,
) -> list[dict[str, Any]]:
    """Ingest one .R41 file or every .R41 in a folder."""
    if path is None:
        for folder in (ROOT / ".R41", ROOT / "r41" / "inbox"):
            files = list_r41_files(folder) if folder.is_dir() else []
            if files:
                targets = files
                break
        else:
            raise FileNotFoundError("No .R41 files found in .R41/ or r41/inbox/")
    elif path.is_dir():
        targets = list_r41_files(path)
        if not targets:
            raise FileNotFoundError(f"No .R41 files in {path}")
    elif path.is_file():
        targets = [path]
    else:
        raise FileNotFoundError(path)

    conn = _connect(db_path)
    results = []
    try:
        for f in targets:
            order = parse_r41_file(f)
            summary = ingest_order(conn, order, replace=replace)
            results.append(summary)
        conn.commit()
    finally:
        conn.close()
    return results


def main() -> int:
    parser = argparse.ArgumentParser(description="Ingest .R41 work orders into SQLite")
    parser.add_argument(
        "path",
        nargs="?",
        help="Path to a .R41 file or folder (default: .R41/ then r41/inbox/)",
    )
    parser.add_argument(
        "--replace",
        action="store_true",
        help="Delete existing components for the IBUS and re-insert from the file",
    )
    parser.add_argument("--db", help="Override DB path")
    args = parser.parse_args()

    target = Path(args.path) if args.path else None
    if target and not target.is_absolute():
        target = (Path.cwd() / target).resolve()

    try:
        results = ingest_path(target, replace=args.replace, db_path=Path(args.db) if args.db else None)
    except (FileNotFoundError, ValueError) as exc:
        print(f"Error: {exc}")
        return 1

    for r in results:
        print(
            f"  {r['ibus_number']}: {r['parts_count']} components "
            f"(+{r['components_inserted']} / ~{r['components_updated']}) "
            f"from {r.get('source') or '-'}"
        )
    print(f"  Done — {len(results)} work order(s) in {DB_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
