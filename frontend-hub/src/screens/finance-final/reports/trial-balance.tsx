import { useSuspenseQueries } from "@tanstack/react-query"
import { useRouterState } from "@tanstack/react-router"
import { Suspense, useDeferredValue, useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { ExportButton } from "@/components/ui/export-button"
import { PageHeader } from "@/components/ui/page-header"
import { Segmented } from "@/components/ui/segmented"
import { CellMoney } from "@/components/ui/rows-switch"
import { Banner, EmptyState } from "@/components/ui/states"
import { monthStamp, type ExportSheet } from "@/lib/export-xlsx"
import { count, day, money } from "@/lib/format"
import { trialBalanceQuery } from "@/lib/queries/finance"
import { useLayout } from "@/lib/layout"
import { queryState } from "@/lib/query-state"
import {
  Code,
  Grid,
  Td,
  Th,
  TotalRow,
  useAskedWindow,
} from "@/screens/finance-final/parts"
import { isoDay, ladderLevel } from "@/screens/finance/chart"
import { useSettledWindow, useUnitName } from "@/screens/finance/hooks"
import { UnitName, UnitSelect, WindowControl } from "@/screens/finance/parts"
import {
  BukuBesarPembantu,
  NeracaSaldo,
} from "@/screens/finance-final/reports/trial-balance-7soft"
import { ScreenPending } from "@/screens/finance/pending"
import {
  PhoneStatement,
  type StatementLine,
} from "@/screens/finance/phone-parts"
import { FilterCheck, ReportFilters } from "@/screens/finance/report"
import type { TrialBalanceRow } from "@itulah/contract"

/// Opening, movement and closing for every account that moved — and the proof
/// that the two sides agree.
///
/// # What makes this report new here
///
/// The unit. The client's legacy chart carries the location inside the account
/// code — fourteen copies of `Cash on Hand`, and a 14×14 grid of inter-unit
/// accounts on top — so "the trial balance for Store 04" was a question their
/// system could only answer by somebody adding up five hundred account codes by
/// hand, and in practice nobody ever did. Here `unit` is a dimension on the
/// ledger row and a query parameter on this endpoint, so one store's trial
/// balance is a control, not an afternoon.
///
/// That is also why the default view is one line per account **and unit**. An
/// account is named once — `Cash on Hand` in the account column, `Store 04` in
/// the unit column — and the roll-up to ERPNext's one-line-per-account shape is
/// the other half of the toggle rather than the only shape on offer.
///
/// # Why two requests
///
/// `GET /finance/trial-balance` answers as at ONE date: every posting up to
/// `as_of`, summed gross. ERPNext's report has three pairs of columns —
/// opening, period, closing — so the opening pair is the same endpoint asked
/// again at the day before the window starts, and the period pair is the
/// difference between the two.
///
/// That subtraction is exact and not an estimate, and it is worth saying why:
/// the server sends SUM(debit) and SUM(credit) separately and cumulatively, not
/// a netted balance. So `closing.debit − opening.debit` is precisely the gross
/// debit posted inside the window, which is the number ERPNext prints in its
/// Debit column. A difference of two netted balances could not have told the
/// two sides apart.
///
/// # Why the foot is drawn twice
///
/// The row under the table adds up the lines above it, which is what a trial
/// balance foot is. Underneath it sits the server's own proof, computed in SQL
/// over every account at the date — never over these lines, never narrowed by
/// anything on this screen. Both must agree, and drawing only the first would
/// mean a report that balances because of what it left out.
///
/// # Three readings of it
///
/// 7Soft's Info Accounting has Neraca Saldo and Buku Besar Pembantu as two
/// tabs; the hub's Ledger tab has one trial balance, so the three readings are
/// a switch at the head of the report. **Neraca Saldo** (the first, because it
/// is the report's name) is 7Soft's: as of one day, Debet and Kredit, with
/// Selisih. **Buku Besar Pembantu** is 7Soft's per-account Awal, Debet, Kredit
/// and Saldo over a period, each line opening its transactions. **Opening and
/// closing** is this screen as it was: both sides of all three pairs, split by
/// unit if asked. Same endpoint behind all three (`trial-balance.tsx`,
/// `trial-balance-7soft.tsx`).
type Reading = "neraca" | "bbp" | "all"

export function TrialBalance() {
  // The list of reports opens Buku Besar Pembantu with `#bbp`.
  const hash = useRouterState({ select: (state) => state.location.hash })
  const [reading, setReading] = useState<Reading>(
    hash === "bbp" ? "bbp" : "neraca"
  )
  const switcher = (
    <Segmented<Reading>
      options={[
        { value: "neraca", label: "Neraca Saldo" },
        { value: "bbp", label: "Buku Besar Pembantu" },
        { value: "all", label: "Opening and closing" },
      ]}
      value={reading}
      onChange={setReading}
    />
  )
  return (
    <Suspense
      fallback={
        <ScreenPending
          crumb="Finance · Financial Reports"
          title="Trial Balance"
        >
          Adding up every account the book has touched…
        </ScreenPending>
      }
    >
      {reading === "neraca" ? (
        <NeracaSaldo switcher={switcher} />
      ) : reading === "bbp" ? (
        <BukuBesarPembantu switcher={switcher} />
      ) : (
        <TrialBalanceScreen switcher={switcher} />
      )}
    </Suspense>
  )
}

function TrialBalanceScreen({ switcher }: { switcher: React.ReactNode }) {
  const phone = useLayout() === "phone"
  const range = useSettledWindow()
  const [unit, setUnit] = useState("")
  // One row per account, as ERPNext's Trial Balance reads; "Split by Unit"
  // is the option, not the default.
  const [grain, setGrain] = useState<"unit" | "account">("account")

  // The boxes answer at once; the two readings trail them, and the figures in
  // hand stay on screen (dimmed) until the next are read.
  const asked = useAskedWindow(range)
  const askedUnit = useDeferredValue(unit)
  const stale = asked.stale || askedUnit !== unit

  // The day before the window opens. A balance "as at 31 August" is what the
  // books carried into September, and asking for 1 September instead would put
  // the first day's postings into the opening column.
  const before = useMemo(() => dayBefore(asked.from), [asked.from])

  const [opening, closing] = useSuspenseQueries({
    queries: [
      trialBalanceQuery(before, askedUnit || null),
      trialBalanceQuery(asked.to, askedUnit || null),
    ],
  })

  const lines = useMemo(
    () => join(opening.data.rows, closing.data.rows, grain),
    [opening.data, closing.data, grain]
  )

  // The client's own names for the eight roots, straight off the server's
  // facets rather than a list kept here — the chart is theirs and the report
  // should read as their chart does.
  const className = useMemo(() => {
    const table = new Map<string, string>()
    for (const facet of closing.data.facets.classes) {
      if (facet.label !== null) table.set(facet.value, facet.label)
    }
    return table
  }, [closing.data])

  const groups = useMemo(() => group(lines), [lines])
  const foot = useMemo(() => total(lines), [lines])

  // Two independent checks, and the screen shouts if either fails. The
  // server's is the gross identity over every account in SQL; the foot's is the
  // net-by-side identity over the lines actually drawn. They test different
  // things and a report that passed one and failed the other would be a report
  // hiding rows.
  const proved = closing.data.balanced
  const footFolds =
    foot.closeDebit === foot.closeCredit && foot.openDebit === foot.openCredit
  const cut =
    closing.data.rows.length < closing.data.total ||
    opening.data.rows.length < opening.data.total

  const unitName = useUnitName()

  /// What is on screen, as a sheet: each class as a heading, its lines, its
  /// subtotal, then the foot.
  const build = (): ExportSheet | null => {
    if (lines.length === 0) return null
    const rows: (string | number | null)[][] = []
    const rowStyles: { bold?: boolean; indent?: number }[] = []
    const split = grain === "unit"
    const figures = (one: ReturnType<typeof total>) => [
      one.openDebit,
      one.openCredit,
      one.periodDebit,
      one.periodCredit,
      one.closeDebit,
      one.closeCredit,
    ]
    for (const bucket of groups) {
      const name = className.get(bucket.rootClass) ?? bucket.rootClass
      rows.push([
        bucket.rootClass,
        name,
        ...(split ? [null] : []),
        ...Array<null>(6).fill(null),
      ])
      rowStyles.push({ bold: true })
      for (const line of bucket.lines) {
        rows.push([
          line.code,
          line.name,
          ...(split ? [unitName(line.unitId)] : []),
          ...figures(line),
        ])
        rowStyles.push({ indent: Math.min(ladderLevel(line.depth), 4) })
      }
      rows.push([
        null,
        `Subtotal · ${name}`,
        ...(split ? [null] : []),
        ...figures(total(bucket.lines)),
      ])
      rowStyles.push({ bold: true })
    }
    return {
      filename: `Trial-Balance-${monthStamp(asked.to)}`,
      sheet: "Trial Balance",
      title: "Trial Balance",
      subtitle: `${day(before)} → ${day(closing.data.as_of)} · ${
        askedUnit === "" ? "all units" : unitName(askedUnit)
      }${split ? " · split by unit" : ""}`,
      columns: [
        { header: "Code", kind: "text", width: 12 },
        { header: "Account", kind: "text", width: 44 },
        ...(split
          ? [{ header: "Unit", kind: "text" as const, width: 22 }]
          : []),
        { header: "Opening Dr", kind: "money" },
        { header: "Opening Cr", kind: "money" },
        { header: "Debit", kind: "money" },
        { header: "Credit", kind: "money" },
        { header: "Closing Dr", kind: "money" },
        { header: "Closing Cr", kind: "money" },
      ],
      rows,
      rowStyles,
      totalRow: [
        null,
        `Total of ${count(lines.length)} lines`,
        ...(split ? [null] : []),
        ...figures(foot),
      ],
    }
  }

  return (
    <PageContent>
      <PageHeader
        crumb="Finance · Financial Reports"
        title="Trial Balance"
        // On a phone Export is a row of the Filters sheet, not a button at the
        // top of the page.
        actions={
          phone ? undefined : (
            <ExportButton build={build} disabled={lines.length === 0} />
          )
        }
      />

      <ReportFilters
        note={
          <>
            {day(before)} → {day(closing.data.as_of)} ·{" "}
            {closing.data.unit_id === null ? (
              "all units"
            ) : (
              <UnitName id={closing.data.unit_id} />
            )}
          </>
        }
      >
        {switcher}
        <UnitSelect
          value={unit}
          onChange={setUnit}
          className="h-control w-44"
          aria-label="Unit"
        />
        <WindowControl range={range} />
        <FilterCheck
          label="Split by Unit"
          checked={grain === "unit"}
          onChange={(split) => setGrain(split ? "unit" : "account")}
        />
        {phone && <ExportButton build={build} disabled={lines.length === 0} />}
      </ReportFilters>

      {/* The one thing this report exists to say, said before anything else on
          the page and in words. It cannot normally be false — an unbalanced
          entry is refused by a deferred constraint trigger at COMMIT — which is
          exactly why the day it is false somebody has to see it immediately. */}
      {closing.data &&
        (proved && footFolds ? null : (
          <Banner tone="bad" className="mb-3">
            <b className="font-semibold">
              This trial balance does not balance.
            </b>{" "}
            {!proved && (
              <>
                The server totals debits {money(closing.data.total_debit_minor)}{" "}
                against credits {money(closing.data.total_credit_minor)} — a
                difference of{" "}
                {money(
                  closing.data.total_debit_minor -
                    closing.data.total_credit_minor
                )}
                . Every entry is checked at COMMIT, so this means something got
                past the database. Tell somebody now, before anything else is
                posted.{" "}
              </>
            )}
            {!footFolds && (
              <>
                The lines below close at {money(foot.closeDebit)} debit against{" "}
                {money(foot.closeCredit)} credit.
                {proved
                  ? " The server's own proof passes, so the disagreement is in what this page drew rather than in the book — check the truncation warning below."
                  : ""}
              </>
            )}
          </Banner>
        ))}

      {cut && (
        <Banner tone="warn" className="mb-3">
          The chart is larger than one page of this report, so the lines and
          totals below cover only what arrived. Narrow by unit to bring it
          inside one page.
        </Banner>
      )}

      <div
        className="list-swap flex flex-col gap-4"
        aria-busy={stale || undefined}
      >
        {queryState(closing, {
          render: () =>
            queryState(opening, {
              render: () =>
                !asked.valid ? (
                  <EmptyState>
                    Choose a From date that is on or before the To date.
                  </EmptyState>
                ) : lines.length === 0 ? (
                  <EmptyState>
                    Nothing has been posted as at {day(asked.to)}
                    {askedUnit === "" ? ", in any unit" : " in this unit"}.
                    There is no trial balance to draw yet.
                  </EmptyState>
                ) : phone ? (
                  <PhoneStatement
                    lines={phoneLines(
                      groups,
                      className,
                      grain === "unit",
                      unitName,
                      foot,
                      footFolds,
                      lines.length
                    )}
                  />
                ) : (
                  <Grid
                    followRows
                    giveUp={
                      grain === "unit"
                        ? [
                            [3, 4],
                            [5, 6],
                          ]
                        : [[2, 3]]
                    }
                  >
                    <thead>
                      <tr>
                        <Th width="16rem">Account</Th>
                        {grain === "unit" && <Th width="8rem">Unit</Th>}
                        <Th align="right" width="8.5rem">
                          Opening Dr
                        </Th>
                        <Th align="right" width="8.5rem">
                          Opening Cr
                        </Th>
                        <Th align="right" width="8.5rem">
                          Debit
                        </Th>
                        <Th align="right" width="8.5rem">
                          Credit
                        </Th>
                        <Th align="right" width="9rem">
                          Closing Dr
                        </Th>
                        <Th align="right" width="9rem">
                          Closing Cr
                        </Th>
                      </tr>
                    </thead>
                    <tbody>
                      {groups.map((bucket) => {
                        const sub = total(bucket.lines)
                        return [
                          // The tree, as deep as the wire honestly goes. A
                          // trial balance line carries its root class and its
                          // code and nothing between, so the class is a real
                          // heading with the client's own name on it, and the
                          // rungs under it are drawn from the code's own
                          // ladder. A heading invented for a five-digit prefix
                          // nobody sent a name for would be worse than none.
                          <tr key={bucket.rootClass} className="bg-soft">
                            <Td className="font-semibold text-ink">
                              <Code>{bucket.rootClass}</Code>{" "}
                              {className.get(bucket.rootClass) ?? "—"}
                            </Td>
                            {grain === "unit" && <Td />}
                            <Td />
                            <Td />
                            <Td />
                            <Td />
                            <Td />
                            <Td />
                          </tr>,
                          ...bucket.lines.map((line) => (
                            <tr key={line.key}>
                              {/* Code then name on one line, as the P&L and
                                  the Balance Sheet print it; `max-w-0` lets a
                                  long name give way to the six figures. */}
                              <Td className="max-w-0">
                                <span
                                  className="block truncate"
                                  title={`${line.code} ${line.name}`}
                                  style={{
                                    paddingLeft: `${Math.min(ladderLevel(line.depth), 4) * 0.5}rem`,
                                  }}
                                >
                                  <Code>{line.code}</Code>{" "}
                                  <span className="text-ink">{line.name}</span>
                                </span>
                              </Td>
                              {grain === "unit" && (
                                <Td>
                                  <UnitName
                                    id={line.unitId}
                                    className="text-body"
                                  />
                                </Td>
                              )}
                              <Figure value={line.openDebit} />
                              <Figure value={line.openCredit} />
                              <Figure value={line.periodDebit} />
                              <Figure value={line.periodCredit} />
                              <Figure value={line.closeDebit} strong />
                              <Figure value={line.closeCredit} strong />
                            </tr>
                          )),
                          <tr
                            key={`${bucket.rootClass}-sub`}
                            className="border-t border-hairline-2 [&>td]:font-medium [&>td]:text-body"
                          >
                            <Td>
                              Subtotal ·{" "}
                              {className.get(bucket.rootClass) ??
                                bucket.rootClass}
                            </Td>
                            {grain === "unit" && <Td />}
                            <Td align="right">{money(sub.openDebit)}</Td>
                            <Td align="right">{money(sub.openCredit)}</Td>
                            <Td align="right">{money(sub.periodDebit)}</Td>
                            <Td align="right">{money(sub.periodCredit)}</Td>
                            <Td align="right">{money(sub.closeDebit)}</Td>
                            <Td align="right">{money(sub.closeCredit)}</Td>
                          </tr>,
                        ]
                      })}

                      {/* The row the whole report is read for: the two sides
                          must be equal, and if they are not it is drawn in the
                          colour that means somebody has to act. */}
                      <TotalRow>
                        <Td className={footFolds ? undefined : "text-bad-fg"}>
                          Total of {count(lines.length)} lines
                          {footFolds ? "" : " — DOES NOT BALANCE"}
                        </Td>
                        {grain === "unit" && <Td />}
                        <Td align="right">{money(foot.openDebit)}</Td>
                        <Td align="right">{money(foot.openCredit)}</Td>
                        <Td align="right">{money(foot.periodDebit)}</Td>
                        <Td align="right">{money(foot.periodCredit)}</Td>
                        <Td
                          align="right"
                          className={footFolds ? undefined : "text-bad-fg"}
                        >
                          {money(foot.closeDebit)}
                        </Td>
                        <Td
                          align="right"
                          className={footFolds ? undefined : "text-bad-fg"}
                        >
                          {money(foot.closeCredit)}
                        </Td>
                      </TotalRow>
                    </tbody>
                  </Grid>
                ),
            }),
        })}
      </div>
    </PageContent>
  )
}

/// The trial balance as a phone reads it: each class a band with its closing
/// balance, each account under it with its own, and the two sides of the foot
/// as the last two lines. The other four figures of a line (opening and the
/// period's movement) are the sheet a tap opens.
function phoneLines(
  groups: readonly { rootClass: string; lines: readonly Line[] }[],
  className: ReadonlyMap<string, string>,
  split: boolean,
  unitName: (unitId: string | null | undefined) => string,
  foot: ReturnType<typeof total>,
  footFolds: boolean,
  lineCount: number
): StatementLine[] {
  const closing = (one: ReturnType<typeof total>) =>
    one.closeDebit === 0 && one.closeCredit === 0 ? (
      <span className="text-mute">·</span>
    ) : one.closeDebit >= one.closeCredit ? (
      <>
        {money(one.closeDebit - one.closeCredit)}{" "}
        <span className="font-normal text-mute">Dr</span>
      </>
    ) : (
      <>
        {money(one.closeCredit - one.closeDebit)}{" "}
        <span className="font-normal text-mute">Cr</span>
      </>
    )
  const facts = (one: ReturnType<typeof total>) => [
    { label: "Opening Dr", value: money(one.openDebit) },
    { label: "Opening Cr", value: money(one.openCredit) },
    { label: "Debit", value: money(one.periodDebit) },
    { label: "Credit", value: money(one.periodCredit) },
    { label: "Closing Dr", value: money(one.closeDebit) },
    { label: "Closing Cr", value: money(one.closeCredit) },
  ]
  const out: StatementLine[] = []
  for (const bucket of groups) {
    const sub = total(bucket.lines)
    out.push({
      key: bucket.rootClass,
      kind: "section",
      code: bucket.rootClass,
      name: className.get(bucket.rootClass) ?? "—",
      figure: closing(sub),
      facts: facts(sub),
    })
    for (const line of bucket.lines) {
      out.push({
        key: line.key,
        code: line.code,
        name: split ? (
          <>
            {line.name}
            <span className="block text-[0.9375rem] font-normal text-mute">
              {unitName(line.unitId)}
            </span>
          </>
        ) : (
          line.name
        ),
        level: Math.min(ladderLevel(line.depth), 4),
        figure: closing(line),
        facts: facts(line),
      })
    }
  }
  const tone = footFolds ? undefined : "bad"
  out.push(
    {
      key: "total-debit",
      kind: "total",
      name: `Total debit · ${count(lineCount)} lines`,
      figure: money(foot.closeDebit),
      tone,
      facts: facts(foot),
    },
    {
      key: "total-credit",
      kind: "total",
      name: "Total credit",
      figure: money(foot.closeCredit),
      tone,
      facts: facts(foot),
    }
  )
  return out
}

/// A figure in a trial balance column, with the empty side left empty.
///
/// Zero on one side of a balance is not a fact worth ink — it is the absence of
/// the other side. Fourteen units of an account that only ever moves at three
/// of them would otherwise print `Rp 0` twenty-two times per screen, and the
/// eye stops being able to find the figures that are real.
function Figure({ value, strong }: { value: number; strong?: boolean }) {
  return (
    <Td align="right" className={strong ? "font-medium text-ink" : undefined}>
      {value === 0 ? (
        <span className="text-hairline-strong">·</span>
      ) : (
        <CellMoney minor={value} />
      )}
    </Td>
  )
}

/// One printed line: an account, optionally at a unit, with three pairs.
interface Line {
  readonly key: string
  readonly code: string
  readonly name: string
  readonly rootClass: string
  readonly depth: number
  readonly unitId: string | null
  readonly openDebit: number
  readonly openCredit: number
  readonly periodDebit: number
  readonly periodCredit: number
  readonly closeDebit: number
  readonly closeCredit: number
}

/// A balance, put on the side it belongs to.
///
/// The wire sends gross debits and gross credits; a trial balance prints the
/// NET, once, in whichever column its sign puts it. A liability with more
/// credits than debits belongs in the credit column at the difference, not in
/// both columns at their full size.
function side(net: number): { debit: number; credit: number } {
  return net >= 0 ? { debit: net, credit: 0 } : { debit: 0, credit: -net }
}

function keyOf(row: TrialBalanceRow): string {
  return `${row.account_code}@${row.unit_id ?? ""}`
}

/// The two snapshots, made into one set of lines.
///
/// The closing snapshot is the spine: cumulative gross sums can only grow, so
/// every account present at the opening date is present at the closing one.
/// The leftover loop exists anyway — an account that somehow appeared only in
/// the opening answer would be dropped silently otherwise, and a line quietly
/// missing from a trial balance is the one failure this report must not have.
function join(
  openingRows: readonly TrialBalanceRow[],
  closingRows: readonly TrialBalanceRow[],
  grain: "unit" | "account"
): Line[] {
  const before = new Map<string, TrialBalanceRow>()
  for (const row of openingRows) before.set(keyOf(row), row)

  const out: Line[] = []
  const seen = new Set<string>()

  for (const row of closingRows) {
    const key = keyOf(row)
    seen.add(key)
    const was = before.get(key)
    out.push(lineOf(row, was))
  }
  for (const [key, row] of before) {
    if (!seen.has(key)) out.push(lineOf(row, row))
  }

  return grain === "account" ? rollUp(out) : out
}

function lineOf(now: TrialBalanceRow, was: TrialBalanceRow | undefined): Line {
  const opened = side((was?.debit_minor ?? 0) - (was?.credit_minor ?? 0))
  const closed = side(now.debit_minor - now.credit_minor)
  return {
    key: keyOf(now),
    code: now.account_code,
    name: now.name,
    rootClass: now.root_class,
    depth: now.depth,
    unitId: now.unit_id,
    openDebit: opened.debit,
    openCredit: opened.credit,
    // Gross movement inside the window, which is the difference of two gross
    // cumulative sums. Not the difference of two net balances — that would give
    // one signed number and lose which side it moved on.
    periodDebit: now.debit_minor - (was?.debit_minor ?? 0),
    periodCredit: now.credit_minor - (was?.credit_minor ?? 0),
    closeDebit: closed.debit,
    closeCredit: closed.credit,
  }
}

/// ERPNext's shape: one line per account, the unit dimension summed away.
///
/// The opening and closing pairs are re-derived from the netted total rather
/// than added column-wise, and that is not fussiness. An account that is a
/// debit at one unit and a credit at another would otherwise print a figure in
/// both columns, which is two balances for one account and reads as an error.
function rollUp(lines: readonly Line[]): Line[] {
  const table = new Map<string, Line>()
  for (const line of lines) {
    const held = table.get(line.code)
    const opened =
      (held?.openDebit ?? 0) -
      (held?.openCredit ?? 0) +
      line.openDebit -
      line.openCredit
    const closed =
      (held?.closeDebit ?? 0) -
      (held?.closeCredit ?? 0) +
      line.closeDebit -
      line.closeCredit
    const o = side(opened)
    const c = side(closed)
    table.set(line.code, {
      key: line.code,
      code: line.code,
      name: line.name,
      rootClass: line.rootClass,
      depth: line.depth,
      unitId: null,
      openDebit: o.debit,
      openCredit: o.credit,
      periodDebit: (held?.periodDebit ?? 0) + line.periodDebit,
      periodCredit: (held?.periodCredit ?? 0) + line.periodCredit,
      closeDebit: c.debit,
      closeCredit: c.credit,
    })
  }
  return [...table.values()]
}

/// The lines under their class, in the chart's own order.
///
/// The server already answers in account-code order, so bucketing preserves it
/// and nothing is sorted here — a trial balance read in an order other than the
/// chart's is one an accountant cannot check against their own printout.
function group(lines: readonly Line[]): { rootClass: string; lines: Line[] }[] {
  const table = new Map<string, Line[]>()
  for (const line of lines) {
    const held = table.get(line.rootClass)
    if (held === undefined) table.set(line.rootClass, [line])
    else held.push(line)
  }
  return [...table.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([rootClass, rows]) => ({ rootClass, lines: rows }))
}

function total(
  lines: readonly Line[]
): Omit<Line, "key" | "code" | "name" | "rootClass" | "depth" | "unitId"> {
  return lines.reduce(
    (sum, line) => ({
      openDebit: sum.openDebit + line.openDebit,
      openCredit: sum.openCredit + line.openCredit,
      periodDebit: sum.periodDebit + line.periodDebit,
      periodCredit: sum.periodCredit + line.periodCredit,
      closeDebit: sum.closeDebit + line.closeDebit,
      closeCredit: sum.closeCredit + line.closeCredit,
    }),
    {
      openDebit: 0,
      openCredit: 0,
      periodDebit: 0,
      periodCredit: 0,
      closeDebit: 0,
      closeCredit: 0,
    }
  )
}

/// The day before a window opens.
///
/// Parsed as local midnight rather than with `new Date(iso)`, which reads a
/// bare date as UTC and names the previous day for the first seven hours of
/// every Jakarta morning. An opening balance silently taken a day early is
/// exactly the kind of error that only shows up at a period close.
function dayBefore(iso: string): string {
  const date = new Date(`${iso}T00:00:00`)
  date.setDate(date.getDate() - 1)
  return isoDay(date)
}
