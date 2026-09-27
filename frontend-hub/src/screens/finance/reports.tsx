import { useQuery } from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { ChevronRight } from "lucide-react"
import { useMemo, useState } from "react"
import { Checkbox } from "@/components/ui/field"

import { PageContent } from "@/components/shell/app-shell"
import { AppLink } from "@/components/ui/app-link"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { BarSeries, type ChartSeries } from "@/components/ui/chart"
import { DataTable } from "@/components/ui/data-table"
import { TotalsLadder } from "@/components/ui/rows"
import { PageHeader } from "@/components/ui/page-header"
import { Toolbar } from "@/components/ui/segmented"
import { SubTabs } from "@/components/ui/sub-tabs"
import { Banner, EmptyState } from "@/components/ui/states"
import { day, money } from "@/lib/format"
import {
  accountChildren,
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
  periodResult,
  ROOT_CLASSES,
  ROOT_CLASSES_SHORT,
} from "@/screens/finance/chart"
import { useAsOf, useWindow } from "@/screens/finance/hooks"
import {
  Amount,
  AsOfControl,
  LocationSelect,
  RankedBars,
  SiteName,
  WindowControl,
} from "@/screens/finance/parts"
import type { BalanceRow, StatementSection } from "@itulah/contract"

/// One bar per section of the profit and loss.
///
/// `accent` and nothing else: the sections are five readings of one figure —
/// where the money went — and a second hue would say they are two kinds of
/// thing.
const SECTION_SERIES: readonly ChartSeries[] = [
  { key: "total", label: "For the period", tone: "accent" },
]

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
/// location instead of consolidated.
///
/// The typed-code box went with it, and for one pass so did the altitude it
/// bought: three root classes over an endpoint that answers with immediate
/// children only is three coarse rows apiece, and "cash on hand per store" was
/// no longer askable. It is back as a descent rather than as a box — the tree
/// is in the codes, so a row's own name walks into it and the crumbs above say
/// where that is. Typing `1011001` was a quiz; clicking KAS & SETARA KAS is
/// not.
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
            It is a select and not a box: the ids are `ho` and `store-01`, which
            nothing on the page ever said, so typing was a quiz. */}
        {!spread && (
          <LocationSelect
            value={site}
            onChange={setSite}
            className="h-8 w-44"
            aria-label="Location"
          />
        )}
        <Checkbox
          label="Per location"
          checked={spread}
          disabled={kind === "PROFIT_LOSS"}
          onChange={(next) => setPerLocation(next)}
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
              ? // Short enough to sit on the toolbar’s one row. The whole
                // reason is in the comment above and in the doc at the top of
                // this file; the page needs the fact, not the argument.
                "A balance is a moment, not a window."
              : undefined
          }
        />
        <Toolbar.Spacer />
        {/* The effective answer, in words, always. A date box left blank and a
            date box filled with today look identical to a reader; the sentence
            is what tells them which report they are looking at. */}
        <span className="text-[0.875rem] text-mute">
          {kind === "PROFIT_LOSS" ? range.chip : asOf.chip}
          {spread ? (
            " · every location, broken out"
          ) : site === "" ? (
            " · every location"
          ) : (
            <>
              {" · "}
              <SiteName id={site} />
            </>
          )}
        </span>
      </Toolbar>

      {spread ? (
        <div className="flex flex-col gap-3">
          {SPREAD_CLASSES.map((rootCode) => (
            <LocationSpread
              // The as-of date is part of the key, so moving it starts a fresh
              // reading rather than leaving somebody four levels down a class
              // with the crumbs of a descent they made against another date.
              // Switching the toggle off is the other half of that reset: it
              // unmounts these outright.
              key={`${rootCode}:${asOf.value}`}
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
                  {/* The shape of the period, before the detail of it. Only
                      on the profit and loss: a balance sheet's three classes
                      are assets against liabilities and equity, and drawing
                      them as three bars of one series would invite somebody
                      to read a total across the accounting identity. */}
                  {data.kind === "PROFIT_LOSS" && (
                    <Card>
                      <CardHeader>
                        <CardTitle>By class</CardTitle>
                        <span className="text-[0.875rem] text-mute">
                          The client's own root classes, as the report prints
                          them
                        </span>
                      </CardHeader>
                      <div className="grid gap-x-6 gap-y-4 px-4 pb-3.5 xl:grid-cols-[minmax(0,1fr)_20rem]">
                        <BarSeries
                          rows={data.sections.map((section) => ({
                            bucket: section.root_class,
                            total: asPresented(
                              section.total_minor,
                              section.root_class
                            ),
                          }))}
                          series={SECTION_SERIES}
                          format={money}
                          // The client's own name for the class, shortened, on
                          // the axis — and the whole of it in the tooltip. The
                          // bare class number was here, which is a chart of the
                          // chart of accounts' internal numbering rather than
                          // of the business: "7" is not a thing anybody spends
                          // money on.
                          labelOf={(bucket) =>
                            ROOT_CLASSES_SHORT[bucket] ?? bucket
                          }
                          titleOf={(bucket) =>
                            data.sections.find(
                              (section) => section.root_class === bucket
                            )?.title ??
                            ROOT_CLASSES[bucket] ??
                            bucket
                          }
                          className="h-[9.5rem]"
                        />
                        <TotalsLadder
                          rows={data.sections.map((section) => ({
                            label: (
                              <span className="flex min-w-0 items-center gap-1.5">
                                <span className="font-mono text-id text-mute">
                                  {section.root_class}
                                </span>
                                <span className="truncate">
                                  {section.title}
                                </span>
                              </span>
                            ),
                            value: money(
                              asPresented(
                                section.total_minor,
                                section.root_class
                              )
                            ),
                          }))}
                          // The server's own bottom line, not a sum of the
                          // bars beside it. It is computed from the journal
                          // rather than by adding the sections up, so a
                          // disagreement here is a bug showing itself instead
                          // of hiding inside the figure that should catch it.
                          //
                          // Negated and named by its sign, because the wire
                          // speaks debits-positive: a loss arrives POSITIVE,
                          // and this card printed a 33-million loss as though
                          // it were a profit. See `periodResult`.
                          total={{
                            label: periodResult(data.result_minor).label,
                            value: (
                              <span
                                className={
                                  periodResult(data.result_minor).loss
                                    ? "text-bad-fg"
                                    : undefined
                                }
                              >
                                {money(periodResult(data.result_minor).minor)}
                              </span>
                            ),
                          }}
                        />
                      </div>
                    </Card>
                  )}

                  {data.sections.map((section) => (
                    <Section key={section.root_class} section={section} />
                  ))}

                  {data.kind === "BALANCE_SHEET" && (
                    <Card>
                      <CardHeader>
                        {/* Named by its sign and negated for display, exactly
                            as on the other tab: the wire speaks
                            debits-positive, so a loss arrives POSITIVE and
                            printing it raw calls a loss a profit. */}
                        <CardTitle>
                          {periodResult(data.result_minor).label}
                        </CardTitle>
                        <span
                          className={cn(
                            "text-[0.9375rem] font-semibold tabular-nums",
                            periodResult(data.result_minor).loss
                              ? "text-bad-fg"
                              : "text-ink"
                          )}
                        >
                          {money(periodResult(data.result_minor).minor)}
                        </span>
                      </CardHeader>
                      <p className="px-4 pb-3.5 text-[0.875rem] text-body">
                        Income less expenses, classes 4 through 8 netted, and
                        measured inception to date. It is what makes classes 1,
                        2 and 3 add up — profit earned and not yet closed to
                        equity. The client's own line for it is{" "}
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

/// One crumb of a descent: a code that was asked for, and the client's own name
/// for it. Captured from the row that was clicked, so climbing back is a slice
/// of an array and never a re-read.
interface Crumb {
  readonly code: string
  readonly name: string
}

/// One root class of the balance sheet, account by account and location by
/// location — and as far into that class as the reader wants to go.
///
/// # Why the grid descends
///
/// `GET /balances?family=` answers with the *immediate children* of a family
/// and nothing below them, so a root class is three or four rows: "CURRENT
/// ASSET, 3.2 billion, across fourteen shops" is not an answer to "how much is
/// in store 07's drawer". The tree is in the codes on their own
/// {1,3,5,7,10,12} ladder, so a row's name asks the same endpoint one rung
/// lower and the crumbs above the grid say where that is. Every crumb goes
/// back, which is the whole navigation: no history, no URL, nothing to get
/// out of step with the as-of date in the toolbar.
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
function LocationSpread({
  rootCode,
  asOf,
}: {
  rootCode: string
  asOf: string
}) {
  // Where the reader has walked to below the root class, deepest last; empty is
  // the root itself. Component state and not the URL: three of these are on
  // screen at once and three descents in the address bar would be a link
  // nobody could read. `<Reports>` mounts them only while the toggle is on and
  // keys them on the as-of date, so both resets are somebody else's problem.
  const [descent, setDescent] = useState<readonly Crumb[]>([])
  const [sorting, setSorting] = useState<SortingState>([
    { id: "total_minor", desc: true },
  ])

  const code = descent.at(-1)?.code ?? rootCode

  const matrix = useQuery({
    queryKey: financeKeys.balances(code, asOf),
    queryFn: ({ signal }) => balanceMatrix(code, asOf, signal),
  })

  /// Which rows have anything under them — from the chart, not from a guess.
  ///
  /// It cannot be read off the grid. `/balances` returns a family's children,
  /// so a posting account answers with zero rows *and* a zero grand total:
  /// descending into one would draw an empty table that reads as "this holds
  /// nothing" when what happened is "there is nothing beneath it". The code's
  /// own length is not enough either — the ladder makes every 12-digit code a
  /// leaf, but three of the deposits under `1011004` are postable at ten
  /// digits, which is exactly where somebody chasing cash would click.
  ///
  /// So the chart is asked, and `is_group` is the client's own answer. It is
  /// the key and the read the Chart of accounts screen already uses for a
  /// level, so it is as often warm as it is a request. Until it lands, nothing
  /// is drillable: a name that becomes a link a moment later is a smaller
  /// surprise than a link that does nothing.
  const children = useQuery({
    queryKey: financeKeys.accountChildren(code, false),
    queryFn: ({ signal }) =>
      accountChildren({ parent: code }, signal).then((page) => page.rows),
    // The chart is imported once and then sits for months.
    staleTime: 10 * 60 * 1000,
  })

  const groups = useMemo(() => {
    const codes = new Set<string>()
    for (const account of children.data ?? []) {
      if (account.is_group) codes.add(account.account_code)
    }
    return codes
  }, [children.data])

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
        // Two questions, two affordances, and they are not the same question.
        // The code still opens the Ledger — *what happened in this account* —
        // and the name walks into the family — *what is under it*. A row whose
        // account is a posting leaf keeps its name as plain text: there is
        // nothing below it, and a hover state promising otherwise is a lie the
        // reader only finds out about by clicking.
        cell: ({ row }) => (
          <span className="flex min-w-0 items-center gap-2">
            <AppLink
              to="/finance/ledger"
              sheet={{ key: "account", value: row.original.account_code }}
              className="shrink-0 font-mono text-[0.875rem] text-mute hover:text-accent hover:underline"
            >
              {row.original.account_code}
            </AppLink>
            {groups.has(row.original.account_code) ? (
              <button
                type="button"
                onClick={() =>
                  setDescent((trail) => [
                    ...trail,
                    {
                      code: row.original.account_code,
                      name: row.original.name,
                    },
                  ])
                }
                className="flex min-w-0 items-center gap-1 text-ink transition-colors hover:text-accent"
              >
                <span className="truncate hover:underline">
                  {row.original.name}
                </span>
                <ChevronRight
                  aria-hidden
                  className="size-3 shrink-0 text-faint"
                />
              </button>
            ) : (
              <span className="truncate text-ink">{row.original.name}</span>
            )}
          </span>
        ),
      },
      ...locations.map((site, index): ColumnDef<TableSetup, BalanceRow> => ({
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
            <span className="text-[0.875rem] font-normal text-faint tabular-nums">
              {money(columnTotals[index] ?? 0)}
            </span>
          </span>
        ),
        size: 130,
        meta: { align: "right" },
        cell: ({ row }) => (
          <Amount minor={row.original.cells[index] ?? 0} muteZero />
        ),
      })),
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
    [locations, columnTotals, groups]
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

  // The descent, from the class down. The root's name is the server's while the
  // root is what is being read; once below it the response describes the level
  // the reader is on, so the class falls back to the client's own list of
  // eight. It is drawn even when it is one crumb long — at the root that is
  // exactly the heading this card always had.
  const trail: readonly Crumb[] = [
    {
      code: rootCode,
      name:
        (descent.length === 0 ? matrix.data?.family_name : undefined) ??
        ROOT_CLASSES[rootCode] ??
        "—",
    },
    ...descent,
  ]

  return (
    <Card className="overflow-hidden">
      <CardHeader>
        {/* In the header and not above the table: it is the card's title once
            the card is a level rather than a class, and it stays put while the
            grid below it is loading — the way back cannot be the thing that
            disappears while somebody waits. */}
        <CardTitle className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
          {trail.map((crumb, index) => (
            <span key={crumb.code} className="flex min-w-0 items-center gap-2">
              {index > 0 && (
                <ChevronRight
                  aria-hidden
                  className="size-3 shrink-0 text-faint"
                />
              )}
              {/* The level being read is not a link to itself. `trail[0]` is
                  the class, so at the root this is the whole crumb list and
                  the card is titled exactly as it always was. */}
              {index === trail.length - 1 ? (
                <span className="flex min-w-0 items-center gap-2">
                  <span className="font-mono text-id text-mute">
                    {crumb.code}
                  </span>
                  <span className="truncate">{crumb.name}</span>
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => setDescent(descent.slice(0, index))}
                  className="flex min-w-0 items-center gap-2 font-normal text-mute transition-colors hover:text-accent hover:underline"
                >
                  <span className="font-mono text-id">{crumb.code}</span>
                  <span className="truncate">{crumb.name}</span>
                </button>
              )}
            </span>
          ))}
        </CardTitle>
        {matrix.data && (
          <span className="shrink-0 text-[0.875rem] text-mute">
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
                <div className="grid gap-x-6 gap-y-4 px-4 py-3 xl:grid-cols-[minmax(0,1fr)_20rem]">
                  <div>
                    <h4 className="mb-2 text-eyebrow font-semibold text-mute uppercase">
                      By location, largest first
                    </h4>
                    <LocationBars
                      locations={data.locations}
                      totals={data.column_totals}
                    />
                  </div>
                  <div>
                    <TotalsLadder
                      rows={[]}
                      total={{
                        label: "Every location",
                        value: money(data.grand_total_minor),
                      }}
                    />
                    <p className="mt-1 text-[0.875rem] text-mute">
                      The server's total for this level, and the column heads
                      are its per-location totals. Neither is a sum of the rows
                      on screen.
                    </p>
                  </div>
                </div>
              </>
            ),
        })}
      </div>
    </Card>
  )
}

/// The column totals of the level on screen, ranked and drawn at a length.
///
/// Fourteen locations across the top of a grid is fourteen numbers to read and
/// compare in your head. This is the same fourteen figures — the server's
/// `column_totals`, already in the response the grid was built from, so no
/// second read and no arithmetic beyond the ratio that gives a bar its width.
/// It moves with the descent, because the response does.
///
/// # Why a bar and not a chart
///
/// `<RankedBars>` is what this module has for "how much of the biggest": a
/// horizontal `<Meter>` track, the accent fill, no axis. The shared
/// `<BarSeries>` next door is vertical, and fourteen vertical categories means
/// fourteen tick labels that Recharts thins out — "Store 07" disappearing is
/// the one thing a per-location comparison cannot afford.
///
/// This function had the track, the ranking and the peak written out inside
/// it, and then the asset register wanted the same three things. They now live
/// in `parts.tsx` and this is what is left: turning a pair of parallel arrays
/// into named rows, which is the only part of it that was ever about balances.
function LocationBars({
  locations,
  totals,
}: {
  locations: readonly string[]
  totals: readonly number[]
}) {
  const rows = useMemo(
    () =>
      locations.map((site, index) => ({
        key: site,
        // The client's own name for the shop, with the id in `title` — the
        // same reading every other location on every other finance screen
        // gets.
        label: <SiteName id={site} className="text-mute" />,
        value: totals[index] ?? 0,
      })),
    [locations, totals]
  )

  return (
    <RankedBars
      rows={rows}
      empty="Nothing at any location under this heading."
    />
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
        <p className="border-t border-hairline px-4 py-3 text-[0.875rem] text-mute">
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
                  className="shrink-0 font-mono text-[0.875rem] text-mute hover:text-accent hover:underline"
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
