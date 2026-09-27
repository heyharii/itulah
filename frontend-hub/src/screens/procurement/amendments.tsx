import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { FilterPanel } from "@/components/ui/filter-panel"
import { Input, Textarea } from "@/components/ui/field"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { PageHeader } from "@/components/ui/page-header"
import { MiniTable, TotalsLadder } from "@/components/ui/rows"
import { Toolbar } from "@/components/ui/segmented"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { Banner, EmptyState } from "@/components/ui/states"
import { Tag } from "@/components/ui/tag"
import { useFilters } from "@/lib/filters"
import { moment, money } from "@/lib/format"
import {
  decidePriceAmendment,
  listPurchaseOrders,
  pendingPriceAmendments,
  procurementKeys,
  type PriceAmendment,
  type PriceAmendmentOutcome,
} from "@/lib/queries/procurement"
import { queryState } from "@/lib/query-state"
import { useSheet } from "@/lib/sheets"
import { tableSetup, type TableSetup } from "@/lib/table"
import { LinkButton } from "@/screens/procurement/controls"
import { useActor } from "@/screens/procurement/shared"

/// Price amendments — the buyer's inbox.
///
/// A supplier billed something other than the order says, the DC that took the
/// delivery noticed, and it is asking head office what to do. The ordered price
/// is captured by the server when the request arrives rather than sent up by
/// the warehouse: the DC was never told what the order cost, so it could not
/// have quoted it. Both figures are stored, which is why this screen can show
/// the gap without reconstructing what the order said at the time.
///
/// Approving changes the order and tells the DC in one step. Rejecting changes
/// nothing about the order and is still recorded — a supplier who repeatedly
/// bills above the agreed price leaves a trail here and nowhere else.

const columns: ColumnDef<TableSetup, PriceAmendment>[] = [
  {
    accessorKey: "po_number",
    header: "PO",
    size: 130,
    meta: { filter: { kind: "text" } },
    cell: ({ row }) => (
      <span className="font-mono text-id text-body">
        {row.original.po_number}
      </span>
    ),
  },
  {
    accessorKey: "article_name",
    header: "Article",
    size: 260,
    meta: { filter: { kind: "text" } },
    cell: ({ row }) => (
      <span className="flex flex-col">
        <span className="font-medium text-ink">
          {row.original.article_name}
        </span>
        <span className="font-mono text-[0.875rem] text-mute">
          {row.original.article_code}
        </span>
      </span>
    ),
  },
  {
    accessorKey: "ordered_price_minor",
    header: "Agreed",
    size: 130,
    meta: {
      align: "right",
      filter: { kind: "number", unit: "Rp" },
    },
    cell: ({ row }) => money(row.original.ordered_price_minor),
  },
  {
    accessorKey: "invoiced_price_minor",
    header: "Invoiced",
    size: 130,
    meta: {
      align: "right",
      filter: { kind: "number", unit: "Rp" },
    },
    cell: ({ row }) => money(row.original.invoiced_price_minor),
  },
  {
    accessorKey: "difference_minor",
    header: "Difference",
    size: 140,
    meta: {
      align: "right",
      filter: { kind: "number", unit: "Rp" },
    },
    // The decision metric and the default sort: the supplier billing most above
    // what was agreed is the answer somebody should write first. A negative gap
    // is still a disagreement, and it sorts to the other end rather than out of
    // sight.
    cell: ({ row }) => {
      const gap = row.original.difference_minor
      return (
        <span
          className={
            gap > 0
              ? "font-medium text-bad-fg"
              : gap < 0
                ? "font-medium text-ok-fg"
                : "text-mute"
          }
        >
          {gap > 0 ? "+" : ""}
          {money(gap)}
        </span>
      )
    },
  },
  {
    accessorKey: "origin_id",
    header: "Raised at",
    size: 140,
    meta: { filter: { kind: "option" } },
    cell: ({ row }) => <Tag>{row.original.origin_id}</Tag>,
  },
  {
    accessorKey: "requested_at",
    header: "Asked",
    size: 150,
    meta: { filter: { kind: "date" } },
    cell: ({ row }) => moment(row.original.requested_at),
  },
]

export function PriceAmendments() {
  const amendment = useSheet("amendment")
  const [query, setQuery] = useState("")
  const [sorting, setSorting] = useState<SortingState>([
    { id: "difference_minor", desc: true },
  ])

  const amendments = useQuery({
    queryKey: procurementKeys.amendments(),
    queryFn: ({ signal }) => pendingPriceAmendments(signal),
  })

  const rows = useMemo(() => amendments.data ?? [], [amendments.data])
  const exposure = rows.reduce((sum, row) => sum + row.difference_minor, 0)
  const over = rows.filter((row) => row.difference_minor > 0).length

  const filters = useFilters(columns)

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns: filters.columns,
        getRowId: (row: PriceAmendment) => row.request_id,
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
        title="Price amendments"
        sub="Deliveries billed at a price the order does not carry, waiting on an answer."
        actions={
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="PO or article"
            className="h-8 w-48"
          />
        }
      />

      <KpiStrip className="grid-cols-2 md:grid-cols-3 xl:grid-cols-3">
        <Kpi label="Waiting on an answer" value={rows.length} />
        <Kpi label="Billed above the order" value={over} />
        <Kpi
          label="Net difference"
          value={money(exposure)}
          delta={exposure > 0 ? "Against us" : "In our favour"}
          tone={exposure > 0 ? "down" : "up"}
        />
      </KpiStrip>

      <Toolbar>
        <FilterPanel model={filters} table={table} />
      </Toolbar>

      <Card className="overflow-hidden">
        {queryState(amendments, {
          loading: "Reading the queue…",
          render: () =>
            rows.length === 0 ? (
              <EmptyState>
                {query === ""
                  ? "No delivery is waiting on a price decision."
                  : "No pending amendment matches that search."}
              </EmptyState>
            ) : (
              <DataTable<PriceAmendment>
                table={table}
                onRowClick={(row) => amendment.open(row.request_id)}
                isSelected={(row) => row.request_id === amendment.value}
                className="max-h-[calc(100vh-20rem)]"
              />
            ),
        })}
      </Card>

      <AmendmentSheet
        id={amendment.value ?? null}
        rows={rows}
        onClose={amendment.close}
      />
    </PageContent>
  )
}

/// One question, and the answer to it.
///
/// The record comes from the list rather than from its own read, which is the
/// one place this module departs from the pattern: the server offers
/// `GET /api/v1/purchase-price-amendments` and no route for a single request,
/// so a per-record fetch would be the same list filtered in a second round trip.
function AmendmentSheet({
  id,
  rows,
  onClose,
}: {
  id: string | null
  rows: readonly PriceAmendment[]
  onClose: () => void
}) {
  const client = useQueryClient()
  const actor = useActor()
  const [note, setNote] = useState("")

  const amendment = rows.find((row) => row.request_id === id)

  // The amendment names its order by NUMBER; crossing to the order needs its
  // id. The order book is already in the cache for most arrivals here, so the
  // join costs nothing and the link is not a dead end.
  const orders = useQuery({
    queryKey: procurementKeys.orders(),
    queryFn: ({ signal }) => listPurchaseOrders(undefined, signal),
    enabled: amendment !== undefined,
  })
  const order = orders.data?.find(
    (row) => row.po_number === amendment?.po_number
  )

  const decide = useMutation({
    mutationFn: (outcome: PriceAmendmentOutcome) =>
      decidePriceAmendment(
        amendment!.request_id,
        outcome,
        actor,
        note.trim() === "" ? null : note.trim()
      ),
    onSuccess: () => {
      // The queue loses a row either way. Approving also changes the order's
      // line price, so the order book and that one order go with it.
      void client.invalidateQueries({ queryKey: procurementKeys.amendments() })
      void client.invalidateQueries({ queryKey: procurementKeys.orders() })
      setNote("")
      onClose()
    },
  })

  return (
    <Sheet
      open={id !== null}
      subject={
        id === null ? undefined : { kind: "purchase_price_amendment", id }
      }
      onOpenChange={(open) => !open && onClose()}
      id={amendment?.po_number}
      title={amendment?.article_name ?? "Price query"}
      actions={
        order && (
          <LinkButton
            to="/procurement/orders"
            sheet={{ key: "order", value: order.purchase_order_id }}
          >
            The order
          </LinkButton>
        )
      }
      footer={
        amendment && (
          <div className="flex gap-2">
            <Button
              variant="danger"
              className="flex-1"
              disabled={actor === "" || decide.isPending}
              onClick={() => decide.mutate("Rejected")}
            >
              Reject
            </Button>
            <Button
              variant="primary"
              className="flex-1"
              disabled={actor === "" || decide.isPending}
              onClick={() => decide.mutate("Approved")}
            >
              Approve the invoice
            </Button>
          </div>
        )
      }
    >
      {amendment === undefined ? (
        <EmptyState>
          That query has already been answered, or it was never in this queue.
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-5">
          {decide.isError && (
            <Banner tone="bad">{(decide.error as Error).message}</Banner>
          )}

          <Banner tone="warn">
            Approving changes the order's price to what the invoice said and
            tells the warehouse in one step. Rejecting leaves the order alone —
            the delivery may still be accepted, and the disagreement stays on
            record against the supplier.
          </Banner>

          <Facts>
            <Fact term="Article">{amendment.article_code}</Fact>
            <Fact term="Raised at">{amendment.origin_id}</Fact>
            <Fact term="Raised by">{amendment.requested_by}</Fact>
            <Fact term="Asked">{moment(amendment.requested_at)}</Fact>
          </Facts>

          <div>
            <h4 className="mb-2 text-card-title font-semibold text-ink">
              What the warehouse read
            </h4>
            <p className="rounded-inner bg-soft px-3.5 py-2.5 text-[0.875rem] text-body">
              {amendment.note}
            </p>
          </div>

          <div>
            <MiniTable head={["Price", "Per unit"]}>
              <tr className="border-t border-hairline">
                <td className="py-2 text-[0.875rem] text-ink">
                  Agreed on the order
                </td>
                <td className="py-2 text-right tabular-nums">
                  {money(amendment.ordered_price_minor)}
                </td>
              </tr>
              <tr className="border-t border-hairline">
                <td className="py-2 text-[0.875rem] text-ink">
                  Invoiced by the supplier
                </td>
                <td className="py-2 text-right tabular-nums">
                  {money(amendment.invoiced_price_minor)}
                </td>
              </tr>
            </MiniTable>
            <TotalsLadder
              className="mt-3"
              rows={[]}
              total={{
                label:
                  amendment.difference_minor > 0
                    ? "Billed above the order"
                    : "Billed below the order",
                value: money(Math.abs(amendment.difference_minor)),
              }}
            />
          </div>

          <div>
            <h4 className="mb-2 text-card-title font-semibold text-ink">
              Note on the decision
            </h4>
            <Textarea
              rows={3}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Optional. It travels back to the warehouse with the answer."
            />
          </div>
        </div>
      )}
    </Sheet>
  )
}
