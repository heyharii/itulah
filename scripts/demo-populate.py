#!/usr/bin/env python3
"""Put a small, consistent trading history behind every menu of the demo.

    python3 scripts/demo-populate.py --cloud http://127.0.0.1:8180 \
        --dc http://127.0.0.1:8181 --store http://127.0.0.1:8182 --printer-port 9109

Runs after `demo-seed.sh` (suppliers, people, HR setup, open period). Every
stage goes through the routes the apps use, in the only order the domain
accepts, so the rows it leaves are the rows the apps would have left:

  goods      PO per supplier → DC receives → Nina counts → Yusuf verifies →
             supplier invoice → article setup in Cloud → tagging job → labels
             printed (to a label sink) → units with EPCs in the DC warehouse

Later stages build on what the earlier ones wrote; a stage that finds its work
already done (by name) skips, so a re-run on a seeded node is harmless.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import os
import sys
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path


class Node:
    def __init__(self, base: str, name: str, token: str | None = None, user: str | None = None):
        self.base, self.name, self.token, self.user = base.rstrip("/"), name, token, user

    def login(self, username: str, password: str) -> "Node":
        """The same node, acting as `username` (bearer token). On a rig with
        sign-in off there is nothing to sign in to: every call is `development`."""
        # An edge learns its sign-in assignments from Cloud over sync, a few
        # seconds after demo-seed makes them: a 401 right after a reset means
        # "not here yet", so keep asking for up to a minute.
        deadline = time.time() + 60
        while True:
            payload = Node(self.base, self.name).call(
                "POST", "/api/v1/auth/login", {"username": username, "password": password}, ok=None)
            if isinstance(payload, dict) and payload.get("token"):
                return Node(self.base, f"{self.name}:{username}", payload["token"], username)
            if time.time() > deadline:
                raise SystemExit(f"{self.name}: cannot sign in as {username}: {payload}")
            time.sleep(3)

    def call(self, method: str, path: str, body=None, ok=(200, 201)):
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
            except json.JSONDecodeError:
                status, payload = error.code, raw[:300].decode("utf-8", "replace")
        if ok and status not in ok:
            raise SystemExit(f"{self.name} {method} {path} → {status}: {payload}")
        return payload

    def get(self, path):
        return self.call("GET", path)

    def post(self, path, body):
        return self.call("POST", path, body)


def rows(payload):
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        for key in ("items", "rows", "data", "results"):
            if isinstance(payload.get(key), list):
                return payload[key]
    return []


def wait_for(label, probe, timeout=120, every=3):
    deadline = time.time() + timeout
    while time.time() < deadline:
        found = probe()
        if found:
            return found
        time.sleep(every)
    raise SystemExit(f"timed out waiting for {label}")


def step(title):
    print(f"\n\033[1m── demo-populate: {title}\033[0m", flush=True)


# ---------------------------------------------------------------------------
# goods

# Quantity ordered per supplier item, and how the article is set up: the
# colours and sizes it is made in and the retail price it goes out at.
QTY = 6
RETAIL = {  # supplier_item_code → retail price (IDR)
    "GN-KMJ-01": 199000, "GN-KAO-01": 89000, "GN-BLS-01": 159000,
    "GN-CLN-01": 249000, "GN-KAO-02": 69000, "SS-SNK-01": 329000,
    "SS-LOF-01": 399000, "SS-SDL-01": 99000, "SS-FLT-01": 279000,
    "SS-TAS-01": 219000,
}


def stage_goods(cloud: Node, dc: Node, printer_port: int, as_user=None):
    nina = as_user("dc", "nina") if as_user else dc
    yusuf = as_user("dc", "yusuf") if as_user else dc
    # Only whoever raised the order may verify its counts (buying rules, Sep
    # 2026): the orders below are rina's, so rina verifies at the DC.
    rina = as_user("dc", "rina") if as_user else dc
    step("goods — PO → receive → count → verify → invoice → article → tagging → labels")
    existing = {po["po_number"] for po in rows(cloud.get("/api/v1/purchase-orders?limit=200"))}
    suppliers = rows(cloud.get("/api/v1/suppliers?limit=50"))
    created = {}  # po_number → lines, for the orders placed in this run
    for n, supplier in enumerate(sorted(suppliers, key=lambda s: s["supplier_code"]), start=1):
        code = supplier["supplier_code"]
        po_number = f"PO-DEMO-{n:03d}"
        if po_number in existing:
            print(f"  = {po_number} already there")
            continue
        items = rows(cloud.get(f"/api/v1/suppliers/{supplier['supplier_id']}/items?limit=50"))
        items = [i.get("item", i) for i in items]
        lines = [{
            "article_code": item["supplier_item_code"], "article_name": item["name"],
            "image_url": item.get("image_url"), "division_code": item.get("division_code"),
            "tags": item.get("tags") or [], "ordered_quantity": QTY,
            "unit_price_minor": item["unit_price_minor"],
        } for item in items]
        ordered_price = {line["article_code"]: line["unit_price_minor"] for line in lines}
        cloud.post("/api/v1/purchase-orders", {
            "po_number": po_number, "supplier_id": code, "supplier_name": supplier["name"],
            "destination_site_id": "dc", "origin_kind": "SOURCING", "currency": "IDR",
            "notes": "Pesanan demo", "created_by": "rina", "lines": lines,
        })
        created[po_number] = len(lines)
        print(f"  + {po_number} {supplier['name']}: {len(lines)} lines × {QTY}")

        po_lines = wait_for(f"{po_number} at the DC", lambda: [
            line for line in rows(dc.get("/api/v1/dc/purchase-orders?limit=200"))
            if line.get("po_number") == po_number] or None, 120)
        receipt = nina.post("/api/v1/dc/goods-receipts", {
            "supplier_id": code, "actor_id": "nina", "idempotency_key": str(uuid.uuid4())})
        total = 0
        for line in po_lines:
            count = nina.post("/api/v1/dc/purchase-counts", {
                "receipt_id": receipt["receipt_id"], "po_line_id": line["po_line_id"],
                "counted_quantity": QTY, "actor_id": "nina",
                "idempotency_key": str(uuid.uuid4())})
            # The price agreed on the order, not whatever the DC listing echoes.
            price = ordered_price[line["article_code"]]
            # A count exactly as ordered is received on its own (owner, 2 Oct),
            # so an Accept that finds it already accepted is the rule working.
            verified = rina.call("POST", "/api/v1/dc/purchase-verifications", {
                "count_id": count["count_id"], "verifier_actor_id": "rina",
                "decision": "Accept", "invoice_unit_price_minor": price,
                "idempotency_key": str(uuid.uuid4())}, ok=None)
            if isinstance(verified, dict) and verified.get("error") and "already accepted" not in str(verified["error"]):
                raise SystemExit(f"dc:rina POST /api/v1/dc/purchase-verifications: {verified}")
            total += price * QTY
        yusuf.call("POST", f"/api/v1/dc/goods-receipts/{receipt['receipt_id']}/invoice", {
            "receipt_id": receipt["receipt_id"], "invoice_number": f"INV-{code}-{n:03d}",
            "invoice_total_minor": total, "actor_id": "yusuf",
            "idempotency_key": str(uuid.uuid4())})
        print(f"    received, counted by nina, verified by rina, invoice Rp {total:,}")

    # Every verified line waits in Cloud as "unidentified" until merchandising
    # says what it is: colours, sizes, how many of each, and the retail price.
    catalogue = {}
    for supplier in suppliers:
        for item in rows(cloud.get(f"/api/v1/suppliers/{supplier['supplier_id']}/items?limit=50")):
            item = item.get("item", item)
            catalogue[item["supplier_item_code"]] = item
    def unidentified():
        return [row for row in rows(cloud.get("/api/v1/article-setups/unidentified"))
                if row.get("po_number", "").startswith("PO-DEMO-")]
    # Wait for every line of every order placed in this run, not the first
    # supplier's lines to arrive: the two receipts sync up separately.
    expected = sum(created.values())
    waiting = unidentified() if expected == 0 else wait_for("receipt lines in Cloud", lambda: (
        unidentified() if len(unidentified()) >= expected else None), 240, 4)
    if not waiting:
        return
    # In a fixed order, so every reset mints the same article codes (and so the
    # same SKU codes): testers keep links and scripts across resets.
    for row in sorted(waiting, key=lambda r: (r["po_number"], r["supplier_article_code"])):
        item = catalogue[row["supplier_article_code"]]
        colours = ([c["colour_code"] for c in item.get("colours") or []] or ["BLACK"])[:2]
        sizes = (item.get("size_codes") or ["00"])[:3]
        grid = [(d, s) for d in range(1, len(colours) + 1) for s in sizes]
        each, extra = divmod(row["quantity"], len(grid))
        variants = [{"colour_digit": str(d), "size_code": s,
                     "quantity": each + (1 if i < extra else 0),
                     "base_price_minor": RETAIL[row["supplier_article_code"]]}
                    for i, (d, s) in enumerate(grid)]
        variants = [v for v in variants if v["quantity"] > 0]
        session = cloud.post("/api/v1/article-setups", {
            "receipt_line_id": row["receipt_line_id"], "article_code": None,
            "article_name": row["article_name"], "division_code": row["division_code"],
            "tags": row.get("tags") or [], "image_url": item.get("image_url"),
            "currency": "IDR",
            "colours": [{"colour_digit": str(d), "colour_code": c}
                        for d, c in enumerate(colours, start=1)],
            "variants": variants, "created_by": "rina"})
        cloud.post(f"/api/v1/article-setups/{session['session_id']}/issue", {"issued_by": "rina"})
        print(f"  + article {row['article_name']}: {len(colours)} colour × {len(sizes)} size, "
              f"Rp {RETAIL[row['supplier_article_code']]:,}")

    # Each issued setup becomes a tagging job at the DC: print one label per
    # unit, each with its own EPC. The labels go to a sink on this machine.
    def open_jobs():
        return [job for job in rows(dc.get("/api/v1/dc/tagging-jobs"))
                if job.get("status") not in ("DONE", "COMPLETED", "PRINTED")]
    jobs = wait_for("tagging jobs at the DC", lambda: (
        open_jobs() if len(open_jobs()) >= len(waiting) else None), 180, 4)
    printed = 0
    for job in jobs:
        session = nina.post("/api/v1/dc/print-sessions", {
            "job_id": job["job_id"], "printer_host": "127.0.0.1", "printer_port": printer_port,
            "label_width_mm": 58, "label_height_mm": 40, "chunk_size": 10, "actor_id": "nina"})
        run = nina.call("POST", f"/api/v1/dc/print-sessions/{session['session_id']}/run",
                      {"actor_id": "nina"})
        printed += run.get("printed", 0)
        # Nina confirms the tags are on: the units leave "untagged" for the
        # warehouse, which is what makes them pickable.
        nina.post("/api/v1/dc/tagging-confirmations", {
            "job_id": job["job_id"], "actor_id": "nina", "idempotency_key": str(uuid.uuid4())})
    print(f"  printed {printed} labels for {len(jobs)} tagging jobs, tagging confirmed by nina")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--cloud", default="http://127.0.0.1:8180")
    parser.add_argument("--dc", default="http://127.0.0.1:8181")
    parser.add_argument("--store", default="http://127.0.0.1:8182")
    parser.add_argument("--printer-port", type=int, default=9109)
    parser.add_argument("--password", help="demo password on a sign-in rig (or DEMO_PASSWORD)")
    parser.add_argument("--only", help="comma-separated stages to run (default: all)")
    args = parser.parse_args()
    cloud, dc, store = Node(args.cloud, "cloud"), Node(args.dc, "dc"), Node(args.store, "store")
    password = args.password or os.environ.get("DEMO_PASSWORD")
    nodes = {"cloud": cloud, "dc": dc, "store": store}
    signed_in: dict = {}

    def as_user(node: str, username: str) -> Node:
        """`node` ('cloud' | 'dc' | 'store') acting as `username`, so every
        step is done — and audited — by the person whose job it is."""
        if not password:
            return nodes[node]
        if (node, username) not in signed_in:
            signed_in[(node, username)] = nodes[node].login(username, password)
        return signed_in[(node, username)]

    if password:
        # Defaults: head office work at Cloud is Rina's, the DC's is Yusuf's,
        # the shop's is Maya's. Stages ask for someone else where it matters.
        cloud, dc, store = as_user("cloud", "rina"), as_user("dc", "yusuf"), as_user("store", "maya")
    # Stages after goods live one per file in scripts/demo_stages/<name>.py,
    # each exposing run(cloud, dc, store, ctx). ORDER is the domain's order:
    # stock has to reach the shop before it can be sold, prices have to be
    # published before a till can ring them up, and so on.
    stages = {"goods": lambda: stage_goods(cloud, dc, args.printer_port, as_user)}
    ctx = {"printer_port": args.printer_port, "as_user": as_user, "password": password}
    for name in ORDER[1:]:
        path = STAGES_DIR / f"{name}.py"
        if path.exists():
            stages[name] = (lambda path=path, name=name: load_stage(path, name).run(cloud, dc, store, ctx))
    failed = []
    for name, run in stages.items():
        if args.only and name not in args.only.split(","):
            continue
        # One stage's refusal is reported, not allowed to stop the rest: a demo
        # with nine domains filled and one flagged beats one with three.
        try:
            run()
        except (SystemExit, Exception) as error:  # noqa: BLE001
            failed.append(name)
            print(f"\n!! stage {name} failed: {error}", flush=True)
    if password and not args.only:
        tidy_notices(as_user)
    if failed:
        print(f"\n!! failed stages: {', '.join(failed)}", flush=True)
        return 1
    return 0


def tidy_notices(as_user) -> None:
    """The "goods arrived without an identity" notices go out when a delivery
    is verified and are not withdrawn when merchandising sets the goods up a
    minute later. Everything the demo received has been set up, so the people
    they were sent to have read them — the way a person would, one by one."""
    read = 0
    for node, user, prefix in (("store", "maya", "/api/v1/store/central/"), ("cloud", "rina", "/api/v1/")):
        who = as_user(node, user)
        page = who.call("GET", prefix + "notifications", ok=None)
        items = page if isinstance(page, list) else (
            (page or {}).get("items") or (page or {}).get("notifications") or (page or {}).get("rows") or [])
        for notice in items:
            if "identity" in json.dumps(notice).lower() and not notice.get("read_at"):
                who.call("POST", prefix + f"notifications/{notice.get('id') or notice.get('notification_id')}/read",
                         {}, ok=None)
                read += 1
    print(f"\n── demo-populate: tidy — {read} 'goods without an identity' notices read by maya and rina",
          flush=True)


# finance is last of the small, one-example-of-everything stages on purpose:
# its bank statement mirrors every movement on the head-office bank account,
# so the payroll paid by `people`, the shop's deposits from `sales` and
# anything else touching the bank must exist first. finance_volume runs after
# it and piles months of extra volume on top, through the same routes.
ORDER = ["goods", "outbound", "commercial", "sales", "ga", "people", "finance", "finance_volume"]
STAGES_DIR = Path(__file__).with_name("demo_stages")


def load_stage(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(f"demo_stage_{name}", path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


if __name__ == "__main__":
    sys.exit(main())
