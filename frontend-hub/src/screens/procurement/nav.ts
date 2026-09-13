import {
  Building2,
  ClipboardList,
  Hourglass,
  Package,
  PackageSearch,
  Percent,
  ShoppingCart,
  Warehouse,
} from "lucide-react"

import type { AppModule } from "@/lib/navigation"

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
/// **Suppliers came back** on 2026-09-12, reversing its move to Master data on
/// 2026-09-03. That module has since been renamed after the record it holds —
/// Articles — and the four lists under it are the words an article is
/// described with. A supplier is not one of those; it is a party the company
/// transacts with, which is this module's subject. The old path is declared on
/// the item as `moved`, so every link anybody has sent still opens the screen.
///
/// **Article setups arrived with it.** A setup turns a delivery that came in
/// under no article into one, and a delivery is a purchase: the trigger and
/// its three sheets sat in Articles' header until 2026-09-12, where they were
/// the one operational act on a master-data screen. They are mounted on the
/// order book now — see `SetupTrigger` and `SetupSheets` in `setups.tsx`.
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
///  - **Destinations** answers "where may a delivery land", parked at the user's
///    request until it has a better home.
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
  sections: [
    {
      items: [
        {
          path: "/procurement/orders",
          label: "Purchase orders",
          icon: ClipboardList,
        },
        {
          path: "/procurement/suppliers",
          label: "Suppliers",
          icon: Building2,
          // Every link to it anybody has sent, every bookmark, and the two
          // screens that deep-link a supplier from an item.
          moved: ["/master/suppliers"],
        },
        {
          // In the sidebar as of 2026-09-13, on the owner's instruction: it is
          // part of Buying, and a screen reachable only from one button on one
          // other screen is a screen most people never learn exists.
          path: "/procurement/sourcing",
          label: "Sourcing",
          icon: PackageSearch,
        },
        {
          path: "/procurement/outstanding",
          label: "Outstanding",
          icon: Hourglass,
          hidden: true,
        },
        {
          path: "/procurement/amendments",
          label: "Price amendments",
          icon: Percent,
          hidden: true,
        },
        {
          path: "/procurement/catalogue",
          label: "Catalogue",
          icon: Package,
          hidden: true,
        },
        {
          path: "/procurement/destinations",
          label: "Destinations",
          icon: Warehouse,
          hidden: true,
        },
      ],
    },
  ],
}
