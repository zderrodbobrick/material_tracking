"""Debug Sewio WebSocket — print raw messages."""
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

    print(f"Connecting to {URL}")
    async with websockets.connect(URL, ssl=ctx, ping_interval=30) as ws:
        sub = {
            "headers": {"X-ApiKey": KEY},
            "method": "subscribe",
            "resource": "/feeds/",
        }
        print("Sending:", json.dumps(sub))
        await ws.send(json.dumps(sub))

        count = 0
        try:
            async with asyncio.timeout(15):
                async for raw in ws:
                    count += 1
                    preview = raw[:300] + ("..." if len(raw) > 300 else "")
                    print(f"[{count}] {preview}")
                    if count >= 5:
                        break
        except TimeoutError:
            print(f"No messages within 15s (received {count})")


if __name__ == "__main__":
    asyncio.run(main())
