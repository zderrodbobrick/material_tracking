"""Connect to Sewio WebSocket briefly and count messages."""
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


async def main():
    import websockets

    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE

    feeds = 0
    zones = 0
    other = 0

    async with websockets.connect(URL, ssl=ctx, ping_interval=30) as ws:
        for resource in ("/feeds/", "/zones/"):
            await ws.send(json.dumps({
                "headers": {"X-ApiKey": KEY},
                "method": "subscribe",
                "resource": resource,
            }))

        try:
            async with asyncio.timeout(20):
                async for raw in ws:
                    msg = json.loads(raw)
                    r = msg.get("resource", "")
                    if r.startswith("/feeds"):
                        feeds += 1
                    elif r.startswith("/zones"):
                        zones += 1
                    else:
                        other += 1
                    if feeds + zones >= 3:
                        break
        except TimeoutError:
            pass

    print(f"WebSocket messages in 20s: feeds={feeds}, zones={zones}, other={other}")
    return 0 if (feeds + zones) > 0 else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
