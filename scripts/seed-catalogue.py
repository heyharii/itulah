#!/usr/bin/env python3
"""Put a small supplier catalogue into a Cloud node, so the buying screens have
something to show.

Sourcing and the PO draft are built on real rows: a catalogue purchase order is
raised against `supplier_item_id`s, so a node with no supplier items cannot be
used to test either screen — the screens are correct and the database is empty,
which looks the same from the browser. This writes the smallest catalogue that
exercises both.

    ITULAH_API=https://itulah-cloud.onrender.com python3 scripts/seed-catalogue.py

The password is never an argument and never written down: it is read from
ITULAH_PASSWORD if set, and otherwise prompted for without echo. Passing it on
the command line would put it in your shell history and in the process list.

Re-running is safe. Every write carries a fixed Idempotency-Key, so the server
replays its first answer instead of creating a second copy.

The photo URLs are illustrative and hosted elsewhere. One item deliberately has
none: a candidate with no reference photo is one procurement cannot put on a PO
line, and the screens should be tested against that state too.
"""

import json
import os
import sys
import urllib.error
import urllib.request
from getpass import getpass

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
        # Wrong URL, node asleep, no network. A stack trace here tells the
        # person running this nothing they can act on; the address does.
        sys.exit(f"Could not reach {API}: {error.reason}")


def sign_in():
    """A Bearer token, or None when the node is running without authentication.

    The token path is the one the server documents for native and CLI callers.
    A browser uses the cookie instead and must also echo the CSRF cookie in a
    header; a script has no cross-site request forgery to worry about, so it
    takes the simpler road the server already offers.
    """
    status, health = call("GET", "/api/v1/health")
    if status != 200:
        sys.exit(f"{API} did not answer /api/v1/health ({status}).")
    # The node shouts this one in capitals on purpose — see cloud/http/mod.rs.
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


SUPPLIERS = [
    {
        "key": "PTKAI",
        "body": {
            "supplier_code": "PTKAI",
            "name": "PT Kain Anugerah",
            "contact_name": "Rina Kusuma",
            "phone": "+62811000111",
            "email": "rina@kainanugerah.co.id",
            "address": "Jl. Soekarno-Hatta 210, Bandung",
            "status": "ACTIVE",
        },
        "items": [
            {
                "supplier_item_code": "KA-TEE-001",
                "name": "Kaos katun combed 30s",
                "description": "Body kaos combed 30s, jahit rantai",
                "image_url": "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=600",
                "unit_price_minor": 48000,
                "currency": "IDR",
                "internal_article_code": None,
                "status": "ACTIVE",
            },
            {
                "supplier_item_code": "KA-KEM-010",
                "name": "Kemeja flanel kotak",
                "description": "Flanel katun, kancing depan",
                "image_url": "https://images.unsplash.com/photo-1602810318383-e386cc2a3ccf?w=600",
                "unit_price_minor": 135000,
                "currency": "IDR",
                "internal_article_code": None,
                "status": "ACTIVE",
            },
            {
                "supplier_item_code": "KA-HOD-004",
                "name": "Hoodie fleece 320gsm",
                "description": "Fleece tebal, kanguru pocket",
                "image_url": None,
                "unit_price_minor": 189000,
                "currency": "IDR",
                "internal_article_code": None,
                # One inactive row on purpose: the Status facet has nothing to
                # filter if every item is in line.
                "status": "INACTIVE",
            },
        ],
    },
    {
        "key": "DENIMCO",
        "body": {
            "supplier_code": "DENIMCO",
            "name": "Denim Co Nusantara",
            "contact_name": "Bagus Pratama",
            "phone": None,
            "email": None,
            "address": "Jl. Raya Bogor KM 30, Bogor",
            "status": "ACTIVE",
        },
        "items": [
            {
                "supplier_item_code": "DN-JNS-100",
                "name": "Celana jeans slim fit",
                "description": "Denim 12oz, non-stretch",
                "image_url": "https://images.unsplash.com/photo-1542272604-787c3835535d?w=600",
                "unit_price_minor": 215000,
                "currency": "IDR",
                "internal_article_code": None,
                "status": "ACTIVE",
            },
            {
                "supplier_item_code": "DN-JKT-200",
                "name": "Jaket denim wash",
                "description": None,
                "image_url": "https://images.unsplash.com/photo-1516257984-b1b4d707412e?w=600",
                "unit_price_minor": 320000,
                "currency": "IDR",
                "internal_article_code": None,
                "status": "ACTIVE",
            },
        ],
    },
]


def main():
    token = sign_in()

    # A second supplier with the same code is a conflict, not a new supplier, so
    # an existing catalogue is read rather than rewritten.
    status, existing = call("GET", "/api/v1/suppliers", token=token)
    if status != 200:
        sys.exit(f"Could not list suppliers ({status}): {existing}")
    # An envelope, since the supplier list grew a cursor. Both shapes are
    # accepted because this script is run against deployed nodes as well as
    # this tree, and the failure mode of getting it wrong is silent: iterating
    # a dict yields its KEYS, so every supplier would look absent and be
    # created again.
    rows = existing if isinstance(existing, list) else existing.get("rows", [])
    by_code = {supplier["supplier_code"]: supplier for supplier in rows}

    for supplier in SUPPLIERS:
        code = supplier["key"]
        if code in by_code:
            supplier_id = by_code[code]["supplier_id"]
            print(f"= supplier {code} already there")
        else:
            status, body = call(
                "POST",
                "/api/v1/suppliers",
                supplier["body"],
                token=token,
                idempotency_key=f"seed-supplier-{code}",
            )
            if status not in (200, 201):
                sys.exit(f"Could not create supplier {code} ({status}): {body}")
            supplier_id = body["supplier_id"]
            print(f"+ supplier {code} {supplier_id}")

        status, items = call(
            "GET", f"/api/v1/suppliers/{supplier_id}/items", token=token
        )
        # The listing grew a cursor envelope, `{items, limit, next_cursor}`,
        # after this script was written. Accept both shapes: a bare list read
        # as an envelope yields its keys, and the set of codes then silently
        # matches nothing, so every item is created a second time.
        listed = items.get("items", []) if isinstance(items, dict) else (items or [])
        have = {item["supplier_item_code"] for item in listed} if status == 200 else set()

        for item in supplier["items"]:
            item_code = item["supplier_item_code"]
            if item_code in have:
                print(f"  = item {item_code} already there")
                continue
            status, body = call(
                "POST",
                f"/api/v1/suppliers/{supplier_id}/items",
                item,
                token=token,
                idempotency_key=f"seed-item-{item_code}",
            )
            if status not in (200, 201):
                print(f"  ! item {item_code} refused ({status}): {body}")
                continue
            print(f"  + item {item_code}")

    status, sourced = call("GET", "/api/v1/supplier-items?limit=200", token=token)
    count = len(sourced) if status == 200 and isinstance(sourced, list) else "?"
    print(f"\nSourcing now answers with {count} candidates.")

    # A purchase order has to be delivered somewhere, and the draft screen fills
    # its "Deliver to" list from the registered sync origins. Registering one is
    # a different job with a different key, so this only reports the state.
    status, origins = call("GET", "/api/v1/sync/origins", token=token)
    if status == 200:
        usable = [
            origin
            for origin in origins.get("items", [])
            if origin.get("inventory_enabled")
            and origin.get("site_id")
            and origin.get("node_role") != "CLOUD"
        ]
        if usable:
            print(
                "Deliverable sites: "
                + ", ".join(f"{o['site_id']} ({o['node_role']})" for o in usable)
            )
        else:
            print(
                "No site can receive a delivery yet: register a DC or STORE origin\n"
                "(POST /api/v1/sync/origins with the master x-sync-key) or the PO\n"
                "draft will have nothing in its Deliver to list."
            )


if __name__ == "__main__":
    main()
