import type * as enModule from "chrono-node/en"

import { dateOf, isoOf } from "@/lib/calendar"

/// A day, read off what somebody typed — "besok", "jumat", "15/10", "akhir
/// bulan", "3 hari lagi", "dua minggu lagi", "senin minggu depan", "natal",
/// "next fri", "2026-10-15".
///
/// Chrono does the reading, through its English parser in the British order
/// (day before month, which is how this country writes a date). It has no
/// Indonesian, so what it is given has been through two passes first:
///
///  1. `prepare` makes the text plain — number words become digits ("dua
///     puluh lima" → 25), "tanggal", clock times and the time of day ("jam 3
///     sore", "malam ini") are taken off, because a day box wants the day.
///  2. `special` reads what chrono has no word for: the edges of a month, year
///     or quarter, "akhir pekan", "jumat terakhir bulan ini", "senin minggu
///     depan", "3 hari kerja lagi", and the holidays that sit on a fixed day.
///
/// What is left is turned word by word into the English chrono knows — the
/// vocabulary a date box actually gets is a few hundred words, and a word list
/// is easier to check than a grammar.
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
/// The week starts on Monday and ends on Sunday, as the calendar does. The
/// weekend is Saturday: "akhir pekan" is the coming Saturday. Holidays whose
/// day moves each year (Idul Fitri, Waisak) are not here — the government sets
/// them after the moon is seen, and a wrong guess is worse than none.
///
/// Returns an ISO day, or `null` when nothing in the text is a day. What it
/// returns is always shown to the person before it is taken, so a wrong guess
/// is seen rather than filed.
export function readDay(
  text: string,
  reference: string,
  window: { notBefore?: string | null; notAfter?: string | null } = {}
): string | null {
  const plain = prepare(text)
  if (plain === "") return null

  const found =
    special(plain, reference) ??
    own(normalise(plain), reference) ??
    chrono(normalise(plain), reference)
  if (found === null) return null
  return found.yearGiven ? found.iso : fit(found.iso, reference, window)
}

/// A stretch of days, read off what somebody typed — "minggu ini", "bulan
/// depan", "kuartal 4", "1-5 okt", "15 okt - 20 okt", "senin sampai jumat",
/// "7 hari terakhir", "30 hari ke depan", "akhir pekan depan". One day alone
/// ("jumat") is that day to itself.
///
/// The ends come back in order whichever way round they were typed.
export function readRange(
  text: string,
  reference: string
): { from: string; to: string } | null {
  const plain = prepare(text)
  if (plain === "") return null
  const at = dateOf(reference)
  let m: RegExpExecArray | null

  const span = (from: Date, to: Date) => ({ from: isoOf(from), to: isoOf(to) })

  // The whole of a week, month, year, quarter or half-year.
  if (
    (m = /^(?:minggu|pekan|week) (ini|depan|lalu|next|this|last)$/.exec(plain))
  ) {
    const monday = weekStart(at, relative(m[1]))
    return span(monday, shift(monday, 6))
  }
  if (
    (m = /^(?:(next|this|last) )?(?:bulan|month)(?: (ini|depan|lalu))?$/.exec(
      plain
    ))
  ) {
    const rel = relative(m[1] ?? m[2] ?? "ini")
    return span(
      new Date(at.getFullYear(), at.getMonth() + rel, 1),
      new Date(at.getFullYear(), at.getMonth() + rel + 1, 0)
    )
  }
  if (
    (m = /^(?:(next|this|last) )?(?:tahun|year)(?: (ini|depan|lalu))?$/.exec(
      plain
    ))
  ) {
    const y = at.getFullYear() + relative(m[1] ?? m[2] ?? "ini")
    return span(new Date(y, 0, 1), new Date(y, 11, 31))
  }
  if ((m = QUARTER_WHOLE.exec(plain))) {
    const [y, q] = quarterOf(at, m[1], m[2], m[3])
    return span(new Date(y, q * 3, 1), new Date(y, q * 3 + 3, 0))
  }
  if ((m = /^semester ([12])(?: (\d{4}))?$/.exec(plain))) {
    const y = m[2] === undefined ? at.getFullYear() : Number(m[2])
    const start = m[1] === "1" ? 0 : 6
    return span(new Date(y, start, 1), new Date(y, start + 6, 0))
  }
  // A month on its own: "oktober", "oktober 2026", "bulan oktober".
  if ((m = /^(?:bulan )?([a-z]{3,9})(?: (\d{4}))?$/.exec(plain))) {
    const month = monthOf(m[1])
    if (month !== null) {
      const y = m[2] === undefined ? at.getFullYear() : Number(m[2])
      return span(new Date(y, month, 1), new Date(y, month + 1, 0))
    }
  }
  // The weekend, both days of it.
  if (
    (m =
      /^(?:akhir pekan|akhir minggu|weekend|the weekend|wiken)(?: (ini|depan|lalu))?$/.exec(
        plain
      ))
  ) {
    const saturday = weekendOf(at, relative(m[1] ?? "ini"))
    return span(saturday, shift(saturday, 1))
  }
  // Counting out from today: "7 hari terakhir", "30 hari ke depan".
  if (
    (m =
      /^(\d+) (hari|minggu|pekan|bulan|tahun) (terakhir|ke belakang|belakangan|ke depan|kedepan|mendatang|berikutnya)$/.exec(
        plain
      ))
  ) {
    const n = Number(m[1])
    const back = /^(terakhir|ke belakang|belakangan)$/.test(m[3])
    const far = add(at, m[2], back ? -n : n)
    return back ? span(shift(far, 1), at) : span(at, shift(far, -1))
  }

  // "1-5 okt", "1 s/d 5 oktober 2026" — two days sharing one month.
  if (
    (m =
      /^(\d{1,2}) ?(?:-|–|—|s\/d|sd|sampai|hingga|to|until) ?(\d{1,2}) ([a-z]{3,9})(?: (\d{4}))?$/.exec(
        plain
      ))
  ) {
    const month = monthOf(m[3])
    if (month !== null) {
      const y = m[4] === undefined ? at.getFullYear() : Number(m[4])
      const a = new Date(y, month, Number(m[1]))
      const b = new Date(y, month, Number(m[2]))
      if (a.getMonth() === month && b.getMonth() === month)
        return a <= b ? span(a, b) : span(b, a)
    }
  }

  // Two ends: "15/10 - 30/10", "besok sampai akhir bulan", "dari senin sampai
  // jumat", "antara 1 okt dan 5 okt".
  const bare = plain.replace(/^(?:dari|antara|from|between)(?: tanggal)? /, "")
  const parts = bare.split(SPLIT)
  if (parts.length === 2) {
    const first = readDay(parts[0], reference)
    let second = readDay(parts[1], reference)
    if (first === null || second === null) return null
    // "senin sampai jumat", typed on a Friday: the Friday meant is the one
    // after that Monday, not the one today.
    if (second < first && weekdayOf(prepare(parts[1])) !== null)
      second = isoOf(shift(dateOf(second), 7))
    return first <= second
      ? { from: first, to: second }
      : { from: second, to: first }
  }
  if (parts.length > 2) return null

  const only = readDay(plain, reference)
  return only === null ? null : { from: only, to: only }
}

/// " - ", an en dash, "to", "sampai", "s/d", "dan" — with spaces round them,
/// so the hyphens inside "15-10" stay part of the day.
const SPLIT =
  /\s+(?:-|–|—|to|until|sampai|hingga|s\/d|sd|dan|and)\s+|\s*[–—]\s*/i

interface Found {
  readonly iso: string
  /// Whether the year was written, so it is not moved to fit a window.
  readonly yearGiven: boolean
}

// ── numbers ─────────────────────────────────────────────────────────────────

const DIGITS: Readonly<Record<string, number>> = {
  nol: 0,
  kosong: 0,
  satu: 1,
  dua: 2,
  tiga: 3,
  empat: 4,
  lima: 5,
  enam: 6,
  tujuh: 7,
  delapan: 8,
  sembilan: 9,
}

const NUMBER_WORDS = new Set([
  ...Object.keys(DIGITS),
  "sepuluh",
  "sebelas",
  "seratus",
  "seribu",
  "belas",
  "puluh",
  "ratus",
  "ribu",
])

/// "dua puluh lima" → 25, "sebelas" → 11, "dua ribu dua puluh enam" → 2026.
function numberOf(words: readonly string[]): number | null {
  let total = 0
  let current = 0
  let pending: number | null = null
  for (const word of words) {
    const digit = DIGITS[word]
    if (digit !== undefined) {
      if (pending !== null) return null
      pending = digit
    } else if (word === "sepuluh") current += 10
    else if (word === "sebelas") current += 11
    else if (word === "seratus") current += 100
    else if (word === "seribu") total += 1000
    else if (word === "belas") {
      if (pending === null) return null
      current += 10 + pending
      pending = null
    } else if (word === "puluh") {
      if (pending === null) return null
      current += pending * 10
      pending = null
    } else if (word === "ratus") {
      if (pending === null) return null
      current += pending * 100
      pending = null
    } else if (word === "ribu") {
      total += (current + (pending ?? 0) || 1) * 1000
      current = 0
      pending = null
    } else return null
  }
  return total + current + (pending ?? 0)
}

/// Every run of number words in the text, as digits.
function digits(text: string): string {
  const words = text.split(" ")
  const out: string[] = []
  for (let i = 0; i < words.length;) {
    if (!NUMBER_WORDS.has(words[i])) {
      out.push(words[i++])
      continue
    }
    let end = i
    while (end < words.length && NUMBER_WORDS.has(words[end])) end++
    const value = numberOf(words.slice(i, end))
    if (value === null) out.push(...words.slice(i, end))
    else out.push(String(value))
    i = end
  }
  return out.join(" ")
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
  [/\bag(u|t|s)(stus)?\b|\bagustus\b|\bagst\b/g, "august"],
  [/\bsept?(ember)?\b/g, "september"],
  [/\bokt(ober)?\b/g, "october"],
  [/\bno[pv](ember)?\b|\bnopember\b/g, "november"],
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

/// A weekday as `Date.getDay()` numbers it (Sunday 0), from either language.
function weekdayOf(word: string): number | null {
  for (const [pattern, english] of WEEKDAYS)
    if (new RegExp(pattern.source).test(word)) return DAY_NAMES.indexOf(english)
  const named = DAY_NAMES.findIndex(
    (one) =>
      one === word ||
      (word.length >= 3 &&
        ABBREVIATED.test(word) &&
        one.startsWith(word.slice(0, 3)))
  )
  return named === -1 ? null : named
}

/// A month, 0–11, from either language, or null when the word is not one.
function monthOf(word: string): number | null {
  for (const [pattern, english] of MONTHS)
    if (new RegExp(`^(?:${pattern.source})$`.replace(/\\b/g, "")).test(word))
      return MONTH_NAMES.indexOf(english)
  if (word.length < 3) return null
  const named = MONTH_NAMES.findIndex((one) => one.startsWith(word))
  return named === -1 ? null : named
}

/// Phrases, longest first, so "kemarin lusa" is not read as "kemarin".
const PHRASES: readonly (readonly [RegExp, string])[] = [
  [/\bhari ini\b|\bsekarang\b/g, "today"],
  [/\bkemarin lusa\b/g, "2 days ago"],
  [/\bbesok lusa\b/g, "in 3 days"],
  [/\bbesok\b|\besok\b/g, "tomorrow"],
  [/\blusa\b/g, "in 2 days"],
  [/\bkemarin\b/g, "yesterday"],
  [/\b(minggu|pekan) depan\b/g, "next week"],
  [/\b(minggu|pekan) lalu\b/g, "last week"],
  [/\bbulan depan\b/g, "next month"],
  [/\bbulan lalu\b/g, "last month"],
  [/\btahun depan\b/g, "next year"],
  [/\btahun lalu\b/g, "last year"],
]

const UNIT_WORDS: Readonly<Record<string, string>> = {
  hari: "day",
  minggu: "week",
  pekan: "week",
  bulan: "month",
  tahun: "year",
}

/// "dua minggu lagi", "3 bulan lalu", "seminggu yang lalu" — a count of
/// something, ahead or behind. The `se-` forms ("sehari", "seminggu") have
/// been made "1 hari" by `prepare` before this sees them.
const AHEAD =
  /\b(\d+) (hari|minggu|pekan|bulan|tahun) (?:lagi|dari sekarang|dari hari ini|ke depan|kedepan|kemudian|setelahnya|mendatang)\b/g
const BEHIND =
  /\b(\d+) (hari|minggu|pekan|bulan|tahun) (?:yang )?(?:lalu|lewat|sebelumnya|silam|yang lalu)\b/g

function normalise(plain: string): string {
  let said = plain
    .replace(
      AHEAD,
      (_, n: string, unit: string) => `in ${n} ${UNIT_WORDS[unit]}s`
    )
    .replace(
      BEHIND,
      (_, n: string, unit: string) => `${n} ${UNIT_WORDS[unit]}s ago`
    )
  for (const [pattern, english] of PHRASES)
    said = said.replace(pattern, english)
  for (const [pattern, english] of MONTHS) said = said.replace(pattern, english)
  for (const [pattern, english] of WEEKDAYS)
    said = said.replace(pattern, english)
  // A weekday with its modifier after it, the Indonesian order: "jumat depan".
  said = said
    .replace(/\b(\w+day) depan\b/g, "next $1")
    .replace(/\b(\w+day) lalu\b/g, "last $1")
    .replace(/\b(\w+day) kemarin\b/g, "last $1")
    .replace(/\b(\w+day) ini\b/g, "this $1")
  return said.replace(/\s+/g, " ").trim()
}

// ── making the text plain ───────────────────────────────────────────────────

const WEEKDAY_WORD = "senin|selasa|rabu|kamis|jum'?at|sabtu|minggu|ahad"
const DAY_PART = "pagi|siang|sore|petang|malam|subuh|dini hari"

function prepare(text: string): string {
  let said = text.trim().toLowerCase().replace(/\s+/g, " ")
  said = digits(said)

  said = said
    // "sehari", "seminggu", "sebulan" are one of them.
    .replace(/\bse(hari|minggu|pekan|bulan|tahun)\b/g, "1 $1")
    // "tgl 15", "tanggal 15 okt", "hari senin" — the word says nothing the
    // number or the name does not.
    .replace(/\b(tgl|tanggal)\.? ?/g, "")
    .replace(new RegExp(`\\bhari (?=(?:${WEEKDAY_WORD})\\b)`, "g"), "")
    .replace(/^(?:pada|di|untuk|on|at) /, "")
    // "15 bln 10", "15 bulan 10 tahun 2026" → "15/10/2026".
    .replace(
      /\b(\d{1,2}) (?:bln|bulan) (\d{1,2})(?: (?:thn|tahun)? ?(\d{2,4}))?\b/g,
      (_, d: string, m: string, y: string | undefined) =>
        `${d}/${m}${y === undefined ? "" : `/${y}`}`
    )

  // How people shorten the units: "dlm 3 bln", "2 mgg", "30 hr", "1 thn".
  said = said
    .replace(/\bdlm\b/g, "dalam")
    .replace(/\bbln\b/g, "bulan")
    .replace(/\bmgg?\b/g, "minggu")
    .replace(/\bhr\b/g, "hari")
    .replace(/\bthn\b/g, "tahun")
    .replace(/\bskrg\b/g, "sekarang")

  // Clock times: the day is what is wanted, so the hour is taken off.
  said = said
    .replace(/\b(?:jam|pukul|pkl)\.? ?\d{1,2}(?:[:.]\d{2})?\b/g, "")
    .replace(/\b(?:wib|wita|wit)\b/g, "")
    .replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g, "")
    // "15/10 10.30" — a trailing hour after a day, which cannot be a month.
    .replace(/^(.+\S) \d{1,2}\.(?:[0-5]\d)$/, (whole, rest: string) =>
      /\d/.test(rest) || /[a-z]/.test(rest) ? rest : whole
    )

  // "malam minggu" is Saturday night and "malam jumat" Thursday's: the night
  // belongs to the day before, which is the day somebody means.
  said = said.replace(
    new RegExp(`\\bmalam (${WEEKDAY_WORD})\\b`, "g"),
    (_, name: string) => {
      const index = weekdayOf(name)
      return index === null ? _ : DAY_NAMES[(index + 6) % 7]
    }
  )

  said = said
    .replace(/\bsemalam\b|\btadi malam\b/g, "kemarin")
    .replace(
      new RegExp(
        `\\b(?:nanti|tadi) (?:${DAY_PART})\\b|\\b(?:${DAY_PART}) (?:ini|nanti|tadi)\\b`,
        "g"
      ),
      "hari ini"
    )
    .replace(
      new RegExp(`\\b(?:tengah malam|tengah hari|${DAY_PART})\\b`, "g"),
      ""
    )
    .replace(/\b(?:nanti|tadi)\b/g, "")

  // "15.10" and "15-10" are the fifteenth of October, written the Indonesian
  // way, when that is the whole of it.
  said = said.replace(
    /^(\d{1,2})[.-](\d{1,2})(?:[.-](\d{2,4}))?$/,
    (whole, d: string, m: string, y: string | undefined) =>
      Number(m) >= 1 && Number(m) <= 12
        ? `${d}/${m}${y === undefined ? "" : `/${y}`}`
        : whole
  )

  return said.replace(/\s+/g, " ").trim()
}

// ── what chrono does not say ────────────────────────────────────────────────

const FIXED_DAYS: readonly (readonly [RegExp, number, number])[] = [
  [/^(?:malam )?tahun baru$/, 0, 1],
  [/^malam tahun baru$/, 11, 31],
  [/^(?:hari )?valentine$|^hari kasih sayang$/, 1, 14],
  [/^hari kartini$/, 3, 21],
  [/^(?:hari )?buruh$|^hari buruh$|^may ?day$/, 4, 1],
  [/^hari pancasila$/, 5, 1],
  [/^(?:hari )?anak(?: nasional)?$|^hari anak nasional$/, 6, 23],
  [/^(?:hari kemerdekaan(?: ri)?|hut ri|17an|tujuh belas agustusan)$/, 7, 17],
  [/^hari kesaktian pancasila$/, 9, 1],
  [/^(?:hari )?sumpah pemuda$/, 9, 28],
  [/^(?:hari )?pahlawan$|^hari pahlawan$/, 10, 10],
  [/^hari guru(?: nasional)?$/, 10, 25],
  [/^hari ibu$/, 11, 22],
  [/^malam natal$|^christmas eve$/, 11, 24],
  [/^(?:hari raya )?natal$|^christmas$/, 11, 25],
]

const ORDINALS: Readonly<Record<string, number>> = {
  pertama: 1,
  kedua: 2,
  ketiga: 3,
  keempat: 4,
  kelima: 5,
  terakhir: -1,
  first: 1,
  second: 2,
  third: 3,
  fourth: 4,
  fifth: 5,
  last: -1,
}

/// "kuartal 4", "q4 2026", "triwulan ini" — as the quarter wanted.
const QUARTER_WHOLE =
  /^(?:kuartal|kwartal|triwulan|quarter|q) ?(?:(\d)|(ini|depan|lalu))?(?: (\d{4}))?$/

/// Which quarter that is, as [year, 0–3]: the one named, or the one counted
/// from today's.
function quarterOf(
  at: Date,
  number: string | undefined,
  relativeTo: string | undefined,
  year: string | undefined
): [number, number] {
  if (number !== undefined)
    return [
      year === undefined ? at.getFullYear() : Number(year),
      Math.min(Math.max(Number(number), 1), 4) - 1,
    ]
  const index =
    at.getFullYear() * 4 +
    Math.floor(at.getMonth() / 3) +
    relative(relativeTo ?? "ini")
  return [Math.floor(index / 4), index % 4]
}

/// A relative word as a step: depan / next is one on, lalu / last one back.
function relative(word: string): number {
  return word === "depan" || word === "next"
    ? 1
    : word === "lalu" || word === "last"
      ? -1
      : 0
}

function shift(at: Date, days: number): Date {
  return new Date(at.getFullYear(), at.getMonth(), at.getDate() + days)
}

function add(at: Date, unit: string, count: number): Date {
  if (unit === "hari") return shift(at, count)
  if (unit === "minggu" || unit === "pekan") return shift(at, count * 7)
  if (unit === "bulan") return addMonths(at, count)
  return addMonths(at, count * 12)
}

/// Months on, keeping the day of the month — and the last day of a shorter
/// month, so 31 Jan and a month is 28 Feb, not 3 Mar.
function addMonths(at: Date, count: number): Date {
  const target = new Date(at.getFullYear(), at.getMonth() + count, 1)
  const last = new Date(
    target.getFullYear(),
    target.getMonth() + 1,
    0
  ).getDate()
  return new Date(
    target.getFullYear(),
    target.getMonth(),
    Math.min(at.getDate(), last)
  )
}

/// The Monday of the week `step` weeks from the one `at` is in.
function weekStart(at: Date, step: number): Date {
  return shift(at, -((at.getDay() + 6) % 7) + step * 7)
}

/// The coming Saturday, today if it is the weekend already — or, given a step,
/// the Saturday of the week that many weeks on.
function weekendOf(at: Date, step: number): Date {
  if (step === 0 && at.getDay() === 0) return shift(at, -1)
  return shift(weekStart(at, step), 5)
}

function isWorkday(at: Date): boolean {
  return at.getDay() !== 0 && at.getDay() !== 6
}

/// A number of working days on, Saturday and Sunday skipped. Public holidays
/// are not: the list moves each year and a buyer reads the result anyway.
function workdays(at: Date, count: number): Date {
  let day = at
  const step = count < 0 ? -1 : 1
  for (let left = Math.abs(count); left > 0;) {
    day = shift(day, step)
    if (isWorkday(day)) left--
  }
  return day
}

/// The nth weekday of a month — the second Thursday, the last Friday — or
/// null when the month has no such one (a fifth Monday that is not there).
function nthWeekday(
  year: number,
  month: number,
  weekday: number,
  n: number
): Date | null {
  if (n < 0) {
    const last = new Date(year, month + 1, 0)
    return shift(last, -((last.getDay() - weekday + 7) % 7))
  }
  const first = new Date(year, month, 1)
  const day = shift(first, ((weekday - first.getDay() + 7) % 7) + (n - 1) * 7)
  return day.getMonth() === month ? day : null
}

/// Which month a phrase points at — "bulan ini", "bulan depan", "oktober",
/// "oktober 2027" — as [year, 0–11, whether the year was written].
function monthRef(at: Date, words: string): [number, number, boolean] | null {
  const m =
    /^(?:(?:bulan )?(ini|depan|lalu)|(?:bulan )?([a-z]{3,9})(?: (\d{4}))?|(this|next|last) month)$/.exec(
      words
    )
  if (m === null) return null
  if (m[1] !== undefined || m[4] !== undefined) {
    const at2 = new Date(
      at.getFullYear(),
      at.getMonth() + relative(m[1] ?? m[4].replace(/^(this)$/, "ini")),
      1
    )
    return [at2.getFullYear(), at2.getMonth(), true]
  }
  const month = monthOf(m[2])
  if (month === null) return null
  return [
    m[3] === undefined ? at.getFullYear() : Number(m[3]),
    month,
    m[3] !== undefined,
  ]
}

/// Words that may stand in front of a count of time without changing it.
const COUNT_LEAD =
  /^(?:dalam|in|selama|sekitar|kira kira|kurang lebih|kl|±|~|\+|setelah|sesudah|after|nanti)\s*/
/// Behind it, saying it is ahead…
const COUNT_AHEAD =
  /\s*(?:lagi|ke depan|kedepan|kemudian|dari sekarang|dari hari ini|mendatang|setelahnya|from now|ahead)$/
/// … or behind.
const COUNT_BEHIND = /\s*(?:yang lalu|lalu|lewat|sebelumnya|silam|ago)$/
/// Payment terms, which are a count of days and are typed as one: "net 30",
/// "tempo 30 hari", "TOP 45", "jatuh tempo 14 hari".
const TERMS =
  /^(?:net|tempo|jatuh tempo|jt|top|termin|terms?|payment terms?) ?(\d+)(?: hari| days?)?$/

const COUNT_UNIT =
  "hari kerja|hari efektif|working days?|workdays?|hk|hari|days?|minggu|pekan|weeks?|bulan|months?|tahun|years?"
const COUNT_PART = new RegExp(
  `(\\d+(?:[.,]\\d+)?)(?: setengah)? ?(${COUNT_UNIT})\\b|\\b(setengah|seperempat) (${COUNT_UNIT})\\b`,
  "g"
)

/// A count of time from today, or null when the text is not one. Bare, it is
/// ahead — "30 hari" in a date box is the thirtieth day on — and "lalu" turns
/// it round. Several parts add up ("1 tahun 6 bulan", "2 minggu 3 hari").
function duration(plain: string, at: Date): Date | null {
  const terms = TERMS.exec(plain)
  if (terms !== null) return shift(at, Number(terms[1]))
  // "+30" is thirty days on.
  const plus = /^\+ ?(\d+)$/.exec(plain)
  if (plus !== null) return shift(at, Number(plus[1]))

  let text = plain
  const behind = COUNT_BEHIND.test(text) || /^-/.test(text)
  text = text.replace(COUNT_BEHIND, "").replace(COUNT_AHEAD, "")
  text = text.replace(COUNT_LEAD, "").replace(/^-\s*/, "")

  let years = 0
  let months = 0
  let days = 0
  let working = 0
  let parts = 0
  const rest = text.replace(
    COUNT_PART,
    (
      _,
      n: string | undefined,
      unit: string | undefined,
      fraction: string | undefined,
      fractionUnit: string | undefined
    ) => {
      const u = unit ?? fractionUnit ?? ""
      const half = /setengah/.test(_)
      const amount =
        n !== undefined
          ? Number(n.replace(",", ".")) + (half ? 0.5 : 0)
          : fraction === "setengah"
            ? 0.5
            : 0.25
      parts++
      if (/^(?:hari kerja|hari efektif|working|workday|hk)/.test(u))
        working += amount
      else if (/^(?:hari|day)/.test(u)) days += amount
      else if (/^(?:minggu|pekan|week)/.test(u)) days += amount * 7
      else if (/^(?:bulan|month)/.test(u)) {
        months += Math.trunc(amount)
        days += (amount - Math.trunc(amount)) * 30
      } else {
        years += Math.trunc(amount)
        months += (amount - Math.trunc(amount)) * 12
      }
      return " "
    }
  )
  if (parts === 0 || rest.replace(/[\s,;]|\bdan\b|\band\b/g, "") !== "")
    return null
  if (working > 0 && (years > 0 || months > 0 || days > 0)) return null

  const sign = behind ? -1 : 1
  if (working > 0) return workdays(at, sign * Math.round(working))
  const wholeMonths = Math.trunc(months)
  const start = addMonths(at, sign * (years * 12 + wholeMonths))
  return shift(start, sign * Math.round(days + (months - wholeMonths) * 30))
}

function special(plain: string, reference: string): Found | null {
  const at = dateOf(reference)
  const found = (day: Date, yearGiven = true): Found => ({
    iso: isoOf(day),
    yearGiven,
  })
  let m: RegExpExecArray | null

  // "dalam 3 bulan", "30 hari", "2 minggu 3 hari lagi", "setengah tahun",
  // "net 30", "tempo 30 hari", "+7 hari", "3 bulan yang lalu".
  const counted = duration(plain, at)
  if (counted !== null) return found(counted)

  // Holidays on a fixed day, this year's unless a year follows.
  for (const [pattern, month, day] of FIXED_DAYS) {
    const named = /^(.+?)(?: (\d{4}))?$/.exec(plain)
    if (named !== null && pattern.test(named[1]))
      return found(
        new Date(
          named[2] === undefined ? at.getFullYear() : Number(named[2]),
          month,
          day
        ),
        named[2] !== undefined
      )
  }

  // The edges of a month or year: "akhir bulan", "awal tahun depan",
  // "pertengahan bulan", "end of month".
  if (
    (m =
      /^(akhir|awal|pertengahan|tengah|end of|start of|mid) (?:(next|this|last) )?(bulan|month|tahun|year)(?: (depan|ini|lalu))?$/.exec(
        plain
      ))
  ) {
    const edge =
      m[1] === "akhir" || m[1] === "end of"
        ? "end"
        : m[1] === "awal" || m[1] === "start of"
          ? "start"
          : "mid"
    const step = relative(m[2] ?? m[4] ?? "ini")
    if (m[3] === "tahun" || m[3] === "year") {
      const y = at.getFullYear() + step
      return found(
        edge === "end"
          ? new Date(y, 11, 31)
          : edge === "start"
            ? new Date(y, 0, 1)
            : new Date(y, 6, 1)
      )
    }
    const month = at.getMonth() + step
    return found(
      edge === "end"
        ? new Date(at.getFullYear(), month + 1, 0)
        : edge === "start"
          ? new Date(at.getFullYear(), month, 1)
          : new Date(at.getFullYear(), month, 15)
    )
  }
  // … and of a named month: "akhir oktober", "awal november 2027".
  if (
    (m = /^(akhir|awal|pertengahan|tengah|end of|start of|mid) (.+)$/.exec(
      plain
    ))
  ) {
    const ref = monthRef(at, m[2])
    if (ref !== null && !/^(?:ini|depan|lalu)$/.test(m[2])) {
      const [y, month, given] = ref
      const edge =
        m[1] === "akhir" || m[1] === "end of"
          ? "end"
          : m[1] === "awal" || m[1] === "start of"
            ? "start"
            : "mid"
      return found(
        edge === "end"
          ? new Date(y, month + 1, 0)
          : edge === "start"
            ? new Date(y, month, 1)
            : new Date(y, month, 15),
        given
      )
    }
  }

  // Quarters: "kuartal 1 2027", "q4", "akhir kuartal", "awal triwulan depan".
  if (
    (m = /^(?:(akhir|awal|end of|start of) )?(.+)$/.exec(plain)) &&
    QUARTER_WHOLE.test(m[2])
  ) {
    const q = QUARTER_WHOLE.exec(m[2])
    if (
      q !== null &&
      (m[1] !== undefined || q[1] !== undefined || q[2] !== undefined)
    ) {
      const [y, index] = quarterOf(at, q[1], q[2], q[3])
      const end = m[1] === "akhir" || m[1] === "end of"
      return found(
        end ? new Date(y, index * 3 + 3, 0) : new Date(y, index * 3, 1)
      )
    }
  }

  // The weekend, and the edges of a week.
  if (
    (m =
      /^(?:akhir pekan|akhir minggu|weekend|the weekend|wiken)(?: (ini|depan|lalu))?$/.exec(
        plain
      ))
  )
    return found(weekendOf(at, relative(m[1] ?? "ini")))
  if (
    (m =
      /^(awal|pertengahan|tengah|akhir|end of|start of|mid) (?:minggu|pekan|week)(?: (ini|depan|lalu))?$/.exec(
        plain
      ))
  ) {
    const start = weekStart(at, relative(m[2] ?? "ini"))
    return found(
      m[1] === "awal" || m[1] === "start of"
        ? start
        : m[1] === "akhir" || m[1] === "end of"
          ? shift(start, 4)
          : shift(start, 2)
    )
  }

  // A weekday of a named week: "senin minggu depan", "rabu pekan ini".
  if (
    (m = new RegExp(
      `^(${WEEKDAY_WORD}) (?:minggu|pekan) (depan|ini|lalu)$`
    ).exec(plain))
  ) {
    const index = weekdayOf(m[1])
    if (index !== null)
      return found(shift(weekStart(at, relative(m[2])), (index + 6) % 7))
  }

  // The nth weekday of a month: "kamis kedua oktober", "jumat terakhir bulan
  // ini", "senin pertama bulan depan".
  if (
    (m = new RegExp(
      `^(${WEEKDAY_WORD}) (pertama|kedua|ketiga|keempat|kelima|terakhir|first|second|third|fourth|fifth|last|ke-?\\d) (.+)$`
    ).exec(plain))
  ) {
    const index = weekdayOf(m[1])
    const n = ORDINALS[m[2]] ?? Number(m[2].replace(/\D/g, ""))
    const ref = monthRef(at, m[3])
    if (index !== null && ref !== null) {
      const day = nthWeekday(ref[0], ref[1], index, n)
      return day === null ? null : found(day, ref[2])
    }
  }

  // The first or last day of a month, and the first or last working day.
  if (
    (m =
      /^(?:hari )?(pertama|terakhir|first|last) (hari kerja |working day |workday )?(?:(?:di|pada) )?(.+)$/.exec(
        plain
      ))
  ) {
    const ref = monthRef(at, m[3])
    if (ref !== null) {
      const [y, month, given] = ref
      const first = m[1] === "pertama" || m[1] === "first"
      let day = first ? new Date(y, month, 1) : new Date(y, month + 1, 0)
      if (m[2] !== undefined)
        while (!isWorkday(day)) day = shift(day, first ? 1 : -1)
      return found(day, given)
    }
  }

  // Working days from today: "3 hari kerja lagi", "hari kerja berikutnya".
  if (
    (m =
      /^(\d+) hari (?:kerja|efektif) (?:lagi|dari sekarang|ke depan|kemudian|setelahnya)$/.exec(
        plain
      ))
  )
    return found(workdays(at, Number(m[1])))
  if (
    (m =
      /^(\d+) hari (?:kerja|efektif) (?:yang )?(?:lalu|lewat|sebelumnya)$/.exec(
        plain
      ))
  )
    return found(workdays(at, -Number(m[1])))
  if (
    /^hari (?:kerja|efektif) (?:berikutnya|depan|selanjutnya|besok)$/.test(
      plain
    )
  )
    return found(workdays(at, 1))
  if (/^hari (?:kerja|efektif) (?:sebelumnya|kemarin|lalu)$/.test(plain))
    return found(workdays(at, -1))

  return null
}

/// chrono, loaded when a day box first appears (`warmDayParser`, called from
/// the day fields' modules) rather than with the entry chunk: its English
/// parser is ~49 modules that a screen without a date box never needed, and
/// it used to ride into every URL open on this file. Until it has arrived the
/// typed-day reads that stay native — "15", "15/10", "akhir bulan", "30 hari
/// lagi" — keep working; only the guesses that are chrono's alone ("jumat",
/// "next fri", "natal") return nothing, and the import is on its way the
/// moment a day field is even rendered.
let en: typeof enModule | null = null
let enLoading: Promise<void> | null = null

export function warmDayParser(): void {
  if (en !== null || enLoading !== null) return
  enLoading = import("chrono-node/en")
    .then((module) => {
      en = module
    })
    .catch(() => undefined)
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
  if (en === null) return null
  const [result] = en.GB.parse(flipped, dateOf(reference))
  if (result === undefined) return null
  const start = result.start
  // A year chrono made up does not count as given; one it was told does, and
  // so does anything relative ("in 3 days"), whose year is not a guess.
  const relativeToday = !start.isCertain("day") || !start.isCertain("month")
  return {
    iso: isoOf(start.date()),
    yearGiven: relativeToday || start.isCertain("year"),
  }
}

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

/// How far a day is from today, in the words a buyer asks it: "tomorrow",
/// "in 61 days · 2 months", "12 days ago". Months are calendar months, so
/// "in 91 days · 3 months" on 2 Oct is 2 Jan, not 91 days rounded.
export function untilText(iso: string, reference: string): string {
  const from = dateOf(reference)
  const to = dateOf(iso)
  const days = Math.round((to.getTime() - from.getTime()) / 86_400_000)
  if (days === 0) return "today"
  if (days === 1) return "tomorrow"
  if (days === -1) return "yesterday"
  const [early, late] = days > 0 ? [from, to] : [to, from]
  let months =
    (late.getFullYear() - early.getFullYear()) * 12 +
    late.getMonth() -
    early.getMonth()
  if (addMonths(early, months) > late) months--
  const leftover = Math.round(
    (late.getTime() - addMonths(early, months).getTime()) / 86_400_000
  )
  const size = Math.abs(days)
  const unit = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`
  const years = Math.trunc(months / 12)
  const breakdown =
    months < 1
      ? ""
      : years >= 1
        ? [
            unit(years, "year"),
            months % 12 > 0 ? unit(months % 12, "month") : "",
          ]
            .filter(Boolean)
            .join(" ")
        : [unit(months, "month"), leftover > 0 ? unit(leftover, "day") : ""]
            .filter(Boolean)
            .join(" ")
  const base = days > 0 ? `in ${unit(size, "day")}` : `${unit(size, "day")} ago`
  return breakdown === "" ? base : `${base} · ${breakdown}`
}
