import { useQueries } from "@tanstack/react-query"
import { Search, Truck } from "lucide-react"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { useShopName } from "@/components/operations/outbound-papers"
import { Button } from "@/components/ui/button"
import { Checkbox, Input, Select } from "@/components/ui/field"
import { Pill } from "@/components/ui/pill"
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states"
import { dc } from "@/lib/api"
import { SHOW_MISSING } from "@/lib/features"
import { ago, count } from "@/lib/format"
import { keys } from "@/lib/operations/keys"
import { useBusinessNow } from "@/lib/queries/clock"
import { tripDocumentNumber } from "@/lib/operations/trip-number"
import type {
  Dispatch,
  PicklistSummary,
  ReceivedShipment,
} from "@itulah/contract"

import {
  BoardHeader,
  Lane,
  Lanes,
  Tile,
} from "@/screens/operations/board/parts"
import { useSheet } from "@/lib/sheets"
import {
  DispatchSheet,
  ShipmentSheets,
} from "@/screens/operations/despatch/trucks"
import { PackSheets } from "@/screens/operations/packing/packing"
import { PickSheets } from "@/screens/operations/picking/picking"
import { useBoardView } from "@/screens/operations/board/board-view"
import {
  StageTable,
  type StageRow,
} from "@/screens/operations/board/stage-table"
import { sum } from "@/screens/operations/board/sum"
import { many } from "@/screens/operations/board/words"
import { receivedShipments } from "@/screens/operations/board/received"

/// Same interval as the rail's badges (`lib/operations/waiting.ts`), so a lane
/// and the badge beside it never disagree for longer than one poll.
const POLL_MS = 30_000

/// A received surat jalan stays on the board this long; one still short
/// stays until it is not, however old.
const RECEIVED_DAYS = 7

/// A lorry out longer than this is somebody's question.
const LATE_DAYS = 3

/// **Board: every outbound piece of work in the building, in one view.**
///
/// The three stations each list their own queue. This screen lays those same
/// queues side by side, in the order the goods move, so a supervisor can see
/// where work is piling up without opening three screens:
///
/// **To pick** (a picklist per allotment × shop) → **To pack** (a shop's
/// accepted picks still standing in the pick area) → **Packed** (sealed
/// cartons on no trip yet) → **In transit** (a card per shop, on the
/// road) → **Received** (what the shop counted at its door).
///
/// It moves nothing. Every card opens the station that owns it, on the sheet
/// that does the work — the board is a map of the stations, not a fourth one.
/// These are the warehouse's queues, not an allotment's stages: an allotment
/// is read on its own screen, and "to pack" here is a place in the building,
/// never a stage an allotment is said to be in (allotment-v1 §14 #13).
///
/// A lane with nothing in it folds to a strip.
export function Board() {
  const accepting = useSheet("accept")
  const dispatchSheet = useSheet("new-dispatch")
  const shop = useShopName()
  const viewState = useBoardView()
  const [view] = viewState
  // Fixed when the board opens: a window that slid on every render would be a
  // new cache key, and a new request, every time anything re-rendered.
  const [since] = useState(() =>
    new Date(Date.now() - RECEIVED_DAYS * 86_400_000).toISOString()
  )

  // Written out rather than mapped, as in `useWaiting`: `useQueries` keeps one
  // result type per entry only while the entries are literal.
  const [toPick, picklists, koli, shipments, dispatches, received] = useQueries(
    {
      queries: [
        {
          queryKey: keys.picklistsToPick(),
          queryFn: ({ signal }: { signal: AbortSignal }) =>
            dc.picklistsToPick(signal),
          refetchInterval: POLL_MS,
        },
        {
          queryKey: keys.picklists(),
          queryFn: ({ signal }: { signal: AbortSignal }) =>
            dc.picklists(signal),
          refetchInterval: POLL_MS,
        },
        {
          queryKey: keys.koli({ ready: true }),
          queryFn: ({ signal }: { signal: AbortSignal }) =>
            dc.koli({ ready: true }, signal),
          refetchInterval: POLL_MS,
        },
        {
          queryKey: keys.shipments(),
          queryFn: ({ signal }: { signal: AbortSignal }) =>
            dc.shipments({}, signal),
          refetchInterval: POLL_MS,
        },
        {
          queryKey: keys.dispatches(),
          queryFn: ({ signal }: { signal: AbortSignal }) =>
            dc.dispatches({}, signal),
          refetchInterval: POLL_MS,
        },
        {
          queryKey: keys.receivedShipments(since),
          queryFn: ({ signal }: { signal: AbortSignal }) =>
            receivedShipments(since, signal),
          refetchInterval: POLL_MS,
        },
      ],
    }
  )

  /// Cartons ticked on the board, by koli id, to go on the next trip.
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set())
  /// What the Dispatch sheet was opened with; dropped when it closes.
  const [handoff, setHandoff] = useState<ReadonlySet<string> | null>(null)
  const sheetOpen = dispatchSheet.value === true
  const [wasSheetOpen, setWasSheetOpen] = useState(sheetOpen)
  if (sheetOpen !== wasSheetOpen) {
    setWasSheetOpen(sheetOpen)
    if (!sheetOpen) setHandoff(null)
  }

  const [typed, setTyped] = useState("")
  const [store, setStore] = useState("")
  const needle = typed.trim().toLowerCase()
  /// A card is kept when it is the chosen store's and its store or any of its
  /// documents contain what was typed.
  const keep = (shopId: string, ...docs: (string | null | undefined)[]) =>
    (store === "" || shopId === store) &&
    (needle === "" ||
      [shop(shopId), ...docs].some((text) =>
        (text ?? "").toLowerCase().includes(needle)
      ))

  // "Late" is judged at the business clock's now, read when the trips were.
  const shipmentsNow = useBusinessNow(shipments.dataUpdatedAt)

  const allPicks = toPick.data ?? []
  const allToPack = useMemo(
    () => waitingByShop(picklists.data ?? []),
    [picklists.data]
  )
  const allSealed = (koli.data ?? []).filter(
    (one) => one.position === "PACKED" || one.position === "SHIPMENT"
  )
  // A ticked carton that left on a trip (or was unsealed) is no longer one
  // to pick.
  const readyIds = new Set(allSealed.map((one) => one.koli_id))
  if (koli.data !== undefined && [...picked].some((id) => !readyIds.has(id))) {
    setPicked(new Set([...picked].filter((id) => readyIds.has(id))))
  }
  const pickedCount = [...picked].filter((id) => readyIds.has(id)).length
  const togglePick = (id: string, on: boolean) =>
    setPicked((current) => {
      const next = new Set(current)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })
  /// Ticked → only those go on the trip; nothing ticked → everything does.
  const dispatchPicked = () => {
    setHandoff(pickedCount > 0 ? new Set(picked) : null)
    void dispatchSheet.open(true)
  }
  const dispatchLabel =
    pickedCount > 0 ? `Dispatch (${count(pickedCount)})` : "Dispatch"

  const departedAt = useMemo(
    () => departures(dispatches.data ?? []),
    [dispatches.data]
  )
  const allOnRoad = (shipments.data ?? [])
    .filter((one) => one.position === "IN_TRANSIT")
    .sort((left, right) =>
      (departedAt.get(left.dispatch_id ?? "") ?? "").localeCompare(
        departedAt.get(right.dispatch_id ?? "") ?? ""
      )
    )
  // The centre keys a surat jalan by its number; the DC's sheet by its id.
  const shipmentIdByNumber = useMemo(
    () =>
      new Map(
        (shipments.data ?? []).map((one) => [
          one.shipment_number,
          one.shipment_id,
        ])
      ),
    [shipments.data]
  )
  const allArrived = received.data?.items ?? []
  /// One trip, one surat jalan (owner, 2 Oct 2026): a per-store card shows
  /// its trip's number, so cards of one trip share it. The centre's received
  /// list only knows the shipment number, so it goes through the shipment.
  const tripNumberOf = useMemo(() => {
    const trips = new Map(
      (dispatches.data ?? []).map((trip) => [trip.dispatch_id, trip])
    )
    const byShipment = new Map(
      (shipments.data ?? []).map((one) => [
        one.shipment_number,
        tripDocumentNumber(
          one.dispatch_id === null ? null : trips.get(one.dispatch_id),
          [one]
        ),
      ])
    )
    return (shipmentNumber: string) =>
      byShipment.get(shipmentNumber) ?? shipmentNumber
  }, [dispatches.data, shipments.data])

  const picks = [...allPicks]
    .filter((one) => keep(one.destination_id, one.allotment_number))
    .sort((left, right) => left.created_at.localeCompare(right.created_at))
  const toPack = allToPack.filter((row) => keep(row.shopId, ...row.allotments))
  const sealed = allSealed.filter((one) =>
    keep(one.destination_store_id, one.koli_number)
  )
  const sealedPicked = sealed.filter((one) => picked.has(one.koli_id)).length
  const pickAll = (on: boolean) =>
    setPicked((current) => {
      const next = new Set(current)
      for (const one of sealed) {
        if (on) next.add(one.koli_id)
        else next.delete(one.koli_id)
      }
      return next
    })
  const pickOf = (one: { koli_id: string; koli_number: string }) => ({
    checked: picked.has(one.koli_id),
    onChange: (on: boolean) => togglePick(one.koli_id, on),
    label: `Select ${one.koli_number}`,
  })
  const onRoad = allOnRoad.filter((one) =>
    keep(
      one.destination_store_id,
      one.shipment_number,
      tripNumberOf(one.shipment_number)
    )
  )
  const arrived = allArrived.filter((one) =>
    keep(
      one.destination_store_id,
      one.shipment_number,
      tripNumberOf(one.shipment_number),
      one.destination_name
    )
  )

  /// Every store with a card anywhere on the board, for the filter.
  const stores = [
    ...new Set([
      ...allPicks.map((one) => one.destination_id),
      ...allToPack.map((one) => one.shopId),
      ...allSealed.map((one) => one.destination_store_id),
      ...allOnRoad.map((one) => one.destination_store_id),
      ...allArrived.map((one) => one.destination_store_id),
    ]),
  ]
    .map((id) => ({ id, name: shop(id) || id }))
    .sort((left, right) => left.name.localeCompare(right.name))

  const filters = (
    <>
      <label className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-mute" />
        <Input
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          aria-label="Search the board"
          className="h-11 w-80 pl-9"
        />
      </label>
      <Select
        className="h-11 w-52"
        value={store}
        onChange={setStore}
        aria-label="Store"
      >
        <option value="">All stores</option>
        {stores.map((one) => (
          <option key={one.id} value={one.id}>
            {one.name}
          </option>
        ))}
      </Select>
      {view === "table" && pickedCount > 0 && (
        <Button variant="primary" className="h-11" onClick={dispatchPicked}>
          <Truck />
          {dispatchLabel}
        </Button>
      )}
    </>
  )

  const stage = (id: string, label: string, tone: string, order: number) => ({
    id,
    label,
    tone,
    order,
  })
  const rows: StageRow[] = [
    ...picks.map((pick) => ({
      key: `pick~${pick.allotment_id}~${pick.destination_id}`,
      stage: stage("to-pick", "Pick list", "bg-mute", 0),
      title: shop(pick.destination_id),
      doc: pick.allotment_number,
      detail: many(pick.lines.length, "SKU"),
      pieces: pick.pieces,
      at: pick.created_at,
      act: "Pick",
      onOpen: () =>
        accepting.open(`${pick.allotment_id}~${pick.destination_id}`),
    })),
    ...toPack.map((row) => ({
      key: `pack~${row.shopId}`,
      stage: stage("to-pack", "Picked", "bg-warn", 1),
      title: shop(row.shopId),
      doc:
        row.allotments.length === 1
          ? row.allotments[0]
          : `${row.allotments.length} allotments`,
      detail: many(row.picklists, "picklist"),
      pieces: row.pieces,
      at: row.lastPickedAt,
      act: "Pack",
      open: {
        to: "/operations/packing",
        sheet: { key: "pack" as const, value: row.shopId },
      },
    })),
    ...sealed.map((one) => ({
      key: `packed~${one.koli_id}`,
      stage: stage("packed", "Pack", "bg-body", 2),
      title: shop(one.destination_store_id),
      doc: one.koli_number,
      detail: one.position === "SHIPMENT" ? "On a surat jalan" : undefined,
      pieces: one.unit_count,
      at: one.sealed_at,
      pick: pickOf(one),
      open: {
        to: "/operations/packing",
        sheet: { key: "koli" as const, value: one.koli_id },
      },
    })),
    ...onRoad.map((one) => {
      const left = departedAt.get(one.dispatch_id ?? "") ?? null
      return {
        key: `road~${one.shipment_id}`,
        stage: stage("in-transit", "Dispatch", "bg-info", 3),
        title: shop(one.destination_store_id),
        doc: tripNumberOf(one.shipment_number),
        detail: `${count(one.koli_count)} koli`,
        pieces: one.unit_count,
        at: left,
        late:
          left !== null &&
          shipmentsNow - Date.parse(left) > LATE_DAYS * 86_400_000,
        open: {
          to: "/operations/despatch",
          sheet: { key: "shipment" as const, value: one.shipment_id },
        },
      }
    }),
    ...arrived.map((one) => {
      const short = one.open_gap_qty > 0
      const shipmentId = shipmentIdByNumber.get(one.shipment_number)
      return {
        key: `received~${one.delivery_id}`,
        stage: stage("received", "Received", "bg-ok", 4),
        title: shop(one.destination_store_id) || one.destination_name,
        doc: tripNumberOf(one.shipment_number),
        detail: `${count(one.koli_count)} koli`,
        pieces: one.received_qty + one.found_qty,
        of: short ? one.sent_qty : undefined,
        flag:
          SHOW_MISSING && short
            ? `${count(one.open_gap_qty)} missing`
            : undefined,
        open: {
          to: "/operations/despatch",
          sheet:
            shipmentId === undefined
              ? undefined
              : { key: "shipment" as const, value: shipmentId },
        },
      }
    }),
  ]

  const edgeFailed = [toPick, picklists, koli, shipments, dispatches].find(
    (query) => query.isError
  )
  if (toPick.isPending || picklists.isPending || koli.isPending) {
    return (
      <PageContent fill>
        <Header view={viewState} />
        <LoadingState>Reading the stations…</LoadingState>
      </PageContent>
    )
  }
  if (edgeFailed) {
    return (
      <PageContent fill>
        <Header view={viewState} />
        <ErrorState
          error={edgeFailed.error}
          onRetry={() => edgeFailed.refetch()}
        />
      </PageContent>
    )
  }

  if (
    !received.isPending &&
    [allPicks, allToPack, allSealed, allOnRoad, allArrived].every(
      (list) => list.length === 0
    )
  ) {
    return (
      <PageContent fill>
        <Header view={viewState} />
        <EmptyState>Nothing going out.</EmptyState>
      </PageContent>
    )
  }

  return (
    <PageContent fill>
      <Header actions={filters} view={viewState} />
      {view === "table" ? (
        <StageTable rows={rows} empty="Nothing matches." />
      ) : (
        <Lanes board="outbound">
          <Lane
            id="to-pick"
            tone="bg-mute"
            title="Pick list"
            pieces={sum(picks, (pick) => pick.pieces)}
            cards={picks.length}
          >
            {picks.map((pick) => (
              <Tile
                key={`${pick.allotment_id}~${pick.destination_id}`}
                to="/operations/picking"
                onOpen={() =>
                  accepting.open(`${pick.allotment_id}~${pick.destination_id}`)
                }
                title={shop(pick.destination_id)}
                sub={pick.allotment_number}
                meta={many(pick.lines.length, "SKU")}
                pieces={pick.pieces}
                act="Pick"
              />
            ))}
          </Lane>

          <Lane
            id="to-pack"
            tone="bg-warn"
            title="Picked"
            pieces={sum(toPack, (row) => row.pieces)}
            cards={toPack.length}
          >
            {toPack.map((row) => (
              <Tile
                key={row.shopId}
                to="/operations/packing"
                sheet={{ key: "pack", value: row.shopId }}
                title={shop(row.shopId)}
                sub={
                  row.allotments.length === 1
                    ? row.allotments[0]
                    : `${row.allotments.length} allotments`
                }
                meta={many(row.picklists, "picklist")}
                pieces={row.pieces}
                act="Pack"
              />
            ))}
          </Lane>

          <Lane
            id="packed"
            tone="bg-body"
            title="Pack"
            pieces={sum(sealed, (one) => one.unit_count)}
            cards={sealed.length}
            summary={
              <div className="flex items-center justify-between gap-3">
                <span>{count(sealed.length)} koli</span>
                <Checkbox
                  label="Select all"
                  checked={sealed.length > 0 && sealedPicked === sealed.length}
                  indeterminate={
                    sealedPicked > 0 && sealedPicked < sealed.length
                  }
                  onChange={pickAll}
                  className="-my-3 [&>label]:min-h-11 [&>label]:pl-2"
                />
              </div>
            }
            footer={
              <Button
                variant={pickedCount > 0 ? "primary" : "ghost"}
                className="h-10 w-full"
                onClick={dispatchPicked}
              >
                <Truck />
                {dispatchLabel}
              </Button>
            }
          >
            {sealed.map((one) => (
              <Tile
                key={one.koli_id}
                to="/operations/packing"
                sheet={{ key: "koli", value: one.koli_id }}
                title={shop(one.destination_store_id)}
                sub={one.koli_number}
                meta={
                  one.position === "SHIPMENT" ? "On a surat jalan" : undefined
                }
                pieces={one.unit_count}
                pick={pickOf(one)}
              />
            ))}
          </Lane>

          <Lane
            id="in-transit"
            tone="bg-info"
            title="Dispatch"
            pieces={sum(onRoad, (one) => one.unit_count)}
            cards={onRoad.length}
            problem={shipments.isError ? shipments.error : undefined}
          >
            {onRoad.map((one) => {
              const left = departedAt.get(one.dispatch_id ?? "") ?? null
              const late =
                left !== null &&
                // "Now" is when the list was last read, not the render.
                shipmentsNow - Date.parse(left) > LATE_DAYS * 86_400_000
              return (
                <Tile
                  key={one.shipment_id}
                  to="/operations/despatch"
                  sheet={{ key: "shipment", value: one.shipment_id }}
                  title={shop(one.destination_store_id)}
                  sub={tripNumberOf(one.shipment_number)}
                  meta={`${count(one.koli_count)} koli`}
                  pieces={one.unit_count}
                  pill={
                    late ? undefined : (
                      <Pill tone="neutral">
                        {left === null ? "Departed" : ago(left)}
                      </Pill>
                    )
                  }
                  flag={late ? `Late · left ${ago(left)}` : undefined}
                />
              )
            })}
          </Lane>

          <Lane
            id="received"
            tone="bg-ok"
            title="Received"
            pieces={sum(arrived, (one) => one.received_qty + one.found_qty)}
            cards={arrived.length}
            problem={received.isError ? received.error : undefined}
            loading={received.isPending}
          >
            {arrived.map((one) => (
              <ReceivedTile
                key={one.delivery_id}
                one={one}
                shop={shop}
                shipmentId={shipmentIdByNumber.get(one.shipment_number)}
                doc={tripNumberOf(one.shipment_number)}
              />
            ))}
          </Lane>
        </Lanes>
      )}
      <PickSheets />
      <PackSheets />
      <ShipmentSheets />
      <DispatchSheet only={handoff} onDispatched={() => setPicked(new Set())} />
    </PageContent>
  )
}

function Header({
  actions,
  view,
}: {
  actions?: React.ReactNode
  view: ReturnType<typeof useBoardView>
}) {
  return <BoardHeader board="stores" actions={actions} view={view} />
}

function ReceivedTile({
  one,
  shop,
  shipmentId,
  doc,
}: {
  one: ReceivedShipment
  shop: (id: string) => string
  shipmentId: string | undefined
  doc: string
}) {
  const short = one.open_gap_qty > 0
  return (
    <Tile
      to="/operations/despatch"
      sheet={
        shipmentId === undefined
          ? undefined
          : { key: "shipment", value: shipmentId }
      }
      title={shop(one.destination_store_id) || one.destination_name}
      sub={doc}
      meta={`${count(one.koli_count)} koli`}
      pieces={one.received_qty + one.found_qty}
      of={short ? one.sent_qty : undefined}
      flag={
        SHOW_MISSING && short ? `${count(one.open_gap_qty)} missing` : undefined
      }
      // Done work recedes, so what is still short is what the eye finds.
      className={short ? undefined : "bg-soft"}
    />
  )
}

interface ShopToPack {
  readonly shopId: string
  readonly pieces: number
  readonly picklists: number
  readonly allotments: readonly string[]
  readonly lastPickedAt: string | null
}

/// What each shop has accepted and not yet put in a carton — Packing's unit
/// of work is a shop, gathering one picklist per allotment.
function waitingByShop(rounds: readonly PicklistSummary[]): ShopToPack[] {
  const by = new Map<
    string,
    {
      pieces: number
      picklists: number
      allotments: Set<string>
      last: string | null
    }
  >()
  for (const round of rounds) {
    if (round.waiting <= 0 || round.destination_id === null) continue
    const row = by.get(round.destination_id) ?? {
      pieces: 0,
      picklists: 0,
      allotments: new Set<string>(),
      last: null,
    }
    row.pieces += round.waiting
    row.picklists += 1
    if (round.allotment_number !== null)
      row.allotments.add(round.allotment_number)
    const at = round.session.closed_at ?? round.session.started_at
    if (row.last === null || at > row.last) row.last = at
    by.set(round.destination_id, row)
  }
  return [...by.entries()]
    .map(([shopId, row]) => ({
      shopId,
      pieces: row.pieces,
      picklists: row.picklists,
      allotments: [...row.allotments].sort(),
      lastPickedAt: row.last,
    }))
    .sort((left, right) =>
      (left.lastPickedAt ?? "").localeCompare(right.lastPickedAt ?? "")
    )
}

/// When each trip left, by its id. A surat jalan carries no time of its own.
function departures(trips: readonly Dispatch[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const trip of trips) {
    if (trip.departed_at !== null) map.set(trip.dispatch_id, trip.departed_at)
  }
  return map
}
