import type { ScreenMap } from "@/screens/registry"

import { Allotments } from "@/screens/distribution/allotments"

/// Screens this module has written. Keys must be paths declared in
/// `lib/navigation.ts`; anything not listed here renders `Placeholder`.
export const screens: ScreenMap = {
  "/distribution": Allotments,
}
