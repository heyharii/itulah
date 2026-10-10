import { useQuery } from "@tanstack/react-query"
import { useMemo } from "react"

import { node } from "@/lib/api"
import { monthYear } from "@/lib/format"
import { listEmployees, peopleKeys } from "@/lib/queries/people"
import type { LeaveBalanceRow, LeaveRequestView } from "@itulah/contract"

/// The Time group's own reads and writes — the pieces the leave and
/// attendance pages need that `people.ts` does not carry yet.

/// Everyone currently employed that the caller may read, as the pickers and
/// the name lookups on the Time pages want them. Same key and same limit as
/// the overview and the overtime screen, so on most visits it is a cache hit.
export function useActiveEmployees() {
  const team = useQuery({
    queryKey: peopleKeys.employees({ status: "ACTIVE", limit: 1000 }),
    queryFn: ({ signal }) =>
      listEmployees({ status: "ACTIVE", limit: 1000 }, signal),
  })
  const people = useMemo(() => team.data ?? [], [team.data])
  const names = useMemo(
    () =>
      new Map(
        people.map((one) => [
          one.employee_id,
          one.full_name ?? one.employee_code,
        ])
      ),
    [people]
  )
  const nameOf = useMemo(() => (id: string) => names.get(id) ?? id, [names])
  return { team, people, nameOf }
}

/// A client-minted id, so a retried POST cannot file the same thing twice.
export function mintId(prefix: string): string {
  const random = globalThis.crypto?.randomUUID?.()
  if (random !== undefined) return `${prefix}-${random}`
  return `${prefix}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`
}

export interface LeaveFiling {
  readonly leaveType: string
  readonly fromDate: string
  readonly toDate: string
  readonly reason: string
  readonly evidence?: string
}

/// File leave on somebody else's behalf — `POST /employees/{id}/leave-requests`
/// is the same route the person's own app uses; the server picks the
/// `request` key over `request_own` when the id is not the caller's.
export function fileLeaveFor(
  employeeId: string,
  filing: LeaveFiling
): Promise<LeaveRequestView> {
  return node.post<LeaveRequestView>(
    `/api/v1/employees/${encodeURIComponent(employeeId)}/leave-requests`,
    {
      request_id: mintId("LV"),
      leave_type: filing.leaveType,
      from_date: filing.fromDate,
      to_date: filing.toDate,
      evidence:
        filing.evidence === undefined || filing.evidence.trim() === ""
          ? null
          : filing.evidence.trim(),
      reason: filing.reason,
    }
  )
}

/// What can be moved on a balance by hand. `USAGE` is deliberately absent —
/// days leave a balance only through an approved request — and `ACCRUAL` and
/// `EXPIRY` are the monthly job's, not a person's.
export const BALANCE_EVENTS: readonly {
  readonly value: string
  readonly label: string
}[] = [
  { value: "ALLOCATION", label: "Grant days (yearly entitlement)" },
  { value: "ADJUSTMENT", label: "Correct the balance (+ or −)" },
  { value: "CARRY_FORWARD", label: "Carry forward from last year" },
  { value: "COMPENSATORY", label: "Compensatory days" },
]

export interface BalanceMove {
  readonly leaveType: string
  readonly on: string
  readonly event: string
  /// Whole days. Signed only for `ADJUSTMENT`.
  readonly days: number
  readonly expiresOn?: string
}

/// `POST /employees/{id}/leave-balances` — head office's: an allocation is the
/// entitlement, and a manager who could hand somebody days could hand
/// themselves some. Answers with the balances after the move.
export function moveLeaveBalance(
  employeeId: string,
  move: BalanceMove
): Promise<LeaveBalanceRow[]> {
  return node.post<LeaveBalanceRow[]>(
    `/api/v1/employees/${encodeURIComponent(employeeId)}/leave-balances`,
    {
      entry_id: mintId("LB"),
      leave_type: move.leaveType,
      on: move.on,
      event: move.event,
      days: move.days,
      expires_on:
        move.expiresOn === undefined || move.expiresOn === ""
          ? null
          : move.expiresOn,
    }
  )
}

/// `2026-09` → first and last day of that month.
export function monthBounds(month: string): { from: string; to: string } {
  const [year, number] = month.split("-").map(Number) as [number, number]
  const last = new Date(year, number, 0).getDate()
  return {
    from: `${month}-01`,
    to: `${month}-${String(last).padStart(2, "0")}`,
  }
}

export function currentMonth(): string {
  return new Date().toISOString().slice(0, 7)
}

/// `2026-09` stepped by `by` months.
export function stepMonth(month: string, by: number): string {
  const [year, number] = month.split("-").map(Number) as [number, number]
  const next = new Date(year, number - 1 + by, 1)
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`
}

export function monthTitle(month: string): string {
  const [year, number] = month.split("-").map(Number) as [number, number]
  return monthYear(new Date(year, number - 1, 1), true)
}
