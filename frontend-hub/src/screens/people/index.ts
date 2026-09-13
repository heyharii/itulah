import type { ScreenMap } from "@/screens/registry"
import { AttendanceDays } from "@/screens/people/attendance-days"
import { Directory } from "@/screens/people/directory"
import { NewEmployees } from "@/screens/people/hire"
import { Overtime } from "@/screens/people/overtime"
import { PeopleOverview } from "@/screens/people/overview"
import { PeopleReports } from "@/screens/people/reports"
import { Terminals } from "@/screens/people/terminals"
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
  "/people/overview": PeopleOverview,
  "/people": Directory,
  "/people/hire": NewEmployees,
  "/people/requests": Requests,
  "/people/overtime": Overtime,
  "/people/roster": Roster,
  "/people/attendance-days": AttendanceDays,
  "/people/periods": Periods,
  "/people/pay": Pay,
  "/people/payroll": PayrollRuns,
  /// One door onto four panels — see `policy.tsx` for why, and for the four
  /// addresses this replaced.
  "/people/reports": PeopleReports,
  "/people/policy": TimePolicy,
  "/people/terminals": Terminals,
}
