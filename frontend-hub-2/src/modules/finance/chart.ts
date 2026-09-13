/// The client's own chart, and the only arithmetic a finance screen is allowed
/// to do on it.
///
/// Everything here is about the PRESENTATION of figures the server already
/// computed. Nothing in this file adds two amounts together to produce a total
/// somebody reads as authoritative — totals come from the server, because a
/// page that sums its own visible rows reports a different answer while it is
/// still loading. See `lib/list.ts`.
///
/// It lives beside the screens rather than in `lib/` because none of it is
/// general: it is this client's eight root classes, their `{1,3,5,7,10,12}`
/// code ladder, and the sign convention the ledger stores figures in. A second
/// client would need a different file, not a parameter.

/// The eight root classes, in the client's own words.
///
/// Hard-coded rather than fetched: they are the spine of every report and have
/// not changed in the life of the chart. **Not translated**, and that is not an
/// exception to the English-copy rule — these are account NAMES, the same data
/// as `LedgerAccount.name`, and an accountant looking for "PENDAPATAN" would
/// not recognise "Revenue" as the same line in their own system.
///
/// Keyed by the digit, because that is what the wire sends: `root_class` is
/// `"1"`…`"8"` on `LedgerAccount`, on `TrialBalanceRow` and on
/// `StatementSection` alike.
export const ROOT_CLASSES: Readonly<Record<string, string>> = {
  "1": "ASSET",
  "2": "LIABILITIES",
  "3": "MODAL",
  "4": "PENDAPATAN",
  "5": "BIAYA / BEBAN POKOK",
  "6": "BIAYA / BEBAN USAHA",
  "7": "BEBAN USAHA LAINNYA",
  "8": "BEBAN NON OPERASIONAL",
}

/// The three classes a balance sheet is made of, and the five that are the
/// profit and loss. One list rather than a `<= "3"` test in four places.
export const BALANCE_SHEET_CLASSES: readonly string[] = ["1", "2", "3"]

/// Which side of the books a class sits on.
///
/// Assets and costs are debit-natured; liabilities, equity and income are
/// credit-natured. The server sends the raw signed figure — debits positive —
/// because a balance does not know whether it is about to be printed on a page
/// where liabilities read as positive numbers. A statement does know, so the
/// flip lives here. Doing it on the server would mean the same number came back
/// differently depending on which screen asked, which is how two reports end up
/// disagreeing about a figure they both got right.
export function isDebitNatured(rootClass: string): boolean {
  return rootClass === "1" || rootClass >= "5"
}

/// A ledger figure as a statement should read it.
///
/// `-0` is a real JavaScript value and `Intl` renders it as "-Rp 0", so the zero
/// case is returned unflipped rather than negated.
export function asPresented(amountMinor: number, rootClass: string): number {
  if (isDebitNatured(rootClass)) return amountMinor
  return amountMinor === 0 ? 0 : -amountMinor
}

/// The period's result, as a report prints it.
///
/// `Statement.result_minor` is classes 4 through 8 netted **in the ledger's own
/// signs: debits positive**. Income is credit-natured so it arrives negative;
/// costs are debit-natured and arrive positive. A month that spent 33 million
/// and earned nothing therefore comes back as `+33.409.475` — a POSITIVE number
/// for a loss. That is the right storage convention and the same one every other
/// figure on the wire uses, which is exactly why it must not be printed raw:
/// "Result for the period Rp 33.409.475" reads as a profit to everybody who has
/// ever seen a profit and loss.
///
/// So a report prints income less costs, which is the negation, and says which
/// of the two it is in words rather than leaving a minus sign to carry the whole
/// meaning.
export function periodResult(resultMinor: number): {
  /// Income less costs: a profit is positive, a loss negative.
  readonly minor: number
  readonly loss: boolean
  readonly label: string
} {
  const minor = resultMinor === 0 ? 0 : -resultMinor
  return {
    minor,
    loss: minor < 0,
    label: minor < 0 ? "Loss for the period" : "Profit for the period",
  }
}

/// The client's `{1,3,5,7,10,12}` ladder as an indent level.
///
/// `depth` on the wire is the code's own LENGTH, sent so a browser can indent
/// without measuring strings. Indenting by the raw number would step four times
/// between a heading and its child; indenting by the rung is what makes a report
/// look like their chart. Anything off the ladder sits at the top, which is the
/// safe way to be wrong about the handful of accounts that skip a rung.
const LADDER = [1, 3, 5, 7, 10, 12]

export function ladderLevel(depth: number): number {
  const rung = LADDER.indexOf(depth)
  return rung < 0 ? 0 : rung
}

/// `2026-09` — how a month is spelled in a URL and keyed in a list.
export function monthId(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`
}

/// "September 2026".
///
/// Built from a `Date` constructed with LOCAL parts, never parsed from a string:
/// `new Date("2026-09-01")` is midnight UTC, which west of Greenwich is August,
/// and a depreciation charge shown against the wrong month is the kind of
/// off-by-one that surfaces at a period close.
export function monthLabel(year: number, month: number): string {
  return new Date(year, month - 1, 1).toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
  })
}

/// A month the server named by its first day — `2026-08-01` — read as a month.
export function monthOf(iso: string | null | undefined): string {
  if (iso === null || iso === undefined || iso === "") return "—"
  const year = Number.parseInt(iso.slice(0, 4), 10)
  const month = Number.parseInt(iso.slice(5, 7), 10)
  if (!Number.isFinite(year) || !Number.isFinite(month)) return iso
  return monthLabel(year, month)
}

/// `YYYY-MM-DD` in the READER's timezone.
///
/// Not `toISOString().slice(0, 10)`: that is UTC, and in Jakarta it names
/// yesterday for the first seven hours of every day. `lib/format.ts`'s `today()`
/// has the same shape and the same caveat; this one takes a date, which is what
/// "the first of the month I am closing" needs.
export function isoDay(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${date.getFullYear()}-${month}-${day}`
}

/// The first and last day of one month, as the server spells a date.
///
/// `new Date(year, month, 0)` is the last day of `month` on a 1-based month
/// number. It is the one piece of date arithmetic in this module and it is
/// written once, here, rather than in each screen that needs a month's edges.
export function monthRange(
  year: number,
  month: number,
): { readonly first: string; readonly last: string } {
  return {
    first: isoDay(new Date(year, month - 1, 1)),
    last: isoDay(new Date(year, month, 0)),
  }
}
