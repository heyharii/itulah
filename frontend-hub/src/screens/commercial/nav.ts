import { Tags } from "lucide-react"

import type { AppModule } from "@/lib/navigation"

/// This module's place in the rail and everything under it in the sidebar.
/// Owned by the module, composed by `lib/navigation.ts` — so adding a screen
/// here never touches another module's file.
///
/// **One sidebar row, four tabs.** The module was seven screens, then three
/// rows, and is now one row whose four surfaces are reached by tabs inside the
/// page. The reason is that they are four readings of one subject rather than
/// four places: a merchandiser moves between a price, the offer coming off it
/// and the envelope that offer is run in within a single train of thought, and
/// a sidebar makes that a departure each time.
///
/// The other three paths are still declared — that is what routes them, keeps
/// them linkable and keeps the command palette honest — but `hidden` keeps them
/// out of the sidebar, where they would say the same thing the tabs say and
/// fight over which highlight is current.
export const commercialNav: AppModule = {
  id: "commercial",
  label: "Commercial",
  icon: Tags,
  tint: { top: "#ff87a9", bottom: "#f5265b" },
  home: "/commercial",
  sections: [
    {
      items: [
        { path: "/commercial", label: "Commercial", icon: Tags },
        {
          path: "/commercial/promotions",
          label: "Promotions",
          icon: Tags,
          hidden: true,
        },
        {
          path: "/commercial/campaigns",
          label: "Campaign",
          icon: Tags,
          hidden: true,
        },
        {
          path: "/commercial/vouchers",
          label: "Vouchers",
          icon: Tags,
          hidden: true,
        },
      ],
    },
  ],
}
