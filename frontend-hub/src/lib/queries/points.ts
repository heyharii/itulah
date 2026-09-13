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
  readonly items: readonly PointsAccount[]
  /// Summed over the rows RETURNED, which is why it is not called a total: a
  /// page of the account book is not the book.
  readonly outstanding_points_on_this_page: number
  readonly accounts_not_reconciling: number
}

/// Where an entry came from. The database constrains this list, and exactly one
/// of `sale_id` / `return_id` / `redemption_id` is set to match.
export type PointsEntryType =
  | "OPENING"
  | "EARN"
  | "RETURN_REVERSAL"
  | "REDEEM_TO_VOUCHER"
  | "ADJUSTMENT"

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
  accounts: (limit: number) => ["points", "accounts", limit] as const,
  ledger: (customerId: string | null, limit: number) =>
    ["points", "ledger", customerId, limit] as const,
}

export function listPointsAccounts(
  limit = 200,
  signal?: AbortSignal
): Promise<PointsAccounts> {
  return node.get<PointsAccounts>(
    `/api/v1/members/points?limit=${limit}`,
    { signal }
  )
}

export function listPointsLedger(
  customerId: string | null,
  limit = 200,
  signal?: AbortSignal
): Promise<readonly PointsEntry[]> {
  const params = new URLSearchParams({ limit: String(limit) })
  if (customerId) params.set("customer_id", customerId)
  return node
    .get<{ items: PointsEntry[] }>(
      `/api/v1/members/points-ledger?${params.toString()}`,
      { signal }
    )
    .then((body) => body.items)
}

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
