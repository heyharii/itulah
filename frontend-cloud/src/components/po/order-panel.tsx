import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/custom/table"
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header"
import { Tag } from "@/components/sourcing/columns"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useIdentity } from "@/lib/identity"
import { money, units } from "@/lib/money"
import type {
  PurchaseOrderDetail,
  PurchaseOrderLine,
} from "@/lib/purchase-orders"
import { closePurchaseLineShort } from "@/lib/purchase-orders"
import { dataTableFeatures } from "@/lib/table/features"
import { ApiError } from "@itulah/contract/client"
import { useForm } from "@tanstack/react-form"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { flexRender, useTable } from "@tanstack/react-table"
import { Fragment, useMemo, useState } from "react"
import { OrderStatus } from "./columns"

/// One order, and what has actually arrived against it.
///
/// Two money columns, deliberately. `Ordered` is what was committed to;
/// `Payable` is what the deliveries earned, derived from receipts. A line that
/// arrived short has to show both, because settling at the ordered value would
/// pay a supplier for goods that never came.
///
/// Given the order rather than fetching it: the sheet around this already asked
/// for it to put the number in its header, and a second `useQuery` here would
/// be the same key twice for the sake of a prop.
export function OrderPanel({ detail }: { detail: PurchaseOrderDetail }) {
  const queryClient = useQueryClient()
  const identity = useIdentity()

  // Which line the buyer is closing. One at a time on purpose: this is the
  // decision that stops a line waiting forever, and it should read like a
  // decision rather than a row of buttons. Which line is open is a state of the
  // screen; the words typed into it are the form below.
  const [closing, setClosing] = useState<string | null>(null)
  const [sorting, setSorting] = useState<SortingState>([])

  const closeShort = useMutation({
    mutationFn: ({ poLineId, why }: { poLineId: string; why: string }) =>
      closePurchaseLineShort(poLineId, identity.data?.username ?? "", why),
    onSuccess: () => {
      setClosing(null)
      form.reset()
      void queryClient.invalidateQueries({ queryKey: ["purchase-orders"] })
    },
  })

  const form = useForm({
    defaultValues: { reason: "" },
    onSubmit: ({ value }) => {
      if (closing === null) return
      closeShort.mutate({ poLineId: closing, why: value.reason.trim() })
    },
  })

  const currency = detail.currency
  const lines = useMemo<PurchaseOrderLine[]>(
    () => [...detail.lines],
    [detail.lines]
  )

  /// The lines as columns rather than as markup.
  ///
  /// Worth the ceremony here because these are the numbers a buyer argues with:
  /// nine columns, seven of them figures, and "which line is furthest from
  /// arriving" is a sort rather than a read. `line_number` is the order the
  /// supplier sees, so it is the default sort and never a surprise.
  const columns = useMemo<
    ColumnDef<typeof dataTableFeatures, PurchaseOrderLine>[]
  >(
    () => [
      {
        accessorKey: "line_number",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Line" />
        ),
        cell: ({ row }) => (
          <span className="font-mono text-[11px] text-muted-foreground">
            {row.original.line_number}
          </span>
        ),
      },
      {
        accessorKey: "article_name",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Article" />
        ),
        cell: ({ row }) => (
          <div className="min-w-0">
            <div className="truncate text-[13px] font-medium">
              {row.original.article_name}
            </div>
            <div className="truncate font-mono text-[10.5px] text-muted-foreground">
              {row.original.article_code}
              {row.original.division_code !== null &&
                ` · ${row.original.division_code}`}
            </div>
            {row.original.tags.length > 0 && (
              <div className="flex flex-wrap gap-1 pt-1">
                {row.original.tags.map((tag) => (
                  <Tag key={tag}>{tag}</Tag>
                ))}
              </div>
            )}
          </div>
        ),
      },
      {
        accessorKey: "expected_stock_units",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Ordered" align="end" />
        ),
        cell: ({ row }) => (
          <div className="text-right font-mono text-xs tabular-nums">
            {units(row.original.expected_stock_units)}
            {row.original.cancelled_quantity > 0 && (
              <span className="block text-[10.5px] text-muted-foreground">
                {units(row.original.cancelled_quantity)} cancelled
              </span>
            )}
          </div>
        ),
      },
      {
        accessorKey: "received_quantity",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Received" align="end" />
        ),
        cell: ({ row }) => (
          <div className="text-right font-mono text-xs tabular-nums">
            {units(row.original.received_quantity)}
          </div>
        ),
      },
      {
        accessorKey: "outstanding_stock_units",
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title="Outstanding"
            align="end"
          />
        ),
        cell: ({ row }) => (
          <div className="text-right font-mono text-xs tabular-nums">
            {units(row.original.outstanding_stock_units)}
            {row.original.closed_short_units !== null && (
              <span className="block text-[10.5px] text-[var(--os-warn,#b45309)]">
                closed {units(row.original.closed_short_units)} short
              </span>
            )}
          </div>
        ),
      },
      {
        accessorKey: "unit_price_minor",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Unit" align="end" />
        ),
        cell: ({ row }) => (
          <div className="text-right font-mono text-xs tabular-nums">
            {money(row.original.unit_price_minor, currency)}
          </div>
        ),
      },
      {
        accessorKey: "payable_minor",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Payable" align="end" />
        ),
        cell: ({ row }) => (
          <div className="text-right font-mono text-xs font-medium tabular-nums">
            {money(row.original.payable_minor, currency)}
            {/* Both numbers, whenever they disagree: settling at the ordered
                value would pay a supplier for goods that never came. */}
            {row.original.payable_minor !==
              row.original.ordered_value_minor && (
              <span className="block text-[10.5px] text-muted-foreground">
                of {money(row.original.ordered_value_minor, currency)}
              </span>
            )}
          </div>
        ),
      },
      {
        accessorKey: "line_status",
        header: "Status",
        cell: ({ row }) => (
          <>
            <span className="text-xs">{row.original.line_status}</span>
            {row.original.closed_short_reason !== null && (
              <span className="block max-w-48 truncate text-[10.5px] text-muted-foreground">
                {row.original.closed_short_reason}
              </span>
            )}
          </>
        ),
      },
      {
        id: "close",
        header: "",
        enableSorting: false,
        cell: ({ row }) =>
          // Only a line still waiting can be closed short. A line that arrived
          // in full has nothing to stop waiting for, and one already closed is
          // refused by the server anyway.
          row.original.outstanding_stock_units > 0 &&
          row.original.closed_short_units === null ? (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 whitespace-nowrap"
              onClick={() => {
                setClosing(row.original.po_line_id)
                form.reset()
              }}
            >
              Close short
            </Button>
          ) : null,
      },
    ],
    [currency, form]
  )

  const table = useTable(
    useMemo(
      () => ({
        features: dataTableFeatures,
        data: lines,
        columns,
        getRowId: (row: PurchaseOrderLine) => row.po_line_id,
        state: {
          sorting,
          // An order's lines are all of them, always: this screen is the whole
          // of one order and a second page of it would be a lie about the
          // total shown above.
          pagination: { pageIndex: 0, pageSize: Number.MAX_SAFE_INTEGER },
        },
        onSortingChange: setSorting,
      }),
      [lines, columns, sorting]
    )
  )

  const ordered = detail.lines.reduce(
    (sum, line) => sum + line.ordered_value_minor,
    0
  )

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b px-3.5 py-2.5">
        <OrderStatus status={detail.order_status} />
        <Figure label="Ordered">{money(ordered, detail.currency)}</Figure>
        <Figure label="Payable on receipts">
          {money(detail.payable_minor, detail.currency)}
        </Figure>
        <Figure label="Lines">{units(detail.lines.length)}</Figure>
        <Figure label="Raised by">{detail.created_by}</Figure>
        <Figure label="Issued">
          {detail.issued_at === null
            ? "—"
            : new Date(detail.issued_at).toLocaleString("id-ID")}
        </Figure>
        <span className="ml-auto text-[11px] text-muted-foreground">
          {detail.fully_received
            ? "Every line has arrived."
            : "Still waiting on at least one line."}
        </span>
      </div>

      {/* Nine columns, seven of them figures. The sheet scrolls vertically on
          its own, so this only has to give the table room to be wider than the
          panel rather than force the whole page sideways. */}
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className="hover:bg-transparent">
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext()
                        )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.map((row) => (
              <Fragment key={row.id}>
                <TableRow>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext()
                      )}
                    </TableCell>
                  ))}
                </TableRow>
                {/* Under the line it is about, rather than at the foot of the
                    table: the buyer is answering for this line, and a form
                    that has drifted away from its row is a form filled in
                    against the wrong one. */}
                {closing === row.original.po_line_id && (
                  <TableRow className="hover:bg-transparent">
                    <TableCell
                      colSpan={row.getVisibleCells().length}
                      className="bg-muted/40"
                    >
                      <div className="flex flex-col gap-2 py-1">
                        <p className="text-[12px]">
                          Stop waiting for the remaining{" "}
                          <span className="font-mono font-medium">
                            {units(row.original.outstanding_stock_units)}
                          </span>{" "}
                          of{" "}
                          <span className="font-medium">
                            {row.original.article_name}
                          </span>
                          . The shortfall stays on the record — settled is not
                          the same as arrived — and the supplier is paid only
                          for what turned up.
                        </p>
                        <div className="flex flex-wrap items-center gap-2">
                          <form.Field name="reason">
                            {(field) => (
                              <Input
                                value={field.state.value}
                                onBlur={field.handleBlur}
                                onChange={(event) =>
                                  field.handleChange(event.target.value)
                                }
                                placeholder="Why is this line not being filled?"
                                aria-label="Reason for closing short"
                                className="h-8 min-w-64 flex-1 text-xs"
                              />
                            )}
                          </form.Field>
                          <form.Subscribe
                            selector={(state) => state.values.reason.trim()}
                          >
                            {(reason) => (
                              <Button
                                size="sm"
                                disabled={reason === "" || closeShort.isPending}
                                onClick={() => void form.handleSubmit()}
                              >
                                {closeShort.isPending
                                  ? "Closing…"
                                  : "Close this line short"}
                              </Button>
                            )}
                          </form.Subscribe>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setClosing(null)}
                          >
                            Keep waiting
                          </Button>
                        </div>
                        {closeShort.isError && (
                          <p className="text-[11.5px] text-destructive">
                            {closeShort.error instanceof ApiError
                              ? closeShort.error.message
                              : "The line could not be closed."}
                          </p>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  )
}

function Figure({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <span className="flex flex-col">
      <span className="text-[10.5px] tracking-wide text-muted-foreground uppercase">
        {label}
      </span>
      <span className="font-mono text-xs tabular-nums">{children}</span>
    </span>
  )
}
