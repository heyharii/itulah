import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useSyncExternalStore } from "react"

import * as hr from "./api"
import { isoDate } from "./demo"
import type { NewAttendanceCorrection } from "./types"

/// The cache keys, written out in one place.
///
/// Same reasoning as `cacheKey` in the shared contract: a mutation that
/// invalidates a key nobody reads leaves a person staring at a leave request
/// they just cancelled, and that is not a bug you find by looking at the
/// screen.
export const key = {
  profile: ["hr", "profile"] as const,
  contracts: ["hr", "contracts"] as const,
  payrollIdentity: ["hr", "payroll-identity"] as const,
  pay: ["hr", "pay"] as const,
  leaveTypes: ["hr", "leave-types"] as const,
  leaveRequests: ["hr", "leave-requests"] as const,
  leaveBalances: ["hr", "leave-balances"] as const,
  overtime: ["hr", "overtime"] as const,
  attendance: (from: string, to: string) =>
    ["hr", "attendance", from, to] as const,
  corrections: ["hr", "attendance-corrections"] as const,
  holidays: ["hr", "holidays"] as const,
  notifications: ["hr", "notifications"] as const,
  sessions: ["hr", "sessions"] as const,
}

/// Whether these screens are reading the server or standing in for it.
///
/// Rendered as a banner rather than hidden. Somebody being shown a leave
/// balance has every right to know it is not theirs yet.
export function useReach() {
  return useSyncExternalStore(hr.subscribeToReach, hr.reachSnapshot)
}

export function useProfile() {
  return useQuery({
    queryKey: key.profile,
    queryFn: ({ signal }) => hr.profile(signal),
  })
}

export function useContracts() {
  return useQuery({
    queryKey: key.contracts,
    queryFn: ({ signal }) => hr.contracts(signal),
  })
}

export function usePayrollIdentity() {
  return useQuery({
    queryKey: key.payrollIdentity,
    queryFn: ({ signal }) => hr.payrollIdentity(signal),
  })
}

export function usePaySlips() {
  return useQuery({
    queryKey: key.pay,
    queryFn: ({ signal }) => hr.paySlips(signal),
  })
}

/// The kinds of leave, joined with this person's own balances.
///
/// Two reads because the server keeps two things apart, and one hook because
/// the screens want them together: "annual leave" without "you have 6 days
/// left" is not an answer to anything anybody opens this screen to ask.
///
/// The join is where the honesty lives. A kind that draws on no balance gets
/// `balance: null` rather than a zero — sick leave is granted for as long as
/// the certificate says, and a screen showing "0 left" beside it would be
/// telling somebody they had run out of something that cannot run out.
export interface Entitlement {
  readonly code: string
  readonly name: string
  readonly drawsOnBalance: boolean
  readonly requiresEvidence: boolean
  /// Hundredths of a day. `null` when the kind draws on nothing.
  readonly remainingCentidays: number | null
  readonly pendingCentidays: number | null
}

export function useLeaveEntitlements() {
  const types = useQuery({
    queryKey: key.leaveTypes,
    queryFn: ({ signal }) => hr.leaveTypes(signal),
  })
  const balances = useQuery({
    queryKey: key.leaveBalances,
    queryFn: ({ signal }) => hr.leaveBalances(signal),
  })

  const rows: Entitlement[] = (types.data ?? []).map((kind) => {
    const balance = (balances.data ?? []).find(
      (row) => row.leave_type === kind.code
    )
    return {
      code: kind.code,
      name: kind.name,
      drawsOnBalance: kind.draws_on_balance,
      requiresEvidence: kind.requires_evidence,
      remainingCentidays: kind.draws_on_balance
        ? (balance?.centidays ?? 0)
        : null,
      pendingCentidays: kind.draws_on_balance
        ? (balance?.pending_centidays ?? 0)
        : null,
    }
  })

  return {
    data: rows,
    // The pair reads as one query to the screen: still loading while either is,
    // and failed if either failed. A screen that rendered the kinds before the
    // balances arrived would show every entitlement as zero for a frame.
    isPending: types.isPending || balances.isPending,
    isError: types.isError || balances.isError,
    error: types.error ?? balances.error,
  }
}

export function useLeaveRequests() {
  return useQuery({
    queryKey: key.leaveRequests,
    queryFn: ({ signal }) => hr.leaveRequests(signal),
  })
}

/// Filing moves nothing yet — a request is pending until somebody decides it —
/// but it does change what is pending, which is the number people plan around.
export function useApplyForLeave() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (request: hr.NewLeaveRequest) => hr.applyForLeave(request),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: key.leaveRequests })
      void client.invalidateQueries({ queryKey: key.leaveBalances })
    },
  })
}

/// Withdrawing carries a reason, because the server records one against every
/// decision — including the ones you take about yourself.
export function useWithdrawLeave() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ requestId, reason }: { requestId: string; reason: string }) =>
      hr.withdrawLeave(requestId, reason),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: key.leaveRequests })
      void client.invalidateQueries({ queryKey: key.leaveBalances })
    },
  })
}

export function useOvertimeOrders() {
  return useQuery({
    queryKey: key.overtime,
    queryFn: ({ signal }) => hr.overtimeOrders(signal),
  })
}

/// Answering is yours, and it carries your words either way.
///
/// A refusal with no reason recorded is a refusal somebody can later
/// characterise however they like, so the screen asks for one — briefly, on a
/// phone, but it asks.
export function useAnswerOvertime() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({
      orderId,
      agreed,
      reason,
    }: {
      orderId: string
      agreed: boolean
      reason: string
    }) => hr.answerOvertime(orderId, agreed, reason),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: key.overtime })
    },
  })
}

/// The fortnight ending today, which is the window somebody checks when they
/// think a day was recorded wrongly. Older than that is a payroll question,
/// not a self-service one.
export function attendanceWindow(): { from: string; to: string } {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const start = new Date(today.getTime() - 13 * 86_400_000)
  return { from: isoDate(start), to: isoDate(today) }
}

export function useAttendance() {
  const { from, to } = attendanceWindow()
  return useQuery({
    queryKey: key.attendance(from, to),
    queryFn: ({ signal }) => hr.attendance(from, to, signal),
  })
}

export function useCorrections() {
  return useQuery({
    queryKey: key.corrections,
    queryFn: ({ signal }) => hr.corrections(signal),
  })
}

export function useRequestCorrection() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (correction: NewAttendanceCorrection) =>
      hr.requestCorrection(correction),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: key.corrections })
      // The day itself changes too: it now carries a pending correction, and
      // the row must stop offering to file a second one.
      void client.invalidateQueries({ queryKey: ["hr", "attendance"] })
    },
  })
}

export function useHolidays() {
  return useQuery({
    queryKey: key.holidays,
    queryFn: ({ signal }) => hr.holidays(signal),
  })
}

export function useNotifications() {
  return useQuery({
    queryKey: key.notifications,
    queryFn: ({ signal }) => hr.notifications(signal),
    // An overtime order issued mid-shift should appear without the person
    // reloading a page they are carrying in their apron pocket.
    refetchInterval: 60_000,
  })
}

export function useMarkNotificationRead() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (notificationId: string) =>
      hr.markNotificationRead(notificationId),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: key.notifications })
    },
  })
}

export function useSessions() {
  return useQuery({
    queryKey: key.sessions,
    queryFn: ({ signal }) => hr.sessions(signal),
  })
}

export function useEndSession() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (sessionId: string) => hr.endSession(sessionId),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: key.sessions })
    },
  })
}
