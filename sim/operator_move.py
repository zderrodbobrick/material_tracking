"""Random operator movement between production zones for offline sim."""

from __future__ import annotations

import json
import random
import threading
import urllib.error
import urllib.request
from typing import Callable, Optional

from config import (
    SIM_OPERATOR_MAX_DWELL_SEC,
    SIM_OPERATOR_MIN_DWELL_SEC,
    RTLS_OPERATOR_CONFIRM_SECS,
)

_stop = threading.Event()
_threads: list[threading.Thread] = []
_api_base = "http://127.0.0.1:5001"


def _sim_zone_url() -> str:
    return f"{_api_base.rstrip('/')}/api/rtls/sim-zone"


def _post_zone_event(tag_id: int, zone_id: int, status: str) -> bool:
    body = json.dumps({
        "tag_id": tag_id,
        "zone_id": zone_id,
        "status": status,
        "source": "sim",
    }).encode("utf-8")
    try:
        req = urllib.request.Request(
            _sim_zone_url(),
            data=body,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=3) as resp:
            return 200 <= getattr(resp, "status", 200) < 300
    except (urllib.error.URLError, TimeoutError, OSError, ValueError):
        return False


def _worker(
    tag_id: int,
    initial_zone: int,
    zone_pool: list[int],
    notify: Optional[Callable[[], None]],
) -> None:
    current = initial_zone
    min_dwell = max(SIM_OPERATOR_MIN_DWELL_SEC, RTLS_OPERATOR_CONFIRM_SECS + 2.0)
    while not _stop.is_set():
        dwell = random.uniform(min_dwell, max(SIM_OPERATOR_MAX_DWELL_SEC, min_dwell + 1.0))
        if _stop.wait(dwell):
            return
        choices = [z for z in zone_pool if z != current]
        if not choices:
            continue
        new_zone = random.choice(choices)
        _post_zone_event(tag_id, current, "out")
        if _post_zone_event(tag_id, new_zone, "in"):
            current = new_zone


def start_operator_movement(
    notify: Optional[Callable[[], None]] = None,
    seeds: list[tuple[int, int]] | None = None,
    *,
    api_base: str | None = None,
) -> int:
    """Start one background thread per demo operator. Returns thread count."""
    from rtls_live import DEMO_ZONE_SEEDS

    global _threads, _api_base
    if api_base:
        _api_base = api_base.rstrip("/")
        if _api_base.endswith("/api/notify"):
            _api_base = _api_base[: -len("/api/notify")]

    stop_operator_movement()
    seeds = seeds or list(DEMO_ZONE_SEEDS)
    zone_pool = sorted({zone_id for _, zone_id in seeds})
    _stop.clear()
    for tag_id, zone_id in seeds:
        thread = threading.Thread(
            target=_worker,
            args=(tag_id, zone_id, zone_pool),
            kwargs={"notify": notify},
            daemon=True,
            name=f"op-move-{tag_id}",
        )
        thread.start()
        _threads.append(thread)
    return len(seeds)


def stop_operator_movement() -> None:
    _stop.set()
    for thread in _threads:
        thread.join(timeout=1.0)
    _threads.clear()
