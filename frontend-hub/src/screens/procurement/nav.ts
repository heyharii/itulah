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

/// This module's place in the rail and everything under it in the sidebar.
/// Owned by the module, composed by `lib/navigation.ts` — so adding a screen
/// here never touches another module's file.
///
/// **Three surfaces, reached by tabs.** Sourcing · Purchase orders · Suppliers:
/// find the goods, order them, and keep the list of firms you may order from.
/// A buyer's day is those three, and the module now says so.
///
/// It used to be eight rows in a sidebar under two headings. Eight rows is a
/// table of contents, not navigation — it made one job look like eight, and the
/// four that were filed under "Master data" were read once a month while taking
/// up half the panel.
///
/// The other four paths stay declared here, and that is what keeps them routed,
/// linkable and findable in ⌘K. `hidden` only means "not a row in the sidebar":
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
  tint: { top: "#63abff", bottom: "#0a63e8" },
  home: "/procurement",
  sections: [
    {
      items: [
        // Visible so the sidebar has exactly one row — which is what makes it
        // draw nothing at all and hand the width back to the page. See
        // `components/shell/sidebar.tsx`.
        { path: "/procurement", label: "Sourcing", icon: PackageSearch },
        {
          path: "/procurement/orders",
          label: "Purchase orders",
          icon: ClipboardList,
          hidden: true,
        },
        {
          path: "/procurement/suppliers",
          label: "Suppliers",
          icon: Building2,
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
