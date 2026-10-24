import { useQuery } from "@tanstack/react-query"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { ListTable, type ListColumn } from "@/components/ui/list-table"
import { node } from "@/lib/api"
import { count, day, pcs } from "@/lib/format"
import { byArrival, fromName, useInbound } from "@/screens/stock/inbound"
import type { Dispatch, StoreInboundDelivery } from "@itulah/contract"

/// Stock's **In transit**: what is on the road, both ways.
///
///  - **In** — deliveries sent to this shop and not yet counted in. Blind, as
///    on Receive: the koli, never the pieces.
///  - **Out** — trips this shop sent (a return to HO is one sealed koli on its
///    own trip) that HO has not counted in yet.

/// The shop's own trips — `GET /store/outbound/dispatches`.
export function useOutbound() {
  return useQuery({
    queryKey: ["store", "outbound", "dispatches"] as const,
    queryFn: ({ signal }) =>
      node
        .get<{ items: Dispatch[] }>("/api/v1/store/outbound/dispatches", {
          signal,
        })
        .then((body) => body.items),
    refetchInterval: 15_000,
  })
}

/// Left and not yet counted in at the other end.
export function onTheRoad(trip: Dispatch): boolean {
  return trip.departed_at !== null && trip.received_at === null
}

export function useInTransit() {
  const inbound = useInbound()
  const outbound = useOutbound()
  const coming = [...(inbound.data?.deliveries ?? [])]
    .filter((one) => one.status === "IN_TRANSIT")
    .sort(byArrival)
  const going = (outbound.data ?? []).filter(onTheRoad)
  return { inbound, outbound, coming, going }
}

export function TransitIn({
  rows,
  onOpen,
}: {
  rows: readonly StoreInboundDelivery[]
  onOpen: (deliveryId: string) => void
}) {
  const columns: ListColumn<StoreInboundDelivery>[] = [
    {
      id: "note",
      header: "Delivery note",
      card: "title",
      cell: (one) => (
        <span className="font-mono text-id text-ink">
          {one.shipment_reference ?? "—"}
        </span>
      ),
    },
    {
      id: "from",
      header: "From",
      cell: (one) => <span className="text-ink">{fromName(one.source_site_id)}</span>,
    },
    { id: "departed", header: "Departed", cell: (one) => day(one.departed_at) },
    {
      id: "koli",
      header: "Koli",
      align: "right",
      cell: (one) => count(one.koli_count),
    },
    {
      id: "action",
      header: "",
      align: "right",
      card: "status",
      cell: (one) => (
        <Button
          variant="primary"
          size="card"
          onClick={(event) => {
            event.stopPropagation()
            onOpen(one.delivery_id)
          }}
        >
          Count receive
        </Button>
      ),
    },
  ]
  return (
    <Card className="overflow-hidden max-md:overflow-visible">
      <ListTable
        rows={rows}
        columns={columns}
        rowKey={(one) => one.delivery_id}
        onOpen={(one) => onOpen(one.delivery_id)}
        roomy
        empty="Nothing is on its way to this shop."
      />
    </Card>
  )
}

export function TransitOut({ rows }: { rows: readonly Dispatch[] }) {
  const columns: ListColumn<Dispatch>[] = [
    {
      id: "trip",
      header: "Trip",
      card: "title",
      cell: (one) => (
        <span className="font-mono text-id text-ink">{one.dispatch_number}</span>
      ),
    },
    {
      id: "note",
      header: "Note",
      cell: (one) => <span className="text-ink">{one.trip_note ?? "—"}</span>,
    },
    { id: "departed", header: "Departed", cell: (one) => day(one.departed_at) },
    {
      id: "koli",
      header: "Koli",
      align: "right",
      cell: (one) => count(one.koli_count),
    },
    {
      id: "pcs",
      header: "Pieces",
      align: "right",
      card: "status",
      cell: (one) => pcs(one.unit_count),
    },
  ]
  return (
    <Card className="overflow-hidden max-md:overflow-visible">
      <ListTable
        rows={rows}
        columns={columns}
        rowKey={(one) => one.dispatch_id}
        roomy
        empty="Nothing this shop sent is on the road."
      />
    </Card>
  )
}
