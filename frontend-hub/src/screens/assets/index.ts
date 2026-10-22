import { lazyScreen, type ScreenMap } from "@/screens/registry"

/// Screens this module has written. Keys must be paths declared in
/// `lib/navigation.ts`.
///
/// One path: every kind of the register — a build view, Software, Projects —
/// is a choice in the Kind menu whose value rides in `?asset-view=`, so a new
/// kind is an entry in `BUILD_VIEWS`, not a route.
export const screens: ScreenMap = {
  "/assets": lazyScreen(
    "assets/assets",
    () => import("@/screens/assets/assets"),
    (m) => m.Assets
  ),
}
