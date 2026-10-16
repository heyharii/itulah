import { useForm } from "@tanstack/react-form"
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Day } from "@/components/ui/day"
import { AppLink } from "@/components/ui/app-link"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { BarSeries, type ChartSeries } from "@/components/ui/chart"
import { DataTable } from "@/components/ui/data-table"
import {
  Checkbox,
  Field,
  Input,
  Money,
  Select,
  Textarea,
} from "@/components/ui/field"
import { FilterPanel } from "@/components/ui/filter-panel"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { MiniCell, MiniRow, MiniTable, SubHead } from "@/components/ui/rows"
import { Toolbar } from "@/components/ui/segmented"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import {
  Banner,
  EmptyState,
  NoAccessState,
  NoMatch,
} from "@/components/ui/states"
import { useFilters } from "@/lib/filters"
import {
  count,
  dateText,
  day,
  label,
  money,
  moment,
  toneFor,
} from "@/lib/format"
import {
  financeKeys,
  listBills,
  listPayments,
  payment as readPayment,
  postPayment,
  recordPayment,
  type AllocateToBill,
} from "@/lib/queries/finance"
import { useUnits } from "@/lib/queries/organisation"
import { queryState } from "@/lib/query-state"
import { useSheet } from "@/lib/sheets"
import { tableSetup, type TableSetup } from "@/lib/table"
import { useDebounced } from "@/lib/use-debounced"
import { monthLabel, parseMinor, todayIso } from "@/screens/finance/chart"
import {
  moneyAccountValue,
  parseMoneyAccountValue,
  useMeaningLabel,
  useMoneyAccounts,
  useSupplierName,
  useWindow,
  type DateWindow,
} from "@/screens/finance/hooks"
import {
  AccountMeaning,
  SupplierName,
  UnitName,
  UnitSelect,
  WindowControl,
} from "@/screens/finance/parts"
import { idempotencyKey } from "@itulah/contract/client"
import type { SupplierBill, SupplierPayment } from "@itulah/contract"

/// What has left the bank, and which debts it answered.
///
/// # Why this is not a tab on Supplier bills
///
/// A bill is a document somebody sent us; a payment is a thing we did. They
/// have different lifecycles, different authors and different mistakes: a bill
/// is queried and held, a payment is keyed against the wrong bank or split
/// across the wrong invoices. The screens cross-link — a bill lists what has
/// been paid against it — which is what makes two screens better than one tab.
///
/// # Why a payment has no supplier
///
/// It has as many as its allocations do. One bank line settling two suppliers
/// is an ordinary Friday, so "who was paid" lives on the allocations and this
/// list draws the one name when there is one and counts them when there is
/// more.
///
/// # Why recording and posting are two acts, again
///
/// Same reason as a bill, and one more: a DRAFT payment already *reserves*
/// against the bills it names, so two half-finished payments cannot both
/// promise the same ten million. The reservation is the database's — a check
/// constraint on the sum of allocations against the invoice total — and the
/// composer below mirrors it so nobody has to meet the refusal.
///
/// # Why the sheet is in the URL
///
/// Every other record in this app is. It was not, for one release: `sheets.ts`
/// is the shared key registry and PATTERN.md is explicit that a module asks for
/// a key rather than adding one, since the root route validates all of them at
/// once and several hands appending to it is a lost update waiting to happen.
/// The key was asked for and granted, so `?payment=` now opens this record from
/// anywhere — the bill sheet's cross-link, the command palette, and a link
/// somebody pastes into a message.

/// Who this payment answered, in the width of a column.
///
/// The whole list is on the allocations, so a global filter has to see it too
/// — hence an `accessorFn` returning every name and a `cell` drawing the
/// shortest true sentence.
/// Who this payment answered, for the global filter and for a sheet title —
/// the two places a name has to be a string rather than an element.
///
/// `resolve` is `useSupplierName()` where a caller has one. The column's
/// `accessorFn` has none, and does not need one: it feeds the search box, so
/// the id it falls back to is a word nobody types and nobody sees.
function supplierNames(
  payment: SupplierPayment,
  resolve?: (id: string, name?: string | null) => string
): readonly string[] {
  const seen = new Map<string, string>()
  for (const allocation of payment.allocations) {
    seen.set(
      allocation.supplier_id,
      resolve
        ? resolve(allocation.supplier_id, allocation.supplier_name)
        : (allocation.supplier_name ?? allocation.supplier_id)
    )
  }
  return [...seen.values()]
}

/// The same list, drawn — which is a component and not part of the cell above
/// because resolving a name needs a hook, and a `cell` callback is not a
/// component. An allocation that carries no name of its own is looked up in the
/// supplier list rather than printed as its uuid.
function Suppliers({ payment }: { payment: SupplierPayment }) {
  const resolve = useSupplierName()
  const names = supplierNames(payment, resolve)

  if (names.length === 0) {
    return <span className="text-faint">Nothing allocated</span>
  }
  return (
    <span
      className="block truncate font-medium text-ink"
      // Every name, for the ones this cell cannot fit.
      title={names.join(" · ")}
    >
      {names.length === 1
        ? names[0]
        : `${names[0]} + ${count(names.length - 1)} more`}
    </span>
  )
}

const columns: ColumnDef<TableSetup, SupplierPayment>[] = [
  {
    accessorKey: "payment_number",
    header: "Payment No.",
    size: 150,
    cell: ({ row }) => (
      <span className="font-mono text-id text-body">
        {row.original.payment_number}
      </span>
    ),
  },
  {
    accessorKey: "payment_date",
    header: "Date",
    size: 120,
    cell: ({ row }) => day(row.original.payment_date),
  },
  {
    id: "suppliers",
    accessorFn: (row) => supplierNames(row).join(" "),
    header: "Suppliers",
    size: 240,
    // The server orders by number, date and total only; see `SORTS`.
    enableSorting: false,
    cell: ({ row }) => <Suppliers payment={row.original} />,
  },
  {
    accessorKey: "unit_id",
    header: "Unit",
    size: 130,
    enableSorting: false,
    // The unit whose bank paid, as the client's code and name.
    cell: ({ row }) => <UnitName id={row.original.unit_id} />,
  },
  {
    id: "account",
    accessorFn: (row) => `${row.account_key} ${row.account_qualifier}`,
    header: "From Account",
    size: 200,
    enableSorting: false,
    // Which pot the money left, and the one narrowing on this screen that
    // nothing else offers: "everything that went out of BCA giro this month"
    // is a bank question and the wire takes a site, not an account. The
    // accessor is `key qualifier` because that pair IS the identity — the same
    // meaning at one site legitimately holds one account per bank — so the
    // label is rebuilt the way Cash & bank draws it rather than printed raw.
    meta: {
      filter: {
        kind: "option",
        format: (value) => {
          const [key, ...rest] = value.split(" ")
          const bank = rest.join(" ").trim()
          return bank === "" ? label(key) : `${label(key)} · ${bank}`
        },
      },
    },
    // The meaning and which bank, never the raw `bank_giro`. The code the pair
    // resolves to today is in `title` — it is what an accountant quotes.
    cell: ({ row }) => (
      <AccountMeaning
        meaning={row.original.account_key}
        qualifier={row.original.account_qualifier}
        code={row.original.account_code}
        name={row.original.account_name}
      />
    ),
  },
  {
    accessorKey: "total_minor",
    header: "Total",
    size: 150,
    meta: {
      align: "right",
      filter: { kind: "number", unit: "Rp" },
    },
    // Sorted on the minor integer and never on the rendered string: "Rp
    // 1.234.567" sorts a million between ten and eleven.
    cell: ({ row }) => (
      <span className="font-medium text-ink tabular-nums">
        {money(row.original.total_minor)}
      </span>
    ),
  },
  {
    accessorKey: "status",
    header: "Status",
    size: 120,
    enableSorting: false,
    meta: { filter: { kind: "option", format: label } },
    cell: ({ row }) => (
      <Pill tone={toneFor(row.original.status)}>
        {label(row.original.status)}
      </Pill>
    ),
  },
  {
    accessorKey: "posted_by",
    header: "Posted by",
    size: 140,
    enableSorting: false,
    // Blank is the answer for a payment nobody has posted, and a dash says so
    // without pretending the column is missing — which is also what makes the
    // column worth a question: `is empty` is "every payment still in draft",
    // asked from the side of who has not signed it rather than of its status.
    meta: { filter: { kind: "option" } },
    cell: ({ row }) =>
      row.original.posted_by === null ? (
        <span className="text-faint">—</span>
      ) : (
        <span className="text-body">{row.original.posted_by}</span>
      ),
  },
]

const OUTFLOW_SERIES: readonly ChartSeries[] = [
  { key: "total", label: "Paid", tone: "accent" },
]

/// `YYYY-MM` for a date the server sent. A slice and not a `Date`: the string
/// is already a calendar day in the books' own reckoning, and parsing it into
/// a local `Date` to format it back out is how a payment on the first of a
/// month ends up in the previous one.
function monthKey(iso: string): string {
  return iso.slice(0, 7)
}

/// How many payments one page of the register asks for. A step, not a
/// ceiling: the table asks for the next page as its last rows scroll into view.
const PAGE = 100

/// The columns the server can order by, and the word it knows each one as.
/// Every other column carries `enableSorting: false` — sorting the pages in
/// hand and calling it the register is the mistake infinite scroll invites.
const SORTS: Record<string, string> = {
  payment_number: "number",
  payment_date: "date",
  total_minor: "total",
}

export function Payments() {
  const [query, setQuery] = useState("")
  const [unit, setUnit] = useState("")
  const [composing, setComposing] = useState(false)
  const payment = useSheet("payment")
  const range = useWindow()
  const [sorting, setSorting] = useState<SortingState>([
    { id: "payment_date", desc: true },
  ])

  const filters = useFilters(columns)

  /// Status is the one column clause the server can answer, so an "is any
  /// of" on it goes on the wire. The same clause still runs in the browser,
  /// where it can only agree. The other columns — which account, how big,
  /// who posted — narrow the rows in hand, and the table keeps reading pages
  /// while the filtered list leaves its end in view.
  const statuses = useMemo(() => {
    const clause = filters.filters.find(
      (filter) =>
        filter.column === "status" &&
        filter.operator === "isAnyOf" &&
        filter.values.length > 0
    )
    return clause === undefined ? undefined : clause.values.join(",")
  }, [filters.filters])

  /// Debounced, because every keystroke is a round trip over the register.
  const needle = useDebounced(query.trim(), 400)
  const by = sorting[0]
  const sort = by === undefined ? undefined : SORTS[by.id]
  const scope = {
    unit: unit || undefined,
    status: statuses,
    q: needle === "" ? undefined : needle,
    sort,
    dir: by?.desc === true ? "desc" : undefined,
    from: range.from,
    to: range.to,
    limit: PAGE,
  }

  // The window, the location, the search, the status and the order are all
  // the server's now — `GET /payments` took `from`/`to` for this screen — so
  // every page is a page of the answer rather than a slice of the newest two
  // hundred payments narrowed in the browser.
  const payments = useInfiniteQuery({
    queryKey: [
      ...financeKeys.payments(null, unit || null, null),
      "pages",
      scope,
    ],
    queryFn: ({ pageParam, signal }) =>
      listPayments({ ...scope, cursor: pageParam }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    // The previous answer stays on screen while the next is fetched. Without
    // it every keystroke empties the table to a loading line.
    placeholderData: (previous) => previous,
  })

  const rows = useMemo(
    () => payments.data?.pages.flatMap((page) => page.rows) ?? [],
    [payments.data]
  )
  /// Every payment the window, search and filters match — the server's count,
  /// never the length of the pages in hand.
  const matched = payments.data?.pages[0]?.total ?? 0
  /// Whether anything but the window and the location is narrowing the
  /// register — "nothing was paid" and "nothing matches" have different fixes.
  const narrowed = needle !== "" || filters.filters.length > 0
  const clearNarrowing = () => {
    setQuery("")
    filters.clear()
  }

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns: filters.columns,
        getRowId: (row: SupplierPayment) => row.payment_id,
        state: {
          columnFilters: filters.columnFilters,
          sorting,
        },
        // The rows arrive in the order the request asked for, and the search
        // box is the server's. Sorting or searching them again here would do
        // it to the pages in hand and call it the register.
        manualSorting: true,
        onSortingChange: setSorting,
      }),
      [rows, filters.columns, filters.columnFilters, sorting]
    )
  )

  /// The chart's own read: every POSTED payment in the window at the chosen
  /// location, unpaged. The register above pages, and a chart summed from
  /// the pages in hand would grow as somebody scrolled — on a cash chart, a
  /// month that looks quiet because its payments had not loaded yet.
  ///
  /// `limit: undefined` is deliberate and overrides the fetcher's default:
  /// an absent limit is how `GET /payments` is asked for the whole answer.
  const postedInWindow = useQuery({
    queryKey: [
      ...financeKeys.payments("POSTED", unit || null, null),
      "window",
      range.from,
      range.to,
    ],
    queryFn: ({ signal }) =>
      listPayments(
        {
          status: "POSTED",
          unit: unit || undefined,
          from: range.from,
          to: range.to,
          limit: undefined,
        },
        signal
      ),
  })

  /// What left the bank, month by month, over the window on screen.
  ///
  /// Posted payments only. A DRAFT has reserved money against a bill and has
  /// not moved any, so charting it would draw an outflow that has not
  /// happened — the one thing a cash chart must never do. The card says which
  /// subset it is on the page, not only here.
  ///
  /// Every month in the window gets a bar, including the empty ones: closing
  /// a gap up lets the eye read two bars three months apart as consecutive.
  const outflow = useMemo(() => {
    const posted = postedInWindow.data?.rows ?? []
    const sums = new Map<string, number>()
    for (const row of posted) {
      const key = monthKey(row.payment_date)
      sums.set(key, (sums.get(key) ?? 0) + row.total_minor)
    }

    const buckets: string[] = []
    const start = new Date(`${range.from}T00:00:00`)
    const end = new Date(`${range.to}T00:00:00`)
    const cursor = new Date(start.getFullYear(), start.getMonth(), 1)
    // Capped at two years of bars — a window wider than that is somebody
    // reading a decade, and 120 hairlines is not a chart.
    while (cursor <= end && buckets.length < 24) {
      buckets.push(
        `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`
      )
      cursor.setMonth(cursor.getMonth() + 1)
    }

    return {
      // The server's count and sum over the same set the bars are drawn
      // from, so the caption and the chart cannot disagree.
      payments: postedInWindow.data?.total ?? 0,
      paid: postedInWindow.data?.total_minor ?? 0,
      rows: buckets.map((bucket) => ({
        bucket,
        total: sums.get(bucket) ?? 0,
      })),
    }
  }, [postedInWindow.data, range.from, range.to])

  return (
    <PageContent>
      <PageHeader
        crumb="Finance"
        title="Payments"
        sub="What has left the bank, and which supplier debts it answered."
        actions={
          <>
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="h-8 w-48"
            />
            <Button variant="primary" onClick={() => setComposing(true)}>
              Record payment
            </Button>
          </>
        }
      />

      <Toolbar>
        <WindowControl range={range} />
        <UnitSelect
          value={unit}
          onChange={setUnit}
          className="h-8 w-44"
          aria-label="Unit"
        />
        {/* The window and the location are already asked to the left, both on
            the wire, so neither is offered again in the panel. What is offered
            is what no control here can reach: which pot the money left, how
            big it was, and whether anybody has posted it. */}
        <FilterPanel model={filters} table={table} />
        <Toolbar.Spacer />
        {/* The window is stated rather than implied, and so is how many
            payments the server found in it — its count, not the pages loaded
            so far. */}
        <span className="text-[0.9375rem] text-mute">
          {range.chip}
          {payments.data !== undefined &&
            ` · ${count(matched)} ${matched === 1 ? "payment" : "payments"}`}
        </span>
      </Toolbar>

      {/* Only when something has actually been paid in the window. With every
          payment still in draft the chart would be a row of empty months
          announcing that no money has moved, which the table below says on its
          own. */}
      {outflow.payments > 0 && (
        <Card className="mb-3">
          <CardHeader>
            <CardTitle>Outflow</CardTitle>
            <span className="text-[0.9375rem] text-mute">
              {count(outflow.payments)} posted payments ·{" "}
              <span className="font-medium text-ink tabular-nums">
                {money(outflow.paid)}
              </span>
            </span>
          </CardHeader>
          <div className="px-4 pb-3.5">
            <BarSeries
              rows={outflow.rows}
              series={OUTFLOW_SERIES}
              format={money}
              labelOf={(bucket) =>
                dateText(new Date(`${bucket}-01T00:00:00`), {
                  month: "short",
                })
              }
              titleOf={(bucket) =>
                monthLabel(
                  Number(bucket.slice(0, 4)),
                  Number(bucket.slice(5, 7))
                )
              }
              className="h-[9.5rem]"
            />
          </div>
        </Card>
      )}

      <Card className="overflow-hidden">
        {queryState(payments, {
          loading: "Loading the payments…",
          // Every `GET /api/v1/finance/…` is behind SUPERVISOR, so a cashier
          // signed into the hub is refused here rather than served an empty
          // register — and an empty register is what a refusal would otherwise
          // be read as, by somebody who then goes looking for the money.
          refused: (
            <NoAccessState
              what="what the company has paid its suppliers"
              reach="Reading finance takes a supervisor's sign-in; paying out of it, head office's."
            />
          ),
          render: () =>
            rows.length === 0 && narrowed ? (
              // Something was paid in the window, perhaps, and none of it
              // matches what was typed or ticked — a different fix from an
              // empty window.
              <NoMatch what="payments" onClear={clearNarrowing} />
            ) : rows.length === 0 ? (
              <EmptyState>
                No payment was made between {day(range.from)} and{" "}
                {day(range.to)}. The window is always set now, so this does not
                say nobody has ever been paid — widen it to tell the two apart.
              </EmptyState>
            ) : (
              <DataTable<SupplierPayment>
                refresh={[payments]}
                table={table}
                onRowClick={(row) => payment.open(row.payment_id)}
                isSelected={(row) => row.payment_id === payment.value}
                // What the column clauses leave of the pages in hand. The
                // table keeps asking for pages while this shows, so it is
                // only final once the register has been read to its end.
                empty={<NoMatch what="payments" onClear={clearNarrowing} />}
                more={payments}
                className={
                  outflow.payments > 0
                    ? "max-h-[calc(100dvh-32rem)]"
                    : "max-h-[calc(100dvh-18rem)]"
                }
              />
            ),
        })}
      </Card>

      <PaymentSheet id={payment.value ?? null} onClose={payment.close} />
      <ComposerSheet
        open={composing}
        onClose={() => setComposing(false)}
        range={range}
      />
    </PageContent>
  )
}

// ---------------------------------------------------------------------------
// One payment
// ---------------------------------------------------------------------------

/// One payment, its allocations, and the one decision it is waiting on.
///
/// It reads `GET /payments/{id}` rather than picking the row out of the list:
/// unlike a bill there *is* a per-payment endpoint, and the allocations it
/// answers with are the record a person is about to post. The list is a
/// summary; this is the document.
function PaymentSheet({
  id,
  onClose,
}: {
  id: string | null
  onClose: () => void
}) {
  const client = useQueryClient()
  // The sheet's title is a string and not an element, so it calls what
  // `<SupplierName>` calls.
  const supplierName = useSupplierName()

  // The payment's own read, as the note above says. It used to pick the row
  // out of the newest two hundred, so a payment older than that — opened from
  // a bill's cross-link or a pasted link — said it was not recorded.
  const detail = useQuery({
    queryKey: financeKeys.payment(id ?? ""),
    queryFn: ({ signal }) => readPayment(id!, signal),
    enabled: id !== null,
  })

  // The bills, for what each debt is worth *after* this payment. Same key the
  // Supplier bills screen owns, so it costs nothing and cannot disagree with
  // the row somebody clicked through from.
  const bills = useQuery({
    queryKey: financeKeys.bills(null),
    queryFn: ({ signal }) => listBills({}, signal).then((page) => page.rows),
    enabled: id !== null,
  })

  const payment = detail.data
  const posted = payment?.status?.toUpperCase() === "POSTED"

  const post = useMutation({
    mutationFn: () => postPayment(id!),
    onSuccess: () => {
      // Posting a payment writes a journal entry, so the register, the bank
      // balances, both statements, the trial balance and every bill's paid
      // figure moved with it. There is no narrower honest answer.
      client.invalidateQueries({ queryKey: financeKeys.all })
    },
  })

  /// What the bill is still worth once this payment is in the books.
  ///
  /// Derived and never guessed. `outstanding_minor` on a bill counts POSTED
  /// payments only, so for a payment already posted it *is* the figure after —
  /// and for one still in draft the answer is that figure less what this
  /// payment promises. Falls back to the allocation's own arithmetic when the
  /// bill is not on the list, which is the only honest thing to draw for a
  /// debt this screen cannot see.
  const outstandingAfter = (allocation: {
    invoice_id: string
    invoice_total_minor: number
    amount_minor: number
  }): number => {
    const bill = bills.data?.find(
      (row) => row.invoice_id === allocation.invoice_id
    )
    if (bill === undefined) {
      return allocation.invoice_total_minor - allocation.amount_minor
    }
    return posted
      ? bill.outstanding_minor
      : bill.outstanding_minor - allocation.amount_minor
  }

  return (
    <Sheet
      open={id !== null}
      onOpenChange={(next) => !next && onClose()}
      id={payment?.payment_number}
      title={
        payment === undefined
          ? "Payment"
          : (supplierNames(payment, supplierName)[0] ?? "Payment")
      }
      footer={
        payment && !posted ? (
          <div className="flex items-center justify-between gap-3">
            <span className="text-[0.9375rem] text-mute">
              Posts on the payment date unless the month is closed.
            </span>
            <Button
              variant="primary"
              pending={post.isPending}
              onClick={() => post.mutate()}
            >
              {post.isPending ? "Posting…" : "Post to the books"}
            </Button>
          </div>
        ) : undefined
      }
    >
      {queryState(detail, {
        loading: "Loading the payment…",
        render: () =>
          payment === undefined ? (
            <EmptyState>No payment is recorded under that id.</EmptyState>
          ) : (
            <div className="flex flex-col gap-5">
              {post.isError && (
                <Banner tone="bad">
                  {post.error instanceof Error
                    ? post.error.message
                    : "The payment could not be posted."}
                </Banner>
              )}

              <div className="flex flex-wrap gap-1.5">
                <Pill tone={toneFor(payment.status)}>
                  {label(payment.status)}
                </Pill>
                {!posted && (
                  <Pill tone="warn">Reserved against these bills</Pill>
                )}
              </div>

              <Facts>
                <Fact term="Unit">
                  <UnitName id={payment.unit_id} />
                </Fact>
                <Fact term="Payment date">{day(payment.payment_date)}</Fact>
                <Fact term="Method">{label(payment.method)}</Fact>
                <Fact term="From account">
                  <AccountMeaning
                    meaning={payment.account_key}
                    qualifier={payment.account_qualifier}
                    code={payment.account_code}
                    name={payment.account_name}
                  />
                </Fact>
                <Fact term="Currency">{payment.currency}</Fact>
                <Fact term="Reference">{payment.reference ?? "—"}</Fact>
                <Fact term="Recorded by">{payment.recorded_by}</Fact>
                <Fact term="Recorded at">{moment(payment.recorded_at)}</Fact>
                {payment.posted_by && (
                  <Fact term="Posted by">{payment.posted_by}</Fact>
                )}
                {payment.posted_at && (
                  <Fact term="Posted at">{moment(payment.posted_at)}</Fact>
                )}
                {payment.entry_number && payment.journal_entry_id && (
                  <Fact term="Journal">
                    {/* No dead ends: the entry this payment wrote is one
                        click away, and the link opens it rather than
                        landing somebody on a register to search. */}
                    <AppLink
                      to="/finance/journal"
                      sheet={{
                        key: "entry",
                        value: payment.journal_entry_id,
                      }}
                      className="font-mono text-id text-accent hover:underline"
                    >
                      {payment.entry_number}
                    </AppLink>
                  </Fact>
                )}
              </Facts>

              {payment.note && (
                <p className="text-[0.9375rem] text-body">{payment.note}</p>
              )}

              <div>
                <SubHead
                  aside={`${count(payment.allocations.length)} ${
                    payment.allocations.length === 1 ? "bill" : "bills"
                  }`}
                >
                  What it paid
                </SubHead>
                {payment.allocations.length === 0 ? (
                  <p className="text-[0.9375rem] text-mute">
                    Nothing is allocated, so this payment answers no debt. The
                    server refuses one like this, which means it was written
                    before that rule and is worth asking about.
                  </p>
                ) : (
                  <MiniTable head={["Bill", "Paid", "Outstanding After"]}>
                    {payment.allocations.map((allocation) => (
                      <MiniRow key={allocation.invoice_id}>
                        <MiniCell>
                          <AppLink
                            to="/finance/bills"
                            sheet={{
                              key: "bill",
                              value: allocation.invoice_id,
                            }}
                            className="block font-mono text-[0.9375rem] text-accent hover:underline"
                          >
                            {allocation.invoice_number}
                          </AppLink>
                          <SupplierName
                            id={allocation.supplier_id}
                            name={allocation.supplier_name}
                            className="block truncate text-[0.9375rem] text-mute"
                          />
                        </MiniCell>
                        <MiniCell align="right">
                          {money(allocation.amount_minor)}
                        </MiniCell>
                        <MiniCell align="right">
                          {money(outstandingAfter(allocation))}
                        </MiniCell>
                      </MiniRow>
                    ))}
                  </MiniTable>
                )}

                {/* The server's own total on the last row, and the
                    allocations' sum above it. They agree because the database
                    refuses a payment where they do not — showing both is how
                    a reader can see that rather than take it on trust. */}
                <div className="mt-3 flex flex-col gap-1 border-t border-hairline pt-2.5 text-[0.9375rem]">
                  <div className="flex justify-between gap-3 text-body">
                    <span>Allocated</span>
                    <span className="tabular-nums">
                      {money(
                        payment.allocations.reduce(
                          (sum, row) => sum + row.amount_minor,
                          0
                        )
                      )}
                    </span>
                  </div>
                  <div className="flex justify-between gap-3 font-semibold text-ink">
                    <span>Payment total</span>
                    <span className="tabular-nums">
                      {money(payment.total_minor)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          ),
      })}
    </Sheet>
  )
}

// ---------------------------------------------------------------------------
// Recording one
// ---------------------------------------------------------------------------

/// `RecordPaymentRequest.method` is a fixed set on the server. The labels are
/// what the client calls them; the values are what the endpoint accepts.
const METHODS: readonly { value: string; label: string }[] = [
  { value: "TRANSFER", label: "Transfer" },
  { value: "CASH", label: "Cash" },
  { value: "GIRO", label: "Giro" },
  { value: "OTHER", label: "Other" },
]

/// One allocation being typed. The amount is text until it is submitted —
/// a half-typed number is not a number.
interface DraftAllocation {
  invoice_id: string
  amount: string
}

interface PaymentDraft {
  /// The unit whose bank the money leaves.
  unitId: string
  paymentDate: string
  method: string
  /// `key\tqualifier`, as `moneyAccountValue` joins them.
  account: string
  total: string
  reference: string
  note: string
  /// Only when `method` is GIRO, and then both are required — the server
  /// refuses a giro with no number (0117/0119). Kept out of `reference`
  /// deliberately: `reference` is free text, a giro number is a key.
  giroNumber: string
  giroDueDate: string
  allocations: DraftAllocation[]
}

/// What the draft adds up to, and whether the server would take it.
///
/// # Why the client checks a rule the database already holds
///
/// For the same reason the journal composer checks that debits equal credits:
/// so the button does not offer to do something that will be refused. Two
/// rules are mirrored here and both of them live in Postgres —
///
///  * **The total must equal the allocations.** `RecordPaymentRequest`
///    carries a redundant `total_minor` on purpose: a client that believes it
///    is paying fifty million and has built allocations totalling five should
///    hear about it here, not on a bank statement.
///  * **A bill cannot be over-allocated.** The constraint counts DRAFT
///    payments as well as posted ones — a draft reserves — so the room on a
///    bill is its total less everything already spoken for, which is exactly
///    what `allocated_minor` reports.
///
/// Neither check is the one that holds. The database's is.
function paymentTotals(draft: PaymentDraft, room: ReadonlyMap<string, number>) {
  const priced = draft.allocations.map((row) => ({
    invoice_id: row.invoice_id,
    amount: row.amount.trim() === "" ? null : parseMinor(row.amount),
  }))
  const misread = priced.some((row) => row.amount === null || row.amount <= 0)
  const over = priced.filter(
    (row) => row.amount !== null && row.amount > (room.get(row.invoice_id) ?? 0)
  )
  const allocated = priced.reduce((sum, row) => sum + (row.amount ?? 0), 0)
  const totalMinor = draft.total.trim() === "" ? null : parseMinor(draft.total)
  const agrees =
    totalMinor !== null && allocated > 0 && totalMinor === allocated

  return {
    priced,
    allocated,
    totalMinor,
    misread,
    over,
    agrees,
    ready:
      draft.unitId !== "" &&
      draft.paymentDate !== "" &&
      draft.method !== "" &&
      draft.account !== "" &&
      draft.allocations.length > 0 &&
      !misread &&
      over.length === 0 &&
      agrees &&
      // A third rule mirrored from the server, for the reason the other two
      // are: the button should not offer to do something that will be
      // refused. A giro with no number or no due date is refused by
      // `record_payment`, and the message names a field this form can show.
      (draft.method !== "GIRO" ||
        (draft.giroNumber.trim() !== "" && draft.giroDueDate !== "")),
  }
}

/// Writing a payment down. It does not post: recording and posting are two
/// acts, and this is only the first.
///
/// # Why the account is a select of meanings and not of codes
///
/// The endpoint takes `account_key` + `account_qualifier`, and which client
/// account those resolve to at this location is the account map's business.
/// Offering the chart here would let somebody pay out of an account the
/// posting rules do not know about; offering every *meaning* would let them
/// pick one nobody has mapped, whose posting is refused outright. So the
/// options are the links that exist for the chosen unit, which is the
/// intersection of the two — and it is empty until a unit is chosen, because
/// until then the question has no answer.
function ComposerSheet({
  open,
  onClose,
  range,
}: {
  open: boolean
  onClose: () => void
  /// The register's window, so a payment recorded here lands inside the list
  /// the person is looking at rather than vanishing out of it.
  range: DateWindow
}) {
  const client = useQueryClient()
  // Minted once per composer, not per attempt: a retry after a dropped
  // connection must land the same payment, and generating the key inside the
  // request would defeat the whole mechanism.
  const [key, setKey] = useState(() => idempotencyKey())

  // Every bill, once. The same key the Supplier bills screen owns, so opening
  // this composer costs nothing on a session that has been there — and the
  // candidates below are a filter over it rather than a second request for a
  // subset of a list already in memory.
  const bills = useQuery({
    queryKey: financeKeys.bills(null),
    queryFn: ({ signal }) => listBills({}, signal).then((page) => page.rows),
    enabled: open,
  })

  const record = useMutation({
    // Wrapped rather than passed by reference: v5 hands a mutation context as
    // the second argument, which is not the `AbortSignal` the fetcher expects.
    mutationFn: (draft: PaymentDraft) => {
      const account = parseMoneyAccountValue(draft.account)
      // The room map is only for the *gate*, and the gate has already passed
      // by the time this runs — an empty one here would report every line as
      // over-allocated and nothing reads that field. What is wanted is the
      // parsed amounts and the typed total.
      const totals = paymentTotals(draft, roomFor(bills.data))
      return recordPayment(
        {
          unit_id: draft.unitId,
          payment_date: draft.paymentDate,
          method: draft.method,
          account_key: account.account_key,
          account_qualifier: account.account_qualifier,
          total_minor: totals.totalMinor,
          reference:
            draft.reference.trim() === "" ? null : draft.reference.trim(),
          note: draft.note.trim() === "" ? null : draft.note.trim(),
          allocations: totals.priced.map((row): AllocateToBill => ({
            invoice_id: row.invoice_id,
            amount_minor: row.amount ?? 0,
          })),
          // Sent only on GIRO and refused by the server on anything else, so
          // a method changed after typing must not smuggle the old paper
          // along. The fields stay on the draft; what leaves is gated here.
          giro_number:
            draft.method === "GIRO" && draft.giroNumber.trim() !== ""
              ? draft.giroNumber.trim()
              : null,
          giro_due_date:
            draft.method === "GIRO" && draft.giroDueDate !== ""
              ? draft.giroDueDate
              : null,
        },
        key
      )
    },
    onSuccess: () => {
      // Only what differs from payment to payment is cleared: the unit, the
      // account and the method are almost always the next one's too.
      form.setFieldValue("allocations", [])
      form.setFieldValue("total", "")
      form.setFieldValue("reference", "")
      form.setFieldValue("note", "")
      form.setFieldValue("giroNumber", "")
      form.setFieldValue("giroDueDate", "")
      setKey(idempotencyKey())
      // Recording writes no journal entry, so no balance moved — but a draft
      // reserves against the bills it names, which is what `allocated_minor`
      // reports and what the candidate list below is built from.
      client.invalidateQueries({ queryKey: ["finance", "payments"] })
      client.invalidateQueries({ queryKey: ["finance", "bills"] })
    },
  })

  const form = useForm({
    defaultValues: {
      unitId: "",
      paymentDate: todayIso(),
      // Giro by default: Finance chooses the instrument at payment, and
      // suppliers are paid by bilyet giro unless it says otherwise.
      method: "GIRO",
      account: "",
      total: "",
      reference: "",
      note: "",
      giroNumber: "",
      giroDueDate: "",
      allocations: [],
    } as PaymentDraft,
    onSubmit: ({ value }) => record.mutate(value),
  })

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title="Record a payment"
      className="w-[34rem]"
      footer={
        /* The second `dark` button in this file, and the one exception the
           rule allows: a composer is a modal surface on the white veil, so its
           submit and the header's "Record payment" are never on screen
           together. */
        <form.Subscribe selector={(state) => state.values}>
          {(draft) => {
            const totals = paymentTotals(draft, roomFor(bills.data))
            return (
              <div className="flex items-center justify-between gap-3">
                {/* The same sentence the journal composer writes, for the
                    same reason: a disabled button with nothing beside it
                    reads as broken, and "what is still wrong" is one line. */}
                <span className="text-[0.9375rem] text-mute tabular-nums">
                  {totals.ready
                    ? `Balanced at ${money(totals.allocated)}`
                    : draft.allocations.length === 0
                      ? "No bill chosen yet"
                      : totals.over.length > 0
                        ? "One bill is allocated more than it has left"
                        : `Allocated ${money(totals.allocated)} of ${
                            totals.totalMinor === null
                              ? "the total"
                              : money(totals.totalMinor)
                          }`}
                </span>
                <Button
                  variant="primary"
                  pending={record.isPending}
                  disabled={!totals.ready}
                  onClick={() => form.handleSubmit()}
                >
                  {record.isPending ? "Submitting…" : "Submit"}
                </Button>
              </div>
            )
          }}
        </form.Subscribe>
      }
    >
      <form
        // The button is in the sheet's footer, outside this element, so its
        // disabled state cannot block an Enter keypress — and an unbalanced
        // payment must never reach the check constraint.
        onSubmit={(event) => {
          event.preventDefault()
          if (
            paymentTotals(form.state.values, roomFor(bills.data)).ready &&
            !record.isPending
          ) {
            form.handleSubmit()
          }
        }}
        className="flex flex-col gap-4"
      >
        {record.isError && (
          <Banner tone="bad">
            {record.error instanceof Error
              ? record.error.message
              : "The payment was refused."}
          </Banner>
        )}

        <div className="grid grid-cols-2 gap-3">
          <form.Field name="unitId">
            {(field) => (
              <Field label="Unit" required>
                <UnitSelect
                  value={field.state.value}
                  onChange={(next) => {
                    field.handleChange(next)
                    // The accounts are a unit's, so the one that was chosen
                    // for the old unit is not an answer for the new one.
                    // Clearing is louder than silently sending a link that
                    // does not exist there.
                    form.setFieldValue("account", "")
                  }}
                  emptyLabel="Choose a unit"
                />
              </Field>
            )}
          </form.Field>
          <form.Field name="paymentDate">
            {(field) => (
              <Field
                label="Payment date"
                required
                hint={
                  field.state.value < range.from || field.state.value > range.to
                    ? "Outside the window on the register behind this."
                    : undefined
                }
              >
                <Day
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={field.handleChange}
                />
              </Field>
            )}
          </form.Field>
          <form.Field name="method">
            {(field) => (
              <Field label="Method">
                <Select
                  value={field.state.value}
                  onChange={(next) => field.handleChange(next)}
                >
                  {METHODS.map((method) => (
                    <option key={method.value} value={method.value}>
                      {method.label}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
          </form.Field>
          <form.Subscribe selector={(state) => state.values.unitId}>
            {(unitId) => (
              <form.Field name="account">
                {(field) => (
                  <MoneyAccountField
                    unitId={unitId}
                    value={field.state.value}
                    onChange={(next) => field.handleChange(next)}
                  />
                )}
              </form.Field>
            )}
          </form.Subscribe>
          <form.Field name="total">
            {(field) => (
              <Field
                label="Total paid"
                required
                hint="What actually left the bank."
                problem={
                  field.state.value.trim() !== "" &&
                  parseMinor(field.state.value) === null
                    ? "Not a number."
                    : undefined
                }
              >
                <Money
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={field.handleChange}
                />
              </Field>
            )}
          </form.Field>
          <form.Field name="reference">
            {(field) => (
              <Field label="Reference" hint="The bank's, if there is one.">
                <Input
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
              </Field>
            )}
          </form.Field>
        </div>

        {/* The paper, and only when there is paper. A giro is a promise before
            it is money (0117), and the number is how the bank finds it again
            when they telephone — which is why the server requires it rather
            than accepting a note in `reference`. */}
        <form.Subscribe selector={(state) => state.values.method}>
          {(method) =>
            method === "GIRO" ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <form.Field name="giroNumber">
                  {(field) => (
                    <Field
                      label="Giro number"
                      required
                      hint="Printed on the slip. Required for a giro."
                    >
                      <Input
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={(event) =>
                          field.handleChange(event.target.value)
                        }
                      />
                    </Field>
                  )}
                </form.Field>
                <form.Field name="giroDueDate">
                  {(field) => (
                    <Field
                      label="Due date"
                      required
                      hint="The day it may be cashed, not today."
                    >
                      <Input
                        type="date"
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={(event) =>
                          field.handleChange(event.target.value)
                        }
                      />
                    </Field>
                  )}
                </form.Field>
              </div>
            ) : null
          }
        </form.Subscribe>

        <form.Subscribe selector={(state) => state.values}>
          {(draft) => (
            <AllocationPicker
              bills={bills.data ?? []}
              loading={bills.isPending}
              unitId={draft.unitId}
              allocations={draft.allocations}
              onChange={(next) => form.setFieldValue("allocations", next)}
            />
          )}
        </form.Subscribe>

        <form.Field name="note">
          {(field) => (
            <Field label="Note" hint="Why it was split this way, if it was.">
              <Textarea
                rows={2}
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
              />
            </Field>
          )}
        </form.Field>
      </form>
    </Sheet>
  )
}

/// Which accounts money can leave this unit's books by.
///
/// Its own component so the hook behind it is called with a unit rather than
/// conditionally: `useMoneyAccounts` reads the account map, and a hook inside
/// a `form.Subscribe` render prop is a hook inside a callback.
function MoneyAccountField({
  unitId,
  value,
  onChange,
}: {
  unitId: string
  value: string
  onChange: (value: string) => void
}) {
  const accounts = useMoneyAccounts(unitId)
  // The server's own word for the meaning — "Bank — giro", which is what the
  // register column and the payment sheet draw. `label()` on the raw key gives
  // "Bank giro", and one screen calling the same meaning two things is exactly
  // the drift the account map's labels exist to prevent.
  const meaning = useMeaningLabel()

  return (
    <Field
      label="From account"
      required
      hint={
        unitId === ""
          ? "Choose a unit first."
          : accounts.length === 0
            ? "No cash or bank meaning is mapped here. Map one first — a posting that needs it is refused."
            : undefined
      }
    >
      <Select
        value={value}
        disabled={accounts.length === 0}
        onChange={(next) => onChange(next)}
      >
        <option value="">Choose an account</option>
        {accounts.map((account) => (
          <option
            key={moneyAccountValue(account)}
            value={moneyAccountValue(account)}
          >
            {meaning(account.account_key)}
            {account.account_qualifier === ""
              ? ""
              : ` · ${account.account_qualifier}`}
            {` — ${account.account_name}`}
          </option>
        ))}
      </Select>
    </Field>
  )
}

/// The room left on every bill, by invoice id.
///
/// Total less everything already spoken for, which is what the database's own
/// constraint measures. Not `outstanding_minor`: that counts posted payments
/// only, so a bill with a draft against it would look payable here and be
/// refused on submit.
function roomFor(
  bills: readonly SupplierBill[] | undefined
): ReadonlyMap<string, number> {
  const table = new Map<string, number>()
  for (const bill of bills ?? []) {
    table.set(bill.invoice_id, bill.total_minor - bill.allocated_minor)
  }
  return table
}

/// Which debts this payment answers, and how much of each.
///
/// # Which bills are offered
///
/// Posted ones with something still outstanding. A bill that has only been
/// *recorded* is not yet in the books, and paying a debt the ledger does not
/// carry would post a payment against nothing — the server refuses it, and
/// this list is how nobody has to meet that refusal.
///
/// A bill whose room is gone is still drawn, greyed, saying why. That is the
/// one case where a disabled row beats a hidden one: "the invoice I am holding
/// is not in this list" is indistinguishable from a broken filter, and a
/// sentence saying a draft already has it is the answer.
function AllocationPicker({
  bills,
  loading,
  unitId,
  allocations,
  onChange,
}: {
  bills: readonly SupplierBill[]
  loading: boolean
  unitId: string
  allocations: readonly DraftAllocation[]
  onChange: (allocations: DraftAllocation[]) => void
}) {
  // A bill stays at the site it was received at; the unit's sites are what
  // tie it to the unit paying. Before a unit is chosen nothing is offered,
  // because the question has no answer.
  const units = useUnits()
  const sites = useMemo(
    () =>
      new Set(
        (units.data?.find((one) => one.id === unitId)?.sites ?? []).map(
          (site) => site.id
        )
      ),
    [units.data, unitId]
  )
  const candidates = useMemo(
    () =>
      bills
        .filter(
          (bill) =>
            bill.status.toUpperCase() === "POSTED" &&
            bill.outstanding_minor > 0 &&
            (unitId === "" || sites.has(bill.site_id))
        )
        // Oldest first: an allocation list is worked down in the order the
        // ageing report says to pay.
        .sort((a, b) => b.days_overdue - a.days_overdue),
    [bills, unitId, sites]
  )

  const chosen = new Map(allocations.map((row) => [row.invoice_id, row.amount]))

  const toggle = (bill: SupplierBill, on: boolean) => {
    if (!on) {
      onChange(allocations.filter((row) => row.invoice_id !== bill.invoice_id))
      return
    }
    onChange([
      ...allocations,
      {
        invoice_id: bill.invoice_id,
        // Defaulted to the room rather than to the outstanding figure, and
        // they differ only when a draft is already holding some of the bill.
        // Defaulting to a number the database will refuse is worse than
        // defaulting to a smaller one somebody can raise.
        amount: String(bill.total_minor - bill.allocated_minor),
      },
    ])
  }

  const setAmount = (invoiceId: string, amount: string) => {
    onChange(
      allocations.map((row) =>
        row.invoice_id === invoiceId ? { ...row, amount } : row
      )
    )
  }

  return (
    <div>
      <SubHead
        aside={
          allocations.length === 0
            ? undefined
            : `${count(allocations.length)} chosen`
        }
      >
        What it pays
      </SubHead>

      {loading || units.isPending ? (
        <p className="text-[0.9375rem] text-mute">Loading the bills…</p>
      ) : unitId === "" ? (
        <p className="text-[0.9375rem] text-mute">
          Choose a unit first — a payment answers the bills received at its
          sites.
        </p>
      ) : candidates.length === 0 ? (
        <p className="text-[0.9375rem] text-mute">
          Nothing received at this unit's sites is still outstanding. A bill
          that has only been recorded is not in the books yet and cannot be
          paid.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {candidates.map((bill) => {
            const room = bill.total_minor - bill.allocated_minor
            const amount = chosen.get(bill.invoice_id)
            const on = amount !== undefined
            const typed = amount === undefined ? null : parseMinor(amount)
            const over = typed !== null && typed > room
            return (
              <div
                key={bill.invoice_id}
                className="rounded-inner border border-hairline p-2.5"
              >
                <div className="flex items-center gap-2.5">
                  <Checkbox
                    className="min-w-0 flex-1"
                    disabled={room <= 0}
                    checked={on}
                    onChange={(next) => toggle(bill, next)}
                    label={
                      <span className="min-w-0">
                        <span className="font-mono text-[0.9375rem] text-body">
                          {bill.invoice_number}
                        </span>{" "}
                        <SupplierName
                          id={bill.supplier_id}
                          name={bill.supplier_name}
                          className="text-ink"
                        />
                      </span>
                    }
                  />
                  <span className="shrink-0 text-right text-[0.9375rem] text-mute tabular-nums">
                    {money(bill.outstanding_minor)} out
                  </span>
                </div>

                {room <= 0 ? (
                  <p className="mt-1.5 text-[0.9375rem] text-warn-fg">
                    A draft payment already has all of this bill. Post or change
                    that one first.
                  </p>
                ) : (
                  on && (
                    <div className="mt-2 flex items-center gap-2">
                      <span className="flex w-40 shrink-0">
                        <Money
                          label={`Amount against ${bill.invoice_number}`}
                          value={amount}
                          onChange={(next) => setAmount(bill.invoice_id, next)}
                          className="h-8"
                        />
                      </span>
                      <span
                        className={
                          over
                            ? "text-[0.9375rem] text-bad"
                            : "text-[0.9375rem] text-mute"
                        }
                      >
                        {over
                          ? `More than the ${money(room)} left on this bill.`
                          : typed === null
                            ? "Not a number."
                            : `${money(room)} can still be allocated.`}
                      </span>
                    </div>
                  )
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
