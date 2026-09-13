import {
  Gauge,
  LineChart,
  RotateCcw,
  TrendingUp,
  UserRound,
} from "lucide-react"

import type { AppModule } from "@/lib/navigation"

/// **Sales** — what anybody actually paid, and everything that follows from it.
///
/// This module absorbed Store ops on 2026-09-13, on the owner's instruction,
/// and the merge is the right shape rather than a tidying. Store ops had been
/// `hidden` from the sidebar for a while, which meant six working screens were
/// reachable only by ⌘K or by a link from somewhere else — and every one of
/// them is about the same event. A receipt, a refund against that receipt, one
/// till's close of day, one member's history of buying: those are not a
/// department, they are the trade at four magnifications.
///
/// So the module reads outward from the whole estate to one document:
///
///  * **Sales** — the fleet by trading day, unfolding into the shops that made
///    it. Reads DOWN time.
///  * **Sales analytics** — the same series read ACROSS the estate: a row is a
///    store. "Which branch is the problem" rather than "how was last week".
///  * **Returns** — a refund is its own record and never an edit of a sale, so
///    it is its own screen and not a tab on either of the two above.
///  * **Member** — one shopper's history. Listed here and not in Members
///    because it is a list of SALES, filtered to a person; the Members module
///    links into it, which is the direction that makes sense.
///  * **Shop floor** — the operational overview: which tills are open, what is
///    stuck. Last because it is the only screen here about right now rather
///    than about a span.
///
/// **Receipts and Day report were removed 2026-09-13**, on the owner's
/// instruction, and neither answer is lost with them. The register was a flat
/// list of the newest five hundred sales, which is the first two screens' own
/// content with the grouping taken off; a day at one shop is a row on Sales
/// that unfolds, and the receipts under it are in the sheet that opens from
/// that row. An individual sale still has a record — `?sale=` opens it as a
/// sheet on Sales, which is where every link that used to point at the
/// register now goes.
///
/// Every old `/storeops/…` URL that still has a screen redirects to it,
/// carrying its search parameters — see `moved` below and `routes.tsx`. Those
/// paths are in bookmarks, in notifications and in links people have sent each
/// other, and a 404 is a worse answer than the screen they wanted.
export const salesNav: AppModule = {
  id: "sales",
  label: "Sales",
  icon: TrendingUp,
  home: "/sales",
  sections: [
    {
      items: [
        { path: "/sales", label: "Sales", icon: TrendingUp },
        {
          path: "/sales/analytics",
          label: "Sales analytics",
          icon: LineChart,
          moved: ["/storeops/sales-analysis"],
        },
        {
          path: "/sales/returns",
          label: "Returns",
          icon: RotateCcw,
          moved: ["/storeops/returns"],
        },
        {
          path: "/sales/customer",
          label: "Member",
          icon: UserRound,
          moved: ["/storeops/customer"],
        },
        {
          path: "/sales/overview",
          label: "Shop floor",
          icon: Gauge,
          moved: ["/storeops"],
        },
      ],
    },
  ],
}
