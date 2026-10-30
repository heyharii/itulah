import { useQueries, useQuery } from "@tanstack/react-query"
import { useMemo } from "react"

import { CardHeader, CardTitle } from "@/components/ui/card"
import { EmptyState, LoadingState } from "@/components/ui/states"
import { monthYear, weekday } from "@/lib/format"
import { monthBounds } from "@/lib/queries/hr-time"
import {
  leaveExtraKeys,
  punchKeys,
  readAttendance,
  readEnrolment,
  rosterKeys,
  teamCalendar,
  unitRoster,
} from "@/lib/queries/people"
import { queryState } from "@/lib/query-state"
import { cn } from "@/lib/utils"
import type {
  AttendanceDayView,
  EmployeeSummary,
  RosterDayView,
  UnderivableDay,
} from "@itulah/contract"

/// The month of one unit as a grid of small squares, one row a person and one
/// square a day, read the way a contribution graph is: by colour, across.
///
/// # Where each square comes from
///
/// Two reads, both of them the screen's own. The **roster**
/// (`GET /roster?unit&from&to`, one request for the unit) says who was planned
/// on which day and which days were rest days or public holidays; each
/// rostered person's **derived attendance** over the month
/// (`GET /employees/{id}/attendance?from&to`, the same read the person sheet
/// makes) says what the day amounted to. There is no month-for-a-unit route,
/// and none was added: it is one request per person who was rostered at all.
///
/// # Six states and no more
///
/// Colour only; the words are in each square's `title` and in the legend.
///
///   - Present: green. Arrived and was not late — on time, left early, agreed
///     overtime — and a day with an arrival and a missing punch.
///   - Late: amber.
///   - Absent: red. A rostered day with no arrival, once the day is over.
///   - Leave: blue-grey. `APPROVED_LEAVE`.
///   - Off: light grey. The roster says rest day or public holiday and nobody
///     worked it.
///   - Nothing: a faint outline. Not rostered, a day that has not come, a day
///     nobody has read yet — and, dashed, a day the server would not classify.
///
/// The last one is deliberately **not** red and not grey. An outline says "no
/// statement was made", which is what an unplanned day, a future day and an
/// underivable day have in common, and which is the thing this page exists not
/// to turn into an absence (see the top of `attendance-days.tsx`).
///
/// Counts at the right are of the squares, so each figure is the number of
/// squares of its colour: a late day is Late and not also Present.

type Mark = "present" | "late" | "absent" | "leave" | "off" | "none"

interface Cell {
  readonly date: string
  readonly mark: Mark
  /// What the square says when it is pointed at, after the date.
  readonly text: string
  /// A day the server declined to classify, drawn dashed.
  readonly broken: boolean
  /// A day that has not come: nothing to open.
  readonly future: boolean
}

const NO_PLAN: readonly RosterDayView[] = []
const NO_PEOPLE: readonly EmployeeSummary[] = []

/// The colours are the hub's state tokens, so the store app can wear the same.
/// Leave is `info-fg`, the blue-grey: `info` itself is the bright action blue
/// and blue is for actions.
const SQUARE: Record<Mark, string> = {
  present: "bg-ok",
  late: "bg-warn",
  absent: "bg-bad",
  leave: "bg-info-fg",
  off: "bg-hairline-2",
  none: "border border-hairline",
}

const LEGEND: readonly { readonly mark: Mark; readonly label: string }[] = [
  { mark: "present", label: "Present" },
  { mark: "late", label: "Late" },
  { mark: "absent", label: "Absent" },
  { mark: "leave", label: "Leave" },
  { mark: "off", label: "Off" },
]

/// The four counts at the right, in the order the legend gives them. They
/// stand stacked in ONE column — swatch, word, figure on four short lines —
/// because four columns of 15px words cost 220px of a row that has to hold 31
/// squares (owner, 2026-10-30).
const TOTALS = [
  { mark: "present", label: "Present" },
  { mark: "late", label: "Late" },
  { mark: "absent", label: "Absent" },
  { mark: "leave", label: "Leave" },
] as const

/// Widths of the two ends of the table. The days share what is left, so a
/// 31-day month at 1440 with the sidebar open (a 1066px card) gets the full
/// 22px square with room to spare, and a phone scrolls the days in their box.
const WHO_WIDTH = 160
const WHO_WIDTH_PHONE = 136
const TOTALS_WIDTH = 120

/// The narrowest a day may get before the box scrolls on its own: a desk
/// would rather shrink a square than scroll; a phone keeps a square a finger
/// can find and scrolls.
const DAY_MIN = 20
const DAY_MIN_PHONE = 26

/// `2026-09-13 08:03` → `08:03`.
function clock(stamp: string | null): string | null {
  if (stamp === null) return null
  const space = stamp.indexOf(" ")
  return space === -1 ? stamp : stamp.slice(space + 1)
}

function dates(month: string, count: number): string[] {
  return Array.from(
    { length: count },
    (_, index) => `${month}-${String(index + 1).padStart(2, "0")}`
  )
}

/// Saturday or Sunday, by the calendar and not by the viewer's zone.
function isWeekend(iso: string): boolean {
  const at = new Date(`${iso}T00:00:00Z`).getUTCDay()
  return at === 0 || at === 6
}

/// What one square is. The order of the checks is the order of what is known
/// best: a day not yet come is nothing whatever the plan, a day the server
/// would not classify is nothing whatever the punches, and only then do the
/// outcomes speak.
function cellOf(input: {
  date: string
  today: string
  plan: RosterDayView | undefined
  day: AttendanceDayView | undefined
  underivable: UnderivableDay | undefined
  read: "loading" | "failed" | "done"
  noFinger: boolean
}): Cell {
  const { date, today, plan, day, underivable, read, noFinger } = input
  const none = (text: string, broken = false): Cell => ({
    date,
    mark: "none",
    text,
    broken,
    future: false,
  })

  if (date > today) {
    const planned =
      plan === undefined
        ? null
        : plan.plan === "SCHEDULED"
          ? plan.shift_name === null
            ? "Rostered"
            : `${plan.shift_name} ${plan.starts_at ?? ""}–${plan.ends_at ?? ""}`
          : plan.plan === "REST_DAY"
            ? "Day off"
            : "Public holiday"
    return {
      ...none(planned === null ? "Not yet" : `Not yet · ${planned}`),
      future: true,
    }
  }
  if (underivable !== undefined)
    return none(`Could not be derived · ${underivable.reason}`, true)
  if (read === "loading") return none("Reading…")
  if (read === "failed") return none("Could not be read")

  if (day !== undefined) {
    const codes = day.outcomes
    const arrival = clock(day.arrival)
    const made = (mark: Mark, text: string): Cell => ({
      date,
      mark,
      text,
      broken: false,
      future: false,
    })
    if (codes.includes("APPROVED_LEAVE")) return made("leave", "Leave")
    if (codes.includes("ABSENT")) {
      // Today is not over: "absent" is a verdict about a finished day, and the
      // day view says "not arrived yet" for the same reason.
      if (date === today && arrival === null) return none("Not arrived yet")
      return made("absent", noFinger ? "Absent · no finger enrolled" : "Absent")
    }
    if (codes.includes("LATE"))
      return made("late", arrival === null ? "Late" : `Late ${arrival}`)
    if (codes.includes("MISSING_PUNCH")) {
      // A question and not a verdict: an arrival is a day worked, no arrival is
      // a day nobody can say anything about.
      return arrival === null
        ? none("Missing punch", true)
        : made("present", `Present ${arrival} · missing punch`)
    }
    if (
      codes.includes("ON_TIME") ||
      codes.includes("EARLY_LEAVE") ||
      codes.includes("AGREED_OVERTIME")
    )
      return made(
        "present",
        arrival === null ? "Present" : `Present ${arrival}`
      )
    // A code this grid has not been taught is said as the server spelled it.
    return none(codes.length === 0 ? "Nothing derived" : codes.join(", "), true)
  }

  if (plan?.plan === "REST_DAY")
    return { date, mark: "off", text: "Day off", broken: false, future: false }
  if (plan?.plan === "PUBLIC_HOLIDAY")
    return {
      date,
      mark: "off",
      text: "Public holiday",
      broken: false,
      future: false,
    }
  if (plan?.plan === "SCHEDULED") return none("Rostered · nothing derived")
  return none("Not rostered")
}

export function AttendanceMonth({
  unitId,
  unitName,
  month,
  today,
  people = NO_PEOPLE,
  phone,
  unsaid,
  onOpen,
}: {
  unitId: string
  unitName: string | null
  /// `YYYY-MM`.
  month: string
  /// The business date, `YYYY-MM-DD`.
  today: string
  /// The unit's active people, for names and positions.
  people?: readonly EmployeeSummary[]
  phone: boolean
  /// The sentence for a unit whose stations cannot be believed (suspended, or
  /// never heard from), or `null` when they can. With it, the grid is drawn
  /// only if some punch is in hand to show.
  unsaid: string | null
  /// A square, or a name (with the last day read), was pressed.
  onOpen: (employeeId: string, date: string) => void
}) {
  const { from: first, to: last } = monthBounds(month)
  const lastRead = last < today ? last : today
  const started = first <= today
  const days = useMemo(() => dates(month, Number(last.slice(8))), [month, last])

  const roster = useQuery({
    queryKey: rosterKeys.unit(unitId, first, last),
    queryFn: ({ signal }) => unitRoster(unitId, first, last, signal),
  })
  /// Public holidays are the company's; only their dates are used, to tint a
  /// column. A failed read just leaves the column untinted.
  const calendar = useQuery({
    queryKey: leaveExtraKeys.calendar(first, last),
    queryFn: ({ signal }) => teamCalendar(first, last, signal),
  })

  /// Everybody rostered on any day of the month, by name. A person with no
  /// roster line has no day that could be absent, so has no row.
  const rows = useMemo(() => {
    const known = new Map(people.map((one) => [one.employee_id, one]))
    const planned = new Map<string, Map<string, RosterDayView>>()
    for (const one of roster.data ?? NO_PLAN) {
      const mine = planned.get(one.employee_id) ?? new Map()
      mine.set(one.on_date, one)
      planned.set(one.employee_id, mine)
    }
    return [...planned.entries()]
      .map(([id, plan]) => {
        const person = known.get(id)
        return {
          id,
          name: person?.full_name ?? person?.employee_code ?? id,
          role: person?.position ?? null,
          plan,
        }
      })
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [roster.data, people])

  const ranges = useQueries({
    queries: rows.map((row) => ({
      queryKey: punchKeys.of(row.id, first, lastRead),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        readAttendance(row.id, first, lastRead, signal),
      enabled: started,
    })),
    combine: (answers) =>
      answers.map((answer) => ({
        data: answer.data,
        read: answer.isError
          ? ("failed" as const)
          : answer.isPending
            ? ("loading" as const)
            : ("done" as const),
      })),
  })

  /// Whose empty rows are not absences: those with no finger on file. Asked
  /// only for people with an absent square, because that is the only place the
  /// answer changes what is said.
  const absentees = rows
    .filter((_, index) =>
      ranges[index]?.data?.days.some((one) => one.outcomes.includes("ABSENT"))
    )
    .map((row) => row.id)
  const fingers = useQueries({
    queries: absentees.map((id) => ({
      queryKey: punchKeys.enrolment(id),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        readEnrolment(id, signal),
    })),
    combine: (answers) =>
      answers.map((answer) => answer.data?.can_clock_in ?? null),
  })
  const noFinger = new Set(
    absentees.filter((_, index) => fingers[index] === false)
  )

  if (roster.isPending || roster.isError)
    return queryState(roster, {
      loading: "Reading the month…",
      render: () => null,
    })

  const settled = !started || ranges.every((range) => range.read !== "loading")
  const evidence = ranges.some((range) =>
    range.data?.days.some((one) => one.punches_considered > 0)
  )
  if (unsaid !== null && !settled)
    return <LoadingState>Reading the month…</LoadingState>
  if (unsaid !== null && !evidence) return <EmptyState>{unsaid}</EmptyState>

  if (rows.length === 0)
    return (
      <EmptyState>
        Nobody was rostered at {unitName ?? "this unit"} in {monthYear(month)}.
      </EmptyState>
    )

  const holidays = new Map(calendar.data?.holidays ?? [])
  for (const row of rows)
    for (const [date, one] of row.plan)
      if (one.plan === "PUBLIC_HOLIDAY" && !holidays.has(date))
        holidays.set(date, "Public holiday")

  const who = phone ? WHO_WIDTH_PHONE : WHO_WIDTH
  const minWidth =
    who + TOTALS_WIDTH + days.length * (phone ? DAY_MIN_PHONE : DAY_MIN)

  const built = rows.map((row, index) => {
    const range = ranges[index]
    const reads = new Map(range?.data?.days.map((one) => [one.date, one]))
    const broken = new Map(
      range?.data?.underivable.map((one) => [one.date, one])
    )
    const cells = days.map((date) =>
      cellOf({
        date,
        today,
        plan: row.plan.get(date),
        day: reads.get(date),
        underivable: broken.get(date),
        read: range?.read ?? "loading",
        noFinger: noFinger.has(row.id),
      })
    )
    const total = (mark: Mark) =>
      cells.filter((cell) => cell.mark === mark).length
    return { row, cells, total, ready: range?.read === "done" }
  })

  return (
    <>
      <CardHeader>
        <CardTitle>{monthYear(month)}</CardTitle>
        <span className="text-meta text-mute">
          {rows.length === 1 ? "1 person" : `${rows.length} people`}
        </span>
      </CardHeader>
      <p className="flex flex-wrap items-center gap-x-5 gap-y-1 px-4 pb-3 text-meta text-mute">
        {LEGEND.map((one) => (
          <span key={one.mark} className="inline-flex items-center gap-1.5">
            <span
              aria-hidden
              className={cn("size-3 rounded-[0.1875rem]", SQUARE[one.mark])}
            />
            {one.label}
          </span>
        ))}
      </p>
      <div className="overflow-x-auto border-t border-hairline">
        <table
          aria-label={`Attendance, ${monthYear(month)}`}
          className="w-full table-fixed border-separate border-spacing-0 text-cell"
          style={{ minWidth }}
        >
          <colgroup>
            <col style={{ width: who }} />
            {days.map((date) => (
              <col key={date} />
            ))}
            <col style={{ width: TOTALS_WIDTH }} />
          </colgroup>
          <thead>
            <tr>
              <th className="sticky left-0 z-[2] border-r border-hairline bg-canvas px-3 py-2 text-left text-meta font-medium text-mute">
                Who
              </th>
              {days.map((date) => {
                const holiday = holidays.get(date)
                return (
                  <th
                    key={date}
                    title={
                      holiday === undefined
                        ? weekday(date)
                        : `${weekday(date)} · ${holiday}`
                    }
                    className={cn(
                      "px-0 py-2 text-center text-meta font-medium tabular-nums",
                      isWeekend(date) || holiday !== undefined
                        ? "bg-soft-2"
                        : "bg-canvas",
                      holiday !== undefined
                        ? "text-bad-fg"
                        : date === today
                          ? "font-semibold text-ink"
                          : "text-mute"
                    )}
                  >
                    {Number(date.slice(8))}
                  </th>
                )
              })}
              <th className="border-l border-hairline px-3 py-2 text-left text-meta font-medium text-mute">
                Days
              </th>
            </tr>
          </thead>
          <tbody>
            {built.map(({ row, cells, total, ready }) => (
              <tr key={row.id}>
                <td className="border-row-line sticky left-0 z-[1] border-t border-r bg-canvas px-3 py-1 text-left">
                  <button
                    type="button"
                    onClick={() => onOpen(row.id, lastRead)}
                    className="block w-full text-left outline-none focus-visible:underline"
                  >
                    <span className="block truncate text-cell text-ink">
                      {row.name}
                    </span>
                    <span className="block truncate text-cell text-mute">
                      {row.role ?? "—"}
                    </span>
                  </button>
                </td>
                {cells.map((cell) => {
                  const tip = `${weekday(cell.date)} · ${cell.text}`
                  const square = cn(
                    "mx-auto block aspect-square w-full max-w-[1.375rem] rounded-[0.25rem]",
                    SQUARE[cell.mark],
                    cell.broken && "border-dashed border-hairline-2"
                  )
                  return (
                    <td
                      key={cell.date}
                      className={cn(
                        "border-row-line border-t px-[1.5px] py-1 align-middle",
                        (isWeekend(cell.date) || holidays.has(cell.date)) &&
                          "bg-soft-3"
                      )}
                    >
                      {cell.future ? (
                        <span title={tip} className={square} />
                      ) : (
                        <button
                          type="button"
                          title={tip}
                          aria-label={`${row.name}, ${tip}`}
                          onClick={() => onOpen(row.id, cell.date)}
                          className={cn(
                            square,
                            "outline-none hover:ring-2 hover:ring-hairline-strong focus-visible:ring-2 focus-visible:ring-accent"
                          )}
                        />
                      )}
                    </td>
                  )
                })}
                <td className="border-row-line border-t border-l px-3 py-1 align-middle">
                  <div className="flex flex-col text-cell leading-[1.125rem]">
                    {TOTALS.map((one) => {
                      const figure = ready ? total(one.mark) : null
                      return (
                        <div
                          key={one.mark}
                          className="flex items-center gap-1.5"
                        >
                          <span
                            aria-hidden
                            className={cn(
                              "size-3 shrink-0 rounded-[0.1875rem]",
                              SQUARE[one.mark]
                            )}
                          />
                          <span className="text-mute">{one.label}</span>
                          <span
                            className={cn(
                              "ml-auto tabular-nums",
                              figure === null || figure === 0
                                ? "text-faint"
                                : "text-ink"
                            )}
                          >
                            {figure ?? "—"}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
