/* An order's own sheet (purchase-orders.tsx:2137-2541): the number, the
   supplier, who made it, the facts, the items, and the footer whose buttons
   are what can still be done to it — Cancel only while nothing has been
   received, billed or paid ahead. */
import { ItemsTable, KEMEJA_LINE } from "./Composer"
import { Button, Sheet } from "./kit"

export function PoSheet({
  po,
  supplier,
  cancel,
  tooltip,
  x = 0,
  opacity = 1,
}: {
  po: string
  supplier: string
  cancel?: { pressed?: number; hover?: boolean; disabled?: boolean }
  /** The dark tip over a disabled Cancel. */
  tooltip?: number
  x?: number
  opacity?: number
}) {
  return (
    <Sheet
      width={928}
      mono={po}
      title={supplier}
      x={x}
      opacity={opacity}
      footer={
        <div className="relative flex items-center justify-end gap-3">
          {tooltip ? (
            <span
              className="absolute right-[86px] bottom-12 rounded-inner bg-tooltip px-2.5 py-1.5 text-[0.875rem] text-white"
              style={{ opacity: tooltip }}
            >
              A count is waiting. Review it first.
            </span>
          ) : null}
          <Button
            variant="ghost"
            pressed={cancel?.pressed}
            hover={cancel?.hover}
            disabled={cancel?.disabled}
          >
            Cancel
          </Button>
          <Button variant="ghost">Edit</Button>
        </div>
      }
    >
      <div className="flex flex-col gap-6 px-7 pt-5">
        <div className="text-[0.9375rem] text-mute">Created by Rina Kusuma · 08 Oct 2026</div>
        <dl className="grid grid-cols-4 gap-6">
          {[
            ["Delivery Date", "15 Oct 2026"],
            ["Payment Method", "Transfer"],
            ["Ordered", "600 pcs"],
            ["Received", "0 pcs"],
          ].map(([term, value]) => (
            <div key={term}>
              <dt className="text-[0.875rem] text-body">{term}</dt>
              <dd className="mt-1 text-[0.9375rem] text-ink tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
        <ItemsTable lines={[KEMEJA_LINE]} />
      </div>
    </Sheet>
  )
}
