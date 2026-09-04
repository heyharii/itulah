import { TrendingUp } from "lucide-react"

import type { AppModule } from "@/lib/navigation"

/// **Sales** — what anybody actually paid.
///
/// Its own row rather than a screen inside Store ops, and that is the shape
/// `frontend-cloud` has always had: the fleet's takings are read by head office
/// beside the prices it publishes, not by walking into the module that carries
/// one shop's returns and its member lookups. Store ops is hidden from this
/// sidebar today anyway, which had taken the fleet's own trade off the menu
/// with it.
///
/// One screen, so the sidebar draws this as a single row and never unfolds it
/// — see `visibleItems` in `lib/navigation.ts`. That is not a placeholder for a
/// module that will grow: the screen answers two questions at once (how did the
/// fleet trade, and which branch is the reason) and the follow-up to both is a
/// sheet over the same numbers rather than another page.
///
/// It sits after Procurement and before Operations: what is bought, then what
/// is sold, then the building it all moves through.
export const salesNav: AppModule = {
  id: "sales",
  label: "Sales",
  icon: TrendingUp,
  home: "/sales",
  sections: [
    {
      items: [{ path: "/sales", label: "Sales", icon: TrendingUp }],
    },
  ],
}
