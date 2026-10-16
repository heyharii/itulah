#!/usr/bin/env python3
"""PO → DC → store → floor → till → back, with the numbers checked at every step.

    python3 e2e/po-flow/run.py [--phase 1,2,3] [--tag UJI1]

Runs against the `pos-e2e` rig (cloud :8480, DC :8481, store-01 :8482) through
the routes the apps use. Every phase asserts the quantities it should have
produced; a failed check is printed and the run goes on, so one run shows
everything that is wrong, not just the first thing.

  1  normal PO         PO 12 pcs → DC counts 12 → rina verifies → invoice →
                       article set up → tags printed → 12 units in dc.warehouse
  2  to the shop       allot 8 → pick → pack → surat jalan → truck → in transit →
                       store counts blind and receives → store warehouse
  3  floor and till    warehouse → floor → the till quotes it → back to the
                       warehouse → the till refuses it
  4  PO variants       short delivery (+ close short), over-delivery (+ return),
                       recount, rejected delivery, cancelled PO
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import os
import sys
import time
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("demo_populate", ROOT / "scripts/demo-populate.py")
dp = importlib.util.module_from_spec(spec)
sys.modules["demo_populate"] = dp
spec.loader.exec_module(dp)

# The pos-e2e rig by default; RIG_CLOUD / RIG_DC / RIG_STORE point it at
# another (the demo rig: 8180 / 8181 / 8182).
CLOUD = os.environ.get("RIG_CLOUD", "http://127.0.0.1:8480")
DC = os.environ.get("RIG_DC", "http://127.0.0.1:8481")
STORE_NODE = os.environ.get("RIG_STORE", "http://127.0.0.1:8482")
STORE = "store-01"
PASSWORD = "Password01"
PRINTER_PORT = 9109

results: list[tuple[str, bool, str]] = []


def check(name: str, ok: bool, detail: str = "") -> bool:
    results.append((name, ok, detail))
    mark = "\033[32mPASS\033[0m" if ok else "\033[31mFAIL\033[0m"
    print(f"  {mark} {name}" + (f"  — {detail}" if detail else ""), flush=True)
    return ok


def step(title: str) -> None:
    print(f"\n\033[1m── {title}\033[0m", flush=True)


def rows(payload):
    """The list inside a response, whatever the endpoint calls it."""
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        for key in ("items", "rows", "data", "results", "lines", "deliveries", "pools"):
            if isinstance(payload.get(key), list):
                return payload[key]
    return []


def wait_for(label, probe, timeout=120, every=3):
    return dp.wait_for(label, probe, timeout, every)


def nudge(*nodes) -> None:
    for node in nodes:
        node.call("POST", "/api/v1/sync/trigger", {}, ok=None)


class Rig:
    def __init__(self) -> None:
        self.nodes = {"cloud": dp.Node(CLOUD, "cloud"), "dc": dp.Node(DC, "dc"), "store": dp.Node(STORE_NODE, "store")}
        self.sessions: dict = {}

    def as_(self, node: str, user: str):
        if (node, user) not in self.sessions:
            self.sessions[(node, user)] = self.nodes[node].login(user, PASSWORD)
        return self.sessions[(node, user)]


def uid() -> str:
    return str(uuid.uuid4())


# ---------------------------------------------------------------------------
# helpers that read the numbers

def dc_pool(rig: Rig, pool: str) -> dict:
    for p in rows(rig.as_("dc", "yusuf").get("/api/v1/inventory/pools")):
        if p["id"] == pool:
            return p
    return {"stock": 0}


def store_pool(rig: Rig, pool: str) -> dict:
    for p in rows(rig.as_("store", "maya").get("/api/v1/inventory/pools")):
        if p["id"] == pool:
            return p
    return {"stock": 0}


def units_at(node, sku_codes: set[str], place_suffix: str) -> list[str]:
    """EPCs of the given SKUs whose newest movement ended at `place_suffix`."""
    where: dict[str, str] = {}
    for move in sorted(rows(node.get("/api/v1/inventory/movements?limit=5000")), key=lambda m: m["occurred_at"]):
        where[move["epc"]] = move["to"]
    return sorted(e for e, to in where.items() if e[2:13] in sku_codes and to.endswith(place_suffix))


def edge_db(node: str):
    import sqlite3
    path = ROOT / "runs" / os.environ.get("RIG_RUN", "pos-e2e") / ("dc-edge.sqlite3" if node == "dc" else "store-edge.sqlite3")
    return sqlite3.connect(f"file:{path}?mode=ro", uri=True)


def edge_units(node: str, skus: set[str]) -> dict[str, dict[str, int]]:
    """{place: {sku: units}} straight from the node's projection — the ground truth."""
    out: dict[str, dict[str, int]] = {}
    con = edge_db(node)
    try:
        q = ("SELECT p.place_id, s.sku_code, sum(p.quantity) FROM inventory_projection p "
             "JOIN inventory_subject s ON s.id=p.subject_id WHERE p.quantity>0 GROUP BY 1,2")
        for place, sku, qty in con.execute(q):
            if sku in skus:
                out.setdefault(place, {})[sku] = qty
    finally:
        con.close()
    return out


def place_total(units: dict, place: str) -> int:
    return sum(units.get(place, {}).values())


def edge_epcs(node: str, skus: set[str], place: str) -> list[str]:
    con = edge_db(node)
    try:
        q = ("SELECT s.epc FROM inventory_projection p JOIN inventory_subject s ON s.id=p.subject_id "
             "WHERE p.place_id=? AND p.quantity>0 AND s.epc IS NOT NULL AND s.sku_code IN (%s) ORDER BY s.epc"
             % ",".join("?" * len(skus)))
        return [r[0] for r in con.execute(q, [place, *sorted(skus)])]
    finally:
        con.close()


def po_by_number(cloud, po_number: str) -> dict | None:
    for po in rows(cloud.get("/api/v1/purchase-orders?limit=500")):
        if po.get("po_number") == po_number:
            return po
    return None


def po_detail(cloud, po_number: str) -> dict:
    po = po_by_number(cloud, po_number)
    return cloud.get(f"/api/v1/purchase-orders/{po['purchase_order_id']}") if po else {}


def wait_po(cloud, po_number: str, want: dict, timeout: int = 90) -> dict:
    """Poll the PO's figures until they equal `want` (sync takes a few seconds)."""
    end = time.time() + timeout
    n = po_numbers(cloud, po_number)
    while time.time() < end:
        n = po_numbers(cloud, po_number)
        if all(n.get(k) == v for k, v in want.items()):
            return n
        time.sleep(3)
    return n


def article_skus(cloud, name: str) -> dict[str, str]:
    """sku_code → 'colour/size' for the article of that name, from head office's availability view."""
    out = {}
    for r in rows(cloud.get("/api/v1/inventory/availability?limit=1000")):
        if r.get("article_name") == name:
            out[r["sku_code"]] = f"{r.get('colour')}/{r.get('size')}"
    return out


def po_numbers(cloud, po_number: str) -> dict:
    """The list row's figures: ordered / received / outstanding / excess, in pieces."""
    po = po_by_number(cloud, po_number) or {}
    return {k: po.get(k) for k in ("order_status", "lifecycle", "expected_stock_units", "received_stock_units",
                                   "outstanding_stock_units", "invoiced_stock_units", "excess_stock_units")}


# ---------------------------------------------------------------------------
# phase 1

def make_item(cloud, tag: str) -> dict:
    suppliers = rows(cloud.get("/api/v1/suppliers?limit=50"))
    supplier = next(s for s in suppliers if s["supplier_code"] == "0001")
    code = f"{tag}-KAO"
    existing = [i.get("item", i) for i in rows(cloud.get(f"/api/v1/suppliers/{supplier['supplier_id']}/items?limit=100"))]
    item = next((i for i in existing if i["supplier_item_code"] == code), None)
    if item is None:
        cloud.post(f"/api/v1/suppliers/{supplier['supplier_id']}/items", {
            "supplier_item_code": code, "name": f"Kaos Uji {tag}", "unit_price_minor": 40000,
            "currency": "IDR", "status": "ACTIVE", "division_code": "PRIA", "tags": ["KAOS"],
            "colour_codes": ["BLACK", "WHITE"], "size_codes": ["03", "04"]})
        existing = [i.get("item", i) for i in rows(cloud.get(f"/api/v1/suppliers/{supplier['supplier_id']}/items?limit=100"))]
        item = next(i for i in existing if i["supplier_item_code"] == code)
    return {"supplier": supplier, "item": item}


def place_po(rig: Rig, ctx: dict, qty: int, *, per_variant: int | None = None) -> str:
    """The route New PO uses: the server numbers the order (PO-DDMMYY-NNN) and
    the colours and sizes are decided here, at the order."""
    import datetime
    cloud = rig.as_("cloud", "rina")
    supplier, item = ctx["supplier"], ctx["item"]
    each = per_variant if per_variant is not None else qty // 4
    variants = [{"colour_code": c, "size_code": z, "quantity": each, "base_price_minor": None}
                for c in ("BLACK", "WHITE") for z in ("03", "04")]
    receipt = cloud.post("/api/v1/purchase-orders/catalog", {
        "po_number": None, "supplier_id": supplier["supplier_id"], "destination_site_id": None,
        "notes": "Uji alur PO", "discount_minor": None, "payment_terms_code": None,
        "lines": [{"supplier_item_id": item["supplier_item_id"], "quantity": qty,
                   "promised_date": (datetime.date.today() + datetime.timedelta(days=3)).isoformat(),
                   "unit_price_minor": None, "article_name": None, "image_url": None,
                   "division_code": None, "tags": None, "base_price_minor": 99000, "markup_bps": None,
                   "variants": variants}]})
    return receipt["po_number"]


def dc_line(rig: Rig, po_number: str) -> dict:
    dc = rig.as_("dc", "nina")
    return wait_for(f"{po_number} at the DC", lambda: next(
        (l for l in rows(dc.get("/api/v1/dc/purchase-orders?limit=500")) if l.get("po_number") == po_number), None), 120)


def count_and_verify(rig: Rig, ctx: dict, po_number: str, counted: int, *, wrong: int = 0, verify: str | None = "Accept") -> dict:
    nina, rina, yusuf = rig.as_("dc", "nina"), rig.as_("dc", "rina"), rig.as_("dc", "yusuf")
    line = dc_line(rig, po_number)
    supplier = ctx["supplier"]
    receipt = nina.post("/api/v1/dc/goods-receipts", {"supplier_id": supplier["supplier_code"], "actor_id": "nina", "idempotency_key": uid()})
    count = nina.post("/api/v1/dc/purchase-counts", {
        "receipt_id": receipt["receipt_id"], "po_line_id": line["po_line_id"],
        "counted_quantity": counted, "wrong_quantity": wrong,
        "actor_id": "nina", "idempotency_key": uid()})
    out = {"receipt": receipt, "count": count, "line": line}
    if verify:
        body = {"count_id": count["count_id"], "verifier_actor_id": "rina", "decision": verify,
                "invoiced_price_minor": ctx["item"]["unit_price_minor"], "idempotency_key": uid()}
        if verify == "Recount":
            body["note"] = "Hitung ulang, rak belakang belum terhitung"
        # A count exactly as ordered is received on its own (owner, 2 Oct), so
        # an Accept that finds it already accepted is the rule working.
        verified = rina.call("POST", "/api/v1/dc/purchase-verifications", body, ok=None)
        if isinstance(verified, dict) and "already accepted" in str(verified.get("error", "")):
            out["auto_received"] = True
        elif isinstance(verified, dict) and verified.get("error"):
            raise SystemExit(f"dc:rina POST /api/v1/dc/purchase-verifications: {verified}")
        out["verified"] = verified
        if verify == "Accept":
            yusuf.call("POST", f"/api/v1/dc/goods-receipts/{receipt['receipt_id']}/invoice", {
                "receipt_id": receipt["receipt_id"], "invoice_number": f"INV-{po_number}",
                "invoice_total_minor": ctx["item"]["unit_price_minor"] * counted, "actor_id": "yusuf",
                "idempotency_key": uid()})
    return out


def setup_article_and_tag(rig: Rig, ctx: dict, po_number: str, total: int) -> dict:
    """If merchandising still has to name the goods, do it; then print and confirm the tags."""
    cloud, nina = rig.as_("cloud", "rina"), rig.as_("dc", "nina")
    item = ctx["item"]
    nudge(rig.nodes["dc"], rig.nodes["cloud"])
    time.sleep(4)
    setup = "implied by the order"
    waiting = [r for r in rows(cloud.get("/api/v1/article-setups/unidentified")) if r.get("po_number") == po_number]
    if waiting:
        setup = "done by merchandising"
        row = waiting[0]
        grid = [(d, s) for d in (1, 2) for s in ("03", "04")]
        each, extra = divmod(row["quantity"], len(grid))
        variants = [{"colour_digit": str(d), "size_code": s, "quantity": each + (1 if i < extra else 0),
                     "base_price_minor": 99000} for i, (d, s) in enumerate(grid)]
        variants = [v for v in variants if v["quantity"] > 0]
        session = cloud.post("/api/v1/article-setups", {
            "receipt_line_id": row["receipt_line_id"], "article_code": None, "article_name": row["article_name"],
            "division_code": row["division_code"], "tags": row.get("tags") or [], "image_url": item.get("image_url"),
            "currency": "IDR", "colours": [{"colour_digit": str(d), "colour_code": c} for d, c in enumerate(("BLACK", "WHITE"), start=1)],
            "variants": variants, "created_by": "rina"})
        cloud.post(f"/api/v1/article-setups/{session['session_id']}/issue", {"issued_by": "rina"})

    def open_jobs():
        return [j for j in rows(nina.get("/api/v1/dc/tagging-jobs"))
                if j.get("article_name") == item["name"] and j.get("status") not in ("DONE", "COMPLETED", "PRINTED", "TAGGED")]
    jobs = wait_for("tagging job for this article at the DC", lambda: (nudge(rig.nodes["dc"], rig.nodes["cloud"]), open_jobs() or None)[1], 180, 4)
    printed = 0
    for job in jobs:
        sess = nina.post("/api/v1/dc/print-sessions", {
            "job_id": job["job_id"], "printer_host": "127.0.0.1", "printer_port": PRINTER_PORT,
            "label_width_mm": 58, "label_height_mm": 40, "chunk_size": 10, "actor_id": "nina"})
        done = 0
        for _ in range(10):   # the printer takes a chunk of 10 at a time
            run = nina.call("POST", f"/api/v1/dc/print-sessions/{sess['session_id']}/run", {"actor_id": "nina"})
            n_printed = run.get("printed", 0)
            done += n_printed
            printed += n_printed
            if n_printed == 0 or done >= job.get("total_quantity", 0):
                break
        nina.post("/api/v1/dc/tagging-confirmations", {"job_id": job["job_id"], "actor_id": "nina", "idempotency_key": uid()})
    return {"printed": printed, "jobs": len(jobs), "setup": setup}


def phase1(rig: Rig, ctx: dict) -> None:
    step("1 · PO of 12 → DC counts 12 → verify → invoice → tags → 12 units")
    cloud, dc = rig.as_("cloud", "rina"), rig.as_("dc", "yusuf")
    po_number = ctx.get("po") or place_po(rig, ctx, 12)
    ctx["po_normal"] = po_number
    print(f"  PO {po_number} (numbered by the server)")
    n = po_numbers(cloud, po_number)
    check("PO issued: 12 expected, 12 outstanding", n["expected_stock_units"] == 12 and n["outstanding_stock_units"] == 12, json.dumps(n))
    got = count_and_verify(rig, ctx, po_number, 12)
    check("DC count recorded 12", got["count"].get("counted_quantity") == 12, json.dumps(got["count"])[:120])
    nudge(rig.nodes["dc"], rig.nodes["cloud"])
    n = wait_po(cloud, po_number, {"received_stock_units": 12, "outstanding_stock_units": 0})
    check("PO: 12 received, 0 outstanding", n["received_stock_units"] == 12 and n["outstanding_stock_units"] == 0, json.dumps(n))
    tagged = setup_article_and_tag(rig, ctx, po_number, 12)
    check("12 labels printed", tagged["printed"] == 12, f"printed {tagged['printed']} for {tagged['jobs']} job(s); setup step: {tagged['setup']}")
    nudge(rig.nodes["dc"], rig.nodes["cloud"])
    time.sleep(6)
    skus = article_skus(cloud, ctx["item"]["name"])
    ctx["skus"] = skus
    check("the article has 4 SKUs (2 colours × 2 sizes)", len(skus) == 4, json.dumps(skus))
    dcu = edge_units("dc", set(skus))
    held = dcu.get("dc.warehouse:on_hand", {})
    check("dc.warehouse holds 3 of each SKU, 12 in all", place_total(dcu, "dc.warehouse:on_hand") == 12 and all(held.get(k) == 3 for k in skus), json.dumps(held))
    n = wait_po(cloud, po_number, {"invoiced_stock_units": 12}, 30)
    check("PO: 12 invoiced", n["invoiced_stock_units"] == 12, json.dumps(n))


def sku_ids(cloud, skus: set[str]) -> dict[str, str]:
    out = {}
    for r in rows(cloud.get("/api/v1/inventory/availability?limit=1000")):
        if r["sku_code"] in skus:
            out[r["sku_code"]] = r["sku_id"]
    return out


def phase2(rig: Rig, ctx: dict) -> None:
    step("2 · allot 8 of 12 → pick → pack → surat jalan → truck → store counts blind and receives")
    cloud, rina = rig.as_("cloud", "rina"), rig.as_("cloud", "rina")
    nina, yusuf, maya = rig.as_("dc", "nina"), rig.as_("dc", "yusuf"), rig.as_("store", "maya")
    skus = set(ctx["skus"])
    per = 2
    wanted = {sku: per for sku in sorted(skus)}
    ids = wait_for("SKUs in head office availability", lambda: (nudge(rig.nodes["dc"], rig.nodes["cloud"]), sku_ids(cloud, skus) if len(sku_ids(cloud, skus)) == len(skus) else None)[1], 120, 4)

    def enough():
        have = {r["sku_code"]: r.get("on_hand_qty", 0) for r in rows(cloud.get("/api/v1/inventory/availability?limit=1000"))}
        return all(have.get(k, 0) >= per for k in skus)
    note = f"Uji alur PO {ctx['tag']}"
    found = next((x for x in rows(cloud.get("/api/v1/inventory/allotments?limit=200"))
                  if x.get("notes") == note and x.get("status") != "CANCELLED"), None)
    if not found:
        wait_for("DC stock at head office", enough, 120, 4)
    store_before = edge_units("store", skus)
    made = found or cloud.post("/api/v1/inventory/allotments", {
        "type": "TO_STORE", "notes": note, "actor_id": "rina", "idempotency_key": uid(),
        "lines": [{"source_site_id": "dc", "source_pool_id": "dc.warehouse", "destination_type": "STORE",
                   "destination_id": STORE, "sku_id": ids[k], "quantity": q} for k, q in wanted.items()]})
    print(f"  allotment {made.get('allotment_number')} — 8 units to {STORE}" + (" (reused)" if found else ""))
    check("allotment is for 8 units", True, made.get("allotment_number", ""))

    def owed():
        lines = {l["sku_code"]: l["outstanding"] for l in rows(nina.get("/api/v1/dc/picklist"))}
        return lines if all(lines.get(k, 0) >= q for k, q in wanted.items()) else None
    owes = wait_for("the allotment at the DC", lambda: (nudge(rig.nodes["dc"], rig.nodes["cloud"]), owed())[1], 120, 4)
    check("DC picklist owes 2 of each SKU (8)", all(owes.get(k, 0) >= 2 for k in skus), json.dumps({k: owes.get(k) for k in skus}))
    picked = nina.post("/api/v1/dc/picklists", {
        "source_pool_id": "dc.warehouse", "lines": [{"sku_code": k, "quantity": q} for k, q in wanted.items()],
        "actor_id": "nina", "note": note, "idempotency_key": uid()})
    check("picked 8, none refused", picked["summary"]["total_picked"] == 8 and not picked["refused"], json.dumps(picked["summary"]))
    dcu = edge_units("dc", skus)
    check("dc.warehouse now holds 1 of each SKU (4)", place_total(dcu, "dc.warehouse:on_hand") == 4, json.dumps(dcu.get("dc.warehouse:on_hand")))
    manifest = nina.post("/api/v1/dc/packs", {
        "destination_store_id": STORE, "lines": [{"sku_code": k, "quantity": q} for k, q in wanted.items()],
        "actor_id": "nina", "idempotency_key": uid(), "seal": True})
    koli = manifest["koli"]
    check("one koli of 8 pcs sealed", koli.get("unit_count") == 8, f"{koli.get('koli_number')} {koli.get('unit_count')} pcs")
    shipment = yusuf.post("/api/v1/dc/shipments", {"koli_ids": [koli["koli_id"]], "actor_id": "yusuf"})
    check("surat jalan covers 8 pcs", shipment.get("unit_count") == 8, shipment.get("shipment_number", ""))
    yusuf.post(f"/api/v1/dc/koli/{koli['koli_id']}/shipment", {"shipment_reference": shipment["shipment_number"], "actor_id": "yusuf", "idempotency_key": uid()})
    truck = yusuf.post("/api/v1/dc/dispatches", {"shipment_ids": [shipment["shipment_id"]], "carrier": "Armada DC",
                       "vehicle_plate": "B 9123 KXA", "driver_name": "Pak Joko", "actor_id": "yusuf"})
    yusuf.post(f"/api/v1/dc/koli/{koli['koli_id']}/dispatch", {"actor_id": "yusuf", "idempotency_key": uid()})
    yusuf.post(f"/api/v1/dc/dispatches/{truck['dispatch_id']}/depart", {})
    yusuf.post(f"/api/v1/dc/koli/{koli['koli_id']}/in-transit", {"actor_id": "yusuf", "idempotency_key": uid()})
    ctx["shipment"] = shipment["shipment_number"]
    print(f"  {shipment['shipment_number']} on {truck['dispatch_number']}, in transit")

    ctx["wanted"] = wanted
    ctx["store_before"] = store_before
    store_receives(rig, ctx)


def phase2b(rig: Rig, ctx: dict) -> None:
    step("2b · the shop counts the truck blind and receives it")
    skus = set(ctx["skus"])
    ctx["wanted"] = {sku: 2 for sku in sorted(skus)}
    ctx["store_before"] = {}
    store_receives(rig, ctx)


def store_receives(rig: Rig, ctx: dict) -> None:
    maya = rig.as_("store", "maya")
    skus, wanted, store_before = set(ctx["skus"]), ctx["wanted"], ctx["store_before"]
    ref = ctx.get("shipment")

    def announced():
        nudge(rig.nodes["dc"], rig.nodes["cloud"], rig.nodes["store"])
        waiting = [d for d in rows(maya.call("GET", "/api/v1/store/inbound?status=IN_TRANSIT", ok=None))
                   if ref is None or d.get("shipment_reference") == ref]
        return sorted(waiting, key=lambda d: d["departed_at"])[-1:] or None
    inbound = wait_for("the delivery announced to the store", announced, 150, 4)
    delivery = inbound[0]["delivery_id"]
    ref = inbound[0]["shipment_reference"]
    check("store sees the delivery in transit, not yet counted", inbound[0]["status"] == "IN_TRANSIT" and inbound[0]["result"] is None, ref)
    detail = maya.get(f"/api/v1/store/inbound/{delivery}")
    leaked = json.dumps(detail)
    check("the in-transit delivery hides what was packed (blind)", '"packed' not in leaked and '"expected' not in leaked and '"manifest' not in leaked, "no packed/expected/manifest figures in the response")
    before = edge_units("store", skus)
    counts = [{"sku_code": k, "quantity": q} for k, q in wanted.items()]
    got = maya.post(f"/api/v1/store/inbound/{delivery}/receive-count", {"counts": counts, "actor_id": "maya", "idempotency_key": uid()})
    result = (got.get("delivery") or {}).get("result") or got.get("result") or got
    check("store counted 8, received 8, none missing",
          result.get("received_units") == 8 and result.get("missing_units", 0) == 0, json.dumps(result)[:200])
    after = edge_units("store", skus)
    wh = place_total(after, "store-01.warehouse:on_hand") - place_total(before, "store-01.warehouse:on_hand")
    check("store-01.warehouse grew by exactly 8", wh == 8, f"+{wh}")
    nudge(rig.nodes["store"], rig.nodes["cloud"], rig.nodes["dc"])
    ctx["delivery"] = delivery


def till_quote(rig: Rig, epc: str):
    dian = rig.as_("store", "dian")
    return dian.call("POST", "/api/v1/store/quote", {"epcs": [epc], "coupon_codes": [], "customer_id": None, "charges": []}, ok=None)


def phase3(rig: Rig, ctx: dict) -> None:
    step("3 · warehouse → floor → the till sells it → back to the warehouse → the till refuses it")
    maya = rig.as_("store", "maya")
    skus = set(ctx["skus"])
    wh_place, fl_place = f"{STORE}.warehouse:on_hand", f"{STORE}.floor:on_hand"
    start = edge_units("store", skus)
    wh0, fl0 = place_total(start, wh_place), place_total(start, fl_place)
    epcs = edge_epcs("store", skus, wh_place)
    check("the 8 received units sit in the stockroom", len(epcs) == 8, f"{len(epcs)} EPCs")
    probe = epcs[0]
    q = till_quote(rig, probe)
    check("the till does NOT detect a unit still in the stockroom", not (isinstance(q, dict) and q.get("total_minor")), json.dumps(q)[:160])
    moving = epcs[:6]
    for epc in moving:
        maya.post("/api/v1/store/movements", {"epc": epc, "quantity": 1, "from": wh_place, "to": fl_place,
                  "cause": "NORMAL_MOVE", "reason": "Pajang ke lantai jual", "actor_id": "maya", "idempotency_key": uid()})
    now = edge_units("store", skus)
    check("floor +6, stockroom -6", place_total(now, fl_place) - fl0 == 6 and wh0 - place_total(now, wh_place) == 6,
          f"warehouse {wh0}→{place_total(now, wh_place)}, floor {fl0}→{place_total(now, fl_place)}")
    q = till_quote(rig, moving[0])
    price = q.get("total_minor") if isinstance(q, dict) else None
    check("the till detects the unit on the floor and prices it", bool(price), json.dumps(q)[:200])
    check("the price is the base price set on the PO (99.000, before any promotion)", price is not None and price <= 99000, f"quote {price}")
    back = moving[:3]
    for epc in back:
        maya.post("/api/v1/store/movements", {"epc": epc, "quantity": 1, "from": fl_place, "to": wh_place,
                  "cause": "NORMAL_MOVE", "reason": "Kembali ke gudang toko", "actor_id": "maya", "idempotency_key": uid()})
    end = edge_units("store", skus)
    check("3 moved back: floor 3, stockroom 5 (8 in all)", place_total(end, fl_place) - fl0 == 3 and place_total(end, wh_place) - wh0 == 5
          and place_total(end, fl_place) + place_total(end, wh_place) - fl0 - wh0 == 8,
          f"warehouse {place_total(end, wh_place)-wh0}, floor {place_total(end, fl_place)-fl0}")
    q = till_quote(rig, back[0])
    check("the till no longer detects a unit that went back", not (isinstance(q, dict) and q.get("total_minor")), json.dumps(q)[:160])
    q = till_quote(rig, moving[3])
    check("the till still detects a unit left on the floor", bool(isinstance(q, dict) and q.get("total_minor")), json.dumps(q)[:120])


def line_of(cloud, po_number: str) -> dict:
    d = po_detail(cloud, po_number)
    return (d.get("lines") or [{}])[0]


def lifecycle(cloud, po_number: str) -> str:
    return (po_detail(cloud, po_number) or {}).get("lifecycle", "?")


def settle(rig: Rig) -> None:
    nudge(rig.nodes["dc"], rig.nodes["cloud"])
    time.sleep(6)


def variant(name):
    def wrap(fn):
        def run(rig, ctx):
            step(f"4 · PO variant — {name}")
            try:
                fn(rig, ctx)
            except SystemExit as error:
                check(f"{name}: ran to the end", False, str(error)[:200])
            except Exception as error:  # noqa: BLE001
                check(f"{name}: ran to the end", False, f"{type(error).__name__}: {str(error)[:200]}")
        return run
    return wrap


@variant("short delivery, then close short")
def v_short(rig, ctx):
    cloud = rig.as_("cloud", "rina")
    po = place_po(rig, ctx, 8)
    print(f"  PO {po}: ordered 8")
    count_and_verify(rig, ctx, po, 5)
    settle(rig)
    n = wait_po(cloud, po, {"received_stock_units": 5})
    check("counted 5 of 8: 5 received, 3 outstanding", n["received_stock_units"] == 5 and n["outstanding_stock_units"] == 3, json.dumps(n))
    check("the PO is partly received (still open)", lifecycle(cloud, po) not in ("FULLY_RECEIVED", "CLOSED", "CANCELLED"), lifecycle(cloud, po))
    line = line_of(cloud, po)
    cloud.post(f"/api/v1/purchase-order-lines/{line['po_line_id']}/close-short", {"closed_by": "rina", "reason": "Supplier tidak bisa kirim sisa 3"})
    settle(rig)
    n = po_numbers(cloud, po)
    line = line_of(cloud, po)
    check("closed short: nothing outstanding, 3 written off", n["outstanding_stock_units"] == 0 and line.get("closed_short_units") == 3,
          json.dumps({"outstanding": n["outstanding_stock_units"], "closed_short_units": line.get("closed_short_units"), "line_status": line.get("line_status")}))
    check("the PO now reads fully received", lifecycle(cloud, po) in ("FULLY_RECEIVED", "CLOSED"), lifecycle(cloud, po))


@variant("over-delivery, then return the excess")
def v_over(rig, ctx):
    cloud, nina = rig.as_("cloud", "rina"), rig.as_("dc", "nina")
    po = place_po(rig, ctx, 8)
    print(f"  PO {po}: ordered 8")
    count_and_verify(rig, ctx, po, 11)
    settle(rig)
    line = line_of(cloud, po)
    check("counted 11 of 8: 8 received, 3 excess pending",
          line.get("received_quantity") == 8 and line.get("excess_pending_quantity") == 3,
          json.dumps({k: line.get(k) for k in ("received_quantity", "excess_quantity", "excess_pending_quantity", "outstanding_stock_units")}))
    detail = po_detail(cloud, po)
    ret = cloud.post(f"/api/v1/purchase-orders/{detail['purchase_order_id']}/returns", {"po_line_ids": [line["po_line_id"]], "note": "Kelebihan 3 pcs dikembalikan ke supplier"})
    check("buyer raised a return for the excess", bool(ret), json.dumps(ret)[:160])
    settle(rig)
    pending = [r for r in rows(nina.get("/api/v1/dc/purchase-returns")) if r.get("po_number") == po]
    check("the DC sees one return to hand over, 3 pcs", len(pending) == 1 and (pending[0].get("quantity") or pending[0].get("total_quantity")) == 3, json.dumps(pending)[:200])
    if pending:
        rid = pending[0].get("return_id") or pending[0].get("id")
        done = nina.post(f"/api/v1/dc/purchase-returns/{rid}/hand-over", {"actor_id": "nina", "handed_to": "Pak Joko", "idempotency_key": uid()})
        check("DC handed the 3 pcs over", bool(done), json.dumps(done)[:160])
    settle(rig)
    line = line_of(cloud, po)
    check("the excess is cleared: 8 received, 0 pending", line.get("received_quantity") == 8 and line.get("excess_pending_quantity") == 0,
          json.dumps({k: line.get(k) for k in ("received_quantity", "excess_quantity", "excess_pending_quantity")}))


@variant("pieces not as ordered come with the delivery")
def v_wrong(rig, ctx):
    """The checker counts 10 pieces of an order for 8 and writes 3 of them as
    not the article the order names. Only 7 can match the order; the 3 leave
    on a purchase return, and the 1 still owed waits (or closes short)."""
    cloud, nina = rig.as_("cloud", "rina"), rig.as_("dc", "nina")
    po = place_po(rig, ctx, 8)
    print(f"  PO {po}: ordered 8")
    count_and_verify(rig, ctx, po, 10, wrong=3)
    settle(rig)
    line = line_of(cloud, po)
    check("counted 10, 3 not as ordered: 7 received, 1 outstanding, 3 excess pending",
          line.get("received_quantity") == 7 and line.get("outstanding_stock_units") == 1
          and line.get("excess_pending_quantity") == 3 and line.get("wrong_quantity") == 3,
          json.dumps({k: line.get(k) for k in ("received_quantity", "outstanding_stock_units",
                                               "excess_quantity", "excess_pending_quantity", "wrong_quantity")}))
    receipts = line.get("receipts") or []
    check("the receipt line says which pieces did not match",
          receipts and receipts[0].get("wrong_quantity") == 3 and receipts[0].get("matched_quantity") == 7,
          json.dumps(receipts)[:200])
    detail = po_detail(cloud, po)
    ret = cloud.post(f"/api/v1/purchase-orders/{detail['purchase_order_id']}/returns",
                     {"po_line_ids": [line["po_line_id"]], "note": "3 pcs barang tidak sesuai pesanan"})
    check("buyer raised the return for the mismatched pieces", bool(ret), json.dumps(ret)[:160])
    settle(rig)
    pending = [r for r in rows(nina.get("/api/v1/dc/purchase-returns")) if r.get("po_number") == po]
    check("the DC sees one return to hand over, 3 pcs",
          len(pending) == 1 and (pending[0].get("quantity") or pending[0].get("total_quantity")) == 3, json.dumps(pending)[:200])
    if pending:
        rid = pending[0].get("return_id") or pending[0].get("id")
        done = nina.post(f"/api/v1/dc/purchase-returns/{rid}/hand-over", {"actor_id": "nina", "handed_to": "Pak Joko", "idempotency_key": uid()})
        check("DC handed the 3 pcs back", bool(done), json.dumps(done)[:160])
    settle(rig)
    line = line_of(cloud, po)
    check("the mismatched pieces are cleared: 7 received, 1 outstanding",
          line.get("received_quantity") == 7 and line.get("excess_pending_quantity") == 0
          and line.get("outstanding_stock_units") == 1,
          json.dumps({k: line.get(k) for k in ("received_quantity", "excess_pending_quantity", "outstanding_stock_units")}))
    # Partial receive said: keep waiting. The buyer closes the rest instead.
    cloud.post(f"/api/v1/purchase-order-lines/{line['po_line_id']}/close-short",
               {"closed_by": "rina", "reason": "Sisa 1 pcs tidak jadi ditunggu"})
    settle(rig)
    n = po_numbers(cloud, po)
    line = line_of(cloud, po)
    check("closed short on the rest: 0 outstanding, 1 written off",
          n["outstanding_stock_units"] == 0 and line.get("closed_short_units") == 1,
          json.dumps({"outstanding": n["outstanding_stock_units"], "closed_short_units": line.get("closed_short_units")}))
    check("the PO now reads fully received", lifecycle(cloud, po) in ("FULLY_RECEIVED", "CLOSED"), lifecycle(cloud, po))


@variant("two deliveries complete one PO")
def v_partial(rig, ctx):
    """5 come first and are accepted as a part delivery (the PO stays open);
    the other 3 come on a second receipt and close it."""
    cloud = rig.as_("cloud", "rina")
    po = place_po(rig, ctx, 8)
    print(f"  PO {po}: ordered 8")
    count_and_verify(rig, ctx, po, 5)
    settle(rig)
    n = wait_po(cloud, po, {"received_stock_units": 5})
    check("first delivery: 5 received, 3 outstanding, still open",
          n["received_stock_units"] == 5 and n["outstanding_stock_units"] == 3
          and lifecycle(cloud, po) not in ("FULLY_RECEIVED", "CLOSED", "CANCELLED"), json.dumps(n))
    count_and_verify(rig, ctx, po, 3)
    settle(rig)
    n = wait_po(cloud, po, {"received_stock_units": 8})
    check("second delivery: 8 received, 0 outstanding", n["received_stock_units"] == 8 and n["outstanding_stock_units"] == 0, json.dumps(n))
    check("the PO reads fully received", lifecycle(cloud, po) in ("FULLY_RECEIVED", "CLOSED"), lifecycle(cloud, po))
    receipts = (line_of(cloud, po).get("receipts") or [])
    check("the line shows two receipts", len(receipts) == 2, json.dumps(receipts)[:200])


@variant("recount asked by the buyer")
def v_recount(rig, ctx):
    cloud = rig.as_("cloud", "rina")
    po = place_po(rig, ctx, 8)
    print(f"  PO {po}: ordered 8")
    got = count_and_verify(rig, ctx, po, 6, verify="Recount")
    settle(rig)
    n = po_numbers(cloud, po)
    check("a recount leaves nothing received yet", n["received_stock_units"] in (0, None), json.dumps(n))
    nina, rina, yusuf = rig.as_("dc", "nina"), rig.as_("dc", "rina"), rig.as_("dc", "yusuf")
    again = nina.post("/api/v1/dc/purchase-counts", {"receipt_id": got["receipt"]["receipt_id"], "po_line_id": got["line"]["po_line_id"],
                      "counted_quantity": 8, "actor_id": "nina", "idempotency_key": uid()})
    rina.post("/api/v1/dc/purchase-verifications", {"count_id": again["count_id"], "verifier_actor_id": "rina", "decision": "Accept",
              "invoice_unit_price_minor": ctx["item"]["unit_price_minor"], "idempotency_key": uid()})
    settle(rig)
    n = wait_po(cloud, po, {"received_stock_units": 8})
    check("after counting again (8) and accepting: 8 received, 0 outstanding", n["received_stock_units"] == 8 and n["outstanding_stock_units"] == 0, json.dumps(n))


@variant("delivery rejected at the dock")
def v_reject(rig, ctx):
    cloud, nina = rig.as_("cloud", "rina"), rig.as_("dc", "nina")
    po = place_po(rig, ctx, 8)
    print(f"  PO {po}: ordered 8")
    dc_line(rig, po)
    receipt = nina.post("/api/v1/dc/goods-receipts", {"supplier_id": ctx["supplier"]["supplier_code"], "actor_id": "nina", "idempotency_key": uid()})
    out = nina.post(f"/api/v1/dc/goods-receipts/{receipt['receipt_id']}/reject", {"receipt_id": receipt["receipt_id"], "reason": "Kemasan rusak, dikembalikan ke supir", "actor_id": "nina", "idempotency_key": uid()})
    check("the delivery was rejected with a reason", bool(out), json.dumps(out)[:160])
    settle(rig)
    n = po_numbers(cloud, po)
    check("a rejected delivery changes nothing on the PO: 0 received, 8 outstanding", n["received_stock_units"] in (0, None) and n["outstanding_stock_units"] == 8, json.dumps(n))


@variant("PO cancelled before anything arrived")
def v_cancel(rig, ctx):
    cloud, nina = rig.as_("cloud", "rina"), rig.as_("dc", "nina")
    po = place_po(rig, ctx, 8)
    print(f"  PO {po}: ordered 8")
    d = po_detail(cloud, po)
    check("a fresh PO can be cancelled", d.get("cancellable") is True, json.dumps({"cancellable": d.get("cancellable"), "why": d.get("cancel_blocked_reason")}))
    cloud.post(f"/api/v1/purchase-orders/{d['purchase_order_id']}/cancel", {"reason": "Salah supplier"})
    settle(rig)
    check("the PO is cancelled", lifecycle(cloud, po) == "CANCELLED", lifecycle(cloud, po))
    still = [l for l in rows(nina.get("/api/v1/dc/purchase-orders?limit=500")) if l.get("po_number") == po]
    check("the DC no longer expects it", not still, f"{len(still)} line(s) still listed")


def phase4(rig: Rig, ctx: dict) -> None:
    for fn in (v_short, v_partial, v_over, v_wrong, v_recount, v_reject, v_cancel):
        fn(rig, ctx)


PHASES = {"1": phase1, "2": phase2, "2b": phase2b, "3": phase3, "4": phase4}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--phase", default="1")
    parser.add_argument("--tag", default="UJI1")
    parser.add_argument("--po", help="reuse this existing PO number for phase 1")
    parser.add_argument("--skus", help="comma list of SKU codes, to run phase 2/3 without phase 1")
    args = parser.parse_args()
    rig = Rig()
    ctx: dict = {"tag": args.tag, "po": args.po}
    if args.skus:
        ctx["skus"] = {k: "" for k in args.skus.split(",")}
    made = make_item(rig.as_("cloud", "rina"), args.tag)
    ctx.update(made)
    for p in args.phase.split(","):
        PHASES[p](rig, ctx)
    failed = [r for r in results if not r[1]]
    print(f"\n{len(results) - len(failed)}/{len(results)} checks passed")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
