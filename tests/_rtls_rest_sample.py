import httpx
import os
from dotenv import load_dotenv

load_dotenv()
key = os.getenv("SEWIO_API_KEY")
r = httpx.get(
    "https://10.25.80.13/sensmapserver/api/feeds",
    headers={"X-ApiKey": key},
    verify=False,
    timeout=10,
)
tags = [f for f in r.json().get("results", []) if f.get("type") == "tag"]
print(f"Tags via REST: {len(tags)}")
if tags:
    t = tags[0]
    ds = {d["id"]: d.get("current_value") for d in t.get("datastreams", [])}
    tid = t.get("id")
    print(f"Sample tag {tid}: posX={ds.get('posX')}, posY={ds.get('posY')}")
