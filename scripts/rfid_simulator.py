#!/usr/bin/env python3
"""Send retry-safe RFID handheld bursts using only the Python standard library."""
import argparse
import json
import sys
import uuid
from datetime import datetime, timezone
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


def post(url: str, payload: dict) -> dict:
    request = Request(url, data=json.dumps(payload).encode(), headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urlopen(request, timeout=10) as response:
            return json.load(response)
    except HTTPError as error:
        detail = error.read().decode()
        raise RuntimeError(f"HTTP {error.code}: {detail}") from error
    except URLError as error:
        raise RuntimeError(f"Cannot reach inventory API: {error}") from error


def main() -> int:
    parser = argparse.ArgumentParser(description="RFID burst and idempotency simulator")
    parser.add_argument("--url", default="http://127.0.0.1:8080/api/v1/inventory/observations")
    parser.add_argument("--site", default="store-07")
    parser.add_argument("--pool", default="store-07.floor")
    parser.add_argument("--device", default="RFID-HH-07-SIM")
    parser.add_argument("--session", default=f"SIM-{uuid.uuid4()}")
    parser.add_argument("--epc", default="EPC00000007")
    parser.add_argument("--reads", type=int, default=80)
    parser.add_argument("--retry", action="store_true", help="send the identical key and payload twice")
    args = parser.parse_args()
    if args.reads < 1:
        parser.error("--reads must be positive")
    payload = {
        "site_id": args.site,
        "pool": args.pool,
        "device_id": args.device,
        "reader_session_id": args.session,
        "observed_at": datetime.now(timezone.utc).isoformat(),
        "idempotency_key": f"sim-{uuid.uuid4()}",
        "observations": [
            {"epc": args.epc, "rssi": -46, "antenna": "A1", "read_count": 1},
            {"epc": args.epc, "rssi": -53, "antenna": "A1", "read_count": args.reads - 1},
            {"epc": "EPC00000002", "rssi": -61, "read_count": 1},
            {"epc": "EPC00000003", "read_count": 1},
        ],
    }
    first = post(args.url, payload)
    print("FIRST RESPONSE")
    print(json.dumps(first, indent=2))
    if args.retry:
        second = post(args.url, payload)
        print("\nIDENTICAL RETRY RESPONSE")
        print(json.dumps(second, indent=2))
        if first != second:
            print("ERROR: idempotent retry returned a different result", file=sys.stderr)
            return 1
    print(f"\n{args.reads} raw reads for {args.epc} were sent as one consolidated EPC sighting candidate.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except RuntimeError as error:
        print(error, file=sys.stderr)
        raise SystemExit(1)
