import { lazyScreen, type ScreenMap } from "@/screens/registry"

/// Screens this module has written. Keys must be paths declared in
/// `lib/navigation.ts`.
///
/// One path, two states — the register and one letter — told apart by
/// `?letter=`, the same way Discussions and Reports do it. A letter is a
/// document somebody sends a colleague a link to, so it has to be a URL.
export const screens: ScreenMap = {
  "/letters": lazyScreen(
    "letters/letters",
    () => import("@/screens/letters/letters"),
    (m) => m.Letters
  ),
}
