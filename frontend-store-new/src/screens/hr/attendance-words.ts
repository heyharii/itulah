import { clockOf, planWord } from "@/lib/queries/hr"
import type { DayRow, StandingKind } from "@/lib/queries/attendance"

/// The words the Attendance screens share. Values only — the components are in
/// `attendance-*.tsx`.

/// Where a reading came from, said plainly. A reader witnessed it; a phone tap
/// was witnessed by nothing — and a screen that did not say which would be
/// presenting a person's own claim as a measurement.
export function sourceWord(sources: readonly string[]): string {
  if (sources.length === 0) return "—"
  return sources
    .map((source) =>
      source === "TERMINAL"
        ? "Reader"
        : source === "EMPLOYEE_APP"
          ? "App"
          : source,
    )
    .join(" + ")
}

/// Whether the only thing that saw this person was their own phone.
export function unwitnessed(sources: readonly string[]): boolean {
  return sources.length > 0 && !sources.includes("TERMINAL")
}

/// A rostered day in a line: `Morning 09:00–17:00`, or what the day is.
export function shiftWord(
  plan: {
    plan: string
    shift_name: string | null
    starts_at: string | null
    ends_at: string | null
  } | null,
): string {
  if (plan === null) return "Not rostered"
  return plan.plan === "SCHEDULED"
    ? `${plan.shift_name ?? "Shift"} ${plan.starts_at ?? ""}–${plan.ends_at ?? ""}`
    : planWord(plan.plan)
}

/// The time a person checked in, and the time they are due when they have not.
export function inWord(row: DayRow): string {
  return clockOf(row.day?.arrival ?? null)
}

export function outWord(row: DayRow): string {
  return clockOf(row.day?.departure ?? null)
}

/// How a day tints a cell of the week's sheet: settled and fine, wants a look,
/// wrong, or nothing to say.
export type CellTone = "ok" | "warn" | "bad" | "nil"

export function cellTone(kind: StandingKind): CellTone {
  switch (kind) {
    case "on-time":
    case "working":
      return "ok"
    case "late":
    case "left-early":
    case "overdue":
    case "no-checkout":
    case "missing":
      return "warn"
    case "absent":
      return "bad"
    default:
      return "nil"
  }
}

/// What a cell of the week's sheet says when there is no pair of times.
export function cellWord(kind: StandingKind): string {
  switch (kind) {
    case "off":
      return "Off"
    case "holiday":
      return "Holiday"
    case "leave":
      return "Leave"
    case "absent":
      return "Absent"
    case "waiting":
    case "overdue":
      return "Not in"
    case "missing":
      return "Missing"
    case "unplanned":
      return "—"
    default:
      return "·"
  }
}
