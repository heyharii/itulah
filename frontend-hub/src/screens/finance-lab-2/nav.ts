import {
  Banknote,
  Building2,
  Calculator,
  Coins,
  Landmark,
  Receipt,
  Wallet,
} from "lucide-react"

import type { AppModule } from "@/lib/navigation"
import { useUnagreedLineCount } from "@/screens/finance-lab-2/hooks"

/// Cash & Bank, rebuilt to ERPNext's shape and wired to the live cloud node.
///
/// # Why a second lab and not an edit to `/finance/bank`
///
/// `finance-lab` is a simulation with no network calls; this one is the
/// opposite — every screen below reads the same endpoints the live Finance
/// module reads, against the same query keys, so the two agree by construction
/// and neither can show a figure the other does not. It is a lab only in the
/// sense that its SHAPE is under review: six screens where Finance has one.
///
/// # Why six, and why cash is not symmetrical with bank
///
/// The two lanes have different sources of truth, and that is the whole reason
/// bank needs more objects than cash:
///
/// ```
/// bank: ledger ↔ bank statement  → Bank Reconciliation
/// cash: ledger ↔ physical count  → Cash Count
/// ```
///
/// So there is no Cash Account, no Cash Transaction and no Cash Reconciliation.
/// A bank statement arrives from outside and has to be modelled — institution,
/// account, line — before anything can be matched against it. Cash has no
/// statement; its counterpart is a person counting notes, which is one document
/// and not three.
///
/// `Bank Reconciliation` keeps the word "Bank" in its name deliberately: this
/// module also owes a Payment Reconciliation one day (payment ↔ invoice), and
/// the two are different jobs that would otherwise share a name.
export const financeLab2Nav: AppModule = {
  id: "finance-lab-2",
  label: "Finance lab 2",
  icon: Wallet,
  home: "/finance-lab-2",
  base: "/finance-lab-2",
  // Amber rather than red: an unagreed bank line is a backlog, not a stoppage.
  badge: "warn",
  useCount: useUnagreedLineCount,
  sections: [
    {
      label: "Cash & Bank",
      items: [
        { path: "/finance-lab-2", label: "Cash", icon: Coins },
        {
          path: "/finance-lab-2/cash-counts",
          label: "Cash Counts",
          icon: Calculator,
        },
        { path: "/finance-lab-2/banks", label: "Banks", icon: Landmark },
        {
          path: "/finance-lab-2/bank-accounts",
          label: "Bank Accounts",
          icon: Building2,
        },
        {
          path: "/finance-lab-2/bank-transactions",
          label: "Bank Transactions",
          icon: Receipt,
        },
        {
          path: "/finance-lab-2/bank-reconciliation",
          label: "Bank Reconciliation",
          icon: Banknote,
          badge: "warn",
          useCount: useUnagreedLineCount,
        },
      ],
    },
  ],
}
