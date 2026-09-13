import type { ScreenMap } from "@/screens/registry"

import {
  AccrualsDeferrals,
  Adjustments,
  Journals,
  Provisions,
} from "@/screens/finance-lab/accounting"
import { LabAssets } from "@/screens/finance-lab/assets"
import { BankReconciliation } from "@/screens/finance-lab/bank"
import {
  AssetsOverview,
  Depreciation,
  OeReplacement,
  PreOpening,
  Projects,
} from "@/screens/finance-lab/capital"
import { LabClose } from "@/screens/finance-lab/close"
import { Advances, ExpensesOverview } from "@/screens/finance-lab/expenses"
import {
  Equity,
  FinancingOverview,
  Loans,
  Repayments,
} from "@/screens/finance-lab/financing"
import {
  InTransit,
  InventoryAdjustments,
  InventoryOverview,
  InventoryValuation,
} from "@/screens/finance-lab/inventory"
import {
  InterunitDue,
  InterunitFunding,
  InterunitOverview,
  InterunitSettlements,
} from "@/screens/finance-lab/interunit"
import { GeneralLedger } from "@/screens/finance-lab/ledger"
import { MoneyAccounts } from "@/screens/finance-lab/money-accounts"
import { LabOverview } from "@/screens/finance-lab/overview"
import { Payables } from "@/screens/finance-lab/payables"
import { PayrollOverview, PayrollPayables } from "@/screens/finance-lab/payroll"
import { Periods } from "@/screens/finance-lab/periods"
import { Prepaids } from "@/screens/finance-lab/prepaids"
import {
  BalanceSheet,
  CashFlow,
  Consolidated,
  ProfitAndLoss,
  TrialBalance,
} from "@/screens/finance-lab/reports"
import { Rules } from "@/screens/finance-lab/rules"
import {
  Receivables,
  ReceivablesOverview,
  SalesOverview,
} from "@/screens/finance-lab/sales"
import { ChartOfAccounts } from "@/screens/finance-lab/setup"
import { Settlements } from "@/screens/finance-lab/settlements"
import { DirectExpenses, SalesReconcile } from "@/screens/finance-lab/store"
import {
  TaxOverview,
  TaxPayments,
  TaxPositionScreen,
} from "@/screens/finance-lab/tax"
import { Transactions } from "@/screens/finance-lab/transactions"
import { Suppliers, Vendors } from "@/screens/finance-lab/vendors"

/// The fifty-two Finance screens, all written.
///
/// No placeholders: a menu in this module either draws its own data or it is
/// not in the menu. Keys here must match `nav.ts` exactly — `routes.tsx`
/// fails the build if one does not, which is what stops a sidebar entry
/// 404ing or a screen being written with nothing linking to it.
export const screens: ScreenMap = {
  "/finance-lab": LabOverview,

  "/finance-lab/cash/accounts": MoneyAccounts,
  "/finance-lab/cash/transactions": Transactions,
  "/finance-lab/cash/reconcile": BankReconciliation,

  "/finance-lab/expenses": ExpensesOverview,
  "/finance-lab/expenses/suppliers": Suppliers,
  "/finance-lab/expenses/vendors": Vendors,
  "/finance-lab/expenses/bills": Payables,
  "/finance-lab/expenses/spend": DirectExpenses,
  "/finance-lab/expenses/advances": Advances,
  "/finance-lab/expenses/prepaids": Prepaids,

  "/finance-lab/sales": SalesOverview,
  "/finance-lab/sales/reconcile": SalesReconcile,

  "/finance-lab/receivables": ReceivablesOverview,
  "/finance-lab/receivables/balances": Receivables,
  "/finance-lab/receivables/settlements": Settlements,

  "/finance-lab/inventory": InventoryOverview,
  "/finance-lab/inventory/valuation": InventoryValuation,
  "/finance-lab/inventory/in-transit": InTransit,
  "/finance-lab/inventory/adjustments": InventoryAdjustments,

  "/finance-lab/payroll": PayrollOverview,
  "/finance-lab/payroll/payables": PayrollPayables,

  "/finance-lab/affiliation": InterunitOverview,
  "/finance-lab/affiliation/funding": InterunitFunding,
  "/finance-lab/affiliation/due": InterunitDue,
  "/finance-lab/affiliation/settlements": InterunitSettlements,

  "/finance-lab/assets": AssetsOverview,
  "/finance-lab/assets/register": LabAssets,
  "/finance-lab/assets/projects": Projects,
  "/finance-lab/assets/pre-opening": PreOpening,
  "/finance-lab/assets/depreciation": Depreciation,
  "/finance-lab/assets/oe-replacement": OeReplacement,

  "/finance-lab/tax": TaxOverview,
  "/finance-lab/tax/position": TaxPositionScreen,
  "/finance-lab/tax/payments": TaxPayments,

  "/finance-lab/financing": FinancingOverview,
  "/finance-lab/financing/loans": Loans,
  "/finance-lab/financing/repayments": Repayments,
  "/finance-lab/financing/equity": Equity,

  "/finance-lab/accounting/journals": Journals,
  "/finance-lab/accounting/adjustments": Adjustments,
  "/finance-lab/accounting/accruals": AccrualsDeferrals,
  "/finance-lab/accounting/provisions": Provisions,
  "/finance-lab/accounting/rules": Rules,
  "/finance-lab/accounting/chart": ChartOfAccounts,
  "/finance-lab/accounting/close": LabClose,

  "/finance-lab/reports/profit-loss": ProfitAndLoss,
  "/finance-lab/reports/balance-sheet": BalanceSheet,
  "/finance-lab/reports/cash-flow": CashFlow,
  "/finance-lab/reports/trial-balance": TrialBalance,
  "/finance-lab/reports/ledger": GeneralLedger,
  "/finance-lab/reports/consolidated": Consolidated,
}

/// Written but not in the menu, kept so the work is not lost and the build
/// still checks it: the period calendar (folded into Period close) and the
/// posting-rule contract (folded into Schedules & rules).
void Periods
