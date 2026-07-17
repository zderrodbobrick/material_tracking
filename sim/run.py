"""
Offline RFID line simulator — no Zebra reader, no HTTP listener required.

Loads parts from the ingested work_order_components table (or .R41/),
injects fake antenna reads into SQLite, and pings the API so the dashboard
updates live.

Usage (from repo root):
    python sim/run.py
    python sim/run.py --ibus IBUS462064 --auto          # 34-part WO, ~60s pipeline
    python sim/run.py --ibus IBUS462064 --auto --duration 90

On start, clears RFID session history (keeps work orders / BOM) so the
dashboard shows a clean run. Pass --no-clear to keep prior history.

The sim calls the same DwellTracker.ingest_batch() as the Zebra listener —
only the antenna reads are fake. Dashboard/API/DB behavior matches production.

Move syntax (pick one):
    1 4                 part #1 -> antenna 4
    S17 1               REF S17 -> antenna 1
    move 1 3            same as above
    move end            all parts -> Insert (100% complete)
    auto [seconds]      pipeline all parts through the line

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
sys.path.insert(0, str(ROOT / "sim"))

from config import (  # noqa: E402
    ANTENNA_CATALOG,
    DB_PATH,
    MIN_READS_FOR_SESSION,
    RTLS_OPERATOR_CONFIRM_SECS,
    SIM_OPERATOR_MAX_DWELL_SEC,
    SIM_OPERATOR_MIN_DWELL_SEC,
)
from operator_move import start_operator_movement, stop_operator_movement  # noqa: E402
from r41.parse_r41 import list_r41_files, parse_r41_file  # noqa: E402
from storage import DwellTracker  # noqa: E402

DEFAULT_RSSI = -45
START_ANTENNA = 7  # Tennoner Entry
END_ANTENNA = 3    # Insert Station (= 100% / complete)
# Real RFID spine after Tennoner entrance (same ports the listener uses).
AUTO_PATH = (4, 6, 1, 2, 3)  # table → LBD → Gannomat → exit → Insert
NOTIFY = {"url": "http://127.0.0.1:5001/api/notify"}

# Tracking tables wiped on sim start (work orders / BOM / stations kept).
_TRACKING_CLEAR_TABLES = (
    "part_operator_assignments",
    "session_operator_presence",
    "operator_zone_visits",
    "operator_current_zone",
    "operator_station_presence",
    "part_station_sessions",
    "part_station_events",
    "rfid_raw_reads",
)


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


def _api_base_url() -> str:
    url = NOTIFY["url"].rstrip("/")
    if url.endswith("/api/notify"):
        return url[: -len("/api/notify")]
    return url.rsplit("/api/", 1)[0] if "/api/" in url else url


def _seed_demo_operators() -> int:
    """POST /api/rtls/demo — one test operator at each production station."""
    url = NOTIFY["url"].rstrip("/")
    if url.endswith("/api/notify"):
        url = url[: -len("/api/notify")] + "/api/rtls/demo"
    else:
        url = url.rstrip("/") + "/api/rtls/demo"
    try:
        req = urllib.request.Request(
            url,
            data=b"{}",
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=3) as resp:
            body = json.loads(resp.read().decode("utf-8") or "{}")
            if isinstance(body.get("count"), int):
                return body["count"]
            seeded = body.get("zone_presence") or body.get("seeded") or []
            return len(seeded) if isinstance(seeded, list) else 0
    except (urllib.error.URLError, TimeoutError, OSError, ValueError, json.JSONDecodeError):
        return -1


def _clear_tracking_db() -> dict[str, int]:
    """Wipe RFID session history so the dashboard starts from a clean slate.

    Keeps work_orders, BOM components, stations, readers, and antenna layout.
    """
    import sqlite3

    cleared: dict[str, int] = {}
    conn = sqlite3.connect(str(DB_PATH))
    try:
        conn.execute("PRAGMA foreign_keys = OFF")
        existing = {
            r[0]
            for r in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            ).fetchall()
        }
        for table in _TRACKING_CLEAR_TABLES:
            if table not in existing:
                continue
            before = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
            conn.execute(f"DELETE FROM {table}")
            cleared[table] = before
        conn.commit()
    finally:
        conn.close()
    return cleared


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


def _load_parts(
    path: Path | None,
    *,
    ibus: str | None = None,
) -> tuple[list[dict], dict]:
    """Load parts from DB work_order_components when present, else parse .R41."""
    try:
        import sqlite3
        from config import DB_PATH
        conn = sqlite3.connect(str(DB_PATH))
        conn.row_factory = sqlite3.Row
        try:
            wo = None
            if ibus:
                key = ibus.strip().upper()
                if not key.startswith("IBUS"):
                    key = f"IBUS{key}"
                wo = conn.execute(
                    "SELECT * FROM work_orders WHERE UPPER(ibus_number) = ? "
                    "OR work_order = ?",
                    (key, key.replace("IBUS", "")),
                ).fetchone()
                if wo is None:
                    raise SystemExit(f"Work order not found in DB: {key}")
            if path and path.is_file() and wo is None:
                order_preview = parse_r41_file(path)
                ibus_key = order_preview.get("ibus") or ""
                if ibus_key:
                    wo = conn.execute(
                        "SELECT * FROM work_orders WHERE ibus_number = ?", (ibus_key,)
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
    print("  |             move end    every part -> Insert (complete)|")
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
    print(f"  Resetting {len(parts)} parts to [{antenna}] {where} …")
    print("  (Brings completed orders back to the start for retesting)")
    print("  Closing open sessions so dwell timers restart …")
    placed = 0
    for p in parts:
        # Drop any open dwell/presence so the next entry starts a fresh timer
        tracker.close_open_sessions_for_epc(p["epc"])
        _move(tracker, p, antenna, locations, burst, quiet=True, notify=False)
        if locations.get(p["epc"]) == antenna:
            placed += 1
    live = _notify_dashboard("sim_start")
    dash = "dashboard updated" if live else "dashboard offline"
    print(f"  Done — {placed}/{len(parts)} at [{antenna}] with fresh dwell. ({dash})")
    print(f"  Move with:  <part#> <antenna#>   e.g.  1 4")
    print()


def _finish_all(
    tracker: DwellTracker,
    parts: list[dict],
    locations: dict[str, int],
    burst: int,
) -> None:
    """Send every part to Insert Station so the order hits 100% and completes."""
    where = ANT_SHORT.get(END_ANTENNA) or ANTENNA_CATALOG[END_ANTENNA][0]
    print(f"  Finishing order — moving {len(parts)} parts to [{END_ANTENNA}] {where} …")
    for p in parts:
        _move(tracker, p, END_ANTENNA, locations, burst, quiet=True, notify=False)
    # Safety net if the last Insert open didn't already close the order
    if parts:
        tracker.try_complete_ibus_order(parts[0]["epc"])
    live = _notify_dashboard("sim_finish")
    dash = "dashboard live" if live else "dashboard offline"
    print(f"  Done — all parts at Insert (100%). Order should be Completed. ({dash})")
    print()


def _auto_run(
    tracker: DwellTracker,
    parts: list[dict],
    locations: dict[str, int],
    burst: int,
    *,
    duration_sec: float = 60.0,
    path: tuple[int, ...] = AUTO_PATH,
) -> None:
    """Pipeline all parts through the real antenna spine in ~duration_sec.

    Uses the same DwellTracker.ingest_batch path as the Zebra listener — only
    the read timestamps/RSSI are synthetic.
    """
    if not parts:
        print("  No parts to auto-run.")
        return

    n = len(parts)
    hops = len(path)
    # Stagger starts (~35% of budget) + dwell per station (~65%).
    release_gap = max(0.12, (duration_sec * 0.35) / max(n - 1, 1))
    step_dwell = max(0.35, (duration_sec * 0.65) / max(hops, 1))
    eta = (n - 1) * release_gap + hops * step_dwell

    path_labels = " → ".join(
        f"{a}:{ANT_SHORT.get(a, ANTENNA_CATALOG.get(a, ('?',))[0])}" for a in path
    )
    print(f"  AUTO RUN  {n} parts  |  target ~{duration_sec:.0f}s (eta {eta:.0f}s)")
    print(f"  Path: [{START_ANTENNA}] entrance → {path_labels}")
    print(f"  Release gap {release_gap:.2f}s  |  dwell/station {step_dwell:.2f}s")
    print("  (Same ingest_batch logic as the live listener)")
    print()

    _start_all_at(tracker, parts, locations, burst, START_ANTENNA)

    # Schedule every hop for every part, then play in time order.
    events: list[tuple[float, int, int]] = []
    for i in range(n):
        t0 = i * release_gap
        for h, ant in enumerate(path):
            events.append((t0 + h * step_dwell, i, ant))
    events.sort(key=lambda e: e[0])

    t_wall = time.monotonic()
    last_notify = 0.0
    done_moves = 0
    total_moves = len(events)

    try:
        for t_abs, idx, ant in events:
            wait = (t_wall + t_abs) - time.monotonic()
            if wait > 0:
                time.sleep(wait)
            part = parts[idx]
            # Notify the dashboard every ~0.75s so the UI stays live without flooding.
            now = time.monotonic()
            should_notify = (now - last_notify) >= 0.75 or done_moves + 1 == total_moves
            _move(
                tracker, part, ant, locations, burst,
                quiet=True, notify=should_notify,
            )
            if should_notify:
                last_notify = now
            done_moves += 1
            label = part.get("tag_label") or part["epc"]
            where = ANT_SHORT.get(ant) or ant
            elapsed = time.monotonic() - t_wall
            print(
                f"  [{elapsed:5.1f}s] {done_moves}/{total_moves}  "
                f"{label} → [{ant}] {where}",
                flush=True,
            )
    except KeyboardInterrupt:
        print("\n  AUTO interrupted — finishing remaining parts at Insert …")
        _finish_all(tracker, parts, locations, burst)
        return

    if parts:
        tracker.try_complete_ibus_order(parts[0]["epc"])
    _notify_dashboard("sim_auto_done")
    elapsed = time.monotonic() - t_wall
    print()
    print(f"  AUTO complete in {elapsed:.1f}s — order should be Completed IBUS.")
    print()


def _print_help() -> None:
    print(
        f"""
  Commands
  --------
  <part> <ant>             Move part to antenna  (e.g. 1 4  or  S17 1)
  move all <ant>           Move every part  (e.g.  move all 7  or  all 7)
  move end / end / finish  Move every part to Insert → 100% complete
  auto [seconds]           Pipeline all parts through the line (~60s default)
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
        "--ibus",
        default=None,
        help="Work order to load (e.g. IBUS462064 or 462064)",
    )
    parser.add_argument(
        "--auto",
        action="store_true",
        help="Pipeline all parts through the line then exit",
    )
    parser.add_argument(
        "--duration",
        type=float,
        default=60.0,
        help="Auto-run length in seconds (default 60)",
    )
    parser.add_argument(
        "--no-start",
        action="store_true",
        help="Do not auto-place all parts at Tennoner entrance",
    )
    parser.add_argument(
        "--no-clear",
        action="store_true",
        help="Keep existing session history (default: clear tracking tables on start)",
    )
    parser.add_argument(
        "--no-operator-move",
        action="store_true",
        help="Disable random operator movement between stations",
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
    # Default auto runs to the 34-part order when --ibus omitted.
    ibus = args.ibus
    if args.auto and not ibus and not target:
        ibus = "IBUS462064"
    parts, order = _load_parts(target, ibus=ibus)
    locations: dict[str, int] = {}

    print("=" * 72)
    print(f"  OFFLINE RFID SIM  -  {order.get('ibus') or order.get('work_order')}")
    print(f"  {len(parts)} parts  |  live ping -> {NOTIFY['url']}")
    print("=" * 72)

    if not args.no_clear:
        cleared = _clear_tracking_db()
        total = sum(cleared.values())
        print(f"  Cleared tracking DB ({total} rows) — clean slate for this run")
        for table, n in cleared.items():
            if n:
                print(f"    {table}: {n}")
        _notify_dashboard("sim_clear")

    tracker = DwellTracker()
    operator_mover_started = False
    try:
        n_ops = _seed_demo_operators()
        if n_ops > 0:
            print(f"  Demo operators: {n_ops} loaded (one per station)")
        elif n_ops < 0:
            print("  Demo operators: skipped (API offline — start api.py first)")
        else:
            print("  Demo operators: none seeded")

        if not args.no_operator_move:
            n_moving = start_operator_movement(
                notify=lambda: _notify_dashboard("rtls_zone_refresh"),
                api_base=_api_base_url(),
            )
            operator_mover_started = n_moving > 0
            if operator_mover_started:
                print(
                    f"  Operator movement: {n_moving} badges roaming "
                    f"({SIM_OPERATOR_MIN_DWELL_SEC:.0f}–{SIM_OPERATOR_MAX_DWELL_SEC:.0f}s dwell)"
                )

        _print_antenna_map()

        if args.auto:
            # Keep demo operators at their seeded stations during the batch run —
            # otherwise the first machine (Tennoner) hogs all assignments.
            if operator_mover_started:
                stop_operator_movement()
                operator_mover_started = False
                print("  Operator movement paused for auto pipeline (fair per-station credit)")
            _auto_run(
                tracker, parts, locations, burst,
                duration_sec=max(5.0, args.duration),
            )
            _print_parts(parts, locations)
            if operator_mover_started:
                print()
                print("  Auto pipeline done — operators still roaming (Ctrl+C to stop)")
                try:
                    while True:
                        time.sleep(1)
                except KeyboardInterrupt:
                    print()
            return 0

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
            if cmd in ("end", "finish") or (
                cmd in ("m", "move", "go")
                and len(bits) >= 2
                and bits[1].lower() in ("end", "finish", "complete", "done")
            ):
                _finish_all(tracker, parts, locations, burst)
                _print_parts(parts, locations)
                continue
            if cmd == "auto":
                dur = args.duration
                if len(bits) >= 2:
                    try:
                        dur = float(bits[1])
                    except ValueError:
                        print("  Usage: auto [seconds]   e.g. auto 60")
                        continue
                _auto_run(
                    tracker, parts, locations, burst,
                    duration_sec=max(5.0, dur),
                )
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
        if operator_mover_started:
            stop_operator_movement()
        tracker.close()

    print("  Bye.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
