# A cheque in ERPNext, and what it decides for our giro

Written 2026-09-13. Reference read: `frappe/erpnext` at `develop`, commit
`fe25746` (13 Sep 2026); the docs pages *Post Dated Cheque Entry* and *Stale
Cheque Accounting* on `docs.frappe.io/erpnext`; and the twelve years of issues
behind both. Line numbers below are that commit.

## The headline

**ERPNext has no post-dated cheque feature.** One doctype has "cheque" in its
name — `Cheque Print Template` — and it is a page-layout for a printer. There
is no cheque table, no cheque state, no clearing account field, no bounce, no
stale-cheque act, no register of paper in hand.

A cheque in ERPNext is **two fields on a voucher, one date set by a tool, and a
report that reads the three together**. Everything the manual calls a "post-dated
cheque workflow" is those parts arranged by hand.

That is the finding. The rest of this document is what the parts actually do,
because several of them are worth taking and two of them are traps.

## The parts

| Where | Fields | Rule |
| --- | --- | --- |
| Payment Entry | `reference_no`, `reference_date`, labelled *Cheque/Reference No* and *Cheque/Reference Date* | Both mandatory when either leg is a `Bank` account — client-side by `mandatory_depends_on`, server-side `payment_entry.py:1246` |
| Journal Entry | `cheque_no`, `cheque_date`, labelled *Reference Number* / *Reference Date* | Both mandatory when `voucher_type == "Bank Entry"`; and a date without a number is refused outright (`journal_entry.py:520`) |
| Both, plus Purchase Invoice and Sales Invoice Payment | `clearance_date` | `read_only`. Never typed. Set by one of two tools, and by nothing else |
| Sales Invoice Payment (POS) | `reference_no` + `clearance_date` | A cheque taken at the till is reconcilable like any other |
| Purchase Invoice | `is_paid` + `cash_bank_account` + `clearance_date` | Its `bill_no` is shown in the cheque-number column of both clearance reports |
| Bank Transaction (statement line) | `reference_number` | The other half of every match |
| Mode of Payment | seeded `Cheque` (`Check` in the US), type `Bank` | `install_fixtures.py:263`. A label, not a behaviour |

`clearance_date` is scrubbed in two places that matter: Journal Entry blanks it
on every validate (`journal_entry.py:156`), and amending any voucher blanks it
on the document and on its payment rows (`accounts_controller.py:121`) — so an
amendment cannot inherit "the bank took it".

## What the cheque date does, and does not do

**Does not:** move the ledger. Posting date is the accounting date; the cheque
date posts nothing, ever. The manual says this three times in three different
words, which is a fair sign of how often it is asked.

**Does:**

1. **Gates clearance.** `clearance_date < cheque_date` is refused row by row in
   the Bank Clearance tool — *"Clearance date must be after cheque date"*
   (`bank_clearance.py:99`, `:126`). This is the only rule in the whole system
   that connects the paper's date to anything.
2. **Can drive matching.** The reconciliation tool has `filter_by_reference_date`:
   it swaps the posting-date window for a cheque-date window when looking for
   candidates. That is the post-dated case, quietly.
3. **Decides an early-payment discount.** `apply_early_payment_discount()`
   compares `reference_date <= term.discount_date` (`payment_entry.py:3098`).
   The *cheque* date, not the posting date, decides whether the discount holds —
   and the UI prompts for it by name when you create a payment from an invoice
   that has one (`transaction.js:2898`). A trap worth knowing before copying the
   field.
4. **Is the label on a future payment.** In the AR/AP report, a Journal Entry's
   `cheque_no` is what shows in the *Future Ref* column
   (`accounts_receivable.py:710`).

**Nothing enforces `clearance_date >= posting_date`.** A cheque can be recorded
as cleared before it was written. ERPNext's answer is not a constraint but a
report — *Cheques and Deposits incorrectly cleared*, added 2024 — which lists
vouchers whose posting date is after the report date while the clearance date is
before it. That is a repair tool for a hole they chose to leave open.

## The two tools that set a clearance date

| | Bank Clearance | Bank Reconciliation Tool |
| --- | --- | --- |
| Shape | Pick an account and a date range, pull a grid, type dates, press Update | Pull statement lines, match each to a voucher |
| Sources | Payment Entry, Journal Entry, paid Purchase Invoice, POS Sales Invoice Payment | The four in `bank_reconciliation_doctypes` (`hooks.py:585`) plus Bank Transaction |
| Date set | Whatever the clerk typed | The statement line's own date, `max()`-ed with any earlier allocation (`bank_transaction.py:421`) |
| Validation | Not before the cheque date; a row with no payment document is refused | The voucher must actually touch that bank account; over-allocation throws |
| Audit | A comment on each voucher: *"Clearance date changed from X to Y via Bank Clearance Tool"* | The Bank Transaction holds the link; unreconciling sets `clearance_date` back to `NULL` (`bank_transaction.py:256`) |
| Partial | No concept | Clears only when every bank GL line of the voucher is allocated |

Matching ranks candidates by `+1` for an exact reference number, `+1` for an
exact amount, `+1` for the party. **Auto-reconcile insists on the reference
number**: `je.cheque_no == transaction.reference_number` is a hard filter when
the flag is on, not a rank. A cheque number is the thing that makes automatic
matching safe, which is the argument for storing it as a key rather than in a
free-text note.

And the definition that the whole month-end rests on — *Bank Reconciliation
Statement*, which lists a voucher as outstanding when
`posting_date <= report_date AND (clearance_date IS NULL OR clearance_date >
report_date)` (`bank_reconciliation_statement.py:162`, `:197`). "Cheques in
transit" is not a state anybody sets. It is the absence of a clearance date.

## What the manual actually tells you to do with a post-dated cheque

Two routes, and the page gives both without saying they are different systems.

**Route 1 — post-date the voucher.** Put the cheque's date in the *posting
date*. The ledger moves on the day the cheque matures, and until then the AR/AP
report's **Show Future Payments** shows it: `posting_date > report_date` pulled
from Payment Entries and Journal Entries into *Future Ref / Future Date / Future
Amount / Remaining Balance* columns (`accounts_receivable.py:657`). This is
ERPNext's actual PDC register, and it is a report, not a table. Two traps in it:
it takes `docstatus < 2`, so **drafts count as future payments**; and the row
stops being "future" the moment the report date passes the cheque date, even if
the bank never took it — the precise complaint that kept issue #6785 open for a
decade.

**Route 2 — a clearing account, by hand.** The page says to "use the configured
post-dated check or clearing account when required" and then transfer to the
bank after clearance. There is no such configuration. No field names a clearing
account; nothing moves the balance when the clearance date is set. The only
trace of this route in the codebase is two account names in the UAE chart of
accounts template — *Post Dated Cheques Received* (`account_type: Receivable`)
and *Post Dated Cheques Paid* (`account_type: Payable`). The workflow is: you
make the journal entries yourself, twice.

## Bounce, and stale

Nothing. `dishonour`, `bounce`, `returned cheque` appear nowhere in
`erpnext/accounts` or `erpnext/controllers`. The *Stale Cheque Accounting* page
prescribes cancelling the payment, or writing a reversing Journal Entry when the
period is closed, then recording a replacement — and warns that the invoice only
reopens if you unallocate properly. It is a procedure, not a feature.

This was a deliberate choice once: PR #12961 (2018) implemented PDC management
with returned/redeposited cheques inside Bank Reconciliation and was closed with
*"Explicit is better than implicit"* in favour of tracking a return as its own
Journal Entry.

## Printing

`Cheque Print Template` generates a Jinja **Print Format bound to Payment
Entry** — absolute positions in centimetres for the crossing text ("Acc. Payee"),
date, payee, amount in words, amount in figures, account number and signatory,
with `Regular` and `A4` sizes and an optional scan of the cheque as a backdrop.
It reads `reference_date` for the date. Journal Entry cannot use it. Since
#55708 (Jun 2026) generating it requires System Manager.

Not relevant to us — a bilyet giro is written by hand on the bank's own booklet —
but it is the reason ERPNext put the cheque number on the *Payment* Entry rather
than on a bank document, and that placement is the one we inherited.

## The community history, because it is the argument

| When | What | Outcome |
| --- | --- | --- |
| 2014 | #2470 *Post Dated Cheques* | Closed |
| 2016 | #6785 *Weakness in Managing PDC* — Middle East trade runs on 30–90 day cheques; no way to see what is in hand | Open for **ten years** |
| 2016 | #6946 *PDC Management — Full Feature [Bounty]* — deposit date, deposited-to bank, returned/redeposited columns, a PDC register, PDC balances on the customer dashboard | Closed 2021, unimplemented |
| 2018 | PR #12961, a working implementation | Rejected on design |
| Jun 2026 | A Frappe engineer proposes, on #6785: three dated events — `Dr Cheques in Hand / Cr Debtors` on receipt, `Dr Bank / Cr Cheques in Hand` on clearance, `Dr Debtors / Cr Cheques in Hand` on bounce — with *Cheques in Hand* an asset **outside the Cash/Bank group**, the maturity date a gate that posts nothing, and bounce a dated reversal that reopens the invoice | Not implemented |
| Aug 2026 | #6785 closed: *"Addressed by the existing PDC and future-payment functionality"* — post-date the voucher, use Show Future Payments, use Bank Clearance | The shipped answer |

So ERPNext ships Route 1 and its own engineers keep re-deriving Route 2. Ten
years of that is data about which one survives contact with a business that
lives on paper.

## What this decides for us

Our open question is the same fork, already written down in
`PAYMENT-TERMS-PLAN.md` ("A giro's own date — NOT settled by one column.
Reopened.", and the *Open* section): does a giro post a liability on issue and
the bank on clearing, or does it post nothing until it clears?

Three facts make this less open than it reads:

- **The account exists.** `giro_outstanding` → `2012002* Outstanding Giro` is
  already a semantic key (`ledger.rs:375`), already in the client's chart, and
  `statements.rs:689` already classes it bank-side so a giro in flight
  subtracts on the reconciliation screen. Nothing posts to it. The gap is a
  posting rule, not a chart.
- **The neighbouring lane has built it.** Worktree `agent-acbfe1baaf49ed6c2`
  carries `0117 A giro is a promise before it is money` and `0119 A payment by
  giro remembers which piece of paper it was`: five states
  (`ISSUED → DELIVERED → DUE → CLEARED | REJECTED`), `Dr payable / Cr
  giro_outstanding` on issue, `Dr giro_outstanding / Cr bank_giro` on clearing
  driven by a statement line (`cleared_line_id`), and a `REVERSED` payment
  status so a bounced giro gives the bill back. That is the June 2026 proposal,
  built, with the state ladder ERPNext never got.
- **A bilyet giro is not a cheque.** It is a transfer order that cannot be
  cashed before its effective date. Route 1 — post-date the voucher — is closer
  to legally true for a giro than for a cheque, but it still says the bill is
  unpaid while the supplier holds our paper, and it still leaves "what is in
  flight" as a report over vouchers rather than a balance anyone can agree with
  the bank.

**Recommendation: policy A, the clearing account** — which is what the lane
built. It keeps the bank balance reconcilable against a statement that has never
heard of the paper, it gives "giro in flight" a number on the balance sheet
rather than in a report, and it is the only version in which a bounce has
somewhere to go.

Take these from ERPNext regardless of the policy:

1. **Number and date on the payment**, mandatory together, never half. 0119 does
   this (`supplier_payment_giro_is_whole`) and is stricter than ERPNext, which
   only refuses a date without a number.
2. **Clearance is never typed on the document.** It is set by the act of
   matching a statement line, and unmatching sets it back to null. Our 0106
   statement intake is already that tool; the giro clearing is its natural
   consumer.
3. **The invariant ERPNext does enforce** — cleared not before the instrument's
   date — and **the one it does not**: cleared before the voucher was posted.
   They wrote a report for the second. We can afford a constraint.
4. **Exact reference number as the auto-match key.** It is what makes automatic
   reconciliation safe for paper, and it is why the giro number belongs in its
   own column rather than in `reference` free text — which 0119 argues in the
   same words.

Leave: Cheque Print Template, Bank Guarantee, Invoice Discounting (until
somebody discounts a giro), and Show Future Payments' semantics, which drop a
cheque from view on its maturity date whether or not the bank took it.

## Open

**What `CHEQUE` does.** `supplier_payment.method` has five values and the lane's
work gives the clearing-account treatment to `GIRO` only — `payments.rs:535`
switches the credit key on `method == "GIRO"`. A cek is payable on demand, so
crediting the bank on issue is defensible; a post-dated cek is not unheard of
here, and it would post exactly the lie 0117 was written to stop. Either say in
writing that `CHEQUE` means same-day paper, or give it the same ladder.

**The receivable side.** Everything above is about paying suppliers — ours by
construction, and the Frappe engineer's proposal as its mirror image ("Only on
the receivable side", its last line). A customer handing the store a post-dated cheque or a
giro has no path at all in our system today, and the till's five tenders do not
include one.
