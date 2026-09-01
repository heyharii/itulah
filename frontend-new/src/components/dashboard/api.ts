/*
 * Supplier directory transport boundary.
 *
 * The dashboard is backed by Internal's masterdata supplier resource.  The
 * adapter maps only fields that the server owns and leaves relationship
 * analytics empty when Internal has no corresponding event stream; it never
 * rehydrates the old local fixture as a persistence fallback.
 */

import type { Supplier } from "@/components/dashboard/data"
import {
  api,
  checkContract,
  qs,
  useDomainQuery,
  type ApiRequestOptions,
} from "@/lib/api"
import { supplierQueries } from "@/components/dashboard/queries"
import { SupplierRow } from "@/components/dashboard/contracts"

export interface ApiSupplier {
  supplier_id?: unknown
  code?: unknown
  name?: unknown
  tax_id?: unknown
  address?: unknown
  notes?: unknown
  status?: unknown
  created_at?: unknown
  updated_at?: unknown
  version?: unknown
  tags?: unknown
  contact_count?: unknown
  has_primary_contact?: unknown
  payment_terms_days?: unknown
  primary_division?: unknown
  total_spend?: unknown
  total_stock?: unknown
  units_sold?: unknown
  incoming_qty?: unknown
  avg_lead_time_days?: unknown
  total_revenue?: unknown
  total_articles?: unknown
  store_spread?: unknown
  history_events?: unknown
}

interface ApiSupplierList {
  items?: unknown
  suppliers?: unknown
  total?: unknown
  count?: unknown
}

function mutationKey(prefix: string): string {
  const token =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `${prefix}-${token}`
}

export interface SupplierDirectory {
  suppliers: Supplier[]
  total: number
  fetchedAt: string
}

export interface SupplierWriteInput {
  code: string
  name: string
  address: string
  status: "active" | "inactive" | "blocked"
  tax_id?: string
  notes?: string
  default_payment_terms_code?: string | null
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string"
    ? value.trim()
    : value == null
      ? fallback
      : String(value)
}

function numberValue(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return fallback
}

function optionalNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => stringValue(item)).filter(Boolean)
}

function listFromPayload(payload: unknown): ApiSupplier[] {
  if (Array.isArray(payload)) return payload as ApiSupplier[]
  const record = asRecord(payload)
  if (!record) return []
  for (const key of ["items", "suppliers", "data"]) {
    if (Array.isArray(record[key])) return record[key] as ApiSupplier[]
  }
  return []
}

function slugCode(name: string): string {
  const slug = name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return (slug || "SUPPLIER").slice(0, 50)
}

/** Exported so mutations.ts can map a write's response the same way a read does (M7). */
export function mapSupplier(raw: ApiSupplier): Supplier | null {
  const id = stringValue(raw.supplier_id)
  const name = stringValue(raw.name)
  if (!id || !name) return null

  // Internal does not expose supplier contact events in this resource.  Do
  // not derive "last seen" from updated_at: editing a record is not contact.
  return {
    id,
    name,
    code: stringValue(raw.code, slugCode(name)),
    address: stringValue(raw.address),
    status: stringValue(raw.status, "active"),
    version: numberValue(raw.version, 0),
    createdAt: stringValue(raw.created_at),
    updatedAt: stringValue(raw.updated_at),
    /* Internal carries no free-form tags on a supplier, so the chips describe
     * what the record actually says: how it is doing, and whether anyone is
     * reachable at it. Those are the two things this table is read for. */
    tags: (() => {
      const chips = stringList(raw.tags)
      if (chips.length) return chips
      const out: string[] = []
      const status = stringValue(raw.status, "active")
      if (status !== "active") out.push(status === "blocked" ? "Blocked" : "Inactive")
      const contacts = Number(raw.contact_count ?? 0)
      if (!raw.has_primary_contact) out.push("No primary contact")
      else if (contacts > 1) out.push(`${contacts} contacts`)
      const terms = Number(raw.payment_terms_days ?? 0)
      if (terms > 0) out.push(`Net ${terms}`)
      return out
    })(),
    days: null,
    strength: "none",
    site: null,
    notes: stringValue(raw.notes) || undefined,
    totalSpend: optionalNumber(raw.total_spend),
    totalStock: optionalNumber(raw.total_stock),
    unitsSold: optionalNumber(raw.units_sold),
    incomingQty: optionalNumber(raw.incoming_qty),
    avgLeadTimeDays:
      raw.avg_lead_time_days == null
        ? null
        : optionalNumber(raw.avg_lead_time_days),
    totalRevenue: optionalNumber(raw.total_revenue),
    totalArticles: optionalNumber(raw.total_articles),
    storeSpread: optionalNumber(raw.store_spread),
    historyEvents: optionalNumber(raw.history_events),
    primaryDivision: stringValue(raw.primary_division) || undefined,
    // Order-volume history is not part of the masterdata response.  Keeping
    // this empty makes the detail panel say so instead of drawing fake bars.
    volume: [],
  }
}

export async function fetchSupplierDirectory(
  signal?: AbortSignal
): Promise<SupplierDirectory> {
  const options: ApiRequestOptions | undefined = signal ? { signal } : undefined
  const payload = await api.get<unknown>(
    `/v1/masterdata/suppliers${qs({ limit: 200})}`,
    options
  )
  const rawSuppliers = listFromPayload(payload)
  checkContract(SupplierRow, rawSuppliers, "/v1/masterdata/suppliers")
  const suppliers = rawSuppliers
    .map(mapSupplier)
    .filter((supplier): supplier is Supplier => Boolean(supplier))
  const record = asRecord(payload) as ApiSupplierList | undefined
  const total = numberValue(record?.total, suppliers.length)
  return { suppliers, total, fetchedAt: new Date().toISOString() }
}

export function useSupplierDirectory() {
  return useDomainQuery(supplierQueries.directory())
}

export async function createDashboardSupplier(
  input: SupplierWriteInput,
  signal?: AbortSignal
) {
  return api.post<unknown>("/v1/masterdata/suppliers", input, {
    headers: { "Idempotency-Key": mutationKey("supplier-create") },
    ...(signal ? { signal } : {}),
  })
}

export async function updateDashboardSupplier(
  id: string,
  input: SupplierWriteInput,
  signal?: AbortSignal
) {
  return api.put<unknown>(
    `/v1/masterdata/suppliers/${encodeURIComponent(id)}`,
    input,
    {
      headers: { "Idempotency-Key": mutationKey("supplier-update") },
      ...(signal ? { signal } : {}),
    }
  )
}

/** Applies the only supported bulk supplier patch: a reversible status change. */
export function bulkUpdateDashboardSuppliers(
  ids: string[],
  status: SupplierWriteInput["status"],
  signal?: AbortSignal
) {
  return api.post<unknown>(
    "/v1/masterdata/suppliers/_bulk_update",
    { ids, patch: { status } },
    {
      headers: { "Idempotency-Key": mutationKey("supplier-bulk-update") },
      ...(signal ? { signal } : {}),
    }
  )
}

export interface SupplierBulkInput {
  ids: string[]
  status: SupplierWriteInput["status"]
}
