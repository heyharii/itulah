/// Leave, counted in hundredths of a day.
///
/// The server counts in centidays for the same reason it counts money in the
/// smallest unit: `0.1 + 0.2 !== 0.3`, and a balance off by 2⁻⁵² fails an
/// equality check nobody can explain — worse, it fails it only sometimes. A
/// half day is 50 on the wire, and this is the only place it is divided.
export function readDays(centidays: number): string {
  const whole = Math.trunc(centidays / 100)
  const fraction = Math.abs(centidays % 100)
  if (fraction === 0) {
    return `${whole} ${Math.abs(whole) === 1 ? "day" : "days"}`
  }
  return `${whole}.${String(fraction).padStart(2, "0")} days`
}

/// Minutes as a person would say them.
///
/// Overtime is counted in whole minutes because a fractional hour cannot
/// round-trip, so two systems reading the same order would disagree about it.
/// A phone reads "2h", not "120".
export function readMinutes(minutes: number): string {
  if (minutes === 0) return "none"
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours === 0) return `${rest}m`
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`
}

/// What produced a day's readings, said out loud.
///
/// There are two punch sources and they are **not the same evidence**. A
/// fingerprint station at the unit witnessed an arrival; this app witnessed
/// nothing — somebody pressed a button on their own phone. The owner's decision
/// is still readers everywhere, and none has been bought yet, so for now most
/// days will read as the second.
///
/// Which is exactly why the screen says so rather than showing a time and
/// leaving it at that. "08:32" with no provenance presents a person's own claim
/// as a measurement, and the day the readers arrive somebody will need to know
/// which of their months were which. Both can be true of one day: a reader that
/// failed after lunch leaves a morning reading and an afternoon tap.
export function punchSource(sources: readonly string[]): string {
  const reader = sources.includes("TERMINAL")
  const app = sources.includes("EMPLOYEE_APP")
  if (reader && app) {
    return "Fingerprint reader and this app"
  }
  if (reader) {
    return "Fingerprint reader"
  }
  if (app) {
    return "Recorded by you, on this app"
  }
  return "Nothing recorded"
}

/// A day's outcomes, minus the ones that are not true yet.
///
/// The server derives today like any other day, so a shift still in progress
/// reads as a missing clock-out — and before it starts, as absent. Neither is
/// a finding until the day is over.
export function settledOutcomes(
  day: { date: string; departure: string | null; outcomes: readonly string[] },
  today: string
): readonly string[] {
  if (day.date !== today || day.departure !== null) {
    return day.outcomes
  }
  return day.outcomes.filter(
    (outcome) => outcome !== "MISSING_PUNCH" && outcome !== "ABSENT"
  )
}
