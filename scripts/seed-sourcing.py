#!/usr/bin/env python3
"""Load data/sourcing-seed.json into a Cloud node, so sourcing has a real
catalogue to browse.

    ITULAH_API=http://127.0.0.1:8080 python3 scripts/seed-sourcing.py

Build the file first with `scripts/build-sourcing-seed.py`. This script only
transmits it; every decision about what the catalogue contains lives there.

Sibling of `seed-catalogue.py`, which plants five items with placeholder
photographs. That one is for proving the screens exist. This one is 2806 items
across 28 suppliers with real photographs, which is the first size at which
faceted filtering, supplier grouping and the price slider are worth looking at
— at five rows every filter looks like it works.

Re-running is safe. Every write carries a fixed Idempotency-Key, so the server
replays its first answer rather than creating a second copy, and existing items
are skipped without being asked for.

The password is never an argument and never written down: it is read from
ITULAH_PASSWORD if set, and otherwise prompted for without echo.
"""

from __future__ import annotations

import json
import os
import pathlib
import sys
import time
import urllib.error
import urllib.request
from getpass import getpass

ROOT = pathlib.Path(__file__).resolve().parent.parent
SEED = ROOT / "data" / "sourcing-seed.json"
API = os.environ.get("ITULAH_API", "http://127.0.0.1:8080").rstrip("/")
USERNAME = os.environ.get("ITULAH_USER", "admin")


def call(method, path, body=None, token=None, idempotency_key=None):
    data = None if body is None else json.dumps(body).encode()
    request = urllib.request.Request(f"{API}{path}", data=data, method=method)
    if data is not None:
        request.add_header("content-type", "application/json")
    if token is not None:
        request.add_header("authorization", f"Bearer {token}")
    if idempotency_key is not None:
        request.add_header("idempotency-key", idempotency_key)
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            raw = response.read()
            return response.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as error:
        raw = error.read()
        try:
            return error.code, json.loads(raw)
        except ValueError:
            return error.code, {"error": raw.decode(errors="replace")[:200]}
    except urllib.error.URLError as error:
        sys.exit(f"Could not reach {API}: {error.reason}")


def sign_in():
    status, health = call("GET", "/api/v1/health")
    if status != 200:
        sys.exit(f"{API} did not answer /api/v1/health ({status}).")
    if health.get("auth") != "enabled":
        print(f"! {API} is running WITHOUT authentication — seeding unauthenticated.")
        return None
    password = os.environ.get("ITULAH_PASSWORD") or getpass(
        f"Password for {USERNAME} at {API}: "
    )
    status, body = call(
        "POST", "/api/v1/auth/login", {"username": USERNAME, "password": password}
    )
    if status != 200:
        sys.exit(f"Sign-in failed ({status}): {body.get('error', body)}")
    print(f"Signed in as {body['user']['display_name']} ({body['user']['role']}).")
    return body["token"]


def existing_suppliers(token):
    """Business code to id, for suppliers already on the node.

    Looked up once rather than per supplier: 28 lookups to discover 28 ids is
    28 round trips to learn what one answer already contains.
    """
    status, body = call("GET", "/api/v1/suppliers?limit=500", token=token)
    if status != 200:
        return {}
    rows = body if isinstance(body, list) else body.get("items", [])
    return {row["supplier_code"]: row["supplier_id"] for row in rows}


def main() -> int:
    if not SEED.exists():
        sys.exit(f"{SEED} is missing — run scripts/build-sourcing-seed.py first.")
    seed = json.loads(SEED.read_text())
    print(seed["note"])
    print(
        f"\n{seed['item_count']} items across {seed['supplier_count']} suppliers "
        f"-> {API}\n"
    )
    token = sign_in()
    known = existing_suppliers(token)

    started = time.monotonic()
    created = skipped = refused = 0
    for supplier in seed["suppliers"]:
        code = supplier["supplier_code"]
        supplier_id = known.get(code)
        if supplier_id is None:
            body = {key: value for key, value in supplier.items() if key != "items"}
            status, response = call(
                "POST",
                "/api/v1/suppliers",
                body,
                token=token,
                idempotency_key=f"seed-sourcing-supplier-{code}",
            )
            if status not in (200, 201):
                sys.exit(f"Could not create supplier {code} ({status}): {response}")
            supplier_id = response["supplier_id"]

        status, items = call(
            "GET", f"/api/v1/suppliers/{supplier_id}/items?limit=500", token=token
        )
        rows = items if isinstance(items, list) else (items or {}).get("items", [])
        have = {row["supplier_item_code"] for row in rows} if status == 200 else set()

        for item in supplier["items"]:
            item_code = item["supplier_item_code"]
            if item_code in have:
                skipped += 1
                continue
            status, response = call(
                "POST",
                f"/api/v1/suppliers/{supplier_id}/items",
                item,
                token=token,
                idempotency_key=f"seed-sourcing-item-{item_code}",
            )
            if status in (200, 201):
                created += 1
            else:
                refused += 1
                # Print the first few in full: one recognisable failure is worth
                # more than a count, and 2806 of them would bury it.
                if refused <= 5:
                    print(f"  ! {item_code} refused ({status}): {response}")
        print(
            f"{code} {supplier['name']:<32} "
            f"{created:>5} created  {skipped:>5} present  {refused:>4} refused"
        )

    elapsed = time.monotonic() - started
    print(f"\n{created} created, {skipped} already there, {refused} refused in {elapsed:.0f}s")
    if refused:
        print("Refusals above are not retried; fix the cause and re-run — writes are idempotent.")
    return 1 if refused else 0


if __name__ == "__main__":
    raise SystemExit(main())
