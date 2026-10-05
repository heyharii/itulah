# Finance → ERPNext, screen by screen

Owner, 2026-09-28: *"tiru erpnext … rapikan tiap menu seperti erpnext, bahkan erpnext ada chartnya … cek jg input atau yg ditampilin erpnext per menu."*

Source of truth: `frappe/erpnext`, branch **`version-16`** — `erpnext/workspace_sidebar/*.json` (menu), `accounts/workspace/invoicing` + `accounts_dashboard/accounts` (workspace, charts, number cards), `*/doctype/<name>/<name>.json` (list columns = `in_list_view`, list filters = `in_standard_filter`, form = `field_order`), `accounts/report/<name>/<name>.js` (report filters).

## Rules

1. **Menu** is a plain menu → sub-menu list, no sidebar switcher (owner, 2026-09-29). Its groups are ERPNext Accounting's as the v15 demo draws them: Payables, Receivables, Payments, Banking, Financial Reports, Tax Masters, Accounting Masters. It uses ERPNext's labels and lists only ERPNext's rows. Our own screens (Card & EDC, Petty Cash, Loans, Tax Payables, month-end, assets, account-link setup) are `more: true`: routed and in ⌘K, not drawn while the More fold is off (`src/screens/finance/nav.ts`).
2. **Every screen takes one of ERPNext's three formats** — no screen-specific layouts:
   - **Workspace** — chart, number cards, "Reports & Masters" link cards. (Home, Dashboard.)
   - **List → Form** — for every document and master. List: title column with a status indicator, the `in_list_view` columns, the `in_standard_filter` fields as one row of inline filters above the table, "20 of N" and page size at the foot, one primary button "Add <Doctype>". Form: header with the name and status, Save/Submit, tabs, sections with two or three columns, child tables as grids with the child's `in_list_view` columns.
   - **Report** — the report's filters in one row, a chart on top when ERPNext draws one, then the table (a tree for financial statements).
3. **Inputs are ERPNext's, in ERPNext's order.** A field we do not store is left out, not faked. A field we have that ERPNext does not goes at the end of the section it belongs to.
4. **Hub look stays** (tokens, 14px minimum, no chip rows, English labels). ERPNext's *structure*, the hub's *surface*.
5. No dev notes on a screen, no "Finance final · …" eyebrows, no Indonesian titles (printed documents stay Indonesian).

## Status

| Sidebar › Row | ERPNext format | Screen | State |
|---|---|---|---|
| Invoicing › Home | Workspace | `finance/overview` | **done** — P&L chart, 3 of 4 number cards, Reports & Masters |
| Invoicing › Dashboard | Dashboard | `finance/dashboard` | **done** — 4 of 7 charts |
| Payments › Dashboard | Dashboard | `finance/dashboard` (`PaymentsDashboard`) | **done** — 3 of 5 charts |
| Profit and Loss Statement | Report | `finance-final/reports/profit-and-loss` | **done** — Periodicity, Accumulated Values, summary, bar/line chart; client's layers kept |
| Balance Sheet | Report | `finance-final/reports/balance-sheet` | **done** — period columns as at each period end, 4-figure summary, chart |
| Cash Flow | Report | `finance-final/reports/cash-flow` | **done** frame — still direct method (no activity classification on accounts) |
| Accounts Payable | Report | `finance-final/payable` | **done** — Group By Supplier, ageing chart, ERPNext column order |
| AP Summary | Report | `finance-final/payable` (`AccountsPayableSummary`) | **new** |
| Accounts Receivable | Report | `finance-final/receivable` | **done** frame — no ageing (no due dates on card settlement) |
| General Ledger, Trial Balance | Report | `finance-final/reports/*` | **done** frame — dev notes and duplicate cards removed |
| Banking › Bank Clearance | Form | `finance/bank-clearance` | **new** — giros, Clearance Date per row, Update Clearance Date |
| everything else | List→Form | own layouts | to do |

Shared frames: `src/screens/finance/workspace.tsx` (workspace/dashboard pieces), `src/screens/finance/report.tsx` (ReportFilters, PeriodicitySelect, FilterCheck, periodsOf, ReportSummary, ReportChart).

**One backend change unlocks three ERPNext pieces:** `from`/`to` on `GET /api/v1/finance/bills` (`backend/src/cloud/postgres/payables.rs`) → Incoming Bills chart, Purchase Register, Supplier Ledger (with payments by date).

Dashboard charts not drawn yet: **Incoming Bills** (needs `from`/`to` on `GET /api/v1/finance/bills` — `backend/src/cloud/postgres/payables.rs` has no date filter), **Accounts Receivable Ageing** (our receivables are card-scheme settlements, no invoice ageing), **Budget Variance** (no budgets). Number card **Total Incoming Payment** has no source (no customer receipts).

## Per menu — what ERPNext shows

`*` required · `(ro)` read-only · `[grid: …]` child table columns.

### Invoicing

**Chart of Accounts** — ERPNext opens it as a **tree** (with balances when *Show balances in Chart of Accounts* is on). List columns: Account Name, Account Number. Filters: Account Number, Company, Root Type, Report Type, Account Type. Form: Disable, Account Name\*, Account Number, Is Group, Company\*, Root Type (ro), Report Type (ro), Currency ‖ Parent Account\*, Account Category, Account Type, Tax Rate, Frozen, Balance must be. — Ours: `finance/chart-of-accounts` (tabs + table + sheet).

**Receivables › Sales Postings** (ours, in Sales Invoice's place). ERPNext Sales Invoice list: title = Customer Name + status; columns Posting Date, Payment Due Date, Grand Total, Status; filters Company, Customer, Posting Date, Status.

**Receivables › Accounts Receivable** — Report. Filters: Company, Report Date, Party Type, Party, Receivable Account, Ageing Based On (Due Date / Posting Date), Ageing Range (30, 60, 90, 120), Group By Customer, Show Remarks. Columns: Posting Date, Party, Voucher Type, Voucher No, Due Date, Invoiced Amount, Paid Amount, Credit Note, Outstanding, Age (Days), 0-30, 31-60, 61-90, 91-120, 121-Above. Chart: percentage bar by ageing bucket.

**Receivables › Card & EDC Settlement, Employee Advances** (ours) — List→Form.

**Payables › Purchase Invoice** — List: title = Supplier Name + status (Draft, Unpaid, Overdue, Partly Paid, Paid, Return, Debit Note Issued, On Hold, Cancelled); columns Posting Date, Due Date, Supplier Invoice No, Grand Total; filters Supplier, Posting Date, Supplier Invoice No, Status. Form, tab **Details**: Series\*, Supplier\*, Supplier Name (ro), Tax Id (ro) ‖ Posting Date\*, Due Date ‖ Is Paid, Is Return (Debit Note) · *Supplier Invoice*: Supplier Invoice No ‖ Supplier Invoice Date · *Accounting Dimensions*: Cost Center ‖ Project · *Items*: Update Stock, Set Accepted Warehouse, [grid: Item, Accepted Qty\*, Rate\*, Amount\*], Total Quantity ‖ Total ‖ Net Total · *Taxes and Charges*: Tax Category, Purchase Taxes and Charges Template, [grid], Total Taxes and Charges · *Totals*: Grand Total, Rounding Adjustment, Rounded Total, In Words · Total Advance ‖ Outstanding Amount. Tab **Payments**: Mode of Payment, Cash/Bank Account, Paid Amount (when Is Paid); Advances [grid]; Write Off Amount, Write Off Account. Tab **Terms**: Payment Terms Template, Payment Schedule [grid]. Tab **More Info**: Status, Credit To\*, Is Opening Entry, Hold Invoice (Release Date, Reason), Remarks. — Ours: `finance/supplier-bills` (2 669 lines, kinds as tabs Merchandise/Expenses/Dari GA/Unbilled).

**Payables › Accounts Payable** — Report, as Accounts Receivable with Supplier, Payable Account, Supplier Group, Group By Supplier. Chart: percentage bar by ageing bucket.

**Payables › Loans** (ours) — List→Form.

**Payments › Payment Entry** — List: title = party + status (Draft, Submitted, Cancelled); columns Payment Type, Posting Date, Account Paid From, Account Paid To; filters Payment Type, Posting Date, Party Type, Party, Cheque/Reference No. Form: *Type of Payment*: Series\*, Payment Type\* (Receive / Pay / Internal Transfer) ‖ Posting Date\*, Company\*, Mode of Payment · *Payment From / To*: Party Type, Party, Party Name ‖ Company Bank Account, Party Bank Account, Contact · *Accounts*: Account Paid From\* ‖ Account Paid To\* · *Amount*: Paid Amount\* ‖ Received Amount\* · *Reference*: "Get Outstanding Invoices", [grid: Type\*, Name\*, Due Date, Grand Total, Outstanding, Allocated] · Total Allocated Amount, Unallocated Amount, Difference Amount · *Deductions or Loss* [grid] · *Transaction ID*: Cheque/Reference No ‖ Cheque/Reference Date, Clearance Date (ro) · *Accounting Dimensions* · *More Information*: Remarks.

**Payments › Journal Entry** — List: title + status; columns Company, Total Debit; filters Company, Entry Type. Form: Entry Type\* (Journal Entry, Inter Company Journal Entry, Bank Entry, Cash Entry, Credit Card Entry, Debit Note, Credit Note, Contra Entry, Write Off Entry, Opening Entry, Depreciation Entry, Exchange Rate Revaluation, Deferred Revenue/Expense) ‖ Series\*, Posting Date\*, Company\*, Multi Currency · *Accounting Entries* [grid: Account\*, Party Type, Party, Debit, Credit] · Total Debit ‖ Total Credit, Difference · Reference Number, Reference Date, Clearance Date. Tab **More Info**: Bill No, Bill Date, Due Date, Pay To / Recd From, Is Opening, From Template, Remark.

**Payments › Cash Transactions, Petty Cash** (ours) — ERPNext books these as Journal Entry with Entry Type *Cash Entry* / *Bank Entry*. List→Form; consider folding into Journal Entry filtered by Entry Type.

**Reports › General Ledger** — Report, no chart. Filters: Company, From Date, To Date, Account, Voucher No, Party Type, Party, Group by (Voucher / Account / Party), Cost Center, Project, Show Cancelled Entries, Show Opening Entries, Show Remarks. Columns: Posting Date, Account, Debit, Credit, Balance, Voucher Type, Voucher No, Against Account, Party Type, Party, Cost Center, Remarks.

**Reports › Trial Balance** — Report (tree), no chart. Filters: Company, Fiscal Year, From Date, To Date, Cost Center, Project, Show zero values, Show net values in opening and closing columns, Show Group Accounts. Columns: Account, Opening (Dr), Opening (Cr), Debit, Credit, Closing (Dr), Closing (Cr).

**Settings** (Accounts Settings) — one form in tabs: Invoice and Billing, Payments, Credit Limits, Assets, Accounts Closing, Reports, Others; almost all checkboxes. Show only the ones our node honours.

### Financial Reports

**Balance Sheet, Profit and Loss, Cash Flow** — Report. Shared filters: Company, Filter Based On (Fiscal Year / Date Range), Start/End, **Periodicity** (Monthly, Quarterly, Half-Yearly, Yearly), Cost Center, Project; plus Accumulated Values, Show zero values (BS, P&L) or Show Opening and Closing Balance (CF). Chart on top (bar/line over the periods). Table: tree of accounts, one column per period, then Total.

**Ledgers › General Ledger · Registers › AR, AP · Profitability › Dimension Results (ours) · Other Reports › Cash & Bank (ours)** — as above / Report.

### Accounts Setup

- **Accounting Dimension** — List: Dimension Name. Form: Reference Document Type\*, Dimension Name, Dimension Defaults [grid: Company, Default Dimension, Mandatory for Balance Sheet, Mandatory for Profit and Loss].
- **Mode of Payment** — List: Mode of Payment; filter Type. Form: Mode of Payment\*, Enabled, Type (Cash / Bank / General / Phone), Accounts [grid: Company, Default Account].
- **Journal Entry Template** — List: Journal Entry Type, Company; filter Company. Form: Template Title\*, Journal Entry Type\*, Series\* ‖ Company\*, Is Opening, Multi Currency; Accounts [grid].
- **Shop Payment Methods, EDC & MDR, Expense Categories, Line Categories, Pay Components, Account Links, Posting Readiness** (ours) — List→Form.
- **Opening & Closing › Accounting Period** — List: Start Date, End Date, Company, Disabled. Form: Period Name\*, Start Date\*, End Date\* ‖ Company\*, Disabled, Exempted Role; Closed Documents [grid].
- **Opening & Closing › Period Closing Voucher** — List: Fiscal Year; filter Fiscal Year. Form: Transaction Date, Company\*, Fiscal Year\*, Period Start Date\*, Period End Date\* ‖ Closing Account Head\*, GL Entry Processing Status (ro), Remarks\*.
- **Accruals, Prepaids, Period Close** (ours) — List→Form; Period Close keeps its checklist.
- **Settings › Posting Policies, Permissions** (ours) — List→Form.

### Taxes

- **Tax Payables** (ours) — List→Form.
- **Tax Withholding Category** — List: Category Name. Form: Category Name, Deduct Tax On Basis\* ‖ Round Off Tax Amount, Only Deduct Tax On Excess Amount; Rates [grid]\*; Accounts [grid]\*.
- **Tax Types** (ours) — List→Form.

### Banking

- **Bank Reconciliation** (ERPNext Bank Reconciliation Tool) — Form: Company, Bank Account ‖ From Date, To Date ‖ Account Opening Balance (ro), Closing Balance; then the unreconciled bank transactions with Match / Create Voucher per line.
- **Deposits** (ours) — List→Form.
- **Setup › Bank Account** — List: Account Name, Company Account, Company, IBAN, Bank Account No; filters Account Name, Company. Form: Account Name\*, Company Account, Bank\*, Account Type, Account Subtype ‖ Disabled, Is Default Account, Is Company Account, Company · *Account Details*: IBAN ‖ Branch Code, Bank Account No.
- **Setup › Giro Templates** (ours; ERPNext Cheque Print Template) — List→Form.

### Assets

- **Asset** — List: Asset Name, Location, Company, Asset Category, Status; filters Item Code, Company, Asset Category, Status. Form: Series, Item Code\*, Asset Name\*, Location\* ‖ Company\*, Asset Category, Calculate Depreciation · *Purchase Details*: Purchase Invoice, Purchase Date\*, Available for Use Date ‖ Net Purchase Amount, Asset Quantity · Tab **Depreciation**: Finance Books [grid], Depreciation Method, Frequency of Depreciation (Months), Total Number of Depreciations, Depreciation Schedule.
- **Setup › Asset Category** — List: Asset Category Name. Form: Asset Category Name\*; Enable Capital Work in Progress Accounting, Non Depreciable Category; Finance Books [grid]; Accounts [grid]\*.

## Gap list (2026-09-28)

**In ERPNext, not ours** (by sidebar; ≈ = we hold the data somewhere else):
- Invoicing: Customer, Credit Note, Debit Note, Supplier (≈ Buying › Suppliers), Payment Request, Payment Order (≈ payment instructions on the node, `finance-final/payment-instructions.tsx` unrouted), Payment Reconciliation (lab screen, no commit endpoint), Unreconcile Payment, Process Payment Reconciliation, Repost Accounting Ledger, Repost Payment Ledger.
- Payments: Dashboard.
- Financial Reports: Consolidated Report, Custom Financial Statement, Financial Report Template, Customer Ledger, Supplier Ledger, AR Summary, AP Summary (≈ payables ageing per supplier), Sales Register (lab screen), Purchase Register, Item-wise Sales/Purchase Register, Gross Profit, Profitability Analysis (≈ Dimension Results), Sales/Purchase Invoice Trends, Trial Balance for Party, Payment Period Based On Invoice Date, Sales Partners Commission, Customer Credit Balance, Sales Payment Summary, Address And Contacts, UAE VAT 201.
- Accounts Setup: Chart of Cost Centers (≈ units + dimensions), Account Category, Currency, Currency Exchange, Finance Book, Payment Term, Terms and Conditions, Company (≈ System), Fiscal Year, Sales Taxes template, COA Importer, Opening Invoice Tool, FX Revaluation, Currency Exchange Settings, Repost Accounting Ledger Settings.
- Taxes: Sales / Purchase / Item Tax Template, Tax Category, Tax Rule, Tax Withholding Group, Deduction Certificate, TDS Computation Summary, Tax Withholding Details.
- Banking: Bank Clearance (giro clearing), Reconciliation Statement, Unreconcile Payment, Process Payment Reconciliation, Bank, Bank Account Type, Bank Account Subtype, Bank Guarantee, Plaid Settings, Dunning, Dunning Type.
- Budget: Budget, Cost Center, Cost Center Allocation, Budget Variance.
- Share Management (≈ Financing › principals on the node), Subscription: all rows.
- Assets: Home, Dashboard, Depreciation Schedule (≈ per-asset schedule read), Asset Capitalization, Asset Movement (≈ transfer), Maintenance ×5 (≈ GA Maintenance), Fixed Asset Register, Asset Depreciation Ledger, Asset Depreciations and Balances, Asset Maintenance, Asset Activity, Item, Location (≈ GA Locations).

**Ours, not in ERPNext Accounting** (ERPNext's nearest): Sales Postings (POS Closing → consolidated Sales Invoice), Card & EDC Settlement (none), Employee Advances (HRMS Employee Advance), Loans (Lending app), Cash Transactions and Petty Cash (Journal Entry, Cash/Bank Entry), Deposits (none), Tax Payables (GL only), Tax Types (≈ Tax Category), Shop Payment Methods (POS Profile payments), EDC & MDR (none), Expense and Line Categories (none), Pay Components (HRMS Salary Component accounts), Account Links (Company default accounts, Mode of Payment Account…), Posting Readiness (none), Accruals and Prepaids (Deferred Accounting), Period Close checklist (none), Posting Policies and Permissions (Role Permissions), Giro Templates (Cheque Print Template — in ERPNext, not in its sidebar), Dimension Results (Profitability Analysis), Cash & Bank report (none).

**Where ERPNext draws a chart:** Invoicing workspace (P&L line + 4 number cards); Accounts dashboard (P&L, Incoming Bills bar, Outgoing Bills bar, AR Ageing donut, AP Ageing donut, Budget Variance, Bank Balance line + 4 cards); Payments dashboard (the same less P&L and Budget); Assets dashboard; reports **Accounts Receivable** and **Accounts Payable** (percentage bar by ageing bucket), **Balance Sheet** and **Profit and Loss** (bar per period, line when accumulated, plus report-summary figures: Total Asset / Liability / Equity / Provisional P&L, and Total Income / Expense / Net Profit), **Cash Flow** (bar), Consolidated Financial Statement, Budget Variance (bar), Fixed Asset Register (bar). **No chart:** General Ledger, Trial Balance, AR/AP Summary, registers, ledgers, Gross Profit, Profitability Analysis, trends, tax reports, Bank Reconciliation Statement.

## Phases

1. **Workspace** — Home, Dashboard. *Done 2026-09-28.*
2. **List → Form frame** — one shared ERPNext list (inline standard filters, status indicator, "20 of N") and form (tabs, sections, grids), proven on Purchase Invoice, then Payment Entry, Journal Entry, Chart of Accounts.
3. **Report frame** — one filter row + optional chart + table/tree; AR, AP, GL, TB, BS, P&L, CF.
4. **Masters and our own rows** onto the List → Form frame.
