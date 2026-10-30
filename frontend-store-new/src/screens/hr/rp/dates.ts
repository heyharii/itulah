/// The dates the Schedule and Attendance pages count in, and the colours a
/// shift wears. The hub's `screens/people/rp/kit.tsx`, copied.

// ── dates ───────────────────────────────────────────────────────────────────
// A roster date is a calendar day, never an instant: everything here is done in
// UTC and only ever exchanges `YYYY-MM-DD` with the centre.

export const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const
const MON = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const
export const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const

export function addDays(iso: string, n: number): string {
  const date = new Date(`${iso}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + n)
  return date.toISOString().slice(0, 10)
}
export const dnum = (iso: string) => Number(iso.slice(8, 10))
export const dlabel = (iso: string) =>
  `${dnum(iso)} ${MON[Number(iso.slice(5, 7)) - 1]}`
export const weekLabel = (monday: string) =>
  `${dlabel(monday)} – ${dlabel(addDays(monday, 6))}`
export const weekDays = (monday: string) =>
  Array.from({ length: 7 }, (_, i) => addDays(monday, i))
export const weekdayIndex = (iso: string) =>
  (new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7
export const mondayOfIso = (iso: string) => addDays(iso, -weekdayIndex(iso))
export const monthLabel = (ym: string) =>
  `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`
export const initials = (name: string) =>
  name
    .split(" ")
    .map((word) => word[0])
    .slice(0, 2)
    .join("")
export function todayIso(): string {
  const now = new Date()
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()))
    .toISOString()
    .slice(0, 10)
}

export const fmtH = (hours: number) =>
  `${Number.isInteger(hours) ? hours : hours.toFixed(1)} h`

// ── shift colours ───────────────────────────────────────────────────────────
// A shift has no colour at the centre. It wears one from this ring by its place
// in the list, and a picked colour is kept in this browser.

export const SHIFT_COLORS = [
  "#ee8b2e",
  "#4a82f0",
  "#8a6cf0",
  "#46a06a",
  "#d65b95",
  "#1f9fb4",
  "#b7791f",
] as const

const COLOR_KEY = "rp.shift-colour."
export function savedColour(id: string): string | null {
  try {
    return window.localStorage.getItem(COLOR_KEY + id)
  } catch {
    return null
  }
}
export function saveColour(id: string, colour: string): void {
  try {
    window.localStorage.setItem(COLOR_KEY + id, colour)
  } catch {
    // A colour that is not kept is the ring's own next time.
  }
}
export function colourOf(id: string, index: number): string {
  return savedColour(id) ?? SHIFT_COLORS[index % SHIFT_COLORS.length]
}
