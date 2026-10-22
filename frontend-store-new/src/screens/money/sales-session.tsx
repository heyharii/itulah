import { Button } from "@/components/ui/button"
import { Pill } from "@/components/ui/pill"
import { Sheet } from "@/components/ui/sheet"
import { Banner, EmptyState } from "@/components/ui/states"
import {
  RECEIPT_DOCUMENTS,
  cashSalesOf,
  dayOf,
  droppedOf,
  dropsOf,
  receivedBy,
  stageOf,
  tenderTotal,
  toDropOf,
  usePeople,
  useReceiptDocuments,
  useSessionReceipts,
  type Session,
} from "@/lib/queries/sessions"
import { useReceipt } from "@/lib/till"
import { articleId, sku } from "@/lib/format"
import { dayTitle } from "@/screens/money/format"
import { FactBox, FactRow } from "@/screens/money/sales-facts"
import { clock, differenceWord, tenderWord } from "@/screens/money/sales-words"
import { money, units } from "@itulah/contract/money"

/// One cashier session, opened: what it took, what has gone to the safe, and
/// every receipt it rang. A receipt opens in a sheet of its own over this one.

/// The session's one badge: where it is.
export function StageBadge({ session }: { session: Session }) {
  const report = session.report
  const stage = stageOf(report)
  if (stage === "selling") return <Pill tone="info">Selling</Pill>
  if (stage === "undeclared") return <Pill tone="warn">Not declared</Pill>
  const difference = report.variance_minor ?? 0
  return (
    <Pill tone={difference === 0 ? "ok" : difference < 0 ? "bad" : "warn"}>
      {difference === 0
        ? "Even"
        : `${differenceWord(difference)} ${money(Math.abs(difference))}`}
    </Pill>
  )
}

export function SessionSheet({
  session,
  open,
  onClose,
  onOpenReceipt,
  onDrop,
  onCount,
}: {
  session: Session
  open: boolean
  onClose: () => void
  onOpenReceipt: (saleId: string) => void
  onDrop: () => void
  onCount: () => void
}) {
  const people = usePeople()
  const sales = useSessionReceipts(session.report)
  const report = session.report
  const stage = stageOf(report)
  const receipts = sales.data?.receipts ?? []
  const shown = receipts.slice(0, RECEIPT_DOCUMENTS)
  const { documents } = useReceiptDocuments(shown.map((one) => one.id))

  const cash = cashSalesOf(report)
  const card = tenderTotal(report, "CARD")
  const qris = tenderTotal(report, "QRIS")
  // Whatever else was paid: wallets, vouchers, employee balance.
  const others = report.non_cash_minor - card - qris
  const drops = dropsOf(report)

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      width="wide"
      id={`${dayTitle(dayOf(report))} · Session ${session.number}`}
      title={people.nameOf(report.opened_by)}
      badge={<StageBadge session={session} />}
      footer={
        stage === "selling" ? (
          <div className="flex justify-end">
            <Button variant="primary" onClick={onDrop}>
              Cash drop
            </Button>
          </div>
        ) : stage === "undeclared" ? (
          <div className="flex justify-end">
            <Button variant="primary" onClick={onCount}>
              Count
            </Button>
          </div>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-4">
        <FactBox>
          <FactRow
            label="Total sales"
            sub={`${units(report.sale_count)} ${report.sale_count === 1 ? "sale" : "sales"}`}
            big
          >
            {money(report.sales_total_minor)}
          </FactRow>
          <FactRow label="Cash">{money(cash)}</FactRow>
          <FactRow label="Card">{money(card)}</FactRow>
          <FactRow label="QRIS">{money(qris)}</FactRow>
          {others > 0 && <FactRow label="Other">{money(others)}</FactRow>}
          <FactRow label={report.terminal_label}>
            {clock(report.opened_at)} –{" "}
            {report.closed_at === null ? "now" : clock(report.closed_at)}
          </FactRow>
        </FactBox>

        {(drops.length > 0 || stage === "selling") && (
          <FactBox title="Cash drops" aside={money(droppedOf(report))}>
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
            {drops.length === 0 && (
              <FactRow label="No drop yet">{null}</FactRow>
            )}
            {stage === "selling" && (
              <FactRow label="To drop" sub="Cash sales not dropped yet" sum>
                {money(toDropOf(report))}
              </FactRow>
            )}
          </FactBox>
        )}

        <FactBox title="Receipts" aside={units(receipts.length)}>
          {sales.isPending ? (
            <p className="px-4 py-6 text-center text-meta text-mute">
              Reading the receipts…
            </p>
          ) : receipts.length === 0 ? (
            <EmptyState art={null}>No receipt in this session.</EmptyState>
          ) : (
            shown.map((receipt) => {
              const printed = documents[receipt.id]
              return (
                <button
                  key={receipt.id}
                  type="button"
                  onClick={() => onOpenReceipt(receipt.id)}
                  className="grid min-h-[3.5rem] w-full grid-cols-[3.25rem_minmax(0,1fr)_auto] items-center gap-x-3.5 border-t border-hairline px-4 py-1.5 text-left transition-colors duration-(--t-hover) first:border-t-0 hover:bg-soft focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent active:bg-soft md:grid-cols-[3.25rem_minmax(0,1fr)_minmax(0,24%)_8.75rem]"
                >
                  <span className="text-meta text-mute tabular-nums">
                    {clock(receipt.completed_at)}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-ink">
                      {printed === undefined ? (
                        `${units(receipt.units)} ${receipt.units === 1 ? "item" : "items"}`
                      ) : (
                        <span className="font-mono text-id">
                          {printed.receipt_no}
                        </span>
                      )}
                    </span>
                    {printed !== undefined && (
                      <span className="block truncate text-meta text-mute">
                        {printed.lines.map((line) => line.name).join(", ")}
                      </span>
                    )}
                  </span>
                  <span className="hidden truncate text-meta text-body md:block">
                    {printed === undefined
                      ? ""
                      : printed.tenders
                          .map((tender) => tenderWord(tender.method))
                          .join(" + ")}
                  </span>
                  <span className="text-right font-medium text-ink tabular-nums">
                    {money(receipt.total_minor)}
                  </span>
                </button>
              )
            })
          )}
        </FactBox>
        {(sales.data?.truncated === true ||
          receipts.length > RECEIPT_DOCUMENTS) && (
          <Banner tone="warn">
            Latest {units(Math.min(receipts.length, RECEIPT_DOCUMENTS))} of{" "}
            {units(receipts.length)} receipts.
          </Banner>
        )}
      </div>
    </Sheet>
  )
}

/// One receipt: what was bought, what it came to and how it was paid.
export function ReceiptSheet({
  saleId,
  open,
  onClose,
}: {
  saleId: string | null
  open: boolean
  onClose: () => void
}) {
  const people = usePeople()
  const receipt = useReceipt(saleId)
  const printed = receipt.data

  const items =
    printed?.lines.reduce((sum, line) => sum + line.quantity, 0) ?? 0
  const when = printed === undefined ? null : new Date(printed.completed_at)

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      width="wide"
      id={printed?.receipt_no}
      title={printed === undefined ? "Receipt" : money(printed.total_minor)}
      badge={
        printed?.stamp ? <Pill tone="warn">{printed.stamp}</Pill> : undefined
      }
    >
      {printed === undefined ? (
        <p className="py-10 text-center text-meta text-mute">
          {receipt.isError ? "This receipt could not be read." : "Reading…"}
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          <FactBox
            title={`${units(items)} ${items === 1 ? "item" : "items"}`}
            aside={
              when === null || Number.isNaN(when.getTime())
                ? undefined
                : `${clock(printed.completed_at)} · ${dayTitle(
                    printed.completed_at.slice(0, 10),
                  )}`
            }
          >
            {printed.lines.map((line, index) => {
              const was = line.base_unit_price_minor
              return (
                <FactRow
                  key={`${line.sku_code}-${index}`}
                  label={line.name}
                  sub={`${articleId(null, line.sku_code)} · ${sku(line.sku_code)} · ${units(line.quantity)} × ${money(line.unit_price_minor)}${
                    was !== null && was !== line.unit_price_minor
                      ? ` · was ${money(was)}`
                      : ""
                  }`}
                >
                  {money(line.line_total_minor)}
                </FactRow>
              )
            })}
          </FactBox>

          <FactBox>
            {printed.discount_minor > 0 && (
              <>
                <FactRow label="Before discount">
                  {money(printed.subtotal_minor)}
                </FactRow>
                <FactRow label="Discount" tone="text-ok-fg">
                  −{money(printed.discount_minor)}
                </FactRow>
              </>
            )}
            <FactRow label="Total" big>
              {money(printed.total_minor)}
            </FactRow>
            {printed.tenders.map((tender, index) => {
              const cash = tender.method === "CASH"
              const change = cash ? printed.change_minor : 0
              return (
                <FactRow
                  key={`${tender.method}-${index}`}
                  label={tenderWord(tender.method)}
                  sub={
                    cash && change > 0
                      ? `Given ${money(tender.amount_minor)} · change ${money(change)}`
                      : (tender.reference ?? undefined)
                  }
                >
                  {money(tender.amount_minor - change)}
                </FactRow>
              )
            })}
          </FactBox>

          <FactBox>
            <FactRow label="Cashier">{people.nameOf(printed.cashier)}</FactRow>
          </FactBox>
        </div>
      )}
    </Sheet>
  )
}
