import { useQuery } from "@tanstack/react-query"
import { ImageOff } from "lucide-react"
import { Sheet } from "@/components/ui/sheet"
import { Section } from "@/components/ui/rows"
import { ZoomPhoto } from "@/components/ui/photo-viewer"
import { count, dayMonth, label, money } from "@/lib/format"
import {
  procurementKeys,
  supplierItemDetail,
  type PurchaseOrderLine,
} from "@/lib/queries/procurement"
import { GRID_HEAD, lineValue, pcs } from "@/screens/procurement/shared"
import { cn } from "@/lib/utils"

/// What an order's line opens when it is clicked (owner, 14 Oct: "semua bisa
/// di klik … item di review count bisa di klik keluar detailnya").
///
/// It reads as the form that added it (owner, 14 Oct: "article detail itu
/// harusnya sama dengan saat new item di po isinya"): Photo beside Name and
/// Description, Division | Tags, Colors | Sizes, then Quantity | Price — or,
/// split by colour and size, Purchase Price and the variant grid. The same
/// labels in the same places, the answers as text rather than boxes. What
/// came in follows, since an order's line is the one place that says it.
export function LineSheet({
  line,
  po,
  onClose,
}: {
  line: PurchaseOrderLine | null
  /// The order's number, in grey over the line's name.
  po?: string
  onClose: () => void
}) {
  return (
    <Sheet
      open={line !== null}
      onOpenChange={(open) => !open && onClose()}
      context={po}
      title={line?.article_name ?? "Item"}
      id={line?.article_code}
      width="wide"
      // The width of the Add item form it mirrors, a step narrower than the
      // order under it.
      className="md:w-[min(52rem,calc(100vw-7rem))] xl:w-[min(52rem,calc(100vw-7rem))] min-[90rem]:w-[min(52rem,calc(100vw-7rem))]"
      stack
    >
      {line && <LineBody line={line} />}
    </Sheet>
  )
}

/// A form's question with its answer: the field's grey label over plain text.
function Answer({
  term,
  children,
  className,
}: {
  term: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-2", className)}>
      <span className="field-label text-[0.9375rem] text-mute">{term}</span>
      <span className="text-[0.9375rem] leading-[1.375rem] break-words whitespace-pre-wrap text-ink">
        {children}
      </span>
    </div>
  )
}

const NONE = <span className="text-mute">—</span>

function LineBody({ line }: { line: PurchaseOrderLine }) {
  // The description lives on the catalogue item, not on the line.
  const item = useQuery({
    queryKey: procurementKeys.supplierItem(line.supplier_item_id ?? ""),
    queryFn: ({ signal }) => supplierItemDetail(line.supplier_item_id!, signal),
    enabled: line.supplier_item_id !== null,
  })
  const description = item.data?.description?.trim() ?? ""
  const variants = line.variants ?? []
  const receipts = line.receipts ?? []
  const colours = [
    ...new Set(variants.flatMap((one) => one.colour_code ?? [])),
  ]
  const sizes = [...new Set(variants.flatMap((one) => one.size_code ?? []))]
  const byVariant = variants.length > 0
  const unit = line.order_unit_code?.toLowerCase() || null
  const factor = Number(line.unit_factor ?? "1")
  const perUnit =
    line.order_unit_price_minor ??
    Math.round(line.unit_price_minor * (Number.isFinite(factor) ? factor : 1))
  const total = lineValue(line, line.ordered_quantity)

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-4 md:grid-cols-[13rem_1fr]">
        <Answer term="Photo">
          {line.image_url ? (
            <ZoomPhoto
              url={line.image_url}
              name={line.article_name}
              className="block aspect-square w-full"
            >
              <img
                src={line.image_url}
                alt={line.article_name}
                className="aspect-square w-full rounded-inner border border-hairline object-cover"
              />
            </ZoomPhoto>
          ) : (
            <span className="grid aspect-square w-full place-items-center rounded-inner border border-hairline text-line-ico">
              <ImageOff className="size-5" aria-hidden />
            </span>
          )}
        </Answer>
        <div className="flex flex-col gap-4">
          <Answer term="Name">{line.article_name}</Answer>
          <Answer term="Description">
            {description === "" ? NONE : description}
          </Answer>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Answer term="Division">
          {line.division_code === null ? NONE : label(line.division_code)}
        </Answer>
        <Answer term="Tags">
          {line.tags.length === 0
            ? NONE
            : line.tags.map((tag) => label(tag)).join(", ")}
        </Answer>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Answer term="Colors">
          {colours.length === 0 ? NONE : colours.map((c) => label(c)).join(", ")}
        </Answer>
        <Answer term="Sizes">
          {sizes.length === 0 ? NONE : sizes.join(", ")}
        </Answer>
      </div>

      {byVariant ? (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            <Answer term="Purchase Price">
              {money(line.unit_price_minor)} / pc
            </Answer>
          </div>
          <div className="overflow-hidden rounded-inner border border-hairline">
            <table className="w-full table-fixed border-collapse">
              <colgroup>
                <col />
                <col className="w-[7rem]" />
              </colgroup>
              <thead>
                <tr>
                  <th className={GRID_HEAD}>Variant</th>
                  <th className={cn(GRID_HEAD, "text-right")}>Quantity</th>
                </tr>
              </thead>
              <tbody>
                {variants.map((one, index) => (
                  <tr key={index} className="border-t border-hairline">
                    <td className="px-3 py-2.5 text-[0.9375rem] text-ink">
                      {[
                        line.article_name,
                        one.colour_code === null ? null : label(one.colour_code),
                        one.size_code,
                      ]
                        .filter(Boolean)
                        .join(" ")}
                    </td>
                    <td className="px-3 py-2.5 text-right text-[0.9375rem] text-ink tabular-nums">
                      {count(one.quantity)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-hairline bg-soft">
                  <td className="px-3 py-2.5 text-[0.9375rem] font-medium text-body">
                    {count(variants.filter((one) => one.quantity > 0).length)}{" "}
                    SKUs
                  </td>
                  <td className="px-3 py-2.5 text-right text-[0.9375rem] font-medium text-ink tabular-nums">
                    {count(line.ordered_quantity)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      ) : (
        <div className="flex flex-col gap-2.5">
          <div className="grid gap-4 md:grid-cols-2">
            <Answer term="Quantity">
              {unit === null || !line.order_unit_quantity
                ? pcs(line.ordered_quantity)
                : `${line.order_unit_quantity.replace(".", ",")} ${unit}`}
            </Answer>
            <Answer term="Price">
              {money(unit === null ? line.unit_price_minor : perUnit)} /{" "}
              {unit ?? "piece"}
            </Answer>
          </div>
        </div>
      )}
      <p className="text-[0.9375rem] text-body tabular-nums">
        {/* The pieces only where Quantity said them in another unit. */}
        {(unit !== null || byVariant) && `${pcs(line.ordered_quantity)} · `}
        {"Total "}
        <span className="font-medium text-ink">{money(total)}</span>
      </p>

      {receipts.length > 0 && (
        <Section title="Receiving" rule={false} tight>
          <ul className="flex flex-col divide-y divide-hairline text-[0.9375rem]">
            {receipts.map((one, index) => (
              <li key={index} className="flex justify-between gap-4 py-2.5">
                <span className="text-mute">{dayMonth(one.received_at)}</span>
                <span className="tabular-nums">
                  {pcs(one.matched_quantity)}
                  {one.wrong_quantity > 0 &&
                    ` · ${pcs(one.wrong_quantity)} not as ordered`}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  )
}
