import type { ColumnDef } from "@tanstack/react-table"
import { ArrowLeftRight, Boxes, Clock } from "lucide-react"
import { useMemo } from "react"

import { Button } from "@/kit/button"
import { PageHead, Toolbar } from "@/kit/page"
import { ScopeLine } from "@/kit/scope"
import { Table } from "@/kit/table"
import { Tag } from "@/kit/tag"
import { Truncated } from "@/kit/notice"
import { Empty, Failed, Loading } from "@/kit/state"
import { count } from "@/lib/format"
import { useBoundedList, useReport } from "@/lib/list"
import { useQueryState } from "@/lib/query-state"
import type { TableSetup } from "@/lib/table"
import { humanise, moment } from "@/modules/inventory/labels"
import { Ident, Place, PoolPicker, Quiet } from "@/modules/inventory/parts"
import type {
  FleetPoolList,
  Movement,
  MovementList,
} from "@/modules/inventory/wire"

/// Movements — every posting that moved a piece, in the order it happened.
///
/// ## What a movement is
///
/// Double-entry, and both halves are on the row. `from` and `to` are *places* —
/// `<pool>:on_hand`, `<pool>:missing`, `system/lost`, `external/disposal` — so
/// a piece going missing is not a deletion, it is a move to the missing place
/// of the same pool, and losing it for good is a second move out to
/// `system/lost`. That is why the route is one column and not two: reading
/// "where did it go" as a pair of independent columns is what makes a ledger
/// look like a list of edits.
///
/// **Cause is the load-bearing column.** Most causes are workflow-owned — a
/// SALE posts from a till, a correction from a person — and only `NORMAL_MOVE`
/// and `RETURN_TO_DC` may be posted by hand. A movement claiming SALE that
/// nobody sold is the failure the server refuses at its boundary, and reading
/// the cause is how anybody would notice one that got through.
///
/// ## The endpoint takes a pool and nothing else, and the screen says so
///
/// `GET /inventory/movements` accepts `pool_id`, `subject_id` and `limit`,
/// clamps the limit at 500, and answers a bare `{ items }` — **no cursor, no
/// total, no search, no date range, no cause filter, no sort**. So this is
/// `useBoundedList`, and `<Truncated>` is on the page the moment 500 rows come
/// back, because at that point the honest reading is "there may be more and
/// this endpoint cannot say".
///
/// There is deliberately **no search box**. One here would narrow the five
/// hundred rows that happened to arrive and report the result as the answer —
/// on a ledger, where the row somebody is hunting is precisely the one that is
/// not in the recent five hundred. The pool filter is real because the server
/// performs it; nothing else is offered because nothing else would be true.

/// 500 is the server's own clamp. Asking for more is answered with the clamp
/// and no complaint, which is why `truncated` is derived from the row count.
const CAP = 500

const unpack = (body: unknown): Movement[] => [...(body as MovementList).items]

export function MovementsScreen() {
  const url = useQueryState()
  const pool = url.one("pool")
  const picking = url.one("panel") === "pool"

  /// Every shelf, not only the writable ones: this is a read, and a pool the
  /// centre may not post to still has a history worth looking at.
  const fleet = useReport<FleetPoolList>({
    key: ["inventory", "fleet"],
    path: "/api/v1/inventory/fleet-pools",
  })

  const places = useMemo(
    () =>
      (fleet.data?.items ?? [])
        .filter((row) => !row.is_rollup)
        .sort((a, b) => a.id.localeCompare(b.id)),
    [fleet.data],
  )

  const ledger = useBoundedList<Movement>({
    key: ["inventory", "movements"],
    path: "/api/v1/inventory/movements",
    params: { pool_id: pool || null },
    limit: CAP,
    unpack,
  })

  const columns: ColumnDef<TableSetup, Movement>[] = [
    {
      id: "when",
      header: "When",
      size: 16,
      meta: { icon: <Clock className="size-[15px]" />, min: 165 },
      /// Two instants, and they are not the same fact. `occurred_at` is when
      /// the poster says it happened; `recorded_at` is when this ledger heard
      /// about it. For anything synced from a node the gap between them is the
      /// sync lag, and a screen that drew only one of them could not show it.
      cell: ({ row }) => {
        const movement = row.original
        const late =
          movement.recorded_at !== null &&
          Date.parse(movement.recorded_at) - Date.parse(movement.occurred_at) >
            60_000
        return (
          <>
            <span className="text-ink-2 block">
              {moment(movement.occurred_at)}
            </span>
            {late && (
              <span className="text-label text-ink-4 block">
                recorded {moment(movement.recorded_at)}
              </span>
            )}
          </>
        )
      },
    },
    {
      id: "cause",
      header: "Cause",
      size: 15,
      // Never dropped. See the note at the head of this file.
      meta: { min: 150 },
      cell: ({ row }) => <Tag>{humanise(row.original.cause)}</Tag>,
    },
    {
      id: "route",
      header: "Out of · into",
      size: 28,
      // Never dropped: it is the movement.
      meta: {
        icon: <ArrowLeftRight className="size-[15px]" />,
        min: 260,
      },
      /// Stacked rather than laid out on one line, and that is a layout
      /// decision as much as a reading one: a pool id is thirty-odd characters
      /// of mono that will not wrap, so side by side the widest route in view
      /// sets the column and the columns to its right stop lining up at all.
      /// Two lines fit the declared width, and the pair reads as what it is:
      /// out of here, into there.
      cell: ({ row }) => (
        <span className="text-label block overflow-hidden font-mono leading-snug">
          <span className="block truncate">
            <Place id={row.original.from} />
          </span>
          <span className="block truncate">
            <span className="text-ink-4">→ </span>
            <Place id={row.original.to} />
          </span>
        </span>
      ),
    },
    {
      id: "subject",
      header: "Tag · SKU",
      size: 18,
      meta: { priority: 2, min: 170 },
      cell: ({ row }) => (
        <>
          <Ident className="text-cell text-ink-2 block truncate">
            {row.original.epc ?? row.original.subject_id}
          </Ident>
          <Ident className="block truncate">
            {row.original.sku_code ?? "no SKU on the row"}
          </Ident>
        </>
      ),
    },
    {
      id: "quantity",
      header: "Qty",
      size: 8,
      meta: { align: "right", priority: 3, min: 80 },
      cell: ({ row }) => (
        <span className="tabular-nums">{count(row.original.quantity)}</span>
      ),
    },
    {
      id: "actor",
      header: "Posted by",
      size: 15,
      meta: { priority: 1, min: 150 },
      /// The reference under the actor, because between them they are the
      /// audit: who claims it, and against what document. A movement with
      /// neither is one nobody can trace back.
      cell: ({ row }) => (
        <>
          <span className="text-ink-2 block truncate">
            {row.original.actor_id}
          </span>
          {row.original.reference_id === null ? (
            <Quiet>
              <span className="text-label">no reference</span>
            </Quiet>
          ) : (
            <Ident className="block truncate">
              {row.original.reference_id}
            </Ident>
          )}
        </>
      ),
    },
  ]

  const chosen = places.find((row) => row.id === pool)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHead
        module="Inventory"
        title="Movements"
        description="Every posting that moved a piece. Double-entry: a route, a cause, and who posted it."
      />

      {/* A period, not a position: this is what happened, and the newest five
          hundred of it. Adding a column of it up gives a flow, and no figure
          here is a balance. */}
      <ScopeLine
        scope={{ kind: "during", period: "the newest postings on file" }}
        measure="pieces"
        unit={chosen ? `${chosen.site_name ?? chosen.site_id} · ${chosen.label}` : undefined}
        note="newest first, by when it happened"
      />

      {ledger.truncated && <Truncated limit={CAP} noun="movements" />}

      <Toolbar
        // Not `<Loaded>`: that says "50 of 1,284", which is a promise this
        // endpoint cannot make. It returns no total, so the only true sentence
        // is how many arrived.
        trailing={
          ledger.query.isPending
            ? "Loading…"
            : `${count(ledger.rows.length)} fetched, of a number this endpoint does not report`
        }
      >
        <Button
          icon={<Boxes className="size-4" />}
          onClick={() => url.set({ panel: "pool" }, false)}
        >
          {chosen
            ? `${chosen.site_name ?? chosen.site_id} · ${chosen.label}`
            : "Every pool"}
        </Button>
        <span className="text-ctl text-ink-4">
          This endpoint takes a pool and nothing else — no search, no date
          range, no cause filter, and no count of what it left out.
        </span>
      </Toolbar>

      {ledger.query.isError ? (
        <Failed
          what="the movement ledger"
          error={ledger.query.error}
          onRetry={() => void ledger.query.refetch()}
        />
      ) : ledger.query.isPending ? (
        <Loading cols={6} />
      ) : ledger.rows.length === 0 ? (
        <Empty
          what="movements"
          detail={
            pool === ""
              ? "Nothing has ever been posted to this ledger."
              : "Nothing has moved in or out of this pool."
          }
        />
      ) : (
        <Table
          columns={columns}
          rows={ledger.rows}
          rowId={(row) => row.movement_id}
          caption="The movement ledger"
          foot={{
            when: (
              <>
                <b className="text-ink">{count(ledger.rows.length)}</b>{" "}
                movements fetched
              </>
            ),
            // No column of figures is added up here. A movement is a flow and
            // these are the newest five hundred of them: their quantities sum
            // to a number that is neither a balance nor a throughput, and
            // drawing it would invite it to be read as one.
            actor: ledger.truncated
              ? "the newest 500; there may be more"
              : "which is all of them",
          }}
        />
      )}

      <PoolPicker
        open={picking}
        pools={places}
        chosen={pool}
        anyLabel="Every pool"
        onPick={(id) => url.set({ pool: id || null, panel: null }, false)}
        onClose={() => url.set({ panel: null }, false)}
        subtitle="The ledger is filtered on the server by pool. Every shelf is offered, including the ones this node may not post to — a read is not a write."
      />
    </div>
  )
}
