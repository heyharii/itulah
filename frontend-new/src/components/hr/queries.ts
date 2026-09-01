/**
 * HR query options — the only place an HR cache key exists.
 *
 * One factory for both `hr-ho` (head office) and `hr-store` (a single store
 * manager's screen): the two routes read different *scopes* of the same
 * resources, so the scope is a key segment, not a second key factory. See
 * docs/recipe-domain-conversion.md's note on hr's two routes.
 *
 * `queryOptions` pairs a key with its fetcher and its cache class in one typed
 * object, so the route loaders, the screens and any future mutation all name
 * the same query without repeating it. See docs/frontend-rules.md §Q1.
 */

import { queryOptions } from "@tanstack/react-query"

import { STALE } from "@/lib/api/stale"
import type { DayKey } from "@/lib/day"
import {
  fetchHrAttendance,
  fetchHrDashboardOverview,
  fetchHrEmployee,
  fetchHrEmployeeDocuments,
  fetchHrEmployees,
  fetchHrHolidays,
  fetchHrLeaveRequests,
  fetchHrReimbursements,
  fetchHrShifts,
  fetchHrWorkforceToday,
} from "./api"

export const hrQueries = {
  all: () => ["hr"] as const,

  /**
   * Head-office headcount/leave/overtime counters. Empty `locationId` is HO's
   * estate-wide view; a store passes its own id. These move through the
   * working day the same way the workforce snapshot does, hence `operational`
   * rather than `reference`.
   */
  dashboard: (locationId = "") =>
    queryOptions({
      queryKey: [...hrQueries.all(), "dashboard", locationId] as const,
      queryFn: ({ signal }) => fetchHrDashboardOverview(locationId, signal),
      ...STALE.operational,
    }),

  /** Today's coverage for one store (or the estate, unscoped) — the roster
   * and attendance instruction calls out explicitly as `operational`. */
  workforce: (locationId = "", date: DayKey) =>
    queryOptions({
      queryKey: [...hrQueries.all(), "workforce", locationId, date] as const,
      queryFn: ({ signal }) =>
        fetchHrWorkforceToday(locationId, date, signal),
      ...STALE.operational,
    }),

  /**
   * The employee directory, filtered. Every filter the fetcher closes over —
   * location, department, status, search, limit — is in the key, so hr-ho's
   * estate-wide directory and hr-store's one-location team list are different
   * cache entries even though they call the same fetcher. Employee identity
   * and role are masterdata, not something that moves with the shift, hence
   * `reference`.
   */
  employees: (query: {
    locationId?: string
    department?: string
    status?: string
    search?: string
    limit?: number
  }) =>
    queryOptions({
      queryKey: [
        ...hrQueries.all(),
        "employees",
        query.locationId ?? "",
        query.department ?? "",
        query.status ?? "",
        query.search ?? "",
        query.limit ?? 0,
      ] as const,
      queryFn: ({ signal }) => fetchHrEmployees(query, signal),
      ...STALE.reference,
    }),

  employee: (employeeId: string | undefined) =>
    queryOptions({
      queryKey: [...hrQueries.all(), "employee", employeeId ?? ""] as const,
      queryFn: ({ signal }) => fetchHrEmployee(employeeId ?? "", signal),
      enabled: Boolean(employeeId),
      ...STALE.reference,
    }),

  employeeDocuments: (employeeId: string | undefined) =>
    queryOptions({
      queryKey: [
        ...hrQueries.all(),
        "employee",
        employeeId ?? "",
        "documents",
      ] as const,
      queryFn: ({ signal }) =>
        fetchHrEmployeeDocuments(employeeId ?? "", signal),
      enabled: Boolean(employeeId),
      ...STALE.reference,
    }),

  /** Attendance rows for a window. `dateFrom`/`dateTo` are flat `DayKey`
   * strings, not `Date`s, so the key hashes stably. Today's attendance is
   * explicitly `operational`. */
  attendance: (query: {
    employeeId?: string
    locationId?: string
    dateFrom?: DayKey
    dateTo?: DayKey
    status?: string
    limit?: number
  }) =>
    queryOptions({
      queryKey: [
        ...hrQueries.all(),
        "attendance",
        query.employeeId ?? "",
        query.locationId ?? "",
        query.dateFrom ?? "",
        query.dateTo ?? "",
        query.status ?? "",
        query.limit ?? 0,
      ] as const,
      queryFn: ({ signal }) => fetchHrAttendance(query, signal),
      ...STALE.operational,
    }),

  /** Leave requests — a worklist of pending/approved decisions, so
   * `operational` rather than `reference`. */
  leave: (query: { employeeId?: string; status?: string }) =>
    queryOptions({
      queryKey: [
        ...hrQueries.all(),
        "leave",
        query.employeeId ?? "",
        query.status ?? "",
      ] as const,
      queryFn: ({ signal }) => fetchHrLeaveRequests(query, signal),
      ...STALE.operational,
    }),

  /** The shift-type catalogue (name, start/end, break) — masterdata edited on
   * a change request, not per shift, hence `reference`. */
  shifts: (locationId = "") =>
    queryOptions({
      queryKey: [...hrQueries.all(), "shifts", locationId] as const,
      queryFn: ({ signal }) => fetchHrShifts(locationId, signal),
      ...STALE.reference,
    }),

  /** Reimbursement requests — a worklist, `operational`. */
  reimbursements: (query: { employeeId?: string; status?: string }) =>
    queryOptions({
      queryKey: [
        ...hrQueries.all(),
        "reimbursements",
        query.employeeId ?? "",
        query.status ?? "",
      ] as const,
      queryFn: ({ signal }) => fetchHrReimbursements(query, signal),
      ...STALE.operational,
    }),

  /** Public holidays. Named `reference` explicitly. */
  holidays: (locationId = "") =>
    queryOptions({
      queryKey: [...hrQueries.all(), "holidays", locationId] as const,
      queryFn: ({ signal }) => fetchHrHolidays(locationId, signal),
      ...STALE.reference,
    }),
}
