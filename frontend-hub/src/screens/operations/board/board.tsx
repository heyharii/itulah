import { useQueries } from "@tanstack/react-query"
import { Search, Truck } from "lucide-react"
import { useMemo, useState } from "react"

import { DockPortal } from "@/components/shell/dock"
import { DockTools } from "@/components/shell/dock-tools"
import { useLayout } from "@/lib/layout"

import { PageContent } from "@/components/shell/app-shell"
import { useShopName } from "@/components/operations/outbound-papers"
import { Button } from "@/components/ui/button"
import { Input, Select } from "@/components/ui/field"
import { ErrorState, LoadingState } from "@/components/ui/states"
import { dc } from "@/lib/api"
import { count } from "@/lib/format"
import { useAcknowledgeChanges } from "@/lib/operations/acknowledge"
import {
  dcChanges,
  owedWork,
  shortPicks,
  type DcChange,
} from "@/lib/operations/changes"
import { articlePickKey, useArticlePicks } from "@/lib/operations/article-picks"
import { keys } from "@/lib/operations/keys"
import { toast } from "@/lib/toast"
import type { PicklistSummary } from "@itulah/contract"

import {
  BoardHeader,
  Lane,
  Lanes,
  Tile,
} from "@/screens/operations/board/parts"
import type { DraggedCard } from "@/screens/operations/board/drag-state"
import { useSheet } from "@/lib/sheets"
import { cn } from "@/lib/utils"
import { BoardDnd } from "@/screens/operations/board/drag"
import {
  useDropRef,
  useDropTarget,
} from "@/screens/operations/board/drag-state"
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
import { DispatchedSheet } from "@/screens/operations/board/dispatched"
import {
  ArticlePhotos,
  KoliPhotos,
  PilePhotos,
} from "@/screens/operations/board/photos"
import { onTheRoad, tripsOf } from "@/screens/operations/board/trips"

/// Same interval as the rail's badges (`lib/operations/waiting.ts`), so a lane
/// and the badge beside it never disagree for longer than one poll.
const POLL_MS = 30_000

/// A received delivery note stays on the board this long; one still short
/// stays until it is not, however old.
const RECEIVED_DAYS = 7

/// **Board: every outbound piece of work in the building, in one view.**
///
/// Three lanes, each named by the next thing done (owner, 15 Oct 2026, from
/// allotment-ops-prototype.html):
///
/// **Pick** (a picklist per allotment × store) → **Pack** (a store's picked
/// pieces still standing in the pick area) → **Dispatch** (a card per store
/// listing every koli it has sealed and not sent). What has left sits behind
/// one **Dispatched** button: every trip by day with what the stores
/// received, since receiving is the store's step, not a lane.
///
/// A card's one button is its next physical step; red only where pieces have
/// to be put back. It moves nothing by itself: every card opens the sheet
/// that does the work.
///
/// The three lanes never fold and share the width: nothing written sideways.
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
  ] = useQueries({
    queries: [
      {
        queryKey: keys.picklistsToPick(),
        queryFn: ({ signal }: { signal: AbortSignal }) =>
          dc.picklistsToPick(signal),
        refetchInterval: POLL_MS,
      },
      {
        queryKey: keys.picklists(),
        queryFn: ({ signal }: { signal: AbortSignal }) => dc.picklists(signal),
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
  })

  /// Where the Put back dialog stands, when it is open.
  const [moving, setMoving] = useState<MoveBackTarget | null>(null)
  const owedIndex = useMemo(() => indexOwed(owed.data ?? []), [owed.data])
  const shortMarks = useMemo(
    () => shortPickMarks(shorts.data ?? []),
    [shorts.data]
  )

  /// What the Dispatch sheet was opened with; dropped when it closes.
  const [handoff, setHandoff] = useState<ReadonlySet<string> | null>(null)
  const sheetOpen = dispatchSheet.value === true
  const [wasSheetOpen, setWasSheetOpen] = useState(sheetOpen)
  if (sheetOpen !== wasSheetOpen) {
    setWasSheetOpen(sheetOpen)
    if (!sheetOpen) setHandoff(null)
  }
  /// The Dispatched history, folded behind its button.
  const [history, setHistory] = useState(false)
  /// Only the cards someone has to look at: a short pick, something to put
  /// back, something MD changed.
  const [attention, setAttention] = useState(false)

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

  // One card per article per store (owner, 16 Oct 2026).
  const allPicks = useArticlePicks(toPick.data)
  const allToPack = useMemo(
    () => waitingByShop(picklists.data ?? []),
    [picklists.data]
  )
  const allSealed = (koli.data ?? []).filter(
    (one) => one.position === "PACKED" || one.position === "SHIPMENT"
  )
  /// A koli holding pieces MD took out cannot go on a trip: the server
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
  /// A store MD took to nothing is a cancel for the Gudang, whichever way MD
  /// did it (a whole cancel, or the store's lines edited down to 0).
  const isCancel = (one: DcChange) => one.cancelled || one.now_total === 0
  /// The band over a card MD changed and nobody opened yet (owner, 16 Oct
  /// 2026: a marker on top of the card, not a corner ribbon).
  const EDITED = { tone: "info" as const, label: "Edited by MD" }
  /// The "OK" of a leftover card carrying these changes: the only button
  /// left from the old "Got it" — every other card's change is seen by
  /// opening its work (allotment-ops-prototype, 15 Oct 2026).
  const ackOf = (items: readonly DcChange[] | undefined, label = "OK") =>
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

  /// Opens the Dispatch sheet with these koli going; `null` = every ready
  /// store ticked (allotment-ops-prototype: "Dispatch opens with every ready
  /// store ticked").
  const dispatchOf = (ids: ReadonlySet<string> | null) => {
    setHandoff(ids)
    void dispatchSheet.open(true)
  }
  const readyIds = new Set(
    allSealed.filter((one) => !held(one.koli_id)).map((one) => one.koli_id)
  )
  const dispatchAll = () => {
    if (readyIds.size === 0) {
      toast("Put back what MD took out before a koli can go")
      return
    }
    dispatchOf(readyIds.size < allSealed.length ? readyIds : null)
  }

  /// Where a dropped card may go, and what the drop opens — never a write:
  /// the sheet that owns the step asks first. Going back asks the same
  /// question from every door: **Put back**, with the lines prefilled.
  const backFromStore =
    (to: "picked" | "pick") =>
    (card: string): void => {
      const first = allSealed.find((one) => one.destination_store_id === card)
      if (first !== undefined)
        setMoving({
          from: "packed",
          to,
          destinationId: card,
          koliId: first.koli_id,
        })
    }
  /// Opens the Dispatch sheet with this store's free koli; a store whose koli
  /// all owe pieces opens Put back instead (prototype: "Put back first").
  const dispatchStore = (card: string) => {
    const mine = allSealed.filter((one) => one.destination_store_id === card)
    const free = mine.filter((one) => !held(one.koli_id))
    if (free.length > 0) {
      dispatchOf(new Set(free.map((one) => one.koli_id)))
      return
    }
    const owing = mine.find((one) => held(one.koli_id))
    if (owing !== undefined)
      setMoving({ from: "packed", destinationId: card, koliId: owing.koli_id })
  }
  /// The drops of allotment-ops-prototype: forward opens the step's sheet,
  /// back opens Put back (Pack → Pick) or the store's koli (Dispatch → Pack).
  const DROPS: Record<string, (card: string) => void> = {
    "pick>pack": (card) => accepting.open(card),
    "pack>dispatch": (card) => packing.open(card),
    "pack>pick": (card) =>
      setMoving({ from: "picked", to: "pick", destinationId: card }),
    "dispatch>pack": backFromStore("picked"),
    "dispatch>dispatched": dispatchStore,
  }
  const LANE_ORDER: Record<string, number> = {
    pick: 0,
    pack: 1,
    dispatch: 2,
    dispatched: 3,
  }

  /// A card dropped on a lane. A phone has no lanes, so no drag.
  function moveCard(moved: DraggedCard, lane: string) {
    if (phone || moved.lane === lane) return
    if ((LANE_ORDER[lane] ?? 0) > (LANE_ORDER[moved.lane] ?? 0)) {
      // A Pack card MD reduced still packs what is wanted of it (owner, 10 Oct
      // 2026; the server caps the pack at that): it is stopped only when
      // nothing is wanted any more.
      const owedHere =
        moved.lane === "pack" ? owedIndex.shop.get(moved.card) : undefined
      const wanted =
        (allToPack.find((row) => row.shopId === moved.card)?.pieces ?? 0) -
        (owedHere?.pieces ?? 0)
      if (owedHere !== undefined && owedHere.pieces > 0 && wanted <= 0) {
        toast(`Put back ${count(owedHere.pieces)} pcs first`)
        setMoving({ from: "picked", destinationId: moved.card })
        return
      }
    }
    DROPS[`${moved.lane}>${lane}`]?.(moved.card)
  }

  const trips = useMemo(
    () =>
      tripsOf(
        dispatches.data ?? [],
        shipments.data ?? [],
        received.data?.items ?? []
      ),
    [dispatches.data, shipments.data, received.data]
  )
  const historyTrips = trips.filter(
    (one) =>
      (store === "" ||
        one.stops.some(
          (stop) => stop.shipment.destination_store_id === store
        )) &&
      (needle === "" ||
        [
          one.number,
          ...one.stops.map((stop) => shop(stop.shipment.destination_store_id)),
        ].some((text) => text.toLowerCase().includes(needle)))
  )
  const roadCount = trips.filter(onTheRoad).length

  /// One Dispatch card per store: every koli it has sealed and not sent,
  /// numbered from 1 for that store (prototype: "Koli 1 · KOLI-0003").
  const allByStore = (() => {
    const by = new Map<string, typeof allSealed>()
    for (const one of [...allSealed].sort((left, right) =>
      (left.sealed_at ?? "").localeCompare(right.sealed_at ?? "")
    )) {
      const list = by.get(one.destination_store_id) ?? []
      list.push(one)
      by.set(one.destination_store_id, list)
    }
    return [...by.entries()].map(([shopId, list]) => ({ shopId, koli: list }))
  })()

  const pickNeeds = (pick: (typeof allPicks)[number]) => {
    const key = pickCardKey(pick.allotment_id, pick.destination_id)
    return shortMarks.has(key) || (placement.pick.get(key)?.length ?? 0) > 0
  }
  const picks = [...allPicks]
    .filter((one) => keep(one.destination_id, one.allotment_number))
    .filter((one) => !attention || pickNeeds(one))
    .sort((left, right) => left.created_at.localeCompare(right.created_at))
  const aloneChanges = placement.alone.filter((one) =>
    keep(one.destination_id, one.allotment_number)
  )
  const toPack = allToPack
    .filter((row) => keep(row.shopId, ...row.allotments))
    .filter(
      (row) =>
        !attention ||
        owedIndex.shop.has(row.shopId) ||
        (placement.shop.get(row.shopId)?.length ?? 0) > 0
    )
  const byStore = allByStore
    .filter((row) =>
      keep(row.shopId, ...row.koli.map((one) => one.koli_number))
    )
    .filter(
      (row) =>
        !attention ||
        row.koli.some(
          (one) =>
            held(one.koli_id) ||
            (placement.koli.get(one.koli_id)?.length ?? 0) > 0
        )
    )
  const koliShown = sum(byStore, (row) => row.koli.length)

  /// Every store with a card anywhere on the board, for the filter.
  const stores = [
    ...new Set([
      ...allPicks.map((one) => one.destination_id),
      ...allToPack.map((one) => one.shopId),
      ...allSealed.map((one) => one.destination_store_id),
    ]),
  ]
    .map((id) => ({ id, name: shop(id) || id }))
    .sort((left, right) => left.name.localeCompare(right.name))

  const attentionButton = (
    <Button
      variant={attention ? "tint" : "ghost"}
      className="h-11"
      aria-pressed={attention}
      onClick={() => setAttention(!attention)}
    >
      Needs attention
    </Button>
  )
  const historyButton = (
    <DispatchedButton
      trips={roadCount}
      onOpen={() => setHistory(true)}
      onDropCard={moveCard}
    />
  )
  const filters = (
    <>
      <label className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-mute" />
        <Input
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          aria-label="Search article or store"
          placeholder="Search article or store"
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
      {attentionButton}
      {historyButton}
    </>
  )

  /// A store's Dispatch card: what it holds, what MD wants out of it, and
  /// the koli that may go now.
  const storeCard = (row: (typeof byStore)[number]) => {
    const owedPieces = sum(
      row.koli,
      (one) => owedIndex.koli.get(one.koli_id)?.pieces ?? 0
    )
    const firstOwed = row.koli.find((one) => held(one.koli_id))
    const free = new Set(
      row.koli.filter((one) => !held(one.koli_id)).map((one) => one.koli_id)
    )
    const here = row.koli.flatMap(
      (one) => placement.koli.get(one.koli_id) ?? []
    )
    /// Opening the store's work is seeing MD's change on it.
    const seen = () => {
      if (here.length > 0) acknowledge.mutate(here)
    }
    return {
      pieces: sum(row.koli, (one) => one.unit_count),
      owedPieces,
      putBack:
        firstOwed === undefined
          ? undefined
          : () => {
              seen()
              setMoving({
                from: "packed",
                destinationId: row.shopId,
                koliId: firstOwed.koli_id,
              })
            },
      dispatch:
        free.size === 0
          ? undefined
          : () => {
              seen()
              // Every ready store ticked, this one among them.
              dispatchAll()
            },
      here,
      lines: row.koli.map((one, index) => ({
        key: one.koli_id,
        label: `Koli ${index + 1}`,
        code: one.koli_number,
        pieces: one.unit_count,
        owed: owedIndex.koli.get(one.koli_id)?.pieces,
      })),
    }
  }

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
        key: `pick~${articlePickKey(pick)}`,
        stage: stage("pick", "Pick", "bg-mute", 0),
        title: pick.article_name ?? pick.article_code,
        doc: `${shop(pick.destination_id)} · ${pick.allotment_number}`,
        detail: many(pick.lines.length, "SKU"),
        pieces: pick.pieces,
        at: pick.created_at,
        act: "Pick",
        mark: short === undefined ? undefined : shortCard(short).row,
        tags: changeTags(placement.pick.get(key) ?? []),
        dot: (placement.pick.get(key)?.length ?? 0) > 0,
        onOpen: () => accepting.open(articlePickKey(pick)),
      }
    }),
    // A picklist MD cancelled while it was still to pick has no card of its
    // own any more: it stays as one until the Gudang acknowledges it.
    ...aloneChanges.map((one) => ({
      key: `change~${changeId(one)}`,
      stage: stage("pick", "Pick", "bg-mute", 0),
      title: shop(one.destination_id),
      doc: one.allotment_number,
      pieces: 0,
      at: one.at,
      tags: changeTags([one]),
      stamp: isCancel(one) ? "CANCELLED" : undefined,
      off: isCancel(one),
      ack: ackOf([one]),
    })),
    ...toPack.map((row) => {
      const mark = markOf(owedIndex.shop.get(row.shopId), row.pieces)
      return {
        key: `pack~${row.shopId}`,
        stage: stage("pack", "Pack", "bg-warn", 1),
        title: shop(row.shopId),
        doc:
          row.allotments.length === 1
            ? row.allotments[0]
            : `${row.allotments.length} allotments`,
        detail: many(row.allotments.length, "allotment"),
        pieces: row.pieces,
        at: row.lastPickedAt,
        act: mark === null ? "Pack" : "Put back",
        mark: mark?.row,
        tags: changeTags(placement.shop.get(row.shopId) ?? []),
        dot: (placement.shop.get(row.shopId)?.length ?? 0) > 0,
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
    ...byStore.map((row) => {
      const card = storeCard(row)
      return {
        key: `dispatch~${row.shopId}`,
        stage: stage("dispatch", "Dispatch", "bg-info", 2),
        title: shop(row.shopId),
        doc: `${count(row.koli.length)} koli`,
        pieces: card.pieces,
        at: row.koli[0]?.sealed_at,
        act: card.putBack !== undefined ? "Put back" : "Dispatch",
        mark:
          card.owedPieces > 0
            ? {
                tone: "bad" as const,
                text: `Take out ${count(card.owedPieces)}`,
                detail: "MD took these out; put them back before the koli goes",
              }
            : undefined,
        tags: changeTags(card.here),
        dot: card.here.length > 0,
        moveBack: card.putBack,
        onOpen: card.dispatch,
      }
    }),
  ]

  const edgeFailed = [toPick, picklists, koli].find((query) => query.isError)
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
    <BoardDnd>
      <PageContent fill>
        {/* On a phone the search and the store are the dock's, as on every
      list; the desk keeps them in its header. */}
        <Header actions={phone ? undefined : filters} />
        {phone && (
          <DockTools
            search={{
              value: typed,
              onChange: setTyped,
              label: "Search article or store",
            }}
            // Needs attention is the phone's one filter: on or off.
            filter={{
              count: attention ? 1 : 0,
              onOpen: () => setAttention(!attention),
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
        )}
        {/* On a phone each Dispatch row has its own button; the dock's one
      button is the Dispatched history. */}
        {phone && (
          <DockPortal slot="action">
            <button
              type="button"
              aria-label={`Dispatched ${count(roadCount)}`}
              title="Dispatched"
              onClick={() => setHistory(true)}
              className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-cta text-cta-fg shadow-soft transition-[scale] duration-(--t-press) ease-(--ease-out) active:scale-[0.96]"
            >
              <Truck className="size-5" />
            </button>
          </DockPortal>
        )}
        {view === "table" ? (
          <StageTable
            rows={rows}
            empty="Nothing matches."
            refresh={[toPick, picklists, koli, shipments, dispatches, received]}
          />
        ) : (
          <Lanes board="outbound">
            <Lane
              id="pick"
              tone="bg-mute"
              title="Pick"
              empty="Nothing to pick"
              pieces={sum(picks, (pick) => pick.pieces)}
              cards={picks.length + aloneChanges.length}
              onDropCard={moveCard}
              folds={false}
              total={false}
              accepts={{ pack: "Put back" }}
            >
              {picks.map((pick) => {
                const key = pickCardKey(pick.allotment_id, pick.destination_id)
                const short = shortMarks.get(key)
                const here = placement.pick.get(key)
                return (
                  <Tile
                    key={articlePickKey(pick)}
                    to="/operations/picking"
                    onOpen={() => accepting.open(articlePickKey(pick))}
                    // The article and its pieces lead; the store and the
                    // allotment are the second line (owner, 16 Oct 2026).
                    title={pick.article_name ?? pick.article_code}
                    sub={`${shop(pick.destination_id)} · ${pick.allotment_number}`}
                    photos={
                      <ArticlePhotos
                        skus={pick.lines.map((line) => line.sku_code)}
                      />
                    }
                    meta={many(pick.lines.length, "SKU")}
                    pieces={pick.pieces}
                    act="Pick"
                    strip={
                      short !== undefined
                        ? shortCard(short).strip
                        : (here?.length ?? 0) > 0
                          ? EDITED
                          : undefined
                    }
                    tags={changeTags(here ?? [])}
                    drag={{
                      lane: "pick",
                      card: articlePickKey(pick),
                    }}
                  />
                )
              })}
              {aloneChanges.map((one) => (
                <Tile
                  key={`change~${changeId(one)}`}
                  to="/operations/picking"
                  // Nothing left to open: a press on it is its OK, never a
                  // trip to another screen.
                  onOpen={() => acknowledge.mutate([one])}
                  title={shop(one.destination_id)}
                  sub={one.allotment_number}
                  pieces={0}
                  strip={
                    isCancel(one)
                      ? { tone: "bad", label: "Cancelled by MD" }
                      : EDITED
                  }
                  stamp={isCancel(one) ? "CANCELLED" : undefined}
                  switchedOff={isCancel(one)}
                  tags={changeTags([one])}
                  ack={ackOf([one])}
                />
              ))}
            </Lane>

            <Lane
              id="pack"
              tone="bg-warn"
              title="Pack"
              empty="Nothing to pack"
              pieces={sum(toPack, (row) => row.pieces)}
              cards={toPack.length}
              onDropCard={moveCard}
              folds={false}
              total={false}
              accepts={{ pick: "Pick", dispatch: "Unpack" }}
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
                    photos={<PilePhotos sessions={row.sessions} />}
                    meta={many(row.allotments.length, "allotment")}
                    pieces={row.pieces}
                    unit={row.pieces === 1 ? "pc picked" : "pcs picked"}
                    // MD reduced it: what is still wanted can be packed, so the
                    // hint stays beside Put back; nothing wanted, no hint.
                    act={
                      mark !== null && mark.owed >= row.pieces
                        ? undefined
                        : "Pack"
                    }
                    strip={
                      mark?.strip ??
                      ((placement.shop.get(row.shopId)?.length ?? 0) > 0
                        ? EDITED
                        : undefined)
                    }
                    change={mark?.change}
                    stamp={mark?.stamp}
                    switchedOff={mark?.switchedOff}
                    actionLabel={mark === null ? undefined : "Put back"}
                    onAction={
                      mark === null
                        ? undefined
                        : () =>
                            setMoving({
                              from: "picked",
                              destinationId: row.shopId,
                            })
                    }
                    tags={changeTags(placement.shop.get(row.shopId) ?? [])}
                    drag={{
                      lane: "pack",
                      card: row.shopId,
                      owed: mark !== null && mark.owed >= row.pieces,
                    }}
                  />
                )
              })}
            </Lane>

            <Lane
              id="dispatch"
              tone="bg-info"
              title="Dispatch"
              empty="Nothing to dispatch"
              pieces={sum(byStore, (row) =>
                sum(row.koli, (one) => one.unit_count)
              )}
              cards={byStore.length}
              onDropCard={moveCard}
              folds={false}
              total={false}
              accepts={{ pack: "Pack" }}
              foot={`${count(koliShown)} koli · ${count(
                sum(byStore, (row) => sum(row.koli, (one) => one.unit_count))
              )} pcs`}
            >
              {byStore.map((row) => {
                const card = storeCard(row)
                return (
                  <Tile
                    key={row.shopId}
                    to="/operations/despatch"
                    onOpen={card.dispatch ?? card.putBack}
                    title={shop(row.shopId)}
                    photos={
                      <KoliPhotos koli={row.koli.map((one) => one.koli_id)} />
                    }
                    meta={`${count(card.pieces)} pcs`}
                    pieces={row.koli.length}
                    unit="koli"
                    lines={card.lines}
                    act={card.dispatch === undefined ? undefined : "Dispatch"}
                    actionLabel={
                      card.putBack === undefined
                        ? undefined
                        : `Put back ${count(card.owedPieces)}`
                    }
                    onAction={card.putBack}
                    tags={changeTags(card.here)}
                    strip={card.here.length > 0 ? EDITED : undefined}
                    drag={{
                      lane: "dispatch",
                      card: row.shopId,
                      owed: card.dispatch === undefined,
                    }}
                  />
                )
              })}
            </Lane>
          </Lanes>
        )}
        <PickSheets />
        <PackSheets />
        <ShipmentSheets />
        <DispatchSheet only={handoff} />
        <MoveBackDialog target={moving} onClose={() => setMoving(null)} />
        <DispatchedSheet
          open={history}
          onClose={() => setHistory(false)}
          trips={historyTrips}
          shop={shop}
        />
      </PageContent>
    </BoardDnd>
  )
}

/// The Dispatched history behind its button; a Dispatch card dropped on it
/// opens that store's trip (the prototype's "Dispatched" fold, upright: the
/// board is three lanes and nothing on it is written sideways).
function DispatchedButton({
  trips,
  onOpen,
  onDropCard,
}: {
  trips: number
  onOpen: () => void
  onDropCard: (card: DraggedCard, lane: string) => void
}) {
  const target = { accepts: { dispatch: "Dispatch" }, onDrop: onDropCard }
  const dropRef = useDropRef("dispatched", target)
  const drop = useDropTarget("dispatched", target)
  return (
    <span ref={dropRef} className="relative">
      <Button
        variant={drop.mode === "over" ? "tint" : "ghost"}
        className={cn(
          "h-11",
          drop.mode === "can" &&
            "outline-[1.5px] outline-hairline-strong outline-dashed",
          drop.mode === "over" &&
            "outline-[1.5px] outline-accent outline-dashed",
          drop.mode === "no" && "opacity-45"
        )}
        onClick={onOpen}
      >
        <Truck />
        {drop.mode === "can" || drop.mode === "over"
          ? drop.hint
          : `Dispatched ${count(trips)}`}
      </Button>
    </span>
  )
}

/// The board's head is the page head, in the shell like every other page
/// (owner, 14 Oct: "tetap ada sidebarnya"); the lanes below are unchanged.
function Header({ actions }: { actions?: React.ReactNode }) {
  return <BoardHeader board="stores" actions={actions} />
}

interface ShopToPack {
  readonly shopId: string
  readonly pieces: number
  readonly picklists: number
  readonly allotments: readonly string[]
  readonly lastPickedAt: string | null
  /// The picklists holding the pile, for its pictures.
  readonly sessions: readonly string[]
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
      sessions: string[]
    }
  >()
  for (const round of rounds) {
    if (round.waiting <= 0 || round.destination_id === null) continue
    const row = by.get(round.destination_id) ?? {
      pieces: 0,
      picklists: 0,
      allotments: new Set<string>(),
      last: null,
      sessions: [],
    }
    row.pieces += round.waiting
    row.picklists += 1
    row.sessions.push(round.session.session_id)
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
      sessions: row.sessions,
    }))
    .sort((left, right) =>
      (left.lastPickedAt ?? "").localeCompare(right.lastPickedAt ?? "")
    )
}
