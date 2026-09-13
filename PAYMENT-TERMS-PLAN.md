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

Keep `supplier_invoice.due_date` and maintain it as the earliest **unpaid**
instalment. Not a migration convenience: ERPNext's Purchase Invoice keeps a
single `due_date` **and** a `payment_schedule` table, permanently. One date
answers "when is this next due", which is what a list column and an ageing
bucket want; the table answers "what is owed when". Backfill every existing
bill with one instalment at 100% carrying its current `due_date`.

**Our status enum has no payment state.** `supplier_invoice.status` is
`DRAFT | MATCHED | POSTED | REJECTED | VOID` — where the document is in its
workflow, and nothing about money. ERPNext's carries `Paid`, `Partly Paid`,
`Unpaid` and `Overdue` beside the workflow states, and `outstanding_amount` is
a stored read-only figure on the invoice. Instalments make *partly paid* the
ordinary case, so this piece of work has to answer it — either a second status
column or a derived outstanding the list can sort on. Do not overload the
existing enum: `POSTED` means the ledger has it, which is true whether or not a
rupiah has moved.

### 3. A payment settles an instalment

`supplier_payment_allocation` gains `term_seq`. Nullable at first — every
existing row means "the whole bill" — then required once the payment screen
offers instalments.

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

**The method belongs on the instalment, not on the order.** ERPNext puts
`mode_of_payment` on the Payment Term and on each Payment Schedule row, and has
no payment-mode field on the Purchase Order at all. It is right: an advance by
transfer and the balance by giro is one ordinary order that a single header
field cannot express. The composer currently draws one method for the whole
order — that control moves into the schedule table.

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

**A giro's own date — take it, as one column.** A bilyet giro cannot be cashed
before its effective date, so the money leaves the bank then and not on the day
the paper changed hands. Add a nullable `instrument_date` to
`supplier_payment`, filled only for `GIRO` and `CHEQUE`. This is what lets bank
reconciliation (0071, 0106) tell an uncleared giro from a discrepancy — the
thing 0084's own comment says a reconciler needs.

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

## Nothing is open

Every question this plan raised has an answer. What remains is the work.
