import { LayoutGrid } from "lucide-react"

import type { AppModule } from "@/lib/navigation"

/// The phone's launcher. (The profile is its own module now: `screens/me`.)
///
/// Both are tabs of the bottom bar (`components/shell/bottom-bar.tsx`) and
/// nothing else — on a desk the rail and the sidebar already are the launcher
/// and the account lives in the sidebar's foot — so the module is registered
/// as `unlisted`: routed, reachable by ⌘K, drawn in no column.
export const mobileNav: AppModule = {
  id: "mobile",
  label: "Apps",
  icon: LayoutGrid,
  home: "/apps",
  sections: [
    {
      items: [{ path: "/apps", label: "Apps", icon: LayoutGrid }],
    },
  ],
}
