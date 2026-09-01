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
import { storeTableFeatures, type StoreTableFeatures } from "@/lib/table"
import { ApiError } from "@itulah/contract/client"
import { useQuery } from "@tanstack/react-query"
import type { ColumnDef } from "@tanstack/react-table"
import { flexRender, useTable } from "@tanstack/react-table"
import { useMemo } from "react"

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
  // Derived from the tender list rather than from `paid_minor`, which is every
  // form of money added together. The node computes `cash_expected_minor` the
  // same way; this is only the figure it was computed from, shown.
  const cashTaken = report.tenders
    .filter((tender) => tender.method === "CASH")
    .reduce((sum, tender) => sum + tender.amount_minor, 0)
  const nonCash = report.sales.paid_minor - cashTaken
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
          How it was paid
        </h3>
        {/* The takings split by tender, because the two halves are chased in
            completely different ways: cash is counted at this counter tonight,
            a card settlement arrives from an acquirer days later. A single
            "takings" figure hides which of those a shortfall is. */}
        <dl className="grid gap-1.5 text-sm">
          {report.tenders.length === 0 ? (
            <p className="text-muted-foreground py-1 text-sm">
              Nothing was taken in this period.
            </p>
          ) : (
            report.tenders.map((tender) => (
              <Line
                key={tender.method}
                label={`${TENDER_LABELS[tender.method] ?? tender.method} · ${units(tender.count)}`}
                value={money(tender.amount_minor)}
              />
            ))
          )}
        </dl>
      </section>

      <section className="border-b px-4 py-3">
        <h3 className="text-muted-foreground mb-2 text-xs font-medium tracking-wide uppercase">
          Cash drawer
        </h3>
        <dl className="grid gap-1.5 text-sm">
          <Line label="Cash taken" value={money(cashTaken)} />
          <Line label="Change given" value={money(report.sales.change_minor)} />
          <Line
            label="Expected in drawer"
            value={money(report.cash_expected_minor)}
            strong
          />
        </dl>
        {/* Change always comes out of the drawer, whatever paid for the sale,
            which is why it is subtracted from cash rather than from the day's
            takings. The node refuses a card tender above the sale total for
            exactly that reason — there is no such thing as change from a card. */}
        {nonCash > 0 && (
          <p className="text-muted-foreground mt-2 text-xs">
            {money(nonCash)} was settled without cash and is not in this drawer.
          </p>
        )}
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
          <Receipts receipts={report.receipts} />
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

/// Every sale in the window, newest first, as the node listed them.
///
/// The time column is the only one that reads left; the rest are money and
/// counts, which are compared down the column and so line up on the right.
const RECEIPT_COLUMNS: ColumnDef<StoreTableFeatures, StoreReceipt>[] = [
  {
    id: "at",
    header: "Time",
    cell: ({ row }) => (
      <span className="text-muted-foreground whitespace-nowrap">
        {new Date(row.original.completed_at).toLocaleString("en-GB", {
          day: "numeric",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
        })}
      </span>
    ),
  },
  {
    id: "units",
    header: "Units",
    cell: ({ row }) => units(row.original.units),
  },
  {
    id: "change",
    header: "Change",
    // No change given reads as a dash rather than a zero: the eye should be
    // able to find the sales that opened the drawer for something.
    cell: ({ row }) =>
      row.original.change_minor === 0 ? (
        <span className="text-muted-foreground/50">–</span>
      ) : (
        money(row.original.change_minor)
      ),
  },
  {
    id: "total",
    header: "Total",
    cell: ({ row }) => money(row.original.total_minor),
  },
]

function Receipts({ receipts }: { receipts: readonly StoreReceipt[] }) {
  const table = useTable({
    features: storeTableFeatures,
    columns: RECEIPT_COLUMNS,
    data: useMemo(() => [...receipts], [receipts]),
    getRowId: (receipt: StoreReceipt) => receipt.id,
  })

  return (
    <table className="w-full text-sm">
      <thead>
        {table.getHeaderGroups().map((group) => (
          <tr key={group.id} className="text-muted-foreground text-xs">
            {group.headers.map((header) => (
              <th
                key={header.id}
                scope="col"
                className={
                  header.column.id === "at"
                    ? "py-1 text-left font-medium"
                    : "py-1 text-right font-medium"
                }
              >
                {header.isPlaceholder
                  ? null
                  : flexRender(
                      header.column.columnDef.header,
                      header.getContext(),
                    )}
              </th>
            ))}
          </tr>
        ))}
      </thead>
      <tbody>
        {table.getRowModel().rows.map((row) => (
          <tr key={row.id} className="hover:bg-muted/50 border-t transition-colors">
            {row.getAllCells().map((cell) => (
              <td
                key={cell.id}
                className={
                  cell.column.id === "at"
                    ? "py-1.5"
                    : "py-1.5 text-right font-mono tabular-nums"
                }
              >
                {flexRender(cell.column.columnDef.cell, cell.getContext())}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
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

/// The four the node's schema allows, spelled for a human.
///
/// Anything outside the list falls through to the code itself rather than to a
/// blank: a tender nobody named is still money, and hiding it would be the
/// worst of the options.
const TENDER_LABELS: Record<string, string> = {
  CASH: "Cash",
  CARD: "Card",
  QRIS: "QRIS",
  OTHER: "Other",
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
