import { useInfiniteQuery } from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { AppLink } from "@/components/ui/app-link"
import { Card, CardHeader, CardStrip, CardTitle } from "@/components/ui/card"
import { LineSeries } from "@/components/ui/chart"
import { DataTable } from "@/components/ui/data-table"
import { Input } from "@/components/ui/field"
import { FilterPanel } from "@/components/ui/filter-panel"
import { TotalsLadder } from "@/components/ui/rows"
import { PageHeader } from "@/components/ui/page-header"
import { Toolbar } from "@/components/ui/segmented"
import { Banner, EmptyState } from "@/components/ui/states"
import { Tag } from "@/components/ui/tag"
import { useFilters } from "@/lib/filters"
import { dateText, day, label, money } from "@/lib/format"
import { accountLedger, financeKeys, trialBalance } from "@/lib/queries/finance"
import { queryState } from "@/lib/query-state"
import { useSheet } from "@/lib/sheets"
import { tableSetup, type TableSetup } from "@/lib/table"
import { useDebounced } from "@/lib/use-debounced"
import { ROOT_CLASSES } from "@/screens/finance/chart"
import { useAsOf, useWindow } from "@/screens/finance/hooks"
import {
  AccountPicker,
  AsOfControl,
  UnitName,
  UnitSelect,
  WindowControl,
} from "@/screens/finance/parts"
import type { GeneralLedgerRow, TrialBalanceRow } from "@itulah/contract"

/// One account, down the page, in the order it happened — and, before one is
/// picked, every account there is anything to read.
///
/// # Why the trial balance is this screen's empty state
///
/// It was its own sidebar entry, and the screen it fed was this one: every row
/// of a trial balance is a question about an account, and the answer is that
/// account's ledger. Standing between them was a card that said "Which
/// account?" and offered a search box — a screen whose whole content was a
/// prompt to go somewhere else, next to a screen that already listed every
/// answer. So the list *is* the picker now. Nothing is lost: the trial
/// balance's own reading — as-of date, per-site, the balanced banner, the
/// server's totals — is all still here, and it is what somebody sees before
/// they have chosen.
///
/// The search box above it stays for the one thing the list cannot do. A trial
/// balance holds accounts that have been posted to; a heading like `10110` and
/// an account nobody has used yet are both legitimate things to open, and
/// neither has a row.
///
/// # Why nothing in the movements table sorts
///
/// `running_minor` is a window function over posting order, recomputed on
/// every read. Re-order the rows and every running figure on screen is a
/// balance that was never true at that moment. A ledger is read down the page
/// in the order it happened, so the columns are deliberately inert.
///
/// # Why the opening balance is always drawn, even at zero
///
/// Without it the first running figure is a movement wearing a balance's
/// clothes. "Zero on 1 September" is a fact somebody needs; a missing row is
/// not.
///
/// # Why asking for a heading works
///
/// Matching is by code prefix, so `1011001` is cash at every location and
/// `10110` is the whole of KAS & SETARA KAS. The caller picks the altitude,
/// which is the same trick the per-location report is built on.
export function GeneralLedgerScreen() {
  // The account lives in the URL, so "look at cash at store 07 last month" is a
  // link rather than a set of instructions. On this screen the parameter names
  // the screen's subject rather than an overlay — the same key the chart of
  // accounts opens its sheet with, so a link works from either side.
  const account = useSheet("account")
  const code = account.value ?? null

  return (
    <PageContent>
      {code === null ? (
        <TrialBalanceList onPick={account.open} />
      ) : (
        <AccountMovements code={code} onClear={account.close} />
      )}
    </PageContent>
  )
}

// ---------------------------------------------------------------------------
// Before an account is chosen: the trial balance
// ---------------------------------------------------------------------------

/// Every account that has been posted to, and the proof that the books hold.
///
/// # Why "balanced" leads, and why the server computes it
///
/// A trial balance has exactly one job before it has any others: to show that
/// total debits equal total credits. Everything else here is detail about a
/// fact that is either true or catastrophic, so the answer goes at the top in
/// words — and it is the server's answer, because a browser-side subtraction
/// over a list it had not finished loading could say "balanced" about half the
/// books.
///
/// In practice it cannot be false: the database refuses an unbalanced entry
/// with a deferred constraint trigger at COMMIT, so an imbalance here would
/// mean something got past Postgres. That is exactly why it is worth drawing —
/// the day it is false is the day somebody needs to know immediately.
///
/// # Why the foot is not the visible rows
///
/// Filtering this table is a way of looking and never a way of restating the
/// books. A foot that added up whatever was on screen would show a trial
/// balance that does not balance the moment somebody typed "kas" into the
/// search box — and it would be right to, which is exactly the alarm this
/// screen must never raise by accident. So the totals below the table are the
/// server's, sit outside it, and say so.

const trialColumns: ColumnDef<TableSetup, TrialBalanceRow>[] = [
  {
    accessorKey: "account_code",
    header: "Account",
    size: 150,
    cell: ({ row }) => (
      // No dead ends: a line of the trial balance is a question about an
      // account, and the answer is that account's own ledger — which is the
      // same screen, one row-click away.
      <AppLink
        to="/finance/ledger"
        sheet={{ key: "account", value: row.original.account_code }}
        className="font-mono text-id text-accent hover:underline"
        onClick={(event) => event.stopPropagation()}
      >
        {row.original.account_code}
      </AppLink>
    ),
  },
  {
    accessorKey: "name",
    header: "Name",
    size: 320,
    cell: ({ row }) => <span className="text-ink">{row.original.name}</span>,
  },
  {
    accessorKey: "root_class",
    header: "Class",
    size: 190,
    enableSorting: false,
    // The one narrowing a trial balance is actually read with: "show me the
    // liabilities" is how somebody checks one half of the identity without
    // scrolling past the other. The client's own name for each class, so the
    // picker reads as the column does rather than offering the digits 1 to 8.
    meta: {
      filter: {
        kind: "option",
        format: (value) => `${value} ${ROOT_CLASSES[value] ?? ""}`.trim(),
      },
    },
    cell: ({ row }) => (
      <span className="flex items-center gap-1.5">
        <Tag>{row.original.root_class}</Tag>
        <span className="truncate text-body">
          {ROOT_CLASSES[row.original.root_class] ?? "—"}
        </span>
      </span>
    ),
  },
  {
    accessorKey: "unit_id",
    header: "Unit",
    size: 130,
    enableSorting: false,
    // Nullable on purpose: a line in no unit's books has no unit, which is a
    // different thing from one whose unit we could not name.
    cell: ({ row }) => (
      <UnitName id={row.original.unit_id} className="text-body" />
    ),
  },
  {
    accessorKey: "debit_minor",
    header: "Debit",
    size: 150,
    meta: { align: "right" },
    cell: ({ row }) =>
      row.original.debit_minor === 0 ? (
        <span className="text-faint">—</span>
      ) : (
        money(row.original.debit_minor)
      ),
  },
  {
    accessorKey: "credit_minor",
    header: "Credit",
    size: 150,
    meta: { align: "right" },
    cell: ({ row }) =>
      row.original.credit_minor === 0 ? (
        <span className="text-faint">—</span>
      ) : (
        money(row.original.credit_minor)
      ),
  },
  {
    id: "net",
    // Integer minor units subtracted, never the rendered strings — and sorted
    // on this number, so the first screenful is the largest positions rather
    // than the lowest account codes.
    accessorFn: (row) => row.debit_minor - row.credit_minor,
    header: "Debit Less Credit",
    size: 160,
    // The position, and the only size question worth asking of this list: the
    // two sides beside it are movements and a big debit against a big credit
    // is a busy account, not a large one. Filtering here narrows what is SHOWN
    // and never what the books say — the totals below the table are the
    // server's and sit outside it for exactly this reason.
    meta: {
      align: "right",
      filter: { kind: "number", unit: "Rp" },
    },
    cell: ({ row }) => {
      const net = row.original.debit_minor - row.original.credit_minor
      return (
        <span className="font-medium text-ink tabular-nums">{money(net)}</span>
      )
    },
  },
]

/// How many accounts one page of the trial balance asks for. A step, not a
/// ceiling: the table asks for the next page as its last rows scroll into view.
const TRIAL_PAGE = 200

/// The columns the server can order the trial balance by, and the word it
/// knows each one as. `code` is not a word the server knows — anything it does
/// not know is the house order, by account code, which it reads in either
/// direction. Every other column carries `enableSorting: false`.
const TRIAL_SORTS: Record<string, string> = {
  account_code: "code",
  name: "name",
  debit_minor: "debit",
  credit_minor: "credit",
  net: "net",
}

function TrialBalanceList({ onPick }: { onPick: (code: string) => void }) {
  const [query, setQuery] = useState("")
  const [unit, setUnit] = useState("")
  const asOf = useAsOf()
  const [sorting, setSorting] = useState<SortingState>([
    { id: "net", desc: true },
  ])

  const filters = useFilters(trialColumns)

  /// Debounced, because every keystroke is a round trip over the books.
  const needle = useDebounced(query.trim(), 400)
  const by = sorting[0]
  const known = by === undefined ? undefined : TRIAL_SORTS[by.id]
  /// The class clause is the one column question the server answers; the
  /// same clause still runs in the browser, where it can only agree.
  const classes = filters.filters.find(
    (filter) =>
      filter.column === "root_class" &&
      filter.operator === "isAnyOf" &&
      filter.values.length > 0
  )
  const scope = {
    as_of: asOf.value,
    unit: unit || undefined,
    q: needle === "" ? undefined : needle,
    class: classes?.values.join(","),
    sort: known,
    dir: known !== undefined && by?.desc === true ? "desc" : undefined,
    limit: TRIAL_PAGE,
  }

  // A page at a time, searched and ordered on the SERVER. It used to be the
  // first five hundred accounts, searched and sorted in the browser over only
  // those. The totals and `balanced` are the whole ledger's on every page.
  const pages = useInfiniteQuery({
    queryKey: [
      ...financeKeys.trialBalance(asOf.value, unit || null),
      "pages",
      scope,
    ],
    queryFn: ({ pageParam, signal }) =>
      trialBalance({ ...scope, cursor: pageParam }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    // The previous answer stays on screen while the next is fetched. Without
    // it every keystroke empties the table to a loading line.
    placeholderData: (previous) => previous,
  })

  const rows = useMemo(
    () => pages.data?.pages.flatMap((page) => page.rows) ?? [],
    [pages.data]
  )
  const first = pages.data?.pages[0]
  const data = useMemo(
    () => (first === undefined ? undefined : { ...first, rows }),
    [first, rows]
  )
  const balance = { ...pages, data }

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns: filters.columns,
        // An account can be posted to in more than one unit's books and each is
        // its own line, so the code alone is not a key here.
        getRowId: (row: TrialBalanceRow) =>
          `${row.account_code}-${row.unit_id ?? ""}`,
        state: {
          columnFilters: filters.columnFilters,
          sorting,
        },
        // The rows arrive in the order the request asked for, and the search
        // box is the server's. Doing either again here would do it to the
        // pages in hand and call it the trial balance.
        manualSorting: true,
        onSortingChange: setSorting,
      }),
      [rows, filters.columns, filters.columnFilters, sorting]
    )
  )

  return (
    <>
      <PageHeader
        crumb="Finance"
        title="Ledger"
        sub="Every account that has been posted to, and whether the two sides agree. Open one to read it down the page."
        actions={
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="h-8 w-48"
          />
        }
      />

      {/* The list below holds only accounts that have been posted to. A
          heading, or an account nobody has used yet, is a legitimate thing to
          open and has no row — so the chart itself stays searchable here. */}
      <Card className="mb-3.5 p-3.5">
        <p className="mb-2 text-[0.875rem] text-body">
          Open any account by code or name — a heading works as well as a leaf,
          and so does one that has never been posted to.
        </p>
        <div className="max-w-md">
          <AccountPicker
            allowGroups
            onPick={(picked) => onPick(picked.account_code)}
          />
        </div>
      </Card>

      <Toolbar>
        <AsOfControl asOf={asOf} />
        <UnitSelect
          value={unit}
          onChange={setUnit}
          className="h-8 w-44"
          aria-label="Unit"
        />
        {/* Location is asked on the WIRE by the select beside this, and the
            totals under the table belong to that narrowing — a second,
            browser-side location filter would leave the rows describing one
            place and the footer another. So it is not offered in here. */}
        <FilterPanel model={filters} table={table} />
        <Toolbar.Spacer />
        {/* The server's own answer, not the boxes': it echoes the date it
            actually read at, which is the figure the totals below belong to. */}
        {balance.data && (
          <span className="text-[0.875rem] text-mute">
            As at {day(balance.data.as_of)}
            {balance.data.unit_id ? " · " : ""}
            {balance.data.unit_id && <UnitName id={balance.data.unit_id} />}
          </span>
        )}
      </Toolbar>

      {balance.data &&
        (balance.data.balanced ? (
          <Banner tone="ok" className="mb-3">
            The books balance. Debits and credits both come to{" "}
            {money(balance.data.total_debit_minor)}.
          </Banner>
        ) : (
          <Banner tone="bad" className="mb-3">
            The books do not balance: debits{" "}
            {money(balance.data.total_debit_minor)} against credits{" "}
            {money(balance.data.total_credit_minor)}. Every entry is checked at
            COMMIT, so this means something got past the database. Tell somebody
            now.
          </Banner>
        ))}

      <Card className="overflow-hidden">
        {queryState(balance, {
          loading: "Adding up the books…",
          render: () =>
            rows.length === 0 &&
            (needle !== "" || filters.filters.length > 0) ? (
              <EmptyState>
                No account matches the search and filters in force.
              </EmptyState>
            ) : rows.length === 0 ? (
              <EmptyState>
                Nothing has been posted as at this date, at any location.
              </EmptyState>
            ) : (
              <DataTable<TrialBalanceRow>
                table={table}
                onRowClick={(row) => onPick(row.account_code)}
                empty="No account matches the search and filters in force."
                more={pages}
                className="max-h-[calc(100vh-30rem)]"
              />
            ),
        })}
      </Card>

      {balance.data && (
        <div className="mt-4 max-w-sm">
          <TotalsLadder
            rows={[
              {
                label: "Total debits",
                value: money(balance.data.total_debit_minor),
              },
              {
                label: "Total credits",
                value: money(balance.data.total_credit_minor),
              },
            ]}
            total={{
              label: balance.data.balanced ? "Balanced" : "Out of balance",
              value: money(
                balance.data.total_debit_minor - balance.data.total_credit_minor
              ),
            }}
          />
          <p className="mt-2 text-[0.875rem] text-mute">
            The server's totals over every account, not a sum of the rows above
            — searching narrows what is shown and never what the books say.
          </p>
        </div>
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Once an account is chosen: what moved in it
// ---------------------------------------------------------------------------

const movementColumns: ColumnDef<TableSetup, GeneralLedgerRow>[] = [
  {
    accessorKey: "posting_date",
    header: "Date",
    size: 110,
    enableSorting: false,
    cell: ({ row }) => day(row.original.posting_date),
  },
  {
    accessorKey: "entry_number",
    header: "Entry",
    size: 150,
    enableSorting: false,
    cell: ({ row }) => (
      <AppLink
        to="/finance/journal"
        sheet={{ key: "entry", value: row.original.entry_id }}
        className="font-mono text-id text-accent hover:underline"
      >
        {row.original.entry_number}
      </AppLink>
    ),
  },
  {
    accessorKey: "source_kind",
    header: "Source",
    size: 150,
    enableSorting: false,
    // What wrote the movement. Unlike the Journal, this list has no source
    // select above it — `GET /finance/ledger/{code}` takes a unit and a
    // window and nothing else — so this column is the only place to ask.
    meta: { filter: { kind: "option", format: label } },
    cell: ({ row }) => (
      <span className="text-body">{label(row.original.source_kind)}</span>
    ),
  },
  {
    accessorKey: "category_name",
    header: "Category",
    size: 200,
    enableSorting: false,
    // The narrowing this list is actually read with, now that the chart is
    // forty accounts: "show me the electricity" used to be a different
    // account code and is now a value on this column. An option filter, like
    // Source above, because the set is closed and small — one family's worth.
    meta: { filter: { kind: "option" } },
    cell: ({ row }) =>
      row.original.category_name === null ? (
        // An account that takes no category is not a gap. Its detail is the
        // bank account, the asset or the supplier the line already names.
        <span
          className="text-faint"
          title="This account takes no category — its detail is the bank account, asset, supplier or facility the line names."
        >
          —
        </span>
      ) : (
        <span
          className="text-body"
          title={row.original.category_code ?? undefined}
        >
          {row.original.category_name}
        </span>
      ),
  },
  {
    accessorKey: "unit_id",
    header: "Unit",
    size: 120,
    enableSorting: false,
    cell: ({ row }) => (
      <UnitName id={row.original.unit_id} className="text-body" />
    ),
  },
  {
    accessorKey: "memo",
    header: "Memo",
    size: 260,
    enableSorting: false,
    cell: ({ row }) => (
      <span className="text-text">{row.original.memo ?? "—"}</span>
    ),
  },
  {
    accessorKey: "debit_minor",
    header: "Debit",
    size: 140,
    enableSorting: false,
    meta: {
      align: "right",
      filter: { kind: "number", unit: "Rp" },
    },
    cell: ({ row }) =>
      row.original.debit_minor === 0 ? (
        <span className="text-faint">—</span>
      ) : (
        money(row.original.debit_minor)
      ),
  },
  {
    accessorKey: "credit_minor",
    header: "Credit",
    size: 140,
    enableSorting: false,
    // Both sides, and separately: "what came out of this account over a
    // million" is a credit question, and a single "size" field would make the
    // reader say which side in prose.
    meta: {
      align: "right",
      filter: { kind: "number", unit: "Rp" },
    },
    cell: ({ row }) =>
      row.original.credit_minor === 0 ? (
        <span className="text-faint">—</span>
      ) : (
        money(row.original.credit_minor)
      ),
  },
  {
    accessorKey: "running_minor",
    header: "Running",
    size: 160,
    enableSorting: false,
    meta: { align: "right" },
    cell: ({ row }) => (
      <span
        className={
          row.original.running_minor < 0
            ? "font-medium text-bad-fg tabular-nums"
            : "font-medium text-ink tabular-nums"
        }
      >
        {money(row.original.running_minor)}
      </span>
    ),
  },
]

/// How many movements one page of an account's ledger asks for. A step, not a
/// ceiling: the table asks for the next page as its last rows scroll into view.
const LEDGER_PAGE = 100

function AccountMovements({
  code,
  onClear,
}: {
  code: string
  onClear: () => void
}) {
  const [query, setQuery] = useState("")
  const [unit, setUnit] = useState("")
  const range = useWindow()

  /// Debounced, because every keystroke is a round trip over the window.
  const needle = useDebounced(query.trim(), 400)

  // A page at a time, in the order the running balance was accumulated in,
  // searched on the SERVER (entry number, memo, source document). It used to
  // be the first two hundred movements of the window with nothing saying so,
  // searched in the browser over only those.
  const pages = useInfiniteQuery({
    queryKey: [
      ...financeKeys.ledger(code, unit || null, range.from, range.to),
      "pages",
      needle,
    ],
    queryFn: ({ pageParam, signal }) =>
      accountLedger(
        code,
        {
          unit: unit || undefined,
          from: range.from,
          to: range.to,
          q: needle === "" ? undefined : needle,
          limit: LEDGER_PAGE,
          cursor: pageParam,
        },
        signal
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    // The previous answer stays on screen while the next is fetched. Without
    // it every keystroke empties the table to a loading line.
    placeholderData: (previous) => previous,
  })

  /// The window's own figures — opening, closing, name — are the same on
  /// every page, so they are read off the first; the rows are every page's.
  const rows = useMemo(
    () => pages.data?.pages.flatMap((page) => page.rows) ?? [],
    [pages.data]
  )
  const first = pages.data?.pages[0]
  const data = useMemo(
    () => (first === undefined ? undefined : { ...first, rows }),
    [first, rows]
  )
  const ledger = { ...pages, data }

  const filters = useFilters(movementColumns)

  /// Where this account stood, day by day, across the window.
  ///
  /// # Why a line and not bars
  ///
  /// A running balance is a *level*. Bars invite the eye to add adjacent
  /// values together, and adding two running balances is meaningless — the
  /// second already contains the first. The movements below are the
  /// quantities; this is the shape they add up to.
  ///
  /// # One point per day, not per movement
  ///
  /// A busy account takes several entries on one date and the axis has one
  /// tick for it, so the point is the balance the day *closed* on — the last
  /// running figure the server sent for that date. The rows arrive in
  /// posting order, so "last wins" is the closing figure and not an arbitrary
  /// one of several.
  ///
  /// The opening balance is prepended when nothing moved on the first day of
  /// the window, and deliberately not when something did: on a day with
  /// movements the point already carries the opening plus that day’s
  /// activity, and drawing both would put two values on one tick.
  ///
  /// Nothing is fetched for this. It is the response the table is built from,
  /// including the `running_minor` the server computed — this chart adds no
  /// figure of its own.
  const running = useMemo(() => {
    if (ledger.data === undefined) return []
    const byDay = new Map<string, number>()
    for (const row of ledger.data.rows) {
      byDay.set(row.posting_date, row.running_minor)
    }
    const points = [...byDay.entries()].map(([bucket, balance]) => ({
      bucket,
      balance,
    }))
    if (!byDay.has(ledger.data.from)) {
      points.unshift({
        bucket: ledger.data.from,
        balance: ledger.data.opening_minor,
      })
    }
    return points
  }, [ledger.data])

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns: filters.columns,
        // An entry can touch one account twice — a correction posted against
        // itself — so `entry_id` alone is not a key.
        getRowId: (row: GeneralLedgerRow) =>
          `${row.entry_id}-${row.posting_date}-${row.debit_minor}-${row.credit_minor}-${row.running_minor}`,
        // The search box is the server's; the column clauses narrow the pages
        // in hand, and the table keeps reading while they leave its end in view.
        state: { columnFilters: filters.columnFilters },
      }),
      [rows, filters.columns, filters.columnFilters]
    )
  )

  return (
    <>
      <PageHeader
        crumb="Finance"
        title="Ledger"
        sub="One account, down the page, in the order it happened."
        actions={
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="h-8 w-48"
          />
        }
      />

      <Toolbar>
        <Tag tone="accent">{code}</Tag>
        <WindowControl range={range} />
        <UnitSelect
          value={unit}
          onChange={setUnit}
          className="h-8 w-44"
          aria-label="Unit"
        />
        {/* Running is not offered, and it is the one refusal worth stating: it
            is a level and every figure in it already contains the rows above.
            Hiding rows out of the middle leaves the column stepping over gaps
            it cannot explain — true of the search box beside it too, which is
            why the opening and closing figures are drawn outside the table. */}
        <FilterPanel model={filters} table={table} />
        <Toolbar.Spacer />
        {/* Back to the trial balance, which is where the accounts are — not to
            an empty card asking which one. */}
        <button
          type="button"
          onClick={onClear}
          className="text-[0.875rem] font-medium text-accent hover:underline"
        >
          Choose another account
        </button>
      </Toolbar>

      {/* Two points is a line segment and not a shape; one is a dot. Below
          that the movements table says everything the chart could. */}
      {running.length > 2 && (
        <Card className="mb-3">
          <CardHeader>
            <CardTitle>Running balance</CardTitle>
            <span className="text-[0.875rem] text-mute">
              Where the account closed on each day that moved
              {/* Drawn from the movements read so far, which run in date
                  order — so while more remain it stops short, and says where. */}
              {pages.hasNextPage &&
                rows.length > 0 &&
                ` · through ${day(rows[rows.length - 1].posting_date)}, as far as the list below has read`}
            </span>
          </CardHeader>
          <div className="px-4 pb-3.5">
            <LineSeries
              rows={running}
              dataKey="balance"
              label="Balance"
              format={money}
              labelOf={(bucket) =>
                dateText(new Date(`${bucket}T00:00:00`), {
                  day: "2-digit",
                  month: "short",
                })
              }
              titleOf={(bucket) => day(bucket)}
              className="h-[9.5rem]"
            />
          </div>
        </Card>
      )}

      <Card className="overflow-hidden">
        {queryState(ledger, {
          loading: "Reading the account…",
          render: (data) => (
            <>
              <CardStrip>
                <span className="min-w-0 flex-1 truncate text-card-title font-semibold text-ink">
                  {data.account_name}
                </span>
                <span className="shrink-0 text-[0.875rem] text-body tabular-nums">
                  {day(data.from)} – {day(data.to)}
                </span>
              </CardStrip>

              {/* Always drawn, even at zero: the first running figure would
                  otherwise be a movement pretending to be a balance. */}
              <div className="flex items-center justify-between border-b border-hairline bg-soft px-3.5 py-2 text-cell">
                <span className="font-medium text-body">Opening balance</span>
                <span className="font-medium text-ink tabular-nums">
                  {money(data.opening_minor)}
                </span>
              </div>

              {data.rows.length === 0 && needle !== "" ? (
                <EmptyState>
                  No movement between {day(data.from)} and {day(data.to)}{" "}
                  matches “{needle}”.
                </EmptyState>
              ) : data.rows.length === 0 ? (
                <EmptyState>
                  Nothing moved in this account between {day(data.from)} and{" "}
                  {day(data.to)}.
                </EmptyState>
              ) : (
                <DataTable<GeneralLedgerRow>
                  table={table}
                  empty="No movement matches the search and filters in force."
                  more={pages}
                  className={
                    running.length > 2
                      ? "max-h-[calc(100vh-40rem)]"
                      : "max-h-[calc(100vh-26rem)]"
                  }
                />
              )}
            </>
          ),
        })}
      </Card>

      {ledger.data && (
        <div className="mt-4 max-w-sm">
          <TotalsLadder
            rows={[
              { label: "Opening", value: money(ledger.data.opening_minor) },
              {
                label: "Movement in the window",
                value: money(
                  ledger.data.closing_minor - ledger.data.opening_minor
                ),
              },
            ]}
            total={{
              label: "Closing",
              value: money(ledger.data.closing_minor),
            }}
          />
        </div>
      )}
    </>
  )
}
