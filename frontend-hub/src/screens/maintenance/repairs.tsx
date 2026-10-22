import {
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseInfiniteQuery,
} from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { Plus } from "lucide-react"
import { Suspense, useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { DockTools } from "@/components/shell/dock-tools"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Fab } from "@/components/ui/fab"
import { Field, Input, Money, Select } from "@/components/ui/field"
import { Choices, Section } from "@/components/ui/form"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { BarSpacer, ColumnsMenu } from "@/components/ui/list-chrome"
import { ListFilters } from "@/components/ui/list-filters"
import { PageHeader } from "@/components/ui/page-header"
import {
  CardFigure,
  CardName,
  type CardSpec,
  PhoneCards,
} from "@/components/ui/phone-cards"
import { Pill, Status } from "@/components/ui/pill"
import { Toolbar } from "@/components/ui/segmented"
import { SheetFooter } from "@/components/ui/sheet-footer"
import { Sheet } from "@/components/ui/sheet"
import { Banner, EmptyState, LoadingState } from "@/components/ui/states"
import { SubTabs } from "@/components/ui/sub-tabs"
import { today } from "@/lib/calendar"
import {
  useFilterState,
  type FilterField,
  type FilterState,
} from "@/lib/filters"
import { count, money, moneyCompact, moneyFigure } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import {
  gaAssetHub,
  gaAssets,
  gaContracts,
  gaKeys,
  gaRepairBookQuery,
  gaRepairObjects,
  recordGaRepair,
  useGaSites,
} from "@/lib/queries/ga"
import { procurementKeys, supplierPage } from "@/lib/queries/procurement"
import { useSheet } from "@/lib/sheets"
import { tableSetup, type TableSetup } from "@/lib/table"
import {
  repairIsOpen,
  repairObjectIcon,
  repairObjectTiles,
  repairOver,
  repairState,
} from "@/screens/maintenance/format"
import { RepairSheet } from "@/screens/maintenance/hub"
import { GlyphName } from "@/screens/maintenance/parts"
import { useFittedVisibility } from "@/screens/procurement/shared"
import {
  SupplierName,
  useSupplierName,
} from "@/screens/procurement/supplier-name"
import type { GaAssetRow, GaRepairRow, GaRepairSummary } from "@itulah/contract"

/// Repairs — the book of things that broke.
///
/// # The list format, as Assets and Contracts draw it
///
/// Head, figures, tabs, one bar, a framed table (owner, 18 Oct 2026): it
/// replaced a hand-laid grid that scrolled sideways inside its card and ran
/// every long word to an ellipsis at 1440.
///
/// - The tabs are the two lists a person works from: Open (waiting for a
///   budget, approved, in progress) and Done (done, closed, cancelled).
/// - The kind of thing that broke is a row of icon chips, not a menu: the
///   server counts them (`facets.objects`) and the chips say what each answer
///   finds before anybody presses it. Where the repair happened is a picker,
///   because every site is an answer.
/// - The server narrows a repair book by site only, so the search, the kind
///   and the tab are read over the rows that have arrived; the rest come as
///   the foot of the list nears view, and the narrowing applies to them too.
///
/// # What this screen is allowed to know about money
///
/// The estimate and the approved budget are GA's own facts: they are typed
/// here, by the person filing the job. The ACTUAL is nobody's to type — it is
/// read out of Finance's posted bills that point back at the repair, so a
/// repair that has not been billed reads zero. Red on the actual means the
/// ledger has already answered, and answered high.
///
/// # One row per breakdown, not per visit
///
/// A repair is the problem ("AC cassette not cooling"), and the site is
/// required even when no single asset is — a leaking ceiling happens to a
/// building. That is what makes the cost readable per location later.
export function Repairs() {
  const open = useSheet("repair")
  const [adding, setAdding] = useState(false)
  const phone = useLayout() === "phone"

  return (
    <PageContent>
      <PageHeader
        title="Repairs"
        small
        actions={
          // On a phone the one thing this page makes is the round button over
          // the bottom bar.
          phone ? undefined : (
            <Button variant="primary" onClick={() => setAdding(true)}>
              <Plus />
              Record repair
            </Button>
          )
        }
      />

      <Fab label="Record repair" onClick={() => setAdding(true)} />

      <Suspense
        fallback={<LoadingState>Opening the repair book…</LoadingState>}
      >
        <RepairBook
          phone={phone}
          selected={open.value}
          onAdd={() => setAdding(true)}
          onOpen={open.open}
        />
      </Suspense>

      <RepairComposer
        open={adding}
        onClose={() => setAdding(false)}
        onSaved={(repairId) => {
          setAdding(false)
          open.open(repairId)
        }}
      />

      <RepairSheet
        key={open.value ?? "none"}
        repairId={open.value}
        open={open.isOpen}
        onClose={open.close}
      />
    </PageContent>
  )
}

/// The two lists: the repairs somebody is still working, and the ones that
/// are over.
type Shelf = "OPEN" | "DONE"

/// A row of the table: the repair, with its place and its state in words.
///
/// Looked up once on the row rather than in the cell, for the reason Articles
/// gives: a column sorts by what is on the screen.
interface RepairLine {
  readonly repair: GaRepairRow
  /// The site by its name — "Store 01", never `store-01`.
  readonly place: string
  /// The vendor as the company writes it.
  readonly vendor: string
  readonly state: ReturnType<typeof repairState>
}

/// Columns a reader switches on in Columns; none is off at first.
const OFF_AT_FIRST = {}

/// Held at the widths their longest figures need at 16px a side ("Rp
/// 12.345.678", "Budget Rp 1.750.000" under the estimate, "Needs approval" with
/// its dot and the › a row shows under the pointer), measured on the hub at
/// 1440 (18 Oct). The problem takes the rest; at 1280 the vendor, then the
/// location, give way before the table would scroll sideways.
const COLUMNS: ColumnDef<TableSetup, RepairLine>[] = [
  {
    id: "problem",
    accessorFn: (row) => row.repair.title,
    header: "Problem",
    size: 340,
    enableHiding: false,
    meta: { grow: 250 },
    // The problem, and under it the asset, or the kind of thing when there is
    // none: the only second line in the row. The tile is the kind's glyph.
    cell: ({ row }) => {
      const { repair } = row.original
      return (
        <GlyphName
          icon={repairObjectIcon(repair.objek)}
          name={repair.title}
          quiet={repair.asset_name ?? repair.objek_name}
        />
      )
    },
  },
  {
    id: "location",
    accessorFn: (row) => row.place,
    header: "Location",
    size: 96,
    meta: { priority: 2 },
    cell: ({ row }) => (
      <span className="block truncate" title={row.original.place}>
        {row.original.place}
      </span>
    ),
  },
  {
    id: "vendor",
    accessorFn: (row) => row.vendor,
    header: "Vendor",
    size: 204,
    meta: { priority: 3 },
    cell: ({ row }) => (
      <span className="block truncate" title={row.original.vendor}>
        {row.original.vendor}
      </span>
    ),
  },
  {
    id: "estimate",
    accessorFn: (row) => row.repair.estimated_cost_minor ?? -1,
    header: "Estimate",
    size: 140,
    meta: { align: "right" },
    // The estimate, and the approved budget under it only when it differs.
    cell: ({ row }) => {
      const { repair } = row.original
      const differs =
        repair.approved_budget_minor !== null &&
        repair.approved_budget_minor !== repair.estimated_cost_minor
      return (
        <span className="flex flex-col items-end tabular-nums">
          <Rupiah minor={repair.estimated_cost_minor} />
          {differs && (
            <span className="text-mute">
              Budget {moneyFigure(repair.approved_budget_minor)}
            </span>
          )}
        </span>
      )
    },
  },
  {
    id: "actual",
    accessorFn: (row) => row.repair.actual_cost_minor,
    header: "Actual",
    size: 124,
    meta: { align: "right" },
    // Red only once the ledger has answered above the ceiling.
    cell: ({ row }) => {
      const { over, capWord } = repairOver(row.original.repair)
      return (
        <span className="flex flex-col items-end tabular-nums">
          <span className={over ? "text-bad-fg" : undefined}>
            <Rupiah minor={row.original.repair.actual_cost_minor} />
          </span>
          {over && <span className="text-mute">Over {capWord}</span>}
        </span>
      )
    },
  },
  {
    id: "status",
    accessorFn: (row) => row.state.word,
    header: "Status",
    size: 148,
    cell: ({ row }) => (
      <Status tone={row.original.state.tone}>{row.original.state.word}</Status>
    ),
  },
]

/// What the book is narrowed by. The kind of thing that broke is the chip
/// line; the place is found by name in the search box.
const FIELDS: FilterField[] = [
  {
    column: "kind",
    label: "Kind",
    spec: {
      kind: "option",
      single: true,
      icon: (value) => (value === null ? undefined : repairObjectIcon(value)),
    },
  },
  { column: "site", label: "Location", spec: { kind: "option", single: true } },
]

/// The book: its figures, tabs, bar and table, read together. The page's head
/// and its round button stand outside, so they paint before the book arrives.
function RepairBook({
  phone,
  selected,
  onAdd,
  onOpen,
}: {
  phone: boolean
  selected: string | undefined
  onAdd: () => void
  onOpen: (repairId: string) => void
}) {
  /// A page at a time, the next one fetched as the foot of the list nears
  /// view.
  const book = useSuspenseInfiniteQuery(gaRepairBookQuery())
  const head = book.data.pages[0]
  const facets = head?.facets
  const supplierName = useSupplierName()

  const [shelf, setShelf] = useState<Shelf>("OPEN")
  const filters = useFilterState(FIELDS)
  const held = (column: string) =>
    filters.filters.find((one) => one.column === column)?.values[0] ?? null
  const kind = held("kind")
  const site = held("site")
  const [search, setSearch] = useState("")

  const siteNames = useMemo(
    () =>
      new Map(
        (facets?.sites ?? []).map((one) => [one.value, one.label ?? one.value])
      ),
    [facets]
  )
  const lines = useMemo<RepairLine[]>(
    () =>
      book.data.pages.flatMap((page) =>
        page.rows.map((repair) => ({
          repair,
          place: siteNames.get(repair.site_id) ?? repair.site_id,
          vendor: supplierName(repair.supplier_id, repair.supplier_name),
          state: repairState(repair.status),
        }))
      ),
    [book.data, siteNames, supplierName]
  )

  // What the search leaves, then what each control leaves of that: a count on
  // a chip or a tab is over everything else the bar says, so pressing it finds
  // that many.
  const needle = search.trim().toLowerCase()
  const found = (line: RepairLine) =>
    needle === "" ||
    [
      line.repair.title,
      line.repair.asset_name,
      line.repair.objek_name,
      line.repair.notes,
      line.place,
      line.vendor,
    ].some((part) => part?.toLowerCase().includes(needle))
  const keep = (line: RepairLine, skip?: "shelf" | "kind" | "site"): boolean =>
    found(line) &&
    (skip === "site" || site === null || line.repair.site_id === site) &&
    (skip === "kind" || kind === null || line.repair.objek === kind) &&
    (skip === "shelf" ||
      (shelf === "OPEN") === repairIsOpen(line.repair.status))

  const rows = useMemo(
    () => lines.filter((line) => keep(line)),
    // `keep` is rebuilt every render; what it reads is below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lines, needle, site, kind, shelf]
  )

  const whole = !book.hasNextPage
  const narrowed = needle !== "" || site !== null || kind !== null
  const statusTotal = (...wanted: string[]) =>
    (facets?.statuses ?? [])
      .filter((one) => wanted.includes(one.value))
      .reduce((sum, one) => sum + one.count, 0)
  // The tab counts are over the bar, before the tab; until every page is in
  // and the bar is narrowing, the server's own counts stand in.
  const shelfCount = (which: Shelf) =>
    whole || narrowed
      ? lines.filter(
          (line) =>
            keep(line, "shelf") &&
            (which === "OPEN") === repairIsOpen(line.repair.status)
        ).length
      : which === "OPEN"
        ? statusTotal("OPEN", "APPROVED", "IN_PROGRESS")
        : statusTotal("COMPLETED", "CLOSED", "CANCELLED")
  const openCount = shelfCount("OPEN")
  const doneCount = shelfCount("DONE")

  // Each question counts what pressing it would leave, the others held.
  const withCounts = useMemo<FilterField[]>(
    () =>
      FIELDS.map((field) =>
        field.column === "kind"
          ? {
              ...field,
              spec: {
                ...field.spec,
                format: (value: string) =>
                  (facets?.objects ?? []).find((one) => one.value === value)
                    ?.label ?? value,
                counted: (facets?.objects ?? []).map((one) => ({
                  value: one.value,
                  count: whole
                    ? lines.filter(
                        (line) =>
                          keep(line, "kind") && line.repair.objek === one.value
                      ).length
                    : one.count,
                })),
              },
            }
          : {
              ...field,
              spec: {
                ...field.spec,
                format: (value: string) => siteNames.get(value) ?? value,
                counted: (facets?.sites ?? []).map((one) => ({
                  value: one.value,
                  count: whole
                    ? lines.filter(
                        (line) =>
                          keep(line, "site") &&
                          line.repair.site_id === one.value
                      ).length
                    : one.count,
                })),
              },
            }
      ),
    // `keep` is rebuilt every render; what it reads is below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [facets, lines, whole, needle, site, kind, shelf, siteNames]
  )
  const model: FilterState = { ...filters, fields: withCounts }

  const [sorting, setSorting] = useState<SortingState>([])
  /// What fits the card: the vendor, then the location, wait their turn.
  const fit = useFittedVisibility(COLUMNS, OFF_AT_FIRST)
  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns: COLUMNS,
        getRowId: (row: RepairLine) => row.repair.repair_id,
        state: { sorting, columnVisibility: fit.shown },
        onSortingChange: setSorting,
        onColumnVisibilityChange: fit.change,
      }),
      // `fit.shown` is rebuilt every render; what it is made of is not.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [rows, sorting, fit.hidden, fit.visibility]
    )
  )

  const estimate = rows.reduce(
    (sum, line) => sum + (line.repair.estimated_cost_minor ?? 0),
    0
  )
  const actual = rows.reduce(
    (sum, line) => sum + line.repair.actual_cost_minor,
    0
  )

  return (
    <>
      {head !== undefined && (
        <Figures summary={head.summary} statuses={facets?.statuses ?? []} />
      )}

      <SubTabs
        // On a phone the tab is the status chip over the bottom bar.
        className="max-md:hidden"
        tabs={[
          { value: "OPEN", label: <TabLabel text="Open" n={openCount} /> },
          { value: "DONE", label: <TabLabel text="Done" n={doneCount} /> },
        ]}
        value={shelf}
        onChange={(next) => setShelf(next as Shelf)}
      />

      {/* One bar: the search (which also finds where it broke), then Columns
          at the right; the kind of thing that broke is the chip line under
          it. On a phone they are the dock's. */}
      <div className="max-md:hidden">
        <Toolbar className="group/bar">
          <ListFilters
            model={model}
            search={{
              value: search,
              onChange: setSearch,
              label: "Search repairs",
            }}
          />
          <BarSpacer />
          <ColumnsMenu table={table} />
        </Toolbar>
      </div>

      <DockTools
        search={{ value: search, onChange: setSearch, label: "Search repairs" }}
        filter={{
          count: filters.filters.length,
          panel: { model: filters, filterModel: model },
        }}
        status={{
          value: shelf,
          options: [
            { value: "OPEN", label: "Open", count: openCount },
            { value: "DONE", label: "Done", count: doneCount },
          ],
          onChange: (next) => setShelf(next as Shelf),
        }}
      />

      {rows.length === 0 ? (
        <Card>
          <EmptyState
            action={
              narrowed || (head?.total ?? 0) > 0 ? undefined : (
                <Button variant="ghost" onClick={onAdd}>
                  Record the first one
                </Button>
              )
            }
          >
            {narrowed
              ? "No repair matches these filters."
              : (head?.total ?? 0) === 0
                ? "No repairs recorded yet."
                : shelf === "DONE"
                  ? "No repair has been finished yet."
                  : "Nothing is waiting."}
          </EmptyState>
        </Card>
      ) : phone ? (
        <PhoneCards
          rows={rows}
          rowId={(line) => line.repair.repair_id}
          spec={REPAIR_CARD}
          onOpen={(line) => onOpen(line.repair.repair_id)}
          more={book}
        />
      ) : (
        // `overflow-clip`, not `overflow-hidden`: hidden makes the card a
        // scroll box, and the heading would stick to the card instead of the
        // window.
        <Card ref={fit.ref} className="overflow-clip">
          <DataTable<RepairLine>
            refresh={[book]}
            table={table}
            onRowClick={(line) => onOpen(line.repair.repair_id)}
            isSelected={(line) => line.repair.repair_id === selected}
            more={book}
            // The window scrolls, not the table.
            pageScroll
            summary={{
              problem: (
                <span>
                  {count(rows.length)}{" "}
                  <span className="font-normal text-body">
                    {rows.length === 1 ? "repair" : "repairs"}
                  </span>
                </span>
              ),
              estimate: <Rupiah minor={estimate} />,
              actual: <Rupiah minor={actual} />,
            }}
          />
        </Card>
      )}
    </>
  )
}

/// A figure in a money column. Whole rupiah while it fits the column, compact
/// (the exact figure on hover) once it is past a hundred million.
function Rupiah({ minor }: { minor: number | null }) {
  return minor !== null && minor >= 100_000_000 ? (
    <span className="tabular-nums" title={money(minor)}>
      {moneyCompact(minor)}
    </span>
  ) : (
    <span className="tabular-nums">{money(minor)}</span>
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

/// The figures the book is managed by. The stage counts are the server's, over
/// the WHOLE book — the table pages as it scrolls, and a strip summed over the
/// rows it happens to hold would change with the scroll position — and so are
/// the over-budget count and the year's actual. The actual is Finance's: it
/// counts once a bill posted against a repair, so it reads zero until then.
function Figures({
  summary,
  statuses,
}: {
  summary: GaRepairSummary
  statuses: readonly { readonly value: string; readonly count: number }[]
}) {
  const of = (...wanted: string[]) =>
    statuses
      .filter((one) => wanted.includes(one.value))
      .reduce((sum, one) => sum + one.count, 0)
  return (
    <KpiStrip className="grid-cols-2 md:grid-cols-3 xl:grid-cols-5">
      <Kpi label="Open" value={count(of("OPEN", "APPROVED", "IN_PROGRESS"))} />
      <Kpi label="Waiting for approval" value={count(of("OPEN"))} />
      <Kpi label="In progress" value={count(of("IN_PROGRESS"))} />
      <Kpi
        label="Over budget"
        value={
          summary.over > 0 ? (
            <span className="text-bad-fg">{count(summary.over)}</span>
          ) : (
            count(summary.over)
          )
        }
      />
      <Kpi
        label="Actual this year"
        value={moneyCompact(summary.actual_this_year_minor)}
        title={money(summary.actual_this_year_minor)}
      />
    </KpiStrip>
  )
}

/// A repair as a phone's card: the problem over what and where it is and who is
/// fixing it, the estimate it leads with, the actual under the hairline (red
/// when the ledger has already answered high), and where the job stands.
const REPAIR_CARD: CardSpec<RepairLine> = {
  title: (line) => <CardName name={line.repair.title} />,
  meta: [
    (line) =>
      [line.repair.asset_name ?? line.repair.objek_name, line.place]
        .filter((part) => part !== "")
        .join(" · "),
    (line) => line.vendor,
  ],
  lead: (line) => (
    <CardFigure
      value={
        <span title={money(line.repair.estimated_cost_minor)}>
          {moneyCompact(line.repair.estimated_cost_minor)}
        </span>
      }
      caption="Estimate"
    />
  ),
  foot: (line) => {
    const { over, capWord } = repairOver(line.repair)
    return (
      <span className="tabular-nums">
        Actual{" "}
        <span className={over ? "text-bad-fg" : undefined}>
          {moneyCompact(line.repair.actual_cost_minor)}
        </span>
        {over && <span className="text-bad-fg"> · over {capWord}</span>}
      </span>
    )
  },
  action: (line) => <Pill tone={line.state.tone}>{line.state.word}</Pill>,
}

/// Recording a repair, the way the prototype's form asks for it.
///
/// # Asset first, object follows
///
/// Name an asset and the object (and the site) come from it: the server
/// derives the object from the asset's class, so the form hides the choice
/// it would only be second-guessing. No asset — a ceiling, a paint job — and
/// the object and site are the human's to give, because the cost still has
/// to land somewhere readable.
///
/// `presetAssetId` is the asset sheet asking for a repair of ITS asset: the
/// asset is chosen already and stays locked, and the object and the site follow
/// it exactly as they do for any asset.
export function RepairComposer({
  open,
  onClose,
  onSaved,
  presetAssetId,
}: {
  open: boolean
  onClose: () => void
  onSaved: (repairId: string) => void
  presetAssetId?: string
}) {
  const client = useQueryClient()
  const fresh = (): Record<string, string> =>
    presetAssetId === undefined ? {} : { asset: presetAssetId }
  const [form, setForm] = useState<Record<string, string>>(fresh)
  const [problems, setProblems] = useState<Record<string, string>>({})
  const set = (key: string, value: string) => {
    // Editing a field takes its error back (brief §10.2): a problem sentence
    // survives only while the field itself is still wrong.
    setProblems((current) => ({ ...current, [key]: "" }))
    setForm((current) => ({ ...current, [key]: value }))
  }

  const assetId = form.asset ?? ""

  // The registered things, for the Asset picker — the same cached answer the
  // register reads, so a name here is a name there.
  const assets = useQuery({
    queryKey: gaKeys.assets({}),
    queryFn: ({ signal }) => gaAssets({ limit: 200 }, signal),
    enabled: open,
    staleTime: 5 * 60 * 1000,
  })

  // Sites, from GA's own list — the same one the asset register and the
  // contract composer offer, because a site is a site in every form.
  const { sites: siteOptions } = useGaSites(open)
  const siteName = (siteId: string) =>
    siteOptions.find((one) => one.value === siteId)?.label ?? siteId

  // The eleven objects — the server's list, the same one the request is
  // validated against.
  const objects = useQuery({
    queryKey: gaKeys.repairObjects(),
    queryFn: ({ signal }) => gaRepairObjects(signal),
    enabled: open,
    staleTime: 5 * 60 * 1000,
  })

  // The vendors, from the book of parties that send bills.
  const vendors = useQuery({
    queryKey: [...procurementKeys.suppliers(), "book", "EXPENSE"],
    queryFn: ({ signal }) => supplierPage({ category: "EXPENSE" }, signal),
    enabled: open,
    staleTime: 5 * 60 * 1000,
  })

  // Maintenance contracts, for the one optional field that says "this is
  // covered": a repair under contract still gets recorded, so the cost is
  // not invented later — the contract is what the bills belong to.
  const contracts = useQuery({
    queryKey: gaKeys.contracts({ type: "JASA_MAINTENANCE" }),
    queryFn: ({ signal }) =>
      gaContracts({ type: "JASA_MAINTENANCE", limit: 50 }, signal),
    enabled: open,
    staleTime: 5 * 60 * 1000,
  })

  // The preset asset, from the sheet that asked (already cached): it gives the
  // locked field its name and the repair its site even when the asset is past
  // the first page of the list above.
  const preset = useQuery({
    queryKey: gaKeys.asset(presetAssetId ?? ""),
    queryFn: ({ signal }) => gaAssetHub(presetAssetId ?? "", signal),
    enabled: open && presetAssetId !== undefined,
    staleTime: 5 * 60 * 1000,
  })

  const asset =
    (assets.data?.rows ?? []).find(
      (one: GaAssetRow) => one.asset_id === assetId
    ) ??
    (preset.data?.asset.asset_id === assetId ? preset.data?.asset : undefined)

  const save = useMutation({
    mutationFn: () =>
      recordGaRepair({
        // The site follows the asset when there is one; without an asset it
        // is the human's answer, and it is what makes the cost readable per
        // location either way.
        site_id: asset !== undefined ? asset.site_id : (form.site ?? ""),
        asset_id: assetId === "" ? null : assetId,
        objek: assetId === "" ? (form.objek ?? null) : null,
        title: (form.title ?? "").trim(),
        supplier_id: form.vendor ?? "",
        contract_id: form.contract === "" ? null : (form.contract ?? null),
        task_id: null,
        inspection_id: null,
        estimated_cost_minor:
          (form.estimate ?? "") === "" ? null : Number(form.estimate),
        failure_at: form.failure_at ?? today(),
        notes: (form.notes ?? "").trim() === "" ? null : form.notes?.trim(),
      }),
    onSuccess: (row) => {
      void client.invalidateQueries({ queryKey: gaKeys.all })
      setForm(fresh())
      onSaved(row.repair_id)
    },
  })

  const submit = () => {
    const next: Record<string, string> = {}
    if ((form.title ?? "").trim() === "")
      next.title = "Enter the problem first."
    if (presetAssetId !== undefined && asset === undefined)
      next.asset = "Reading the asset — try again in a moment."
    if (assetId === "" && (form.objek ?? "") === "")
      next.objek = "Choose the object first."
    if (assetId === "" && (form.site ?? "") === "")
      next.site = "Choose a location first."
    if ((form.vendor ?? "") === "") next.vendor = "Choose a vendor first."
    if (Object.keys(next).length > 0) {
      setProblems(next)
      return
    }
    save.mutate()
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      size="wide"
      title="New repair"
      footer={
        <SheetFooter
          onCancel={onClose}
          primary={{
            label: "Record repair",
            pending: save.isPending,
            onClick: submit,
          }}
        />
      }
    >
      <div className="flex flex-col gap-5">
        {save.error instanceof Error && (
          <Banner tone="bad">{save.error.message}</Banner>
        )}

        <Section title="Problem">
          <Field label="Problem" required problem={problems.title || undefined}>
            <Input
              value={form.title ?? ""}
              onChange={(event) => set("title", event.target.value)}
              autoFocus
            />
          </Field>
        </Section>

        <Section title="Asset and object">
          <Field label="Asset" problem={problems.asset || undefined}>
            {presetAssetId !== undefined ? (
              <Select
                value={presetAssetId}
                onChange={() => undefined}
                aria-label="Asset"
                disabled
              >
                <option value={presetAssetId}>
                  {asset === undefined
                    ? "This asset"
                    : `${asset.name} · ${asset.asset_number}`}
                </option>
              </Select>
            ) : (
              <Select
                value={form.asset ?? ""}
                onChange={(next) => set("asset", next)}
                aria-label="Asset"
              >
                <option value="">No asset: building, painting, etc.</option>
                {(assets.data?.rows ?? [])
                  .filter((one: GaAssetRow) => one.status !== "DRAFT")
                  .map((one: GaAssetRow) => (
                    <option key={one.asset_id} value={one.asset_id}>
                      {one.name} · {one.asset_number} · {siteName(one.site_id)}
                    </option>
                  ))}
              </Select>
            )}
          </Field>

          {asset === undefined && presetAssetId === undefined && (
            <Field
              label="Object"
              required
              problem={problems.objek || undefined}
            >
              <Choices
                label="Object"
                columns={3}
                // Two across on a phone, so eleven kinds are not a screen and
                // a half of single tiles.
                className="grid-cols-2"
                value={form.objek ?? ""}
                onChange={(next) => set("objek", next)}
                options={repairObjectTiles(objects.data ?? [])}
              />
            </Field>
          )}
        </Section>

        <Section title="Location and vendor">
          {asset === undefined && presetAssetId === undefined && (
            <Field
              label="Location"
              required
              problem={problems.site || undefined}
            >
              <Select
                value={form.site ?? ""}
                onChange={(next) => set("site", next)}
                aria-label="Location"
              >
                <option value="">Choose…</option>
                {siteOptions.map((one) => (
                  <option key={one.value} value={one.value}>
                    {one.label}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field label="Vendor" required problem={problems.vendor || undefined}>
            <Select
              value={form.vendor ?? ""}
              onChange={(next) => set("vendor", next)}
              aria-label="Vendor"
            >
              <option value="">Choose a vendor…</option>
              {(vendors.data?.rows ?? []).map((one) => (
                <option key={one.supplier_id} value={one.supplier_id}>
                  {one.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Contract">
            <Select
              value={form.contract ?? ""}
              onChange={(next) => set("contract", next)}
              aria-label="Contract"
            >
              <option value="">No contract</option>
              {(contracts.data?.rows ?? []).map((one) => (
                <option key={one.contract_id} value={one.contract_id}>
                  {one.contract_number ?? one.contract_id.slice(0, 8)} ·{" "}
                  {one.supplier_name === null ? (
                    one.counterparty_name
                  ) : (
                    <SupplierName
                      code={one.supplier_id}
                      name={one.supplier_name}
                    />
                  )}
                </option>
              ))}
            </Select>
          </Field>
        </Section>

        <Section title="Estimate and timing">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Cost estimate">
              <Money
                prefix="Rp"
                value={form.estimate ?? ""}
                onChange={(next) => set("estimate", next)}
              />
            </Field>
            <Field label="Reported on">
              <Input
                type="date"
                value={form.failure_at ?? today()}
                onChange={(event) => set("failure_at", event.target.value)}
              />
            </Field>
          </div>
          <Field label="Notes">
            <Input
              value={form.notes ?? ""}
              onChange={(event) => set("notes", event.target.value)}
            />
          </Field>
        </Section>
      </div>
    </Sheet>
  )
}
