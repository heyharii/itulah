import type { KeyboardEvent } from "react"

import { Field, Input, Money } from "@/components/ui/field"
import { count, money } from "@/lib/format"
import { cn } from "@/lib/utils"
import {
  digits,
  syncPricing,
  variantPieces,
  type Pricing,
  type VariantDraft,
} from "@/screens/procurement/line-pricing-model"
import { GRID_HEAD } from "@/screens/procurement/shared"
import { VariantPhotos } from "@/screens/procurement/variant-photos"

/// What a line sells for, and in which SKUs — the owner's rule of 2026-09-26.
///
/// A buyer adding an item states three prices that are really two: what it
/// costs (the supplier's price), what it will sell for (the base price), and
/// the markup between them. Typing either of the last two fills the other, so
/// the pair can never disagree. Then, when the item comes in colours and
/// sizes, how many of each SKU — and where one SKU sells for something other
/// than the base price, that SKU's own price.

/// Purchase price, markup and base price, side by side.
export function PricingFields({
  pricing,
  onChange,
  required,
  sellingProblem,
  unit,
}: {
  pricing: Pricing
  onChange: (next: Pricing) => void
  /// What the purchase price is per, when it is not one piece — "lusin", and
  /// the pieces in one. The base price stays per piece.
  unit?: { readonly label: string; readonly factor: number }
  /// A star beside the purchase price, where the form requires it.
  required?: boolean
  /// Why what it will sell for cannot stand — at a loss or at cost — said
  /// under the base price. See `sellingProblem` in the model.
  sellingProblem?: string | null
}) {
  const set = (change: Partial<Pricing>) =>
    onChange(syncPricing(pricing, change, unit?.factor ?? 1))
  return (
    <div className="grid gap-4 md:grid-cols-3">
      <Field
        label="Purchase Price"
        required={required}
        aside={`per ${unit?.label ?? "pc"}`}
      >
        <Money
          label="Purchase Price"
          prefix="Rp"
          value={pricing.purchase}
          onChange={(purchase) => set({ purchase })}
        />
      </Field>
      <Field label="Markup">
        <span className="relative flex w-full min-w-0 items-center">
          <Input
            aria-label="Markup"
            inputMode="decimal"
            value={pricing.markup}
            className="pr-8 text-right tabular-nums"
            onChange={(event) => set({ markup: event.target.value })}
          />
          <span className="pointer-events-none absolute right-3.5 text-[0.9375rem] text-mute">
            %
          </span>
        </span>
      </Field>
      <Field
        label="Base Price"
        aside="selling, per pc"
        problem={sellingProblem ?? null}
      >
        <Money
          label="Base Price"
          prefix="Rp"
          value={pricing.base}
          onChange={(base) => set({ base })}
        />
      </Field>
    </div>
  )
}

const TYPED =
  "h-9 rounded-inner border border-hairline-2 bg-canvas px-2.5 text-right text-[0.9375rem] tabular-nums hover:border-hairline-strong focus:border-accent"

/// Up and down move between the SKUs' quantities, Enter goes down a row, as in
/// a sheet. A number field would otherwise spend the arrows on changing the
/// figure; the figure is typed, so they are better used for moving.
function stepQuantity(event: KeyboardEvent<HTMLInputElement>) {
  const step =
    event.key === "ArrowDown" || (event.key === "Enter" && !event.shiftKey)
      ? 1
      : event.key === "ArrowUp" || (event.key === "Enter" && event.shiftKey)
        ? -1
        : 0
  if (step === 0) return
  const fields = Array.from(
    event.currentTarget
      .closest("table")
      ?.querySelectorAll<HTMLInputElement>("input[data-grid-quantity]") ?? []
  )
  const next = fields[fields.indexOf(event.currentTarget) + step]
  event.preventDefault()
  if (next === undefined) return
  next.focus()
  next.select()
}

/// The SKU grid: one row per colour and size, a quantity and a price each.
///
/// Two inputs a row and nothing else, both drawn as boxes so they read as
/// typeable. The price box shows the base price as its placeholder: left
/// empty, the SKU sells at the base price; typed, it overrides it.
export function VariantGrid({
  variants,
  onChange,
  colourLabel,
  sizeLabel,
  basePrice,
  fallbackPrice,
  priced = true,
  articleName = "",
  photos = false,
  articlePhoto = null,
}: {
  variants: readonly VariantDraft[]
  onChange: (next: VariantDraft[]) => void
  colourLabel: (code: string) => string
  /// A size code as it is said ("M" for "03"); the code itself when absent.
  sizeLabel?: (code: string) => string
  basePrice: string
  /// What a SKU is worth while it has no price of its own and the base price
  /// is empty — the purchase price.
  fallbackPrice?: string
  /// Whether each SKU has a price column. A purchase order does not price
  /// SKUs for sale, so it leaves the column out.
  priced?: boolean
  /// The article the SKUs are of, said before each one: "Linen Shirt Khaki XXL".
  articleName?: string
  /// Whether each SKU may carry photographs of its own (0961) — on an order.
  photos?: boolean
  /// The article's photograph, shown on a SKU that has none of its own until
  /// one is chosen for it; the order sends it the same way (`variantsForWire`).
  articlePhoto?: string | null
}) {
  const patch = (index: number, change: Partial<VariantDraft>) =>
    onChange(
      variants.map((one, at) => (at === index ? { ...one, ...change } : one))
    )
  const pieces = variantPieces(variants)
  /// "Linen Shirt Khaki XXL": the article, then the colour and size.
  const nameOf = (one: VariantDraft) =>
    [
      articleName.trim() === "" ? null : articleName.trim(),
      one.colour === null ? null : colourLabel(one.colour),
      one.size === null ? null : (sizeLabel?.(one.size) ?? one.size),
    ]
      .filter(Boolean)
      .join(" ")
  const base = digits(basePrice) ?? digits(fallbackPrice ?? "")
  const value = variants.reduce((sum, one) => {
    const quantity = digits(one.quantity) ?? 0
    const price = digits(one.price) ?? base ?? 0
    return sum + quantity * price
  }, 0)

  return (
    <div className="overflow-hidden rounded-inner border border-hairline">
      <div className="max-h-[22rem] overflow-auto">
        <table className="w-full min-w-[30rem] table-fixed border-collapse">
          <colgroup>
            <col />
            {photos && <col className="w-[13rem]" />}
            <col className="w-[7rem]" />
            {priced && <col className="w-[10rem]" />}
          </colgroup>
          <thead className="sticky top-0 z-10">
            <tr>
              <th className={GRID_HEAD}>Variant</th>
              {photos && <th className={GRID_HEAD}>Photos</th>}
              <th className={cn(GRID_HEAD, "text-right")}>Quantity</th>
              {priced && (
                <th className={cn(GRID_HEAD, "text-right")}>Price / Pc</th>
              )}
            </tr>
          </thead>
          <tbody>
            {variants.map((one, index) => (
              <tr
                key={`${one.colour ?? ""}|${one.size ?? ""}`}
                className="border-t border-hairline"
              >
                <td className="px-3 py-1.5 text-[0.9375rem] text-ink">
                  {nameOf(one)}
                </td>
                {photos && (
                  <td className="px-3 py-1.5">
                    <VariantPhotos
                      photos={
                        (one.photos ?? []).length > 0 || !articlePhoto
                          ? (one.photos ?? [])
                          : [articlePhoto]
                      }
                      onChange={(next) => patch(index, { photos: next })}
                      name={nameOf(one)}
                    />
                  </td>
                )}
                <td className="px-1.5 py-1.5">
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    value={one.quantity}
                    onChange={(event) =>
                      patch(index, { quantity: event.target.value })
                    }
                    className={TYPED}
                    data-grid-quantity
                    onKeyDown={(event) => stepQuantity(event)}
                    aria-label={`Quantity of ${[one.colour, one.size].filter(Boolean).join(" ")}`}
                  />
                </td>
                {priced && (
                  <td className="px-1.5 py-1.5">
                    <Money
                      label={`Price of ${[one.colour, one.size].filter(Boolean).join(" ")}`}
                      value={one.price}
                      onChange={(price) => patch(index, { price })}
                      className={TYPED}
                    />
                  </td>
                )}
              </tr>
            ))}
          </tbody>
          <tfoot className="sticky bottom-0">
            <tr className="border-t border-hairline bg-soft">
              <td
                colSpan={photos ? 2 : 1}
                className="px-3 py-2.5 text-[0.9375rem] font-medium text-body"
              >
                {count(
                  variants.filter((one) => (digits(one.quantity) ?? 0) > 0)
                    .length
                )}{" "}
                SKUs
              </td>
              <td className="px-3 py-2.5 text-right text-[0.9375rem] font-medium text-ink tabular-nums">
                {count(pieces)}
              </td>
              {priced && (
                <td className="px-3 py-2.5 text-right text-[0.9375rem] font-medium text-ink tabular-nums">
                  {money(value)}
                </td>
              )}
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}
