import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { ColumnDef } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { AppLink } from "@/components/ui/app-link"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { ConfirmButton } from "@/components/ui/dialog"
import { Input } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { Progress } from "@/components/ui/progress"
import { ScanField } from "@/components/ui/scan-field"
import { Banner, EmptyState, Problem, Receipt } from "@/components/ui/states"
import { dc } from "@/lib/api"
import { count, label, toneFor, variance } from "@/lib/format"
import { keys } from "@/lib/queries/keys"
import { queryState } from "@/lib/query-state"
import { useActor } from "@/lib/session"
import { useSheet } from "@/lib/sheets"
import { tableSetup, type TableSetup } from "@/lib/table"
import { idempotencyKey } from "@itulah/contract/client"
import type { EdgeOfficialCountLine } from "@itulah/contract"

/// The count sheet — the screen somebody walks the racks with.
///
/// One row per tag the sheet expects, which for a warehouse pool is thousands.
/// It is virtualised, and this is the list that made virtualising worth doing:
/// a handheld asked to lay out that many rows stops responding to the scanner
/// while it does, which is precisely when somebody is scanning.
///
/// A scanned tag the sheet has never heard of arrives with no SKU, so the
/// person has to say what it is — an extra piece found in a pool is exactly
/// the news a count exists to produce, and refusing it would make the sheet a
/// tick-box exercise.
const columns: ColumnDef<TableSetup, EdgeOfficialCountLine>[] = [
  {
    accessorKey: "epc",
    header: "Tag",
    size: 260,
    cell: ({ row }) => (
      <span className="font-mono text-id text-body">{row.original.epc}</span>
    ),
  },
  {
    accessorKey: "sku_code",
    header: "SKU",
    size: 170,
    cell: ({ row }) => (
      <span className="font-mono text-[0.71875rem] text-ink">
        {row.original.sku_code}
      </span>
    ),
  },
  {
    accessorKey: "expected_quantity",
    header: "Expected",
    size: 100,
    meta: { align: "right" },
    cell: ({ row }) => count(row.original.expected_quantity),
  },
  {
    accessorKey: "found_quantity",
    header: "Found",
    size: 100,
    meta: { align: "right" },
    cell: ({ row }) => (
      <span
        className={row.original.found_quantity === 0 ? "text-mute" : "text-ink"}
      >
        {count(row.original.found_quantity)}
      </span>
    ),
  },
  {
    accessorKey: "adjustment_quantity",
    header: "Difference",
    size: 110,
    meta: { align: "right" },
    cell: ({ row }) => {
      const value = row.original.adjustment_quantity
      return (
        <span
          className={value === 0 ? "text-mute" : "font-semibold text-bad-fg"}
        >
          {variance(value)}
        </span>
      )
    },
  },
]

export function CountSheet() {
  const chosen = useSheet("count")

  const counts = useQuery({
    queryKey: keys.counts(),
    queryFn: ({ signal }) => dc.officialCounts(signal),
  })

  const open = (counts.data ?? []).filter((row) => row.submitted_at === null)

  return (
    <PageContent>
      <PageHeader
        crumb="Counting"
        title="Count sheet"
        sub="Scan what is actually on the rack. Nothing here writes stock."
      />

      <Card className="mb-[1.125rem] overflow-hidden">
        <CardHeader>
          <CardTitle>Which count</CardTitle>
        </CardHeader>
        <div className="border-t border-hairline">
          {queryState(counts, {
            loading: "Reading the counts…",
            render: () =>
              open.length === 0 ? (
                <EmptyState
                  action={
                    <AppLink to="/counting" variant="soft">
                      See every count
                    </AppLink>
                  }
                >
                  Nothing is activated and unsubmitted. Counts are authored at
                  the centre, so there is nothing to start from here.
                </EmptyState>
              ) : (
                open.map((row) => (
                  <button
                    key={row.count_id}
                    type="button"
                    onClick={() => chosen.open(row.count_id)}
                    className={`flex min-h-tap w-full items-center gap-3 border-b border-hairline px-4 py-2.5 text-left transition-colors last:border-b-0 ${
                      row.count_id === chosen.value
                        ? "bg-accent-bg"
                        : "hover:bg-soft"
                    }`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-ink">
                        {row.pool_id}
                      </span>
                      <span className="block truncate text-[0.71875rem] text-mute">
                        {row.reason}
                      </span>
                    </span>
                    <Pill tone={toneFor(row.status)}>{label(row.status)}</Pill>
                  </button>
                ))
              ),
          })}
        </div>
      </Card>

      {chosen.value === undefined ? (
        <Banner tone="info">
          Choose the count you are executing. Every scan below is recorded
          against it, and it stays in the address bar — a handheld that sleeps
          mid-count comes back to the same sheet.
        </Banner>
      ) : (
        <Execute countId={chosen.value} />
      )}
    </PageContent>
  )
}

function Execute({ countId }: { countId: string }) {
  const actor = useActor()
  const client = useQueryClient()
  /// What this person has scanned and not yet sent. A tag the sheet has never
  /// heard of has no SKU, so it sits here until somebody types one — the
  /// scanned rows really are fields being filled in.
  const [pending, setPending] = useState<
    { epc: string; sku: string; found: number }[]
  >([])

  const detail = useQuery({
    queryKey: keys.count(countId),
    queryFn: ({ signal }) => dc.officialCount(countId, signal),
  })

  const record = useMutation({
    mutationFn: (entries: { epc: string; sku: string; found: number }[]) =>
      dc.recordCountEntries(countId, {
        entries: entries.map((entry) => ({
          epc: entry.epc,
          sku_code: entry.sku,
          found_quantity: entry.found,
        })),
        actor_id: actor,
        // A batch of entries applied twice double-counts what was found, and
        // a count that reports twice the stock is worse than no count.
        idempotency_key: idempotencyKey(),
      }),
    onSuccess: () => {
      setPending([])
      void client.invalidateQueries({ queryKey: keys.count(countId) })
      void client.invalidateQueries({ queryKey: keys.counts() })
    },
  })

  const submit = useMutation({
    mutationFn: () =>
      dc.submitOfficialCount(countId, {
        actor_id: actor,
        idempotency_key: idempotencyKey(),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: keys.count(countId) })
      void client.invalidateQueries({ queryKey: keys.counts() })
    },
  })

  const lines = useMemo(() => detail.data?.lines ?? [], [detail.data])

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: lines,
        columns,
        getRowId: (row: EdgeOfficialCountLine) => row.epc,
      }),
      [lines]
    )
  )

  const summary = detail.data?.summary
  const known = useMemo(
    () => new Map(lines.map((line) => [line.epc.toUpperCase(), line.sku_code])),
    [lines]
  )

  const add = (scanned: string) => {
    const epc = scanned.toUpperCase()
    setPending((rows) =>
      // A tag swept twice is one piece. Ignoring the second scan is right
      // here: the alternative is a count that claims more than the rack holds.
      rows.some((row) => row.epc === epc)
        ? rows
        : [{ epc, sku: known.get(epc) ?? "", found: 1 }, ...rows]
    )
  }

  const ready = pending.length > 0 && pending.every((row) => row.sku !== "")

  return (
    <div className="grid gap-[1.125rem] xl:grid-cols-[minmax(0,1fr)_23rem] xl:items-start">
      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>The sheet</CardTitle>
          {summary && (
            <span className="text-[0.75rem] text-mute">
              {count(lines.length)} tags expected
            </span>
          )}
        </CardHeader>
        {queryState(detail, {
          loading: "Reading the sheet…",
          render: () =>
            lines.length === 0 ? (
              <EmptyState>
                This count expects nothing — its scope is empty, which is a
                question for whoever authored it.
              </EmptyState>
            ) : (
              <DataTable<EdgeOfficialCountLine>
                table={table}
                // A reference list, read while scanning rather than pressed.
                touch={false}
                className="max-h-[calc(100vh-22rem)]"
              />
            ),
        })}
      </Card>

      <div className="flex flex-col gap-[1.125rem]">
        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle>Scanning</CardTitle>
            {summary && (
              <Pill tone={toneFor(summary.status)}>
                {label(summary.status)}
              </Pill>
            )}
          </CardHeader>

          {summary && (
            <div className="border-t border-hairline px-4 py-3">
              <Progress
                label="Found"
                value={summary.found}
                of={summary.expected}
                tone={summary.found === summary.expected ? "ok" : "accent"}
                detail={`${count(summary.found)}/${count(summary.expected)}`}
              />
            </div>
          )}

          <div className="border-t border-hairline">
            <ScanField
              placeholder="Scan a tag"
              action="Found"
              hint="A tag the sheet has never heard of needs a SKU typed against it."
              onSubmit={add}
            />
          </div>

          {pending.length > 0 && (
            <div className="border-t border-hairline">
              {pending.map((row) => (
                <div
                  key={row.epc}
                  className="flex min-h-tap items-center gap-2 border-b border-hairline px-4 py-2 last:border-b-0"
                >
                  <span className="min-w-0 flex-1 truncate font-mono text-id text-ink">
                    {row.epc}
                  </span>
                  <Input
                    className="h-9 w-32 font-mono text-[0.75rem]"
                    placeholder="SKU"
                    aria-label={`SKU for ${row.epc}`}
                    value={row.sku}
                    onChange={(event) =>
                      setPending((rows) =>
                        rows.map((other) =>
                          other.epc === row.epc
                            ? { ...other, sku: event.target.value }
                            : other
                        )
                      )
                    }
                  />
                  <button
                    type="button"
                    aria-label={`Drop ${row.epc}`}
                    onClick={() =>
                      setPending((rows) =>
                        rows.filter((other) => other.epc !== row.epc)
                      )
                    }
                    className="shrink-0 rounded-full px-2 py-1 text-[0.6875rem] text-mute transition-colors hover:bg-bad-bg hover:text-bad-fg"
                  >
                    drop
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-col gap-2.5 border-t border-hairline px-4 py-3">
            <Button
              variant="dark"
              disabled={!ready || record.isPending}
              onClick={() => record.mutate(pending)}
            >
              {record.isPending
                ? "Recording…"
                : pending.length === 0
                  ? "Nothing scanned yet"
                  : `Record ${count(pending.length)} tags`}
            </Button>
            {pending.length > 0 && !ready && (
              <p className="text-[0.71875rem] text-warn-fg">
                One of these tags is not on the sheet. Say what it is before
                sending — an extra piece is the news, not a mistake.
              </p>
            )}
            <Problem error={record.error} />
          </div>
        </Card>

        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle>Submitting</CardTitle>
          </CardHeader>
          <div className="flex flex-col gap-2.5 border-t border-hairline px-4 py-3">
            <p className="text-meta text-body">
              Submitting is what makes the difference a fact. Approval still
              happens at the centre — this node never turns a count into a stock
              movement.
            </p>
            {submit.isSuccess && submit.data && (
              <Receipt>
                Submitted at {submit.data.submitted_at.slice(11, 16)}, with{" "}
                {count(submit.data.lines.length)} lines. It is the centre's now.
              </Receipt>
            )}
            <Problem error={submit.error} />
            <ConfirmButton
              label="Submit the count"
              title="Submit this count"
              description={
                <>
                  The difference becomes a fact and goes to the centre for
                  approval. Anything not scanned by now is counted as missing —
                  walk the rack again first if you are not finished.
                </>
              }
              confirmLabel="Submit it"
              variant="ghost"
              disabled={summary?.submitted_at !== null}
              pending={submit.isPending}
              onConfirm={() => submit.mutate()}
            />
          </div>
        </Card>
      </div>
    </div>
  )
}
