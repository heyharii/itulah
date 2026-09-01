import { useForm } from "@tanstack/react-form"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { PackageSearch } from "lucide-react"

import { PageContent } from "@/components/shell/app-shell"
import { AppLink } from "@/components/ui/app-link"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { RecordBody, RecordCard, RecordHead } from "@/components/ui/record-card"
import { Banner, EmptyState, Problem, Receipt } from "@/components/ui/states"
import { dc } from "@/lib/api"
import { ago, count } from "@/lib/format"
import { keys } from "@/lib/queries/keys"
import { queryState } from "@/lib/query-state"
import { useActor } from "@/lib/session"
import { useSheet } from "@/lib/sheets"
import { idempotencyKey } from "@itulah/contract/client"
import type { PurchaseWorkLine } from "@itulah/contract"

/// The checker's screen — and what it does **not** show is the design.
///
/// No ordered quantity. No earlier count. No progress bar against a target.
/// The wire does not carry them either: `PurchaseWorkLine.expected_stock_units`
/// is null on this view and is populated only for the verifier. A count taken
/// while looking at the number it is supposed to produce is not evidence of
/// anything; it is a confirmation of the paperwork.
///
/// A count is a document, not a movement. Nothing on this screen becomes
/// stock — that happens when somebody else accepts it, one station along.
export function CountDelivery() {
  const receipt = useSheet("receipt")

  const work = useQuery({
    queryKey: keys.purchaseWork(),
    queryFn: ({ signal }) => dc.purchaseWork(signal),
  })

  const receipts = useQuery({
    queryKey: keys.receipts(),
    queryFn: ({ signal }) => dc.goodsReceipts(signal),
  })

  const open = receipts.data ?? []
  const chosen = open.find((row) => row.receipt_id === receipt.value) ?? null

  return (
    <PageContent>
      <PageHeader
        crumb="Intake"
        title="Count"
        sub="Write down what physically arrived. You are not shown what was ordered."
      />

      <Card className="mb-[1.125rem] overflow-hidden">
        <CardHeader>
          <CardTitle>Which delivery</CardTitle>
          {chosen && (
            <span className="font-mono text-id text-body">
              {chosen.receipt_number}
            </span>
          )}
        </CardHeader>
        <div className="border-t border-hairline">
          {queryState(receipts, {
            loading: "Reading the bay…",
            render: () =>
              open.length === 0 ? (
                <EmptyState
                  action={
                    <AppLink to="/intake" variant="soft">
                      Open one
                    </AppLink>
                  }
                >
                  Nothing is open on the bay. A count hangs off a delivery
                  document, so one has to be opened before anything can be
                  counted against it.
                </EmptyState>
              ) : (
                open.map((row) => (
                  <button
                    key={row.receipt_id}
                    type="button"
                    onClick={() => receipt.open(row.receipt_id)}
                    className={`flex min-h-tap w-full items-center gap-3 border-b border-hairline px-4 py-2.5 text-left transition-colors last:border-b-0 ${
                      row.receipt_id === receipt.value
                        ? "bg-accent-bg"
                        : "hover:bg-soft"
                    }`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-mono text-id text-ink">
                        {row.receipt_number}
                      </span>
                      <span className="block truncate text-[0.71875rem] text-mute">
                        {row.supplier_id} · arrived {ago(row.arrived_at)}
                      </span>
                    </span>
                    <span className="shrink-0 text-[0.78125rem] text-body tabular-nums">
                      {count(row.counted_lines)} counted
                    </span>
                  </button>
                ))
              ),
          })}
        </div>
      </Card>

      {chosen === null ? (
        <Banner tone="info">
          Choose the delivery you are standing in front of. Every count below is
          written against it, because a truck brings several articles against
          several orders and they are one arrival with one invoice.
        </Banner>
      ) : (
        <>
          <div className="mb-3.5 flex items-baseline justify-between gap-3">
            <h2 className="text-card-title font-semibold text-ink">
              What is still owed
            </h2>
            <span className="text-[0.75rem] text-mute">
              {count(work.data?.length ?? 0)} lines
            </span>
          </div>
          {queryState(work, {
            loading: "Reading the order lines…",
            render: (lines) =>
              lines.length === 0 ? (
                <EmptyState>
                  This DC owes no supplier delivery against any open order.
                </EmptyState>
              ) : (
                <div className="flex flex-col gap-3">
                  {lines.map((line) => (
                    <CountLine
                      key={line.po_line_id}
                      line={line}
                      receiptId={chosen.receipt_id}
                    />
                  ))}
                </div>
              ),
          })}
        </>
      )}
    </PageContent>
  )
}

/// One purchase line, and the box the checker writes their number into.
///
/// A form of its own per line rather than one map of values for the screen: a
/// line is submitted on its own, cleared on its own, and the number typed
/// against it belongs to nothing else on the page. It is also what lets the
/// keyboard's Enter mean "record this line" rather than "record whichever line
/// the browser thinks is first".
function CountLine({
  line,
  receiptId,
}: {
  line: PurchaseWorkLine
  receiptId: string
}) {
  const actor = useActor()
  const client = useQueryClient()

  const record = useMutation({
    mutationFn: (quantity: number) =>
      dc.countPurchase({
        receipt_id: receiptId,
        po_line_id: line.po_line_id,
        counted_quantity: quantity,
        actor_id: actor,
        // A count recorded twice is a second document a verifier has to
        // decide, against goods that only arrived once.
        idempotency_key: idempotencyKey(),
      }),
    onSuccess: () => {
      form.reset()
      // The count joins the verifier's queue and changes the delivery's own
      // counted-lines tally — two lists on two screens, both stale otherwise.
      void client.invalidateQueries({ queryKey: keys.verifyQueue() })
      void client.invalidateQueries({ queryKey: keys.receipts() })
      void client.invalidateQueries({ queryKey: keys.purchaseWork() })
    },
  })

  const form = useForm({
    defaultValues: { quantity: "" },
    onSubmit: ({ value }) => {
      const quantity = Number(value.quantity)
      if (!Number.isInteger(quantity) || quantity < 0) return
      record.mutate(quantity)
    },
  })

  return (
    <RecordCard>
      <RecordHead
        tile={<PackageSearch />}
        id={line.article_code}
        title={`${line.article_name} · ${line.po_number} line ${line.line_number}`}
        status={
          line.received_stock_units > 0 ? (
            <Pill tone="ok">{count(line.received_stock_units)} in</Pill>
          ) : undefined
        }
      />
      <RecordBody>
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            form.handleSubmit()
          }}
        >
          <form.Field name="quantity">
            {(field) => (
              <Input
                className="w-32 text-center text-[1.125rem] font-semibold"
                inputMode="numeric"
                autoComplete="off"
                placeholder="0"
                aria-label={`Counted pieces of ${line.article_code}`}
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value)}
              />
            )}
          </form.Field>
          <span className="text-[0.78125rem] text-body">pieces counted</span>
          <div className="flex-1" />
          <Button variant="dark" type="submit" disabled={record.isPending}>
            {record.isPending ? "Recording…" : "Record"}
          </Button>
        </form>

        {record.isSuccess && record.data && (
          <Receipt className="mt-2.5">
            {count(record.data.counted_quantity)} pieces recorded at{" "}
            {record.data.counted_at.slice(11, 16)}. It is now waiting for
            somebody else to verify — you cannot verify your own count.
          </Receipt>
        )}
        <Problem error={record.error} className="mt-2.5" />
      </RecordBody>
    </RecordCard>
  )
}
