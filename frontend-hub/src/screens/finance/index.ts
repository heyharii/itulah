import { lazyScreen, type ScreenMap } from "@/screens/registry"

/// The screens behind the Finance menu (`nav.ts`), one row at a time.
///
/// Each screen is imported from the file it was written in — `finance`,
/// `finance-final` or `finance-lab-2` — rather than moved, so this map is the
/// one place that says which file answers which row. A row not listed renders
/// `Placeholder`. Since the menu followed ERPNext (2026-09-28) it names only
/// rows with a screen; the unbuilt rows of the frozen tree redirect, and
/// several of their endpoints are already on the node (`acquirer-settlements`,
/// `cash-documents`, `giros`, `payment-batches`, `interunit/pairs`,
/// `corrections`, `reports/unit-results`).
///
/// Where the old modules had two or three screens for one row, the one kept is
/// the one with the whole workflow on it: Supplier Bills records, posts and
/// holds (the Bills list in `finance-lab-2` only reads), Payment Entry records
/// and posts, and the Journal, General Ledger and Trial Balance kept are
/// ERPNext's shapes with the unit as a dimension on the line.
///
/// A screen that spans more than one row answers the first of them until it
/// is split: Advances is Employee Receivables, Financing is Loans, Tax is Tax
/// Payables, and Prepaids & Accruals is Accruals — Prepaids has a schedule
/// screen of its own.
///
/// | Row | File |
/// |---|---|
/// | Home (ERPNext's Invoicing workspace) | `finance/overview` |
/// | Dashboard (ERPNext's Accounts dashboard) | `finance/dashboard` |
/// | Payments › Dashboard (ERPNext's Payments dashboard) | `finance/dashboard` |
/// | Cash & Bank → Bank Accounts | `finance-lab-2/bank-accounts` |
/// | Cash & Bank → Cash Transactions | `finance-final/transactions` |
/// | Cash & Bank → Petty Cash | `finance-final/expenses` |
/// | Cash & Bank → Deposits | `finance-final/deposits` |
/// | Cash & Bank → Bank Reconciliation | `finance-lab-2/bank-reconciliation-list` |
/// | Receivables → Card & EDC Settlement | `finance-final/sales-reconciliation` |
/// | Receivables → Employee Receivables | `finance-final/advances` |
/// | Receivables → Accounts receivable | `finance-final/receivable` |
/// | Receivables → Sales Postings | `finance-final/sales-postings` |
/// | Payables → Supplier Bills | `finance/supplier-bills` |
/// | Payables → Payments | `finance-final/payments` |
/// | Payables → Accounts payable, Registers → AP Summary | `finance-final/payable` |
/// | Payables → Payment Projection (ours; no ERPNext row) | `finance/payment-projection` |
/// | Banking → Bank Clearance | `finance/bank-clearance` |
/// | Payables → Aging, Reports → AP Aging | `finance-final/payable` |
/// | Payroll → Payroll Runs, Payables, Employee Payments, Posting | `finance-final/payroll` |
/// | Assets → Capitalization | `finance/assets` |
/// | Financing → Loans | `finance-final/financing` |
/// | Tax → Tax Payables | `finance-final/tax` |
/// | Accounting → Journal Entries | `finance-final/journals` |
/// | Reports → General Ledger | `finance-final/reports/general-ledger` |
/// | Reports → Trial Balance | `finance-final/reports/trial-balance` |
/// | Accounting → Chart of Accounts | `finance/chart-of-accounts` |
/// | Accounting → Accruals | `finance-final/prepaids` |
/// | Accounting → Prepaids | `finance-final/prepaid-schedules` |
/// | Period Close | `finance-final/controls` |
/// | Reports → Balance Sheet, Profit & Loss, Cash Flow | `finance-final/reports/*` |
/// | Reports → Profit and Loss by Unit, Balance Sheet 2 Years (7Soft's "2 Tahunan" pair) | `finance-final/reports/*-by-unit`, `*-2-years` |
/// | Reports → Cash & Bank | `finance-final/cash` |
/// | Setup → Account Links | `finance/account-links` |
/// | Setup → Posting Readiness | `finance/posting-readiness` |
/// | Setup → Line Categories | `finance-final/categories` |
/// | Setup → EDC & MDR | `finance/sales-setup` |
/// | Setup → Giro Templates | `finance/giro-print` |
/// | Setup → Accounting Dimensions | `finance/dimensions` |
/// | Setup → Payment Methods | `finance/payment-methods` |
/// | Setup → Journal Entry Templates | `finance/journal-templates` |
/// | Setup → Expense Categories | `finance/expense-categories` |
/// | Setup → Pay Components | `finance/pay-components` |
/// | Setup → Asset Classes | `finance/asset-classes` |
/// | Opening & Closing → Fiscal Periods | `finance/periods` |
/// | Opening & Closing → Period Closing Voucher | `finance/period-closing` |
/// | Tax Setup → Tax Withholding Category, Tax Types | `finance/taxes` |
/// | Settings → Accounts Settings | `finance/finance-settings` |
/// | Settings → Posting Policies | `finance/posting-policies` |
/// | Settings → Role Permissions | `finance/permissions` |
/// | Reports → Dimension Results | `finance/dimension-results` |
export const screens: ScreenMap = {
  "/finance/dashboard": lazyScreen(
    "finance/dashboard",
    () => import("@/screens/finance/dashboard"),
    (m) => m.FinanceDashboard
  ),
  "/finance/payments-dashboard": lazyScreen(
    "finance/dashboard",
    () => import("@/screens/finance/dashboard"),
    (m) => m.PaymentsDashboard
  ),

  "/finance/cash-bank/bank-accounts": lazyScreen(
    "finance-lab-2/bank-accounts",
    () => import("@/screens/finance-lab-2/bank-accounts"),
    (m) => m.BankAccounts
  ),
  "/finance/cash-bank/cash-transactions": lazyScreen(
    "finance-final/transactions",
    () => import("@/screens/finance-final/transactions"),
    (m) => m.Transactions
  ),
  "/finance/cash-bank/kas-bank": lazyScreen(
    "finance/cash-info",
    () => import("@/screens/finance/cash-info"),
    (m) => m.KasBank
  ),
  "/finance/cash-bank/kartu": lazyScreen(
    "finance/cash-info",
    () => import("@/screens/finance/cash-info"),
    (m) => m.KartuKasBank
  ),
  "/finance/cash-bank/bkk": lazyScreen(
    "finance/cash-documents",
    () => import("@/screens/finance/cash-documents"),
    (m) => m.Bkk
  ),
  "/finance/cash-bank/bkm": lazyScreen(
    "finance/cash-documents",
    () => import("@/screens/finance/cash-documents"),
    (m) => m.Bkm
  ),
  "/finance/cash-bank/bkk/new": lazyScreen(
    "finance/cash-documents",
    () => import("@/screens/finance/cash-documents"),
    (m) => m.BkkDocument
  ),
  "/finance/cash-bank/bkk/$id": lazyScreen(
    "finance/cash-documents",
    () => import("@/screens/finance/cash-documents"),
    (m) => m.BkkDocument
  ),
  "/finance/cash-bank/bkm/new": lazyScreen(
    "finance/cash-documents",
    () => import("@/screens/finance/cash-documents"),
    (m) => m.BkmDocument
  ),
  "/finance/cash-bank/bkm/$id": lazyScreen(
    "finance/cash-documents",
    () => import("@/screens/finance/cash-documents"),
    (m) => m.BkmDocument
  ),
  "/finance/cash-bank/giro": lazyScreen(
    "finance/giro-board",
    () => import("@/screens/finance/giro-board"),
    (m) => m.GiroBoard
  ),
  "/finance/cash-bank/petty-cash": lazyScreen(
    "finance-final/expenses",
    () => import("@/screens/finance-final/expenses"),
    (m) => m.Expenses
  ),
  "/finance/cash-bank/deposits": lazyScreen(
    "finance-final/deposits",
    () => import("@/screens/finance-final/deposits"),
    (m) => m.Deposits
  ),
  "/finance/cash-bank/bank-reconciliation": lazyScreen(
    "finance-lab-2/bank-reconciliation-list",
    () => import("@/screens/finance-lab-2/bank-reconciliation-list"),
    (m) => m.BankReconciliationList
  ),
  "/finance/cash-bank/bank-transactions": lazyScreen(
    "finance/bank-transactions",
    () => import("@/screens/finance/bank-transactions"),
    (m) => m.BankTransactions
  ),
  "/finance/cash-bank/bank-clearance": lazyScreen(
    "finance/bank-clearance",
    () => import("@/screens/finance/bank-clearance"),
    (m) => m.BankClearance
  ),
  "/finance/cash-bank/bank-rules": lazyScreen(
    "finance/bank-rules",
    () => import("@/screens/finance/bank-rules"),
    (m) => m.BankRules
  ),

  "/finance/receivables/card-settlement": lazyScreen(
    "finance-final/sales-reconciliation",
    () => import("@/screens/finance-final/sales-reconciliation"),
    (m) => m.SalesReconciliation
  ),
  "/finance/receivables/employee": lazyScreen(
    "finance-final/advances",
    () => import("@/screens/finance-final/advances"),
    (m) => m.Advances
  ),
  "/finance/receivables/aging": lazyScreen(
    "finance-final/receivable",
    () => import("@/screens/finance-final/receivable"),
    (m) => m.AccountsReceivable
  ),
  "/finance/receivables/sales-postings": lazyScreen(
    "finance-final/sales-postings",
    () => import("@/screens/finance-final/sales-postings"),
    (m) => m.SalesPostings
  ),

  "/finance/payables/purchase-invoice": lazyScreen(
    "finance/purchase-invoice",
    () => import("@/screens/finance/purchase-invoice"),
    (m) => m.PurchaseInvoices
  ),
  "/finance/payables/bills": lazyScreen(
    "finance/supplier-bills",
    () => import("@/screens/finance/supplier-bills"),
    (m) => m.SupplierBills
  ),
  "/finance/payables/recurring-bills": lazyScreen(
    "finance/recurring-bills",
    () => import("@/screens/finance/recurring-bills"),
    (m) => m.RecurringBills
  ),
  "/finance/payables/accruals": lazyScreen(
    "finance/accruals",
    () => import("@/screens/finance/accruals"),
    (m) => m.Accruals
  ),
  "/finance/assets/contractor-projects/$project": lazyScreen(
    "projects/page",
    () => import("@/screens/projects/page"),
    (m) => m.FinanceProjectScreen
  ),
  "/finance/assets/contractor-projects": lazyScreen(
    "finance/contractor-projects",
    () => import("@/screens/finance/contractor-projects"),
    (m) => m.ContractorProjects
  ),
  "/finance/stores": lazyScreen(
    "finance/stores-cash",
    () => import("@/screens/finance/stores-cash"),
    (m) => m.StoresOverview
  ),
  "/finance/stores/sales": lazyScreen(
    "finance/stores",
    () => import("@/screens/finance/stores"),
    (m) => m.StoresSales
  ),
  "/finance/stores/cash-on-hand": lazyScreen(
    "finance/stores-cash",
    () => import("@/screens/finance/stores-cash"),
    (m) => m.StoresCashOnHand
  ),
  "/finance/stores/petty-cash": lazyScreen(
    "finance/stores-cash",
    () => import("@/screens/finance/stores-cash"),
    (m) => m.StoresPettyCash
  ),
  "/finance/stores/cashier-float": lazyScreen(
    "finance/stores-cash",
    () => import("@/screens/finance/stores-cash"),
    (m) => m.StoresCashierFloat
  ),
  "/finance/stores/cash-counts": lazyScreen(
    "finance/stores",
    () => import("@/screens/finance/stores"),
    (m) => m.StoresCounts
  ),
  "/finance/inventory/valuation": lazyScreen(
    "finance/inventory",
    () => import("@/screens/finance/inventory"),
    (m) => m.InventoryValuationScreen
  ),
  "/finance/inventory/stock-vs-ledger": lazyScreen(
    "finance/inventory",
    () => import("@/screens/finance/inventory"),
    (m) => m.StockVsLedger
  ),
  "/finance/inventory/goods-in-transit": lazyScreen(
    "finance/inventory-more",
    () => import("@/screens/finance/inventory-more"),
    (m) => m.GoodsInTransitScreen
  ),
  "/finance/inventory/cogs": lazyScreen(
    "finance/inventory-more",
    () => import("@/screens/finance/inventory-more"),
    (m) => m.CogsScreen
  ),
  "/finance/inventory/adjustments": lazyScreen(
    "finance/inventory-more",
    () => import("@/screens/finance/inventory-more"),
    (m) => m.StockAdjustmentsScreen
  ),
  "/finance/payables/credit-notes": lazyScreen(
    "finance/credit-notes",
    () => import("@/screens/finance/credit-notes"),
    (m) => m.CreditNotes
  ),
  "/finance/payables/payments": lazyScreen(
    "finance-final/payments",
    () => import("@/screens/finance-final/payments"),
    (m) => m.Payments
  ),
  "/finance/payables/aging": lazyScreen(
    "finance-final/payable",
    () => import("@/screens/finance-final/payable"),
    (m) => m.AccountsPayable
  ),
  "/finance/reports/accounts-payable-summary": lazyScreen(
    "finance-final/payable",
    () => import("@/screens/finance-final/payable"),
    (m) => m.AccountsPayableSummary
  ),
  "/finance/payables/supplier-ledger": lazyScreen(
    "finance/supplier-ledger",
    () => import("@/screens/finance/supplier-ledger"),
    (m) => m.SupplierLedger
  ),
  "/finance/payables/projection": lazyScreen(
    "finance/payment-projection",
    () => import("@/screens/finance/payment-projection"),
    (m) => m.PaymentProjection
  ),

  "/finance/payroll/runs": lazyScreen(
    "finance-final/payroll",
    () => import("@/screens/finance-final/payroll"),
    (m) => m.PayrollRuns
  ),
  "/finance/payroll/payables": lazyScreen(
    "finance-final/payroll",
    () => import("@/screens/finance-final/payroll"),
    (m) => m.PayrollPayables
  ),
  "/finance/payroll/payments": lazyScreen(
    "finance-final/payroll",
    () => import("@/screens/finance-final/payroll"),
    (m) => m.PayrollPayments
  ),
  "/finance/payroll/posting": lazyScreen(
    "finance-final/payroll",
    () => import("@/screens/finance-final/payroll"),
    (m) => m.PayrollPosting
  ),

  "/finance/assets/capitalization": lazyScreen(
    "finance/assets",
    () => import("@/screens/finance/assets"),
    (m) => m.AssetRegister
  ),

  "/finance/financing/loans": lazyScreen(
    "finance-final/financing",
    () => import("@/screens/finance-final/financing"),
    (m) => m.Financing
  ),

  "/finance/tax/payables": lazyScreen(
    "finance-final/tax",
    () => import("@/screens/finance-final/tax"),
    (m) => m.Tax
  ),

  "/finance/accounting/journal-entries": lazyScreen(
    "finance-final/journals",
    () => import("@/screens/finance-final/journals"),
    (m) => m.Journals
  ),
  "/finance/accounting/all-journals": lazyScreen(
    "finance-final/journals",
    () => import("@/screens/finance-final/journals"),
    (m) => m.AllJournals
  ),
  "/finance/accounting/general-ledger": lazyScreen(
    "finance-final/reports/general-ledger",
    () => import("@/screens/finance-final/reports/general-ledger"),
    (m) => m.GeneralLedger
  ),
  "/finance/accounting/trial-balance": lazyScreen(
    "finance-final/reports/trial-balance",
    () => import("@/screens/finance-final/reports/trial-balance"),
    (m) => m.TrialBalance
  ),
  "/finance/accounts-setup": lazyScreen(
    "finance/setup-index",
    () => import("@/screens/finance/setup-index"),
    (m) => m.FinanceSetup
  ),
  "/finance/7soft-parity": lazyScreen(
    "finance/parity",
    () => import("@/screens/finance/parity"),
    (m) => m.FinanceSevenSoftParity
  ),
  "/finance/opening/balances": lazyScreen(
    "finance/opening-balances",
    () => import("@/screens/finance/opening-balances"),
    (m) => m.OpeningBalances
  ),
  "/finance/history": lazyScreen(
    "finance/finance-history",
    () => import("@/screens/finance/finance-history"),
    (m) => m.FinanceHistory
  ),
  "/finance/accounting/chart-of-accounts": lazyScreen(
    "finance/chart-of-accounts",
    () => import("@/screens/finance/chart-of-accounts"),
    (m) => m.ChartOfAccounts
  ),
  "/finance/accounting/accruals": lazyScreen(
    "finance-final/prepaids",
    () => import("@/screens/finance-final/prepaids"),
    (m) => m.PrepaidsAndAccruals
  ),
  "/finance/accounting/prepaids": lazyScreen(
    "finance-final/prepaid-schedules",
    () => import("@/screens/finance-final/prepaid-schedules"),
    (m) => m.PrepaidSchedules
  ),

  "/finance/period-close": lazyScreen(
    "finance-final/controls",
    () => import("@/screens/finance-final/controls"),
    (m) => m.FinanceControls
  ),

  "/finance/reports/balance-sheet": lazyScreen(
    "finance-final/reports/balance-sheet",
    () => import("@/screens/finance-final/reports/balance-sheet"),
    (m) => m.BalanceSheet
  ),
  "/finance/reports/profit-and-loss": lazyScreen(
    "finance-final/reports/profit-and-loss",
    () => import("@/screens/finance-final/reports/profit-and-loss"),
    (m) => m.ProfitAndLoss
  ),
  "/finance/reports/cash-flow": lazyScreen(
    "finance-final/reports/cash-flow",
    () => import("@/screens/finance-final/reports/cash-flow"),
    (m) => m.CashFlow
  ),
  "/finance/reports/profit-and-loss-by-unit": lazyScreen(
    "finance-final/reports/profit-and-loss-by-unit",
    () => import("@/screens/finance-final/reports/profit-and-loss-by-unit"),
    (m) => m.ProfitAndLossByUnit
  ),
  "/finance/reports/balance-sheet-2-years": lazyScreen(
    "finance-final/reports/balance-sheet-2-years",
    () => import("@/screens/finance-final/reports/balance-sheet-2-years"),
    (m) => m.BalanceSheetTwoYears
  ),
  "/finance/reports/cash-bank": lazyScreen(
    "finance-final/cash",
    () => import("@/screens/finance-final/cash"),
    (m) => m.Cash
  ),
  "/finance/reports/dimension-results": lazyScreen(
    "finance/dimension-results",
    () => import("@/screens/finance/dimension-results"),
    (m) => m.DimensionResults
  ),
  "/finance/reports/laporan-accounting": lazyScreen(
    "finance-final/reports/laporan-accounting",
    () => import("@/screens/finance-final/reports/laporan-accounting"),
    (m) => m.LaporanAccounting
  ),
  "/finance/reports/sales-by-division": lazyScreen(
    "finance/sales-by-division",
    () => import("@/screens/finance/sales-by-division"),
    (m) => m.SalesByDivision
  ),
  "/finance/reports/changes-in-equity": lazyScreen(
    "finance/changes-in-equity",
    () => import("@/screens/finance/changes-in-equity"),
    (m) => m.ChangesInEquity
  ),
  "/finance/reports/expenses-by-month": lazyScreen(
    "finance/expenses-by-month",
    () => import("@/screens/finance/expenses-by-month"),
    (m) => m.ExpensesByMonth
  ),
  "/finance/reports/tax-withholding": lazyScreen(
    "finance/withholding-report",
    () => import("@/screens/finance/withholding-report"),
    (m) => m.WithholdingReport
  ),
  "/finance/reports/bank-reconciliation-summary": lazyScreen(
    "finance/bank-reconciliation-summary",
    () => import("@/screens/finance/bank-reconciliation-summary"),
    (m) => m.BankReconciliationSummary
  ),
  "/finance/reports/asset-register": lazyScreen(
    "finance/asset-register",
    () => import("@/screens/finance/asset-register"),
    (m) => m.AssetRegister
  ),
  "/finance/reports/asset-disposals": lazyScreen(
    "finance/asset-disposals",
    () => import("@/screens/finance/asset-disposals"),
    (m) => m.AssetDisposals
  ),

  "/finance/setup/account-links": lazyScreen(
    "finance/account-links",
    () => import("@/screens/finance/account-links"),
    (m) => m.AccountLinks
  ),
  "/finance/setup/posting-readiness": lazyScreen(
    "finance/posting-readiness",
    () => import("@/screens/finance/posting-readiness"),
    (m) => m.PostingReadinessScreen
  ),
  "/finance/setup/line-categories": lazyScreen(
    "finance-final/categories",
    () => import("@/screens/finance-final/categories"),
    (m) => m.LineCategories
  ),
  "/finance/setup/edc-mdr": lazyScreen(
    "finance/sales-setup",
    () => import("@/screens/finance/sales-setup"),
    (m) => m.SalesSetup
  ),
  "/finance/setup/giro-templates": lazyScreen(
    "finance/giro-print",
    () => import("@/screens/finance/giro-print"),
    (m) => m.GiroPrinting
  ),
  "/finance/setup/periods": lazyScreen(
    "finance/periods",
    () => import("@/screens/finance/periods"),
    (m) => m.Periods
  ),
  "/finance/setup/dimensions": lazyScreen(
    "finance/dimensions",
    () => import("@/screens/finance/dimensions"),
    (m) => m.Dimensions
  ),
  "/finance/setup/payment-methods": lazyScreen(
    "finance/payment-methods",
    () => import("@/screens/finance/payment-methods"),
    (m) => m.PaymentMethods
  ),
  "/finance/setup/shop-payment-methods": lazyScreen(
    "finance/shop-payment-methods",
    () => import("@/screens/finance/shop-payment-methods"),
    (m) => m.ShopPaymentMethods
  ),
  "/finance/setup/journal-templates": lazyScreen(
    "finance/journal-templates",
    () => import("@/screens/finance/journal-templates"),
    (m) => m.JournalTemplates
  ),
  "/finance/setup/expense-categories": lazyScreen(
    "finance/expense-categories",
    () => import("@/screens/finance/expense-categories"),
    (m) => m.ExpenseCategories
  ),
  "/finance/setup/pay-components": lazyScreen(
    "finance/pay-components",
    () => import("@/screens/finance/pay-components"),
    (m) => m.PayComponents
  ),
  "/finance/setup/asset-classes": lazyScreen(
    "finance/asset-classes",
    () => import("@/screens/finance/asset-classes"),
    (m) => m.AssetClasses
  ),

  "/finance/closing/period-closing-voucher": lazyScreen(
    "finance/period-closing",
    () => import("@/screens/finance/period-closing"),
    (m) => m.PeriodClosing
  ),

  "/finance/tax-setup/withholding": lazyScreen(
    "finance/taxes",
    () => import("@/screens/finance/taxes"),
    (m) => m.TaxWithholding
  ),
  "/finance/tax-setup/types": lazyScreen(
    "finance/taxes",
    () => import("@/screens/finance/taxes"),
    (m) => m.TaxTypes
  ),

  "/finance/settings/accounts": lazyScreen(
    "finance/finance-settings",
    () => import("@/screens/finance/finance-settings"),
    (m) => m.FinanceSettings
  ),
  "/finance/settings/posting-policies": lazyScreen(
    "finance/posting-policies",
    () => import("@/screens/finance/posting-policies"),
    (m) => m.PostingPolicies
  ),
  "/finance/settings/permissions": lazyScreen(
    "finance/permissions",
    () => import("@/screens/finance/permissions"),
    (m) => m.Permissions
  ),
  // 7Soft menus with no hub screen before 28 Oct 2026.
  "/finance/accounting/info-accounting": lazyScreen(
    "finance/info-accounting",
    () => import("@/screens/finance/info-accounting"),
    (m) => m.InfoAccounting
  ),
  "/finance/reports/kas-bank": lazyScreen(
    "finance/kas-bank-reports",
    () => import("@/screens/finance/kas-bank-reports"),
    (m) => m.LaporanKasBank
  ),
  "/finance/sales/info": lazyScreen(
    "finance/sales-info",
    () => import("@/screens/finance/sales-info"),
    (m) => m.InfoPenjualan
  ),
  "/finance/sales/returns": lazyScreen(
    "finance/sales-returns",
    () => import("@/screens/finance/sales-returns"),
    (m) => m.ReturPenjualan
  ),
  "/finance/reports/penjualan": lazyScreen(
    "finance/sales-reports",
    () => import("@/screens/finance/sales-reports"),
    (m) => m.LaporanPenjualan
  ),
  "/finance/reports/laporan-keuangan": lazyScreen(
    "finance-final/reports/laporan-accounting",
    () => import("@/screens/finance-final/reports/laporan-accounting"),
    (m) => m.LaporanKeuangan
  ),
  "/finance/reports/laporan-manajerial": lazyScreen(
    "finance-final/reports/laporan-accounting",
    () => import("@/screens/finance-final/reports/laporan-accounting"),
    (m) => m.LaporanManajerial
  ),
  "/finance/setup/setting-menu": lazyScreen(
    "finance/setting-menu",
    () => import("@/screens/finance/setting-menu"),
    (m) => m.SettingMenu
  ),
}
