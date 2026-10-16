import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { Printer, Truck } from "lucide-react"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { KoliPhotos } from "@/screens/operations/board/photos"
import { DockTools } from "@/components/shell/dock-tools"
import {
  SuratJalanPrint,
  TripSuratJalanPrint,
  useShopName,
} from "@/components/operations/outbound-papers"
import { AppLink } from "@/components/ui/app-link"
import { Button } from "@/components/ui/button"
import { DocStamp } from "@/components/ui/doc-stamp"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { DataTable, dockSortOf } from "@/components/ui/data-table"
import { ConfirmButton, SavedDialog } from "@/components/ui/dialog"
import { Fab } from "@/components/ui/fab"
import { Checkbox, Field, Textarea } from "@/components/ui/field"
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
import { keys } from "@/lib/operations/keys"
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

/// The dispatch composer: which sealed cartons go on one trip, shop by shop,
/// one free note, one press — and the delivery note print that follows. Owns its
/// own queries, state and sheet (`?new-dispatch=true`), so the Dispatch screen
/// and the Outbound board both open it in place.
///
/// `only`: the cartons ticked on the board before it was opened. When given,
/// the sheet opens with just those going and every other ready carton left
/// off (still tickable here); absent, everything ready starts ticked.
export function DispatchSheet({
  only,
  onDispatched,
}: {
  only?: ReadonlySet<string> | null
  onDispatched?: () => void
} = {}) {
  const actor = useEdgeActor()
  const identity = useEdgeIdentity()
  const client = useQueryClient()
  const shopName = useShopName()
  const composing = useSheet("new-dispatch")
  const [left, setLeft] = useState<ReadonlySet<string>>(new Set())
  const [focusShop, setFocusShop] = useState<string | null>(null)
  const [tripNote, setTripNote] = useState("")
  const [printing, setPrinting] = useState<Printing | null>(null)

  const cartons = useQuery({
    queryKey: keys.koli({ ready: true }),
    queryFn: ({ signal }) => dc.koli({ ready: true }, signal),
  })

  const ready = useMemo(
    () =>
      (cartons.data ?? []).filter(
        (one) => one.position === "PACKED" || one.position === "SHIPMENT"
      ),
    [cartons.data]
  )

  const boxesByShop = useMemo(() => {
    const map = new Map<string, Koli[]>()
    for (const box of ready) {
      const list = map.get(box.destination_store_id)
      if (list) list.push(box)
      else map.set(box.destination_store_id, [box])
    }
    return map
  }, [ready])

  const shopIds = useMemo(
    () => [...boxesByShop.keys()].sort((a, b) => a.localeCompare(b)),
    [boxesByShop]
  )

  const shop =
    focusShop !== null && boxesByShop.has(focusShop)
      ? focusShop
      : (shopIds[0] ?? null)
  const mine = shop !== null ? (boxesByShop.get(shop) ?? []) : []
  const mineTicked = mine.filter((box) => !left.has(box.koli_id))
  const shopAllTicked = mine.length > 0 && mineTicked.length === mine.length
  const shopNoneTicked = mineTicked.length === 0

  /// Every shop with at least one carton still ticked — the exact set of
  /// koli a Dispatch press is about to put on the trip.
  const goingByShop = useMemo(() => {
    const map = new Map<string, Koli[]>()
    for (const id of shopIds) {
      const ticked = (boxesByShop.get(id) ?? []).filter(
        (box) => !left.has(box.koli_id)
      )
      if (ticked.length > 0) map.set(id, ticked)
    }
    return map
  }, [shopIds, boxesByShop, left])
  const going = [...goingByShop.entries()]
  const goingKoliIds = going.flatMap(([, list]) =>
    list.map((box) => box.koli_id)
  )
  const goingPieces = going.reduce(
    (total, [, list]) =>
      total + list.reduce((sum, box) => sum + box.unit_count, 0),
    0
  )

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

  // Composer state: reset whenever the sheet opens — every ready carton
  // ticked, or only the board's picks when it handed some over.
  const opening = composing.value === true
  const [wasOpening, setWasOpening] = useState(false)
  if (opening !== wasOpening) {
    setWasOpening(opening)
    if (opening) {
      setLeft(
        only && only.size > 0
          ? new Set(
              ready
                .filter((box) => !only.has(box.koli_id))
                .map((box) => box.koli_id)
            )
          : new Set()
      )
      setFocusShop(null)
      setTripNote("")
    }
  }

  const dispatchTrip = useMutation({
    mutationFn: (value: { koliIds: readonly string[]; note: string }) =>
      dc.dispatchTrip({
        koli_ids: [...value.koliIds],
        trip_note: value.note.trim() === "" ? null : value.note.trim(),
        actor_id: actor,
        idempotency_key: idempotencyKey(),
      }),
    onSuccess: (detail) => {
      // The trip just made is the trip to print: no second read for it.
      client.setQueryData(keys.dispatch(detail.dispatch.dispatch_id), detail)
      setPrinting({ dispatchId: detail.dispatch.dispatch_id })
      composing.close()
      setLeft(new Set())
      setTripNote("")
      refresh()
      onDispatched?.()
      setDispatched("1 delivery note · in transit")
    },
  })

  /// The trip the sheet dispatched, held in the receipt dialog until it is
  /// read — over the delivery note the press already opened for printing.
  const [dispatched, setDispatched] = useState<string | null>(null)

  const submit = () => {
    if (goingKoliIds.length === 0) return
    dispatchTrip.mutate({ koliIds: goingKoliIds, note: tripNote })
  }

  const siteId =
    identity.data && "site_id" in identity.data ? identity.data.site_id : null

  return (
    <>
      {/* One trip, composed in one sheet: which cartons, which shop, one free
          note, one press. */}
      <Sheet
        open={composing.value === true}
        onOpenChange={(next) => {
          if (!next) {
            composing.close()
            setLeft(new Set())
            setTripNote("")
            dispatchTrip.reset()
          }
        }}
        width="wide"
        title="Dispatch"
        footer={
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="text-[0.9375rem] text-mute">
              {goingKoliIds.length === 0
                ? "Tick the koli going on it"
                : `${count(going.length)} ${going.length === 1 ? "store" : "stores"} · ${count(goingKoliIds.length)} koli · ${quantity(goingPieces)}`}
            </span>
            <div className="flex-1" />
            <Button
              variant="primary"
              pending={dispatchTrip.isPending}
              disabled={goingKoliIds.length === 0}
              onClick={submit}
            >
              {/* Submit dispatches and prints the delivery note. */}
              {dispatchTrip.isPending ? "Submitting…" : "Submit"}
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-5">
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
                <div className="flex flex-col gap-4 sm:min-h-[26rem] sm:flex-row sm:gap-5">
                  <ShopRail
                    shopIds={shopIds}
                    boxesByShop={boxesByShop}
                    left={left}
                    going={going.length}
                    current={shop}
                    onFocus={setFocusShop}
                  />
                  <div className="flex min-w-0 flex-1 flex-col gap-3">
                    {shop === null ? (
                      <Banner tone="ok">
                        Every store with a packed koli is already on this trip.
                      </Banner>
                    ) : (
                      <>
                        <div>
                          <h4 className="text-card-title font-semibold text-ink">
                            {shopName(shop)}
                          </h4>
                          {shopNoneTicked && (
                            <p className="mt-0.5 text-[0.9375rem] text-mute">
                              Not going on this trip
                            </p>
                          )}
                        </div>
                        <CartonChoice
                          cartons={mine}
                          left={left}
                          allTicked={shopAllTicked}
                          indeterminate={!shopAllTicked && !shopNoneTicked}
                          onToggleShop={(on) =>
                            setLeft((current) => {
                              const next = new Set(current)
                              for (const box of mine) {
                                if (on) next.delete(box.koli_id)
                                else next.add(box.koli_id)
                              }
                              return next
                            })
                          }
                          onToggleOne={(koliId, on) =>
                            setLeft((current) => {
                              const next = new Set(current)
                              if (on) next.delete(koliId)
                              else next.add(koliId)
                              return next
                            })
                          }
                        />
                      </>
                    )}
                  </div>
                </div>
              ),
          })}

          <Field label="Trip data">
            <Textarea
              rows={3}
              value={tripNote}
              onChange={(event) => setTripNote(event.target.value)}
            />
          </Field>
        </div>

        <Problem error={dispatchTrip.error} className="mt-3" />
      </Sheet>

      {printing !== null && (
        <PrintSuratJalan
          printing={printing}
          onClose={() => setPrinting(null)}
          siteId={siteId}
        />
      )}
      <SavedDialog
        open={dispatched !== null}
        onOpenChange={(next) => {
          if (!next) setDispatched(null)
        }}
        title={dispatched ?? ""}
      />
    </>
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
type Printing =
  { readonly dispatchId: string } | { readonly shipmentIds: readonly string[] }

function printingFor(shipment: Shipment): Printing {
  return shipment.dispatch_id !== null
    ? { dispatchId: shipment.dispatch_id }
    : { shipmentIds: [shipment.shipment_id] }
}

function PrintSuratJalan({
  printing,
  onClose,
  siteId,
}: {
  printing: Printing
  onClose: () => void
  siteId: string | null
}) {
  return "dispatchId" in printing ? (
    <TripSuratJalanPrint
      dispatchId={printing.dispatchId}
      open
      onClose={onClose}
      siteId={siteId}
    />
  ) : (
    <SuratJalanPrint
      shipmentIds={printing.shipmentIds}
      open
      onClose={onClose}
      siteId={siteId}
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

/// The left half of Dispatch: every shop with a carton ready, and how much of
/// it is ticked for this trip. The same rail shape Packing's own composer
/// used — a shop chosen before its cartons, because building a trip is one
/// shop's cartons at a time.
function ShopRail({
  shopIds,
  boxesByShop,
  left,
  going,
  current,
  onFocus,
}: {
  shopIds: readonly string[]
  boxesByShop: ReadonlyMap<string, Koli[]>
  left: ReadonlySet<string>
  going: number
  current: string | null
  onFocus: (shopId: string) => void
}) {
  const shopName = useShopName()
  return (
    <div className="flex shrink-0 flex-col overflow-hidden rounded-inner border border-hairline sm:w-64">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-hairline px-3">
        <span className="font-medium text-ink">Stores</span>
        <span className="flex-1" />
        <span className="text-[0.9375rem] text-mute">{count(going)} going</span>
      </div>
      <div className="flex-1 overflow-y-auto">
        {shopIds.map((id) => {
          const mine = boxesByShop.get(id) ?? []
          const ticked = mine.filter((box) => !left.has(box.koli_id)).length
          return (
            <button
              key={id}
              type="button"
              onClick={() => onFocus(id)}
              className={cn(
                "flex w-full items-center gap-2.5 border-b border-hairline px-3 py-2 text-left transition-colors last:border-b-0",
                id === current ? "bg-accent-bg" : "hover:bg-soft"
              )}
            >
              <span className="min-w-0 flex-1 truncate">{shopName(id)}</span>
              <span className="shrink-0 text-right text-[0.9375rem]">
                {ticked === 0 ? (
                  <span className="text-faint">—</span>
                ) : ticked === mine.length ? (
                  <span className="text-ink">{count(ticked)} koli</span>
                ) : (
                  <>
                    <span className="text-ink">{count(ticked)}</span>
                    <span className="text-mute"> / {count(mine.length)}</span>
                  </>
                )}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

/// The right half of Dispatch: one shop's ready cartons, each already ticked
/// unless it was left off.
function CartonChoice({
  cartons,
  left,
  allTicked,
  indeterminate,
  onToggleShop,
  onToggleOne,
}: {
  cartons: readonly Koli[]
  left: ReadonlySet<string>
  allTicked: boolean
  indeterminate: boolean
  onToggleShop: (on: boolean) => void
  onToggleOne: (koliId: string, on: boolean) => void
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[28rem] border-collapse">
        <thead>
          <tr>
            <th className="w-8 pr-2 pb-1.5 text-left">
              <Checkbox
                label={<span className="sr-only">Every koli</span>}
                checked={allTicked}
                indeterminate={indeterminate}
                onChange={onToggleShop}
              />
            </th>
            <th className="pr-2 pb-1.5 text-left font-mono text-eyebrow tracking-[0.04em] text-body uppercase">
              Koli
            </th>
            <th className="pb-1.5 pl-3 text-right font-mono text-eyebrow tracking-[0.04em] text-body uppercase">
              Pcs
            </th>
            <th className="pb-1.5 pl-3 text-right font-mono text-eyebrow tracking-[0.04em] text-body uppercase">
              Packed
            </th>
          </tr>
        </thead>
        <tbody>
          {cartons.map((box) => {
            const ticked = !left.has(box.koli_id)
            return (
              <MiniRow key={box.koli_id}>
                <MiniCell>
                  <Checkbox
                    label={<span className="sr-only">{box.koli_number}</span>}
                    checked={ticked}
                    onChange={(on) => onToggleOne(box.koli_id, on)}
                  />
                </MiniCell>
                <MiniCell>
                  <span
                    className={cn(
                      "font-mono",
                      ticked ? "text-ink" : "text-faint"
                    )}
                  >
                    {box.koli_number}
                  </span>
                  <KoliPhotos koli={[box.koli_id]} className="mt-1.5" />
                </MiniCell>
                <MiniCell align="right">{count(box.unit_count)}</MiniCell>
                <MiniCell align="right">{clock(box.sealed_at)}</MiniCell>
              </MiniRow>
            )
          })}
        </tbody>
      </table>
    </div>
  )
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
