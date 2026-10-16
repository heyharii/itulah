import {
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQueries,
} from "@tanstack/react-query"
import { Suspense, useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { AppLink } from "@/components/ui/app-link"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { MiniCell, MiniRow, MiniTable } from "@/components/ui/rows"
import { Sheet } from "@/components/ui/sheet"
import { SheetFooter } from "@/components/ui/sheet-footer"
import { SubTabs } from "@/components/ui/sub-tabs"
import { PlaceStockCard } from "@/screens/inventory/stock-card"
import { LoadingState } from "@/components/ui/states"
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
import { unitsQuery, type UnitView } from "@/lib/queries/organisation"
import { useSheet } from "@/lib/sheets"
import { signed, useActor } from "@/screens/inventory/shared"
import {
  useExceptionCases,
  type ExceptionCase,
} from "@/screens/inventory/exceptions-data"
import { cn } from "@/lib/utils"

/// Stock, as the owner picked it (inventory-control-options.html, variant
/// ★E "Store cards"): one card per place the business holds stock, Inventory
/// beside Observed (C · Books | Seen, 16 Oct 2026), with its last count and
/// its exceptions. HO, In transit and the stores are three groups: stock in a
/// truck is at neither end. What is on order is not stock and is not here.
/// Every figure is live — the fleet read, the allotment rollups and the
/// exceptions inbox — and a number nobody can compute honestly draws a dash
/// rather than a guess.
///
/// The sheet behind a card is the place's whole story: its figures, then
/// tabs for the pools the number is made of, the exceptions standing against
/// it, and the latest movements; the count is the foot's one verb.

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

/// The card that is not a place, keyed into the same sheet parameter as the
/// places: values the root validator already accepts (any non-empty
/// id), interpreted by this screen and by nothing else on this route.
const ROAD_SHEET = "road"

const GRID =
  "grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4"

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
  return (
    <PageContent>
      <PageHeader
        title="Stock"
        sub="Every place the business holds stock, one card each."
      />

      {/* The cards wait for the fleet and the stores and stream in with them
          (the server starts both reads too). What a card says beyond them —
          the exceptions, the road and the counts — is asked for by plain
          hooks and fills in as each lands, as it always did. */}
      <Suspense fallback={<LoadingState>Counting the fleet…</LoadingState>}>
        <StockPlaces />
      </Suspense>
    </PageContent>
  )
}

function StockPlaces() {
  const [fleet, units] = useSuspenseQueries({
    queries: [fleetPoolsQuery(), unitsQuery()],
  })
  const { cases } = useExceptionCases()

  // The road: one read of the allotment book. The per-destination rollup is
  // computed by the server over the WHOLE table — not just the rows that
  // came back — so "what is owed to each store" needs no second request.
  const road = useQuery(allotmentListQuery("", ""))

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

  const place = useSheet("location")

  const roadBooks = useMemo(() => roadBooksOf(road.data), [road.data])

  const countingActive =
    place.value !== undefined &&
    (counts.data?.active ?? []).some((row) => row.site_id === place.value)

  return (
    <>
      {(() => {
        const ho = units.data.find((unit) => unit.kind === "HO")
        const stores = units.data.filter(
          (unit) => unit.kind === "STORE" && unit.status === "ACTIVE"
        )
        const hoView = ho
          ? placeViewOf(ho, "ho", fleet.data.items, cases, roadBooks)
          : null
        const storeViews = stores.map((unit) =>
          placeViewOf(unit, "store", fleet.data.items, cases, roadBooks)
        )

        const ordered = [...storeViews].sort(byAttention)

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
                          {count(hoView.fig.book)}
                        </b>{" "}
                        inventory
                      </>
                    }
                  />
                  <div className={GRID}>
                    <PlaceCard
                      view={hoView}
                      onOpen={() => place.open(hoView.key)}
                    />
                  </div>
                </section>
              )}

              <section>
                <GroupHead
                  label="In transit"
                  figures={
                    <>
                      <b className="font-semibold text-ink tabular-nums">
                        {count(roadBooks.total)}
                      </b>{" "}
                      inventory
                    </>
                  }
                />
                <div className={GRID}>
                  <TransitCard
                    books={roadBooks}
                    onOpen={() => place.open(ROAD_SHEET)}
                  />
                </div>
              </section>

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
                  <p className="text-[0.9375rem] text-mute">
                    No stores are registered yet.
                  </p>
                ) : (
                  <div className={GRID}>
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
              <RoadSheet books={roadBooks} onClose={() => place.close()} />
            )}
            {place.value !== ROAD_SHEET &&
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
      })()}
    </>
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

function GroupHead({
  label,
  figures,
}: {
  label: string
  figures: React.ReactNode
}) {
  return (
    <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <h2 className="text-[0.9375rem] font-medium text-body">{label}</h2>
      <p className="text-[0.9375rem] text-mute">{figures}</p>
    </div>
  )
}

function gapPct(fig: PlaceFigures): number {
  if (fig.book === 0 || fig.seen === null) return 0
  return (Math.abs(fig.seen - fig.book) / fig.book) * 100
}

/// The card frame every card on this board shares.
const CARD =
  "flex min-w-0 flex-col gap-3 rounded-card border border-hairline bg-canvas p-4 text-left transition-[border-color,scale] duration-150 ease-(--ease-out) hover:border-hairline-strong active:scale-[0.98]"

/// Two figures side by side with a rule between — the books on the left, the
/// other half on the right (owner, 16 Oct 2026: C · Books | Seen).
function Halves({
  left,
  right,
}: {
  left: { label: string; value: React.ReactNode }
  right: { label: string; value: React.ReactNode }
}) {
  return (
    <div className="grid grid-cols-2">
      {[left, right].map((half, index) => (
        <div
          key={half.label}
          className={cn(
            "min-w-0",
            index > 0 && "border-l border-hairline pl-4"
          )}
        >
          <span className="block truncate text-[0.9375rem] text-mute">
            {half.label}
          </span>
          <b className="block text-[1rem] font-semibold text-ink tabular-nums">
            {half.value}
          </b>
        </div>
      ))}
    </div>
  )
}

/// One place: its name and the exceptions standing against it, Inventory
/// beside Observed (with the gap when there is one), and when it was last
/// counted.
function PlaceCard({ view, onOpen }: { view: PlaceView; onOpen: () => void }) {
  const fig = view.fig
  const gap = fig.seen === null || fig.book === 0 ? null : fig.seen - fig.book
  const gapWarn =
    fig.seen !== null && fig.book > 0 && gapPct(fig) > GAP_WARN_PCT
  const stale = fig.days === null || fig.days > STALE_DAYS
  const severity = severityOf(view.cases)
  const cases = view.cases?.length ?? 0
  const transit = view.onRoad !== null && view.onRoad > 0 ? view.onRoad : null
  return (
    <button type="button" onClick={onOpen} className={CARD}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span className="block truncate text-[0.9375rem] font-semibold text-ink">
            {view.name}
          </span>
          <span className="block truncate text-[0.9375rem] text-mute">
            {view.sub}
          </span>
        </div>
        {cases > 0 && (
          <span
            className={cn(
              "shrink-0 text-[0.9375rem] font-medium",
              severity === 2
                ? "text-bad-fg"
                : severity === 1
                  ? "text-warn-fg"
                  : "text-body"
            )}
          >
            {cases} {cases === 1 ? "exception" : "exceptions"}
          </span>
        )}
      </div>
      <Halves
        left={{ label: "Inventory", value: count(fig.book) }}
        right={{
          label: "Observed",
          value:
            fig.seen === null ? (
              "—"
            ) : (
              <span className={cn(gapWarn && "text-warn-fg")}>
                {count(fig.seen)}
                {gap !== null && gap !== 0 && (
                  <span className="ml-1.5 font-normal text-mute">
                    {signed(gap)}
                  </span>
                )}
              </span>
            ),
        }}
      />
      <div className="mt-auto flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-t border-hairline pt-2.5 text-[0.9375rem]">
        {fig.lastCountedAt === null ? (
          <span className={cn(fig.book > 0 ? "text-warn-fg" : "text-mute")}>
            Never counted
          </span>
        ) : (
          <span className={cn(stale ? "text-warn-fg" : "text-mute")}>
            Counted {dayMonth(fig.lastCountedAt)} · {ageText(fig.days)}
          </span>
        )}
        {transit !== null && (
          <span className="text-mute tabular-nums">
            +{count(transit)} in transit
          </span>
        )}
      </div>
    </button>
  )
}

/// In transit: stock in the books and in a truck, between HO and the stores
/// — so it stands in a group of its own, under neither (owner, 16 Oct 2026).
/// No Observed half: nothing on the road has been swept.
function TransitCard({
  books,
  onOpen,
}: {
  books: RoadBooks
  onOpen: () => void
}) {
  return (
    <button type="button" onClick={onOpen} className={CARD}>
      <div className="min-w-0">
        <span className="block truncate text-[0.9375rem] font-semibold text-ink">
          In transit
        </span>
        <span className="block truncate text-[0.9375rem] text-mute">
          {books.total === null
            ? "…"
            : `${books.trips.length} ${books.trips.length === 1 ? "trip" : "trips"} · ${books.rets.length} ${books.rets.length === 1 ? "return" : "returns"}`}
        </span>
      </div>
      <Halves
        left={{ label: "To stores", value: count(books.toStores) }}
        right={{ label: "Back to HO", value: count(books.backToHo) }}
      />
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
      <h3 className="mb-2 flex items-baseline justify-between gap-3 text-[0.9375rem] font-semibold text-ink">
        {title}
        {aside !== undefined && (
          <span className="font-normal text-mute">{aside}</span>
        )}
      </h3>
      {children}
    </section>
  )
}

/// One place's whole story, as the owner picked it (inventory-detail-options
/// .html, A · Pools table, version 2 · Tabs — 16 Oct 2026): the figures in
/// the head, then three tabs — the pools the number is made of, the
/// exceptions standing against the place, and the latest movements in and
/// out of its pools. The count is the foot's one verb.
///
/// Pools with nothing in them are folded behind "Show n empty pools": a head
/// office reads Packed / Store 01…07 at nought on most days, and seven
/// noughts drown the three shelves that hold stock.
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
  const [tab, setTab] = useState("pools")
  const [showEmpty, setShowEmpty] = useState(false)
  const stale = fig.days === null || fig.days > STALE_DAYS
  const gap = fig.seen === null || fig.book === 0 ? null : fig.seen - fig.book
  const gapWarn =
    gap !== null && (Math.abs(gap) / fig.book) * 100 > GAP_WARN_PCT
  const where = fig.pools
    .filter((pool) => !pool.is_rollup && pool.site_id === view.key)
    .sort((left, right) => left.display_order - right.display_order)
  const held = where.filter((pool) => pool.stock !== 0)
  const empty = where.length - held.length
  const shown = showEmpty ? where : held
  const cases = view.cases

  const figures = [
    { label: "Inventory", value: count(fig.book) },
    {
      label: "Observed",
      value: fig.seen === null ? "—" : count(fig.seen),
    },
    {
      label: "Gap",
      value: (
        <span className={cn(gapWarn && "text-warn-fg")}>
          {gap === null ? "—" : signed(gap)}
        </span>
      ),
    },
    {
      label: "Last count",
      value: (
        <span className={cn(stale && "text-warn-fg")}>
          {fig.lastCountedAt === null ? "Never" : day(fig.lastCountedAt)}
        </span>
      ),
    },
    ...(view.onRoad !== null && view.onRoad > 0
      ? [{ label: "In transit here", value: `+${count(view.onRoad)}` }]
      : []),
  ]

  // Tabs at the owner's word for this sheet (16 Oct 2026, "tabs saja"),
  // drawn in the body: the shared `tabs` prop folds a record into one scroll.
  const sections: readonly {
    readonly value: string
    readonly label: React.ReactNode
    readonly content: React.ReactNode
  }[] = [
    {
      value: "pools",
      label: "Pools",
      content:
        where.length === 0 ? (
          <p className="text-[0.9375rem] text-mute">No pools here</p>
        ) : (
          <div className="flex flex-col gap-3">
            {shown.length > 0 && (
              <MiniTable head={["Pool", "Inventory", "Observed", "Gap"]}>
                {shown.map((pool) => (
                  <MiniRow key={pool.id}>
                    <MiniCell>{pool.label}</MiniCell>
                    <MiniCell align="right">{count(pool.stock)}</MiniCell>
                    <MiniCell align="right">
                      {pool.observed == null ? "—" : count(pool.observed)}
                    </MiniCell>
                    <MiniCell align="right">
                      {pool.observed == null
                        ? "—"
                        : signed(pool.observed - pool.stock)}
                    </MiniCell>
                  </MiniRow>
                ))}
                <MiniRow>
                  <MiniCell className="font-semibold text-ink">Total</MiniCell>
                  <MiniCell align="right" className="font-semibold text-ink">
                    {count(fig.book)}
                  </MiniCell>
                  <MiniCell align="right" className="font-semibold text-ink">
                    {fig.seen === null ? "—" : count(fig.seen)}
                  </MiniCell>
                  <MiniCell align="right" className="font-semibold text-ink">
                    {gap === null ? "—" : signed(gap)}
                  </MiniCell>
                </MiniRow>
              </MiniTable>
            )}
            {empty > 0 && (
              <button
                type="button"
                onClick={() => setShowEmpty((open) => !open)}
                className="self-start text-[0.9375rem] text-accent underline-offset-2 hover:underline"
              >
                {showEmpty ? "Hide" : "Show"} {count(empty)} empty{" "}
                {empty === 1 ? "pool" : "pools"}
              </button>
            )}
          </div>
        ),
    },
    {
      value: "exceptions",
      label: (
        <>
          Exceptions
          {cases !== null && cases.length > 0 && (
            <span className="ml-1.5 text-mute">{count(cases.length)}</span>
          )}
        </>
      ),
      content:
        cases === null ? (
          <p className="text-[0.9375rem] text-mute">…</p>
        ) : cases.length === 0 ? (
          <p className="text-[0.9375rem] text-mute">No exceptions</p>
        ) : (
          <div className="flex flex-col gap-3">
            <MiniTable
              head={[
                "Article",
                { label: "Exception", align: "left" },
                { label: "Pool", align: "left" },
                "Pieces",
                "Age",
              ]}
            >
              {cases.map((one) => (
                <MiniRow key={one.id}>
                  <MiniCell>
                    {one.article ?? one.sku ?? one.kind}
                    {one.status === "Counting" && (
                      <span className="ml-1.5 text-info-fg">· Counting</span>
                    )}
                  </MiniCell>
                  <MiniCell>{one.kind}</MiniCell>
                  <MiniCell className="text-mute">{one.poolLabel}</MiniCell>
                  <MiniCell align="right">{signed(one.qty)}</MiniCell>
                  <MiniCell
                    align="right"
                    className={cn(
                      (one.ageDays ?? 0) > STALE_DAYS
                        ? "text-bad-fg"
                        : "text-mute"
                    )}
                  >
                    {ageText(one.ageDays)}
                  </MiniCell>
                </MiniRow>
              ))}
            </MiniTable>
            <AppLink
              to="/inventory/exceptions"
              className="self-start text-[0.9375rem] text-accent underline-offset-2 hover:underline"
            >
              Open in Exceptions
            </AppLink>
          </div>
        ),
    },
    {
      value: "card",
      label: "Stock card",
      content: tab === "card" && <PlaceStockCard site={view.key} />,
    },
  ]
  const current =
    sections.find((section) => section.value === tab) ?? sections[0]

  return (
    <Sheet
      open
      onOpenChange={(open) => !open && onClose()}
      id={view.key}
      title={view.name}
      caption={view.sub}
      size="table"
      footer={
        <SheetFooter
          start={
            countingActive ? <Pill tone="info">Count active</Pill> : undefined
          }
          primary={
            countingActive
              ? undefined
              : {
                  label: `Count ${view.kind === "ho" ? "HO" : "store"}`,
                  onClick: onCount,
                  pending: countingPending,
                  disabled: !actorReady || fig.mainPool === undefined,
                }
          }
        />
      }
    >
      <div className="flex flex-col gap-6">
        {/* The record's figures first, in the body, as the PO detail has
            them (owner, 16 Oct 2026). */}
        <KpiStrip className="mb-2!">
          {figures.map((one) => (
            <Kpi key={one.label} label={one.label} value={one.value} />
          ))}
        </KpiStrip>
        <SubTabs
          tabs={sections.map(({ value, label }) => ({ value, label }))}
          value={current.value}
          onChange={setTab}
        />
        <div>{current.content}</div>
      </div>
    </Sheet>
  )
}

/// The in-transit sheet: what is in the air, split the way it travels — out to
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
        <span className="block font-mono text-[0.9375rem] text-ink">
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
        <span className="block font-mono text-[0.9375rem] text-ink">
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
    <Sheet open onOpenChange={(open) => !open && onClose()} title="In transit">
      <div className="flex flex-col gap-6">
        <KpiStrip className="mb-2!">
          <Kpi label="Inventory" value={count(books.total)} />
          <Kpi label="To stores" value={count(books.toStores)} />
          <Kpi label="Back to HO" value={count(books.backToHo)} />
        </KpiStrip>
        <SheetSection title="To stores" aside={count(books.toStores)}>
          {books.trips.length === 0 ? (
            <p className="text-[0.9375rem] text-mute">
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
            <p className="text-[0.9375rem] text-mute">
              Nothing is coming back.
            </p>
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
