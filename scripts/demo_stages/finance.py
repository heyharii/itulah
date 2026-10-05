"""finance — the books behind the goods, through the routes Finance uses.

Runs after `goods` (and after outbound/commercial/sales when those exist). Every
journal is written by the poster behind an endpoint; nothing here inserts a
journal row. Small, explainable figures, all in September 2026 (open), all at
head office (`dc`) unless the document is about store-01.

  AP        receipts (valued by Cloud) → bills matched to them → 0002 advance
            applied → 0001 paid in full by transfer, 0002 partly by giro
            → a freight expense bill from 0001 with PPh 23 withheld
  money     owner's capital and a BCA loan into Giro BCA → HO tops up store-01
            petty cash (interunit PEMBIAYAAN) → petty cash spent → a bank
            statement for September matched line by line, the bank's own
            charge and interest booked off the statement
  GL        a manual journal, an accrual, a prepaid insurance schedule with
            September released, a recurring bill template
  interunit management fee to store-01 (LAIN), HO pays store-01 electricity
            (PEMBIAYAAN)
  other     an employee advance paid and settled, a PPh 23 obligation, a giro
            print template, EDC terminal + MDR rate

Who does what, on a rig that requires sign-in (`--password`):

  rina  (Cloud, ADMIN)  Finance HO: keys every head-office document and every
                        manual journal (I2), bills, payments, the loan, the
                        bank statement, the management fee, the setup.
  admin (Cloud, ADMIN)  the second signature: approves the cash documents and
                        the employee advance rina keyed (maker ≠ checker).
  dian  (store-01)      holds the petty-cash tin: records the float head office
                        handed over and what she spent out of it
  maya  (store-01)      the store manager's countersignature on each of those
                        (the store node refuses the claimant approving herself)

Finance at Cloud is ADMIN-only, so the shop's side is its own petty-cash book
on the store node. Cloud has no applier for that book yet, so head office books
the same spending into the GL from the shop's report (rina keys, admin
approves). With sign-in off every call is `development` and the store book is
skipped — it needs maya's password.

Re-runnable: each document is looked up by its own number/reference first.
"""

from __future__ import annotations

import subprocess
import uuid
from datetime import date, timedelta
from pathlib import Path

HO = "dc"          # site_id (premises) for head office
HO_UNIT = "ho"     # unit_id for head office's own books
STORE = "store-01"  # both unit_id and site_id for store-01
BANK_KEY, BANK_Q = "bank_giro", "BCA"   # Giro BCA 8730123456 on 1005 at dc (demo-seed)
SEP = lambda day: f"2026-09-{day:02d}"   # noqa: E731


def rows(payload):
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        for key in ("rows", "items", "data", "results"):
            if isinstance(payload.get(key), list):
                return payload[key]
    return []


def say(msg):
    print(f"  {msg}", flush=True)


# ---------------------------------------------------------------------------
# AP


def post_receipts(cloud):
    """A delivery is valued by Cloud itself the moment its verified lines sync
    in (`system:goods-receipt`, Dr 1029 / Cr 2002), and its cost layers open
    at article setup, so the stock ledger and 1029 agree without Finance
    touching it. Anything still queued (say its period was shut) is valued
    here, as the one-minute sweep would."""
    waiting = rows(cloud.get("/api/v1/finance/receipts/awaiting-posting"))
    for r in waiting:
        cloud.post(f"/api/v1/finance/receipts/{r['receipt_id']}/post", {})
        say(f"+ receipt {r['receipt_number']} valued Rp {r['value_at_order_price_minor']:,}")
    if not waiting:
        say("= every receipt already valued by Cloud on arrival (Dr 1029 / Cr 2002 per supplier)")


def bills_by_number(cloud):
    return {b["invoice_number"]: b for b in rows(cloud.get("/api/v1/finance/bills?limit=200"))}


def rig_db(cloud):
    """The rig's database, from runs/<id>/env (written by rig.sh)."""
    for env in (Path(__file__).resolve().parents[2] / "runs").glob("*/env"):
        conf = dict(line.split("=", 1) for line in env.read_text().splitlines()
                    if "=" in line and not line.startswith("#"))
        if conf.get("CLOUD_URL", "").rstrip("/") == cloud.base:
            return conf["DB_NAME"]
    raise SystemExit(f"finance: no runs/*/env names {cloud.base}")


def sql_read(cloud, query):
    """READ ONLY. Used for the one thing no route lists: a delivery's line ids,
    which the bill match needs (the Hub's match sheet reads them the same way
    through the receipt the DC synced). Never used to write."""
    out = subprocess.run(["psql", "-d", rig_db(cloud), "-AtF", "|", "-c", query],
                         check=True, capture_output=True, text=True).stdout
    return [line.split("|") for line in out.splitlines() if line]


def record_merchandise_bills(cloud, ctx):
    """One bill per delivery, matched to it: posting clears the receipt payable
    (Dr 2002 receipt / Cr 2002 invoice at the same figure — no variance)."""
    have = bills_by_number(cloud)
    for r in rows(cloud.get("/api/v1/finance/unbilled")):
        number = r.get("invoice_number") or f"INV-{r['receipt_number']}"
        if number in have:
            continue
        total = r["invoice_total_minor"] or r["value_at_order_price_minor"]
        # Recording with `receipt_ids` 500s on this build (FOR UPDATE with GROUP
        # BY in record_bill), so the bill is recorded bare and matched as the
        # Hub's match sheet does — the same link, through /match.
        bill = cloud.post("/api/v1/finance/bills", {
            "invoice_number": number, "supplier_id": r["supplier_id"], "supplier_name": None,
            "site_id": r["site_id"], "invoice_date": SEP(26), "due_date": "2026-10-20",
            "subtotal_minor": total, "tax_minor": 0, "discount_minor": 0, "kind": "MERCHANDISE",
            "note": f"Tagihan atas {r['receipt_number']}",
        })
        lines = sql_read(cloud, (
            "SELECT l.receipt_line_id, pl.article_name, l.quantity, pl.unit_price_minor "
            "FROM goods_receipt_line l JOIN purchase_order_line pl USING (po_line_id) "
            f"WHERE l.receipt_id = '{r['receipt_id']}' ORDER BY pl.line_number"))
        cloud.post(f"/api/v1/finance/bills/{bill['invoice_id']}/match", {
            "receipt_ids": [r["receipt_id"]], "accept_variance": False,
            "lines": [{"receipt_line_id": lid, "description": name, "quantity": int(q),
                       "unit_price_minor": int(p), "tax_minor": 0} for lid, name, q, p in lines]})
        # A clean match posts the bill itself; post only if it stopped at MATCHED.
        if cloud.get(f"/api/v1/finance/bills/{bill['invoice_id']}")["status"] in ("DRAFT", "MATCHED"):
            cloud.post(f"/api/v1/finance/bills/{bill['invoice_id']}/post", {"posting_date": SEP(26)})
        say(f"+ bill {number} {r['supplier_id']} Rp {total:,} matched to {r['receipt_number']} and posted")
    have = bills_by_number(cloud)
    ctx["fin_bills"] = {b["supplier_id"]: b for b in have.values()
                        if b["invoice_number"].startswith("INV-SUP-")}


# ---------------------------------------------------------------------------
# helpers over the ledger


def journal_memos(cloud):
    """Memos of the September entries, so a hand-keyed one is written once."""
    got = rows(cloud.get("/api/v1/finance/journal?from=2026-09-01&to=2026-09-30&limit=500"))
    return {j.get("memo") for j in got}


def statement_opening(statements, start, ledger_opening):
    """A statement opens where the previous one closed. Only when none exists
    yet does it read the ledger balance as of its period start. NOTE: stage
    order runs `finance` before `finance_volume`, so September's statement is
    cut before Jan-Aug are back-filled and its ledger opening is then still 0;
    finance_volume's monthly statements chain from the earliest one forward."""
    earlier = [t for t in statements if t.get("account_code") == "1005" and t.get("unit_id") == HO_UNIT
               and str(t.get("period_end", "")) < start and t.get("closing_minor") is not None]
    if earlier:
        return max(earlier, key=lambda t: str(t["period_end"]))["closing_minor"]
    return ledger_opening


def bank_account_id(cloud):
    for acct in rows(cloud.get("/api/v1/finance/bank-accounts")):
        if acct["account_no"] == "8730123456":
            return acct["account_id"]
    raise SystemExit("finance: Giro BCA 8730123456 missing — run demo-seed first")


def manual(cloud, memos, day, memo, lines):
    """A Finance-HO hand-keyed journal (POST /finance/journal, the Journal screen)."""
    if memo in memos:
        return False
    body_lines = []
    for code, site, dr, cr, *extra in lines:
        line = {"account": {"kind": "account", "account_code": code}, "unit_id": site,
                "debit_minor": dr, "credit_minor": cr, "memo": None}
        if extra:
            line.update(extra[0])
        body_lines.append(line)
    out = cloud.post("/api/v1/finance/journal", {"posting_date": SEP(day), "memo": memo,
                                                "lines": body_lines})
    say(f"+ {out['entry_number']} {memo} (Rp {out['total_minor']:,})")
    return True


def cash_doc(cloud, checker, day, frm, to, amount, party, memo, party_type="OTHER", employee=None):
    """Kas keluar / masuk / transfer: the maker records, a second person
    approves, the maker posts (Cash screen; the slip prints both names)."""
    for d in rows(cloud.get("/api/v1/finance/cash-documents?limit=500")):
        if d.get("memo") == memo and d.get("status") != "CANCELLED":
            doc_id = d.get("document_id") or d.get("id")
            # A run cut short between the steps: finish the document it left.
            if d.get("status") == "DRAFT":
                checker.post(f"/api/v1/finance/cash-documents/{doc_id}/approve", {})
                d = cloud.post(f"/api/v1/finance/cash-documents/{doc_id}/post", {})
            elif d.get("status") == "APPROVED":
                d = cloud.post(f"/api/v1/finance/cash-documents/{doc_id}/post", {})
            return d
    doc = cloud.post("/api/v1/finance/cash-documents", {
        "doc_date": SEP(day), "from": frm, "to": to, "amount_minor": amount,
        "party_type": party_type, "supplier_id": None, "employee_id": employee,
        "party_name": party, "memo": memo, "attachment_file_id": None})
    doc_id = doc.get("document_id") or doc.get("id") or doc.get("cash_document_id")
    checker.post(f"/api/v1/finance/cash-documents/{doc_id}/approve", {})
    posted = cloud.post(f"/api/v1/finance/cash-documents/{doc_id}/post", {})
    say(f"+ {doc_number(posted) or doc_id} {memo} Rp {amount:,} "
        f"({posted.get('created_by') or '?'} → {posted.get('approved_by') or '?'})")
    return posted


def doc_number(doc):
    return doc.get("number") or doc.get("doc_number")


def side_code(code, unit=HO_UNIT, category=None):
    """A cash-document side named by a client account code rather than a
    meaning — for a one-off that has no `account_resolution` role of its own."""
    return {"semantic_key": None, "qualifier": "", "account_code": code,
            "category_code": category, "unit_id": unit}


def cash_doc_variety(cloud, checker, ctx):
    """The Cash screen otherwise shows only POSTED slips: one left DRAFT (just
    keyed, not yet checked) and one left APPROVED (checked, not yet posted) —
    the two states a busy Finance desk always has open at month end."""
    have = {d.get("memo"): d for d in rows(cloud.get("/api/v1/finance/cash-documents?limit=500"))
            if d.get("status") != "CANCELLED"}
    memo = "Uang muka perjalanan dinas Oktober (menunggu approval)"
    if memo not in have:
        cloud.post("/api/v1/finance/cash-documents", {
            "doc_date": SEP(29), "from": BANK, "to": side_code("6047"), "amount_minor": 750_000,
            "party_type": "OTHER", "supplier_id": None, "employee_id": None,
            "party_name": "Yusuf (persiapan trip Oktober)", "memo": memo,
            "attachment_file_id": None})
        say(f"+ {memo} Rp 750,000 (keyed by rina, left DRAFT)")
    memo = "Biaya pelatihan kasir store-01 (sudah diperiksa, belum dibukukan)"
    if memo not in have:
        doc = cloud.post("/api/v1/finance/cash-documents", {
            "doc_date": SEP(29), "from": BANK, "to": side_code("6061"), "amount_minor": 400_000,
            "party_type": "OTHER", "supplier_id": None, "employee_id": None,
            "party_name": "Lembaga Pelatihan Ritel Nusantara", "memo": memo,
            "attachment_file_id": None})
        doc_id = doc.get("document_id") or doc.get("id")
        checker.post(f"/api/v1/finance/cash-documents/{doc_id}/approve", {})
        say(f"+ {memo} Rp 400,000 (approved by admin, left APPROVED)")


def side(key=None, unit=HO_UNIT, qualifier="", code=None, category=None):
    return {"semantic_key": key, "qualifier": qualifier, "account_code": code,
            "category_code": category, "unit_id": unit}


BANK = side(BANK_KEY, HO_UNIT, BANK_Q)
STORE_PETTY = side("petty_cash", STORE)


# ---------------------------------------------------------------------------
# money in: the owner's capital and a bank loan


def fund(cloud, ctx):
    principals = rows(cloud.get("/api/v1/finance/principals"))
    owner = next((p for p in principals if p["code"] == "OWN-01"), None)
    if owner is None:
        owner = cloud.post("/api/v1/finance/principals", {
            "code": "OWN-01", "name": "Bapak Hendra Wijaya", "kind": None,
            "note": "Pemilik / principal"})
        say("+ principal OWN-01 Bapak Hendra Wijaya")
    owner = owner.get("principal", owner)
    pid = owner.get("principal_id") or owner.get("id")
    detail = cloud.get(f"/api/v1/finance/principals/{pid}")
    if not detail["principal"]["contributed_minor"]:
        cloud.post("/api/v1/finance/principal-movements", {
            "principal_id": pid, "site_id": HO, "kind": "CONTRIBUTION",
            "amount_minor": 150_000_000, "posting_date": SEP(1), "cash_key": BANK_KEY,
            "cash_qualifier": BANK_Q, "evidence": "Setoran modal 01/09",
            "note": "Setoran modal awal ke Giro BCA"})
        say("+ owner's capital Rp 150,000,000 into Giro BCA (Dr 1005 / Cr 3002)")


def loan(cloud, ctx, memos, bank_id):
    facilities = rows(cloud.get("/api/v1/finance/facilities"))
    fac = next((f for f in facilities if (f.get("note") or "").startswith("Kredit modal kerja BCA")), None)
    if fac is None:
        banks = rows(cloud.get("/api/v1/finance/banks"))
        bca = next((b for b in banks if b.get("code") == "BCA" or b.get("bank_code") == "BCA"), {})
        # 12 monthly instalments of 1,000,000 principal; interest 1% a month
        # on the opening balance (12% p.a. flat on a reducing balance, rounded).
        sched, bal = [], 12_000_000
        for n in range(12):
            y, m = divmod(8 + n, 12)            # first due 25 Sep 2026
            sched.append({"due_date": f"{2026 + y}-{m + 1:02d}-25",
                          "principal_minor": 1_000_000, "interest_minor": bal // 100})
            bal -= 1_000_000
        fac = cloud.post("/api/v1/finance/facilities", {
            "kind": "BANK_LOAN", "site_id": HO, "principal_minor": 12_000_000,
            "start_date": SEP(2), "maturity_date": "2027-08-25",
            "bank_id": bca.get("bank_id") or bca.get("id"), "principal_id": None,
            "lender_name": "Bank BCA", "rate_bps": 1200,
            "principal_qualifier": "BCA", "interest_qualifier": "BANK",
            "installments": sched, "note": "Kredit modal kerja BCA 12 bulan"})
        fac = fac.get("facility", fac)
        say(f"+ facility {fac.get('facility_number')} BCA Rp 12,000,000, 12 instalments")
    # The facility register holds the schedule; the money arriving is the
    # bank's credit, keyed by Finance HO (no writer posts a disbursement).
    manual(cloud, memos, 2, "Pencairan kredit modal kerja BCA",
           [("1005", HO_UNIT, 12_000_000, 0, {"bank_account_id": bank_id}),
            ("2044", HO_UNIT, 0, 12_000_000)])
    fac = cloud.get(f"/api/v1/finance/facilities/{fac['facility_id']}")
    first = sorted(fac.get("installments") or [], key=lambda i: i["seq"])[0]
    if not first.get("entry_id"):
        cloud.post(f"/api/v1/finance/facilities/installments/{first['installment_id']}/pay", {
            "posting_date": SEP(25), "bank_key": BANK_KEY, "bank_qualifier": BANK_Q})
        say(f"+ instalment 1 paid: principal Rp {first['principal_minor']:,} + interest Rp {first['interest_minor']:,}")


# ---------------------------------------------------------------------------
# AP continued: advance, payments, an expense bill with PPh 23


def supplier_advance(cloud, ctx):
    bill = ctx["fin_bills"].get("0002")
    advances = rows(cloud.get("/api/v1/finance/supplier-advances"))
    if bill is None:
        return
    po = next(p for p in rows(cloud.get("/api/v1/purchase-orders?limit=200"))
              if p["po_number"] == "PO-DEMO-002")
    # Outstanding advances only are listed, so "already done" is read off the
    # journal: an advance posted this September means this ran before.
    done = rows(cloud.get("/api/v1/finance/journal?kind=SUPPLIER_ADVANCE&from=2026-09-01&to=2026-09-30&limit=5"))
    if not done and not advances:
        adv = cloud.post("/api/v1/finance/supplier-advances", {
            "purchase_order_id": po["purchase_order_id"], "unit_id": HO_UNIT, "advance_date": SEP(10),
            "amount_minor": 500_000, "account_key": BANK_KEY, "account_qualifier": BANK_Q,
            "reference": "UM-PO-DEMO-002", "note": "Uang muka 500 rb untuk PO-DEMO-002"})
        aid = adv.get("advance_id") or adv.get("id")
        if (adv.get("status") or "DRAFT") == "DRAFT":
            cloud.post(f"/api/v1/finance/supplier-advances/{aid}/post", {})
        cloud.post(f"/api/v1/finance/supplier-advances/{aid}/apply", {
            "invoice_id": bill["invoice_id"], "amount_minor": 500_000, "posting_date": SEP(26)})
        say("+ supplier advance 0002 Rp 500,000 (10 Sep) applied to INV-0002-002")


def pay(cloud, reference, bill_id, amount, day, method="TRANSFER", giro=None):
    for p in rows(cloud.get("/api/v1/finance/payments?limit=200")):
        if p.get("reference") == reference:
            p["_existing"] = True
            return p
    body = {"unit_id": HO_UNIT, "payment_date": SEP(day), "method": method,
            "account_key": BANK_KEY, "account_qualifier": BANK_Q, "total_minor": amount,
            "reference": reference, "note": None,
            "allocations": [{"invoice_id": bill_id, "amount_minor": amount}],
            "giro_number": giro[0] if giro else None, "giro_due_date": giro[1] if giro else None}
    payment = cloud.post("/api/v1/finance/payments", body)
    return payment


def post_payment(cloud, payment, day):
    pid = payment.get("payment_id") or payment.get("id")
    # DRAFT is the only state waiting to be posted — POSTED is done and
    # REVERSED (a bounced giro's payment) is a terminal state re-posting
    # would 409 on, on a re-run that finds it by reference.
    if payment.get("status") == "DRAFT":
        payment = cloud.post(f"/api/v1/finance/payments/{pid}/post", {"posting_date": SEP(day)})
    return payment


def payments(cloud, ctx):
    bills = ctx["fin_bills"]
    if "0001" in bills:
        p = pay(cloud, "TRF-0001-0926", bills["0001"]["invoice_id"], 1_980_000, 26)
        post_payment(cloud, p, 26)
        p.get("_existing") or say("+ 0001 paid in full Rp 1,980,000 by transfer from Giro BCA")
    if "0002" in bills:
        # 3,480,000 − 500,000 advance = 2,980,000 owed; 1,500,000 by giro now.
        p = pay(cloud, "BG-0002-0926", bills["0002"]["invoice_id"], 1_500_000, 26,
                method="GIRO", giro=("BCA-GR-000101", "2026-10-05"))
        post_payment(cloud, p, 26)
        p.get("_existing") or say("+ 0002 paid Rp 1,500,000 of 2,980,000 by giro BCA-GR-000101 due 5 Oct")


def freight_bill(cloud, ctx):
    """0001 charges delivery separately: an EXPENSE bill (6010) with PPh 23
    2% withheld when it is paid (Cr 2012), the rest by transfer."""
    have = bills_by_number(cloud)
    number = "ONGKIR-0001-0926"
    bill = have.get(number)
    if bill is None:
        bill = cloud.post("/api/v1/finance/bills", {
            "invoice_number": number, "supplier_id": "0001", "supplier_name": None,
            "site_id": HO, "invoice_date": SEP(26), "due_date": "2026-10-10",
            "subtotal_minor": 150_000, "tax_minor": 0, "discount_minor": 0, "kind": "EXPENSE",
            "withholding_code": "PPH23_SERVICE", "note": "Ongkos kirim PO-DEMO-001",
            "lines": [{"account_code": "6010", "site_id": HO, "amount_minor": 150_000,
                       "draws_reserve": False, "account_overridden": True,
                       "memo": "Ongkos angkut PO-DEMO-001 ke DC"}]})
        if cloud.get(f"/api/v1/finance/bills/{bill['invoice_id']}")["status"] in ("DRAFT", "MATCHED"):
            cloud.post(f"/api/v1/finance/bills/{bill['invoice_id']}/post", {})
        say(f"+ expense bill {number} 0001 Rp 150,000 (Dr 6010 / Cr 2004)")
    p = pay(cloud, "TRF-ONGKIR-0926", bill["invoice_id"], 150_000, 26)
    pid = p.get("payment_id") or p.get("id")
    if p.get("status") != "POSTED":
        cloud.post(f"/api/v1/finance/payments/{pid}/withholding", {"bank_charge_minor": 0})
        post_payment(cloud, p, 26)
        say("+ freight paid: Rp 147,000 transferred, PPh 23 Rp 3,000 withheld")


# ---------------------------------------------------------------------------


# ---------------------------------------------------------------------------
# petty cash at store-01, and head office paying for the shop (interunit)


def store_tin(ctx):
    """The store node, as the two people who keep store-01's petty cash: dian's
    session (she holds the tin) and maya's countersignature. None with sign-in
    off, where there is no maya to sign."""
    as_user, password = ctx.get("as_user"), ctx.get("password")
    if not (as_user and password):
        return None
    return as_user("store", "dian"), {"username": "maya", "password": password}


def tin_book(till):
    today = date.today()
    return till.get(f"/api/v1/store/expenses?from={today - timedelta(days=366)}&to={today}"
                    "&limit=500")


def tin_top_up(tin, reference, amount, note):
    """The shop counts in the float head office sent (the store's Petty Cash
    screen): dian receives it, maya counts it with her."""
    if tin is None:
        return
    till, maya = tin
    if any(t.get("reference") == reference for t in tin_book(till).get("top_ups") or []):
        return
    till.post("/api/v1/store/petty-cash/top-ups", {
        "amount_minor": amount, "reference": reference, "note": note, "actor_id": "dian",
        "supervisor": maya, "idempotency_key": str(uuid.uuid4())})
    say(f"+ store-01 tin: float Rp {amount:,} received ({reference}) by dian, counted by maya")


def tin_expense(tin, category, amount, payee, reason):
    """Paid out of the tin at the shop: dian claims it, maya signs for it (the
    node refuses the claimant approving herself, and above Rp 500,000 a store
    manager)."""
    if tin is None:
        return
    till, maya = tin
    if any(e.get("reason") == reason for e in tin_book(till).get("expenses") or []):
        return
    till.post("/api/v1/store/expenses", {
        "category": category, "amount_minor": amount, "payee": payee, "reason": reason,
        "actor_id": "dian", "supervisor": maya, "idempotency_key": str(uuid.uuid4())})
    say(f"+ store-01 tin: {payee} Rp {amount:,} paid by dian, approved by maya")


def petty_cash(cloud, checker, ctx):
    tin = store_tin(ctx)
    # P2/P3: HO → unit cash always lands in 1003. Store Dr 1003 / Cr 2028,
    # HO Dr 1057 / Cr 1005 — the balancer writes the two affiliate halves.
    # Head office sends it (rina keys, admin approves); the shop counts it in.
    sent = cash_doc(cloud, checker, 5, BANK, STORE_PETTY, 1_000_000, "Toko 01 (kas kecil)",
                    "Dana kas kecil store-01 September")
    tin_top_up(tin, doc_number(sent), 1_000_000, "Dana kas kecil September dari kantor pusat")
    # Spent at the shop out of the tin: household, stationery, transport. The
    # shop records each against its tin; head office books the same receipts
    # into the GL from the shop's petty-cash report (store Dr expense / Cr 1003).
    # The store node's nine categories are the same meanings the GL maps.
    for day, meaning, amount, payee, what in (
            (12, "expense_household", 85_000, "Toko Sumber Rejeki", "galon & sabun"),
            (16, "expense_stationery", 60_000, "Toko ATK Jaya", "kertas struk & ATK"),
            (19, "expense_transport", 40_000, "Ojek online", "ongkos kirim dokumen")):
        tin_expense(tin, meaning, amount, payee, f"Kas kecil store-01: {what}")
        cash_doc(cloud, checker, day, STORE_PETTY, side(meaning, STORE), amount, payee,
                 f"Kas kecil store-01: {what}")
    # Replenishment: HO puts back exactly what was spent (imprest).
    sent = cash_doc(cloud, checker, 22, BANK, STORE_PETTY, 185_000, "Toko 01 (kas kecil)",
                    "Pengisian kembali kas kecil store-01")
    tin_top_up(tin, doc_number(sent), 185_000, "Pengisian kembali kas kecil (imprest)")
    if tin:
        pos = tin[0].get("/api/v1/store/petty-cash")
        say(f"= store-01 tin holds Rp {pos['balance_minor']:,} "
            f"(in Rp {pos['float_in_minor']:,}, spent Rp {pos['spent_minor']:,}) — "
            "the same as 1003 at store-01 in the GL")


def head_office_pays_the_shop(cloud, checker, ctx):
    # P4 / scenario 4: store Dr 6045 / Cr 2028; HO Dr 1057 / Cr 1005.
    cash_doc(cloud, checker, 18, BANK, side("expense_electricity", STORE), 1_250_000, "PLN",
             "Listrik store-01 Agustus dibayar kantor pusat")
    # Management fee (owner decision 25 Sep): unit 7032 / Cr 2030; HO Dr 1059 / Cr 4016.
    got = rows(cloud.get("/api/v1/finance/journal?kind=MANAGEMENT_FEE&from=2026-09-01&to=2026-09-30&limit=5"))
    if not got and "Management fee store-01 September" not in journal_memos(cloud):
        out = cloud.post("/api/v1/finance/management-fees", {
            "unit_id": STORE, "amount_minor": 250_000, "effective_date": SEP(25),
            "memo": "Management fee store-01 September"})
        say(f"+ {out['entry_number']} management fee store-01 Rp 250,000 (LAIN 2030/1059)")


# ---------------------------------------------------------------------------
# GL: a prepaid with its schedule, an accrual


def prepaid_and_accrual(cloud, checker, ctx):
    memos = journal_memos(cloud)
    # Paid out of Giro BCA as a Kas Keluar straight into 1036 (prepaid
    # insurance): a schedule needs a posted document to hang from.
    doc = cash_doc(cloud, checker, 3, BANK, side("prepaid_expense", HO_UNIT, "ASURANSI_BAYAR_DIMUKA"),
                   1_200_000, "PT Asuransi Sinar Mas", "Premi asuransi properti DC Sep 2026 - Agu 2027")
    doc_id = doc.get("document_id") or doc.get("id")
    schedules = [x for st in ("ACTIVE", "COMPLETED")
                 for x in rows(cloud.get(f"/api/v1/finance/prepaid/schedules?status={st}"))]
    if not any(s.get("source_id") == doc_id for s in schedules):
        cloud.post("/api/v1/finance/prepaid/schedules", {
            "site_id": HO, "prepaid_account_code": "1036", "prepaid_category_code": None,
            "expense_account_code": "7029", "expense_category_code": None,
            "source_kind": "CASH_DOC", "source_id": doc_id, "amount_minor": 1_200_000,
            "start_period": SEP(1), "end_period": "2027-08-01", "currency": "IDR",
            "memo": "Asuransi properti DC, 12 bulan x Rp 100.000"})
        say("+ prepaid schedule: asuransi 1036 → 7029, 12 × Rp 100,000")
    out = cloud.post("/api/v1/finance/prepaid/allocate", {"year": 2026, "month": 9})
    say(f"= prepaid September released ({out if not isinstance(out, dict) else out.get('posted', out.get('allocated', 'ok'))})")
    # Accrual: September's electricity at the DC, billed by PLN in October.
    manual(cloud, memos, 26, "Akrual listrik DC September (tagihan PLN Oktober)",
           [("6045", HO_UNIT, 400_000, 0), ("2023", HO_UNIT, 0, 400_000)])


# ---------------------------------------------------------------------------
# employee receivable (advance), tax, recurring bill, setup


def employee_advance(cloud, checker, ctx):
    """Yusuf's travel advance. Asking for one at Cloud is a finance write, which
    is ADMIN — so Finance HO (rina) keys his request, admin approves it, rina
    pays it out of Giro BCA and settles it against his receipts."""
    purpose = "Perjalanan dinas Yusuf ke pemasok Bandung"
    adv = next((a for a in rows(cloud.get("/api/v1/finance/advances"))
                if (a.get("purpose") or "").startswith(purpose)), None)
    if adv is None:
        yusuf = next((e["employee_id"] for e in rows(cloud.get("/api/v1/employees?limit=100"))
                      if e.get("employee_code") == "HO-0007"), None)
        if yusuf is None:
            return
        adv = cloud.post("/api/v1/finance/advances", {
            "site_id": HO, "party_type": "EMPLOYEE", "employee_id": yusuf,
            "supplier_id": None, "party_name": None, "purpose": purpose,
            "amount_minor": 300_000, "advance_qualifier": "PERJALANAN", "note": None})
    adv = adv.get("advance", adv)
    aid = adv.get("advance_id") or adv.get("id")
    status = adv.get("status") or "REQUESTED"
    if status in ("SETTLED", "CLOSED", "CANCELLED") or adv.get("settled_minor"):
        return
    # Each step only from the state the previous one leaves, so a run cut
    # short part-way finishes the document instead of starting another.
    if status == "REQUESTED":
        checker.post(f"/api/v1/finance/advances/{aid}/approve", {})
        status = "APPROVED"
    if status == "APPROVED":
        cloud.post(f"/api/v1/finance/advances/{aid}/pay", {
            "posting_date": SEP(14), "cash_key": BANK_KEY, "cash_qualifier": BANK_Q})
    cloud.post(f"/api/v1/finance/advances/{aid}/settle", {
        "kind": "EXPENSE", "amount_minor": 250_000, "posting_date": SEP(18),
        "account_code": "6047", "category_code": None, "cash_key": None, "cash_qualifier": "",
        "evidence": "Nota hotel & bensin", "note": None})
    say("+ employee advance Yusuf Rp 300,000 (keyed by rina, approved by admin) paid 14 Sep; "
        "Rp 250,000 settled with receipts (6047), Rp 50,000 still owed (1051)")


def tax(cloud, ctx):
    """PPh 23 kept back from 0001's freight payment (Rp 3,000, on 2012):
    the tax sub-ledger's obligation for September, filed in October."""
    periods = rows(cloud.get("/api/v1/finance/tax/periods"))
    if any(p.get("tax_type_code") == "PPH23" and p.get("period_year") == 2026
           and p.get("period_month") == 9 and p.get("obligation_minor") for p in periods):
        return
    pay_row = next((p for p in rows(cloud.get("/api/v1/finance/payments?limit=200"))
                    if p.get("reference") == "TRF-ONGKIR-0926"), None)
    if pay_row is None:
        return
    cloud.post("/api/v1/finance/tax/items", {
        "tax_type_code": "PPH23", "year": 2026, "month": 9, "unit_id": HO_UNIT,
        "kind": "OBLIGATION", "amount_minor": 3_000, "source_kind": "PAYMENT",
        "source_id": pay_row.get("payment_id") or pay_row.get("id"),
        "evidence": "Bukti potong PPh 23 ongkir 0001", "note": "2% x Rp 150.000"})
    say("+ PPh 23 September: obligation Rp 3,000 (ongkir 0001)")


ASSET_ACCOUNT = {"AIR_CONDITIONER": "1067", "FFE_TOKO_DAN_GUDANG": "1074",
                 "FFE_KOMPUTER": "1075", "FFE_OFFICE": "1073"}   # 0355 class -> fixed_asset account
OPENING_EQUITY = "3002"                                          # Modal Setor


def assets(cloud, ctx):
    """Three fixed assets, capitalised and depreciating: a laptop and office
    furniture at head office, an air conditioner at store-01 — the Assets
    screen with something on it, and September's charge run behind them."""
    have = {a["asset_number"]: a for a in rows(cloud.get("/api/v1/finance/assets?limit=200"))}
    plan = (
        ("FA-DC-0001", "Laptop Kasir DC", "FFE_KOMPUTER", HO, 8_000_000, 48),
        ("FA-DC-0002", "Meja & Kursi Kantor DC", "FFE_OFFICE", HO, 5_000_000, 60),
        ("FA-ST01-0001", "AC Split Ruang Kasir Store-01", "AIR_CONDITIONER", STORE, 4_500_000, 48),
    )
    for number, name, category, site, cost, life in plan:
        asset = have.get(number)
        if asset is None:
            asset = cloud.post("/api/v1/finance/assets", {
                "asset_number": number, "name": name, "category_code": category,
                "site_id": site, "acquired_on": SEP(3), "serial_number": None,
                "notes": "Demo: aset dibeli tunai, dicatat langsung di register",
                "quantity": None, "acquired_via_line_id": None})
            say(f"+ asset {number} {name} registered ({category})")
        aid = asset.get("asset_id") or asset.get("id")
        if asset.get("decision") != "CAPITALIZE":
            asset = cloud.post(f"/api/v1/finance/assets/{aid}/assess", {
                "decision": "CAPITALIZE", "capitalized_cost_minor": cost,
                "salvage_value_minor": 0, "useful_life_months": life, "rate_bps": None,
                "method": "STRAIGHT_LINE", "category_code": None,
                "charge_kind": "DEPRECIATION", "in_service_on": SEP(3),
                "opening_accumulated_minor": None, "opening_through": None,
                "reason": "Demo: aset baru, dikapitalisasi saat diterima",
                "acquired_via_line_id": None, "acquired_via_line_ids": None})
            say(f"+ asset {number} capitalised Rp {cost:,}, {life} months straight-line")
        # Assess writes no journal: put the cost in the ledger by hand.
        manual(cloud, journal_memos(cloud), 3, f"Opening cost of {number}", [
            (ASSET_ACCOUNT[category], HO_UNIT if site == HO else site, cost, 0),
            (OPENING_EQUITY, HO_UNIT if site == HO else site, 0, cost)])
    out = cloud.post("/api/v1/finance/depreciation/run", {"year": 2026, "month": 9})
    posted = out.get("posted_count") if isinstance(out, dict) else None
    if posted:
        say(f"+ depreciation run September: {posted} asset(s) charged, "
            f"Rp {out.get('posted_total_minor', 0):,}")


def recurring_bill(cloud, ctx):
    if any(t.get("label") == "Ongkos angkut bulanan 0001" for t in rows(cloud.get("/api/v1/finance/bill-templates"))):
        return
    cloud.post("/api/v1/finance/bill-templates", {
        "supplier_id": "0001", "supplier_name": None, "site_id": HO,
        "expense_account_code": "6010", "expense_category_code": None, "expense_site_id": HO,
        "expected_subtotal_minor": 150_000, "expected_tax_minor": 0, "tolerance_bps": 500,
        "due_day": 25, "label": "Ongkos angkut bulanan 0001",
        "note": "Tagihan ongkir rutin; draf dibuat otomatis tiap bulan", "contract_id": None})
    say("+ recurring bill template: ongkos angkut 0001 Rp 150,000 on the 25th "
        "(the hourly recurring-bills agent raises the draft)")


def account_links(cloud, ctx):
    """The store's petty-cash categories (dian's tin) and HO paying the shop's
    electricity are meanings with no account behind them yet on this build's
    seed (0460 links the closed forty-account chart, not these) — link them
    once on the Account Links screen so the cash documents below can post."""
    have = {r["role"] for r in rows(cloud.get("/api/v1/finance/account-links"))}
    for role, code, label in (
            ("expense_household", "6042", "Biaya Rumah Tangga"),
            ("expense_stationery", "6041", "Alat Tulis Kantor & Barang Cetakan"),
            ("expense_transport", "6048", "Biaya Lokal Transport"),
            ("expense_electricity", "6045", "Biaya Pemakaian Listrik")):
        if role in have:
            continue
        cloud.post("/api/v1/finance/account-links", {
            "role": role, "source_type": "COMPANY", "source_id": "",
            "scope_type": "ALL", "scope_key": "", "account_code": code,
            "category_code": None, "note": f"Demo: {label} (kas kecil store)"})
        say(f"+ account link {role} → {code} {label}")


def journal_template(cloud, ctx):
    """A reusable manual-journal template (the Journal Entry Template screen,
    ERPNext's Journal Entry Template / Auto Repeat), and one repeat that has
    already fired: September's telephone accrual, raised and posted from it
    rather than hand-keyed — so the Journal list shows both kinds of entry."""
    existing = {t["name"]: t for t in rows(cloud.get("/api/v1/finance/journal-templates"))}
    tpl = existing.get("Akrual Telepon & Internet DC")
    if tpl is None:
        tpl = cloud.post("/api/v1/finance/journal-templates", {
            "name": "Akrual Telepon & Internet DC", "is_active": True,
            "memo": "Akrual biaya telepon & internet DC bulanan (tagihan menyusul)",
            "lines": [
                {"account": {"kind": "account", "account_code": "6044"}, "unit_id": HO_UNIT,
                 "debit_minor": 350_000, "credit_minor": 0, "memo": None},
                {"account": {"kind": "account", "account_code": "2022"}, "unit_id": HO_UNIT,
                 "debit_minor": 0, "credit_minor": 350_000, "memo": None}]})
        say("+ journal template: Akrual Telepon & Internet DC (6044/2022, Rp 350,000)")
    tpl_id = tpl.get("template_id") or tpl.get("id")
    repeats = rows(cloud.get("/api/v1/finance/journal-repeats"))
    if not any(r.get("template_id") == tpl_id for r in repeats):
        cloud.post("/api/v1/finance/journal-repeats", {
            "template_id": tpl_id, "frequency": "MONTHLY", "next_date": SEP(1),
            "end_date": None, "auto_post": True, "is_active": True})
        say("+ journal repeat: Akrual Telepon & Internet DC, monthly, auto-post")
    out = cloud.post("/api/v1/finance/journal-repeats/run", {})
    if out.get("drafted") or out.get("posted"):
        say(f"+ journal repeats swept: {out.get('posted', 0)} posted, {out.get('drafted', 0)} drafted")


def setup(cloud, ctx):
    if not rows(cloud.get("/api/v1/finance/giro-print-templates")):
        cloud.post("/api/v1/finance/giro-print-templates", {"bank_qualifier": "BCA",
                                                            "label": "Bilyet giro BCA"})
        say("+ giro print template: Bilyet giro BCA")
    # EDC & MDR (the sales stage may already have added its own; add only if empty).
    if not rows(cloud.get("/api/v1/finance/edc-terminals")):
        cloud.post("/api/v1/finance/edc-terminals", {"site_id": STORE, "terminal_id": "BCA-ST01-01",
                                                     "bank_code": "BCA", "label": "EDC BCA kasir 1",
                                                     "active": True})
        say("+ EDC terminal BCA-ST01-01 at store-01")
    if not rows(cloud.get("/api/v1/finance/acquirer-fee-rates")):
        for kind, pct in (("DEBIT_ON_US", "0.15"), ("DEBIT_OFF_US", "1.00"), ("CREDIT", "1.80"),
                          ("QRIS", "0.70")):
            cloud.post("/api/v1/finance/acquirer-fee-rates", {
                "bank_code": "BCA", "fee_kind": kind, "rate_percent": pct,
                "effective_from": SEP(1), "note": "MDR BCA (sudah termasuk PPN)"})
        say("+ MDR BCA: debit on-us 0.15%, off-us 1%, credit 1.8%, QRIS 0.7%")


# ---------------------------------------------------------------------------
# the bank statement for September, matched line by line


def bank_statement(cloud, ctx, bank_id):
    """Giro BCA's rekening koran 1–26 Sep: every movement the books made, plus
    three the bank made or reported on its own — an admin fee (booked off the
    statement, Dr 6043 / Cr 1005, I11), interest the bookkeeper has not looked
    at yet, and a stamp-duty deduction nobody recognises — so Bank
    Reconciliation still has two bank-only lines to work. The giro to 0002
    (due 5 Oct) has not been presented, so it is not on it, and three of the
    giro moves from `giro_variety` land on the 27th–29th — after this
    statement's cutoff — so they sit book-only, in transit, the same way."""
    statements = rows(cloud.get("/api/v1/finance/bank-statements"))
    mine = [s for s in statements if s.get("account_code") == "1005" and s.get("unit_id") == HO_UNIT
            and str(s.get("period_start", "")).startswith("2026-09")]
    if not mine:
        ledger = cloud.get(f"/api/v1/finance/accounts/1005/ledger?unit={HO_UNIT}"
                           "&from=2026-09-01&to=2026-09-26&limit=500")
        lines = [{"value_date": r["posting_date"],
                  "description": (r.get("memo") or r["entry_number"])[:60],
                  "reference": r["entry_number"],
                  "debit_minor": r["credit_minor"], "credit_minor": r["debit_minor"]}
                 for r in rows(ledger)]
        lines += [
            {"value_date": SEP(26), "description": "BIAYA ADM REKENING", "reference": None,
             "debit_minor": 15_000, "credit_minor": 0},
            # Left unbooked on purpose: Finance has not looked at either of
            # these yet, so Bank Reconciliation has real work to show.
            {"value_date": SEP(26), "description": "BUNGA JASA GIRO", "reference": None,
             "debit_minor": 0, "credit_minor": 8_500},
            {"value_date": SEP(24), "description": "BIAYA METERAI", "reference": None,
             "debit_minor": 10_000, "credit_minor": 0},
        ]
        opening = statement_opening(statements, SEP(1), ledger["opening_minor"])
        closing = opening + sum(l["credit_minor"] - l["debit_minor"] for l in lines)
        cloud.post("/api/v1/finance/bank-statements", {
            "account_code": "1005", "unit_id": HO_UNIT, "bank_account_id": bank_id,
            "period_start": SEP(1), "period_end": SEP(26),
            "opening_minor": opening, "closing_minor": closing,
            "source_name": "rekening-koran-BCA-8730123456-2026-09.csv", "lines": lines})
        say(f"+ bank statement Giro BCA 1–26 Sep: {len(lines)} lines, closing Rp {closing:,}")
        statements = rows(cloud.get("/api/v1/finance/bank-statements"))
        mine = [s for s in statements if s.get("account_code") == "1005" and s.get("unit_id") == HO_UNIT
                and str(s.get("period_start", "")).startswith("2026-09")]
    stmt = mine[0]
    sid = stmt.get("statement_id") or stmt.get("id")
    # Each line the books already have: confirm the match to its journal line.
    by_entry = {r["entry_number"]: r["line_id"] for r in rows(cloud.get(
        f"/api/v1/finance/accounts/1005/ledger?unit={HO_UNIT}&from=2026-09-01&to=2026-09-30&limit=500"))}
    matched = booked = 0
    for line in rows(cloud.get(f"/api/v1/finance/bank-statements/{sid}/lines")):
        if line.get("matched_journal_line_id") or line.get("status") in ("MATCHED", "BOOKED"):
            continue
        if line.get("reference") in by_entry:
            cloud.post(f"/api/v1/finance/bank-lines/{line['line_id']}/match", {
                "journal_line_id": by_entry[line["reference"]], "score": 100,
                "reasons": ["amount", "date", "reference"], "automatic": False})
            matched += 1
        elif line["description"] == "BIAYA ADM REKENING":
            cloud.post(f"/api/v1/finance/bank-lines/{line['line_id']}/book", {
                "account_code": "6043", "category_code": None,
                "memo": "Biaya administrasi rekening Giro BCA September", "party_name": "Bank BCA"})
            booked += 1
        # BUNGA JASA GIRO and BIAYA METERAI are deliberately left alone: two
        # bank-only lines still waiting on Finance, so Bank Reconciliation has
        # something to show besides a clean sheet.
    if matched or booked:
        say(f"+ reconciliation: {matched} lines matched to the books, {booked} booked off the statement "
            "(2 bank-only lines left for review: interest, stamp duty)")


def bank_statement_late(cloud, ctx, bank_id):
    """A second statement, 27–30 Sep: the one bank move `giro_variety` makes
    (BCA-GR-000104 clearing on the 29th) and the transfer that replaced the
    bounced giro, plus a returned-item fee the bank charged that nobody has
    booked yet — so Bank Reconciliation still has an open line even after the
    first statement squared away clean."""
    statements = rows(cloud.get("/api/v1/finance/bank-statements"))
    mine = [s for s in statements if s.get("account_code") == "1005" and s.get("unit_id") == HO_UNIT
            and str(s.get("period_start", "")) == SEP(27)]
    if not mine:
        ledger = cloud.get(f"/api/v1/finance/accounts/1005/ledger?unit={HO_UNIT}"
                           f"&from={SEP(27)}&to={SEP(30)}&limit=500")
        lines = [{"value_date": r["posting_date"],
                  "description": (r.get("memo") or r["entry_number"])[:60],
                  "reference": r["entry_number"],
                  "debit_minor": r["credit_minor"], "credit_minor": r["debit_minor"]}
                 for r in rows(ledger)]
        # Left unmatched on purpose: a returned-item fee nobody has booked yet.
        lines.append({"value_date": SEP(30), "description": "BIAYA TOLAKAN KLIRING",
                      "reference": None, "debit_minor": 5_000, "credit_minor": 0})
        opening = statement_opening(statements, SEP(27), ledger["opening_minor"])
        closing = opening + sum(l["credit_minor"] - l["debit_minor"] for l in lines)
        cloud.post("/api/v1/finance/bank-statements", {
            "account_code": "1005", "unit_id": HO_UNIT, "bank_account_id": bank_id,
            "period_start": SEP(27), "period_end": SEP(30),
            "opening_minor": opening, "closing_minor": closing,
            "source_name": "rekening-koran-BCA-8730123456-2026-09-late.csv", "lines": lines})
        say(f"+ bank statement Giro BCA 27–30 Sep: {len(lines)} lines, closing Rp {closing:,}")
        statements = rows(cloud.get("/api/v1/finance/bank-statements"))
        mine = [s for s in statements if s.get("account_code") == "1005" and s.get("unit_id") == HO_UNIT
                and str(s.get("period_start", "")) == SEP(27)]
    stmt = mine[0]
    sid = stmt.get("statement_id") or stmt.get("id")
    by_entry = {r["entry_number"]: r["line_id"] for r in rows(cloud.get(
        f"/api/v1/finance/accounts/1005/ledger?unit={HO_UNIT}&from={SEP(27)}&to={SEP(30)}&limit=500"))}
    matched = 0
    for line in rows(cloud.get(f"/api/v1/finance/bank-statements/{sid}/lines")):
        if line.get("matched_journal_line_id") or line.get("status") in ("MATCHED", "BOOKED"):
            continue
        if line.get("reference") in by_entry:
            cloud.post(f"/api/v1/finance/bank-lines/{line['line_id']}/match", {
                "journal_line_id": by_entry[line["reference"]], "score": 100,
                "reasons": ["amount", "date", "reference"], "automatic": False})
            matched += 1
        # BIAYA TOLAKAN KLIRING stays unmatched: the open item this statement
        # exists to demonstrate.
    if matched:
        say(f"+ reconciliation (27–30 Sep): {matched} lines matched, 1 bank-only line still open")


def ap_ageing_variety(cloud, ctx):
    """The Purchase Invoice / AP screens read thin with one bill per supplier,
    all `not_due`: an unpaid one already past its date (0002, an earlier
    delivery's freight) and a draft still being checked (0001, a service
    not yet approved) — so ageing has a bucket besides `not_due` and the
    Purchase Invoice list has more than one status."""
    have = bills_by_number(cloud)
    number = "ONGKIR-0002-0912"
    if number not in have:
        bill = cloud.post("/api/v1/finance/bills", {
            "invoice_number": number, "supplier_id": "0002", "supplier_name": None,
            "site_id": HO, "invoice_date": SEP(5), "due_date": "2026-09-15",
            "subtotal_minor": 220_000, "tax_minor": 0, "discount_minor": 0, "kind": "EXPENSE",
            "withholding_code": None, "note": "Ongkos kirim PO-DEMO-002 (belum dibayar)",
            "lines": [{"account_code": "6010", "site_id": HO, "amount_minor": 220_000,
                       "draws_reserve": False, "account_overridden": True,
                       "memo": "Ongkos angkut PO-DEMO-002 ke DC"}]})
        if cloud.get(f"/api/v1/finance/bills/{bill['invoice_id']}")["status"] in ("DRAFT", "MATCHED"):
            cloud.post(f"/api/v1/finance/bills/{bill['invoice_id']}/post", {})
        say(f"+ overdue bill {number} 0002 Rp 220,000, due 15 Sep, unpaid")
    number = "INV-0001-003"
    if number not in have:
        # A MERCHANDISE bill nobody has matched to a receipt yet: the one kind
        # of bill this build does not auto-post, so it sits DRAFT for review —
        # the paper arrived ahead of the delivery it is for.
        cloud.post("/api/v1/finance/bills", {
            "invoice_number": number, "supplier_id": "0001", "supplier_name": None,
            "site_id": HO, "invoice_date": SEP(28), "due_date": "2026-10-28",
            "subtotal_minor": 2_150_000, "tax_minor": 0, "discount_minor": 0,
            "kind": "MERCHANDISE", "note": "Faktur PO-DEMO-003 (belum dicocokkan, barang belum tiba)"})
        say(f"+ draft bill {number} 0001 Rp 2,150,000 (left DRAFT, unmatched)")


def giro_by_number(cloud, number):
    for g in rows(cloud.get("/api/v1/finance/giros?limit=200")):
        if g.get("number") == number:
            return g
    return None


def giro_variety(cloud, checker, ctx):
    """The Banking screens read thin with one giro: a vehicle-service bill
    from 0002, split across four giros so each rung of the ladder has an
    example (issued, delivered, cleared, bounced-then-replaced), plus one
    giro the other way — a refund handed to head office as a post-dated
    cheque (a BKM, direction IN)."""
    have = bills_by_number(cloud)
    number = "SERVIS-0002-0918"
    bill = have.get(number)
    if bill is None:
        bill = cloud.post("/api/v1/finance/bills", {
            "invoice_number": number, "supplier_id": "0002", "supplier_name": None,
            "site_id": HO, "invoice_date": SEP(18), "due_date": "2026-10-18",
            "subtotal_minor": 2_000_000, "tax_minor": 0, "discount_minor": 0, "kind": "EXPENSE",
            "withholding_code": None, "note": "Servis kendaraan operasional DC",
            "lines": [{"account_code": "6071", "site_id": HO, "amount_minor": 2_000_000,
                       "draws_reserve": False, "account_overridden": True,
                       "memo": "Servis rutin kendaraan operasional"}]})
        say(f"+ expense bill {number} 0002 Rp 2,000,000 (Dr 6071 / Cr 2004)")
    bill_id = bill["invoice_id"]

    # 1) issued — left exactly where a fresh giro starts.
    p = pay(cloud, "BG-SERVIS-01", bill_id, 500_000, 15, method="GIRO",
            giro=("BCA-GR-000102", "2026-10-15"))
    post_payment(cloud, p, 15)
    p.get("_existing") or say("+ giro BCA-GR-000102 Rp 500,000 issued to 0002 (servis, 1/4)")

    # 2) delivered — handed to the supplier, nothing posted yet.
    p = pay(cloud, "BG-SERVIS-02", bill_id, 500_000, 16, method="GIRO",
            giro=("BCA-GR-000103", "2026-10-16"))
    post_payment(cloud, p, 16)
    g = giro_by_number(cloud, "BCA-GR-000103")
    if g and g["status"] == "ISSUED":
        cloud.post(f"/api/v1/finance/giros/{g['giro_id']}/deliver", {})
        say("+ giro BCA-GR-000103 delivered to 0002 (servis, 2/4)")

    # 3) cleared — the bank took it; the only move that touches 1005.
    p = pay(cloud, "BG-SERVIS-03", bill_id, 500_000, 17, method="GIRO",
            giro=("BCA-GR-000104", "2026-10-17"))
    post_payment(cloud, p, 17)
    g = giro_by_number(cloud, "BCA-GR-000104")
    if g and g["status"] not in ("CLEARED", "REJECTED"):
        cloud.post(f"/api/v1/finance/giros/{g['giro_id']}/clear",
                   {"on": SEP(29), "statement_line_id": None, "reason": None})
        say("+ giro BCA-GR-000104 cleared by the bank 29 Sep (servis, 3/4)")

    # 4) bounced, then replaced by a transfer for the same bill.
    p = pay(cloud, "BG-SERVIS-04", bill_id, 500_000, 18, method="GIRO",
            giro=("BCA-GR-000105", "2026-10-18"))
    post_payment(cloud, p, 18)
    g = giro_by_number(cloud, "BCA-GR-000105")
    if g and g["status"] not in ("CLEARED", "REJECTED"):
        cloud.post(f"/api/v1/finance/giros/{g['giro_id']}/reject",
                   {"on": SEP(27), "statement_line_id": None,
                    "reason": "Ditolak bank: saldo rekening 0002 tidak dapat menerima kliring"})
        say("+ giro BCA-GR-000105 bounced 27 Sep (servis, 4/4) — debt reopened")
    if g and not (g.get("replaced_by_payment_id") or g.get("replaced_by_document_id")):
        r = pay(cloud, "TRF-SERVIS-04-REPLACE", bill_id, 500_000, 28)
        r = post_payment(cloud, r, 28)
        rid = r.get("payment_id") or r.get("id")
        cloud.post(f"/api/v1/finance/giros/{g['giro_id']}/replace", {"payment_id": rid})
        say("+ bounced giro BCA-GR-000105 replaced by transfer TRF-SERVIS-04-REPLACE")

    # An incoming giro — money the other way, on a BKM. A landlord refunding
    # a rent deposit with a post-dated cheque rather than a transfer.
    number = "Refund jaminan sewa gudang cadangan"
    already = any(d.get("memo") == number and d.get("status") != "CANCELLED"
                  for d in rows(cloud.get("/api/v1/finance/cash-documents?limit=500")))
    if not already:
        # `POST /finance/cash-documents/voucher` exists in the source
        # (`record_voucher`, money.rs) but this rig's running `cloud` binary
        # answers it 405 Allow: GET,HEAD — a stale build that predates the
        # route. Not a finance.py bug; skip this one document rather than
        # fail the whole stage, and leave the note in the run's output.
        try:
            doc = cloud.post("/api/v1/finance/cash-documents/voucher", {
                "doc_date": SEP(20), "direction": "IN", "money": BANK, "method": "GIRO",
                "reference": None, "giro_number": "BCA-GR-IN-000001", "giro_due_date": "2026-10-20",
                "giro_bank": "MANDIRI", "party_type": "OTHER", "supplier_id": None,
                "employee_id": None, "party_name": "PT Properti Cikupa", "memo": number,
                "lines": [{"kind": "OTHER",
                           "account": {"semantic_key": None, "qualifier": "", "account_code": "6002",
                                       "category_code": None, "unit_id": HO_UNIT},
                           "amount_minor": 800_000, "discount_minor": 0,
                           "note": "Refund jaminan sewa gudang cadangan (giro mundur)"}]})
        except SystemExit as error:
            say(f"!! skipped: incoming giro BKM needs POST /finance/cash-documents/voucher, "
                f"which this build's binary does not route yet ({error})")
        else:
            doc_id = doc.get("document_id") or doc.get("id")
            checker.post(f"/api/v1/finance/cash-documents/{doc_id}/approve", {})
            cloud.post(f"/api/v1/finance/cash-documents/{doc_id}/post", {})
            say("+ incoming giro BCA-GR-IN-000001 Rp 800,000 from PT Properti Cikupa (BKM)")


# ---------------------------------------------------------------------------


def run(cloud, dc, store, ctx):
    print("\n\033[1m── demo-populate: finance — AP, bank, petty cash, GL, financing, "
          "interunit, tax\033[0m", flush=True)
    # Finance HO keys (rina — the default Cloud actor when signed in); admin is
    # the second signature. Without a password both are the one plain node.
    as_user = ctx.get("as_user")
    finance = as_user("cloud", "rina") if as_user else cloud
    checker = as_user("cloud", "admin") if as_user else cloud
    if ctx.get("password"):
        say(f"as {finance.user} (Finance HO), approvals by {checker.user}, "
            "store-01 petty cash by dian + maya")
    run_as(finance, checker, ctx)


def run_as(cloud, checker, ctx):
    bank_id = bank_account_id(cloud)
    post_receipts(cloud)
    record_merchandise_bills(cloud, ctx)
    fund(cloud, ctx)
    loan(cloud, ctx, journal_memos(cloud), bank_id)
    account_links(cloud, ctx)
    journal_template(cloud, ctx)
    prepaid_and_accrual(cloud, checker, ctx)
    petty_cash(cloud, checker, ctx)
    supplier_advance(cloud, ctx)
    employee_advance(cloud, checker, ctx)
    head_office_pays_the_shop(cloud, checker, ctx)
    payments(cloud, ctx)
    freight_bill(cloud, ctx)
    ap_ageing_variety(cloud, ctx)
    giro_variety(cloud, checker, ctx)
    cash_doc_variety(cloud, checker, ctx)
    tax(cloud, ctx)
    assets(cloud, ctx)
    recurring_bill(cloud, ctx)
    setup(cloud, ctx)
    bank_statement(cloud, ctx, bank_id)   # last: it mirrors every bank movement above
    bank_statement_late(cloud, ctx, bank_id)   # the giro clear + replacement, 27-30 Sep
