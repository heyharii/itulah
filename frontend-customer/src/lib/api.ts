import { Member, MEMBER_CSRF_COOKIE, Node } from "@itulah/contract/client"

/// This surface is served from the same origin as the CLOUD node it talks to,
/// so the base URL is empty: production rewrites `/api/*` to the node and
/// development proxies it (see vite.config.ts). One origin is not a
/// convenience here — the session cookie is `SameSite=Strict`, so a browser
/// would simply not send it across two.
///
/// The node is told to echo the MEMBER csrf cookie rather than the operator
/// one. This app has no operator session and never will: a shopper does not
/// have a node account, and the whole point of the pairing flow is that they
/// no longer need to borrow one.
export const node = new Node("", MEMBER_CSRF_COOKIE)
export const member = new Member(node)

/// A member's own balance and the entries behind it.
///
/// Not a generated contract type: `GET /api/v1/member/points` wraps the same
/// `points_account` read the estate-wide `/api/v1/members/points` screen in
/// `frontend-hub` uses, and that one has never been typed either — see
/// `frontend-hub/src/lib/queries/points.ts`'s `PointsAccount`, which this
/// mirrors field for field. `balance_points` is `null` only for a member who
/// has never earned or spent, which is not the same as a balance of nought.
export interface MemberPointsAccount {
  readonly customer_id: string
  readonly balance_points: number | null
  readonly ledger_sum: number
  readonly reconciles: boolean
  readonly entries: readonly PointsEntry[]
}

/// One line of the points ledger, newest first. `sale_id` names the purchase
/// an EARN (or its reversal) came from, so a notification can open the receipt.
export interface PointsEntry {
  readonly entry_id: string
  readonly entry_type: string
  readonly points: number
  readonly created_at: string
  readonly sale_id?: string | null
}

export function pointsAccount(signal?: AbortSignal): Promise<MemberPointsAccount> {
  return node.get<MemberPointsAccount>("/api/v1/member/points", { signal })
}

/// A key that changes whenever a request's answer could change.
///
/// Nothing here is keyed by a member id any more, because nothing here can be
/// asked about a member other than the one whose session this is. When the
/// card changes the session changes with it, and `signOut` clears the cache
/// wholesale rather than trusting a key to have named every screen.
export const cacheKey = {
  node: () => ["node"] as const,
  me: () => ["member", "me"] as const,
  summary: () => ["member", "summary"] as const,
  transactions: () => ["member", "transactions"] as const,
  transaction: (saleId: string) =>
    ["member", "transactions", saleId] as const,
  points: () => ["member", "points"] as const,
  redeemRequests: () => ["member", "points", "redeem-requests"] as const,
}

/// Where a page of history starts. Both cursor fields travel together or not
/// at all — the server refuses half a cursor rather than silently rewinding to
/// the newest page, which would loop forever.
export interface HistoryCursor {
  readonly before_occurred_at: string
  readonly before_sale_id: string
}
