import { node } from "@/lib/api"
import type {
  ContractsView,
  EmployeeSummary,
  EmployeeView,
  EmploymentProfileView,
  ExpiringContract,
  PersonalDataView,
} from "@itulah/contract"

/// Who works here, under what contract, and where they are posted.
///
/// Every shape below is generated from the Rust struct the server serialises —
/// unlike `commercial.ts` and `purchase-orders.ts`, which transcribe `json!()`
/// literals by hand. Nothing here needs to be kept in step by remembering to.
///
/// # Two routes that both sound like a profile
///
/// `/profile` is who somebody is **at work**: number, job, place, joining date.
/// `/personal-data` is NIK, address and date of birth. They are separate
/// because they are separate privileges — a supervisor reading a rota gets the
/// first and never the second — and mixing them is how a national identity
/// number ends up on a screen that only wanted a job title.
///
/// This file keeps them apart in the query cache too. One key would let a
/// screen that fetched personal data hand it to a screen that had only asked
/// who was on shift.

export const employeesKey = (
  filters: { status?: string; placeId?: string } = {},
) => ["employees", filters.status ?? null, filters.placeId ?? null] as const

export const employeeKey = (employeeId: string) =>
  ["employee", employeeId] as const

export const employmentProfileKey = (employeeId: string) =>
  ["employee", employeeId, "profile"] as const

export const personalDataKey = (employeeId: string) =>
  ["employee", employeeId, "personal-data"] as const

export const contractsKey = (employeeId: string) =>
  ["employee", employeeId, "contracts"] as const

export const expiringKey = (withinDays: number) =>
  ["employees", "expiring", withinDays] as const

/// The workforce list.
///
/// The route answers with an envelope now — the page, an opaque cursor, the
/// total of everything matched, and facet counts — in the shape
/// `GET /finance/money` established. This app reads the rows and nothing else:
/// it is the superseded console, and the paging belongs to the hub that
/// replaced it. Unwrapping here keeps its screens working without teaching them
/// a shape they will never use.
export function listEmployees(
  filters: { status?: string; placeId?: string; limit?: number } = {},
  signal?: AbortSignal,
): Promise<EmployeeSummary[]> {
  const query = new URLSearchParams()
  if (filters.status) query.set("status", filters.status)
  if (filters.placeId) query.set("unit_id", filters.placeId)
  if (filters.limit) query.set("limit", String(filters.limit))
  const suffix = query.size > 0 ? `?${query}` : ""
  return node
    .get<{ rows: EmployeeSummary[] }>(`/api/v1/employees${suffix}`, { signal })
    .then((page) => page.rows)
}

export function readEmployee(
  employeeId: string,
  signal?: AbortSignal,
): Promise<EmployeeView> {
  return node.get<EmployeeView>(
    `/api/v1/employees/${encodeURIComponent(employeeId)}`,
    { signal },
  )
}

export function readEmploymentProfile(
  employeeId: string,
  signal?: AbortSignal,
): Promise<EmploymentProfileView> {
  return node.get<EmploymentProfileView>(
    `/api/v1/employees/${encodeURIComponent(employeeId)}/profile`,
    { signal },
  )
}

/// NIK, address, date of birth. Admin-only on the server, and a 403 here is a
/// correct answer rather than a failure to handle.
export function readPersonalData(
  employeeId: string,
  signal?: AbortSignal,
): Promise<PersonalDataView> {
  return node.get<PersonalDataView>(
    `/api/v1/employees/${encodeURIComponent(employeeId)}/personal-data`,
    { signal },
  )
}

export function readContracts(
  employeeId: string,
  signal?: AbortSignal,
): Promise<ContractsView> {
  return node.get<ContractsView>(
    `/api/v1/employees/${encodeURIComponent(employeeId)}/contracts`,
    { signal },
  )
}

/// Which fixed terms are running out.
///
/// `within_days` rather than a pair of dates: the question people actually ask
/// is "what do I have to renew this month", and the server counts from its own
/// clock so two browsers in two timezones get the same list.
export function expiringContracts(
  withinDays = 30,
  signal?: AbortSignal,
): Promise<ExpiringContract[]> {
  return node.get<ExpiringContract[]>(
    `/api/v1/employees/contracts/expiring?within_days=${withinDays}`,
    { signal },
  )
}

// ── writes ───────────────────────────────────────────────────────────────
//
// Each carries a reason, and it is not decoration: the server refuses a
// decision without one, because a record that says what changed but not why is
// the half of an audit trail that never helps anybody.

export function registerEmployee(employeeCode: string): Promise<EmployeeView> {
  return node.post<EmployeeView>("/api/v1/employees", {
    employee_code: employeeCode,
  })
}

export type Transition = "HIRE" | "SUSPEND" | "REINSTATE" | "TERMINATE"

export function applyTransition(
  employeeId: string,
  transition: Transition,
  effectiveOn: string,
  reason: string,
): Promise<EmployeeView> {
  return node.post<EmployeeView>(
    `/api/v1/employees/${encodeURIComponent(employeeId)}/employment`,
    { transition, effective_on: effectiveOn, reason },
  )
}

export function assignToPlace(
  employeeId: string,
  placeId: string,
  validFrom: string,
  reason: string,
  validTo?: string,
): Promise<EmployeeView> {
  return node.post<EmployeeView>(
    `/api/v1/employees/${encodeURIComponent(employeeId)}/assignments`,
    { unit_id: placeId, valid_from: validFrom, valid_to: validTo ?? null, reason },
  )
}

export function addContract(
  employeeId: string,
  contract: {
    kind: "PKWT" | "PKWTT"
    startsOn: string
    endsOn?: string
    position: string
    grade: string
    reason: string
  },
): Promise<ContractsView> {
  return node.post<ContractsView>(
    `/api/v1/employees/${encodeURIComponent(employeeId)}/contracts`,
    {
      kind: contract.kind,
      starts_on: contract.startsOn,
      // Sent as null rather than omitted for a permanent contract: the server
      // refuses a PKWTT that carries an end date, and being explicit is what
      // makes that refusal about the request rather than about a missing field.
      ends_on: contract.endsOn ?? null,
      position: contract.position,
      grade: contract.grade,
      reason: contract.reason,
    },
  )
}

export function enrolPersonalData(
  employeeId: string,
  data: {
    fullName: string
    nik: string
    birthDate: string
    address: string
  },
): Promise<PersonalDataView> {
  return node.post<PersonalDataView>(
    `/api/v1/employees/${encodeURIComponent(employeeId)}/personal-data`,
    {
      full_name: data.fullName,
      nik: data.nik,
      birth_date: data.birthDate,
      address: data.address,
    },
  )
}

export function linkAccount(
  employeeId: string,
  username: string,
): Promise<EmployeeView> {
  return node.post<EmployeeView>(
    `/api/v1/employees/${encodeURIComponent(employeeId)}/account`,
    { username },
  )
}

// ── reading the vocabulary ───────────────────────────────────────────────

/// What a status means in a sentence, rather than in capitals.
///
/// `CANDIDATE` is the one worth spelling out: it is not "inactive" and not a
/// mistake — somebody has been taken on and has not started, which is a normal
/// state to be in for a fortnight and an alarming one to be in for a year.
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

/// How urgent an expiring term is, for the colour on the row.
///
/// Past its end date is its own case rather than "very soon": a contract that
/// ended while nobody was looking is not a deadline approaching, it is somebody
/// working without one.
export function expiryTone(daysRemaining: number): "gone" | "urgent" | "soon" {
  if (daysRemaining < 0) return "gone"
  if (daysRemaining <= 14) return "urgent"
  return "soon"
}
