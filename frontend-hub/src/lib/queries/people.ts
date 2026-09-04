import { useQuery } from "@tanstack/react-query"

import { node } from "@/lib/api"
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
  PayRecordView,
  PayrollIdentityView,
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
/// `/profile` is who somebody is **at work**: number, job, place, joining date.
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

export interface EmployeeFilters {
  readonly status?: string
  readonly placeId?: string
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
      filters.status ?? null,
      filters.placeId ?? null,
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
}

// ── reads ──────────────────────────────────────────────────────────────────

/// The workforce list.
///
/// Deliberately not a list of employee records: it is read far more often than
/// any one person is opened, and it carries a name and nothing else from the
/// profile — see `domain::employment::audit`.
export function listEmployees(
  filters: EmployeeFilters = {},
  signal?: AbortSignal
): Promise<EmployeeSummary[]> {
  const params = new URLSearchParams()
  if (filters.status) params.set("status", filters.status)
  if (filters.placeId) params.set("place_id", filters.placeId)
  if (filters.limit) params.set("limit", String(filters.limit))
  const suffix = params.size > 0 ? `?${params.toString()}` : ""
  return node.get<EmployeeSummary[]>(`/api/v1/employees${suffix}`, { signal })
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

/// Which places this caller may act in, and where they are posted.
///
/// Answered by the server rather than derived here from `place_id`. The rule —
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

/// Post somebody to a place, for a span.
///
/// The overlap rule fires on the whole timeline rather than on the row being
/// written, so a posting that collides with an existing one comes back as a
/// conflict naming both — which is why the screen shows the server's sentence
/// rather than checking for overlaps itself.
export function assignToPlace(
  employeeId: string,
  placeId: string,
  validFrom: string,
  reason: string,
  validTo?: string
): Promise<EmployeeView> {
  return node.post<EmployeeView>(
    `/api/v1/employees/${encodeURIComponent(employeeId)}/assignments`,
    {
      place_id: placeId,
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
/// an authorising officer behind every change, so a place stamped into the
/// session would be wrong from the transfer until the next sign-in.
export function useReach() {
  return useQuery({
    queryKey: peopleKeys.reach(),
    queryFn: ({ signal }) => readReach(signal),
    staleTime: 5 * 60_000,
  })
}

/// Whether this caller is the *employer* — head office — or one place's
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

/// The place a bounded caller is posted to, for a screen that has to say whose
/// list this is. `null` for head office, which is not standing in one shop.
export function boundedTo(reach: ReachView | undefined): string | null {
  if (reach === undefined || reach.scope !== "ONE_PLACE") return null
  return reach.place_name ?? reach.place_id
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
    readonly edgePassword: string
  }
  readonly reason: string
}

export const accountKeys = {
  /// Which tills a person's place is served by. Read only by the form that
  /// issues a login, so it is keyed by the person rather than by the place.
  targets: (employeeId: string) =>
    ["people", "accounts", "targets", employeeId] as const,
}
/// Which nodes this person's place is served by, and whether they already have
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
            edge_password: account.edge.edgePassword,
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
  /// Everything waiting on a decision. No place in the key: the server bounds
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

/// What a leave state means in a sentence.
///
/// `PENDING` is spelled as what it is waiting for rather than as what it is:
/// the only thing anybody reading this queue wants to know is whether it is
/// still on somebody's desk.
export function leaveStateLabel(state: string): string {
  switch (state) {
    case "PENDING":
      return "Waiting on a decision"
    case "APPROVED":
      return "Approved"
    case "REJECTED":
      return "Refused"
    case "WITHDRAWN":
      return "Taken back"
    default:
      return state
  }
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
  /// Empty means nationwide. Required for a regional day and refused for the
  /// other two — the server says which, and names the date.
  readonly places: readonly string[]
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
      places: holiday.places,
    })),
    reason,
  })
}

/// Add or withdraw one day.
///
/// The same grant as publishing, deliberately: adding a *cuti bersama* in March
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
        places: holiday.places,
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
  /// What is waiting on an answer. No place in the key: the server bounds it by
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
      return "Refused"
    case "WITHDRAWN":
      return "Taken back"
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
  shifts: () => ["people", "shifts"] as const,
  place: (place: string, from: string, to: string) =>
    ["people", "roster", place, from, to] as const,
  of: (employeeId: string, from: string, to: string) =>
    ["people", "roster", "employee", employeeId, from, to] as const,
  periods: (place: string) => ["people", "periods", place] as const,
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

export function placeRoster(
  place: string,
  from: string,
  to: string,
  signal?: AbortSignal
): Promise<RosterDayView[]> {
  const params = new URLSearchParams({ place, from, to })
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
  place: string,
  signal?: AbortSignal
): Promise<PeriodView[]> {
  return node.get<PeriodView[]>(
    `/api/v1/attendance-periods?place=${encodeURIComponent(place)}`,
    { signal }
  )
}

export function closePeriod(
  place: string,
  period: string,
  reason: string
): Promise<PeriodView> {
  return node.post<PeriodView>(
    `/api/v1/attendance-periods/${encodeURIComponent(place)}/${encodeURIComponent(period)}/closure`,
    { reason }
  )
}

/// Head office's. A place that could reopen its own sign-off has not signed
/// anything off.
export function reopenPeriod(
  place: string,
  period: string,
  reason: string
): Promise<PeriodView> {
  return node.post<PeriodView>(
    `/api/v1/attendance-periods/${encodeURIComponent(place)}/${encodeURIComponent(period)}/reopening`,
    { reason }
  )
}

// ── pay and payroll ────────────────────────────────────────────────────────

/// Head office only, all of it. A place manager's whole contribution to payroll
/// is closing their attendance period.
///
/// Nothing here computes tax or BPJS, and no field carries one: a slip is the
/// agreement in force plus the facts recorded, and the screens say so.

export const payKeys = {
  runs: () => ["people", "payroll", "runs"] as const,
  slips: (runId: string) => ["people", "payroll", runId, "slips"] as const,
  reconciliation: (runId: string) =>
    ["people", "payroll", runId, "reconciliation"] as const,
  pay: (employeeId: string) => ["people", "pay", employeeId] as const,
  identity: (employeeId: string) =>
    ["people", "pay", employeeId, "identity"] as const,
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

export function listRuns(signal?: AbortSignal): Promise<PayrollRunView[]> {
  return node.get<PayrollRunView[]>("/api/v1/payroll/runs", { signal })
}

export function openRun(
  placeId: string,
  period: string,
  reason: string
): Promise<PayrollRunView> {
  return node.post<PayrollRunView>("/api/v1/payroll/runs", {
    place_id: placeId,
    period,
    reason,
  })
}

/// One route per step, not one with a verb. They are four different
/// authorities, and the two-person rule compares the actors on two of them.
export function stepRun(
  runId: string,
  step: "verify" | "approve" | "seal" | "reopen",
  reason: string
): Promise<PayrollRunView> {
  return node.post<PayrollRunView>(
    `/api/v1/payroll/runs/${encodeURIComponent(runId)}/${step}`,
    { reason }
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
export function runStateLabel(state: string): string {
  switch (state) {
    case "DRAFT":
      return "Waiting to be checked"
    case "VERIFIED":
      return "Checked, waiting on a second signature"
    case "APPROVED":
      return "Approved"
    case "SEALED":
      return "Sealed"
    default:
      return state
  }
}
