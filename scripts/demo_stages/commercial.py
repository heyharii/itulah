"""commercial — price books, promotions, campaigns, vouchers, members.

Runs after `goods`, whose article setups already published one "Harga awal"
book per article (the retail price every SKU goes out at) and which store-01
has activated. This stage adds what merchandising and marketing do next, each
through the route the hub's own sheet calls, in the order the domain accepts:

  1. members        4 shoppers enrolled at the counter (card number = phone)
  2. points scheme  a published EARN_POINTS rule — 1 point per Rp 10.000 —
                    so a member's purchase in the sales stage earns points
  3. campaigns      "Pekan Sepatu" and "Gajian Hemat", each with a banner,
                    headline and terms; an objective saved beside the first
  4. promotions     15% off SANDAL_SEPATU (inside Pekan Sepatu), 10% off
                    WANITA (loose), coupon HEMAT50 — Rp 50.000 off a basket of
                    Rp 300.000+ (inside Gajian Hemat)
  5. price changes  a markdown (Sandal Slide Karet 99.000 → 79.000 at store-01)
                    and a regular price change starting on the 1st of next
                    month (Kaos Basic 89.000 → 95.000)
  6. vouchers       two gift cards and one goodwill card, all free (owner
                    decision 25 Sep: nothing sold, so no journal on issue)
  7. segments       two saved member segments

Who does it, on a rig that requires sign-in (`ctx["as_user"]`):

  rina  @cloud     every book (draft + publish), campaign objectives, the two
                   marketing vouchers, the segments — head office's job
  dian  @cloud     the card enrolments: store-01's cashier, at the hub's counter
                   screen, because the directory is central and the till talks
                   only to its own edge (frontend-hub screens/members/counter)
  maya  @cloud     the goodwill card — a store manager making good on a visit
  maya  @store-01  reads the shop's own book to see it is charging it

With sign-in off `as_user` hands back the plain node and every call is the
node's `development` principal; the bodies still name the person whose job it
is, so the same file runs on both kinds of rig.

Every book is written as a DRAFT and then published, exactly as
`writeAndPublish` in the hub does; publishing dispatches it to store-01, whose
edge then serves it on /catalogue and /promotions. A book already published
under the same name is skipped, a DRAFT left by a halted run is published, so a
re-run is harmless. No SQL: every row here has a route.
"""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timedelta, timezone

STORE = "store-01"
WIB = timezone(timedelta(hours=7))
IMAGE_BASE = "http://localhost:5350/demo-images"  # frontend-hub/public/demo-images

MEMBERS = [  # card number (the shopper's phone) → name
    ("081311110001", "Sari Wulandari"),
    ("081311110002", "Budi Santoso"),
    ("081311110003", "Ayu Lestari"),
    ("081311110004", "Rizky Pratama"),
]


def _rows(payload, *keys):
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        for key in keys + ("items", "rows", "data", "results"):
            if isinstance(payload.get(key), list):
                return payload[key]
    return []


def _iso(moment: datetime) -> str:
    return moment.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _actor(node, who: str) -> str:
    """The name a body's `actor_id` carries: the person signed in on `node`.

    Cloud refuses an `actor_id` that is not the session's user, so on a sign-in
    rig this is always `node.user`. With sign-in off there is no session to
    match and the body names `who`, the person whose job it is.
    """
    return node.user or who


def _slow_post(node, path, body, timeout=300):
    """`node.post` with a longer patience, for writing and publishing a book.

    Publishing dispatches the book to every shop inside one transaction, and
    on a loaded machine that can outlast `Node.call`'s 60 s — at which point the
    client hangs up, the server drops the request and the transaction rolls
    back, leaving the book a DRAFT. Same request, same headers (the session's
    bearer token included), more time.
    """
    request = urllib.request.Request(node.base + path, data=json.dumps(body).encode(),
                                     method="POST")
    request.add_header("content-type", "application/json")
    request.add_header("Idempotency-Key", str(uuid.uuid4()))
    if getattr(node, "token", None):
        request.add_header("Authorization", f"Bearer {node.token}")
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            raw = response.read()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as error:
        raise SystemExit(f"{node.name} POST {path} → {error.code}: {error.read()[:300]!r}")


def _step(title):
    print(f"\n\033[1m── demo-populate: {title}\033[0m", flush=True)


class Books:
    """The price-book log: what is there, and the next version number.

    `cloud` is the merchandiser's session (Rina): she writes and publishes.
    """

    def __init__(self, cloud):
        self.cloud = cloud
        self.actor = _actor(cloud, "rina")
        self.refresh()

    def refresh(self):
        self.items = _rows(self.cloud.get("/api/v1/commercial/publications"))

    def named(self, name):
        return next((b for b in self.items if b["name"] == name), None)

    def next_version(self):
        return max([b["version"] for b in self.items] or [0]) + 1

    def write_and_publish(self, name, **content):
        """Draft, then publish — the hub's two steps. Skips a published twin."""
        found = self.named(name)
        if found and found["status"] == "PUBLISHED":
            print(f"  = {name} (v{found['version']}) already published")
            return found
        if found is None:
            body = {
                "tax_rules": [], "offer_rules": [], "markdowns": [], "rules": [],
                "coupons": [], "campaigns": [], "effective_to": None,
                "effective_from": _iso(datetime.now(timezone.utc)),
                **content,
                "version": self.next_version(), "name": name,
                "actor_id": self.actor, "idempotency_key": str(uuid.uuid4()),
            }
            found = _slow_post(self.cloud, "/api/v1/commercial/publications", body)
        _slow_post(
            self.cloud, f"/api/v1/commercial/publications/{found['id']}/publish",
            {"actor_id": self.actor, "idempotency_key": str(uuid.uuid4())})
        self.refresh()
        book = self.named(name)
        print(f"  + {name} → v{book['version']} published")
        return book


def _rule(rule_id, name, effect, applicability, *, campaign_id=None, customers="EVERYONE",
          min_amount=0, coupon_code=None, max_uses=None, priority=0):
    """A rule shaped exactly as the hub's rule form assembles one."""
    return {
        "rule_id": rule_id, "campaign_id": campaign_id, "name": name, "status": "ACTIVE",
        "scope": {"applicability": applicability, "excluded_sku_codes": [], "site_ids": [],
                  "channels": [], "customers": {"who": customers}, "effect_on": None},
        "conditions": {"min_quantity": 0, "max_quantity": None,
                       "min_amount": {"minor": min_amount}, "max_amount": None,
                       "effective_from": None, "effective_to": None,
                       "days": {"iso_weekdays": []}, "time_window": None},
        "effect": effect, "coupon_code": coupon_code, "max_discount": None,
        "caps": {"budget": None, "spent": {"minor": 0}, "max_uses": max_uses, "used": 0},
        "max_uses_per_customer": None, "priority": priority, "stacking": "ALONE",
        "exclusive_scope": "BASKET", "advisory": False, "markdown_policy": "EXCLUDE",
        "earn_basis": "POST_DISCOUNT_NET", "points_combination": "HIGHEST", "max_points": None,
    }


def run(cloud, dc, store, ctx):
    now = datetime.now(WIB)
    today = now.replace(hour=0, minute=0, second=0, microsecond=0)

    def end_of(day: datetime) -> datetime:
        return day.replace(hour=23, minute=59, second=59)

    # Each step as the person whose job it is (see the module doc). Without a
    # password `as_user` returns the plain node, so this also runs sign-in off.
    nodes = {"cloud": cloud, "dc": dc, "store": store}
    as_user = ctx.get("as_user") or (lambda node, _username: nodes[node])
    rina = as_user("cloud", "rina")   # merchandising & marketing, head office
    dian = as_user("cloud", "dian")   # store-01's cashier, at the counter screen
    maya = as_user("cloud", "maya")   # store-01's manager
    shop = as_user("store", "maya")   # store-01's own edge

    # ── 1. members ───────────────────────────────────────────────────────
    _step("commercial — members enrolled at the counter (dian, store-01)")
    for member_id, name in MEMBERS:
        # Upsert by card number (`ON CONFLICT DO UPDATE`), so a re-run is a no-op.
        dian.post("/api/v1/members", {"member_id": member_id, "display_name": name})
        print(f"  + member {member_id} {name}")

    books = Books(rina)

    # ── 2. the points scheme ────────────────────────────────────────────
    # Points are only ever earned at a till (loyalty.rs::earn_from_sale), and
    # only if a published book carries an EARN_POINTS rule. This is that rule.
    _step("commercial — points scheme: 1 point per Rp 10.000, members only")
    books.write_and_publish(
        "Program Poin Member",
        rules=[_rule("rule-poin-member", "Poin member: 1 poin per Rp 10.000",
                     {"kind": "EARN_POINTS", "mode": "SPEND_RATE",
                      "spend_per_point": {"minor": 10000}},
                     {"on": "WHOLE_CART"}, customers="MEMBERS")])

    # ── 3. campaigns (the envelope first, as the Campaigns sheet does) ──
    _step("commercial — campaigns with a banner")
    sepatu = {
        "campaign_id": "pekan-sepatu", "name": "Pekan Sepatu", "status": "ACTIVE",
        "valid_from": _iso(today), "valid_to": _iso(end_of(today + timedelta(days=15))),
        "budget_minor": 2_000_000, "max_uses": None,
        "image_url": f"{IMAGE_BASE}/campaign-pekan-sepatu.jpg",
        "headline": "Pekan Sepatu — diskon 15% semua sepatu & sandal",
        "terms": "Berlaku di store-01 selama periode promo. Tidak berlaku untuk barang "
                 "yang sedang turun harga. Tidak dapat digabung dengan promo lain.",
        "site_ids": [STORE],
    }
    gajian = {
        "campaign_id": "gajian-hemat", "name": "Gajian Hemat", "status": "ACTIVE",
        "valid_from": _iso(today - timedelta(days=1)),
        "valid_to": _iso(end_of(today + timedelta(days=9))),
        "budget_minor": 1_000_000, "max_uses": 100,
        "image_url": f"{IMAGE_BASE}/campaign-gajian-hemat.jpg",
        "headline": "Gajian Hemat — potongan Rp 50.000 dengan kupon HEMAT50",
        "terms": "Minimal belanja Rp 300.000 dalam satu struk. Satu kupon per transaksi, "
                 "kuota 100 transaksi.",
        "site_ids": [STORE],
    }
    books.write_and_publish("Campaign: Pekan Sepatu", campaigns=[sepatu])
    # Why the campaign exists — kept at the centre, never sent to a till.
    rina.call("PUT", "/api/v1/commercial/campaigns/pekan-sepatu/intent", {
        "objective": "DRIVE_SALES", "success_metric": "PROMO_SALES",
        "target_direction": "AT_LEAST", "target_value": 5_000_000,
        "baseline_campaign_id": None,
        "notes": "Dorong penjualan alas kaki menjelang akhir bulan.",
        "updated_by": books.actor})
    print("  + objective for Pekan Sepatu: promo sales ≥ Rp 5.000.000")
    books.write_and_publish("Campaign: Gajian Hemat", campaigns=[gajian])
    rina.call("PUT", "/api/v1/commercial/campaigns/gajian-hemat/intent", {
        "objective": "INCREASE_BASKET", "success_metric": "AVERAGE_BASKET",
        "target_direction": "AT_LEAST", "target_value": 350_000,
        "baseline_campaign_id": None,
        "notes": "Naikkan nilai belanja per struk di minggu gajian.",
        "updated_by": books.actor})
    print("  + objective for Gajian Hemat: average basket ≥ Rp 350.000")

    # ── 4. promotions (a rule restates its campaign verbatim) ───────────
    _step("commercial — promotions")
    books.write_and_publish(
        "Promotion: Diskon 15% Sandal & Sepatu",
        effective_from=_iso(datetime.now(timezone.utc)),
        rules=[_rule("rule-sepatu-15", "Diskon 15% Sandal & Sepatu",
                     {"kind": "PERCENT", "bps": 1500, "compound": False},
                     {"on": "DIVISION", "divisions": ["SANDAL_SEPATU"]},
                     campaign_id="pekan-sepatu")],
        campaigns=[sepatu])
    books.write_and_publish(
        "Promotion: Diskon 10% Koleksi Wanita",
        rules=[_rule("rule-wanita-10", "Diskon 10% Koleksi Wanita",
                     {"kind": "PERCENT", "bps": 1000, "compound": False},
                     {"on": "DIVISION", "divisions": ["WANITA"]})])
    books.write_and_publish(
        "Promotion: Kupon HEMAT50",
        rules=[_rule("rule-hemat50", "Kupon HEMAT50: potongan Rp 50.000",
                     {"kind": "AMOUNT", "amount": {"minor": 50_000}},
                     {"on": "WHOLE_CART"}, campaign_id="gajian-hemat",
                     min_amount=300_000, coupon_code="HEMAT50", max_uses=100)],
        coupons=[{"code": "HEMAT50", "rule_id": "rule-hemat50", "active": True,
                  "valid_from": gajian["valid_from"], "valid_to": gajian["valid_to"],
                  "max_uses": 100}],
        campaigns=[gajian])

    # ── 5. price changes ────────────────────────────────────────────────
    _step("commercial — a markdown and a price change")
    products = _rows(rina.get("/api/v1/commercial/products?limit=200"))
    by_article = {}
    for product in products:
        by_article.setdefault(product["article_code"], []).append(product)
    name_of = {code: rows[0]["article_name"] for code, rows in by_article.items()}
    sandal = next(c for c, n in name_of.items() if n == "Sandal Slide Karet")
    kaos = next(c for c, n in name_of.items() if n == "Kaos Basic Katun Combed")

    name = "Price drop: Sandal Slide Karet"
    version = books.next_version() if books.named(name) is None else books.named(name)["version"]
    books.write_and_publish(
        name, change_type="MARKDOWN",
        markdowns=[{
            "markdown_id": f"md-v{version}-{sandal}-{STORE}", "article_code": sandal,
            "site_id": STORE, "replacement_unit_price_minor": 79_000, "priority": 0,
            "iso_weekdays": [], "from_minute": None, "to_minute": None,
            "effective_from": _iso(datetime.now(timezone.utc)),
            "effective_to": _iso(end_of(today + timedelta(days=35))),
        }])

    # The tax rule the article is priced under today, restated rather than
    # chosen, as the pricelist editor derives it from the price it replaces.
    current = next(b for b in books.items if b["name"] == f"Harga awal · {name_of[kaos]}")
    detail = rina.get(f"/api/v1/commercial/publications/{current['id']}")
    tax = next(t for t in detail["tax_rules"] if t["tax_category"] == "STANDARD")
    first_of_next_month = (today.replace(day=1) + timedelta(days=32)).replace(day=1)
    books.write_and_publish(
        f"Harga baru · {name_of[kaos]}", change_type="REGULAR_PRICE",
        effective_from=_iso(first_of_next_month),
        tax_rules=[{"tax_category": "STANDARD", "rate_bps": tax["rate_bps"],
                    "tax_inclusive": tax["tax_inclusive"]}],
        offer_rules=[{"sku_id": p["sku_id"], "site_id": None, "site_ids": None,
                      "channel": "STORE", "sellable": True, "currency": "IDR",
                      "unit_price_minor": 95_000, "tax_category": "STANDARD"}
                     for p in by_article[kaos]])

    # ── 6. vouchers ─────────────────────────────────────────────────────
    # Issued by whoever gave it: the two gifts are marketing's (Rina), the
    # goodwill card is store-01's manager making good on a visit (Maya). The
    # route stamps `issued_by` from the session, never from the body.
    _step("commercial — vouchers (free: no journal on issue)")
    expiry = _iso(end_of(today + timedelta(days=96)))
    vouchers = [
        {"code": "GIFT100SARI", "kind": "GIFT_CARD", "value_minor": 100_000,
         "member_id": MEMBERS[0][0], "site_id": STORE, "expires_at": expiry,
         "note": "Hadiah ulang tahun member"},
        {"code": "MAAF50BUDI", "kind": "GOODWILL", "value_minor": 50_000,
         "member_id": MEMBERS[1][0], "site_id": STORE, "expires_at": expiry,
         "note": "Kompensasi: ukuran yang dicari kosong saat kunjungan"},
        {"code": "UNDIAN200", "kind": "GIFT_CARD", "value_minor": 200_000,
         "member_id": None, "site_id": STORE, "expires_at": expiry,
         "note": "Hadiah undian pembukaan store-01"},
    ]
    for voucher in vouchers:
        found = rina.call("GET", f"/api/v1/commercial/vouchers/{voucher['code']}", ok=None)
        found = (found.get("voucher") or found) if isinstance(found, dict) else {}
        if found.get("code") == voucher["code"]:
            print(f"  = voucher {voucher['code']} already issued")
            continue
        # The goodwill card was the store manager's, but the Store manager job
        # role (0633) carries no Marketing section and the voucher route now
        # asks for it, so head office issues it too.
        issuer, who = rina, "rina"
        issuer.post("/api/v1/commercial/vouchers", {**voucher, "currency": "IDR"})
        print(f"  + voucher {voucher['code']} {voucher['kind']} Rp {voucher['value_minor']:,}"
              f" by {_actor(issuer, who)}")

    # ── 7. saved segments ───────────────────────────────────────────────
    _step("commercial — saved member segments")
    saved = {s["name"] for s in _rows(rina.get("/api/v1/members/segments/saved"), "segments")}
    for segment in [
        {"name": "Member belum belanja",
         "purpose": "Kirim kupon HEMAT50 ke member yang belum pernah belanja.",
         "definition": {"match": "ALL", "filters": [
             {"column": "transaction_count", "op": "Is", "values": ["0"]}]}},
        {"name": "Belanja ≥ Rp 300.000",
         "purpose": "Kandidat undangan Pekan Sepatu berikutnya.",
         "definition": {"match": "ALL", "filters": [
             {"column": "spent_minor", "op": "Gte", "values": ["300000"]}]}},
    ]:
        if segment["name"] in saved:
            print(f"  = segment {segment['name']} already saved")
            continue
        rina.post("/api/v1/members/segments/saved", segment)
        print(f"  + segment {segment['name']}")

    # ── store-01 has to be charging it before the till can sell at it ────
    target = books.next_version() - 1
    live = [b for b in books.items if b["status"] == "PUBLISHED"
            and b["effective_from"] <= _iso(datetime.now(timezone.utc))]
    wanted = max(b["version"] for b in live)
    deadline = time.time() + 120
    offers = {}
    while time.time() < deadline:
        offers = shop.get("/api/v1/store/offers")
        if (offers.get("publication_version") or 0) >= wanted and offers.get("running"):
            break
        time.sleep(3)
    print(f"  store-01 offers at book v{offers.get('publication_version')} "
          f"(latest v{target}): {len(offers.get('running') or [])} running, "
          f"{len(offers.get('price_drops') or [])} price drops")

    ctx["members"] = [{"member_id": m, "name": n} for m, n in MEMBERS]
    ctx["voucher_codes"] = {v["code"]: v["value_minor"] for v in vouchers}
    ctx["coupon_codes"] = {"HEMAT50": {"rule_id": "rule-hemat50", "min_basket": 300_000,
                                       "off": 50_000}}
    ctx["promotions"] = {"rule-sepatu-15": "15% SANDAL_SEPATU (Pekan Sepatu)",
                         "rule-wanita-10": "10% WANITA",
                         "rule-hemat50": "Rp 50.000 off ≥ Rp 300.000 with HEMAT50",
                         "rule-poin-member": "1 point per Rp 10.000, members"}
    ctx["campaign_ids"] = ["pekan-sepatu", "gajian-hemat"]
    ctx["markdowns"] = {sandal: 79_000}
    ctx["campaign_images"] = ["campaign-pekan-sepatu.jpg", "campaign-gajian-hemat.jpg"]
