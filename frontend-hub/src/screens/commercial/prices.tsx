import { useQuery } from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Input, Select } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { TotalsLadder } from "@/components/ui/rows"
import { Segmented, Toolbar } from "@/components/ui/segmented"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { Banner, EmptyState } from "@/components/ui/states"
import { Tag } from "@/components/ui/tag"
import { count, day, money, moment } from "@/lib/format"
import {
  CHANNELS,
  commercialFleet,
  commercialKeys,
  describeSource,
  isMarkedDown,
  markdownDepthBps,
  resolveOffer,
  shelfPrices,
  type CommercialChannel,
  type PriceScope,
  type ShelfPrice,
} from "@/lib/queries/commercial"
import { queryState } from "@/lib/query-state"
import { useSheet } from "@/lib/sheets"
import { tableSetup, type TableSetup } from "@/lib/table"
import { percent } from "@/screens/commercial/shared"

/// What one shop is actually charging, product by product.
///
/// Answered by the shared pricing engine rather than by SQL of its own, and
/// that is the whole reason this screen can be trusted. Before that, the centre
/// read `commercial_price_rule` and knew nothing about clearance, so a shirt on
/// markdown showed here at list price while the counter charged the sale price.
/// The screen you check prices on is not the place to have a second opinion.
///
/// Promotions are deliberately absent. They are statements about a basket —
/// "buy two, get twenty per cent" is not this product's price, and a shelf edge
/// advertising it would promise a number the counter will not honour for one
/// item. `/commercial/simulate` is where a basket goes.

const columns: ColumnDef<TableSetup, ShelfPrice>[] = [
  {
    accessorKey: "sku_code",
    header: "SKU",
    size: 150,
    cell: ({ row }) => (
      <span className="font-mono text-id text-body">
        {row.original.sku_code}
      </span>
    ),
  },
  {
    accessorKey: "article_name",
    header: "Article",
    size: 260,
    cell: ({ row }) => (
      <span className="font-medium text-ink">{row.original.article_name}</span>
    ),
  },
  {
    accessorKey: "price_source",
    header: "Priced by",
    size: 140,
    cell: ({ row }) => (
      <Tag tone={row.original.price_source === "MARKDOWN" ? "warn" : "neutral"}>
        {describeSource(row.original.price_source)}
      </Tag>
    ),
  },
  {
    accessorKey: "version",
    header: "Book",
    size: 80,
    meta: { align: "right" },
    cell: ({ row }) => (
      <span className="font-mono text-id text-mute">
        v{row.original.version}
      </span>
    ),
  },
  {
    accessorKey: "base_unit_price_minor",
    header: "Was",
    size: 130,
    meta: { align: "right" },
    // Struck through only when the markdown is actually taking money off, so a
    // clearance authored at the base price does not advertise a saving of zero.
    cell: ({ row }) =>
      isMarkedDown(row.original) ? (
        <span className="text-mute line-through">
          {money(row.original.base_unit_price_minor)}
        </span>
      ) : (
        <span className="text-mute">—</span>
      ),
  },
  {
    accessorKey: "unit_price_minor",
    header: "Charged",
    size: 130,
    meta: { align: "right" },
    cell: ({ row }) => (
      <span className="font-medium text-ink">
        {money(row.original.unit_price_minor)}
      </span>
    ),
  },
  {
    id: "depth",
    accessorFn: (row) => markdownDepthBps(row),
    header: "Off",
    size: 90,
    meta: { align: "right" },
    // The decision metric, and why this list sorts by it: a zero is the ordinary
    // case and anything else is money somebody chose to give away.
    cell: ({ row }) => {
      const bps = markdownDepthBps(row.original)
      return bps > 0 ? (
        <span className="font-medium text-warn-fg">{percent(bps)}</span>
      ) : (
        <span className="text-mute">—</span>
      )
    },
  },
]

export function Prices() {
  const [query, setQuery] = useState("")
  const [siteId, setSiteId] = useState("")
  const [channel, setChannel] = useState<CommercialChannel>("STORE")
  const [at, setAt] = useState("")
  const price = useSheet("price")
  const [sorting, setSorting] = useState<SortingState>([
    { id: "depth", desc: true },
  ])

  // The shop list comes from the fleet read rather than a picker of its own:
  // the shops that can be priced are exactly the STORE origins the centre knows
  // about, and asking two endpoints "which shops exist" is how two screens come
  // to disagree about the answer.
  const fleet = useQuery({
    queryKey: commercialKeys.fleet(),
    queryFn: ({ signal }) => commercialFleet(signal),
  })

  const shops = useMemo(
    () => (fleet.data?.items ?? []).filter((shop) => shop.site_id !== null),
    [fleet.data]
  )

  // Derived, not synced. An effect that wrote the first shop into state
  // rendered once with nothing selected before correcting itself, and the
  // "which shop" question has an answer the moment the fleet arrives. An
  // explicit choice still wins — `siteId` is only empty until somebody picks.
  const chosenSite = siteId !== "" ? siteId : (shops[0]?.site_id ?? "")

  const scope: PriceScope = useMemo(
    () => ({ siteId: chosenSite, channel, at: at === "" ? undefined : at }),
    [chosenSite, channel, at]
  )

  const prices = useQuery({
    queryKey: commercialKeys.prices(scope),
    queryFn: ({ signal }) => shelfPrices(scope, signal),
    enabled: scope.siteId !== "",
  })

  const rows = useMemo(() => prices.data?.items ?? [], [prices.data])

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns,
        getRowId: (row: ShelfPrice) => row.sku_code,
        state: { globalFilter: query, sorting },
        onSortingChange: setSorting,
        onGlobalFilterChange: setQuery,
      }),
      [rows, query, sorting]
    )
  )

  const openRow = rows.find((row) => row.sku_id === price.value) ?? null

  return (
    <PageContent>
      <PageHeader
        crumb="Commercial"
        title="Prices"
        sub="Every product a shop may sell, at the price its own till will ring it up at."
      />

      <Toolbar>
        <Select
          value={chosenSite}
          aria-label="Shop"
          className="w-48"
          onChange={(event) => setSiteId(event.target.value)}
        >
          {shops.map((shop) => (
            <option key={shop.origin_id} value={shop.site_id!}>
              {shop.label ?? shop.site_id}
            </option>
          ))}
        </Select>
        <Segmented
          options={CHANNELS.map((one) => ({ value: one, label: one }))}
          value={channel}
          onChange={setChannel}
        />
        {/* The instant to price at, handed to the engine as an argument rather
            than read from a clock: asking what a shop will charge on the first
            morning of a campaign is the same code path as asking what it
            charges right now. */}
        <Input
          type="datetime-local"
          value={at}
          aria-label="Priced as at"
          className="h-8 w-52"
          onChange={(event) => setAt(event.target.value)}
        />
        <Toolbar.Spacer />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search"
          className="h-8 w-48"
        />
      </Toolbar>

      {at !== "" && (
        <Banner tone="info" className="mb-4" onDismiss={() => setAt("")}>
          Priced as at {moment(at)}, not now. Every number below is what this
          shop would have charged at that moment.
        </Banner>
      )}

      {fleet.isSuccess && shops.length === 0 && (
        <Banner tone="warn" className="mb-4">
          No shop origin is registered at the centre, so there is nowhere to
          price. Register a STORE node first.
        </Banner>
      )}

      <Card className="overflow-hidden">
        {scope.siteId === "" ? (
          <EmptyState>Pick a shop to see what it is charging.</EmptyState>
        ) : (
          queryState(prices, {
            loading: "Pricing the range…",
            render: (page) =>
              page.items.length === 0 ? (
                <EmptyState>
                  This shop has nothing it may sell on {channel}. A product with
                  no price is absent rather than free.
                </EmptyState>
              ) : (
                <DataTable<ShelfPrice>
                  table={table}
                  onRowClick={(row) =>
                    row.sku_id !== null && price.open(row.sku_id)
                  }
                  isSelected={(row) => row.sku_id === price.value}
                  empty="No product matches that search."
                  className="max-h-[calc(100vh-17rem)]"
                />
              ),
          })
        )}
      </Card>

      <PriceSheet
        skuId={price.value ?? null}
        scope={scope}
        listed={openRow}
        onClose={price.close}
      />
    </PageContent>
  )
}

/// One product, priced on its own.
///
/// It asks the engine again rather than dressing up the row it was clicked
/// from. That is the point: the list and this panel come from the same
/// evaluator, and being able to watch them agree is what makes the list
/// believable. When they do not, the price changed between the two calls — and
/// that is worth saying out loud rather than hiding behind the newer number.
function PriceSheet({
  skuId,
  scope,
  listed,
  onClose,
}: {
  skuId: string | null
  scope: PriceScope
  listed: ShelfPrice | null
  onClose: () => void
}) {
  const offer = useQuery({
    queryKey: commercialKeys.price(skuId ?? "", scope),
    queryFn: ({ signal }) => resolveOffer(skuId!, scope, signal),
    enabled: skuId !== null && scope.siteId !== "",
  })

  return (
    <Sheet
      open={skuId !== null}
      onOpenChange={(open) => !open && onClose()}
      id={offer.data?.sku_code ?? listed?.sku_code}
      title={listed?.article_name ?? "Price"}
    >
      {queryState(offer, {
        loading: "Asking the engine…",
        render: (resolved) => {
          const off = resolved.base_unit_price_minor - resolved.unit_price_minor
          const drifted =
            listed !== null &&
            listed.unit_price_minor !== resolved.unit_price_minor
          return (
            <div className="flex flex-col gap-5">
              <div className="flex flex-wrap items-center gap-2">
                <Pill tone={off > 0 ? "warn" : "neutral"}>
                  {describeSource(resolved.price_source)}
                </Pill>
                {off > 0 && (
                  <Pill tone="warn">
                    {percent(markdownDepthBps(resolved))} off
                  </Pill>
                )}
              </div>

              {drifted && (
                <Banner tone="warn">
                  The list had {money(listed!.unit_price_minor)} for this
                  product; the engine now answers{" "}
                  {money(resolved.unit_price_minor)}. The price changed between
                  the two questions — the number here is the newer one.
                </Banner>
              )}

              <Facts>
                <Fact term="Shop">{resolved.site_id}</Fact>
                <Fact term="Channel">{resolved.channel}</Fact>
                <Fact term="From book">v{resolved.version}</Fact>
                <Fact term="Tax class">{resolved.tax_category}</Fact>
                <Fact term="Priced at">{moment(resolved.as_of)}</Fact>
                <Fact term="Markdown">{resolved.markdown_id ?? "—"}</Fact>
              </Facts>

              {/* The server's own numbers, subtracted as integers. Minor units
                  are whole rupiah here, so this is exact — and it is the only
                  arithmetic on this screen. */}
              <TotalsLadder
                rows={[
                  {
                    label: "Before markdown",
                    value: money(resolved.base_unit_price_minor),
                  },
                  {
                    label: "Markdown takes off",
                    value: off > 0 ? `− ${money(off)}` : money(0),
                  },
                ]}
                total={{
                  label: "Charged at the till",
                  value: money(resolved.unit_price_minor),
                }}
              />

              {listed && (
                <p className="text-[0.71875rem] leading-relaxed text-mute">
                  Article {listed.article_code}. Promotions are not counted
                  here: they are statements about a basket, and this is one
                  item. {count(1)} of anything is priced the same way a till
                  prices it — see Simulate for a basket, priced as at{" "}
                  {day(resolved.as_of)}.
                </p>
              )}
            </div>
          )
        },
      })}
    </Sheet>
  )
}
