import type { ScreenMap } from "@/screens/registry"
import { Assets } from "@/screens/assets/assets"

/// Screens this module has written. Keys must be paths declared in
/// `lib/navigation.ts`.
///
/// The three asset paths are one screen: the register reads its group off
/// the URL and narrows the endpoint by it, so a new group is a nav entry and
/// a reading, not a screen to write.
export const screens: ScreenMap = {
  "/assets": Assets,
  "/assets/software": Assets,
  "/assets/projects": Assets,
}
