"""
Sewio RTLS — Live operator position viewer (WebSocket)

Connects directly to the Sewio server and prints operator X/Y positions
and zone enter/exit events as they arrive. Does not require api.py.

Usage:
    python rtls_viewer.py              # known operators (16 badges)
    python rtls_viewer.py --feed 35    # one badge only
    python rtls_viewer.py --all-tags   # every Sewio tag (noisy / stale)
    python rtls_viewer.py --health     # Sewio REST connectivity check

Requirements:
    pip install websockets httpx python-dotenv
"""

from __future__ import annotations

import argparse
import asyncio
import json
import ssl
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tracking"))

from dotenv import load_dotenv

load_dotenv(ROOT / ".env")

from config import (  # noqa: E402
    RTLS_TEST_FEED_ID,
    SEWIO_API_KEY,
    SEWIO_FEED_ID,
    SEWIO_REST_URL,
    SEWIO_VERIFY_SSL,
    SEWIO_WS_URL,
    STATION_NAME,
)
from rtls_lookup import operator_name, operator_names, station_for_zone, zone_label  # noqa: E402
from sewio_client import parse_position_message, parse_zone_message  # noqa: E402


def ts() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def divider(label: str = "") -> None:
    line = "=" * 50
    print(f"\n{line}")
    if label:
        print(f"  {label}")
        print(line)


# ── In-memory snapshot (latest position per tag) ─────────────────────────────

_positions: dict[int, dict] = {}
_zone_presence: dict[int, dict] = {}


# Ignore bulk /feeds/ snapshots older than this (seconds)
STALE_POSITION_SECS = 90


def _position_at_ts(at: str | None) -> float:
    """Parse Sewio position timestamp to epoch seconds (naive local)."""
    if not at:
        return 0.0
    raw = at.strip()
    for fmt in (
        "%Y-%m-%d %H:%M:%S.%f",
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%dT%H:%M:%S.%fZ",
        "%Y-%m-%dT%H:%M:%SZ",
    ):
        try:
            return datetime.strptime(raw, fmt).timestamp()
        except ValueError:
            continue
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return 0.0


def _test_feed_ids() -> set[int]:
    """Badge IDs always subscribed with priority (RTLS TEST + env overrides)."""
    ids: set[int] = set()
    for raw in (RTLS_TEST_FEED_ID, SEWIO_FEED_ID):
        if raw and str(raw).isdigit():
            ids.add(int(raw))
    for tid, name in operator_names().items():
        if "TEST" in name.upper() and str(tid).isdigit():
            ids.add(int(tid))
    return ids


def _operator_feed_ids() -> list[int]:
    ids = {int(k) for k in operator_names() if str(k).isdigit()}
    ids |= _test_feed_ids()
    test_first = sorted(_test_feed_ids())
    rest = sorted(ids - set(test_first))
    return test_first + rest


def _accept_position(tag_id: int, pos: dict) -> bool:
    """Drop stale bulk snapshots; keep only the newest update per tag."""
    new_ts = _position_at_ts(pos.get("at"))
    pos["_at_ts"] = new_ts
    is_test = tag_id in _test_feed_ids()

    if not is_test and new_ts > 0:
        age = datetime.now().timestamp() - new_ts
        if age > STALE_POSITION_SECS:
            return False

    prev = _positions.get(tag_id)
    if prev and new_ts > 0:
        prev_ts = prev.get("_at_ts") or _position_at_ts(prev.get("at"))
        if new_ts < prev_ts:
            return False

    return True


def _set_zone_presence(
    tag_id: int,
    zone_id: int,
    status: str,
    *,
    zone_name: str | None = None,
) -> None:
    _zone_presence[tag_id] = {
        "status": status,
        "zone_name": zone_name or zone_label(zone_id),
        "zone_id": zone_id,
    }


def _bootstrap_zones_from_rest(feed_filter: int | None) -> int:
    """Load current zone occupancy from Sewio REST (WebSocket only sends changes)."""
    import httpx

    try:
        resp = httpx.get(
            f"{SEWIO_REST_URL.rstrip('/')}/zones",
            headers={"X-ApiKey": SEWIO_API_KEY, "Accept": "application/json"},
            verify=SEWIO_VERIFY_SSL,
            timeout=10,
        )
        if resp.status_code != 200:
            return 0
        body = resp.json()
        zones = body if isinstance(body, list) else body.get("results", [])
    except Exception:
        return 0

    # tag_id -> (at, zone_id, zone_name) — keep most recent if listed in multiple zones
    latest: dict[int, tuple[str, int, str]] = {}
    for zone in zones:
        try:
            zid = int(zone["id"])
        except (TypeError, ValueError, KeyError):
            continue
        zname = zone.get("name") or zone_label(zid)
        for tag in zone.get("tags") or []:
            if tag.get("status") != "in":
                continue
            try:
                tid = int(tag["id"])
            except (TypeError, ValueError, KeyError):
                continue
            if feed_filter is not None and tid != feed_filter:
                continue
            at = str(tag.get("at") or "")
            if tid not in latest or at > latest[tid][0]:
                latest[tid] = (at, zid, zname)

    for tid, (_, zid, zname) in latest.items():
        _set_zone_presence(tid, zid, "in", zone_name=zname)

    return len(latest)


def _format_zone(tag_id: int) -> str:
    zp = _zone_presence.get(tag_id)
    if not zp:
        return "—"
    arrow = "IN" if zp.get("status") == "in" else "OUT"
    zname = zp.get("zone_name", "")
    station = station_for_zone(zp.get("zone_id", 0))
    if arrow == "IN" and station:
        return f"{arrow} {zname} -> {station}"
    return f"{arrow} {zname}"


def _print_snapshot() -> None:
    if not _positions:
        print("  (no positions yet — move a badge into range)")
        return

    print(f"  {'Operator':<22} {'Tag':>4}  {'X':>7}  {'Y':>7}  {'Clr':>5}  {'Anch':>4}  Zone")
    print(f"  {'-' * 22} {'-' * 4}  {'-' * 7}  {'-' * 7}  {'-' * 5}  {'-' * 4}  {'-' * 28}")
    for tag_id in sorted(_positions, key=lambda t: _positions[t].get("operator_name", "")):
        p = _positions[tag_id]
        zone = _format_zone(tag_id)
        clr = p.get("clr")
        clr_s = f"{clr:.2f}" if clr is not None else "  —"
        anchors = p.get("anchors")
        anc_s = str(anchors) if anchors is not None else "—"
        print(
            f"  {p.get('operator_name', ''):<22} {tag_id:>4}  "
            f"{p.get('x', 0):>7.2f}  {p.get('y', 0):>7.2f}  "
            f"{clr_s:>5}  {anc_s:>4}  {zone}"
        )


def _handle_position(
    pos: dict,
    feed_filter: int | None,
    *,
    tracked_ids: set[int] | None = None,
    verbose: bool = True,
) -> None:
    tag_id = pos["tag_id"]
    if feed_filter is not None and tag_id != feed_filter:
        return
    if tracked_ids is not None and tag_id not in tracked_ids:
        return

    if not _accept_position(tag_id, pos):
        return

    name = operator_name(tag_id)
    pos["operator_name"] = name
    _positions[tag_id] = pos

    if not verbose:
        return

    clr = pos.get("clr")
    clr_s = f"{clr:.2f}" if clr is not None else "—"
    anc = pos.get("anchors")
    anc_s = str(anc) if anc is not None else "—"
    zone_s = _format_zone(tag_id)
    print(
        f"[{ts()}] POSITION  {name} ({tag_id})  "
        f"x={pos['x']:.2f}  y={pos['y']:.2f}  clr={clr_s}  anchors={anc_s}  "
        f"zone={zone_s}",
        flush=True,
    )


def _handle_zone(
    zone: dict,
    feed_filter: int | None,
    *,
    tracked_ids: set[int] | None = None,
) -> None:
    tag_id = zone["tag_id"]
    if feed_filter is not None and tag_id != feed_filter:
        return
    if tracked_ids is not None and tag_id not in tracked_ids:
        return

    name = operator_name(tag_id)
    zid = zone["zone_id"]
    zname = zone_label(zid)
    station = station_for_zone(zid)
    status = zone["status"].upper()

    _set_zone_presence(tag_id, zid, zone["status"], zone_name=zname)

    station_note = f"  -> {station}" if station else ""
    print(
        f"[{ts()}] ZONE      {name} ({tag_id})  {status}  {zname}{station_note}",
        flush=True,
    )


async def _summary_loop(interval: float) -> None:
    while True:
        await asyncio.sleep(interval)
        divider(f"LIVE SNAPSHOT  ({len(_positions)} tags)  station={STATION_NAME}")
        _print_snapshot()
        print(flush=True)


async def _run_viewer(
    feed_filter: int | None,
    summary_secs: float,
    *,
    all_tags: bool = False,
    verbose: bool = True,
) -> None:
    import websockets

    if not SEWIO_API_KEY:
        print("ERROR: SEWIO_API_KEY not set in .env")
        raise SystemExit(1)

    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE

    if feed_filter is not None:
        feed_ids = [feed_filter]
        mode = f"tag {feed_filter} ({operator_name(feed_filter)})"
    elif all_tags:
        feed_ids = None
        mode = "all Sewio tags (may include stale snapshots)"
    else:
        feed_ids = _operator_feed_ids()
        mode = f"{len(feed_ids)} known operators"

    tracked_ids = set(feed_ids) if feed_ids else None

    divider("LIVE RTLS POSITIONS")
    print(f"\n  WebSocket : {SEWIO_WS_URL}")
    if feed_ids:
        print(f"  Subscribe : {len(feed_ids)} operator feed(s) + /zones/")
        test_ids = sorted(_test_feed_ids() & set(feed_ids))
        if test_ids:
            labels = ", ".join(f"{operator_name(t)} ({t})" for t in test_ids)
            print(f"  Test      : {labels}")
    else:
        print(f"  Subscribe : /feeds/ + /zones/")
    print(f"  Mode      : {mode}")
    print(f"  Station   : {STATION_NAME}")

    zone_filter = feed_filter  # zone bootstrap respects single-tag mode only
    loaded = _bootstrap_zones_from_rest(zone_filter)
    if loaded:
        print(f"  Zones     : loaded current occupancy for {loaded} tag(s) via REST")
    else:
        print(f"  Zones     : REST bootstrap unavailable — zones appear on enter/exit only")

    print(f"\n  Waiting for position updates ...  (Ctrl+C to stop)\n", flush=True)

    summary_task = asyncio.create_task(_summary_loop(summary_secs))

    async def _subscribe(ws) -> None:
        if feed_ids:
            for fid in feed_ids:
                await ws.send(json.dumps({
                    "headers": {"X-ApiKey": SEWIO_API_KEY},
                    "method": "subscribe",
                    "resource": f"/feeds/{fid}",
                }))
        else:
            await ws.send(json.dumps({
                "headers": {"X-ApiKey": SEWIO_API_KEY},
                "method": "subscribe",
                "resource": "/feeds/",
            }))
        await ws.send(json.dumps({
            "headers": {"X-ApiKey": SEWIO_API_KEY},
            "method": "subscribe",
            "resource": "/zones/",
        }))

    backoff = 2.0
    try:
        while True:
            try:
                async with websockets.connect(
                    SEWIO_WS_URL, ssl=ctx, ping_interval=30
                ) as ws:
                    backoff = 2.0
                    await _subscribe(ws)
                    print(f"[{ts()}] CONNECTED\n", flush=True)

                    reloaded = _bootstrap_zones_from_rest(zone_filter)
                    if reloaded:
                        print(
                            f"[{ts()}] BOOTSTRAP  refreshed zone state for {reloaded} tag(s)\n",
                            flush=True,
                        )

                    async for raw in ws:
                        try:
                            msg = json.loads(raw)
                        except json.JSONDecodeError:
                            continue

                        pos = parse_position_message(msg)
                        if pos:
                            _handle_position(
                                pos, feed_filter,
                                tracked_ids=tracked_ids, verbose=verbose,
                            )
                            continue

                        zone = parse_zone_message(msg)
                        if zone:
                            _handle_zone(zone, feed_filter, tracked_ids=tracked_ids)

            except asyncio.CancelledError:
                raise
            except Exception as exc:
                print(f"[{ts()}] DISCONNECTED — {exc}  (retry in {backoff:.0f}s)", flush=True)
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, 60.0)
    finally:
        summary_task.cancel()
        try:
            await summary_task
        except asyncio.CancelledError:
            pass


def run_health_check() -> int:
    import httpx

    divider("Sewio RTLS Health Check")
    print(f"\n  REST URL  : {SEWIO_REST_URL}")
    print(f"  API key   : {'set' if SEWIO_API_KEY else 'MISSING'}\n")

    if not SEWIO_API_KEY:
        print("  FAIL — SEWIO_API_KEY not set in .env")
        return 2

    try:
        resp = httpx.get(
            f"{SEWIO_REST_URL.rstrip('/')}/feeds",
            headers={"X-ApiKey": SEWIO_API_KEY, "Accept": "application/json"},
            verify=SEWIO_VERIFY_SSL,
            timeout=10,
        )
        body = resp.json() if resp.headers.get("content-type", "").startswith("application/json") else {}
        tags = [f for f in body.get("results", []) if f.get("type") == "tag"]
    except Exception as exc:
        print(f"  FAIL — {exc}")
        print("  (Factory LAN required — 10.25.80.13 is not reachable off-site)")
        return 2

    if resp.status_code != 200:
        print(f"  FAIL — HTTP {resp.status_code}")
        return 1

    print(f"  OK — {len(tags)} tags on Sewio REST")
    if tags:
        t = tags[0]
        ds = {d["id"]: d.get("current_value") for d in t.get("datastreams", [])}
        tid = t.get("id")
        print(f"  Sample    : tag {tid}  x={ds.get('posX')}  y={ds.get('posY')}")
    print()
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Live Sewio RTLS operator positions")
    parser.add_argument(
        "--feed", type=int, default=None,
        help="Only show this badge/tag ID (e.g. 35 for RTLS TEST)",
    )
    parser.add_argument(
        "--summary", type=float, default=15.0,
        help="Print position table every N seconds (default: 15, 0=off)",
    )
    parser.add_argument(
        "--all-tags", action="store_true",
        help="Subscribe to all Sewio feeds (noisy; may include stale positions)",
    )
    parser.add_argument(
        "--quiet", action="store_true",
        help="Only print periodic snapshot table, not every position line",
    )
    parser.add_argument("--health", action="store_true", help="REST connectivity check only")
    args = parser.parse_args()

    try:
        sys.stdout.reconfigure(line_buffering=True)
    except (AttributeError, ValueError):
        pass

    if args.health:
        return run_health_check()

    summary_secs = args.summary if args.summary > 0 else 999999.0
    try:
        asyncio.run(_run_viewer(
            args.feed,
            summary_secs,
            all_tags=args.all_tags,
            verbose=not args.quiet,
        ))
    except KeyboardInterrupt:
        divider(f"FINAL SNAPSHOT  ({len(_positions)} tags)")
        _print_snapshot()
        print("\n  Stopped.\n", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
