import { day, dayMonth } from "@/lib/format"
import type { FilterField, FilterState } from "@/lib/filters"

/// A window of days as a field asks it: from and to, as two clauses — `gte`
/// and `lte` — for the fields that ask a question of a range (issued between,
/// due between). The calendar page of a sheet and the toolbar's `DayRange`
/// read and write the same two clauses.
///
/// Values are ISO days, `""` for an open end.
export interface DayWindow {
  readonly from: string
  readonly to: string
}

/// Whether a field is asked as a window of days: a date, answered by a
/// "from" clause and a "to" clause.
export function isDayRange(field: FilterField): boolean {
  const operators = field.spec.operators
  return (
    field.spec.kind === "date" &&
    operators !== undefined &&
    operators.includes("gte") &&
    operators.includes("lte")
  )
}

/// What the clauses on a column say, as a window.
export function dayRangeOf(model: FilterState, column: string): DayWindow {
  const valueOf = (operator: string): string =>
    model.filters.find(
      (one) => one.column === column && one.operator === operator
    )?.values[0] ?? ""
  return { from: valueOf("gte"), to: valueOf("lte") }
}

/// Replace a column's clauses with the window, in ONE write — a range is two
/// clauses, and two writes would each start from the same render's clauses
/// and undo each other.
export function setDayRange(
  model: FilterState,
  column: string,
  next: DayWindow
): void {
  model.set([
    ...model.filters.filter((one) => one.column !== column),
    ...(next.from === ""
      ? []
      : [{ column, operator: "gte" as const, values: [next.from] }]),
    ...(next.to === ""
      ? []
      : [{ column, operator: "lte" as const, values: [next.to] }]),
  ])
}

function short(iso: string, withYear: boolean): string {
  return withYear ? day(iso) : dayMonth(iso)
}

/// A window in a row's own words — "14 Oct – 22 Oct", "From 14 Oct" — the
/// year only when something stated is not this year.
export function sayDays(days: DayWindow): string {
  const thisYear = String(new Date().getFullYear())
  const withYear = [days.from, days.to].some(
    (one) => one !== "" && !one.startsWith(thisYear)
  )
  if (days.from !== "" && days.to !== "")
    return days.from === days.to
      ? short(days.from, withYear)
      : `${short(days.from, withYear)} – ${short(days.to, withYear)}`
  if (days.from !== "") return `From ${short(days.from, withYear)}`
  if (days.to !== "") return `Until ${short(days.to, withYear)}`
  return ""
}
