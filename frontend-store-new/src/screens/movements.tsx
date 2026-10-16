import { PackagePlus } from "lucide-react"
import { useDeferredValue, useEffect, useMemo, useState } from "react"

import { DockTools } from "@/components/shell/dock-tools"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { CardList } from "@/components/ui/card-list"
import { LeadCard } from "@/components/ui/lead-card"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { ListTable, type ListColumn } from "@/components/ui/list-table"
import { Status } from "@/components/ui/pill"
import { Screen } from "@/components/ui/screen"
import { Segmented } from "@/components/ui/segmented"
import { EmptyState } from "@/components/ui/states"
import { count, moment } from "@/lib/format"
import { useGo } from "@/lib/go"
import { useLayout } from "@/lib/layout"
import { useParam } from "@/lib/params"
import { queryState } from "@/lib/query-state"
import { MovementSheet } from "@/screens/stock/movement-sheet"
import { useOpenRecord } from "@/screens/stock/open-record"
import { DeskSearch, Route } from "@/screens/stock/parts"
import {
  LEDGER_LIMIT,
  LEDGER_MAX,
  causeLabel,
  causeTone,
  directionOf,
  matches,
  readPlace,
  routeText,
  skuOf,
  useLedger,
  useRange,
  type Direction,
} from "@/screens/stock/shared"
import type { CatalogRow, MovementView } from "@itulah/contract"

/// The ledger, newest first — the hub's Movements (`frontend-hub/src/screens/
/// inventory/movements.tsx`) over one shop's node.
///
/// Append-only: nothing on this screen can be edited, because nothing in the
/// ledger can be. A mistake is corrected by another movement that says what it is
/// correcting, and this is where both of them show up. That is also why there
/// is nothing to write from here.
///
/// Nothing at the top but the title (the top bar's) and the figures.
/// The search and In / Out / Inside are the dock's on a phone and a toolbar on a
/// desk. On a phone a movement is a card — the action over its route, the
/// quantity it leads with, when and by whom in the foot, the SKU at the foot's
/// end; on a desk the ledger is a table, because it is read down and across. A
/// row opens as a sheet (`?movement=`) with everything the ledger holds.
///
/// **Everything is narrowed in the browser.** The node's read takes a limit and
/// nothing else (`edge/http.rs::movements`), so the direction, the search and
/// the counts all run over the page in hand, and the page says how big it is
/// rather than pretending to be the whole ledger. A shop's day is about a
/// hundred lines; the node will hand over five hundred when asked.
type Way = "all" | Direction

/// How many cards are drawn before somebody asks for more.
const PAGE = 40

export function Movements() {
  const go = useGo()
  const phone = useLayout() === "phone"
  const search = useParam("q")
  const record = useOpenRecord("movement")

  /// What is being typed, held locally and pushed to the URL as it settles —
  /// the Catalogue's split, for the Catalogue's reason: a pool's "Stock ledger"
  /// lands on this screen already narrowed, and a narrowed ledger should
  /// survive the tablet going to sleep.
  const [typed, setTyped] = useState(search.value ?? "")
  useEffect(() => {
    const timer = setTimeout(
      () => search.set(typed.trim() === "" ? undefined : typed.trim()),
      350,
    )
    return () => clearTimeout(timer)
    // `search.set` is a fresh closure each render; depending on it would
    // reschedule the timer forever and the value would never land.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typed])
  const needle = useDeferredValue(typed).trim().toLowerCase()

  const [limit, setLimit] = useState(LEDGER_LIMIT)
  const [way, setWay] = useState<Way>("all")
  const [shownCards, setShownCards] = useState(PAGE)
  const ledger = useLedger(limit)
  const { bySku } = useRange()

  const rows = useMemo(() => ledger.data ?? [], [ledger.data])
  const counts = useMemo(() => {
    const tally = { in: 0, out: 0, inside: 0 }
    for (const row of rows) tally[directionOf(row)] += 1
    return tally
  }, [rows])
  const shown = rows.filter(
    (row) =>
      (way === "all" || directionOf(row) === way) &&
      matchesRow(needle, row, bySku),
  )
  const ready = ledger.data !== undefined

  // A new narrowing starts at the top, not at the depth the last one was read
  // to — compared during render so no stale frame is drawn first.
  const scope = `${needle}|${way}`
  const [lastScope, setLastScope] = useState(scope)
  if (scope !== lastScope) {
    setLastScope(scope)
    setShownCards(PAGE)
  }

  const options = [
    { value: "all" as const, label: "All", count: rows.length },
    { value: "in" as const, label: "In", count: counts.in },
    { value: "out" as const, label: "Out", count: counts.out },
    { value: "inside" as const, label: "Inside", count: counts.inside },
  ]
  const capped = rows.length >= limit
  const more = capped && limit < LEDGER_MAX

  return (
    <Screen counter>
      <DockTools
        search={{
          value: typed,
          onChange: setTyped,
          label: "Search tag, SKU, place, person",
        }}
        status={{
          value: way,
          options,
          onChange: (next) => setWay(next as Way),
        }}
      />

      <KpiStrip>
        <Kpi label="Movements" value={ready ? count(rows.length) : "—"} />
        <Kpi label="In" value={ready ? count(counts.in) : "—"} />
        <Kpi label="Out" value={ready ? count(counts.out) : "—"} />
        <Kpi label="Inside" value={ready ? count(counts.inside) : "—"} />
      </KpiStrip>

      {queryState(ledger, {
        loading: "Reading the ledger…",
        render: () =>
          rows.length === 0 ? (
            <EmptyState
              action={
                <Button onClick={() => go("/receive")}>
                  <PackagePlus />
                  Receive stock
                </Button>
              }
            >
              No movements yet.
            </EmptyState>
          ) : (
            <>
              {/* The desk's toolbar: the search at the left, the direction at
                  the right. On a phone both are the dock's. */}
              <div className="mb-3.5 flex flex-wrap items-center gap-[0.4375rem] max-md:hidden">
                <DeskSearch
                  value={typed}
                  onChange={setTyped}
                  label="Search the ledger"
                  placeholder="Tag, SKU, place, person"
                />
                <span className="flex-1" />
                <Segmented<Way>
                  value={way}
                  onChange={setWay}
                  options={options.map((one) => ({
                    value: one.value,
                    label: `${one.label} · ${count(one.count)}`,
                  }))}
                />
              </div>

              {shown.length === 0 ? (
                <EmptyState>
                  {needle !== ""
                    ? `No match for “${typed.trim()}”.`
                    : way === "in"
                      ? "Nothing in."
                      : way === "out"
                        ? "Nothing out."
                        : "Nothing moved inside."}
                </EmptyState>
              ) : phone ? (
                <>
                  <CardList>
                    {shown.slice(0, shownCards).map((row) => (
                      <MovementCard
                        key={row.movement_id}
                        row={row}
                        bySku={bySku}
                        selected={record.value === row.movement_id}
                        onOpen={() => record.open(row.movement_id)}
                      />
                    ))}
                  </CardList>
                  {shown.length > shownCards && (
                    <div className="mt-5 flex justify-center">
                      <Button
                        onClick={() => setShownCards((was) => was + PAGE)}
                      >
                        Show {count(Math.min(PAGE, shown.length - shownCards))}{" "}
                        more
                      </Button>
                    </div>
                  )}
                </>
              ) : (
                <Card>
                  <ListTable
                    rows={shown}
                    columns={columnsFor(bySku)}
                    rowKey={(row) => row.movement_id}
                    onOpen={(row) => record.open(row.movement_id)}
                    empty="Nothing here."
                  />
                </Card>
              )}

              {more && (
                <div className="mt-5 flex justify-center">
                  <Button
                    onClick={() => setLimit(LEDGER_MAX)}
                    pending={ledger.isPlaceholderData}
                  >
                    {ledger.isPlaceholderData
                      ? "Reading…"
                      : `Show the last ${count(LEDGER_MAX)}`}
                  </Button>
                </div>
              )}
            </>
          ),
      })}

      <MovementSheet
        row={rows.find((row) => row.movement_id === record.value)}
        rows={rows}
        bySku={bySku}
        onClose={record.close}
      />
    </Screen>
  )
}

/// Every word a movement carries, so the box finds a row by whatever the
/// person has in hand: the tag, the SKU, the garment's name, a place — by its
/// name or by its id, which is what a pool's "Stock ledger" sends — or who did
/// it.
function matchesRow(
  needle: string,
  row: MovementView,
  bySku: ReadonlyMap<string, CatalogRow>,
): boolean {
  const sku = skuOf(row.epc)
  return matches(
    needle,
    row.epc,
    sku,
    sku === null ? null : bySku.get(sku)?.name,
    row.cause,
    causeLabel(row.cause),
    row.from,
    row.to,
    readPlace(row.from, row.cause).name,
    readPlace(row.to, row.cause).name,
    row.actor_id,
    row.reference_id,
  )
}

/// One movement as the uniform card: the action over its route and the garment,
/// the quantity as the one figure, and in the foot when and by whom, with the
/// SKU at the foot's end. A loss or a write-off takes the red foot — the eye
/// should stop on the corrections, not on Tuesday.
function MovementCard({
  row,
  bySku,
  selected,
  onOpen,
}: {
  row: MovementView
  bySku: ReadonlyMap<string, CatalogRow>
  selected: boolean
  onOpen: () => void
}) {
  const sku = skuOf(row.epc)
  const name = sku === null ? undefined : bySku.get(sku)?.name
  return (
    <LeadCard
      onOpen={onOpen}
      selected={selected}
      tone={causeTone(row.cause) === "bad" ? "alert" : undefined}
      title={causeLabel(row.cause)}
      lines={[routeText(row.from, row.to, row.cause), name]}
      lead={{
        figure: count(row.quantity),
        caption: row.quantity === 1 ? "pc" : "pcs",
      }}
      foot={{
        info: (
          <span className="tabular-nums">
            {moment(row.occurred_at)} · {row.actor_id}
          </span>
        ),
        status: (
          <span className="font-mono text-[0.875rem] text-mute">
            {sku ?? `…${row.epc.slice(-6)}`}
          </span>
        ),
      }}
    />
  )
}

/// A garment, by name when this shop's book holds it, and by the SKU off its
/// tag always.
function Product({
  epc,
  bySku,
}: {
  epc: string
  bySku: ReadonlyMap<string, CatalogRow>
}) {
  const sku = skuOf(epc)
  if (sku === null) {
    return <span className="font-mono text-id text-mute">…{epc.slice(-8)}</span>
  }
  const name = bySku.get(sku)?.name
  return (
    <span className="flex min-w-0 items-baseline gap-2">
      {name !== undefined && (
        <span className="min-w-0 truncate text-text">{name}</span>
      )}
      <span className="shrink-0 font-mono text-id text-body">{sku}</span>
    </span>
  )
}

/// The desk's columns, over the book they name garments with. A factory for that
/// reason only — the hub's does the same with its pool master.
///
/// Route is the load-bearing column: "out of here, into there" is what a
/// movement IS, and the cause beside it says why.
function columnsFor(
  bySku: ReadonlyMap<string, CatalogRow>,
): readonly ListColumn<MovementView>[] {
  return [
    {
      id: "when",
      header: "When",
      className: "w-[10.5rem]",
      cell: (row) => (
        <span className="text-body tabular-nums">
          {moment(row.occurred_at)}
        </span>
      ),
    },
    {
      id: "movement",
      header: "Movement",
      className: "w-[8.5rem]",
      cell: (row) => (
        <Status tone={causeTone(row.cause)}>{causeLabel(row.cause)}</Status>
      ),
    },
    {
      id: "route",
      header: "Route",
      cell: (row) => (
        <Route
          from={row.from}
          to={row.to}
          cause={row.cause}
          className="max-w-[20rem]"
        />
      ),
    },
    {
      id: "product",
      header: "Article",
      className: "max-w-[18rem]",
      cell: (row) => <Product epc={row.epc} bySku={bySku} />,
    },
    {
      id: "quantity",
      header: "Quantity",
      align: "right",
      className: "w-24",
      cell: (row) => (
        <span className="tabular-nums">{count(row.quantity)}</span>
      ),
    },
    {
      id: "actor",
      header: "By",
      className: "max-lg:hidden",
      cell: (row) => <span className="text-body">{row.actor_id}</span>,
    },
  ]
}
