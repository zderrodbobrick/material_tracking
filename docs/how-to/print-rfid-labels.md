# How to print RFID labels

Encode RFID tags and print test labels for development and station commissioning.

---

## Two printer workflows

| Script | Output | Connection |
|--------|--------|------------|
| `printer/encode_rfid_only.py` | Encode EPC only (no visible print) | TCP to network printer |
| `printer/print_labels.py` | Print visible 4×6 test label + RFID write | Windows spooler |

Both target Zebra ZT411R-class printers. Adjust printer name or IP for your hardware.

---

## Encode only (network printer)

Writes a hex EPC to tag memory over raw TCP (port 9100):

```powershell
python printer/encode_rfid_only.py
python printer/encode_rfid_only.py --epc AABBCCDDEEFF001122334455
python printer/encode_rfid_only.py --dry-run
```

| Flag | Default | Description |
|------|---------|-------------|
| `--epc` | random 96-bit hex | EPC to write |
| `--ip` | `PRINTER_IP` from `.env` | Printer IP |
| `--port` | `9100` | Raw socket port |
| `--dry-run` | off | Print ZPL to console only |

ZPL sent:

```zpl
^XA
^RS8
^RFW,H,,,A^FD<EPC>^FS
^XZ
```

Set `PRINTER_IP` and `PRINTER_PORT` in `.env`.

---

## Print test labels (Windows)

```powershell
python printer/print_labels.py
```

Uses Windows spooler with hardcoded printer name:

`ZDesigner ZT411R-300dpi ZPL`

Edit `PRINTER_NAME` in the script if your installed name differs.

Generates random labels like `1-S1-IBUS1234` and sends ZPL with visible text plus RFID encode block.

> **Note:** The visible label text and RFID payload may not match in the current script — use `encode_rfid_only.py` when you need a specific EPC.

---

## Label template reference

`printer/RFID-Test-ZEBRA.lbl` is a Zebra Designer template showing Bobrick label layout (CODE128 barcode + RFID encode). Reference for production label design; not invoked by Python scripts.

---

## EPC format for production tags

Decoded tags follow the structure in `epc_type_map.py`:

```
[Qty][PartNumber][TypeCode][WorkOrder6digits]
Example: 1D40463947  →  qty=1, part=D4, type=IBUS, WO=463947
```

Ensure encoded EPCs decode to strings your `EPC_FILTER_PATTERN` accepts.

---

## Requirements

- `pywin32` for Windows spooler printing (`pip install pywin32`)
- Network path: printer reachable on plant LAN at port 9100
- RFID-enabled media loaded in the printer

---

## Related

- [Data model — EPC format](../explanation/data-model.md)
- [Configure Zebra reader](configure-zebra-reader.md)
- [Configuration](../reference/configuration.md) — `PRINTER_IP`, `PRINTER_PORT`
