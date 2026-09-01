import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Input } from "@/components/ui/field"
import { Meter } from "@/components/ui/meter"
import { PageHeader } from "@/components/ui/page-header"
import { Banner, EmptyState, ErrorState } from "@/components/ui/states"
import { Tag } from "@/components/ui/tag"
import { count, day, money } from "@/lib/format"
import {
  commercialKeys,
  commercialUsage,
  publishUsageToFleet,
  type PromotionUsage,
  type UsageReceipt,
} from "@/lib/queries/commercial"
import { queryState } from "@/lib/query-state"
import { tableSetup, type TableSetup } from "@/lib/table"
import { consumed, percent, useActor } from "@/screens/commercial/shared"

/// What promotions have actually given away, against what they were allowed to.
///
/// Two numbers from two places, joined by the server and nowhere else. The
/// count is an **observation** — built only from sale facts the centre has
/// already accepted, so it inherits their idempotency — and the limit is a
/// **decision**, frozen with the price book that declared it. A screen that
/// recomputed either would be asserting something neither the tills nor the
/// books said.
///
/// A budget is a brake, not a gate. Every shop enforces from the last count it
/// received, so what a till knows is always behind; the figure that must not be
/// exceeded is the one on this screen, and sending it often is what keeps the
/// brake close to the truth.

/// `null` budget is unlimited. Sorted below everything with a limit, because
/// "no line to cross" is never the row somebody has to act on.
const UNLIMITED = -1

const columns: ColumnDef<TableSetup, PromotionUsage>[] = [
  {
    id: "promotion",
    accessorFn: (row) => row.name ?? row.key,
    header: "Promotion",
    size: 260,
    cell: ({ row }) => (
      <span className="font-medium text-ink">
        {row.original.name ?? row.original.key}
      </span>
    ),
  },
  {
    accessorKey: "kind",
    header: "Kind",
    size: 110,
    cell: ({ row }) => <Tag>{row.original.kind}</Tag>,
  },
  {
    accessorKey: "uses",
    header: "Uses",
    size: 90,
    meta: { align: "right" },
    cell: ({ row }) => count(row.original.uses),
  },
  {
    accessorKey: "customer_count",
    header: "Customers",
    size: 100,
    meta: { align: "right" },
    cell: ({ row }) => count(row.original.customer_count),
  },
  {
    accessorKey: "spent_minor",
    header: "Given away",
    size: 140,
    meta: { align: "right" },
    cell: ({ row }) => money(row.original.spent_minor),
  },
  {
    accessorKey: "budget_minor",
    header: "Budget",
    size: 140,
    meta: { align: "right" },
    cell: ({ row }) =>
      row.original.budget_minor === null ? (
        <span className="text-mute">Unlimited</span>
      ) : (
        money(row.original.budget_minor)
      ),
  },
  {
    id: "consumed",
    accessorFn: (row) =>
      consumed(row.spent_minor, row.budget_minor) ?? UNLIMITED,
    header: "Budget gone",
    size: 150,
    // The decision metric, and why this list sorts by it: a promotion at
    // ninety-something per cent of its budget is the one somebody has to stop,
    // pause or top up before the weekend.
    cell: ({ row }) => {
      const share = consumed(
        row.original.spent_minor,
        row.original.budget_minor
      )
      if (share === null) return <span className="text-mute">No limit</span>
      const bps = Math.round(share * 10_000)
      return (
        <span className="flex items-center gap-2">
          <Meter
            value={share}
            tone={share >= 0.9 ? "bad" : share >= 0.7 ? "warn" : "accent"}
          />
          <span
            className={
              share >= 0.9
                ? "shrink-0 font-medium text-bad-fg tabular-nums"
                : "shrink-0 text-body tabular-nums"
            }
          >
            {percent(bps)}
          </span>
        </span>
      )
    },
  },
  {
    id: "left",
    accessorFn: (row) =>
      row.budget_minor === null
        ? UNLIMITED
        : row.budget_minor - row.spent_minor,
    header: "Left",
    size: 140,
    meta: { align: "right" },
    // Integer subtraction of two minor amounts, which is exact — no float ever
    // touches a rupiah here. The server does not send this because it is not a
    // fact it holds; it is the difference between two facts it does.
    cell: ({ row }) => {
      if (row.original.budget_minor === null)
        return <span className="text-mute">—</span>
      const left = row.original.budget_minor - row.original.spent_minor
      return (
        <span className={left <= 0 ? "font-medium text-bad-fg" : "text-text"}>
          {money(left)}
        </span>
      )
    },
  },
  {
    accessorKey: "last_used_at",
    header: "Last used",
    size: 130,
    cell: ({ row }) => day(row.original.last_used_at),
  },
]

export function Promotions() {
  const client = useQueryClient()
  const actor = useActor()
  const [query, setQuery] = useState("")
  const [receipt, setReceipt] = useState<UsageReceipt | null>(null)
  const [sorting, setSorting] = useState<SortingState>([
    { id: "consumed", desc: true },
  ])

  const usage = useQuery({
    queryKey: commercialKeys.usage(),
    queryFn: ({ signal }) => commercialUsage(signal),
  })

  const rows = useMemo(() => usage.data ?? [], [usage.data])

  // One key per screen, held across retries: a double-clicked Send dispatches
  // one command and gets the same receipt twice.
  const idempotencyKey = useMemo(() => crypto.randomUUID(), [])

  const send = useMutation({
    mutationFn: () => publishUsageToFleet(actor, idempotencyKey),
    onSuccess: (result) => {
      setReceipt(result)
      // Sending does not change what has been given away — these counts come
      // from sales, not from dispatches. The read is refreshed anyway, and only
      // for this reason: the receipt names a moment, and it should describe the
      // figures now on the screen rather than a list somebody has been looking
      // at for an hour.
      client.invalidateQueries({ queryKey: commercialKeys.usage() })
    },
  })

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns,
        getRowId: (row: PromotionUsage) => `${row.kind}:${row.key}`,
        state: { globalFilter: query, sorting },
        onSortingChange: setSorting,
        onGlobalFilterChange: setQuery,
      }),
      [rows, query, sorting]
    )
  )

  const overspent = rows.filter(
    (row) => row.budget_minor !== null && row.spent_minor >= row.budget_minor
  )

  return (
    <PageContent>
      <PageHeader
        crumb="Commercial"
        title="Promotions"
        sub="What each offer has cost, against what it was allowed to. A budget is a brake, not a gate — every shop enforces from the last count it was sent."
        actions={
          <>
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search"
              className="h-8 w-48"
            />
            <Button
              variant="dark"
              disabled={send.isPending || actor === ""}
              onClick={() => send.mutate()}
            >
              {send.isPending ? "Sending…" : "Send counts to shops"}
            </Button>
          </>
        }
      />

      {send.isError && (
        <div className="mb-4">
          <ErrorState error={send.error} />
        </div>
      )}

      {receipt && (
        <Banner tone="ok" className="mb-4" onDismiss={() => setReceipt(null)}>
          Counts as at {day(receipt.counted_at)} sent to{" "}
          {count(receipt.sent_to.length)} shop
          {receipt.sent_to.length === 1 ? "" : "s"}. Until each one takes the
          message, it is still enforcing from the count before this.
        </Banner>
      )}

      {overspent.length > 0 && (
        <Banner tone="bad" className="mb-4">
          {count(overspent.length)} promotion
          {overspent.length === 1 ? " has" : "s have"} reached or passed the
          budget declared for {overspent.length === 1 ? "it" : "them"}. Shops
          stop applying an offer only once they have been told, so send the
          counts before doing anything else.
        </Banner>
      )}

      <Card className="overflow-hidden">
        {queryState(usage, {
          loading: "Counting what has been given away…",
          render: () =>
            rows.length === 0 ? (
              <EmptyState>
                No promotion has been used yet. A rule that has never fired has
                nothing to count, so it is absent here rather than shown at
                zero.
              </EmptyState>
            ) : (
              <DataTable<PromotionUsage>
                table={table}
                empty="No promotion matches that search."
                className="max-h-[calc(100vh-15rem)]"
              />
            ),
        })}
      </Card>
    </PageContent>
  )
}
