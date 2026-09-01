import { useQuery } from "@tanstack/react-query"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { Toolbar } from "@/components/ui/segmented"
import { Segmented } from "@/components/ui/segmented"
import { Banner, EmptyState } from "@/components/ui/states"
import { Tag } from "@/components/ui/tag"
import { count, money } from "@/lib/format"
import { queryState } from "@/lib/query-state"
import {
  articlePrices,
  commercialKeys,
  type ArticlePriceRow,
} from "@/lib/queries/commercial"

const CHANNELS = ["STORE", "ONLINE"] as const

/// One article, priced across every shop at once.
///
/// `Prices` answers "what does this shop charge"; this answers "does every shop
/// charge the same", and they are different enough questions to be different
/// screens. The second one is the one that catches a shop still selling from an
/// older book — which is invisible on a per-shop list, because each shop looks
/// perfectly consistent with itself.
///
/// The columns are shops, so this is the one table in the app whose shape comes
/// from the data. A hard-coded set of shops would be wrong the day the client
/// opens another one.
export function AcrossShops() {
  const [query, setQuery] = useState("")
  const [channel, setChannel] = useState<(typeof CHANNELS)[number]>("STORE")

  const prices = useQuery({
    queryKey: commercialKeys.articlePrices(channel, null),
    queryFn: ({ signal }) => articlePrices({ channel, limit: 200 }, signal),
  })

  const needle = query.trim().toLowerCase()
  const items = useMemo(() => {
    const all = prices.data?.items ?? []
    if (needle === "") return all
    return all.filter(
      (row) =>
        row.article_code.toLowerCase().includes(needle) ||
        (row.article_name ?? "").toLowerCase().includes(needle)
    )
  }, [prices.data, needle])

  return (
    <PageContent>
      <PageHeader
        crumb="Commercial"
        title="Across shops"
        sub="One article at every till at once. A shop that is quietly still on an older book looks consistent on its own list and only shows up here."
      />

      <Toolbar>
        <Segmented
          options={CHANNELS.map((one) => ({ value: one, label: one }))}
          value={channel}
          onChange={setChannel}
        />
        <Toolbar.Spacer />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search article"
          className="h-8 w-56"
        />
      </Toolbar>

      {queryState(prices, {
        loading: "Pricing the range across every shop…",
        render: (page) => (
          <>
            {page.article_count < page.total_article_count && (
              // Never let a capped list read as a complete one.
              <Banner tone="info" className="mb-4">
                Showing {count(page.article_count)} of{" "}
                {count(page.total_article_count)} articles. Search to reach the
                rest.
              </Banner>
            )}

            {items.length === 0 ? (
              <EmptyState>
                {needle === ""
                  ? "Nothing is priced on this channel yet."
                  : `No article matches “${query}”.`}
              </EmptyState>
            ) : (
              <div className="flex flex-col gap-3">
                {items.map((row) => (
                  <ArticleCard key={row.article_code} row={row} />
                ))}
              </div>
            )}
          </>
        ),
      })}
    </PageContent>
  )
}

/// One article's row of shops.
///
/// Rendered as a card rather than a table row because the number of shops is
/// data: a table would need a column model that changes with the fleet, and the
/// question here is "are these the same", which reads better as a row of
/// figures than as a grid.
function ArticleCard({ row }: { row: ArticlePriceRow }) {
  // The comparison the screen exists for, done once here rather than by eye.
  const prices = row.shops
    .map((shop) => shop.stack[0]?.min_unit_price_minor)
    .filter((value): value is number => value !== undefined)
  const agreed = prices.length > 0 && new Set(prices).size === 1
  const versions = new Set(
    row.shops
      .map((shop) => shop.stack[0]?.publication_version)
      .filter((value): value is number => value !== null && value !== undefined)
  )

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-2.5 border-b border-hairline bg-soft px-4 py-2.5">
        <span className="font-mono text-id text-body">{row.article_code}</span>
        <span className="min-w-0 flex-1 truncate text-card-title font-semibold text-ink">
          {row.article_name ?? "—"}
        </span>
        {row.division_code && <Tag>{row.division_code}</Tag>}
        <span className="text-[0.71875rem] text-mute">
          {count(row.sku_count)} SKU
        </span>
        {/* Agreement is the answer, so it is said rather than left to be
            noticed. A single price everywhere is `ok`; anything else is a
            question somebody has to look at, not a failure. */}
        <Pill tone={agreed ? "ok" : "warn"}>
          {agreed ? "Same everywhere" : "Differs by shop"}
        </Pill>
      </div>

      <div className="flex flex-wrap gap-x-6 gap-y-2.5 px-4 py-3">
        {row.shops.map((shop) => {
          const top = shop.stack[0]
          const behind =
            top?.publication_version !== null &&
            top?.publication_version !== undefined &&
            versions.size > 1 &&
            top.publication_version < Math.max(...versions)
          return (
            <div key={shop.site_id} className="min-w-[8rem]">
              <div className="text-[0.65625rem] tracking-[0.04em] text-mute uppercase">
                {shop.label ?? shop.site_id}
              </div>
              <div className="mt-0.5 text-[0.9375rem] font-semibold text-ink tabular-nums">
                {top === undefined
                  ? "—"
                  : top.min_unit_price_minor === top.max_unit_price_minor
                    ? money(top.min_unit_price_minor)
                    : `${money(top.min_unit_price_minor)}–${money(top.max_unit_price_minor)}`}
              </div>
              <div className="mt-0.5 text-[0.65625rem] text-mute">
                {top?.source ?? "no rule"}
                {top?.publication_version !== null &&
                  top?.publication_version !== undefined &&
                  ` · v${top.publication_version}`}
                {behind && <span className="ml-1 text-warn-fg">behind</span>}
              </div>
            </div>
          )
        })}
      </div>
    </Card>
  )
}
