/**
 * One place that turns a number into something a person reads.
 *
 * Before this, money was formatted in ten places with three different
 * behaviours, and the differences were not stylistic:
 *
 *   accounting/api.ts   `${sign}Rp ${Math.abs(rounded)}`   sign outside
 *   articles.tsx        `value === 0 ? "—" : …`            zero renders as "—"
 *   commercial/data.ts  `Rp ${Math.round(value)}`          zero renders as Rp 0
 *
 * The middle one is a semantic bug, not a style: it makes a genuinely free item
 * indistinguishable from one whose price has never been set. `—` has to mean
 * "we do not know", or it means nothing.
 *
 * See docs/money-contract.md. Amounts arriving here are integer minor units —
 * for IDR the minor unit is the rupiah itself, so there is no scaling.
 */

const ID = "id-ID"

/** How the app writes "we do not have this value". Never used for zero. */
export const UNKNOWN = "—"

/**
 * An amount of money, in integer minor units.
 *
 * `null`/`undefined` render as {@link UNKNOWN}; `0` renders as `Rp 0`, because a
 * price of zero is a fact and the absence of a price is a different fact.
 *
 * A fractional input is a bug upstream — money is integer minor units — but it
 * is rounded rather than shown with a fraction, because IDR has no sen in
 * practice and `Rp 1.500,33` would be noise the type should never have allowed.
 */
export function formatIDR(
  amountMinor: number | null | undefined,
  options: { signed?: boolean } = {},
): string {
  if (amountMinor === null || amountMinor === undefined) return UNKNOWN
  if (!Number.isFinite(amountMinor)) return UNKNOWN

  const rounded = Math.round(amountMinor)
  const magnitude = Math.abs(rounded).toLocaleString(ID)

  /* The sign sits outside the currency mark: `-Rp 5.000`, which is how it is
   * written here, not `Rp -5.000`. */
  if (rounded < 0) return `-Rp ${magnitude}`
  if (options.signed && rounded > 0) return `+Rp ${magnitude}`
  return `Rp ${magnitude}`
}

/** The number alone, grouped, with no currency mark — for a column that carries
 *  its unit in the header rather than on every row. */
export function formatAmount(
  amountMinor: number | null | undefined,
): string {
  if (amountMinor === null || amountMinor === undefined) return UNKNOWN
  if (!Number.isFinite(amountMinor)) return UNKNOWN
  return Math.round(amountMinor).toLocaleString(ID)
}

/**
 * A count of things — units, events, redemptions, points.
 *
 * Separate from {@link formatIDR} on purpose. Several call sites reached for the
 * money formatter to group a count, which reads fine until someone adds a
 * currency mark to it and silently turns "1.240 events" into "Rp 1.240".
 */
export function formatQty(value: number | null | undefined): string {
  if (value === null || value === undefined) return UNKNOWN
  if (!Number.isFinite(value)) return UNKNOWN
  return value.toLocaleString(ID)
}

/**
 * A ratio as a percentage. Takes the ratio (0.075), not the percentage (7.5) —
 * the backend stores ratios, and converting at the boundary is one place to be
 * wrong instead of every call site.
 */
export function formatPercent(
  ratio: number | null | undefined,
  fractionDigits = 1,
): string {
  if (ratio === null || ratio === undefined) return UNKNOWN
  if (!Number.isFinite(ratio)) return UNKNOWN
  return `${(ratio * 100).toLocaleString(ID, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  })}%`
}
