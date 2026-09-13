# ERPNext Payment Entry and the money-movement layer — read from code, 13 Sep 2026

Sources: local clone `~/Documents/reference-erp/erpnext`, branch `develop` @ `0849f18` (fresher than the `fe25746` the prior report read); `frappe/hrms` `develop` via raw.githubusercontent; `docs.frappe.io/erpnext/*.md`. Companion to `report-E-erpnext.md` §3.2 — that report gave the field list; this one gives the machine.

**Headline for the impatient.** Payment Entry is a very good document and a bad template. Four things in it are worth copying almost line for line (`payment_type` as one enum, `references[]` with live re-validation, `deductions[]`, `difference_amount == 0` at submit). Four things in it exist only because ERPNext is multi-currency, multi-company and has 30+ `Company.default_*_account` fields — and we have `account_map` instead. And the single most important finding is negative: **ERPNext does not pay salaries, petty cash, post-dated cheques, POS tenders or inter-unit balances through Payment Entry.** All five go through `Journal Entry` with a `voucher_type`. If we copy PE wholesale we will have copied the document that handles perhaps 40% of this client's money movement and left the other 60% homeless — which is exactly the shape ERPNext itself is in.

---

## 1. The complete Payment Entry model

`is_submittable: 1` · `autoname: naming_series:` (`ACC-PAY-.YYYY.-`) · `title_field: title` · `track_changes: 1` · `states: []` (no workflow shipped) · permissions: `Accounts User`, `Accounts Manager` · one declared `links` entry: the child table `Bank Transaction Payments` on `Bank Transaction` (this is what puts "linked Bank Transactions" on the PE form).

### 1.1 Header fields, grouped by what they are for

**Type and identity**
| field | type | note |
| --- | --- | --- |
| `naming_series` | Select | `ACC-PAY-.YYYY.-` |
| `payment_type` | Select, **reqd** | `Receive` / `Pay` / `Internal Transfer` — the whole three-way split lives in one enum |
| `posting_date` | Date, reqd, default Today | the ledger date; nothing else moves it |
| `company` | Link Company, reqd | |
| `cost_center` | Link Cost Center, **allow_on_submit** | header dimension, copied onto every GL row that has no better one |
| `mode_of_payment` | Link Mode of Payment | descriptive only on PE — it does **not** pick the account (contrast `Sales Invoice Payment`, where it does) |
| `title` | Data, read-only, hidden | computed: party, or `paid_from - paid_to` for a transfer |
| `amended_from` | Link Payment Entry, read-only, no_copy | |
| `auto_repeat` | Link Auto Repeat, read-only, allow_on_submit | |

**Party** — shown only when `payment_type in ("Receive","Pay")`
| field | type | note |
| --- | --- | --- |
| `party_type` | Link DocType | constrained in the list view to `frappe.boot.party_account_types` keys |
| `party` | Dynamic Link on `party_type` | |
| `party_name` | Data, allow_on_submit | denormalised from `<party_type>_name`, or `title` for Shareholder |
| `contact_person` / `contact_email` | Link Contact / Data ro | forced null for Employee |

`party_type` + `party` is ERPNext's polymorphism: Customer, Supplier, Employee, Shareholder, Student, Member. It is *not* a field on the document in the usual sense — `setup_party_account_field()` derives three runtime attributes from `payment_type`:

```python
if payment_type == "Receive":  party_account_field = "paid_from"; party_account = paid_from
elif payment_type == "Pay":    party_account_field = "paid_to";   party_account = paid_to
# Internal Transfer: all three stay None
```

So there is no `party_account` column. The party account **is** one of the two money accounts, and which one is decided by the payment type. This is the single cleverest thing in the document and the single most confusing.

**Accounts**
| field | type | note |
| --- | --- | --- |
| `paid_from` | Link Account, reqd | for `Receive` this is the *party* account; for `Pay`/`Internal Transfer` the money account |
| `paid_to` | Link Account, reqd | mirror |
| `paid_from_account_currency` / `paid_to_account_currency` | Link Currency, ro reqd | |
| `paid_from_account_type` / `paid_to_account_type` | Data, hidden, `fetch_from` `paid_from.account_type` | cached so the JS can branch without a round trip |
| `bank_account` | Link Bank Account | company bank account; `set_bank_account_data()` fills `paid_from`/`paid_to` from it and denormalises `bank` + `bank_account_no` |
| `party_bank_account` | Link Bank Account | beneficiary; only used by Payment Order |

**Amounts**
| field | type | note |
| --- | --- | --- |
| `paid_amount` | Currency in `paid_from_account_currency`, reqd | |
| `received_amount` | Currency in `paid_to_account_currency`, reqd | |
| `source_exchange_rate` / `target_exchange_rate` | Float, reqd | forced to 1 in single currency but still *mandatory non-zero* |
| `base_paid_amount` / `base_received_amount` | Currency company, ro reqd | computed |
| `total_allocated_amount` / `base_total_allocated_amount` | Currency, ro | computed = Σ `references[].allocated_amount` |
| `unallocated_amount` | Currency | computed, legal, non-zero ⇒ advance |
| `difference_amount` | Currency company, ro | computed, **must be 0 to submit** |
| `paid_amount_after_tax` / `received_amount_after_tax` (+ `base_*`) | Currency, ro hidden | only meaningful with the `taxes[]` table |
| `base_total_taxes_and_charges` / `total_taxes_and_charges` | Currency, ro | |
| `in_words` / `base_in_words` | Small Text, ro | |

`paid_amount` and `received_amount` exist as **two numbers only because of currency**. `set_received_amount()`:

```python
self.base_received_amount = self.base_paid_amount
if (self.paid_from_account_currency == self.paid_to_account_currency
    and self.payment_type != "Internal Transfer"):
    self.received_amount = self.paid_amount
```

In a single-currency Receive or Pay they are **forced equal**. You cannot express "the invoice was 10,000,000 and 9,830,000 landed" by making them differ — that gap must go through `deductions[]`. (Only `Internal Transfer` is exempt, so a transfer can lose money to a fee on the way.)

**Instrument / bank evidence**
| field | type | note |
| --- | --- | --- |
| `reference_no` | Data | cheque or transfer reference |
| `reference_date` | Date | the date printed on the instrument; **does not move the ledger** |
| `clearance_date` | Date, **read-only**, no_copy, shown only when `docstatus==1` | set by `Bank Transaction`/`Bank Clearance`, never by a person |

`no_copy` on `clearance_date` is the rule the prior report already flagged: **amending blanks it**, because a derived fact must not survive correction of the fact it derives from.

**Status and lifecycle**
| field | values | note |
| --- | --- | --- |
| `status` | `""` / `Draft` / `Submitted` / `Cancelled`, ro, default Draft, no_copy | pure restatement of `docstatus` |
| `payment_order_status` | `""` / `Initiated` / `Payment Ordered`, ro, **hidden**, no_copy | stamped from the outside by `Payment Order.update_payment_status()` |
| `is_opening` | `No` / `Yes`, default No, `depends_on: book_advance_payments_in_separate_party_account == 1` | only meaningful with the advance toggle on |
| `payment_order` | Link Payment Order, ro, no_copy | |

`set_status()` is three lines and has no judgement in it:

```python
if   self.docstatus == 2: self.status = "Cancelled"
elif self.docstatus == 1: self.status = "Submitted"
else:                     self.status = "Draft"
self.db_set("status", self.status, update_modified=True)
```

**The lifecycle is therefore two-state plus a tombstone.** There is no "approved", no "instructed", no "settled". Everything before the money moves is Draft; everything after is Submitted. (Contrast §6 below: this is precisely where our finance-lab engine is ahead.)

**Advance / withholding / dimensions**
| field | note |
| --- | --- |
| `book_advance_payments_in_separate_party_account` | Check, ro, `fetch_from: company.…` — flips the whole GL shape |
| `reconcile_on_advance_payment_date` | Check, ro hidden, `fetch_from: company.…` |
| `apply_tds`, `tax_withholding_category`, `tax_withholding_group`, `ignore_tax_withholding_threshold`, `override_tax_withholding_entries` | the withholding half |
| `purchase_taxes_and_charges_template` / `sales_taxes_and_charges_template` | pull a template into `taxes[]` |
| `accounting_dimensions_section` | empty section; dimension fields are injected at runtime by the Accounting Dimension master |
| `project`, `letter_head`, `print_heading`, `remarks`, `custom_remarks` | |

### 1.2 Child tables

**`references[]` → `Payment Entry Reference`** (`Payment References`)

| field | note |
| --- | --- |
| `reference_doctype` (Link DocType, reqd) + `reference_name` (Dynamic Link, reqd) | the polymorphic pointer |
| `due_date`, `bill_no` | ro, fetched from the reference |
| `total_amount`, `outstanding_amount` | ro, **denormalised snapshots** re-fetched by `set_missing_ref_details(force=True)` on every validate |
| `allocated_amount` | **the only writable number** |
| `exchange_rate` (ro), `exchange_gain_loss` (ro) | multi-currency |
| `payment_term` (Link Payment Term), `payment_term_outstanding` (Float ro) | per-instalment allocation |
| `account`, `account_type`, `payment_type` (Data) | carried for *reverse* payments (PE→PE references) |
| `payment_request` (Link), `payment_request_outstanding` (Float ro, a **Python `@property`**, not a column) | |
| `reconcile_effect_on` (Date, ro) | posting date for the advance clearing pass |
| `advance_voucher_type` + `advance_voucher_no` (ro) | remembers the SO/PO an advance came from after a split |

**`deductions[]` → `Payment Entry Deduction`** (`Payment Deductions or Loss`)

| field | note |
| --- | --- |
| `account` | Link Account, **reqd** |
| `cost_center` | Link Cost Center, **reqd** |
| `amount` | Currency **in company currency**, reqd — signed |
| `description` | Small Text |
| `is_exchange_gain_loss` | Check, ro, label "System Generated" |

Five columns. That is the whole apparatus for bank charges, MDR, withholding retained by the payer, rounding, write-offs and FX. The `is_exchange_gain_loss` flag marks a row the system owns: `set_exchange_gain_loss()` finds it, updates it, and **removes every duplicate** (`for row in exchange_gain_loss_rows: self.remove(row)` after popping the first).

**`taxes[]` → `Advance Taxes and Charges`** — a full tax engine on the payment: `charge_type` (Actual / On Paid Amount / On Previous Row Amount / On Previous Row Total / On Net Total), `row_id`, `account_head`, `rate`, `tax_amount`, `base_tax_amount`, `total`, `add_deduct_tax` (Add/Deduct), `included_in_paid_amount`, `is_tax_withholding_account`. Plus `tax_withholding_entries[] → Tax Withholding Entry`.

**`Bank Transaction Payments`** is not on PE but points *at* it — see §4.3.

### 1.3 Computed fields, in the order `set_amounts()` runs them

```
set_received_amount()           → received = paid when single currency & not transfer
set_amounts_in_company_currency → base_paid = paid × source_rate;  base_received = received × target_rate
set_total_allocated_amount()    → Σ |allocated|, skipped entirely for Internal Transfer
set_unallocated_amount()        → see below
set_exchange_gain_loss()        → inserts/updates/removes the system deduction row
set_difference_amount()         → see below
```

`set_unallocated_amount()` — note that **deductions increase what counts as received** on a Receive:

```python
deductions_to_consider = Σ(d.amount for d in deductions if not d.is_exchange_gain_loss)
if payment_type == "Receive" and base_total_allocated < (base_paid + deductions_to_consider):
    unallocated = (base_paid + deductions_to_consider - base_total_allocated - included_taxes) / source_rate
elif payment_type == "Pay" and base_total_allocated < (base_received - deductions_to_consider):
    unallocated = (base_received - deductions_to_consider - base_total_allocated - included_taxes) / target_rate
```

`set_difference_amount()` — the balancing invariant:

```python
base_party_amount = base_total_allocated + (unallocated × rate)
Receive:           difference = base_party_amount - base_received + included_taxes
Pay:               difference = base_paid - base_party_amount - included_taxes
Internal Transfer: difference = base_paid - base_received - included_taxes
difference -= Σ(d.amount for d in deductions)          # ALL deductions, gain/loss included
```

`difference_amount` is read-only on the form. A `write_off_difference_amount` Button calls `set_write_off_deduction()` in JS, which appends a deduction row on `Company.write_off_account` with `amount += difference_amount` — i.e. **the escape hatch is itself a deduction row**, never a silent adjustment.

`set_remarks()` composes a human sentence from the structure ("Amount IDR 95,005,000 paid to PT Ananta / Transaction reference no TRF-99 dated 2026-09-10 / Amount IDR 40,000,000 adjusted against Purchase Invoice ACC-PINV-0001 / …"), and `custom_remarks` (Check) opts out. Cheap, and it is exactly what a BKK print-out needs.

---

## 2. Validation rules

`validate()` is a 22-call list, in order. Everything below is a `frappe.throw` unless marked.

| # | method | what it refuses |
| --- | --- | --- |
| 1 | `setup_party_account_field` | — (derivation) |
| 2 | `set_missing_values` | "**Party Type is mandatory**", "**Party is mandatory**" for Receive/Pay. For `Internal Transfer` it *silently nulls* `party`, `total_allocated_amount`, `base_total_allocated_amount`, `unallocated_amount` and **empties `references`** — a transfer cannot reference anything, by construction |
| 3 | `set_liability_account` | with `Company.book_advance_payments_in_separate_party_account` on: "Please set default **Default Advance Received/Paid Account** in Company X". Silently disables itself if any reference is not a Sales/Purchase Order, or if party type is not Customer/Supplier, or if the party account type contradicts the party type (Payable account for a Customer ⇒ `is_opening = "No"`, feature off) |
| 4 | `set_missing_ref_details(force=True)` | re-fetches `total_amount`/`outstanding_amount`/`due_date`/`exchange_rate` on every reference row, **every validate**. On submit/cancel it writes them with `db_set` |
| 5 | `validate_payment_type` | "Payment Type must be one of Receive, Pay, or Internal Transfer" |
| 6 | `validate_party_details` | "{party_type} {party} does not exist" |
| 7 | `set_exchange_rate` | — |
| 8 | `validate_mandatory` | `paid_amount`, `received_amount`, `source_exchange_rate`, `target_exchange_rate` must all be **truthy** — zero is refused, so a zero-amount PE is impossible |
| 9 | `validate_reference_documents` | five separate refusals, all skipped for rows with `allocated_amount == 0`: <br>a. `reference_doctype` must be in `get_valid_reference_doctypes()` — Customer ⇒ (Sales Order, Sales Invoice, Journal Entry, Dunning, Payment Entry); Supplier ⇒ (Purchase Order, Purchase Invoice, Journal Entry, Payment Entry); Shareholder/Employee ⇒ (Journal Entry,) <br>b. the referenced document must exist <br>c. **the reference's party must equal the PE's party** (except Journal Entry, which routes to `validate_journal_entry`) <br>d. for invoice doctypes: the invoice's own party account (`debit_to` / `credit_to` / `payable_account`) must equal `self.party_account` — *unless* the advance-separate-account flag is on. "{doc} is associated with {A}, but Party Account is {B}" <br>e. a Purchase Invoice with `on_hold` is refused: "{0} {1} is on hold" <br>f. `ref_doc.docstatus != 1` ⇒ "must be submitted" |
| 9b | `validate_journal_entry` | the referenced JE must have a `Journal Entry Account` row on `self.party_account` for `self.party`, `docstatus=1`, with `reference_type` unset or a SO/PO — and it must carry a non-zero amount on the correct side (`debit` for Receive, `credit` for Pay). "does not have account {2} or already matched against another voucher"; "does not have any unmatched {debit\|credit} entry" |
| 10 | `set_amounts` | — |
| 11 | `validate_amounts` → `validate_received_amount` | single currency: "**Received Amount cannot be greater than Paid Amount**" |
| 12–13 | `apply_taxes`, `set_amounts_after_tax` | inclusive-tax ordering errors via `validate_inclusive_tax` |
| 14 | `clear_unallocated_reference_document_rows` | not a refusal — **deletes** every reference row with `allocated_amount == 0`, from the doc *and* from the table (`frappe.db.delete`) |
| 15 | `validate_transaction_reference` | `bank_account = paid_to if Receive else paid_from`; if `Account.account_type == "Bank"` then **"Reference No and Reference Date is mandatory for Bank transaction"** |
| 16–17 | `set_title`, `set_remarks` | — |
| 18 | `validate_duplicate_entry` | key = (`reference_doctype`, `reference_name`, `payment_term`, `payment_request`). "Row #{0}: Duplicate entry in References" |
| 19 | `validate_payment_type_with_outstanding` | Σ `allocated_amount` < 0 with Customer + Receive ⇒ "**Cannot receive from customer against negative outstanding**" |
| 20 | `validate_allocated_amount` | returns immediately for Internal Transfer. Then: <br>a. `validate_allocated_amount_as_per_payment_request` — allocated > the Payment Request's live `outstanding_amount` ⇒ refused <br>b. for Customer/Supplier: `validate_allocated_amount_with_latest_data` **re-runs `get_outstanding_reference_documents` against the live Payment Ledger** and compares: <br>  · reference gone ⇒ "{0} {1} has already been fully paid." <br>  · row's stored `outstanding_amount` ≠ live ⇒ "has already been **partly paid**. Please use the 'Get Outstanding Invoice' … button to get the latest outstanding amounts." <br>  · term-based allocation enabled but `payment_term` empty ⇒ refused <br>  · allocated > `payment_term_outstanding` ⇒ refused <br>  · allocated > live outstanding ⇒ "Row #{0}: Allocated Amount cannot be greater than outstanding amount." <br>  · **mirrored for negatives**: `allocated < 0 and allocated < outstanding` ⇒ same message <br>c. for other party types: the simple stored-value comparison only |
| 21 | `validate_paid_invoices` | **msgprint, not a throw** — orange warning that a reference had no outstanding left and now has a negative one, "If this is undesirable please cancel the corresponding Payment Entry" |
| 22 | `ensure_supplier_is_not_blocked` | `Supplier.on_hold` with `hold_type in ("All","Payments")` and `release_date` unreached ⇒ "{0} is blocked so this transaction cannot proceed" |
| 23 | `PaymentTaxWithholding(self).on_validate()` | withholding threshold / category rules |

**`on_submit` adds the one that matters most:**

```python
def on_submit(self):
    if self.difference_amount:
        frappe.throw(_("Difference Amount must be zero"))
```

**GL-layer refusals**, fired through `make_gl_entries` → `general_ledger.make_gl_entries`:

- `BudgetValidation` (unless `use_legacy_budget_controller`) — a Budget can block submission.
- `validate_accounting_period` — an `Accounting Period` whose `Closed Document` child has `document_type = "Payment Entry"`, `closed = 1`, and covers `posting_date` ⇒ **"You cannot create a Payment Entry within the closed Accounting Period {X}"**, bypassable only by `Accounting Period.exempted_role`. (This is per-doctype, not blanket — a *selective* close.)
- `validate_disabled_accounts`.
- `process_debit_credit_difference` — allowance for Payment Entry and Journal Entry is `5 / 10**precision` (much tighter than the `0.5` other voucher types get). Within the allowance a round-off GLE is inserted; beyond it: "Debit and Credit not equal for Payment Entry #X. Difference is Y."
- `len(gl_map) <= 1` ⇒ "**Incorrect number of General Ledger Entries found.** You might have selected a wrong Account in the transaction."
- Per `GL Entry`: account must be non-group / not `docstatus 2` / belong to the company; **Receivable account ⇒ Customer required, Payable ⇒ Supplier required**; zero debit *and* credit refused; a Profit-and-Loss account **requires `cost_center`** (`pl_must_have_cost_center`); account currency must match; a group Cost Center or one from another company refused; `Account.freeze_account == "Yes"` needs `Company.role_allowed_for_frozen_entries`; `is_opening == "Yes"` forbids P&L accounts.

**After submit**, `on_update_after_submit` runs `check_if_fields_updated(fields_to_check=[], child_tables={"references": [], "taxes": [], "deductions": []})` and, if anything changed, `validate_for_repost()` then `repost_accounting_entries()`. The reconciliation tool sets `flags.ignore_reposting_on_reconciliation` to skip it, because it reposts by itself.

**`on_cancel`** declares `ignore_linked_doctypes` for eleven ledgers/tools (GL Entry, Stock Ledger Entry, Payment Ledger Entry, both Reposts, Unreconcile Payment (+entries), Advance Payment Ledger Entry, Tax Withholding Entry), reverses the GL, reverses the payment schedule and payment requests, delinks advance references on the invoices, and re-derives status. **GL is reversed, never deleted.**

---

## 3. GL posting per `payment_type`

Since commit-era v17 the composition moved out of the document into `erpnext/accounts/doctype/payment_entry/services/gl_composer.py::PaymentEntryGLComposer`, subclassing `accounts/services/base_gl_composer.py`. `build_gl_map()` returns `PaymentEntryGLComposer(self).compose()`.

### 3.1 The composition order

```python
def compose(self):
    doc.setup_party_account_field()          # if needed
    doc.set_transaction_currency_and_rate()
    self.add_party_gl_entries(gl_entries)    # one row per reference + one for unallocated
    self.add_bank_gl_entries(gl_entries)     # one or two rows
    self.add_deductions_gl_entries(gl_entries)
    self.add_tax_gl_entries(gl_entries)
    add_regional_gl_entries(gl_entries, doc) # @allow_regional hook (India TDS etc.)
    self.set_transaction_currency_and_rate_in_gl_map(...)
```

then in `make_gl_entries`:

```python
gl_entries = process_gl_map(gl_entries, merge_entries=<Accounts Settings.merge_similar_account_heads>)
make_gl_entries(gl_entries, cancel=..., adv_adj=..., merge_entries=...)
self.make_exchange_gain_loss_journal()       # a SEPARATE Journal Entry, voucher_type "Exchange Gain Or Loss"
self.make_advance_gl_entries(cancel=cancel)  # a SEPARATE GL pass, only if advance-in-separate-account
```

`process_gl_map` does three things: cost-center allocation distribution, `merge_similar_entries`, `toggle_debit_credit_if_negative`. **The merge key is `[account, cost_center, party, party_type, voucher_detail_no, against_voucher, against_voucher_type, project, finance_book, voucher_no, advance_voucher_type, advance_voucher_no] + dimensions`** — because `against_voucher` is in the key, the per-invoice party lines **survive merging**. That is not an accident; it is what makes the Payment Ledger able to say which debt the money answered.

`toggle_debit_credit_if_negative` flips a negative debit into a credit. **This is how a negative deduction becomes a credit leg** — the only way to express a gain, a discount received, or a rounding credit in `deductions[]`.

`post_net_value: True` is set on the bank leg of a Pay/Transfer and on every tax leg; in `toggle_debit_credit_if_negative` it collapses a row that ended up with both a debit and a credit into the net side.

### 3.2 Each leg, exactly

**Party legs** (`add_party_gl_entries`, skipped entirely when `party_account` is None, i.e. Internal Transfer):

```
dr_or_cr   = "credit" if Receive else "debit"          # re-derived per row
against    = paid_to  if Receive else paid_from
account    = party_account          (= paid_from for Receive, paid_to for Pay)
party_type, party, account_currency = party_account_currency
cost_center = doc.cost_center  (or the Sales Invoice's own, if the header has none)
amount     = d.allocated_amount  (account currency) / calculate_base_allocated_amount_for_reference(d) (company)
```

`against_voucher_type` / `against_voucher` is chosen three ways:
1. reference is an **advance payment doctype** (hooks: `advance_payment_receivable_doctypes = ["Sales Order"]`, `advance_payment_payable_doctypes = ["Purchase Order"]`) ⇒ `against_voucher = the PE itself`, plus `advance_voucher_type/no = the SO/PO`;
2. **`book_advance_payments_in_separate_party_account`** ⇒ `against_voucher = the PE itself` ("Do not reference Invoices while Advance is in separate party account");
3. otherwise ⇒ `against_voucher = the invoice`.

A negative allocation against an invoice with the "wrong" account type (Receivable + Pay, or Payable + Receive) has its `dr_or_cr` pre-flipped, because `toggle_debit_credit_if_negative` will flip it back.

Then, if `unallocated_amount`: **one more party leg**, same side, no `against_voucher` (so the PLE will point at the PE itself).

**Bank legs** (`add_bank_gl_entries`):

```
Pay / Internal Transfer:  Cr paid_from  paid_amount / base_paid_amount      against = party or paid_to   post_net_value=True
Receive / Internal Transfer: Dr paid_to received_amount / base_received_amount  against = party or paid_from
```

Internal Transfer gets **both**, and nothing else.

**Deduction legs** (`add_deductions_gl_entries`) — **always written as a debit**:

```python
gl_entries.append(self.get_gl_dict({
    "account": d.account, "against": doc.party or doc.paid_from,
    "debit_in_account_currency": d.amount, "debit": d.amount,
    "cost_center": d.cost_center}, item=d))
```

Negative `amount` ⇒ `toggle_debit_credit_if_negative` turns it into a credit. The deduction account's currency **must be company currency** ("Currency for {0} must be {1}").

**Tax legs** (`add_tax_gl_entries`): one leg on `account_head`, and — unless `included_in_paid_amount` — a **reverse leg on the payment account** (`paid_to` for Receive, `paid_from` for Pay/Transfer). Both carry `post_net_value: True`.

### 3.3 What goes to `GL Entry` vs `Payment Ledger Entry`

**`GL Entry`** gets every leg. Fields (from `base_gl_composer.get_gl_dict`): `company`, `posting_date`, `fiscal_year`, `voucher_type` (= `"Payment Entry"`), `voucher_no`, **`voucher_subtype` (= `payment_type` — `get_voucher_subtype` maps `{"Payment Entry": "payment_type"}`)**, `remarks`, `debit`/`credit` (+`_in_account_currency`, `_in_transaction_currency`), `is_opening`, `party_type`, `party`, `project`, `post_net_value`, `voucher_detail_no`, `account`, `against`, `account_currency`, `cost_center`, `against_voucher_type`, `against_voucher`, `advance_voucher_type`, `advance_voucher_no`, `transaction_currency`, `transaction_exchange_rate`, `due_date`, `finance_book`, plus every active Accounting Dimension.

**`Payment Ledger Entry`** is *derived from the GL map*, in `accounts/utils.py::get_payment_ledger_entries`, and **only for rows whose account is `account_type in ("Receivable","Payable")`**:

```python
if account_type == "Receivable": amount = gle.debit  - gle.credit
elif account_type == "Payable":  amount = gle.credit - gle.debit
against_voucher_type = gle.against_voucher_type or gle.voucher_type     # falls back to SELF
against_voucher_no   = gle.against_voucher      or gle.voucher_no
```

So: **a party book with signed amounts, grouped by `against_voucher_no`.** An invoice's outstanding is `Σ ple.amount WHERE against_voucher_no = invoice AND delinked = 0`. `QueryPaymentLedger` in `utils.py` is the reader; `get_outstanding_invoices` is the caller that the PE's "Get Outstanding Invoices" dialog ends at. PLE is submittable, has a `delinked` flag rather than a delete, and carries `voucher_detail_no` (the `Payment Entry Reference` row name) so a partial can be split later.

**`Advance Payment Ledger Entry`** is created in the same pass, but only when the GL row has `advance_voucher_no` set. It is a much thinner book — `voucher_type/no`, `against_voucher_type/no`, `amount`, `currency`, `event`, `delinked` — where `event` is `"Submit"` if the row points at its own voucher and `"Adjustment"` otherwise. It answers one question: how much of this Sales/Purchase Order's advance is still unconsumed.

Cancellation sets `delinked` (or, with `enable_immutable_ledger`, re-posts a dated reversal) rather than deleting.

### 3.4 Eight worked journals

All IDR, exchange rates 1. Account names are illustrative.

---
**J1 · Pay one supplier invoice in full**

`payment_type=Pay` · `party_type=Supplier` · `party=PT Ananta` · `paid_from=Bank BCA 1234 (Bank)` · `paid_to=Hutang Dagang (Payable)` · `paid_amount = received_amount = 50,000,000` · `references[0] = {Purchase Invoice, PINV-0001, outstanding 50,000,000, allocated 50,000,000}` · `reference_no/date` **mandatory** (paid_from is type Bank).

| Dr | Cr | account | party | against | against_voucher |
| ---: | ---: | --- | --- | --- | --- |
| 50,000,000 | | Hutang Dagang | Supplier / PT Ananta | Bank BCA 1234 | Purchase Invoice PINV-0001 |
| | 50,000,000 | Bank BCA 1234 | | PT Ananta | — (`post_net_value`) |

PLE: 1 row — `account_type=Payable`, `amount = credit − debit = −50,000,000`, `against_voucher_no = PINV-0001`. `update_voucher_outstanding` recomputes PINV-0001 to 0.
`difference = base_paid(50m) − base_party(50m + 0) − 0 − 0 = 0` ✓

---
**J2 · Pay three invoices partially, with a bank charge**

`paid_amount = 95,005,000`; allocations PINV-1 40,000,000 · PINV-2 30,000,000 · PINV-3 25,000,000 = 95,000,000; `deductions[0] = {Biaya Administrasi Bank, 5,000, cost_center=HO}`.

| Dr | Cr | account | against_voucher |
| ---: | ---: | --- | --- |
| 40,000,000 | | Hutang Dagang (Supplier PT Ananta) | PINV-1 |
| 30,000,000 | | Hutang Dagang (Supplier PT Ananta) | PINV-2 |
| 25,000,000 | | Hutang Dagang (Supplier PT Ananta) | PINV-3 |
| 5,000 | | Biaya Administrasi Bank | — |
| | 95,005,000 | Bank BCA 1234 | — |

`unallocated`: Pay branch — `base_received(95,005,000) − deductions(5,000) = 95,000,000` == allocated, not `<`, so 0.
`difference = 95,005,000 − 95,000,000 − 0 − 5,000 = 0` ✓
PLE: three rows, each −40m / −30m / −25m against its own invoice. **Three separate party lines survive the merge** because `against_voucher` is in the merge key.

---
**J3 · Receive from customer, remainder is an advance**

`payment_type=Receive` · `party_type=Customer` · `paid_from=Piutang Dagang (Receivable)` · `paid_to=Bank BCA` · `paid_amount = received_amount = 30,000,000` · `references[0] = {Sales Invoice, SINV-1, allocated 18,000,000}`.

`unallocated` = 30,000,000 − 18,000,000 = **12,000,000** (legal).

| Dr | Cr | account | against_voucher |
| ---: | ---: | --- | --- |
| | 18,000,000 | Piutang Dagang (Customer) | Sales Invoice SINV-1 |
| | 12,000,000 | Piutang Dagang (Customer) | **— (none)** |
| 30,000,000 | | Bank BCA | — |

PLE: row 1 `amount = debit − credit = −18,000,000` against SINV-1. Row 2 `amount = −12,000,000`, and because the GL row has no `against_voucher`, `get_payment_ledger_entries` falls back to `against_voucher_no = the PE itself`. **That self-referencing negative row is what "an advance" physically is in ERPNext.** Payment Reconciliation later rewrites it.
`difference = (18m + 12m) − 30m = 0` ✓

---
**J4 · Internal transfer, bank → bank**

`payment_type=Internal Transfer` · no party · `paid_from=Bank BCA` · `paid_to=Bank Mandiri` · 200,000,000. `set_missing_values` nulls party and **empties `references`**. `reference_no/date` mandatory (paid_from is Bank).

| Dr | Cr | account | against |
| ---: | ---: | --- | --- |
| | 200,000,000 | Bank BCA | Bank Mandiri |
| 200,000,000 | | Bank Mandiri | Bank BCA |

No PLE (neither account is Receivable/Payable). `difference = base_paid − base_received = 0` ✓
Note `set_received_amount` does **not** force equality for Internal Transfer, so a transfer that loses a fee in flight is expressible: `paid 200,000,000`, `received 199,990,000`, and `set_exchange_gain_loss` will auto-insert a system deduction row of 10,000 on `Company.bank_charges_account` (single currency) — a genuinely elegant touch.

---
**J5 · Internal transfer, cash → bank (the daily store deposit)**

`paid_from = Kas Toko 03 (account_type Cash)` · `paid_to = Bank BCA (type Bank)` · 17,450,000.

| Dr | Cr | account |
| ---: | ---: | --- |
| | 17,450,000 | Kas Toko 03 |
| 17,450,000 | | Bank BCA |

**Trap found in code.** `validate_transaction_reference` reads

```python
bank_account = self.paid_to if self.payment_type == "Receive" else self.paid_from
```

For `Internal Transfer` it only ever inspects **`paid_from`**. A bank→cash withdrawal therefore demands a reference number; a **cash→bank deposit does not**. For a retailer whose whole bank-reconciliation problem is 13 stores × 365 deposit slips, that asymmetry is exactly backwards. *Copy the rule, fix the side: check whichever leg is type Bank, or both.*

Also: money in transit (dropped Saturday, credited Monday) has **no model here**. ERPNext's only answer is a third account ("Cash in Transit") and two Internal Transfers, or leaving the single PE unreconciled until Monday's `clearance_date`.

---
**J6 · Pay an employee advance**

Not core ERPNext — `hrms/overrides/employee_payment_entry.py` subclasses `PaymentEntry` as `EmployeePaymentEntry` **purely to override `get_valid_reference_doctypes()`**, adding `("Expense Claim", "Journal Entry", "Employee Advance", "Leave Encashment", "Gratuity")` for `party_type == "Employee"`. `get_payment_entry_for_employee(dt, dn)` builds: `payment_type="Pay"`, `party_type="Employee"`, `paid_from = bank/cash`, `paid_to = the Employee Advance's advance_account` (which must be `account_type = Receivable` — there is a literal error string "Cancel the Payment Entry made against it, correct the advance account to be of type Receivable, and create a new Payment Entry").

| Dr | Cr | account | party | against_voucher |
| ---: | ---: | --- | --- | --- |
| 2,000,000 | | Uang Muka Karyawan (Receivable) | Employee / EMP-0004 | Employee Advance EA-0009 |
| | 2,000,000 | Bank BCA | | — |

PLE: `account_type=Receivable`, `amount = debit − credit = +2,000,000`, against EA-0009 — a **positive** open item in the party book, which the later Expense Claim settles. This is the pattern for store-head personal loans.

**This is the one extension point worth stealing outright:** the reference whitelist is a *method*, so another module widens what a payment may answer without touching the payment.

---
**J7 · Pay salary — and ERPNext does NOT use Payment Entry**

`hrms/payroll/doctype/payroll_entry/payroll_entry.py` makes **two Journal Entries**.

`make_accrual_jv_entry()` → `Journal Entry` with `voucher_type = "Journal Entry"`, `user_remark = "Accrual Journal Entry for salaries from … to …"`:

| Dr | Cr | account |
| ---: | ---: | --- |
| 57,250,000 | | Biaya Gaji dan Upah (per component, per cost center) |
| | 3,163,228 | Hutang BPJS / statutory deduction accounts |
| | 54,086,772 | **Payroll Payable** (per employee if `Payroll Settings.process_payroll_accounting_entry_based_on_employee`) |

`make_bank_entry()` → `Journal Entry` with `voucher_type = "Bank Entry"` **or `"Cash Entry"`**, chosen by:

```python
voucher_type = "Cash Entry" if frappe.get_cached_value("Account", self.payment_account, "account_type") == "Cash" else "Bank Entry"
```

| Dr | Cr | account | reference |
| ---: | ---: | --- | --- |
| 54,086,772 | | Payroll Payable (party Employee when employee-wise) | `reference_type=Payroll Entry`, `reference_name=HR-PRUN-…` |
| | 54,086,772 | Bank BCA | |

Loan repayments are netted out of the bank entry before it is built (`process_loan_repayments_for_bank_entry`). `Salary Slip.journal_entry` is stamped with the JE name.

**Conclusion: ERPNext's own answer to "money out that is not a supplier" is `Journal Entry` with a `voucher_type`.** That is the second door, and it is load-bearing.

---
**J8 · Receive card/QRIS settlement net of MDR**

ERPNext has no acquirer settlement document. The honest reconstruction, and it works cleanly:

`payment_type=Receive` · `party_type=Customer` (the acquirer modelled as a party, or `Journal Entry` as the reference if the card sale was booked by a till journal) · `paid_from = Piutang Acquirer BCA (Receivable)` · `paid_to = Bank BCA` · **`paid_amount = received_amount = 9,830,000`** (what actually landed) · `references[0] = {…, allocated 10,000,000}` (the gross) · `deductions[0] = {Biaya MDR, 170,000, cost_center = Toko 03}`.

| Dr | Cr | account | against_voucher |
| ---: | ---: | --- | --- |
| | 10,000,000 | Piutang Acquirer BCA | the card-sale voucher |
| 170,000 | | Biaya MDR | — |
| 9,830,000 | | Bank BCA | — |

`unallocated`: `base_paid(9,830,000) + deductions(170,000) = 10,000,000` == allocated ⇒ 0.
`difference = 10,000,000 − 9,830,000 − 170,000 = 0` ✓

**This is the mechanic to take.** On a Receive, `paid_amount` is *what landed*, the allocation is *the gross owed*, and the gap must be named in `deductions[]`. Three legs, one document, and the MDR lands on a P&L account with a cost center — which is precisely what our T+1 settlement needs and what `payments.rs` explicitly says it does not do ("No bank charge … it belongs on the bank statement being reconciled").

---

## 4. The surrounding documents and how they chain

### 4.1 Payment Request → Payment Entry

`Payment Request` is submittable, `ACC-PRQ-.YYYY.-`. Two shapes in one doctype via `payment_request_type`: **`Inward`** (ask a customer to pay — gateway, `payment_url`, `payment_channel` Email/Phone, `Payment Gateway Account`, subscription plans) and **`Outward`** (an internal request to pay a supplier). `status` ladder: `Draft → Requested → Initiated → Partially Paid → Paid → Failed → Cancelled`, plus `outstanding_amount` (Currency, ro, visible only when `docstatus == 1`).

`create_payment_entry(submit=True)` calls the very same `get_payment_entry(dt, dn, …, created_from_payment_request=True)` factory the invoice uses, then overrides `mode_of_payment`, sets `reference_no = self.name` ("to prevent validation error" — a Payment Request name standing in for a bank reference), `reference_date = nowdate()`, and writes a remark.

The **back-pressure** is the interesting half. `update_payment_requests_as_per_pe_references(references, cancel)` runs from PE `on_submit` and `on_cancel`, walks `Payment Entry Reference.payment_request`, decrements/increments `outstanding_amount`, refuses over-allocation ("The allocated amount is greater than the outstanding amount of Payment Request {0}"), and re-derives status:

```
new_outstanding == grand_total  → "Initiated" (Outward) / "Requested" (Inward)
new_outstanding == 0            → "Paid"
new_outstanding  > 0            → "Partially Paid"
```

`Payment Entry Reference.payment_request_outstanding` is a **Python `@property`**, not a stored column — it reads the live Payment Request. That is the right call and worth copying: a second copy of an outstanding balance is a second copy that drifts.

### 4.2 Payment Order — and the surprise

`Payment Order` (`PMO-`, submittable): `company`, `company_bank_account` (reqd), `posting_date`, `payment_order_type` ∈ (`Payment Request`, `Payment Entry`), and `references[] → Payment Order Reference` (`reference_doctype`, `reference_name`, `amount`, `supplier`, `payment_request`, `mode_of_payment`, `bank_account`, `account`, `payment_reference`).

`PaymentEntry.make_payment_order()` is a `get_mapped_doc` that requires `docstatus == 1` and copies `party_bank_account`, `paid_amount`, `paid_to`, `party`, `mode_of_payment` into one reference row.

`on_submit` → `update_payment_status()` stamps `"Payment Ordered"` back onto each reference (`Payment Request.status`, or **`Payment Entry.payment_order_status`**); `on_cancel` stamps `"Initiated"`.

**The surprise:** `make_payment_records(name, supplier, mode_of_payment)` → `make_journal_entry(...)` — it creates a **Journal Entry**, not a Payment Entry:

```python
je.voucher_type = "Bank Entry"
if mode_of_payment and mode_of_payment_type.get(mode_of_payment) == "Cash":
    je.voucher_type = "Cash Entry"
# one Dr line per reference on get_party_account("Supplier", supplier, company)
# one Cr line on doc.account for the total
```

So Payment Order is a **batch of instructions that lands as a Journal Entry per supplier**, and its only tie back to Payment Entry is a hidden read-only status field. It is not a Payment Entry orchestrator; it is a parallel money door. (It is also how ERPNext half-admits it needs an INSTRUCTED state without having one.)

### 4.3 Bank Transaction ↔ Payment Entry

`Bank Transaction` (`ACC-BTN-.YYYY.-`, submittable): `date`, `bank_account`, `currency`, `deposit`, `withdrawal`, `description`, `reference_number` (allow_on_submit), `transaction_id`, `transaction_type`, `bank_party_name` / `bank_party_iban` / `bank_party_account_number`, `included_fee` / `excluded_fee`, `party_type` / `party` (allow_on_submit), `allocated_amount` / `unallocated_amount` (ro, allow_on_submit), `is_rule_evaluated` / `matched_transaction_rule`, and the child `payment_entries[] → Bank Transaction Payments`.

`status` ∈ `Pending / Settled / Unreconciled / Reconciled / Cancelled`, derived:

```python
docstatus == 2                → "Cancelled"
docstatus == 1, unallocated>0 → "Unreconciled"
docstatus == 1, unallocated<=0→ "Reconciled"
```

`Bank Transaction Payments`: `payment_document` (Link DocType) + `payment_entry` (Dynamic Link) + `allocated_amount` + `clearance_date` (ro) + **`reconciliation_type` ∈ (`Matched`, `Voucher Created`)**. The allowed doctypes come from a hook: `bank_reconciliation_doctypes = ["Payment Entry", "Journal Entry", "Purchase Invoice", "Sales Invoice"]`.

`add_payment_entries(vouchers, is_new_voucher)` appends rows with `allocated_amount = 0.0` and lets `allocate_payment_entries()` (run in `before_submit` / `before_update_after_submit`) do the arithmetic. Its docstring is the algorithm:

> get the amount already allocated against all transactions (t), get the voucher amount from gl (v), allocate a = v − t. `a == 0` ⇒ already cleared, clear & remove. `0 < a <= u` ⇒ allocate a & clear. `a > u` ⇒ allocate u. `a < 0` ⇒ Error: already over-allocated.

`get_clearance_details()` reads **`GL Entry` rows on accounts of `account_type = "Bank"`** for the voucher — so a voucher that does not touch the statement's bank account is refused ("{0} {1} is not affecting bank account {2}"), and a JE with several bank rows is summed. `should_clear` is true only when *every* bank GL row of the voucher is fully allocated. Clearance date = `max(transaction.date, latest existing allocation date)`.

`clear_linked_payment_entry()` is a one-liner that sets `clearance_date` on the voucher — `frappe.db.set_value(doctype, docname, "clearance_date", clearance_date)`, with a special case writing into `Sales Invoice Payment.clearance_date` for POS rows. **Unmatching passes `clearance_date = None`.** `on_cancel` delinks every row.

Two bank transactions can also match **each other** (`payment_document == "Bank Transaction"` → `update_linked_bank_transaction`) — the inter-bank transfer that shows on both statements.

`unreconcile_transaction(name)` distinguishes the two `reconciliation_type`s: rows marked `Matched` are just removed; rows marked `Voucher Created` have the created voucher **cancelled**. That is a genuinely good rule — undo should undo what it did, not more.

`Bank Reconciliation Tool` (single, virtual-ish) is where a person works. It can, from one statement line: `create_payment_entry_bts` (payment_type = `Receive` if `deposit > 0` else `Pay`), `create_journal_entry_bts`, `create_internal_transfer` (a PE with `payment_type = "Internal Transfer"`, and it will reconcile a *mirror* transaction on the other account in the same call), `create_bank_entry_and_reconcile`, plus bulk variants. Matching is a `rank` score built from `Case()` expressions — `ref_rank + amount_rank + party_rank + unallocated_rank + 1` — sorted descending. `auto_reconcile_vouchers` batches.

`Bank Clearance` is a separate **single** tool: pick an account + date range, get a `Bank Clearance Detail` grid (`payment_document`, `payment_entry`, `cheque_number`, `cheque_date`, `clearance_date`) and type clearance dates in bulk. This is the nearest thing ERPNext has to a cheque/giro presentment run.

### 4.4 Payment Reconciliation (invoice ↔ payment) and Unreconcile

`Payment Reconciliation` is `issingle: 1` **and `is_virtual: 1`** — `load_from_db`, `db_insert`, `db_update`, `delete`, `get_list`, `get_count`, `get_stats` are all overridden; **nothing is stored**. Its three child tables are virtual too.

Filters: `company`, `party_type`, `party`, `receivable_payable_account`, `bank_cash_account`, `default_advance_account`, date ranges for invoices and payments, min/max amounts, `invoice_limit` / `payment_limit` (default 50 each), `cost_center`, `project`, `invoice_name` / `payment_name` text filters.

`allocate_entries(args)` is plain greedy FIFO over the two lists, computing `difference_amount` and picking the exchange gain/loss account per row. `validate_allocation()` refuses `allocated > row.amount` and `allocated − invoice_outstanding > 0.009`.

`reconcile()` → `reconcile_allocations()` splits into two paths: credit/debit notes go to `reconcile_dr_cr_note`, everything else to **`accounts/utils.py::reconcile_against_document`**, which is the real engine:

> "Cancel PE or JV, Update against document, split if required and resubmit"

For a Payment Entry it calls `update_reference_in_payment_entry(...)`, which **splits the reference row**: the existing row's `allocated_amount` is decremented and a *new* `Payment Entry Reference` row is appended with `docstatus = 1` pointing at the newly matched invoice. Then, depending on the advance flag, either `make_advance_gl_entries(entry=row)` or a full delete-and-rebuild:

```python
_delete_pl_entries(voucher_type, voucher_no)
_delete_adv_pl_entries(voucher_type, voucher_no)
gl_map = doc.build_gl_map()
process_debit_credit_difference(gl_map)          # "Make sure there is no overallocation"
create_payment_ledger_entry(gl_map, update_outstanding="No", cancel=0, adv_adj=1)
```

**Note what that is: reconciliation rewrites the Payment Ledger but does not rewrite the General Ledger.** The GL entry for the payment is unchanged (the money still moved from bank to receivable); only *which invoice it points at* changes. That separation — a money ledger and a matching ledger, only the second of which reconciliation touches — is the deepest structural idea in the whole subsystem.

`check_if_advance_entry_modified` guards against a concurrent change; `validate_allocated_amount(args)` refuses negative or over-`unadjusted_amount`.

`Process Payment Reconciliation` is the batch version: submittable, `ACC-PPR-{#####}`, `status` ∈ `Queued / Running / Paused / Completed / Partially Reconciled / Failed`, `error_log`, driven by `Accounts Settings.auto_reconcile_payments` + `auto_reconciliation_job_trigger` + `reconciliation_queue_size`, with `Process Payment Reconciliation Log` rows.

`Unreconcile Payment` is the undo, and unlike the tool it **is a real submittable document**: `company`, `voucher_type`, `voucher_no`, `allocations[] → Unreconcile Payment Entries` (`reference_doctype`, `reference_name`, `account`, `party_type`, `party`, `allocated_amount`, `account_currency`, **`unlinked` Check**). `validate()` restricts to `["Payment Entry", "Journal Entry"]`. `on_submit` per allocation: `unlink_ref_doc_from_payment_entries(doc, voucher_no)` → `cancel_exchange_gain_loss_journal(...)` → `update_voucher_outstanding(...)` → `db_set("unlinked", 1)`. `get_linked_payments_for_doc` reads `Payment Ledger Entry` (`delinked = 0`) and `Advance Payment Ledger Entry` (`event = "Submit"`). `create_unreconcile_doc_for_selection` builds and submits one per selected row. **Undo leaves a record** — that is the rule to keep.

### 4.5 Journal Entry as the other money door

`Journal Entry.voucher_type` has **18** values: `Journal Entry · Inter Company Journal Entry · Bank Entry · Cash Entry · Credit Card Entry · Debit Note · Credit Note · Contra Entry · Excise Entry · Write Off Entry · Opening Entry · Depreciation Entry · Asset Disposal · Periodic Accounting Entry · Exchange Rate Revaluation · Exchange Gain Or Loss · Deferred Revenue · Deferred Expense`.

`Journal Entry Account` child: `account`, `account_type` (hidden), `cost_center`, `party_type` + `party`, `account_currency`, `exchange_rate`, `debit`/`credit` (+`_in_account_currency`), **`reference_type` + `reference_name` + `reference_due_date` + `reference_detail_no`**, `is_advance` (No/Yes), `advance_voucher_type` / `advance_voucher_no`, `bank_account`, `user_remark`, `against_account` (hidden), `is_tax_withholding_account`.

So a JE line can do everything a PE reference row does — party, reference, advance flag — and a JE can have **many bank lines and many parties**. It is strictly more expressive and strictly less guided. ERPNext's own guidance (docs, *Payment Entry or Journal Entry?*) is exactly the owner's thesis restated:

> Use a **Payment Entry** when the event is primarily a movement of money. Use a **Journal Entry** when the event is primarily an accounting adjustment and no customer or supplier payment is taking place. … If you use journal entry to record payments, you will not be able to track receivables, reconcile invoices and complete a sales / purchase cycle.

**`make_payment_via_journal_entry`** (`Accounts Settings`, Check) is the global override. It reaches the browser through `__onload` and is read in exactly three places in `public/js/controllers/transaction.js`:

```js
get_method_for_payment() {
  let method = "erpnext.accounts.doctype.payment_entry.payment_entry.get_payment_entry";
  if (this.frm.doc.__onload?.make_payment_via_journal_entry) {
    method = ["Sales Invoice","Purchase Invoice"].includes(this.frm.doc.doctype)
      ? "erpnext.accounts.doctype.journal_entry.mapper.get_payment_entry_against_invoice"
      : "erpnext.accounts.doctype.journal_entry.mapper.get_payment_entry_against_order";
  }
  return method;
}
```

It also suppresses the early-payment-discount prompt and the draft guard. **One checkbox swaps the entire money door for the whole install** — which tells you how thin the coupling is, and how seriously ERPNext means "these are two doors to the same ledger".

Where ERPNext itself picks JE over PE, from code: payroll accrual and payout (`Payroll Entry`), employee advance *return* (`make_return_entry`), Payment Order execution (`make_payment_records`), exchange gain/loss (`Exchange Gain Or Loss` JE created *by* a Payment Entry), depreciation, asset disposal, period closing, deferred revenue/expense, and `create_journal_entry_bts` from a bank line.

---

## 5. What Payment Entry deliberately does NOT do

| Need | PE's position | What ERPNext uses instead |
| --- | --- | --- |
| **Petty cash imprest** | nothing. No float, no imprest amount, no replenishment trigger, no variance | a *procedure* in the manual: a dedicated Cash account, an Internal Transfer to fund it, one entry per expense, "reconcile physical cash plus receipts to the ledger balance", "post an approved adjustment only when the difference is explained". The doc's own FAQ waffles: "Use the document that best represents the controlled workflow and permissions." For an accountable float it redirects to **Employee Advance + Expense Claim** |
| **Post-dated cheques / giro** | `reference_date` is a plain Data/Date pair with no semantics; `clearance_date` is read-only and owned by Bank Transaction. No maturity, no presentment, no dishonour, no register | a *procedure*: "use the configured post-dated check or clearing account when required… After the bank clears the check, transfer or reconcile the amount." No doctype exists. `Bank Clearance` is the closest tool, and it is a bulk date-typing grid |
| **Multi-party in one document** | impossible by construction — `party_type`/`party` are scalars and `validate_reference_documents` throws when a reference's party differs | `Journal Entry` (party per line), or `Payment Order` → one JE per supplier |
| **Split one payment across two bank accounts** | impossible — `paid_from`/`paid_to` are single Links | `Journal Entry`. `get_clearance_details` explicitly accommodates it: "There should only be one bank gl entry for a voucher, **except for JE**" |
| **Payroll** | never used | `Payroll Entry` → two `Journal Entry`s (`voucher_type = "Journal Entry"` for accrual, `"Bank Entry"`/`"Cash Entry"` for payout) |
| **POS tender settlement** | never used | `Sales Invoice Payment` child on the invoice (`mode_of_payment`, `amount`, `account`, `type`, `reference_no`, **its own `clearance_date`**) + `POS Opening Entry` / `POS Closing Entry` (with `payment_reconciliation[]` of expected vs counted per mode) + `POS Invoice Merge Log`. `Cashier Closing` is a separate, older, unmenued doctype with `expense`/`custody`/`returns` floats |
| **Inter-unit within one company** | impossible — `Internal Transfer` has **no party**, so a transfer cannot carry "Due from Toko 03" | `Inter Company Journal Entry` — but that requires two `Company` records, Internal Customer/Supplier and Party Link. Within one company: a plain JE, or an Accounting Dimension |
| **Cash counts** | nothing | nothing. `POS Closing Entry.payment_reconciliation` counts *tenders*, not denominations. There is no cash-count doctype in Accounts |
| **Approval before the money moves** | nothing — Draft→Submitted is the whole ladder; `status` is `docstatus` restated | generic Frappe `Workflow`, or `Payment Request` (status ladder before) + `Payment Order` (batch instruction after), both of which stamp status *back onto* the PE from outside |
| **Withholding as a simple line** | over-built: `apply_tds` + `Tax Withholding Category` + `Tax Withholding Group` + `tax_withholding_entries[]` + `override_tax_withholding_entries` + `PaymentTaxWithholding` + `taxes[]` | — (a single `deductions[]` row would do it, and the docs' own FAQ lists "withholding" among what belongs in Deductions) |

---

## 6. Verdict on the owner's thesis

> *"finance's job is only two things — paying and receiving — plus matching money against the bank and moving money between accounts; so ERPNext's Payment Entry should be exactly the right thing to copy."*

### 6.1 Is finance only pay + receive + match + move?

ERPNext's Accounting module does these things that are **not** money movement:

**Recognition** — Sales Invoice, Purchase Invoice, Debit/Credit Note, Opening Invoice Creation Tool, Payment Terms / Payment Terms Template (when a debt falls due), Dunning.
**Accrual and deferral** — Journal Entry Template (saved recurring accrual skeletons), Deferred Revenue / Deferred Expense, Process Deferred Accounting, `book_deferred_entries_via_journal_entry`.
**Valuation** — Stock Ledger Entry → GL through Purchase Receipt / Delivery Note / Stock Entry / Stock Reconciliation, and `repost_gle_for_stock_vouchers` which rewrites months of GL when a backdated cost changes.
**Depreciation and capitalisation** — Asset Depreciation Schedule (a submittable document with a journal per row), Asset Capitalization (CWIP), Asset Value Adjustment.
**Tax** — 8 tax doctypes; `Tax Withholding Category` thresholds; inclusive/exclusive rate determination.
**Closing** — Fiscal Year, Accounting Period (+ `Closed Document` per doctype, + `exempted_role`), `Company.accounts_frozen_till_date`, per-account `freeze_account`, Period Closing Voucher, Account Closing Balance.
**Control and integrity** — Budget (which *blocks submission* of a Payment Entry), credit limit + `credit_controller` role, supplier block, Repost Accounting Ledger, Repost Payment Ledger, Ledger Health / Monitor, Ledger Merge, Bisect, Invalid Ledger Entries.
**Statement presentation** — Financial Report Template, Account Category, Consolidated Financial Statement, Custom Financial Statement.

Are those "finance" or "other modules feeding finance"? **ERPNext gives a machine-checkable answer and it is not the owner's.** `GL Entry` has no menu entry anywhere; the set of things that may post is exactly the 31 submittable doctypes; and the *recognition* documents live in the **Selling / Buying / Stock** sidebars while their *posting behaviour* lives in `accounts/`. So the division is: **operations recognise, finance settles, closes, reposts and reports.** Recognition feeds finance; closing, reposting and valuation *are* finance and involve no money at all.

Two further points the thesis misses:

1. **Matching only exists because recognition happened.** `references[]` is meaningful only because something else created an outstanding balance. Strip recognition and "match" collapses to "match against the bank", i.e. one of the four verbs eats another. ERPNext proves the cost: a payment with no reference is perfectly legal, becomes an unallocated advance, and someone must reconcile it later — a whole virtual doctype, a batch processor and an undo document exist to clean up after that one permission.
2. **The fifth verb is closing, and the sixth is valuing.** For a fashion retailer with 13 stores, the money in the business is in the stock and the leases, not in the bank movements. `report-E-erpnext.md` §3.4 already established that we need Period Closing Voucher; §3.12 that we need a stored depreciation schedule. Neither is pay, receive, match or move.

**Verdict:** the thesis is an excellent description of the **Payments screen** and an incomplete description of **Finance**. It is right that pay/receive/match/move is the operational core, and right that those four collapse into one document plus two tools. It is wrong that they are all of finance, and following it literally would leave us without closing, without valuation, and without the recognition documents that make matching possible.

### 6.2 Should we copy Payment Entry wholesale?

**No — copy about half of it, verbatim; adapt a quarter; drop a quarter. And copy the *second* door too.**

#### Copy verbatim (field names, validation shape, GL shape)

1. **`payment_type` ∈ Receive / Pay / Internal Transfer as one enum on one document.** Our `supplier_payment` is one-directional; money-in and float movement currently have no home. `add_bank_gl_entries` shows the entire difference is which side the money leg goes on — nine lines of code for three business shapes.
2. **`references[]` with `reference_doctype` + `reference_name` + `due_date` + `total_amount` + `outstanding_amount` + `allocated_amount`,** where `allocated_amount` is the *only* writable number and the others are snapshots re-fetched on every validate.
3. **`validate_allocated_amount_with_latest_data` — re-read the live outstanding at submit and refuse the stale row by name:** *"has already been partly paid. Please use the 'Get Outstanding Invoice' button to get the latest outstanding amounts."* This is the correct answer to a two-users-one-bill race, and it is better than a lock.
4. **`deductions[]`: `account` + `cost_center` + `amount` + `description` + `is_exchange_gain_loss`.** Five columns that give us MDR, bank charges, rounding, withholding and settlement discount as legs of the causing document. This is the highest-value single table in the report.
5. **`difference_amount` computed, read-only, and `== 0` enforced at submit** — with a `write_off_difference_amount` button that adds a *deduction row*, never a silent plug. The zero invariant is what makes `deductions[]` safe.
6. **`unallocated_amount` as a legal computed value ⇒ advance**, and the GL consequence: a party leg with no `against_voucher`, which the party ledger resolves to the payment itself.
7. **`validate_duplicate_entry`** on (reference kind, reference id, term, request).
8. **`clear_unallocated_reference_document_rows`** — drop zero rows at validate, from the document *and* the table.
9. **`validate_transaction_reference`** — reference no + date mandatory when the money leg is a bank account — **with the `paid_from`-only bug fixed** (check whichever leg is a bank, or both; see J5).
10. **`set_remarks`** composing a sentence from the structure, with `custom_remarks` to opt out. This is the BKK narration, free.
11. **`amended_from`; cancel = GL reversal, never delete; `clearance_date` is `no_copy` so amending blanks it.**
12. **`get_valid_reference_doctypes()` as a method, not a constant** — HRMS widens it to Employee Advance / Expense Claim / Gratuity without touching Payment Entry. Ours: one function `allowed_open_item_kinds(counterparty_kind) -> &[&str]`.
13. **GL shape: one party leg per allocation, carrying the reference; one money leg for the total.** `payments.rs` already does this and its doc comment already argues it; ERPNext independently agrees, and its merge key deliberately preserves it.
14. **`voucher_subtype` on every GL row (= `payment_type`).** One denormalised column makes the general ledger filterable by Pay / Receive / Transfer with no join. We have `source_kind`; add the subtype.
15. **`Unreconcile` as a real submittable document with per-row `unlinked`,** not a button. And `reconciliation_type` ∈ Matched / Voucher Created on the bank-match row, so undo cancels what it created and merely unlinks what it matched.
16. **`Mode of Payment` master with `type` ∈ Cash / Bank / General** — replacing the hard-coded `METHODS` const at `payments.rs:567`. **Not** its `Mode of Payment Account` child.

#### Adapt

| ERPNext | ours | why |
| --- | --- | --- |
| `cost_center` on header, on every deduction row, on every tax row; GL Entry refuses a P&L posting without one | **`site_id`**, same three places, same refusal | the unit is in the account code *and* on the line; §3.5 of the prior report settled this. Every `cost_center` becomes `site_id` mechanically |
| `paid_from` / `paid_to` as `Link Account`; `Company.default_*_account` (30+ fields), `Party Account`, `Mode of Payment Account`, `default_advance_received_account`… | **`account_key` + `account_qualifier` resolved through `account_map` per site** | with 7,528 accounts replicated across 14 units, ERPNext's default-account model is unusable. We already have the better one; keep it and extend it to the deduction rows (`deduction.account_key`, not an account code) |
| `party_type` (Link DocType) + `party` (Dynamic Link) + `party_name`, plus hard-coded party lists in `get_party_account`, `get_valid_reference_doctypes`, `frappe.boot.party_account_types` | **`counterparty` with a `kind` column** (0214 already did this for bills) | one table, one lookup, no DocType-per-party-kind |
| `clearance_date` only; PDC is a documented procedure | **a giro clearing account key (`giro_issued` / `giro_received`) + a giro instrument document with its own lifecycle** (ISSUED → DELIVERED → DUE → CLEARED / REJECTED) | 30–90 day bilyet giro is routine here and `reference_date` cannot carry a maturity. Keep `clearance_date` as the *bank* fact; the giro's own dates are a different object. (`CHEQUE-RESEARCH.md` and the 13-Sep Banking decision already point here) |
| Draft → Submitted, `status` mirrors `docstatus`; INSTRUCTED smuggled in via `Payment Order` + hidden `payment_order_status` | **keep our six-state ladder** REQUESTED → APPROVED → INSTRUCTED → SETTLED (+ FAILED, CANCELLED, RECONCILED), **plus ERPNext's rule that exactly one state posts and cancellation reverses** | HO centralises payment and instructs the bank in batches — the ladder is real here. ERPNext needing a second document *and* a hidden status field to fake it is the evidence |
| `references[]` may only point at a submitted document | **allocation target = `OPEN_ITEM` \| `DIRECT_EXPENSE`** (finance-lab) | see below — this is the one place we are ahead and should stay ahead |

**On `deductions[]` vs `DIRECT_EXPENSE`.** These are the same mechanism under two names. ERPNext's `deductions[]` row is `{account, cost_center, amount, description}` with no party and no reference — which is exactly finance-lab's `{kind: "DIRECT_EXPENSE", role, narrows, description}`. ERPNext's name is better for *charges the counterparty imposed*; ours is better for *costs incurred and paid at once*. **Recommendation: one child table, `lines[]`, where a line is either `{open_item_id, amount}` or `{account_key, qualifier, description, amount}` and a signed amount decides the side.** That is strictly more expressive than either, and it is what the client's real payroll BKK needs — the one quoted at the top of `payments.ts`:

```
Dr Biaya Gaji dan Upah YMHD        57,250,000   accrual        → OPEN_ITEM
Dr Biaya Asuransi dan BPJS YMHD     1,913,489   accrual        → OPEN_ITEM
Dr Biaya Asuransi dan BPJS YMHD     1,249,739   same accrual   → OPEN_ITEM
Dr Biaya Rumah Tangga               1,500,000   incurred now   → DIRECT_EXPENSE
Dr Biaya Rumah Tangga                     272   rounding       → DIRECT_EXPENSE / deduction
Cr PETTY CASH                      61,913,500   the money leg
```

ERPNext can express that document — but only as four `deductions[]` rows plus one reference, i.e. by calling three of the five lines "deductions or loss", which is a lie on the face of the BKK.

#### Omit

- **Multi-currency in full**: `source_exchange_rate`, `target_exchange_rate`, `base_*` twins, `paid_amount` vs `received_amount` as two numbers, `transaction_currency` / `transaction_exchange_rate`, `*_in_transaction_currency` on every GL leg, `validate_received_amount`, `get_currency_data`, `get_invoice_exchange_map`. **Note the consequence:** the *only* reason PE carries both `paid_amount` and `received_amount` is currency, and `set_received_amount` forces them equal in single currency. One `total_minor` is correct for us.
- **Exchange gain/loss**: the auto-inserted `is_exchange_gain_loss` deduction row, `set_exchange_gain_loss`, `make_exchange_gain_loss_journal` (a *whole second Journal Entry* of `voucher_type = "Exchange Gain Or Loss"` linked back to the payment), `cancel_exchange_gain_loss_journal`, `delete_exchange_gain_loss_journal`, `get_linked_exchange_gain_loss_journal`, `Company.exchange_gain_loss_account`, `Accounts Settings.exchange_gain_loss_posting_date`. **Keep one idea from it:** the `is_exchange_gain_loss` Check labelled "System Generated", which marks a row a person may not edit or delete. We will want that flag for the rounding line and for the giro clearing line.
- **Payment Order** + `Payment Order Reference` + `payment_order_status` + `make_payment_order` + `make_payment_records`. And note *why*: `make_payment_records` creates a **Journal Entry**, so adopting Payment Order would import a second posting path that bypasses our poster.
- **Payment Gateway half of Payment Request**: `payment_gateway_account`, `payment_url`, `payment_channel`, `_process_v2_gateway`, `get_tx_data`, subscription plans, `mute_email`, `resend_payment_email`, `make_communication_entry`. **Keep the other half**: an amount somebody asked for, with `outstanding_amount`, a status ladder, and back-pressure from the payment's allocations. That is our REQUESTED state, and `payment_request_outstanding` being a live `@property` rather than a column is the detail to copy.
- **Withholding engine**: `apply_tds`, `tax_withholding_category`, `tax_withholding_group`, `ignore_tax_withholding_threshold`, `tax_withholding_entries[]`, `override_tax_withholding_entries`, `PaymentTaxWithholding`, and the whole `taxes[] → Advance Taxes and Charges` table with `charge_type` / `row_id` / `included_in_paid_amount` / `determine_exclusive_rate` / `get_current_tax_fraction`. PPh 23 on rent, security and freight is real for this client, but it is **one deduction line to a `withholding_payable` account**, not a tax engine — which is exactly what the `payments.rs` header comment already concludes.
- **Dunning**, including the `get_payment_entry` branch that appends a deduction row of `-1 * doc.dunning_amount` on the income account.
- **`book_advance_payments_in_separate_party_account`** + `Advance Payment Ledger Entry` + `reconcile_on_advance_payment_date` + `get_reconciliation_effect_date` + `add_advance_gl_for_reference` + the entire second GL pass. This is a *presentation* choice (show advances as liabilities rather than negative receivables) that costs a second ledger, a second posting pass with its own posting date, and a reposting path. The client's chart already has explicit advance accounts; we do not need the toggle.
- **`is_opening`** (only meaningful with that toggle), `auto_repeat`, `on_recurring`, `letter_head`, `print_heading`, `in_words` / `base_in_words`, `project`, `contact_person` / `contact_email`, `party_bank_account`, and the `bank` / `bank_account_no` denormalisation.
- **`Payment Reconciliation` as `issingle` + `is_virtual`** with `load_from_db` / `db_insert` / `db_update` overridden to do nothing. Take the *job*; refuse the *shape* — that is a Frappe-specific hack to reuse the form renderer for a query screen, and we have `?f=` and the omnibox instead.
- **`Bank Clearance`** as a bulk date-typing grid (superseded by the Bank Reconciliation Tool, and by our `bank_line_match`).

#### 6.3 Against our current `supplier_payment` (`backend/src/cloud/postgres/payments.rs`)

| | ERPNext `Payment Entry` | our `supplier_payment` | finance-lab `payments.ts` |
| --- | --- | --- | --- |
| direction | `payment_type` ∈ 3 | **implicit OUT** | `direction` ∈ OUT / IN |
| money account | `paid_from` + `paid_to`, two `Link Account` | one `account_key` + `account_qualifier` → `account_map` (LEFT JOIN on purpose) | `source` ∈ CASH / PETTY_CASH / BANK{`bank_account_id`} |
| counterparty | `party_type` + `party` on the header | **none on the header**; supplier lives on the allocation (deliberately — "one bank line settling two suppliers is an ordinary Friday") | `counterparty` free string on the header |
| allocations | `references[]` → 5 doctypes, polymorphic | `supplier_payment_allocation` → `purchase_invoice` **only** | `allocations[]` → `OPEN_ITEM` (PAYABLE / ACCRUAL / ADVANCE / INTERUNIT / RECEIVABLE) or `DIRECT_EXPENSE` |
| charges | `deductions[]` + `taxes[]` | **none** — header says "No bank charge", "No withholding tax and no settlement discount" | `DIRECT_EXPENSE` line |
| balancing invariant | `difference_amount == 0` at submit | `total_minor` optional and checked against Σ allocations | `total` derived from allocations, cannot disagree |
| lifecycle | `docstatus` 0/1/2; `status` mirrors | `DRAFT → POSTED` | 7 states; only `SETTLED` posts; `NEXT` map refuses invented transitions |
| reservation | none — submitted or not | **`allocated_minor`: a DRAFT reserves** | **`reserved()`** over APPROVED + INSTRUCTED, separate from `outstanding()` |
| which payable | invoice's own `credit_to` | **derived from the bill's `kind`** — `trade_payable` vs `non_merchandise_payable` | `item.role` on the open item |
| cross-unit | free (cost center is just a dimension) | **refused** (site must match) with a named reason | **refused** (unit must match) with a named reason |
| bank match | `Bank Transaction Payments` child + `clearance_date` | `bank_line_match` | `RECONCILED` status |
| method | `Mode of Payment` master | `METHODS = ["TRANSFER","CASH","GIRO","OTHER"]` const | implicit in `source` |

**Three gaps ERPNext closes that we have open:**
1. **No money-in document at all.** `payments.rs` is supplier-only. One `payment_type` column and a branch in the poster closes receipts, member refunds, acquirer settlement and HO→store float.
2. **No charges anywhere.** Every bank fee, MDR and withholding today becomes a manual journal that nobody links back to the payment it belongs to. `deductions[]` is five columns.
3. **No allocation to anything but a purchase invoice.** The payroll BKK, the employee advance, the inter-unit balance and the acquirer settlement all need reference polymorphism; finance-lab already designed it and production has not got it.

**Two things we have that ERPNext does not, and must keep:**
1. **`account_map`.** A semantic key + site + qualifier resolved at posting time, against ERPNext's 30+ `Company.default_*_account` fields plus `Party Account` plus `Mode of Payment Account`. With a 7,528-account chart replicated per unit, ERPNext's model does not scale and ours does. The LEFT JOIN comment in `payments.rs` (a payment must not vanish from a list because Finance tidied the map) is the sort of thinking ERPNext's `frappe.get_cached_value("Company", …, "default_x_account")` never does.
2. **A lifecycle before the money moves.** ERPNext needs `Payment Request` in front and `Payment Order` behind, each stamping a status back onto the PE from the outside, to fake what our six states say directly.

**One thing finance-lab has that both others lack:** `outstanding()` and `reserved()` as *two separate questions* over the same allocations, with the comment that says why — "still owed" and "already promised to a payment in flight" are different answers and one number cannot be both. ERPNext has no concept of a payment in flight at all.

---

## 7. Diagram-ready spec

```json
{
  "title": "ERPNext money-movement subsystem",
  "source": "frappe/erpnext develop @ 0849f18, frappe/hrms develop, 2026-09-13",
  "node_kinds": {
    "document": "submittable doctype; posts on submit, reverses on cancel",
    "child": "istable child of a document",
    "ledger": "derived, append-only book",
    "tool": "issingle and/or is_virtual; stores nothing of its own",
    "master": "reference data",
    "setting": "issingle policy",
    "report": "read-only query"
  },
  "edge_kinds": ["creates", "posts_to", "references", "allocates_to", "clears", "reconciles",
                 "unreconciles", "updates_status_of", "derives_from", "reads", "blocks", "configures"],
  "nodes": [
    {"id": "payment_entry",        "label": "Payment Entry",             "kind": "document", "note": "Receive / Pay / Internal Transfer; ACC-PAY-.YYYY.-"},
    {"id": "pe_reference",         "label": "Payment Entry Reference",   "kind": "child",    "note": "allocated_amount is the only writable number"},
    {"id": "pe_deduction",         "label": "Payment Entry Deduction",   "kind": "child",    "note": "account + cost_center + signed amount; is_exchange_gain_loss"},
    {"id": "pe_taxes",             "label": "Advance Taxes and Charges", "kind": "child"},
    {"id": "journal_entry",        "label": "Journal Entry",             "kind": "document", "note": "18 voucher_types incl. Bank Entry, Cash Entry, Contra Entry"},
    {"id": "je_account",           "label": "Journal Entry Account",     "kind": "child",    "note": "party + reference per LINE; several bank lines allowed"},
    {"id": "payment_request",      "label": "Payment Request",           "kind": "document", "note": "Inward/Outward; Draft>Requested>Initiated>Partially Paid>Paid"},
    {"id": "payment_order",        "label": "Payment Order",             "kind": "document", "note": "PMO-; batch to bank"},
    {"id": "po_reference",         "label": "Payment Order Reference",   "kind": "child"},
    {"id": "bank_transaction",     "label": "Bank Transaction",          "kind": "document", "note": "Pending/Settled/Unreconciled/Reconciled"},
    {"id": "bt_payments",          "label": "Bank Transaction Payments", "kind": "child",    "note": "reconciliation_type Matched | Voucher Created"},
    {"id": "unreconcile_payment",  "label": "Unreconcile Payment",       "kind": "document", "note": "allocations[] with per-row unlinked flag"},
    {"id": "process_payment_recon","label": "Process Payment Reconciliation","kind":"document","note":"Queued/Running/Paused/Completed"},
    {"id": "purchase_invoice",     "label": "Purchase Invoice",          "kind": "document"},
    {"id": "sales_invoice",        "label": "Sales Invoice",             "kind": "document"},
    {"id": "si_payment",           "label": "Sales Invoice Payment",     "kind": "child",    "note": "POS tender; has its OWN clearance_date"},
    {"id": "purchase_order",       "label": "Purchase Order",            "kind": "document", "note": "advance_payment_payable_doctypes"},
    {"id": "sales_order",          "label": "Sales Order",               "kind": "document", "note": "advance_payment_receivable_doctypes"},
    {"id": "payroll_entry",        "label": "Payroll Entry (hrms)",      "kind": "document"},
    {"id": "employee_advance",     "label": "Employee Advance (hrms)",   "kind": "document"},
    {"id": "expense_claim",        "label": "Expense Claim (hrms)",      "kind": "document"},
    {"id": "pos_closing_entry",    "label": "POS Closing Entry",         "kind": "document"},
    {"id": "gl_entry",             "label": "GL Entry",                  "kind": "ledger",   "note": "no menu entry anywhere"},
    {"id": "payment_ledger_entry", "label": "Payment Ledger Entry",      "kind": "ledger",   "note": "Receivable/Payable rows only; delinked flag"},
    {"id": "advance_ple",          "label": "Advance Payment Ledger Entry","kind":"ledger",  "note": "event Submit | Adjustment"},
    {"id": "payment_reconciliation","label":"Payment Reconciliation",    "kind": "tool",     "note": "issingle AND is_virtual - stores nothing"},
    {"id": "bank_recon_tool",      "label": "Bank Reconciliation Tool",  "kind": "tool",     "note": "rank = ref+amount+party+unallocated+1"},
    {"id": "bank_clearance",       "label": "Bank Clearance",            "kind": "tool",     "note": "bulk clearance_date typing"},
    {"id": "bank_statement_import","label": "Bank Statement Import",     "kind": "tool"},
    {"id": "bank_transaction_rule","label": "Bank Transaction Rule",     "kind": "master"},
    {"id": "mode_of_payment",      "label": "Mode of Payment",           "kind": "master",   "note": "type Cash/Bank/General/Phone + per-company default account"},
    {"id": "payment_term",         "label": "Payment Term",              "kind": "master"},
    {"id": "bank_account",         "label": "Bank Account",              "kind": "master"},
    {"id": "party_account",        "label": "Party Account",             "kind": "master",   "note": "per party per company, + advance_account"},
    {"id": "accounting_period",    "label": "Accounting Period",         "kind": "document", "note": "Closed Document child + exempted_role"},
    {"id": "accounts_settings",    "label": "Accounts Settings",         "kind": "setting",  "note": "make_payment_via_journal_entry, auto_reconcile_payments, merge_similar_account_heads"},
    {"id": "budget",               "label": "Budget",                    "kind": "document"},
    {"id": "repost_payment_ledger","label": "Repost Payment Ledger",     "kind": "document"},
    {"id": "repost_accounting_ledger","label":"Repost Accounting Ledger","kind": "document"},
    {"id": "rep_payment_ledger",   "label": "Payment Ledger (report)",   "kind": "report"},
    {"id": "rep_general_ledger",   "label": "General Ledger (report)",   "kind": "report"},
    {"id": "rep_bank_recon_stmt",  "label": "Bank Reconciliation Statement","kind": "report"},
    {"id": "rep_ap",               "label": "Accounts Payable",          "kind": "report"},
    {"id": "rep_ar",               "label": "Accounts Receivable",       "kind": "report"}
  ],
  "edges": [
    {"from": "payment_entry", "to": "pe_reference",  "kind": "references",  "label": "references[]"},
    {"from": "payment_entry", "to": "pe_deduction",  "kind": "references",  "label": "deductions[]"},
    {"from": "payment_entry", "to": "pe_taxes",      "kind": "references",  "label": "taxes[]"},
    {"from": "payment_entry", "to": "gl_entry",      "kind": "posts_to",    "label": "party leg per allocation + bank leg + deduction legs + tax legs"},
    {"from": "payment_entry", "to": "journal_entry", "kind": "creates",     "label": "make_exchange_gain_loss_journal (voucher_type Exchange Gain Or Loss)"},
    {"from": "gl_entry",      "to": "payment_ledger_entry", "kind": "derives_from", "label": "get_payment_ledger_entries: Receivable/Payable rows only"},
    {"from": "gl_entry",      "to": "advance_ple",   "kind": "derives_from","label": "only when advance_voucher_no is set"},
    {"from": "pe_reference",  "to": "purchase_invoice","kind": "allocates_to"},
    {"from": "pe_reference",  "to": "sales_invoice", "kind": "allocates_to"},
    {"from": "pe_reference",  "to": "purchase_order","kind": "allocates_to","label": "advance; against_voucher = the PE itself"},
    {"from": "pe_reference",  "to": "sales_order",   "kind": "allocates_to","label": "advance; against_voucher = the PE itself"},
    {"from": "pe_reference",  "to": "journal_entry", "kind": "allocates_to","label": "validate_journal_entry: needs an unmatched party line"},
    {"from": "pe_reference",  "to": "employee_advance","kind":"allocates_to","label": "hrms EmployeePaymentEntry widens the whitelist"},
    {"from": "pe_reference",  "to": "expense_claim", "kind": "allocates_to","label": "hrms"},
    {"from": "pe_reference",  "to": "payment_request","kind":"updates_status_of","label": "update_payment_requests_as_per_pe_references"},
    {"from": "purchase_invoice","to":"payment_entry","kind": "creates",     "label": "get_payment_entry(dt, dn)"},
    {"from": "sales_invoice", "to": "payment_entry", "kind": "creates",     "label": "get_payment_entry(dt, dn)"},
    {"from": "payment_request","to":"payment_entry", "kind": "creates",     "label": "create_payment_entry(submit=True)"},
    {"from": "payment_entry", "to": "payment_order", "kind": "creates",     "label": "make_payment_order (docstatus 1 only)"},
    {"from": "payment_order", "to": "po_reference",  "kind": "references"},
    {"from": "payment_order", "to": "journal_entry", "kind": "creates",     "label": "make_payment_records -> Bank Entry / Cash Entry, one per supplier"},
    {"from": "payment_order", "to": "payment_entry", "kind": "updates_status_of","label": "payment_order_status = Payment Ordered"},
    {"from": "payment_order", "to": "payment_request","kind":"updates_status_of","label": "status = Payment Ordered"},
    {"from": "bank_statement_import","to":"bank_transaction","kind":"creates"},
    {"from": "bank_transaction_rule","to":"bank_transaction","kind":"configures","label": "matched_transaction_rule, is_rule_evaluated"},
    {"from": "bank_transaction","to":"bt_payments",  "kind": "references",  "label": "payment_entries[]"},
    {"from": "bt_payments",   "to": "payment_entry", "kind": "clears",      "label": "sets clearance_date; NULL on unmatch"},
    {"from": "bt_payments",   "to": "journal_entry", "kind": "clears",      "label": "sums several bank GL rows"},
    {"from": "bt_payments",   "to": "si_payment",    "kind": "clears",      "label": "POS: writes Sales Invoice Payment.clearance_date"},
    {"from": "bt_payments",   "to": "bank_transaction","kind":"clears",     "label": "bank-to-bank transfer, both statements"},
    {"from": "bank_recon_tool","to":"bank_transaction","kind":"reads"},
    {"from": "bank_recon_tool","to":"payment_entry", "kind": "creates",     "label": "create_payment_entry_bts / create_internal_transfer (reconciliation_type = Voucher Created)"},
    {"from": "bank_recon_tool","to":"journal_entry", "kind": "creates",     "label": "create_journal_entry_bts / create_bank_entry_and_reconcile"},
    {"from": "bank_recon_tool","to":"gl_entry",      "kind": "reads",       "label": "matches on Account.account_type = Bank"},
    {"from": "bank_clearance","to": "payment_entry", "kind": "clears",      "label": "bulk clearance_date"},
    {"from": "payment_reconciliation","to":"payment_ledger_entry","kind":"reads","label": "get_outstanding_invoices / QueryPaymentLedger"},
    {"from": "payment_reconciliation","to":"payment_entry","kind":"reconciles","label": "reconcile_against_document: splits reference rows, rebuilds PLE only"},
    {"from": "payment_reconciliation","to":"journal_entry","kind":"reconciles","label": "update_reference_in_journal_entry"},
    {"from": "process_payment_recon","to":"payment_reconciliation","kind":"creates","label": "batch, queued"},
    {"from": "unreconcile_payment","to":"payment_ledger_entry","kind":"unreconciles","label": "sets delinked"},
    {"from": "unreconcile_payment","to":"advance_ple","kind":"unreconciles"},
    {"from": "unreconcile_payment","to":"payment_entry","kind":"unreconciles","label": "unlink_ref_doc_from_payment_entries"},
    {"from": "payroll_entry", "to": "journal_entry", "kind": "creates",     "label": "accrual JE + Bank Entry / Cash Entry payout - NEVER a Payment Entry"},
    {"from": "employee_advance","to":"payment_entry","kind": "creates",     "label": "get_payment_entry_for_employee (Pay, party_type Employee)"},
    {"from": "employee_advance","to":"journal_entry","kind": "creates",     "label": "make_return_entry"},
    {"from": "expense_claim", "to": "advance_ple",   "kind": "posts_to",    "label": "settles the advance"},
    {"from": "pos_closing_entry","to":"sales_invoice","kind":"references",  "label": "tenders per mode; no Payment Entry involved"},
    {"from": "sales_invoice", "to": "si_payment",    "kind": "references",  "label": "payments[] - the POS tender table"},
    {"from": "mode_of_payment","to":"payment_entry", "kind": "configures",  "label": "descriptive only on PE"},
    {"from": "mode_of_payment","to":"si_payment",    "kind": "configures",  "label": "here it DOES pick the account"},
    {"from": "payment_term",  "to": "pe_reference",  "kind": "configures",  "label": "per-instalment allocation"},
    {"from": "bank_account",  "to": "payment_entry", "kind": "configures",  "label": "set_bank_account_data fills paid_from/paid_to"},
    {"from": "party_account", "to": "payment_entry", "kind": "configures",  "label": "get_party_account(+advance_account)"},
    {"from": "accounting_period","to":"payment_entry","kind": "blocks",     "label": "Closed Document per doctype; exempted_role"},
    {"from": "budget",        "to": "payment_entry", "kind": "blocks",      "label": "BudgetValidation on make_gl_entries"},
    {"from": "accounts_settings","to":"payment_entry","kind":"configures",  "label": "make_payment_via_journal_entry swaps the door globally"},
    {"from": "repost_payment_ledger","to":"payment_ledger_entry","kind":"posts_to"},
    {"from": "repost_accounting_ledger","to":"gl_entry","kind":"posts_to"},
    {"from": "payment_ledger_entry","to":"rep_payment_ledger","kind":"reads"},
    {"from": "payment_ledger_entry","to":"rep_ap",   "kind": "reads"},
    {"from": "payment_ledger_entry","to":"rep_ar",   "kind": "reads"},
    {"from": "gl_entry",      "to": "rep_general_ledger","kind": "reads"},
    {"from": "gl_entry",      "to": "rep_bank_recon_stmt","kind": "reads",  "label": "outstanding = GL bank balance minus uncleared vouchers"},
    {"from": "bank_transaction","to":"rep_bank_recon_stmt","kind": "reads"}
  ]
}
```
