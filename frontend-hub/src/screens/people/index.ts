import { lazyScreen, type ScreenMap } from "@/screens/registry"

/// Screens this module has written. Keys must be paths declared in
/// `lib/navigation.ts`; anything not listed here renders `Placeholder`.
///
/// One page per tab or view of HR's nine menus (`nav.ts`, owner, 17 Oct
/// 2026): a list with its actions in the header, every form in a sheet. The
/// old Settings and Setup pages answer at `/people/settings` and
/// `/people/hr-setup` only as redirects to Company & NPP (`moved` in
/// `nav.ts`).
export const screens: ScreenMap = {
  // Overview
  "/people/overview": lazyScreen(
    "people/overview",
    () => import("@/screens/people/overview"),
    (m) => m.PeopleOverview
  ),
  // Employees
  "/people": lazyScreen(
    "people/directory",
    () => import("@/screens/people/directory"),
    (m) => m.Directory
  ),
  "/people/org-chart": lazyScreen(
    "people/org-chart",
    () => import("@/screens/people/org-chart"),
    (m) => m.OrgChart
  ),
  "/people/changes": lazyScreen(
    "people/changes",
    () => import("@/screens/people/changes"),
    (m) => m.EmployeeChanges
  ),
  "/people/onboarding": lazyScreen(
    "people/onboarding",
    () => import("@/screens/people/onboarding"),
    (m) => m.Onboarding
  ),
  "/people/offboarding": lazyScreen(
    "people/offboarding",
    () => import("@/screens/people/offboarding"),
    (m) => m.Offboarding
  ),
  "/people/discipline": lazyScreen(
    "people/reprimands",
    () => import("@/screens/people/reprimands"),
    (m) => m.Reprimands
  ),
  "/people/invitations": lazyScreen(
    "people/invitations",
    () => import("@/screens/people/invitations"),
    (m) => m.Invitations
  ),
  // Attendance
  "/people/leave": lazyScreen(
    "people/time-off",
    () => import("@/screens/people/time-off"),
    (m) => m.TimeOffRequests
  ),
  "/people/leave-balances": lazyScreen(
    "people/time-off-balances",
    () => import("@/screens/people/time-off-balances"),
    (m) => m.TimeOffBalances
  ),
  "/people/attendance-days": lazyScreen(
    "people/attendance-days",
    () => import("@/screens/people/attendance-days"),
    (m) => m.AttendanceDays
  ),
  "/people/overtime": lazyScreen(
    "people/overtime",
    () => import("@/screens/people/overtime"),
    (m) => m.Overtime
  ),
  "/people/corrections": lazyScreen(
    "people/corrections",
    () => import("@/screens/people/corrections"),
    (m) => m.Corrections
  ),
  // Schedules
  "/people/roster": lazyScreen(
    "people/roster",
    () => import("@/screens/people/roster"),
    (m) => m.Roster
  ),
  "/people/calendar": lazyScreen(
    "people/team-calendar",
    () => import("@/screens/people/team-calendar"),
    (m) => m.TeamCalendar
  ),
  "/people/swaps": lazyScreen(
    "people/swaps",
    () => import("@/screens/people/swaps"),
    (m) => m.Swaps
  ),
  // Claims
  "/people/claims": lazyScreen(
    "people/claims",
    () => import("@/screens/people/claims"),
    (m) => m.Claims
  ),
  "/people/claim-history": lazyScreen(
    "people/claims",
    () => import("@/screens/people/claims"),
    (m) => m.ClaimHistory
  ),
  // Loans
  "/people/loans": lazyScreen(
    "people/loans-page",
    () => import("@/screens/people/loans-page"),
    (m) => m.Loans
  ),
  "/people/loan-repayments": lazyScreen(
    "people/loan-repayments",
    () => import("@/screens/people/loan-repayments"),
    (m) => m.LoanRepayments
  ),
  // Benefits
  "/people/benefit": lazyScreen(
    "people/benefit-page",
    () => import("@/screens/people/benefit-page"),
    (m) => m.BenefitPage
  ),
  "/people/benefit-history": lazyScreen(
    "people/benefit-history",
    () => import("@/screens/people/benefit-history"),
    (m) => m.BenefitHistory
  ),
  // Payroll
  "/people/payroll": lazyScreen(
    "people/payroll",
    () => import("@/screens/people/payroll"),
    (m) => m.PayrollRuns
  ),
  "/people/adjustments": lazyScreen(
    "people/one-offs",
    () => import("@/screens/people/one-offs"),
    (m) => m.OneOffs
  ),
  "/people/payslips": lazyScreen(
    "people/payslips",
    () => import("@/screens/people/payslips"),
    (m) => m.Payslips
  ),
  "/people/tax-report": lazyScreen(
    "people/tax-report-page",
    () => import("@/screens/people/tax-report-page"),
    (m) => m.TaxReportPage
  ),
  "/people/annual-tax": lazyScreen(
    "people/annual-tax-page",
    () => import("@/screens/people/annual-tax-page"),
    (m) => m.AnnualTaxPage
  ),
  // Overview › Reports
  "/people/reports": lazyScreen(
    "people/reports",
    () => import("@/screens/people/reports"),
    (m) => m.PeopleReports
  ),
  // Settings · Organization
  "/people/settings/company": lazyScreen(
    "people/settings-company",
    () => import("@/screens/people/settings-company"),
    (m) => m.CompanySettings
  ),
  "/people/settings/group": lazyScreen(
    "people/settings-group",
    () => import("@/screens/people/settings-group"),
    (m) => m.GroupSettings
  ),
  "/people/settings/departments": lazyScreen(
    "people/settings-departments",
    () => import("@/screens/people/settings-departments"),
    (m) => m.DepartmentSettings
  ),
  "/people/settings/levels": lazyScreen(
    "people/settings-levels",
    () => import("@/screens/people/settings-levels"),
    (m) => m.LevelSettings
  ),
  // Settings · Attendance
  "/people/settings/attendance": lazyScreen(
    "people/settings-attendance",
    () => import("@/screens/people/settings-attendance"),
    (m) => m.AttendanceRuleSettings
  ),
  "/people/settings/mobile": lazyScreen(
    "people/settings-mobile",
    () => import("@/screens/people/settings-mobile"),
    (m) => m.MobileSettings
  ),
  "/people/settings/shifts": lazyScreen(
    "people/settings-shifts",
    () => import("@/screens/people/settings-shifts"),
    (m) => m.ShiftSettings
  ),
  "/people/settings/leave-types": lazyScreen(
    "people/settings-leave-types",
    () => import("@/screens/people/settings-leave-types"),
    (m) => m.LeaveTypeSettings
  ),
  "/people/settings/holidays": lazyScreen(
    "people/settings-holidays",
    () => import("@/screens/people/settings-holidays"),
    (m) => m.HolidaySettings
  ),
  "/people/settings/overtime": lazyScreen(
    "people/settings-overtime",
    () => import("@/screens/people/settings-overtime"),
    (m) => m.OvertimeSettings
  ),
  // Settings · Payroll
  "/people/settings/payroll-schedule": lazyScreen(
    "people/settings-payroll-schedule",
    () => import("@/screens/people/settings-payroll-schedule"),
    (m) => m.PayrollScheduleSettings
  ),
  "/people/settings/components": lazyScreen(
    "people/settings-components",
    () => import("@/screens/people/settings-components"),
    (m) => m.PayComponentSettings
  ),
  "/people/settings/payslip": lazyScreen(
    "people/settings-payslip",
    () => import("@/screens/people/settings-payslip"),
    (m) => m.PayslipSettings
  ),
  "/people/settings/absence": lazyScreen(
    "people/settings-absence",
    () => import("@/screens/people/settings-absence"),
    (m) => m.AbsenceSettings
  ),
  "/people/settings/rates": lazyScreen(
    "people/settings-rates",
    () => import("@/screens/people/settings-rates"),
    (m) => m.RateSettings
  ),
  "/people/claim-types": lazyScreen(
    "people/claim-types",
    () => import("@/screens/people/claim-types"),
    (m) => m.ClaimTypesPage
  ),
  "/people/claim-allowances": lazyScreen(
    "people/allowances-page",
    () => import("@/screens/people/allowances-page"),
    (m) => m.ClaimAllowancesPage
  ),
  // Settings · Benefits
  "/people/settings/benefit": lazyScreen(
    "people/settings-benefit",
    () => import("@/screens/people/settings-benefit"),
    (m) => m.BenefitSettings
  ),
  // Settings · Access
  "/people/roles": lazyScreen(
    "people/job-roles",
    () => import("@/screens/people/job-roles"),
    (m) => m.JobRoles
  ),
  "/people/settings/checklists": lazyScreen(
    "people/settings-checklists",
    () => import("@/screens/people/settings-checklists"),
    (m) => m.ChecklistSettings
  ),
  "/people/settings/delegation": lazyScreen(
    "people/settings-delegation",
    () => import("@/screens/people/settings-delegation"),
    (m) => m.DelegationSettings
  ),
  "/people/settings/app": lazyScreen(
    "people/settings-app",
    () => import("@/screens/people/settings-app"),
    (m) => m.EmployeeAppSettings
  ),
}
