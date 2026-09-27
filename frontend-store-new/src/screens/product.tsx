import { useQuery } from "@tanstack/react-query"
import { Barcode, ChevronRight, Layers, Sparkles } from "lucide-react"

import { Card } from "@/components/ui/card"
import { Pill } from "@/components/ui/pill"
import { Screen } from "@/components/ui/screen"
import { EmptyState } from "@/components/ui/states"
import { Tag } from "@/components/ui/tag"
import { count, label } from "@/lib/format"
import { useGo } from "@/lib/go"
import { useParam } from "@/lib/params"
import {
  catalogueKey,
  fetchCatalogue,
  fetchOffers,
  offersKey,
} from "@/lib/queries"
import { queryState } from "@/lib/query-state"
import { Photograph } from "@/screens/catalogue"
import { Fact, Facts, OfferPill } from "@/screens/promotions/parts"
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
  const go = useGo()
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
                ? "No product was named."
                : `${sku.value} is not in this shop's priced range.`}
            </EmptyState>
          ) : (
            <Detail
              row={row}
              currency={currency}
              touching={touching}
              onOffers={() => go("/promotions")}
            />
          ),
      })}
    </Screen>
  )
}

function Detail({
  row,
  currency,
  touching,
  onOffers,
}: {
  row: CatalogRow
  currency: string
  touching: readonly StoreOffer[] | null
  onOffers: () => void
}) {
  const down = row.unit_price_minor < row.base_unit_price_minor
  const saved = row.base_unit_price_minor - row.unit_price_minor
  // Whole percent, rounded down: "21% off" on something that is 20.6% off is
  // a promise the till will not keep to the rupiah.
  const percentOff =
    down && row.base_unit_price_minor > 0
      ? Math.floor((saved / row.base_unit_price_minor) * 100)
      : 0
  const division =
    row.division_code !== null && row.division_code !== ""
      ? row.division_code
      : null

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-5 md:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] md:gap-7 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]">
      {/* The photograph. Full-bleed inside the screen's own 16px gutter on a
          phone — a photograph inset twice reads as a thumbnail of itself — and
          a card of its own on a desk, where it stands beside the facts and
          stays in view while they scroll. */}
      <div className="md:sticky md:top-6">
        <div className="-mx-4 -mt-4 aspect-[4/3] overflow-hidden bg-soft-2 md:mx-0 md:mt-0 md:aspect-[4/5] md:rounded-card md:border md:border-hairline md:shadow-soft">
          <Photograph sku={row.sku_code} has={row.has_image} />
        </div>
        {/* Not a defect, and worth saying plainly rather than leaving a grey
            box. The photograph travels with the catalogue from head office; a
            style set up before anybody uploaded one simply has none. */}
        {!row.has_image && (
          <p className="mt-2 text-meta text-mute">
            Head office has not uploaded a photograph for this style.
          </p>
        )}
      </div>

      <div className="flex min-w-0 flex-col gap-5">
        <div>
          {(division !== null || down) && (
            <div className="mb-2 flex flex-wrap items-center gap-1.5">
              {division !== null && <Pill>{label(division)}</Pill>}
              {down && <Pill tone="bad">Price down</Pill>}
            </div>
          )}
          <h1 className="text-[1.375rem] leading-tight font-semibold tracking-[-0.02em] text-ink">
            {row.name}
          </h1>
          <p className="mt-1 font-mono text-id text-body">{row.sku_code}</p>

          {/* The price is what this page is asked for, so it is the one large
              figure on it. Both numbers when it is marked down, because a
              was-price with nothing struck through is just a smaller price. */}
          <div className="mt-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-[1.75rem] leading-none font-semibold tracking-[-0.02em] text-ink tabular-nums">
              {money(row.unit_price_minor, currency)}
            </span>
            {down && (
              <>
                <span className="text-cell text-mute tabular-nums line-through">
                  {money(row.base_unit_price_minor, currency)}
                </span>
                <span className="text-meta font-medium text-bad-fg tabular-nums">
                  {money(saved, currency)} off
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
            {sourceSentence(row.price_source)} · Price book #
            <span className="tabular-nums">
              {count(row.publication_version)}
            </span>
          </p>
        </div>

        <Card>
          <h2 className="px-4 pt-3.5 pb-2.5 text-card-title font-semibold text-ink">
            Details
          </h2>
          <div className="px-4 pb-4">
            <Facts>
              <Fact term="Barcode">
                {row.barcode === null ? (
                  "—"
                ) : (
                  <span className="inline-flex items-center gap-1.5">
                    <Barcode className="size-3.5 shrink-0 text-line-ico" />
                    <span className="truncate font-mono">{row.barcode}</span>
                  </span>
                )}
              </Fact>
              <Fact term="Style">
                {row.article_code === null ? (
                  "—"
                ) : (
                  <span className="inline-flex items-center gap-1.5">
                    <Layers className="size-3.5 shrink-0 text-line-ico" />
                    <span className="truncate font-mono">
                      {row.article_code}
                    </span>
                  </span>
                )}
              </Fact>
              <Fact term="Division">
                {division === null ? "—" : label(division)}
              </Fact>
              <Fact term="Sold in">{row.uom}</Fact>
              <Fact term="Tax class">{label(row.tax_category)}</Fact>
              <Fact term="Base price">
                {money(row.base_unit_price_minor, currency)}
              </Fact>
            </Facts>
          </div>
          {row.tags.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 border-t border-hairline px-4 py-3">
              <span className="mr-1 text-meta text-mute">Filed under</span>
              {row.tags.map((code) => (
                <Tag key={code}>{code}</Tag>
              ))}
            </div>
          )}
        </Card>

        {touching !== null && (
          <Promotions touching={touching} onOffers={onOffers} />
        )}
      </div>
    </div>
  )
}

/// The running promotions whose reach includes this garment, each one a door
/// to the Promotions board where its whole detail is.
function Promotions({
  touching,
  onOffers,
}: {
  touching: readonly StoreOffer[]
  onOffers: () => void
}) {
  return (
    <Card>
      <div className="flex items-center justify-between gap-3 px-4 pt-3.5 pb-2.5">
        <h2 className="text-card-title font-semibold text-ink">
          In these promotions
          {touching.length > 0 && (
            <span className="ml-1.5 font-normal text-mute tabular-nums">
              {count(touching.length)}
            </span>
          )}
        </h2>
        <button
          type="button"
          onClick={onOffers}
          className="-mr-2 inline-flex h-8 items-center gap-0.5 rounded-inner px-2 text-meta font-medium text-accent transition-colors hover:bg-accent-bg pointer-coarse:h-tap"
        >
          All promotions
          <ChevronRight className="size-3.5" />
        </button>
      </div>

      {touching.length === 0 ? (
        <p className="border-t border-hairline px-4 py-4 text-meta text-body">
          No running promotion reaches this product. A markdown, when there is
          one, is already in the price above.
        </p>
      ) : (
        <>
          <ul className="border-t border-hairline">
            {touching.map((offer) => (
              <li
                key={offer.rule_id}
                className="border-b border-hairline last:border-b-0"
              >
                <button
                  type="button"
                  onClick={onOffers}
                  className="flex min-h-tap w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-soft active:bg-soft"
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
                </button>
              </li>
            ))}
          </ul>
          {/* The honest caveat, said once. Whether a promotion actually fires
              depends on the whole basket, and a screen that implied otherwise
              would have a cashier promising a discount the counter then does
              not give. */}
          <p className="border-t border-hairline bg-soft px-4 py-2.5 text-meta text-mute">
            What a promotion is worth depends on the whole basket. The counter
            works it out at payment.
          </p>
        </>
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
