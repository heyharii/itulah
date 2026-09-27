import { node } from "@/lib/api"
import { ApiError } from "@itulah/contract/client"
import type {
  AttendanceRangeView,
  ContractView,
  ContractsView,
  EmploymentProfileView,
  LeaveBalanceRow,
  LeaveRequestView,
  LeaveTypeView,
  OvertimeOrderView,
  PayrollIdentityView,
  PayrollSlipRow,
  PunchRecorded,
  LifecycleTaskView,
  Notification as ContractNotification,
  NotificationPage,
  RosterSwapView,
  ColleagueView,
  CalendarView,
  CalendarYearsView,
  CorrectionRow,
} from "@itulah/contract"
import type {
  AttendanceCorrection,
  HolidayCalendar,
  IsoDate,
  NewAttendanceCorrection,
  Notification,
} from "./types"

/// The employee's own record, asked of the server.
///
/// Every route this app calls exists on the cloud node now, so there is no
/// stand-in behind any of them: a 404 means the route moved or the record is
/// missing, and it surfaces as the failure it is. The fallback to example data
/// that carried these screens while the backend was being built is gone —
/// behind a live route it could only ever show somebody a plausible stranger's
/// leave balance and call it theirs.

/// `me` rather than an employee id in the path.
///
/// `me` is the caller's own record, resolved from the session by the server.
/// It saves this app a round trip just to learn its own id — and, more to the
/// point, self-service is the only access this surface has. Someone else's id
/// here is the server's to refuse.
const SELF = "me"

/// The route exists and the session is valid, but no employment record is
/// behind this login — HR's to fix, and said once by the shell rather than as
/// a refusal on every card.
export function isUnbound(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.status === 404 &&
    error.message.includes("no employment record is bound")
  )
}

export function profile(signal?: AbortSignal): Promise<EmploymentProfileView> {
  return node.get<EmploymentProfileView>(`/api/v1/employees/${SELF}/profile`, {
    signal,
  })
}

/// Newest first; the server answers oldest first inside an envelope.
export async function contracts(
  signal?: AbortSignal
): Promise<readonly ContractView[]> {
  const view = await node.get<ContractsView>(
    `/api/v1/employees/${SELF}/contracts`,
    { signal }
  )
  return [...view.contracts].reverse()
}

// ── pay: live, and honest about what it does not know ─────────
//
// `/pay` serves the effective-dated *agreement* — what somebody is on — and
// `/payslips` serves what they were actually paid in a month. This app asked
// for the second at the first one's path, which was the one wire mismatch the
// port recorded; the server kept the agreement at `/pay` and gave payslips
// their own route, and this is the change that resolves it.
//
// # There are no deductions here, and that is not a gap in this file
//
// The proposal's `PaySlip` carried `gross_idr`, `deductions_idr` and
// `net_idr`. The server computes none of them: PPh 21 and BPJS are statutory
// arithmetic whose brackets change by regulation, and a figure computed by
// this system is a figure somebody files with the tax office. A slip carries
// the agreement in force and the facts recorded — and the screens say so,
// rather than showing a net that is really a gross.

/// Who this person is to payroll. The account number is masked by the server;
/// there is no route that serves it whole.
export function payrollIdentity(
  signal?: AbortSignal
): Promise<PayrollIdentityView> {
  return node.get<PayrollIdentityView>(
    `/api/v1/employees/${SELF}/payroll-identity`,
    { signal }
  )
}

/// What this person was paid, per month.
///
/// Only runs somebody has signed for come back. A draft is a working figure,
/// and a payslip that changed after it was read would be worse than one that
/// arrived late.
export function paySlips(signal?: AbortSignal): Promise<PayrollSlipRow[]> {
  return node.get<PayrollSlipRow[]>(`/api/v1/employees/${SELF}/payslips`, {
    signal,
  })
}
// ── leave: live, against the real routes ──────────────────────
//
// The first family to land. There is no stand-in below and no fallback: the
// routes exist, so a failure here is a failure and says so, which is the whole
// point of the narrow fallback rule above.
//
// # The proposal fused two things the server keeps apart
//
// `types.ts` had one `LeaveType` carrying both the kind of leave and this
// person's balance in it, because the screens read them together. The server
// does not, and it is right not to: a kind is one row for the whole company
// and a balance is a fold over one person's ledger, and most kinds have no
// balance at all — sick leave deducts from nothing, so "days remaining" is a
// malformed question rather than one whose answer is zero.
//
// So there are two reads, joined in `queries.ts` where the screens want them
// joined, and the join is honest about the kinds that have no balance.

/// The kinds of leave that exist. One row for the company, no balances in it.
export function leaveTypes(signal?: AbortSignal): Promise<LeaveTypeView[]> {
  return node.get<LeaveTypeView[]>("/api/v1/leave-types", { signal })
}

/// What this person has left, per kind, and what they have pending.
///
/// Only balance-backed kinds come back. A kind that draws on nothing is absent
/// rather than reported as zero.
export function leaveBalances(
  signal?: AbortSignal
): Promise<LeaveBalanceRow[]> {
  return node.get<LeaveBalanceRow[]>(
    `/api/v1/employees/${SELF}/leave-balances`,
    { signal }
  )
}

export function leaveRequests(
  signal?: AbortSignal
): Promise<LeaveRequestView[]> {
  return node.get<LeaveRequestView[]>(
    `/api/v1/employees/${SELF}/leave-requests`,
    { signal }
  )
}

export interface NewLeaveRequest {
  readonly leave_type: string
  readonly from_date: string
  readonly to_date: string
  readonly reason: string
  readonly evidence?: string
}

/// File one.
///
/// The id is minted here rather than by the server, and that is deliberate:
/// this is a phone in an apron pocket on a bad connection, and a request whose
/// id the client chose can be retried without filing it twice. A second POST
/// with the same id is refused as a conflict rather than becoming a second
/// request for the same days.
export function applyForLeave(
  request: NewLeaveRequest
): Promise<LeaveRequestView> {
  return node.post<LeaveRequestView>(
    `/api/v1/employees/${SELF}/leave-requests`,
    {
      request_id: newRequestId(),
      leave_type: request.leave_type,
      from_date: request.from_date,
      to_date: request.to_date,
      evidence: request.evidence ?? null,
      reason: request.reason,
    }
  )
}

/// Take your own back.
///
/// `withdraw`, not `cancel`. The proposal used the second word; the server uses
/// the first, and the distinction it draws is worth keeping — only the person
/// who filed a request may withdraw it, and anybody else who wants it gone must
/// *reject* it under their own name. One word for both would have hidden which
/// of the two had happened.
export function withdrawLeave(
  requestId: string,
  reason: string
): Promise<LeaveRequestView> {
  return node.post<LeaveRequestView>(
    `/api/v1/employees/${SELF}/leave-requests/${encodeURIComponent(requestId)}/withdraw`,
    { reason }
  )
}

/// A client-minted request id.
///
/// `crypto.randomUUID` where it exists, and a timestamped fallback where it
/// does not — some Android WebViews on http origins do not expose it, and this
/// app runs on exactly those.
function newRequestId(): string {
  const random = globalThis.crypto?.randomUUID?.()
  if (random !== undefined) return `LV-${random}`
  return `LV-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`
}

// ── overtime: live, and the answer is yours ──────────────────
//
// An order is the employer's instruction; the answer is yours, under a key your
// supervisor does not hold. PP 35/2021 art. 26(2) wants both, which is why this
// screen has two buttons and no "add overtime" one — you cannot order your own.
//
// `acknowledge` became `consent`, and `accepted` became `agreed`. The words are
// the server's and they are the better ones: acknowledging an instruction is
// admitting you received it, and what the law asks for is agreement.

/// The orders addressed to you, newest first.
export function overtimeOrders(
  signal?: AbortSignal
): Promise<OvertimeOrderView[]> {
  return node.get<OvertimeOrderView[]>(
    `/api/v1/employees/${SELF}/overtime-orders`,
    { signal }
  )
}

/// Answer one: yes or no, in your own words.
///
/// There is no third value — an order is answered yes or no, and "pending" is
/// the state it is already in. A refusal is final: nobody can reverse it, which
/// is what makes it a refusal rather than a first offer.
export function answerOvertime(
  orderId: string,
  agreed: boolean,
  reason: string
): Promise<OvertimeOrderView> {
  return node.post<OvertimeOrderView>(
    `/api/v1/employees/${SELF}/overtime-orders/${encodeURIComponent(orderId)}/consent`,
    { agreed, reason }
  )
}
// ── attendance ─────────────────────────────────────────────────────────────
//
// `AttendanceRangeView` is days DERIVED on the request from the plan, the
// punches, the policy version in force on that date, the approvals and the
// effective correction. There is no stored outcome anywhere, which is why
// re-reading a fortnight can legitimately change it.

/// This person's own derived fortnight.
///
/// `punch_source_connected` is about *readers*, not about whether anything can
/// be recorded: since 2026-09-13 a unit with no reader can still have a
/// fortnight of phone taps, and each day's `punch_sources` says which produced
/// it.
export function attendance(
  from: string,
  to: string,
  signal?: AbortSignal
): Promise<AttendanceRangeView> {
  return node.get<AttendanceRangeView>(
    `/api/v1/employees/${SELF}/attendance?from=${from}&to=${to}`,
    { signal }
  )
}

/// Clock in, or clock out.
///
/// The body carries the direction and nothing else. Not the time — the server
/// stamps its own clock, because an instant this phone chose is an instant this
/// phone could choose; not the date — the server resolves which roster day the
/// reading answers, which for a shift running past midnight is yesterday; not
/// the place — that is the posting HR recorded. And not an id: the server
/// derives one from the punch's own content, so a double tap, a retry on a lost
/// connection, or a thumb resting on the button all land once. `newly_recorded`
/// is `false` when that happened, which is information rather than a failure.
export function punch(direction: "IN" | "OUT"): Promise<PunchRecorded> {
  return node.post<PunchRecorded>(`/api/v1/employees/${SELF}/punches`, {
    direction,
  })
}

function fromRow(row: CorrectionRow): AttendanceCorrection {
  return {
    correction_id: row.id,
    date: row.business_date,
    claimed_in: row.corrected_arrival,
    claimed_out: row.corrected_departure,
    reason: row.reason,
    status: row.state as AttendanceCorrection["status"],
    decided_by: row.decided_by,
    decided_at: row.decided_at,
  }
}

/// Your own pending fixes.
///
/// The server keeps one queue per place rather than one per person, and a
/// caller sees the queue of wherever they are posted — so this narrows it to
/// the rows filed against the caller's own record.
export async function corrections(
  signal?: AbortSignal
): Promise<readonly AttendanceCorrection[]> {
  const [me, rows] = await Promise.all([
    node.get<EmploymentProfileView>(`/api/v1/employees/${SELF}/profile`, {
      signal,
    }),
    node.get<CorrectionRow[]>("/api/v1/attendance-corrections?pending=true", {
      signal,
    }),
  ])
  return rows.filter((row) => row.employee_id === me.employee_id).map(fromRow)
}

export async function requestCorrection(
  correction: NewAttendanceCorrection
): Promise<AttendanceCorrection> {
  const effect =
    correction.claimed_in !== null && correction.claimed_out !== null
      ? "ARRIVAL_AND_DEPARTURE"
      : correction.claimed_in !== null
        ? "ARRIVAL"
        : "DEPARTURE"
  const rows = await node.post<CorrectionRow[]>(
    `/api/v1/employees/${SELF}/attendance-corrections`,
    {
      business_date: correction.date,
      effect,
      arrival: correction.claimed_in,
      departure: correction.claimed_out,
      reason: correction.reason,
    }
  )
  const filed =
    rows.find(
      (row) => row.business_date === correction.date && row.state === "PENDING"
    ) ?? rows[rows.length - 1]
  return fromRow(filed)
}

/// The holiday calendar that applies to this person, for this year.
///
/// `/holiday-calendars` is the index of published years, not a calendar, so
/// this asks which years exist, takes this year if it is one of them and
/// otherwise the most recent, then reads that year. No year published is not
/// an error — it is an empty calendar, and the screen says so.
///
/// A regional day names the places it applies to, and a day off in another
/// province is not a day off here: those are dropped against the caller's own
/// posting rather than shown to every shop.
export async function holidays(
  placeId: string | null,
  signal?: AbortSignal
): Promise<HolidayCalendar> {
  const index = await node.get<CalendarYearsView>("/api/v1/holiday-calendars", {
    signal,
  })
  const years = [...index.years].sort((a, b) => b - a)
  const thisYear = new Date().getFullYear()
  const year = years.includes(thisYear) ? thisYear : years[0]
  if (year === undefined) {
    return { year: thisYear, days: [] }
  }
  const calendar = await node.get<CalendarView>(
    `/api/v1/holiday-calendars/${year}`,
    { signal }
  )
  return {
    year: calendar.year,
    days: calendar.holidays.filter(
      (day) =>
        day.units === null ||
        (placeId !== null && day.units.includes(placeId))
    ),
  }
}

/// This person's notifications, first page, and how many are unread.
///
/// `unread` is the server's count rather than a count of `items`: the page is
/// capped, and a badge that stopped at the page size would be a badge nobody
/// trusts.
export async function notifications(
  signal?: AbortSignal
): Promise<{ items: readonly Notification[]; unread: number }> {
  const page = await node.get<NotificationPage>("/api/v1/notifications", {
    signal,
  })
  return { items: page.items.map(adopt), unread: page.unread }
}

/// The server's kinds are dotted — `people.leave.decided`,
/// `people.contract.expiring` — and this app groups them by the family it has
/// an icon and a screen for. Anything else is GENERAL rather than a blank row.
const FAMILIES: readonly [string, Notification["kind"]][] = [
  ["people.leave", "LEAVE"],
  ["people.overtime", "OVERTIME"],
  ["people.pay", "PAY"],
  ["people.payroll", "PAY"],
  ["people.attendance", "ATTENDANCE"],
  ["people.correction", "ATTENDANCE"],
]

/// Where each family is read in this app. The target is chosen here, from a
/// closed list, and never taken from the server as a string.
const DESTINATIONS: Partial<Record<Notification["kind"], string>> = {
  LEAVE: "/leave",
  OVERTIME: "/overtime",
  PAY: "/pay",
  ATTENDANCE: "/attendance",
}

function adopt(item: ContractNotification): Notification {
  const kind =
    FAMILIES.find(([prefix]) => item.kind.startsWith(prefix))?.[1] ?? "GENERAL"
  return {
    notification_id: item.notification_id,
    kind,
    subject: item.title,
    body: item.body,
    created_at: item.created_at,
    read_at: item.read_at,
    link: DESTINATIONS[kind] ?? null,
  }
}

export function markNotificationRead(
  notificationId: string
): Promise<{ unread: number }> {
  return node.post<{ unread: number }>(
    `/api/v1/notifications/${encodeURIComponent(notificationId)}/read`,
    {}
  )
}

export function markAllNotificationsRead(): Promise<{ unread: number }> {
  return node.post<{ unread: number }>("/api/v1/notifications/read-all", {})
}

// ── the next generation ────────────────────────────────────────────────────
//
// Swaps, the store head's queue, grievances, claims and the checklist. The
// shapes come from `@itulah/contract`, generated from the server — the part
// of `types.ts` this file once was is gone as each route lands, and nothing
// here re-declares what the contract already says.

export interface ClaimLineInput {
  type_code: string
  description: string
  spent_on: IsoDate
  claimed_minor: number
}

/// The claim, as the queue reads it. Structurally typed here, exactly as the
/// buying surface types its claim rows: the server's row is a Postgres shape
/// the contract has not claimed.
export interface ClaimRow {
  claim_id: string
  claim_number: string
  posted_on: string
  state: string
  claimed_minor: number
  sanctioned_minor: number | null
  decided_by: string | null
  decide_reason: string | null
}

export interface ClaimTypeRow {
  code: string
  name: string
  retired_at: string | null
}

export interface GrievanceTypeRow {
  code: string
  name: string
  retired_at: string | null
}

export interface GrievanceRow {
  grievance_id: string
  subject: string
  state: string
  created_at: string
}

export function mySwaps(signal?: AbortSignal): Promise<RosterSwapView[]> {
  return node.get<RosterSwapView[]>(`/api/v1/employees/${SELF}/roster-swaps`, {
    signal,
  })
}

export function fileSwap(swap: {
  with_employee_id: string
  on_date: IsoDate
  reason: string
}): Promise<RosterSwapView> {
  return node.post<RosterSwapView>("/api/v1/roster-swaps", swap)
}

export function withdrawSwap(id: string): Promise<RosterSwapView> {
  return node.post<RosterSwapView>(
    `/api/v1/roster-swaps/${encodeURIComponent(id)}/withdrawal`,
    {}
  )
}

export function colleagues(
  from: IsoDate,
  to: IsoDate,
  signal?: AbortSignal
): Promise<ColleagueView[]> {
  return node.get<ColleagueView[]>(
    `/api/v1/employees/${SELF}/colleagues?from=${from}&to=${to}`,
    { signal }
  )
}

export function pendingSwaps(signal?: AbortSignal): Promise<RosterSwapView[]> {
  return node.get<RosterSwapView[]>("/api/v1/roster-swaps/pending", { signal })
}

export function decideSwap(
  id: string,
  approved: boolean,
  reason: string
): Promise<RosterSwapView> {
  return node.post<RosterSwapView>(
    `/api/v1/roster-swaps/${encodeURIComponent(id)}/decision`,
    { approved, reason }
  )
}

export function pendingLeaveQueue(
  signal?: AbortSignal
): Promise<LeaveRequestView[]> {
  return node.get<LeaveRequestView[]>("/api/v1/leave-requests/pending", {
    signal,
  })
}

export function decideLeaveRequest(
  employeeId: string,
  requestId: string,
  approve: boolean,
  reason: string
): Promise<LeaveRequestView> {
  return node.post<LeaveRequestView>(
    `/api/v1/employees/${encodeURIComponent(employeeId)}/leave-requests/${encodeURIComponent(requestId)}/${approve ? "approve" : "reject"}`,
    { reason }
  )
}

export function pendingCorrections(
  signal?: AbortSignal
): Promise<CorrectionRow[]> {
  return node.get<CorrectionRow[]>("/api/v1/attendance-corrections", { signal })
}

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

export function grievanceTypes(
  signal?: AbortSignal
): Promise<GrievanceTypeRow[]> {
  return node.get<GrievanceTypeRow[]>("/api/v1/grievance-types", { signal })
}

export function fileGrievance(body: {
  type_code: string
  subject: string
  description: string
}): Promise<GrievanceRow> {
  return node.post<GrievanceRow>("/api/v1/grievances", body)
}

export function claimTypes(signal?: AbortSignal): Promise<ClaimTypeRow[]> {
  return node.get<ClaimTypeRow[]>("/api/v1/expense-claim-types", {
    signal,
  })
}

export function myClaims(signal?: AbortSignal): Promise<ClaimRow[]> {
  return node.get<ClaimRow[]>(`/api/v1/employees/${SELF}/expense-claims`, {
    signal,
  })
}

export function fileClaim(body: {
  lines: ClaimLineInput[]
  reason: string
}): Promise<ClaimRow> {
  return node.post<ClaimRow>("/api/v1/expense-claims", body)
}

export function submitClaim(
  claimId: string,
  reason: string
): Promise<ClaimRow> {
  return node.post<ClaimRow>(
    `/api/v1/expense-claims/${encodeURIComponent(claimId)}/submission`,
    { reason }
  )
}

export function myLifecycleTasks(
  signal?: AbortSignal
): Promise<LifecycleTaskView[]> {
  return node.get<LifecycleTaskView[]>(
    `/api/v1/employees/${SELF}/lifecycle-tasks`,
    { signal }
  )
}

export function completeOwnTask(
  templateId: string,
  reason: string
): Promise<LifecycleTaskView> {
  return node.post<LifecycleTaskView>(
    `/api/v1/employees/${SELF}/lifecycle-tasks/${encodeURIComponent(templateId)}/completion`,
    { reason }
  )
}
