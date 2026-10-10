import { Radio } from "@base-ui/react/radio"
import { RadioGroup } from "@base-ui/react/radio-group"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { Minus, Plus } from "lucide-react"
import { useEffect, useId, useMemo, useRef, useState } from "react"

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
import { SheetFooter } from "@/components/ui/sheet-footer"
import {
  Banner,
  EmptyState,
  ErrorState,
  LoadingState,
  Problem,
} from "@/components/ui/states"
import { dc } from "@/lib/api"
import { ago, clock, count, dayTime, quantity } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import { keys } from "@/lib/operations/keys"
import {
  dcChangesQuery,
  picklistsQuery,
  pickRoundQuery,
  picklistsToPickQuery,
  poolsQuery,
  shortPicksQuery,
} from "@/lib/operations/queries"
import { useCatalogueIdentity } from "@/lib/operations/catalogue"
import {
  flagged,
  reportShortPick,
  SHORT_REASONS,
  shortReasonLabel,
  type ShortPick,
  type ShortReason,
} from "@/lib/operations/changes"
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
import { prefetchPicklistDetail } from "@/screens/operations/prefetch"
import {
  pickCardKey,
  shortCard,
  shortPickMarks,
  staleSkus,
  type ShortMark,
} from "@/screens/operations/board/owed"
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
  const client = useQueryClient()
  const opened = useSheet("pick")
  const accepting = useSheet("accept")
  const rack = useSheet("rack")
  const [sorting, setSorting] = useState<SortingState>([])

  const toPick = useQuery(picklistsToPickQuery())

  const picklists = useQuery(picklistsQuery())

  const answer = useQuery(poolsQuery())

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
  // racks, so what the warehouse later wrote off comes from the Close short list.
  const closed = useClosedShort()
  // Pickers' short picks: they flag a picklist, they never block the screen,
  // so a failed read leaves everything as it was.
  const shorts = useShortPicks()
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
      // The remainder of a short pick belongs to the allotment × shop, so
      // every round it was walked in carries the flag while it is open.
      const flag = key === null ? undefined : shorts.marks.get(key)
      return { ...round, short, known: closed.ready, flag }
    })
  }, [rounds, closed.ready, closed.byPair, shorts.marks])
  const completedCount = statused.filter(isCompleted).length
  const shortCount = statused.filter((round) => round.short > 0).length
  const shown = useMemo(
    () =>
      view === "all"
        ? statused
        : statused.filter((round) =>
            view === "short" ? round.short > 0 : isCompleted(round)
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
        <Kpi label="Pcs to pick" value={count(pieces)} />
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
                marks={shorts.marks}
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
                    refresh={[toPick, picklists]}
                    table={table}
                    onRowClick={(row) => opened.open(row.session.session_id)}
                    onRowIntent={(row) =>
                      void prefetchPicklistDetail(
                        client,
                        row.session.session_id
                      )
                    }
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
  const toPick = useQuery(picklistsToPickQuery())
  const answer = useQuery(poolsQuery())
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
  /// The picker's short pick still open on this allotment × shop, if any.
  readonly flag: ShortMark | undefined
}

/// A round with a short pick still open is not Completed: some of what was
/// asked is still to pick.
function isCompleted(round: Round): boolean {
  return round.known && round.short === 0 && round.flag === undefined
}

/// How often the flags are read again. The board polls its own at the same
/// pace, so the two screens agree within half a minute.
const SHORT_POLL_MS = 30_000

/// The pickers' short picks, read for the flag on a picklist and for what its
/// sheet says about it.
///
///  - `marks`: one per allotment × shop with a short pick still open (or lost),
///    in the words the board's strip uses (`shortCard(mark).strip`).
///  - `newest`: that picklist's latest report, for the sheet's one fact.
///
/// A flag clears by itself: the count finds the pieces, the remainder is
/// picked or MD closes it, and the report stops being `flagged()`.
function useShortPicks(): {
  marks: ReadonlyMap<string, ShortMark>
  newest: ReadonlyMap<string, ShortPick>
} {
  const query = useQuery({
    ...shortPicksQuery(),
    refetchInterval: SHORT_POLL_MS,
  })
  return useMemo(() => {
    const items = query.data ?? []
    const newest = new Map<string, ShortPick>()
    for (const one of items) {
      if (!flagged(one)) continue
      const key = pickCardKey(one.allotment_id, one.destination_id)
      const was = newest.get(key)
      if (
        was === undefined ||
        one.reported_at.localeCompare(was.reported_at) > 0
      )
        newest.set(key, one)
    }
    return { marks: shortPickMarks(items), newest }
  }, [query.data])
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

/// What the warehouse has closed short, by allotment × shop. A picklist does not
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
///
/// A picklist with a short pick still open keeps its place and stays
/// workable; it carries the board's amber "Short pick" strip across the top
/// of its row (`shortCard(mark).strip`), and the reason only in the strip's
/// tooltip and in the sheet it opens.
function ShopGroup({
  shopId,
  picks,
  marks,
  onOpen,
}: {
  shopId: string
  picks: readonly AllotmentPick[]
  marks: ReadonlyMap<string, ShortMark>
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
        {picks.map((pick) => {
          const mark = marks.get(
            pickCardKey(pick.allotment_id, pick.destination_id)
          )
          const strip = mark === undefined ? undefined : shortCard(mark).strip
          return (
            <li
              key={pick.allotment_id}
              className="border-b border-hairline last:border-b-0"
            >
              <button
                type="button"
                onClick={() => onOpen(pick)}
                className="flex w-full flex-col text-left transition-colors duration-(--t-hover) ease-(--ease-out) hover:bg-soft active:bg-soft-2"
              >
                {strip !== undefined && (
                  <span
                    title={strip.title}
                    className="flex h-7 w-full items-center bg-warn-fg px-3.5 text-[0.875rem] font-semibold text-white"
                  >
                    {strip.label}
                  </span>
                )}
                <span className="flex min-h-11 w-full items-center gap-3 px-3.5 py-2.5">
                  <span className="block min-w-0 flex-1">
                    <span className="block truncate text-[0.9375rem] text-ink">
                      {pick.allotment_number}
                    </span>
                    <span className="block truncate text-[0.875rem] text-mute">
                      {ago(pick.created_at)} · {count(pick.lines.length)}{" "}
                      {pick.lines.length === 1 ? "SKU" : "SKUs"}
                    </span>
                  </span>
                  <span className="shrink-0 text-[0.9375rem] font-medium text-ink tabular-nums">
                    {count(pick.pieces)}
                  </span>
                </span>
              </button>
            </li>
          )
        })}
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
    header: "Pcs",
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
        {row.original.flag === undefined ? (
          <StatusPill short={row.original.short} known={row.original.known} />
        ) : (
          <Pill tone="warn" title={row.original.flag.title}>
            Short pick
          </Pill>
        )}
        {row.original.short > 0 && (
          <span className="text-[0.9375rem] font-medium text-bad-fg tabular-nums">
            −{quantity(row.original.short)}
          </span>
        )}
      </span>
    ),
  },
]

/// "Navy · M": the colour and size of a SKU, when the catalogue knows them.
function variantOf(
  identity:
    | { readonly colour: string | null; readonly size: string | null }
    | undefined
): string {
  return [identity?.colour, identity?.size]
    .filter((part) => part !== null && part !== undefined && part !== "")
    .join(" · ")
}

/// Whether a reason is about the stock, and so raises a count. The reasons
/// about the work (a label, equipment, anything else) raise none and open no
/// case for anybody else.
const raisesCount = (reason: ShortReason) =>
  SHORT_REASONS.some((one) => one.code === reason && one.stock)

/// What a short pick still has to tell the server, kept whole: a retry sends
/// the same writes under the same keys, and the server takes each of them
/// once. Made after the pick is in, so it is never part of the pick.
interface ShortPlan {
  /// The picklist it belongs to, by `acceptKey`.
  readonly key: string
  readonly allotmentId: string
  readonly destinationId: string
  /// The pick the pieces were not found on, when anything was picked.
  readonly sessionId: string | null
  readonly reason: ShortReason
  /// The rack a count is raised in.
  readonly poolId: string | null
  /// One report per SKU: how many were not found, and the key it is sent under.
  readonly rows: readonly {
    readonly sku_code: string
    readonly pieces: number
    readonly key: string
  }[]
  /// The keys of the count a stock reason raises, made once.
  readonly countKeys: {
    readonly create: string
    readonly activate: string
  }
}

/// Why a line came back short: five answers, one tap each (owner, 9 Oct 2026),
/// drawn as a list of large radios — a row apiece, 52px tall, the chosen one
/// with its dot filled and its row tinted (10 Oct 2026: "radio besar"). One is
/// chosen and stays chosen, because the sheet does not go without it. A radio
/// group, so there is one tab stop and the arrow keys move along it; the block
/// rises 4px as it appears (and only fades under reduced motion).
function WhyChips({
  value,
  onChange,
}: {
  value: ShortReason | null
  onChange: (next: ShortReason) => void
}) {
  const name = useId()
  return (
    <div className="flex flex-col gap-2.5 transition-[opacity,translate] duration-200 ease-(--ease-out) starting:translate-y-1 starting:opacity-0 motion-reduce:starting:translate-none">
      <span id={name} className="text-[0.9375rem] font-medium text-text">
        Why?
        <span aria-hidden className="ml-0.5 text-bad">
          *
        </span>
        <span className="sr-only"> (required)</span>
      </span>
      <RadioGroup
        aria-labelledby={name}
        value={value ?? ""}
        onValueChange={(next) => onChange(next as ShortReason)}
        className="flex flex-col gap-2"
      >
        {SHORT_REASONS.map((one) => {
          const chosen = one.code === value
          return (
            <Radio.Root
              key={one.code}
              value={one.code}
              className={cn(
                "flex min-h-13 w-full cursor-pointer items-center gap-3.5 rounded-inner border px-4 py-3 text-left transition-[color,background-color,border-color,scale] duration-(--t-press) ease-(--ease-out) active:scale-[0.99] motion-reduce:active:scale-100",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
                chosen
                  ? "border-accent bg-accent-bg"
                  : "border-hairline-2 bg-canvas hover:border-hairline-strong hover:bg-soft-2"
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "grid size-6 shrink-0 place-items-center rounded-full border-2 transition-colors",
                  chosen ? "border-accent" : "border-hairline-strong"
                )}
              >
                <Radio.Indicator
                  keepMounted
                  className="size-3 scale-50 rounded-full bg-accent opacity-0 transition-[scale,opacity] duration-150 ease-(--ease-out) data-[checked]:scale-100 data-[checked]:opacity-100"
                />
              </span>
              <span
                className={cn(
                  "min-w-0 flex-1 text-[0.9375rem] leading-5 font-medium",
                  chosen ? "text-accent" : "text-ink"
                )}
              >
                {one.label}
              </span>
            </Radio.Root>
          )
        })}
      </RadioGroup>
    </div>
  )
}

/// One picklist not yet accepted. Accepting takes what was asked, unless the
/// picker lowers a line to what was actually found (owner, 1 Oct 2026).
///
/// A lowered line is a SHORT PICK (owner, 9 Oct 2026). What was found goes on;
/// the shortfall stays on the same picklist, so nothing is written off and
/// nothing is decided here: the sheet asks WHY in one tap and reports it. The
/// warehouse is RFID-tagged and a picker who found 8 of 10 cannot say WHICH
/// tags are gone, so a reason about the stock (not confirmed, not at the rack,
/// damaged) also raises a TARGETED count on those SKUs in the source pool, to
/// be counted with the handheld. A reason about the work (a label, equipment,
/// anything else) raises none.
///
/// The pick comes first and is never undone by what follows it. When the
/// report or the count does not reach the server the sheet says so, stays,
/// and keeps the same writes under the same keys for a retry.
function AcceptSheet({
  pick,
  onClose,
  source,
  racks,
  onRack,
  canAccept,
}: {
  pick: AllotmentPick | null
  onClose: () => void
  source: string | null
  racks: readonly { id: string; label: string; stock: number }[]
  onRack: (id: string) => void
  canAccept: boolean
}) {
  const actor = useEdgeActor()
  const cloudActor = useActor()
  const client = useQueryClient()
  const shopName = useShopName()
  const catalogue = useCatalogueIdentity()
  const reports = useShortPicks()

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

  // Why it came back short, tagged with its picklist the same way.
  const [chosen, setChosen] = useState<{
    key: string
    value: ShortReason | null
  }>({ key: "", value: null })
  const why = chosen.key === openKey ? chosen.value : null

  // The report that did not get through, held for a retry. Tagged with its
  // picklist: the sheet stays mounted between openings.
  const [unsent, setUnsent] = useState<ShortPlan | null>(null)
  const plan = unsent !== null && unsent.key === openKey ? unsent : null

  // The picklist's open short pick, if one is already out there: its reason,
  // who said it and when.
  const openReport = reports.newest.get(openKey)

  // What MD changed on this picklist that the Gudang has not acknowledged:
  // the banner on top, and the reason a refused line is not a short pick.
  const changes = useQuery(dcChangesQuery())
  const changed = (changes.data ?? []).filter(
    (one) =>
      pick !== null &&
      one.allotment_id === pick.allotment_id &&
      one.destination_id === pick.destination_id
  )
  const cancelled = changed.some((one) => one.cancelled)

  // Lowering a line brings the question in under the lines; on a phone that
  // can be below the fold, so it is scrolled to (calmly, or not at all under
  // reduced motion).
  const asking = shortPieces > 0 && plan === null
  const whyRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!asking) return
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    whyRef.current?.scrollIntoView({
      block: "nearest",
      behavior: calm ? "auto" : "smooth",
    })
  }, [asking])

  // The cloud's pool row carries the site a count is raised against; the
  // edge's own pool answer does not.
  const fleet = useQuery({
    queryKey: inventoryKeys.fleet(),
    queryFn: ({ signal }) => fleetPools(signal),
    staleTime: 5 * 60 * 1000,
  })

  /// Raise the count for the short SKUs in the rack, and activate it so the
  /// handheld has it. Resolves to the count's id, or `null` when it cannot be
  /// raised. Its keys are the plan's, so a retry replays what already worked.
  async function raiseCount(one: ShortPlan): Promise<string | null> {
    const pool = (fleet.data?.items ?? []).find(
      (each) => each.id === one.poolId
    )
    const ids = one.rows.map((row) => catalogue.get(row.sku_code)?.sku_id)
    if (pool === undefined || ids.some((id) => id === undefined)) return null
    const created = await createCount({
      site_id: pool.site_id,
      pool_id: pool.id,
      kind: "TARGETED",
      sku_ids: ids as string[],
      epcs: [],
      reason: "Short pick",
      actor_id: cloudActor,
      idempotency_key: one.countKeys.create,
    })
    await activateCount(created.id, {
      actor_id: cloudActor,
      idempotency_key: one.countKeys.activate,
    })
    return created.id
  }

  /// Tell the server about a short pick: the count first when the reason is
  /// about the stock (its id goes on every report), then one report per SKU.
  /// Resolves to whether all of it got there. Never throws: the pick it
  /// follows has already happened and must not look as if it had not.
  async function send(one: ShortPlan): Promise<boolean> {
    try {
      let countId: string | null = null
      if (raisesCount(one.reason)) {
        countId = await raiseCount(one)
        if (countId === null) return false
      }
      await Promise.all(
        one.rows.map((row) =>
          reportShortPick({
            idempotency_key: row.key,
            allotment_id: one.allotmentId,
            destination_id: one.destinationId,
            sku_code: row.sku_code,
            pieces: row.pieces,
            reason: one.reason,
            pick_session_id: one.sessionId,
            count_id: countId,
          })
        )
      )
      return true
    } catch {
      return false
    }
  }

  /// The picklist is done with: its receipt, then back to the list.
  function finish(pieces: number) {
    if (pieces > 0) {
      // A caution, not a receipt: the picker has a shortfall to know about.
      toast.warning(`Short pick reported · ${quantity(pieces)}`)
    } else {
      setAccepted(true)
    }
    // Back to the list: the picklist's own sheet is not opened on what was
    // just accepted (owner, 10 Oct 2026).
    onClose()
  }

  const accept = useMutation({
    mutationFn: async () => {
      if (pick === null) throw new Error("Nothing to accept.")
      const lines = pick.lines
        .map((line) => ({ sku_code: line.sku_code, quantity: pickedOf(line) }))
        .filter((line) => line.quantity > 0)
      // Every line picked at nothing: there is no trip to write down, only
      // the report to make.
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
      // What the rack refused was not picked either, whatever was typed.
      const refused = new Map<string, number>()
      for (const line of result?.refused ?? [])
        refused.set(
          line.sku_code,
          (refused.get(line.sku_code) ?? 0) + line.quantity
        )
      // Lowered by the picker, or answered "no" by the rack: both are a line
      // that came back short, by how many it did not get.
      //
      // What the server refused on a SKU MD cancelled or reduced is MD's
      // change, not a shortfall (owner, 10 Oct 2026: a cancel mid-pick must
      // not turn into a short pick report): only what the picker lowered
      // himself is reported there.
      const stale = staleSkus(changed)
      let byMd = 0
      const rows = pick.lines.flatMap((line): ShortPlan["rows"] => {
        const refusedHere = refused.get(line.sku_code) ?? 0
        const took = Math.max(0, pickedOf(line) - refusedHere)
        const mine = stale.all || stale.skus.has(line.sku_code)
        if (mine) byMd += Math.min(refusedHere, pickedOf(line))
        const pieces = mine
          ? line.outstanding - pickedOf(line)
          : line.outstanding - took
        return pieces > 0
          ? [{ sku_code: line.sku_code, pieces, key: idempotencyKey() }]
          : []
      })
      const sessionId = result?.summary.session.session_id ?? null
      if (rows.length === 0)
        return { sessionId, plan: null, sent: true, pieces: 0, byMd }
      const made: ShortPlan = {
        key: acceptKey(pick),
        allotmentId: pick.allotment_id,
        destinationId: pick.destination_id,
        sessionId,
        // A rack that said no without the picker saying why is a question
        // about the stock.
        reason: why ?? "NOT_CONFIRMED",
        poolId: source,
        rows,
        countKeys: { create: idempotencyKey(), activate: idempotencyKey() },
      }
      return {
        sessionId,
        plan: made,
        sent: await send(made),
        pieces: rows.reduce((total, row) => total + row.pieces, 0),
        byMd,
      }
    },
    onSuccess: ({ plan: made, sent, pieces, byMd }) => {
      // The round just walked is a picklist, and what it left behind is still
      // on the to-pick list; the stock it took is off the rack.
      void client.invalidateQueries({ queryKey: keys.picklists() })
      void client.invalidateQueries({ queryKey: keys.picklistsToPick() })
      void client.invalidateQueries({ queryKey: keys.pools() })
      void client.invalidateQueries({ queryKey: keys.shortPicks() })
      void client.invalidateQueries({ queryKey: inventoryKeys.counts() })
      // What was typed is spent: the remainder opens at what is still to pick.
      setFound_({ key: "", values: {} })
      setChosen({ key: "", value: null })
      if (made !== null && !sent) {
        // The pick is in and the report is not: stay, the retry is here.
        setUnsent(made)
        return
      }
      if (pieces === 0 && byMd > 0) {
        toast("Picklist changed by MD")
        onClose()
        return
      }
      finish(pieces)
    },
  })

  const retry = useMutation({
    mutationFn: async (again: ShortPlan) => ({
      again,
      sent: await send(again),
    }),
    onSuccess: ({ again, sent }) => {
      if (!sent) return
      setUnsent(null)
      void client.invalidateQueries({ queryKey: keys.shortPicks() })
      void client.invalidateQueries({ queryKey: inventoryKeys.counts() })
      finish(again.rows.reduce((total, row) => total + row.pieces, 0))
    },
  })
  const stillUnsent = retry.data?.sent === false

  /// The picklist the sheet accepted, held in the receipt dialog until it is
  /// read. The sheet stays mounted between openings, so the state survives
  /// the handover.
  const [accepted, setAccepted] = useState(false)

  // A refusal from the last picklist must not still be sitting under this
  // one — the sheet stays mounted between openings.
  useEffect(() => {
    if (pick !== null) {
      accept.reset()
      retry.reset()
    }
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
        pick === null ? undefined : plan !== null ? (
          <SheetFooter
            onCancel={onClose}
            cancelLabel="Close"
            primary={{
              label: "Retry",
              pendingLabel: "Retrying…",
              pending: retry.isPending,
              onClick: () => retry.mutate(plan),
            }}
          />
        ) : (
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
              <p
                role="status"
                className="text-[0.9375rem] font-medium text-bad-fg tabular-nums"
              >
                {quantity(shortPieces)} short
                {why === null && (
                  <span className="font-normal text-mute"> · choose why</span>
                )}
              </p>
            )}
            <Button
              variant="primary"
              className="w-full"
              disabled={
                !canAccept ||
                source === null ||
                (shortPieces > 0 && why === null)
              }
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
          {changed.length > 0 && (
            <Banner tone={cancelled ? "bad" : "warn"}>
              {cancelled ? (
                "MD cancelled this picklist. Put back anything you took."
              ) : (
                <>
                  MD changed this picklist
                  <ul className="mt-1 tabular-nums">
                    {changed
                      .flatMap((one) => one.lines)
                      .map((line) => (
                        <li key={line.allotment_line_id}>
                          <span className="font-mono">{line.sku_code}</span>{" "}
                          {count(line.was)} → {count(line.now)}
                        </li>
                      ))}
                  </ul>
                </>
              )}
            </Banner>
          )}
          <Facts>
            <Fact term="Shop">{shopName(pick.destination_id)}</Fact>
            <Fact term="Allotment">{pick.allotment_number}</Fact>
            <Fact term="Request at">{ago(pick.created_at)}</Fact>
            <Fact term="Pcs">{count(pick.pieces)}</Fact>
            {plan !== null ? (
              <Fact term="Short pick" wide>
                {shortReasonLabel(plan.reason)}
              </Fact>
            ) : (
              openReport !== undefined && (
                <Fact term="Short pick" wide>
                  {shortReasonLabel(openReport.reason)} ·{" "}
                  {openReport.reported_by} · {dayTime(openReport.reported_at)}
                </Fact>
              )
            )}
          </Facts>

          {plan !== null ? (
            <>
              <Banner tone="warn">
                {stillUnsent
                  ? "The short pick report still did not reach the server. Try again."
                  : "The pick is in. The short pick report did not reach the server. Try again."}
              </Banner>
              <MiniTable head={["Article", "Short"]}>
                {plan.rows.map((row) => {
                  const identity = catalogue.get(row.sku_code)
                  const variant = variantOf(identity)
                  return (
                    <MiniRow key={row.sku_code}>
                      <MiniCell>
                        <div className="text-ink">
                          {identity?.article_name ?? row.sku_code}
                        </div>
                        <div className="text-mute">
                          {variant !== "" && <>{variant} · </>}
                          <span className="font-mono">{row.sku_code}</span>
                        </div>
                      </MiniCell>
                      <MiniCell align="right">
                        <span className="font-medium text-bad-fg tabular-nums">
                          −{count(row.pieces)}
                        </span>
                      </MiniCell>
                    </MiniRow>
                  )
                })}
              </MiniTable>
            </>
          ) : (
            <>
              {phone ? (
                <ul className="divide-y divide-hairline border-y border-hairline">
                  {pick.lines.map((line) => {
                    const identity = catalogue.get(line.sku_code)
                    const variant = variantOf(identity)
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
                    const variant = variantOf(identity)
                    const name = identity?.article_name ?? line.sku_code
                    return (
                      <MiniRow key={line.sku_code}>
                        <MiniCell className="py-3.5">
                          <div className="text-ink">{name}</div>
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
                            label={variant === "" ? name : `${name} · ${variant}`}
                            value={pickedOf(line)}
                            max={line.outstanding}
                            onChange={(next) =>
                              setFound((now) => ({
                                ...now,
                                [line.sku_code]: next,
                              }))
                            }
                          />
                        </MiniCell>
                      </MiniRow>
                    )
                  })}
                </MiniTable>
              )}

              {asking && (
                <div ref={whyRef}>
                  <WhyChips
                    value={why}
                    onChange={(next) =>
                      setChosen({ key: openKey, value: next })
                    }
                  />
                </div>
              )}

              <Problem error={accept.error} />
            </>
          )}
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
  label,
  value,
  max,
  onChange,
}: {
  /// The article and variant being counted: what the number pad is titled
  /// with, should this box ever be opened on a phone.
  label: string
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
        padLabel={label}
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
  const reports = useShortPicks()
  const round = useQuery({
    ...pickRoundQuery(id ?? ""),
    enabled: id !== null,
  })
  // A short pick still open on this allotment × shop: the round was walked
  // short, so it is not Completed while the remainder is to pick.
  const flag =
    round.data === undefined
      ? undefined
      : reports.marks.get(
          pairKey(round.data.allotment_id, round.data.destination_id) ?? ""
        )

  return (
    <Sheet
      open={id !== null}
      onOpenChange={onClose}
      title="Picklist"
      id={id?.slice(0, 8)}
      badge={
        round.data ? (
          flag !== undefined ? (
            <Pill tone="warn" title={flag.title}>
              Short pick
            </Pill>
          ) : (
            <StatusPill
              known={closed.ready}
              short={sumShort(
                closed.byPair.get(
                  pairKey(round.data.allotment_id, round.data.destination_id) ??
                    ""
                ) ?? []
              )}
            />
          )
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
                <Fact term="Pcs">{count(found.total_picked)}</Fact>
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
