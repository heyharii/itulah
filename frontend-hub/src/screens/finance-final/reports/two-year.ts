import { asPresented, isoDay, ladderLevel } from "@/screens/finance/chart"
import { money } from "@/lib/format"
import type { Statement } from "@itulah/contract"

/// What the two 7Soft "2 Tahunan" reports share: a year, a month, and the
/// same month a year earlier.
///
/// 7Soft's comparison reports ask for a year and a month and print that year
/// beside the one before it, both cut at the same month — the way a finance
/// team reads a year in progress: January to September against January to
/// September, never nine months against twelve. Nothing here is a date
/// picker; the only inputs are the two numbers, so the two windows can never
/// disagree about how long they are.

export const MONTH_NAMES = [
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
] as const

export const MONTH_SHORT = MONTH_NAMES.map((name) => name.slice(0, 3))

/// The last day of a month, as `YYYY-MM-DD`, in the reader's own calendar.
export function lastDayOf(year: number, month: number): string {
  return isoDay(new Date(year, month, 0))
}

/// The years offered: this one and the five before it. The year before the
/// chosen one is always read too, so the oldest choice reaches six years back.
export function yearChoices(): readonly number[] {
  const now = new Date().getFullYear()
  return Array.from({ length: 6 }, (_, index) => now - index)
}

/// The month a year is read up to when nobody has chosen: the current month
/// while the year is running, December once it is over.
export function defaultMonth(year: number): number {
  const now = new Date()
  return year === now.getFullYear() ? now.getMonth() + 1 : 12
}

/// "Jan–Sep 2026", or "January–December 2026" spelled short either way.
export function spanLabel(year: number, month: number): string {
  return month === 1 ? `Jan ${year}` : `Jan–${MONTH_SHORT[month - 1]} ${year}`
}

export function sectionKey(rootClass: string): string {
  return `section:${rootClass}`
}

/// Every figure a statement can be asked for, by account code, plus its class
/// totals — as the server sent them, in the ledger's own signs.
export function figuresOf(
  report: Statement | undefined
): ReadonlyMap<string, number> | null {
  if (report === undefined) return null
  const figures = new Map<string, number>()
  for (const section of report.sections) {
    figures.set(sectionKey(section.root_class), section.total_minor)
    for (const line of section.lines) {
      figures.set(line.account_code, line.amount_minor)
    }
  }
  return figures
}

/// One figure as the statement prints it (credit-natured classes flipped).
/// `null` only while the statement itself has not arrived; a statement that
/// has arrived and does not carry a code answers zero — the server drops a
/// heading whose whole subtree summed to nothing.
export function presentedFigure(
  figures: ReadonlyMap<string, number> | null,
  key: string,
  rootClass: string
): number | null {
  if (figures === null) return null
  return asPresented(figures.get(key) ?? 0, rootClass)
}

export interface TreeRow {
  readonly kind: "section" | "line"
  readonly rootClass: string
  readonly code: string
  readonly name: string
  readonly level: number
}

/// The union of every account the statements on screen mention, in code
/// order under each class — an account that moved only last year still has
/// its row, with a dash in this year's column.
export function buildTree(
  sources: readonly (Statement | undefined)[],
  classes?: readonly string[]
): readonly TreeRow[] {
  const sections = new Map<
    string,
    { title: string; lines: Map<string, TreeRow> }
  >()
  for (const report of sources) {
    if (report === undefined) continue
    for (const section of report.sections) {
      if (classes !== undefined && !classes.includes(section.root_class))
        continue
      const held = sections.get(section.root_class) ?? {
        title: section.title,
        lines: new Map<string, TreeRow>(),
      }
      sections.set(section.root_class, held)
      for (const line of section.lines) {
        if (held.lines.has(line.account_code)) continue
        held.lines.set(line.account_code, {
          kind: "line",
          rootClass: section.root_class,
          code: line.account_code,
          name: line.name,
          level: ladderLevel(line.depth),
        })
      }
    }
  }
  const rows: TreeRow[] = []
  for (const rootClass of [...sections.keys()].sort()) {
    const section = sections.get(rootClass)
    if (section === undefined) continue
    rows.push({
      kind: "section",
      rootClass,
      code: rootClass,
      name: section.title,
      level: 0,
    })
    for (const code of [...section.lines.keys()].sort()) {
      const line = section.lines.get(code)
      if (line !== undefined) rows.push(line)
    }
  }
  return rows
}

export function indentOf(level: number): string {
  return `${level * 1.125}rem`
}

/// Negatives in brackets, as the client's own statements print them.
export function signed(amount: number | null): string {
  if (amount === null) return "—"
  return amount < 0 ? `(${money(-amount)})` : money(amount)
}

/// A line as a share of a base, as a fraction; `null` where there is no base
/// to be a share of.
export function share(line: number | null, base: number | null): number | null {
  if (line === null || base === null || base === 0) return null
  return line / base
}

export function percent(fraction: number | null): string {
  if (fraction === null) return "—"
  const text = `${Math.abs(fraction * 100).toFixed(1)}%`
  return fraction < 0 ? `(${text})` : text
}
