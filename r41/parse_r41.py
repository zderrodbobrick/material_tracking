"""
Parse Cut Rite / label .R41 work-order files into part BOM records.

Drop files into r41/inbox/ (or pass a path). Each [ISTK-*] block becomes one
expected part that maps to an RFID EPC:

    qty + REF + type_code(0) + work_order  →  e.g. 1S320376814
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

# Progress spine (RFID path for now). Tenoner = 0%.
PROGRESS_STATIONS = (
    "Tenoner",
    "LBD",
    "Gannomat",
    "Insert Station",
)

PROGRESS_PCT_PER_STATION = round(100 / max(len(PROGRESS_STATIONS) - 1, 1), 2)

_SECTION_RE = re.compile(r"\[([^\]]+)\](.*?)\[\1\]", re.S)
_ISTK_RE = re.compile(r"^ISTK-(\d+)$", re.I)


def _kv_block(body: str) -> dict[str, str]:
    out: dict[str, str] = {}
    for line in body.splitlines():
        line = line.strip()
        if not line or "=" not in line:
            continue
        key, val = line.split("=", 1)
        out[key.strip()] = val.strip()
    return out


def _split_semi(value: str | None) -> list[str]:
    if not value:
        return []
    return [p.strip() for p in value.split(";")]


def _work_order_digits(name: str | None) -> str:
    if not name:
        return ""
    digits = re.sub(r"\D", "", name)
    return digits[-6:] if len(digits) >= 6 else digits


def _build_epc(qty: int, ref: str, work_order: str, type_code: str = "0") -> str:
    """RFID payload matching epc_type_map: [qty][part#][type][WO]."""
    wo = (work_order or "").zfill(6)[-6:]
    q = str(max(1, min(qty, 9)))  # single-char qty on tag
    return f"{q}{ref}{type_code}{wo}"


def _format_tag(qty: int, ref: str, work_order: str) -> str:
    wo = (work_order or "").zfill(6)[-6:]
    q = str(max(1, min(qty, 9)))
    return f"{q}-{ref}-IBUS{wo}"


def _parse_istk(index: int, fields: dict[str, str], project: dict[str, str]) -> dict[str, Any]:
    bem = _split_semi(fields.get("BEM"))
    bem2 = _split_semi(fields.get("BEM2"))
    bem3 = _split_semi(fields.get("BEM3"))
    drawing = fields.get("DRAWING", "")
    draw_bits = drawing.split(";", 1)
    draw_head = draw_bits[0].strip() if draw_bits else ""
    draw_desc = draw_bits[1].strip() if len(draw_bits) > 1 else ""

    ref = fields.get("REF", "")
    qty = int(float(fields.get("A") or fields.get("PROD") or 1))
    ibus = bem3[5] if len(bem3) > 5 else project.get("Name", "")
    work_order = _work_order_digits(ibus) or _work_order_digits(project.get("Name"))

    partid_raw = fields.get("PartID", "")
    partid = partid_raw.split(";")[0].strip() if partid_raw else ""

    return {
        "index": index,
        "ref": ref,
        "qty": qty,
        "length": fields.get("L"),
        "width": fields.get("B"),
        "thickness": fields.get("A"),
        "material_nr": fields.get("MATNR"),
        "seq_no": fields.get("SEQNO"),
        "part_id": partid,
        "part_id_raw": partid_raw,
        # BEM: product; material family; site; customer fragment
        "product": bem[0] if len(bem) > 0 else "",
        "material_family": bem[1] if len(bem) > 1 else "",
        "site": bem[2] if len(bem) > 2 else "",
        "customer_fragment": bem[3] if len(bem) > 3 else "",
        # BEM2: room/job label; …; size code; color; product
        "job_label": bem2[0] if len(bem2) > 0 else "",
        "size_code": bem2[3] if len(bem2) > 3 else "",
        "color": bem2[4] if len(bem2) > 4 else "",
        # BEM3: drill/op; W; L; size text; room; IBUS; job; ; PO; hardware note
        "operation": bem3[0] if len(bem3) > 0 else "",
        "dim_w": bem3[1] if len(bem3) > 1 else "",
        "dim_l": bem3[2] if len(bem3) > 2 else "",
        "size": bem3[3] if len(bem3) > 3 else "",
        "room": bem3[4] if len(bem3) > 4 else "",
        "ibus": ibus,
        "job_number": bem3[6] if len(bem3) > 6 else "",
        "po": bem3[8] if len(bem3) > 8 else "",
        "hardware_note": bem3[9] if len(bem3) > 9 else "",
        "drawing": drawing,
        "drawing_header": draw_head,
        "drawing_desc": draw_desc,
        "bem": fields.get("BEM", ""),
        "bem2": fields.get("BEM2", ""),
        "bem3": fields.get("BEM3", ""),
        "work_order": work_order,
        "epc": _build_epc(qty, ref, work_order) if ref and work_order else "",
        "tag_label": _format_tag(qty, ref, work_order) if ref and work_order else "",
        "raw": fields,
    }


def parse_r41_text(text: str, source: str | Path | None = None) -> dict[str, Any]:
    """Parse R41 file contents into project + parts BOM."""
    sections: dict[str, dict[str, str]] = {}
    istk: list[tuple[int, dict[str, str]]] = []

    for name, body in _SECTION_RE.findall(text):
        fields = _kv_block(body)
        m = _ISTK_RE.match(name)
        if m:
            istk.append((int(m.group(1)), fields))
        else:
            sections[name] = fields

    project = sections.get("PROJECT", {})
    algres = sections.get("ALGRES", {})
    customer_raw = project.get("Customer", "")
    cust_bits = _split_semi(customer_raw)

    materials = []
    for key, fields in sorted(sections.items()):
        if key.startswith("MAT-") and "MAT" in fields:
            materials.append({"id": key, "mat": fields["MAT"]})

    parts = [_parse_istk(idx, fields, project) for idx, fields in sorted(istk, key=lambda x: x[0])]
    work_order = _work_order_digits(project.get("Name"))
    if not work_order and parts:
        work_order = parts[0].get("work_order") or ""

    return {
        "source": str(source) if source else None,
        "ibus": project.get("Name") or (f"IBUS{work_order}" if work_order else ""),
        "work_order": work_order,
        "customer": cust_bits[0] if cust_bits else customer_raw,
        "job_site": cust_bits[1] if len(cust_bits) > 1 else "",
        "prod_date": project.get("ProdDate", ""),
        "project_id": project.get("ID", ""),
        "materials": materials,
        "totals": {
            "parts": len(parts),
            "pieces": sum(int(p.get("qty") or 1) for p in parts),
            "boards": _safe_int(algres.get("TOTSTK")),
            "cuts": _safe_int(algres.get("TOTAANTSN")),
            "layouts": _safe_int(algres.get("AANTLAY")),
        },
        "progress": {
            "stations": list(PROGRESS_STATIONS),
            "pct_per_station": PROGRESS_PCT_PER_STATION,
            "start_station": PROGRESS_STATIONS[0],
            "end_station": PROGRESS_STATIONS[-1],
        },
        "parts": parts,
    }


def _safe_int(value: str | None) -> int | None:
    if value is None or value == "":
        return None
    try:
        return int(float(value))
    except ValueError:
        return None


def parse_r41_file(path: str | Path) -> dict[str, Any]:
    path = Path(path)
    text = path.read_text(encoding="utf-8", errors="replace")
    return parse_r41_text(text, source=path)


def inbox_dir() -> Path:
    return Path(__file__).resolve().parent / "inbox"


def list_r41_files(directory: str | Path | None = None) -> list[Path]:
    root = Path(directory) if directory else inbox_dir()
    if not root.is_dir():
        return []
    # Case-insensitive FS (Windows) can match the same file via both globs.
    seen: set[str] = set()
    out: list[Path] = []
    for p in sorted(root.glob("*.R41")) + sorted(root.glob("*.r41")):
        key = str(p.resolve()).lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(p)
    return out


def parse_inbox(directory: str | Path | None = None) -> list[dict[str, Any]]:
    return [parse_r41_file(p) for p in list_r41_files(directory)]


def station_progress_pct(station_name: str | None) -> float:
    """Percent complete when a part is at/through this station (LBD = first)."""
    if not station_name:
        return 0.0
    name = str(station_name).strip()
    aliases = {
        "Final Packing": "Pack out",
        "Packing": "Pack out",
        "Outswing Latch Drilling": "LB Installation",
    }
    name = aliases.get(name, name)
    if name not in PROGRESS_STATIONS:
        return 0.0
    idx = PROGRESS_STATIONS.index(name)
    return round((idx + 1) * PROGRESS_PCT_PER_STATION, 2)
