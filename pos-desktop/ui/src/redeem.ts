/// A shopper's points, held nowhere this counter can see them.
///
/// The same shape as `vouchers.ts` and for the same reason: a member's
/// balance is bearer value held at one place, spendable at any shop, so the
/// only place "does this member really have that many points" can be
/// answered is head office — and the hold that stops the same points being
/// spent from two counters at once can only be granted there.
///
/// Every call here is a route on the shop node that turns round and signs the
/// call to head office with the node's own machine credential
/// (`backend/src/edge/http.rs::relay_redeem_*`). The consequence a cashier
/// meets: **this needs the connection**, and when the line is down the node
/// answers 503 and a sentence rather than inventing an answer about points it
/// cannot see.
///
/// # Who decides how many points (owner, 25 Oct 2026)
///
/// The cashier. "Redeem point customer ga usah masukin berapa, cukup kasir aja
/// yg input mau berapa": the cashier types the points, `askRedeem` tells head
/// office, and head office sends the shopper a six-digit code on WhatsApp and
/// shows the ask in their member app. The shopper approves either by tapping
/// Approve in the app — `redeemProgress` finds the voucher once they have — or
/// by reading the six digits back, which the cashier types into `lookup` and
/// `confirm`. The code never comes back to this counter: a cashier who could
/// see it could approve their own ask.
///
/// What comes out is a voucher, the same shape `vouchers.ts` already knows how
/// to spend, because that is what a confirmed redemption becomes. The rate —
/// how many points buy how much — is head office's: `value_minor` on the ask
/// is the truth, and this counter never sends one.

import { edge, type EdgeReply } from "@/edge"
import type { RedeemAsk, RedeemRequest } from "@itulah/contract"

export type FoundRedeemRequest = {
  readonly request_id?: string
  readonly points?: number
  readonly status?: string
  readonly requested_at?: string
  readonly expires_at?: string
}

export type ConfirmedRedeemRequest = {
  readonly redemption_id?: string
  readonly customer_id?: string
  readonly points_spent?: number
  readonly voucher_value_minor?: number
  readonly voucher_id?: string
  readonly voucher_code?: string
  readonly balance_points?: number
  readonly replayed?: boolean
}

/// Where an ask stands: `voucher` is filled once the shopper has approved it
/// in the app (the request is then `CONFIRMED`).
export type RedeemProgress = {
  readonly request: RedeemRequest
  readonly voucher: ConfirmedRedeemRequest | null
}

const base = "/api/v1/store/points/redeem-requests"

/// The cashier asks to spend `points` of the member's. Asking again for the
/// same member replaces the previous live ask. 409 "that member has N points
/// and the request asked for M", 404 no such member, 409 blocked.
export function askRedeem(memberId: string, points: number): Promise<EdgeReply<RedeemAsk>> {
  return edge<RedeemAsk>("POST", base, { member_id: memberId, points })
}

/// Where the ask stands, for the till that is waiting on it.
export function redeemProgress(requestId: string): Promise<EdgeReply<RedeemProgress>> {
  return edge<RedeemProgress>("POST", `${base}/${encodeURIComponent(requestId)}/progress`)
}

/// Take the ask back — the shopper pays another way, or the cashier changes the
/// points. 409 when the shopper approved it first: the points are spent and the
/// voucher pays this bill (`redeemProgress` then has it).
export function cancelRedeem(requestId: string): Promise<EdgeReply<RedeemRequest>> {
  return edge<RedeemRequest>("POST", `${base}/${encodeURIComponent(requestId)}/cancel`)
}

/// Find a member's live request by the code the shopper reads back.
///
/// There is at most one live request per member at any time — asking again
/// replaces the last — so the member number and the code together are enough
/// to name it without an id. A wrong or expired code is a 401, counted: five
/// wrong guesses burn the request.
export function lookupRedeemRequest(
  memberId: string,
  code: string,
): Promise<EdgeReply<FoundRedeemRequest>> {
  return edge<FoundRedeemRequest>("POST", `${base}/lookup`, { member_id: memberId, code })
}

/// Confirm the request a lookup just found.
export function confirmRedeemRequest(
  requestId: string,
): Promise<EdgeReply<ConfirmedRedeemRequest>> {
  return edge<ConfirmedRedeemRequest>("POST", `${base}/${encodeURIComponent(requestId)}/confirm`)
}
