/// The one door into the simulated journal, and the guarantees behind it.
///
/// Mirrors `backend/src/cloud/postgres/poster.rs` deliberately, including the
/// parts that are inconvenient — because a harness that is more permissive
/// than production proves nothing. What it keeps:
///
///   * one writer, and every other module goes through it;
///   * an entry balances, per book, checked before anything is written;
///   * a closed period refuses, and a period that does not exist refuses too;
///   * a reversal copies the ORIGINAL accounts and never re-resolves;
///   * amounts are integers in minor units, never floats;
///   * posting is idempotent on a caller-supplied key.
///
/// What it adds, because the plan asks for it and production does not have it
/// yet: an explicit BOOK on the entry, a per-step idempotency key so one
/// document may post twice for two different reasons without either being a
/// duplicate, and an authorisation check that is part of the post rather than
/// a decoration on the button.

import { account } from "./chart"
import { resolve } from "./resolver"
import type {
  Binding,
  Book,
  Day,
  Dimensions,
  JournalEntry,
  JournalLine,
  Minor,
  Month,
  Period,
  PostOutcome,
  Role,
  AccountRole,
} from "./types"

/// A line before its account is known. This is what a rule produces.
export interface IntentLine {
  readonly side: "DEBIT" | "CREDIT"
  readonly role: AccountRole
  readonly dims: Dimensions
  readonly amount: Minor
  readonly memo?: string
  /// A client account named directly, bypassing the resolver.
  ///
  /// Two kinds of caller, deliberately: a posting RULE names a MEANING and must
  /// never name a code — that is what `account_map` is for. A PERSON writing a
  /// manual entry, or an opening balance touching two hundred accounts, names
  /// the account itself, because choosing it is the entry they came to make.
  /// Production draws the same line: `poster.rs` has `LineAccount::Meaning` and
  /// `LineAccount::Account` for exactly this.
  readonly account_code?: string
}

export interface PostIntent {
  readonly book_id: string
  readonly occurred_on: Day
  readonly document_on: Day
  readonly posting_on: Day
  readonly source_kind: string
  readonly source_id: string
  readonly document_ref: string
  readonly rule_version: string
  readonly memo?: string
  readonly lines: readonly IntentLine[]
  /// What makes a retry a no-op. Include the STEP, not just the document:
  /// `C006-BKK-26-07-00046/payroll-settlement` and
  /// `C006-BKK-26-07-00046/reversal` are two legitimate postings of one paper.
  readonly idempotency_key: string
  readonly actor: string
  readonly actor_role: Role
}

/// Who may post what. GA never posts.
///
/// Kept here rather than on the screen because §9 asks that GA does not choose
/// a debit and a credit, and a rule enforced only by not rendering a button is
/// a rule that a URL defeats.
const MAY_POST: Readonly<Record<Role, boolean>> = {
  GA: false,
  FINANCE: true,
  FINANCE_MANAGER: true,
  VIEWER: false,
}

export function periodOf(day: Day): Month {
  return day.slice(0, 7)
}

export class Ledger {
  private entries: JournalEntry[] = []
  private periods = new Map<string, Period>()
  private byKey = new Map<string, string>()
  private counter = 0
  private clock = 0

  readonly books: readonly Book[]
  private bindings: Binding[]

  // Written out rather than declared as constructor parameters: this project
  // compiles with `erasableSyntaxOnly`, which refuses parameter properties
  // because they are the one TypeScript construct that emits runtime code.
  constructor(books: readonly Book[], bindings: Binding[]) {
    this.books = books
    this.bindings = bindings
  }

  // -- periods ------------------------------------------------------------

  openPeriod(book_id: string, period: Month) {
    this.periods.set(`${book_id}/${period}`, {
      period,
      book_id,
      status: "OPEN",
    })
  }

  closePeriod(book_id: string, period: Month, by: string) {
    const p = this.periods.get(`${book_id}/${period}`)
    if (!p) return
    this.periods.set(`${book_id}/${period}`, {
      ...p,
      status: "CLOSED",
      closed_by: by,
      closed_at: this.now(),
    })
  }

  reopenPeriod(book_id: string, period: Month) {
    const p = this.periods.get(`${book_id}/${period}`)
    if (p)
      this.periods.set(`${book_id}/${period}`, {
        period,
        book_id,
        status: "OPEN",
      })
  }

  allPeriods(): readonly Period[] {
    return [...this.periods.values()].sort((a, b) =>
      a.period === b.period
        ? a.book_id.localeCompare(b.book_id)
        : a.period.localeCompare(b.period)
    )
  }

  // -- bindings -----------------------------------------------------------

  allBindings(): readonly Binding[] {
    return this.bindings
  }

  /// Add a binding. Used by the ambiguity scenario, which needs a second
  /// overlapping row to exist before it can show what happens.
  addBinding(b: Binding) {
    this.bindings = [...this.bindings, b]
  }

  removeBinding(binding_id: string) {
    this.bindings = this.bindings.filter((b) => b.binding_id !== binding_id)
  }

  // -- posting ------------------------------------------------------------

  post(intent: PostIntent): PostOutcome {
    if (!MAY_POST[intent.actor_role]) {
      return {
        ok: false,
        code: "NOT_AUTHORISED",
        message: `${intent.actor_role} may complete the record but may not post it. Finance posts.`,
      }
    }

    // Idempotency first: a replay must not even be checked for balance, or a
    // rule corrected between the two attempts would turn a no-op into a
    // refusal and somebody would press it a third time.
    const seen = this.byKey.get(intent.idempotency_key)
    if (seen) {
      const entry = this.entries.find((e) => e.entry_id === seen)!
      return { ok: true, entry, replayed: true }
    }

    if (intent.lines.length === 0) {
      return {
        ok: false,
        code: "BAD_PAYLOAD",
        message: "an entry needs at least one line",
      }
    }

    const period = periodOf(intent.posting_on)
    const p = this.periods.get(`${intent.book_id}/${period}`)
    if (!p) {
      return {
        ok: false,
        code: "PERIOD_MISSING",
        message: `no accounting period exists for ${period} in ${intent.book_id}; open it before posting`,
      }
    }
    if (p.status === "CLOSED") {
      return {
        ok: false,
        code: "PERIOD_CLOSED",
        message: `accounting period ${period} is closed for ${intent.book_id}`,
      }
    }

    let debits = 0
    let credits = 0
    for (const [i, l] of intent.lines.entries()) {
      if (!Number.isInteger(l.amount)) {
        return {
          ok: false,
          code: "BAD_PAYLOAD",
          message: `line ${i + 1} amount ${l.amount} is not a whole minor unit`,
        }
      }
      if (l.amount <= 0) {
        return {
          ok: false,
          code: "BAD_PAYLOAD",
          message: `line ${i + 1} is ${l.amount}; post the other side instead of a negative`,
        }
      }
      if (l.side === "DEBIT") debits += l.amount
      else credits += l.amount
    }
    if (debits !== credits) {
      return {
        ok: false,
        code: "UNBALANCED",
        message: `entry does not balance: debits ${debits}, credits ${credits}, difference ${Math.abs(debits - credits)}`,
      }
    }

    // Resolve everything before writing anything, so an unmapped meaning fails
    // without leaving half an entry behind.
    const lines: JournalLine[] = []
    const faults: string[] = []
    for (const [i, l] of intent.lines.entries()) {
      if (l.account_code) {
        const named = account(l.account_code)
        if (!named) {
          faults.push(`line ${i + 1}: ${l.account_code} is not in the chart`)
          continue
        }
        lines.push({
          line_no: lines.length + 1,
          account_code: named.code,
          account_name: named.name,
          unit_id: l.dims.unit_id,
          debit: l.side === "DEBIT" ? l.amount : 0,
          credit: l.side === "CREDIT" ? l.amount : 0,
          memo: l.memo,
        })
        continue
      }
      const r = resolve(this.bindings, {
        role: l.role,
        dims: l.dims,
        on: intent.posting_on,
      })
      if (!r.ok) {
        faults.push(`line ${i + 1}: ${r.message}`)
        continue
      }
      lines.push({
        line_no: lines.length + 1,
        account_code: r.account.code,
        account_name: r.account.name,
        unit_id: l.dims.unit_id,
        debit: l.side === "DEBIT" ? l.amount : 0,
        credit: l.side === "CREDIT" ? l.amount : 0,
        memo: l.memo,
        role: l.role,
        binding_id: r.binding.binding_id,
      })
    }
    if (faults.length) {
      const blocked = faults.some((f) => f.includes("may not post to it"))
      return {
        ok: false,
        code: blocked ? "ACCOUNT_BLOCKED" : "ACCOUNT_UNRESOLVED",
        message: `${faults.length} of ${intent.lines.length} lines could not be resolved`,
        detail: faults,
      }
    }

    this.counter += 1
    const entry: JournalEntry = {
      entry_id: `SIM-${String(this.counter).padStart(6, "0")}`,
      entry_number: `SJV-${String(this.counter).padStart(6, "0")}`,
      book_id: intent.book_id,
      dates: {
        occurred_on: intent.occurred_on,
        document_on: intent.document_on,
        posting_on: intent.posting_on,
        period,
      },
      source_kind: intent.source_kind,
      source_id: intent.source_id,
      document_ref: intent.document_ref,
      rule_version: intent.rule_version,
      total: debits,
      memo: intent.memo,
      lines,
      posted_by: intent.actor,
      posted_at: this.now(),
      simulated: true,
    }
    this.entries.push(entry)
    this.byKey.set(intent.idempotency_key, entry.entry_id)
    return { ok: true, entry }
  }

  /// Undo an entry by writing its mirror, using the ORIGINAL accounts.
  ///
  /// The whole point of the method. If a binding has moved since — a bank
  /// changed, a class was remapped — resolving afresh would post the reversal
  /// somewhere the original never touched, and both accounts would be wrong by
  /// the same amount while the trial balance still balanced.
  reverse(
    entry_id: string,
    posting_on: Day,
    reason: string,
    actor: string,
    actor_role: Role
  ): PostOutcome {
    if (!MAY_POST[actor_role]) {
      return {
        ok: false,
        code: "NOT_AUTHORISED",
        message: `${actor_role} may not reverse an entry.`,
      }
    }
    const original = this.entries.find((e) => e.entry_id === entry_id)
    if (!original) {
      return { ok: false, code: "BAD_PAYLOAD", message: `no entry ${entry_id}` }
    }
    if (this.entries.some((e) => e.reverses === entry_id)) {
      return {
        ok: false,
        code: "BAD_PAYLOAD",
        message: `${original.entry_number} has already been reversed`,
      }
    }
    const period = periodOf(posting_on)
    const p = this.periods.get(`${original.book_id}/${period}`)
    if (!p)
      return {
        ok: false,
        code: "PERIOD_MISSING",
        message: `no period ${period}`,
      }
    if (p.status === "CLOSED") {
      return {
        ok: false,
        code: "PERIOD_CLOSED",
        message: `period ${period} is closed`,
      }
    }

    this.counter += 1
    const entry: JournalEntry = {
      entry_id: `SIM-${String(this.counter).padStart(6, "0")}`,
      entry_number: `SJV-${String(this.counter).padStart(6, "0")}`,
      book_id: original.book_id,
      dates: {
        occurred_on: original.dates.occurred_on,
        document_on: original.dates.document_on,
        posting_on,
        period,
      },
      source_kind: "REVERSAL",
      source_id: original.entry_id,
      document_ref: original.document_ref,
      rule_version: "reversal/1",
      total: original.total,
      memo: `reverses ${original.entry_number}: ${reason}`,
      // The mirror. Account codes copied, roles and bindings carried for
      // display only — nothing here is resolved again.
      lines: original.lines.map((l, i) => ({
        line_no: i + 1,
        account_code: l.account_code,
        account_name: l.account_name,
        unit_id: l.unit_id,
        debit: l.credit,
        credit: l.debit,
        memo: l.memo,
        role: l.role,
        binding_id: l.binding_id,
      })),
      posted_by: actor,
      posted_at: this.now(),
      reverses: original.entry_id,
      simulated: true,
    }
    this.entries.push(entry)
    return { ok: true, entry }
  }

  // -- reading ------------------------------------------------------------

  allEntries(): readonly JournalEntry[] {
    return this.entries
  }

  entry(id: string): JournalEntry | undefined {
    return this.entries.find((e) => e.entry_id === id)
  }

  entriesFor(source_kind: string, source_id: string): readonly JournalEntry[] {
    return this.entries.filter(
      (e) => e.source_kind === source_kind && e.source_id === source_id
    )
  }

  /// Balance of one account, optionally at one unit, up to and including a day.
  balance(
    account_code: string,
    opts?: { unit_id?: string; upto?: Day }
  ): Minor {
    let n = 0
    for (const e of this.entries) {
      if (opts?.upto && e.dates.posting_on > opts.upto) continue
      for (const l of e.lines) {
        if (l.account_code !== account_code) continue
        if (opts?.unit_id && l.unit_id !== opts.unit_id) continue
        n += l.debit - l.credit
      }
    }
    return n
  }

  /// Every account posted to, with its two totals. The trial balance is this
  /// list plus the assertion that the two columns are equal — which is sent
  /// rather than left for a screen to subtract.
  trialBalance(opts?: { book_id?: string; unit_id?: string; upto?: Day }) {
    const rows = new Map<
      string,
      { code: string; name: string; unit: string; debit: Minor; credit: Minor }
    >()
    for (const e of this.entries) {
      if (opts?.book_id && e.book_id !== opts.book_id) continue
      if (opts?.upto && e.dates.posting_on > opts.upto) continue
      for (const l of e.lines) {
        if (opts?.unit_id && l.unit_id !== opts.unit_id) continue
        const key = `${l.account_code}/${l.unit_id}`
        const row = rows.get(key) ?? {
          code: l.account_code,
          name: l.account_name,
          unit: l.unit_id,
          debit: 0,
          credit: 0,
        }
        row.debit += l.debit
        row.credit += l.credit
        rows.set(key, row)
      }
    }
    const list = [...rows.values()].sort((a, b) =>
      a.code === b.code
        ? a.unit.localeCompare(b.unit)
        : a.code.localeCompare(b.code)
    )
    const total_debit = list.reduce((n, r) => n + r.debit, 0)
    const total_credit = list.reduce((n, r) => n + r.credit, 0)
    return {
      rows: list,
      total_debit,
      total_credit,
      balanced: total_debit === total_credit,
    }
  }

  private now(): string {
    // A deterministic clock. Wall time in a fixture makes two runs of the same
    // scenario produce two different transcripts, and then nobody can diff them.
    this.clock += 1
    return `2026-09-09T00:00:${String(this.clock).padStart(2, "0")}Z`
  }
}
