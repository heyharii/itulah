import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { Plus, type LucideIcon } from "lucide-react"
import { Suspense, useDeferredValue, useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { DockTools } from "@/components/shell/dock-tools"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Fab } from "@/components/ui/fab"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { BarSpacer, ColumnsMenu } from "@/components/ui/list-chrome"
import { ListFilters } from "@/components/ui/list-filters"
import { PageHeader } from "@/components/ui/page-header"
import {
  CardName,
  type CardSpec,
  PhoneCards,
} from "@/components/ui/phone-cards"
import { Pill } from "@/components/ui/pill"
import { Toolbar } from "@/components/ui/segmented"
import { EmptyState, LoadingState } from "@/components/ui/states"
import {
  useFilterState,
  type FilterField,
  type FilterState,
} from "@/lib/filters"
import { count } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import { useSheet } from "@/lib/sheets"
import { tableSetup, type TableSetup } from "@/lib/table"
import { cn } from "@/lib/utils"
import { LocationHubSheet } from "@/screens/locations/hub"
import {
  compareKinds,
  detailsMissing,
  kindIcon,
  kindWords,
  type Place,
  placeQuery,
  placesQuery,
  usePlaces,
} from "@/screens/locations/places-data"
import { useFittedVisibility } from "@/screens/procurement/shared"
import { OpenStoresSheet } from "@/screens/setup/open-stores-sheet"
import type { GaLocationRow } from "@itulah/contract"

/// Sites — the places the company operates from, as facilities rather than
/// as an accounting dimension.
///
/// # A list of PLACES, not of the details that happen to exist
///
/// `site` is the company's own list; GA adds a second, one-to-one side to it
/// (`ga_location_detail`). The server LEFT JOINs the two, so a site nobody has
/// written an address for still appears, with "—" in the address column and
/// "Details missing" in its sheet. Hiding it would make this a list of the
/// details that exist, which is exactly the list that cannot answer "what
/// have we not filled in yet" — so that is the figure over the table, and
/// pressing it is the filter.
///
/// # The list format, as Purchase Orders draws it
///
/// Head, figures, one bar, a framed table (owner, 17 Oct 2026, option A · Fit
/// of `sites-options.html`). It replaced a 74rem div grid whose Open repairs
/// and Billed columns were cut off at 1440, a Type menu mixing GA's "Toko
/// ruko" with the register's STORE, and the internal id under every name.
///
/// - The name is the UNIT's ("Cikupa"), because that is what people call the
///   shop, with the unit's code under it. The site's own code (`C001-TOKO`)
///   is not on the wire, so the unit's stands in.
/// - Type is a row of chips with a count each, not a menu: Head office and
///   Store are the whole answer, and they are better seen than opened.
/// - Billed this month is Finance's figure and lives in the sheet.
/// - The search runs here, over every place, because what people type is the
///   unit's name and the server does not know it.
///
/// # Add store, and no "Tambah site"
///
/// A place is made by a store or the warehouse being opened, not by GA
/// writing a row here, and adding a second head office is the owner's decision
/// (brief §2.5). So the one way to add a place is Add store — the same list
/// and the same write as the setup wizard's second step, which makes the unit,
/// its shop site and its pools together (`screens/setup/open-stores-sheet.tsx`).
/// Everything else written here is the facilities detail BESIDE a place that
/// already exists — the address, the building, the floor area, who to ring.
export function Locations() {
  // The title stands at once; the places wait for the list and stream in with
  // it (the server starts the read too). The head's button comes with it.
  return (
    <Suspense
      fallback={
        <PageContent>
          <PageHeader title="Sites" small />
          <LoadingState>Loading sites…</LoadingState>
        </PageContent>
      }
    >
      <LocationBook />
    </Suspense>
  )
}

/// A figure of the strip that is also a filter: the sites that need somebody.
/// What the register is narrowed by: the type of site, as chips.
const FIELDS: FilterField[] = [
  {
    column: "kind",
    label: "Type",
    spec: {
      kind: "option",
      single: true,
      format: kindWords,
      icon: (value) => (value === null ? undefined : kindIcon(value)),
    },
  },
]

type Focus = "missing" | "repairs" | "due"

/// A row of the table: the place and what it is, looked up once on the row
/// rather than in the cell, because a column sorts by what is on the screen.
interface PlaceLine {
  readonly row: GaLocationRow
  readonly place: Place
  /// "Store", "Head office".
  readonly kind: string
}

function LocationBook() {
  const open = useSheet("location")
  const opening = useSheet("new-stores")
  const client = useQueryClient()
  const [search, setSearch] = useState("")
  const filters = useFilterState(FIELDS)
  const kind =
    filters.filters.find((one) => one.column === "kind")?.values[0] ?? null
  const [focus, setFocus] = useState<Focus | null>(null)
  const phone = useLayout() === "phone"

  const places = useSuspenseQuery(placesQuery({}))
  const placeOf = usePlaces()

  const lines = useMemo<PlaceLine[]>(
    () =>
      places.data.map((row) => ({
        row,
        place: placeOf(row),
        kind: kindWords(row.site_kind),
      })),
    [places.data, placeOf]
  )

  // The figures describe the register, whatever the bar narrows to.
  const figures = useMemo(
    () => ({
      sites: lines.length,
      stores: lines.filter((line) => line.row.site_kind === "STORE").length,
      missing: lines.filter((line) => detailsMissing(line.row)).length,
      repairs: lines.reduce((sum, line) => sum + line.row.open_repair_count, 0),
      due: lines.reduce((sum, line) => sum + line.row.due_task_count, 0),
    }),
    [lines]
  )

  const needle = useDeferredValue(search.trim().toLowerCase())
  const found = useMemo(
    () =>
      lines.filter((line) => {
        const { row, place } = line
        if (focus === "missing" && !detailsMissing(row)) return false
        if (focus === "repairs" && row.open_repair_count === 0) return false
        if (focus === "due" && row.due_task_count === 0) return false
        if (needle === "") return true
        return [
          place.name,
          place.code,
          row.site_name,
          row.site_id,
          row.address,
          row.kind,
          row.contact_name,
          row.contact_phone,
        ].some((part) => part?.toLowerCase().includes(needle) === true)
      }),
    [lines, focus, needle]
  )
  const shown = useMemo(
    () =>
      kind === null
        ? found
        : found.filter((line) => line.row.site_kind === kind),
    [found, kind]
  )

  // The kinds in use, each with what pressing it would leave.
  const withCounts = useMemo<FilterField[]>(() => {
    const kinds = [...new Set(lines.map((line) => line.row.site_kind))].sort(
      compareKinds
    )
    return FIELDS.map((field) => ({
      ...field,
      spec: {
        ...field.spec,
        counted: kinds.map((one) => ({
          value: one,
          count: found.filter((line) => line.row.site_kind === one).length,
        })),
      },
    }))
  }, [lines, found])
  const model: FilterState = { ...filters, fields: withCounts }

  const total = lines.length
  const narrowed = needle !== "" || kind !== null || focus !== null

  const [sorting, setSorting] = useState<SortingState>([])
  /// What fits the card: nothing is given up, but the switches are Columns'.
  const fit = useFittedVisibility(COLUMNS, {})
  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: shown,
        columns: COLUMNS,
        getRowId: (line: PlaceLine) => line.row.site_id,
        state: { sorting, columnVisibility: fit.shown },
        onSortingChange: setSorting,
        onColumnVisibilityChange: fit.change,
      }),
      // `fit.shown` is rebuilt every render; what it is made of is not.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [shown, sorting, fit.hidden, fit.visibility]
    )
  )

  const toggle = (next: Focus) => setFocus(focus === next ? null : next)

  return (
    <PageContent>
      <PageHeader
        title="Sites"
        small
        actions={
          // On a phone the one thing this page makes is its round button.
          phone ? undefined : (
            <Button variant="primary" onClick={() => opening.open(true)}>
              <Plus />
              Add store
            </Button>
          )
        }
      />

      <Fab label="Add store" onClick={() => opening.open(true)} />

      <KpiStrip className="grid-cols-2 md:grid-cols-3 xl:grid-cols-5">
        <Kpi label="Sites" value={count(figures.sites)} />
        <Kpi label="Stores" value={count(figures.stores)} />
        <Kpi
          label={<Pressed on={focus === "missing"}>Details missing</Pressed>}
          value={
            figures.missing > 0 ? (
              <span className="text-warn-fg">{count(figures.missing)}</span>
            ) : (
              count(figures.missing)
            )
          }
          onClick={
            figures.missing > 0 || focus === "missing"
              ? () => toggle("missing")
              : undefined
          }
        />
        <Kpi
          label={<Pressed on={focus === "repairs"}>Open repairs</Pressed>}
          value={count(figures.repairs)}
          onClick={
            figures.repairs > 0 || focus === "repairs"
              ? () => toggle("repairs")
              : undefined
          }
        />
        <Kpi
          label={<Pressed on={focus === "due"}>Service due</Pressed>}
          value={
            figures.due > 0 ? (
              <span className="text-warn-fg">{count(figures.due)}</span>
            ) : (
              count(figures.due)
            )
          }
          onClick={
            figures.due > 0 || focus === "due" ? () => toggle("due") : undefined
          }
        />
      </KpiStrip>

      {/* One bar: the search, then Columns at the right; the type is the
          chip line under it. On a phone they are the dock's. */}
      <div className="max-md:hidden">
        <Toolbar className="group/bar">
          <ListFilters
            model={model}
            search={{
              value: search,
              onChange: setSearch,
              label: "Search sites",
            }}
          />
          <BarSpacer />
          <ColumnsMenu table={table} />
        </Toolbar>
      </div>

      <DockTools
        search={{ value: search, onChange: setSearch, label: "Search sites" }}
        filter={{
          count: filters.filters.length,
          panel: { model: filters, filterModel: model },
        }}
      />

      {shown.length === 0 ? (
        <Card>
          <EmptyState
            action={
              narrowed || total > 0 ? undefined : (
                <Button variant="ghost" onClick={() => opening.open(true)}>
                  Add the first store
                </Button>
              )
            }
          >
            {narrowed ? "No site matches these filters." : "No sites yet."}
          </EmptyState>
        </Card>
      ) : phone ? (
        <PhoneCards
          rows={shown}
          rowId={(line) => line.row.site_id}
          spec={LOCATION_CARD}
          onOpen={(line) => open.open(line.row.site_id)}
        />
      ) : (
        // `overflow-clip`, not `overflow-hidden`: hidden makes the card a
        // scroll box, and the heading would stick to the card instead of the
        // window.
        <Card ref={fit.ref} className="overflow-clip">
          <DataTable<PlaceLine>
            table={table}
            onRowClick={(line) => open.open(line.row.site_id)}
            // The sheet's read starts when the pointer rests on the row, so
            // it opens with its facts in hand.
            onRowIntent={(line) =>
              void client.prefetchQuery(placeQuery(line.row.site_id))
            }
            isSelected={(line) => line.row.site_id === open.value}
            // The window scrolls, not the table.
            pageScroll
            summary={{
              site: (
                <span>
                  {count(shown.length)}{" "}
                  <span className="font-normal text-body">
                    {shown.length === 1 ? "site" : "sites"}
                    {shown.length !== total && ` of ${count(total)}`}
                  </span>
                </span>
              ),
              assets: (
                <span className="tabular-nums">
                  {count(
                    shown.reduce((sum, line) => sum + line.row.asset_count, 0)
                  )}
                </span>
              ),
              contracts: (
                <span className="tabular-nums">
                  {count(
                    shown.reduce(
                      (sum, line) => sum + line.row.contract_count,
                      0
                    )
                  )}
                </span>
              ),
              repairs: (
                <span className="tabular-nums">
                  {count(
                    shown.reduce(
                      (sum, line) => sum + line.row.open_repair_count,
                      0
                    )
                  )}
                </span>
              ),
            }}
          />
        </Card>
      )}

      <OpenStoresSheet open={opening.isOpen} onClose={opening.close} />

      <LocationHubSheet
        key={open.value ?? "none"}
        siteId={open.value}
        open={open.isOpen}
        onClose={open.close}
      />
    </PageContent>
  )
}

/// A figure's name, in the accent while its press is the list's filter.
function Pressed({ on, children }: { on: boolean; children: React.ReactNode }) {
  return <span className={cn(on && "text-accent")}>{children}</span>
}

/// The glyph tile of a row: what kind of place it is, so the eye sorts the
/// list before it reads it. The same tile the sheets' rows wear.
function KindTile({ icon: Glyph }: { icon: LucideIcon }) {
  return (
    <span
      aria-hidden
      className="grid size-[1.875rem] shrink-0 place-items-center rounded-inner bg-soft-2 text-body"
    >
      <Glyph className="size-4 stroke-[1.7]" />
    </span>
  )
}

/// "C001 · Store": the unit's code and what kind of place it is. The code
/// waits for the units; the kind never does.
const quietOf = (line: PlaceLine) =>
  line.place.code === null ? line.kind : `${line.place.code} · ${line.kind}`

/// A figure that needs somebody is warm while it is more than nothing.
function Figure({ n, warm = false }: { n: number; warm?: boolean }) {
  return (
    <span className={cn("tabular-nums", warm && n > 0 && "text-warn-fg")}>
      {count(n)}
    </span>
  )
}

/// Held at the widths their longest words need at 16px a side ("Open
/// repairs" and the › a row shows under the pointer), measured on the hub at
/// 1440 and 1280: Address takes the rest, never under 160px, so the six fit a
/// 1280 window and the table never scrolls sideways.
const COLUMNS: ColumnDef<TableSetup, PlaceLine>[] = [
  {
    id: "site",
    accessorFn: (line) => line.place.name,
    header: "Site",
    size: 208,
    // The unit's name and, under it, its code and kind: the one quiet line.
    cell: ({ row }) => (
      <span className="flex min-w-0 items-center gap-3">
        <KindTile icon={kindIcon(row.original.row.site_kind)} />
        <span className="flex min-w-0 flex-col">
          <span className="truncate font-medium text-ink">
            {row.original.place.name}
          </span>
          <span className="truncate text-mute">{quietOf(row.original)}</span>
        </span>
      </span>
    ),
  },
  {
    id: "address",
    accessorFn: (line) => line.row.address ?? "",
    header: "Address",
    size: 300,
    meta: { grow: 160 },
    cell: ({ row }) =>
      row.original.row.address === null ? (
        <span className="text-mute">—</span>
      ) : (
        <span
          className="line-clamp-2 whitespace-normal"
          title={row.original.row.address}
        >
          {row.original.row.address}
        </span>
      ),
  },
  {
    id: "contact",
    accessorFn: (line) => line.row.contact_name ?? line.row.contact_phone ?? "",
    header: "Contact",
    size: 168,
    cell: ({ row }) => {
      const { contact_name: name, contact_phone: phone } = row.original.row
      if (name === null && phone === null)
        return <span className="text-mute">—</span>
      return (
        <span className="flex min-w-0 flex-col">
          <span className="truncate">{name ?? phone}</span>
          {name !== null && phone !== null && (
            <span className="truncate text-mute">{phone}</span>
          )}
        </span>
      )
    },
  },
  {
    id: "assets",
    accessorFn: (line) => line.row.asset_count,
    header: "Assets",
    size: 88,
    meta: { align: "right" },
    cell: ({ row }) => <Figure n={row.original.row.asset_count} />,
  },
  {
    id: "contracts",
    accessorFn: (line) => line.row.contract_count,
    header: "Contracts",
    size: 108,
    meta: { align: "right" },
    cell: ({ row }) => <Figure n={row.original.row.contract_count} />,
  },
  {
    id: "repairs",
    accessorFn: (line) => line.row.open_repair_count,
    header: "Open repairs",
    size: 128,
    meta: { align: "right" },
    cell: ({ row }) => <Figure n={row.original.row.open_repair_count} warm />,
  },
]

/// The same row as a phone card: the unit's name over its code and kind,
/// where it is and who to ring, what hangs off it, and the repairs that wait
/// where the thumb rests.
const LOCATION_CARD: CardSpec<PlaceLine> = {
  title: (line) => <CardName name={line.place.name} line={quietOf(line)} />,
  meta: [
    (line) => line.row.address,
    (line) =>
      line.row.contact_name === null && line.row.contact_phone === null
        ? null
        : [line.row.contact_name, line.row.contact_phone]
            .filter((part) => part !== null)
            .join(" · "),
  ],
  foot: (line) =>
    `${count(line.row.asset_count)} ${line.row.asset_count === 1 ? "asset" : "assets"} · ${count(line.row.contract_count)} ${line.row.contract_count === 1 ? "contract" : "contracts"}`,
  action: (line) =>
    line.row.open_repair_count > 0 ? (
      <Pill tone="warn">
        {count(line.row.open_repair_count)} open{" "}
        {line.row.open_repair_count === 1 ? "repair" : "repairs"}
      </Pill>
    ) : null,
}
