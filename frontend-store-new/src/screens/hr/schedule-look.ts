import { dateText } from "@/lib/format"
import { addDays } from "@/lib/queries/hr"
import { byStart, type Slot } from "@/lib/queries/schedule"
import type { ShiftView } from "@itulah/contract"

/// How the Schedule draws a planned day. Values only — the components that use
/// them are in `schedule-*.tsx`, and a file that exports both a component and a
/// value loses fast refresh.

/// The tints a shift takes, in the order of the day: the prototype's blue,
/// green, orange and violet. The centre's shifts are head office's and carry no
/// colour of their own, so a shift is tinted by where it falls among the
/// catalogue's — the morning is always the first, whatever it is called.
const TINTS = [
  "bg-a-blue/15",
  "bg-a-green/15",
  "bg-a-orange/15",
  "bg-a-violet/15",
] as const

/// The tint of a shift by its id; a plain grey for one the catalogue no longer
/// lists (head office retired it after the day was planned).
export function tintsOf(
  catalogue: readonly ShiftView[],
): (shiftId: string | null) => string {
  const order = [...catalogue].sort(byStart).map((shift) => shift.id)
  return (shiftId) => {
    const index = shiftId === null ? -1 : order.indexOf(shiftId)
    return index === -1 ? "bg-soft-2" : (TINTS[index % TINTS.length] as string)
  }
}

/// A day off, hatched: the prototype's grey stripes, so a rest day reads as
/// "nothing here" rather than as a cell somebody forgot to fill.
export const OFF_HATCH =
  "bg-[repeating-linear-gradient(135deg,var(--soft-3)_0_6px,var(--soft-2)_6px_8px)]"

/// `09:00–17:00`, with `+1` when the shift ends the next day.
export function hoursOf(slot: Slot): string {
  if (slot.starts === null || slot.ends === null) return ""
  return `${slot.starts}–${slot.ends}${slot.crossesMidnight ? " +1" : ""}`
}

/// `09:00–17:00` for a catalogue shift.
export function spanOf(shift: ShiftView): string {
  return `${shift.starts_at}–${shift.ends_at}${shift.crosses_midnight ? " +1" : ""}`
}

/// `Mon 12`, for a row or a column.
export function dayName(date: string): string {
  const parsed = new Date(`${date}T00:00:00`)
  return `${dateText(parsed, { weekday: "short" })} ${date.slice(8)}`
}

/// `06–12 Oct 2026`, `29 Sep – 05 Oct 2026`: the week that starts on `start`.
export function weekRange(start: string): string {
  const first = new Date(`${start}T00:00:00`)
  const last = addDays(first, 6)
  const sameMonth = first.getMonth() === last.getMonth()
  const sameYear = first.getFullYear() === last.getFullYear()
  const from = dateText(first, {
    day: "2-digit",
    ...(sameMonth && sameYear ? {} : { month: "short" }),
    ...(sameYear ? {} : { year: "numeric" }),
  })
  const to = dateText(last, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  })
  return `${from}${sameMonth && sameYear ? "–" : " – "}${to}`
}
