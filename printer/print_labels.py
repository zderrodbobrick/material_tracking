import random
import sys
from pathlib import Path

import win32print

# Add parent directory to path for config import
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

# Printer Configuration
PRINTER_NAME = "ZDesigner ZT411R-300dpi ZPL"

def generate_zpl(label_text):
    # Convert text to Hex for the RFID Write command
    hex_id = label_text.encode('utf-8').hex().upper()
    
    zpl = f"""
    ^XA
^PW1200
^LL1800
^LH0,0
^RS8,,,0,E^FS
^FO50,50^A0N,60,60^FD4x6 RFID TEST^FS
^FO50,150^A0N,40,40^FDPROPERTY OF BOBRICK^FS
^RFW,H,2,12,1^FD424F25249434B3030313030^FS
^XZ
"""
    return zpl

def generate_random_ibus_label():
    """Generate random label in format X-XX-IBUSXXXXXX.
    
    Examples: 1-S1-IBUS1234, 1-D1-IBUS9876, 1-PX-IBUS5555
    """
    prefixes = ["1", "2", "3", "4", "5", "6", "7", "8", "9"]
    stations = ["S1", "D1", "DX", "PX", "S2", "D2"]
    prefix = random.choice(prefixes)
    station = random.choice(stations)
    number = random.randint(1000, 9999)
    return f"{prefix}-{station}-IBUS{number}"

# Generate 1 random IBUS label
labels_to_print = [generate_random_ibus_label()]

# Or generate multiple:
# labels_to_print = [generate_random_ibus_label() for _ in range(5)]

try:
    printer = win32print.OpenPrinter(PRINTER_NAME)
    try:
        job = win32print.StartDocPrinter(printer, 1, ("RFID Label", None, "RAW"))
        try:
            win32print.StartPagePrinter(printer)
            for label in labels_to_print:
                print(f"Sending {label}...")
                zpl_command = generate_zpl(label)
                win32print.WritePrinter(printer, zpl_command.encode("utf-8"))
            win32print.EndPagePrinter(printer)
        finally:
            win32print.EndDocPrinter(printer)
    finally:
        win32print.ClosePrinter(printer)
    print(f"All {len(labels_to_print)} label(s) sent successfully!")
except Exception as e:
    print(f"Printer Error: {e}")