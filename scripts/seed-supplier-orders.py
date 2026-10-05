#!/usr/bin/env python3
"""Give every supplier that has a catalogue a book of orders to look at: some
still open (each line carrying the date it was promised, one of them late),
some received in full at the DC, some cancelled.

    DEMO_PASSWORD=Password01 python3 scripts/seed-supplier-orders.py \
        --cloud http://127.0.0.1:8480 --dc http://127.0.0.1:8481

Goes through the routes the apps use: the buyer (rina) places the order, the
DC (nina) counts it, the buyer verifies it and Finance (yusuf) files the
invoice. Re-running is safe: an order number already there is skipped.
Orders from `seed` earlier that carry no promised date are cancelled once, so
the open book reads the same for every supplier.
"""

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
import uuid
from datetime import date, timedelta


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


# A catalogue for a supplier that has none, so it has something to order.
FALLBACK_ITEMS = [
    ("ST-SNK-01", "Sneakers Kulit Pria", 185000, "SANDAL_SEPATU", ["SEPATU"], ["BLACK", "WHITE"], ["05", "06", "07", "08"]),
    ("ST-SDL-02", "Sandal Gunung", 98000, "SANDAL_SEPATU", ["SEPATU"], ["BLACK", "BROWN"], ["04", "05", "06", "07"]),
    ("ST-LOF-03", "Loafers Suede", 215000, "SANDAL_SEPATU", ["FORMAL", "SEPATU"], ["BROWN", "BLACK"], ["05", "06", "07", "08"]),
]

# (open orders, received orders, cancelled orders) per supplier, and how many
# pieces a line asks for. Spread so the supplier sheets do not read alike.
SHAPES = [(7, 3, 6), (6, 2, 7), (8, 2, 2), (6, 4, 6), (7, 3, 3), (5, 2, 6), (6, 3, 2), (8, 2, 7), (6, 3, 6)]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--cloud", default="http://127.0.0.1:8480")
    parser.add_argument("--dc", default="http://127.0.0.1:8481")
    parser.add_argument("--password", default=os.environ.get("DEMO_PASSWORD", "Password01"))
    args = parser.parse_args()

    cloud, dc = Node(args.cloud), Node(args.dc)
    rina_c = cloud.login("rina", args.password)
    rina_d = dc.login("rina", args.password)
    nina = dc.login("nina", args.password)
    yusuf = dc.login("yusuf", args.password)

    suppliers = sorted(rows(rina_c.get("/api/v1/suppliers?limit=200")), key=lambda s: s["supplier_code"])
    have = {po["po_number"]: po for po in rows(rina_c.get("/api/v1/purchase-orders?limit=500"))}

    # Earlier seed orders with no promised date on their lines: call them off
    # once (nothing was received against them), so only dated ones stay open.
    called_off = 0
    for po in have.values():
        if (po["po_number"].startswith("PO-DEMO-") and po["po_number"] >= "PO-DEMO-003"
                and po.get("lifecycle") == "ACTIVE" and not po.get("expected_arrival")):
            rina_c.post(f"/api/v1/purchase-orders/{po['purchase_order_id']}/cancel",
                        {"reason": "Replaced by a dated order"})
            called_off += 1
    print(f"  called off {called_off} undated orders")

    today = date.today()
    book = 0
    for index, supplier in enumerate(suppliers):
        code = supplier["supplier_code"]
        items = [i.get("item", i) for i in rows(
            rina_c.get(f"/api/v1/suppliers/{supplier['supplier_id']}/items?limit=50"))]
        items = [i for i in items if i["status"] == "ACTIVE" and i["supplier_item_code"] != "GM-TST-01"]
        if not items and supplier["name"].startswith("Sepatu Top Ten"):
            for c, name, price, div, tags, colours, sizes in FALLBACK_ITEMS:
                rina_c.post(f"/api/v1/suppliers/{supplier['supplier_id']}/items", {
                    "supplier_item_code": c, "name": name, "description": None, "image_url": None,
                    "unit_price_minor": price, "currency": "IDR", "internal_article_code": None,
                    "status": "ACTIVE", "division_code": div, "tags": tags,
                    "colour_codes": colours, "size_codes": sizes})
            items = [i.get("item", i) for i in rows(
                rina_c.get(f"/api/v1/suppliers/{supplier['supplier_id']}/items?limit=50"))]
        if not items:
            continue
        opened, received, cancelled = SHAPES[index % len(SHAPES)]
        plan = ([("open", n) for n in range(opened)] + [("received", n) for n in range(received)]
                + [("cancelled", n) for n in range(cancelled)])
        for kind, n in plan:
            number = f"PO-{code.replace('SUP-', '')}-{kind[:3].upper()}{n + 1}"
            if number in have:
                continue
            picked = [items[(n + k) % len(items)] for k in range(2 + (n % 2))]
            # One open order per supplier is already late; the rest are due
            # over the coming weeks.
            promised = today - timedelta(days=4) if (kind == "open" and n == 0 and index % 3 == 0) \
                else today + timedelta(days=5 + 6 * n + index % 4)
            lines = [{
                "article_code": it["supplier_item_code"], "article_name": it["name"],
                "image_url": it.get("image_url"), "division_code": it.get("division_code"),
                "tags": it.get("tags") or [], "ordered_quantity": 6 * (1 + (n + k) % 3),
                "unit_price_minor": it["unit_price_minor"], "promised_date": promised.isoformat(),
            } for k, it in enumerate(picked)]
            order = rina_c.post("/api/v1/purchase-orders", {
                "po_number": number, "supplier_id": code, "supplier_name": supplier["name"],
                "destination_site_id": "dc", "origin_kind": "SOURCING", "currency": "IDR",
                "notes": "Pesanan demo", "created_by": "rina", "lines": lines})
            book += 1
            if kind == "cancelled":
                rina_c.post(f"/api/v1/purchase-orders/{order['purchase_order_id']}/cancel",
                            {"reason": "Supplier could not supply"})
    print(f"  placed {book} orders")

    # Receive every "-REC" order to the last piece, the ones an earlier run left
    # half done included: the quantity comes from the order, and the DC is
    # waited on until all of its lines have arrived (they sync one by one).
    book_now = rows(rina_c.get("/api/v1/purchase-orders?limit=500"))
    todo = [po for po in book_now if "-REC" in po["po_number"] and po.get("lifecycle") != "FULLY_RECEIVED"]
    print(f"  receiving {len(todo)} orders at the DC")
    for po in todo:
        number, code = po["po_number"], po["supplier_id"]
        detail = rina_c.get(f"/api/v1/purchase-orders/{po['purchase_order_id']}")
        ordered = {l["article_code"]: l for l in detail["lines"]}
        deadline, po_lines = time.time() + 150, []
        while time.time() < deadline:
            po_lines = [l for l in rows(rina_d.get("/api/v1/dc/purchase-orders?limit=1000"))
                        if l.get("po_number") == number]
            if len(po_lines) >= len(ordered):
                break
            time.sleep(3)
        if len(po_lines) < len(ordered):
            print(f"  ! {number} did not fully reach the DC; skipped")
            continue
        receipt, total = None, 0
        for line in po_lines:
            want = ordered[line["article_code"]]
            left = want["expected_stock_units"] - (line.get("received_stock_units") or 0)
            if left <= 0:
                continue
            if receipt is None:
                receipt = nina.post("/api/v1/dc/goods-receipts", {
                    "supplier_id": code, "actor_id": "nina", "idempotency_key": str(uuid.uuid4())})
            count = nina.post("/api/v1/dc/purchase-counts", {
                "receipt_id": receipt["receipt_id"], "po_line_id": line["po_line_id"],
                "counted_quantity": left, "actor_id": "nina", "idempotency_key": str(uuid.uuid4())})
            price = want["unit_price_minor"]
            rina_d.post("/api/v1/dc/purchase-verifications", {
                "count_id": count["count_id"], "verifier_actor_id": "rina", "decision": "Accept",
                "invoice_unit_price_minor": price, "idempotency_key": str(uuid.uuid4())})
            total += price * left
        if receipt is not None:
            yusuf.call("POST", f"/api/v1/dc/goods-receipts/{receipt['receipt_id']}/invoice", {
                "receipt_id": receipt["receipt_id"], "invoice_number": f"INV-{number}-{uuid.uuid4().hex[:4]}",
                "invoice_total_minor": total, "actor_id": "yusuf", "idempotency_key": str(uuid.uuid4())})
            print(f"  received {number}")


if __name__ == "__main__":
    sys.exit(main())
