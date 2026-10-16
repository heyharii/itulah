#!/usr/bin/env python3
"""Seed deals into the pos-e2e rig, so the store app's Catalogue has something to show.

    python3 e2e/pos-flow/seed_commercial.py

Everything is done as Rina at the CLOUD (head office; Password01 on this rig), through
the same routes the hub calls, and published straight to store-01 (channel STORE) — there
is no approval step. It never signs in as anyone else and never touches the store node.

  campaign    Gajian Oktober, from today for three weeks, banner + headline + terms
  promotions  20% off Kemeja Oxford (in the campaign) · 10% off WANITA · buy 2 get 1 on
              tag KAOS · members only 5% off PRIA · UPCOMING 15% off Kaos Uji UJI3
  coupons     HEMAT25 (Rp 25.000 off Rp 200.000+, in the campaign) · KAOS15 (15% off
              Kaos Oblong)
  prices      markdown on Kemeja Grey XL (200.000 → 149.000) and on the whole of article
              00000007 (99.000 → 79.000), both running now; a regular price change of
              Kaos Uji UJI4 (99.000 → 109.000) on the 1st of next month
  gift cards  Rp 100.000 (for member Sari) and Rp 250.000 (to bearer)

Idempotent like scripts/demo_stages/commercial.py, whose Books helper it reuses: a book
already published under the same name is skipped, a DRAFT left by a halted run is
published, a gift card already issued is skipped. Safe to run again.
"""

from __future__ import annotations

import importlib.util
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.dont_write_bytecode = True  # the repo does not ignore __pycache__

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))
from demo_stages.commercial import (  # noqa: E402
    STORE, Books, _actor, _iso, _rows, _rule, _step,
)

CLOUD = "http://127.0.0.1:8480"
PASSWORD = "Password01"
CHANNEL = "STORE"
# store-01's own node, for the closing "has it arrived" look. Read-only; signed in as nobody.
STORE_DB = ROOT / "runs/pos-e2e/store-edge.sqlite3"
# The hub's dev server on this rig serves frontend-hub/public; the store node fetches the
# banner from here (server side) and hands it to every screen in the shop.
BANNER = "http://localhost:5480/demo-images/campaign-gajian-hemat.jpg"
WIB = timezone(timedelta(hours=7))

CAMPAIGN_ID = "gajian-oktober"


def load_node_class():
    """`Node` lives in scripts/demo-populate.py (a hyphen: not importable by name)."""
    spec = importlib.util.spec_from_file_location("demo_populate", ROOT / "scripts/demo-populate.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.Node


def scoped(rule: dict) -> dict:
    """Pin a rule to store-01's counter, as the task asks (the hub leaves both open)."""
    rule["scope"]["site_ids"] = [STORE]
    rule["scope"]["channels"] = [CHANNEL]
    return rule


def main() -> int:
    Node = load_node_class()
    rina = Node(CLOUD, "cloud").login("rina", PASSWORD)

    now = datetime.now(WIB)
    today = now.replace(hour=0, minute=0, second=0, microsecond=0)

    def end_of(day: datetime) -> datetime:
        return day.replace(hour=23, minute=59, second=59)

    books = Books(rina)
    created: list[str] = []

    def publish(name, **content):
        before = books.named(name)
        book = books.write_and_publish(name, **content)
        if not before or before["status"] != "PUBLISHED":
            created.append(f"v{book['version']} {name}")
        return book

    # ── campaign ────────────────────────────────────────────────────────────
    _step("seed_commercial — campaign Gajian Oktober")
    gajian = {
        "campaign_id": CAMPAIGN_ID, "name": "Gajian Oktober", "status": "ACTIVE",
        "valid_from": _iso(today),
        "valid_to": _iso(end_of(today + timedelta(days=20))),   # three weeks, today included
        "budget_minor": 5_000_000, "max_uses": None,
        "image_url": BANNER,
        "headline": "Gajian Oktober — Kemeja Oxford diskon 20% dan potongan Rp 25.000 dengan kupon HEMAT25",
        "terms": "Berlaku di store-01 selama periode kampanye. Kupon HEMAT25: minimal belanja "
                 "Rp 200.000 dalam satu struk, satu kupon per transaksi. Tidak dapat digabung "
                 "dengan promo lain.",
        "site_ids": [STORE],
    }
    publish("Campaign: Gajian Oktober", campaigns=[gajian])
    rina.call("PUT", f"/api/v1/commercial/campaigns/{CAMPAIGN_ID}/intent", {
        "objective": "INCREASE_BASKET", "success_metric": "AVERAGE_BASKET",
        "target_direction": "AT_LEAST", "target_value": 250_000,
        "baseline_campaign_id": None,
        "notes": "Naikkan nilai belanja per struk di minggu gajian.",
        "updated_by": books.actor})
    print("  + objective: average basket >= Rp 250.000")

    # ── promotions (a rule restates its campaign verbatim) ─────────────────
    _step("seed_commercial — promotions")
    publish(
        "Promotion: Diskon 20% Kemeja Oxford",
        rules=[scoped(_rule("rule-okt-oxford-20", "Diskon 20% Kemeja Oxford",
                            {"kind": "PERCENT", "bps": 2000, "compound": False},
                            {"on": "ARTICLE", "article_codes": ["00000002"]},
                            campaign_id=CAMPAIGN_ID))],
        campaigns=[gajian])
    publish(
        "Promotion: Diskon 10% Koleksi Wanita",
        rules=[scoped(_rule("rule-okt-wanita-10", "Diskon 10% Koleksi Wanita",
                            {"kind": "PERCENT", "bps": 1000, "compound": False},
                            {"on": "DIVISION", "divisions": ["WANITA"]}))])
    publish(
        "Promotion: Beli 2 Gratis 1 Kaos",
        rules=[scoped(_rule("rule-okt-kaos-b2g1", "Beli 2 Gratis 1 Kaos",
                            {"kind": "BUY_X_GET_Y", "buy": 2, "get": 1, "reward_bps": 10_000},
                            {"on": "TAG", "tags": ["KAOS"]}))])
    publish(
        "Promotion: Member Diskon 5% Koleksi Pria",
        rules=[scoped(_rule("rule-okt-pria-member-5", "Member: Diskon 5% Koleksi Pria",
                            {"kind": "PERCENT", "bps": 500, "compound": False},
                            {"on": "DIVISION", "divisions": ["PRIA"]}, customers="MEMBERS"))])

    # Upcoming: the book goes out now, the rule's own window opens in five days and
    # runs seven (16 to 22 October when run on the 11th).
    starts = today + timedelta(days=5)
    upcoming = scoped(_rule("rule-okt-uji3-15", "Diskon 15% Kaos Uji UJI3",
                            {"kind": "PERCENT", "bps": 1500, "compound": False},
                            {"on": "ARTICLE", "article_codes": ["00000005"]}))
    upcoming["conditions"]["effective_from"] = _iso(starts)
    upcoming["conditions"]["effective_to"] = _iso(end_of(starts + timedelta(days=6)))
    publish("Promotion: Diskon 15% Kaos Uji UJI3", rules=[upcoming])

    # ── coupons (a coupon is a rule with a code, plus the code's own row) ───
    _step("seed_commercial — coupons")
    publish(
        "Promotion: Kupon HEMAT25",
        rules=[scoped(_rule("rule-okt-hemat25", "Kupon HEMAT25: potongan Rp 25.000",
                            {"kind": "AMOUNT", "amount": {"minor": 25_000}},
                            {"on": "WHOLE_CART"}, campaign_id=CAMPAIGN_ID,
                            min_amount=200_000, coupon_code="HEMAT25"))],
        coupons=[{"code": "HEMAT25", "rule_id": "rule-okt-hemat25", "active": True,
                  "valid_from": gajian["valid_from"], "valid_to": gajian["valid_to"],
                  "max_uses": None}],
        campaigns=[gajian])
    publish(
        "Promotion: Kupon KAOS15",
        rules=[scoped(_rule("rule-okt-kaos15", "Kupon KAOS15: diskon 15% Kaos Oblong",
                            {"kind": "PERCENT", "bps": 1500, "compound": False},
                            {"on": "ARTICLE", "article_codes": ["00000003"]},
                            coupon_code="KAOS15"))],
        coupons=[{"code": "KAOS15", "rule_id": "rule-okt-kaos15", "active": True,
                  "valid_from": _iso(today), "valid_to": None, "max_uses": None}])

    # ── price changes ───────────────────────────────────────────────────────
    _step("seed_commercial — two markdowns and a price change")
    products = _rows(rina.get("/api/v1/commercial/products?limit=500"))
    by_article: dict[str, list] = {}
    for product in products:
        by_article.setdefault(product["article_code"], []).append(product)
    sku = "00000001105"          # Kemeja Grey XL, 200.000
    assert any(p["sku_code"] == sku for p in by_article["00000001"]), f"{sku} is not in the catalogue"
    assert "00000007" in by_article and "00000006" in by_article, "article 00000006/7 missing"

    def markdown_book(name, target, price):
        """One markdown at store-01 running now; `target` is {sku_code} or {article_code}."""
        found = books.named(name)
        version = books.next_version() if found is None else found["version"]
        key = target.get("sku_code") or target["article_code"]
        return publish(
            name, change_type="MARKDOWN",
            markdowns=[{
                "markdown_id": f"md-v{version}-{key}-{STORE}", **target,
                "site_id": STORE, "replacement_unit_price_minor": price, "priority": 0,
                "iso_weekdays": [], "from_minute": None, "to_minute": None,
                "effective_from": _iso(datetime.now(timezone.utc)),
                "effective_to": _iso(end_of(today + timedelta(days=20))),
            }])

    markdown_book("Price drop: Kemeja Grey XL", {"sku_code": sku}, 149_000)
    markdown_book("Price drop: Kemeja 00000007", {"article_code": "00000007"}, 79_000)

    # The tax rule the article is priced under today, restated rather than chosen, as the
    # pricelist editor derives it from the price it replaces.
    current = next(b for b in books.items if b["name"] == "Harga awal · Kaos Uji UJI4")
    detail = rina.get(f"/api/v1/commercial/publications/{current['id']}")
    tax = next(t for t in detail["tax_rules"] if t["tax_category"] == "STANDARD")
    first_of_next_month = (today.replace(day=1) + timedelta(days=32)).replace(day=1)
    publish(
        "Harga baru · Kaos Uji UJI4", change_type="REGULAR_PRICE",
        effective_from=_iso(first_of_next_month),
        tax_rules=[{"tax_category": "STANDARD", "rate_bps": tax["rate_bps"],
                    "tax_inclusive": tax["tax_inclusive"]}],
        offer_rules=[{"sku_id": p["sku_id"], "site_id": None, "site_ids": None,
                      "channel": CHANNEL, "sellable": True, "currency": "IDR",
                      "unit_price_minor": 109_000, "tax_category": "STANDARD"}
                     for p in by_article["00000006"]])

    # ── gift cards (free: nothing is sold, so no journal on issue) ──────────
    _step("seed_commercial — gift cards")
    expiry = _iso(end_of(today + timedelta(days=96)))
    vouchers = [
        {"code": "GIFT100OKT", "kind": "GIFT_CARD", "value_minor": 100_000,
         "member_id": "081311110001", "site_id": STORE, "expires_at": expiry,
         "note": "Hadiah gajian untuk member Sari"},
        {"code": "GIFT250OKT", "kind": "GIFT_CARD", "value_minor": 250_000,
         "member_id": None, "site_id": STORE, "expires_at": expiry,
         "note": "Kartu hadiah Gajian Oktober"},
    ]
    for voucher in vouchers:
        found = rina.call("GET", f"/api/v1/commercial/vouchers/{voucher['code']}", ok=None)
        found = (found.get("voucher") or found) if isinstance(found, dict) else {}
        if found.get("code") == voucher["code"]:
            print(f"  = voucher {voucher['code']} already issued")
            continue
        rina.post("/api/v1/commercial/vouchers", {**voucher, "currency": "IDR"})
        print(f"  + voucher {voucher['code']} {voucher['kind']} Rp {voucher['value_minor']:,}"
              f" by {_actor(rina, 'rina')}")
        created.append(f"voucher {voucher['code']}")

    # ── has store-01 got it? (its SQLite, read-only; store-01 syncs in 2-4 s) ─
    _step("seed_commercial — waiting for store-01")
    books.refresh()
    wanted = max(b["version"] for b in books.items if b["status"] == "PUBLISHED")
    arrived = None
    deadline = time.time() + 60
    while time.time() < deadline:
        arrived = store_version()
        if arrived is not None and arrived >= wanted:
            break
        time.sleep(2)
    print(f"  store-01 holds book v{arrived} (cloud's latest v{wanted})")
    print(f"\n{len(created)} new this run" + (":\n  " + "\n  ".join(created) if created else "."))
    return 0


def store_version():
    """The newest price book store-01's node holds, read straight from its SQLite."""
    import sqlite3
    if not STORE_DB.exists():
        return None
    try:
        connection = sqlite3.connect(f"file:{STORE_DB}?mode=ro", uri=True, timeout=5)
        try:
            return connection.execute("SELECT MAX(version) FROM commercial_publication").fetchone()[0]
        finally:
            connection.close()
    except sqlite3.Error as error:
        print(f"  (cannot read {STORE_DB.name}: {error})")
        return None


if __name__ == "__main__":
    sys.exit(main())
