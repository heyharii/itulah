import {
  columnFilteringFeature,
  createFilteredRowModel,
  filterFn_includesString,
  globalFilteringFeature,
  tableFeatures,
  useTable,
} from "@tanstack/react-table"
import { Link } from "@tanstack/react-router"
import { useMemo } from "react"

import { Icon, paths } from "@/components/dashboard/parts"
import {
  LEVEL_LABEL,
  MECHANIC_LABEL,
  rupiah,
  ruleMechanic,
  type CatalogueArticle,
  type CommercialModel,
  type PriceContext,
  type ResolvedPrice,
} from "@/components/commercial/model"
import {
  ResourceState,
  type CommercialResourceState,
} from "@/components/commercial/screens"
import { VirtualRows, useProgressiveCount } from "@/shared/table"
import { cn } from "@/lib/utils"
import { Route } from "@/routes/commercial"

/* Stated once; the header and every row are locked to the same track list.
 * These are the widths the old <colgroup> carried. */
const CATALOG_COLUMNS = "minmax(0,1fr) 148px 168px 150px 210px 128px"

const SOURCE_LABEL: Record<ResolvedPrice["source"], string> = {
  ...LEVEL_LABEL,
  markdown: "Markdown",
  base: "Base price",
  none: "No price",
}

const SOURCE_HUE: Record<ResolvedPrice["source"], string> = {
  "store-exact": "var(--accent-base)",
  "store-group": "var(--sky)",
  "member-tier": "var(--violet)",
  global: "var(--ink-4)",
  markdown: "var(--ember)",
  base: "var(--ink-4)",
  none: "var(--ink-4)",
}

/**
 * Every article at the price it would actually ring up at, for one store,
 * channel and tier — and where that price came from. Offers sit beside the
 * price rather than inside it, which is how the engine treats them.
 *
 * The hub publishes no article/family master on this deployment, so a row is
 * one SKU — which is also the key the price engine matches on.
 */
/* One accessor column, holding everything the search box matches on, and the
 * filtered row model that reads it. The table owns the row model; the URL owns
 * its state. */
const features = tableFeatures({
  columnFilteringFeature,
  globalFilteringFeature,
  filteredRowModel: createFilteredRowModel(),
  filterFns: { includesString: filterFn_includesString },
})

interface CatalogRow {
  article: CatalogueArticle
  price: ResolvedPrice
  offers: ReturnType<CommercialModel["offersFor"]>
}

const columns = [
  {
    id: "search",
    accessorFn: (row: CatalogRow) =>
      [
        row.article.name,
        row.article.code,
        row.article.id,
        ...row.article.skus,
      ].join(" "),
  },
]

export function Catalog({
  ctx,
  query,
  model,
  onOpen,
  resource,
}: {
  ctx: PriceContext
  query: string
  model: CommercialModel
  onOpen: (article: CatalogueArticle) => void
  resource: CommercialResourceState
}) {
  const { layout } = Route.useSearch()

  const priced = useMemo<CatalogRow[]>(
    () =>
      model.articles.map((article) => ({
        article,
        price: model.resolvePrice(article, ctx),
        offers: model.offersFor(article, ctx),
      })),
    [ctx, model]
  )

  const table = useTable({
    features,
    data: priced,
    columns,
    getRowId: (row) => row.article.id,
    globalFilterFn: "includesString",
    state: { globalFilter: query.trim() },
  })

  const rows = table.getRowModel().rows.map((row) => row.original)

  /* Grid view only; the table view is virtualised and renders a flat ~25 rows
   * whatever the count is. Hooks cannot be conditional, so this runs for both
   * and the table view simply ignores it. */
  const grid = useProgressiveCount(rows.length)
  const visible = rows.slice(0, grid.count)

  if (!resource.data)
    return <ResourceState resource={resource} label="catalogue" />

  return (
    <div>
      <div className="flex h-11 items-center gap-2 border-b border-line px-3.5">
        <span className="text-[11.5px] text-ink-3">{rows.length} items</span>
        <span className="ml-auto flex h-[28px] items-center gap-0.5 rounded-control bg-inset p-0.5 shadow-[inset_0_0_0_1px_var(--line)]">
          {(["table", "grid"] as const).map((option) => (
            <Link
              key={option}
              from="/commercial"
              to="/commercial"
              search={(prev) => ({ ...prev, layout: option })}
              replace
              aria-label={`${option} view`}
              className={cn(
                "grid h-[24px] w-[28px] place-items-center rounded-[7px] transition-colors",
                layout === option
                  ? "bg-surface text-ink shadow-btn"
                  : "text-ink-3 hover:text-ink"
              )}
            >
              <Icon
                path={option === "table" ? paths.table : paths.grid}
                size={14}
                width={1.9}
              />
            </Link>
          ))}
        </span>
      </div>

      {rows.length === 0 ? (
        <p className="px-3.5 py-12 text-center text-xs text-ink-4">
          The hub returned no items for this search.
        </p>
      ) : layout === "table" ? (
        <VirtualRows
          rows={rows}
          rowKey={(row) => row.article.id}
          columns={CATALOG_COLUMNS}
          rowHeight={56}
          onRowClick={({ article }) => onOpen(article)}
          className="min-w-[980px]"
          header={
            <>
              <span className="pl-3.5">Article</span>
              <span className="px-3">Division</span>
              <span className="px-3 text-right">Price</span>
              <span className="px-3">Comes from</span>
              <span className="px-3">Offers</span>
              <span className="pr-3.5 pl-3">Returns</span>
            </>
          }
          renderRow={({ article, price, offers }) => (
            <>
              <span
                role="gridcell"
                className="flex min-w-0 items-center gap-2.5 pr-3 pl-3.5"
              >
                <span className="grid size-[38px] shrink-0 place-items-center rounded-chip bg-inset font-mono text-[9px] text-ink-4">
                  {article.code.slice(-4)}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-xs font-medium text-ink">
                    {article.name}
                  </span>
                  <span className="block truncate font-mono text-[10.5px] text-ink-4">
                    {article.code}
                  </span>
                </span>
              </span>

              <span
                role="gridcell"
                className="min-w-0 px-3 text-[11.5px] text-ink-3"
              >
                <span className="block truncate">
                  {article.pricedOnly
                    ? "Priced only \u2014 no master record"
                    : article.division || "Unassigned"}
                </span>
              </span>

              <span role="gridcell" className="px-3 text-right">
                <span className="block font-mono text-[13px] font-medium text-ink tabular-nums">
                  {price.price === undefined ? "\u2014" : rupiah(price.price)}
                </span>
                {price.wasPrice !== undefined &&
                  price.wasPrice !== price.price && (
                    <span className="block font-mono text-[10.5px] text-ink-4 tabular-nums line-through">
                      {rupiah(price.wasPrice)}
                    </span>
                  )}
              </span>

              <span role="gridcell" className="px-3">
                <span
                  style={{ color: SOURCE_HUE[price.source] }}
                  className="flex items-center gap-1.5 text-[11px] font-medium"
                >
                  <span
                    style={{ background: SOURCE_HUE[price.source] }}
                    className="size-1.5 shrink-0 rounded-full"
                  />
                  {SOURCE_LABEL[price.source]}
                </span>
              </span>

              <span role="gridcell" className="px-3">
                {offers.length === 0 ? (
                  <span className="text-[11px] text-ink-4">\u2014</span>
                ) : (
                  <span className="flex flex-wrap gap-1">
                    {offers.slice(0, 2).map((offer) => (
                      <span
                        key={offer.id}
                        title={`${offer.name}${
                          model.campaignById(offer.campaignId)
                            ? ` \u00b7 ${model.campaignById(offer.campaignId)?.name}`
                            : ""
                        }`}
                        className="inline-flex h-[19px] items-center gap-1 rounded-[6px] bg-accent-tint px-1.5 text-[10.5px] font-medium text-accent-ink"
                      >
                        {MECHANIC_LABEL[ruleMechanic(offer)]}
                        {model.couponedRuleIds.has(offer.id) && (
                          <Icon path={paths.tag} size={9} width={2.4} />
                        )}
                      </span>
                    ))}
                    {offers.length > 2 && (
                      <span className="text-[10.5px] text-ink-4">
                        +{offers.length - 2}
                      </span>
                    )}
                  </span>
                )}
              </span>

              {/* The hub's return-policy collection is empty on this deployment,
                  so no row can claim what would happen if the item came back. */}
              <span role="gridcell" className="pr-3.5 pl-3">
                <span className="flex items-center gap-1.5 text-[11px] font-medium text-ink-4">
                  <span
                    style={{ background: "var(--ink-4)" }}
                    className="size-1.5 shrink-0 rounded-full"
                  />
                  No policy
                </span>
              </span>
            </>
          )}
        />
      ) : (
        <div className="p-3.5">
          {/* A real CSS grid, with the breakpoints it always had. The browser
           * does the column maths, so a narrower pane reflows for free — the
           * hand-positioned version could not, and spilled its cards out of
           * the container the moment the viewport shrank. Only the *count* is
           * managed, by `useProgressiveCount`, so the DOM never holds all
           * 1,551 cards at once. */}
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
            {visible.map(({ article, price, offers }) => (
              <button
                key={article.id}
                type="button"
                onClick={() => onOpen(article)}
                className="overflow-hidden rounded-card bg-surface text-left shadow-btn transition-shadow hover:shadow-card"
              >
                <span className="relative block aspect-[4/5] bg-inset">
                  <span className="grid size-full place-items-center font-mono text-[11px] text-ink-4">
                    {article.code}
                  </span>
                  {price.source === "markdown" && (
                    <span className="absolute top-2 left-2 rounded-chip bg-ember px-1.5 py-0.5 text-[10px] font-semibold text-white">
                      Markdown
                    </span>
                  )}
                </span>
                <span className="block p-2.5">
                  <span className="block truncate text-xs font-medium text-ink">
                    {article.name}
                  </span>
                  <span className="flex items-baseline gap-1.5 pt-0.5">
                    <span className="font-mono text-[13px] font-medium text-ink">
                      {price.price === undefined ? "—" : rupiah(price.price)}
                    </span>
                    {price.wasPrice !== undefined &&
                      price.wasPrice !== price.price && (
                        <span className="font-mono text-[10.5px] text-ink-4 line-through">
                          {rupiah(price.wasPrice)}
                        </span>
                      )}
                  </span>
                  <span className="flex flex-wrap gap-1 pt-1.5">
                    {offers.slice(0, 2).map((offer) => (
                      <span
                        key={offer.id}
                        className="inline-flex h-[18px] items-center rounded-[5px] bg-accent-tint px-1.5 text-[10px] font-medium text-accent-ink"
                      >
                        {MECHANIC_LABEL[ruleMechanic(offer)]}
                      </span>
                    ))}
                  </span>
                </span>
              </button>
            ))}
          </div>

          {/* Unmounted once everything is shown, rather than left observing. */}
          {!grid.done && (
            <div ref={grid.sentinelRef} aria-hidden className="h-px w-full" />
          )}
        </div>
      )}
    </div>
  )
}
