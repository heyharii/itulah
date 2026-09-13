import { node } from "@/lib/api"
import { ApiError } from "@itulah/contract/client"
import type {
  AttendanceRangeView,
  EmploymentProfileView,
  LeaveBalanceRow,
  LeaveRequestView,
  LeaveTypeView,
  OvertimeOrderView,
  PayrollIdentityView,
  PayrollSlipRow,
  PunchRecorded,
  Notification as ContractNotification,
  NotificationPage,
} from "@itulah/contract"
import * as demo from "./demo"
import type {
  AttendanceCorrection,
  DeviceSession,
  EmploymentContract,
  HolidayCalendar,
  NewAttendanceCorrection,
  Notification,
} from "./types"

/// The employee's own record, asked of the server, with a stand-in for the
/// routes it does not have yet.
///
/// The server has none of them today. Rather than build these screens against
/// nothing, or build them against a mock that would have to be unpicked later,
/// every call here is the real request — correct path, correct method, correct
/// credentials — and only a 404 or a 501 falls back to `demo.ts`. So the day a
/// route lands, that route stops using the stand-in with no edit here at all,
/// and the ones that have not landed keep working.
///
/// Deliberately narrow: only "this route does not exist" falls back. A 401
/// still means sign in, a 403 still means you may not, a 500 and a dead
/// network still surface as failures. A fallback that swallowed those would
/// show a person somebody else's plausible leave balance and call it theirs,
/// which is worse than an error message.

/// `me` rather than an employee id in the path.
///
/// The phone app calls `/v1/employees/{id}/…`, and `me` is that `{id}`: the
/// caller's own record, resolved from the session by the server. It saves this
/// app a round trip it would otherwise make on every screen just to learn its
/// own id — and, more to the point, self-service is the only access this
/// surface has. Someone else's id here is the server's to refuse.
const SELF = "me"

export type Reach = "unknown" | "live" | "absent"

let reach: Reach = "unknown"
const listeners = new Set<() => void>()

function settle(next: Reach) {
  if (next === reach) {
    return
  }
  reach = next
  for (const listener of listeners) {
    listener()
  }
}

/// For `useSyncExternalStore` — the banner that tells the person on the screen
/// they are looking at a stand-in subscribes to this rather than polling.
export function subscribeToReach(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function reachSnapshot(): Reach {
  return reach
}

/// 501 as well as 404 because a route that is registered but not yet
/// implemented answers the second, and both mean the same thing to a caller:
/// the server cannot do this yet.
function routeMissing(error: unknown): boolean {
  return (
    error instanceof ApiError && (error.status === 404 || error.status === 501)
  )
}

async function read<T>(
  path: string,
  standIn: () => T,
  signal?: AbortSignal
): Promise<T> {
  try {
    const answer = await node.get<T>(path, { signal })
    settle("live")
    return answer
  } catch (error) {
    if (!routeMissing(error)) {
      throw error
    }
    settle("absent")
    return standIn()
  }
}

/// A write goes to the server unless a read has already established there is
/// nothing there.
///
/// The check comes first rather than after a failed request, because a failed
/// write cannot be read the way a failed read can. This node answers an
/// unrouted path with 404 to a GET and 405 to a POST — its fallback only
/// handles safe methods — and 405 is a genuinely ambiguous answer: on a server
/// that HAS grown these routes it would mean "this one exists, but not for
/// POST", which is a bug to show, not a reason to pretend the write landed.
///
/// So: if the reads have already come back 404, the routes are not there and
/// there is nothing to send. Otherwise the write is real and every failure is
/// reported. Every screen here loads before it submits, so by the time anybody
/// presses a button this is settled.
async function write<T>(
  method: "POST" | "DELETE",
  path: string,
  body: unknown,
  standIn: () => T
): Promise<T> {
  if (reach === "absent") {
    return standIn()
  }
  try {
    const answer = await node.request<T>(method, path, body)
    settle("live")
    return answer
  } catch (error) {
    if (!routeMissing(error)) {
      throw error
    }
    settle("absent")
    return standIn()
  }
}

export function profile(signal?: AbortSignal): Promise<EmploymentProfileView> {
  return read(
    `/api/v1/employees/${SELF}/profile`,
    () => demo.demoProfile,
    signal
  )
}

export function contracts(
  signal?: AbortSignal
): Promise<readonly EmploymentContract[]> {
  return read(
    `/api/v1/employees/${SELF}/contracts`,
    () => [demo.demoContract],
    signal
  )
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
// ── attendance: live, and honest about what produced each day ─────
//
// The route landed, and it is `/attendance` rather than the `/attendance/basis`
// this app used to ask for. It answers `AttendanceRangeView` — days DERIVED on
// the request from the plan, the punches, the policy version in force on that
// date, the approvals and the effective correction. There is no stored outcome
// anywhere, which is why re-reading a fortnight can legitimately change it.
//
// # There is no stand-in below, and removing the old one was the point
//
// `read`'s fallback fires on a 404 and hands back `demo.ts` instead. That is
// right for a route the server has not grown; it is dangerous for one it has,
// because a stand-in shaped like last month's guess renders happily behind a
// live route and nobody finds out until a figure is wrong. This app has already
// been bitten twice that way — `/notifications` returned a page where a list was
// expected, and `/holiday-calendars` an index where a calendar was — and both
// times the fallback was innocent and the hand-written shape was not.
//
// So these two call the node directly. A 404 here means the route moved, and
// this app should say so rather than quietly show a fortnight nobody worked.

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

export function corrections(
  signal?: AbortSignal
): Promise<readonly AttendanceCorrection[]> {
  return read(
    `/api/v1/employees/${SELF}/attendance/corrections`,
    () => demo.demoCorrections,
    signal
  )
}

export function requestCorrection(
  correction: NewAttendanceCorrection
): Promise<AttendanceCorrection> {
  return write(
    "POST",
    `/api/v1/employees/${SELF}/attendance/corrections`,
    correction,
    () => {
      const created: AttendanceCorrection = {
        correction_id: demo.demoId("cor"),
        date: correction.date,
        claimed_in: correction.claimed_in,
        claimed_out: correction.claimed_out,
        reason: correction.reason,
        status: "SUBMITTED",
        decided_by: null,
        decided_at: null,
      }
      demo.demoCorrections.unshift(created)
      // The day itself is no longer this file's to patch: it comes from the
      // live `/attendance` route above, which derives it. A stand-in that
      // reached across and edited real data's neighbour is exactly the kind of
      // half-real state that makes a screen impossible to reason about.
      return created
    }
  )
}

/// The second route in this file the server has grown, and — like
/// `/notifications` above — it does not answer what the stand-in does.
///
/// `/api/v1/holiday-calendars` returns the **index of published years**,
/// `{ years: [2026] }`, not a calendar. This function used to hand that
/// straight back typed as a `HolidayCalendar`, so `calendar.days` was
/// `undefined` and the "Days off" panel threw on `.length` — taking the whole
/// **Me** screen down with it, because one panel's crash is the screen's crash.
///
/// Because the route exists, `read`'s stand-in never fired to hide it. That is
/// the fallback working correctly: a route that answers is a route we must read
/// properly, and the shape mismatch was ours.
///
/// So: ask which years exist, take this year if it is one of them and otherwise
/// the most recent, then fetch that year. No year published is not an error —
/// it is an empty calendar, and it says so.
export async function holidays(signal?: AbortSignal): Promise<HolidayCalendar> {
  const index = await read<{ years: number[] }>(
    "/api/v1/holiday-calendars",
    () => ({ years: [demo.demoHolidays.year] }),
    signal
  )
  const years = [...(index.years ?? [])].sort((a, b) => b - a)
  if (years.length === 0) {
    return { calendar_id: "", name: "", year: new Date().getFullYear(), days: [] }
  }
  const thisYear = new Date().getFullYear()
  const year = years.includes(thisYear) ? thisYear : years[0]

  const calendar = await read<{
    year: number
    holidays: { date: string; name: string; kind: string }[]
  }>(
    `/api/v1/holiday-calendars/${year}`,
    () => ({ year, holidays: [] }),
    signal
  )

  return {
    calendar_id: String(year),
    name: `Kalender ${year}`,
    year: calendar.year ?? year,
    // The server says `CUTI_BERSAMA`; these screens say `JOINT_LEAVE`, because
    // that is the word the balance rule is written in. Translated here, once,
    // rather than in each screen that renders a day.
    days: (calendar.holidays ?? []).map((one) => ({
      date: one.date,
      name: one.name,
      kind:
        one.kind === "CUTI_BERSAMA"
          ? ("JOINT_LEAVE" as const)
          : one.kind === "REGIONAL"
            ? ("COMPANY" as const)
            : ("NATIONAL" as const),
    })),
  }
}

/// The one route in this file the server has actually grown, and it does not
/// answer what the stand-in does.
///
/// `/api/v1/notifications` returns a PAGE — `{ items, unread }` — of the
/// contract's own `Notification`, whose sentence is `title` and whose target is
/// a record `(subject_kind, subject_id)` rather than a route. The stand-in
/// returns a bare array shaped the way these screens read it. Because the route
/// exists, `read` does not fall back, so the page arrived where a list was
/// expected and the shell crashed on `.filter`.
///
/// So this is the one call that adapts rather than passes through. The target
/// resolves to `null` for every subject the server raises today: nothing it
/// stores is an HR record yet, and inventing a route from a subject kind this
/// app has never seen would send somebody to the wrong screen.
export async function notifications(
  signal?: AbortSignal
): Promise<readonly Notification[]> {
  const answer = await read<NotificationPage | readonly Notification[]>(
    "/api/v1/notifications",
    () => demo.demoNotifications,
    signal
  )
  return Array.isArray(answer)
    ? answer
    : (answer as NotificationPage).items.map(adopt)
}

const KINDS = ["LEAVE", "OVERTIME", "PAY", "ATTENDANCE"] as const

/// The server's notification as these screens read one.
///
/// `kind` is free text in the schema, so anything this app has no icon for is
/// GENERAL rather than a blank row.
function adopt(item: ContractNotification): Notification {
  const kind = KINDS.find(
    (known) => known === item.kind.toUpperCase()
  )
  return {
    notification_id: item.notification_id,
    kind: kind ?? "GENERAL",
    subject: item.title,
    body: item.body,
    created_at: item.created_at,
    read_at: item.read_at,
    link: null,
  }
}

export function markNotificationRead(
  notificationId: string
): Promise<Notification> {
  return write(
    "POST",
    `/api/v1/notifications/${notificationId}/read`,
    {},
    () => {
      const index = demo.demoNotifications.findIndex(
        (candidate) => candidate.notification_id === notificationId
      )
      const read: Notification = {
        ...demo.demoNotifications[index],
        read_at: new Date().toISOString(),
      }
      demo.demoNotifications[index] = read
      return read
    }
  )
}

export function sessions(
  signal?: AbortSignal
): Promise<readonly DeviceSession[]> {
  return read("/api/v1/me/sessions", () => demo.demoSessions, signal)
}

/// Ending a session on a device you no longer hold.
///
/// The current one is not offered here — that is what signing out is, and a
/// list where one row silently logs you out reads as a mistake.
export function endSession(sessionId: string): Promise<void> {
  return write("DELETE", `/api/v1/me/sessions/${sessionId}`, undefined, () => {
    const index = demo.demoSessions.findIndex(
      (candidate) => candidate.session_id === sessionId
    )
    if (index >= 0) {
      demo.demoSessions.splice(index, 1)
    }
  })
}
