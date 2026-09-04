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
