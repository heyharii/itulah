import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Day } from "@/components/ui/day"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, Input, Select } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { Banner, EmptyState } from "@/components/ui/states"
import { day } from "@/lib/format"
import {
  boundedTo,
  listEmployees,
  listShifts,
  peopleKeys,
  placeRoster,
  planDay,
  rosterKeys,
  useReach,
} from "@/lib/queries/people"
import { queryState } from "@/lib/query-state"
import type { RosterDayView } from "@itulah/contract"

/// Next week, per person.
///
/// # The grid is the plan, and the plan is upstream of money
///
/// "Absent" only means something against a scheduled day, so what is written
/// here is what a month is later counted against. That is why a revision keeps
/// the plan it replaced — the count has to stay answerable afterwards — and why
/// a closed month refuses a change at all. Both refusals come from the server,
/// with the sentence it uses.
///
/// # Seven columns, and no scroll
///
/// A week fits. A month does not, and a month grid is a month somebody reads
/// diagonally: the question a manager has is "is Tuesday covered", and seven
/// columns answer it at a glance where thirty would not.

/// The Monday of the week a date falls in. The statutory week is a week, not a
/// rolling seven days, and the roster is read the same way.
function mondayOf(date: Date): string {
  const copy = new Date(date)
  const back = (copy.getDay() + 6) % 7
  copy.setDate(copy.getDate() - back)
  return copy.toISOString().slice(0, 10)
}

function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00`)
  date.setDate(date.getDate() + days)
  return date.toISOString().slice(0, 10)
}

export function Roster() {
  const reach = useReach()
  const place = reach.data?.place_id ?? null
  const bounded = boundedTo(reach.data)
  const [from, setFrom] = useState(() => mondayOf(new Date()))
  const week = useMemo(
    () => Array.from({ length: 7 }, (_, index) => addDays(from, index)),
    [from]
  )
  const to = week[6]

  const days = useQuery({
    queryKey: rosterKeys.place(place ?? "", from, to),
    queryFn: ({ signal }) => placeRoster(place ?? "", from, to, signal),
    enabled: place !== null,
  })
  const team = useQuery({
    queryKey: peopleKeys.employees({ status: "ACTIVE", limit: 1000 }),
    queryFn: ({ signal }) =>
      listEmployees({ status: "ACTIVE", limit: 1000 }, signal),
  })

  // Keyed by person and date, so a cell is a lookup rather than a scan of the
  // whole week per square.
  const planned = useMemo(() => {
    const map = new Map<string, RosterDayView>()
    for (const entry of days.data ?? []) {
      map.set(`${entry.employee_id}|${entry.on_date}`, entry)
    }
    return map
  }, [days.data])

  return (
    <PageContent>
      <PageHeader
        crumb="People"
        title="Roster"
        sub={
          bounded === null
            ? "Head office reads the plan; the place that works it builds it."
            : `Next week at ${bounded}. A revision keeps the plan it replaced.`
        }
        actions={
          <Day
            value={from}
            onChange={(next) => setFrom(mondayOf(new Date(next)))}
            className="h-8 w-40"
          />
        }
      />

      {place === null && (
        <Banner tone="warn" className="mb-4">
          You are not posted anywhere, so there is no week to build.
        </Banner>
      )}

      <Card className="mb-4 overflow-hidden">
        <CardHeader>
          <CardTitle>
            {day(from)} — {day(to)}
          </CardTitle>
        </CardHeader>
        {queryState(days, {
          loading: "Reading the plan…",
          render: () =>
            (team.data ?? []).length === 0 ? (
              <EmptyState>Nobody is posted here to roster.</EmptyState>
            ) : (
              // Its own scroller: seven columns fit a laptop and not a phone,
              // and the page body must never scroll sideways.
              <div className="overflow-x-auto px-4 pb-4">
                <table className="w-full min-w-[46rem] border-collapse">
                  <thead>
                    <tr>
                      <th className="w-40 pb-2 text-left text-eyebrow text-mute uppercase">
                        Who
                      </th>
                      {week.map((date) => (
                        <th
                          key={date}
                          className="pb-2 text-left text-eyebrow text-mute uppercase"
                        >
                          {day(date)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(team.data ?? []).map((person) => (
                      <tr
                        key={person.employee_id}
                        className="border-t border-hairline"
                      >
                        <td className="py-2 pr-3 text-cell text-ink">
                          {person.full_name ?? person.employee_code}
                        </td>
                        {week.map((date) => {
                          const entry = planned.get(
                            `${person.employee_id}|${date}`
                          )
                          return (
                            <td key={date} className="py-2 pr-3">
                              {entry === undefined ? (
                                <span className="text-mute">—</span>
                              ) : (
                                <span className="flex items-baseline gap-1.5">
                                  <span className="text-cell text-ink">
                                    {entry.plan === "SCHEDULED"
                                      ? (entry.shift_name ?? entry.shift_id)
                                      : entry.plan === "REST_DAY"
                                        ? "Rest"
                                        : "Holiday"}
                                  </span>
                                  {/* A day planned more than once is a
                                      governance signal, so it is on the cell
                                      rather than a click away. */}
                                  {entry.revision_count > 1 && (
                                    <Pill tone="info">
                                      ×{entry.revision_count}
                                    </Pill>
                                  )}
                                </span>
                              )}
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ),
        })}
      </Card>

      {place !== null && <PlanDay place={place} from={from} to={to} />}
    </PageContent>
  )
}

function PlanDay({
  place,
  from,
  to,
}: {
  place: string
  from: string
  to: string
}) {
  const client = useQueryClient()
  const [employeeId, setEmployeeId] = useState("")
  const [onDate, setOnDate] = useState(from)
  const [plan, setPlan] = useState<"SCHEDULED" | "REST_DAY" | "PUBLIC_HOLIDAY">(
    "SCHEDULED"
  )
  const [shiftId, setShiftId] = useState("")
  const [reason, setReason] = useState("")
  const [failed, setFailed] = useState<string | null>(null)

  const shifts = useQuery({
    queryKey: rosterKeys.shifts(),
    queryFn: ({ signal }) => listShifts(signal),
  })
  const team = useQuery({
    queryKey: peopleKeys.employees({ status: "ACTIVE", limit: 1000 }),
    queryFn: ({ signal }) =>
      listEmployees({ status: "ACTIVE", limit: 1000 }, signal),
  })

  const write = useMutation({
    mutationFn: () =>
      planDay(employeeId, {
        onDate,
        plan,
        shiftId: shiftId === "" ? undefined : shiftId,
        reason: reason.trim(),
      }),
    onSuccess: () => {
      setFailed(null)
      setReason("")
      void client.invalidateQueries({
        queryKey: rosterKeys.place(place, from, to),
      })
    },
    onError: (error: Error) => setFailed(error.message),
  })

  const ready =
    employeeId !== "" &&
    onDate !== "" &&
    reason.trim() !== "" &&
    (plan !== "SCHEDULED" || shiftId !== "")

  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle>Plan a day</CardTitle>
      </CardHeader>
      <div className="flex flex-col gap-3 px-4 pb-4">
        {failed !== null && <Banner tone="bad">{failed}</Banner>}
        {/* Planning a day that is already planned is a revision, and the earlier
            plan survives. Saying so here is cheaper than a second form. */}
        <Banner tone="info">
          Planning a day that already has a plan revises it. The plan it
          replaces is kept.
        </Banner>

        <Field label="Who">
          <Select value={employeeId} onChange={setEmployeeId}>
            <option value="">Choose…</option>
            {(team.data ?? []).map((person) => (
              <option key={person.employee_id} value={person.employee_id}>
                {person.full_name ?? person.employee_code}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Date">
          <Day value={onDate} onChange={setOnDate} />
        </Field>
        <Field label="Plan">
          <Select
            value={plan}
            onChange={(next) => {
              setPlan(next as typeof plan)
              if (next !== "SCHEDULED") setShiftId("")
            }}
          >
            <option value="SCHEDULED">A shift</option>
            <option value="REST_DAY">Rest day</option>
            <option value="PUBLIC_HOLIDAY">Public holiday</option>
          </Select>
        </Field>
        {plan === "SCHEDULED" && (
          <Field label="Shift">
            <Select value={shiftId} onChange={setShiftId}>
              <option value="">Choose…</option>
              {(shifts.data ?? []).map((shift) => (
                <option key={shift.id} value={shift.id}>
                  {shift.name} · {shift.starts_at}–{shift.ends_at}
                  {shift.crosses_midnight && " (next day)"}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="Why" hint="Recorded against the plan, and required.">
          <Input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="jadwal minggu ini"
          />
        </Field>
        <div>
          <Button
            variant="primary"
            disabled={!ready || write.isPending}
            onClick={() => write.mutate()}
          >
            Plan it
          </Button>
        </div>
      </div>
    </Card>
  )
}
