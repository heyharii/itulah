import { useNameOfLogin } from "@/lib/queries/hr-employees"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { DockTools } from "@/components/shell/dock-tools"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DataTable, dockSortOf } from "@/components/ui/data-table"
import { Input } from "@/components/ui/field"
import { FilterPanel } from "@/components/ui/filter-panel"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { Meter } from "@/components/ui/meter"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { MiniTable, TotalsLadder } from "@/components/ui/rows"
import { Segmented } from "@/components/ui/segmented"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { Banner, EmptyState } from "@/components/ui/states"
import { useFilters } from "@/lib/filters"
import { count, day, label, money, toneFor } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import {
  closeLineShort,
  listPurchaseOrders,
  procurementKeys,
  purchaseOrderDetail,
  type PurchaseOrderLine,
  type PurchaseOrderRow,
} from "@/lib/queries/procurement"
import { queryState } from "@/lib/query-state"
import { useSheet } from "@/lib/sheets"
import { tableSetup, type TableSetup } from "@/lib/table"
import { LinkButton } from "@/screens/procurement/controls"
import {
  SupplierName,
  useSupplierName,
} from "@/screens/procurement/supplier-name"
import { isOpenOrder, useActor } from "@/screens/procurement/shared"

/// Outstanding — what a supplier still owes, and the one decision a buyer can
/// make about it.
///
/// The purchase-order list is the record; this is the work. It carries only
/// orders with something still owed and it exists so `close-short` has a home:
/// 100 of 300 arrived and the buyer decides the other 200 are not coming. That
/// judgement is head office's alone — a DC that could close its own outstanding
/// lines would be marking the company's purchases complete on the strength of
/// what happened to turn up at its door.
///
/// The shortfall stays on the record afterwards. "Settled" and "arrived" are
/// not the same thing, and the report that tells a buyer which supplier
/// under-delivers is built from the difference.

function fill(row: PurchaseOrderRow): number {
  if (row.expected_stock_units <= 0) return 1
  return row.received_stock_units / row.expected_stock_units
}

const columns: ColumnDef<TableSetup, PurchaseOrderRow>[] = [
  {
    accessorKey: "po_number",
    header: "PO",
    size: 140,
    meta: { card: "hide", filter: { kind: "text" } },
    cell: ({ row }) => (
      <span className="font-mono text-id text-body">
        {row.original.po_number}
      </span>
    ),
  },
  {
    id: "supplier",
    accessorFn: (row) => row.supplier_name ?? row.supplier_id,
    header: "Supplier",
    size: 220,
    meta: { card: "hide", filter: { kind: "option" } },
    cell: ({ row }) => (
      <span className="font-medium text-ink">
        <SupplierName
          code={row.original.supplier_id}
          name={row.original.supplier_name}
        />
      </span>
    ),
  },
  {
    accessorKey: "destination_site_id",
    header: "Destination",
    size: 140,
    meta: { card: "hide", filter: { kind: "option" } },
  },
  {
    accessorKey: "lifecycle",
    header: "Status",
    size: 140,
    meta: { card: "hide", filter: { kind: "option", format: label } },
    cell: ({ row }) => (
      <Pill tone={toneFor(row.original.lifecycle)}>
        {label(row.original.lifecycle)}
      </Pill>
    ),
  },
  {
    accessorKey: "issued_at",
    header: "Issued",
    size: 120,
    meta: { card: "hide", filter: { kind: "date" } },
    cell: ({ row }) => day(row.original.issued_at),
  },
  {
    id: "fill",
    accessorFn: fill,
    header: "Arrived",
    size: 150,
    meta: { card: "hide" },
    cell: ({ row }) => {
      const share = fill(row.original)
      return (
        <span className="flex items-center gap-2">
          <Meter value={share} tone={share < 0.5 ? "warn" : "ok"} />
          <span className="w-9 shrink-0 text-right text-mute tabular-nums">
            {Math.round(share * 100)}%
          </span>
        </span>
      )
    },
  },
  {
    accessorKey: "outstanding_stock_units",
    header: "Outstanding",
    size: 120,
    meta: {
      align: "right",
      card: "hide",
      filter: { kind: "number", unit: "pcs" },
    },
    // The decision metric, and the default sort: the biggest hole in the
    // company's expected stock is the supplier somebody rings first.
    cell: ({ row }) => (
      <span className="font-medium text-warn-fg">
        {count(row.original.outstanding_stock_units)}
      </span>
    ),
  },
  // Four columns that exist only on a card (a phone): the supplier over its
  // PO number, what is still owed as the figure the card leads with, how much
  // has arrived and since when, and where the order stands.
  {
    id: "head",
    accessorFn: (row) => row.supplier_name ?? row.supplier_id,
    header: "",
    enableHiding: false,
    enableSorting: false,
    meta: { card: "title" },
    cell: ({ row }) => (
      <span className="flex min-w-0 flex-col gap-1">
        <span className="min-w-0 text-[1rem] font-semibold break-words text-ink">
          <SupplierName
            code={row.original.supplier_id}
            name={row.original.supplier_name}
          />
        </span>
        <span className="font-mono text-[0.875rem] font-normal text-mute">
          {row.original.po_number}
        </span>
      </span>
    ),
  },
  {
    id: "lead",
    accessorFn: (row) => row.outstanding_stock_units,
    header: "",
    enableHiding: false,
    enableSorting: false,
    meta: { card: "lead" },
    cell: ({ row }) => (
      <span className="flex flex-col items-end tabular-nums">
        <span className="text-[1.5rem] leading-tight font-semibold tracking-tight text-warn-fg">
          {count(row.original.outstanding_stock_units)}
        </span>
        <span className="text-[0.875rem] text-mute">pcs owed</span>
      </span>
    ),
  },
  {
    id: "foot",
    accessorFn: fill,
    header: "",
    enableHiding: false,
    enableSorting: false,
    meta: { card: "foot" },
    cell: ({ row }) => (
      <span className="flex flex-col">
        <span>
          <span className="text-ink tabular-nums">
            {Math.round(fill(row.original) * 100)}%
          </span>{" "}
          arrived
        </span>
        <span>
          {row.original.issued_at === null
            ? "Not issued"
            : `Issued ${day(row.original.issued_at)}`}
        </span>
      </span>
    ),
  },
  {
    id: "state",
    accessorFn: (row) => row.lifecycle,
    header: "",
    enableHiding: false,
    enableSorting: false,
    meta: { align: "right", card: "status" },
    cell: ({ row }) => (
      <Pill tone={toneFor(row.original.lifecycle)}>
        {label(row.original.lifecycle)}
      </Pill>
    ),
  },
]

export function Outstanding() {
  const order = useSheet("order")
  const [age, setAge] = useState<"ALL" | "ISSUED">("ALL")
  const [sorting, setSorting] = useState<SortingState>([
    { id: "outstanding_stock_units", desc: true },
  ])

  const orders = useQuery({
    queryKey: procurementKeys.orders(),
    queryFn: ({ signal }) => listPurchaseOrders(undefined, signal),
  })

  // Filtered here rather than by the server: `GET /api/v1/purchase-orders`
  // takes no query and answers the whole book, so a second request would fetch
  // the same rows again to ask a narrower question. Only an order still open:
  // a cancelled one, or one closed short, owes nothing, though its row still
  // carries expected − received (`isOpenOrder`).
  const rows = useMemo(
    () =>
      (orders.data ?? []).filter(
        (row) =>
          isOpenOrder(row) &&
          row.outstanding_stock_units > 0 &&
          (age === "ALL" || row.issued_at !== null)
      ),
    [orders.data, age]
  )

  const units = rows.reduce((sum, row) => sum + row.outstanding_stock_units, 0)
  const suppliers = new Set(rows.map((row) => row.supplier_id)).size

  const filters = useFilters(columns)
  const phone = useLayout() === "phone"
  /// What the phone's dock field typed: a PO number or a supplier's name.
  const [query, setQuery] = useState("")

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns: filters.columns,
        getRowId: (row: PurchaseOrderRow) => row.purchase_order_id,
        state: {
          columnFilters: filters.columnFilters,
          globalFilter: phone ? query : "",
          sorting,
          // The card's own columns are drawn on a phone and never on a desk.
          columnVisibility: {
            head: phone,
            lead: phone,
            foot: phone,
            state: phone,
          },
        },
        onSortingChange: setSorting,
        onGlobalFilterChange: setQuery,
      }),
      [rows, filters.columns, filters.columnFilters, query, sorting, phone]
    )
  )

  return (
    <PageContent>
      <PageHeader
        crumb="Procurement"
        title="Outstanding"
        sub="Orders with something still owed, and the lines a buyer has stopped waiting for."
        // The phone's bar already has Orders: nothing but the title and the
        // figures stands at the top.
        actions={
          phone ? undefined : (
            <LinkButton to="/procurement/orders">The whole book</LinkButton>
          )
        }
      />

      <KpiStrip className="grid-cols-2 md:grid-cols-3 xl:grid-cols-3">
        <Kpi label="Orders Behind" value={count(rows.length)} />
        <Kpi label="Suppliers to Chase" value={count(suppliers)} />
        <Kpi label="Units Still Owed" value={count(units)} />
      </KpiStrip>

      {/* A desk's toolbar: on a phone the age is the dock's status button, and
          the search, the filter and the sort sit beside it. */}
      <div className="mb-3.5 flex flex-wrap items-center gap-[0.4375rem] max-md:hidden">
        <Segmented
          options={[
            { value: "ALL", label: "Everything owed" },
            { value: "ISSUED", label: "Issued only" },
          ]}
          value={age}
          onChange={setAge}
        />
        <FilterPanel model={filters} table={table} />
      </div>
      <DockTools
        search={{
          value: query,
          onChange: setQuery,
          label: "Search Outstanding",
        }}
        filter={{
          count: filters.filters.length,
          panel: { model: filters, table },
        }}
        sort={dockSortOf(table)}
        status={{
          value: age,
          options: [
            { value: "ALL", label: "Everything owed" },
            { value: "ISSUED", label: "Issued only" },
          ],
          onChange: (next) => setAge(next as "ALL" | "ISSUED"),
        }}
      />

      <Card className="overflow-hidden max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
        {queryState(orders, {
          loading: "Reading the order book…",
          render: () =>
            rows.length === 0 ? (
              <EmptyState>
                {age === "ISSUED"
                  ? "No issued order is waiting on anything."
                  : "Every order has arrived in full."}
              </EmptyState>
            ) : (
              <DataTable<PurchaseOrderRow>
                refresh={[orders]}
                table={table}
                onRowClick={(row) => order.open(row.purchase_order_id)}
                isSelected={(row) => row.purchase_order_id === order.value}
                className="max-h-[calc(100dvh-20rem)]"
                cardSort={false}
                cardsApart
                cardLead
              />
            ),
        })}
      </Card>

      <ChaseSheet id={order.value ?? null} onClose={order.close} />
    </PageContent>
  )
}

/// The order, line by line, with the only write this module makes against one.
function ChaseSheet({
  id,
  onClose,
}: {
  id: string | null
  onClose: () => void
}) {
  const nameOfLogin = useNameOfLogin()
  const client = useQueryClient()
  const actor = useActor()
  const nameOf = useSupplierName()
  const [openLine, setOpenLine] = useState<string | null>(null)
  const [reason, setReason] = useState("")

  const detail = useQuery({
    queryKey: procurementKeys.order(id ?? ""),
    queryFn: ({ signal }) => purchaseOrderDetail(id!, signal),
    enabled: id !== null,
  })

  const close = useMutation({
    mutationFn: (line: PurchaseOrderLine) =>
      closeLineShort(line.po_line_id, actor, reason.trim()),
    onSuccess: () => {
      // The line's status and the order's outstanding figure both move, and the
      // order book's row is computed from the same receipts — so the record and
      // the list it came from, named.
      void client.invalidateQueries({ queryKey: procurementKeys.order(id!) })
      void client.invalidateQueries({ queryKey: procurementKeys.orders() })
      setOpenLine(null)
      setReason("")
    },
  })

  return (
    <Sheet
      open={id !== null}
      subject={id === null ? undefined : { kind: "purchase_order", id }}
      onOpenChange={(open) => !open && onClose()}
      id={detail.data?.po_number}
      title={
        detail.data === undefined
          ? "Order"
          : nameOf(
              detail.data.supplier_id,
              detail.data.supplier_name,
              detail.data.supplier_ref_id
            )
      }
      actions={
        detail.data && (
          <LinkButton
            to="/procurement/orders"
            sheet={{ key: "order", value: detail.data.purchase_order_id }}
          >
            Full record
          </LinkButton>
        )
      }
    >
      {queryState(detail, {
        loading: "Loading the order…",
        render: (order) => {
          const owed = order.lines.filter(
            (line) => line.outstanding_stock_units > 0
          )
          return (
            <div className="flex flex-col gap-5">
              <div>
                <Pill tone={toneFor(order.lifecycle)}>
                  {label(order.lifecycle)}
                </Pill>
              </div>

              {close.isError && (
                <Banner tone="bad">{(close.error as Error).message}</Banner>
              )}

              <Facts>
                <Fact term="Destination">{order.destination_site_id}</Fact>
                <Fact term="Issued">{day(order.issued_at)}</Fact>
                {/* What the deliveries are EXPECTED to be worth, at the prices
                    they were accepted at. Not a payable: nothing has validated
                    it and nothing is in the ledger until Finance matches a
                    supplier bill against it. */}
                <Fact term="Expected Value">
                  {money(order.expected_value_minor)}
                </Fact>
                <Fact term="Created By">{nameOfLogin(order.created_by)}</Fact>
              </Facts>

              <div>
                <h4 className="mb-2 text-card-title font-semibold text-ink">
                  Still owed
                </h4>
                {owed.length === 0 ? (
                  <p className="text-meta text-mute">
                    Nothing on this order is outstanding any more.
                  </p>
                ) : (
                  <MiniTable head={["Line", "Ordered", "Received", "Owed"]}>
                    {owed.map((line) => (
                      <tr
                        key={line.po_line_id}
                        className="border-t border-hairline"
                      >
                        <td className="py-2 pr-2" colSpan={4}>
                          <span className="flex items-baseline gap-2">
                            <span className="min-w-0 flex-1">
                              <span className="block text-[0.875rem] text-ink">
                                {line.article_name}
                              </span>
                              <span className="font-mono text-[0.875rem] text-mute">
                                {line.article_code}
                              </span>
                            </span>
                            <span className="flex shrink-0 flex-col items-end text-right text-[0.875rem] text-body tabular-nums">
                              <span>
                                {count(line.received_quantity)} of{" "}
                                {count(line.expected_stock_units)}
                              </span>
                              {/* The pieces above are what receiving counts
                                  against; the unit the order was placed in is
                                  shown underneath, for the buyer's own memory
                                  of what was typed. */}
                              {line.order_unit_code &&
                                line.order_unit_quantity && (
                                  <span className="text-mute">
                                    ordered{" "}
                                    {line.order_unit_quantity.replace(".", ",")}{" "}
                                    {line.order_unit_code}
                                  </span>
                                )}
                            </span>
                            <span className="w-14 shrink-0 text-right text-[0.875rem] font-medium text-warn-fg tabular-nums">
                              {count(line.outstanding_stock_units)}
                            </span>
                          </span>

                          {openLine === line.po_line_id ? (
                            <span className="mt-2 flex items-center gap-2">
                              <Input
                                value={reason}
                                onChange={(event) =>
                                  setReason(event.target.value)
                                }
                                className="h-8"
                                autoFocus
                              />
                              <Button
                                variant="soft"
                                size="sm"
                                pending={close.isPending}
                                disabled={reason.trim() === "" || actor === ""}
                                onClick={() => close.mutate(line)}
                              >
                                {close.isPending ? "Submitting…" : "Submit"}
                              </Button>
                              <Button
                                variant="quiet"
                                size="sm"
                                onClick={() => setOpenLine(null)}
                              >
                                Cancel
                              </Button>
                            </span>
                          ) : (
                            <Button
                              variant="quiet"
                              size="sm"
                              className="mt-1.5"
                              onClick={() => {
                                setOpenLine(line.po_line_id)
                                setReason("")
                              }}
                            >
                              Stop waiting for the rest
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </MiniTable>
                )}
              </div>

              <TotalsLadder
                rows={[
                  {
                    label: "Expected units",
                    value: count(
                      order.lines.reduce(
                        (sum, line) => sum + line.expected_stock_units,
                        0
                      )
                    ),
                  },
                  {
                    label: "Received units",
                    value: count(
                      order.lines.reduce(
                        (sum, line) => sum + line.received_quantity,
                        0
                      )
                    ),
                  },
                  {
                    label: "Closed short",
                    value: count(
                      order.lines.reduce(
                        (sum, line) => sum + (line.closed_short_units ?? 0),
                        0
                      )
                    ),
                  },
                ]}
                total={{
                  label: "Still owed",
                  value: count(
                    order.lines.reduce(
                      (sum, line) => sum + line.outstanding_stock_units,
                      0
                    )
                  ),
                }}
              />
            </div>
          )
        },
      })}
    </Sheet>
  )
}
