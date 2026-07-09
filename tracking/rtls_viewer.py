"""
Sewio RTLS — Live operator position viewer (WebSocket)

Uses the same live state module as the dashboard API (rtls_live.py).

Usage:
    python rtls_viewer.py              # known operators (16 badges)
    python rtls_viewer.py --feed 35    # one badge only
    python rtls_viewer.py --all-tags   # every Sewio tag (noisy / stale)
    python rtls_viewer.py --health     # Sewio REST connectivity check
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
    SEWIO_API_KEY,
    SEWIO_FEED_ID,
    SEWIO_REST_URL,
    SEWIO_VERIFY_SSL,
    SEWIO_WS_URL,
    STATION_NAME,
)
import rtls_live  # noqa: E402
from rtls_lookup import operator_name, operator_names  # noqa: E402
from sewio_client import parse_position_message, parse_zone_message  # noqa: E402


def ts() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def divider(label: str = "") -> None:
    line = "=" * 50
    print(f"\n{line}")
    if label:
        print(f"  {label}")
        print(line)


def _print_snapshot() -> None:
    snap = rtls_live.get_snapshot()
    positions = {p["tag_id"]: p for p in snap["positions"]}

    if not positions:
        print("  (no positions yet — move a badge into range)")
        return

    print(f"  {'Operator':<22} {'Tag':>4}  {'X':>7}  {'Y':>7}  {'Clr':>5}  {'Anch':>4}  Zone")
    print(f"  {'-' * 22} {'-' * 4}  {'-' * 7}  {'-' * 7}  {'-' * 5}  {'-' * 4}  {'-' * 28}")
    for tag_id in sorted(positions, key=lambda t: positions[t].get("operator_name", "")):
        p = positions[tag_id]
        zone = rtls_live.format_zone(tag_id)
        clr = p.get("clr")
        clr_s = f"{clr:.2f}" if clr is not None else "  —"
        anchors = p.get("anchors")
        anc_s = str(anchors) if anchors is not None else "—"
        print(
            f"  {p.get('operator_name', ''):<22} {tag_id:>4}  "
            f"{p.get('x', 0):>7.2f}  {p.get('y', 0):>7.2f}  "
            f"{clr_s:>5}  {anc_s:>4}  {zone}"
        )


async def _summary_loop(interval: float) -> None:
    while True:
        await asyncio.sleep(interval)
        snap = rtls_live.get_snapshot()
        divider(f"LIVE SNAPSHOT  ({len(snap['positions'])} tags)  station={STATION_NAME}")
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
        feed_ids = rtls_live.operator_feed_ids()
        mode = f"{len(feed_ids)} known operators"

    tracked_ids = set(feed_ids) if feed_ids else None

    divider("LIVE RTLS POSITIONS")
    print(f"\n  WebSocket : {SEWIO_WS_URL}")
    if feed_ids:
        print(f"  Subscribe : {len(feed_ids)} operator feed(s) + /zones/")
        test_ids = sorted(rtls_live.test_feed_ids() & set(feed_ids))
        if test_ids:
            labels = ", ".join(f"{operator_name(t)} ({t})" for t in test_ids)
            print(f"  Test      : {labels}")
    else:
        print(f"  Subscribe : /feeds/ + /zones/")
    print(f"  Mode      : {mode}")
    print(f"  Station   : {STATION_NAME}")

    zone_filter = feed_filter
    loaded = rtls_live.bootstrap_zones_from_rest(zone_filter)
    if loaded:
        print(f"  Zones     : loaded current occupancy for {loaded} tag(s) via REST")
    else:
        print(f"  Zones     : REST bootstrap unavailable — zones appear on enter/exit only")

    print(f"\n  Waiting for position updates ...  (Ctrl+C to stop)\n", flush=True)

    summary_task = asyncio.create_task(_summary_loop(summary_secs))
    last_zone_refresh = asyncio.get_event_loop().time()

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

                    reloaded = rtls_live.bootstrap_zones_from_rest(zone_filter)
                    if reloaded:
                        print(
                            f"[{ts()}] BOOTSTRAP  refreshed zone state for {reloaded} tag(s)\n",
                            flush=True,
                        )
                    last_zone_refresh = asyncio.get_event_loop().time()

                    async for raw in ws:
                        now = asyncio.get_event_loop().time()
                        if now - last_zone_refresh >= rtls_live.ZONE_REFRESH_SECS:
                            refreshed = rtls_live.bootstrap_zones_from_rest(zone_filter)
                            last_zone_refresh = now
                            if refreshed and verbose:
                                print(
                                    f"[{ts()}] REFRESH  zone state for {refreshed} tag(s)",
                                    flush=True,
                                )

                        try:
                            msg = json.loads(raw)
                        except json.JSONDecodeError:
                            continue

                        pos = parse_position_message(msg)
                        if pos:
                            tag_id = pos["tag_id"]
                            if feed_filter is not None and tag_id != feed_filter:
                                continue
                            if tracked_ids is not None and tag_id not in tracked_ids:
                                continue
                            recorded = rtls_live.record_position(**pos)
                            if not recorded or not verbose:
                                continue
                            clr = pos.get("clr")
                            clr_s = f"{clr:.2f}" if clr is not None else "—"
                            anc = pos.get("anchors")
                            anc_s = str(anc) if anc is not None else "—"
                            print(
                                f"[{ts()}] POSITION  {operator_name(tag_id)} ({tag_id})  "
                                f"x={pos['x']:.2f}  y={pos['y']:.2f}  clr={clr_s}  "
                                f"anchors={anc_s}  zone={rtls_live.format_zone(tag_id)}",
                                flush=True,
                            )
                            continue

                        zone = parse_zone_message(msg)
                        if zone:
                            tag_id = zone["tag_id"]
                            if feed_filter is not None and tag_id != feed_filter:
                                continue
                            if tracked_ids is not None and tag_id not in tracked_ids:
                                continue
                            entry = rtls_live.record_zone_event(**zone)
                            station = entry.get("station_name")
                            station_note = f"  -> {station}" if station else ""
                            print(
                                f"[{ts()}] ZONE      {operator_name(tag_id)} ({tag_id})  "
                                f"{zone['status'].upper()}  {entry['zone_name']}{station_note}",
                                flush=True,
                            )

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
        snap = rtls_live.get_snapshot()
        divider(f"FINAL SNAPSHOT  ({len(snap['positions'])} tags)")
        _print_snapshot()
        print("\n  Stopped.\n", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
