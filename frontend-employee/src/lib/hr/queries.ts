import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import * as hr from "./api"
import { isoDate } from "@/lib/format"
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
  swaps: ["hr", "swaps"] as const,
  teamLeave: ["hr", "team", "leave"] as const,
  teamCorrections: ["hr", "team", "corrections"] as const,
  teamSwaps: ["hr", "team", "swaps"] as const,
  grievanceTypes: ["hr", "grievance-types"] as const,
  claimTypes: ["hr", "claim-types"] as const,
  claims: ["hr", "claims"] as const,
  tasks: ["hr", "lifecycle-tasks"] as const,
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
  /// Hundredths of a day granted per occurrence, for a kind like marriage
  /// leave; `null` otherwise.
  readonly perOccurrenceCentidays: number | null
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
      perOccurrenceCentidays:
        kind.backing === "PER_OCCURRENCE" ? kind.max_centidays : null,
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
    mutationFn: ({
      requestId,
      reason,
    }: {
      requestId: string
      reason: string
    }) => hr.withdrawLeave(requestId, reason),
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

/// Clock in, or out.
///
/// Invalidates the fortnight rather than writing the new punch into the cache
/// by hand. A day is *derived* on the server from five inputs — the plan, the
/// punches, the policy in force, the approvals and the effective correction —
/// so this browser cannot work out what the day now amounts to, and a guess
/// stitched in optimistically would be a lateness figure nobody computed.
export function usePunch() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (direction: "IN" | "OUT") => hr.punch(direction),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["hr", "attendance"] })
    },
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

/// The days off at this person's own unit — so it waits for the profile,
/// which is where the unit comes from.
export function useHolidays() {
  const profile = useProfile()
  const unitId = profile.data?.unit_id ?? null
  return useQuery({
    queryKey: [...key.holidays, unitId],
    queryFn: ({ signal }) => hr.holidays(unitId, signal),
    enabled: profile.isSuccess,
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

export function useMarkAllNotificationsRead() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: () => hr.markAllNotificationsRead(),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: key.notifications })
    },
  })
}

// ── the next generation ────────────────────────────────────────────────────

export function useMySwaps() {
  return useQuery({
    queryKey: key.swaps,
    queryFn: ({ signal }) => hr.mySwaps(signal),
  })
}

export function useFileSwap() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (swap: {
      with_employee_id: string
      on_date: string
      reason: string
    }) => hr.fileSwap(swap),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: key.swaps })
    },
  })
}

export function useWithdrawSwap() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => hr.withdrawSwap(id),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: key.swaps })
    },
  })
}

/// Who else is planned at your place on one day. Not asked until a day is
/// chosen.
export function useColleagues(on: string | null) {
  return useQuery({
    queryKey: [...key.swaps, "colleagues", on],
    queryFn: ({ signal }) => hr.colleagues(on ?? "", on ?? "", signal),
    enabled: on !== null,
  })
}

/// The store head's queue. Three reads, one desk: leave, corrections and
/// swaps awaiting a decision. Overtime is not here — its answer is the
/// worker's own, and it arrives on their phone. Each read bounds itself by
/// the caller's own posting, exactly as the console's queues do.
export function useTeamQueue() {
  const leave = useQuery({
    queryKey: key.teamLeave,
    queryFn: ({ signal }) => hr.pendingLeaveQueue(signal),
  })
  const corrections = useQuery({
    queryKey: key.teamCorrections,
    queryFn: ({ signal }) => hr.pendingCorrections(signal),
  })
  const swaps = useQuery({
    queryKey: key.teamSwaps,
    queryFn: ({ signal }) => hr.pendingSwaps(signal),
  })
  return { leave, corrections, swaps }
}

export function useDecideLeaveRequest() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: {
      employeeId: string
      requestId: string
      approve: boolean
      reason: string
    }) =>
      hr.decideLeaveRequest(
        input.employeeId,
        input.requestId,
        input.approve,
        input.reason
      ),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: key.teamLeave })
    },
  })
}

export function useDecideCorrection() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: { id: string; approve: boolean; reason: string }) =>
      hr.decideCorrection(input.id, input.approve, input.reason),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: key.teamCorrections })
    },
  })
}

export function useDecideSwap() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: { id: string; approve: boolean; reason: string }) =>
      hr.decideSwap(input.id, input.approve, input.reason),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: key.teamSwaps })
    },
  })
}

export function useGrievanceTypes() {
  return useQuery({
    queryKey: key.grievanceTypes,
    queryFn: ({ signal }) => hr.grievanceTypes(signal),
  })
}

export function useFileGrievance() {
  return useMutation({
    mutationFn: (body: {
      type_code: string
      subject: string
      description: string
    }) => hr.fileGrievance(body),
  })
}

export function useClaimTypes() {
  return useQuery({
    queryKey: key.claimTypes,
    queryFn: ({ signal }) => hr.claimTypes(signal),
  })
}

export function useMyClaims() {
  return useQuery({
    queryKey: key.claims,
    queryFn: ({ signal }) => hr.myClaims(signal),
  })
}

export function useFileClaim() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (body: { lines: hr.ClaimLineInput[]; reason: string }) =>
      hr.fileClaim(body),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: key.claims })
    },
  })
}

export function useSubmitClaim() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: { claimId: string; reason: string }) =>
      hr.submitClaim(input.claimId, input.reason),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: key.claims })
    },
  })
}

export function useMyLifecycleTasks() {
  return useQuery({
    queryKey: key.tasks,
    queryFn: ({ signal }) => hr.myLifecycleTasks(signal),
  })
}

export function useCompleteOwnTask() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: { templateId: string; reason: string }) =>
      hr.completeOwnTask(input.templateId, input.reason),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: key.tasks })
    },
  })
}
