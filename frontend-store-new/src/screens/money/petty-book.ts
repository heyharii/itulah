import { dateText } from "@/lib/format"
import type {
  ExpenseWindow,
  PettyCashTopUpView,
  StoreExpenseView,
} from "@itulah/contract"

/// The petty cash book, as a person keeps it: BKM in, BKK out, each a voucher
/// with a number and lines.
///
/// **The node has no voucher.** It holds expenses (out) and top-ups (in), one
/// record each, with no number, no date but the instant it was saved, and no
/// reference or note on an expense. This file is the whole of what the screen
/// makes up to bridge that, in one place so it can be deleted the day the node
/// grows a voucher:
///
///   - a voucher is the records one person saved in one press — same kind, same
///     person, same payee (same reference for a BKM), within `SAME_PRESS_MS`;
///   - its number is the order it was saved in, among that kind's vouchers of
///     its month: `BKK/<site>/<yymm>/<nnnn>`;
///   - a BKK's reference and note travel inside its first line's `reason`
///     (`reasonOf` / `readReason`), where head office can read them.

export type VoucherKind = "BKM" | "BKK"

/// What a line is filed under. `saves` is whether the node can take it today.
export interface LineKind {
  readonly code: string
  readonly word: string
  readonly saves: boolean
}

/// The nine kinds of cost, said in words a shop uses.
///
/// The codes are the centre's — `expense_transport` resolves to an account
/// through the posting rule — and the words are for the person holding the
/// receipt. The node's own table refuses any other code.
const EXPENSE_KINDS: readonly LineKind[] = [
  { code: "expense_household", word: "Household & dues", saves: true },
  { code: "expense_stationery", word: "Stationery", saves: true },
  { code: "expense_transport", word: "Transport & parking", saves: true },
  { code: "expense_electricity", word: "Electricity", saves: true },
  { code: "expense_water", word: "Water", saves: true },
  { code: "expense_telephone", word: "Telephone & internet", saves: true },
  { code: "expense_repairs", word: "Repairs", saves: true },
  { code: "expense_cleaning", word: "Cleaning", saves: true },
  { code: "expense_misc", word: "Something else", saves: true },
]

/// The account each line of a voucher is filed under. A BKM can only be a top-up
/// from head office today (`petty_cash_top_up`), and a BKK only one of the nine
/// costs; the rest of the prototype's list is shown and not yet pressable.
export const KINDS: Readonly<Record<VoucherKind, readonly LineKind[]>> = {
  BKM: [
    { code: "topup", word: "Top up from HO", saves: true },
    { code: "scrap", word: "Used cardboard sold", saves: false },
    { code: "loanback", word: "Staff repays a loan", saves: false },
    { code: "in_misc", word: "Something else", saves: false },
  ],
  BKK: [...EXPENSE_KINDS, { code: "loan", word: "Staff loan", saves: false }],
}

export function kindWord(kind: VoucherKind, code: string): string {
  return KINDS[kind].find((one) => one.code === code)?.word ?? code
}

/// The same accounts as the printed paper says them — head office's own names
/// (migration 0465), since the paper is read by Finance.
const WORDS_ID: Readonly<Record<string, string>> = {
  topup: "Tambahan kas kecil dari kantor pusat",
  scrap: "Penjualan kardus bekas",
  loanback: "Pengembalian pinjaman karyawan",
  in_misc: "Penerimaan lain-lain",
  expense_household: "Rumah tangga",
  expense_stationery: "Alat tulis kantor",
  expense_transport: "Transport lokal",
  expense_electricity: "Listrik",
  expense_water: "Air (PDAM)",
  expense_telephone: "Telepon & internet",
  expense_repairs: "Perbaikan & perawatan",
  expense_cleaning: "Kebersihan",
  expense_misc: "Lain-lain",
  loan: "Pinjaman karyawan",
}

export function kindWordId(code: string): string {
  return WORDS_ID[code] ?? code
}

export const BKM_FIRST_KIND = "topup"
export const BKK_FIRST_KIND = "expense_household"

// ── Reference and note, inside a reason ────────────────────────────────────

/// A line's note with the voucher's reference and note after it, the way head
/// office will read it: `Galon 4 pcs · Ref N-0231 · Note Weekly`.
export function reasonOf(
  what: string,
  extra?: { readonly reference?: string; readonly note?: string },
): string {
  let out = what.trim()
  const reference = extra?.reference?.trim() ?? ""
  const note = extra?.note?.trim() ?? ""
  if (reference !== "") out += ` · Ref ${reference}`
  if (note !== "") out += ` · Note ${note}`
  return out
}

/// `reasonOf` taken apart again. A reason with neither marker is all "what".
export function readReason(reason: string): {
  what: string
  reference: string
  note: string
} {
  const found = /^([\s\S]*?)(?: · Ref ([\s\S]*?))?(?: · Note ([\s\S]*))?$/.exec(
    reason,
  )
  return {
    what: (found?.[1] ?? reason).trim(),
    reference: (found?.[2] ?? "").trim(),
    note: (found?.[3] ?? "").trim(),
  }
}

// ── Vouchers, out of the node's records ────────────────────────────────────

export interface VoucherLine {
  readonly id: string
  readonly code: string
  readonly word: string
  readonly note: string
  readonly amountMinor: number
}

export interface Voucher {
  /// The first record's id — what a receipt photo is kept under.
  readonly id: string
  readonly kind: VoucherKind
  readonly no: string
  readonly at: string
  readonly party: string
  readonly reference: string
  readonly note: string
  /// The login that saved it.
  readonly by: string
  /// A BKM: the second person who counted the float with them.
  readonly countedWith: string | null
  /// A BKK above the line: Finance's code, and who issued it.
  readonly approval: {
    readonly code: string
    readonly by: string | null
  } | null
  readonly lines: readonly VoucherLine[]
  readonly totalMinor: number
}

/// A voucher with the tin as it stood right after it.
export interface BookRow {
  readonly voucher: Voucher
  readonly balanceMinor: number
}

/// Records closer together than this, from one person to one payee, are one
/// voucher. A press saves its lines one after the other in well under a second.
const SAME_PRESS_MS = 10_000

interface Rec {
  readonly kind: VoucherKind
  readonly id: string
  readonly at: string
  readonly ms: number
  readonly by: string
  /// What makes two records one voucher: the payee, or a BKM's reference.
  readonly party: string
  readonly reference: string
  readonly note: string
  readonly countedWith: string | null
  readonly approval: {
    readonly code: string
    readonly by: string | null
  } | null
  readonly line: VoucherLine
}

function fromExpense(row: StoreExpenseView): Rec {
  const reason = readReason(row.reason)
  return {
    kind: "BKK",
    id: row.id,
    at: row.spent_at,
    ms: Date.parse(row.spent_at),
    by: row.claimed_by,
    party: row.payee,
    reference: reason.reference,
    note: reason.note,
    countedWith: null,
    approval:
      row.approval_code === null
        ? null
        : { code: row.approval_code, by: row.approved_by },
    line: {
      id: row.id,
      code: row.category,
      word: kindWord("BKK", row.category),
      note: reason.what,
      amountMinor: row.amount_minor,
    },
  }
}

function fromTopUp(row: PettyCashTopUpView): Rec {
  const note = readReason(row.note ?? "")
  return {
    kind: "BKM",
    id: row.id,
    at: row.received_at,
    ms: Date.parse(row.received_at),
    by: row.received_by,
    party: row.reference ?? "",
    reference: row.reference ?? "",
    note: note.note,
    countedWith: row.approved_by,
    approval: null,
    line: {
      id: row.id,
      code: BKM_FIRST_KIND,
      word: kindWord("BKM", BKM_FIRST_KIND),
      note: note.what,
      amountMinor: row.amount_minor,
    },
  }
}

/// `2610` for any day in October 2026, in the shop's own calendar.
function monthCode(ms: number): string {
  const when = new Date(ms)
  const year = String(when.getFullYear() % 100).padStart(2, "0")
  const month = String(when.getMonth() + 1).padStart(2, "0")
  return `${year}${month}`
}

/// The vouchers in a window, newest first, numbered.
///
/// `site` is the shop's code as it goes on the number. Numbering counts from
/// the first voucher the window holds in a month, so the window has to start on
/// the first of a month to number that month the way the shop did.
export function vouchersOf(window: ExpenseWindow, site: string): Voucher[] {
  const records = [
    ...window.expenses.map(fromExpense),
    ...window.top_ups.map(fromTopUp),
  ].sort((a, b) => a.ms - b.ms || a.id.localeCompare(b.id))

  interface Draft {
    readonly first: Rec
    lastMs: number
    lines: VoucherLine[]
    approval: Rec["approval"]
  }
  const drafts: Draft[] = []
  const open: Partial<Record<VoucherKind, Draft>> = {}
  for (const rec of records) {
    const held = open[rec.kind]
    if (
      held !== undefined &&
      held.first.by === rec.by &&
      held.first.party === rec.party &&
      rec.ms - held.lastMs <= SAME_PRESS_MS
    ) {
      held.lines.push(rec.line)
      held.lastMs = rec.ms
      held.approval ??= rec.approval
    } else {
      const next: Draft = {
        first: rec,
        lastMs: rec.ms,
        lines: [rec.line],
        approval: rec.approval,
      }
      drafts.push(next)
      open[rec.kind] = next
    }
  }

  const counters = new Map<string, number>()
  const out = drafts.map((draft): Voucher => {
    const { first } = draft
    const month = monthCode(first.ms)
    const slot = `${first.kind}/${month}`
    const n = (counters.get(slot) ?? 0) + 1
    counters.set(slot, n)
    return {
      id: first.id,
      kind: first.kind,
      no: `${first.kind}/${site}/${month}/${String(n).padStart(4, "0")}`,
      at: first.at,
      party: first.kind === "BKM" ? "Head office" : first.party,
      reference: first.reference,
      note: first.note,
      by: first.by,
      countedWith: first.countedWith,
      approval: draft.approval,
      lines: draft.lines,
      totalMinor: draft.lines.reduce((sum, line) => sum + line.amountMinor, 0),
    }
  })
  return out.sort(
    (a, b) => Date.parse(b.at) - Date.parse(a.at) || b.id.localeCompare(a.id),
  )
}

/// The number the next voucher of a kind will carry: the one after the last of
/// its month. Only a guess for the page that shows it before saving — the
/// number a voucher is known by is the order it ends up in.
export function nextNo(
  vouchers: readonly Voucher[],
  kind: VoucherKind,
  site: string,
  now: Date,
): string {
  const month = monthCode(now.getTime())
  const taken = vouchers.filter(
    (one) => one.kind === kind && monthCode(Date.parse(one.at)) === month,
  ).length
  return `${kind}/${site}/${month}/${String(taken + 1).padStart(4, "0")}`
}

/// What a voucher did to the tin: money in is plus, money out minus.
export function effectOf(voucher: Voucher): number {
  return voucher.kind === "BKM" ? voucher.totalMinor : -voucher.totalMinor
}

/// The book with a running balance: the newest voucher stands on the tin as it
/// is now, and each older one on what was left after undoing the one above it.
export function bookOf(
  vouchers: readonly Voucher[],
  balanceNow: number,
): BookRow[] {
  let balance = balanceNow
  return vouchers.map((voucher) => {
    const row = { voucher, balanceMinor: balance }
    balance -= effectOf(voucher)
    return row
  })
}

/// The month so far, for the Debit and Credit figures.
export function monthOf(
  vouchers: readonly Voucher[],
  now: Date,
): {
  readonly into: { readonly minor: number; readonly count: number }
  readonly out: { readonly minor: number; readonly count: number }
  readonly name: string
} {
  const code = monthCode(now.getTime())
  const tally = (kind: VoucherKind) => {
    const these = vouchers.filter(
      (one) => one.kind === kind && monthCode(Date.parse(one.at)) === code,
    )
    return {
      minor: these.reduce((sum, one) => sum + one.totalMinor, 0),
      count: these.length,
    }
  }
  return {
    into: tally("BKM"),
    out: tally("BKK"),
    name: dateText(now, { month: "long" }),
  }
}

/// The first of the month before last, as the book's `from`: every voucher of
/// the two months before this one and this month's own, numbered from its first.
export function bookFrom(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth() - 2, 1)
}

/// How the shop's number is written on a voucher: its code, else its id.
export function siteCodeOf(
  identity: { site_code?: string; site_id?: string } | null | undefined,
): string {
  const code = identity?.site_code ?? identity?.site_id ?? "STORE"
  return code.trim().toUpperCase()
}

// ── The number in words ────────────────────────────────────────────────────

const ONES = [
  "",
  "satu",
  "dua",
  "tiga",
  "empat",
  "lima",
  "enam",
  "tujuh",
  "delapan",
  "sembilan",
  "sepuluh",
  "sebelas",
]

/// Whole rupiah, in Indonesian — the words a voucher carries because a figure
/// can be altered with a pen and a sentence cannot. `seratus` and `seribu`
/// rather than `satu ratus` and `satu seribu`: the singular is a rule of the
/// language, not a nicety.
function say(n: number): string {
  if (n < 12) return ONES[n]
  if (n < 20) return `${say(n - 10)} belas`
  if (n < 100) return `${say(Math.floor(n / 10))} puluh ${say(n % 10)}`.trim()
  if (n < 200) return `seratus ${say(n - 100)}`.trim()
  if (n < 1_000)
    return `${say(Math.floor(n / 100))} ratus ${say(n % 100)}`.trim()
  if (n < 2_000) return `seribu ${say(n - 1_000)}`.trim()
  if (n < 1_000_000)
    return `${say(Math.floor(n / 1_000))} ribu ${say(n % 1_000)}`.trim()
  if (n < 1_000_000_000)
    return `${say(Math.floor(n / 1_000_000))} juta ${say(n % 1_000_000)}`.trim()
  if (n < 1_000_000_000_000)
    return `${say(Math.floor(n / 1_000_000_000))} miliar ${say(n % 1_000_000_000)}`.trim()
  return `${say(Math.floor(n / 1_000_000_000_000))} triliun ${say(n % 1_000_000_000_000)}`.trim()
}

/// `rupiahWords(120_000)` is "Seratus dua puluh ribu rupiah".
export function rupiahWords(rupiah: number): string {
  const said = rupiah <= 0 ? "nol rupiah" : `${say(Math.floor(rupiah))} rupiah`
  return said.charAt(0).toUpperCase() + said.slice(1)
}

// ── Dates on a printed paper ───────────────────────────────────────────────

const MONTHS_ID = [
  "Januari",
  "Februari",
  "Maret",
  "April",
  "Mei",
  "Juni",
  "Juli",
  "Agustus",
  "September",
  "Oktober",
  "November",
  "Desember",
]

/// `11 Oktober 2026` — the day a paper is dated, in the shop's own calendar.
/// Takes an instant or a calendar day.
export function dateIndonesian(when: string): string {
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(when)
    ? new Date(`${when}T00:00:00`)
    : new Date(when)
  if (Number.isNaN(parsed.getTime())) return "—"
  return `${parsed.getDate()} ${MONTHS_ID[parsed.getMonth()]} ${parsed.getFullYear()}`
}
