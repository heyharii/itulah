# ERPNext Accounting & Assets — the menu, the doctypes, the mechanisms, and what to copy

Sources read 2026-09-13: `frappe/erpnext` `develop` @ `fe25746` (13 Sep 2026, 17.0.0-dev); `frappe/hrms`; `frappe/lending`; `docs.frappe.io/erpnext` (append `.md` to any doc URL for clean Markdown).

## 0. What the three existing repo docs already cover — and what is now stale
`docs/erpnext-reference.md` maps 15 workspaces, "menu is data (`workspace/*.json`)", the 4 accounting workspaces, 8 division rules, 191 accounts doctypes, 28 homeless doctypes, 11 things to take, 3 not to take. `docs/erpnext-banking.md` covers banking exhaustively and records the 13 Sep owner decisions. `CHEQUE-RESEARCH.md` settles that ERPNext has no PDC feature.
**Stale:** all three describe a menu built from `workspace/*.json` with a desynchronised "cards" layer. As of commit `2a14b5d953` "feat: ship new erpnext workspaces" (27 Aug 2026) **that architecture has been replaced.**

## 1. The menu machinery changed — v17 has Dock → Sidebar → Workspace
- **Dock** (`erpnext/dock/erpnext/erpnext.json`): 17 entries, the app rail. Accounts (`landmark`), Assets (`archive`), …
- **Sidebar** — **one per module**, the actual menu. `Accounts` = 121 items (20 Section Breaks + 101 Links). `Assets` = 23 items.
- **Workspace** — demoted to a dashboard page ("Home"); `links` (card layer) now **empty** in all five accounting/asset workspaces; `shortcuts` empty too. What survives on a workspace page: one chart + three number cards.
**Consequence:** the "two layers that disagree" criticism is fixed upstream. ERPNext converged on one sidebar per module — the shape the hub already has.

### `keep_closed` — ERPNext's own opinion on daily vs occasional
Open by default: **Setup, Receivables, Payables, Payments, Banking, Financial Reports, Ledgers**. Collapsed: Opening & Closing, Taxes, Budgeting, Share Management, Subscriptions, Reports, Settings, Invoicing, Banking Setup, Dunning, Registers, Profitability, Other Reports.

### The Accounts sidebar, verbatim
```
Home → Workspace: Accounting
▾ Setup: Chart of Accounts · Chart of Cost Centers · Account Category · Accounting Dimension · Currency · Currency Exchange · Finance Book · Mode of Payment · Payment Term · Journal Entry Template · Terms and Conditions · Company · Fiscal Year
▸ Opening & Closing: COA Importer · Opening Invoice Tool · Accounting Period · FX Revaluation · Period Closing Voucher
▸ Taxes (8) · ▸ Budgeting (2) · ▸ Share Management (2) · ▸ Subscriptions (3) · ▸ Reports (5) · ▸ Settings (2)
▸ Invoicing: Home · Dashboard
▾ Receivables: Customer · Sales Invoice · Credit Note · Accounts Receivable
▾ Payables: Supplier · Purchase Invoice · Debit Note · Accounts Payable
▾ Payments: Payment Entry · Journal Entry · Payment Request · Payment Order · Payment Reconciliation · Unreconcile Payment · Process Payment Reconciliation · Repost Accounting Ledger · Repost Payment Ledger · General Ledger · Trial Balance · → Financial Reports · Home · Dashboard
▾ Banking: Bank Clearance · Bank Reconciliation · Reconciliation Statement
▸ Banking Setup: Bank · Bank Account · Bank Account Type · Subtype · Bank Guarantee · Plaid Settings
▸ Dunning (2)
▾ Financial Reports: Balance Sheet · Profit and Loss · Cash Flow · Consolidated Report · Custom Financial Statement · Financial Report Template
▾ Ledgers: Customer Ledger · Supplier Ledger
▸ Registers (6) · ▸ Profitability (4) · ▸ Other Reports (7)
```
By kind: **19 documents, 34 masters, 5 tools, 3 settings, 34 reports, 6 jumps = 101.** One-third masters, one-third reports, one-fifth documents — built for the configurer, not the month-end.

### The Assets sidebar, verbatim — the best-shaped one
```
Home · Dashboard
Asset · Depreciation Schedule · Asset Capitalization · Asset Movement     (4 ungrouped primary documents)
▸ Maintenance: Team · Maintenance · Log · Asset Value Adjustment · Asset Repair
▸ Reports: Fixed Asset Register · Asset Depreciation Ledger · Depreciations and Balances · Maintenance · Activity
▸ Setup: Item · Asset Category · Location · Settings
```
There is no Payables/Receivables/Financial-Reports *workspace*; they are sections.

### Menu coverage still bad — 28 doctypes and 19 reports homeless
Homeless submittables: `Bank Transaction`, `Cashier Closing`, `GL Entry`, `Payment Ledger Entry`, `Account Closing Balance`, POS Opening/Closing Entry, … Homeless tools: **`Bank Statement Import`**, **`Bank Transaction Rule`**, `Ledger Health`, `Ledger Merge`, `Payment Terms Template`, `Process Statement Of Accounts`, `Cheque Print Template`. Homeless reports: `Payment Ledger`, `Voucher-wise Balance`, `Invalid Ledger Entries`, `General and Payment Ledger Comparison`, `Account Balance`, `Consolidated Trial Balance`, `Bank Clearance Summary`, `Cheques and Deposits Incorrectly cleared`, …
**Lesson:** our rule (menu entry and route are one artefact; `routes.tsx` fails the build) is the thing to keep.

### The manual's chapter tree
Introduction (incl. **Accounting Workflows by Business Type**) · Accounting Setup · **Migration and Opening Balances** (10 pages) · Sales and Receivables · Purchase and Payables · Banking and Payments (incl. *Special Payment Scenarios*: Stale Cheque · Capital Account · **Book Petty Cash Entry** · Invoice Discount · Advance in Separate Party Account · Additional Charges · **Post Dated Cheque Entry** · Customer-deducted TDS; *Reconcile Payments and Banks*) · General Ledger, Journals and Adjustments (incl. **Inter Company Journal Entry**, Immutable Ledger, **Common Party Accounting**) · Taxes · Deferred · Multi Currency · Accounting Segments · Budgets, Capital and Equity · Reports · **Period Closing** · Help · Assets.

## 2. Doctypes and reports, marked for this retailer
### 2.1 The 31 submittable accounts doctypes
KEEP/HAVE: Journal Entry · **Payment Entry** (Receive/Pay/Internal Transfer — ours is one-directional) · Purchase Invoice · Bank Transaction · **Payment Ledger Entry** (separate party book) · **Period Closing Voucher** (+ Process) · **Unreconcile Payment**, Process Payment Reconciliation · **Repost Accounting/Payment Ledger**.
KEEP THE IDEA, NOT THE DOCTYPE: POS Invoice / POS Opening/Closing Entry / Merge Log / **Cashier Closing** — the bridge from till to books = our G1 `SALE_DAY`.
DIVERGE: `Account Closing Balance` (they store; we recompute).
NOISE: Sales Invoice, Exchange Rate Revaluation, Budget (blocks submission), Dunning, Invoice Discounting, Bank Guarantee, Deferred, Subscription, Share Transfer.
### 2.2 The 49 masters/tools
Need (10 masters): Account · Account Category · Bank · Bank Account · Fiscal Year · Mode of Payment · Payment Term · Payment Terms Template · Journal Entry Template · Accounting Period. Need (4 tools): COA Importer · Opening Invoice Creation Tool · Bank Reconciliation Tool · Payment Reconciliation. Integrity (3): Ledger Health (+Monitor) · Ledger Merge · Bisect. Intake (2): Bank Statement Import · Bank Transaction Rule.
Noise (30): Accounting Dimension(+Filter), Cost Center, currencies, Finance Book, Bank Account Type/Subtype/Balance, Cheque Print Template, Payment Gateway, Party Link, Statement of Accounts, Dunning Type, Monthly Distribution, shares, subscriptions, all 8 tax objects, Terms and Conditions, plus 7 that are Commercial's (POS Profile, Pricing Rule, Promotional Scheme, Loyalty Program, Loyalty Point Entry, Coupon Code, Shipping Rule) — linked from Selling sidebar, a module/menu split to copy in reverse.
### 2.3 What a "tool" is
`issingle: 1` + `hide_toolbar: 1` = tool. `Payment Reconciliation` is `issingle` **AND `is_virtual`** — nothing stored. Machine-checkable document/tool distinction. (Correction: it is not submittable.)
### 2.4 The 52 reports
Relevant now: Balance Sheet · P&L · Cash Flow · Trial Balance · General Ledger · **Payment Ledger** · Accounts Payable (+Summary) · **Bank Reconciliation Statement** · **Voucher-wise Balance** · **Invalid Ledger Entries** · **Account Balance** · Purchase Register · Supplier Ledger Summary · **Trial Balance for Party** · Consolidated Financial Statement · Consolidated Trial Balance. Later: AR ageing, General and Payment Ledger Comparison, Financial Ratios, Cheques and Deposits Incorrectly cleared, Gross Profit (needs G2), Received/Billed Items To Be Billed (GRNI — we have none). Noise: VAT/TDS, shares, budget, deferred, sales registers, POS Register, dimension-wise, …
### 2.5 Assets module (26 doctypes)
Relevant: Asset, Asset Category, Asset Depreciation Schedule, Asset Capitalization (CIP accumulator), Asset Movement, Asset Value Adjustment, Location, Fixed Asset Register, Asset Depreciation Ledger. Noise: Maintenance Team/Log/Repair (GA's), Shift Allocation/Factor.

## 3. Mechanisms
### 3.1 Journal Entry types — 18 values, and the type changes validation
`Bank Entry` → cheque_no AND cheque_date mandatory; `Inter Company Journal Entry` → mirror-total validation; `Periodic Accounting Entry` → skips stock-account guard; `Opening Entry` ↔ `is_opening`. `Journal Entry Template` = saved skeleton for recurring accruals. **For us:** ~9 types, each must earn its place by changing a rule.
### 3.2 Payment Entry
`payment_type`: **Receive · Pay · Internal Transfer** (closes G5/G6 with one enum). Party = `party_type` + `party` (dynamic) + `party_name`. `paid_from`/`paid_to` both Accounts. **References[]** child: reference doc, due_date, outstanding, **allocated_amount**, payment_term — one payment settles many bills. `unallocated_amount` legal → advance. **Deductions[]** child: account, amount, description — bank charges, rounding, withholding, discounts as extra legs on the payment itself (**home for acquirer MDR**). `reference_no`+`reference_date` mandatory when a leg is Bank; `clearance_date` read-only.
### 3.3 Payment Reconciliation vs Bank Reconciliation — two different jobs
Payment Recon: which invoice does this payment settle (virtual single, per party; changes outstanding; no bank movement; undo = Unreconcile Payment doc; batch = Process Payment Reconciliation; FIFO auto). Bank Recon Tool: which voucher does this statement line match (per bank account; sets clearance_date; unmatch → NULL; Auto Reconcile batches of 1,000; rank ref+amount+party+unallocated+1). **We need both; we have only the second.**
### 3.4 Period close — four distinct mechanisms
1. `Fiscal Year` master. 2. **`Accounting Period`** — submittable, with `exempted_role` and a `closed_documents` child (document_type, closed) — a *selective* lock. 3. Freeze — `Company.accounts_frozen_till_date` + `role_allowed_for_frozen_entries` (v17: moved from Accounts Settings to Company); per-Account `freeze_account`. 4. **`Period Closing Voucher`** — submittable, `closing_account_head`, `gle_processing_status` + `error_message`; on submit **posts** entries reversing every P&L balance into the closing equity account, per accounting-dimension combination (unconditional in v17); doesn't touch BS, doesn't block backdated entries; a second voucher moves only the remainder. `Account Closing Balance` = stored snapshot (we refuse). **Our G7 needs #4.**
### 3.5 Cost Center / Accounting Dimension — their answer to per-store, and why we don't need it
Cost Center tree; Accounting Dimension adds a field to every transaction and report. Docs: "Creating separate … accounts for every product and region would make its Chart of Accounts enormous." **The client's chart does exactly that, and the client wins.** Unit is in the account code; `site_id` on every journal line is our one dimension. Consequences: Cost Center, Accounting Dimension, Dimension Filter, Cost Center Allocation, Distributed Cost Center, Budget-by-cost-center are all redundant — not in the menu. Per-unit P&L is a filter on account prefix. Cost: a second axis later means re-cutting the chart.
### 3.6 Opening Invoice Creation Tool
Bulk-creates *open* invoices at cutover so AP has real documents with due dates, not a lump journal. Inside a 10-page Migration chapter — cutover is first-class (our lane D `opening.rs`).
### 3.7 Accounts Settings — ~60 fields
Policy ones: `enable_immutable_ledger`, `book_asset_depreciation_entry_automatically`, `submit_journal_entries`, `over_billing_allowance` + `role_allowed_to_over_bill`, `credit_controller`, `check_supplier_invoice_uniqueness`, `auto_reconcile_payments`/`enable_party_matching`/`enable_fuzzy_matching`, `default_ageing_range`. **Copy:** a setting that names a Role. **Refuse:** `Company` carries 30+ `default_*_account` fields — exactly what `account_map` replaces.
### 3.8 Mode of Payment
`type`: Cash · Bank · General · Phone; child table of per-Company default account. Take the master (5 values hard-coded today at `payments.rs:562`); **do not take the default-account child** — account comes from `account_map`.
### 3.9 Cash Flow — `Cash Flow Mapping` is dead
Replaced by **`Financial Report Template`** (fixtures: IFRS BS/P&L/Cash Flow, horizontal, ratios, `account_categories.json`) + master **`Account Category`** (`Account.account_category`) + report `Custom Financial Statement`. **Resolves our §8 tension**: saved named template ≠ free query. `Account Category` = a tag on the account for statement roll-up — worth far more for 7,528 accounts.
### 3.10 General Ledger filters (26), AR/AP ageing, Trial Balance for Party
GL: `categorize_by` (Voucher / Voucher Consolidated / Account / Party) replaces four reports; `ignore_err`, `ignore_cr_dr_notes` hide system-generated entries — we'll need that once SALE_DAY posts 13 stores × 365 days. Ageing: `range` free-text default "30, 60, 90, 120" (buckets are data), `based_on_payment_terms` (age each instalment — matters with 0202), `show_future_payments`. **Trial Balance for Party**: rows are parties, opening/debit/credit/closing, reconciled to control account — high value, cheap, we don't have it.
### 3.11 Inter-company — and why it does not fit
Inter Company Journal Entry (two JEs linked, `A.total_debit == B.total_credit` enforced), Internal Customer/Supplier, Party Link — all assume separate `Company` records. HO + 13 stores = one entity, one ledger; two legs = two rows of one journal. **Take the invariant (equal and opposite, owned by one document) and the naming (Due from / Due to \<unit\>); not the machinery.** Internal Transfer payment type = store-cash-to-HO-bank.
### 3.12 Assets, depreciation, CWIP
`Asset`: item_code, category, location, custodian, `asset_type` (Existing/Composite/Component), 10-value status. `Asset Category`: per-Company accounts incl. **`capital_work_in_progress_account`**, `enable_cwip_accounting`. `Asset Finance Book`: method (SL/DDB/WDV/Manual), periods, frequency, salvage, `daily_prorata_based`. **CWIP**: purchase posts to CWIP; at `available_for_use_date` `Dr Fixed Asset / Cr CWIP`, idempotent (checks GL first). **`Asset Depreciation Schedule` is a submittable document** with a journal link per row; amend → new schedule. `Asset Value Adjustment` regenerates the schedule. Take (a) stored schedule with journal per row, (b) CWIP as per-category account + dated switchover, (c) Value Adjustment as a document. Reject Asset Maintenance* (GA). **OE replacement reserve has no ERPNext analogue** — stays ours, needs a named periodic document.
### 3.13 Expense Claim & Employee Advance (in `hrms`)
Expense Claim: `expense_approver`, lines with `amount` vs **`sanctioned_amount`**, advances[], `total_claimed` vs `total_sanctioned` vs `total_advance` vs `total_reimbursed`. Employee Advance: `advance_amount`/`paid`/`claimed`/`return_amount`/`pending`, `repay_unclaimed_amount_from_salary`, status incl. **Returned**. Useful: claimed-vs-sanctioned as two stored amounts; advance→claim→settle ladder with Returned + payroll recovery — the shape for store-head personal loans.
### 3.14 Loan — separate `frappe/lending`, 71 doctypes. **Do not model it.** A loan = liability account + repayment schedule + periodic journal splitting principal/interest.
### 3.15 Petty cash — no feature; a procedure in the manual
"Create a dedicated Petty Cash account · transfer from bank · record each expense · reconcile physical cash + receipts to ledger · post approved adjustment only when explained." **We are ahead:** `Cash Counts` (0216) is that step, with denominations and a reason-gated variance. Replenishment = Internal Transfer payment restoring the float, amount *derived* from receipts since last replenishment.

## 4. Principles worth copying
### 4.1 Four kinds of thing, and the kind is in the data
**Document** (`is_submittable`: docstatus, posts on submit, reverses on cancel) · **Report** (read-only, never a mutation) · **Tool** (`issingle`+`hide_toolbar`, no stored record, effect on other documents) · **Setting** (`issingle`). **Adopt the four-way vocabulary in `nav.ts`** — every item declares its kind.
### 4.2 Every posting comes from a submitted document
`GL Entry` has no menu entry anywhere. The set of things that can cause an entry = 31 submittables, enumerable and testable. Ours = `source_kind` + posting rules. Corollary: a document that fails to post says so on the document (`gle_processing_status` + `error_message`, `depr_entry_posting_status`).
### 4.3 Cancellation is reversal; amendment is a new document
`docstatus 2`, GL reversed not deleted; amend → `amended_from`. **Amending blanks `clearance_date`** — derived facts must not survive correction of the fact they derive from. Ours: `bank_line_match`, and `cleared_line_id` when giro lands.
### 4.4 The party concept
`party_type` + `party` + `party_name` (denormalised). `Payment Ledger Entry` is a separate book so ageing isn't recomputed from GL. We renamed to **counterparty** (0214) — spread it to bills and payments.
### 4.5 Naming and shape
Menu items are **objects, never verbs**. Group headings are nouns. Duplication is deliberate (one object, many homes). Cross-module jumps are menu items. Stable sidebar shape: entry → ungrouped primary documents → domain groups → Setup → Reports at the foot. `keep_closed` says which groups are daily.
### 4.6 From v17
A saved report template is a first-class object; a free query is not. **Filters are the extension point, not menu items** (26 GL filters, free-text ageing range, `categorize_by`).

## 5. Recommendation — a Finance menu in the ERPNext direction, trimmed to this client
### 5.1 Five things ERPNext's shape gets wrong here
1. Cost Center / Accounting Dimension redundant (unit in account code). 2. No sales invoicing — what needs a home is the **bridge** (till day, acquirer settlement) = their POS Closing Entry / Cashier Closing. 3. Affiliate pair is not inter-company (one entity). 4. Stores do not pay — Payment Entry is an HO document; store money screens are three: petty cash spend, cash count, cash deposit. 5. `clearance_date` is the wrong model for 30–90 day giro. Also: don't take `Company.default_*_account`.
### 5.2 The menu — 14 top-level rows
```
FINANCE
 1  Overview                 one chart + 3 number cards (money position · overdue bills · unmatched)
    ── primary documents, no heading ──
 2  Supplier bills           ≡ Purchase Invoice. Tabs: Open · All · Draft
 3  Payments                 ≡ Payment Entry. Pay · Receive · Internal transfer; references[]; deductions[]
 4  Journal entries          ≡ Journal Entry, ~9 voucher types
    ── domain groups ──
 5  ▾ Cash & Bank            Cash · Cash counts · Banks · Bank accounts · Bank transactions · Bank reconciliation
 6  ▾ Giro                   Giro register (ISSUED→DELIVERED→DUE→CLEARED|REJECTED) · Giro printing
 7  ▾ Receivables            Sales days (G1) · Settlements (G9) · Charges without a sale · Member & staff
 8  ▾ Inter-unit             Inter-unit transfer (owns both legs) · Due from / Due to (report)
 9  ▾ Assets                 Assets · Asset categories · CIP · Depreciation schedules · Movements & disposals · OE replacement reserve
10  ▾ Payroll                Payroll postings (accrual → payable → payment) · Advances & claims
11  ▾ Opening & Closing      Accounting periods · Period closing · Opening balances · Chart importer
12  ▾ Integrity   [closed]   Ledger health · Invalid entries · Reposts
13  ▾ Reports                Balance sheet · P&L · Cash flow · Trial balance · General ledger · Payment ledger · AP ageing · AR ageing · Trial balance by counterparty · Bank reconciliation statement · Per unit / HO / consolidated
14  ▾ Setup       [closed]   Chart of accounts · Account map · Account categories · Modes of payment · Payment terms · Finance settings
```
### 5.4 Deliberately absent
Taxes · Budgeting · Shares · Subscriptions · Multi-currency · Deferred · Dunning · Invoice Discounting · Bank Guarantee · Plaid · Bank Account Type/Subtype · Cheque Print Template · Cost Center & every dimension screen · Customer / Sales Invoice / Credit Note / sales registers · Loan · Asset Maintenance/Repair/Shift · Finance Book · Terms and Conditions · `Company.default_*_account`. ~60 of ~101 rows removed.
### 5.5 Three cheap wins
1. **Trial Balance for Party** (one query). 2. **Bank Reconciliation Statement** outstanding-items bridge (we already compute the difference at `statements.rs:679`). 3. **`deductions[]` on the payment** — MDR, bank charges, rounding as legs of the causing document.

## 6. Corrections to make in existing repo docs
1. `erpnext-reference.md` §3 "two layers that disagree" — stale since `2a14b5d953`. 2. §2 counts — now Dock (17) → Sidebar (17) → Workspace; Accounts Sidebar 121 items. 3. §5 — Payment Reconciliation is not submittable. 4. §8 tension — resolved upstream (Financial Report Template + Account Category). 5. `Accounts Frozen Upto` moved to `Company`; Cash Flow Mapping no longer exists. 6. PCV posts per dimension unconditionally. 7. Technique: append `.md` to any docs.frappe.io URL.
