import type { Tag } from "@/kit/tag"

/// What the server's enums are CALLED on screen, and what colour they carry.
///
/// A file of its own because five screens read the same four or five
/// vocabularies, and a switch copied into five files is five places that drift
/// the day somebody adds a state. It holds no JSX on purpose: everything here
/// is a pure function of a string, which is what makes it readable from a
/// column definition, a sheet and a summary line without any of them importing
/// a component.
///
/// ## The words are the FINDING, not the enum
///
/// `AWAITING_CONSENT` is what the database calls it; "Waiting on their answer"
/// is what a manager would say out loud, and it is what the row is being
/// pointed at for. Printing the enum makes every reader translate a piece of
/// our schema in their head, forever, on every row.

/// The tones `kit/tag.tsx` offers, read off the component so the two cannot
/// drift apart.
export type Tone = NonNullable<React.ComponentProps<typeof Tag>["tone"]>

// ── employment ─────────────────────────────────────────────────────────────

export function statusLabel(status: string): string {
  switch (status) {
    case "CANDIDATE":
      return "Accepted, not started"
    case "ACTIVE":
      return "Working"
    case "SUSPENDED":
      return "Suspended"
    case "TERMINATED":
      return "Left"
    default:
      return status
  }
}

/// `CANDIDATE` is `info`, which this language reserves for *in motion*:
/// somebody taken on and not yet started is exactly that — a normal state for a
/// fortnight and an alarming one for a year.
///
/// `TERMINATED` is neutral rather than `bad`. A person leaving is not a fault,
/// and colouring it red makes a directory look like a list of incidents.
export function statusTone(status: string): Tone {
  switch (status) {
    case "ACTIVE":
      return "ok"
    case "CANDIDATE":
      return "info"
    case "SUSPENDED":
      return "warn"
    default:
      return "neutral"
  }
}

/// Whole days from one calendar date to another, or `null` when there is no
/// date.
///
/// Computed on the two DATES rather than on the instants behind them, so a term
/// ending tomorrow reads as 1 whichever side of midday somebody is looking. The
/// parts are split out of the string rather than handed to `new Date`, for the
/// reason `lib/format.ts` gives at length: `new Date("2026-09-09")` is midnight
/// UTC and renders as the 8th west of Greenwich.
export function daysBetween(
  from: string,
  to: string | null | undefined,
): number | null {
  const a = utcOf(from)
  const b = utcOf(to)
  if (a === null || b === null) return null
  return Math.round((b - a) / 86_400_000)
}

function utcOf(iso: string | null | undefined): number | null {
  if (!iso) return null
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number)
  if (!y || !m || !d) return null
  return Date.UTC(y, m - 1, d)
}

// ── leave ──────────────────────────────────────────────────────────────────

export function leaveStateLabel(state: string): string {
  switch (state) {
    case "PENDING":
      return "Waiting on a decision"
    case "APPROVED":
      return "Approved"
    case "REJECTED":
      return "Refused"
    case "WITHDRAWN":
      return "Taken back"
    default:
      return state
  }
}

/// Centidays as days.
///
/// `LeaveBalanceRow.centidays` is hundredths of a day, which is what the ledger
/// holds — and the division happens HERE, at the last moment before drawing,
/// for the same reason money is never divided before it is summed. A client
/// that converted on arrival and added the results up would disagree with the
/// ledger by a rounding error nobody can find.
///
/// Two decimals at most, and none when the figure is whole: "12 days" rather
/// than "12,00 days", because a leave balance is a number people say out loud.
export function days(centidays: number): string {
  return new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 }).format(
    centidays / 100,
  )
}

// ── overtime ───────────────────────────────────────────────────────────────

export function overtimeStateLabel(state: string): string {
  switch (state) {
    case "AWAITING_CONSENT":
      return "Waiting on their answer"
    case "AGREED":
      return "Agreed"
    case "DECLINED":
      return "Refused"
    case "WITHDRAWN":
      return "Taken back"
    default:
      return state
  }
}

/// Which statutory table applies, said as a person would.
///
/// Kepmenaker 102/2004 has one schedule for ordinary days and another for rest
/// days and public holidays. This is never a rate — the server does not send
/// one and nothing on this surface computes one.
export function dayKindLabel(kind: string): string {
  switch (kind) {
    case "WORKING":
      return "Working day"
    case "REST":
      return "Rest day"
    case "HOLIDAY":
      return "Public holiday"
    default:
      return kind
  }
}

/// Minutes as a duration rather than as a number.
///
/// "90 minutes" is something to convert; "1h 30m" is something to read.
export function minutes(count: number): string {
  if (count === 0) return "none"
  const hours = Math.floor(count / 60)
  const rest = count % 60
  if (hours === 0) return `${rest}m`
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`
}

// ── payroll ────────────────────────────────────────────────────────────────

/// A run's state as the sentence it actually is. `VERIFIED` is the one worth
/// spelling out: it does not mean finished, it means one of the two signatures
/// is on it and the run is waiting for somebody else to be the second.
export function runStateLabel(state: string): string {
  switch (state) {
    case "DRAFT":
      return "Waiting to be checked"
    case "VERIFIED":
      return "Checked, waiting on a second signature"
    case "APPROVED":
      return "Approved"
    case "SEALED":
      return "Sealed"
    default:
      return state
  }
}

export function runStateTone(state: string): Tone {
  switch (state) {
    case "SEALED":
      return "ok"
    case "APPROVED":
      return "info"
    default:
      return "warn"
  }
}

// ── the roster ─────────────────────────────────────────────────────────────

/// What a planned day IS, said as a rota says it.
///
/// `SCHEDULED` is deliberately not drawn as a word in the grid: a scheduled day
/// shows the NAME of the shift it was scheduled for, because "Scheduled" is the
/// one thing every filled cell would say and the shift is what somebody is
/// looking for. This covers the other two, and the sheet where the word is the
/// right answer.
export function planLabel(plan: string): string {
  switch (plan) {
    case "REST_DAY":
      return "Rest"
    case "PUBLIC_HOLIDAY":
      return "Holiday"
    case "SCHEDULED":
      return "Scheduled"
    default:
      return plan
  }
}

/// `HH:MM–HH:MM`, the wall-clock span a rota is read off.
///
/// Passed through rather than reformatted. The server sends the hours the rota
/// is written in, and converting them to anything else here would be a second
/// spelling of a time that is printed on a wall.
export function span(
  starts: string | null,
  ends: string | null,
  crossesMidnight: boolean,
): string {
  if (starts === null || ends === null) return "—"
  return `${starts}–${ends}${crossesMidnight ? " (+1)" : ""}`
}

// ── leave rules ────────────────────────────────────────────────────────────

/// What a kind of leave DRAWS ON, which is the first thing about it.
///
/// One balance with a label beside it is the obvious model and it is wrong for
/// most of Indonesian leave law, in the direction that takes days off people.
/// Sick leave is deducted from nothing — UU 13/2003 art. 93 obliges the
/// employer to keep paying a certified ill worker — and leave for an important
/// reason is bounded per occurrence, not per year, and does not accumulate.
export function backingLabel(backing: string): string {
  switch (backing) {
    case "BALANCE":
      return "From a balance"
    case "PER_OCCURRENCE":
      return "Per occurrence"
    case "AS_CERTIFIED":
      return "As certified"
    default:
      return backing
  }
}

/// What the employer pays for a day of it.
///
/// `STATUTORY_SCALE` is the one worth spelling out: art. 93(2) sets a
/// descending percentage over the months of a long illness, and it is neither
/// full pay nor no pay.
export function paymentLabel(payment: string): string {
  switch (payment) {
    case "FULL":
      return "Full pay"
    case "UNPAID":
      return "Unpaid"
    case "STATUTORY_SCALE":
      return "Statutory scale"
    default:
      return payment
  }
}

export function accrualLabel(accrual: string): string {
  switch (accrual) {
    case "UP_FRONT":
      return "All at once"
    case "MONTHLY":
      return "A twelfth a month"
    default:
      return accrual
  }
}

export function carryForwardLabel(rule: string): string {
  switch (rule) {
    case "FORBIDDEN":
      return "Not carried forward"
    case "CAPPED":
      return "Carried forward, capped"
    default:
      return rule
  }
}

// ── holidays ───────────────────────────────────────────────────────────────

/// A red day's kind — and the only one of the three that costs somebody days.
///
/// Cuti bersama is charged against the employee's annual leave by the same
/// joint decree that announces it: the company closes and the days come out of
/// the twelve. Filing it and a national holiday both as "a red day" is how a
/// leave balance ends up wrong by exactly the number of long weekends in the
/// year.
export function holidayKindLabel(kind: string): string {
  switch (kind) {
    case "NATIONAL":
      return "National"
    case "CUTI_BERSAMA":
      return "Cuti bersama"
    case "REGIONAL":
      return "Regional"
    default:
      return kind
  }
}

/// Amber on the one that costs somebody days off their own balance. The other
/// two are simply days the company is shut.
export function holidayKindTone(kind: string): Tone {
  switch (kind) {
    case "CUTI_BERSAMA":
      return "warn"
    case "REGIONAL":
      return "info"
    default:
      return "neutral"
  }
}

// ── calendar arithmetic ────────────────────────────────────────────────────
//
// All of it on the date PARTS, never through `new Date(iso)`. A plain
// `new Date("2026-09-07")` is midnight UTC and is the 6th west of Greenwich —
// which on a roster would draw last week and label it this one. `lib/format.ts`
// gives the reasoning at length for printing; this is the same rule applied to
// arithmetic, where getting it wrong is silent rather than visible.

/// The Monday of the week a date falls in.
///
/// The statutory working week is a week, not a rolling seven days, and a rota
/// is read the same way — so the grid always starts on a Monday however the URL
/// was arrived at. `getUTCDay()` is 0 on Sunday, so a Sunday steps BACK six
/// rather than forward one: Sunday belongs to the week that is ending.
export function mondayOf(iso: string): string {
  const utc = utcOf(iso)
  if (utc === null) return iso
  const back = (new Date(utc).getUTCDay() + 6) % 7
  return isoOf(utc - back * 86_400_000)
}

/// `iso` moved by whole days, still as `YYYY-MM-DD`.
export function addDays(iso: string, days: number): string {
  const utc = utcOf(iso)
  if (utc === null) return iso
  return isoOf(utc + days * 86_400_000)
}

/// The month a date falls in, as the server spells a period: `YYYY-MM`.
export function monthOf(iso: string): string {
  return iso.slice(0, 7)
}

/// `YYYY-MM` moved by whole months.
///
/// Through `Date.UTC` with a month index that may fall outside 0–11, which it
/// normalises. Arithmetic on the number itself gets December wrong.
export function addMonths(value: string, months: number): string {
  const [y, m] = value.slice(0, 7).split("-").map(Number)
  if (!y || !m) return value
  return isoOf(Date.UTC(y, m - 1 + months, 1)).slice(0, 7)
}

const LONG_MONTHS = [
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
]

/// A period as a person says it: `September 2026`.
export function period(value: string): string {
  const [y, m] = value.slice(0, 7).split("-").map(Number)
  if (!y || !m || m < 1 || m > 12) return value
  return `${LONG_MONTHS[m - 1]} ${y}`
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

/// The weekday a date falls on, three letters.
export function weekday(iso: string): string {
  const utc = utcOf(iso)
  if (utc === null) return ""
  return WEEKDAYS[(new Date(utc).getUTCDay() + 6) % 7]
}

/// `9 Sep` — a date without its year, for a column heading that already carries
/// the year in the week it names. Seven of these across a grid is a lot of
/// repeated `2026`.
const SHORT_MONTHS = [
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
]

export function dayInMonth(iso: string): string {
  const [, m, d] = iso.slice(0, 10).split("-").map(Number)
  if (!m || !d || m < 1 || m > 12) return iso
  return `${d} ${SHORT_MONTHS[m - 1]}`
}

// `utcOf` is the one above, shared with `daysBetween` — the arithmetic here and
// the day count there have to read a date the same way or a term that ends on
// the Monday and a roster that starts on it would disagree about which day that
// is.

function isoOf(utc: number): string {
  return new Date(utc).toISOString().slice(0, 10)
}
