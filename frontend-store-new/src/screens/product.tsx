import { useQuery } from "@tanstack/react-query"
import { ChevronDown, Sparkles } from "lucide-react"
import { useMemo, useState } from "react"

import { Card } from "@/components/ui/card"
import { Pill } from "@/components/ui/pill"
import { Segmented } from "@/components/ui/segmented"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { EmptyState, LoadingState } from "@/components/ui/states"
import { Tag } from "@/components/ui/tag"
import { count, label } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import { reaches } from "@/lib/deals"
import { isDown } from "@/lib/prices"
import { skuStockQuery } from "@/lib/queries"
import { cn } from "@/lib/utils"
import { shapeArticle, swatchBackground } from "@/lib/variants"
import { percentOff, type Item } from "@/screens/catalogue-model"
import { Photograph } from "@/screens/catalogue-parts"
import { OfferDetail, OfferPill } from "@/screens/promotions/parts"
import { describeEffect } from "@/screens/promotions/shared"
import type { CatalogRow, StoreOffer } from "@itulah/contract"
import { money } from "@itulah/contract/money"

/// One garment, in as much detail as the shop actually holds — the Catalogue's
/// record sheet, and the TEMPLATE for a record sheet in this app.
///
/// Opens over the list it came from (`?sku=` in the URL, so a tablet that
/// sleeps wakes on the same garment and a link reaches it), as the hub opens an
/// item: the sheet's head carries the SKU in mono above the name, the ONE
/// status (`Price down`, only while it is), and the division as a quiet
/// caption; the body is tabs — Details, Stock, Promotions — that wrap on a
/// phone rather than scroll; facts are label over value. There is nothing to
/// press at the foot because there is nothing to do to a garment here.
///
/// Read out of the catalogue already in the cache rather than fetched. The
/// till holds the whole resident book — that is what makes the counter work
/// with the line down — so a second request for one row of it would be a
/// request for something already in hand, and it would be the request that
/// fails on the day this screen is most needed.
///
/// **There is no "add to sale" here, and there cannot be.** A basket line is a
/// *tag*, not a product: `SaleRequest.epcs` is one EPC per garment and the node
/// refuses the same one twice, because two of the same shirt are two different
/// tags. A catalogue knows what the shop sells; it does not know which physical
/// piece somebody is holding.
export function ProductSheet({
  sku,
  rows,
  items,
  loaded,
  offers,
  currency,
  onSku,
  onClose,
}: {
  /// The SKU asked for. `undefined` is closed.
  sku: string | undefined
  /// The whole resident book.
  rows: readonly CatalogRow[]
  /// The same book joined with its final prices — what a walk-in pays.
  items: readonly Item[]
  /// The book has arrived.
  loaded: boolean
  /// The running offers, once they have arrived — `null` before, so a card can
  /// tell "none reach it" from "not asked yet".
  offers: readonly StoreOffer[] | null
  currency: string
  /// Another SKU of the same article: swaps the record in place.
  onSku: (sku: string) => void
  onClose: () => void
}) {
  const row =
    sku === undefined ? undefined : rows.find((one) => one.sku_code === sku)
  // Kept while the sheet slides away, so closing does not blank the record
  // mid-travel.
  const [shown, setShown] = useState<CatalogRow | undefined>(undefined)
  if (row !== undefined && row !== shown) setShown(row)
  const record = row ?? shown

  /// Promotions that could touch this garment.
  ///
  /// Could, not will. The engine decides what applies against a whole basket —
  /// quantities, thresholds, what else is in it, which combination gives the
  /// shopper the most — and none of that is knowable from one product. So this
  /// is scope only: the offers whose reach includes this SKU, its style, its
  /// division or one of its tags. A cashier reading it learns "this shirt is in
  /// the Lebaran promo", which is the true and useful sentence; the number
  /// still comes from the counter.
  const touching =
    record === undefined || offers === null
      ? null
      : offers.filter((offer) => reaches(offer, record))
  const siblings = useMemo(
    () =>
      record === undefined || record.article_code === null
        ? []
        : rows.filter((item) => item.article_code === record.article_code),
    [rows, record],
  )
  const down = record !== undefined && isDown(record)
  const division =
    record?.division_code !== null &&
    record?.division_code !== undefined &&
    record.division_code !== ""
      ? label(record.division_code)
      : undefined

  return (
    <Sheet
      open={sku !== undefined}
      onOpenChange={(next) => !next && onClose()}
      id={record?.sku_code ?? sku}
      title={record?.name ?? (loaded ? "Not in this range" : "Reading…")}
      badge={down ? <Pill tone="bad">Price down</Pill> : undefined}
      caption={division}
      tabs={
        record === undefined
          ? undefined
          : [
              {
                value: "details",
                label: "Details",
                content: (
                  <Details
                    row={record}
                    items={items}
                    siblings={siblings}
                    currency={currency}
                    onSku={onSku}
                  />
                ),
              },
              {
                value: "stock",
                label: "Stock",
                content: (
                  <StockTab
                    siblings={siblings.length > 0 ? siblings : [record]}
                    current={record.sku_code}
                  />
                ),
              },
              {
                value: "promotions",
                label:
                  touching !== null && touching.length > 0
                    ? `Promotions ${count(touching.length)}`
                    : "Promotions",
                content: <Promotions touching={touching} />,
              },
            ]
      }
    >
      {record === undefined &&
        (loaded ? (
          <EmptyState>
            {sku === undefined
              ? "No article was named."
              : `${sku} is not in this shop's priced range.`}
          </EmptyState>
        ) : (
          <LoadingState>Reading this shop's range…</LoadingState>
        ))}
    </Sheet>
  )
}

/// The Details tab: the photograph, the price, where the price came from, the
/// facts, and the article's sizes and colours with their prices.
function Details({
  row,
  items,
  siblings,
  currency,
  onSku,
}: {
  row: CatalogRow
  items: readonly Item[]
  /// Every SKU of the same article, this one included.
  siblings: readonly CatalogRow[]
  currency: string
  onSku: (sku: string) => void
}) {
  const finals = useMemo(
    () => new Map(items.map((item) => [item.row.sku_code, item] as const)),
    [items],
  )
  /// What a walk-in pays for one: the counter's own figure, the catalogue's.
  const finalOf = (one: CatalogRow) =>
    finals.get(one.sku_code)?.final ?? one.unit_price_minor
  /// Nothing left of it — known only once the shop's stock has arrived.
  const soldOut = (one: CatalogRow) => {
    const held = finals.get(one.sku_code)?.stock
    return held !== null && held !== undefined && held.total <= 0
  }
  const final = finalOf(row)
  const applied = finals.get(row.sku_code)?.applied ?? []
  const was = row.base_unit_price_minor
  const down = final < was
  const off = percentOff(final, was)
  const division =
    row.division_code !== null && row.division_code !== ""
      ? row.division_code
      : null
  const grid = useMemo(() => variantGrid(siblings), [siblings])

  return (
    <div className="flex flex-col gap-7">
      <div className="grid grid-cols-1 gap-5 md:grid-cols-[11rem_minmax(0,1fr)] md:gap-6">
        <div className="h-44 overflow-hidden rounded-card border border-hairline bg-soft-2 md:aspect-[4/5] md:h-auto">
          <Photograph sku={row.sku_code} has={row.has_image} name={row.name} />
        </div>

        <div className="min-w-0">
          {/* The price is what this record is asked for, so it is the one large
              figure on it: 24px, semibold, as a card's lead figure. Both
              numbers when it is marked down, because a was-price with nothing
              struck through is just a smaller price. */}
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-[1.5rem] leading-tight font-semibold tracking-tight text-ink tabular-nums">
              {money(final, currency)}
            </span>
            {down && (
              <span className="text-cell text-mute tabular-nums line-through">
                {money(was, currency)}
              </span>
            )}
          </div>
          {down && (
            <p className="mt-1 text-meta font-medium text-bad-fg tabular-nums">
              {money(was - final, currency)} off
              {off > 0 && ` · ${off}%`}
            </p>
          )}
          {/* What brought it down, by the names the till prints. */}
          {(applied.length > 0 || isDown(row)) && (
            <p className="mt-1 text-meta text-body">
              {[
                ...(isDown(row) ? ["Markdown"] : []),
                ...applied.map((one) => one.name),
              ].join(" · ")}
            </p>
          )}

          <Facts className="mt-5">
            <Fact term="Division">
              {division === null ? "—" : label(division)}
            </Fact>
            <Fact term="Price source">{sourceSentence(row.price_source)}</Fact>
            {row.barcode !== null && row.barcode !== "" && (
              <Fact term="Barcode">
                <span className="font-mono">{row.barcode}</span>
              </Fact>
            )}
            {row.article_code !== null && (
              <Fact term="Article">
                <span className="font-mono">{row.article_code}</span>
              </Fact>
            )}
            {row.tags.length > 0 && (
              <Fact term="Tags" wide>
                <span className="flex flex-wrap gap-1.5">
                  {row.tags.map((code) => (
                    <Tag key={code}>{code}</Tag>
                  ))}
                </span>
              </Fact>
            )}
          </Facts>
        </div>
      </div>

      {siblings.length > 1 && (
        <section>
          <h2 className="mb-3 text-card-title font-semibold text-ink">
            Sizes and colours
            <span className="ml-1.5 font-normal text-mute tabular-nums">
              {count(siblings.length)}
            </span>
          </h2>
          <VariantMatrix
            grid={grid}
            cell={(item) => {
              const here = item.sku_code === row.sku_code
              return {
                active: here,
                onPress: here ? undefined : () => onSku(item.sku_code),
                quiet: soldOut(item),
                content: (
                  <>
                    {finalOf(item) < item.base_unit_price_minor && (
                      <span
                        className={cn(
                          "text-[0.875rem] line-through",
                          here ? "opacity-70" : "text-mute",
                        )}
                      >
                        {money(item.base_unit_price_minor, currency)}
                      </span>
                    )}
                    <span className="font-medium">
                      {money(finalOf(item), currency)}
                    </span>
                    {/* Which colour in which size is gone, in the grid
                        somebody reads the sizes from. */}
                    {soldOut(item) && (
                      <span
                        className={cn(
                          "text-[0.875rem]",
                          // The open SKU's cell is ink on a desk and white on
                          // a phone's accent tile: inherit, a little quieter.
                          here ? "opacity-80" : "text-bad-fg",
                        )}
                      >
                        Sold out
                      </span>
                    )}
                  </>
                ),
              }
            }}
          />
        </section>
      )}
    </div>
  )
}

type Room = "floor" | "warehouse" | "total"

/// The Stock tab: the article's stock, colours and sizes, one room at a time.
///
/// Its own tab rather than a second figure in the price cells: a price and a
/// count in one cell are two numbers nobody can tell apart at a glance.
function StockTab({
  siblings,
  current,
}: {
  siblings: readonly CatalogRow[]
  current: string
}) {
  const [room, setRoom] = useState<Room>("total")
  const grid = useMemo(() => variantGrid(siblings), [siblings])
  const stock = useQuery({
    ...skuStockQuery(),
    refetchInterval: 60_000,
  })
  // A node that does not serve the read yet costs this tab, not the sheet.
  if (stock.isError)
    return (
      <EmptyState art={null}>
        This shop's server cannot say what is in stock just now.
      </EmptyState>
    )
  const bySku = new Map(
    (stock.data?.items ?? []).map((item) => [item.sku_code, item]),
  )

  return (
    <div className="flex flex-col gap-5">
      <Segmented<Room>
        value={room}
        onChange={setRoom}
        options={[
          { value: "floor", label: "Floor" },
          { value: "warehouse", label: "Warehouse" },
          { value: "total", label: "Total" },
        ]}
      />
      <VariantMatrix
        grid={grid}
        cell={(item) => {
          const units =
            stock.data === undefined
              ? null
              : (bySku.get(item.sku_code)?.[room] ?? 0)
          return {
            active: item.sku_code === current,
            quiet: units === 0,
            content: (
              <span className="font-medium">
                {units === null ? "…" : count(units)}
              </span>
            ),
          }
        }}
      />
    </div>
  )
}

/// The running promotions whose reach includes this garment. Each opens in
/// place to its terms, so nobody is sent to another screen to read one.
function Promotions({ touching }: { touching: readonly StoreOffer[] | null }) {
  const [open, setOpen] = useState<string | null>(null)
  if (touching === null)
    return <LoadingState>Reading the promotions…</LoadingState>
  if (touching.length === 0)
    return (
      <EmptyState art={null}>
        No running promotion reaches this article.
      </EmptyState>
    )
  return (
    <Card>
      <ul>
        {touching.map((offer) => {
          const expanded = open === offer.rule_id
          return (
            <li
              key={offer.rule_id}
              className={cn(
                "border-b border-hairline last:border-b-0",
                expanded && "bg-soft",
              )}
            >
              <button
                type="button"
                aria-expanded={expanded}
                onClick={() => setOpen(expanded ? null : offer.rule_id)}
                className="flex min-h-tap w-full items-center gap-3.5 px-4 py-3.5 text-left transition-colors hover:bg-soft active:bg-soft"
              >
                <span className="grid size-[1.875rem] shrink-0 place-items-center rounded-inner bg-accent-bg text-accent">
                  <Sparkles className="size-[0.9375rem]" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-cell font-medium text-ink">
                    {offer.name}
                  </span>
                  <span className="block truncate text-meta text-body">
                    {describeEffect(offer.effect)}
                    {offer.campaign_name !== null &&
                      ` · ${offer.campaign_name}`}
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1 sm:flex-row sm:items-center sm:gap-1.5">
                  {offer.coupon_code !== null && (
                    <Pill tone="accent">Needs a code</Pill>
                  )}
                  <OfferPill offer={offer} />
                </span>
                <ChevronDown
                  aria-hidden
                  className={cn(
                    "size-4 shrink-0 text-line-ico transition-transform duration-200",
                    expanded && "rotate-180",
                  )}
                />
              </button>
              {expanded && (
                <div className="px-4 pt-1 pb-5">
                  <OfferDetail offer={offer} />
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </Card>
  )
}

/// The node's `price_source`, in a sentence.
///
/// The strings are the pricing engine's own (`PriceSource::as_str`), and an
/// unknown one is shown rather than swallowed: a build that has not caught up
/// should say the word it received, not "—".
function sourceSentence(source: string): string {
  switch (source.toUpperCase()) {
    case "MARKDOWN":
      return "Marked down"
    case "SITE_PRICE":
      return "This shop's own price"
    case "SITE_GROUP_PRICE":
      return "A price for this group of shops"
    case "COMPANY_PRICE":
      return "The company price"
    default:
      return label(source)
  }
}

/// The article's SKUs as colours down and sizes across, read by
/// `shapeArticle` — the reader the Catalogue's tiles use, so a tile's swatches
/// and these rows are the same colours. Colours keep the order the book sent
/// them in; sizes run smallest first.
function variantGrid(items: readonly CatalogRow[]) {
  const shape = shapeArticle(items)
  const cells = new Map<string, CatalogRow>()
  const colours = shape.colours.map((colour) => {
    const name = colour.label ?? "—"
    for (const item of colour.skus)
      cells.set(
        `${name}|${shape.variant.get(item.sku_code)?.size ?? "—"}`,
        item,
      )
    return { name, paint: colour.paint }
  })
  // A SKU whose name carries no size still needs a column to sit in.
  const sizeless = [...shape.variant.values()].some((one) => one.size === null)
  const sizes = sizeless ? [...shape.sizes, "—"] : shape.sizes
  return { colours, sizes, cells }
}

/// A colour's dot, before its name in the grid.
function Dot({ paint }: { paint: readonly string[] }) {
  return (
    <span
      aria-hidden
      style={{ background: swatchBackground(paint) }}
      className="size-3.5 shrink-0 rounded-full shadow-[inset_0_0_0_1px_rgb(0_0_0/0.14)]"
    />
  )
}

/// What a variant's cell shows and does.
interface VariantCell {
  readonly content: React.ReactNode
  /// The SKU the sheet is open on.
  readonly active?: boolean
  /// A zero, or a figure with nothing to say: recedes.
  readonly quiet?: boolean
  /// Makes the cell a button (opening that SKU).
  readonly onPress?: () => void
}

/// The article's variants, colours and sizes, drawn for the room there is:
///
///  - on a desk, a table — colours down, sizes across, one cell each;
///  - on a phone, nothing scrolls sideways, so each colour is a block and each
///    size a tile in a three-column grid under it: the same cells, laid out for
///    a thumb.
function VariantMatrix({
  grid,
  cell,
}: {
  grid: ReturnType<typeof variantGrid>
  cell: (item: CatalogRow) => VariantCell
}) {
  const phone = useLayout() === "phone"
  if (phone)
    return (
      <div className="flex flex-col gap-5">
        {grid.colours.map(({ name: colour, paint }) => (
          <div key={colour}>
            <h3 className="mb-2 flex items-center gap-2 text-cell font-medium text-ink">
              <Dot paint={paint} />
              {colour}
            </h3>
            <div className="grid grid-cols-3 gap-2">
              {grid.sizes.map((size) => {
                const item = grid.cells.get(`${colour}|${size}`)
                if (item === undefined) return null
                const one = cell(item)
                const inside = (
                  <>
                    <span
                      className={cn(
                        "text-[0.875rem]",
                        one.active ? "text-on-dark/80" : "text-mute",
                      )}
                    >
                      {size}
                    </span>
                    <span className="flex flex-col items-start tabular-nums">
                      {one.content}
                    </span>
                  </>
                )
                const tile = cn(
                  "flex min-h-14 flex-col justify-center gap-0.5 rounded-inner border px-3 py-2 text-left text-cell",
                  one.active
                    ? "border-accent bg-accent text-on-dark"
                    : "border-hairline bg-canvas text-ink",
                  one.quiet && !one.active && "text-mute",
                )
                return one.onPress === undefined ? (
                  <div key={size} className={tile}>
                    {inside}
                  </div>
                ) : (
                  <button
                    key={size}
                    type="button"
                    onClick={one.onPress}
                    className={cn(tile, "active:bg-soft")}
                  >
                    {inside}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    )
  return (
    <Card>
      <table className="w-full border-collapse text-cell">
        <thead>
          <tr className="bg-soft text-eyebrow font-medium text-body">
            <th className="h-11 px-4 text-left font-medium">Colour</th>
            {grid.sizes.map((size) => (
              <th key={size} className="h-11 px-3 text-right font-medium">
                {size}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {grid.colours.map(({ name: colour, paint }) => (
            <tr key={colour} className="border-t border-hairline">
              <th
                scope="row"
                className="h-14 px-4 text-left font-medium whitespace-nowrap text-ink"
              >
                <span className="flex items-center gap-2">
                  <Dot paint={paint} />
                  {colour}
                </span>
              </th>
              {grid.sizes.map((size) => {
                const item = grid.cells.get(`${colour}|${size}`)
                if (item === undefined)
                  return (
                    <td key={size} className="px-3 text-right text-mute">
                      —
                    </td>
                  )
                const one = cell(item)
                const inside = (
                  <span className="flex flex-col items-end tabular-nums">
                    {one.content}
                  </span>
                )
                return (
                  <td
                    key={size}
                    className={cn(
                      "p-1 text-right",
                      one.quiet && "text-mute",
                      one.onPress === undefined &&
                        one.active &&
                        "bg-soft font-semibold",
                    )}
                  >
                    {one.onPress === undefined ? (
                      <span className="inline-flex min-h-12 items-center px-3">
                        {inside}
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={one.onPress}
                        className="inline-flex min-h-12 items-center rounded-inner px-3 whitespace-nowrap text-ink transition-colors hover:bg-soft"
                      >
                        {inside}
                      </button>
                    )}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  )
}
