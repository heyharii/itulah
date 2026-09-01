import { useMemo, useState } from "react"

import { Icon, paths } from "@/components/dashboard/parts"
import {
  LEDGER,
  MOVE_META,
  INV_LOCATIONS,
  articleOf,
  colourName,
  type MoveKind,
  type InvLocation,
  type Movement,
} from "@/components/inventory/data"
import { shortDate } from "@/lib/day"
import { VirtualRows } from "@/shared/table"
import { cn } from "@/lib/utils"

const LEDGER_COLUMNS = "132px 132px minmax(0,1fr) 196px 74px 132px"

const KINDS = Object.keys(MOVE_META) as MoveKind[]

const poolName = (
  locations: InvLocation[],
  locationId: string,
  bucketId: string
) =>
  locations
    .find((location) => location.id === locationId)
    ?.buckets.flatMap((bucket) => [bucket, ...(bucket.stages ?? [])])
    .find((bucket) => bucket.id === bucketId)?.name

const locationName = (locations: InvLocation[], id: string) =>
  locations.find((location) => location.id === id)?.name

function poolLabel(pool: string): string {
  switch (pool) {
    case "external/supplier":
      return "External supplier"
    case "external/customer":
      return "External customer"
    case "system/opening":
      return "Opening balance"
    case "system/count_gain":
      return "Count gain"
    case "missing":
      return "Missing"
    default:
      return pool || "—"
  }
}

/**
 * Every movement, newest first. A correction carries the day it applies to,
 * which is why a number from last week can change after the fact.
 */
export function Ledger({
  movements = LEDGER,
  locations = INV_LOCATIONS,
  live = false,
}: {
  movements?: Movement[]
  locations?: InvLocation[]
  live?: boolean
}) {
  const [kinds, setKinds] = useState<MoveKind[]>([])
  const [query, setQuery] = useState("")

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return movements
      .filter((move) => {
        if (kinds.length && !kinds.includes(move.kind)) return false
        if (!needle) return true
        const article = articleOf(move.productId)
        return (
          move.productId.includes(needle) ||
          (article?.name.toLowerCase().includes(needle) ?? false) ||
          move.by.toLowerCase().includes(needle) ||
          (move.fromPool?.toLowerCase().includes(needle) ?? false) ||
          (move.toPool?.toLowerCase().includes(needle) ?? false) ||
          (move.fromPool
            ? poolLabel(move.fromPool).toLowerCase().includes(needle)
            : false) ||
          (move.toPool
            ? poolLabel(move.toPool).toLowerCase().includes(needle)
            : false) ||
          (poolName(locations, move.locationId, move.bucketId)
            ?.toLowerCase()
            .includes(needle) ??
            false)
        )
      })
  }, [kinds, query, movements, locations])

  const toggle = (kind: MoveKind) =>
    setKinds((list) =>
      list.includes(kind) ? list.filter((k) => k !== kind) : [...list, kind]
    )

  return (
    <div>
      <div className="flex h-11 flex-wrap items-center gap-1.5 border-b border-line px-3.5">
        {KINDS.map((kind) => {
          const on = kinds.includes(kind)
          return (
            <button
              key={kind}
              type="button"
              onClick={() => toggle(kind)}
              style={{ "--k": MOVE_META[kind].hue } as React.CSSProperties}
              className={cn(
                "inline-flex h-[26px] items-center gap-1.5 rounded-control px-2 text-[11px] font-medium transition-colors",
                on
                  ? "bg-[color-mix(in_srgb,var(--k)_14%,var(--surface))] text-[color-mix(in_srgb,var(--k)_66%,var(--ink))] shadow-[inset_0_0_0_1.5px_var(--k)]"
                  : "text-ink-3 hover:bg-hover hover:text-ink"
              )}
            >
              <span
                style={{ background: MOVE_META[kind].hue }}
                className="size-1.5 rounded-full"
              />
              {MOVE_META[kind].label}
            </button>
          )
        })}

        <span className="relative ml-auto">
          <Icon
            path={paths.search}
            size={14}
            width={1.9}
            className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-ink-4"
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Article, number or person"
            className="h-[30px] w-[220px] rounded-control bg-field pr-2.5 pl-8 text-xs text-ink shadow-[inset_0_0_0_1px_var(--line-strong)] outline-none placeholder:text-ink-4 focus:bg-surface focus:shadow-[inset_0_0_0_1px_var(--accent)]"
          />
        </span>
      </div>

      <VirtualRows
        rows={rows}
        rowKey={(move) => move.id}
        columns={LEDGER_COLUMNS}
        rowHeight={44}
        className="min-w-[980px]"
        empty={
          <p className="py-10 text-center text-xs text-ink-4">
            {movements.length === 0
              ? "The inventory movement feed returned no entries for this scope."
              : "Nothing matches those filters."}
          </p>
        }
        header={
          <>
            <span className="pl-3.5">When</span>
            <span className="px-3">Movement</span>
            <span className="px-3">Article</span>
            <span className="px-3">{live ? "Pool / location" : "Where"}</span>
            <span className="px-3 text-right">Qty</span>
            <span className="pr-3.5 pl-3">By</span>
          </>
        }
        renderRow={(move) => {
          const article = articleOf(move.productId)
          const meta = MOVE_META[move.kind]
          return (
            <>
              <span role="gridcell" className="pr-3 pl-3.5">
                <span className="block font-mono text-[11.5px] text-ink-2 tabular-nums">
                  {shortDate(move.at)}
                </span>
                <span className="block font-mono text-[10.5px] text-ink-4 tabular-nums">
                  {move.time}
                </span>
              </span>

              <span role="gridcell" className="px-3">
                <span
                  style={{ color: meta.hue }}
                  className="flex items-center gap-1.5 text-[11.5px] font-medium"
                >
                  <span style={{ background: meta.hue }} className="size-1.5 rounded-full" />
                  {meta.label}
                </span>
                {move.effectiveOn && (
                  <span className="block pl-3 text-[10px] text-ink-4">
                    effective {shortDate(move.effectiveOn)}
                  </span>
                )}
              </span>

              <span role="gridcell" className="min-w-0 px-3">
                <span className="flex items-center gap-2">
                  {article && (
                    <img
                      src={article.colorways[0].image}
                      alt=""
                      loading="lazy"
                      className="size-[26px] shrink-0 rounded-chip bg-inset object-cover"
                    />
                  )}
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-medium text-ink">
                      {article?.name ?? move.name ?? move.productId}
                    </span>
                    <span className="block truncate text-[10.5px] text-ink-4">
                      {article ? `${colourName(move.colorwayId)} \u00b7 ${move.size}` : move.productId}
                    </span>
                  </span>
                </span>
              </span>

              <span role="gridcell" className="min-w-0 px-3 text-[11.5px] text-ink-3">
                <span className="block truncate">
                  {move.fromPool || move.toPool
                    ? `${poolLabel(move.fromPool ?? "")} \u2192 ${poolLabel(move.toPool ?? "")}`
                    : move.fromId && move.toId
                      ? `${locationName(locations, move.fromId) ?? move.fromId} \u2192 ${locationName(locations, move.toId) ?? move.toId}`
                      : (locationName(locations, move.toId ?? move.fromId ?? move.locationId) ??
                        (move.locationId || "\u2014"))}
                </span>
                {live && poolName(locations, move.locationId, move.bucketId) && (
                  <span className="block truncate text-[10.5px] text-ink-4">
                    {poolName(locations, move.locationId, move.bucketId)}
                  </span>
                )}
                {move.note && (
                  <span className="block truncate text-[10.5px] text-ink-4">{move.note}</span>
                )}
              </span>

              <span role="gridcell" className="px-3 text-right">
                <span
                  className={cn(
                    "font-mono text-xs tabular-nums",
                    meta.sign === 1 ? "text-grass" : meta.sign === -1 ? "text-ink-2" : "text-ink-3"
                  )}
                >
                  {meta.sign === 1 ? "+" : meta.sign === -1 ? "\u2212" : ""}
                  {move.qty}
                </span>
              </span>

              <span role="gridcell" className="min-w-0 pr-3.5 pl-3 text-[11.5px] text-ink-3">
                <span className="block truncate">{move.by}</span>
              </span>
            </>
          )
        }}
      />
    </div>
  )
}
