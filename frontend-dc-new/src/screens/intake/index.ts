import type { ScreenMap } from "@/screens/registry"

import { CountDelivery } from "@/screens/intake/count"
import { Deliveries } from "@/screens/intake/deliveries"
import { DirectIntake } from "@/screens/intake/direct"
import { Verify } from "@/screens/intake/verify"

/// Screens this station has written. Keys must be paths declared in
/// `nav.ts`; anything not listed here renders `Placeholder`.
export const screens: ScreenMap = {
  "/intake": Deliveries,
  "/intake/count": CountDelivery,
  "/intake/verify": Verify,
  "/intake/direct": DirectIntake,
}
