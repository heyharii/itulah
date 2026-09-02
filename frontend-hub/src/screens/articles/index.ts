import type { ScreenMap } from "@/screens/registry"
import { Articles } from "@/screens/articles/articles"
import { ArticleSetups } from "@/screens/articles/setups"
import { Colours } from "@/screens/articles/colours"

/// Screens this module has written. Keys must be paths declared in
/// `lib/navigation.ts`; anything not listed here renders `Placeholder`.
///
/// Each module owns this file alone, so two modules being built at once never
/// touch the same registry.
export const screens: ScreenMap = {
  "/articles": Articles,
  "/articles/setups": ArticleSetups,
  "/articles/colours": Colours,
}
