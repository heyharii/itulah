import { useQuery } from "@tanstack/react-query"
import { Barcode, Layers, Sparkles } from "lucide-react"

import { Pill } from "@/components/ui/pill"
import { KeyValue } from "@/components/ui/rows"
import { Screen, Section } from "@/components/ui/screen"
import { Banner, EmptyState } from "@/components/ui/states"
import { Tag } from "@/components/ui/tag"
import { count, label } from "@/lib/format"
import { useGo } from "@/lib/go"
import { useParam } from "@/lib/params"
import { catalogueKey, fetchCatalogue, fetchOffers, offersKey } from "@/lib/queries"
import { queryState } from "@/lib/query-state"
import { Photograph } from "@/screens/catalogue"
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
  const touching =
    row === undefined
      ? []
      : (offers.data?.running ?? []).filter((offer) => reaches(offer, row))

  return (
    <Screen foot="none">
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
              onOffers={() => go("/catalogue/offers")}
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
  touching: readonly StoreOffer[]
  onOffers: () => void
}) {
  const down = row.unit_price_minor < row.base_unit_price_minor
  const saved = row.base_unit_price_minor - row.unit_price_minor

  return (
    <div className="pb-6">
      {/* Full-bleed inside the screen's own 16px gutter: a photograph inset
          twice reads as a thumbnail of itself. */}
      <div className="-mx-4 aspect-[4/3] bg-soft-2">
        <Photograph sku={row.sku_code} has={row.has_image} />
      </div>

      <div className="pt-4">
        <h1 className="text-hero font-semibold text-ink">{row.name}</h1>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <span className="font-mono text-id text-body">{row.sku_code}</span>
          {row.division_code !== null && row.division_code !== "" && (
            <Pill>{label(row.division_code)}</Pill>
          )}
          {down && <Pill tone="bad">Price down</Pill>}
        </div>

        <div className="mt-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-hero font-semibold text-ink tabular-nums">
            {money(row.unit_price_minor, currency)}
          </span>
          {down && (
            <>
              <span className="text-body text-mute line-through tabular-nums">
                {money(row.base_unit_price_minor, currency)}
              </span>
              <span className="text-meta font-medium text-bad-fg tabular-nums">
                {money(saved, currency)} off
              </span>
            </>
          )}
        </div>

        {/* Where the number came from. A cashier asked "why is this different
            from the label" has an answer without ringing head office, and the
            answer is the node's own word for it rather than a guess. */}
        <p className="mt-1.5 text-meta text-body">
          {sourceSentence(row.price_source)} · Book #
          {count(row.publication_version)}
        </p>
      </div>

      {row.tags.length > 0 && (
        <Section title="Filed under" className="mt-5">
          <div className="flex flex-wrap gap-1.5">
            {row.tags.map((code) => (
              <Tag key={code}>{code}</Tag>
            ))}
          </div>
        </Section>
      )}

      {touching.length > 0 && (
        <Section title="In these promotions" className="mt-5">
          <div className="flex flex-col gap-2">
            {touching.map((offer) => (
              <button
                key={offer.rule_id}
                type="button"
                onClick={onOffers}
                className="pressable flex items-center gap-2.5 rounded-card border border-hairline bg-canvas px-3.5 py-3 text-left shadow-soft"
              >
                <Sparkles className="size-[1.125rem] shrink-0 text-accent" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-card-title font-medium text-ink">
                    {offer.name}
                  </span>
                  {offer.campaign_name !== null && (
                    <span className="block truncate text-pill text-mute">
                      {offer.campaign_name}
                    </span>
                  )}
                </span>
                {offer.coupon_code !== null && (
                  <Pill tone="accent">Needs a code</Pill>
                )}
              </button>
            ))}
          </div>
          {/* The honest caveat, said once. Whether a promotion actually fires
              depends on the whole basket, and a screen that implied otherwise
              would have a cashier promising a discount the counter then does
              not give. */}
          <p className="mt-2 text-pill text-mute">
            What a promotion is worth depends on the whole basket. The counter
            works it out at payment.
          </p>
        </Section>
      )}

      <Section title="Details" className="mt-5">
        <div className="overflow-hidden rounded-card border border-hairline bg-canvas shadow-soft">
          <div className="px-3.5">
            <KeyValue term="Barcode">
              {row.barcode === null ? (
                "—"
              ) : (
                <span className="inline-flex items-center gap-1.5">
                  <Barcode className="size-3.5 text-line-ico" />
                  <span className="font-mono">{row.barcode}</span>
                </span>
              )}
            </KeyValue>
            <KeyValue term="Style">
              {row.article_code === null ? (
                "—"
              ) : (
                <span className="inline-flex items-center gap-1.5">
                  <Layers className="size-3.5 text-line-ico" />
                  <span className="font-mono">{row.article_code}</span>
                </span>
              )}
            </KeyValue>
            <KeyValue term="Sold in">{row.uom}</KeyValue>
            <KeyValue term="Tax class">{label(row.tax_category)}</KeyValue>
          </div>
        </div>
      </Section>

      {/* Not a defect, and worth saying plainly rather than leaving a grey box.
          The photograph travels with the catalogue from head office; a style
          set up before anybody uploaded one simply has none. */}
      {!row.has_image && (
        <Banner className="mt-4">
          Head office has not uploaded a photograph for this style.
        </Banner>
      )}
    </div>
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
        row.article_code !== null && scope.article_codes.includes(row.article_code)
      )
    case "DIVISION":
      return (
        row.division_code !== null && scope.divisions.includes(row.division_code)
      )
    case "TAG":
      return row.tags.some((tag) => scope.tags.includes(tag))
    case "WHOLE_CART":
      return true
  }
}
