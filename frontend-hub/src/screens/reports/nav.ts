import { FileBarChart } from "lucide-react"

import type { AppModule } from "@/lib/navigation"

/// Reports somebody kept.
///
/// Its own thing rather than a screen under Analytics, because the two answer
/// different questions. Analytics was three fixed reports somebody wrote by
/// hand; this is every report anybody composed, including the ones that did not
/// exist when the app was built. A menu whose contents are data does not belong
/// inside a module whose contents are screens.
///
/// **An aside, not a module row** (owner, 2026-09-03: "reports juga diluar, ga
/// ada menu analytics"). A report is pulled from wherever you are standing —
/// it is not a part of the business the way stock or a supplier is — and the
/// Analytics module it would otherwise have sat beside no longer exists: its
/// three screens went to the modules that own the data they count. See
/// `asides` in `lib/navigation.ts`.
export const reportsNav: AppModule = {
  id: "reports",
  label: "Reports",
  icon: FileBarChart,
  home: "/reports",
  aside: true,
  sections: [
    {
      items: [{ path: "/reports", label: "Saved", icon: FileBarChart }],
    },
  ],
}
