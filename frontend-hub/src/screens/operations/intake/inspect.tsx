import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Checkbox } from "@/components/ui/field"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { PageHeader } from "@/components/ui/page-header"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import {
  EmptyState,
  LoadingState,
  Problem,
  Receipt,
} from "@/components/ui/states"
import { dc } from "@/lib/api"
import { count, day } from "@/lib/format"
import { keys } from "@/lib/operations/keys"
import { queryState } from "@/lib/query-state"
import { useEdgeActor } from "@/lib/edge-session"
import { useSheet } from "@/lib/sheets"
import { tableSetup, type TableSetup } from "@/lib/table"
import { idempotencyKey } from "@itulah/contract/client"
import type { ReturnToInspect } from "@itulah/contract"

/// **Inspect returns** — a store's return this warehouse has already
/// received into that store's return pool, waiting for somebody to say which
/// pieces are fit to sell.
///
/// Receiving answers "did what arrived match what was sent"; this answers a
/// different question, on the same goods, once: good to the racks, damaged to
/// reject. Every unit this inspection covers leaves the return pool — there is
/// no "leave it for later" outcome, only which pool a piece leaves it to.
const columns: ColumnDef<TableSetup, ReturnToInspect>[] = [
  {
    accessorKey: "source_site_id",
    header: "From",
    size: 160,
  },
  {
    accessorKey: "shipment_reference",
    header: "Surat jalan",
    size: 160,
    cell: ({ row }) => row.original.shipment_reference ?? "—",
  },
  {
    accessorKey: "waiting_units",
    header: "Waiting",
    size: 100,
    meta: { align: "right" },
    cell: ({ row }) => (
      <span className="text-ink font-medium">
        {count(row.original.waiting_units)}
      </span>
    ),
  },
  {
    accessorKey: "inspected_units",
    header: "Inspected",
    size: 100,
    meta: { align: "right" },
    cell: ({ row }) => count(row.original.inspected_units),
  },
  {
    accessorKey: "received_at",
    header: "Received",
    size: 130,
    cell: ({ row }) =>
      row.original.received_at === null ? "—" : day(row.original.received_at),
  },
]

export function InspectReturns() {
  const delivery = useSheet("inbound")
  const [sorting, setSorting] = useState<SortingState>([
    { id: "received_at", desc: true },
  ])

  const list = useQuery({
    queryKey: keys.returnInspections(),
    queryFn: ({ signal }) => dc.returnInspections(signal),
  })

  const rows = useMemo(() => list.data ?? [], [list.data])

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns,
        getRowId: (row: ReturnToInspect) => row.delivery_id,
        state: { sorting },
        onSortingChange: setSorting,
      }),
      [rows, sorting]
    )
  )

  const waiting = rows.reduce((total, row) => total + row.waiting_units, 0)

  return (
    <PageContent>
      <PageHeader
        crumb="Operations"
        title="Inspect returns"
        sub="Received returns with units still standing in their store's return pool: good to the racks, damaged to reject."
      />

      <KpiStrip className="grid-cols-2">
        <Kpi label="Deliveries waiting" value={count(rows.length)} />
        <Kpi label="Units to inspect" value={count(waiting)} />
      </KpiStrip>

      <Card className="overflow-hidden">
        {queryState(list, {
          loading: "Reading received returns…",
          render: () =>
            rows.length === 0 ? (
              <EmptyState>
                Nothing waiting. A return lands here once Receive Store Return
                has booked it into the shop's return pool.
              </EmptyState>
            ) : (
              <DataTable<ReturnToInspect>
                table={table}
                touch
                onRowClick={(row) => delivery.open(row.delivery_id)}
                isSelected={(row) => row.delivery_id === delivery.value}
                className="max-h-[calc(100vh-20rem)]"
              />
            ),
        })}
      </Card>

      <InspectionSheet id={delivery.value ?? null} onClose={delivery.close} />
    </PageContent>
  )
}

function InspectionSheet({
  id,
  onClose,
}: {
  id: string | null
  onClose: () => void
}) {
  const actor = useEdgeActor()
  const client = useQueryClient()
  const [damaged, setDamaged] = useState<ReadonlySet<string>>(new Set())

  const detail = useQuery({
    queryKey: keys.returnInspection(id ?? ""),
    queryFn: ({ signal }) => dc.returnInspection(id!, signal),
    enabled: id !== null,
  })

  const inspect = useMutation({
    mutationFn: () =>
      dc.inspectReturn(id!, {
        damaged_epcs: Array.from(damaged),
        // Absent: this inspection covers every unit still waiting. There is
        // no partial-batch step on this screen — a piece left uninspected is
        // one still standing in the return pool, which is a true answer.
        epcs: null,
        actor_id: actor,
        idempotency_key: idempotencyKey(),
      }),
    onSuccess: () => {
      setDamaged(new Set())
      void client.invalidateQueries({ queryKey: keys.returnInspections() })
      void client.invalidateQueries({ queryKey: keys.returnInspection(id!) })
      void client.invalidateQueries({ queryKey: keys.pools() })
    },
  })

  const delivery = detail.data?.delivery
  const units = detail.data?.units ?? []

  function toggle(epc: string, checked: boolean) {
    setDamaged((current) => {
      const next = new Set(current)
      if (checked) next.add(epc)
      else next.delete(epc)
      return next
    })
  }

  return (
    <Sheet
      open={id !== null}
      onOpenChange={(open) => !open && onClose()}
      id={delivery?.shipment_reference ?? id ?? undefined}
      title={
        delivery === undefined ? "Return" : `From ${delivery.source_site_id}`
      }
    >
      {detail.isPending ? (
        <LoadingState>Reading the return…</LoadingState>
      ) : delivery === undefined ? (
        <EmptyState>That return could not be read.</EmptyState>
      ) : (
        <div className="flex flex-col gap-5">
          <Facts>
            <Fact term="From">{delivery.source_site_id}</Fact>
            <Fact term="Waiting">{count(delivery.waiting_units)}</Fact>
            <Fact term="Already inspected">
              {count(delivery.inspected_units)}
            </Fact>
          </Facts>

          {units.length === 0 ? (
            <EmptyState>Nothing left waiting in this return's pool.</EmptyState>
          ) : (
            <div className="flex flex-col gap-2">
              <p className="text-mute text-[0.875rem]">
                Tick a piece unfit to sell. Everything left unticked goes to the
                racks; every ticked piece goes to reject.
              </p>
              <div className="divide-hairline rounded-inner border-hairline flex flex-col divide-y border">
                {units.map((unit) => (
                  <div key={unit.epc} className="px-3 py-2">
                    <Checkbox
                      checked={damaged.has(unit.epc)}
                      onChange={(checked) => toggle(unit.epc, checked)}
                      label={
                        <span className="min-w-0 flex-1">
                          <span className="text-ink block truncate">
                            {unit.name ?? unit.sku_code}
                          </span>
                          <span className="text-mute block truncate font-mono text-[0.8125rem]">
                            {unit.sku_code} · {unit.epc}
                          </span>
                        </span>
                      }
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {inspect.isSuccess && inspect.data && (
            <Receipt>
              {count(inspect.data.good_units)} to the racks,{" "}
              {count(inspect.data.damaged_units)} to reject.
            </Receipt>
          )}
          <Problem error={inspect.error} />

          <Button
            variant="primary"
            disabled={units.length === 0 || inspect.isPending}
            onClick={() => inspect.mutate()}
          >
            Inspect these {count(units.length)} piece
            {units.length === 1 ? "" : "s"}
          </Button>
        </div>
      )}
    </Sheet>
  )
}
