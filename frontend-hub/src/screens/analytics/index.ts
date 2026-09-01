import type { ScreenMap } from "@/screens/registry"
import { Margin } from "@/screens/analytics/margin"
import { Reports } from "@/screens/analytics/reports"
import { SalesAnalysis } from "@/screens/analytics/sales-analysis"

/// Screens this module has written. Keys must be paths declared in
/// `lib/navigation.ts`; anything not listed here renders `Placeholder`.
///
/// Each module owns this file alone, so two modules being built at once never
/// touch the same registry.
export const screens: ScreenMap = {
  "/analytics": Reports,
  "/analytics/sales": SalesAnalysis,
  "/analytics/margin": Margin,
}
