import {
  Banknote,
  BookOpen,
  Hourglass,
  Scale,
  Landmark,
  LayoutGrid,
  Receipt,
  Wallet,
} from "lucide-react"

import type { Module } from "@/lib/nav"

import { lazy } from "react"

import { date, list, listParams, str } from "@/lib/search-schema"
import { today } from "@/lib/format"

/// Each screen in its own chunk, fetched when somebody opens it.
///
/// `lazy` around a named export needs the `.then` because it wants a module
/// whose `default` is the component — writing it once here keeps the shape out
/// of the section list below.
const MoneyScreen = lazy(() =>
  import("@/modules/finance/money").then((m) => ({ default: m.MoneyScreen })),
)
const BillsScreen = lazy(() =>
  import("@/modules/finance/bills").then((m) => ({ default: m.BillsScreen })),
)
const AgingScreen = lazy(() =>
  import("@/modules/finance/aging").then((m) => ({ default: m.AgingScreen })),
)
const PaymentsScreen = lazy(() =>
  import("@/modules/finance/payments").then((m) => ({
    default: m.PaymentsScreen,
  })),
)
const ReconcileScreen = lazy(() =>
  import("@/modules/finance/reconcile").then((m) => ({
    default: m.ReconcileScreen,
  })),
)
const LedgerScreen = lazy(() =>
  import("@/modules/finance/ledger").then((m) => ({ default: m.LedgerScreen })),
)
const OverviewScreen = lazy(() =>
  import("@/modules/finance/overview").then((m) => ({
    default: m.OverviewScreen,
  })),
)

/// Finance — what was owed, what was paid, and where the money sits.
///
/// The sections are the module's own grouping and they are not cosmetic:
/// `Kerja` is what somebody does today, `Buku` is what the books say happened,
/// `Aturan` is what has been ratified and rarely changes. A flat list of eleven
/// screens is eleven screens to read; three groups of three or four is a list
/// somebody scans.
export const financeNav: Module = {
  id: "finance",
  label: "Finance",
  icon: Landmark,
  base: "/finance",
  sections: [
    {
      items: [
        {
          path: "/finance",
          label: "Overview",
          icon: LayoutGrid,
          screen: OverviewScreen,
        },
      ],
    },
    {
      label: "Work",
      items: [
        {
          path: "/finance/bills",
          label: "Supplier bills",
          icon: Receipt,
          screen: BillsScreen,
          search: {
            ...listParams,
            status: str(),
            supplier: str(),
            bill: str(),
          },
        },
        {
          path: "/finance/aging",
          label: "Aged payables",
          icon: Hourglass,
          screen: AgingScreen,
          search: { as_at: date(today), site: str() },
        },
        {
          path: "/finance/payments",
          label: "Payments",
          icon: Banknote,
          screen: PaymentsScreen,
          search: { ...listParams, status: str(), site: str(), payment: str() },
        },
        {
          path: "/finance/money",
          label: "Cash & bank",
          icon: Wallet,
          screen: MoneyScreen,
          /// `site` and `flag` are LISTS, and that is the whole reason `list()`
          /// exists: a repeated key arrives as an array and a single one as a
          /// string, and a screen that forgot would filter on `"BANK".length`
          /// four characters — a bug that looks like a backend fault.
          search: {
            ...listParams,
            as_at: date(today),
            pot: str(),
            site: list(),
            flag: list(),
            account: str(),
          },
        },
        {
          path: "/finance/reconcile",
          label: "Reconcile",
          icon: Scale,
          screen: ReconcileScreen,
          search: { statement: str() },
        },
      ],
    },
    {
      label: "Books",
      items: [
        {
          path: "/finance/ledger",
          label: "Trial balance",
          icon: BookOpen,
          screen: LedgerScreen,
          search: { q: str(), as_at: date(today), site: str() },
        },
      ],
    },
  ],
}
