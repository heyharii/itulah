import { useForm } from "@tanstack/react-form"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { Search } from "lucide-react"
import { useMemo, useState } from "react"

import type {
  SupplierBankAccount,
  UpdateSupplierBankAccountRequest,
} from "@itulah/contract"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Field, Input, Textarea } from "@/components/ui/field"
import {
  ColumnsMenu,
  DockedFilters,
  SortMenu,
  ViewPicker,
} from "@/components/ui/list-chrome"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { MiniTable, Section } from "@/components/ui/rows"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { SubTabs } from "@/components/ui/sub-tabs"
import { Banner, EmptyState } from "@/components/ui/states"
import { useFilterState, type FilterField } from "@/lib/filters"
import { count, day, money } from "@/lib/format"
import {
  createSupplier,
  createSupplierBankAccount,
  createSupplierItem,
  listPurchaseOrders,
  procurementKeys,
  searchSupplierItems,
  setSupplierStatus,
  supplierBankAccounts,
  supplierCatalogue,
  supplierDetail,
  supplierPage,
  supplierScopeFromFilters,
  updateSupplier,
  updateSupplierBankAccount,
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
import type { Supplier, SupplierStatus } from "@itulah/contract"

/// Suppliers — who we buy from, and whether we can.
///
/// Written in the grammar `purchase-orders.tsx` sets out, which is the module's
/// reference screen: one omnibox above the table that goes to the SERVER, the
/// clauses beside it in the URL, the panel docked at the right where there is
/// room for it, and `meta.card` on the columns so an iPad and a phone get the
/// same facts in a different shape. It used to be a segmented control and a
/// Filter button over a list fetched whole and narrowed in the browser — the
/// grammar of the four screens next door that have not moved yet, and the
/// reason this one looked like a different app to anybody who arrived from the
/// order book.
///
/// **The book opens on everybody now**, where the segmented control opened on
/// Active. That is the same default the order book has — "All suppliers" — and
/// it is honest for the same reason: the server's house order already floats
/// the ones we still buy from to the top, the Status column says which is
/// which, and a screen that silently hides retired suppliers is a screen where
/// somebody creates a second record for a supplier that is already there.
///
/// Narrowing at the server is not decoration here either. The endpoint returns
/// two hundred suppliers a page out of a book that only ever grows, so a
/// browser-side search over what happened to arrive was a search over the first
/// page, quietly.
///
/// The list carries no phone number, no address and no tax id. DESIGN.md is
/// explicit that a column exists to decide or to compare, and a buyer scanning
/// this is asking one question: which of these can I raise an order against
/// today. That is a supplier that is active AND has something on offer, so those
/// two are the columns. The contact facts are one click away, in the sheet.
///
/// The count of items on offer comes from the sourcing search's facets, which
/// the server counts over the whole catalogue in the same request that returns
/// a page of it — one round trip for every supplier's total, rather than one
/// request per supplier.

interface SupplierRow extends Supplier {
  readonly offered: number
}

/// Which column means which of the three orders the endpoint names.
///
/// A column that is not in here cannot be sorted — `enableSorting: false` says
/// so on the column itself, so neither the header nor the Sort menu offers it.
/// The alternative is worse than a missing menu item: the table would sort the
/// PAGE it is holding, and a book sorted one screenful at a time is a list that
/// lies about where its first row is.
const SORTS: Record<string, SupplierSort> = {
  name: "name",
  supplier_code: "code",
  created_at: "created",
}

const columns: ColumnDef<TableSetup, SupplierRow>[] = [
  {
    accessorKey: "name",
    header: "Supplier",
    size: 280,
    meta: { card: "title" },
    cell: ({ row }) => (
      <span className="font-medium text-ink">{row.original.name}</span>
    ),
  },
  {
    accessorKey: "supplier_code",
    header: "Code",
    size: 120,
    // Ours for this supplier, and what every item they offer is filed under.
    // It was the second line of the name cell; it is a column of its own now
    // because it is the other thing the book can be ordered by, and a sort has
    // to have a header to name itself after.
    meta: { card: "id", mono: true, priority: 2 },
    cell: ({ row }) => (
      <span className="font-mono text-id text-body">
        {row.original.supplier_code}
      </span>
    ),
  },
  {
    accessorKey: "status",
    header: "Status",
    size: 120,
    // Not sortable, and the server says why: alphabetising two state names
    // groups nothing anybody asked for. "Show me the ones we still buy from"
    // is a filter, and the panel counts it.
    enableSorting: false,
    meta: { card: "status" },
    cell: ({ row }) => (
      <Pill tone={row.original.status === "ACTIVE" ? "ok" : "neutral"}>
        {row.original.status === "ACTIVE" ? "Active" : "Retired"}
      </Pill>
    ),
  },
  {
    accessorKey: "offered",
    header: "On offer",
    size: 130,
    // The decision metric — an active supplier with an empty catalogue is a
    // relationship nobody can buy from. Not sortable, because the figure comes
    // from the CATALOGUE search rather than from this endpoint: ordering by it
    // would rank the page in hand and call it the book.
    enableSorting: false,
    meta: { align: "right", card: "metric" },
    cell: ({ row }) => (
      <span
        className={
          row.original.offered === 0 ? "font-medium text-warn-fg" : "text-text"
        }
      >
        {count(row.original.offered)}
      </span>
    ),
  },
  {
    accessorKey: "created_at",
    header: "Added",
    size: 130,
    meta: { card: "meta", priority: 3 },
    cell: ({ row }) => (
      <span className="tabular-nums">{day(row.original.created_at)}</span>
    ),
  },
  {
    accessorKey: "updated_at",
    header: "Last touched",
    size: 140,
    // The server has no order for it, so neither has this. The date is still
    // worth a column — it is how somebody spots the record that was edited
    // this morning — but it is context, so it is the first to go when the
    // table is wider than the glass, and it is off the card entirely: two
    // unlabelled dates on one line read as a range, and on a seeded book where
    // nothing has been edited since it was made they are the same date twice.
    // The record carries both, named.
    enableSorting: false,
    meta: { card: "hide", priority: 3 },
    cell: ({ row }) => (
      <span className="tabular-nums">{day(row.original.updated_at)}</span>
    ),
  },
]

export function Suppliers() {
  // Which supplier is open lives in the URL, like every other sheet in the app:
  // a sheet in `useState` cannot be linked to and does not survive a reload.
  const supplier = useSheet("supplier")
  /// What was typed into the omnibox, also in the URL — a narrowed list is a
  /// thing people send each other.
  const search = useSheet("q")
  // The house order, which is what the server returns before anybody asks for
  // anything else: still buying from first, then by name.
  const [sorting, setSorting] = useState<SortingState>([
    { id: "name", desc: false },
  ])

  /// The one thing this book can be narrowed by, and the only one the endpoint
  /// answers. `single`, because it compares one column to one value.
  ///
  /// There is no "on offer" field for the same reason that column cannot be
  /// sorted: the count is not this endpoint's to filter by. Somebody hunting
  /// the empty catalogues reads the column, which puts them in amber.
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
            { value: "ACTIVE", label: "Still buying from" },
            { value: "INACTIVE", label: "Retired" },
          ],
          format: (code) =>
            code === "ACTIVE" ? "Still buying from" : "Retired",
        },
      },
    ],
    []
  )

  const filters = useFilterState(fields)

  /// What was typed, plus the chips, as the one request that answers both.
  ///
  /// Debounced for the reason the order book debounces: every keystroke is a
  /// round trip to a SQL `ILIKE` over the whole book.
  const typed = (search.value ?? "").trim()
  const needle = useDebounced(typed, 400)
  const order = sorting[0]
  const scope = useMemo<SupplierScope>(
    () => ({
      // This menu is the merchandise book. PLN, the landlord and the other
      // units of the group are parties we owe too — they live on Finance's
      // Vendors screen, against a different liability account and a different
      // month's work. See migration 0212 and `screens/finance/vendors.tsx`.
      category: "MERCHANDISE",
      ...supplierScopeFromFilters(filters.filters),
      ...(needle === "" ? {} : { q: needle }),
      ...(order === undefined || SORTS[order.id] === undefined
        ? {}
        : { sort: SORTS[order.id], desc: order.desc }),
    }),
    [filters.filters, needle, order]
  )
  /// Whether anything is narrowing the list, which is a different question from
  /// whether the list is empty: "there are none" and "none match what you
  /// asked for" have different fixes.
  const narrowed = needle !== "" || filters.filters.length > 0

  const suppliers = useQuery({
    queryKey: procurementKeys.suppliers(scope),
    queryFn: ({ signal }) => supplierPage(scope, signal),
    // The previous answer stays on screen while the next is fetched, so typing
    // a name does not flash the table through a loading line per letter.
    placeholderData: (previous) => previous,
  })

  // One page of nothing, for the facets that come with it: the server counts
  // every supplier's catalogue over the whole search, so a `limit` of one row
  // still answers "how many does each of them offer".
  const spread = useQuery({
    queryKey: procurementKeys.sourcing({ limit: 1 }),
    queryFn: ({ signal }) => searchSupplierItems({ limit: 1 }, signal),
    staleTime: 5 * 60 * 1000,
  })

  const rows = useMemo<SupplierRow[]>(() => {
    const offered = new Map(
      (spread.data?.facets.suppliers ?? []).map((facet) => [
        facet.value,
        facet.count,
      ])
    )
    return (suppliers.data?.rows ?? []).map((each) => ({
      ...each,
      offered: offered.get(each.supplier_id) ?? 0,
    }))
  }, [suppliers.data, spread.data])

  /// The same field, carrying the server's tally.
  ///
  /// Built from the answer rather than declared with the question, which would
  /// be a circle. Without it the picker asks the TABLE how many rows hold each
  /// value — and this table holds only what the filter already let through, so
  /// the option nobody ticked prints a 0 beside it and reads as a book with
  /// nothing in it.
  const counted = useMemo<FilterField[]>(() => {
    const facets = suppliers.data?.facets
    if (facets === undefined) return fields
    return fields.map((field) => ({
      ...field,
      spec: { ...field.spec, counted: facets.statuses },
    }))
  }, [fields, suppliers.data])

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns,
        getRowId: (row: SupplierRow) => row.supplier_id,
        state: { sorting },
        // The rows arrive in the order the request asked for. Sorting them
        // again here would sort the PAGE, and the two orders would disagree the
        // first time a name differed only in case — the server folds, the
        // browser does not.
        manualSorting: true,
        onSortingChange: setSorting,
      }),
      [rows, sorting]
    )
  )

  return (
    <PageContent>
      <PageHeader
        title="Suppliers"
        sub="Who we buy from, what each of them offers, and whether an order can be raised against them."
      />

      <div className="grid min-w-0 items-start gap-5 min-[1440px]:grid-cols-[minmax(0,1fr)_16rem]">
        <div className="flex min-w-0 flex-col">
          {/* One line the width of the table, carrying everything that acts on
              it: the search at the left, what orders and shapes it in the
              middle, and what creates a new one at the right. The page header
              keeps the title and nothing else. */}
          <div className="mb-3 flex flex-wrap items-center gap-1.5">
            <span className="relative mr-auto">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-line-ico" />
              <input
                value={search.value ?? ""}
                onChange={(event) =>
                  event.target.value
                    ? search.open(event.target.value)
                    : search.close()
                }
                placeholder="Search suppliers"
                aria-label="Search suppliers"
                className="h-[2.125rem] w-56 rounded-inner border border-hairline-2 bg-canvas pr-2.5 pl-8 text-[0.8125rem] text-ink shadow-soft outline-none placeholder:text-body focus:border-accent"
              />
            </span>
            <SortMenu
              table={table}
              sorting={sorting}
              onSort={(id, desc) => setSorting([{ id, desc }])}
            />
            <ColumnsMenu table={table} />
            <span aria-hidden className="mx-1 h-5 w-px bg-hairline" />
            <ViewPicker model={filters} id="suppliers" all="All suppliers" />
            <Button variant="primary" onClick={() => supplier.open("new")}>
              New supplier
            </Button>
          </div>

          <Card className="overflow-hidden">
            {queryState(suppliers, {
              loading: "Reading the supplier list…",
              render: (page) =>
                page.rows.length === 0 ? (
                  <EmptyState>
                    {narrowed
                      ? "No supplier matches what you asked for."
                      : "Nobody has been set up as a supplier yet."}
                  </EmptyState>
                ) : (
                  <DataTable<SupplierRow>
                    table={table}
                    onRowClick={(row) => supplier.open(row.supplier_id)}
                    isSelected={(row) => row.supplier_id === supplier.value}
                    className="max-h-[calc(100vh-14rem)]"
                  />
                ),
            })}
          </Card>
        </div>

        <DockedFilters
          model={{ ...filters, fields: counted }}
          kpis={bookKpis(suppliers.data)}
          id="suppliers"
          subject="Supplier"
          className="hidden min-[1440px]:flex"
        />
      </div>

      <SupplierSheet id={supplier.value ?? null} onClose={supplier.close} />
    </PageContent>
  )
}

/// Two figures about the book as it currently stands.
///
/// Both are the server's own — `total` over everything the search and the chips
/// match, `Active` from the status facet — so neither is a sum over whatever
/// page happens to be in hand.
///
/// There was a third, "No items", counting the active suppliers with an empty
/// catalogue. It is gone at the owner's word (2026-09-13): it was the one tile
/// that could only be added up over the loaded rows, and the column it
/// duplicated already says the same thing in amber, row by row.
///
/// Short labels, because a tile two to a 16rem panel truncates anything longer
/// — and a KPI whose label reads "Still buying fr…" is a figure with no
/// question attached.
function bookKpis(page: SupplierPage | undefined) {
  if (page === undefined) return undefined
  const active =
    page.facets.statuses.find((facet) => facet.value === "ACTIVE")?.count ?? 0
  return [
    { label: "Suppliers", value: count(page.total) },
    {
      label: "Active",
      value: count(active),
      note: "Suppliers an order can still be raised against.",
    },
  ]
}

// ---------------------------------------------------------------------------

/// The record, everything it offers, and everything ordered from it.
///
/// `?supplier=new` opens the composer instead — a separate sheet, because
/// creating a supplier is a task and reading one is a record, and the two want
/// different glass. They still share the fields; see `SupplierFields`.
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
  /// The edit in progress, or null for "reading". The draft IS the mode: a
  /// separate `editing` boolean beside it is a second source of truth, and the
  /// footer would have to ask the same question the body does.
  ///
  /// It carries the id it was typed against, and an edit whose id is not the
  /// record on screen counts as no edit at all. The sheet stays mounted while
  /// the list swaps records under it, so something has to say "this draft is
  /// not about the supplier you are now looking at" — and saying it in the
  /// value rather than in an effect means there is never a frame where one
  /// record's name sits in another record's form.
  const [edit, setEdit] = useState<{
    readonly id: string
    readonly draft: SupplierDraft
  } | null>(null)
  const draft = edit !== null && edit.id === id ? edit.draft : null
  const set = (patch: Partial<SupplierDraft>) =>
    setEdit((was) =>
      was === null ? was : { ...was, draft: { ...was.draft, ...patch } }
    )

  const detail = useQuery({
    queryKey: procurementKeys.supplier(id ?? ""),
    queryFn: ({ signal }) => supplierDetail(id!, signal),
    enabled: id !== null && !creating,
  })

  const save = useMutation({
    mutationFn: () =>
      updateSupplier(
        detail.data!.supplier_id,
        {
          supplier_code: draft!.code.trim(),
          name: draft!.name.trim(),
          contact_name: blank(draft!.contact),
          phone: blank(draft!.phone),
          email: blank(draft!.email),
          address: blank(draft!.address),
        },
        // The record's own version as an `If-Match`: two buyers looking at the
        // same stale row cannot both write.
        detail.data!.version,
        idempotency.key
      ),
    onSuccess: () => {
      void client.invalidateQueries({
        queryKey: procurementKeys.supplier(detail.data!.supplier_id),
      })
      void client.invalidateQueries({ queryKey: procurementKeys.suppliers() })
      idempotency.rotate()
      setEdit(null)
    },
  })

  if (creating) {
    return <SupplierComposer open onClose={onClose} />
  }

  const editing = draft !== null

  return (
    <Sheet
      open={id !== null}
      subject={id === null ? undefined : { kind: "supplier", id }}
      onOpenChange={(open) => !open && onClose()}
      id={detail.data?.supplier_code}
      title={detail.data?.name ?? "Supplier"}
      badge={
        detail.data && (
          <Pill tone={detail.data.status === "ACTIVE" ? "ok" : "neutral"}>
            {detail.data.status === "ACTIVE" ? "Active" : "Retired"}
          </Pill>
        )
      }
      actions={
        detail.data &&
        !editing && (
          <>
            <Button
              size="sm"
              onClick={() => {
                // The sentence from a save that failed an hour ago is not
                // about this edit. Cleared on the way in rather than in an
                // effect watching the record.
                save.reset()
                setEdit({ id: id!, draft: draftOf(detail.data!) })
              }}
            >
              Edit
            </Button>
            <StatusSwitch supplier={detail.data} />
          </>
        )
      }
      // The same two buttons the composer ends with, in the same place, for
      // the same reason — and only while there is something to save. A record
      // being read has nothing for a footer to do.
      footer={
        editing && (
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" onClick={() => setEdit(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={!saveable(draft) || save.isPending}
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
        render: (supplier) => (
          <div className="flex flex-col gap-4">
            {editing ? (
              <>
                {save.isError && (
                  <Banner tone="bad">{(save.error as Error).message}</Banner>
                )}
                <SupplierFields draft={draft} set={set} />
              </>
            ) : (
              <>
                <SubTabs
                  className="mb-0"
                  tabs={[
                    { value: "details", label: "Details" },
                    { value: "catalogue", label: "Catalogue" },
                    { value: "orders", label: "Orders" },
                    { value: "bank", label: "Bank" },
                  ]}
                  value={tab}
                  onChange={setTab}
                />
                {tab === "details" && (
                  <Facts>
                    <Fact term="Code">{supplier.supplier_code}</Fact>
                    <Fact term="Contact">{supplier.contact_name ?? "—"}</Fact>
                    <Fact term="Phone">{supplier.phone ?? "—"}</Fact>
                    <Fact term="Email">{supplier.email ?? "—"}</Fact>
                    <Fact term="Address">{supplier.address ?? "—"}</Fact>
                    <Fact term="Version">{supplier.version}</Fact>
                    <Fact term="Created">{day(supplier.created_at)}</Fact>
                    <Fact term="Last touched">{day(supplier.updated_at)}</Fact>
                  </Facts>
                )}
                {tab === "catalogue" && (
                  <SupplierCatalogue supplierId={supplier.supplier_id} />
                )}
                {tab === "orders" && (
                  <SupplierOrders supplierId={supplier.supplier_id} />
                )}
                {tab === "bank" && (
                  <SupplierBankAccountsPanel
                    supplierId={supplier.supplier_id}
                  />
                )}
              </>
            )}
          </div>
        ),
      })}
    </Sheet>
  )
}

/// Retire a supplier, or bring one back.
///
/// Both routes take the record's `version` as an `If-Match` ETag as well as an
/// idempotency key: two buyers looking at the same stale row cannot both write,
/// and a double-clicked button writes once.
function StatusSwitch({ supplier }: { supplier: Supplier }) {
  const client = useQueryClient()
  const idempotency = useIdempotencyKey()

  const change = useMutation({
    mutationFn: (status: SupplierStatus) =>
      setSupplierStatus(
        supplier.supplier_id,
        status,
        supplier.version,
        idempotency.key
      ),
    onSuccess: () => {
      // The record and the list it sits in. `supplier(id)` is a prefix of this
      // supplier's catalogue key, so what it offers goes with it — an item of a
      // retired supplier is not on offer either.
      void client.invalidateQueries({
        queryKey: procurementKeys.supplier(supplier.supplier_id),
      })
      void client.invalidateQueries({ queryKey: procurementKeys.suppliers() })
      idempotency.rotate()
    },
    // Said in the corner rather than as a red line under the button. This
    // control stands in the sheet's header now, where a sentence of the
    // server's would push the title around.
    onError: (problem: Error) => toast.error(problem.message),
  })

  return (
    <Button
      size="sm"
      variant={supplier.status === "ACTIVE" ? "ghost" : "soft"}
      disabled={change.isPending}
      onClick={() =>
        change.mutate(supplier.status === "ACTIVE" ? "INACTIVE" : "ACTIVE")
      }
    >
      {supplier.status === "ACTIVE" ? "Retire" : "Bring back"}
    </Button>
  )
}

/// The six fields a supplier is, and the one shape they are typed in.
///
/// Creating and editing differ in the request they send and in nothing else,
/// so they share the fields rather than keeping two lists that have to be
/// remembered together. A blank optional field means "clear it", which the
/// server distinguishes from "leave it alone" by null against absent —
/// everything here is on the form, so everything here is sent.
///
/// Held in one `useState` object rather than in a form library, which is what
/// `item-form.tsx` and `composer.tsx` — the two forms this one now stands
/// beside — already do. It is also what lets the SHEET own the buttons: the
/// footer needs to know whether the draft is saveable, and a validity flag
/// living inside a render prop three components down cannot tell it.
interface SupplierDraft {
  code: string
  name: string
  contact: string
  phone: string
  email: string
  address: string
}

const EMPTY: SupplierDraft = {
  code: "",
  name: "",
  contact: "",
  phone: "",
  email: "",
  address: "",
}

function draftOf(supplier: Supplier): SupplierDraft {
  return {
    code: supplier.supplier_code,
    name: supplier.name,
    contact: supplier.contact_name ?? "",
    phone: supplier.phone ?? "",
    email: supplier.email ?? "",
    address: supplier.address ?? "",
  }
}

function blank(value: string): string | null {
  return value.trim() === "" ? null : value.trim()
}

/// What a saveable supplier is: a code and a name.
///
/// Nothing else is required, and deliberately. A supplier is often created
/// from a delivery note with a name and a quote on it — the contact details
/// arrive later, and a required phone number would be answered with a dash.
function saveable(draft: SupplierDraft): boolean {
  return draft.code.trim() !== "" && draft.name.trim() !== ""
}

/// The fields themselves, in the two groups a supplier record actually has.
///
/// **Two columns when there is room, one when there is not.** `wide` is passed
/// by the composer, which is a task over the page at 46rem; the record rail is
/// 27.5rem, where two columns would be two 12rem boxes and an address nobody
/// can read. Same fields, same order, same component — see `item-form.tsx`,
/// which makes the same call from the same reasoning.
function SupplierFields({
  draft,
  set,
  wide,
}: {
  draft: SupplierDraft
  set: (patch: Partial<SupplierDraft>) => void
  wide?: boolean
}) {
  const pair = cn("grid gap-4", wide && "md:grid-cols-2")
  return (
    <>
      {/* Who they are. The code is ours, not theirs, and it is the one field
          on this form that cannot be corrected casually later: every item they
          offer is filed under it. */}
      <div className={pair}>
        <Field
          label="Supplier code"
          hint="Ours for this supplier, and what every item they offer is filed under. It cannot be a duplicate."
        >
          <Input
            value={draft.code}
            onChange={(event) => set({ code: event.target.value })}
            placeholder="SUP27"
          />
        </Field>
        <Field label="Name">
          <Input
            value={draft.name}
            onChange={(event) => set({ name: event.target.value })}
            placeholder="PT Sinar Tekstil Nusantara"
          />
        </Field>
      </div>

      {/* Who to call when an order is late. All optional — see `saveable` —
          and grouped under their own heading rather than trailing off the
          bottom of one list of six boxes, because they answer a different
          question from the two above. */}
      <Section title="Who to contact">
        <div className="flex flex-col gap-4">
          <div className={pair}>
            <Field label="Contact">
              <Input
                value={draft.contact}
                onChange={(event) => set({ contact: event.target.value })}
                placeholder="Budi Santoso"
              />
            </Field>
            <Field label="Phone">
              <Input
                value={draft.phone}
                onChange={(event) => set({ phone: event.target.value })}
                placeholder="+62 812 3456 7890"
              />
            </Field>
          </div>
          <Field label="Email">
            <Input
              type="email"
              value={draft.email}
              onChange={(event) => set({ email: event.target.value })}
              placeholder="orders@sinartekstil.co.id"
            />
          </Field>
          {/* A box two lines tall, not a one-line input. An Indonesian address
              is a street, a district and a city, and typing all three into a
              field that scrolls sideways is how the second half of one goes
              unread. */}
          <Field label="Address">
            <Textarea
              rows={2}
              value={draft.address}
              onChange={(event) => set({ address: event.target.value })}
              placeholder="Jl. Industri Raya No. 14, Bandung"
            />
          </Field>
        </div>
      </Section>
    </>
  )
}

/// Creating one — the composer, in the shape `New PO` settled on.
///
/// Its own sheet rather than a form inside the record's: creating is a TASK,
/// so it goes over the page at a task's width, and the two buttons stand at the
/// trailing edge of a footer. What stood here was a form in a 27.5rem rail
/// with six full-width boxes down it and one black bar across the bottom — a
/// phone pattern on a desk, and the × in the corner was the only way to
/// abandon a half-typed supplier.
function SupplierComposer({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const client = useQueryClient()
  const idempotency = useIdempotencyKey()
  const [draft, setDraft] = useState<SupplierDraft>(EMPTY)
  const set = (patch: Partial<SupplierDraft>) =>
    setDraft((was) => ({ ...was, ...patch }))

  const create = useMutation({
    // Wrapped rather than passed by reference: v5 hands a mutation context as
    // the second argument, which is not the `AbortSignal` the fetcher expects.
    mutationFn: () =>
      createSupplier(
        {
          supplier_code: draft.code.trim(),
          name: draft.name.trim(),
          contact_name: blank(draft.contact),
          phone: blank(draft.phone),
          email: blank(draft.email),
          address: blank(draft.address),
          status: "ACTIVE",
        },
        idempotency.key
      ),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: procurementKeys.suppliers() })
      idempotency.rotate()
      setDraft(EMPTY)
      onClose()
    },
  })

  /// The sheet stays mounted between openings, so without this the error from
  /// the supplier somebody gave up on is the first thing the next one says.
  const close = () => {
    create.reset()
    setDraft(EMPTY)
    onClose()
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && close()}
      title="New supplier"
      // A task over the page, not a record beside the list — and `wide` caps
      // itself at 46rem, which is as far as a form field can run before the
      // eye loses its place on the line.
      width="wide"
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!saveable(draft) || create.isPending}
            onClick={() => create.mutate()}
          >
            {create.isPending ? "Creating…" : "Create the supplier"}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {create.isError && (
          <Banner tone="bad">{(create.error as Error).message}</Banner>
        )}
        <SupplierFields draft={draft} set={set} wide />
      </div>
    </Sheet>
  )
}

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
          // A new item is a code, a name and a price — how it is classified
          // and what it comes in are decided later, on the item itself. Empty
          // is the honest state, not a gap this form should be asking about
          // while somebody is typing a price.
          colour_codes: [],
          size_codes: [],
        },
        idempotency.key
      ),
    onSuccess: () => {
      // This supplier's page, and the cross-supplier catalogue the sourcing
      // screen reads — the new item appears in both.
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
            <p className="text-meta text-mute">
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
                        className="h-auto border-0 bg-transparent px-0 text-[0.8125rem] font-normal text-accent hover:bg-transparent hover:underline"
                      >
                        {item.name}
                      </LinkButton>
                      <span className="block font-mono text-[0.65625rem] text-mute">
                        {item.supplier_item_code}
                      </span>
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {money(item.unit_price_minor)}
                    </td>
                    <td className="py-2 text-right">
                      <Pill tone={item.status === "ACTIVE" ? "ok" : "neutral"}>
                        {item.status === "ACTIVE" ? "Active" : "Retired"}
                      </Pill>
                    </td>
                  </tr>
                ))}
              </MiniTable>
              {page.next_cursor !== null && (
                <p className="text-meta text-mute">
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
              <Field label="Supplier's code for it">
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
              <Field label="Name">
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
              <Field label="Unit price" hint="Rupiah.">
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

/// Everything ordered from this supplier, each row crossing into the order.
function SupplierOrders({ supplierId }: { supplierId: string }) {
  const orders = useQuery({
    queryKey: procurementKeys.orders(),
    queryFn: ({ signal }) => listPurchaseOrders(undefined, signal),
  })

  const mine = (orders.data ?? []).filter(
    (order) => order.supplier_id === supplierId
  )

  return queryState(orders, {
    loading: "Reading the order book…",
    render: () =>
      mine.length === 0 ? (
        <p className="text-meta text-mute">
          Nothing has been ordered from this supplier yet.
        </p>
      ) : (
        <MiniTable head={["Order", "Issued", "Owed"]}>
          {mine.map((order) => (
            <tr
              key={order.purchase_order_id}
              className="border-t border-hairline"
            >
              <td className="py-2 pr-2">
                <LinkButton
                  to="/procurement/orders"
                  sheet={{ key: "order", value: order.purchase_order_id }}
                  className="h-auto border-0 bg-transparent px-0 font-mono text-id font-normal text-accent hover:bg-transparent hover:underline"
                >
                  {order.po_number}
                </LinkButton>
              </td>
              <td className="py-2 text-right tabular-nums">
                {day(order.issued_at)}
              </td>
              <td className="py-2 text-right tabular-nums">
                {count(order.outstanding_stock_units)}
              </td>
            </tr>
          ))}
        </MiniTable>
      ),
  })
}

/// Where this supplier's money is supposed to land.
///
/// Three facts fill in a bilyet giro — the bank, the number, and the name the
/// account is registered under — and the third is the one everybody assumes.
/// It is regularly not the trading name on the invoice: PT and CV forms, a
/// personal account for a small maker, an old name after a merger. A giro made
/// out to a name the bank does not recognise comes back.
///
/// Retired accounts are shown rather than filtered out. An account that paid a
/// giro last March is part of what that giro said, and a retirement nobody can
/// find is a retirement nobody can undo — the rule every master here follows.
function SupplierBankAccountsPanel({ supplierId }: { supplierId: string }) {
  const client = useQueryClient()
  const idempotency = useIdempotencyKey()
  // Whether the panel is open, not what is in it: a disclosure, so `useState`.
  const [adding, setAdding] = useState(false)

  const accounts = useQuery({
    queryKey: procurementKeys.supplierBankAccounts(supplierId),
    queryFn: ({ signal }) => supplierBankAccounts(supplierId, true, signal),
  })

  const settled = () => {
    void client.invalidateQueries({
      queryKey: procurementKeys.supplierBankAccounts(supplierId),
    })
    idempotency.rotate()
  }

  const add = useMutation({
    mutationFn: (draft: {
      bank: string
      number: string
      holder: string
      branch: string
    }) =>
      createSupplierBankAccount(
        supplierId,
        {
          bank_name: draft.bank.trim(),
          account_no: draft.number.trim(),
          account_holder: draft.holder.trim(),
          branch: blank(draft.branch),
        },
        idempotency.key
      ),
    onSuccess: () => {
      settled()
      setAdding(false)
      form.reset()
    },
  })

  /// Making one the default, retiring one and bringing one back are the same
  /// PATCH with a different field, so they are one mutation — and each carries
  /// the row's own version as its `If-Match`, exactly as the supplier does.
  const change = useMutation({
    mutationFn: ({
      account,
      patch,
    }: {
      account: SupplierBankAccount
      patch: UpdateSupplierBankAccountRequest
    }) =>
      updateSupplierBankAccount(
        supplierId,
        account.account_id,
        patch,
        account.version,
        idempotency.key
      ),
    onSuccess: settled,
  })

  const form = useForm({
    defaultValues: { bank: "", number: "", holder: "", branch: "" },
    onSubmit: ({ value }) => add.mutate(value),
  })

  const busy = add.isPending || change.isPending

  return (
    <div className="flex flex-col gap-3.5">
      {add.isError && (
        <Banner tone="bad">{(add.error as Error).message}</Banner>
      )}
      {change.isError && (
        <Banner tone="bad">{(change.error as Error).message}</Banner>
      )}

      {queryState(accounts, {
        loading: "Reading the accounts…",
        render: (rows) =>
          rows.length === 0 ? (
            <p className="text-meta text-mute">
              No account on file, so a giro to this supplier cannot be written.
            </p>
          ) : (
            <MiniTable head={["Account", "Registered to", ""]}>
              {rows.map((account) => (
                <tr
                  key={account.account_id}
                  className="border-t border-hairline"
                >
                  <td
                    className={cn("py-2 pr-2", account.retired && "text-mute")}
                  >
                    {account.bank_name}
                    {account.is_default && !account.retired && (
                      <Pill tone="ok" className="ml-2">
                        Default
                      </Pill>
                    )}
                    {account.retired && (
                      <Pill tone="neutral" className="ml-2">
                        Retired
                      </Pill>
                    )}
                    <span className="block font-mono text-[0.65625rem] text-mute">
                      {account.account_no}
                      {account.branch !== null && ` · ${account.branch}`}
                    </span>
                  </td>
                  <td
                    className={cn("py-2 pr-2", account.retired && "text-mute")}
                  >
                    {account.account_holder}
                  </td>
                  <td className="py-2 text-right whitespace-nowrap">
                    {!account.retired && !account.is_default && (
                      <Button
                        size="sm"
                        variant="quiet"
                        disabled={busy}
                        onClick={() =>
                          change.mutate({
                            account,
                            patch: { is_default: true },
                          })
                        }
                      >
                        Make default
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="quiet"
                      disabled={busy}
                      onClick={() =>
                        change.mutate({
                          account,
                          patch: { retired: !account.retired },
                        })
                      }
                    >
                      {account.retired ? "Restore" : "Retire"}
                    </Button>
                  </td>
                </tr>
              ))}
            </MiniTable>
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
          <form.Field name="bank">
            {(field) => (
              <Field label="Bank" hint="As it will be printed — “Bank BCA”.">
                <Input
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
              </Field>
            )}
          </form.Field>
          <form.Field name="number">
            {(field) => (
              <Field
                label="Account number"
                hint="Group it the way the passbook does; the dashes are kept."
              >
                <Input
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
              </Field>
            )}
          </form.Field>
          <form.Field name="holder">
            {(field) => (
              <Field
                label="Registered to"
                hint="The name the bank has, which is not always the supplier's."
              >
                <Input
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
              </Field>
            )}
          </form.Field>
          <form.Field name="branch">
            {(field) => (
              <Field label="Branch" hint="Optional. Some banks want it.">
                <Input
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
                state.values.bank.trim() !== "" &&
                // Five digits is the server's floor, checked here so the
                // button says no before the request does.
                state.values.number.replace(/\D/g, "").length >= 5 &&
                state.values.holder.trim() !== ""
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
        <Button onClick={() => setAdding(true)}>Add an account</Button>
      )}
    </div>
  )
}
