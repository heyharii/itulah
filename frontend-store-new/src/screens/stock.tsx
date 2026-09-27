import { useQuery } from "@tanstack/react-query"
import { ArrowLeftRight, History, PackagePlus } from "lucide-react"

import { AppLink } from "@/components/ui/app-link"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { ListTable, type ListColumn } from "@/components/ui/list-table"
import { Meter } from "@/components/ui/meter"
import { Pill } from "@/components/ui/pill"
import { ScanField } from "@/components/ui/scan-field"
import { Screen } from "@/components/ui/screen"
import { Stat, StatStrip } from "@/components/ui/stat-strip"
import { EmptyState } from "@/components/ui/states"
import { count, moment } from "@/lib/format"
import { useGo } from "@/lib/go"
import {
  fetchPools,
  poolsKey,
  type PoolRow,
  type PoolsAnswer,
} from "@/lib/queries"
import { queryState } from "@/lib/query-state"
import { MoveSheet } from "@/screens/stock/move-sheet"
import { useMover, type Mover } from "@/screens/stock/mover"
import {
  Fact,
  Facts,
  PoolGlyph,
  Route,
  StockStrip,
  Toolbar,
} from "@/screens/stock/parts"
import {
  LEDGER_LIMIT,
  causeLabel,
  placeCodeOf,
  placeLabel,
  skuOf,
  useLedger,
  useRange,
} from "@/screens/stock/shared"
import type { CatalogRow } from "@itulah/contract"

/// On hand — what is in this shop, and moving a piece between the places it
/// can be.
///
/// Drawn as the hub's Stock overview (`frontend-hub/src/screens/inventory/
/// overview.tsx`): the four figures of the inventory equation across the top,
/// then the pools behind them as a table. A shop owns three pools — its
/// warehouse, its floor and its reject shelf — so the table is short, and a
/// row opens in place onto what the ledger last did to that pool.
///
/// The one write is a move, and it lives in a sheet (`move-sheet.tsx`). A
/// scan on this page opens it with the piece already loaded; "Move stock"
/// opens it waiting for one. Receiving and selling are not moves and are not
/// here — each writes its own cause through its own endpoint.
export function Stock() {
  const go = useGo()
  const mover = useMover()
  const pools = useQuery({
    queryKey: poolsKey(),
    queryFn: ({ signal }) => fetchPools(signal),
  })

  return (
    <Screen
      sub="What this shop holds, pool by pool. Scan a garment's tag to move it between them."
      actions={
        <>
          <Button onClick={() => go("/stock/movements")}>
            <History />
            Movements
          </Button>
          <Button variant="primary" onClick={() => mover.start()}>
            <ArrowLeftRight />
            Move stock
          </Button>
        </>
      }
    >
      <StockStrip />

      {queryState(pools, {
        loading: "Reading this shop's pools…",
        render: (answer) => <Pools answer={answer} mover={mover} />,
      })}

      <MoveSheet mover={mover} />
    </Screen>
  )
}

function Pools({ answer, mover }: { answer: PoolsAnswer; mover: Mover }) {
  const go = useGo()
  // A rollup is a sum of other pools, not a place: counting it would count
  // its pieces twice. A shop's node has none today; the filter is what keeps
  // that true if it ever does.
  const rows = answer.items
    .filter((pool) => !pool.is_rollup)
    .sort((left, right) => left.display_order - right.display_order)

  if (rows.length === 0) {
    return (
      <Card>
        <EmptyState
          action={
            <Button onClick={() => go("/receive")}>
              <PackagePlus />
              Receive stock
            </Button>
          }
        >
          This node owns no pools yet. Nothing has ever been received here.
        </EmptyState>
      </Card>
    )
  }

  const total = (pick: (pool: PoolRow) => number) =>
    rows.reduce((running, pool) => running + pick(pool), 0)
  const stock = total((pool) => pool.stock)
  const onHand = total((pool) => pool.on_hand)
  const allotted = total((pool) => pool.allotted ?? 0)
  const missing = total((pool) => pool.missing)
  const floor = rows.find((pool) => placeCodeOf(pool.id) === "floor")

  return (
    <>
      <StatStrip className="md:grid-cols-4">
        <Stat label="Stock" value={count(stock)} sub="Every piece on record" />
        <Stat
          label="On hand"
          value={count(onHand)}
          sub={
            floor === undefined
              ? "Where the ledger puts it"
              : `${count(floor.on_hand)} on the shop floor`
          }
        />
        <Stat
          label="Allotted"
          value={count(allotted)}
          sub="Promised, not yet gone"
        />
        <Stat
          label="Missing"
          value={count(missing)}
          tone={missing > 0 ? "bad" : undefined}
          sub={missing > 0 ? "Not where it belongs" : "All accounted for"}
        />
      </StatStrip>

      <Toolbar>
        <ScanField
          onScan={mover.scan}
          autoFocus={false}
          placeholder="Scan a tag to move it…"
          className="md:max-w-[30rem] md:flex-1"
          action={
            // The header's primary action, for the width that has no header.
            <Button
              variant="primary"
              className="h-12 md:hidden"
              onClick={() => mover.start()}
            >
              <ArrowLeftRight />
              Move
            </Button>
          }
        />
        <p className="text-meta text-mute tabular-nums md:text-right">
          {answer.inventory_equation} · as of {moment(answer.as_of)}
        </p>
      </Toolbar>

      <Card>
        <ListTable
          rows={rows}
          columns={columns}
          rowKey={(pool) => pool.id}
          detail={(pool) => <PoolDetail pool={pool} mover={mover} />}
          empty="This node owns no pools yet."
        />
      </Card>

      {stock === 0 && (
        <p className="mt-3 text-meta text-body">
          Nothing is on hand yet. A delivery comes in through{" "}
          <AppLink
            to="/receive"
            className="font-medium text-accent underline-offset-2 hover:underline"
          >
            Receive
          </AppLink>
          , and lands in the warehouse.
        </p>
      )}
    </>
  )
}

/// The node's own label for a pool, unless it is one of the shop's three —
/// then the word the rest of this app uses, so "Floor" here and "Shop floor"
/// in the ledger are not two places.
function poolName(pool: PoolRow): string {
  const code = placeCodeOf(pool.id)
  return code === null ? pool.label : placeLabel(code)
}

/// How much of what was ever here can still be found. A meter, not a status
/// colour: it says how much, not what state.
function accounted(pool: PoolRow): number | null {
  return pool.stock === 0 ? null : 1 - pool.missing / pool.stock
}

function PoolStatus({ pool }: { pool: PoolRow }) {
  if (pool.missing > 0) {
    return <Pill tone="bad">{count(pool.missing)} missing</Pill>
  }
  if (pool.stock === 0) return <Pill>Empty</Pill>
  return <Pill tone="ok">All accounted for</Pill>
}

/// The hub's pool columns, cut to what a shop's node reports. The figures are
/// right-aligned and give way to one summary line on a phone, where four
/// numbers in a row are four numbers nobody can tell apart.
const columns: readonly ListColumn<PoolRow>[] = [
  {
    id: "pool",
    header: "Pool",
    cell: (pool) => (
      <span className="flex min-w-0 items-center gap-2.5">
        <PoolGlyph code={placeCodeOf(pool.id)} />
        <span className="min-w-0">
          <span className="block truncate font-medium text-ink">
            {poolName(pool)}
          </span>
          <span className="block truncate font-mono text-id font-normal text-mute">
            {pool.id}
          </span>
        </span>
      </span>
    ),
  },
  {
    id: "stock",
    header: "Stock",
    align: "right",
    card: "hide",
    cell: (pool) => <span className="tabular-nums">{count(pool.stock)}</span>,
  },
  {
    id: "on-hand",
    header: "On hand",
    align: "right",
    card: "hide",
    cell: (pool) => (
      <span
        className={
          pool.on_hand < 0
            ? "font-medium text-bad-fg tabular-nums"
            : "font-medium text-ink tabular-nums"
        }
      >
        {count(pool.on_hand)}
      </span>
    ),
  },
  {
    id: "allotted",
    header: "Allotted",
    align: "right",
    card: "hide",
    cell: (pool) =>
      pool.allotted === null ? (
        <span className="text-mute">—</span>
      ) : (
        <span
          className={
            pool.allotted > 0
              ? "text-info-fg tabular-nums"
              : "text-mute tabular-nums"
          }
        >
          {count(pool.allotted)}
        </span>
      ),
  },
  {
    id: "missing",
    header: "Missing",
    align: "right",
    card: "hide",
    cell: (pool) => (
      <span
        className={
          pool.missing > 0
            ? "font-medium text-bad-fg tabular-nums"
            : "text-mute tabular-nums"
        }
      >
        {count(pool.missing)}
      </span>
    ),
  },
  {
    id: "accounted",
    header: "Accounted for",
    card: "hide",
    className: "w-44 max-xl:hidden",
    cell: (pool) => {
      const share = accounted(pool)
      return share === null ? (
        <span className="text-mute">—</span>
      ) : (
        <span className="flex items-center gap-2.5">
          <Meter
            value={share}
            tone={pool.missing > 0 ? "warn" : "ok"}
            className="w-20"
          />
          <span className="text-meta text-body tabular-nums">
            {Math.floor(share * 100)}%
          </span>
        </span>
      )
    },
  },
  {
    id: "status",
    header: "Status",
    card: "status",
    cell: (pool) => <PoolStatus pool={pool} />,
  },
  {
    // The phone's line of figures. Hidden on a desk, where the four columns
    // above say the same thing one number at a time.
    id: "summary",
    header: "",
    card: "meta",
    className: "hidden",
    cell: (pool) =>
      `${count(pool.on_hand)} on hand · ${count(pool.stock)} stock · ${
        pool.allotted === null ? "" : `${count(pool.allotted)} allotted · `
      }${count(pool.missing)} missing`,
  },
]

/// What opens under a pool: the share still accounted for, and the last few
/// things the ledger did to it — the question somebody has when a number
/// looks wrong is "what happened here lately", and this answers it without
/// leaving the table.
function PoolDetail({ pool, mover }: { pool: PoolRow; mover: Mover }) {
  const go = useGo()
  const ledger = useLedger()
  const { bySku } = useRange()
  const code = placeCodeOf(pool.id)
  const share = accounted(pool)
  const through = (ledger.data ?? [])
    .filter(
      (row) =>
        row.from.split(":")[0] === pool.id || row.to.split(":")[0] === pool.id,
    )
    .slice(0, 5)

  return (
    <div className="flex flex-col gap-4 pt-2">
      {/* The meter, for the widths whose row had no room for it — a phone
          and a narrow desk. A wide desk already shows it in the row. */}
      <Facts className="xl:hidden">
        <Fact term="Accounted for">
          {share === null ? (
            "Nothing has been here yet"
          ) : (
            <span className="flex items-center gap-2.5">
              <Meter
                value={share}
                tone={pool.missing > 0 ? "warn" : "ok"}
                className="w-24"
              />
              {Math.floor(share * 100)}%
            </span>
          )}
        </Fact>
      </Facts>

      <div>
        <div className="mb-1.5 text-meta font-medium text-body">
          Latest through {poolName(pool).toLowerCase()}
        </div>
        {ledger.isPending ? (
          <p className="text-meta text-mute">Reading the ledger…</p>
        ) : through.length === 0 ? (
          <p className="text-meta text-mute">
            Nothing in the newest {LEDGER_LIMIT} movements touched this pool.
          </p>
        ) : (
          <ul className="overflow-hidden rounded-inner border border-hairline bg-canvas">
            {through.map((row) => (
              // One line on a desk; on a phone the route takes a line of its
              // own, because two chips and an arrow squeezed beside a date
              // and a cause are two empty pills.
              <li
                key={row.movement_id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-hairline px-3 py-2 text-cell last:border-b-0"
              >
                <Route
                  from={row.from}
                  to={row.to}
                  cause={row.cause}
                  className="min-w-0 max-md:order-first max-md:basis-full md:flex-1"
                />
                <span className="shrink-0 text-meta text-mute tabular-nums md:order-first md:w-24">
                  {moment(row.occurred_at)}
                </span>
                <span className="shrink-0 text-text md:order-first md:w-28">
                  {causeLabel(row.cause)}
                </span>
                <span className="flex min-w-0 max-md:flex-1 max-md:justify-end">
                  <ProductName epc={row.epc} bySku={bySku} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-wrap gap-2 max-md:[&>*]:flex-1">
        {code !== null && (
          <Button onClick={() => mover.start(code)}>
            <ArrowLeftRight />
            Move a piece from here
          </Button>
        )}
        <Button onClick={() => go("/stock/movements", { q: pool.id })}>
          <History />
          Every movement here
        </Button>
      </div>
    </div>
  )
}

/// The garment a movement moved, by name when the book knows it and by the
/// SKU off its tag when it does not.
function ProductName({
  epc,
  bySku,
}: {
  epc: string
  bySku: ReadonlyMap<string, CatalogRow>
}) {
  const sku = skuOf(epc)
  const name = sku === null ? undefined : bySku.get(sku)?.name
  return name !== undefined ? (
    <span className="max-w-[14rem] truncate text-body" title={sku ?? undefined}>
      {name}
    </span>
  ) : (
    <span className="font-mono text-id text-mute">
      {sku ?? `…${epc.slice(-8)}`}
    </span>
  )
}
