import {
  CheckCircle2,
  Clock,
  RotateCw,
  ShieldAlert,
  Trash2,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { RecordCard } from "@/components/ui/card"
import { Pill } from "@/components/ui/pill"
import { KeyValue } from "@/components/ui/rows"
import { ActionBar, CardList, Screen, Section } from "@/components/ui/screen"
import { Banner, EmptyState } from "@/components/ui/states"
import { moment } from "@/lib/format"
import { useGo } from "@/lib/go"
import {
  dismissRefused,
  flush,
  refusedCount,
  retryRefused,
  unsentCount,
  useSaleQueue,
  type QueuedSale,
} from "@/lib/sale-queue"
import { money } from "@itulah/contract/money"

/// The outbox for money.
///
/// Worth a screen of its own rather than a diagnostics page. A till is built to
/// keep working when the line is down, which means a shop can trade all
/// afternoon with nothing leaving the building and no symptom anybody would
/// notice: the tags scan, the change comes out, the queue grows. This is where
/// that is visible, and it is the one number a manager should look at before
/// locking up.
export function Queue() {
  const go = useGo()
  const queue = useSaleQueue()
  const unsent = unsentCount(queue)
  const refused = refusedCount(queue)

  // Newest first: the sale somebody is standing there asking about is the one
  // that just happened.
  const entries = [...queue].sort((left, right) =>
    right.queuedAt.localeCompare(left.queuedAt),
  )

  return (
    <>
      <Screen foot="none">
        {refused > 0 && (
          <Banner tone="bad" className="mt-4 mb-4">
            <ShieldAlert className="mt-px inline size-4" />{" "}
            {refused === 1 ? "One sale was" : `${refused} sales were`} refused
            by the counter. These do not retry on their own and the money has
            already been taken — each one needs a person.
          </Banner>
        )}

        {entries.length === 0 ? (
          <EmptyState
            action={
              <Button onClick={() => go("/sell")}>Back to the counter</Button>
            }
          >
            Every sale this device has taken has reached the counter. Nothing is
            waiting.
          </EmptyState>
        ) : (
          <Section
            title={
              unsent === 0 ? "All sent" : `${unsent} not yet at the counter`
            }
          >
            <CardList>
              {entries.map((sale) => (
                <QueuedCard key={sale.localId} sale={sale} onOpen={go} />
              ))}
            </CardList>
          </Section>
        )}
      </Screen>

      {unsent > 0 && (
        <ActionBar>
          <Button variant="dark" size="lg" block onClick={() => void flush()}>
            <RotateCw />
            Try to send now
          </Button>
        </ActionBar>
      )}
    </>
  )
}

const TONE = {
  waiting: "warn",
  sending: "info",
  settled: "ok",
  refused: "bad",
} as const

const WORD = {
  waiting: "Waiting",
  sending: "Sending",
  settled: "At the counter",
  refused: "Refused",
} as const

const GLYPH = {
  waiting: <Clock />,
  sending: <RotateCw />,
  settled: <CheckCircle2 />,
  refused: <ShieldAlert />,
}

function QueuedCard({
  sale,
  onOpen,
}: {
  sale: QueuedSale
  onOpen: (to: string, search?: { sale?: string }) => void
}) {
  const paid = sale.request.tenders.reduce(
    (sum, one) => sum + one.amount_minor,
    0,
  )
  return (
    <RecordCard
      icon={GLYPH[sale.state]}
      id={money(
        sale.result?.total_minor ?? sale.quotedTotalMinor,
        sale.currency,
      )}
      status={<Pill tone={TONE[sale.state]}>{WORD[sale.state]}</Pill>}
    >
      <div className="px-3 pt-1 pb-2.5">
        <KeyValue term="Rung">{moment(sale.queuedAt)}</KeyValue>
        <KeyValue term="Items">{sale.lines.length}</KeyValue>
        <KeyValue term="Paid">{money(paid, sale.currency)}</KeyValue>
        {sale.lastError !== null && (
          <KeyValue term="Last answer" tone="bad">
            {sale.lastError}
          </KeyValue>
        )}
      </div>
      <div className="flex flex-wrap gap-2 border-t border-hairline px-3 py-2.5">
        <Button onClick={() => onOpen("/sell/receipt", { sale: sale.localId })}>
          Receipt
        </Button>
        {sale.state === "refused" && (
          <>
            {/* Same key, so if the counter did in fact record it the first time
                — a refusal that was really a timeout on the way back — this
                returns the original answer rather than charging twice. */}
            <Button onClick={() => retryRefused(sale.localId)}>
              <RotateCw />
              Send again
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                if (
                  window.confirm(
                    "Clear this refused sale? Nothing will be recorded at head office and the money stays taken — only do this once somebody has dealt with it.",
                  )
                ) {
                  dismissRefused(sale.localId)
                }
              }}
            >
              <Trash2 />
              Clear
            </Button>
          </>
        )}
      </div>
    </RecordCard>
  )
}
