#!/usr/bin/env python3
"""Send device-authenticated, retry-safe RFID bursts to a Store/DC Edge."""
import argparse
import hashlib
import hmac
import json
import os
import sys
import time
import uuid
from datetime import datetime, timezone
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


RFID_PATH = "/api/v1/rfid/observations"


def sign(device_key: str, device_id: str, timestamp: int, sequence: int, body: bytes) -> str:
    # Registration returns device_key once. The Edge policy contains only this
    # derived signing key, so the enrolment key itself never leaves the reader.
    signing_key = hashlib.sha256(device_key.strip().encode()).hexdigest().encode()
    body_digest = hashlib.sha256(body).hexdigest()
    canonical = f"POST\n{RFID_PATH}\n{device_id}\n{timestamp}\n{sequence}\n{body_digest}"
    return hmac.new(signing_key, canonical.encode(), hashlib.sha256).hexdigest()


def post(url: str, body: bytes, headers: dict) -> dict:
    request = Request(
        url,
        data=body,
        headers={"Content-Type": "application/json", **headers},
        method="POST",
    )
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
    parser.add_argument("--url", default=f"http://127.0.0.1:8082{RFID_PATH}")
    parser.add_argument("--site", default="store-07")
    parser.add_argument("--pool", default="store-07.floor")
    parser.add_argument("--device", default="RFID-HH-07-SIM")
    parser.add_argument(
        "--device-key",
        default=os.environ.get("RFID_DEVICE_KEY"),
        help="one-time enrolment key (or set RFID_DEVICE_KEY)",
    )
    parser.add_argument(
        "--sequence",
        type=int,
        default=None,
        help="strictly increasing per-device sequence (default: Unix milliseconds)",
    )
    parser.add_argument(
        "--token",
        default=os.environ.get("RFID_OPERATOR_TOKEN"),
        help="optional Edge human bearer session for operator attribution",
    )
    parser.add_argument("--session", default=f"SIM-{uuid.uuid4()}")
    parser.add_argument("--epc", default="EPC00000007")
    parser.add_argument("--reads", type=int, default=80)
    parser.add_argument("--retry", action="store_true", help="send the identical key and payload twice")
    args = parser.parse_args()
    if args.reads < 1:
        parser.error("--reads must be positive")
    if not args.device_key:
        parser.error("--device-key or RFID_DEVICE_KEY is required")
    device_id = args.device.strip().upper()
    sequence = args.sequence if args.sequence is not None else int(time.time() * 1000)
    if sequence < 1:
        parser.error("--sequence must be positive")
    payload = {
        "site_id": args.site,
        "pool": args.pool,
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
    body = json.dumps(payload, separators=(",", ":")).encode()
    timestamp = int(time.time())
    headers = {
        "X-Device-Id": device_id,
        "X-Device-Timestamp": str(timestamp),
        "X-Device-Sequence": str(sequence),
        "X-Device-Signature": sign(
            args.device_key, device_id, timestamp, sequence, body
        ),
    }
    if args.token:
        headers["Authorization"] = f"Bearer {args.token}"
    first = post(args.url, body, headers)
    print("FIRST RESPONSE")
    print(json.dumps(first, indent=2))
    if args.retry:
        second = post(args.url, body, headers)
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
