import { dateText } from "@/lib/format"
import { units } from "@itulah/contract/money"

/// The words and classes the Money declaration screens share.

/// The rubber stamp procurement presses on a finished order
/// (`frontend-hub/src/screens/procurement/shared.ts`, `STAMP`): a double rule,
/// a little crooked, bold capitals, printed over whatever is under it.
export const STAMP =
  "pointer-events-none inline-block -rotate-12 rounded-[6px] border-[3px] border-double border-current px-2.5 py-0.5 text-center text-[0.9375rem] leading-5 font-bold tracking-[0.06em] whitespace-nowrap uppercase opacity-85 mix-blend-multiply lg:-rotate-6"

/// A day as a row names it: "Thu 29 Oct".
export function rowDay(iso: string): string {
  const at = new Date(`${iso}T00:00:00`)
  return `${dateText(at, { weekday: "short" })} ${dateText(at, { day: "2-digit", month: "short" })}`
}

/// The day inside a stamp, as on a date stamp: "28 OCT".
export function stampOf(iso: string): string {
  return dateText(new Date(`${iso}T00:00:00`), {
    day: "2-digit",
    month: "short",
  }).toUpperCase()
}

/// "12 slips", "1 slip".
export const slips = (n: number): string =>
  `${units(n)} ${n === 1 ? "Slip" : "Slips"}`

/// A bordered table in a sheet: hairline box, tinted head, hairline rows.
export const BOX = "overflow-x-auto rounded-card border border-hairline"
export const TH =
  "h-10 border-b border-hairline bg-soft px-3 text-left text-meta font-medium whitespace-nowrap text-body"
export const TD =
  "h-12 border-b border-hairline px-3 text-cell whitespace-nowrap text-text tabular-nums"
