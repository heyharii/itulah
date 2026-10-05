import { useShopName } from "@/components/operations/outbound-papers"
import { useQuery } from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Button } from "@/components/ui/button"
import { IntakeHeader } from "@/screens/operations/intake/header"
import { DeliverySheet } from "@/screens/operations/intake/receive-return-sheet"
import { Segmented, Toolbar } from "@/components/ui/segmented"
import { EmptyState } from "@/components/ui/states"
import { dc } from "@/lib/api"
import { SHOW_MISSING } from "@/lib/features"
import { count, day } from "@/lib/format"
import { keys } from "@/lib/operations/keys"
import { queryState } from "@/lib/query-state"
import { useSheet } from "@/lib/sheets"
import { tableSetup, type TableSetup } from "@/lib/table"
import { ROOMY } from "@/screens/operations/roomy"
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
] as const

type StatusFilter = (typeof STATUSES)[number]["value"]

/// Columns after the prototype: No. · Return · Store · Sent on · Koli · Count.
/// A delivery on the way carries the verb; one already counted carries what
/// the count found. The manifest's items are not shown while it is blind, so
/// Koli stands where the prototype's Items does.
const columns: ColumnDef<TableSetup, StoreInboundDelivery>[] = [
  {
    id: "no",
    header: "No.",
    size: 70,
    enableSorting: false,
    meta: { align: "right", priority: 2 },
    cell: ({ row }) => <span className="text-mute">{row.index + 1}</span>,
  },
  {
    accessorKey: "shipment_reference",
    header: "Return",
    size: 200,
    meta: { card: "id" },
    cell: ({ row }) => (
      <span className="font-mono text-id text-ink">
        {row.original.shipment_reference ?? "—"}
      </span>
    ),
  },
  {
    accessorKey: "source_site_id",
    header: "Store",
    size: 240,
    meta: { card: "title", grow: 240 },
    cell: ({ row }) => <StoreName id={row.original.source_site_id} />,
  },
  {
    accessorKey: "departed_at",
    header: "Sent on",
    size: 140,
    cell: ({ row }) => day(row.original.departed_at),
  },
  {
    accessorKey: "koli_count",
    header: "Koli",
    size: 100,
    meta: { align: "right", card: "metric" },
    cell: ({ row }) => count(row.original.koli_count),
  },
  {
    id: "result",
    header: "",
    size: 260,
    meta: { card: "status", align: "right" },
    cell: ({ row }) => {
      const delivery = row.original
      if (delivery.status === "IN_TRANSIT")
        return <CountButton id={delivery.delivery_id} />
      const result = delivery.result
      if (result === null) return <span className="text-mute">—</span>
      const off = result.missing_units > 0 || result.extra_units > 0
      return (
        <span className={off ? "text-warn-fg" : "text-ok-fg"}>
          {count(result.received_units)} pcs
          {SHOW_MISSING &&
            result.missing_units > 0 &&
            ` · ${count(result.missing_units)} missing`}
          {result.extra_units > 0 && ` · ${count(result.extra_units)} extra`}
        </span>
      )
    },
  },
]

/// The store by its name, as the outbound board names it.
function StoreName({ id }: { id: string }) {
  const shop = useShopName()
  return (
    <span className="block truncate font-medium text-ink">
      {shop(id) || id}
    </span>
  )
}

/// The verb on a delivery that is still on its way.
function CountButton({ id }: { id: string }) {
  const delivery = useSheet("inbound")
  return (
    <Button
      variant="primary"
      onClick={(event) => {
        event.stopPropagation()
        delivery.open(id)
      }}
    >
      Count receive
    </Button>
  )
}

export function ReceiveStoreReturn() {
  const delivery = useSheet("inbound")
  const [status, setStatus] = useState<StatusFilter>("IN_TRANSIT")
  const [sorting, setSorting] = useState<SortingState>([
    { id: "departed_at", desc: true },
  ])

  const list = useQuery({
    queryKey: keys.storeInbound(status),
    queryFn: ({ signal }) => dc.storeInboundList(status, signal),
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

  return (
    <PageContent>
      <IntakeHeader tab="returns" />

      <Toolbar>
        <Segmented options={STATUSES} value={status} onChange={setStatus} />
      </Toolbar>

      <Card className="overflow-hidden">
        {queryState(list, {
          loading: "Reading the returns…",
          render: () =>
            rows.length === 0 ? (
              <EmptyState>Nothing to count.</EmptyState>
            ) : (
              <DataTable<StoreInboundDelivery>
                table={table}
                touch
                onRowClick={(row) => delivery.open(row.delivery_id)}
                isSelected={(row) => row.delivery_id === delivery.value}
                pageScroll
                className={ROOMY}
              />
            ),
        })}
      </Card>

      <DeliverySheet id={delivery.value ?? null} onClose={delivery.close} />
    </PageContent>
  )
}
