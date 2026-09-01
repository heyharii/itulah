import { AppShell, ScreenHeader, ScreenState } from "@/components/app-shell"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/custom/table"
import { Tag } from "@/components/sourcing/columns"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useIdentity } from "@/lib/identity"
import { money, units } from "@/lib/money"
import { closePurchaseLineShort, purchaseOrderDetail } from "@/lib/purchase-orders"
import { ApiError } from "@itulah/contract/client"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ArrowLeft } from "lucide-react"
import { useState } from "react"
import { OrderStatus } from "./columns"

/// One order, and what has actually arrived against it.
///
/// Two money columns, deliberately. `Ordered` is what was committed to;
/// `Payable` is what the deliveries earned, derived from receipts. A line that
/// arrived short has to show both, because settling at the ordered value would
/// pay a supplier for goods that never came.
export function OrderDetail({
  nav,
  purchaseOrderId,
  onBack,
}: {
  nav: React.ReactNode
  purchaseOrderId: string
  onBack: () => void
}) {
  const queryClient = useQueryClient()
  const identity = useIdentity()
  const order = useQuery({
    queryKey: ["purchase-orders", purchaseOrderId],
    queryFn: ({ signal }) => purchaseOrderDetail(purchaseOrderId, signal),
  })

  // Which line the buyer is closing, and why. One at a time on purpose: this
  // is the decision that stops a line waiting forever, and it should read like
  // a decision rather than a row of buttons.
  const [closing, setClosing] = useState<string | null>(null)
  const [reason, setReason] = useState("")

  const closeShort = useMutation({
    mutationFn: ({ poLineId, why }: { poLineId: string; why: string }) =>
      closePurchaseLineShort(poLineId, identity.data?.username ?? "", why),
    onSuccess: () => {
      setClosing(null)
      setReason("")
      void queryClient.invalidateQueries({ queryKey: ["purchase-orders"] })
    },
  })

  const back = (
    <Button variant="ghost" size="sm" onClick={onBack}>
      <ArrowLeft className="size-3.5" />
      Orders
    </Button>
  )

  if (order.isPending) {
    return (
      <AppShell nav={nav}>
        <ScreenHeader title="Purchase order">{back}</ScreenHeader>
        <ScreenState>Loading the order…</ScreenState>
      </AppShell>
    )
  }

  if (order.isError) {
    return (
      <AppShell nav={nav}>
        <ScreenHeader title="Purchase order">{back}</ScreenHeader>
        <ScreenState
          tone="problem"
          action={
            <Button size="sm" variant="outline" onClick={() => void order.refetch()}>
              Try again
            </Button>
          }
        >
          {order.error instanceof ApiError
            ? order.error.message
            : "The order could not be loaded."}
        </ScreenState>
      </AppShell>
    )
  }

  const detail = order.data
  const ordered = detail.lines.reduce((sum, line) => sum + line.ordered_value_minor, 0)

  return (
    <AppShell nav={nav}>
      <ScreenHeader
        title={<span className="font-mono">{detail.po_number}</span>}
        subtitle={`${detail.supplier_name ?? detail.supplier_id} · ${detail.destination_site_id}`}
      >
        {back}
      </ScreenHeader>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b px-3.5 py-2.5">
        <OrderStatus status={detail.order_status} />
        <Figure label="Ordered">{money(ordered, detail.currency)}</Figure>
        <Figure label="Payable on receipts">{money(detail.payable_minor, detail.currency)}</Figure>
        <Figure label="Lines">{units(detail.lines.length)}</Figure>
        <Figure label="Raised by">{detail.created_by}</Figure>
        <Figure label="Issued">
          {detail.issued_at === null
            ? "—"
            : new Date(detail.issued_at).toLocaleString("id-ID")}
        </Figure>
        <span className="text-muted-foreground ml-auto text-[11px]">
          {detail.fully_received
            ? "Every line has arrived."
            : "Still waiting on at least one line."}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <Table>
          <TableHeader className="bg-muted/50">
            <TableRow className="hover:bg-transparent">
              <TableHead>Line</TableHead>
              <TableHead>Article</TableHead>
              <TableHead className="text-right">Ordered</TableHead>
              <TableHead className="text-right">Received</TableHead>
              <TableHead className="text-right">Outstanding</TableHead>
              <TableHead className="text-right">Unit</TableHead>
              <TableHead className="text-right">Payable</TableHead>
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {detail.lines.map((line) => (
              <TableRow key={line.po_line_id}>
                <TableCell className="text-muted-foreground font-mono text-[11px]">
                  {line.line_number}
                </TableCell>
                <TableCell>
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-medium">{line.article_name}</div>
                    <div className="text-muted-foreground truncate font-mono text-[10.5px]">
                      {line.article_code}
                      {line.division_code !== null && ` · ${line.division_code}`}
                    </div>
                    {line.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 pt-1">
                        {line.tags.map((tag) => (
                          <Tag key={tag}>{tag}</Tag>
                        ))}
                      </div>
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-right font-mono text-xs tabular-nums">
                  {units(line.expected_stock_units)}
                  {line.cancelled_quantity > 0 && (
                    <span className="text-muted-foreground block text-[10.5px]">
                      {units(line.cancelled_quantity)} cancelled
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-right font-mono text-xs tabular-nums">
                  {units(line.received_quantity)}
                </TableCell>
                <TableCell className="text-right font-mono text-xs tabular-nums">
                  {units(line.outstanding_stock_units)}
                  {line.closed_short_units !== null && (
                    <span className="block text-[10.5px] text-amber-600">
                      closed {units(line.closed_short_units)} short
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-right font-mono text-xs tabular-nums">
                  {money(line.unit_price_minor, detail.currency)}
                </TableCell>
                <TableCell className="text-right font-mono text-xs font-medium tabular-nums">
                  {money(line.payable_minor, detail.currency)}
                  {line.payable_minor !== line.ordered_value_minor && (
                    <span className="text-muted-foreground block text-[10.5px]">
                      of {money(line.ordered_value_minor, detail.currency)}
                    </span>
                  )}
                </TableCell>
                <TableCell>
                  <span className="text-xs">{line.line_status}</span>
                  {line.closed_short_reason !== null && (
                    <span className="text-muted-foreground block max-w-48 truncate text-[10.5px]">
                      {line.closed_short_reason}
                    </span>
                  )}
                </TableCell>
                <TableCell>
                  {/* Only a line still waiting can be closed short. A line that
                      arrived in full has nothing to stop waiting for, and one
                      already closed is refused by the server anyway. */}
                  {line.outstanding_stock_units > 0 && line.closed_short_units === null && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 whitespace-nowrap"
                      onClick={() => {
                        setClosing(line.po_line_id)
                        setReason("")
                      }}
                    >
                      Close short
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {detail.lines.map((line) =>
              closing !== line.po_line_id ? null : (
                <TableRow key={`${line.po_line_id}-closing`} className="hover:bg-transparent">
                  <TableCell colSpan={9} className="bg-muted/40">
                    <div className="flex flex-col gap-2 py-1">
                      <p className="text-[12px]">
                        Stop waiting for the remaining{" "}
                        <span className="font-mono font-medium">
                          {units(line.outstanding_stock_units)}
                        </span>{" "}
                        of <span className="font-medium">{line.article_name}</span>. The
                        shortfall stays on the record — settled is not the same as arrived —
                        and the supplier is paid only for what turned up.
                      </p>
                      <div className="flex flex-wrap items-center gap-2">
                        <Input
                          value={reason}
                          onChange={(event) => setReason(event.target.value)}
                          placeholder="Why is this line not being filled?"
                          aria-label="Reason for closing short"
                          className="h-8 min-w-64 flex-1 text-xs"
                        />
                        <Button
                          size="sm"
                          disabled={reason.trim() === "" || closeShort.isPending}
                          onClick={() =>
                            closeShort.mutate({
                              poLineId: line.po_line_id,
                              why: reason.trim(),
                            })
                          }
                        >
                          {closeShort.isPending ? "Closing…" : "Close this line short"}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setClosing(null)}>
                          Keep waiting
                        </Button>
                      </div>
                      {closeShort.isError && (
                        <p className="text-destructive text-[11.5px]">
                          {closeShort.error instanceof ApiError
                            ? closeShort.error.message
                            : "The line could not be closed."}
                        </p>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ),
            )}
          </TableBody>
        </Table>
      </div>
    </AppShell>
  )
}

function Figure({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span className="flex flex-col">
      <span className="text-muted-foreground text-[10.5px] tracking-wide uppercase">{label}</span>
      <span className="font-mono text-xs tabular-nums">{children}</span>
    </span>
  )
}
