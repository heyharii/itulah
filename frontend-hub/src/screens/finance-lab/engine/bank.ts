/// Bank reconciliation: the statement, what it matches, and what it becomes.
///
/// # The three things a statement line can be
///
/// A line arrives from the bank and is exactly one of:
///
///   * **matched** — the books already have this. A payment posted, a sale
///     banked, a settlement received. Nothing new is written; the line is
///     linked to the entry that already explains it.
///   * **posted** — the books do not have it and should. A bank charge,
///     interest, a direct debit nobody raised. Categorising it writes a real
///     journal entry through the same door every other posting uses.
///   * **excluded** — the line is not ours: a duplicate feed, a transfer
///     between two accounts both already in the books, a bank error being
///     reversed. Excluding records the decision rather than deleting the row.
///
/// Deleting is deliberately not a fourth option. A statement line that
/// disappeared is a line nobody can explain at the year end, and "we decided
/// this was not ours" is exactly the sort of thing an auditor asks about.
///
/// # Why matching is a suggestion and never automatic
///
/// Amount and date agreeing is strong evidence and not proof: two invoices for
/// the same round figure in the same week are ordinary in retail. So the engine
/// scores candidates and the person confirms. A match applied without a person
/// is how a payment ends up reconciled against the wrong invoice, and the
/// symptom appears months later on a supplier statement.

import type { Day, JournalEntry, Minor } from "./types"

export type LineStatus = "PENDING" | "POSTED" | "EXCLUDED"

export interface BankLine {
  readonly line_id: string
  readonly bank_account_id: string
  readonly on: Day
  readonly description: string
  /// Positive always. Direction says which way.
  readonly amount: Minor
  readonly direction: "IN" | "OUT"
  readonly reference?: string
  readonly status: LineStatus
  /// The journal entry this line was matched to, or the one posting it created.
  readonly entry_id?: string
  /// How it left PENDING, so the Posted tab can say which.
  readonly resolution?: "MATCHED" | "POSTED"
  readonly excluded_reason?: string
  /// A category chosen but not posted — what a rule suggested, or what a
  /// person picked before pressing Post.
  readonly suggested_role?: string
  readonly counterparty?: string
}

/// A candidate match, and why it is one.
export interface Candidate {
  readonly entry_id: string
  readonly entry_number: string
  readonly on: Day
  readonly memo: string
  readonly amount: Minor
  /// 0–1. Amount is most of it; the date narrows a tie.
  readonly score: number
  readonly why: string
}

/// Find entries that could explain a line.
///
/// Amount must agree exactly — a bank line is the bank's own figure and a
/// near-miss is a different transaction, not a rounding difference. What varies
/// is the DATE, because a cheque clears days after it is written.
export function candidates(
  line: BankLine,
  entries: readonly JournalEntry[],
  takenEntryIds: ReadonlySet<string>
): readonly Candidate[] {
  const out: Candidate[] = []
  for (const e of entries) {
    if (takenEntryIds.has(e.entry_id)) continue
    if (e.total !== line.amount) continue

    const days =
      Math.abs(Date.parse(e.dates.posting_on) - Date.parse(line.on)) /
      86_400_000
    if (days > 14) continue

    // Direction has to agree too, or a receipt matches a payment of the same
    // size — which balances, reconciles, and is completely wrong.
    const bankSide = line.direction === "OUT"
    const entrySide = e.lines.some((l) => l.role === "BANK" && l.credit > 0)
    const entryIn = e.lines.some((l) => l.role === "BANK" && l.debit > 0)
    if (bankSide && !entrySide) continue
    if (!bankSide && !entryIn) continue

    out.push({
      entry_id: e.entry_id,
      entry_number: e.entry_number,
      on: e.dates.posting_on,
      memo: e.memo ?? e.document_ref,
      amount: e.total,
      score: days === 0 ? 1 : Math.max(0.4, 1 - days / 20),
      why:
        days === 0
          ? "amount and date match exactly"
          : `same amount,  ${Math.round(days)} days apart`,
    })
  }
  return out.sort((a, b) => b.score - a.score)
}

/// What a line looks like it should be categorised as, when nothing matches.
///
/// Keyword rules, and they are suggestions with a warning mark on the screen —
/// never applied silently. The client's own descriptions are terse and
/// abbreviated, which is exactly the condition under which a confident guesser
/// is wrong most often.
const BUILT_IN: readonly [RegExp, string, string][] = [
  [/BIAYA ADM|ADM\b|BIAYA BANK/i, "BANK_CHARGE", "Bank charge"],
  [/BUNGA/i, "INTEREST_INCOME", "Bank interest"],
  [/PAJAK BUNGA|PPH/i, "TAX_EXPENSE", "Tax"],
  [/SETTLE|EDC|DEBIT/i, "CARD_RECEIVABLE", "Card settlement"],
  [/TRSF|TRANSFER/i, "", "Transfer — choose a category"],
]

/// Rules somebody added from a row. Kept apart from the built-ins and
/// consulted first: a rule a person wrote for their own bank's wording should
/// beat a generic keyword, and when it stops being right they need to be able
/// to find it.
export interface BankRule {
  readonly rule_id: string
  readonly contains: string
  readonly role: string
  readonly label: string
  readonly counterparty?: string
  readonly created_by: string
}

const learned: BankRule[] = []

export function rules(): readonly BankRule[] {
  return learned
}

export function addRule(r: Omit<BankRule, "rule_id">): BankRule {
  const rule = { ...r, rule_id: `R-${learned.length + 1}` }
  learned.push(rule)
  return rule
}

export function removeRule(rule_id: string) {
  const i = learned.findIndex((r) => r.rule_id === rule_id)
  if (i >= 0) learned.splice(i, 1)
}

export function suggest(
  line: BankLine
):
  | { role: string; label: string; counterparty?: string; from?: string }
  | undefined {
  for (const r of learned) {
    if (line.description.toLowerCase().includes(r.contains.toLowerCase())) {
      return {
        role: r.role,
        label: r.label,
        counterparty: r.counterparty,
        from: "rule",
      }
    }
  }
  for (const [re, role, label] of BUILT_IN) {
    if (re.test(line.description))
      return role ? { role, label, from: "keyword" } : undefined
  }
  return undefined
}

// ---------------------------------------------------------------------------
// CSV import
// ---------------------------------------------------------------------------

export interface ParseResult {
  readonly lines: readonly Omit<BankLine, "status">[]
  readonly skipped: number
  readonly problems: readonly string[]
}

/// Read a bank export.
///
/// Deliberately forgiving about column ORDER and strict about content: banks in
/// Indonesia export half a dozen shapes and the header names differ, but a row
/// either has a date and an amount or it is not a transaction. A row that
/// cannot be read is counted and reported rather than dropped, because a silent
/// skip is how an import ends up one transaction short and balances anyway.
///
/// Accepts either a single signed `amount` column or separate debit/credit
/// columns, which between them cover every export we have seen.
export function parseCsv(text: string): ParseResult {
  const rows = text
    .split(/\r?\n/)
    .map((r) => r.trim())
    .filter(Boolean)
  if (rows.length < 2) {
    return { lines: [], skipped: 0, problems: ["Empty file, or no data rows."] }
  }

  const split = (r: string) => {
    // Minimal CSV: quoted fields may contain commas.
    const out: string[] = []
    let cur = ""
    let q = false
    for (const ch of r) {
      if (ch === '"') q = !q
      else if (ch === "," && !q) {
        out.push(cur)
        cur = ""
      } else cur += ch
    }
    out.push(cur)
    return out.map((c) => c.trim().replace(/^"|"$/g, ""))
  }

  const header = split(rows[0]).map((h) => h.toLowerCase())
  const find = (...names: string[]) =>
    header.findIndex((h) => names.some((n) => h.includes(n)))

  const iDate = find("tanggal", "date", "tgl")
  const iDesc = find("keterangan", "description", "uraian", "narasi", "berita")
  const iDebit = find("debet", "debit", "keluar", "withdrawal")
  const iCredit = find("kredit", "credit", "masuk", "deposit")
  const iAmount = find("amount", "jumlah", "nominal", "mutasi")
  const iRef = find("referensi", "reference", "ref")

  const problems: string[] = []
  if (iDate < 0) problems.push("No date column found.")
  if (iDebit < 0 && iCredit < 0 && iAmount < 0) {
    problems.push(
      "No amount column found — needs debit/credit or a single amount column."
    )
  }
  if (problems.length) return { lines: [], skipped: rows.length - 1, problems }

  const money = (s: string | undefined): number => {
    if (!s) return 0
    // Indonesian exports write 1.234.567,89; English ones 1,234,567.89.
    const cleaned = s.replace(/[^\d,.-]/g, "")
    const idn = /,\d{2}$/.test(cleaned)
    const norm = idn
      ? cleaned.replace(/\./g, "").replace(",", ".")
      : cleaned.replace(/,/g, "")
    const n = Number(norm)
    return Number.isFinite(n) ? Math.round(n * 100) : 0
  }

  const date = (s: string): string | undefined => {
    const t = s.trim()
    let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t)
    if (m) return `${m[1]}-${m[2]}-${m[3]}`
    m = /^(\d{2})[/-](\d{2})[/-](\d{4})/.exec(t)
    // Day first: every bank export in this market is dd/mm/yyyy.
    if (m) return `${m[3]}-${m[2]}-${m[1]}`
    return undefined
  }

  const lines: Omit<BankLine, "status">[] = []
  let skipped = 0
  for (const [n, raw] of rows.slice(1).entries()) {
    const c = split(raw)
    const on = date(c[iDate] ?? "")
    if (!on) {
      skipped += 1
      continue
    }
    const debit = iDebit >= 0 ? money(c[iDebit]) : 0
    const credit = iCredit >= 0 ? money(c[iCredit]) : 0
    const signed = iAmount >= 0 ? money(c[iAmount]) : 0
    let amount = 0
    let direction: "IN" | "OUT" = "OUT"
    if (debit || credit) {
      amount = debit || credit
      direction = debit ? "OUT" : "IN"
    } else if (signed) {
      amount = Math.abs(signed)
      direction = signed < 0 ? "OUT" : "IN"
    }
    if (amount === 0) {
      skipped += 1
      continue
    }
    lines.push({
      line_id: `IMP-${Date.now()}-${n}`,
      bank_account_id: "",
      on,
      description: (c[iDesc] ?? "").slice(0, 120) || "(tanpa keterangan)",
      amount,
      direction,
      reference: iRef >= 0 ? c[iRef] : undefined,
    })
  }

  if (lines.length === 0) problems.push("No baris yang bisa dibaca.")
  return { lines, skipped, problems }
}

/// A sample file, so somebody can try the import without hunting for one.
export const SAMPLE_CSV = `Tanggal,Keterangan,Debet,Kredit,Referensi
01/08/2026,BIAYA ADM,15000,,ADM0801
02/08/2026,BUNGA BANK,,4283,INT0802
03/08/2026,TRSF E-BANKING DB PT KENCANA MODE,125381040,,TRF0803
05/08/2026,SETTLE BCA DEBIT 260804,,2347000,EDC0805
06/08/2026,PEMBAYARAN PLN AGUSTUS,4863200,,PLN0806
`
