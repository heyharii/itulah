import type { ScreenMap } from "@/screens/registry"
import { Assets } from "@/screens/assets/assets"

/// Screens this module has written. Keys must be paths declared in
/// `lib/navigation.ts`.
export const screens: ScreenMap = {
  "/assets": Assets,
}
