import { ChevronRight } from "lucide-react"
import {
  useQuery,
  useSuspenseQueries,
} from "@tanstack/react-query"
import { useHydrated } from "@tanstack/react-router"
import { Suspense, useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Input } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { MiniCell, MiniRow, MiniTable } from "@/components/ui/rows"
import { Sheet } from "@/components/ui/sheet"
import { SheetFooter } from "@/components/ui/sheet-footer"
import { SubTabs } from "@/components/ui/sub-tabs"
import { PlaceStockCard } from "@/screens/inventory/stock-card"
import { LoadingState } from "@/components/ui/states"
import { count, day, dayMonth, sku as skuNumber } from "@/lib/format"
import {
  allotmentListQuery,
  countsBoardQuery,
  fleetPoolsQuery,
  type AllotmentList,
  type AllotmentRow,
  type CountRow,
  type FleetPool,
} from "@/lib/queries/inventory"
import { unitsQuery, type UnitView } from "@/lib/queries/organisation"
import { useSheet } from "@/lib/sheets"
import {
  groupMissing,
  isTransitPool,
  useMissingRows,
} from "@/screens/inventory/missing-data"
import { MissingSheet } from "@/screens/inventory/missing-list"
import { CountedCell } from "@/screens/inventory/counts"
import { signed } from "@/screens/inventory/shared"
import {
  handOf,
  pocketsOf,
  roleOf,
  type Pocket,
} from "@/screens/inventory/stock-pockets"
import { cn } from "@/lib/utils"

/// Stock, "table A · Calm" (missing-prototype.html): one table, a row per
/// place. Inventory INCLUDES the place's Missing pocket; Observed is compared
/// with the on-hand pockets only, because nobody can see what is missing.
/// HO and In transit are single rows and only the stores get a heading. The
/// sheet behind a row is the place's pockets, what is missing, its returns,
/// its stock card and its counts. Every figure is live; a number nobody can
/// compute honestly draws a dash rather than a guess.

/// An observed/on-hand gap past this share of the on-hand is worth amber.
const GAP_WARN_PCT = 1.5

/// A count older than this is stale.
const STALE_DAYS = 30

/// The row that is not a place, keyed into the same sheet parameter as the
/// places: values the root validator already accepts (any non-empty id),
/// interpreted by this screen and by nothing else on this route.
const ROAD_SHEET = "road"

const TH = "pb-2.5 text-[0.9375rem] font-medium text-body"
const TD = "py-3 text-[0.9375rem] text-text"

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

interface PlaceFigures {
  /// Inventory: every pocket, Missing included.
  readonly book: number
  readonly missing: number
  /// Inventory without Missing — what a scanner can see.
  readonly hand: number
  /// Null when a pool that holds something has never been seen.
  readonly seen: number | null
  readonly lastCountedAt: string | null
  /// Days since that count, or null when the place has never been counted.
  readonly days: number | null
  /// The pools the place is made of (rollups, the road and, at a store, its
  /// outbound pools left out).
  readonly pools: readonly FleetPool[]
  /// The pool a count starts against: the stockroom (a store's own
  /// warehouse) or head office's warehouse.
  readonly mainPool: FleetPool | undefined
}

interface PlaceView {
  /// The sheet parameter value this row opens: the site that holds pools.
  readonly key: string
  readonly kind: "ho" | "store"
  readonly unit: UnitView
  readonly siteIds: readonly string[]
  readonly name: string
  readonly sub: string
  readonly fig: PlaceFigures
}

// ---------------------------------------------------------------------------
// Folds
// ---------------------------------------------------------------------------

function figuresFor(
  kind: "ho" | "store",
  siteIds: readonly string[],
  fleet: readonly FleetPool[]
): PlaceFigures {
  // Only what the server itself counts: a shadowed Cloud row under an Edge
  // node is a second telling of the same shelf, and the fleet read marks it.
  const here = fleet.filter(
    (pool) =>
      siteIds.includes(pool.site_id) &&
      !pool.is_rollup &&
      pool.authority.included_in_fleet_total
  )
  const pools = here.filter((pool) => {
    const role = roleOf(pool)
    if (role === "IN_TRANSIT") return false
    // A store's own outbound pools are not its stock to show.
    if (kind === "store") {
      return role === "FLOOR" || role === "STOCKROOM" || role === "REJECT"
    }
    return true
  })

  const book = pools.reduce((sum, pool) => sum + pool.stock, 0)
  const missing = pools.reduce((sum, pool) => sum + (pool.missing ?? 0), 0)
  const hand = book - missing

  let seen: number | null = 0
  for (const pool of pools) {
    if (handOf(pool) === 0 && (pool.observed ?? 0) === 0) continue
    if (pool.observed === null || pool.observed === undefined) {
      seen = null
      break
    }
    seen += pool.observed
  }
  if (pools.length === 0) seen = null

  const countedAt = pools
    .map((pool) => pool.last_counted_at)
    .filter((at): at is string => typeof at === "string")
  const lastCountedAt =
    countedAt.length > 0
      ? countedAt.reduce((newest, at) => (at > newest ? at : newest))
      : null

  // The shelf a count is aimed at: the warehouse/stockroom; failing that the
  // first place goods can sit (a reject pool is where goods stop).
  const countable = here
    .filter((pool) => roleOf(pool) !== "REJECT" && roleOf(pool) !== "RETURN")
    .sort((left, right) => left.display_order - right.display_order)
  const mainPool =
    countable.find((pool) => roleOf(pool) === "STOCKROOM") ?? countable[0]

  return {
    book,
    missing,
    hand,
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

function isStale(fig: PlaceFigures): boolean {
  return fig.days === null || fig.days > STALE_DAYS
}

/// Observed minus on hand, or null when nothing was seen.
function gapOf(fig: PlaceFigures): number | null {
  return fig.seen === null ? null : fig.seen - fig.hand
}

function gapWarns(gap: number | null, hand: number): boolean {
  if (gap === null || gap === 0) return false
  if (hand <= 0) return true
  return (Math.abs(gap) / hand) * 100 > GAP_WARN_PCT
}

// ---------------------------------------------------------------------------
// The road
// ---------------------------------------------------------------------------

interface RoadBooks {
  /// Pieces in the air to any destination, or null while the book loads.
  readonly total: number | null
  readonly toStores: number | null
  readonly backToHo: number | null
  readonly trips: readonly AllotmentRow[]
  readonly rets: readonly AllotmentRow[]
}

function roadBooksOf(data: AllotmentList | undefined): RoadBooks {
  if (data === undefined) {
    return { total: null, toStores: null, backToHo: null, trips: [], rets: [] }
  }
  const moving = data.items.filter((row) => row.total_in_transit_quantity > 0)
  const sum = (rows: readonly AllotmentRow[]) =>
    rows.reduce((running, row) => running + row.total_in_transit_quantity, 0)
  const trips = moving.filter(
    (row) => row.type === "TO_STORE" || row.type === "TO_SITE"
  )
  // Stored as RETURN_TO_WAREHOUSE since 0611; RETURN_TO_DC is the old name.
  const rets = moving.filter(
    (row) =>
      row.type === "RETURN_TO_DC" ||
      (row.type as string) === "RETURN_TO_WAREHOUSE"
  )
  return {
    total: sum(moving),
    toStores: sum(trips),
    backToHo: sum(rets),
    trips,
    rets,
  }
}

interface Trip {
  readonly key: string
  readonly left: string
  readonly rows: readonly AllotmentRow[]
  readonly stores: number
  readonly pieces: number
}

/// The allotment book carries no trip id and no koli count, so a trip is the
/// SJs that last moved on the same day.
function tripsOf(rows: readonly AllotmentRow[]): Trip[] {
  const byDay = new Map<string, AllotmentRow[]>()
  for (const row of rows) {
    const key = row.updated_at.slice(0, 10)
    const list = byDay.get(key)
    if (list) list.push(row)
    else byDay.set(key, [row])
  }
  return [...byDay]
    .sort(([left], [right]) => (left < right ? 1 : -1))
    .map(([key, list]) => ({
      key,
      left: list[0].updated_at,
      rows: list,
      stores: new Set(list.flatMap((row) => row.destination_names ?? [])).size,
      pieces: list.reduce((sum, row) => sum + row.total_in_transit_quantity, 0),
    }))
}

// ---------------------------------------------------------------------------
// View building
// ---------------------------------------------------------------------------

function placeViewOf(
  unit: UnitView,
  kind: "ho" | "store",
  fleet: readonly FleetPool[]
): PlaceView {
  const siteIds = unit.sites.map((site) => site.id)
  const fig = figuresFor(kind, siteIds, fleet)
  // The sheet stands on the site that actually holds pools; a unit's other
  // sites (an office beside the warehouse) have no stock to tell a story about.
  const holding = fig.pools[0]?.site_id ?? siteIds[0] ?? unit.id
  return {
    key: holding,
    kind,
    unit,
    siteIds,
    name: unit.name,
    sub: kind === "ho" ? "HO" : `Store · ${unit.code}`,
    fig,
  }
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export function StockCards() {
  return (
    <PageContent>
      <PageHeader title="Stock" />
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
  // Plain reads the server does not draw: held back until the page is
  // hydrated, so the server's HTML and the browser's first render agree.
  const hydrated = useHydrated()
  const roadRead = useQuery(allotmentListQuery("", ""))
  const countsRead = useQuery(countsBoardQuery())
  const road = { data: hydrated ? roadRead.data : undefined }
  const counts = { data: hydrated ? countsRead.data : undefined }
  const { query: missingQuery, rows: missingRead } = useMissingRows()
  const missingRows = hydrated ? missingRead : []
  const [find, setFind] = useState("")

  const place = useSheet("location")
  const roadBooks = useMemo(() => roadBooksOf(road.data), [road.data])

  const items = fleet.data.items
  const ho = units.data.find((unit) => unit.kind === "HO")
  const stores = units.data.filter(
    (unit) => unit.kind === "STORE" && unit.status === "ACTIVE"
  )
  // A place's Missing is the Missing list's own pieces once they are read,
  // so Stock, the Missing page and its rows say the same number. The pool
  // figure stands in until then.
  const listed =
    hydrated && missingQuery.data !== undefined && !missingQuery.hasNextPage
  const withListed = (view: PlaceView): PlaceView => {
    if (!listed) return view
    const sites = new Set(view.siteIds)
    const missing = missingRead
      .filter(
        (row) => sites.has(row.site_id) && !isTransitPool(row.origin_pool)
      )
      .reduce((sum, row) => sum + Math.max(row.quantity, 0), 0)
    return { ...view, fig: { ...view.fig, missing } }
  }
  const hoView = ho ? withListed(placeViewOf(ho, "ho", items)) : null
  const storeViews = stores.map((unit) =>
    withListed(placeViewOf(unit, "store", items))
  )
  const ordered = [...storeViews].sort(
    (left, right) =>
      right.fig.missing - left.fig.missing ||
      left.name.localeCompare(right.name)
  )

  // What is on the road and was never received: the Missing of the
  // IN_TRANSIT pools, wherever they stand.
  const transitPools = items.filter(
    (pool) =>
      !pool.is_rollup &&
      pool.authority.included_in_fleet_total &&
      roleOf(pool) === "IN_TRANSIT"
  )
  const transitMissing = transitPools.reduce(
    (sum, pool) => sum + (pool.missing ?? 0),
    0
  )
  const roadInventory =
    roadBooks.total === null ? null : roadBooks.total + transitMissing

  const sheetLookup = new Map<string, PlaceView>()
  for (const view of [hoView, ...storeViews]) {
    if (view !== null) sheetLookup.set(view.key, view)
  }

  const activeSites = new Set(
    (counts.data?.active ?? []).map((row) => row.site_id)
  )
  const allCounts: readonly CountRow[] = counts.data
    ? [
        ...counts.data.drafts,
        ...counts.data.active,
        ...counts.data.needs_review,
        ...counts.data.history,
      ]
    : []

  if (hoView === null && storeViews.length === 0) {
    return (
      <p className="py-14 text-center text-meta text-body">
        No units are registered yet — Stock has nowhere to stand.
      </p>
    )
  }

  const places = [hoView, ...storeViews].filter(
    (view): view is PlaceView => view !== null
  )
  const inventoryAll =
    places.reduce((sum, view) => sum + view.fig.book, 0) + (roadInventory ?? 0)
  const missingAll =
    places.reduce((sum, view) => sum + view.fig.missing, 0) + transitMissing
  const storesBook = storeViews.reduce((sum, view) => sum + view.fig.book, 0)
  const storesMissing = storeViews.reduce(
    (sum, view) => sum + view.fig.missing,
    0
  )

  const needle = find.trim().toLowerCase()
  const shown = (name: string) =>
    needle === "" || name.toLowerCase().includes(needle)


  const row = (view: PlaceView) => {
    const gap = gapOf(view.fig)
    return (
      <tr
        key={view.key}
        onClick={() => place.open(view.key)}
        className="cursor-pointer border-t border-hairline hover:bg-soft-2"
      >
        <td className={cn(TD, "pr-2 text-ink")}>{view.name}</td>
        <td className={cn(TD, "pl-3 text-right tabular-nums")}>
          {count(view.fig.book)}
        </td>
        <td
          className={cn(
            TD,
            "pl-3 text-right tabular-nums max-sm:hidden",
            gapWarns(gap, view.fig.hand) && "text-warn-fg"
          )}
        >
          {view.fig.seen === null ? "—" : count(view.fig.seen)}
        </td>
        <td
          className={cn(
            TD,
            "pl-3 text-right tabular-nums",
            view.fig.missing > 0 ? "text-bad-fg" : "text-mute"
          )}
        >
          {count(view.fig.missing)}
        </td>
        <td
          className={cn(
            TD,
            "pl-3 text-right tabular-nums max-sm:hidden",
            isStale(view.fig) ? "text-warn-fg" : "text-mute"
          )}
        >
          {view.fig.lastCountedAt === null
            ? "Never"
            : day(view.fig.lastCountedAt)}
        </td>
      </tr>
    )
  }

  const roadLine =
    roadBooks.total === null
      ? "…"
      : `${new Set(tripsOf(roadBooks.trips).map((trip) => trip.key)).size} trips · ${roadBooks.trips.length} SJ · ${roadBooks.rets.length} return`

  const storesShown = ordered.filter((view) => shown(view.name))

  return (
    <>
      <KpiStrip>
        <Kpi label="Inventory" value={count(inventoryAll)} />
        <Kpi
          label="Missing"
          value={
            <span className={cn(missingAll > 0 && "text-bad-fg")}>
              {count(missingAll)}
            </span>
          }
        />
        <Kpi label="In transit" value={count(roadInventory)} />
        <Kpi label="Places" value={count(places.length)} />
      </KpiStrip>

      <div className="mb-4 max-w-sm">
        <Input
          type="search"
          aria-label="Search place"
          placeholder="Search place"
          value={find}
          onChange={(event) => setFind(event.target.value)}
        />
      </div>

      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th className={cn(TH, "pr-2 text-left")}>Place</th>
            <th className={cn(TH, "pl-3 text-right")}>Inventory</th>
            <th className={cn(TH, "pl-3 text-right max-sm:hidden")}>
              Seen
            </th>
            <th className={cn(TH, "pl-3 text-right")}>Missing</th>
            <th className={cn(TH, "pl-3 text-right max-sm:hidden")}>
              Last count
            </th>
          </tr>
        </thead>
        <tbody>
          {hoView !== null && shown(hoView.name) && row(hoView)}
          {shown("In transit") && (
            <tr
              onClick={() => place.open(ROAD_SHEET)}
              className="cursor-pointer border-t border-hairline hover:bg-soft-2"
            >
              <td className={cn(TD, "pr-2 text-ink")}>
                In transit <span className="text-mute">· {roadLine}</span>
              </td>
              <td className={cn(TD, "pl-3 text-right tabular-nums")}>
                {count(roadInventory)}
              </td>
              <td className={cn(TD, "pl-3 text-right text-mute max-sm:hidden")}>
                —
              </td>
              <td
                className={cn(
                  TD,
                  "pl-3 text-right tabular-nums",
                  transitMissing > 0 ? "text-bad-fg" : "text-mute"
                )}
              >
                {count(transitMissing)}
              </td>
              <td className={cn(TD, "pl-3 text-right text-mute max-sm:hidden")}>
                —
              </td>
              <td className={TD} />
            </tr>
          )}
          <tr className="border-t border-hairline">
            <td
              colSpan={6}
              className="pt-6 pb-1 text-[0.9375rem] font-medium text-body"
            >
              Stores · {storeViews.length}
            </td>
          </tr>
          {storesShown.map(row)}
          <tr className="border-t border-hairline">
            <td className={cn(TD, "pr-2 font-semibold text-ink")}>
              Stores total
            </td>
            <td
              className={cn(
                TD,
                "pl-3 text-right font-semibold text-ink tabular-nums"
              )}
            >
              {count(storesBook)}
            </td>
            <td className={cn(TD, "max-sm:hidden")} />
            <td
              className={cn(
                TD,
                "pl-3 text-right font-semibold tabular-nums",
                storesMissing > 0 ? "text-bad-fg" : "text-mute"
              )}
            >
              {count(storesMissing)}
            </td>
            <td className={cn(TD, "max-sm:hidden")} />
            <td className={TD} />
          </tr>
        </tbody>
      </table>

      {place.value === ROAD_SHEET && (
        <RoadSheet
          books={roadBooks}
          missing={transitMissing}
          pools={transitPools}
          missingRows={missingRows}
          onClose={() => place.close()}
        />
      )}
      {place.value !== ROAD_SHEET &&
        place.value !== undefined &&
        (() => {
          const view = sheetLookup.get(place.value)
          return view === undefined ? null : (
            <PlaceSheet
              view={view}
              stores={stores}
              fleet={items}
              missingRows={missingRows}
              counts={allCounts.filter((one) =>
                view.siteIds.includes(one.site_id)
              )}
              countingActive={activeSites.has(view.key)}
              onClose={() => place.close()}
            />
          )
        })()}
    </>
  )
}

// ---------------------------------------------------------------------------
// Sheets
// ---------------------------------------------------------------------------

type MissingRows = ReturnType<typeof useMissingRows>["rows"]

const EMPTY_NOTE = "text-[0.9375rem] text-mute"

/// The missing articles standing in a set of pools.
function MissingTable({
  rows,
  poolIds,
}: {
  rows: MissingRows
  poolIds: ReadonlySet<string>
}) {
  const groups = groupMissing(
    rows.filter((one) => poolIds.has(one.origin_pool))
  )
  // The record opens over this sheet, as the prototype has it: the person
  // stays on the place and comes back to it when the record closes.
  const [openKey, setOpenKey] = useState<string | null>(null)
  if (groups.length === 0)
    return <p className={EMPTY_NOTE}>Nothing missing here</p>
  return (
    <>
      <MiniTable
        head={[
          "Article",
          "Quantity",
          { label: "Missing date", align: "left" },
        ]}
      >
        {groups.map((group) => {
          const since = group.rows[0]?.missing_since ?? null
          return (
            <MiniRow key={group.key}>
              <MiniCell>
                <button
                  type="button"
                  onClick={() => setOpenKey(group.key)}
                  className="block text-left text-ink hover:underline"
                >
                  {group.name ?? skuNumber(group.sku)}
                </button>
                <span className="block text-mute">{skuNumber(group.sku)}</span>
              </MiniCell>
              <MiniCell align="right" className="font-semibold text-ink">
                {count(group.left)}
              </MiniCell>
              <MiniCell className="text-mute">
                {since === null ? "—" : dayMonth(since)}
              </MiniCell>
            </MiniRow>
          )
        })}
      </MiniTable>
      <MissingSheet
        group={groups.find((group) => group.key === openKey) ?? null}
        canResolve
        onClose={() => setOpenKey(null)}
      />
    </>
  )
}

const KIND_WORD: Record<string, string> = {
  FULL: "Full",
  CYCLE: "Cycle",
  TARGETED: "Targeted",
}

function CountsTable({ rows }: { rows: readonly CountRow[] }) {
  if (rows.length === 0) return <p className={EMPTY_NOTE}>Never counted</p>
  const sorted = [...rows].sort((left, right) =>
    (right.closed_at ?? right.created_at).localeCompare(
      left.closed_at ?? left.created_at
    )
  )
  return (
    <MiniTable
      head={[
        "Date",
        { label: "Count", align: "left" },
        { label: "Status", align: "left" },
        "Book",
        "Counted",
      ]}
    >
      {sorted.map((one) => {
        const closed = one.status === "CLOSED"
        const settled = closed || one.status === "REVIEW"
        return (
          <MiniRow key={one.id}>
            <MiniCell className="text-mute">
              {day(one.closed_at ?? one.created_at)}
            </MiniCell>
            <MiniCell>
              {KIND_WORD[one.kind] ?? one.kind}{" "}
              <span className="text-mute">· {one.id.slice(0, 8)}</span>
            </MiniCell>
            <MiniCell>
              {closed ? (
                <span className="text-mute">Done</span>
              ) : (
                <Pill tone="accent">To do</Pill>
              )}
            </MiniCell>
            <MiniCell align="right">{count(one.expected)}</MiniCell>
            <MiniCell align="right">
              {settled ? <CountedCell expected={one.expected} found={one.found} /> : "—"}
            </MiniCell>
          </MiniRow>
        )
      })}
    </MiniTable>
  )
}

function PlaceSheet({
  view,
  stores,
  fleet,
  missingRows,
  counts,
  countingActive,
  onClose,
}: {
  view: PlaceView
  stores: readonly UnitView[]
  fleet: readonly FleetPool[]
  missingRows: MissingRows
  counts: readonly CountRow[]
  countingActive: boolean
  onClose: () => void
}) {
  const fig = view.fig
  const [tab, setTab] = useState("pockets")
  const gap = gapOf(fig)
  const pockets = pocketsOf(view.kind, fig.pools)
  const poolIds = new Set(fig.pools.map((pool) => pool.id))
  const missingGroups = groupMissing(
    missingRows.filter((one) => poolIds.has(one.origin_pool))
  )

  const origins = pockets
    .filter((pocket) => pocket.missing > 0)
    .map((pocket) => `${pocket.label} ${count(pocket.missing)}`)
    .join(" · ")

  const figures = [
    { label: "Inventory", value: count(fig.book) },
    { label: "Seen", value: fig.seen === null ? "—" : count(fig.seen) },
    {
      label: "Gap",
      value: (
        <span className={cn(gapWarns(gap, fig.hand) && "text-warn-fg")}>
          {gap === null ? "—" : signed(gap)}
        </span>
      ),
    },
    {
      label: "Missing",
      value: (
        <span className={cn(fig.missing > 0 && "text-bad-fg")}>
          {count(fig.missing)}
        </span>
      ),
    },
    {
      label: "Last count",
      value: (
        <span className={cn(isStale(fig) && "text-warn-fg")}>
          {fig.lastCountedAt === null ? "Never" : day(fig.lastCountedAt)}
        </span>
      ),
    },
  ]

  const pocketRow = (pocket: Pocket) => {
    const pocketGap = pocket.seen === null ? null : pocket.seen - pocket.hand
    return (
      <MiniRow key={pocket.key}>
        <MiniCell className={cn(pocket.hand === 0 && "text-mute")}>
          {pocket.label}
        </MiniCell>
        <MiniCell
          align="right"
          className={cn(pocket.hand === 0 && "text-mute")}
        >
          {count(pocket.hand)}
        </MiniCell>
        <MiniCell align="right">
          {pocket.seen === null ? "—" : count(pocket.seen)}
        </MiniCell>
        <MiniCell align="right">
          {pocketGap === null ? "—" : signed(pocketGap)}
        </MiniCell>
      </MiniRow>
    )
  }

  // Returns: Return HO is the REJECT pool; each store has its own RETURN pool.
  const returnHo = fig.pools
    .filter((pool) => roleOf(pool) === "REJECT")
    .reduce((sum, pool) => sum + handOf(pool), 0)
  const storeReturns = stores.map((unit) => {
    const sites = unit.sites.map((site) => site.id)
    const held = fig.pools
      .filter(
        (pool) =>
          roleOf(pool) === "RETURN" &&
          pool.store_origin_site_id !== null &&
          sites.includes(pool.store_origin_site_id)
      )
      .reduce((sum, pool) => sum + handOf(pool), 0)
    return { name: unit.name, held }
  })
  const returnTotal =
    returnHo + storeReturns.reduce((sum, one) => sum + one.held, 0)

  const tabs = [
    { value: "pockets", label: "Pockets" },
    { value: "missing", label: "Missing", alert: missingGroups.length },
    ...(view.kind === "ho" ? [{ value: "return", label: "Return" }] : []),
    { value: "card", label: "Stock card" },
    { value: "counts", label: "Counts" },
  ]
  const current = tabs.some((one) => one.value === tab) ? tab : "pockets"

  let content: React.ReactNode
  if (current === "pockets") {
    content = (
      <MiniTable head={["Pocket", "Inventory", "Seen", "Gap"]}>
        {pockets.map(pocketRow)}
        <tr
          onClick={() => setTab("missing")}
          className="cursor-pointer border-t border-hairline hover:bg-soft-2"
        >
          <MiniCell>
            {/* Red with an arrow, as a way into the Missing tab (owner, 20
                Oct 2026). */}
            <span
              className={cn(
                "block",
                fig.missing > 0 ? "text-bad-fg" : "text-ink"
              )}
            >
              Missing
            </span>
            {fig.missing > 0 && (
              <span className="block text-mute">from {origins}</span>
            )}
          </MiniCell>
          <MiniCell
            align="right"
            className={cn(fig.missing > 0 ? "text-bad-fg" : "text-mute")}
          >
            {count(fig.missing)}
          </MiniCell>
          <MiniCell align="right" className="text-mute">
            —
          </MiniCell>
          <MiniCell align="right" className="text-mute">
            <span className="inline-flex items-center gap-1">
              —
              <ChevronRight aria-hidden className="size-4" />
            </span>
          </MiniCell>
        </tr>
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
    )
  } else if (current === "missing") {
    content = <MissingTable rows={missingRows} poolIds={poolIds} />
  } else if (current === "return") {
    content = (
      <MiniTable head={["Return", "Quantity"]}>
        <MiniRow>
          <MiniCell className={cn(returnHo === 0 && "text-mute")}>
            Return HO
          </MiniCell>
          <MiniCell align="right" className={cn(returnHo === 0 && "text-mute")}>
            {count(returnHo)}
          </MiniCell>
        </MiniRow>
        {storeReturns.map((one) => (
          <MiniRow key={one.name}>
            <MiniCell className={cn(one.held === 0 && "text-mute")}>
              Return {one.name}
            </MiniCell>
            <MiniCell
              align="right"
              className={cn(one.held === 0 && "text-mute")}
            >
              {count(one.held)}
            </MiniCell>
          </MiniRow>
        ))}
        <MiniRow>
          <MiniCell className="font-semibold text-ink">Total</MiniCell>
          <MiniCell align="right" className="font-semibold text-ink">
            {count(returnTotal)}
          </MiniCell>
        </MiniRow>
      </MiniTable>
    )
  } else if (current === "card") {
    content = <PlaceStockCard site={view.key} />
  } else {
    content = <CountsTable rows={counts} />
  }

  return (
    <Sheet
      open
      onOpenChange={(open) => !open && onClose()}
      // The place by its name, never the site's raw id ("store-02").
      title={view.name}
      caption={view.sub}
      size="table"
      footer={
        <SheetFooter
          start={
            countingActive ? <Pill tone="info">Count active</Pill> : undefined
          }
        />
      }
    >
      <div className="flex flex-col gap-6">
        <KpiStrip className="mb-2!">
          {figures.map((one) => (
            <Kpi key={one.label} label={one.label} value={one.value} />
          ))}
        </KpiStrip>
        <SubTabs tabs={tabs} value={current} onChange={setTab} />
        <div>{content}</div>
      </div>
    </Sheet>
  )
}

/// The in-transit sheet: trips out to the stores with their SJ, and what
/// never arrived.
function RoadSheet({
  books,
  missing,
  pools,
  missingRows,
  onClose,
}: {
  books: RoadBooks
  missing: number
  pools: readonly FleetPool[]
  missingRows: MissingRows
  onClose: () => void
}) {
  const [tab, setTab] = useState("trips")
  const poolIds = new Set(pools.map((pool) => pool.id))
  const missingCount = groupMissing(
    missingRows.filter((one) => poolIds.has(one.origin_pool))
  ).length
  const trips = tripsOf(books.trips)

  const tabs = [
    { value: "trips", label: "Trips" },
    { value: "missing", label: "Missing", alert: missingCount },
  ]

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()} title="In transit">
      <div className="flex flex-col gap-6">
        <KpiStrip className="mb-2!">
          <Kpi label="To stores" value={count(books.toStores)} />
          <Kpi label="Back to HO" value={count(books.backToHo)} />
          <Kpi
            label="Missing"
            value={
              <span className={cn(missing > 0 && "text-bad-fg")}>
                {count(missing)}
              </span>
            }
          />
        </KpiStrip>
        <SubTabs tabs={tabs} value={tab} onChange={setTab} />
        {tab === "missing" ? (
          <MissingTable rows={missingRows} poolIds={poolIds} />
        ) : (
          <div className="flex flex-col gap-6">
            {trips.length === 0 ? (
              <p className={EMPTY_NOTE}>Nothing is on its way to a store.</p>
            ) : (
              <MiniTable
                head={["Trip", { label: "To", align: "left" }, "Pieces"]}
              >
                {trips.flatMap((trip) => [
                  <MiniRow key={trip.key}>
                    <MiniCell className="font-semibold text-ink">
                      Trip{" "}
                      <span className="font-normal text-mute">
                        · left {dayMonth(trip.left)}
                      </span>
                    </MiniCell>
                    <MiniCell className="text-mute">
                      {trip.stores} {trip.stores === 1 ? "store" : "stores"}
                    </MiniCell>
                    <MiniCell align="right" className="font-semibold text-ink">
                      {count(trip.pieces)}
                    </MiniCell>
                  </MiniRow>,
                  ...trip.rows.map((row) => (
                    <MiniRow key={row.id}>
                      <MiniCell className="pl-6!">
                        {row.allotment_number}
                      </MiniCell>
                      <MiniCell>
                        {row.destination_names?.join(", ") ?? "—"}
                      </MiniCell>
                      <MiniCell align="right">
                        {count(row.total_in_transit_quantity)}
                      </MiniCell>
                    </MiniRow>
                  )),
                ])}
              </MiniTable>
            )}
            {books.rets.length > 0 && (
              <div className="flex flex-col gap-2">
                <h3 className="text-[0.9375rem] font-medium text-body">
                  Back to HO
                </h3>
                <MiniTable head={["Return", "Pieces"]}>
                  {books.rets.map((row) => (
                    <MiniRow key={row.id}>
                      <MiniCell>{row.allotment_number}</MiniCell>
                      <MiniCell align="right">
                        {count(row.total_in_transit_quantity)}
                      </MiniCell>
                    </MiniRow>
                  ))}
                </MiniTable>
              </div>
            )}
          </div>
        )}
      </div>
    </Sheet>
  )
}
