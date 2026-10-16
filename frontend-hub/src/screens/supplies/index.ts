import { lazyScreen, type ScreenMap } from "@/screens/registry"

/// Screens this module has written. Keys must be paths declared in
/// `lib/navigation.ts`.
///
/// One door, one screen: the request book, its sheet and the "Minta barang"
/// composer all live over `/supplies`. The stage of a request is read in its
/// sheet rather than as a second screen, because the same request is one
/// record at every stage.
export const screens: ScreenMap = {
  "/supplies": lazyScreen(
    "supplies/supplies",
    () => import("@/screens/supplies/supplies"),
    (m) => m.Supplies
  ),
}
