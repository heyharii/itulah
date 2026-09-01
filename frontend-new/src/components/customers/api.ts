/*
 * Customer directory transport boundary.
 *
 * Internal's customer admin list is the source of truth for profile and
 * lifetime aggregates.  The 360 payload also carries the read-only loyalty
 * ledger so the detail sheet never has to reconstruct points from purchases.
 */

import type { DayKey } from "@/lib/day"
import {
  api,
  checkContract,
  qs,
  useDomainQuery,
  type ApiRequestOptions,
} from "@/lib/api"
import { customerQueries } from "@/components/customers/queries"
import type { Customer } from "@/components/customers/data"
import {
  CustomerRow,
  LoyaltyBalanceRow,
  LoyaltyTransactionRow,
  PurchaseRow,
  VoucherRow,
} from "@/components/customers/contracts"

interface ApiCustomer {
  customer_id?: unknown
  name?: unknown
  phone?: unknown
  email?: unknown
  tier?: unknown
  points?: unknown
  points_balance?: unknown
  total_spend?: unknown
  lifetime_spend?: unknown
  created_at?: unknown
  updated_at?: unknown
}

interface ApiCustomerList {
  items?: unknown
  total?: unknown
  count?: unknown
}

interface ApiLoyaltyBalance {
  points_balance?: unknown
  tier?: unknown
  tier_progress?: unknown
}

interface ApiPurchase {
  id?: unknown
  store_id?: unknown
  store_name?: unknown
  total?: unknown
  item_count?: unknown
  points_earned?: unknown
  points_used?: unknown
  transaction_at?: unknown
}

interface ApiVoucher {
  id?: unknown
  code?: unknown
  title?: unknown
  description?: unknown
  voucher_type?: unknown
  initial_value?: unknown
  balance?: unknown
  single_use?: unknown
  expires_at?: unknown
  status?: unknown
}

interface ApiLoyaltyTransaction {
  id?: unknown
  type?: unknown
  points?: unknown
  reference?: unknown
  description?: unknown
  created_at?: unknown
}

/** Canonical purchase summary returned by Internal's customer 360 endpoint. */
export interface Customer360Purchase {
  id: string
  storeId: string
  storeName: string
  amount: number
  itemCount: number
  pointsEarned: number
  pointsUsed: number
  at: DayKey
}

/** Canonical voucher summary returned by Internal's customer 360 endpoint. */
export interface Customer360Voucher {
  id: string
  code: string
  title: string
  description: string
  voucherType: string
  value: number
  balance: number
  singleUse: boolean
  expiresOn: DayKey
  status: string
}

/** One immutable points movement returned by Internal's customer 360 view. */
export interface Customer360Point {
  id: string
  at: DayKey
  kind: "earn" | "spend" | "expire" | "adjust"
  points: number
  note: string
}

/** Detail payload for the admin customer sheet; no client-side history is fabricated. */
export interface Customer360Data {
  customer: Customer
  purchases: Customer360Purchase[]
  vouchers: Customer360Voucher[]
  points: Customer360Point[]
  loyalty: ApiLoyaltyBalance | null
}

export interface CustomerDirectory {
  customers: Customer[]
  total: number
  fetchedAt: string
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

function dayValue(value: unknown): DayKey {
  const raw = stringValue(value)
  return /^\d{4}-\d{2}-\d{2}/.test(raw)
    ? (raw.slice(0, 10) as DayKey)
    : ("1970-01-01" as DayKey)
}

function listFromPayload(payload: unknown): ApiCustomer[] {
  if (Array.isArray(payload)) return payload as ApiCustomer[]
  const record = asRecord(payload)
  if (!record) return []
  for (const key of ["members", "items", "data"]) {
    if (Array.isArray(record[key])) return record[key] as ApiCustomer[]
  }
  return []
}

function listFromRecord<T>(
  record: Record<string, unknown> | undefined,
  keys: string[]
): T[] {
  if (!record) return []
  for (const key of keys) {
    if (Array.isArray(record[key])) return record[key] as T[]
  }
  return []
}

const HUES = [
  "#0086fc",
  "#7b5cfa",
  "#ffbb26",
  "#00c978",
  "#ff58ae",
  "#64c6ff",
  "#ff3e00",
]

function tierName(value: unknown): string {
  return stringValue(value, "member").toLowerCase()
}

function mapTier(value: string): Customer["tierName"] {
  return value
}

function mapCustomer(raw: ApiCustomer, index: number): Customer | null {
  const row = raw as ApiCustomer & Record<string, unknown>
  const id = stringValue(row.customer_id ?? row.member_id)
  const name = stringValue(row.name ?? row.display_name)
  if (!id || !name) return null
  const rawTier = tierName(raw.tier)
  return {
    id,
    name,
    phone: stringValue(raw.phone),
    email: stringValue(raw.email),
    joinedOn: dayValue(row.created_at ?? row.joined_on),
    homeStoreId: stringValue(row.home_store),
    hue: HUES[index % HUES.length],
    purchases: [],
    points: [],
    lifetimeSpend: numberValue(raw.total_spend ?? raw.lifetime_spend),
    pointsBalance: numberValue(raw.points ?? raw.points_balance),
    tierName: mapTier(rawTier),
    visitCount: 0,
    // updated_at is profile metadata, not a sale/contact event.
    lastSeenKnown: false,
    hasMembership: raw.tier != null,
    // The admin list has no voucher projection. An explicit empty list keeps
    // the detail panel from falling back to the old synthetic commercial data.
    vouchers: [],
  }
}

function map360Purchase(raw: ApiPurchase): Customer360Purchase | null {
  const id = stringValue(raw.id)
  if (!id) return null
  return {
    id,
    storeId: stringValue(raw.store_id),
    storeName: stringValue(raw.store_name),
    amount: Math.max(0, numberValue(raw.total)),
    itemCount: Math.max(0, Math.trunc(numberValue(raw.item_count))),
    pointsEarned: Math.trunc(numberValue(raw.points_earned)),
    pointsUsed: Math.trunc(numberValue(raw.points_used)),
    at: dayValue(raw.transaction_at),
  }
}

function map360Voucher(raw: ApiVoucher): Customer360Voucher | null {
  const id = stringValue(raw.id)
  const code = stringValue(raw.code)
  if (!id || !code) return null
  const initialValue = Math.max(0, numberValue(raw.initial_value))
  const balance = Math.max(0, numberValue(raw.balance, initialValue))
  return {
    id,
    code,
    title: stringValue(raw.title),
    description: stringValue(raw.description),
    voucherType: stringValue(raw.voucher_type, "stored_value"),
    value: balance || initialValue,
    balance,
    singleUse: raw.single_use === true,
    expiresOn: dayValue(raw.expires_at),
    status: stringValue(raw.status, "active"),
  }
}

function map360Point(raw: ApiLoyaltyTransaction): Customer360Point | null {
  const id = stringValue(raw.id)
  if (!id) return null

  const rawType = stringValue(raw.type, "adjust").toLowerCase()
  const kind: Customer360Point["kind"] =
    rawType === "earn" || rawType === "refund"
      ? "earn"
      : rawType === "redeem"
        ? "spend"
        : rawType === "expire"
          ? "expire"
          : "adjust"
  const magnitude = Math.trunc(numberValue(raw.points))
  // Internal stores redeem/expire as a positive ledger magnitude with the
  // direction in `type`; the UI's points vocabulary uses a signed delta.
  const points =
    kind === "spend" || kind === "expire"
      ? -Math.abs(magnitude)
      : kind === "earn"
        ? Math.abs(magnitude)
        : magnitude

  return {
    id,
    at: dayValue(raw.created_at),
    kind,
    points,
    note:
      stringValue(raw.description) ||
      stringValue(raw.reference) ||
      (kind === "spend"
        ? "Points redeemed"
        : kind === "expire"
          ? "Points expired"
          : "Points adjustment"),
  }
}

export async function fetchCustomerDirectory(
  signal?: AbortSignal
): Promise<CustomerDirectory> {
  const options: ApiRequestOptions | undefined = signal ? { signal } : undefined
  const path = `/v1/customer/admin/list${qs({ limit: 200 })}`
  const payload = await api.get<unknown>(path, options)
  const rawCustomers = listFromPayload(payload)
  checkContract(CustomerRow, rawCustomers, path)
  const customers = rawCustomers
    .map(mapCustomer)
    .filter((customer): customer is Customer => Boolean(customer))
  const record = asRecord(payload) as ApiCustomerList | undefined
  const total = numberValue(record?.total, customers.length)
  return { customers, total, fetchedAt: new Date().toISOString() }
}

/** Fetch the authoritative profile, loyalty, voucher, and purchase aggregates. */
export async function fetchCustomer360(
  customerId: string,
  signal?: AbortSignal
): Promise<Customer360Data> {
  const id = customerId.trim()
  if (!id) throw new Error("customer id is required")
  // The real request path, and the id-free label checkContract's dedup gate
  // keys on — a label carrying the actual customer id would report once per
  // customer instead of once for the endpoint.
  const url = `/v1/customer/admin/${encodeURIComponent(id)}/360`
  const label = "/v1/customer/admin/:id/360"
  const options: ApiRequestOptions | undefined = signal ? { signal } : undefined
  const payload = await api.get<unknown>(url, options)
  const body = asRecord(payload)
  const rawBase = body ? (body.customer ?? body.member ?? body) : undefined
  checkContract(CustomerRow, rawBase ? [rawBase] : [], label)
  const base = body ? mapCustomer(rawBase as ApiCustomer, 0) : null
  if (!base) throw new Error("Internal returned an incomplete customer profile")
  const response = body ?? {}

  const loyalty = asRecord(response.loyalty)
    ? (response.loyalty as ApiLoyaltyBalance)
    : null
  if (loyalty) checkContract(LoyaltyBalanceRow, [loyalty], `${label}#loyalty`)
  const rawPurchases = listFromRecord<ApiPurchase>(response, ["purchases"])
  checkContract(PurchaseRow, rawPurchases, `${label}#purchases`)
  const purchases = rawPurchases
    .map(map360Purchase)
    .filter((purchase): purchase is Customer360Purchase => Boolean(purchase))
  const rawVouchers = listFromRecord<ApiVoucher>(response, ["vouchers"])
  checkContract(VoucherRow, rawVouchers, `${label}#vouchers`)
  const vouchers = rawVouchers
    .map(map360Voucher)
    .filter((voucher): voucher is Customer360Voucher => Boolean(voucher))
  const rawPoints = listFromRecord<ApiLoyaltyTransaction>(response, [
    "loyalty_history",
    "transactions",
  ])
  checkContract(LoyaltyTransactionRow, rawPoints, `${label}#points`)
  const points = rawPoints
    .map(map360Point)
    .filter((point): point is Customer360Point => Boolean(point))

  const profile = {
    ...base,
    purchases: [],
    points,
    lifetimeSpend: numberValue(
      (response.customer as ApiCustomer | undefined)?.total_spend ??
        (response.customer as ApiCustomer | undefined)?.lifetime_spend ??
        base.lifetimeSpend
    ),
    pointsBalance: numberValue(
      loyalty?.points_balance ?? response.total_points ?? base.pointsBalance
    ),
    tierName: stringValue(
      loyalty?.tier ?? response.tier ?? base.tierName,
      base.tierName
    ),
    visitCount: purchases.length,
    lastSeen: purchases[0]?.at,
    lastSeenKnown: purchases.length > 0,
    vouchers: [],
  }

  return { customer: profile, purchases, vouchers, points, loyalty }
}

/** The admin list — one cached read shared by every screen in the app. */
export function useCustomerDirectory() {
  return useDomainQuery(customerQueries.directory())
}

/**
 * The 360 payload for whichever customer the URL is showing.
 *
 * The id comes out of the `open` search param, so the cache key is the URL:
 * reopening a profile is a cache hit, and a link pasted into a fresh tab
 * fetches exactly the same thing.
 */
export function useCustomer360(customerId: string | null | undefined) {
  return useDomainQuery(customerQueries.detail(customerId))
}
