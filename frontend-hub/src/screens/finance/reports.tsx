import { useQuery } from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { AppLink } from "@/components/ui/app-link"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { TotalsLadder } from "@/components/ui/rows"
import { PageHeader } from "@/components/ui/page-header"
import { Toolbar } from "@/components/ui/segmented"
import { SubTabs } from "@/components/ui/sub-tabs"
import { Banner, EmptyState } from "@/components/ui/states"
import { day, money } from "@/lib/format"
import {
  balanceMatrix,
  financeKeys,
  statement,
  type StatementKind,
} from "@/lib/queries/finance"
import { queryState } from "@/lib/query-state"
import { tableSetup, type TableSetup } from "@/lib/table"
import { cn } from "@/lib/utils"
import {
  asPresented,
  ladderLevel,
  ROOT_CLASSES,
} from "@/screens/finance/chart"
import {
  Amount,
  AsOfControl,
  Check,
  LocationSelect,
  SiteName,
  useAsOf,
  useWindow,
  WindowControl,
} from "@/screens/finance/parts"
import type { BalanceRow, StatementSection } from "@itulah/contract"

/// What the books say: the balance sheet and the profit and loss, from the
/// client's own root classes — and the balance sheet read across locations.
///
/// # Why the presentation flips the sign and the ledger does not
///
/// The server sends every figure as the ledger holds it: debits positive. That
/// is the honest storage — a balance does not know whether it is about to be
/// printed on a page where liabilities read as positive numbers. A statement
/// does know. Liabilities, equity and income are credit-natured, so they are
/// negative in the ledger and are shown flipped here. Doing it in the server
/// would mean the same number came back differently depending on which screen
/// asked, which is how two reports end up disagreeing about a figure they both
/// got right.
///
/// # Why "out of balance" is the server's number
///
/// A page that subtracted its own visible rows would report "balanced" about a
/// list it had not finished loading. `out_of_balance_minor` is assets minus
/// liabilities, equity *and* the period's result, and zero is the only correct
/// answer.
///
/// # Why a balance sheet carries a result at all
///
/// Classes 1, 2 and 3 alone do not balance, and that is not a fault: profit
/// earned and not yet closed to equity is sitting in the income and expense
/// classes. The client keeps a line for it — `3013001003 Laba (Rugi) bulan
/// berjalan` — and `result_minor` is that figure.
///
/// # Why "per location" is a toggle here and was a screen of its own
///
/// There used to be a Position screen: nine hard-coded family tabs over
/// `GET /balances`, plus a box to type any code in the chart. It was the same
/// question this page already asks — *what do we hold, and what do we owe* —
/// asked one subtree at a time, so somebody comparing the two reports had to
/// hold the answer in their head across a nav click. It is now a reading of
/// the balance sheet: same three root classes, same as-of date, broken out by
/// location instead of consolidated. The typed-code box went with it; the
/// altitude an accountant actually wanted from it — one account across every
/// location — is the Ledger, which takes a heading as readily as a leaf.
export function Reports() {
  const [kind, setKind] = useState<StatementKind>("BALANCE_SHEET")
  const [site, setSite] = useState("")
  const [perLocation, setPerLocation] = useState(false)

  // The two tabs ask different shapes of question, so they carry different
  // date controls rather than one pair of boxes doing duty for both. A balance
  // sheet is a moment; a profit and loss is a window. Both hooks run on both
  // tabs — a hook cannot be called conditionally, and the cost of the unused
  // one is a cached list of periods the sidebar already holds.
  const asOf = useAsOf()
  const range = useWindow()

  // Per-location is a balance-sheet reading only, so the P&L tab shows the
  // toggle off and disabled rather than hiding it — a control that appears and
  // disappears between tabs reads as a bug, and the reason it cannot work here
  // is worth one sentence on the page.
  const spread = kind === "BALANCE_SHEET" && perLocation

  // A balance sheet sends only its as-at date; the server's `from` is what
  // makes a statement a period report, and a balance sheet is not one.
  const from = kind === "PROFIT_LOSS" ? range.from : ""
  const to = kind === "PROFIT_LOSS" ? range.to : asOf.value

  const report = useQuery({
    queryKey: financeKeys.statement(
      kind,
      from || null,
      to || null,
      site || null
    ),
    queryFn: ({ signal }) =>
      statement(
        kind,
        {
          from: from || undefined,
          to: to || undefined,
          site: site || undefined,
        },
        signal
      ),
    // Nothing is asked of `/statement` while the grid is up: the grid is three
    // reads of its own and the consolidated figures are not on screen.
    enabled: !spread,
  })

  return (
    <PageContent>
      <PageHeader
        crumb="Finance"
        title="Reports"
        sub="The two reports, built from the client's own root classes and their own words."
      />

      {/* Two different datasets, not two slices of one — hence sub-tabs rather
          than a segmented control. */}
      <SubTabs
        value={kind}
        onChange={(next) => setKind(next as StatementKind)}
        tabs={[
          { value: "BALANCE_SHEET", label: "Balance sheet" },
          { value: "PROFIT_LOSS", label: "Profit & loss" },
        ]}
      />

      <Toolbar>
        {kind === "PROFIT_LOSS" ? (
          <WindowControl range={range} />
        ) : (
          <AsOfControl asOf={asOf} />
        )}
        {/* One location, or every location broken out — asking for both at once
            is a filter fighting the thing it filters, so the select goes away.
            It is a select and not a box: the ids are `dc` and `store-01`, which
            nothing on the page ever said, so typing was a quiz. */}
        {!spread && (
          <LocationSelect
            value={site}
            onChange={setSite}
            className="h-8 w-44"
            aria-label="Location"
          />
        )}
        <Check
          label="Per location"
          checked={spread}
          disabled={kind === "PROFIT_LOSS"}
          onChange={(event) => setPerLocation(event.target.checked)}
          // The gap is on the server and not here. `GET /balances` takes
          // `family` + `as_of` only — `MatrixQuery` in
          // `backend/src/cloud/http/finance.rs` has no `from`, and a balance at
          // a date cannot be turned into a movement over a window without
          // subtracting two of them per account per location. Doing that
          // subtraction in the browser would put a number on screen that the
          // server never computed and cannot be asked to confirm, which is the
          // one thing no figure on this page is allowed to be. A per-location
          // P&L needs the endpoint to take a window.
          hint={
            kind === "PROFIT_LOSS"
              ? "Balances are a moment, not a window — the endpoint behind this takes only a family and an as-of date."
              : undefined
          }
        />
        <Toolbar.Spacer />
        {/* The effective answer, in words, always. A date box left blank and a
            date box filled with today look identical to a reader; the sentence
            is what tells them which report they are looking at. */}
        <span className="text-[0.71875rem] text-mute">
          {kind === "PROFIT_LOSS" ? range.chip : asOf.chip}
          {spread ? " · every location, broken out" : ""}
        </span>
      </Toolbar>

      {spread ? (
        <div className="flex flex-col gap-3">
          {SPREAD_CLASSES.map((rootCode) => (
            <LocationSpread
              key={rootCode}
              rootCode={rootCode}
              asOf={asOf.value}
            />
          ))}
        </div>
      ) : (
        <>
          {report.data && report.data.out_of_balance_minor !== 0 && (
            <Banner tone="bad" className="mb-3">
              Out of balance by {money(report.data.out_of_balance_minor)}.
              Assets less liabilities, equity and the period's result should be
              zero.
            </Banner>
          )}

          {queryState(report, {
            loading: "Building the statement…",
            render: (data) =>
              data.sections.length === 0 ? (
                <Card>
                  <EmptyState>
                    Nothing has been posted in this window, so there is no
                    statement to draw.
                  </EmptyState>
                </Card>
              ) : (
                <div className="flex flex-col gap-3">
                  <p className="text-[0.71875rem] text-mute">
                    {data.from ? `${day(data.from)} – ` : "As at "}
                    {day(data.to)}
                    {data.site_id ? ` · ${data.site_id}` : " · every location"}
                  </p>

                  {data.sections.map((section) => (
                    <Section key={section.root_class} section={section} />
                  ))}

                  {data.kind === "BALANCE_SHEET" && (
                    <Card>
                      <CardHeader>
                        <CardTitle>Result for the period</CardTitle>
                        <span className="text-[0.9375rem] font-semibold text-ink tabular-nums">
                          {money(data.result_minor)}
                        </span>
                      </CardHeader>
                      <p className="px-4 pb-3.5 text-[0.71875rem] text-body">
                        Income less expenses, classes 4 through 8 netted. It is
                        what makes classes 1, 2 and 3 add up — profit earned and
                        not yet closed to equity. The client's own line for it
                        is{" "}
                        <AppLink
                          to="/finance/ledger"
                          sheet={{ key: "account", value: "3013001003" }}
                          className="font-mono text-id text-accent hover:underline"
                        >
                          3013001003
                        </AppLink>
                        .
                      </p>
                    </Card>
                  )}
                </div>
              ),
          })}
        </>
      )}
    </PageContent>
  )
}

/// The three root classes a balance sheet is made of, in the client's order.
///
/// Not the eight: 4 through 8 are the profit and loss, and they are on the
/// other tab. `ROOT_CLASSES` carries their names.
const SPREAD_CLASSES = ["1", "2", "3"] as const

/// One root class of the balance sheet, account by account and location by
/// location.
///
/// # Why the columns are built rather than declared
///
/// This is the one table in the app whose columns are data. The locations come
/// back with the balances, and a screen that hard-coded fourteen of them would
/// be wrong the day the client opens a fifteenth. Building them also buys the
/// thing a hand-written grid could not give: every location sorts, so "which
/// shop is holding the cash" stops being a question you answer by reading
/// fourteen numbers across a row, once per row.
///
/// # Why the per-location totals are in the headers
///
/// They used to be a fourteen-row ladder under the table, repeating the
/// server's `column_totals` in a second place a reader had to scroll to and
/// match up by name. A column total belongs at the top of its column. It is
/// still the server's figure and never a sum of what is on screen — the grand
/// total below says so for both.
function LocationSpread({ rootCode, asOf }: { rootCode: string; asOf: string }) {
  const [sorting, setSorting] = useState<SortingState>([
    { id: "total_minor", desc: true },
  ])

  const matrix = useQuery({
    queryKey: financeKeys.balances(rootCode, asOf),
    queryFn: ({ signal }) => balanceMatrix(rootCode, asOf, signal),
  })

  const locations = useMemo(() => matrix.data?.locations ?? [], [matrix.data])
  const columnTotals = useMemo(
    () => matrix.data?.column_totals ?? [],
    [matrix.data]
  )
  const rows = useMemo(() => matrix.data?.rows ?? [], [matrix.data])

  const columns = useMemo<ColumnDef<TableSetup, BalanceRow>[]>(
    () => [
      {
        accessorKey: "name",
        header: "Account",
        size: 300,
        cell: ({ row }) => (
          <span className="flex min-w-0 items-center gap-2">
            <AppLink
              to="/finance/ledger"
              sheet={{ key: "account", value: row.original.account_code }}
              className="shrink-0 font-mono text-[0.65625rem] text-mute hover:text-accent hover:underline"
            >
              {row.original.account_code}
            </AppLink>
            <span className="truncate text-ink">{row.original.name}</span>
          </span>
        ),
      },
      ...locations.map(
        (site, index): ColumnDef<TableSetup, BalanceRow> => ({
          id: `site-${site}`,
          // The cells are read by index and not by key, because that is how the
          // server sends them: aligned with `locations`, so a location with
          // nothing posted is a zero and never a gap. "No cash at store 07" and
          // "we never asked about store 07" look the same in a sparse map and
          // are very different things to an accountant.
          accessorFn: (row) => row.cells[index] ?? 0,
          // The client's own name for the location — "Store 07", not
          // `store-07`. The id is what the account codes carry and what a
          // support call will be about, so `<SiteName>` keeps it in `title`
          // rather than dropping it. Under the name, the server's total for
          // the column.
          header: () => (
            <span className="inline-flex flex-col items-end leading-tight">
              <SiteName id={site} />
              <span className="text-[0.625rem] font-normal text-faint tabular-nums">
                {money(columnTotals[index] ?? 0)}
              </span>
            </span>
          ),
          size: 130,
          meta: { align: "right" },
          cell: ({ row }) => (
            <Amount minor={row.original.cells[index] ?? 0} muteZero />
          ),
        })
      ),
      {
        accessorKey: "total_minor",
        header: "Total",
        size: 150,
        meta: { align: "right" },
        cell: ({ row }) => (
          <span className="font-medium text-ink tabular-nums">
            {money(row.original.total_minor)}
          </span>
        ),
      },
    ],
    [locations, columnTotals]
  )

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns,
        getRowId: (row: BalanceRow) => row.account_code,
        state: { sorting },
        onSortingChange: setSorting,
      }),
      [rows, columns, sorting]
    )
  )

  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle>
          <span className="font-mono text-id text-mute">{rootCode}</span>{" "}
          {matrix.data?.family_name ?? ROOT_CLASSES[rootCode] ?? "—"}
        </CardTitle>
        {matrix.data && (
          <span className="text-[0.71875rem] text-mute">
            as at {day(matrix.data.as_of)}
          </span>
        )}
      </CardHeader>

      <div className="border-t border-hairline">
        {queryState(matrix, {
          loading: "Reading the balances…",
          render: (data) =>
            data.rows.length === 0 ? (
              <EmptyState>
                Nothing has been posted to {data.family_name} yet, at any
                location. These accounts exist in the chart and have never been
                used.
              </EmptyState>
            ) : (
              <>
                <DataTable<BalanceRow>
                  table={table}
                  className="max-h-[32rem]"
                />
                <div className="px-4 py-3">
                  <TotalsLadder
                    className="max-w-sm"
                    rows={[]}
                    total={{
                      label: "Every location",
                      value: money(data.grand_total_minor),
                    }}
                  />
                  <p className="mt-1 max-w-sm text-[0.71875rem] text-mute">
                    The server's total for the whole class, and the column heads
                    are its per-location totals. Neither is a sum of the rows on
                    screen.
                  </p>
                </div>
              </>
            ),
        })}
      </div>
    </Card>
  )
}

/// One root class, with the headings under it that actually moved.
function Section({ section }: { section: StatementSection }) {
  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle>
          <span className="font-mono text-id text-mute">
            {section.root_class}
          </span>{" "}
          {section.title}
        </CardTitle>
        <span className="text-[0.9375rem] font-semibold text-ink tabular-nums">
          {money(asPresented(section.total_minor, section.root_class))}
        </span>
      </CardHeader>

      {section.lines.length === 0 ? (
        <p className="border-t border-hairline px-4 py-3 text-[0.71875rem] text-mute">
          Nothing under this class has moved.
        </p>
      ) : (
        <div className="border-t border-hairline">
          {section.lines.map((line) => {
            const level = ladderLevel(line.depth)
            return (
              <div
                key={`${line.account_code}-${line.depth}`}
                className="flex items-center gap-3 border-b border-hairline py-[0.4375rem] pr-4 text-cell last:border-b-0"
                style={{ paddingLeft: `${1 + level * 1.125}rem` }}
              >
                <AppLink
                  to="/finance/ledger"
                  sheet={{ key: "account", value: line.account_code }}
                  className="shrink-0 font-mono text-[0.65625rem] text-mute hover:text-accent hover:underline"
                >
                  {line.account_code}
                </AppLink>
                <span
                  className={cn(
                    "min-w-0 flex-1 truncate",
                    line.is_group ? "font-medium text-ink" : "text-text"
                  )}
                >
                  {line.name}
                </span>
                <span
                  className={cn(
                    "shrink-0 tabular-nums",
                    line.is_group ? "font-medium text-ink" : "text-text"
                  )}
                >
                  {money(asPresented(line.amount_minor, section.root_class))}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </Card>
  )
}
