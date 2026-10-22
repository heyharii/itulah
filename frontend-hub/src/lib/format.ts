/// Formatting, in one place.
///
/// Money arrives from the server in minor units as an integer, and it stays
/// that way until the moment it is drawn: a float rupiah is a rounding error
/// waiting for a total to disagree with a ledger.
///
/// THE KIT — one function per need. A screen that needs a date, an amount, a
/// share or a count calls one of these; it does not reach for
/// `toLocaleDateString`, `Intl.DateTimeFormat` or a template string of its own
/// (ESLint refuses the ones that do — `no-restricted-properties`).
///
///   nothing to show ........ EMPTY                           —
///
///   a date ................. day(x)                          06 Oct 2026
///   a date and the time .... dayTime(x)                      06 Oct 2026, 14:28
///   a date without a year .. dayMonth(x)                     06 Oct
///   a weekday .............. weekday(x) · weekday(x, true)   Tue 06 Oct · Tue 06 Oct 2026
///   a month ................ monthYear(x)                    Oct 2026
///   two dates .............. dateRange(a, b)                 28 Sep – 04 Oct 2026
///   the time of day ........ time(x) · clock(x)              14:28 · 06 Oct, 14:28 when not today
///   an age ................. ago(x)                          3d ago
///
///   an amount .............. money(n)                        Rp 1.234.000 · −Rp 1.000 · Rp 0
///   an amount, tight ....... moneyCompact(n)                 Rp 4,0 B · Rp 250 K
///   a share ................ percent(n) · percentOf(a, b)    0,25% · 74%
///   a plain number ......... count(n) · decimal(n, digits)    21.060 · 12,5
///   a signed difference .... signed(n)                       +16 · −16 · 0
///   a quantity ............. quantity(n, unit)               223 pcs · 1 pc · 8 items · 2 cartons
///   a SKU .................. sku(code)                       00000004·103
///
/// Dates are English, day first, zero-padded, with the year — the owner's rule
/// ("dates with year") — and take whatever the wire gives: an ISO string, a
/// date-only `2026-10-06`, a `Date`, or a millisecond count. Anything that does
/// not parse is `EMPTY`, never "Invalid Date" or "NaN".

import { EMPTY } from "@/lib/words"

/// A real minus sign, not a hyphen: it is set beside tabular figures and a
/// hyphen is half the width and reads as a dash in a column of numbers.
const MINUS = "−"
const NBSP = " "

const rupiah = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
})

/// `text` is the formatted magnitude. A figure that rounded to nothing —
/// "−0", "−Rp 0" — is not negative, so the sign is only put on when some
/// digit survives.
function withSign(value: number, text: string): string {
  return value < 0 && /[1-9]/.test(text) ? `${MINUS}${text}` : text
}

/// ── Money ───────────────────────────────────────────────────────────────────

/// Minor units → the string a person reads. IDR has no minor unit in practice,
/// so the server's "minor" is already whole rupiah. Always with "Rp", a true
/// minus before it (`−Rp 1.000`, not `-Rp1.000` or `Rp -1.000`), and one zero:
/// `Rp 0`.
export function money(minor: number | null | undefined): string {
  if (minor === null || minor === undefined || !Number.isFinite(minor))
    return EMPTY
  const whole = Math.round(Math.abs(minor))
  return withSign(minor, rupiah.format(whole))
}

const plain = new Intl.NumberFormat("id-ID")

/// Money without its "Rp": `1.800.000`, `−250.000`. For a column of amounts
/// whose heading already says what they are — a Finance table drawn compact
/// (owner, 17 Oct, `lib/table-rows.ts`). The sign and the zero as `money`.
export function moneyFigure(minor: number | null | undefined): string {
  if (minor === null || minor === undefined || !Number.isFinite(minor))
    return EMPTY
  return withSign(minor, plain.format(Math.round(Math.abs(minor))))
}

const decimals = new Map<number, Intl.NumberFormat>()

/// An `id-ID` number format with the fewest digits that keep the figure true:
/// `max` caps the decimals, `min` pads them.
function grouping(max: number, min = 0): Intl.NumberFormat {
  const key = max * 10 + min
  let found = decimals.get(key)
  if (found === undefined) {
    found = new Intl.NumberFormat("id-ID", {
      minimumFractionDigits: min,
      maximumFractionDigits: max,
    })
    decimals.set(key, found)
  }
  return found
}

const COMPACT_STEPS = [
  [1e3, "K"],
  [1e6, "M"],
  [1e9, "B"],
  [1e12, "T"],
] as const

/// A figure and its letter (a plain figure below a thousand). `padUnderTen`
/// keeps one decimal on the small ones — "4,0 B", not "4 B" — so a column of
/// billions lines up.
function compactText(
  value: number,
  maxFractionDigits: number,
  padUnderTen: boolean
): string {
  const size = Math.abs(value)
  let at = -1
  COMPACT_STEPS.forEach(([step], index) => {
    if (size >= step) at = index
  })
  if (at < 0) return withSign(value, grouping(maxFractionDigits).format(size))
  // 999,950 rounds to "1.000 K"; say "1 M" instead.
  const scale = 10 ** maxFractionDigits
  const rounded = Math.round((size / COMPACT_STEPS[at][0]) * scale) / scale
  if (rounded >= 1000 && at < COMPACT_STEPS.length - 1) at += 1
  const [step, suffix] = COMPACT_STEPS[at]
  const scaled = size / step
  const text = grouping(
    maxFractionDigits,
    padUnderTen && Math.round(scaled * scale) / scale < 10
      ? Math.min(1, maxFractionDigits)
      : 0
  ).format(scaled)
  return withSign(value, `${text}${NBSP}${suffix}`)
}

/// Large figures for an axis or a tight cell: K (thousand), M (million), B
/// (billion), T (trillion), with the rupiah's own decimal comma. `id-ID`'s
/// built-in compact notation says rb / jt / M / T — and its M is a billion —
/// so the suffixes are written out here instead.
///
/// For an AMOUNT use `moneyCompact`; this is the bare number, for an axis that
/// says "Rp" once in its title.
export function compactFormat(maxFractionDigits = 1): {
  format: (value: number) => string
} {
  return {
    format: (value: number) => compactText(value, maxFractionDigits, false),
  }
}

/// An amount where `money()` will not fit — a KPI tile two columns wide, a
/// chart label, a sentence under a title: `Rp 4,0 B`, `Rp 20,6 M`, `Rp 250 K`.
/// Letters, never words ("billion", "bn") and never the Indonesian jt / rb /
/// miliar. Always with "Rp". The exact figure belongs in a title or tooltip,
/// and the compact one is never drawn beside the exact one for the same total.
export function moneyCompact(
  minor: number | null | undefined,
  maxFractionDigits = 1
): string {
  if (minor === null || minor === undefined || !Number.isFinite(minor))
    return EMPTY
  // Under a thousand there is nothing to shorten.
  if (Math.abs(minor) < 1000) return money(minor)
  const text = compactText(Math.abs(minor), maxFractionDigits, true)
  return withSign(minor, `Rp${NBSP}${text}`)
}

/// ── Numbers ─────────────────────────────────────────────────────────────────

/// A whole number, grouped the Indonesian way: `21.060`. Negative with a true
/// minus.
export function count(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value))
    return EMPTY
  return withSign(value, plain.format(Math.abs(value)))
}

/// A count of pieces, "1 pc" or "12 pcs".
export function countPcs(value: number | null | undefined): string {
  return `${count(value)} ${value === 1 ? "pc" : "pcs"}`
}

/// A number with a decimal part, comma as the separator, at most `maxDigits`
/// of it and no trailing zero: `12,5`, `0,25`, `3`.
export function decimal(
  value: number | null | undefined,
  maxDigits = 2
): string {
  if (value === null || value === undefined || !Number.isFinite(value))
    return EMPTY
  return withSign(value, grouping(maxDigits).format(Math.abs(value)))
}

/// How a share is drawn.
export interface PercentOptions {
  /// Most decimals shown; the default is two.
  digits?: number
  /// A "+" on a gain, for a movement against a comparison ("+3,7%", "−1%").
  signed?: boolean
  /// Keep a trailing zero — "99,90%" — where the last digit is a promise (an
  /// uptime), instead of dropping it.
  pad?: boolean
}

/// A share. `value` is already a percentage — `25` is "25%", `0.25` is
/// "0,25%" — written the Indonesian way: decimal comma, at most two decimals,
/// no trailing zero, NO space before the sign.
export function percent(
  value: number | null | undefined,
  options: PercentOptions = {}
): string {
  if (value === null || value === undefined || !Number.isFinite(value))
    return EMPTY
  const digits = options.digits ?? 2
  const text = withSign(
    value,
    grouping(digits, options.pad === true ? digits : 0).format(Math.abs(value))
  )
  return `${options.signed === true && value > 0 && /[1-9]/.test(text) ? "+" : ""}${text}%`
}

/// `part` of `whole` as a share, or `EMPTY` when there is nothing to divide by
/// — never `NaN%`, never `Infinity%`.
export function percentOf(
  part: number,
  whole: number,
  options: PercentOptions = { digits: 1 }
): string {
  return whole === 0 ? EMPTY : percent((part / whole) * 100, options)
}

/// Basis points (the server's unit for rates) as a share: `25` → "0,25%".
export function percentBps(
  bps: number | null | undefined,
  options: PercentOptions = {}
): string {
  return bps === null || bps === undefined ? EMPTY : percent(bps / 100, options)
}

/// ── Quantities ──────────────────────────────────────────────────────────────

/// The owner's words for what is being counted — `pcs` for pieces, `items` for
/// lines on a document, `cartons` for cartons, `pairs` for sets of two — each
/// as [singular, plural]. A single "1 pc" and many "223 pcs"; never "pieces",
/// "Piece", "labels" or "koli" as a unit.
const UNIT_WORDS = {
  pcs: ["pc", "pcs"],
  items: ["item", "items"],
  cartons: ["carton", "cartons"],
  pairs: ["pair", "pairs"],
} as const

export type QuantityUnit = keyof typeof UNIT_WORDS

/// What the server (or an older screen) calls a unit → the owner's word.
const UNIT_ALIASES: Readonly<Record<string, QuantityUnit>> = {
  pcs: "pcs",
  pc: "pcs",
  pce: "pcs",
  piece: "pcs",
  pieces: "pcs",
  unit: "pcs",
  units: "pcs",
  item: "items",
  items: "items",
  line: "items",
  lines: "items",
  carton: "cartons",
  cartons: "cartons",
  koli: "cartons",
  pair: "pairs",
  pairs: "pairs",
}

/// `Piece` → `pcs`, `koli` → `cartons`; a unit the kit has no word for
/// (`lusin`, `kg`) comes back as it was given.
export function unitWord(name: string): string {
  return UNIT_ALIASES[name.trim().toLowerCase()] ?? name
}

/// A count with its unit, pluralised: `quantity(223)` "223 pcs",
/// `quantity(1)` "1 pc", `quantity(8, "items")` "8 items",
/// `quantity(2, "cartons")` "2 cartons". Any other unit is written after the
/// number as given (`quantity(3, "lusin")` "3 lusin"): the server's unit names
/// are not ours to pluralise.
export function quantity(
  value: number | null | undefined,
  unit: QuantityUnit | (string & {}) = "pcs"
): string {
  if (value === null || value === undefined || !Number.isFinite(value))
    return EMPTY
  const word = UNIT_ALIASES[unit.trim().toLowerCase()]
  if (word === undefined) return `${count(value)} ${unit}`
  const [one, many] = UNIT_WORDS[word]
  return `${count(value)} ${Math.abs(value) === 1 ? one : many}`
}

/// Signed, because a variance reads wrong without its sign: "16" is not the
/// same news as "−16". A true minus sign, not a hyphen — it is set beside
/// tabular figures and a hyphen is half the width.
export function signed(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value))
    return EMPTY
  if (value === 0) return "0"
  return `${value > 0 ? "+" : MINUS}${plain.format(Math.abs(value))}`
}

/// ── Dates and times ─────────────────────────────────────────────────────────

/// Anything a date can arrive as.
export type When = string | number | Date | null | undefined

/// A `Date` out of whatever was handed over, or `null`. Everything here is
/// given a string off the wire, and a malformed one must not reach a
/// formatter. A date-only string (`2026-10-06`) is read as that day on the
/// calendar — `new Date("2026-10-06")` is midnight UTC, which is the evening of
/// the day before anywhere west of Greenwich — and `2026-10` as its first day.
function toDate(value: When): Date | null {
  if (value === null || value === undefined || value === "") return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  if (typeof value === "string") {
    const calendar = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(value)
    if (calendar !== null)
      return new Date(
        Number(calendar[1]),
        Number(calendar[2]) - 1,
        Number(calendar[3] ?? 1)
      )
  }
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

const formatters = new Map<string, Intl.DateTimeFormat>()

function formatter(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = JSON.stringify(options)
  let found = formatters.get(key)
  if (found === undefined) {
    // 24-hour, and midnight is 00:05, not 24:05.
    const hourCycle =
      options.hour !== undefined &&
      options.hour12 === undefined &&
      options.hourCycle === undefined
        ? ({ hourCycle: "h23" } as const)
        : {}
    found = new Intl.DateTimeFormat("en-GB", { ...options, ...hourCycle })
    formatters.set(key, found)
  }
  return found
}

/// A date in English month names, day first ("01 Oct 2026"). The hub is
/// English (owner, 2026-09-27) and Indonesian month names — "Okt", "Agu",
/// "Mei", "Des" — read as a mistake beside it; amounts keep the rupiah's own
/// grouping. `en-GB` spells September "Sept", which is trimmed to "Sep".
///
/// The low-level door, for the shapes the helpers below do not cover (a chart
/// axis, a month name on its own). Anything a person reads as a date has a
/// helper.
export function dateText(
  date: Date,
  options: Intl.DateTimeFormatOptions
): string {
  return formatter(options)
    .format(date)
    .replace(/\bSept\b/, "Sep")
}

/// The pieces of a date, by name (`weekday`, `day`, `month`, `year`, `hour`,
/// `minute`) — for the one screen that draws each of them on its own, and for
/// a date that has to be read in a time zone other than the browser's
/// (`timeZone` in `options`).
export function dateParts(
  date: Date,
  options: Intl.DateTimeFormatOptions
): Record<string, string> {
  const found: Record<string, string> = {}
  for (const part of formatter(options).formatToParts(date))
    found[part.type] =
      part.type === "month" ? part.value.replace(/^Sept$/, "Sep") : part.value
  return found
}

/// A date without a time, because almost nothing in this app happens at a
/// moment a person needs to the minute: `06 Oct 2026`.
export function day(value: When): string {
  const at = toDate(value)
  if (at === null) return EMPTY
  return dateText(at, { day: "2-digit", month: "short", year: "numeric" })
}

/// A moment, to the minute: `06 Oct 2026, 14:28`.
export function dayTime(value: When): string {
  const at = toDate(value)
  if (at === null) return EMPTY
  return dateText(at, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

/// The older name for `dayTime`.
export const moment = dayTime

/// The same as `day` without the year, for a place that is short of width and
/// where "2026" is only noise — a chart label, a calendar cell: `06 Oct`. A
/// list of dates keeps its year (`day`).
export function dayMonth(value: When): string {
  const at = toDate(value)
  if (at === null) return EMPTY
  return dateText(at, { day: "2-digit", month: "short" })
}

/// A moment that happened a moment ago, so the year says nothing: `04 Oct, 17:12`.
export function recentMoment(value: When): string {
  const at = toDate(value)
  if (at === null) return EMPTY
  return dateText(at, {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  })
}

/// A day by its weekday, which is how leave and rotas are asked for:
/// `Tue 06 Oct`, or with the year, `Tue 06 Oct 2026`.
export function weekday(value: When, withYear = false): string {
  const at = toDate(value)
  if (at === null) return EMPTY
  const found = dateParts(at, {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
  })
  const dated = `${found.weekday} ${found.day} ${found.month}`
  return withYear ? `${dated} ${found.year}` : dated
}

/// A month, for a tab, a column of months or a label: `Oct 2026`. Takes a
/// date, or `2026-10`. `long` spells it out — `October 2026` — and is for the
/// two places with room to spare and a reason to: a calendar's own heading and
/// a month inside a sentence.
export function monthYear(value: When, long = false): string {
  const at = toDate(value)
  if (at === null) return EMPTY
  return dateText(at, { month: long ? "long" : "short", year: "numeric" })
}

/// A date in Indonesian — `6 Oktober 2026` — for the printed papers that are
/// still written in Indonesian (letters, delivery notes; whether they become
/// English is decision D16). The only Indonesian month names in the kit: a
/// screen never uses it.
export function dayIndonesian(value: When): string {
  const at = toDate(value)
  if (at === null) return EMPTY
  return new Intl.DateTimeFormat("id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(at)
}

/// The pieces, for a column head or a chart tick that says one of them on its
/// own: `Tue`, `Oct`, `06`.
export function weekdayName(value: When): string {
  const at = toDate(value)
  return at === null ? EMPTY : dateText(at, { weekday: "short" })
}

export function monthName(value: When): string {
  const at = toDate(value)
  return at === null ? EMPTY : dateText(at, { month: "short" })
}

export function dayNumber(value: When): string {
  const at = toDate(value)
  return at === null ? EMPTY : dateText(at, { day: "2-digit" })
}

/// The time of day on its own: `14:28`. 24-hour, colon — the Indonesian
/// locale's `14.28` reads as a decimal beside a figure.
export function time(value: When): string {
  const at = toDate(value)
  if (at === null) return EMPTY
  return formatter({ hour: "2-digit", minute: "2-digit" }).format(at)
}

/// Time of day, which is what a shift asks. The date is only added when the
/// answer is not today, because a warehouse works in hours: `14:28`, or
/// `04 Oct, 14:28`.
export function clock(value: When): string {
  const at = toDate(value)
  if (at === null) return EMPTY
  const today = new Date()
  const sameDay =
    at.getDate() === today.getDate() &&
    at.getMonth() === today.getMonth() &&
    at.getFullYear() === today.getFullYear()
  return sameDay ? time(at) : recentMoment(at)
}

/// Two dates as one phrase.
///
/// `day()` twice reads "01 Sep 2026 – 30 Sep 2026", which spends nine tokens
/// saying September. A range that shares a month says the month once, and one
/// that shares a year says the year once, so what is left on the page is the
/// part that actually differs: `01–30 Sep 2026`, `28 Sep – 04 Oct 2026`,
/// `28 Dec 2025 – 04 Jan 2026`. Open at one end is still a range: something
/// with a start and no end is running, and a dash for it would read as "no
/// dates at all", which is a different fact — the caller that wants to draw
/// *that* nothing has to ask before calling.
export function dateRange(from: When, to: When): string {
  const start = toDate(from)
  const end = toDate(to)
  if (start === null) return end === null ? EMPTY : `Until ${day(end)}`
  if (end === null) return `From ${day(start)}`
  if (start.getFullYear() !== end.getFullYear())
    return `${day(start)} – ${day(end)}`
  const sameMonth = start.getMonth() === end.getMonth()
  if (sameMonth && start.getDate() === end.getDate()) return day(end)
  if (sameMonth) return `${dateText(start, { day: "2-digit" })}–${day(end)}`
  return `${dayMonth(start)} – ${day(end)}`
}

/// The older name for `dateRange`.
export const span = dateRange

/// How long ago, for anything whose age is the point — a delivery on the bay,
/// a backlog that has not gone anywhere. Only for an AGE, in a list or a
/// timeline: a date somebody has to find again is `day`.
export function ago(value: When): string {
  if (value === null || value === undefined || value === "") return "never"
  const at = toDate(value)
  if (at === null) return EMPTY
  const seconds = Math.round((Date.now() - at.getTime()) / 1000)
  if (seconds < 0) return "in the future"
  if (seconds < 60) return `${seconds}s ago`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86_400)}d ago`
}

/// ── Words ───────────────────────────────────────────────────────────────────
///
/// What a state is called, and which tint it wears, is `lib/words.ts`; these
/// are re-exported so the screens that already import them from here keep
/// working.
export { EMPTY, label, positionTone, toneFor, type Tone } from "@/lib/words"

/// Pieces. The same formatter as `count`, named for what it is counting so a
/// screen reads as the floor talks.
export const units = count

/// The older name for `signed`.
export const variance = signed

/// A supplier's own code for an item, or `undefined` where it is the stand-in
/// the item form invents when the supplier gave none (`ITM-` and eight
/// characters). That one is a made-up key for the database and means nothing to
/// a person, so no screen shows it (owner, 2026-10-05).
export function realItemCode(
  code: string | null | undefined
): string | undefined {
  if (code === null || code === undefined) return undefined
  return /^ITM-[0-9A-F]{8}$/.test(code) ? undefined : code
}

/// The letter an avatar shows for a name: the first LETTER, not the first
/// character — "👨‍💼 Budi" is a B, where `charAt(0)` hands back half of an emoji
/// and the avatar draws a replacement mark. A name with no letter at all falls
/// back to its first whole character, and an empty one to "?".
export function initialOf(name: string | null | undefined): string {
  const trimmed = (name ?? "").trim()
  if (trimmed === "") return "?"
  const letter = trimmed.match(/\p{L}/u)?.[0]
  return (letter ?? Array.from(trimmed)[0] ?? "?").toLocaleUpperCase()
}

/// ── SKU ─────────────────────────────────────────────────────────────────────

/// A SKU as a person reads it (owner, 21 Oct 2026): the article's eight digits,
/// a middle dot, then colour + size — "00000004103" → "00000004·103". The
/// stored code stays eleven plain digits; this is display only, so barcodes,
/// QR and search keep the raw value. Anything not eleven digits is returned
/// as it came.
export function sku(code: string | null | undefined): string {
  if (code === null || code === undefined || code === "") return "—"
  return /^\d{11}$/.test(code) ? `${code.slice(0, 8)}·${code.slice(8)}` : code
}
