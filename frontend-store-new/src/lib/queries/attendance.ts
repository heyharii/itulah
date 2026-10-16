import { useQueries, useQuery } from "@tanstack/react-query"
import { useEffect, useState } from "react"

import {
  addDays,
  attendanceToday,
  attendanceTodayQuery,
  hrKeys,
  isoDay,
  rosterAt,
  rosterQuery,
  type StoreScope,
} from "@/lib/queries/hr"
import type {
  AttendanceDayView,
  PunchRow,
  RosterDayView,
  TodayView,
  UnderivableDay,
} from "@itulah/contract"

/// What the Attendance screen reads, and what it makes of it.
///
/// # A day is read once for everybody
///
/// `GET /api/v1/attendance/today?unit&date` answers for any date, not only
/// today: every person rostered that day, derived, with the raw punches
/// beside. A week is therefore seven of those (and one rota read for the
/// shifts), not a request per person — and it shares its cache key with the
/// Day view, so stepping from a day to its week costs six reads, not seven.
///
/// # What a status needs that the centre does not say
///
/// The centre derives an outcome from the rota and the punches, and has no
/// clock: a shift that has not started reads `ABSENT` exactly as one that
/// ended with nobody there. So the status is made HERE, from the derived day
/// AND the shift's own hours AND the time now — "Not in yet" before the shift
/// ends, "Absent" after. Absence is only ever said of a finished day.

/// Seconds between re-reads of a day that is still happening.
const LIVE_MS = 30_000

/// The shapes of a status, in the order they are checked.
export type StandingKind =
  | "unplanned"
  | "off"
  | "holiday"
  | "leave"
  | "later"
  | "unassessed"
  | "waiting"
  | "overdue"
  | "working"
  | "no-checkout"
  | "missing"
  | "on-time"
  | "late"
  | "left-early"
  | "absent"

export type StandingTone = "ok" | "warn" | "bad" | "info" | "neutral"

/// One person's day in a word.
export interface Standing {
  readonly kind: StandingKind
  readonly label: string
  readonly tone: StandingTone
  /// What else is true of the day, said under the word ("Left 20 min early").
  readonly note: string | null
}

function standing(
  kind: StandingKind,
  label: string,
  tone: StandingTone,
  note: string | null = null,
): Standing {
  return { kind, label, tone, note }
}

/// A clock time on a date, in this device's own timezone — the shop's.
function atClock(date: string, clock: string, nextDay = false): Date {
  const [hours, minutes] = clock.split(":").map(Number)
  const moment = new Date(`${date}T00:00:00`)
  if (nextDay) moment.setDate(moment.getDate() + 1)
  moment.setHours(hours ?? 0, minutes ?? 0, 0, 0)
  return moment
}

/// What a person's day amounts to, now.
///
/// **When no punch source has ever reported for this shop, nobody is absent**
/// — there was nothing that could have seen them, and a red word would be a
/// claim that somebody looked. A person who has a check-in is shown it either
/// way.
export function standingOf(input: {
  date: string
  rota: RosterDayView | null
  day: AttendanceDayView | null
  /// The centre could not derive this day (its inputs disagree).
  refused: boolean
  connected: boolean
  now: Date
}): Standing {
  const { date, rota, day, refused, connected, now } = input
  const plan = day?.plan ?? rota?.plan ?? null
  const outcomes = day?.outcomes ?? []

  if (plan === null) return standing("unplanned", "Not rostered", "neutral")
  if (plan === "REST_DAY") return standing("off", "Day off", "neutral")
  if (plan === "PUBLIC_HOLIDAY") {
    return standing("holiday", "Public holiday", "neutral")
  }
  if (outcomes.includes("APPROVED_LEAVE")) {
    return standing("leave", "On leave", "info")
  }

  const today = isoDay(now)
  if (date > today) return standing("later", "Later", "neutral")

  const start = rota?.starts_at == null ? null : atClock(date, rota.starts_at)
  const end =
    rota?.ends_at == null
      ? null
      : atClock(date, rota.ends_at, rota.crosses_midnight)
  const over = date < today || (end !== null && now.getTime() >= end.getTime())
  const started =
    date < today || (start !== null && now.getTime() >= start.getTime())

  const arrival = day?.arrival ?? null
  const departure = day?.departure ?? null
  const late = outcomes.includes("LATE") ? (day?.late_minutes ?? 0) : 0
  const early = outcomes.includes("EARLY_LEAVE")
    ? (day?.early_leave_minutes ?? 0)
    : 0

  if (arrival !== null) {
    const lateNote = late > 0 ? `Late ${late} min` : null
    if (departure === null) {
      return over
        ? standing("no-checkout", "No check-out", "warn", lateNote)
        : standing("working", "Working", "info", lateNote)
    }
    if (late > 0) {
      return standing(
        "late",
        `Late ${late} min`,
        "warn",
        early > 0 ? `Left ${early} min early` : null,
      )
    }
    if (early > 0) {
      return standing("left-early", `Left ${early} min early`, "warn")
    }
    return standing("on-time", "On time", "ok")
  }

  if (outcomes.includes("MISSING_PUNCH")) {
    return standing("missing", "Missing punch", "neutral")
  }
  if (refused || !connected) {
    return standing("unassessed", "Not assessed", "neutral")
  }
  if (over) return standing("absent", "Absent", "bad")
  return started
    ? standing("overdue", "Not in yet", "warn")
    : standing("waiting", "Not in yet", "neutral")
}

// ── one person, one day ─────────────────────────────────────────────────────

/// A person's day: what was planned, what the centre derived, what that
/// amounts to, and the readings behind it.
export interface DayRow {
  readonly employeeId: string
  readonly date: string
  readonly rota: RosterDayView | null
  readonly day: AttendanceDayView | null
  readonly standing: Standing
  /// The raw readings, for the sheet that answers "what did the device see?".
  readonly punches: readonly PunchRow[]
}

/// A day's rows for everybody who is on the books or on the rota or punched.
export function dayRows(input: {
  date: string
  rota: readonly RosterDayView[]
  view: TodayView | undefined
  active: readonly string[]
  now: Date
}): DayRow[] {
  const { date, rota, view, now } = input
  const days = view?.days ?? []
  const derived = new Map(days.map((day) => [day.employee_id, day]))
  const refused = new Set(
    (view?.underivable ?? []).map((one: UnderivableDay) => one.employee_id),
  )
  const planned = new Map(rota.map((row) => [row.employee_id, row]))
  const connected = view?.punch_source_connected === true
  const ids = [
    ...new Set([
      ...input.active,
      ...rota.map((row) => row.employee_id),
      ...days.map((day) => day.employee_id),
    ]),
  ]
  const order = new Map(ids.map((id, index) => [id, index]))

  const rows = ids.map((employeeId): DayRow => {
    const plan = planned.get(employeeId) ?? null
    const day = derived.get(employeeId) ?? null
    return {
      employeeId,
      date,
      rota: plan,
      day,
      standing: standingOf({
        date,
        rota: plan,
        day,
        refused: refused.has(employeeId),
        connected,
        now,
      }),
      punches: (view?.punches ?? []).filter(
        (punch) => punch.employee_id === employeeId,
      ),
    }
  })

  // Those who work the day first, in the order the shifts start; those who do
  // not (off, a holiday, not rostered) after them.
  const works = (row: DayRow) =>
    (row.day?.plan ?? row.rota?.plan) === "SCHEDULED" ? 0 : 1
  return rows.sort(
    (left, right) =>
      works(left) - works(right) ||
      (left.rota?.starts_at ?? "99:99").localeCompare(
        right.rota?.starts_at ?? "99:99",
      ) ||
      (order.get(left.employeeId) ?? 0) - (order.get(right.employeeId) ?? 0),
  )
}

/// How many people did what — the strip over the day.
export function tallyDay(rows: readonly DayRow[]) {
  const scheduled = rows.filter(
    (row) => (row.day?.plan ?? row.rota?.plan) === "SCHEDULED",
  )
  const count = (kind: StandingKind) =>
    rows.filter((row) => row.standing.kind === kind).length
  return {
    scheduled: scheduled.length,
    arrived: rows.filter((row) => row.day?.arrival != null).length,
    working: count("working"),
    late: rows.filter((row) => row.day?.outcomes.includes("LATE") === true)
      .length,
    absent: count("absent"),
  }
}

// ── reading ─────────────────────────────────────────────────────────────────

/// The time now, for a screen that says "not in yet" and "working": it ticks
/// while the day it shows is still happening, and otherwise stands still.
export function useNow(live: boolean): Date {
  const [, tick] = useState(0)
  useEffect(() => {
    if (!live) return
    const id = setInterval(() => tick((count) => count + 1), LIVE_MS)
    return () => clearInterval(id)
  }, [live])
  return new Date()
}

/// One day at this shop: the rota and what the centre derived from it.
///
/// A day that is still happening is read again every half minute — a person
/// checking in is the point of the screen.
export function useDay(scope: StoreScope, date: string) {
  const live = date === isoDay(new Date())
  const rota = useQuery({
    ...rosterQuery(scope.unit_id, date, date),
    refetchInterval: live ? LIVE_MS * 2 : false,
  })
  const derived = useQuery({
    ...attendanceTodayQuery(scope.unit_id, date),
    refetchInterval: live ? LIVE_MS : false,
  })
  return { rota, derived, live }
}

/// A week at this shop: the rota once, and the centre's derivation of each
/// day that has begun.
///
/// A day after today is not asked for — it has no attendance, and asking would
/// only fill the sheet with blanks.
export function useWeek(scope: StoreScope, days: readonly string[]) {
  const today = isoDay(new Date())
  const first = days[0] as string
  const last = days[days.length - 1] as string
  const rota = useQuery({
    queryKey: hrKeys.roster(scope.unit_id, first, last),
    queryFn: ({ signal }) => rosterAt(scope.unit_id, first, last, signal),
  })
  const reads = useQueries({
    queries: days.map((date) => ({
      queryKey: hrKeys.attendanceToday(scope.unit_id, date),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        attendanceToday(scope.unit_id, date, signal),
      enabled: date <= today,
      refetchInterval: date === today ? LIVE_MS : (false as const),
    })),
  })
  return { rota, reads, today }
}

/// `n` days from `date`, as a date string.
export function shiftDate(date: string, by: number): string {
  return isoDay(addDays(new Date(`${date}T00:00:00`), by))
}

// ── the period being looked at ──────────────────────────────────────────────

/// The span the screen is showing: a day, the week it is in, or its month.
export type Span = "day" | "week" | "month"

/// The Monday on or before `date`.
export function mondayOfDate(date: string): string {
  const parsed = new Date(`${date}T00:00:00`)
  return isoDay(addDays(parsed, -((parsed.getDay() + 6) % 7)))
}

/// Where a step of one span lands: the next or the previous day, the same
/// weekday a week away, or the first of the next month.
export function stepDate(span: Span, date: string, by: 1 | -1): string {
  if (span === "day") return shiftDate(date, by)
  if (span === "week") return shiftDate(date, 7 * by)
  const first = new Date(`${date.slice(0, 7)}-01T00:00:00`)
  first.setMonth(first.getMonth() + by)
  return isoDay(first)
}

/// Whether a step forward would still land on something that has begun. A
/// future day, week or month has no attendance to read.
export function canStepOn(span: Span, date: string, today: string): boolean {
  const next = stepDate(span, date, 1)
  if (span === "day") return next <= today
  if (span === "week") return mondayOfDate(next) <= today
  return next.slice(0, 7) <= today.slice(0, 7)
}

/// The date that names the span a date is in — the day itself, the Monday of
/// its week, the first of its month. What the phone's pickers hold.
export function spanStart(span: Span, date: string): string {
  if (span === "day") return date
  if (span === "week") return mondayOfDate(date)
  return `${date.slice(0, 7)}-01`
}

/// The spans a phone can choose from, newest first: the last fortnight, eight
/// weeks, six months.
export function recentSpans(span: Span, today: string): string[] {
  if (span === "day") {
    return Array.from({ length: 14 }, (_, index) => shiftDate(today, -index))
  }
  if (span === "week") {
    const monday = mondayOfDate(today)
    return Array.from({ length: 8 }, (_, index) =>
      shiftDate(monday, -7 * index),
    )
  }
  const month = `${today.slice(0, 7)}-01`
  return Array.from({ length: 6 }, (_, index) => {
    const first = new Date(`${month}T00:00:00`)
    first.setMonth(first.getMonth() - index)
    return isoDay(first)
  })
}
