import { lazyScreen, type ScreenMap } from "@/screens/registry"

/// Screens this module has written. Keys must be paths declared in
/// `lib/navigation.ts`.
export const screens: ScreenMap = {
  "/vendors": lazyScreen(
    "vendors/vendors",
    () => import("@/screens/vendors/vendors"),
    (m) => m.Vendors
  ),
}
