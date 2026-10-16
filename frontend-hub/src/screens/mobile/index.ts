import { lazyScreen, type ScreenMap } from "@/screens/registry"

/// Screens this module has written. Keys must be paths declared in
/// `lib/navigation.ts`; anything not listed here renders `Placeholder`.
export const screens: ScreenMap = {
  "/apps": lazyScreen(
    "mobile/apps",
    () => import("@/screens/mobile/apps"),
    (m) => m.Apps
  ),
}
