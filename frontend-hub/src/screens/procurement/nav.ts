import {
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
/// **Two sub-items.** Sourcing · Purchase orders: find the goods, then order
/// them. That is a buyer's day, and the module says so.
///
/// It used to be eight rows under two headings. Eight is a table of contents,
/// not navigation — it made one job look like eight, and the four filed under
/// "Master data" were read once a month while taking up half the panel.
///
/// **Suppliers left for the Master data module** on 2026-09-03, at the owner's
/// request. The firm itself is a record the whole business reads — Finance pays
/// it, Articles is minted from what it ships — while what a buyer does with it
/// lives here: its offering is browsed in Sourcing and ordered from in a PO.
/// The screen still reads `queries/procurement`, because where a screen lives
/// and where its data comes from are different questions.
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
  // Sourcing is named in its own URL rather than inheriting the module's.
  //
  // Every other module puts its first screen at the bare module path, and here
  // that put `/procurement` — the name of the DEPARTMENT — on the address bar
  // of a page called Sourcing. It was the only screen in the module whose URL
  // did not say what it was, and it was the one people arrive at first.
  //
  // `base` is what keeps the rest working: the module still owns everything
  // under `/procurement`, so `/procurement/orders` draws this sidebar, and
  // `routes.tsx` redirects the bare path here so old links and bookmarks land
  // on the screen they always did.
  home: "/procurement/sourcing",
  base: "/procurement",
  sections: [
    {
      items: [
        {
          path: "/procurement/sourcing",
          label: "Sourcing",
          icon: PackageSearch,
        },
        {
          path: "/procurement/orders",
          label: "Purchase orders",
          icon: ClipboardList,
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
