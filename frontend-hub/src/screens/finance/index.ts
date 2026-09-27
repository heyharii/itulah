import type { ScreenMap } from "@/screens/registry"

import { AccountLinks } from "@/screens/finance/account-links"
import { AssetClasses } from "@/screens/finance/asset-classes"
import { AssetRegister } from "@/screens/finance/assets"
import { ChartOfAccounts } from "@/screens/finance/chart-of-accounts"
import { DimensionResults } from "@/screens/finance/dimension-results"
import { Dimensions } from "@/screens/finance/dimensions"
import { ExpenseCategories } from "@/screens/finance/expense-categories"
import { FinanceSettings } from "@/screens/finance/finance-settings"
import { GiroPrinting } from "@/screens/finance/giro-print"
import { JournalTemplates } from "@/screens/finance/journal-templates"
import { FinanceOverview } from "@/screens/finance/overview"
import { PayComponents } from "@/screens/finance/pay-components"
import { PaymentMethods } from "@/screens/finance/payment-methods"
import { ShopPaymentMethods } from "@/screens/finance/shop-payment-methods"
import { PeriodClosing } from "@/screens/finance/period-closing"
import { Periods } from "@/screens/finance/periods"
import { Permissions } from "@/screens/finance/permissions"
import { PostingPolicies } from "@/screens/finance/posting-policies"
import { PostingReadinessScreen } from "@/screens/finance/posting-readiness"
import { SalesSetup } from "@/screens/finance/sales-setup"
import { SupplierBills } from "@/screens/finance/supplier-bills"
import { TaxTypes, TaxWithholding } from "@/screens/finance/taxes"
import { Advances } from "@/screens/finance-final/advances"
import { Cash } from "@/screens/finance-final/cash"
import { LineCategories } from "@/screens/finance-final/categories"
import { FinanceControls } from "@/screens/finance-final/controls"
import { Deposits } from "@/screens/finance-final/deposits"
import { Expenses } from "@/screens/finance-final/expenses"
import { Financing } from "@/screens/finance-final/financing"
import { Journals } from "@/screens/finance-final/journals"
import { AccountsPayable } from "@/screens/finance-final/payable"
import { Payments } from "@/screens/finance-final/payments"
import { PrepaidSchedules } from "@/screens/finance-final/prepaid-schedules"
import { PrepaidsAndAccruals } from "@/screens/finance-final/prepaids"
import { AccountsReceivable } from "@/screens/finance-final/receivable"
import { BalanceSheet } from "@/screens/finance-final/reports/balance-sheet"
import { CashFlow } from "@/screens/finance-final/reports/cash-flow"
import { GeneralLedger } from "@/screens/finance-final/reports/general-ledger"
import { ProfitAndLoss } from "@/screens/finance-final/reports/profit-and-loss"
import { TrialBalance } from "@/screens/finance-final/reports/trial-balance"
import { SalesPostings } from "@/screens/finance-final/sales-postings"
import { SalesReconciliation } from "@/screens/finance-final/sales-reconciliation"
import { Tax } from "@/screens/finance-final/tax"
import { Transactions } from "@/screens/finance-final/transactions"
import { BankAccounts } from "@/screens/finance-lab-2/bank-accounts"
import { BankReconciliationList } from "@/screens/finance-lab-2/bank-reconciliation-list"

/// The screens behind the frozen Finance tree (`nav.ts`), one row at a time.
///
/// Each screen is imported from the file it was written in — `finance`,
/// `finance-final` or `finance-lab-2` — rather than moved, so this map is the
/// one place that says which file answers which row. A row not listed renders
/// `Placeholder`: those have no screen yet, and several already have their
/// endpoints on the node (`acquirer-settlements`, `cash-documents`, `giros`,
/// `payment-batches`, `interunit/pairs`, `corrections`,
/// `reports/unit-results`).
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
/// | Overview | `finance/overview` |
/// | Cash & Bank → Bank Accounts | `finance-lab-2/bank-accounts` |
/// | Cash & Bank → Cash Transactions | `finance-final/transactions` |
/// | Cash & Bank → Petty Cash | `finance-final/expenses` |
/// | Cash & Bank → Deposits | `finance-final/deposits` |
/// | Cash & Bank → Bank Reconciliation | `finance-lab-2/bank-reconciliation-list` |
/// | Receivables → Card & EDC Settlement | `finance-final/sales-reconciliation` |
/// | Receivables → Employee Receivables | `finance-final/advances` |
/// | Receivables → Aging, Reports → AR Aging | `finance-final/receivable` |
/// | Receivables → Sales Postings (hidden) | `finance-final/sales-postings` |
/// | Payables → Supplier Bills | `finance/supplier-bills` |
/// | Payables → Payments | `finance-final/payments` |
/// | Payables → Aging, Reports → AP Aging | `finance-final/payable` |
/// | Assets → Capitalization | `finance/assets` |
/// | Financing → Loans | `finance-final/financing` |
/// | Tax → Tax Payables | `finance-final/tax` |
/// | Accounting → Journal Entries | `finance-final/journals` |
/// | Accounting / Reports → General Ledger | `finance-final/reports/general-ledger` |
/// | Accounting / Reports → Trial Balance | `finance-final/reports/trial-balance` |
/// | Accounting → Chart of Accounts | `finance/chart-of-accounts` |
/// | Accounting → Accruals | `finance-final/prepaids` |
/// | Accounting → Prepaids | `finance-final/prepaid-schedules` |
/// | Period Close | `finance-final/controls` |
/// | Reports → Balance Sheet, Profit & Loss, Cash Flow | `finance-final/reports/*` |
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
  "/finance": FinanceOverview,

  "/finance/cash-bank/bank-accounts": BankAccounts,
  "/finance/cash-bank/cash-transactions": Transactions,
  "/finance/cash-bank/petty-cash": Expenses,
  "/finance/cash-bank/deposits": Deposits,
  "/finance/cash-bank/bank-reconciliation": BankReconciliationList,

  "/finance/receivables/card-settlement": SalesReconciliation,
  "/finance/receivables/employee": Advances,
  "/finance/receivables/aging": AccountsReceivable,
  "/finance/receivables/sales-postings": SalesPostings,

  "/finance/payables/bills": SupplierBills,
  "/finance/payables/payments": Payments,
  "/finance/payables/aging": AccountsPayable,

  "/finance/assets/capitalization": AssetRegister,

  "/finance/financing/loans": Financing,

  "/finance/tax/payables": Tax,

  "/finance/accounting/journal-entries": Journals,
  "/finance/accounting/general-ledger": GeneralLedger,
  "/finance/accounting/trial-balance": TrialBalance,
  "/finance/accounting/chart-of-accounts": ChartOfAccounts,
  "/finance/accounting/accruals": PrepaidsAndAccruals,
  "/finance/accounting/prepaids": PrepaidSchedules,

  "/finance/period-close": FinanceControls,

  "/finance/reports/balance-sheet": BalanceSheet,
  "/finance/reports/profit-and-loss": ProfitAndLoss,
  "/finance/reports/cash-flow": CashFlow,
  "/finance/reports/trial-balance": TrialBalance,
  "/finance/reports/general-ledger": GeneralLedger,
  "/finance/reports/ap-aging": AccountsPayable,
  "/finance/reports/ar-aging": AccountsReceivable,
  "/finance/reports/cash-bank": Cash,
  "/finance/reports/dimension-results": DimensionResults,

  "/finance/setup/account-links": AccountLinks,
  "/finance/setup/posting-readiness": PostingReadinessScreen,
  "/finance/setup/line-categories": LineCategories,
  "/finance/setup/edc-mdr": SalesSetup,
  "/finance/setup/giro-templates": GiroPrinting,
  "/finance/setup/periods": Periods,
  "/finance/setup/dimensions": Dimensions,
  "/finance/setup/payment-methods": PaymentMethods,
  "/finance/setup/shop-payment-methods": ShopPaymentMethods,
  "/finance/setup/journal-templates": JournalTemplates,
  "/finance/setup/expense-categories": ExpenseCategories,
  "/finance/setup/pay-components": PayComponents,
  "/finance/setup/asset-classes": AssetClasses,

  "/finance/closing/period-closing-voucher": PeriodClosing,

  "/finance/tax-setup/withholding": TaxWithholding,
  "/finance/tax-setup/types": TaxTypes,

  "/finance/settings/accounts": FinanceSettings,
  "/finance/settings/posting-policies": PostingPolicies,
  "/finance/settings/permissions": Permissions,
}
