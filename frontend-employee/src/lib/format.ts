/// How dates, times and money read on this surface.
///
/// One place rather than a `toLocaleString` at each call site: a payslip that
/// said `Rp 6.837.500` in one screen and `IDR 6,837,500.00` in the next would
/// look like two different numbers to the person being paid it.

/// Rupiah has no minor unit in practice — prices, payslips and this system's
/// own money types are all whole rupiah — so the fraction digits are forced to
/// zero rather than left to the locale, which would otherwise print `,00`.
const rupiah = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
})

export function money(amountIdr: number): string {
  return rupiah.format(amountIdr)
}

/// A plain date is parsed with an explicit midnight rather than handed to
/// `new Date("2026-09-01")`, which the language reads as UTC and so renders as
/// the day before for anybody east of Greenwich.
function atMidnight(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00`)
}

export function longDate(isoDate: string): string {
  return atMidnight(isoDate).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  })
}

export function shortDate(isoDate: string): string {
  return atMidnight(isoDate).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  })
}

export function weekday(isoDate: string): string {
  return atMidnight(isoDate).toLocaleDateString("en-GB", { weekday: "short" })
}

export function dayOfMonth(isoDate: string): string {
  return `${atMidnight(isoDate).getDate()}`
}

/// A range as one phrase, saying the month and year once.
///
/// `Tue 22 – Thu 24 Sept 2026`, not `22 Sept – Thu, 24 Sept 2026`: leave is
/// asked for in weekdays, and repeating the month between two days of the same
/// one makes the reader check whether it really is the same month.
export function dateRange(from: string, to: string): string {
  if (from === to) {
    return longDate(from)
  }
  const start = atMidnight(from)
  const end = atMidnight(to)
  const tail = end.toLocaleDateString("en-GB", {
    month: "short",
    year: "numeric",
  })
  if (
    start.getFullYear() === end.getFullYear() &&
    start.getMonth() === end.getMonth()
  ) {
    return `${weekday(from)} ${start.getDate()} – ${weekday(to)} ${end.getDate()} ${tail}`
  }
  return `${shortDate(from)} – ${longDate(to)}`
}

export function clockTime(instant: string | null): string {
  if (instant === null) {
    return "—"
  }
  return new Date(instant).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  })
}

export function dateTime(instant: string): string {
  return new Date(instant).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  })
}

/// Minutes as hours and minutes, because a shift is read as `9h 12m` and never
/// as 552.
export function duration(minutes: number): string {
  if (minutes <= 0) {
    return "—"
  }
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours === 0) {
    return `${rest}m`
  }
  if (rest === 0) {
    return `${hours}h`
  }
  return `${hours}h ${rest}m`
}

/// "in 3 days", "yesterday" — the phrasing people actually use about a shift
/// or a decision they are waiting on.
export function relativeDay(isoDate: string): string {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const days = Math.round(
    (atMidnight(isoDate).getTime() - today.getTime()) / 86_400_000
  )
  if (days === 0) {
    return "today"
  }
  if (days === 1) {
    return "tomorrow"
  }
  if (days === -1) {
    return "yesterday"
  }
  if (days > 0) {
    return `in ${days} days`
  }
  return `${Math.abs(days)} days ago`
}

/// Whether a date is today or still to come.
///
/// It reads the clock, which is why it lives here rather than in a component
/// body: a render that happens to cross midnight and drops yesterday's holiday
/// off the top is right, not surprising, but the linter cannot know that and
/// is correct to stop it being written inline.
export function isUpcoming(isoDate: string): boolean {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return atMidnight(isoDate).getTime() >= today.getTime()
}
