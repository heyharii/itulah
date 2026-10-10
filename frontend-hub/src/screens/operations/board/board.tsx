import { useQueries } from "@tanstack/react-query"
import { Search, Truck } from "lucide-react"
import { useMemo, useState } from "react"

import { DockPortal } from "@/components/shell/dock"
import { DockTools } from "@/components/shell/dock-tools"
import { useLayout } from "@/lib/layout"

import { PageContent } from "@/components/shell/app-shell"
import { useShopName } from "@/components/operations/outbound-papers"
import { Button } from "@/components/ui/button"
import { Checkbox, Input, Select } from "@/components/ui/field"
import { Pill } from "@/components/ui/pill"
import { ErrorState, LoadingState } from "@/components/ui/states"
import { dc } from "@/lib/api"
import { SHOW_MISSING } from "@/lib/features"
import { ago, count } from "@/lib/format"
import { useAcknowledgeChanges } from "@/lib/operations/acknowledge"
import {
  dcChanges,
  owedWork,
  shortPicks,
  type DcChange,
} from "@/lib/operations/changes"
import { keys } from "@/lib/operations/keys"
import { useBusinessNow } from "@/lib/queries/clock"
import { toast } from "@/lib/toast"
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
  type DraggedCard,
} from "@/screens/operations/board/parts"
import { useSheet } from "@/lib/sheets"
import {
  DispatchSheet,
  ShipmentSheets,
} from "@/screens/operations/despatch/trucks"
import { PackSheets } from "@/screens/operations/packing/packing"
import { PickSheets } from "@/screens/operations/picking/picking"
import { useBoardView } from "@/screens/operations/board/board-view"
import { MoveBackDialog } from "@/screens/operations/board/move-back"
import {
  changeTags,
  indexOwed,
  markOf,
  pickCardKey,
  placeChanges,
  shortCard,
  shortPickMarks,
  type MoveBackTarget,
} from "@/screens/operations/board/owed"
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

/// A received delivery note stays on the board this long; one still short
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
  const packing = useSheet("pack")
  const shop = useShopName()
  const [seen] = useBoardView()
  const phone = useLayout() === "phone"
  // The Allotment board is the board, with no table to switch to (owner,
  // 2026-10-10); only a phone, which has no room for lanes, reads it as rows.
  const view = phone ? seen : "board"
  // Fixed when the board opens: a window that slid on every render would be a
  // new cache key, and a new request, every time anything re-rendered.
  const [since] = useState(() =>
    new Date(Date.now() - RECEIVED_DAYS * 86_400_000).toISOString()
  )

  // Written out rather than mapped, as in `useWaiting`: `useQueries` keeps one
  // result type per entry only while the entries are literal.
  const [
    toPick,
    picklists,
    koli,
    shipments,
    dispatches,
    received,
    owed,
    shorts,
    changes,
  ] = useQueries(
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
        // What MD took out that the Gudang still has to move back, and the
        // pickers' short picks: they mark cards, they never block the board,
        // so a failed read of either leaves the board as it was.
        {
          queryKey: keys.owed(),
          queryFn: ({ signal }: { signal: AbortSignal }) => owedWork(signal),
          refetchInterval: POLL_MS,
        },
        {
          queryKey: keys.shortPicks(),
          queryFn: ({ signal }: { signal: AbortSignal }) => shortPicks(signal),
          refetchInterval: POLL_MS,
        },
        // What MD changed that the Gudang has not acknowledged: tags and a
        // "Got it" on the cards, so it marks cards and never blocks the board.
        {
          queryKey: keys.changes(),
          queryFn: ({ signal }: { signal: AbortSignal }) => dcChanges(signal),
          refetchInterval: POLL_MS,
        },
      ],
    }
  )

  /// Where the Move back dialog stands, when it is open.
  const [moving, setMoving] = useState<MoveBackTarget | null>(null)
  const owedIndex = useMemo(() => indexOwed(owed.data ?? []), [owed.data])
  const shortMarks = useMemo(
    () => shortPickMarks(shorts.data ?? []),
    [shorts.data]
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
  /// A carton holding pieces MD took out cannot go on a trip: the server
  /// refuses it, so the board never offers it.
  const held = (id: string) => owedIndex.koli.has(id)

  /// Where each change MD made that the Gudang has not acknowledged is drawn,
  /// worked out on the whole board so the search and the store filter never
  /// turn a change into a card of its own.
  const placement = placeChanges(
    changes.data ?? [],
    allPicks,
    new Set(allToPack.map((row) => row.shopId)),
    allSealed.map((one) => ({
      koli_id: one.koli_id,
      destination_id: one.destination_store_id,
    })),
    owed.data ?? []
  )
  const acknowledge = useAcknowledgeChanges()
  const changeId = (one: DcChange) =>
    `${one.allotment_id}~${one.destination_id}`
  /// The "Got it" of a card carrying these changes; absent when it carries none.
  const ackOf = (items: readonly DcChange[] | undefined, label = "Got it") =>
    items === undefined || items.length === 0
      ? undefined
      : {
          label,
          pending:
            acknowledge.isPending &&
            (acknowledge.variables ?? []).some((v) =>
              items.some((one) => changeId(one) === changeId(v))
            ),
          onClick: () => acknowledge.mutate(items),
        }
  // A ticked carton that left on a trip (or was unsealed, or has just had
  // pieces taken out by MD) is no longer one to pick.
  const readyIds = new Set(
    allSealed.filter((one) => !held(one.koli_id)).map((one) => one.koli_id)
  )
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
  /// Ticked → only those go on the trip; nothing ticked → everything does,
  /// except a carton holding pieces MD took out.
  const dispatchPicked = () => {
    if (pickedCount > 0) {
      setHandoff(new Set(picked))
    } else if (readyIds.size < allSealed.length) {
      if (readyIds.size === 0) {
        toast("Move back what MD took out before a carton can go")
        return
      }
      setHandoff(new Set(readyIds))
    } else {
      setHandoff(null)
    }
    void dispatchSheet.open(true)
  }
  const dispatchLabel =
    pickedCount > 0 ? `Dispatch (${count(pickedCount)})` : "Dispatch"

  /// Where a dropped card may go, and what the drop opens — never a write:
  /// the sheet that owns the step asks first (the pick's counts, the carton's
  /// quantities, the trip's cartons). Going backwards opens the same work
  /// from its own lane, so "back" is a look before anything moves.
  ///
  /// Going back asks the same question from every door: **Move back**, with
  /// the lines prefilled. Nothing moves back from a trip, so a card in
  /// transit has no drop at all.
  const koliShop = (id: string) =>
    allSealed.find((one) => one.koli_id === id)?.destination_store_id
  const backFromKoli =
    (to: "picked" | "pick") =>
    (card: string): void => {
      const destinationId = koliShop(card)
      if (destinationId !== undefined)
        setMoving({ from: "packed", to, destinationId, koliId: card })
    }
  const DROPS: Record<string, (card: string) => void> = {
    "to-pick>to-pack": (card) => accepting.open(card),
    "to-pack>packed": (card) => packing.open(card),
    "packed>in-transit": (card) => {
      setHandoff(new Set([card]))
      void dispatchSheet.open(true)
    },
    "to-pack>to-pick": (card) =>
      setMoving({ from: "picked", to: "pick", destinationId: card }),
    "packed>to-pack": backFromKoli("picked"),
    "packed>to-pick": backFromKoli("pick"),
  }
  const LANE_ORDER: Record<string, number> = {
    "to-pick": 0,
    "to-pack": 1,
    packed: 2,
    "in-transit": 3,
    received: 4,
  }

  /// A card dropped on a lane. A desk's drag only: a phone has no lanes and a
  /// finger never starts one.
  function moveCard(moved: DraggedCard, lane: string) {
    if (phone || moved.lane === lane) return
    if ((LANE_ORDER[lane] ?? 0) > (LANE_ORDER[moved.lane] ?? 0)) {
      // A carton MD changed goes back before it goes on. A Picked card MD
      // reduced still packs what is wanted of it (owner, 10 Oct 2026; the
      // server caps the pack at that): it is stopped only when nothing is
      // wanted any more.
      const owedHere =
        moved.lane === "to-pack"
          ? owedIndex.shop.get(moved.card)
          : moved.lane === "packed"
            ? owedIndex.koli.get(moved.card)
            : undefined
      const wanted =
        moved.lane === "to-pack"
          ? (allToPack.find((row) => row.shopId === moved.card)?.pieces ?? 0) -
            (owedHere?.pieces ?? 0)
          : 0
      if (owedHere !== undefined && owedHere.pieces > 0 && wanted <= 0) {
        toast(`Move back ${count(owedHere.pieces)} pcs first`)
        return
      }
    }
    DROPS[`${moved.lane}>${lane}`]?.(moved.card)
  }

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
  // The centre keys a delivery note by its number; the DC's sheet by its id.
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
  /// One trip, one delivery note (owner, 2 Oct 2026): a per-store card shows
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
  const aloneChanges = placement.alone.filter((one) =>
    keep(one.destination_id, one.allotment_number)
  )
  const toPack = allToPack.filter((row) => keep(row.shopId, ...row.allotments))
  const sealed = allSealed.filter((one) =>
    keep(one.destination_store_id, one.koli_number)
  )
  const sealedPicked = sealed.filter((one) => picked.has(one.koli_id)).length
  const sealedReady = sealed.filter((one) => !held(one.koli_id)).length
  const pickAll = (on: boolean) =>
    setPicked((current) => {
      const next = new Set(current)
      for (const one of sealed) {
        if (held(one.koli_id)) continue
        if (on) next.add(one.koli_id)
        else next.delete(one.koli_id)
      }
      return next
    })
  const pickOf = (one: { koli_id: string; koli_number: string }) => {
    const away = held(one.koli_id)
    return {
      checked: !away && picked.has(one.koli_id),
      onChange: (on: boolean) => togglePick(one.koli_id, on),
      label: `Select ${one.koli_number}`,
      disabled: away,
      title: away
        ? "Holds pieces MD took out. Move them back before it can go."
        : undefined,
    }
  }
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
    ...picks.map((pick) => {
      const key = pickCardKey(pick.allotment_id, pick.destination_id)
      const short = shortMarks.get(key)
      return {
        key: `pick~${pick.allotment_id}~${pick.destination_id}`,
        stage: stage("to-pick", "Pick list", "bg-mute", 0),
        title: shop(pick.destination_id),
        doc: pick.allotment_number,
        detail: many(pick.lines.length, "SKU"),
        pieces: pick.pieces,
        at: pick.created_at,
        act: "Pick",
        mark: short === undefined ? undefined : shortCard(short).row,
        tags: changeTags(placement.pick.get(key) ?? []),
        ack: ackOf(placement.pick.get(key)),
        onOpen: () =>
          accepting.open(`${pick.allotment_id}~${pick.destination_id}`),
      }
    }),
    // A picklist MD cancelled while it was still to pick has no card of its
    // own any more: it stays as one until the Gudang acknowledges it.
    ...aloneChanges.map((one) => ({
      key: `change~${changeId(one)}`,
      stage: stage("to-pick", "Pick list", "bg-mute", 0),
      title: shop(one.destination_id),
      doc: one.allotment_number,
      pieces: 0,
      at: one.at,
      tags: changeTags([one]),
      stamp: one.cancelled ? "CANCELLED" : undefined,
      off: one.cancelled,
      ack: ackOf([one], one.cancelled ? "Remove" : "Got it"),
    })),
    ...toPack.map((row) => {
      const mark = markOf(owedIndex.shop.get(row.shopId), row.pieces)
      return {
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
        act: mark === null ? "Pack" : "Move back",
        mark: mark?.row,
        tags: changeTags(placement.shop.get(row.shopId) ?? []),
        ack: ackOf(placement.shop.get(row.shopId)),
        change: mark?.change,
        stamp: mark?.stamp,
        off: mark?.switchedOff,
        moveBack:
          mark === null
            ? undefined
            : () => setMoving({ from: "picked", destinationId: row.shopId }),
        open: {
          to: "/operations/packing",
          sheet: { key: "pack" as const, value: row.shopId },
        },
      }
    }),
    ...sealed.map((one) => {
      const mark = markOf(owedIndex.koli.get(one.koli_id), one.unit_count)
      return {
        key: `packed~${one.koli_id}`,
        stage: stage("packed", "Pack", "bg-body", 2),
        title: shop(one.destination_store_id),
        doc: one.koli_number,
        detail: one.position === "SHIPMENT" ? "On a delivery note" : undefined,
        pieces: one.unit_count,
        at: one.sealed_at,
        act: mark === null ? undefined : "Move back",
        mark: mark?.row,
        tags: changeTags(placement.koli.get(one.koli_id) ?? []),
        ack: ackOf(placement.koli.get(one.koli_id)),
        change: mark?.change,
        stamp: mark?.stamp,
        off: mark?.switchedOff,
        moveBack:
          mark === null
            ? undefined
            : () =>
                setMoving({
                  from: "packed",
                  destinationId: one.destination_store_id,
                  koliId: one.koli_id,
                }),
        pick: pickOf(one),
        open: {
          to: "/operations/packing",
          sheet: { key: "koli" as const, value: one.koli_id },
        },
      }
    }),
    ...onRoad.map((one) => {
      const left = departedAt.get(one.dispatch_id ?? "") ?? null
      return {
        key: `road~${one.shipment_id}`,
        stage: stage("in-transit", "Dispatch", "bg-info", 3),
        title: shop(one.destination_store_id),
        doc: tripNumberOf(one.shipment_number),
        detail: `${count(one.koli_count)} ${one.koli_count === 1 ? "carton" : "cartons"}`,
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
        detail: `${count(one.koli_count)} ${one.koli_count === 1 ? "carton" : "cartons"}`,
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
        <Header />
        <LoadingState>Reading the stations…</LoadingState>
      </PageContent>
    )
  }
  if (edgeFailed) {
    return (
      <PageContent fill>
        <Header />
        <ErrorState
          error={edgeFailed.error}
          onRetry={() => edgeFailed.refetch()}
        />
      </PageContent>
    )
  }

  return (
    <PageContent fill>
      {/* On a phone the search and the store are the dock's, as on every
      list; the desk keeps them in its header. */}
      <Header actions={phone ? undefined : filters} />
      {phone && (
        <>
          <DockTools
            search={{
              value: typed,
              onChange: setTyped,
              label: "Search the board",
            }}
            status={{
              value: store,
              options: [
                { value: "", label: "All stores" },
                ...stores.map((one) => ({ value: one.id, label: one.name })),
              ],
              onChange: setStore,
            }}
          />
          {pickedCount > 0 && (
            <DockPortal slot="action">
              <button
                type="button"
                aria-label={dispatchLabel}
                title={dispatchLabel}
                onClick={dispatchPicked}
                className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-cta text-cta-fg shadow-soft transition-[scale] duration-(--t-press) ease-(--ease-out) active:scale-[0.96]"
              >
                <Truck className="size-5" />
              </button>
            </DockPortal>
          )}
        </>
      )}
      {view === "table" ? (
        <StageTable rows={rows} empty="Nothing matches." />
      ) : (
        <Lanes board="outbound">
          <Lane
            id="to-pick"
            tone="bg-mute"
            title="Pick List"
            pieces={sum(picks, (pick) => pick.pieces)}
            cards={picks.length + aloneChanges.length}
            onDropCard={moveCard}
          >
            {picks.map((pick) => {
              const key = pickCardKey(pick.allotment_id, pick.destination_id)
              const short = shortMarks.get(key)
              const here = placement.pick.get(key)
              return (
                <Tile
                  key={`${pick.allotment_id}~${pick.destination_id}`}
                  to="/operations/picking"
                  onOpen={() =>
                    accepting.open(
                      `${pick.allotment_id}~${pick.destination_id}`
                    )
                  }
                  title={shop(pick.destination_id)}
                  sub={pick.allotment_number}
                  meta={many(pick.lines.length, "SKU")}
                  pieces={pick.pieces}
                  act="Pick"
                  strip={
                    short === undefined ? undefined : shortCard(short).strip
                  }
                  tags={changeTags(here ?? [])}
                  ack={ackOf(here)}
                  drag={{
                    lane: "to-pick",
                    card: `${pick.allotment_id}~${pick.destination_id}`,
                  }}
                />
              )
            })}
            {aloneChanges.map((one) => (
              <Tile
                key={`change~${changeId(one)}`}
                to="/operations/picking"
                title={shop(one.destination_id)}
                sub={one.allotment_number}
                pieces={0}
                stamp={one.cancelled ? "CANCELLED" : undefined}
                switchedOff={one.cancelled}
                tags={changeTags([one])}
                ack={ackOf([one], one.cancelled ? "Remove" : "Got it")}
              />
            ))}
          </Lane>

          <Lane
            id="to-pack"
            tone="bg-warn"
            title="Picked"
            pieces={sum(toPack, (row) => row.pieces)}
            cards={toPack.length}
            onDropCard={moveCard}
          >
            {toPack.map((row) => {
              const mark = markOf(owedIndex.shop.get(row.shopId), row.pieces)
              return (
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
                  // MD reduced it: what is still wanted can be packed, so the
                  // hint stays beside Move back; nothing wanted, no hint.
                  act={
                    mark !== null && mark.owed >= row.pieces ? undefined : "Pack"
                  }
                  strip={mark?.strip}
                  change={mark?.change}
                  stamp={mark?.stamp}
                  switchedOff={mark?.switchedOff}
                  actionLabel={mark === null ? undefined : "Move back"}
                  onAction={
                    mark === null
                      ? undefined
                      : () =>
                          setMoving({ from: "picked", destinationId: row.shopId })
                  }
                  tags={changeTags(placement.shop.get(row.shopId) ?? [])}
                  ack={ackOf(placement.shop.get(row.shopId))}
                  drag={{ lane: "to-pack", card: row.shopId }}
                />
              )
            })}
          </Lane>

          <Lane
            id="packed"
            tone="bg-body"
            title="Pack"
            pieces={sum(sealed, (one) => one.unit_count)}
            cards={sealed.length}
            onDropCard={moveCard}
            summary={
              <div className="flex items-center justify-between gap-3">
                <span>
                  {count(sealed.length)}{" "}
                  {sealed.length === 1 ? "carton" : "cartons"}
                </span>
                <Checkbox
                  label="Select All"
                  checked={sealedReady > 0 && sealedPicked === sealedReady}
                  indeterminate={sealedPicked > 0 && sealedPicked < sealedReady}
                  disabled={sealedReady === 0}
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
            {sealed.map((one) => {
              const mark = markOf(
                owedIndex.koli.get(one.koli_id),
                one.unit_count
              )
              return (
                <Tile
                  key={one.koli_id}
                  to="/operations/packing"
                  sheet={{ key: "koli", value: one.koli_id }}
                  title={shop(one.destination_store_id)}
                  sub={one.koli_number}
                  meta={
                    one.position === "SHIPMENT"
                      ? "On a delivery note"
                      : undefined
                  }
                  pieces={one.unit_count}
                  pick={pickOf(one)}
                  strip={mark?.strip}
                  change={mark?.change}
                  stamp={mark?.stamp}
                  switchedOff={mark?.switchedOff}
                  actionLabel={mark === null ? undefined : "Move back"}
                  onAction={
                    mark === null
                      ? undefined
                      : () =>
                          setMoving({
                            from: "packed",
                            destinationId: one.destination_store_id,
                            koliId: one.koli_id,
                          })
                  }
                  tags={changeTags(placement.koli.get(one.koli_id) ?? [])}
                  ack={ackOf(placement.koli.get(one.koli_id))}
                  drag={{ lane: "packed", card: one.koli_id }}
                />
              )
            })}
          </Lane>

          <Lane
            id="in-transit"
            tone="bg-info"
            title="Dispatch"
            pieces={sum(onRoad, (one) => one.unit_count)}
            cards={onRoad.length}
            problem={shipments.isError ? shipments.error : undefined}
            onDropCard={moveCard}
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
                  meta={`${count(one.koli_count)} ${one.koli_count === 1 ? "carton" : "cartons"}`}
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
      <MoveBackDialog target={moving} onClose={() => setMoving(null)} />
    </PageContent>
  )
}

function Header({ actions }: { actions?: React.ReactNode }) {
  return (
    <BoardHeader
      board="stores"
      actions={actions}
      closeTo="/operations/intake"
    />
  )
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
      meta={`${count(one.koli_count)} ${one.koli_count === 1 ? "carton" : "cartons"}`}
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

/// When each trip left, by its id. A delivery note carries no time of its own.
function departures(trips: readonly Dispatch[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const trip of trips) {
    if (trip.departed_at !== null) map.set(trip.dispatch_id, trip.departed_at)
  }
  return map
}
