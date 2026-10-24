import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"

import { CENTRAL_KEY_PREFIX } from "@/lib/cloud"
import {
  decideLeave,
  decideSwap,
  hrKeys,
  leaveRequestsOf,
  pendingLeaveQuery,
  pendingSwapsQuery,
  useReach,
  type StoreScope,
} from "@/lib/queries/hr"
import { useIdentity } from "@/lib/session"
import type {
  EmployeeSummary,
  LeaveRequestView,
  RosterSwapView,
} from "@itulah/contract"

/// What the Requests screen asks head office, and the one write it makes.
///
/// # What is in the inbox, and what is not
///
/// A request here is something the store head DECIDES, so the inbox is
/// exactly the two kinds the centre lets a store head decide:
///
///  - **leave** — filed by the employee (or by a Supervisor in reach on their
///    behalf), decided by the store head or head office, and never by the
///    person it is for or the person who filed it;
///  - **a shift swap** — asked by the employee, decided by the store head.
///
/// Overtime is not here. It is *ordered* by the manager and consented to by
/// the employee (`overtime-orders`), so there is nothing for the manager to
/// approve — the Overtime screen is where the orders and the answers are. And
/// there is no "permit": the leave types are head office's list, and a kind of
/// leave that is not on it does not exist.
///
/// # The two queues are one inbox
///
/// Two routes, two keys, one list. They fail separately — a login that may
/// decide leave but not swaps still has its leave — so the screen reads each
/// on its own and merges them here.

/// One thing waiting on, or decided by, the store head.
export type RequestItem =
  | {
      readonly kind: "leave"
      /// Unique across both kinds: a leave id and a swap id are minted by
      /// different tables.
      readonly key: string
      readonly request: LeaveRequestView
    }
  | {
      readonly kind: "swap"
      readonly key: string
      readonly swap: RosterSwapView
    }

/// What an approval says when the person approving has nothing to add.
///
/// The centre refuses a decision without a reason — a record of what changed
/// and not why is the half of an audit trail that never helps — but a store
/// head tapping Approve on a leave request has no more to say than that. The
/// word is the reason; a decline always asks for a real one.
export const APPROVED_REASON = "Approved"

/// The day a request is for: where it sorts.
function dayOf(item: RequestItem): string {
  return item.kind === "leave" ? item.request.from_date : item.swap.on_date
}

/// Who is signed in here, as the centre knows them: the login that files and
/// decides, and the employment record behind it.
///
/// Both come from reads the shell already holds (`useIdentity`, and the reach
/// the workspace gate asked), so this costs nothing.
function useMe(): { username: string | null; employeeId: string | null } {
  const identity = useIdentity()
  const reach = useReach(true)
  return {
    username: identity.data?.username ?? null,
    employeeId: reach.data?.employee_id ?? null,
  }
}

/// Everything waiting on the store head: leave and swaps, the soonest day
/// first.
///
/// Soonest rather than newest because a swap carries no time it was asked,
/// and "what needs an answer first" is the order a store head works in.
///
/// The leave queue already leaves out what is the signed-in person's own (the
/// centre filters it: a row offering buttons that can only answer 403 is not a
/// queue item). The swap queue does not, so the same rule is applied to it
/// here — a swap the signed-in person asked for is somebody else's to decide.
export function useWaitingRequests(scope: StoreScope) {
  const me = useMe()
  const leave = useQuery(pendingLeaveQuery(scope.unit_id))
  const swaps = useQuery(pendingSwapsQuery(scope.unit_id))

  const items: RequestItem[] = [
    ...(leave.data?.rows ?? []).map((request): RequestItem => ({
      kind: "leave",
      key: `leave:${request.id}`,
      request,
    })),
    ...(swaps.data?.rows ?? [])
      .filter(
        (swap) =>
          swap.state === "PENDING" &&
          swap.requested_by !== me.username &&
          swap.employee_id !== me.employeeId,
      )
      .map((swap): RequestItem => ({
        kind: "swap",
        key: `swap:${swap.id}`,
        swap,
      })),
  ].sort((left, right) => dayOf(left).localeCompare(dayOf(right)))

  return {
    leave,
    swaps,
    items,
    /// Rows the centre returned for other shops, dropped by the fence.
    elsewhere: (leave.data?.elsewhere ?? 0) + (swaps.data?.elsewhere ?? 0),
  }
}

/// Leave that has been answered, newest decision first.
///
/// Leave history is only readable one person at a time
/// (`/employees/{id}/leave-requests`), so this is one read per person — and
/// the screen only mounts it once the Done tab is opened, so the Requests
/// screen the store head lands on costs two reads, not twenty.
///
/// Swaps that were decided cannot be listed: the relay lets a store ask for
/// the pending ones and decide them, and nothing else. A decided swap is on
/// the rota; it is not in this list.
export function useDoneLeave(people: readonly EmployeeSummary[]) {
  const here = people.filter((person) => person.status === "ACTIVE")
  const reads = useQueries({
    queries: here.map((person) => ({
      queryKey: hrKeys.leaveOf(person.employee_id),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        leaveRequestsOf(person.employee_id, signal),
    })),
  })

  const items: RequestItem[] = reads
    .flatMap((read) => read.data ?? [])
    .filter((request) => request.state !== "PENDING")
    .sort((left, right) =>
      (right.decided_at ?? right.updated_at).localeCompare(
        left.decided_at ?? left.updated_at,
      ),
    )
    .map((request): RequestItem => ({
      kind: "leave",
      key: `leave:${request.id}`,
      request,
    }))

  return {
    items,
    /// Nothing has come back yet: say so rather than "nothing is done".
    reading: reads.length > 0 && reads.every((read) => read.isPending),
    /// The first refusal among the reads, if any — one person's history
    /// refused is not a reason to hide everybody else's.
    refused: reads.find((read) => read.isError)?.error,
  }
}

/// Approve or decline one request.
///
/// A mutation per card rather than one for the list: two requests decided in
/// quick succession must each know whether they are on their way, and a
/// shared mutation only remembers the last.
export function useRequestDecision(item: RequestItem) {
  return useMutation({
    mutationFn: (input: {
      approve: boolean
      reason: string
    }): Promise<LeaveRequestView | RosterSwapView> =>
      item.kind === "leave"
        ? decideLeave({
            employeeId: item.request.employee_id,
            requestId: item.request.id,
            decision: input.approve ? "approve" : "reject",
            reason: input.reason,
          })
        : decideSwap({
            id: item.swap.id,
            approved: input.approve,
            reason: input.reason,
          }),
  })
}

/// Re-read everything a decision moves: the queues, the person's history and
/// balance, the rota (a swap moves two days on it), and today's attendance —
/// an approved day off is a day nobody should be marked missing on.
///
/// Separate from the mutation so a card can finish leaving before the list
/// under it changes.
export function useRefreshRequests(): () => void {
  const client = useQueryClient()
  return () => {
    client.invalidateQueries({ queryKey: hrKeys.queue() })
    client.invalidateQueries({ queryKey: hrKeys.swaps() })
    client.invalidateQueries({
      queryKey: [CENTRAL_KEY_PREFIX, "hr", "roster"],
    })
    client.invalidateQueries({ queryKey: hrKeys.attendance() })
  }
}
