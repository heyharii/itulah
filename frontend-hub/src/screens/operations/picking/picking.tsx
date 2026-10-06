import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { Minus, Plus } from "lucide-react"
import { useEffect, useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { useShopName } from "@/components/operations/outbound-papers"
import { AppLink } from "@/components/ui/app-link"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { SavedDialog } from "@/components/ui/dialog"
import { DataTable } from "@/components/ui/data-table"
import { Field, Input, Select } from "@/components/ui/field"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { NumberPad } from "@/components/ui/number-pad"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { MiniCell, MiniRow, MiniTable } from "@/components/ui/rows"
import { Segmented } from "@/components/ui/segmented"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import {
  Banner,
  EmptyState,
  ErrorState,
  LoadingState,
  Problem,
} from "@/components/ui/states"
import { dc, poolsAnswer } from "@/lib/api"
import { ago, clock, count } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import { keys } from "@/lib/operations/keys"
import { useCatalogueIdentity } from "@/lib/operations/catalogue"
import {
  activateCount,
  allotmentsUnfilled,
  createCount,
  fleetPools,
  inventoryKeys,
} from "@/lib/queries/inventory"
import { queryState } from "@/lib/query-state"
import { useEdgeActor } from "@/lib/edge-session"
import { useSheet } from "@/lib/sheets"
import { tableSetup, type TableSetup } from "@/lib/table"
import { toast } from "@/lib/toast"
import { cn } from "@/lib/utils"
import { useActor } from "@/screens/inventory/shared"
import { idempotencyKey } from "@itulah/contract/client"
import type {
  AllotmentPick,
  ClosedShortLine,
  PickedLine,
  PicklistLine,
  PicklistSummary,
} from "@itulah/contract"

/// **Picking: every picklist waiting on a shop, and the ones already walked.**
///
/// A picklist exists automatically for every allotment × shop the moment the
/// allotment is here (owner, 29 Sep 2026) — nobody composes one. **Picking is
/// accept-only, because it runs on a phone in the aisle**: a picker opens a
/// picklist, reads what it wants, and taps Accept. There is nothing to type;
/// how much actually goes in a carton is Packing's question, asked later at a
/// bench with both hands free.
///
/// # Why this is one screen and not three
///
/// It was Picklist, Rounds and Line position. The first showed what was owed
/// and let somebody take it off a rack one SKU at a time; the second showed
/// the round those picks landed in, if anybody had remembered to open one; the
/// third answered a question about an allotment line that nothing on the
/// station had asked. This screen is the two things left: what still needs
/// accepting, grouped by the shop it is for, and what has already been
/// accepted, read back the same way Packing reads it.
export function Picking() {
  const opened = useSheet("pick")
  const accepting = useSheet("accept")
  const rack = useSheet("rack")
  const [sorting, setSorting] = useState<SortingState>([])

  const toPick = useQuery({
    queryKey: keys.picklistsToPick(),
    queryFn: ({ signal }) => dc.picklistsToPick(signal),
  })

  const picklists = useQuery({
    queryKey: keys.picklists(),
    queryFn: ({ signal }) => dc.picklists(signal),
  })

  const answer = useQuery({
    queryKey: keys.pools(),
    queryFn: ({ signal }) => poolsAnswer(signal),
  })

  // Stock comes off a rack, and a rack is a pool this node owns. Offered as a
  // choice rather than guessed from the site id: composing a pool id in the
  // browser would be inventing a wire format nobody asked it to know.
  const racks = (answer.data?.items ?? []).filter(
    (pool) => !pool.is_rollup && pool.group === "WAREHOUSE"
  )
  const source = rack.value ?? racks[0]?.id ?? null

  const picks = toPick.data ?? []
  const pieces = picks.reduce((total, pick) => total + pick.pieces, 0)

  /// The shops with something still to pick, in the order the node already
  /// sorted them — busiest shop's oldest allotment first.
  const byShop = useMemo(() => {
    const map = new Map<string, AllotmentPick[]>()
    for (const pick of picks) {
      const list = map.get(pick.destination_id)
      if (list) list.push(pick)
      else map.set(pick.destination_id, [pick])
    }
    return map
  }, [picks])
  const shopIds = [...byShop.keys()]

  // Newest first: the picklist somebody is asking about is almost always the
  // one they were just handed.
  const rounds = useMemo(
    () =>
      [...(picklists.data ?? [])].sort((left, right) =>
        right.session.started_at.localeCompare(left.session.started_at)
      ),
    [picklists.data]
  )
  const pickedToday = rounds.filter((round) =>
    isToday(round.session.started_at)
  )
  const stillToPack = rounds.filter((round) => round.waiting > 0)

  // Completed or Closed short: the picklist alone only says what came off the
  // racks, so what the Gudang later wrote off comes from the Close short list.
  const closed = useClosedShort()
  const [view, setView] = useState<StatusView>("all")
  const statused = useMemo<Round[]>(() => {
    const seen = new Set<string>()
    return rounds.map((round) => {
      const key = pairKey(round.allotment_id, round.destination_id)
      // One allotment × shop is normally one round; if it ever has two, the
      // write-off belongs to the newest, which is first here.
      const first = key !== null && !seen.has(key)
      if (key !== null) seen.add(key)
      const short =
        first && closed.ready ? sumShort(closed.byPair.get(key) ?? []) : 0
      return { ...round, short, known: closed.ready }
    })
  }, [rounds, closed.ready, closed.byPair])
  const completedCount = statused.filter(
    (round) => round.known && round.short === 0
  ).length
  const shortCount = statused.filter((round) => round.short > 0).length
  const shown = useMemo(
    () =>
      view === "all"
        ? statused
        : statused.filter((round) =>
            view === "short"
              ? round.short > 0
              : round.known && round.short === 0
          ),
    [statused, view]
  )

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: shown,
        columns,
        getRowId: (row: Round) => row.session.session_id,
        state: { sorting },
        onSortingChange: setSorting,
      }),
      [shown, sorting]
    )
  )

  const focused =
    accepting.value === undefined
      ? null
      : (picks.find((pick) => acceptKey(pick) === accepting.value) ?? null)

  const canAccept = racks.length > 0

  return (
    <PageContent>
      <PageHeader
        crumb="Operations"
        title="Picking"
        sub="A picklist exists as soon as an allotment is here — one per allotment, per shop. Open one and accept it; that is the pick."
      />

      <KpiStrip className="grid-cols-2 md:grid-cols-4 xl:grid-cols-4">
        <Kpi label="Picklists to pick" value={count(picks.length)} />
        <Kpi label="Pieces to pick" value={count(pieces)} />
        <Kpi label="Picked today" value={count(pickedToday.length)} />
        <Kpi label="To pack" value={count(stillToPack.length)} />
      </KpiStrip>

      {racks.length === 0 && !answer.isPending && (
        <Banner tone="bad" className="mb-5">
          This node owns no warehouse pool, so there is nothing to pick from.
        </Banner>
      )}

      <Card className="mb-5 overflow-clip">
        <CardHeader>
          <CardTitle>To pick</CardTitle>
        </CardHeader>
        {toPick.isPending ? (
          <LoadingState>Reading what is owed…</LoadingState>
        ) : toPick.isError ? (
          <ErrorState error={toPick.error} onRetry={() => toPick.refetch()} />
        ) : picks.length === 0 ? (
          <EmptyState>Nothing is waiting to be picked right now.</EmptyState>
        ) : (
          <div className="flex flex-col">
            {shopIds.map((shopId) => (
              <ShopGroup
                key={shopId}
                shopId={shopId}
                picks={byShop.get(shopId) ?? []}
                onOpen={(pick) => accepting.open(acceptKey(pick))}
              />
            ))}
          </div>
        )}
      </Card>

      {/* `overflow-clip`, not `overflow-hidden`: hidden makes the card a
          scroll box, and the table's heading would stick to the card instead
          of the window. */}
      <Card className="overflow-clip">
        <CardHeader>
          <CardTitle>Picklists</CardTitle>
        </CardHeader>
        {queryState(picklists, {
          loading: "Reading the picklists…",
          render: () =>
            rounds.length === 0 ? (
              <EmptyState>Nothing has been accepted yet.</EmptyState>
            ) : (
              <>
                <div className="px-4 pb-3.5">
                  <Segmented
                    options={[
                      { value: "all", label: `All ${count(rounds.length)}` },
                      {
                        value: "completed",
                        label: `Completed ${count(completedCount)}`,
                      },
                      {
                        value: "short",
                        label: `Closed short ${count(shortCount)}`,
                      },
                    ]}
                    value={view}
                    onChange={setView}
                  />
                </div>
                {shown.length === 0 ? (
                  <EmptyState>
                    {view === "short"
                      ? "No picklist was closed short."
                      : "No picklist is completed yet."}
                  </EmptyState>
                ) : (
                  <DataTable<Round>
                    table={table}
                    onRowClick={(row) => opened.open(row.session.session_id)}
                    isSelected={(row) =>
                      row.session.session_id === opened.value
                    }
                    summary={{
                      raised: (
                        <span>
                          {count(shown.length)}{" "}
                          <span className="font-normal text-body">
                            {shown.length === 1 ? "picklist" : "picklists"}
                          </span>
                        </span>
                      ),
                      pieces: count(
                        shown.reduce(
                          (total, round) => total + round.total_picked,
                          0
                        )
                      ),
                    }}
                    pageScroll
                  />
                )}
              </>
            ),
        })}
      </Card>

      <AcceptSheet
        pick={focused}
        onClose={() => accepting.close()}
        source={source}
        racks={racks}
        onRack={(id) => rack.replace(id)}
        canAccept={canAccept}
        onAccepted={(sessionId) => opened.swap("accept", sessionId)}
      />

      <Picklist id={opened.value ?? null} onClose={() => opened.close()} />
    </PageContent>
  )
}

/// The accept sheet and the picklist sheet, for a screen that is not Picking —
/// the Outbound board opens a pick in place instead of leaving for this station.
export function PickSheets() {
  const opened = useSheet("pick")
  const accepting = useSheet("accept")
  const rack = useSheet("rack")
  const toPick = useQuery({
    queryKey: keys.picklistsToPick(),
    queryFn: ({ signal }) => dc.picklistsToPick(signal),
  })
  const answer = useQuery({
    queryKey: keys.pools(),
    queryFn: ({ signal }) => poolsAnswer(signal),
  })
  const racks = (answer.data?.items ?? []).filter(
    (pool) => !pool.is_rollup && pool.group === "WAREHOUSE"
  )
  const source = rack.value ?? racks[0]?.id ?? null
  const focused =
    accepting.value === undefined
      ? null
      : ((toPick.data ?? []).find(
          (pick) => acceptKey(pick) === accepting.value
        ) ?? null)
  return (
    <>
      <AcceptSheet
        pick={focused}
        onClose={() => accepting.close()}
        source={source}
        racks={racks}
        onRack={(id) => rack.replace(id)}
        canAccept={racks.length > 0}
        onAccepted={(sessionId) => opened.swap("accept", sessionId)}
      />
      <Picklist id={opened.value ?? null} onClose={() => opened.close()} />
    </>
  )
}

/// The status filter above the picklists table.
type StatusView = "all" | "completed" | "short"

/// A picklist as the table reads it: what came off the racks, and what was
/// written off after. `known` is false until the write-off list has loaded,
/// so a row is never called Completed on a guess.
type Round = PicklistSummary & {
  readonly short: number
  readonly known: boolean
}

/// One allotment × shop — the identity of a picklist before it has a session.
function pairKey(
  allotmentId: string | null,
  destinationId: string | null
): string | null {
  return allotmentId === null || destinationId === null
    ? null
    : `${allotmentId}~${destinationId}`
}

function sumShort(lines: readonly ClosedShortLine[]): number {
  return lines.reduce((total, line) => total + line.closed_short, 0)
}

/// What the Gudang has closed short, by allotment × shop. A picklist does not
/// carry what was asked, only what came off the racks, so the write-off — the
/// Close short already made on its allotment lines — is how a short one shows.
/// The server lists the last 200.
function useClosedShort() {
  const query = useQuery({
    queryKey: inventoryKeys.allotmentsUnfilled(),
    queryFn: ({ signal }) => allotmentsUnfilled(signal),
    staleTime: 60 * 1000,
  })
  const byPair = useMemo(() => {
    const map = new Map<string, ClosedShortLine[]>()
    for (const line of query.data?.closed ?? []) {
      const key = pairKey(line.allotment_id, line.destination_id)
      if (key === null || line.closed_short <= 0) continue
      const list = map.get(key)
      if (list) list.push(line)
      else map.set(key, [line])
    }
    return map
  }, [query.data])
  return { ready: query.data !== undefined, byPair }
}

/// Completed (everything asked was picked) or Closed short, in the shared
/// pill tones; nothing until the write-off list is in.
function StatusPill({ short, known }: { short: number; known: boolean }) {
  if (!known) return <span className="text-mute">—</span>
  return short > 0 ? (
    <Pill tone="warn">Closed short</Pill>
  ) : (
    <Pill tone="ok">Completed</Pill>
  )
}

function isToday(iso: string | null): boolean {
  if (iso === null) return false
  const at = new Date(iso)
  const now = new Date()
  return (
    at.getFullYear() === now.getFullYear() &&
    at.getMonth() === now.getMonth() &&
    at.getDate() === now.getDate()
  )
}

/// The key a picklist not yet accepted is opened by — there is no id for one
/// until `createPicklist` mints a session, so the allotment and the shop
/// together are the identity.
function acceptKey(pick: AllotmentPick): string {
  return `${pick.allotment_id}~${pick.destination_id}`
}

/// A shop the way this list reads it: the register's own name, or a dash for
/// a round an older build raised for nobody in particular.
function ShopCell({ id }: { id: string | null }) {
  const shopName = useShopName()
  if (id === null) return <span className="text-mute">—</span>
  return <span className="truncate text-ink">{shopName(id)}</span>
}

/// One shop's own picklists still to pick, as a heading and a list of rows —
/// single column throughout, because this card is read on a phone in the
/// aisle, not at a desk.
function ShopGroup({
  shopId,
  picks,
  onOpen,
}: {
  shopId: string
  picks: readonly AllotmentPick[]
  onOpen: (pick: AllotmentPick) => void
}) {
  const shopName = useShopName()
  const pieces = picks.reduce((total, pick) => total + pick.pieces, 0)
  return (
    <section className="border-b border-hairline last:border-b-0">
      <div className="flex items-baseline gap-2 bg-soft px-3.5 py-2">
        <span className="min-w-0 flex-1 truncate text-[0.9375rem] font-semibold text-ink">
          {shopName(shopId)}
        </span>
        <span className="shrink-0 text-[0.875rem] text-mute tabular-nums">
          {count(picks.length)} {picks.length === 1 ? "picklist" : "picklists"}{" "}
          · {count(pieces)}
        </span>
      </div>
      <ul>
        {picks.map((pick) => (
          <li key={pick.allotment_id}>
            <button
              type="button"
              onClick={() => onOpen(pick)}
              className="flex min-h-11 w-full items-center gap-3 border-b border-hairline px-3.5 py-2.5 text-left transition-colors last:border-b-0 hover:bg-soft"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-[0.9375rem] text-ink">
                  {pick.allotment_number}
                </div>
                <div className="truncate text-[0.875rem] text-mute">
                  {ago(pick.created_at)} · {count(pick.lines.length)}{" "}
                  {pick.lines.length === 1 ? "SKU" : "SKUs"}
                </div>
              </div>
              <span className="shrink-0 text-[0.9375rem] font-medium text-ink tabular-nums">
                {count(pick.pieces)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

/// Sized to fit a 920px card without scrolling sideways; the picker takes
/// what is left.
const columns: ColumnDef<TableSetup, Round>[] = [
  {
    id: "raised",
    accessorFn: (row: Round) => row.session.started_at,
    header: "Request at",
    size: 140,
    meta: { card: "title" },
    cell: ({ row }) => (
      <span className="font-medium text-ink tabular-nums">
        {clock(row.original.session.started_at)}
      </span>
    ),
  },
  {
    id: "shop",
    accessorFn: (row: Round) => row.destination_id ?? "",
    header: "Shop",
    meta: { card: "meta", grow: 140 },
    cell: ({ row }) => <ShopCell id={row.original.destination_id} />,
  },
  {
    id: "allotment",
    accessorFn: (row: Round) => row.allotment_number ?? "",
    header: "Allotment",
    meta: { card: "meta", grow: 110, priority: 2, mono: true },
    cell: ({ row }) => row.original.allotment_number ?? "—",
  },
  {
    accessorKey: "sku_count",
    header: "SKUs",
    size: 90,
    meta: { align: "right", card: "metric" },
    cell: ({ row }) => count(row.original.sku_count),
  },
  {
    id: "pieces",
    accessorKey: "total_picked",
    header: "Pieces",
    size: 100,
    meta: { align: "right", card: "metric" },
    cell: ({ row }) => count(row.original.total_picked),
  },
  {
    id: "toPack",
    accessorKey: "waiting",
    header: "To Pack",
    size: 100,
    meta: { align: "right", card: "metric", priority: 2 },
    cell: ({ row }) => count(row.original.waiting),
  },
  {
    id: "status",
    accessorFn: (row: Round) => (row.short > 0 ? 1 : 0),
    header: "Status",
    size: 200,
    meta: { card: "status" },
    cell: ({ row }) => (
      <span className="inline-flex items-center gap-3">
        <StatusPill short={row.original.short} known={row.original.known} />
        {row.original.short > 0 && (
          <span className="text-[0.9375rem] font-medium text-bad-fg tabular-nums">
            −{count(row.original.short)} pcs
          </span>
        )}
      </span>
    ),
  },
]

/// One picklist not yet accepted. Accepting takes what was asked, unless the
/// picker lowers a line to what was actually found (owner, 1 Oct 2026).
///
/// A short line does not write Missing: the Gudang is RFID-tagged and a picker
/// who found 8 of 10 cannot say WHICH tags are gone. It raises a TARGETED
/// count on those SKUs in the source pool instead — counted with the
/// handheld's Stock count — and that count's review turns what is really gone
/// into Missing.
function AcceptSheet({
  pick,
  onClose,
  source,
  racks,
  onRack,
  canAccept,
  onAccepted,
}: {
  pick: AllotmentPick | null
  onClose: () => void
  source: string | null
  racks: readonly { id: string; label: string; stock: number }[]
  onRack: (id: string) => void
  canAccept: boolean
  onAccepted: (sessionId: string) => void
}) {
  const actor = useEdgeActor()
  const cloudActor = useActor()
  const client = useQueryClient()
  const shopName = useShopName()
  const catalogue = useCatalogueIdentity()

  // What the picker actually found, by SKU. A line not in here was found in
  // full, so a fresh picklist starts at "everything".
  // Tagged with the picklist it was typed on, so the next one opens clean
  // without an effect to clear it.
  const [typed, setFound_] = useState<{
    key: string
    values: Record<string, number>
  }>({ key: "", values: {} })
  const openKey = pick === null ? "" : acceptKey(pick)
  const found = typed.key === openKey ? typed.values : {}
  const setFound = (
    change: (now: Record<string, number>) => Record<string, number>
  ) => setFound_({ key: openKey, values: change(found) })
  const pickedOf = (line: PicklistLine) =>
    Math.min(found[line.sku_code] ?? line.outstanding, line.outstanding)
  const wanted = pick?.lines.reduce((sum, line) => sum + line.outstanding, 0)
  const got = pick?.lines.reduce((sum, line) => sum + pickedOf(line), 0)
  const shortPieces = (wanted ?? 0) - (got ?? 0)

  // The cloud's pool row carries the site a count is raised against; the
  // edge's own pool answer does not.
  const fleet = useQuery({
    queryKey: inventoryKeys.fleet(),
    queryFn: ({ signal }) => fleetPools(signal),
    staleTime: 5 * 60 * 1000,
  })

  /// Raise the count for the short SKUs in the source pool, and activate it so
  /// the handheld has it. Resolves to whether the count is out there.
  async function raiseCount(skus: readonly string[]): Promise<boolean> {
    const pool = (fleet.data?.items ?? []).find((one) => one.id === source)
    const ids = skus.map((sku) => catalogue.get(sku)?.sku_id)
    if (pool === undefined || ids.some((id) => id === undefined)) return false
    try {
      const created = await createCount({
        site_id: pool.site_id,
        pool_id: pool.id,
        kind: "TARGETED",
        sku_ids: ids as string[],
        epcs: [],
        reason: "Short pick",
        actor_id: cloudActor,
        idempotency_key: idempotencyKey(),
      })
      await activateCount(created.id, {
        actor_id: cloudActor,
        idempotency_key: idempotencyKey(),
      })
      return true
    } catch {
      return false
    }
  }

  const accept = useMutation({
    mutationFn: async () => {
      if (pick === null) throw new Error("Nothing to accept.")
      const lines = pick.lines
        .map((line) => ({ sku_code: line.sku_code, quantity: pickedOf(line) }))
        .filter((line) => line.quantity > 0)
      // Every line picked at nothing: there is no trip to write down, only
      // the count to raise.
      const result =
        lines.length === 0
          ? null
          : await dc.createPicklist({
              source_pool_id: source!,
              lines,
              actor_id: actor,
              note: null,
              // One key per accept: applied twice takes the stock off the
              // rack twice, and the second round is paperwork saying a trip
              // happened that did not.
              idempotency_key: idempotencyKey(),
              destination_id: pick.destination_id,
              allotment_id: pick.allotment_id,
            })
      // Lowered by the picker, or answered "no" by the rack: both are a line
      // that came back short.
      const short = new Set<string>(
        pick.lines
          .filter((line) => pickedOf(line) < line.outstanding)
          .map((line) => line.sku_code)
      )
      for (const line of result?.refused ?? []) short.add(line.sku_code)
      const counted = short.size > 0 ? await raiseCount([...short]) : true
      return { result, short: short.size, counted }
    },
    onSuccess: ({ result, short, counted }) => {
      void client.invalidateQueries({ queryKey: keys.dc.all })
      void client.invalidateQueries({ queryKey: keys.pools() })
      void client.invalidateQueries({ queryKey: inventoryKeys.counts() })
      if (short > 0) {
        // A caution, not a receipt: the picker has short lines to know about.
        toast.warning(
          `${count(short)} ${short === 1 ? "line" : "lines"} short · ${
            counted ? "count raised" : "count not raised"
          }`
        )
      } else {
        setAccepted(true)
      }
      if (result === null) onClose()
      else onAccepted(result.summary.session.session_id)
    },
  })

  /// The picklist the sheet accepted, held in the receipt dialog until it is
  /// read. The sheet stays mounted between openings, so the state survives
  /// the handover.
  const [accepted, setAccepted] = useState(false)

  // A refusal from the last picklist must not still be sitting under this
  // one — the sheet stays mounted between openings.
  useEffect(() => {
    if (pick !== null) accept.reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pick === null ? null : acceptKey(pick)])

  const phone = useLayout() === "phone"

  return (
    <Sheet
      open={pick !== null}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title="Picklist"
      caption={
        pick
          ? `${shopName(pick.destination_id)} · ${pick.allotment_number}`
          : undefined
      }
      footer={
        pick === null ? undefined : (
          <div className="flex flex-col gap-3">
            {racks.length > 1 && (
              <Field label="From">
                <Select
                  aria-label="Rack"
                  value={source ?? ""}
                  onChange={(next) => onRack(next)}
                >
                  {racks.map((pool) => (
                    <option key={pool.id} value={pool.id}>
                      {pool.label} · {count(pool.stock)}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            {shortPieces > 0 && (
              <p className="text-[0.9375rem] font-medium text-bad-fg tabular-nums">
                {count(shortPieces)} short
              </p>
            )}
            <Button
              variant="primary"
              className="w-full"
              disabled={!canAccept || source === null}
              pending={accept.isPending}
              onClick={() => accept.mutate()}
            >
              {accept.isPending ? "Submitting…" : "Submit"}
            </Button>
          </div>
        )
      }
    >
      {pick && (
        <div className="flex flex-col gap-8">
          <Facts>
            <Fact term="Shop">{shopName(pick.destination_id)}</Fact>
            <Fact term="Allotment">{pick.allotment_number}</Fact>
            <Fact term="Request at">{ago(pick.created_at)}</Fact>
            <Fact term="Pieces">{count(pick.pieces)}</Fact>
          </Facts>

          {phone ? (
            <ul className="divide-y divide-hairline border-y border-hairline">
              {pick.lines.map((line) => {
                const identity = catalogue.get(line.sku_code)
                const variant = [identity?.colour, identity?.size]
                  .filter(
                    (part) =>
                      part !== null && part !== undefined && part !== ""
                  )
                  .join(" · ")
                return (
                  <PickLineRow
                    key={line.sku_code}
                    title={identity?.article_name ?? line.sku_code}
                    variant={variant}
                    sku={line.sku_code}
                    outstanding={line.outstanding}
                    value={pickedOf(line)}
                    onChange={(next) =>
                      setFound((now) => ({ ...now, [line.sku_code]: next }))
                    }
                  />
                )
              })}
            </ul>
          ) : (
            <MiniTable head={["Article", "Request Quantity", "Picked"]}>
            {pick.lines.map((line) => {
              const identity = catalogue.get(line.sku_code)
              const variant = [identity?.colour, identity?.size]
                .filter(
                  (part) => part !== null && part !== undefined && part !== ""
                )
                .join(" · ")
              return (
                <MiniRow key={line.sku_code}>
                  <MiniCell className="py-3.5">
                    <div className="text-ink">
                      {identity?.article_name ?? line.sku_code}
                    </div>
                    <div className="mt-1 text-mute">
                      {variant !== "" && <>{variant} · </>}
                      <span className="font-mono">{line.sku_code}</span>
                    </div>
                  </MiniCell>
                  <MiniCell align="right" className="py-3.5">
                    {count(line.outstanding)}
                  </MiniCell>
                  <MiniCell align="right" className="py-3.5">
                    <PickedStepper
                      value={pickedOf(line)}
                      max={line.outstanding}
                      onChange={(next) =>
                        setFound((now) => ({ ...now, [line.sku_code]: next }))
                      }
                    />
                  </MiniCell>
                </MiniRow>
              )
            })}
            </MiniTable>
          )}

          <Problem error={accept.error} />
        </div>
      )}
      <SavedDialog
        open={accepted}
        onOpenChange={(next) => {
          if (!next) setAccepted(false)
        }}
        title="Picklist accepted"
      />
    </Sheet>
  )
}

/// One line of a picklist on a phone: the article and what it is on the left,
/// what the picker found on the right and, under it, what was asked for. The
/// whole line is the button: a tap opens the number pad on it, so there is no
/// keyboard rising over the very row being counted and no pair of minus and
/// plus to hit by mistake (owner, 2026-10-06). Most lines are picked in full
/// and are never touched; one that came back short is one tap and the figure.
/// Never above what was wanted; red once it is under.
function PickLineRow({
  title,
  variant,
  sku,
  outstanding,
  value,
  onChange,
}: {
  title: string
  variant: string
  sku: string
  outstanding: number
  value: number
  onChange: (next: number) => void
}) {
  const [pad, setPad] = useState(false)
  return (
    <li>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-label={`${title}, picked ${value} of ${outstanding}`}
        onClick={() => setPad(true)}
        className="flex w-full items-center gap-3 py-3.5 text-left transition-[background-color] duration-(--t-press) ease-(--ease-out) active:bg-soft-2"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-[0.9375rem] leading-5 font-medium text-ink">
            {title}
          </span>
          {variant !== "" && (
            <span className="block text-[0.875rem] leading-5 text-body">
              {variant}
            </span>
          )}
          <span className="block font-mono text-[0.875rem] leading-5 text-mute">
            {sku}
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1">
          <span
            className={cn(
              "grid h-10 min-w-14 place-items-center rounded-inner border bg-canvas px-3 text-[0.9375rem] font-medium tabular-nums transition-[border-color] duration-(--t-press) ease-(--ease-out)",
              pad ? "border-accent" : "border-hairline-2",
              value < outstanding ? "text-bad-fg" : "text-ink"
            )}
          >
            {count(value)}
          </span>
          <span className="text-[0.875rem] text-mute tabular-nums">
            {`of ${count(outstanding)}`}
          </span>
        </span>
      </button>
      <NumberPad
        open={pad}
        onOpenChange={setPad}
        title={variant === "" ? title : `${title} · ${variant}`}
        value={String(value)}
        decimal={false}
        maxLength={String(outstanding).length}
        onChange={(text) =>
          onChange(
            Math.max(0, Math.min(outstanding, Number(text === "" ? "0" : text)))
          )
        }
      />
    </li>
  )
}

/// What the picker found for one line: minus, the figure, plus. Never above
/// what was wanted, never below nothing; red once it is under.
function PickedStepper({
  value,
  max,
  onChange,
}: {
  value: number
  max: number
  onChange: (next: number) => void
}) {
  const set = (next: number) => onChange(Math.max(0, Math.min(max, next)))
  return (
    <span className="inline-flex items-center gap-2">
      <Button
        variant="ghost"
        aria-label="One less"
        disabled={value <= 0}
        onClick={() => set(value - 1)}
      >
        <Minus />
      </Button>
      <Input
        aria-label="Picked"
        inputMode="numeric"
        value={String(value)}
        onChange={(event) => set(Number(event.target.value.replace(/\D/g, "")))}
        onFocus={(event) => event.target.select()}
        className={`w-16 text-center tabular-nums ${value < max ? "text-bad-fg" : ""}`}
      />
      <Button
        variant="ghost"
        aria-label="One more"
        disabled={value >= max}
        onClick={() => set(value + 1)}
      >
        <Plus />
      </Button>
    </span>
  )
}

/// One picklist, read back: what came off the racks, by article, and what is
/// still to pack.
function Picklist({ id, onClose }: { id: string | null; onClose: () => void }) {
  const shopName = useShopName()
  const closed = useClosedShort()
  const round = useQuery({
    queryKey: keys.pickRound(id ?? ""),
    queryFn: ({ signal }) => dc.pickSession(id!, signal),
    enabled: id !== null,
  })

  return (
    <Sheet
      open={id !== null}
      onOpenChange={onClose}
      title="Picklist"
      id={id?.slice(0, 8)}
      badge={
        round.data ? (
          <StatusPill
            known={closed.ready}
            short={sumShort(
              closed.byPair.get(
                pairKey(round.data.allotment_id, round.data.destination_id) ??
                  ""
              ) ?? []
            )}
          />
        ) : undefined
      }
      actions={
        round.data && round.data.waiting > 0 && round.data.destination_id ? (
          <AppLink
            to="/operations/packing"
            sheet={{ key: "pack", value: round.data.destination_id }}
            variant="primary"
          >
            Pack
          </AppLink>
        ) : undefined
      }
    >
      {queryState(round, {
        loading: "Reading the picklist…",
        render: (found) => {
          const shorts =
            closed.byPair.get(
              pairKey(found.allotment_id, found.destination_id) ?? ""
            ) ?? []
          return (
            <div className="flex flex-col gap-4">
              <Facts>
                <Fact term="Raised">{clock(found.session.started_at)}</Fact>
                <Fact term="Shop">
                  {found.destination_id ? shopName(found.destination_id) : "—"}
                </Fact>
                <Fact term="Allotment">{found.allotment_number ?? "—"}</Fact>
                <Fact term="Picker">{found.session.actor_id}</Fact>
                <Fact term="SKUs">{count(found.sku_count)}</Fact>
                <Fact term="Pieces">{count(found.total_picked)}</Fact>
                <Fact term="To pack">{count(found.waiting)}</Fact>
              </Facts>

              {found.lines.length === 0 && shorts.length === 0 ? (
                <EmptyState>
                  Nothing came off the racks on this picklist.
                </EmptyState>
              ) : (
                <PickedLines lines={found.lines} shorts={shorts} />
              )}
            </div>
          )
        },
      })}
    </Sheet>
  )
}

/// A picklist's own lines, read back with what was picked and what of that is
/// still waiting to be packed — the two figures `SkuLines` was not built to
/// carry side by side.
function PickedLines({
  lines,
  shorts,
}: {
  lines: readonly PickedLine[]
  shorts: readonly ClosedShortLine[]
}) {
  const catalogue = useCatalogueIdentity()
  const shortOf = (sku: string) =>
    sumShort(shorts.filter((line) => line.sku_code === sku))
  // A SKU written off in full was never picked, so it has no line of its own.
  const rows: PickedLine[] = [
    ...lines,
    ...[...new Set(shorts.map((line) => line.sku_code))]
      .filter((sku) => !lines.some((line) => line.sku_code === sku))
      .map((sku) => ({ sku_code: sku, picked: 0, events: 0, waiting: 0 })),
  ]
  return (
    <MiniTable
      head={[
        "Article",
        "Picked",
        "To pack",
        ...(shorts.length > 0 ? ["Short"] : []),
      ]}
    >
      {rows.map((line) => {
        const identity = catalogue.get(line.sku_code)
        const variant = [identity?.colour, identity?.size]
          .filter((part) => part !== null && part !== undefined && part !== "")
          .join(" · ")
        return (
          <MiniRow key={line.sku_code}>
            <MiniCell>
              <div className="text-ink">
                {identity?.article_name ?? line.sku_code}
              </div>
              <div className="text-mute">
                {variant !== "" && <>{variant} · </>}
                <span className="font-mono">{line.sku_code}</span>
              </div>
            </MiniCell>
            <MiniCell align="right">{count(line.picked)}</MiniCell>
            <MiniCell align="right">{count(line.waiting)}</MiniCell>
            {shorts.length > 0 && (
              <MiniCell align="right">
                {shortOf(line.sku_code) > 0 ? (
                  <span className="font-medium text-bad-fg tabular-nums">
                    −{count(shortOf(line.sku_code))}
                  </span>
                ) : (
                  <span className="text-mute">—</span>
                )}
              </MiniCell>
            )}
          </MiniRow>
        )
      })}
    </MiniTable>
  )
}
