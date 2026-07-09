"""
Shared in-memory Sewio RTLS live state.

Uses the same rules as rtls_viewer.py: REST zone bootstrap on connect,
WebSocket position/zone updates, stale position filtering, and
station resolution via zoneMappings.json.
"""

from __future__ import annotations

import threading
import time
from datetime import datetime
from typing import Callable, Optional

from config import RTLS_TEST_FEED_ID, SEWIO_FEED_ID
from rtls_lookup import operator_name, operator_names, station_for_zone, zone_label

_lock = threading.Lock()
_positions: dict[int, dict] = {}
_zone_presence: dict[int, dict] = {}
_last_message_at: str | None = None
_connected = False

STALE_POSITION_SECS = 90
ZONE_REFRESH_SECS = 30

_on_change: Optional[Callable[..., None]] = None


def set_change_callback(fn: Callable[..., None] | None) -> None:
    global _on_change
    _on_change = fn


def _notify(action: str, **extra) -> None:
    if _on_change:
        try:
            _on_change(action, **extra)
        except TypeError:
            try:
                _on_change(action)
            except Exception:
                pass
        except Exception:
            pass


def test_feed_ids() -> set[int]:
    ids: set[int] = set()
    for raw in (RTLS_TEST_FEED_ID, SEWIO_FEED_ID):
        if raw and str(raw).isdigit():
            ids.add(int(raw))
    for tid, name in operator_names().items():
        if "TEST" in name.upper() and str(tid).isdigit():
            ids.add(int(tid))
    return ids


def known_tag_ids() -> set[int]:
    ids = {int(k) for k in operator_names() if str(k).isdigit()}
    ids |= test_feed_ids()
    return ids


def operator_feed_ids() -> list[int]:
    ids = known_tag_ids()
    test_first = sorted(test_feed_ids() & ids)
    return test_first + sorted(ids - set(test_first))


def position_at_ts(at: str | None) -> float:
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


def accept_position(tag_id: int, at: str | None) -> bool:
    """Drop stale bulk snapshots; keep only the newest update per tag."""
    new_ts = position_at_ts(at)
    is_test = tag_id in test_feed_ids()

    if not is_test and new_ts > 0:
        age = time.time() - new_ts
        if age > STALE_POSITION_SECS:
            return False

    with _lock:
        prev = _positions.get(tag_id)
    if prev and new_ts > 0:
        prev_ts = prev.get("_at_ts") or position_at_ts(prev.get("at"))
        if new_ts < prev_ts:
            return False

    return True


def _zone_entry(
    tag_id: int,
    zone_id: int,
    status: str,
    *,
    zone_name: str | None = None,
    at: str | None = None,
    duration: float | None = None,
) -> dict:
    zname = zone_name or zone_label(zone_id)
    station = station_for_zone(zone_id)
    return {
        "tag_id": tag_id,
        "operator_name": operator_name(tag_id),
        "zone_id": zone_id,
        "zone_name": zname,
        "status": status,
        "station_name": station,
        "at": at,
        "duration": duration,
    }


def format_zone(tag_id: int) -> str:
    with _lock:
        zp = _zone_presence.get(tag_id)
    if not zp:
        return "—"
    arrow = "IN" if zp.get("status") == "in" else "OUT"
    zname = zp.get("zone_name", "")
    station = zp.get("station_name") or station_for_zone(zp.get("zone_id", 0))
    if arrow == "IN" and station:
        return f"{arrow} {zname} -> {station}"
    return f"{arrow} {zname}"


def bootstrap_zones_from_rest(tag_filter: int | None = None) -> int:
    """Load current zone occupancy from Sewio REST (replaces in-memory zone state)."""
    import httpx
    from config import SEWIO_API_KEY, SEWIO_REST_URL, SEWIO_VERIFY_SSL

    if not SEWIO_API_KEY:
        return 0
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

    tracked = known_tag_ids()
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
            if tag_filter is not None and tid != tag_filter:
                continue
            if tid not in tracked:
                continue
            at = str(tag.get("at") or "")
            if tid not in latest or at > latest[tid][0]:
                latest[tid] = (at, zid, zname)

    new_presence: dict[int, dict] = {}
    for tid, (at, zid, zname) in latest.items():
        new_presence[tid] = _zone_entry(tid, zid, "in", zone_name=zname, at=at or None)

    with _lock:
        global _last_message_at
        _zone_presence.clear()
        _zone_presence.update(new_presence)
        if new_presence:
            _last_message_at = datetime.now().astimezone().isoformat()

    if new_presence:
        _notify("rtls_zone_refresh")
    return len(new_presence)


def record_position(
    tag_id: int,
    x: float,
    y: float,
    at: str | None,
    **extra,
) -> dict | None:
    if not accept_position(tag_id, at):
        return None

    new_ts = position_at_ts(at)
    pos = {
        "tag_id": tag_id,
        "operator_name": operator_name(tag_id),
        "x": x,
        "y": y,
        "at": at,
        "_at_ts": new_ts,
        **{k: v for k, v in extra.items() if v is not None},
    }

    with _lock:
        global _last_message_at
        _positions[tag_id] = pos
        _last_message_at = datetime.now().astimezone().isoformat()

    _notify("rtls_position", position=_public_position(pos))
    return pos


def record_zone_event(
    tag_id: int,
    zone_id: int,
    status: str,
    at: str | None = None,
    duration: float | None = None,
    *,
    zone_name: str | None = None,
) -> dict:
    entry = _zone_entry(
        tag_id, zone_id, status,
        zone_name=zone_name, at=at, duration=duration,
    )

    with _lock:
        global _last_message_at
        _last_message_at = datetime.now().astimezone().isoformat()
        if status == "in":
            _zone_presence[tag_id] = entry
        else:
            _zone_presence.pop(tag_id, None)

    _notify(
        "rtls_zone" if status == "in" else "rtls_presence",
        zone=entry if status == "in" else {"tag_id": tag_id, "status": status},
    )
    return entry


def set_connected(connected: bool) -> None:
    global _connected
    _connected = connected


def _public_position(pos: dict) -> dict:
    return {k: v for k, v in pos.items() if not str(k).startswith("_")}


def _fresh_positions() -> list[dict]:
    now = time.time()
    out: list[dict] = []
    with _lock:
        items = list(_positions.items())
    for tag_id, pos in items:
        is_test = tag_id in test_feed_ids()
        at_ts = pos.get("_at_ts") or position_at_ts(pos.get("at"))
        if not is_test and at_ts > 0 and (now - at_ts) > STALE_POSITION_SECS:
            continue
        pub = _public_position(pos)
        pub["zone_display"] = format_zone(tag_id)
        zp = _zone_presence.get(tag_id)
        if zp:
            pub["zone_id"] = zp.get("zone_id")
            pub["zone_name"] = zp.get("zone_name")
            pub["station_name"] = zp.get("station_name")
        out.append(pub)
    return out


def get_snapshot() -> dict:
    with _lock:
        zone_presence = list(_zone_presence.values())
        connected = _connected
        last_message_at = _last_message_at
    return {
        "connected": connected,
        "last_message_at": last_message_at,
        "positions": _fresh_positions(),
        "zone_presence": zone_presence,
    }


def clear_live_state() -> None:
    with _lock:
        _positions.clear()
        _zone_presence.clear()
