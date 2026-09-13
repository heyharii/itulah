import type { ColumnDef } from "@tanstack/react-table"
import { Filter, PackageSearch, Shirt } from "lucide-react"
import { useMemo } from "react"

import { Button } from "@/kit/button"
import { SearchField } from "@/kit/field"
import { Loaded, PageHead, Toolbar } from "@/kit/page"
import { ScopeLine } from "@/kit/scope"
import { Table } from "@/kit/table"
import { Tag } from "@/kit/tag"
import { Tile, Tiles } from "@/kit/tiles"
import { Empty, Failed, Loading, NoMatch } from "@/kit/state"
import { count } from "@/lib/format"
import { useCursorList, useReport, type Page } from "@/lib/list"
import { useQueryState } from "@/lib/query-state"
import { useDebounced } from "@/lib/use-debounced"
import type { TableSetup } from "@/lib/table"
import { Ident, PoolPicker, Quiet } from "@/modules/inventory/parts"
import type {
  Availability,
  AvailabilityItem,
  FleetPoolList,
} from "@/modules/inventory/wire"

/// Availability — what one pool can still promise, SKU by SKU.
///
/// The equation the server prints in its own answer — `Stock = On Hand +
/// Allotted + Missing` — is the whole screen, and **On hand is the column that
/// can go negative**. Allotting is a promise, and a pool is allowed to find out
/// it has promised more than it holds; a negative row here is the same fact the
/// allotment book calls a shortage.
///
/// ## The one inventory route that pages properly
///
/// Every other read in this module answers a whole object at once. This one
/// keysets on `sku_code`, searches on the server, and counts the matched set
/// with a `COUNT(*) OVER()` — so it gets `useCursorList`, the search box is
/// real, and "50 of 2,740" is a promise the endpoint can keep. The envelope
/// spells its fields `items` and `total_items` rather than `rows` and `total`,
/// which is what `unpack` below is for; see `lib/list.ts`.
///
/// The rows arrive in `sku_code` order and **there is no sort parameter at
/// all** — not a weak one, none. So no header here offers to sort: a header
/// that pointed a different way while the server kept its own order would be
/// the client-side sort over a paged list that `lib/table.ts` exists to
/// prevent.
///
/// ## `total_items` counts SKUs CONSIDERED, not SKUs held
///
/// A shelf holding 110 pieces still reports 2,740 — every active SKU in the
/// catalogue, most of them at nought. That is a useful answer to "could this
/// pool promise it" and a misleading one to "what is on this shelf", so the
/// toolbar says which it is and the Held filter is offered beside it.

const PAGE = 50

/// `{ items, next_cursor, total_items }` read as the envelope the hook wants.
///
/// The whole body is spread through, not just the rows, because everything
/// above the table — the four figures, the pool's own name, the equation — is
/// on it, and the server computed all of them **over the matched set**: search
/// for `SKU-05` and `stock_qty` is that SKU family's stock, not the pool's. A
/// screen that recomputed them from the page would report the first fifty rows
/// as the answer.
///
/// Module scope, so it is one stable function rather than a new one per render.
const unpack = (body: unknown): Page<AvailabilityItem> & Availability => {
  const page = body as Availability
  return { ...page, rows: page.items, total: page.total_items }
}

export function AvailabilityScreen() {
  const url = useQueryState()
  const pool = url.one("pool")
  const typed = url.one("q")
  const q = useDebounced(typed, 200)
  const held = url.one("held") === "1"
  const shortfall = url.one("shortfall") === "1"
  const pickingPool = url.one("panel") === "pool"

  /// The pool list, for the picker only. The same cache entry the Stock screen
  /// fills, so arriving here from a pool row costs no second request.
  const fleet = useReport<FleetPoolList>({
    key: ["inventory", "fleet"],
    path: "/api/v1/inventory/fleet-pools",
  })

  const list = useCursorList<AvailabilityItem>({
    key: ["inventory", "availability"],
    path: "/api/v1/inventory/availability",
    params: {
      // Absent means the server's own default, `dc.warehouse`. Left absent
      // rather than spelled out here so the default lives in one place — and
      // so the answer says which pool it chose, which the strip then prints.
      source_pool_id: pool || null,
      q,
      held: held ? "true" : null,
      shortfall: shortfall ? "true" : null,
    },
    limit: PAGE,
    unpack,
  })

  const head = list.head as (Page<AvailabilityItem> & Availability) | undefined

  /// Pools goods can actually stand in. A rollup is a sum of other pools, not a
  /// place: nothing can be counted in one, allotted out of one or promised from
  /// one, so it never belongs in a picker even though it belongs in a list.
  const places = useMemo(
    () =>
      (fleet.data?.items ?? [])
        .filter((row) => !row.is_rollup)
        .sort((a, b) => a.id.localeCompare(b.id)),
    [fleet.data],
  )

  const columns: ColumnDef<TableSetup, AvailabilityItem>[] = [
    {
      id: "article",
      header: "Article",
      size: 26,
      meta: { icon: <Shirt className="size-[15px]" />, min: 220 },
      cell: ({ row }) => (
        <>
          <span className="text-ink block truncate font-medium">
            {row.original.article_name}
          </span>
          <Ident className="block truncate">{row.original.sku_code}</Ident>
        </>
      ),
    },
    {
      id: "variant",
      header: "Colour · size",
      size: 15,
      meta: { priority: 2, min: 140 },
      /// One cell, because a colourway and a size are one variant and never
      /// two independent facts about the row — and because an article here is
      /// capped at ten colourways forever, so the pair is short enough to read
      /// on one line.
      cell: ({ row }) => {
        const parts = [row.original.colour, row.original.size].filter(Boolean)
        return parts.length === 0 ? (
          <Quiet why="The catalogue holds no colourway or size for this SKU." />
        ) : (
          <span>{parts.join(" · ")}</span>
        )
      },
    },
    {
      id: "division",
      header: "Division",
      size: 12,
      meta: { priority: 1, min: 120 },
      cell: ({ row }) =>
        row.original.division_code === null ? (
          <Quiet />
        ) : (
          <Tag>{row.original.division_code}</Tag>
        ),
    },
    {
      id: "stock",
      header: "Stock",
      size: 11,
      meta: { align: "right", priority: 4, min: 95 },
      cell: ({ row }) => (
        <span className="tabular-nums">{count(row.original.stock_qty)}</span>
      ),
    },
    {
      id: "allotted",
      header: "Allotted",
      size: 11,
      meta: { align: "right", priority: 3, min: 100 },
      cell: ({ row }) =>
        row.original.allotted_qty === 0 ? (
          <Quiet>0</Quiet>
        ) : (
          <span className="text-info-ink tabular-nums">
            {count(row.original.allotted_qty)}
          </span>
        ),
    },
    {
      id: "on_hand",
      header: "On hand",
      size: 12,
      // Never dropped. It is the decision figure and the only one on the row
      // that can be negative.
      meta: { align: "right", min: 105 },
      cell: ({ row }) => {
        const value = row.original.on_hand_qty
        return (
          <span
            className={
              value < 0
                ? "text-bad-ink font-medium tabular-nums"
                : value === 0
                  ? "text-ink-4 tabular-nums"
                  : "text-ink tabular-nums"
            }
            title={
              value < 0
                ? "Promised out of this pool more than once. Allotting is a promise, and this pool has made more of them than it holds pieces."
                : undefined
            }
          >
            {count(value)}
          </span>
        )
      },
    },
    {
      id: "missing",
      header: "Missing",
      size: 11,
      meta: { align: "right", priority: 5, min: 95 },
      cell: ({ row }) =>
        row.original.missing_qty === 0 ? (
          <Quiet>0</Quiet>
        ) : (
          <span className="text-warn-ink tabular-nums">
            {count(row.original.missing_qty)}
          </span>
        ),
    },
  ]

  const narrowed = q !== "" || held || shortfall

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHead
        module="Inventory"
        title="Availability"
        description="What one pool can still promise, SKU by SKU — and where it has already promised more than it holds."
      />

      <ScopeLine
        scope={{ kind: "asAt", date: (head?.as_of ?? "").slice(0, 10) }}
        measure="pieces"
        unit={head ? `${head.source_site_id} · ${head.source_pool_label}` : undefined}
        note={head?.inventory_equation}
      />

      <Tiles>
        {/* Every figure here is the SERVER's, over the whole matched set — see
            `unpack`. Added in the browser they would describe the pages fetched
            so far and grow while somebody scrolls. */}
        <Tile
          label="Stock"
          value={head === undefined ? "—" : count(head.stock_qty)}
          note={narrowed ? "over what matches" : "everything on this shelf"}
        />
        <Tile
          label="Allotted"
          value={head === undefined ? "—" : count(head.allotted_qty)}
          note="promised out and not yet gone"
        />
        <Tile
          label="On hand"
          value={head === undefined ? "—" : count(head.on_hand_qty)}
          tone={head !== undefined && head.on_hand_qty < 0 ? "bad" : undefined}
          note="what is left to promise"
        />
        <Tile
          label="Missing"
          value={head === undefined ? "—" : count(head.missing_qty)}
          tone={head !== undefined && head.missing_qty > 0 ? "warn" : undefined}
          note="moved out of sight, still owned"
        />
        <Tile
          label="SKUs considered"
          value={head === undefined ? "—" : count(head.total_items)}
          note="active catalogue SKUs, most of them at nought here"
        />
      </Tiles>

      <Toolbar
        trailing={
          <Loaded
            loaded={list.rows.length}
            total={list.total}
            pending={list.query.isPending}
            noun="SKUs"
          />
        }
      >
        <Button
          icon={<PackageSearch className="size-4" />}
          onClick={() => url.set({ panel: "pool" }, false)}
        >
          {head?.source_pool_label ?? "Pick a pool"}
        </Button>
        <SearchField
          value={typed}
          onChange={(value) => url.set({ q: value || null })}
          // Says what it searches, because the server searches exactly three
          // columns and no more.
          placeholder="Search a SKU, an article code or a name"
          className="w-[20rem]"
        />
        <Button
          icon={<Filter className="size-4" />}
          className={held ? "border-blue text-ink" : undefined}
          onClick={() => url.set({ held: held ? null : "1" }, false)}
        >
          Held only
        </Button>
        <Button
          className={shortfall ? "border-blue text-ink" : undefined}
          onClick={() => url.set({ shortfall: shortfall ? null : "1" }, false)}
        >
          Over-promised
        </Button>
      </Toolbar>

      {list.query.isError ? (
        <Failed
          what="availability"
          error={list.query.error}
          onRetry={() => void list.query.refetch()}
        />
      ) : list.query.isPending ? (
        <Loading cols={7} />
      ) : list.rows.length === 0 && !narrowed ? (
        <Empty
          what="SKUs"
          detail="The catalogue lists nothing active, so there is nothing this pool could promise."
        />
      ) : list.rows.length === 0 ? (
        <NoMatch
          what="SKUs"
          onClear={() =>
            url.set({ q: null, held: null, shortfall: null }, false)
          }
        />
      ) : (
        <Table
          columns={columns}
          rows={list.rows}
          rowId={(row) => row.sku_id}
          caption="What this pool can promise"
          hasMore={list.hasMore}
          loadingMore={list.loadingMore}
          onNeedMore={list.loadMore}
          foot={{
            article: (
              <>
                <b className="text-ink">{count(list.total)}</b> SKUs match
              </>
            ),
            stock: head === undefined ? null : count(head.stock_qty),
            on_hand:
              head === undefined ? null : (
                <b className="text-ink">{count(head.on_hand_qty)}</b>
              ),
            missing: head === undefined ? null : count(head.missing_qty),
            division: list.loadingMore ? "Loading more…" : "ordered by SKU",
          }}
        />
      )}

      <PoolPicker
        open={pickingPool}
        pools={places}
        chosen={head?.source_pool_id ?? pool}
        onPick={(id) => url.set({ pool: id, panel: null }, false)}
        onClose={() => url.set({ panel: null }, false)}
        subtitle="Every shelf goods can actually stand on. Rollups are left out — nothing can be promised out of a sum."
      />
    </div>
  )
}
