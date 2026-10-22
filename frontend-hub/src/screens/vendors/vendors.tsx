import { useQuery, useSuspenseInfiniteQuery } from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { Plus } from "lucide-react"
import { Suspense, useDeferredValue, useEffect, useMemo, useState } from "react"

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
import { Status } from "@/components/ui/pill"
import { Toolbar } from "@/components/ui/segmented"
import { EmptyState, LoadingState } from "@/components/ui/states"
import { SubTabs } from "@/components/ui/sub-tabs"
import {
  useFilterState,
  type FilterField,
  type FilterState,
} from "@/lib/filters"
import { count } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import type { SupplierCategory } from "@/lib/queries/procurement"
import { useSheet } from "@/lib/sheets"
import { tableSetup, type TableSetup } from "@/lib/table"
import { useDebounced } from "@/lib/use-debounced"
import { useFittedVisibility } from "@/screens/procurement/shared"
import { supplierDisplayName } from "@/screens/procurement/supplier-format"
import { vendorBookQuery } from "@/screens/vendors/book-data"
import {
  calmName,
  glyphOf,
  KINDS,
  kindOf,
  type KindInfo,
  type SupplierKind,
} from "@/screens/vendors/kinds"
import {
  contractedSuppliersQuery,
  useAccountNames,
  useMayEditSuppliers,
  vendorCountQuery,
  vendorRegisterQuery,
} from "@/screens/vendors/vendor-data"
import { AddVendorSheet, VendorSheet } from "@/screens/vendors/vendor-sheet"
import type { Supplier } from "@itulah/contract"

/// Suppliers — everybody we owe who does not sell us clothes.
///
/// # Why this is a second menu over the same book
///
/// The client's chart drew the line, in three accounts: Hutang Suppliers
/// Barang Dagangan, Hutang Supplier Non Barang Dagang, and fourteen Hutang
/// Affiliasi. Merchandise runs weekly against a purchase order and a goods
/// receipt; PLN and the landlord run monthly against a meter reading or a
/// contract. One screen for both would carry a PO column empty for half its
/// rows — so two menus, over ONE record (`supplier` with a `category`, migration
/// 0212), because ageing, payments and bills are the same machinery either way.
///
/// REGISTERING a supplier is General Affairs' work (the owner: "vendor
/// registrasi di ga bukan?"); paying what they send is Finance's.
///
/// # The list format
///
/// Head, figures, tabs, one bar, a framed table (owner, 18 Oct 2026, as
/// Contracts draws it). The tabs are the two books, Operating and Affiliate.
/// The bar narrows by what the supplier is for — the chips — and the kind is
/// read off the account its bills debit (`kinds.ts`), which is also the column
/// this screen is for: a supplier with no account is a supplier whose bills
/// somebody has to account for by hand every month, so it says "Not set".
///
/// The figures describe the register (both books, whatever the bar narrows
/// to); the tab counts and the foot describe the list.
export function Vendors() {
  const [book, setBook] = useState<SupplierCategory>("EXPENSE")
  const filters = useFilterState(FIELDS)
  const [search, setSearch] = useState("")
  const [adding, setAdding] = useState<{ open: boolean; round: number }>({
    open: false,
    round: 0,
  })
  const mayEdit = useMayEditSuppliers()
  // Every opening starts a clean form.
  const startAdding = () =>
    setAdding((current) => ({ open: true, round: current.round + 1 }))
  const phone = useLayout() === "phone"

  // The search is the server's, so it waits for the typing to stop.
  const needle = useDebounced(search.trim(), 300)

  // The kinds differ from one book to the other: leaving the book leaves the
  // chip.
  const chooseBook = (next: SupplierCategory) => {
    setBook(next)
    filters.clear()
  }

  // The head, the + and the figures stand at once; the book waits for its
  // first page and streams in with it (the server starts the read too).
  return (
    <PageContent>
      <PageHeader
        title="Suppliers"
        small
        actions={
          // On a phone the one thing this page makes is its round button.
          phone || !mayEdit ? undefined : (
            <Button variant="primary" onClick={startAdding}>
              <Plus />
              Add supplier
            </Button>
          )
        }
      />

      {mayEdit && <Fab label="Add supplier" onClick={startAdding} />}

      <Figures />

      <Suspense fallback={<LoadingState>Loading suppliers…</LoadingState>}>
        <VendorBook
          book={book}
          onBook={chooseBook}
          filters={filters}
          search={search}
          onSearch={setSearch}
          needle={needle}
          mayEdit={mayEdit}
          phone={phone}
          adding={adding}
          onAdd={startAdding}
          onAdded={() => setAdding((current) => ({ ...current, open: false }))}
        />
      </Suspense>
    </PageContent>
  )
}

/// Suppliers · No expense account · On contracts. Read beside the list: they do
/// not hold the page up while they arrive.
function Figures() {
  const register = useQuery(vendorRegisterQuery())
  const contracted = useQuery(contractedSuppliersQuery())
  const figure = (n: number | undefined) => (n === undefined ? "—" : count(n))
  const missing = register.data?.filter(
    (row) => row.expense_account_code === null
  ).length
  return (
    <KpiStrip className="grid-cols-2 md:grid-cols-3 xl:grid-cols-3">
      <Kpi label="Suppliers" value={figure(register.data?.length)} />
      <Kpi
        label="No expense account"
        value={
          missing !== undefined && missing > 0 ? (
            <span className="text-warn-fg">{count(missing)}</span>
          ) : (
            figure(missing)
          )
        }
      />
      <Kpi label="On contracts" value={figure(contracted.data)} />
    </KpiStrip>
  )
}

/// A row of the table: the supplier, with what it is for and the account's
/// name looked up once on the row rather than in the cell, because a column
/// sorts by what is on the screen.
interface VendorLine {
  readonly supplier: Supplier
  readonly kind: KindInfo
  readonly accountName: string | null
}

/// The mark in front of a name: what the supplier is for. The same tile the
/// forms' choices and the other registers' rows wear.
function GlyphTile({ code }: { code: string | null }) {
  const Glyph = glyphOf(code)
  return (
    <span
      aria-hidden
      className="grid size-[1.875rem] shrink-0 place-items-center rounded-inner bg-soft-2 text-body"
    >
      <Glyph className="size-4 stroke-[1.7]" />
    </span>
  )
}

/// A grey second line under a first one. A missing one is not drawn.
function Over({
  line,
  quiet,
}: {
  line: React.ReactNode
  quiet: React.ReactNode
}) {
  return (
    <span className="flex min-w-0 flex-col">
      <span className="truncate text-ink">{line}</span>
      {quiet !== null && quiet !== undefined && quiet !== "" && (
        <span className="truncate text-mute">{quiet}</span>
      )}
    </span>
  )
}

/// Held at the widths their longest words need, measured at 1440 and 1280: the
/// supplier takes the rest, and the table never scrolls sideways.
const COLUMNS: ColumnDef<TableSetup, VendorLine>[] = [
  {
    id: "supplier",
    accessorFn: (row) => supplierDisplayName(row.supplier),
    header: "Supplier",
    size: 340,
    meta: { grow: 240 },
    cell: ({ row }) => {
      const { supplier } = row.original
      const name = supplierDisplayName(supplier)
      return (
        <span className="flex min-w-0 items-center gap-3">
          <GlyphTile code={supplier.expense_account_code} />
          <span className="flex min-w-0 flex-col">
            <span className="truncate font-medium text-ink" title={name}>
              {name}
            </span>
            <span className="truncate text-mute">{supplier.supplier_code}</span>
          </span>
        </span>
      )
    },
  },
  {
    id: "account",
    accessorFn: (row) =>
      row.accountName ?? row.supplier.expense_account_code ?? "",
    header: "Expense account",
    size: 290,
    cell: ({ row }) => {
      const code = row.original.supplier.expense_account_code
      if (code === null) return <span className="text-mute">Not set</span>
      const name = row.original.accountName
      return name === null ? (
        <span className="block truncate">{code}</span>
      ) : (
        <span title={name}>
          <Over line={name} quiet={code} />
        </span>
      )
    },
  },
  {
    id: "contact",
    accessorFn: (row) => row.supplier.contact_name ?? row.supplier.phone ?? "",
    header: "Contact",
    size: 170,
    cell: ({ row }) => {
      const { contact_name: name, phone } = row.original.supplier
      if (name === null && phone === null)
        return <span className="text-mute">—</span>
      return name === null ? (
        <span className="block truncate">{phone}</span>
      ) : (
        <Over line={name} quiet={phone} />
      )
    },
  },
  {
    id: "status",
    accessorFn: (row) => row.supplier.status,
    header: "Status",
    size: 110,
    cell: ({ row }) => {
      const active = row.original.supplier.status === "ACTIVE"
      return (
        <Status tone={active ? "ok" : "neutral"}>
          {active ? "Active" : "Inactive"}
        </Status>
      )
    },
  },
]

/// What the book is narrowed by: what the supplier is for. Nine answers, so
/// they are found by name in the search box.
const FIELDS: FilterField[] = [
  {
    column: "kind",
    label: "Kind",
    spec: {
      kind: "option",
      single: true,
      format: (value) =>
        KINDS.find((one) => one.value === value)?.label ?? value,
      icon: (value) => KINDS.find((one) => one.value === value)?.icon,
    },
  },
]

function VendorBook({
  book,
  onBook,
  filters,
  search,
  onSearch,
  needle,
  mayEdit,
  phone,
  adding,
  onAdd,
  onAdded,
}: {
  book: SupplierCategory
  onBook: (next: SupplierCategory) => void
  filters: FilterState
  search: string
  onSearch: (next: string) => void
  needle: string
  mayEdit: boolean
  phone: boolean
  adding: { open: boolean; round: number }
  onAdd: () => void
  onAdded: () => void
}) {
  const open = useSheet("supplier")
  const kind = (filters.filters.find((one) => one.column === "kind")
    ?.values[0] ?? null) as SupplierKind | null

  // The sheet's last record stays while it slides away, so it does not flash
  // to a loading line on its way out.
  const [last, setLast] = useState<string | undefined>(open.value)
  if (open.value !== undefined && open.value !== last) setLast(open.value)

  const scope = useMemo(
    () => ({ category: book, q: needle === "" ? undefined : needle }),
    [book, needle]
  )

  /// The book, every page of it: a hundred suppliers a page, and the next
  /// asked for as soon as one lands, because the chips count what they
  /// narrow and a count over the first page only would be a lie. The same
  /// read and the same key shape the supplier book uses, under the book's
  /// prefix so `suppliers()` invalidation still reaches it.
  ///
  /// The deferred scope keeps the rows in hand on screen while the next
  /// question is read, so a keystroke does not empty the list.
  const asked = useDeferredValue(scope)
  const vendors = useSuspenseInfiniteQuery(vendorBookQuery(asked))
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = vendors
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  const head = vendors.data.pages[0]
  const suppliers = useMemo(
    () => vendors.data.pages.flatMap((page) => page.rows),
    [vendors.data]
  )
  const names = useAccountNames(
    suppliers.map((row) => row.expense_account_code)
  )

  const lines = useMemo<VendorLine[]>(
    () =>
      suppliers.map((supplier) => ({
        supplier,
        kind: kindOf(supplier.expense_account_code),
        accountName:
          supplier.expense_account_code === null
            ? null
            : calmName(names.get(supplier.expense_account_code) ?? "") || null,
      })),
    [suppliers, names]
  )
  const shown = useMemo(
    () =>
      kind === null ? lines : lines.filter((line) => line.kind.value === kind),
    [lines, kind]
  )

  // The tab counts: over what the search leaves, before the tab.
  const operating = useQuery(
    vendorCountQuery({ category: "EXPENSE", q: scope.q })
  )
  const affiliate = useQuery(
    vendorCountQuery({ category: "AFFILIATE", q: scope.q })
  )
  const bookCount = (which: SupplierCategory) =>
    which === "EXPENSE" ? operating.data : affiliate.data
  const bookTotal = head?.total
  const tabCount = (which: SupplierCategory) =>
    bookCount(which) ?? (which === book ? bookTotal : undefined)

  // The chips: every kind this book holds, with how many, the one chosen kept
  // even when the search has emptied it.
  const model = useMemo<FilterState>(
    () => ({
      ...filters,
      fields: FIELDS.map((field) => ({
        ...field,
        spec: {
          ...field.spec,
          counted: KINDS.flatMap((one) => {
            const n = lines.filter(
              (line) => line.kind.value === one.value
            ).length
            return n === 0 && kind !== one.value
              ? []
              : [{ value: one.value as string, count: n }]
          }),
        },
      })),
    }),
    [filters, lines, kind]
  )

  const [sorting, setSorting] = useState<SortingState>([])
  /// What fits the card: nothing is given up at 1280, but the menu still
  /// turns columns off and on.
  const fit = useFittedVisibility(COLUMNS, {})
  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: shown,
        columns: COLUMNS,
        getRowId: (row: VendorLine) => row.supplier.supplier_id,
        state: { sorting, columnVisibility: fit.shown },
        onSortingChange: setSorting,
        onColumnVisibilityChange: fit.change,
      }),
      // `fit.shown` is rebuilt every render; what it is made of is not.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [shown, sorting, fit.hidden, fit.visibility]
    )
  )

  const narrowed = needle !== "" || kind !== null
  const total = kind === null ? (bookTotal ?? shown.length) : shown.length

  return (
    <>
      <SubTabs
        // On a phone the tab is the status chip over the bottom bar.
        className="max-md:hidden"
        tabs={[
          {
            value: "EXPENSE",
            label: <TabLabel text="Operating" n={tabCount("EXPENSE")} />,
          },
          {
            value: "AFFILIATE",
            label: <TabLabel text="Affiliate" n={tabCount("AFFILIATE")} />,
          },
        ]}
        value={book}
        onChange={(next) => onBook(next as SupplierCategory)}
      />

      {/* One bar: the search at the left, Columns at the right, and the kinds
          on a line of their own under them. On a phone they are the dock's. */}
      <div className="max-md:hidden">
        <Toolbar className="group/bar">
          <ListFilters
            model={model}
            search={{
              value: search,
              onChange: onSearch,
              label: "Search suppliers",
            }}
          />
          <BarSpacer />
          <ColumnsMenu table={table} />
        </Toolbar>
      </div>

      <DockTools
        search={{
          value: search,
          onChange: onSearch,
          label: "Search suppliers",
        }}
        filter={{
          count: filters.filters.length,
          panel: { model: filters, filterModel: model },
        }}
        status={{
          value: book,
          options: [
            {
              value: "EXPENSE",
              label: "Operating",
              count: tabCount("EXPENSE"),
            },
            {
              value: "AFFILIATE",
              label: "Affiliate",
              count: tabCount("AFFILIATE"),
            },
          ],
          onChange: (next) => onBook(next as SupplierCategory),
        }}
      />

      <div aria-busy={asked !== scope || undefined} className="list-swap">
        {shown.length === 0 ? (
          <Card>
            <EmptyState
              action={
                mayEdit && !narrowed ? (
                  <Button variant="ghost" onClick={onAdd}>
                    Add the first supplier
                  </Button>
                ) : undefined
              }
            >
              {narrowed
                ? "No supplier matches these filters."
                : book === "EXPENSE"
                  ? "No operating suppliers yet."
                  : "No affiliate suppliers yet."}
            </EmptyState>
          </Card>
        ) : phone ? (
          <PhoneCards
            rows={shown}
            rowId={(line) => line.supplier.supplier_id}
            spec={VENDOR_CARD}
            onOpen={(line) => open.open(line.supplier.supplier_id)}
            more={vendors}
          />
        ) : (
          // `overflow-clip`, not `overflow-hidden`: hidden makes the card a
          // scroll box, and the heading would stick to the card instead of
          // the window.
          <Card ref={fit.ref} className="overflow-clip">
            <DataTable<VendorLine>
              refresh={[vendors]}
              table={table}
              onRowClick={(line) => open.open(line.supplier.supplier_id)}
              isSelected={(line) => line.supplier.supplier_id === open.value}
              more={vendors}
              // The window scrolls, not the table.
              pageScroll
              summary={{
                supplier: (
                  <span>
                    {count(total)}{" "}
                    <span className="font-normal text-body">
                      {total === 1 ? "supplier" : "suppliers"}
                    </span>
                  </span>
                ),
              }}
            />
          </Card>
        )}
      </div>

      <AddVendorSheet
        key={`add:${adding.round}`}
        open={adding.open}
        book={book}
        onClose={onAdded}
        onCreated={(supplierId) => {
          onAdded()
          open.open(supplierId)
        }}
      />

      <VendorSheet
        supplierId={open.value ?? last}
        open={open.isOpen}
        row={suppliers.find((row) => row.supplier_id === (open.value ?? last))}
        onClose={open.close}
      />
    </>
  )
}

/// A tab's word and its count, the count quiet (as Contracts draws it). A count
/// still being read is left out.
function TabLabel({ text, n }: { text: string; n: number | undefined }) {
  return (
    <span>
      {text}
      {n !== undefined && (
        <span className="ml-1.5 text-body tabular-nums">{count(n)}</span>
      )}
    </span>
  )
}

/// The same row as a phone card: the supplier with its mark and its code, who
/// to ring, the account its bills usually debit (said plainly when it is not
/// set), and whether it is still used.
const VENDOR_CARD: CardSpec<VendorLine> = {
  title: (line) => (
    <span className="flex min-w-0 items-start gap-3">
      <GlyphTile code={line.supplier.expense_account_code} />
      <CardName
        name={supplierDisplayName(line.supplier)}
        code={line.supplier.supplier_code}
      />
    </span>
  ),
  meta: [
    (line) =>
      [line.supplier.contact_name, line.supplier.phone]
        .filter((part) => part !== null && part !== "")
        .join(" · "),
  ],
  foot: (line) =>
    line.supplier.expense_account_code === null ? (
      <span>Not set</span>
    ) : (
      <span>
        {line.supplier.expense_account_code}
        {line.accountName !== null && ` · ${line.accountName}`}
      </span>
    ),
  action: (line) => (
    <Status tone={line.supplier.status === "ACTIVE" ? "ok" : "neutral"}>
      {line.supplier.status === "ACTIVE" ? "Active" : "Inactive"}
    </Status>
  ),
}
