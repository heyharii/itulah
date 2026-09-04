import { node } from "@/lib/api"
import { ApiError } from "@itulah/contract/client"
import type {
  EmploymentProfileView,
  LeaveBalanceRow,
  LeaveRequestView,
  LeaveTypeView,
  Notification as ContractNotification,
  NotificationPage,
} from "@itulah/contract"
import * as demo from "./demo"
import type {
  AttendanceCorrection,
  AttendanceDay,
  DeviceSession,
  EmploymentContract,
  HolidayCalendar,
  NewAttendanceCorrection,
  Notification,
  OvertimeOrder,
  PayrollIdentity,
  PaySlip,
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

export function payrollIdentity(
  signal?: AbortSignal
): Promise<PayrollIdentity> {
  return read(
    `/api/v1/employees/${SELF}/payroll-identity`,
    () => demo.demoPayrollIdentity,
    signal
  )
}

export function paySlips(signal?: AbortSignal): Promise<readonly PaySlip[]> {
  return read(`/api/v1/employees/${SELF}/pay`, () => demo.demoPaySlips, signal)
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

export function overtimeOrders(
  signal?: AbortSignal
): Promise<readonly OvertimeOrder[]> {
  return read(
    `/api/v1/employees/${SELF}/overtime-orders`,
    () => demo.demoOvertimeOrders,
    signal
  )
}

export function acknowledgeOvertime(
  orderId: string,
  accepted: boolean
): Promise<OvertimeOrder> {
  return write(
    "POST",
    `/api/v1/employees/${SELF}/overtime-orders/${orderId}/acknowledge`,
    { accepted },
    () => {
      const index = demo.demoOvertimeOrders.findIndex(
        (candidate) => candidate.order_id === orderId
      )
      const decided: OvertimeOrder = {
        ...demo.demoOvertimeOrders[index],
        status: accepted ? "ACKNOWLEDGED" : "DECLINED",
        acknowledged_at: new Date().toISOString(),
      }
      demo.demoOvertimeOrders[index] = decided
      return decided
    }
  )
}

export function attendance(
  from: string,
  to: string,
  signal?: AbortSignal
): Promise<readonly AttendanceDay[]> {
  return read(
    `/api/v1/employees/${SELF}/attendance/basis?from=${from}&to=${to}`,
    () => demo.demoAttendance,
    signal
  )
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
      const index = demo.demoAttendance.findIndex(
        (day) => day.date === correction.date
      )
      if (index >= 0) {
        demo.demoAttendance[index] = {
          ...demo.demoAttendance[index],
          correction_pending: true,
        }
      }
      return created
    }
  )
}

export function holidays(signal?: AbortSignal): Promise<HolidayCalendar> {
  return read("/api/v1/holiday-calendars", () => demo.demoHolidays, signal)
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
