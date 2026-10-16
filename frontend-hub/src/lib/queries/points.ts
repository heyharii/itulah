import { infiniteQueryOptions } from "@tanstack/react-query"

import { node } from "@/lib/api"

/// Loyalty points — what the business owes its members, and what moved it.
///
/// ## Two reads, and why they are not one
///
/// `points_account.balance_points` is a CACHE the till reads; `points_ledger`
/// is the record. The server returns both figures side by side and a
/// `reconciles` flag rather than repairing the difference, which is the same
/// rule the single-member read follows: a mismatch is a fault to investigate,
/// and a GET that quietly fixed it would destroy the evidence of its cause.
///
/// ## A point is a liability, not a discount
///
/// These live under Members rather than Commercial for that reason. Everything
/// in Commercial says what something COSTS; a point is money the business owes
/// a shopper. The system this replaces filed the two together, and that is how
/// a gift card settled at the till came to be booked as a discount against
/// margin.

export interface PointsAccount {
  readonly customer_id: string
  readonly display_name: string | null
  /// What the cached account row says — the figure a till would read.
  readonly balance_points: number
  /// What the entries actually add up to.
  readonly ledger_sum: number
  /// False when those two disagree. Reported, never repaired.
  readonly reconciles: boolean
  readonly entries: number
  readonly last_movement: string | null
  readonly updated_at: string
}

export interface PointsAccounts {
  /// One page, largest balance first.
  readonly items: readonly PointsAccount[]
  /// Opaque. Pass it back as `cursor` for the next page; `null` means this was
  /// the last one.
  readonly next_cursor: string | null
  /// The three below are over the whole account book, not the page — so a
  /// screen can state them before the last page has been read.
  readonly account_count: number
  /// The cached balances summed: what the tills would quote, and so what the
  /// business owes.
  readonly outstanding_points: number
  readonly accounts_not_reconciling: number
}

export interface PointsLedgerPage {
  /// Newest first.
  readonly items: readonly PointsEntry[]
  readonly next_cursor: string | null
}

/// Where an entry came from. The database constrains this list, and exactly one
/// of `sale_id` / `return_id` / `redemption_id` is set to match.
export type PointsEntryType =
  "OPENING" | "EARN" | "RETURN_REVERSAL" | "REDEEM_TO_VOUCHER" | "ADJUSTMENT"

export interface PointsEntry {
  readonly entry_id: string
  readonly customer_id: string
  readonly display_name: string | null
  readonly entry_type: PointsEntryType | string
  /// Signed. Never zero — the table refuses it, because an entry that moves
  /// nothing is a row that explains nothing.
  readonly points: number
  readonly sale_id: string | null
  readonly return_id: string | null
  readonly redemption_id: string | null
  readonly reason: string | null
  readonly actor: string
  readonly created_at: string
}

export const pointsKeys = {
  all: ["points"] as const,
  /// Infinite queries: the key names the list, never the cursor — the pages
  /// live under it.
  accounts: () => ["points", "accounts"] as const,
  ledger: (customerId: string | null) =>
    ["points", "ledger", customerId] as const,
}

/// One page of the account book. `cursor` is the previous page's
/// `next_cursor`, verbatim; absent for the first.
export function listPointsAccounts(
  { cursor, limit = 200 }: { cursor?: string; limit?: number },
  signal?: AbortSignal
): Promise<PointsAccounts> {
  const params = new URLSearchParams({ limit: String(limit) })
  if (cursor) params.set("cursor", cursor)
  return node.get<PointsAccounts>(
    `/api/v1/members/points?${params.toString()}`,
    { signal }
  )
}

/// One page of the ledger, the estate's or one member's.
export function listPointsLedger(
  {
    customerId,
    cursor,
    limit = 200,
  }: { customerId: string | null; cursor?: string; limit?: number },
  signal?: AbortSignal
): Promise<PointsLedgerPage> {
  const params = new URLSearchParams({ limit: String(limit) })
  if (customerId) params.set("customer_id", customerId)
  if (cursor) params.set("cursor", cursor)
  return node.get<PointsLedgerPage>(
    `/api/v1/members/points-ledger?${params.toString()}`,
    { signal }
  )
}

/// Rows per request of either book.
export const POINTS_PAGE = 200

/// The account book a page at a time, largest balance first. Shared by the
/// screen and its prefetcher (`screens/members/prefetch.ts`).
export const pointsAccountsQuery = () =>
  infiniteQueryOptions({
    queryKey: pointsKeys.accounts(),
    queryFn: ({ pageParam, signal }) =>
      listPointsAccounts({ cursor: pageParam, limit: POINTS_PAGE }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  })

/// The ledger, newest first, the estate's or one member's.
export const pointsLedgerQuery = (customerId: string | null) =>
  infiniteQueryOptions({
    queryKey: pointsKeys.ledger(customerId),
    queryFn: ({ pageParam, signal }) =>
      listPointsLedger(
        { customerId, cursor: pageParam, limit: POINTS_PAGE },
        signal
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  })

/// The five entry types in the words a reader uses.
///
/// `REDEEM_TO_VOUCHER` is spelled out rather than shortened to "Redeemed"
/// because the mechanism is the point: V1 has exactly one way points leave an
/// account, and it is that they become a voucher. Points are never spent at the
/// till, so checkout has no points arithmetic at all.
export function describeEntryType(type: string): string {
  switch (type) {
    case "OPENING":
      return "Opening balance"
    case "EARN":
      return "Earned on a sale"
    case "RETURN_REVERSAL":
      return "Reversed by a return"
    case "REDEEM_TO_VOUCHER":
      return "Turned into a voucher"
    case "ADJUSTMENT":
      return "Adjusted by hand"
    default:
      // A type this build has not been told about is passed through rather
      // than guessed at.
      return type
  }
}
