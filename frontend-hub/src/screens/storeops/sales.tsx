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
import { Segmented, Toolbar } from "@/components/ui/segmented"
import { Sheet } from "@/components/ui/sheet"
import { Banner, EmptyState } from "@/components/ui/states"
import { Tag } from "@/components/ui/tag"
import { useFilters } from "@/lib/filters"
import { count, label, money, moment, toneFor } from "@/lib/format"
import {
  createSale,
  listSales,
  storeopsKeys,
  type SaleRow,
} from "@/lib/queries/storeops"
import { queryState } from "@/lib/query-state"
import { useIdentity } from "@/lib/session"
import { useSheet } from "@/lib/sheets"
import { tableSetup, type TableSetup } from "@/lib/table"
import { SaleSheet } from "@/screens/storeops/sale-sheet"
import { problemText, useIdempotencyKey } from "@/screens/storeops/writes"

/// Every sale the centre holds, and what is still owed on the open ones.
///
/// The columns are the buyer's-eye view of a till rather than the record's
/// metadata: what the basket came to, what has been tendered against it, and
/// the difference. That last column is the reason this list sorts the way it
/// does — a completed sale is always square, so anything with money owing is
/// an open basket somebody is standing at, and those belong on the first
/// screenful. Channel, price-book version and the movement group are facts
/// about the record, not decisions, so they live in the sheet.

const columns: ColumnDef<TableSetup, SaleRow>[] = [
  {
    accessorKey: "sale_number",
    header: "Sale",
    size: 210,
    meta: { filter: { kind: "text" } },
    cell: ({ row }) => (
      <span className="font-mono text-id text-body">
        {row.original.sale_number}
      </span>
    ),
  },
  {
    accessorKey: "site_id",
    header: "Store",
    size: 130,
    meta: { filter: { kind: "option" } },
    cell: ({ row }) => (
      <span className="font-medium text-ink">{row.original.site_id}</span>
    ),
  },
  {
    accessorKey: "status",
    header: "Status",
    size: 120,
    meta: { filter: { kind: "option", format: label } },
    cell: ({ row }) => (
      <Pill tone={toneFor(row.original.status)}>
        {label(row.original.status)}
      </Pill>
    ),
  },
  {
    accessorKey: "created_at",
    header: "Opened",
    size: 150,
    meta: { filter: { kind: "date" } },
    cell: ({ row }) => moment(row.original.created_at),
  },
  {
    accessorKey: "total_minor",
    header: "Total",
    size: 130,
    meta: {
      align: "right",
      filter: { kind: "number", scale: 100, unit: "Rp" },
    },
    cell: ({ row }) => money(row.original.total_minor),
  },
  {
    accessorKey: "paid_minor",
    header: "Tendered",
    size: 130,
    meta: {
      align: "right",
      filter: { kind: "number", scale: 100, unit: "Rp" },
    },
    cell: ({ row }) => money(row.original.paid_minor),
  },
  {
    id: "owing",
    accessorFn: (row) => Math.max(row.total_minor - row.paid_minor, 0),
    header: "Owing",
    size: 130,
    meta: {
      align: "right",
      filter: { kind: "number", scale: 100, unit: "Rp" },
    },
    // The decision metric, and the reason this list sorts by it. A completed
    // sale is square by definition, so a number here is always a basket sitting
    // open at a counter.
    cell: ({ row }) => {
      const owing = Math.max(
        row.original.total_minor - row.original.paid_minor,
        0
      )
      return (
        <span className={owing > 0 ? "font-medium text-warn-fg" : "text-mute"}>
          {owing > 0 ? money(owing) : "—"}
        </span>
      )
    },
  },
]

type StatusSlice = "any" | "OPEN" | "COMPLETED" | "VOIDED"

const SLICES: readonly { value: StatusSlice; label: string }[] = [
  { value: "any", label: "All" },
  { value: "OPEN", label: "Open" },
  { value: "COMPLETED", label: "Completed" },
  { value: "VOIDED", label: "Voided" },
]

export function Sales() {
  const [query, setQuery] = useState("")
  // A slice of one dataset, so a segment rather than a sub-tab — and it is a
  // server filter, because the list is capped at 500 rows and slicing after the
  // cap would quietly hide open sales behind completed ones.
  const [slice, setSlice] = useState<StatusSlice>("any")
  const [composing, setComposing] = useState(false)
  const sale = useSheet("sale")
  // Narrowed to one shop when somebody arrived from a report — `?store=…` is
  // where an analytics chart lands, so a column on a bar is one click from the
  // receipts underneath it.
  const store = useSheet("store")
  const [sorting, setSorting] = useState<SortingState>([
    { id: "owing", desc: true },
  ])

  const sales = useQuery({
    queryKey: storeopsKeys.sales(slice, store.value),
    queryFn: ({ signal }) =>
      listSales(
        {
          status: slice === "any" ? undefined : slice,
          siteId: store.value,
          limit: 500,
        },
        signal
      ),
  })

  const rows = useMemo(() => sales.data ?? [], [sales.data])

  const filters = useFilters(columns)

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns: filters.columns,
        getRowId: (row: SaleRow) => row.id,
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
        crumb="Store ops"
        title="Sales"
        sub="What the tills have rung up, what has been tendered, and what is still owed."
        actions={
          <>
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search"
              className="h-8 w-48"
            />
            <Button variant="primary" onClick={() => setComposing(true)}>
              New sale
            </Button>
          </>
        }
      />

      <Toolbar>
        <Segmented options={SLICES} value={slice} onChange={setSlice} />
        {store.value !== undefined && (
          <>
            <Tag tone="accent">{store.value}</Tag>
            <Button size="sm" variant="quiet" onClick={store.close}>
              Every store
            </Button>
          </>
        )}
        <FilterBar model={filters} table={table} />
      </Toolbar>

      <Card className="overflow-hidden">
        {queryState(sales, {
          loading: "Loading the sales…",
          render: () =>
            rows.length === 0 ? (
              <EmptyState>
                {store.value !== undefined
                  ? `${store.value} has rung up nothing that matches.`
                  : slice === "any"
                    ? "No sale has been rung up at the centre yet."
                    : `No sale is ${label(slice).toLowerCase()} right now.`}
              </EmptyState>
            ) : (
              <DataTable<SaleRow>
                table={table}
                onRowClick={(row) => sale.open(row.id)}
                isSelected={(row) => row.id === sale.value}
                empty="No sale matches that search."
                className="max-h-[calc(100vh-17rem)]"
              />
            ),
        })}
      </Card>

      <SaleSheet id={sale.value ?? null} onClose={sale.close} />
      <NewSalePanel
        open={composing}
        onClose={() => setComposing(false)}
        onOpened={(id) => {
          setComposing(false)
          sale.open(id)
        }}
        stores={rows}
      />
    </PageContent>
  )
}

/// Opening a till.
///
/// Only two things are asked for, because only two are the caller's: the store
/// and who is standing at it. The channel is fixed — the server accepts STORE
/// and nothing else on this path — and the price book is chosen by the server
/// from whatever is published and in force, which is the only way a sale can be
/// guaranteed to price at what the shop is actually charging.
function NewSalePanel({
  open,
  onClose,
  onOpened,
  stores,
}: {
  open: boolean
  onClose: () => void
  onOpened: (saleId: string) => void
  stores: readonly SaleRow[]
}) {
  const client = useQueryClient()
  const identity = useIdentity()
  const actor = identity.data?.username
  const [site, setSite] = useState("")
  const [key, renewKey] = useIdempotencyKey()

  // The stores this centre has actually seen trade. Not a site register — there
  // is no sites endpoint on this module's list — so it is offered as a
  // suggestion beside a free field rather than as the only allowed answer.
  const known = useMemo(
    () => [...new Set(stores.map((row) => row.site_id))].sort(),
    [stores]
  )

  const raise = useMutation({
    mutationFn: () =>
      createSale({
        site_id: site.trim(),
        actor_id: actor ?? "",
        idempotency_key: key,
      }),
    onSuccess: (created) => {
      renewKey()
      setSite("")
      client.invalidateQueries({ queryKey: storeopsKeys.salesAll() })
      onOpened(created.id)
    },
  })

  const problem = problemText(raise.error)

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title="New sale"
      footer={
        <div className="flex justify-end gap-1.5">
          <Button variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="soft"
            disabled={
              site.trim() === "" || actor === undefined || raise.isPending
            }
            onClick={() => raise.mutate()}
          >
            {raise.isPending ? "Opening…" : "Open the sale"}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {problem && <Banner tone="bad">{problem}</Banner>}
        {actor === undefined && (
          <Banner tone="warn">
            A sale records who rang it up, and this browser has no signed-in
            identity to name.
          </Banner>
        )}

        <Field
          label="Store"
          hint="Sales are a store capability — the server refuses a DC or the centre."
        >
          <Input
            value={site}
            onChange={(event) => setSite(event.target.value)}
            placeholder="store-01"
            list="storeops-known-stores"
          />
        </Field>
        <datalist id="storeops-known-stores">
          {known.map((id) => (
            <option key={id} value={id} />
          ))}
        </datalist>

        <Banner tone="info">
          The price book is not chosen here. The server takes whichever
          published version is in force for this store and channel, so a sale
          cannot be rung up against a book the shop is not using — and it
          refuses outright if more than one currency is in force.
        </Banner>

        {known.length > 0 && (
          <p className="text-meta text-body">
            Trading recently: {known.join(", ")} — {count(known.length)} store
            {known.length === 1 ? "" : "s"}.
          </p>
        )}
      </div>
    </Sheet>
  )
}
