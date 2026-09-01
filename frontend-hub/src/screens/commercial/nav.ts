import {
  Activity,
  BadgeDollarSign,
  FileStack,
  Gauge,
  Percent,
  Store,
  Tags,
} from "lucide-react"

import type { AppModule } from "@/lib/navigation"

/// This module's place in the rail and everything under it in the sidebar.
/// Owned by the module, composed by `lib/navigation.ts` — so adding a screen
/// here never touches another module's file.
export const commercialNav: AppModule = {
  id: "commercial",
  label: "Commercial",
  icon: Tags,
  mesh: { c1: "#ffb3cd", c2: "#ffc79f", c3: "#ee6d97", base: "#f2789f" },
  home: "/commercial",
  sections: [
    {
      items: [
        { path: "/commercial", label: "Overview", icon: Gauge },
        {
          path: "/commercial/price-books",
          label: "Price books",
          icon: FileStack,
        },
        { path: "/commercial/prices", label: "Prices", icon: BadgeDollarSign },
        {
          path: "/commercial/across-shops",
          label: "Across shops",
          icon: Store,
        },
        { path: "/commercial/promotions", label: "Promotions", icon: Percent },
      ],
    },
    {
      label: "Tools",
      items: [
        { path: "/commercial/simulate", label: "Simulate", icon: Activity },
        { path: "/commercial/fleet", label: "Fleet", icon: Store },
      ],
    },
  ],
}
