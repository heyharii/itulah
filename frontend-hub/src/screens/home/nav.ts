import { Sunrise } from "lucide-react"

import type { AppModule } from "@/lib/navigation"

/// The first row, and the one the app opens on.
///
/// Before this, `/` redirected into Commercial — the first module in the
/// registry — which meant everybody's morning started inside somebody else's
/// screen. A brief is the one page that is nobody's module: four figures about
/// the whole business and a box to ask about them.
///
/// One screen, so the row does not unfold: there is nothing under a brief, and
/// a chevron opening a single sub-item called "Brief" under a row called "Home"
/// would say the same word twice.
export const homeNav: AppModule = {
  id: "home",
  label: "Home",
  icon: Sunrise,
  home: "/home",
  sections: [
    {
      items: [{ path: "/home", label: "Brief", icon: Sunrise }],
    },
  ],
}
