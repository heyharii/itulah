import { node } from "@/lib/api"
import type { PolicyScheduleView } from "@itulah/contract"

/// What "late" means, and since when.
///
/// Reading it needs nothing but a session — somebody measured against a
/// tolerance is entitled to know it. Writing it is head office's, and the
/// server refuses without a reason.

export const attendancePolicyKey = (asOf?: string) =>
  ["attendance-policy", asOf ?? null] as const

export function readAttendancePolicy(
  asOf?: string,
  signal?: AbortSignal,
): Promise<PolicyScheduleView> {
  const suffix = asOf ? `?as_of=${encodeURIComponent(asOf)}` : ""
  return node.get<PolicyScheduleView>(`/api/v1/attendance-policy${suffix}`, {
    signal,
  })
}

export interface NewPolicy {
  effectiveFrom: string
  lateGraceMinutes: number
  earlyLeaveGraceMinutes: number
  overtimeMinimumMinutes: number
  duplicatePunchWindowMinutes: number
  reason: string
}

/// Write a new version. It supersedes the one currently open, which the server
/// closes the day before this one starts — the two writes are one transaction,
/// because a schedule with two open versions does not load back.
export function setAttendancePolicy(policy: NewPolicy): Promise<PolicyScheduleView> {
  return node.post<PolicyScheduleView>("/api/v1/attendance-policy", {
    effective_from: policy.effectiveFrom,
    late_grace_minutes: policy.lateGraceMinutes,
    early_leave_grace_minutes: policy.earlyLeaveGraceMinutes,
    overtime_minimum_minutes: policy.overtimeMinimumMinutes,
    duplicate_punch_window_minutes: policy.duplicatePunchWindowMinutes,
    reason: policy.reason,
  })
}

/// The ceilings the server enforces, restated so the form can refuse before a
/// round trip rather than after one.
///
/// Not a second source of truth: the server checks these again and its answer
/// is the one that counts. This exists so somebody typing 600 into a box is
/// told immediately, by the box.
export const MAX_LATE_GRACE_MINUTES = 480
export const MAX_DUPLICATE_PUNCH_WINDOW_MINUTES = 60

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
