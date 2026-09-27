import type { ScreenMap } from "@/screens/registry"
import { Repairs } from "@/screens/maintenance/repairs"
import { Schedule } from "@/screens/maintenance/schedule"
import { Replacements } from "@/screens/maintenance/replacements"

/// Screens this module has written. Keys must be paths declared in
/// `lib/navigation.ts`.
///
/// Three doors, three screens: unlike Assets and Contracts there is no
/// reading-of-one-table here — the repair book, the schedule and the
/// replacement book answer different questions over different tables, which
/// is why Perbaikan comes first and the other two do not narrow it.
export const screens: ScreenMap = {
  "/maintenance": Repairs,
  "/maintenance/schedule": Schedule,
  "/maintenance/replacements": Replacements,
}
