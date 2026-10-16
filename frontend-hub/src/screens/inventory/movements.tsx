import {
  useSuspenseInfiniteQuery,
  useSuspenseQuery,
} from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { Suspense, useDeferredValue, useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { DockTools } from "@/components/shell/dock-tools"
import { AppLink } from "@/components/ui/app-link"
import { Card } from "@/components/ui/card"
import { DataTable, dockSortOf } from "@/components/ui/data-table"
import {
  BarSpacer,
  ColumnsMenu,
  DockedFilters,
  ExpandingSearch,
  SortMenu,
} from "@/components/ui/list-chrome"
import { FilterPanel } from "@/components/ui/filter-panel"
import { PageHeader } from "@/components/ui/page-header"
import { EmptyState, LoadingState } from "@/components/ui/states"
import { Tag } from "@/components/ui/tag"
import { useFilterState, type FilterField } from "@/lib/filters"
import { useLayout, usePanelDock } from "@/lib/layout"
import { count, label as humanise, moment } from "@/lib/format"
import {
  fleetPoolsQuery,
  movementScopeFromFilters,
  movementsLedgerQuery,
  MOVEMENTS_LIMIT,
  type Movement,
  type MovementScope,
} from "@/lib/queries/inventory"
import { useSheet } from "@/lib/sheets"
import { tableSetup, type TableSetup } from "@/lib/table"
import { cn } from "@/lib/utils"
import { useDebounced } from "@/lib/use-debounced"
import { placements } from "@/screens/inventory/shared"

/// The ledger itself — every posting that moved a piece, in the order it
/// happened.
///
/// # Why this is its own screen
///
/// Movements have always reached the app as a tail: a pool's own panel carries
/// the last few in and out of it, capped by whatever that read decides. That
/// answers "what happened to this shelf lately" and nothing else. It cannot
/// answer "what happened at all", which is the question somebody has when the
/// number is wrong and they do not yet know which shelf to blame.
///
/// # What a movement is
///
/// Double-entry, and both halves are on the row. `from` and `to` are *places*
/// — `<pool>:on_hand`, `<pool>:missing`, `system/lost`, `external/disposal` —
/// so a piece going missing is not a deletion, it is a move to the missing
/// place of the same pool, and losing it for good is a second move out to
/// `system/lost`. That is why the route is one column and not two: reading
/// "where did it go" as a pair of independent columns is what makes a ledger
/// look like a list of edits.
///
/// **Action is the load-bearing column.** Most causes are workflow-owned — a
/// SALE posts from a till, a PICK from a picklist — and only `NORMAL_MOVE` and
/// `RETURN_TO_DC` may be posted by hand. A movement claiming SALE that nobody
/// sold is the failure the server refuses at the boundary, and reading the
/// action is how anybody would notice one that got through.
///
/// # The question goes to the server
///
/// This screen used to ask for the newest 300 postings and then sift, search
/// and sort them in the browser, with a banner over the table admitting that
/// the figures below it were not totals. Both are gone. The search, the pool,
/// the action, who posted it and the order are all parameters
/// `GET /inventory/movements` already answered — nothing here was added to the
/// endpoint — and what does not fit on one page is fetched by walking
/// `next_cursor` rather than described in a paragraph.

/// A place id, read as the four facts it is made of.
///
/// `store-02.warehouse:on_hand` is one string and four facts, and every one of
/// them is worth drawing separately: the SITE says whose building it is, the
/// SHELF says where in it, the STATE is the interesting half (a movement
/// between the two halves of one pool is a piece going missing or being
/// found, which reads as a no-op if the suffix is dropped), and whether the
/// place is inside the pool grammar at all says whether the stock is moving
/// or leaving.
interface Place {
  /// The pool this place belongs to, for the link — the id without the state.
  readonly poolId: string | null
  /// "DC", "Store 07". Null on a place outside the pool grammar.
  readonly site: string | null
  /// "Warehouse", "Picked / Store 08", "Opening", "Lost".
  readonly shelf: string
  /// Drawn only when it is not `on_hand`, which is every posting anybody has
  /// to think about.
  readonly state: string | null
  /// `system/lost`, `external/disposal` — outside the pool grammar entirely.
  /// Stock crossing that line is leaving the company rather than moving
  /// inside it, and the chip says so.
  readonly outside: boolean
}

/// Pool ids as the names on the pool master, so a route reads in the words the
/// rest of the app uses.
///
/// The ledger writes place ids and nothing else: `dc.outbound.picked.store-08`
/// is what the row carries, and it is the same shelf the Pools screen calls
/// "Picked / Store 08" at the site it calls "DC". Printing the id was printing
/// our own primary key at somebody who has to read a hundred rows of it.
///
/// Falls back to the id's own segments for a pool the fleet read does not know
/// — a shelf retired since the posting was made still has to draw.
function readPlace(
  id: string,
  pools: Map<string, { site: string; shelf: string }>
): Place {
  const cut = id.lastIndexOf(":")
  if (cut === -1) {
    // `system/opening`, `system/lost`, `external/disposal`.
    const tail = id.slice(id.lastIndexOf("/") + 1)
    return {
      poolId: null,
      site: null,
      shelf: humanise(tail),
      state: null,
      outside: true,
    }
  }
  const poolId = id.slice(0, cut)
  const state = id.slice(cut + 1)
  const known = pools.get(poolId)
  const parts = poolId.split(".")
  return {
    poolId,
    site: known?.site ?? humanise(parts[0]),
    shelf:
      known?.shelf ??
      (parts.length > 1 ? humanise(parts.slice(1).join(" / ")) : poolId),
    state: state === "on_hand" ? null : humanise(state).toLowerCase(),
    outside: false,
  }
}

const CHIP =
  "inline-flex min-w-0 max-w-full items-baseline gap-1 rounded-full border px-2 py-px text-[0.9375rem] leading-[1.35rem]"

/// One end of the route, as a chip.
///
/// A chip rather than a line of mono, at the owner's word (2026-09-13): two
/// full place ids came to 475px of unbreakable text, which is wider than the
/// card has to give, and the id was the wrong thing to be reading anyway. The
/// site is the quiet half and the shelf is the loud one, because a reader
/// scanning this column is looking for WHICH SHELF and already knows the
/// building.
///
/// A place inside the pool grammar opens that pool; a place outside it —
/// Opening, Lost, Disposal — is drawn dashed and grey and links nowhere,
/// because there is no shelf on the other side of it.
function PlaceChip({ id, place }: { id: string; place: Place }) {
  const body = (
    <>
      {place.site !== null && (
        <span className="shrink-0 text-mute">{place.site} ·</span>
      )}
      <span className="min-w-0 truncate text-text">{place.shelf}</span>
      {place.state !== null && (
        <span className="shrink-0 text-warn-fg">{place.state}</span>
      )}
    </>
  )

  if (place.outside || place.poolId === null) {
    return (
      <span
        title={id}
        className={cn(CHIP, "border-dashed border-hairline-2 text-mute")}
      >
        {body}
      </span>
    )
  }

  return (
    <AppLink
      to="/inventory/pools"
      sheet={{ key: "pool", value: place.poolId }}
      title={id}
      className={cn(
        CHIP,
        "border-hairline-2 bg-soft-2 transition-colors hover:border-hairline-strong hover:bg-soft"
      )}
    >
      {body}
    </AppLink>
  )
}

/// Which column means which of the four orders the endpoint names.
///
/// A column that is not in here cannot be sorted — `enableSorting: false` says
/// so on the column itself, so neither the header nor the Sort menu offers it.
/// The alternative is worse than a missing menu item: the table would sort the
/// PAGE it is holding, and a ledger sorted one screenful at a time is a list
/// that lies about which posting came first.
const SORTS: Record<string, string> = {
  occurred_at: "occurred_at",
  cause: "cause",
  quantity: "quantity",
}

/// The columns, over the pool names they draw with.
///
/// A factory rather than a constant, like `poolColumns` next door and for the
/// same reason: the route cell needs the pool master to turn a place id into
/// the name the rest of the app calls that shelf, and a module-level constant
/// has no way to be handed one.
const movementColumns = (
  pools: Map<string, { site: string; shelf: string }>
): ColumnDef<TableSetup, Movement>[] => [
  {
    accessorKey: "occurred_at",
    header: "Date",
    size: 116,
    meta: { card: "hide" },
    cell: ({ row }) => moment(row.original.occurred_at),
  },
  {
    accessorKey: "cause",
    header: "Action",
    size: 156,
    meta: { card: "hide" },
    cell: ({ row }) => <Tag>{humanise(row.original.cause)}</Tag>,
  },
  {
    id: "route",
    accessorFn: (row) => `${row.from} → ${row.to}`,
    header: "Route",
    size: 296,
    // The server has no order for a route, and neither has this: alphabetising
    // place ids groups the shelves whose names happen to share a prefix.
    enableSorting: false,
    meta: { card: "hide" },
    /// One line and one arrow, at the owner's word (2026-09-13). It was two
    /// stacked lines of raw place id with an arrow on the second, which cost
    /// every row twice the height to say what a single arrow says: out of
    /// here, into there.
    ///
    /// The two chips shrink and the arrow does not, so a long shelf name
    /// truncates inside its own chip rather than pushing the columns to its
    /// right out of line. The full place id is on the title of each, because a
    /// truncated one is exactly the thing somebody leans in to read.
    cell: ({ row }) => (
      <span className="flex min-w-0 items-center gap-1.5 overflow-hidden">
        <PlaceChip
          id={row.original.from}
          place={readPlace(row.original.from, pools)}
        />
        <span className="shrink-0 text-line-ico">→</span>
        <PlaceChip
          id={row.original.to}
          place={readPlace(row.original.to, pools)}
        />
      </span>
    ),
  },
  {
    accessorKey: "sku_code",
    header: "SKU",
    size: 104,
    enableSorting: false,
    meta: { mono: true, card: "hide" },
    cell: ({ row }) =>
      row.original.sku_code ?? <span className="text-mute">—</span>,
  },
  {
    accessorKey: "epc",
    header: "Tag",
    size: 118,
    enableSorting: false,
    meta: { mono: true, priority: 3, card: "hide" },
    cell: ({ row }) => row.original.epc ?? <span className="text-mute">—</span>,
  },
  {
    accessorKey: "quantity",
    header: "Quantity",
    size: 66,
    meta: { align: "right", card: "hide" },
    cell: ({ row }) => count(row.original.quantity),
  },
  {
    accessorKey: "actor_id",
    header: "Posted by",
    size: 130,
    enableSorting: false,
    meta: { priority: 2, card: "hide" },
    cell: ({ row }) => row.original.actor_id,
  },
  // Four columns that exist only on a card (a phone), the same card as every
  // list (owner, 2026-10-06): the action over its route, the quantity it
  // leads with, when and by whom in the foot, and the SKU at the foot's end.
  {
    id: "head",
    accessorFn: (row) => row.cause,
    header: "",
    enableHiding: false,
    enableSorting: false,
    meta: { card: "title" },
    cell: ({ row }) => (
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-[1rem] font-semibold break-words text-ink">
          {humanise(row.original.cause)}
        </span>
        <span className="text-[0.9375rem] font-normal break-words text-mute">
          {`${placeText(readPlace(row.original.from, pools))} → ${placeText(readPlace(row.original.to, pools))}`}
        </span>
      </span>
    ),
  },
  {
    id: "lead",
    accessorFn: (row) => row.quantity,
    header: "",
    enableHiding: false,
    enableSorting: false,
    meta: { card: "lead" },
    cell: ({ row }) => (
      <span className="flex flex-col items-end tabular-nums">
        <span className="text-[1.5rem] leading-tight font-semibold tracking-tight text-ink">
          {count(row.original.quantity)}
        </span>
        <span className="text-[0.9375rem] text-mute">
          {row.original.quantity === 1 ? "pc" : "pcs"}
        </span>
      </span>
    ),
  },
  {
    id: "foot",
    accessorFn: (row) => row.occurred_at,
    header: "",
    enableHiding: false,
    enableSorting: false,
    meta: { card: "foot" },
    cell: ({ row }) => (
      <span className="flex flex-col leading-6">
        <span className="tabular-nums">{moment(row.original.occurred_at)}</span>
        <span>{row.original.actor_id}</span>
      </span>
    ),
  },
  {
    id: "sku",
    accessorFn: (row) => row.sku_code ?? "",
    header: "",
    enableHiding: false,
    enableSorting: false,
    meta: { align: "right", card: "status" },
    cell: ({ row }) => (
      <span className="font-mono text-[0.9375rem] text-mute">
        {row.original.sku_code ?? "—"}
      </span>
    ),
  },
]

/// A place as one line of words, for a card: "DC · Warehouse".
function placeText(place: Place): string {
  return `${place.site !== null ? `${place.site} · ` : ""}${place.shelf}${place.state !== null ? ` ${place.state}` : ""}`
}

export function Movements() {
  // The title stands at once; the ledger waits for the fleet and its first
  // page and streams in with them (the server starts the reads too).
  return (
    <PageContent>
      <PageHeader
        crumb="Inventory"
        title="Movements"
        sub="Every posting that moved a piece. Double-entry: a route, an action, and who posted it."
      />
      <Suspense fallback={<LoadingState>Reading the ledger…</LoadingState>}>
        <MovementLedger />
      </Suspense>
    </PageContent>
  )
}

function MovementLedger() {
  /// What was typed, in the URL like every other narrowing in the app: a
  /// filtered ledger is a thing people send each other.
  const search = useSheet("q")
  /// Whether the filter panel has room to stand beside the list. Below it the
  /// same model is a sheet behind a Filter button, and the panel unmounts.
  const docked = usePanelDock()
  const phone = useLayout() === "phone"
  // Newest first, which is the order the ledger is read in and the one the
  // server returns before anybody asks.
  const [sorting, setSorting] = useState<SortingState>([
    { id: "occurred_at", desc: true },
  ])

  const fleet = useSuspenseQuery(fleetPoolsQuery())

  /// Every pool the fleet knows, by id, as the two words a route chip draws
  /// with. Every pool and not only the placements: a rollup cannot be counted
  /// into or allotted out of, but the ledger posts through one — half the
  /// outbound corrections in this log leave `dc.outbound.picked` — so leaving
  /// them out would put the raw id back on the busiest rows.
  ///
  /// `site_name` where the master has one ("DC", "Store 07"), and the site id
  /// where it does not.
  const poolNames = useMemo(() => {
    const names = new Map<string, { site: string; shelf: string }>()
    for (const item of fleet.data.items) {
      names.set(item.id, {
        site: item.site_name ?? item.site_id,
        shelf: item.label,
      })
    }
    return names
  }, [fleet.data])

  const columns = useMemo(() => movementColumns(poolNames), [poolNames])

  /// Every shelf, not only the writable ones: this is a read, and a pool the
  /// centre may not post to still has a history worth looking at.
  const poolOptions = useMemo(
    () =>
      placements(fleet.data.items).map((item) => ({
        value: item.id,
        label: `${item.site_name ?? item.site_id} · ${item.label}`,
      })),
    [fleet.data]
  )

  /// The columns this list can be narrowed by, and the only ones: each maps to
  /// a parameter the endpoint answers, and the operators are cut to what it
  /// can honour. An operator the request cannot carry is a chip that silently
  /// narrows nothing.
  ///
  /// **There is no date range here, and its absence is the endpoint's.**
  /// `MovementQuery` takes a pool, a cause, an actor, free text, an order and a
  /// cursor — no `occurred_at` bounds — and it refuses unknown parameters
  /// outright, so a Date chip would 400 the read rather than narrow it. The
  /// ledger is walked newest first instead.
  const fields = useMemo<FilterField[]>(
    () => [
      {
        column: "pool_id",
        label: "Pool",
        spec: {
          kind: "option",
          single: true,
          operators: ["isAnyOf"],
          // Matched against EITHER side of the posting, so a transfer between
          // two pools appears once in each rather than twice in one.
          options: poolOptions,
          format: (id) =>
            poolOptions.find((one) => one.value === id)?.label ?? id,
        },
      },
      {
        column: "cause",
        label: "Action",
        spec: {
          kind: "option",
          single: true,
          operators: ["isAnyOf"],
          // The sentence, not the code: somebody looking for corrections wants
          // "Placement correction", not `PLACEMENT_CORRECTION`.
          format: humanise,
        },
      },
      {
        column: "actor_id",
        label: "Posted by",
        spec: { kind: "option", single: true, operators: ["isAnyOf"] },
      },
    ],
    [poolOptions]
  )

  const filters = useFilterState(fields)

  /// What was typed, plus the chips, plus the order, as the one request that
  /// answers all three.
  ///
  /// Debounced, because every keystroke is a round trip to a query over the
  /// whole company's ledger.
  const needle = useDebounced((search.value ?? "").trim(), 400)
  const scope = useMemo<MovementScope>(() => {
    const by = sorting[0]
    const sort = by === undefined ? undefined : SORTS[by.id]
    return {
      ...movementScopeFromFilters(filters.filters),
      ...(needle === "" ? {} : { q: needle }),
      sort,
      /// **`dir` is inverted on the default sort, and that is the server's
      /// doing.** `movements_page` reads `occurred_at` as `!desc`, because the
      /// house order for a ledger is newest first — so asking for `dir=desc`
      /// there walks UP from the beginning of the log. Measured against the
      /// running node, not read off the doc comment above that function, which
      /// says the opposite of what the code does.
      desc: sort === "occurred_at" ? by?.desc !== true : by?.desc === true,
      limit: MOVEMENTS_LIMIT,
    }
  }, [filters.filters, needle, sorting])

  /// Whether anything is narrowing the log, which is a different question from
  /// whether it is empty: "nothing has been posted" and "nothing matches what
  /// you asked" have different fixes.
  const narrowed = needle !== "" || filters.filters.length > 0

  // The opening scope is `MOVEMENTS_OPENING_SCOPE` (`lib/queries/inventory.ts`),
  // which the prefetcher asks for: keep the default sort above in step.
  //
  // The deferred scope keeps the rows in hand on screen while the next question
  // is read, so a keystroke does not empty the table.
  const asked = useDeferredValue(scope)
  const ledger = useSuspenseInfiniteQuery(movementsLedgerQuery(asked))

  const rows = useMemo(
    () => ledger.data.pages.flatMap((page) => page.rows),
    [ledger.data]
  )
  const head = ledger.data.pages[0]

  /// The same fields, carrying the server's own tally.
  ///
  /// Built here and not above because the counts come from the answer and the
  /// question is built from the fields — declaring them together would be a
  /// circle. Without it the picker would ask the TABLE how many rows hold each
  /// value, and this table holds only what the same filters already let
  /// through, so every option nobody had ticked would print a 0 beside it.
  const counted = useMemo<FilterField[]>(() => {
    const facets = head?.facets
    if (!facets) return fields
    return fields.map((field) =>
      field.column === "cause"
        ? { ...field, spec: { ...field.spec, counted: facets.causes } }
        : field.column === "actor_id"
          ? { ...field, spec: { ...field.spec, counted: facets.actors } }
          : field
    )
  }, [fields, head])

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns,
        getRowId: (row: Movement) => row.movement_id,
        state: {
          sorting,
          // The card's own columns are drawn on a phone and never on a desk.
          columnVisibility: {
            head: phone,
            lead: phone,
            foot: phone,
            sku: phone,
          },
        },
        // The rows arrive in the order the request asked for. Sorting them
        // again here would sort the pages in hand and call it the ledger.
        manualSorting: true,
        onSortingChange: setSorting,
      }),
      [rows, columns, sorting, phone]
    )
  )

  return (
    <>
      {/* The panel docks where there is room for it — narrower than 1440 it is
          the Filter button in the omnibox, which is the same model drawn as a
          sheet. */}
      <div className="grid min-w-0 items-start gap-5 dock:grid-cols-[minmax(0,1fr)_16rem]">
        <div className="flex min-w-0 flex-col">
          {/* One line the width of the table, carrying everything that acts on
              it: what narrows it at the left, what orders and shapes it at the
              right. The page header above keeps the title and nothing else. */}
          <div className="group/bar mb-3 flex flex-wrap items-center gap-1.5 max-md:hidden">
            <ExpandingSearch
              value={search.value ?? ""}
              onChange={(next) => (next ? search.open(next) : search.close())}
              label="Search movements"
            />
            <BarSpacer />
            {/* The same model as the panel, as the chips over the table and
                a Filter button beside them — for every width the panel cannot
                dock at. Rendered only there: the panel unmounts below the dock
                width rather than hiding, because both of these carry a sheet
                on the same `?filters=` key. */}
            {!docked && (
              <FilterPanel
                model={{ ...filters, fields: counted }}
                className="mr-auto"
              />
            )}
            <SortMenu
              table={table}
              sorting={sorting}
              onSort={(id, desc) => setSorting([{ id, desc }])}
            />
            <ColumnsMenu table={table} />
            <span aria-hidden className="mx-1 h-5 w-px bg-hairline" />
          </div>

          {/* A phone's search, filter and order are the dock's, as on every
              list (owner, 2026-10-06). */}
          <DockTools
            search={{
              value: search.value ?? "",
              onChange: (next) => (next ? search.open(next) : search.close()),
              label: "Search Movements",
            }}
            filter={{
              count: filters.filters.length,
              panel: { model: { ...filters, fields: counted } },
            }}
            sort={dockSortOf(table)}
          />

          <Card
            aria-busy={asked !== scope || undefined}
            className="list-swap overflow-hidden max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none"
          >
            {rows.length === 0 ? (
              <EmptyState>
                {narrowed
                  ? "No movement matches what you asked for."
                  : "Nothing has been posted to this ledger yet."}
              </EmptyState>
            ) : (
              <DataTable<Movement>
                refresh={[ledger]}
                table={table}
                /// Always, rather than above the usual 150 rows.
                ///
                /// It is what makes the declared column widths real: the
                /// plain path is a `table-layout: auto` table, where a
                /// `size` is a suggestion and the widest place id in view
                /// decides the route column — 475px of it, which is wider
                /// than the card has to give and is why two columns were
                /// being dropped to pay for it. Virtualised, every cell is
                /// `flex: 0 0 <size>px` and the truncation inside it
                /// happens. Without this the first page would be laid out
                /// one way and the second, once the scroll crosses 150
                /// rows, another.
                virtualizeAbove={0}
                more={ledger}
                className="max-h-[calc(100dvh-14rem)] max-md:max-h-none"
                pageScroll={phone}
                cardsApart
                cardLead
                cardSort={false}
              />
            )}
          </Card>
        </div>

        <DockedFilters
          model={{ ...filters, fields: counted }}
          kpis={ledgerKpis(head?.total, rows.length)}
          id="movements"
          subject="Movement"
          className="hidden dock:flex"
        />
      </div>
    </>
  )
}

/// Two figures about the log as it currently stands, where a banner used to be.
///
/// The banner said, over the table, that the three hundred rows below it were
/// not the whole ledger and that its figures were not totals. It was right and
/// it was furniture: a paragraph nobody dismissed, re-read on every visit, in
/// the place a heading belongs.
///
/// These say the same thing in the panel, as numbers rather than as a warning.
/// **Postings** is the server's own count over everything the search and the
/// chips match, so it is true whatever is loaded; **Loaded** is how much of it
/// has been fetched, and Show more is directly under the table that grows it.
/// A caller that passed `count=0` gets no total, which is an em dash and never
/// a nought — this screen does not pass it, but the absence is drawn honestly
/// if it ever arrives.
function ledgerKpis(total: number | null | undefined, loaded: number) {
  if (total === undefined) return undefined
  return [
    {
      label: "Postings",
      value: total === null ? "—" : count(total),
      note:
        total === null
          ? "This read was answered without a count."
          : "Every posting the search and the filters match.",
    },
    {
      label: "Loaded",
      value: count(loaded),
      note: "Fetched so far. Show more walks the rest of the log.",
    },
  ]
}
