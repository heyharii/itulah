import { useForm } from "@tanstack/react-form"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Day } from "@/components/ui/day"
import { AppLink } from "@/components/ui/app-link"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Field, Input, Money } from "@/components/ui/field"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { MiniTable } from "@/components/ui/rows"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { EmptyState, LoadingState, Problem } from "@/components/ui/states"
import { ago, clock, count, label, money, toneFor } from "@/lib/format"
import { dc } from "@/lib/api"
import { keys } from "@/lib/operations/keys"
import { queryState } from "@/lib/query-state"
import { useEdgeActor } from "@/lib/edge-session"
import { useSheet } from "@/lib/sheets"
import { tableSetup, type TableSetup } from "@/lib/table"
import { idempotencyKey } from "@itulah/contract/client"
import type { GoodsReceiptView } from "@itulah/contract"

/// Deliveries on the bay — the first screen goods reach.
///
/// A delivery document is opened when the lorry arrives, *before* anything is
/// counted, and its number is minted at this DC — so this works with the
/// network down, which is the point of an edge node.
///
/// The columns are the checker's position, not the supplier's details. What
/// matters is how long a lorry has been standing on the bay, how much of it
/// has been counted, and whether the invoice that came in with it has been
/// written down. The supplier's id and the invoice total are one tap away.
const columns: ColumnDef<TableSetup, GoodsReceiptView>[] = [
  {
    accessorKey: "receipt_number",
    header: "Delivery",
    size: 150,
    cell: ({ row }) => (
      <span className="font-mono text-id text-ink">
        {row.original.receipt_number}
      </span>
    ),
  },
  {
    accessorKey: "supplier_id",
    header: "Supplier",
    size: 180,
    cell: ({ row }) => (
      <span className="font-medium text-ink">{row.original.supplier_id}</span>
    ),
  },
  {
    accessorKey: "status",
    header: "Status",
    size: 130,
    cell: ({ row }) => (
      <Pill tone={toneFor(row.original.status)}>
        {label(row.original.status)}
      </Pill>
    ),
  },
  {
    accessorKey: "counted_lines",
    header: "Counted",
    size: 100,
    meta: { align: "right" },
    cell: ({ row }) => count(row.original.counted_lines),
  },
  {
    accessorKey: "accepted_lines",
    header: "Accepted",
    size: 100,
    meta: { align: "right" },
    // Counted and accepted are two different people's work, and the gap
    // between them is the queue on the Verify screen.
    cell: ({ row }) => {
      const waiting = row.original.counted_lines - row.original.accepted_lines
      return (
        <span
          className={waiting > 0 ? "font-medium text-warn-fg" : "text-mute"}
        >
          {count(row.original.accepted_lines)}
        </span>
      )
    },
  },
  {
    id: "invoice",
    accessorFn: (row) => (row.invoice_number === null ? 1 : 0),
    header: "Invoice",
    size: 130,
    cell: ({ row }) =>
      row.original.invoice_number === null ? (
        <span className="text-mute">not recorded</span>
      ) : (
        <span className="font-mono text-id text-body">
          {row.original.invoice_number}
        </span>
      ),
  },
  {
    accessorKey: "arrived_at",
    header: "On the bay",
    size: 130,
    meta: { align: "right" },
    // The decision metric, and the default sort. A lorry that arrived four
    // hours ago and has three lines counted is the one somebody has to walk
    // over to.
    cell: ({ row }) => (
      <span className="text-body">{ago(row.original.arrived_at)}</span>
    ),
  },
]

export function Deliveries() {
  const receipt = useSheet("delivery")
  const [sorting, setSorting] = useState<SortingState>([
    { id: "arrived_at", desc: false },
  ])

  const receipts = useQuery({
    queryKey: keys.receipts(),
    queryFn: ({ signal }) => dc.goodsReceipts(signal),
  })

  const rows = useMemo(() => receipts.data ?? [], [receipts.data])

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns,
        getRowId: (row: GoodsReceiptView) => row.receipt_id,
        state: { sorting },
        onSortingChange: setSorting,
      }),
      [rows, sorting]
    )
  )

  const uncounted = rows.filter((row) => row.counted_lines === 0).length
  const noInvoice = rows.filter((row) => row.invoice_number === null).length

  return (
    <PageContent>
      <PageHeader
        crumb="Intake"
        title="Deliveries"
        sub="A document is opened when the lorry arrives. Nothing here is stock yet."
      />

      <KpiStrip className="grid-cols-2 xl:grid-cols-3">
        <Kpi label="On the bay" value={count(rows.length)} />
        <Kpi
          label="Nothing counted"
          value={count(uncounted)}
          delta={uncounted > 0 ? "needs a checker" : "all started"}
          tone={uncounted > 0 ? "down" : "flat"}
        />
        <Kpi
          label="No invoice yet"
          value={count(noInvoice)}
          delta="paper not written down"
        />
      </KpiStrip>

      <OpenDelivery />

      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>Open deliveries</CardTitle>
          <span className="text-[0.75rem] text-mute">
            oldest first — that is the one to walk over to
          </span>
        </CardHeader>
        {queryState(receipts, {
          loading: "Reading the bay…",
          render: () =>
            rows.length === 0 ? (
              <EmptyState>
                Nothing is open on the bay. Open a delivery above when a lorry
                arrives.
              </EmptyState>
            ) : (
              <DataTable<GoodsReceiptView>
                table={table}
                touch
                onRowClick={(row) => receipt.open(row.receipt_id)}
                isSelected={(row) => row.receipt_id === receipt.value}
                className="max-h-[calc(100vh-24rem)]"
              />
            ),
        })}
      </Card>

      <DeliverySheet id={receipt.value ?? null} onClose={receipt.close} />
    </PageContent>
  )
}

/// Opening a delivery: two facts, and the number is minted here.
///
/// Arrival is supplied rather than assumed, because a document opened the next
/// morning is still about yesterday's lorry — the server takes `null` to mean
/// "now", so an empty field is honest rather than wrong.
function OpenDelivery() {
  const actor = useEdgeActor()
  const client = useQueryClient()

  const open = useMutation({
    mutationFn: (value: { supplier: string; arrived: string }) =>
      dc.openGoodsReceipt({
        supplier_id: value.supplier.trim(),
        arrived_at:
          value.arrived.trim() === ""
            ? null
            : new Date(value.arrived).toISOString(),
        actor_id: actor,
        // Minted once, before the first attempt. A lorry on a bay with bad
        // wifi is exactly where a retried POST becomes two delivery documents
        // for one lorry — and the second one has no goods behind it.
        idempotency_key: idempotencyKey(),
      }),
    onSuccess: () => {
      form.reset()
      void client.invalidateQueries({ queryKey: keys.receipts() })
    },
  })

  const form = useForm({
    defaultValues: { supplier: "", arrived: "" },
    onSubmit: ({ value }) => {
      if (value.supplier.trim() === "") return
      open.mutate(value)
    },
  })

  return (
    <Card className="mb-[1.125rem] overflow-hidden">
      <CardHeader>
        <CardTitle>A lorry has arrived</CardTitle>
        <span className="text-[0.75rem] text-mute">
          the number is minted here, so this works with the network down
        </span>
      </CardHeader>
      <form
        className="flex flex-wrap items-end gap-3 border-t border-hairline px-4 py-3.5"
        onSubmit={(event) => {
          event.preventDefault()
          form.handleSubmit()
        }}
      >
        <form.Field name="supplier">
          {(field) => (
            <Field label="Supplier" className="min-w-[12rem] flex-1">
              <Input
                className="font-mono"
                value={field.state.value}
                placeholder="Supplier id"
                onChange={(event) => field.handleChange(event.target.value)}
              />
            </Field>
          )}
        </form.Field>
        <form.Field name="arrived">
          {(field) => (
            <Field
              label="Arrived"
              hint="Leave empty for now"
              className="min-w-[12rem] flex-1"
            >
              <Input
                type="datetime-local"
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value)}
              />
            </Field>
          )}
        </form.Field>
        <Button variant="dark" type="submit" disabled={open.isPending}>
          {open.isPending ? "Opening…" : "Open the delivery"}
        </Button>
      </form>
      <Problem error={open.error} className="mx-4 mb-3.5" />
    </Card>
  )
}

/// One delivery, and the supplier's invoice recorded against it.
///
/// The sheet fetches nothing of its own: `goods-receipts` has no detail route,
/// so the row IS the record and the extra work here is the invoice. The list
/// is already in the cache, so reading it back is honest — there is no second
/// answer to fetch.
function DeliverySheet({
  id,
  onClose,
}: {
  id: string | null
  onClose: () => void
}) {
  const actor = useEdgeActor()
  const client = useQueryClient()
  const receipts = useQuery({
    queryKey: keys.receipts(),
    queryFn: ({ signal }) => dc.goodsReceipts(signal),
  })
  const record = (receipts.data ?? []).find((row) => row.receipt_id === id)

  const invoice = useMutation({
    mutationFn: (value: {
      number: string
      date: string
      totalMinor: string
      ref: string
    }) =>
      dc.recordInvoice(id!, {
        receipt_id: id!,
        invoice_number: value.number.trim(),
        invoice_date:
          value.date.trim() === "" ? null : new Date(value.date).toISOString(),
        invoice_total_minor: Number(value.totalMinor),
        invoice_document_ref: value.ref.trim() === "" ? null : value.ref.trim(),
        actor_id: actor,
        // The invoice is money. Recording it twice against one delivery is a
        // second liability the supplier never issued.
        idempotency_key: idempotencyKey(),
      }),
    onSuccess: () => {
      form.reset()
      void client.invalidateQueries({ queryKey: keys.receipts() })
    },
  })

  const form = useForm({
    defaultValues: { number: "", date: "", totalMinor: "", ref: "" },
    onSubmit: ({ value }) => {
      if (value.number.trim() === "" || value.totalMinor.trim() === "") return
      invoice.mutate(value)
    },
  })

  return (
    <Sheet
      open={id !== null}
      onOpenChange={(open) => !open && onClose()}
      id={record?.receipt_number}
      title={record?.supplier_id ?? "Delivery"}
    >
      {record === undefined ? (
        // Two different nothings, and they are different sentences: the list
        // has not answered yet, or it answered and this record was not in it.
        receipts.isPending ? (
          <LoadingState>Reading the bay…</LoadingState>
        ) : (
          <EmptyState>
            That delivery is no longer on the bay — it has been closed, or this
            list has moved on.
          </EmptyState>
        )
      ) : (
        <div className="flex flex-col gap-5">
          <div>
            <Pill tone={toneFor(record.status)}>{label(record.status)}</Pill>
          </div>

          <Facts>
            <Fact term="Arrived">{clock(record.arrived_at)}</Fact>
            <Fact term="On the bay">{ago(record.arrived_at)}</Fact>
            <Fact term="Opened by">{record.opened_by}</Fact>
            <Fact term="Supplier">{record.supplier_id}</Fact>
            <Fact term="Lines counted">{count(record.counted_lines)}</Fact>
            <Fact term="Lines accepted">{count(record.accepted_lines)}</Fact>
          </Facts>

          {/* No dead ends: a delivery on the bay is something somebody has to
              go and count, and the two screens that do it are one tap away. */}
          <div className="flex flex-wrap gap-2">
            <AppLink
              to="/operations/intake/count"
              sheet={{ key: "receipt", value: id! }}
              variant="soft"
            >
              Count this delivery
            </AppLink>
            <AppLink to="/operations/intake/verify" variant="quiet">
              Verify queue
            </AppLink>
          </div>

          <div>
            <h4 className="mb-2 text-card-title font-semibold text-ink">
              Supplier's invoice
            </h4>
            {record.invoice_number === null ? (
              <>
                <p className="mb-3 text-[0.78125rem] text-body">
                  The system never sees that document. This number exists only
                  because a person looked at the paper that came in with the
                  goods.
                </p>
                <form
                  className="flex flex-col gap-3"
                  onSubmit={(event) => {
                    event.preventDefault()
                    form.handleSubmit()
                  }}
                >
                  <form.Field name="number">
                    {(field) => (
                      <Field label="Invoice number">
                        <Input
                          className="font-mono"
                          value={field.state.value}
                          onChange={(event) =>
                            field.handleChange(event.target.value)
                          }
                        />
                      </Field>
                    )}
                  </form.Field>
                  <form.Field name="totalMinor">
                    {(field) => (
                      <Field label="Invoice total" hint="In rupiah, as printed">
                        <Money
                          value={field.state.value}
                          onChange={field.handleChange}
                        />
                      </Field>
                    )}
                  </form.Field>
                  <form.Field name="date">
                    {(field) => (
                      <Field label="Invoice date">
                        <Day
                          value={field.state.value}
                          onChange={field.handleChange}
                        />
                      </Field>
                    )}
                  </form.Field>
                  <form.Field name="ref">
                    {(field) => (
                      <Field
                        label="Where the scan lives"
                        hint="A reference, not the file"
                      >
                        <Input
                          value={field.state.value}
                          onChange={(event) =>
                            field.handleChange(event.target.value)
                          }
                        />
                      </Field>
                    )}
                  </form.Field>
                  <Button
                    variant="dark"
                    type="submit"
                    disabled={invoice.isPending}
                  >
                    {invoice.isPending ? "Recording…" : "Record the invoice"}
                  </Button>
                  <Problem error={invoice.error} />
                </form>
              </>
            ) : (
              <MiniTable head={["Invoice", "Total"]}>
                <tr className="border-t border-hairline">
                  <td className="py-2 font-mono text-[0.71875rem] text-ink">
                    {record.invoice_number}
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {money(record.invoice_total_minor)}
                  </td>
                </tr>
              </MiniTable>
            )}
          </div>
        </div>
      )}
    </Sheet>
  )
}
