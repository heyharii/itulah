import {
  Building2,
  ClipboardList,
  FileUp,
  Hourglass,
  Package,
  PackageSearch,
  Percent,
  ShoppingCart,
  Undo2,
} from "lucide-react"

import type { AppModule } from "@/lib/navigation"
import {
  useBuyingWaiting,
  useOpenReturns,
  useOrdersAwaitingReview,
} from "@/screens/procurement/badges"

/// This module's row in the sidebar and the sub-items under it.
/// Owned by the module, composed by `lib/navigation.ts` — so adding a screen
/// here never touches another module's file.
///
/// **Two sub-items, and one of them is new.** The module's row lands on
/// Purchase orders: an order book is what a buyer opens the app for, and most
/// of what else is here is somewhere they arrive at from it. Sourcing is one
/// of those — a button in the order book's header rather than a peer of it,
/// because "who sells this" is a question asked while raising an order, not
/// instead of one.
///
/// It used to be eight rows under two headings. Eight is a table of contents,
/// not navigation — it made one job look like eight, and the four filed under
/// "Master data" were read once a month while taking up half the panel.
///
/// **Suppliers is in Procurement only** (the owner, 2026-10-05). It had joined
/// the Master menu on 2026-10-04 ("master supplier, master articles, dan semua
/// master") and now stays where the buyer buys. The Master menu keeps the
/// article words — Divisions, Tags, Sizes, Colours. The screen's code is in
/// `procurement/`; `/master/suppliers` redirects to `/procurement/suppliers`.
///
/// Article setups are not here: since 2026-10-02 they are their own page,
/// Merchandise › New articles — see `SetupWorkspace` in `setups.tsx`.
///
/// The other four paths stay declared here, and that is what keeps them routed,
/// linkable and findable in ⌘K. `hidden` only means "not a sub-item": each of
/// these is a place somebody *arrives at* from another screen rather than one
/// they set out for.
///
///  - **Outstanding** is where a line that arrived short is closed. Nothing else
///    performs that write.
///  - **Price amendments** is where a supplier's price change is accepted or
///    refused — and `system/notifications.tsx` sends people straight to it.
///  - **Sourcing** answers "who sells this, and for how much". It is reached
///    from the button in the order book's header and from the basket.
///  - **Catalogue** is the only screen that creates a supplier item. Sourcing
///    browses what it makes; it cannot make one.
///
/// **Destinations found its home** on 2026-10-04: the Master menu is the
/// better home it was parked waiting for, so the row shows there now
/// (`/master/destinations`; the old path redirects — see `moved` on the item
/// in `master/nav.ts`).
///
/// Deleting them is a decision about capability, not about a sidebar, so it is
/// not made here.
export const procurementNav: AppModule = {
  id: "procurement",
  label: "Procurement",
  icon: ShoppingCart,
  // No screen sits at the bare `/procurement`, which is the name of the
  // DEPARTMENT rather than of a page. `base` is what keeps the rest working:
  // the module still owns everything under `/procurement`, so every screen
  // below draws this sidebar, and `routes.tsx` redirects the bare path to
  // `home` so old links and bookmarks land on a screen.
  home: "/procurement/orders",
  base: "/procurement",
  // Drawn on the module's row while it is folded: both rows' numbers together.
  useCount: useBuyingWaiting,
  badge: "warn",
  sections: [
    {
      items: [
        {
          path: "/procurement/orders",
          label: "Purchase Orders",
          short: "Orders",
          icon: ClipboardList,
          // Orders whose count is waiting for the buyer's review.
          useCount: useOrdersAwaitingReview,
          badge: "warn",
        },
        {
          // Procurement only (the owner, 2026-10-05): the supplier master lives
          // where the buyer buys. The Master menu no longer lists it, and its
          // old path lands here, search parameters and all.
          path: "/procurement/suppliers",
          label: "Suppliers",
          icon: Building2,
          moved: ["/master/suppliers"],
        },
        {
          // In the sidebar as of 2026-09-13, on the owner's instruction: it is
          // part of Procurement, and a screen reachable only from one button on one
          // other screen is a screen most people never learn exists.
          path: "/procurement/sourcing",
          label: "Sourcing",
          icon: PackageSearch,
        },
        {
          // Fourth primary row, owner's menu of 2026-09-28: goods a supplier
          // sent that are going back out the same door — a buying question,
          // not a warehouse one, so it sits with the order book rather than
          // with Operations' own returns rows. Pre-filters the allotment book
          // to `RETURN_TO_SUPPLIER` — see `screens/allotment/returns.tsx`.
          path: "/procurement/returns",
          label: "Return PO",
          icon: Undo2,
          // Returns to a supplier that are still open.
          useCount: useOpenReturns,
          badge: "warn",
        },
        {
          // Raising orders from documents — Excel, PDF, photographs — instead
          // of walking the catalogue. Its own screen because its own verb:
          // this reads files and drafts orders, and nothing else here does.
          path: "/procurement/import",
          label: "Import PO",
          icon: FileUp,
          // Hidden on the owner's instruction (2026-09-25) until the import
          // flow is ready to be put in front of buyers. The route stays.
          hidden: true,
        },
        {
          path: "/procurement/outstanding",
          label: "Outstanding",
          icon: Hourglass,
          hidden: true,
        },
        {
          path: "/procurement/amendments",
          label: "Price Amendments",
          icon: Percent,
          hidden: true,
        },
        {
          path: "/procurement/catalogue",
          label: "Catalogue",
          icon: Package,
          hidden: true,
        },
      ],
    },
  ],
}
