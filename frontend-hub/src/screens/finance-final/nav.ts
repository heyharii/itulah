import {
  ArrowLeftRight,
  Banknote,
  BookOpenCheck,
  CalendarClock,
  Coins,
  FileSpreadsheet,
  FileStack,
  FileText,
  Files,
  HandCoins,
  Landmark,
  Layers,
  Lock,
  Receipt,
  Scale,
  Send,
  ShoppingBag,
  TrendingUp,
  Waves,
} from "lucide-react"

import type { AppModule } from "@/lib/navigation"

/// Finance as the owner settled it: two places money is handled, and the
/// reports that read what both of them left behind.
///
/// # Why only two groups
///
/// Every earlier cut of this module organised itself by accounting concept —
/// Cash & bank, Expenses, Receivables, Accounting, Reports — and every one of
/// them put the same screen in front of two people with different jobs. A store
/// supervisor banking yesterday's takings and a head-office accountant clearing
/// a supplier's invoice both arrive at "Payments", want different columns, and
/// are allowed to do different things.
///
/// So the split here is by **who is standing there**, not by what the entry is
/// called. `Store` is the money a place handles with its hands: notes in a
/// drawer, a day's takings, a slip for the bank, a bill paid out of petty cash.
/// `Accounting` is the book those movements land in, kept by head office.
/// `Reports` reads the book and belongs to neither.
///
/// # Why there is no Chart of accounts row
///
/// Because the chart stopped being a thing anybody navigates. The client's
/// legacy chart carries the location inside the account code — 14 copies of
/// `Cash on Hand`, one per unit, and a 14×14 grid of inter-unit accounts on top
/// — which is a spreadsheet pivot flattened into a list, and the reason their
/// chart is 7,528 rows long. Here the unit is a **dimension on the ledger row**
/// — `journal_line.site_id`, not null on every posting — so one `Cash on Hand`
/// serves all fourteen and the chart is a few hundred meanings. A chart that
/// small is a setting, not a destination: it lives in Master data with the
/// other master lists.
///
/// An inter-unit entry is therefore **one entry whose lines carry two
/// different `site_id`s**; the counter unit is the other lines. There is no
/// `counter_site_id` column in this branch. One exists in the dev database,
/// left behind by migration `0120` which lives only in a parallel lane's
/// worktree and was run against the shared dev database — so a screen written
/// against it here would compile, find the column, and ship a dependency this
/// branch does not have.
///
/// # Why ERPNext's names, where they fit
///
/// `Payment Reconciliation`, `Accounts Payable`, `Period Close` are read
/// straight from ERPNext, which is the reference the owner named. Where our
/// business has a word ERPNext does not — a store `Deposit`, a
/// `Payment instruction` — ours wins, because the point of borrowing a model is
/// the model, not the vocabulary.
export const financeFinalNav: AppModule = {
  id: "finance-final",
  label: "Finance final",
  icon: Landmark,
  home: "/finance-final",
  base: "/finance-final",
  sections: [
    {
      label: "Store",
      items: [
        { path: "/finance-final", label: "Cash", icon: Coins },
        { path: "/finance-final/sales", label: "Sales", icon: ShoppingBag },
        {
          path: "/finance-final/sales-reconciliation",
          label: "Sales reconciliation",
          icon: Scale,
        },
        {
          path: "/finance-final/deposits",
          label: "Deposits",
          icon: Banknote,
        },
        { path: "/finance-final/expenses", label: "Expenses", icon: Receipt },
        {
          path: "/finance-final/transactions",
          label: "Transactions",
          icon: ArrowLeftRight,
        },
        {
          path: "/finance-final/payment-instructions",
          label: "Payment instruction",
          icon: Send,
        },
      ],
    },
    {
      label: "Accounting",
      items: [
        { path: "/finance-final/journals", label: "Journals", icon: FileText },
        {
          path: "/finance-final/payments",
          label: "Payments",
          icon: HandCoins,
        },
        {
          path: "/finance-final/payment-reconciliation",
          label: "Payment Reconciliation",
          icon: BookOpenCheck,
        },
        {
          path: "/finance-final/payable",
          label: "Accounts payable",
          icon: FileStack,
        },
        {
          path: "/finance-final/receivable",
          label: "Accounts receivable",
          icon: Layers,
        },
        {
          path: "/finance-final/prepaids",
          label: "Prepaids & Accruals",
          icon: CalendarClock,
        },
        {
          path: "/finance-final/prepaid-schedules",
          label: "Prepaid schedules",
          icon: CalendarClock,
        },
        {
          path: "/finance-final/tax",
          label: "Tax",
          icon: Scale,
        },
        {
          path: "/finance-final/advances",
          label: "Advances",
          icon: HandCoins,
        },
        {
          path: "/finance-final/financing",
          label: "Financing & owners",
          icon: Landmark,
        },
        {
          path: "/finance-final/controls",
          label: "Controls & close",
          icon: BookOpenCheck,
        },
        {
          path: "/finance-final/period-close",
          label: "Period close",
          icon: Lock,
        },
      ],
    },
    {
      label: "Reports",
      items: [
        {
          path: "/finance-final/reports/general-ledger",
          label: "General Ledger",
          icon: Files,
        },
        {
          path: "/finance-final/reports/trial-balance",
          label: "Trial Balance",
          icon: Scale,
        },
        {
          path: "/finance-final/reports/profit-and-loss",
          label: "Profit & Loss",
          icon: TrendingUp,
        },
        {
          path: "/finance-final/reports/balance-sheet",
          label: "Balance Sheet",
          icon: Landmark,
        },
        {
          path: "/finance-final/reports/cash-flow",
          label: "Cash Flow",
          icon: Waves,
        },
        {
          path: "/finance-final/reports/ageing",
          label: "Payable & Receivable ageing",
          icon: CalendarClock,
        },
        {
          path: "/finance-final/reports/sales-register",
          label: "Sales Register",
          icon: FileSpreadsheet,
        },
      ],
    },
  ],
}
