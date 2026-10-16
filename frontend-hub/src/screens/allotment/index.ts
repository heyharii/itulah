import { lazyScreen, type ScreenMap } from "@/screens/registry"

// "Return to HO" — the same book, pre-filtered. Owner's menu of 2026-09-28.

/// Screens this module has written. Keys must be paths declared in
/// `lib/navigation.ts`; anything not listed here renders `Placeholder`.
export const screens: ScreenMap = {
  "/allotment": lazyScreen(
    "allotment/allotments",
    () => import("@/screens/allotment/allotments"),
    (m) => m.Allotments
  ),
  "/allotment/new": lazyScreen(
    "allotment/matrix",
    () => import("@/screens/allotment/matrix"),
    (m) => m.NewAllotment
  ),
  "/allotment/returns": lazyScreen(
    "allotment/returns",
    () => import("@/screens/allotment/returns"),
    (m) => m.ReturnsToHo
  ),
}
