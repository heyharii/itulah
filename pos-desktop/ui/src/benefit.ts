/// The employee benefit balance, a tender the shop's node cannot settle alone.
///
/// An employee's rupiah balance is kept at head office. On their phone they show
/// a 6-digit code (also as a QR a keyboard-wedge scanner types as those six
/// digits). The till spends part of the basket from that balance and the rest is
/// paid as usual. Like a voucher it **needs the connection**: the shop node
/// relays to head office, and when the line is down it answers 502 rather than
/// inventing a balance. Not combinable with a promotion; a return gives the
/// spent part back.
///
/// The three verbs are one conversation about one basket. `lookup` reads the
/// balance without using the code up; `spend` uses the code up, once per
/// `sale_ref`; `return` gives money back against that same `sale_ref` — both
/// when the basket is abandoned before it becomes a sale and when a returned
/// sale is refunded to the balance. The sale then carries a `BENEFIT` tender
/// whose `reference` is the `sale_ref`.

import { edge, type EdgeReply } from "@/edge"

/// Whose balance this is, and what is left on it.
export type BenefitHolder = {
  readonly employee_id: string
  readonly employee_code: string
  readonly full_name: string | null
  readonly balance_minor: number
}

const base = "/api/v1/store/benefit"

/// Read the holder and balance behind a code. Does not use the code up.
export function lookupBenefit(code: string): Promise<EdgeReply<BenefitHolder>> {
  return edge<BenefitHolder>("POST", `${base}/lookup`, { code: code.trim() })
}

/// Spend `amountMinor` from the balance for the sale named `saleRef`.
///
/// One spend per `saleRef` (a second is 409), and the node refuses more than the
/// balance, a basket with a promotion, and a cashier spending their own balance.
export function spendBenefit(
  code: string,
  saleRef: string,
  amountMinor: number,
  basketHasPromotion: boolean,
): Promise<EdgeReply<BenefitHolder>> {
  return edge<BenefitHolder>("POST", `${base}/spend`, {
    code: code.trim(),
    sale_ref: saleRef,
    amount_minor: amountMinor,
    basket_has_promotion: basketHasPromotion,
  })
}

/// Give back at most what `saleRef` spent. Answers the new balance.
export function returnBenefit(
  saleRef: string,
  amountMinor: number,
  reason: string,
): Promise<EdgeReply<number>> {
  return edge<number>("POST", `${base}/return`, {
    sale_ref: saleRef,
    amount_minor: amountMinor,
    reason,
  })
}
