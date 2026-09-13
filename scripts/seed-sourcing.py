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

Re-running is safe, and it CONVERGES. Every write carries a fixed
Idempotency-Key, so the server replays its first answer rather than creating a
second copy; an item that is already there but carries the wrong division or
tags is patched rather than skipped. That matters because those two fields are
`#[serde(default)]` on the wire: a node running a build that predates them
accepts the item, answers 201, and silently drops both. Skipping such an item
on the next run would leave it wrong forever.

For the same reason this stops at the FIRST item that comes back unclassified
after being sent a division. One wrong row is a thing to fix; 2806 of them,
written at full speed against a stale deploy, is a catalogue nobody can trust
and that no re-run repairs.

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


def call(method, path, body=None, token=None, idempotency_key=None, if_match=None):
    data = None if body is None else json.dumps(body).encode()
    request = urllib.request.Request(f"{API}{path}", data=data, method=method)
    if data is not None:
        request.add_header("content-type", "application/json")
    if token is not None:
        request.add_header("authorization", f"Bearer {token}")
    if idempotency_key is not None:
        request.add_header("idempotency-key", idempotency_key)
    if if_match is not None:
        request.add_header("if-match", f'"{if_match}"')
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


def classification_of(item):
    """The two fields this script exists to get right, comparably."""
    return (item.get("division_code"), tuple(sorted(item.get("tags") or [])))


def existing_suppliers(token):
    """Business code to id, for suppliers already on the node.

    Looked up once rather than per supplier: 28 lookups to discover 28 ids is
    28 round trips to learn what one answer already contains.
    """
    status, body = call("GET", "/api/v1/suppliers?limit=500", token=token)
    if status != 200:
        return {}
    rows = body if isinstance(body, list) else body.get("rows", body.get("items", []))
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
    created = skipped = repaired = refused = 0
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

        # The sourcing search, not the supplier's own item list: only this one
        # populates `tags` (see search_supplier_items), and comparing against a
        # list that always reports no tags would patch every row on every run.
        # Its limit caps at 500, which one supplier's ~101 items sit well under.
        status, rows = call(
            "GET",
            f"/api/v1/supplier-items?supplier_id={supplier_id}&limit=500",
            token=token,
        )
        have = (
            {row["item"]["supplier_item_code"]: row["item"] for row in rows}
            if status == 200 and isinstance(rows, list)
            else {}
        )

        for item in supplier["items"]:
            item_code = item["supplier_item_code"]
            wanted = classification_of(item)
            present = have.get(item_code)

            if present is not None:
                if classification_of(present) == wanted:
                    skipped += 1
                    continue
                status, response = call(
                    "PATCH",
                    f"/api/v1/supplier-items/{present['supplier_item_id']}",
                    {"division_code": item["division_code"], "tags": item["tags"]},
                    token=token,
                    idempotency_key=(
                        # Not the same key as the create, and versioned, so a
                        # second repair after a third change is not replayed as
                        # the first one.
                        f"seed-sourcing-fix-{item_code}-v{present['version']}"
                    ),
                    if_match=present["version"],
                )
                if status == 200:
                    repaired += 1
                else:
                    refused += 1
                    if refused <= 5:
                        print(f"  ! {item_code} repair refused ({status}): {response}")
                continue

            status, response = call(
                "POST",
                f"/api/v1/suppliers/{supplier_id}/items",
                item,
                token=token,
                idempotency_key=f"seed-sourcing-item-{item_code}",
            )
            if status not in (200, 201):
                refused += 1
                # Print the first few in full: one recognisable failure is worth
                # more than a count, and 2806 of them would bury it.
                if refused <= 5:
                    print(f"  ! {item_code} refused ({status}): {response}")
                continue
            created += 1
            if classification_of(response) != wanted:
                sys.exit(
                    f"\n{item_code} was accepted but came back "
                    f"{classification_of(response)} instead of {wanted}.\n"
                    f"{API} is running a build that predates division_code and "
                    f"tags on supplier items, and is dropping them silently.\n"
                    f"Stopping after one item rather than writing 2806 wrong "
                    f"ones. Deploy first, then run this again — it will patch "
                    f"this item rather than skip it."
                )
        print(
            f"{code} {supplier['name']:<32} "
            f"{created:>5} created  {repaired:>5} repaired  "
            f"{skipped:>5} present  {refused:>4} refused"
        )

    elapsed = time.monotonic() - started
    print(
        f"\n{created} created, {repaired} repaired, {skipped} already correct, "
        f"{refused} refused in {elapsed:.0f}s"
    )
    if refused:
        print("Refusals above are not retried; fix the cause and re-run — writes are idempotent.")
    return 1 if refused else 0


if __name__ == "__main__":
    raise SystemExit(main())
