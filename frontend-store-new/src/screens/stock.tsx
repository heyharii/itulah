import { useQuery } from "@tanstack/react-query"
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Building2,
  History,
  Layers,
  Shapes,
  Tag,
  PackagePlus,
  PackageX,
  Search,
  Send,
  Store,
  Warehouse,
  type LucideIcon,
} from "lucide-react"
import { useDeferredValue, useMemo, useState } from "react"

import { DockTools } from "@/components/shell/dock-tools"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/field"
import { Fab } from "@/components/ui/fab"
import { PeopleTabs } from "@/components/ui/people-tabs"
import { Screen } from "@/components/ui/screen"
import { Segmented } from "@/components/ui/segmented"
import { useGo } from "@/lib/go"
import {
  catalogueQuery,
  fetchOnHold,
  onHoldKey,
  poolsQuery,
  skuStockQuery,
} from "@/lib/queries"
import { useReturns } from "@/lib/returns"
import { SendToHo, type Pockets } from "@/screens/stock/send-to-ho"
import { DeliverySheet } from "@/screens/stock/delivery-sheet"
import { OnHold } from "@/screens/stock/on-hold"
import { useOpenRecord } from "@/screens/stock/open-record"
import { TransitIn, TransitOut, useInTransit } from "@/screens/stock/transit"
import { queryState } from "@/lib/query-state"
import { cn } from "@/lib/utils"
import { words } from "@/lib/format"
import { PickFilter } from "@/screens/money/report-parts"
import {
  articlesOf,
  narrow,
  sum,
  type Figure,
  type Pool,
  type StockArticle,
} from "@/screens/stock/stock-model"
import { StockTable, type Grain } from "@/screens/stock/stock-table"

/// Stock — what is in this store, what is waiting to go back, and what is on
/// the road (owner, 23 Oct 2026):
///
///  - **Inventory** · Warehouse | Store | All — the pieces the shop can sell.
///    Each tab's slices are big radios, an icon and its word (owner, 25 Oct).
///  - **To be returned** · Reject item | Over delivery | Return HO. The shop
///    adds only Reject items, by the store head moving them out of Inventory;
///    anything else goes back because HO said so — an over delivery MD did not
///    keep, or Merchandise's request.
///  - **In transit** · In | Out — deliveries coming, trips this shop sent.
///
/// Every row is drawn from the price book and the node's per-SKU counts, both
/// already in hand on a till, and narrowed in the browser. Only articles that
/// hold something are listed: the book is twelve thousand articles long and most
/// are not in a given shop.
type Tab = "inventory" | "returns" | "transit"
type InventorySlice = "warehouse" | "floor" | "all"
type ReturnSlice = "reject" | "over" | "ho"
type TransitSlice = "in" | "out"

/// One slice of a tab, as a big radio: an icon and its word.
interface SliceOption {
  readonly value: string
  readonly label: string
  readonly icon: LucideIcon
}

const INVENTORY_SLICES: readonly SliceOption[] = [
  { value: "all", label: "All", icon: Layers },
  { value: "warehouse", label: "Warehouse", icon: Warehouse },
  { value: "floor", label: "Store", icon: Store },
]
const RETURN_SLICES: readonly SliceOption[] = [
  { value: "reject", label: "Reject Articles", icon: PackageX },
  { value: "over", label: "Over Delivery", icon: PackagePlus },
  { value: "ho", label: "Return HO", icon: Building2 },
]
const TRANSIT_SLICES: readonly SliceOption[] = [
  { value: "in", label: "In", icon: ArrowDownToLine },
  { value: "out", label: "Out", icon: ArrowUpFromLine },
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
const GRAINS = [
  ["sku", "Per SKU"],
  ["article", "Per Article"],
] as const

export function Stock() {
  const go = useGo()
  const [tab, setTab] = useState<Tab>("inventory")
  const [slice, setSlice] = useState<InventorySlice>("all")
  const [returnSlice, setReturnSlice] = useState<ReturnSlice>("reject")
  const [transitSlice, setTransitSlice] = useState<TransitSlice>("in")
  const [sending, setSending] = useState(false)
  const [typed, setTyped] = useState("")
  const [division, setDivision] = useState("")
  const [tag, setTag] = useState("")
  const [grain, setGrain] = useState<Grain>("sku")
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
        ...new Set(
          articles.flatMap((one) => (one.division ? [one.division] : [])),
        ),
      ].sort(),
    [articles],
  )
  // The table carries the slice's places, or the pocket alone.
  const tablePools: readonly Figure[] =
    tab === "returns" ? POCKET_OF[returnSlice] : SLICE_POOLS[slice]
  const tags = useMemo(
    () => [...new Set(articles.flatMap((one) => one.tags))].sort(),
    [articles],
  )
  const narrowed = useMemo(
    () => narrow(articles, needle, division, tag, tablePools),
    [articles, needle, division, tag, tablePools],
  )
  const all = articles.flatMap((one) => one.skus)
  const rejectPool = pools.data?.items.find((pool) =>
    pool.id.split(":")[0].endsWith(".reject"),
  )
  const held = (pool: Pool) =>
    pool === "reject" && sum(all, "reject") === 0
      ? (rejectPool?.on_hand ?? 0)
      : sum(all, pool)
  // The three pockets, as the node counts them; and returns already raised
  // from them (or by HO before the pockets) that wait to be sent.
  const rejectPcs = held("reject")
  const overPcs = sum(all, "over")
  const hoPcs = sum(all, "ho")
  const askPcs = (asks.data ?? []).reduce(
    (total, one) => total + one.quantity,
    0,
  )
  const toReturn = rejectPcs + overPcs + hoPcs
  // An over delivery MD has not answered yet: not in a pocket, not sendable.
  const waitingForMd = (onHold.data ?? []).filter(
    (one) => one.state === "WAITING_FOR_MD",
  )
  const sendable = toReturn + askPcs

  const listing = tab === "inventory" || tab === "returns"

  const divisionOptions = [
    { value: "", label: "All Divisions" },
    ...divisions.map((value) => ({ value, label: value })),
  ]
  const tagOptions = [
    { value: "", label: "All Tags" },
    ...tags.map((value) => ({ value, label: value })),
  ]
  const countOf =
    (pick: (one: StockArticle) => readonly string[]) => (name: string) =>
      articles.filter((one) => pick(one).includes(name)).length
  const divisionPick = (
    <PickFilter
      value={division || null}
      options={divisions.map((name) => ({
        name,
        count: countOf((one) => (one.division ? [one.division] : []))(name),
      }))}
      placeholder="All Divisions"
      show={words}
      icon={Shapes}
      onChange={(next) => setDivision(next ?? "")}
    />
  )
  const tagPick = (
    <PickFilter
      value={tag || null}
      options={tags.map((name) => ({
        name,
        count: countOf((one) => one.tags)(name),
      }))}
      placeholder="All Tags"
      show={words}
      icon={Tag}
      onChange={(next) => setTag(next ?? "")}
    />
  )
  const sliceChoice =
    tab === "inventory"
      ? {
          value: slice,
          options: INVENTORY_SLICES,
          onChange: (next: string) => setSlice(next as InventorySlice),
        }
      : tab === "returns"
        ? {
            value: returnSlice,
            options: RETURN_SLICES,
            onChange: (next: string) => setReturnSlice(next as ReturnSlice),
          }
        : {
            value: transitSlice,
            options: TRANSIT_SLICES,
            onChange: (next: string) => setTransitSlice(next as TransitSlice),
          }

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
          {tab === "returns" && (
            <Button
              variant="primary"
              disabled={sendable === 0}
              onClick={() => setSending(true)}
            >
              <Send />
              Send to HO
            </Button>
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
          ...(listing
            ? [
                {
                  title: "Tags",
                  value: tag,
                  options: tagOptions,
                  onChange: setTag,
                },
                {
                  title: "View",
                  value: grain,
                  options: GRAINS.map(([value, label]) => ({ value, label })),
                  onChange: (next: string) => setGrain(next as Grain),
                },
              ]
            : []),
        ]}
      />
      {tab === "returns" && sendable > 0 && (
        <Fab label="Send to HO" icon={Send} onClick={() => setSending(true)} />
      )}

      {queryState(catalogue, {
        loading: "Reading this shop's stock…",
        render: () => (
          <>
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
            {/* The tab's slices as big radios — an icon and its word — on
                every device (owner, 25 Oct 2026), where tabs of words were. */}
            <SliceRadios {...sliceChoice} />

            <div className="mb-3 flex flex-wrap items-center gap-2 max-md:hidden">
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
                  {divisionPick}
                  {tagPick}
                  <div className="ml-auto">
                    <Segmented<Grain>
                      value={grain}
                      onChange={setGrain}
                      options={GRAINS.map(([value, label]) => ({
                        value,
                        label,
                      }))}
                    />
                  </div>
                </>
              )}
            </div>
            {tab === "transit" ? (
              transitSlice === "in" ? (
                <TransitIn rows={transit.coming} onOpen={delivery.open} />
              ) : (
                <TransitOut rows={transit.going} />
              )
            ) : (
              <div className="grid gap-5">
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
                        grain={grain}
                        showReject={false}
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
                    </>
                  )}
                </div>
              </div>
            )}
          </>
        ),
      })}

      <DeliverySheet
        delivery={transit.coming.find(
          (one) => one.delivery_id === delivery.value,
        )}
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
  return {
    reject: of("reject"),
    over_delivery: of("over"),
    return_ho: of("ho"),
  }
}

/// A tab's slices — Warehouse | Store | All, the three pockets, In | Out — as
/// big radios: an icon over its word, Move stock's own buttons' look.
function SliceRadios({
  value,
  options,
  onChange,
}: {
  value: string
  options: readonly SliceOption[]
  onChange: (next: string) => void
}) {
  return (
    <div
      role="radiogroup"
      className={cn(
        "mb-4 grid max-w-[36rem] gap-2",
        options.length === 3 ? "grid-cols-3" : "grid-cols-2",
      )}
    >
      {options.map((option) => {
        const on = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(option.value)}
            className={cn(
              "flex min-h-20 flex-col items-center justify-center gap-1.5 rounded-card border-[1.5px] px-2 py-2.5 text-[0.9375rem] font-medium transition-[border-color,background-color,scale] duration-(--t-press) ease-(--ease-out) active:scale-[0.98] motion-reduce:active:scale-100",
              on
                ? "border-accent bg-accent-bg text-accent"
                : "border-hairline bg-canvas text-text hover:bg-soft",
            )}
          >
            <option.icon
              className={cn("size-6 stroke-[1.7]", !on && "text-line-ico")}
            />
            <span className="truncate">{option.label}</span>
          </button>
        )
      })}
    </div>
  )
}
