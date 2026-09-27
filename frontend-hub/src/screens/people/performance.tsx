import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, Input, Select } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Banner, EmptyState } from "@/components/ui/states"
import {
  bonusTierFor,
  listEmployees,
  listPerformanceScores,
  listPerformanceTemplates,
  nextKeys,
  peopleKeys,
  readRules,
  recordPerformanceScore,
  useReach,
} from "@/lib/queries/people"
import { queryState } from "@/lib/query-state"

/// Performance: one person's month, against the template their position
/// carries.
///
/// The template says which figures a position is measured on and where each
/// comes from — POS, attendance, the manager's own judgement. The POS figures
/// are typed by hand until the till hands them over, and the template says so,
/// which is the honest version of a screen that would otherwise read as if
/// the numbers were wired.
///
/// The bonus tier is never stored. It is derived on read from the rule
/// numbers, so a policy change shows on every screen that displays a tier —
/// including the ones for months already recorded.

export function Performance() {
  const client = useQueryClient()
  const reach = useReach()
  const [period, setPeriod] = useState(currentPeriod())

  const team = useQuery({
    queryKey: peopleKeys.employees({ status: "ACTIVE", limit: 1000 }),
    queryFn: ({ signal }) => listEmployees({ status: "ACTIVE", limit: 1000 }, signal),
  })
  const templates = useQuery({
    queryKey: nextKeys.performanceTemplates(),
    queryFn: ({ signal }) => listPerformanceTemplates(signal),
  })
  const rules = useQuery({
    queryKey: nextKeys.rules("pay"),
    queryFn: ({ signal }) => readRules({ group: "pay" }, signal),
  })
  const scores = useQuery({
    queryKey: nextKeys.scores(period),
    queryFn: ({ signal }) => listPerformanceScores({ period }, signal),
  })
  const people = (team.data ?? []).map((person) => ({ id: person.employee_id, name: person.full_name ?? person.employee_code ?? person.employee_id }))
  const nameOf = (id: string) => people.find((person) => person.id === id)?.name ?? id
  const tierFor = (kpi: number) => bonusTierFor(rules.data, kpi)

  return (
    <PageContent>
      <PageHeader
        crumb="People · Talent"
        title="Performance"
        sub="One person, one month. The tier shown is derived from today's rule numbers, never stored with the score."
        actions={
          <Field label="Period">
            <Input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} />
          </Field>
        }
      />

      <Card className="mb-4 overflow-hidden">
        <CardHeader>
          <CardTitle>Recorded scores · {period}</CardTitle>
        </CardHeader>
        {queryState(scores, {
          loading: "Reading the scores…",
          render: () =>
            (scores.data ?? []).length === 0 ? (
              <EmptyState>
                Nobody has a recorded score for this month yet. The store head
                records one per person below.
              </EmptyState>
            ) : (
              <div className="divide-y">
                {(scores.data ?? []).map((score) => (
                  <div key={score.employee_id} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-2.5">
                    <span className="font-medium text-ink">{nameOf(score.employee_id)}</span>
                    <span className="text-body">
                      KPI {score.kpi_pct}% · manager {score.manager_score}/5 · bonus{" "}
                      <span className="font-medium text-ink">{score.bonus_rate_pct}% of base</span>
                    </span>
                  </div>
                ))}
              </div>
            ),
        })}
      </Card>

      {reach.data?.role === "SUPERVISOR" || reach.data?.role === "ADMIN" ? (
        <RecordScore
          team={people}
          period={period}
          tierFor={tierFor}
          onDone={() => client.invalidateQueries({ queryKey: nextKeys.scores() })}
        />
      ) : null}

      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>Templates, by position</CardTitle>
        </CardHeader>
        {queryState(templates, {
          loading: "Reading the templates…",
          render: () =>
            (templates.data ?? []).length === 0 ? (
              <EmptyState>No position has a template yet.</EmptyState>
            ) : (
              <div className="divide-y">
                {(templates.data ?? []).map((template) => (
                  <div key={`${template.position}/${template.metric}`} className="flex items-baseline justify-between gap-3 px-4 py-2">
                    <span className="text-body">
                      {template.position} · {template.metric}
                    </span>
                    <span className="text-meta text-mute">
                      {template.weight}% · from {template.source.toLowerCase()}
                    </span>
                  </div>
                ))}
              </div>
            ),
        })}
      </Card>
    </PageContent>
  )
}

function RecordScore({
  team,
  period,
  tierFor,
  onDone,
}: {
  team: { id: string; name: string }[]
  period: string
  tierFor: (kpi: number) => number | null
  onDone: () => void
}) {
  const [employeeId, setEmployeeId] = useState("")
  const [kpi, setKpi] = useState("100")
  const [score, setScore] = useState("3")
  const [reason, setReason] = useState("")
  const [failed, setFailed] = useState<string | null>(null)

  const record = useMutation({
    mutationFn: () =>
      recordPerformanceScore(employeeId, `${period}-01`, {
        kpi_pct: Number(kpi),
        manager_score: Number(score),
        reason,
      }),
    onSuccess: () => {
      onDone()
      setFailed(null)
      setReason("")
    },
    onError: (error: Error) => setFailed(error.message),
  })

  const preview = tierFor(Number(kpi))
  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle>Record a score</CardTitle>
      </CardHeader>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Who">
          <Select value={employeeId} onChange={setEmployeeId}>
            <option value="">Choose a person…</option>
            {team.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="KPI %">
          <Input inputMode="numeric" value={kpi} onChange={(e) => setKpi(e.target.value.replace(/[^\d]/g, ""))} />
        </Field>
        <Field label="Manager score">
          <Select value={score} onChange={setScore}>
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={String(n)}>
                {n} / 5
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Why">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </div>
      {preview !== null && preview > 0 ? (
        <Banner tone="info" className="mt-3">
          {kpi}% KPI earns a {preview}% bonus tier under today's rules.
        </Banner>
      ) : null}
      {failed ? <Banner tone="bad">{failed}</Banner> : null}
      <div className="mt-3 flex justify-end">
        <Button
          variant="primary"
          disabled={employeeId === "" || kpi === "" || reason.trim() === "" || record.isPending}
          onClick={() => record.mutate()}
        >
          Record
        </Button>
      </div>
    </Card>
  )
}

function currentPeriod(): string {
  return new Date().toISOString().slice(0, 7)
}
