/**
 * Owns the read-only bridge from Internal's HR read models to Slowdown.
 *
 * The HR screens still contain local workflow fixtures for commands that are
 * not wired to Internal. Read adapters in this module expose only confirmed
 * Internal resources (dashboard, workforce, employees, attendance, leave,
 * shifts, reimbursements, holidays, and employee documents); failures never
 * become fabricated live values.
 */

import { keepPreviousData } from "@tanstack/react-query"

import {
  api,
  checkContract,
  qs,
  useDomainQuery,
  type ApiRequestOptions,
} from "@/lib/api"
import { todayKey, type DayKey } from "@/lib/day"
import {
  HrAttendanceRow,
  HrAttendanceSummaryPayload,
  HrDashboardOverviewPayload,
  HrEmployeeDocumentRow,
  HrEmployeeRow,
  HrHolidayRow,
  HrLeaveBalanceRow,
  HrLeaveRequestRow,
  HrReimbursementRow,
  HrShiftRow,
  HrStoreCoverageRow,
  HrWorkforceExceptionRow,
  HrWorkforceTodayPayload,
} from "./contracts"
import { hrQueries } from "./queries"

export interface HrDashboardOverview {
  locationId?: string
  headcountTotal: number
  headcountActive: number
  headcountInactive: number
  leavePending: number
  overtimePending: number
  fetchedAt: string
}

export interface HrWorkforceTotals {
  activeHeadcount: number
  scheduled: number
  present: number
  late: number
  absent: number
  onLeave: number
  missingClockOut: number
  storesUnderstaffed: number
  leavePending: number
  overtimePending: number
  correctionsPending: number
}

export interface HrStoreCoverage {
  locationId: string
  activeHeadcount: number
  scheduled: number
  present: number
  late: number
  absent: number
  onLeave: number
  missingClockOut: number
  coverageStatus: string
}

export interface HrWorkforceException {
  employeeId: string
  employeeName: string
  locationId: string
  department?: string
  position?: string
  type: string
  severity: string
  detail: string
}

export interface HrWorkforceToday {
  date: DayKey
  locationId?: string
  totals: HrWorkforceTotals
  stores: HrStoreCoverage[]
  exceptions: HrWorkforceException[]
  fetchedAt: string
}

/**
 * Employee data returned by Internal's HR resource. This intentionally stays
 * separate from the old demo `Employee` type: attendance, tenure, overtime,
 * and the other calculated fields in that type are not present in the
 * employee endpoint and must not be invented by the client.
 */
export interface HrEmployee {
  id: string
  employeeCode: string
  fullName: string
  email?: string
  phone?: string
  department: string
  position: string
  locationId: string
  locationType: string
  managerId?: string
  joinDate: string
  contractEnd?: string
  employmentType: string
  status: string
}

export interface HrEmployeeDocument {
  id: string
  employeeId: string
  documentType: string
  fileKey: string
  fileName: string
  mimeType: string
  uploadedBy: string
  uploadedAt: string
  status: string
  notes?: string
}

export interface HrAttendanceRecord {
  id: string
  employeeId: string
  date: DayKey
  clockIn?: string
  clockOut?: string
  source: string
  shiftId?: string
  status: string
  overtimeHours: number
  notes?: string
  locationId: string
}

export interface HrLeaveRequest {
  id: string
  employeeId: string
  leaveType: string
  startDate: string
  endDate: string
  totalDays: number
  reason?: string
  status: string
  approvedBy?: string
  requestedAt: string
  escalated: boolean
  approvalLevel: string
}

export interface HrLeaveBalance {
  employeeId: string
  leaveType: string
  year: number
  entitlement: number
  used: number
  remaining: number
}

export interface HrShift {
  id: string
  name: string
  startTime: string
  endTime: string
  locationId: string
  durationHours?: number
  breakMinutes: number
  status?: string
  color?: string
}

export interface HrReimbursement {
  id: string
  employeeId: string
  reimbursementType: string
  submittedAt?: string
  approvedAt?: string
  approvedBy?: string
  paidAt?: string
  status: string
  totalAmount: number
  notes?: string
  journalEntryId?: string
  advanceOffset: number
  createdAt: string
}

export interface HrHoliday {
  id: string
  date: DayKey
  name: string
  kind: string
  locationId?: string
  createdBy?: string
  createdAt?: string
}

type JsonRecord = Record<string, unknown>

function asRecord(value: unknown, label: string): JsonRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Internal HR returned an invalid ${label} response`)
  }
  return value as JsonRecord
}

function text(value: unknown, label: string, required = false): string {
  if (typeof value === "string" && value.trim()) return value.trim()
  if (required) throw new Error(`Internal HR response is missing ${label}`)
  return ""
}

function count(value: unknown, label: string): number {
  if (typeof value === "number" && Number.isFinite(value))
    return Math.max(0, Math.trunc(value))
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return Math.max(0, Math.trunc(parsed))
  }
  throw new Error(`Internal HR response is missing ${label}`)
}

function list(value: unknown, label: string): JsonRecord[] {
  if (!Array.isArray(value))
    throw new Error(`Internal HR response is missing ${label}`)
  return value.map((item, index) => asRecord(item, `${label}[${index}]`))
}

function optionalText(value: unknown): string | undefined {
  const result = text(value, "value")
  return result || undefined
}

function decimal(value: unknown, label: string): number {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  throw new Error(`Internal HR response is missing ${label}`)
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value === "boolean") return value
  throw new Error(`Internal HR response is missing ${label}`)
}

function employeeFromApi(raw: JsonRecord, index: number): HrEmployee {
  const label = `employees[${index}]`
  return {
    id: text(raw.id, `${label}.id`, true),
    employeeCode: text(raw.employee_code, `${label}.employee_code`),
    fullName: text(raw.full_name, `${label}.full_name`, true),
    email: optionalText(raw.email),
    phone: optionalText(raw.phone),
    department: text(raw.department, `${label}.department`),
    position: text(raw.position, `${label}.position`),
    locationId: text(raw.location_id, `${label}.location_id`, true),
    locationType: text(raw.location_type, `${label}.location_type`),
    managerId: optionalText(raw.manager_id),
    joinDate: text(raw.join_date, `${label}.join_date`, true),
    contractEnd: optionalText(raw.contract_end),
    employmentType: text(raw.employment_type, `${label}.employment_type`),
    status: text(raw.status, `${label}.status`, true),
  }
}

function employeesFromApi(
  payload: unknown,
  path: string
): {
  items: HrEmployee[]
  total: number
} {
  const body = asRecord(payload, "employees")
  const rawItems = list(body.employees, "employees")
  checkContract(HrEmployeeRow, rawItems, path)
  return {
    items: rawItems.map(employeeFromApi),
    total: count(body.total, "total"),
  }
}

function employeeDetailFromApi(payload: unknown): HrEmployee {
  const raw = asRecord(payload, "employee")
  // Label is the route shape, not the URL called: employeeId lives in the
  // path, and a real id here would key the once-per-endpoint report gate
  // per employee instead of once for the whole route.
  checkContract(HrEmployeeRow, [raw], "/v1/hr/employees/:id")
  return employeeFromApi(raw, 0)
}

function documentFromApi(raw: JsonRecord, index: number): HrEmployeeDocument {
  const label = `documents[${index}]`
  return {
    id: text(raw.id, `${label}.id`, true),
    employeeId: text(raw.employee_id, `${label}.employee_id`, true),
    documentType: text(raw.document_type, `${label}.document_type`, true),
    fileKey: text(raw.file_key, `${label}.file_key`),
    fileName: text(raw.file_name, `${label}.file_name`, true),
    mimeType: text(raw.mime_type, `${label}.mime_type`),
    uploadedBy: text(raw.uploaded_by, `${label}.uploaded_by`),
    uploadedAt: text(raw.uploaded_at, `${label}.uploaded_at`, true),
    status: text(raw.status, `${label}.status`, true),
    notes: optionalText(raw.notes),
  }
}

function documentsFromApi(payload: unknown): HrEmployeeDocument[] {
  const rows = list(payload, "documents")
  // Static route shape — employeeId lives in the URL, not in the label.
  checkContract(HrEmployeeDocumentRow, rows, "/v1/hr/employees/:id/documents")
  return rows.map(documentFromApi)
}

function attendanceFromApi(
  payload: unknown,
  path: string
): {
  items: HrAttendanceRecord[]
  total: number
} {
  const body = asRecord(payload, "attendance")
  const rawItems = list(body.items, "attendance.items")
  checkContract(HrAttendanceRow, rawItems, path)
  return {
    items: rawItems.map((raw, index) => {
      const label = `attendance.items[${index}]`
      return {
        id: text(raw.id, `${label}.id`, true),
        employeeId: text(raw.employee_id, `${label}.employee_id`, true),
        date: text(raw.date, `${label}.date`, true).slice(0, 10) as DayKey,
        clockIn: optionalText(raw.clock_in),
        clockOut: optionalText(raw.clock_out),
        source: text(raw.source, `${label}.source`),
        shiftId: optionalText(raw.shift_id),
        status: text(raw.status, `${label}.status`, true),
        overtimeHours: decimal(
          raw.overtime_hours ?? 0,
          `${label}.overtime_hours`
        ),
        notes: optionalText(raw.notes),
        locationId: text(raw.location_id, `${label}.location_id`, true),
      }
    }),
    total: count(body.total, "attendance.total"),
  }
}

function leaveFromApi(raw: JsonRecord, index: number): HrLeaveRequest {
  const label = `leave[${index}]`
  return {
    id: text(raw.id, `${label}.id`, true),
    employeeId: text(raw.employee_id, `${label}.employee_id`, true),
    leaveType: text(raw.leave_type, `${label}.leave_type`, true),
    startDate: text(raw.start_date, `${label}.start_date`, true),
    endDate: text(raw.end_date, `${label}.end_date`, true),
    totalDays: count(raw.total_days, `${label}.total_days`),
    reason: optionalText(raw.reason),
    status: text(raw.status, `${label}.status`, true),
    approvedBy: optionalText(raw.approved_by),
    requestedAt: text(raw.requested_at, `${label}.requested_at`, true),
    escalated: boolean(raw.escalated, `${label}.escalated`),
    approvalLevel: text(raw.approval_level, `${label}.approval_level`),
  }
}

function shiftsFromApi(payload: unknown, path: string): HrShift[] {
  const rows = list(payload, "shifts")
  checkContract(HrShiftRow, rows, path)
  return rows.map((raw, index) => {
    const label = `shifts[${index}]`
    return {
      id: text(raw.id, `${label}.id`, true),
      name: text(raw.name, `${label}.name`, true),
      startTime: text(raw.start_time, `${label}.start_time`, true),
      endTime: text(raw.end_time, `${label}.end_time`, true),
      locationId: text(raw.location_id, `${label}.location_id`),
      durationHours:
        raw.duration_hours === null || raw.duration_hours === undefined
          ? undefined
          : decimal(raw.duration_hours, `${label}.duration_hours`),
      breakMinutes: count(raw.break_minutes ?? 0, `${label}.break_minutes`),
      status: optionalText(raw.status),
      color: optionalText(raw.color),
    }
  })
}

function reimbursementsFromApi(
  payload: unknown,
  path: string
): HrReimbursement[] {
  const rows = list(payload, "reimbursements")
  checkContract(HrReimbursementRow, rows, path)
  return rows.map((raw, index) => {
    const label = `reimbursements[${index}]`
    return {
      id: text(raw.id, `${label}.id`, true),
      employeeId: text(raw.employee_id, `${label}.employee_id`, true),
      reimbursementType: text(
        raw.reimbursement_type,
        `${label}.reimbursement_type`,
        true
      ),
      submittedAt: optionalText(raw.submitted_at),
      approvedAt: optionalText(raw.approved_at),
      approvedBy: optionalText(raw.approved_by),
      paidAt: optionalText(raw.paid_at),
      status: text(raw.status, `${label}.status`, true),
      totalAmount: decimal(raw.total_amount, `${label}.total_amount`),
      notes: optionalText(raw.notes),
      journalEntryId: optionalText(raw.journal_entry_id),
      advanceOffset: decimal(
        raw.advance_offset ?? 0,
        `${label}.advance_offset`
      ),
      createdAt: text(raw.created_at, `${label}.created_at`, true),
    }
  })
}

function holidaysFromApi(payload: unknown, path: string): HrHoliday[] {
  const rows = list(payload, "holidays")
  checkContract(HrHolidayRow, rows, path)
  return rows.map((raw, index) => {
    const label = `holidays[${index}]`
    return {
      id: text(raw.id, `${label}.id`, true),
      date: text(raw.holiday_date, `${label}.holiday_date`, true).slice(
        0,
        10
      ) as DayKey,
      name: text(raw.name, `${label}.name`, true),
      kind: text(raw.kind, `${label}.kind`, true),
      locationId: optionalText(raw.location_id),
      createdBy: optionalText(raw.created_by),
      createdAt: optionalText(raw.created_at),
    }
  })
}

function apiOptions(signal?: AbortSignal): ApiRequestOptions | undefined {
  return signal ? { signal } : undefined
}

function dashboardFromApi(payload: unknown): HrDashboardOverview {
  const body = asRecord(payload, "dashboard overview")
  return {
    locationId: text(body.location_id, "location_id") || undefined,
    headcountTotal: count(body.headcount_total, "headcount_total"),
    headcountActive: count(body.headcount_active, "headcount_active"),
    headcountInactive: count(body.headcount_inactive, "headcount_inactive"),
    leavePending: count(body.leave_pending, "leave_pending"),
    overtimePending: count(body.overtime_pending, "overtime_pending"),
    fetchedAt: new Date().toISOString(),
  }
}

function workforceFromApi(payload: unknown): HrWorkforceToday {
  const body = asRecord(payload, "daily workforce")
  const rawTotals = asRecord(body.totals, "daily workforce totals")
  const rawStores = list(body.stores, "daily workforce stores")
  const rawExceptions = list(body.exceptions, "daily workforce exceptions")
  const date = text(body.date, "date", true)

  return {
    date: date.slice(0, 10) as DayKey,
    locationId: text(body.location_id, "location_id") || undefined,
    totals: {
      activeHeadcount: count(
        rawTotals.active_headcount,
        "totals.active_headcount"
      ),
      scheduled: count(rawTotals.scheduled, "totals.scheduled"),
      present: count(rawTotals.present, "totals.present"),
      late: count(rawTotals.late, "totals.late"),
      absent: count(rawTotals.absent, "totals.absent"),
      onLeave: count(rawTotals.on_leave, "totals.on_leave"),
      missingClockOut: count(
        rawTotals.missing_clock_out,
        "totals.missing_clock_out"
      ),
      storesUnderstaffed: count(
        rawTotals.stores_understaffed,
        "totals.stores_understaffed"
      ),
      leavePending: count(rawTotals.leave_pending, "totals.leave_pending"),
      overtimePending: count(
        rawTotals.overtime_pending,
        "totals.overtime_pending"
      ),
      correctionsPending: count(
        rawTotals.corrections_pending,
        "totals.corrections_pending"
      ),
    },
    stores: rawStores.map((store) => ({
      locationId: text(store.location_id, "stores.location_id", true),
      activeHeadcount: count(store.active_headcount, "stores.active_headcount"),
      scheduled: count(store.scheduled, "stores.scheduled"),
      present: count(store.present, "stores.present"),
      late: count(store.late, "stores.late"),
      absent: count(store.absent, "stores.absent"),
      onLeave: count(store.on_leave, "stores.on_leave"),
      missingClockOut: count(
        store.missing_clock_out,
        "stores.missing_clock_out"
      ),
      coverageStatus: text(
        store.coverage_status,
        "stores.coverage_status",
        true
      ),
    })),
    exceptions: rawExceptions.map((exception) => ({
      employeeId: text(exception.employee_id, "exceptions.employee_id", true),
      employeeName: text(
        exception.employee_name,
        "exceptions.employee_name",
        true
      ),
      locationId: text(exception.location_id, "exceptions.location_id", true),
      department:
        text(exception.department, "exceptions.department") || undefined,
      position: text(exception.position, "exceptions.position") || undefined,
      type: text(exception.type, "exceptions.type", true),
      severity: text(exception.severity, "exceptions.severity", true),
      detail: text(exception.detail, "exceptions.detail", true),
    })),
    fetchedAt: new Date().toISOString(),
  }
}

/** Internal's GET /api/v1/hr/dashboard/overview read model. */
export async function fetchHrDashboardOverview(
  locationId = "",
  signal?: AbortSignal
): Promise<HrDashboardOverview> {
  const path = `/v1/hr/dashboard/overview${qs({ location_id: locationId || undefined })}`
  const payload = await api.get<unknown>(path, apiOptions(signal))
  // A single object, not a row list — checked as a one-element "list" so it
  // shares the same never-throwing reporter as everything else here.
  checkContract(HrDashboardOverviewPayload, [payload], path)
  return dashboardFromApi(payload)
}

/** Internal's GET /api/v1/hr/workforce/today read model. */
export async function fetchHrWorkforceToday(
  locationId = "",
  date: DayKey = todayKey(),
  signal?: AbortSignal
): Promise<HrWorkforceToday> {
  const path = `/v1/hr/workforce/today${qs({ date, location_id: locationId || undefined })}`
  const payload = await api.get<unknown>(path, apiOptions(signal))
  checkContract(HrWorkforceTodayPayload, [payload], path)
  const body =
    typeof payload === "object" && payload !== null
      ? (payload as Record<string, unknown>)
      : undefined
  const stores = body?.stores
  if (Array.isArray(stores)) {
    checkContract(HrStoreCoverageRow, stores, `${path}#stores`)
  }
  const exceptions = body?.exceptions
  if (Array.isArray(exceptions)) {
    checkContract(HrWorkforceExceptionRow, exceptions, `${path}#exceptions`)
  }
  return workforceFromApi(payload)
}

export function useHrDashboardOverview(locationId = "") {
  return useDomainQuery(hrQueries.dashboard(locationId))
}

export function useHrWorkforceToday(
  locationId = "",
  date: DayKey = todayKey()
) {
  return useDomainQuery(hrQueries.workforce(locationId, date))
}

/** Internal's GET /api/v1/hr/employees read model. */
export async function fetchHrEmployees(
  query: {
    locationId?: string
    department?: string
    status?: string
    search?: string
    limit?: number
  } = {},
  signal?: AbortSignal
): Promise<{ items: HrEmployee[]; total: number }> {
  const path = `/v1/hr/employees${qs({
    location_id: query.locationId,
    department: query.department,
    status: query.status,
    search: query.search,
    limit: query.limit,
  })}`
  const payload = await api.get<unknown>(path, apiOptions(signal))
  return employeesFromApi(payload, path)
}

export function useHrEmployees(
  query: {
    locationId?: string
    department?: string
    status?: string
    search?: string
    limit?: number
  } = {},
  enabled = true
) {
  return useDomainQuery({
    ...hrQueries.employees(query),
    enabled,
    placeholderData: keepPreviousData,
  })
}

/** Internal's GET /api/v1/hr/employees/{id} read model. */
export async function fetchHrEmployee(
  employeeId: string,
  signal?: AbortSignal
): Promise<HrEmployee> {
  const path = `/v1/hr/employees/${encodeURIComponent(employeeId)}`
  const payload = await api.get<unknown>(path, apiOptions(signal))
  return employeeDetailFromApi(payload)
}

export function useHrEmployee(employeeId: string | undefined) {
  return useDomainQuery(hrQueries.employee(employeeId))
}

/** Internal's GET /api/v1/hr/employees/{id}/documents read model. */
export async function fetchHrEmployeeDocuments(
  employeeId: string,
  signal?: AbortSignal
): Promise<HrEmployeeDocument[]> {
  const path = `/v1/hr/employees/${encodeURIComponent(employeeId)}/documents`
  const payload = await api.get<unknown>(path, apiOptions(signal))
  return documentsFromApi(payload)
}

export function useHrEmployeeDocuments(employeeId: string | undefined) {
  return useDomainQuery(hrQueries.employeeDocuments(employeeId))
}

/** Internal's GET /api/v1/hr/attendance read model. */
export async function fetchHrAttendance(
  query: {
    employeeId?: string
    locationId?: string
    dateFrom?: DayKey
    dateTo?: DayKey
    status?: string
    limit?: number
  } = {},
  signal?: AbortSignal
): Promise<{ items: HrAttendanceRecord[]; total: number }> {
  const path = `/v1/hr/attendance${qs({
    employee_id: query.employeeId,
    location_id: query.locationId,
    date_from: query.dateFrom,
    date_to: query.dateTo,
    status: query.status,
    limit: query.limit,
  })}`
  const payload = await api.get<unknown>(path, apiOptions(signal))
  return attendanceFromApi(payload, path)
}

export function useHrAttendance(
  query: {
    employeeId?: string
    locationId?: string
    dateFrom?: DayKey
    dateTo?: DayKey
    status?: string
    limit?: number
  } = {},
  enabled = true
) {
  const { limit = 200, ...rest } = query
  return useDomainQuery({
    ...hrQueries.attendance({ ...rest, limit }),
    enabled,
    placeholderData: keepPreviousData,
  })
}

/** Internal's GET /api/v1/hr/attendance/summary/{employeeId}/{month}. */
export async function fetchHrAttendanceSummary(
  employeeId: string,
  month: string,
  signal?: AbortSignal
): Promise<{
  employeeId: string
  month: string
  totalPresent: number
  totalAbsent: number
  totalLate: number
  totalLeave: number
  totalOvertimeHours: number
  workingDays: number
}> {
  const path = `/v1/hr/attendance/summary/${encodeURIComponent(employeeId)}/${encodeURIComponent(month)}`
  const payload = await api.get<unknown>(path, apiOptions(signal))
  // Static route shape — employeeId and month both live in the URL.
  checkContract(
    HrAttendanceSummaryPayload,
    [payload],
    "/v1/hr/attendance/summary/:employeeId/:month"
  )
  const body = asRecord(payload, "attendance summary")
  return {
    employeeId: text(body.employee_id, "employee_id", true),
    month: text(body.month, "month", true),
    totalPresent: count(body.total_present, "total_present"),
    totalAbsent: count(body.total_absent, "total_absent"),
    totalLate: count(body.total_late, "total_late"),
    totalLeave: count(body.total_leave, "total_leave"),
    totalOvertimeHours: decimal(
      body.total_overtime_hours,
      "total_overtime_hours"
    ),
    workingDays: count(body.working_days, "working_days"),
  }
}

/** Internal's GET /api/v1/hr/leave read model (a bare array). */
export async function fetchHrLeaveRequests(
  query: { employeeId?: string; status?: string } = {},
  signal?: AbortSignal
): Promise<HrLeaveRequest[]> {
  const path = `/v1/hr/leave${qs({
    employee_id: query.employeeId,
    status: query.status,
  })}`
  const payload = await api.get<unknown>(path, apiOptions(signal))
  const rows = list(payload, "leave")
  checkContract(HrLeaveRequestRow, rows, path)
  return rows.map(leaveFromApi)
}

export function useHrLeaveRequests(
  query: { employeeId?: string; status?: string } = {},
  enabled = true
) {
  return useDomainQuery({
    ...hrQueries.leave(query),
    enabled,
    placeholderData: keepPreviousData,
  })
}

/** Internal's GET /api/v1/hr/leave/balance/{employeeId} read model. */
export async function fetchHrLeaveBalances(
  employeeId: string,
  year?: number,
  signal?: AbortSignal
): Promise<HrLeaveBalance[]> {
  const path = `/v1/hr/leave/balance/${encodeURIComponent(employeeId)}${qs({ year })}`
  const payload = await api.get<unknown>(path, apiOptions(signal))
  const rows = list(payload, "leave balances")
  // Static route shape — employeeId lives in the URL, not in the label.
  checkContract(HrLeaveBalanceRow, rows, "/v1/hr/leave/balance/:employeeId")
  return rows.map((raw, index) => ({
    employeeId: text(
      raw.employee_id,
      `leave balances[${index}].employee_id`,
      true
    ),
    leaveType: text(
      raw.leave_type,
      `leave balances[${index}].leave_type`,
      true
    ),
    year: count(raw.year, `leave balances[${index}].year`),
    entitlement: count(raw.entitlement, `leave balances[${index}].entitlement`),
    used: count(raw.used, `leave balances[${index}].used`),
    remaining: count(raw.remaining, `leave balances[${index}].remaining`),
  }))
}

/** Internal's GET /api/v1/hr/shifts read model. */
export async function fetchHrShifts(
  locationId = "",
  signal?: AbortSignal
): Promise<HrShift[]> {
  const path = `/v1/hr/shifts${qs({ location_id: locationId || undefined })}`
  const payload = await api.get<unknown>(path, apiOptions(signal))
  return shiftsFromApi(payload, path)
}

export function useHrShifts(locationId = "", enabled = true) {
  return useDomainQuery({ ...hrQueries.shifts(locationId), enabled })
}

/** Internal's GET /api/v1/hr/reimbursements read model (a bare array). */
export async function fetchHrReimbursements(
  query: { employeeId?: string; status?: string } = {},
  signal?: AbortSignal
): Promise<HrReimbursement[]> {
  const path = `/v1/hr/reimbursements${qs({
    employee_id: query.employeeId,
    status: query.status,
  })}`
  const payload = await api.get<unknown>(path, apiOptions(signal))
  return reimbursementsFromApi(payload, path)
}

export function useHrReimbursements(
  query: { employeeId?: string; status?: string } = {},
  enabled = true
) {
  return useDomainQuery({
    ...hrQueries.reimbursements(query),
    enabled,
    placeholderData: keepPreviousData,
  })
}

/** Internal's GET /api/v1/hr/holidays read model (a bare array). */
export async function fetchHrHolidays(
  locationId = "",
  signal?: AbortSignal
): Promise<HrHoliday[]> {
  const path = `/v1/hr/holidays${qs({ location_id: locationId || undefined })}`
  const payload = await api.get<unknown>(path, apiOptions(signal))
  return holidaysFromApi(payload, path)
}

export function useHrHolidays(locationId = "", enabled = true) {
  return useDomainQuery({ ...hrQueries.holidays(locationId), enabled })
}
