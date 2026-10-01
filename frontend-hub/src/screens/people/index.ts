import type { ScreenMap } from "@/screens/registry"
import { ClaimAllowancesPage } from "@/screens/people/allowances-page"
import { AnnualTaxPage } from "@/screens/people/annual-tax-page"
import { AttendanceDays } from "@/screens/people/attendance-days"
import { EmployeeChanges } from "@/screens/people/changes"
import { ClaimTypesPage } from "@/screens/people/claim-types"
import { Claims } from "@/screens/people/claims"
import { Directory } from "@/screens/people/directory"
import { Invitations } from "@/screens/people/invitations"
import { JobRoles } from "@/screens/people/job-roles"
import { Loans } from "@/screens/people/loans-page"
import { Offboarding } from "@/screens/people/offboarding"
import { Onboarding } from "@/screens/people/onboarding"
import { OneOffs } from "@/screens/people/one-offs"
import { OrgChart } from "@/screens/people/org-chart"
import { Overtime } from "@/screens/people/overtime"
import { PeopleOverview } from "@/screens/people/overview"
import { PayrollRuns } from "@/screens/people/payroll"
import { PeopleReports } from "@/screens/people/reports"
import { Reprimands } from "@/screens/people/reprimands"
import { Roster } from "@/screens/people/roster"
import { AbsenceSettings } from "@/screens/people/settings-absence"
import { EmployeeAppSettings } from "@/screens/people/settings-app"
import { AttendanceRuleSettings } from "@/screens/people/settings-attendance"
import { ChecklistSettings } from "@/screens/people/settings-checklists"
import { CompanySettings } from "@/screens/people/settings-company"
import { PayComponentSettings } from "@/screens/people/settings-components"
import { DelegationSettings } from "@/screens/people/settings-delegation"
import { DepartmentSettings } from "@/screens/people/settings-departments"
import { GroupSettings } from "@/screens/people/settings-group"
import { HolidaySettings } from "@/screens/people/settings-holidays"
import { LeaveTypeSettings } from "@/screens/people/settings-leave-types"
import { LevelSettings } from "@/screens/people/settings-levels"
import { MobileSettings } from "@/screens/people/settings-mobile"
import { OvertimeSettings } from "@/screens/people/settings-overtime"
import { PayrollScheduleSettings } from "@/screens/people/settings-payroll-schedule"
import { PayslipSettings } from "@/screens/people/settings-payslip"
import { RateSettings } from "@/screens/people/settings-rates"
import { ShiftSettings } from "@/screens/people/settings-shifts"
import { TaxReportPage } from "@/screens/people/tax-report-page"
import { TeamCalendar } from "@/screens/people/team-calendar"
import { TimeOffRequests } from "@/screens/people/time-off"
import { TimeOffBalances } from "@/screens/people/time-off-balances"

/// Screens this module has written. Keys must be paths declared in
/// `lib/navigation.ts`; anything not listed here renders `Placeholder`.
///
/// One page per sidebar row, grouped as Talenta groups them (owner, 1 Oct
/// 2026): a list with its actions in the header, every form in a sheet. The
/// old tabbed Settings page answers at `/people/settings` only as a redirect
/// to Company & NPP (`moved` in `nav.ts`).
export const screens: ScreenMap = {
  "/people/overview": PeopleOverview,
  // Employees
  "/people": Directory,
  "/people/org-chart": OrgChart,
  "/people/changes": EmployeeChanges,
  "/people/onboarding": Onboarding,
  "/people/offboarding": Offboarding,
  "/people/reprimands": Reprimands,
  "/people/invitations": Invitations,
  // Time
  "/people/leave": TimeOffRequests,
  "/people/leave-balances": TimeOffBalances,
  "/people/attendance-days": AttendanceDays,
  "/people/overtime": Overtime,
  "/people/roster": Roster,
  "/people/calendar": TeamCalendar,
  // Finance
  "/people/claims": Claims,
  "/people/loans": Loans,
  "/people/claim-allowances": ClaimAllowancesPage,
  // Payroll
  "/people/payroll": PayrollRuns,
  "/people/one-offs": OneOffs,
  "/people/tax-report": TaxReportPage,
  "/people/annual-tax": AnnualTaxPage,
  // Reports
  "/people/reports": PeopleReports,
  // Settings · Company
  "/people/settings/company": CompanySettings,
  "/people/settings/group": GroupSettings,
  "/people/settings/departments": DepartmentSettings,
  "/people/settings/levels": LevelSettings,
  // Settings · Time
  "/people/settings/attendance": AttendanceRuleSettings,
  "/people/settings/mobile": MobileSettings,
  "/people/settings/shifts": ShiftSettings,
  "/people/settings/leave-types": LeaveTypeSettings,
  "/people/settings/holidays": HolidaySettings,
  "/people/settings/overtime": OvertimeSettings,
  // Settings · Payroll
  "/people/settings/payroll-schedule": PayrollScheduleSettings,
  "/people/settings/components": PayComponentSettings,
  "/people/settings/payslip": PayslipSettings,
  "/people/settings/absence": AbsenceSettings,
  "/people/settings/rates": RateSettings,
  "/people/claim-types": ClaimTypesPage,
  // Settings · Access
  "/people/job-roles": JobRoles,
  "/people/settings/checklists": ChecklistSettings,
  "/people/settings/delegation": DelegationSettings,
  "/people/settings/app": EmployeeAppSettings,
}
