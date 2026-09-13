import type { ScreenMap } from "@/screens/registry"
import { SalesAnalytics } from "@/screens/sales/analytics"
import { Member } from "@/screens/sales/customer"
import { Overview } from "@/screens/sales/overview"
import { Returns } from "@/screens/sales/returns"
import { Sales } from "@/screens/sales/sales"

/// Screens this module has written. Keys must be paths declared in
/// `lib/navigation.ts`; anything not listed here renders `Placeholder`.
///
/// Six of these arrived from Store ops on 2026-09-13 when that module was
/// absorbed — see `nav.ts` for why.
export const screens: ScreenMap = {
  "/sales": Sales,
  "/sales/analytics": SalesAnalytics,
  "/sales/returns": Returns,
  "/sales/customer": Member,
  "/sales/overview": Overview,
}
