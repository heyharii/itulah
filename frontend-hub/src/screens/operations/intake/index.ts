import type { ScreenMap } from "@/screens/registry"

import { CountDelivery } from "@/screens/operations/intake/count"
import { Deliveries } from "@/screens/operations/intake/deliveries"
import { DirectIntake } from "@/screens/operations/intake/direct"
import { Verify } from "@/screens/operations/intake/verify"

/// Screens this station has written. Keys must be paths declared in
/// `nav.ts`; anything not listed here renders `Placeholder`.
export const screens: ScreenMap = {
  "/operations/intake": Deliveries,
  "/operations/intake/count": CountDelivery,
  "/operations/intake/verify": Verify,
  "/operations/intake/direct": DirectIntake,
}
