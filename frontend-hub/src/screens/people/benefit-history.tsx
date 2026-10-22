import { useQuery } from "@tanstack/react-query"

import { PageContent } from "@/components/shell/app-shell"
import { AppLink } from "@/components/ui/app-link"
import { Card } from "@/components/ui/card"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { PageHeader } from "@/components/ui/page-header"
import { CardFigure, CardName, PhoneCards } from "@/components/ui/phone-cards"
import { MiniCell, MiniRow, MiniTable } from "@/components/ui/rows"
import { EmptyState } from "@/components/ui/states"
import { money, moment } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import {
  BENEFIT_KIND_LABEL,
  benefitKeys,
  benefitMovements,
} from "@/lib/queries/hr-benefit"
import { useNameOfLogin } from "@/lib/queries/hr-employees"
import { monthBounds, monthTitle } from "@/lib/queries/hr-time"
import { queryState } from "@/lib/query-state"
import { HrScope, useHrMonth, useUnitFilter } from "@/screens/people/parts"
import type { BenefitMovementRow } from "@itulah/contract"

/// Benefits › History — what moved anybody's shopping balance in the month,
/// newest first: what HR added, took off or reset, and what people spent or
/// got back at the till.
///
/// One company-wide feed (`GET /api/v1/benefit/entries`, inside the caller's
/// reach), narrowed to the unit each person is posted at now. A person's own
/// account stays on their sheet.

const NO_MOVEMENTS: BenefitMovementRow[] = []

/// A movement as a movement: `+Rp5.000` or `−Rp5.000`, with a true minus.
function change(delta: number): string {
  return `${delta > 0 ? "+" : ""}${money(delta)}`
}

/// The sale it came from or the reason HR gave.
function reasonOf(entry: BenefitMovementRow): string {
  return (entry.sale_ref ?? entry.reason) || "—"
}

function nameOf(entry: BenefitMovementRow): string {
  return entry.full_name ?? entry.employee_code
}

/// What HR put in, and what the till took out net of what came back.
function totals(entries: readonly BenefitMovementRow[]) {
  let added = 0
  let spent = 0
  for (const entry of entries) {
    if (
      (entry.kind === "ADD" || entry.kind === "RESET") &&
      entry.delta_minor > 0
    )
      added += entry.delta_minor
    else if (entry.kind === "SPEND" || entry.kind === "RETURN")
      spent -= entry.delta_minor
  }
  return { added, spent }
}

/// The employee's name, opening their sheet.
function Who({ entry }: { entry: BenefitMovementRow }) {
  return (
    <AppLink
      to="/people"
      sheet={{ key: "employee", value: entry.employee_id }}
      className="text-ink hover:underline"
    >
      {nameOf(entry)}
    </AppLink>
  )
}

export function BenefitHistory() {
  const phone = useLayout() === "phone"
  const nameOfLogin = useNameOfLogin()
  const unit = useUnitFilter()
  const month = useHrMonth()

  const { from, to } = monthBounds(month[0])
  const movements = useQuery({
    queryKey: benefitKeys.movements(from, to, unit.unitId),
    queryFn: ({ signal }) => benefitMovements(from, to, unit.unitId, signal),
  })
  const entries = movements.data ?? NO_MOVEMENTS
  const sums = totals(entries)
  const loaded = movements.data !== undefined

  return (
    <PageContent>
      <PageHeader title="Benefits" />

      <HrScope unit={unit} month={month} />

      <KpiStrip>
        <Kpi label="Added" value={money(loaded ? sums.added : null)} />
        <Kpi label="Spent" value={money(loaded ? sums.spent : null)} />
      </KpiStrip>

      <Card className="overflow-hidden px-4 py-2 max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:p-0 max-md:shadow-none">
        {queryState(movements, {
          loading: "Reading the balances…",
          render: () =>
            entries.length === 0 ? (
              <EmptyState>
                {`No balance moved in ${monthTitle(month[0])}.`}
              </EmptyState>
            ) : phone ? (
              <PhoneCards
                rows={entries}
                rowId={(entry) => entry.id}
                spec={{
                  title: (entry) => (
                    <CardName
                      name={<Who entry={entry} />}
                      line={[
                        `${BENEFIT_KIND_LABEL[entry.kind] ?? entry.kind} · ${moment(entry.at)}`,
                        reasonOf(entry),
                      ]}
                    />
                  ),
                  lead: (entry) => (
                    <CardFigure
                      value={change(entry.delta_minor)}
                      caption={`balance ${money(entry.balance_after)}`}
                    />
                  ),
                  foot: (entry) => <>By {nameOfLogin(entry.by)}</>,
                }}
              />
            ) : (
              <MiniTable
                head={[
                  "Date",
                  { label: "Employee", align: "left" },
                  { label: "What", align: "left" },
                  "Amount",
                  "Balance after",
                  { label: "Reason", align: "left" },
                  { label: "By", align: "left" },
                ]}
              >
                {entries.map((entry) => (
                  <MiniRow key={entry.id}>
                    <MiniCell>{moment(entry.at)}</MiniCell>
                    <MiniCell>
                      <Who entry={entry} />
                    </MiniCell>
                    <MiniCell>
                      {BENEFIT_KIND_LABEL[entry.kind] ?? entry.kind}
                    </MiniCell>
                    <MiniCell align="right">
                      {change(entry.delta_minor)}
                    </MiniCell>
                    <MiniCell align="right">
                      {money(entry.balance_after)}
                    </MiniCell>
                    <MiniCell>{reasonOf(entry)}</MiniCell>
                    <MiniCell>{nameOfLogin(entry.by)}</MiniCell>
                  </MiniRow>
                ))}
              </MiniTable>
            ),
        })}
      </Card>
    </PageContent>
  )
}
