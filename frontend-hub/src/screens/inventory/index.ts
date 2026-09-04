import type { ScreenMap } from "@/screens/registry"

import { AsOf } from "@/screens/inventory/as-of"
import { Availability } from "@/screens/inventory/availability"
import { Control } from "@/screens/inventory/control"
import { Counts } from "@/screens/inventory/counts"
import { Missing } from "@/screens/inventory/missing"
import { Observations } from "@/screens/inventory/observations"
import { InventoryOverview } from "@/screens/inventory/overview"
import { Pools } from "@/screens/inventory/pools"
import { Reconciliations } from "@/screens/inventory/reconciliations"
import { TimeMachine } from "@/screens/inventory/time-machine"

/// Screens this module has written. Keys must be paths declared in
/// `lib/navigation.ts`; anything not listed here renders `Placeholder`.
///
/// Each module owns this file alone, so two modules being built at once never
/// touch the same registry.
export const screens: ScreenMap = {
  "/inventory": InventoryOverview,
  "/inventory/availability": Availability,
  "/inventory/pools": Pools,
  "/inventory/counts": Counts,
  "/inventory/observations": Observations,
  "/inventory/missing": Missing,
  "/inventory/reconciliations": Reconciliations,
  "/inventory/as-of": AsOf,
  "/inventory/control": Control,
  "/inventory/time-machine": TimeMachine,
}
