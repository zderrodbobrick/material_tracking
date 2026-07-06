"""
EPC Tag Format & Type Code Mapping
====================================
Tags follow this fixed structure:

    Position:   [0]  [1 … -8]   [-7]      [-6 … -1]
    Field:      Qty  Part #   Type Code  Work Order #

    Example:    1    D4        0          463947
                ^    ^         ^           ^
                |    |         |           └─ 6-digit Work Order number
                |    |         └─ Type code  →  mapped to a label (e.g. "0" → "IBUS")
                |    └─ Part number  (everything between Qty and Type code)
                └─ Part required quantity  (single character)

Full example:  "1D40463947"
    qty         = "1"
    part_number = "D4"
    type_code   = "0"
    type_label  = "IBUS"
    work_order  = "463947"

Add new type codes to EPC_TYPE_CODES as they are discovered.
"""

# Maps single-character type code → human-readable label
EPC_TYPE_CODES: dict[str, str] = {
    "0": "IBUS",
    # Add future codes below, e.g.:
    # "1": "LABEL_TYPE_1",
    # "A": "LABEL_TYPE_A",
}


def parse_tag_id(decoded: str) -> dict:
    """
    Parse a decoded EPC string into its named components.

    Returns a dict with keys:
        qty         – part required quantity (first character)
        part_number – part number (middle characters)
        type_code   – raw single-character type code
        type_label  – human-readable label (from EPC_TYPE_CODES), or the raw
                      type_code if unknown
        work_order  – 6-digit work order number (last 6 characters)
        raw         – original decoded string unchanged
        is_known    – True if type_code is in EPC_TYPE_CODES

    If the string is too short to parse (<7 chars), all fields are None
    except raw (which holds the original string) and is_known (False).
    """
    if len(decoded) < 7:
        return {
            "qty": None,
            "part_number": None,
            "type_code": None,
            "type_label": None,
            "work_order": None,
            "raw": decoded,
            "is_known": False,
        }

    qty        = decoded[0]
    type_code  = decoded[-7]
    part_number = decoded[1:-7]
    work_order = decoded[-6:]
    type_label = EPC_TYPE_CODES.get(type_code)

    label = type_label if type_label is not None else type_code
    formatted = f"{qty}{part_number}{label}{work_order}" if type_label is not None else decoded

    return {
        "qty":         qty,
        "part_number": part_number,
        "type_code":   type_code,
        "type_label":  label,
        "work_order":  work_order,
        "raw":         decoded,
        "formatted":   formatted,
        "is_known":    type_label is not None,
    }


def format_tag_id(decoded: str) -> str:
    """
    Return the decoded EPC string unchanged.
    The raw decoded value is stored in the database; parsing happens at
    display time (terminal and frontend).
    """
    return decoded
