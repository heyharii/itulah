/// The client's own chart, and the small amount of arithmetic a finance screen
/// is allowed to do on it.
///
/// Everything here is about *presentation* of figures the server already
/// computed. Nothing in this file adds two amounts together to produce a total
/// somebody reads as authoritative — totals come from the server, because a
/// page that sums its own visible rows reports a different answer while it is
/// still loading.

/// The eight root classes, in the client's own words.
///
/// Hard-coded rather than fetched: they are the spine of every report and have
/// not changed in the life of the chart. The names are theirs, including the
/// double space in "BIAYA / BEBAN  USAHA" — matching what they see in their own
/// system matters more than tidiness here.
export const ROOT_CLASSES: Readonly<Record<string, string>> = {
  "1": "ASSET",
  "2": "LIABILITIES",
  "3": "MODAL",
  "4": "PENDAPATAN",
  "5": "BIAYA / BEBAN POKOK",
  "6": "BIAYA / BEBAN  USAHA",
  "7": "BEBAN USAHA LAINNYA",
  "8": "BEBAN  NON OPERASIONAL",
}

/// Which side of the books a class sits on.
///
/// Assets and expenses are debit-natured; liabilities, equity and income are
/// credit-natured. The server sends the raw signed figure — debits positive —
/// because a balance does not know whether it is about to be printed on a page
/// where liabilities read as positive numbers. A statement does know, so the
/// flip lives here. Doing it on the server would mean the same number came
/// back differently depending on which screen asked, which is how two reports
/// end up disagreeing about a figure they both got right.
export function isDebitNatured(rootClass: string): boolean {
  return rootClass === "1" || rootClass >= "5"
}

/// A ledger figure as a statement should read it.
///
/// `-0` is a real JavaScript value and `Intl` renders it as "-Rp 0", so the
/// zero case is returned unflipped rather than negated.
export function asPresented(amountMinor: number, rootClass: string): number {
  if (isDebitNatured(rootClass)) return amountMinor
  return amountMinor === 0 ? 0 : -amountMinor
}

/// The client's `{1,3,5,7,10,12}` ladder as an indent level.
///
/// `depth` on the wire is the code's own length, sent so a browser can indent
/// without measuring strings. Indenting by the raw number would step four
/// times between a heading and its child; indenting by the rung is what makes
/// the report look like their chart. Anything off the ladder sits at the top,
/// which is the safe way to be wrong about six accounts that skip a rung.
const LADDER = [1, 3, 5, 7, 10, 12]

export function ladderLevel(depth: number): number {
  const rung = LADDER.indexOf(depth)
  return rung < 0 ? 0 : rung
}

/// `YYYY-MM-DD` in the reader's own timezone.
///
/// Not `toISOString().slice(0, 10)`: that is UTC, and in Jakarta it names
/// yesterday for the first seven hours of every day. A posting date that is
/// silently off by one is the kind of error that surfaces at a period close.
export function isoDay(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${date.getFullYear()}-${month}-${day}`
}

export function todayIso(): string {
  return isoDay(new Date())
}

/// "September 2026", in the client's locale.
export function monthLabel(year: number, month: number): string {
  return new Date(year, month - 1, 1).toLocaleDateString("id-ID", {
    month: "long",
    year: "numeric",
  })
}

/// A typed figure as integer minor units, or `null` when it is not a number.
///
/// Everything but digits and a leading minus is dropped, so "1.250.000",
/// "1,250,000" and "Rp 1250000" all mean the same amount. Deliberately
/// `parseInt` on a cleaned string and never `parseFloat`: IDR has no minor
/// unit in practice, and the one thing this app must never do is let a
/// fractional rupiah into a posting.
export function parseMinor(text: string): number | null {
  const cleaned = text.trim().replace(/[^\d-]/g, "")
  if (cleaned === "" || cleaned === "-") return null
  const value = Number.parseInt(cleaned, 10)
  return Number.isSafeInteger(value) ? value : null
}

/// The seven asset families the client keeps under `10215`.
///
/// Hard-coded because it is their own list and it has not changed in the life
/// of the chart. The register still resolves each code against
/// `ledger_account`, so a wrong one here is a 400 and not a silently mis-filed
/// asset.
export const ASSET_CATEGORIES: readonly { code: string; name: string }[] = [
  { code: "1021501", name: "Tanah" },
  { code: "1021502", name: "Bangunan" },
  { code: "1021503", name: "Instalasi" },
  { code: "1021504", name: "Machineries" },
  { code: "1021505", name: "Kendaraan" },
  { code: "1021506", name: "Furniture, Fixture & Equipment" },
  { code: "1021507", name: "Operating Equipment" },
]

/// How an asset loses value, in the client's own terms — the labels are the
/// words on their own schedules, not a translation of the enum.
export const DEPRECIATION_METHODS: readonly {
  value: string
  label: string
}[] = [
  { value: "STRAIGHT_LINE", label: "Garis Lurus" },
  { value: "DECLINING", label: "Saldo Menurun" },
  { value: "NONE", label: "Tidak Disusutkan" },
]

/// One bank line pasted out of a statement.
///
/// Banks here export CSV and nothing else, so the import takes a paste rather
/// than a file: `value_date, description, reference, debit, credit`. A row that
/// cannot be read is reported with its line number instead of being skipped —
/// an import that quietly drops the one line somebody was looking for is worse
/// than one that refuses.
export interface ParsedStatementLine {
  readonly value_date: string
  readonly description: string
  readonly reference: string | null
  readonly debit_minor: number
  readonly credit_minor: number
}

export interface ParsedStatement {
  readonly lines: readonly ParsedStatementLine[]
  readonly problems: readonly string[]
}

export function parseStatementPaste(text: string): ParsedStatement {
  const lines: ParsedStatementLine[] = []
  const problems: string[] = []
  const rows = text.split(/\r?\n/)
  for (let index = 0; index < rows.length; index += 1) {
    const raw = rows[index].trim()
    if (raw === "") continue
    const cells = raw.split(/[\t,;]/).map((cell) => cell.trim())
    if (cells.length < 5) {
      problems.push(
        `Line ${index + 1}: expected five columns, found ${cells.length}.`
      )
      continue
    }
    const [valueDate, description, reference, debit, credit] = cells
    if (!/^\d{4}-\d{2}-\d{2}$/.test(valueDate)) {
      problems.push(
        `Line ${index + 1}: "${valueDate}" is not a YYYY-MM-DD date.`
      )
      continue
    }
    const debitMinor = debit === "" ? 0 : parseMinor(debit)
    const creditMinor = credit === "" ? 0 : parseMinor(credit)
    if (debitMinor === null || creditMinor === null) {
      problems.push(`Line ${index + 1}: the debit or credit is not a number.`)
      continue
    }
    lines.push({
      value_date: valueDate,
      description,
      reference: reference === "" ? null : reference,
      debit_minor: debitMinor,
      credit_minor: creditMinor,
    })
  }
  return { lines, problems }
}
