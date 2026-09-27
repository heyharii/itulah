import { useForm } from "@tanstack/react-form"
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import type {
  ColumnDef,
  ExpandedState,
  SortingState,
} from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { ChevronRight, Search } from "lucide-react"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { AppLink } from "@/components/ui/app-link"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Field, Input } from "@/components/ui/field"
import { FilterPanel } from "@/components/ui/filter-panel"
import {
  ColumnsMenu,
  DockedFilters,
  SortMenu,
  ViewPicker,
} from "@/components/ui/list-chrome"
import { Dial } from "@/components/ui/meter"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { MiniTable } from "@/components/ui/rows"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { Banner, EmptyState, LoadMore } from "@/components/ui/states"
import { Tag } from "@/components/ui/tag"
import { useFilters } from "@/lib/filters"
import { ago, count, label as humanise, moment } from "@/lib/format"
import { usePanelDock } from "@/lib/layout"
import {
  allotmentsByPool,
  correctPlacement,
  fleetPools,
  idempotencyKey,
  inventoryKeys,
  listCounts,
  poolDetail,
  sightingsPage,
  type FleetPool,
  type PoolItem,
} from "@/lib/queries/inventory"
import { queryState } from "@/lib/query-state"
import { useSheet } from "@/lib/sheets"
import { tableSetup, type TableSetup } from "@/lib/table"
import { cn } from "@/lib/utils"
import { Choice } from "@/screens/inventory/parts"
import {
  age,
  percent,
  useActor,
  writablePools,
} from "@/screens/inventory/shared"

/// Every pool the centre can see, its own and every Edge node's.
///
/// The column that is not obvious is **Source**. Cloud keeps a native ledger
/// *and* projects each Edge node's fact positions, and where a site is owned by
/// a live Edge node the Cloud row for it is shadowed: still shown, deliberately
/// excluded from the fleet total, and not writable. Reading the two together
/// without that distinction is exactly how a fleet counts a store twice.
///
/// The sheet is where a placement correction is made, and it is the only write
/// on this screen. That is not an accident of layout: a correction has to name
/// the subject it moves and the evidence behind it, and both of those are on
/// the pool's own page.

/// One line of the tree: a site, or a pool standing in it.
///
/// A row type of its own rather than `FleetPool`, because a site is not a pool
/// and pretending otherwise would mean inventing an id, a group and a sync
/// status for something that has none.
export interface PoolRow {
  readonly key: string
  readonly label: string
  /// The pool this row is, or null on a site row.
  readonly pool: FleetPool | null
  readonly stock: number
  readonly on_hand: number
  readonly allotted: number | null
  /// Distinct tags sighted in the observation window — null where there was
  /// never anything to sight: Cloud holds each Edge node's fact positions but
  /// not the readings behind them, so an Edge row has no observation rather
  /// than an observation of nought.
  readonly observed: number | null
  readonly missing: number
  /// The latest count of this pool whatever its status, so one opened this
  /// morning reads as counted today rather than as never counted.
  readonly last_count: string | null
  /// Whether the fleet total includes this row. True for almost every row now
  /// that the sources for one shelf are folded together — what remains false
  /// is the outbound rollups, which are sums of the rows beneath them and
  /// would double the fleet if added again.
  readonly counted: boolean
  /// The pool id **in the centre's spelling**, which is the only one the Cloud
  /// tables are keyed by.
  ///
  /// Not `pool.id`: where an Edge node owns the shelf, the row that wins the
  /// fold is that node's, and its id is the node's own spelling —
  /// `dc-01.warehouse` for what every Cloud table calls `dc.warehouse`. Asking
  /// the centre about a pool by the node's name gets "not found: active
  /// placement source pool", which is what the allotments panel answered until
  /// this field existed. Counts, sightings, allotments and the pool's own
  /// detail are all Cloud records; all four ask with this.
  readonly poolId: string
  /// What kind of shelf this is — `WAREHOUSE`, `OUTBOUND`, `REJECT`,
  /// `PENDING`, `STORE_INVENTORY`. Null on a site row, which is a heading and
  /// not a shelf.
  ///
  /// It is the one thing about a pool that is a closed SET rather than a name
  /// or a number, which is what makes it the only column here the filter panel
  /// can offer in one tap. Everything else this table holds is a band — over
  /// two hundred pieces, never counted — and a band is typed rather than
  /// picked.
  readonly group: string | null
  /// Set when a second source for the same shelf reports a different quantity.
  /// The fold picks the authoritative one; this is what it did not pick, so a
  /// disagreement between the centre and a node is visible rather than
  /// resolved out of sight.
  readonly disputed: { readonly source: string; readonly stock: number } | null
  /// Every row the fleet read returned for this shelf — one per source. The
  /// sheet lists them, which is where "why do these two disagree" is answered.
  readonly sources?: readonly FleetPool[]
  readonly subRows?: readonly PoolRow[]
}

/// A quantity that may be absent, and an absence that is not a nought.
function figure(value: number | null) {
  return value === null ? <span className="text-mute">—</span> : count(value)
}

/// A number that is also a way in to what it is made of.
///
/// A real `<button>` rather than a click handler on the cell: this is the
/// keyboard's only route to these two sheets, and a cell that merely responds
/// to a pointer is a control only some people have. `stopPropagation` because
/// the row itself opens the pool — without it, clicking Allotted would open
/// the pool sheet and the allotments sheet at once.
///
/// The underline is dotted rather than solid: this does not leave the screen,
/// and a link's underline promises that it does.
function Figure({
  onClick,
  label,
  children,
}: {
  onClick: () => void
  label: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={(event) => {
        event.stopPropagation()
        onClick()
      }}
      className="tabular-nums underline decoration-line-ico decoration-dotted underline-offset-4 transition-colors hover:text-ink hover:decoration-ink focus-visible:outline-2 focus-visible:outline-accent"
    >
      {children}
    </button>
  )
}

/// Stock, then what it is made of, then what is wrong with it.
///
/// The order is the inventory equation the server states in the same response
/// — `Stock = On hand + Allotted + Missing` — with the two readings that are
/// *about* the number rather than in it on the outside: **Observed** is what a
/// scanner actually saw of it, and **Last count** is when a person last stood
/// in front of it. A row whose ring is empty and whose last count says Never
/// is a number nobody has checked, and those two columns are the only place
/// this table says so.
/// Built per screen rather than once at module scope, because two of these
/// cells open a sheet and a sheet opener is a hook's return value.
///
/// The openers are passed in rather than the cells reaching for `useSheet`
/// themselves: a cell renderer is called by the table, not by React's
/// component tree, so a hook inside one is a hook called outside a component.
function poolColumns(open: {
  allotments: (poolId: string) => void
  sightings: (poolId: string) => void
}): ColumnDef<TableSetup, PoolRow>[] {
  return [
    {
      id: "pool",
      accessorFn: (row) => row.label,
      header: "Pool",
      size: 320,
      meta: { filter: { kind: "text" } },
      cell: ({ row }) => {
        const site = row.original.pool === null
        return (
          <div
            className="flex min-w-0 items-center gap-1.5"
            style={{ paddingLeft: `${row.depth * 1.125}rem` }}
          >
            {row.getCanExpand() ? (
              // A real button, even though the whole row toggles too: the row is
              // a click target and this is the keyboard's way in.
              <button
                type="button"
                aria-expanded={row.getIsExpanded()}
                aria-label={`${row.getIsExpanded() ? "Collapse" : "Expand"} ${row.original.label}`}
                onClick={(event) => {
                  event.stopPropagation()
                  row.toggleExpanded()
                }}
                className="grid size-4 shrink-0 place-items-center rounded-inner text-line-ico transition-colors hover:text-text focus-visible:outline-2 focus-visible:outline-accent"
              >
                <ChevronRight
                  className={cn(
                    "size-3.5 transition-transform",
                    row.getIsExpanded() && "rotate-90"
                  )}
                />
              </button>
            ) : (
              <span className="w-4 shrink-0" />
            )}
            <span
              className={
                site
                  ? "truncate font-medium text-ink"
                  : row.original.counted
                    ? "truncate text-text"
                    : "truncate text-mute"
              }
            >
              {row.original.label}
            </span>
            {/* Two markers, and they say different things. `sum` is a stage
              total: the rows beneath it are what it is made of, so it is
              deliberately left out of the fleet total and the reader is told
              why its children add up to it rather than on top of it. A dispute
              is two sources that do not agree about the same shelf, which no
              fold may resolve silently. Neither is "nobody has counted this",
              which the Last count column says on its own.

              The flag is the server's `is_rollup`, not `!counted`. They are not
              the same set: a shelf whose owner has gone quiet is uncounted too,
              and calling that a sum said something false about a number that
              was merely stale. */}
            {row.original.pool?.is_rollup === true && (
              <span className="shrink-0 text-[0.875rem] text-mute">sum</span>
            )}
            {row.original.disputed !== null && (
              <span
                className="shrink-0 text-[0.875rem] font-medium text-warn-fg"
                title={`${row.original.disputed.source} reports ${row.original.disputed.stock}`}
              >
                disputed
              </span>
            )}
          </div>
        )
      },
    },
    {
      accessorKey: "group",
      header: "Kind",
      size: 130,
      /// The only column here the filter panel can offer as a list, because it
      /// is the only one whose values are a closed set. Blank on a site row:
      /// the heading is not a shelf, and a made-up kind on it would be a value
      /// somebody could filter by and get nothing.
      meta: { priority: 2, filter: { kind: "option", format: humanise } },
      cell: ({ row }) =>
        row.original.group === null ? null : (
          <span className="text-mute">{humanise(row.original.group)}</span>
        ),
    },
    {
      accessorKey: "stock",
      header: "Stock",
      size: 100,
      meta: { align: "right", filter: { kind: "number", unit: "pcs" } },
      cell: ({ row }) => count(row.original.stock),
    },
    {
      accessorKey: "on_hand",
      header: "On hand",
      size: 100,
      /// Not filterable, and none of the three derived readings beside it are.
      ///
      /// The panel is a list of questions somebody has, not of columns that
      /// happen to hold numbers: "which shelves hold more than 200" is asked of
      /// Stock and "which are short" of Missing, and a band typed over On hand,
      /// Allotted or Observed answers neither of them any better. Eight rows of
      /// identical band buttons is what the panel looked like with all of them
      /// declared, and six of the eight were furniture.
      meta: { align: "right" },
      cell: ({ row }) => count(row.original.on_hand),
    },
    {
      accessorKey: "allotted",
      header: "Allotted",
      size: 100,
      meta: { align: "right", priority: 2 },
      /// A promise is made of instructions, and this is the only number on the
      /// row that names records rather than pieces. Clicking it asks which ones.
      cell: ({ row }) => {
        const { allotted, pool, poolId } = row.original
        if (allotted === null || pool === null) return figure(allotted)
        return (
          <Figure
            onClick={() => open.allotments(poolId)}
            label={`Allotments out of ${row.original.label}`}
          >
            {count(allotted)}
          </Figure>
        )
      },
    },
    {
      accessorKey: "observed",
      header: "Observed",
      size: 120,
      meta: { align: "right", priority: 3 },
      /// Distinct tags a reader saw in the window. Evidence rather than a
      /// balance, so what is behind it is a list of readings — which is a
      /// different record from the movements behind Stock, and opens its own
      /// sheet for exactly that reason.
      cell: ({ row }) => {
        const { observed, stock, pool, poolId } = row.original
        if (observed === null) return <span className="text-mute">—</span>
        const reading = (
          <span className="inline-flex items-center gap-1.5">
            <Dial value={stock > 0 ? observed / stock : 0} />
            {count(observed)}
          </span>
        )
        if (pool === null) return reading
        return (
          <Figure
            onClick={() => open.sightings(poolId)}
            label={`Sightings in ${row.original.label}`}
          >
            {reading}
          </Figure>
        )
      },
    },
    {
      accessorKey: "missing",
      header: "Missing",
      size: 100,
      meta: { align: "right", filter: { kind: "number", unit: "pcs" } },
      cell: ({ row }) => (
        <span
          className={
            row.original.missing > 0 ? "font-medium text-bad-fg" : "text-mute"
          }
        >
          {count(row.original.missing)}
        </span>
      ),
    },
    {
      accessorKey: "last_count",
      header: "Last count",
      size: 120,
      meta: { priority: 3, filter: { kind: "date" } },
      cell: ({ row }) =>
        row.original.last_count === null ? (
          <span className="text-mute">Never</span>
        ) : (
          ago(row.original.last_count)
        ),
    },
  ]
}

/// The pool table on its own, without page chrome.
///
/// Split out so `/inventory` can show every pool under its KPIs without a
/// second page header — a page cannot carry two of those, and the one-page
/// view is the whole point of the module now having a single row.
///
/// `Pools` below is the same body under its own header, kept routed and
/// findable in ⌘K for anyone who arrives at a pool from a link.
export function PoolsBody() {
  const [query, setQuery] = useState("")
  /// Whether the filter panel has room to stand beside the list. Below it the
  /// same model is a sheet behind a Filter button, and the panel unmounts.
  const docked = usePanelDock()
  const pool = useSheet("pool")
  const poolAllotments = useSheet("pool-allotments")
  const poolSightings = useSheet("pool-sightings")
  const [sorting, setSorting] = useState<SortingState>([
    { id: "missing", desc: true },
  ])
  /// Semua tertutup. Empat belas baris situs muat tanpa gulir; seratus dua
  /// belas pool terbuka adalah daftar yang tak seorang pun minta.
  const [expanded, setExpanded] = useState<ExpandedState>({})

  const fleet = useQuery({
    queryKey: inventoryKeys.fleet(),
    queryFn: ({ signal }) => fleetPools(signal),
  })

  /// The count board, for one column of this table.
  ///
  /// The fleet read carries balances and no history, so when a pool was last
  /// counted is only knowable from here. Its failure costs the column and
  /// nothing else: a board that will not load leaves every row reading
  /// "Never", which is what an uncounted pool reads as anyway — losing the
  /// whole table over it would be the worse trade.
  const counts = useQuery({
    queryKey: inventoryKeys.counts(),
    queryFn: ({ signal }) => listCounts(signal),
  })

  /// The newest count per pool, from a board the server hands over already
  /// partitioned. Whichever moment the count actually reached — closed,
  /// submitted, activated, or merely created — is the one that counts as
  /// "last": a count still open is not a pool nobody has been to.
  const lastCounts = useMemo(() => {
    const newest = new Map<string, string>()
    const board = counts.data
    if (!board) return newest
    for (const record of [
      ...board.drafts,
      ...board.active,
      ...board.needs_review,
      ...board.history,
    ]) {
      const when =
        record.closed_at ??
        record.submitted_at ??
        record.activated_at ??
        record.created_at
      const held = newest.get(record.pool_id)
      if (held === undefined || Date.parse(when) > Date.parse(held)) {
        newest.set(record.pool_id, when)
      }
    }
    return newest
  }, [counts.data])

  /// The pools of one site, folded into the row that stands for the site.
  ///
  /// # One shelf, one row
  ///
  /// The fleet read returns a row per *source*, not per shelf: Cloud keeps a
  /// native ledger and also projects each Edge node's fact positions, so a
  /// warehouse an Edge node owns arrives twice — once from each. The server
  /// marks exactly one of the pair `included_in_fleet_total`, and this screen
  /// used to render both, dimming the other and labelling it "not counted".
  ///
  /// That label was read as "nobody has counted this stock", which is what the
  /// **Last count** column says two columns further along. What it actually
  /// meant was "not added into the total" — and having a duplicate row for
  /// every shelf in the fleet to carry that distinction is a poor trade for it.
  /// The pair is folded here instead: the row the server counts supplies the
  /// numbers, its shadowed twin supplies only the readings the winner cannot
  /// have, and where the two genuinely disagree the row says so rather than
  /// picking one quietly.
  ///
  /// # Two names for one distribution centre
  ///
  /// The centre's pool model spells the DC literally — `dc.warehouse` — while
  /// the Edge parameterises the same grammar by the site it runs as, so the
  /// same shelf is `dc-01.warehouse` there. Grouping on `site_id` alone puts
  /// them under two different headings and folds neither. The respelling is
  /// recovered from the data rather than hardcoded: a Cloud row that names an
  /// origin in `shadowed_by_origin_id` is telling us which site that origin is
  /// standing in, which is the whole of the mapping.
  const tree = useMemo<PoolRow[]>(() => {
    const items = fleet.data?.items ?? []

    /// `dc-01-edge` → `ho`: the site the centre files this origin's rows
    /// under. Empty for every store, where the two spellings already agree.
    const siteOfOrigin = new Map<string, string>()
    for (const item of items) {
      const shadowing = item.authority.shadowed_by_origin_id
      if (shadowing !== null) siteOfOrigin.set(shadowing, item.site_id)
    }
    const siteOf = (item: FleetPool) =>
      siteOfOrigin.get(item.origin_id) ?? item.site_id
    /// The pool id in the centre's spelling. The first segment IS the site — a
    /// site id admits only lowercase letters, digits and `-`, never the dot.
    const poolOf = (item: FleetPool) => {
      const site = siteOf(item)
      const rest = item.id.slice(item.id.indexOf(".") + 1)
      return item.id.includes(".") ? `${site}.${rest}` : item.id
    }

    const bySite = new Map<string, FleetPool[]>()
    for (const item of items) {
      const site = siteOf(item)
      const list = bySite.get(site)
      if (list) list.push(item)
      else bySite.set(site, [item])
    }

    return [...bySite.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([siteId, pools]) => {
        /// The sources for one shelf, newest authority first.
        const byPool = new Map<string, FleetPool[]>()
        for (const item of pools) {
          const key = poolOf(item)
          const list = byPool.get(key)
          if (list) list.push(item)
          else byPool.set(key, [item])
        }

        const children: PoolRow[] = [...byPool.entries()]
          .map(([poolId, sources]) => {
            /// The server has already decided which source speaks for this
            /// shelf. Where it counts neither — an outbound rollup, a shelf
            /// whose owner has gone quiet — the Cloud row is the fallback,
            /// because it is the one that still holds a number.
            const lead =
              sources.find((item) => item.authority.included_in_fleet_total) ??
              sources.find((item) => item.source_type === "CLOUD_LEDGER") ??
              sources[0]
            /// A reading the winner cannot have rather than does not have.
            /// Cloud holds each Edge node's fact positions but not the
            /// sightings behind them, so an Edge row's `observed` is null by
            /// construction — taking the Cloud twin's is recovering the
            /// column, not overriding an answer.
            const borrow = (pick: (item: FleetPool) => number | null) =>
              pick(lead) ?? sources.map(pick).find((v) => v !== null) ?? null
            /// Two sources for one shelf that do not agree on how much is on
            /// it. Folding them hides that, so the row carries it instead.
            ///
            /// Only a source that has actually spoken can disagree. A node
            /// that has never reported reads nought for every pool it models,
            /// and calling that a dispute would put the marker on every shelf
            /// of every shop whose box is not plugged in yet — which is the
            /// same noise as the label this fold replaced. Rollups are excluded
            /// for a different reason: the two sides derive them over different
            /// leaves, so their numbers are not the same question.
            ///
            /// And a shadowed row is not a rival either. Shadowing is the
            /// centre conceding the shelf to the node standing in front of it:
            /// the Cloud figure is then a ledger nobody feeds, not a second
            /// opinion. Marking it disputed put a warning on every DC base pool
            /// the moment the node reported, which is the one case where the
            /// two numbers are *expected* to differ.
            const rival = sources.find(
              (item) =>
                item !== lead &&
                item.stock !== lead.stock &&
                !item.authority.derived &&
                item.authority.shadowed_by_origin_id === null &&
                item.sync_status !== "WAITING"
            )
            return {
              key: poolId,
              poolId,
              label: lead.label,
              pool: lead,
              stock: lead.stock,
              on_hand: lead.on_hand,
              allotted: borrow((item) => item.allotted),
              observed: borrow((item) => item.observed),
              missing: lead.missing,
              last_count: lastCounts.get(poolId) ?? null,
              counted: lead.authority.included_in_fleet_total,
              group: lead.group,
              disputed:
                rival === undefined
                  ? null
                  : {
                      source: rival.owner_label ?? rival.origin_id,
                      stock: rival.stock,
                    },
              sources,
            }
          })
          .sort(
            (a, b) =>
              a.pool!.display_order - b.pool!.display_order ||
              a.key.localeCompare(b.key)
          )

        /// An outbound stage and its shops are a parent and its children, not
        /// a list that happens to hold both.
        ///
        /// The server sends the stage total as a row of its own — `is_rollup`,
        /// and left out of the fleet total precisely because the rows beneath
        /// it already carry the goods. Drawn flat, it landed between the very
        /// leaves it sums: "In Transit 120" directly above "In Transit /
        /// Store 08 7", which reads as stock counted twice by anyone who has
        /// not memorised which rows the total leaves out. Nesting says what the
        /// number is without a footnote — open Shipment to see which shops it
        /// is shipping to, and the parts visibly add up to the whole.
        ///
        /// Only for display. Every sum below still folds the flat list, so a
        /// leaf counts towards its site exactly once whether it is drawn under
        /// a stage or beside it.
        const stageRollup = new Map<string, PoolRow>()
        for (const child of children) {
          const stage = child.pool?.outbound_stage
          if (child.pool?.is_rollup === true && stage != null) {
            stageRollup.set(stage, child)
          }
        }
        const leavesByStage = new Map<string, PoolRow[]>()
        const topLevel: PoolRow[] = []
        for (const child of children) {
          const stage = child.pool?.outbound_stage
          const parent =
            child.pool?.is_outbound_leaf === true && stage != null
              ? stageRollup.get(stage)
              : undefined
          if (parent === undefined || stage == null) {
            topLevel.push(child)
            continue
          }
          const siblings = leavesByStage.get(stage)
          if (siblings) siblings.push(child)
          else leavesByStage.set(stage, [child])
        }
        const displayed = topLevel.map((child) => {
          const stage = child.pool?.outbound_stage
          const leaves =
            child.pool?.is_rollup === true && stage != null
              ? leavesByStage.get(stage)
              : undefined
          return leaves === undefined ? child : { ...child, subRows: leaves }
        })

        const counted = children.filter((child) => child.counted)
        const sum = (pick: (row: PoolRow) => number) =>
          counted.reduce((total, row) => total + pick(row), 0)
        /// The same fold over a column that is allowed to be absent. A site
        /// where nothing can be allotted or nothing can be sighted reports no
        /// reading, not a reading of nought — a nought is a claim.
        const known = (pick: (row: PoolRow) => number | null) => {
          const readable = counted.filter((row) => pick(row) !== null)
          return readable.length === 0
            ? null
            : readable.reduce((total, row) => total + (pick(row) ?? 0), 0)
        }
        /// The site was last counted when the most recently counted pool in it
        /// was — including the pools its total leaves out, because somebody did
        /// stand there and count them.
        const latest = children.reduce<string | null>(
          (newest, row) =>
            row.last_count !== null &&
            (newest === null || Date.parse(row.last_count) > Date.parse(newest))
              ? row.last_count
              : newest,
          null
        )

        return {
          key: `site/${siteId}`,
          poolId: siteId,
          /// The site's own name, not the node's. `site.name` is the master
          /// record for the place ("DC", "Store 02"); an origin's label names
          /// the box standing in it ("DC Jakarta"), and the two are folded
          /// under one heading now, so the place is what the heading says.
          label:
            pools.find((item) => item.source_type === "CLOUD_LEDGER")
              ?.site_name ??
            pools[0].site_name ??
            siteId,
          pool: null,
          stock: sum((row) => row.stock),
          on_hand: sum((row) => row.on_hand),
          allotted: known((row) => row.allotted),
          observed: known((row) => row.observed),
          missing: sum((row) => row.missing),
          last_count: latest,
          counted: true,
          // A site is a heading over shelves of several kinds, not a shelf.
          group: null,
          disputed: null,
          subRows: displayed,
        }
      })
  }, [fleet.data, lastCounts])

  const columns = useMemo(
    () =>
      poolColumns({
        allotments: poolAllotments.open,
        sightings: poolSightings.open,
      }),
    [poolAllotments.open, poolSightings.open]
  )
  const filters = useFilters(columns)

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: tree,
        columns: filters.columns,
        getRowId: (row: PoolRow) => row.key,
        getSubRows: (row: PoolRow) => row.subRows as PoolRow[] | undefined,
        // Searching flattens the tree on purpose: a match three sites down is
        // not findable behind a chevron, and a filtered hierarchy that keeps
        // its parents is a hierarchy of one row each.
        filterFromLeafRows: true,
        state: {
          columnFilters: filters.columnFilters,
          globalFilter: query,
          expanded,
          sorting,
        },
        onExpandedChange: setExpanded,
        onSortingChange: setSorting,
        onGlobalFilterChange: setQuery,
      }),
      [tree, filters.columns, filters.columnFilters, query, expanded, sorting]
    )
  )

  return (
    <>
      {/* The panel docks where there is room for it — narrower than 1440 it is
          the Filter button in the omnibox above, which is the same model drawn
          as a sheet. Same shape as the order book and the count book, because
          it is the same act: narrow a list, order it, name the question. */}
      <div className="grid min-w-0 items-start gap-5 dock:grid-cols-[minmax(0,1fr)_16rem]">
        <div className="flex min-w-0 flex-col">
          <div className="mb-3 flex flex-wrap items-center gap-1.5">
            <span className="relative mr-auto">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-line-ico" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search pools"
                aria-label="Search pools"
                className="h-[2.125rem] w-64 rounded-inner border border-hairline-2 bg-canvas pr-2.5 pl-8 text-[0.875rem] text-ink shadow-soft outline-none placeholder:text-body focus:border-accent"
              />
            </span>
            {/* The same model as the panel, as the chips over the table and
                a Filter button beside them — for every width the panel cannot
                dock at. Rendered only there: the panel unmounts below the dock
                width rather than hiding, because both of these carry a sheet
                on the same `?filters=` key. */}
            {!docked && (
              <FilterPanel model={filters} table={table} className="mr-auto" />
            )}
            <SortMenu
              table={table}
              sorting={sorting}
              onSort={(id, desc) => setSorting([{ id, desc }])}
            />
            <ColumnsMenu table={table} />
            <span aria-hidden className="mx-1 h-5 w-px bg-hairline" />
            <ViewPicker model={filters} id="pools" all="Every pool" />
          </div>

          <Card className="overflow-hidden">
            {queryState(fleet, {
              loading: "Reading every node…",
              render: () =>
                tree.length === 0 ? (
                  <EmptyState>
                    This node has no active operational pool.
                  </EmptyState>
                ) : (
                  <DataTable<PoolRow>
                    table={table}
                    // A pool row opens its own page; a site row has none, so
                    // the whole row is the chevron's click target rather than a
                    // dead strip beside a 14-pixel control.
                    onRowClick={(row) => {
                      if (row.pool) pool.open(row.poolId)
                      else table.getRow(row.key).toggleExpanded()
                    }}
                    // `row.pool?.id === pool.value` was `undefined ===
                    // undefined` on every site row with no sheet open, which
                    // tinted all fourteen of them as selected.
                    isSelected={(row) =>
                      row.pool !== null && row.pool.id === pool.value
                    }
                    className="max-h-[calc(100vh-16rem)]"
                  />
                ),
            })}
          </Card>

          {/* The two windows the Observed and Missing columns are measured
              over. Under the table rather than over it: it explains two
              columns, and it is not a thing anybody acts on. */}
          {fleet.data && (
            <p className="mt-2 text-[0.875rem] text-mute tabular-nums">
              Sightings counted over the last {fleet.data.observed_window_hours}
              h · loss measured over {fleet.data.lost_risk_window_days} days
            </p>
          )}
        </div>

        {/* The table is what the panel narrows, and it is handed over because
            this list is narrowed in the BROWSER: the values a one-tap row
            offers are the ones the rows actually hold. A server-narrowed list
            passes `counted` facets instead and needs no table. */}
        <DockedFilters
          model={filters}
          table={table}
          kpis={fleetKpis(tree)}
          id="pools"
          subject="Pool"
          className="hidden dock:flex"
        />
      </div>

      <PoolSheet id={pool.value ?? null} onClose={pool.close} />
      <PoolAllotmentsSheet
        id={poolAllotments.value ?? null}
        onClose={poolAllotments.close}
      />
      <PoolSightingsSheet
        id={poolSightings.value ?? null}
        onClose={poolSightings.close}
      />
    </>
  )
}

/// Three figures about the fleet as it stands, over the WHOLE tree rather than
/// over a page — this list arrives in one read, so these are exact and there is
/// no "of n shown" to qualify them with.
///
/// Not the four the Stock screen prints above this table: those are pieces, and
/// these are shelves. "Never counted" is the one that changes a decision — a
/// pool nobody has ever stood in front of is a number nobody has ever checked.
function fleetKpis(tree: readonly PoolRow[]) {
  if (tree.length === 0) return undefined
  /// Every shelf under a site, however deep it is drawn. Outbound leaves sit
  /// one level further down than the rest now, and a flat read of the site's
  /// own children would count a stage total as one pool and its thirteen
  /// shops as none — which is exactly the miscount the nesting exists to
  /// prevent, moved into the tiles above it.
  const shelves = (row: PoolRow): PoolRow[] =>
    row.subRows === undefined
      ? [row]
      : row.subRows.flatMap((child) => shelves(child))
  const pools = tree.flatMap((site) => site.subRows?.flatMap(shelves) ?? [])
  const never = pools.filter((one) => one.last_count === null).length
  return [
    { label: "Sites", value: count(tree.length) },
    { label: "Pools", value: count(pools.length) },
    {
      label: "Never counted",
      value: count(never),
      note: "Pools no official count has ever been opened against.",
    },
    {
      label: "Disputed",
      value: count(pools.filter((one) => one.disputed !== null).length),
      note: "Two sources reporting different quantities for one shelf.",
    },
  ]
}

export function Pools() {
  return (
    <PageContent>
      <PageHeader
        crumb="Inventory"
        title="Pools"
        sub="Where the stock is standing, on this node and on every node that reports to it."
      />
      <PoolsBody />
    </PageContent>
  )
}

/// A correction as it is composed. The subject is picked from the holding table
/// rather than typed, but it is part of the same act and part of the same
/// draft: a chosen row with no evidence beside it is exactly the half-made
/// correction the server refuses.
interface CorrectionDraft {
  subject: PoolItem | null
  destination: string
  quantity: string
  reason: string
  evidence: string
}

/// The pool's own page: what is in it, what is lost from it, what has been
/// read in it, what has moved through it, and what has been counted of it.
function PoolSheet({
  id,
  onClose,
}: {
  id: string | null
  onClose: () => void
}) {
  const client = useQueryClient()
  const actor = useActor()

  const detail = useQuery({
    queryKey: inventoryKeys.pool(id ?? ""),
    queryFn: ({ signal }) => poolDetail(id!, signal),
    enabled: id !== null,
  })

  const fleet = useQuery({
    queryKey: inventoryKeys.fleet(),
    queryFn: ({ signal }) => fleetPools(signal),
  })

  const correct = useMutation({
    // Wrapped rather than passed by reference: v5 hands a mutation context as
    // the second argument, which is not the `AbortSignal` the fetcher expects.
    mutationFn: (draft: CorrectionDraft) =>
      correctPlacement({
        idempotency_key: idempotencyKey(),
        actor_id: actor,
        occurred_at: null,
        reason: draft.reason,
        evidence_reference: draft.evidence,
        notes: null,
        line: {
          subject_id: draft.subject?.subject_id ?? null,
          epc: null,
          quantity: Number(draft.quantity),
          from: `${id}:on_hand`,
          to: `${draft.destination}:on_hand`,
        },
      }),
    onSuccess: () => {
      // Both pools changed, and so did the fleet totals they roll into. The
      // destination is not named as a key of its own: `pool` is invalidated by
      // prefix so the pool being corrected *into* is refetched too.
      client.invalidateQueries({ queryKey: ["inventory", "pools"] })
      client.invalidateQueries({ queryKey: inventoryKeys.fleet() })
      // The subject and what proved it. Where it actually is, and how many, are
      // what the next row off the same shelf is corrected to as well.
      form.setFieldValue("subject", null)
      form.setFieldValue("reason", "")
      form.setFieldValue("evidence", "")
    },
  })

  const form = useForm({
    defaultValues: {
      subject: null,
      destination: "",
      quantity: "1",
      reason: "",
      evidence: "",
    } as CorrectionDraft,
    onSubmit: ({ value }) => correct.mutate(value),
  })

  const destinations = useMemo(
    () =>
      writablePools(fleet.data?.items ?? [])
        .filter((item) => item.id !== id)
        .map((item) => ({
          value: item.id,
          label: `${item.site_id} · ${item.label}`,
        })),
    [fleet.data, id]
  )

  return (
    <Sheet
      open={id !== null}
      // Six sections and a five-field form do not fit a 27.5rem rail: the
      // holding table alone can be two hundred rows. The trade is real and
      // taken deliberately — only `rail` docks beside the list on a wide
      // monitor, so this panel now covers the table it was opened from. For a
      // record this dense that is the better half of the trade; the list is
      // still there when it closes.
      width="table"
      subject={id === null ? undefined : { kind: "pool", id }}
      onOpenChange={(open) => !open && onClose()}
      id={id ?? undefined}
      title={detail.data?.summary.label ?? "Pool"}
    >
      {queryState(detail, {
        loading: "Opening the pool…",
        render: (pool) => (
          <div className="flex flex-col gap-5">
            <div className="flex flex-wrap gap-1.5">
              <Tag>{pool.summary.group}</Tag>
              <Tag>{pool.summary.pool_code}</Tag>
              {pool.summary.is_rollup && (
                <Tag tone="warn">SUM OF ITS SHOPS</Tag>
              )}
            </div>

            <Facts>
              <Fact term="Site">
                {pool.summary.site_name ?? pool.summary.site_id}
              </Fact>
              <Fact term="Stock">{count(pool.summary.stock)}</Fact>
              <Fact term="On hand">{count(pool.summary.on_hand)}</Fact>
              <Fact term="Allotted">{count(pool.summary.allotted ?? 0)}</Fact>
              <Fact term="Missing">{count(pool.summary.missing)}</Fact>
              <Fact term="Seen">{count(pool.summary.observed ?? 0)}</Fact>
              <Fact term="Lost">{count(pool.summary.lost_quantity ?? 0)}</Fact>
              <Fact term="Lost rate">{percent(pool.summary.lost_rate)}</Fact>
            </Facts>

            <section>
              <h4 className="mb-2 text-card-title font-semibold text-ink">
                Holding
                <span className="ml-1.5 font-normal text-mute">
                  {count(pool.items.length)}
                </span>
              </h4>
              {pool.items.length === 0 ? (
                <p className="text-meta text-body">
                  Nothing sits in this pool.
                </p>
              ) : (
                <form.Subscribe
                  selector={(state) => state.values.subject?.subject_id ?? null}
                >
                  {(picked) => (
                    <MiniTable head={["Subject", "SKU", "Qty"]}>
                      {pool.items.map((item) => (
                        <tr
                          key={item.subject_id}
                          onClick={() => form.setFieldValue("subject", item)}
                          className={`cursor-pointer border-t border-hairline ${
                            picked === item.subject_id
                              ? "bg-accent-bg"
                              : "hover:bg-soft"
                          }`}
                        >
                          <td className="py-2 pr-2">
                            <span className="block text-[0.875rem] text-ink">
                              {item.article_name ?? item.subject_type}
                            </span>
                            <span className="font-mono text-[0.875rem] text-mute">
                              {item.epc ?? item.barcode ?? item.subject_id}
                            </span>
                          </td>
                          <td className="py-2 text-right font-mono text-[0.875rem] text-body">
                            {item.sku_code ?? "—"}
                          </td>
                          <td className="py-2 text-right tabular-nums">
                            {count(item.quantity)}
                          </td>
                        </tr>
                      ))}
                    </MiniTable>
                  )}
                </form.Subscribe>
              )}
            </section>

            {pool.missing.length > 0 && (
              <section>
                <h4 className="mb-2 text-card-title font-semibold text-ink">
                  Missing from here
                </h4>
                <MiniTable head={["Subject", "Age", "Qty"]}>
                  {pool.missing.map((item) => (
                    <tr key={item.id} className="border-t border-hairline">
                      <td className="py-2 pr-2 font-mono text-[0.875rem] text-body">
                        {item.epc ?? item.sku_code ?? item.subject_id}
                      </td>
                      <td className="py-2 text-right text-warn-fg">
                        {age(item.age_hours)}
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        {count(item.quantity)}
                      </td>
                    </tr>
                  ))}
                </MiniTable>
              </section>
            )}

            {pool.movements.length > 0 && (
              <section>
                <h4 className="mb-2 text-card-title font-semibold text-ink">
                  Recent movements
                </h4>
                <MiniTable head={["Cause", "Route", "Qty"]}>
                  {pool.movements.map((movement) => (
                    <tr
                      key={movement.movement_id}
                      className="border-t border-hairline"
                    >
                      <td className="py-2 pr-2">
                        <Tag>{movement.cause}</Tag>
                        <span className="mt-0.5 block text-[0.875rem] text-mute">
                          {moment(movement.occurred_at)}
                        </span>
                      </td>
                      <td className="py-2 text-right font-mono text-[0.875rem] text-body">
                        {movement.from} → {movement.to}
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        {count(movement.quantity)}
                      </td>
                    </tr>
                  ))}
                </MiniTable>
              </section>
            )}

            {/* The server has been sending these all along and the panel
                dropped them on the floor. A pool's sightings are the evidence
                behind its Observed column, and the one reading on this screen
                that comes from a machine rather than from the ledger. */}
            {pool.observations.length > 0 && (
              <section>
                <h4 className="mb-2 text-card-title font-semibold text-ink">
                  Seen here
                  <span className="ml-1.5 font-normal text-mute">
                    {count(pool.observations.length)}
                  </span>
                </h4>
                <p className="mb-2 text-[0.875rem] text-mute">
                  Evidence, not movements — nothing here has changed the ledger.
                </p>
                <MiniTable
                  head={[
                    "Tag",
                    "Last seen",
                    { label: "Reads", align: "right" },
                  ]}
                >
                  {pool.observations.map((item) => (
                    <tr
                      key={item.observation_id}
                      className="border-t border-hairline"
                    >
                      <td className="py-2 pr-2 font-mono text-[0.875rem] text-body">
                        {item.epc}
                      </td>
                      <td className="py-2 pr-2 text-[0.875rem] text-body">
                        {ago(item.last_seen_at)}
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        {count(item.read_count)}
                      </td>
                    </tr>
                  ))}
                </MiniTable>
              </section>
            )}

            {pool.counts.length > 0 && (
              <section>
                <h4 className="mb-2 text-card-title font-semibold text-ink">
                  Counted
                </h4>
                <MiniTable
                  head={["Reason", "Kind", { label: "Status", align: "right" }]}
                >
                  {pool.counts.map((item) => (
                    <tr key={item.id} className="border-t border-hairline">
                      <td className="py-2 pr-2 text-[0.875rem] text-ink">
                        {item.reason}
                      </td>
                      <td className="py-2 text-right">
                        <Tag>{item.kind}</Tag>
                      </td>
                      <td className="py-2 text-right">
                        <Pill
                          tone={item.status === "CLOSED" ? "ok" : "info"}
                          className="ml-auto"
                        >
                          {humanise(item.status)}
                        </Pill>
                      </td>
                    </tr>
                  ))}
                </MiniTable>
              </section>
            )}

            <section className="border-t border-hairline pt-4">
              <h4 className="mb-1 text-card-title font-semibold text-ink">
                Correct a placement
              </h4>
              <p className="mb-3 text-[0.875rem] text-mute">
                A sighting is evidence, not a movement — the ledger is never
                corrected on its own. Pick the subject above, say where it
                actually is, and name what proves it.
              </p>

              {correct.isError && (
                <Banner tone="bad" className="mb-3">
                  {correct.error instanceof Error
                    ? correct.error.message
                    : "The correction was refused."}
                </Banner>
              )}

              <form
                onSubmit={(event) => {
                  event.preventDefault()
                  form.handleSubmit()
                }}
                className="flex flex-col gap-3"
              >
                <form.Field name="subject">
                  {(field) => (
                    <Field label="Subject">
                      <Input
                        readOnly
                        value={
                          field.state.value
                            ? (field.state.value.epc ??
                              field.state.value.sku_code ??
                              field.state.value.subject_id)
                            : ""
                        }
                        placeholder="Choose a row above"
                      />
                    </Field>
                  )}
                </form.Field>
                <form.Field name="destination">
                  {(field) => (
                    <Field label="Actually in" required>
                      <Choice
                        value={field.state.value}
                        onChange={field.handleChange}
                        options={destinations}
                        placeholder="Choose a pool"
                        className="h-9 w-full max-w-none"
                      />
                    </Field>
                  )}
                </form.Field>
                <form.Field name="quantity">
                  {(field) => (
                    <Field label="Quantity" required>
                      <Input
                        type="number"
                        min={1}
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={(event) =>
                          field.handleChange(event.target.value)
                        }
                      />
                    </Field>
                  )}
                </form.Field>
                <form.Field name="reason">
                  {(field) => (
                    <Field label="Reason" required>
                      <Input
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={(event) =>
                          field.handleChange(event.target.value)
                        }
                        placeholder="Found on the floor during the morning sweep"
                      />
                    </Field>
                  )}
                </form.Field>
                <form.Field name="evidence">
                  {(field) => (
                    <Field
                      label="Evidence"
                      required
                      hint="A photograph, a count id, a note number. The server refuses a correction without one."
                    >
                      <Input
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={(event) =>
                          field.handleChange(event.target.value)
                        }
                        placeholder="COUNT-2026-08-31-DC"
                      />
                    </Field>
                  )}
                </form.Field>
                <form.Subscribe
                  selector={(state) =>
                    state.values.subject !== null &&
                    state.values.destination !== "" &&
                    state.values.reason.trim() !== "" &&
                    state.values.evidence.trim() !== "" &&
                    Number(state.values.quantity) > 0 &&
                    actor !== ""
                  }
                >
                  {(ready) => (
                    <Button
                      type="submit"
                      variant="primary"
                      pending={correct.isPending}
                      disabled={!ready}
                    >
                      {correct.isPending ? "Posting…" : "Correct placement"}
                    </Button>
                  )}
                </form.Subscribe>
                {actor === "" && (
                  <p className="text-[0.875rem] text-mute">
                    Sign in before posting: the ledger records who moved the
                    stock and the server has no default.
                  </p>
                )}
              </form>
            </section>
          </div>
        ),
      })}
    </Sheet>
  )
}

/// What one shelf has been promised out of, reached from the Allotted column.
///
/// The Allotted number on a pool row is a sum of instructions, and nothing on
/// that screen said which ones. Answering it needed a server-side filter that
/// already existed and nothing had ever called — `source_pool_id` on the
/// allotment book — so this is a narrow read, not a fetch-everything-and-sift:
/// an allotment drawing on three pools matches on one of them, and its other
/// two lines are none of this pool's business.
function PoolAllotmentsSheet({
  id,
  onClose,
}: {
  id: string | null
  onClose: () => void
}) {
  const book = useQuery({
    queryKey: inventoryKeys.allotmentsByPool(id ?? ""),
    queryFn: ({ signal }) => allotmentsByPool(id!, signal),
    enabled: id !== null,
  })

  return (
    <Sheet
      open={id !== null}
      width="wide"
      onOpenChange={(open) => !open && onClose()}
      id={id ?? undefined}
      title="Allotted out of this pool"
    >
      {queryState(book, {
        loading: "Reading the book…",
        render: (list) =>
          list.items.length === 0 ? (
            <EmptyState>
              Nothing is promised out of here. Allotted counts pieces committed
              to a destination but not yet picked, and this pool has none.
            </EmptyState>
          ) : (
            <div className="flex flex-col gap-4">
              <p className="text-meta text-body">
                {count(list.items.length)} allotment
                {list.items.length === 1 ? "" : "s"} draw on this pool.
                Remaining is what is still owed — accepted, less picked, less
                cancelled — and it is the number the Allotted column adds up.
              </p>
              <MiniTable
                head={[
                  "Allotment",
                  "Destinations",
                  { label: "Remaining", align: "right" },
                ]}
              >
                {list.items.map((item) => (
                  <tr key={item.id} className="border-t border-hairline">
                    <td className="py-2 pr-2">
                      <AppLink
                        to="/allotment"
                        sheet={{ key: "allotment", value: item.id }}
                        className="font-mono text-id text-body hover:text-ink hover:underline"
                      >
                        {item.allotment_number}
                      </AppLink>
                      <span className="mt-0.5 block text-[0.875rem] text-mute">
                        {humanise(item.type)} · {moment(item.created_at)}
                      </span>
                    </td>
                    <td className="py-2 pr-2 text-[0.875rem] text-body">
                      {count(item.destination_count)} · {count(item.sku_count)}{" "}
                      SKU
                      <Pill
                        tone={item.status === "CANCELLED" ? "bad" : "info"}
                        className="ml-1.5"
                      >
                        {humanise(item.status)}
                      </Pill>
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {count(item.remaining_quantity)}
                    </td>
                  </tr>
                ))}
              </MiniTable>
            </div>
          ),
      })}
    </Sheet>
  )
}

/// Every tag a reader saw in this pool, reached from the Observed column.
///
/// **A sighting is evidence, not a movement.** Nothing here has moved a piece
/// or ever will: ingesting RFID returns `inventory_effect: {0, 0}` and the
/// server means it literally. A tag read in the wrong aisle is a fact about a
/// reading; making the ledger agree with it takes a person and a placement
/// correction, which is on the pool's own sheet. That is why this is a
/// separate panel from the movements rather than a section beside them — they
/// are two ledgers, and conflating them is how a fleet starts trusting a
/// scanner over a count.
function PoolSightingsSheet({
  id,
  onClose,
}: {
  id: string | null
  onClose: () => void
}) {
  const scope = { pool_id: id ?? "" }
  const reads = useInfiniteQuery({
    queryKey: inventoryKeys.observations(scope),
    queryFn: ({ pageParam, signal }) =>
      sightingsPage({ ...scope, cursor: pageParam }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    enabled: id !== null,
  })

  return (
    <Sheet
      open={id !== null}
      width="wide"
      onOpenChange={(open) => !open && onClose()}
      id={id ?? undefined}
      title="Seen in this pool"
    >
      {queryState(reads, {
        loading: "Reading the sightings…",
        render: (data) => {
          const items = data.pages.flatMap((page) => page.rows)
          return items.length === 0 ? (
            <EmptyState>
              No tag has been read here. Observed counts distinct tags a reader
              saw inside the window, and nothing has swept this pool in it.
            </EmptyState>
          ) : (
            <div className="flex flex-col gap-4">
              <Banner tone="info">
                A sighting is evidence, not a movement. Nothing on this list has
                changed the ledger — correcting a placement is done on the
                pool's own sheet, and it needs a reason and a piece of evidence.
              </Banner>
              <MiniTable
                head={["Tag", "Last seen", { label: "Reads", align: "right" }]}
              >
                {items.map((item) => (
                  <tr
                    key={item.observation_id}
                    className="border-t border-hairline"
                  >
                    <td className="py-2 pr-2">
                      <span className="block font-mono text-[0.875rem] text-body">
                        {item.epc}
                      </span>
                      <span className="font-mono text-[0.875rem] text-mute">
                        {item.sku_code ?? "unknown SKU"}
                      </span>
                    </td>
                    <td className="py-2 pr-2 text-[0.875rem] text-body">
                      {ago(item.last_seen_at)}
                      <span className="mt-0.5 block text-[0.875rem] text-mute">
                        {item.device_id}
                      </span>
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {count(item.read_count)}
                    </td>
                  </tr>
                ))}
              </MiniTable>
              {/* Inside the sheet body, which is the box that scrolls. */}
              <LoadMore query={reads} />
            </div>
          )
        },
      })}
    </Sheet>
  )
}
