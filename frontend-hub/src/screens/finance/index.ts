import type { ScreenMap } from "@/screens/registry"

import { AccountMap } from "@/screens/finance/account-map"
import { AssetRegister } from "@/screens/finance/assets"
import { BankReconciliation } from "@/screens/finance/bank"
import { ChartOfAccounts } from "@/screens/finance/chart-of-accounts"
import { FinanceOverview } from "@/screens/finance/overview"
import { GeneralLedgerScreen } from "@/screens/finance/general-ledger"
import { Journal } from "@/screens/finance/journal"
import { Periods } from "@/screens/finance/periods"
import { Reports } from "@/screens/finance/reports"
import { SupplierBills } from "@/screens/finance/supplier-bills"

/// Screens this module has written. Keys must be paths declared in
/// `lib/navigation.ts`; anything not listed here renders `Placeholder`.
///
/// Each module owns this file alone, so two modules being built at once never
/// touch the same registry.
///
/// The nine below cover all 21 finance endpoints on the cloud node. Nine, and
/// not the twelve there were: `/balances` was a Position screen and is now the
/// per-location reading of Reports; `/trial-balance` was a screen and is now
/// what Ledger shows before an account is chosen. No endpoint lost a home —
/// three of them changed which screen they are read on, which is the whole
/// point of this table.
///
/// | Screen | Endpoints |
/// |---|---|
/// | Overview | reuses the reads below, one cached key each |
/// | Supplier bills | `GET,POST /bills`, `POST /bills/{id}/post`, `GET /unbilled` |
/// | Bank | `GET,POST /bank-statements`, `GET .../lines`, `GET .../suggestions`, `POST,DELETE /bank-lines/{id}/match` |
/// | Assets | `GET,POST /assets`, `POST /assets/{id}/assess`, `POST /depreciation/run` |
/// | Journal | `GET,POST /journal`, `GET /journal/{id}`, `POST /journal/{id}/reverse` |
/// | Reports | `GET /statement`, `GET /balances` (the per-location grid) |
/// | Ledger | `GET /trial-balance` (no account chosen), `GET /accounts/{code}/ledger` (one chosen), `GET /accounts` (the search box) |
/// | Chart of accounts | `GET /accounts`, `GET /accounts/{code}` |
/// | Account map | `GET,POST /account-map` |
/// | Period close | `GET,POST /periods`, `POST /periods/close` |
export const screens: ScreenMap = {
  "/finance": FinanceOverview,
  "/finance/bills": SupplierBills,
  "/finance/bank": BankReconciliation,
  "/finance/assets": AssetRegister,
  "/finance/journal": Journal,
  "/finance/reports": Reports,
  "/finance/ledger": GeneralLedgerScreen,
  "/finance/accounts": ChartOfAccounts,
  "/finance/account-map": AccountMap,
  "/finance/periods": Periods,
}
