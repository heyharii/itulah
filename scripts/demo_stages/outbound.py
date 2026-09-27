"""outbound — stock leaves the DC for store-01, and then somebody counts it.

Runs after `goods` (60 tagged units in `dc.warehouse`). Everything goes
through the routes the apps use, in the order the domain accepts:

  1. Rina allots 32 units to store-01 at head office (hub /allotment):
     every article's first colour in every size, plus five bags.
  2. Nina picks them in one round (floor /ambil → POST dc/picklists), packs
     two sealed koli (floor /kemas → POST dc/packs): garments in one, shoes
     and bags in the other.
  3. Yusuf writes the surat jalan (floor /kirim → POST dc/shipments + the
     per-koli SHIPMENT stage), puts it on a truck, loads it, sends it away
     and marks both koli in transit (floor /kirim/muat).
  4. Maya receives the delivery at store-01 (the store edge's receive route),
     Maya puts 30 of the 32 on the shop floor; two bags stay in the stockroom.
  5. A small restock (6 units) is left half done on purpose, so every floor
     screen has live work: one line still to pick, one picked and not boxed,
     one koli sealed and waiting for a surat jalan, one surat jalan on a truck
     that is still in the yard.
  6. Rina opens a cycle count of the DC warehouse; Nina walks it on the floor
     (/opname) and does not find one pair of sandals. The count is left open
     (entries recorded, not submitted) — see `count_dc_warehouse` for why.
  7. Two RFID handhelds are registered (one per edge) and each sweeps its
     racks, device-signed exactly like scripts/rfid_simulator.py does.

Rest of the goods (22 units) stay on the DC racks.

Re-runnable: every step looks for its own work first (allotments by note,
koli/shipments/trucks by count, store stock by pool) and skips if found.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

STORE = "store-01"
DC_WAREHOUSE = "dc.warehouse"
MAIN_NOTE = "Kiriman perdana store-01"
RESTOCK_NOTE = "Isi ulang store-01 (menunggu)"
# Article CODES are minted in the order the setups ran, which differs run to
# run, so everything here is chosen by article NAME and colour position.
BAG = "Tas Selempang Kanvas"        # one size; 3 of colour 1 and 2 of colour 2 go
MISSING_ARTICLE = "Sandal Slide Karet"  # colour 2, largest size: not found in the count
GARMENT_SUPPLIER = "SUP-001"         # PT Garmen Nusantara: box 1; everything else box 2
STOCKROOM_KEEP = 2  # bags that stay in the store's stockroom


def run(cloud, dc, store, ctx):
    print("\n\033[1m── demo-populate: outbound — allot → pick → pack → ship → receive; count, RFID\033[0m",
          flush=True)
    # Each step is done — and, with sign-in on, audited — as the person whose
    # job it is. With sign-in off `as_user` hands back the plain node.
    nodes = {"cloud": cloud, "dc": dc, "store": store}
    global _AS
    _AS = ctx.get("as_user") or (lambda node, user: nodes[node])
    cloud = _AS("cloud", "rina")
    if not _allotment(cloud, MAIN_NOTE):
        _wait_for_dc_stock(cloud, dc)
    catalogue = _catalogue(cloud)
    plan = _plan(catalogue)

    main = _allot_main(cloud, catalogue, plan)
    _pick_pack_ship_main(dc, main, catalogue)
    shipment = _receive_at_store(cloud, dc, store, catalogue)
    _to_shop_floor(store, catalogue)
    _restock_half_done(cloud, dc, catalogue, plan["restock"])
    count_id = count_dc_warehouse(cloud, dc, plan["missing"])
    devices = _rfid_sweeps(cloud, dc, store, plan["missing"])

    floor, stockroom = _store_positions(store, catalogue)
    ctx["store_stock"] = floor
    ctx["store_stockroom"] = stockroom
    ctx["store_shipment_reference"] = shipment
    ctx["dc_open_count_id"] = count_id
    ctx["rfid_devices"] = devices
    print(f"  store-01: {len(floor)} on the floor, {len(stockroom)} in the stockroom; "
          f"ctx['store_stock'] set")


# ---------------------------------------------------------------------------
# helpers

_AS = None  # (node, username) -> Node, set by run()


def _rows(payload):
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        for key in ("items", "rows", "lines", "data", "results", "deliveries"):
            if isinstance(payload.get(key), list):
                return payload[key]
    return []


def _wait(label, probe, timeout=150, every=3):
    deadline = time.time() + timeout
    while time.time() < deadline:
        found = probe()
        if found:
            return found
        time.sleep(every)
    raise SystemExit(f"outbound: timed out waiting for {label}")


def _nudge(*nodes):
    """Ask the edges to sync now rather than at the next five-second tick."""
    for node in nodes:
        node.call("POST", "/api/v1/sync/trigger", {}, ok=None)


def _wait_for_dc_stock(cloud, dc):
    """Plan only once head office sees every unit the DC's own racks hold.
    Right after tagging, the DC's facts can still be on their way up."""
    def racks():
        return sum(p["stock"] for p in _rows(dc.get("/api/v1/inventory/pools"))
                   if p["id"] == DC_WAREHOUSE)
    def caught_up():
        _nudge(dc)
        here = racks()
        seen = (cloud.get("/api/v1/inventory/availability?limit=1") or {}).get("stock_qty", 0)
        return here > 0 and seen >= here
    _wait("DC stock at head office", caught_up, 300, 4)


def _catalogue(cloud):
    """sku_code → {sku_id, article_name, colour, size, cost}. Cost is what the
    supplier charged (the order price), which is what a shop books a unit in
    at — never its selling price."""
    cost, supplier_of = {}, {}
    for supplier in _rows(cloud.get("/api/v1/suppliers?limit=50")):
        for item in _rows(cloud.get(f"/api/v1/suppliers/{supplier['supplier_id']}/items?limit=50")):
            item = item.get("item", item)
            cost[item["name"]] = item["unit_price_minor"]
            supplier_of[item["name"]] = supplier["supplier_code"]
    out = {}
    for row in _rows(cloud.get("/api/v1/inventory/availability?limit=500")):
        out[row["sku_code"]] = {
            "sku_id": row["sku_id"], "article_name": row["article_name"],
            "colour": row.get("colour"), "size": row.get("size"),
            "stock": row.get("stock_qty", 0), "cost": cost.get(row["article_name"], 0),
            "supplier": supplier_of.get(row["article_name"]),
        }
    if not out:
        raise SystemExit("outbound: no SKUs in availability — run the goods stage first")
    return out


def _plan(catalogue):
    """Which units go where, derived from names so it is the same every run.

    main     every SKU of each article's first colour, all its units (27), plus
             two of the bag's second colour — 32 units.
    restock  colour 2, second size, of the first six sized articles by name
             (not the bag, not the sandals the count is short of) — 6 units.
    missing  the sandals' colour 2, largest size.
    """
    by_article = {}
    for code, row in catalogue.items():
        by_article.setdefault(row["article_name"], []).append(code)
    main, restock, missing = {}, [], None
    for name in sorted(by_article):
        codes = sorted(by_article[name])  # colour digit then size code
        first = [c for c in codes if c[8] == "1"]
        second = [c for c in codes if c[8] == "2"]
        for code in first:
            if catalogue[code]["stock"] > 0:
                main[code] = catalogue[code]["stock"]
        if name == BAG:
            for code in second:
                main[code] = max(catalogue[code]["stock"] - 1, 0)
        elif name == MISSING_ARTICLE:
            missing = second[-1] if second else None
        elif len(restock) < 6 and len(second) >= 2:
            restock.append(second[1])
    return {"main": {c: q for c, q in main.items() if q > 0}, "restock": restock,
            "missing": missing}


def _allotment(cloud, note):
    for row in _rows(cloud.get("/api/v1/inventory/allotments?limit=500")):
        if row.get("notes") == note and row.get("status") != "CANCELLED":
            return row
    return None


def _create_allotment(cloud, note, quantities, catalogue):
    # The centre allots against the DC's facts as they have reached it; right
    # after tagging those can still be on their way up, so wait for them.
    def enough():
        on_hand = {r["sku_code"]: r.get("on_hand_qty", 0)
                   for r in _rows(cloud.get("/api/v1/inventory/availability?limit=500"))}
        return all(on_hand.get(code, 0) >= qty for code, qty in quantities.items())
    _wait("DC stock at head office", enough, 300, 4)
    lines =[{"source_site_id": "dc", "source_pool_id": DC_WAREHOUSE,
              "destination_type": "STORE", "destination_id": STORE,
              "sku_id": catalogue[code]["sku_id"], "quantity": qty}
             for code, qty in sorted(quantities.items())]
    return cloud.post("/api/v1/inventory/allotments", {
        "type": "TO_STORE", "lines": lines, "notes": note, "actor_id": "rina",
        "idempotency_key": f"demo-outbound:{note}"})


# ---------------------------------------------------------------------------
# 1–3. the first delivery, all the way to the truck leaving

def _allot_main(cloud, catalogue, plan):
    quantities = plan["main"]
    found = _allotment(cloud, MAIN_NOTE)
    if found:
        print(f"  = {found['allotment_number']} ({MAIN_NOTE}) already there")
        detail = cloud.get(f"/api/v1/inventory/allotments/{found['id']}")
        return {"number": found["allotment_number"],
                "skus": {l["sku_code"]: l["quantity"] for l in _rows(detail)}}
    made = _create_allotment(cloud, MAIN_NOTE, quantities, catalogue)
    print(f"  + {made['allotment_number']} by rina: {len(quantities)} SKUs, "
          f"{sum(quantities.values())} units dc.warehouse → {STORE}")
    return {"number": made["allotment_number"], "skus": quantities}


def _pick_pack_ship_main(dc, main, catalogue):
    if len(_rows(dc.get("/api/v1/dc/koli"))) >= 2:
        print("  = first delivery already packed (koli exist) — skipping pick/pack/ship")
        return
    wanted = main["skus"]

    # The allotment reaches the DC as a command; the picklist is what it owes.
    def owed():
        lines = {l["sku_code"]: l["outstanding"] for l in _rows(dc.get("/api/v1/dc/picklist"))}
        return lines if all(lines.get(code, 0) >= qty for code, qty in wanted.items()) else None
    _wait("the allotment at the DC", lambda: (_nudge(dc), owed())[1])

    # One round: Nina walks the racks with the whole sheet.
    result = _AS("dc", "nina").post("/api/v1/dc/picklists", {
        "source_pool_id": DC_WAREHOUSE,
        "lines": [{"sku_code": code, "quantity": qty} for code, qty in sorted(wanted.items())],
        "actor_id": "nina", "note": "Ronde pagi — kiriman perdana store-01",
        "idempotency_key": "demo-outbound:pick-1"})
    print(f"  picked by nina: {result['summary']['total_picked']} units, "
          f"{len(result['refused'])} refused")

    # Two boxes: garments (PT Garmen Nusantara, articles 1–5) and the rest.
    garments = {c: q for c, q in wanted.items() if catalogue[c]["supplier"] == GARMENT_SUPPLIER}
    rest = {c: q for c, q in wanted.items() if catalogue[c]["supplier"] != GARMENT_SUPPLIER}
    koli_ids = []
    for n, box in enumerate((garments, rest), start=1):
        manifest = _AS("dc", "nina").post("/api/v1/dc/packs", {
            "destination_store_id": STORE,
            "lines": [{"sku_code": c, "quantity": q} for c, q in sorted(box.items())],
            "actor_id": "nina", "idempotency_key": f"demo-outbound:pack-{n}", "seal": True})
        koli_ids.append(manifest["koli"]["koli_id"])
        print(f"  packed + sealed by nina: {manifest['koli']['koli_number']} "
              f"({manifest['koli']['unit_count']} pcs)")

    # Surat jalan, then each koli's SHIPMENT stage (floor /kirim does both).
    shipment = _AS("dc", "yusuf").post("/api/v1/dc/shipments", {"koli_ids": koli_ids, "actor_id": "yusuf"})
    for koli_id in koli_ids:
        _AS("dc", "yusuf").post(f"/api/v1/dc/koli/{koli_id}/shipment", {
            "shipment_reference": shipment["shipment_number"], "actor_id": "yusuf",
            "idempotency_key": f"demo-outbound:{koli_id}:shipment"})
    truck = _AS("dc", "yusuf").post("/api/v1/dc/dispatches", {
        "shipment_ids": [shipment["shipment_id"]], "carrier": "Armada DC",
        "vehicle_plate": "B 9123 KXA", "driver_name": "Pak Joko", "actor_id": "yusuf"})
    # /kirim/muat: load every koli, the truck leaves, every koli is in transit.
    for koli_id in koli_ids:
        _AS("dc", "yusuf").post(f"/api/v1/dc/koli/{koli_id}/dispatch", {
            "actor_id": "yusuf", "idempotency_key": f"demo-outbound:{koli_id}:loaded"})
    _AS("dc", "yusuf").post(f"/api/v1/dc/dispatches/{truck['dispatch_id']}/depart", {})
    for koli_id in koli_ids:
        _AS("dc", "yusuf").post(f"/api/v1/dc/koli/{koli_id}/in-transit", {
            "actor_id": "yusuf", "idempotency_key": f"demo-outbound:{koli_id}:in-transit"})
    print(f"  {shipment['shipment_number']} ({shipment['unit_count']} pcs) on "
          f"{truck['dispatch_number']} B 9123 KXA, departed — in transit to {STORE}")


# ---------------------------------------------------------------------------
# 4. the shop receives it

def _store_pool(store, pool_id):
    for pool in _rows(store.get("/api/v1/inventory/pools")):
        if pool["id"] == pool_id:
            return pool
    return {"stock": 0}


def _receive_at_store(cloud, dc, store, catalogue):
    shipments = _rows(dc.get("/api/v1/dc/shipments"))
    first_row = min(shipments, key=lambda s: s["shipment_number"])
    first, expected = first_row["shipment_number"], first_row["unit_count"]
    held = _store_pool(store, f"{STORE}.warehouse")["stock"] + _store_pool(store, f"{STORE}.floor")["stock"]
    if held > 0:
        print(f"  = {STORE} already holds {held} units — skipping receipt")
        return first

    # What was on the truck, EPC by EPC, as head office recorded the DC's
    # in-transit claims. The same list the reconciliation screen matches on.
    def claims():
        _nudge(dc)
        rows = [r for r in _rows(cloud.get("/api/v1/inventory/reconciliations?limit=500"))
                if r.get("destination_store_id") == STORE and r.get("shipment_reference") == first
                and r.get("status") == "DC_ONLY"]
        return rows if len(rows) >= expected else None
    rows = sorted(_wait(f"{first} in transit at head office", claims, 150, 4), key=lambda r: r["epc"])

    # An announced delivery (INVENTORY_STORE_INBOUND_COMMANDS on at the centre)
    # is received blind through the store app's /receive; otherwise the goods
    # arrive unannounced and are booked through the edge's receive route.
    inbound = [d for d in _rows(store.call("GET", "/api/v1/store/inbound?status=IN_TRANSIT", ok=None))
               if first in json.dumps(d)]
    if inbound:
        delivery = inbound[0].get("delivery_id") or inbound[0].get("id")
        _AS("store", "maya").post(f"/api/v1/store/inbound/{delivery}/receive", {
            "epcs": [r["epc"] for r in rows], "actor_id": "maya",
            "idempotency_key": f"demo-outbound:receive:{first}"})
        how = "announced delivery, received blind"
    else:
        _AS("store", "maya").post("/api/v1/store/receive-batch", {
            "lines": [{"epc": r["epc"], "sku_code": r["sku_code"],
                       "unit_price_minor": catalogue[r["sku_code"]]["cost"]} for r in rows],
            "source_dc_id": "dc", "shipment_reference": first, "actor_id": "maya",
            "idempotency_key": f"demo-outbound:receive:{first}"})
        how = "unannounced (store inbound announcements are off at the centre)"
    print(f"  received at {STORE} by maya: {len(rows)} units of {first} — {how}")
    return first


def _store_units(store):
    """epc → {sku_code, place} from the store's own movement history."""
    units = {}
    for move in sorted(_rows(store.get("/api/v1/inventory/movements?limit=1000")),
                       key=lambda m: m["occurred_at"]):
        units.setdefault(move["epc"], {})["place"] = move["to"]
    return units


def _to_shop_floor(store, catalogue):
    if _store_pool(store, f"{STORE}.floor")["stock"] > 0:
        print(f"  = {STORE} floor already stocked")
        return
    units = sorted(epc for epc, u in _store_units(store).items()
                   if u["place"] == f"{STORE}.warehouse:on_hand")
    # EPC = "A1" + the 11-digit SKU code + a serial.
    bags = [epc for epc in units if catalogue.get(epc[2:13], {}).get("article_name") == BAG]
    keep = set(bags[:STOCKROOM_KEEP])
    moved = 0
    for epc in units:
        if epc in keep:
            continue
        # Moving stock needs the SUPERVISOR role at the store edge: Maya's, not Dian's.
        _AS("store", "maya").post("/api/v1/store/movements", {
            "epc": epc, "quantity": 1, "from": f"{STORE}.warehouse:on_hand",
            "to": f"{STORE}.floor:on_hand", "cause": "NORMAL_MOVE",
            "reason": "Pajang ke lantai jual", "actor_id": "maya",
            "idempotency_key": f"demo-outbound:floor:{epc}"})
        moved += 1
    print(f"  maya put {moved} units on the shop floor, {len(keep)} bags stay in the stockroom")


# ---------------------------------------------------------------------------
# 5. the restock, left at every stage so each floor screen has work

def _restock_half_done(cloud, dc, catalogue, skus):
    found = _allotment(cloud, RESTOCK_NOTE)
    if found:
        print(f"  = {found['allotment_number']} ({RESTOCK_NOTE}) already there")
        return
    wanted = {code: 1 for code in skus}
    made = _create_allotment(cloud, RESTOCK_NOTE, wanted, catalogue)
    print(f"  + {made['allotment_number']} by rina: {len(wanted)} units, restock for {STORE}")

    def owed():
        lines = {l["sku_code"]: l["outstanding"] for l in _rows(dc.get("/api/v1/dc/picklist"))}
        return lines if all(lines.get(code, 0) >= 1 for code in skus) else None
    _wait("the restock at the DC", lambda: (_nudge(dc), owed())[1])

    # Five of six picked; the sixth is still on the sheet (floor /ambil).
    picked = skus[:5]
    _AS("dc", "nina").post("/api/v1/dc/picklists", {
        "source_pool_id": DC_WAREHOUSE,
        "lines": [{"sku_code": code, "quantity": 1} for code in picked],
        "actor_id": "nina", "note": "Ronde siang — isi ulang store-01",
        "idempotency_key": "demo-outbound:pick-2"})
    # Two boxes of two. The fifth piece waits at the bench (floor /kemas).
    boxes = []
    for n, box in enumerate((picked[0:2], picked[2:4]), start=3):
        manifest = _AS("dc", "nina").post("/api/v1/dc/packs", {
            "destination_store_id": STORE,
            "lines": [{"sku_code": code, "quantity": 1} for code in box],
            "actor_id": "nina", "idempotency_key": f"demo-outbound:pack-{n}", "seal": True})
        boxes.append(manifest["koli"])
    # The first box gets a surat jalan and a truck that has not left yet
    # (hub /operations/despatch/trucks); the second waits for one (floor /kirim).
    shipment = _AS("dc", "yusuf").post("/api/v1/dc/shipments", {"koli_ids": [boxes[0]["koli_id"]], "actor_id": "yusuf"})
    _AS("dc", "yusuf").post(f"/api/v1/dc/koli/{boxes[0]['koli_id']}/shipment", {
        "shipment_reference": shipment["shipment_number"], "actor_id": "yusuf",
        "idempotency_key": f"demo-outbound:{boxes[0]['koli_id']}:shipment"})
    truck = _AS("dc", "yusuf").post("/api/v1/dc/dispatches", {
        "shipment_ids": [shipment["shipment_id"]], "carrier": "Armada DC",
        "vehicle_plate": "B 9456 KXB", "driver_name": "Pak Rahmat", "actor_id": "yusuf"})
    print(f"  restock: 5 picked, {boxes[0]['koli_number']} on {shipment['shipment_number']} / "
          f"{truck['dispatch_number']} (in the yard), {boxes[1]['koli_number']} sealed awaiting "
          f"a surat jalan, 1 picked not boxed, 1 still to pick")


# ---------------------------------------------------------------------------
# 6. the count

def count_dc_warehouse(cloud, dc, missing_sku):
    """A cycle count of the DC racks, authored at head office, walked on the floor.

    Left ACTIVE with the walk recorded rather than submitted. This cloud build
    passes `inventory.official_count.result.v1` through as an unknown event
    type (cloud.log: "sync apply: unknown event_type passed through"), so a
    submitted count never reaches REVIEW at the centre and can never be
    approved — the adjustment that would move the sandals to `missing` has no
    route that can issue it. An open count with one pair not yet found is the
    honest state the apps can reach.
    """
    reason = "Opname siklus gudang DC"
    existing = [c for c in _rows(cloud.get("/api/v1/inventory/counts?limit=200"))
                if c.get("pool_id") == DC_WAREHOUSE and c.get("reason") == reason]
    if existing:
        print(f"  = DC count already opened ({existing[0]['status']})")
        return existing[0]["id"]
    count = cloud.post("/api/v1/inventory/counts", {
        "site_id": "dc", "pool_id": DC_WAREHOUSE, "kind": "CYCLE", "reason": reason,
        "actor_id": "rina", "idempotency_key": "demo-outbound:count-dc"})
    cloud.post(f"/api/v1/inventory/counts/{count['id']}/activate", {
        "actor_id": "rina", "idempotency_key": "demo-outbound:count-dc:activate"})

    def at_dc():
        _nudge(dc)
        for row in _rows(dc.get("/api/v1/dc/official-counts")):
            if row["count_id"] == count["id"]:
                return dc.get(f"/api/v1/dc/official-counts/{count['id']}")
        return None
    sheet = _wait("the count at the DC", at_dc)
    lines = sheet["lines"]
    found = [{"epc": l["epc"], "sku_code": l["sku_code"], "found_quantity": 1}
             for l in lines if l["sku_code"] != missing_sku]
    _AS("dc", "nina").post(f"/api/v1/dc/official-counts/{count['id']}/entries", {
        "entries": found, "actor_id": "nina",
        "idempotency_key": "demo-outbound:count-dc:entries"})
    print(f"  count of dc.warehouse opened by rina, walked by nina: "
          f"{len(found)} of {len(lines)} found ({missing_sku} not on the rack)")
    return count["id"]


# ---------------------------------------------------------------------------
# 7. RFID handhelds

RFID_PATH = "/api/v1/rfid/observations"


def _device_key(cloud, device_id, origin_id, label, pools):
    """The enrolment key is shown once. A re-run rotates it rather than
    registering the handheld twice."""
    known = {d.get("device_id") for d in _rows(cloud.get("/api/v1/auth/rfid-devices?limit=200"))}
    if device_id in known:
        body = cloud.post(f"/api/v1/auth/rfid-devices/{device_id}/rotate", {})
    else:
        body = cloud.post("/api/v1/auth/rfid-devices", {
            "device_id": device_id, "origin_id": origin_id, "label": label,
            "pools": pools, "offline_ttl_seconds": 604800})
    return body["device_key"]


def _signed_sweep(node, device_id, device_key, site, pool, session, epcs, key):
    payload = {
        "site_id": site, "pool": pool, "reader_session_id": session,
        "observed_at": datetime.now(timezone.utc).isoformat(), "idempotency_key": key,
        "observations": [{"epc": e, "rssi": -48 - (i % 17), "antenna": f"A{1 + i % 2}",
                          "read_count": 2 + i % 5} for i, e in enumerate(epcs)],
    }
    body = json.dumps(payload, separators=(",", ":")).encode()
    # Signed exactly as scripts/rfid_simulator.py signs: the edge holds only
    # sha256(device_key), never the key itself.
    signing_key = hashlib.sha256(device_key.strip().encode()).hexdigest().encode()
    timestamp, sequence = int(time.time()), int(time.time() * 1000)
    canonical = (f"POST\n{RFID_PATH}\n{device_id}\n{timestamp}\n{sequence}\n"
                 f"{hashlib.sha256(body).hexdigest()}")
    signature = hmac.new(signing_key, canonical.encode(), hashlib.sha256).hexdigest()
    request = urllib.request.Request(node.base + RFID_PATH, data=body, method="POST", headers={
        "Content-Type": "application/json", "X-Device-Id": device_id,
        "X-Device-Timestamp": str(timestamp), "X-Device-Sequence": str(sequence),
        "X-Device-Signature": signature})
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.loads(response.read())
    except urllib.error.HTTPError as error:
        return {"error": error.code, "detail": error.read()[:200].decode("utf-8", "replace")}


def _sweep_until_accepted(node, *args):
    # A freshly registered handheld is known at the edge only after the policy
    # the centre published has synced down; until then the edge refuses it.
    deadline = time.time() + 120
    while True:
        result = _signed_sweep(node, *args)
        if "error" not in result or time.time() > deadline:
            return result
        _nudge(node)
        time.sleep(4)


def _rfid_sweeps(cloud, dc, store, missing_sku):
    devices = []
    sessions = {s.get("reader_session_id") for s in _rows(dc.get("/api/v1/rfid/sessions"))}
    if "SWEEP-DC-RAK-01" not in sessions:
        key = _device_key(cloud, "RFID-HH-DC-01", "dc", "Handheld gudang DC", [DC_WAREHOUSE])
        count = next((c for c in _rows(dc.get("/api/v1/dc/official-counts"))), None)
        if count:  # what the racks hold, per the ledger — less the sandals nobody can find
            sheet = dc.get(f"/api/v1/dc/official-counts/{count['count_id']}")
            epcs = [l["epc"] for l in sheet["lines"] if l["sku_code"] != missing_sku]
        else:
            epcs = []
        result = _sweep_until_accepted(dc, "RFID-HH-DC-01", key, "dc", DC_WAREHOUSE,
                                       "SWEEP-DC-RAK-01", epcs, "demo-outbound:sweep-dc")
        print(f"  RFID-HH-DC-01 swept dc.warehouse: "
              f"{result.get('consolidated_sighting_count', result)} tags")
    else:
        print("  = DC handheld sweep already recorded")
    devices.append("RFID-HH-DC-01")

    sessions = {s.get("reader_session_id") for s in _rows(store.get("/api/v1/rfid/sessions"))}
    if "SWEEP-ST01-LANTAI-01" not in sessions:
        key = _device_key(cloud, "RFID-HH-ST01-01", STORE, "Handheld toko store-01",
                          [f"{STORE}.floor"])
        epcs = sorted(epc for epc, u in _store_units(store).items()
                      if u["place"] == f"{STORE}.floor:on_hand")
        result = _sweep_until_accepted(store, "RFID-HH-ST01-01", key, STORE, f"{STORE}.floor",
                                       "SWEEP-ST01-LANTAI-01", epcs, "demo-outbound:sweep-st01")
        print(f"  RFID-HH-ST01-01 swept {STORE}.floor: "
              f"{result.get('consolidated_sighting_count', result)} tags")
    else:
        print("  = store handheld sweep already recorded")
    devices.append("RFID-HH-ST01-01")
    return devices


# ---------------------------------------------------------------------------
# what the sales stage gets

def _store_positions(store, catalogue):
    floor, stockroom = [], []
    for epc, unit in sorted(_store_units(store).items()):
        # The EPC carries the SKU ("A1" + 11-digit SKU + serial); only trust
        # it when the catalogue knows that SKU.
        sku = epc[2:13] if epc[2:13] in catalogue else None
        row = {"epc": epc, "sku_code": sku,
               "article_name": catalogue.get(sku, {}).get("article_name"),
               "pool": unit["place"].split(":")[0]}
        if unit["place"] == f"{STORE}.floor:on_hand":
            floor.append(row)
        elif unit["place"] == f"{STORE}.warehouse:on_hand":
            stockroom.append(row)
    return floor, stockroom
