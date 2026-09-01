import { useForm } from "@tanstack/react-form"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { ColumnDef } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { useMemo } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Field, Input, Select, Textarea } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Segmented } from "@/components/ui/segmented"
import { Banner, EmptyState, Problem, Receipt } from "@/components/ui/states"
import { Tag } from "@/components/ui/tag"
import { dc, poolsAnswer } from "@/lib/api"
import { clock, count, label } from "@/lib/format"
import { keys } from "@/lib/queries/keys"
import { queryState } from "@/lib/query-state"
import { useActor } from "@/lib/session"
import { useSheet } from "@/lib/sheets"
import { tableSetup, type TableSetup } from "@/lib/table"
import { idempotencyKey } from "@itulah/contract/client"
import type { MovementCause, MovementView } from "@itulah/contract"

/// The ledger: what happened to the stock, newest first.
///
/// It is **append-only**. A mistake is corrected by another movement that says
/// what it is correcting, never by editing the one before it — which is why
/// the correction form on this screen demands a reason and a cause rather than
/// offering an edit.
///
/// The causes offered are deliberately a subset. The full list is wider —
/// sales, tagging, counts — but those are written by the operation that caused
/// them, and offering them here would let somebody file a sale that never
/// happened.
const CAUSES: readonly MovementCause[] = [
  "NORMAL_MOVE",
  "PLACEMENT_CORRECTION",
  "RETURN_TO_DC",
  "FOUND",
]

/// How many movements to read. The node caps at 500, and the URL carries the
/// choice so "show me the last five hundred" is a link somebody can send.
const DEPTHS = [
  { value: "100", label: "100" },
  { value: "250", label: "250" },
  { value: "500", label: "500" },
] as const

const columns: ColumnDef<TableSetup, MovementView>[] = [
  {
    accessorKey: "occurred_at",
    header: "When",
    size: 110,
    cell: ({ row }) => (
      <span className="text-body tabular-nums">
        {clock(row.original.occurred_at)}
      </span>
    ),
  },
  {
    accessorKey: "cause",
    header: "Cause",
    size: 170,
    cell: ({ row }) => <Tag>{row.original.cause}</Tag>,
  },
  {
    accessorKey: "epc",
    header: "Tag",
    size: 230,
    cell: ({ row }) => (
      <span className="font-mono text-id text-body">{row.original.epc}</span>
    ),
  },
  {
    id: "route",
    accessorFn: (row) => `${row.from} → ${row.to}`,
    header: "From → to",
    size: 340,
    cell: ({ row }) => (
      <span className="font-mono text-[0.65625rem] text-body">
        {row.original.from} <span className="text-faint">→</span>{" "}
        <span className="text-ink">{row.original.to}</span>
      </span>
    ),
  },
  {
    accessorKey: "quantity",
    header: "Qty",
    size: 80,
    meta: { align: "right" },
    cell: ({ row }) => count(row.original.quantity),
  },
  {
    accessorKey: "actor_id",
    header: "By",
    size: 120,
    cell: ({ row }) => (
      <span className="text-body">{row.original.actor_id}</span>
    ),
  },
]

export function Ledger() {
  const depth = useSheet("depth")
  // A fixed set on purpose, so a hand-edited URL cannot ask the node for a
  // page size it will refuse — `?depth=all` is a 400 dressed up as a link.
  const limit = Number(depth.value ?? "100")

  const movements = useQuery({
    queryKey: keys.movements(limit),
    queryFn: ({ signal }) => dc.movements(limit, signal),
  })

  const rows = useMemo(() => movements.data ?? [], [movements.data])

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns,
        getRowId: (row: MovementView) => row.movement_id,
      }),
      [rows]
    )
  )

  return (
    <PageContent>
      <PageHeader
        crumb="Counting"
        title="Ledger"
        sub="Every movement this node has written, newest first."
        actions={
          <Segmented
            value={depth.value ?? "100"}
            onChange={(value) => depth.replace(value)}
            options={DEPTHS}
          />
        }
      />

      <div className="grid gap-[1.125rem] xl:grid-cols-[minmax(0,1fr)_23rem] xl:items-start">
        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle>Movements</CardTitle>
            <span className="text-[0.75rem] text-mute">
              {count(rows.length)} of the last {count(limit)}
            </span>
          </CardHeader>
          {queryState(movements, {
            loading: "Reading the ledger…",
            render: () =>
              rows.length === 0 ? (
                <EmptyState>Nothing has moved on this node yet.</EmptyState>
              ) : (
                <DataTable<MovementView>
                  table={table}
                  // A history read with a mouse, not pressed with a thumb —
                  // the six pixels a row buy real rows on screen here.
                  touch={false}
                  className="max-h-[calc(100vh-16rem)]"
                />
              ),
          })}
        </Card>

        <Correction />
      </div>
    </PageContent>
  )
}

/// A movement written by hand, between two pools this node owns.
///
/// Nothing here edits a number. It writes a movement, and the ledger is the
/// only record it leaves — which is why a correction has to say what it is
/// correcting.
function Correction() {
  const actor = useActor()
  const client = useQueryClient()

  const answer = useQuery({
    queryKey: keys.pools(),
    queryFn: ({ signal }) => poolsAnswer(signal),
  })

  // Leaves only. A rollup is a sum, not a place, and stock cannot be moved
  // into a total.
  const pools = (answer.data?.items ?? []).filter((pool) => !pool.is_rollup)

  const move = useMutation({
    mutationFn: (value: {
      epc: string
      quantity: string
      from: string
      to: string
      cause: string
      reason: string
    }) =>
      dc.move({
        epc: value.epc.trim().toUpperCase(),
        quantity: Number(value.quantity),
        from: value.from,
        to: value.to,
        cause: value.cause as MovementCause,
        reason: value.reason.trim(),
        actor_id: actor,
        // A correction applied twice moves the piece twice, and the second
        // move is from a pool it is no longer in — which the node refuses,
        // leaving somebody staring at an error for a write that worked.
        idempotency_key: idempotencyKey(),
        reference_type: null,
        reference_id: null,
      }),
    onSuccess: () => {
      form.reset()
      void client.invalidateQueries({ queryKey: keys.pools() })
      void client.invalidateQueries({ queryKey: ["inventory", "movements"] })
    },
  })

  const form = useForm({
    defaultValues: {
      epc: "",
      quantity: "1",
      from: "",
      to: "",
      cause: "NORMAL_MOVE" as string,
      reason: "",
    },
    onSubmit: ({ value }) => {
      if (
        value.epc.trim() === "" ||
        value.from === "" ||
        value.to === "" ||
        value.reason.trim() === ""
      )
        return
      move.mutate(value)
    },
  })

  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle>Correct a placement</CardTitle>
      </CardHeader>
      <Banner tone="warn" className="mx-4 mt-2">
        The ledger is append-only. This writes a new movement saying what it
        corrects; it does not change the one before it.
      </Banner>
      <form
        className="flex flex-col gap-3 px-4 py-3.5"
        onSubmit={(event) => {
          event.preventDefault()
          form.handleSubmit()
        }}
      >
        <form.Field name="epc">
          {(field) => (
            <Field label="Tag">
              <Input
                className="font-mono"
                autoCapitalize="off"
                autoCorrect="off"
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value)}
              />
            </Field>
          )}
        </form.Field>

        <form.Field name="from">
          {(field) => (
            <Field label="From">
              <Select
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value)}
              >
                <option value="">Choose a pool</option>
                {pools.map((pool) => (
                  <option key={pool.id} value={pool.id}>
                    {pool.label}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </form.Field>

        <form.Field name="to">
          {(field) => (
            <Field label="To">
              <Select
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value)}
              >
                <option value="">Choose a pool</option>
                {pools.map((pool) => (
                  <option key={pool.id} value={pool.id}>
                    {pool.label}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </form.Field>

        <div className="flex gap-3">
          <form.Field name="quantity">
            {(field) => (
              <Field label="Pieces" className="w-24">
                <Input
                  inputMode="numeric"
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
              </Field>
            )}
          </form.Field>
          <form.Field name="cause">
            {(field) => (
              <Field label="Cause" className="flex-1">
                <Select
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                >
                  {CAUSES.map((cause) => (
                    <option key={cause} value={cause}>
                      {label(cause)}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
          </form.Field>
        </div>

        <form.Field name="reason">
          {(field) => (
            <Field
              label="What this corrects"
              hint="Read by whoever audits this movement, months from now."
            >
              <Textarea
                rows={2}
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value)}
              />
            </Field>
          )}
        </form.Field>

        {move.isSuccess && <Receipt>The movement is in the ledger.</Receipt>}
        <Problem error={move.error} />

        <Button variant="dark" type="submit" disabled={move.isPending}>
          {move.isPending ? "Writing…" : "Write the movement"}
        </Button>
      </form>
    </Card>
  )
}
