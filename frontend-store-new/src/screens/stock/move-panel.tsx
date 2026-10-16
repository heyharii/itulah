import { ArrowRight } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Banner } from "@/components/ui/states"
import { cn } from "@/lib/utils"
import type { StockMove } from "@/screens/stock/move-stock"
import { PoolDot } from "@/screens/stock/stock-table"
import { placeLabel } from "@/screens/stock/shared"

/// What has been added to the move so far, one line per SKU with one Submit.
/// Beside the table on a desk; on a phone a sheet over the foot of the page,
/// above the dock, so the thumb that typed the quantities is next to Submit.
export function MovePanel({
  move,
  nameOf,
}: {
  move: StockMove
  nameOf: (sku: string) => string
}) {
  const { from, to, lines, pieces, pending, failure } = move
  return (
    <aside
      className={cn(
        "flex max-h-[min(34rem,calc(100vh-8rem))] flex-col rounded-card border border-hairline bg-canvas p-4 shadow-float",
        // Over the page's foot on a phone, a column of its own from 56rem up.
        "max-@4xl/page:fixed max-@4xl/page:inset-x-0 max-@4xl/page:bottom-[calc(8rem+env(safe-area-inset-bottom,0px))] max-@4xl/page:z-30 max-@4xl/page:max-h-[50vh] max-@4xl/page:rounded-b-none max-@4xl/page:border-x-0 max-@4xl/page:pb-3",
        "@4xl/page:sticky @4xl/page:top-0 @4xl/page:self-start",
      )}
    >
      <div className="flex items-center gap-2">
        <h2 className="mr-auto text-[0.9375rem] font-semibold text-ink">
          Move stock
        </h2>
        <Button variant="quiet" size="sm" onClick={move.cancel}>
          Cancel
        </Button>
      </div>

      <div
        className={cn(
          "my-2 flex items-center gap-2.5 rounded-inner px-3 py-2.5 text-[0.9375rem] font-semibold",
          to === "reject" ? "bg-warn-bg text-warn-fg" : "bg-accent-bg text-accent",
        )}
      >
        <PoolDot pool={from} />
        <ArrowRight className="size-4" />
        <PoolDot pool={to} />
        {placeLabel(from)} → {placeLabel(to)}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {lines.length === 0 ? (
          <p className="py-2 text-[0.9375rem] text-mute">Nothing added</p>
        ) : (
          lines.map((line) => (
            <div
              key={line.sku}
              className="flex justify-between gap-3 py-1.5 text-[0.9375rem] text-ink"
            >
              <span className="min-w-0 truncate">{nameOf(line.sku)}</span>
              <b className="font-semibold tabular-nums">{line.quantity}</b>
            </div>
          ))
        )}
      </div>

      {failure !== null && (
        <Banner tone="bad" className="mt-2">
          {failure}
        </Banner>
      )}

      <div className="mt-2 border-t border-hairline pt-3">
        <Button
          variant="primary"
          size="lg"
          block
          pending={pending}
          disabled={pieces === 0}
          onClick={() => void move.submit()}
        >
          {pending
            ? "Moving…"
            : pieces > 0
              ? `Submit · ${pieces} ${pieces === 1 ? "pc" : "pcs"}`
              : "Submit"}
        </Button>
      </div>
    </aside>
  )
}
