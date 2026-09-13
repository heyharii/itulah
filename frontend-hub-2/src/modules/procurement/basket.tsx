import { PackageSearch, Trash2 } from "lucide-react"
import { useMemo } from "react"
import type { BasketLine, SetBasketQuantityRequest } from "@itulah/contract"

import { Button } from "@/kit/button"
import { PageHead, Toolbar } from "@/kit/page"
import { Tile, Tiles } from "@/kit/tiles"
import { Empty, Failed, Loading } from "@/kit/state"
import { amount, count, rp } from "@/lib/format"
import { api } from "@/lib/api"
import { useWrite } from "@/lib/mutate"

import { LinkButton, Refused, Thumb } from "@/modules/procurement/parts"
import { useBasket } from "@/modules/procurement/reads"
import { keys } from "@/modules/procurement/wire"

/// The basket — picked out, not yet ordered.
///
/// ## It is this module's draft store, and that is the point of it
///
/// Kept by the SERVER rather than in `localStorage`. A basket in a browser is a
/// property of a machine: it does not follow anybody to a second desk, it does
/// not survive a cleared cache, and it cannot be seen by the person asked to
/// approve what is in it.
///
/// Which is also why the composer next door has no lines of its own. A purchase
/// order being written is these lines, for one supplier — so a half-written
/// order survives a reload, a closed tab and a machine going to sleep, and
/// **"the draft lost a line" is not a failure this module can have.** The only
/// way a line leaves is somebody removing it or an order consuming it, and both
/// are writes the server acknowledged.
///
/// ## One basket, several orders
///
/// A purchase order belongs to ONE supplier, so the basket is grouped by
/// supplier and each group is a separate order. That is not a display choice: a
/// PO with two suppliers on it is not a document anybody can send.
///
/// ## The figures here are added up in the browser, and may be
///
/// `GET /api/v1/sourcing-basket` takes no parameters and has no cap — it
/// answers the caller's whole basket. So there is no page here to mistake for
/// the set, which is the one circumstance in which summing on the client is
/// not a claim about the download. It is also priced at what the CATALOGUE says
/// today, and says so: the price an order is actually raised at is snapshotted
/// by the server from the supplier item at that moment.

/// One supplier's worth of basket — which is one potential order.
interface Group {
  readonly supplierId: string
  readonly supplierName: string
  readonly lines: readonly BasketLine[]
  readonly pieces: number
  readonly value: number
}

function groupBySupplier(lines: readonly BasketLine[]): readonly Group[] {
  const groups = new Map<string, BasketLine[]>()
  for (const line of lines) {
    const key = line.supplier.supplier_id
    const existing = groups.get(key)
    if (existing) existing.push(line)
    else groups.set(key, [line])
  }
  return [...groups.entries()]
    .map(([supplierId, own]) => ({
      supplierId,
      supplierName: own[0].supplier.name,
      lines: own,
      pieces: own.reduce((sum, line) => sum + line.quantity, 0),
      value: own.reduce(
        (sum, line) => sum + line.quantity * line.item.unit_price_minor,
        0,
      ),
    }))
    // Biggest order first: that is the one somebody came here to raise.
    .sort((a, b) => b.value - a.value)
}

export function BasketScreen() {
  const basket = useBasket()
  const groups = useMemo(() => groupBySupplier(basket.rows), [basket.rows])

  const pieces = basket.rows.reduce((sum, line) => sum + line.quantity, 0)
  const value = basket.rows.reduce(
    (sum, line) => sum + line.quantity * line.item.unit_price_minor,
    0,
  )

  /// Say exactly how many.
  ///
  /// Zero takes the line out, which is what the server does with it — there is
  /// no "quantity 0" line to draw — so the box accepts it rather than clamping
  /// at one and leaving somebody to hunt for the bin.
  const setQuantity = useWrite<
    { id: string; quantity: number },
    BasketLine | undefined
  >({
    send: ({ id, quantity }) =>
      api.patch<BasketLine | undefined>(
        `/api/v1/sourcing-basket/${encodeURIComponent(id)}`,
        { quantity } satisfies SetBasketQuantityRequest,
      ),
    settles: () => [keys.basket],
  })

  /// A `POST` rather than a `DELETE`, because the node's CORS layer permits
  /// GET, POST and PATCH and widening it for one route would loosen every
  /// route. The verb is the server's decision, not this screen's.
  const remove = useWrite<string, void>({
    send: (id) =>
      api.post<void>(
        `/api/v1/sourcing-basket/${encodeURIComponent(id)}/remove`,
        {},
      ),
    settles: () => [keys.basket],
  })

  const empty = useWrite<void, void>({
    send: () => api.post<void>("/api/v1/sourcing-basket/clear", {}),
    settles: () => [keys.basket],
  })

  const problem =
    setQuantity.problem ?? remove.problem ?? empty.problem ?? null

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHead
        module="Procurement"
        title="Basket"
        description="What has been picked out and not yet ordered. It is kept by the server, so it is the same basket at every desk you sign in from."
        action={
          <LinkButton to="/procurement/sourcing" variant="primary">
            <PackageSearch className="size-4" /> Go shopping
          </LinkButton>
        }
      />

      {problem !== null && <Refused problem={problem} />}

      <Tiles>
        <Tile
          label="Suppliers"
          value={count(groups.length)}
          note={
            groups.length === 1
              ? "one order to raise"
              : `${count(groups.length)} separate orders`
          }
        />
        <Tile label="Lines" value={count(basket.rows.length)} note="distinct items" />
        <Tile label="Pieces" value={count(pieces)} note="added across every line" />
        <Tile
          label="At today's catalogue prices"
          value={value}
          note="the server snapshots the price when the order is raised"
        />
      </Tiles>

      <Toolbar
        trailing={basket.query.isFetching ? "Loading…" : `${count(pieces)} pieces`}
      >
        <span className="text-ctl text-ink-3">
          A purchase order is for one supplier, so each group below is one order.
        </span>
        <Button
          className="ml-auto"
          icon={<Trash2 className="size-4" />}
          disabled={basket.rows.length === 0 || empty.pending}
          onClick={() => empty.run()}
        >
          {empty.pending ? "Emptying…" : "Empty the basket"}
        </Button>
      </Toolbar>

      {basket.query.isError ? (
        <Failed
          what="the basket"
          error={basket.query.error}
          onRetry={() => void basket.query.refetch()}
        />
      ) : basket.query.isPending ? (
        <Loading rows={5} cols={4} />
      ) : groups.length === 0 ? (
        <Empty
          what="items in the basket"
          detail="Nothing has been picked out yet. Sourcing is every supplier's catalogue in one place, and the Add button on a card puts it here."
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {groups.map((group) => (
            <section key={group.supplierId} className="border-line border-b">
              <header className="border-line bg-side flex items-center gap-3 border-b px-4 py-2">
                <span className="text-cell text-ink min-w-0 flex-1 truncate font-medium">
                  {group.supplierName}
                </span>
                <span className="text-ctl text-ink-3 shrink-0 tabular-nums">
                  {count(group.pieces)} pieces · {rp(group.value)}
                </span>
                <LinkButton
                  to="/procurement/compose"
                  search={{ supplier: group.supplierId }}
                  variant="primary"
                >
                  Raise this order
                </LinkButton>
              </header>

              {group.lines.map((line) => (
                <Row
                  key={line.item.supplier_item_id}
                  line={line}
                  busy={
                    (setQuantity.pending &&
                      setQuantity.mutation.variables?.id ===
                        line.item.supplier_item_id) ||
                    (remove.pending &&
                      remove.mutation.variables === line.item.supplier_item_id)
                  }
                  onQuantity={(quantity) =>
                    setQuantity.run({
                      id: line.item.supplier_item_id,
                      quantity,
                    })
                  }
                  onRemove={() => remove.run(line.item.supplier_item_id)}
                />
              ))}
            </section>
          ))}
        </div>
      )}
    </div>
  )
}

/// One line, and the only two things that can be done to it here.
///
/// ## Why the quantity box is uncontrolled
///
/// Nothing in this module is optimistic — the figure on screen is the figure
/// the server holds; see `lib/mutate.ts`. That would normally mean a box that
/// does not move until the round trip finishes, which is unusable to type in.
///
/// So the TEXT is the browser's and the FIGURE is the server's. The input is
/// uncontrolled, holds whatever was typed, and commits on blur or Enter; the
/// line value beside it, the group total above it and the tiles at the top all
/// come from the basket and only move when the server says so. Nothing is
/// predicted and nothing has to be rolled back.
///
/// The `key` carries the stored quantity, so when the server answers with a
/// different number the input is remounted with it — which is how a refused or
/// clamped write corrects the box rather than leaving a figure nobody stored.
function Row({
  line,
  busy,
  onQuantity,
  onRemove,
}: {
  line: BasketLine
  busy: boolean
  onQuantity: (quantity: number) => void
  onRemove: () => void
}) {
  const commit = (raw: string) => {
    const next = Number.parseInt(raw, 10)
    if (!Number.isFinite(next) || next < 0) return
    if (next === line.quantity) return
    onQuantity(next)
  }

  return (
    <div className="border-line flex items-center gap-3 border-b px-4 py-2.5 last:border-b-0">
      <Thumb
        url={line.item.image_url}
        alt={line.item.name}
        className="size-10"
      />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-cell text-ink truncate">{line.item.name}</span>
        <span className="text-label text-ink-4 truncate font-mono">
          {line.item.supplier_item_code}
        </span>
      </span>

      <span className="text-ctl text-ink-3 w-28 shrink-0 text-right tabular-nums">
        {amount(line.item.unit_price_minor)}
        <span className="text-label text-ink-4 block">each</span>
      </span>

      <input
        key={`${line.item.supplier_item_id}-${line.quantity}`}
        defaultValue={line.quantity}
        inputMode="numeric"
        disabled={busy}
        aria-label={`Pieces of ${line.item.name}`}
        onBlur={(event) => commit(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return
          commit(event.currentTarget.value)
          event.currentTarget.blur()
        }}
        className="h-ctl rounded-ctl border-line-2 bg-canvas shadow-btn text-ctl text-ink focus:border-blue w-20 shrink-0 border px-2.5 text-right tabular-nums outline-none disabled:opacity-50"
      />

      <span className="text-cell text-ink w-32 shrink-0 text-right font-medium tabular-nums">
        {amount(line.quantity * line.item.unit_price_minor)}
      </span>

      <Button
        variant="quiet"
        aria-label={`Take ${line.item.name} out of the basket`}
        disabled={busy}
        onClick={onRemove}
        icon={<Trash2 className="size-4" />}
      />
    </div>
  )
}
