import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Textarea } from "@/components/ui/field"
import { Button } from "@/components/ui/button"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { PageHeader } from "@/components/ui/page-header"
import { MiniTable } from "@/components/ui/rows"
import { Segmented, Toolbar } from "@/components/ui/segmented"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import {
  EmptyState,
  LoadingState,
  Problem,
  Receipt,
} from "@/components/ui/states"
import { dc } from "@/lib/api"
import { ago, count, day } from "@/lib/format"
import { keys } from "@/lib/operations/keys"
import { queryState } from "@/lib/query-state"
import { useEdgeActor } from "@/lib/edge-session"
import { useSheet } from "@/lib/sheets"
import { tableSetup, type TableSetup } from "@/lib/table"
import { idempotencyKey } from "@itulah/contract/client"
import type { StoreInboundDelivery } from "@itulah/contract"

/// **Receive store return** — deliveries head office has announced to this
/// warehouse, from a shop's own return.
///
/// Blind by design (`edge::inbound`): while a delivery is IN_TRANSIT nothing
/// about the manifest is shown, only the koli count written on the lorry
/// anyway. The handheld sweeps what actually arrived and this screen submits
/// exactly that — nothing here is pre-filled from what was expected, because a
/// count taken while looking at the number it is supposed to produce confirms
/// the paperwork and proves nothing. The comparison — expected, received,
/// missing, extra — exists only after it is received, on the same record.
const STATUSES = [
  { value: "IN_TRANSIT", label: "In transit" },
  { value: "RECEIVED", label: "Received" },
  { value: "ALL", label: "All" },
] as const

type StatusFilter = (typeof STATUSES)[number]["value"]

const columns: ColumnDef<TableSetup, StoreInboundDelivery>[] = [
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
    accessorKey: "koli_count",
    header: "Koli",
    size: 90,
    meta: { align: "right" },
    cell: ({ row }) => count(row.original.koli_count),
  },
  {
    accessorKey: "status",
    header: "Status",
    size: 120,
    cell: ({ row }) =>
      row.original.status === "IN_TRANSIT" ? "In transit" : "Received",
  },
  {
    id: "result",
    header: "Comparison",
    size: 160,
    cell: ({ row }) => {
      const result = row.original.result
      if (result === null) return "—"
      return (
        <span
          className={
            result.missing_units > 0 || result.extra_units > 0
              ? "text-warn"
              : "text-ok"
          }
        >
          {count(result.received_units)} received
          {result.missing_units > 0 &&
            `, ${count(result.missing_units)} missing`}
          {result.extra_units > 0 && `, ${count(result.extra_units)} extra`}
        </span>
      )
    },
  },
  {
    accessorKey: "departed_at",
    header: "Departed",
    size: 120,
    cell: ({ row }) => (
      <span className="text-body">{ago(row.original.departed_at)}</span>
    ),
  },
]

export function ReceiveStoreReturn() {
  const delivery = useSheet("inbound")
  const [status, setStatus] = useState<StatusFilter>("IN_TRANSIT")
  const [sorting, setSorting] = useState<SortingState>([
    { id: "departed_at", desc: true },
  ])

  const list = useQuery({
    queryKey: keys.storeInbound(status),
    queryFn: ({ signal }) =>
      dc.storeInboundList(status === "ALL" ? undefined : status, signal),
  })

  const rows = useMemo(() => list.data ?? [], [list.data])

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns,
        getRowId: (row: StoreInboundDelivery) => row.delivery_id,
        state: { sorting },
        onSortingChange: setSorting,
      }),
      [rows, sorting]
    )
  )

  const koli = rows.reduce((total, row) => total + row.koli_count, 0)

  return (
    <PageContent>
      <PageHeader
        crumb="Operations"
        title="Receive store return"
        sub="A shop's return, announced by head office. Blind until it is received: only the koli count shows before then."
      />

      <KpiStrip className="grid-cols-2">
        <Kpi label="Deliveries" value={count(rows.length)} />
        <Kpi label="Koli" value={count(koli)} />
      </KpiStrip>

      <Toolbar>
        <Segmented options={STATUSES} value={status} onChange={setStatus} />
      </Toolbar>

      <Card className="overflow-hidden">
        {queryState(list, {
          loading: "Reading announced deliveries…",
          render: () =>
            rows.length === 0 ? (
              <EmptyState>
                Nothing here. Head office announces a return the moment it marks
                the koli in transit.
              </EmptyState>
            ) : (
              <DataTable<StoreInboundDelivery>
                table={table}
                touch
                onRowClick={(row) => delivery.open(row.delivery_id)}
                isSelected={(row) => row.delivery_id === delivery.value}
                className="max-h-[calc(100vh-22rem)]"
              />
            ),
        })}
      </Card>

      <DeliverySheet id={delivery.value ?? null} onClose={delivery.close} />
    </PageContent>
  )
}

/// One delivery: blind while IN_TRANSIT, its per-SKU comparison once RECEIVED.
function DeliverySheet({
  id,
  onClose,
}: {
  id: string | null
  onClose: () => void
}) {
  const actor = useEdgeActor()
  const client = useQueryClient()
  const [epcs, setEpcs] = useState("")

  const detail = useQuery({
    queryKey: keys.storeInboundDetail(id ?? ""),
    queryFn: ({ signal }) => dc.storeInboundDetail(id!, signal),
    enabled: id !== null,
  })

  const receive = useMutation({
    mutationFn: () =>
      dc.receiveStoreInbound(id!, {
        epcs: epcs
          .split(/[\s,]+/)
          .map((value) => value.trim().toUpperCase())
          .filter((value) => value !== ""),
        actor_id: actor,
        // One receipt per delivery: applied twice would book every tag a
        // second time, which is why the handheld's own retry uses the same
        // key rather than minting a new one.
        idempotency_key: idempotencyKey(),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: keys.storeInbound("ALL") })
      void client.invalidateQueries({
        queryKey: keys.storeInbound("IN_TRANSIT"),
      })
      void client.invalidateQueries({ queryKey: keys.storeInbound("RECEIVED") })
      void client.invalidateQueries({ queryKey: keys.storeInboundDetail(id!) })
      void client.invalidateQueries({ queryKey: keys.pools() })
    },
  })

  const delivery = detail.data?.delivery
  const epcCount = epcs
    .split(/[\s,]+/)
    .map((value) => value.trim())
    .filter((value) => value !== "").length

  return (
    <Sheet
      open={id !== null}
      onOpenChange={(open) => !open && onClose()}
      id={delivery?.shipment_reference ?? id ?? undefined}
      title={
        delivery === undefined ? "Delivery" : `From ${delivery.source_site_id}`
      }
    >
      {detail.isPending ? (
        <LoadingState>Reading the delivery…</LoadingState>
      ) : delivery === undefined ? (
        <EmptyState>That delivery could not be read.</EmptyState>
      ) : (
        <div className="flex flex-col gap-5">
          <Facts>
            <Fact term="From">{delivery.source_site_id}</Fact>
            <Fact term="Surat jalan">{delivery.shipment_reference ?? "—"}</Fact>
            <Fact term="Koli">{count(delivery.koli_count)}</Fact>
            <Fact term="Departed">{day(delivery.departed_at)}</Fact>
          </Facts>

          {delivery.status === "IN_TRANSIT" ? (
            <div className="flex flex-col gap-3">
              <p className="text-mute text-[0.875rem]">
                Nothing about the manifest shows here — only the koli count
                above. Sweep what actually arrived and submit exactly that; the
                comparison against what was expected is written once this is
                received.
              </p>
              <Textarea
                value={epcs}
                onChange={(event) => setEpcs(event.target.value)}
                rows={8}
                placeholder="One EPC per line or comma separated"
              />
              <p className="text-meta text-mute">
                {count(epcCount)} tag{epcCount === 1 ? "" : "s"} read
              </p>
              <Problem error={receive.error} />
              <Button
                variant="primary"
                disabled={epcCount === 0 || receive.isPending}
                onClick={() => receive.mutate()}
              >
                Receive this delivery
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {receive.isSuccess && (
                <Receipt>This delivery is recorded as received.</Receipt>
              )}
              <div>
                <h4 className="text-card-title text-ink mb-2 font-semibold">
                  Per SKU
                </h4>
                <MiniTable
                  head={["SKU", "Expected", "Received", "Missing", "Extra"]}
                >
                  {(detail.data?.lines ?? []).map((line) => (
                    <tr
                      key={line.sku_code}
                      className="border-hairline border-t"
                    >
                      <td className="text-ink py-2 pr-2 font-mono text-[0.875rem]">
                        {line.name ?? line.sku_code}
                      </td>
                      <td className="py-2 text-right">
                        {count(line.expected)}
                      </td>
                      <td className="py-2 text-right">
                        {count(line.received)}
                      </td>
                      <td className="py-2 text-right">
                        {line.missing > 0 ? (
                          <span className="text-warn">
                            {count(line.missing)}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="py-2 text-right">
                        {line.extra > 0 ? (
                          <span className="text-warn">{count(line.extra)}</span>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  ))}
                </MiniTable>
              </div>
              {(detail.data?.skipped_epcs.length ?? 0) > 0 && (
                <p className="text-meta text-mute">
                  {count(detail.data!.skipped_epcs.length)} tag
                  {detail.data!.skipped_epcs.length === 1 ? "" : "s"} read but
                  not booked — already on this shop's books, or not one of ours.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </Sheet>
  )
}
