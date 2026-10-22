import { warmQuery, type PrefetchMap } from "@/lib/prefetch"
import {
  benefitBalancesQuery,
  benefitSettingsQuery,
} from "@/lib/queries/hr-benefit"
import {
  allWarningLettersQuery,
  changeProposalsQuery,
} from "@/lib/queries/hr-employees"
import { rolesQuery } from "@/lib/queries/invitations"
import {
  absenceRulesQuery,
  allLoansQuery,
  businessUnitsQuery,
  checklistTemplatesQuery,
  claimBenefitRulesQuery,
  claimListQuery,
  claimQueueQuery,
  claimTypesQuery,
  companyQuery,
  delegationsQuery,
  departmentsQuery,
  essModulesQuery,
  geofencesQuery,
  groupQuery,
  jobGradesQuery,
  jobLevelsQuery,
  leaveTypesQuery,
  mobileSettingQuery,
  orgChartQuery,
  overtimePolicyQuery,
  overtimeTierQuery,
  payComponentsQuery,
  payrollSchedulesQuery,
  payslipTemplateQuery,
  salaryStructuresQuery,
  shiftsQuery,
  statutoryRatesQuery,
} from "@/lib/queries/people"

/// What People asks first, before the screen is open (`lib/prefetch.ts`).
/// The options are the screens' own (`lib/queries/people.ts` and its
/// neighbours), and each screen reads them by suspending (`awaiting`,
/// `screens/people/suspended.tsx`), so what the server has by the time it
/// renders is in the first HTML and the rest streams in behind it.
///
/// Only the reads a screen opens on in its default state are here. The
/// screens that follow a month, a unit, a tab or a search in the query itself
/// (Roster, Payroll, Time off, Directory...) ask for what the URL and the
/// reach decide, and have nothing to warm ahead of that.
export const prefetch: PrefetchMap = {
  // Employees: Changes opens on its Employment list.
  "/people/changes": (client) => warmQuery(client, changeProposalsQuery()),
  "/people/org-chart": (client) => warmQuery(client, orgChartQuery()),
  "/people/discipline": (client) => warmQuery(client, allWarningLettersQuery()),

  // Claims opens on its Waiting list; History is every claim.
  "/people/claims": (client) => warmQuery(client, claimQueueQuery()),
  "/people/claim-history": (client) => warmQuery(client, claimListQuery()),
  // Loans, and their repayments, are one read.
  "/people/loans": (client) => warmQuery(client, allLoansQuery()),
  "/people/loan-repayments": (client) => warmQuery(client, allLoansQuery()),
  "/people/claim-allowances": (client) =>
    warmQuery(client, claimBenefitRulesQuery()),
  "/people/claim-types": (client) => warmQuery(client, claimTypesQuery()),

  // Benefit
  "/people/benefit": (client) =>
    Promise.all([
      warmQuery(client, benefitBalancesQuery()),
      warmQuery(client, benefitSettingsQuery()),
    ]),

  // Settings · Organization
  "/people/settings/company": (client) => warmQuery(client, companyQuery()),
  "/people/settings/group": (client) =>
    Promise.all([
      warmQuery(client, groupQuery()),
      warmQuery(client, businessUnitsQuery()),
    ]),
  "/people/settings/departments": (client) =>
    warmQuery(client, departmentsQuery()),
  "/people/settings/levels": (client) =>
    Promise.all([
      warmQuery(client, jobLevelsQuery()),
      warmQuery(client, jobGradesQuery()),
    ]),

  // Settings · Attendance
  "/people/settings/shifts": (client) => warmQuery(client, shiftsQuery()),
  "/people/settings/leave-types": (client) =>
    warmQuery(client, leaveTypesQuery()),
  "/people/settings/overtime": (client) =>
    Promise.all([
      warmQuery(client, overtimePolicyQuery()),
      warmQuery(client, overtimeTierQuery()),
    ]),
  "/people/settings/mobile": (client) =>
    Promise.all([
      warmQuery(client, mobileSettingQuery()),
      warmQuery(client, geofencesQuery()),
    ]),

  // Settings · Payroll
  "/people/settings/payroll-schedule": (client) =>
    warmQuery(client, payrollSchedulesQuery()),
  "/people/settings/components": (client) =>
    Promise.all([
      warmQuery(client, salaryStructuresQuery()),
      warmQuery(client, payComponentsQuery()),
    ]),
  "/people/settings/payslip": (client) =>
    warmQuery(client, payslipTemplateQuery()),
  "/people/settings/absence": (client) =>
    warmQuery(client, absenceRulesQuery()),
  "/people/settings/rates": (client) =>
    warmQuery(client, statutoryRatesQuery()),
  "/people/settings/benefit": (client) =>
    warmQuery(client, benefitSettingsQuery()),

  // Settings · Access
  "/people/roles": (client) => warmQuery(client, rolesQuery()),
  "/people/settings/checklists": (client) =>
    warmQuery(client, checklistTemplatesQuery()),
  "/people/settings/delegation": (client) =>
    warmQuery(client, delegationsQuery()),
  "/people/settings/app": (client) => warmQuery(client, essModulesQuery()),
}
