import { node } from "@/lib/api"
import type {
  ContractsView,
  EmployeeSummary,
  EmployeeView,
  ExpiringContract,
  PersonalDataView,
  PolicyScheduleView,
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
export function linkAccount(
  employeeId: string,
  username: string
): Promise<EmployeeView> {
  return node.post<EmployeeView>(
    `/api/v1/employees/${encodeURIComponent(employeeId)}/account`,
    { username }
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
