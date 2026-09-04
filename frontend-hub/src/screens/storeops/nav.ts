import {
  ClipboardList,
  Gauge,
  LineChart,
  Receipt,
  RotateCcw,
  Store,
  UserRound,
} from "lucide-react"

import type { AppModule } from "@/lib/navigation"

/// This module's row in the sidebar and the sub-items under it.
/// Owned by the module, composed by `lib/navigation.ts` — so adding a screen
/// here never touches another module's file.
///
/// **Sales analysis and Day report arrived here 2026-09-03** when the Analytics
/// module was dissolved. Every shop's takings against the same span before, and
/// one shop's single trading day down to what should be in the drawer, are both
/// the shop floor's own questions — so they sit under the sales they count
/// rather than in a module named after the chart they draw. The third Analytics
/// screen, Margin, went to Commercial for the same reason.
///
/// Day report is not the same thing as the Reports aside: that one is every
/// report anybody composed, this one is a fixed sheet about one till on one
/// date. Two screens can share a word without sharing a home.
///
/// **The fleet's own trade now has its own module** (2026-09-04): `/sales`
/// draws the chart and the shop-by-period matrix head office reads, which is
/// the shape `frontend-cloud` has always had. Sales analysis below is the
/// earlier, narrower answer to the same question and is left where it is; the
/// `Sales` item here is the RECEIPTS list, which is a different screen and not
/// a second copy of anything.
///
/// Returns and Member are listed separately from Sales rather than folded into
/// it. They are different documents against the same trade — a refund is its
/// own record and never an edit of a sale — and a member's history is asked by
/// a different person for a different reason.
export const storeopsNav: AppModule = {
  id: "storeops",
  label: "Store ops",
  icon: Store,
  home: "/storeops",
  /// Hidden from the sidebar for now, on request. Nothing else changes: the
  /// screens stay routed and stay in ⌘K, and the links other modules already
  /// make into them — Members → `/storeops/customer`, the day report →
  /// `/storeops/sales` — keep working. Drop this line to put the row back.
  hidden: true,
  sections: [
    {
      items: [
        { path: "/storeops", label: "Overview", icon: Gauge },
        { path: "/storeops/sales", label: "Sales", icon: Receipt },
        {
          path: "/storeops/sales-analysis",
          label: "Sales analysis",
          icon: LineChart,
        },
        {
          path: "/storeops/day-report",
          label: "Day report",
          icon: ClipboardList,
        },
        { path: "/storeops/returns", label: "Returns", icon: RotateCcw },
        { path: "/storeops/stores", label: "Stores", icon: Store },
        { path: "/storeops/customer", label: "Member", icon: UserRound },
      ],
    },
  ],
}
