import { useMemo, useState } from "react"

import { Icon, paths } from "@/components/dashboard/parts"
import {
  ARTICLES,
  MOVE_META,
  ageOf,
  articleOf,
  colourName,
  divisionOf,
  percent,
  total,
  INV_LOCATIONS,
  SKU_ROWS,
  type Bucket,
  type InvLocation,
  type Position,
  type SkuRow,
} from "@/components/inventory/data"
import { shortDate } from "@/lib/day"
import { VirtualRows } from "@/shared/table"
import { cn } from "@/lib/utils"

const num = "font-mono text-xs tabular-nums"

/* Sub-rows carry this tint instead of the plain surface, so nesting reads
 * without a table's rule lines. Applied per gridcell rather than on the row
 * wrapper: VirtualRows owns that div and does not expose a per-row class. */
const nestedRow = "bg-[color-mix(in_srgb,var(--inset)_45%,var(--surface))]"

/* The row-hover reveal (`group-hover/row:`) elsewhere in the app depends on a
 * `group/row` class on the `<tr>`. VirtualRows' row wrapper carries no such
 * class, but it always sets `role="row"`, which is enough to key off of with
 * an arbitrary variant — the same ancestor-selector idiom already used in
 * ui/sidebar.tsx (`[[data-side=left]_&]:...`). */
const revealOnRowHover = "[[role=row]:hover_&]:opacity-100"

type InventorySource = "legacy" | "pool"

/** Where the drill-down currently is. */
export interface Focus {
  locationId: string
  bucketId?: string
  /** Set when the bucket has stages and one of them is being read. */
  stageId?: string
}

/* ── the cells the three numbers share ───────────────────────── */

function ObservedCell({
  position,
  live = false,
  source = "legacy",
}: {
  position: Position
  live?: boolean
  source?: InventorySource
}) {
  if (live && source === "pool") {
    return (
      <span className="block text-right">
        <span className={cn(num, "text-ink-4")}>—</span>
        <span className="block text-[10.5px] text-ink-4">
          observation feed unavailable
        </span>
      </span>
    )
  }
  const rate = percent(position.observed, position.stock)
  const age = ageOf(position.lastObserved)
  return (
    <span className="block text-right">
      <span className="flex items-baseline justify-end gap-1.5">
        <span className={cn(num, "text-ink")}>
          {position.observed.toLocaleString()}
        </span>
        <span
          className={cn(
            "font-mono text-[11px] tabular-nums",
            rate >= 98 ? "text-grass" : rate >= 95 ? "text-honey" : "text-ember"
          )}
        >
          {rate}%
        </span>
      </span>
      <span className="block text-[10.5px] text-ink-4">
        {live
          ? "from inventory balance"
          : position.lastObserved
            ? `${shortDate(position.lastObserved)} · ${age}d`
            : "never read"}
      </span>
    </span>
  )
}

function MissingCell({
  position,
  source = "legacy",
}: {
  position: Position
  source?: InventorySource
}) {
  if (source === "pool") {
    return (
      <span className="block text-right text-[11px] text-ink-4">
        not supplied
      </span>
    )
  }
  const rate = percent(position.missing, position.stock)
  if (position.missing === 0) {
    return <span className={cn(num, "block text-right text-ink-4")}>—</span>
  }
  return (
    <span className="flex items-baseline justify-end gap-1.5">
      <span className={cn(num, "text-ember")}>
        {position.missing.toLocaleString()}
      </span>
      <span className="font-mono text-[11px] text-ember/70 tabular-nums">
        {rate}%
      </span>
    </span>
  )
}

function CountCell({
  position,
  onCount,
  countable = true,
  enabled = true,
}: {
  position: Position
  onCount: () => void
  countable?: boolean
  enabled?: boolean
}) {
  const age = ageOf(position.lastCount)
  const stale = age !== null && age > 60

  /* stock on a truck has no shelf to count it against */
  if (!countable || !enabled) {
    return (
      <span className="block text-right text-[11px] text-ink-4">
        {!enabled ? "Pool count pending" : "Not counted"}
      </span>
    )
  }

  return (
    <span className="flex items-center justify-end gap-2">
      <span className="text-right">
        <span className={cn(num, stale ? "text-honey" : "text-ink-2")}>
          {position.lastCount
            ? shortDate(position.lastCount)
            : position.lastCountKnown
              ? "never"
              : "not available"}
        </span>
        {age !== null && (
          <span
            className={cn(
              "block text-[10.5px]",
              stale ? "text-honey" : "text-ink-4"
            )}
          >
            {age}d ago
          </span>
        )}
      </span>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation()
          onCount()
        }}
        className={cn(
          "inline-flex h-[24px] shrink-0 items-center rounded-control px-2 text-[11px] font-medium text-ink-3 opacity-0 transition-[opacity,color] hover:bg-hover-2 hover:text-ink",
          revealOnRowHover
        )}
      >
        Count
      </button>
    </span>
  )
}

/* ── level one: every location, opened into its buckets ──────── */

const LOCATION_COLUMNS = "minmax(0,1fr) 110px 148px 118px 176px"

/**
 * One row of the location feed: a location, one of its buckets while the
 * location is expanded, or an outbound stage while that bucket is expanded.
 * Flat rather than nested — a virtualizer positions by index, so a bucket has
 * to sit beside its location rather than inside it.
 */
type LocationFeedEntry =
  | {
      kind: "location"
      location: InvLocation
      position: Position
      expanded: boolean
    }
  | {
      kind: "bucket"
      key: string
      location: InvLocation
      bucket: Bucket
      position: Position
      hasStages: boolean
      stagesOpen: boolean
    }
  | {
      kind: "stage"
      key: string
      location: InvLocation
      bucket: Bucket
      stage: Bucket
      position: Position
    }

export function LocationTable({
  onOpen,
  onCount,
  locations = INV_LOCATIONS,
  rows = SKU_ROWS,
  live = false,
  countEnabled = true,
  source = "legacy",
}: {
  onOpen: (focus: Focus) => void
  onCount: (focus: Focus) => void
  locations?: InvLocation[]
  rows?: SkuRow[]
  live?: boolean
  countEnabled?: boolean
  source?: InventorySource
}) {
  const [open, setOpen] = useState<string[]>(
    locations[0] ? [locations[0].id] : []
  )

  const rowsAt = (locationId: string, bucketId?: string, stageId?: string) =>
    rows.filter(
      (row) =>
        row.locationId === locationId &&
        (!bucketId || row.bucketId === bucketId) &&
        (!stageId || row.stageId === stageId)
    )

  const toggle = (id: string) =>
    setOpen((list) =>
      list.includes(id) ? list.filter((x) => x !== id) : [...list, id]
    )

  const feed = useMemo<LocationFeedEntry[]>(() => {
    const list: LocationFeedEntry[] = []
    for (const location of locations) {
      const position = total(rowsAt(location.id))
      const expanded = open.includes(location.id)
      list.push({ kind: "location", location, position, expanded })
      if (!expanded) continue

      for (const bucket of location.buckets) {
        const bucketPosition = total(rowsAt(location.id, bucket.id))
        const stages = bucket.stages ?? []
        const bucketKey = `${location.id}-${bucket.id}`
        const stagesOpen = open.includes(bucketKey)
        list.push({
          kind: "bucket",
          key: bucketKey,
          location,
          bucket,
          position: bucketPosition,
          hasStages: stages.length > 0,
          stagesOpen,
        })

        /* picked, packed, shipment — the steps outbound work passes through */
        if (stagesOpen && stages.length) {
          for (const stage of stages) {
            list.push({
              kind: "stage",
              key: `${bucketKey}-${stage.id}`,
              location,
              bucket,
              stage,
              position: total(rowsAt(location.id, bucket.id, stage.id)),
            })
          }
        }
      }
    }
    return list
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locations, rows, open])

  return (
    <VirtualRows
      rows={feed}
      rowKey={(entry) =>
        entry.kind === "location" ? entry.location.id : entry.key
      }
      columns={LOCATION_COLUMNS}
      rowHeight={(entry) => (entry.kind === "location" ? 44 : 34)}
      className="min-w-[820px]"
      onRowClick={(entry) => {
        if (entry.kind === "location") {
          toggle(entry.location.id)
        } else if (entry.kind === "bucket") {
          if (entry.hasStages) {
            toggle(entry.key)
          } else {
            onOpen({ locationId: entry.location.id, bucketId: entry.bucket.id })
          }
        } else {
          onOpen({
            locationId: entry.location.id,
            bucketId: entry.bucket.id,
            stageId: entry.stage.id,
          })
        }
      }}
      header={
        <>
          <span className="pl-3.5">Location / bucket</span>
          <span className="px-3 text-right">Stock</span>
          <span className="px-3 text-right">
            {live ? (source === "pool" ? "Evidence" : "Available") : "Observed"}
          </span>
          <span className="px-3 text-right">{live ? "Reserved" : "Missing"}</span>
          <span className="pr-3.5 pl-3 text-right">Last count</span>
        </>
      }
      renderRow={(entry) => {
        if (entry.kind === "location") {
          const { location, position, expanded } = entry
          return (
            <>
              <span role="gridcell" className="pr-3 pl-3.5">
                <span className="flex items-center gap-2">
                  <Icon
                    path={paths.chevronRight}
                    size={13}
                    width={2.2}
                    className={cn(
                      "shrink-0 text-ink-4 transition-transform duration-[140ms]",
                      expanded && "rotate-90"
                    )}
                  />
                  <span className="truncate text-[13px] font-semibold text-ink">
                    {location.name}
                  </span>
                  <span className="shrink-0 text-[11px] text-ink-4">
                    {location.region}
                  </span>
                </span>
              </span>
              <span role="gridcell" className="px-3 text-right">
                <span className={cn(num, "font-medium text-ink")}>
                  {position.stock.toLocaleString()}
                </span>
              </span>
              <span role="gridcell" className="px-3">
                <ObservedCell position={position} live={live} source={source} />
              </span>
              <span role="gridcell" className="px-3">
                <MissingCell position={position} source={source} />
              </span>
              <span role="gridcell" className="pr-3.5 pl-3">
                <CountCell
                  position={position}
                  countable={location.buckets.some(
                    (b) => b.countable !== false
                  )}
                  enabled={countEnabled}
                  onCount={() => onCount({ locationId: location.id })}
                />
              </span>
            </>
          )
        }

        if (entry.kind === "bucket") {
          const { location, bucket, position, hasStages, stagesOpen } = entry
          return (
            <>
              <span role="gridcell" className="pr-3 pl-3.5">
                <span className="flex items-center gap-2 pl-[21px]">
                  {hasStages && (
                    <Icon
                      path={paths.chevronRight}
                      size={12}
                      width={2.2}
                      className={cn(
                        "shrink-0 text-ink-4 transition-transform duration-[140ms]",
                        stagesOpen && "rotate-90"
                      )}
                    />
                  )}
                  <span className="truncate text-xs text-ink-2">
                    {bucket.name}
                  </span>
                  {!hasStages && (
                    <Icon
                      path={paths.chevronRight}
                      size={12}
                      width={2}
                      className={cn(
                        "shrink-0 text-ink-4 opacity-0 transition-opacity",
                        revealOnRowHover
                      )}
                    />
                  )}
                </span>
              </span>
              <span role="gridcell" className="px-3 text-right">
                <span className={cn(num, "text-ink-2")}>
                  {position.stock.toLocaleString()}
                </span>
              </span>
              <span role="gridcell" className="px-3">
                <ObservedCell position={position} live={live} source={source} />
              </span>
              <span role="gridcell" className="px-3">
                <MissingCell position={position} source={source} />
              </span>
              <span role="gridcell" className="pr-3.5 pl-3">
                <CountCell
                  position={position}
                  countable={bucket.countable !== false}
                  enabled={countEnabled}
                  onCount={() =>
                    onCount({ locationId: location.id, bucketId: bucket.id })
                  }
                />
              </span>
            </>
          )
        }

        const { location, bucket, stage, position } = entry
        return (
          <>
            <span role="gridcell" className={cn("pr-3 pl-3.5", nestedRow)}>
              <span className="flex items-center gap-2 pl-[42px]">
                <span className="truncate text-[11.5px] text-ink-3">
                  {stage.name}
                </span>
                <Icon
                  path={paths.chevronRight}
                  size={12}
                  width={2}
                  className={cn(
                    "shrink-0 text-ink-4 opacity-0 transition-opacity",
                    revealOnRowHover
                  )}
                />
              </span>
            </span>
            <span role="gridcell" className={cn("px-3 text-right", nestedRow)}>
              <span className={cn(num, "text-ink-3")}>
                {position.stock.toLocaleString()}
              </span>
            </span>
            <span role="gridcell" className={cn("px-3", nestedRow)}>
              <ObservedCell position={position} live={live} source={source} />
            </span>
            <span role="gridcell" className={cn("px-3", nestedRow)}>
              <MissingCell position={position} source={source} />
            </span>
            <span role="gridcell" className={cn("pr-3.5 pl-3", nestedRow)}>
              <CountCell
                position={position}
                countable={bucket.countable !== false}
                enabled={countEnabled}
                onCount={() =>
                  onCount({
                    locationId: location.id,
                    bucketId: bucket.id,
                    stageId: stage.id,
                  })
                }
              />
            </span>
          </>
        )
      }}
    />
  )
}

/* ── level two: the articles inside one bucket, opened into SKUs ── */

const ARTICLE_COLUMNS = "minmax(0,1fr) 140px 92px 148px 118px 176px"

/**
 * One row of the article feed: an article, or one of its SKUs while the
 * article is expanded. Flat rather than nested for the same reason as
 * `LocationFeedEntry` above.
 */
type ArticleFeedEntry =
  | {
      kind: "article"
      key: string
      article: ReturnType<typeof articleOf>
      rows: SkuRow[]
      position: Position
      expanded: boolean
    }
  | { kind: "sku"; row: SkuRow; article: ReturnType<typeof articleOf> }

export function ArticleTable({
  focus,
  query,
  onCount,
  onOpenSku,
  rows: sourceRows = SKU_ROWS,
  live = false,
  countEnabled = true,
  countable = true,
  source = "legacy",
}: {
  focus: Focus
  query: string
  onCount: (focus: Focus) => void
  onOpenSku?: (row: SkuRow[]) => void
  rows?: SkuRow[]
  live?: boolean
  countEnabled?: boolean
  countable?: boolean
  source?: InventorySource
}) {
  const [open, setOpen] = useState<string[]>([])

  const grouped = useMemo(() => {
    const rows = sourceRows.filter(
      (row) =>
        row.locationId === focus.locationId &&
        (!focus.bucketId || row.bucketId === focus.bucketId) &&
        (!focus.stageId || row.stageId === focus.stageId)
    )
    const byArticle = new Map<string, SkuRow[]>()
    for (const row of rows) {
      byArticle.set(row.productId, [
        ...(byArticle.get(row.productId) ?? []),
        row,
      ])
    }
    const needle = query.trim().toLowerCase()
    return [...byArticle.entries()]
      .map(([productId, list]) => ({
        article: articleOf(productId),
        rows: list,
        position: total(list),
      }))
      .filter(
        ({ article }) =>
          !needle ||
          article?.name.toLowerCase().includes(needle) ||
          article?.id.includes(needle) ||
          false
      )
      .sort(
        (a, b) =>
          b.position.missing - a.position.missing ||
          b.position.stock - a.position.stock
      )
  }, [focus, query, sourceRows])

  const toggle = (id: string) =>
    setOpen((list) =>
      list.includes(id) ? list.filter((x) => x !== id) : [...list, id]
    )

  const feed = useMemo<ArticleFeedEntry[]>(() => {
    const list: ArticleFeedEntry[] = []
    for (const { article, rows, position } of grouped) {
      const key = article?.id ?? rows[0]?.productId ?? "unknown"
      const expanded = open.includes(key)
      list.push({ kind: "article", key, article, rows, position, expanded })
      if (!expanded) continue

      /* the SKUs of one article, as sub-rows rather than another page */
      const skus = [...rows].sort(
        (a, b) =>
          a.colorwayId.localeCompare(b.colorwayId) ||
          a.size.localeCompare(b.size)
      )
      for (const row of skus) {
        list.push({ kind: "sku", row, article })
      }
    }
    return list
  }, [grouped, open])

  return (
    <VirtualRows
      rows={feed}
      rowKey={(entry) => (entry.kind === "article" ? entry.key : entry.row.id)}
      columns={ARTICLE_COLUMNS}
      rowHeight={(entry) => (entry.kind === "article" ? 56 : 34)}
      className="min-w-[940px]"
      onRowClick={(entry) => {
        if (entry.kind === "article") toggle(entry.key)
        else onOpenSku?.([entry.row])
      }}
      header={
        <>
          <span className="pl-3.5">Article</span>
          <span className="px-3">Division</span>
          <span className="px-3 text-right">Stock</span>
          <span className="px-3 text-right">
            {live ? (source === "pool" ? "Evidence" : "Available") : "Observed"}
          </span>
          <span className="px-3 text-right">{live ? "Reserved" : "Missing"}</span>
          <span className="pr-3.5 pl-3 text-right">Last count</span>
        </>
      }
      renderRow={(entry) => {
        if (entry.kind === "sku") {
          const { row, article } = entry
          const skuPosition = total([row])
          return (
            <>
              <span role="gridcell" className={cn("pr-3 pl-3.5", nestedRow)}>
                <span className="flex items-center gap-2 pl-[62px]">
                  <span className="truncate text-[11.5px] text-ink-2">
                    {article
                      ? `${colourName(row.colorwayId)} · ${row.size}`
                      : (row.name ?? row.productId)}
                  </span>
                  <span className="shrink-0 font-mono text-[10px] text-ink-4">
                    {row.colorwayId}
                  </span>
                </span>
              </span>
              <span role="gridcell" className={cn("px-3", nestedRow)} />
              <span role="gridcell" className={cn("px-3 text-right", nestedRow)}>
                <span className={cn(num, "text-ink-2")}>{row.stock}</span>
              </span>
              <span role="gridcell" className={cn("px-3", nestedRow)}>
                <ObservedCell position={skuPosition} live={live} source={source} />
              </span>
              <span role="gridcell" className={cn("px-3", nestedRow)}>
                <MissingCell position={skuPosition} source={source} />
              </span>
              <span role="gridcell" className={cn("pr-3.5 pl-3", nestedRow)}>
                <CountCell
                  position={skuPosition}
                  countable={countable}
                  enabled={countEnabled}
                  onCount={() => onCount(focus)}
                />
              </span>
            </>
          )
        }

        const { article, rows, position, expanded } = entry
        return (
          <>
            <span role="gridcell" className="pr-3 pl-3.5">
              <span className="flex items-center gap-2.5">
                <Icon
                  path={paths.chevronRight}
                  size={13}
                  width={2.2}
                  className={cn(
                    "shrink-0 text-ink-4 transition-transform duration-[140ms]",
                    expanded && "rotate-90"
                  )}
                />
                {article?.colorways[0] ? (
                  <img
                    src={article.colorways[0].image}
                    alt=""
                    loading="lazy"
                    className="size-[38px] shrink-0 rounded-chip bg-inset object-cover"
                  />
                ) : (
                  <span className="grid size-[38px] shrink-0 place-items-center rounded-chip bg-inset font-mono text-[10px] text-ink-4 shadow-[inset_0_0_0_1px_var(--line)]">
                    SKU
                  </span>
                )}
                <span className="min-w-0">
                  <span className="block truncate text-xs font-medium text-ink">
                    {article?.name ?? rows[0]?.name ?? rows[0]?.productId ?? "Unknown SKU"}
                  </span>
                  <span className="flex items-center gap-1 pt-0.5">
                    <span className="shrink-0 font-mono text-[10.5px] text-ink-4">
                      {article?.id ?? rows[0]?.productId}
                    </span>
                    {article?.tags.slice(0, 2).map((tag) => (
                      <span
                        key={tag}
                        className="shrink-0 rounded-[5px] bg-inset px-1.5 text-[10px] text-ink-3"
                      >
                        {tag}
                      </span>
                    ))}
                  </span>
                </span>
              </span>
            </span>
            <span role="gridcell" className="px-3 text-[11.5px] text-ink-3">
              <span className="block truncate">
                {article ? divisionOf(article) : "—"}
              </span>
            </span>
            <span role="gridcell" className="px-3 text-right">
              <span className={cn(num, "font-medium text-ink")}>
                {position.stock}
              </span>
            </span>
            <span role="gridcell" className="px-3">
              <ObservedCell position={position} live={live} source={source} />
            </span>
            <span role="gridcell" className="px-3">
              <MissingCell position={position} source={source} />
            </span>
            <span role="gridcell" className="pr-3.5 pl-3">
              <CountCell
                position={position}
                countable={countable}
                enabled={countEnabled}
                onCount={() => onCount(focus)}
              />
            </span>
          </>
        )
      }}
    />
  )
}

export { ARTICLES, MOVE_META }
