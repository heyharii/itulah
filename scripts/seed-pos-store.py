#!/usr/bin/env python3
"""seed-pos-store — store-01 made sellable at the till, end to end.

Run through `scripts/seed-pos-store.sh`, which asks for the admin password.
Everything goes through the routes the apps use, in the order the domain
accepts, and every step looks for its own work first, so a second run only
prints what is already there:

  1. sign in    the cloud as `admin`, the store node as STORE_USER (a
                SUPERVISOR there: receiving and moving stock are a
                supervisor's)
  2. receive    every delivery IN_TRANSIT to the store, with the tags head
                office recorded leaving the Gudang for it (transfer
                reconciliation, DC_ONLY). A hosted Gudang that has no such
                rows gives its surat jalan's counts instead, and the delivery
                is received by count — still exactly what was sent, so nothing
                goes to MD's review
  3. floor      everything in the stockroom onto the shop floor: the till
                sells only what is on the floor
  4. promos     six books published to the store, the prototype's PROMOS
                (pos-classic-prototype.html): 30% off two articles, one
                article at a fixed Rp 99K, buy 2 get 1 on one article, members
                Rp 25.000 off from Rp 250.000, coupon HEMAT50 Rp 50.000 off
                from Rp 300.000, 1 point per Rp 10.000 for members. The
                articles are chosen from what is on the floor after step 3.
                A book already published under the same name is kept, and a
                store-wide offer the store is already running is not added
                twice
  5. members    and vouchers: scripts/seed-pos-test-data.sh (idempotent)
  5b. points    the first three members brought up to POINTS_TARGETS (50.000,
                12.000, 3.000) the way a member earns: a bonus-points
                promotion (FIXED_POINTS, gated by a coupon reserved for that
                member, live for two hours) published to the store, and one
                real sale of the cheapest piece on the floor to that member
                with the coupon, paid cash at the store node. The centre
                awards the points when the sale syncs. A member already at or
                above the target is left alone. Then the first member asks
                to redeem REDEEM_POINTS through the member app's own routes
                (a pairing code, the app's session, POST member/points/
                redeem-requests) and the 6-digit code goes in the cheat-sheet
                for F11 — it lives 10 minutes; `--redeem-only` mints a fresh one
  6. cheat-sheet  tags on the floor with their price and promotion, three
                baskets that hit the basket offers, the coupon, members,
                points, the F11 code, vouchers and logins — read from the
                STORE NODE's API

`--more N` (or MORE=N) first sends about N more pieces to the store the way a
restock goes: the free stock at the Gudang (availability), spread over as many
priced SKUs as it takes (a few pieces each, every article and colour in
turn), allotted to the store at head office; then the Gudang picks it, packs it
into sealed koli of at most KOLI_SIZE and dispatches them on one trip (the
surat jalan, in transit). If the free stock is short, what the Gudang already
owes the store on older allotments is picked to make up the rest. Steps 2 and
3 then receive it and put it on the floor. A Gudang the cloud runs
(INVENTORY_DC_HOSTING=cloud) is driven at CLOUD_API; one on its own server at
DC_API. Each run adds another N.

Environment (defaults are the demo at osretail.site):

  argv[1] / CLOUD_API     cloud base            https://osretail.site
  STORE_API               store node base       https://pos.osretail.site
  DC_API                  Gudang server base    (only when the Gudang is not
                                                 hosted in the cloud)
  STORE_ID                the store             store-01
  STORE_USER / STORE_PASSWORD   store sign-in   bima / Password01
  DEMO_ADMIN_PASSWORD     the cloud admin's password (required; the Gudang
                          server takes the same admin)
  MORE                    pieces to send first  0
  POINTS_TARGETS          phone=points,…        081211110001=50000,
                                                081211110002=12000,
                                                081211110003=3000
  REDEEM_POINTS           the F11 request       10000
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent


def _cli():
    import argparse
    parser = argparse.ArgumentParser(description="store-01 made sellable at the till")
    parser.add_argument("cloud", nargs="?", default=os.environ.get("CLOUD_API", "https://osretail.site"))
    parser.add_argument("--more", type=int, default=int(os.environ.get("MORE") or 0),
                        help="send about N more pieces from the Gudang first")
    parser.add_argument("--redeem-only", action="store_true",
                        help="only mint a fresh F11 redemption code for the first member")
    return parser.parse_args()


ARGS = _cli()
CLOUD_API = ARGS.cloud.rstrip("/")
STORE_API = os.environ.get("STORE_API", "https://pos.osretail.site").rstrip("/")
DC_API = os.environ.get("DC_API", "").rstrip("/")
MORE = max(ARGS.more, 0)
KOLI_SIZE = 40
PER_SKU = 4  # pieces of one SKU in one restock, at most
POINTS_TARGETS = [(p.split("=")[0].strip(), int(p.split("=")[1])) for p in os.environ.get(
    "POINTS_TARGETS", "081211110001=50000,081211110002=12000,081211110003=3000").split(",") if "=" in p]
REDEEM_POINTS = int(os.environ.get("REDEEM_POINTS") or 10_000)
STORE = os.environ.get("STORE_ID", "store-01")
STORE_USER = os.environ.get("STORE_USER", "bima")
STORE_PASSWORD = os.environ.get("STORE_PASSWORD", "Password01")
ADMIN_PASSWORD = os.environ.get("DEMO_ADMIN_PASSWORD", "")
FLOOR = f"{STORE}.floor:on_hand"
CHEAT_SHEET_TAGS = 18


class SeedError(Exception):
    pass


class Api:
    """One server, one signed-in session."""

    def __init__(self, name: str, base: str):
        self.name, self.base, self.token, self.user = name, base, None, None

    def call(self, method, path, body=None, *, timeout=60, idempotent=False):
        data = None if body is None else json.dumps(body).encode()
        request = urllib.request.Request(self.base + path, data=data, method=method)
        request.add_header("content-type", "application/json")
        request.add_header("accept", "application/json")
        if idempotent:
            request.add_header("Idempotency-Key", str(uuid.uuid4()))
        if self.token:
            request.add_header("Authorization", f"Bearer {self.token}")
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                raw = response.read()
                return json.loads(raw) if raw else None
        except urllib.error.HTTPError as error:
            detail = error.read()[:400].decode("utf-8", "replace")
            raise SeedError(f"{self.name} {method} {path} -> {error.code}: {detail}") from None
        except urllib.error.URLError as error:
            raise SeedError(f"{self.name} {method} {path}: {error.reason}") from None

    def get(self, path, **kw):
        return self.call("GET", path, **kw)

    def post(self, path, body, **kw):
        return self.call("POST", path, body, **kw)

    def sign_in(self, username, password):
        reply = self.post("/api/v1/auth/login", {"username": username, "password": password})
        self.token, self.user = reply["token"], reply.get("user") or {}
        return self.user


def rows(payload, *keys):
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        for key in keys + ("items", "rows", "data", "results"):
            if isinstance(payload.get(key), list):
                return payload[key]
    return []


def rp(minor) -> str:
    return "Rp " + f"{int(minor or 0):,}".replace(",", ".")


def iso(moment: datetime) -> str:
    return moment.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def step(title):
    print(f"\n\033[1m── {title}\033[0m", flush=True)


def q(text: str) -> str:
    return urllib.parse.quote(text, safe="")


# ─────────────────────────────────────────────────────────────────────────
# 1b. more stock: a restock from the Gudang, allot → pick → pack → dispatch


def wait_for(label, probe, timeout=240, every=4):
    deadline = time.time() + timeout
    while time.time() < deadline:
        found = probe()
        if found:
            return found
        time.sleep(every)
    raise SeedError(f"timed out waiting for {label}")


def nudge(*nodes):
    for node in nodes:
        try:
            node.post("/api/v1/sync/trigger", {})
        except SeedError:
            pass


def gudang(cloud: Api) -> tuple[Api, bool]:
    """The node that answers /api/v1/dc/*: the cloud itself when it runs the
    Gudang, else the Gudang's own server (DC_API) signed in as the same admin."""
    if (cloud.get("/api/v1/health") or {}).get("dc_hosting") == "cloud":
        return cloud, True
    if not DC_API:
        raise SeedError("this cloud's Gudang runs on its own server: set DC_API to it")
    dc = Api("dc", DC_API)
    dc.sign_in("admin", ADMIN_PASSWORD)
    return dc, False


def availability(cloud: Api) -> tuple[list[dict], dict]:
    out, cursor, head = [], "", {}
    for _ in range(100):
        page = cloud.get(f"/api/v1/inventory/availability?limit=500&cursor={q(cursor)}", timeout=120)
        head = head or page
        out += rows(page)
        cursor = (page or {}).get("next_cursor")
        if not cursor:
            break
    return out, head


def spread(free: list[dict], priced: set[str], want: int) -> dict[str, int]:
    """About `want` pieces over as many SKUs as it takes: one piece of every
    SKU per pass, the articles and their colours taken in turn, at most
    PER_SKU of one SKU. Only SKUs the store has a price for — a piece without
    one cannot be rung up."""
    by_article: dict[str, list[dict]] = defaultdict(list)
    for row in free:
        if row["sku_code"] in priced and int(row.get("on_hand_qty") or 0) > 0:
            by_article[row["article_code"]].append(row)
    # Within an article: colour by colour, size by size, interleaved.
    queues = []
    for code in sorted(by_article):
        skus = sorted(by_article[code], key=lambda r: (r["sku_code"][9:], r["sku_code"][8]))
        queues.append(skus)
    plan: Counter = Counter()
    total = 0
    for _ in range(PER_SKU):
        for queue in queues:
            for row in queue:
                if total >= want:
                    return dict(plan)
                if plan[row["sku_code"]] < min(PER_SKU, int(row["on_hand_qty"])):
                    plan[row["sku_code"]] += 1
                    total += 1
    return dict(plan)


def send_more(cloud: Api, store: Api, want: int) -> dict:
    step(f"more — about {want} pieces from the Gudang to {STORE} (allot → pick → pack → dispatch)")
    dc, hosted = gudang(cloud)
    print(f"  the Gudang: {'in the cloud' if hosted else dc.base}")
    free, head = availability(cloud)
    site, pool = head.get("source_site_id") or "dc", head.get("source_pool_id") or "dc.warehouse"
    priced = {s for s, r in store_catalogue(store).items() if r.get("unit_price_minor")}
    # A SKU an older allotment still owes the store is left out: the centre
    # attributes a packed piece to the store's OLDEST open line of its SKU, and
    # a piece packed off a newer picklist would be refused there.
    owed = set()
    for a in rows(cloud.get("/api/v1/inventory/allotments?limit=500")):
        if a.get("status") in ("ACTIVE", "IN_PROGRESS") and STORE in json.dumps(a.get("destination_ids") or []) + \
                json.dumps(a.get("destination_names") or []) + str(a.get("activation_target_origin_id")):
            for l in rows(cloud.get(f"/api/v1/inventory/allotments/{a['id']}"), "lines"):
                if int(l.get("accepted_quantity") or l.get("quantity") or 0) - int(l.get("packed_quantity") or 0) \
                        - int(l.get("cancelled_quantity") or 0) > 0:
                    owed.add(l.get("sku_code"))
    plan = spread(free, priced - owed, want)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    note = f"Isi lantai kasir {STORE} {stamp}"
    allotment = None
    if plan:
        sku_id = {r["sku_code"]: r["sku_id"] for r in free}
        allotment = cloud.post("/api/v1/inventory/allotments", {
            "type": "TO_SITE", "notes": note, "actor_id": cloud.user.get("username", "admin"),
            "idempotency_key": f"seed-pos-store:more:{stamp}",
            "lines": [{"source_site_id": site, "source_pool_id": pool, "destination_type": "STORE",
                       "destination_id": STORE, "sku_id": sku_id[c], "quantity": n}
                      for c, n in sorted(plan.items())]}, timeout=120)
        print(f"  + {allotment['allotment_number']} ({note}): {sum(plan.values())} pcs over "
              f"{len(plan)} SKUs, {pool} → {STORE}")
    else:
        print(f"  = no free priced stock at {pool}")

    # The Gudang's picklists for the store: ours first, then what it already
    # owed the store, oldest first, until `want` is met.
    def picklists():
        nudge(dc)
        return [p for p in rows(dc.get("/api/v1/dc/picklist/allotments")) if p["destination_id"] == STORE]
    if allotment:
        wait_for(f"{allotment['allotment_number']} at the Gudang",
                 lambda: any(p["allotment_id"] == allotment["id"] for p in picklists()))
    if not allotment:
        return {"pieces": 0}
    lists = [p for p in picklists() if p["allotment_id"] == allotment["id"]]
    me = dc.user.get("username", "admin")
    left = want
    for sheet in lists:
        if left <= 0:
            break
        lines = []
        for line in sorted(sheet["lines"], key=lambda l: l["sku_code"]):
            n = min(int(line["outstanding"]), left)
            if n > 0:
                lines.append({"sku_code": line["sku_code"], "quantity": n})
                left -= n
        if not lines:
            continue
        result = dc.post("/api/v1/dc/picklists", {
            "source_pool_id": pool, "lines": lines, "actor_id": me,
            "note": f"Ronde isi lantai kasir {STORE}", "destination_id": STORE,
            "allotment_id": sheet["allotment_id"],
            "idempotency_key": f"seed-pos-store:pick:{stamp}:{sheet['allotment_id']}"}, timeout=300)
        left += sum(int(r["quantity"]) for r in result.get("refused") or [])
        print(f"  picked {result['summary']['total_picked']} pcs for {sheet['allotment_number']}"
              + (f", {len(result['refused'])} lines refused" if result.get("refused") else ""))

    # The bench: everything this user's picklists for the store left in the
    # pick area (this run's, and any a halted run left), packed into sealed
    # koli of at most KOLI_SIZE.
    sessions, waiting = [], Counter()
    for sheet in rows(dc.get("/api/v1/dc/picklists")):
        session = sheet.get("session") or {}
        if (sheet.get("destination_id") == STORE and int(sheet.get("waiting") or 0) > 0
                and sheet.get("allotment_id") == allotment["id"]):
            sessions.append(session["session_id"])
            for l in dc.get(f"/api/v1/dc/pick-sessions/{q(session['session_id'])}").get("lines") or []:
                waiting[l["sku_code"]] += int(l.get("waiting") or 0)
    waiting = +waiting
    boxes, box, size = [], [], 0
    for sku, n in sorted(waiting.items()):
        while n > 0:
            take = min(n, KOLI_SIZE - size)
            box.append({"sku_code": sku, "quantity": take})
            size, n = size + take, n - take
            if size >= KOLI_SIZE:
                boxes.append(box)
                box, size = [], 0
    if box:
        boxes.append(box)
    packed, short = [], Counter()
    for i, lines in enumerate(boxes, start=1):
        for _ in range(len(lines) + 1):
            if not lines:
                break
            try:
                manifest = dc.post("/api/v1/dc/packs", {
                    "destination_store_id": STORE, "lines": lines, "seal": True,
                    "pick_session_ids": sessions, "actor_id": me,
                    "idempotency_key": f"seed-pos-store:pack:{stamp}:{i}:{len(lines)}:"
                                       f"{sum(l['quantity'] for l in lines)}"}, timeout=300)
                packed.append(manifest["koli"]["koli_number"])
                break
            except SeedError as error:
                # The pick area holds fewer of one SKU than its picklist says
                # (a piece without a tag, say): that line as there is, and the
                # rest of the box goes.
                found = re.search(r"only (\d+) of (\d+) ", str(error))
                if "-> 409" not in str(error) or not found:
                    raise
                there, sku = int(found.group(1)), found.group(2)
                for l in lines:
                    if l["sku_code"] == sku:
                        short[sku] += l["quantity"] - there
                        l["quantity"] = there
                lines = [l for l in lines if l["quantity"] > 0]
    if packed:
        print(f"  packed + sealed {len(packed)} koli: {', '.join(packed)}")
    if short:
        print(f"  ! {sum(short.values())} pcs of {len(short)} SKUs picked but not packable "
              f"({', '.join(sorted(short))}) — left in the pick area")

    # Dispatch every sealed koli this user packed for the store that is on no
    # surat jalan yet: the surat jalan and the trip in one act, in transit.
    koli = [k for k in rows(dc.get("/api/v1/dc/koli"))
            if k.get("koli_number") in packed and not k.get("shipment_id")]
    if not koli:
        print("  = no sealed koli waiting for a surat jalan")
        return {"pieces": 0}
    trip = dc.post("/api/v1/dc/dispatch-trips", {
        "koli_ids": [k["koli_id"] for k in koli], "trip_note": f"Isi lantai kasir {STORE}",
        "actor_id": me, "idempotency_key": f"seed-pos-store:trip:{stamp}"}, timeout=300)
    dispatch = trip.get("dispatch") or trip
    if not dispatch.get("departed_at") and dispatch.get("dispatch_id"):
        dc.post(f"/api/v1/dc/dispatches/{dispatch['dispatch_id']}/depart", {})
    references = sorted({s.get("shipment_number") for s in trip.get("shipments") or []} - {None})
    pieces = sum(int(k["unit_count"]) for k in koli)
    print(f"  dispatched {dispatch.get('dispatch_number', '')}: {len(koli)} koli on "
          f"{', '.join(references) or 'a surat jalan'} — {pieces} pcs in transit to {STORE}")

    # Received at step 2 once the store sees the delivery and, for a Gudang on
    # its own server, head office holds its tags in transit.
    def arrived():
        nudge(dc, store)
        seen = {d.get("shipment_reference") for d in
                rows(store.get("/api/v1/store/inbound?status=IN_TRANSIT"), "deliveries")}
        if not set(references) <= seen:
            return False
        if hosted:
            return True
        return sum(len(in_transit_epcs(cloud, ref)) for ref in references) >= pieces
    try:
        wait_for(f"{', '.join(references)} at {STORE}", arrived, 300, 5)
    except SeedError:
        print(f"  ! {', '.join(references)} has not reached {STORE} yet — a re-run receives it")
    return {"pieces": pieces, "references": references}


# ─────────────────────────────────────────────────────────────────────────
# 2. receive what is on its way


def in_transit_epcs(cloud: Api, reference: str) -> dict[str, str]:
    """The tags head office recorded leaving the Gudang on this surat jalan for
    the store and not yet received anywhere — the reconciliation's DC_ONLY.
    EPC → SKU code."""
    epcs, cursor = {}, None
    while True:
        path = (f"/api/v1/inventory/reconciliations?status=DC_ONLY&destination_store_id={q(STORE)}"
                f"&q={q(reference)}&limit=500")
        if cursor:
            path += f"&cursor={q(cursor)}"
        page = cloud.get(path, timeout=120)
        for r in rows(page):
            if r.get("shipment_reference") == reference and r.get("epc"):
                epcs[r["epc"]] = (r.get("sku_code") or "").upper()
        cursor = (page or {}).get("next_cursor")
        if not cursor:
            return epcs


def hosted_dc_counts(cloud: Api, reference: str) -> dict[str, int] | None:
    """What the surat jalan carried, per SKU, from a Gudang the cloud runs."""
    if (cloud.get("/api/v1/health") or {}).get("dc_hosting") != "cloud":
        return None
    shipment = next((s for s in rows(cloud.get("/api/v1/dc/shipments"))
                     if s.get("shipment_number") == reference), None)
    if not shipment:
        return None
    detail = cloud.get(f"/api/v1/dc/shipments/{shipment['shipment_id']}")
    counts = Counter()
    for koli in detail.get("koli") or []:
        for line in koli.get("lines") or []:
            counts[line["sku_code"]] += int(line["quantity"])
    return dict(counts) or None


def receive_deliveries(cloud: Api, store: Api) -> dict:
    step(f"receive — every delivery in transit to {STORE}")
    deliveries = rows(store.get("/api/v1/store/inbound?status=IN_TRANSIT"), "deliveries")
    done = {"deliveries": 0, "units": 0, "missing": 0, "left": []}
    if not deliveries:
        print(f"  = nothing in transit to {STORE}")
        return done
    for delivery in deliveries:
        did, ref = delivery["delivery_id"], delivery.get("shipment_reference")
        label = f"{did[:16]}… {ref or '(no surat jalan)'} · {delivery.get('koli_count')} koli"
        if delivery.get("in_review"):
            print(f"  = {label}: counted, waiting for MD's review — left as it is")
            done["left"].append(f"{ref or did}: in MD's review")
            continue
        manifest_skus = {s.upper() for s in
                         store.get(f"/api/v1/store/inbound/{q(did)}").get("manifest_skus") or []}
        tagged = in_transit_epcs(cloud, ref) if ref else {}
        covered = set(tagged.values())
        if tagged and manifest_skus and not manifest_skus <= covered:
            # Receiving by tag books only the tags given and leaves the rest
            # MISSING at head office; a partial list is not worth that.
            print(f"  ! {label}: head office's tags cover {len(covered & manifest_skus)} of "
                  f"{len(manifest_skus)} SKUs on the manifest — not received by tag")
            tagged = {}
        epcs = sorted(tagged)
        if epcs:
            result = store.post(f"/api/v1/store/inbound/{q(did)}/receive", {
                "epcs": epcs, "actor_id": STORE_USER,
                "idempotency_key": f"seed-pos-store:receive:{did}"}, timeout=300)
            how = f"{len(epcs)} tags"
        else:
            counts = hosted_dc_counts(cloud, ref) if ref else None
            if not counts:
                print(f"  ! {label}: head office holds no tags or counts for it in transit — left as it is")
                done["left"].append(f"{ref or did}: nothing in transit at head office")
                continue
            result = store.post(f"/api/v1/store/inbound/{q(did)}/receive-count", {
                "counts": [{"sku_code": s, "quantity": n} for s, n in sorted(counts.items())],
                "actor_id": STORE_USER,
                "idempotency_key": f"seed-pos-store:receive-count:{did}"}, timeout=300)
            how = f"by count, {sum(counts.values())} pcs over {len(counts)} SKUs"
        outcome = (result.get("delivery") or {}).get("result") or {}
        print(f"  + {label}: received ({how}) — expected {outcome.get('expected_units')}, "
              f"received {outcome.get('received_units')}, missing {outcome.get('missing_units')}, "
              f"extra {outcome.get('extra_units')}"
              + (f", {len(result.get('skipped_epcs') or [])} skipped" if result.get("skipped_epcs") else ""))
        done["deliveries"] += 1
        done["units"] += int(outcome.get("received_units") or 0) + int(outcome.get("extra_units") or 0)
        done["missing"] += int(outcome.get("missing_units") or 0)
    return done


# ─────────────────────────────────────────────────────────────────────────
# 3. the stockroom onto the shop floor


def sku_stock(store: Api) -> list[dict]:
    return rows(store.get("/api/v1/inventory/sku-stock"))


def to_shop_floor(store: Api) -> int:
    step(f"floor — {STORE}'s stockroom onto the shop floor")
    waiting = [(r["sku_code"], int(r.get("warehouse") or 0)) for r in sku_stock(store)
               if int(r.get("warehouse") or 0) > 0]
    if not waiting:
        print("  = nothing in the stockroom; the floor holds it all")
        return 0
    moved = 0
    for sku, quantity in sorted(waiting):
        store.post("/api/v1/store/movements/by-sku", {
            "sku_code": sku, "quantity": quantity, "from": "warehouse", "to": "floor",
            "reason": "Pajang ke lantai jual", "actor_id": STORE_USER,
            "idempotency_key": f"seed-pos-store:floor:{sku}:{uuid.uuid4()}"}, timeout=120)
        moved += quantity
    print(f"  + {moved} pcs over {len(waiting)} SKUs moved warehouse → floor")
    return moved


# ─────────────────────────────────────────────────────────────────────────
# 4. promotions


def store_catalogue(store: Api) -> dict[str, dict]:
    out, cursor = {}, ""
    for _ in range(200):
        page = store.get(f"/api/v1/store/catalog?limit=500&cursor={q(cursor)}")
        for row in rows(page):
            out[row["sku_code"]] = row
        nxt = (page or {}).get("next_cursor")
        if not nxt or nxt == cursor:
            return out
        cursor = nxt
    return out


def rule(rule_id, name, effect, applicability, *, customers="EVERYONE", min_amount=0,
         coupon_code=None, priority=0, stacking="STACKABLE"):
    """A rule shaped as the hub's rule form assembles one (commercial.py's `_rule`),
    narrowed to this store."""
    return {
        "rule_id": rule_id, "campaign_id": None, "name": name, "status": "ACTIVE",
        "scope": {"applicability": applicability, "excluded_sku_codes": [], "site_ids": [STORE],
                  "channels": [], "customers": {"who": customers}, "effect_on": None},
        "conditions": {"min_quantity": 0, "max_quantity": None,
                       "min_amount": {"minor": min_amount}, "max_amount": None,
                       "effective_from": None, "effective_to": None,
                       "days": {"iso_weekdays": []}, "time_window": None},
        "effect": effect, "coupon_code": coupon_code, "max_discount": None,
        "caps": {"budget": None, "spent": {"minor": 0}, "max_uses": None, "used": 0},
        "max_uses_per_customer": None, "priority": priority, "stacking": stacking,
        "exclusive_scope": "BASKET", "advisory": False, "markdown_policy": "EXCLUDE",
        "earn_basis": "POST_DISCOUNT_NET", "points_combination": "HIGHEST", "max_points": None,
    }


class Books:
    """The cloud's price-book log, written as the hub writes it: draft, publish."""

    def __init__(self, cloud: Api):
        self.cloud = cloud
        self.refresh()

    def refresh(self):
        self.items = rows(self.cloud.get("/api/v1/commercial/publications"))

    def named(self, name):
        found = [b for b in self.items if b["name"] == name]
        return next((b for b in found if b["status"] == "PUBLISHED"), found[0] if found else None)

    def detail(self, book):
        return self.cloud.get(f"/api/v1/commercial/publications/{book['id']}")

    def write_and_publish(self, name, **content):
        for attempt in range(3):
            self.refresh()
            found = self.named(name)
            if found and found["status"] == "PUBLISHED":
                return found, False
            actor = self.cloud.user.get("username", "admin")
            try:
                if found is None or attempt > 0:
                    body = {
                        "tax_rules": [], "offer_rules": [], "markdowns": [], "rules": [],
                        "coupons": [], "campaigns": [], "effective_to": None,
                        "effective_from": iso(datetime.now(timezone.utc) - timedelta(minutes=1)),
                        **content,
                        "version": max([b["version"] for b in self.items] or [0]) + 1, "name": name,
                        "actor_id": actor, "idempotency_key": str(uuid.uuid4()),
                    }
                    found = self.cloud.post("/api/v1/commercial/publications", body, timeout=300,
                                            idempotent=True)
                self.cloud.post(f"/api/v1/commercial/publications/{found['id']}/publish", {
                    "actor_id": actor, "idempotency_key": str(uuid.uuid4())},
                    timeout=300, idempotent=True)
            except SeedError as error:
                # Another book took the number first, or a draft a halted run
                # left behind was overtaken by a newer one: written again at
                # the next number, as the refusal asks.
                if attempt < 2 and ("-> 409" in str(error) or "version" in str(error)):
                    continue
                raise
            self.refresh()
            return self.named(name), True
        raise SeedError(f"could not publish {name}")


def running_offers(store: Api) -> list[dict]:
    return rows(store.get("/api/v1/store/offers"), "running")


def promoted_skus(offers, catalogue, own_ids, *, unprompted_only=False) -> set[str]:
    """SKUs some other running offer already discounts — kept out of ours, so
    the till shows one promotion per line and the cheat-sheet reads true.
    `unprompted_only`: just the offers a plain scan triggers (no coupon, no member)."""
    out = set()
    for offer in offers:
        if offer["rule_id"] in own_ids or (offer.get("effect") or {}).get("kind") == "EARN_POINTS":
            continue
        if unprompted_only and (offer.get("coupon_code") or offer.get("members_only")):
            continue
        scope = offer.get("applies_to") or {}
        on = scope.get("on")
        if on == "SKU":
            out |= set(scope.get("sku_codes") or [])
        elif on == "ARTICLE":
            out |= {s for s, r in catalogue.items() if r.get("article_code") in set(scope.get("article_codes") or [])}
        elif on == "DIVISION":
            out |= {s for s, r in catalogue.items() if r.get("division_code") in set(scope.get("divisions") or [])}
        elif on == "TAG":
            tags = set(scope.get("tags") or [])
            out |= {s for s, r in catalogue.items() if tags & set(r.get("tags") or [])}
    return out


def articles_on_floor(store: Api, catalogue: dict, names: dict) -> dict[str, dict]:
    by_article: dict[str, dict] = {}
    for row in sku_stock(store):
        floor = int(row.get("floor") or 0)
        item = catalogue.get(row["sku_code"])
        if floor <= 0 or not item or item.get("unit_price_minor") is None:
            continue
        code = item["article_code"]
        if code not in by_article:
            # Every size of the style, in stock or not: a promotion covers the
            # article, so its prices and price sources are judged over all.
            every = {s: r for s, r in catalogue.items() if r.get("article_code") == code}
            by_article[code] = {
                "article_code": code, "units": 0, "skus": [],
                "name": names.get(code) or item["name"], "all_skus": sorted(every),
                "prices": [int(r["unit_price_minor"]) for r in every.values()
                           if r.get("unit_price_minor") is not None],
                "sources": {r.get("price_source") or "" for r in every.values()}}
        by_article[code]["units"] += floor
        by_article[code]["skus"].append(row["sku_code"])
    return by_article


def article_names(cloud: Api, codes) -> dict[str, str]:
    if not codes:
        return {}
    page = cloud.get(f"/api/v1/commercial/products?article_codes={q(','.join(sorted(codes)))}&limit=1000")
    return {r["article_code"]: r["article_name"] for r in rows(page) if r.get("article_name")}


def publish_promotions(cloud: Api, store: Api) -> dict:
    step(f"promotions — the prototype's set, published to {STORE}")
    catalogue = store_catalogue(store)
    codes = {r["article_code"] for r in catalogue.values() if r.get("article_code")}
    names = article_names(cloud, codes)
    stock = articles_on_floor(store, catalogue, names)
    books = Books(cloud)
    offers = running_offers(store)

    ids = {k: f"pos-{STORE}-{k}" for k in ("gajian-30", "fixed-99k", "b2g1", "member-25k", "hemat50", "poin")}
    title = {
        "gajian-30": f"Promotion: Gajian Oktober 30% ({STORE})",
        "fixed-99k": f"Promotion: Harga Rp 99K ({STORE})",
        "b2g1": f"Promotion: Beli 2 gratis 1 ({STORE})",
        "member-25k": f"Promotion: Member Hemat Rp 25.000 ({STORE})",
        "hemat50": f"Promotion: Kupon HEMAT50 ({STORE})",
        "poin": f"Program poin member ({STORE})",
    }
    summary = {"published": [], "kept": [], "equivalent": [], "rules": {}, "notes": []}

    # What is already ours: the articles those books hold stay theirs.
    taken: set[str] = set()
    existing: dict[str, dict] = {}
    for key, name in title.items():
        book = books.named(name)
        if book and book["status"] == "PUBLISHED":
            detail = books.detail(book)
            # The detail carries each rule as {definition, …}.
            existing[key] = {"rules": [r.get("definition") or r for r in detail.get("rules") or []]}
            for r in existing[key]["rules"]:
                scope = (r.get("scope") or {}).get("applicability") or {}
                taken |= {catalogue.get(s, {}).get("article_code") for s in scope.get("sku_codes") or []}
    taken.discard(None)

    busy = promoted_skus(offers, catalogue, set(ids.values()))
    usable = [a for a in stock.values()
              if a["article_code"] not in taken
              and not any("MARKDOWN" in s or "CLEARANCE" in s for s in a["sources"])]
    clean = [a for a in usable if not set(a["all_skus"]) & busy]
    order = lambda a: (-a["units"], -min(a["prices"]), a["article_code"])
    pool = sorted(clean, key=order) + sorted([a for a in usable if a not in clean], key=order)
    chosen: set[str] = set()

    def pick(test=lambda a: True):
        for article in pool:
            if article["article_code"] not in chosen and test(article):
                chosen.add(article["article_code"])
                return article
        return None

    def sku_scope(articles):
        return {"on": "SKU", "sku_codes": sorted({s for a in articles for s in a["all_skus"]})}

    def publish(key, rules, coupons=None):
        name = title[key]
        if key in existing:
            summary["kept"].append(name)
            print(f"  = {name} — already published (v{books.named(name)['version']})")
            return
        book, made = books.write_and_publish(name, rules=rules, coupons=coupons or [])
        (summary["published"] if made else summary["kept"]).append(name)
        print(f"  {'+' if made else '='} {name} → v{book['version']} {'published' if made else 'already published'}")

    def held_rule(key):
        return next(iter(existing.get(key, {}).get("rules") or []), None)

    # Buy 2 get 1: the article with the most pieces on the floor, so a cashier
    # can ring up a whole bundle.
    if key_rule := held_rule("b2g1"):
        summary["rules"]["b2g1"] = key_rule
        publish("b2g1", [])
    elif article := pick(lambda a: a["units"] >= 3) or pick():
        r = rule(ids["b2g1"], f"{article['name']} beli 2 gratis 1",
                 {"kind": "BUY_X_GET_Y", "buy": 2, "get": 1, "reward_bps": 10000},
                 sku_scope([article]))
        summary["rules"]["b2g1"] = r
        publish("b2g1", [r])
        if article["units"] < 3:
            summary["notes"].append(f"only {article['units']} pcs of {article['name']} on the floor: "
                                    "not a whole buy-2-get-1 bundle")
    else:
        summary["notes"].append("no article on the floor for buy 2 get 1")

    # A fixed price: only a cut if every size costs more than it.
    if key_rule := held_rule("fixed-99k"):
        summary["rules"]["fixed-99k"] = key_rule
        publish("fixed-99k", [])
    elif article := pick(lambda a: min(a["prices"]) > 99_000) or pick(lambda a: min(a["prices"]) > 10_000):
        fixed = 99_000 if min(article["prices"]) > 99_000 else min(article["prices"]) * 7 // 10 // 1000 * 1000
        r = rule(ids["fixed-99k"], f"{article['name']} Rp {fixed // 1000}K",
                 {"kind": "FIXED_UNIT_PRICE", "unit_price": {"minor": fixed}}, sku_scope([article]))
        summary["rules"]["fixed-99k"] = r
        publish("fixed-99k", [r])
    else:
        summary["notes"].append("no article on the floor for a fixed price")

    # 30% off two articles.
    if key_rule := held_rule("gajian-30"):
        summary["rules"]["gajian-30"] = key_rule
        publish("gajian-30", [])
    else:
        two = [a for a in (pick(), pick()) if a]
        if two:
            r = rule(ids["gajian-30"], "Gajian Oktober",
                     {"kind": "PERCENT", "bps": 3000, "compound": False}, sku_scope(two))
            summary["rules"]["gajian-30"] = r
            publish("gajian-30", [r])
            if len(two) < 2:
                summary["notes"].append("only one article left on the floor for Gajian Oktober 30%")
        else:
            summary["notes"].append("no article left on the floor for Gajian Oktober 30%")

    # The store-wide three. One the store already runs is not added twice.
    def running_equivalent(test):
        return next((o for o in offers if o["rule_id"] not in ids.values() and o.get("live_now", True)
                     and test(o)), None)

    def amount(o, minor):
        e = o.get("effect") or {}
        return e.get("kind") == "AMOUNT" and (e.get("amount") or {}).get("minor") == minor

    store_wide = [
        ("member-25k",
         lambda o: amount(o, 25_000) and o.get("members_only") and not o.get("coupon_code"),
         lambda: [rule(ids["member-25k"], "Member Hemat", {"kind": "AMOUNT", "amount": {"minor": 25_000}},
                       {"on": "WHOLE_CART"}, customers="MEMBERS", min_amount=250_000, priority=10)], None),
        ("hemat50",
         lambda o: amount(o, 50_000) and (o.get("coupon_code") or "").upper() == "HEMAT50",
         lambda: [rule(ids["hemat50"], "Kupon Hemat 50K", {"kind": "AMOUNT", "amount": {"minor": 50_000}},
                       {"on": "WHOLE_CART"}, min_amount=300_000, coupon_code="HEMAT50", priority=20)],
         [{"code": "HEMAT50", "rule_id": ids["hemat50"], "active": True, "customer_id": None,
           "valid_from": None, "valid_to": None, "max_uses": None}]),
        ("poin",
         lambda o: (o.get("effect") or {}).get("kind") == "EARN_POINTS" and o.get("members_only")
         and ((o.get("effect") or {}).get("spend_per_point") or {}).get("minor") == 10_000,
         lambda: [rule(ids["poin"], "Poin member",
                       {"kind": "EARN_POINTS", "mode": "SPEND_RATE", "spend_per_point": {"minor": 10_000}},
                       {"on": "WHOLE_CART"}, customers="MEMBERS", stacking="ALONE")], None),
    ]
    for key, same, make, coupons in store_wide:
        if key in existing:
            summary["rules"][key] = held_rule(key)
            publish(key, [])
            continue
        twin = running_equivalent(same)
        if twin:
            summary["equivalent"].append(f"{title[key]} = {twin['name']} ({twin['rule_id']})")
            summary["rules"][key] = {"rule_id": twin["rule_id"], "name": twin["name"]}
            print(f"  = {title[key]} — {STORE} already runs {twin['name']} ({twin['rule_id']})")
            continue
        made = make()
        summary["rules"][key] = made[0]
        publish(key, made, coupons)

    # The store has to be charging them before the till can.
    wanted = {r["rule_id"] for r in summary["rules"].values() if r}
    deadline = time.time() + 180
    seen = set()
    while time.time() < deadline:
        seen = {o["rule_id"] for o in running_offers(store)}
        if wanted <= seen:
            break
        try:
            store.post("/api/v1/sync/trigger", {})
        except SeedError:
            pass
        time.sleep(4)
    late = wanted - seen
    print(f"  {STORE} runs {len(wanted & seen)} of {len(wanted)}"
          + (f" — not there yet: {', '.join(sorted(late))}" if late else ""))
    if late:
        summary["notes"].append(f"{STORE} had not picked up {', '.join(sorted(late))} after 3 min; "
                                "it syncs on its own — re-run for the cheat-sheet")
    summary["catalogue"] = catalogue
    summary["names"] = names
    return summary


# ─────────────────────────────────────────────────────────────────────────
# 5. members and vouchers


def members_and_vouchers():
    step("members and vouchers — scripts/seed-pos-test-data.sh")
    env = dict(os.environ, DEMO_ADMIN_PASSWORD=ADMIN_PASSWORD, STORE_DB="/nonexistent/no-local-listing")
    done = subprocess.run([str(HERE / "seed-pos-test-data.sh"), CLOUD_API], env=env,
                          capture_output=True, text=True)
    for line in (done.stdout + done.stderr).splitlines():
        print(f"  {line}")
    if done.returncode != 0:
        raise SeedError(f"seed-pos-test-data.sh stopped with {done.returncode}")


# ─────────────────────────────────────────────────────────────────────────
# 5b. members' points, and one redemption waiting at F11


def points_balance(cloud: Api, member: str) -> int:
    return int((cloud.get(f"/api/v1/customers/{q(member)}/points") or {}).get("balance_points") or 0)


def cheapest_floor_tag(store: Api, catalogue: dict, avoid: set[str]) -> str | None:
    priced = sorted((int(catalogue[e[2:13]]["unit_price_minor"]), e) for e in floor_epcs(store)
                    if e not in avoid and catalogue.get(e[2:13], {}).get("unit_price_minor"))
    return priced[0][1] if priced else None


def give_points(cloud: Api, store: Api) -> dict:
    step("points — members brought up to their test balance by a bonus-points sale")
    done = {"members": [], "notes": []}
    catalogue = store_catalogue(store)
    books = Books(cloud)
    used: set[str] = set()
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    for phone, target in POINTS_TARGETS:
        have = points_balance(cloud, phone)
        if have >= target:
            print(f"  = {phone} holds {have:,} points (target {target:,})")
            done["members"].append((phone, have))
            continue
        need = target - have
        code = f"BONUS{phone[-4:]}{stamp[-6:]}"
        rule_id = f"pos-{STORE}-bonus-{phone}-{stamp}"
        bonus = rule(rule_id, f"Bonus poin uji kasir {phone}",
                     {"kind": "EARN_POINTS", "mode": "FIXED_POINTS", "points": need},
                     {"on": "WHOLE_CART"}, customers="MEMBERS", coupon_code=code)
        until = datetime.now(timezone.utc) + timedelta(hours=2)
        bonus["conditions"]["effective_to"] = iso(until)
        books.write_and_publish(f"Promotion: Bonus poin uji kasir {phone} {stamp} ({STORE})", rules=[bonus],
                                coupons=[{"code": code, "rule_id": rule_id, "active": True,
                                          "customer_id": phone, "valid_from": None,
                                          "valid_to": iso(until), "max_uses": None}])
        wait_for(f"{rule_id} at {STORE}", lambda: (nudge(store), any(
            o["rule_id"] == rule_id for o in running_offers(store)))[1], 180, 4)
        epc = cheapest_floor_tag(store, catalogue, used)
        if not epc:
            done["notes"].append(f"no piece on the floor to sell to {phone} for the bonus points")
            break
        used.add(epc)
        quoted = quote(store, [epc], coupons=[code], member=phone)
        due = int(quoted.get("amount_due_minor") or quoted.get("total_minor") or 0)
        sale = store.post("/api/v1/store/sales", {
            "epcs": [epc], "coupon_codes": [code], "customer_id": phone, "charges": [],
            "tenders": [{"method": "CASH", "amount_minor": due, "reference": None,
                         "voucher_authorization_id": None, "acquirer": None, "card_kind": None}],
            "actor_id": STORE_USER, "idempotency_key": f"seed-pos-store:bonus-sale:{phone}:{stamp}"},
            timeout=120)
        print(f"  + {phone}: bonus {need:,} points published ({code}), sold {epc} for {rp(due)} "
              f"— the till quoted {quoted.get('points_earned') or 0:,} points")
        try:
            balance = wait_for(f"{phone}'s points at head office", lambda: (
                nudge(store), (lambda b: b if b >= target else None)(points_balance(cloud, phone)))[1],
                240, 5)
        except SeedError:
            balance = points_balance(cloud, phone)
            done["notes"].append(f"{phone}: sale {sale.get('sale_id')} not credited yet "
                                 f"({balance:,} points) — it syncs on its own")
        print(f"    {phone} now holds {balance:,} points")
        done["members"].append((phone, balance))
    return done


class MemberApp:
    """The customer app's session: paired with a code the counter issues."""

    def __init__(self, cloud: Api, member: str):
        import http.cookiejar
        self.base, self.member = cloud.base, member
        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))
        code = cloud.post(f"/api/v1/members/{q(member)}/pairing-code", {})
        self.call("POST", "/api/v1/member/session", {"member_id": member, "code": code["code"]})

    def call(self, method, path, body=None):
        request = urllib.request.Request(self.base + path, method=method,
                                         data=None if body is None else json.dumps(body).encode())
        request.add_header("content-type", "application/json")
        csrf = next((c.value for c in self.jar if c.name == "member_csrf"), None)
        if csrf:
            request.add_header("x-csrf-token", csrf)
        try:
            with self.opener.open(request, timeout=30) as response:
                raw = response.read()
                return json.loads(raw) if raw else None
        except urllib.error.HTTPError as error:
            detail = error.read()[:300].decode("utf-8", "replace")
            raise SeedError(f"member app {method} {path} -> {error.code}: {detail}") from None


def redeem_request(cloud: Api) -> dict:
    member = POINTS_TARGETS[0][0] if POINTS_TARGETS else "081211110001"
    step(f"redemption — {member} asks to trade {REDEEM_POINTS:,} points in the member app")
    app = MemberApp(cloud, member)
    try:
        asked = app.call("POST", "/api/v1/member/points/redeem-requests", {"points": REDEEM_POINTS})
    except SeedError as error:
        print(f"  ! {error}")
        return {"member": member, "error": str(error)}
    expires = asked.get("expires_at", "")
    print(f"  + code {asked['code']} for {REDEEM_POINTS:,} points, expires {expires}")
    return {"member": member, "code": asked["code"], "points": asked.get("points"), "expires_at": expires}


def heredoc_rows(script: str, pattern: str) -> list[list[str]]:
    text = (HERE / script).read_text()
    return [line.split("|") for line in text.splitlines() if re.match(pattern, line)]


# ─────────────────────────────────────────────────────────────────────────
# 6. the cheat-sheet


def floor_epcs(store: Api) -> list[str]:
    """Tags whose latest movement (of the store's newest 500) put them on the floor."""
    where: dict[str, str] = {}
    for move in rows(store.get("/api/v1/inventory/movements?limit=500")):  # newest first
        if move.get("epc"):
            where.setdefault(move["epc"], move["to"])
    return sorted(epc for epc, place in where.items() if place == FLOOR)


def quote(store: Api, epcs, coupons=(), member=None):
    return store.post("/api/v1/store/quote", {"epcs": list(epcs), "coupon_codes": list(coupons),
                                              "customer_id": member, "charges": []})


def applied(reply) -> list[str]:
    return [f"{p['name']} −{rp(p['benefit_minor'])}" for p in reply.get("promotions") or []
            if p.get("applied") and p.get("benefit_minor")]


def cheat_sheet(store: Api, promos: dict, receipt: dict, moved: int, more: dict, points: dict,
                redeem: dict):
    step(f"cheat-sheet — {STORE} at the till ({STORE_API})")
    catalogue, names = promos["catalogue"], promos["names"]
    rule_skus = {key: set((((r or {}).get("scope") or {}).get("applicability") or {}).get("sku_codes") or [])
                 for key, r in promos["rules"].items()}
    member_phone = (heredoc_rows("seed-pos-test-data.sh", r"^08\d+\|") or [["081211110001"]])[0][0]
    own = {r["rule_id"] for r in promos["rules"].values() if r}

    tags = floor_epcs(store)
    by_article: dict[str, list[str]] = defaultdict(list)
    for epc in tags:
        sku = epc[2:13]
        if sku in catalogue:
            by_article[catalogue[sku]["article_code"]].append(epc)
    def article_of(key):
        return {catalogue[s]["article_code"] for s in rule_skus.get(key, set()) if s in catalogue}

    picked: list[str] = []
    for key, n in (("b2g1", 3), ("fixed-99k", 2), ("gajian-30", 2)):
        for code in sorted(article_of(key)):
            picked += [e for e in by_article.get(code, []) if e not in picked][:n]
    promo_articles = set().union(*(article_of(k) for k in ("b2g1", "fixed-99k", "gajian-30")))
    busy = promoted_skus(running_offers(store), catalogue, own, unprompted_only=True)
    others = sorted((code for code in by_article if code not in promo_articles),
                    key=lambda c: (any(e[2:13] in busy for e in by_article[c]),
                                   -int(catalogue[by_article[c][0][2:13]].get("unit_price_minor") or 0)))
    for code in others * 3:
        if len(picked) >= CHEAT_SHEET_TAGS:
            break
        spare = [e for e in by_article[code] if e not in picked]
        if spare:
            picked.append(spare[0])

    stock = sku_stock(store)
    on_floor = sum(int(r.get("floor") or 0) for r in stock)
    floor_skus = sum(1 for r in stock if int(r.get("floor") or 0) > 0)
    print(f"\n  Tags on the shop floor — type one into the till's scan field "
          f"({on_floor} pcs over {floor_skus} SKUs on the floor in all)\n")
    print(f"  {'EPC':<26}{'SKU':<14}{'Item':<34}{'Price':>12}  Promotion")
    sellable: list[dict] = []
    for epc in picked:
        try:
            reply = quote(store, [epc])
        except SeedError as error:
            print(f"  {epc:<26}{'':<14}{'(quote refused)':<34}{'':>12}  {error}")
            continue
        if reply.get("unsellable"):
            print(f"  {epc:<26}{epc[2:13]:<14}{'(not sellable)':<34}{'':>12}  {reply['unsellable'][0].get('reason')}")
            continue
        line = (reply.get("lines") or [{}])[0]
        sku = line.get("sku_code") or epc[2:13]
        item = catalogue.get(sku, {})
        hits = applied(reply)
        # Another shop offer that will not share would beat the basket offers
        # below, so a basket is made only of tags none of those touch.
        foreign = any(p.get("applied") and p.get("rule_id") not in own for p in reply.get("promotions") or [])
        sellable.append({"epc": epc, "sku": sku, "price": line.get("unit_price_minor"),
                         "due": reply.get("amount_due_minor"), "article": item.get("article_code"),
                         "foreign": foreign})
        shown = f"{sku[:8]}·{sku[8:]}"
        print(f"  {epc:<26}{shown:<14}{(item.get('name') or '')[:33]:<34}{rp(line.get('unit_price_minor')):>12}  "
              + (", ".join(hits) if hits else
                 ("Beli 2 gratis 1 (scan 3)" if sku in rule_skus.get("b2g1", set()) else "—")))

    print("\n  Baskets that hit the basket offers\n")
    b2g1 = [s["epc"] for s in sellable if s["sku"] in rule_skus.get("b2g1", set())][:3]
    if len(b2g1) == 3:
        reply = quote(store, b2g1)
        print(f"  Beli 2 gratis 1   {' '.join(b2g1)}")
        print(f"                    pay {rp(reply.get('amount_due_minor'))} — {', '.join(applied(reply)) or 'no offer applied'}")
    plain = sorted((s for s in sellable if s["epc"] not in b2g1 and not s["foreign"]),
                   key=lambda s: -(s["due"] or 0))
    def basket(floor_minor):
        out, total = [], 0
        for s in plain:
            out.append(s["epc"])
            total += s["due"] or 0
            if total >= floor_minor + 30_000:
                return out
        return out
    member_basket = basket(250_000)
    if member_basket:
        reply = quote(store, member_basket, member=member_phone)
        print(f"  Member {member_phone}   {' '.join(member_basket)}")
        print(f"                    pay {rp(reply.get('amount_due_minor'))} — "
              f"{', '.join(applied(reply)) or 'no offer applied'}; earns {reply.get('points_earned') or 0} points")
    coupon_basket = basket(300_000)
    if coupon_basket:
        reply = quote(store, coupon_basket, coupons=["HEMAT50"])
        print(f"  Coupon HEMAT50    {' '.join(coupon_basket)}")
        print(f"                    pay {rp(reply.get('amount_due_minor'))} — {', '.join(applied(reply)) or 'no offer applied'}")

    print("\n  Promotions at the store")
    for key in ("gajian-30", "fixed-99k", "b2g1", "member-25k", "hemat50", "poin"):
        r = promos["rules"].get(key)
        if not r:
            continue
        arts = sorted({names.get(c, c) for c in article_of(key)})
        print(f"    {r['name']:<42} {r['rule_id']:<26} {', '.join(arts)}")
    print("    Coupon code: HEMAT50 (Rp 50.000 off from Rp 300.000)")

    members = heredoc_rows("seed-pos-test-data.sh", r"^08\d+\|")
    print("\n  Members (F5, the phone is the member number)")
    for phone, name in members:
        print(f"    {phone}  {name}")
    if points.get("members"):
        print("\n  Points (F5 shows them; F11 Tukar poin)")
        for phone, balance in points["members"]:
            print(f"    {phone}  {balance:>9,} points")
    if redeem.get("code"):
        print(f"\n  F11 Tukar poin — member {redeem['member']}, code {redeem['code']} "
              f"({redeem['points']:,} points, until {redeem['expires_at']}; "
              f"a fresh one: seed-pos-store.sh --redeem-only)")
    elif redeem.get("error"):
        print(f"\n  F11 Tukar poin — no new code for {redeem['member']}: {redeem['error']}")
    print("\n  Vouchers (F2 to check)")
    for code, kind, value, days, member in heredoc_rows("seed-pos-test-data.sh", r"^[A-Z]{2}TEST\d+\|"):
        state = "voided" if code.startswith("GC") and code.endswith("0006") else f"{days} days"
        code = code.replace("TEST", os.environ.get("BATCH") or "TEST", 1)
        print(f"    {code}  {kind:<10} {rp(value):>11}  {state}{'  · ' + member if member else ''}")
    print(f"\n  Logins at {STORE} (password Password01, from seed-pos-door.sh)")
    for _code, name, position, _nik, username, rung in heredoc_rows("seed-pos-door.sh", r"^ST-\d+\|"):
        print(f"    {username:<8} {name:<16} {position:<12} {rung}")
    print(f"    (this run signed in at the store as {STORE_USER})")
    if more.get("pieces"):
        print(f"\n  This run sent {more['pieces']} pcs from the Gudang "
              f"({', '.join(more['references'])})")
    print(f"\n  This run: deliveries received {receipt['deliveries']} ({receipt['units']} pcs, "
          f"{receipt['missing']} missing) · put on the floor {moved} pcs · promotions published "
          f"{len(promos['published'])}, already published {len(promos['kept'])}, "
          f"already running as another rule {len(promos['equivalent'])}")
    for note in receipt["left"] + promos["notes"] + points.get("notes", []):
        print(f"  ! {note}")


def main():
    if not ADMIN_PASSWORD:
        raise SeedError("set DEMO_ADMIN_PASSWORD (scripts/seed-pos-store.sh asks for it)")
    cloud, store = Api("cloud", CLOUD_API), Api(STORE, STORE_API)
    step("sign in")
    cloud.sign_in("admin", ADMIN_PASSWORD)
    print(f"  cloud {CLOUD_API} as admin")
    who = store.sign_in(STORE_USER, STORE_PASSWORD)
    print(f"  {STORE} {STORE_API} as {STORE_USER} ({who.get('role')})")

    if ARGS.redeem_only:
        redeem = redeem_request(cloud)
        if redeem.get("code"):
            print(f"\n  F11 Tukar poin — member {redeem['member']}, code {redeem['code']} "
                  f"({redeem['points']:,} points, until {redeem['expires_at']})")
        return
    more = {}
    if MORE:
        try:
            more = send_more(cloud, store, MORE)
        except SeedError as error:
            print(f"  ! more stock skipped: {error}")
    receipt = receive_deliveries(cloud, store)
    moved = to_shop_floor(store)
    promos = publish_promotions(cloud, store)
    members_and_vouchers()
    try:
        points = give_points(cloud, store)
    except SeedError as error:
        print(f"  ! points skipped: {error}")
        points = {"members": [], "notes": [f"points skipped: {error}"]}
    try:
        redeem = redeem_request(cloud)
    except SeedError as error:
        print(f"  ! redemption skipped: {error}")
        redeem = {}
    cheat_sheet(store, promos, receipt, moved, more, points, redeem)


if __name__ == "__main__":
    try:
        main()
    except SeedError as error:
        print(f"\nseed-pos-store: {error}", file=sys.stderr)
        sys.exit(1)
