import { useQuery } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { DockChoice } from "@/components/shell/dock-tools"
import { AppLink } from "@/components/ui/app-link"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { PageHeader } from "@/components/ui/page-header"
import { EmptyState } from "@/components/ui/states"
import { day, dayMonth, monthYear } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import { holidayWork, leaveExtraKeys, teamCalendar } from "@/lib/queries/people"
import { queryState } from "@/lib/query-state"
import { cn } from "@/lib/utils"
import { monthOptions } from "@/screens/people/parts"
import {
  CardButton,
  CardFigure,
  CardName,
  PhoneCards,
} from "@/components/ui/phone-cards"
import type { TeamCalendarView, TeamLeaveSpan } from "@itulah/contract"

/// Kalender tim: who is away when, a month at a time — approved leave solid,
/// leave still waiting on a decision outlined — with the public holidays and
/// the dates closed to leave marked on the days. Head office sees every unit;
/// a manager their own.
export function TeamCalendar() {
  const phone = useLayout() === "phone"
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
        // On a phone the month is the chip over the bottom bar.
        actions={
          phone ? undefined : (
            <div className="flex items-center gap-2">
              <Button variant="quiet" onClick={() => step(-1)}>
                ‹
              </Button>
              <span className="min-w-28 text-center text-[0.875rem] font-medium text-ink">
                {monthYear(new Date(year, monthNumber - 1, 1), true)}
              </span>
              <Button variant="quiet" onClick={() => step(1)}>
                ›
              </Button>
            </div>
          )
        }
      />
      {phone && (
        <DockChoice
          value={month}
          onChange={setMonth}
          options={monthOptions(month).map((value) => {
            const [y, m] = value.split("-").map(Number) as [number, number]
            const title = monthYear(new Date(y, m - 1, 1), true)
            return { value, label: title, short: title }
          })}
        />
      )}
      <Card className="mb-4 overflow-hidden max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
        {queryState(calendar, {
          loading: "Reading the month…",
          render: (view) =>
            phone ? (
              <MonthList view={view} month={month} days={daysInMonth} />
            ) : (
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

/// The month on a phone: one card per person who is away, with how many days
/// of the month they are away and each stretch under their name — in place of
/// a thirty-column grid. The holidays and the dates closed to leave follow.
function MonthList({
  view,
  month,
  days,
}: {
  view: TeamCalendarView
  month: string
  days: number
}) {
  const navigate = useNavigate()
  const first = `${month}-01`
  const last = `${month}-${String(days).padStart(2, "0")}`
  const people = new Map<string, TeamLeaveSpan[]>()
  for (const span of view.leave) {
    const list = people.get(span.employee_id) ?? []
    list.push(span)
    people.set(span.employee_id, list)
  }
  const open = (employeeId: string) =>
    void navigate({
      to: "/people",
      search: { employee: employeeId },
    } as never)
  /// Days of the month a stretch covers, ends included.
  const within = (span: TeamLeaveSpan) => {
    const from = span.from_date > first ? span.from_date : first
    const to = span.to_date < last ? span.to_date : last
    return Math.max(
      0,
      Math.round(
        (new Date(`${to}T00:00:00Z`).getTime() -
          new Date(`${from}T00:00:00Z`).getTime()) /
          86_400_000
      ) + 1
    )
  }
  const rows = [...people.entries()].map(([employee, spans]) => ({
    employee,
    spans,
    away: spans.reduce((total, span) => total + within(span), 0),
  }))

  if (
    rows.length === 0 &&
    view.holidays.length === 0 &&
    view.blocked.length === 0
  ) {
    return <EmptyState>Nobody is away this month.</EmptyState>
  }

  return (
    <div className="flex flex-col gap-3">
      {rows.length > 0 && (
        <PhoneCards
          rows={rows}
          onOpen={(row) => open(row.employee)}
          rowId={(row) => row.employee}
          spec={{
            title: (row) => (
              <CardName
                name={row.spans[0]?.full_name ?? row.spans[0]?.employee_code}
                line={row.spans[0]?.unit_id}
              />
            ),
            lead: (row) => (
              <CardFigure
                value={row.away}
                caption={row.away === 1 ? "day away" : "days away"}
              />
            ),
            foot: (row) => (
              <span className="flex flex-col leading-6">
                {row.spans.map((span) => (
                  <span
                    key={`${span.leave_type}-${span.from_date}-${span.to_date}`}
                  >
                    {span.from_date === span.to_date
                      ? day(span.from_date)
                      : `${dayMonth(span.from_date)} – ${day(span.to_date)}`}{" "}
                    · {span.leave_name}
                    {span.state === "APPROVED" ? "" : " · waiting"}
                  </span>
                ))}
              </span>
            ),
            action: (row) => (
              <CardButton
                label="Open"
                ariaLabel={`Open ${row.spans[0]?.full_name ?? row.spans[0]?.employee_code}`}
                onClick={() => open(row.employee)}
              />
            ),
          }}
        />
      )}
      {view.holidays.length > 0 && (
        <Card className="p-4">
          <p className="mb-2 text-card-title font-semibold text-ink">
            Public holidays
          </p>
          <ul className="flex flex-col gap-1 text-[0.875rem]">
            {view.holidays.map(([date, name]) => (
              <li key={date}>
                <span className="tabular-nums">{day(date)}</span> · {name}
              </li>
            ))}
          </ul>
        </Card>
      )}
      {view.blocked.length > 0 && (
        <Card className="p-4">
          <p className="mb-2 text-card-title font-semibold text-ink">
            Closed to leave
          </p>
          <ul className="flex flex-col gap-1 text-[0.875rem]">
            {view.blocked.map((block) => (
              <li key={`${block.from_date}-${block.to_date}-${block.reason}`}>
                <span className="tabular-nums">
                  {block.from_date === block.to_date
                    ? day(block.from_date)
                    : `${dayMonth(block.from_date)} – ${day(block.to_date)}`}
                </span>{" "}
                · {block.reason}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
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
