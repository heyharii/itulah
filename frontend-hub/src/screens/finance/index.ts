import type { ScreenMap } from "@/screens/registry"

import { AccountMap } from "@/screens/finance/account-map"
import { AssetRegister } from "@/screens/finance/assets"
import { BankReconciliation } from "@/screens/finance/bank"
import { ChartOfAccounts } from "@/screens/finance/chart-of-accounts"
// Written once, in the module the forty-account chart was built for, and
// shown in both: a category list is read beside the chart, and the chart is
// here.
import { LineCategories } from "@/screens/finance-final/categories"
import { FinanceOverview } from "@/screens/finance/overview"
import { GeneralLedgerScreen } from "@/screens/finance/general-ledger"
import { GiroPrinting } from "@/screens/finance/giro-print"
import { Journal } from "@/screens/finance/journal"
import { Payments } from "@/screens/finance/payments"
import { Periods } from "@/screens/finance/periods"
import { Reports } from "@/screens/finance/reports"
import { UnmatchedCharges } from "@/screens/finance/unmatched-charges"
import { SupplierBills } from "@/screens/finance/supplier-bills"

/// Screens this module has written. Keys must be paths declared in
/// `lib/navigation.ts`; anything not listed here renders `Placeholder`.
///
/// Each module owns this file alone, so two modules being built at once never
/// touch the same registry.
///
/// The ten below cover every finance endpoint on the cloud node. Ten, and not
/// the twelve there were: `/balances` was a Position screen and is now the
/// per-location reading of Reports; `/trial-balance` was a screen and is now
/// what Ledger shows before an account is chosen. No endpoint lost a home —
/// three of them changed which screen they are read on, which is the whole
/// point of this table.
///
/// | Screen | Endpoints |
/// |---|---|
/// | Overview | reuses the reads below, one cached key each |
/// | Supplier bills | `GET,POST /bills`, `POST /bills/{id}/post`, `GET /unbilled`, `GET /payables-aging` |
/// | Payments | `GET,POST /payments`, `GET /payments/{id}`, `POST /payments/{id}/post` |
/// | Cash & bank | `GET,POST /bank-statements`, `GET .../lines`, `GET .../suggestions`, `POST,DELETE /bank-lines/{id}/match` |
/// | Assets | `GET,POST /assets`, `POST /assets/{id}/assess` |
/// | Journal | `GET,POST /journal`, `GET /journal/{id}`, `POST /journal/{id}/reverse` |
/// | Reports | `GET /statement`, `GET /balances` (the per-location grid) |
/// | Ledger | `GET /trial-balance` (no account chosen), `GET /accounts/{code}/ledger` (one chosen), `GET /accounts` (the search box) |
/// | Chart of accounts | `GET /accounts`, `GET /accounts/{code}` |
/// | Account map | `GET,POST /account-map` |
/// | Line categories | `GET /line-categories`, `GET /asset-classes`, `GET /accounts` |
/// | Period close | `GET,POST /periods`, `POST /periods/close`, `POST /depreciation/run`, and the checklist's read-only borrowings below |
///
/// `GET /payables-aging` is filed under Supplier bills rather than under
/// Reports, and that is a judgement worth stating: an ageing is the list
/// somebody works *from* when deciding who to pay this week, not a statement
/// of the books. It belongs with the workflow that produces it and beside the
/// Payments screen it feeds. The books already answer the same total under
/// `trade_payable`, and the two agree.
///
/// The month-end checklist in Period close re-reads `/account-map`, `/bills`,
/// `/bank-statements` and `/trial-balance` under the keys those four screens
/// already own. They are not listed as its endpoints — each still has a home of
/// its own — but they are why closing a month no longer means visiting four
/// screens and remembering what you saw. `POST /depreciation/run` did move: it
/// was a button on the asset register that always charged the current calendar
/// month, and it is now a checklist row against the month being closed.
export const screens: ScreenMap = {
  "/finance": FinanceOverview,
  "/finance/bills": SupplierBills,
  "/finance/payments": Payments,
  "/finance/bank": BankReconciliation,
  "/finance/unmatched-charges": UnmatchedCharges,
  "/finance/assets": AssetRegister,
  "/finance/journal": Journal,
  "/finance/reports": Reports,
  "/finance/ledger": GeneralLedgerScreen,
  "/finance/accounts": ChartOfAccounts,
  "/finance/account-map": AccountMap,
  "/finance/categories": LineCategories,
  "/finance/periods": Periods,
  "/finance/giro-print": GiroPrinting,
}
