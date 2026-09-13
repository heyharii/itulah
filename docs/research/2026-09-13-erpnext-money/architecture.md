# ERPNext Accounting — the architecture: layers, document graph, posting pipeline

Sources: local clone `~/Documents/reference-erp/erpnext` `develop` @ `0849f187e7` (17.0.0-dev), `frappe/hrms`, docs.frappe.io. Companion to report-E (menu). Payment Entry only as a node.

## 0. The one-sentence shape
> A **submitted document** hands a **list of dicts** to one module-level function, which validates, reshapes and merges the list, then inserts each surviving row as its own **submittable GL Entry document** — and separately mirrors the receivable/payable rows into a second book.

1. v17 grew a service layer: `accounts/services/` (12 modules), `stock/services/` (5). GL composition = `BaseGLComposer` → `BaseStockGLComposer` → ten `*GLComposer` classes.
2. **Books are balanced in Python, not in the DB.** `process_debit_credit_difference` *plugs* a residual (≤ 0.5 currency units for non-JE/PE vouchers) into a Round Off account instead of refusing.

## 1. Layers
### 1.1 Masters & configuration
- **Company** — the book; **38 `Link→Account` fields** (account-of-last-resort layer); `accounts_frozen_till_date` + `role_allowed_for_frozen_entries`; `enable_perpetual_inventory`; `round_off_cost_center`.
- **Account** — tree; `is_group`, `root_type`, `report_type`, **`account_type`** (35 values: Bank, Cash, Payable, Receivable, Stock, Stock Received But Not Billed, Capital Work in Progress, Depreciation, Round Off, Temporary, …), `freeze_account`, `balance_must_be`, `account_category`. **`account_type` is ERPNext's nearest thing to our `semantic_key` — but a tag on the account, not a lookup that returns one.**
- **Account Category** — tag consumed only by Financial Report Template.
- **Cost Center** — tree; mandatory on every P&L GL Entry. **Cost Center Allocation** splits at posting time.
- **Accounting Dimension** — custom field on every transaction, GL Entry and PLE; per-company `offsetting_account` + auto balancing entry. **Accounting Dimension Filter** = mandatory/restricted per account.
- **Fiscal Year**; **Accounting Period** (NOT submittable in v17; `closed_documents` child (document_type, closed) + `exempted_role` = selective lock).
- **Mode of Payment** — type Cash/Bank/General/Phone; child `Mode of Payment Account` (company → default_account) = the account behind a tender.
- **Payment Term / Template** → `Payment Schedule` rows → `GL Entry.due_date` → ageing.
- **Party** — `party_type` + `party` (DynamicLink) + `party_name`; child `Party Account` (company, account, advance_account) on party and on Customer/Supplier Group.
- **Bank / Bank Account**; **Asset Category** (child per company: fixed_asset, accumulated_depreciation, depreciation_expense, capital_work_in_progress, receivable; `enable_cwip_accounting`, `non_depreciable_category`).
- **Item / Item Group / Brand** — child `Item Default` per company: income, expense, cogs, inventory, provisional, discount, deferred accounts, cost centers.
- **Warehouse** — tree; `.account` = inventory account under perpetual inventory.
- **POS Profile** — income/expense/write-off/change accounts, child `POS Payment Method`.

### 1.2 Transactional documents (is_submittable)
accounts 31 · assets 8 · stock 17. **GL Entry, Payment Ledger Entry, Advance Payment Ledger Entry, Account Closing Balance are themselves submittable documents** (a ledger row has a docstatus; `make_entry()` ends in `gle.submit()`).
**Documents that reach `make_gl_entries`:** Sales Invoice, Purchase Invoice, Journal Entry, Payment Entry, Period Closing Voucher, Invoice Discounting, Process Deferred Accounting, Tax Withholding Entry, Repost Accounting Ledger · Purchase Receipt, Delivery Note, Stock Entry, Stock Reconciliation, Landed Cost Voucher · Asset (CWIP switchover), Asset Capitalization, Asset Repair · Expense Claim (direct), Payroll Entry (via JE).
**Submit but post nothing:** POS Invoice (queued sale), POS Opening/Closing Entry, POS Invoice Merge Log, Bank Transaction (statement fact; allocates + sets clearance_date), Cashier Closing, Asset Movement, Salary Slip, orders/quotations.

### 1.3 Controllers & the posting pipeline
Class chain: `TransactionBase` → `AccountsController` → `StockController` → Buying/SellingController → doctype. Composer chain: `accounts/services/base_gl_composer.py` free functions `get_gl_dict`, `add_gl_entry` + 10 `*GLComposer.compose()`.
```
1 document.validate()  AccountsController.validate(): fiscal year, supplier not blocked, InternalTransferService,
   validate_against_voucher_outstanding, TaxService, calculate_taxes_and_totals, PaymentScheduleService, PartyValidator,
   set_advances, DeferredAccountingService, pricing rule, dimension company
2 on_submit(): update_stock_ledger() → SLE; make_gl_entries(); repost_future_sle_and_gle()
3 get_gl_entries() → <Doctype>GLComposer.compose(): every row via get_gl_dict (company, posting_date, fiscal_year,
   voucher_type/no, is_opening, project, voucher_detail_no, voucher_subtype, every Accounting Dimension, currency triples,
   against_voucher)
4 general_ledger.make_gl_entries(gl_map, cancel, adv_adj, merge_entries, update_outstanding, from_repost):
   BudgetValidation · make_acc_dimensions_offsetting_entry · validate_accounting_period · validate_disabled_accounts ·
   process_gl_map (cost-center allocation split, merge_similar_entries, toggle_debit_credit_if_negative) ·
   create_payment_ledger_entry (skipped for PCV) · save_entries; len==1 → throw
5 save_entries(): validate_cwip_accounts · process_debit_credit_difference (allowance 5/10^precision JE&PE, else 0.5;
   > allowance → throw; ≥ 1/10^precision → make_round_off_gle PLUG to Company.round_off_account) ·
   check_freezing_date · validate_against_pcv · per entry validate_allowed_dimensions → make_entry()
6 make_entry(): frappe.new_doc("GL Entry").update(args).submit(); validate_expense_against_budget
7 GL Entry.validate(): fiscal year, pl_must_have_cost_center, check_mandatory (Receivable ⇒ Customer, Payable ⇒ Supplier;
   zero debit AND credit refused), cost center, party, currency. on_update: not group, company, balance_must_be,
   frozen account, update_outstanding_amt on against_voucher. autoname = 10-char hash.
8 on_cancel(): remove_from_bank_transaction, cancel exchange/common-party journals, unlink_ref_doc_from_payment_entries,
   make_reverse_gl_entries
9 make_reverse_gl_entries(): SELECT ... FOR UPDATE; immutable OFF (default): originals UPDATE is_cancelled=1, reversal
   dated ORIGINAL date; immutable ON: originals untouched, reversal dated TODAY; deep-copy, swap debit/credit.
```
Merge key: account, cost_center, party(_type), voucher_detail_no, against_voucher(_type), project, finance_book, voucher_no, advance_voucher + every dimension. `accounts/services/gl_validator.py`: "assert that an assembled list of GL entries is legal to post … balancing and round-off live with the posting sink".
Other: `accounts/utils.py` (2901 ll.; reconcile_against_document, PLE create/delink, QueryPaymentLedger, repost, `pre_submit_validation` preview_mode), `party.py` (get_party_account…), `deferred_revenue.py`, `repost_accounting_ledger` (submittable, `generate_preview()` dry run), `ledger_health`.

### 1.4 Ledgers
| Ledger | Written by | Mutable? | Read by |
|---|---|---|---|
| GL Entry | make_entry() only | never edited except is_cancelled=1 (not even that when immutable); deleted by repost / delete_linked_ledger_entries | GL, TB, BS, P&L, CF, Consolidated, TB for Party, Voucher-wise Balance, Invalid Ledger Entries |
| Payment Ledger Entry | create_payment_ledger_entry from the same gl_map — only Receivable/Payable accounts; sign-normalised | delinked=1 (or fresh row when immutable) | AR/AP (+Summary), Payment Ledger, GL-PLE Comparison, Payment Reconciliation |
| Advance Payment Ledger Entry | get_advance_ledger_entry | delink | advance tracking on orders |
| Stock Ledger Entry | StockLedgerService | recomputed in place by Repost Item Valuation | Stock reports, Gross Profit; repost_gle_for_stock_vouchers |
| Account Closing Balance | PCV snapshot per (date, account, cost_center, project, finance_book), P&L AND BS | deleted on PCV cancel | TB, BS opening shortcut unless ignore_account_closing_balance |
| Depreciation Schedule rows | Asset; each row gets journal_entry link | parent amended → new schedule | asset reports |
| Stock Closing Balance | Stock Closing Entry | regenerated | stock reports; PCV precondition |
Two immutable-ish money ledgers, one recomputed, two snapshots.

### 1.5 Tools (issingle + hide_toolbar)
Bank Reconciliation Tool (matches; can CREATE JE/PE/internal transfer; clearance_date; auto_reconcile) · Payment Reconciliation (issingle + is_virtual: nothing stored) · Opening Invoice Creation Tool · COA Importer · Bank Clearance · Bisect Accounting Statements (binary-search the day the BS stopped balancing) · Ledger Health Monitor → Ledger Health rows · Ledger Merge · Bank Statement Import. **Documents, not tools:** Repost Accounting/Payment Ledger, Unreconcile Payment, Process Payment Reconciliation, Process PCV, Process Deferred Accounting.

### 1.6 Reports — which ledger each reads
GL Entry: General Ledger, P&L, Cash Flow, Consolidated, Voucher-wise Balance, TB for Party · PLE: AR, AP, summaries, Payment Ledger · GL+ACB: Trial Balance, Balance Sheet · documents: Bank Reconciliation Statement, Account Balance, POS Register · SLE: Gross Profit · both GL+PLE: Invalid Ledger Entries, GL-PLE Comparison. Template layer: Financial Report Template + Financial Report Row + Account Category + Custom Financial Statement (fixtures IFRS BS/P&L/CF, horizontal, ratios).

### 1.7 Settings
Accounts Settings: **66** non-layout fields (enable_immutable_ledger, book_asset_depreciation_entry_automatically, submit_journal_entries, over_billing_allowance + role, credit_controller, check_supplier_invoice_uniqueness, auto_reconcile_payments/party/fuzzy, delete_linked_ledger_entries, ignore_account_closing_balance, default_ageing_range, repost_allowed_types, preview_mode…). Company: 38 Account fields = ERPNext's account map, no location axis. POS Settings: `invoice_type` default **Sales Invoice** (POS Invoice only "for high-volume"), `post_change_gl_entries` default 0.

## 2. The document graph
### 2.1 Account-resolution chain — what `account_map` replaces
| Meaning | Chain (first hit wins) |
|---|---|
| Income | Item Default → Item Group → Brand → ctx/POS Profile → Company.default_income_account |
| Expense/COGS | Item.default_cogs_account → Group → Brand → Company.default_expense_account |
| Inventory item-wise | Item → Group → Brand → throw |
| Inventory warehouse-wise | Warehouse.account → ancestor → Company.default_inventory_account → **the single Account with account_type Stock, if exactly one** → throw |
| Party | Party Account (party, company) → group → Company.default_receivable/payable → currency fallback |
| Bank/Cash | Mode of Payment Account (throws if unset) → Company.default_bank/cash → **the single Account of that type** → {} |
| Asset | Asset Category Account → Company.<name> → throw |
| Depreciation | Asset Category (fixed_asset mandatory) → Company |
| GRNI | Company.stock_received_but_not_billed — no override |
| Round off | Company.round_off_account (→ default_expense_account) |
| Cost center | Project → Item/Group/Brand selling/buying → ctx → Company |
**Shape:** meaning implicit in the field name; resolution = a walk that ends in Company; some chains "the only account of this type, if exactly one" — a guess. **No location axis anywhere.** Per-store = Cost Center / Dimension (a second column), not a different account.

### 2.2 Retail money path
**Path A (v17 default):** POS Opening Entry (no GL) → Sales Invoice (is_pos, update_stock) per sale → SLE + GL + PLE → POS Closing Entry (stamps invoices, expected vs closing per MOP, NO GL).
**Path B (high volume):** POS Invoice (submit: loyalty, bundles, status — NO GL, NO SLE) → POS Closing Entry → consolidate_pos_invoices → POS Invoice Merge Log (enqueued; status Draft/Submitted/**Queued/Failed**/Cancelled + error_message + retry()) → consolidated Sales Invoice (is_consolidated) ⇒ GL+SLE; credit notes for returns; cancel path unconsolidates.
**Tenders:** POS Payment Method rows; account = Mode of Payment Account.default_account (throws if unset). **No acquirer settlement, no MDR, no gross-vs-net anywhere.** Only fee concept: `Bank Transaction.included_fee/excluded_fee` at reconciliation. Change: `post_change_gl_entries` off by default.
**Purchase → payment → bank:** PO (no GL) → Purchase Receipt (Dr inventory / Cr stock_received_but_not_billed; CWIP when enabled) → Purchase Invoice (Dr GRNI, Dr tax / Cr party → PLE) → Payment Entry Pay (Dr party / Cr bank; deductions[]) → Bank Transaction (posts NOTHING; allocates; clearance_date). `clear_clearance_date_on_amend()`.
**Asset:** PR/PI with fixed-asset item → Asset rows; CWIP; Asset.on_submit make_gl_entries guarded by validate_make_gl_entry (reads GL, idempotent) Dr fixed_asset / Cr cwip at available_for_use_date; Asset Depreciation Schedule (submittable) → one JE "Depreciation Entry" per row with savepoint per row, `depr_entry_posting_status` Successful/Failed + notify role; Asset Value Adjustment → JE + regenerate; Asset Movement no GL; disposal JE "Asset Disposal".
**Payroll (hrms):** Salary Slip posts nothing; Payroll Entry.on_submit → accrual JE (Dr component accounts / Cr payroll_payable, must be account_type Payable) → payment JE/PE (Dr payable / Cr bank). Expense Claim posts directly (sanctioned_amount, Cr default_expense_claim_payable_account).
**Period close:** Stock Closing Entry precondition; PCV.validate (accounts not frozen, previous year closed, no future PCV, closing account type/currency, stock checks) → on_submit reverses every P&L balance per dimension tuple into closing_account_head, writes Account Closing Balance for P&L AND BS; `gle_processing_status` + `error_message` on the document; afterwards validate_against_pcv blocks anything ≤ max period_end_date.

## 3. What the docs say the module IS
1 "A sale, purchase, stock movement, expense, or payment begins as an operational document and becomes balanced ledger entries when it is submitted." 2 "You do not normally create those entries by hand." 3 Three records: Source document / GL Entry / Payment Ledger Entry (+ SLE). 4 Different jobs per ledger. 5 One document can affect more than one ledger. 6 docstatus is the boundary. 7 Posting Date determines period. 8 Cancellation retains originals and adds opposite rows. 9 Amend, don't edit; Repost "after diagnosis". 10 Immutability justified by FIFO ordering. 11 Repost is expensive and they pay it. 12 "Is immutable ledger a blockchain? No". 13 Perpetual inventory: entry per stock transaction; each warehouse ↔ account. 14 Wrong accounts are a configuration bug: "Review Item, Item Group, Company, and party defaults in their precedence order". 15 Retail = POS Invoice → ledgers; "POS Closing consolidates and reconciles shift activity".

## 4. ERPNext vs ours, layer by layer
| Layer | ERPNext | Ours | Verdict |
|---|---|---|---|
| Where a posting is written | one sink `make_gl_entries`, many mouths (10 composers + Expense Claim + deferred + depreciation building JEs) | `poster.rs:179 post()`, takes caller's `&mut Transaction` | Same idea, ours cleaner + atomic with source doc |
| How an account is chosen | per document from default chains ending in Company; can guess "the only account of this type" | `account_map` key×site×qualifier, unmapped refuses and names the key | **Ours stricter, and ours has the location axis they lack.** Their Item→Group→Brand walk is worth stealing only if per-article accounts are ever needed |
| Nearest thing to semantic_key | `Account.account_type` — tag used backwards | lookup returning an account | Different direction; ours right. **Take `account_category` as a statement-rollup tag over 7,528 accounts** |
| Balance invariant | Python; allowance 0.5 units; residual PLUGGED to Round Off | deferred constraint triggers at COMMIT | Ours stricter. Round-off is a real feature we lack — add as an explicit rule-built line, never a silent plug |
| Append-only vs docstatus | immutability is a setting, off by default, in Python, undone by Repost | `protect_journal` triggers refuse UPDATE/DELETE; `reversal_of` UNIQUE | Ours stricter. **Take: when immutable, reversal dated TODAY, not backdated** — ours can currently reverse INTO a period we'd refuse to post into fresh. Worth a test |
| Reversal accounts | deep-copy stored rows, swap sides, never re-resolve | same | Same, same reason |
| Two ledgers vs one | GL Entry + PLE from same gl_map, kept in sync by hand; two reports exist to find drift | one `journal_line` + `supplier_id` | Ours simpler/safer; theirs faster/richer (against_voucher, due_date per instalment, TB for Party). Our `supplier_payment_allocation` already answers "which bill did this settle" |
| Party | party_type/party/party_name on GL and PLE; Receivable REQUIRES Customer, Payable REQUIRES Supplier | `journal_line.supplier_id` nullable | **Ours missing a check**: refuse a `trade_payable` line with no supplier_id |
| Location / dimension | Cost Center mandatory on P&L; Accounting Dimension + **auto offsetting entry when a voucher spans dimensions** | `site_id NOT NULL` + unit in account code | ERPNext's doesn't fit, except `make_acc_dimensions_offsetting_entry`: **when one entry spans two site_ids the poster should require or generate the affiliate legs** (our G10). Today nothing checks it |
| Period lock | Fiscal Year; Accounting Period `closed_documents` + `exempted_role`; Company freeze + role; PCV blocks backdating | `fiscal_period` OPEN/CLOSED trigger with **FOR SHARE** | Ours stricter at mechanism (they have no FOR SHARE), theirs richer in policy. **Take `closed_documents` + `exempted_role`** (selective lock) |
| Period close as posting | PCV posts P&L → retained earnings per dimension; refuses on preconditions; writes status + error on itself | `close_period` flips status, reads no test (G7) | **Ours missing**: (a) close that posts, (b) close that refuses. **Copy: a document that fails to post says so on itself** |
| Stored balances | Account Closing Balance + Stock Closing Balance; escape `ignore_account_closing_balance` | nothing stored | Deliberate; revisit as a performance decision, keep recompute path |
| Repost | Repost Accounting Ledger (submittable, locks, preview dry run) | none; reversal + rule_version | **What we need is not repost but its dry run** (`generate_preview()`) for reviewing rule changes |
| Integrity | Ledger Health Monitor (debit_credit_mismatch, GL-PLE mismatch), Bisect, Invalid Ledger Entries | 24+8 tests; triggers make mismatch impossible | Half their monitor is moot for us; **Bisect still worth having** (when did a statement start looking wrong = a mapping change) |
| Derived facts on cancel | clear_clearance_date_on_amend, remove_from_bank_transaction, unlink refs | bank_line_match; giro cleared_line_id not yet | Same principle, ours incomplete |
| document/tool/report/setting | in the data | not in nav.ts | Ours missing |
| Retail | POS Invoice = deferred posting queue with Queued/Failed/error_message/retry (opt-in; default is per-sale Sales Invoice) | SALE_DAY never written (G1) | **Ours missing; ERPNext hands us the shape**: a per-store-per-day posting document that can be Queued, Failed with reason, retried |
| Card / acquirer | nothing (one MOP account; included_fee at reconciliation) | G9 open | ERPNext has nothing to copy; our Channel Settlements is ahead. Borrow `deductions[]` + `included_fee` |
| Giro | clearance_date one-shot stamp, no lifecycle | G8 open | ERPNext's doesn't fit |

**Sharpest contrast:** *ERPNext resolves accounts per document from a chain of defaults that can fall back to a guess; we resolve accounts per meaning from a map that refuses. Their invariants are Python and configurable; ours are triggers. Their ledger is a submittable document you can repost; ours is a table you can only append to.*

## 5. Diagram specs — summary
**ERPNext (55 nodes):** masters (Company 38 defaults, Account, Account Category, Cost Center, Accounting Dimension, Fiscal Year, Accounting Period, Mode of Payment, Payment Terms, Customer, Supplier, Employee, Bank Account, Asset Category, Item/Group/Brand, Warehouse, POS Profile) → documents (Sales Invoice, Purchase Invoice, POS Opening/Invoice/Closing/Merge Log, Journal Entry, Payment Entry, Bank Transaction, PCV, Asset, Depreciation Schedule, Capitalization, Movement, Value Adjustment, Purchase Receipt, Delivery Note, Stock Entry, Stock Reconciliation, Stock Closing, Expense Claim, Salary Slip, Payroll Entry) → pipeline (AccountsController, StockController, GLComposer ×10, make_gl_entries, process_gl_map, gl_validator, save_entries, create_ple, reverse_gl) → ledgers (GL Entry, PLE, Advance PLE, SLE, Account Closing Balance) → tools (Bank Recon Tool, Payment Recon, Opening Tool, COA Importer, Bank Clearance, Bisect, Ledger Health, Repost ×2) → reports (GL, TB, BS/P&L/CF, AR/AP, Payment Ledger, Invalid/Comparison, Bank Recon Statement, Financial Report Template) → settings (Accounts Settings, POS Settings, perpetual inventory).
Shape: wide at the top (17 masters → 40 documents), narrow in the middle (one make_gl_entries), fans out into 5 ledgers, 9 tools, 52 reports.
**Ours (30 nodes):** masters (ledger_account, account_map, site, fiscal_period, supplier/counterparty, company_bank_account, payment_terms_template) → documents (supplier_invoice, supplier_payment one-direction, manual journal, fixed_asset, asset_capitalization, asset_depreciation_entry, asset_transfer/disposal, bank_statement, cash_count, edge_sale) → pipeline (poster.post, resolver, reverse, 0051 triggers) → ledgers (journal_entry, journal_line; holes SALE_DAY, STOCK_COUNT, TRANSFER) → tools (bank_line_match, close_period, Account map screen) → reports (statements.rs two read shapes). Narrow top, narrow middle, narrow bottom, three holes drawn as nodes.

## 6. Corrections to report-E
1 Accounting Period is NOT submittable in v17. 2 Accounts Settings = 66 fields. 3 Company = 38 Account fields. 4 **v17 POS default is Sales Invoice per sale; POS Invoice consolidation is opt-in for high volume** — relevant to G1: ERPNext recommends post-per-sale, batch only when volume forces it. 5 New: services layer, GLComposer, Stock Closing Entry as PCV precondition, preview_mode, Bank Transaction included/excluded_fee, item-wise inventory accounts.
