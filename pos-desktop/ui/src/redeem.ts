/// A shopper's points, held nowhere this counter can see them.
///
/// The same shape as `vouchers.ts` and for the same reason: a member's
/// balance is bearer value held at one place, spendable at any shop, so the
/// only place "does this member really have that many points" can be
/// answered is head office — and the hold that stops the same points being
/// spent from two counters at once can only be granted there.
///
/// `POST /api/v1/store/points/redeem-requests/lookup` and `.../confirm` are
/// routes on the shop node that turn round and sign the call to head office
/// with the node's own machine credential
/// (`backend/src/edge/http.rs::relay_redeem_request_lookup` /
/// `relay_redeem_request_confirm`). The consequence a cashier meets: **this
/// needs the connection**, and when the line is down the node answers 503
/// and a sentence rather than inventing an answer about points it cannot see.
///
/// Confirming does not hand this counter a rupiah figure to type anywhere —
/// it returns a voucher, the same shape `vouchers.ts` already knows how to
/// spend, because that is what a confirmed redemption becomes. See
/// `screens/redeem.tsx` for where the resulting code is shown and handed to
/// the till's own "Voucher" tender.

import { edge, type EdgeReply } from "@/edge"

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

/// Find a member's live request by the code the shopper is holding up.
///
/// There is at most one live request per member at any time — the centre
/// refuses a second while one is already pending — so the member number and
/// the code together are enough to name it without an id.
export function lookupRedeemRequest(
  memberId: string,
  code: string,
): Promise<EdgeReply<FoundRedeemRequest>> {
  return edge<FoundRedeemRequest>(
    "POST",
    "/api/v1/store/points/redeem-requests/lookup",
    { member_id: memberId, code },
  )
}

/// Confirm the request a lookup just found. The rate — how many points buy
/// how much — is decided at the centre, not here: this counter never sends
/// and never sees one.
export function confirmRedeemRequest(
  requestId: string,
): Promise<EdgeReply<ConfirmedRedeemRequest>> {
  return edge<ConfirmedRedeemRequest>(
    "POST",
    `/api/v1/store/points/redeem-requests/${encodeURIComponent(requestId)}/confirm`,
  )
}
