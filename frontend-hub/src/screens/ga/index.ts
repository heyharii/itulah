import type { ScreenMap } from "@/screens/registry"
import { GaOverviewScreen } from "@/screens/ga/overview"

/// Screens this module has written. Keys must be paths declared in
/// `lib/navigation.ts`.
export const screens: ScreenMap = {
  "/ga": GaOverviewScreen,
}
