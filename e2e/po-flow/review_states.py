#!/usr/bin/env python3
"""Orders in every state the Review Count and the order book can show.

    python3 e2e/po-flow/review_states.py [--base http://127.0.0.1:8495] [--tag RS1]

Runs against the cloud-native DC rig (`dcnative-cloud`, one node serves the
cloud and the Gudang). Leaves, for the owner to look at:

  waiting for review     OVER, SHORT, OVER+SHORT      (counted, NOT reviewed)
  completed on its own   PASS                         (counted exactly as ordered)
  completed, closed short  CLOSE-SHORT                (counted less, reviewed, closed)
  partial, received 3×   PARTIAL-3X                   (stays open)
  fully received         FULL-2X                      (two deliveries, then complete)
  returns                RETURN                       (over + not-as-ordered, reviewed;
                                                       checked in the return book)
"""

from __future__ import annotations

import argparse
import datetime
import importlib.util
import sys
import time
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("demo_populate", ROOT / "scripts/demo-populate.py")
dp = importlib.util.module_from_spec(spec)
sys.modules["demo_populate"] = dp
spec.loader.exec_module(dp)

PASSWORD = "Password01"
PRICE = 40000
results: list[tuple[str, bool, str]] = []


def uid() -> str:
    return str(uuid.uuid4())


def check(name: str, ok: bool, detail: str = "") -> None:
    results.append((name, ok, detail))
    mark = "\033[32mPASS\033[0m" if ok else "\033[31mFAIL\033[0m"
    print(f"  {mark} {name}" + (f"  — {detail}" if detail else ""), flush=True)


def rows(payload):
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        for key in ("items", "rows", "data", "results", "lines"):
            if isinstance(payload.get(key), list):
                return payload[key]
    return []


class Rig:
    def __init__(self, base: str) -> None:
        self.node = dp.Node(base, "cloud")
        self.sessions: dict = {}

    def as_(self, user: str):
        if user not in self.sessions:
            self.sessions[user] = self.node.login(user, PASSWORD)
        return self.sessions[user]


def supplier_and_items(rig: Rig, tag: str, how_many: int):
    rina = rig.as_("rina")
    supplier = next(s for s in rows(rina.get("/api/v1/suppliers?limit=50")) if s["supplier_code"] == "0001")
    sid = supplier["supplier_id"]
    items = []
    for n in range(how_many):
        code = f"{tag}-{n + 1}"
        have = [i.get("item", i) for i in rows(rina.get(f"/api/v1/suppliers/{sid}/items?limit=200"))]
        item = next((i for i in have if i["supplier_item_code"] == code), None)
        if item is None:
            rina.post(f"/api/v1/suppliers/{sid}/items", {
                "supplier_item_code": code, "name": f"Kaos Uji {code}", "unit_price_minor": PRICE,
                "currency": "IDR", "status": "ACTIVE", "division_code": "PRIA", "tags": ["KAOS"],
                "colour_codes": ["BLACK"], "size_codes": ["03"]})
            have = [i.get("item", i) for i in rows(rina.get(f"/api/v1/suppliers/{sid}/items?limit=200"))]
            item = next(i for i in have if i["supplier_item_code"] == code)
        items.append(item)
    return supplier, items


def place_po(rig: Rig, supplier: dict, items: list[dict], quantities: list[int], note: str) -> str:
    rina = rig.as_("rina")
    due = (datetime.date.today() + datetime.timedelta(days=3)).isoformat()
    lines = [{
        "supplier_item_id": item["supplier_item_id"], "quantity": qty, "promised_date": due,
        "unit_price_minor": None, "article_name": None, "image_url": None, "division_code": None,
        "tags": None, "base_price_minor": 99000, "markup_bps": None,
        "variants": [{"colour_code": "BLACK", "size_code": "03", "quantity": qty, "base_price_minor": None}],
    } for item, qty in zip(items, quantities)]
    receipt = rina.post("/api/v1/purchase-orders/catalog", {
        "po_number": None, "supplier_id": supplier["supplier_id"], "destination_site_id": None,
        "notes": note, "discount_minor": None, "payment_terms_code": None, "lines": lines})
    return receipt["po_number"]


def po_book(rig: Rig, po_number: str) -> dict:
    rina = rig.as_("rina")
    for po in rows(rina.get("/api/v1/purchase-orders?limit=500")):
        if po["po_number"] == po_number:
            return po
    raise SystemExit(f"{po_number} is not in the order book")


def po_detail(rig: Rig, po_number: str) -> dict:
    rina = rig.as_("rina")
    return rina.get(f"/api/v1/purchase-orders/{po_book(rig, po_number)['purchase_order_id']}")


def dc_lines(rig: Rig, po_number: str) -> list[dict]:
    nina = rig.as_("nina")
    deadline = time.time() + 60
    while time.time() < deadline:
        found = [l for l in rows(nina.get("/api/v1/dc/purchase-orders?limit=500")) if l.get("po_number") == po_number]
        if found:
            return sorted(found, key=lambda l: l.get("line_number", 0))
        time.sleep(1)
    raise SystemExit(f"{po_number} never reached the Gudang")


def count(rig: Rig, supplier: dict, po_number: str, quantities: list[int], wrong: list[int] | None = None) -> list[dict]:
    """One delivery: one receipt, one count per line that arrived."""
    nina = rig.as_("nina")
    receipt = nina.post("/api/v1/dc/goods-receipts", {
        "supplier_id": supplier["supplier_code"], "actor_id": "nina", "idempotency_key": uid()})
    made = []
    for n, (line, qty) in enumerate(zip(dc_lines(rig, po_number), quantities)):
        if qty is None:
            continue
        made.append(nina.post("/api/v1/dc/purchase-counts", {
            "receipt_id": receipt["receipt_id"], "po_line_id": line["po_line_id"],
            "counted_quantity": qty, "wrong_quantity": (wrong or [0] * len(quantities))[n],
            "actor_id": "nina", "idempotency_key": uid()}))
    return made


def accept(rig: Rig, made: list[dict]) -> None:
    rina = rig.as_("rina")
    for one in made:
        out = rina.call("POST", "/api/v1/dc/purchase-verifications", {
            "count_id": one["count_id"], "verifier_actor_id": "rina", "decision": "Accept",
            "invoiced_price_minor": PRICE, "idempotency_key": uid()}, ok=None)
        if isinstance(out, dict) and out.get("error") and "already accepted" not in str(out["error"]):
            raise SystemExit(f"accept failed: {out}")


def status(rig: Rig, po_number: str) -> str:
    po = po_book(rig, po_number)
    return str(po.get("lifecycle") or po.get("order_status") or po.get("status"))


def settle(rig: Rig, po_number: str, want_received: int, timeout: int = 40) -> dict:
    deadline = time.time() + timeout
    while time.time() < deadline:
        detail = po_detail(rig, po_number)
        got = sum(l.get("received_quantity", 0) for l in detail["lines"])
        if got >= want_received:
            return detail
        time.sleep(1)
    return po_detail(rig, po_number)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="http://127.0.0.1:8495")
    parser.add_argument("--tag", default=time.strftime("RS%H%M"))
    args = parser.parse_args()
    rig = Rig(args.base)
    tag = args.tag
    made: dict[str, str] = {}

    print("\n── waiting for review (counted, not reviewed)")
    sup, [item] = supplier_and_items(rig, f"{tag}-OVR", 1)
    po = place_po(rig, sup, [item], [100], "Uji: lebih")
    count(rig, sup, po, [130])
    made["OVER (+30)"] = po
    check("OVER waits for review", status(rig, po) == "ACTIVE", status(rig, po))

    sup, [item] = supplier_and_items(rig, f"{tag}-SHT", 1)
    po = place_po(rig, sup, [item], [100], "Uji: kurang")
    count(rig, sup, po, [70])
    made["SHORT (−30)"] = po
    check("SHORT waits for review", status(rig, po) == "ACTIVE", status(rig, po))

    sup, items = supplier_and_items(rig, f"{tag}-MIX", 2)
    po = place_po(rig, sup, items, [100, 100], "Uji: lebih dan kurang")
    count(rig, sup, po, [120, 70])
    made["OVER + SHORT"] = po
    check("OVER+SHORT waits for review", status(rig, po) == "ACTIVE", status(rig, po))

    print("\n── completed on its own")
    sup, [item] = supplier_and_items(rig, f"{tag}-PAS", 1)
    po = place_po(rig, sup, [item], [100], "Uji: pas")
    count(rig, sup, po, [100])
    detail = settle(rig, po, 100)
    made["PASS (auto completed)"] = po
    check("PASS is received without a review", sum(l["received_quantity"] for l in detail["lines"]) == 100)
    check("PASS is fully received", status(rig, po) == "FULLY_RECEIVED", status(rig, po))

    print("\n── completed, closed short")
    sup, [item] = supplier_and_items(rig, f"{tag}-CLS", 1)
    po = place_po(rig, sup, [item], [100], "Uji: close short")
    got = count(rig, sup, po, [60])
    accept(rig, got)
    detail = settle(rig, po, 60)
    line = detail["lines"][0]
    rig.as_("rina").post(f"/api/v1/purchase-order-lines/{line['po_line_id']}/close-short",
                         {"closed_by": "rina", "reason": "Closed short at count review"})
    made["COMPLETED · close short"] = po
    time.sleep(1)
    check("CLOSE-SHORT is closed short", status(rig, po) == "SHORT_RECEIVED", status(rig, po))

    print("\n── partial received, three deliveries")
    sup, [item] = supplier_and_items(rig, f"{tag}-PRT", 1)
    po = place_po(rig, sup, [item], [300], "Uji: partial 3x")
    total = 0
    for qty in (100, 100, 60):
        accept(rig, count(rig, sup, po, [qty]))
        total += qty
        settle(rig, po, total)
    made["PARTIAL · 3 deliveries (260 of 300)"] = po
    check("PARTIAL stays open", status(rig, po) == "PARTIALLY_RECEIVED", status(rig, po))
    check("PARTIAL holds 260", sum(l["received_quantity"] for l in po_detail(rig, po)["lines"]) == 260)

    print("\n── fully received over two deliveries")
    sup, [item] = supplier_and_items(rig, f"{tag}-FUL", 1)
    po = place_po(rig, sup, [item], [200], "Uji: lengkap 2x")
    accept(rig, count(rig, sup, po, [120]))
    settle(rig, po, 120)
    accept(rig, count(rig, sup, po, [80]))
    settle(rig, po, 200)
    made["FULLY RECEIVED · 2 deliveries"] = po
    check("FULL is fully received", status(rig, po) == "FULLY_RECEIVED", status(rig, po))

    print("\n── return to supplier")
    sup, [item] = supplier_and_items(rig, f"{tag}-RET", 1)
    po = place_po(rig, sup, [item], [100], "Uji: retur")
    got = count(rig, sup, po, [150], wrong=[20])
    accept(rig, got)
    settle(rig, po, 100)
    book = po_book(rig, po)
    returned = rig.as_("rina").call("POST", f"/api/v1/purchase-orders/{book['purchase_order_id']}/returns",
                                    {"po_line_ids": [l["po_line_id"] for l in po_detail(rig, po)["lines"]], "note": "Barang lebih dan tidak sesuai"}, ok=None)
    made["RETURN (over 30 + not as ordered 20)"] = po
    check("a purchase return was raised", isinstance(returned, dict) and not returned.get("error"), str(returned)[:120])
    book_returns = rows(rig.as_("rina").get("/api/v1/purchase-returns"))
    mine = [r for r in book_returns if po in str(r)]
    check("the return is in the return book", len(mine) >= 1, f"{len(mine)} found")

    print("\n── orders made")
    for label, number in made.items():
        print(f"  {number}   {label}   [{status(rig, number)}]")
    failed = [r for r in results if not r[1]]
    print(f"\n{len(results) - len(failed)}/{len(results)} checks passed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
