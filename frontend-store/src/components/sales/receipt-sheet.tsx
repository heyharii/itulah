import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { money, units } from "@itulah/contract/money"
import { previousWindow } from "@itulah/contract/reporting"
import type { StoreReceipt, StoreSalesWindow } from "@/lib/sales"
import { storeWindow, storeWindowKey } from "@/lib/sales"
import { Delta } from "@/components/sales/delta"
import { ApiError } from "@itulah/contract/client"
import { useQuery } from "@tanstack/react-query"

/// One span of this shop's trade, down to the receipts.
///
/// Thinner than the centre's version of this panel, and the reasons are in
/// `backend/src/edge/reports.rs`: there is no tender breakdown because the
/// till is cash-only, no tax line because the edge row has no net/tax, and no
/// returns because the edge cannot hold a sale in any state but COMPLETED.
/// Showing empty sections for those would read as "nothing happened" rather
/// than "this node does not record it".
export function ReceiptSheet({
  scope,
  onClose,
}: {
  scope: { from: string; to: string; title: string } | null
  onClose: () => void
}) {
  return (
    <Sheet open={scope !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="flex flex-col gap-0 p-0 sm:max-w-lg">
        {scope !== null && <Panel scope={scope} />}
      </SheetContent>
    </Sheet>
  )
}

function Panel({ scope }: { scope: { from: string; to: string; title: string } }) {
  const report = useQuery({
    queryKey: storeWindowKey(scope),
    queryFn: ({ signal }) => storeWindow(scope, signal),
  })
  // The span of equal length immediately before, so the figures can say which
  // way they are moving. Always the preceding one here rather than whatever
  // the screen behind is comparing against: this panel is opened on one cell,
  // and "the day before" is the question somebody asks of a day.
  const beforeScope = previousWindow(scope.from, scope.to)
  const before = useQuery({
    queryKey: storeWindowKey(beforeScope),
    queryFn: ({ signal }) => storeWindow(beforeScope, signal),
  })

  return (
    <>
      <SheetHeader className="shrink-0 gap-0.5 border-b p-4">
        <SheetTitle className="text-base">{scope.title}</SheetTitle>
        <SheetDescription className="font-mono text-xs">
          {scope.from === scope.to ? scope.from : `${scope.from} → ${scope.to}`}
        </SheetDescription>
      </SheetHeader>

      {report.isPending ? (
        <p className="text-muted-foreground p-8 text-center text-sm">
          Adding up the till…
        </p>
      ) : report.isError ? (
        <div className="flex flex-col items-center gap-3 p-8 text-center">
          <p className="text-destructive text-sm">
            {report.error instanceof ApiError
              ? report.error.message
              : "The sales figures could not be read."}
          </p>
          <Button variant="outline" onClick={() => void report.refetch()}>
            Try again
          </Button>
        </div>
      ) : (
        <Report report={report.data} before={before.data} against={beforeScope} />
      )}
    </>
  )
}

function Report({
  report,
  before,
  against,
}: {
  report: StoreSalesWindow
  before?: StoreSalesWindow
  against: { from: string; to: string }
}) {
  const label = against.from === against.to ? against.from : `${against.from} → ${against.to}`
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="grid grid-cols-2 gap-px border-b bg-border">
        <Stat
          label="Sales"
          value={units(report.sales.count)}
          now={report.sales.count}
          before={before?.sales.count}
          against={label}
        />
        <Stat
          label="Average sale"
          value={money(report.sales.average_minor)}
          now={report.sales.average_minor}
          before={before?.sales.average_minor}
          against={label}
        />
        <Stat
          label="Revenue"
          value={money(report.sales.gross_minor)}
          now={report.sales.gross_minor}
          before={before?.sales.gross_minor}
          against={label}
        />
        <Stat
          label="Units"
          value={units(report.sales.units_sold)}
          now={report.sales.units_sold}
          before={before?.sales.units_sold}
          against={label}
        />
      </div>

      <section className="border-b px-4 py-3">
        <h3 className="text-muted-foreground mb-2 text-xs font-medium tracking-wide uppercase">
          Cash drawer
        </h3>
        <dl className="grid gap-1.5 text-sm">
          <Line label="Cash taken" value={money(report.sales.paid_minor)} />
          <Line label="Change given" value={money(report.sales.change_minor)} />
          <Line
            label="Expected in drawer"
            value={money(report.cash_expected_minor)}
            strong
          />
        </dl>
        {/* Said rather than left to be discovered. The till takes cash and
            only cash — there is no `sale_payment` table on this node — so
            "expected in drawer" is the whole of the day's money, not one
            tender among several. */}
        <p className="text-muted-foreground mt-2 text-xs">
          This till takes cash only, so this is all of it.
        </p>
      </section>

      <section className="px-4 py-3">
        <h3 className="text-muted-foreground mb-2 text-xs font-medium tracking-wide uppercase">
          Receipts
          {report.receipts_truncated ? ` (newest ${report.receipts_limit})` : ""}
        </h3>
        {report.receipts.length === 0 ? (
          <p className="text-muted-foreground py-3 text-sm">
            Nothing was sold in this period.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-muted-foreground text-xs">
                <th scope="col" className="py-1 text-left font-medium">
                  Time
                </th>
                <th scope="col" className="py-1 text-right font-medium">
                  Units
                </th>
                <th scope="col" className="py-1 text-right font-medium">
                  Change
                </th>
                <th scope="col" className="py-1 text-right font-medium">
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {report.receipts.map((receipt) => (
                <Row key={receipt.id} receipt={receipt} />
              ))}
            </tbody>
          </table>
        )}
        {report.receipts_truncated && (
          <p className="text-muted-foreground mt-2 text-xs">
            {units(report.sales.count)} sales in this period; the newest{" "}
            {units(report.receipts_limit)} are listed. The totals above count all of
            them.
          </p>
        )}
      </section>
    </div>
  )
}

function Row({ receipt }: { receipt: StoreReceipt }) {
  const at = new Date(receipt.completed_at).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  })
  return (
    <tr className="hover:bg-muted/50 border-t transition-colors">
      <td className="text-muted-foreground py-1.5 whitespace-nowrap">{at}</td>
      <td className="py-1.5 text-right font-mono tabular-nums">{units(receipt.units)}</td>
      <td className="py-1.5 text-right font-mono tabular-nums">
        {receipt.change_minor === 0 ? (
          <span className="text-muted-foreground/50">–</span>
        ) : (
          money(receipt.change_minor)
        )}
      </td>
      <td className="py-1.5 text-right font-mono tabular-nums">
        {money(receipt.total_minor)}
      </td>
    </tr>
  )
}

function Stat({
  label,
  value,
  now,
  before,
  against,
}: {
  label: string
  value: string
  now: number
  before?: number
  against: string
}) {
  return (
    <div className="bg-card px-4 py-3">
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className="mt-0.5 font-mono text-base font-semibold tabular-nums">{value}</div>
      {before !== undefined && (
        <Delta now={now} before={before} against={against} className="mt-0.5 block" />
      )}
    </div>
  )
}

function Line({
  label,
  value,
  strong,
}: {
  label: string
  value: string
  strong?: boolean
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b pb-1 last:border-b-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={strong === true ? "font-mono font-semibold tabular-nums" : "font-mono tabular-nums"}>
        {value}
      </dd>
    </div>
  )
}
