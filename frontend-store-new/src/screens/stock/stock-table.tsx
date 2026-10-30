import { ArticleCell } from "@/components/article-cell"
import { count, sku } from "@/lib/format"
import { cn } from "@/lib/utils"
import { Photograph } from "@/screens/catalogue-parts"
import {
  figureLabel,
  sum,
  type Counts,
  type Figure,
  type StockArticle,
} from "@/screens/stock/stock-model"

/// Stock as a flat, bordered table: one row per article (totals of its SKUs)
/// or one row per SKU. Every row carries the photo, the id, the name, the
/// division and the tags, then the figures: the places on screen, their Total
/// when there are two, and Reject beside them.

export type Grain = "sku" | "article"

/// A place's colour: the sales floor is the shop's blue, the store room a
/// neutral, the reject an amber — the same dot in the KPI and the heading.
export function PoolDot({ pool }: { pool: Figure }) {
  return (
    <span
      aria-hidden
      className={cn(
        "size-2 shrink-0 rounded-full",
        pool === "floor" && "bg-accent",
        pool === "warehouse" && "bg-line-ico",
        (pool === "reject" || pool === "over" || pool === "ho") && "bg-warn",
      )}
    />
  )
}

function Cell({ value }: { value: number }) {
  return (
    <span
      className={cn(
        "px-1 text-right tabular-nums md:px-3",
        value === 0 ? "text-faint" : "text-ink",
      )}
    >
      {count(value)}
    </span>
  )
}

interface Line {
  readonly key: string
  readonly article: StockArticle
  readonly id: string
  readonly label: string | null
  readonly photo: { readonly sku: string; readonly has: boolean }
  readonly counts: Counts
}

function linesOf(articles: readonly StockArticle[], grain: Grain): Line[] {
  if (grain === "sku")
    return articles.flatMap((article) =>
      article.skus.map((one) => ({
        key: one.sku,
        article,
        id: sku(one.sku),
        label: one.label,
        photo: { sku: one.sku, has: one.hasImage },
        counts: one,
      })),
    )
  return articles.map((article) => ({
    key: article.key,
    article,
    id: sku(article.key),
    label: null,
    photo: { sku: article.photoSku ?? "", has: article.photoSku !== null },
    counts: {
      floor: sum(article.skus, "floor"),
      warehouse: sum(article.skus, "warehouse"),
      reject: sum(article.skus, "reject"),
      over: sum(article.skus, "over"),
      ho: sum(article.skus, "ho"),
    },
  }))
}

export function StockTable({
  articles,
  pools,
  grain,
  showReject,
}: {
  articles: readonly StockArticle[]
  /// The places (or pockets) drawn as columns; with more than one, a Total
  /// follows.
  pools: readonly Figure[]
  grain: Grain
  /// A Reject column after the places.
  showReject: boolean
}) {
  const lines = linesOf(articles, grain)
  const totalled = false
  const n = pools.length + (totalled ? 1 : 0) + (showReject ? 1 : 0)
  const grid = cn(
    "grid items-center",
    "grid-cols-[minmax(0,1fr)_repeat(var(--n),3.5rem)] md:grid-cols-[minmax(0,1fr)_repeat(var(--n),6rem)]",
  )
  const style = { "--n": n } as React.CSSProperties
  return (
    <div className="rounded-card border border-hairline bg-canvas">
      <div
        style={style}
        className={cn(
          grid,
          "sticky top-0 z-10 rounded-t-card border-b border-hairline bg-canvas/95 text-[0.9375rem] font-medium text-body backdrop-blur",
        )}
      >
        <div className="px-3 py-3 md:px-4">
          {grain === "sku" ? "SKU" : "Article"}
        </div>
        {pools.map((pool) => (
          <Heading key={pool} pool={pool} />
        ))}
        {totalled && <div className="px-1 text-right md:px-3">Total</div>}
        {showReject && <Heading pool="reject" />}
      </div>

      {lines.length === 0 ? (
        <div className="px-4 py-12 text-center text-[0.9375rem] text-mute">
          No articles
        </div>
      ) : (
        lines.map((line) => (
          <div
            key={line.key}
            style={style}
            className={cn(
              grid,
              "min-h-24 border-b border-hairline text-[0.9375rem] text-ink last:border-0",
            )}
          >
            <div className="min-w-0 px-3 py-4 md:px-5">
              <ArticleCell
                photo={
                  line.photo.has ? (
                    <Photograph
                      sku={line.photo.sku}
                      has
                      name={line.article.name}
                    />
                  ) : null
                }
                id={line.id}
                name={
                  line.label === null
                    ? line.article.name
                    : `${line.article.name} ${line.label}`
                }
                division={line.article.division}
                tags={line.article.tags}
              />
            </div>
            {pools.map((pool) => (
              <Cell key={pool} value={line.counts[pool]} />
            ))}
            {totalled && (
              <Cell
                value={pools.reduce(
                  (total, pool) => total + line.counts[pool],
                  0,
                )}
              />
            )}
            {showReject && <Cell value={line.counts.reject} />}
          </div>
        ))
      )}
    </div>
  )
}

function Heading({ pool }: { pool: Figure }) {
  return (
    <div className="flex items-center justify-end gap-1.5 px-1 text-right leading-tight md:px-3">
      <span className="max-md:hidden">
        <PoolDot pool={pool} />
      </span>
      {figureLabel(pool)}
    </div>
  )
}
