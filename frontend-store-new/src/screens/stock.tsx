import { useQuery } from "@tanstack/react-query"
import { ArrowLeftRight, History, Search, Send } from "lucide-react"
import { useDeferredValue, useMemo, useState } from "react"

import { DockTools } from "@/components/shell/dock-tools"
import { Button } from "@/components/ui/button"
import { Select, Input } from "@/components/ui/field"
import { Fab } from "@/components/ui/fab"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { PeopleTabs } from "@/components/ui/people-tabs"
import { Screen } from "@/components/ui/screen"
import { Segmented } from "@/components/ui/segmented"
import { count, pcs, sku as skuText } from "@/lib/format"
import { useGo } from "@/lib/go"
import {
  catalogueQuery,
  fetchOnHold,
  onHoldKey,
  poolsQuery,
  skuStockQuery,
} from "@/lib/queries"
import { useReturns } from "@/lib/returns"
import { useIdentity } from "@/lib/session"
import { ReturnRequests } from "@/screens/return-to-ho"
import { SendToHo, type Pockets } from "@/screens/stock/send-to-ho"
import { DeliverySheet } from "@/screens/stock/delivery-sheet"
import { OnHold } from "@/screens/stock/on-hold"
import { useOpenRecord } from "@/screens/stock/open-record"
import { TransitIn, TransitOut, useInTransit } from "@/screens/stock/transit"
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
  type Figure,
  type Pool,
  type StockArticle,
  type Show,
} from "@/screens/stock/stock-model"
import { PoolDot, StockTable } from "@/screens/stock/stock-table"

/// Stock — what is in this store, what is waiting to go back, and what is on
/// the road (owner, 23 Oct 2026):
///
///  - **Inventory** · Warehouse | Store | All — the pieces the shop can sell.
///  - **To be returned** · Reject item | Over delivery | Return HO. The shop
///    adds only Reject items, by the store head moving them out of Inventory;
///    anything else goes back because HO said so — an over delivery MD did not
///    keep, or Merchandise's request.
///  - **In transit** · In | Out — deliveries coming, trips this shop sent.
///
/// Moving is a mode of the Inventory tab (owner, 11 Oct): "Move stock" shows
/// where the pieces can go, the table turns into From | Move | To with a box
/// to type into, and what has been added gathers in a panel with one Submit
/// (`move-panel.tsx`). The write is `move-stock.ts`.
///
/// Every row is drawn from the price book and the node's per-SKU counts, both
/// already in hand on a till, and narrowed in the browser. Only articles that
/// hold something are listed until "Everything" is chosen: the book is twelve
/// thousand articles long and most are not in a given shop.
type Tab = "inventory" | "returns" | "transit"
type InventorySlice = "warehouse" | "floor" | "all"
type ReturnSlice = "reject" | "over" | "ho"
type TransitSlice = "in" | "out"

const INVENTORY_SLICES: readonly { value: InventorySlice; label: string }[] = [
  { value: "warehouse", label: "Warehouse" },
  { value: "floor", label: "Store" },
  { value: "all", label: "All" },
]
const SLICE_POOLS: Readonly<Record<InventorySlice, readonly Pool[]>> = {
  warehouse: ["warehouse"],
  floor: ["floor"],
  all: ["warehouse", "floor"],
}
/// To be returned's three pockets, each a slice of its own.
const POCKET_OF: Readonly<Record<ReturnSlice, readonly Figure[]>> = {
  reject: ["reject"],
  over: ["over"],
  ho: ["ho"],
}

const PAGE = 100

export function Stock() {
  const go = useGo()
  const move = useStockMove()
  const me = useIdentity()
  // The store head marks a piece reject; a cashier only moves between the
  // warehouse and the store.
  const head = me.data?.role === "SUPERVISOR" || me.data?.role === "ADMIN"
  const [tab, setTab] = useState<Tab>("inventory")
  const [slice, setSlice] = useState<InventorySlice>("all")
  const [returnSlice, setReturnSlice] = useState<ReturnSlice>("reject")
  const [transitSlice, setTransitSlice] = useState<TransitSlice>("in")
  const [sending, setSending] = useState(false)
  const [typed, setTyped] = useState("")
  const [division, setDivision] = useState("")
  const [show, setShow] = useState<Show>("stock")
  const [shown, setShown] = useState(PAGE)
  const needle = useDeferredValue(typed).trim().toLowerCase()

  const catalogue = useQuery(catalogueQuery())
  // Live: a till selling or another handheld moving changes these figures.
  const stock = useQuery({ ...skuStockQuery(), refetchInterval: 10_000 })
  const pools = useQuery({ ...poolsQuery(), refetchInterval: 10_000 })
  const onHold = useQuery({
    queryKey: onHoldKey(),
    queryFn: ({ signal }) => fetchOnHold(signal),
    refetchInterval: 15_000,
  })
  const asks = useReturns()
  const transit = useInTransit()
  const delivery = useOpenRecord("delivery")

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
  // A move draws From | Move | To whatever slice is on; outside one the
  // table carries the slice's places, or the reject alone.
  const tablePools: readonly Figure[] =
    tab === "returns" ? POCKET_OF[returnSlice] : SLICE_POOLS[slice]
  const tableShow: Show = tab === "returns" ? "stock" : show
  const narrowed = useMemo(
    () => narrow(articles, needle, division, tableShow, tablePools),
    [articles, needle, division, tableShow, tablePools],
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

  // The three pockets, as the node counts them; and returns already raised
  // from them (or by HO before the pockets) that wait to be sent.
  const rejectPcs = held("reject")
  const overPcs = sum(all, "over")
  const hoPcs = sum(all, "ho")
  const askPcs = (asks.data ?? []).reduce((total, one) => total + one.quantity, 0)
  const toReturn = rejectPcs + overPcs + hoPcs
  // An over delivery MD has not answered yet: not in a pocket, not sendable.
  const waitingForMd = (onHold.data ?? []).filter(
    (one) => one.state === "WAITING_FOR_MD",
  )
  const sendable = toReturn + askPcs

  const startMove = () => {
    setTab("inventory")
    move.choose(move.to === "reject" && !head ? "floor" : move.to)
  }
  const listing = tab === "inventory" || tab === "returns"

  const divisionOptions = [
    { value: "", label: "Everything" },
    ...divisions.map((value) => ({ value, label: value })),
  ]
  const sliceChoice =
    tab === "inventory"
      ? {
          title: "Place",
          value: slice,
          options: INVENTORY_SLICES,
          onChange: (next: string) => setSlice(next as InventorySlice),
        }
      : tab === "returns"
        ? {
            title: "Kind",
            value: returnSlice,
            options: [
              { value: "reject", label: "Reject item" },
              { value: "over", label: "Over delivery" },
              { value: "ho", label: "Return HO" },
            ],
            onChange: (next: string) => setReturnSlice(next as ReturnSlice),
          }
        : {
            title: "Way",
            value: transitSlice,
            options: [
              { value: "in", label: "In" },
              { value: "out", label: "Out" },
            ],
            onChange: (next: string) => setTransitSlice(next as TransitSlice),
          }

  const kpis = (() => {
    if (tab === "returns")
      return (
        <KpiStrip className="md:grid-cols-4 xl:grid-cols-4">
          <Kpi label="Reject item" value={pcs(rejectPcs)} />
          <Kpi label="Over delivery" value={pcs(overPcs)} />
          <Kpi label="Return HO" value={pcs(hoPcs)} />
          <Kpi label="To be returned" value={pcs(toReturn)} />
        </KpiStrip>
      )
    if (tab === "transit") {
      const inKoli = transit.coming.reduce((total, one) => total + one.koli_count, 0)
      const outKoli = transit.going.reduce((total, one) => total + one.koli_count, 0)
      const outPcs = transit.going.reduce((total, one) => total + one.unit_count, 0)
      return (
        <KpiStrip>
          <Kpi label="In" value={`${count(inKoli)} koli`} />
          <Kpi label="Out" value={`${count(outKoli)} koli`} />
          <Kpi label="Pieces out" value={pcs(outPcs)} />
        </KpiStrip>
      )
    }
    const places: readonly Pool[] =
      move.moving && move.to === "reject"
        ? ["warehouse", "floor", "reject"]
        : ["warehouse", "floor"]
    return (
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
          value={count(held("warehouse") + held("floor"))}
        />
      </KpiStrip>
    )
  })()

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
          {!move.moving && tab === "returns" ? (
            <Button
              variant="primary"
              disabled={sendable === 0}
              onClick={() => setSending(true)}
            >
              <Send />
              Send to HO
            </Button>
          ) : (
            !move.moving && (
              <Button variant="primary" onClick={startMove}>
                <ArrowLeftRight />
                Move stock
              </Button>
            )
          )}
        </>
      }
    >
      <DockTools
        search={
          listing
            ? { value: typed, onChange: setTyped, label: "Search articles" }
            : undefined
        }
        views={[
          sliceChoice,
          ...(listing
            ? [
                {
                  title: "Division",
                  value: division,
                  options: divisionOptions,
                  onChange: setDivision,
                },
              ]
            : []),
          ...(tab === "inventory"
            ? [
                {
                  title: "Show",
                  value: show,
                  options: SHOWS.map(([value, label]) => ({ value, label })),
                  onChange: (next: string) => setShow(next as Show),
                },
              ]
            : []),
        ]}
      />
      {!move.moving &&
        (tab === "returns" ? (
          sendable > 0 && (
            <Fab label="Send to HO" icon={Send} onClick={() => setSending(true)} />
          )
        ) : (
          <Fab label="Move stock" icon={ArrowLeftRight} onClick={startMove} />
        ))}

      {queryState(catalogue, {
        loading: "Reading this shop's stock…",
        render: () => (
          <>
            {kpis}

            {!move.moving && (
              <PeopleTabs<Tab>
                title="Stock"
                value={tab}
                onChange={setTab}
                plainCount
                tabs={[
                  { value: "inventory", label: "Inventory" },
                  { value: "returns", label: "To be returned", count: toReturn },
                  {
                    value: "transit",
                    label: "In transit",
                    count: transit.coming.length + transit.going.length,
                  },
                ]}
              />
            )}

            <div className="mb-3 flex flex-wrap items-center gap-2 max-md:hidden">
              {!move.moving && (
                <Segmented<string>
                  value={sliceChoice.value}
                  onChange={sliceChoice.onChange}
                  options={sliceChoice.options}
                />
              )}
              {listing && (
                <>
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
                </>
              )}
              {tab === "inventory" && (
                <Segmented<Show>
                  value={show}
                  onChange={setShow}
                  options={SHOWS.map(([value, label]) => ({ value, label }))}
                />
              )}
            </div>

            {move.moving && <Routes move={move} head={head} />}

            {tab === "transit" ? (
              transitSlice === "in" ? (
                <TransitIn rows={transit.coming} onOpen={delivery.open} />
              ) : (
                <TransitOut rows={transit.going} />
              )
            ) : (
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
                        pools={tablePools}
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
                      {tab === "returns" &&
                        returnSlice === "over" &&
                        waitingForMd.length > 0 && (
                          <section className="mt-8">
                            <h2 className="mb-3 text-[0.9375rem] font-semibold text-ink">
                              Waiting for MD
                            </h2>
                            <OnHold lines={waitingForMd} />
                          </section>
                        )}
                      {tab === "returns" && askPcs > 0 && (
                        <section className="mt-8">
                          <h2 className="mb-3 text-[0.9375rem] font-semibold text-ink">
                            Ready to send
                          </h2>
                          <ReturnRequests sendable={false} />
                        </section>
                      )}
                    </>
                  )}
                </div>
                {move.moving && (
                  <MovePanel
                    move={move}
                    nameOf={(sku) => names.get(sku) ?? skuText(sku)}
                  />
                )}
              </div>
            )}
            {/* Room for the panel that sits over a phone's foot. */}
            {move.moving && <div className="h-56 @4xl/page:hidden" />}
          </>
        ),
      })}

      <DeliverySheet
        delivery={transit.coming.find((one) => one.delivery_id === delivery.value)}
        onClose={delivery.close}
      />
      <SendToHo
        open={sending}
        asks={asks.data ?? []}
        pockets={pocketLines(articles)}
        onClose={() => setSending(false)}
      />
    </Screen>
  )
}

/// What each pocket of To be returned holds, SKU by SKU, for the Send sheet.
function pocketLines(articles: readonly StockArticle[]): Pockets {
  const of = (figure: "reject" | "over" | "ho") =>
    articles.flatMap((article) =>
      article.skus
        .filter((one) => one[figure] > 0)
        .map((one) => ({
          sku_code: one.sku,
          name: `${article.name} ${one.label}`,
          quantity: one[figure],
        })),
    )
  return { reject: of("reject"), over_delivery: of("over"), return_ho: of("ho") }
}

/// Where the pieces go: Warehouse or Store, and Reject for the store head —
/// with, for Reject, where they come from.
function Routes({
  move,
  head,
}: {
  move: ReturnType<typeof useStockMove>
  head: boolean
}) {
  const places = PLACES.filter((place) => head || place.code !== "reject")
  return (
    <div className="mb-4 flex flex-col gap-2.5">
      <div className={cn("grid gap-2", places.length === 3 ? "grid-cols-3" : "grid-cols-2")}>
        {places.map((place) => {
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
