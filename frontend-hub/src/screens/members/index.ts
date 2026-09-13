import type { ScreenMap } from "@/screens/registry"
import { Members } from "@/screens/members/directory"
import { Points } from "@/screens/members/points"
import { PointsLedger } from "@/screens/members/points-ledger"
import { Segments } from "@/screens/members/segments"

/// Screens this module has written. Keys must be paths declared in
/// `lib/navigation.ts`; anything not listed here renders `Placeholder`.
///
/// Each module owns this file alone, so two modules being built at once never
/// touch the same registry.
export const screens: ScreenMap = {
  "/members": Members,
  "/members/segments": Segments,
  "/members/points": Points,
  "/members/points-ledger": PointsLedger,
}
