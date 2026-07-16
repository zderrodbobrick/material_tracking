"""
Offline RFID line simulator — no Zebra reader, no HTTP listener required.

Loads parts from the ingested work_order_components table (or .R41/),
injects fake antenna reads into SQLite, and pings the API so the dashboard
updates live.

Usage (from repo root):
    python sim/run.py

Move syntax (pick one):
    1 4                 part #1 -> antenna 4
    S17 1               REF S17 -> antenna 1
    move 1 3            same as above

Keep the API running (`python api.py`) for live dashboard chips.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tracking"))

from config import (  # noqa: E402
    ANTENNA_CATALOG,
    MIN_READS_FOR_SESSION,
)
from r41.parse_r41 import list_r41_files, parse_r41_file  # noqa: E402
from storage import DwellTracker  # noqa: E402

DEFAULT_RSSI = -45
START_ANTENNA = 7  # Tennoner Entry
NOTIFY = {"url": "http://127.0.0.1:5001/api/notify"}


def _epc_to_hex(epc: str) -> str:
    return epc.encode("ascii").hex()


def _notify_dashboard(action: str = "sim_move") -> bool:
    """Tell the API to emit rfid_update so the live map refreshes immediately."""
    try:
        body = json.dumps({"action": action}).encode("utf-8")
        req = urllib.request.Request(
            NOTIFY["url"],
            data=body,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=2) as resp:
            return 200 <= getattr(resp, "status", 200) < 300
    except (urllib.error.URLError, TimeoutError, OSError):
        return False


# Short labels for the always-visible top map
ANT_SHORT = {
    1: "Gannomat ENTRY",
    2: "Gannomat EXIT (no close)",
    3: "Insert Station",
    4: "Tennoner TABLE (A)",
    5: "Tennoner TABLE (B)",
    6: "LBD",
    7: "Tennoner ENTRANCE",
}


def _load_parts(path: Path | None) -> tuple[list[dict], dict]:
    """Load parts from DB work_order_components when present, else parse .R41."""
    try:
        import sqlite3
        from config import DB_PATH
        conn = sqlite3.connect(str(DB_PATH))
        conn.row_factory = sqlite3.Row
        try:
            wo = None
            if path and path.is_file():
                order_preview = parse_r41_file(path)
                ibus = order_preview.get("ibus") or ""
                if ibus:
                    wo = conn.execute(
                        "SELECT * FROM work_orders WHERE ibus_number = ?", (ibus,)
                    ).fetchone()
            if wo is None:
                wo = conn.execute(
                    "SELECT * FROM work_orders WHERE status = 'open' "
                    "ORDER BY ingested_at DESC LIMIT 1"
                ).fetchone()
            if wo:
                rows = conn.execute(
                    "SELECT line_index, ref, qty, epc, tag_label, size, room, "
                    "       operation, product, material_family, color, "
                    "       length_cut AS length, width_cut AS width, part_erp_id, "
                    "       job_number, po, drawing, bem, bem2, bem3 "
                    "FROM work_order_components WHERE work_order_id = ? "
                    "ORDER BY line_index",
                    (wo["work_order_id"],),
                ).fetchall()
                parts = []
                for r in rows:
                    if not r["epc"]:
                        continue
                    p = dict(r)
                    p["index"] = p.pop("line_index")
                    p["part_id"] = p.pop("part_erp_id", None)
                    parts.append(p)
                order = {
                    "ibus": wo["ibus_number"],
                    "work_order": wo["work_order"],
                    "customer": wo["customer"],
                    "job_site": wo["job_site"],
                    "prod_date": wo["prod_date"],
                    "source": wo["source_file"],
                    "parts": parts,
                    "totals": {
                        "parts": wo["parts_count"],
                        "pieces": wo["pieces_count"],
                    },
                }
                return parts, order
        finally:
            conn.close()
    except Exception:
        pass

    if path is None:
        for folder in (ROOT / ".R41", ROOT / "r41" / "inbox"):
            files = list_r41_files(folder) if folder.is_dir() else []
            if files:
                path = files[0]
                break
        if path is None:
            raise SystemExit(f"No .R41 files in {ROOT / '.R41'} or {ROOT / 'r41' / 'inbox'}")
    elif path.is_dir():
        files = list_r41_files(path)
        if not files:
            raise SystemExit(f"No .R41 files in {path}")
        path = files[0]
    elif not path.is_file():
        raise SystemExit(f"Not found: {path}")

    order = parse_r41_file(path)
    parts = [p for p in order["parts"] if p.get("epc")]
    return parts, order


def _print_antenna_map() -> None:
    """Always-visible 1-7 map at the top of the terminal."""
    print()
    print("  +-- ANTENNA MAP (type: <part#> <antenna#>) ----------------+")
    print("  |                                                          |")
    for port in sorted(ANTENNA_CATALOG.keys()):
        label = ANT_SHORT.get(port) or ANTENNA_CATALOG[port][0]
        same = "  [=4]" if port == 5 else ("  [=5]" if port == 4 else "")
        print(f"  |   {port}  {label:<28}{same:<6}|")
    print("  |                                                        |")
    print("  |   Example:  1 4         part #1 -> Tennoner table      |")
    print("  |             move all 7  every part -> Tennoner entry   |")
    print("  +--------------------------------------------------------+")
    print()


def _print_parts(parts: list[dict], locations: dict[str, int]) -> None:
    print()
    hdr = f"{'#':>3}  {'REF':6}  {'Tag':22}  {'At':>4}  Where"
    print(hdr)
    print("-" * 60)
    for i, p in enumerate(parts, start=1):
        epc = p["epc"]
        ant = locations.get(epc)
        if ant is None:
            where, ant_s = "-", "-"
        else:
            where = ANT_SHORT.get(ant) or f"Ant{ant}"
            ant_s = str(ant)
        print(
            f"{i:3d}  {(p.get('ref') or '?'):6}  "
            f"{(p.get('tag_label') or '-')[:22]:22}  "
            f"{ant_s:>4}  {where}"
        )
    print()


def _resolve_part(token: str, parts: list[dict]) -> dict | None:
    token = token.strip()
    if token.isdigit():
        idx = int(token)
        if 1 <= idx <= len(parts):
            return parts[idx - 1]
        return None
    needle = token.lstrip("#").upper()
    hits = [p for p in parts if (p.get("ref") or "").upper() == needle]
    if len(hits) == 1:
        return hits[0]
    if len(hits) > 1:
        print(f"  Ambiguous REF {needle} — use the row number instead.")
        return None
    hits = [
        p for p in parts
        if needle in (p.get("epc") or "").upper()
        or needle in (p.get("tag_label") or "").upper()
    ]
    return hits[0] if len(hits) == 1 else None


def _inject(tracker: DwellTracker, epc: str, antenna: int, burst: int) -> dict:
    id_hex = _epc_to_hex(epc)
    base = datetime.now(timezone.utc)
    summary = {
        "raw_inserted": 0,
        "session_opened": 0,
        "session_closed": 0,
        "exit_warnings": 0,
    }
    for i in range(burst):
        stamp = base + timedelta(milliseconds=15 * i)
        ts = stamp.strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "+0000"
        event = {
            "timestamp": ts,
            "data": {
                "idHex": id_hex,
                "antenna": antenna,
                "peakRssi": DEFAULT_RSSI,
            },
        }
        part = tracker.ingest_batch([event])
        for k in summary:
            summary[k] += part.get(k, 0)
    return summary


def _move(
    tracker: DwellTracker,
    part: dict,
    antenna: int,
    locations: dict[str, int],
    burst: int,
    *,
    quiet: bool = False,
    notify: bool = True,
) -> None:
    if antenna not in ANTENNA_CATALOG:
        print(f"  Unknown antenna {antenna}. Valid: {', '.join(map(str, ANTENNA_CATALOG))}")
        return
    epc = part["epc"]
    label = part.get("tag_label") or epc
    where = ANT_SHORT.get(antenna) or ANTENNA_CATALOG[antenna][0]
    summary = _inject(tracker, epc, antenna, burst)
    locations[epc] = antenna
    if notify:
        live = _notify_dashboard("sim_move")
    else:
        live = False
    if not quiet:
        dash = "dashboard live" if live else "dashboard offline (is API on :5001?)"
        print(f"  >> {label}  ->  [{antenna}] {where}  ({dash})")


def _start_all_at(
    tracker: DwellTracker,
    parts: list[dict],
    locations: dict[str, int],
    burst: int,
    antenna: int = START_ANTENNA,
) -> None:
    where = ANT_SHORT.get(antenna) or ANTENNA_CATALOG[antenna][0]
    print(f"  Seeding {len(parts)} parts at [{antenna}] {where} …")
    print("  Closing open sessions so dwell timers restart …")
    placed = 0
    for p in parts:
        # Drop any open dwell/presence so the next read opens a fresh timer
        tracker.close_open_sessions_for_epc(p["epc"])
        _move(tracker, p, antenna, locations, burst, quiet=True, notify=False)
        if locations.get(p["epc"]) == antenna:
            placed += 1
    live = _notify_dashboard("sim_start")
    dash = "dashboard updated" if live else "dashboard offline"
    print(f"  Done — {placed}/{len(parts)} at [{antenna}] with fresh dwell. ({dash})")
    print(f"  Move with:  <part#> <antenna#>   e.g.  1 4")
    print()


def _print_help() -> None:
    print(
        f"""
  Commands
  --------
  <part> <ant>             Move part to antenna  (e.g. 1 4  or  S17 1)
  move all <ant>           Move every part  (e.g.  move all 7  or  all 7)
  list / l                 Show all parts
  map / ants / a           Show antenna map 1-7
  start / reset            Same as  move all {START_ANTENNA}
  path <part>              Walk 4 -> 1 -> 2 -> 3
  help / h
  quit / q
"""
    )


def _try_move_command(
    bits: list[str],
    parts: list[dict],
    tracker: DwellTracker,
    locations: dict[str, int],
    burst: int,
) -> bool:
    """Parse '<part> <antenna>' or 'move <part> <antenna>'. Returns True if handled."""
    tokens = bits
    if tokens and tokens[0].lower() in ("m", "move", "go"):
        tokens = tokens[1:]
    if len(tokens) != 2:
        return False
    try:
        ant = int(tokens[1])
    except ValueError:
        return False
    if ant not in ANTENNA_CATALOG:
        # Only claim if first token looks like a part/all target
        if tokens[0].lower() in ("all", "*", "everyone") or _resolve_part(tokens[0], parts):
            print(f"  Antenna must be 1-7, got {ant}")
            return True
        return False

    # move all 7  /  all 7  /  * 7
    if tokens[0].lower() in ("all", "*", "everyone"):
        _start_all_at(tracker, parts, locations, burst, ant)
        _print_parts(parts, locations)
        return True

    part = _resolve_part(tokens[0], parts)
    if part is None:
        print(f"  Part not found: {tokens[0]}")
        return True
    _move(tracker, part, ant, locations, burst)
    return True


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Offline R41 RFID antenna simulator (no reader required)"
    )
    parser.add_argument("path", nargs="?", help="Optional .R41 file or folder")
    parser.add_argument("--burst", type=int, default=None)
    parser.add_argument(
        "--no-start",
        action="store_true",
        help="Do not auto-place all parts at Tennoner entrance",
    )
    parser.add_argument(
        "--notify-url",
        default=NOTIFY["url"],
        help=f"Dashboard notify URL (default {NOTIFY['url']})",
    )
    args = parser.parse_args()

    NOTIFY["url"] = args.notify_url
    burst = max(1, args.burst or MIN_READS_FOR_SESSION)

    target = Path(args.path) if args.path else None
    if target and not target.is_absolute():
        target = (Path.cwd() / target).resolve()
    parts, order = _load_parts(target)
    locations: dict[str, int] = {}

    print("=" * 72)
    print(f"  OFFLINE RFID SIM  -  {order.get('ibus') or order.get('work_order')}")
    print(f"  {len(parts)} parts  |  live ping -> {NOTIFY['url']}")
    print("=" * 72)

    tracker = DwellTracker()
    try:
        _print_antenna_map()
        if not args.no_start:
            _start_all_at(tracker, parts, locations, burst, START_ANTENNA)
        _print_parts(parts, locations)

        while True:
            try:
                raw = input("sim> ").strip()
            except (EOFError, KeyboardInterrupt):
                print()
                break
            if not raw:
                continue

            bits = raw.split()
            cmd = bits[0].lower()

            if cmd in ("q", "quit", "exit"):
                break
            if cmd in ("h", "help", "?"):
                _print_help()
                continue
            if cmd in ("a", "ants", "antennas", "map"):
                _print_antenna_map()
                continue
            if cmd in ("l", "list", "ls"):
                _print_parts(parts, locations)
                continue
            if cmd in ("start", "reset", "seed"):
                _start_all_at(tracker, parts, locations, burst, START_ANTENNA)
                _print_parts(parts, locations)
                continue

            if cmd == "path":
                if len(bits) < 2:
                    print("  Usage: path <n|REF>")
                    continue
                part = _resolve_part(bits[1], parts)
                if part is None:
                    print(f"  Part not found: {bits[1]}")
                    continue
                seq = (4, 1, 2, 3)
                label = part.get("tag_label") or part["epc"]
                print(f"  Walking {label} through {list(seq)} …")
                for ant in seq:
                    _move(tracker, part, ant, locations, burst)
                    time.sleep(0.05)
                continue

            # Primary UX: "1 4" or "S17 1" or "move 1 4"
            if _try_move_command(bits, parts, tracker, locations, burst):
                continue

            print(f"  Unknown: {raw!r}  — try  1 4   or type help")
    finally:
        tracker.close()

    print("  Bye.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
