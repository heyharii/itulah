import type { ScreenMap } from "@/screens/registry"
import { Sales } from "@/screens/sales/sales"

/// Screens this module has written. Keys must be paths declared in
/// `lib/navigation.ts`; anything not listed here renders `Placeholder`.
export const screens: ScreenMap = {
  "/sales": Sales,
}
