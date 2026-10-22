import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { Check, Printer, Store, Truck } from "lucide-react"
import { useMemo, useRef, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { DockTools } from "@/components/shell/dock-tools"
import {
  PackingListPrint,
  SuratJalanPrintFlow,
  type SuratJalanTarget,
  useShopName,
} from "@/components/operations/outbound-papers"
import { AppLink } from "@/components/ui/app-link"
import { Button } from "@/components/ui/button"
import { FilterChips } from "@/components/ui/filter-chips"
import { DocStamp } from "@/components/ui/doc-stamp"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { DataTable, dockSortOf } from "@/components/ui/data-table"
import { ConfirmButton } from "@/components/ui/dialog"
import { Fab } from "@/components/ui/fab"
import { Field, Textarea } from "@/components/ui/field"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { ExpandingSearch } from "@/components/ui/list-chrome"
import { PageHeader } from "@/components/ui/page-header"
import { Status } from "@/components/ui/pill"
import { MiniCell, MiniRow, MiniTable, Section } from "@/components/ui/rows"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { Banner, EmptyState, Problem } from "@/components/ui/states"
import { dc } from "@/lib/api"
import { clock, count, dayMonth, quantity } from "@/lib/format"
import { STAMP } from "@/screens/procurement/shared"
import { useLayout } from "@/lib/layout"
import { moveBack } from "@/lib/operations/changes"
import { keys } from "@/lib/operations/keys"
import { koliManifestQuery } from "@/lib/operations/queries"
import { toast } from "@/lib/toast"
import { tripDocumentNumber } from "@/lib/operations/trip-number"
import { queryState } from "@/lib/query-state"
import {
  advanceEach,
  type Progress,
} from "@/screens/operations/despatch/progress"
import { useEdgeActor, useEdgeIdentity } from "@/lib/edge-session"
import { useSheet } from "@/lib/sheets"
import { tableSetup, type TableSetup } from "@/lib/table"
import { cn } from "@/lib/utils"
import {
  KoliContentsDialog,
  KoliRow,
  Pop,
  PutOnTrip,
  TripChooser,
} from "@/screens/operations/despatch/koli-parts"
import {
  flyTo,
  pulse,
  tileOf,
} from "@/screens/operations/despatch/motion"
import type { Paper } from "@/screens/procurement/po-print"
import { idempotencyKey } from "@itulah/contract/client"
import type { Dispatch, Koli, Shipment } from "@itulah/contract"

/// Dispatch: tick sealed cartons onto one trip, and the delivery note is made
/// and sent in the same act.
///
/// **The owner's ruling of 29 Sep 2026 removes the Shipments station.** A
/// delivery note used to be written ahead of a trip, as its own document,
/// waiting on a dock for somebody to load a truck under it. Now there is
/// nothing to write ahead of time: this screen ticks the sealed cartons going
/// on a trip, shop by shop, takes one free-text note of whatever the bay
/// knows about the trip, and `POST /dc/dispatch-trips` makes one shipment per
/// shop, puts every ticked carton on it and departs the trip — generating the
/// delivery note IS sending it. The trip prints ONE delivery note covering every
/// shop (owner, 2 Oct 2026), numbered by the trip's `dispatch_number`. There is no "Ready to dispatch" status left to
/// draw anywhere: a sealed carton is either still here or it is in transit.
///
/// **Received is the shop's to say.** Nothing scans a delivery note back in
/// here; the centre tells this node as the shop counts the pieces in, and once
/// every piece is in the trip carries `received_at`. Until then a dispatched
/// shipment reads "In transit"; after, it wears the Received stamp with that
/// day (owner, 2026-10-14).
///
/// **Legacy runs.** A dispatch loaded before this screen existed can still be
/// sitting on the yard with `departed_at IS NULL`. Those are not reachable
/// through the one-button trip above — they were built the old way, document
/// then stock, one carton at a time — so they are listed under "Not departed"
/// with their own Depart, exactly as before, so nothing already loaded is
/// stranded.
export function Trucks() {
  const actor = useEdgeActor()
  const identity = useEdgeIdentity()
  const client = useQueryClient()
  const shopName = useShopName()
  const composing = useSheet("new-dispatch")
  const shipmentSheet = useSheet("shipment")
  const [sorting, setSorting] = useState<SortingState>([])
  const [typed, setTyped] = useState("")
  /// Cartons left OFF the trip, kept as what was unticked rather than what was
  /// ticked — every carton starts ticked, which is the ordinary case, and this
  /// is what makes that true without an effect that re-ticks them every time a
  /// shop is opened.
  const [progress, setProgress] = useState<Progress | null>(null)
  const [printing, setPrinting] = useState<Printing | null>(null)

  // Sealed and either on no delivery note yet, or on one still on the dock —
  // both are cartons this trip can still take.
  const cartons = useQuery({
    queryKey: keys.koli({ ready: true }),
    queryFn: ({ signal }) => dc.koli({ ready: true }, signal),
  })

  const shipments = useQuery({
    queryKey: keys.shipments(),
    queryFn: ({ signal }) => dc.shipments({}, signal),
  })

  const dispatches = useQuery({
    queryKey: keys.dispatches(),
    queryFn: ({ signal }) => dc.dispatches({}, signal),
  })

  const ready = useMemo(
    () =>
      (cartons.data ?? []).filter(
        (one) => one.position === "PACKED" || one.position === "SHIPMENT"
      ),
    [cartons.data]
  )

  const dispatchById = useMemo(
    () => new Map((dispatches.data ?? []).map((run) => [run.dispatch_id, run])),
    [dispatches.data]
  )

  /// One row per shipment on a trip that has actually departed.
  const inTransitRows = useMemo<InTransitRow[]>(() => {
    const rows: InTransitRow[] = []
    for (const shipment of shipments.data ?? []) {
      if (shipment.position !== "IN_TRANSIT") continue
      const run = shipment.dispatch_id
        ? dispatchById.get(shipment.dispatch_id)
        : undefined
      rows.push({ ...shipment, run: run ?? null })
    }
    return rows.sort(
      (left_, right) =>
        (right.run?.departed_at ?? "").localeCompare(
          left_.run?.departed_at ?? ""
        ) || right.shipment_number.localeCompare(left_.shipment_number)
    )
  }, [shipments.data, dispatchById])

  /// One delivery note per trip: rows of the same trip count once.
  const tripsInTransit = new Set(
    inTransitRows.map((row) => row.dispatch_id ?? row.shipment_id)
  ).size

  const legacyRuns = useMemo(
    () => (dispatches.data ?? []).filter((run) => run.departed_at === null),
    [dispatches.data]
  )

  const tripsToday = useMemo(() => {
    const today = new Date()
    return (dispatches.data ?? []).filter((run) => {
      if (run.departed_at === null) return false
      const at = new Date(run.departed_at)
      return (
        at.getFullYear() === today.getFullYear() &&
        at.getMonth() === today.getMonth() &&
        at.getDate() === today.getDate()
      )
    })
  }, [dispatches.data])

  const refresh = () => {
    // The cartons have left the dock — their list, ready row and manifests —
    // the shipments they ride are in transit, the trip has departed, and the
    // stock went with them.
    void client.invalidateQueries({ queryKey: ["dc", "koli"] })
    void client.invalidateQueries({ queryKey: keys.shipments() })
    void client.invalidateQueries({ queryKey: ["dc", "shipment"] })
    void client.invalidateQueries({ queryKey: keys.dispatches() })
    void client.invalidateQueries({ queryKey: keys.pools() })
  }

  /// The document-then-stock pair this whole screen used to be, kept for the
  /// runs the old flow left loaded and never departed.
  const departLegacy = useMutation({
    mutationFn: async (dispatchId: string) => {
      const run = await dc.dispatch(dispatchId)
      const details = await Promise.all(
        run.shipments.map((shipment) =>
          client.fetchQuery({
            queryKey: keys.shipment(shipment.shipment_id),
            queryFn: ({ signal }) => dc.shipment(shipment.shipment_id, signal),
          })
        )
      )
      const koliIds = details.flatMap((detail) =>
        detail.koli.map((manifest) => manifest.koli.koli_id)
      )
      await dc.departDispatch(dispatchId)
      return advanceEach(koliIds, "on the road", (koliId) =>
        dc.koliInTransit(koliId, {
          actor_id: actor,
          idempotency_key: idempotencyKey(),
        })
      )
    },
    onSuccess: (result) => {
      setProgress(result)
      refresh()
    },
  })

  const columns = useMemo(() => inTransitColumns(), [])

  // A phone's search, over the delivery note: the dock that carries their sort.
  const needle = typed.trim().toLowerCase()
  const searched = useMemo(
    () =>
      needle === ""
        ? inTransitRows
        : inTransitRows.filter(
            (row) =>
              shopName(row.destination_store_id)
                .toLowerCase()
                .includes(needle) ||
              tripDocumentNumber(row.run, [row]).toLowerCase().includes(needle)
          ),
    [inTransitRows, needle, shopName]
  )

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: searched,
        columns,
        getRowId: (row: InTransitRow) => row.shipment_id,
        state: { sorting },
        onSortingChange: setSorting,
      }),
      [searched, columns, sorting]
    )
  )

  const siteId =
    identity.data && "site_id" in identity.data ? identity.data.site_id : null
  const phone = useLayout() === "phone"

  return (
    <PageContent>
      <PageHeader
        crumb="Operations"
        title="Dispatch"
        sub="Tick the packed koli going on a trip. One delivery note per trip, made the instant it departs."
        // The screen's one action stands in its head; a phone has it at the
        // thumb (`Fab` below).
        actions={
          phone ? undefined : (
            <Button
              variant="primary"
              onClick={() => composing.open(true)}
              disabled={ready.length === 0}
            >
              <Truck />
              Dispatch
            </Button>
          )
        }
      />
      {ready.length > 0 && (
        <Fab
          label="Dispatch"
          icon={Truck}
          onClick={() => composing.open(true)}
        />
      )}

      <KpiStrip className="grid-cols-2 md:grid-cols-4 xl:grid-cols-4">
        <Kpi label="Koli ready to dispatch" value={count(ready.length)} />
        <Kpi label="Delivery note in transit" value={count(tripsInTransit)} />
        <Kpi
          label="Koli on the road"
          value={count(
            inTransitRows.reduce((total, row) => total + row.koli_count, 0)
          )}
        />
        <Kpi label="Trips today" value={count(tripsToday.length)} />
      </KpiStrip>

      {/* The search under the figures; on a phone it and the sort are the
          dock's, not a bar over the list. */}
      <div className="group/bar mb-3.5 flex min-h-[2.25rem] flex-wrap items-center gap-2 max-md:hidden">
        <ExpandingSearch
          value={typed}
          onChange={setTyped}
          label="Search delivery note"
        />
      </div>
      <DockTools
        search={{
          value: typed,
          onChange: setTyped,
          label: "Search delivery note",
        }}
        sort={dockSortOf(table)}
      />

      {progress !== null && progress.failed.length > 0 && (
        <Banner tone="bad" className="mb-5" onDismiss={() => setProgress(null)}>
          {progress.message}
          {
            " Those koli are still where they were. The safe retry is the step they failed at."
          }
        </Banner>
      )}

      {/* Only ever a handful of rows, and only until whoever loaded them the
          old way has departed the last one. */}
      {legacyRuns.length > 0 && (
        <Card className="mb-5 overflow-clip">
          <CardHeader>
            <CardTitle>Not departed</CardTitle>
            <span className="text-[0.9375rem] text-mute">
              Loaded before this screen made a trip in one act
            </span>
          </CardHeader>
          <ul className="flex flex-col border-t border-hairline">
            {legacyRuns.map((run) => (
              <li
                key={run.dispatch_id}
                className="flex min-h-row items-center justify-between gap-3 border-b border-hairline px-3.5 py-2.5 last:border-b-0"
              >
                <div className="min-w-0">
                  <div className="font-mono text-[0.9375rem] text-ink">
                    {run.dispatch_number}
                  </div>
                  <div className="truncate text-[0.9375rem] text-mute">
                    {vehicle(run)} · {count(run.shipment_count)}{" "}
                    {run.shipment_count === 1 ? "shop" : "shops"} ·{" "}
                    {count(run.koli_count)} koli
                  </div>
                </div>
                <ConfirmButton
                  label="Depart"
                  title={`Dispatch ${run.dispatch_number}?`}
                  description={
                    <>
                      Stock leaves this warehouse and goes on the road to{" "}
                      {run.shipment_count === 1
                        ? "one shop"
                        : `${run.shipment_count} shops`}
                      . This cannot be undone.
                    </>
                  }
                  confirmLabel="It has left"
                  variant="primary"
                  size="sm"
                  pending={
                    departLegacy.isPending &&
                    departLegacy.variables === run.dispatch_id
                  }
                  onConfirm={() => departLegacy.mutateAsync(run.dispatch_id)}
                />
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Problem error={departLegacy.error} className="mb-5" />

      {/* `overflow-clip`, not `overflow-hidden`: hidden makes the card a
          scroll box, and the table's heading would stick to the card instead
          of the window. */}
      <Card className="overflow-clip">
        <CardHeader>
          <CardTitle>In transit</CardTitle>
        </CardHeader>
        {queryState(shipments, {
          loading: "Reading the delivery note…",
          render: () =>
            inTransitRows.length === 0 ? (
              <EmptyState
                action={
                  ready.length > 0 ? (
                    <Button variant="soft" onClick={() => composing.open(true)}>
                      Dispatch
                    </Button>
                  ) : undefined
                }
              >
                {ready.length === 0
                  ? "Nothing has been dispatched, and no packed koli is waiting for a trip."
                  : "Nothing is in transit yet."}
              </EmptyState>
            ) : (
              <DataTable<InTransitRow>
                refresh={[cartons, shipments, dispatches]}
                table={table}
                onRowClick={(row) => shipmentSheet.open(row.shipment_id)}
                isSelected={(row) => row.shipment_id === shipmentSheet.value}
                summary={{
                  number: (
                    <span>
                      {count(tripsInTransit)}{" "}
                      <span className="font-normal text-body">
                        delivery note
                      </span>
                    </span>
                  ),
                  koli_count: count(
                    inTransitRows.reduce(
                      (total, row) => total + row.koli_count,
                      0
                    )
                  ),
                }}
                pageScroll
                cardSort={false}
              />
            ),
        })}
      </Card>

      <DispatchSheet />

      <ShipmentSheet
        id={shipmentSheet.value ?? null}
        onClose={shipmentSheet.close}
        dispatchById={dispatchById}
        shopName={shopName}
        onPrint={(shipment) => setPrinting(printingFor(shipment))}
      />

      {printing !== null && (
        <PrintSuratJalan
          printing={printing}
          onClose={() => setPrinting(null)}
          siteId={siteId}
        />
      )}
    </PageContent>
  )
}

/// **Dispatch works like Pack: the packed koli are the pile, the trips are the
/// boxes** (owner, 18 Oct 2026, pack-sheet-options.html, Dispatch).
///
/// A shelf of big radios on top: Packed, one tile per trip, Back to Pick when
/// koli are waiting to go back, and a dashed "+ Trip N". Under it a thin filter
/// of store codes and the chosen tile's koli. A koli row is calm: a grey box,
/// "Koli N · code", when it was packed, pieces, and a tinted "Put on trip". The
/// box and the name open what is inside. No trip yet makes Trip 1, one trip
/// takes it straight, two or more ask which. A trip tab has a red "Take out" per
/// koli and a tinted "+ Add to Trip N" that raises a second layer over the
/// sheet. The red "Back to Pick" in the foot opens a choice of waiting koli with
/// red ticks; the ones chosen wait in the Back to Pick tile (Take out undoes
/// it). The one solid button dispatches every trip (one delivery note per trip)
/// and sends the Back to Pick koli back. No done screen: one toast answers.
///
/// Owns its own queries, state and sheet (`?new-dispatch=true`), so the Dispatch
/// screen and the Outbound board both open it in place.
///
/// `only`: the koli the board says are ready to go (a koli MD still owes pieces
/// from is not in it). When given, it is all the pile offers.
export function DispatchSheet({
  only,
  onDispatched,
}: {
  only?: ReadonlySet<string> | null
  onDispatched?: () => void
  /// Kept so the board's call still fits; a koli goes back to Pick from the
  /// foot's own dialog now, so this is never called.
  onUnpack?: (koli: Koli) => void
} = {}) {
  const actor = useEdgeActor()
  const identity = useEdgeIdentity()
  const client = useQueryClient()
  const shopName = useShopName()
  const composing = useSheet("new-dispatch")
  const [trips, setTrips] = useState<readonly TripDraft[]>([])
  /// One trip, filled in the sheet (owner, 21 Oct 2026: "isi trip data",
  /// then Submit): every packed koli goes on it.
  const [tripNote, setTripNote] = useState("")
  const [view, setView] = useState<DispatchView>("pile")
  const [store, setStore] = useState<string>("all")
  /// The Add to Trip N layer, by trip number.
  const [adding, setAdding] = useState<number | null>(null)
  /// Koli waiting for the trip chooser (two or more trips), and where the press
  /// that asked was, for the "+N" that flies to the trip chosen. Kept after the
  /// chooser closes so its words do not change while it fades.
  const [asking, setAsking] = useState<{
    readonly ids: readonly string[]
    readonly from?: DOMRect
  } | null>(null)
  const [askOpen, setAskOpen] = useState(false)
  /// Koli chosen to go back to Pick: they wait in the Back to Pick tile until
  /// Dispatch sends them.
  const [back, setBack] = useState<readonly string[]>([])
  /// The Back to Pick dialog: open, and which koli are ticked.
  const [backOpen, setBackOpen] = useState(false)
  const [backSel, setBackSel] = useState<readonly string[]>([])
  /// The koli whose contents are showing, and the one being printed.
  const [info, setInfo] = useState<string | null>(null)
  const [printing, setPrinting] = useState<{
    koliId: string
    paper: Paper
  } | null>(null)
  /// Delivery notes waiting to print, one after another: filled only when the
  /// toast's Print surat jalan is pressed.
  const [printQueue, setPrintQueue] = useState<readonly string[]>([])
  /// Dispatch & print (owner, 20 Oct 2026): the paper picked before the trip
  /// left, so its surat jalan prints the moment it has a number.
  const printAfter = useRef<Paper | null>(null)
  const [queuePaper, setQueuePaper] = useState<Paper | null>(null)
  /// A key per trip and per back koli, held across retries of a Submit that
  /// half-failed: the same koli list lands once.
  const keys_ = useRef(new Map<string, string>())

  const cartons = useQuery({
    queryKey: keys.koli({ ready: true }),
    queryFn: ({ signal }) => dc.koli({ ready: true }, signal),
  })

  const ready = useMemo(
    () =>
      (cartons.data ?? []).filter(
        (one) =>
          (one.position === "PACKED" || one.position === "SHIPMENT") &&
          (!only || only.size === 0 || only.has(one.koli_id))
      ),
    [cartons.data, only]
  )
  const byId = useMemo(
    () => new Map(ready.map((box) => [box.koli_id, box])),
    [ready]
  )
  /// "Koli N": the koli's number among its store's, in the order they were sealed.
  const numbers = useMemo(() => {
    const out = new Map<string, number>()
    const seen = new Map<string, number>()
    for (const box of [...ready].sort(
      (a, b) =>
        (a.sealed_at ?? "").localeCompare(b.sealed_at ?? "") ||
        a.koli_number.localeCompare(b.koli_number)
    )) {
      const next = (seen.get(box.destination_store_id) ?? 0) + 1
      seen.set(box.destination_store_id, next)
      out.set(box.koli_id, next)
    }
    return out
  }, [ready])
  const noOf = (box: Koli) => numbers.get(box.koli_id) ?? 1

  const staged = new Set([...trips.flatMap((trip) => trip.ids), ...back])
  const pile = ready.filter((box) => !staged.has(box.koli_id))
  const kolisOf = (ids: readonly string[]) =>
    ids.flatMap((id) => {
      const box = byId.get(id)
      return box ? [box] : []
    })
  const nextNo = Math.max(0, ...trips.map((trip) => trip.no)) + 1

  const shown: readonly Koli[] =
    view === "pile"
      ? pile
      : view === "back"
        ? kolisOf(back)
        : kolisOf(trips.find((trip) => trip.no === view)?.ids ?? [])
  const stores = [
    ...new Set(shown.map((box) => box.destination_store_id)),
  ].sort((a, b) => a.localeCompare(b))
  const filter = stores.includes(store) ? store : "all"
  const list =
    filter === "all"
      ? shown
      : shown.filter((box) => box.destination_store_id === filter)
  /// "C001" out of "C001 · Cikupa": the filter names a store by its code.
  const codeOf = (id: string) => shopName(id).split(" · ")[0] ?? id
  const piecesOf = (boxes: readonly Koli[]) =>
    boxes.reduce((total, box) => total + box.unit_count, 0)

  const refresh = () => {
    // The cartons have left the dock — their list, ready row and manifests —
    // the shipments they ride are in transit, the trip has departed, and the
    // stock went with them.
    void client.invalidateQueries({ queryKey: ["dc", "koli"] })
    void client.invalidateQueries({ queryKey: keys.shipments() })
    void client.invalidateQueries({ queryKey: ["dc", "shipment"] })
    void client.invalidateQueries({ queryKey: keys.dispatches() })
    void client.invalidateQueries({ queryKey: keys.pools() })
    void client.invalidateQueries({ queryKey: keys.dc.all })
  }

  const clear = () => {
    setTrips([])
    setTripNote("")
    setView("pile")
    setStore("all")
    setAdding(null)
    setAsking(null)
    setAskOpen(false)
    setBack([])
    setBackOpen(false)
    setBackSel([])
    setInfo(null)
  }

  // Composer state: every ready koli in Packed, no trips, whenever it opens.
  const opening = composing.value === true
  const [wasOpening, setWasOpening] = useState(false)
  if (opening !== wasOpening) {
    setWasOpening(opening)
    if (opening) clear()
  }

  /// What shows after the next paint: the tile a press is about to fill.
  const afterPaint = (run: () => void) => {
    requestAnimationFrame(run)
  }

  /// Koli onto a trip; `null` makes the next one. `from`: where the press was,
  /// for the "+N" that flies to the tile.
  const place = (
    ids: readonly string[],
    target: number | null,
    from?: DOMRect
  ) => {
    const fresh = ids.filter((id) => !staged.has(id))
    if (fresh.length === 0) return
    const known = target !== null && trips.some((trip) => trip.no === target)
    const no = known ? target : nextNo
    setTrips((current) =>
      known
        ? current.map((trip) =>
            trip.no === no ? { ...trip, ids: [...trip.ids, ...fresh] } : trip
          )
        : [...current, { no, ids: fresh, note: "" }]
    )
    afterPaint(() => {
      const tile = tileOf(no)
      flyTo(from, tile, `+${fresh.length}`)
      pulse(tile)
    })
  }
  /// Which trip a press goes on: the Add layer's, the only one there is, a new
  /// Trip 1, or — with two or more — the one the chooser says.
  const send = (ids: readonly string[], from?: DOMRect) => {
    if (adding !== null) return place(ids, adding, from)
    if (trips.length >= 2) {
      setAsking({ ids, from })
      setAskOpen(true)
      return
    }
    place(ids, trips.length === 1 ? trips[0]!.no : null, from)
  }

  /// Koli chosen in the Back to Pick dialog wait in its tile.
  const stageBack = (ids: readonly string[]) => {
    setBack((current) => [
      ...current,
      ...ids.filter((id) => !current.includes(id)),
    ])
    afterPaint(() => pulse(tileOf("back")))
  }
  const unstageBack = (id: string) => {
    const left = back.filter((one) => one !== id)
    setBack(left)
    if (left.length === 0) setView("pile")
  }

  const keyFor = (name: string) => {
    const known = keys_.current.get(name)
    if (known) return known
    const made = idempotencyKey()
    keys_.current.set(name, made)
    return made
  }

  /// Dispatch: every trip leaves (one delivery note each), then the koli
  /// waiting in Back to Pick go back to Pick (the reused move-back write).
  const submit = useMutation({
    mutationFn: async () => {
      const drawn = trips.filter((trip) => trip.ids.length > 0)
      const data = tripNote.trim()
      const full: TripDraft[] =
        drawn.length > 0
          ? [...drawn]
          : pile.length > 0
            ? [{ no: 1, ids: pile.map((box) => box.koli_id), note: data }]
            : []
      let dispatched = 0
      const made: string[] = []
      for (const trip of full) {
        const note = trip.note.trim()
        const detail = await dc.dispatchTrip({
          koli_ids: [...trip.ids],
          trip_note: note === "" ? null : note,
          actor_id: actor,
          idempotency_key: keyFor(
            `trip:${[...trip.ids].sort().join(",")}:${note}`
          ),
        })
        // The trip just made is the trip to print: no second read for it.
        client.setQueryData(keys.dispatch(detail.dispatch.dispatch_id), detail)
        made.push(detail.dispatch.dispatch_id)
        dispatched += 1
        setTrips((current) => current.filter((one) => one.no !== trip.no))
      }
      let sent = 0
      for (const id of back) {
        const box = byId.get(id)
        if (!box) continue
        const manifest = await client.fetchQuery(koliManifestQuery(id))
        const lines = new Map<string, number>()
        for (const line of manifest.lines)
          lines.set(
            line.sku_code,
            (lines.get(line.sku_code) ?? 0) + line.quantity
          )
        await moveBack({
          idempotency_key: keyFor(`back:${id}`),
          destination_id: box.destination_store_id,
          from: "packed",
          to: "pick",
          koli_id: id,
          lines: [...lines].map(([sku_code, quantity]) => ({
            sku_code,
            quantity,
          })),
        })
        sent += 1
        setBack((current) => current.filter((one) => one !== id))
      }
      return { dispatched, sent, made }
    },
    onSuccess: ({ dispatched, sent, made }) => {
      const after = printAfter.current
      printAfter.current = null
      if (after !== null && made.length > 0) {
        setQueuePaper(after)
        setPrintQueue(made)
      }
      refresh()
      composing.close()
      clear()
      if (dispatched > 0) onDispatched?.()
      // Nothing opens by itself: the toast offers the surat jalan, and Print
      // surat jalan opens the same preview sheet as an order.
      toast.success(
        [
          dispatched > 0
            ? `${count(dispatched)} ${dispatched === 1 ? "trip" : "trips"} dispatched`
            : "",
          sent > 0 ? `${count(sent)} koli back to Pick` : "",
        ]
          .filter(Boolean)
          .join(" · "),
        made.length > 0
          ? {
              action: {
                label: "Print surat jalan",
                onClick: () => setPrintQueue(made),
              },
            }
          : undefined
      )
    },
    // Part of it may have gone before the failure: show what is left.
    onError: refresh,
  })

  const full = trips.filter((trip) => trip.ids.length > 0)
  const fullKoli = full.reduce((total, trip) => total + trip.ids.length, 0)
  const summary = [
    full.length > 0
      ? `${count(full.length)} ${full.length === 1 ? "trip" : "trips"} · ${count(fullKoli)} koli`
      : "",
    back.length > 0 ? `${count(back.length)} koli back to Pick` : "",
  ]
    .filter(Boolean)
    .join(" · ")

  const siteId =
    identity.data && "site_id" in identity.data ? identity.data.site_id : null

  const activeTrip =
    typeof view === "number"
      ? trips.find((trip) => trip.no === view)
      : undefined
  const infoBox = info ? (byId.get(info) ?? null) : null
  const addingTrip =
    adding === null ? undefined : trips.find((trip) => trip.no === adding)
  /// What the chooser is asking about: one koli, or "All in".
  const askBoxes = kolisOf(asking?.ids ?? [])
  const askOne = askBoxes.length === 1 ? askBoxes[0] : undefined

  const row = (box: Koli, action: React.ReactNode) => (
    <KoliRow
      key={box.koli_id}
      box={box}
      no={noOf(box)}
      onOpen={() => setInfo(box.koli_id)}
      action={action}
    />
  )
  const putRow = (box: Koli) =>
    row(
      box,
      <PutOnTrip
        onPress={(event) =>
          send([box.koli_id], event.currentTarget.getBoundingClientRect())
        }
      />
    )

  /// A line that says there is nothing here.
  const nothing = (words: string) => (
    <p className="py-7 text-center text-[0.9375rem] text-mute">{words}</p>
  )

  let body: React.ReactNode
  if (view === "pile") {
    body =
      list.length === 0 ? (
        nothing("Every koli is on a trip")
      ) : (
        <>
          <div className="flex min-h-10 items-center gap-2">
            <span className="text-[0.9375rem] text-mute tabular-nums">
              {filter === "all" ? "" : `${shopName(filter)} · `}
              {count(list.length)} koli · {quantity(piecesOf(list))}
            </span>
            <div className="flex-1" />
            {/* Back to Pick beside All in, as on Pack (owner, 20 Oct 2026). */}
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                setBackSel([])
                setBackOpen(true)
              }}
            >
              Back to Picklist
            </Button>
          </div>
          <StoreGroups
            boxes={list}
            all={filter === "all"}
            shopName={shopName}
            render={(box) => row(box, null)}
          />
        </>
      )
  } else if (view === "back") {
    body = (
      <StoreGroups
        boxes={list}
        all={filter === "all"}
        shopName={shopName}
        render={(box) =>
          row(
            box,
            <Button
              variant="destructive"
              size="sm"
              onClick={() => unstageBack(box.koli_id)}
            >
              Take out
            </Button>
          )
        }
      />
    )
  } else {
    const tripNo = view
    body = (
      <>
        <div className="flex min-h-10 items-center justify-end">
          {pile.length > 0 && (
            <Button variant="primary" size="sm" onClick={() => setAdding(tripNo)}>
              + Add to Trip {tripNo}
            </Button>
          )}
        </div>
        {list.length === 0 ? (
          nothing("Empty")
        ) : (
          <StoreGroups
            boxes={list}
            all={filter === "all"}
            shopName={shopName}
            render={(box) =>
              row(
                box,
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() =>
                    setTrips((current) =>
                      current.map((trip) =>
                        trip.no === tripNo
                          ? {
                              ...trip,
                              ids: trip.ids.filter((id) => id !== box.koli_id),
                            }
                          : trip
                      )
                    )
                  }
                >
                  Take out
                </Button>
              )
            }
          />
        )}
        {activeTrip && (
          <div className="mt-[1.375rem]">
            <Field label={`Trip data · Trip ${activeTrip.no}`}>
              <Textarea
                rows={2}
                value={activeTrip.note}
                onChange={(event) =>
                  setTrips((current) =>
                    current.map((trip) =>
                      trip.no === activeTrip.no
                        ? { ...trip, note: event.target.value }
                        : trip
                    )
                  )
                }
              />
            </Field>
          </div>
        )}
      </>
    )
  }

  return (
    <>
      <Sheet
        open={composing.value === true}
        onOpenChange={(next) => {
          if (next) return
          // Esc reaches the sheet under a stack, not the layer on top of it
          // (Pack does the same): while Add to Trip is up, that close is the
          // layer's, and Dispatch stays.
          if (adding !== null) {
            setAdding(null)
            return
          }
          composing.close()
          clear()
          submit.reset()
        }}
        size="table"
        context="Operations"
        title="Dispatch"
        footer={
          // Back to Pick stands at the left, the summary after it, the one
          // solid button at the right (prototype). Each button sits in a box
          // of its own: the White look sends every button a foot holds
          // straight to the right, and a spacer is hidden there.
          <div className="flex w-full items-center gap-3">
            <span className="text-[0.9375rem] text-mute tabular-nums max-md:hidden">
              {summary}
            </span>
            <div
              className={cn(
                "max-md:flex-1 max-md:[&>button]:w-full",
                "ml-auto"
              )}
            >
              <Button
                variant="primary"
                pending={submit.isPending}
                disabled={pile.length === 0 && summary === ""}
                onClick={() => submit.mutate()}
              >
                {submit.isPending ? "Submitting…" : "Submit"}
              </Button>
            </div>
          </div>
        }
      >
        {queryState(cartons, {
          loading: "Reading the koli…",
          render: () =>
            ready.length === 0 ? (
              <EmptyState
                action={
                  <AppLink to="/operations/packing" variant="soft">
                    Go to Packing
                  </AppLink>
                }
              >
                No packed koli is waiting for a trip.
              </EmptyState>
            ) : (
              <div className="flex flex-col gap-6">
                {/* The PO list's strip (owner, 20 Oct 2026): what is
                    waiting, what is on a trip, for how many stores. */}
                <KpiStrip className="mb-0 md:grid-cols-4 xl:grid-cols-4">
                  <Kpi label="Packed" value={`${count(pile.length)} koli`} />
                  <Kpi label="On trips" value={`${count(fullKoli)} koli`} />
                  <Kpi
                    label="Stores"
                    value={count(
                      new Set(ready.map((one) => one.destination_store_id)).size
                    )}
                  />
                  <Kpi label="Pieces" value={count(piecesOf(ready))} />
                </KpiStrip>
                {pile.length > 0 && (
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="md:col-span-2">
                      <Field label="Trip data">
                        <Textarea
                          rows={2}
                          value={tripNote}
                          onChange={(event) => setTripNote(event.target.value)}
                        />
                      </Field>
                    </div>
                  </div>
                )}

                {/* Stores as chips above the koli, with how many koli each
                    holds (owner, 20 Oct 2026: chips as in GA). */}
                <div className="flex min-w-0 flex-col gap-3">
                  {stores.length > 0 && (
                    <FilterChips
                      label="Store"
                      value={filter === "all" ? null : filter}
                      onChange={(next) => setStore(next ?? "all")}
                      options={[
                        {
                          value: null,
                          label: "All stores",
                          icon: Store,
                          count: shown.length,
                        },
                        ...stores.map((id) => ({
                          value: id,
                          label: codeOf(id),
                          count: shown.filter(
                            (box) => box.destination_store_id === id
                          ).length,
                        })),
                      ]}
                    />
                  )}
                  <div className="flex min-w-0 flex-col">{body}</div>
                </div>

                <Problem error={submit.error} />
              </div>
            ),
        })}
      </Sheet>

      {/* The second layer: waiting koli, each straight onto this trip. */}
      <Sheet
        open={adding !== null}
        onOpenChange={(next) => !next && setAdding(null)}
        size="rail"
        context={`Packed · ${count(pile.length)} koli`}
        title={adding === null ? "Add to Trip" : `Add to Trip ${adding}`}
        caption={
          adding === null
            ? undefined
            : `Trip ${adding} · ${count(addingTrip?.ids.length ?? 0)} koli`
        }
        footer={
          <div className="flex justify-end">
            <Button variant="primary" onClick={() => setAdding(null)}>
              Done
            </Button>
          </div>
        }
      >
        {pile.length === 0 ? (
          nothing("Every koli is on a trip")
        ) : (
          <StoreGroups boxes={pile} all shopName={shopName} render={putRow} />
        )}
      </Sheet>

      <TripChooser
        open={askOpen}
        onClose={() => setAskOpen(false)}
        title={
          askOne ? (
            <>
              Koli {noOf(askOne)} · {askOne.koli_number}
            </>
          ) : (
            "All in"
          )
        }
        sub={
          askOne
            ? `${shopName(askOne.destination_store_id)} · ${quantity(askOne.unit_count)}`
            : `${count(askBoxes.length)} koli · ${quantity(piecesOf(askBoxes))}`
        }
        trips={trips.map((trip) => ({ no: trip.no, koli: trip.ids.length }))}
        nextNo={nextNo}
        onChoose={(no) => {
          const ids = asking?.ids ?? []
          setAskOpen(false)
          place(ids, no, asking?.from)
        }}
      />

      <Pop
        open={backOpen}
        onOpenChange={(next) => !next && setBackOpen(false)}
        width="back"
        bodyClass="mt-2.5"
        title="Back to Picklist"
        foot={
          <>
            <Button variant="ghost" onClick={() => setBackOpen(false)}>
              Keep
            </Button>
            <Button
              variant="destructive"
              disabled={backSel.length === 0}
              onClick={() => {
                stageBack(backSel)
                setBackOpen(false)
                setBackSel([])
              }}
            >
              {`Back to Picklist${backSel.length > 0 ? ` ${count(backSel.length)} koli` : ""}`}
            </Button>
          </>
        }
      >
        <StoreGroups
          boxes={pile}
          all
          shopName={shopName}
          render={(box) => {
            const toggle = () =>
              setBackSel((current) =>
                current.includes(box.koli_id)
                  ? current.filter((id) => id !== box.koli_id)
                  : [...current, box.koli_id]
              )
            return (
              <KoliRow
                key={box.koli_id}
                box={box}
                no={noOf(box)}
                onOpen={() => setInfo(box.koli_id)}
                onPress={toggle}
                leading={
                  <RedTick
                    on={backSel.includes(box.koli_id)}
                    label={`Koli ${noOf(box)}`}
                  />
                }
                action={null}
              />
            )
          }}
        />
      </Pop>

      <KoliContentsDialog
        box={infoBox}
        no={infoBox ? noOf(infoBox) : 1}
        store={infoBox ? shopName(infoBox.destination_store_id) : ""}
        onClose={() => setInfo(null)}
        onPrint={(koliId, paper) => setPrinting({ koliId, paper })}
      />

      {printing !== null && (
        <PackingListPrint
          koliIds={[printing.koliId]}
          paper={printing.paper}
          open
          onClose={() => setPrinting(null)}
          siteId={siteId}
        />
      )}

      {printQueue.length > 0 && (
        <PrintSuratJalan
          // One delivery note after another: the next opens as this closes.
          key={printQueue[0]}
          printing={{ dispatchId: printQueue[0]! }}
          paper={queuePaper ?? undefined}
          onClose={() =>
            setPrintQueue((queue) => {
              if (queue.length <= 1) setQueuePaper(null)
              return queue.slice(1)
            })
          }
          siteId={siteId}
        />
      )}
    </>
  )
}

type DispatchView = "pile" | "back" | number

interface TripDraft {
  readonly no: number
  readonly ids: readonly string[]
  readonly note: string
}

/// Koli under their store's head: the name, "N koli · M pcs", and — when the
/// caller gives it — a tinted "All in" for that store.
function StoreGroups({
  boxes,
  all,
  shopName,
  render,
  onAllIn,
}: {
  boxes: readonly Koli[]
  /// Draw the store heads (the filter is on All stores).
  all: boolean
  shopName: (id: string) => string
  render: (box: Koli) => React.ReactNode
  onAllIn?: (ids: readonly string[], from: DOMRect) => void
}) {
  const out: React.ReactNode[] = []
  let last: string | null = null
  for (const box of boxes) {
    const id = box.destination_store_id
    if (all && id !== last) {
      last = id
      const mine = boxes.filter((one) => one.destination_store_id === id)
      out.push(
        <div key={`head-${id}`} className="flex items-center gap-3 pt-4 pb-2">
          <div className="min-w-0 flex-1">
            <b className="block truncate font-semibold text-ink">
              {shopName(id)}
            </b>
            <span className="text-[0.9375rem] text-mute tabular-nums">
              {count(mine.length)} koli ·{" "}
              {quantity(mine.reduce((total, one) => total + one.unit_count, 0))}
            </span>
          </div>
          {onAllIn && (
            <Button
              variant="primary"
              size="sm"
              onClick={(event) =>
                onAllIn(
                  mine.map((one) => one.koli_id),
                  event.currentTarget.getBoundingClientRect()
                )
              }
            >
              All in
            </Button>
          )}
        </div>
      )
    }
    out.push(<div key={box.koli_id}>{render(box)}</div>)
  }
  return <>{out}</>
}

/// A red tick box: the Back to Pick dialog's choice. The row it stands in is
/// the press (it ticks and unticks); this is how it looks, and what a keyboard
/// lands on.
function RedTick({ on, label }: { on: boolean; label: string }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={on}
      aria-label={label}
      className={cn(
        "grid size-[1.375rem] shrink-0 place-items-center rounded-md border-[1.5px] transition-[background-color,border-color,scale] duration-150 ease-out active:scale-[0.9]",
        on
          ? "border-bad-fg bg-bad-fg text-white"
          : "border-hairline-2 bg-canvas"
      )}
    >
      {on && <Check className="size-4" />}
    </button>
  )
}

/// The delivery note sheet and its print, for a screen that is not Dispatch —
/// the Outbound board opens a shipment in place.
export function ShipmentSheets() {
  const identity = useEdgeIdentity()
  const shopName = useShopName()
  const shipmentSheet = useSheet("shipment")
  const [printing, setPrinting] = useState<Printing | null>(null)
  const dispatches = useQuery({
    queryKey: keys.dispatches(),
    queryFn: ({ signal }) => dc.dispatches({}, signal),
  })
  const dispatchById = useMemo(
    () => new Map((dispatches.data ?? []).map((run) => [run.dispatch_id, run])),
    [dispatches.data]
  )
  const siteId =
    identity.data && "site_id" in identity.data ? identity.data.site_id : null
  return (
    <>
      <ShipmentSheet
        id={shipmentSheet.value ?? null}
        onClose={shipmentSheet.close}
        dispatchById={dispatchById}
        shopName={shopName}
        onPrint={(shipment) => setPrinting(printingFor(shipment))}
      />
      {printing !== null && (
        <PrintSuratJalan
          printing={printing}
          onClose={() => setPrinting(null)}
          siteId={siteId}
        />
      )}
    </>
  )
}

/// What a "Print delivery note" press prints: the shipment's trip, as one
/// document — or, for a shipment on no trip yet (a legacy run), its own page.
type Printing = SuratJalanTarget

function printingFor(shipment: Shipment): Printing {
  return shipment.dispatch_id !== null
    ? { dispatchId: shipment.dispatch_id }
    : { shipmentIds: [shipment.shipment_id] }
}

function PrintSuratJalan({
  printing,
  onClose,
  siteId,
  paper,
}: {
  printing: Printing
  onClose: () => void
  siteId: string | null
  paper?: Paper
}) {
  return (
    <SuratJalanPrintFlow
      target={printing}
      onClose={onClose}
      siteId={siteId}
      paper={paper}
    />
  )
}

/// A delivery note once it is on a trip — the join this screen reads over and
/// over, kept as one shape rather than recomputed per column. `run` is `null`
/// for a shipment whose dispatch this node has not (yet) heard back about.
interface InTransitRow extends Shipment {
  readonly run: Dispatch | null
}

/// Who is driving what, in one line — carrier included, because a legacy run
/// may carry one from before this screen's own composer asked for a single
/// note instead.
function vehicle(run: Dispatch): string {
  return (
    [run.carrier, run.vehicle_plate, run.driver_name]
      .filter((part) => part !== null && part !== "")
      .join(" · ") || "No carrier named"
  )
}

/// A shop the way every list on this screen reads it: the name leads, because
/// that is what a person recognises.
function ShopCell({
  id,
  shopName,
}: {
  id: string
  shopName: (id: string) => string
}) {
  return <span className="truncate text-ink">{shopName(id)}</span>
}

/// The "In transit" card's columns.
function inTransitColumns(): ColumnDef<TableSetup, InTransitRow>[] {
  return [
    {
      id: "number",
      // The trip's number: rows of one trip share one delivery note.
      accessorFn: (row: InTransitRow) => tripDocumentNumber(row.run, [row]),
      header: "Delivery Note",
      size: 240,
      meta: { card: "id", mono: true },
      cell: ({ row }) => (
        <span className="font-mono text-[0.9375rem] text-ink">
          {tripDocumentNumber(row.original.run, [row.original])}
        </span>
      ),
    },
    {
      id: "shop",
      accessorFn: (row: InTransitRow) => row.destination_store_id,
      header: "Shop",
      meta: { card: "title", grow: 150 },
      cell: ({ row }) => (
        <ShopCellWithHook id={row.original.destination_store_id} />
      ),
    },
    {
      accessorKey: "koli_count",
      header: "Koli",
      size: 90,
      meta: { align: "right", card: "metric" },
      cell: ({ row }) => count(row.original.koli_count),
    },
    {
      accessorKey: "unit_count",
      header: "Pcs",
      size: 90,
      meta: { align: "right", card: "metric", priority: 2 },
      cell: ({ row }) => count(row.original.unit_count),
    },
    {
      id: "departed",
      accessorFn: (row: InTransitRow) => row.run?.departed_at ?? "",
      header: "Dispatched",
      size: 140,
      meta: { align: "right", card: "meta", priority: 2 },
      cell: ({ row }) => clock(row.original.run?.departed_at ?? null),
    },
    {
      id: "trip",
      accessorFn: (row: InTransitRow) => row.run?.trip_note ?? "",
      header: "Trip Data",
      size: 200,
      meta: { card: "meta", priority: 3 },
      cell: ({ row }) => {
        const note = row.original.run?.trip_note ?? ""
        return note === "" ? (
          <span className="text-mute">—</span>
        ) : (
          <span className="truncate text-[0.9375rem]" title={note}>
            {note.split("\n")[0]}
          </span>
        )
      },
    },
    {
      id: "status",
      header: "Status",
      size: 110,
      enableSorting: false,
      meta: { card: "status" },
      // "In transit" until the shop has counted every piece in; then the
      // finished note is stamped, as the order list stamps a finished order.
      cell: ({ row }) =>
        row.original.run?.received_at ? (
          <span className={cn(STAMP, "text-ok-fg")}>
            Received
            <span className="block tabular-nums">
              {dayMonth(row.original.run.received_at)}
            </span>
          </span>
        ) : (
          <Status tone="info">In transit</Status>
        ),
    },
  ]
}

/// A column cell needs a hook, and a `ColumnDef`'s `cell` cannot call one
/// directly — it is a plain function, not a component React tracks. A tiny
/// component closes that gap.
function ShopCellWithHook({ id }: { id: string }) {
  const shopName = useShopName()
  return <ShopCell id={id} shopName={shopName} />
}

/// One shipment, read back: the facts, the trip it left on, and every
/// carton's own packing-list number. Print lives in the header because it is
/// the one thing anybody opens this sheet to do a second time.
function ShipmentSheet({
  id,
  onClose,
  dispatchById,
  shopName,
  onPrint,
}: {
  id: string | null
  onClose: () => void
  dispatchById: ReadonlyMap<string, Dispatch>
  shopName: (id: string) => string
  onPrint: (shipment: Shipment) => void
}) {
  const detail = useQuery({
    queryKey: keys.shipment(id ?? ""),
    queryFn: ({ signal }) => dc.shipment(id!, signal),
    enabled: id !== null,
  })

  const record = detail.data?.shipment
  const run = record?.dispatch_id
    ? dispatchById.get(record.dispatch_id)
    : undefined

  return (
    <Sheet
      open={id !== null}
      onOpenChange={(open) => !open && onClose()}
      id={record ? tripDocumentNumber(run, [record]) : undefined}
      title={record ? shopName(record.destination_store_id) : "Delivery note"}
      actions={
        record !== undefined && (
          <Button variant="soft" onClick={() => onPrint(record)}>
            <Printer />
            Print delivery note
          </Button>
        )
      }
    >
      {queryState(detail, {
        loading: "Reading the delivery note…",
        render: (found) => (
          <div className="relative flex flex-col gap-4">
            {run?.received_at && (
              <DocStamp word="Received" at={run.received_at} tone="ok" />
            )}
            <Facts>
              <Fact term="Shop">
                {shopName(found.shipment.destination_store_id)}
              </Fact>
              <Fact term="Dispatched">
                {run ? clock(run.departed_at) : "—"}
              </Fact>
              <Fact term="Koli">{count(found.shipment.koli_count)}</Fact>
              <Fact term="Pcs">{count(found.shipment.unit_count)}</Fact>
              {/* Received is the shop's half of this document: the centre
                  says so once every piece is counted in. */}
              {!run?.received_at && (
                <Fact term="Status">
                  <Status tone="info">In transit</Status>
                </Fact>
              )}
              <Fact term="Trip data">
                {run?.trip_note ? (
                  <span className="whitespace-pre-wrap">{run.trip_note}</span>
                ) : (
                  "—"
                )}
              </Fact>
            </Facts>

            <Section title="Koli on it" flush>
              <MiniTable head={["Koli", "Pcs"]}>
                {found.koli.map((manifest) => (
                  <MiniRow key={manifest.koli.koli_id}>
                    <MiniCell>
                      <AppLink
                        to="/operations/packing"
                        sheet={{ key: "koli", value: manifest.koli.koli_id }}
                        className="font-mono text-ink underline underline-offset-2"
                      >
                        {manifest.koli.koli_number}
                      </AppLink>
                    </MiniCell>
                    <MiniCell align="right">
                      {count(manifest.koli.unit_count)}
                    </MiniCell>
                  </MiniRow>
                ))}
              </MiniTable>
            </Section>
          </div>
        ),
      })}
    </Sheet>
  )
}
