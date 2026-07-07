"""
Sewio RTLS WebSocket client — live tag positions and zone events.
"""

from __future__ import annotations

import asyncio
import json
import logging
import ssl
import sys
import threading
from pathlib import Path
from typing import Callable, Optional

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from config import (
    ENABLE_LIVE_INGESTION,
    SEWIO_API_KEY,
    SEWIO_FEED_ID,
    SEWIO_VERIFY_SSL,
    SEWIO_WS_URL,
)
from rtls_storage import record_position, record_zone_event, set_connected

log = logging.getLogger("sewio")

_backoff = 2.0
_backoff_max = 60.0
_thread: Optional[threading.Thread] = None


def parse_position_message(msg: dict) -> dict | None:
    resource = msg.get("resource", "")
    if not resource.startswith("/feeds"):
        return None

    body = msg.get("body") or {}
    try:
        tag_id = int(body.get("id") or resource.split("/")[-1])
    except (TypeError, ValueError):
        return None

    streams = {ds["id"]: ds for ds in body.get("datastreams", [])}
    pos_x = streams.get("posX")
    pos_y = streams.get("posY")
    if not pos_x or not pos_y:
        return None

    try:
        return {
            "tag_id": tag_id,
            "x": float(str(pos_x["current_value"]).strip()),
            "y": float(str(pos_y["current_value"]).strip()),
            "z": float(str(streams["posZ"]["current_value"]).strip()) if "posZ" in streams else None,
            "at": pos_x.get("at"),
            "clr": float(streams["clr"]["current_value"]) if "clr" in streams else None,
            "anchors": int(streams["numberOfAnchors"]["current_value"]) if "numberOfAnchors" in streams else None,
        }
    except (TypeError, ValueError, KeyError):
        return None


def parse_zone_message(msg: dict) -> dict | None:
    resource = msg.get("resource", "")
    if not resource.startswith("/zones"):
        return None

    body = msg.get("body") or {}
    try:
        return {
            "tag_id": int(body["feed_id"]),
            "zone_id": int(body["zone_id"]),
            "status": body["status"],
            "at": body.get("at"),
            "duration": float(body["duration"]) if body.get("duration") is not None else None,
        }
    except (TypeError, ValueError, KeyError):
        return None


def _ssl_context() -> ssl.SSLContext | None:
    if SEWIO_VERIFY_SSL:
        return ssl.create_default_context()
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    return ctx


async def _subscribe(ws) -> None:
    feeds_resource = f"/feeds/{SEWIO_FEED_ID}" if SEWIO_FEED_ID else "/feeds/"
    for resource in (feeds_resource, "/zones/"):
        await ws.send(json.dumps({
            "headers": {"X-ApiKey": SEWIO_API_KEY},
            "method": "subscribe",
            "resource": resource,
        }))
        log.info("subscribed %s", resource)


async def _handle_message(raw: str, on_log: Callable[[str], None] | None) -> None:
    try:
        msg = json.loads(raw)
    except json.JSONDecodeError:
        return

    pos = parse_position_message(msg)
    if pos:
        record_position(**pos)
        if on_log:
            on_log(
                f"POSITION  {pos['tag_id']}: x={pos['x']:.2f}, y={pos['y']:.2f}"
            )
        return

    zone = parse_zone_message(msg)
    if zone:
        summary = record_zone_event(**zone)
        if on_log:
            on_log(
                f"ZONE  {summary['operator_name']} ({summary['tag_id']}) "
                f"{summary['status']} {summary['zone_name']} "
                f"[assigned={summary['assigned_sessions']}]"
            )


async def _run_loop(on_log: Callable[[str], None] | None) -> None:
    global _backoff
    import websockets

    if not SEWIO_API_KEY:
        log.error("SEWIO_API_KEY not set — RTLS client disabled")
        return

    ssl_ctx = _ssl_context()
    url = SEWIO_WS_URL

    while True:
        try:
            async with websockets.connect(url, ssl=ssl_ctx, ping_interval=30) as ws:
                set_connected(True)
                _backoff = 2.0
                log.info("connected to %s", url)
                await _subscribe(ws)

                async for raw in ws:
                    await _handle_message(raw, on_log)

        except asyncio.CancelledError:
            set_connected(False)
            raise
        except Exception as exc:
            set_connected(False)
            log.warning("disconnected: %s — retry in %.0fs", exc, _backoff)
            if on_log:
                on_log(f"RTLS reconnect in {_backoff:.0f}s: {exc}")
            await asyncio.sleep(_backoff)
            _backoff = min(_backoff * 2, _backoff_max)


def _thread_main(on_log: Callable[[str], None] | None) -> None:
    asyncio.run(_run_loop(on_log))


def start(on_log: Callable[[str], None] | None = None) -> bool:
    """Start the Sewio client in a daemon thread. Returns False if disabled."""
    global _thread

    if not ENABLE_LIVE_INGESTION:
        log.info("ENABLE_LIVE_INGESTION=false — Sewio client not started")
        return False

    if _thread and _thread.is_alive():
        return True

    _thread = threading.Thread(
        target=_thread_main,
        args=(on_log,),
        daemon=True,
        name="sewio-rtls",
    )
    _thread.start()
    return True


def is_running() -> bool:
    return _thread is not None and _thread.is_alive()
