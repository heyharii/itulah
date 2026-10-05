import type { ScreenMap } from "@/screens/registry"

import { Allotments } from "@/screens/allotment/allotments"
import { NewAllotment } from "@/screens/allotment/matrix"
// "Return to HO" — the same book, pre-filtered. Owner's menu of 2026-09-28.
import { ReturnsToHo } from "@/screens/allotment/returns"

/// Screens this module has written. Keys must be paths declared in
/// `lib/navigation.ts`; anything not listed here renders `Placeholder`.
export const screens: ScreenMap = {
  "/allotment": Allotments,
  "/allotment/new": NewAllotment,
  "/allotment/returns": ReturnsToHo,
}
