import { useForm } from "@tanstack/react-form"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Field, Input } from "@/components/ui/field"
import { FilterBar } from "@/components/ui/filter-bar"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { MiniTable } from "@/components/ui/rows"
import { Segmented, Toolbar } from "@/components/ui/segmented"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { SubTabs } from "@/components/ui/sub-tabs"
import { Banner, EmptyState } from "@/components/ui/states"
import { useFilters } from "@/lib/filters"
import { count, day, money } from "@/lib/format"
import {
  createSupplier,
  createSupplierItem,
  listPurchaseOrders,
  listSuppliers,
  procurementKeys,
  searchSupplierItems,
  setSupplierStatus,
  supplierCatalogue,
  supplierDetail,
  updateSupplier,
} from "@/lib/queries/procurement"
import { queryState } from "@/lib/query-state"
import { useSheet } from "@/lib/sheets"
import { tableSetup, type TableSetup } from "@/lib/table"
import { LinkButton } from "@/screens/procurement/controls"
import { useIdempotencyKey } from "@/screens/procurement/shared"
import type { Supplier, SupplierStatus } from "@itulah/contract"

/// Suppliers — who we buy from, and whether we can.
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

const columns: ColumnDef<TableSetup, SupplierRow>[] = [
  {
    accessorKey: "name",
    header: "Supplier",
    size: 300,
    meta: { filter: { kind: "text" } },
    cell: ({ row }) => (
      <span className="flex flex-col">
        <span className="font-medium text-ink">{row.original.name}</span>
        <span className="font-mono text-[0.65625rem] text-mute">
          {row.original.supplier_code}
        </span>
      </span>
    ),
  },
  {
    accessorKey: "status",
    header: "Status",
    size: 120,
    meta: { filter: { kind: "option" } },
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
    meta: { align: "right", filter: { kind: "number", unit: "items" } },
    // The decision metric, and the reason this list sorts ascending: an active
    // supplier with an empty catalogue is a relationship nobody can buy from,
    // and it should be the first row somebody sees rather than the last.
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
    accessorKey: "updated_at",
    header: "Last touched",
    size: 150,
    meta: { filter: { kind: "date" } },
    cell: ({ row }) => day(row.original.updated_at),
  },
]

export function Suppliers() {
  const supplier = useSheet("supplier")
  const [query, setQuery] = useState("")
  const [status, setStatus] = useState<SupplierStatus | "ALL">("ACTIVE")
  const [sorting, setSorting] = useState<SortingState>([
    { id: "offered", desc: false },
  ])

  const suppliers = useQuery({
    queryKey: procurementKeys.suppliers(),
    queryFn: ({ signal }) => listSuppliers(undefined, signal),
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
    return (suppliers.data ?? [])
      .filter((each) => status === "ALL" || each.status === status)
      .map((each) => ({
        ...each,
        offered: offered.get(each.supplier_id) ?? 0,
      }))
  }, [suppliers.data, spread.data, status])

  const filters = useFilters(columns)

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns: filters.columns,
        getRowId: (row: SupplierRow) => row.supplier_id,
        state: {
          columnFilters: filters.columnFilters,
          globalFilter: query,
          sorting,
        },
        onSortingChange: setSorting,
        onGlobalFilterChange: setQuery,
      }),
      [rows, filters.columns, filters.columnFilters, query, sorting]
    )
  )

  return (
    <PageContent>
      <PageHeader
        crumb="Procurement"
        title="Suppliers"
        sub="Who we buy from, what each of them offers, and whether an order can be raised against them."
        actions={
          <>
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Name or code"
              className="h-8 w-48"
            />
            <Button variant="dark" onClick={() => supplier.open("new")}>
              New supplier
            </Button>
          </>
        }
      />

      <Toolbar>
        <Segmented
          options={[
            { value: "ACTIVE", label: "Active" },
            { value: "INACTIVE", label: "Retired" },
            { value: "ALL", label: "Everyone" },
          ]}
          value={status}
          onChange={setStatus}
        />
      <FilterBar model={filters} table={table} />
      </Toolbar>

      <Card className="overflow-hidden">
        {queryState(suppliers, {
          loading: "Reading the supplier list…",
          render: () =>
            rows.length === 0 ? (
              <EmptyState>
                {query !== "" || status !== "ALL"
                  ? "No supplier matches that search."
                  : "Nobody has been set up as a supplier yet."}
              </EmptyState>
            ) : (
              <DataTable<SupplierRow>
                table={table}
                onRowClick={(row) => supplier.open(row.supplier_id)}
                isSelected={(row) => row.supplier_id === supplier.value}
                className="max-h-[calc(100vh-18rem)]"
              />
            ),
        })}
      </Card>

      <SupplierSheet id={supplier.value ?? null} onClose={supplier.close} />
    </PageContent>
  )
}

// ---------------------------------------------------------------------------

/// The record, everything it offers, and everything ordered from it.
///
/// `?supplier=new` opens the same sheet on a blank form. That is not a trick:
/// creating and reading a supplier are the same shape of thing, and a second
/// dialog for the create case would be a second place the field list has to be
/// kept in step.
function SupplierSheet({
  id,
  onClose,
}: {
  id: string | null
  onClose: () => void
}) {
  const creating = id === "new"
  const [tab, setTab] = useState("details")
  const [editing, setEditing] = useState(false)

  const detail = useQuery({
    queryKey: procurementKeys.supplier(id ?? ""),
    queryFn: ({ signal }) => supplierDetail(id!, signal),
    enabled: id !== null && !creating,
  })

  if (creating) {
    return (
      <Sheet
        open
        onOpenChange={(open) => !open && onClose()}
        title="New supplier"
      >
        <CreateSupplier onCreated={onClose} />
      </Sheet>
    )
  }

  return (
    <Sheet
      open={id !== null}
      subject={id === null ? undefined : { kind: "supplier", id }}
      onOpenChange={(open) => !open && onClose()}
      id={detail.data?.supplier_code}
      title={detail.data?.name ?? "Supplier"}
      actions={
        detail.data && (
          <Button size="sm" onClick={() => setEditing((was) => !was)}>
            {editing ? "Stop editing" : "Edit"}
          </Button>
        )
      }
    >
      {queryState(detail, {
        loading: "Loading the supplier…",
        render: (supplier) => (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-2">
              <Pill tone={supplier.status === "ACTIVE" ? "ok" : "neutral"}>
                {supplier.status === "ACTIVE" ? "Active" : "Retired"}
              </Pill>
              <StatusSwitch supplier={supplier} />
            </div>

            {editing ? (
              <EditSupplier
                supplier={supplier}
                onSaved={() => setEditing(false)}
              />
            ) : (
              <>
                <SubTabs
                  className="mb-0"
                  tabs={[
                    { value: "details", label: "Details" },
                    { value: "catalogue", label: "Catalogue" },
                    { value: "orders", label: "Orders" },
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
  })

  return (
    <>
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
      {change.isError && (
        <span className="text-[0.71875rem] text-bad">
          {(change.error as Error).message}
        </span>
      )}
    </>
  )
}

/// The six fields a supplier is, and the one shape they are typed in.
///
/// Creating and editing differ in the request they send and in nothing else,
/// so they share the form rather than keeping two field lists that have to be
/// remembered together. A blank optional field means "clear it", which the
/// server distinguishes from "leave it alone" by null against absent —
/// everything here is on the form, so everything here is sent.
interface SupplierDraft {
  code: string
  name: string
  contact: string
  phone: string
  email: string
  address: string
}

function blank(value: string): string | null {
  return value.trim() === "" ? null : value.trim()
}

function SupplierForm({
  defaults,
  codeHint,
  submit,
  pendingLabel,
  submitLabel,
  problem,
  onSubmit,
}: {
  defaults: SupplierDraft
  codeHint?: string
  /// True while the write is in flight.
  submit: boolean
  pendingLabel: string
  submitLabel: string
  problem: string | null
  onSubmit: (draft: SupplierDraft) => void
}) {
  const form = useForm({
    defaultValues: defaults,
    onSubmit: ({ value }) => onSubmit(value),
  })

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        form.handleSubmit()
      }}
      className="flex flex-col gap-3.5"
    >
      {problem && <Banner tone="bad">{problem}</Banner>}

      <form.Field name="code">
        {(field) => (
          <Field label="Supplier code" hint={codeHint}>
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
      <form.Field name="contact">
        {(field) => (
          <Field label="Contact">
            <Input
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.target.value)}
            />
          </Field>
        )}
      </form.Field>
      <form.Field name="phone">
        {(field) => (
          <Field label="Phone">
            <Input
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.target.value)}
            />
          </Field>
        )}
      </form.Field>
      <form.Field name="email">
        {(field) => (
          <Field label="Email">
            <Input
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.target.value)}
            />
          </Field>
        )}
      </form.Field>
      <form.Field name="address">
        {(field) => (
          <Field label="Address">
            <Input
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.target.value)}
            />
          </Field>
        )}
      </form.Field>

      <form.Subscribe
        selector={(state) =>
          state.values.code.trim() !== "" && state.values.name.trim() !== ""
        }
      >
        {(ready) => (
          <Button type="submit" variant="dark" disabled={!ready || submit}>
            {submit ? pendingLabel : submitLabel}
          </Button>
        )}
      </form.Subscribe>
    </form>
  )
}

function CreateSupplier({ onCreated }: { onCreated: () => void }) {
  const client = useQueryClient()
  const idempotency = useIdempotencyKey()

  const create = useMutation({
    // Wrapped rather than passed by reference: v5 hands a mutation context as
    // the second argument, which is not the `AbortSignal` the fetcher expects.
    mutationFn: (draft: SupplierDraft) =>
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
      onCreated()
    },
  })

  return (
    <SupplierForm
      defaults={{
        code: "",
        name: "",
        contact: "",
        phone: "",
        email: "",
        address: "",
      }}
      codeHint="Ours for this supplier. It is what every item they offer is filed under, and it cannot be a duplicate."
      submit={create.isPending}
      pendingLabel="Creating…"
      submitLabel="Create the supplier"
      problem={create.isError ? (create.error as Error).message : null}
      onSubmit={(draft) => create.mutate(draft)}
    />
  )
}

function EditSupplier({
  supplier,
  onSaved,
}: {
  supplier: Supplier
  onSaved: () => void
}) {
  const client = useQueryClient()
  const idempotency = useIdempotencyKey()

  const save = useMutation({
    mutationFn: (draft: SupplierDraft) =>
      updateSupplier(
        supplier.supplier_id,
        {
          supplier_code: draft.code.trim(),
          name: draft.name.trim(),
          contact_name: blank(draft.contact),
          phone: blank(draft.phone),
          email: blank(draft.email),
          address: blank(draft.address),
        },
        supplier.version,
        idempotency.key
      ),
    onSuccess: () => {
      void client.invalidateQueries({
        queryKey: procurementKeys.supplier(supplier.supplier_id),
      })
      void client.invalidateQueries({ queryKey: procurementKeys.suppliers() })
      idempotency.rotate()
      onSaved()
    },
  })

  return (
    <SupplierForm
      defaults={{
        code: supplier.supplier_code,
        name: supplier.name,
        contact: supplier.contact_name ?? "",
        phone: supplier.phone ?? "",
        email: supplier.email ?? "",
        address: supplier.address ?? "",
      }}
      submit={save.isPending}
      pendingLabel="Saving…"
      submitLabel="Save"
      problem={save.isError ? (save.error as Error).message : null}
      onSubmit={(draft) => save.mutate(draft)}
    />
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
    queryFn: ({ signal }) => listPurchaseOrders(signal),
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
