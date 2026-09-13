import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { ConfirmButton, Panel } from "@/components/ui/dialog"
import { FilterPanel } from "@/components/ui/filter-panel"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { PageHeader } from "@/components/ui/page-header"
import { MiniTable } from "@/components/ui/rows"
import { Toolbar } from "@/components/ui/segmented"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import {
  EmptyState,
  LoadingState,
  Problem,
  Receipt,
} from "@/components/ui/states"
import { LabelSurface, RunPill } from "@/screens/operations/tagging/print-queue"
import { dc } from "@/lib/api"
import { useFilters } from "@/lib/filters"
import { ago, count, day } from "@/lib/format"
import { keys } from "@/lib/operations/keys"
import { queryState } from "@/lib/query-state"
import { useEdgeActor } from "@/lib/edge-session"
import { useSheet } from "@/lib/sheets"
import { tableSetup, type TableSetup } from "@/lib/table"
import { idempotencyKey } from "@itulah/contract/client"
import type { TaggingWorkJob } from "@itulah/contract"

/// **Tagging** — the articles this warehouse has not tagged yet.
///
/// One screen, one list, and it is a list of **articles**: the centre issues a
/// tagging job per article when a delivery is accepted, and what somebody on
/// the floor is holding is a pile of one article's garments. The job is the
/// paperwork; the article is the thing.
///
/// The EPCs arrived as **finished strings** minted at the centre. Nothing here
/// computes one and nothing reorders them — they print in the order they were
/// minted so the sequence on the rail matches the sequence in the ledger.
///
/// Two verbs, and they are deliberately different weights. **Print** is at the
/// end of every row and shows what comes out of the machine for that article,
/// because printing is the work. **The tags are on** is inside the record, behind a question: it
/// turns a counted quantity into that many individually tracked units and puts
/// them in the warehouse, and there is no way to take it back.
const columns: ColumnDef<TableSetup, TaggingWorkJob>[] = [
  {
    accessorKey: "article_code",
    header: "Article",
    size: 260,
    // There is no search box on this screen, so `contains` is the only way to
    // reach one article in a queue of forty — and the code is what is printed
    // on the docket somebody is holding while they look.
    meta: { filter: { kind: "text", label: "Article" } },
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
    id: "variants",
    accessorFn: (row: TaggingWorkJob) => row.lines.length,
    header: "Variants",
    size: 100,
    meta: { align: "right" },
    cell: ({ row }) => count(row.original.lines.length),
  },
  {
    accessorKey: "total_quantity",
    header: "Labels",
    size: 100,
    // How much work a job is, which is how a floor decides what to start
    // before the shift ends: five hundred labels is an afternoon and twelve is
    // ten minutes.
    meta: {
      align: "right",
      filter: { kind: "number", label: "Labels", unit: "labels" },
    },
    cell: ({ row }) => (
      <span className="font-medium text-ink">
        {count(row.original.total_quantity)}
      </span>
    ),
  },
  {
    accessorKey: "issued_at",
    header: "Issued",
    size: 140,
    meta: { filter: { kind: "date", label: "Issued" } },
    // The decision metric, and the default sort. An article the centre issued
    // four days ago is stock the warehouse cannot sell yet.
    cell: ({ row }) => (
      <span className="text-body">{ago(row.original.issued_at)}</span>
    ),
  },
]

export function Tagging() {
  const job = useSheet("job")
  const printing = useSheet("print")
  const [sorting, setSorting] = useState<SortingState>([
    { id: "issued_at", desc: false },
  ])

  const jobs = useQuery({
    queryKey: keys.taggingJobs(),
    queryFn: ({ signal }) => dc.taggingJobs(signal),
  })

  const rows = useMemo(() => jobs.data ?? [], [jobs.data])
  const printed = rows.find((row) => row.job_id === printing.value)

  /// Asked of the three columns above, not of the two below.
  ///
  /// The print pill and the button carry no data — nothing to ask them — and
  /// taking the predicate from the stable module-scope array is also what
  /// keeps it out of the rebuild `printing` already causes below.
  const filters = useFilters(columns)

  const columnsWithPrint = useMemo<ColumnDef<TableSetup, TaggingWorkJob>[]>(
    () => [
      ...filters.columns,
      {
        // A row does not leave this list when its labels print — printed is
        // not attached, and the row is waiting for somebody to say the tags
        // are on. But it used to say nothing at all about which of the two it
        // was: eleven labels out of the machine and the row still read exactly
        // like one nobody had touched.
        id: "printed",
        header: "Printed",
        size: 150,
        cell: ({ row }) => <RunPill jobId={row.original.job_id} />,
      },
      {
        id: "action",
        header: "",
        size: 120,
        meta: { align: "right" },
        cell: ({ row }) => (
          <Button
            variant="primary"
            size="sm"
            onClick={(event) => {
              event.stopPropagation()
              printing.open(row.original.job_id)
            }}
          >
            Print
          </Button>
        ),
      },
    ],
    [filters.columns, printing]
  )

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns: columnsWithPrint,
        getRowId: (row: TaggingWorkJob) => row.job_id,
        state: { columnFilters: filters.columnFilters, sorting },
        onSortingChange: setSorting,
      }),
      [rows, columnsWithPrint, filters.columnFilters, sorting]
    )
  )

  const labels = rows.reduce((total, row) => total + row.total_quantity, 0)
  // Worked out rather than taken from the end of the list: the node does not
  // promise an order, and "oldest" read off `rows[rows.length - 1]` is a
  // number that is right until the day it silently is not.
  const oldest = rows.reduce<string | null>(
    (earliest, row) =>
      earliest === null || Date.parse(row.issued_at) < Date.parse(earliest)
        ? row.issued_at
        : earliest,
    null
  )

  return (
    <PageContent>
      <PageHeader
        crumb="Operations"
        title="Tagging"
        sub="Articles the centre has minted labels for. Print them, attach them, then say so."
      />

      <KpiStrip className="grid-cols-2 xl:grid-cols-3">
        <Kpi label="Articles untagged" value={count(rows.length)} />
        <Kpi label="Labels to print" value={count(labels)} />
        <Kpi
          label="Oldest"
          value={oldest === null ? "—" : ago(oldest)}
          delta="since the centre issued it"
        />
      </KpiStrip>

      {/* The figures above are about the whole queue and stay that way; the
          clauses here change only which rows are listed underneath. */}
      <Toolbar>
        <FilterPanel model={filters} table={table} />
      </Toolbar>

      <Card className="overflow-hidden">
        {queryState(jobs, {
          loading: "Reading the print queue…",
          render: () =>
            rows.length === 0 ? (
              <EmptyState>
                Nothing to tag. Head office issues these when goods are
                accepted, so the list fills itself.
              </EmptyState>
            ) : (
              <DataTable<TaggingWorkJob>
                table={table}
                touch
                onRowClick={(row) => job.open(row.job_id)}
                isSelected={(row) => row.job_id === job.value}
                className="max-h-[calc(100vh-20rem)]"
              />
            ),
        })}
      </Card>

      <JobSheet id={job.value ?? null} onClose={job.close} />

      {/* One dialog. Print queue was a second list of the same jobs beside a
          card of printer settings — the list is this screen, and the settings
          now sit under the label they decide the shape of. */}
      <Panel
        open={printing.value !== undefined}
        onOpenChange={(open) => !open && printing.close()}
        title={printed?.article_name ?? "Label"}
        sub={printed?.article_code}
      >
        {printing.value !== undefined && (
          <LabelSurface jobId={printing.value} onConfirmed={printing.close} />
        )}
      </Panel>
    </PageContent>
  )
}

/// The article's variants, and the confirmation that ends the job.
///
/// Confirming is said once, for the whole article, by the person who attached
/// the labels. That is the moment a counted quantity becomes that many
/// individually tracked units and enters the warehouse — so it is behind a
/// question, not behind a button.
function JobSheet({ id, onClose }: { id: string | null; onClose: () => void }) {
  const actor = useEdgeActor()
  const client = useQueryClient()

  const jobs = useQuery({
    queryKey: keys.taggingJobs(),
    queryFn: ({ signal }) => dc.taggingJobs(signal),
  })
  const job = (jobs.data ?? []).find((row) => row.job_id === id)

  const run = useQuery({
    queryKey: keys.jobRun(id ?? ""),
    queryFn: ({ signal }) => dc.jobPrintSession(id!, signal),
    enabled: id !== null,
  })

  const confirm = useMutation({
    mutationFn: () =>
      dc.confirmTagging({
        job_id: id!,
        actor_id: actor,
        // Confirming creates one tracked unit per label. Applied twice it is
        // twice the warehouse, and the second set has no garments behind it.
        idempotency_key: idempotencyKey(),
      }),
    onSuccess: () => {
      // The job leaves the list, the units appear in the pools, and the ledger
      // gains a movement group. All three are on screen somewhere.
      void client.invalidateQueries({ queryKey: keys.taggingJobs() })
      void client.invalidateQueries({ queryKey: keys.pools() })
      void client.invalidateQueries({ queryKey: ["inventory", "movements"] })
    },
  })

  return (
    <Sheet
      open={id !== null}
      onOpenChange={(open) => !open && onClose()}
      id={job?.article_code}
      title={job?.article_name ?? "Tagging job"}
    >
      {job === undefined ? (
        jobs.isPending ? (
          <LoadingState>Reading the print queue…</LoadingState>
        ) : (
          <EmptyState>
            That article is no longer waiting — it has been confirmed, or the
            centre withdrew the job.
          </EmptyState>
        )
      ) : (
        <div className="flex flex-col gap-5">
          <Facts>
            <Fact term="Labels">{count(job.total_quantity)}</Fact>
            <Fact term="Variants">{count(job.lines.length)}</Fact>
            <Fact term="Issued">{day(job.issued_at)}</Fact>
            <Fact term="Printed">
              {run.data === null || run.data === undefined
                ? "not queued"
                : `${count(run.data.printed_count)} of ${count(run.data.total_items)}`}
            </Fact>
          </Facts>

          <div>
            <h4 className="mb-2 text-card-title font-semibold text-ink">
              Variants
            </h4>
            <MiniTable head={["SKU", "Colour", "Size", "Labels"]}>
              {job.lines.map((line) => (
                <tr key={line.sku_code} className="border-t border-hairline">
                  <td className="py-2 pr-2 font-mono text-[0.71875rem] text-ink">
                    {line.sku_code}
                  </td>
                  <td className="py-2 text-right">{line.colour_label}</td>
                  <td className="py-2 text-right">{line.size_label}</td>
                  <td className="py-2 text-right tabular-nums">
                    {count(line.quantity)}
                  </td>
                </tr>
              ))}
            </MiniTable>
          </div>

          {confirm.isSuccess && confirm.data && (
            <Receipt>
              {count(confirm.data.tagged_units)} pieces are now individually
              tracked and in this warehouse.
            </Receipt>
          )}
          <Problem error={confirm.error} />

          <ConfirmButton
            label="The tags are on"
            title="Confirm this job is tagged"
            description={
              <>
                This turns {count(job.total_quantity)} counted pieces into that
                many individually tracked units, and puts them in the warehouse.
                Say it once, for the whole job, when the labels are physically
                attached — there is no way to take it back.
              </>
            }
            confirmLabel="They are on"
            variant="primary"
            pending={confirm.isPending}
            onConfirm={() => confirm.mutate()}
          />
        </div>
      )}
    </Sheet>
  )
}
