import { useQuery } from "@tanstack/react-query"
import { Fragment, useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Card } from "@/components/ui/card"
import { Day } from "@/components/ui/day"
import { PageHeader } from "@/components/ui/page-header"
import { Toolbar } from "@/components/ui/segmented"
import { Banner, EmptyState, LoadingState } from "@/components/ui/states"
import { money } from "@/lib/format"
import {
  financeKeys,
  statement,
  type StatementKind,
} from "@/lib/queries/finance"
import {
  CardRow,
  Grid,
  NumberCard,
  Td,
  Th,
} from "@/screens/finance-lab-2/parts"
import { ladderLevel } from "@/screens/finance/chart"
import { useUnitName } from "@/screens/finance/hooks"
import { UnitSelect } from "@/screens/finance/parts"

/// The first day of the fiscal year `on` falls in, and its last.
///
/// April to March, which is the year this company's books close on. Held here
/// rather than typed by the user every time: a statement asked for "the year"
/// is asked for far more often than one asked for an arbitrary window, and a
/// report that opens empty until two dates are filled in is a report nobody
/// runs.
function fiscalYear(on: Date): { from: string; to: string; label: string } {
  const year = on.getMonth() >= 3 ? on.getFullYear() : on.getFullYear() - 1
  return {
    from: `${year}-04-01`,
    to: `${year + 1}-03-31`,
    label: `${year}-${year + 1}`,
  }
}

/// A financial statement, whichever of the three it is.
///
/// # Why one component and not three screens
///
/// `GET /finance/statement` answers all three from one shape: sections, each a
/// root class with lines under it, each line an account at a depth. A balance
/// sheet is classes 1–3, a profit and loss 4–8, a cash flow the same postings
/// asked what they did to CASH. The server decided that; three components
/// would be three copies of one table differing in a string.
///
/// What differs per kind is what the figures at the top MEAN, and that is the
/// only thing this file branches on.
export function StatementScreen({
  kind,
  title,
  sub,
}: {
  kind: StatementKind
  title: string
  sub: string
}) {
  const year = useMemo(() => fiscalYear(new Date()), [])
  const [from, setFrom] = useState(year.from)
  const [to, setTo] = useState(year.to)
  const [unit, setUnit] = useState("")
  const unitName = useUnitName()

  const report = useQuery({
    queryKey: financeKeys.statement(
      kind,
      from || null,
      to || null,
      unit || null
    ),
    queryFn: ({ signal }) =>
      statement(
        kind,
        {
          from: from || undefined,
          to: to || undefined,
          unit: unit || undefined,
        },
        signal
      ),
  })

  const data = report.data

  return (
    <PageContent>
      <PageHeader crumb="Finance lab 2 · Accounting" title={title} sub={sub} />

      <div className="flex flex-col gap-4">
        <Toolbar>
          {/* A balance sheet is a POSITION — everything up to a day — so the
              server ignores `from` for it and asking for one would be a
              control that changes nothing. */}
          {kind !== "BALANCE_SHEET" && (
            <>
              <Day
                value={from}
                onChange={setFrom}
                notAfter={to === "" ? null : to}
                placeholder="From"
                label="From date"
                className="h-8 w-36"
              />
              <span aria-hidden className="text-mute">
                →
              </span>
            </>
          )}
          <Day
            value={to}
            onChange={setTo}
            notBefore={from === "" || kind === "BALANCE_SHEET" ? null : from}
            placeholder={kind === "BALANCE_SHEET" ? "As at" : "To"}
            label={kind === "BALANCE_SHEET" ? "As at" : "To date"}
            className="h-8 w-36"
          />
          <UnitSelect
            aria-label="Unit"
            value={unit}
            onChange={setUnit}
            className="h-8 w-44"
          />
          <Toolbar.Spacer />
          <span className="text-[0.875rem] text-mute">{year.label}</span>
        </Toolbar>

        {/* Out of balance is not a rounding note: it means the postings behind
            this report do not add up, and every figure below it is suspect.
            Said at the top, before anybody reads a number. */}
        {data !== undefined && data.out_of_balance_minor !== 0 && (
          <Banner tone="bad">
            The ledger is out of balance by {money(data.out_of_balance_minor)}.
            Every figure below is drawn from postings that do not balance.
          </Banner>
        )}

        {data !== undefined && (
          <CardRow>
            {kind === "CASH_FLOW" ? (
              <>
                <NumberCard
                  label="Cash at the start"
                  value={data.opening_cash_minor}
                />
                <NumberCard
                  label="Net change in cash"
                  value={data.result_minor}
                  tone={data.result_minor < 0 ? "bad" : "ok"}
                />
                <NumberCard
                  label="Cash at the end"
                  value={data.closing_cash_minor}
                />
              </>
            ) : kind === "PROFIT_LOSS" ? (
              <>
                {data.sections.map((section) => (
                  <NumberCard
                    key={section.root_class}
                    label={section.title}
                    value={section.total_minor}
                  />
                ))}
                <NumberCard
                  label="Result for the period"
                  value={data.result_minor}
                  tone={data.result_minor < 0 ? "bad" : "ok"}
                />
              </>
            ) : (
              data.sections.map((section) => (
                <NumberCard
                  key={section.root_class}
                  label={section.title}
                  value={section.total_minor}
                />
              ))
            )}
          </CardRow>
        )}

        {report.isPending ? (
          <LoadingState>Reading the books…</LoadingState>
        ) : data === undefined || data.sections.length === 0 ? (
          <EmptyState>
            Nothing has been posted in this window
            {unit === "" ? "" : ` for ${unitName(unit)}`}.
          </EmptyState>
        ) : (
          <Card className="overflow-hidden">
            <Grid>
              <thead>
                <tr>
                  <Th>Account</Th>
                  <Th align="right" width="14rem">
                    {data.to}
                  </Th>
                </tr>
              </thead>
              <tbody>
                {data.sections.map((section) => (
                  <Fragment key={section.root_class}>
                    <tr>
                      <Td className="pt-4 font-medium text-ink">
                        {section.title}
                      </Td>
                      <Td align="right" className="pt-4 font-medium text-ink">
                        {money(section.total_minor)}
                      </Td>
                    </tr>
                    {section.lines.map((line) => (
                      <tr key={`${section.root_class}-${line.account_code}`}>
                        {/* The depth is the server's, drawn as indent rather
                            than as a tree control: a statement is READ top to
                            bottom, and a collapsed group is a figure somebody
                            has to go looking for. */}
                        <Td>
                          <span
                            style={{
                              paddingLeft: `${ladderLevel(line.depth) * 1.15}rem`,
                            }}
                            className={line.is_group ? "text-ink" : "text-text"}
                          >
                            {line.name}
                          </span>
                          <span className="ml-2 font-mono text-[0.875rem] text-mute">
                            {line.account_code}
                          </span>
                        </Td>
                        <Td
                          align="right"
                          className={line.is_group ? "text-ink" : undefined}
                        >
                          {money(line.amount_minor)}
                        </Td>
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </Grid>
          </Card>
        )}
      </div>
    </PageContent>
  )
}

export function ProfitAndLoss() {
  return (
    <StatementScreen
      kind="PROFIT_LOSS"
      title="Profit and Loss"
      sub="What was earned and what it cost, over a window."
    />
  )
}

export function BalanceSheet() {
  return (
    <StatementScreen
      kind="BALANCE_SHEET"
      title="Balance Sheet"
      sub="What the company holds and owes, as at a day."
    />
  )
}

export function CashFlow() {
  return (
    <StatementScreen
      kind="CASH_FLOW"
      title="Cash Flow"
      sub="What the same postings did to the money itself."
    />
  )
}
