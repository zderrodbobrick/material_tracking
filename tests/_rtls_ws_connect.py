"""Verify Sewio WebSocket connects (no messages required)."""
import asyncio
import json
import os
import ssl
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from dotenv import load_dotenv

load_dotenv()

URL = os.getenv("SEWIO_WS_URL") or "wss://10.25.80.13/sensmapserver/api"
KEY = os.getenv("SEWIO_API_KEY", "")


async def main() -> int:
    import websockets

    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE

    print("Sewio WebSocket connection test")
    print(f"  URL      : {URL}")
    print(f"  API key  : {'set' if KEY else 'MISSING'}")

    try:
        async with websockets.connect(URL, ssl=ctx, open_timeout=10, ping_interval=30) as ws:
            await ws.send(json.dumps({
                "headers": {"X-ApiKey": KEY},
                "method": "subscribe",
                "resource": "/feeds/",
            }))
            print("  Connect  : OK")
            print("  Subscribe: sent (/feeds/)")
            print("  (No live messages expected if RTLS is off — connection alone is enough)")
            return 0
    except Exception as exc:
        print(f"  Connect  : FAIL — {exc}")
        return 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
