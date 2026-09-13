import type { ScreenMap } from "@/screens/registry"

import { BankAccounts } from "@/screens/finance-lab-2/bank-accounts"
import { BankReconciliation } from "@/screens/finance-lab-2/bank-reconciliation"
import { BankTransactions } from "@/screens/finance-lab-2/bank-transactions"
import { Banks } from "@/screens/finance-lab-2/banks"
import { Cash } from "@/screens/finance-lab-2/cash"
import { CashCounts } from "@/screens/finance-lab-2/cash-counts"

/// Cash & Bank as six screens, against the live cloud node.
///
/// | Screen | Endpoints |
/// |---|---|
/// | Cash | `GET /finance/money` (cash pots) |
/// | Cash Counts | none — nothing is built behind it, and it says so |
/// | Banks | `GET /finance/money`, grouped by `account_map.qualifier` |
/// | Bank Accounts | `GET /finance/money` (bank pot) |
/// | Bank Transactions | `GET /bank-statements`, `GET .../lines` |
/// | Bank Reconciliation | `GET .../lines`, `GET .../suggestions`, `POST,DELETE /bank-lines/{id}/match`, `POST /bank-lines/{id}/book`, `GET /finance/money` |
///
/// No endpoint here is new, and every query key is one the live Finance module
/// already owns — so the two modules share one cache and cannot show different
/// numbers for the same account.
export const screens: ScreenMap = {
  "/finance-lab-2": Cash,
  "/finance-lab-2/cash-counts": CashCounts,
  "/finance-lab-2/banks": Banks,
  "/finance-lab-2/bank-accounts": BankAccounts,
  "/finance-lab-2/bank-transactions": BankTransactions,
  "/finance-lab-2/bank-reconciliation": BankReconciliation,
}
