import { useQuery } from "@tanstack/react-query"
import type { ColumnDef } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { PageHeader } from "@/components/ui/page-header"
import { MiniTable } from "@/components/ui/rows"
import { Sheet } from "@/components/ui/sheet"
import { EmptyState } from "@/components/ui/states"
import { SubTabs } from "@/components/ui/sub-tabs"
import {
  Preview,
  PrintAllButton,
  PrinterCard,
  PrintJobButton,
  ReprintButton,
} from "@/screens/operations/tagging/print-queue"
import { printedOf, useRuns } from "@/screens/operations/tagging/print-run"
import { dc } from "@/lib/api"
import { count, day } from "@/lib/format"
import { ROOMY } from "@/screens/operations/roomy"
import { SupplierName } from "@/screens/procurement/supplier-name"
import { keys } from "@/lib/operations/keys"
import { queryState } from "@/lib/query-state"
import { useSheet } from "@/lib/sheets"
import { tableSetup, type TableSetup } from "@/lib/table"
import type { PrintSessionSummary, TaggingWorkJob } from "@itulah/contract"

/// **Printing** — one row per PO.
///
/// The centre issues a tagging job per article when a delivery is accepted;
/// what somebody at the bench thinks in is the PO whose goods are on the
/// table. So the jobs are grouped by the PO they came from, and the PO is the
/// row. A run still belongs to its article job — the sheet drives each job's
/// run and "Print all" walks them in turn. A job raised before the node kept
/// its delivery line carries no PO and is its own row, titled by its article.
function poOf(job: TaggingWorkJob): { key: string; label: string } {
  if (job.po_number) return { key: `po:${job.po_number}`, label: job.po_number }
  return { key: `job:${job.job_id}`, label: job.article_code }
}

interface Group {
  key: string
  label: string
  supplier: string | null
  delivered_at: string | null
  jobs: TaggingWorkJob[]
  skus: number
  labels: number
  issued_at: string
}

export function group(jobs: readonly TaggingWorkJob[]): Group[] {
  const map = new Map<string, Group>()
  for (const job of jobs) {
    const { key, label } = poOf(job)
    const found = map.get(key)
    if (found === undefined) {
      map.set(key, {
        key,
        label,
        supplier: job.supplier_name,
        delivered_at: job.delivered_at,
        jobs: [job],
        skus: job.lines.length,
        labels: job.total_quantity,
        issued_at: job.issued_at,
      })
    } else {
      found.jobs.push(job)
      found.skus += job.lines.length
      found.labels += job.total_quantity
      found.supplier ??= job.supplier_name
      found.delivered_at ??= job.delivered_at
      if (Date.parse(job.issued_at) < Date.parse(found.issued_at))
        found.issued_at = job.issued_at
    }
  }
  return [...map.values()].sort(
    (a, b) => Date.parse(a.issued_at) - Date.parse(b.issued_at)
  )
}

function printedIn(
  g: Group,
  runs: Map<string, PrintSessionSummary | null>
): number {
  return g.jobs.reduce(
    (total, job) => total + printedOf(job, runs.get(job.job_id)),
    0
  )
}

export function Tagging() {
  const sheet = useSheet("job")
  const [tab, setTab] = useState<"todo" | "done">("todo")

  const jobs = useQuery({
    queryKey: keys.taggingJobs(),
    queryFn: ({ signal }) => dc.taggingJobs(signal),
  })
  const groups = useMemo(() => group(jobs.data ?? []), [jobs.data])
  const runs = useRuns(jobs.data ?? [])

  const finished = (g: Group) => printedIn(g, runs) >= g.labels && g.labels > 0
  const todo = groups.filter((g) => !finished(g))
  const done = groups.filter(finished)
  const rows = tab === "todo" ? todo : done

  const columns = useMemo<ColumnDef<TableSetup, Group>[]>(
    () => [
      {
        id: "no",
        header: "No.",
        size: 70,
        enableSorting: false,
        meta: { align: "right", priority: 2 },
        cell: ({ row }) => <span className="text-mute">{row.index + 1}</span>,
      },
      {
        id: "po",
        header: "PO",
        size: 190,
        meta: { card: "id" },
        cell: ({ row }) => (
          <span className="font-mono text-id text-ink">
            {row.original.label}
          </span>
        ),
      },
      {
        id: "supplier",
        header: "Supplier",
        size: 260,
        meta: { card: "title" },
        cell: ({ row }) => (
          <span className="block truncate text-text">
            <SupplierName code={null} name={row.original.supplier} />
          </span>
        ),
      },
      {
        id: "delivery",
        header: "Delivery",
        size: 140,
        meta: { priority: 3 },
        cell: ({ row }) =>
          row.original.delivered_at === null ? (
            <span className="text-mute">—</span>
          ) : (
            day(row.original.delivered_at)
          ),
      },
      {
        id: "skus",
        header: "SKU",
        size: 90,
        meta: { align: "right", priority: 2 },
        cell: ({ row }) => count(row.original.skus),
      },
      {
        id: "labels",
        header: "Labels",
        size: 110,
        meta: { align: "right", card: "metric" },
        cell: ({ row }) => (
          <span className="font-medium text-ink">
            {count(row.original.labels)}
          </span>
        ),
      },
      {
        id: "printed",
        header: "Printed",
        size: 110,
        meta: { align: "right", priority: 2 },
        cell: ({ row }) => {
          const printed = printedIn(row.original, runs)
          return printed === 0 ? (
            <span className="text-mute">—</span>
          ) : (
            count(printed)
          )
        },
      },
      {
        id: "print",
        header: "",
        meta: { card: "status", grow: 160 },
        cell: ({ row }) => {
          const left = row.original.labels - printedIn(row.original, runs)
          return left > 0 ? (
            <PrintAllButton
              jobs={row.original.jobs}
              runs={runs}
              left={left}
              row
            />
          ) : null
        },
      },
    ],
    [runs]
  )

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns,
        getRowId: (row: Group) => row.key,
      }),
      [rows, columns]
    )
  )

  const open = groups.find((g) => g.key === sheet.value)

  return (
    <PageContent>
      <PageHeader title="Printing" />

      <SubTabs
        value={tab}
        onChange={(next) => setTab(next as "todo" | "done")}
        tabs={[
          {
            value: "todo",
            label: `To print${todo.length ? ` · ${todo.length}` : ""}`,
          },
          { value: "done", label: "Printed" },
        ]}
      />

      <Card className="overflow-hidden">
        {queryState(jobs, {
          loading: "Reading the print queue…",
          render: () =>
            rows.length === 0 ? (
              <EmptyState>
                {tab === "todo" ? "Nothing to print." : "Nothing printed yet."}
              </EmptyState>
            ) : (
              <DataTable<Group>
                table={table}
                touch
                onRowClick={(row) => sheet.open(row.key)}
                isSelected={(row) => row.key === sheet.value}
                pageScroll
                className={ROOMY}
              />
            ),
        })}
      </Card>

      <PoSheet
        group={open}
        runs={runs}
        loading={jobs.isPending}
        onClose={sheet.close}
      />
    </PageContent>
  )
}

/// The PO's SKUs, the tag as it will print, and the bench.
export function PoSheet({
  group: g,
  runs,
  loading,
  onClose,
}: {
  group: Group | undefined
  runs: Map<string, PrintSessionSummary | null>
  loading: boolean
  onClose: () => void
}) {
  const [picked, setPicked] = useState<{ job: string; sku: string } | null>(
    null
  )

  const lines = (g?.jobs ?? []).flatMap((job) =>
    job.lines.map((line, i) => ({ job, line, first: i === 0 }))
  )
  const chosen =
    lines.find(
      (l) => l.job.job_id === picked?.job && l.line.sku_code === picked?.sku
    ) ?? lines[0]
  const left = g ? g.labels - printedIn(g, runs) : 0

  return (
    <Sheet
      open={g !== undefined || loading}
      onOpenChange={(next) => !next && onClose()}
      title={g?.label ?? "PO"}
      width="wide"
      actions={
        g && left > 0 ? (
          <PrintAllButton jobs={g.jobs} runs={runs} left={left} />
        ) : undefined
      }
    >
      {g === undefined ? (
        <EmptyState>Nothing to print.</EmptyState>
      ) : (
        <div className="flex flex-col gap-6">
          {chosen && (
            <Preview jobId={chosen.job.job_id} sku={chosen.line.sku_code} />
          )}

          <MiniTable
            head={[
              { label: "No.", align: "left" },
              { label: "SKU", align: "left" },
              { label: "Article", align: "left" },
              { label: "Color", align: "left" },
              { label: "Size", align: "left" },
              "Labels",
              "Printed",
              "",
            ]}
          >
            {lines.map(({ job, line, first }, index) => {
              const run = runs.get(job.job_id)
              const on =
                chosen?.job.job_id === job.job_id &&
                chosen.line.sku_code === line.sku_code
              const finished = run != null && run.pending_count === 0
              return (
                <tr
                  key={`${job.job_id}:${line.sku_code}`}
                  onClick={() =>
                    setPicked({ job: job.job_id, sku: line.sku_code })
                  }
                  className={`h-16 cursor-pointer border-t border-hairline ${on ? "bg-soft-2" : ""}`}
                >
                  <td className="py-3.5 text-mute">{index + 1}</td>
                  <td className="py-3.5 pl-3 font-mono text-id text-ink">
                    {line.sku_code}
                  </td>
                  <td className="py-3.5 pl-3">{job.article_name}</td>
                  <td className="py-3.5 pl-3">{line.colour_label}</td>
                  <td className="py-3.5 pl-3">{line.size_label}</td>
                  <td className="py-3.5 pl-3 text-right tabular-nums">
                    {count(line.quantity)}
                  </td>
                  <td className="py-3.5 pl-3 text-right tabular-nums">
                    {finished ? (
                      count(line.quantity)
                    ) : (
                      <span className="text-mute">—</span>
                    )}
                  </td>
                  <td className="py-3.5 pl-3 text-right">
                    {finished ? (
                      <ReprintButton job={job} run={run} epcs={line.epcs} />
                    ) : (
                      first && (
                        <PrintJobButton job={job} run={run} runs={runs} />
                      )
                    )}
                  </td>
                </tr>
              )
            })}
          </MiniTable>

          <PrinterCard />
        </div>
      )}
    </Sheet>
  )
}
