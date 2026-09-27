import { PackagePlus } from "lucide-react"
import { useDeferredValue, useEffect, useMemo, useState } from "react"

import { AppLink } from "@/components/ui/app-link"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { ListTable, type ListColumn } from "@/components/ui/list-table"
import { Screen } from "@/components/ui/screen"
import { Segmented } from "@/components/ui/segmented"
import { EmptyState } from "@/components/ui/states"
import { Tag } from "@/components/ui/tag"
import { count, label as humanise, moment } from "@/lib/format"
import { useGo } from "@/lib/go"
import { useParam } from "@/lib/params"
import { queryState } from "@/lib/query-state"
import {
  Code,
  Fact,
  Facts,
  Route,
  SearchBox,
  StockStrip,
  Toolbar,
} from "@/screens/stock/parts"
import {
  LEDGER_LIMIT,
  LEDGER_MAX,
  causeLabel,
  causeTone,
  directionOf,
  matches,
  readPlace,
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
/// ledger can be. A mistake is corrected by another movement that says what it
/// is correcting, and this is where both of them show up. That is also why the
/// header carries no action — there is nothing to write from here.
///
/// **Everything is narrowed in the browser.** The node's read takes a limit and
/// nothing else (`edge/http.rs::movements`), so the direction, the search and
/// the counts all run over the page in hand, and the page says how big it is
/// rather than pretending to be the whole ledger. A shop's day is about a
/// hundred lines; the node will hand over five hundred when asked.
export function Movements() {
  const go = useGo()
  const search = useParam("q")

  /// What is being typed, held locally and pushed to the URL as it settles —
  /// the Catalogue's split, for the Catalogue's reason: a pool's "Every
  /// movement here" lands on this screen already narrowed, and a narrowed
  /// ledger should survive the tablet going to sleep.
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
  const [way, setWay] = useState<"all" | Direction>("all")
  const ledger = useLedger(limit)
  const { bySku } = useRange()

  return (
    <Screen sub="Every movement this shop's ledger holds, newest first. Nothing here is edited — a mistake is corrected by another movement.">
      <StockStrip />
      {queryState(ledger, {
        loading: "Reading this shop's ledger…",
        render: (rows) =>
          rows.length === 0 ? (
            <Card>
              <EmptyState
                action={
                  <Button onClick={() => go("/receive")}>
                    <PackagePlus />
                    Receive stock
                  </Button>
                }
              >
                Nothing has moved in this shop yet. Receiving a garment or
                selling one writes the first line here.
              </EmptyState>
            </Card>
          ) : (
            <Ledger
              rows={rows}
              bySku={bySku}
              needle={needle}
              typed={typed}
              onType={setTyped}
              way={way}
              onWay={setWay}
              limit={limit}
              onMore={() => setLimit(LEDGER_MAX)}
              fetching={ledger.isPlaceholderData}
            />
          ),
      })}
    </Screen>
  )
}

function Ledger({
  rows,
  bySku,
  needle,
  typed,
  onType,
  way,
  onWay,
  limit,
  onMore,
  fetching,
}: {
  rows: readonly MovementView[]
  bySku: ReadonlyMap<string, CatalogRow>
  needle: string
  typed: string
  onType: (next: string) => void
  way: "all" | Direction
  onWay: (next: "all" | Direction) => void
  limit: number
  onMore: () => void
  fetching: boolean
}) {
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

  const columns = useMemo(() => columnsFor(bySku), [bySku])

  return (
    <>
      <Toolbar>
        <Segmented<"all" | Direction>
          value={way}
          onChange={onWay}
          // The hub's compact control on a desk with a mouse, the touch floor
          // anywhere a finger is; the counts are in the labels because the one
          // question a filter raises is "how many would I see".
          className="md:w-auto [&>button]:px-3.5 [&>button]:whitespace-nowrap pointer-coarse:[&>button]:h-tap md:pointer-fine:[&>button]:h-8"
          options={[
            { value: "all", label: `All · ${count(rows.length)}` },
            { value: "in", label: `In · ${count(counts.in)}` },
            { value: "out", label: `Out · ${count(counts.out)}` },
            { value: "inside", label: `Inside · ${count(counts.inside)}` },
          ]}
        />
        <SearchBox
          value={typed}
          onChange={onType}
          placeholder="Search tag, SKU, place, person"
        />
      </Toolbar>

      <Card>
        <ListTable
          rows={shown}
          columns={columns}
          rowKey={(row) => row.movement_id}
          detail={(row) => (
            <MovementDetail row={row} rows={rows} bySku={bySku} />
          )}
          empty={
            needle !== ""
              ? `No movement in the newest ${count(rows.length)} matches “${typed.trim()}”.`
              : way === "in"
                ? "Nothing came into the shop in these movements."
                : way === "out"
                  ? "Nothing left the shop in these movements."
                  : "Nothing moved between the shop's own places in these movements."
          }
        />
      </Card>

      <div className="mt-3 flex flex-col gap-2 text-meta text-mute md:flex-row md:items-center md:justify-between">
        <span className="tabular-nums">
          {rows.length < limit
            ? `The whole ledger — ${count(rows.length)} movements.`
            : `The newest ${count(rows.length)} movements.`}
          {
            " In: arrived in the shop. Out: left it. Inside: moved between its own places."
          }
        </span>
        {rows.length >= limit && limit < LEDGER_MAX && (
          <Button onClick={onMore} disabled={fetching} className="md:self-auto">
            {fetching ? "Reading…" : `Read the last ${count(LEDGER_MAX)}`}
          </Button>
        )}
      </div>
    </>
  )
}

/// Every word a movement carries, so the box finds a row by whatever the
/// person has in hand: the tag, the SKU, the garment's name, a place — by its
/// name or by its id, which is what a pool's "Every movement here" sends —
/// or who did it.
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

/// What a movement's tag was written for, read off the tag. The SKU is always
/// there; the name only when this shop's book holds it — which, on a node no
/// price book has reached yet, is never, and the column still reads.
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

/// The columns, over the book they name garments with. A factory for that
/// reason only — the hub's does the same with its pool master.
///
/// Route is the load-bearing column and the phone card's title: "out of here,
/// into there" is what a movement IS, and the cause beside it says why.
function columnsFor(
  bySku: ReadonlyMap<string, CatalogRow>,
): readonly ListColumn<MovementView>[] {
  return [
    {
      id: "when",
      header: "When",
      card: "hide",
      className: "w-[7.5rem]",
      cell: (row) => (
        <span className="text-body tabular-nums">
          {moment(row.occurred_at)}
        </span>
      ),
    },
    {
      id: "movement",
      header: "Movement",
      card: "status",
      className: "w-[8.5rem]",
      cell: (row) => (
        <Tag tone={causeTone(row.cause)}>{causeLabel(row.cause)}</Tag>
      ),
    },
    {
      id: "route",
      header: "Route",
      card: "title",
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
      header: "Product",
      card: "meta",
      className: "max-w-[18rem]",
      cell: (row) => <Product epc={row.epc} bySku={bySku} />,
    },
    {
      id: "quantity",
      header: "Qty",
      align: "right",
      card: "hide",
      className: "w-14",
      cell: (row) => (
        <span className="tabular-nums">{count(row.quantity)}</span>
      ),
    },
    {
      id: "actor",
      header: "By",
      card: "hide",
      className: "max-lg:hidden",
      cell: (row) => <span className="text-body">{row.actor_id}</span>,
    },
    {
      // The phone's second line: when, who, and how many only when it is not
      // the one it almost always is.
      id: "phone-when",
      header: "",
      card: "meta",
      className: "hidden",
      cell: (row) =>
        [
          moment(row.occurred_at),
          row.actor_id,
          row.quantity === 1 ? null : `×${count(row.quantity)}`,
        ]
          .filter(Boolean)
          .join(" · "),
    },
  ]
}

/// Everything the ledger holds about one movement, opened under its row. The
/// row names the places; the detail adds the ids they stand for, the tag in
/// full, and what the movement was posted against — the three things somebody
/// reads out to head office when a number is being argued about.
function MovementDetail({
  row,
  rows,
  bySku,
}: {
  row: MovementView
  rows: readonly MovementView[]
  bySku: ReadonlyMap<string, CatalogRow>
}) {
  const sku = skuOf(row.epc)
  const product = sku === null ? undefined : bySku.get(sku)
  // Posted together — a sale of three garments is one group of three lines.
  const siblings = rows.filter(
    (one) =>
      one.movement_group_id === row.movement_group_id &&
      one.movement_id !== row.movement_id,
  ).length
  const from = readPlace(row.from, row.cause)
  const to = readPlace(row.to, row.cause)

  return (
    <Facts className="pt-2 lg:grid-cols-4">
      <Fact term="Product">
        {product?.name ??
          (sku === null
            ? "Not a tag this codec reads"
            : "Not in this shop's book")}
        {sku !== null && (
          <span className="block">
            <Code>{sku}</Code>
          </span>
        )}
        {product !== undefined && (
          <AppLink
            to="/catalogue/product"
            search={{ sku: product.sku_code }}
            className="mt-0.5 inline-block text-meta font-medium text-accent underline-offset-2 hover:underline"
          >
            Open in the catalogue
          </AppLink>
        )}
      </Fact>
      <Fact term="Tag">
        <Code>{row.epc}</Code>
      </Fact>
      <Fact term="From">
        {from.name}
        {from.state !== null && ` (${from.state})`}
        <span className="block">
          <Code>{row.from}</Code>
        </span>
      </Fact>
      <Fact term="To">
        {to.name}
        {to.state !== null && ` (${to.state})`}
        <span className="block">
          <Code>{row.to}</Code>
        </span>
      </Fact>
      <Fact term="Why">
        {causeLabel(row.cause)}
        <span className="block">
          <Code>{row.cause}</Code>
        </span>
      </Fact>
      <Fact term="Posted against">
        {row.reference_type === null ? (
          <span className="text-mute">Nothing — a movement on its own</span>
        ) : (
          <>
            {humanise(row.reference_type)}
            {row.reference_id !== null && (
              <span className="block">
                <Code>{row.reference_id}</Code>
              </span>
            )}
          </>
        )}
      </Fact>
      <Fact term="By">
        {row.actor_id} · {moment(row.occurred_at)}
      </Fact>
      <Fact term="Movement">
        <Code>{row.movement_id}</Code>
        {siblings > 0 && (
          <span className="block text-meta text-mute">
            Posted with {count(siblings)} other{siblings === 1 ? "" : "s"}
          </span>
        )}
      </Fact>
    </Facts>
  )
}
