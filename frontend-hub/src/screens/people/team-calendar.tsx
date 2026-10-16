import { useQuery } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { DockChoice } from "@/components/shell/dock-tools"
import { AppLink } from "@/components/ui/app-link"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { PageHeader } from "@/components/ui/page-header"
import { MiniCell, MiniRow, MiniTable, SubHead } from "@/components/ui/rows"
import { ButtonGroup, Toolbar } from "@/components/ui/segmented"
import { EmptyState } from "@/components/ui/states"
import { dateRange, day, weekday } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import {
  currentMonth,
  monthBounds,
  monthTitle,
  stepMonth,
  useActiveEmployees,
} from "@/lib/queries/hr-time"
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

/// Roster › Month: who is away when, a month at a time — approved leave solid,
/// leave still waiting on a decision outlined — with the public holidays and
/// the dates closed to leave marked on the days. Head office sees every unit;
/// a manager their own.
///
/// The Week view reads the same team calendar, so a day of leave reads the
/// same on both.
export function TeamCalendar() {
  const phone = useLayout() === "phone"
  const [month, setMonth] = useState(currentMonth)
  const { from: first, to: last } = monthBounds(month)
  const daysInMonth = Number(last.slice(8))
  const calendar = useQuery({
    queryKey: leaveExtraKeys.calendar(first, last),
    queryFn: ({ signal }) => teamCalendar(first, last, signal),
  })
  const worked = useQuery({
    queryKey: leaveExtraKeys.holidayWork(first, last),
    queryFn: ({ signal }) => holidayWork(first, last, signal),
  })
  const { people } = useActiveEmployees()
  /// Unit ids are codes; the people list knows what each is called.
  const unitNames = useMemo(() => {
    const map = new Map<string, string>()
    for (const one of people) {
      if (one.unit_id !== null)
        map.set(one.unit_id, one.unit_name ?? one.unit_id)
    }
    return map
  }, [people])

  return (
    <PageContent>
      <PageHeader title="Roster" />
      {phone ? (
        // On a phone the month is the chip over the bottom bar.
        <DockChoice
          title="Month"
          value={month}
          onChange={setMonth}
          options={monthOptions(month).map((value) => ({
            value,
            label: monthTitle(value),
            short: monthTitle(value),
          }))}
        />
      ) : (
        <Toolbar>
          <ButtonGroup>
            <Button
              variant="ghost"
              aria-label="Previous month"
              onClick={() => setMonth(stepMonth(month, -1))}
            >
              ‹
            </Button>
            <Button variant="ghost" onClick={() => setMonth(currentMonth())}>
              {monthTitle(month)}
            </Button>
            <Button
              variant="ghost"
              aria-label="Next month"
              onClick={() => setMonth(stepMonth(month, 1))}
            >
              ›
            </Button>
          </ButtonGroup>
        </Toolbar>
      )}
      <Card className="mb-4 overflow-hidden max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
        {queryState(calendar, {
          loading: "Reading the month…",
          render: (view) =>
            phone ? (
              <MonthList
                view={view}
                month={month}
                days={daysInMonth}
                unitNames={unitNames}
              />
            ) : (
              <MonthGrid
                view={view}
                month={month}
                days={daysInMonth}
                unitNames={unitNames}
              />
            ),
        })}
      </Card>
      {(worked.data ?? []).length > 0 && (
        <Card className="mb-4 p-4">
          <SubHead>Holidays and rest days worked</SubHead>
          <MiniTable
            head={[
              "Date",
              { label: "Employee", align: "left" },
              { label: "Day", align: "left" },
              "Days back",
              { label: "Reason", align: "left" },
            ]}
          >
            {(worked.data ?? []).map((row) => (
              <MiniRow key={row.id}>
                <MiniCell>{weekday(row.on_date, true)}</MiniCell>
                <MiniCell>{row.full_name ?? row.employee_code}</MiniCell>
                <MiniCell>
                  {row.day_kind === "PUBLIC_HOLIDAY"
                    ? "Public holiday"
                    : "Rest day"}
                </MiniCell>
                <MiniCell align="right">{row.centidays / 100}</MiniCell>
                <MiniCell>{row.reason}</MiniCell>
              </MiniRow>
            ))}
          </MiniTable>
        </Card>
      )}
    </PageContent>
  )
}

/// The span that reads on a day: where an approved stretch and a waiting one
/// cover the same date, the approved one.
function readOn(
  spans: readonly TeamLeaveSpan[],
  date: string
): TeamLeaveSpan | undefined {
  const covering = spans.filter(
    (one) => one.from_date <= date && one.to_date >= date
  )
  return covering.find((one) => one.state === "APPROVED") ?? covering[0]
}

/// The month on a phone: one card per person who is away, with how many days
/// of the month they are away and each stretch under their name — in place of
/// a thirty-column grid. The holidays and the dates closed to leave follow.
function MonthList({
  view,
  month,
  days,
  unitNames,
}: {
  view: TeamCalendarView
  month: string
  days: number
  unitNames: ReadonlyMap<string, string>
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
                line={
                  row.spans[0] === undefined
                    ? undefined
                    : (unitNames.get(row.spans[0].unit_id) ??
                      row.spans[0].unit_id)
                }
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
                    {dateRange(span.from_date, span.to_date)} ·{" "}
                    {span.state === "APPROVED"
                      ? span.leave_name
                      : `Waiting · ${span.leave_name}`}
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
          <SubHead>Public holidays</SubHead>
          <ul className="flex flex-col gap-1 text-[0.9375rem]">
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
          <SubHead>Closed to leave</SubHead>
          <ul className="flex flex-col gap-1 text-[0.9375rem]">
            {view.blocked.map((block) => (
              <li key={`${block.from_date}-${block.to_date}-${block.reason}`}>
                <span className="tabular-nums">
                  {dateRange(block.from_date, block.to_date)}
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
  unitNames,
}: {
  view: TeamCalendarView
  month: string
  days: number
  unitNames: ReadonlyMap<string, string>
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
      <table className="w-full min-w-max border-collapse text-[0.9375rem]">
        <thead>
          <tr>
            <th className="sticky left-0 min-w-44 bg-canvas px-3 py-2 text-left font-medium text-mute">
              Who
            </th>
            {dates.map((date) => {
              const dayOfWeek = new Date(`${date}T00:00:00`).getDay()
              const off = holidays.has(date) || dayOfWeek === 0
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
                <span className="block text-mute">
                  {spans[0] === undefined
                    ? ""
                    : (unitNames.get(spans[0].unit_id) ?? spans[0].unit_id)}
                </span>
              </td>
              {dates.map((date) => {
                const span = readOn(spans, date)
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
      <p className="px-3 py-2 text-[0.9375rem] text-mute">
        Solid: approved. Outlined: waiting. Red dates: Sundays and public
        holidays. Shaded: closed to leave.
      </p>
    </div>
  )
}
