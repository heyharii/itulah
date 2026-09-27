import type { ScreenMap } from "@/screens/registry"
import { AttendanceDays } from "@/screens/people/attendance-days"
import { Claims } from "@/screens/people/claims"
import { Directory } from "@/screens/people/directory"
import { Grievances } from "@/screens/people/grievances"
import { NewEmployees } from "@/screens/people/hire"
import { Invitations } from "@/screens/people/invitations"
import { Overtime } from "@/screens/people/overtime"
import { PeopleOverview } from "@/screens/people/overview"
import { PeopleReports } from "@/screens/people/reports"
import { Scheduler } from "@/screens/people/scheduler"
import { Terminals } from "@/screens/people/terminals"
import { PayrollRuns } from "@/screens/people/payroll"
import { Periods } from "@/screens/people/periods"
import { PeopleSettings } from "@/screens/people/policy"
import { Roster } from "@/screens/people/roster"

/// Screens this module has written. Keys must be paths declared in
/// `lib/navigation.ts`; anything not listed here renders `Placeholder`.
///
/// Each module owns this file alone, so two modules being built at once never
/// touch the same registry.
export const screens: ScreenMap = {
  /// The front door, and since 2026-09-27 the one queue: what used to be the
  /// Requests screen is drawn on it.
  "/people/overview": PeopleOverview,
  "/people": Directory,
  "/people/hire": NewEmployees,
  "/people/invitations": Invitations,
  "/people/claims": Claims,
  /// The confidential channel, read at head office and nowhere else.
  "/people/grievances": Grievances,
  "/people/overtime": Overtime,
  "/people/roster": Roster,
  "/people/attendance-days": AttendanceDays,
  "/people/periods": Periods,
  "/people/payroll": PayrollRuns,
  "/people/reports": PeopleReports,
  /// One door onto the four time rules — see `policy.tsx` for why, and for
  /// the screens that open from it.
  "/people/settings": PeopleSettings,
  "/people/terminals": Terminals,
  /// The clock's own evidence, and the one door that runs it by hand.
  "/people/scheduler": Scheduler,
}
