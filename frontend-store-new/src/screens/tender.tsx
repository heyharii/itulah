import { useQuery } from "@tanstack/react-query"
import { Banknote, CreditCard, QrCode, Ticket, Wallet, X } from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Field, Input } from "@/components/ui/field"
import { BigNumber } from "@/components/ui/kpi"
import { Numpad } from "@/components/ui/numpad"
import { Pill } from "@/components/ui/pill"
import { TotalsLadder } from "@/components/ui/rows"
import { ActionBar, CardList, Screen, Section } from "@/components/ui/screen"
import { Segmented } from "@/components/ui/segmented"
import { Banner, EmptyState } from "@/components/ui/states"
import {
  addCoupon,
  clearBasket,
  quoteBasket,
  removeCoupon,
  setCustomer,
  useBasket,
} from "@/lib/basket"
import { useGo } from "@/lib/go"
import { catalogueKey, fetchCatalogue } from "@/lib/queries"
import { enqueueSale, flush } from "@/lib/sale-queue"
import { useIdentity } from "@/lib/session"
import type { PaymentMethod, SaleTender } from "@itulah/contract"
import { money, parseMoneyToMinor } from "@itulah/contract/money"

const METHODS: readonly {
  readonly value: PaymentMethod
  readonly label: string
}[] = [
  { value: "CASH", label: "Cash" },
  { value: "CARD", label: "Card" },
  { value: "QRIS", label: "QRIS" },
  { value: "OTHER", label: "Other" },
]

const GLYPH: Record<PaymentMethod, React.ReactNode> = {
  CASH: <Banknote />,
  CARD: <CreditCard />,
  QRIS: <QrCode />,
  OTHER: <Wallet />,
}

/// Taking the money.
///
/// A sale is settled by a **list** of tenders, not by one number: half on a
/// card and half in cash is an ordinary basket, and a till that could record
/// only one of them either refuses the sale or misreports how it settled — and
/// the misreport is the one that reaches the bank reconciliation weeks later as
/// a difference nobody can trace.
///
/// One rule from `backend/src/tender.rs` is enforced on this side too, because
/// it is easier to obey than to explain after the fact: **only cash may exceed
/// the total.** A card charged for more than the basket is not generosity, it
/// is a mistake nobody notices until a statement arrives.
export function Tender() {
  const go = useGo()
  const basket = useBasket()
  const identity = useIdentity()
  const catalogue = useQuery({
    queryKey: catalogueKey(),
    queryFn: ({ signal }) => fetchCatalogue(signal),
  })
  const currency = catalogue.data?.currency ?? "IDR"

  const quote = quoteBasket(basket.lines)
  const [tenders, setTenders] = useState<readonly SaleTender[]>([])
  const [method, setMethod] = useState<PaymentMethod>("CASH")
  const [digits, setDigits] = useState("")
  const [reference, setReference] = useState("")
  const [coupon, setCoupon] = useState("")
  const [problem, setProblem] = useState<string | null>(null)

  // The keypad works in MAJOR units — nobody at a counter types "150000"
  // thinking in the smallest currency unit, they type the number on the note —
  // and the wire is minor. `parseMoneyToMinor` owns that conversion for the
  // whole estate, so asking it what one major unit comes to is how this screen
  // learns the divisor without keeping a second copy of the currency table.
  const perMajor = parseMoneyToMinor("1", currency) ?? 1
  const keyed = parseMoneyToMinor(digits === "" ? "0" : digits, currency) ?? 0
  const paid = tenders.reduce((sum, one) => sum + one.amount_minor, 0)
  const nonCash = tenders
    .filter((one) => one.method !== "CASH")
    .reduce((sum, one) => sum + one.amount_minor, 0)
  const outstanding = Math.max(0, quote.totalMinor - paid)
  const change = Math.max(0, paid - quote.totalMinor)
  const settled = tenders.length > 0 && paid >= quote.totalMinor

  // `screen_reference` in the node refuses anything with twelve or more digits
  // in it, and refuses at the door rather than trusting a caller: a card number
  // that reaches a database is a card number that has to be erased from
  // backups. Said here as well, so a cashier is told before the sale is rung
  // rather than after.
  const referenceDigits = reference.replace(/\D/g, "").length
  const referenceLooksLikeACard = referenceDigits >= 12

  function addTender() {
    if (keyed <= 0) {
      setProblem("Key an amount first.")
      return
    }
    if (method !== "CASH" && nonCash + keyed > quote.totalMinor) {
      setProblem(
        "Only cash can be taken for more than the basket — change comes out of the drawer, not out of a card.",
      )
      return
    }
    if (referenceLooksLikeACard) {
      setProblem(
        "That reference looks like a card number. Put the approval code or the acquirer here, never the instrument.",
      )
      return
    }
    setTenders([
      ...tenders,
      {
        method,
        amount_minor: keyed,
        reference: reference.trim() === "" ? null : reference.trim(),
      },
    ])
    setDigits("")
    setReference("")
    setProblem(null)
  }

  function complete() {
    const actor = identity.data?.username ?? ""
    // Written to disk, with its key, before a single byte goes on the wire.
    // Everything after this line is the queue's problem — including the case
    // where this tablet never manages to send it at all.
    const entry = enqueueSale({
      lines: basket.lines.map((line) => ({
        epc: line.epc,
        sku_code: line.sku_code,
        name: line.name ?? line.sku_code,
        unit_price_minor: line.unit_price_minor ?? 0,
      })),
      tenders,
      coupon_codes: basket.coupons,
      customer_id: basket.customerId,
      actor_id: actor,
      currency,
      quotedTotalMinor: quote.totalMinor,
    })
    clearBasket()
    void flush()
    go("/sell/receipt", { sale: entry.localId }, { replace: true })
  }

  if (basket.lines.length === 0) {
    return (
      <Screen foot="none">
        <EmptyState
          action={
            <Button onClick={() => go("/sell")}>Back to the counter</Button>
          }
        >
          There is nothing on the counter to take money for.
        </EmptyState>
      </Screen>
    )
  }

  return (
    <>
      <Screen foot="none">
        <div className="py-4">
          <BigNumber
            label={outstanding > 0 ? "Still owed" : "Change"}
            value={money(outstanding > 0 ? outstanding : change, currency)}
            tone={outstanding > 0 ? "ink" : "ok"}
            sub={`${quote.units} ${quote.units === 1 ? "item" : "items"} · ${money(quote.totalMinor, currency)}${
              quote.incomplete ? " at least" : ""
            }`}
          />
        </div>

        {quote.incomplete && (
          <Banner tone="warn" className="mb-4">
            Some items have no published price. The counter will price them when
            the sale is rung, so the figure above can only go up.
          </Banner>
        )}

        <Section title="How it is being paid">
          <Segmented
            options={METHODS}
            value={method}
            onChange={(next) => {
              setMethod(next)
              setProblem(null)
            }}
            className="mb-3"
          />

          <div className="mb-3 flex h-14 items-center justify-between rounded-inner bg-soft px-4">
            <span className="text-meta text-mute">Amount</span>
            <span className="text-metric font-semibold text-ink tabular-nums">
              {money(keyed, currency)}
            </span>
          </div>

          <Numpad
            className="mb-3"
            onDigit={(digit) => {
              setProblem(null)
              // A lone leading zero is somebody hitting the key twice, not a
              // number, so the new digit REPLACES it rather than following it.
              // Note the brackets: `current === "0" ? "" : current + digit`
              // would throw the pressed digit away, and a cashier who keyed a
              // stray 0 before 150000 would tender 50000 for a 150000 basket.
              // Capped at 12 digits, which is more rupiah than a shop takes in
              // a year.
              setDigits((current) =>
                ((current === "0" ? "" : current) + digit).slice(0, 12),
              )
            }}
            onBackspace={() => setDigits((current) => current.slice(0, -1))}
            // The notes a shopper actually hands over, and the exact amount.
            // Only for cash: there is no such thing as handing over a round
            // number on a card, and offering one would invite a cashier to
            // overcharge it — which the node refuses and this screen already
            // warns about.
            quick={
              method === "CASH" && outstanding > 0
                ? [
                    { label: "Exact", minor: outstanding },
                    { label: "50rb", minor: 50_000 * perMajor },
                    { label: "100rb", minor: 100_000 * perMajor },
                    { label: "200rb", minor: 200_000 * perMajor },
                  ]
                : undefined
            }
            onQuick={(minor) => {
              setProblem(null)
              setDigits(String(Math.round(minor / perMajor)))
            }}
          />

          {method !== "CASH" && (
            <Field
              label="Reference"
              className="mb-3"
              hint="The acquirer, the issuing bank, the approval code — for whoever reconciles this against a statement."
              problem={
                referenceLooksLikeACard
                  ? "Never a card number and never an account number."
                  : undefined
              }
            >
              <Input
                value={reference}
                onChange={(event) => setReference(event.target.value)}
                invalid={referenceLooksLikeACard}
                placeholder="e.g. BCA · approval 8842"
                inputMode="text"
                autoCapitalize="characters"
              />
            </Field>
          )}

          <Button block size="lg" onClick={addTender}>
            {GLYPH[method]}
            Add{" "}
            {METHODS.find((one) => one.value === method)?.label.toLowerCase()}
          </Button>
        </Section>

        {tenders.length > 0 && (
          <Section title="Taken">
            <CardList>
              {tenders.map((one, index) => (
                <div
                  key={index}
                  className="flex items-center gap-3 rounded-card border border-hairline bg-canvas px-3 py-2.5 shadow-soft"
                >
                  <span className="grid size-[1.6875rem] shrink-0 place-items-center rounded-[0.5rem] border border-hairline bg-canvas text-line-ico [&_svg]:size-[0.9375rem]">
                    {GLYPH[one.method]}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-card-title font-semibold text-ink">
                      {money(one.amount_minor, currency)}
                    </div>
                    <div className="truncate text-meta text-mute">
                      {one.method === "CASH"
                        ? "Cash"
                        : (one.reference ?? one.method)}
                    </div>
                  </div>
                  <Button
                    size="icon"
                    variant="quiet"
                    aria-label="Take this payment back off"
                    onClick={() =>
                      setTenders(tenders.filter((_, at) => at !== index))
                    }
                  >
                    <X />
                  </Button>
                </div>
              ))}
            </CardList>

            <TotalsLadder
              className="mt-3"
              rows={[
                { label: "Basket", value: money(quote.totalMinor, currency) },
                { label: "Paid", value: money(paid, currency) },
              ]}
              total={{
                label: outstanding > 0 ? "Still owed" : "Change",
                value: money(outstanding > 0 ? outstanding : change, currency),
              }}
            />
          </Section>
        )}

        <Section title="Codes and customer">
          <div className="flex gap-2.5">
            <Input
              value={coupon}
              onChange={(event) => setCoupon(event.target.value)}
              placeholder="Coupon code"
              autoCapitalize="characters"
              autoCorrect="off"
            />
            <Button
              onClick={() => {
                addCoupon(coupon)
                setCoupon("")
              }}
            >
              <Ticket />
              Add
            </Button>
          </div>
          {basket.coupons.length > 0 && (
            <div className="mt-2.5 flex flex-wrap gap-2">
              {basket.coupons.map((code) => (
                <button
                  key={code}
                  type="button"
                  onClick={() => removeCoupon(code)}
                  className="pressable flex h-11 items-center gap-2 rounded-full bg-accent-bg px-3.5 font-mono text-id text-accent"
                >
                  {code}
                  <X className="size-3.5" />
                </button>
              ))}
            </div>
          )}
          <Field
            label="Member"
            className="mt-3"
            hint="Needed for a coupon issued to one person, and for points."
          >
            <Input
              value={basket.customerId ?? ""}
              onChange={(event) => setCustomer(event.target.value)}
              placeholder="Member id, if they have one"
              autoCapitalize="none"
              autoCorrect="off"
            />
          </Field>
        </Section>

        {problem !== null && (
          <Banner tone="bad" className="mb-4">
            {problem}
          </Banner>
        )}

        {basket.coupons.length > 0 && (
          <Banner tone="info" className="mb-4">
            A coupon is applied by the counter, not by this screen. The receipt
            will say what each one took off — and, if one was refused, why.
          </Banner>
        )}
      </Screen>

      <ActionBar>
        <Button
          variant="dark"
          size="lg"
          block
          disabled={!settled}
          onClick={complete}
        >
          {settled ? (
            <>
              Complete sale
              {change > 0 && (
                <Pill tone="ok" className="ml-1">
                  {money(change, currency)} change
                </Pill>
              )}
            </>
          ) : (
            `${money(outstanding, currency)} still to take`
          )}
        </Button>
      </ActionBar>
    </>
  )
}
