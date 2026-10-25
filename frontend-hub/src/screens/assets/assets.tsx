import {
  queryOptions,
  useQuery,
  useSuspenseInfiniteQuery,
} from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import {
  CircleCheck,
  Plus,
  TriangleAlert,
  Wrench,
  type LucideIcon,
} from "lucide-react"
import { Suspense, useDeferredValue, useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { DockTools } from "@/components/shell/dock-tools"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Fab } from "@/components/ui/fab"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { ListFilters } from "@/components/ui/list-filters"
import { BarSpacer, ColumnsMenu } from "@/components/ui/list-chrome"
import { PageHeader } from "@/components/ui/page-header"
import {
  CardName,
  type CardSpec,
  PhoneCards,
} from "@/components/ui/phone-cards"
import { Pill, Status } from "@/components/ui/pill"
import { Toolbar } from "@/components/ui/segmented"
import { EmptyState, LoadingState } from "@/components/ui/states"
import { SubTabs } from "@/components/ui/sub-tabs"
import { BUILDS, BUILD_VIEWS, NOT_REGISTERED_BY_GA } from "@/lib/builds"
import {
  useFilterState,
  type Filter,
  type FilterField,
  type FilterState,
} from "@/lib/filters"
import { count } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import { gaAssetBookQuery, gaAssets, gaKeys } from "@/lib/queries/ga"
import { useSheet } from "@/lib/sheets"
import { tableSetup, type TableSetup } from "@/lib/table"
import { useDebounced } from "@/lib/use-debounced"
import { AssetThumb } from "@/screens/assets/asset-photo"
import { AssetHubSheet, gaStatusWords } from "@/screens/assets/hub"
import { RegisterAssetSheet } from "@/screens/assets/register"
import { DisposalSheet, ReplacementSheet } from "@/screens/maintenance/hub"
import {
  GONE_STATUSES,
  IN_USE_STATUSES,
  OPENING_SCOPE,
  SHELF_STATUSES,
  type Shelf,
} from "@/screens/assets/shelves"
import { useFittedVisibility } from "@/screens/procurement/shared"
import type { GaAssetRow } from "@itulah/contract"

/// Assets — the things the company owns, as the people who look after them
/// know them.
///
/// # Why GA has its own door onto the same register
///
/// Because the register answers two different questions and they belong to two
/// different people. Finance asks what an asset is WORTH: the cost, the method,
/// the monthly charge, what is left of it. GA asks where the thing IS: which
/// shop, what serial number is on the plate, is it still working, when was it
/// last serviced.
///
/// The tables were built this way from the start — `fixed_asset` carries no
/// monetary column at all and `asset_capitalization` carries the money — so
/// this screen is not a copy of Finance's. It is the half that was never given
/// a door. See migration 0070, and 0212 for the same argument about vendors.
///
/// # There is not one rupiah on this screen, on purpose
///
/// That is what makes it usable by the people who actually hold the things: a
/// shop manager can be asked to walk the floor and check the register without
/// being shown what the company carries its building at.
///
/// # What the client's own register could never answer
///
/// Their `MASTER ASSET` has 1,342 rows and names them "HANGER", "KOMPUTER",
/// "INTERIOR" — one row is a COST, not a thing. It has a `DEPARTEMEN` column
/// filled with "-" on all 1,342. So nothing anywhere says which air
/// conditioner is in which shop, or who holds which laptop. That is what this
/// screen exists to start recording — from the next purchase forward, because
/// it cannot be back-filled from a schedule of costs.
///
/// # The list format, as Purchase Orders draws it
///
/// Head, figures, tabs, one bar, a framed table (owner, 17 Oct 2026, option A
/// of `assets-options.html`). It replaced ten build chips over two rows, a
/// second row of filters and a nine-column grid that scrolled sideways inside
/// its card. The builds are the Kind menu now; its value still rides in
/// `?asset-view=`, so a facilities person who only ever wants the vehicles can
/// bookmark it and send it.
///
/// The tabs are In use and Disposed, and nothing else: "Needs details" (a
/// DRAFT a posted bill minted) is not a place of its own any more (owner,
/// 17 Oct). A draft is the company's like any other thing it holds.
export function Assets() {
  // The kind, the condition and the place are filters in the address bar,
  // the way Purchase Orders keeps them.
  const state = useFilterState(FIELDS)
  const held = (column: string) =>
    state.filters.find((one) => one.column === column)?.values[0] ?? null
  const choose = (column: string, value: string | null) =>
    state.set([
      ...state.filters.filter((one) => one.column !== column),
      ...(value === null
        ? []
        : [{ column, operator: "isAnyOf", values: [value] } as Filter]),
    ])
  const view = BUILD_VIEWS.find((one) => one.value === held("kind"))
  const condition = held("condition")
  const site = held("site")
  const open = useSheet("asset")
  // The two maintenance records an asset can start, opened over the register
  // the moment they are filed from the hub: the proposal should land the
  // proposer on the record it made, not leave them on a form that closed.
  const replacement = useSheet("replacement")
  const disposal = useSheet("disposal")
  const [shelf, setShelf] = useState<Shelf>("IN_USE")
  const [search, setSearch] = useState("")
  const [adding, setAdding] = useState(false)
  const phone = useLayout() === "phone"
  // The search goes to the server, so it waits for the typing to stop: one
  // request per word rather than one per keystroke.
  const needle = useDebounced(search.trim(), 300)

  const scope = useMemo<AssetScope>(
    () => ({
      q: needle === "" ? undefined : needle,
      site: site ?? undefined,
      // Every build the kind means. Property is two of them, because land
      // and the building on it are one question to a facilities person even
      // though the chart charges them differently; Projects is two as well.
      build: view?.builds.join(","),
      condition: condition ?? undefined,
      status: SHELF_STATUSES[shelf],
    }),
    [needle, site, view, condition, shelf]
  )

  return (
    <PageContent>
      <PageHeader
        title="Assets"
        small
        actions={
          // On a phone the one thing this page makes is its round button.
          phone ? undefined : (
            <Button variant="primary" onClick={() => setAdding(true)}>
              <Plus />
              Register asset
            </Button>
          )
        }
      />

      <Fab label="Register asset" onClick={() => setAdding(true)} />

      <Figures
        condition={condition}
        onCondition={(next) => choose("condition", next)}
      />

      <Suspense fallback={<LoadingState>Loading assets…</LoadingState>}>
        <AssetRegister
          scope={scope}
          state={state}
          shelf={shelf}
          setShelf={setShelf}
          search={search}
          setSearch={setSearch}
          phone={phone}
          selected={open.value}
          onOpen={open.open}
          onAdd={() => setAdding(true)}
        />
      </Suspense>

      <RegisterAssetSheet
        open={adding}
        // The builds the kind means, so a licence is not offered from the
        // vehicles; every build when nothing is narrowed.
        builds={(view?.builds ?? BUILDS.map((one) => one.value)).filter(
          (build) => !NOT_REGISTERED_BY_GA.includes(build)
        )}
        onClose={() => setAdding(false)}
        onRegistered={(assetId) => {
          setAdding(false)
          open.open(assetId)
        }}
      />

      <AssetHubSheet
        assetId={open.value}
        open={open.isOpen}
        onClose={open.close}
        onProposeReplacement={replacement.open}
        onRequestDisposal={disposal.open}
      />

      {/* The key remounts the sheet when a different record is opened, so its
          local state does not follow the id. It is prefixed because the two
          sheets are siblings and both are closed most of the time — two bare
          "none" keys are one duplicate key, and React says so. */}
      <ReplacementSheet
        key={`replacement:${replacement.value ?? "none"}`}
        replacementId={replacement.value}
        open={replacement.isOpen}
        onClose={replacement.close}
      />

      <DisposalSheet
        key={`disposal:${disposal.value ?? "none"}`}
        disposalId={disposal.value}
        open={disposal.isOpen}
        onClose={disposal.close}
      />
    </PageContent>
  )
}

type AssetScope = Parameters<typeof gaAssetBookQuery>[0]

/// One count, asked as a page of one row: the server's `total` is the answer.
/// Its own key under the register's prefix, so a registration or a move that
/// invalidates the register refreshes the figures with it.
const assetCount = (scope: AssetScope) =>
  queryOptions({
    queryKey: [...gaKeys.assets(scope), "count"] as const,
    queryFn: ({ signal }) => gaAssets({ ...scope, limit: 1 }, signal),
  })

/// The figures over the register: how many things the company holds, and the
/// three states that are somebody's work — a thing to service, a thing that
/// is broken, a thing waiting on a disposal decision.
///
/// Counted over everything in use, not over what the bar narrows to: the
/// figures describe the register, the tab counts and the foot describe the
/// list. They do not hold the page up while they are read.
function Figures({
  condition,
  onCondition,
}: {
  /// The condition the list is narrowed to. Needs service and Broken are the
  /// condition filter: pressing one narrows the list, pressing it again clears
  /// it, so the bar carries no second control for the same answer.
  condition: string | null
  onCondition: (condition: string | null) => void
}) {
  const toggle = (value: string) =>
    onCondition(condition === value ? null : value)
  const lead = (on: boolean, text: string) => (
    <span className={on ? "text-accent" : undefined}>{text}</span>
  )
  const held = useQuery(assetCount(OPENING_SCOPE))
  const service = useQuery(
    assetCount({ ...OPENING_SCOPE, condition: "PERLU_SERVIS" })
  )
  const broken = useQuery(assetCount({ ...OPENING_SCOPE, condition: "RUSAK" }))
  const leaving = held.data?.facets.statuses.find(
    (facet) => facet.value === "DISPOSAL_REQUESTED"
  )
  const figure = (n: number | undefined) => (n === undefined ? "—" : count(n))
  const brokenTotal = broken.data?.total
  return (
    <KpiStrip className="grid-cols-2 md:grid-cols-4 xl:grid-cols-4">
      <Kpi label="Assets" value={figure(held.data?.total)} />
      <Kpi
        label={lead(condition === "PERLU_SERVIS", "Needs service")}
        value={figure(service.data?.total)}
        onClick={() => toggle("PERLU_SERVIS")}
      />
      <Kpi
        label={lead(condition === "RUSAK", "Broken")}
        onClick={() => toggle("RUSAK")}
        value={
          brokenTotal !== undefined && brokenTotal > 0 ? (
            <span className="text-bad-fg">{count(brokenTotal)}</span>
          ) : (
            figure(brokenTotal)
          )
        }
      />
      <Kpi
        label="Disposal requested"
        value={figure(
          held.data === undefined ? undefined : (leaving?.count ?? 0)
        )}
      />
    </KpiStrip>
  )
}

/// A row of the table: the asset, with its place and its kind in words.
///
/// Looked up once on the row rather than in the cell, for the reason Articles
/// gives: a column sorts by what is on the screen.
interface AssetLine {
  readonly asset: GaAssetRow
  /// "Cikupa · Ruang stok": the site by its name, and where in it.
  readonly place: string
  /// The kind the Kind menu calls it — "Technical", "Property" — so the
  /// column and the menu speak one word.
  readonly kind: string
}

/// The kind a build is read as. A build no view names falls back to the
/// build's own label rather than to nothing.
function kindOf(build: string): string {
  return (
    BUILD_VIEWS.find((one) =>
      one.builds.includes(build as (typeof one.builds)[number])
    )?.label ??
    BUILDS.find((one) => one.value === build)?.label ??
    build
  )
}

/// Columns a reader switches on in Columns; off at first.
const OFF_AT_FIRST = { class: false, finance: false }

/// The table's columns, per tab: the last one is the asset's condition while
/// it is held and how it left once it has gone.
///
/// Held at the widths their longest words need at 16px a side ("Operating
/// equipment", "Needs service" with its dot and the › a row shows under the
/// pointer), measured on the hub at 1440 (17 Oct). The asset's name takes the
/// rest, never under 220px, so the five fit a 1280 window without the table
/// scrolling sideways.
function columnsFor(shelf: Shelf): ColumnDef<TableSetup, AssetLine>[] {
  return [
    {
      id: "asset",
      accessorFn: (row) => row.asset.name,
      header: "Asset",
      size: 320,
      meta: { grow: 220 },
      // The name, and under it the code and the serial on the plate: one
      // quiet line, the only second line in the row.
      cell: ({ row }) => {
        const { asset } = row.original
        return (
          <span className="flex min-w-0 items-center gap-3">
            <AssetThumb assetId={asset.asset_id} build={asset.build} />
            <span className="flex min-w-0 flex-col">
              <span className="truncate font-medium text-ink">{asset.name}</span>
              <span className="truncate text-mute">
                {asset.serial_number === null
                  ? asset.asset_number
                  : `${asset.asset_number} · ${asset.serial_number}`}
              </span>
            </span>
          </span>
        )
      },
    },
    {
      id: "kind",
      accessorFn: (row) => row.kind,
      header: "Kind",
      size: 184,
      cell: ({ row }) => (
        <span className="block truncate">{row.original.kind}</span>
      ),
    },
    {
      // The client's own class ("Air Conditioner", "FFE Komputer"): what
      // Finance books it under. Off at first.
      id: "class",
      accessorFn: (row) => row.asset.class_name,
      header: "Class",
      size: 200,
      cell: ({ row }) => (
        <span className="block truncate" title={row.original.asset.class_name}>
          {row.original.asset.class_name}
        </span>
      ),
    },
    {
      id: "location",
      accessorFn: (row) => row.place,
      header: "Location",
      size: 180,
      cell: ({ row }) => (
        <span className="block truncate" title={row.original.place}>
          {row.original.place}
        </span>
      ),
    },
    {
      id: "holder",
      accessorFn: (row) => row.asset.holder ?? "",
      header: "Holder",
      size: 156,
      cell: ({ row }) =>
        row.original.asset.holder === null ? (
          <span className="text-mute">—</span>
        ) : (
          <span className="block truncate">{row.original.asset.holder}</span>
        ),
    },
    {
      // Whether Finance has decided what the thing is in its books. Off at
      // first: it is Finance's question, asked on Finance's register.
      id: "finance",
      accessorFn: (row) => row.asset.finance_decision ?? "",
      header: "Finance",
      size: 160,
      cell: ({ row }) =>
        row.original.asset.finance_decision === null ? (
          <Status tone="warn">Not assessed</Status>
        ) : (
          <Status>Assessed</Status>
        ),
    },
    {
      id: "state",
      accessorFn: (row) => stateOf(row.asset).word,
      header: shelf === "GONE" ? "Status" : "Condition",
      size: 168,
      cell: ({ row }) => {
        const state = stateOf(row.original.asset)
        return <Status tone={state.tone}>{state.word}</Status>
      },
    },
  ]
}

const COLUMNS: Record<Shelf, ColumnDef<TableSetup, AssetLine>[]> = {
  IN_USE: columnsFor("IN_USE"),
  GONE: columnsFor("GONE"),
}

/// The asset's last cell. A thing on its way out, or still being built, says
/// that rather than how it is: "Good" on a renovation half done, or on a
/// printer waiting to be written off, answers a question nobody asked.
function stateOf(asset: GaAssetRow): {
  word: string
  tone: "neutral" | "warn" | "bad" | "done"
} {
  switch (asset.status) {
    case "DISPOSAL_REQUESTED":
      return { word: "Disposal requested", tone: "warn" }
    case "IN_PROGRESS":
      return { word: "In progress", tone: "neutral" }
    case "REPLACED":
    case "DISPOSED":
      return { word: gaStatusWords(asset.status), tone: "done" }
    default:
      return {
        word: conditionWords(asset.condition),
        tone:
          asset.condition === "RUSAK"
            ? "bad"
            : asset.condition === "PERLU_SERVIS"
              ? "warn"
              : "neutral",
      }
  }
}

function AssetRegister({
  scope,
  state,
  shelf,
  setShelf,
  search,
  setSearch,
  phone,
  selected,
  onOpen,
  onAdd,
}: {
  scope: AssetScope
  state: FilterState
  shelf: Shelf
  setShelf: (shelf: Shelf) => void
  search: string
  setSearch: (search: string) => void
  phone: boolean
  selected: string | undefined
  onOpen: (assetId: string) => void
  onAdd: () => void
}) {
  // The list being replaced stays on screen while the next is read, so a
  // keystroke or a tab does not empty the table to a loading line.
  const asked = useDeferredValue(scope)
  const register = useSuspenseInfiniteQuery(gaAssetBookQuery(asked))
  const head = register.data.pages[0]
  const sites = useMemo(() => head?.facets.sites ?? [], [head])
  const conditions = head?.facets.conditions ?? []

  const rows = useMemo<AssetLine[]>(() => {
    const names = new Map(
      sites.map((one) => [one.value, one.label ?? one.value])
    )
    return register.data.pages.flatMap((page) =>
      page.rows.map((asset) => {
        const where = names.get(asset.site_id) ?? asset.site_id
        return {
          asset,
          place:
            asset.sub_location === null
              ? where
              : `${where} · ${asset.sub_location}`,
          kind: kindOf(asset.build),
        }
      })
    )
  }, [register.data, sites])

  /// A tab's count: over what the search leaves, whatever else is narrowed.
  const shelfCount = (statuses: readonly string[]) =>
    (head?.facets.statuses ?? [])
      .filter((facet) => statuses.includes(facet.value))
      .reduce((sum, facet) => sum + facet.count, 0)
  const inUse = shelfCount(IN_USE_STATUSES)
  const gone = shelfCount(GONE_STATUSES)

  const [sorting, setSorting] = useState<SortingState>([])
  const columns = COLUMNS[shelf]
  /// What fits the card: Class and Finance wait behind Columns.
  const fit = useFittedVisibility(columns, OFF_AT_FIRST)
  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns,
        getRowId: (row: AssetLine) => row.asset.asset_id,
        state: { sorting, columnVisibility: fit.shown },
        onSortingChange: setSorting,
        onColumnVisibilityChange: fit.change,
      }),
      // `fit.shown` is rebuilt every render; what it is made of is not.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [rows, columns, sorting, fit.hidden, fit.visibility]
    )
  )

  const narrowed = scope.q !== undefined || state.filters.length > 0

  // What each answer leaves, from the server's own facets: they count the
  // searched set, so a number stays put while another chip is on.
  const builds = new Map(
    (head?.facets.builds ?? []).map((one) => [one.value, one.count])
  )
  const siteWords = new Map(sites.map((one) => [one.value, one.label]))
  const withCounts = useMemo<FilterField[]>(
    () =>
      FIELDS.map((field) => {
        switch (field.column) {
          case "kind":
            return {
              ...field,
              spec: {
                ...field.spec,
                counted: BUILD_VIEWS.map((one) => ({
                  value: one.value,
                  count: one.builds.reduce(
                    (sum, build) => sum + (builds.get(build) ?? 0),
                    0
                  ),
                })),
              },
            }
          case "condition":
            return {
              ...field,
              spec: {
                ...field.spec,
                counted: conditions.map((one) => ({
                  value: one.value,
                  count: one.count,
                })),
              },
            }
          default:
            return {
              ...field,
              spec: {
                ...field.spec,
                format: (value: string) => siteWords.get(value) ?? value,
                counted: sites.map((one) => ({
                  value: one.value,
                  count: one.count,
                })),
              },
            }
        }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [head]
  )
  const model: FilterState = { ...state, fields: withCounts }

  return (
    <>
      <SubTabs
        // On a phone the tab is the status chip over the bottom bar.
        className="max-md:hidden"
        tabs={[
          { value: "IN_USE", label: <TabLabel text="In use" n={inUse} /> },
          { value: "GONE", label: <TabLabel text="Disposed" n={gone} /> },
        ]}
        value={shelf}
        onChange={(next) => setShelf(next as Shelf)}
      />

      {/* One bar: the search (which also finds a place), then Columns at
          the right; the kinds are the chips under it. On a phone they are
          the dock's. */}
      <div className="max-md:hidden">
        <Toolbar className="group/bar">
          <ListFilters
            model={model}
            search={{
              value: search,
              onChange: setSearch,
              label: "Search assets",
            }}
          />
          <BarSpacer />
          <ColumnsMenu table={table} />
        </Toolbar>
      </div>

      <DockTools
        search={{ value: search, onChange: setSearch, label: "Search assets" }}
        filter={{
          count: state.filters.length,
          panel: { model: state, filterModel: model },
        }}
        status={{
          value: shelf,
          options: [
            { value: "IN_USE", label: "In use", count: inUse },
            { value: "GONE", label: "Disposed", count: gone },
          ],
          onChange: (next) => setShelf(next as Shelf),
        }}
      />

      <div aria-busy={asked !== scope || undefined} className="list-swap">
        {rows.length === 0 ? (
          <Card>
            <EmptyState
              action={
                narrowed || shelf === "GONE" ? undefined : (
                  <Button variant="ghost" onClick={onAdd}>
                    Register the first one
                  </Button>
                )
              }
            >
              {narrowed
                ? "No asset matches these filters."
                : shelf === "GONE"
                  ? "Nothing has been disposed yet."
                  : "Nothing here yet."}
            </EmptyState>
          </Card>
        ) : phone ? (
          <PhoneCards
            rows={rows}
            rowId={(row) => row.asset.asset_id}
            spec={ASSET_CARD}
            onOpen={(row) => onOpen(row.asset.asset_id)}
            more={register}
          />
        ) : (
          // `overflow-clip`, not `overflow-hidden`: hidden makes the card a
          // scroll box, and the heading would stick to the card instead of
          // the window.
          <Card ref={fit.ref} className="overflow-clip">
            <DataTable<AssetLine>
              refresh={[register]}
              table={table}
              onRowClick={(row) => onOpen(row.asset.asset_id)}
              isSelected={(row) => row.asset.asset_id === selected}
              more={register}
              // The window scrolls, not the table.
              pageScroll
              summary={{
                asset: (
                  <span>
                    {count(head?.total ?? rows.length)}{" "}
                    <span className="font-normal text-body">
                      {(head?.total ?? rows.length) === 1 ? "asset" : "assets"}
                    </span>
                  </span>
                ),
              }}
            />
          </Card>
        )}
      </div>
    </>
  )
}

/// A tab's word and its count, the count quiet (as Articles draws it).
function TabLabel({ text, n }: { text: string; n: number }) {
  return (
    <span>
      {text}
      <span className="ml-1.5 text-body tabular-nums">{count(n)}</span>
    </span>
  )
}

/// The same row as a phone card: the name and code, what it is and where,
/// who holds it; the kind in the foot and its state where the thumb rests.
const ASSET_CARD: CardSpec<AssetLine> = {
  title: (row) => (
    <CardName name={row.asset.name} code={row.asset.asset_number} />
  ),
  meta: [
    (row) => `${row.asset.class_name} · ${row.place}`,
    (row) => (row.asset.holder === null ? null : `Held by ${row.asset.holder}`),
  ],
  foot: (row) => <span>{row.kind}</span>,
  action: (row) => {
    const state = stateOf(row.asset)
    return (
      <Pill
        tone={
          state.tone === "bad" || state.tone === "warn" ? state.tone : "neutral"
        }
      >
        {state.word}
      </Pill>
    )
  },
}

/// The three answers to "how is it", in the order a facilities person asks
/// them: the same three, in the same words, as the Register asset form.
const CONDITIONS: readonly {
  readonly value: string
  readonly label: string
  readonly icon: LucideIcon
}[] = [
  { value: "BAIK", label: "Good", icon: CircleCheck },
  { value: "PERLU_SERVIS", label: "Needs service", icon: Wrench },
  { value: "RUSAK", label: "Broken", icon: TriangleAlert },
]

/// What the register is narrowed by. The kind is the chip line; the condition
/// and the place are found by name in the search box.
const FIELDS: FilterField[] = [
  {
    column: "kind",
    label: "Kind",
    spec: {
      kind: "option",
      single: true,
      format: (value) =>
        BUILD_VIEWS.find((one) => one.value === value)?.label ?? value,
      icon: (value) => BUILD_VIEWS.find((one) => one.value === value)?.icon,
    },
  },
  {
    column: "condition",
    label: "Condition",
    spec: {
      kind: "option",
      single: true,
      format: conditionWords,
      icon: (value) => CONDITIONS.find((one) => one.value === value)?.icon,
    },
  },
  { column: "site", label: "Location", spec: { kind: "option", single: true } },
]

function conditionWords(condition: string): string {
  switch (condition) {
    case "PERLU_SERVIS":
      return "Needs service"
    case "RUSAK":
      return "Broken"
    default:
      return "Good"
  }
}
