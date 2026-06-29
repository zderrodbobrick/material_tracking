"""
POC: Encode-only RFID utility for Zebra ZT411R.

WARNING: This is intended for a POC second-pass encode workflow.
The label may feed through the printer, but this ZPL should not
intentionally print visible text or graphics because it contains
only RFID encode commands.

Usage:
    python encode_rfid_only.py                     # encode random EPC
    python encode_rfid_only.py --epc AABBCC...     # encode specific EPC
    python encode_rfid_only.py --dry-run           # show ZPL without sending
    python encode_rfid_only.py --ip 10.25.100.157  # override printer IP
"""

import argparse
import secrets
import socket
import sys
from pathlib import Path

# Add parent directory to path for config import
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from config import PRINTER_IP, PRINTER_PORT

# Default settings
DEFAULT_IP = PRINTER_IP
DEFAULT_PORT = PRINTER_PORT
TIMEOUT = 5.0


def generate_random_epc() -> str:
    """Generate a random 96-bit EPC as 24 uppercase hex characters."""
    return secrets.token_hex(12).upper()


def build_encode_only_zpl(epc: str) -> str:
    """
    Build ZPL that encodes RFID only (no visible print).

    ^XA        - Start format
    ^RS8       - RFID setup (UHF Gen2, 96-bit EPC)
    ^RFW,H,,,A - Write to RFID tag: H=hex, A=EPC memory bank
    ^XZ        - End format
    """
    return f"^XA\n^RS8\n^RFW,H,,,A^FD{epc}^FS\n^XZ\n"


def send_zpl(ip: str, port: int, zpl: str) -> None:
    """Send raw ZPL to the printer via TCP socket."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(TIMEOUT)
        s.connect((ip, port))
        s.sendall(zpl.encode("utf-8"))


def main():
    parser = argparse.ArgumentParser(
        description="Send an encode-only RFID job to a Zebra ZT411R printer."
    )
    parser.add_argument(
        "--ip",
        default=DEFAULT_IP,
        help=f"Printer IP address (default: {DEFAULT_IP})",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=DEFAULT_PORT,
        help=f"Printer port (default: {DEFAULT_PORT})",
    )
    parser.add_argument(
        "--epc",
        default=None,
        help="Specific 24-char hex EPC to encode. If omitted, a random EPC is generated.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Display the ZPL without sending it to the printer.",
    )
    args = parser.parse_args()

    # Generate or validate EPC
    if args.epc:
        epc = args.epc.upper().strip()
        if len(epc) != 24:
            print(f"ERROR: EPC must be exactly 24 hex characters. Got {len(epc)}.")
            sys.exit(1)
        if not all(c in "0123456789ABCDEF" for c in epc):
            print("ERROR: EPC must contain only hexadecimal characters (0-9, A-F).")
            sys.exit(1)
    else:
        epc = generate_random_epc()

    zpl = build_encode_only_zpl(epc)

    print(f"EPC: {epc}")
    print(f"\n--- ZPL ---\n{zpl}--- END ---\n")

    if args.dry_run:
        print("[DRY RUN] ZPL was NOT sent to the printer.")
        return

    try:
        send_zpl(args.ip, args.port, zpl)
        print(f"Sent encode-only RFID job to {args.ip}:{args.port}")
        print(f"Encoded EPC: {epc}")
    except socket.timeout:
        print(f"ERROR: Connection to {args.ip}:{args.port} timed out.")
        sys.exit(1)
    except ConnectionRefusedError:
        print(f"ERROR: Connection refused by {args.ip}:{args.port}. Is the printer on?")
        sys.exit(1)
    except OSError as e:
        print(f"ERROR: Network error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
