import { useState } from "react"

import {
  ConfirmButton,
  Panel,
  Problem,
  Row,
  RowNumber,
  RowText,
} from "@/components/ops/parts"
import { useAction } from "@/lib/action"
import {
  Note,
  Pill,
  ScreenBody,
  ScreenHeader,
  ScreenState,
} from "@/components/shell"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { dc } from "@/lib/api"
import { clock, money, units, variance } from "@/lib/format"
import { keys } from "@/lib/queries"
import { useActor } from "@/lib/session"
import { idempotencyKey } from "@itulah/contract/client"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

/// Receiving, which is two jobs and deliberately not one screen's worth of
/// one person's work.
///
/// A delivery is opened, counted by somebody who is not shown what was
/// ordered, and then approved by somebody else who is shown everything. The
/// count is a document; the approval is what makes the goods exist as stock
/// and what sends anything at all to the centre. The two views here withhold
/// and reveal exactly what the server withholds and reveals — the checker's
/// list carries no ordered quantity because the wire does not carry one.
export function ReceivingScreen() {
  const [job, setJob] = useState<"count" | "verify">("count")
  const [receiptId, setReceiptId] = useState<string | null>(null)
  const client = useQueryClient()

  const receipts = useQuery({
    queryKey: keys.receipts(),
    queryFn: ({ signal }) => dc.goodsReceipts(signal),
  })

  const selected =
    receipts.data?.find((receipt) => receipt.receipt_id === receiptId) ?? null

  const refreshEverything = () => {
    void client.invalidateQueries({ queryKey: ["dc"] })
  }

  return (
    <>
      <ScreenHeader
        title="Receiving"
        subtitle="Count blind, then a second person decides"
      >
        <div className="flex rounded-full bg-muted p-0.5">
          {(["count", "verify"] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setJob(option)}
              className={
                job === option
                  ? "rounded-full bg-background px-4 py-1.5 text-xs font-medium shadow-sm"
                  : "rounded-full px-4 py-1.5 text-xs font-medium text-muted-foreground"
              }
            >
              {option === "count" ? "Counting" : "Verifying"}
            </button>
          ))}
        </div>
      </ScreenHeader>

      <ScreenBody className="lg:grid lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] lg:items-start">
        <div className="flex flex-col gap-4">
          <Deliveries
            receiptId={receiptId}
            onSelect={setReceiptId}
            onChanged={refreshEverything}
          />
          {selected !== null && (
            <Invoice
              receiptId={selected.receipt_id}
              receiptNumber={selected.receipt_number}
              invoiceNumber={selected.invoice_number}
              invoiceTotalMinor={selected.invoice_total_minor}
              onChanged={refreshEverything}
            />
          )}
        </div>

        <div className="flex flex-col gap-4">
          {job === "count" ? (
            <Counting receiptId={receiptId} onChanged={refreshEverything} />
          ) : (
            <Verifying onChanged={refreshEverything} />
          )}
        </div>
      </ScreenBody>
    </>
  )
}

/// Deliveries open on the bay, and the form that opens another.
function Deliveries({
  receiptId,
  onSelect,
  onChanged,
}: {
  receiptId: string | null
  onSelect: (receiptId: string | null) => void
  onChanged: () => void
}) {
  const actor = useActor()
  const action = useAction()
  const [supplier, setSupplier] = useState("")
  const [arrived, setArrived] = useState("")
  const [opening, setOpening] = useState(false)

  const receipts = useQuery({
    queryKey: keys.receipts(),
    queryFn: ({ signal }) => dc.goodsReceipts(signal),
  })

  const open = async () => {
    const supplierId = supplier.trim()
    if (supplierId === "") {
      return
    }
    const done = await action.run(async () => {
      const receipt = await dc.openGoodsReceipt({
        supplier_id: supplierId,
        // Supplied rather than assumed: a document opened the next morning is
        // still about yesterday's lorry.
        arrived_at: arrived === "" ? null : new Date(arrived).toISOString(),
        actor_id: actor,
        idempotency_key: idempotencyKey(),
      })
      onSelect(receipt.receipt_id)
    })
    if (done) {
      setSupplier("")
      setArrived("")
      setOpening(false)
      onChanged()
    }
  }

  return (
    <Panel title="On the bay" meta={`${receipts.data?.length ?? 0} open`}>
      {receipts.isPending && <ScreenState>Reading the bay…</ScreenState>}
      {receipts.isError && (
        <ScreenState tone="problem">
          {(receipts.error as Error).message}
        </ScreenState>
      )}
      {receipts.data?.length === 0 && (
        <ScreenState>
          Nothing is open. Open a delivery when a lorry arrives — before
          anything is counted.
        </ScreenState>
      )}

      {receipts.data?.map((receipt) => (
        <Row
          key={receipt.receipt_id}
          selected={receipt.receipt_id === receiptId}
          onClick={() => onSelect(receipt.receipt_id)}
        >
          <RowText code={receipt.receipt_number}>
            {receipt.supplier_id} · arrived {clock(receipt.arrived_at)}
          </RowText>
          <span className="flex shrink-0 flex-col items-end gap-1">
            <Pill tone={receipt.status === "COUNTING" ? "warn" : "neutral"}>
              {receipt.status.toLowerCase().replace(/_/g, " ")}
            </Pill>
            <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
              {receipt.accepted_lines}/{receipt.counted_lines} accepted
            </span>
          </span>
        </Row>
      ))}

      {opening ? (
        <div className="flex flex-col gap-2 border-t px-4 py-3">
          <Input
            value={supplier}
            placeholder="Supplier id"
            className="h-(--tap)"
            onChange={(event) => setSupplier(event.target.value)}
          />
          <Input
            value={arrived}
            type="datetime-local"
            className="h-(--tap)"
            onChange={(event) => setArrived(event.target.value)}
          />
          <div className="flex gap-2">
            <Button
              className="h-(--tap) flex-1"
              disabled={action.pending}
              onClick={() => void open()}
            >
              Open delivery
            </Button>
            <Button
              variant="ghost"
              className="h-(--tap)"
              onClick={() => setOpening(false)}
            >
              Cancel
            </Button>
          </div>
          <Problem error={action.error} />
        </div>
      ) : (
        <div className="border-t px-4 py-3">
          <Button
            variant="secondary"
            className="h-(--tap) w-full"
            onClick={() => setOpening(true)}
          >
            A lorry has arrived
          </Button>
        </div>
      )}
    </Panel>
  )
}

/// The checker's screen. No ordered quantity, no earlier count, no progress
/// bar — a count taken while looking at the number it is meant to produce is
/// not evidence of anything.
function Counting({
  receiptId,
  onChanged,
}: {
  receiptId: string | null
  onChanged: () => void
}) {
  const actor = useActor()
  const action = useAction()
  const [counted, setCounted] = useState<Record<string, string>>({})

  const work = useQuery({
    queryKey: keys.purchaseWork(),
    queryFn: ({ signal }) => dc.purchaseWork(signal),
  })

  const record = async (poLineId: string) => {
    if (receiptId === null) {
      return
    }
    const typed = Number(counted[poLineId])
    if (!Number.isInteger(typed) || typed < 0) {
      return
    }
    const done = await action.run(() =>
      dc.countPurchase({
        receipt_id: receiptId,
        po_line_id: poLineId,
        counted_quantity: typed,
        actor_id: actor,
        idempotency_key: idempotencyKey(),
      })
    )
    if (done) {
      setCounted((current) => ({ ...current, [poLineId]: "" }))
      onChanged()
    }
  }

  return (
    <>
      <Panel
        title="Count what arrived"
        meta={
          receiptId === null ? (
            <Pill tone="warn">pick a delivery</Pill>
          ) : (
            `${work.data?.length ?? 0} lines`
          )
        }
      >
        {receiptId === null && (
          <ScreenState>
            A count hangs off a delivery, because one lorry brings several
            articles against several orders and they are one arrival with one
            invoice. Choose the delivery first.
          </ScreenState>
        )}

        {receiptId !== null && work.isPending && (
          <ScreenState>Reading what this DC is owed…</ScreenState>
        )}
        {receiptId !== null && work.data?.length === 0 && (
          <ScreenState>
            Nothing outstanding. Every purchase line this DC owes a delivery
            against has been received.
          </ScreenState>
        )}

        {receiptId !== null &&
          work.data?.map((line) => (
            <div
              key={line.po_line_id}
              className="flex flex-wrap items-center gap-3 border-b px-4 py-3 last:border-b-0"
            >
              <span className="min-w-40 flex-1">
                <span className="block text-sm font-medium">
                  {line.article_name}
                </span>
                <span className="block font-mono text-[11px] text-muted-foreground">
                  {line.article_code} · {line.po_number}
                  {line.supplier_name === null
                    ? ""
                    : ` · ${line.supplier_name}`}
                </span>
              </span>
              <Input
                value={counted[line.po_line_id] ?? ""}
                inputMode="numeric"
                placeholder="pieces"
                className="h-(--tap) w-28 text-center font-mono"
                onChange={(event) =>
                  setCounted((current) => ({
                    ...current,
                    [line.po_line_id]: event.target.value,
                  }))
                }
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault()
                    void record(line.po_line_id)
                  }
                }}
              />
              <Button
                className="h-(--tap)"
                disabled={
                  action.pending ||
                  (counted[line.po_line_id] ?? "").trim() === ""
                }
                onClick={() => void record(line.po_line_id)}
              >
                Record
              </Button>
            </div>
          ))}
        <Problem error={action.error} />
      </Panel>

      <Note>
        <strong className="font-medium text-foreground">
          The ordered quantity is not on this screen.
        </strong>{" "}
        It is not hidden by the layout — the server does not send it to this
        view. What you write down is what you counted; whether it matches the
        order is the next person's question.
      </Note>
    </>
  )
}

/// The verifier's screen. Everything the checker was not shown, because a
/// verifier is comparing rather than counting.
function Verifying({ onChanged }: { onChanged: () => void }) {
  const actor = useActor()
  const [prices, setPrices] = useState<Record<string, string>>({})
  const [notes, setNotes] = useState<Record<string, string>>({})
  const client = useQueryClient()

  const queue = useQuery({
    queryKey: keys.verifyQueue(),
    queryFn: ({ signal }) => dc.countsAwaitingVerification(signal),
  })

  const decide = useMutation({
    mutationFn: (input: {
      countId: string
      decision: "Accept" | "Recount"
      invoicedPriceMinor: number | null
      note: string | null
    }) =>
      dc.verifyPurchase({
        count_id: input.countId,
        verifier_actor_id: actor,
        decision: input.decision,
        note: input.note,
        invoiced_price_minor: input.invoicedPriceMinor,
        idempotency_key: idempotencyKey(),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: keys.verifyQueue() })
      onChanged()
    },
  })

  return (
    <>
      <Panel
        title="Waiting for a second pair of hands"
        meta={`${queue.data?.length ?? 0} counts`}
      >
        {queue.isPending && <ScreenState>Reading the queue…</ScreenState>}
        {queue.data?.length === 0 && (
          <ScreenState>
            Nothing is waiting. A count appears here the moment a checker writes
            one down.
          </ScreenState>
        )}

        {queue.data?.map((count) => {
          const yours = count.counted_by.trim() === actor.trim()
          const price = prices[count.count_id] ?? ""
          const note = notes[count.count_id] ?? ""
          return (
            <div
              key={count.count_id}
              className="flex flex-col gap-3 border-b px-4 py-3.5 last:border-b-0"
            >
              <div className="flex flex-wrap items-start gap-3">
                <span className="min-w-40 flex-1">
                  <span className="block text-sm font-medium">
                    {count.article_name}
                  </span>
                  <span className="block font-mono text-[11px] text-muted-foreground">
                    {count.article_code} · {count.po_number} · counted by{" "}
                    {count.counted_by} at {clock(count.counted_at)}
                  </span>
                </span>
                <RowNumber
                  value={units(count.counted_quantity)}
                  label="counted"
                />
                <RowNumber
                  value={units(count.expected_stock_units)}
                  label="ordered"
                  tone="muted"
                />
                <span className="shrink-0 self-center">
                  {count.variance === 0 ? (
                    <Pill tone="good">exact</Pill>
                  ) : (
                    <Pill tone={count.variance < 0 ? "bad" : "warn"}>
                      {variance(count.variance)}
                    </Pill>
                  )}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground">
                  Agreed {money(count.unit_price_minor)} per piece
                </span>
                <Input
                  value={price}
                  inputMode="numeric"
                  placeholder="Invoiced per piece"
                  className="h-(--tap) w-44 font-mono"
                  onChange={(event) =>
                    setPrices((current) => ({
                      ...current,
                      [count.count_id]: event.target.value,
                    }))
                  }
                />
                <ConfirmButton
                  label="Accept"
                  className="h-(--tap)"
                  disabled={decide.isPending}
                  title={`Accept ${units(count.counted_quantity)} pieces`}
                  description={
                    <>
                      This is the moment the goods become stock and the moment
                      head office hears about this delivery at all.
                      {count.variance !== 0 &&
                        ` The count is ${variance(count.variance)} against the order, and it is the count that is accepted.`}
                      {price !== "" &&
                        " If the invoiced price differs from the agreed one, the delivery still goes in and a query goes to the buyer."}
                    </>
                  }
                  confirmLabel="Accept the count"
                  onConfirm={() =>
                    decide.mutate({
                      countId: count.count_id,
                      decision: "Accept",
                      invoicedPriceMinor: price === "" ? null : Number(price),
                      note: null,
                    })
                  }
                />
                <Input
                  value={note}
                  placeholder="Why recount?"
                  className="h-(--tap) min-w-40 flex-1"
                  onChange={(event) =>
                    setNotes((current) => ({
                      ...current,
                      [count.count_id]: event.target.value,
                    }))
                  }
                />
                <Button
                  variant="outline"
                  className="h-(--tap)"
                  disabled={decide.isPending || note.trim() === ""}
                  onClick={() =>
                    decide.mutate({
                      countId: count.count_id,
                      decision: "Recount",
                      invoicedPriceMinor: null,
                      note: note.trim(),
                    })
                  }
                >
                  Send back
                </Button>
              </div>

              {yours && (
                <p className="text-[11px] text-muted-foreground">
                  You counted this one. Where this site enforces two pairs of
                  hands the node will refuse it, and say so.
                </p>
              )}
            </div>
          )
        })}
        <Problem error={decide.error} />
      </Panel>

      <Note>
        There is no field here for a quantity of your own. Somebody who could
        both approve a delivery and decide what it was would have the whole
        control to themselves — you approve the checker's number as it stands,
        or you send it back to be counted again.
      </Note>
    </>
  )
}

/// The supplier's invoice, recorded against the delivery. The system never
/// sees that document; this number exists only because a person looked.
function Invoice({
  receiptId,
  receiptNumber,
  invoiceNumber,
  invoiceTotalMinor,
  onChanged,
}: {
  receiptId: string
  receiptNumber: string
  invoiceNumber: string | null
  invoiceTotalMinor: number | null
  onChanged: () => void
}) {
  const actor = useActor()
  const action = useAction()
  const [number, setNumber] = useState("")
  const [date, setDate] = useState("")
  const [total, setTotal] = useState("")

  const record = async () => {
    if (number.trim() === "" || total.trim() === "") {
      return
    }
    const done = await action.run(() =>
      dc.recordInvoice(receiptId, {
        receipt_id: receiptId,
        invoice_number: number.trim(),
        invoice_date: date === "" ? null : date,
        invoice_total_minor: Number(total),
        invoice_document_ref: null,
        actor_id: actor,
        idempotency_key: idempotencyKey(),
      })
    )
    if (done) {
      setNumber("")
      setDate("")
      setTotal("")
      onChanged()
    }
  }

  if (invoiceNumber !== null) {
    return (
      <Panel title="Invoice" meta={receiptNumber}>
        <Row>
          <RowText code={invoiceNumber}>recorded against this delivery</RowText>
          <RowNumber value={money(invoiceTotalMinor)} label="total" />
        </Row>
      </Panel>
    )
  }

  return (
    <Panel title="Invoice" meta={receiptNumber}>
      <div className="flex flex-col gap-2 px-4 py-3">
        <Input
          value={number}
          placeholder="Invoice number"
          className="h-(--tap)"
          onChange={(event) => setNumber(event.target.value)}
        />
        <div className="flex gap-2">
          <Input
            value={date}
            type="date"
            className="h-(--tap) flex-1"
            onChange={(event) => setDate(event.target.value)}
          />
          <Input
            value={total}
            inputMode="numeric"
            placeholder="Total (rupiah)"
            className="h-(--tap) flex-1 font-mono"
            onChange={(event) => setTotal(event.target.value)}
          />
        </div>
        <Button
          variant="secondary"
          className="h-(--tap)"
          disabled={action.pending}
          onClick={() => void record()}
        >
          Record invoice
        </Button>
        <Problem error={action.error} />
      </div>
    </Panel>
  )
}
