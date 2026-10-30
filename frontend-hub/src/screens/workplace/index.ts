import { lazyScreen, type ScreenMap } from "@/screens/registry"

/// Screens this module has written. Keys must be paths declared in
/// `lib/navigation.ts`; anything not listed here renders `Placeholder`.
///
/// Each module owns this file alone, so two modules being built at once never
/// touch the same registry.
export const screens: ScreenMap = {
  "/discussions": lazyScreen(
    "workplace/discussions",
    () => import("@/screens/workplace/discussions"),
    (m) => m.Discussions
  ),
  "/chat": lazyScreen(
    "workplace/chat",
    () => import("@/screens/workplace/chat"),
    (m) => m.Chat
  ),
  "/library": lazyScreen(
    "workplace/library",
    () => import("@/screens/workplace/library"),
    (m) => m.Library
  ),
}
