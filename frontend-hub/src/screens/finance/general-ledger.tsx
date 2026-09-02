import { useQuery } from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { AppLink } from "@/components/ui/app-link"
import { Card, CardStrip } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Input } from "@/components/ui/field"
import { TotalsLadder } from "@/components/ui/rows"
import { PageHeader } from "@/components/ui/page-header"
import { Toolbar } from "@/components/ui/segmented"
import { Banner, EmptyState } from "@/components/ui/states"
import { Tag } from "@/components/ui/tag"
import { day, label, money } from "@/lib/format"
import {
  accountLedger,
  financeKeys,
  trialBalance,
} from "@/lib/queries/finance"
import { queryState } from "@/lib/query-state"
import { useSheet } from "@/lib/sheets"
import { tableSetup, type TableSetup } from "@/lib/table"
import { ROOT_CLASSES } from "@/screens/finance/chart"
import { useAsOf, useWindow } from "@/screens/finance/hooks"
import {
  AccountPicker,
  AsOfControl,
  LocationSelect,
  SiteName,
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
    accessorKey: "site_id",
    header: "Location",
    size: 130,
    // Nullable on purpose: an account that is not scoped to a location has no
    // site, which is a different thing from one whose site we could not name.
    cell: ({ row }) => (
      <SiteName id={row.original.site_id} className="text-body" />
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
    header: "Debit less credit",
    size: 160,
    meta: { align: "right" },
    cell: ({ row }) => {
      const net = row.original.debit_minor - row.original.credit_minor
      return (
        <span className="font-medium text-ink tabular-nums">{money(net)}</span>
      )
    },
  },
]

function TrialBalanceList({ onPick }: { onPick: (code: string) => void }) {
  const [query, setQuery] = useState("")
  const [site, setSite] = useState("")
  const asOf = useAsOf()
  const [sorting, setSorting] = useState<SortingState>([
    { id: "net", desc: true },
  ])

  const balance = useQuery({
    queryKey: financeKeys.trialBalance(asOf.value, site || null),
    queryFn: ({ signal }) =>
      trialBalance(
        { as_of: asOf.value, site: site || undefined },
        signal
      ),
  })

  const rows = useMemo(() => balance.data?.rows ?? [], [balance.data])

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns: trialColumns,
        // An account can be posted to at more than one location and each is its
        // own line, so the code alone is not a key here.
        getRowId: (row: TrialBalanceRow) =>
          `${row.account_code}-${row.site_id ?? ""}`,
        state: { globalFilter: query, sorting },
        onSortingChange: setSorting,
        onGlobalFilterChange: setQuery,
      }),
      [rows, query, sorting]
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
            placeholder="Search"
            className="h-8 w-48"
          />
        }
      />

      {/* The list below holds only accounts that have been posted to. A
          heading, or an account nobody has used yet, is a legitimate thing to
          open and has no row — so the chart itself stays searchable here. */}
      <Card className="mb-3.5 p-3.5">
        <p className="mb-2 text-[0.71875rem] text-body">
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
        <LocationSelect
          value={site}
          onChange={setSite}
          className="h-8 w-44"
          aria-label="Location"
        />
        <Toolbar.Spacer />
        {/* The server's own answer, not the boxes': it echoes the date it
            actually read at, which is the figure the totals below belong to. */}
        {balance.data && (
          <span className="text-[0.71875rem] text-mute">
            As at {day(balance.data.as_of)}
            {balance.data.site_id ? " · " : ""}
            {balance.data.site_id && <SiteName id={balance.data.site_id} />}
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
            rows.length === 0 ? (
              <EmptyState>
                Nothing has been posted as at this date, at any location.
              </EmptyState>
            ) : (
              <DataTable<TrialBalanceRow>
                table={table}
                onRowClick={(row) => onPick(row.account_code)}
                empty="No account matches that search."
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
          <p className="mt-2 text-[0.71875rem] text-mute">
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
    cell: ({ row }) => (
      <span className="text-body">{label(row.original.source_kind)}</span>
    ),
  },
  {
    accessorKey: "site_id",
    header: "Location",
    size: 120,
    enableSorting: false,
    cell: ({ row }) => (
      <SiteName id={row.original.site_id} className="text-body" />
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
    size: 140,
    enableSorting: false,
    meta: { align: "right" },
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

function AccountMovements({
  code,
  onClear,
}: {
  code: string
  onClear: () => void
}) {
  const [query, setQuery] = useState("")
  const [site, setSite] = useState("")
  const range = useWindow()

  const ledger = useQuery({
    queryKey: financeKeys.ledger(code, site || null, range.from, range.to),
    queryFn: ({ signal }) =>
      accountLedger(
        code,
        {
          site: site || undefined,
          from: range.from,
          to: range.to,
        },
        signal
      ),
  })

  const rows = useMemo(() => ledger.data?.rows ?? [], [ledger.data])

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns: movementColumns,
        // An entry can touch one account twice — a correction posted against
        // itself — so `entry_id` alone is not a key.
        getRowId: (row: GeneralLedgerRow) =>
          `${row.entry_id}-${row.posting_date}-${row.debit_minor}-${row.credit_minor}-${row.running_minor}`,
        state: { globalFilter: query },
        onGlobalFilterChange: setQuery,
      }),
      [rows, query]
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
            placeholder="Search memos"
            className="h-8 w-48"
          />
        }
      />

      <Toolbar>
        <Tag tone="accent">{code}</Tag>
        <WindowControl range={range} />
        <LocationSelect
          value={site}
          onChange={setSite}
          className="h-8 w-44"
          aria-label="Location"
        />
        <Toolbar.Spacer />
        {/* Back to the trial balance, which is where the accounts are — not to
            an empty card asking which one. */}
        <button
          type="button"
          onClick={onClear}
          className="text-[0.71875rem] font-medium text-accent hover:underline"
        >
          Choose another account
        </button>
      </Toolbar>

      <Card className="overflow-hidden">
        {queryState(ledger, {
          loading: "Reading the account…",
          render: (data) => (
            <>
              <CardStrip>
                <span className="min-w-0 flex-1 truncate text-card-title font-semibold text-ink">
                  {data.account_name}
                </span>
                <span className="shrink-0 text-[0.71875rem] text-body tabular-nums">
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

              {data.rows.length === 0 ? (
                <EmptyState>
                  Nothing moved in this account between {day(data.from)} and{" "}
                  {day(data.to)}.
                </EmptyState>
              ) : (
                <DataTable<GeneralLedgerRow>
                  table={table}
                  empty="No movement matches that search."
                  className="max-h-[calc(100vh-26rem)]"
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
