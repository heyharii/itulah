import type { ScreenMap } from "@/screens/registry"
import { AttendancePolicy } from "@/screens/people/attendance"
import { Directory } from "@/screens/people/directory"

/// Screens this module has written. Keys must be paths declared in
/// `lib/navigation.ts`; anything not listed here renders `Placeholder`.
///
/// Each module owns this file alone, so two modules being built at once never
/// touch the same registry.
export const screens: ScreenMap = {
  "/people": Directory,
  "/people/attendance": AttendancePolicy,
}
