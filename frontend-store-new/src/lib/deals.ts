import type { CatalogRow, StoreOffer } from "@itulah/contract"

/// The deals that reach one garment, sorted the way a shop floor tells them
/// apart:
///
///  - **promotion** — comes off on its own at the till;
///  - **voucher** — comes off only when somebody types its code;
///  - **members** — comes off only for a member.
///
/// Scope only. Whether a promotion actually applies is the engine's to decide
/// against a whole basket — quantities, thresholds, what else is in it — so
/// this says "this shirt is in the Lebaran promo", which is true and useful,
/// and never a price. The price is `/store/final-prices`.
export interface Deals {
  readonly promotion: readonly StoreOffer[]
  readonly voucher: readonly StoreOffer[]
  readonly members: readonly StoreOffer[]
}

export const NO_DEALS: Deals = { promotion: [], voucher: [], members: [] }

export function dealsOf(row: CatalogRow, offers: readonly StoreOffer[]): Deals {
  const promotion: StoreOffer[] = []
  const voucher: StoreOffer[] = []
  const members: StoreOffer[] = []
  for (const offer of offers) {
    // A whole-basket offer ("Rp 25.000 off Rp 200.000+") is a deal on the
    // basket, not on any garment: counted here it would put every article in
    // the shop under "Voucher" and the filter would narrow nothing.
    if (offer.applies_to === null || offer.applies_to.on === "WHOLE_CART")
      continue
    if (!reaches(offer, row)) continue
    // Points are not a deal on a price.
    if (offer.effect.kind === "EARN_POINTS") continue
    if (offer.coupon_code !== null) voucher.push(offer)
    else if (offer.members_only) members.push(offer)
    else promotion.push(offer)
  }
  return promotion.length + voucher.length + members.length === 0
    ? NO_DEALS
    : { promotion, voucher, members }
}

/// Whether an offer's scope reaches this garment. `null` applicability is the
/// whole cart, which reaches everything.
export function reaches(offer: StoreOffer, row: CatalogRow): boolean {
  const scope = offer.applies_to
  if (scope === null) return true
  switch (scope.on) {
    case "SKU":
      return scope.sku_codes.includes(row.sku_code)
    case "ARTICLE":
      return (
        row.article_code !== null &&
        scope.article_codes.includes(row.article_code)
      )
    case "DIVISION":
      return (
        row.division_code !== null &&
        scope.divisions.includes(row.division_code)
      )
    case "TAG":
      return row.tags.some((tag) => scope.tags.includes(tag))
    case "WHOLE_CART":
      return true
  }
}
