import { CheckCircle2, Clock, Gift, ReceiptText, XCircle } from "lucide-react"

import { Button } from "@/components/ui/button"
import { RecordCard } from "@/components/ui/card"
import { BigNumber } from "@/components/ui/kpi"
import { Pill } from "@/components/ui/pill"
import {
  KeyValue,
  MiniRow,
  MiniTable,
  TotalsLadder,
} from "@/components/ui/rows"
import { ActionBar, CardList, Screen, Section } from "@/components/ui/screen"
import { Banner, EmptyState } from "@/components/ui/states"
import { moment } from "@/lib/format"
import { useGo } from "@/lib/go"
import { useParam } from "@/lib/params"
import { groupBasket } from "@/lib/basket"
import { useSaleQueue, type QueuedSale } from "@/lib/sale-queue"
import { money } from "@itulah/contract/money"

/// What just happened, and what the customer is owed.
///
/// Read out of the durable queue rather than out of the mutation that made it,
/// so it survives the reload that a shop's tablet takes several times a day —
/// and so it can be shown at all when the node has not answered yet. A receipt
/// that only exists while a promise is in flight is a receipt nobody can
/// reopen.
export function ReceiptScreen() {
  const go = useGo()
  const which = useParam("sale")
  const queue = useSaleQueue()
  const sale = queue.find((entry) => entry.localId === which.value)

  if (sale === undefined) {
    return (
      <Screen foot="none">
        <EmptyState
          action={
            <Button onClick={() => go("/sell")}>Back to the counter</Button>
          }
        >
          That receipt is not on this device. Sales are kept here only until
          head office has them, and for a few minutes after.
        </EmptyState>
      </Screen>
    )
  }

  const result = sale.result
  const currency = sale.currency
  const groups = groupBasket(
    sale.lines.map((line) => ({
      epc: line.epc,
      sku_code: line.sku_code,
      name: line.name,
      unit_price_minor: line.unit_price_minor,
      base_unit_price_minor: null,
      price_source: null,
      scannedAt: sale.queuedAt,
    })),
  )
  const paid = sale.request.tenders.reduce(
    (sum, one) => sum + one.amount_minor,
    0,
  )

  return (
    <>
      <Screen foot="none">
        <div className="py-4">
          <BigNumber
            label={result === null ? "Change (from the quote)" : "Change"}
            value={money(
              result?.change_minor ?? Math.max(0, paid - sale.quotedTotalMinor),
              currency,
            )}
            tone="ok"
            sub={
              result === null
                ? "The counter has not confirmed this sale yet."
                : `Sale ${result.sale_id.slice(0, 8)} · ${moment(result.completed_at)}`
            }
          />
        </div>

        <Section>
          <StateBanner sale={sale} />
        </Section>

        <Section title="Sold">
          <CardList>
            {groups.map((group) => (
              <RecordCard
                key={group.sku_code}
                icon={<ReceiptText />}
                id={group.name ?? group.sku_code}
              >
                <MiniTable head={["Item", "Qty", "Line total"]}>
                  <MiniRow>
                    <td>
                      <span className="font-mono text-id text-body">
                        {group.sku_code}
                      </span>
                    </td>
                    <td>{group.quantity}</td>
                    <td className="font-medium">
                      {group.line_total_minor === null
                        ? "—"
                        : money(group.line_total_minor, currency)}
                    </td>
                  </MiniRow>
                </MiniTable>
              </RecordCard>
            ))}
          </CardList>
        </Section>

        {/* What the promotions did, and what they did NOT do. A cashier asked
            "why didn't the discount come off" has the answer on the same
            response that completed the sale, so it is shown here rather than
            left to be guessed at. */}
        {result?.promotions !== undefined && result.promotions.length > 0 && (
          <Section title="Promotions">
            <CardList>
              {result.promotions.map((promotion) => (
                <RecordCard
                  key={promotion.rule_id}
                  icon={promotion.applied ? <CheckCircle2 /> : <XCircle />}
                  id={promotion.name}
                  status={
                    promotion.applied ? (
                      <Pill tone="ok">
                        −{money(promotion.benefit_minor, currency)}
                      </Pill>
                    ) : (
                      <Pill tone="neutral">Not applied</Pill>
                    )
                  }
                >
                  {promotion.reason !== null && (
                    <p className="px-3 py-2.5 text-meta text-body">
                      {promotion.reason}
                    </p>
                  )}
                </RecordCard>
              ))}
            </CardList>
          </Section>
        )}

        {/* Reported, never conjured. A free shirt still has to be scanned like
            any other, or the stock would say it is still on the shelf — so this
            is a prompt to hand something over, not a line that was sold. */}
        {result?.granted_lines !== undefined &&
          result.granted_lines.length > 0 && (
            <Section title="Owed to the shopper">
              <Banner tone="accent" className="mb-2.5">
                Hand these over and scan them like anything else — a garment
                that leaves without its tag being read stays on the shelf as far
                as the stock is concerned.
              </Banner>
              <CardList>
                {result.granted_lines.map((line) => (
                  <RecordCard
                    key={`${line.granted_by_rule_id}-${line.sku_code}`}
                    icon={<Gift />}
                    id={line.sku_code}
                    status={<Pill tone="accent">×{line.quantity}</Pill>}
                  />
                ))}
              </CardList>
            </Section>
          )}

        <Section title="Settled">
          {sale.request.tenders.map((one, index) => (
            <KeyValue
              key={index}
              term={
                one.method === "CASH" ? "Cash" : (one.reference ?? one.method)
              }
            >
              {money(one.amount_minor, currency)}
            </KeyValue>
          ))}
          {result !== null && result.points_earned > 0 && (
            <KeyValue term="Points earned" tone="ok">
              {result.points_earned}
            </KeyValue>
          )}
          <TotalsLadder
            className="mt-3"
            rows={[
              {
                label: result === null ? "Quoted" : "Charged",
                value: money(
                  result?.total_minor ?? sale.quotedTotalMinor,
                  currency,
                ),
              },
              { label: "Paid", value: money(paid, currency) },
            ]}
            total={{
              label: "Change",
              value: money(
                result?.change_minor ??
                  Math.max(0, paid - sale.quotedTotalMinor),
                currency,
              ),
            }}
          />
        </Section>
      </Screen>

      <ActionBar>
        <Button variant="dark" size="lg" block onClick={() => go("/sell")}>
          Next sale
        </Button>
      </ActionBar>
    </>
  )
}

/// Where this sale has got to, said in a sentence rather than a spinner.
function StateBanner({ sale }: { sale: QueuedSale }) {
  if (sale.state === "settled") {
    const result = sale.result
    // The quote and the receipt disagreeing is not an error — it is a promotion
    // the till could not see — but it is worth saying out loud, because the
    // cashier read the other number to the customer.
    const drift =
      result === null ? 0 : sale.quotedTotalMinor - result.total_minor
    return drift === 0 ? (
      <Banner tone="ok">
        <CheckCircle2 className="mt-px inline size-4" /> Recorded by the
        counter.
      </Banner>
    ) : (
      <Banner tone={drift > 0 ? "ok" : "warn"}>
        The counter charged {money(result?.total_minor ?? 0, sale.currency)} —{" "}
        {drift > 0 ? "less" : "more"} than the{" "}
        {money(sale.quotedTotalMinor, sale.currency)} on the basket screen. A
        promotion this screen could not see was applied at the counter.
      </Banner>
    )
  }
  if (sale.state === "refused") {
    return (
      <Banner tone="bad">
        The counter refused this sale: {sale.lastError ?? "no reason given"}.
        The money has been taken and this is not recorded — open “Not yet sent”
        and deal with it before the shopper leaves.
      </Banner>
    )
  }
  return (
    <Banner tone="warn">
      <Clock className="mt-px inline size-4" /> Saved on this device and waiting
      to reach the counter
      {sale.attempts > 0 && ` (${sale.attempts} attempts so far)`}. The sale is
      not lost — it will go as soon as the line is back, and it cannot be
      recorded twice.
    </Banner>
  )
}
