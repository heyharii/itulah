import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { Fragment, useEffect, useMemo, useRef, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { useShopName } from "@/components/operations/outbound-papers"
import { AppLink } from "@/components/ui/app-link"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Dialog } from "@/components/ui/dialog"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { MiniCell, MiniRow, MiniTable } from "@/components/ui/rows"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { SheetFooter } from "@/components/ui/sheet-footer"
import { SubTabs } from "@/components/ui/sub-tabs"
import {
  Banner,
  EmptyState,
  ErrorState,
  LoadingState,
  Problem,
} from "@/components/ui/states"
import { TintButton } from "@/components/ui/tint-button"
import { WASH, type WashTone } from "@/components/ui/wash"
import { dc } from "@/lib/api"
import { ago, clock, count, dayTime, quantity, sku as skuNumber } from "@/lib/format"
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
  type DcChange,
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
import { cn } from "@/lib/utils"
import { tableSetup, type TableSetup } from "@/lib/table"
import { toast } from "@/lib/toast"
import { useActor } from "@/screens/inventory/shared"
import { useSeenOnOpen } from "@/lib/operations/acknowledge"
import { PickLines } from "@/screens/operations/picking/pick-lines"
import {
  DEFAULT_PICK_PAPER,
  PrintPickPapers,
} from "@/screens/operations/picking/pick-paper"
import type { Paper } from "@/screens/procurement/po-print"
import { PrintMenu } from "@/screens/procurement/print-menu"
import { prefetchPicklistDetail } from "@/screens/operations/prefetch"
import {
  pickCardKey,
  shortCard,
  shortPickMarks,
  staleSkus,
  type ShortMark,
} from "@/screens/operations/board/owed"
import { idempotencyKey } from "@itulah/contract/client"
import {
  articlePickKey,
  useArticlePicks,
  type ArticlePick,
} from "@/lib/operations/article-picks"
import type {
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
  const pool = useSheet("rack")
  const [sorting, setSorting] = useState<SortingState>([])

  const toPick = useQuery(picklistsToPickQuery())

  const picklists = useQuery(picklistsQuery())

  const answer = useQuery(poolsQuery())

  // Stock comes off a rack, and a rack is a pool this node owns. Offered as a
  // choice rather than guessed from the site id: composing a pool id in the
  // browser would be inventing a wire format nobody asked it to know.
  const pools = (answer.data?.items ?? []).filter(
    (pool) => !pool.is_rollup && pool.group === "WAREHOUSE"
  )
  const source = pool.value ?? pools[0]?.id ?? null

  const picks = useArticlePicks(toPick.data)
  const pieces = picks.reduce((total, pick) => total + pick.pieces, 0)

  /// The shops with something still to pick, in the order the node already
  /// sorted them — busiest shop's oldest allotment first.
  const byShop = useMemo(() => {
    const map = new Map<string, ArticlePick[]>()
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
  /// The two lists are two tabs: what is waiting to be picked, and the
  /// picklists already accepted.
  const [tab, setTab] = useState<"pick" | "lists">("pick")
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

  const canAccept = pools.length > 0

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

      {pools.length === 0 && !answer.isPending && (
        <Banner tone="bad" className="mb-5">
          This node owns no warehouse pool, so there is nothing to pick from.
        </Banner>
      )}

      <SubTabs
        tabs={[
          {
            value: "pick",
            label: (
              <span>
                To pick
                <span className="ml-1.5 text-body tabular-nums">
                  {count(picks.length)}
                </span>
              </span>
            ),
          },
          {
            value: "lists",
            label: (
              <span>
                Picklists
                <span className="ml-1.5 text-body tabular-nums">
                  {count(rounds.length)}
                </span>
              </span>
            ),
          },
        ]}
        value={tab}
        onChange={(next) => setTab(next as "pick" | "lists")}
      />

      {tab === "pick" ? (
        <Card className="overflow-clip">
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
      ) : (
        <>
          {/* The status the picklists are read by. The tab above is the
              dock's button on a phone, so this row stays in the page. */}
          {rounds.length > 0 && (
            <SubTabs
              dock={false}
              className="mb-3.5"
              tabs={[
                {
                  value: "all",
                  label: (
                    <span>
                      All
                      <span className="ml-1.5 text-body tabular-nums">
                        {count(rounds.length)}
                      </span>
                    </span>
                  ),
                },
                {
                  value: "completed",
                  label: (
                    <span>
                      Completed
                      <span className="ml-1.5 text-body tabular-nums">
                        {count(completedCount)}
                      </span>
                    </span>
                  ),
                },
                {
                  value: "short",
                  label: (
                    <span>
                      Closed short
                      <span className="ml-1.5 text-body tabular-nums">
                        {count(shortCount)}
                      </span>
                    </span>
                  ),
                },
              ]}
              value={view}
              onChange={(next) => setView(next as typeof view)}
            />
          )}

          {/* `overflow-clip`, not `overflow-hidden`: hidden makes the card a
              scroll box, and the table's heading would stick to the card
              instead of the window. */}
          <Card className="overflow-clip">
            {queryState(picklists, {
              loading: "Reading the picklists…",
              render: () =>
                rounds.length === 0 ? (
                  <EmptyState>Nothing has been accepted yet.</EmptyState>
                ) : shown.length === 0 ? (
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
                ),
            })}
          </Card>
        </>
      )}

      <AcceptSheet
        pick={focused}
        openId={accepting.value}
        onClose={() => accepting.close()}
        source={source}
        pools={pools}
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
  const pool = useSheet("rack")
  const toPick = useQuery(picklistsToPickQuery())
  const picks = useArticlePicks(toPick.data)
  const answer = useQuery(poolsQuery())
  const pools = (answer.data?.items ?? []).filter(
    (pool) => !pool.is_rollup && pool.group === "WAREHOUSE"
  )
  const source = pool.value ?? pools[0]?.id ?? null
  const focused =
    accepting.value === undefined
      ? null
      : (picks.find((pick) => acceptKey(pick) === accepting.value) ?? null)
  return (
    <>
      <AcceptSheet
        pick={focused}
        openId={accepting.value}
        onClose={() => accepting.close()}
        source={source}
        pools={pools}
        canAccept={pools.length > 0}
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

/// The key a picklist not yet accepted is opened by: allotment, store and
/// article (`articlePickKey`).
function acceptKey(pick: ArticlePick): string {
  return articlePickKey(pick)
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
  picks: readonly ArticlePick[]
  marks: ReadonlyMap<string, ShortMark>
  onOpen: (pick: ArticlePick) => void
}) {
  const shopName = useShopName()
  const pieces = picks.reduce((total, pick) => total + pick.pieces, 0)
  return (
    <section className="border-b border-hairline last:border-b-0">
      <div className="flex items-baseline gap-2 bg-soft px-3.5 py-2">
        <span className="min-w-0 flex-1 truncate text-[0.9375rem] font-semibold text-ink">
          {shopName(shopId)}
        </span>
        <span className="shrink-0 text-[0.9375rem] text-mute tabular-nums">
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
                    className="flex h-7 w-full items-center bg-warn-fg px-3.5 text-[0.9375rem] font-semibold text-white"
                  >
                    {strip.label}
                  </span>
                )}
                <span className="flex min-h-11 w-full items-center gap-3 px-3.5 py-2.5">
                  <span className="block min-w-0 flex-1">
                    <span className="block truncate text-[0.9375rem] text-ink">
                      {pick.allotment_number}
                    </span>
                    <span className="block truncate text-[0.9375rem] text-mute">
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
    { readonly colour: string | null; readonly size: string | null } | undefined
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
  /// What the picker wrote in Cannot pick (owner, 18 Oct 2026: a note, no
  /// reason to choose).
  readonly note?: string | null
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

/// A band across the top of the sheet: what MD did, what the picker said. The
/// wash is the tone's, the title first, then the facts, then (when there is
/// one) the button that settles it at the right.
function Strip({
  tone,
  action,
  children,
}: {
  tone: Exclude<WashTone, "ok" | "neutral">
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div
      className={cn(
        "mb-3.5 flex items-center gap-2.5 rounded-xl px-3.5 py-2.5",
        WASH[tone]
      )}
    >
      {children}
      {action !== undefined && (
        <span className="ml-auto shrink-0">{action}</span>
      )}
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
/// **Cannot pick** (owner, 18 Oct 2026): the one short report, at Pick only.
/// It covers the whole picklist, not only the lines the picker lowered: each
/// line starts at what is not picked (or at all of it when nothing was
/// lowered), a Note says why, and the rest of each line is picked.
function CannotPickDialog({
  open,
  lines,
  pickedOf,
  said,
  pending,
  problem,
  onClose,
  onConfirm,
}: {
  open: boolean
  lines: readonly PicklistLine[]
  pickedOf: (line: PicklistLine) => number
  /// "AL-… · article · store", the one muted line under the title.
  said: string
  pending: boolean
  problem: unknown
  onClose: () => void
  onConfirm: (cut: { cannot: Record<string, number>; note: string }) => void
}) {
  const catalogue = useCatalogueIdentity()
  // Read-only (owner, 18 Oct 2026): what is not picked is what cannot be
  // picked; the picker changes it on the sheet, not here.
  const cannot = Object.fromEntries(
    lines.map((line) => [
      line.sku_code,
      Math.max(0, line.outstanding - pickedOf(line)),
    ])
  )
  const total = Object.values(cannot).reduce((sum, n) => sum + n, 0)
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title={
        total > 0
          ? `Request cannot pick ${quantity(total)}?`
          : "Request cannot pick"
      }
      cancel="Keep"
      confirm="Request cannot pick"
      tone="danger"
      pending={pending}
      problem={problem}
      ready={total > 0}
      reason={{ label: "Note", optional: true }}
      onConfirm={(note) => onConfirm({ cannot, note })}
    >
      <p className="mb-2 text-[0.9375rem] text-mute">{said}</p>
      <ul className="flex flex-col">
        {lines
          .filter((line) => (cannot[line.sku_code] ?? 0) > 0)
          .map((line) => {
            const identity = catalogue.get(line.sku_code)
            return (
              <li
                key={line.sku_code}
                className="flex items-center justify-between gap-3 border-b border-hairline py-2 last:border-b-0"
              >
                <span className="text-[0.9375rem] font-semibold tracking-[0.02em] text-ink uppercase">
                  {variantOf(identity) || skuNumber(line.sku_code)}
                </span>
                <span className="font-medium text-bad-fg tabular-nums">
                  −{cannot[line.sku_code]}
                </span>
              </li>
            )
          })}
      </ul>
    </Dialog>
  )
}

function AcceptSheet({
  pick: livePick,
  openId,
  onClose,
  source,
  pools,
  canAccept,
}: {
  /// The picklist as the node reads it now; `null` once it has left the
  /// To pick list (cancelled by MD, or picked by somebody else).
  pick: ArticlePick | null
  /// The key the sheet was opened with, which outlives `pick` so the sheet
  /// can stay on a picklist MD cancelled while it was open.
  openId: string | undefined
  onClose: () => void
  source: string | null
  pools: readonly { id: string; label: string; stock: number }[]
  canAccept: boolean
}) {
  const actor = useEdgeActor()
  const cloudActor = useActor()
  const client = useQueryClient()
  const shopName = useShopName()
  const catalogue = useCatalogueIdentity()
  const reports = useShortPicks()

  const openKey = openId ?? ""
  // The last picklist read for this key: MD cancelling it takes it off the
  // To pick list, and the sheet must stay on it to say so.
  const [held, setHeld] = useState<{
    key: string
    pick: ArticlePick | null
  }>({ key: "", pick: null })
  if (livePick !== null && held.pick !== livePick)
    setHeld({ key: acceptKey(livePick), pick: livePick })
  const base =
    livePick ?? (openKey !== "" && held.key === openKey ? held.pick : null)

  // What MD changed on this picklist that the Gudang has not acknowledged:
  // the banner on top, and the reason a refused line is not a short pick.
  const changes = useQuery(dcChangesQuery())
  const changedNow = (changes.data ?? []).filter(
    (one) =>
      base !== null &&
      one.allotment_id === base.allotment_id &&
      one.destination_id === base.destination_id
  )
  // Opening the picklist is seeing the change (no "Got it", 15 Oct 2026), so
  // the server forgets it at once; the sheet keeps what it has seen from the
  // moment it opened — also what MD changes while it is open — for the
  // banner, the put-back strips and what a refused line means.
  const [kept, setKept] = useState<{
    key: string
    items: readonly DcChange[]
  }>({ key: "", items: [] })
  const sameChange = (left: DcChange, right: DcChange) =>
    left.at === right.at && left.allotment_id === right.allotment_id
  if (openKey !== "" && changes.data !== undefined) {
    const here = kept.key === openKey ? kept.items : []
    const fresh = changedNow.filter(
      (one) => !here.some((had) => sameChange(had, one))
    )
    if (kept.key !== openKey || fresh.length > 0)
      setKept({ key: openKey, items: [...here, ...fresh] })
  }
  const changed = kept.key === openKey ? kept.items : []
  useSeenOnOpen(changedNow, base !== null)
  // MD called the whole picklist off, however it was done. `now_total` sums
  // only the lines MD changed, so a line edited to 0 is a cancel only when
  // nothing is left to pick (21 Oct 2026: moving one piece away read as
  // "MD cancelled this picklist").
  const cancelled = changed.some(
    (one) => one.cancelled || (one.now_total === 0 && livePick === null)
  )
  // Cancelled, the sheet stays on the last picklist it read; otherwise a
  // picklist that left the list closes the sheet as it always did.
  const pick = livePick ?? (cancelled ? base : null)

  // What the picker actually found, by SKU. A line not in here is not picked
  // yet: a fresh picklist starts at nothing (owner, 18 Oct 2026, checklist).
  // Tagged with the picklist it was typed on, so the next one opens clean
  // without an effect to clear it.
  const [typed, setFound_] = useState<{
    key: string
    values: Record<string, number>
  }>({ key: "", values: {} })
  const found = typed.key === openKey ? typed.values : {}
  const setFound = (
    change: (now: Record<string, number>) => Record<string, number>
  ) =>
    // From the latest state, not this render's: All picked marks every line
    // in one loop, and each call must see the ones before it.
    setFound_((now) => ({
      key: openKey,
      values: change(now.key === openKey ? now.values : {}),
    }))
  /// What was marked, as typed: above what is wanted when MD lowered the
  /// line after the picker marked it.
  const pickedOf = (line: PicklistLine) => found[line.sku_code] ?? 0
  /// What can go on: never above what is still wanted.
  const pickedNow = (line: PicklistLine) =>
    Math.min(pickedOf(line), line.outstanding)
  const wanted = pick?.lines.reduce((sum, line) => sum + line.outstanding, 0)
  const got = pick?.lines.reduce((sum, line) => sum + pickedNow(line), 0)
  const shortPieces = (wanted ?? 0) - (got ?? 0)
  /// Pieces the picker marked above what MD now wants, per line: they go
  /// back on the rack before anything is submitted.
  const overs = (pick?.lines ?? [])
    .map((line) => ({
      line,
      over: Math.max(0, pickedOf(line) - line.outstanding),
    }))
    .filter((one) => one.over > 0)
  const overTotal = overs.reduce((sum, one) => sum + one.over, 0)
  /// Everything marked, for "put the N pcs you took back".
  const markedTotal = (pick?.lines ?? []).reduce(
    (sum, line) => sum + pickedOf(line),
    0
  )

  // Why it came back short, tagged with its picklist the same way.
  const [chosen, setChosen] = useState<{
    key: string
    value: ShortReason | null
  }>({ key: "", value: null })
  const why = chosen.key === openKey ? chosen.value : null
  // "Cannot pick the rest" tapped: the reason is asked, and the shortfall is
  // filed. Tagged with its picklist like the reason.
  const [cannotKey, setCannotKey] = useState("")
  const cannot = cannotKey === openKey

  // The report that did not get through, held for a retry. Tagged with its
  // picklist: the sheet stays mounted between openings.
  const [unsent, setUnsent] = useState<ShortPlan | null>(null)
  const plan = unsent !== null && unsent.key === openKey ? unsent : null

  // The picklist's open short pick, if one is already out there: its reason,
  // who said it and when.
  const openReport = reports.newest.get(openKey)

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
            note: one.note ?? null,
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
    // The sheet closes and the toast is the only answer (owner, 18 Oct 2026:
    // no done screen, one toast).
    if (pieces > 0) {
      toast.warning(
        `${quantity(pieces)} short on ${pick?.allotment_number ?? ""}`,
        { description: "MD sees it" }
      )
    } else {
      toast.success(`${quantity(pickedCount.current)} picked`, {
        description: "now in Picked",
      })
    }
    // Back to the list: the picklist's own sheet is not opened on what was
    // just accepted (owner, 10 Oct 2026).
    onClose()
  }

  /// The key of the accept still in flight, and what it was for. Pressing
  /// Submit again on the same picks after a failure sends the same key, so the
  /// server carries on with the round it opened instead of walking a second
  /// one (17 Oct 2026: a round cut off part-way left its lines planned and
  /// the next Submit, under a new key, owed the rack a piece already taken).
  const round = useRef<{ picks: string; key: string } | null>(null)
  /// What the accept in flight put on the Pack lane, for the toast.
  const pickedCount = useRef(0)

  const accept = useMutation({
    mutationFn: async (
      how: boolean | { cannot: Readonly<Record<string, number>>; note: string }
    ) => {
      if (pick === null) throw new Error("Nothing to accept.")
      // MD lowered a line below what was marked: the counts are stale, and
      // sending them would take more off the rack than MD wants.
      if (overTotal > 0 || cancelled)
        throw new Error(
          cancelled
            ? "MD cancelled this picklist."
            : `MD changed this picklist. Put back ${overTotal} first.`
        )
      const later = how === true
      // Cannot pick: what can't be picked, line by line, out of the dialog;
      // the rest of each line is what was picked.
      const cut = typeof how === "object" ? how : null
      const pickedOf = (line: PicklistLine) =>
        cut === null
          ? pickedNow(line)
          : Math.max(0, line.outstanding - (cut.cannot[line.sku_code] ?? 0))
      const lines = pick.lines
        .map((line) => ({ sku_code: line.sku_code, quantity: pickedOf(line) }))
        .filter((line) => line.quantity > 0)
      pickedCount.current = lines.reduce((sum, line) => sum + line.quantity, 0)
      const picks = JSON.stringify([acceptKey(pick), source, lines])
      const held =
        round.current?.picks === picks
          ? round.current
          : { picks, key: idempotencyKey() }
      round.current = held
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
              idempotency_key: held.key,
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
      // Continue later: what was found is saved and nothing is reported; the
      // rest stays on the picklist.
      if (later) {
        const poolLabel = pools.find((one) => one.id === source)?.label
        const notThere = [...refused.values()].reduce((a, b) => a + b, 0)
        if (notThere > 0)
          toast(
            `${quantity(notThere)} not in ${poolLabel ?? "this pool"} · nothing saved for them`
          )
        return {
          sessionId: result?.summary.session.session_id ?? null,
          plan: null,
          sent: true,
          pieces: 0,
          byMd,
          later,
        }
      }
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
        return { sessionId, plan: null, sent: true, pieces: 0, byMd, later }
      const made: ShortPlan = {
        key: acceptKey(pick),
        allotmentId: pick.allotment_id,
        destinationId: pick.destination_id,
        sessionId,
        // A rack that said no without the picker saying why is a question
        // about the stock.
        reason: cut !== null ? "OTHER" : (why ?? "NOT_CONFIRMED"),
        note: cut !== null ? cut.note.trim() || null : null,
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
        later,
      }
    },
    onSuccess: ({ plan: made, sent, pieces, byMd, later }) => {
      // The round is walked: the next accept is a new one.
      round.current = null
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
      setCannotKey("")
      if (later) {
        toast.success(`${quantity(pickedCount.current)} picked`, {
          description: "now in Picked",
        })
        onClose()
        return
      }
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

  // A refusal from the last picklist must not still be sitting under this
  // one — the sheet stays mounted between openings.
  useEffect(() => {
    if (pick !== null) {
      accept.reset()
      retry.reset()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pick === null ? null : acceptKey(pick)])

  const [printing, setPrinting] = useState(false)
  const [paper, setPaper] = useState<Paper>(DEFAULT_PICK_PAPER)
  return (
    <Sheet
      open={pick !== null}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      // The store stands over the title, no allotment number (owner, 21 Oct
      // 2026): "C001 · Cikupa", then "Pick · article".
      context={pick ? shopName(pick.destination_id) : false}
      title={pick ? `Pick · ${pick.article_name ?? pick.article_code}` : "Pick"}
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
        ) : cancelled ? (
          // MD called it off: the one thing left is to put back what was
          // taken, or just to close when nothing was.
          <div className="flex items-center justify-end">
            <Button
              variant="destructive"
              onClick={() => {
                if (markedTotal > 0)
                  toast.warning(`Put back ${quantity(markedTotal)}`, {
                    description: "on the rack",
                  })
                onClose()
              }}
            >
              {markedTotal > 0 ? `Put back ${quantity(markedTotal)}` : "OK"}
            </Button>
          </div>
        ) : (
          // Cannot pick on the left, Print and Submit on the right, as the
          // prototype's foot stands. Two boxes, so the White look's "every
          // verb at the right" (white.css `.sheet-foot`) does not carry the
          // red one over to the others.
          <div className="flex items-center justify-between gap-3">
            <div>
              {/* A red tinted button, only while something is not picked
              (owner, 18 Oct 2026). Pack and Dispatch send pieces back here.
              Every action looks pressable: no plain-text actions. */}
              {shortPieces > 0 && (
                <TintButton
                  tone="bad"
                  disabled={accept.isPending || source === null}
                  onClick={() => setCannotKey(openKey)}
                >
                  Request cannot pick
                </TintButton>
              )}
            </div>
            <div className="flex items-center gap-3">
              <PrintMenu
                label="Print"
                title={
                  pick
                    ? `picklist ${pick.allotment_number} · ${pick.article_code}`
                    : undefined
                }
                defaultPaper={DEFAULT_PICK_PAPER}
                paperKey="picklist"
                onChoose={(choice) => {
                  setPaper(choice.paper)
                  setPrinting(true)
                }}
              />
              <Button
                // White (owner, 21 Oct 2026: "donenya warna putih").
                variant="ghost"
                // Done sends the SKUs marked Picked on to Picked; the rest
                // stay on the picklist (owner, 21 Oct 2026). Nothing marked:
                // Done only closes.
                disabled={
                  (got ?? 0) > 0 &&
                  (!canAccept || source === null || overTotal > 0)
                }
                pending={accept.isPending}
                onClick={() =>
                  (got ?? 0) > 0 ? accept.mutate(shortPieces > 0) : onClose()
                }
              >
                {accept.isPending
                  ? "Submitting…"
                  : overTotal > 0
                    ? `Put back ${quantity(overTotal)} first`
                    : "Done"}
              </Button>
            </div>
          </div>
        )
      }
    >
      {pick && (
        <div className="flex flex-col">
          {cancelled ? (
            <Strip tone="bad">
              <b className="font-semibold">MD cancelled this picklist</b>
              <span>
                {markedTotal > 0
                  ? `Put the ${quantity(markedTotal)} you took back on the rack`
                  : "Nothing was picked"}
              </span>
            </Strip>
          ) : overTotal > 0 ? (
            <Strip
              tone="warn"
              action={
                <TintButton
                  onClick={() =>
                    setFound((now) => {
                      const next = { ...now }
                      for (const { line } of overs)
                        next[line.sku_code] = line.outstanding
                      return next
                    })
                  }
                >
                  Done, put back {count(overTotal)}
                </TintButton>
              }
            >
              <b className="font-semibold">MD changed this picklist</b>
              <span className="tabular-nums">
                {overs
                  .map(
                    ({ line, over }) =>
                      `${variantOf(catalogue.get(line.sku_code)) || skuNumber(line.sku_code)} now ${count(line.outstanding)}, put back ${count(over)}`
                  )
                  .join(" · ")}
              </span>
            </Strip>
          ) : (
            changed.length > 0 && (
              <Strip tone="info">
                <b className="font-semibold">MD changed this picklist</b>
                <span className="tabular-nums">
                  {changed
                    .flatMap((one) => one.lines)
                    .filter((line) => line.was !== line.now)
                    .map((line, index) => (
                      <Fragment key={`${line.sku_code}~${index}`}>
                        {index > 0 && " · "}
                        {variantOf(catalogue.get(line.sku_code)) ||
                          line.sku_code}{" "}
                        <s className="text-body">{count(line.was)}</s> →{" "}
                        {count(line.now)}
                      </Fragment>
                    ))}
                </span>
              </Strip>
            )
          )}
          {(plan !== null || openReport !== undefined) && (
            <Strip tone="warn">
              <b className="font-semibold">Short pick</b>
              <span className="tabular-nums">
                {plan !== null
                  ? shortReasonLabel(plan.reason)
                  : openReport !== undefined &&
                    `${quantity(wanted ?? 0)} · ${openReport.note !== null && openReport.note !== "" ? `“${openReport.note}”` : shortReasonLabel(openReport.reason)} · ${openReport.reported_by} · ${dayTime(openReport.reported_at)}`}
              </span>
            </Strip>
          )}

          {plan !== null ? (
            <div className="flex flex-col gap-4">
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
                          {identity?.article_name ?? skuNumber(row.sku_code)}
                        </div>
                        <div className="text-mute">
                          {variant !== "" && <>{variant} · </>}
                          <span className="font-mono">{skuNumber(row.sku_code)}</span>
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
            </div>
          ) : (
            <>
              <PickLines
                lines={pick.lines}
                pickedOf={pickedOf}
                locked={cancelled}
                onPicked={(sku, next) =>
                  setFound((now) => ({ ...now, [sku]: next }))
                }
              />

              <CannotPickDialog
                open={cannot && plan === null}
                lines={pick.lines}
                pickedOf={pickedNow}
                said={`${pick.allotment_number} · ${pick.article_name ?? pick.article_code} · ${shopName(pick.destination_id)}`}
                pending={accept.isPending}
                problem={accept.error}
                onClose={() => setCannotKey("")}
                onConfirm={(cut) => accept.mutate(cut)}
              />

              <Problem error={accept.error} />
            </>
          )}
        </div>
      )}
      {pick && printing && (
        <PrintPickPapers
          picks={[pick]}
          paper={paper}
          onClose={() => setPrinting(false)}
        />
      )}
    </Sheet>
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
                <EmptyState>Nothing was picked on this picklist.</EmptyState>
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
                {identity?.article_name ?? skuNumber(line.sku_code)}
              </div>
              <div className="text-mute">
                {variant !== "" && <>{variant} · </>}
                <span className="font-mono">{skuNumber(line.sku_code)}</span>
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
