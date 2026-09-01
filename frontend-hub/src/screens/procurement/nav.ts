import {
  Building2,
  ClipboardList,
  Hourglass,
  ListChecks,
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
/// The first section is the buyer's day in order: find it, gather it, order it,
/// watch it, chase it, answer for it. The second is the master data those
/// answers are drawn from, which is read far less often and is filed
/// accordingly.
export const procurementNav: AppModule = {
  id: "procurement",
  label: "Procurement",
  icon: ShoppingCart,
  mesh: { c1: "#b6ccff", c2: "#c9bcff", c3: "#5a7cec", base: "#6b8bf0" },
  home: "/procurement",
  sections: [
    {
      items: [
        { path: "/procurement", label: "Sourcing", icon: PackageSearch },
        {
          path: "/procurement/orders",
          label: "Purchase orders",
          icon: ClipboardList,
        },
        {
          path: "/procurement/outstanding",
          label: "Outstanding",
          icon: Hourglass,
          badge: "warn",
        },
        {
          path: "/procurement/amendments",
          label: "Price amendments",
          icon: Percent,
          badge: "warn",
        },
      ],
    },
    {
      label: "Master data",
      items: [
        { path: "/procurement/suppliers", label: "Suppliers", icon: Building2 },
        { path: "/procurement/catalogue", label: "Catalogue", icon: Package },
        {
          path: "/procurement/article-setups",
          label: "Article setups",
          icon: ListChecks,
        },
        {
          path: "/procurement/destinations",
          label: "Destinations",
          icon: Warehouse,
        },
      ],
    },
  ],
}
