import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { ConfirmButton } from "@/components/ui/dialog"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { PageHeader } from "@/components/ui/page-header"
import { MiniTable } from "@/components/ui/rows"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import {
  EmptyState,
  LoadingState,
  Problem,
  Receipt,
} from "@/components/ui/states"
import { dc } from "@/lib/api"
import { count } from "@/lib/format"
import { keys } from "@/lib/operations/keys"
import { queryState } from "@/lib/query-state"
import { useEdgeActor } from "@/lib/edge-session"
import { useSheet } from "@/lib/sheets"
import { tableSetup, type TableSetup } from "@/lib/table"
import { idempotencyKey } from "@itulah/contract/client"
import type { PutawayJob } from "@itulah/contract"

/// **Putaway** — tagged goods the ledger already has on the racks, waiting to
/// be recorded as shelved.
///
/// Tagging is what actually moves a job's units into the stockroom pool; this
/// screen records nothing about *where the stock is*. It records that a
/// person carried it there, which is the flow's Putaway stage and the last
/// thing standing between an accepted delivery and a job that has left this
/// list. One job, one confirmation, the same shape as Tagging's — because it
/// is the same kind of act: said once, for the whole job, by whoever actually
/// did it.
const columns: ColumnDef<TableSetup, PutawayJob>[] = [
  {
    accessorKey: "article_code",
    header: "Article",
    size: 260,
    meta: { filter: { kind: "text", label: "Article" } },
    cell: ({ row }) => (
      <span className="min-w-0">
        <span className="text-ink block truncate font-medium">
          {row.original.article_name}
        </span>
        <span className="text-mute block truncate font-mono text-[0.875rem]">
          {row.original.article_code}
        </span>
      </span>
    ),
  },
  {
    id: "variants",
    accessorFn: (row: PutawayJob) => row.lines.length,
    header: "Variants",
    size: 100,
    meta: { align: "right" },
    cell: ({ row }) => count(row.original.lines.length),
  },
  {
    accessorKey: "total_quantity",
    header: "Pieces",
    size: 100,
    meta: {
      align: "right",
      filter: { kind: "number", label: "Pieces", unit: "pieces" },
    },
    cell: ({ row }) => (
      <span className="text-ink font-medium">
        {count(row.original.total_quantity)}
      </span>
    ),
  },
  {
    accessorKey: "tagged_by",
    header: "Tagged by",
    size: 160,
    cell: ({ row }) => row.original.tagged_by ?? "—",
  },
]

export function Putaway() {
  const job = useSheet("putaway")
  const [sorting, setSorting] = useState<SortingState>([
    { id: "article_code", desc: false },
  ])

  const work = useQuery({
    queryKey: keys.putawayWork(),
    queryFn: ({ signal }) => dc.putawayWork(signal),
  })

  const rows = useMemo(() => work.data ?? [], [work.data])

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns,
        getRowId: (row: PutawayJob) => row.job_id,
        state: { sorting },
        onSortingChange: setSorting,
      }),
      [rows, sorting]
    )
  )

  const pieces = rows.reduce((total, row) => total + row.total_quantity, 0)

  return (
    <PageContent>
      <PageHeader
        crumb="Operations"
        title="Putaway"
        sub="Tagged goods the ledger already has on the racks. Confirm once the pieces are physically shelved."
      />

      <KpiStrip className="grid-cols-2">
        <Kpi label="Jobs waiting" value={count(rows.length)} />
        <Kpi label="Pieces to shelve" value={count(pieces)} />
      </KpiStrip>

      <Card className="overflow-hidden">
        {queryState(work, {
          loading: "Reading the putaway queue…",
          render: () =>
            rows.length === 0 ? (
              <EmptyState>
                Nothing waiting. Tagging fills this list the moment a job's
                labels are confirmed attached.
              </EmptyState>
            ) : (
              <DataTable<PutawayJob>
                table={table}
                touch
                onRowClick={(row) => job.open(row.job_id)}
                isSelected={(row) => row.job_id === job.value}
                className="max-h-[calc(100vh-20rem)]"
              />
            ),
        })}
      </Card>

      <PutawaySheet id={job.value ?? null} onClose={job.close} />
    </PageContent>
  )
}

/// The job's variants, and the confirmation that ends it.
///
/// Confirming is said once, for the whole job, by whoever carried it to the
/// racks. There is nothing left for the write to move — tagging already put
/// the units in the stockroom pool — so this is a record of an act, not a
/// change of stock, and there is no way to take it back.
function PutawaySheet({
  id,
  onClose,
}: {
  id: string | null
  onClose: () => void
}) {
  const actor = useEdgeActor()
  const client = useQueryClient()

  const work = useQuery({
    queryKey: keys.putawayWork(),
    queryFn: ({ signal }) => dc.putawayWork(signal),
  })
  const job = (work.data ?? []).find((row) => row.job_id === id)

  const confirm = useMutation({
    mutationFn: () =>
      dc.putAway({
        job_id: id!,
        actor_id: actor,
        // Recorded once per job. Applied twice it is twice the paperwork
        // against the same pieces, which is exactly what this key prevents.
        idempotency_key: idempotencyKey(),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: keys.putawayWork() })
    },
  })

  return (
    <Sheet
      open={id !== null}
      onOpenChange={(open) => !open && onClose()}
      id={job?.article_code}
      title={job?.article_name ?? "Putaway"}
    >
      {job === undefined ? (
        work.isPending ? (
          <LoadingState>Reading the putaway queue…</LoadingState>
        ) : (
          <EmptyState>
            That job is no longer waiting — it has already been shelved.
          </EmptyState>
        )
      ) : (
        <div className="flex flex-col gap-5">
          <Facts>
            <Fact term="Pieces">{count(job.total_quantity)}</Fact>
            <Fact term="Variants">{count(job.lines.length)}</Fact>
            <Fact term="Tagged by">{job.tagged_by ?? "—"}</Fact>
          </Facts>

          <div>
            <h4 className="text-card-title text-ink mb-2 font-semibold">
              Variants
            </h4>
            <MiniTable head={["SKU", "Colour", "Size", "Pieces"]}>
              {job.lines.map((line) => (
                <tr key={line.sku_code} className="border-hairline border-t">
                  <td className="text-ink py-2 pr-2 font-mono text-[0.875rem]">
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
              {count(confirm.data.units)} pieces are recorded as put away on the
              racks.
            </Receipt>
          )}
          <Problem error={confirm.error} />

          <ConfirmButton
            label="It's on the racks"
            title="Confirm this job is put away"
            description={
              <>
                This records {count(job.total_quantity)} pieces as shelved. Say
                it once, when the pieces are physically on the racks — there is
                no way to take it back.
              </>
            }
            confirmLabel="It's shelved"
            variant="primary"
            pending={confirm.isPending}
            onConfirm={() => confirm.mutate()}
          />
        </div>
      )}
    </Sheet>
  )
}
