import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Target } from "lucide-react"
import { useState } from "react"

import { Card } from "@/components/ui/card"
import { Field, Input } from "@/components/ui/field"
import { PeopleSheet, SheetSection } from "@/components/ui/people-sheet"
import { PeopleTable } from "@/components/ui/people-table"
import { Pill } from "@/components/ui/pill"
import { Segmented } from "@/components/ui/segmented"
import {
  hrKeys,
  isoMonth,
  performanceScores,
  performanceTemplates,
  readMonth,
  recordScore,
  useReach,
  type StoreScope,
} from "@/lib/queries/hr"
import { centreState } from "@/screens/hr/centre"
import { Facts, Heading, Person, Submit } from "@/screens/hr/parts"
import { personName, useTeam } from "@/screens/hr/words"
import { HrWorkspace } from "@/screens/hr/workspace"
import type { EmployeeList, PerformanceScoreView } from "@itulah/contract"

/// Performance at this shop — the prototype's store Performance.
///
/// "KPI bulanan diambil dari POS dan absensi; kepala toko menambah nilai
/// perilaku": the month's KPI comes from the till's sales and the attendance
/// month — typed here until the tills hand it over — and the store head adds
/// the behaviour score, which is the half of the template marked as the
/// manager's. The month's KPI decides the bonus tier in payroll; the tier is
/// derived at head office from the rule numbers and never stored with the
/// score. Templates and weights are head office's.
export function HrPerformance() {
  return (
    <HrWorkspace>
      {(scope) => <Performance scope={scope} />}
    </HrWorkspace>
  )
}

const MONTHS = [
  { value: "this", label: "This month" },
  { value: "last", label: "Last month" },
] as const

function Performance({ scope }: { scope: StoreScope }) {
  const [which, setWhich] = useState<(typeof MONTHS)[number]["value"]>("this")
  const now = new Date()
  const period =
    which === "this"
      ? isoMonth(now)
      : isoMonth(new Date(now.getFullYear(), now.getMonth() - 1, 1))

  const team = useTeam(scope)
  const templates = useQuery({
    queryKey: [...hrKeys.performance(), "templates"],
    queryFn: ({ signal }) => performanceTemplates(signal),
    staleTime: 5 * 60_000,
  })
  const scores = useQuery({
    queryKey: [...hrKeys.performance(), period],
    queryFn: ({ signal }) => performanceScores(period, signal),
  })
  const [open, setOpen] = useState<string | null>(null)

  // The store head does not score themselves — the prototype leaves the
  // *kepala toko* off this list — so the signed-in person's own record is left
  // out. Their month is scored by head office.
  const reach = useReach(true)
  const self = reach.data?.employee_id ?? null
  const people = (team.data?.rows ?? []).filter(
    (person) => person.status === "ACTIVE" && person.employee_id !== self,
  )
  const scoreOf = (employeeId: string): PerformanceScoreView | undefined =>
    scores.data?.find((score) => score.employee_id === employeeId)

  return (
    <>
      <div className="mb-4 md:max-w-[20rem]">
        <Segmented options={MONTHS} value={which} onChange={setWhich} />
      </div>
      <Heading>{readMonth(period)}</Heading>
      {centreState(scores, {
        loading: "Loading…",
        what: "this month's performance scores",
        render: () => (
          <PeopleTable
            rows={people}
            rowKey={(person) => person.employee_id}
            onRowClick={(person) => setOpen(person.employee_id)}
            empty="Nobody is posted here."
            columns={[
              {
                key: "who",
                header: "Employee",
                cell: (person) => (
                  <Person team={team.data} id={person.employee_id} />
                ),
              },
              {
                key: "kpi",
                header: "KPI",
                align: "right",
                cell: (person) => {
                  const score = scoreOf(person.employee_id)
                  return score === undefined ? "—" : `${score.kpi_pct}%`
                },
              },
              {
                key: "manager",
                header: "Store head's score",
                align: "right",
                cell: (person) => {
                  const score = scoreOf(person.employee_id)
                  return score === undefined
                    ? "—"
                    : `${score.manager_score} / 5`
                },
              },
              {
                key: "bonus",
                header: "Bonus tier",
                align: "right",
                cell: (person) => {
                  const score = scoreOf(person.employee_id)
                  return score === undefined
                    ? "—"
                    : `${score.bonus_rate_pct}% of base`
                },
              },
              {
                key: "state",
                header: "Status",
                card: "status",
                cell: (person) =>
                  scoreOf(person.employee_id) === undefined ? (
                    <Pill tone="warn">To score</Pill>
                  ) : (
                    <Pill tone="ok">Scored</Pill>
                  ),
              },
            ]}
          />
        ),
      })}

      <Heading>Templates, by position</Heading>
      {centreState(templates, {
        loading: "Loading…",
        what: "the performance templates",
        render: (rows) => {
          const byPosition = new Map<string, typeof rows>()
          for (const row of rows) {
            byPosition.set(row.position, [
              ...(byPosition.get(row.position) ?? []),
              row,
            ])
          }
          return byPosition.size === 0 ? (
            <p className="text-meta text-body">
              No templates yet.
            </p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {[...byPosition.entries()].map(([position, metrics]) => (
                <Card key={position} className="px-4 py-3">
                  <div className="mb-2 flex items-center gap-2 text-card-title font-semibold text-ink [&_svg]:size-4 [&_svg]:text-line-ico">
                    <Target />
                    {position}
                  </div>
                  <ul className="flex flex-col gap-1.5">
                    {metrics.map((metric) => (
                      <li
                        key={metric.metric}
                        className="flex items-baseline justify-between gap-3 text-cell"
                      >
                        <span className="min-w-0 text-body">
                          {metric.metric}
                          <span className="block text-[0.6875rem] text-mute">
                            from{" "}
                            {metric.source.toLowerCase().replace(/_/g, " ")}
                          </span>
                        </span>
                        <span className="font-semibold text-ink tabular-nums">
                          {metric.weight}%
                        </span>
                      </li>
                    ))}
                  </ul>
                </Card>
              ))}
            </div>
          )
        },
      })}

      {open !== null && (
        <ScoreSheet
          key={`${open}-${period}`}
          employeeId={open}
          period={period}
          current={scoreOf(open)}
          team={team.data}
          onClose={() => setOpen(null)}
        />
      )}
    </>
  )
}

/// Record one person's month — the store head's judgement, bounded by reach.
function ScoreSheet({
  employeeId,
  period,
  current,
  team,
  onClose,
}: {
  employeeId: string
  period: string
  current: PerformanceScoreView | undefined
  team: EmployeeList | undefined
  onClose: () => void
}) {
  const client = useQueryClient()
  const [kpi, setKpi] = useState(
    current === undefined ? "" : String(current.kpi_pct),
  )
  const [score, setScore] = useState(
    current === undefined ? "3" : String(current.manager_score),
  )
  const [reason, setReason] = useState("")
  const record = useMutation({
    mutationFn: () =>
      recordScore({
        employeeId,
        period: `${period}-01`,
        kpiPct: Number(kpi),
        managerScore: Number(score),
        reason,
      }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: hrKeys.performance() })
      onClose()
    },
  })

  return (
    <PeopleSheet
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      crumb="Performance"
      title={personName(team, employeeId)}
      sub={readMonth(period)}
      status={
        current === undefined ? (
          <Pill tone="warn">Not scored yet</Pill>
        ) : (
          <Pill tone="ok">Bonus tier {current.bonus_rate_pct}%</Pill>
        )
      }
      foot={
        <Submit
          label={
            current === undefined ? "Record the score" : "Record a new score"
          }
          pending={record.isPending}
          disabled={kpi === "" || !(Number(kpi) >= 0) || reason.trim() === ""}
          error={record.error}
          onSubmit={() => record.mutate()}
        />
      }
    >
      {current !== undefined && (
        <SheetSection title="As recorded">
          <Facts
            rows={[
              ["KPI", `${current.kpi_pct}%`],
              ["Store head's score", `${current.manager_score} / 5`],
              ["Bonus tier", `${current.bonus_rate_pct}% of base`],
              ["Recorded by", current.recorded_by],
              current.note !== null && ["Note", current.note],
            ]}
          />
        </SheetSection>
      )}
      <SheetSection title="Score">
        <div className="flex flex-col gap-3">
          <Field
            label="KPI %"
          >
            <Input
              inputMode="decimal"
              value={kpi}
              placeholder="104"
              onChange={(event) =>
                setKpi(event.target.value.replace(/[^\d.]/g, ""))
              }
            />
          </Field>
          <Field label="Store head's score">
            <Segmented
              options={["1", "2", "3", "4", "5"].map((value) => ({
                value,
                label: value,
              }))}
              value={score}
              onChange={setScore}
            />
          </Field>
          <Field label="Reason">
            <Input
              value={reason}
              placeholder="Handled the stock count alone"
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>
        </div>
      </SheetSection>
    </PeopleSheet>
  )
}
