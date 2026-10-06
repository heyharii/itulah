import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { ChevronRight, Plus, Printer, Search, Trash2 } from "lucide-react"
import { createContext, use, useEffect, useMemo, useRef, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DataTable, dockSortOf } from "@/components/ui/data-table"
import { Dialog, SavedDialog } from "@/components/ui/dialog"
import { DockTools } from "@/components/shell/dock-tools"
import { Fab } from "@/components/ui/fab"
import { Field, Input, Select, Textarea } from "@/components/ui/field"
import { Switch, Toggle } from "@/components/ui/form"
import { RecordPanel } from "@/components/ui/record-panel"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { SupplierBand } from "@/screens/procurement/supplier-band"
import { ColumnsMenu, ExportCsv } from "@/components/ui/list-chrome"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { MiniCell, MiniRow, MiniTable, Section } from "@/components/ui/rows"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { SubTabs } from "@/components/ui/sub-tabs"
import { Banner, EmptyState } from "@/components/ui/states"
import type { CsvColumn } from "@/lib/csv"
import { recordKeys } from "@/lib/queries/records"
import { useLayout } from "@/lib/layout"
import { count, day, dayMonth, money, realItemCode } from "@/lib/format"
import {
  allSupplierContacts,
  catalogueVocabulary,
  createSupplier,
  createSupplierContact,
  listPurchaseOrders,
  procurementKeys,
  setSupplierStatus,
  supplierCatalogue,
  supplierContacts,
  supplierDetail,
  supplierPage,
  updateSupplier,
  updateSupplierContact,
  type PurchaseOrderRow,
  type SupplierPage,
  type SupplierScope,
  type SupplierSort,
} from "@/lib/queries/procurement"
import { queryState } from "@/lib/query-state"
import { useSheet } from "@/lib/sheets"
import { tableSetup, type TableSetup } from "@/lib/table"
import { toast } from "@/lib/toast"
import { cn } from "@/lib/utils"
import { useDebounced } from "@/lib/use-debounced"
import { ItemDetail } from "@/screens/procurement/item-detail"
import { ItemFormSheet } from "@/screens/procurement/item-form"
import { OrderSheet } from "@/screens/procurement/purchase-orders"
import { escapeHtml } from "@/screens/procurement/print"
import {
  pcs,
  useFittedVisibility,
  useIdempotencyKey,
} from "@/screens/procurement/shared"
import {
  LEGAL_FORMS,
  completeNpwp,
  emailProblem,
  formatNpwp,
  formatPhone,
  formatPhones,
  npwpDigits,
  npwpProblem,
  phoneProblem,
  phonesProblem,
  splitPhones,
  supplierDisplayName,
  capitaliseFirst,
  titled,
} from "@/screens/procurement/supplier-format"
import type {
  Supplier,
  SupplierContact,
  SupplierItem,
  SupplierStatus,
} from "@itulah/contract"

/// Suppliers — who we buy from, and whether we can.
///
/// Reworked to the owner's feedback of 2026-09-26:
///
///  - The list reads Supplier | Code | Status | Active PO | Completed PO |
///    Cancelled PO | Last purchased, numbered down the left; the company's
///    address, email, phone, NPWP and PKP are columns to switch on.
///  - Sorting is the column headers' and the server's. The Sort menu is gone.
///  - The book scrolls on, two hundred suppliers a page.
///  - A supplier's number is the server's to give: four digits, after Save.
///    The form never shows a box for it; Save shows the number it was given
///    (2026-09-28).
///  - The record is the form it was created with, read-only, and only the
///    address and the contact people can be edited — plus the switch that
///    says whether an order can still be raised against them.
///  - No comments, no bank accounts and no payment terms on a supplier.
///    Payment is Finance's, on the order.

/// A supplier with what we have ordered from them, joined from the tally the
/// list endpoint sends beside the page.
interface SupplierRow extends Supplier {
  readonly active: number
  readonly completed: number
  readonly cancelled: number
  readonly lastOrdered: string | null
}

/// Which column means which of the orders the endpoint names. A column that is
/// not in here cannot be sorted — `enableSorting: false` says so on the column
/// itself — because the table would otherwise sort the PAGE it is holding, and
/// a book sorted one screenful at a time lies about where its first row is.
const SORTS: Record<string, SupplierSort> = {
  name: "name",
  supplier_code: "code",
  status: "status",
  active: "active",
  completed: "completed",
  cancelled: "cancelled",
  lastOrdered: "last_purchased",
}

/// Which columns are showing, by id.
type VisibilityState = Record<string, boolean>

/// How many suppliers each page of the book carries — the owner's number.
const PAGE = 200

function statusLabel(status: SupplierStatus): string {
  return status === "ACTIVE" ? "Active" : "Non-active"
}

/// The list's columns after the number. Held at the widths their headings
/// need — measured in the browser, tracking included, at 12px a side
/// (2026-09-28) — so the whole list fits a 920px card without scrolling
/// sideways. The supplier's name takes what is left, never under 140px, and
/// wraps to a second line rather than being cut.
const columns: ColumnDef<TableSetup, SupplierRow>[] = [
  {
    accessorKey: "name",
    header: "Supplier",
    meta: { card: "title", grow: 140 },
    // The code stands under the name rather than in a column of its own: one
    // fact about the supplier, said where its name is.
    cell: ({ row }) => (
      <span className="flex flex-col">
        <span className="line-clamp-2 font-medium break-words whitespace-normal text-ink max-md:font-semibold">
          {supplierDisplayName(row.original)}
        </span>
        <span className="font-mono text-[0.875rem] text-mute">
          {row.original.supplier_code}
        </span>
      </span>
    ),
  },
  {
    accessorKey: "status",
    header: "Status",
    size: 116,
    meta: { card: "status" },
    cell: ({ row }) => (
      <Pill tone={row.original.status === "ACTIVE" ? "ok" : "neutral"}>
        {statusLabel(row.original.status)}
      </Pill>
    ),
  },
  {
    accessorKey: "active",
    header: "Active Order",
    size: 140,
    meta: { align: "right", card: "hide" },
    cell: ({ row }) => <Tally n={row.original.active} />,
  },
  {
    accessorKey: "completed",
    header: "Completed Order",
    size: 172,
    meta: { align: "right", card: "hide", priority: 2 },
    cell: ({ row }) => <Tally n={row.original.completed} />,
  },
  {
    accessorKey: "cancelled",
    header: "Cancelled Order",
    size: 168,
    meta: { align: "right", card: "hide", priority: 2 },
    cell: ({ row }) => <Tally n={row.original.cancelled} />,
  },
  {
    accessorKey: "lastOrdered",
    header: "Last Purchased",
    size: 164,
    meta: { align: "right", card: "hide", priority: 2 },
    cell: ({ row }) => <LastPurchased at={row.original.lastOrdered} />,
  },
  // Two columns that exist only on a card (`cardLead`): the figure it leads
  // with, the open orders, and the foot's left side — the rest of the tally
  // and the day of the last purchase (the owner, 2026-10-06).
  {
    id: "lead",
    accessorFn: (row) => row.active,
    header: "",
    enableHiding: false,
    enableSorting: false,
    meta: { card: "lead" },
    cell: ({ row }) => (
      <span className="flex flex-col items-end tabular-nums">
        <span
          className={cn(
            "text-[1.5rem] leading-tight font-semibold tracking-tight",
            row.original.active === 0 ? "text-mute" : "text-ink"
          )}
        >
          {count(row.original.active)}
        </span>
        <span className="text-[0.875rem] text-mute">active</span>
      </span>
    ),
  },
  {
    id: "foot",
    accessorFn: (row) => row.completed,
    header: "",
    enableHiding: false,
    enableSorting: false,
    meta: { card: "foot" },
    cell: ({ row }) => (
      <span className="flex flex-col leading-6 tabular-nums">
        <span>
          <Counted n={row.original.completed} word="completed" />
          {" · "}
          <Counted n={row.original.cancelled} word="cancelled" />
        </span>
        {row.original.lastOrdered !== null && (
          <span>{`Last purchased ${day(row.original.lastOrdered)}`}</span>
        )}
      </span>
    ),
  },
  // Off until somebody switches them on in Columns.
  {
    accessorKey: "address",
    header: "Company Address",
    size: 260,
    enableSorting: false,
    meta: { card: "meta" },
    cell: ({ row }) => (
      <span className="line-clamp-2 text-text">
        {row.original.address ?? "—"}
      </span>
    ),
  },
  {
    accessorKey: "email",
    header: "Company Email",
    size: 220,
    enableSorting: false,
    meta: { card: "meta" },
    cell: ({ row }) => (
      <span className="text-text">{row.original.email ?? "—"}</span>
    ),
  },
  {
    accessorKey: "phone",
    header: "Company Phone",
    size: 170,
    enableSorting: false,
    meta: { card: "meta" },
    cell: ({ row }) => (
      <span className="tabular-nums">
        {row.original.phone ? formatPhones(row.original.phone) : "—"}
      </span>
    ),
  },
  {
    accessorKey: "npwp",
    header: "NPWP",
    size: 200,
    enableSorting: false,
    meta: { card: "meta" },
    cell: ({ row }) => (
      <span className="tabular-nums">
        {row.original.npwp ? formatNpwp(row.original.npwp) : "—"}
      </span>
    ),
  },
  {
    accessorKey: "is_pkp",
    header: "PKP",
    size: 90,
    enableSorting: false,
    meta: { card: "meta" },
    cell: ({ row }) => (row.original.is_pkp ? "Yes" : "No"),
  },
]

/// The day of the last order.
function LastPurchased({ at }: { at: string | null }) {
  return (
    <span className={cn("tabular-nums", at === null && "text-mute")}>
      {dayMonth(at)}
    </span>
  )
}

/// An order count in the list. A nought is set quiet so the suppliers with
/// something open stand out down the column — 300 rows of "0" in the same
/// ink as "3" is a column nobody can scan.
function Tally({ n }: { n: number }) {
  return (
    <span className={cn("tabular-nums", n === 0 ? "text-mute" : "text-ink")}>
      {count(n)}
    </span>
  )
}

/// A count with its word, on a card's foot: "8 completed". The figure takes
/// the ink and the word stays quiet; a nought is quiet altogether.
function Counted({ n, word }: { n: number; word: string }) {
  return n === 0 ? (
    <span>{`0 ${word}`}</span>
  ) : (
    <span>
      <span className="font-medium text-ink">{count(n)}</span>
      {` ${word}`}
    </span>
  )
}

/// The optional columns, off until they are asked for.
const HIDDEN_BY_DEFAULT: VisibilityState = {
  lead: false,
  foot: false,
  address: false,
  email: false,
  phone: false,
  npwp: false,
  is_pkp: false,
}

/// The rows as the list draws them, from one page of the book.
function rowsOf(page: SupplierPage): SupplierRow[] {
  const tally = new Map(page.orders.map((each) => [each.supplier_id, each]))
  return page.rows.map((each) => {
    const orders = tally.get(each.supplier_id)
    return {
      ...each,
      active: orders?.active_count ?? 0,
      completed: orders?.completed_count ?? 0,
      cancelled: orders?.cancelled_count ?? 0,
      lastOrdered: orders?.last_ordered_at ?? null,
    }
  })
}

/// One line of the export: a supplier, and one of its contact people.
interface ExportRow {
  readonly supplier: SupplierRow
  readonly contact: SupplierContact | null
}

/// A stored phone number or NPWP as the screen writes it, or nothing. Also in
/// the export: written grouped, a spreadsheet reads them as text and keeps
/// the leading 0 it would otherwise eat.
function shownPhone(value: string | null | undefined): string | null {
  return value ? formatPhones(value) : null
}
function shownNpwp(value: string | null | undefined): string | null {
  return value ? formatNpwp(value) : null
}

/// The export's columns, in the owner's order (2026-09-26). One row per
/// contact person, the supplier's own facts repeated on each; a supplier with
/// nobody on file is one row with the contact columns blank.
const EXPORT_COLUMNS: readonly CsvColumn<ExportRow>[] = [
  { label: "Supplier", value: (row) => supplierDisplayName(row.supplier) },
  { label: "Code", value: (row) => row.supplier.supplier_code },
  { label: "Status", value: (row) => statusLabel(row.supplier.status) },
  { label: "Active order", value: (row) => row.supplier.active },
  { label: "Completed order", value: (row) => row.supplier.completed },
  { label: "Cancelled order", value: (row) => row.supplier.cancelled },
  {
    label: "Last purchased",
    value: (row) =>
      row.supplier.lastOrdered === null ? "" : day(row.supplier.lastOrdered),
  },
  { label: "Address", value: (row) => row.supplier.address },
  { label: "Email", value: (row) => row.supplier.email },
  { label: "Phone number", value: (row) => shownPhone(row.supplier.phone) },
  { label: "NPWP", value: (row) => shownNpwp(row.supplier.npwp) },
  { label: "Contact name", value: (row) => row.contact?.name },
  { label: "Contact role", value: (row) => row.contact?.role },
  { label: "Contact phone", value: (row) => shownPhone(row.contact?.phone) },
  { label: "Contact email", value: (row) => row.contact?.email },
  { label: "Contact address", value: (row) => row.contact?.address },
]

/// The status tabs over the book: every supplier, or one status.
type StatusTab = "ALL" | SupplierStatus

export function Suppliers() {
  // Which supplier is open lives in the URL, like every other sheet in the app.
  const supplier = useSheet("supplier")
  /// What was typed into the omnibox, also in the URL.
  const search = useSheet("q")
  // Nothing chosen is the house order: active suppliers first, then by name.
  const [sorting, setSorting] = useState<SortingState>([])
  const fit = useFittedVisibility(columns, HIDDEN_BY_DEFAULT)
  const visibility = fit.visibility
  // A phone draws cards, which stack and so need no width: the columns the
  // list gave up for lack of room on a desk are all here, as facts on the card
  // (the reader's own Columns switches still apply).
  const phone = useLayout() === "phone"
  /// The book is narrowed by two things and only two (the owner,
  /// 2026-09-28): its status, as tabs, and whether a supplier has an order
  /// still open, as a switch. The filter panel, views and chips are gone.
  const [tab, setTab] = useState<StatusTab>("ACTIVE")
  const [activeOnly, setActiveOnly] = useState(false)
  /// Which suppliers are opened out to show their active orders, by id.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
  const toggleExpanded = (id: string) =>
    setExpanded((was) => {
      const next = new Set(was)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  /// The order being read, opened over the list without leaving it.
  const [reading, setReading] = useState<string | null>(null)
  const navigate = useNavigate()

  /// The name typed, plus the tab and the switch, as the one request that
  /// answers all three. Debounced: every keystroke is a round trip over the
  /// whole book.
  const typed = (search.value ?? "").trim()
  const needle = useDebounced(typed, 400)
  const order = sorting[0]
  const scope = useMemo<SupplierScope>(
    () => ({
      // This menu is the merchandise book. PLN, the landlord and the other
      // units of the group live on Finance's Vendors screen — see 0212.
      category: "MERCHANDISE",
      ...(tab === "ALL" ? {} : { status: tab }),
      ...(activeOnly ? { activeOrders: true } : {}),
      ...(needle === "" ? {} : { q: needle }),
      ...(order === undefined || SORTS[order.id] === undefined
        ? {}
        : { sort: SORTS[order.id], desc: order.desc }),
    }),
    [tab, activeOnly, needle, order]
  )
  const narrowed = needle !== "" || tab !== "ALL" || activeOnly

  /// The book, a page at a time, the next one fetched as the last rows come
  /// into view. Its own key under the book's prefix: an invalidation of
  /// `suppliers()` still reaches it, and no plain `useQuery` of the same
  /// scope can read a paged answer as a single page.
  const book = useInfiniteQuery({
    queryKey: [...procurementKeys.suppliers(scope), "pages"] as const,
    queryFn: ({ signal, pageParam }) =>
      supplierPage(
        {
          ...scope,
          limit: PAGE,
          ...(pageParam === undefined ? {} : { cursor: pageParam }),
        },
        signal
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    placeholderData: (previous) => previous,
  })

  /// The five figures over the cards, asked on their own: they describe the
  /// whole book, so no search, tab or switch may move them. One row is the
  /// smallest page there is; the figures ride beside it.
  const whole = useQuery({
    queryKey: [
      ...procurementKeys.suppliers({ category: "MERCHANDISE" }),
      "kpis",
    ] as const,
    queryFn: ({ signal }) =>
      supplierPage({ category: "MERCHANDISE", limit: 1 }, signal),
  })

  const rows = useMemo<SupplierRow[]>(
    () => (book.data?.pages ?? []).flatMap(rowsOf),
    [book.data]
  )
  const first = book.data?.pages[0]
  /// The status counts for the tabs: over what the search leaves, whatever
  /// tab is showing.
  const statusCount = (value: SupplierStatus) =>
    first?.facets.statuses.find((facet) => facet.value === value)?.count ?? 0

  /// What the expand column reads. Through a context and not through the
  /// column definitions, so toggling never rebuilds (and remounts) the columns.
  const expanding = useMemo<Expanding>(
    () => ({ isOpen: (id) => expanded.has(id), toggle: toggleExpanded }),
    // `toggleExpanded` only closes over the setter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [expanded]
  )

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns: ALL_COLUMNS,
        getRowId: (row: SupplierRow) => row.supplier_id,
        state: {
          sorting,
          columnVisibility: phone
            ? { ...visibility, lead: true, foot: true }
            : fit.shown,
        },
        // The rows arrive in the order the request asked for. Sorting them
        // again here would sort what has loaded, not the book.
        manualSorting: true,
        onSortingChange: setSorting,
        onColumnVisibilityChange: fit.change,
      }),
      [rows, sorting, fit.hidden, visibility, phone]
    )
  )

  /// Everything the list shows, every page of it, with its people.
  const exportRows = async (): Promise<ExportRow[]> => {
    const all: SupplierRow[] = []
    let cursor: string | undefined
    do {
      const page = await supplierPage({
        ...scope,
        limit: 1000,
        ...(cursor === undefined ? {} : { cursor }),
      })
      all.push(...rowsOf(page))
      cursor = page.next_cursor ?? undefined
    } while (cursor !== undefined)
    const people = await allSupplierContacts()
    const bySupplier = new Map<string, SupplierContact[]>()
    for (const one of people) {
      bySupplier.set(one.supplier_id, [
        ...(bySupplier.get(one.supplier_id) ?? []),
        one,
      ])
    }
    return all.flatMap((row): ExportRow[] => {
      const contacts = bySupplier.get(row.supplier_id) ?? []
      return contacts.length === 0
        ? [{ supplier: row, contact: null }]
        : contacts.map((contact) => ({ supplier: row, contact }))
    })
  }

  const everyLoaded = !book.hasNextPage
  const sum = (key: "active" | "completed" | "cancelled") =>
    count(rows.reduce((total, row) => total + row[key], 0))

  return (
    <PageContent>
      <PageHeader title="Suppliers" small />

      {/* The owner's five figures, as cards over the list. */}
      <SupplierBand
        active={whole.data ? bandOf(whole.data, "ACTIVE") : undefined}
        inactive={whole.data ? bandOf(whole.data, "INACTIVE") : undefined}
        orders={whole.data?.book.open_orders}
        pieces={whole.data?.book.open_units}
        value={
          whole.data ? brief(whole.data.book.open_value_minor) : undefined
        }
        className="md:hidden"
      />
      <KpiStrip className="max-md:hidden md:grid-cols-5 xl:grid-cols-5">
        {bookKpis(whole.data)?.map((kpi) => (
          <div key={kpi.label} title={kpi.note}>
            <Kpi label={kpi.label} value={kpi.value} />
          </div>
        )) ??
          [
            "Active",
            "Non-active",
            "Active PO",
            "Active PO qty",
            "Active PO value",
          ].map((label) => <Kpi key={label} label={label} value="—" />)}
      </KpiStrip>

      <SubTabs
        // Hidden on a phone: the status is the button in the drawer over the
        // bottom bar (`DockTools`), as on the order list (owner, 2026-10-05).
        className="max-md:hidden"
        tabs={[
          {
            value: "ACTIVE",
            label: <TabLabel text="Active" n={statusCount("ACTIVE")} />,
          },
          {
            value: "INACTIVE",
            label: <TabLabel text="Non-active" n={statusCount("INACTIVE")} />,
          },
          {
            value: "ALL",
            label: (
              <TabLabel
                text="All"
                n={statusCount("ACTIVE") + statusCount("INACTIVE")}
              />
            ),
          },
        ]}
        value={tab}
        onChange={(next) => setTab(next as StatusTab)}
      />

      {/* One line from a tablet up: the search gives up width before any
          button drops to a line of its own. */}
      <div className="mb-3 flex min-h-[2.25rem] flex-wrap items-center gap-2 md:flex-nowrap">
        <>
          <span className="relative min-w-[11rem] flex-1 max-md:hidden lg:max-w-64">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-line-ico" />
            <input
              value={search.value ?? ""}
              onChange={(event) =>
                event.target.value
                  ? search.open(event.target.value)
                  : search.close()
              }
              aria-label="Search supplier name"
              className="h-[2.125rem] w-full rounded-inner border border-hairline-2 bg-canvas pr-2.5 pl-8 text-[0.9375rem] text-ink shadow-soft outline-none placeholder:text-body focus:border-accent pointer-coarse:h-11"
            />
          </span>
          {/* A control of the toolbar's own height and edge, beside the
                search it narrows with — bare on the page, the switch's pale
                track read as nothing at all. */}
          <label className="inline-flex h-[2.125rem] shrink-0 cursor-pointer items-center gap-2 rounded-inner border border-hairline-2 bg-canvas px-2.5 text-[0.875rem] whitespace-nowrap text-ink shadow-soft select-none pointer-coarse:h-11">
            <Switch
              on={activeOnly}
              label="Only suppliers with an active order"
              onToggle={() => setActiveOnly(!activeOnly)}
            />
            Active order
          </label>
          <span className="flex-1 max-lg:hidden" />
          {/* The same controls on a phone and on a desk. Only New supplier
              changes its dress: a button here, the round "+" in the dock there. */}
          <ColumnsMenu table={table} />
          <ExportCsv
            title="Suppliers"
            columns={EXPORT_COLUMNS}
            rows={exportRows}
          />
          <Button
            variant="primary"
            className="max-md:hidden"
            onClick={() => supplier.open("new")}
          >
            New supplier
          </Button>
        </>
      </div>
      <Fab label="New Supplier" onClick={() => supplier.open("new")} />
      {/* On a phone the status and the search live in the drawer over the
          bottom bar, not at the top of the list (owner, 2026-10-05). */}
      <DockTools
        search={{
          value: search.value ?? "",
          onChange: (next) => (next ? search.open(next) : search.close()),
          label: "Search Suppliers",
        }}
        sort={dockSortOf(table)}
        status={{
          value: tab,
          options: [
            {
              value: "ACTIVE",
              label: "Active",
              count: statusCount("ACTIVE"),
            },
            {
              value: "INACTIVE",
              label: "Non-active",
              count: statusCount("INACTIVE"),
            },
            {
              value: "ALL",
              label: "All",
              count: statusCount("ACTIVE") + statusCount("INACTIVE"),
            },
          ],
          onChange: (next) => setTab(next as StatusTab),
        }}
      />

      {/* `overflow-clip`, not `overflow-hidden`: hidden makes the card a
          scroll box, and the table's heading would stick to the card instead
          of the window. */}
      <div ref={fit.ref}>
        <Card className="overflow-clip max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
          {queryState(book, {
            loading: "Reading the supplier list…",
            render: () =>
              rows.length === 0 ? (
                <EmptyState>
                  {narrowed
                    ? "No supplier matches what you asked for."
                    : "Nobody has been set up as a supplier yet."}
                </EmptyState>
              ) : (
                <ExpandContext value={expanding}>
                  <DataTable<SupplierRow>
                    table={table}
                    cardSort={false}
                    cardsApart
                    cardLead
                    onRowClick={(row) => supplier.open(row.supplier_id)}
                    isSelected={(row) => row.supplier_id === supplier.value}
                    isExpanded={(row) => expanded.has(row.supplier_id)}
                    renderSub={(row) => (
                      <ActiveOrders
                        supplier={row}
                        onOpen={setReading}
                        onViewAll={() => supplier.open(row.supplier_id)}
                      />
                    )}
                    more={book}
                    // The floating footer: how many suppliers the list holds —
                    // the server's count, not the rows loaded — and the order
                    // columns added up once every page is in.
                    summary={{
                      name: (
                        <span>
                          {count(first?.total ?? rows.length)}{" "}
                          <span className="font-normal text-body">
                            {(first?.total ?? rows.length) === 1
                              ? "supplier"
                              : "suppliers"}
                          </span>
                          {!everyLoaded && (
                            <span className="font-normal text-body">
                              {" "}
                              · {count(rows.length)} loaded
                            </span>
                          )}
                        </span>
                      ),
                      ...(everyLoaded
                        ? {
                            active: sum("active"),
                            completed: sum("completed"),
                            cancelled: sum("cancelled"),
                          }
                        : {}),
                    }}
                    pageScroll
                  />
                </ExpandContext>
              ),
          })}
        </Card>
      </div>

      <SupplierSheet id={supplier.value ?? null} onClose={supplier.close} />
      <OrderSheet
        id={reading}
        onClose={() => setReading(null)}
        onEdit={(id) =>
          void navigate({
            to: "/procurement/orders",
            search: { "edit-order": id },
          } as never)
        }
      />
    </PageContent>
  )
}

/// Which suppliers are opened out, for the expand column's chevrons.
interface Expanding {
  readonly isOpen: (id: string) => boolean
  readonly toggle: (id: string) => void
}

const ExpandContext = createContext<Expanding | null>(null)

/// The chevron that opens a supplier's active orders under its row. It stops
/// the click, so it never also opens the supplier's sheet.
function ExpandToggle({ row }: { row: SupplierRow }) {
  const expanding = use(ExpandContext)
  if (expanding === null) throw new Error("ExpandContext is missing")
  const open = expanding.isOpen(row.supplier_id)
  return (
    <span
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
      className="-mx-1 flex"
    >
      <button
        type="button"
        aria-expanded={open}
        aria-label={`Show active orders for ${supplierDisplayName(row)}`}
        onClick={() => expanding.toggle(row.supplier_id)}
        className="grid size-8 place-items-center rounded-full text-line-ico transition-colors hover:bg-soft-2 hover:text-text pointer-coarse:size-tap"
      >
        <ChevronRight
          className={cn(
            "size-4 transition-transform duration-150",
            open && "rotate-90"
          )}
        />
      </button>
    </span>
  )
}

const EXPAND_COLUMN: ColumnDef<TableSetup, SupplierRow> = {
  id: "expand",
  header: () => <span className="sr-only">Active orders</span>,
  size: 44,
  enableSorting: false,
  enableHiding: false,
  meta: { card: "hide" },
  cell: ({ row }) => <ExpandToggle row={row.original} />,
}

const ALL_COLUMNS: ColumnDef<TableSetup, SupplierRow>[] = [
  EXPAND_COLUMN,
  ...columns,
]

/// A supplier's active orders, opened under its row in the list: the five
/// newest and View all for the rest. Mounted only while the row is open, so
/// the order book is read on demand — through the same query the supplier's
/// own Orders tab uses, so the two share one cache entry.
function ActiveOrders({
  supplier,
  onOpen,
  onViewAll,
}: {
  supplier: SupplierRow
  onOpen: (id: string) => void
  onViewAll: () => void
}) {
  const scope = { suppliers: [supplier.supplier_code] }
  const orders = useQuery({
    queryKey: procurementKeys.orders(scope),
    queryFn: ({ signal }) => listPurchaseOrders(scope, signal),
  })
  const active = useMemo(() => {
    const group = GROUPS[0]
    return [...(orders.data ?? [])]
      .filter((row) => group.statuses.includes(row.lifecycle))
      .sort(newestFirst)
  }, [orders.data])

  return (
    <div className="flex flex-col gap-2 bg-soft px-3.5 py-3 pl-[5.5rem]">
      {queryState(orders, {
        loading: "Reading the order book…",
        render: () =>
          active.length === 0 ? (
            <p className="py-1 text-[0.875rem] text-body">No active orders.</p>
          ) : (
            <>
              <OrdersTable
                group={GROUPS[0]}
                rows={active.slice(0, 5)}
                onOpen={onOpen}
              />
              {active.length > 5 && (
                <Button variant="ghost" className="w-full" onClick={onViewAll}>
                  View all {count(active.length)}
                </Button>
              )}
            </>
          ),
      })}
    </div>
  )
}

/// A tab's word and how many are under it, the count quieter than the word.
function TabLabel({ text, n }: { text: string; n: number }) {
  return (
    <span>
      {text}
      <span className="ml-1.5 text-body tabular-nums">{count(n)}</span>
    </span>
  )
}

/// `49.923.900.000` → `Rp 49,9 billion`. Words, not the Indonesian jt/rb.
function brief(minor: number): string {
  const abs = Math.abs(minor)
  const [scale, suffix] =
    abs >= 1_000_000_000
      ? [1_000_000_000, " billion"]
      : abs >= 1_000_000
        ? [1_000_000, " million"]
        : abs >= 1_000
          ? [1_000, " thousand"]
          : [1, ""]
  const scaled = minor / scale
  const shown =
    scale === 1 ? String(minor) : scaled.toFixed(scaled < 10 ? 1 : 0)
  return `Rp ${shown.replace(".", ",")}${suffix}`
}

/// How many suppliers hold a status, the server's own facet.
function bandOf(page: SupplierPage, status: string): number {
  return (
    page.facets.statuses.find((facet) => facet.value === status)?.count ?? 0
  )
}

/// The five figures the owner asked for, all the server's own: the status
/// facet over the book, and the open side of the order book across every
/// supplier — never a sum over whatever page is in hand.
function bookKpis(page: SupplierPage | undefined) {
  if (page === undefined) return undefined
  const of = (value: string) =>
    page.facets.statuses.find((facet) => facet.value === value)?.count ?? 0
  return [
    {
      label: "Active",
      value: count(of("ACTIVE")),
      note: "Suppliers a purchase order can be issued to.",
    },
    {
      label: "Non-active",
      value: count(of("INACTIVE")),
      note: "Suppliers no purchase order can be issued to.",
    },
    {
      label: "Active PO",
      value: count(page.book.open_orders),
      note: "Purchase orders still waiting on goods: active or partially received.",
    },
    {
      label: "Active PO qty",
      value: `${count(page.book.open_units)} pcs`,
      note: "Pieces the active purchase orders still expect.",
    },
    {
      label: "Active PO value",
      value: brief(page.book.open_value_minor),
      note: money(page.book.open_value_minor),
    },
  ]
}

// ---------------------------------------------------------------------------
// The form

/// The company's own facts, as the form holds them.
interface SupplierDraft {
  legalForm: string
  name: string
  address: string
  email: string
  phone: string
  npwp: string
  isPkp: boolean
  notes: string
}

const EMPTY: SupplierDraft = {
  legalForm: "",
  name: "",
  address: "",
  email: "",
  phone: "",
  npwp: "",
  isPkp: false,
  notes: "",
}

function blank(value: string): string | null {
  return value.trim() === "" ? null : value.trim()
}

/// What a saveable supplier is: a name, a legal form, an address and a phone
/// number — the four the owner starred — each well-formed, and a well-formed
/// email and NPWP when given.
function saveable(draft: SupplierDraft): boolean {
  return (
    draft.name.trim() !== "" &&
    draft.legalForm.trim() !== "" &&
    draft.address.trim() !== "" &&
    splitPhones(draft.phone).some((one) => one !== "") &&
    phonesProblem(draft.phone) === null &&
    emailProblem(draft.email) === null &&
    npwpProblem(draft.npwp) === null
  )
}

/// A contact person as the form holds them. `contactId` is set for somebody
/// already on file, so a save knows whether to correct them or add them.
interface ContactDraft {
  readonly key: string
  readonly contactId?: string
  readonly version?: number
  readonly name: string
  readonly role: string
  readonly phone: string
  readonly email: string
  readonly address: string
}

function contactDraftOf(contact: SupplierContact): ContactDraft {
  return {
    key: contact.contact_id,
    contactId: contact.contact_id,
    version: contact.version,
    name: contact.name,
    role: contact.role ?? "",
    phone: shownPhone(contact.phone) ?? "",
    email: contact.email ?? "",
    address: contact.address ?? "",
  }
}

function newContact(): ContactDraft {
  return {
    key: crypto.randomUUID(),
    name: "",
    role: "",
    phone: "",
    email: "",
    address: "",
  }
}

/// A row nobody typed into. Dropped on save rather than refused: the Add
/// button leaves one of these behind every time it is pressed and not used.
function contactEmpty(contact: ContactDraft): boolean {
  return (
    contact.name.trim() === "" &&
    contact.role.trim() === "" &&
    contact.phone.trim() === "" &&
    contact.email.trim() === "" &&
    contact.address.trim() === ""
  )
}

/// What is wrong with a contact row, or null. A name, and one way to reach
/// them — the table's own CHECK, said early.
function contactProblem(contact: ContactDraft): string | null {
  if (contactEmpty(contact)) return null
  if (contact.name.trim() === "") return "Give this contact a name."
  if (contact.phone.trim() === "" && contact.email.trim() === "")
    return "A contact needs a phone number or an email."
  return phoneProblem(contact.phone) ?? emailProblem(contact.email)
}

function contactsSaveable(contacts: readonly ContactDraft[]): boolean {
  return contacts.every((one) => contactProblem(one) === null)
}

/// The company's facts, in the owner's order: name and legal form, address,
/// email, phone, NPWP, PKP.
///
/// No box for the supplier's number (the owner, 2026-09-28): the server gives
/// it on Save, a disabled empty field only said so, and a record already
/// carries it over its name.
///
/// `locked` says which fields are read rather than typed: all of them on a
/// record being read, all but the address on a record being edited, none on a
/// new supplier.
function CompanyFields({
  draft,
  set,
  locked,
  tried = false,
}: {
  draft: SupplierDraft
  set: (patch: Partial<SupplierDraft>) => void
  locked: (field: keyof SupplierDraft) => boolean
  /// Save has been pressed on a form that is not ready: every problem is
  /// said now, under its own box, the empty required ones included.
  tried?: boolean
}) {
  const [touched, setTouched] = useState({
    phone: false,
    email: false,
    npwp: false,
  })
  const touch = (patch: Partial<typeof touched>) =>
    setTouched((was) => ({ ...was, ...patch }))
  const numbers = draft.phone.split(",")
  const phone = !splitPhones(draft.phone).some((one) => one !== "")
    ? tried
      ? "Fill in a phone number."
      : null
    : phonesProblem(draft.phone)
  const email = emailProblem(draft.email)
  const npwp = npwpProblem(draft.npwp)
  const name =
    tried && draft.name.trim() === "" ? "Fill in the supplier's name." : null
  const legalForm =
    tried && draft.legalForm.trim() === "" ? "Choose the legal form." : null
  const address =
    tried && draft.address.trim() === "" ? "Fill in the address." : null

  return (
    // Flush: it is the first thing in the sheet, and the line and the air
    // above it only underlined the header (the owner, 2026-09-28).
    <Section title="Company" flush>
      <div className="grid gap-6 md:grid-cols-2">
        {/* Name, then its legal form beside it — the order the two are
            written in: "Sepatu Sejahtera, CV". */}
        <div className="grid gap-6 md:col-span-2 md:grid-cols-[minmax(0,1fr)_9rem]">
          <Field label="Name" required problem={name}>
            <Input
              value={draft.name}
              disabled={locked("name")}
              onChange={(event) => titled(event, (name) => set({ name }))}
            />
          </Field>
          <Field label="Legal Form" required problem={legalForm}>
            <Select
              aria-label="Legal Form"
              value={draft.legalForm}
              disabled={locked("legalForm")}
              onChange={(legalForm) => set({ legalForm })}
            >
              <option value="">—</option>
              {LEGAL_FORMS.map((form) => (
                <option key={form} value={form}>
                  {form}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field
          label="Address"
          required
          problem={address}
          className="md:col-span-2"
        >
          {/* A street, a kelurahan, a city and a postcode: four lines of
              room, so a whole address is read without scrolling a box. */}
          <Textarea
            rows={4}
            value={draft.address}
            disabled={locked("address")}
            onChange={(event) => titled(event, (address) => set({ address }))}
            className="disabled:opacity-50"
          />
        </Field>
        <Field label="Email" problem={touched.email || tried ? email : null}>
          <Input
            type="email"
            inputMode="email"
            value={draft.email}
            disabled={locked("email")}
            onChange={(event) => set({ email: event.target.value })}
            onBlur={() => touch({ email: true })}
          />
        </Field>
        <Field
          label="Phone Number"
          required
          problem={touched.phone || tried ? phone : null}
        >
          {/* One row a number, the first required; the rest are stored beside
              it in the same column, separated by commas. */}
          <div className="flex flex-col gap-2">
            {numbers.map((number, at) => (
              <div key={at} className="flex items-center gap-2">
                <Input
                  type="tel"
                  inputMode="tel"
                  aria-label={
                    at === 0 ? "Phone Number" : `Phone Number ${at + 1}`
                  }
                  value={number.trim()}
                  disabled={locked("phone")}
                  onChange={(event) =>
                    set({
                      phone: numbers
                        .map((one, index) =>
                          index === at ? formatPhone(event.target.value) : one
                        )
                        .join(","),
                    })
                  }
                  onBlur={() => touch({ phone: true })}
                  className="tabular-nums"
                />
                {at > 0 && !locked("phone") && (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove phone number ${at + 1}`}
                    onClick={() =>
                      set({
                        phone: numbers.filter((_, i) => i !== at).join(","),
                      })
                    }
                  >
                    <Trash2 />
                  </Button>
                )}
              </div>
            ))}
            {!locked("phone") && (
              <Button
                variant="ghost"
                size="sm"
                className="self-start"
                onClick={() => set({ phone: `${draft.phone},` })}
              >
                <Plus />
                Add number
              </Button>
            )}
          </div>
        </Field>
        <Field
          label="NPWP"
          aside="16 digits"
          problem={touched.npwp || tried ? npwp : null}
        >
          <Input
            keyboard
            inputMode="numeric"
            value={draft.npwp}
            disabled={locked("npwp")}
            onChange={(event) => set({ npwp: formatNpwp(event.target.value) })}
            onBlur={() => {
              set({ npwp: completeNpwp(draft.npwp) })
              touch({ npwp: true })
            }}
            className="tabular-nums"
          />
        </Field>
        {/* Beside the NPWP it belongs to, its foot on the box's line. */}
        <div className="md:self-end">
          <Toggle
            on={draft.isPkp}
            onToggle={() => {
              if (!locked("isPkp")) set({ isPkp: !draft.isPkp })
            }}
            label="PKP"
            disabled={locked("isPkp")}
            note={
              draft.isPkp
                ? "Their bills carry PPN and a faktur pajak number."
                : "Their bills carry no PPN."
            }
          />
        </div>
      </div>
    </Section>
  )
}

/// The contact people, as a list somebody can add to.
///
/// Four boxes a row — name, role, phone, email — and an Add button under the
/// last. `readOnly` draws the same rows as text for a record being read.
function ContactsFields({
  contacts,
  onChange,
  readOnly = false,
}: {
  contacts: readonly ContactDraft[]
  onChange: (contacts: readonly ContactDraft[]) => void
  readOnly?: boolean
}) {
  const patch = (key: string, change: Partial<ContactDraft>) =>
    onChange(
      contacts.map((one) => (one.key === key ? { ...one, ...change } : one))
    )

  if (readOnly) {
    return (
      <Section title="Contact Person" rule={false} quiet>
        {contacts.length === 0 ? (
          <p className="text-[0.875rem] text-body">
            Nobody is on file at this supplier yet.
          </p>
        ) : (
          <MiniTable
            // Words, not figures: every column reads from the left, so each
            // heading stands over its own values.
            head={[
              "Name",
              { label: "Role", align: "left" },
              { label: "Phone", align: "left" },
              { label: "Email", align: "left" },
              { label: "Address", align: "left" },
            ]}
          >
            {contacts.map((one) => (
              <MiniRow key={one.key}>
                <MiniCell className="py-2.5 text-ink">{one.name}</MiniCell>
                <MiniCell className="py-2.5">{one.role || "—"}</MiniCell>
                <MiniCell className="py-2.5 tabular-nums">
                  {one.phone || "—"}
                </MiniCell>
                <MiniCell className="py-2.5">{one.email || "—"}</MiniCell>
                <MiniCell className="py-2.5">{one.address || "—"}</MiniCell>
              </MiniRow>
            ))}
          </MiniTable>
        )}
      </Section>
    )
  }

  // Add stands at the heading, level with "Contact person" (the owner,
  // 2026-09-28), so it stays in one place however many people are listed.
  return (
    <Section
      title="Contact Person"
      rule={false}
      quiet
      actions={
        <Button onClick={() => onChange([...contacts, newContact()])}>
          <Plus />
          Add
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        {contacts.map((one, index) => {
          const problem = contactProblem(one)
          return (
            <div
              key={one.key}
              className="flex flex-col gap-3 rounded-inner border border-hairline p-4 transition-[opacity,translate] duration-200 ease-(--ease-out) starting:translate-y-1 starting:opacity-0 motion-reduce:starting:translate-none"
            >
              {/* Two boxes a row, not four: four in one row left each too
                  narrow to hold an email or a phone number whole. */}
              <div className="flex items-center justify-between gap-2">
                <span className="text-[0.875rem] font-medium text-body">
                  Contact {index + 1}
                </span>
                <Button
                  variant="quiet"
                  aria-label={`Remove contact ${index + 1}`}
                  onClick={() =>
                    onChange(contacts.filter((other) => other.key !== one.key))
                  }
                >
                  <Trash2 />
                </Button>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Name">
                  <Input
                    value={one.name}
                    onChange={(event) =>
                      titled(event, (name) => patch(one.key, { name }))
                    }
                    aria-label={`Contact ${index + 1} name`}
                  />
                </Field>
                <Field label="Role">
                  <Input
                    value={one.role}
                    onChange={(event) =>
                      titled(event, (role) => patch(one.key, { role }))
                    }
                    aria-label={`Contact ${index + 1} role`}
                  />
                </Field>
                <Field label="Phone">
                  <Input
                    type="tel"
                    inputMode="tel"
                    value={one.phone}
                    onChange={(event) =>
                      patch(one.key, { phone: formatPhone(event.target.value) })
                    }
                    className="tabular-nums"
                    aria-label={`Contact ${index + 1} phone`}
                  />
                </Field>
                <Field label="Email">
                  <Input
                    type="email"
                    inputMode="email"
                    value={one.email}
                    onChange={(event) =>
                      patch(one.key, { email: event.target.value })
                    }
                    aria-label={`Contact ${index + 1} email`}
                  />
                </Field>
                <Field label="Address" className="md:col-span-2">
                  <Input
                    value={one.address}
                    onChange={(event) =>
                      titled(event, (address) => patch(one.key, { address }))
                    }
                    aria-label={`Contact ${index + 1} address`}
                  />
                </Field>
              </div>
              {problem !== null && (
                <span data-problem className="text-[0.875rem] text-bad">
                  {problem}
                </span>
              )}
            </div>
          )
        })}
        {contacts.length === 0 && (
          <p className="text-[0.875rem] text-body">
            Nobody yet. Add puts a contact person here.
          </p>
        )}
      </div>
    </Section>
  )
}

/// The company's facts as a record reads them: a label over its value, the
/// way this sheet read before it became a disabled copy of the form (the
/// owner, 2026-09-28 — "kayak awal, bukan input"). The name and the number
/// are the sheet's own title. The address is the one fact an edit reaches,
/// so an edit hands in its box to stand in the fact's place; everything
/// else stays read.
function CompanyFacts({
  supplier,
  address,
}: {
  supplier: Supplier
  address?: React.ReactNode
}) {
  return (
    <Section title="Company" flush quiet>
      <Facts className="gap-x-10 gap-y-5 [&_dd]:mt-1">
        <div className="col-span-2">
          {address === undefined ? (
            <Fact term="Address">
              <span className="whitespace-pre-line">
                {supplier.address?.trim() || "—"}
              </span>
            </Fact>
          ) : (
            <Field label="Address" required>
              {address}
            </Field>
          )}
        </div>
        <Fact term="Phone Number">{shownPhone(supplier.phone) ?? "—"}</Fact>
        <Fact term="Email">{supplier.email ?? "—"}</Fact>
        <Fact term="NPWP">{shownNpwp(supplier.npwp) ?? "—"}</Fact>
        <Fact term="PKP">{supplier.is_pkp ? "Yes" : "No"}</Fact>
      </Facts>
    </Section>
  )
}

function NotesField({
  value,
  onChange,
  disabled,
}: {
  value: string
  onChange: (notes: string) => void
  disabled: boolean
}) {
  return (
    <Section title="Notes" rule={false}>
      <Textarea
        rows={3}
        aria-label="Notes"
        value={value}
        disabled={disabled}
        onChange={(event) => titled(event, onChange, capitaliseFirst)}
        className="disabled:opacity-50"
      />
    </Section>
  )
}

// ---------------------------------------------------------------------------
// Creating one

/// Creating one — a task over the page, the form the owner laid out:
/// Company, then Contact person, then Notes. The same form wherever a
/// supplier is registered, the order composer's included (the owner,
/// 2026-09-28): there is one supplier record, so there is one way to write it.
///
/// Save holds the sheet and says the number the supplier was given in a small
/// dialog in the middle of the screen; the sheet hands over once it is read
/// (the owner, 2026-10-04).
export function SupplierComposer({
  open,
  onClose,
  onCreated,
  savedNote,
}: {
  open: boolean
  onClose: () => void
  /// The supplier that was just registered, the moment it exists, for a
  /// caller with somewhere to put it — the order composer selects it into its
  /// picker while the number is still showing.
  onCreated?: (supplier: Supplier) => void
  /// One line under the number in the toast saying what happens next, where
  /// the caller has something to say — "Chosen as this order's supplier."
  savedNote?: string
}) {
  const client = useQueryClient()
  const idempotency = useIdempotencyKey()
  const [draft, setDraft] = useState<SupplierDraft>(EMPTY)
  const [contacts, setContacts] = useState<readonly ContactDraft[]>(() => [
    newContact(),
  ])
  /// How many times Save was pressed on a form not ready to save. Save is
  /// never disabled (the owner, 2026-09-28): a greyed button says something
  /// is missing and not what. Pressing it says every problem under its box
  /// and brings the first one into view — each press, so a second press
  /// after scrolling away finds it again.
  const [asked, setAsked] = useState(0)
  const form = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (asked === 0) return
    // A frame later: a field marks its box invalid through its own context,
    // which lands a render after the problem it was handed.
    const frame = requestAnimationFrame(() => {
      const first = form.current?.querySelector<HTMLElement>(
        '[aria-invalid="true"], [data-problem]'
      )
      if (!first) return
      const still = window.matchMedia(
        "(prefers-reduced-motion: reduce)"
      ).matches
      first.scrollIntoView({
        block: "center",
        behavior: still ? "auto" : "smooth",
      })
      if (first.matches("input, textarea, select, button"))
        first.focus({ preventScroll: true })
    })
    return () => cancelAnimationFrame(frame)
  }, [asked])
  const set = (patch: Partial<SupplierDraft>) =>
    setDraft((was) => ({ ...was, ...patch }))
  const people = contacts.filter((one) => !contactEmpty(one))

  const create = useMutation({
    mutationFn: async () => {
      const supplier = await createSupplier(
        {
          // The server numbers it.
          supplier_code: null,
          name: draft.name.trim(),
          legal_form: blank(draft.legalForm),
          // The first contact's name is still kept on the supplier's own row
          // for the screens that read one name off it.
          contact_name: blank(people[0]?.name ?? ""),
          phone: blank(formatPhones(draft.phone)),
          email: blank(draft.email),
          address: blank(draft.address),
          status: "ACTIVE",
          // The digits alone: the dots are for reading.
          npwp: blank(npwpDigits(draft.npwp)),
          is_pkp: draft.isPkp,
          notes: blank(draft.notes),
        },
        idempotency.key
      )
      // In order and one at a time, because the FIRST one becomes the
      // primary and a parallel send makes "first" a race.
      for (const contact of people) {
        await createSupplierContact(
          supplier.supplier_id,
          {
            name: contact.name.trim(),
            role: blank(contact.role),
            phone: blank(contact.phone),
            email: blank(contact.email),
            address: blank(contact.address),
          },
          crypto.randomUUID()
        )
      }
      return supplier
    },
    onSuccess: (supplier) => {
      void client.invalidateQueries({ queryKey: procurementKeys.suppliers() })
      idempotency.rotate()
      onCreated?.(supplier)
      // The number is the receipt; it stays in the middle of the screen until
      // it is read (the owner, 2026-10-04), and the sheet hands over only
      // once it is dismissed — "save, see the number, close".
      setSaved(supplier)
    },
  })
  /// The supplier the save minted, held in the receipt dialog until it is
  /// read. `close()` waits for the button because the composer unmounts the
  /// moment the record sheet behind it lets go of `?supplier=new` — state
  /// released there would die with it.
  const [saved, setSaved] = useState<Supplier | null>(null)
  const readSaved = () => {
    setSaved(null)
    close()
  }

  const reset = () => {
    setDraft(EMPTY)
    setContacts([newContact()])
  }
  /// The sheet stays mounted between openings, so without this the last
  /// supplier's error is the first thing the next one says.
  const close = () => {
    create.reset()
    reset()
    setAsked(0)
    onClose()
  }

  const ready = saveable(draft) && contactsSaveable(contacts)

  return (
    <>
      <Sheet
        open={open}
        onOpenChange={(next) => !next && close()}
        title="New Supplier"
        width="wide"
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button
              variant="primary"
              pending={create.isPending}
              onClick={() =>
                ready ? create.mutate() : setAsked((was) => was + 1)
              }
            >
              {create.isPending ? "Submitting…" : "Submit"}
            </Button>
          </div>
        }
      >
        {/* Pulled up 12px: the sheet's own 32px above the first heading read as
            a gap, not as air (the owner, 2026-10-05). */}
        <div ref={form} className="-mt-2 flex flex-col gap-4 md:-mt-3">
          {create.isError && (
            <Banner tone="bad">{(create.error as Error).message}</Banner>
          )}
          <CompanyFields
            draft={draft}
            set={set}
            locked={() => false}
            tried={asked > 0}
          />
          <ContactsFields contacts={contacts} onChange={setContacts} />
          <NotesField
            value={draft.notes}
            onChange={(notes) => set({ notes })}
            disabled={false}
          />
        </div>
      </Sheet>
      <SavedDialog
        open={saved !== null}
        onOpenChange={(next) => {
          if (!next) readSaved()
        }}
        title={<>{saved?.supplier_code} saved</>}
      >
        {savedNote}
      </SavedDialog>
    </>
  )
}

// ---------------------------------------------------------------------------
// Reading and editing one

/// The record: the form it was created with, read-only, then its orders and
/// its catalogue. `?supplier=new` opens the composer instead.
function SupplierSheet({
  id,
  onClose,
}: {
  id: string | null
  onClose: () => void
}) {
  const client = useQueryClient()
  const idempotency = useIdempotencyKey()
  const creating = id === "new"
  const [tab, setTab] = useState("details")
  /// The edit in progress, carrying the id it was typed against: the sheet
  /// stays mounted while the list swaps records under it, and a draft about
  /// another supplier counts as no draft at all.
  /// The company facts are all editable (the owner, 2026-10-04): the same
  /// draft the composer holds, with the notes and contacts beside it.
  const [edit, setEdit] = useState<
    | (SupplierDraft & {
        readonly id: string
        readonly contacts: readonly ContactDraft[]
      })
    | null
  >(null)
  const editing = edit !== null && edit.id === id ? edit : null

  const detail = useQuery({
    queryKey: procurementKeys.supplier(id ?? ""),
    queryFn: ({ signal }) => supplierDetail(id!, signal),
    enabled: id !== null && !creating,
  })
  const people = useQuery({
    queryKey: procurementKeys.supplierContacts(id ?? ""),
    queryFn: ({ signal }) => supplierContacts(id!, false, signal),
    enabled: id !== null && !creating,
  })

  const save = useMutation({
    mutationFn: async () => {
      const supplier = detail.data!
      const draft = editing!
      const changed =
        supplier.name !== draft.name.trim() ||
        (supplier.legal_form ?? "") !== draft.legalForm ||
        (supplier.address ?? "") !== draft.address.trim() ||
        (supplier.email ?? "") !== draft.email.trim() ||
        (shownPhone(supplier.phone) ?? "") !== formatPhones(draft.phone) ||
        (supplier.npwp ?? "") !== npwpDigits(draft.npwp) ||
        (supplier.is_pkp ?? false) !== draft.isPkp ||
        (supplier.notes ?? "") !== draft.notes.trim()
      if (changed) {
        await updateSupplier(
          supplier.supplier_id,
          {
            supplier_code: null,
            name: draft.name.trim(),
            legal_form: blank(draft.legalForm),
            address: blank(draft.address),
            email: blank(draft.email),
            phone: blank(formatPhones(draft.phone)),
            npwp: blank(npwpDigits(draft.npwp)),
            is_pkp: draft.isPkp,
            notes: blank(draft.notes),
          },
          supplier.version,
          idempotency.key
        )
      }
      const before = new Map(
        (people.data ?? []).map((one) => [one.contact_id, one])
      )
      const kept = new Set<string>()
      for (const contact of draft.contacts) {
        if (contactEmpty(contact)) continue
        const was =
          contact.contactId === undefined
            ? undefined
            : before.get(contact.contactId)
        if (was === undefined) {
          await createSupplierContact(
            supplier.supplier_id,
            {
              name: contact.name.trim(),
              role: blank(contact.role),
              phone: blank(contact.phone),
              email: blank(contact.email),
              address: blank(contact.address),
            },
            crypto.randomUUID()
          )
          continue
        }
        kept.add(was.contact_id)
        if (
          was.name !== contact.name.trim() ||
          (was.role ?? "") !== contact.role.trim() ||
          // Compared as written: the box shows a stored number grouped, and
          // an untouched one must not read as a change.
          (shownPhone(was.phone) ?? "") !== contact.phone.trim() ||
          (was.email ?? "") !== contact.email.trim() ||
          (was.address ?? "") !== contact.address.trim()
        ) {
          await updateSupplierContact(
            supplier.supplier_id,
            was.contact_id,
            {
              name: contact.name.trim(),
              role: blank(contact.role),
              phone: blank(contact.phone),
              email: blank(contact.email),
              address: blank(contact.address),
            },
            was.version,
            crypto.randomUUID()
          )
        }
      }
      // Somebody taken off the list is retired, not deleted: the orders they
      // were the contact on still name them.
      for (const was of before.values()) {
        if (kept.has(was.contact_id)) continue
        await updateSupplierContact(
          supplier.supplier_id,
          was.contact_id,
          { retired: true },
          was.version,
          crypto.randomUUID()
        )
      }
    },
    onSuccess: () => {
      void client.invalidateQueries({
        queryKey: procurementKeys.supplier(detail.data!.supplier_id),
      })
      void client.invalidateQueries({ queryKey: procurementKeys.suppliers() })
      idempotency.rotate()
      setEdit(null)
      setSavedEdit(true)
    },
    onError: () => {
      // Whatever part went through is on the server now; read it back so the
      // next Save starts from what is there.
      void client.invalidateQueries({
        queryKey: procurementKeys.supplier(detail.data!.supplier_id),
      })
    },
  })
  /// A save that went through, held in the receipt dialog until it is read —
  /// the sheet underneath already reads the record again.
  const [savedEdit, setSavedEdit] = useState(false)

  if (creating) {
    // Back to the book once the number has been read: the owner's "save,
    // see the number, close" (2026-09-28). The row is in the list, refetched.
    return <SupplierComposer open onClose={onClose} />
  }

  const supplier = detail.data
  const contacts = editing
    ? editing.contacts
    : (people.data ?? []).map(contactDraftOf)

  return (
    <>
      <Sheet
        open={id !== null}
        onOpenChange={(open) => !open && onClose()}
        id={supplier?.supplier_code}
        title={
          supplier === undefined ? "Supplier" : supplierDisplayName(supplier)
        }
        badge={
          supplier && (
            <Pill tone={supplier.status === "ACTIVE" ? "ok" : "neutral"}>
              {statusLabel(supplier.status)}
            </Pill>
          )
        }
        width="wide"
        footer={
          editing ? (
            <div className="flex items-center justify-end gap-2">
              <Button variant="ghost" onClick={() => setEdit(null)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                pending={save.isPending}
                disabled={
                  !saveable(editing) || !contactsSaveable(editing.contacts)
                }
                onClick={() => save.mutate()}
              >
                {save.isPending ? "Submitting…" : "Submit"}
              </Button>
            </div>
          ) : (
            supplier && (
              // Along the foot on every screen, the same on a desk and a
              // phone (owner, 2026-10-05): Print the icon at the left, Edit the
              // main action at the right.
              <div className="flex items-center gap-2 [&_button]:h-9">
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label="Print"
                  title="Print"
                  className="w-9 px-0!"
                  onClick={() =>
                    printSuppliers([
                      {
                        supplier,
                        contacts: (people.data ?? []).map(contactDraftOf),
                      },
                    ])
                  }
                >
                  <Printer />
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  className="ml-auto px-4"
                  onClick={() => {
                    save.reset()
                    setTab("details")
                    setEdit({
                      id: id!,
                      name: supplier.name,
                      legalForm: supplier.legal_form ?? "",
                      address: supplier.address ?? "",
                      email: supplier.email ?? "",
                      phone: shownPhone(supplier.phone) ?? "",
                      npwp: formatNpwp(supplier.npwp ?? ""),
                      isPkp: supplier.is_pkp ?? false,
                      notes: supplier.notes ?? "",
                      contacts: [...(people.data ?? []).map(contactDraftOf)],
                    })
                  }}
                >
                  Edit
                </Button>
              </div>
            )
          )
        }
      >
        {queryState(detail, {
          loading: "Loading the supplier…",
          render: (record) => (
            // The tabs keep their own air under them; each tab's body sets
            // its own rhythm below that.
            <div className="flex flex-col">
              {!editing && (
                <SubTabs
                  tabs={[
                    { value: "details", label: "Details" },
                    { value: "orders", label: "Orders" },
                    { value: "catalogue", label: "Catalogue" },
                  ]}
                  value={tab}
                  onChange={setTab}
                />
              )}
              {(editing || tab === "details") && (
                // Room between the parts of the record (2026-09-28: "kurang
                // spacing"): each section's rule sits in 24px of air, not 16.
                <div className="flex flex-col gap-7 pt-2">
                  {save.isError && (
                    <Banner tone="bad">{(save.error as Error).message}</Banner>
                  )}
                  {editing && <StatusSwitch supplier={record} />}
                  {editing ? (
                    // The same form the supplier was created with, every box
                    // open (the owner, 2026-10-04).
                    <CompanyFields
                      draft={editing}
                      set={(patch) => setEdit({ ...editing, ...patch })}
                      locked={() => false}
                      tried
                    />
                  ) : (
                    <CompanyFacts supplier={record} />
                  )}
                  <ContactsFields
                    contacts={contacts}
                    readOnly={!editing}
                    onChange={(next) =>
                      editing && setEdit({ ...editing, contacts: next })
                    }
                  />
                  {/* Notes are read as a fact here; they are not part of the edit. */}
                  <Section title="Notes" rule={false} quiet>
                    <p className="text-[0.875rem] leading-[1.375rem] whitespace-pre-wrap text-ink">
                      {record.notes?.trim() || (
                        <span className="text-body">—</span>
                      )}
                    </p>
                  </Section>
                  {!editing && (
                    <RecordPanel
                      subject={{ kind: "supplier", id: record.supplier_id }}
                    />
                  )}
                </div>
              )}
              {!editing && tab === "orders" && (
                <SupplierOrders supplier={record} />
              )}
              {!editing && tab === "catalogue" && (
                <SupplierCatalogue supplierId={record.supplier_id} />
              )}
            </div>
          ),
        })}
      </Sheet>
      <SavedDialog
        open={savedEdit}
        onOpenChange={(next) => {
          if (!next) setSavedEdit(false)
        }}
        title="Supplier Saved"
      />
    </>
  )
}

/// Whether an order can still be raised against this supplier.
///
/// In the edit, where the owner put it. Switching a supplier off says what it
/// means before it happens — no order can be raised against them — and asks
/// Continue or Cancel; switching one back on needs no warning.
function StatusSwitch({ supplier }: { supplier: Supplier }) {
  const client = useQueryClient()
  const idempotency = useIdempotencyKey()
  const [asking, setAsking] = useState(false)
  const active = supplier.status === "ACTIVE"

  const change = useMutation({
    mutationFn: (status: SupplierStatus) =>
      setSupplierStatus(
        supplier.supplier_id,
        status,
        supplier.version,
        idempotency.key
      ),
    onSuccess: () => {
      void client.invalidateQueries({
        queryKey: procurementKeys.supplier(supplier.supplier_id),
      })
      void client.invalidateQueries({ queryKey: procurementKeys.suppliers() })
      // The Activity under the record says it was switched.
      void client.invalidateQueries({
        queryKey: recordKeys.info("supplier", supplier.supplier_id),
      })
      idempotency.rotate()
    },
    onError: (problem: Error) => toast.error(problem.message),
  })

  return (
    <div className="flex items-center justify-between gap-3 rounded-inner border border-hairline px-3.5 py-3">
      <span className="flex flex-col">
        <span className="text-[0.875rem] font-medium text-ink">
          {active ? "Active" : "Non-active"}
        </span>
        <span className="text-[0.875rem] text-body">
          {active
            ? "Purchase orders can be issued to this supplier."
            : "No purchase order can be issued to this supplier."}
        </span>
      </span>
      <Switch
        on={active}
        label="Active"
        onToggle={() => {
          if (change.isPending) return
          if (active) setAsking(true)
          else change.mutate("ACTIVE")
        }}
      />
      <Dialog
        open={asking}
        onOpenChange={setAsking}
        title="Make This Supplier Non-Active?"
        confirm="Continue"
        cancel="Cancel"
        tone="danger"
        pending={change.isPending}
        onConfirm={() => {
          setAsking(false)
          change.mutate("INACTIVE")
        }}
      >
        A non-active supplier cannot be used to create a purchase order.
      </Dialog>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Orders

type OrderGroup = "active" | "completed" | "cancelled"

/// Each group's second date is the one that matters for it (the owner,
/// 2026-09-28): an active order is waiting on its delivery date, a completed
/// one was fulfilled on a day, a cancelled one was cancelled on a day.
/// `fulfilled_at` carries both of the last two — for a cancelled order it is
/// when its lines were closed, which is the cancellation.
const GROUPS: readonly {
  readonly key: OrderGroup
  readonly title: string
  readonly statuses: readonly string[]
  readonly dateLabel: string
  readonly date: (order: PurchaseOrderRow) => string | null
}[] = [
  {
    key: "active",
    title: "Active Order",
    statuses: ["ACTIVE", "PARTIALLY_RECEIVED"],
    dateLabel: "Delivery Date",
    date: (order) => order.expected_arrival,
  },
  {
    key: "completed",
    title: "Completed Order",
    statuses: ["FULLY_RECEIVED", "SHORT_RECEIVED"],
    dateLabel: "Date Fulfilled",
    date: (order) => order.fulfilled_at,
  },
  {
    key: "cancelled",
    title: "Cancelled Order",
    statuses: ["CANCELLED"],
    dateLabel: "Date Cancelled",
    date: (order) => order.fulfilled_at,
  },
]

/// Newest issued first — the order the tab and its sheet both read in.
function newestFirst(left: PurchaseOrderRow, right: PurchaseOrderRow): number {
  return (right.issued_at ?? "").localeCompare(left.issued_at ?? "")
}

/// Everything ordered from this supplier, in the three groups the owner asked
/// for — the five newest of each, and View all for the rest.
///
/// By the supplier CODE, on the wire: `purchase_order.supplier_id` is the
/// business-code snapshot, not the register's uuid.
function SupplierOrders({ supplier }: { supplier: Supplier }) {
  const [all, setAll] = useState<OrderGroup | null>(null)
  /// The order being read, opened over this sheet without leaving it.
  const [reading, setReading] = useState<string | null>(null)
  const navigate = useNavigate()
  const scope = { suppliers: [supplier.supplier_code] }
  const orders = useQuery({
    queryKey: procurementKeys.orders(scope),
    queryFn: ({ signal }) => listPurchaseOrders(scope, signal),
  })

  const grouped = useMemo(() => {
    const rows = [...(orders.data ?? [])].sort(newestFirst)
    return Object.fromEntries(
      GROUPS.map((group) => [
        group.key,
        rows.filter((row) => group.statuses.includes(row.lifecycle)),
      ])
    ) as Record<OrderGroup, PurchaseOrderRow[]>
  }, [orders.data])

  const open = GROUPS.find((group) => group.key === all)

  return queryState(orders, {
    loading: "Reading the order book…",
    render: () => (
      <div className="flex flex-col gap-10 pt-6">
        {/* The owner's model (2026-09-26): each kind of order as a heading
            with its orders listed under it — the five newest, and View all
            for the rest. */}
        {GROUPS.map((group) => {
          const rows = grouped[group.key]
          return (
            <section key={group.key} className="flex flex-col gap-3.5">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-[0.9375rem] font-semibold text-ink">
                  {group.title}
                  <span className="ml-1.5 font-normal text-body tabular-nums">
                    {count(rows.length)}
                  </span>
                </h3>
              </div>
              {rows.length === 0 ? (
                <p className="text-[0.875rem] text-body">None.</p>
              ) : (
                <OrdersTable
                  group={group}
                  rows={rows.slice(0, 5)}
                  onOpen={setReading}
                />
              )}
              {rows.length > 5 && (
                <Button
                  variant="ghost"
                  className="w-full"
                  onClick={() => setAll(group.key)}
                >
                  View all {count(rows.length)}
                </Button>
              )}
            </section>
          )
        })}
        <Sheet
          open={open !== undefined}
          onOpenChange={(next) => !next && setAll(null)}
          title={open?.title ?? ""}
          caption={supplierDisplayName(supplier)}
          width="wide"
        >
          {open !== undefined && (
            <OrdersTable
              group={open}
              rows={grouped[open.key]}
              onOpen={setReading}
            />
          )}
        </Sheet>
        <OrderSheet
          id={reading}
          onClose={() => setReading(null)}
          onEdit={(id) =>
            void navigate({
              to: "/procurement/orders",
              search: { "edit-order": id },
            } as never)
          }
        />
      </div>
    ),
  })
}

/// Order | Date issued | the group's date | Qty | Value, each row crossing
/// into the order. The same table under each heading and in View all, so the
/// five newest read exactly like the rest.
function OrdersTable({
  group,
  rows,
  onOpen,
}: {
  group: (typeof GROUPS)[number]
  rows: readonly PurchaseOrderRow[]
  onOpen: (id: string) => void
}) {
  return (
    <>
      {/* A phone: one card per order — the number and its value on a line, the
          dates and the pieces under them — instead of the table's cells
          stacked under their labels. The same facts as the table. */}
      <ul className="flex flex-col md:hidden">
        {rows.map((order) => (
          <li
            key={order.purchase_order_id}
            className="flex flex-col gap-0.5 border-t border-hairline py-3.5 first:border-t-0"
          >
            <div className="flex items-baseline justify-between gap-3">
              <button
                type="button"
                onClick={() => onOpen(order.purchase_order_id)}
                className="font-mono text-[0.9375rem] text-accent"
              >
                {order.po_number}
              </button>
              <span className="font-medium whitespace-nowrap text-ink tabular-nums">
                {money(order.net_minor)}
              </span>
            </div>
            <span className="text-[0.875rem] text-mute tabular-nums">
              {`Date Issued ${day(order.issued_at)}`}
            </span>
            <span className="text-[0.875rem] text-mute tabular-nums">
              {`${group.dateLabel} ${day(group.date(order))} · ${pcs(order.expected_stock_units)}`}
            </span>
          </li>
        ))}
      </ul>
      <div className="max-md:hidden">
        <MiniTable
          head={[
            "Order",
            { label: "Date Issued", align: "left" },
            { label: group.dateLabel, align: "left" },
            "Quantity",
            "Value",
          ]}
        >
          {rows.map((order) => (
            <MiniRow key={order.purchase_order_id}>
              <MiniCell className="py-2.5">
                <button
                  type="button"
                  onClick={() => onOpen(order.purchase_order_id)}
                  className="font-mono text-[0.875rem] text-accent hover:underline"
                >
                  {order.po_number}
                </button>
              </MiniCell>
              <MiniCell className="py-2.5 tabular-nums">
                {day(order.issued_at)}
              </MiniCell>
              <MiniCell className="py-2.5 tabular-nums">
                {day(group.date(order))}
              </MiniCell>
              <MiniCell align="right" className="py-2.5">
                {pcs(order.expected_stock_units)}
              </MiniCell>
              <MiniCell align="right" className="py-2.5 font-medium text-ink">
                {money(order.net_minor)}
              </MiniCell>
            </MiniRow>
          ))}
        </MiniTable>
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// Printing

/// Suppliers on A5, one sheet each, printed from a window of their own.
///
/// Its own document rather than a print stylesheet over the app: the sheet
/// the record sits in is a portal over a list over a shell, and hiding all of
/// that for the printer is a fight with every layer. A5 is the owner's size.
/// Several at once — ticked on the list — is one print job with a page break
/// between them (the owner, 2026-09-28).
function printSuppliers(
  pages: readonly {
    readonly supplier: Supplier
    readonly contacts: readonly ContactDraft[]
  }[]
) {
  if (pages.length === 0) return
  const fact = (term: string, value: string | null | undefined) =>
    `<tr><th>${escapeHtml(term)}</th><td>${escapeHtml(value?.trim() || "—")}</td></tr>`
  const page = (
    supplier: Supplier,
    contacts: readonly ContactDraft[]
  ) => `<section class="page">
<div class="code">${escapeHtml(supplier.supplier_code)}</div>
<h1>${escapeHtml(supplierDisplayName(supplier))}</h1>
<h2>Company</h2>
<table class="facts">${fact("Status", statusLabel(supplier.status))}${fact("Address", supplier.address)}${fact("Email", supplier.email)}${fact("Phone number", shownPhone(supplier.phone))}${fact("NPWP", shownNpwp(supplier.npwp))}${fact("PKP", supplier.is_pkp ? "Yes" : "No")}</table>
<h2>Contact person</h2>${
    contacts.length === 0
      ? `<p class="none">No contact person on file.</p>`
      : `<table class="grid"><thead><tr><th>Name</th><th>Role</th><th>Phone</th><th>Email</th><th>Address</th></tr></thead><tbody>${contacts
          .map(
            (one) =>
              `<tr><td>${escapeHtml(one.name)}</td><td>${escapeHtml(one.role || "—")}</td><td>${escapeHtml(one.phone || "—")}</td><td>${escapeHtml(one.email || "—")}</td><td>${escapeHtml(one.address || "—")}</td></tr>`
          )
          .join("")}</tbody></table>`
  }
<h2>Notes</h2><p class="notes">${escapeHtml(supplier.notes?.trim() || "—")}</p>
</section>`
  const title =
    pages.length === 1
      ? `${pages[0].supplier.supplier_code} ${supplierDisplayName(pages[0].supplier)}`
      : `${pages.length} suppliers`
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(
    title
  )}</title><style>
@page { size: A5; margin: 12mm; }
* { box-sizing: border-box; }
body { font-family: Inter, -apple-system, "Segoe UI", sans-serif; font-size: 14px; color: #1d1f1a; margin: 0; }
.page { break-after: page; }
.page:last-child { break-after: auto; }
h1 { font-size: 18px; margin: 0 0 2px; }
.code { font-family: ui-monospace, Menlo, monospace; color: #5b6158; font-size: 14px; }
h2 { font-size: 14px; text-transform: uppercase; letter-spacing: .04em; color: #5b6158; margin: 16px 0 6px; }
table { width: 100%; border-collapse: collapse; }
.facts th { text-align: left; font-weight: 500; color: #5b6158; width: 34%; padding: 3px 8px 3px 0; vertical-align: top; }
.facts td { padding: 3px 0; }
.grid th, .grid td { text-align: left; padding: 4px 6px; border-bottom: 1px solid #ddd; font-size: 14px; }
.grid th { font-weight: 500; color: #5b6158; }
.none, .notes { margin: 0; white-space: pre-wrap; }
</style></head><body>
${pages.map((one) => page(one.supplier, one.contacts)).join("\n")}
</body></html>`
  const view = window.open("", "_blank", "width=620,height=860")
  if (view === null) {
    toast.error("The print window was blocked. Allow pop-ups and try again.")
    return
  }
  view.document.open()
  view.document.write(html)
  view.document.close()
  view.focus()
  // After layout, so the printer is handed a page that has been drawn.
  setTimeout(() => view.print(), 300)
}

// ---------------------------------------------------------------------------
// The catalogue

/// A vocabulary code written for reading: `SANDAL_SEPATU` → "Sandal sepatu".
function humanCode(code: string | null | undefined): string {
  if (!code) return "—"
  const text = code.replaceAll("_", " ").toLowerCase()
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/// Code | Item | Division | Tags | Price | Status. A row opens the item as
/// sourcing reads it, over this sheet.
function CatalogueTable({
  items,
  onOpen,
}: {
  items: readonly SupplierItem[]
  onOpen: (item: SupplierItem) => void
}) {
  return (
    <>
      {/* A phone: one card per item — the name and its price on a line, what it
          is filed under and its code under them, the status beside the code —
          the same facts as the table, not its cells stacked under labels. */}
      <ul className="flex flex-col md:hidden">
        {items.map((item) => (
          <li
            key={item.supplier_item_id}
            className="border-t border-hairline first:border-t-0"
          >
            <button
              type="button"
              onClick={() => onOpen(item)}
              className="flex w-full items-start justify-between gap-3 py-3.5 text-left"
            >
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate text-[0.9375rem] text-accent">
                  {item.name}
                </span>
                <span className="truncate text-[0.875rem] text-body">
                  {[
                    humanCode(item.division_code),
                    item.tags.map(humanCode).join(", "),
                  ]
                    .filter((part) => part !== "" && part !== "—")
                    .join(" · ")}
                </span>
                <span className="font-mono text-[0.875rem] text-mute">
                  {realItemCode(item.supplier_item_code)}
                </span>
              </span>
              <span className="flex shrink-0 flex-col items-end gap-1.5">
                <span className="font-semibold whitespace-nowrap text-ink tabular-nums">
                  {money(item.unit_price_minor)}
                </span>
                <Pill tone={item.status === "ACTIVE" ? "ok" : "neutral"}>
                  {item.status === "ACTIVE" ? "Active" : "Cancelled"}
                </Pill>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <div className="max-md:hidden">
        <MiniTable
          head={[
            { label: "Code", align: "left" },
            { label: "Item", align: "left" },
            { label: "Division", align: "left" },
            { label: "Tags", align: "left" },
            { label: "Price", align: "right" },
            { label: "Status", align: "right" },
          ]}
        >
          {items.map((item) => (
            <tr
              key={item.supplier_item_id}
              onClick={() => onOpen(item)}
              className="cursor-pointer border-t border-hairline transition-colors hover:bg-soft-2"
            >
              <td className="py-4 pl-3 font-mono text-[0.875rem] text-mute first:pl-0">
                {realItemCode(item.supplier_item_code)}
              </td>
              <td className="py-4 pl-3 first:pl-0">
                <span className="text-[0.875rem] text-accent">{item.name}</span>
              </td>
              <td className="py-4 pl-3 text-[0.875rem] text-body first:pl-0">
                {humanCode(item.division_code)}
              </td>
              <td className="py-4 pl-3 text-[0.875rem] text-mute first:pl-0">
                {item.tags.map(humanCode).join(", ") || "—"}
              </td>
              <td className="py-4 pl-3 text-right text-[0.9375rem] font-semibold text-ink tabular-nums">
                {money(item.unit_price_minor)}
              </td>
              <td className="py-4 pl-3 text-right">
                <Pill tone={item.status === "ACTIVE" ? "ok" : "neutral"}>
                  {item.status === "ACTIVE" ? "Active" : "Cancelled"}
                </Pill>
              </td>
            </tr>
          ))}
        </MiniTable>
      </div>
    </>
  )
}

/// What this supplier offers, and adding to it.
function SupplierCatalogue({ supplierId }: { supplierId: string }) {
  const [viewAll, setViewAll] = useState(false)
  /// The item being read, opened over this sheet without leaving it.
  const [reading, setReading] = useState<SupplierItem | null>(null)
  const vocabulary = useQuery({
    queryKey: procurementKeys.vocabulary(),
    queryFn: ({ signal }) => catalogueVocabulary(signal),
    staleTime: 30 * 60 * 1000,
  })
  /// The full item form, the one Catalogue and the order composer use, over
  /// this sheet; `editing` is the item being corrected.
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState(false)

  const items = useQuery({
    queryKey: procurementKeys.supplierCatalogue(supplierId),
    queryFn: ({ signal }) => supplierCatalogue(supplierId, {}, signal),
  })

  return (
    <div className="flex flex-col gap-3.5 pt-6">
      {queryState(items, {
        loading: "Reading the catalogue…",
        render: (page) =>
          page.items.length === 0 ? (
            <p className="text-[0.875rem] text-body">
              This supplier offers nothing yet, so no order can name them.
            </p>
          ) : (
            <>
              <CatalogueTable
                items={page.items.slice(0, 5)}
                onOpen={setReading}
              />
              {page.items.length > 5 && (
                <Button
                  variant="ghost"
                  className="w-full"
                  onClick={() => setViewAll(true)}
                >
                  View all {count(page.items.length)}
                </Button>
              )}
              <Sheet
                open={viewAll}
                onOpenChange={setViewAll}
                title="Catalogue"
                width="wide"
              >
                <CatalogueTable items={page.items} onOpen={setReading} />
              </Sheet>
              <Sheet
                open={reading !== null}
                onOpenChange={(next) => !next && setReading(null)}
                id={realItemCode(reading?.supplier_item_code)}
                title={reading?.name ?? ""}
                width="wide"
                actions={
                  reading !== null && (
                    <Button size="sm" onClick={() => setEditing(true)}>
                      Edit
                    </Button>
                  )
                }
              >
                {reading !== null && (
                  <ItemDetail item={reading} vocabulary={vocabulary.data} />
                )}
              </Sheet>
              {page.next_cursor !== null && (
                <p className="text-[0.875rem] text-body">
                  The first {count(page.limit)} of this supplier's catalogue.
                  The whole of it is on the catalogue screen.
                </p>
              )}
            </>
          ),
      })}

      <Button onClick={() => setAdding(true)}>Add item</Button>
      <ItemFormSheet
        open={adding}
        supplierId={supplierId}
        onClose={() => setAdding(false)}
        onSaved={() => setAdding(false)}
      />
      {reading !== null && (
        <ItemFormSheet
          open={editing}
          item={reading}
          onClose={() => setEditing(false)}
          onSaved={(saved) => {
            setEditing(false)
            setReading(saved)
          }}
        />
      )}
    </div>
  )
}
