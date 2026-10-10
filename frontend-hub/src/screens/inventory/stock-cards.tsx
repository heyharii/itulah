import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  ArrowUpRight,
  CalendarCheck,
  ClipboardList,
  Search,
  Store as StoreIcon,
  Truck,
  Warehouse,
} from "lucide-react"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { DockTools } from "@/components/shell/dock-tools"
import { AppLink } from "@/components/ui/app-link"
import { Button } from "@/components/ui/button"
import { Select } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { MiniTable } from "@/components/ui/rows"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { NoMatch } from "@/components/ui/states"
import { shift, today } from "@/lib/calendar"
import { count, day, dayMonth } from "@/lib/format"
import {
  activateCount,
  allotmentListQuery,
  countsBoardQuery,
  createCount,
  fleetPoolsQuery,
  idempotencyKey,
  inventoryKeys,
  type AllotmentList,
  type AllotmentRow,
  type FleetPool,
} from "@/lib/queries/inventory"
import { useUnits, type UnitView } from "@/lib/queries/organisation"
import {
  listPurchaseOrders,
  procurementKeys,
  type PurchaseOrderRow,
} from "@/lib/queries/procurement"
import { queryState } from "@/lib/query-state"
import { useSheet } from "@/lib/sheets"
import { useDebounced } from "@/lib/use-debounced"
import { signed, useActor } from "@/screens/inventory/shared"
import {
  useExceptionCases,
  type ExceptionCase,
} from "@/screens/inventory/exceptions-data"
import { cn } from "@/lib/utils"

/// Stock, as the owner picked it (inventory-control-options.html, variant
/// ★E "Store cards"): one card per place the business holds stock, each
/// carrying its own ring, its own last count and its own exceptions, with
/// the road and the order book standing beside head office as cards of
/// their own. Every figure is live — the fleet read, the allotment rollups,
/// the open order book and the exceptions inbox — and a number nobody can
/// compute honestly draws a dash rather than a guess.
///
/// The sheet behind a card is the place's whole story: the ring and the gap
/// it closes, when somebody last counted it (and the button that starts the
/// next count), the exceptions standing against it, and the pools the
/// number is made of.

/// An observed/book gap past this share of the book is worth amber. The
/// prototype's own threshold (1.5%); a hairline the fleet's counts sit
/// either side of, not a number anybody negotiated.
const GAP_WARN_PCT = 1.5

/// A count older than this is stale, and a place with an exception older
/// than this wears the bad border. Both from the prototype's `sev()` and
/// its thirty-day rule.
const STALE_DAYS = 30
/// Exceptions younger than this are still news, not a warning.
const SEVERE_AFTER_DAYS = 7

/// The two cards that are not places, keyed into the same sheet parameter
/// as the places: values the root validator already accepts (any non-empty
/// id), interpreted by this screen and by nothing else on this route.
const ROAD_SHEET = "road"
const ORDER_SHEET = "order"

/// The order book as the on-order card reads it: only open orders, scoped on
/// the SERVER exactly as the Workload screen scopes its own, so the two
/// screens share one cache entry. `prefetch.ts` asks the same scope.
const ORDER_SCOPE = { statuses: ["ACTIVE", "PARTIALLY_RECEIVED"] } as const

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

/// A unit read as a place: its sites, the pools standing in them, and the
/// figures the card prints. `seen` is null when any contributing pool has
/// no sightings behind it — a partial sighting total would read as a
/// total, and the honest answer to "how much of this did a scanner see?"
/// when only some of it was swept is "unknown".
interface PlaceFigures {
  readonly book: number
  readonly seen: number | null
  readonly lastCountedAt: string | null
  /// Days since that count, or null when the place has never been counted.
  readonly days: number | null
  /// Every pool at the place's sites, rollups included — the Where section
  /// filters again, because it shows what goods sit IN, and a rollup is a
  /// sum of other pools.
  readonly pools: readonly FleetPool[]
  /// The pool a count starts against: the stockroom (a store's own
  /// warehouse) or head office's warehouse — the shelf the site's books
  /// live on.
  readonly mainPool: FleetPool | undefined
}

interface PlaceView {
  /// The sheet parameter value this card opens. The unit's stock-holding
  /// site — for a store the store itself, for head office the site that
  /// actually holds pools.
  readonly key: string
  readonly kind: "ho" | "store"
  readonly unit: UnitView
  readonly siteIds: readonly string[]
  readonly name: string
  readonly sub: string
  readonly fig: PlaceFigures
  /// The open cases at this place, or null while the inbox is loading —
  /// "No exceptions" is a finding, and a finding waits for its read.
  readonly cases: readonly ExceptionCase[] | null
  /// Pieces allotted to this place and not yet received, or null while the
  /// allotment book is loading.
  readonly onRoad: number | null
}

// ---------------------------------------------------------------------------
// Folds
// ---------------------------------------------------------------------------

function figuresFor(
  siteIds: readonly string[],
  fleet: readonly FleetPool[]
): PlaceFigures {
  const pools = fleet.filter((pool) => siteIds.includes(pool.site_id))
  // Only what the server itself counts: a shadowed Cloud row under an Edge
  // node is a second telling of the same shelf, and the fleet read marks it.
  const counted = pools.filter((pool) => pool.authority.included_in_fleet_total)

  const book = counted.reduce((running, pool) => running + pool.stock, 0)

  let seen: number | null = 0
  for (const pool of counted) {
    const observed = pool.observed
    if (observed === null || observed === undefined) {
      seen = null
      break
    }
    seen = (seen ?? 0) + observed
  }
  if (counted.length === 0) seen = null

  const countedAt = counted
    .map((pool) => pool.last_counted_at)
    .filter((at): at is string => typeof at === "string")
  const lastCountedAt =
    countedAt.length > 0
      ? countedAt.reduce((newest, at) => (at > newest ? at : newest))
      : null

  // The shelf a count is aimed at. A store's stockroom and head office's
  // warehouse both spell their pool code `WAREHOUSE`; the fallback takes the
  // first place goods can actually sit, because a reject pool is where goods
  // stop, not where they live.
  const countable = pools
    .filter((pool) => !pool.is_rollup && pool.group !== "REJECT")
    .sort((left, right) => left.display_order - right.display_order)
  const mainPool =
    countable.find((pool) => pool.pool_code === "WAREHOUSE") ?? countable[0]

  return {
    book,
    seen,
    lastCountedAt,
    days: lastCountedAt === null ? null : daysSince(lastCountedAt),
    pools,
    mainPool,
  }
}

function daysSince(iso: string): number {
  const at = Date.parse(iso)
  if (Number.isNaN(at)) return 0
  return Math.floor((Date.now() - at) / 86_400_000)
}

/// A place's border: bad when an exception has sat for over a month, warn
/// when one has sat for over a week, quiet otherwise. Fresh exceptions are
/// news somebody has just been handed — they do not paint the card yet.
function severityOf(cases: readonly ExceptionCase[] | null): 0 | 1 | 2 {
  if (cases === null) return 0
  if (cases.some((one) => (one.ageDays ?? 0) > STALE_DAYS)) return 2
  if (cases.some((one) => (one.ageDays ?? 0) > SEVERE_AFTER_DAYS)) return 1
  return 0
}

function ageText(days: number | null): string {
  if (days === null) return "no date"
  return days === 0 ? "today" : `${days} d`
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export function StockCards() {
  // What this screen asks first is also what `prefetch.ts` asks, on hover.
  const fleet = useQuery(fleetPoolsQuery())
  const units = useUnits()
  const { cases } = useExceptionCases()

  // The road: one read of the allotment book. The per-destination rollup is
  // computed by the server over the WHOLE table — not just the rows that
  // came back — so "what is owed to each store" needs no second request.
  const road = useQuery(allotmentListQuery("", ""))

  // The order book, scoped exactly as the Workload screen's own card is, so
  // both screens share one cache entry rather than teaching the server the
  // same lesson twice.
  const orders = useQuery({
    queryKey: procurementKeys.orders(ORDER_SCOPE),
    queryFn: ({ signal }) => listPurchaseOrders(ORDER_SCOPE, signal),
  })

  // The count board, for the one thing a card cannot say about a count
  // already running at the place.
  const counts = useQuery(countsBoardQuery())

  const client = useQueryClient()
  const actor = useActor()
  const counting = useMutation({
    mutationFn: async (target: { siteId: string; poolId: string }) => {
      const created = await createCount({
        site_id: target.siteId,
        pool_id: target.poolId,
        kind: "FULL",
        sku_ids: [],
        epcs: [],
        reason: "Requested from Stock",
        actor_id: actor,
        idempotency_key: idempotencyKey(),
      })
      return activateCount(created.id, {
        actor_id: actor,
        idempotency_key: idempotencyKey(),
      })
    },
    onSuccess: () => {
      // The board changed, the fleet's last-count line will change when the
      // count closes, and the missing list gains the shortages the count
      // books. All three answer under the same prefix.
      client.invalidateQueries({ queryKey: inventoryKeys.counts() })
      client.invalidateQueries({ queryKey: inventoryKeys.missing() })
      client.invalidateQueries({ queryKey: inventoryKeys.fleet() })
    },
  })

  // The search lives in the URL like every screen-wide narrowing, so a
  // filtered board is a link somebody can send; the needle the cards
  // actually filter by waits for the typing to settle.
  const search = useSheet("q")
  const place = useSheet("location")
  const [sort, setSort] = useState<SortMode>("attention")
  const needle = useDebounced((search.value ?? "").trim().toLowerCase(), 200)

  const roadBooks = useMemo(() => roadBooksOf(road.data), [road.data])
  const orderBook = useMemo(() => orderBookOf(orders.data), [orders.data])

  const countingActive =
    place.value !== undefined &&
    (counts.data?.active ?? []).some((row) => row.site_id === place.value)

  return (
    <PageContent>
      <PageHeader
        title="Stock"
        sub="Every place the business holds stock, one card each."
        actions={
          <span className="contents max-md:hidden">
            <span className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-line-ico" />
              <input
                value={search.value ?? ""}
                onChange={(event) =>
                  event.target.value
                    ? search.open(event.target.value)
                    : search.close()
                }
                aria-label="Search stores"
                className="h-control w-56 rounded-inner border border-hairline-2 bg-canvas pr-2.5 pl-8 text-[0.875rem] text-ink shadow-soft outline-none placeholder:text-body focus:border-accent"
              />
            </span>
            <Select
              value={sort}
              onChange={(value) => setSort(value === "az" ? "az" : "attention")}
              aria-label="Sort places"
              className="w-56"
            >
              <option value="attention">Needs attention first</option>
              <option value="az">A–Z</option>
            </Select>
          </span>
        }
      />
      {/* A phone's search and order are the dock's, as on every list
          (owner, 2026-10-06). */}
      <DockTools
        search={{
          value: search.value ?? "",
          onChange: (next) => (next ? search.open(next) : search.close()),
          label: "Search Stores",
        }}
        sort={{
          label: sort === "az" ? "A–Z" : "Needs attention first",
          choices: {
            options: [
              { value: "attention", label: "Needs attention first" },
              { value: "az", label: "A–Z" },
            ],
            value: sort,
            desc: false,
            onChange: (next) => setSort(next === "az" ? "az" : "attention"),
          },
        }}
      />

      {queryState(fleet, {
        loading: "Counting the fleet…",
        render: (data) =>
          queryState(units, {
            loading: "Loading the stores…",
            render: (unitRows) => {
              const ho = unitRows.find((unit) => unit.kind === "HO")
              const stores = unitRows.filter(
                (unit) => unit.kind === "STORE" && unit.status === "ACTIVE"
              )
              const hoView = ho
                ? placeViewOf(ho, "ho", data.items, cases, roadBooks)
                : null
              const storeViews = stores.map((unit) =>
                placeViewOf(unit, "store", data.items, cases, roadBooks)
              )

              const shown =
                needle === ""
                  ? storeViews
                  : storeViews.filter(
                      (view) =>
                        view.name.toLowerCase().includes(needle) ||
                        view.unit.code.toLowerCase().includes(needle)
                    )
              const ordered = [...shown].sort(
                sort === "az"
                  ? (left, right) => left.name.localeCompare(right.name)
                  : byAttention
              )

              const storesBook = storeViews.reduce(
                (running, view) => running + view.fig.book,
                0
              )
              // The stores' shared Observed line only prints when every
              // store that holds stock was actually swept — one unknown
              // store and the sum would quietly claim to be the fleet's.
              const allSeen = storeViews.every(
                (view) => view.fig.seen !== null || view.fig.book === 0
              )
              const storesSeen = allSeen
                ? storeViews.reduce(
                    (running, view) => running + (view.fig.seen ?? 0),
                    0
                  )
                : null

              const sheetLookup = new Map<string, PlaceView>()
              for (const view of [hoView, ...storeViews]) {
                if (view !== null) sheetLookup.set(view.key, view)
              }

              if (hoView === null && storeViews.length === 0) {
                return (
                  <p className="py-14 text-center text-meta text-body">
                    No units are registered yet — Stock has nowhere to stand.
                  </p>
                )
              }

              return (
                <>
                  <div className="flex flex-col gap-6">
                    {hoView !== null && (
                      <section>
                        <GroupHead
                          label="HO"
                          figures={
                            <>
                              <b className="font-semibold text-ink tabular-nums">
                                {roadBooks.total === null
                                  ? count(hoView.fig.book)
                                  : count(hoView.fig.book + roadBooks.total)}
                              </b>{" "}
                              inventory
                            </>
                          }
                        />
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                          <PlaceCard
                            view={hoView}
                            onOpen={() => place.open(hoView.key)}
                          />
                          <RoadCard
                            books={roadBooks}
                            onOpen={() => place.open(ROAD_SHEET)}
                          />
                          <OrderCard
                            book={orderBook}
                            loading={orders.isPending}
                            onOpen={() => place.open(ORDER_SHEET)}
                          />
                        </div>
                      </section>
                    )}

                    <section>
                      <GroupHead
                        label={`Stores · ${storeViews.length}`}
                        figures={
                          <>
                            <b className="font-semibold text-ink tabular-nums">
                              {count(storesBook)}
                            </b>{" "}
                            inventory ·{" "}
                            <b className="font-semibold text-ink tabular-nums">
                              {count(storesSeen)}
                            </b>{" "}
                            observed
                          </>
                        }
                      />
                      {storeViews.length === 0 ? (
                        <p className="text-[0.875rem] text-mute">
                          No stores are registered yet.
                        </p>
                      ) : shown.length === 0 ? (
                        <NoMatch
                          what="stores"
                          held={storeViews.length}
                          onClear={() => search.close()}
                        />
                      ) : (
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                          {ordered.map((view) => (
                            <PlaceCard
                              key={view.key}
                              view={view}
                              onOpen={() => place.open(view.key)}
                            />
                          ))}
                        </div>
                      )}
                    </section>
                  </div>

                  {place.value === ROAD_SHEET && (
                    <RoadSheet
                      books={roadBooks}
                      onClose={() => place.close()}
                    />
                  )}
                  {place.value === ORDER_SHEET && (
                    <OrderSheet
                      book={orderBook}
                      loading={orders.isPending}
                      onClose={() => place.close()}
                    />
                  )}
                  {place.value !== ROAD_SHEET &&
                    place.value !== ORDER_SHEET &&
                    place.value !== undefined &&
                    (() => {
                      const view = sheetLookup.get(place.value)
                      return view === undefined ? null : (
                        <PlaceSheet
                          view={view}
                          countingActive={countingActive}
                          countingPending={counting.isPending}
                          actorReady={actor !== ""}
                          onCount={() =>
                            view.fig.mainPool !== undefined &&
                            counting.mutate({
                              siteId: view.fig.mainPool.site_id,
                              poolId: view.fig.mainPool.id,
                            })
                          }
                          onClose={() => place.close()}
                        />
                      )
                    })()}
                </>
              )
            },
          }),
      })}
    </PageContent>
  )
}

// ---------------------------------------------------------------------------
// Books
// ---------------------------------------------------------------------------

interface RoadBooks {
  /// Pieces in the air to any destination, or null while the book loads.
  readonly total: number | null
  readonly toStores: number | null
  readonly backToHo: number | null
  readonly trips: readonly AllotmentRow[]
  readonly rets: readonly AllotmentRow[]
  /// Per destination site id, or null while loading.
  readonly perDestination: ReadonlyMap<string, number> | null
}

function roadBooksOf(data: AllotmentList | undefined): RoadBooks {
  if (data === undefined) {
    return {
      total: null,
      toStores: null,
      backToHo: null,
      trips: [],
      rets: [],
      perDestination: null,
    }
  }
  const book = data
  const moving = book.items.filter((row) => row.total_in_transit_quantity > 0)
  const sum = (rows: readonly AllotmentRow[]) =>
    rows.reduce((running, row) => running + row.total_in_transit_quantity, 0)
  const trips = moving.filter(
    (row) => row.type === "TO_STORE" || row.type === "TO_SITE"
  )
  const rets = moving.filter((row) => row.type === "RETURN_TO_DC")
  const perDestination = new Map<string, number>()
  for (const rollup of book.by_destination) {
    if (rollup.total_in_transit_quantity === 0) continue
    perDestination.set(
      rollup.destination_id,
      (perDestination.get(rollup.destination_id) ?? 0) +
        rollup.total_in_transit_quantity
    )
  }
  return {
    total: sum(moving),
    toStores: sum(trips),
    backToHo: sum(rets),
    trips,
    rets,
    perDestination,
  }
}

interface OrderBook {
  readonly rows: readonly PurchaseOrderRow[]
  readonly awaited: number
  readonly dueThisWeek: number
  readonly late: number
}

function orderBookOf(
  data: readonly PurchaseOrderRow[] | undefined
): OrderBook | null {
  if (data === undefined) return null
  const start = today()
  const horizon = shift(start, 7)
  return {
    rows: data,
    awaited: data.reduce(
      (running, row) => running + row.outstanding_stock_units,
      0
    ),
    dueThisWeek: data.filter(
      (row) =>
        row.expected_arrival !== null &&
        row.expected_arrival >= start &&
        row.expected_arrival <= horizon
    ).length,
    late: data.filter((row) => row.overdue).length,
  }
}

type SortMode = "attention" | "az"

/// More and older exceptions first, then a stale count, then the name —
/// the prototype's own "needs attention" order. A place that has never
/// been counted ranks as stale: nobody has ever stood in front of that
/// number, which is worse than a count that is merely old.
function byAttention(left: PlaceView, right: PlaceView): number {
  const severity = severityOf(right.cases) - severityOf(left.cases)
  if (severity !== 0) return severity
  const stale = (view: PlaceView) =>
    view.fig.days === null || view.fig.days > STALE_DAYS ? 1 : 0
  if (stale(right) !== stale(left)) return stale(right) - stale(left)
  const load = (view: PlaceView) => view.cases?.length ?? 0
  if (load(right) !== load(left)) return load(right) - load(left)
  return left.name.localeCompare(right.name)
}

// ---------------------------------------------------------------------------
// View building
// ---------------------------------------------------------------------------

function placeViewOf(
  unit: UnitView,
  kind: "ho" | "store",
  fleet: readonly FleetPool[],
  cases: readonly ExceptionCase[] | null,
  road: RoadBooks
): PlaceView {
  const siteIds = unit.sites.map((site) => site.id)
  const fig = figuresFor(siteIds, fleet)
  // The sheet stands on the site that actually holds pools; a unit's other
  // sites (an office beside the warehouse) have no stock to tell a story about.
  const holding = fig.pools[0]?.site_id ?? siteIds[0] ?? unit.id
  let onRoad: number | null = null
  if (road.perDestination !== null) {
    let owed = 0
    for (const site of siteIds) owed += road.perDestination.get(site) ?? 0
    onRoad = owed
  }
  return {
    key: holding,
    kind,
    unit,
    siteIds,
    name: unit.name,
    sub: kind === "ho" ? "HO" : `Store · ${unit.code}`,
    fig,
    cases:
      cases === null
        ? null
        : cases.filter((one) => siteIds.includes(one.place)),
    onRoad,
  }
}

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

/// The ring: observed as a share of the book. Dashed and dash-filled when
/// nobody has swept the place (observed unknown — never drawn as nought),
/// amber when the gap runs past the fleet's own hairline.
function Ring({
  book,
  seen,
  size,
}: {
  book: number
  seen: number | null
  size: number
}) {
  const radius = size / 2 - 4
  const circumference = 2 * Math.PI * radius
  if (seen === null) {
    return (
      <div
        className="relative grid shrink-0 place-items-center"
        style={{ width: size, height: size }}
      >
        <svg
          viewBox={`0 0 ${size} ${size}`}
          className="absolute inset-0"
          aria-hidden
        >
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            className="stroke-hairline-2"
            strokeWidth="5"
            strokeDasharray="3 5"
          />
        </svg>
        <span className="text-meta text-mute">—</span>
      </div>
    )
  }
  const share = book > 0 ? Math.min(100, (seen / book) * 100) : 0
  const gapPct = book > 0 ? (Math.abs(seen - book) / book) * 100 : 0
  const warn = gapPct > GAP_WARN_PCT
  return (
    <div
      className="relative grid shrink-0 place-items-center"
      style={{ width: size, height: size }}
    >
      <svg
        viewBox={`0 0 ${size} ${size}`}
        className="absolute inset-0 -rotate-90"
        aria-hidden
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          className="stroke-hairline-2"
          strokeWidth="5"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          className={warn ? "stroke-warn" : "stroke-ink"}
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - share / 100)}
        />
      </svg>
      <span
        className={cn(
          "font-semibold tabular-nums",
          // 14px at either size: the inside of the 62px ring is 52 across,
          // and "100%" in 14px is about 36.
          "text-[0.875rem] leading-none",
          warn ? "text-warn-fg" : "text-ink"
        )}
      >
        {book > 0 ? `${Math.floor(share)}%` : "—"}
      </span>
    </div>
  )
}

function GroupHead({
  label,
  figures,
}: {
  label: string
  figures: React.ReactNode
}) {
  return (
    <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <h2 className="text-[0.875rem] font-medium text-body">{label}</h2>
      <p className="text-[0.875rem] text-mute">{figures}</p>
    </div>
  )
}

const CARD =
  "flex min-w-0 flex-col gap-3 rounded-card border bg-canvas p-4 text-left shadow-soft transition-[border-color,box-shadow] duration-150 hover:border-hairline-strong hover:shadow-pop"

function PlaceCard({ view, onOpen }: { view: PlaceView; onOpen: () => void }) {
  const severity = severityOf(view.cases)
  const stale = view.fig.days === null || view.fig.days > STALE_DAYS
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        CARD,
        severity === 2
          ? "border-bad/50"
          : severity === 1
            ? "border-warn/50"
            : "border-hairline"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <span
            className={cn(
              "grid size-8 shrink-0 place-items-center rounded-inner",
              severity === 2
                ? "bg-bad-bg text-bad-fg"
                : severity === 1
                  ? "bg-warn-bg text-warn-fg"
                  : "bg-soft text-body"
            )}
          >
            {view.kind === "ho" ? (
              <Warehouse className="size-4" />
            ) : (
              <StoreIcon className="size-4" />
            )}
          </span>
          <div className="min-w-0">
            <span className="block truncate text-[0.9375rem] font-semibold text-ink">
              {view.name}
            </span>
            <span className="block truncate text-meta text-mute">
              {view.sub}
            </span>
          </div>
        </div>
        <Ring book={view.fig.book} seen={view.fig.seen} size={62} />
      </div>

      <div className="flex gap-5">
        <Figure label="Inventory">{count(view.fig.book)}</Figure>
        <Figure
          label="Observed"
          warn={
            view.fig.seen !== null &&
            view.fig.book > 0 &&
            gapPct(view.fig) > GAP_WARN_PCT
          }
        >
          {view.fig.seen === null ? "—" : count(view.fig.seen)}
        </Figure>
      </div>

      {view.onRoad !== null && view.onRoad > 0 && (
        <p className="flex items-center gap-1.5 text-meta text-mute">
          <Truck className="size-3.5 shrink-0 text-line-ico" />
          <span>
            <b className="font-semibold text-body tabular-nums">
              +{count(view.onRoad)}
            </b>{" "}
            on the road here
          </span>
        </p>
      )}

      <div className="mt-auto flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-hairline pt-2.5">
        <span
          className={cn(
            "flex items-center gap-1.5 text-meta",
            stale ? "text-warn-fg" : "text-mute"
          )}
        >
          <CalendarCheck className="size-3.5 shrink-0 text-line-ico" />
          {view.fig.lastCountedAt === null ? (
            "Never counted"
          ) : (
            <>
              Last count {dayMonth(view.fig.lastCountedAt)} ·{" "}
              {ageText(view.fig.days)}
            </>
          )}
        </span>
        <ExceptionCue cases={view.cases} severity={severity} />
      </div>
    </button>
  )
}

function gapPct(fig: PlaceFigures): number {
  if (fig.book === 0 || fig.seen === null) return 0
  return (Math.abs(fig.seen - fig.book) / fig.book) * 100
}

function Figure({
  label,
  warn,
  children,
}: {
  label: string
  warn?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="min-w-0">
      <b
        className={cn(
          "block text-[1.375rem] leading-tight font-semibold tabular-nums",
          warn ? "text-warn-fg" : "text-ink"
        )}
      >
        {children}
      </b>
      <span className="text-meta text-mute">{label}</span>
    </div>
  )
}

function ExceptionCue({
  cases,
  severity,
}: {
  cases: readonly ExceptionCase[] | null
  severity: 0 | 1 | 2
}) {
  if (cases === null) {
    return <span className="text-meta text-mute">…</span>
  }
  if (cases.length === 0) {
    return <span className="text-meta text-mute">No exceptions</span>
  }
  return (
    <span
      className={cn(
        "text-meta font-medium",
        severity === 2
          ? "text-bad-fg"
          : severity === 1
            ? "text-warn-fg"
            : "text-body"
      )}
    >
      {cases.length} {cases.length === 1 ? "exception" : "exceptions"}
    </span>
  )
}

/// The road card. Its ring would be a lie — nothing out there has been
/// swept, and "on the road" is the one place Observed means nothing.
function RoadCard({ books, onOpen }: { books: RoadBooks; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(CARD, "border-hairline")}
    >
      <div className="flex items-start gap-2.5">
        <span className="grid size-8 shrink-0 place-items-center rounded-inner bg-soft text-body">
          <Truck className="size-4" />
        </span>
        <div className="min-w-0">
          <span className="block truncate text-[0.9375rem] font-semibold text-ink">
            On the road
          </span>
          <span className="block truncate text-meta text-mute">
            In inventory
          </span>
        </div>
      </div>
      <div className="flex gap-5">
        <Figure label="To stores">{count(books.toStores)}</Figure>
        <Figure label="Back to HO">{count(books.backToHo)}</Figure>
      </div>
      <div className="mt-auto flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-hairline pt-2.5">
        <span className="flex items-center gap-1.5 text-meta text-mute">
          <ClipboardList className="size-3.5 shrink-0 text-line-ico" />
          {books.total === null ? (
            "…"
          ) : (
            <>
              {books.trips.length} {books.trips.length === 1 ? "trip" : "trips"}{" "}
              · {books.rets.length}{" "}
              {books.rets.length === 1 ? "return" : "returns"}
            </>
          )}
        </span>
        <span className="text-meta text-mute">No exceptions</span>
      </div>
    </button>
  )
}

/// The on-order ghost card: stock the business is owed, which is not in the
/// inventory and must not read as if it were.
function OrderCard({
  book,
  loading,
  onOpen,
}: {
  book: OrderBook | null
  loading: boolean
  onOpen: () => void
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        CARD,
        "border-dashed border-hairline-2 bg-transparent hover:bg-canvas"
      )}
    >
      <div className="flex items-start gap-2.5">
        <span className="grid size-8 shrink-0 place-items-center rounded-inner border border-dashed border-hairline-2 text-mute">
          <ClipboardList className="size-4" />
        </span>
        <div className="min-w-0">
          <span className="block truncate text-[0.9375rem] font-semibold text-ink">
            On order
          </span>
          <span className="block truncate text-meta text-mute">
            Not in inventory
          </span>
        </div>
      </div>
      <div className="flex gap-5">
        <Figure label="Awaited">
          {book === null ? "—" : count(book.awaited)}
        </Figure>
        <Figure label="Due this week">
          {book === null ? "—" : count(book.dueThisWeek)}
        </Figure>
      </div>
      <div className="mt-auto flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-hairline pt-2.5">
        <span className="flex items-center gap-1.5 text-meta text-mute">
          <ClipboardList className="size-3.5 shrink-0 text-line-ico" />
          {loading ? "…" : count(book?.rows.length ?? 0)} PO
        </span>
        <span
          className={cn(
            "text-meta font-medium",
            (book?.late ?? 0) > 0 ? "text-warn-fg" : "text-mute"
          )}
        >
          {book === null
            ? "…"
            : book.late > 0
              ? `${book.late} late`
              : "None late"}
        </span>
      </div>
    </button>
  )
}

// ---------------------------------------------------------------------------
// Sheets
// ---------------------------------------------------------------------------

function SheetSection({
  title,
  aside,
  children,
}: {
  title: string
  aside?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section>
      <h3 className="mb-2 flex items-baseline justify-between gap-3 text-[0.875rem] font-semibold text-ink">
        {title}
        {aside !== undefined && (
          <span className="font-normal text-mute">{aside}</span>
        )}
      </h3>
      {children}
    </section>
  )
}

/// One place's whole story: the ring and the gap, the count and the button
/// that starts the next one, the exceptions standing against the place (each
/// jumping to the inbox that owns them), and the pools the number is made of.
function PlaceSheet({
  view,
  countingActive,
  countingPending,
  actorReady,
  onCount,
  onClose,
}: {
  view: PlaceView
  countingActive: boolean
  countingPending: boolean
  actorReady: boolean
  onCount: () => void
  onClose: () => void
}) {
  const fig = view.fig
  const stale = fig.days === null || fig.days > STALE_DAYS
  const gap = fig.seen === null || fig.book === 0 ? null : fig.seen - fig.book
  const where = fig.pools
    .filter((pool) => !pool.is_rollup && pool.site_id === view.key)
    .sort((left, right) => left.display_order - right.display_order)

  return (
    <Sheet
      open
      onOpenChange={(open) => !open && onClose()}
      id={view.key}
      title={view.name}
      caption={view.sub}
    >
      <div className="flex flex-col gap-5">
        <div className="flex items-center gap-4">
          <Ring book={fig.book} seen={fig.seen} size={96} />
          <div className="grid flex-1 grid-cols-3 gap-3">
            <Figure label="Inventory">{count(fig.book)}</Figure>
            <Figure
              label="Observed"
              warn={
                fig.seen !== null && fig.book > 0 && gapPct(fig) > GAP_WARN_PCT
              }
            >
              {fig.seen === null ? "—" : count(fig.seen)}
            </Figure>
            <Figure
              label="Gap"
              warn={
                gap !== null && (Math.abs(gap) / fig.book) * 100 > GAP_WARN_PCT
              }
            >
              {gap === null ? "—" : signed(gap)}
            </Figure>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline pb-3">
          <span
            className={cn(
              "text-[0.875rem]",
              stale ? "text-warn-fg" : "text-body"
            )}
          >
            Last count{" "}
            <b className="font-semibold">
              {fig.lastCountedAt === null ? "never" : day(fig.lastCountedAt)}
            </b>
            {fig.lastCountedAt !== null && (
              <span className="text-mute"> · {ageText(fig.days)} ago</span>
            )}
          </span>
          {countingActive ? (
            <Pill tone="info">Count active</Pill>
          ) : (
            <Button
              size="sm"
              variant={stale ? "primary" : "ghost"}
              pending={countingPending}
              disabled={!actorReady || fig.mainPool === undefined}
              onClick={onCount}
            >
              Count {view.kind === "ho" ? "HO" : "store"}
            </Button>
          )}
        </div>

        <SheetSection
          title="Exceptions"
          aside={view.cases === null ? undefined : count(view.cases.length)}
        >
          {view.cases === null ? (
            <p className="text-[0.875rem] text-mute">…</p>
          ) : view.cases.length === 0 ? (
            <p className="text-[0.875rem] text-mute">No exceptions</p>
          ) : (
            <div className="flex flex-col">
              {view.cases.map((one) => (
                <div
                  key={one.id}
                  className="flex items-start justify-between gap-3 border-t border-hairline py-2.5 first:border-t-0"
                >
                  <div className="min-w-0">
                    <span className="block truncate text-[0.875rem] text-ink">
                      {one.article ?? one.sku ?? one.kind}
                    </span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-meta text-mute">
                      <span>{one.kind}</span>
                      <span>· {one.poolLabel}</span>
                      {one.from && <span>· from {one.from}</span>}
                      <span
                        className={cn(
                          (one.ageDays ?? 0) > STALE_DAYS && "text-bad-fg"
                        )}
                      >
                        · {ageText(one.ageDays)}
                      </span>
                      {one.status === "Counting" && (
                        <Pill tone="info">Counting</Pill>
                      )}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span
                      className={cn(
                        "font-mono text-[0.875rem] tabular-nums",
                        one.qty < 0 ? "text-bad-fg" : "text-ink"
                      )}
                    >
                      {signed(one.qty)}
                    </span>
                    <AppLink
                      to="/inventory/exceptions"
                      className="flex items-center gap-0.5 text-meta text-accent underline-offset-2 hover:underline"
                    >
                      Open
                      <ArrowUpRight className="size-3" />
                    </AppLink>
                  </div>
                </div>
              ))}
            </div>
          )}
        </SheetSection>

        <SheetSection title="Where">
          <Facts>
            {where.map((pool) => (
              <Fact key={pool.id} term={pool.label}>
                {count(pool.stock)}
              </Fact>
            ))}
            {view.onRoad !== null && view.onRoad > 0 && (
              <Fact term="On the road here">+{count(view.onRoad)}</Fact>
            )}
          </Facts>
        </SheetSection>
      </div>
    </Sheet>
  )
}

/// The road sheet: what is in the air, split the way it travels — out to
/// the stores, and back from them.
function RoadSheet({
  books,
  onClose,
}: {
  books: RoadBooks
  onClose: () => void
}) {
  const tripRow = (row: AllotmentRow) => (
    <tr key={row.id} className="border-t border-hairline">
      <td className="py-2 pr-2">
        <span className="block font-mono text-[0.875rem] text-ink">
          {row.allotment_number}
        </span>
        <span className="block truncate text-meta text-mute">
          HO → {row.destination_names?.join(", ") ?? "—"}
        </span>
      </td>
      <td className="py-2 text-right tabular-nums">
        {count(row.total_in_transit_quantity)}
      </td>
      <td className="py-2 text-right text-meta text-mute">
        {dayMonth(row.updated_at)}
      </td>
    </tr>
  )
  const retRow = (row: AllotmentRow) => (
    <tr key={row.id} className="border-t border-hairline">
      <td className="py-2 pr-2">
        <span className="block font-mono text-[0.875rem] text-ink">
          {row.allotment_number}
        </span>
        <span className="block truncate text-meta text-mute">
          From stores → HO
        </span>
      </td>
      <td className="py-2 text-right tabular-nums">
        {count(row.total_in_transit_quantity)}
      </td>
      <td className="py-2 text-right text-meta text-mute">
        {dayMonth(row.updated_at)}
      </td>
    </tr>
  )

  return (
    <Sheet
      open
      onOpenChange={(open) => !open && onClose()}
      title="On the road"
      caption="In inventory — counted in the books, standing in a truck"
    >
      <div className="flex flex-col gap-5">
        <div className="grid grid-cols-3 gap-3">
          <Figure label="Inventory">
            {books.total === null ? "—" : count(books.total)}
          </Figure>
          <Figure label="To stores">
            {books.toStores === null ? "—" : count(books.toStores)}
          </Figure>
          <Figure label="Back to HO">
            {books.backToHo === null ? "—" : count(books.backToHo)}
          </Figure>
        </div>

        <SheetSection title="To stores" aside={count(books.toStores)}>
          {books.trips.length === 0 ? (
            <p className="text-[0.875rem] text-mute">
              Nothing is on its way to a store.
            </p>
          ) : (
            <MiniTable head={["Allotment", "Quantity", "Last Moved"]}>
              {books.trips.map(tripRow)}
            </MiniTable>
          )}
        </SheetSection>

        <SheetSection title="Back to HO" aside={count(books.backToHo)}>
          {books.rets.length === 0 ? (
            <p className="text-[0.875rem] text-mute">Nothing is coming back.</p>
          ) : (
            <MiniTable head={["Allotment", "Quantity", "Last Moved"]}>
              {books.rets.map(retRow)}
            </MiniTable>
          )}
        </SheetSection>
      </div>
    </Sheet>
  )
}

/// The on-order sheet: the open orders behind the ghost card, each with its
/// outstanding position and the promise it is living on.
function OrderSheet({
  book,
  loading,
  onClose,
}: {
  book: OrderBook | null
  loading: boolean
  onClose: () => void
}) {
  return (
    <Sheet
      open
      onOpenChange={(open) => !open && onClose()}
      title="On order"
      caption="Not in inventory — owed by suppliers"
    >
      <div className="flex flex-col gap-5">
        <div className="grid grid-cols-3 gap-3">
          <Figure label="Awaited">
            {book === null ? "—" : count(book.awaited)}
          </Figure>
          <Figure label="Due this week">
            {book === null ? "—" : count(book.dueThisWeek)}
          </Figure>
          <Figure label="Late PO" warn={(book?.late ?? 0) > 0}>
            {book === null ? "—" : count(book.late)}
          </Figure>
        </div>

        <SheetSection
          title="Purchase orders"
          aside={book === null ? undefined : count(book.rows.length)}
        >
          {loading && book === null ? (
            <p className="text-[0.875rem] text-mute">…</p>
          ) : book === null || book.rows.length === 0 ? (
            <p className="text-[0.875rem] text-mute">Nothing is on order.</p>
          ) : (
            <MiniTable head={["Order", "Outstanding", "Promised"]}>
              {book.rows.map((row) => (
                <tr
                  key={row.purchase_order_id}
                  className="border-t border-hairline"
                >
                  <td className="py-2 pr-2">
                    <span className="block font-mono text-[0.875rem] text-ink">
                      {row.po_number}
                    </span>
                    <span className="block truncate text-meta text-mute">
                      {row.supplier_name ?? row.supplier_id}
                    </span>
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {count(row.outstanding_stock_units)}
                  </td>
                  <td className="py-2 text-right text-meta">
                    {row.expected_arrival === null ? (
                      <span className="text-mute">No promise yet</span>
                    ) : (
                      <>
                        <span className="text-mute">
                          {dayMonth(row.expected_arrival)}
                        </span>
                        {row.overdue && (
                          <span className="ml-1.5 font-medium text-warn-fg">
                            Late
                          </span>
                        )}
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </MiniTable>
          )}
        </SheetSection>

        <div>
          <AppLink
            to="/procurement/orders"
            variant="soft"
            className="inline-flex items-center gap-1.5"
          >
            Open in Procurement
            <ArrowUpRight className="size-4" />
          </AppLink>
        </div>
      </div>
    </Sheet>
  )
}
