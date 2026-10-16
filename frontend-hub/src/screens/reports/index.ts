import { lazyScreen, type ScreenMap } from "@/screens/registry"

/// One route, two states. Which report is open is a URL parameter rather than
/// a path segment, so the list and the report are the same screen and a link
/// to a report is a link somebody can paste.
export const screens: ScreenMap = {
  "/reports": lazyScreen(
    "reports/reports",
    () => import("@/screens/reports/reports"),
    (m) => m.Reports
  ),
}
