import { BarChart3, Coins, LineChart } from "lucide-react"

import type { AppModule } from "@/lib/navigation"

/// This module's place in the rail and everything under it in the sidebar.
/// Owned by the module, composed by `lib/navigation.ts` — so adding a screen
/// here never touches another module's file.
export const analyticsNav: AppModule = {
  id: "analytics",
  label: "Analytics",
  icon: LineChart,
  mesh: { c1: "#a6dbf5", c2: "#b5caf7", c3: "#369cd5", base: "#45a8dd" },
  home: "/analytics",
  sections: [
    {
      items: [
        { path: "/analytics", label: "Reports", icon: BarChart3 },
        { path: "/analytics/sales", label: "Sales analysis", icon: LineChart },
        { path: "/analytics/margin", label: "Margin", icon: Coins },
      ],
    },
  ],
}
