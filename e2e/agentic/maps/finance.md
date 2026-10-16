# Finance (hub) — branch map (9–10 Oct 2026, read from source, then corrected against `hub/finance/*` runs on the `agentic` rig)

Evidence is `file:line` against `frontend-hub/src/screens/finance/` unless a prefix says otherwise
(`ff/` = `screens/finance-final/`, `lab2/` = `screens/finance-lab-2/`, `q/` = `src/lib/queries/`, `BE` = backend).
Scope: the live **Finance** module. `finance-lab` and `finance-lab-2` are NOT routed (only `finance-lab-2/bank-accounts.tsx` and
`bank-reconciliation-list.tsx` are imported by `finance/index.ts:63-64`, so those two files ARE live). `finance-final` is **not a route**:
`nav.ts:67-69` lists `/finance-final` (and `/finance-lab`, `/finance-lab-2`) under `moved`, so a visit redirects; but 29 screens of
`finance-final/` are imported by `finance/index.ts` and are live under `/finance/...` paths (Journals, Payments, Payable, reports…).

## 0. How the module is built

* Menu = `financeNav` (`nav.ts:104-789`): sections of `fold:true` groups. ERPNext v15 Accounting groups: **Payables, Receivables, Payments,
  Banking, Financial Reports, Assets, Tax, Accounting Masters, Closing**, plus the owner's own **Stores** and **Inventory** groups and a
  top **Overview**. Rows marked `more:true` are not in the rail (they sit under the department's "More" and in ⌘K) but are routed.
  `hidden:true` rows are routed, searchable, not in the rail (Payment Entry, Supplier Ledger, Bank Clearance, New/ID BKK/BKM pages).
* Badges: Purchase Invoice (`warn`, overdue bills), Bank Reconciliation (`warn`, unagreed lines), Accounting Period (`warn`, month not open),
  Posting Readiness (`bad`, unmapped meanings) — `nav.ts` + `badges.ts`.
* Routes come from the nav registry (`routes.tsx:69-90`); the screen for each path is `finance/index.ts:96-281`. A path with no screen draws
  `Placeholder` ("This screen is routed but not written yet", `screens/placeholder.tsx`) — **none of the 83 live paths should show it**.
* Page chrome: `PageHeader` renders `crumb` (e.g. "Finance · Payables") and the title as **h1** (`components/ui/page-header.tsx:72`).
  The h1 is NOT always the menu label (e.g. menu "Supplier Bills" under Payables → h1 "Supplier Bills", menu "Accounts Payable" → h1 "Accounts Payable";
  menu "Mode of Payment" → h1 "Mode of Payment"; menu "Period Closing Voucher" → h1 "Period Closing Vouchers"; see §1).
* **UI language is English** (memory: hub copy English; printed documents Indonesian). The 7Soft BKK/BKM form is copied *by layout and order*, with
  English labels ("Voucher no", "Cash / bank", "Paid by", "Settle bills / Other lines / Offset receivables"); only the slip
  (`cash-documents.tsx` SlipPanel, `terbilang`) prints Indonesian ("terbilang", "dibayarkan kepada / diterima dari").
* Forms use `Field` = a wrapping `<label>` (`components/ui/field.tsx:60-100`), so a control's accessible name is its label text plus
  "(required)" for starred fields; query them with a regex prefix, e.g. `getByRole('textbox', { name: /^Customer/ })`.
* Money: whole rupiah on the wire (`*_minor` = rupiah), printed "Rp 1.250.000". Dates "09 Oct 2026".
* Month 2026-10 is the only OPEN period on the rig (`GET /api/v1/finance/periods`). Posting into any other month is refused (§9).

## 1. Routes (83 in `nav.ts`) — screen file and the h1 each draws

| Group › menu label | Path | Component (file) | h1 / crumb |
|---|---|---|---|
| Overview | `/finance/dashboard` | `FinanceDashboard` dashboard.tsx | cards "Cash and bank", "Income and expenses", "Upcoming payments", "Overdue payments", "Expenses per month", "Payables ageing" |
| Stores › Overview | `/finance/stores` | `StoresOverview` stores-cash.tsx:72 | "Stores" / "Finance" — table Shop · Cash on hand · Petty cash · Cashier float + "All shops · N" total |
| Stores › Sales by Day | `/finance/stores/sales` | `StoresSales` stores.tsx | "Sales by day" |
| Stores › Cash on Hand / Petty Cash / Cashier Float | `/finance/stores/cash-on-hand` `…/petty-cash` `…/cashier-float` | `StoreCashPage` stores-cash.tsx:230 (accounts 1002 / 1003 / 1004 per shop unit) | "Cash on hand" / "Petty cash" / "Cashier float" inside `StoreFrame` (shop rail `aria-label="Shops"`); cards "Balance now", "In this month", "Out this month"; month tabs; "Search the ledger"; petty cash has sub-tabs Ledger · Spending by week · Approval codes |
| Stores › Cash Counts | `/finance/stores/cash-counts` | `StoresCounts` stores.tsx | "Cash counts" |
| Inventory › Inventory Valuation / Stock vs Ledger / Goods in Transit / Cost of Goods Sold / Stock Adjustments | `/finance/inventory/{valuation,stock-vs-ledger,goods-in-transit,cogs,adjustments}` | inventory.tsx, inventory-more.tsx | same names (crumb "Finance · Inventory") |
| Payables › Purchase Invoice | `/finance/payables/bills` | `SupplierBills` supplier-bills.tsx:793 | "Purchase Invoice" (§3) |
| Payables › Credit Note | `/finance/payables/credit-notes` | `CreditNotes` credit-notes.tsx | "Credit Note" (§5) |
| Payables › Recurring Bills | `/finance/payables/recurring-bills` | recurring-bills.tsx | "Recurring Bills" (§7) |
| Payables › Accruals | `/finance/payables/accruals` | accruals.tsx | "Accruals" |
| Payables › Accounts Payable | `/finance/payables/aging` | `AccountsPayable` ff/payable.tsx | "Accounts Payable" (+ "Accounts Payable by Supplier") |
| Payables › Supplier Bills | `/finance/reports/accounts-payable-summary` | `AccountsPayableSummary` ff/payable.tsx | "Supplier Bills" |
| Payables › Supplier Ledger (hidden) | `/finance/payables/supplier-ledger` | supplier-ledger.tsx | "Supplier Ledger" |
| Payables › Payment Projection | `/finance/payables/projection` | payment-projection.tsx | "Payment Projection" |
| Payables › Loans | `/finance/financing/loans` | `Financing` ff/financing.tsx | "Loans" (+ "Owners & Investors") |
| Receivables › Sales Postings (more) | `/finance/receivables/sales-postings` | ff/sales-postings.tsx | "Sales Postings" |
| Receivables › Accounts Receivable (more) | `/finance/receivables/aging` | ff/receivable.tsx | "Accounts Receivable" |
| Receivables › Card & EDC Settlement | `/finance/receivables/card-settlement` | ff/sales-reconciliation.tsx | "Sales Reconciliation" — **settlement is refused by design; Hari: IGNORE, not tested** |
| Receivables › Employee Advances (more) | `/finance/receivables/employee` | ff/advances.tsx | "Advances" |
| Payments › Payment Entry (hidden) | `/finance/payables/payments` | ff/payments.tsx | "Payment Entry" |
| Payments › BKK | `/finance/cash-bank/bkk` | `Bkk` cash-documents.tsx:230 | "BKK" / "Finance · Payments" (§2) |
| Payments › BKM | `/finance/cash-bank/bkm` | `Bkm` | "BKM" |
| (hidden) New / existing document | `/finance/cash-bank/bkk/new`, `…/bkk/$id`, `…/bkm/new`, `…/bkm/$id` | `BkkDocument` / `BkmDocument` cash-documents.tsx:392-421 | "New BKK" / "New BKM"; existing: h1 = voucher number (`KK-26-10-00003`) |
| Payments › Journal Entry | `/finance/accounting/journal-entries` | `Journals` ff/journals.tsx | "Journal Entry" (§6) |
| Payments › Recurring Journal | `/finance/setup/journal-templates` | journal-templates.tsx | "Recurring Journal" (§7) |
| Payments › Mode of Payment | `/finance/setup/payment-methods` | payment-methods.tsx | "Mode of Payment" |
| Payments › Cash Transactions / Petty Cash / Payments Dashboard (more) | `/finance/cash-bank/cash-transactions`, `/finance/cash-bank/petty-cash`, `/finance/payments-dashboard` | ff/transactions.tsx, ff/expenses.tsx, dashboard.tsx | "Transactions", "Expenses", "Payments Dashboard" |
| Banking › Bank Account | `/finance/cash-bank/bank-accounts` | lab2/bank-accounts.tsx | (no `title=` prop; read in dump) |
| Banking › Giro Board | `/finance/cash-bank/giro` | `GiroBoard` giro-board.tsx | "Giro Board" (§8) |
| Banking › Bank Clearance (hidden) | `/finance/cash-bank/bank-clearance` | bank-clearance.tsx | "Bank Clearance" |
| Banking › Bank Transactions | `/finance/cash-bank/bank-transactions` | bank-transactions.tsx | "Bank Transactions" |
| Banking › Bank Reconciliation | `/finance/cash-bank/bank-reconciliation` | lab2/bank-reconciliation-list.tsx | "Bank Reconciliation" |
| Banking › Bank Rules | `/finance/cash-bank/bank-rules` | bank-rules.tsx | "Bank Rules" |
| Banking › Deposits / Giro Templates (more) | `/finance/cash-bank/deposits`, `/finance/setup/giro-templates` | ff/deposits.tsx, giro-print.tsx | "Deposits", "Giro Printing" |
| Financial Reports (the six Jurnal-style reports + the ERPNext set) | `/finance/accounting/general-ledger` `…/trial-balance`, `/finance/reports/{profit-and-loss,balance-sheet,cash-flow,profit-and-loss-by-unit,balance-sheet-2-years,dimension-results,cash-bank,sales-by-division,changes-in-equity,expenses-by-month,bank-reconciliation-summary}` | ff/reports/*, changes-in-equity.tsx, expenses-by-month.tsx, bank-reconciliation-summary.tsx, sales-by-division.tsx | "General Ledger", "Trial Balance", "Profit and Loss Statement", "Balance Sheet", "Cash Flow", "Profit and Loss by Unit", "Balance Sheet 2 Years", "Dimension Results", "Cash", "Sales by Division", "Statement of Changes in Equity", "Expenses by Month", "Bank Reconciliation Summary" |
| Assets › Asset / Contractor Projects / Asset Category / Fixed Asset Register / Asset Disposals | `/finance/assets/capitalization`, `/finance/assets/contractor-projects`, `/finance/setup/asset-classes`, `/finance/reports/asset-register`, `/finance/reports/asset-disposals` | assets.tsx, contractor-projects.tsx, asset-classes.tsx, asset-register.tsx, asset-disposals.tsx | "Asset", "Contractor Projects", "Asset Category", "Fixed Asset Register", "Asset Disposals" |
| Tax › Tax Withholding / Details / Tax Payables / Tax Types | `/finance/tax-setup/withholding`, `/finance/reports/tax-withholding`, `/finance/tax/payables`, `/finance/tax-setup/types` | taxes.tsx, withholding-report.tsx, ff/tax.tsx | "Tax Withholding Category", "Tax Withholding Details", "Tax Payables", "Tax Types" |
| Accounting Masters › Chart of Accounts | `/finance/accounting/chart-of-accounts` | chart-of-accounts.tsx | "Chart of Accounts" (§9) |
| … Accounts Settings | `/finance/settings/accounts` | finance-settings.tsx | "Accounts Settings" |
| … Accounting Period | `/finance/setup/periods` | periods.tsx | "Accounting Period" (§9) |
| … Accounting Dimension / Account Links / Posting Readiness / Shop Payment Methods / EDC & MDR / Expense Categories / Line Categories (more) | `/finance/setup/{dimensions,account-links,posting-readiness,shop-payment-methods,edc-mdr,expense-categories,line-categories}` | dimensions.tsx, account-links.tsx, posting-readiness.tsx, shop-payment-methods.tsx, sales-setup.tsx, expense-categories.tsx, ff/categories.tsx | "Accounting Dimensions", "Account Links", "Posting Readiness", "Shop Payment Methods", "Sales & Banks", "Expense Categories", "Line Categories" |
| … Pay Components | `/finance/setup/pay-components` | pay-components.tsx | "Pay Components" |
| … Posting Policies / Permissions (more) | `/finance/settings/posting-policies`, `/finance/settings/permissions` | posting-policies.tsx, permissions.tsx | "Posting Policies", "Rung Permissions" |
| Closing › Accruals (more) / Prepaids (more) / Period Close / Period Closing Voucher | `/finance/accounting/accruals`, `/finance/accounting/prepaids`, `/finance/period-close`, `/finance/closing/period-closing-voucher` | ff/prepaids.tsx, ff/prepaid-schedules.tsx, ff/controls.tsx, period-closing.tsx | "Prepaids & Accruals", "Prepaid Expenses", "Period Close", "Period Closing Vouchers" |

Redirects (`moved`, `nav.ts` per row): `/finance-final`, `/finance-lab`, `/finance-lab-2`, `/finance/bills`→bills, `/finance/journal`→journal entries,
`/finance/ledger`, `/finance/accounts`, `/finance/periods`, `/finance/bank`, `/finance/payments`, `/finance/reports` (→ P&L), `/finance/payroll/runs` and
`/finance/reports/{payroll-cost,inventory-valuation,interunit}` (no screen — redirect only).

## 2. BKK / BKM (7Soft vouchers) — `cash-documents.tsx`

### 2.1 Register (`Register`, :230-390)
* Header: crumb "Finance · Payments", title `BKK` / `BKM`, primary button `New BKK` / `New BKM` (:249, :273 Fab on phone).
* Filters: `Status` select (`All statuses`, Draft, Approved, Posted, Reversed), `Unit` select (all units). Counter "N documents".
* Table columns: Number (`KK-26-10-00003`, or the word "Draft" in muted text while unnumbered) · Date · Supplier (BKK) / Customer (BKM) · Cash / bank
  (e.g. "Bank Giro · DANAMON") · Amount · Status pill (Draft / Approved = amber; Posted = green; Reversed = neutral).
* Empty: "No BKK is recorded." / "…for this unit." Loading: "Reading the register…". A **repeating** section below the table (`RepeatingSection`, :1100-1330):
  list of repeats (Name · Every · Next · Last raised) + a run sweep button.
* Row click → `/finance/cash-bank/{bkk|bkm}/<document_id>`.

### 2.2 New document (`KlasikForm`, :1650-2760) — design 1 "Klasik"
Header: crumb "Finance · Payments", title `New BKK`/`New BKM`; actions `← Back to BKK` (link) and **Save draft** (`Saving…` while pending).
Fields (labels; starred = required):
* `Voucher no` (disabled, empty until approved), `Date`* (Day picker), `Cash / bank`* (choose a unit first: "Choose a unit first." → then options from
  `bank_giro/bank_savings/cash/petty_cash` of that unit, label "Bank Giro · DANAMON"; `MoneySideField` :2730), `Reference`.
* `Unit`* (UnitSelect, empty label "Choose a unit"), `Supplier`* (BKK: SupplierPicker combobox, shows "Rp N open" under it) / `Customer`* (BKM: free text),
  `Paid by` segmented **Cash · Transfer · Giro**; Giro adds `Giro no`*, `Due`* (not before the date), `Drawn on`* (BKM, free text) / `Drawn on` (BKK, disabled = the bank).
* `Note`* (printed on the slip). BKM also `Refund for return` (only when a supplier return is owed).
* Total box: "Total paid" / "Total received", amount, amount in words (Indonesian terbilang), ladder "Settle bills|invoices", "Discount given", "Other lines",
  "Offset receivables|payables".
* Tabs (`SubTabs`, with counts): `Settle bills N` · `Other lines N` · `Offset receivables N` (BKM: `Settle invoices`, `Offset payables`); buttons `Browse open bills|invoices`
  (BKK with a supplier only) and `Replace a bounced giro` (disabled, "From the Giro board").
* **Settle** (BKK): the supplier's POSTED bills with outstanding > 0, oldest due first. Row checkbox `Settle <INV>`, `Discount on <INV>`, `Paid on <INV>`,
  checkbox `<INV> in full`, columns Bill · Due ("N d late" / "in N d") · Payable · Ref · Discount · Paid · In full; footer "N of M selected". Empty: "<Supplier> has nothing open to settle…"/"Choose a supplier to see their open bills."
  BKM Settle tab: "No open invoices to settle. Money that isn't for an invoice goes on Other lines."
* **Other lines**: grid Account (AccountAndCategory picker) · Note (`Note on row N`) · Amount (`Amount on row N`) · `Remove row N`; button
  `Add a line — interest, other income, a staff repayment`; footnote "Discount posts to Settlement discount — change it in Account links".
* **Offset**: open supplier advances, `Net off <ADV>` checkbox + amount.
* Validation (shown as ONE red banner once Save draft is pressed, joined by " · ", :2010-2050): `choose a unit` · `choose the cash or bank account` ·
  `choose a supplier` / `name who the money is from` · `a giro needs its number` · `a giro needs its due date` · `which bank the giro is drawn on` ·
  `add a note — it is printed on the slip` · `<INV>: more than the Rp N still open` (also red field as typed) · `nothing to pay yet — settle a bill or add a line` /
  `nothing to receive yet — add a line`.
* Save → `POST /api/v1/finance/cash-documents/voucher` (`q/cash-documents.ts:106`, idempotency key) → navigates to `/finance/cash-bank/<kind>/<id>`. A refused request shows the server sentence in a red banner.

### 2.3 Existing document (`ExistingDocument`, :432-700)
* h1 = voucher number (or "BKK"/"BKM" while a draft). Pills: kind (BKK/BKM) + status; buttons `Print slip` (APPROVED/POSTED) and `Repeat…`.
* Facts: Date · Unit · `Paid from`/`Received into` (+ " · DANAMON") · Party · Amount · Recorded by · Approved by · Posted by · Journal entry · Paid by (non-cash: "Giro · <no> · due …") · Reference; lines card (Line · Bill / account · Note · Discount · Amount, **Total** row; OFFSET shows negative); memo.
* **DRAFT**: text "Approving takes the next number — KK-…" + **Approve** (`Approving…`) → `POST …/approve` (takes `KK-yy-mm-nnnnn` / `KM-…`).
* **APPROVED**: field `Posting date` ("Empty posts it on the document date.") + **Post to the books** (`Posting…`) → `POST …/post {posting_date}`.
* **POSTED**: green banner "Posted as KK-26-10-00003 · journal JV-…. To correct it, reverse it below." + `Reverse` section: textarea (reason), `Posting date` ("Empty posts the mirror today."), danger button **Reverse** (disabled with an empty reason) → `POST …/reverse {reason, posting_date}`.
* **REVERSED**: note "Reversed. It stays in the books up to the date its reversal was posted."
* Server refusals appear as red banners above ("The document could not be posted." fallback). Known refusal: posting to a bank account with no registered bank account → "banking setup is incomplete: 1009 … Describe the account under Bank Accounts".
* Postings: BKK SETTLE → Dr 2002 (party_id = supplier code) / Cr bank (1009); the bill's `outstanding_minor` drops (POTONGAN part = discount to "Settlement discount" role).

## 3. Purchase Invoice (supplier bills) — `supplier-bills.tsx`
* h1 "Purchase Invoice"; search `Search bills`; primary `Record bill` (Fab on phone); `Unit` select; filter panel.
* SubTabs: **Merchandise** · **Expenses** (· N held) · **From GA** (· N held) · **Unbilled deliveries** (· N).
* Merchandise table (`deskBillColumns` :111-300): Invoice (+ marks "Held", "From GA") · Supplier · … Total · Outstanding · Status (`Draft`, `Posted`, `Held`, "N d late"). Empty: "No supplier invoice has been recorded yet." (+ button "N unbilled deliveries").
* `Record a supplier bill` sheet (`RecordSheet` :2163): `Kind` (Merchandise | Expense), `Invoice number`*, `Site`* (Choose a site), `Supplier`*, `Invoice date`*, `Due date`, `Subtotal`*, `Tax`, `Discount` (merchandise only), `Note` (hint "Why it is being held, if it is."), totals ladder; expense kind adds lines (Account, Amount, Memo; "The lines have to add up to the subtotal"); footer text then **Submit** (disabled until ready; `Submitting…`).
* Bill sheet (`BillSheet` :1389): facts, lines, warnings (six server checks, never block), `BillHandover` (:1815): **Post**, **Hold this bill** (`Reason for the hold`*, `Planned release`), Release, return-to-GA (`Reason for the return`*).
* Endpoints (`q/finance.ts:1580-1700`): `GET/POST /api/v1/finance/bills`, `POST /bills/{id}/post|hold|release|return`, `GET /bills/{id}/warnings`, `GET /finance/unbilled` (deliveries with no bill; GRN = Dr 1029 inventory / Cr 2002 payable already posted by the receipt).
* Bills recorded with `receipt_ids` leave the Unbilled list (join table 0052).

## 4. Payments (register of every supplier payment) — `ff/payments.tsx` (hidden row `/finance/payables/payments`)
* h1 "Payment Entry", dialog "Record a payment"; superseded in practice by BKK (Settle bills). Out of the e2e scope except the route loads.

## 5. Credit Note — `credit-notes.tsx`
* h1 "Credit Note", button `New credit note`, Status filter (All statuses · Draft · Posted · Refunded). Table: Credit No · Date · Supplier · Against invoice · Reason · Total · Status · Refunded.
  Empty: "No credit note yet. Record one when a supplier takes goods back or corrects a price on a bill already agreed."
* **New credit note** panel (`NewCreditNote` :540-744): `Supplier`*, `Against invoice`* (select "Choose an invoice", options "INV · date · total"; only POSTED bills of that supplier), `Credit date`*, `Reason`* (Goods returned | Price correction),
  `Amount`*, `Supplier's credit note no`, `Credit goes to` (EXPENSE invoices only), `Note`, **`Settles return`** (shown only when a supplier return with owed > 0 exists; `ReturnPicker` return-picker.tsx) ; **Submit** (disabled until invoice + amount > 0; `Submitting…`).
  Submitting with `Settles return` also records a CREDIT_NOTE settlement on that return (`POST /api/v1/supplier-returns/{id}/settlements`).
* Credit note panel: facts; DRAFT: "Not in the books until it is posted." + ConfirmButton `Post` ("Post this credit note?"); POSTED: "In the books. The next bill from this supplier can absorb it, or the supplier can send the money back." + `Record refund` → `Received into`*, `Refund date`* → POST /credit-notes/{id}/refund.
* Posting: Dr 2002 (supplier) / Cr 1029 inventory (merchandise) for the total; **the bill's `outstanding_minor` does not change** (credit waits for the next bill/refund; payables ageing `total` still counts the bill while `books_minor` is lower).

## 6. Journal Entry — `ff/journals.tsx` (confirmed by run)
* h1 "Journal Entry", `Search entries` (header + toolbar), `Entry type` select (All types + one option per source kind the window holds, e.g. Manual, Supplier Invoice, Goods Receipt, Credit Note…), `Unit`, a window control, primary `New entry`.
* Table columns: **Date · Entry · Memo · Type · Posted by · Total debit · Status** (no Source/Answered columns — those belong to the old `finance/journal.tsx`, which is not routed). A hand-written entry reads "Manual · by hand"; Status Posted / Reversed. Counter "N entries".
* Entry sheet (`?entry=<entry_id>`): title = entry number, sub = memo; lines table; "This posts a new entry with the debits and credits exchanged…"; textarea (reason), `Posting date`, danger **Reverse** (disabled with no reason) → banner "Reversed by JV-…"; an already reversed entry says "Already reversed. It stays in the books up to the date its reversal was posted." and offers no Reverse.
* `New journal entry` panel ("Two sides, and a unit on each of them."): `Posting date` (button named "Posting date (required) The month this lands in."), `Memo` ("What this entry is for."), grid **Account · Unit · Debit · Credit** (account = unnamed textbox + result buttons "1054 Advanced - Others"; `Unit` combobox per row; `Debit on row N` / `Credit on row N`; `Remove row N`; `Add row`), a Total row, footer "No usable row yet — a row needs an account, a unit and a figure" / "Debits Rp A · credits Rp B" / "Balanced at Rp N" and **Post entry** (disabled until balanced). Success banner "Posted as JV-…".
* `POST /api/v1/finance/journal` → `{entry_id, entry_number, total_minor}`; `POST /journal/{id}/reverse {reason, posting_date}`. Refusals (400/409, sentence verbatim): heading account ("… is a heading; … Choose a postable account under it instead."), month with no period ("no accounting period exists for 2026-11; open it before posting"), inactive account, one-sided entry, reversing twice.
* Hidden sheet key `?journalTemplate=<id>` starts a composer from a Recurring Journal template.

## 7. Recurring things
* **Recurring Journal** (`journal-templates.tsx`): templates list (Journal · Amount · Schedule · Last run), `New recurring journal`, per row `Add a schedule` / `Change the schedule` (panel: `Template`*, `Every`, `Next date`*, `Until`, `Post it automatically`, `Active`), page action to run due repeats now (`POST /finance/journal-repeats/run`). Template panel "New journal entry template": `Name`*, `Memo`, `Active`, grid.
* **Recurring Bills** (`recurring-bills.tsx`): table Label · Supplier · Unit · Expense account · Every month on day · Expected amount · Status; `New recurring bill` sheet: `Label`*, `Supplier`*, `Unit`*, `Expense account`, `Every month on day`, `Tolerance (%)`, `Expected amount before tax`*, `Expected tax`, `Note`; Retire (ConfirmButton "Retire this recurring bill?"); `Show retired`. Endpoint `/api/v1/finance/bill-templates`.
* **Repeating BKK/BKM** (`cash-documents.tsx` RepeatSheet): button `Repeat…` on a document → Name, Frequency, Next date, End date; `/api/v1/finance/cash-document-repeats` (+ `/run`).

## 8. Banking (confirmed by run)
* **Bank Account** (`lab2/bank-accounts.tsx`): h1 "Bank Account"; cards "Cash & bank balance", "Going out · next 30 days", "Giros not cleared"; table Account · Unit · …; a row per bank account described against a ledger account (bank name + number). A money account with no described bank account **blocks every posting to it** ("banking setup is incomplete: 1009 … Describe the account under Bank Accounts"). `POST /api/v1/finance/bank-accounts` (idempotent per ledger binding).
* **Giro Board**: four lanes **Waiting · Due within 7 days · Cleared · Bounced** with a count and total each; card = supplier, amount, "Due 24 Oct 2026 · in 15 days" / "N days late" / "Due today" and the giro number; filters `Bank`, `Unit`, `Late only`; hint "Drag a giro to Cleared once the bank has taken it, or to Bounced if it was refused." **Dragging a card to a lane works** (`dragTo`): to Cleared opens an inline form (`Into` disabled = the giro's bank, `Cleared on`* Day, button **`Clear Rp N`**); to Bounced `Bounce date`* + `Reason`* + **Bounce**; a cleared card offers `Undo clearing` (`Taken back on`*, `Reason`*); a bounced card `Replace`. **Phone (<768px)**: one lane at a time via the dock chip `Lane: Waiting` (sheet "Lane"); tapping a card lists its moves ("Cleared by the bank", "Bounced", "Undo clearing"). `Opening giro` is disabled ("Not available yet."). Endpoints `GET /api/v1/finance/giros`, `POST /giros/{id}/deliver|due|clear|reject|unclear|replace`. A BKK paid by Giro posts Dr payable / **Cr 2009 Outstanding giro (not the bank)**; clearing posts Dr 2009 / Cr bank; bouncing reverses the issue and reopens the bill.
* **Bank Transactions**: `Upload statement`, filters `Search bank transactions`, `Bank account`, `Status` (Unreconciled / Reconciled), `Month`, `Year`; summary "N lines · Rp X in · Rp Y out"; table **Date · Description · Debit · Credit**, grouped by month ("October 2026"), a row reads "TRF MASUK … R1 · Not matched yet". Upload sheet: `Bank account` (AccountPicker, type 1009), `Unit`*, `Source`, `Period start`*, `Period end`*, `Opening balance`*, `Closing balance`*, `Lines`* (CSV: `YYYY-MM-DD,description,reference,debit,credit`; unreadable rows are listed "Line 1: "x" is not a YYYY-MM-DD date." and not counted), footer "N lines read" / "Nothing to load yet", **Upload**. A new import for the same account and period **supersedes** the earlier statement.
* **Bank Reconciliation**: list per bank account (Account · Transactions · Reconciled · Pending · Bank · Books · Difference · a button); opens the paired view `?statement=<id>` with **Paired for you** (only lines whose single best candidate scores ≥ 90 = exact amount 50 + same day 25 + reference 30 — so the voucher's *Reference* must equal the bank's reference; `Confirm`, `Confirm all exact (N)`, `Match several…`), **Only in the bank** (`Create BKM` / `Create BKK` — or `Create BKK — <category>` when a rule proposed it —, `Match a voucher instead`, `Match several…`, `Ignore suggestion`; booking by hand asks account + `Why this account`*), **In the books, not on the bank** (table Date · Entry · Type · Memo · Deposit · Withdrawal · Days, and the walk from books to bank balance). Settled lines read "Agreed" with `Undo`. Endpoints `GET …/bank-statements/{id}/lines|suggestions|book-only`, `POST /bank-lines/{id}/match|book`, `GET /bank-proposals`, accept/ignore.
* **Bank Rules**: `Apply rules now` (banner "N proposals made from M open lines. K not recognised by any rule." + link "Review them in Bank Reconciliation"), `New rule`, `Show retired`; table **Priority · When the description… · Direction · Records as · Unit · Used · Active**, row buttons `Edit`, `Retire` (→ confirm button "Retire rule"). Seeded: 10 PAJAK BUNGA (Out), 20 BIAYA ADM (Out → Bank charges 6043), 30 BUNGA (In). Rule form: `Match`, `Text`*, `Direction`, `Category`*, `Unit`, `Party`, `Priority` (digits only, ≥ 1: "A whole number, 1 or more."), `Note`, `Active`, **Submit**.
* **Bank Reconciliation Summary** (report): `Month` (defaults to the previous month — "No bank statement covers this month, and no bank account holds money at its end."), `Unit`; pick the current month to see books vs statement.

## 9. Masters and periods
* **Chart of Accounts** (`chart-of-accounts.tsx`): tabs Chart · History; `Whose books`, `Show inactive`, `Expand all`/`Collapse all`, an unnamed search box ("Matching “1009”"); the open account is the sheet `?account=<code>` (Edit · Deactivate/Reactivate; **an account with a balance cannot be retired**: "conflict: 1915 still carries a balance of 7000; clear it before retiring the account"); `GET /api/v1/finance/chart-changes?account=` rows carry `action` (CREATE, DEACTIVATE…); `New account` panel: `Code`*, `Name`*, `Under heading`*, "A heading — other accounts sit under it, nothing posts to it", `Account type`, `Statement section`, `Kept per`, `Normal balance`, `Reason`; account sheet: edit (`Name`, `Move under`, `Frozen`, …), history. `GET /api/v1/finance/accounts`, `POST /chart-changes`.
* **Accounting Period** (`periods.tsx`): header button reads "<Month Year> is open" (disabled) for a month that exists, or opens the month chosen with the `Month` / `Year` comboboxes; table Month · Status · Entries · Closed by · Closed at ("October 2026 · 1 months opened"); sheet per month: checklist (Every role reaches an account · Supplier bills posted · Bank statements agreed · Depreciation charged · Books balance) and Seal/Undo closing. **Tests never seal, undo or open months.**
* Posting into a month that is not OPEN (e.g. 2026-09, 2026-11) is refused by the server (used as a negative test on BKM post and Journal).

## 10. Stores cash — `stores-cash.tsx`, `stores.tsx`
The overview now lists **every open shop** (23 on 10 Oct: the 16 demo stores plus stores other suites opened) and its total row counts them ("All shops · 23"). Sales by Day opens on *today*; after midnight Jakarta time that day is empty ("Nothing was sold on this day.") — pick the day on the rail ("Fri 9 Oct Rp 20,1 M"). Cash Counts and petty-cash weeks use a rail of buttons "Week of 5 Oct". Sales Postings needs a store picked first ("Choose a site to see its sales postings.") and has `Generate draft` for the business date.
Boxes per shop = ledger accounts 1002 (Cash on hand) · 1003 (Petty cash) · 1004 (Cashier float) in the shop's unit. Screens read `GET /api/v1/finance/accounts/{code}/ledger?unit=store-NN&from=today&to=today` (closing_minor). Card/QRIS takings are NOT in these boxes (they go straight to Cash in Bank 1005 of HO).

## 11. Reports
Trial Balance `GET /api/v1/finance/trial-balance?unit=&as_of=` → `{rows[{account_code,unit_id,debit_minor,credit_minor}], total_debit_minor, total_credit_minor, balanced}`; the screen's totals must equal these and debit = credit. P&L / Balance Sheet / Cash Flow / General Ledger read `/api/v1/finance/reports/*` and `/accounts/{code}/ledger`.

## 11b. Facts every Finance test depends on
* **Time zone**: the hub runs as Asia/Jakarta (`hub.config.ts`); from 17:00 UTC the screens' "today" is a day ahead of the VM's UTC clock. Tests type and post dates from `support/finance.ts#today()` (Jakarta) and read balances `as_of=2099-12-31`, otherwise an entry dated "tomorrow" is missing from today's balance.
* **Isolation**: money tests use bank `bank_giro`/DANAMON (ledger 1009, giro liability 2009) — described by `ensureBank()` — and their own suppliers (`Finance e2e <purpose>`, found-or-created, never one per run). Shared supplier 0001 appears only where the flow needs real receipts or a PO advance. Manual entries use accounts 1054 / 2031 / 6004 / 19NN (own, created per run).
* **Nothing is closed, sealed, opened or mapped**; the only chart change is creating `19NN` accounts under 1000.

## 11c. Findings the runs turned up (see `use-cases/finance.md`)
* **BUG — Record bill sheet files the bill under the supplier's register id (a uuid)**: `supplier-bills.tsx` `RecordSheet` sends `supplier_id: draft.supplierId` where `SupplierPicker.onPick` supplies `supplier_id`; every other writer (receipts, API, the BKK/Credit Note screens) uses the supplier **code** (`0022`). The bill's payable credit lands on party `b0a959fb-…`, `GET /bills?supplier=<code>` does not list it, the BKK Settle tab (`bill.supplier_id === supplier.code`) cannot see it and payables ageing omits it. (`hub/finance/bills.e2e.ts`, tag `bug`.)
* **BUG — Unbilled deliveries tab is cut at 200**: `unbilledReceipts()` calls the plain `GET /finance/unbilled`, which answers only the oldest 200; the screen says the list "is whole and the exposure … a total". The rig holds 323 (Rp 195.3 M); the tab reads 200 and its banner sums those. (`bills.e2e.ts`, `bug`.)
* **BUG — BKK Settle tab reads only the newest 200 bills of all suppliers**: `cash-documents.tsx:1680` `listBills({})` (default `limit` 200, no supplier filter) then filters by supplier and POSTED client-side; once the book holds more than 200 bills a supplier's older bills are not offered ("has nothing open to settle") and the "Rp N open" figure undercounts. (`bkk.e2e.ts`, `bug`.)
* Observed, not asserted: (a) the "Paid by" segmented control is inside one `<label>`, so its first button (Cash) is announced "Paid by Transfer Giro"; (b) a warehouse user who types a Finance address sees the page chrome (incl. a **Record bill** button) above "You do not have access to what the company owes its suppliers"; (c) hub "today" is Asia/Jakarta, the cloud's is UTC: between 00:00 and 07:00 Jakarta a repeat due "today" is counted by the page ("Run 1 due now") but the server's sweep skips it; (d) on a touch-emulated phone a tap on the Giro Board's small inline buttons (Bounce, Clear Rp N, Undo clearing) sends no request while Enter on the focused button does; (e) approving a BKM dated in a month with no accounting period takes a voucher number (`KM-26-09-00001`) that can never be posted; (f) a posted credit note lowers the supplier's ledger but not the bill's outstanding or the payables ageing ("The ageing is Rp N off the books" — by design, the credit waits for the next bill or a refund).

## 12. Fixtures the rig has (9 Oct)
* Bank: 1005 "Cash In Bank Giro Bank BCA" (registered, HO). **1009 Danamon is mapped (`bank_giro`/DANAMON) but has no registered bank account until `ensureBank()` describes one.**
* Open period: 2026-10 only. Suppliers 0001/0002 (shared with the PO suites; bills for their receipts exist as "Unbilled deliveries"). 17 units: `ho`, `store-01`…`store-16`.
* No bills, cash documents, credit notes, giros or journal repeats exist before the finance tests run.
