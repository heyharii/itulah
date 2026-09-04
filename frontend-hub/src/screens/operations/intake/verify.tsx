import { useForm } from "@tanstack/react-form"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { AppLink } from "@/components/ui/app-link"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Field, Money, Textarea } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import {
  Banner,
  EmptyState,
  LoadingState,
  Problem,
  Receipt,
} from "@/components/ui/states"
import { dc } from "@/lib/api"
import { clock, count, money, variance } from "@/lib/format"
import { keys } from "@/lib/operations/keys"
import { queryState } from "@/lib/query-state"
import { useEdgeActor } from "@/lib/edge-session"
import { useSheet } from "@/lib/sheets"
import { tableSetup, type TableSetup } from "@/lib/table"
import { idempotencyKey } from "@itulah/contract/client"
import type { PurchaseCountAwaitingVerification } from "@itulah/contract"

/// The verifier's screen — everything the checker was not shown.
///
/// The two views are deliberately different shapes on the wire as well as on
/// screen: a checker is *counting* and a verifier is *comparing*, against the
/// count in front of them and the supplier's invoice that arrived on the same
/// lorry as the goods.
///
/// **Accepting is the moment the goods first exist as stock.** There is no
/// field for a quantity of the verifier's own, and that is on purpose:
/// somebody who can both approve a delivery and decide what it was has the
/// whole control to themselves.
const columns: ColumnDef<TableSetup, PurchaseCountAwaitingVerification>[] = [
  {
    accessorKey: "article_code",
    header: "Article",
    size: 210,
    cell: ({ row }) => (
      <span className="min-w-0">
        <span className="block truncate font-medium text-ink">
          {row.original.article_name}
        </span>
        <span className="block truncate font-mono text-[0.65625rem] text-mute">
          {row.original.article_code}
        </span>
      </span>
    ),
  },
  {
    accessorKey: "po_number",
    header: "Order",
    size: 130,
    cell: ({ row }) => (
      <span className="font-mono text-id text-body">
        {row.original.po_number}
      </span>
    ),
  },
  {
    accessorKey: "expected_stock_units",
    header: "Ordered",
    size: 100,
    meta: { align: "right" },
    cell: ({ row }) => count(row.original.expected_stock_units),
  },
  {
    accessorKey: "counted_quantity",
    header: "Counted",
    size: 100,
    meta: { align: "right" },
    cell: ({ row }) => (
      <span className="font-medium text-ink">
        {count(row.original.counted_quantity)}
      </span>
    ),
  },
  {
    id: "variance",
    accessorFn: (row) => Math.abs(row.variance),
    header: "Difference",
    size: 110,
    meta: { align: "right" },
    // The decision metric, and the default sort. A zero is somebody pressing
    // Accept; anything else is somebody walking back to the pallet.
    cell: ({ row }) => {
      const value = row.original.variance
      return (
        <span
          className={value === 0 ? "text-mute" : "font-semibold text-bad-fg"}
        >
          {variance(value)}
        </span>
      )
    },
  },
  {
    accessorKey: "unit_price_minor",
    header: "Agreed price",
    size: 130,
    meta: { align: "right" },
    cell: ({ row }) => money(row.original.unit_price_minor),
  },
  {
    accessorKey: "counted_by",
    header: "Counted by",
    size: 130,
    cell: ({ row }) => (
      <span className="text-body">{row.original.counted_by}</span>
    ),
  },
]

export function Verify() {
  const chosen = useSheet("verify")
  const [sorting, setSorting] = useState<SortingState>([
    { id: "variance", desc: true },
  ])

  const queue = useQuery({
    queryKey: keys.verifyQueue(),
    queryFn: ({ signal }) => dc.countsAwaitingVerification(signal),
  })

  const rows = useMemo(() => queue.data ?? [], [queue.data])

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns,
        getRowId: (row: PurchaseCountAwaitingVerification) => row.count_id,
        state: { sorting },
        onSortingChange: setSorting,
      }),
      [rows, sorting]
    )
  )

  const disagreeing = rows.filter((row) => row.variance !== 0).length

  return (
    <PageContent>
      <PageHeader
        crumb="Intake"
        title="Verify"
        sub="Accepting is what puts the goods on the shelf. It cannot be your own count."
      />

      {disagreeing > 0 && (
        <Banner tone="warn" className="mb-[1.125rem]">
          {count(disagreeing)} of {count(rows.length)} counts disagree with what
          was ordered. A difference is not a reason to hold the delivery —
          accept it, and the query goes to whoever raised the order.
        </Banner>
      )}

      <Card className="overflow-hidden">
        {queryState(queue, {
          loading: "Reading the queue…",
          render: () =>
            rows.length === 0 ? (
              <EmptyState
                action={
                  <AppLink to="/operations/intake/count" variant="soft">
                    Go and count something
                  </AppLink>
                }
              >
                Nothing is waiting for a verifier. Every count on this node has
                been decided.
              </EmptyState>
            ) : (
              <DataTable<PurchaseCountAwaitingVerification>
                table={table}
                touch
                onRowClick={(row) => chosen.open(row.count_id)}
                isSelected={(row) => row.count_id === chosen.value}
                className="max-h-[calc(100vh-18rem)]"
              />
            ),
        })}
      </Card>

      <VerifySheet id={chosen.value ?? null} onClose={chosen.close} />
    </PageContent>
  )
}

/// The decision, and the two things a verifier may add: the price the invoice
/// actually asked for, and the reason for a recount.
function VerifySheet({
  id,
  onClose,
}: {
  id: string | null
  onClose: () => void
}) {
  const actor = useEdgeActor()
  const client = useQueryClient()

  const queue = useQuery({
    queryKey: keys.verifyQueue(),
    queryFn: ({ signal }) => dc.countsAwaitingVerification(signal),
  })
  const record = (queue.data ?? []).find((row) => row.count_id === id)

  const decide = useMutation({
    mutationFn: (input: {
      decision: "Accept" | "Recount"
      invoiced: string
      note: string
    }) =>
      dc.verifyPurchase({
        count_id: id!,
        verifier_actor_id: actor,
        decision: input.decision,
        note: input.note.trim() === "" ? null : input.note.trim(),
        invoiced_price_minor:
          input.invoiced.trim() === "" ? null : Number(input.invoiced),
        // Accepting writes a movement group: this is the moment stock exists.
        // Applied twice it is twice the goods, so the key is minted once and
        // survives the retry that warehouse wifi guarantees.
        idempotency_key: idempotencyKey(),
      }),
    onSuccess: () => {
      form.reset()
      // Accepted goods become stock, leave the verifier's queue, change the
      // delivery's accepted tally, and appear in the pools and the ledger.
      void client.invalidateQueries({ queryKey: keys.verifyQueue() })
      void client.invalidateQueries({ queryKey: keys.receipts() })
      void client.invalidateQueries({ queryKey: keys.purchaseWork() })
      void client.invalidateQueries({ queryKey: keys.pools() })
      void client.invalidateQueries({ queryKey: ["inventory", "movements"] })
      void client.invalidateQueries({ queryKey: keys.taggingJobs() })
    },
  })

  const form = useForm({
    defaultValues: { invoiced: "", note: "" },
    onSubmit: () => undefined,
  })

  const mine = record !== undefined && record.counted_by === actor

  return (
    <Sheet
      open={id !== null}
      onOpenChange={(open) => !open && onClose()}
      id={record?.po_number}
      title={record?.article_name ?? "Count"}
    >
      {record === undefined ? (
        queue.isPending ? (
          <LoadingState>Reading the queue…</LoadingState>
        ) : (
          <EmptyState>
            That count has already been decided by somebody else.
          </EmptyState>
        )
      ) : (
        <div className="flex flex-col gap-5">
          <div>
            <Pill tone={record.variance === 0 ? "ok" : "bad"}>
              {record.variance === 0
                ? "Agrees with the order"
                : `${variance(record.variance)} against the order`}
            </Pill>
          </div>

          <Facts>
            <Fact term="Article">{record.article_code}</Fact>
            <Fact term="Supplier">{record.supplier_id}</Fact>
            <Fact term="Ordered">{count(record.expected_stock_units)}</Fact>
            <Fact term="Counted">{count(record.counted_quantity)}</Fact>
            <Fact term="Counted by">{record.counted_by}</Fact>
            <Fact term="Counted at">{clock(record.counted_at)}</Fact>
            <Fact term="Agreed price">{money(record.unit_price_minor)}</Fact>
          </Facts>

          {mine && (
            <Banner tone="bad">
              You counted this one. Verifying is a second pair of eyes by
              database constraint, not by policy — the node will refuse it.
            </Banner>
          )}

          <div className="flex flex-col gap-3">
            <form.Field name="invoiced">
              {(field) => (
                <Field
                  label="Price on the invoice"
                  hint="Only if it differs from the agreed price. The goods go in either way; the query goes to the buyer."
                >
                  <Money
                    value={field.state.value}
                    onChange={field.handleChange}
                  />
                </Field>
              )}
            </form.Field>

            <form.Field name="note">
              {(field) => (
                <Field
                  label="Note"
                  hint="Required for a recount, so the checker knows what to look at again."
                >
                  <Textarea
                    rows={2}
                    value={field.state.value}
                    onChange={(event) => field.handleChange(event.target.value)}
                  />
                </Field>
              )}
            </form.Field>
          </div>

          {decide.isSuccess && decide.data && (
            <Receipt>
              {decide.data.decision === "Accept"
                ? `${count(decide.data.accepted_quantity ?? 0)} pieces are now stock in this warehouse.`
                : "Sent back to be counted again."}
              {decide.data.price_amendment_request_id !== null &&
                " The invoice disagreed with the order, so a query is now with the buyer."}
            </Receipt>
          )}
          <Problem error={decide.error} />

          {/* `form.Subscribe` rather than reading `form.state` directly: the
              Recount button is disabled until a note is typed, and a plain
              read does not re-render when it is — so the button stays dead
              under a verifier who has just explained themselves. */}
          <form.Subscribe selector={(state) => state.values}>
            {(values) => (
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="dark"
                  disabled={decide.isPending || mine}
                  onClick={() =>
                    decide.mutate({
                      decision: "Accept",
                      invoiced: values.invoiced,
                      note: values.note,
                    })
                  }
                >
                  Accept {count(record.counted_quantity)} pieces
                </Button>
                <Button
                  variant="ghost"
                  disabled={
                    decide.isPending || mine || values.note.trim() === ""
                  }
                  onClick={() =>
                    decide.mutate({
                      decision: "Recount",
                      invoiced: "",
                      note: values.note,
                    })
                  }
                >
                  Send back to be recounted
                </Button>
              </div>
            )}
          </form.Subscribe>
        </div>
      )}
    </Sheet>
  )
}
