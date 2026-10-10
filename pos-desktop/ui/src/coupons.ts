/// A limited coupon, which this counter cannot admit on its own.
///
/// Most coupons are answered by the shop's node alone: the code opens a
/// promotion in the resident price book, and the quote says so. A coupon with a
/// cap across the estate — HEMAT50, "kuota 100 transaksi" — is different in the
/// way a voucher is different. The count that keeps the cap is one number for
/// every shop, so the node's copy of it is as old as its last sync, and two
/// counters each reading "99 of 100" would both give the hundredth away. The
/// node's quote therefore refuses such a coupon and names it in
/// `coupons_to_authorize` until head office has **held** one use of it for this
/// basket.
///
/// The hold is asked for exactly the way a voucher's is: `POST
/// /api/v1/store/coupons/{code}/authorize` on the shop node, which signs the
/// call to head office with its machine credential and writes the hold down
/// before answering. When the line is down the node answers 503 and a sentence
/// — the coupon then simply does not apply, which is the honest outcome.
///
/// **There is no commit here**, as with the voucher: the hold's id rides on the
/// quote and the sale (`coupon_authorizations`), the sale fact carries it on
/// the promotion it opened, and head office turns it into the redemption when
/// that sale reaches it through sync. `release` is for a basket that will not
/// become a sale — a dropped coupon, a cancelled or parked basket.

import { edge, type EdgeReply } from "@/edge"

export type CouponHoldReply = {
  readonly authorization_id?: string
  readonly code?: string
  readonly status?: string
  readonly expires_at?: string
  readonly replayed?: boolean
}

/// A hold this till carries for one coupon on the basket on the counter.
export type CouponHold = {
  readonly code: string
  readonly authorizationId: string
  /// The basket id the hold was granted under — what a release names.
  readonly checkoutId: string
}

const base = (code: string) =>
  `/api/v1/store/coupons/${encodeURIComponent(code.trim().toUpperCase())}`

/// Hold one use of `code` for this basket.
///
/// `checkoutId` is minted per ask (as a voucher's is), so asking again after a
/// hold lapsed is a new question rather than head office replaying the old,
/// expired answer. The shopper rides along because a set may cap uses per
/// shopper.
export function authorizeCoupon(
  code: string,
  checkoutId: string,
  customerId: string | null,
): Promise<EdgeReply<CouponHoldReply>> {
  return edge<CouponHoldReply>("POST", `${base(code)}/authorize`, {
    checkout_id: checkoutId,
    ...(customerId === null ? {} : { customer_id: customerId }),
  })
}

/// Give the held use back, because this basket will not use it. Releasing a
/// released hold is a success, so a basket abandoned twice is not an error.
export function releaseCoupon(
  hold: CouponHold,
  reason?: string,
): Promise<EdgeReply<unknown>> {
  return edge("POST", `${base(hold.code)}/release`, {
    checkout_id: hold.checkoutId,
    ...(reason === undefined ? {} : { reason }),
  })
}

/// The holds as the node takes them on a quote or a sale.
export const onTheWire = (holds: readonly CouponHold[]) =>
  holds.map((hold) => ({
    code: hold.code,
    authorization_id: hold.authorizationId,
  }))
