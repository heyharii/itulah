import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { ColumnDef } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Field, Input, Select } from "@/components/ui/field"
import { Sheet } from "@/components/ui/sheet"
import { EmptyState, Problem } from "@/components/ui/states"
import {
  numberSeriesKey,
  numberSeriesQuery,
  setNumberSeries,
} from "@/lib/queries/finance-number-series"
import { queryState } from "@/lib/query-state"
import { tableSetup, type TableSetup } from "@/lib/table"
import type { NumberSeries } from "@itulah/contract"

/// 7Soft's No Transaksi and Kode No Transaksi, on the Set Up page.
///
/// 7Soft numbers every document from a prefix (KM, KK, PJL, PO) and one
/// setting that starts the count over each month or each year. The hub keeps
/// both per kind of document as a pattern — `{UNIT}`, `{YYYY}`, `{YY}`, `{MM}`
/// and one `{###}` — and a reset. A change counts from the next document on:
/// numbers already issued never change.

export const RESET_WORDS: Record<string, string> = {
  MONTHLY: "Bulanan",
  YEARLY: "Tahunan",
  NEVER: "Never",
}

const columns: ColumnDef<TableSetup, NumberSeries>[] = [
  {
    accessorKey: "label",
    header: "Document",
    size: 280,
    meta: { card: "title", grow: 200 },
    cell: ({ row }) => <span className="text-ink">{row.original.label}</span>,
  },
  {
    accessorKey: "pattern",
    header: "Kode No Transaksi",
    size: 240,
    meta: { card: "meta" },
    cell: ({ row }) => (
      <span className="font-mono text-[0.9375rem] text-body">
        {row.original.pattern}
      </span>
    ),
  },
  {
    id: "reset",
    accessorFn: (row) => RESET_WORDS[row.reset] ?? row.reset,
    header: "No Transaksi",
    size: 150,
    meta: { card: "metric" },
    cell: ({ row }) => RESET_WORDS[row.original.reset] ?? row.original.reset,
  },
  {
    accessorKey: "example",
    header: "Next looks like",
    size: 220,
    meta: { card: "meta", priority: 2 },
    cell: ({ row }) => (
      <span className="font-mono text-[0.9375rem] text-mute">
        {row.original.example}
      </span>
    ),
  },
]

export function NumberSeriesSection() {
  const list = useQuery(numberSeriesQuery())
  const [editing, setEditing] = useState<string | null>(null)
  const rows = useMemo(() => list.data?.items ?? [], [list.data])
  const open = rows.find((one) => one.document_kind === editing)

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns,
        getRowId: (row: NumberSeries) => row.document_kind,
        state: {},
      }),
      [rows]
    )
  )

  return (
    <section className="mt-8" aria-labelledby="numbering-heading">
      <h2
        id="numbering-heading"
        className="mb-3 text-[0.9375rem] font-semibold text-ink"
      >
        No Transaksi
      </h2>
      <Card className="overflow-clip max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
        {queryState(list, {
          loading: "Reading the numbering…",
          render: () =>
            rows.length === 0 ? (
              <EmptyState>No document kind is numbered yet.</EmptyState>
            ) : (
              <DataTable<NumberSeries>
                table={table}
                refresh={[list]}
                onRowClick={(row) => setEditing(row.document_kind)}
                isSelected={(row) => row.document_kind === editing}
                empty="No document."
                pageScroll
                cardsApart
                cardSort={false}
              />
            ),
        })}
      </Card>
      <SeriesSheet series={open} onClose={() => setEditing(null)} />
    </section>
  )
}

export function SeriesSheet({
  series,
  onClose,
}: {
  series: NumberSeries | undefined
  onClose: () => void
}) {
  return (
    <Sheet
      open={series !== undefined}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title={series?.label ?? "Document"}
    >
      {series !== undefined && (
        <SeriesForm
          key={series.document_kind}
          series={series}
          onDone={onClose}
        />
      )}
    </Sheet>
  )
}

function SeriesForm({
  series,
  onDone,
}: {
  series: NumberSeries
  onDone: () => void
}) {
  const client = useQueryClient()
  const [pattern, setPattern] = useState(series.pattern)
  const [reset, setReset] = useState(series.reset)
  const save = useMutation({
    mutationFn: () =>
      setNumberSeries(series.document_kind, {
        pattern: pattern.trim() === series.pattern ? undefined : pattern.trim(),
        reset: reset === series.reset ? undefined : reset,
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: numberSeriesKey })
      onDone()
    },
  })
  const changed = pattern.trim() !== series.pattern || reset !== series.reset

  return (
    <div className="flex flex-col gap-3">
      <Problem error={save.error} />
      <Field
        label="Kode No Transaksi"
        required
        hint={
          series.unit_aware
            ? "{UNIT}, {YYYY}, {YY}, {MM} and one {###} for the count."
            : "{YYYY}, {YY}, {MM} and one {###} for the count."
        }
      >
        <Input
          value={pattern}
          className="font-mono"
          onChange={(event) => setPattern(event.target.value)}
        />
      </Field>
      <Field label="No Transaksi">
        <Select value={reset} onChange={setReset}>
          <option value="MONTHLY">Bulanan — starts over each month</option>
          <option value="YEARLY">Tahunan — starts over each year</option>
          <option value="NEVER">Never starts over</option>
        </Select>
      </Field>
      <div className="flex justify-end">
        <Button
          variant="primary"
          pending={save.isPending}
          disabled={!changed || pattern.trim() === ""}
          onClick={() => save.mutate()}
        >
          {save.isPending ? "Submitting…" : "Submit"}
        </Button>
      </div>
    </div>
  )
}
