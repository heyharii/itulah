import { useQuery } from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { AppLink } from "@/components/ui/app-link"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { Progress } from "@/components/ui/progress"
import { KeyValue } from "@/components/ui/rows"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { Banner, EmptyState } from "@/components/ui/states"
import { Lifecycle } from "@/components/ui/timeline"
import { dc } from "@/lib/api"
import { clock, count, day, label, toneFor, variance } from "@/lib/format"
import { keys } from "@/lib/operations/keys"
import { queryState } from "@/lib/query-state"
import { useSheet } from "@/lib/sheets"
import { tableSetup, type TableSetup } from "@/lib/table"
import type { EdgeOfficialCountSummary } from "@itulah/contract"

/// Official counts: authored and activated at the centre, executed here.
///
/// A difference is not a fact until the count is **submitted**, and it does
/// not become an adjustment until the centre **approves** it. So this screen
/// lists and reads; the scanning lives on the count sheet, and nothing on
/// either of them writes stock.
const columns: ColumnDef<TableSetup, EdgeOfficialCountSummary>[] = [
  {
    accessorKey: "pool_id",
    header: "Pool",
    size: 220,
    cell: ({ row }) => (
      <span className="min-w-0">
        <span className="block truncate font-medium text-ink">
          {row.original.pool_id}
        </span>
        <span className="block truncate text-[0.65625rem] text-mute">
          {row.original.reason}
        </span>
      </span>
    ),
  },
  {
    accessorKey: "kind",
    header: "Kind",
    size: 110,
    cell: ({ row }) => label(row.original.kind),
  },
  {
    accessorKey: "status",
    header: "Status",
    size: 130,
    cell: ({ row }) => (
      <Pill tone={toneFor(row.original.status)}>
        {label(row.original.status)}
      </Pill>
    ),
  },
  {
    accessorKey: "expected",
    header: "Expected",
    size: 100,
    meta: { align: "right" },
    cell: ({ row }) => count(row.original.expected),
  },
  {
    accessorKey: "found",
    header: "Found",
    size: 100,
    meta: { align: "right" },
    cell: ({ row }) => count(row.original.found),
  },
  {
    id: "difference",
    accessorFn: (row) => Math.abs(row.found - row.expected),
    header: "Difference",
    size: 110,
    meta: { align: "right" },
    // The decision metric, and the default sort. A count that agrees is a
    // count somebody submits; a count that does not is a count somebody walks
    // the racks for a second time.
    cell: ({ row }) => {
      const diff = row.original.found - row.original.expected
      return (
        <span
          className={diff === 0 ? "text-mute" : "font-semibold text-bad-fg"}
        >
          {variance(diff)}
        </span>
      )
    },
  },
  {
    accessorKey: "activated_at",
    header: "Activated",
    size: 130,
    cell: ({ row }) => day(row.original.activated_at),
  },
]

export function Counts() {
  const count_ = useSheet("count")
  const [sorting, setSorting] = useState<SortingState>([
    { id: "difference", desc: true },
  ])

  const counts = useQuery({
    queryKey: keys.counts(),
    queryFn: ({ signal }) => dc.officialCounts(signal),
  })

  const rows = useMemo(() => counts.data ?? [], [counts.data])
  const open = rows.filter((row) => row.submitted_at === null)

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns,
        getRowId: (row: EdgeOfficialCountSummary) => row.count_id,
        state: { sorting },
        onSortingChange: setSorting,
      }),
      [rows, sorting]
    )
  )

  return (
    <PageContent>
      <PageHeader
        crumb="Counting"
        title="Counts"
        sub="Activated by the centre, executed here, approved there."
      />

      {open.length > 0 && (
        <Banner tone="warn" className="mb-[1.125rem]">
          {count(open.length)} count{open.length === 1 ? "" : "s"} activated and
          not yet submitted. Until a count is submitted its difference is not a
          fact — it is somebody's afternoon.
        </Banner>
      )}

      <Card className="overflow-hidden">
        {queryState(counts, {
          loading: "Reading the counts…",
          render: () =>
            rows.length === 0 ? (
              <EmptyState>
                The centre has not activated a count for this node. Counts are
                authored there, never here.
              </EmptyState>
            ) : (
              <DataTable<EdgeOfficialCountSummary>
                table={table}
                touch
                onRowClick={(row) => count_.open(row.count_id)}
                isSelected={(row) => row.count_id === count_.value}
                className="max-h-[calc(100vh-18rem)]"
              />
            ),
        })}
      </Card>

      <CountSheet id={count_.value ?? null} onClose={count_.close} />
    </PageContent>
  )
}

/// One count, where it is in its life, and the way in to executing it.
function CountSheet({
  id,
  onClose,
}: {
  id: string | null
  onClose: () => void
}) {
  const detail = useQuery({
    queryKey: keys.count(id ?? ""),
    queryFn: ({ signal }) => dc.officialCount(id!, signal),
    enabled: id !== null,
  })

  return (
    <Sheet
      open={id !== null}
      onOpenChange={(open) => !open && onClose()}
      id={detail.data?.summary.pool_id}
      title={detail.data?.summary.reason ?? "Count"}
    >
      {queryState(detail, {
        loading: "Reading the count…",
        render: (record) => {
          const summary = record.summary
          const diff = summary.found - summary.expected
          return (
            <div className="flex flex-col gap-5">
              <div>
                <Pill tone={toneFor(summary.status)}>
                  {label(summary.status)}
                </Pill>
              </div>

              {/* Where it is on a fixed track. The current step is the one
                  dark mark on the screen, because it is a position rather
                  than something to press. */}
              <Lifecycle
                steps={[
                  { label: "Activated", state: "done" },
                  {
                    label: "Counting",
                    state: summary.submitted_at === null ? "current" : "done",
                  },
                  {
                    label: "Submitted",
                    state:
                      summary.submitted_at === null
                        ? "todo"
                        : summary.closed_at === null
                          ? "current"
                          : "done",
                  },
                  {
                    label: "Approved",
                    state: summary.closed_at === null ? "todo" : "done",
                  },
                ]}
              />

              <Progress
                label="Counted"
                value={summary.found}
                of={summary.expected}
                tone={diff === 0 ? "ok" : "warn"}
                detail={`${count(summary.found)}/${count(summary.expected)}`}
              />

              <Facts>
                <Fact term="Pool">{summary.pool_id}</Fact>
                <Fact term="Kind">{label(summary.kind)}</Fact>
                <Fact term="Activated">{clock(summary.activated_at)}</Fact>
                <Fact term="Submitted">
                  {summary.submitted_at === null
                    ? "not yet"
                    : clock(summary.submitted_at)}
                </Fact>
                <Fact term="Raised by">{summary.created_by}</Fact>
                <Fact term="Scope">
                  {summary.scope.sku_codes.length > 0
                    ? `${count(summary.scope.sku_codes.length)} SKUs`
                    : summary.scope.epcs.length > 0
                      ? `${count(summary.scope.epcs.length)} tags`
                      : "the whole pool"}
                </Fact>
              </Facts>

              <div>
                <h4 className="mb-2 text-card-title font-semibold text-ink">
                  What the count found
                </h4>
                <KeyValue term="Matched">{count(summary.match_epcs)}</KeyValue>
                <KeyValue term="Short">{count(summary.shortage_epcs)}</KeyValue>
                <KeyValue term="Extra">{count(summary.gain_epcs)}</KeyValue>
                <KeyValue term="Difference">
                  <span className={diff === 0 ? "text-mute" : "text-bad-fg"}>
                    {variance(diff)}
                  </span>
                </KeyValue>
              </div>

              {summary.adjustment_status !== null && (
                <Banner tone="info">
                  The centre has this one: adjustment{" "}
                  {label(summary.adjustment_status)}. Approving it is what turns
                  the difference into a movement, and that does not happen here.
                </Banner>
              )}

              {summary.submitted_at === null && (
                <AppLink
                  to="/operations/counting/sheet"
                  sheet={{ key: "count", value: summary.count_id }}
                  variant="dark"
                >
                  Open the count sheet
                </AppLink>
              )}
            </div>
          )
        },
      })}
    </Sheet>
  )
}
