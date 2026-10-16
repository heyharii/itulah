import { lazyScreen, type ScreenMap } from "@/screens/registry"

/// Screens this module has written. Keys must be paths declared in
/// `lib/navigation.ts`.
///
/// Three screens: unlike Assets and Contracts there is no reading-of-one-table
/// here — the repair book, the schedule and the replacement book answer
/// different questions over different tables. Two of them are sidebar rows;
/// replacements are reached from an asset and from the GA overview.
export const screens: ScreenMap = {
  "/maintenance": lazyScreen(
    "maintenance/repairs",
    () => import("@/screens/maintenance/repairs"),
    (m) => m.Repairs
  ),
  "/maintenance/schedule": lazyScreen(
    "maintenance/schedule",
    () => import("@/screens/maintenance/schedule"),
    (m) => m.Schedule
  ),
  "/maintenance/replacements": lazyScreen(
    "maintenance/replacements",
    () => import("@/screens/maintenance/replacements"),
    (m) => m.Replacements
  ),
}
