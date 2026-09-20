import type { ScreenMap } from "@/screens/registry"

import { Cash } from "@/screens/finance-final/cash"
import { LineCategories } from "@/screens/finance-final/categories"
import { Deposits } from "@/screens/finance-final/deposits"
import { Expenses } from "@/screens/finance-final/expenses"
import { Journals } from "@/screens/finance-final/journals"
import { AccountsPayable } from "@/screens/finance-final/payable"
import { PaymentInstructions } from "@/screens/finance-final/payment-instructions"
import { PaymentReconciliation } from "@/screens/finance-final/payment-reconciliation"
import { Payments } from "@/screens/finance-final/payments"
import { Advances } from "@/screens/finance-final/advances"
import { FinanceControls } from "@/screens/finance-final/controls"
import { Financing } from "@/screens/finance-final/financing"
import { PeriodClose } from "@/screens/finance-final/period-close"
import { PrepaidSchedules } from "@/screens/finance-final/prepaid-schedules"
import { Tax } from "@/screens/finance-final/tax"
import { PrepaidsAndAccruals } from "@/screens/finance-final/prepaids"
import { AccountsReceivable } from "@/screens/finance-final/receivable"
import { Ageing } from "@/screens/finance-final/reports/ageing"
import { BalanceSheet } from "@/screens/finance-final/reports/balance-sheet"
import { CashFlow } from "@/screens/finance-final/reports/cash-flow"
import { GeneralLedger } from "@/screens/finance-final/reports/general-ledger"
import { ProfitAndLoss } from "@/screens/finance-final/reports/profit-and-loss"
import { SalesRegister } from "@/screens/finance-final/reports/sales-register"
import { TrialBalance } from "@/screens/finance-final/reports/trial-balance"
import { Sales } from "@/screens/finance-final/sales"
import { SalesReconciliation } from "@/screens/finance-final/sales-reconciliation"
import { Transactions } from "@/screens/finance-final/transactions"

/// Finance final, screen by screen, against the live cloud node.
///
/// Every read here is an endpoint that already exists on the cloud node and is
/// already keyed in `@/lib/queries/finance` — so opening this module alongside
/// the older Finance module costs one request, not two, and the two can never
/// show different numbers for the same account. Where a screen has no endpoint
/// behind it yet it says so on its face rather than drawing a plausible page
/// over nothing.
///
/// | Screen | Stands on |
/// |---|---|
/// | Cash | `GET /finance/money`, `GET /finance/cash-counts` |
/// | Sales | `GET /reports/sales/daily`, `GET /sales` |
/// | Sales reconciliation | `GET /reports/sales/daily`, `GET /finance/money`, `GET /finance/bank-statements` |
/// | Deposits | `GET /finance/bank-statements/{id}/lines`, `GET /finance/cash-counts` |
/// | Expenses | `GET /store/expenses`, `GET /store/petty-cash` |
/// | Transactions | `GET /finance/accounts/{code}/ledger` |
/// | Payment instruction | nothing yet — the ask is not modelled |
/// | Journals | `GET /finance/journal`, `POST /finance/journal`, `POST .../reverse` |
/// | Payments | `GET /finance/payments`, `POST /finance/payments/{id}/post` |
/// | Payment Reconciliation | `GET /finance/payments`, `GET /finance/bills` |
/// | Accounts payable | `GET /finance/payables-aging`, `GET /finance/bills` |
/// | Accounts receivable | nothing yet — no ageing endpoint on the other side |
/// | Prepaids & Accruals | nothing yet — no schedule is kept |
/// | Period close | `GET /finance/periods`, `GET /finance/attention`, `POST /finance/periods/close` |
/// | Line categories | `GET /finance/line-categories`, `GET /finance/asset-classes`, `GET /finance/accounts` |
/// | Reports | `GET /finance/trial-balance`, `GET /finance/statement`, `GET /finance/accounts/{code}/ledger`, `GET /finance/payables-aging` |
export const screens: ScreenMap = {
  // Store — the money a place handles with its hands.
  "/finance-final": Cash,
  "/finance-final/sales": Sales,
  "/finance-final/sales-reconciliation": SalesReconciliation,
  "/finance-final/deposits": Deposits,
  "/finance-final/expenses": Expenses,
  "/finance-final/transactions": Transactions,
  "/finance-final/payment-instructions": PaymentInstructions,

  // Accounting — the book those movements land in.
  "/finance-final/journals": Journals,
  "/finance-final/payments": Payments,
  "/finance-final/payment-reconciliation": PaymentReconciliation,
  "/finance-final/payable": AccountsPayable,
  "/finance-final/receivable": AccountsReceivable,
  "/finance-final/prepaids": PrepaidsAndAccruals,
  "/finance-final/period-close": PeriodClose,

  // The subledgers that had accounts and no documents until 0278-0282, and
  // the control panel that reads all of them at once.
  "/finance-final/prepaid-schedules": PrepaidSchedules,
  "/finance-final/tax": Tax,
  "/finance-final/advances": Advances,
  "/finance-final/financing": Financing,
  "/finance-final/controls": FinanceControls,
  // Not a subledger and not a report: the vocabulary the other twenty screens
  // are written in. Registered in the `finance` module too, at
  // `/finance/categories`, because the chart and its categories are read
  // together and the chart lives over there.
  "/finance-final/categories": LineCategories,

  // Reports — reads the book, belongs to neither.
  "/finance-final/reports/general-ledger": GeneralLedger,
  "/finance-final/reports/trial-balance": TrialBalance,
  "/finance-final/reports/profit-and-loss": ProfitAndLoss,
  "/finance-final/reports/balance-sheet": BalanceSheet,
  "/finance-final/reports/cash-flow": CashFlow,
  "/finance-final/reports/ageing": Ageing,
  "/finance-final/reports/sales-register": SalesRegister,
}
