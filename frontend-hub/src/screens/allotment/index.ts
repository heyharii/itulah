import type { ScreenMap } from "@/screens/registry"

import { Allotments } from "@/screens/allotment/allotments"
import { NewAllotment } from "@/screens/allotment/matrix"

/// Screens this module has written. Keys must be paths declared in
/// `lib/navigation.ts`; anything not listed here renders `Placeholder`.
export const screens: ScreenMap = {
  "/allotment": Allotments,
  "/allotment/new": NewAllotment,
}
