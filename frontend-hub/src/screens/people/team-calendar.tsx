import { useQuery } from "@tanstack/react-query"
import { useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { AppLink } from "@/components/ui/app-link"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { PageHeader } from "@/components/ui/page-header"
import { EmptyState } from "@/components/ui/states"
import { holidayWork, leaveExtraKeys, teamCalendar } from "@/lib/queries/people"
import { queryState } from "@/lib/query-state"
import { cn } from "@/lib/utils"
import type { TeamCalendarView, TeamLeaveSpan } from "@itulah/contract"

/// Kalender tim: who is away when, a month at a time — approved leave solid,
/// leave still waiting on a decision outlined — with the public holidays and
/// the dates closed to leave marked on the days. Head office sees every unit;
/// a manager their own.
export function TeamCalendar() {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7))
  const first = `${month}-01`
  const [year, monthNumber] = month.split("-").map(Number) as [number, number]
  const daysInMonth = new Date(year, monthNumber, 0).getDate()
  const last = `${month}-${String(daysInMonth).padStart(2, "0")}`
  const calendar = useQuery({
    queryKey: leaveExtraKeys.calendar(first, last),
    queryFn: ({ signal }) => teamCalendar(first, last, signal),
  })
  const worked = useQuery({
    queryKey: leaveExtraKeys.holidayWork(first, last),
    queryFn: ({ signal }) => holidayWork(first, last, signal),
  })
  const step = (by: number) => {
    const next = new Date(year, monthNumber - 1 + by, 1)
    setMonth(
      `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`
    )
  }

  return (
    <PageContent>
      <PageHeader
        crumb="People"
        title="Team Calendar"
        sub="Who is away when, with the holidays and the dates closed to leave."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="quiet" onClick={() => step(-1)}>
              ‹
            </Button>
            <span className="min-w-28 text-center text-[0.875rem] font-medium text-ink">
              {new Date(year, monthNumber - 1, 1).toLocaleDateString("en-GB", {
                month: "long",
                year: "numeric",
              })}
            </span>
            <Button variant="quiet" onClick={() => step(1)}>
              ›
            </Button>
          </div>
        }
      />
      <Card className="mb-4 overflow-hidden">
        {queryState(calendar, {
          loading: "Reading the month…",
          render: (view) => (
            <MonthGrid view={view} month={month} days={daysInMonth} />
          ),
        })}
      </Card>
      {(worked.data ?? []).length > 0 && (
        <Card className="mb-4 p-4">
          <p className="mb-2 text-card-title font-semibold text-ink">
            Holidays and rest days worked
          </p>
          <ul className="flex flex-col gap-1 text-[0.875rem]">
            {(worked.data ?? []).map((row) => (
              <li key={row.id}>
                <span className="font-mono">{row.on_date}</span> ·{" "}
                {row.full_name ?? row.employee_code} ·{" "}
                {row.day_kind === "PUBLIC_HOLIDAY"
                  ? "public holiday"
                  : "rest day"}{" "}
                · {row.centidays / 100} day back · {row.reason}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </PageContent>
  )
}

function MonthGrid({
  view,
  month,
  days,
}: {
  view: TeamCalendarView
  month: string
  days: number
}) {
  const dates = Array.from(
    { length: days },
    (_, index) => `${month}-${String(index + 1).padStart(2, "0")}`
  )
  const holidays = new Map(view.holidays.map(([date, name]) => [date, name]))
  const blocked = (date: string) =>
    view.blocked.find((b) => b.from_date <= date && b.to_date >= date)
  const people = new Map<string, TeamLeaveSpan[]>()
  for (const span of view.leave) {
    const list = people.get(span.employee_id) ?? []
    list.push(span)
    people.set(span.employee_id, list)
  }

  if (people.size === 0 && holidays.size === 0 && view.blocked.length === 0) {
    return <EmptyState>Nobody is away this month.</EmptyState>
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-max border-collapse text-[0.875rem]">
        <thead>
          <tr>
            <th className="sticky left-0 min-w-44 bg-canvas px-3 py-2 text-left font-medium text-mute">
              Who
            </th>
            {dates.map((date) => {
              const weekday = new Date(`${date}T00:00:00`).getDay()
              const off = holidays.has(date) || weekday === 0
              return (
                <th
                  key={date}
                  title={
                    holidays.get(date) ?? blocked(date)?.reason ?? undefined
                  }
                  className={cn(
                    "min-w-9 px-0.5 py-2 text-center font-medium tabular-nums",
                    off ? "text-bad-fg" : "text-mute",
                    blocked(date) !== undefined && "bg-warn-bg"
                  )}
                >
                  {Number(date.slice(8))}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {[...people.entries()].map(([employee, spans]) => (
            <tr key={employee} className="border-t border-hairline">
              <td className="sticky left-0 bg-canvas px-3 py-1.5">
                <AppLink
                  to="/people"
                  sheet={{ key: "employee", value: employee }}
                  className="text-ink hover:underline"
                >
                  {spans[0]?.full_name ?? spans[0]?.employee_code}
                </AppLink>
                <span className="block text-mute">{spans[0]?.unit_id}</span>
              </td>
              {dates.map((date) => {
                const span = spans.find(
                  (one) => one.from_date <= date && one.to_date >= date
                )
                return (
                  <td key={date} className="min-w-9 px-0.5 py-1.5">
                    {span !== undefined && (
                      <span
                        title={`${span.leave_name} · ${span.state === "APPROVED" ? "approved" : "waiting"}`}
                        className={cn(
                          "block h-5 rounded-inner",
                          span.state === "APPROVED"
                            ? "bg-accent"
                            : "border border-accent bg-transparent"
                        )}
                      />
                    )}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="px-3 py-2 text-[0.875rem] text-mute">
        Solid: approved. Outlined: waiting on a decision. Red dates are Sundays
        and public holidays; shaded dates are closed to leave.
      </p>
    </div>
  )
}
