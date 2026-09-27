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
}: {
  pricing: Pricing
  onChange: (next: Pricing) => void
  /// A star beside the purchase price, where the form requires it.
  required?: boolean
}) {
  const set = (change: Partial<Pricing>) =>
    onChange(syncPricing(pricing, change))
  return (
    <div className="grid gap-4 md:grid-cols-3">
      <Field
        label={
          <>
            Purchase price
            {required && <span className="ml-0.5 text-bad">*</span>}
          </>
        }
        aside="per pc"
      >
        <Money
          label="Purchase price"
          prefix="Rp"
          value={pricing.purchase}
          onChange={(purchase) => set({ purchase })}
          placeholder="31.000"
          className="pl-10"
        />
      </Field>
      <Field label="Markup">
        <span className="relative flex w-full min-w-0 items-center">
          <Input
            aria-label="Markup"
            inputMode="decimal"
            value={pricing.markup}
            placeholder="0"
            className="pr-8 text-right tabular-nums"
            onChange={(event) => set({ markup: event.target.value })}
          />
          <span className="pointer-events-none absolute right-3.5 text-[0.875rem] text-mute">
            %
          </span>
        </span>
      </Field>
      <Field label="Base price" aside="selling, per pc">
        <Money
          label="Base price"
          prefix="Rp"
          value={pricing.base}
          onChange={(base) => set({ base })}
          placeholder="49.000"
          className="pl-10"
        />
      </Field>
    </div>
  )
}

const TYPED =
  "h-9 rounded-inner border border-hairline-2 bg-canvas px-2.5 text-right text-[0.875rem] tabular-nums hover:border-hairline-strong focus:border-accent"

/// The SKU grid: one row per colour and size, a quantity and a price each.
///
/// Two inputs a row and nothing else, both drawn as boxes so they read as
/// typeable. The price box shows the base price as its placeholder: left
/// empty, the SKU sells at the base price; typed, it overrides it.
export function VariantGrid({
  variants,
  onChange,
  colourLabel,
  basePrice,
}: {
  variants: readonly VariantDraft[]
  onChange: (next: VariantDraft[]) => void
  colourLabel: (code: string) => string
  basePrice: string
}) {
  const patch = (index: number, change: Partial<VariantDraft>) =>
    onChange(
      variants.map((one, at) => (at === index ? { ...one, ...change } : one))
    )
  const hasColour = variants.some((one) => one.colour !== null)
  const hasSize = variants.some((one) => one.size !== null)
  const pieces = variantPieces(variants)
  const base = digits(basePrice)
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
            {hasColour && <col />}
            {hasSize && <col className="w-[6rem]" />}
            <col className="w-[7rem]" />
            <col className="w-[10rem]" />
          </colgroup>
          <thead className="sticky top-0 z-10">
            <tr>
              {hasColour && <th className={GRID_HEAD}>Colour</th>}
              {hasSize && <th className={GRID_HEAD}>Size</th>}
              <th className={cn(GRID_HEAD, "text-right")}>Qty</th>
              <th className={cn(GRID_HEAD, "text-right")}>Price / pc</th>
            </tr>
          </thead>
          <tbody>
            {variants.map((one, index) => (
              <tr
                key={`${one.colour ?? ""}|${one.size ?? ""}`}
                className="border-t border-hairline"
              >
                {hasColour && (
                  <td className="px-3 py-1.5 text-[0.875rem] text-ink">
                    {one.colour === null ? "—" : colourLabel(one.colour)}
                  </td>
                )}
                {hasSize && (
                  <td className="px-3 py-1.5 font-mono text-[0.875rem] text-ink">
                    {one.size ?? "—"}
                  </td>
                )}
                <td className="px-1.5 py-1.5">
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    value={one.quantity}
                    placeholder="0"
                    onChange={(event) =>
                      patch(index, { quantity: event.target.value })
                    }
                    className={TYPED}
                    aria-label={`Quantity of ${[one.colour, one.size].filter(Boolean).join(" ")}`}
                  />
                </td>
                <td className="px-1.5 py-1.5">
                  <Money
                    label={`Price of ${[one.colour, one.size].filter(Boolean).join(" ")}`}
                    value={one.price}
                    onChange={(price) => patch(index, { price })}
                    placeholder={base === null ? "Base price" : money(base)}
                    className={TYPED}
                  />
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="sticky bottom-0">
            <tr className="border-t border-hairline bg-soft">
              <td
                colSpan={(hasColour ? 1 : 0) + (hasSize ? 1 : 0)}
                className="px-3 py-2.5 text-[0.875rem] font-medium text-body"
              >
                {count(variants.filter((one) => (digits(one.quantity) ?? 0) > 0).length)}{" "}
                SKUs
              </td>
              <td className="px-3 py-2.5 text-right text-[0.875rem] font-medium text-ink tabular-nums">
                {count(pieces)}
              </td>
              <td className="px-3 py-2.5 text-right text-[0.875rem] font-medium text-ink tabular-nums">
                {money(value)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}
