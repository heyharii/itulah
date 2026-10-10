import { useQuery } from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { DockTools } from "@/components/shell/dock-tools"
import { Card } from "@/components/ui/card"
import { DataTable, dockSortOf } from "@/components/ui/data-table"
import { FilterPanel } from "@/components/ui/filter-panel"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { PageHeader } from "@/components/ui/page-header"
import { EmptyState } from "@/components/ui/states"
import { Tag } from "@/components/ui/tag"
import { useFilters } from "@/lib/filters"
import { count } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import {
  listPurchaseOrders,
  procurementKeys,
  purchaseDestinations,
} from "@/lib/queries/procurement"
import { queryState } from "@/lib/query-state"
import { tableSetup, type TableSetup } from "@/lib/table"
import { cn } from "@/lib/utils"
import { LinkButton } from "@/screens/procurement/controls"
import { owedOn } from "@/screens/procurement/shared"

/// Destinations — where a delivery can actually go, and what is already on its
/// way there.
///
/// The list of sites is deliberately not `GET /api/v1/sync/origins`: that is
/// Admin-only, because knowing which nodes exist is administration even when
/// you are only reading it, and a Supervisor raising an order was getting a 403
/// on a list of site names. `/api/v1/purchase-destinations` asks the purchasing
/// question instead — where can a delivery go — and answers with site names and
/// roles and nothing else. No ingest keys, no generations, no command backlog.
///
/// It is also not `/api/v1/sync/fleet`, which everybody can read but answers a
/// different question: it carries `origin_id` and convergence, not `site_id`,
/// and the two are not the same string. An order routed by origin id would name
/// a site that does not exist.

interface DestinationRow {
  readonly site_id: string
  readonly label: string
  readonly node_role: string
  readonly orders: number
  readonly outstanding: number
}

const columns: ColumnDef<TableSetup, DestinationRow>[] = [
  {
    accessorKey: "label",
    header: "Destination",
    size: 260,
    meta: { card: "hide" },
    cell: ({ row }) => (
      <span className="flex flex-col">
        <span className="font-medium text-ink">{row.original.label}</span>
        <span className="font-mono text-[0.875rem] text-mute">
          {row.original.site_id}
        </span>
      </span>
    ),
  },
  {
    accessorKey: "node_role",
    header: "Kind",
    size: 130,
    // A buyer routing a full container and a buyer topping up one shop are
    // making different decisions, and the list says which is which — and it is
    // the one question worth asking a two-value column, because "only the
    // warehouses" is how a container is routed.
    meta: { card: "hide", filter: { kind: "option" } },
    cell: ({ row }) => (
      <Tag tone={row.original.node_role === "DC" ? "accent" : "neutral"}>
        {row.original.node_role}
      </Tag>
    ),
  },
  {
    accessorKey: "orders",
    header: "Orders Routed Here",
    size: 170,
    // Zero is the interesting end of this column, not the top: a destination
    // nothing has ever been routed to is either a shop nobody supplies direct
    // or a site somebody forgot, and `is 0` is the only way to ask which.
    meta: {
      align: "right",
      card: "hide",
      filter: { kind: "number", unit: "orders" },
    },
    cell: ({ row }) => count(row.original.orders),
  },
  {
    accessorKey: "outstanding",
    header: "Units Still Owed",
    size: 160,
    meta: {
      align: "right",
      card: "hide",
      filter: { kind: "number", unit: "pcs" },
    },
    // The decision metric: a destination with a lot in flight is where the
    // receiving effort is about to land.
    cell: ({ row }) => (
      <span
        className={
          row.original.outstanding > 0
            ? "font-medium text-warn-fg"
            : "text-mute"
        }
      >
        {count(row.original.outstanding)}
      </span>
    ),
  },
  // Four columns that exist only on a card (a phone): the place over its site
  // id, what is still owed to it as the figure the card leads with, how many
  // orders are routed there, and what kind of place it is.
  {
    id: "head",
    accessorFn: (row) => row.label,
    header: "",
    enableHiding: false,
    enableSorting: false,
    meta: { card: "title" },
    cell: ({ row }) => (
      <span className="flex min-w-0 flex-col gap-1">
        <span className="min-w-0 text-[1rem] font-semibold break-words text-ink">
          {row.original.label}
        </span>
        <span className="font-mono text-[0.875rem] font-normal text-mute">
          {row.original.site_id}
        </span>
      </span>
    ),
  },
  {
    id: "lead",
    accessorFn: (row) => row.outstanding,
    header: "",
    enableHiding: false,
    enableSorting: false,
    meta: { card: "lead" },
    cell: ({ row }) => (
      <span className="flex flex-col items-end tabular-nums">
        <span
          className={cn(
            "text-[1.5rem] leading-tight font-semibold tracking-tight",
            row.original.outstanding > 0 ? "text-warn-fg" : "text-mute"
          )}
        >
          {count(row.original.outstanding)}
        </span>
        <span className="text-[0.875rem] text-mute">pcs owed</span>
      </span>
    ),
  },
  {
    id: "foot",
    accessorFn: (row) => row.orders,
    header: "",
    enableHiding: false,
    enableSorting: false,
    meta: { card: "foot" },
    cell: ({ row }) => (
      <span>
        <span className="text-ink tabular-nums">
          {count(row.original.orders)}
        </span>{" "}
        {row.original.orders === 1 ? "order" : "orders"} routed here
      </span>
    ),
  },
  {
    id: "kind",
    accessorFn: (row) => row.node_role,
    header: "",
    enableHiding: false,
    enableSorting: false,
    meta: { align: "right", card: "status" },
    cell: ({ row }) => (
      <Tag tone={row.original.node_role === "DC" ? "accent" : "neutral"}>
        {row.original.node_role}
      </Tag>
    ),
  },
]

export function Destinations() {
  const [sorting, setSorting] = useState<SortingState>([
    { id: "outstanding", desc: true },
  ])

  const destinations = useQuery({
    queryKey: procurementKeys.destinations(),
    queryFn: ({ signal }) => purchaseDestinations(signal),
  })

  const orders = useQuery({
    queryKey: procurementKeys.orders(),
    queryFn: ({ signal }) => listPurchaseOrders(undefined, signal),
  })

  const rows = useMemo<DestinationRow[]>(() => {
    const book = orders.data ?? []
    return (destinations.data ?? []).map((destination) => {
      const routed = book.filter(
        (order) => order.destination_site_id === destination.site_id
      )
      return {
        site_id: destination.site_id,
        label: destination.label,
        node_role: destination.node_role,
        orders: routed.length,
        // What is still owed on the orders still open, as Outstanding counts
        // it: a cancelled order or one closed short is not in flight.
        outstanding: routed.reduce((sum, order) => sum + owedOn(order), 0),
      }
    })
  }, [destinations.data, orders.data])

  const warehouses = rows.filter((row) => row.node_role === "DC").length

  const filters = useFilters(columns)
  const phone = useLayout() === "phone"
  /// What the phone's dock field typed: a place's name or its site id.
  const [query, setQuery] = useState("")

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns: filters.columns,
        getRowId: (row: DestinationRow) => row.site_id,
        state: {
          columnFilters: filters.columnFilters,
          globalFilter: phone ? query : "",
          sorting,
          // The card's own columns are drawn on a phone and never on a desk.
          columnVisibility: {
            head: phone,
            lead: phone,
            foot: phone,
            kind: phone,
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
        title="Destinations"
        sub="Sites a purchase order can name, and what is already on its way to each."
        // The phone's bar and dock carry the way on: only the title and the
        // figures stand at the top.
        actions={
          phone ? undefined : (
            <LinkButton to="/procurement/outstanding">
              What is still owed
            </LinkButton>
          )
        }
      />

      <KpiStrip className="grid-cols-2 md:grid-cols-3 xl:grid-cols-3">
        <Kpi label="Places a Delivery Can Go" value={count(rows.length)} />
        <Kpi label="Warehouses" value={count(warehouses)} />
        <Kpi
          label="Units in Flight"
          value={count(rows.reduce((sum, row) => sum + row.outstanding, 0))}
        />
      </KpiStrip>

      {/* The KPIs above are the whole fleet and the filters below narrow only
          the table: a strip that moved with the chips would be a second,
          quieter answer to "how many places can a delivery go", and the
          question this screen exists to answer is the unnarrowed one. */}
      <div className="mb-3.5 flex flex-wrap items-center gap-[0.4375rem] max-md:hidden">
        <FilterPanel model={filters} table={table} />
      </div>
      <DockTools
        search={{
          value: query,
          onChange: setQuery,
          label: "Search Destinations",
        }}
        filter={{
          count: filters.filters.length,
          panel: { model: filters, table },
        }}
        sort={dockSortOf(table)}
      />

      <Card className="overflow-hidden max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
        {queryState(destinations, {
          loading: "Asking where a delivery can go…",
          render: () =>
            rows.length === 0 ? (
              <EmptyState>
                No node carries inventory for a named site, so there is nowhere
                an order can be delivered.
              </EmptyState>
            ) : (
              <DataTable<DestinationRow>
                refresh={[destinations, orders]}
                table={table}
                empty="No destination matches the filters in force."
                className="max-h-[calc(100dvh-20rem)]"
                cardSort={false}
                cardsApart
                cardLead
              />
            ),
        })}
      </Card>
    </PageContent>
  )
}
