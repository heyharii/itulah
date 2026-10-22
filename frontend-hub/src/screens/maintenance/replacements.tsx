import { useSuspenseInfiniteQuery } from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import {
  FilePen,
  PackageCheck,
  Repeat,
  ShoppingCart,
  ThumbsUp,
  type LucideIcon,
} from "lucide-react"
import { Suspense, useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { DockTools } from "@/components/shell/dock-tools"
import { AppLink } from "@/components/ui/app-link"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { BarSpacer, ColumnsMenu } from "@/components/ui/list-chrome"
import { ListFilters } from "@/components/ui/list-filters"
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
import {
  useFilterState,
  type FilterField,
  type FilterState,
} from "@/lib/filters"
import { count, day } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import { gaReplacementBookQuery } from "@/lib/queries/ga"
import { useSheet } from "@/lib/sheets"
import { tableSetup, type TableSetup } from "@/lib/table"
import { replacementState } from "@/screens/maintenance/format"
import { ReplacementSheet } from "@/screens/maintenance/hub"
import { GlyphName } from "@/screens/maintenance/parts"
import { useFittedVisibility } from "@/screens/procurement/shared"
import { useSupplierName } from "@/screens/procurement/supplier-name"
import type { GaReplacementRow } from "@itulah/contract"

/// Replacements — the swaps: one asset replaced by another, with the reason
/// and the repair that led there.
///
/// # A happening, not a kind of asset
///
/// The register has no "replacement" class on purpose: a swap is something
/// that HAPPENED to a thing, and this book is where the happenings live. The
/// old asset and the new one are both ordinary register rows — the old one ends
/// up marked REPLACED, the new one is born when it is installed — so every
/// column here that names an asset is pointing, not copying.
///
/// # The list format, as Repairs draws it
///
/// Head, figures, tabs, one bar, a framed table (owner, 18 Oct 2026). There is
/// no button in the head: a replacement is proposed from the asset it replaces,
/// so a book with nothing in it sends the reader there and says nothing more.
/// What a swap costs is the bills that point at it, which the replacement does
/// not carry back yet, so there is no cost column.
export function Replacements() {
  const open = useSheet("replacement")
  const phone = useLayout() === "phone"

  return (
    <PageContent>
      <PageHeader title="Replacements" small />

      <Suspense
        fallback={<LoadingState>Loading the replacements…</LoadingState>}
      >
        <ReplacementBook
          phone={phone}
          selected={open.value}
          onOpen={open.open}
        />
      </Suspense>

      <ReplacementSheet
        key={open.value ?? "none"}
        replacementId={open.value}
        open={open.isOpen}
        onClose={open.close}
      />
    </PageContent>
  )
}

/// The two lists: the swaps still on their way, and the ones that are done.
type Shelf = "OPEN" | "DONE"

/// The stages a swap is open in, each with the glyph its chip wears.
const STAGES: readonly { value: string; label: string; icon: LucideIcon }[] = [
  { value: "PROPOSED", label: "Proposed", icon: FilePen },
  { value: "APPROVED", label: "Approved", icon: ThumbsUp },
  { value: "PURCHASED", label: "Purchased", icon: ShoppingCart },
  { value: "INSTALLED", label: "Installed", icon: PackageCheck },
]

/// What the book is narrowed by: the stage the open swaps stand in, as chips.
const FIELDS: FilterField[] = [
  {
    column: "stage",
    label: "Stage",
    spec: {
      kind: "option",
      single: true,
      format: (value) =>
        STAGES.find((one) => one.value === value)?.label ?? value,
      icon: (value) => STAGES.find((one) => one.value === value)?.icon,
    },
  },
]

interface ReplacementLine {
  readonly replacement: GaReplacementRow
  readonly vendor: string
  readonly state: ReturnType<typeof replacementState>
}

/// Columns a reader switches on in Columns; off at first.
const OFF_AT_FIRST = { repair: false }

/// Held at the widths their longest words need at 16px a side, measured on
/// the hub at 1440 (18 Oct). The old asset takes the rest; at 1280 the vendor,
/// then the repair, give way before the table would scroll sideways.
const COLUMNS: ColumnDef<TableSetup, ReplacementLine>[] = [
  {
    id: "asset",
    accessorFn: (row) => row.replacement.old_asset_name,
    header: "Asset",
    size: 340,
    enableHiding: false,
    meta: { grow: 250 },
    // The thing being replaced, and under it why: the only second line.
    cell: ({ row }) => (
      <GlyphName
        icon={Repeat}
        name={row.original.replacement.old_asset_name ?? "—"}
        quiet={row.original.replacement.reason}
      />
    ),
  },
  {
    id: "new",
    accessorFn: (row) => row.replacement.new_asset_name ?? "",
    header: "New asset",
    size: 248,
    meta: { priority: 2 },
    cell: ({ row }) =>
      row.original.replacement.new_asset_name === null ? (
        <span className="text-mute">—</span>
      ) : (
        <span className="block truncate">
          {row.original.replacement.new_asset_name}
        </span>
      ),
  },
  {
    id: "repair",
    accessorFn: (row) => row.replacement.repair_title ?? "",
    header: "Repair",
    size: 220,
    meta: { priority: 3 },
    cell: ({ row }) =>
      row.original.replacement.repair_title === null ? (
        <span className="text-mute">—</span>
      ) : (
        <span
          className="block truncate"
          title={row.original.replacement.repair_title}
        >
          {row.original.replacement.repair_title}
        </span>
      ),
  },
  {
    id: "vendor",
    accessorFn: (row) => row.vendor,
    header: "Vendor",
    size: 204,
    meta: { priority: 2 },
    cell: ({ row }) =>
      row.original.vendor === "" ? (
        <span className="text-mute">—</span>
      ) : (
        <span className="block truncate" title={row.original.vendor}>
          {row.original.vendor}
        </span>
      ),
  },
  {
    id: "proposed",
    accessorFn: (row) => row.replacement.proposed_on,
    header: "Proposed",
    size: 124,
    cell: ({ row }) => (
      <span className="tabular-nums">
        {day(row.original.replacement.proposed_on)}
      </span>
    ),
  },
  {
    id: "status",
    accessorFn: (row) => row.state.word,
    header: "Status",
    size: 130,
    cell: ({ row }) => (
      <Status tone={row.original.state.tone}>{row.original.state.word}</Status>
    ),
  },
]

/// The book: its figures, tabs, bar and table, read together.
function ReplacementBook({
  phone,
  selected,
  onOpen,
}: {
  phone: boolean
  selected: string | undefined
  onOpen: (replacementId: string) => void
}) {
  /// A page at a time, the next one fetched as the foot of the list nears
  /// view.
  const book = useSuspenseInfiniteQuery(gaReplacementBookQuery())
  const head = book.data.pages[0]
  const statuses = head?.facets.statuses ?? []
  const supplierName = useSupplierName()

  const [shelf, setShelf] = useState<Shelf>("OPEN")
  const filters = useFilterState(FIELDS)
  // The stage is a question of the open swaps only.
  const stage =
    shelf === "OPEN"
      ? (filters.filters.find((one) => one.column === "stage")?.values[0] ??
        null)
      : null
  const [search, setSearch] = useState("")
  const changeShelf = (next: Shelf) => {
    setShelf(next)
    filters.clear()
  }

  const lines = useMemo<ReplacementLine[]>(
    () =>
      book.data.pages.flatMap((page) =>
        page.rows.map((replacement) => ({
          replacement,
          vendor:
            replacement.supplier_id === null &&
            replacement.supplier_name === null
              ? ""
              : supplierName(
                  replacement.supplier_id,
                  replacement.supplier_name,
                  replacement.supplier_id
                ),
          state: replacementState(replacement.status),
        }))
      ),
    [book.data, supplierName]
  )

  const needle = search.trim().toLowerCase()
  const found = (line: ReplacementLine) =>
    needle === "" ||
    [
      line.replacement.old_asset_name,
      line.replacement.new_asset_name,
      line.replacement.reason,
      line.replacement.repair_title,
      line.vendor,
    ].some((part) => part?.toLowerCase().includes(needle))
  const isOpen = (line: ReplacementLine) => line.replacement.status !== "CLOSED"
  const keep = (line: ReplacementLine, skip?: "shelf" | "stage") =>
    found(line) &&
    (skip === "stage" || stage === null || line.replacement.status === stage) &&
    (skip === "shelf" || (shelf === "OPEN") === isOpen(line))
  const rows = useMemo(
    () => lines.filter((line) => keep(line)),
    // `keep` is rebuilt every render; what it reads is below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lines, needle, stage, shelf]
  )

  const whole = !book.hasNextPage
  const narrowed = needle !== "" || stage !== null
  const of = (...wanted: string[]) =>
    statuses
      .filter((one) => wanted.includes(one.value))
      .reduce((sum, one) => sum + one.count, 0)
  const proposed = of("PROPOSED")
  const running = of("APPROVED", "PURCHASED", "INSTALLED")
  const done = of("CLOSED")
  const shelfCount = (which: Shelf) =>
    whole || narrowed
      ? lines.filter(
          (line) => keep(line, "shelf") && (which === "OPEN") === isOpen(line)
        ).length
      : which === "OPEN"
        ? proposed + running
        : done
  const openCount = shelfCount("OPEN")
  const doneCount = shelfCount("DONE")

  // The stages the open swaps stand in, as chips: only the ones there are.
  const present = STAGES.filter((one) => of(one.value) > 0)
  const withCounts = useMemo<FilterField[]>(
    () =>
      shelf !== "OPEN"
        ? []
        : FIELDS.map((field) => ({
            ...field,
            spec: {
              ...field.spec,
              counted: present.map((one) => ({
                value: one.value,
                count: whole
                  ? lines.filter(
                      (line) =>
                        keep(line, "stage") &&
                        line.replacement.status === one.value
                    ).length
                  : of(one.value),
              })),
            },
          })),
    // `keep` and `of` are rebuilt every render; what they read is below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shelf, lines, whole, needle, stage, statuses]
  )
  const model: FilterState = { ...filters, fields: withCounts }

  const [sorting, setSorting] = useState<SortingState>([])
  const fit = useFittedVisibility(COLUMNS, OFF_AT_FIRST)
  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns: COLUMNS,
        getRowId: (row: ReplacementLine) => row.replacement.replacement_id,
        state: { sorting, columnVisibility: fit.shown },
        onSortingChange: setSorting,
        onColumnVisibilityChange: fit.change,
      }),
      // `fit.shown` is rebuilt every render; what it is made of is not.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [rows, sorting, fit.hidden, fit.visibility]
    )
  )

  // Nothing has ever been proposed: the figures, the tabs and the bar would
  // be controls over nothing. One quiet sentence, and the way to propose one.
  if ((head?.total ?? 0) === 0)
    return (
      <Card>
        <EmptyState
          action={
            <AppLink to="/assets" variant="ghost">
              Open Assets
            </AppLink>
          }
        >
          No replacements yet.
        </EmptyState>
      </Card>
    )

  return (
    <>
      <KpiStrip className="grid-cols-2 md:grid-cols-3 xl:grid-cols-3">
        <Kpi label="Proposed" value={count(proposed)} />
        <Kpi label="In progress" value={count(running)} />
        <Kpi label="Done" value={count(done)} />
      </KpiStrip>

      <SubTabs
        // On a phone the tab is the status chip over the bottom bar.
        className="max-md:hidden"
        tabs={[
          { value: "OPEN", label: <TabLabel text="Open" n={openCount} /> },
          { value: "DONE", label: <TabLabel text="Done" n={doneCount} /> },
        ]}
        value={shelf}
        onChange={(next) => changeShelf(next as Shelf)}
      />

      <div className="max-md:hidden">
        <Toolbar className="group/bar">
          <ListFilters
            model={model}
            search={{
              value: search,
              onChange: setSearch,
              label: "Search replacements",
            }}
          />
          <BarSpacer />
          <ColumnsMenu table={table} />
        </Toolbar>
      </div>

      <DockTools
        search={{
          value: search,
          onChange: setSearch,
          label: "Search replacements",
        }}
        filter={
          withCounts.length > 0
            ? {
                count: stage === null ? 0 : 1,
                panel: { model: filters, filterModel: model },
              }
            : undefined
        }
        status={{
          value: shelf,
          options: [
            { value: "OPEN", label: "Open", count: openCount },
            { value: "DONE", label: "Done", count: doneCount },
          ],
          onChange: (next) => changeShelf(next as Shelf),
        }}
      />

      {rows.length === 0 ? (
        <Card>
          <EmptyState>
            {narrowed
              ? "No replacement matches these filters."
              : shelf === "DONE"
                ? "No replacement has been finished yet."
                : "Nothing is on its way."}
          </EmptyState>
        </Card>
      ) : phone ? (
        <PhoneCards
          rows={rows}
          rowId={(line) => line.replacement.replacement_id}
          spec={REPLACEMENT_CARD}
          onOpen={(line) => onOpen(line.replacement.replacement_id)}
          more={book}
        />
      ) : (
        // `overflow-clip`, not `overflow-hidden`: hidden makes the card a
        // scroll box, and the heading would stick to the card instead of the
        // window.
        <Card ref={fit.ref} className="overflow-clip">
          <DataTable<ReplacementLine>
            refresh={[book]}
            table={table}
            onRowClick={(line) => onOpen(line.replacement.replacement_id)}
            isSelected={(line) => line.replacement.replacement_id === selected}
            more={book}
            // The window scrolls, not the table.
            pageScroll
            summary={{
              asset: (
                <span>
                  {count(rows.length)}{" "}
                  <span className="font-normal text-body">
                    {rows.length === 1 ? "replacement" : "replacements"}
                  </span>
                </span>
              ),
            }}
          />
        </Card>
      )}
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

/// A swap as a phone's card: the old asset and why it goes, what takes its
/// place and who supplies it, and where it stands.
const REPLACEMENT_CARD: CardSpec<ReplacementLine> = {
  title: (line) => <CardName name={line.replacement.old_asset_name ?? "—"} />,
  meta: [
    (line) => line.replacement.reason,
    (line) =>
      line.replacement.new_asset_name === null
        ? null
        : `Replaced by ${line.replacement.new_asset_name}`,
    (line) => (line.vendor === "" ? null : line.vendor),
  ],
  foot: (line) => (
    <span className="tabular-nums">
      Proposed {day(line.replacement.proposed_on)}
    </span>
  ),
  action: (line) => <Pill tone={line.state.tone}>{line.state.word}</Pill>,
}
