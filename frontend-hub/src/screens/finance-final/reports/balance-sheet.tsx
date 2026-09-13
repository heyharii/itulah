import { useQuery } from "@tanstack/react-query"
import { useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { PageHeader } from "@/components/ui/page-header"
import { Toolbar } from "@/components/ui/segmented"
import { Banner, EmptyState } from "@/components/ui/states"
import { day, money } from "@/lib/format"
import { financeKeys, statement } from "@/lib/queries/finance"
import { queryState } from "@/lib/query-state"
import {
  CardRow,
  Code,
  Grid,
  Note,
  NumberCard,
  Td,
  Th,
  TotalRow,
} from "@/screens/finance-final/parts"
import { asPresented, ladderLevel, periodResult } from "@/screens/finance/chart"
import { useAsOf } from "@/screens/finance/hooks"
import { AsOfControl, LocationSelect, SiteName } from "@/screens/finance/parts"
import type { StatementSection } from "@itulah/contract"

/// What is held, what is owed, and what is left, as at a date.
///
/// The sibling of Profit & Loss and built to its rules — same toolbar order,
/// same cards above the table, same `{1,3,5,7,10,12}` indent, one `TotalRow` at
/// the foot. Read that file's opening comment for the four; this one only
/// records where a balance sheet differs and why.
///
/// # Why there is no comparison control here
///
/// A balance sheet is a moment, not a window: `GET /finance/statement` ignores
/// `from` for `BALANCE_SHEET` and answers inception to date, which is what an
/// asset is. Comparing two moments is a real question and ERPNext offers it
/// through the same periodicity block it gives the P&L — but the comparison
/// that earns its place in a thirteen-shop chain is the profit one, and it
/// lives on that screen. Here the unit select answers "what does Store 04
/// hold" one shop at a time, which is the question this page is opened with.
///
/// # Why the identity is the loudest thing on the page
///
/// Assets = Liabilities + Equity is what a reader checks before reading
/// anything else, so it is stated three times over: as a card, as a banner when
/// it fails, and as the last row of the table. And the figure is the
/// **server's** — `out_of_balance_minor` is computed from `journal_line`, not
/// by subtracting the rows on screen. A page that subtracted its own visible
/// rows would report "balanced" about a list it had not finished loading.
///
/// # Why a balance sheet carries a profit at all
///
/// Classes 1, 2 and 3 do not balance on their own, and that is not a fault:
/// profit earned and not yet closed to equity is still sitting in the income
/// and expense classes. ERPNext calls that line **Provisional profit** and
/// states the identity as "assets equal liabilities plus equity and provisional
/// profit"; the client keeps their own line for it, `3013001003 Laba (Rugi)
/// bulan berjalan`. `result_minor` is that figure, measured inception to date
/// rather than over a window — bounding it by a start date would leave the
/// sheet out by everything that happened before it.
export function BalanceSheet() {
  const asOf = useAsOf()
  const [site, setSite] = useState("")

  const report = useQuery({
    queryKey: financeKeys.statement(
      "BALANCE_SHEET",
      null,
      asOf.value,
      site || null
    ),
    queryFn: ({ signal }) =>
      statement(
        "BALANCE_SHEET",
        // No `from`. The server would drop it anyway — a balance sheet is
        // cumulative — and sending one would put a date in the query key that
        // changes nothing about the answer.
        { to: asOf.value, site: site || undefined },
        signal
      ),
  })

  return (
    <PageContent>
      <PageHeader
        crumb="Finance final · Reports"
        title="Balance Sheet"
        sub="What is held, what is owed, and what is left, as at a date."
      />

      <Toolbar>
        <AsOfControl asOf={asOf} />
        <LocationSelect
          value={site}
          onChange={setSite}
          className="h-8 w-44"
          aria-label="Location"
        />
        <Toolbar.Spacer />
        <span className="text-[0.71875rem] text-mute">
          {asOf.chip}
          {site === "" ? (
            " · every unit"
          ) : (
            <>
              {" · "}
              <SiteName id={site} />
            </>
          )}
        </span>
      </Toolbar>

      {queryState(report, {
        loading: "Reading what is held and what is owed…",
        render: (sheet) => {
          const assets = totalOf(sheet.sections, "1")
          const liabilities = totalOf(sheet.sections, "2")
          const equity = totalOf(sheet.sections, "3")
          const provisional = periodResult(sheet.result_minor)
          const claims = liabilities + equity + provisional.minor
          const out = sheet.out_of_balance_minor
          const silent =
            assets === 0 && liabilities === 0 && equity === 0 && out === 0

          return (
            <div className="flex flex-col gap-4">
              {out !== 0 && (
                <Banner tone="bad">
                  <b>This sheet does not balance.</b> Assets are{" "}
                  {money(out > 0 ? out : -out)}{" "}
                  {out > 0 ? "more" : "less"} than liabilities, equity and the
                  provisional profit together. Every posting is two-sided, so
                  the difference is a defect in the books or in the chart — not
                  a rounding, and not something this page can present its way
                  out of.
                </Banner>
              )}

              <CardRow>
                <NumberCard
                  label="Total assets"
                  value={assets}
                  note="What is held, as at this date"
                />
                <NumberCard
                  label="Liabilities and equity"
                  value={claims}
                  note="Owed, plus what is left, plus the provisional profit"
                />
                <NumberCard
                  label="Out of balance"
                  value={out}
                  tone={out === 0 ? "ok" : "bad"}
                  note={
                    out === 0
                      ? "Assets = Liabilities + Equity. The server's own check."
                      : "The server's own check, and it failed."
                  }
                />
              </CardRow>

              {silent ? (
                <EmptyState>
                  Nothing has been posted to the asset, liability or equity
                  classes up to this date, so there is no position to draw.
                </EmptyState>
              ) : (
                <Grid>
                  <thead>
                    <tr>
                      <Th width="28rem">Account</Th>
                      <Th align="right" width="12rem">
                        As at {day(asOf.value)}
                      </Th>
                    </tr>
                  </thead>
                  <tbody>
                    {sheet.sections.map((section) => (
                      <SectionRows key={section.root_class} section={section} />
                    ))}

                    {/* The one derived row on the page, and it gets the same
                        treatment Gross profit gets on the Profit & Loss: a
                        rule above it, and no account code, so nobody goes
                        looking for it in the chart. ERPNext's own word. */}
                    <tr className="border-t border-hairline-strong">
                      <Td className="font-medium text-ink">
                        Provisional profit
                        <span className="ml-2 text-[0.6875rem] font-normal text-mute">
                          earned and not yet closed to equity, inception to date
                        </span>
                      </Td>
                      <Td align="right">
                        <span
                          className={
                            provisional.loss
                              ? "font-medium text-bad-fg"
                              : "font-medium text-ink"
                          }
                        >
                          {money(provisional.minor)}
                        </span>
                      </Td>
                    </tr>

                    <TotalRow>
                      <Td>Total liabilities and equity</Td>
                      <Td align="right">{money(claims)}</Td>
                    </TotalRow>
                  </tbody>
                </Grid>
              )}

              <Note>
                <b>Liabilities and equity read positive here and negative on
                the wire.</b> The ledger stores debits positive, so the two
                credit-natured classes arrive negative and are flipped per class
                for reading — never on the server, because the same figure has
                to come back the same way whichever screen asks for it. Every
                section total above is the server's own; the only figure
                composed here is{" "}
                <b>Total liabilities and equity</b>, and it is composed of three
                the server computed.
              </Note>

              <Note>
                <b>One moment, one unit.</b>{" "}
                <code className="font-mono text-[0.6875rem]">
                  GET /finance/statement?kind=BALANCE_SHEET
                </code>{" "}
                takes an as-at date and a{" "}
                <code className="font-mono text-[0.6875rem]">site</code>, and
                the unit is a filter on the ledger row rather than part of the
                account code — so <i>Cash on Hand</i> is named once here and the
                shop is a column, where the client's legacy chart keeps fourteen
                copies of the account instead. What this page does not do is
                compare: two as-at dates side by side, or fourteen shops across,
                would be two more requests apiece, and the comparison worth that
                fan-out is the profit one. It is on <b>Profit &amp; Loss</b>.
              </Note>
            </div>
          )
        },
      })}
    </PageContent>
  )
}

/// One root class and everything under it, as table rows.
///
/// A fragment rather than a card, because the three classes have to read as one
/// table: a reader adding liabilities to equity should not be crossing a
/// border to do it.
function SectionRows({ section }: { section: StatementSection }) {
  return (
    <>
      <tr>
        <Td className="font-medium text-ink">
          <span className="flex items-baseline gap-1.5">
            <Code>{section.root_class}</Code>
            <span className="min-w-0">{section.title}</span>
          </span>
        </Td>
        <Td align="right">
          <span className="font-medium text-ink">
            {money(asPresented(section.total_minor, section.root_class))}
          </span>
        </Td>
      </tr>
      {section.lines.map((line) => (
        <tr key={line.account_code}>
          <Td>
            {/* The indent rides a span inside the cell, not the cell itself:
                `<Td>` owns its padding, and a second opinion about that in
                every table of this module is how two reports stop lining up.

                Printed, not linked — ERPNext's own docs warn that a drill-down
                which loses a dimension filter shows a broader ledger than the
                report it came from, and a sheet carries one key, so a link
                could take the account or the unit but never both. */}
            <span
              className="flex items-baseline gap-1.5"
              style={{ paddingLeft: `${ladderLevel(line.depth) * 1.125}rem` }}
            >
              <Code>{line.account_code}</Code>
              <span className="min-w-0">{line.name}</span>
            </span>
          </Td>
          <Td align="right">
            <span className={line.is_group ? "text-ink" : undefined}>
              {money(asPresented(line.amount_minor, section.root_class))}
            </span>
          </Td>
        </tr>
      ))}
    </>
  )
}

/// One class's total, as the sheet prints it. Zero when the class is absent,
/// which is the server saying nothing was ever posted there — not a gap.
function totalOf(
  sections: readonly StatementSection[],
  rootClass: string
): number {
  const section = sections.find((row) => row.root_class === rootClass)
  return section === undefined
    ? 0
    : asPresented(section.total_minor, rootClass)
}
