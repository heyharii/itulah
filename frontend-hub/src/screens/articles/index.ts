import type { ScreenMap } from "@/screens/registry"
import { Articles } from "@/screens/articles/articles"
import { Colours } from "@/screens/articles/colours"

/// Screens this module has written. Keys must be paths declared in
/// `lib/navigation.ts`; anything not listed here renders `Placeholder`.
///
/// Article setups is not among them any more, and not because it was dropped:
/// a setup is done to one delivery, so it is three sheets over `/articles`
/// rather than a screen of its own. See `SetupSheets` in `setups.tsx`.
///
/// Each module owns this file alone, so two modules being built at once never
/// touch the same registry.
export const screens: ScreenMap = {
  "/articles": Articles,
  "/articles/colours": Colours,
}
