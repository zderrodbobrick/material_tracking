"""Load Sewio RTLS reference data from the project RTLS/ folder (PACE exports)."""

from __future__ import annotations

import json
import sys
from functools import lru_cache
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from config import RTLS_DATA_DIR, SEWIO_STATION_ZONE_IDS, STATION_NAME


def _load_json(name: str) -> dict:
    path = Path(RTLS_DATA_DIR) / name
    if not path.exists():
        return {}
    data = json.loads(path.read_text(encoding="utf-8"))
    return {k: v for k, v in data.items() if not str(k).startswith("_")}


def mes_to_station(mes_location: str) -> str:
    """TPF.Gannomat -> Gannomat (matches stations.station_name)."""
    loc = mes_location.strip()
    if "." in loc:
        return loc.split(".", 1)[1]
    return loc


@lru_cache(maxsize=1)
def operator_names() -> dict[str, str]:
    return _load_json("operator-names.json")


@lru_cache(maxsize=1)
def zone_names() -> dict[str, str]:
    return _load_json("zoneNames.json")


@lru_cache(maxsize=1)
def zone_mes_map() -> dict[int, str]:
    """zone_id -> MES location from zoneMappings.json (e.g. 7 -> TPF.Gannomat)."""
    raw = _load_json("zoneMappings.json")
    return {int(k): str(v) for k, v in raw.items() if str(k).isdigit()}


@lru_cache(maxsize=1)
def zone_station_map() -> dict[int, str]:
    """zone_id -> app station_name (derived from zoneMappings.json)."""
    return {zid: mes_to_station(mes) for zid, mes in zone_mes_map().items()}


@lru_cache(maxsize=1)
def station_benchmarks() -> dict[int, dict]:
    """zone_id -> {avg_time, avg_time_plus_sd} from stationBenchmarks.json."""
    raw = _load_json("stationBenchmarks.json")
    out: dict[int, dict] = {}
    for k, v in raw.items():
        if str(k).isdigit() and isinstance(v, dict):
            out[int(k)] = v
    return out


def operator_name(tag_id: int) -> str:
    return operator_names().get(str(tag_id), f"Tag {tag_id}")


def zone_label(zone_id: int) -> str:
    return zone_names().get(str(zone_id), f"Zone {zone_id}")


def station_for_zone(zone_id: int) -> str | None:
    """Resolve app station_name for a Sewio zone."""
    if zone_id in SEWIO_STATION_ZONE_IDS:
        return STATION_NAME
    return zone_station_map().get(zone_id)


def zones_for_station(station_name: str) -> set[int]:
    """All Sewio zone IDs that map to a given station (plus env overrides)."""
    zones = {zid for zid, st in zone_station_map().items() if st == station_name}
    if station_name == STATION_NAME:
        zones |= SEWIO_STATION_ZONE_IDS
    return zones
