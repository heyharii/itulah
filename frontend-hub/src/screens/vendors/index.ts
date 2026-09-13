import type { ScreenMap } from "@/screens/registry"
import { Vendors } from "@/screens/vendors/vendors"

/// Screens this module has written. Keys must be paths declared in
/// `lib/navigation.ts`.
export const screens: ScreenMap = {
  "/vendors": Vendors,
}
