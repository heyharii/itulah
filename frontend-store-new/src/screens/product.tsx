import { useQuery } from "@tanstack/react-query"
import { useMemo, useState } from "react"
import { ChevronDown, Sparkles } from "lucide-react"

import { Card } from "@/components/ui/card"
import { Pill } from "@/components/ui/pill"
import { Screen } from "@/components/ui/screen"
import { Segmented } from "@/components/ui/segmented"
import { EmptyState } from "@/components/ui/states"
import { Tag } from "@/components/ui/tag"
import { count, label } from "@/lib/format"
import { useGo } from "@/lib/go"
import { useParam } from "@/lib/params"
import {
  catalogueKey,
  fetchCatalogue,
  fetchSkuStock,
  skuStockKey,
  fetchOffers,
  offersKey,
} from "@/lib/queries"
import { queryState } from "@/lib/query-state"
import { cn } from "@/lib/utils"
import { Photograph } from "@/screens/catalogue"
import { OfferDetail, OfferPill } from "@/screens/promotions/parts"
import { describeEffect } from "@/screens/promotions/shared"
import type { CatalogRow, StoreOffer } from "@itulah/contract"
import { money } from "@itulah/contract/money"

/// One garment, in as much detail as the shop actually holds.
///
/// Read out of the catalogue already in the cache rather than fetched. The till
/// holds the whole resident book — that is what makes the counter work with the
/// line down — so a second request for one row of it would be a request for
/// something already in hand, and it would be the request that fails on the day
/// this screen is most needed.
///
/// **There is no "add to sale" here, and there cannot be.** A basket line is a
/// *tag*, not a product: `SaleRequest.epcs` is one EPC per garment and the node
/// refuses the same one twice, because two of the same shirt are two different
/// tags. A catalogue knows what the shop sells; it does not know which physical
/// piece somebody is holding. Adding a button that guessed would be a button
/// that sold stock the shop cannot account for.
///
/// **Drawn as the hub's item sheet** (`frontend-hub/src/screens/procurement/
/// item-detail.tsx`), opened out into a page: the photograph large, the name
/// and the price beside it, then the facts as a label-over-value grid and the
/// promotions as rows. On a desk the photograph stands to the left of
/// everything else; on a phone it runs the width of the glass above it.
///
/// Stock on hand is not here: this screen reads the price book and the offers
/// and nothing else, and what the shop holds of a SKU is the Stock screen's.
export function Product() {
  const sku = useParam("sku")

  const catalogue = useQuery({
    queryKey: catalogueKey(),
    queryFn: ({ signal }) => fetchCatalogue(signal),
    /// A minute, and it overrides the app's five-minute staleness.
    ///
    /// The rest of the till is right to be lazy: a basket is priced from the
    /// book in hand and a five-minute-old book prices it identically. A screen
    /// **showing a price to a customer** is the one place that is not true. A
    /// publication lands on the sync lane while the shop is open, and a tablet
    /// left on a rail quoting yesterday's number is the exact failure this
    /// whole surface exists to prevent — the app this replaces polled the same
    /// screen at the same interval for the same reason. It only runs while
    /// somebody is looking at it.
    refetchInterval: 60_000,
  })

  const offers = useQuery({
    queryKey: offersKey(),
    queryFn: ({ signal }) => fetchOffers(signal),
  })

  const book = catalogue.data
  const currency = book?.currency ?? "IDR"
  const row = book?.items.find((item) => item.sku_code === sku.value)

  /// Promotions that could touch this garment.
  ///
  /// Could, not will. The engine decides what applies against a whole basket —
  /// quantities, thresholds, what else is in it, which combination gives the
  /// shopper the most — and none of that is knowable from one product. So this
  /// is scope only: the offers whose reach includes this SKU, its style, its
  /// division or one of its tags. A cashier reading it learns "this shirt is in
  /// the Lebaran promo", which is the true and useful sentence; the number
  /// still comes from the counter.
  ///
  /// `null` until the offers have arrived, so the card can tell "none reach
  /// it" from "not asked yet" — and an offers endpoint that fails costs the
  /// card, not the page.
  const touching =
    row === undefined || offers.data === undefined
      ? null
      : offers.data.running.filter((offer) => reaches(offer, row))

  return (
    // No page header: the product's name is the heading, and the bar already
    // carries the way back to the Catalogue.
    <Screen header={false}>
      {queryState(catalogue, {
        loading: "Reading this shop's range…",
        render: () =>
          row === undefined ? (
            <EmptyState>
              {sku.value === undefined
                ? "No article was named."
                : `${sku.value} is not in this shop's priced range.`}
            </EmptyState>
          ) : (
            <Detail
              row={row}
              siblings={
                row.article_code === null
                  ? []
                  : (book?.items ?? []).filter(
                      (item) => item.article_code === row.article_code,
                    )
              }
              currency={currency}
              touching={touching}
            />
          ),
      })}
    </Screen>
  )
}

function Detail({
  row,
  siblings,
  currency,
  touching,
}: {
  row: CatalogRow
  /// Every SKU of the same article, this one included.
  siblings: readonly CatalogRow[]
  currency: string
  touching: readonly StoreOffer[] | null
}) {
  const down = row.unit_price_minor < row.base_unit_price_minor
  // Whole percent, rounded down: "21% off" on something that is 20.6% off is
  // a promise the till will not keep to the rupiah.
  const percentOff =
    down && row.base_unit_price_minor > 0
      ? Math.floor(
          ((row.base_unit_price_minor - row.unit_price_minor) /
            row.base_unit_price_minor) *
            100,
        )
      : 0
  const division =
    row.division_code !== null && row.division_code !== ""
      ? row.division_code
      : null
  const go = useGo()
  const grid = useMemo(() => variantGrid(siblings), [siblings])

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-5 md:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] md:gap-7 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]">
      {/* The photograph. Full-bleed inside the screen's own 16px gutter on a
          phone — a photograph inset twice reads as a thumbnail of itself — and
          a card of its own on a desk, where it stands beside the facts and
          stays in view while they scroll. */}
      <div className="md:sticky md:top-6">
        <div className="-mx-4 -mt-4 aspect-[4/3] overflow-hidden bg-soft-2 md:mx-0 md:mt-0 md:aspect-[4/5] md:rounded-card md:border md:border-hairline md:shadow-soft">
          <Photograph sku={row.sku_code} has={row.has_image} name={row.name} />
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-7">
        <div>
          {down && (
            <div className="mb-2 flex flex-wrap items-center gap-1.5">
              <Pill tone="bad">Price down</Pill>
            </div>
          )}
          <h1 className="text-[1.375rem] leading-tight font-semibold tracking-[-0.02em] text-ink">
            {row.name}
          </h1>
          <p className="mt-1 font-mono text-id text-body">{row.sku_code}</p>

          {/* The price is what this page is asked for, so it is the one large
              figure on it. Both numbers when it is marked down, because a
              was-price with nothing struck through is just a smaller price. */}
          <div className="mt-5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-[1.75rem] leading-none font-semibold tracking-[-0.02em] text-ink tabular-nums">
              {money(row.unit_price_minor, currency)}
            </span>
            {down && (
              <>
                <span className="text-cell text-mute tabular-nums line-through">
                  {money(row.base_unit_price_minor, currency)}
                </span>
                <span className="text-meta font-medium text-bad-fg tabular-nums">
                  {money(row.base_unit_price_minor - row.unit_price_minor, currency)}{" "}
                  off
                  {percentOff > 0 && ` · ${percentOff}%`}
                </span>
              </>
            )}
          </div>

          {/* Where the number came from. A cashier asked "why is this
              different from the label" has an answer without ringing head
              office, and the answer is the node's own word for it rather than
              a guess. */}
          <p className="mt-2 text-meta text-body">
            {sourceSentence(row.price_source)}
          </p>
        </div>

        {siblings.length > 1 && (
          <Card>
            <h2 className="px-5 pt-5 pb-3.5 text-card-title font-semibold text-ink">
              Sizes and colours
              <span className="ml-1.5 font-normal text-mute tabular-nums">
                {count(siblings.length)}
              </span>
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-cell">
                <thead>
                  <tr className="bg-soft text-eyebrow font-medium text-body">
                    <th className="h-11 px-5 text-left font-medium">Colour</th>
                    {grid.sizes.map((size) => (
                      <th
                        key={size}
                        className="h-11 px-4 text-right font-medium"
                      >
                        {size}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {grid.colours.map((colour) => (
                    <tr key={colour} className="border-t border-hairline">
                      <th
                        scope="row"
                        className="h-16 px-5 text-left font-medium whitespace-nowrap text-ink"
                      >
                        {colour}
                      </th>
                      {grid.sizes.map((size) => {
                        const item = grid.cells.get(`${colour}|${size}`)
                        if (item === undefined)
                          return (
                            <td
                              key={size}
                              className="px-3 text-right text-mute"
                            >
                              —
                            </td>
                          )
                        const here = item.sku_code === row.sku_code
                        const cut =
                          item.unit_price_minor < item.base_unit_price_minor
                        return (
                          <td key={size} className="p-1 text-right">
                            <button
                              type="button"
                              disabled={here}
                              aria-current={here ? "true" : undefined}
                              onClick={() =>
                                go("/catalogue/product", { sku: item.sku_code })
                              }
                              className={cn(
                                "inline-flex min-h-12 flex-col items-end justify-center rounded-inner px-3 whitespace-nowrap tabular-nums transition-colors",
                                here
                                  ? "bg-accent text-on-dark"
                                  : "text-ink hover:bg-soft",
                              )}
                            >
                              {cut && (
                                <span
                                  className={cn(
                                    "text-meta line-through",
                                    here ? "opacity-70" : "text-mute",
                                  )}
                                >
                                  {money(item.base_unit_price_minor, currency)}
                                </span>
                              )}
                              <span className="font-medium">
                                {money(item.unit_price_minor, currency)}
                              </span>
                            </button>
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        {siblings.length > 0 && (
          <StockGrid grid={grid} current={row.sku_code} />
        )}

        <Card>
          <dl className="divide-y divide-hairline px-5">
            <DetailRow term="Division">
              {division === null ? "—" : label(division)}
            </DetailRow>
            {row.tags.length > 0 && (
              <DetailRow term="Tags">
                <span className="flex flex-wrap justify-end gap-1.5">
                  {row.tags.map((code) => (
                    <Tag key={code}>{code}</Tag>
                  ))}
                </span>
              </DetailRow>
            )}
          </dl>
        </Card>

        {touching !== null && (
          <Promotions touching={touching} />
        )}
      </div>
    </div>
  )
}

/// The running promotions whose reach includes this garment. Each opens in
/// place to its terms, so nobody is sent to another screen to read one.
function Promotions({ touching }: { touching: readonly StoreOffer[] }) {
  const [open, setOpen] = useState<string | null>(null)
  return (
    <Card>
      <h2 className="px-5 pt-5 pb-3.5 text-card-title font-semibold text-ink">
        In these promotions
        {touching.length > 0 && (
          <span className="ml-1.5 font-normal text-mute tabular-nums">
            {count(touching.length)}
          </span>
        )}
      </h2>

      {touching.length === 0 ? (
        <p className="border-t border-hairline px-5 py-4 text-meta text-body">
          No running promotion reaches this article.
        </p>
      ) : (
        <ul className="border-t border-hairline">
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
                  className="flex min-h-tap w-full items-center gap-3.5 px-5 py-3.5 text-left transition-colors hover:bg-soft active:bg-soft"
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
                  <div className="px-5 pt-1 pb-5">
                    <OfferDetail offer={offer} />
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
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

/// Whether an offer's scope reaches this garment.
///
/// Scope only — see the note where this is called. `null` applicability is the
/// whole cart, which reaches everything.
function reaches(offer: StoreOffer, row: CatalogRow): boolean {
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

/// One fact on one line: the term at the left, its answer at the right.
function DetailRow({
  term,
  children,
}: {
  term: string
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-14 items-center justify-between gap-4 py-3">
      <dt className="shrink-0 text-cell text-body">{term}</dt>
      <dd className="min-w-0 truncate text-right text-cell text-ink tabular-nums">
        {children}
      </dd>
    </div>
  )
}

/// The article's SKUs as colours down and sizes across.
///
/// The catalogue carries one name per SKU — "Kaos Basic Katun Combed Black S" —
/// and no separate colour or size. What every SKU of the article shares is the
/// article's name; the last word is the size; whatever is left between is the
/// colour. Both axes keep the order they first appear in, which is the order
/// the book was sent in.
function variantGrid(items: readonly CatalogRow[]) {
  const words = items.map((item) => item.name.split(/\s+/))
  let shared = 0
  while (
    words.every(
      (one) => one.length > shared + 1 && one[shared] === words[0]?.[shared],
    )
  )
    shared += 1
  const colours: string[] = []
  const sizes: string[] = []
  const cells = new Map<string, CatalogRow>()
  items.forEach((item, index) => {
    const one = words[index] ?? []
    const size = one.length > shared ? (one[one.length - 1] ?? "—") : "—"
    const joined = one.slice(shared, -1).join(" ")
    const colour = joined === "" ? "—" : joined
    if (!colours.includes(colour)) colours.push(colour)
    if (!sizes.includes(size)) sizes.push(size)
    cells.set(`${colour}|${size}`, item)
  })
  return { colours, sizes, cells }
}

type Room = "floor" | "warehouse" | "total"

/// The article's stock, colours down and sizes across, one room at a time.
///
/// Its own table rather than a second figure in the price cells: a price and
/// a count in one cell are two numbers nobody can tell apart at a glance.
function StockGrid({
  grid,
  current,
}: {
  grid: ReturnType<typeof variantGrid>
  current: string
}) {
  const [room, setRoom] = useState<Room>("total")
  const stock = useQuery({
    queryKey: skuStockKey(),
    queryFn: ({ signal }) => fetchSkuStock(signal),
    refetchInterval: 60_000,
  })
  // A node that does not serve the read yet costs this card, not the page.
  if (stock.isError) return null
  const bySku = new Map(
    (stock.data?.items ?? []).map((item) => [item.sku_code, item]),
  )

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5 pb-3.5">
        <h2 className="text-card-title font-semibold text-ink">Stock</h2>
        <Segmented<Room>
          value={room}
          onChange={setRoom}
          options={[
            { value: "floor", label: "Floor" },
            { value: "warehouse", label: "Warehouse" },
            { value: "total", label: "Total" },
          ]}
        />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-cell">
          <thead>
            <tr className="bg-soft text-eyebrow font-medium text-body">
              <th className="h-11 px-5 text-left font-medium">Colour</th>
              {grid.sizes.map((size) => (
                <th key={size} className="h-11 px-4 text-right font-medium">
                  {size}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.colours.map((colour) => (
              <tr key={colour} className="border-t border-hairline">
                <th
                  scope="row"
                  className="h-14 px-5 text-left font-medium whitespace-nowrap text-ink"
                >
                  {colour}
                </th>
                {grid.sizes.map((size) => {
                  const item = grid.cells.get(`${colour}|${size}`)
                  if (item === undefined)
                    return (
                      <td key={size} className="px-4 text-right text-mute">
                        —
                      </td>
                    )
                  const units =
                    stock.data === undefined
                      ? null
                      : (bySku.get(item.sku_code)?.[room] ?? 0)
                  return (
                    <td
                      key={size}
                      className={cn(
                        "px-4 text-right tabular-nums",
                        item.sku_code === current && "bg-soft font-semibold",
                        units === 0 ? "text-mute" : "text-ink",
                      )}
                    >
                      {units === null ? "…" : count(units)}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}
