import { Auth, Node } from "@itulah/contract/client"
import type {
  CustomerSummary,
  CustomerTransactionDetail,
  CustomerTransactionPage,
} from "@itulah/contract"

/// This surface is served from the same origin as the CLOUD node it talks to,
/// so the base URL is empty: production rewrites `/api/*` to the node and
/// development proxies it (see vite.config.ts). One origin is not a
/// convenience here — the session cookie is `SameSite=Strict`, so a browser
/// would simply not send it across two.
export const node = new Node()
export const auth = new Auth(node)

/// Every request this app makes is a GET. There is no write path, and adding
/// one would need a reason that survives the question "should a phone be able
/// to change a shop's takings".
const member = (id: string) => `/api/v1/customer/${encodeURIComponent(id)}`

export function customerSummary(
  memberId: string,
  signal?: AbortSignal,
): Promise<CustomerSummary> {
  return node.get<CustomerSummary>(`${member(memberId)}/summary`, { signal })
}

/// Where a page of history starts. Both cursor fields travel together or not
/// at all — the server refuses half a cursor rather than silently rewinding to
/// the newest page, which would loop forever.
export interface HistoryCursor {
  readonly before_occurred_at: string
  readonly before_sale_id: string
}

export function customerTransactions(
  memberId: string,
  options: { limit?: number; cursor?: HistoryCursor; signal?: AbortSignal } = {},
): Promise<CustomerTransactionPage> {
  const query = new URLSearchParams()
  if (options.limit !== undefined) {
    query.set("limit", String(options.limit))
  }
  if (options.cursor !== undefined) {
    query.set("before_occurred_at", options.cursor.before_occurred_at)
    query.set("before_sale_id", options.cursor.before_sale_id)
  }
  const suffix = query.size === 0 ? "" : `?${query.toString()}`
  return node.get<CustomerTransactionPage>(
    `${member(memberId)}/transactions${suffix}`,
    { signal: options.signal },
  )
}

export function customerTransaction(
  memberId: string,
  saleId: string,
  signal?: AbortSignal,
): Promise<CustomerTransactionDetail> {
  return node.get<CustomerTransactionDetail>(
    `${member(memberId)}/transactions/${encodeURIComponent(saleId)}`,
    { signal },
  )
}

/// A key that changes whenever a request's answer could change.
///
/// The member id is part of every key on purpose: switching cards on a shared
/// phone must not show the previous member's points while the new ones load.
export const cacheKey = {
  identity: () => ["identity"] as const,
  me: () => ["auth", "me"] as const,
  summary: (memberId: string) => ["customer", memberId, "summary"] as const,
  transactions: (memberId: string) =>
    ["customer", memberId, "transactions"] as const,
  transaction: (memberId: string, saleId: string) =>
    ["customer", memberId, "transactions", saleId] as const,
}
