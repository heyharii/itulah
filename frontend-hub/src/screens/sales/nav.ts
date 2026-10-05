import {
  Barcode,
  ClipboardList,
  Clock,
  CreditCard,
  FolderTree,
  Gauge,
  LineChart,
  Megaphone,
  RotateCcw,
  Shirt,
  Store,
  Tags,
  TrendingUp,
  Truck,
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
/// **Sales by store, division, tag, article, SKU, PO, supplier, campaign and
/// payment (30 Sep 2026, owner).** The menu now leads on nine readings of the
/// same question — what did each group sell, and how much of it is still on
/// the shelves — one screen with a different grouping each time
/// (`screens/sales/breakdown.tsx`). What used to be Sales by store here became
/// Store analytics and moved under More; nothing on it changed.
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
      // Owner's menu of 2026-09-28: the department leads on the estate-wide
      // reading and its cuts (division, tag, article, SKU, PO, supplier,
      // campaign, payment), rather than on the
      // single trading-day list — see the module doc above, written for the
      // shape this replaces. Sales, Returns, Member and Shop floor moved
      // under More; none of the four lost anything but their row.
      items: [
        {
          path: "/sales",
          label: "Sales",
          icon: TrendingUp,
          more: true,
        },
        {
          path: "/sales/by-store",
          label: "Sales by store",
          icon: Store,
        },
        {
          path: "/sales/by-division",
          label: "Sales by division",
          icon: FolderTree,
        },
        {
          path: "/sales/by-tag",
          label: "Sales by tag",
          icon: Tags,
        },
        {
          path: "/sales/by-article",
          label: "Sales by article",
          icon: Shirt,
        },
        {
          path: "/sales/by-sku",
          label: "Sales by SKU",
          icon: Barcode,
        },
        {
          path: "/sales/by-po",
          label: "Sales by PO",
          icon: ClipboardList,
        },
        {
          path: "/sales/by-supplier",
          label: "Sales by supplier",
          icon: Truck,
        },
        {
          path: "/sales/by-campaign",
          label: "Sales by campaign",
          icon: Megaphone,
        },
        {
          path: "/sales/by-payment",
          label: "Sales by payment",
          icon: CreditCard,
        },
        {
          // One cashier at one seat, drawer open to drawer counted (owner,
          // 2026-10-01: "sales by session kasir harusnya ada").
          path: "/sales/by-session",
          label: "Sales by cashier session",
          icon: Clock,
        },
        {
          // The store-by-store reading that used to lead the menu: a row per
          // store with time folded into it. Sales by store now answers the
          // usual question; this stays for the trend and the Gaining/Losing
          // ground ranking.
          path: "/sales/analytics",
          label: "Store analytics",
          icon: LineChart,
          moved: ["/storeops/sales-analysis"],
          more: true,
        },
        {
          path: "/sales/returns",
          label: "Returns",
          icon: RotateCcw,
          moved: ["/storeops/returns"],
          more: true,
        },
        {
          path: "/sales/customer",
          label: "Member",
          icon: UserRound,
          moved: ["/storeops/customer"],
          more: true,
        },
        {
          path: "/sales/overview",
          label: "Shop floor",
          icon: Gauge,
          moved: ["/storeops"],
          more: true,
        },
      ],
    },
  ],
}
