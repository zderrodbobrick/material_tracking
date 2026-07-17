"""Per-station analytics targets and weighted IBUS progress."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from config import PROGRESS_STATIONS, STATUS_OPEN, IBUS_TRANSIT_BUFFER_SEC

# Align with api.py progress aliases (Tennoner in DB → Tenoner on spine).
STATION_ALIASES = {
    "Tennoner": "Tenoner",
    "Tenoner": "Tenoner",
    "Final Packing": "Pack out",
    "Packing": "Pack out",
    "Outswing Latch Drilling": "LB Installation",
}

DEFAULT_PART_DWELL = 120
DEFAULT_OPERATOR_DWELL = 45

# Suggested defaults when seeding (canonical spine names).
_SPINE_DEFAULTS: dict[str, dict[str, int | float]] = {
    "Tenoner": {
        "target_part_dwell_seconds": 180,
        "target_operator_dwell_seconds": 60,
        "max_dwell_seconds": 600,
        "target_pieces_per_hour": 8.0,
        "progress_spine_index": 0,
        "on_progress_spine": 1,
    },
    "LBD": {
        "target_part_dwell_seconds": 90,
        "target_operator_dwell_seconds": 30,
        "max_dwell_seconds": 300,
        "target_pieces_per_hour": 12.0,
        "progress_spine_index": 1,
        "on_progress_spine": 1,
    },
    "Gannomat": {
        "target_part_dwell_seconds": 120,
        "target_operator_dwell_seconds": 45,
        "max_dwell_seconds": 480,
        "target_pieces_per_hour": 10.0,
        "progress_spine_index": 2,
        "on_progress_spine": 1,
    },
    "Insert Station": {
        "target_part_dwell_seconds": 60,
        "target_operator_dwell_seconds": 30,
        "max_dwell_seconds": 240,
        "target_pieces_per_hour": 15.0,
        "progress_spine_index": 3,
        "on_progress_spine": 1,
    },
}

_OFF_SPINE_DEFAULTS: dict[str, dict[str, int | float]] = {
    "Anderson": {"target_part_dwell_seconds": 150, "target_operator_dwell_seconds": 45, "max_dwell_seconds": 480},
    "Final Packing": {"target_part_dwell_seconds": 90, "target_operator_dwell_seconds": 30, "max_dwell_seconds": 300},
    "Pack out": {"target_part_dwell_seconds": 90, "target_operator_dwell_seconds": 30, "max_dwell_seconds": 300},
    "Evolve Edge Finisher": {"target_part_dwell_seconds": 120, "target_operator_dwell_seconds": 45, "max_dwell_seconds": 480},
    "Evolve Drilling": {"target_part_dwell_seconds": 120, "target_operator_dwell_seconds": 45, "max_dwell_seconds": 480},
    "Holzma": {"target_part_dwell_seconds": 180, "target_operator_dwell_seconds": 60, "max_dwell_seconds": 600},
    "Holzma.Falloff": {"target_part_dwell_seconds": 120, "target_operator_dwell_seconds": 45, "max_dwell_seconds": 480},
    "LB Installation": {"target_part_dwell_seconds": 100, "target_operator_dwell_seconds": 40, "max_dwell_seconds": 400},
    "1/2 Edgefinisher": {"target_part_dwell_seconds": 120, "target_operator_dwell_seconds": 45, "max_dwell_seconds": 480},
}


def canonical_station(name: str | None) -> str | None:
    if not name:
        return None
    n = str(name).strip()
    return STATION_ALIASES.get(n, n)


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _parse_ts(ts: str | None) -> datetime | None:
    if not ts:
        return None
    raw = ts.strip().replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(raw)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except ValueError:
        return None


def default_seed_for_station(station_name: str) -> dict[str, Any]:
    canon = canonical_station(station_name) or station_name
    if canon in _SPINE_DEFAULTS:
        return dict(_SPINE_DEFAULTS[canon])
    if station_name in _OFF_SPINE_DEFAULTS:
        return dict(_OFF_SPINE_DEFAULTS[station_name])
    if canon in _OFF_SPINE_DEFAULTS:
        return dict(_OFF_SPINE_DEFAULTS[canon])
    return {
        "target_part_dwell_seconds": DEFAULT_PART_DWELL,
        "target_operator_dwell_seconds": DEFAULT_OPERATOR_DWELL,
        "max_dwell_seconds": DEFAULT_PART_DWELL * 4,
        "target_pieces_per_hour": None,
        "progress_spine_index": None,
        "on_progress_spine": 0,
    }


def fetch_specs_by_name(conn) -> dict[str, dict[str, Any]]:
    rows = conn.execute(
        """SELECT s.station_id, s.station_name, s.station_type, s.is_active,
                  ss.target_part_dwell_seconds, ss.target_operator_dwell_seconds,
                  ss.max_dwell_seconds, ss.target_pieces_per_hour,
                  ss.progress_spine_index, ss.on_progress_spine, ss.notes, ss.updated_at
           FROM stations s
           LEFT JOIN station_specifications ss ON ss.station_id = s.station_id
           WHERE s.is_active = 1
           ORDER BY s.station_id"""
    ).fetchall()
    out: dict[str, dict[str, Any]] = {}
    for r in rows:
        row = dict(r)
        out[row["station_name"]] = row
        canon = canonical_station(row["station_name"])
        if canon and canon != row["station_name"]:
            out[canon] = row
    return out


def spine_sort_key(row: dict) -> tuple:
    """Sort key for station specs — index 0 is valid (first on spine)."""
    idx = row.get("progress_spine_index")
    spine_idx = 99 if idx is None else int(idx)
    return (not row.get("on_progress_spine"), spine_idx, row.get("station_id") or 0)


def progress_spine_names(specs_by_name: dict[str, dict]) -> list[str]:
    by_id: dict[int, dict] = {}
    for r in specs_by_name.values():
        sid = r.get("station_id")
        if sid is not None:
            by_id[sid] = r
    spine_rows = [
        r for r in by_id.values()
        if r.get("on_progress_spine") and r.get("progress_spine_index") is not None
    ]
    if spine_rows:
        seen: set[str] = set()
        ordered: list[str] = []
        for r in sorted(spine_rows, key=lambda x: int(x["progress_spine_index"])):
            name = r["station_name"]
            if name not in seen:
                seen.add(name)
                ordered.append(name)
        if ordered:
            return ordered
    return list(PROGRESS_STATIONS)


def _target_part_dwell(spec: dict | None) -> int:
    if spec and spec.get("target_part_dwell_seconds"):
        return int(spec["target_part_dwell_seconds"])
    return DEFAULT_PART_DWELL


def _machines_for_station(part_machines: list[dict], station_name: str) -> list[dict]:
    target = canonical_station(station_name) or station_name
    out = []
    for m in part_machines:
        sn = canonical_station(m.get("station_name"))
        if sn == target or m.get("station_name") == station_name:
            out.append(m)
    return out


def _session_dwell_seconds(machine: dict, now: datetime | None = None) -> int:
    dwell = machine.get("dwell_seconds")
    if dwell is not None:
        return int(dwell)
    if machine.get("status") == STATUS_OPEN:
        ent = _parse_ts(machine.get("entry_time"))
        if ent and now:
            return max(0, int((now - ent).total_seconds()))
    return 0


def part_weighted_progress(
    part_machines: list[dict],
    specs_by_name: dict[str, dict],
    *,
    now: datetime | None = None,
) -> float | None:
    """0–1 progress from target dwell weights along the configured spine."""
    spine = progress_spine_names(specs_by_name)
    if not spine:
        return None

    now = now or datetime.now(timezone.utc)
    weights = [(name, _target_part_dwell(specs_by_name.get(name))) for name in spine]
    total = sum(w for _, w in weights)
    if total <= 0:
        return None

    earned = 0.0
    for station_name, weight in weights:
        ms = _machines_for_station(part_machines, station_name)
        if not ms:
            break

        closed = [
            m for m in ms
            if m.get("status") != STATUS_OPEN and m.get("dwell_seconds") is not None
        ]
        open_m = next((m for m in ms if m.get("status") == STATUS_OPEN), None)

        if closed and not open_m:
            earned += weight
            continue
        if open_m:
            dwell = _session_dwell_seconds(open_m, now)
            partial = min(1.0, dwell / weight) if weight > 0 else 0.0
            earned += partial * weight
            break
        if closed:
            earned += weight
            continue
        break

    return min(1.0, earned / total)


def position_progress(station_name: str | None) -> float:
    if not station_name:
        return 0.0
    canon = canonical_station(station_name) or station_name
    spine = list(PROGRESS_STATIONS)
    if canon not in spine:
        return 0.0
    denom = max(len(spine) - 1, 1)
    return min(1.0, spine.index(canon) / denom)


def compare_to_target(actual: float | None, target: int | None) -> dict[str, Any]:
    if actual is None or not target:
        return {"vs_target_pct": None, "vs_target_status": None}
    pct = round(100.0 * actual / target, 1)
    if pct <= 100:
        status = "on_target"
    elif pct <= 125:
        status = "slightly_over"
    else:
        status = "over_target"
    return {"vs_target_pct": pct, "vs_target_status": status}


def spec_row_to_api(row: dict, actual_part: float | None = None, actual_operator: float | None = None) -> dict:
    target_part = row.get("target_part_dwell_seconds")
    target_op = row.get("target_operator_dwell_seconds")
    part_cmp = compare_to_target(actual_part, target_part)
    op_cmp = compare_to_target(actual_operator, target_op)
    return {
        "station_id": row["station_id"],
        "station_name": row["station_name"],
        "station_type": row.get("station_type"),
        "is_active": bool(row.get("is_active", 1)),
        "target_part_dwell_seconds": target_part,
        "target_operator_dwell_seconds": target_op,
        "max_dwell_seconds": row.get("max_dwell_seconds"),
        "target_pieces_per_hour": row.get("target_pieces_per_hour"),
        "progress_spine_index": row.get("progress_spine_index"),
        "on_progress_spine": bool(row.get("on_progress_spine")),
        "notes": row.get("notes"),
        "updated_at": row.get("updated_at"),
        "actual_part_dwell_seconds": round(actual_part, 1) if actual_part is not None else None,
        "actual_operator_dwell_seconds": round(actual_operator, 1) if actual_operator is not None else None,
        **part_cmp,
        "operator_vs_target_pct": op_cmp["vs_target_pct"],
        "operator_vs_target_status": op_cmp["vs_target_status"],
    }


def station_part_dwell_estimate(
    station_name: str,
    specs_by_name: dict[str, dict],
    part_actuals: dict[str, float] | None = None,
) -> int:
    """Average seconds at one spine station (actual avg, else target, else default)."""
    canon = canonical_station(station_name) or station_name
    if part_actuals:
        for key in (station_name, canon):
            if key in part_actuals and part_actuals[key]:
                return int(round(part_actuals[key]))
    spec = specs_by_name.get(station_name) or specs_by_name.get(canon)
    return _target_part_dwell(spec)


def estimate_order_pipeline(
    part_count: int,
    specs_by_name: dict[str, dict],
    *,
    part_actuals: dict[str, float] | None = None,
    transit_seconds: int | None = None,
) -> dict[str, Any]:
    """
    Estimated line time for a work order.

    per_part = sum(spine station avg dwells) + transit buffer (default 1 h)
    total    = part_count × per_part
    """
    transit = IBUS_TRANSIT_BUFFER_SEC if transit_seconds is None else int(transit_seconds)
    spine = progress_spine_names(specs_by_name)
    station_breakdown: list[dict[str, Any]] = []
    machine_total = 0
    for name in spine:
        sec = station_part_dwell_estimate(name, specs_by_name, part_actuals)
        station_breakdown.append({
            "station_name": name,
            "average_dwell_seconds": sec,
        })
        machine_total += sec
    per_part = machine_total + transit
    pc = max(int(part_count or 0), 0)
    total = per_part * pc if pc > 0 else None
    return {
        "part_count": pc,
        "spine_station_count": len(spine),
        "transit_seconds": transit,
        "machine_dwell_seconds": machine_total,
        "per_part_seconds": per_part,
        "estimated_total_seconds": total,
        "station_breakdown": station_breakdown,
    }


def upsert_spec(conn, station_id: int, fields: dict[str, Any]) -> None:
    allowed = {
        "target_part_dwell_seconds",
        "target_operator_dwell_seconds",
        "max_dwell_seconds",
        "target_pieces_per_hour",
        "progress_spine_index",
        "on_progress_spine",
        "notes",
    }
    payload = {k: fields[k] for k in allowed if k in fields}
    if "on_progress_spine" in payload:
        payload["on_progress_spine"] = 1 if payload["on_progress_spine"] else 0
    if not payload:
        return
    payload["updated_at"] = _now_iso()
    cols = ", ".join(payload.keys())
    placeholders = ", ".join("?" for _ in payload)
    updates = ", ".join(f"{k}=excluded.{k}" for k in payload.keys())
    conn.execute(
        f"""INSERT INTO station_specifications (station_id, {cols})
            VALUES (?, {placeholders})
            ON CONFLICT(station_id) DO UPDATE SET {updates}""",
        (station_id, *payload.values()),
    )
