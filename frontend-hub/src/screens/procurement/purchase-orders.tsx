import { useQuery } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { FilterOmnibox } from "@/components/ui/filter-omnibox"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { TotalsLadder } from "@/components/ui/rows"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { EmptyState } from "@/components/ui/states"
import { Tag } from "@/components/ui/tag"
import { Thumbnail } from "@/components/ui/thumbnail"
import { useFilterState, type FilterField } from "@/lib/filters"
import { count, day, label, money, toneFor } from "@/lib/format"
import {
  listSuppliers,
  orderScopeFromFilters,
  procurementKeys,
  purchaseOrderDetail,
  purchaseOrderPage,
  type PurchaseOrderRow,
  type PurchaseOrderScope,
} from "@/lib/queries/procurement"
import { OrderComposer } from "@/screens/procurement/composer"
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
///  7. `useFilterState(fields)` reads the bar out of the URL, and
///     `<FilterOmnibox>` draws one box above the table that both searches and
///     filters. The clauses are turned into REQUEST PARAMETERS — see
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
const STATUSES = ["DRAFT", "ISSUED", "CLOSED", "CANCELLED"] as const

const columns: ColumnDef<TableSetup, PurchaseOrderRow>[] = [
  {
    accessorKey: "po_number",
    header: "PO",
    size: 150,
    meta: { card: "id" },
    cell: ({ row }) => (
      <span className="font-mono text-id text-body">
        {row.original.po_number}
      </span>
    ),
  },
  {
    id: "supplier",
    accessorFn: (row) => row.supplier_name ?? row.supplier_id,
    header: "Supplier",
    size: 240,
    // Who the order is with is what names the row on a phone: the PO number
    // identifies it, the supplier is what somebody is looking for.
    meta: { card: "title" },
    cell: ({ row }) => (
      <span className="font-medium text-ink">
        {row.original.supplier_name ?? row.original.supplier_id}
      </span>
    ),
  },
  {
    accessorKey: "issued_at",
    header: "Issued",
    size: 120,
    meta: { card: "meta", priority: 2 },
    cell: ({ row }) => day(row.original.issued_at),
  },
  {
    accessorKey: "expected_arrival",
    header: "Expected arrival",
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
    accessorKey: "line_count",
    header: "Items",
    size: 90,
    // How many different things, not how many pieces. Pieces are the Received
    // column's business; this is the size of the document.
    meta: { align: "right", card: "metric", priority: 3 },
    cell: ({ row }) => count(row.original.line_count),
  },
  {
    accessorKey: "net_minor",
    header: "Value",
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
    header: "Received",
    size: 120,
    // Three columns became one. Expected, Received and Outstanding were the
    // same fact stated three times — and the form a warehouse actually says it
    // in is "20/20". The colour carries what Outstanding used to: quiet when
    // the order is complete, warn while anything is owed.
    meta: { align: "right", card: "metric", priority: 1 },
    cell: ({ row }) => {
      const got = row.original.received_stock_units
      const due = row.original.expected_stock_units
      return (
        <span className={got >= due ? "text-mute" : "font-medium text-warn-fg"}>
          {count(got)}/{count(due)}
        </span>
      )
    },
  },
  {
    accessorKey: "order_status",
    header: "Status",
    size: 130,
    // Last, at the trailing edge: it is what an order IS, read after what it
    // holds and what it cost, and a row is scanned left to right.
    meta: { card: "status" },
    cell: ({ row }) => (
      <Pill tone={toneFor(row.original.order_status)}>
        {label(row.original.order_status)}
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
        column: "order_status",
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

  const rows = useMemo(() => orders.data?.items ?? [], [orders.data])

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
      field.column === "order_status"
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
        crumb="Procurement"
        title="Purchase orders"
        sub="What has been ordered, what has arrived, and what is still owed."
        actions={
          <div className="flex items-center gap-2">
            {/* Sourcing, reached from here rather than from the sidebar.

                It is not a place a buyer sets out for; it is the answer to
                "who sells this, and for how much", asked in the middle of
                deciding what to order. A row of its own in the module made it
                look like a second job — this says what it is: a detour from
                the order book. */}
            <LinkButton to="/procurement/sourcing">Sourcing</LinkButton>
            {/* A blank order, raised here.

                This used to send people to Sourcing, on the reasoning that an
                order starts by choosing goods. That is true of a buyer who
                does not know what they want and false of everyone else: a
                repeat order, or a supplier on the phone, is a list somebody
                already has in their head, and making them walk a catalogue to
                type it is the long way round. The composer is the same one the
                basket opens — same document, same editable lines — it just
                starts empty and has a box to add to it. */}
            <Button variant="primary" onClick={() => composer.open(true)}>
              New order
            </Button>
          </div>
        }
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
      <FilterOmnibox
        model={{ ...filters, fields: counted }}
        text={typed === "" ? undefined : typed}
        onText={(next) => (next ? search.open(next) : search.close())}
        placeholder="Search a PO number or supplier — or filter by status, supplier or date"
        className="mb-4"
      />

      <Card className="overflow-hidden">
        {queryState(orders, {
          loading: "Loading the orders…",
          render: (page) =>
            page.items.length === 0 ? (
              narrowed ? (
                <EmptyState>No order matches these filters.</EmptyState>
              ) : (
                <EmptyState>No purchase order has been raised yet.</EmptyState>
              )
            ) : (
              <DataTable<PurchaseOrderRow>
                table={table}
                onRowClick={(row) => order.open(row.purchase_order_id)}
                isSelected={(row) => row.purchase_order_id === order.value}
                className="max-h-[calc(100vh-14rem)]"
              />
            ),
        })}
      </Card>

      <OrderSheet id={order.value ?? null} onClose={order.close} />
    </PageContent>
  )
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
      id={detail.data?.po_number}
      title={detail.data?.supplier_name ?? detail.data?.supplier_id ?? "Order"}
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
        render: (order) => (
          <div className="flex flex-col gap-5">
            <div>
              <Pill tone={toneFor(order.order_status)}>
                {label(order.order_status)}
              </Pill>
            </div>

            {/* Payable is not here any more. It is what the DELIVERIES have
                earned — received times price — so an order that has not been
                received yet reads "Rp 0" beside lines that plainly come to
                millions, and every reader takes it for a broken figure rather
                than an answer to a question they did not ask. What the order
                is worth is stated once, at the bottom, where an invoice states
                it. */}
            <Facts>
              <Fact term="Destination">{order.destination_site_id}</Fact>
              <Fact term="Issued">{day(order.issued_at)}</Fact>
              <Fact term="Expected arrival">{day(order.expected_arrival)}</Fact>
              <Fact term="Raised by">{order.created_by}</Fact>
            </Facts>

            <div>
              <h4 className="mb-2 text-card-title font-semibold text-ink">
                Lines
              </h4>
              {/* The in-card mini-table: mono UPPERCASE micro-headers, which
                  is the one place that grammar belongs.

                  A line shows what the composer showed when it was written:
                  the photograph, the name, what it is filed under and what it
                  is tagged with. Those four are how anybody recognises a
                  garment, and the sheet was showing a name and an eleven-digit
                  article code — a number that identifies the row to the
                  database and to nobody else.

                  No Expected column either. The promise is one date for the
                  order, stated above with the other facts; a column repeating
                  it on every line was the same day written down four times. */}
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    {[
                      "Item",
                      "Unit price",
                      "Qty",
                      "Received",
                      "Line total",
                    ].map((head, index) => (
                      <th
                        key={head}
                        className={`pb-1.5 font-mono text-[0.625rem] tracking-[0.04em] whitespace-nowrap text-faint uppercase ${index === 0 ? "text-left" : "pl-2.5 text-right"}`}
                      >
                        {head}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {order.lines.map((line) => (
                    <tr
                      key={line.po_line_id}
                      className="border-t border-hairline"
                    >
                      <td className="py-2 pr-2">
                        <div className="flex items-start gap-2.5">
                          <Thumbnail
                            url={line.image_url}
                            fallback="—"
                            className="mt-0.5 size-9 shrink-0 rounded-inner"
                          />
                          <div className="flex min-w-0 flex-col gap-1">
                            <span className="text-[0.8125rem] text-ink">
                              {line.article_name}
                            </span>
                            {(line.division_code !== null ||
                              line.tags.length > 0) && (
                              <span className="flex flex-wrap items-center gap-1">
                                {line.division_code !== null && (
                                  <Tag>{label(line.division_code)}</Tag>
                                )}
                                {line.tags.map((tag) => (
                                  <Tag key={tag}>{label(tag)}</Tag>
                                ))}
                              </span>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="py-2 pl-2.5 text-right whitespace-nowrap tabular-nums">
                        {money(line.unit_price_minor)}
                      </td>
                      <td className="py-2 pl-2.5 text-right whitespace-nowrap tabular-nums">
                        {count(line.ordered_quantity)}
                      </td>
                      <td className="py-2 pl-2.5 text-right whitespace-nowrap tabular-nums">
                        {count(line.received_quantity)}
                      </td>
                      <td className="py-2 pl-2.5 text-right whitespace-nowrap tabular-nums">
                        {money(line.ordered_value_minor)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* The totals ladder: only the final row is `{ink}`/600, and it
                  says the same three things the composer's ladder said when
                  the order was raised — the lines, what was knocked off, and
                  what the supplier will invoice. Pinned to a column at the
                  right rather than spread across the sheet. */}
              <TotalsLadder
                className="mt-3 ml-auto w-full max-w-[24rem]"
                rows={[
                  {
                    label: "Expected units",
                    value: count(
                      order.lines.reduce(
                        (sum, line) => sum + line.expected_stock_units,
                        0
                      )
                    ),
                  },
                  {
                    label: "Outstanding units",
                    value: count(
                      order.lines.reduce(
                        (sum, line) => sum + line.outstanding_stock_units,
                        0
                      )
                    ),
                  },
                  { label: "Lines", value: money(order.gross_minor) },
                  {
                    label: "Discount",
                    value:
                      order.discount_minor === 0
                        ? "—"
                        : `− ${money(order.discount_minor)}`,
                  },
                ]}
                total={{
                  label: "The supplier will invoice",
                  value: money(order.net_minor),
                }}
              />
            </div>
          </div>
        ),
      })}
    </Sheet>
  )
}
