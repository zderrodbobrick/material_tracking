"""Quick Sewio RTLS connectivity check (REST + optional WebSocket sample)."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from config import (
    SEWIO_API_KEY,
    SEWIO_REST_URL,
    SEWIO_VERIFY_SSL,
    SEWIO_WS_URL,
    ENABLE_LIVE_INGESTION,
)
from rtls_storage import rest_health


def main() -> int:
    print("Sewio RTLS verification")
    print(f"  ENABLE_LIVE_INGESTION : {ENABLE_LIVE_INGESTION}")
    print(f"  REST URL              : {SEWIO_REST_URL}")
    print(f"  WS URL                : {SEWIO_WS_URL}")
    print(f"  API key set           : {'yes' if SEWIO_API_KEY else 'NO'}")

    result = rest_health(SEWIO_API_KEY, SEWIO_REST_URL, SEWIO_VERIFY_SSL)
    if result.get("ok"):
        print(f"  REST /feeds           : OK ({result.get('tag_count', 0)} tags)")
        return 0

    print(f"  REST /feeds           : FAIL — {result.get('error', result)}")
    print("  (Factory LAN required — 10.25.80.13 is not reachable off-site)")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
