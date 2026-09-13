# Paying by giro, in ERPNext's shape

Written 2026-09-13. This closes the *Open* left by `PAYMENT-TERMS-PLAN.md`
("How a giro is posted"). Reference read: `frappe/erpnext` at `develop`
`fe25746` — the detail is in `CHEQUE-RESEARCH.md`; and the client's own chart,
`Laporan_Master_Account1.csv`, 7,538 rows.

## The decision, in one line

**Take ERPNext's shape whole; let the posting follow the client's chart.**

Shape means: the instrument lives on the payment, print reads the payment,
clearance arrives from the bank statement, and the register is a list. Posting
means: a giro is a liability between the payable and the bank, because that is
what the client's accountant already built an account for.

## What the chart already settled

Searched for `cek`, `cheque`, `check`, `bilyet`, `warkat`, `kliring`, `wesel`,
`titipan`, `tolakan`, `mundur`, `post dated`. **Zero hits.** The client does not
pay by cheque. What exists is giro, and the word carries two meanings:

| Code | Name | What it actually is |
| --- | --- | --- |
| `1011002` | CASH IN BANK GIRO | the **current account** at each bank — 5 banks × 14 units. This is `bank_giro` |
| `2012002` | OUTSTANDING GIRO | **bilyet giro issued, not yet cleared** — under HUTANG DAGANG, 5 banks × 14 units. This is `giro_outstanding` |
| `204001` | Giro Keluar | a flat account with no per-unit children, one of the two "skipped rung" accounts already noted in `0050_ledger.sql:37`. **Ignore it** |

`giro_outstanding` has been in `required_semantic_keys` since the ledger's first
day (`ledger.rs:375`) and nothing has ever written to it. The gap is a posting
rule, not a chart.

And the instrument decides the posting: a bilyet giro is a *perintah
pemindahbukuan* with a **tanggal efektif** and cannot be cashed before it
(PBI 18/41/PBI/2016). Crediting the bank when the paper changes hands would
state something the bank will not do for another thirty to ninety days.

## The shape, copied

| ERPNext | Ours |
| --- | --- |
| Cheque is two fields on Payment Entry — `reference_no`, `reference_date` | `supplier_payment.giro_number`, `giro_due_date` (0119), mandatory together |
| No cheque doctype; nothing for a user to create | No giro document a user types. The `giro` row is written when the payment **posts** (0117) |
| `clearance_date` read-only, set only by Bank Clearance or the reconciliation tool | Clearance comes from a matched statement line (0106). Never typed |
| Cheque Print Template reads the Payment Entry and posts nothing | Giro print reads the payment and posts nothing |
| Register is the Bank Clearance Summary report over vouchers | Register is a list over payments + giro state |

## Where we differ, and why

1. **Clearance posts.** In ERPNext `clearance_date` is metadata — setting it
   moves no money, because the bank leg was already booked at issue. For us it
   is the second half of the entry: `Dr giro_outstanding / Cr bank_giro`, dated
   by the statement line. That single difference is why the register cannot be
   only `WHERE method = 'GIRO'`: a rejection, a replacement and an expiry are
   states with postings behind them, and a frozen payment row has nowhere to put
   them.
2. **The method drives the fields.** In ERPNext the cheque fields are mandatory
   because the account is of type Bank — `mode_of_payment` is only a label
   (`payment_entry.py:1246`). Ours keys on `method = 'GIRO'`, which is the
   stricter and more honest rule, and 0119 already enforces the pairing.
3. **What gets printed.** A cheque names a payee; a bilyet giro is an order to
   move money **into a named account**, so the print needs the payee's bank and
   account number and the *tanggal efektif*. Note also that ERPNext's own
   template prints `{{ doc.account_no }}`, and Payment Entry has no such field —
   it is `bank_account_no`. **Their cheque prints the account number blank.**
   Copy the idea (variable fields at measured centimetre offsets onto the bank's
   own paper), not the template.

## Supplier bank account — how ERPNext models it

One doctype, `Bank Account`, holds both sides:

- `is_company_account` splits ours from theirs. A company account requires a
  `company` and a GL `account`, and that GL account may not be claimed twice.
- A party account is `party_type` + `party` (dynamic link) — so a supplier's
  accounts are not columns on Supplier; they are rows pointing at it.
- `is_default` is de-duplicated on write: saving a default clears the flag on
  every other account of the same party. `get_party_bank_account()` returns the
  one that is default **and not disabled**.
- Data: `account_name`, `bank` (a master with unique name + SWIFT),
  `bank_account_no`, `iban`, `branch_code`, `disabled`. Autoname is
  `"<account name> - <bank>"`.
- **`Supplier.default_bank_account` means *our* bank account to pay them from**,
  not theirs. Their account reaches a Payment Entry as `party_bank_account`.

Ours, minimum viable, and none of it exotic: a `supplier_bank_account` table —
`supplier_id`, `bank_name` (free text for now; it is printed, not matched),
`account_no`, `account_holder`, `is_default`, and the master lifecycle of 0167
(`retired_at`, never a delete). Three rules worth copying verbatim: exactly one
default per supplier enforced at write, a retired account never disappears from
old payments, and **the account holder is its own field** — a bilyet giro names
the holder, which is not always the supplier's trading name.

Not copied: IBAN, SWIFT, `Bank` as a doctype, and the company side — our own
bank accounts are already `account_map` semantic key + qualifier, and adding a
second way to name them would put a copy of the map in a table.

## The plan, in order

| # | Step | State |
| --- | --- | --- |
| 0 | Merge the giro lane: `0117` (five states + `REVERSED` payment), `0119` (number + due date), `domain/giro.rs` | **built**, unmerged |
| 1 | Map `giro_outstanding → 2012002*` with bank qualifier + site | new, small |
| 2 | Payment: `method = GIRO` requires number + effective date; posts `Dr payable / Cr giro_outstanding` | in 0117/0119 |
| 3 | Clearing from a matched statement line (0106 → 0213): posts `Dr giro_outstanding / Cr bank_giro` on the line's date. Two invariants — not before the effective date (ERPNext enforces this one), not before the issue date (ERPNext does **not**; they wrote a clean-up report instead) | new |
| 4 | Reject and replace: reverse the issue entry, reopen the bill, new paper keeps the debt | in 0117 |
| 5 | **Expiry** — a giro unpresented past its 70-day window dies as an instrument while the debt lives. Missing from the ladder | new |
| 6 | `supplier_bank_account` (table + master screen), per the shape above | **done** — `0221`, three routes, and a Bank tab on the supplier sheet |
| 7 | Print: per-bank template, millimetre offsets, `terbilang()`, a calibration proof | **in flight** — `0222`, `giro_print.rs`, and a Finance → Setup → Giro printing screen |
| 8 | Giro register in Banking: list by state, ageing to the effective date, **Reject** and **Replace** | new |

1–5 are the ledger and can start now; 6 is the prerequisite for 7; 8 is UI over
what 1–5 produce.

### What landed on 2026-09-13

- **`0220`** — `method` narrowed to four. Proved on a scratch database: the
  CHEQUE row became OTHER, only the method CHECK was dropped (the `account_key`
  and `status` ones stand), and CHEQUE is now refused by name.
- **`0221`** — `supplier_bank_account`. Proved the same way: `123-456-789` and
  `123456789` are one account, a second live default is refused, retiring the
  first frees the slot, and a letter in the digits column is refused.
- **Step 6, whole.** `postgres/supplier_banks.rs` and `http/supplier_banks.rs`;
  three routes nested under the supplier so the activity log files every write
  against it without a line in `DECLARED_BY_HANDLER` — `routes.json` shows
  `supplier` in the record column for both writes, `Supervisor` for all three.
  The screen is a fourth tab on the supplier sheet, beside Catalogue and
  Orders: the list with default first, *Make default* / *Retire* / *Restore* as
  one PATCH carrying the row's own version, and a four-field add form whose
  button refuses fewer than five digits before the request goes.
  `cargo check --lib` clean with and without `ts`; `route_catalog` green;
  `tsc -b` clean for these files.
- **Step 0 is blocked, and not by code.** The giro lane's branch is nine commits
  ahead of this one over 41 files, and eight of those files are uncommitted here
  — `payments.rs`, `banking.rs`, `statements.rs`, `bank_match.rs`, two `mod.rs`,
  `contract_types.rs`, `frontend-contract/src/index.ts`. A merge would have to
  either refuse or bury whatever those edits are. They belong to whoever is
  working in this checkout, so the merge is theirs to sequence, not this lane's.
- **Step 7's shape.** `0222` holds coordinates, not a document: one
  `giro_print_template` per bank and nine `giro_print_field` rows, because a
  bilyet giro is the bank's own paper and printing means landing nine facts on
  boxes that are already there. Millimetres rather than ERPNext's centimetres —
  calibration happens in the last two millimetres — and the payee's bank and
  account number are printed, which a cheque template has no reason to carry.
  `double precision` is used here and nowhere else in the schema: a millimetre
  offset is a measurement, never summed.
- **A latent bug the compiler could not see.** `supplier_bank_account.version`
  was `bigint` while Rust read `i32`. Nothing in this estate uses `query!`, so
  column types are only met at runtime — the first read would have failed with
  "Rust type i32 is not compatible with SQL type INT8". It surfaced only because
  the giro template made the same mistake somewhere the compiler DOES look
  (`versioned_response` takes an `i32`). Both are `integer` now, which is what
  colour, voucher, division and payment_term already use.
- Migration numbering is a live race today: `0213` was claimed twice within the
  hour and the loser renumbered to `0215` while this file was being written.
  `0171`-`0172` is an unclaimed gap that belongs to the promotions lane —
  `migration_hygiene` will name it until they write it down.

## Open

~~**`CHEQUE` as a method.**~~ **Decided 2026-09-13: dropped.** The owner's
answer was the short one — we do not have cheques. `0220` narrows
`supplier_payment.method` to `TRANSFER | CASH | GIRO | OTHER`, moves any
existing `CHEQUE` row to `OTHER` (no ledger line moves; the pot is
`account_key`), and names the constraint 0084 left positional. `payments.rs`,
the contract and the one screen that offered the choice follow.

**The receivable side.** A customer handing us a giro has no path anywhere in
the system, and the till's tenders do not include one. Out of scope until the
owner says it happens.
