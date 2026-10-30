/// A voucher, which is the one tender this counter cannot settle on its own.
///
/// Everything else at this till is answered by the shop's own node: the
/// catalogue, the prices, the stock, the sale and its sequence number. A
/// voucher is different in kind, not in degree. It is bearer value held in one
/// place and spendable at ANY shop, so the only place the answer "is there
/// still money on this card" can be true is head office, where both shops can
/// see it — and the hold that stops two counters settling against one card at
/// the same moment can only be granted there.
///
/// The shop's node **relays** for exactly this reason. `POST
/// /api/v1/store/vouchers/{code}/authorize` is a route on the shop node that
/// turns round and signs the call to head office with the node's own machine
/// credential (`backend/src/edge/http.rs::relay_voucher`). The consequence a
/// cashier meets: **a voucher needs the connection**, and when the line is
/// down the node answers 503 and a sentence rather than inventing an
/// authorisation. A locally-invented hold is the double-spend the hold exists
/// to prevent, so this module reports the refusal instead of hiding it.
///
/// The three verbs are one conversation about one basket. `authorize` holds
/// the money while the cashier is still counting the rest; `release` gives it
/// back because the basket did not become a sale. **`commit` is not here on
/// purpose**: the hold id travels on the sale's own tender, and head office
/// turns the hold into the redemption when that sale reaches it through sync —
/// so a sale whose upload is delayed still settles the card, on the strength
/// of a fact the till already wrote down.

import { edge, type EdgeReply } from "@/edge"

export type VoucherHold = {
  readonly authorization_id?: string
  readonly code?: string
  readonly amount_minor?: number
  readonly status?: string
  readonly expires_at?: string
  readonly replayed?: boolean
}

const base = (code: string) =>
  `/api/v1/store/vouchers/${encodeURIComponent(code.trim().toUpperCase())}`

/// Hold `amountMinor` against `code` for this basket.
///
/// `checkoutId` is the basket's own id — it has no row anywhere yet — and the
/// hold is idempotent on it: the same basket asking twice gets the first hold
/// back rather than reserving the money twice. That is what makes a retry after
/// a lost response safe.
export function authorizeVoucher(
  code: string,
  checkoutId: string,
  amountMinor: number,
): Promise<EdgeReply<VoucherHold>> {
  // A paper voucher is single use (client, 28 Oct 2026): head office forfeits
  // what the basket did not take when the hold is committed — the till only
  // asks for the amount.
  return edge<VoucherHold>("POST", `${base(code)}/authorize`, {
    checkout_id: checkoutId,
    amount_minor: amountMinor,
  })
}

/// Give the hold back, because the basket did not become a sale.
///
/// Releasing a hold that is already released is a success, so calling this on a
/// basket the cashier abandoned twice is not an error — a basket abandoned
/// twice is a basket abandoned.
export function releaseVoucher(
  code: string,
  checkoutId: string,
  reason?: string,
): Promise<EdgeReply<unknown>> {
  return edge("POST", `${base(code)}/release`, {
    checkout_id: checkoutId,
    ...(reason === undefined ? {} : { reason }),
  })
}
