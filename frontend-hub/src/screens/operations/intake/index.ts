import type { ScreenMap } from "@/screens/registry"

import { Receiving } from "@/screens/operations/intake/receiving"

/// Screens this station has written. Keys must be paths declared in
/// `nav.ts`; anything not listed here renders `Placeholder`.
export const screens: ScreenMap = {
  "/operations/intake": Receiving,
}
