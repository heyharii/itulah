/**
 * Wire schemas for Internal's HR read models.
 *
 * Every fetch in `./api.ts` goes `api.get<unknown>` into a hand-rolled parser
 * (`text`, `count`, `decimal`, …) that already throws on a genuinely missing
 * required field. These schemas do not replace that — they run in front of
 * it, through `checkContract`, which never throws. What they add is
 * observability: today a renamed or dropped field surfaces three functions
 * later as "Internal HR response is missing X", with no record of what the
 * response actually looked like. A contract violation reports the payload.
 *
 * Field names are the wire's snake_case, matching what the parsers in
 * `api.ts` read off `raw.*` — these schemas describe the payload, not the
 * mapped `Hr*` shape it becomes.
 */

import { z } from "zod"

/**
 * Money: `total_amount` / `advance_offset` on a reimbursement. Per
 * docs/money-contract.md this backend is IDR-only and IDR's minor unit is
 * the rupiah itself (no scaling, no sen) — the wire genuinely sends no
 * currency field, so there is nothing to validate there. Strict on `.int()`
 * regardless: the migration to integer money on the Go side is not finished
 * (see the doc's wave table), so this is exactly the kind of field expected
 * to still arrive as a float on some routes, and that is the case this
 * layer exists to catch.
 */
const money = z.number().int()

export const HrEmployeeRow = z.object({
  id: z.string(),
  employee_code: z.string().nullish(),
  full_name: z.string(),
  email: z.string().nullish(),
  phone: z.string().nullish(),
  department: z.string().nullish(),
  position: z.string().nullish(),
  location_id: z.string(),
  location_type: z.string().nullish(),
  manager_id: z.string().nullish(),
  join_date: z.string(),
  contract_end: z.string().nullish(),
  employment_type: z.string().nullish(),
  // Displayed, not switched on: HrEmployee types this as a plain `string`.
  status: z.string(),
})
export type HrEmployeeRow = z.infer<typeof HrEmployeeRow>

export const HrEmployeeDocumentRow = z.object({
  id: z.string(),
  employee_id: z.string(),
  document_type: z.string(),
  file_key: z.string().nullish(),
  file_name: z.string(),
  mime_type: z.string().nullish(),
  uploaded_by: z.string().nullish(),
  uploaded_at: z.string(),
  status: z.string(),
  notes: z.string().nullish(),
})
export type HrEmployeeDocumentRow = z.infer<typeof HrEmployeeDocumentRow>

export const HrAttendanceRow = z.object({
  id: z.string(),
  employee_id: z.string(),
  date: z.string(),
  clock_in: z.string().nullish(),
  clock_out: z.string().nullish(),
  source: z.string().nullish(),
  shift_id: z.string().nullish(),
  status: z.string(),
  overtime_hours: z.number().nullish(),
  notes: z.string().nullish(),
  location_id: z.string(),
})
export type HrAttendanceRow = z.infer<typeof HrAttendanceRow>

export const HrLeaveRequestRow = z.object({
  id: z.string(),
  employee_id: z.string(),
  leave_type: z.string(),
  start_date: z.string(),
  end_date: z.string(),
  total_days: z.number(),
  reason: z.string().nullish(),
  status: z.string(),
  approved_by: z.string().nullish(),
  requested_at: z.string(),
  escalated: z.boolean(),
  approval_level: z.string().nullish(),
})
export type HrLeaveRequestRow = z.infer<typeof HrLeaveRequestRow>

export const HrLeaveBalanceRow = z.object({
  employee_id: z.string(),
  leave_type: z.string(),
  year: z.number(),
  entitlement: z.number(),
  used: z.number(),
  remaining: z.number(),
})
export type HrLeaveBalanceRow = z.infer<typeof HrLeaveBalanceRow>

export const HrShiftRow = z.object({
  id: z.string(),
  name: z.string(),
  start_time: z.string(),
  end_time: z.string(),
  location_id: z.string().nullish(),
  duration_hours: z.number().nullish(),
  break_minutes: z.number().nullish(),
  status: z.string().nullish(),
  color: z.string().nullish(),
})
export type HrShiftRow = z.infer<typeof HrShiftRow>

export const HrReimbursementRow = z.object({
  id: z.string(),
  employee_id: z.string(),
  reimbursement_type: z.string(),
  submitted_at: z.string().nullish(),
  approved_at: z.string().nullish(),
  approved_by: z.string().nullish(),
  paid_at: z.string().nullish(),
  status: z.string(),
  total_amount: money,
  notes: z.string().nullish(),
  journal_entry_id: z.string().nullish(),
  advance_offset: money.nullish(),
  created_at: z.string(),
})
export type HrReimbursementRow = z.infer<typeof HrReimbursementRow>

export const HrHolidayRow = z.object({
  id: z.string(),
  holiday_date: z.string(),
  name: z.string(),
  kind: z.string(),
  location_id: z.string().nullish(),
  created_by: z.string().nullish(),
  created_at: z.string().nullish(),
})
export type HrHolidayRow = z.infer<typeof HrHolidayRow>

/** `/api/v1/hr/dashboard/overview`. Checked as a single-element `checkContract`
 * call (see api.ts) — there is no list of rows here, only one object, but
 * routing it through the same never-throwing reporter keeps one seam for
 * every HR read rather than a second mechanism for singular payloads. */
export const HrDashboardOverviewPayload = z.object({
  location_id: z.string().nullish(),
  headcount_total: z.number(),
  headcount_active: z.number(),
  headcount_inactive: z.number(),
  leave_pending: z.number(),
  overtime_pending: z.number(),
})
export type HrDashboardOverviewPayload = z.infer<
  typeof HrDashboardOverviewPayload
>

const HrWorkforceTotalsPayload = z.object({
  active_headcount: z.number(),
  scheduled: z.number(),
  present: z.number(),
  late: z.number(),
  absent: z.number(),
  on_leave: z.number(),
  missing_clock_out: z.number(),
  stores_understaffed: z.number(),
  leave_pending: z.number(),
  overtime_pending: z.number(),
  corrections_pending: z.number(),
})

export const HrStoreCoverageRow = z.object({
  location_id: z.string(),
  active_headcount: z.number(),
  scheduled: z.number(),
  present: z.number(),
  late: z.number(),
  absent: z.number(),
  on_leave: z.number(),
  missing_clock_out: z.number(),
  coverage_status: z.string(),
})
export type HrStoreCoverageRow = z.infer<typeof HrStoreCoverageRow>

export const HrWorkforceExceptionRow = z.object({
  employee_id: z.string(),
  employee_name: z.string(),
  location_id: z.string(),
  department: z.string().nullish(),
  position: z.string().nullish(),
  type: z.string(),
  severity: z.string(),
  detail: z.string(),
})
export type HrWorkforceExceptionRow = z.infer<typeof HrWorkforceExceptionRow>

/** `/api/v1/hr/workforce/today`, minus its `stores`/`exceptions` arrays —
 * those are genuine row lists and are checked separately, against
 * `HrStoreCoverageRow` / `HrWorkforceExceptionRow`, once unwrapped. */
export const HrWorkforceTodayPayload = z.object({
  date: z.string(),
  location_id: z.string().nullish(),
  totals: HrWorkforceTotalsPayload,
})
export type HrWorkforceTodayPayload = z.infer<typeof HrWorkforceTodayPayload>

/** `/api/v1/hr/attendance/summary/{employeeId}/{month}`. */
export const HrAttendanceSummaryPayload = z.object({
  employee_id: z.string(),
  month: z.string(),
  total_present: z.number(),
  total_absent: z.number(),
  total_late: z.number(),
  total_leave: z.number(),
  total_overtime_hours: z.number(),
  working_days: z.number(),
})
export type HrAttendanceSummaryPayload = z.infer<
  typeof HrAttendanceSummaryPayload
>
