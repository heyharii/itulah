import { useShopName } from "@/components/operations/outbound-papers"
import { useQuery } from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { Search } from "lucide-react"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/field"
import {
  IntakeHeader,
  useIntakeSearch,
  type ReturnsStatus,
} from "@/screens/operations/intake/header"
import { DeliverySheet } from "@/screens/operations/intake/receive-return-sheet"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { SubTabs } from "@/components/ui/sub-tabs"
import { EmptyState } from "@/components/ui/states"
import { dc } from "@/lib/api"
import { SHOW_MISSING } from "@/lib/features"
import { count, day, dayMonth, quantity } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import { keys } from "@/lib/operations/keys"
import { queryState } from "@/lib/query-state"
import { useSheet } from "@/lib/sheets"
import { tableSetup, type TableSetup } from "@/lib/table"
import { cn } from "@/lib/utils"
import { STAMP } from "@/screens/procurement/shared"
import { sum } from "@/screens/operations/board/sum"
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
type StatusFilter = ReturnsStatus

/// Columns as Receiving PO draws its orders: the store over its return's
/// reference, when it left, its koli (the one number a blind delivery has),
/// and the count — the verb while it is on the way, what the count found once
/// it is counted.
const columns: ColumnDef<TableSetup, StoreInboundDelivery>[] = [
  {
    id: "return",
    accessorFn: (row) => row.shipment_reference ?? "",
    header: "Return",
    size: 320,
    meta: { card: "hide", grow: 320 },
    cell: ({ row }) => (
      <span className="flex min-w-0 flex-col gap-0.5 py-1 leading-5">
        <StoreName id={row.original.source_site_id} />
        <span className="font-mono text-id text-mute">
          {row.original.shipment_reference ?? "—"}
        </span>
      </span>
    ),
  },
  {
    accessorKey: "departed_at",
    header: "Sent on",
    size: 140,
    meta: { card: "hide" },
    cell: ({ row }) => day(row.original.departed_at),
  },
  {
    accessorKey: "koli_count",
    header: "Koli",
    size: 100,
    meta: { align: "right", card: "hide" },
    cell: ({ row }) => count(row.original.koli_count),
  },
  // Three columns that exist only on a card (`cardLead`; a phone): the store
  // over its return's reference, the figure the card leads with — the koli,
  // the one number a blind delivery has — and the foot's left side: when it
  // left, and what the count found once it has been counted (the owner,
  // 2026-10-06). The desk says the same in its own columns.
  {
    id: "head",
    accessorFn: (row) => row.source_site_id,
    header: "",
    enableHiding: false,
    enableSorting: false,
    meta: { card: "title" },
    cell: ({ row }) => (
      <span className="flex min-w-0 flex-col gap-0.5">
        <StoreName id={row.original.source_site_id} />
        <span className="truncate font-mono text-[0.9375rem] font-normal text-mute">
          {row.original.shipment_reference ?? "—"}
        </span>
      </span>
    ),
  },
  {
    id: "lead",
    accessorFn: (row) => row.koli_count,
    header: "",
    enableHiding: false,
    enableSorting: false,
    meta: { card: "lead" },
    cell: ({ row }) => (
      <span className="flex flex-col items-end tabular-nums">
        <span className="text-[1.5rem] leading-tight font-semibold tracking-tight text-ink">
          {count(row.original.koli_count)}
        </span>
        <span className="text-[0.9375rem] text-mute">koli</span>
      </span>
    ),
  },
  {
    id: "foot",
    accessorFn: (row) => row.departed_at,
    header: "",
    enableHiding: false,
    enableSorting: false,
    meta: { card: "foot" },
    cell: ({ row }) => <CardFoot delivery={row.original} />,
  },
  {
    id: "result",
    header: "Count",
    size: 300,
    meta: { card: "status", align: "right" },
    cell: function Result({ row }) {
      const delivery = row.original
      const card = useLayout() === "phone"
      if (delivery.status === "IN_TRANSIT")
        return <CountButton id={delivery.delivery_id} />
      if (card)
        return (
          <span className={cn(STAMP, "text-ok-fg")}>
            Received
            {delivery.received_at !== null && (
              <span className="block tabular-nums">
                {dayMonth(delivery.received_at)}
              </span>
            )}
          </span>
        )
      const result = delivery.result
      if (result === null) return <span className="text-mute">—</span>
      const off = isOff(result)
      return (
        <span className={off ? "text-warn-fg" : "text-ok-fg"}>
          {quantity(result.received_units)}
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

/// A card's foot, on the left: the day the delivery left and, once counted,
/// what the count found — the figure heavier than its word, red (as the foot's
/// wash is) while it is not what was announced.
function CardFoot({ delivery }: { delivery: StoreInboundDelivery }) {
  const result = delivery.result
  const off = result !== null && isOff(result)
  return (
    <span className="flex flex-col leading-6 tabular-nums">
      <span>{`Sent ${day(delivery.departed_at)}`}</span>
      {delivery.status === "RECEIVED" && result !== null && (
        <span>
          {"Received "}
          <span
            className={
              off
                ? "text-cell font-semibold text-bad-fg"
                : "text-cell font-semibold text-ink"
            }
          >
            {quantity(result.received_units)}
          </span>
          {SHOW_MISSING && result.missing_units > 0 && (
            <span className="text-bad-fg">{` · ${count(result.missing_units)} missing`}</span>
          )}
          {result.extra_units > 0 && (
            <span className="text-bad-fg">{` · ${count(result.extra_units)} extra`}</span>
          )}
        </span>
      )}
    </span>
  )
}

/// Whether a count did not come out as announced: pieces short, or pieces over.
function isOff(result: NonNullable<StoreInboundDelivery["result"]>): boolean {
  return result.missing_units > 0 || result.extra_units > 0
}

/// The verb on a delivery that is still on its way.
function CountButton({ id }: { id: string }) {
  const delivery = useSheet("inbound")
  return (
    <Button
      variant="primary"
      size="card"
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
  const search = useIntakeSearch()
  const shop = useShopName()
  const [sorting, setSorting] = useState<SortingState>([
    { id: "departed_at", desc: true },
  ])

  // Both stages are read at once: the strip and the tab counts need them.
  const list = useQuery({
    queryKey: keys.storeInbound("ALL"),
    queryFn: ({ signal }) => dc.storeInboundList("ALL", signal),
  })

  const everything = useMemo(() => list.data ?? [], [list.data])
  const all = useMemo(
    () => everything.filter((row) => row.status === status),
    [everything, status]
  )
  const onWay = everything.filter((row) => row.status === "IN_TRANSIT")
  const counted = everything.filter((row) => row.status === "RECEIVED")
  // A return by its reference or the store it came from.
  const rows = useMemo(
    () =>
      search.needle === ""
        ? all
        : all.filter(
            (row) =>
              (row.shipment_reference ?? "")
                .toLowerCase()
                .includes(search.needle) ||
              shop(row.source_site_id).toLowerCase().includes(search.needle)
          ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [all, search.needle]
  )

  const phone = useLayout() === "phone"
  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns,
        getRowId: (row: StoreInboundDelivery) => row.delivery_id,
        // The card-only columns stay off the desk's table.
        state: {
          sorting,
          columnVisibility: { head: phone, lead: phone, foot: phone },
        },
        onSortingChange: setSorting,
      }),
      [rows, sorting, phone]
    )
  )

  return (
    <PageContent>
      <IntakeHeader
        tab="returns"
        search={search}
        searchLabel="Search returns or stores"
        table={table}
        returns={{ value: status, onChange: setStatus }}
      />

      <KpiStrip className="grid-cols-2 md:grid-cols-2 xl:grid-cols-2">
        <Kpi
          label="To receive"
          value={`${count(sum(onWay, (row) => row.koli_count))} koli`}
        />
        <Kpi
          label="Received"
          value={quantity(
            sum(counted, (row) => row.result?.received_units ?? 0)
          )}
        />
      </KpiStrip>
      {/* A phone's are the dock's status (IntakeHeader). */}
      <SubTabs
        dock={false}
        className="max-md:hidden"
        value={status}
        onChange={(next) => setStatus(next as StatusFilter)}
        tabs={[
          {
            value: "IN_TRANSIT",
            label: `To receive ${count(onWay.length)}`,
          },
          {
            value: "RECEIVED",
            label: `Received ${count(counted.length)}`,
          },
        ]}
      />

      {/* On a desk the search sits over the table, as on Receiving PO; on a
          phone it is the dock's. */}
      <div className="relative mb-3.5 w-80 max-md:hidden">
        <Search
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-mute"
        />
        <Input
          type="search"
          aria-label="Search returns or stores"
          placeholder="Search returns or stores"
          value={search.value}
          onChange={(event) => search.onChange(event.target.value)}
          className="pl-9"
        />
      </div>

      <Card className="overflow-hidden max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
        {queryState(list, {
          loading: "Reading the returns…",
          render: () =>
            rows.length === 0 ? (
              <EmptyState>
                {search.needle !== ""
                  ? "No returns match."
                  : status === "RECEIVED"
                    ? "Nothing received yet."
                    : "Nothing to receive."}
              </EmptyState>
            ) : (
              <DataTable<StoreInboundDelivery>
                refresh={[list]}
                table={table}
                touch
                onRowClick={(row) => delivery.open(row.delivery_id)}
                isSelected={(row) => row.delivery_id === delivery.value}
                pageScroll
                cardSort={false}
                cardsApart
                cardLead
                cardTone={(row) =>
                  row.result !== null && isOff(row.result) ? "alert" : undefined
                }
                className={ROOMY}
              />
            ),
        })}
      </Card>

      <DeliverySheet id={delivery.value ?? null} onClose={delivery.close} />
    </PageContent>
  )
}
