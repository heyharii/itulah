import { useQuery } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { ListChecks, Search } from "lucide-react"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import {
  ColumnsMenu,
  DockedFilters,
  QuickFilters,
  SortMenu,
  ViewPicker,
} from "@/components/ui/list-chrome"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { Section, TotalsLadder } from "@/components/ui/rows"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { EmptyState } from "@/components/ui/states"
import { Thumbnail } from "@/components/ui/thumbnail"
import { useFilterState, type FilterField } from "@/lib/filters"
import { count, day, label, money, toneFor } from "@/lib/format"
import {
  listSuppliers,
  orderScopeFromFilters,
  procurementKeys,
  purchaseOrderDetail,
  purchaseOrderPage,
  // Both hand-written beside their fetchers rather than generated, and
  // `PurchaseOrderPage` deliberately the local one: `@itulah/contract` exports
  // a type of the same name that this endpoint does not answer with.
  type PurchaseOrderDetail,
  type PurchaseOrderPage,
  type PurchaseOrderRow,
  type PurchaseOrderScope,
} from "@/lib/queries/procurement"
import { OrderComposer } from "@/screens/procurement/composer"
import { GRID_CELL, GRID_HEAD } from "@/screens/procurement/shared"
import { LinkButton } from "@/screens/procurement/controls"
import { queryState } from "@/lib/query-state"
import { useSheet } from "@/lib/sheets"
import { tableSetup, type TableSetup } from "@/lib/table"
import { toast } from "@/lib/toast"
import { useDebounced } from "@/lib/use-debounced"

/// Purchase orders — the reference screen for this app.
///
/// Every other list is written the same way, so it is worth naming the parts:
///
///  1. One `useQuery` per read, keyed from `lib/queries/<domain>.ts`.
///  2. Columns declared outside the component (they never close over props),
///     built with `createColumnHelper` so the accessor and the cell agree.
///  3. `useTable` with the shared `tableSetup` — never a bespoke feature set.
///  4. `<DataTable>` for the grammar, and it virtualises itself past 150 rows.
///  5. Selection opens the floating `<Sheet>`; the list keeps its scroll.
///  6. `queryState` renders pending / error / data, so no screen invents its
///     own spinner or its own error sentence.
///  7. `useFilterState(fields)` reads the clauses out of the URL. The panel at
///     the right sets them and a plain box searches; The clauses are turned into REQUEST PARAMETERS — see
///     `orderScopeFromFilters` — and the endpoint answers a narrowed list;
///     nothing is filtered in the browser. That is why the fields are declared
///     here rather than as `meta.filter` on the columns: what may be asked is
///     decided by what the SQL can answer, not by what a column happens to
///     hold, and an operator the request cannot carry is a chip that silently
///     narrows nothing. A short list a browser can hold — `destinations.tsx`
///     next door — still uses `useFilters(columns)` and `<FilterBar>`; the
///     order book is a year of the company's purchasing and cannot.
///  8. `meta.card` and `meta.priority` on the same columns, which is the whole
///     of what this screen does to work on an iPad and a phone: what each
///     column becomes when the rows are relaid as cards, and what to drop
///     first when the table is wider than the glass. There is no second screen
///     and no second component — see `<DataTable>` for the three shapes those
///     two declarations buy.
///
/// The columns are the point, not the decoration. DESIGN.md is explicit that a
/// list exists to decide and to compare rows, so what is here is the document
/// a buyer compares — what it is worth, how much of it there is, when it was
/// promised and how much of it has landed — and not the supplier's address,
/// the internal id, or the DC a command was routed to. Those are one click
/// away in the sheet, which is where Destination went: nearly every order goes
/// to the one DC, and a column that says the same word on every row is not a
/// column, it is a caption.

/// What a status may be, before the server has said how many of each there
/// are. Once its counts arrive they decide the list — counted over the whole
/// book, not over the page, so a status is offered when the company has ever
/// used it and not merely when it survived the current filters.
/// Where an order STANDS, which is what the server now counts the status facet
/// by. Not the stored `order_status`: that column only ever reads ISSUED or
/// CLOSED, so an order that had arrived in full still showed as issued, and it
/// offered DRAFT and CANCELLED — two states nothing in the system can produce.
const STATUSES = [
  "ACTIVE",
  "PARTIALLY_RECEIVED",
  "FULLY_RECEIVED",
  "CLOSED",
] as const

const columns: ColumnDef<TableSetup, PurchaseOrderRow>[] = [
  {
    id: "supplier",
    accessorFn: (row) => row.supplier_name ?? row.supplier_id,
    header: "Supplier",
    size: 240,
    // Who the order is with names the row: the PO number identifies it, the
    // supplier is what somebody is looking for.
    meta: { card: "title" },
    cell: ({ row }) => (
      <span className="font-medium text-ink">
        {row.original.supplier_name ?? row.original.supplier_id}
      </span>
    ),
  },
  {
    accessorKey: "po_number",
    header: "Order",
    size: 150,
    meta: { card: "id" },
    cell: ({ row }) => (
      <span className="font-mono text-id text-body">
        {row.original.po_number}
      </span>
    ),
  },
  {
    accessorKey: "expected_arrival",
    header: "Expected delivery",
    size: 150,
    // The date the whole of Outstanding is measured against, and until now the
    // only screen that showed it was the one you had to open an order to
    // reach. A buyer chasing a supplier is reading this column.
    meta: { card: "meta", priority: 2 },
    cell: ({ row }) => (
      <span className="tabular-nums">{day(row.original.expected_arrival)}</span>
    ),
  },
  {
    accessorKey: "expected_stock_units",
    header: "Ordered",
    size: 108,
    // Pieces, which is what the receiving bar beside it is a share OF. The
    // line count moved to the record, where the document's own size belongs.
    // Priority 1: it is the denominator of the bar beside it, and a share with
    // no total under it is a percentage of nothing anybody can check. It was
    // the line count that used to sit here at priority 3, and that one could
    // go — how many lines a document has is a fact for the document.
    meta: { align: "right", card: "metric" },
    // Pieces over lines: the bar beside it is a share of the pieces, and how
    // many DIFFERENT things were ordered is the other half of what "how big is
    // this order" means. Two facts, one column, because they are never read
    // apart — 240 pcs on one line is a very different order from 240 across
    // forty.
    cell: ({ row }) => (
      <span
        className="flex flex-col items-end leading-tight"
        title={`${count(row.original.expected_stock_units)} pieces across ${count(row.original.line_count)} lines`}
      >
        {count(row.original.expected_stock_units)}
        <span className="text-[0.6875rem] text-mute">
          {count(row.original.line_count)}
          {row.original.line_count === 1 ? " item" : " items"}
        </span>
      </span>
    ),
  },
  {
    accessorKey: "net_minor",
    header: "Net value",
    size: 140,
    // What the supplier will invoice — the lines less the order's discount,
    // subtracted on the server so this figure and the order's own agree.
    meta: { align: "right", card: "metric", priority: 1 },
    cell: ({ row }) => (
      <span className="font-medium text-ink">
        {money(row.original.net_minor)}
      </span>
    ),
  },
  {
    id: "received",
    // Sorted by what is STILL OWED, not by what has landed: clicking this
    // column means "who is behind", and ranking by received units puts the
    // biggest order on top whether or not anybody is waiting for it.
    accessorFn: (row) => row.outstanding_stock_units,
    header: "Receiving",
    size: 128,
    // Three columns became one, and then the one became a bar. Expected,
    // Received and Outstanding were the same fact stated three times; "20/20"
    // said it once; a bar says it in a shape the eye reads down forty rows
    // without doing arithmetic on any of them. The exact pair is still there,
    // on the title, for the reader who wants the numbers.
    meta: { card: "metric", priority: 1 },
    cell: ({ row }) => {
      const got = row.original.received_stock_units
      const due = row.original.expected_stock_units
      const pct = due > 0 ? Math.min(100, (got / due) * 100) : 0
      return (
        <span
          className="flex items-center gap-2"
          title={`${count(got)} of ${count(due)} received`}
        >
          {/* `min-w-14` so the bar survives the card layout, where the cell
              is laid out by its own content rather than by a column width. */}
          <span className="h-2 min-w-14 flex-1 overflow-hidden rounded-full bg-soft-2">
            <span
              className="block h-full rounded-full bg-[color-mix(in_srgb,var(--accent)_62%,white)]"
              style={{ width: `${pct}%` }}
            />
          </span>
          <span className="w-8 shrink-0 text-right text-[0.6875rem] text-mute tabular-nums">
            {Math.round(pct)}%
          </span>
        </span>
      )
    },
  },
  {
    accessorKey: "lifecycle",
    header: "Status",
    size: 130,
    // Last, at the trailing edge: it is what an order IS, read after what it
    // holds and what it cost, and a row is scanned left to right.
    //
    // `swap`: and what it is waiting for, which is the same question answered
    // forward. The pill stands while the list is read; the row under the
    // pointer offers the verb in its place. See `DataTable.rowAction`.
    meta: { card: "status", swap: true },
    cell: ({ row }) => (
      <Pill tone={toneFor(row.original.lifecycle)}>
        {label(row.original.lifecycle)}
      </Pill>
    ),
  },
]

export function PurchaseOrders() {
  // Which order is open lives in the URL (`?order=…`), not in state beside the
  // table. A sheet in `useState` cannot be linked to, does not survive the
  // reload a browser gets every morning, and cannot be opened by the command
  // palette or a notification — all three of which want to.
  const order = useSheet("order")
  /// A blank order being written. In the URL like every other sheet, so a
  /// half-typed order survives a reload.
  const composer = useSheet("new-order")
  /// What was typed into the omnibox, also in the URL: a narrowed list is a
  /// thing people send each other.
  const search = useSheet("q")
  const navigate = useNavigate()
  // Newest first, which is what the server already sorted by — so the first
  // screenful is the orders somebody raised this week.
  const [sorting, setSorting] = useState<SortingState>([
    { id: "issued_at", desc: true },
  ])

  /// The suppliers, for the filter's own picker. Small, cached by every other
  /// procurement screen, and the reason the chip can offer a NAME where the
  /// request carries a code.
  const suppliers = useQuery({
    queryKey: procurementKeys.suppliers(),
    queryFn: ({ signal }) => listSuppliers(undefined, signal),
    staleTime: 5 * 60 * 1000,
  })

  /// The columns this list can be narrowed by, and the only ones: each maps to
  /// a parameter the endpoint answers, and the operators are cut to what it
  /// can honour. An operator the request cannot carry is a chip that silently
  /// narrows nothing.
  ///
  /// `counted` is the server's own tally over the whole book. Without it the
  /// picker asks the TABLE how many rows hold each value, and this table holds
  /// only what the same filters already let through — so every option nobody
  /// had ticked printed a 0 beside it, which reads as a book with nothing in
  /// it.
  const fields = useMemo<FilterField[]>(
    () => [
      {
        column: "supplier",
        label: "Supplier",
        spec: {
          kind: "option",
          single: true,
          operators: ["isAnyOf"],
          // `supplier_code`, NOT `supplier_id`. A supplier row's
          // `supplier_id` is a uuid; the column a purchase order carries
          // under that same name is the CODE — `SUP12` — and it is what the
          // request compares against. An option list built from the uuid
          // would have filtered to nothing, quietly, on every supplier.
          options: (suppliers.data ?? []).map((one) => ({
            value: one.supplier_code,
            label: one.name,
          })),
          // The picker offers a NAME where the request carries a code — for
          // the counted list as well, which arrives as bare codes.
          format: (code) =>
            (suppliers.data ?? []).find((one) => one.supplier_code === code)
              ?.name ?? code,
        },
      },
      {
        column: "lifecycle",
        label: "Status",
        spec: {
          kind: "option",
          single: true,
          operators: ["isAnyOf"],
          // The picker shows the sentence, not the code: a buyer excluding
          // cancelled orders is looking for "Cancelled", not `CANCELLED`.
          options: STATUSES.map((code) => ({
            value: code,
            label: label(code),
          })),
          format: label,
        },
      },
      {
        column: "issued_at",
        label: "Issued",
        // Two clauses rather than one "is between": they land on two different
        // request parameters and AND on the server exactly as the chips
        // promise.
        spec: { kind: "date", operators: ["gte", "lte"] },
      },
    ],
    [suppliers.data]
  )

  const filters = useFilterState(fields)

  /// What was typed, plus the chips, as the one request that answers both.
  ///
  /// Debounced, because every keystroke is a round trip to a SQL query over
  /// the whole company's purchasing. Four hundred milliseconds is long enough
  /// that typing a PO number asks once instead of fourteen times, and short
  /// enough that the box still feels like it is listening.
  const typed = (search.value ?? "").trim()
  const needle = useDebounced(typed, 400)
  const scope = useMemo<PurchaseOrderScope>(
    () => ({
      ...orderScopeFromFilters(filters.filters),
      ...(needle === "" ? {} : { q: needle }),
    }),
    [filters.filters, needle]
  )
  /// Whether anything is narrowing the list, which is a different question
  /// from whether the list is empty: "there are none" and "none match what you
  /// asked for" have different fixes.
  const narrowed = needle !== "" || filters.filters.length > 0

  const orders = useQuery({
    queryKey: procurementKeys.orders(scope),
    queryFn: ({ signal }) => purchaseOrderPage(scope, signal),
    // The previous answer stays on screen while the next is fetched. Without
    // it every keystroke empties the table to a loading line and the screen
    // flashes its way through a word.
    placeholderData: (previous) => previous,
  })

  const rows = useMemo(() => orders.data?.rows ?? [], [orders.data])

  /// The same fields, carrying the server's tally.
  ///
  /// Built here and not above because the counts come from the answer and the
  /// question is built from the fields — declaring them together would be a
  /// circle. The bar is the only thing that needs them, so the bar is the only
  /// thing that gets them; `useFilterState` reads clauses out of the URL and
  /// does not care how many rows an option holds.
  ///
  /// Without this the picker asks the TABLE how many rows hold each value, and
  /// this table holds only what the same filters already let through — so
  /// every option nobody had ticked printed a 0 beside it, which reads as a
  /// book with nothing in it.
  const counted = useMemo<FilterField[]>(() => {
    const facets = orders.data?.facets
    if (facets === undefined) return fields
    return fields.map((field) =>
      field.column === "lifecycle"
        ? { ...field, spec: { ...field.spec, counted: facets.order_status } }
        : field.column === "supplier"
          ? { ...field, spec: { ...field.spec, counted: facets.supplier } }
          : field
    )
  }, [fields, orders.data])

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns,
        getRowId: (row: PurchaseOrderRow) => row.purchase_order_id,
        state: { sorting },
        onSortingChange: setSorting,
      }),
      [rows, sorting]
    )
  )

  return (
    <PageContent>
      <PageHeader
        title="Purchase orders"
        sub="What has been ordered, what has arrived, and what is still owed."
      />

      <OrderComposer
        open={composer.value === true}
        onClose={composer.close}
        onRaised={(raised) => {
          // The receipt is a receipt: said once, in the corner, and gone. It
          // used to be a banner pinned over the table — furniture nobody
          // dismissed — and it announced the DC the command reached, which is
          // plumbing. What a buyer wants to know is that the order exists.
          toast.success(`${raised.po_number} issued`, {
            description: money(raised.net_minor),
          })
          // One navigation, not two. Closing the composer and opening the
          // order as separate calls both read the search that is on screen
          // NOW, so whichever landed second would put the other's parameter
          // back — and the sheet would open with the composer still over it.
          void navigate({
            to: ".",
            search: (prev: Record<string, unknown>) => ({
              ...prev,
              "new-order": undefined,
              order: raised.purchase_order_id,
            }),
            viewTransition: false,
          })
        }}
      />

      {/* One box for both questions, sitting on top of what it narrows.

          Search used to be a 12rem input in the page header's top-right
          corner — as far from the table as the layout allowed, and small
          enough to read as a minor control, when it is the fastest way to one
          order out of a year of them. Filtering and searching are also one
          thought: "berkah, issued, since August" is a sentence somebody says
          in one breath, and splitting it across two controls in two corners
          makes them say it twice.

          Both go to the SERVER. The book is the whole company's purchasing;
          narrowing it after it arrives has already paid for all of it. */}
      <div className="grid min-w-0 items-start gap-5 min-[1440px]:grid-cols-[minmax(0,1fr)_16rem]">
        <div className="flex min-w-0 flex-col">
          {/* The count, and which columns the table is carrying. The prototype puts
          both on the line above the rows, where what they act on is visible. */}

          {/* One line, the width of the table, carrying everything that acts on
          it: what narrows it at the left, what orders and shapes it in the
          middle, and what creates a new one at the right. The page header
          above keeps the title and nothing else — its actions used to stand
          over the filter panel, which is not what they act on. */}
          <div className="mb-3 flex flex-wrap items-center gap-1.5">
            <span className="relative mr-auto">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-line-ico" />
              <input
                value={search.value ?? ""}
                onChange={(event) =>
                  event.target.value
                    ? search.open(event.target.value)
                    : search.close()
                }
                placeholder="Search orders"
                aria-label="Search orders"
                className="h-[2.125rem] w-56 rounded-inner border border-hairline-2 bg-canvas pr-2.5 pl-8 text-[0.8125rem] text-ink shadow-soft outline-none placeholder:text-body focus:border-accent"
              />
            </span>
            <SortMenu
              table={table}
              sorting={sorting}
              onSort={(id, desc) => setSorting([{ id, desc }])}
            />
            <ColumnsMenu table={table} />
            <span aria-hidden className="mx-1 h-5 w-px bg-hairline" />
            <ViewPicker model={filters} />
            <Button variant="primary" onClick={() => composer.open(true)}>
              New order
            </Button>
          </div>

          {/* The panel docks where there is room for it — the table measures
          1034px with its eight columns, the panel 256, and 1440 is the width
          that holds both without the list giving up a column. Narrower than
          that it is the Filter button in the omnibox above, which is the same
          model drawn as a sheet. */}
          <Card className="overflow-hidden">
            {queryState(orders, {
              loading: "Loading the orders…",
              render: (page) =>
                page.rows.length === 0 ? (
                  narrowed ? (
                    <EmptyState>No order matches these filters.</EmptyState>
                  ) : (
                    <EmptyState>
                      No purchase order has been raised yet.
                    </EmptyState>
                  )
                ) : (
                  <DataTable<PurchaseOrderRow>
                    table={table}
                    onRowClick={(row) => order.open(row.purchase_order_id)}
                    isSelected={(row) => row.purchase_order_id === order.value}
                    // The verb an open order is waiting for. It opens the record
                    // rather than receiving in place: receiving is counting goods
                    // against lines, which is a screen, not a button. What this
                    // saves is the guess about WHICH order is waiting — the row
                    // says so itself.
                    rowAction={(row) =>
                      row.lifecycle === "ACTIVE" ||
                      row.lifecycle === "PARTIALLY_RECEIVED" ? (
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation()
                            order.open(row.purchase_order_id)
                          }}
                          className="inline-flex h-7 items-center rounded-inner border border-hairline-2 bg-canvas px-2.5 text-[0.75rem] font-medium text-ink shadow-soft transition-colors hover:bg-soft-2"
                        >
                          Receive
                        </button>
                      ) : null
                    }
                    className="max-h-[calc(100vh-14rem)]"
                  />
                ),
            })}
          </Card>
        </div>

        <DockedFilters
          model={{ ...filters, fields: counted }}
          kpis={bookKpis(orders.data)}
          className="hidden min-[1440px]:flex"
        />
      </div>

      <OrderSheet id={order.value ?? null} onClose={order.close} />
      {/* Mounted here rather than behind the trigger, because two of its three
          sheets are opened by URL from elsewhere: `?setup=<id>` is the link an
          article's detail follows back to the delivery that minted it. A sheet
          that only exists while its button has been pressed is a link that
          works for the person who clicked it and nobody else. */}
    </PageContent>
  )
}
/// Four figures about the book as it currently stands.
///
/// `total` is the server's own count over everything the search and the chips
/// match, so it is true whatever the page holds. The three sums are not: they
/// are added up over the rows in hand, and a book that runs past one page has
/// more of them. Rather than print a confident wrong total, a partial page
/// says `of {n} shown` under the figure — the number is still useful, and the
/// reader is told what it covers.
/// `49.923.900.000` → `Rp 49,9 M`. Indonesian scale: ribu, juta, miliar.
function brief(minor: number): string {
  const abs = Math.abs(minor)
  const [scale, suffix] =
    abs >= 1_000_000_000
      ? [1_000_000_000, " M"]
      : abs >= 1_000_000
        ? [1_000_000, " jt"]
        : abs >= 1_000
          ? [1_000, " rb"]
          : [1, ""]
  const scaled = minor / scale
  const shown =
    scale === 1 ? String(minor) : scaled.toFixed(scaled < 10 ? 1 : 0)
  return `Rp ${shown.replace(".", ",")}${suffix}`
}

function bookKpis(page: PurchaseOrderPage | undefined) {
  if (page === undefined) return undefined
  const rows = page.rows
  const whole = page.next_cursor === null
  const note = whole
    ? undefined
    : `Over the ${count(rows.length)} orders loaded, of ${count(page.total)}`
  const open = rows.filter(
    (row) =>
      row.lifecycle === "ACTIVE" || row.lifecycle === "PARTIALLY_RECEIVED"
  )
  const value = open.reduce((sum, row) => sum + row.net_minor, 0)
  const today = new Date().toISOString().slice(0, 10)
  const late = rows.filter(
    (row) =>
      row.expected_arrival !== null &&
      row.expected_arrival < today &&
      row.outstanding_stock_units > 0
  ).length
  // An order with no promised date cannot be late, and saying "0 overdue"
  // while twenty-one of twenty-three carry no date at all is a true number
  // that reads as an all-clear. The tile says how many it could not judge.
  const undated = rows.filter(
    (row) => row.expected_arrival === null && row.outstanding_stock_units > 0
  ).length
  return [
    { label: "Orders", value: count(page.total) },
    { label: "Still open", value: count(open.length), note },
    {
      label: "Overdue",
      value: count(late),
      note:
        undated === 0
          ? note
          : `${count(undated)} open orders carry no promised date, so they cannot be judged late${note === undefined ? "" : ` · ${note}`}`,
    },
    // Short, because a tile two columns wide cannot hold "Rp 49.923.900.000"
    // and a truncated figure is worse than a rounded one. The exact number is
    // on the title, where a hover finds it.
    {
      label: "On order",
      value: brief(value),
      note: `${money(value)}${note === undefined ? "" : ` · ${note}`}`,
    },
  ]
}

/// The record detail. It fetches its own read rather than being handed the row:
/// the list carries a summary, and the lines are only wanted once somebody
/// asks for one order.
function OrderSheet({
  id,
  onClose,
}: {
  id: string | null
  onClose: () => void
}) {
  const detail = useQuery({
    queryKey: procurementKeys.order(id ?? ""),
    queryFn: ({ signal }) => purchaseOrderDetail(id!, signal),
    enabled: id !== null,
  })

  return (
    <Sheet
      open={id !== null}
      subject={id === null ? undefined : { kind: "purchase_order", id }}
      onOpenChange={(open) => !open && onClose()}
      // The PO number IS the title. The supplier was, and it is already the
      // first fact in the body — so the head named the order after something
      // the document repeats two lines later, and the one string that
      // identifies it to everybody (the warehouse, the supplier, Finance) was
      // set in 12px mono above it.
      title={detail.data?.po_number ?? "Order"}
      caption={
        detail.data &&
        `Raised by ${detail.data.created_by} \u00b7 ${day(detail.data.issued_at)}`
      }
      badge={
        detail.data && (
          <Pill tone={toneFor(detail.data.lifecycle)}>
            {label(detail.data.lifecycle)}
          </Pill>
        )
      }
      // Wider than a rail, because an order is a DOCUMENT rather than a
      // record: six columns of lines — what, when it is due, at what price,
      // how many ordered, how many arrived, what that came to — do not fit in
      // 27.5rem, and the two that were dropped to make them fit are the two a
      // buyer opens this to check.
      //
      // `md:` for the reason the composer's note gives: a bare `w-*` loses to
      // the rail's own `md:w-[27.5rem]` everywhere but a phone.
      width="wide"
      className="md:w-[58rem]"
    >
      {queryState(detail, {
        loading: "Loading the order…",
        render: (order) => <OrderDocument order={order} />,
      })}
    </Sheet>
  )
}

/// The order as the review draws it, because it is the same document.
///
/// The composer shows this shape before the order exists; this shows it
/// afterwards. They were two different screens about one piece of paper —
/// different tables, different facts, a status chip floating in the body of
/// one and not the other — so what somebody approved did not look like what
/// they came back to. This one now follows the review: the same two facts, the
/// same ruled grid, the same three-row ladder.
///
/// What the review has and this cannot: payment terms. `purchase_order` does
/// not store them, so there is no section to draw — an empty "Not agreed / no
/// schedule" block would be this screen inventing a fact.
function OrderDocument({ order }: { order: PurchaseOrderDetail }) {
  return (
    <div className="flex flex-col gap-5">
      {/* Payable is not here. It is what the DELIVERIES have earned —
          received times price — so an order that has not been received yet
          reads "Rp 0" beside lines that plainly come to millions, and every
          reader takes it for a broken figure rather than an answer to a
          question they did not ask. What the order is worth is stated once,
          at the bottom, where an invoice states it. */}
      <Facts>
        <Fact term="Supplier">{order.supplier_name ?? order.supplier_id}</Fact>
        <Fact term="Expected arrival">
          {order.expected_arrival === null
            ? "Not promised"
            : day(order.expected_arrival)}
        </Fact>
      </Facts>

      <Section title={`Lines (${order.lines.length})`} rule={false}>
        {/* The review's grid, from the review's two classes — see
            `shared.ts`. A line shows what the composer showed when it was
            written: the photograph, the name, and what it is filed under.
            Those are how anybody recognises a garment, and this sheet used to
            show a name and an eleven-digit article code — a number that
            identifies the row to the database and to nobody else.

            No Received column yet, on the owner's instruction: what has
            arrived is its own question and gets its own answer later. */}
        <div className="overflow-hidden rounded-inner border border-hairline">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] table-fixed border-collapse text-[0.875rem]">
              <colgroup>
                <col />
                <col className="w-[5.5rem]" />
                <col className="w-[9rem]" />
                <col className="w-[9.5rem]" />
              </colgroup>
              <thead>
                <tr>
                  <th className={GRID_HEAD}>Item</th>
                  <th className={`${GRID_HEAD} text-right`}>Qty</th>
                  <th className={`${GRID_HEAD} text-right`}>Price</th>
                  <th className={`${GRID_HEAD} text-right`}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {order.lines.map((line) => (
                  <tr key={line.po_line_id}>
                    <td className={GRID_CELL}>
                      <div className="flex items-center gap-2.5">
                        <Thumbnail
                          url={line.image_url}
                          fallback="—"
                          className="size-9 shrink-0 rounded-inner"
                        />
                        <div className="min-w-0">
                          <div className="truncate text-ink">
                            {line.article_name}
                          </div>
                          <div className="truncate text-[0.75rem] text-body">
                            {[
                              line.division_code === null
                                ? "Unclassified"
                                : label(line.division_code),
                              ...line.tags.map((tag) => label(tag)),
                            ].join(" \u00b7 ")}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td
                      className={`${GRID_CELL} text-right whitespace-nowrap tabular-nums`}
                    >
                      {count(line.ordered_quantity)}
                    </td>
                    <td
                      className={`${GRID_CELL} text-right whitespace-nowrap tabular-nums`}
                    >
                      {money(line.unit_price_minor)}
                    </td>
                    <td
                      className={`${GRID_CELL} text-right font-medium whitespace-nowrap text-ink tabular-nums`}
                    >
                      {money(line.ordered_value_minor)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* The review's three rows and no more. The piece counts that used to
            open this ladder — ordered, still owed — are a different question
            from what the supplier will invoice, and stacking five rows under
            a four-column table made the one figure that closes the document
            the fifth thing read. What is still owed has a column on the list
            and a screen of its own. */}
        <TotalsLadder
          className="ml-auto w-full max-w-[26rem]"
          rows={[
            { label: "Lines", value: money(order.gross_minor) },
            {
              label: "Discount",
              value:
                order.discount_minor === 0
                  ? "—"
                  : `\u2212 ${money(order.discount_minor)}`,
            },
          ]}
          total={{
            label: "The supplier will invoice",
            value: money(order.net_minor),
          }}
        />
      </Section>

      {/* `?.` rather than a null check: the detail's `notes` is absent, not
          null, when there are none — and a screen that assumed the shape it
          wished for took the whole sheet down with it. */}
      {/* Payment terms, in the review's place and the review's shape, with
          nothing in it.

          `purchase_order` has fourteen columns and not one of them is a
          payment term — no migration in the repo mentions one — so what the
          composer collects is read on the review and then dropped by Create.
          The section is drawn now, ahead of the storage, on the owner's
          instruction: the layout is agreed here and the backend is planned
          next, and a slot that already exists is a smaller change to fill
          than one that has to be designed twice.

          What it does NOT say is "Not agreed". That is a claim about what the
          buyer and the supplier settled, and this screen has no standing to
          make it — the terms may well have been agreed on the phone and
          thrown away by us. It says the order does not carry them, which is
          the only thing known here. */}
      <Section title="Payment terms">
        {/* No Method or Pay-into facts. A method belongs to an instalment, not
            to the order — the composer's schedule table carries one per row —
            and the account paid into is a fact of the payment. Two facts
            reading "—" on every order would be stating the absence of things
            that were never the order's to hold. */}
        <p className="text-meta text-mute">
          This order does not carry payment terms: they are agreed when it is
          raised but not yet stored against it.
        </p>
      </Section>

      {/* No Notes section. `purchase_order.notes` is a real column and Create
          writes it, but `purchase_order_detail` answers `Json<Value>` built by
          `purchase_order_status`, and that shape has no `notes` in it — which
          is why the guard here was reading `undefined` rather than a string.
          Drawing an empty section for a field the read never returns would be
          this screen pretending the order has nothing written on it. Restore
          it the day the endpoint carries the field. */}
    </div>
  )
}
