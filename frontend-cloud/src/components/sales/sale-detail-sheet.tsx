import { ScreenState } from "@/components/app-shell"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { money, units } from "@/lib/money"
import type { PaymentMethod, SaleTransaction, SalesWindow } from "@/lib/sales"
import {
  PAYMENT_LABELS,
  PAYMENT_METHODS,
  salesWindow,
  salesWindowKey,
} from "@/lib/sales"
import { cn } from "@/lib/utils"
import { ApiError } from "@itulah/contract/client"
import { useQuery } from "@tanstack/react-query"

export interface SalesScope {
  readonly siteId: string
  readonly from: string
  readonly to: string
  /// What the reader clicked, said back to them — "Bandung · Week of 24 Aug"
  /// rather than a pair of dates they have to recognise.
  readonly title: string
}

/// One shop over one period, down to the receipts.
///
/// A sheet rather than a route because it is opened from a cell in a table
/// somebody has scrolled sideways to reach, and a route change would throw
/// that scroll position away along with the range and the granularity that got
/// them there.
export function SaleDetailSheet({
  scope,
  onClose,
}: {
  scope: SalesScope | null
  onClose: () => void
}) {
  return (
    <Sheet open={scope !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="flex flex-col gap-0 p-0 sm:max-w-xl">
        {scope !== null && <SalesPanel scope={scope} />}
      </SheetContent>
    </Sheet>
  )
}

function SalesPanel({ scope }: { scope: SalesScope }) {
  const report = useQuery({
    queryKey: salesWindowKey(scope),
    queryFn: ({ signal }) => salesWindow(scope, signal),
  })

  return (
    <>
      <SheetHeader className="shrink-0 gap-0.5 border-b p-4">
        <SheetTitle className="text-sm">{scope.title}</SheetTitle>
        <SheetDescription className="font-mono text-[11.5px]">
          {scope.from === scope.to ? scope.from : `${scope.from} → ${scope.to}`}
        </SheetDescription>
      </SheetHeader>

      {report.isPending ? (
        <ScreenState>Adding up the till…</ScreenState>
      ) : report.isError ? (
        <ScreenState
          tone="problem"
          action={
            <Button size="sm" variant="outline" onClick={() => void report.refetch()}>
              Try again
            </Button>
          }
        >
          {report.error instanceof ApiError
            ? report.error.message
            : "The takings could not be read."}
        </ScreenState>
      ) : (
        <SalesReport report={report.data} />
      )}
    </>
  )
}

function SalesReport({ report }: { report: SalesWindow }) {
  const tendered = new Map(report.tenders.map((tender) => [tender.method, tender]))
  const refunded = new Map(
    report.returns.by_method.map((refund) => [refund.method, refund.amount_minor]),
  )
  // Every method the schema knows, whether or not it was used. A missing row
  // and a zero row are different things — "no card sales all week" is
  // something a supervisor wants to see stated, not inferred from a gap.
  const methods = PAYMENT_METHODS.filter(
    (method) => tendered.has(method) || refunded.has(method),
  )
  const shown: readonly PaymentMethod[] = methods.length > 0 ? methods : PAYMENT_METHODS

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="grid grid-cols-2 gap-px border-b bg-border sm:grid-cols-4">
        <Stat label="Sales" value={units(report.sales.count)} />
        <Stat label="Average sale" value={money(report.sales.average_minor)} />
        <Stat label="Takings" value={money(report.sales.gross_minor)} />
        <Stat label="Units" value={units(report.sales.units_sold)} />
      </div>

      <Section title="Tenders">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-muted-foreground">
              <th scope="col" className="py-1 text-left font-medium">
                Method
              </th>
              <th scope="col" className="py-1 text-right font-medium">
                Sales
              </th>
              <th scope="col" className="py-1 text-right font-medium">
                Taken
              </th>
              <th scope="col" className="py-1 text-right font-medium">
                Refunded
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((method) => (
              <tr key={method} className="border-t">
                <td className="py-1.5">{PAYMENT_LABELS[method]}</td>
                <td className="py-1.5 text-right font-mono tabular-nums">
                  {units(tendered.get(method)?.count ?? 0)}
                </td>
                <td className="py-1.5 text-right font-mono tabular-nums">
                  {money(tendered.get(method)?.amount_minor ?? 0)}
                </td>
                <td className="py-1.5 text-right font-mono tabular-nums">
                  {refunded.get(method) === undefined ? (
                    <span className="text-muted-foreground/50">–</span>
                  ) : (
                    money(refunded.get(method) ?? 0)
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {/* Said out loud rather than left to be discovered. `sale_payment.method`
            is a four-value CHECK constraint, so the till never recorded which
            kind of card it was; a screen that split debit from credit would be
            inventing the difference. */}
        <p className="text-muted-foreground mt-2 text-[11px]">
          The till records one card method. Debit and credit are not told apart.
        </p>
      </Section>

      <Section title="Cash drawer">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
          <Line label="Cash tendered" value={money(report.cash.cash_tendered_minor)} />
          <Line label="Change given" value={money(report.cash.change_given_minor)} />
          <Line label="Cash refunded" value={money(report.cash.cash_refunded_minor)} />
          <Line
            label="Expected in drawer"
            value={money(report.cash.cash_expected_minor)}
            strong
          />
        </dl>
      </Section>

      {(report.returns.count > 0 || report.sales.voided_count > 0) && (
        <Section title="Not sales">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
            <Line label="Returns" value={units(report.returns.count)} />
            <Line label="Refunded" value={money(report.returns.refund_total_minor)} />
            <Line label="Voided sales" value={units(report.sales.voided_count)} />
          </dl>
          {/* Voided and returned money is deliberately not subtracted from the
              takings above: `gross_minor` is what completed sales rang up, and
              a refund happens on its own day. Netting them here would make two
              screens disagree about one shop. */}
          <p className="text-muted-foreground mt-2 text-[11px]">
            Refunds are not deducted from takings — a return is recorded on the day it
            happens, not the day the sale did.
          </p>
        </Section>
      )}

      <Section
        title={`Receipts${
          report.transactions_truncated ? ` (newest ${report.transactions_limit})` : ""
        }`}
      >
        {report.transactions.length === 0 ? (
          <p className="text-muted-foreground py-3 text-xs">
            Nothing was sold in this period.
          </p>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-muted-foreground">
                <th scope="col" className="py-1 text-left font-medium">
                  Receipt
                </th>
                <th scope="col" className="py-1 text-left font-medium">
                  Time
                </th>
                <th scope="col" className="py-1 text-right font-medium">
                  Units
                </th>
                <th scope="col" className="py-1 text-left font-medium">
                  Paid by
                </th>
                <th scope="col" className="py-1 text-right font-medium">
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {report.transactions.map((sale) => (
                <Receipt key={sale.id} sale={sale} />
              ))}
            </tbody>
          </table>
        )}
        {report.transactions_truncated && (
          <p className="text-muted-foreground mt-2 text-[11px]">
            {units(report.sales.count)} sales in this period; the newest{" "}
            {units(report.transactions_limit)} are listed. The totals above count all of
            them.
          </p>
        )}
      </Section>
    </div>
  )
}

function Receipt({ sale }: { sale: SaleTransaction }) {
  const at =
    sale.completed_at === null
      ? "—"
      : new Date(sale.completed_at).toLocaleString("en-GB", {
          day: "numeric",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
        })
  return (
    <tr className="hover:bg-muted/50 border-t transition-colors">
      <td className="py-1.5 font-mono">{sale.sale_number}</td>
      <td className="text-muted-foreground py-1.5 whitespace-nowrap">{at}</td>
      <td className="py-1.5 text-right font-mono tabular-nums">{units(sale.units)}</td>
      <td className="py-1.5">
        {sale.methods.length === 0
          ? "—"
          : sale.methods
              .map(
                (method) =>
                  PAYMENT_LABELS[method as PaymentMethod] ?? method.toLowerCase(),
              )
              .join(" + ")}
      </td>
      <td className="py-1.5 text-right font-mono tabular-nums">
        {money(sale.total_minor, sale.currency)}
      </td>
    </tr>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-card px-3.5 py-2.5">
      <div className="text-muted-foreground text-[11px]">{label}</div>
      <div className="mt-0.5 font-mono text-sm font-semibold tabular-nums">{value}</div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-b px-4 py-3">
      <h2 className="text-muted-foreground mb-1.5 text-[11px] font-medium tracking-wide uppercase">
        {title}
      </h2>
      {children}
    </section>
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
      <dd
        className={cn("font-mono tabular-nums", strong === true && "font-semibold")}
      >
        {value}
      </dd>
    </div>
  )
}
