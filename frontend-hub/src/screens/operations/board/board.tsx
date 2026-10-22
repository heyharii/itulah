import { useQueries, useQuery } from "@tanstack/react-query"
import { Search } from "lucide-react"
import { useMemo, useState } from "react"
import { useOpenReviews } from "@/screens/allotment/review-data"

import { DockTools } from "@/components/shell/dock-tools"
import { useLayout } from "@/lib/layout"
import { useColourwayFill } from "@/lib/colourway-fill"
import { useCatalogueIdentity } from "@/lib/operations/catalogue"

import { PageContent } from "@/components/shell/app-shell"
import { useShopName } from "@/components/operations/outbound-papers"
import { Button } from "@/components/ui/button"
import { Input, Select } from "@/components/ui/field"
import { RefreshStrip } from "@/components/ui/refresh-stamp"
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states"
import { dc } from "@/lib/api"
import {
  dcChanges,
  owedWork,
  shortPicks,
  type DcChange,
} from "@/lib/operations/changes"
import {
  articlePickKey,
  useArticlePicks,
  type ArticlePick,
} from "@/lib/operations/article-picks"
import { keys } from "@/lib/operations/keys"
import {
  allotmentDetail,
  inventoryKeys,
  listAllotments,
} from "@/lib/queries/inventory"
import type { PicklistSummary } from "@itulah/contract"

import { BoardHeader } from "@/screens/operations/board/parts"
import { useSheet } from "@/lib/sheets"
import {
  DispatchSheet,
  ShipmentSheets,
} from "@/screens/operations/despatch/trucks"
import { PackSheets } from "@/screens/operations/packing/packing"
import { PickSheets } from "@/screens/operations/picking/picking"
import { MoveBackDialog } from "@/screens/operations/board/move-back"
import {
  changeTags,
  continuedMarks,
  indexOwed,
  markOf,
  pickCardKey,
  placeChanges,
  shortCard,
  shortPickMarks,
  type MoveBackTarget,
} from "@/screens/operations/board/owed"
import {
  KoliDialog,
  type KoliRef,
} from "@/screens/operations/board/koli-dialog"
import { TripSheet } from "@/screens/operations/board/trip-sheet"
import { BoardTables } from "@/screens/operations/board/tables"
import { receivedShipments } from "@/screens/operations/board/received"
import { onTheRoad, tripsOf } from "@/screens/operations/board/trips"

/// Same interval as the rail's badges (`lib/operations/waiting.ts`), so a lane
/// and the badge beside it never disagree for longer than one poll.
const POLL_MS = 30_000

/// A received delivery note stays on the board this long; one still short
/// stays until it is not, however old.
const RECEIVED_DAYS = 7

/// **Board: every outbound piece of work in the building, in one view.**
///
/// Five tabs with icons, one table each (owner, 21 Oct 2026, from
/// allotment-ops-table.html E — "gini saja table"; the kanban is gone for
/// now, "ga usah ada board dlu"): Picklist → Picked → Packed → In transit →
/// Received. Picklist and Picked carry a rail of stores; the verbs stand in
/// the bar above the table; every row opens the sheet that does the work —
/// the Pick sheet, the Pack sheet (only a sealed koli is made), the Dispatch
/// sheet, a koli, a trip. Every way back is red and one tab to the left:
/// Back to Picklist and Unpack go through the Move back dialog. Laid out in
/// `tables.tsx`; the reads, the marks and the sheets stay here.
export function Board() {
  const accepting = useSheet("accept")
  const dispatchSheet = useSheet("new-dispatch")
  const packing = useSheet("pack")
  const shop = useShopName()
  const layout = useLayout()
  const phone = layout === "phone"
  /// The koli whose contents are open over the board, and the trip whose
  /// sheet is.
  const [koliOpen, setKoliOpen] = useState<KoliRef | null>(null)
  const [tripId, setTripId] = useState<string | null>(null)
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
  const continued = useMemo(
    () => continuedMarks(shorts.data ?? []),
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
  const identities = useCatalogueIdentity()
  const fill = useColourwayFill()
  const [typed, setTyped] = useState("")
  const [store, setStore] = useState("")
  const needle = typed.trim().toLowerCase()
  /// Pack and Dispatch cards name no article: while a search is typed, the
  /// allotments in progress are read line by line, and every allotment and
  /// store sending an article that matches is kept as well.
  const inProgress = useQuery({
    queryKey: inventoryKeys.allotmentList("TO_STORE", "ACTIVE"),
    queryFn: ({ signal }) => listAllotments("TO_STORE", "ACTIVE", signal),
    enabled: needle !== "",
  })
  const details = useQueries({
    queries: (needle === "" ? [] : (inProgress.data?.items ?? [])).map(
      (row) => ({
        queryKey: inventoryKeys.allotment(row.id),
        queryFn: ({ signal }: { signal: AbortSignal }) =>
          allotmentDetail(row.id, signal),
      })
    ),
  })
  const articleHits = new Set<string>()
  for (const detail of details) {
    for (const line of detail.data?.lines ?? []) {
      const words = `${line.article_code} ${line.article_name}`.toLowerCase()
      if (!words.includes(needle)) continue
      articleHits.add(`${detail.data!.allotment_number}~${line.destination_id}`)
      articleHits.add(`~${line.destination_id}`)
    }
  }
  /// A card is kept when it is the chosen store's and its store or any of its
  /// documents contain what was typed.
  const keep = (shopId: string, ...docs: (string | null | undefined)[]) =>
    (store === "" || shopId === store) &&
    (needle === "" ||
      [shop(shopId), ...docs].some((text) =>
        (text ?? "").toLowerCase().includes(needle)
      ) ||
      docs.some((doc) => articleHits.has(`${doc}~${shopId}`)))

  // One card per article per store (owner, 16 Oct 2026). A picklist MD
  // cancelled is never one to pick (owner, 21 Oct 2026: "cancel jangan ada di
  // picklist lagi", "langsung hilang saja"): the server stops listing it,
  // and until the next poll says so it is gone already. No OK is asked.
  const listedPicks = useArticlePicks(toPick.data)
  const cancelledPicks = new Set(
    (changes.data ?? [])
      .filter((one) => one.cancelled)
      .map((one) => pickCardKey(one.allotment_id, one.destination_id))
  )
  const allPicks = listedPicks.filter(
    (one) => !cancelledPicks.has(pickCardKey(one.allotment_id, one.destination_id))
  )
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
    new Map(allToPack.map((row) => [row.shopId, new Set(row.allotments)])),
    allSealed.map((one) => ({
      koli_id: one.koli_id,
      destination_id: one.destination_store_id,
    })),
    owed.data ?? []
  )
  /// MD's changes to this row's article only: a change is kept per
  /// allotment × store, and a row is one article of it, so the other
  /// articles of the store do not wear its tag. Matched by article, not SKU:
  /// a SKU edited to 0 is no longer on the row.
  const pickChanges = (pick: ArticlePick): DcChange[] => {
    const mine = (sku: string) =>
      (identities.get(sku)?.article_code ?? sku) === pick.article_code
    return (
      placement.pick.get(pickCardKey(pick.allotment_id, pick.destination_id)) ??
      []
    ).flatMap((one) => {
      if (one.cancelled) return [one]
      const lines = one.lines.filter((line) => mine(line.sku_code))
      if (lines.length === 0) return []
      return [
        {
          ...one,
          lines,
          was_total: lines.reduce((total, line) => total + line.was, 0),
          now_total: lines.reduce((total, line) => total + line.now, 0),
        },
      ]
    })
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
    // Every koli holds pieces MD took out: open the Put back of the first one
    // rather than a toast that only says why nothing went.
    if (readyIds.size === 0) {
      const first = allSealed.find((one) => held(one.koli_id))
      if (first)
        setMoving({
          from: "packed",
          destinationId: first.destination_store_id,
          koliId: first.koli_id,
        })
      return
    }
    dispatchOf(readyIds.size < allSealed.length ? readyIds : null)
  }

  const openReview = useOpenReviews()
  const trips = useMemo(
    () =>
      tripsOf(
        dispatches.data ?? [],
        shipments.data ?? [],
        received.data?.items ?? []
      ),
    [dispatches.data, shipments.data, received.data]
  )
  /// A trip is kept when it stops at the chosen store and its number or a
  /// store on it contains what was typed.
  const keepTrip = (one: (typeof trips)[number]) =>
    (store === "" ||
      one.stops.some((stop) => stop.shipment.destination_store_id === store)) &&
    (needle === "" ||
      [
        one.number,
        ...one.stops.map((stop) => shop(stop.shipment.destination_store_id)),
      ].some((text) => text.toLowerCase().includes(needle)))
  /// Trips still on the road, and the ones every store on them has received
  /// (owner, 21 Oct 2026: "tambahin received ya, per trip saja").
  const transitTrips = trips.filter((one) => onTheRoad(one)).filter(keepTrip)
  const receivedTrips = trips
    .filter((one) => !onTheRoad(one) && one.left >= since)
    .filter(keepTrip)

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

  const picks = [...allPicks]
    .filter((one) =>
      keep(
        one.destination_id,
        one.allotment_number,
        one.article_code,
        one.article_name
      )
    )
    .sort((left, right) => left.created_at.localeCompare(right.created_at))
  const toPack = allToPack.filter((row) =>
    keep(row.shopId, ...row.allotments)
  )
  const byStore = allByStore.filter(
    (row) =>
      keep(row.shopId, ...row.koli.map((one) => one.koli_number)) ||
      ((store === "" || row.shopId === store) &&
        articleHits.has(`~${row.shopId}`))
  )

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
    </>
  )

  /// Something narrows the board: an empty lane then says nothing matched,
  /// not that there is no work (allotment-board-options, 17 Oct 2026).
  const narrowed = needle !== "" || store !== ""
  const clear = () => {
    setTyped("")
    setStore("")
  }
  const emptyOf = (sentence: string) =>
    !narrowed ? (
      // Just the sentence, quiet, in the middle of the tray (pack-sheet-options:
      // "Nothing picked"), not an illustration.
      <p className="py-6 text-center text-body">{sentence}</p>
    ) : (
      <EmptyState
        art="search"
        action={
          <Button variant="ghost" onClick={clear}>
            Clear
          </Button>
        }
      >
        Nothing matches
      </EmptyState>
    )

  /// The band a picklist row wears: a short pick, or MD's word to go on.
  /// Pieces Pack sent back wear nothing (owner, 21 Oct 2026: "back from pack
  /// jg hapus ya").
  const pickFlag = (pick: ArticlePick) => {
    const key = pickCardKey(pick.allotment_id, pick.destination_id)
    const short = shortMarks.get(key)
    if (short !== undefined) return shortCard(short).strip
    const goOn = continued.get(key)
    if (goOn !== undefined)
      return { tone: "info" as const, label: "MD: continue picking", title: goOn }
    return undefined
  }
  const edgeFailed = [toPick, picklists, koli].find((query) => query.isError)
  if (toPick.isPending || picklists.isPending || koli.isPending) {
    return (
      <PageContent>
        <Header actions={phone ? undefined : filters} />
        <LoadingState>Reading the stations…</LoadingState>
      </PageContent>
    )
  }
  if (edgeFailed) {
    return (
      <PageContent fill>
        <Header actions={phone ? undefined : filters} />
        <ErrorState
          error={edgeFailed.error}
          onRetry={() => edgeFailed.refetch()}
        />
      </PageContent>
    )
  }

  return (
    <PageContent>
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
      {phone && (
        <RefreshStrip
          queries={[toPick, picklists, koli, shipments, dispatches, received]}
        />
      )}
      <BoardTables
        picks={picks}
        pickFlag={pickFlag}
        pickTags={(pick) => changeTags(pickChanges(pick))}
        storeTags={(shopId) =>
          (placement.shop.get(shopId) ?? []).flatMap((one) =>
            changeTags([one]).map((tag) => ({
              ...tag,
              allotment: one.allotment_number,
              at: one.at,
            }))
          )
        }
        koliTags={(koliId) => changeTags(placement.koli.get(koliId) ?? [])}
        onPick={(pick) => void accepting.open(articlePickKey(pick))}
        toPack={toPack}
        putBackOf={(shopId) => {
          const row = toPack.find((one) => one.shopId === shopId)
          const mark = markOf(owedIndex.shop.get(shopId), row?.pieces ?? 0)
          return mark === null ? null : mark.owed
        }}
        onPack={(shopId) => void packing.open(shopId)}
        onPutBack={(shopId) =>
          setMoving({ from: "picked", destinationId: shopId })
        }
        // Back to the picklist (owner, 21 Oct 2026, red as every way back):
        // the dialog asks how many of each, from none.
        onBackToPick={(shopId) =>
          setMoving({
            from: "picked",
            to: "pick",
            destinationId: shopId,
            back: true,
          })
        }
        sealed={byStore.flatMap((row) => row.koli)}
        heldOf={(koliId) => owedIndex.koli.get(koliId)?.pieces}
        onOpenKoli={setKoliOpen}
        // Unpack: the koli is opened again, its pieces Picked.
        onUnpack={(shopId, koliId) =>
          setMoving({
            from: "packed",
            to: "picked",
            destinationId: shopId,
            koliId,
          })
        }
        onKoliPutBack={(shopId, koliId) =>
          setMoving({ from: "packed", destinationId: shopId, koliId })
        }
        onDispatch={(ids) => (ids === null ? dispatchAll() : dispatchOf(ids))}
        transit={transitTrips}
        received={receivedTrips}
        onOpenTrip={setTripId}
        openReview={openReview}
        shop={shop}
        identities={identities}
        fill={fill}
        emptyOf={emptyOf}
      />
      <PickSheets />
      <PackSheets />
      <ShipmentSheets />
      <DispatchSheet
        only={handoff}
        // No drag any more: a sealed koli goes back to picked from the
        // Dispatch sheet, through the same Put back dialog the drop opened,
        // over the board rather than over a second sheet.
        // A koli not found or damaged goes back to Pick whole (owner,
        // 18 Oct 2026): no Cannot continue at Dispatch.
        onUnpack={(box) => {
          void dispatchSheet.close()
          setMoving({
            from: "packed",
            to: "pick",
            destinationId: box.destination_store_id,
            koliId: box.koli_id,
            back: true,
          })
        }}
      />
      <MoveBackDialog target={moving} onClose={() => setMoving(null)} />
      <KoliDialog koli={koliOpen} onClose={() => setKoliOpen(null)} />
      <TripSheet
        trip={trips.find((one) => one.trip.dispatch_id === tripId) ?? null}
        onClose={() => setTripId(null)}
        shop={shop}
      />
    </PageContent>
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
