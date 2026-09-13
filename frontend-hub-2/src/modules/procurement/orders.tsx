import { Building2, ClipboardList, FilePlus2, SlidersHorizontal } from "lucide-react"
import type { ColumnDef } from "@tanstack/react-table"
import { useMemo } from "react"

import { Button } from "@/kit/button"
import { CheckRow, SearchField } from "@/kit/field"
import { PageHead, Toolbar } from "@/kit/page"
import { ScopeLine } from "@/kit/scope"
import { Sheet } from "@/kit/sheet"
import { Table } from "@/kit/table"
import { Tabs } from "@/kit/tabs"
import { Tag } from "@/kit/tag"
import { Tile, Tiles } from "@/kit/tiles"
import { Truncated } from "@/kit/notice"
import { Empty, Failed, Loading, NoMatch } from "@/kit/state"
import { amount, count, day, rp } from "@/lib/format"
import { useQueryState } from "@/lib/query-state"
import { useDebounced } from "@/lib/use-debounced"
import type { TableSetup } from "@/lib/table"

import {
  ORDER_STATUSES,
  orderStatusLabel,
  orderStatusTone,
} from "@/modules/procurement/labels"
import {
  Fact,
  Facts,
  Ladder,
  LinkButton,
  Money,
  Quiet,
  SubHead,
  Thumb,
  Unanswered,
} from "@/modules/procurement/parts"
import { BOOK_CAP, useOrder, useOrderBook, useSuppliers } from "@/modules/procurement/reads"
import type {
  PurchaseOrderLine,
  PurchaseOrderRow,
} from "@/modules/procurement/wire"

/// The order book — what has been ordered, what has arrived, and what is still
/// owed.
///
/// One row is one purchase order: a document with one supplier on it, sent to
/// one destination, at one agreed set of prices. Everything else in this module
/// is a view of this list — Outstanding is it with the settled rows taken out,
/// Destinations is it folded by where the goods are going — which is why it is
/// the module's own screen rather than a page under a landing one.
///
/// ## Every narrowing is the server's, and the endpoint says how far that goes
///
/// `GET /api/v1/purchase-orders` takes `q`, `status`, `supplier`, `issued_from`
/// and `issued_to`, and answers a narrowed book with facet counts over the
/// WHOLE of it. So the search box, the tabs and the filter panel are all real.
///
/// What it does **not** take is a cursor, a total or a sort key. Three
/// consequences, each drawn on the page rather than hidden:
///
///   - The list is capped at `limit`, which defaults to 500. When exactly that
///     many come back, the honest reading is "there may be more and this
///     endpoint cannot say" — so `Truncated` appears and the money tiles stop
///     claiming to be totals.
///   - There is no sortable column. A header that re-ordered these rows would
///     be ordering whatever happened to arrive; the server's own order is
///     newest issued first, which is the order a buyer wants, and it is stated
///     in the scope line instead of implied by an arrow.
///   - "50 of 1,284 loaded" cannot be said. What is said instead is how many
///     matched, which is a fact about this request rather than about the book.
///
/// ## Why the tab counts come and go
///
/// The facets are counted over `purchase_order` with no filter applied at all —
/// not even the search. That is right for the SUPPLIER panel, where the number
/// answers "is this worth pressing". It is wrong beside a tab while a search is
/// running, because a tab reading "Issued 23" over a list of two reads as a
/// broken filter rather than as a different question. So the counts are drawn
/// only while nothing else is narrowing the book, and the panel keeps its
/// counts always because that is the one place they mean what they look like.

const columns: ColumnDef<TableSetup, PurchaseOrderRow>[] = [
  {
    id: "po",
    header: "Order",
    size: 22,
    // No priority: it is the identity column, and a list that hides which
    // order a figure belongs to has stopped being the list somebody asked for.
    meta: { icon: <ClipboardList className="size-[15px]" />, min: 210 },
    cell: ({ row }) => (
      <>
        <span className="text-ink block truncate font-mono font-medium">
          {row.original.po_number}
        </span>
        <span className="text-label text-ink-4 block truncate">
          {/* The name is denormalised onto the order, so this costs no second
              query — but it is nullable, and the supplier's own code is still
              an answer. */}
          {row.original.supplier_name ?? row.original.supplier_id}
        </span>
      </>
    ),
  },
  {
    id: "destination",
    header: "Goes to",
    size: 11,
    meta: { priority: 4, min: 100 },
    cell: ({ row }) => (
      <span className="truncate">{row.original.destination_site_id}</span>
    ),
  },
  {
    id: "dates",
    header: "Issued · expected",
    size: 15,
    meta: { priority: 3, min: 155 },
    cell: ({ row }) => (
      <>
        <span className="text-ink-2 block">
          {row.original.issued_at === null ? (
            <Quiet>not issued</Quiet>
          ) : (
            day(row.original.issued_at)
          )}
        </span>
        {/* The date the whole of Outstanding is measured against. One per
            order, because that is how a promise is agreed — the earliest of
            the lines, so a split promise reads as the first thing due. */}
        <span className="text-label text-ink-4 block">
          {row.original.expected_arrival === null
            ? "no promise"
            : day(row.original.expected_arrival)}
        </span>
      </>
    ),
  },
  {
    id: "lines",
    header: "Items",
    size: 8,
    // How many different things, not how many pieces. Pieces are the Received
    // column's business; this is the size of the document.
    meta: { align: "right", priority: 2, min: 80 },
    cell: ({ row }) => (
      <span className="text-ink-3 tabular-nums">
        {count(row.original.line_count)}
      </span>
    ),
  },
  {
    id: "value",
    header: "Value",
    size: 14,
    // Never dropped. What the supplier will invoice — the lines less the
    // order's discount, subtracted on the server so this figure and the
    // order's own cannot disagree.
    meta: { align: "right", min: 125 },
    cell: ({ row }) => (
      <span className="text-ink font-medium tabular-nums">
        {amount(row.original.net_minor)}
      </span>
    ),
  },
  {
    id: "received",
    header: "Arrived",
    size: 12,
    // Three columns folded into one. Expected, Received and Outstanding were
    // the same fact stated three times, and the form a warehouse says it in is
    // "20/20". The colour carries what Outstanding used to: quiet when the
    // order is complete, amber while anything is owed.
    meta: { align: "right", priority: 1, min: 105 },
    cell: ({ row }) => {
      const got = row.original.received_stock_units
      const due = row.original.expected_stock_units
      return (
        <span
          className={
            got >= due
              ? "text-ink-4 tabular-nums"
              : "text-warn-ink font-medium tabular-nums"
          }
        >
          {count(got)}/{count(due)}
        </span>
      )
    },
  },
  {
    id: "status",
    header: "Status",
    size: 12,
    // Last, at the trailing edge: it is what an order IS, read after what it
    // holds and what it cost, and a row is scanned left to right.
    meta: { min: 120 },
    cell: ({ row }) => (
      <Tag tone={orderStatusTone(row.original.order_status)}>
        {orderStatusLabel(row.original.lifecycle)}
      </Tag>
    ),
  },
]

export function OrdersScreen() {
  const url = useQueryState()
  const typed = url.one("q")
  const status = url.one("status")
  const supplier = url.one("supplier")
  const from = url.one("from")
  const to = url.one("to")
  const openId = url.one("order")
  const panel = url.one("panel")

  // The box waits for a pause. Not politeness toward the server — it is that a
  // list which empties and refills on every letter cannot be read while it is
  // being typed into.
  const q = useDebounced(typed, 250)

  const book = useOrderBook({
    q,
    status,
    supplier,
    issued_from: from,
    issued_to: to,
  })
  const suppliers = useSuppliers()

  const rows = useMemo(() => [...(book.data?.rows ?? [])], [book.data])
  const facets = book.data?.facets
  /// Every order the filters match, which is not the same as every order on
  /// this page. The server counts it; the screen no longer has to say it
  /// cannot be known.
  const total = book.data?.total ?? rows.length

  /// There is another page. The money below is summed from the rows in hand,
  /// so when this is true those sums describe the page rather than the book
  /// and say so.
  const partial = book.data?.next_cursor != null

  /// Whether anything other than the tab is narrowing the book — which decides
  /// whether the facet counts can honestly stand beside a tab. See the note at
  /// the top.
  const narrowed = q !== "" || supplier !== "" || from !== "" || to !== ""

  const names = useMemo(
    () =>
      new Map(
        suppliers.rows.map((one) => [one.supplier_code, one.name] as const),
      ),
    [suppliers.rows],
  )
  const chosen = useMemo(
    () => (supplier === "" ? [] : supplier.split(",")),
    [supplier],
  )

  const counted = new Map(
    facets?.order_status.map((facet) => [facet.value, facet.count]) ?? [],
  )
  const tabs = [
    {
      value: "",
      label: "Every order",
      count: narrowed || facets === undefined ? undefined : rows.length,
    },
    ...ORDER_STATUSES.map((value) => ({
      value,
      label: orderStatusLabel(value),
      count:
        narrowed || facets === undefined ? undefined : (counted.get(value) ?? 0),
    })),
  ]

  /// What the rows on screen add up to.
  ///
  /// Summed in the BROWSER, which is only honest because this request answers
  /// with everything that matched: there is no page here to mistake for the
  /// set. The moment the cap is hit that stops being true, so the figure is
  /// withdrawn rather than quietly becoming a subtotal wearing a total's label.
  const value = rows.reduce((sum, row) => sum + row.net_minor, 0)
  const owed = rows.reduce((sum, row) => sum + row.outstanding_stock_units, 0)

  const clear = () =>
    url.set(
      { q: null, status: null, supplier: null, from: null, to: null },
      false,
    )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHead
        module="Procurement"
        title="Purchase orders"
        description="Every order this business has placed: what it is worth, what has arrived against it, and what is still owed."
        action={
          <LinkButton to="/procurement/compose" variant="primary">
            <FilePlus2 className="size-4" /> New order
          </LinkButton>
        }
      />

      <Tabs
        label="Order status"
        value={status}
        onChange={(value) => url.set({ status: value || null }, false)}
        tabs={tabs}
      />

      {/* An order is a document dated on a day, and this is every document —
          so the scope is a period, not a position. The ordering is stated
          because no column can say it: the endpoint has no sort key. */}
      <ScopeLine
        scope={{ kind: "during", period: "every order on file" }}
        note="newest issued first"
      />

      {partial && <Truncated limit={BOOK_CAP} noun="orders" />}

      <Tiles>
        <Tile
          label="Orders"
          value={book.isPending ? "—" : count(total)}
          note={narrowed || status !== "" ? "matching the filters" : "in the book"}
        />
        <Tile
          label="Value"
          value={
            partial ? (
              <Unanswered why="This is one page of the book, so a sum here would describe the page rather than the orders that matched." />
            ) : (
              value
            )
          }
          note="what the suppliers will invoice"
        />
        <Tile
          label="Units still owed"
          value={
            partial ? (
              <Unanswered why="This is one page of the book, so this would be a subtotal wearing a total's label." />
            ) : (
              count(owed)
            )
          }
          tone={owed > 0 ? "warn" : "ok"}
          note={owed > 0 ? "across every matching order" : "everything has landed"}
        />
        <Tile
          label="Suppliers on the book"
          value={facets === undefined ? "—" : count(facets.supplier.length)}
          note="counted over the whole book"
        />
      </Tiles>

      <Toolbar
        trailing={
          book.isPending ? (
            "Loading…"
          ) : (
            <>
              {count(total)} {total === 1 ? "order" : "orders"} matched
              {partial && <> · {count(rows.length)} shown</>}
            </>
          )
        }
      >
        <SearchField
          value={typed}
          onChange={(value) => url.set({ q: value || null })}
          placeholder="Search a PO number or a supplier"
          className="w-[22rem]"
        />
        <Button
          icon={<SlidersHorizontal className="size-4" />}
          onClick={() => url.set({ panel: panel === "" ? "filter" : null }, false)}
        >
          Filters
          {chosen.length + (from === "" ? 0 : 1) + (to === "" ? 0 : 1) > 0 &&
            ` · ${chosen.length + (from === "" ? 0 : 1) + (to === "" ? 0 : 1)}`}
        </Button>
        {chosen.map((code) => (
          <Tag key={code} tone="blue">
            {names.get(code) ?? code}
          </Tag>
        ))}
      </Toolbar>

      {book.isError ? (
        <Failed
          what="the order book"
          error={book.error}
          onRetry={() => void book.refetch()}
        />
      ) : book.isPending ? (
        <Loading cols={7} />
      ) : rows.length === 0 ? (
        narrowed || status !== "" ? (
          <NoMatch what="orders" onClear={clear} />
        ) : (
          <Empty
            what="purchase orders"
            detail="Nothing has been ordered from anybody yet. An order starts in Sourcing, or from a blank document."
          />
        )
      ) : (
        <Table
          columns={columns}
          rows={rows}
          rowId={(row) => row.purchase_order_id}
          caption="Purchase orders"
          onRowClick={(row) => url.set({ order: row.purchase_order_id }, false)}
          isOpen={(row) => row.purchase_order_id === openId}
          foot={{
            po: (
              <>
                <b className="text-ink">{count(total)}</b>{" "}
                {total === 1 ? "order" : "orders"}
              </>
            ),
            value: partial ? (
              <Unanswered why="This is one page of the book, so this would not be the total." />
            ) : (
              <b className="text-ink">{rp(value)}</b>
            ),
            received: partial ? undefined : `${count(owed)} owed`,
          }}
        />
      )}

      <FilterPanel
        open={panel === "filter"}
        onClose={() => url.set({ panel: null }, false)}
        suppliers={facets?.supplier ?? []}
        names={names}
        chosen={chosen}
        onSupplier={(next) =>
          url.set({ supplier: next.length === 0 ? null : next.join(",") }, false)
        }
        from={from}
        to={to}
        onDates={(next) =>
          url.set({ from: next.from || null, to: next.to || null }, false)
        }
      />

      <OrderSheet id={openId} onClose={() => url.set({ order: null }, false)} />
    </div>
  )
}

/// Which suppliers, and between which two days.
///
/// A panel rather than chips in the toolbar, because there are eighteen
/// suppliers on this book and a chip row that long is a second table above the
/// table. The counts beside each are the server's, over the whole book — see
/// the note at the top of this file for why that is the right number HERE and
/// the wrong one beside a tab.
function FilterPanel({
  open,
  onClose,
  suppliers,
  names,
  chosen,
  onSupplier,
  from,
  to,
  onDates,
}: {
  open: boolean
  onClose: () => void
  suppliers: readonly { value: string; count: number }[]
  names: Map<string, string>
  chosen: readonly string[]
  onSupplier: (next: readonly string[]) => void
  from: string
  to: string
  onDates: (next: { from: string; to: string }) => void
}) {
  const ordered = [...suppliers].sort((a, b) => b.count - a.count)
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Narrow the book"
      subtitle="Counted over every order ever raised, not over what is on screen."
      foot={
        <Button
          onClick={() => {
            onSupplier([])
            onDates({ from: "", to: "" })
          }}
        >
          Clear these
        </Button>
      }
    >
      <SubHead trailing={`${ordered.length}`}>Supplier</SubHead>
      <div className="px-2 py-1.5">
        {ordered.map((facet) => (
          <CheckRow
            key={facet.value}
            checked={chosen.includes(facet.value)}
            onChange={(on) =>
              onSupplier(
                on
                  ? [...chosen, facet.value]
                  : chosen.filter((each) => each !== facet.value),
              )
            }
            // The picker offers a NAME where the request carries a CODE. The
            // facet arrives as `SUP12` because that is the column a purchase
            // order holds; a list built from a supplier's uuid would have
            // matched nothing, quietly, on every supplier.
            label={names.get(facet.value) ?? facet.value}
            count={facet.count}
          />
        ))}
      </div>

      <SubHead>Issued between</SubHead>
      <div className="flex items-center gap-2 px-[18px] py-3">
        {/* Two dates rather than one range control: they land on two request
            parameters and AND on the server exactly as they read. The
            server's upper bound is inclusive of the whole day. */}
        <input
          type="date"
          value={from}
          onChange={(event) => onDates({ from: event.target.value, to })}
          aria-label="Issued from"
          className="h-ctl rounded-ctl border-line-2 bg-canvas shadow-btn text-ctl text-ink focus:border-blue min-w-0 flex-1 border px-2.5 outline-none"
        />
        <span className="text-ctl text-ink-4">to</span>
        <input
          type="date"
          value={to}
          onChange={(event) => onDates({ from, to: event.target.value })}
          aria-label="Issued to"
          className="h-ctl rounded-ctl border-line-2 bg-canvas shadow-btn text-ctl text-ink focus:border-blue min-w-0 flex-1 border px-2.5 outline-none"
        />
      </div>
    </Sheet>
  )
}

/// One order, whole.
///
/// It fetches its own read rather than being handed the row behind it: the list
/// carries a summary, the lines are only wanted once somebody asks for one
/// order, and a URL naming an order the list is not holding — a link in a
/// message, a receipt from the composer, a bookmark — opens the record all the
/// same.
///
/// **Payable is not drawn beside the value.** It is what the DELIVERIES have
/// earned — received times price — so an order that has not been received yet
/// reads "Rp 0" beside lines that plainly come to millions, and every reader
/// takes it for a broken figure rather than an answer to a question they did
/// not ask. It is stated once, in the facts, with the word that explains it.
export function OrderSheet({
  id,
  onClose,
}: {
  id: string
  onClose: () => void
}) {
  const record = useOrder(id)
  const order = record.data

  return (
    <Sheet
      open={id !== ""}
      onClose={onClose}
      width="record"
      title={order?.supplier_name ?? order?.supplier_id ?? "Purchase order"}
      subtitle={order ? order.po_number : "Reading the order…"}
    >
      {record.isError ? (
        <Failed
          what="this order"
          error={record.error}
          onRetry={() => void record.refetch()}
        />
      ) : order === undefined ? (
        <Loading rows={5} cols={2} />
      ) : (
        <>
          <Facts>
            <Fact label="Status">
              <Tag tone={orderStatusTone(order.order_status)}>
                {orderStatusLabel(order.lifecycle)}
              </Tag>
            </Fact>
            <Fact label="Goes to">{order.destination_site_id}</Fact>
            <Fact label="Issued">
              {order.issued_at === null ? (
                <Quiet>not issued</Quiet>
              ) : (
                day(order.issued_at)
              )}
            </Fact>
            <Fact label="Expected arrival">
              {order.expected_arrival === null ? (
                <Quiet>nobody promised a date</Quiet>
              ) : (
                day(order.expected_arrival)
              )}
            </Fact>
            <Fact label="Raised by">{order.created_by}</Fact>
            <Fact label="Raised from">
              {/* `SOURCING` means it came off a supplier's catalogue and every
                  line points at a supplier item; `DIRECT` means it was written
                  line by line. It decides whether a price on this order can be
                  compared with a catalogue at all. */}
              {order.origin_kind}
            </Fact>
            <Fact label="Earned by deliveries" wide>
              {/* Not what the order is worth. What has actually been received,
                  times what it was priced at — the figure a supplier can bill
                  against today. */}
              <Money minor={order.expected_value_minor} /> of{" "}
              {amount(order.net_minor)}
            </Fact>
          </Facts>

          <SubHead trailing={`${count(order.lines.length)} lines`}>
            What was ordered
          </SubHead>
          {order.lines.map((line) => (
            <Line key={line.po_line_id} line={line} />
          ))}

          <div className="px-[18px] py-4">
            <Ladder
              className="ml-auto max-w-[24rem]"
              rows={[
                {
                  label: "Lines",
                  value: amount(order.gross_minor),
                },
                {
                  label: "Discount on the order",
                  value:
                    order.discount_minor === 0
                      ? "—"
                      : `− ${amount(order.discount_minor)}`,
                },
              ]}
              total={{
                label: "The supplier will invoice",
                value: rp(order.net_minor),
              }}
            />
          </div>
        </>
      )}
    </Sheet>
  )
}

/// One line of an order, drawn the way the composer drew it when it was written.
///
/// The photograph, the name, what it is filed under and what it is tagged with
/// — those four are how anybody recognises a garment, and an eleven-digit
/// article code identifies the row to the database and to nobody else.
function Line({ line }: { line: PurchaseOrderLine }) {
  return (
    <div className="border-line flex items-start gap-3 border-b px-[18px] py-2.5">
      <Thumb url={line.image_url} alt={line.article_name} className="size-10" />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-cell text-ink truncate">{line.article_name}</span>
        <span className="text-label text-ink-4 truncate font-mono">
          {line.article_code}
        </span>
        {line.closed_short_units !== null && (
          <span className="text-label text-warn-ink">
            Closed {count(line.closed_short_units)} short by{" "}
            {line.closed_short_by} — {line.closed_short_reason}
          </span>
        )}
      </span>
      <span className="text-ctl text-ink-3 shrink-0 text-right tabular-nums">
        {count(line.received_quantity)} of {count(line.expected_stock_units)}
        <span className="text-label text-ink-4 block">
          at {amount(line.unit_price_minor)}
        </span>
      </span>
      <span className="text-cell text-ink w-24 shrink-0 text-right font-medium tabular-nums">
        {amount(line.ordered_value_minor)}
      </span>
    </div>
  )
}
