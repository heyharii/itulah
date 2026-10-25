import { lazyScreen, type ScreenMap } from "@/screens/registry"

/// Screens this module has written. Keys must be paths declared in `nav.ts`.
export const screens: ScreenMap = {
  "/projects": lazyScreen(
    "projects/list",
    () => import("@/screens/projects/list"),
    (m) => m.ProjectsList
  ),
  "/projects/$project": lazyScreen(
    "projects/page",
    () => import("@/screens/projects/page"),
    (m) => m.ProjectScreen
  ),
}
