"""sales — a day at store-01's till, and the day reaching the books.

Runs after `outbound` (30 units on `store-01.floor`) and `commercial` (prices,
the 15% shoe promotion, the 10% WANITA promotion, coupon HEMAT50, vouchers,
members, the points scheme). Everything goes through the routes the till
(pos-desktop/ui/src/api.ts) and the hub's finance screens call, in order:

  1. dian opens a cash shift on POS-01 with a Rp 500.000 float
     (POST store/shifts).
  2. dian rings up nine sales over the floor stock (POST store/quote, then
     POST store/sales — tags, not lines, exactly as the till sends them):
       S1 cash, change given            S6 Sneakers (15% Pekan Sepatu) +
       S2 BCA debit (EDC)                  Sandal Slide Karet at the markdown
       S3 member Sari, earns points     S7 Blus (10% WANITA), Mandiri debit
       S4 coupon HEMAT50, VISA credit    S8 member Budi, Loafers, Mastercard
       S5 GIFT100SARI + cash            S9 cash, a child's T-shirt
     The voucher is held at head office first (POST store/vouchers/{code}/
     authorize, relayed by the node) and the hold id rides the tender — the
     centre turns it into the redemption when the sale syncs.
  3. (off: REFUND_BY_VOID) the S9 shopper changes her mind — a cash refund
     approved by maya (POST store/sales/{id}/void with a supervisor). Why it is
     off is said beside the switch.
  4. dian counts the drawer and closes the shift (POST store/shifts/{id}/close
     with the count sheet, which must add up to the declared figure).
  5. Head office: the day's takings are generated and posted (finance/
     sales-postings/generate + /{id}/post). The hourly sale-day agent only
     closes days that have finished trading, so today's is posted by hand —
     the same two buttons Finance presses on /finance/receivables/sales-postings.
     Posting writes the SALE_DAY entry (cash, card receivables per acquirer,
     revenue per tender, discounts — the free voucher lands there too) and
     consumes the sold units' cost layers into COGS_DAY.
  6. The money after the day (each function says what it posts):
       deposit    today's cash (less the float) → bank, finance/deposits
       BCA        settles its debit takings less 1% MDR, acquirer-settlements
       points     Sari trades 50 points for a Rp 50 voucher (1 point = Rp 1):
                  the customer app's tukar-poin request confirmed at the till
  7. store-01 left ready for the live counter app: petty cash with one
     expense (store app /money/expenses) and a fresh shift OPEN on POS-01.

Re-runnable: the sales are keyed (`demo-sales:S1`…) so the node replays rather
than re-sells; the stage looks at whether S1's first unit has left the floor
and skips the till if it has. Finance steps look for their own documents.
"""

from __future__ import annotations

import time
import uuid
from datetime import datetime, timedelta, timezone

STORE = "store-01"
TERMINAL = "POS-01"
FLOAT = 500_000
WIB = timezone(timedelta(hours=7))
MARKER = "demo-sales"

# Each sale: the articles on it (by name + size position among the units that
# were ever on the floor), how it was paid, and who the shopper is.
#   tenders: ("CASH", tendered) | ("CARD", acquirer, kind, ref) | ("VOUCHER", code)
SALES = [
    {"key": "S1", "items": [("Kaos Basic Katun Combed", 0), ("Kaos Anak Karakter", 0)],
     "pay": [("CASH", 200_000)]},
    {"key": "S2", "items": [("Kemeja Oxford Lengan Panjang", 0)],
     "pay": [("CARD", "BCA", "DEBIT", "884201")]},
    {"key": "S3", "items": [("Celana Chino Slim Fit", 0), ("Kaos Basic Katun Combed", 1)],
     "pay": [("CASH", 350_000)], "member": "081311110001"},
    {"key": "S4", "items": [("Kemeja Oxford Lengan Panjang", 1), ("Celana Chino Slim Fit", 1)],
     "pay": [("CARD", "VISA", "CREDIT", "884202")], "coupons": ["HEMAT50"]},
    {"key": "S5", "items": [("Tas Selempang Kanvas", 0)],
     "pay": [("VOUCHER", "GIFT100SARI"), ("CASH", 120_000)], "member": "081311110001"},
    {"key": "S6", "items": [("Sneakers Kanvas Low", 0), ("Sandal Slide Karet", 0)],
     "pay": [("CARD", "BCA", "DEBIT", "884204")]},
    {"key": "S7", "items": [("Blus Rayon Motif Bunga", 0)],
     "pay": [("CARD", "MANDIRI", "DEBIT", "553101")]},
    {"key": "S8", "items": [("Loafers Kulit Sintetis", 0)],
     "pay": [("CARD", "MASTERCARD", "CREDIT", "884203")], "member": "081311110002"},
    {"key": "S9", "items": [("Kaos Anak Karakter", 1)],
     "pay": [("CASH", 70_000)]},
]
RETURN_OF = "S9"  # the basket a refund would undo
# Off until the backend counts only COMPLETED sales' tenders: a void does
# reach head office (edge_sale → VOIDED, the unit back on the floor), but
# sales_posting.rs::read_day sums edge_sale_tender without `s.status =
# 'COMPLETED'`, so the voided basket's cash still lands in SALE_DAY (cash and
# revenue overstated by the tender). A till RETURN has no sync fact at all.
# Either way the books would not match the drawer, so the day has no refund.
REFUND_BY_VOID = False


def _step(title):
    print(f"\n\033[1m── demo-populate: {title}\033[0m", flush=True)


def _rows(payload, *keys):
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        for key in keys + ("items", "rows", "data", "results"):
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
    raise SystemExit(f"sales: timed out waiting for {label}")


def _nudge(*nodes):
    for node in nodes:
        node.call("POST", "/api/v1/sync/trigger", {}, ok=None)


def _today() -> str:
    return datetime.now(WIB).date().isoformat()


# ---------------------------------------------------------------------------
# the till


def _units(store):
    """epc → current place, from the store's own movement history (every unit
    that was ever here, sold ones included, so the choice is stable on a re-run)."""
    units = {}
    for move in sorted(_rows(store.get("/api/v1/inventory/movements?limit=2000")),
                       key=lambda m: m["occurred_at"]):
        units[move["epc"]] = move["to"]
    return units


def _choose(store, catalogue):
    """Pick each sale's tags: the n-th unit (by EPC) of the named article that
    was put on the floor. EPC = "A1" + 11-digit SKU + serial."""
    units = _units(store)
    names = {row["sku_code"]: row["name"] for row in catalogue}
    by_article = {}
    for epc in sorted(e for e in units if e[2:13] in names):
        by_article.setdefault(names[epc[2:13]], []).append(epc)
    # only units that were displayed: the stockroom bags stay out of it
    plan = {}
    for sale in SALES:
        epcs = []
        for article, n in sale["items"]:
            candidates = [e for a, es in by_article.items() if a.startswith(article) for e in es]
            candidates = [e for e in candidates if units[e] != f"{STORE}.warehouse:on_hand"]
            epcs.append(sorted(candidates)[n])
        plan[sale["key"]] = epcs
    return plan, units


def _tenders(cashier, sale, due):
    """The tender rows the till builds; a voucher is held at the centre first."""
    tenders, remaining = [], due
    for pay in sale["pay"]:
        if pay[0] == "VOUCHER":
            code = pay[1]
            amount = min(remaining, VOUCHER_VALUE.get(code, remaining))
            hold = cashier.post(f"/api/v1/store/vouchers/{code}/authorize", {
                "checkout_id": f"{MARKER}:{sale['key']}", "amount_minor": amount})
            tenders.append({"method": "VOUCHER", "amount_minor": amount, "reference": code,
                            "voucher_authorization_id": hold["authorization_id"],
                            "acquirer": None, "card_kind": None})
            remaining -= amount
        elif pay[0] == "CARD":
            _, bank, kind, ref = pay
            tenders.append({"method": "CARD", "amount_minor": remaining,
                            "reference": f"{bank} · {ref}", "voucher_authorization_id": None,
                            "acquirer": bank, "card_kind": kind})
            remaining = 0
        else:  # CASH: what the shopper handed over; the node works out the change
            tendered = max(pay[1], remaining)
            tenders.append({"method": "CASH", "amount_minor": tendered, "reference": None,
                            "voucher_authorization_id": None, "acquirer": None,
                            "card_kind": None})
            remaining = 0
    return tenders


VOUCHER_VALUE: dict = {}


def _till(store, cashier, manager, password):
    _step("sales — a day at store-01's till (dian at POS-01)")
    catalogue = cashier.get("/api/v1/store/catalog")["items"]
    plan, units = _choose(store, catalogue)
    first = plan["S1"][0]
    day = None
    if units.get(first) != f"{STORE}.floor:on_hand":
        print(f"  = the day is already rung up ({first} left the floor) — skipping the sales")
    else:
        day = _ring_up(cashier, plan, password)
    _close_shift(cashier, manager)
    return day


def _ring_up(cashier, plan, password):
    # 1. the drawer
    shift = cashier.call("GET", f"/api/v1/store/shifts/active?terminal_id={TERMINAL}", ok=None)
    if not (isinstance(shift, dict) and shift.get("shift_id")):
        shift = cashier.post("/api/v1/store/shifts", {
            "terminal_id": TERMINAL, "opening_float_minor": FLOAT, "actor_id": "dian",
            "idempotency_key": f"{MARKER}:shift:{_today()}"})
        print(f"  + shift {shift['shift_id'][:8]} opened on {TERMINAL}, float Rp {FLOAT:,}")

    # 2. the sales: quote (what the screen shows), then sell the same tags
    sold = {}
    for sale in SALES:
        epcs = plan[sale["key"]]
        quote = cashier.post("/api/v1/store/quote", {
            "epcs": epcs, "coupon_codes": sale.get("coupons", []),
            "customer_id": sale.get("member"), "charges": []})
        due = quote.get("amount_due_minor") or quote["total_minor"]
        tenders = _tenders(cashier, sale, due)
        result = cashier.post("/api/v1/store/sales", {
            "epcs": epcs, "tenders": tenders, "actor_id": "dian",
            "idempotency_key": f"{MARKER}:{sale['key']}",
            "coupon_codes": sale.get("coupons", []), "customer_id": sale.get("member"),
            "charges": []})
        sold[sale["key"]] = {"sale_id": result["sale_id"], "epcs": epcs,
                             "total": result["total_minor"], "tenders": tenders,
                             "member": sale.get("member"),
                             "points": quote.get("points_earned") or 0}
        applied = [p["name"] for p in quote.get("promotions") or [] if p.get("applied")]
        how = " + ".join(f"{t['method']}{' ' + t['acquirer'] if t['acquirer'] else ''}"
                         f" {t['amount_minor']:,}" for t in tenders)
        extra = []
        if result.get("change_minor"):
            extra.append(f"change {result['change_minor']:,}")
        if quote.get("discount_total_minor"):
            extra.append(f"discount {quote['discount_total_minor']:,}")
        if quote.get("points_earned"):
            extra.append(f"{quote['points_earned']} points to {sale['member']}")
        extra += applied
        print(f"  + {sale['key']} Rp {result['total_minor']:,} — {how}"
              f"{' · ' + ' · '.join(extra) if extra else ''}")

    # 3. the refund: the S9 shopper changes her mind at the counter and gets
    # her money back in cash. dian keys it at her till; maya's password is the
    # supervisor's yes the node asks for. It is the till's VOID, not its
    # RETURN, on purpose: a void travels to head office (FACT_SALES_VOIDED
    # flips edge_sale to VOIDED, stock goes back on the floor, the day posts
    # without it), whereas a till return has no sync fact yet — the sales
    # day would post the sale, the drawer would be short by the refund and
    # the shirt's cost would be consumed while it hangs on the rail again
    # (see the doc of backend/src/cloud/postgres/sales_posting.rs).
    if not REFUND_BY_VOID:
        return {"sold": sold, "refund": None, "shift_id": shift["shift_id"]}
    back = sold[RETURN_OF]
    refund = cashier.post(f"/api/v1/store/sales/{back['sale_id']}/void", {
        "reason": "Pelanggan batal beli, uang dikembalikan tunai",
        "supervisor": {"username": "maya", "password": password},
        "actor_id": "dian", "idempotency_key": f"{MARKER}:void:{RETURN_OF}"})
    print(f"  + {RETURN_OF} refunded: Rp {back['total']:,} back in cash (void approved by "
          f"maya); the shirt goes back on the floor")
    return {"sold": sold, "refund": refund, "shift_id": shift["shift_id"]}


def _close_shift(cashier, manager):
    """dian counts the drawer and closes. The count is what is in the drawer —
    nothing went missing today — so it equals what the node expects; maya's
    view of the shift (a cashier is never shown the figure) is where that is read."""
    shift = cashier.call("GET", f"/api/v1/store/shifts/active?terminal_id={TERMINAL}", ok=None)
    if not (isinstance(shift, dict) and shift.get("shift_id")):
        print(f"  = no open shift on {TERMINAL}")
        return
    report = manager.get(f"/api/v1/store/shifts/{shift['shift_id']}")
    counted = report["expected_cash_minor"]
    sheet, left = [], counted
    for note in (100_000, 50_000, 20_000, 10_000, 5_000, 2_000, 1_000, 500, 200, 100, 50):
        pieces, left = divmod(left, note)
        if pieces:
            sheet.append({"value_minor": note, "pieces": pieces})
    cashier.post(f"/api/v1/store/shifts/{shift['shift_id']}/close", {
        "declared_cash_minor": counted, "counted": sheet,
        "note": "Hitung laci akhir hari", "actor_id": "dian",
        "idempotency_key": f"{MARKER}:close:{shift['shift_id']}"})
    print(f"  + shift closed by dian: drawer counted Rp {counted:,} (float "
          f"{report['opening_float_minor']:,} + cash sales {report['cash_sales_minor']:,} "
          f"− change {report['change_given_minor']:,} − refunds {report['cash_refunds_minor']:,})")


# ---------------------------------------------------------------------------
# head office: the day reaches the books

# A credit card is posted by its NETWORK: the client's chart has "Penjualan
# Kartu Kredit VISA Card" / "Master Card" (4007/4008) and the account map keys
# `revenue_credit` and `card_receivable_credit` by VISA / MASTER(CARD) only,
# while debit is keyed by bank (4003–4006). So a credit tender here names the
# network as its acquirer — the same convention scripts/seed-floor-activity.py
# uses — and a debit tender names the bank.


def _post_day(finance, cloud_nodes, day):
    """Generate the day's takings and post them — the two buttons on
    /finance/receivables/sales-postings. Posting writes SALE_DAY (tenders →
    cash / card receivables / voucher, revenue, VAT) and, in the same
    transaction, consumes the sold units' cost layers into COGS."""
    _step("sales — the day's takings posted at head office (rina)")
    # Wait until head office holds every sale the till rang today, void included.
    till = day or {}
    wanted = len(SALES)

    def synced():
        _nudge(*cloud_nodes)
        found = [p for p in _rows(finance.get(f"/api/v1/finance/sales-postings?site={STORE}"))
                 if p.get("business_date") == _today()]
        if found and found[0]["status"] == "POSTED":
            return found[0]
        doc = finance.call("POST", "/api/v1/finance/sales-postings/generate",
                           {"site_id": STORE, "business_date": _today()}, ok=None)
        posting = (doc or {}).get("posting") or {}
        # nine sales rung, one refunded by a void: eight count
        return posting if posting.get("sale_count", 0) >= wanted - 1 else None
    posting = _wait("today's sales at head office", synced, 180, 5)
    if posting["status"] != "POSTED":
        posting = finance.post(f"/api/v1/finance/sales-postings/{posting['posting_id']}/post",
                               {})["posting"]
    print(f"  = {STORE} {posting['business_date']}: {posting['sale_count']} sales, gross "
          f"Rp {posting['gross_minor']:,}, discounts Rp {posting['discount_minor']:,}, "
          f"revenue Rp {posting['revenue_minor']:,} — {posting['status']} "
          f"({posting.get('entry_number') or ''})")
    return posting


# ---------------------------------------------------------------------------


def _deposit(finance, day_cash):
    """The day's cash takings to the bank: Finance records the slip carried by
    maya and banks it (Dr cash in transit / Cr store drawer 1002), then lands
    it in Giro BCA 1005 — POST finance/deposits (bank_now) + /{id}/land, the
    /finance/cash-bank/deposits screen.

    Not forced: on this build the posting needs `cash_in_transit` mapped at
    store-01 (it is not, and the chart's only "Setoran Dalam Perjalanan" is an
    inactive long code), and the store-money route (store-money/deposits)
    fails with `column "bank_key" does not exist`. Both are Finance/backend
    fixes, so a refusal is reported and the stage carries on."""
    slip = f"SETOR-{STORE.upper()}-{_today().replace('-', '')}"
    listed = finance.call("GET", f"/api/v1/finance/deposits?site={STORE}&limit=200", ok=None)
    found = next((d for d in _rows(listed) if d.get("slip_reference") == slip), None)
    if found is None:
        found = finance.call("POST", "/api/v1/finance/deposits", {
            "site_id": STORE, "drawer_account_code": "1002", "bank_account_code": "1005",
            "amount_minor": day_cash, "banked_on": _today(), "carried_by": "maya",
            "slip_reference": slip, "note": "Setoran tunai penjualan hari ini (modal laci tetap)",
            "bank_now": True}, ok=None)
        if not (isinstance(found, dict) and found.get("deposit_id")):
            print(f"  ! deposit of Rp {day_cash:,} NOT recorded — {found}")
            return
        print(f"  + deposit {slip}: Rp {day_cash:,} from the {STORE} drawer, carried by maya")
    if (found.get("status") or "").upper() == "DRAFT":
        banked = finance.call("POST", f"/api/v1/finance/deposits/{found['deposit_id']}/bank",
                              {}, ok=None)
        if not (isinstance(banked, dict) and banked.get("deposit_id")):
            print(f"  ! deposit {found.get('deposit_number', slip)} left as a draft — {banked}")
            return
        found = banked
    if (found.get("status") or "").upper() != "LANDED":
        landed = finance.call("POST", f"/api/v1/finance/deposits/{found['deposit_id']}/land",
                              {"landed_on": _today(), "slip_reference": slip}, ok=None)
        print(f"  + deposit landed in Giro BCA: {(landed or {}).get('status', landed)}")


# The BCA EDC pays out the day's BCA debit takings the same day, less 1% MDR.
MDR_BPS = 100


def _settle_bca(finance, lines_of_day):
    """BCA's settlement of the debit cards it took today, read off the posted
    day (its BCA DEBIT line): gross, less 1% MDR, curated into Dr Giro BCA (net)
    + Dr card fee (MDR) / Cr Piutang Debit Card BCA (gross) —
    /finance/receivables/card-settlement. Mandiri, VISA and Mastercard stay
    open, so the receivable aging has something to age."""
    settled = [s for s in _rows(finance.get("/api/v1/finance/acquirer-settlements?limit=200"))
               if s.get("acquirer") == "BCA" and str(s.get("business_from")) == _today()]
    if settled:
        print(f"  = BCA settlement for {_today()} already there ({settled[0].get('status')})")
        return
    bca = next((l for l in lines_of_day if l["method"] == "CARD" and l["acquirer"] == "BCA"
                and l.get("card_kind") == "DEBIT"), None)
    if not bca:
        print("  = no BCA debit takings today to settle")
        return
    gross = bca["gross_minor"] - bca.get("returns_minor", 0)
    mdr = gross * MDR_BPS // 10_000
    made = finance.post("/api/v1/finance/acquirer-settlements", {
        "acquirer": "BCA", "settlement_date": _today(), "business_from": _today(),
        "business_to": _today(), "gross_minor": gross, "mdr_minor": mdr,
        "lines": [{"sale_id": None, "tender_seq": None, "site_id": STORE,
                   "tender_kind": "CARD_DEBIT", "auth_code": None,
                   "amount_minor": gross, "mdr_minor": mdr}]})
    sid = made.get("settlement_id") or (made.get("settlement") or {}).get("settlement_id")
    curated = finance.post(f"/api/v1/finance/acquirer-settlements/{sid}/curate", {
        "bank_key": "bank_giro", "bank_qualifier": "BCA", "posting_date": _today()})
    print(f"  + BCA settlement: {bca['tender_count']} debit tenders, gross Rp {gross:,}, "
          f"MDR Rp {mdr:,} (1%), net Rp {gross - mdr:,} to Giro BCA — {curated.get('status')}")


def _redeem_points(cloud_base, staff, till, member_id, points):
    """Sari turns points into a voucher, the tukar-poin way: the cashier gives
    her a pairing code (POST members/{id}/pairing-code, as the hub counter
    does), her app pairs (POST member/session → cookie), asks to redeem
    (POST member/points/redeem-requests → a code shown once), and the till
    looks the code up and confirms it (store/points/redeem-requests/lookup +
    /{id}/confirm, relayed to head office). 1 point = Rp 1 of voucher."""
    import http.cookiejar
    import json as _json
    import urllib.error
    import urllib.request
    code = staff.post(f"/api/v1/members/{member_id}/pairing-code", {})
    jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))

    def member_call(method, path, body=None):
        request = urllib.request.Request(cloud_base + path, method=method,
                                         data=None if body is None else _json.dumps(body).encode())
        request.add_header("content-type", "application/json")
        csrf = next((c.value for c in jar if c.name == "member_csrf"), None)
        if csrf:
            request.add_header("x-csrf-token", csrf)
        with opener.open(request, timeout=30) as response:
            raw = response.read()
            return _json.loads(raw) if raw else None
    member_call("POST", "/api/v1/member/session",
                {"member_id": member_id, "code": code.get("code")})
    account = member_call("GET", "/api/v1/member/points") or {}
    if any(e.get("entry_type") in ("REDEEM", "REDEMPTION")
           for e in _rows(account, "entries", "ledger", "history")):
        print(f"  = {member_id} already redeemed points")
        return
    try:
        asked = member_call("POST", "/api/v1/member/points/redeem-requests", {"points": points})
    except urllib.error.HTTPError as error:
        print(f"  = no new redeem request for {member_id}: {error.code} {error.read()[:160]!r}")
        return
    found = till.post("/api/v1/store/points/redeem-requests/lookup",
                      {"member_id": member_id, "code": asked["code"]})
    rid = found.get("request_id") or asked.get("request_id")
    done = till.post(f"/api/v1/store/points/redeem-requests/{rid}/confirm", {})
    print(f"  + {member_id} redeemed {points} points at the till → voucher "
          f"{done.get('voucher_code') or done.get('code') or ''} Rp {points:,} "
          f"(balance {done.get('balance_points')})")


def _ready_for_the_till(cashier, manager):
    """Leave store-01 ready for the counter app in the presentation: a shift
    open on POS-01 (pos-desktop's default terminal id) with the same float, so
    the first basket can be rung up straight after signing in."""
    shift = cashier.call("GET", f"/api/v1/store/shifts/active?terminal_id={TERMINAL}", ok=None)
    if isinstance(shift, dict) and shift.get("shift_id"):
        print(f"  = {TERMINAL} already has an open shift ({shift['shift_id'][:8]})")
        return
    shift = cashier.post("/api/v1/store/shifts", {
        "terminal_id": TERMINAL, "opening_float_minor": FLOAT, "actor_id": "dian",
        "idempotency_key": f"{MARKER}:shift-live:{_today()}"})
    print(f"  + {TERMINAL} left with an open shift ({shift['shift_id'][:8]}, float "
          f"Rp {FLOAT:,}) for the live till")


def _petty_cash(cashier, manager, password):
    """The shop's tin, so /money/expenses has a row: dian puts Rp 300.000 in
    and pays the cleaner Rp 45.000 out of it, maya signing for both (the node
    refuses the same person taking and signing). Store-local: petty cash has
    no sync fact to head office yet, so it never reaches the books."""
    tin = manager.get("/api/v1/store/petty-cash")
    if (tin.get("balance_minor") or 0) > 0 or _rows(manager.get(
            f"/api/v1/store/expenses?from={_today()}&to={_today()}")):
        print("  = petty cash already has its day")
        return
    sup = {"username": "maya", "password": password}
    cashier.post("/api/v1/store/petty-cash/top-ups", {
        "amount_minor": 300_000, "reference": "KK-001", "note": "Kas kecil minggu ini",
        "actor_id": "dian", "supervisor": sup,
        "idempotency_key": f"{MARKER}:petty-top-up:{_today()}"})
    cashier.post("/api/v1/store/expenses", {
        "category": "expense_cleaning", "amount_minor": 45_000, "payee": "Bu Sri",
        "reason": "Cuci karpet depan toko", "actor_id": "dian", "supervisor": sup,
        "idempotency_key": f"{MARKER}:expense:{_today()}"})
    print("  + petty cash: Rp 300.000 in, Rp 45.000 out (cleaning) — keyed by dian, signed by maya")


def run(cloud, dc, store, ctx):
    nodes = {"cloud": cloud, "dc": dc, "store": store}
    as_user = ctx.get("as_user") or (lambda node, _username: nodes[node])
    password = ctx.get("password") or "Password01"
    cashier = as_user("store", "dian")
    manager = as_user("store", "maya")
    VOUCHER_VALUE.update(ctx.get("voucher_codes") or {"GIFT100SARI": 100_000})

    finance = as_user("cloud", "rina")

    counter_staff = as_user("cloud", "dian")

    day = _till(manager, cashier, manager, password)
    posting = _post_day(finance, [store], day)

    _step("sales — the money: bank deposit, card settlement, points")
    # Read off the posted day, so a re-run finds the same figures: the cash
    # line is the drawer's takings net of change (the float stays in the
    # drawer for tomorrow and is not banked).
    lines = finance.get(f"/api/v1/finance/sales-postings/{posting['posting_id']}")["lines"]
    day_cash = sum(l["gross_minor"] - l.get("returns_minor", 0)
                   for l in lines if l["method"] == "CASH")
    if day_cash > 0:
        _deposit(finance, day_cash)
    _settle_bca(finance, lines)
    _redeem_points(cloud.base, counter_staff, cashier, "081311110001", 50)

    _step("sales — store-01 ready for the live till")
    _petty_cash(cashier, manager, password)
    _ready_for_the_till(cashier, manager)
    ctx["sales_day"] = {"till": day, "posting": posting}
