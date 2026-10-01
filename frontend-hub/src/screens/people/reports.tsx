import { useQuery } from "@tanstack/react-query"
import { useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { KeyValue, MiniCell, MiniRow, MiniTable } from "@/components/ui/rows"
import { Banner, EmptyState } from "@/components/ui/states"
import { SubTabs } from "@/components/ui/sub-tabs"
import { count, day, money } from "@/lib/format"
import {
  attendancePeriods,
  awaitingOvertime,
  expiringContracts,
  handoverLabel,
  listRuns,
  listWorkforce,
  payKeys,
  peopleKeys,
  pendingLeave,
  punchKeys,
  punchReadiness,
  rosterKeys,
  runStateLabel,
  leaveKeys,
  overtimeKeys,
} from "@/lib/queries/people"
import { queryState } from "@/lib/query-state"
import { UnitChoice, useUnit } from "@/screens/people/parts"
import { TaxReports } from "@/screens/people/tax-reports"
import { ActiveLettersCard } from "@/screens/people/discipline"

/// Comparing units, without making a second source of the numbers.
///
/// # Three questions, one door
///
/// Both HR prototypes asked for the same three — the workforce, the state of
/// the time data, and what payroll costs — and the owner's decision of
/// 2026-09-13 keeps People flat: one screen, one address. So these are tabs,
/// the way Time policy's four are, and for the same reason: they are one job.
/// Somebody on this screen is comparing places, and which of the three
/// comparisons they want is not worth a trip back to the sidebar.
///
/// # Nothing here is computed twice
///
/// Every figure is read from the route that owns it. The workforce counts are
/// the employee list's own facets, the cost table is the payroll run list with
/// the handover it already carries, and the time figures come from the period
/// and readiness routes. A report that re-derived any of them would be a second
/// answer to a question the app already answers, and the day they disagreed
/// this screen would be the one somebody believed.
///
/// # Two of the three compare places; one cannot yet
///
/// The workforce and the cost tables are cross-unit in one request each,
/// because both routes already answer for every place the caller reaches.
/// **Time and absence is one unit at a time**, and that is a gap rather than a
/// design: `attendance-periods` and `punch-readiness` are per place, so
/// comparing fourteen would mean twenty-eight requests from a browser. The
/// honest version is to show the chosen unit properly and say what a cross-unit
/// comparison needs. Inventing it here with a fan-out would make the slowest
/// screen in the module the one nobody could explain.
const TABS = [
  { value: "workforce", label: "Workforce" },
  { value: "time", label: "Time & absence" },
  { value: "cost", label: "Payroll cost" },
  { value: "tax", label: "Tax & BPJS" },
] as const

const SUB: Record<string, string> = {
  workforce:
    "How many people each unit employs, and whose contract is running out.",
  time: "Whether a unit's time data can be trusted yet, and what is still open.",
  cost: "What each unit's payroll came to, and how far it has got towards being paid.",
  tax: "PPh 21 and BPJS for the month, and each person's 1721-A1 for the year.",
}

export function PeopleReports() {
  const [tab, setTab] = useState<string>("workforce")
  const unit = useUnit()

  return (
    <PageContent>
      <PageHeader
        crumb="People"
        title="Reports"
        sub={SUB[tab]}
        actions={
          tab === "time" ? (
            <UnitChoice
              unitId={unit.unitId}
              units={unit.units}
              onChange={unit.setUnitId}
            />
          ) : undefined
        }
      />

      <SubTabs tabs={TABS} value={tab} onChange={setTab} />

      {tab === "workforce" && <Workforce />}
      {tab === "time" && (
        <TimeAndAbsence unitId={unit.unitId} name={unit.name} />
      )}
      {tab === "cost" && <Cost />}
      {tab === "tax" && <TaxReports />}
    </PageContent>
  )
}

/// Who works where, from the employee list's own facets.
///
/// One request. `facets.units` is the server's count per unit, already bounded
/// by the caller's reach and already labelled — so a store manager gets their
/// own place and no comparison, which is the honest answer rather than an empty
/// table.
function Workforce() {
  const page = useQuery({
    queryKey: peopleKeys.employees({ status: "ACTIVE", limit: 1 }),
    queryFn: ({ signal }) =>
      listWorkforce({ status: "ACTIVE", limit: 1 }, signal),
  })
  const expiring = useQuery({
    queryKey: peopleKeys.expiring(60),
    queryFn: ({ signal }) => expiringContracts({ withinDays: 60 }, signal),
  })

  const units = page.data?.facets.units ?? []
  const contracts = expiring.data ?? []

  // Grouped here rather than asked for per unit: the expiring route answers for
  // every place the caller reaches in one request, and counting them by place
  // is arithmetic rather than a second question.
  const running = new Map<string, number>()
  const ended = new Map<string, number>()
  for (const contract of contracts) {
    const key = contract.unit_id ?? "—"
    const bucket = Number(contract.days_remaining) < 0 ? ended : running
    bucket.set(key, (bucket.get(key) ?? 0) + 1)
  }

  return (
    <>
      <KpiStrip className="md:grid-cols-2 xl:grid-cols-3">
        <Kpi
          label="Working here"
          value={page.data === undefined ? "—" : count(Number(page.data.total))}
        />
        <Kpi label="Units with staff" value={count(units.length)} />
        <Kpi
          label="Contracts running out in 60 days"
          value={expiring.data === undefined ? "—" : count(contracts.length)}
        />
      </KpiStrip>

      <Card className="mb-4 overflow-hidden">
        <CardHeader>
          <CardTitle>By unit</CardTitle>
        </CardHeader>
        {queryState(page, {
          loading: "Counting…",
          render: () =>
            units.length === 0 ? (
              <EmptyState>
                Nobody is posted anywhere the caller reaches — which for a
                manager means their own place has no active staff, and for head
                office means nobody has been posted at all.
              </EmptyState>
            ) : (
              <MiniTable head={["Unit", "Working", "Terms ending", ""]}>
                {units.map((unit) => (
                  <MiniRow key={unit.value}>
                    <MiniCell>{unit.label ?? unit.value}</MiniCell>
                    <MiniCell>{count(Number(unit.count))} working</MiniCell>
                    <MiniCell>
                      {running.get(unit.value) === undefined ? (
                        <span className="text-mute">no term ending</span>
                      ) : (
                        `${running.get(unit.value)} term${running.get(unit.value) === 1 ? "" : "s"} ending`
                      )}
                    </MiniCell>
                    <MiniCell>
                      {/* Separated from the column beside it on purpose: a term
                          that has already run out is a person working without a
                          contract, which is a legal problem rather than a
                          planning one. */}
                      {ended.get(unit.value) !== undefined && (
                        <Pill tone="bad">
                          {ended.get(unit.value)} already ended
                        </Pill>
                      )}
                    </MiniCell>
                  </MiniRow>
                ))}
              </MiniTable>
            ),
        })}
      </Card>

      <ActiveLettersCard />

      <p className="text-meta text-mute">
        Counted from the workforce list the app already serves, not from a
        report of its own. People posted nowhere are deliberately absent: an
        unposted record is head office's to place, and the filter beside this
        has no spelling for &ldquo;nowhere&rdquo;.
      </p>
    </>
  )
}

/// Whether one unit's time data can be trusted yet.
///
/// The two punch-derived counts come back `null` where a unit has no station
/// reporting, and `null` is rendered as *not assessed* rather than as zero —
/// "the checks passed" and "there was nothing to check" are different facts and
/// only one of them is a number.
function TimeAndAbsence({
  unitId,
  name,
}: {
  unitId: string | null
  name: string | null
}) {
  const periods = useQuery({
    queryKey: rosterKeys.periods(unitId ?? ""),
    queryFn: ({ signal }) => attendancePeriods(unitId ?? "", signal),
    enabled: unitId !== null,
  })
  const leave = useQuery({
    queryKey: leaveKeys.pending(),
    queryFn: ({ signal }) => pendingLeave(signal),
  })
  const overtime = useQuery({
    queryKey: overtimeKeys.awaiting(),
    queryFn: ({ signal }) => awaitingOvertime(signal),
  })

  const month = new Date().toISOString().slice(0, 7)
  const readiness = useQuery({
    queryKey: punchKeys.readiness(unitId ?? "", month),
    queryFn: ({ signal }) => punchReadiness(unitId ?? "", month, signal),
    enabled: unitId !== null,
  })

  const here = (rows: readonly { unit_id: string }[]) =>
    unitId === null
      ? rows.length
      : rows.filter((r) => r.unit_id === unitId).length

  if (unitId === null) {
    return (
      <Banner tone="warn">
        No unit is chosen, so there is no time data to report on.
      </Banner>
    )
  }

  return (
    <>
      <Banner tone="info" className="mb-4">
        One unit at a time. Comparing all fourteen needs a report the server
        does not have yet — the period and readiness routes each answer for one
        place, and asking twenty-eight times from a browser would make this the
        slowest screen in the module.
      </Banner>

      <Card className="mb-4 overflow-hidden">
        <CardHeader>
          <CardTitle>{name ?? unitId} — this month</CardTitle>
        </CardHeader>
        <div className="px-4 pb-4">
          {queryState(readiness, {
            loading: "Reading the month…",
            render: (now) => (
              <>
                <KeyValue term="Punch source">
                  {now.punch_source_connected
                    ? "reporting"
                    : "no station has reported — every zero below is an absence of evidence"}
                </KeyValue>
                <KeyValue term="Corrections still open">
                  {now.open_corrections === null
                    ? "not assessed"
                    : count(Number(now.open_corrections))}
                </KeyValue>
                <KeyValue term="Punches on days nobody rostered">
                  {now.unrostered_punch_days === null
                    ? "not assessed"
                    : count(Number(now.unrostered_punch_days))}
                </KeyValue>
                <KeyValue term="Leave waiting on a decision">
                  {count(here(leave.data ?? []))}
                </KeyValue>
                <KeyValue term="Overtime nobody has answered">
                  {count(here(overtime.data ?? []))}
                </KeyValue>
              </>
            ),
          })}
        </div>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>Months signed off</CardTitle>
        </CardHeader>
        {queryState(periods, {
          loading: "Reading the months…",
          render: (rows) =>
            rows.length === 0 ? (
              <EmptyState>
                No month has been closed or reopened here. An unclosed month is
                the resting state, so there is nothing to show until one is
                signed off.
              </EmptyState>
            ) : (
              <MiniTable head={["Month", "Status", ""]}>
                {rows.map((period) => (
                  <MiniRow key={period.period}>
                    <MiniCell>{period.period}</MiniCell>
                    <MiniCell>
                      <Pill tone={period.status === "CLOSED" ? "ok" : "warn"}>
                        {period.status}
                      </Pill>
                    </MiniCell>
                    <MiniCell>
                      {period.reopen_count > 0 && (
                        <Pill tone="warn">reopened ×{period.reopen_count}</Pill>
                      )}
                    </MiniCell>
                  </MiniRow>
                ))}
              </MiniTable>
            ),
        })}
      </Card>
    </>
  )
}

/// What payroll came to, per unit and month.
///
/// One request. The run list already carries the handover it produced, so the
/// gross figure and how far it has got towards being paid are on the row rather
/// than a fetch away — which is what makes a cross-unit table possible here and
/// not in the tab beside it.
///
/// **Gross, and it says so.** The handover crosses the run's gross; the
/// accrual behind it splits PPh 21 and BPJS off to what the company owes the
/// tax office and BPJS (0800). A column headed only "cost" would be read as
/// take-home pay by the first person who saw it.
function Cost() {
  const runs = useQuery({
    queryKey: payKeys.runs(),
    queryFn: ({ signal }) => listRuns(signal),
  })
  const rows = runs.data ?? []
  const crossed = rows.filter((row) => row.handover !== null)
  const gross = crossed.reduce(
    (total, row) => total + Number(row.handover?.gross_minor ?? 0),
    0
  )

  return (
    <>
      <KpiStrip className="md:grid-cols-2 xl:grid-cols-3">
        <Kpi label="Runs" value={count(rows.length)} />
        <Kpi label="With Finance" value={count(crossed.length)} />
        <Kpi
          label="Gross handed over, before deductions"
          value={crossed.length === 0 ? "—" : money(gross)}
        />
      </KpiStrip>

      <Card className="mb-4 overflow-hidden">
        <CardHeader>
          <CardTitle>By unit and month</CardTitle>
        </CardHeader>
        {queryState(runs, {
          loading: "Reading the runs…",
          render: () =>
            rows.length === 0 ? (
              <EmptyState>
                No payroll has been built. A month has to be signed off before
                its payroll can be opened.
              </EmptyState>
            ) : (
              <MiniTable
                head={["Month", "Unit", "State", "Gross · Finance", ""]}
              >
                {rows.map((row) => (
                  <MiniRow key={row.id}>
                    <MiniCell>{row.period}</MiniCell>
                    <MiniCell>{row.unit_id}</MiniCell>
                    <MiniCell>
                      <Pill tone={row.state === "APPROVED" ? "ok" : "warn"}>
                        {runStateLabel(row.state)}
                      </Pill>
                    </MiniCell>
                    <MiniCell>
                      {row.handover === null ? (
                        <span className="text-mute">not with Finance</span>
                      ) : (
                        <>
                          {money(Number(row.handover.gross_minor))}{" "}
                          <Pill
                            tone={
                              row.handover.state === "SETTLED" ? "ok" : "info"
                            }
                          >
                            {handoverLabel(row.handover.state)}
                          </Pill>
                        </>
                      )}
                    </MiniCell>
                    <MiniCell>
                      {/* A run that knows it is incomplete says so on the row
                          rather than in a total. */}
                      {!row.complete && <Pill tone="warn">incomplete</Pill>}
                    </MiniCell>
                  </MiniRow>
                ))}
              </MiniTable>
            ),
        })}
      </Card>

      <p className="text-meta text-mute">
        Every figure is gross. &ldquo;With Finance&rdquo; means the liability
        has been handed over, which is not the same as having been paid —
        settling it is Finance&rsquo;s own statement, and the column says which
        of the two has happened. Handed over on{" "}
        {crossed.length > 0 && crossed[0]?.handover
          ? day(crossed[0].handover.handed_over_at)
          : "no date yet"}
        .
      </p>
    </>
  )
}
