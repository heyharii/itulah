import type { ScreenMap } from "@/screens/registry"
import { Assets } from "@/screens/assets/assets"

/// Screens this module has written. Keys must be paths declared in
/// `lib/navigation.ts`.
///
/// One path: every reading of the register — a build view, Software,
/// Projects — is a chip whose value rides in `?asset-view=`, so a new reading
/// is an entry in `BUILD_VIEWS`, not a route.
export const screens: ScreenMap = {
  "/assets": Assets,
}
