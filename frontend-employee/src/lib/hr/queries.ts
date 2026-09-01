import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useSyncExternalStore } from "react"

import * as hr from "./api"
import { isoDate } from "./demo"
import type { NewAttendanceCorrection, NewLeaveRequest } from "./types"

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

export function useLeaveTypes() {
  return useQuery({
    queryKey: key.leaveTypes,
    queryFn: ({ signal }) => hr.leaveTypes(signal),
  })
}

export function useLeaveRequests() {
  return useQuery({
    queryKey: key.leaveRequests,
    queryFn: ({ signal }) => hr.leaveRequests(signal),
  })
}

/// Applying moves a balance as well as adding a row, so both are invalidated.
export function useApplyForLeave() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (request: NewLeaveRequest) => hr.applyForLeave(request),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: key.leaveRequests })
      void client.invalidateQueries({ queryKey: key.leaveTypes })
    },
  })
}

export function useCancelLeave() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (requestId: string) => hr.cancelLeave(requestId),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: key.leaveRequests })
      void client.invalidateQueries({ queryKey: key.leaveTypes })
    },
  })
}

export function useOvertimeOrders() {
  return useQuery({
    queryKey: key.overtime,
    queryFn: ({ signal }) => hr.overtimeOrders(signal),
  })
}

export function useAcknowledgeOvertime() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({
      orderId,
      accepted,
    }: {
      orderId: string
      accepted: boolean
    }) => hr.acknowledgeOvertime(orderId, accepted),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: key.overtime })
      void client.invalidateQueries({ queryKey: key.notifications })
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
