import { lazyScreen, type ScreenMap } from "@/screens/registry"

/// Master's article screens, reached from Merchandise. The same components:
/// only the path (and so the department the sidebar lights) differs.
export const screens: ScreenMap = {
  "/merchandise": lazyScreen(
    "master/articles",
    () => import("@/screens/master/articles"),
    (m) => m.Articles
  ),
  "/merchandise/new-articles": lazyScreen(
    "master/new-articles",
    () => import("@/screens/master/new-articles"),
    (m) => m.NewArticles
  ),
  "/merchandise/divisions": lazyScreen(
    "master/vocabulary",
    () => import("@/screens/master/vocabulary"),
    (m) => m.Divisions
  ),
  "/merchandise/tags": lazyScreen(
    "master/vocabulary",
    () => import("@/screens/master/vocabulary"),
    (m) => m.Tags
  ),
  "/merchandise/sizes": lazyScreen(
    "master/vocabulary",
    () => import("@/screens/master/vocabulary"),
    (m) => m.Sizes
  ),
  "/merchandise/colours": lazyScreen(
    "master/colours",
    () => import("@/screens/master/colours"),
    (m) => m.Colours
  ),
  "/merchandise/name-suggestions": lazyScreen(
    "master/name-suggestions",
    () => import("@/screens/master/name-suggestions"),
    (m) => m.NameSuggestions
  ),
  "/merchandise/units": lazyScreen(
    "inventory/units",
    () => import("@/screens/inventory/units"),
    (m) => m.Units
  ),
}
