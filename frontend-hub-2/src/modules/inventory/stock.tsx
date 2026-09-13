import { useQuery } from "@tanstack/react-query"
import type { ColumnDef } from "@tanstack/react-table"
import { Boxes, ChevronRight } from "lucide-react"
import { useMemo } from "react"

import { Loaded, PageHead, Toolbar } from "@/kit/page"
import { ScopeLine } from "@/kit/scope"
import { SearchField } from "@/kit/field"
import { Sheet } from "@/kit/sheet"
import { Table } from "@/kit/table"
import { Tag } from "@/kit/tag"
import { Tile, Tiles } from "@/kit/tiles"
import { Empty, Failed, Loading, NoMatch } from "@/kit/state"
import { api } from "@/lib/api"
import { cn } from "@/lib/cn"
import { count } from "@/lib/format"
import { useReport } from "@/lib/list"
import { useQueryState } from "@/lib/query-state"
import { useDebounced } from "@/lib/use-debounced"
import type { TableSetup } from "@/lib/table"
import {
  humanise,
  moment,
  percent,
  since,
  syncTone,
  writePolicyReason,
} from "@/modules/inventory/labels"
import {
  Caveat,
  Fact,
  Facts,
  Ident,
  Line,
  Quiet,
  SubHead,
} from "@/modules/inventory/parts"
import type {
  CountBoard,
  FleetPool,
  FleetPoolList,
  PoolDetail,
} from "@/modules/inventory/wire"

/// Stock — what the business holds, and every shelf it is standing on.
///
/// ## Why this is one screen and not two
///
/// `frontend-hub` had `/inventory` and `/inventory/pools`, and the second one's
/// whole body was the first one's: the same `<PoolsBody />` under a second page
/// header. Two rows in a menu for one table is a menu that lies about how much
/// there is. The table is here, the figures that summarise it are above it, and
/// a link that used to open the pools page opens this one with `?pool=`.
///
/// ## The fleet read is unbounded, and that is what licenses this page
///
/// `GET /inventory/fleet-pools` takes no parameters, applies no cap and returns
/// **every** row in one answer — 160 of them here. So this is `useReport` and
/// not a list hook: there are no pages, no cursor and nothing to be cut off.
/// It is also why the search box below may narrow in the browser without
/// breaking the house rule — it is narrowing the whole answer, not the part of
/// it that happened to be downloaded.
///
/// ## The three things this module is not allowed to pretend about
///
/// **There is no money on this page, because there is no money on the wire.**
/// Not one inventory route carries a cost, a price or a currency; the ledger
/// holds pieces. The scope strip says `pieces` where a finance screen says IDR,
/// so nobody reads a warehouse total as a valuation.
///
/// **Almost nothing has ever been counted.** The Last count column is drawn
/// from the count board, and on this database it answers for a handful of pools
/// out of a hundred and twelve. That is a fact about the business and it is on
/// the face of the table rather than in a footnote.
///
/// **The centre and the DC spell the same shelf differently.** See `fold`.
export function StockScreen() {
  const url = useQueryState()
  const typed = url.one("q")
  const q = useDebounced(typed, 200).trim().toLowerCase()
  const openId = url.one("pool")
  const expanded = url.many("expand")

  const fleet = useReport<FleetPoolList>({
    key: ["inventory", "fleet"],
    path: "/api/v1/inventory/fleet-pools",
  })

  /// The count board, for one column of this table.
  ///
  /// The fleet read carries balances and no history, so when a pool was last
  /// counted is only knowable from here. Its failure costs the column and
  /// nothing else — which is why it is a separate query rather than a second
  /// `await` inside the first: a board that will not load leaves the column
  /// saying it has no answer, and losing the whole table over it would be the
  /// worse trade.
  const board = useReport<CountBoard>({
    key: ["inventory", "counts"],
    path: "/api/v1/inventory/counts",
  })

  const lastCounts = useMemo(() => newestPerPool(board.data), [board.data])
  const tree = useMemo(
    () => fold(fleet.data?.items ?? [], lastCounts),
    [fleet.data, lastCounts],
  )

  /// The tree narrowed, then flattened to what is actually drawn.
  ///
  /// Flattened HERE rather than by the table, because `lib/table.ts` registers
  /// `rowExpandingFeature` for state but `kit/table.tsx` wires neither
  /// `getSubRows` nor an expanded state — and teaching it to would be a change
  /// to a file three migrations are editing this week. A site's rows are
  /// appended when its id is in `?expand`, so which sites are open survives a
  /// reload and can be sent to somebody, which component state could not do.
  const rows = useMemo(() => {
    const open = new Set(expanded)
    const out: PoolRow[] = []
    for (const site of tree) {
      const children = q === "" ? site.children : site.children.filter(matches)
      // A site whose name matches keeps all its shelves; otherwise it appears
      // only if one of them matched. A search that returned a site row with
      // nothing under it would be a match nobody can see.
      const hit = q === "" || matches(site) || children.length > 0
      if (!hit) continue
      out.push(site)
      if (open.has(site.key) || (q !== "" && children.length > 0)) {
        out.push(...(matches(site) && q !== "" ? site.children : children))
      }
    }
    return out

    function matches(row: PoolRow): boolean {
      return (
        row.label.toLowerCase().includes(q) ||
        row.poolId.toLowerCase().includes(q)
      )
    }
  }, [tree, q, expanded])

  const toggle = (key: string) => {
    const open = new Set(expanded)
    if (open.has(key)) open.delete(key)
    else open.add(key)
    url.set({ expand: [...open] }, false)
  }

  const head = fleet.data
  const sums = useMemo(() => addUp(tree, head), [tree, head])

  const columns: ColumnDef<TableSetup, PoolRow>[] = [
    {
      id: "pool",
      header: "Pool",
      size: 30,
      // No priority: a list that hides which shelf a figure belongs to has
      // stopped being the list somebody asked for.
      meta: { icon: <Boxes className="size-[15px]" />, min: 260 },
      cell: ({ row }) => <PoolCell row={row.original} onToggle={toggle} />,
    },
    {
      id: "stock",
      header: "Stock",
      size: 11,
      // Never dropped either. This is the figure the screen exists for.
      meta: { align: "right", min: 100 },
      cell: ({ row }) => (
        <span className="text-ink font-medium tabular-nums">
          {count(row.original.stock)}
        </span>
      ),
    },
    {
      id: "on_hand",
      header: "On hand",
      size: 11,
      meta: { align: "right", priority: 4, min: 100 },
      cell: ({ row }) => (
        <span className="tabular-nums">{count(row.original.on_hand)}</span>
      ),
    },
    {
      id: "allotted",
      header: "Allotted",
      size: 11,
      meta: { align: "right", priority: 1, min: 100 },
      /// Null is not nought. A shelf an Edge node owns reports fact positions
      /// and no allotments at all — the instructions live at the centre — so a
      /// nought here would claim nothing is promised out of a shelf that has
      /// never been asked.
      cell: ({ row }) =>
        row.original.allotted === null ? (
          <Quiet why="No source for this shelf models allotments. The centre holds the instructions; a node holds fact positions." />
        ) : (
          <span className="tabular-nums">{count(row.original.allotted)}</span>
        ),
    },
    {
      id: "observed",
      header: "Observed",
      size: 11,
      meta: { align: "right", priority: 2, min: 105 },
      /// Distinct tags a reader saw in the window — evidence about the number
      /// rather than part of it, which is why it sits outside the equation
      /// beside Last count.
      cell: ({ row }) =>
        row.original.observed === null ? (
          <Quiet why="Cloud holds this node's fact positions, not the readings behind them. There is no sighting to report, rather than a sighting of nought." />
        ) : (
          <span className="text-ink-3 tabular-nums">
            {count(row.original.observed)}
          </span>
        ),
    },
    {
      id: "missing",
      header: "Missing",
      size: 10,
      // Never dropped: it is the only column on the row that is somebody's
      // problem today.
      meta: { align: "right", min: 95 },
      cell: ({ row }) =>
        row.original.missing === 0 ? (
          <Quiet>0</Quiet>
        ) : (
          <span className="text-bad-ink font-medium tabular-nums">
            {count(row.original.missing)}
          </span>
        ),
    },
    {
      id: "source",
      header: "Speaks for it",
      size: 15,
      meta: { priority: 5, min: 150 },
      /// The column that is not obvious, and the reason the fleet read exists.
      ///
      /// The centre keeps a native ledger AND projects each node's fact
      /// positions, and where a site is owned by a live node the centre's row
      /// for it is shadowed: still shown, deliberately left out of the fleet
      /// total, and not writable. Reading the two together without that
      /// distinction is exactly how a fleet counts a store twice.
      cell: ({ row }) => {
        const lead = row.original.pool
        if (lead === null) {
          return (
            <span className="text-ink-4">
              {count(row.original.sources.length)} rows folded
            </span>
          )
        }
        return (
          <span
            className="flex min-w-0 items-center gap-1.5"
            title={writePolicyReason(lead.authority.write_policy)}
          >
            <span className="text-ink-3 min-w-0 truncate">
              {lead.owner_label ?? lead.origin_id}
            </span>
            {lead.sync_status !== "LOCAL" && (
              <Tag tone={syncTone(lead.sync_status)} className="shrink-0">
                {lead.sync_status.toLowerCase()}
              </Tag>
            )}
          </span>
        )
      },
    },
    {
      id: "last_count",
      header: "Last count",
      size: 16,
      meta: { priority: 3, min: 140 },
      /// Three answers, and the third is the one that matters. A pool with a
      /// date has been stood in front of; a pool with "Never" has not; and a
      /// pool whose column could not be read is neither, which is what the
      /// board failing looks like.
      cell: ({ row }) => {
        if (board.isError) {
          return <Quiet why="The count board did not load, so this column has no answer for any row." />
        }
        const at = row.original.last_count
        if (at === null) {
          return (
            <Quiet why="No count on the board names this pool. The board is capped at 200 rows per column and no parameter moves it, so a very old count may be off the end of it.">
              Never
            </Quiet>
          )
        }
        return <span className="text-ink-2">{since(at)} ago</span>
      },
    },
  ]

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHead
        module="Inventory"
        title="Stock"
        description="What the business holds, and every shelf it is standing on — the centre's own ledger and every node that reports to it."
      />

      {/* A position, not a period: these are balances at an instant, and
          summing two of them would be summing the same pieces twice. */}
      <ScopeLine
        scope={{ kind: "asAt", date: (head?.as_of ?? "").slice(0, 10) }}
        measure="pieces"
        note={
          head === undefined ? undefined : (
            <>
              sightings over {head.observed_window_hours}h · loss over{" "}
              {head.lost_risk_window_days} days · no route prices any of it
            </>
          )
        }
      />

      <Tiles>
        <FleetTile head={head} />
        <Tile
          label="On hand"
          value={sums === null ? "—" : count(sums.on_hand)}
          note={
            sums === null
              ? "the fold could not be checked"
              : `added over the ${count(sums.rows)} rows the server counts`
          }
        />
        <Tile
          label="Allotted"
          value={sums === null ? "—" : count(sums.allotted)}
          note={
            sums === null
              ? "the fold could not be checked"
              : `only ${count(sums.allottedRows)} of ${count(sums.rows)} rows report one`
          }
        />
        <Tile
          label="Missing"
          value={sums === null ? "—" : count(sums.missing)}
          tone={sums !== null && sums.missing > 0 ? "warn" : undefined}
          note="stock the ledger has moved out of sight"
        />
        <CountedTile tree={tree} failed={board.isError} />
      </Tiles>

      <Toolbar
        trailing={
          <Loaded
            loaded={rows.length}
            total={tree.reduce((n, site) => n + 1 + site.children.length, 0)}
            pending={fleet.isPending}
            noun="rows"
          />
        }
      >
        <SearchField
          value={typed}
          onChange={(value) => url.set({ q: value || null })}
          placeholder="Search a site or a pool"
          className="w-[20rem]"
        />
        <span className="text-ctl text-ink-4">
          Ordered as the server returns it — site, then the shelf order the pool
          model declares.
        </span>
      </Toolbar>

      {fleet.isError ? (
        <Failed
          what="the fleet"
          error={fleet.error}
          onRetry={() => void fleet.refetch()}
        />
      ) : fleet.isPending ? (
        <Loading cols={7} />
      ) : tree.length === 0 ? (
        <Empty
          what="pools"
          detail="This node has no active operational pool, on its own ledger or on any node reporting to it."
        />
      ) : rows.length === 0 ? (
        <NoMatch
          what="pools"
          held={tree.reduce((n, site) => n + site.children.length, 0)}
          onClear={() => url.set({ q: null }, false)}
        />
      ) : (
        <Table
          columns={columns}
          rows={rows}
          rowId={(row) => row.key}
          caption="Every pool the centre can see"
          onRowClick={(row) =>
            row.pool === null ? toggle(row.key) : url.set({ pool: row.poolId }, false)
          }
          isOpen={(row) => row.pool !== null && row.poolId === openId}
          foot={{
            pool: (
              <>
                <b className="text-ink">{count(tree.length)}</b> sites ·{" "}
                {count(tree.reduce((n, s) => n + s.children.length, 0))} pools
              </>
            ),
            stock:
              sums === null ? (
                <Quiet why="This browser's fold does not reproduce the server's own total, so nothing here may be added up." />
              ) : (
                <b className="text-ink">{count(sums.stock)}</b>
              ),
            missing: sums === null ? null : count(sums.missing),
            last_count: "over the rows the server counts",
          }}
        />
      )}

      <PoolSheet openId={openId} onClose={() => url.set({ pool: null }, false)} />
    </div>
  )
}

/// The fleet total, and the reason it is not certified.
///
/// `fleet_total` is **null on this database and on every database with a node
/// that has not reported**, and the old app quietly substituted the server's
/// own arithmetic for it without saying so. Both halves of that were wrong: the
/// figure is real — the server did the sum — and the refusal is real too, and a
/// reader who is not told cannot know that thirteen shops are missing from it.
///
/// So the number drawn is `calculated_total`, which is a figure the server
/// answered, and the note says in one clause that it is not certified and how
/// many origins are behind that. The reasons themselves are named one per line
/// on Ledger control, which is where somebody who wants them is going.
function FleetTile({ head }: { head: FleetPoolList | undefined }) {
  if (head === undefined) {
    return <Tile label="Stock" value="—" note="reading every node" />
  }
  const certified = head.fleet_total !== null
  const diagnostics = head.fleet_total_diagnostics
  const silent =
    diagnostics.unreported_edge_origins.length +
    diagnostics.stale_edge_origins.length
  return (
    <Tile
      label="Stock"
      value={count(head.fleet_total ?? diagnostics.calculated_total)}
      tone={certified ? undefined : "warn"}
      note={
        certified ? (
          "certified by the server"
        ) : (
          <span
            title={diagnostics.certification_reasons.map(humanise).join(" · ")}
          >
            the server&rsquo;s own sum, which it will not certify —{" "}
            {count(silent)} nodes silent or stale
          </span>
        )
      }
    />
  )
}

/// How much of the estate anybody has actually stood in front of.
///
/// The figure this module is least comfortable drawing and the one most worth
/// drawing. Every other number here is the ledger's opinion of itself; this is
/// the only one that says how much of that opinion has ever been checked
/// against a shelf.
function CountedTile({
  tree,
  failed,
}: {
  tree: readonly PoolRow[]
  failed: boolean
}) {
  if (failed) {
    return (
      <Tile
        label="Ever counted"
        value="—"
        note="the count board did not load"
      />
    )
  }
  const shelves = tree.flatMap((site) => site.children)
  const seen = shelves.filter((row) => row.last_count !== null).length
  return (
    <Tile
      label="Ever counted"
      value={`${count(seen)} / ${count(shelves.length)}`}
      tone={seen * 4 < shelves.length ? "warn" : undefined}
      note="pools with a count on the board, which holds 200 per column"
    />
  )
}

/// One line of the table: a site, or a shelf standing in it.
///
/// A type of its own rather than `FleetPool`, because a site is not a pool and
/// pretending otherwise would mean inventing an id, a group and a sync status
/// for something that has none.
interface PoolRow {
  readonly key: string
  readonly depth: number
  readonly label: string
  /// The pool id **in the centre's spelling** — see `fold`. On a site row, the
  /// site id.
  readonly poolId: string
  /// The source that speaks for this shelf, or null on a site row.
  readonly pool: FleetPool | null
  /// Every row the fleet read returned for this shelf, one per source.
  readonly sources: readonly FleetPool[]
  readonly stock: number
  readonly on_hand: number
  readonly allotted: number | null
  readonly observed: number | null
  readonly missing: number
  readonly last_count: string | null
  /// Whether the fleet total includes this row.
  readonly counted: boolean
  /// Set when a second source for the same shelf reports a different quantity.
  readonly disputed: { readonly source: string; readonly stock: number } | null
  readonly children: readonly PoolRow[]
}

function PoolCell({
  row,
  onToggle,
}: {
  row: PoolRow
  onToggle: (key: string) => void
}) {
  const site = row.pool === null
  return (
    <div
      className="flex min-w-0 items-center gap-1.5"
      style={{ paddingLeft: `${row.depth * 1.125}rem` }}
    >
      {site ? (
        // A real button even though the whole row toggles too: the row is a
        // click target and this is the keyboard's way in.
        <button
          type="button"
          aria-label={`Expand ${row.label}`}
          onClick={(event) => {
            event.stopPropagation()
            onToggle(row.key)
          }}
          className="rounded-tag text-ink-4 hover:text-ink grid size-4 shrink-0 place-items-center transition-colors"
        >
          <ChevronRight className="size-3.5" />
        </button>
      ) : (
        <span className="w-4 shrink-0" />
      )}
      <span className="min-w-0">
        <span
          className={cn(
            "block truncate",
            site
              ? "text-ink font-medium"
              : row.counted
                ? "text-ink-2"
                : "text-ink-4",
          )}
        >
          {row.label}
        </span>
        {!site && <Ident className="block truncate">{row.poolId}</Ident>}
      </span>
      {/* Two markers, and they say different things. A rollup is a sum of the
          rows beneath it — real stock, deliberately not added again, so the
          fleet is not doubled. A dispute is two sources that do not agree
          about one shelf, which no fold may resolve silently. Neither is
          "nobody has counted this", which Last count says on its own. */}
      {!site && !row.counted && (
        <Tag tone="neutral" className="shrink-0">
          rollup
        </Tag>
      )}
      {row.disputed !== null && (
        <Tag
          tone="warn"
          className="shrink-0"
          // The rival's own number, so the marker is a finding rather than an
          // adjective.
        >
          {row.disputed.source} says {count(row.disputed.stock)}
        </Tag>
      )}
    </div>
  )
}

/// The newest count per pool, from the board the server hands over already
/// partitioned.
///
/// Whichever moment the count actually reached — closed, submitted, activated,
/// or merely created — is the one that counts as "last": a count still open is
/// not a pool nobody has been to.
function newestPerPool(board: CountBoard | undefined): Map<string, string> {
  const newest = new Map<string, string>()
  if (board === undefined) return newest
  for (const record of [
    ...board.drafts,
    ...board.active,
    ...board.needs_review,
    ...board.history,
  ]) {
    const when =
      record.closed_at ??
      record.submitted_at ??
      record.activated_at ??
      record.created_at
    const held = newest.get(record.pool_id)
    if (held === undefined || Date.parse(when) > Date.parse(held)) {
      newest.set(record.pool_id, when)
    }
  }
  return newest
}

/// The fleet read, folded into a site-and-shelf tree.
///
/// ## One shelf, one row
///
/// The read returns a row per **source**, not per shelf: the centre keeps a
/// native ledger and also projects each node's fact positions, so a warehouse a
/// node owns arrives twice — once from each. The server marks exactly one of
/// the pair `included_in_fleet_total`; drawing both is how a fleet counts a
/// store twice, and drawing only one throws away the reading the winner cannot
/// have. So the pair is folded: the counted row supplies the numbers, its
/// shadowed twin supplies only what the winner has no way to know, and where
/// the two genuinely disagree the row carries the disagreement instead of the
/// fold resolving it out of sight.
///
/// ## Two names for one distribution centre
///
/// The centre's pool model spells the DC literally — `dc.warehouse` — while a
/// node parameterises the same grammar by the site it runs as, so the same
/// shelf is `dc-01.warehouse` there. Grouping on `site_id` alone files them
/// under two headings and folds neither, which is exactly the bug the fleet
/// read exists to close.
///
/// **The respelling is recovered from the data rather than hardcoded.** A Cloud
/// row naming an origin in `authority.shadowed_by_origin_id` is telling us
/// which site that origin is standing in, and that is the whole of the mapping.
/// A hardcoded `dc-01 → dc` would be right today and wrong the first time a
/// second DC is stood up.
function fold(
  items: readonly FleetPool[],
  lastCounts: ReadonlyMap<string, string>,
): PoolRow[] {
  /// `dc-01-edge` → `dc`: the site the centre files this origin's rows under.
  /// Empty for every store, where the two spellings already agree.
  const siteOfOrigin = new Map<string, string>()
  for (const item of items) {
    const shadowing = item.authority.shadowed_by_origin_id
    if (shadowing !== null) siteOfOrigin.set(shadowing, item.site_id)
  }
  const siteOf = (item: FleetPool) =>
    siteOfOrigin.get(item.origin_id) ?? item.site_id

  /// The pool id in the centre's spelling. The first segment IS the site — a
  /// site id admits only lowercase letters, digits and `-`, never the dot.
  const poolOf = (item: FleetPool) => {
    if (!item.id.includes(".")) return item.id
    return `${siteOf(item)}.${item.id.slice(item.id.indexOf(".") + 1)}`
  }

  const bySite = new Map<string, FleetPool[]>()
  for (const item of items) {
    const site = siteOf(item)
    const held = bySite.get(site)
    if (held) held.push(item)
    else bySite.set(site, [item])
  }

  return [...bySite.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([siteId, pools]) => {
      const byPool = new Map<string, FleetPool[]>()
      for (const item of pools) {
        const key = poolOf(item)
        const held = byPool.get(key)
        if (held) held.push(item)
        else byPool.set(key, [item])
      }

      const children = [...byPool.entries()]
        .map(([poolId, sources]) => shelf(poolId, sources, lastCounts))
        .sort(
          (a, b) =>
            (a.pool?.display_order ?? 0) - (b.pool?.display_order ?? 0) ||
            a.key.localeCompare(b.key),
        )

      const counted = children.filter((child) => child.counted)
      const sum = (pick: (row: PoolRow) => number) =>
        counted.reduce((total, row) => total + pick(row), 0)
      /// The same fold over a column that is allowed to be absent. A site where
      /// nothing can be allotted or nothing can be sighted reports **no
      /// reading**, not a reading of nought — a nought is a claim.
      const known = (pick: (row: PoolRow) => number | null) => {
        const readable = counted.filter((row) => pick(row) !== null)
        if (readable.length === 0) return null
        return readable.reduce((total, row) => total + (pick(row) ?? 0), 0)
      }
      /// The site was last counted when the most recently counted pool in it
      /// was — including the pools its total leaves out, because somebody did
      /// stand there and count them.
      const latest = children.reduce<string | null>(
        (newest, row) =>
          row.last_count !== null &&
          (newest === null || Date.parse(row.last_count) > Date.parse(newest))
            ? row.last_count
            : newest,
        null,
      )

      return {
        key: `site/${siteId}`,
        depth: 0,
        poolId: siteId,
        /// The site's own name, not the node's. `site_name` is the master
        /// record for the place ("DC"); an origin's label names the box
        /// standing in it ("DC Jakarta"), and the two are folded under one
        /// heading now, so the place is what the heading says.
        label:
          pools.find((item) => item.source_type === "CLOUD_LEDGER")
            ?.site_name ??
          pools[0].site_name ??
          siteId,
        pool: null,
        sources: pools,
        stock: sum((row) => row.stock),
        on_hand: sum((row) => row.on_hand),
        allotted: known((row) => row.allotted),
        observed: known((row) => row.observed),
        missing: sum((row) => row.missing),
        last_count: latest,
        counted: true,
        disputed: null,
        children,
      }
    })
}

function shelf(
  poolId: string,
  sources: readonly FleetPool[],
  lastCounts: ReadonlyMap<string, string>,
): PoolRow {
  /// The server has already decided which source speaks for this shelf. Where
  /// it counts neither — an outbound rollup, a shelf whose owner has gone
  /// quiet — the Cloud row is the fallback, because it is the one that still
  /// holds a number.
  const lead =
    sources.find((item) => item.authority.included_in_fleet_total) ??
    sources.find((item) => item.source_type === "CLOUD_LEDGER") ??
    sources[0]

  /// A reading the winner **cannot** have rather than does not have. Cloud
  /// holds each node's fact positions but not the sightings behind them, so an
  /// Edge row's `observed` is null by construction — taking the Cloud twin's is
  /// recovering the column, not overriding an answer.
  const borrow = (pick: (item: FleetPool) => number | null) =>
    pick(lead) ?? sources.map(pick).find((value) => value !== null) ?? null

  /// Two sources for one shelf that do not agree on how much is on it.
  ///
  /// Only a source that has actually spoken can disagree. A node that has never
  /// reported reads nought for every pool it models, and calling that a dispute
  /// would put the marker on every shelf of every shop whose box is not plugged
  /// in yet. Rollups are excluded for a different reason: the two sides derive
  /// them over different leaves, so their numbers are not the same question.
  const rival = sources.find(
    (item) =>
      item !== lead &&
      item.stock !== lead.stock &&
      !item.authority.derived &&
      item.sync_status !== "WAITING",
  )

  return {
    key: poolId,
    depth: 1,
    poolId,
    label: lead.label,
    pool: lead,
    sources,
    stock: lead.stock,
    on_hand: lead.on_hand,
    allotted: borrow((item) => item.allotted),
    observed: borrow((item) => item.observed),
    missing: lead.missing,
    last_count: lastCounts.get(poolId) ?? null,
    counted: lead.authority.included_in_fleet_total,
    disputed:
      rival === undefined
        ? null
        : { source: rival.owner_label ?? rival.origin_id, stock: rival.stock },
    children: [],
  }
}

/// The three components of the equation, added over the rows the server counts
/// — **and only if this browser's arithmetic reproduces the server's own.**
///
/// The fleet read answers a stock total (`calculated_total`) and no component
/// totals, so On hand, Allotted and Missing have to be folded here. That is the
/// shape of figure this app refuses to draw on trust. What makes it drawable is
/// that the same fold, run over the same rows, must land on the number the
/// server already published: if it does, the method is proven against the
/// server's on this very answer; if it does not, the rule for which rows count
/// has changed underneath us and **nothing here may be added up at all**.
///
/// So this returns `null` on disagreement, and every tile and the summary line
/// draw an em dash and say why.
function addUp(
  tree: readonly PoolRow[],
  head: FleetPoolList | undefined,
): {
  stock: number
  on_hand: number
  allotted: number
  missing: number
  rows: number
  allottedRows: number
} | null {
  if (head === undefined) return null
  const shelves = tree.flatMap((site) => site.children).filter((row) => row.counted)
  const stock = shelves.reduce((total, row) => total + row.stock, 0)
  if (stock !== head.fleet_total_diagnostics.calculated_total) return null
  const allotted = shelves.filter((row) => row.allotted !== null)
  return {
    stock,
    on_hand: shelves.reduce((total, row) => total + row.on_hand, 0),
    allotted: allotted.reduce((total, row) => total + (row.allotted ?? 0), 0),
    missing: shelves.reduce((total, row) => total + row.missing, 0),
    rows: shelves.length,
    allottedRows: allotted.length,
  }
}

/// One shelf, whole: what is on it, what it has lost, and who speaks for it.
///
/// Read from `GET /inventory/pools/{id}` rather than from the row behind it,
/// because the record carries what the fleet read deliberately does not — the
/// pieces themselves, the movements through it, the sightings in it and the
/// counts of it. A URL naming a pool the table is not holding opens it all the
/// same, which is the promise the id in the address bar makes.
///
/// **Every list in here is capped in the SQL and none of the caps is settable**
/// — items 200, missing 200, sightings 100, movements 100, counts 20 — and
/// there is no total and no cursor to ask for the rest with. So each heading
/// carries its cap rather than letting a hundred rows read as all of them.
function PoolSheet({
  openId,
  onClose,
}: {
  openId: string
  onClose: () => void
}) {
  const detail = useQuery({
    queryKey: ["inventory", "pool", openId] as const,
    enabled: openId !== "",
    queryFn: ({ signal }) =>
      api.get<PoolDetail>(
        `/api/v1/inventory/pools/${encodeURIComponent(openId)}`,
        signal,
      ),
  })

  const pool = detail.data?.summary

  return (
    <Sheet
      open={openId !== ""}
      onClose={onClose}
      width="record"
      title={pool?.label ?? openId}
      subtitle={
        pool
          ? `${pool.site_name ?? pool.site_id} · ${humanise(pool.group)}`
          : "Reading the shelf…"
      }
    >
      {detail.isError ? (
        <Failed
          what="this pool"
          error={detail.error}
          onRetry={() => void detail.refetch()}
        />
      ) : detail.data === undefined ? (
        <Loading rows={5} cols={2} />
      ) : (
        <>
          <Facts>
            <Fact label="Pool">
              <Ident className="text-cell">{detail.data.summary.id}</Ident>
            </Fact>
            <Fact label="Stock">
              <span className="tabular-nums">
                {count(detail.data.summary.stock)}
              </span>
            </Fact>
            <Fact label="On hand">
              <span className="tabular-nums">
                {count(detail.data.summary.on_hand)}
              </span>
            </Fact>
            <Fact label="Missing">
              <span className="tabular-nums">
                {count(detail.data.summary.missing)}
              </span>
            </Fact>
            <Fact label="Loss rate">
              {detail.data.summary.lost_rate === null ? (
                <Quiet why="This shelf models no loss. Not a rate of nought — a rate that is not computed for it." />
              ) : (
                percent(detail.data.summary.lost_rate)
              )}
            </Fact>
            <Fact label="Valuation">
              {/* The one field this sheet will never have. Drawn rather than
                  omitted, because an inventory record with no money on it
                  reads as an oversight until somebody says it is not. */}
              <Quiet why="No inventory route carries a cost, a price or a currency. The ledger holds pieces; nothing prices them.">
                not held anywhere
              </Quiet>
            </Fact>
          </Facts>

          <SubHead note={`${detail.data.items.length} shown, cap 200`}>
            What is standing on it
          </SubHead>
          {detail.data.items.length === 0 ? (
            <Line>
              <Quiet>Nothing is on this shelf.</Quiet>
            </Line>
          ) : (
            detail.data.items.slice(0, 40).map((item) => (
              <Line key={`${item.subject_id}-${item.epc ?? ""}`} note={item.article_name}>
                <Ident className="text-cell min-w-0 flex-1 truncate">
                  {item.epc ?? item.barcode ?? item.subject_id}
                </Ident>
                <span className="text-ink-3 shrink-0">
                  {item.sku_code ?? item.subject_type}
                </span>
              </Line>
            ))
          )}

          <SubHead note={`${detail.data.movements.length} shown, cap 100`}>
            What has moved through it
          </SubHead>
          {detail.data.movements.length === 0 ? (
            <Line>
              <Quiet>Nothing has been posted against this shelf.</Quiet>
            </Line>
          ) : (
            detail.data.movements.slice(0, 20).map((movement) => (
              <Line
                key={movement.movement_id}
                note={`${moment(movement.occurred_at)} · ${movement.actor_id}`}
              >
                <span className="min-w-0 flex-1 truncate">
                  {humanise(movement.cause)}
                </span>
                <Ident className="shrink-0">
                  {movement.epc ?? movement.sku_code ?? "—"}
                </Ident>
              </Line>
            ))
          )}

          <SubHead note={`${detail.data.counts.length} shown, cap 20`}>
            Counts of it
          </SubHead>
          {detail.data.counts.length === 0 ? (
            <Line>
              <Quiet>
                Nobody has ever counted this shelf. Every figure above is the
                ledger&rsquo;s account of itself, unchecked.
              </Quiet>
            </Line>
          ) : (
            detail.data.counts.map((record) => (
              <Line
                key={record.id}
                note={`${record.reason} · ${moment(record.closed_at ?? record.submitted_at ?? record.created_at)}`}
              >
                <span className="min-w-0 flex-1 truncate">{record.kind}</span>
                <span className="text-ink-3 shrink-0">{record.status}</span>
              </Line>
            ))
          )}

          <Caveat>
            Where a node owns this shelf the centre reads it and may not post to
            it. {pool && <SourceNote id={detail.data.summary.id} />}
          </Caveat>
        </>
      )}
    </Sheet>
  )
}

/// Which of the two spellings this sheet was opened with.
///
/// Worth saying on the record rather than only in the code: the pool detail
/// route is keyed by the CENTRE's id, and asking it for a node's spelling of
/// the same shelf answers "not found: active placement source pool" — which is
/// the bug the fold above exists to avoid and the one a reader pasting an id
/// from a log will hit first.
function SourceNote({ id }: { id: string }) {
  return (
    <>
      Read as <Ident>{id}</Ident>, which is the centre&rsquo;s spelling; a
      node&rsquo;s own spelling of the same shelf is not a key this route knows.
    </>
  )
}

// ── what did not come across, and why ──────────────────────────────────────
//
// **The placement correction form** that lived on this sheet in
// `frontend-hub`. It is a WRITE — `POST /inventory/movements/correct` — and
// there is not a single mutation in this app yet: no `useMutation`, no
// optimistic update, no idempotency-key discipline, and no settled shape for
// what a refusal looks like on a screen. Inventing that shape in the corner of
// a sheet, inside a migration, is how an app ends up with two of them. The
// reads are here; the writes come as a piece.
//
// **The allotments panel** behind the Allotted figure. Allotments are not a
// reading of stock, they are an instruction to move some — they left this
// module in `frontend-hub` already, and the work they create is Picking. They
// belong wherever Procurement and Operations land in this app, not here.
//
// **The sightings panel** behind the Observed figure. It is the same list as
// the Sightings screen narrowed to one pool, and that screen takes `pool_id`
// on the server. A second way in is a second thing to keep in step.
