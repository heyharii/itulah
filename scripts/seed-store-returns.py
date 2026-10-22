#!/usr/bin/env python3
"""Seed store returns on the demo rig so the hub's two return screens show
every stage: Merchandise › Return HO (/allotment/returns) and Ops › Return
from Store (/operations/board/returns).

Only a store with a live node can send a return (the node's "Sent" tap picks,
packs and puts it on a trip), so every return here comes from store-01
(:8182). The Gudang lives in the cloud (DC_HOSTING=cloud), so receiving and
inspection go to the cloud's /api/v1/dc/* routes.

Stages seeded, oldest first:
  1. asked, not sent             → Return HO only (Not shipped yet)
  2. sent ×2                     → On the way
  3. sent + receive-counted      → Receive count / In review
  4. sent + counted + inspected  → Received (one damaged tag to reject)

    python3 scripts/seed-store-returns.py [--cloud URL] [--store URL]
"""

import argparse
import json
import sys
import time
import uuid
import urllib.error
import urllib.request
from http.cookiejar import CookieJar


class Client:
    def __init__(self, base, username, password):
        self.base = base.rstrip("/")
        self.opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(CookieJar())
        )
        self.token = None
        self.token = self.call(
            "POST", "/api/v1/auth/login", {"username": username, "password": password}
        )["token"]

    def call(self, method, path, body=None):
        data = None if body is None else json.dumps(body).encode()
        request = urllib.request.Request(self.base + path, data=data, method=method)
        request.add_header("content-type", "application/json")
        if self.token:
            request.add_header("authorization", f"Bearer {self.token}")
        try:
            with self.opener.open(request, timeout=60) as response:
                raw = response.read()
                return json.loads(raw) if raw else {}
        except urllib.error.HTTPError as error:
            sys.exit(f"{method} {path} → {error.code} {error.read().decode()[:400]}")


def key():
    return str(uuid.uuid4())


def wait_for(what, check, timeout=90):
    deadline = time.time() + timeout
    while time.time() < deadline:
        found = check()
        if found:
            return found
        time.sleep(2)
    sys.exit(f"timed out waiting for {what}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--cloud", default="http://127.0.0.1:8180")
    parser.add_argument("--store", default="http://127.0.0.1:8182")
    parser.add_argument("--store-id", default="store-01")
    parser.add_argument("--user", default="admin")
    parser.add_argument("--password", default="Password01")
    args = parser.parse_args()

    cloud = Client(args.cloud, args.user, args.password)
    store = Client(args.store, args.user, args.password)

    pools = cloud.call("GET", "/api/v1/inventory/fleet-pools")["items"]
    ho = next(
        (p["site_id"] for p in pools if p["site_kind"] == "HO" and p["pool_code"] == "WAREHOUSE"),
        "dc",
    )

    # What the store holds, one entry per piece, so returns never ask for more
    # than is there.
    pieces = []
    for code in ("FLOOR", "WAREHOUSE"):
        pool_id = f"{args.store_id}.{code.lower()}"
        stock = cloud.call(
            "GET", f"/api/v1/inventory/availability?source_pool_id={pool_id}&limit=500"
        )["items"]
        for item in stock:
            pieces += [(pool_id, item["sku_id"], item["sku_code"])] * max(item["on_hand_qty"], 0)
    print(f"{args.store_id} holds {len(pieces)} pcs")

    plan = [("asked", 2), ("on-way", 3), ("on-way", 2), ("counted", 3), ("inspected", 3)]
    if len(pieces) < sum(n for _, n in plan):
        sys.exit(f"{args.store_id} needs {sum(n for _, n in plan)} pcs, holds {len(pieces)}")

    made = []
    for stage, size in plan:
        take, pieces = pieces[:size], pieces[size:]
        lines = {}
        for pool_id, sku_id, _ in take:
            lines[(pool_id, sku_id)] = lines.get((pool_id, sku_id), 0) + 1
        allotment = cloud.call(
            "POST",
            "/api/v1/inventory/allotments",
            {
                "type": "RETURN_TO_DC",
                "lines": [
                    {
                        "source_site_id": args.store_id,
                        "source_pool_id": pool_id,
                        "destination_type": "DC",
                        "destination_id": ho,
                        "sku_id": sku_id,
                        "quantity": qty,
                    }
                    for (pool_id, sku_id), qty in lines.items()
                ],
                "notes": None,
                "actor_id": args.user,
                "idempotency_key": key(),
            },
        )
        record = allotment.get("allotment", allotment)
        sent_codes = {}
        for _, _, code in take:
            sent_codes[code] = sent_codes.get(code, 0) + 1
        made.append(
            [stage, record["id"], record.get("number") or record.get("allotment_number"), sent_codes, None]
        )
        print(f"  {made[-1][2]}  {size} pcs  → {stage}")

    # The node learns of each ask by sync; send every one that should travel.
    for entry in made:
        stage, allotment_id, number = entry[:3]
        if stage == "asked":
            continue
        wait_for(
            f"{number} on the store node",
            lambda: any(
                ask["allotment_id"] == allotment_id
                for ask in store.call("GET", "/api/v1/store/return-requests")["items"]
            ),
        )
        sent = store.call(
            "POST",
            f"/api/v1/store/return-requests/{allotment_id}/send",
            {"idempotency_key": key()},
        )
        entry[4] = sent.get("shipment_number")
        print(f"  {number} sent as {entry[4]}")

    # Each trip reaches the Gudang as an IN_TRANSIT delivery once it syncs.
    # The delivery carries the shipment number the send returned.
    def deliveries():
        return cloud.call("GET", "/api/v1/dc/inbound?status=ALL")["deliveries"]

    for stage, allotment_id, number, sent_codes, shipment in made:
        if stage not in ("counted", "inspected"):
            continue
        delivery = wait_for(
            f"{number} at the Gudang",
            lambda: next(
                (
                    d
                    for d in deliveries()
                    if d["status"] == "IN_TRANSIT"
                    and d.get("shipment_reference") == shipment
                ),
                None,
            ),
        )
        # Blind while IN_TRANSIT: count exactly what the store sent.
        counts = sent_codes
        cloud.call(
            "POST",
            f"/api/v1/dc/inbound/{delivery['delivery_id']}/receive-count",
            {
                "counts": [{"sku_code": c, "quantity": q} for c, q in counts.items()],
                "actor_id": args.user,
                "idempotency_key": key(),
            },
        )
        print(f"  {number} counted at the Gudang")
        if stage == "inspected":
            inspection = cloud.call(
                "GET", f"/api/v1/dc/inbound/{delivery['delivery_id']}/inspection"
            )
            epcs = [
                unit.get("epc")
                for unit in inspection["units"]
            ]
            cloud.call(
                "POST",
                f"/api/v1/dc/inbound/{delivery['delivery_id']}/inspection",
                {
                    "damaged_epcs": epcs[:1],
                    "actor_id": args.user,
                    "idempotency_key": key(),
                },
            )
            print(f"  {number} inspected ({len(epcs[:1])} damaged)")

    print(f"done: {len(deliveries())} deliveries at the Gudang")


if __name__ == "__main__":
    main()
