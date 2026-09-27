import type { LegalForm, SetupStore, Timezone } from "@/lib/queries/setup"

/// The small facts the setup screens share: how a company is written, what a
/// store's code will be, and which clock a city keeps.

export const LEGAL_FORMS: readonly { value: LegalForm; label: string }[] = [
  { value: "PT", label: "PT" },
  { value: "CV", label: "CV" },
  { value: "UD", label: "UD" },
  { value: "PERORANGAN", label: "Sole trader" },
]

/// "Sepatu Sejahtera, CV" — the legal form after the name, the way the
/// supplier list already writes it. A sole trader has no form to append.
export function companyName(name: string, form: LegalForm): string {
  const trimmed = name.trim()
  return form === "PERORANGAN" || trimmed === ""
    ? trimmed
    : `${trimmed}, ${form}`
}

/// Two letters for the mark beside the company's name.
export function initials(name: string): string {
  const letters = name
    .trim()
    .split(/\s+/)
    .filter((word) => word !== "")
    .map((word) => word[0])
    .join("")
  return letters.slice(0, 2).toUpperCase() || "?"
}

/// The codes the next `count` stores will get, after the ones that exist.
///
/// A preview only: the server gives each new store the next number in the
/// client's `C001` series — its unit's code (`unit.code`) — in the same
/// order, and its answer replaces these. Read from the highest number in the
/// series rather than the count, so a store that was closed does not have
/// its code handed out again; a code outside the series (`TGL`) is not a
/// number to follow, here or on the server.
export function nextCodes(
  existing: readonly SetupStore[],
  count: number
): string[] {
  const highest = existing.reduce((top, store) => {
    const series = /^C(\d{1,9})$/.exec(store.unit_code)
    return series ? Math.max(top, Number(series[1])) : top
  }, 0)
  return Array.from(
    { length: count },
    (_, index) => `C${String(highest + index + 1).padStart(3, "0")}`
  )
}

// Word-bounded: "Purbalingga" contains "bali" and keeps Western time.
const WITA =
  /\b(bali|denpasar|badung|gianyar|tabanan|makassar|manado|balikpapan|samarinda|banjarmasin|mataram|lombok|kupang|palu|kendari|gorontalo|bontang|tarakan)\b/i
const WIT =
  /\b(jayapura|ambon|sorong|merauke|ternate|manokwari|timika|biak|tual|fakfak)\b/i

/// The clock a city most likely keeps — shown beside the city as it is typed,
/// so the guess can be seen and corrected on the store later. The server
/// decides the stored value; this is the same guess made early.
export function timezoneOf(city: string): Timezone {
  if (WIT.test(city)) return "WIT"
  if (WITA.test(city)) return "WITA"
  return "WIB"
}
