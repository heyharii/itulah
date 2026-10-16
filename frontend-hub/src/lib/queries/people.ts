import { queryOptions, useQuery } from "@tanstack/react-query"

import { node } from "@/lib/api"
import { ApiError } from "@itulah/contract/client"
import type { Tone } from "@/lib/format"
import { approvalWord, STATUS } from "@/lib/words"
import type {
  CalendarView,
  CalendarYearsView,
  ContractsView,
  EdgeTarget,
  EmployeeSummary,
  EmployeeView,
  ExpiringContract,
  LeaveBalanceRow,
  LeavePolicyView,
  LeaveRequestView,
  LeaveTypeView,
  OvertimeOrderView,
  OvertimePolicyView,
  PayComponentView,
  PayRecordView,
  PayrollIdentityView,
  RatifyStatutoryRateBody,
  StatutoryRateView,
  WithholdingView,
  DepartmentView,
  JobLevelView,
  JobGradeView,
  PlacementView,
  OrgChartNode,
  CompanyView,
  SaveDepartmentBody,
  SaveJobLevelBody,
  SaveJobGradeBody,
  PlaceBody,
  RegisterBpjsBody,
  BusinessUnitView,
  GroupEntityView,
  SaveBusinessUnitBody,
  SaveGroupEntityBody,
  ChecklistTemplateView,
  MobileAttendanceSetting,
  GeofenceView,
  SaveMobileSettingBody,
  SetGeofenceBody,
  AbsenceRuleView,
  OvertimeTierView,
  LeaveBlackoutView,
  ClaimBenefitView,
  WarningLetterView,
  DelegationView,
  EssModulesView,
  ClaimBalanceRow,
  LeaveEncashmentView,
  HolidayWorkView,
  TeamCalendarView,
  StateAbsenceRuleBody,
  SaveChecklistTemplateBody,
  LoanView,
  GrantLoanBody,
  PayslipTemplate,
  SaveTemplateBody,
  TaxReportRow,
  AnnualTaxSlip,
  PayrollScheduleView,
  StateScheduleBody,
  SalaryStructureView,
  SaveStructureBody,
  TaxTablesView,
  PayrollHandoverView,
  PayrollRunView,
  PayrollSlipRow,
  PeriodView,
  RosterDayView,
  RunReconciliation,
  ShiftView,
  PersonalDataView,
  PolicyScheduleView,
  ProvisionedAccount,
  ReachView,
  AttendanceRangeView,
  BookPublished,
  CorrectionRow,
  EnrolmentView,
  HireProposalView,
  PunchReadinessView,
  TerminalRow,
  TodayView,
} from "@itulah/contract"

/// Who works here, under what contract, and where they are posted — plus the
/// one rule that measures all of them.
///
/// Every shape below is generated from the Rust struct the server serialises,
/// unlike `commercial.ts` and `procurement.ts`, which transcribe `json!()`
/// literals by hand. Nothing here has to be kept in step by remembering to.
///
/// # Two routes that both sound like a profile
///
/// `/profile` is who somebody is **at work**: number, job, unit, joining date.
/// `/personal-data` is NIK, address and date of birth. They are separate
/// because they are separate privileges — a supervisor reading a rota gets the
/// first and never the second — and mixing them is how a national identity
/// number ends up on a screen that only wanted a job title.
///
/// This surface reads neither. The directory needs the workforce list and one
/// employee's record, and it can amend personal data without ever fetching it:
/// an amendment names the field it changes, so the screen that writes a new
/// address does not have to display the old one. That is a deliberate refusal
/// rather than an omission — the least this screen can be entitled to is the
/// least it should ask for.
///
/// # Every write carries a reason
///
/// Not decoration: the server refuses a decision without one, because a record
/// that says what changed but not why is the half of an audit trail that never
/// helps anybody.

export type Transition = "HIRE" | "SUSPEND" | "REINSTATE" | "TERMINATE"

export const TRANSITIONS: readonly Transition[] = [
  "HIRE",
  "SUSPEND",
  "REINSTATE",
  "TERMINATE",
]

export type ContractKind = "PKWT" | "PKWTT"

/// The fields an amendment may name, as `amend_personal_data` spells them.
///
/// `birth_date` travels in its own field rather than in `value`, which is why
/// this is a list of literals and not a free string: the server parses a date
/// there and a string here, and a form that could send the wrong one would
/// produce a validation error nobody could act on.
export const AMENDABLE_FIELDS = [
  "name",
  "nik",
  "birth_date",
  "address",
  "phone",
  "email",
] as const

export type AmendableField = (typeof AMENDABLE_FIELDS)[number]

/// Only `phone` and `email` may be cleared; the rest must be given a value.
export function clearable(field: AmendableField): boolean {
  return field === "phone" || field === "email"
}

/// What to ask the workforce list for.
///
/// `q`, `sort` and `dir` are the server's now. They were the browser's: the
/// Directory fetched a thousand rows and searched and sorted them here, which
/// is a search of whatever the first thousand happened to be. `cursor` comes
/// back from a previous page — see `listWorkforce`.
export interface EmployeeFilters {
  /// Free text over the employee number and the person's name.
  readonly q?: string
  readonly status?: string
  readonly unitId?: string
  /// `PKWT`, `PKWTT` or `NONE` — the latest contract's kind.
  readonly contractKind?: string
  /// The latest contract's position, compared whole.
  readonly position?: string
  /// `1` for somebody with a bound login, `0` for somebody without.
  readonly login?: string
  /// `code`, `name`, `contract_end` or `unit` — the closed set the server
  /// names. Anything else is the house order rather than an error.
  readonly sort?: string
  /// `desc`, or left out for ascending.
  readonly dir?: string
  readonly cursor?: string
  readonly limit?: number
}

export interface NewPolicy {
  readonly effectiveFrom: string
  readonly lateGraceMinutes: number
  readonly earlyLeaveGraceMinutes: number
  readonly overtimeMinimumMinutes: number
  readonly duplicatePunchWindowMinutes: number
  readonly reason: string
}

/// Keys live beside the function that fetches them. The first segment is the
/// domain namespace, so signing out drops the whole module's answers by prefix
/// — which matters more here than anywhere else on this surface: the next
/// person at this desk is not entitled to the last one's workforce record.
export const peopleKeys = {
  all: ["people"] as const,
  employees: (filters: EmployeeFilters = {}) =>
    [
      "people",
      "employees",
      filters.q ?? null,
      filters.status ?? null,
      filters.unitId ?? null,
      filters.contractKind ?? null,
      filters.position ?? null,
      filters.login ?? null,
      // The sort is part of the key because it is now part of the ANSWER: the
      // server returns one page in that order, so two sorts are two different
      // answers and must not share a cache entry.
      filters.sort ?? null,
      filters.dir ?? null,
      filters.cursor ?? null,
      filters.limit ?? null,
    ] as const,
  /// Every workforce read — the directory's pages, every picker's list and
  /// every record under them. What a write to one employee invalidates: a
  /// change of status, posting or login moves them in every list at once.
  lists: () => ["people", "employees"] as const,
  /// The directory's infinite list — every page of one scope under one key,
  /// so the cursor is not part of it. Under `["people", "employees"]`, so a
  /// write that invalidates that prefix refreshes the directory too.
  workforce: (filters: Omit<EmployeeFilters, "cursor"> = {}) =>
    [
      "people",
      "employees",
      "pages",
      filters.q ?? null,
      filters.status ?? null,
      filters.unitId ?? null,
      filters.contractKind ?? null,
      filters.position ?? null,
      filters.login ?? null,
      filters.sort ?? null,
      filters.dir ?? null,
      filters.limit ?? null,
    ] as const,
  employee: (id: string) => ["people", "employees", id] as const,
  contracts: (id: string) => ["people", "employees", id, "contracts"] as const,
  /// Every version of the schedule, whatever date it was asked about. The
  /// `as_of` picker makes a key per date, and writing a new version changes the
  /// answer for all of them — so the write invalidates this prefix and the
  /// reads sit under it.
  policies: () => ["people", "attendance-policy"] as const,
  expiring: (withinDays: number) =>
    ["people", "employees", "expiring", withinDays] as const,
  policy: (asOf?: string) =>
    ["people", "attendance-policy", asOf ?? "today"] as const,
  /// How far the signed-in person reaches. One key, no arguments — it is a
  /// fact about the session, and signing out drops it with the rest of the
  /// module's answers by prefix.
  reach: () => ["people", "reach"] as const,
  /// The units the caller may act in. Derived from the workforce list's own
  /// facets rather than from a register of its own — see `useReachableUnits`.
  units: () => ["people", "units"] as const,
}

// ── reads ──────────────────────────────────────────────────────────────────

/// One page of the workforce, beside the size and shape of the whole answer.
///
/// Deliberately not a list of employee records: it is read far more often than
/// any one person is opened, and it carries a name and nothing else from the
/// profile — see `domain::employment::audit`.
///
/// The envelope is the shape `GET /finance/money` established — the rows, an
/// opaque `next_cursor`, the `total` of everything MATCHED rather than of the
/// page, and facet counts to fill a filter panel with. `unit_id` is the unit
/// the server actually answered about, which for a caller posted to one shop is
/// their shop whether or not they asked: a directory that silently showed eight
/// people where the company has ninety would read as a company of eight.
///
/// `facets.units` is empty for such a caller. That is not "no units matched"
/// — it is "you reach one unit, so there is no choice to offer".
///
/// Typed structurally rather than against the generated `EmployeeList`, only
/// until `make contract` is next run. When it is, this becomes that import and
/// the shape below goes.
export interface WorkforcePage {
  readonly unit_id: string | null
  readonly rows: EmployeeSummary[]
  readonly next_cursor: string | null
  readonly total: number
  readonly facets: {
    readonly statuses: ReadonlyArray<{
      readonly value: string
      readonly label: string | null
      readonly count: number
    }>
    readonly units: ReadonlyArray<{
      readonly value: string
      readonly label: string | null
      readonly count: number
    }>
    /// `PKWT`, `PKWTT`, `NONE`.
    readonly contract_kinds: ReadonlyArray<{
      readonly value: string
      readonly label: string | null
      readonly count: number
    }>
    readonly positions: ReadonlyArray<{
      readonly value: string
      readonly label: string | null
      readonly count: number
    }>
    /// `1` with a login, `0` without.
    readonly logins: ReadonlyArray<{
      readonly value: string
      readonly label: string | null
      readonly count: number
    }>
  }
}

export function listWorkforce(
  filters: EmployeeFilters = {},
  signal?: AbortSignal
): Promise<WorkforcePage> {
  const params = new URLSearchParams()
  if (filters.q) params.set("q", filters.q)
  if (filters.status) params.set("status", filters.status)
  if (filters.unitId) params.set("unit_id", filters.unitId)
  if (filters.contractKind) params.set("contract_kind", filters.contractKind)
  if (filters.position) params.set("position", filters.position)
  if (filters.login) params.set("login", filters.login)
  if (filters.sort) params.set("sort", filters.sort)
  if (filters.dir) params.set("dir", filters.dir)
  if (filters.cursor) params.set("cursor", filters.cursor)
  if (filters.limit) params.set("limit", String(filters.limit))
  const suffix = params.size > 0 ? `?${params.toString()}` : ""
  // Only what the server named. The route refuses a parameter it does not
  // know rather than ignoring it, so a typo here is a 400 and not a screen
  // quietly listing the whole company under a filter nobody applied.
  return node.get<WorkforcePage>(`/api/v1/employees${suffix}`, { signal })
}

/// The rows alone, for the screens that hold the whole list and work on it
/// locally — the roster, payroll and overtime pickers, and the command bar.
///
/// One place unwraps the envelope rather than eight, which is the only reason
/// this route's answer could change shape without touching the screens that
/// read it. A screen that wants the total or the facets calls `listWorkforce`
/// instead; a screen that pages MUST, because the rows alone cannot say
/// whether there are more.
export function listEmployees(
  filters: EmployeeFilters = {},
  signal?: AbortSignal
): Promise<EmployeeSummary[]> {
  return listWorkforce(filters, signal).then((page) => page.rows)
}

export function readEmployee(
  employeeId: string,
  signal?: AbortSignal
): Promise<EmployeeView> {
  return node.get<EmployeeView>(
    `/api/v1/employees/${encodeURIComponent(employeeId)}`,
    { signal }
  )
}

export function readContracts(
  employeeId: string,
  signal?: AbortSignal
): Promise<ContractsView> {
  return node.get<ContractsView>(
    `/api/v1/employees/${encodeURIComponent(employeeId)}/contracts`,
    { signal }
  )
}

/// What "late" means, and since when.
///
/// Reading it needs nothing but a session: somebody measured against a
/// tolerance is entitled to know it, and a rule kept from the people it governs
/// is not a rule but a trap. An empty schedule is not an error — head office
/// simply has not decided yet, and the server says so with `uncovered`.
export function readAttendancePolicy(
  asOf?: string,
  signal?: AbortSignal
): Promise<PolicyScheduleView> {
  const suffix = asOf ? `?as_of=${encodeURIComponent(asOf)}` : ""
  return node.get<PolicyScheduleView>(`/api/v1/attendance-policy${suffix}`, {
    signal,
  })
}

/// Which units this caller may act in, and where they are posted.
///
/// Answered by the server rather than derived here from `unit_id`. The rule —
/// head office reaches everywhere, a shop reaches itself, no posting reaches
/// nothing — is enforced on every route, and a browser that re-implemented it
/// would be a second place it is decided. When the two disagreed, the screen
/// would be the one that looked right.
export function readReach(signal?: AbortSignal): Promise<ReachView> {
  return node.get<ReachView>("/api/v1/employees/me/reach", { signal })
}

// ── writes ─────────────────────────────────────────────────────────────────

/// HIRE, SUSPEND, REINSTATE or TERMINATE, on a date.
///
/// `effective_on` is separate from "now" on purpose: employment changes are
/// decided before or after they take effect far more often than at the moment
/// they do, and a record that dated them by the keystroke would be wrong about
/// nearly every one.
export function applyTransition(
  employeeId: string,
  transition: Transition,
  effectiveOn: string,
  reason: string
): Promise<EmployeeView> {
  return node.post<EmployeeView>(
    `/api/v1/employees/${encodeURIComponent(employeeId)}/employment`,
    { transition, effective_on: effectiveOn, reason }
  )
}

/// Open an employee record with its number. Everything else — name, hire,
/// posting, contract, pay — is its own dated act on the record afterwards.
export function registerEmployee(employeeCode: string): Promise<EmployeeView> {
  return node.post<EmployeeView>("/api/v1/employees", {
    employee_code: employeeCode,
  })
}

/// The first statement of somebody's personal data. Later changes are
/// amendments, one field at a time.
export function enrolPersonalData(
  employeeId: string,
  data: { fullName: string; nik: string; birthDate: string; address: string }
): Promise<unknown> {
  return node.post(
    `/api/v1/employees/${encodeURIComponent(employeeId)}/personal-data`,
    {
      full_name: data.fullName,
      nik: data.nik,
      birth_date: data.birthDate,
      address: data.address,
    }
  )
}

/// Correct the employee number. The old one stays on the record.
export function correctCode(
  employeeId: string,
  employeeCode: string,
  reason: string
): Promise<EmployeeView> {
  return node.post<EmployeeView>(
    `/api/v1/employees/${encodeURIComponent(employeeId)}/code`,
    { employee_code: employeeCode, reason }
  )
}

/// Post somebody to a unit, for a span.
///
/// The overlap rule fires on the whole timeline rather than on the row being
/// written, so a posting that collides with an existing one comes back as a
/// conflict naming both — which is why the screen shows the server's sentence
/// rather than checking for overlaps itself.
export function assignToUnit(
  employeeId: string,
  unitId: string,
  validFrom: string,
  reason: string,
  validTo?: string
): Promise<EmployeeView> {
  return node.post<EmployeeView>(
    `/api/v1/employees/${encodeURIComponent(employeeId)}/assignments`,
    {
      unit_id: unitId,
      valid_from: validFrom,
      valid_to: validTo && validTo !== "" ? validTo : null,
      reason,
    }
  )
}

/// Bind this record to a login.
///
/// The reason is not decoration. It is the only durable statement of why this
/// credential is this person's: the activity log keeps request bodies out on
/// purpose, so without it nothing anywhere records which login was bound.
export function linkAccount(
  employeeId: string,
  username: string,
  reason: string
): Promise<EmployeeView> {
  return node.post<EmployeeView>(
    `/api/v1/employees/${encodeURIComponent(employeeId)}/account`,
    { username, reason }
  )
}

/// Unbind the login from this record.
///
/// Does not close the account — releasing says the credential is not this
/// person's, which is usually because it never was. Somebody who has actually
/// left is walked out by ending their employment, which closes the login as
/// part of the same act.
export function releaseAccount(
  employeeId: string,
  reason: string
): Promise<EmployeeView> {
  return node.post<EmployeeView>(
    `/api/v1/employees/${encodeURIComponent(employeeId)}/account/release`,
    { reason }
  )
}

/// Add a contract. PKWT is a fixed term and must say when it ends; PKWTT is
/// permanent and cannot carry an end date — the pairing UU 13/2003 art. 59
/// turns on, refused by the server as a bad request rather than passed down to
/// become a constraint violation.
export function addContract(
  employeeId: string,
  contract: {
    kind: ContractKind
    startsOn: string
    endsOn?: string
    position: string
    grade: string
    reason: string
  }
): Promise<ContractsView> {
  return node.post<ContractsView>(
    `/api/v1/employees/${encodeURIComponent(employeeId)}/contracts`,
    {
      kind: contract.kind,
      starts_on: contract.startsOn,
      // Sent as null rather than omitted for a permanent contract: the server
      // refuses a PKWTT that carries an end date, and being explicit is what
      // makes that refusal about the request rather than about a missing field.
      ends_on: contract.kind === "PKWT" ? (contract.endsOn ?? null) : null,
      position: contract.position,
      grade: contract.grade,
      reason: contract.reason,
    }
  )
}

/// Change exactly one field of somebody's personal data.
///
/// One field per amendment, because two at once would be two changes recorded
/// as one and the audit trail would say less than it appears to. The answer is
/// the full `PersonalDataView` — which the screen deliberately does not cache:
/// it shows the amendment trail it just wrote and keeps the NIK it was handed
/// out of the query cache, where a screen that only asked who was on shift
/// could read it.
export function amendPersonalData(
  employeeId: string,
  amendment: {
    field: AmendableField
    value?: string
    birthDate?: string
    reason: string
  }
): Promise<PersonalDataView> {
  return node.post<PersonalDataView>(
    `/api/v1/employees/${encodeURIComponent(employeeId)}/personal-data/amendments`,
    {
      field: amendment.field,
      // Absent means "clear it", which only phone and email allow. An empty box
      // is sent as null rather than as "" so the server's refusal is about
      // clearing a field that cannot be cleared, not about a blank name.
      value:
        amendment.value !== undefined && amendment.value !== ""
          ? amendment.value
          : null,
      birth_date: amendment.birthDate ?? null,
      reason: amendment.reason,
    }
  )
}

/// Write a new policy version. It supersedes the one currently open, which the
/// server closes the day before this one starts — one transaction, because a
/// schedule with two open versions does not load back.
export function setAttendancePolicy(
  policy: NewPolicy
): Promise<PolicyScheduleView> {
  return node.post<PolicyScheduleView>("/api/v1/attendance-policy", {
    effective_from: policy.effectiveFrom,
    late_grace_minutes: policy.lateGraceMinutes,
    early_leave_grace_minutes: policy.earlyLeaveGraceMinutes,
    overtime_minimum_minutes: policy.overtimeMinimumMinutes,
    duplicate_punch_window_minutes: policy.duplicatePunchWindowMinutes,
    reason: policy.reason,
  })
}

// ── reading the vocabulary ─────────────────────────────────────────────────

/// What a status means in a sentence, rather than in capitals.
///
/// `CANDIDATE` is the one worth spelling out: it is not "inactive" and not a
/// mistake — somebody has been taken on and has not started, which is a normal
/// state for a fortnight and an alarming one for a year.
export function statusLabel(status: string): string {
  switch (status) {
    case "CANDIDATE":
      return "Accepted, not started"
    case "ACTIVE":
      return "Working"
    case "SUSPENDED":
      return "Suspended"
    case "TERMINATED":
      return "Left"
    default:
      return status
  }
}

/// Days from today to a date, or `null` when there is no date.
///
/// Whole days, computed on the two calendar dates rather than on the instants,
/// so a contract ending tomorrow reads as 1 whichever side of midday somebody
/// is looking.
export function daysUntil(iso: string | null | undefined): number | null {
  if (!iso) return null
  const target = new Date(iso)
  if (Number.isNaN(target.getTime())) return null
  const today = new Date()
  const from = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())
  const to = Date.UTC(target.getFullYear(), target.getMonth(), target.getDate())
  return Math.round((to - from) / 86_400_000)
}

/// Minutes as a person would say them.
///
/// "90 minutes" is a number to convert; "1h 30m" is a duration to read. The
/// difference matters on a screen whose whole job is judging whether a
/// tolerance is sane.
export function readMinutes(minutes: number): string {
  if (minutes === 0) return "none"
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`
}

/// The ceilings the server enforces, restated so a form can refuse before a
/// round trip rather than after one. Not a second source of truth: the server
/// checks these again and its answer is the one that counts.
export const MAX_LATE_GRACE_MINUTES = 480
export const MAX_DUPLICATE_PUNCH_WINDOW_MINUTES = 60

/// Contracts running out, soonest first.
///
/// This is the People module's exception queue: an employment record that
/// lapses without anybody noticing is somebody turning up to work without a
/// contract, which is a legal problem rather than a data one. `within_days`
/// defaults to 30 on the server and is clamped there, so the screen does not
/// re-implement the bound.
export function expiringContracts(
  options: { asOf?: string; withinDays?: number } = {},
  signal?: AbortSignal
): Promise<ExpiringContract[]> {
  const params = new URLSearchParams()
  if (options.asOf) params.set("as_of", options.asOf)
  if (options.withinDays !== undefined) {
    params.set("within_days", String(options.withinDays))
  }
  const suffix = params.toString() === "" ? "" : `?${params.toString()}`
  return node.get<ExpiringContract[]>(
    `/api/v1/employees/contracts/expiring${suffix}`,
    { signal }
  )
}

// ── scope ──────────────────────────────────────────────────────────────────

/// How far the signed-in person reaches, as a query.
///
/// Kept for five minutes, because it changes when somebody is transferred or
/// their rung is changed — twice in a career, not twice in a session — and the
/// sidebar reads it on every render of the shell. A short stale time here would
/// buy nothing and cost a request per navigation.
///
/// It is deliberately not part of `/auth/me`. A session says who signed in and
/// which rung they hold; where somebody is posted is HR data with a history and
/// an authorising officer behind every change, so a unit stamped into the
/// session would be wrong from the transfer until the next sign-in.
export function useReach() {
  return useQuery(reachQueryOptions())
}

/// The options form, for the root's SSR pass (`routes/__root.tsx`): the
/// sidebar decides which People items to show from this answer, so it is
/// asked before the first render and the server draws the same menu the
/// browser will.
export function reachQueryOptions() {
  return {
    queryKey: peopleKeys.reach(),
    queryFn: ({ signal }: { signal?: AbortSignal }) => readReach(signal),
    staleTime: 5 * 60_000,
  }
}

/// One unit head office may act in.
export interface ReachableUnit {
  readonly id: string
  readonly name: string
  /// How many people are posted there. Head office chooses a unit out of
  /// fourteen, and the count is what tells a shop with two staff from one with
  /// twelve before the week is even drawn.
  readonly employees: number
}

/// The units the caller may act in, for the screens that are *about* one
/// unit rather than about the caller.
///
/// Not `useUnits` (`lib/queries/organisation`): that is the organisation's
/// whole register, and this is the part of it this caller reaches, with a
/// headcount on each.
///
/// **This is the workforce list's own facets, not a second register.** The
/// server already computes them, already bounds them by the caller's reach, and
/// already labels `store-01` as `Store 01`; a `/org-places` route beside that
/// would be a second answer to "where may they", and the day the two disagreed
/// the picker would be the one that looked right. `limit: 1` because only the
/// facets are wanted — the rows are the part this call throws away.
///
/// **Empty is the honest answer for a bounded caller**, by the server's own
/// design: `facets.units` is empty when the caller reaches one unit, because
/// a filter offering a single value is a control that cannot change anything.
/// So a store manager gets no picker, which is what should happen — they were
/// never choosing.
export function useReachableUnits() {
  return useQuery({
    queryKey: peopleKeys.units(),
    queryFn: ({ signal }) =>
      listWorkforce({ limit: 1 }, signal).then((page) =>
        page.facets.units.map((facet) => ({
          id: facet.value,
          name: facet.label ?? facet.value,
          employees: facet.count,
        }))
      ),
    staleTime: 5 * 60_000,
  })
}

/// Whether this caller is the *employer* — head office — or one unit's
/// manager.
///
/// `null` while the answer is in flight, which the sidebar reads as "not yet",
/// not as "no". Showing the head-office screens optimistically and taking them
/// away a moment later is the worse of the two flickers: a menu that removes
/// items teaches people not to trust it.
export function employerScope(reach: ReachView | undefined): boolean | null {
  if (reach === undefined) return null
  return reach.scope === "EVERYWHERE"
}

/// The unit a bounded caller is posted to, for a screen that has to say whose
/// list this is. `null` for head office, which is not standing in one shop.
export function boundedTo(reach: ReachView | undefined): string | null {
  if (reach === undefined || reach.scope !== "ONE_UNIT") return null
  return reach.unit_name ?? reach.unit_id
}

// ── issuing a login ────────────────────────────────────────────────────────

/// Somebody employed here who has no way to sign in.
///
/// Not recruitment and not hiring: the employment record already exists, and
/// what is missing is a credential. The four steps are one call because doing
/// them from a screen, in order, means every one of them is a place the
/// sequence can stop half-way — and an account created but never bound is a
/// live credential belonging to nobody.

/// Issuing a login, in one call: the account, its rung, the binding to the
/// employment record, and — for somebody who works at a node — a till.
export interface NewAccount {
  readonly username: string
  readonly displayName: string
  readonly password: string
  readonly role: "CASHIER" | "SUPERVISOR" | "ADMIN"
  readonly edge?: {
    readonly originId: string
    readonly role: "CASHIER" | "SUPERVISOR" | "ADMIN"
    /// Empty means none: allowed at a DC, which signs people in with their
    /// Cloud session.
    readonly edgePassword: string
  }
  readonly reason: string
}

export const accountKeys = {
  /// Which tills a person's unit is served by. Read only by the form that
  /// issues a login, so it is keyed by the person rather than by the unit.
  targets: (employeeId: string) =>
    ["people", "accounts", "targets", employeeId] as const,
}
/// Which nodes this person's unit is served by, and whether they already have
/// a grant at each.
export function accountTargets(
  employeeId: string,
  signal?: AbortSignal
): Promise<EdgeTarget[]> {
  return node.get<EdgeTarget[]>(
    `/api/v1/employees/${encodeURIComponent(employeeId)}/account/targets`,
    { signal }
  )
}

/// Issue a login.
///
/// The password is typed here and never comes back: the response carries the
/// username, the rungs and the policy version, and deliberately not the
/// credential. Whoever typed it has it.
export function provisionAccount(
  employeeId: string,
  account: NewAccount
): Promise<ProvisionedAccount> {
  return node.post<ProvisionedAccount>(
    `/api/v1/employees/${encodeURIComponent(employeeId)}/account/provision`,
    {
      username: account.username,
      display_name: account.displayName,
      password: account.password,
      role: account.role,
      edge: account.edge
        ? {
            origin_id: account.edge.originId,
            role: account.edge.role,
            edge_password:
              account.edge.edgePassword === ""
                ? null
                : account.edge.edgePassword,
            offline_ttl_seconds: null,
          }
        : null,
      reason: account.reason,
    }
  )
}

// ── leave, and the calendar it is counted against ──────────────────────────

/// Two halves of one question, and neither is usable alone: a request spanning
/// Idul Fitri has to know not to charge it, and a calendar nobody counts leave
/// against is a list of dates.
///
/// # Centidays, not days
///
/// Every amount on the wire is hundredths of a day, for the same reason money
/// is an integer of the smallest unit: `0.1 + 0.2 !== 0.3`, and a balance off by
/// 2⁻⁵² fails an equality check nobody can explain — worse, it fails it only
/// sometimes. `readDays` is the only place it is divided, and only for display.
///
/// # What the browser is deliberately not told
///
/// Which days a request charges. The server settles that against the calendar
/// on the day the request is filed and stores the answer, because a *cuti
/// bersama* added by decree in June must not change what an April request cost.
/// A browser counting weekends would get it wrong, and would get it wrong
/// differently from the server.

export const leaveKeys = {
  types: () => ["people", "leave", "types"] as const,
  policy: () => ["people", "leave", "policy"] as const,
  /// Everything waiting on a decision. No unit in the key: the server bounds
  /// it by the caller's own posting, so two managers never share an answer.
  pending: () => ["people", "leave", "pending"] as const,
  balances: (employeeId: string) =>
    ["people", "leave", "balances", employeeId] as const,
  requests: (employeeId: string) =>
    ["people", "leave", "requests", employeeId] as const,
  calendarYears: () => ["people", "holidays"] as const,
  calendar: (year: number) => ["people", "holidays", year] as const,
}

/// Hundredths of a day, as somebody would say them.
///
/// "1200" is a number to convert; "12 days" is a quantity to read. Half days
/// keep their half — a screen that showed 9 where the ledger holds 9.5 is a
/// screen somebody plans a week around.
export function readDays(centidays: number): string {
  const whole = Math.trunc(centidays / 100)
  const fraction = Math.abs(centidays % 100)
  if (fraction === 0)
    return `${whole} ${Math.abs(whole) === 1 ? "day" : "days"}`
  return `${whole}.${String(fraction).padStart(2, "0")} days`
}

/// What a leave state is called: Pending, Approved, Rejected or Withdrawn — the
/// one approval vocabulary (`lib/words.ts`).
export function leaveStateLabel(state: string): string {
  return approvalWord(state)
}

/// What a kind of leave draws on, said plainly.
///
/// The distinction matters more than it looks: sick leave deducting from
/// nothing is UU 13/2003 art. 93, and a system that took those days out of the
/// annual twelve would be taking something the law does not allow it to take.
export function backingLabel(backing: string): string {
  switch (backing) {
    case "BALANCE":
      return "From a balance"
    case "PER_OCCURRENCE":
      return "Per occurrence"
    case "AS_CERTIFIED":
      return "As certified — deducts from nothing"
    default:
      return backing
  }
}

export function listLeaveTypes(signal?: AbortSignal): Promise<LeaveTypeView[]> {
  return node.get<LeaveTypeView[]>("/api/v1/leave-types", { signal })
}

export function readLeavePolicy(
  signal?: AbortSignal
): Promise<LeavePolicyView[]> {
  return node.get<LeavePolicyView[]>("/api/v1/leave-policy", { signal })
}

/// Ratify a new generation of the leave policy — never an edit: last
/// month's balances keep folding under last month's rules.
export function installLeavePolicy(body: {
  version: number
  effective_from: string
  annual_days: number
  accrual: string
  carry_forward_days?: number
  carry_forward_expires_on?: string
  encashment_max_days?: number
  encashment_second_approver?: boolean
  protected_leave: string
  eligibility_months: number
  joiner: string
}): Promise<LeavePolicyView[]> {
  return node.post<LeavePolicyView[]>("/api/v1/leave-policy", body)
}

/// Everything waiting on a decision, bounded by the caller's posting.
export function pendingLeave(
  signal?: AbortSignal
): Promise<LeaveRequestView[]> {
  return node.get<LeaveRequestView[]>("/api/v1/leave-requests/pending", {
    signal,
  })
}

export function leaveBalances(
  employeeId: string,
  signal?: AbortSignal
): Promise<LeaveBalanceRow[]> {
  return node.get<LeaveBalanceRow[]>(
    `/api/v1/employees/${encodeURIComponent(employeeId)}/leave-balances`,
    { signal }
  )
}

export function leaveRequestsOf(
  employeeId: string,
  signal?: AbortSignal
): Promise<LeaveRequestView[]> {
  return node.get<LeaveRequestView[]>(
    `/api/v1/employees/${encodeURIComponent(employeeId)}/leave-requests`,
    { signal }
  )
}

export interface NewLeaveType {
  readonly code: string
  readonly name: string
  readonly backing: "BALANCE" | "PER_OCCURRENCE" | "AS_CERTIFIED"
  readonly maxDays?: number
  readonly payment: "FULL" | "UNPAID" | "STATUTORY_SCALE"
  readonly requiresEvidence: boolean
}

/// Ratify a kind of leave. There is no edit and no delete: redefining a kind
/// would change what every request already filed against it meant.
export function defineLeaveType(kind: NewLeaveType): Promise<LeaveTypeView[]> {
  return node.post<LeaveTypeView[]>("/api/v1/leave-types", {
    code: kind.code,
    name: kind.name,
    backing: kind.backing,
    // Sent as null rather than omitted for the two backings that refuse it, so
    // the server's refusal is about the request rather than about a field
    // nobody filled in.
    max_days: kind.backing === "PER_OCCURRENCE" ? (kind.maxDays ?? null) : null,
    payment: kind.payment,
    requires_evidence: kind.requiresEvidence,
  })
}

/// Approve, refuse, or take back.
///
/// Three routes rather than one with a mode, because they are three different
/// authorities: deciding is the manager's, withdrawing is the requester's own,
/// and a single route taking a verb would have to check which after the fact.
export function decideLeave(
  employeeId: string,
  requestId: string,
  decision: "approve" | "reject" | "withdraw",
  reason: string
): Promise<LeaveRequestView> {
  return node.post<LeaveRequestView>(
    `/api/v1/employees/${encodeURIComponent(employeeId)}/leave-requests/${encodeURIComponent(requestId)}/${decision}`,
    { reason }
  )
}

export function publishedYears(
  signal?: AbortSignal
): Promise<CalendarYearsView> {
  return node.get<CalendarYearsView>("/api/v1/holiday-calendars", { signal })
}

export function readCalendar(
  year: number,
  signal?: AbortSignal
): Promise<CalendarView> {
  return node.get<CalendarView>(`/api/v1/holiday-calendars/${year}`, { signal })
}

export interface NewHoliday {
  readonly date: string
  readonly name: string
  readonly kind: "NATIONAL" | "CUTI_BERSAMA" | "REGIONAL"
  /// The units it is observed at. Empty means nationwide. Required for a
  /// regional day and refused for the other two — the server says which, and
  /// names the date.
  readonly units: readonly string[]
}

/// Publish a year. Once only: a year is changed by amendment after that,
/// because replacing the approved set wholesale would take its history with it.
export function publishCalendar(
  year: number,
  holidays: readonly NewHoliday[],
  reason: string
): Promise<CalendarView> {
  return node.post<CalendarView>("/api/v1/holiday-calendars", {
    year,
    holidays: holidays.map((holiday) => ({
      date: holiday.date,
      name: holiday.name,
      kind: holiday.kind,
      units: holiday.units,
    })),
    reason,
  })
}

/// Add or withdraw one day.
///
/// The same grant as publishing, deliberately: adding a *collective leave* in March
/// changes what people are owed exactly as much as publishing the year in
/// January did — and usually more, because by then the year is running.
export function amendCalendar(
  year: number,
  change: "ADDED" | "REMOVED",
  holiday: NewHoliday,
  reason: string
): Promise<CalendarView> {
  return node.post<CalendarView>(
    `/api/v1/holiday-calendars/${year}/amendments`,
    {
      change,
      holiday: {
        date: holiday.date,
        name: holiday.name,
        kind: holiday.kind,
        units: holiday.units,
      },
      reason,
    }
  )
}

// ── overtime ───────────────────────────────────────────────────────────────

/// Ordered by a supervisor, agreed by the worker, and neither alone.
///
/// PP 35/2021 art. 26(2) wants two written acts from two people, so this
/// surface can order and withdraw and **cannot answer**: consent is the
/// employee's own, on their phone, under a key head office does not hold. A
/// button here that recorded the answer would be the manager agreeing twice.
///
/// `authorized_minutes` is the figure anything downstream may act on and is
/// `null` in every state but `AGREED`. Read that rather than `planned_minutes`,
/// which is what was asked for and not what was agreed to.

export const overtimeKeys = {
  policy: () => ["people", "overtime", "policy"] as const,
  /// What is waiting on an answer. No unit in the key: the server bounds it by
  /// the caller's own posting, so two managers never share an answer.
  awaiting: () => ["people", "overtime", "awaiting"] as const,
  of: (employeeId: string) => ["people", "overtime", employeeId] as const,
}

/// Minutes as a person would say them.
///
/// "240" is a number to convert; "4h" is a duration to read — and the cap this
/// is measured against is stated in hours, so a screen showing minutes makes
/// its reader do the division.
export function readMinutesSpan(minutes: number): string {
  if (minutes === 0) return "none"
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours === 0) return `${rest}m`
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`
}

/// What an overtime state means in a sentence.
export function overtimeStateLabel(state: string): string {
  switch (state) {
    case "AWAITING_CONSENT":
      return "Waiting on their answer"
    case "AGREED":
      return "Agreed"
    case "DECLINED":
      return STATUS.rejected
    case "WITHDRAWN":
      return STATUS.withdrawn
    default:
      return state
  }
}

export function readOvertimePolicy(
  signal?: AbortSignal
): Promise<OvertimePolicyView | null> {
  return node.get<OvertimePolicyView | null>("/api/v1/overtime-policy", {
    signal,
  })
}

export function awaitingOvertime(
  signal?: AbortSignal
): Promise<OvertimeOrderView[]> {
  return node.get<OvertimeOrderView[]>("/api/v1/overtime-orders/awaiting", {
    signal,
  })
}

export function overtimeOrdersOf(
  employeeId: string,
  signal?: AbortSignal
): Promise<OvertimeOrderView[]> {
  return node.get<OvertimeOrderView[]>(
    `/api/v1/employees/${encodeURIComponent(employeeId)}/overtime-orders`,
    { signal }
  )
}

export interface NewOvertimeOrder {
  readonly employeeId: string
  readonly onDate: string
  readonly dayKind: "WORKING" | "REST" | "HOLIDAY"
  readonly plannedMinutes: number
  readonly reason: string
}

/// Issue the instruction.
///
/// The id is minted here so a retry on a poor connection cannot file the same
/// order twice — a second POST with the same id is a conflict rather than a
/// second evening somebody is asked to work.
export function orderOvertime(
  order: NewOvertimeOrder
): Promise<OvertimeOrderView> {
  return node.post<OvertimeOrderView>(
    `/api/v1/employees/${encodeURIComponent(order.employeeId)}/overtime-orders`,
    {
      order_id: newOvertimeId(),
      on_date: order.onDate,
      day_kind: order.dayKind,
      planned_minutes: order.plannedMinutes,
      reason: order.reason,
    }
  )
}

/// Take the instruction back — only while it is unanswered.
export function withdrawOvertime(
  employeeId: string,
  orderId: string,
  reason: string
): Promise<OvertimeOrderView> {
  return node.post<OvertimeOrderView>(
    `/api/v1/employees/${encodeURIComponent(employeeId)}/overtime-orders/${encodeURIComponent(orderId)}/withdrawal`,
    { reason }
  )
}

function newOvertimeId(): string {
  const random = globalThis.crypto?.randomUUID?.()
  if (random !== undefined) return `OT-${random}`
  return `OT-${Date.now().toString(36)}`
}

// ── the roster, and signing the month off ──────────────────────────────────

/// The plan, and the boundary that freezes it.
///
/// A roster is upstream of money — "absent" only exists against a scheduled day
/// — which is why revisions are kept rather than overwritten and why a closed
/// month refuses both a new day and a change to an existing one.

export const rosterKeys = {
  /// Every roster answer, whichever unit or person it was asked about — what
  /// a write that moves two people's days at once has to drop.
  all: () => ["people", "roster"] as const,
  shifts: () => ["people", "shifts"] as const,
  unit: (unit: string, from: string, to: string) =>
    ["people", "roster", unit, from, to] as const,
  of: (employeeId: string, from: string, to: string) =>
    ["people", "roster", "employee", employeeId, from, to] as const,
  periods: (unit: string) => ["people", "periods", unit] as const,
}

export function listShifts(signal?: AbortSignal): Promise<ShiftView[]> {
  return node.get<ShiftView[]>("/api/v1/attendance-shifts", { signal })
}

export interface NewShift {
  readonly id: string
  readonly name: string
  readonly startsAt: string
  readonly endsAt: string
  readonly crossesMidnight: boolean
  readonly unpaidBreakMinutes: number
  /// `HH:MM` the break starts, or empty for unsaid (0807).
  readonly breakStartsAt: string
}

export function defineShift(shift: NewShift): Promise<ShiftView[]> {
  return node.post<ShiftView[]>("/api/v1/attendance-shifts", {
    id: shift.id,
    name: shift.name,
    starts_at: shift.startsAt,
    ends_at: shift.endsAt,
    // Stated rather than inferred from `ends_at < starts_at`: a shift from
    // 09:00 to 09:00 is either nothing or twenty-four hours, and guessing which
    // is worse than asking.
    crosses_midnight: shift.crossesMidnight,
    unpaid_break_minutes: shift.unpaidBreakMinutes,
    ...(shift.breakStartsAt.trim() === ""
      ? {}
      : { break_starts_at: shift.breakStartsAt.trim() }),
  })
}

/// Retire, never delete: a roster day already naming a shift would be left
/// pointing at nothing.
export function retireShift(id: string): Promise<ShiftView[]> {
  return node.post<ShiftView[]>(
    `/api/v1/attendance-shifts/${encodeURIComponent(id)}/retirement`,
    {}
  )
}

export function unitRoster(
  unit: string,
  from: string,
  to: string,
  signal?: AbortSignal
): Promise<RosterDayView[]> {
  const params = new URLSearchParams({ unit, from, to })
  return node.get<RosterDayView[]>(`/api/v1/roster?${params.toString()}`, {
    signal,
  })
}

/// Plan a day, or revise it. One call for both, because which is happening is a
/// fact about the database rather than about the planner's intent.
export function planDay(
  employeeId: string,
  day: {
    onDate: string
    plan: "SCHEDULED" | "REST_DAY" | "PUBLIC_HOLIDAY"
    shiftId?: string
    reason: string
  }
): Promise<RosterDayView> {
  return node.post<RosterDayView>(
    `/api/v1/employees/${encodeURIComponent(employeeId)}/roster`,
    {
      on_date: day.onDate,
      plan: day.plan,
      shift_id: day.plan === "SCHEDULED" ? (day.shiftId ?? null) : null,
      reason: day.reason,
    }
  )
}

export function attendancePeriods(
  unit: string,
  signal?: AbortSignal
): Promise<PeriodView[]> {
  return node.get<PeriodView[]>(
    `/api/v1/attendance-periods?unit=${encodeURIComponent(unit)}`,
    { signal }
  )
}

export function closePeriod(
  unit: string,
  period: string,
  reason: string
): Promise<PeriodView> {
  return node.post<PeriodView>(
    `/api/v1/attendance-periods/${encodeURIComponent(unit)}/${encodeURIComponent(period)}/closure`,
    { reason }
  )
}

/// Head office's. A unit that could reopen its own sign-off has not signed
/// anything off.
export function reopenPeriod(
  unit: string,
  period: string,
  reason: string
): Promise<PeriodView> {
  return node.post<PeriodView>(
    `/api/v1/attendance-periods/${encodeURIComponent(unit)}/${encodeURIComponent(period)}/reopening`,
    { reason }
  )
}

// ── pay and payroll ────────────────────────────────────────────────────────

/// A place opens and submits its own run; head office approves it and states
/// the rules.
///
/// Since 0800 the server works out PPh 21 (TER each month, the year settled in
/// its last month) and BPJS on every slip, from the PTKP, tax method and BPJS
/// numbers on the employee's payroll identity and the BPJS rates head office
/// states from a date. A slip that could not be worked out carries `null` and
/// a sentence, never a nought.

export const payKeys = {
  runs: () => ["people", "payroll", "runs"] as const,
  slips: (runId: string) => ["people", "payroll", runId, "slips"] as const,
  handover: (runId: string) =>
    ["people", "payroll", runId, "handover"] as const,
  reconciliation: (runId: string) =>
    ["people", "payroll", runId, "reconciliation"] as const,
  components: () => ["people", "payroll", "components"] as const,
  adjustments: (unitId: string, period: string) =>
    ["people", "payroll", "adjustments", unitId, period] as const,
  pay: (employeeId: string) => ["people", "pay", employeeId] as const,
  identity: (employeeId: string) =>
    ["people", "pay", employeeId, "identity"] as const,
  statutoryRates: () => ["people", "payroll", "statutory-rates"] as const,
  schedules: () => ["people", "payroll", "schedule"] as const,
  structures: () => ["people", "payroll", "structures"] as const,
  taxTables: () => ["people", "payroll", "tax-tables"] as const,
  withholdings: (runId: string) =>
    ["people", "payroll", runId, "withholdings"] as const,
  payslipTemplate: () => ["people", "payroll", "payslip-template"] as const,
  taxReport: (period: string) =>
    ["people", "payroll", "tax-report", period] as const,
  annualTax: (year: number) =>
    ["people", "payroll", "annual-tax", year] as const,
  loans: (employeeId: string) => ["people", "loans", employeeId] as const,
  allLoans: () => ["people", "loans"] as const,
}

/// One person's loans, newest first.
export function employeeLoans(
  employeeId: string,
  signal?: AbortSignal
): Promise<LoanView[]> {
  return node.get<LoanView[]>(
    `/api/v1/employees/${encodeURIComponent(employeeId)}/loans`,
    { signal }
  )
}

/// Every loan in the company.
export function allLoans(signal?: AbortSignal): Promise<LoanView[]> {
  return node.get<LoanView[]>("/api/v1/payroll/loans", { signal })
}

/// Lend: an advance Finance pays out, repaid from pay a fixed instalment a
/// month from `first_period`.
export function grantLoan(
  employeeId: string,
  body: GrantLoanBody
): Promise<LoanView[]> {
  return node.post<LoanView[]>(
    `/api/v1/employees/${encodeURIComponent(employeeId)}/loans`,
    body
  )
}

export function stopLoan(
  advanceId: string,
  reason: string
): Promise<LoanView[]> {
  return node.post<LoanView[]>(
    `/api/v1/payroll/loans/${encodeURIComponent(advanceId)}/stop`,
    { reason }
  )
}

/// Every hold head office has put on somebody's pay on a run, released or not.
export function runWithholdings(
  runId: string,
  signal?: AbortSignal
): Promise<WithholdingView[]> {
  return node.get<WithholdingView[]>(
    `/api/v1/payroll/runs/${encodeURIComponent(runId)}/withholdings`,
    { signal }
  )
}

/// Hold one person's pay on a run. The slip is still worked out and still
/// owed; nothing can be paid out to them on this run until it is released.
export function holdPay(
  runId: string,
  employeeId: string,
  reason: string
): Promise<WithholdingView[]> {
  return node.post<WithholdingView[]>(
    `/api/v1/payroll/runs/${encodeURIComponent(runId)}/withholdings`,
    { employee_id: employeeId, reason }
  )
}

export function releasePay(
  runId: string,
  employeeId: string,
  reason: string
): Promise<WithholdingView[]> {
  return node.post<WithholdingView[]>(
    `/api/v1/payroll/runs/${encodeURIComponent(runId)}/withholdings/${encodeURIComponent(employeeId)}/release`,
    { reason }
  )
}

/// Forget somebody's payslip password so they choose a new one. HR never
/// learns or sets it.
export function resetPayslipPassword(
  employeeId: string
): Promise<{ reset: boolean }> {
  return node.delete<{ reset: boolean }>(
    `/api/v1/employees/${encodeURIComponent(employeeId)}/payslip-password`
  )
}

/// What a payslip says around its figures, and whether it is locked.
export function payslipTemplate(
  signal?: AbortSignal
): Promise<PayslipTemplate> {
  return node.get<PayslipTemplate>("/api/v1/payroll/payslip-template", {
    signal,
  })
}

export function savePayslipTemplate(
  body: SaveTemplateBody
): Promise<PayslipTemplate> {
  return node.post<PayslipTemplate>("/api/v1/payroll/payslip-template", body)
}

/// Each person's PPh 21 and BPJS in a month, across every unit the caller
/// reaches — the figures behind the monthly SPT and the BPJS invoice.
export function taxReport(
  period: string,
  signal?: AbortSignal
): Promise<TaxReportRow[]> {
  return node.get<TaxReportRow[]>(
    `/api/v1/payroll/tax-report?period=${encodeURIComponent(period)}`,
    { signal }
  )
}

/// Every employee's bukti potong 1721-A1 for a year.
export function annualTaxSlips(
  year: number,
  signal?: AbortSignal
): Promise<AnnualTaxSlip[]> {
  return node.get<AnnualTaxSlip[]>(`/api/v1/payroll/annual-tax?year=${year}`, {
    signal,
  })
}

/// Every set of BPJS rates head office has stated, newest first.
export function statutoryRates(
  signal?: AbortSignal
): Promise<StatutoryRateView[]> {
  return node.get<StatutoryRateView[]>("/api/v1/payroll/statutory-rates", {
    signal,
  })
}

/// State new BPJS rates from a date — the JP cap every March, a new JKK
/// class. Forward-only: a month already paid keeps the rates it was paid at.
export function ratifyStatutoryRate(
  body: RatifyStatutoryRateBody
): Promise<StatutoryRateView[]> {
  return node.post<StatutoryRateView[]>("/api/v1/payroll/statutory-rates", body)
}

/// Every payroll schedule stated (cut-off and pay day), newest first.
export function payrollSchedules(
  signal?: AbortSignal
): Promise<PayrollScheduleView[]> {
  return node.get<PayrollScheduleView[]>("/api/v1/payroll/schedule", {
    signal,
  })
}

export function statePayrollSchedule(
  body: StateScheduleBody
): Promise<PayrollScheduleView[]> {
  return node.post<PayrollScheduleView[]>("/api/v1/payroll/schedule", body)
}

/// Put THR on a draft run for a holiday, or take it off (`null`).
export function setRunThr(
  runId: string,
  holidayOn: string | null,
  reason: string
): Promise<PayrollRunView> {
  return node.post<PayrollRunView>(
    `/api/v1/payroll/runs/${encodeURIComponent(runId)}/thr`,
    { holiday_on: holidayOn, reason }
  )
}

/// Salary structures: a named base and fixed allowances.
export function salaryStructures(
  signal?: AbortSignal
): Promise<SalaryStructureView[]> {
  return node.get<SalaryStructureView[]>("/api/v1/payroll/structures", {
    signal,
  })
}

export function saveSalaryStructure(
  body: SaveStructureBody
): Promise<SalaryStructureView[]> {
  return node.post<SalaryStructureView[]>("/api/v1/payroll/structures", body)
}

export function retireSalaryStructure(
  code: string,
  reason: string
): Promise<SalaryStructureView[]> {
  return node.post<SalaryStructureView[]>(
    `/api/v1/payroll/structures/${encodeURIComponent(code)}/retirement`,
    { reason }
  )
}

/// Define a pay component — what a payslip may contain. Its figure is
/// ratified separately, from a date.
export function defineComponent(body: {
  code: string
  label: string
  kind: "EARNING" | "DEDUCTION"
  basis: string
  base_ref?: string | null
  unit?: string | null
  reason: string
}): Promise<PayComponentView> {
  return node.post<PayComponentView>("/api/v1/payroll/components", {
    ...body,
    base_ref: body.base_ref ?? null,
    unit: body.unit ?? null,
  })
}

export function ratifyComponentRate(
  code: string,
  body: {
    effective_from: string
    amount_minor?: number | null
    rate_minor?: number | null
    rate_bp?: number | null
    cap_minor?: number | null
    hours_divisor?: number | null
    multiplier_bp?: number | null
    reason: string
  }
): Promise<unknown> {
  return node.post(
    `/api/v1/payroll/components/${encodeURIComponent(code)}/rates`,
    body
  )
}

export function retireComponent(
  code: string,
  reason: string
): Promise<unknown> {
  return node.post(
    `/api/v1/payroll/components/${encodeURIComponent(code)}/retirement`,
    { reason }
  )
}

/// The law PPh 21 is worked out from: the TER tables, Pasal 17, PTKP.
export function taxTables(signal?: AbortSignal): Promise<TaxTablesView> {
  return node.get<TaxTablesView>("/api/v1/payroll/tax-tables", { signal })
}

/// Who bears PPh 21, in the words a payslip uses.
export function taxMethodLabel(method: string | null | undefined): string {
  switch (method) {
    case "GROSS_UP":
      return "Gross up — an allowance pays the tax"
    case "NETTO":
      return "Netto — the company bears the tax"
    case "GROSS":
      return "Gross — withheld from pay"
    default:
      return "—"
  }
}

export function readPay(
  employeeId: string,
  signal?: AbortSignal
): Promise<PayRecordView[]> {
  return node.get<PayRecordView[]>(
    `/api/v1/employees/${encodeURIComponent(employeeId)}/pay`,
    { signal }
  )
}

export function agreePay(
  employeeId: string,
  agreement: {
    effectiveFrom: string
    baseMinor: number
    allowances: readonly { code: string; minor: number }[]
    reason: string
  }
): Promise<PayRecordView[]> {
  return node.post<PayRecordView[]>(
    `/api/v1/employees/${encodeURIComponent(employeeId)}/pay`,
    {
      effective_from: agreement.effectiveFrom,
      base_minor: agreement.baseMinor,
      fixed_allowances: agreement.allowances,
      reason: agreement.reason,
    }
  )
}

export function readPayrollIdentity(
  employeeId: string,
  signal?: AbortSignal
): Promise<PayrollIdentityView> {
  return node.get<PayrollIdentityView>(
    `/api/v1/employees/${encodeURIComponent(employeeId)}/payroll-identity`,
    { signal }
  )
}

export function amendPayrollIdentity(
  employeeId: string,
  amendment: {
    field: string
    bankName?: string
    bankAccount?: string
    bankHolder?: string
    value?: string
    effectiveFrom: string
    reason: string
  }
): Promise<PayrollIdentityView> {
  return node.post<PayrollIdentityView>(
    `/api/v1/employees/${encodeURIComponent(employeeId)}/payroll-identity`,
    {
      field: amendment.field,
      bank_name: amendment.bankName ?? null,
      bank_account: amendment.bankAccount ?? null,
      bank_holder: amendment.bankHolder ?? null,
      value: amendment.value ?? null,
      effective_from: amendment.effectiveFrom,
      reason: amendment.reason,
    }
  )
}

/// Work a draft run's slips out again from what the month holds now.
export function rebuildRun(runId: string): Promise<PayrollRunView> {
  return node.post<PayrollRunView>(
    `/api/v1/payroll/runs/${encodeURIComponent(runId)}/rebuild`,
    {}
  )
}

export function listRuns(signal?: AbortSignal): Promise<PayrollRunView[]> {
  return node.get<PayrollRunView[]>("/api/v1/payroll/runs", { signal })
}

export function openRun(
  unitId: string,
  period: string,
  reason: string
): Promise<PayrollRunView> {
  return node.post<PayrollRunView>("/api/v1/payroll/runs", {
    unit_id: unitId,
    period,
    reason,
  })
}

/// One route per step, not one with a verb. They are four different
/// authorities, and the two-person rule compares the actors on two of them.
/// Move a run along. Three steps, not five.
///
/// `verify` and `seal` are gone by the owner's decision of 2026-09-13: the
/// first act moved to the unit as `submission`, and approval is final — a
/// state whose only content is "and we mean it" cannot be told from the one
/// before it. The path segment for submitting is `submission` rather than
/// `submit`, because it is the thing rather than the verb.
export function stepRun(
  runId: string,
  step: "submission" | "approve" | "reopen",
  reason: string
): Promise<PayrollRunView> {
  return node.post<PayrollRunView>(
    `/api/v1/payroll/runs/${encodeURIComponent(runId)}/${step}`,
    { reason }
  )
}

/// What crossed to Finance, and whether Finance says it is paid.
///
/// Its own route rather than a field on the run: a list of runs must not pay
/// for every employee line in every month, and nothing should ever serve an
/// empty breakdown beside a real figure — which reads as "nobody is in it".
export function readHandover(
  runId: string,
  signal?: AbortSignal
): Promise<PayrollHandoverView | null> {
  return node
    .get<PayrollHandoverView>(
      `/api/v1/payroll/runs/${encodeURIComponent(runId)}/finance-handover`,
      { signal }
    )
    .catch((error: unknown) => {
      // The route answers 404 until this run has crossed to Finance. That is
      // the ordinary empty state, which the payroll sheet renders as the
      // handover form; authorization and other failures must still surface.
      if (error instanceof ApiError && error.status === 404) return null
      throw error
    })
}

/// Hand an approved run over. Idempotent per (unit, period) on the server, so
/// sending it twice cannot double what the company owes.
export function handOverRun(
  runId: string,
  reason: string
): Promise<PayrollHandoverView> {
  return node.post<PayrollHandoverView>(
    `/api/v1/payroll/runs/${encodeURIComponent(runId)}/finance-handover`,
    { reason }
  )
}

/// Finance's own statement that it has been paid, under its own key — a grant
/// that could hand a liability over and then declare it settled would be one
/// person closing the loop on their own request.
export function settleHandover(
  runId: string,
  reason: string,
  bank?: { bank_key: string; bank_qualifier: string }
): Promise<PayrollHandoverView> {
  // A head-office run posts Dr 2017 / Cr the bank it was paid from, so it
  // names the bank. A store run posts nothing and sends the reason alone.
  return node.post<PayrollHandoverView>(
    `/api/v1/payroll/runs/${encodeURIComponent(runId)}/finance-handover/settlement`,
    bank === undefined ? { reason } : { reason, ...bank }
  )
}

export function runSlips(
  runId: string,
  signal?: AbortSignal
): Promise<PayrollSlipRow[]> {
  return node.get<PayrollSlipRow[]>(
    `/api/v1/payroll/runs/${encodeURIComponent(runId)}/slips`,
    { signal }
  )
}

export function runReconciliation(
  runId: string,
  signal?: AbortSignal
): Promise<RunReconciliation> {
  return node.get<RunReconciliation>(
    `/api/v1/payroll/runs/${encodeURIComponent(runId)}/reconciliation`,
    { signal }
  )
}

/// What a run's state means in a sentence.
///
/// Three states, since the owner's decision of 2026-09-13 removed both `verify`
/// and `seal`: the unit builds it, the unit sends it, head office answers.
/// The two-person rule did not go with them — it moved, and is now *submitter
/// is not approver*, which is why the sentences name who is waiting rather
/// than which button is next.
export function runStateLabel(state: string): string {
  switch (state) {
    case "DRAFT":
      return "Being built by the place"
    case "SUBMITTED":
      return "Waiting on head office"
    case "APPROVED":
      return "Approved"
    default:
      return state
  }
}

/// What a handover's state means. `null` handover means nobody has sent it.
export function handoverLabel(state: string): string {
  // The server says RECEIVED (Finance holds the accrual) and PAID (the money
  // went out); the older spellings are kept for rows read from a cache.
  switch (state) {
    case "RECEIVED":
    case "HANDED_OVER":
      return "With Finance"
    case "PAID":
    case "SETTLED":
      return "Paid"
    default:
      return state
  }
}

// ── the one-offs a unit files ──────────────────────────────────────────────

/// What one unit has filed for one month, as the batch screen needs it.
///
/// The employee's code and name are joined because a list of employee ids is
/// not a list a person can check, and checking is what the unit is for.
///
/// # Structural until the next `make contract`
///
/// Exactly like `WorkforcePage` above: the shape is generated from the Rust
/// struct at `postgres::components`, and the backend lane is landing
/// `advance_id` against the same written agreement this form files under.
/// When the export next runs, this becomes that import and the interface
/// below goes.
export interface PayrollAdjustmentRow {
  readonly id: string
  readonly unit_id: string
  /// `YYYY-MM`.
  readonly period: string
  readonly employee_id: string
  readonly employee_code: string
  readonly full_name: string | null
  readonly component_code: string
  readonly label: string
  /// `EARNING` or `DEDUCTION`, from the component. A *kasbon* instalment is a
  /// positive amount under a deduction; nothing here is signed.
  readonly kind: string
  readonly amount_minor: number
  readonly filed_by: string
  readonly filed_at: string
  /// Why. Not decoration: this is the one figure on a payslip head office did
  /// not agree in advance, so the reason is the whole of what it approves.
  readonly reason: string
  /// Whether it can still be withdrawn — false once the unit has submitted
  /// the batch carrying it.
  readonly withdrawable: boolean
  /// The advance this filing repays, when it is one. The settlement head
  /// office's approval posts lands on this advance, and the direction is
  /// pinned to a deduction: money coming back out of a wage is never an
  /// earning.
  readonly advance_id: string | null
}

/// The catalogue, with each component's shape and kind. Ungated on the
/// server — a rule that governs somebody is owed to them — and read here for
/// the one-off form, which may only file against a `PER_OCCASION` component:
/// one with no standing figure of its own.
export function payComponents(
  signal?: AbortSignal
): Promise<PayComponentView[]> {
  return node.get<PayComponentView[]>("/api/v1/payroll/components", { signal })
}

/// What has been filed, for one unit or everywhere the caller reaches,
/// narrowed to one month when asked. Bounded by reach on the server: a unit
/// manager reads their own unit and nothing else.
export function listAdjustments(
  options: { unit?: string; period?: string } = {},
  signal?: AbortSignal
): Promise<PayrollAdjustmentRow[]> {
  const params = new URLSearchParams()
  if (options.unit) params.set("unit", options.unit)
  if (options.period) params.set("period", options.period)
  const suffix = params.size > 0 ? `?${params.toString()}` : ""
  return node.get<PayrollAdjustmentRow[]>(
    `/api/v1/payroll/adjustments${suffix}`,
    { signal }
  )
}

/// File one. **The unit's act**, for its own people and its own month.
///
/// The id is minted on the server, and the figure is frozen the moment this
/// lands — head office decides it with the batch. `advanceId` present makes
/// the filing a recovery: it must ride a `DEDUCTION` component, belong to the
/// same person, and not exceed what is still out. The server checks all three
/// at filing and again at approval — filings sit while months move — and its
/// answer is the one that counts.
export function fileAdjustment(ask: {
  readonly unitId: string
  readonly period: string
  readonly employeeId: string
  readonly componentCode: string
  readonly amountMinor: number
  readonly reason: string
  readonly advanceId?: string
}): Promise<PayrollAdjustmentRow[]> {
  return node.post<PayrollAdjustmentRow[]>("/api/v1/payroll/adjustments", {
    unit_id: ask.unitId,
    period: ask.period,
    employee_id: ask.employeeId,
    component_code: ask.componentCode,
    amount_minor: ask.amountMinor,
    reason: ask.reason,
    // Absent rather than null: the key's presence is the claim being made,
    // and a body that names no advance files a plain one-off.
    ...(ask.advanceId !== undefined ? { advance_id: ask.advanceId } : {}),
  })
}

/// Take one back, while the batch is still the unit's. The reason is the
/// audit entry — the server refuses a blank one before anything is removed.
export function withdrawAdjustment(
  id: string,
  reason: string
): Promise<PayrollAdjustmentRow[]> {
  return node.post<PayrollAdjustmentRow[]>(
    `/api/v1/payroll/adjustments/${encodeURIComponent(id)}/withdrawal`,
    { reason }
  )
}

// ── asking for a new employee ──────────────────────────────────────────────

export const hireKeys = {
  all: ["people", "hire"] as const,
  list: (unit?: string) => ["people", "hire", unit ?? "all"] as const,
  one: (id: string) => ["people", "hire", "proposal", id] as const,
}

export function listHireProposals(
  signal?: AbortSignal
): Promise<HireProposalView[]> {
  return node.get<HireProposalView[]>("/api/v1/hire-proposals", { signal })
}

export function readHireProposal(
  id: string,
  signal?: AbortSignal
): Promise<HireProposalView> {
  return node.get<HireProposalView>(
    `/api/v1/hire-proposals/${encodeURIComponent(id)}`,
    { signal }
  )
}

/// What a shop states when it asks for somebody.
///
/// Deliberately no NIK, no address, no contact detail — the schema has no
/// column for any of them. A candidate is somebody who may never work here,
/// and personal data starts existing when they actually do.
export interface HireTerms {
  readonly position: string
  readonly headcount: number
  /// `REPLACEMENT` or `ADDITION`.
  readonly need: string
  readonly candidateName: string
  readonly startOn: string
  /// `PKWT` or `PKWTT`. A fixed term must name its end date; a permanent one
  /// has nowhere to put one.
  readonly contractKind: string
  readonly contractEndsOn?: string
  readonly basePayMinor: number
  readonly reason: string
}

/// The terms, plus the unit. Only a *proposal* carries one.
export interface HireAsk extends HireTerms {
  readonly unitId: string
}

/// Everything a revision may change — which is everything except where.
///
/// `ReviseBody` on the server is `deny_unknown_fields` and has no `unit_id`,
/// deliberately: *"a proposal that changed shops would be a different
/// proposal"*. So sending one is not a harmless extra field, it is a rejected
/// request — and the shape here says so rather than leaving the caller to find
/// out from a 422.
function termsBody(terms: HireTerms) {
  return {
    position: terms.position,
    headcount: terms.headcount,
    need: terms.need,
    candidate_name: terms.candidateName,
    start_on: terms.startOn,
    contract_kind: terms.contractKind,
    contract_ends_on: terms.contractEndsOn ?? null,
    base_pay_minor: terms.basePayMinor,
    reason: terms.reason,
  }
}

export function proposeHire(ask: HireAsk): Promise<HireProposalView> {
  return node.post<HireProposalView>("/api/v1/hire-proposals", {
    unit_id: ask.unitId,
    ...termsBody(ask),
  })
}

/// A revision is a new version, and the one it replaced stays readable with
/// the reason it was returned.
export function reviseHire(
  id: string,
  terms: HireTerms
): Promise<HireProposalView> {
  return node.post<HireProposalView>(
    `/api/v1/hire-proposals/${encodeURIComponent(id)}/revision`,
    termsBody(terms)
  )
}

export function decideHire(
  id: string,
  decision: "APPROVE" | "RETURN" | "REJECT",
  reason: string
): Promise<HireProposalView> {
  return node.post<HireProposalView>(
    `/api/v1/hire-proposals/${encodeURIComponent(id)}/decision`,
    { decision, reason }
  )
}

/// Opening the employment record an approval permits.
///
/// It creates a **candidate**, not a working employee: the `HIRE` event is
/// recorded on the day somebody actually starts, through the Directory. So
/// "approved" is never rendered as "hired".
export function openHiredEmployment(
  id: string,
  employeeCode: string,
  reason: string
): Promise<HireProposalView> {
  return node.post<HireProposalView>(
    `/api/v1/hire-proposals/${encodeURIComponent(id)}/employment`,
    { employee_code: employeeCode, reason }
  )
}

// ── what a day amounted to ─────────────────────────────────────────────────

export const punchKeys = {
  all: ["people", "attendance"] as const,
  today: (unit: string, date: string) =>
    ["people", "attendance", "today", unit, date] as const,
  of: (employeeId: string, from: string, to: string) =>
    ["people", "attendance", "employee", employeeId, from, to] as const,
  corrections: (unit: string | null, pending: boolean) =>
    ["people", "attendance", "corrections", unit ?? "all", pending] as const,
  readiness: (unit: string, period: string) =>
    ["people", "attendance", "readiness", unit, period] as const,
  terminals: (unit: string | null) =>
    ["people", "attendance", "terminals", unit ?? "all"] as const,
  enrolment: (employeeId: string) =>
    ["people", "attendance", "fingerprints", employeeId] as const,
}

/// One unit, one day. `punch_source_connected` is the field to read FIRST:
/// false means no station has ever reported, and every zero under it is an
/// absence of evidence rather than evidence of absence.
export function readToday(
  unit: string,
  date?: string,
  signal?: AbortSignal
): Promise<TodayView> {
  const params = new URLSearchParams({ unit })
  if (date) params.set("date", date)
  return node.get<TodayView>(`/api/v1/attendance/today?${params.toString()}`, {
    signal,
  })
}

export function readAttendance(
  employeeId: string,
  from: string,
  to: string,
  signal?: AbortSignal
): Promise<AttendanceRangeView> {
  const params = new URLSearchParams({ from, to })
  return node.get<AttendanceRangeView>(
    `/api/v1/employees/${encodeURIComponent(employeeId)}/attendance?${params.toString()}`,
    { signal }
  )
}

export function punchReadiness(
  unit: string,
  period: string,
  signal?: AbortSignal
): Promise<PunchReadinessView> {
  const params = new URLSearchParams({ unit, period })
  return node.get<PunchReadinessView>(
    `/api/v1/attendance/punch-readiness?${params.toString()}`,
    { signal }
  )
}

// ── a correction sits on top of a punch, never over it ─────────────────────

export function listCorrections(
  options: { unit?: string; pending?: boolean } = {},
  signal?: AbortSignal
): Promise<CorrectionRow[]> {
  const params = new URLSearchParams()
  if (options.unit) params.set("unit", options.unit)
  params.set("pending", String(options.pending ?? false))
  return node.get<CorrectionRow[]>(
    `/api/v1/attendance-corrections?${params.toString()}`,
    { signal }
  )
}

export interface CorrectionAsk {
  readonly businessDate: string
  /// What the correction claims: the server's vocabulary, not the screen's.
  readonly effect: string
  readonly arrival?: string
  readonly departure?: string
  readonly arrivalDayOffset?: number
  readonly departureDayOffset?: number
  readonly reason: string
}

export function fileCorrection(
  employeeId: string,
  ask: CorrectionAsk
): Promise<CorrectionRow> {
  return node.post<CorrectionRow>(
    `/api/v1/employees/${encodeURIComponent(employeeId)}/attendance-corrections`,
    {
      business_date: ask.businessDate,
      effect: ask.effect,
      arrival: ask.arrival ?? null,
      departure: ask.departure ?? null,
      arrival_day_offset: ask.arrivalDayOffset ?? 0,
      departure_day_offset: ask.departureDayOffset ?? 0,
      reason: ask.reason,
    }
  )
}

/// Approve or refuse. The requester and the decider must be different actors,
/// and the server refuses the same one — this is not a screen-level rule.
///
/// Answers with the day's whole chain rather than the one row decided: an
/// approval can supersede an earlier correction of the same day, and the row
/// alone would not say which one is now in force.
export function decideCorrection(
  id: string,
  approve: boolean,
  reason: string
): Promise<CorrectionRow[]> {
  return node.post<CorrectionRow[]>(
    `/api/v1/attendance-corrections/${encodeURIComponent(id)}/decision`,
    { approve, reason }
  )
}

export function withdrawCorrection(
  id: string,
  reason: string
): Promise<CorrectionRow> {
  return node.post<CorrectionRow>(
    `/api/v1/attendance-corrections/${encodeURIComponent(id)}/withdrawal`,
    { reason }
  )
}

// ── the stations, and whose fingers they know ──────────────────────────────

export function listTerminals(
  unit?: string,
  signal?: AbortSignal
): Promise<TerminalRow[]> {
  const suffix = unit ? `?unit=${encodeURIComponent(unit)}` : ""
  return node.get<TerminalRow[]>(`/api/v1/attendance-terminals${suffix}`, {
    signal,
  })
}

/// Register a station **at a site**: it is a machine on a wall, so the server
/// asks where it is installed and reads the unit it attests for off the site.
export function registerTerminal(body: {
  terminalId: string
  siteId: string
  name: string
  reason: string
}): Promise<TerminalRow[]> {
  return node.post<TerminalRow[]>("/api/v1/attendance-terminals", {
    terminal_id: body.terminalId,
    site_id: body.siteId,
    name: body.name,
    reason: body.reason,
  })
}

export function setTerminalStatus(
  id: string,
  status: string,
  reason: string
): Promise<TerminalRow[]> {
  return node.post<TerminalRow[]>(
    `/api/v1/attendance-terminals/${encodeURIComponent(id)}/status`,
    { status, reason }
  )
}

/// Which fingers somebody has on file — **never the template**. The bytes live
/// in a type with no `Serialize`, so no browser can ask for them however it
/// phrases the request.
export function readEnrolment(
  employeeId: string,
  signal?: AbortSignal
): Promise<EnrolmentView> {
  return node.get<EnrolmentView>(
    `/api/v1/employees/${encodeURIComponent(employeeId)}/fingerprints`,
    { signal }
  )
}

export function withdrawFinger(
  employeeId: string,
  finger: string,
  reason: string
): Promise<EnrolmentView> {
  return node.post<EnrolmentView>(
    `/api/v1/employees/${encodeURIComponent(employeeId)}/fingerprints/${encodeURIComponent(finger)}/withdrawal`,
    { reason }
  )
}

/// Push a unit's roster and its people down to that unit's station, so a
/// terminal with the line down still greets by name and knows the shift.
export function publishEmployeeBook(unitId: string): Promise<BookPublished> {
  return node.post<BookPublished>("/api/v1/attendance/employee-book", {
    unit_id: unitId,
  })
}

// ── expense claims ─────────────────────────────────────────────────────────

/// Petty cash, asked for on paper and sanctioned by two people.
///
/// A claim is filed — by the person themselves, or by a manager for one of
/// their staff — submitted exactly once, decided exactly once by somebody who
/// did not file it, and paid exactly once out of the unit's petty cash.
/// Approving one posts what the company owes the moment it is approved, so the
/// ledger carries the debt during the days a claim sits approved and unpaid;
/// the payout only moves the money.
///
/// # The shapes below are structural, not generated — for now
///
/// Exactly like `WorkforcePage` above: the backend lane and this one are
/// landing against the same written agreement, and the generated union in
/// `@itulah/contract` will carry these shapes at its next `make contract`.
/// Until then the agreement — not this file — is what keeps the two sides
/// honest, and the shapes say so in one place rather than in every screen.

export type ClaimState =
  "DRAFT" | "SUBMITTED" | "APPROVED" | "REJECTED" | "PAID" | "WITHDRAWN"

export interface ClaimTypeRow {
  readonly code: string
  readonly name: string
  readonly retired_at: string | null
  readonly created_at: string
}

/// One row of the folded history. `detail` is where a document number lands —
/// the payout names the entry it posted, and the trail is where it says so.
export interface ClaimEventRow {
  readonly actor: string
  readonly action: string
  readonly reason: string | null
  readonly at: string
  readonly detail?: string | null
}

export interface ClaimLineRow {
  readonly line_id: string
  readonly type_code: string
  readonly type_name: string
  readonly description: string
  readonly spent_on: string
  readonly claimed_minor: number
  /// The decider's figure, per line. Null until decided — which is what lets
  /// a claim read as "asked for" rather than "granted" while it waits.
  readonly sanctioned_minor: number | null
  readonly line_number: number
}

export interface ClaimRow {
  readonly claim_id: string
  readonly claim_number: string
  readonly unit_id: string
  readonly unit_name: string | null
  readonly employee_id: string
  readonly employee_code: string | null
  readonly employee_name: string | null
  readonly posted_on: string
  readonly state: ClaimState
  /// The sum of the lines as filed.
  readonly claimed_minor: number
  /// The sum of the sanctioned lines. Null while undecided, by the same rule
  /// as the lines under it.
  readonly sanctioned_minor: number | null
  readonly claimed_by: string
  readonly decided_by: string | null
  readonly decided_at: string | null
  readonly decide_reason: string | null
  readonly paid_at: string | null
  readonly paid_by: string | null
  /// The journal entry the payout posted, set exactly when the state is PAID.
  /// Not shown as a figure — it is the receipt's handle in the ledger.
  readonly paid_entry_id: string | null
  readonly lines: readonly ClaimLineRow[]
  readonly history: readonly ClaimEventRow[]
}

export const claimsKeys = {
  types: () => ["people", "claims", "types"] as const,
  /// What is waiting on a decision. No unit in the key: the server bounds it
  /// by the caller's own posting, so two managers never share an answer.
  queue: () => ["people", "claims", "queue"] as const,
  list: (filters: ClaimFilters = {}) =>
    [
      "people",
      "claims",
      "list",
      filters.unit ?? null,
      filters.state ?? null,
      filters.employee ?? null,
    ] as const,
  of: (employeeId: string) => ["people", "claims", "of", employeeId] as const,
  /// The finance advances still out with one person. Keyed here, dropped with
  /// the module: a section on the Directory sheet has no business leaving
  /// what it read about a person in the cache after that person signs out.
  advances: (employeeId: string) =>
    ["people", "claims", "advances", employeeId] as const,
}

export interface ClaimFilters {
  readonly unit?: string
  readonly state?: string
  readonly employee?: string
}

/// What a claim state means in a sentence.
///
/// `SUBMITTED` is Pending, the way the leave queue spells it, and the other
/// two answers are Rejected and Withdrawn (`lib/words.ts`). `APPROVED` is
/// spelled as what it *costs* — approved and unpaid is money owed, and a pill
/// saying only "approved" hides that.
export function claimStateLabel(state: string): string {
  switch (state) {
    case "DRAFT":
      return "Draft — not sent yet"
    case "SUBMITTED":
      return STATUS.pending
    case "APPROVED":
      return "Approved, not yet paid"
    case "REJECTED":
      return STATUS.rejected
    case "PAID":
      return "Paid"
    case "WITHDRAWN":
      return STATUS.withdrawn
    default:
      return state
  }
}

/// Which tint a claim state wears. `info` for approved-unpaid is the one
/// choice worth naming: the money is in motion — owed, en route to the
/// petty-cash drawer — and sky is what this language reserves for that.
export function claimStateTone(state: string): Tone {
  switch (state) {
    case "SUBMITTED":
      return "warn"
    case "APPROVED":
      return "info"
    case "PAID":
      return "ok"
    default:
      return "neutral"
  }
}

/// What a history action means, said to a person.
export function claimActionLabel(action: string): string {
  switch (action) {
    case "FILED":
      return "Filed"
    case "SUBMITTED":
      return "Sent in"
    case "DECIDED":
      return "Decided"
    case "RETURNED":
      return "Sent back"
    case "PAID":
      return "Paid"
    case "WITHDRAWN":
      return STATUS.withdrawn
    default:
      return action
  }
}

// ── the catalogue ──────────────────────────────────────────────────────────

export function listClaimTypes(signal?: AbortSignal): Promise<ClaimTypeRow[]> {
  return node.get<ClaimTypeRow[]>("/api/v1/expense-claim-types", { signal })
}

/// Ratify a kind of expense. There is no edit and no delete: redefining a kind
/// would change what every claim already filed against it meant, and deleting
/// one would leave those claims pointing at nothing.
///
/// `expenseCategory` is Finance's expense category the kind is filed under —
/// one with `for_claims` set. Its account links say which account the cost
/// lands on and which liability it is owed on; the server refuses a kind
/// without one.
export function defineClaimType(
  code: string,
  name: string,
  expenseCategory: string
): Promise<ClaimTypeRow[]> {
  return node.post<ClaimTypeRow[]>("/api/v1/expense-claim-types", {
    code,
    name,
    expense_category: expenseCategory,
  })
}

/// Retire, never delete — the shift-pattern rule. A claim already filed
/// against a kind keeps naming it, and the trail stays readable.
export function retireClaimType(
  code: string,
  reason: string
): Promise<ClaimTypeRow[]> {
  return node.post<ClaimTypeRow[]>(
    `/api/v1/expense-claim-types/${encodeURIComponent(code)}/retirement`,
    { reason }
  )
}

// ── reading and writing claims ─────────────────────────────────────────────

/// The claims the caller may see — a unit's, or every unit's — narrowed by
/// whichever of the three the caller asked for. The queue is this same route
/// asked for SUBMITTED and nothing else.
export function listClaims(
  filters: ClaimFilters = {},
  signal?: AbortSignal
): Promise<ClaimRow[]> {
  const params = new URLSearchParams()
  if (filters.unit) params.set("unit", filters.unit)
  if (filters.state) params.set("state", filters.state)
  if (filters.employee) params.set("employee", filters.employee)
  const suffix = params.size > 0 ? `?${params.toString()}` : ""
  return node.get<ClaimRow[]>(`/api/v1/expense-claims${suffix}`, { signal })
}

/// Everything waiting on a decision, bounded by the caller's posting.
export function pendingClaims(signal?: AbortSignal): Promise<ClaimRow[]> {
  return listClaims({ state: "SUBMITTED" }, signal)
}

/// One person's claims, in the same row shape the list serves.
///
/// Its own route rather than the list narrowed: the Directory sheet asks
/// about a person, and a claimant reads their own under the same bound.
export function claimsOf(
  employeeId: string,
  signal?: AbortSignal
): Promise<ClaimRow[]> {
  return node.get<ClaimRow[]>(
    `/api/v1/employees/${encodeURIComponent(employeeId)}/expense-claims`,
    { signal }
  )
}

export interface NewClaimLine {
  readonly typeCode: string
  readonly description: string
  /// A day, `YYYY-MM-DD` — when the money was spent, not when the claim is
  /// filed. The two differ by however long the receipt sat in a pocket.
  readonly spentOn: string
  /// Whole rupiah as an integer — the server's minor unit is already the
  /// rupiah, and a fraction of one is not a thing a receipt shows.
  readonly amountMinor: number
}

/// File a claim on behalf of one of the caller's staff, or on the caller's own
/// behalf — the server checks which of the two the caller may do, and the body
/// is the same either way. The unit is not asked for because it is not the
/// filer's to choose: the claim belongs to the unit the *employee* is posted
/// to, and the server knows where that is.
export function fileClaim(
  employeeId: string,
  lines: readonly NewClaimLine[],
  reason: string
): Promise<ClaimRow> {
  return node.post<ClaimRow>("/api/v1/expense-claims", {
    employee_id: employeeId,
    lines: lines.map((line) => ({
      type_code: line.typeCode,
      description: line.description,
      spent_on: line.spentOn,
      claimed_minor: line.amountMinor,
    })),
    // Required by the server: a claim with no stated purpose is half an audit
    // trail, and the filing actor is assembled from the session rather than
    // from the body.
    reason,
  })
}

/// DRAFT → SUBMITTED. The filer's own act: a claim that leaves the desk does
/// so under the name that put it on the desk.
export function submitClaim(
  claimId: string,
  reason: string
): Promise<ClaimRow> {
  return node.post<ClaimRow>(
    `/api/v1/expense-claims/${encodeURIComponent(claimId)}/submission`,
    // The server refuses an empty reason rather than recording a submission
    // nobody explained.
    { reason }
  )
}

/// Take a claim back — the filer's, while it is still theirs to take.
export function withdrawClaim(
  claimId: string,
  reason: string
): Promise<ClaimRow> {
  return node.post<ClaimRow>(
    `/api/v1/expense-claims/${encodeURIComponent(claimId)}/withdrawal`,
    { reason }
  )
}

/// Decide, with a figure per line.
///
/// The sanctions travel with the decision because they *are* the decision:
/// approving "Rp 300.000 of a Rp 450.000 claim" is not one fact but one per
/// line, and the server totals them into the header rather than trusting a
/// browser's arithmetic. A line sanctioned to nothing is refused by name, so
/// an input left at zero stops the form rather than the ledger.
export function decideClaim(
  claimId: string,
  approve: boolean,
  reason: string,
  sanctions: readonly { lineId: string; sanctionedMinor: number }[]
): Promise<ClaimRow> {
  return node.post<ClaimRow>(
    `/api/v1/expense-claims/${encodeURIComponent(claimId)}/decision`,
    {
      approve,
      reason,
      lines: sanctions.map((one) => ({
        line_id: one.lineId,
        sanctioned_minor: one.sanctionedMinor,
      })),
    }
  )
}

/// Send it back to the filer. Not a refusal: the claim returns to DRAFT with
/// the reason attached, and can be corrected and sent in again.
export function returnClaim(
  claimId: string,
  reason: string
): Promise<ClaimRow> {
  return node.post<ClaimRow>(
    `/api/v1/expense-claims/${encodeURIComponent(claimId)}/returnal`,
    { reason }
  )
}

/// Pay an approved claim out of the unit's petty cash.
///
/// No body: there is nothing to decide here and nothing to explain — the
/// decision was the previous act, and this one only moves the money it
/// already owes. The document number is minted where the entry is posted.
export function payClaim(claimId: string): Promise<ClaimRow> {
  return node.post<ClaimRow>(
    `/api/v1/expense-claims/${encodeURIComponent(claimId)}/payout`,
    // No body here either — the decision was the previous act.
    {}
  )
}

// ── the advances beside them ───────────────────────────────────────────────

/// One open advance the finance lane (0280) is holding for this person, with
/// every leg money has come back by.
///
/// # Structural until the next `make contract`
///
/// The mirror of `postgres::claims::EmployeeAdvanceView`, read through the
/// employee route served for it. The settlement figures are a fold over
/// `advance_settlement`, not columns — an advance's outstanding is the
/// arithmetic of what came back, and storing it beside the ledger would be
/// the halfway state that crate exists to make impossible. (`party_type`,
/// not `party_kind`: 0299 renamed the column when it minted the registry.)
export interface EmployeeAdvanceRow {
  readonly advance_id: string
  readonly advance_number: string
  readonly site_id: string
  readonly purpose: string
  readonly amount_minor: number
  /// Receipts handed in against it.
  readonly settled_minor: number
  /// Cash the person paid back.
  readonly refunded_minor: number
  /// Repaid out of a wage: the settlements an approved run posts, one per
  /// recovery the unit filed against this advance.
  readonly recovered_minor: number
  /// The amount minus the three legs — what is still out.
  readonly outstanding_minor: number
  readonly status: string
  readonly requested_at: string
  readonly paid_at: string | null
}

/// What is still out with one person — money they are holding that has not
/// come back as receipts, as a refund, or out of a wage.
///
/// This is People *reading* Finance's table, not rebuilding it: advances are
/// the finance lane's (0280), and a second module storing its own answer
/// would be two answers. The narrowing to one employee is the server's now —
/// the employee route answers one person directly, which is where the fix
/// this fetcher's earlier shape predicted ended up living.
export function openAdvances(
  employeeId: string,
  signal?: AbortSignal
): Promise<EmployeeAdvanceRow[]> {
  return node
    .get<EmployeeAdvanceRow[]>(
      `/api/v1/employees/${encodeURIComponent(employeeId)}/advances`,
      { signal }
    )
    .then((rows) =>
      rows.filter(
        (row) =>
          // What is still out is the fact a manager acts on; a settled advance
          // is history the finance screens already keep.
          row.outstanding_minor > 0
      )
    )
}

// ── grievances ─────────────────────────────────────────────────────────────

/// The confidential channel, and the reason it is head office's.
///
/// A grievance against a store manager cannot be investigated by that store
/// manager, and in a thirteen-store estate the only unit that is nobody's
/// posting is head office. So the queue is HO's — reading it is its own key,
/// finer than the ladder, precisely so the accused supervisor who holds
/// `people.employee.read` does not therefore read the queue.
///
/// # Two actors, twice
///
/// Nobody investigates or resolves their own filing, and investigating and
/// resolving are two signatures under two keys — the payroll lesson again.
/// The screen offers the acts and lets the server answer, which is the claims
/// sheet's rule: a button that appears a moment late is worse than one that
/// is answered honestly.
///
/// # The shapes below are structural, not generated — for now
///
/// The same arrangement as the claims above: the backend lane and this one
/// are landing against the same written agreement, and the generated union in
/// `@itulah/contract` carries these shapes at its next `make contract`.

export type GrievanceState =
  "OPEN" | "INVESTIGATED" | "RESOLVED" | "INVALID" | "WITHDRAWN"

export interface GrievanceTypeRow {
  readonly code: string
  readonly name: string
  readonly retired_at: string | null
  readonly created_at: string
}

/// One row of the folded history. Same decode discipline as a claim's.
export interface GrievanceEventRow {
  readonly actor: string
  readonly action: string
  readonly reason: string | null
  readonly at: string
  readonly detail?: string | null
}

export interface GrievanceRow {
  readonly grievance_id: string
  readonly unit_id: string
  readonly unit_name: string | null
  readonly type_code: string
  /// Resolved from the catalogue on the server, falling back to the code —
  /// the words survive even if the kind is retired.
  readonly type_name: string
  readonly raised_by: string
  readonly raised_by_name: string | null
  /// Who put it on the desk — the person themselves, or a manager filing for
  /// their staff. A username: the two-actor rule compares these.
  readonly filed_by: string
  /// Optional: a grievance may be against a policy, not a person.
  readonly against_employee: string | null
  readonly against_name: string | null
  readonly subject: string
  readonly description: string
  readonly cause: string | null
  readonly state: GrievanceState
  readonly investigated_by: string | null
  readonly investigated_at: string | null
  readonly investigation_note: string | null
  readonly resolved_by: string | null
  readonly resolved_at: string | null
  readonly resolved_on: string | null
  readonly resolution_detail: string | null
  readonly withdrawn_at: string | null
  readonly created_at: string
  readonly history: readonly GrievanceEventRow[]
}

export const grievanceKeys = {
  types: () => ["people", "grievances", "types"] as const,
  /// One state's rows, or every row the caller may see. No unit in the key:
  /// reading is head office's, bounded by nothing — and for a caller without
  /// the read key the same key holds their own filings, which is the server's
  /// branch to make, not the browser's.
  list: (state: string | null) =>
    ["people", "grievances", "list", state] as const,
}

export interface GrievanceFilters {
  readonly state?: string
}

/// What a grievance state means in a sentence.
///
/// The two live states are spelled as what they wait for, because that is the
/// only thing anybody opening the queue wants to know: an OPEN grievance waits
/// to be investigated, an INVESTIGATED one waits for the decision itself —
/// two signatures, and the pill says which desk it is on.
export function grievanceStateLabel(state: string): string {
  switch (state) {
    case "OPEN":
      return "Open — waiting to be investigated"
    case "INVESTIGATED":
      return "Investigated — awaiting the decision"
    case "RESOLVED":
      return "Resolved — upheld"
    case "INVALID":
      return "Not upheld"
    case "WITHDRAWN":
      return "Withdrawn"
    default:
      return state
  }
}

/// Which tint a grievance state wears. `info` for investigated is the claims
/// rule: the file is in motion between two desks, and sky is what this
/// language reserves for that.
export function grievanceStateTone(state: string): Tone {
  switch (state) {
    case "OPEN":
      return "warn"
    case "INVESTIGATED":
      return "info"
    case "RESOLVED":
      return "ok"
    default:
      return "neutral"
  }
}

/// What a history action means, said to a person.
export function grievanceActionLabel(action: string): string {
  switch (action) {
    case "FILED":
      return "Filed"
    case "INVESTIGATED":
      return "Investigated"
    case "RESOLVED":
      return "Resolved — upheld"
    case "INVALID":
      return "Not upheld"
    case "WITHDRAWN":
      return "Withdrawn"
    default:
      return action
  }
}

// ── the catalogue ──────────────────────────────────────────────────────────

export function listGrievanceTypes(
  signal?: AbortSignal
): Promise<GrievanceTypeRow[]> {
  return node.get<GrievanceTypeRow[]>("/api/v1/grievance-types", { signal })
}

/// Ratify a kind of grievance. There is no edit and no delete — the
/// leave-types rule: redefining a kind would change what every grievance
/// already filed against it meant.
export function defineGrievanceType(
  code: string,
  name: string
): Promise<GrievanceTypeRow[]> {
  return node.post<GrievanceTypeRow[]>("/api/v1/grievance-types", {
    code,
    name,
  })
}

/// Retire, never delete — a grievance already filed against a kind keeps
/// naming it.
export function retireGrievanceType(
  code: string,
  reason: string
): Promise<GrievanceTypeRow[]> {
  return node.post<GrievanceTypeRow[]>(
    `/api/v1/grievance-types/${encodeURIComponent(code)}/retirement`,
    { reason }
  )
}

// ── reading and writing grievances ─────────────────────────────────────────

/// The grievances the caller may see. For head office that is the queue, whole;
/// for anybody else it is their own filings and nothing else — the server
/// branches on the caller, and this surface does not re-implement the branch.
/// The queue tab is the two live states asked separately and merged, because
/// OPEN and INVESTIGATED are both waiting on head office and the route takes
/// one state per call.
export function listGrievances(
  filters: GrievanceFilters = {},
  signal?: AbortSignal
): Promise<GrievanceRow[]> {
  const suffix = filters.state
    ? `?state=${encodeURIComponent(filters.state)}`
    : ""
  return node.get<GrievanceRow[]>(`/api/v1/grievances${suffix}`, { signal })
}

/// File one, for a member of staff or for yourself.
///
/// `employeeId` absent means the caller's own — the server checks which of the
/// two the caller may do, and the body is the same either way. The unit is
/// not asked for because it is not the filer's to choose: the grievance
/// belongs to the unit the *employee* is posted to, and the server knows
/// where that is.
export function fileGrievance(ask: {
  readonly employeeId?: string
  readonly typeCode: string
  readonly againstEmployee?: string
  readonly subject: string
  readonly description: string
  readonly cause?: string
}): Promise<GrievanceRow> {
  return node.post<GrievanceRow>("/api/v1/grievances", {
    employee_id: ask.employeeId,
    type_code: ask.typeCode,
    against_employee: ask.againstEmployee,
    subject: ask.subject,
    description: ask.description,
    cause: ask.cause,
  })
}

/// Record the investigation. The first of the two signatures — it moves the
/// grievance to INVESTIGATED and writes the note, but decides nothing.
export function investigateGrievance(
  grievanceId: string,
  note: string
): Promise<GrievanceRow> {
  return node.post<GrievanceRow>(
    `/api/v1/grievances/${encodeURIComponent(grievanceId)}/investigation`,
    { note }
  )
}

/// Decide it. The second signature, under its own key: upheld becomes
/// RESOLVED, not upheld becomes INVALID, and either way the detail is
/// required — a decision that says what changed but not why is half an audit
/// trail.
export function resolveGrievance(
  grievanceId: string,
  valid: boolean,
  detail: string
): Promise<GrievanceRow> {
  return node.post<GrievanceRow>(
    `/api/v1/grievances/${encodeURIComponent(grievanceId)}/resolution`,
    { valid, detail }
  )
}

/// Take it back — the filer's own act, while it is still live.
export function withdrawGrievance(
  grievanceId: string,
  reason: string
): Promise<GrievanceRow> {
  return node.post<GrievanceRow>(
    `/api/v1/grievances/${encodeURIComponent(grievanceId)}/withdrawal`,
    { reason }
  )
}

// ── exits: the interview and the full & final statement ────────────────────

/// One per person, at the end.
///
/// The employment machine already terminates with a reason; the exit
/// interview records what the person *said* when they went. It is created
/// automatically as PENDING when an employment ends, and completing it is
/// head office's — the store is a party to the exit, never its author.
///
/// A terminated leaver also carries money in both directions, and the full &
/// final statement is the *frozen* answer: what Finance settles against
/// stops moving the moment the statement is settled. The advance and
/// approved-unpaid claim totals are reads of live tables at creation; the
/// settle re-reads them and refuses on drift, naming what moved.

export type ExitInterviewState = "PENDING" | "COMPLETED" | "CANCELLED"

export type ExitStance = "RETAINED" | "EXIT_CONFIRMED"

export interface ExitInterviewRow {
  readonly exit_id: string
  readonly employee_id: string
  readonly employee_code: string | null
  readonly employee_name: string | null
  readonly unit_id: string
  readonly unit_name: string | null
  readonly state: ExitInterviewState
  readonly employee_stance: ExitStance
  readonly interview_summary: string | null
  readonly conducted_by: string | null
  readonly completed_at: string | null
  readonly cancelled_by: string | null
  readonly cancel_reason: string | null
  readonly created_at: string
}

export type FnFState = "DRAFT" | "SETTLED" | "CANCELLED"

/// One row of the statement's folded history. `detail` is where the journal
/// entry number lands — the settlement names the entry it posted, and the
/// trail is where it says so.
export interface FnFEventRow {
  readonly actor: string
  readonly action: string
  readonly reason: string | null
  readonly at: string
  readonly detail?: string | null
}

export interface FnFRow {
  readonly fnf_id: string
  readonly employee_id: string
  readonly employee_code: string | null
  readonly employee_name: string | null
  readonly unit_id: string
  readonly unit_name: string | null
  readonly transaction_on: string
  readonly state: FnFState
  /// The aggregated reads, frozen at creation and compared again at settle.
  /// Money the leaver is still holding (advances) and money still owed to
  /// them (approved, unpaid claims), in the ledger's minor unit.
  readonly advance_outstanding_minor: number
  readonly claim_payable_minor: number
  /// The manual asset-recovery rows summed.
  readonly asset_recovery_minor: number
  /// The last run's gross, or a stated figure.
  readonly final_pay_minor: number
  /// The net the settlement posts, computed by the server from the frozen
  /// figures — final pay and claims payable out, advances and asset recovery
  /// back. The screens display this field; none of them recompute it, so the
  /// figure a person reads is the figure the journal settles.
  readonly net_payable_minor: number
  /// The journal entry the settlement posted, set exactly when SETTLED.
  readonly settled_entry_id: string | null
  readonly settled_by: string | null
  readonly settled_at: string | null
  readonly cancelled_by: string | null
  readonly cancel_reason: string | null
  readonly created_by: string
  readonly created_at: string
  readonly history: readonly FnFEventRow[]
}

export const exitKeys = {
  /// Every interview the caller may see — the server bounds it by reach, so a
  /// shop sees its own leavers and head office sees every one.
  list: (filters: { readonly state?: string } = {}) =>
    ["people", "exits", "interviews", filters.state ?? null] as const,
  of: (employeeId: string) =>
    ["people", "exits", "interviews", "of", employeeId] as const,
}

export const fnfKeys = {
  list: () => ["people", "exits", "fnf", "list"] as const,
  of: (employeeId: string) =>
    ["people", "exits", "fnf", "of", employeeId] as const,
}

/// What an interview state means in a sentence.
export function exitInterviewStateLabel(state: string): string {
  switch (state) {
    case "PENDING":
      return "Waiting to be conducted"
    case "COMPLETED":
      return "Completed"
    case "CANCELLED":
      return "Cancelled"
    default:
      return state
  }
}

export function exitInterviewStateTone(state: string): Tone {
  switch (state) {
    case "PENDING":
      return "warn"
    case "COMPLETED":
      return "ok"
    default:
      return "neutral"
  }
}

/// What the leaver said, said plainly — the one sentence the interview exists
/// to record.
export function exitStanceLabel(stance: string): string {
  switch (stance) {
    case "RETAINED":
      return "Wanted to stay"
    case "EXIT_CONFIRMED":
      return "Confirmed the exit"
    default:
      return stance
  }
}

/// What a statement state means in a sentence.
export function fnfStateLabel(state: string): string {
  switch (state) {
    case "DRAFT":
      return "Draft — not settled"
    case "SETTLED":
      return "Settled"
    case "CANCELLED":
      return "Cancelled"
    default:
      return state
  }
}

export function fnfStateTone(state: string): Tone {
  switch (state) {
    case "DRAFT":
      return "warn"
    case "SETTLED":
      return "ok"
    default:
      return "neutral"
  }
}

/// What a history action means, said to a person.
export function fnfActionLabel(action: string): string {
  switch (action) {
    case "CREATED":
      return "Opened"
    case "SETTLED":
      return "Settled"
    case "CANCELLED":
      return "Cancelled"
    default:
      return action
  }
}

// ── reading and writing exits ──────────────────────────────────────────────

/// The exit interviews the caller may see, bounded by their own reach.
export function listExitInterviews(
  filters: { readonly state?: string; readonly employee?: string } = {},
  signal?: AbortSignal
): Promise<ExitInterviewRow[]> {
  const params = new URLSearchParams()
  if (filters.state) params.set("state", filters.state)
  if (filters.employee) params.set("employee", filters.employee)
  const suffix = params.size > 0 ? `?${params.toString()}` : ""
  return node.get<ExitInterviewRow[]>(`/api/v1/exit-interviews${suffix}`, {
    signal,
  })
}

/// Open the interview for a leaver whose employment ended before the hook
/// existed. Idempotent on the server — an interview that already exists comes
/// back rather than a second one — and refused for anybody not TERMINATED.
export function fileExitInterview(
  employeeId: string
): Promise<ExitInterviewRow> {
  return node.post<ExitInterviewRow>("/api/v1/exit-interviews", {
    employee_id: employeeId,
  })
}

/// Complete it: what the person said, and whether they went anyway.
export function completeExitInterview(
  exitId: string,
  stance: ExitStance,
  summary?: string
): Promise<ExitInterviewRow> {
  return node.post<ExitInterviewRow>(
    `/api/v1/exit-interviews/${encodeURIComponent(exitId)}/completion`,
    { stance, summary }
  )
}

/// The statements, whole rows — the sheet finds its row in the list, the way
/// the claims screen does, and narrows to one leaver with `?employee=`.
export function listFnF(
  employee?: string,
  signal?: AbortSignal
): Promise<FnFRow[]> {
  const suffix = employee ? `?employee=${encodeURIComponent(employee)}` : ""
  return node.get<FnFRow[]>(`/api/v1/full-and-final-statements${suffix}`, {
    signal,
  })
}

/// A manual asset-recovery row: something of the company's the leaver is
/// returning, at an agreed figure. The asset id is the assets module's own.
export interface NewFnFAsset {
  readonly assetId: string
  readonly note: string
  readonly recoveryMinor: number
}

/// Open a statement. Creation freezes the live reads — open advances,
/// approved-unpaid claims — into the row, and the settle re-reads them and
/// refuses on drift. Only what the caller states here travels on the wire:
/// the frozen totals are the server's reads, not the browser's arithmetic.
export function openFnFStatement(ask: {
  readonly employeeId: string
  readonly transactionOn: string
  readonly finalPayMinor?: number
  readonly assets?: readonly NewFnFAsset[]
}): Promise<FnFRow> {
  return node.post<FnFRow>("/api/v1/full-and-final-statements", {
    employee_id: ask.employeeId,
    transaction_on: ask.transactionOn,
    final_pay_minor: ask.finalPayMinor,
    assets: ask.assets?.map((asset) => ({
      asset_id: asset.assetId,
      note: asset.note,
      recovery_minor: asset.recoveryMinor,
    })),
  })
}

/// Settle it. Posts one journal entry for the net, freezes the totals as the
/// settlement's figures, and refuses — naming what moved — if the live reads
/// have drifted from the frozen ones. The document number is minted where
/// the entry is posted.
export function settleFnF(fnfId: string): Promise<FnFRow> {
  return node.post<FnFRow>(
    `/api/v1/full-and-final-statements/${encodeURIComponent(fnfId)}/settlement`,
    // No body: there is nothing left to decide — the statement is the decision.
    {}
  )
}

/// Cancel a DRAFT. A settled statement is what Finance settled against and
/// does not come back on its own.
export function cancelFnF(fnfId: string, reason: string): Promise<FnFRow> {
  return node.post<FnFRow>(
    `/api/v1/full-and-final-statements/${encodeURIComponent(fnfId)}/cancellation`,
    { reason }
  )
}

// ── the next generation ─────────────────────────────────────────────────────
//
// Roster swaps, employment change proposals, the onboarding and separation
// checklist, the recruitment pipeline, performance, training, the rule
// numbers and the org masters. Everything here reads the routes the 0359
// backend added; every write carries a reason like the rest of the module.

export type RosterSwapView = {
  id: string
  employee_id: string
  with_employee_id: string
  unit_id: string
  on_date: string
  reason: string
  state: "PENDING" | "APPROVED" | "REJECTED" | "WITHDRAWN"
  requested_by: string
  decided_by: string | null
}

export type ChangeProposalView = {
  id: string
  employee_id: string
  unit_id: string
  kind: "PROMOTION" | "TRANSFER" | "SALARY" | "SEPARATION"
  props: { field: string; from: string; to: string }[]
  effective_on: string
  reason: string
  state: "PENDING" | "APPROVED" | "REJECTED" | "WITHDRAWN"
  filed_by: string
  decided_by: string | null
  decision_note: string | null
  applied_at: string | null
}

export type LifecycleTaskView = {
  id: string
  employee_id: string
  kind: "ONBOARDING" | "SEPARATION"
  template_id: string
  label: string
  owner: "HEAD_OFFICE" | "STORE" | "IT" | "EMPLOYEE"
  position: number
  state: "PENDING" | "DONE"
  done_by: string | null
}

export type StaffingPlanView = {
  id: string
  unit_id: string
  position: string
  span: string
  headcount: number
  cost_minor: number
}

export type ApplicantView = {
  id: string
  proposal_id: string
  unit_id: string
  name: string
  phone: string | null
  source: string
  referrer_employee_id: string | null
  stage: "NEW" | "SHORTLIST" | "INTERVIEW" | "OFFER" | "HIRED" | "REJECTED"
  stage_note: string | null
  applied_on: string
}

export type InterviewView = {
  id: string
  applicant_id: string
  scheduled_at: string
  interviewer_employee_id: string
  result: "SCHEDULED" | "PASS" | "FAIL"
  ratings: Record<string, number>
  note: string | null
  recorded_by: string
}

export type OfferView = {
  id: string
  applicant_id: string
  base_minor: number
  grade: string
  starts_on: string
  term: string
  state: "WAITING" | "ACCEPTED" | "DECLINED" | "WITHDRAWN"
  offered_by: string
  decided_by: string | null
  hired_employee_id: string | null
}

export type PerformanceTemplateView = {
  position: string
  metric: string
  weight: number
  source: string
}

export type PerformanceScoreView = {
  employee_id: string
  period: string
  kpi_pct: number
  manager_score: number
  note: string | null
  recorded_by: string
  bonus_rate_pct: number
}

export type TrainingProgramView = {
  id: string
  title: string
  on_date: string
  place: string
  cost_minor: number
  state: "SCHEDULED" | "DONE"
  participants: number
}

export type RuleView = {
  key: string
  group: string
  label: string
  value: number
  unit: string
  updated_by: string | null
}

export type GradeView = {
  code: string
  floor_minor: number
  ceiling_minor: number
}
export type PositionView = {
  name: string
  grade_floor: string
  grade_ceiling: string
  structure: string
}
export type StructureView = {
  code: string
  name: string
  bonus_cap_policy: string | null
  components: string[]
}

export const nextKeys = {
  all: ["people", "next"] as const,
  swaps: () => [...nextKeys.all, "swaps"] as const,
  pendingSwaps: () => [...nextKeys.all, "swaps", "pending"] as const,
  changes: (state?: string) =>
    [...nextKeys.all, "changes", state ?? "all"] as const,
  tasks: (kind?: string) => [...nextKeys.all, "tasks", kind ?? "all"] as const,
  plans: () => [...nextKeys.all, "plans"] as const,
  applicants: (stage?: string) =>
    [...nextKeys.all, "applicants", stage ?? "all"] as const,
  offers: () => [...nextKeys.all, "offers"] as const,
  performanceTemplates: () =>
    [...nextKeys.all, "performance", "templates"] as const,
  scores: (period?: string) =>
    [...nextKeys.all, "performance", period ?? "all"] as const,
  training: () => [...nextKeys.all, "training"] as const,
  rules: (group?: string) =>
    [...nextKeys.all, "rules", group ?? "all"] as const,
  org: () => [...nextKeys.all, "org"] as const,
}

const enc = encodeURIComponent

// ── roster swaps ────────────────────────────────────────────────────────────

export function pendingSwaps(signal?: AbortSignal): Promise<RosterSwapView[]> {
  return node.get<RosterSwapView[]>("/api/v1/roster-swaps/pending", { signal })
}

export function swapsOf(
  employeeId: string,
  signal?: AbortSignal
): Promise<RosterSwapView[]> {
  return node.get<RosterSwapView[]>(
    `/api/v1/employees/${enc(employeeId)}/roster-swaps`,
    { signal }
  )
}

export function fileSwap(body: {
  with_employee_id: string
  on_date: string
  reason: string
}): Promise<RosterSwapView> {
  return node.post<RosterSwapView>("/api/v1/roster-swaps", body)
}

export function decideSwap(
  id: string,
  body: { approved: boolean; reason: string }
): Promise<RosterSwapView> {
  return node.post<RosterSwapView>(
    `/api/v1/roster-swaps/${enc(id)}/decision`,
    body
  )
}

// ── employment change proposals ─────────────────────────────────────────────

export function listChangeProposals(
  query: { state?: string; unit_id?: string } = {},
  signal?: AbortSignal
): Promise<ChangeProposalView[]> {
  const params = new URLSearchParams()
  if (query.state) params.set("state", query.state)
  if (query.unit_id) params.set("unit_id", query.unit_id)
  const suffix = params.size > 0 ? `?${params.toString()}` : ""
  return node.get<ChangeProposalView[]>(`/api/v1/change-proposals${suffix}`, {
    signal,
  })
}

export function fileChangeProposal(
  employeeId: string,
  body: {
    kind: string
    props: { field: string; to_text?: string; to_minor?: number }[]
    effective_on: string
    reason: string
  }
): Promise<ChangeProposalView> {
  return node.post<ChangeProposalView>(
    `/api/v1/employees/${enc(employeeId)}/change-proposals`,
    body
  )
}

export function decideChangeProposal(
  id: string,
  body: { approved: boolean; reason: string; note?: string }
): Promise<ChangeProposalView> {
  return node.post<ChangeProposalView>(
    `/api/v1/change-proposals/${enc(id)}/decision`,
    body
  )
}

// ── the onboarding and separation checklist ─────────────────────────────────

export function listLifecycleTasks(
  query: { kind?: string; owner?: string; employee_id?: string } = {},
  signal?: AbortSignal
): Promise<LifecycleTaskView[]> {
  const params = new URLSearchParams()
  if (query.kind) params.set("kind", query.kind)
  if (query.owner) params.set("owner", query.owner)
  if (query.employee_id) params.set("employee_id", query.employee_id)
  const suffix = params.size > 0 ? `?${params.toString()}` : ""
  return node.get<LifecycleTaskView[]>(`/api/v1/lifecycle/tasks${suffix}`, {
    signal,
  })
}

export function completeLifecycleTask(
  taskId: string,
  reason: string
): Promise<LifecycleTaskView> {
  return node.post<LifecycleTaskView>(
    `/api/v1/lifecycle/tasks/${enc(taskId)}/completion`,
    { reason }
  )
}

// ── the recruitment pipeline ────────────────────────────────────────────────

export function listStaffingPlans(
  signal?: AbortSignal
): Promise<StaffingPlanView[]> {
  return node.get<StaffingPlanView[]>("/api/v1/recruitment/plans", { signal })
}

export function defineStaffingPlan(body: {
  unit_id: string
  position: string
  span: string
  headcount: number
  cost_minor: number
  reason: string
}): Promise<StaffingPlanView[]> {
  return node.post<StaffingPlanView[]>("/api/v1/recruitment/plans", body)
}

export function listApplicants(
  query: { stage?: string; proposal_id?: string } = {},
  signal?: AbortSignal
): Promise<ApplicantView[]> {
  const params = new URLSearchParams()
  if (query.stage) params.set("stage", query.stage)
  if (query.proposal_id) params.set("proposal_id", query.proposal_id)
  const suffix = params.size > 0 ? `?${params.toString()}` : ""
  return node.get<ApplicantView[]>(`/api/v1/recruitment/applicants${suffix}`, {
    signal,
  })
}

export function fileApplicant(
  proposalId: string,
  body: {
    name: string
    phone?: string
    source: string
    referrer_employee_id?: string
  }
): Promise<ApplicantView> {
  return node.post<ApplicantView>(
    `/api/v1/recruitment/proposals/${enc(proposalId)}/applicants`,
    body
  )
}

export function moveApplicantStage(
  applicantId: string,
  body: { stage: string; note?: string; reason: string }
): Promise<ApplicantView> {
  return node.post<ApplicantView>(
    `/api/v1/recruitment/applicants/${enc(applicantId)}/stage`,
    body
  )
}

export function scheduleInterview(
  applicantId: string,
  body: {
    scheduled_at: string
    interviewer_employee_id: string
    reason: string
  }
): Promise<InterviewView> {
  return node.post<InterviewView>(
    `/api/v1/recruitment/applicants/${enc(applicantId)}/interviews`,
    body
  )
}

export function recordInterview(
  interviewId: string,
  body: {
    result: "PASS" | "FAIL"
    ratings: Record<string, number>
    note?: string
    reason: string
  }
): Promise<InterviewView> {
  return node.post<InterviewView>(
    `/api/v1/recruitment/interviews/${enc(interviewId)}/result`,
    body
  )
}

export function makeOffer(
  applicantId: string,
  body: {
    base_minor: number
    grade: string
    starts_on: string
    term: string
    reason: string
  }
): Promise<OfferView> {
  return node.post<OfferView>(
    `/api/v1/recruitment/applicants/${enc(applicantId)}/offer`,
    body
  )
}

export function listOffers(signal?: AbortSignal): Promise<OfferView[]> {
  return node.get<OfferView[]>("/api/v1/recruitment/offers", { signal })
}

export function decideOffer(
  offerId: string,
  body: { accepted: boolean; reason: string }
): Promise<OfferView> {
  return node.post<OfferView>(
    `/api/v1/recruitment/offers/${enc(offerId)}/decision`,
    body
  )
}

export function hireOffer(offerId: string, reason: string): Promise<OfferView> {
  return node.post<OfferView>(
    `/api/v1/recruitment/offers/${enc(offerId)}/hire`,
    { reason }
  )
}

// ── performance ─────────────────────────────────────────────────────────────

export function listPerformanceTemplates(
  signal?: AbortSignal
): Promise<PerformanceTemplateView[]> {
  return node.get<PerformanceTemplateView[]>("/api/v1/performance/templates", {
    signal,
  })
}

export function listPerformanceScores(
  query: { period?: string; unit_id?: string } = {},
  signal?: AbortSignal
): Promise<PerformanceScoreView[]> {
  const params = new URLSearchParams()
  if (query.period) params.set("period", query.period)
  if (query.unit_id) params.set("unit_id", query.unit_id)
  const suffix = params.size > 0 ? `?${params.toString()}` : ""
  return node.get<PerformanceScoreView[]>(
    `/api/v1/performance/scores${suffix}`,
    {
      signal,
    }
  )
}

export function recordPerformanceScore(
  employeeId: string,
  period: string,
  body: {
    kpi_pct: number
    manager_score: number
    note?: string
    reason: string
  }
): Promise<PerformanceScoreView> {
  return node.put<PerformanceScoreView>(
    `/api/v1/employees/${enc(employeeId)}/performance/${period}`,
    body
  )
}

// ── training ────────────────────────────────────────────────────────────────

export function listTrainingPrograms(
  signal?: AbortSignal
): Promise<TrainingProgramView[]> {
  return node.get<TrainingProgramView[]>("/api/v1/training-programs", {
    signal,
  })
}

export function defineTrainingProgram(body: {
  title: string
  on_date: string
  place: string
  cost_minor: number
  reason: string
}): Promise<TrainingProgramView[]> {
  return node.post<TrainingProgramView[]>("/api/v1/training-programs", body)
}

export function nominateForTraining(
  programId: string,
  body: { employee_id: string; reason: string }
): Promise<TrainingProgramView> {
  return node.post<TrainingProgramView>(
    `/api/v1/training-programs/${enc(programId)}/participants`,
    body
  )
}

// ── benefits ────────────────────────────────────────────────────────────────

// ── the rule numbers and the org masters ────────────────────────────────────

export function readRules(
  query: { group?: string } = {},
  signal?: AbortSignal
): Promise<RuleView[]> {
  const suffix = query.group ? `?group=${enc(query.group)}` : ""
  return node.get<RuleView[]>(`/api/v1/people-policy${suffix}`, { signal })
}

export function setRule(
  key: string,
  body: { value: number; reason: string }
): Promise<RuleView[]> {
  return node.put<RuleView[]>(`/api/v1/people-policy/${enc(key)}`, body)
}

export function listGrades(signal?: AbortSignal): Promise<GradeView[]> {
  return node.get<GradeView[]>("/api/v1/org/grades", { signal })
}

export function listPositions(signal?: AbortSignal): Promise<PositionView[]> {
  return node.get<PositionView[]>("/api/v1/org/positions", { signal })
}

export function listStructures(signal?: AbortSignal): Promise<StructureView[]> {
  return node.get<StructureView[]>("/api/v1/org/structures", { signal })
}

// ── the clock's own HR work ─────────────────────────────────────────────────
//
// What the scheduler ran, and a door to run the pass now. The run ledger is
// read as evidence: a monthly accrual that did not run leaves balances empty,
// and the screen beside it is the only place that says so.

export interface SchedulerRunRow {
  readonly job: string
  readonly run_key: string
  readonly outcome: "RAN" | "FAILED" | "SKIPPED"
  readonly detail: unknown
  readonly started_at: string
  readonly finished_at: string | null
}

export interface SchedulerJobResult {
  readonly job: string
  readonly status: "RAN" | "FAILED" | "SKIPPED"
  readonly detail: unknown
}

export const schedulerKeys = {
  runs: () => ["people", "scheduler", "runs"] as const,
}

/// One page of the run ledger, newest first.
export interface SchedulerRunPage {
  readonly rows: SchedulerRunRow[]
  readonly next_cursor: string | null
}

/// The run ledger a page at a time. It only grows — every tick claims periods
/// — so a fixed first hundred would one day have been all anybody could see.
export function schedulerRunsPage(
  cursor: string | undefined,
  signal?: AbortSignal
): Promise<SchedulerRunPage> {
  const params = new URLSearchParams({ limit: "100" })
  if (cursor) params.set("cursor", cursor)
  return node.get<SchedulerRunPage>(
    `/api/v1/hr-scheduler/runs?${params.toString()}`,
    { signal }
  )
}

/// Run the pass by hand. `asOf` is a backfill or a test; absent means today
/// where the shops are. A reason is required because the run ledger has
/// nowhere else to put it.
export function runSchedulerNow(ask: {
  readonly asOf?: string
  readonly reason: string
}): Promise<SchedulerJobResult[]> {
  return node.post<SchedulerJobResult[]>("/api/v1/hr-scheduler/run-now", {
    as_of: ask.asOf !== undefined && ask.asOf !== "" ? ask.asOf : null,
    reason: ask.reason,
  })
}

/// The bonus tier a KPI figure earns under today's rule numbers. Derived
/// here the way the server derives it on read, so a screen can show the tier
/// before anybody has recorded a score.
export function bonusTierFor(
  rules: RuleView[] | undefined,
  kpi: number
): number | null {
  if (!rules) return null
  const num = (key: string) =>
    Number(rules.find((r) => r.key === key)?.value ?? NaN)
  const t2 = num("pay.bonus_tier2_min_kpi")
  const t1 = num("pay.bonus_tier1_min_kpi")
  if (Number.isNaN(t2) || Number.isNaN(t1)) return null
  if (kpi >= t2) return num("pay.bonus_tier2_rate")
  if (kpi >= t1) return num("pay.bonus_tier1_rate")
  return 0
}

// ── the organisation (0805) ─────────────────────────────────────────────────

export const orgKeys = {
  company: () => ["people", "org", "company"] as const,
  departments: () => ["people", "org", "departments"] as const,
  levels: () => ["people", "org", "levels"] as const,
  grades: () => ["people", "org", "grades"] as const,
  chart: () => ["people", "org", "chart"] as const,
  businessUnits: () => ["people", "org", "business-units"] as const,
  group: () => ["people", "org", "group"] as const,
  checklistTemplates: () => ["people", "org", "checklist-templates"] as const,
  checklist: (employeeId: string) =>
    ["people", "org", "checklist", employeeId] as const,
  placements: (employeeId: string) =>
    ["people", "org", "placements", employeeId] as const,
}

export function orgCompany(signal?: AbortSignal): Promise<CompanyView> {
  return node.get<CompanyView>("/api/v1/org/company", { signal })
}

export function registerBpjs(body: RegisterBpjsBody): Promise<CompanyView> {
  return node.post<CompanyView>("/api/v1/org/bpjs-registration", body)
}

export function departments(signal?: AbortSignal): Promise<DepartmentView[]> {
  return node.get<DepartmentView[]>("/api/v1/org/departments", { signal })
}

export function saveDepartment(
  body: SaveDepartmentBody
): Promise<DepartmentView[]> {
  return node.post<DepartmentView[]>("/api/v1/org/departments", body)
}

export function retireDepartment(
  code: string,
  reason: string
): Promise<DepartmentView[]> {
  return node.post<DepartmentView[]>(
    `/api/v1/org/departments/${encodeURIComponent(code)}/retirement`,
    { reason }
  )
}

export function jobLevels(signal?: AbortSignal): Promise<JobLevelView[]> {
  return node.get<JobLevelView[]>("/api/v1/org/levels", { signal })
}

export function saveJobLevel(body: SaveJobLevelBody): Promise<JobLevelView[]> {
  return node.post<JobLevelView[]>("/api/v1/org/levels", body)
}

export function retireJobLevel(
  code: string,
  reason: string
): Promise<JobLevelView[]> {
  return node.post<JobLevelView[]>(
    `/api/v1/org/levels/${encodeURIComponent(code)}/retirement`,
    { reason }
  )
}

export function jobGrades(signal?: AbortSignal): Promise<JobGradeView[]> {
  return node.get<JobGradeView[]>("/api/v1/org/job-grades", { signal })
}

export function saveJobGrade(body: SaveJobGradeBody): Promise<JobGradeView[]> {
  return node.post<JobGradeView[]>("/api/v1/org/job-grades", body)
}

export function retireJobGrade(
  code: string,
  reason: string
): Promise<JobGradeView[]> {
  return node.post<JobGradeView[]>(
    `/api/v1/org/job-grades/${encodeURIComponent(code)}/retirement`,
    { reason }
  )
}

export function orgChart(signal?: AbortSignal): Promise<OrgChartNode[]> {
  return node.get<OrgChartNode[]>("/api/v1/org/chart", { signal })
}

export function placements(
  employeeId: string,
  signal?: AbortSignal
): Promise<PlacementView[]> {
  return node.get<PlacementView[]>(
    `/api/v1/employees/${encodeURIComponent(employeeId)}/placements`,
    { signal }
  )
}

export function placeEmployee(
  employeeId: string,
  body: PlaceBody
): Promise<PlacementView[]> {
  return node.post<PlacementView[]>(
    `/api/v1/employees/${encodeURIComponent(employeeId)}/placements`,
    body
  )
}

export function businessUnits(
  signal?: AbortSignal
): Promise<BusinessUnitView[]> {
  return node.get<BusinessUnitView[]>("/api/v1/org/business-units", { signal })
}

export function saveBusinessUnit(
  body: SaveBusinessUnitBody
): Promise<BusinessUnitView[]> {
  return node.post<BusinessUnitView[]>("/api/v1/org/business-units", body)
}

export function groupEntities(
  signal?: AbortSignal
): Promise<GroupEntityView[]> {
  return node.get<GroupEntityView[]>("/api/v1/org/group", { signal })
}

export function saveGroupEntity(
  body: SaveGroupEntityBody
): Promise<GroupEntityView[]> {
  return node.post<GroupEntityView[]>("/api/v1/org/group", body)
}

export function removeGroupEntity(code: string): Promise<GroupEntityView[]> {
  return node.delete<GroupEntityView[]>(
    `/api/v1/org/group/${encodeURIComponent(code)}`
  )
}

// ── checklists (0806) ───────────────────────────────────────────────────────

export function checklistTemplates(
  signal?: AbortSignal
): Promise<ChecklistTemplateView[]> {
  return node.get<ChecklistTemplateView[]>("/api/v1/lifecycle/templates", {
    signal,
  })
}

export function saveChecklistTemplate(
  body: SaveChecklistTemplateBody
): Promise<ChecklistTemplateView[]> {
  return node.post<ChecklistTemplateView[]>("/api/v1/lifecycle/templates", body)
}

export function retireChecklistTemplate(
  id: string,
  reason: string
): Promise<ChecklistTemplateView[]> {
  return node.post<ChecklistTemplateView[]>(
    `/api/v1/lifecycle/templates/${encodeURIComponent(id)}/retirement`,
    { reason }
  )
}

/// One person's checklist tasks, both kinds.
export function employeeChecklist(
  employeeId: string,
  signal?: AbortSignal
): Promise<LifecycleTaskView[]> {
  return node.get<LifecycleTaskView[]>(
    `/api/v1/employees/${encodeURIComponent(employeeId)}/lifecycle-tasks`,
    { signal }
  )
}

/// Open a checklist for somebody — onboarding on a hire made before the
/// checklist existed, separation when they leave.
export function openChecklist(
  employeeId: string,
  kind: "ONBOARDING" | "SEPARATION"
): Promise<LifecycleTaskView[]> {
  return node.post<LifecycleTaskView[]>(
    `/api/v1/employees/${encodeURIComponent(employeeId)}/lifecycle-tasks`,
    { kind }
  )
}

// ── attendance settings (0807) ──────────────────────────────────────────────

export const attendanceSettingKeys = {
  mobile: () => ["people", "attendance", "mobile-setting"] as const,
  geofences: () => ["people", "attendance", "geofences"] as const,
  absenceRules: () => ["people", "payroll", "absence-rules"] as const,
  overtimeTier: () => ["people", "payroll", "overtime-tier"] as const,
}

export function mobileSetting(
  signal?: AbortSignal
): Promise<MobileAttendanceSetting> {
  return node.get<MobileAttendanceSetting>(
    "/api/v1/attendance/mobile-setting",
    {
      signal,
    }
  )
}

export function saveMobileSetting(
  body: SaveMobileSettingBody
): Promise<MobileAttendanceSetting> {
  return node.post<MobileAttendanceSetting>(
    "/api/v1/attendance/mobile-setting",
    body
  )
}

export function geofences(signal?: AbortSignal): Promise<GeofenceView[]> {
  return node.get<GeofenceView[]>("/api/v1/attendance/geofences", { signal })
}

export function setGeofence(
  unitId: string,
  body: SetGeofenceBody
): Promise<GeofenceView[]> {
  return node.post<GeofenceView[]>(
    `/api/v1/attendance/geofences/${encodeURIComponent(unitId)}`,
    body
  )
}

export function removeGeofence(unitId: string): Promise<GeofenceView[]> {
  return node.delete<GeofenceView[]>(
    `/api/v1/attendance/geofences/${encodeURIComponent(unitId)}`
  )
}

export function absenceRules(signal?: AbortSignal): Promise<AbsenceRuleView[]> {
  return node.get<AbsenceRuleView[]>("/api/v1/payroll/absence-rules", {
    signal,
  })
}

export function stateAbsenceRule(
  body: StateAbsenceRuleBody
): Promise<AbsenceRuleView[]> {
  return node.post<AbsenceRuleView[]>("/api/v1/payroll/absence-rules", body)
}

export function overtimeTier(signal?: AbortSignal): Promise<OvertimeTierView> {
  return node.get<OvertimeTierView>("/api/v1/payroll/overtime-tier", { signal })
}

export function setOvertimeTier(body: {
  rest_day_first_tier_minutes: number
  reason: string
}): Promise<OvertimeTierView> {
  return node.post<OvertimeTierView>("/api/v1/payroll/overtime-tier", body)
}

// ── leave beyond requests (0809) ────────────────────────────────────────────

export const leaveExtraKeys = {
  blackouts: () => ["people", "leave", "blackouts"] as const,
  encashments: (employeeId: string) =>
    ["people", "leave", "encashments", employeeId] as const,
  holidayWork: (from: string, to: string) =>
    ["people", "leave", "holiday-work", from, to] as const,
  calendar: (from: string, to: string) =>
    ["people", "leave", "calendar", from, to] as const,
}

export function leaveBlackouts(
  signal?: AbortSignal
): Promise<LeaveBlackoutView[]> {
  return node.get<LeaveBlackoutView[]>("/api/v1/leave-blackouts", { signal })
}

export function blockLeave(body: {
  from_date: string
  to_date: string
  unit_id: string | null
  reason: string
}): Promise<LeaveBlackoutView[]> {
  return node.post<LeaveBlackoutView[]>("/api/v1/leave-blackouts", body)
}

export function liftLeaveBlock(
  id: string,
  reason: string
): Promise<LeaveBlackoutView[]> {
  return node.post<LeaveBlackoutView[]>(
    `/api/v1/leave-blackouts/${encodeURIComponent(id)}/lift`,
    { reason }
  )
}

export function leaveEncashments(
  employeeId: string,
  signal?: AbortSignal
): Promise<LeaveEncashmentView[]> {
  return node.get<LeaveEncashmentView[]>(
    `/api/v1/employees/${encodeURIComponent(employeeId)}/leave-encashments`,
    { signal }
  )
}

export function encashLeave(
  employeeId: string,
  body: {
    leave_type: string
    days: number
    period: string
    divisor_days: number | null
    reason: string
  }
): Promise<LeaveEncashmentView[]> {
  return node.post<LeaveEncashmentView[]>(
    `/api/v1/employees/${encodeURIComponent(employeeId)}/leave-encashments`,
    body
  )
}

export function holidayWork(
  from: string,
  to: string,
  signal?: AbortSignal
): Promise<HolidayWorkView[]> {
  return node.get<HolidayWorkView[]>(
    `/api/v1/holiday-work?from=${from}&to=${to}`,
    { signal }
  )
}

export function recordHolidayWork(
  employeeId: string,
  body: { on_date: string; leave_type: string; days: number; reason: string }
): Promise<HolidayWorkView[]> {
  return node.post<HolidayWorkView[]>(
    `/api/v1/employees/${encodeURIComponent(employeeId)}/holiday-work`,
    body
  )
}

export function teamCalendar(
  from: string,
  to: string,
  signal?: AbortSignal
): Promise<TeamCalendarView> {
  return node.get<TeamCalendarView>(
    `/api/v1/team-calendar?from=${from}&to=${to}`,
    { signal }
  )
}

// ── claim allowances (0810) ─────────────────────────────────────────────────

export const claimBenefitKeys = {
  rules: () => ["people", "claims", "benefits"] as const,
  balances: (employeeId: string, year: number) =>
    ["people", "claims", "balances", employeeId, year] as const,
}

export function claimBenefits(
  signal?: AbortSignal
): Promise<ClaimBenefitView[]> {
  return node.get<ClaimBenefitView[]>("/api/v1/claim-benefits", { signal })
}

export function stateClaimBenefit(body: {
  type_code: string
  effective_from: string
  yearly_limit_minor: number | null
  reason: string
}): Promise<ClaimBenefitView[]> {
  return node.post<ClaimBenefitView[]>("/api/v1/claim-benefits", body)
}

export function claimBalances(
  employeeId: string,
  year: number,
  signal?: AbortSignal
): Promise<ClaimBalanceRow[]> {
  return node.get<ClaimBalanceRow[]>(
    `/api/v1/employees/${encodeURIComponent(employeeId)}/claim-balances?year=${year}`,
    { signal }
  )
}

export function overrideClaimBenefit(
  employeeId: string,
  body: { type_code: string; year: number; limit_minor: number; reason: string }
): Promise<ClaimBalanceRow[]> {
  return node.post<ClaimBalanceRow[]>(
    `/api/v1/employees/${encodeURIComponent(employeeId)}/claim-balances`,
    body
  )
}

// ── warning letters (0811) ──────────────────────────────────────────────────

export const letterKeys = {
  of: (employeeId: string) =>
    ["people", "warning-letters", employeeId] as const,
  active: () => ["people", "warning-letters", "active"] as const,
}

export function warningLetters(
  employeeId: string,
  signal?: AbortSignal
): Promise<WarningLetterView[]> {
  return node.get<WarningLetterView[]>(
    `/api/v1/employees/${encodeURIComponent(employeeId)}/warning-letters`,
    { signal }
  )
}

export function activeWarningLetters(
  signal?: AbortSignal
): Promise<WarningLetterView[]> {
  return node.get<WarningLetterView[]>("/api/v1/warning-letters", { signal })
}

export function issueWarningLetter(
  employeeId: string,
  body: {
    level: string
    issued_on: string
    valid_months: number | null
    violation: string
    reason: string
  }
): Promise<WarningLetterView[]> {
  return node.post<WarningLetterView[]>(
    `/api/v1/employees/${encodeURIComponent(employeeId)}/warning-letters`,
    body
  )
}

export function revokeWarningLetter(
  id: string,
  reason: string
): Promise<WarningLetterView[]> {
  return node.post<WarningLetterView[]>(
    `/api/v1/warning-letters/${encodeURIComponent(id)}/revocation`,
    { reason }
  )
}

// ── delegation and the employee app (0812, 0813) ────────────────────────────

export const delegationKeys = {
  all: () => ["people", "delegations"] as const,
  ess: () => ["people", "ess-modules"] as const,
}

export function delegations(signal?: AbortSignal): Promise<DelegationView[]> {
  return node.get<DelegationView[]>("/api/v1/approval-delegations", { signal })
}

export function delegate(body: {
  delegator: string | null
  delegate: string
  from_date: string
  to_date: string
  reason: string
}): Promise<DelegationView[]> {
  return node.post<DelegationView[]>("/api/v1/approval-delegations", body)
}

export function revokeDelegation(id: string): Promise<DelegationView[]> {
  return node.post<DelegationView[]>(
    `/api/v1/approval-delegations/${encodeURIComponent(id)}/revocation`,
    {}
  )
}

export function essModules(signal?: AbortSignal): Promise<EssModulesView> {
  return node.get<EssModulesView>("/api/v1/ess-modules", { signal })
}

export function setEssModules(body: {
  modules: string[]
  reason: string
}): Promise<EssModulesView> {
  return node.post<EssModulesView>("/api/v1/ess-modules", body)
}

// ── query options ──────────────────────────────────────────────────────────

/// The reads a People screen starts on the server, as options: the screen
/// reads them by suspending (`awaiting`, `screens/people/suspended.tsx`) and
/// the department's prefetcher (`screens/people/prefetch.ts`) warms the SAME
/// options, so the first HTML carries the answer and the browser finds it warm.

export const companyQuery = () =>
  queryOptions({
    queryKey: orgKeys.company(),
    queryFn: ({ signal }) => orgCompany(signal),
  })

export const departmentsQuery = () =>
  queryOptions({
    queryKey: orgKeys.departments(),
    queryFn: ({ signal }) => departments(signal),
  })

export const groupQuery = () =>
  queryOptions({
    queryKey: orgKeys.group(),
    queryFn: ({ signal }) => groupEntities(signal),
  })

export const businessUnitsQuery = () =>
  queryOptions({
    queryKey: orgKeys.businessUnits(),
    queryFn: ({ signal }) => businessUnits(signal),
  })

export const checklistTemplatesQuery = () =>
  queryOptions({
    queryKey: orgKeys.checklistTemplates(),
    queryFn: ({ signal }) => checklistTemplates(signal),
  })

export const payslipTemplateQuery = () =>
  queryOptions({
    queryKey: payKeys.payslipTemplate(),
    queryFn: ({ signal }) => payslipTemplate(signal),
  })

export const jobLevelsQuery = () =>
  queryOptions({
    queryKey: orgKeys.levels(),
    queryFn: ({ signal }) => jobLevels(signal),
  })

export const jobGradesQuery = () =>
  queryOptions({
    queryKey: orgKeys.grades(),
    queryFn: ({ signal }) => jobGrades(signal),
  })

export const orgChartQuery = () =>
  queryOptions({
    queryKey: orgKeys.chart(),
    queryFn: ({ signal }) => orgChart(signal),
  })

export const essModulesQuery = () =>
  queryOptions({
    queryKey: delegationKeys.ess(),
    queryFn: ({ signal }) => essModules(signal),
  })

export const delegationsQuery = () =>
  queryOptions({
    queryKey: delegationKeys.all(),
    queryFn: ({ signal }) => delegations(signal),
  })

export const salaryStructuresQuery = () =>
  queryOptions({
    queryKey: payKeys.structures(),
    queryFn: ({ signal }) => salaryStructures(signal),
  })

export const payComponentsQuery = () =>
  queryOptions({
    queryKey: payKeys.components(),
    queryFn: ({ signal }) => payComponents(signal),
  })

export const absenceRulesQuery = () =>
  queryOptions({
    queryKey: attendanceSettingKeys.absenceRules(),
    queryFn: ({ signal }) => absenceRules(signal),
  })

export const payrollSchedulesQuery = () =>
  queryOptions({
    queryKey: payKeys.schedules(),
    queryFn: ({ signal }) => payrollSchedules(signal),
  })

export const shiftsQuery = () =>
  queryOptions({
    queryKey: rosterKeys.shifts(),
    queryFn: ({ signal }) => listShifts(signal),
  })

export const claimTypesQuery = () =>
  queryOptions({
    queryKey: claimsKeys.types(),
    queryFn: ({ signal }) => listClaimTypes(signal),
  })

export const statutoryRatesQuery = () =>
  queryOptions({
    queryKey: payKeys.statutoryRates(),
    queryFn: ({ signal }) => statutoryRates(signal),
  })

export const leaveTypesQuery = () =>
  queryOptions({
    queryKey: leaveKeys.types(),
    queryFn: ({ signal }) => listLeaveTypes(signal),
  })

export const overtimePolicyQuery = () =>
  queryOptions({
    queryKey: overtimeKeys.policy(),
    queryFn: ({ signal }) => readOvertimePolicy(signal),
  })

export const overtimeTierQuery = () =>
  queryOptions({
    queryKey: attendanceSettingKeys.overtimeTier(),
    queryFn: ({ signal }) => overtimeTier(signal),
  })

export const mobileSettingQuery = () =>
  queryOptions({
    queryKey: attendanceSettingKeys.mobile(),
    queryFn: ({ signal }) => mobileSetting(signal),
  })

export const geofencesQuery = () =>
  queryOptions({
    queryKey: attendanceSettingKeys.geofences(),
    queryFn: ({ signal }) => geofences(signal),
  })

export const claimBenefitRulesQuery = () =>
  queryOptions({
    queryKey: claimBenefitKeys.rules(),
    queryFn: ({ signal }) => claimBenefits(signal),
  })

export const allLoansQuery = () =>
  queryOptions({
    queryKey: payKeys.allLoans(),
    queryFn: ({ signal }) => allLoans(signal),
  })

export const claimQueueQuery = () =>
  queryOptions({
    queryKey: claimsKeys.queue(),
    queryFn: ({ signal }) => listClaims({ state: "SUBMITTED" }, signal),
  })

export const claimListQuery = () =>
  queryOptions({
    queryKey: claimsKeys.list(),
    queryFn: ({ signal }) => listClaims({}, signal),
  })
