import type { ScreenMap } from "@/screens/registry"
import { Reports } from "@/screens/reports/reports"

/// One route, two states. Which report is open is a URL parameter rather than
/// a path segment, so the list and the report are the same screen and a link
/// to a report is a link somebody can paste.
export const screens: ScreenMap = {
  "/reports": Reports,
}
