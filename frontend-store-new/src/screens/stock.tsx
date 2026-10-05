import { useQuery } from "@tanstack/react-query"
import {
  ArrowLeftRight,
  ChevronRight,
  History,
  PackagePlus,
} from "lucide-react"
import { Fragment, useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { ListTable, type ListColumn } from "@/components/ui/list-table"
import { Screen } from "@/components/ui/screen"
import { EmptyState } from "@/components/ui/states"
import { count, moment } from "@/lib/format"
import { useGo } from "@/lib/go"
import { useLayout } from "@/lib/layout"
import { fetchPools, poolsKey, type PoolRow } from "@/lib/queries"
import { queryState } from "@/lib/query-state"
import { cn } from "@/lib/utils"
import { MoveSheet } from "@/screens/stock/move-sheet"
import { useMover, type Mover } from "@/screens/stock/mover"
import { PoolGlyph, Route, StockStrip } from "@/screens/stock/parts"
import {
  causeLabel,
  placeCodeOf,
  placeLabel,
  skuOf,
  useLedger,
  useRange,
} from "@/screens/stock/shared"
import type { CatalogRow } from "@itulah/contract"

/// Stock — what is in this store, and moving a piece between the places it
/// can be.
///
/// Drawn as the hub's Ops › Stock: a title, `Stock | Missing · N` under it, and
/// one flat table — Pool · On hand · Allotted · Missing — with a total at the
/// foot. A store owns three pools, so the table is short, and a row opens in
/// place onto what the ledger last did to that pool.
///
/// The one write is a move, and it lives in a sheet (`move-sheet.tsx`). A
/// scan on this page opens it with the piece already loaded; "Move stock"
/// opens it waiting for one. Receiving and selling are not moves and are not
/// here — each writes its own cause through its own endpoint.
///
/// The node reports a missing figure per pool, not per piece, so the Missing
/// tab lists pools with their missing count.
const PAGE = "[&>div:first-child]:md:mb-6"

export function Stock() {
  const go = useGo()
  const mover = useMover()
  const [tab, setTab] = useState<"stock" | "missing">("stock")
  const pools = useQuery({
    queryKey: poolsKey(),
    queryFn: ({ signal }) => fetchPools(signal),
  })
  useScanToMove(mover)

  const rows = (pools.data?.items ?? [])
    .filter((pool) => !pool.is_rollup)
    .sort((left, right) => left.display_order - right.display_order)
  const missing = rows.reduce((sum, pool) => sum + pool.missing, 0)

  return (
    <Screen
      className={PAGE}
      actions={
        <>
          <Button onClick={() => go("/stock/movements")}>
            <History />
            Stock ledger
          </Button>
          <Button variant="primary" onClick={() => mover.start()}>
            <ArrowLeftRight />
            Move stock
          </Button>
        </>
      }
    >
      <StockStrip />

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "stock", label: "Stock" },
          {
            value: "missing",
            label: missing > 0 ? `Missing · ${count(missing)}` : "Missing",
          },
        ]}
      />

      {queryState(pools, {
        loading: "Loading…",
        render: () =>
          rows.length === 0 ? (
            <Card>
              <EmptyState
                action={
                  <Button onClick={() => go("/receive")}>
                    <PackagePlus />
                    Receive stock
                  </Button>
                }
              >
                No stock yet.
              </EmptyState>
            </Card>
          ) : tab === "missing" ? (
            <MissingPools rows={rows} />
          ) : (
            <Pools rows={rows} mover={mover} />
          ),
      })}

      <MoveSheet mover={mover} />
    </Screen>
  )
}

/// A scan on this page opens the move sheet with the piece loaded. There is no
/// field to type into: the reader types the code and presses Enter wherever
/// the caret is, so keys that arrive in a burst and end in Enter are a scan.
function useScanToMove(mover: Mover) {
  const { scan, open } = mover
  useEffect(() => {
    let buffer = ""
    let last = 0
    const onKey = (event: KeyboardEvent) => {
      if (open || event.ctrlKey || event.metaKey || event.altKey) return
      const target = event.target
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT")
      ) {
        return
      }
      const now = Date.now()
      if (now - last > 100) buffer = ""
      last = now
      if (event.key === "Enter") {
        const raw = buffer.trim()
        buffer = ""
        if (raw.length >= 6) scan(raw)
      } else if (event.key.length === 1) {
        buffer += event.key
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [scan, open])
}

/// The hub's `SubTabs`, underlined, at the store's 15px.
function Tabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: readonly { readonly value: T; readonly label: string }[]
  value: T
  onChange: (value: T) => void
}) {
  return (
    <div
      role="tablist"
      className="mb-6 flex gap-0.5 overflow-x-auto shadow-[inset_0_-1px_0_var(--color-hairline)]"
    >
      {tabs.map((tab) => (
        <button
          key={tab.value}
          type="button"
          role="tab"
          aria-selected={tab.value === value}
          onClick={() => onChange(tab.value)}
          className={cn(
            "border-b-2 px-3 pt-2 pb-2.5 text-card-title font-medium whitespace-nowrap transition-colors pointer-coarse:min-h-11",
            tab.value === value
              ? "border-ink text-ink"
              : "border-transparent text-body hover:text-ink",
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}

/// The node's own label for a pool, unless it is one of the store's three —
/// then the word the rest of this app uses, so "Floor" here and "Shop floor"
/// in the ledger are not two places.
function poolName(pool: PoolRow): string {
  const code = placeCodeOf(pool.id)
  return code === null ? pool.label : placeLabel(code)
}

const none = <span className="text-mute">—</span>

const figure = (value: number | null) =>
  value === null || value === 0 ? (
    none
  ) : (
    <span className="tabular-nums">{count(value)}</span>
  )

const missingFigure = (value: number) =>
  value > 0 ? (
    <span className="font-medium text-bad-fg tabular-nums">{count(value)}</span>
  ) : (
    none
  )

const onHandFigure = (value: number) =>
  value === 0 ? (
    none
  ) : (
    <span
      className={cn(
        "font-semibold tabular-nums",
        value < 0 ? "text-bad-fg" : "text-ink",
      )}
    >
      {count(value)}
    </span>
  )

function PoolName({ pool }: { pool: PoolRow }) {
  return (
    <span className="flex min-w-0 items-center gap-3">
      <PoolGlyph code={placeCodeOf(pool.id)} />
      <span className="truncate text-card-title font-semibold text-ink">
        {poolName(pool)}
      </span>
    </span>
  )
}

const CARD = "overflow-hidden rounded-card border border-hairline bg-canvas"

function Pools({ rows, mover }: { rows: readonly PoolRow[]; mover: Mover }) {
  const phone = useLayout() === "phone"
  const [open, setOpen] = useState<string | null>(null)
  const sum = (pick: (pool: PoolRow) => number) =>
    rows.reduce((running, pool) => running + pick(pool), 0)

  if (phone) {
    return (
      <Card>
        <ListTable
          rows={rows}
          columns={phoneColumns}
          rowKey={(pool) => pool.id}
          detail={(pool) => <PoolDetail pool={pool} mover={mover} />}
          empty="No pools."
          roomy
        />
      </Card>
    )
  }

  return (
    <div className={CARD}>
      <table className="w-full border-collapse text-cell">
        <thead>
          <tr className="h-12 bg-soft text-left font-medium text-body">
            <th className="px-4 font-medium">Pool</th>
            <th className="w-36 px-4 text-right font-medium">On hand</th>
            <th className="w-36 px-4 text-right font-medium">Allotted</th>
            <th className="w-36 px-4 text-right font-medium">Missing</th>
            <th className="w-14" />
          </tr>
        </thead>
        <tbody>
          {rows.map((pool) => {
            const expanded = open === pool.id
            const toggle = () => setOpen(expanded ? null : pool.id)
            return (
              <Fragment key={pool.id}>
                <tr
                  onClick={toggle}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault()
                      toggle()
                    }
                  }}
                  tabIndex={0}
                  aria-expanded={expanded}
                  className="h-16 cursor-pointer border-t border-hairline text-text transition-colors outline-none first:border-t-0 hover:bg-soft/60 focus-visible:bg-soft"
                >
                  <td className="px-4">
                    <PoolName pool={pool} />
                  </td>
                  <td className="px-4 text-right">
                    {onHandFigure(pool.on_hand)}
                  </td>
                  <td className="px-4 text-right">{figure(pool.allotted)}</td>
                  <td className="px-4 text-right">
                    {missingFigure(pool.missing)}
                  </td>
                  <td className="px-4 text-right">
                    <ChevronRight
                      aria-hidden
                      className={cn(
                        "inline size-4 text-mute transition-transform duration-200",
                        expanded && "rotate-90",
                      )}
                    />
                  </td>
                </tr>
                {expanded && (
                  <tr>
                    <td colSpan={5} className="bg-soft px-4 pt-2 pb-6">
                      <PoolDetail pool={pool} mover={mover} />
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
          <tr className="h-14 border-t border-hairline font-semibold text-ink">
            <td className="px-4">Store total</td>
            <td className="px-4 text-right tabular-nums">
              {count(sum((pool) => pool.on_hand))}
            </td>
            <td className="px-4 text-right tabular-nums">
              {sum((pool) => pool.allotted ?? 0) === 0 ? (
                <span className="font-normal text-mute">—</span>
              ) : (
                count(sum((pool) => pool.allotted ?? 0))
              )}
            </td>
            <td className="px-4 text-right tabular-nums">
              {sum((pool) => pool.missing) === 0 ? (
                <span className="font-normal text-mute">—</span>
              ) : (
                count(sum((pool) => pool.missing))
              )}
            </td>
            <td />
          </tr>
        </tbody>
      </table>
    </div>
  )
}

/// The node counts what is missing per pool, not per piece, so this is the
/// pools that have some.
function MissingPools({ rows }: { rows: readonly PoolRow[] }) {
  const short = rows.filter((pool) => pool.missing > 0)
  if (short.length === 0) {
    return (
      <Card>
        <EmptyState>Nothing missing.</EmptyState>
      </Card>
    )
  }
  return (
    <div className={CARD}>
      <table className="w-full border-collapse text-cell">
        <thead>
          <tr className="h-12 bg-soft text-left font-medium text-body">
            <th className="px-4 font-medium">Pool</th>
            <th className="w-36 px-4 text-right font-medium">Missing</th>
          </tr>
        </thead>
        <tbody>
          {short.map((pool) => (
            <tr key={pool.id} className="h-16 border-t border-hairline">
              <td className="px-4">
                <PoolName pool={pool} />
              </td>
              <td className="px-4 text-right">{missingFigure(pool.missing)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/// The phone: one name and one line of figures per pool.
const phoneColumns: readonly ListColumn<PoolRow>[] = [
  { id: "pool", header: "Pool", cell: (pool) => <PoolName pool={pool} /> },
  {
    id: "summary",
    header: "",
    card: "meta",
    cell: (pool) =>
      `${count(pool.on_hand)} on hand · ${count(pool.allotted ?? 0)} allotted · ${count(pool.missing)} missing`,
  },
]

/// What opens under a pool: the last few things the ledger did to it — the
/// question somebody has when a number looks wrong is "what happened here
/// lately", and this answers it without leaving the table.
function PoolDetail({ pool, mover }: { pool: PoolRow; mover: Mover }) {
  const go = useGo()
  const ledger = useLedger()
  const { bySku } = useRange()
  const code = placeCodeOf(pool.id)
  const through = (ledger.data ?? [])
    .filter(
      (row) =>
        row.from.split(":")[0] === pool.id || row.to.split(":")[0] === pool.id,
    )
    .slice(0, 5)

  return (
    <div className="flex flex-col gap-4 pt-2">
      {ledger.isPending ? (
        <p className="text-meta text-mute">Loading…</p>
      ) : through.length === 0 ? (
        <p className="text-meta text-mute">No recent movements.</p>
      ) : (
        <ul>
          {through.map((row) => (
            // One line on a desk; on a phone the route takes a line of its
            // own, because two chips and an arrow squeezed beside a date
            // and a cause are two empty pills.
            <li
              key={row.movement_id}
              className="flex min-h-12 flex-wrap items-center gap-x-4 gap-y-1 border-t border-hairline py-2 text-cell first:border-t-0"
            >
              <Route
                from={row.from}
                to={row.to}
                cause={row.cause}
                className="min-w-0 max-md:order-first max-md:basis-full md:flex-1"
              />
              <span className="shrink-0 text-meta text-mute tabular-nums md:order-first md:w-24">
                {moment(row.occurred_at)}
              </span>
              <span className="shrink-0 text-text md:order-first md:w-28">
                {causeLabel(row.cause)}
              </span>
              <span className="flex min-w-0 max-md:flex-1 max-md:justify-end">
                <ProductName epc={row.epc} bySku={bySku} />
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap gap-2 max-md:[&>*]:flex-1">
        {code !== null && (
          <Button onClick={() => mover.start(code)}>
            <ArrowLeftRight />
            Move a piece
          </Button>
        )}
        <Button onClick={() => go("/stock/movements", { q: pool.id })}>
          <History />
          Stock ledger
        </Button>
      </div>
    </div>
  )
}

/// The garment a movement moved, by name when the book knows it and by the
/// SKU off its tag when it does not.
function ProductName({
  epc,
  bySku,
}: {
  epc: string
  bySku: ReadonlyMap<string, CatalogRow>
}) {
  const sku = skuOf(epc)
  const name = sku === null ? undefined : bySku.get(sku)?.name
  return name !== undefined ? (
    <span className="max-w-[14rem] truncate text-body" title={sku ?? undefined}>
      {name}
    </span>
  ) : (
    <span className="font-mono text-id text-mute">
      {sku ?? `…${epc.slice(-8)}`}
    </span>
  )
}
