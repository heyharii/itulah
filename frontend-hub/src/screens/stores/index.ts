import { lazyScreen, type ScreenMap } from "@/screens/registry"

/// Screens this module has written. Keys must be paths declared in
/// `nav.ts`; anything not listed here renders `Placeholder`.
export const screens: ScreenMap = {
  "/stores": lazyScreen(
    "stores/list",
    () => import("@/screens/stores/list"),
    (m) => m.StoresList
  ),
  "/stores/exceptions": lazyScreen(
    "stores/exceptions",
    () => import("@/screens/stores/exceptions"),
    (m) => m.StoreExceptions
  ),
  "/stores/apps": lazyScreen(
    "stores/apps",
    () => import("@/screens/stores/apps"),
    (m) => m.StoreApps
  ),
  "/stores/$unit": lazyScreen(
    "stores/detail",
    () => import("@/screens/stores/detail"),
    (m) => m.StoreDetail
  ),
}
