import { useQuery } from "@tanstack/react-query"
import { ArrowLeftRight, History, Search } from "lucide-react"
import { useDeferredValue, useMemo, useState } from "react"

import { DockTools } from "@/components/shell/dock-tools"
import { Button } from "@/components/ui/button"
import { Select, Input } from "@/components/ui/field"
import { Fab } from "@/components/ui/fab"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { Screen } from "@/components/ui/screen"
import { Segmented } from "@/components/ui/segmented"
import { count, sku as skuText } from "@/lib/format"
import { useGo } from "@/lib/go"
import {
  catalogueQuery,
  poolsQuery,
  skuStockQuery,
} from "@/lib/queries"
import { queryState } from "@/lib/query-state"
import { cn } from "@/lib/utils"
import { MovePanel } from "@/screens/stock/move-panel"
import { useStockMove } from "@/screens/stock/move-stock"
import { PLACES, placeLabel } from "@/screens/stock/shared"
import {
  SHOWS,
  articlesOf,
  narrow,
  sum,
  type Pool,
  type Show,
} from "@/screens/stock/stock-model"
import { PoolDot, StockTable } from "@/screens/stock/stock-table"

/// Stock — what is in this store, by article, and moving it between the
/// three places it can be.
///
/// The figures on top are the places and the store's total; under them the
/// articles as an accordion (`stock-table.tsx`). Moving is a mode of the same
/// page (owner, 11 Oct): "Move stock" shows where the pieces can go, the
/// table turns into From | Move | To with a box to type into, and what has
/// been added gathers in a panel with one Submit (`move-panel.tsx`). The write
/// is `move-stock.ts`. Receiving, selling and counting are not moves and are
/// not here.
///
/// Every row is drawn from the price book and the node's per-SKU counts, both
/// already in hand on a till, and narrowed in the browser. Only articles that
/// hold something are listed until "Everything" is chosen: the book is twelve
/// thousand articles long and most are not in a given shop.
const PAGE = 100

export function Stock() {
  const go = useGo()
  const move = useStockMove()
  const [typed, setTyped] = useState("")
  const [division, setDivision] = useState("")
  const [show, setShow] = useState<Show>("stock")
  const [shown, setShown] = useState(PAGE)
  const needle = useDeferredValue(typed).trim().toLowerCase()

  const catalogue = useQuery(catalogueQuery())
  // Live: a till selling or another handheld moving changes these figures.
  const stock = useQuery({ ...skuStockQuery(), refetchInterval: 10_000 })
  const pools = useQuery({ ...poolsQuery(), refetchInterval: 10_000 })

  const articles = useMemo(
    () =>
      articlesOf(
        catalogue.data?.items ?? [],
        new Map((stock.data?.items ?? []).map((one) => [one.sku_code, one])),
      ),
    [catalogue.data, stock.data],
  )
  const divisions = useMemo(
    () =>
      [
        ...new Set(articles.flatMap((one) => (one.division ? [one.division] : []))),
      ].sort(),
    [articles],
  )
  const narrowed = useMemo(
    () => narrow(articles, needle, division, show),
    [articles, needle, division, show],
  )
  const names = useMemo(() => {
    const index = new Map<string, string>()
    for (const article of articles)
      for (const one of article.skus)
        index.set(one.sku, `${article.name} ${one.label} · ${skuText(one.sku)}`)
    return index
  }, [articles])

  const all = articles.flatMap((one) => one.skus)
  const rejectPool = pools.data?.items.find((pool) =>
    pool.id.split(":")[0].endsWith(".reject"),
  )
  const held = (pool: Pool) =>
    pool === "reject" && sum(all, "reject") === 0
      ? (rejectPool?.on_hand ?? 0)
      : sum(all, pool)
  // The move is shown on the figures before it is sent.
  const delta = (pool: Pool) =>
    !move.moving
      ? 0
      : (pool === move.to ? move.pieces : 0) -
        (pool === move.from ? move.pieces : 0)
  const places = PLACES.map((place) => place.code)

  const divisionOptions = [
    { value: "", label: "Everything", count: articles.length },
    ...divisions.map((value) => ({ value, label: value })),
  ]

  return (
    <Screen
      counter
      foot="both"
      className="@container/page"
      actions={
        <>
          <Button onClick={() => go("/stock/movements")}>
            <History />
            Stock ledger
          </Button>
          {!move.moving && (
            <Button variant="primary" onClick={() => move.choose(move.to)}>
              <ArrowLeftRight />
              Move stock
            </Button>
          )}
        </>
      }
    >
      <DockTools
        search={{ value: typed, onChange: setTyped, label: "Search articles" }}
        status={{
          value: division,
          options: divisionOptions,
          onChange: setDivision,
        }}
        views={[
          {
            title: "Show",
            value: show,
            options: SHOWS.map(([value, label]) => ({ value, label })),
            onChange: (next) => setShow(next as Show),
          },
        ]}
      />
      {!move.moving && (
        <Fab
          label="Move stock"
          icon={ArrowLeftRight}
          onClick={() => move.choose(move.to)}
        />
      )}

      {queryState(catalogue, {
        loading: "Reading this shop's stock…",
        render: () => (
          <>
            <KpiStrip className="md:grid-cols-4 xl:grid-cols-4">
              {places.map((pool) => {
                const change = delta(pool)
                return (
                  <Kpi
                    key={pool}
                    label={
                      <span className="inline-flex items-center gap-2">
                        <PoolDot pool={pool} />
                        {placeLabel(pool)}
                      </span>
                    }
                    value={count(held(pool))}
                    delta={
                      change === 0
                        ? undefined
                        : `${change > 0 ? "+" : "−"}${count(Math.abs(change))}`
                    }
                    tone={change > 0 ? "up" : "down"}
                  />
                )
              })}
              <Kpi
                label="Total stock"
                value={count(places.reduce((total, pool) => total + held(pool), 0))}
              />
            </KpiStrip>

            <div className="mb-3 flex flex-wrap items-center gap-2 max-md:hidden">
              <div className="relative w-64">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-line-ico" />
                <Input
                  value={typed}
                  onChange={(event) => setTyped(event.target.value)}
                  placeholder="Search articles"
                  aria-label="Search articles"
                  className="pl-9"
                />
              </div>
              <Select
                aria-label="Division"
                value={division}
                onChange={setDivision}
                className="w-44"
              >
                <option value="">All divisions</option>
                {divisions.map((one) => (
                  <option key={one} value={one}>
                    {one}
                  </option>
                ))}
              </Select>
              <Segmented<Show>
                value={show}
                onChange={setShow}
                options={SHOWS.map(([value, label]) => ({ value, label }))}
              />
            </div>

            {move.moving && <Routes move={move} />}

            <div
              className={cn(
                "grid gap-5",
                move.moving && "@4xl/page:grid-cols-[minmax(0,1fr)_20rem]",
              )}
            >
              <div className="min-w-0">
                {stock.isError ? (
                  <p className="py-12 text-center text-[0.9375rem] text-mute">
                    This shop's counts could not be read.
                  </p>
                ) : (
                  <>
                    <StockTable
                      articles={narrowed.slice(0, shown)}
                      move={move}
                      forceOpen={needle !== ""}
                    />
                    {narrowed.length > shown && (
                      <div className="flex justify-center py-4">
                        <Button onClick={() => setShown((now) => now + PAGE)}>
                          Show more
                        </Button>
                      </div>
                    )}
                  </>
                )}
              </div>
              {move.moving && (
                <MovePanel move={move} nameOf={(sku) => names.get(sku) ?? skuText(sku)} />
              )}
            </div>
            {/* Room for the panel that sits over a phone's foot. */}
            {move.moving && <div className="h-56 @4xl/page:hidden" />}
          </>
        ),
      })}
    </Screen>
  )
}

/// Where the pieces go: three choices, and for Reject, where they come from.
function Routes({ move }: { move: ReturnType<typeof useStockMove> }) {
  return (
    <div className="mb-4 flex flex-col gap-2.5">
      <div className="grid grid-cols-3 gap-2">
        {PLACES.map((place) => {
          const on = move.to === place.code
          return (
            <button
              key={place.code}
              type="button"
              aria-pressed={on}
              onClick={() => move.choose(place.code)}
              className={cn(
                "flex min-h-14 items-center gap-2.5 rounded-card border-[1.5px] px-3 py-2 text-left text-[0.9375rem] transition-[border-color,background-color,scale] duration-(--t-press) ease-(--ease-out) active:scale-[0.98]",
                !on && "border-hairline bg-canvas text-text hover:bg-soft",
                on &&
                  (place.code === "reject"
                    ? "border-warn bg-warn-bg text-warn-fg"
                    : "border-accent bg-accent-bg text-accent"),
              )}
            >
              <PoolDot pool={place.code} />
              <span className="flex min-w-0 flex-col leading-tight">
                <span className={cn("text-[0.875rem]", on ? "opacity-75" : "text-mute")}>
                  To
                </span>
                <b className="truncate font-semibold">{place.label}</b>
              </span>
            </button>
          )
        })}
      </div>
      {move.to === "reject" && (
        <div className="flex items-center gap-2 text-[0.9375rem] text-body">
          From
          <Segmented<"floor" | "warehouse">
            value={move.rejectFrom}
            onChange={move.chooseSource}
            options={[
              { value: "floor", label: placeLabel("floor") },
              { value: "warehouse", label: placeLabel("warehouse") },
            ]}
          />
        </div>
      )}
    </div>
  )
}
