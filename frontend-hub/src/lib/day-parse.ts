import * as en from "chrono-node/en"

import { dateOf, isoOf } from "@/lib/calendar"

/// A day, read off what somebody typed — "besok", "jumat", "15/10", "akhir
/// bulan", "3 hari lagi", "next fri", "2026-10-15".
///
/// Chrono does the reading, through its English parser in the British order
/// (day before month, which is how this country writes a date). It has no
/// Indonesian, so the Indonesian words are turned into the English ones it
/// knows before it sees them — the vocabulary a date box actually gets is a
/// few dozen words, and a word list is easier to check than a grammar.
///
/// Three of chrono's own guesses are overruled, each because it was tried and
/// read wrong:
///
///  - **A weekday on its own means the coming one.** Chrono takes the nearest,
///    so "jumat" typed on a Sunday was the Friday just gone. On a form
///    somebody names a day to plan it; "jumat lalu" is there for the past.
///  - **A day without a year is this year.** Chrono takes the nearest year, so
///    "15/03" typed in September was March NEXT year. Only a window the field
///    declares (`notBefore` / `notAfter`) moves it a year — a due date can
///    only be ahead, a receipt date only behind.
///  - **"oct 15" is the fifteenth.** Chrono read the 15 as the year 2015.
///
/// And a bare number — "15" — is that day of this month, which chrono does
/// not read at all.
///
/// Returns an ISO day, or `null` when nothing in the text is a day. What it
/// returns is always shown to the person before it is taken, so a wrong guess
/// is seen rather than filed.
export function readDay(
  text: string,
  reference: string,
  window: { notBefore?: string | null; notAfter?: string | null } = {}
): string | null {
  const said = normalise(text)
  if (said === "") return null

  const found =
    edge(text.trim().toLowerCase().replace(/\s+/g, " "), reference) ??
    own(said, reference) ??
    chrono(said, reference)
  if (found === null) return null
  return found.yearGiven ? found.iso : fit(found.iso, reference, window)
}

interface Found {
  readonly iso: string
  /// Whether the year was written, so it is not moved to fit a window.
  readonly yearGiven: boolean
}

// ── words ───────────────────────────────────────────────────────────────────

const MONTHS: readonly (readonly [RegExp, string])[] = [
  [/\bjan(uari)?\b/g, "january"],
  [/\bp?feb(ruari)?\b|\bpebruari\b/g, "february"],
  [/\bmar(et)?\b/g, "march"],
  [/\bapr(il)?\b/g, "april"],
  [/\bmei\b/g, "may"],
  [/\bjun(i)?\b/g, "june"],
  [/\bjul(i)?\b/g, "july"],
  [/\bag(u|t|s)(stus)?\b|\bagustus\b/g, "august"],
  [/\bsept?(ember)?\b/g, "september"],
  [/\bokt(ober)?\b/g, "october"],
  [/\bno[pv](ember)?\b/g, "november"],
  [/\bdes(ember)?\b/g, "december"],
]

const WEEKDAYS: readonly (readonly [RegExp, string])[] = [
  [/\bsen(in)?\b/g, "monday"],
  [/\bsel(asa)?\b/g, "tuesday"],
  [/\brab(u)?\b/g, "wednesday"],
  [/\bkam(is)?\b/g, "thursday"],
  [/\bjum'?at\b|\bjum\b/g, "friday"],
  [/\bsab(tu)?\b/g, "saturday"],
  // "minggu" is also "week" — the phrases that mean a week are turned into
  // English first, so what is left of the word here is the day.
  [/\bminggu\b|\bahad\b/g, "sunday"],
]

/// Phrases, longest first, so "kemarin lusa" is not read as "kemarin".
const PHRASES: readonly (readonly [RegExp, string])[] = [
  [/\bhari ini\b|\bsekarang\b/g, "today"],
  [/\bkemarin lusa\b/g, "2 days ago"],
  [/\bbesok lusa\b/g, "in 3 days"],
  [/\bbesok\b|\besok\b/g, "tomorrow"],
  [/\blusa\b/g, "in 2 days"],
  [/\bkemarin\b/g, "yesterday"],
  [/\bse(minggu|pekan) lagi\b/g, "in 1 week"],
  [/\bsebulan lagi\b/g, "in 1 month"],
  [/\bsetahun lagi\b/g, "in 1 year"],
  [/\b(\d+) hari lagi\b/g, "in $1 days"],
  [/\b(\d+) (minggu|pekan) lagi\b/g, "in $1 weeks"],
  [/\b(\d+) bulan lagi\b/g, "in $1 months"],
  [/\b(\d+) tahun lagi\b/g, "in $1 years"],
  [/\b(\d+) hari (yang )?lalu\b/g, "$1 days ago"],
  [/\b(\d+) (minggu|pekan) (yang )?lalu\b/g, "$1 weeks ago"],
  [/\b(\d+) bulan (yang )?lalu\b/g, "$1 months ago"],
  [/\b(minggu|pekan) depan\b/g, "next week"],
  [/\b(minggu|pekan) lalu\b/g, "last week"],
  [/\bbulan depan\b/g, "next month"],
  [/\bbulan lalu\b/g, "last month"],
  [/\btahun depan\b/g, "next year"],
  [/\btahun lalu\b/g, "last year"],
]

function normalise(text: string): string {
  let said = text
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    // "tgl 15", "tanggal 15 okt" — the word says nothing the number does not.
    .replace(/\b(tgl|tanggal)\.? ?/g, "")
  for (const [pattern, english] of PHRASES)
    said = said.replace(pattern, english)
  for (const [pattern, english] of MONTHS) said = said.replace(pattern, english)
  for (const [pattern, english] of WEEKDAYS)
    said = said.replace(pattern, english)
  // A weekday with its modifier after it, the Indonesian order: "jumat depan".
  said = said
    .replace(/\b(\w+day) depan\b/g, "next $1")
    .replace(/\b(\w+day) lalu\b/g, "last $1")
    .replace(/\b(\w+day) ini\b/g, "this $1")
  return said.trim()
}

// ── what chrono does not say ────────────────────────────────────────────────

const DAY_NAMES = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
]
const ABBREVIATED = /^(mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)$/

/// The edges of a month or a year, which a due date is asked for more than any
/// day in them. Read off the raw text, before the word list turns "bulan
/// depan" into "next month" and the phrase stops being recognisable.
function edge(raw: string, reference: string): Found | null {
  const match =
    /^(akhir|awal|end of|start of) (?:(next|this) )?(bulan|month|tahun|year)(?: (depan|ini))?$/.exec(
      raw
    )
  if (match === null) return null
  const at = dateOf(reference)
  const end = match[1] === "akhir" || match[1] === "end of"
  const unit = match[3]
  const next = match[2] === "next" || match[4] === "depan"
  if (unit === "tahun" || unit === "year") {
    const y = at.getFullYear() + (next ? 1 : 0)
    return {
      iso: isoOf(end ? new Date(y, 11, 31) : new Date(y, 0, 1)),
      yearGiven: true,
    }
  }
  const m = at.getMonth() + (next ? 1 : 0)
  return {
    iso: isoOf(
      end
        ? new Date(at.getFullYear(), m + 1, 0)
        : new Date(at.getFullYear(), m, 1)
    ),
    yearGiven: true,
  }
}

function own(said: string, reference: string): Found | null {
  const at = dateOf(reference)

  // A bare number: that day of this month.
  const bare = /^(\d{1,2})$/.exec(said)
  if (bare !== null) {
    const n = Number(bare[1])
    const last = new Date(at.getFullYear(), at.getMonth() + 1, 0).getDate()
    if (n < 1 || n > last) return null
    return {
      iso: isoOf(new Date(at.getFullYear(), at.getMonth(), n)),
      yearGiven: false,
    }
  }

  // A weekday on its own: the coming one, today included.
  const name = ABBREVIATED.test(said)
    ? DAY_NAMES.find((one) => one.startsWith(said.slice(0, 3)))
    : DAY_NAMES.find((one) => one === said)
  if (name !== undefined) {
    const ahead = (DAY_NAMES.indexOf(name) - at.getDay() + 7) % 7
    return {
      iso: isoOf(
        new Date(at.getFullYear(), at.getMonth(), at.getDate() + ahead)
      ),
      yearGiven: true,
    }
  }

  return null
}

function chrono(said: string, reference: string): Found | null {
  // "october 15" → "15 october": chrono reads a trailing number after a month
  // as its year.
  const flipped = said.replace(
    /^([a-z]+) (\d{1,2})(?!\d)( \d{4})?$/,
    (whole, month: string, day: string, year: string | undefined) =>
      month.length >= 3 && MONTH_NAMES.some((one) => one.startsWith(month))
        ? `${day} ${month}${year ?? ""}`
        : whole
  )
  const [result] = en.GB.parse(flipped, dateOf(reference))
  if (result === undefined) return null
  const start = result.start
  // A year chrono made up does not count as given; one it was told does, and
  // so does anything relative ("in 3 days"), whose year is not a guess.
  const relative = !start.isCertain("day") || !start.isCertain("month")
  return {
    iso: isoOf(start.date()),
    yearGiven: relative || start.isCertain("year"),
  }
}

const MONTH_NAMES = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
]

/// A day whose year nobody wrote: this year, or the neighbouring one when the
/// field's window says this year's is out of reach.
function fit(
  iso: string,
  reference: string,
  window: { notBefore?: string | null; notAfter?: string | null }
): string {
  const at = dateOf(iso)
  const thisYear = dateOf(reference).getFullYear()
  let candidate = isoOf(new Date(thisYear, at.getMonth(), at.getDate()))
  const { notBefore, notAfter } = window
  if (notBefore && candidate < notBefore)
    candidate = isoOf(new Date(thisYear + 1, at.getMonth(), at.getDate()))
  else if (notAfter && candidate > notAfter)
    candidate = isoOf(new Date(thisYear - 1, at.getMonth(), at.getDate()))
  return candidate
}
