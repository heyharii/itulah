"""finance — the books behind the goods, through the routes Finance uses.

Runs after `goods` (and after outbound/commercial/sales when those exist). Every
journal is written by the poster behind an endpoint; nothing here inserts a
journal row. Small, explainable figures, all in September 2026 (open), all at
head office (`dc`) unless the document is about store-01.

  AP        receipts (valued by Cloud) → bills matched to them → SUP-002 advance
            applied → SUP-001 paid in full by transfer, SUP-002 partly by giro
            → a freight expense bill from SUP-001 with PPh 23 withheld
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

HO = "dc"
STORE = "store-01"
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
        line = {"account": {"kind": "account", "account_code": code}, "site_id": site,
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


def side(key=None, site=HO, qualifier="", code=None, category=None):
    return {"semantic_key": key, "qualifier": qualifier, "account_code": code,
            "category_code": category, "site_id": site}


BANK = side(BANK_KEY, HO, BANK_Q)
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
           [("1005", HO, 12_000_000, 0, {"bank_account_id": bank_id}),
            ("2044", HO, 0, 12_000_000)])
    fac = cloud.get(f"/api/v1/finance/facilities/{fac['facility_id']}")
    first = sorted(fac.get("installments") or [], key=lambda i: i["seq"])[0]
    if not first.get("entry_id"):
        cloud.post(f"/api/v1/finance/facilities/installments/{first['installment_id']}/pay", {
            "posting_date": SEP(25), "bank_key": BANK_KEY, "bank_qualifier": BANK_Q})
        say(f"+ instalment 1 paid: principal Rp {first['principal_minor']:,} + interest Rp {first['interest_minor']:,}")


# ---------------------------------------------------------------------------
# AP continued: advance, payments, an expense bill with PPh 23


def supplier_advance(cloud, ctx):
    bill = ctx["fin_bills"].get("SUP-002")
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
            "purchase_order_id": po["purchase_order_id"], "site_id": HO, "advance_date": SEP(10),
            "amount_minor": 500_000, "account_key": BANK_KEY, "account_qualifier": BANK_Q,
            "reference": "UM-PO-DEMO-002", "note": "Uang muka 500 rb untuk PO-DEMO-002"})
        aid = adv.get("advance_id") or adv.get("id")
        if (adv.get("status") or "DRAFT") == "DRAFT":
            cloud.post(f"/api/v1/finance/supplier-advances/{aid}/post", {})
        cloud.post(f"/api/v1/finance/supplier-advances/{aid}/apply", {
            "invoice_id": bill["invoice_id"], "amount_minor": 500_000, "posting_date": SEP(26)})
        say("+ supplier advance SUP-002 Rp 500,000 (10 Sep) applied to INV-SUP-002-002")


def pay(cloud, reference, bill_id, amount, day, method="TRANSFER", giro=None):
    for p in rows(cloud.get("/api/v1/finance/payments?limit=200")):
        if p.get("reference") == reference:
            p["_existing"] = True
            return p
    body = {"site_id": HO, "payment_date": SEP(day), "method": method,
            "account_key": BANK_KEY, "account_qualifier": BANK_Q, "total_minor": amount,
            "reference": reference, "note": None,
            "allocations": [{"invoice_id": bill_id, "amount_minor": amount}],
            "giro_number": giro[0] if giro else None, "giro_due_date": giro[1] if giro else None}
    payment = cloud.post("/api/v1/finance/payments", body)
    return payment


def post_payment(cloud, payment, day):
    pid = payment.get("payment_id") or payment.get("id")
    if payment.get("status") != "POSTED":
        payment = cloud.post(f"/api/v1/finance/payments/{pid}/post", {"posting_date": SEP(day)})
    return payment


def payments(cloud, ctx):
    bills = ctx["fin_bills"]
    if "SUP-001" in bills:
        p = pay(cloud, "TRF-SUP-001-0926", bills["SUP-001"]["invoice_id"], 1_980_000, 26)
        post_payment(cloud, p, 26)
        p.get("_existing") or say("+ SUP-001 paid in full Rp 1,980,000 by transfer from Giro BCA")
    if "SUP-002" in bills:
        # 3,480,000 − 500,000 advance = 2,980,000 owed; 1,500,000 by giro now.
        p = pay(cloud, "BG-SUP-002-0926", bills["SUP-002"]["invoice_id"], 1_500_000, 26,
                method="GIRO", giro=("BCA-GR-000101", "2026-10-05"))
        post_payment(cloud, p, 26)
        p.get("_existing") or say("+ SUP-002 paid Rp 1,500,000 of 2,980,000 by giro BCA-GR-000101 due 5 Oct")


def freight_bill(cloud, ctx):
    """SUP-001 charges delivery separately: an EXPENSE bill (6010) with PPh 23
    2% withheld when it is paid (Cr 2012), the rest by transfer."""
    have = bills_by_number(cloud)
    number = "ONGKIR-SUP-001-0926"
    bill = have.get(number)
    if bill is None:
        bill = cloud.post("/api/v1/finance/bills", {
            "invoice_number": number, "supplier_id": "SUP-001", "supplier_name": None,
            "site_id": HO, "invoice_date": SEP(26), "due_date": "2026-10-10",
            "subtotal_minor": 150_000, "tax_minor": 0, "discount_minor": 0, "kind": "EXPENSE",
            "withholding_code": "PPH23_SERVICE", "note": "Ongkos kirim PO-DEMO-001",
            "lines": [{"account_code": "6010", "site_id": HO, "amount_minor": 150_000,
                       "draws_reserve": False, "account_overridden": True,
                       "memo": "Ongkos angkut PO-DEMO-001 ke DC"}]})
        if cloud.get(f"/api/v1/finance/bills/{bill['invoice_id']}")["status"] in ("DRAFT", "MATCHED"):
            cloud.post(f"/api/v1/finance/bills/{bill['invoice_id']}/post", {})
        say(f"+ expense bill {number} SUP-001 Rp 150,000 (Dr 6010 / Cr 2004)")
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
            "unit_site_id": STORE, "amount_minor": 250_000, "effective_date": SEP(25),
            "memo": "Management fee store-01 September"})
        say(f"+ {out['entry_number']} management fee store-01 Rp 250,000 (LAIN 2030/1059)")


# ---------------------------------------------------------------------------
# GL: a prepaid with its schedule, an accrual


def prepaid_and_accrual(cloud, checker, ctx):
    memos = journal_memos(cloud)
    # Paid out of Giro BCA as a Kas Keluar straight into 1036 (prepaid
    # insurance): a schedule needs a posted document to hang from.
    doc = cash_doc(cloud, checker, 3, BANK, side("prepaid_expense", HO, "ASURANSI_BAYAR_DIMUKA"),
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
           [("6045", HO, 400_000, 0), ("2023", HO, 0, 400_000)])


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
    """PPh 23 kept back from SUP-001's freight payment (Rp 3,000, on 2012):
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
        "tax_type_code": "PPH23", "year": 2026, "month": 9, "site_id": HO,
        "kind": "OBLIGATION", "amount_minor": 3_000, "source_kind": "PAYMENT",
        "source_id": pay_row.get("payment_id") or pay_row.get("id"),
        "evidence": "Bukti potong PPh 23 ongkir SUP-001", "note": "2% x Rp 150.000"})
    say("+ PPh 23 September: obligation Rp 3,000 (ongkir SUP-001)")


def recurring_bill(cloud, ctx):
    if any(t.get("label") == "Ongkos angkut bulanan SUP-001" for t in rows(cloud.get("/api/v1/finance/bill-templates"))):
        return
    cloud.post("/api/v1/finance/bill-templates", {
        "supplier_id": "SUP-001", "supplier_name": None, "site_id": HO,
        "expense_account_code": "6010", "expense_category_code": None, "expense_site_id": HO,
        "expected_subtotal_minor": 150_000, "expected_tax_minor": 0, "tolerance_bps": 500,
        "due_day": 25, "label": "Ongkos angkut bulanan SUP-001",
        "note": "Tagihan ongkir rutin; draf dibuat otomatis tiap bulan", "contract_id": None})
    say("+ recurring bill template: ongkos angkut SUP-001 Rp 150,000 on the 25th "
        "(the hourly recurring-bills agent raises the draft)")


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
    two the bank made on its own (admin fee, interest), which are booked off the
    statement (Dr 6043 / Cr 1005 and Dr 1005 / Cr 8002 — two events, I11). The
    giro to SUP-002 (due 5 Oct) has not been presented, so it is not on it."""
    statements = rows(cloud.get("/api/v1/finance/bank-statements"))
    mine = [s for s in statements if s.get("account_code") == "1005" and s.get("site_id") == HO
            and str(s.get("period_start", "")).startswith("2026-09")]
    if not mine:
        ledger = cloud.get(f"/api/v1/finance/accounts/1005/ledger?site={HO}"
                           "&from=2026-09-01&to=2026-09-26&limit=500")
        lines = [{"value_date": r["posting_date"],
                  "description": (r.get("memo") or r["entry_number"])[:60],
                  "reference": r["entry_number"],
                  "debit_minor": r["credit_minor"], "credit_minor": r["debit_minor"]}
                 for r in rows(ledger)]
        lines += [
            {"value_date": SEP(26), "description": "BIAYA ADM REKENING", "reference": None,
             "debit_minor": 15_000, "credit_minor": 0},
            {"value_date": SEP(26), "description": "BUNGA JASA GIRO", "reference": None,
             "debit_minor": 0, "credit_minor": 8_500},
        ]
        closing = ledger["opening_minor"] + sum(l["credit_minor"] - l["debit_minor"] for l in lines)
        cloud.post("/api/v1/finance/bank-statements", {
            "account_code": "1005", "site_id": HO, "bank_account_id": bank_id,
            "period_start": SEP(1), "period_end": SEP(26),
            "opening_minor": ledger["opening_minor"], "closing_minor": closing,
            "source_name": "rekening-koran-BCA-8730123456-2026-09.csv", "lines": lines})
        say(f"+ bank statement Giro BCA 1–26 Sep: {len(lines)} lines, closing Rp {closing:,}")
        statements = rows(cloud.get("/api/v1/finance/bank-statements"))
        mine = [s for s in statements if s.get("account_code") == "1005" and s.get("site_id") == HO
                and str(s.get("period_start", "")).startswith("2026-09")]
    stmt = mine[0]
    sid = stmt.get("statement_id") or stmt.get("id")
    # Each line the books already have: confirm the match to its journal line.
    by_entry = {r["entry_number"]: r["line_id"] for r in rows(cloud.get(
        f"/api/v1/finance/accounts/1005/ledger?site={HO}&from=2026-09-01&to=2026-09-30&limit=500"))}
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
        elif line["description"] == "BUNGA JASA GIRO":
            cloud.post(f"/api/v1/finance/bank-lines/{line['line_id']}/book", {
                "account_code": "8002", "category_code": None,
                "memo": "Jasa giro BCA September", "party_name": "Bank BCA"})
            booked += 1
    if matched or booked:
        say(f"+ reconciliation: {matched} lines matched to the books, {booked} booked off the statement")


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
    prepaid_and_accrual(cloud, checker, ctx)
    petty_cash(cloud, checker, ctx)
    supplier_advance(cloud, ctx)
    employee_advance(cloud, checker, ctx)
    head_office_pays_the_shop(cloud, checker, ctx)
    payments(cloud, ctx)
    freight_bill(cloud, ctx)
    tax(cloud, ctx)
    recurring_bill(cloud, ctx)
    setup(cloud, ctx)
    bank_statement(cloud, ctx, bank_id)   # last: it mirrors every bank movement above
