/**
 * Finance read boundary for Slowdown.
 *
 * Payables, the posted P&L, and the posted cash-flow statement are read from
 * Internal's relational accounting resources; this module never caches or
 * writes a local mirror. Payroll and store expense claims have different
 * server contracts and remain explicitly preview-gated by the screen.
 */

import type { Invoice, Payment } from "@/components/finance/data"
import type { Supplier } from "@/components/sourcing/catalogue"
import { api, checkContract, qs, useDomainQuery, type ApiRequestOptions, type ApiResource } from "@/lib/api"
import { todayKey, type DayKey } from "@/lib/day"
import {
  CashFlowLineRow,
  CashFlowPayload,
  FinanceReimbursementLineRow,
  FinanceReimbursementRow,
  InvoiceRow,
  PaymentRow,
  PnLAccountRow,
  PnLPayload,
  SupplierRow,
} from "./contracts"
import { financeQueries } from "./queries"

export interface FinancePnLAccount {
  accountId: string
  code: string
  name: string
  amount: number
}

export interface FinancePnLSection {
  label: string
  accounts: FinancePnLAccount[]
  total: number
}

/** Posted accounting P&L for the current month. Amounts are IDR. */
export interface FinancePnL {
  periodFrom: DayKey
  periodTo: DayKey
  revenue: FinancePnLSection
  expenses: FinancePnLSection
  netIncome: number
}

export interface FinanceCashFlowLine {
  accountId: string
  accountCode: string
  accountName: string
  amount: number
}

export interface FinanceCashFlowSection {
  label: string
  lines: FinanceCashFlowLine[]
  total: number
}

/** Posted indirect cash-flow statement for the current month. Amounts are IDR. */
export interface FinanceCashFlow {
  dateFrom: DayKey
  dateTo: DayKey
  netIncome: number
  operating: FinanceCashFlowSection
  investing: FinanceCashFlowSection
  financing: FinanceCashFlowSection
  openingCash: number
  closingCash: number
  netCashChange: number
}

export interface FinanceResource {
  suppliers: Supplier[]
  invoices: Invoice[]
  payments: Payment[]
  pnl?: FinancePnL
  cashFlow?: FinanceCashFlow
  fetchedAt: string
}

/** Reimbursement rows returned by Internal's HR reimbursement resource. */
export interface FinanceReimbursementLine {
  id: string
  expenseDate: DayKey
  description: string
  amount: number
  locationId?: string
}

export interface FinanceReimbursement {
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
  lines: FinanceReimbursementLine[]
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined
}

function text(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value.trim() || fallback
  if (typeof value === "number" || typeof value === "boolean")
    return String(value)
  return fallback
}

function number(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return fallback
}

function day(value: unknown): DayKey {
  const raw = text(value)
  return raw.slice(0, 10) || todayKey()
}

function list<T>(payload: unknown, keys: string[]): T[] {
  if (Array.isArray(payload)) return payload as T[]
  const body = record(payload)
  if (!body) return []
  for (const key of keys) {
    if (Array.isArray(body[key])) return body[key] as T[]
  }
  return []
}

function currentMonthRange(): { date_from: DayKey; date_to: DayKey } {
  const dateTo = todayKey()
  return { date_from: `${dateTo.slice(0, 7)}-01`, date_to: dateTo }
}

function pnlSection(
  value: unknown,
  fallbackLabel: string,
  path: string
): FinancePnLSection {
  const raw = record(value)
  const rows = list<PnLAccountRow>(raw, ["accounts", "items"])
  checkContract(PnLAccountRow, rows, path)
  const accounts = rows
    .map((account) => ({
      accountId: text(account.account_id),
      code: text(account.code),
      name: text(account.name),
      amount: number(account.amount),
    }))
    .filter((account) => account.accountId || account.code || account.name)

  return {
    label: text(raw?.label, fallbackLabel),
    accounts,
    total: number(raw?.total),
  }
}

function pnlFromApi(payload: unknown, path: string): FinancePnL | undefined {
  // `payload` is `undefined` whenever the report request itself failed or was
  // skipped (see the `.catch(() => undefined)` at the call site) — that is a
  // normal, permission-gated absence, not a contract violation, so it is not
  // reported as one.
  if (payload !== undefined) checkContract(PnLPayload, [payload], path)
  const raw = record(payload) as PnLPayload | undefined
  if (!raw) return undefined
  const periodFrom = text(raw.period_from)
  const periodTo = text(raw.period_to)
  if (!periodFrom || !periodTo || !record(raw.revenue) || !record(raw.expenses))
    return undefined
  return {
    periodFrom,
    periodTo,
    revenue: pnlSection(raw.revenue, "Revenue", `${path}#revenue`),
    expenses: pnlSection(raw.expenses, "Expenses", `${path}#expenses`),
    netIncome: number(raw.net_income),
  }
}

function cashFlowSection(
  value: unknown,
  fallbackLabel: string,
  path: string
): FinanceCashFlowSection {
  const raw = record(value)
  const rows = list<CashFlowLineRow>(raw, ["lines", "items"])
  checkContract(CashFlowLineRow, rows, path)
  const lines = rows
    .map((line) => ({
      accountId: text(line.account_id),
      accountCode: text(line.account_code),
      accountName: text(line.account_name),
      amount: number(line.amount),
    }))
    .filter((line) => line.accountId || line.accountCode || line.accountName)
  return {
    label: text(raw?.label, fallbackLabel),
    lines,
    total: number(raw?.total),
  }
}

function cashFlowFromApi(
  payload: unknown,
  path: string
): FinanceCashFlow | undefined {
  // Same reasoning as `pnlFromApi`: `undefined` here means the report call
  // failed or was skipped, not that the response violated its shape.
  if (payload !== undefined) checkContract(CashFlowPayload, [payload], path)
  const raw = record(payload) as CashFlowPayload | undefined
  if (!raw) return undefined
  const dateFrom = text(raw.date_from)
  const dateTo = text(raw.date_to)
  if (
    !dateFrom ||
    !dateTo ||
    !record(raw.operating) ||
    !record(raw.investing) ||
    !record(raw.financing)
  ) {
    return undefined
  }
  return {
    dateFrom,
    dateTo,
    netIncome: number(raw.net_income),
    operating: cashFlowSection(raw.operating, "Operating Activities", `${path}#operating`),
    investing: cashFlowSection(raw.investing, "Investing Activities", `${path}#investing`),
    financing: cashFlowSection(raw.financing, "Financing Activities", `${path}#financing`),
    openingCash: number(raw.opening_cash),
    closingCash: number(raw.closing_cash),
    netCashChange: number(raw.net_cash_change),
  }
}

const HUES = [
  "#7b5cfa",
  "#0086fc",
  "#00c978",
  "#ff58ae",
  "#ffbb26",
  "#64c6ff",
  "#ff3e00",
]

function hueFor(id: string): string {
  let hash = 0
  for (let i = 0; i < id.length; i += 1)
    hash = (hash * 31 + id.charCodeAt(i)) | 0
  return HUES[Math.abs(hash) % HUES.length]
}

function supplierFromApi(raw: SupplierRow): Supplier | null {
  const id = text(raw.supplier_id)
  const name = text(raw.name)
  if (!id || !name) return null
  const division =
    text(raw.division_name) ||
    text(raw.primary_division) ||
    text(record(raw.primary_division)?.name) ||
    "Unassigned"
  return {
    id,
    name,
    division,
    country: text(raw.country, "—"),
    hue: hueFor(id),
  }
}

function invoiceFromApi(raw: InvoiceRow): Invoice | null {
  const id = text(raw.id)
  const supplierId = text(raw.party_id)
  if (!id || !supplierId) return null
  return {
    id,
    number: text(raw.invoice_number, id),
    supplierId,
    issuedOn: day(raw.posting_date),
    dueOn: day(raw.due_date),
    amount: Math.max(0, number(raw.total_amount)),
    poRef: text(raw.purchase_order_id) || undefined,
    // Internal does not expose receipt matching on the invoice list contract;
    // leave it unknown instead of manufacturing a fully-received signal.
  }
}

function paymentMethod(value: unknown): Payment["method"] {
  switch (text(value).toLowerCase()) {
    case "cash":
      return "cash"
    case "giro":
    case "cheque":
      return "cheque"
    default:
      return "transfer"
  }
}

function paymentFromApi(raw: PaymentRow, invoices: Invoice[]): Payment | null {
  const id = text(raw.id)
  const invoice = invoices.find((item) => item.id === text(raw.invoice_id))
  const supplierId = text(raw.counterparty_id) || invoice?.supplierId
  if (!id || !supplierId) return null
  return {
    id,
    supplierId,
    at: day(raw.payment_date),
    amount: Math.max(0, number(raw.amount)),
    method: paymentMethod(raw.method),
    reference: text(raw.reference) || text(raw.payment_number, id),
  }
}

function reimbursementLineFromApi(
  raw: unknown
): FinanceReimbursementLine | null {
  const row = record(raw)
  if (!row) return null
  const id = text(row.id)
  const expenseDate = day(row.expense_date)
  if (!id || !expenseDate) return null
  return {
    id,
    expenseDate,
    description: text(row.description, "Unspecified expense"),
    amount: Math.max(0, number(row.amount)),
    locationId: text(row.location_id) || undefined,
  }
}

function reimbursementFromApi(
  raw: unknown,
  path: string
): FinanceReimbursement | null {
  const row = record(raw)
  if (!row) return null
  const id = text(row.id)
  const employeeId = text(row.employee_id)
  const createdAt = text(row.created_at)
  if (!id || !employeeId || !createdAt) return null
  const lineRows = list<unknown>(row.lines, ["items"])
  checkContract(FinanceReimbursementLineRow, lineRows, `${path}#lines`)
  return {
    id,
    employeeId,
    reimbursementType: text(row.reimbursement_type, "general"),
    submittedAt: text(row.submitted_at) || undefined,
    approvedAt: text(row.approved_at) || undefined,
    approvedBy: text(row.approved_by) || undefined,
    paidAt: text(row.paid_at) || undefined,
    status: text(row.status, "draft"),
    totalAmount: Math.max(0, number(row.total_amount)),
    notes: text(row.notes) || undefined,
    journalEntryId: text(row.journal_entry_id) || undefined,
    advanceOffset: Math.max(0, number(row.advance_offset)),
    createdAt,
    lines: lineRows
      .map(reimbursementLineFromApi)
      .filter((line): line is FinanceReimbursementLine => Boolean(line)),
  }
}

function apiOptions(signal?: AbortSignal): ApiRequestOptions | undefined {
  return signal ? { signal } : undefined
}

export async function fetchFinanceResource(
  signal?: AbortSignal
): Promise<FinanceResource> {
  const options = apiOptions(signal)
  const range = currentMonthRange()
  const supplierPath = `/v1/masterdata/suppliers${qs({ limit: 200 })}`
  const invoicePath = `/v1/finance/invoices${qs({ invoice_type: "payable", limit: 200 })}`
  const paymentPath = `/v1/finance/payments${qs({ status: "recorded", limit: 200 })}`
  const [supplierPayload, invoicePayload, paymentPayload] = await Promise.all([
    api.get<unknown>(supplierPath, options),
    api.get<unknown>(invoicePath, options),
    // Void is represented as a reversal in Internal's payable settlement
    // table; excluding it here prevents a voided payment from reducing debt.
    api.get<unknown>(paymentPath, options),
  ])

  // Reports are optional for this screen: a caller without GL report access
  // must still be able to see live AP data. Never replace a failed report with
  // the old fixture-based revenue/cash values.
  const pnlPath = `/v1/accounting/reports/profit-and-loss${qs(range)}`
  const cashFlowPath = `/v1/accounting/reports/cash-flow${qs(range)}`
  const [pnlPayload, cashFlowPayload] = await Promise.all([
    api.get<unknown>(pnlPath, options).catch(() => undefined),
    api.get<unknown>(cashFlowPath, options).catch(() => undefined),
  ])

  const invoiceRows = list<InvoiceRow>(invoicePayload, ["invoices", "items", "data"])
  checkContract(InvoiceRow, invoiceRows, invoicePath)
  const invoices = invoiceRows
    .map(invoiceFromApi)
    .filter((invoice): invoice is Invoice => Boolean(invoice))
  const paymentRows = list<PaymentRow>(paymentPayload, ["items", "payments", "data"])
  checkContract(PaymentRow, paymentRows, paymentPath)
  const payments = paymentRows
    .map((payment) => paymentFromApi(payment, invoices))
    .filter((payment): payment is Payment => Boolean(payment))

  const supplierRows = list<SupplierRow>(supplierPayload, ["items", "suppliers", "data"])
  checkContract(SupplierRow, supplierRows, supplierPath)
  const supplierMap = new Map<string, Supplier>()
  for (const raw of supplierRows) {
    const supplier = supplierFromApi(raw)
    if (supplier) supplierMap.set(supplier.id, supplier)
  }

  // Keep a payable visible when the supplier master is eventually consistent;
  // the identity/name still comes from the invoice row, never from a fixture.
  for (const raw of invoiceRows) {
    const id = text(raw.party_id)
    const name = text(raw.party_name, id)
    if (id && !supplierMap.has(id)) {
      supplierMap.set(id, {
        id,
        name,
        division: "Unassigned",
        country: "—",
        hue: hueFor(id),
      })
    }
  }
  for (const payment of payments) {
    if (!supplierMap.has(payment.supplierId)) {
      supplierMap.set(payment.supplierId, {
        id: payment.supplierId,
        name: payment.supplierId,
        division: "Unassigned",
        country: "—",
        hue: hueFor(payment.supplierId),
      })
    }
  }

  return {
    suppliers: [...supplierMap.values()].sort((a, b) =>
      a.name.localeCompare(b.name)
    ),
    invoices,
    payments,
    pnl: pnlFromApi(pnlPayload, pnlPath),
    cashFlow: cashFlowFromApi(cashFlowPayload, cashFlowPath),
    fetchedAt: new Date().toISOString(),
  }
}

/**
 * Internal's GET /api/v1/hr/reimbursements read model.
 *
 * This is deliberately a separate resource from AP/GL: a caller lacking HR
 * claim permission must not make otherwise-available supplier accounting
 * disappear from the Finance screen.
 */
export async function fetchFinanceReimbursements(
  signal?: AbortSignal
): Promise<FinanceReimbursement[]> {
  const path = `/v1/hr/reimbursements${qs({ limit: 200 })}`
  const payload = await api.get<unknown>(path, apiOptions(signal))
  const rows = list<unknown>(payload, ["items", "reimbursements", "data"])
  checkContract(FinanceReimbursementRow, rows, path)
  return rows
    .map((row) => reimbursementFromApi(row, path))
    .filter((row): row is FinanceReimbursement => Boolean(row))
}

/* ---------------------------------------------------------------------------
 * Hooks.
 *
 * Both reads are namespaced under `financeQueries.all()`. Neither request
 * closes over a screen input — the tab and the open supplier filter what has
 * already been fetched — so the keys carry no scope beyond the resource name.
 * A write that lands here should invalidate `financeQueries.all()`.
 */

export function useFinanceResource(): ApiResource<FinanceResource> {
  return useDomainQuery(financeQueries.resource())
}

export function useFinanceReimbursements(): ApiResource<FinanceReimbursement[]> {
  return useDomainQuery(financeQueries.reimbursements())
}
