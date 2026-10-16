import { lazyScreen, type ScreenMap } from "@/screens/registry"

/// Screens this module has written. Keys must be paths declared in
/// `lib/navigation.ts`; anything not listed here renders `Placeholder`.
///
/// Each module owns this file alone, so two modules being built at once never
/// touch the same registry.
export const screens: ScreenMap = {
  "/members": lazyScreen(
    "members/directory",
    () => import("@/screens/members/directory"),
    (m) => m.Members
  ),
  "/members/segments": lazyScreen(
    "members/segments",
    () => import("@/screens/members/segments"),
    (m) => m.Segments
  ),
  "/members/points": lazyScreen(
    "members/points",
    () => import("@/screens/members/points"),
    (m) => m.Points
  ),
  "/members/points-ledger": lazyScreen(
    "members/points-ledger",
    () => import("@/screens/members/points-ledger"),
    (m) => m.PointsLedger
  ),
}
