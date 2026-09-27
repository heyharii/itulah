import { parseMinor } from "@/screens/finance/chart"
import { accountChoiceReady, type AccountChoice } from "@/screens/finance/parts"

/// The manual journal's lines, as the composer holds them — shared by the
/// Journal Entries composer and the Journal Entry Templates editor, so a
/// template is written with exactly the grid an entry is.

/// What each unit is left holding by one entry.
///
/// Debits less credits, per unit. Zero everywhere is an entry each unit could
/// close its own books on; anything else is an inter-unit entry, and the two
/// numbers are what the client's grid of inter-unit accounts used to carry.
export function byUnit(
  lines: readonly {
    unit_id: string
    debit_minor: number
    credit_minor: number
  }[]
): { unit_id: string; net_minor: number }[] {
  const table = new Map<string, number>()
  for (const line of lines) {
    table.set(
      line.unit_id,
      (table.get(line.unit_id) ?? 0) + line.debit_minor - line.credit_minor
    )
  }
  return [...table.entries()]
    .map(([unit_id, net_minor]) => ({ unit_id, net_minor }))
    .sort((a, b) => b.net_minor - a.net_minor)
}

/// A line being typed, before it is anything the server would take. Amounts are
/// text until they are submitted — a half-typed number is not a number.
///
/// `account` is a pair and not a code. With forty accounts in the chart, 6301
/// is one line of the profit and loss and says nothing about what the money
/// went on; the category beside it is what used to be the difference between
/// two account codes, and the database refuses the line without it. Holding
/// them as one field is what stops a row ever carrying one half of the answer.
export interface DraftLine {
  account: AccountChoice | null
  /// Whose books the line is in: a unit id, never a site's.
  unit_id: string
  debit: string
  credit: string
}

export function blankLine(): DraftLine {
  return {
    account: null,
    unit_id: "",
    debit: "",
    credit: "",
  }
}

/// What a draft adds up to, whether the server would take it, and what it would
/// leave each unit holding.
///
/// A line with no account, no unit or nothing but zeros is one somebody started
/// and has not finished: not an error, and not yet a line.
export function draftTotals(lines: readonly DraftLine[]) {
  const usable = lines
    .map((line) => ({
      line,
      debit: line.debit.trim() === "" ? 0 : (parseMinor(line.debit) ?? 0),
      credit: line.credit.trim() === "" ? 0 : (parseMinor(line.credit) ?? 0),
    }))
    .filter(
      (row) =>
        row.line.account !== null &&
        row.line.unit_id !== "" &&
        (row.debit > 0 || row.credit > 0)
    )
  const debits = usable.reduce((sum, row) => sum + row.debit, 0)
  const credits = usable.reduce((sum, row) => sum + row.credit, 0)
  const units = byUnit(
    usable.map((row) => ({
      unit_id: row.line.unit_id,
      debit_minor: row.debit,
      credit_minor: row.credit,
    }))
  )
  /// Rows with an account chosen and no category, where the account's family
  /// asks for one.
  ///
  /// Counted over `usable` and not over every row, for the same reason the
  /// totals are: a row somebody has started and not finished is not an error
  /// yet. A row that is otherwise complete and is missing its category is,
  /// and it is the one refusal a composer can see coming — the trigger's
  /// sentence names the account and lists five legal codes, which is a fine
  /// message to never have to read.
  const uncategorised = usable.filter(
    (row) => !accountChoiceReady(row.line.account)
  )
  return {
    usable,
    debits,
    credits,
    uncategorised,
    /// Units this entry would leave carrying something — empty when each unit's
    /// own books foot.
    adrift: units.filter((unit) => unit.net_minor !== 0),
    balanced:
      usable.length >= 2 &&
      debits === credits &&
      debits > 0 &&
      uncategorised.length === 0,
  }
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

/// One line of a journal template, as the server keeps it: the same
/// `PostingLine` the posting engine reads, as JSON.
export type TemplateLine = Record<string, unknown>

/// Draft lines to a template's lines. A line with no account or no unit is
/// dropped — a template is saved from the rows somebody finished.
///
/// Amounts are kept, including zero on both sides: a template for a monthly
/// rent is the same figure every month, and one for a variable bill is the
/// accounts with the figures left to fill.
export function templateLinesFrom(lines: readonly DraftLine[]): TemplateLine[] {
  return lines
    .filter((line) => line.account !== null && line.unit_id !== "")
    .map((line) => ({
      account: {
        kind: "account",
        account_code: line.account!.account_code,
        category_code: line.account!.category_code,
      },
      unit_id: line.unit_id,
      debit_minor: line.debit.trim() === "" ? 0 : (parseMinor(line.debit) ?? 0),
      credit_minor:
        line.credit.trim() === "" ? 0 : (parseMinor(line.credit) ?? 0),
      party_type: null,
      party_id: null,
      memo: null,
    }))
}

/// A template's lines to draft lines the grid can edit.
///
/// Only lines that name an account (`kind: "account"`) can be drawn: a line
/// that names a posting ROLE is resolved by the posting engine, and the grid
/// has no box for one. Those are counted in `skipped` so a screen can say so
/// rather than silently post half a template.
///
/// The template keeps the code and the category, not the account's name or
/// its category family, so the family is read back from the category list the
/// caller holds (`familyOf`). The name is left empty — the code is drawn.
export function draftFromTemplate(
  lines: readonly TemplateLine[],
  familyOf: (categoryCode: string) => string | null
): { lines: DraftLine[]; skipped: number } {
  const out: DraftLine[] = []
  let skipped = 0
  for (const line of lines) {
    const account = line.account as
      | { kind?: string; account_code?: string; category_code?: string | null }
      | undefined
    if (
      account === undefined ||
      account.kind !== "account" ||
      typeof account.account_code !== "string"
    ) {
      skipped += 1
      continue
    }
    const category = account.category_code ?? null
    const choice: AccountChoice = {
      account_code: account.account_code,
      name: "",
      category_family: category === null ? null : familyOf(category),
      category_code: category,
    }
    const debit = typeof line.debit_minor === "number" ? line.debit_minor : 0
    const credit = typeof line.credit_minor === "number" ? line.credit_minor : 0
    out.push({
      account: choice,
      unit_id: typeof line.unit_id === "string" ? line.unit_id : "",
      debit: debit === 0 ? "" : String(debit),
      credit: credit === 0 ? "" : String(credit),
    })
  }
  while (out.length < 2) out.push(blankLine())
  return { lines: out, skipped }
}
