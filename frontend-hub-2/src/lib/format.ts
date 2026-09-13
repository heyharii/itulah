/// Formatting, in one place.
///
/// ## Money never becomes a float
///
/// Money crosses the wire in minor units as an integer and stays that way
/// until the moment it is drawn. Sum in minor units; format at the very end. A
/// client that converts before summing is a client whose totals disagree with
/// the ledger's by a rounding error nobody can find.
///
/// ## The server's "minor" is already whole rupiah
///
/// **Do not divide by 100.** IDR has no minor unit in practice, so the
/// backend's `*_minor` fields are whole rupiah despite the name. This is
/// written down because it has already been got wrong once, in this file, on
/// 2026-09-10: `per_books_minor: 491574000` is Rp 491.574.000, and a `/100`
/// rendered it as Rp 4.915.740 — every figure on a finance screen understated
/// a hundredfold, with nothing about the page looking broken.
///
/// ## Numbers stay Indonesian while the interface is English
///
/// `id-ID` grouping — `1.842.350.000`, dots — is not a translation choice. It
/// is how the figure appears on the client's own statements and in their own
/// reports, and a screen that regrouped it as `1,842,350,000` would be asking
/// a bookkeeper to re-read every number to check it is the same one.

const RUPIAH = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
})

const PLAIN = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 })

/// `Rp 491.574.000`.
export function rp(minor: number | null | undefined): string {
  if (minor === null || minor === undefined) return "—"
  return RUPIAH.format(minor)
}

/// The same figure without the unit, for a column whose heading has already
/// said `Rp` — repeating it on forty rows is forty words of nothing.
export function amount(minor: number | null | undefined): string {
  if (minor === null || minor === undefined) return "—"
  return PLAIN.format(minor)
}

export function count(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—"
  return PLAIN.format(value)
}

/// Written out rather than taken from `Intl`.
///
/// `Intl` with `month: "short"` is not stable across locales or ICU versions —
/// `en-GB` gives "Sept" for September on current runtimes and "Sep" on older
/// ones, so a date in a table changes width depending on the browser. Three
/// letters, always, is what a column of dates needs.
const MONTHS = [
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

/// `9 Sep 2026` from an ISO date.
///
/// Split rather than parsed through `Date`. A plain `new Date("2026-09-09")` is
/// midnight UTC, which west of Greenwich renders as the 8th — so a date the
/// server called the 9th would appear as the day before, and only for some
/// users. There is no timezone in a reporting date to get wrong here.
export function day(iso: string | null | undefined): string {
  if (!iso) return "—"
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number)
  if (!y || !m || !d || m < 1 || m > 12) return iso ?? "—"
  return `${d} ${MONTHS[m - 1]} ${y}`
}

/// Today, as the server spells a date.
export function today(): string {
  return new Date().toISOString().slice(0, 10)
}
