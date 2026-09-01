import { SheetShell } from "@/components/sheets/sheet-shell"
import { OrderPanel } from "@/components/po/order-panel"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useOrderSheet } from "@/lib/sheets/po"
import { purchaseOrderDetail } from "@/lib/purchase-orders"
import { ApiError } from "@itulah/contract/client"
import { useQuery } from "@tanstack/react-query"

/// One purchase order, opened over the list it was found in.
///
/// This was `/orders/$purchaseOrderId`, and the route is now a redirect into
/// the parameter. Chasing a late delivery means opening six orders in a row,
/// and as a route each one threw away the filters and the sort that found them
/// — so the buyer rebuilt the same list six times. Here the list stays behind
/// it and ↑/↓ walk the rows without closing anything.
///
/// The fetch is here rather than in the panel because the header needs the
/// order number before the body has anything to draw, and asking twice for one
/// key to avoid a prop would be the worse trade.
export function OrderSheet({ rows }: { rows: readonly string[] }) {
  const sheet = useOrderSheet()
  const purchaseOrderId = sheet.purchaseOrderId
  const order = useQuery({
    queryKey: ["purchase-orders", purchaseOrderId],
    queryFn: ({ signal }) => purchaseOrderDetail(purchaseOrderId ?? "", signal),
    enabled: purchaseOrderId !== null,
  })
  const detail = order.data

  return (
    <SheetShell
      open={purchaseOrderId !== null}
      onClose={sheet.close}
      title={
        detail === undefined ? (
          <Skeleton className="h-4 w-28" />
        ) : (
          <span className="font-mono">{detail.po_number}</span>
        )
      }
      subtitle={
        detail === undefined
          ? undefined
          : `${detail.supplier_name ?? detail.supplier_id} · ${detail.destination_site_id}`
      }
      description="One purchase order, its lines, and what has arrived against each of them."
      rows={rows}
      current={purchaseOrderId}
      onMove={sheet.open}
      className="sm:max-w-4xl"
    >
      {order.isError ? (
        <div className="flex flex-col items-center gap-3 p-10 text-center">
          <p className="text-xs text-destructive">
            {order.error instanceof ApiError
              ? order.error.message
              : "The order could not be loaded."}
          </p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void order.refetch()}
          >
            Try again
          </Button>
        </div>
      ) : detail === undefined ? (
        <p className="p-10 text-center text-xs text-muted-foreground">
          Loading the order…
        </p>
      ) : (
        // Keyed by the order, so ↑ to the next one starts from a fresh sort
        // and a fresh close-short form rather than inheriting the last one's.
        <OrderPanel key={detail.purchase_order_id} detail={detail} />
      )}
    </SheetShell>
  )
}
