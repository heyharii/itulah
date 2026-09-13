# Payment terms, and where they belong

Written 2026-09-13, after the PO composer grew a payment-terms block that Create
throws away. Reference read: `frappe/erpnext` at `develop`.

## The reframe

Storing payment terms on the purchase order is not, by itself, a Finance
feature. It produces a number nobody can act on.

The Finance fact underneath is this: **a bill falls due in instalments, not
once.** Today it falls due once, and three places depend on that:

| Where | What it does with `supplier_invoice.due_date` |
| --- | --- |
| `postgres/payables.rs:347` | `CURRENT_DATE - i.due_date` — the whole ageing column |
| `postgres/ledger.rs:199` | `WHERE i.status <> 'POSTED' AND i.due_date < CURRENT_DATE` — what is overdue |
| `postgres/payments.rs:287` | orders the bills a payment may settle, `due_date NULLS LAST` |

A bill 40% paid whose second instalment falls next month reads, in all three,
as wholly overdue. Put a schedule on the order and nothing about that changes.

ERPNext reached the same conclusion and says it structurally: the authoritative
schedule lives on the **invoice**. The order's schedule is a carrier, and
`fetch_payment_terms_from_order()` recomputes it against the invoice's own
posting date and grand total. We should split it the same way, and for the same
reason — a PO raised today whose bill arrives in six weeks must not carry due
dates counted from today.

## What exists today

`purchase_order` (0018) has fourteen columns. None is a payment term; no
migration in the repo mentions one. What Finance already has:

- `supplier_invoice` (0052) — one nullable `due_date`, `supplier_invoice_line.po_line_id` back to the order
- `supplier_payment` (0084) — method `TRANSFER | CASH | CHEQUE | GIRO | OTHER`, the pot as `account_key` + `account_qualifier`
- `supplier_payment_allocation` (0084) — `(payment_id, invoice_id, amount_minor)`, allocated to the **bill**, not to an instalment
- `account_map` (0050) — `semantic_key + site + qualifier → account_code`, the only way this system names an account

`supplier` has a name, a contact, a phone, an email and an address. No bank
account.

## The plan, in the order it has to happen

### 1. Payment terms become master data

A `payment_term` master beside divisions, sizes and tags (0091), and a
`payment_terms_template` with its lines. Follow the master lifecycle of 0167:
`retired_at` plus `ever_used`, never a delete.

The term carries an **offset and a basis**, not a day count:

| basis | means |
| --- | --- |
| `DAYS_AFTER_BILL` | n days after the bill's date |
| `DAYS_AFTER_BILL_MONTH_END` | n days after the last day of the bill's month |
| `MONTHS_AFTER_BILL_MONTH_END` | n months after the last day of the bill's month |

These are ERPNext's three, and they are three because "net 30 from end of
month" is ordinary in Indonesian trade and cannot be written as days-from-order.

**The supplier carries the default.** `Supplier.payment_terms` in ERPNext is a
link to a template, and it is what stops a buyer choosing terms afresh on every
order — the terms are a standing arrangement with that supplier, not a decision
per document. The first draft of this plan missed it. Add
`supplier.payment_terms_template_code`; the composer seeds from it and the
buyer overrides when the phone call says otherwise.

### 2. The bill owes in instalments

`supplier_invoice_payment_term (invoice_id, seq, label, due_date, portion_bps,
amount_minor)`.

Two invariants, as a **deferred** constraint trigger on both tables — copy the
shape of `assert_payment_allocated()` in 0084, including `RAISE … P0001` so
`AppError::into_response` turns it into a 409 somebody can read:

- `SUM(portion_bps) = 10000`
- `SUM(amount_minor) = supplier_invoice.total_minor`

ERPNext validates the same sum to a 0.1 tolerance and **fails** rather than
adjusting the last row. In minor units we have no tolerance to spend, so the
writer must balance it; the composer already refuses a schedule that is not
100%.

Keep a single date on the header beside the table — ERPNext's Purchase Invoice
does, permanently — but **name it `next_due_date` and diverge on what it
means.** ERPNext sets `due_date = max(payment_schedule.due_date)`:

```python
def set_due_date(self) -> None:
    due_dates = [d.due_date for d in self.doc.get("payment_schedule") if d.due_date]
    if due_dates:
        self.doc.due_date = max(due_dates)
```

That answers "when is this bill finally settled". The operational question in
an AP office is the other one — *what must I pay next* — so this system holds
the **earliest unpaid** instalment instead. On a bill of Rp 100.000.000 with
40% paid on 15 Sep and 30% each on 15 Oct and 15 Nov, ERPNext says 15 Nov and
we say 15 Oct.

Do not keep calling it `due_date`. A column whose name matches ERPNext's and
whose meaning does not is a trap for whoever reads both. `next_due_date`, with
`outstanding_minor` beside it, both derived. Backfill every existing bill with
one instalment at 100% carrying its current `due_date`.

**Our status enum has no payment state.** `supplier_invoice.status` is
`DRAFT | MATCHED | POSTED | REJECTED | VOID` — where the document is in its
workflow, and nothing about money. `POSTED` means the ledger has it, which is
true whether or not a rupiah has moved, so it must not be overloaded.

ERPNext puts `Paid`, `Partly Paid`, `Unpaid` and `Overdue` in one Select beside
the workflow states. **Split what ERPNext merges**: a bill can be partly paid
*and* overdue at once, and one enum cannot say both.

```
status        DRAFT | MATCHED | POSTED | REJECTED | VOID   (the document)
payment_state UNPAID | PARTIALLY_PAID | PAID              (derived)
overdue       boolean                                      (derived)
```

### 3. A payment settles an instalment

`supplier_payment_allocation` points at the instalment by a **stable id**, not
by its position:

```
supplier_invoice_payment_term (invoice_payment_term_id PK, invoice_id, seq, …)
supplier_payment_allocation   (payment_id, invoice_payment_term_id FK, amount_minor)
```

`seq` is presentation and ordering only. A payment must not name "the second
row": correct a two-line schedule into three and every old allocation pointing
at `2` now settles something else, silently. That is true even if a posted
bill's schedule is frozen — an amendment or a correction is exactly when the
audit trail matters most.

Nullable at first — every existing row means "the whole bill" — then required
once the payment screen offers instalments.

Verified against ERPNext rather than assumed: `Payment Entry Reference` carries
`payment_term` (Link → Payment Term) beside `payment_term_outstanding`,
`outstanding_amount` and `allocated_amount`. An allocation there names the
instalment, exactly as proposed here.

This is the step that makes *overdue* true. Without it, instalments are
decoration.

### 4. The order carries the agreement

On `purchase_order`: `payment_terms_template_code`, `terms_conditions`. ERPNext
holds exactly these — `payment_terms_template`, `tc_name` and `terms` — and
nothing else about payment on the order header.

`purchase_order_payment_term (purchase_order_id, seq, label, basis, offset,
portion_bps, due_date, method)` — both the basis and the date, which is exactly
what ERPNext's Payment Schedule child table holds. The date is what was agreed
and what the buyer may edit; the basis is what the bill recomputes from when it
arrives. A term with a basis recomputes; a term with only a date carries.

**The PLANNED method belongs on the instalment; the ACTUAL one stays on the
payment.** ERPNext puts `mode_of_payment` on the Payment Term and on each
Payment Schedule row, and has no payment-mode field on the Purchase Order — but
it also keeps `mode_of_payment` on the Payment Entry itself, and both layers
are needed. What was agreed and what happened are different facts, and the
second is the one an auditor reads.

Our `supplier_payment.method` (`TRANSFER | CASH | CHEQUE | GIRO | OTHER`, 0084)
already is the actual layer and does not move. What moves off the composer's
header and into the schedule row is the **plan** — because "advance by
transfer, the balance by giro" is one ordinary order that a single header field
cannot express, and because an order may well end up paid by something else.

### 5. Pay into — on the payment, not on the order

`supplier_bank_account (supplier_id, bank, account_no, account_name,
is_default)` — ERPNext's Bank Account with `party_type = Supplier`, narrowed to
what an Indonesian transfer needs.

**Referenced by `supplier_payment`, not by `purchase_order`.** ERPNext has no
supplier bank account on the Purchase Order; it sits on the Payment Entry as
`party_bank_account`, beside `bank_account` for the company's own side. That is
the honest place: which account the money actually went into is a fact of the
payment, not a promise of the order. Our `supplier_payment` already records the
pot it left from; this records where it landed.

ERPNext also hangs a default off the party: `Supplier.default_bank_account`
links to one Bank Account. The `is_default` flag proposed above reaches the
same answer from the other side; either is fine, but the default has to exist
or a payment clerk retypes the account on every transfer.

**Not an `account_map` key.** `account_map` names *our* accounts — which pot
the money left. A supplier's account is the counterparty's and belongs to the
supplier master. Confusing the two would put the client's chart of accounts in
a document table, which is the thing 0084's comment warns about at length.

## Where this diverges from ERPNext, and why

Three of the five steps match ERPNext structurally. Two did not, and on both
counts ERPNext was right and the screens already built are wrong:

| | This plan, first draft | ERPNext | Settled |
| --- | --- | --- | --- |
| Payment method | one per order, on the header | `mode_of_payment` per schedule row; **no** field on the PO | per instalment |
| Pay into | on the order | `party_bank_account` on the Payment Entry; **no** field on the PO | on the payment |

A second pass against the source found two more things the first draft had
simply left out, both now folded into the steps above:

- `Supplier.payment_terms` — the standing arrangement with a supplier, which
  seeds every order raised against them.
- A **payment state** on the bill. ERPNext's invoice status carries `Paid`,
  `Partly Paid`, `Unpaid` and `Overdue`; ours carries none of them, and
  instalments make *partly paid* the ordinary case.

And two things ERPNext has that this plan deliberately does not take yet:

- `advance_paid` / `advance_payment_status` on the Purchase Order. Worth having
  once step 3 lands — the default template here is "40% advance", and a buyer
  chasing one should not have to open the bill to see whether it went.
- `Supplier.on_hold` with `hold_type` (`All | Invoices | Payments`) and
  `release_date`. A real AP control and a neighbour of this work, but not part
  of it: blocking a supplier is a credit decision, not a payment term.

## Traps, all verified in this repo

1. **Next free migration is 0193.** Do not renumber; renumbering has killed dev
   databases here before.
2. **`contract_types.rs` must NAME the type.** A `ts-rs` derive alone is not
   enough — an unnamed type is silently not emitted, and the frontend compiles
   against a stale contract.
3. **`postgres::*` is one namespace.** Generic function names collide across
   modules and the error misleads. Name it `supplier_invoice_terms`, never
   `terms`.
4. **Push to `main` is live on Render.**
5. **`feat/finance-control` is unmerged and collides with 0106.** Resolve that
   before adding 0193 and up.
6. **There is no GRNI in this ledger.** The bill posts straight through, so
   payment terms change *timing* only and never a posting rule. Do not invent a
   GRNI account to hold instalments.

## Answered by the owner, 2026-09-13

**Payment method — off the order header, onto the instalment.** ERPNext has no
payment-mode field on the Purchase Order and puts `mode_of_payment` on each
Payment Schedule row. Agreed: the composer's header control moves into the
schedule table as an optional column (blank = not agreed yet). "40% advance by
transfer, the balance by giro" is an ordinary arrangement one header field
cannot state. `purchase_order` then carries the template and the conditions
only — exactly `payment_terms_template` + `tc_name`/`terms`.

**PPh 23 — deferred, and safely.** 0084 already anticipates it: "when one of
them is needed it is a new column, a semantic key and one more line in the
posting rule, with nothing below undone." Nothing in this plan forecloses it.

**A giro's own date — NOT settled by one column. Reopened.** The first answer
here was "take it, as one column", and that was wrong: it fixes the date and
leaves the ledger saying something untrue.

Verified in `postgres/payments.rs`. Posting a payment writes `Dr trade_payable`
or `non_merchandise_payable` per allocation, and one credit line against
`supplier_payment.account_key` for the total. For a giro that key is
`bank_giro` — the current account. So **the books show the money leaving the
bank on the day the paper changed hands**, which is precisely what a bilyet
giro does not do: it cannot be cashed before its effective date.

An `instrument_date` column records when it clears and changes none of that.
What is actually needed is a lifecycle and a posting rule:

```
ISSUED → OUTSTANDING → CLEARED

on issue   Dr trade_payable      Cr giro_outstanding
on clear   Dr giro_outstanding   Cr bank_giro
```

`giro_outstanding` would be a new semantic key in `account_map`, and the
client's chart has to have an account for it — a liability, not a bank
account. The alternative policy is that a payable is not settled until the
giro clears, which posts nothing on issue and everything on clearing; that is a
different answer and the owner has to pick one, because it changes what the AP
ageing says for every giro in flight.

Until it is decided, `GIRO` is honest only for same-day paper. **Blocked on the
owner**; see below.

**One bill spanning two orders — refuse it, do not model it.** The owner
reports it does not happen. But `supplier_invoice_line.po_line_id` permits it
and nothing checks, so a bill built that way would silently inherit one of two
schedules. Reject a bill whose lines reach more than one purchase order, with a
sentence saying why. The danger is not the case; it is the system choosing a
schedule and nobody knowing which.

**Early-payment discount — not taken.** The owner reports no supplier here
offers a reduction for settling sooner, so ERPNext's `discount_type`,
`discount` and `discount_validity` are not carried across. Four columns on the
term, four on the schedule row and a posting rule for the discount taken are
all dropped. The order-level discount already in `purchase_order` stays what it
is: a price agreed up front, unaffected by when the bill is paid.

If that ever changes it reopens cleanly — it is a property of the term, and a
term is master data by step 1.

## Open

**How a giro is posted.** Two candidate policies, above. One puts a
`giro_outstanding` liability between the payable and the bank; the other treats
the payable as unsettled until the giro clears. Both need an account in the
client's chart and a line in the posting rule, and the choice changes every AP
ageing figure that has a giro in it. Nothing in steps 1 to 5 depends on the
answer, so this is not a blocker for them — but shipping instalments while
`GIRO` still credits the bank on issue means the schedule is right and the
ledger is not.

Everything else this plan raised has an answer. What remains is the work.
