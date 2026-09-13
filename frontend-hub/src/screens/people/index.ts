import type { ScreenMap } from "@/screens/registry"
import { Directory } from "@/screens/people/directory"
import { Overtime } from "@/screens/people/overtime"
import { Pay } from "@/screens/people/pay"
import { PayrollRuns } from "@/screens/people/payroll"
import { Periods } from "@/screens/people/periods"
import { TimePolicy } from "@/screens/people/policy"
import { Roster } from "@/screens/people/roster"
import { Requests } from "@/screens/people/requests"

/// Screens this module has written. Keys must be paths declared in
/// `lib/navigation.ts`; anything not listed here renders `Placeholder`.
///
/// Each module owns this file alone, so two modules being built at once never
/// touch the same registry.
export const screens: ScreenMap = {
  "/people": Directory,
  "/people/requests": Requests,
  "/people/overtime": Overtime,
  "/people/roster": Roster,
  "/people/periods": Periods,
  "/people/pay": Pay,
  "/people/payroll": PayrollRuns,
  /// One door onto four panels — see `policy.tsx` for why, and for the four
  /// addresses this replaced.
  "/people/policy": TimePolicy,
}
