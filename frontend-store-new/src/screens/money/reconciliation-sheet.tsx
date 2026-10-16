import { Banner } from "@/components/ui/states"
import { ListTable, type ListColumn } from "@/components/ui/list-table"
import { Sheet } from "@/components/ui/sheet"
import {
  RECEIPT_DOCUMENTS,
  cashSalesOf,
  dayOf,
  droppedOf,
  dropsOf,
  receivedBy,
  stageOf,
  tenderTotal,
  usePeople,
  useReceiptDocuments,
  useSessionReceipts,
  type Session,
} from "@/lib/queries/sessions"
import { dayTitle, signed } from "@/screens/money/format"
import { TwoLine } from "@/screens/money/parts"
import { FactBox, FactRow, FigureStrip } from "@/screens/money/sales-facts"
import { StageBadge } from "@/screens/money/sales-session"
import {
  TENDER_ORDER,
  clock,
  differenceTone,
  tenderWord,
} from "@/screens/money/sales-words"
import { money, units } from "@itulah/contract/money"

/// One session, reconciled: what the drawer took tender by tender, and — for
/// cash — where it went.
///
/// A tab per form of payment the session took (cash is always there), each
/// with the payments behind its figure. Cash reads against the drawer: every
/// drop, the cashier's count at the end, what stays as the float, and so what
/// the session handed over against what it sold. Card, QRIS and the rest are
/// read-only here: an acquirer settles them days later, somewhere this node
/// cannot see, so there is no tick that says they arrived.

/// One payment of one receipt.
interface Payment {
  readonly key: string
  readonly saleId: string
  readonly at: string
  readonly no: string
  readonly items: string
  readonly reference: string | null
  readonly amount: number
}

const plain = new Intl.NumberFormat("id-ID")

export function ReconSheet({
  session,
  open,
  onClose,
  onOpenReceipt,
}: {
  session: Session
  open: boolean
  onClose: () => void
  onOpenReceipt: (saleId: string) => void
}) {
  const people = usePeople()
  const sales = useSessionReceipts(session.report)
  const report = session.report
  const receipts = sales.data?.receipts ?? []
  const shown = receipts.slice(0, RECEIPT_DOCUMENTS)
  const { documents, pending } = useReceiptDocuments(shown.map((one) => one.id))

  const tenders = TENDER_ORDER.filter(
    (method) =>
      method === "CASH" || report.tenders.some((one) => one.method === method),
  )
  const amountOf = (method: string) =>
    method === "CASH" ? cashSalesOf(report) : tenderTotal(report, method)
  const countOf = (method: string) =>
    report.tenders.find((one) => one.method === method)?.count ?? 0

  /// The payments of one tender, earliest first — a statement is read down.
  const paymentsOf = (method: string): Payment[] =>
    [...shown].reverse().flatMap((receipt) => {
      const printed = documents[receipt.id]
      if (printed === undefined) return []
      // The cash tender is what was handed over; the change went back out.
      const change = method === "CASH" ? printed.change_minor : 0
      return printed.tenders.flatMap((tender, index) =>
        tender.method !== method
          ? []
          : [
              {
                key: `${receipt.id}-${index}`,
                saleId: receipt.id,
                at: printed.completed_at,
                no: printed.receipt_no,
                items: printed.lines.map((line) => line.name).join(", "),
                reference: tender.reference,
                amount: tender.amount_minor - change,
              },
            ],
      )
    })

  const strip = (
    <FigureStrip
      items={[
        { label: "Total sales", value: money(report.sales_total_minor) },
        ...tenders.map((method) => ({
          label: tenderWord(method),
          value: money(amountOf(method)),
        })),
      ]}
    />
  )

  const panel = (method: string) => {
    const rows = paymentsOf(method)
    const table = (
      <Payments
        rows={rows}
        approval={method !== "CASH"}
        loading={sales.isPending || pending}
        total={rows.reduce((sum, one) => sum + one.amount, 0)}
        onOpen={onOpenReceipt}
      />
    )
    return (
      <div className="flex flex-col gap-5">
        {strip}
        {method === "CASH" ? (
          <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_21.5rem]">
            {table}
            <div className="flex flex-col gap-4">
              <Drawer session={session} />
              <Setoran session={session} />
              <Declared session={session} />
            </div>
          </div>
        ) : (
          table
        )}
        {(sales.data?.truncated === true ||
          receipts.length > RECEIPT_DOCUMENTS) && (
          <Banner tone="warn">
            Latest {units(Math.min(receipts.length, RECEIPT_DOCUMENTS))} of{" "}
            {units(receipts.length)} receipts.
          </Banner>
        )}
      </div>
    )
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      width="wide"
      id={`${dayTitle(dayOf(report))} · Session ${session.number} · ${report.terminal_label}`}
      title={people.nameOf(report.opened_by)}
      badge={<StageBadge session={session} />}
      tabs={tenders.map((method) => ({
        value: method,
        label: (
          <>
            {tenderWord(method)}
            <span className="rounded-full bg-soft-2 px-1.5 text-meta leading-[1.125rem] font-semibold text-body tabular-nums">
              {countOf(method)}
            </span>
          </>
        ),
        content: panel(method),
      }))}
    />
  )
}

/// The payments of one tender, as the hub's table on a desk and cards on a
/// phone, closing on their sum.
function Payments({
  rows,
  approval,
  loading,
  total,
  onOpen,
}: {
  rows: readonly Payment[]
  approval: boolean
  loading: boolean
  total: number
  onOpen: (saleId: string) => void
}) {
  const columns: ListColumn<Payment>[] = [
    {
      id: "time",
      header: "Time",
      className: "w-20 tabular-nums",
      card: "meta",
      cell: (one) => clock(one.at),
    },
    {
      id: "receipt",
      header: "Receipt",
      className: "min-w-[12rem]",
      card: "title",
      cell: (one) => (
        <TwoLine
          top={<span className="font-mono text-id">{one.no}</span>}
          under={one.items}
        />
      ),
    },
    ...(approval
      ? [
          {
            id: "approval",
            header: "Approval",
            card: "meta",
            className: "font-mono",
            cell: (one) =>
              one.reference === null || one.reference === "" ? (
                <span className="text-faint">—</span>
              ) : (
                one.reference
              ),
          } satisfies ListColumn<Payment>,
        ]
      : []),
    {
      id: "amount",
      header: "Amount",
      align: "right",
      card: "status",
      className: "tabular-nums",
      cell: (one) => (
        <span className="font-medium text-ink">{money(one.amount)}</span>
      ),
    },
  ]
  return (
    <div className="min-w-0 overflow-hidden rounded-card border border-hairline bg-canvas">
      {loading && rows.length === 0 ? (
        <p className="px-4 py-8 text-center text-meta text-mute">
          Reading the payments…
        </p>
      ) : (
        <ListTable
          rows={rows}
          columns={columns}
          rowKey={(one) => one.key}
          onOpen={(one) => onOpen(one.saleId)}
          empty="No payment."
        />
      )}
      <FactRow label="Total" sum>
        {money(total)}
      </FactRow>
    </div>
  )
}

/// What the drawer should hold, and what its cashier said it held: the float,
/// the cash sold, what has gone out — to the safe or otherwise — and so what is
/// expected, beside the count.
function Drawer({ session }: { session: Session }) {
  const report = session.report
  const stage = stageOf(report)
  const declared = report.declared_cash_minor
  const dropped = droppedOf(report)
  // Cash taken out for something other than the safe.
  const paidOut = -report.movements
    .filter((one) => one.kind === "PAYOUT" || one.kind === "CORRECTION")
    .reduce((sum, one) => sum + one.amount_minor, 0)

  return (
    <FactBox title="Drawer">
      <FactRow label="Opening float">
        {money(report.opening_float_minor)}
      </FactRow>
      <FactRow label="Cash sales" sub="Net of the change given">
        {signed(cashSalesOf(report))}
      </FactRow>
      {report.cash_refunds_minor > 0 && (
        <FactRow label="Refunded in cash">
          {signed(-report.cash_refunds_minor)}
        </FactRow>
      )}
      {dropped > 0 && <FactRow label="Cash drops">{signed(-dropped)}</FactRow>}
      {paidOut !== 0 && <FactRow label="Paid out">{signed(-paidOut)}</FactRow>}
      <FactRow
        label="Expected"
        sub={stage === "selling" ? "So far" : "In the drawer at the end"}
        sum
      >
        {money(report.expected_cash_minor)}
      </FactRow>
      <FactRow
        label="Declared"
        sub={
          declared === null
            ? undefined
            : `Cashier · ${clock(report.counted_at ?? report.closed_at)}`
        }
      >
        {declared === null ? "—" : money(declared)}
      </FactRow>
    </FactBox>
  )
}

/// Cash, from the drawer to the safe: every drop, what the cashier counted at
/// the end and the float that stays, against what the drawer sold.
function Setoran({ session }: { session: Session }) {
  const report = session.report
  const stage = stageOf(report)
  const drops = dropsOf(report)
  const declared = report.declared_cash_minor
  const float = report.opening_float_minor
  // Cash taken out for something other than the safe.
  const paidOut = -report.movements
    .filter((one) => one.kind === "PAYOUT" || one.kind === "CORRECTION")
    .reduce((sum, one) => sum + one.amount_minor, 0)
  const handedOver =
    droppedOf(report) + (declared === null ? 0 : declared - float)
  const cashSales = cashSalesOf(report) - report.cash_refunds_minor
  const difference = report.variance_minor

  return (
    <FactBox
      title="Setoran"
      aside={units(drops.length + (declared === null ? 0 : 1))}
    >
      {drops.map((movement) => {
        const back = movement.kind === "PICKUP"
        return (
          <FactRow
            key={movement.id}
            label={back ? "Put back" : "Cash drop"}
            sub={`${clock(movement.occurred_at)} · ${
              receivedBy(movement) ?? movement.reason
            }`}
          >
            {back
              ? `−${money(Math.abs(movement.amount_minor))}`
              : money(Math.abs(movement.amount_minor))}
          </FactRow>
        )
      })}
      {declared === null ? (
        <FactRow
          label={stage === "selling" ? "Still selling" : "Not counted yet"}
        >
          {null}
        </FactRow>
      ) : (
        <>
          <FactRow
            label="Cash at the end"
            sub={`Declared · ${clock(report.counted_at ?? report.closed_at)}`}
          >
            {money(declared)}
          </FactRow>
          <FactRow label="Float stays" sub="Back to the cashier float">
            −{money(float)}
          </FactRow>
        </>
      )}
      <FactRow label="Total setoran" sum>
        {money(handedOver)}
      </FactRow>
      <FactRow label="Cash sales">{money(cashSales)}</FactRow>
      {paidOut !== 0 && <FactRow label="Paid out">−{money(paidOut)}</FactRow>}
      <FactRow
        label="Difference"
        big
        tone={difference === null ? undefined : differenceTone(difference)}
      >
        {difference === null ? "—" : signed(difference)}
      </FactRow>
    </FactBox>
  )
}

/// What the cashier counted at the end, note by note.
function Declared({ session }: { session: Session }) {
  const report = session.report
  if (report.counted.length === 0 || report.declared_cash_minor === null) {
    return null
  }
  return (
    <FactBox title="Declared by note" aside={money(report.declared_cash_minor)}>
      {report.counted.map((line) => (
        <FactRow
          key={line.value_minor}
          label={plain.format(line.value_minor)}
          sub={`× ${units(line.pieces)}`}
        >
          {money(line.value_minor * line.pieces)}
        </FactRow>
      ))}
    </FactBox>
  )
}
