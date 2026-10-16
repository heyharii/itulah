import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query"

import { node } from "@/lib/api"
import type {
  Advance,
  AdvanceDocument,
  AdvancePage,
  AdvanceReconciliationRow,
  BalanceSheet,
  ControlRow,
  FinanceCloseReadiness,
  FinancingFacility,
  FinancingFacilityDocument,
  PrepaidAllocationRun,
  PrepaidSchedule,
  PrepaidScheduleDocument,
  PrepaidSchedulePage,
  Principal,
  PrincipalDocument,
  ProfitAndLoss,
  SaleDayPage,
  TaxPeriod,
  TaxPeriodDocument,
  TaxReconciliationRow,
  TaxType,
  UnitResult,
} from "@itulah/contract"

/// The five subledgers and the control layer above them.
///
/// One file rather than five: every one of these is the same shape — a list, a
/// document, and a control reading — and splitting them by domain would spread
/// six lines each across five files that import the same helper.

function search(params: Record<string, string | number | boolean | undefined>) {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") query.set(key, String(value))
  }
  const rendered = query.toString()
  return rendered ? `?${rendered}` : ""
}

export const domainKeys = {
  prepaidSchedules: (site?: string, status?: string) =>
    ["finance", "prepaid", "schedules", site ?? null, status ?? null] as const,
  prepaidSchedule: (id: string) =>
    ["finance", "prepaid", "schedule", id] as const,
  taxTypes: () => ["finance", "tax", "types"] as const,
  taxPeriods: (taxType?: string, year?: number) =>
    ["finance", "tax", "periods", taxType ?? null, year ?? null] as const,
  taxPeriod: (id: string) => ["finance", "tax", "period", id] as const,
  taxReconciliation: (year?: number) =>
    ["finance", "tax", "reconciliation", year ?? null] as const,
  advances: (site?: string, status?: string) =>
    ["finance", "advances", site ?? null, status ?? null] as const,
  advance: (id: string) => ["finance", "advance", id] as const,
  advanceControl: () => ["finance", "advances", "control"] as const,
  principals: () => ["finance", "principals"] as const,
  principal: (id: string) => ["finance", "principal", id] as const,
  facilities: (status?: string) =>
    ["finance", "facilities", status ?? null] as const,
  facility: (id: string) => ["finance", "facility", id] as const,
  controls: (asOf?: string) => ["finance", "controls", asOf ?? null] as const,
  closeReadiness: (year: number, month: number) =>
    ["finance", "close", year, month] as const,
  balanceSheet: (asOf?: string, unit?: string) =>
    ["finance", "balance-sheet", asOf ?? null, unit ?? null] as const,
  profitAndLoss: (from: string, to: string, unit?: string) =>
    ["finance", "profit-and-loss", from, to, unit ?? null] as const,
  unitResults: (from: string, to: string) =>
    ["finance", "unit-results", from, to] as const,
  saleDays: (from: string, to: string, site?: string) =>
    ["finance", "sale-days", from, to, site ?? null] as const,
}

// ── prepaid ────────────────────────────────────────────────────────────────

export function listPrepaidSchedules(
  signal?: AbortSignal,
  options: { site?: string; status?: string; limit?: number } = {}
): Promise<PrepaidSchedule[]> {
  return node.get<PrepaidSchedule[]>(
    `/api/v1/finance/prepaid/schedules${search(options)}`,
    { signal }
  )
}

/// The same schedules a keyset page at a time, newest first, with the card
/// figures computed over every schedule the filters match. `period` is any
/// day in the month whose due schedules are counted into `due_in_period`.
///
/// A sibling rather than a change to `listPrepaidSchedules`: the route answers
/// the bare array to a plain ask, and the envelope only to `paged=true`.
export function prepaidSchedulePage(
  options: {
    site?: string
    status?: string
    period?: string
    cursor?: string
    limit?: number
  } = {},
  signal?: AbortSignal
): Promise<PrepaidSchedulePage> {
  return node.get<PrepaidSchedulePage>(
    `/api/v1/finance/prepaid/schedules${search({ paged: true, ...options })}`,
    { signal }
  )
}

/// The schedules a page at a time, newest first, under one status filter
/// (none is every status). The cards read the server's figures over every
/// schedule the filter matches, never a sum of the pages loaded.
export const prepaidSchedulePagesQuery = (status?: string) =>
  infiniteQueryOptions({
    queryKey: [...domainKeys.prepaidSchedules(undefined, status), "pages"],
    queryFn: ({ pageParam, signal }) =>
      prepaidSchedulePage({ status, cursor: pageParam, limit: 100 }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  })

/// How many are due in a month (`YYYY-MM`), asked separately so picking a month
/// re-asks one small question rather than reloading the list.
export const prepaidDueQuery = (status: string | undefined, month: string) =>
  queryOptions({
    queryKey: [...domainKeys.prepaidSchedules(undefined, status), "due", month],
    queryFn: ({ signal }) =>
      prepaidSchedulePage({ status, period: `${month}-01`, limit: 1 }, signal),
  })

export function readPrepaidSchedule(
  id: string,
  signal?: AbortSignal
): Promise<PrepaidScheduleDocument> {
  return node.get<PrepaidScheduleDocument>(
    `/api/v1/finance/prepaid/schedules/${id}`,
    { signal }
  )
}

/// Post one month of every schedule that covers it. Repeatable: a month already
/// posted is reported, not refused.
export function allocatePrepaidMonth(
  body: { year: number; month: number; site_id?: string },
  signal?: AbortSignal
): Promise<PrepaidAllocationRun> {
  return node.post<PrepaidAllocationRun>(
    "/api/v1/finance/prepaid/allocate",
    body,
    {
      signal,
    }
  )
}

// ── tax ────────────────────────────────────────────────────────────────────

export function listTaxTypes(signal?: AbortSignal): Promise<TaxType[]> {
  return node.get<TaxType[]>("/api/v1/finance/tax/types", { signal })
}

export function listTaxPeriods(
  signal?: AbortSignal,
  options: { tax_type?: string; year?: number; limit?: number } = {}
): Promise<TaxPeriod[]> {
  return node.get<TaxPeriod[]>(
    `/api/v1/finance/tax/periods${search(options)}`,
    {
      signal,
    }
  )
}

/// Every tax period, whatever its status — the screen filters them.
export const taxPeriodsQuery = () =>
  queryOptions({
    queryKey: domainKeys.taxPeriods(),
    queryFn: ({ signal }) => listTaxPeriods(signal),
  })

export function readTaxPeriod(
  id: string,
  signal?: AbortSignal
): Promise<TaxPeriodDocument> {
  return node.get<TaxPeriodDocument>(`/api/v1/finance/tax/periods/${id}`, {
    signal,
  })
}

export function taxReconciliation(
  signal?: AbortSignal,
  options: { year?: number } = {}
): Promise<TaxReconciliationRow[]> {
  return node.get<TaxReconciliationRow[]>(
    `/api/v1/finance/tax/reconciliation${search(options)}`,
    { signal }
  )
}

/// What the tax periods say against what the ledger says, per tax.
export const taxReconciliationQuery = () =>
  queryOptions({
    queryKey: domainKeys.taxReconciliation(),
    queryFn: ({ signal }) => taxReconciliation(signal),
  })

// ── advances ───────────────────────────────────────────────────────────────

export function listAdvances(
  signal?: AbortSignal,
  options: { site?: string; status?: string; limit?: number } = {}
): Promise<Advance[]> {
  return node.get<Advance[]>(`/api/v1/finance/advances${search(options)}`, {
    signal,
  })
}

/// The same advances a keyset page at a time, newest first, with the card
/// figures computed over the whole book rather than over the page.
///
/// A sibling rather than a change to `listAdvances`: the route answers the
/// bare array to a plain ask, and the envelope only to `paged=true`.
export function advancePage(
  options: {
    site?: string
    status?: string
    cursor?: string
    limit?: number
  } = {},
  signal?: AbortSignal
): Promise<AdvancePage> {
  return node.get<AdvancePage>(
    `/api/v1/finance/advances${search({ paged: true, ...options })}`,
    { signal }
  )
}

/// Pay an approved advance out — an employee's loan among them — from a
/// drawer (`petty_cash`, in the advance's own unit) or one of head office's
/// bank accounts (`bank_giro`/`bank_savings`, qualified by its bank code).
export function payAdvance(
  id: string,
  body: { posting_date: string; cash_key: string; cash_qualifier: string }
): Promise<unknown> {
  return node.post<unknown>(`/api/v1/finance/advances/${id}/pay`, body)
}

export function readAdvance(
  id: string,
  signal?: AbortSignal
): Promise<AdvanceDocument> {
  return node.get<AdvanceDocument>(`/api/v1/finance/advances/${id}`, { signal })
}

export function advanceControl(
  signal?: AbortSignal
): Promise<AdvanceReconciliationRow[]> {
  return node.get<AdvanceReconciliationRow[]>(
    "/api/v1/finance/advances/reconciliation",
    { signal }
  )
}

/// The advances a page at a time, newest first, under one status filter (none
/// is every status). The cards read the server's figures over the whole book,
/// never a sum of the pages loaded.
export const advancePagesQuery = (status?: string) =>
  infiniteQueryOptions({
    queryKey: [...domainKeys.advances(undefined, status), "pages"],
    queryFn: ({ pageParam, signal }) =>
      advancePage({ status, cursor: pageParam, limit: 100 }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  })

/// What the advances say against what the ledger says, per account.
export const advanceControlQuery = () =>
  queryOptions({
    queryKey: domainKeys.advanceControl(),
    queryFn: ({ signal }) => advanceControl(signal),
  })

// ── owners ─────────────────────────────────────────────────────────────────

export function listPrincipals(signal?: AbortSignal): Promise<Principal[]> {
  return node.get<Principal[]>("/api/v1/finance/principals", { signal })
}

/// The owners and investors, with the equity each has put in.
export const principalsQuery = () =>
  queryOptions({
    queryKey: domainKeys.principals(),
    queryFn: ({ signal }) => listPrincipals(signal),
  })

export function readPrincipal(
  id: string,
  signal?: AbortSignal
): Promise<PrincipalDocument> {
  return node.get<PrincipalDocument>(`/api/v1/finance/principals/${id}`, {
    signal,
  })
}

// ── financing ──────────────────────────────────────────────────────────────

export function listFacilities(
  signal?: AbortSignal,
  options: { status?: string } = {}
): Promise<FinancingFacility[]> {
  return node.get<FinancingFacility[]>(
    `/api/v1/finance/facilities${search(options)}`,
    { signal }
  )
}

/// Every financing facility: the loans and leases, with what is still owed.
export const facilitiesQuery = () =>
  queryOptions({
    queryKey: domainKeys.facilities(),
    queryFn: ({ signal }) => listFacilities(signal),
  })

export function readFacility(
  id: string,
  signal?: AbortSignal
): Promise<FinancingFacilityDocument> {
  return node.get<FinancingFacilityDocument>(
    `/api/v1/finance/facilities/${id}`,
    {
      signal,
    }
  )
}

// ── control and close ──────────────────────────────────────────────────────

export function financeControls(
  signal?: AbortSignal,
  options: { as_of?: string } = {}
): Promise<ControlRow[]> {
  return node.get<ControlRow[]>(`/api/v1/finance/controls${search(options)}`, {
    signal,
  })
}

export function closeReadiness(
  year: number,
  month: number,
  signal?: AbortSignal
): Promise<FinanceCloseReadiness> {
  return node.get<FinanceCloseReadiness>(
    `/api/v1/finance/close/readiness${search({ year, month })}`,
    { signal }
  )
}

/// What stands between a month and being shut. A month with no period reads
/// as `NONE` rather than failing, so any month the picker can make is safe.
export const closeReadinessQuery = (year: number, month: number) =>
  queryOptions({
    queryKey: domainKeys.closeReadiness(year, month),
    queryFn: ({ signal }) => closeReadiness(year, month, signal),
  })

/// Every subledger beside the ledger account that controls it.
export const financeControlsQuery = () =>
  queryOptions({
    queryKey: domainKeys.controls(),
    queryFn: ({ signal }) => financeControls(signal),
  })

export function softCloseMonth(
  body: { year: number; month: number },
  signal?: AbortSignal
): Promise<FinanceCloseReadiness> {
  return node.post<FinanceCloseReadiness>("/api/v1/finance/close/soft", body, {
    signal,
  })
}

// ── statements ─────────────────────────────────────────────────────────────

/// The position, in one unit's books when `unit` names one and the company's
/// when it does not.
export function balanceSheet(
  signal?: AbortSignal,
  options: { as_of?: string; unit?: string } = {}
): Promise<BalanceSheet> {
  return node.get<BalanceSheet>(
    `/api/v1/finance/reports/balance-sheet${search(options)}`,
    { signal }
  )
}

/// The result over a window, narrowed to one unit's books the same way.
export function profitAndLoss(
  from: string,
  to: string,
  signal?: AbortSignal,
  options: { unit?: string } = {}
): Promise<ProfitAndLoss> {
  return node.get<ProfitAndLoss>(
    `/api/v1/finance/reports/profit-and-loss${search({ from, to, ...options })}`,
    { signal }
  )
}

/// Which trading days took money, and how many of them are in the book.
///
/// Asked for one row only: the totals the envelope carries — posted, unposted,
/// and the takings not yet in the ledger — cover every day the scope matches,
/// not the page, so a summary has no use for the rows themselves.
export function saleDayTotals(
  from: string,
  to: string,
  signal?: AbortSignal,
  options: { site?: string } = {}
): Promise<SaleDayPage> {
  return node.get<SaleDayPage>(
    `/api/v1/finance/sale-days${search({ from, to, limit: 1, ...options })}`,
    { signal }
  )
}

/// One row per unit — head office and each store, with its client code and
/// name — whose sum is the company's result.
export function unitResults(
  from: string,
  to: string,
  signal?: AbortSignal
): Promise<UnitResult[]> {
  return node.get<UnitResult[]>(
    `/api/v1/finance/reports/unit-results${search({ from, to })}`,
    { signal }
  )
}

/// The result over a window, as the Overview's charts, the Profit and Loss
/// report and the by-unit report read it: one read per window, under one key.
export const profitAndLossQuery = (from: string, to: string, unit?: string) =>
  queryOptions({
    queryKey: domainKeys.profitAndLoss(from, to, unit),
    queryFn: ({ signal }) => profitAndLoss(from, to, signal, { unit }),
  })
