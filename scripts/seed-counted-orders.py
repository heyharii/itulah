#!/usr/bin/env python3
"""Leave some open purchase orders counted at the DC and waiting for the buyer.

    DEMO_PASSWORD=Password01 python3 scripts/seed-counted-orders.py \
        --cloud http://127.0.0.1:8480 --dc http://127.0.0.1:8481 --orders 8

The Gudang (nina) counts the goods of an order that nothing has been received
against yet, and the count is NOT verified: it waits in the buyer's queue, so
the order list shows "Review count" on those rows and the order's sheet offers
it. Most counts match the order; every third has a line counted short and
every fifth a line counted over, so the review has something to decide.

Re-running is safe: an order that already has a count is skipped.
"""

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
import uuid


class Node:
    def __init__(self, base, token=None):
        self.base, self.token = base.rstrip("/"), token

    def call(self, method, path, body=None, ok=(200, 201)):
        data = None if body is None else json.dumps(body).encode()
        request = urllib.request.Request(self.base + path, data=data, method=method)
        request.add_header("content-type", "application/json")
        if self.token:
            request.add_header("Authorization", f"Bearer {self.token}")
        if method != "GET":
            request.add_header("Idempotency-Key", str(uuid.uuid4()))
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                raw = response.read()
                status, payload = response.status, (json.loads(raw) if raw else None)
        except urllib.error.HTTPError as error:
            raw = error.read()
            try:
                status, payload = error.code, json.loads(raw)
            except ValueError:
                status, payload = error.code, raw[:200].decode("utf-8", "replace")
        if ok and status not in ok:
            raise SystemExit(f"{self.base} {method} {path} → {status}: {payload}")
        return payload

    def get(self, path):
        return self.call("GET", path)

    def post(self, path, body):
        return self.call("POST", path, body)

    def login(self, username, password):
        payload = self.call("POST", "/api/v1/auth/login",
                            {"username": username, "password": password})
        return Node(self.base, payload["token"])


def rows(payload):
    if isinstance(payload, list):
        return payload
    for key in ("items", "rows", "data", "results"):
        if isinstance(payload.get(key), list):
            return payload[key]
    return []


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--cloud", default="http://127.0.0.1:8480")
    parser.add_argument("--dc", default="http://127.0.0.1:8481")
    parser.add_argument("--password", default=os.environ.get("DEMO_PASSWORD", "Password01"))
    parser.add_argument("--orders", type=int, default=8)
    args = parser.parse_args()

    cloud, dc = Node(args.cloud), Node(args.dc)
    rina_c = cloud.login("rina", args.password)
    rina_d = dc.login("rina", args.password)
    nina = dc.login("nina", args.password)

    book = rows(rina_c.get("/api/v1/purchase-orders?limit=500"))
    open_orders = [
        po for po in book
        if po["lifecycle"] == "ACTIVE" and "-OPE" in po["po_number"]
    ]
    # One order per supplier first, so the list shows the state across the
    # book rather than eight counts at one supplier.
    seen, picked = set(), []
    for po in sorted(open_orders, key=lambda p: p["po_number"]):
        if po["supplier_id"] not in seen:
            seen.add(po["supplier_id"])
            picked.append(po)
    for po in sorted(open_orders, key=lambda p: p["po_number"]):
        if po not in picked:
            picked.append(po)
    picked = picked[: args.orders]

    dc_lines = rows(rina_d.get("/api/v1/dc/purchase-orders?limit=1000"))
    counted = 0
    for index, po in enumerate(picked, start=1):
        detail = rina_c.get(f"/api/v1/purchase-orders/{po['purchase_order_id']}")
        ordered = {l["article_code"]: l for l in detail["lines"]}
        lines = [l for l in dc_lines if l.get("po_number") == po["po_number"]]
        if len(lines) < len(ordered):
            print(f"  ! {po['po_number']} has not reached the DC yet; skipped")
            continue
        if any((l.get("received_stock_units") or 0) > 0 for l in lines):
            print(f"  = {po['po_number']} already has a count")
            continue
        receipt = nina.post("/api/v1/dc/goods-receipts", {
            "supplier_id": po["supplier_id"], "actor_id": "nina",
            "idempotency_key": str(uuid.uuid4())})
        for position, line in enumerate(lines):
            want = ordered[line["article_code"]]["expected_stock_units"]
            count = want
            wrong = 0
            if index % 3 == 0 and position == 0:
                count = max(1, want - 2)      # short
            elif index % 5 == 0 and position == len(lines) - 1:
                count = want + 3              # over
            elif index % 4 == 0 and position == len(lines) - 1:
                # Pieces of another article in the carton: counted, named as
                # not matching, and returned to the supplier at review.
                count = want + 2
                wrong = 2
            nina.post("/api/v1/dc/purchase-counts", {
                "receipt_id": receipt["receipt_id"], "po_line_id": line["po_line_id"],
                "counted_quantity": count, "wrong_quantity": wrong,
                "actor_id": "nina",
                "idempotency_key": str(uuid.uuid4())})
        counted += 1
        print(f"  counted {po['po_number']} ({len(lines)} lines), waiting for review")
    print(f"  {counted} orders left counted and unverified")


if __name__ == "__main__":
    sys.exit(main())
