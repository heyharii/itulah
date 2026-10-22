import { useQuery } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { useMemo } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { AppLink } from "@/components/ui/app-link"
import { Card } from "@/components/ui/card"
import { PageHeader } from "@/components/ui/page-header"
import { MiniCell, MiniRow, MiniTable, SubHead } from "@/components/ui/rows"
import { EmptyState } from "@/components/ui/states"
import { dateRange, day, weekday } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import { monthBounds, useActiveEmployees } from "@/lib/queries/hr-time"
import {
  holidayWork,
  leaveExtraKeys,
  rosterKeys,
  teamCalendar,
  unitRoster,
} from "@/lib/queries/people"
import { queryState } from "@/lib/query-state"
import { cn } from "@/lib/utils"
import {
  HrScope,
  useHrMonth,
  useUnit,
  useUnitFilter,
} from "@/screens/people/parts"
import {
  CardButton,
  CardFigure,
  CardName,
  PhoneCards,
} from "@/components/ui/phone-cards"
import type {
  RosterDayView,
  TeamCalendarView,
  TeamLeaveSpan,
} from "@itulah/contract"

/// Schedules › Calendar: the month as planned — who works which shift, who is
/// away, and the public holidays — each drawn its own way so the three never
/// read as one another: a shift is its start hour, leave a bar (solid once
/// approved, outlined while it waits), a public holiday the word "PH" down its
/// column. The dates closed to leave are shaded.
///
/// Shifts are one unit's plan, so they are drawn while the calendar is one
/// unit's — the unit chosen, or a manager's own. Across every unit it is who
/// is away. The Roster's week reads the same team calendar, so a day of leave
/// reads the same on both.
export function TeamCalendar() {
  const phone = useLayout() === "phone"
  const [month, setMonth] = useHrMonth()
  const place = useUnitFilter()
  const own = useUnit()
  const planUnit =
    place.unitId ?? (place.units.length === 0 ? own.unitId : null)
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
  const roster = useQuery({
    queryKey: rosterKeys.unit(planUnit ?? "", first, last),
    queryFn: ({ signal }) => unitRoster(planUnit ?? "", first, last, signal),
    enabled: planUnit !== null,
  })
  const { people, nameOf } = useActiveEmployees()
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
      <PageHeader title="Calendar" />
      <HrScope unit={place} month={[month, setMonth]} />
      <Card className="mb-4 overflow-hidden max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
        {queryState(calendar, {
          loading: "Reading the month…",
          render: (all) => {
            const view = inUnit(all, place.unitId)
            return phone ? (
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
                plan={planUnit === null ? undefined : (roster.data ?? [])}
                nameOf={nameOf}
              />
            )
          },
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

/// The month narrowed to one unit, when one is chosen: its leave, and the
/// dates closed to leave for it or for everyone. Holidays are the company's.
function inUnit(view: TeamCalendarView, unitId: string | null) {
  if (unitId === null) return view
  return {
    ...view,
    leave: view.leave.filter((span) => span.unit_id === unitId),
    blocked: view.blocked.filter(
      (block) => block.unit_id === null || block.unit_id === unitId
    ),
  }
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
  plan,
  nameOf,
}: {
  view: TeamCalendarView
  month: string
  days: number
  unitNames: ReadonlyMap<string, string>
  /// The unit's roster for the month, when the calendar is one unit's.
  plan: readonly RosterDayView[] | undefined
  nameOf: (employeeId: string) => string
}) {
  const dates = Array.from(
    { length: days },
    (_, index) => `${month}-${String(index + 1).padStart(2, "0")}`
  )
  const holidays = new Map(view.holidays.map(([date, name]) => [date, name]))
  const blocked = (date: string) =>
    view.blocked.find((b) => b.from_date <= date && b.to_date >= date)
  /// Everybody with a day to draw: away on one, or planned on one.
  const people = new Map<
    string,
    {
      name: string
      unit: string
      spans: TeamLeaveSpan[]
      days: Map<string, RosterDayView>
    }
  >()
  const person = (employeeId: string, unitId: string, name?: string) => {
    const known = people.get(employeeId)
    if (known !== undefined) return known
    const fresh = {
      name: name ?? nameOf(employeeId),
      unit: unitNames.get(unitId) ?? unitId,
      spans: [],
      days: new Map(),
    }
    people.set(employeeId, fresh)
    return fresh
  }
  for (const span of view.leave)
    person(
      span.employee_id,
      span.unit_id,
      span.full_name ?? span.employee_code
    ).spans.push(span)
  for (const one of plan ?? [])
    person(one.employee_id, one.unit_id).days.set(one.on_date, one)
  const rows = [...people.entries()].sort(([, a], [, b]) =>
    a.name.localeCompare(b.name)
  )

  if (rows.length === 0 && holidays.size === 0 && view.blocked.length === 0) {
    return (
      <EmptyState>
        {plan === undefined
          ? "Nobody is away this month."
          : "Nothing is planned this month."}
      </EmptyState>
    )
  }

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full min-w-max border-collapse text-[0.9375rem]">
          <thead>
            <tr>
              <th className="sticky left-0 min-w-44 bg-canvas px-3 py-2 text-left font-medium text-mute">
                Who
              </th>
              {dates.map((date) => (
                <th
                  key={date}
                  title={
                    holidays.get(date) ?? blocked(date)?.reason ?? undefined
                  }
                  className={cn(
                    "min-w-9 px-0.5 py-2 text-center font-medium tabular-nums",
                    holidays.has(date) ? "text-bad-fg" : "text-mute",
                    blocked(date) !== undefined && "bg-warn-bg"
                  )}
                >
                  {Number(date.slice(8))}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(([employee, row]) => (
              <tr key={employee} className="border-t border-hairline">
                <td className="sticky left-0 bg-canvas px-3 py-1.5">
                  <AppLink
                    to="/people"
                    sheet={{ key: "employee", value: employee }}
                    className="text-ink hover:underline"
                  >
                    {row.name}
                  </AppLink>
                  <span className="block text-mute">{row.unit}</span>
                </td>
                {dates.map((date) => (
                  <td
                    key={date}
                    className={cn(
                      "min-w-9 px-0.5 py-1.5 text-center tabular-nums",
                      blocked(date) !== undefined && "bg-warn-bg"
                    )}
                  >
                    <DayMark
                      span={readOn(row.spans, date)}
                      planned={row.days.get(date)}
                      holiday={holidays.get(date)}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="flex flex-wrap items-center gap-x-5 gap-y-1 px-3 py-2 text-[0.9375rem] text-mute">
        {plan !== undefined && (
          <>
            <span>
              <span className="text-ink tabular-nums">08</span> Shift starts
            </span>
            <span>
              <span className="text-ink">Off</span> Rest day
            </span>
          </>
        )}
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-3 w-5 rounded-inner bg-accent" />
          Leave
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-3 w-5 rounded-inner border border-accent" />
          Leave, waiting
        </span>
        <span>
          <span className="text-bad-fg">PH</span> Public holiday
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-3 w-5 rounded-inner bg-warn-bg" />
          Closed to leave
        </span>
      </p>
    </>
  )
}

/// One person's day in the grid. Leave wins — an approved day off a planned
/// shift is a day away — then the plan, then the holiday the day falls on.
function DayMark({
  span,
  planned,
  holiday,
}: {
  span: TeamLeaveSpan | undefined
  planned: RosterDayView | undefined
  holiday: string | undefined
}) {
  if (span !== undefined)
    return (
      <span
        title={`${span.leave_name} · ${span.state === "APPROVED" ? "approved" : "waiting"}`}
        className={cn(
          "block h-5 rounded-inner",
          span.state === "APPROVED"
            ? "bg-accent"
            : "border border-accent bg-transparent"
        )}
      />
    )
  if (planned?.plan === "SCHEDULED" && planned.starts_at !== null)
    return (
      <span
        title={`${planned.shift_name ?? "Shift"} · ${planned.starts_at}–${planned.ends_at ?? ""}`}
        className="text-ink"
      >
        {planned.starts_at.slice(0, 2)}
      </span>
    )
  if (planned?.plan === "REST_DAY")
    return <span className="text-mute">Off</span>
  if (planned?.plan === "PUBLIC_HOLIDAY" || holiday !== undefined)
    return (
      <span title={holiday} className="text-bad-fg">
        PH
      </span>
    )
  return null
}
