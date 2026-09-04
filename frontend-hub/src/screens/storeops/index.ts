import type { ScreenMap } from "@/screens/registry"
import { Member } from "@/screens/storeops/customer"
import { Overview } from "@/screens/storeops/overview"
import { Returns } from "@/screens/storeops/returns"
import { DayReport } from "@/screens/storeops/day-report"
import { Sales } from "@/screens/storeops/sales"
import { SalesAnalysis } from "@/screens/storeops/sales-analysis"
import { Stores } from "@/screens/storeops/stores"

/// Screens this module has written. Keys must be paths declared in
/// `lib/navigation.ts`; anything not listed here renders `Placeholder`.
///
/// Each module owns this file alone, so two modules being built at once never
/// touch the same registry.
export const screens: ScreenMap = {
  "/storeops": Overview,
  "/storeops/sales": Sales,
  "/storeops/sales-analysis": SalesAnalysis,
  "/storeops/day-report": DayReport,
  "/storeops/returns": Returns,
  "/storeops/stores": Stores,
  "/storeops/customer": Member,
}
