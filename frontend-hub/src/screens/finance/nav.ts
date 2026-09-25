import {
  Archive,
  Banknote,
  BarChart3,
  CalendarClock,
  CircleAlert,
  FileStack,
  FileText,
  Files,
  Gauge,
  GitBranch,
  Landmark,
  Printer,
  Tags,
  Receipt,
  Wallet,
} from "lucide-react"

import type { AppModule } from "@/lib/navigation"
import {
  useFinanceAttentionCount,
  useMonthNotOpenCount,
  useOverdueBillCount,
  useUnansweredChargeCount,
  useUnmappedMeaningCount,
} from "@/screens/finance/badges"

/// This module's row in the sidebar and the sub-items under it.
/// Owned by the module, composed by `lib/navigation.ts` — so adding a screen
/// here never touches another module's file.
///
/// # Why the groups are jobs and not endpoints
///
/// The first cut of this sidebar had twelve entries in three groups and each
/// one named a URL on the cloud node: Position, Statement, Trial balance,
/// General ledger. That is a map of the server, and an accountant does not
/// have a "trial balance" task — they have a day that goes *work the
/// invoices, then read what the books say, and keep the setup honest*. So the
/// groups are those three jobs, with the overview above them.
///
/// The three entries that went are not three features that went. Position was
/// the balances endpoint asked one family at a time; it is now the "per
/// location" reading of the balance sheet, which is the question it was
/// always answering. The trial balance was a list of every account posted to;
/// it is now what the Ledger shows before you have picked an account, which
/// is where somebody was already going to click. Statement is Reports.
export const financeNav: AppModule = {
  id: "finance",
  label: "Finance",
  icon: Landmark,
  home: "/finance",
  // Red because one of the three it adds up is a stoppage. See
  // `useFinanceAttentionCount`.
  badge: "bad",
  useCount: useFinanceAttentionCount,
  sections: [
    {
      items: [{ path: "/finance", label: "Overview", icon: Gauge }],
    },
    {
      /// What is on somebody's desk today, in the order the day tends to run.
      ///
      /// The bill arrives, the bill is paid, the money is checked against what
      /// the bank says, and what is left over is the register and the entries
      /// nobody else wrote. Payments sits second because that is where it
      /// falls in the day, not because it is the second most important thing —
      /// a group ordered by importance is a group nobody can predict.
      label: "Work",
      items: [
        {
          path: "/finance/bills",
          label: "Supplier bills",
          icon: Receipt,
          // Recorded, not posted, and past due. Amber: the money is late, but
          // nothing is stopped by it.
          badge: "warn",
          useCount: useOverdueBillCount,
        },
        { path: "/finance/payments", label: "Payments", icon: Banknote },
        // "Cash & bank" and not "Bank": the screen is where money leaving and
        // arriving is checked, and a shop's till float is as much of that as a
        // giro transfer. It is a statement list today and becomes the drill-in
        // under that name.
        { path: "/finance/bank", label: "Cash & bank", icon: Wallet },
        // Beside Cash & bank because it is the same question pointed the other
        // way: that screen checks money that arrived, this one lists money that
        // arrived and should not have. Amber, always — a row here is a shopper
        // waiting for a refund, and the branch cannot see it because its own
        // day report balances.
        {
          path: "/finance/unmatched-charges",
          label: "Charges without a sale",
          icon: CircleAlert,
          badge: "warn",
          useCount: useUnansweredChargeCount,
        },
        { path: "/finance/assets", label: "Assets", icon: Archive },
        { path: "/finance/journal", label: "Journal", icon: FileText },
      ],
    },
    {
      /// What the books say, once the work is in them.
      label: "Books",
      items: [
        { path: "/finance/reports", label: "Reports", icon: BarChart3 },
        { path: "/finance/ledger", label: "Ledger", icon: Files },
      ],
    },
    {
      /// The things that have to be right before any of the above can happen.
      label: "Setup",
      items: [
        {
          path: "/finance/accounts",
          label: "Chart of accounts",
          icon: FileStack,
        },
        // Straight after the chart, because since the chart collapsed to forty
        // accounts the two are one reference: the account is the line of the
        // statement, and the category is everything the account code used to
        // carry on its own.
        {
          path: "/finance/categories",
          label: "Line categories",
          icon: Tags,
        },
        {
          path: "/finance/account-map",
          label: "Account map",
          icon: GitBranch,
          // Red rather than amber: a posting that needs an unmapped meaning is
          // refused outright, so this is a stoppage and not a backlog.
          badge: "bad",
          useCount: useUnmappedMeaningCount,
        },
        // Coordinates, one set per bank. Setup rather than Work because it is
        // done once against a real leaf and then not thought about — and when
        // it is wrong, every giro that bank prints is wrong the same way.
        // Finance Connect: EDC terminals, MDR rates, settings and "Tambah
        // bank" — what the sales day and the acquirer settlement lean on.
        {
          path: "/finance/sales-setup",
          label: "Sales & banks",
          icon: Banknote,
        },
        {
          path: "/finance/giro-print",
          label: "Giro printing",
          icon: Printer,
        },
        {
          path: "/finance/periods",
          label: "Period close",
          icon: CalendarClock,
          // One, when this month is not open. Nothing can be posted into a
          // month that does not exist, which somebody usually discovers at the
          // till rather than here.
          badge: "warn",
          useCount: useMonthNotOpenCount,
        },
      ],
    },
  ],
}
