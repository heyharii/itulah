import { useForm } from "@tanstack/react-form"
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { Pencil, Plus, Printer, Search, Trash2 } from "lucide-react"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Dialog } from "@/components/ui/dialog"
import { Fab } from "@/components/ui/fab"
import { Field, Input, Select, Textarea } from "@/components/ui/field"
import { FilterPanel } from "@/components/ui/filter-panel"
import { Switch, Toggle } from "@/components/ui/form"
import {
  ColumnsMenu,
  DockedFilters,
  ExportCsv,
  ListOptionsSheet,
  ViewPicker,
} from "@/components/ui/list-chrome"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { MiniTable, Section } from "@/components/ui/rows"
import { Sheet } from "@/components/ui/sheet"
import { SubTabs } from "@/components/ui/sub-tabs"
import { Banner, EmptyState } from "@/components/ui/states"
import type { CsvColumn } from "@/lib/csv"
import { useFilterState, type FilterField } from "@/lib/filters"
import { count, day, money } from "@/lib/format"
import { usePanelDock } from "@/lib/layout"
import {
  allSupplierContacts,
  createSupplier,
  createSupplierContact,
  createSupplierItem,
  listPurchaseOrders,
  procurementKeys,
  setSupplierStatus,
  supplierCatalogue,
  supplierContacts,
  supplierDetail,
  supplierPage,
  supplierScopeFromFilters,
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
import { LinkButton } from "@/screens/procurement/controls"
import { useIdempotencyKey } from "@/screens/procurement/shared"
import {
  LEGAL_FORMS,
  completeNpwp,
  emailProblem,
  formatNpwp,
  formatPhone,
  npwpProblem,
  phoneProblem,
  supplierDisplayName,
} from "@/screens/procurement/supplier-format"
import type {
  Supplier,
  SupplierContact,
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

const columns: ColumnDef<TableSetup, SupplierRow>[] = [
  {
    id: "no",
    header: "No",
    size: 64,
    enableSorting: false,
    enableHiding: false,
    meta: { align: "right", card: "hide" },
    cell: ({ row }) => (
      <span className="text-body tabular-nums">{row.index + 1}</span>
    ),
  },
  {
    accessorKey: "name",
    header: "Supplier",
    size: 280,
    meta: { card: "title" },
    cell: ({ row }) => (
      <span className="font-medium text-ink">
        {supplierDisplayName(row.original)}
      </span>
    ),
  },
  {
    accessorKey: "supplier_code",
    header: "Code",
    size: 110,
    meta: { card: "id", mono: true },
    cell: ({ row }) => (
      <span className="font-mono text-[0.875rem] text-body">
        {row.original.supplier_code}
      </span>
    ),
  },
  {
    accessorKey: "status",
    header: "Status",
    size: 130,
    meta: { card: "status" },
    cell: ({ row }) => (
      <Pill tone={row.original.status === "ACTIVE" ? "ok" : "neutral"}>
        {statusLabel(row.original.status)}
      </Pill>
    ),
  },
  {
    accessorKey: "active",
    header: "Active PO",
    size: 110,
    meta: { align: "right", card: "metric" },
    cell: ({ row }) => (
      <span className="tabular-nums">{count(row.original.active)}</span>
    ),
  },
  {
    accessorKey: "completed",
    header: "Completed PO",
    size: 130,
    meta: { align: "right", card: "hide", priority: 2 },
    cell: ({ row }) => (
      <span className="tabular-nums">{count(row.original.completed)}</span>
    ),
  },
  {
    accessorKey: "cancelled",
    header: "Cancelled PO",
    size: 130,
    meta: { align: "right", card: "hide", priority: 2 },
    cell: ({ row }) => (
      <span className="tabular-nums">{count(row.original.cancelled)}</span>
    ),
  },
  {
    accessorKey: "lastOrdered",
    header: "Last purchased",
    size: 150,
    meta: { card: "meta", priority: 2 },
    cell: ({ row }) => (
      <span className="tabular-nums">{day(row.original.lastOrdered)}</span>
    ),
  },
  // Off until somebody switches them on in Columns.
  {
    accessorKey: "address",
    header: "Company address",
    size: 260,
    enableSorting: false,
    meta: { card: "hide" },
    cell: ({ row }) => (
      <span className="line-clamp-2 text-text">
        {row.original.address ?? "—"}
      </span>
    ),
  },
  {
    accessorKey: "email",
    header: "Company email",
    size: 220,
    enableSorting: false,
    meta: { card: "hide" },
    cell: ({ row }) => (
      <span className="text-text">{row.original.email ?? "—"}</span>
    ),
  },
  {
    accessorKey: "phone",
    header: "Company phone",
    size: 170,
    enableSorting: false,
    meta: { card: "hide" },
    cell: ({ row }) => (
      <span className="tabular-nums">{row.original.phone ?? "—"}</span>
    ),
  },
  {
    accessorKey: "npwp",
    header: "NPWP",
    size: 200,
    enableSorting: false,
    meta: { card: "hide" },
    cell: ({ row }) => (
      <span className="tabular-nums">{row.original.npwp ?? "—"}</span>
    ),
  },
  {
    accessorKey: "is_pkp",
    header: "PKP",
    size: 90,
    enableSorting: false,
    meta: { card: "hide" },
    cell: ({ row }) => (row.original.is_pkp ? "Yes" : "No"),
  },
]

/// The optional columns, off until they are asked for.
const HIDDEN_BY_DEFAULT: VisibilityState = {
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
  { label: "Phone number", value: (row) => row.supplier.phone },
  { label: "NPWP", value: (row) => row.supplier.npwp },
  { label: "Contact name", value: (row) => row.contact?.name },
  { label: "Contact role", value: (row) => row.contact?.role },
  { label: "Contact phone", value: (row) => row.contact?.phone },
  { label: "Contact email", value: (row) => row.contact?.email },
  { label: "Contact address", value: (row) => row.contact?.address },
]

export function Suppliers() {
  // Which supplier is open lives in the URL, like every other sheet in the app.
  const supplier = useSheet("supplier")
  /// What was typed into the omnibox, also in the URL.
  const search = useSheet("q")
  // Nothing chosen is the house order: active suppliers first, then by name.
  const [sorting, setSorting] = useState<SortingState>([])
  const [visibility, setVisibility] =
    useState<VisibilityState>(HIDDEN_BY_DEFAULT)

  /// The one thing this book can be narrowed by, and the only one the endpoint
  /// answers. `single`, because it compares one column to one value.
  const fields = useMemo<FilterField[]>(
    () => [
      {
        column: "status",
        label: "Status",
        spec: {
          kind: "option",
          single: true,
          operators: ["isAnyOf"],
          options: [
            { value: "ACTIVE", label: "Active" },
            { value: "INACTIVE", label: "Non-active" },
          ],
          format: (code) => (code === "ACTIVE" ? "Active" : "Non-active"),
        },
      },
    ],
    []
  )

  const filters = useFilterState(fields)
  const docked = usePanelDock()

  /// The name typed, plus the chips, as the one request that answers both.
  /// Debounced: every keystroke is a round trip over the whole book.
  const typed = (search.value ?? "").trim()
  const needle = useDebounced(typed, 400)
  const order = sorting[0]
  const scope = useMemo<SupplierScope>(
    () => ({
      // This menu is the merchandise book. PLN, the landlord and the other
      // units of the group live on Finance's Vendors screen — see 0212.
      category: "MERCHANDISE",
      ...supplierScopeFromFilters(filters.filters),
      ...(needle === "" ? {} : { q: needle }),
      ...(order === undefined || SORTS[order.id] === undefined
        ? {}
        : { sort: SORTS[order.id], desc: order.desc }),
    }),
    [filters.filters, needle, order]
  )
  const narrowed = needle !== "" || filters.filters.length > 0

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

  const rows = useMemo<SupplierRow[]>(
    () => (book.data?.pages ?? []).flatMap(rowsOf),
    [book.data]
  )
  const first = book.data?.pages[0]

  /// The status field, carrying the server's tally over the whole book.
  const counted = useMemo<FilterField[]>(() => {
    const facets = first?.facets
    if (facets === undefined) return fields
    return fields.map((field) => ({
      ...field,
      spec: { ...field.spec, counted: facets.statuses },
    }))
  }, [fields, first])

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns,
        getRowId: (row: SupplierRow) => row.supplier_id,
        state: { sorting, columnVisibility: visibility },
        // The rows arrive in the order the request asked for. Sorting them
        // again here would sort what has loaded, not the book.
        manualSorting: true,
        onSortingChange: setSorting,
        onColumnVisibilityChange: setVisibility,
      }),
      [rows, sorting, visibility]
    )
  )

  /// Everything the filters match, every page of it, with its people.
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

  return (
    <PageContent>
      <PageHeader
        title="Suppliers"
        sub="Who we buy from, what each of them offers, and whether an order can be raised against them."
      />

      <div className="grid min-w-0 items-start gap-5 dock:grid-cols-[minmax(0,1fr)_16rem]">
        <div className="flex min-w-0 flex-col">
          <div className="mb-3 flex flex-wrap items-center gap-1.5">
            <span className="relative min-w-0 flex-1 md:mr-auto md:flex-none">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-line-ico" />
              <input
                value={search.value ?? ""}
                onChange={(event) =>
                  event.target.value
                    ? search.open(event.target.value)
                    : search.close()
                }
                placeholder="Search supplier name"
                aria-label="Search supplier name"
                className="h-[2.125rem] w-full rounded-inner border border-hairline-2 bg-canvas pr-2.5 pl-8 text-[0.875rem] text-ink shadow-soft outline-none placeholder:text-body focus:border-accent md:w-64 pointer-coarse:h-11"
              />
            </span>
            <ListOptionsSheet
              model={filters}
              filterModel={{ ...filters, fields: counted }}
              table={table}
              sorting={sorting}
              onSort={(id, desc) => setSorting([{ id, desc }])}
              id="suppliers"
              all="All suppliers"
              className="md:hidden"
            />
            <div className="hidden md:contents">
              {!docked && (
                <FilterPanel model={{ ...filters, fields: counted }} />
              )}
              <ColumnsMenu table={table} />
              <ExportCsv
                title="Suppliers"
                columns={EXPORT_COLUMNS}
                rows={exportRows}
              />
              <span aria-hidden className="mx-1 h-5 w-px bg-hairline" />
              <ViewPicker model={filters} id="suppliers" all="All suppliers" />
              <Button variant="primary" onClick={() => supplier.open("new")}>
                New supplier
              </Button>
            </div>
          </div>
          <Fab label="New supplier" onClick={() => supplier.open("new")} />

          <Card className="overflow-hidden">
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
                  <>
                    <DataTable<SupplierRow>
                      table={table}
                      cardSort={false}
                      onRowClick={(row) => supplier.open(row.supplier_id)}
                      isSelected={(row) => row.supplier_id === supplier.value}
                      onEndReached={() => {
                        if (book.hasNextPage && !book.isFetchingNextPage)
                          void book.fetchNextPage()
                      }}
                      className="max-h-[calc(100vh-14rem)]"
                    />
                    {book.isFetchingNextPage && (
                      <p className="border-t border-hairline px-3.5 py-2.5 text-[0.875rem] text-body">
                        Loading more suppliers…
                      </p>
                    )}
                  </>
                ),
            })}
          </Card>
        </div>

        <DockedFilters
          model={{ ...filters, fields: counted }}
          kpis={bookKpis(first)}
          id="suppliers"
          subject="Supplier"
          className="hidden dock:flex"
        />
      </div>

      <SupplierSheet
        id={supplier.value ?? null}
        onClose={supplier.close}
        onOpen={(id) => supplier.open(id)}
      />
    </PageContent>
  )
}

/// `49.923.900.000` → `Rp 49,9 M`. Indonesian scale: ribu, juta, miliar.
function brief(minor: number): string {
  const abs = Math.abs(minor)
  const [scale, suffix] =
    abs >= 1_000_000_000
      ? [1_000_000_000, " M"]
      : abs >= 1_000_000
        ? [1_000_000, " jt"]
        : abs >= 1_000
          ? [1_000, " rb"]
          : [1, ""]
  const scaled = minor / scale
  const shown =
    scale === 1 ? String(minor) : scaled.toFixed(scaled < 10 ? 1 : 0)
  return `Rp ${shown.replace(".", ",")}${suffix}`
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
      note: "Active suppliers.",
    },
    {
      label: "Non-active",
      value: count(of("INACTIVE")),
      note: "Non-active suppliers.",
    },
    {
      label: "Active PO",
      value: count(page.book.open_orders),
      note: "Purchase orders still waiting on goods: active or partially received.",
    },
    {
      label: "PO qty",
      value: count(page.book.open_units),
      note: "Pieces the active purchase orders still expect.",
    },
    {
      label: "PO value",
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

function draftOf(supplier: Supplier): SupplierDraft {
  return {
    legalForm: supplier.legal_form ?? "",
    name: supplier.name,
    address: supplier.address ?? "",
    email: supplier.email ?? "",
    phone: supplier.phone ?? "",
    npwp: supplier.npwp ?? "",
    isPkp: supplier.is_pkp,
    notes: supplier.notes ?? "",
  }
}

function blank(value: string): string | null {
  return value.trim() === "" ? null : value.trim()
}

/// What a saveable supplier is: a name, an address and a phone number — the
/// three the owner starred — each well-formed, and a well-formed email and
/// NPWP when given.
function saveable(draft: SupplierDraft, quick = false): boolean {
  return (
    draft.name.trim() !== "" &&
    draft.address.trim() !== "" &&
    draft.phone.trim() !== "" &&
    phoneProblem(draft.phone) === null &&
    (quick ||
      (emailProblem(draft.email) === null && npwpProblem(draft.npwp) === null))
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
    phone: contact.phone ?? "",
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

const LABEL = "text-[0.875rem] font-medium text-text"

/// A field's label, with the star the owner uses for "required".
function Label({
  children,
  required,
}: {
  children: React.ReactNode
  required?: boolean
}) {
  return (
    <span className={LABEL}>
      {children}
      {required && <span className="ml-0.5 text-bad">*</span>}
    </span>
  )
}

/// The company's facts, in the owner's order: number, legal form, name,
/// address, email, phone, NPWP, PKP.
///
/// `locked` says which fields are read rather than typed: all of them on a
/// record being read, all but the address on a record being edited, none on a
/// new supplier.
function CompanyFields({
  draft,
  set,
  code,
  locked,
  quick = false,
}: {
  draft: SupplierDraft
  set: (patch: Partial<SupplierDraft>) => void
  /// The supplier's number, or null before it has one.
  code: string | null
  locked: (field: keyof SupplierDraft) => boolean
  /// The order composer's quick add: the four facts a buyer at a counter has.
  quick?: boolean
}) {
  const [touched, setTouched] = useState({
    phone: false,
    email: false,
    npwp: false,
  })
  const touch = (patch: Partial<typeof touched>) =>
    setTouched((was) => ({ ...was, ...patch }))
  const phone = phoneProblem(draft.phone)
  const email = emailProblem(draft.email)
  const npwp = npwpProblem(draft.npwp)

  return (
    <Section title="Company">
      <div className="grid gap-4 md:grid-cols-2">
        <Field label={<Label>Supplier number</Label>}>
          <Input
            value={code ?? ""}
            disabled
            placeholder="Given when the supplier is saved"
            className="font-mono"
          />
        </Field>
        <Field label={<Label>Legal form</Label>}>
          <Select
            aria-label="Legal form"
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
        <Field label={<Label required>Name</Label>} className="md:col-span-2">
          <Input
            value={draft.name}
            disabled={locked("name")}
            onChange={(event) => set({ name: event.target.value })}
            placeholder="Sepatu Sejahtera"
          />
        </Field>
        <Field
          label={<Label required>Address</Label>}
          className="md:col-span-2"
        >
          <Textarea
            rows={2}
            value={draft.address}
            disabled={locked("address")}
            onChange={(event) => set({ address: event.target.value })}
            placeholder="Jl. Industri Raya No. 14, Bandung"
            className="disabled:opacity-50"
          />
        </Field>
        {!quick && (
          <Field
            label={<Label>Email</Label>}
            problem={touched.email ? email : null}
          >
            <Input
              type="email"
              inputMode="email"
              value={draft.email}
              disabled={locked("email")}
              onChange={(event) => set({ email: event.target.value })}
              onBlur={() => touch({ email: true })}
              aria-invalid={touched.email && email !== null}
              className={cn(touched.email && email !== null && "border-bad")}
              placeholder="orders@sepatusejahtera.co.id"
            />
          </Field>
        )}
        <Field
          label={<Label required>Phone number</Label>}
          problem={touched.phone ? phone : null}
        >
          <Input
            type="tel"
            inputMode="tel"
            value={draft.phone}
            disabled={locked("phone")}
            onChange={(event) =>
              set({ phone: formatPhone(event.target.value) })
            }
            onBlur={() => touch({ phone: true })}
            aria-invalid={touched.phone && phone !== null}
            className={cn(
              "tabular-nums",
              touched.phone && phone !== null && "border-bad"
            )}
            placeholder="0887 7993 12312"
          />
        </Field>
        {!quick && (
          <Field
            label={<Label>NPWP</Label>}
            aside="16 digits"
            problem={touched.npwp ? npwp : null}
          >
            <Input
              inputMode="numeric"
              value={draft.npwp}
              disabled={locked("npwp")}
              onChange={(event) =>
                set({ npwp: formatNpwp(event.target.value) })
              }
              onBlur={() => {
                set({ npwp: completeNpwp(draft.npwp) })
                touch({ npwp: true })
              }}
              aria-invalid={touched.npwp && npwp !== null}
              className={cn(
                "tabular-nums",
                touched.npwp && npwp !== null && "border-bad"
              )}
              placeholder="0012345678901000"
            />
          </Field>
        )}
        {!quick && (
          <div className="md:col-span-2">
            <Toggle
              on={draft.isPkp}
              onToggle={() => {
                if (!locked("isPkp")) set({ isPkp: !draft.isPkp })
              }}
              label="Pengusaha Kena Pajak (PKP)"
              note={
                draft.isPkp
                  ? "Their bills carry PPN and a faktur pajak number."
                  : "Their bills carry no PPN."
              }
            />
          </div>
        )}
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
      <Section title="Contact person">
        {contacts.length === 0 ? (
          <p className="text-[0.875rem] text-body">
            Nobody is on file at this supplier yet.
          </p>
        ) : (
          <MiniTable head={["Name", "Role", "Phone", "Email", "Address"]}>
            {contacts.map((one) => (
              <tr key={one.key} className="border-t border-hairline">
                <td className="py-2 pr-3 text-[0.875rem] text-ink">
                  {one.name}
                </td>
                <td className="py-2 pr-3 text-[0.875rem] text-text">
                  {one.role || "—"}
                </td>
                <td className="py-2 pr-3 text-[0.875rem] text-text tabular-nums">
                  {one.phone || "—"}
                </td>
                <td className="py-2 pr-3 text-[0.875rem] text-text">
                  {one.email || "—"}
                </td>
                <td className="py-2 text-[0.875rem] text-text">
                  {one.address || "—"}
                </td>
              </tr>
            ))}
          </MiniTable>
        )}
      </Section>
    )
  }

  return (
    <Section title="Contact person">
      <div className="flex flex-col gap-3">
        {contacts.map((one, index) => {
          const problem = contactProblem(one)
          return (
            <div
              key={one.key}
              className="flex flex-col gap-2 rounded-inner border border-hairline p-3 transition-[opacity,translate] duration-200 ease-(--ease-out) starting:translate-y-1 starting:opacity-0 motion-reduce:starting:translate-none"
            >
              <div className="grid gap-3 md:grid-cols-[1.2fr_0.8fr_1fr_1.2fr_auto] md:items-end">
                <Field label={<Label>Name</Label>}>
                  <Input
                    value={one.name}
                    onChange={(event) =>
                      patch(one.key, { name: event.target.value })
                    }
                    placeholder="Budi Santoso"
                    aria-label={`Contact ${index + 1} name`}
                  />
                </Field>
                <Field label={<Label>Role</Label>}>
                  <Input
                    value={one.role}
                    onChange={(event) =>
                      patch(one.key, { role: event.target.value })
                    }
                    placeholder="Sales"
                    aria-label={`Contact ${index + 1} role`}
                  />
                </Field>
                <Field label={<Label>Phone</Label>}>
                  <Input
                    type="tel"
                    inputMode="tel"
                    value={one.phone}
                    onChange={(event) =>
                      patch(one.key, { phone: formatPhone(event.target.value) })
                    }
                    placeholder="0812 3456 7890"
                    className="tabular-nums"
                    aria-label={`Contact ${index + 1} phone`}
                  />
                </Field>
                <Field label={<Label>Email</Label>}>
                  <Input
                    type="email"
                    inputMode="email"
                    value={one.email}
                    onChange={(event) =>
                      patch(one.key, { email: event.target.value })
                    }
                    placeholder="budi@sepatusejahtera.co.id"
                    aria-label={`Contact ${index + 1} email`}
                  />
                </Field>
                <Button
                  variant="quiet"
                  aria-label={`Remove contact ${index + 1}`}
                  onClick={() =>
                    onChange(contacts.filter((other) => other.key !== one.key))
                  }
                  className="size-10 self-end"
                >
                  <Trash2 />
                </Button>
              </div>
              <Field label={<Label>Address</Label>}>
                <Input
                  value={one.address}
                  onChange={(event) =>
                    patch(one.key, { address: event.target.value })
                  }
                  placeholder="Where this person is, if not the company address"
                  aria-label={`Contact ${index + 1} address`}
                />
              </Field>
              {problem !== null && (
                <span className="text-[0.875rem] text-bad">{problem}</span>
              )}
            </div>
          )
        })}
        <div>
          <Button onClick={() => onChange([...contacts, newContact()])}>
            <Plus />
            Add
          </Button>
        </div>
      </div>
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
    <Section title="Notes">
      <Textarea
        rows={3}
        aria-label="Notes"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Anything worth knowing about this supplier."
        className="disabled:opacity-50"
      />
    </Section>
  )
}

// ---------------------------------------------------------------------------
// Creating one

/// Creating one — a task over the page, the form the owner laid out:
/// Company, then Contact person, then Notes, and the number after Save.
export function SupplierComposer({
  open,
  onClose,
  onCreated,
  quick = false,
}: {
  open: boolean
  onClose: () => void
  /// The supplier that was just registered, for a caller with somewhere to
  /// put it — the order composer selects it into its picker, the book opens
  /// its record so the new number can be read.
  onCreated?: (supplier: Supplier) => void
  /// The order composer's way in: legal form, name, address and phone, and
  /// nothing else — a buyer at a supplier's counter knows those four.
  quick?: boolean
}) {
  const client = useQueryClient()
  const idempotency = useIdempotencyKey()
  const [draft, setDraft] = useState<SupplierDraft>(EMPTY)
  const [contacts, setContacts] = useState<readonly ContactDraft[]>(() => [
    newContact(),
  ])
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
          phone: blank(draft.phone),
          email: blank(draft.email),
          address: blank(draft.address),
          status: "ACTIVE",
          npwp: blank(draft.npwp),
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
      toast.success(
        `Supplier ${supplier.supplier_code} created`,
        { description: supplierDisplayName(supplier) }
      )
      reset()
      onCreated?.(supplier)
      if (onCreated === undefined) onClose()
    },
  })

  const reset = () => {
    setDraft(EMPTY)
    setContacts([newContact()])
  }
  /// The sheet stays mounted between openings, so without this the last
  /// supplier's error is the first thing the next one says.
  const close = () => {
    create.reset()
    reset()
    onClose()
  }

  const ready =
    saveable(draft, quick) && (quick || contactsSaveable(contacts))

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && close()}
      title="New supplier"
      width="wide"
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!ready || create.isPending}
            onClick={() => create.mutate()}
          >
            {create.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {create.isError && (
          <Banner tone="bad">{(create.error as Error).message}</Banner>
        )}
        <CompanyFields
          draft={draft}
          set={set}
          code={null}
          locked={() => false}
          quick={quick}
        />
        {!quick && (
          <ContactsFields contacts={contacts} onChange={setContacts} />
        )}
        {!quick && (
          <NotesField
            value={draft.notes}
            onChange={(notes) => set({ notes })}
            disabled={false}
          />
        )}
      </div>
    </Sheet>
  )
}

// ---------------------------------------------------------------------------
// Reading and editing one

/// The record: the form it was created with, read-only, then its orders and
/// its catalogue. `?supplier=new` opens the composer instead.
function SupplierSheet({
  id,
  onClose,
  onOpen,
}: {
  id: string | null
  onClose: () => void
  onOpen: (id: string) => void
}) {
  const client = useQueryClient()
  const idempotency = useIdempotencyKey()
  const creating = id === "new"
  const [tab, setTab] = useState("details")
  /// The edit in progress, carrying the id it was typed against: the sheet
  /// stays mounted while the list swaps records under it, and a draft about
  /// another supplier counts as no draft at all.
  const [edit, setEdit] = useState<{
    readonly id: string
    readonly address: string
    readonly notes: string
    readonly contacts: readonly ContactDraft[]
  } | null>(null)
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
      if (
        (supplier.address ?? "") !== draft.address.trim() ||
        (supplier.notes ?? "") !== draft.notes.trim()
      ) {
        await updateSupplier(
          supplier.supplier_id,
          {
            supplier_code: null,
            name: null,
            address: blank(draft.address),
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
          (was.phone ?? "") !== contact.phone.trim() ||
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
      toast.success("Supplier saved")
    },
    onError: () => {
      // Whatever part went through is on the server now; read it back so the
      // next Save starts from what is there.
      void client.invalidateQueries({
        queryKey: procurementKeys.supplier(detail.data!.supplier_id),
      })
    },
  })

  if (creating) {
    return (
      <SupplierComposer
        open
        onClose={onClose}
        onCreated={(made) => onOpen(made.supplier_id)}
      />
    )
  }

  const supplier = detail.data
  const contacts = editing
    ? editing.contacts
    : (people.data ?? []).map(contactDraftOf)

  return (
    <Sheet
      open={id !== null}
      onOpenChange={(open) => !open && onClose()}
      id={supplier?.supplier_code}
      title={supplier === undefined ? "Supplier" : supplierDisplayName(supplier)}
      // Under the name, the two facts somebody opened this to find: where they
      // are and how to call them.
      caption={
        supplier &&
        [supplier.address, supplier.phone].filter(Boolean).join(" · ")
      }
      badge={
        supplier && (
          <Pill tone={supplier.status === "ACTIVE" ? "ok" : "neutral"}>
            {statusLabel(supplier.status)}
          </Pill>
        )
      }
      width="wide"
      actions={
        supplier &&
        !editing && (
          <>
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                printSupplier(supplier, (people.data ?? []).map(contactDraftOf))
              }
            >
              <Printer />
              Print
            </Button>
            <Button
              size="sm"
              onClick={() => {
                save.reset()
                setTab("details")
                setEdit({
                  id: id!,
                  address: supplier.address ?? "",
                  notes: supplier.notes ?? "",
                  contacts: [
                    ...(people.data ?? []).map(contactDraftOf),
                  ],
                })
              }}
            >
              <Pencil />
              Edit
            </Button>
          </>
        )
      }
      footer={
        editing && (
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" onClick={() => setEdit(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={
                editing.address.trim() === "" ||
                !contactsSaveable(editing.contacts) ||
                save.isPending
              }
              onClick={() => save.mutate()}
            >
              {save.isPending ? "Saving…" : "Save"}
            </Button>
          </div>
        )
      }
    >
      {queryState(detail, {
        loading: "Loading the supplier…",
        render: (record) => (
          <div className="flex flex-col gap-4">
            {!editing && (
              <SubTabs
                className="mb-0"
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
              <>
                {save.isError && (
                  <Banner tone="bad">{(save.error as Error).message}</Banner>
                )}
                {editing && <StatusSwitch supplier={record} />}
                <CompanyFields
                  draft={{
                    ...draftOf(record),
                    ...(editing ? { address: editing.address } : {}),
                  }}
                  set={(patch) => {
                    if (patch.address !== undefined && editing)
                      setEdit({ ...editing, address: patch.address })
                  }}
                  code={record.supplier_code}
                  locked={(field) => !editing || field !== "address"}
                />
                <ContactsFields
                  contacts={contacts}
                  readOnly={!editing}
                  onChange={(next) =>
                    editing && setEdit({ ...editing, contacts: next })
                  }
                />
                <NotesField
                  value={editing ? editing.notes : (record.notes ?? "")}
                  onChange={(notes) =>
                    editing && setEdit({ ...editing, notes })
                  }
                  disabled={!editing}
                />
              </>
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
            ? "Purchase orders can be raised against this supplier."
            : "No purchase order can be raised against this supplier."}
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
        title="Make this supplier non-active?"
        confirm="Continue"
        cancel="Cancel"
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

const GROUPS: readonly {
  readonly key: OrderGroup
  readonly title: string
  readonly statuses: readonly string[]
}[] = [
  {
    key: "active",
    title: "Active order",
    statuses: ["ACTIVE", "PARTIALLY_RECEIVED"],
  },
  {
    key: "completed",
    title: "Completed order",
    statuses: ["FULLY_RECEIVED", "SHORT_RECEIVED"],
  },
  { key: "cancelled", title: "Cancelled order", statuses: ["CANCELLED"] },
]

/// Newest issued first — the order the tab and its sheet both read in.
function newestFirst(
  left: PurchaseOrderRow,
  right: PurchaseOrderRow
): number {
  return (right.issued_at ?? "").localeCompare(left.issued_at ?? "")
}

/// Everything ordered from this supplier, in the three groups the owner asked
/// for — the five newest of each, and View all for the rest.
///
/// By the supplier CODE, on the wire: `purchase_order.supplier_id` is the
/// business-code snapshot, not the register's uuid.
function SupplierOrders({ supplier }: { supplier: Supplier }) {
  const [all, setAll] = useState<OrderGroup | null>(null)
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
      <div className="flex flex-col gap-5">
        {/* The owner's model (2026-09-26): each kind of order as a heading
            with its orders listed under it — the five newest, and View all
            for the rest. */}
        {GROUPS.map((group) => {
          const rows = grouped[group.key]
          return (
            <section key={group.key} className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-[0.9375rem] font-semibold text-ink">
                  {group.title}
                  <span className="ml-1.5 font-normal text-body tabular-nums">
                    {count(rows.length)}
                  </span>
                </h3>
                {rows.length > 5 && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setAll(group.key)}
                  >
                    View all
                  </Button>
                )}
              </div>
              {rows.length === 0 ? (
                <p className="text-[0.875rem] text-body">None.</p>
              ) : (
                <OrderList rows={rows.slice(0, 5)} />
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
          {open !== undefined && <OrdersTable rows={grouped[open.key]} />}
        </Sheet>
      </div>
    ),
  })
}

/// One order per line, under its group's heading: the number, then when it
/// was issued, how many pieces and what it is worth.
function OrderList({ rows }: { rows: readonly PurchaseOrderRow[] }) {
  return (
    <ul className="flex flex-col divide-y divide-hairline rounded-inner border border-hairline">
      {rows.map((order) => (
        <li
          key={order.purchase_order_id}
          className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3.5 py-2.5 text-[0.875rem]"
        >
          <LinkButton
            to="/procurement/orders"
            sheet={{ key: "order", value: order.purchase_order_id }}
            className="h-auto border-0 bg-transparent px-0 font-mono text-[0.875rem] font-medium text-accent hover:bg-transparent hover:underline"
          >
            {order.po_number}
          </LinkButton>
          <span className="text-body tabular-nums">
            {day(order.issued_at)}
            {order.fulfilled_at !== null && ` → ${day(order.fulfilled_at)}`}
          </span>
          <span className="ml-auto text-body tabular-nums">
            {count(order.expected_stock_units)} pcs
          </span>
          <span className="w-32 text-right font-medium text-ink tabular-nums">
            {money(order.net_minor)}
          </span>
        </li>
      ))}
    </ul>
  )
}

/// Order | Date issued | Date fulfilled | Qty | Value, each row crossing into
/// the order.
function OrdersTable({ rows }: { rows: readonly PurchaseOrderRow[] }) {
  return (
    <MiniTable
      head={["Order", "Date issued", "Date fulfilled", "Qty", "Value"]}
    >
      {rows.map((order) => (
        <tr key={order.purchase_order_id} className="border-t border-hairline">
          <td className="py-2 pr-2">
            <LinkButton
              to="/procurement/orders"
              sheet={{ key: "order", value: order.purchase_order_id }}
              className="h-auto border-0 bg-transparent px-0 font-mono text-[0.875rem] font-normal text-accent hover:bg-transparent hover:underline"
            >
              {order.po_number}
            </LinkButton>
          </td>
          <td className="py-2 pr-2 text-[0.875rem] tabular-nums">
            {day(order.issued_at)}
          </td>
          <td className="py-2 pr-2 text-[0.875rem] tabular-nums">
            {day(order.fulfilled_at)}
          </td>
          <td className="py-2 pr-2 text-right text-[0.875rem] tabular-nums">
            {count(order.expected_stock_units)}
          </td>
          <td className="py-2 text-right text-[0.875rem] font-medium text-ink tabular-nums">
            {money(order.net_minor)}
          </td>
        </tr>
      ))}
    </MiniTable>
  )
}

// ---------------------------------------------------------------------------
// Printing

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

/// The supplier on one A5 sheet, printed from a window of its own.
///
/// Its own document rather than a print stylesheet over the app: the sheet
/// the record sits in is a portal over a list over a shell, and hiding all of
/// that for the printer is a fight with every layer. A5 is the owner's size.
function printSupplier(supplier: Supplier, contacts: readonly ContactDraft[]) {
  const fact = (term: string, value: string | null | undefined) =>
    `<tr><th>${escapeHtml(term)}</th><td>${escapeHtml(value?.trim() || "—")}</td></tr>`
  const people =
    contacts.length === 0
      ? `<p class="none">No contact person on file.</p>`
      : `<table class="grid"><thead><tr><th>Name</th><th>Role</th><th>Phone</th><th>Email</th><th>Address</th></tr></thead><tbody>${contacts
          .map(
            (one) =>
              `<tr><td>${escapeHtml(one.name)}</td><td>${escapeHtml(one.role || "—")}</td><td>${escapeHtml(one.phone || "—")}</td><td>${escapeHtml(one.email || "—")}</td><td>${escapeHtml(one.address || "—")}</td></tr>`
          )
          .join("")}</tbody></table>`
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(
    `${supplier.supplier_code} ${supplierDisplayName(supplier)}`
  )}</title><style>
@page { size: A5; margin: 12mm; }
* { box-sizing: border-box; }
body { font-family: Inter, -apple-system, "Segoe UI", sans-serif; font-size: 14px; color: #1d1f1a; margin: 0; }
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
<div class="code">${escapeHtml(supplier.supplier_code)}</div>
<h1>${escapeHtml(supplierDisplayName(supplier))}</h1>
<h2>Company</h2>
<table class="facts">${fact("Status", statusLabel(supplier.status))}${fact("Address", supplier.address)}${fact("Email", supplier.email)}${fact("Phone number", supplier.phone)}${fact("NPWP", supplier.npwp)}${fact("PKP", supplier.is_pkp ? "Yes" : "No")}</table>
<h2>Contact person</h2>${people}
<h2>Notes</h2><p class="notes">${escapeHtml(supplier.notes?.trim() || "—")}</p>
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

/// What this supplier offers, and adding to it.
function SupplierCatalogue({ supplierId }: { supplierId: string }) {
  const client = useQueryClient()
  const idempotency = useIdempotencyKey()
  // Whether the panel is open, not what is in it: a disclosure, so `useState`.
  const [adding, setAdding] = useState(false)

  const items = useQuery({
    queryKey: procurementKeys.supplierCatalogue(supplierId),
    queryFn: ({ signal }) => supplierCatalogue(supplierId, {}, signal),
  })

  const add = useMutation({
    mutationFn: (draft: { code: string; name: string; price: string }) =>
      createSupplierItem(
        supplierId,
        {
          supplier_item_code: draft.code.trim(),
          name: draft.name.trim(),
          description: null,
          image_url: null,
          unit_price_minor: Number.parseInt(draft.price, 10),
          currency: "IDR",
          internal_article_code: null,
          status: "ACTIVE",
          division_code: null,
          tags: [],
          colour_codes: [],
          size_codes: [],
          units: [],
        },
        idempotency.key
      ),
    onSuccess: () => {
      void client.invalidateQueries({
        queryKey: procurementKeys.supplierCatalogue(supplierId),
      })
      void client.invalidateQueries({
        queryKey: procurementKeys.supplierItems(),
      })
      idempotency.rotate()
      setAdding(false)
      form.reset()
    },
  })

  const form = useForm({
    defaultValues: { code: "", name: "", price: "" },
    onSubmit: ({ value }) => add.mutate(value),
  })

  return (
    <div className="flex flex-col gap-3.5">
      {add.isError && (
        <Banner tone="bad">{(add.error as Error).message}</Banner>
      )}

      {queryState(items, {
        loading: "Reading the catalogue…",
        render: (page) =>
          page.items.length === 0 ? (
            <p className="text-[0.875rem] text-body">
              This supplier offers nothing yet, so no order can name them.
            </p>
          ) : (
            <>
              <MiniTable head={["Item", "Price", "Status"]}>
                {page.items.map((item) => (
                  <tr
                    key={item.supplier_item_id}
                    className="border-t border-hairline"
                  >
                    <td className="py-2 pr-2">
                      <LinkButton
                        to="/procurement/catalogue"
                        sheet={{ key: "item", value: item.supplier_item_id }}
                        className="h-auto border-0 bg-transparent px-0 text-[0.875rem] font-normal text-accent hover:bg-transparent hover:underline"
                      >
                        {item.name}
                      </LinkButton>
                      <span className="block font-mono text-[0.875rem] text-mute">
                        {item.supplier_item_code}
                      </span>
                    </td>
                    <td className="py-2 text-right text-[0.875rem] tabular-nums">
                      {money(item.unit_price_minor)}
                    </td>
                    <td className="py-2 text-right">
                      <Pill tone={item.status === "ACTIVE" ? "ok" : "neutral"}>
                        {item.status === "ACTIVE" ? "Active" : "Cancelled"}
                      </Pill>
                    </td>
                  </tr>
                ))}
              </MiniTable>
              {page.next_cursor !== null && (
                <p className="text-[0.875rem] text-body">
                  The first {count(page.limit)} of this supplier's catalogue.
                  The whole of it is on the catalogue screen.
                </p>
              )}
            </>
          ),
      })}

      {adding ? (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            form.handleSubmit()
          }}
          className="flex flex-col gap-3 rounded-inner border border-hairline p-3.5"
        >
          <form.Field name="code">
            {(field) => (
              <Field label={<Label>Supplier's code for it</Label>}>
                <Input
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
              </Field>
            )}
          </form.Field>
          <form.Field name="name">
            {(field) => (
              <Field label={<Label>Name</Label>}>
                <Input
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
              </Field>
            )}
          </form.Field>
          <form.Field name="price">
            {(field) => (
              <Field label={<Label>Unit price</Label>} hint="Rupiah.">
                <Input
                  type="number"
                  min={0}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
              </Field>
            )}
          </form.Field>
          <div className="flex gap-2">
            <form.Subscribe
              selector={(state) =>
                state.values.code.trim() !== "" &&
                state.values.name.trim() !== "" &&
                Number.isFinite(Number.parseInt(state.values.price, 10))
              }
            >
              {(ready) => (
                <Button
                  type="submit"
                  variant="soft"
                  className="flex-1"
                  disabled={!ready || add.isPending}
                >
                  {add.isPending ? "Adding…" : "Add it"}
                </Button>
              )}
            </form.Subscribe>
            <Button variant="quiet" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <Button onClick={() => setAdding(true)}>Add an item</Button>
      )}
    </div>
  )
}
