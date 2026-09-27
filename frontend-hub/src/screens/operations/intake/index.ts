import type { ScreenMap } from "@/screens/registry"

import { InspectReturns } from "@/screens/operations/intake/inspect"
import { Putaway } from "@/screens/operations/intake/putaway"
import { Receiving } from "@/screens/operations/intake/receiving"
import { ReceiveStoreReturn } from "@/screens/operations/intake/returns"

/// Screens this station has written. Keys must be paths declared in
/// `nav.ts`; anything not listed here renders `Placeholder`.
export const screens: ScreenMap = {
  "/operations/intake": Receiving,
  "/operations/intake/returns": ReceiveStoreReturn,
  "/operations/intake/inspect": InspectReturns,
  "/operations/intake/putaway": Putaway,
}
