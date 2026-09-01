import { useState } from "react"

import {
  ConfirmButton,
  Panel,
  Problem,
  Row,
  RowNumber,
  RowText,
} from "@/components/ops/parts"
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
import type {
  PurchaseCountAwaitingVerification,
  PurchaseWorkLine,
} from "@itulah/contract"
import { useForm, useStore } from "@tanstack/react-form"
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

  const receipts = useQuery({
    queryKey: keys.receipts(),
    queryFn: ({ signal }) => dc.goodsReceipts(signal),
  })

  const selected =
    receipts.data?.find((receipt) => receipt.receipt_id === receiptId) ?? null

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
          <Deliveries receiptId={receiptId} onSelect={setReceiptId} />
          {selected !== null && (
            <Invoice
              receiptId={selected.receipt_id}
              receiptNumber={selected.receipt_number}
              invoiceNumber={selected.invoice_number}
              invoiceTotalMinor={selected.invoice_total_minor}
            />
          )}
        </div>

        <div className="flex flex-col gap-4">
          {job === "count" ? <Counting receiptId={receiptId} /> : <Verifying />}
        </div>
      </ScreenBody>
    </>
  )
}

/// Deliveries open on the bay, and the form that opens another.
function Deliveries({
  receiptId,
  onSelect,
}: {
  receiptId: string | null
  onSelect: (receiptId: string | null) => void
}) {
  const actor = useActor()
  const client = useQueryClient()
  const [opening, setOpening] = useState(false)

  const receipts = useQuery({
    queryKey: keys.receipts(),
    queryFn: ({ signal }) => dc.goodsReceipts(signal),
  })

  const open = useMutation({
    mutationFn: (value: { supplier: string; arrived: string }) =>
      dc.openGoodsReceipt({
        supplier_id: value.supplier.trim(),
        // Supplied rather than assumed: a document opened the next morning is
        // still about yesterday's lorry.
        arrived_at:
          value.arrived === "" ? null : new Date(value.arrived).toISOString(),
        actor_id: actor,
        idempotency_key: idempotencyKey(),
      }),
    onSuccess: (receipt) => {
      form.reset()
      setOpening(false)
      onSelect(receipt.receipt_id)
      void client.invalidateQueries({ queryKey: keys.receipts() })
    },
  })

  const form = useForm({
    defaultValues: { supplier: "", arrived: "" },
    onSubmit: ({ value }) => {
      if (value.supplier.trim() === "") {
        return
      }
      open.mutate(value)
    },
  })

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
        <form
          className="flex flex-col gap-2 border-t px-4 py-3"
          onSubmit={(event) => {
            event.preventDefault()
            void form.handleSubmit()
          }}
        >
          <form.Field name="supplier">
            {(field) => (
              <Input
                value={field.state.value}
                placeholder="Supplier id"
                className="h-(--tap)"
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
              />
            )}
          </form.Field>
          <form.Field name="arrived">
            {(field) => (
              <Input
                value={field.state.value}
                type="datetime-local"
                className="h-(--tap)"
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
              />
            )}
          </form.Field>
          <div className="flex gap-2">
            <Button
              type="submit"
              className="h-(--tap) flex-1"
              disabled={open.isPending}
            >
              Open delivery
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="h-(--tap)"
              onClick={() => setOpening(false)}
            >
              Cancel
            </Button>
          </div>
          <Problem error={open.error} />
        </form>
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
function Counting({ receiptId }: { receiptId: string | null }) {
  const actor = useActor()
  const client = useQueryClient()

  const work = useQuery({
    queryKey: keys.purchaseWork(),
    queryFn: ({ signal }) => dc.purchaseWork(signal),
  })

  const record = useMutation({
    mutationFn: (input: { poLineId: string; counted: number }) =>
      dc.countPurchase({
        receipt_id: receiptId as string,
        po_line_id: input.poLineId,
        counted_quantity: input.counted,
        actor_id: actor,
        idempotency_key: idempotencyKey(),
      }),
    // What is still owed shrinks, the delivery's tally moves, and the count
    // appears in the verifier's queue. All three are on screen somewhere.
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: keys.purchaseWork() })
      void client.invalidateQueries({ queryKey: keys.receipts() })
      void client.invalidateQueries({ queryKey: keys.verifyQueue() })
    },
  })

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
            <CountLine
              key={line.po_line_id}
              line={line}
              pending={record.isPending}
              onRecord={(counted) =>
                record.mutate({ poLineId: line.po_line_id, counted })
              }
            />
          ))}
        <Problem error={record.error} />
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

/// One purchase line, and the box the checker writes their number into.
///
/// A form of its own per line rather than one map of values for the screen: a
/// line is submitted on its own, cleared on its own, and the number typed
/// against it belongs to nothing else on the page.
function CountLine({
  line,
  pending,
  onRecord,
}: {
  line: PurchaseWorkLine
  pending: boolean
  onRecord: (counted: number) => void
}) {
  const form = useForm({
    defaultValues: { counted: "" },
    onSubmit: ({ value, formApi }) => {
      const typed = Number(value.counted)
      if (!Number.isInteger(typed) || typed < 0) {
        return
      }
      onRecord(typed)
      formApi.reset()
    },
  })

  return (
    <form
      className="flex flex-wrap items-center gap-3 border-b px-4 py-3 last:border-b-0"
      onSubmit={(event) => {
        event.preventDefault()
        void form.handleSubmit()
      }}
    >
      <span className="min-w-40 flex-1">
        <span className="block text-sm font-medium">{line.article_name}</span>
        <span className="block font-mono text-[11px] text-muted-foreground">
          {line.article_code} · {line.po_number}
          {line.supplier_name === null ? "" : ` · ${line.supplier_name}`}
        </span>
      </span>
      <form.Field name="counted">
        {(field) => (
          <Input
            value={field.state.value}
            inputMode="numeric"
            placeholder="pieces"
            className="h-(--tap) w-28 text-center font-mono"
            onBlur={field.handleBlur}
            onChange={(event) => field.handleChange(event.target.value)}
          />
        )}
      </form.Field>
      <form.Subscribe selector={(state) => state.values.counted.trim() === ""}>
        {(empty) => (
          <Button
            type="submit"
            className="h-(--tap)"
            disabled={pending || empty}
          >
            Record
          </Button>
        )}
      </form.Subscribe>
    </form>
  )
}

/// The verifier's screen. Everything the checker was not shown, because a
/// verifier is comparing rather than counting.
function Verifying() {
  const actor = useActor()
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
    // Accepting is what makes the goods stock, so this touches far more than
    // the queue it was pressed in: the delivery's tally, what is still owed,
    // the labels head office now wants printed, and the pools themselves.
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: keys.verifyQueue() })
      void client.invalidateQueries({ queryKey: keys.receipts() })
      void client.invalidateQueries({ queryKey: keys.purchaseWork() })
      void client.invalidateQueries({ queryKey: keys.taggingJobs() })
      void client.invalidateQueries({ queryKey: keys.pools() })
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

        {queue.data?.map((count) => (
          <VerifyLine
            key={count.count_id}
            count={count}
            yours={count.counted_by.trim() === actor.trim()}
            pending={decide.isPending}
            onDecide={(decision, invoicedPriceMinor, note) =>
              decide.mutate({
                countId: count.count_id,
                decision,
                invoicedPriceMinor,
                note,
              })
            }
          />
        ))}
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

/// One count waiting for a decision, with the two things a verifier may add:
/// the price the invoice actually asked for, and the reason for a recount.
function VerifyLine({
  count,
  yours,
  pending,
  onDecide,
}: {
  count: PurchaseCountAwaitingVerification
  yours: boolean
  pending: boolean
  onDecide: (
    decision: "Accept" | "Recount",
    invoicedPriceMinor: number | null,
    note: string | null
  ) => void
}) {
  const form = useForm({ defaultValues: { price: "", note: "" } })
  const price = useStore(form.store, (state) => state.values.price)
  const note = useStore(form.store, (state) => state.values.note)

  return (
    <div className="flex flex-col gap-3 border-b px-4 py-3.5 last:border-b-0">
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
        <RowNumber value={units(count.counted_quantity)} label="counted" />
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
        <form.Field name="price">
          {(field) => (
            <Input
              value={field.state.value}
              inputMode="numeric"
              placeholder="Invoiced per piece"
              className="h-(--tap) w-44 font-mono"
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.target.value)}
            />
          )}
        </form.Field>
        <ConfirmButton
          label="Accept"
          className="h-(--tap)"
          disabled={pending}
          title={`Accept ${units(count.counted_quantity)} pieces`}
          description={
            <>
              This is the moment the goods become stock and the moment head
              office hears about this delivery at all.
              {count.variance !== 0 &&
                ` The count is ${variance(count.variance)} against the order, and it is the count that is accepted.`}
              {price !== "" &&
                " If the invoiced price differs from the agreed one, the delivery still goes in and a query goes to the buyer."}
            </>
          }
          confirmLabel="Accept the count"
          onConfirm={() =>
            onDecide("Accept", price === "" ? null : Number(price), null)
          }
        />
        <form.Field name="note">
          {(field) => (
            <Input
              value={field.state.value}
              placeholder="Why recount?"
              className="h-(--tap) min-w-40 flex-1"
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.target.value)}
            />
          )}
        </form.Field>
        <Button
          variant="outline"
          className="h-(--tap)"
          disabled={pending || note.trim() === ""}
          onClick={() => onDecide("Recount", null, note.trim())}
        >
          Send back
        </Button>
      </div>

      {yours && (
        <p className="text-[11px] text-muted-foreground">
          You counted this one. Where this site enforces two pairs of hands the
          node will refuse it, and say so.
        </p>
      )}
    </div>
  )
}

/// The supplier's invoice, recorded against the delivery. The system never
/// sees that document; this number exists only because a person looked.
function Invoice({
  receiptId,
  receiptNumber,
  invoiceNumber,
  invoiceTotalMinor,
}: {
  receiptId: string
  receiptNumber: string
  invoiceNumber: string | null
  invoiceTotalMinor: number | null
}) {
  const actor = useActor()
  const client = useQueryClient()

  const record = useMutation({
    mutationFn: (value: { number: string; date: string; total: string }) =>
      dc.recordInvoice(receiptId, {
        receipt_id: receiptId,
        invoice_number: value.number.trim(),
        invoice_date: value.date === "" ? null : value.date,
        invoice_total_minor: Number(value.total),
        invoice_document_ref: null,
        actor_id: actor,
        idempotency_key: idempotencyKey(),
      }),
    onSuccess: () => {
      form.reset()
      // The delivery row carries the invoice number, and this panel is drawn
      // from that row rather than from a read of its own.
      void client.invalidateQueries({ queryKey: keys.receipts() })
    },
  })

  const form = useForm({
    defaultValues: { number: "", date: "", total: "" },
    onSubmit: ({ value }) => {
      if (value.number.trim() === "" || value.total.trim() === "") {
        return
      }
      record.mutate(value)
    },
  })

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
      <form
        className="flex flex-col gap-2 px-4 py-3"
        onSubmit={(event) => {
          event.preventDefault()
          void form.handleSubmit()
        }}
      >
        <form.Field name="number">
          {(field) => (
            <Input
              value={field.state.value}
              placeholder="Invoice number"
              className="h-(--tap)"
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.target.value)}
            />
          )}
        </form.Field>
        <div className="flex gap-2">
          <form.Field name="date">
            {(field) => (
              <Input
                value={field.state.value}
                type="date"
                className="h-(--tap) flex-1"
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
              />
            )}
          </form.Field>
          <form.Field name="total">
            {(field) => (
              <Input
                value={field.state.value}
                inputMode="numeric"
                placeholder="Total (rupiah)"
                className="h-(--tap) flex-1 font-mono"
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
              />
            )}
          </form.Field>
        </div>
        <Button
          type="submit"
          variant="secondary"
          className="h-(--tap)"
          disabled={record.isPending}
        >
          Record invoice
        </Button>
        <Problem error={record.error} />
      </form>
    </Panel>
  )
}
