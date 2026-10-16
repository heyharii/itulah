import {
  adjustmentsAt,
  fileAdjustment,
  isoDay,
  isoMonth,
  monthBounds,
  withdrawAdjustment,
} from "@/lib/queries/hr"
import { money } from "@itulah/contract/money"
import type {
  AttendanceRangeView,
  PayComponentView,
  PayrollAdjustmentRow,
} from "@itulah/contract"

/// The shop's Payroll screen, as far as head office lets a shop see it.
///
/// The owner's picture (11 Oct 2026): pay is worked out at head office from
/// HO's components; the shop sees each person's month as a card, adds or takes
/// off what it knows about (a sales incentive, a cash shortfall), and sends the
/// month to head office once, inside a window head office sets.
///
/// # What the centre actually gives a shop
///
/// A shop's calls are relayed to the centre and the relay passes only the
/// routes on its allowlist (`backend/src/cloud/domain/relay.rs`). Of payroll it
/// passes the component catalogue and the one-offs — `GET/POST
/// /payroll/adjustments` and `POST /payroll/adjustments/{id}/withdrawal` — and
/// nothing else: not `/payroll/runs`, not `/employees/{id}/pay`, not a run's
/// slips. So this module reads and writes exactly that, and the screen says
/// nothing it could not have read:
///
///  - **A person's total is not readable here.** `PayCard.total` is `null`
///    until the centre relays a per-person figure; the card draws a dash.
///  - **A line is a one-off.** Each line the shop adds is one
///    `PayrollAdjustmentRow`: a positive amount under a catalogue component
///    whose `kind` says which way it points, and a reason. The centre has no
///    free-named line, so the line's name travels as the reason, and the
///    component is chosen from HO's `PER_OCCASION` catalogue. The centre keeps
///    ONE per person, component and month, so a person has at most as many
///    lines as there are components to put them under.
///  - **"Sent" is inferred, never stated.** A one-off is withdrawable while its
///    month has no run or a `DRAFT` one; so a month with any row that is no
///    longer withdrawable has been submitted. A month with no rows says nothing
///    either way, and the screen says nothing either.
///  - **There is no sending.** Submitting the run is not relayed, and there is
///    no sending window anywhere in the centre (the payroll schedule's cut-off
///    decides which days are counted; `pay_on` is for display).

/// `+1` adds to pay, `-1` takes off it — the component's `kind`, as a sign.
export type Sign = 1 | -1

/// One line the shop put on somebody's month.
export interface PayLine {
  /// The one-off this line is.
  readonly id: string
  readonly sign: Sign
  readonly code: string
  /// HO's name for the component it is filed under.
  readonly label: string
  /// The shop's own words for it — the one-off's reason.
  readonly name: string
  readonly amountMinor: number
}

/// A line as the Adjust dialog sends it: `id` is the one-off it was read
/// from, `null` for a line added in the dialog.
export interface LineDraft {
  readonly id: string | null
  readonly code: string
  readonly name: string
  readonly amountMinor: number
}

/// What a person's month came to, from their derived days.
export interface MonthFacts {
  /// Days with an arrival on them, rostered or not.
  readonly worked: number
  readonly rostered: number
  readonly late: number
  readonly absent: number
}

/// The words the centre's audit log gets when a line is taken back. The
/// withdrawal route refuses a blank reason; these are what actually happened.
const CHANGED = "Changed by the store in Payroll"
const REMOVED = "Removed by the store in Payroll"
const CANCELLED = "Adjustment cancelled by the store in Payroll"

/// The two `PER_OCCASION` components the centre files ITSELF — a loan's
/// instalment (`postgres::pay::LOAN_COMPONENT`) and paid-out leave
/// (`postgres::leave_extras`). Each has its own flow at head office, and a
/// shop's incentive filed under "Uang pengganti cuti" would print on the slip
/// as leave money.
const FILED_BY_THE_CENTRE = new Set(["CICILAN_PINJAMAN", "UANG_CUTI"])

export function signOf(kind: string): Sign {
  return kind === "DEDUCTION" ? -1 : 1
}

/// The components a shop's line may be filed under, for one direction:
/// `PER_OCCASION` (the only shape a one-off may name), not retired, and not
/// one the centre files itself.
export function usableComponents(
  catalogue: readonly PayComponentView[],
  sign: Sign,
): PayComponentView[] {
  return catalogue.filter(
    (component) =>
      component.basis === "PER_OCCASION" &&
      !component.retired &&
      !FILED_BY_THE_CENTRE.has(component.code) &&
      signOf(component.kind) === sign,
  )
}

/// The shop's own lines on one person's month.
///
/// A loan instalment the centre filed (`filed_by` `system`), a kasbon recovery
/// (naming an advance) and paid-out leave are not the shop's adjustment: they
/// are HO's, each with its own flow, and the shop does not see HO's
/// components. Withdrawing one from here would undo half of that flow.
export function storeLines(
  rows: readonly PayrollAdjustmentRow[],
  employeeId: string,
): PayLine[] {
  return rows
    .filter(
      (row) =>
        row.employee_id === employeeId &&
        row.advance_id === null &&
        row.filed_by !== "system" &&
        !FILED_BY_THE_CENTRE.has(row.component_code),
    )
    .map((row) => ({
      id: row.id,
      sign: signOf(row.kind),
      code: row.component_code,
      label: row.label,
      name: row.reason,
      amountMinor: row.amount_minor,
    }))
}

/// What the lines come to, signed.
export function netOf(
  lines: readonly { sign: Sign; amountMinor: number }[],
): number {
  return lines.reduce((total, line) => total + line.sign * line.amountMinor, 0)
}

/// `+Rp 150.000`, `−Rp 45.000`: a true minus (U+2212), the width of the plus
/// it stands under.
export function signedMoney(value: number): string {
  if (value === 0) return money(0)
  return `${value > 0 ? "+" : "\u2212"}${money(Math.abs(value))}`
}

/// Whether the month's batch has gone to head office — known only when a row
/// says so (see the module note).
export function batchSent(rows: readonly PayrollAdjustmentRow[]): boolean {
  return rows.some((row) => !row.withdrawable)
}

/// The months the stepper walks, oldest first, ending with this one.
///
/// A year back and never forward: a month that has not started has nothing to
/// show, and a one-off filed into it from here would be filed blind.
export function payMonths(today: Date, back = 11): string[] {
  const months: string[] = []
  for (let step = back; step >= 0; step -= 1) {
    months.push(
      isoMonth(new Date(today.getFullYear(), today.getMonth() - step, 1)),
    )
  }
  return months
}

/// The days a month's facts are read over: the calendar month, stopping at
/// today. The payroll schedule's cut-off (21 Sep – 20 Oct) is head office's and
/// not relayed, so the calendar month is the honest reading.
export function factsSpan(
  period: string,
  today: Date,
): { from: string; to: string } {
  const { from, to } = monthBounds(period)
  const now = isoDay(today)
  return { from, to: to < now ? to : now }
}

/// One person's month from their derived days.
export function monthFacts(view: AttendanceRangeView): MonthFacts {
  const days = view.days
  return {
    worked: days.filter((day) => day.arrival !== null).length,
    rostered: days.filter((day) => day.plan === "SCHEDULED").length,
    late: days.filter((day) => day.outcomes.includes("LATE")).length,
    absent: days.filter((day) => day.outcomes.includes("ABSENT")).length,
  }
}

/// Whether any reading backs the month: a station, or a phone's tap. Without
/// one, "0 absent" would be an absence of evidence drawn as a fact.
export function assessed(
  views: readonly (AttendanceRangeView | undefined)[],
): boolean {
  return views.some(
    (view) =>
      view !== undefined &&
      (view.punch_source_connected ||
        view.days.some((day) => day.punch_sources.length > 0)),
  )
}

/// Put one person's lines for a month to what the Adjust dialog says.
///
/// There is no route that replaces a person's lines in one write, so this is a
/// diff against the centre's CURRENT rows (read fresh, not from the cache — a
/// half-finished save, or a line filed from another till, changes them):
///
///  1. every line of theirs the dialog dropped or changed is withdrawn — first,
///     because the centre keeps one per component and a component moved from
///     one line to another must be free before it is filed again;
///  2. every new or changed line is filed.
///
/// A line the dialog left as it was is not touched. Not atomic: a refusal half
/// way leaves what was done done, and the caller shows the refusal over the
/// rows read back.
export async function saveLines(input: {
  place: string
  period: string
  employeeId: string
  lines: readonly LineDraft[]
}): Promise<PayrollAdjustmentRow[]> {
  const fresh = await adjustmentsAt(input.place, input.period)
  const theirs = new Map(
    storeLines(fresh, input.employeeId).map((line) => [line.id, line]),
  )
  const kept = new Set<string>()
  const toFile: LineDraft[] = []
  for (const line of input.lines) {
    const was = line.id === null ? undefined : theirs.get(line.id)
    if (
      was !== undefined &&
      was.code === line.code &&
      was.amountMinor === line.amountMinor &&
      was.name.trim() === line.name.trim()
    ) {
      kept.add(was.id)
    } else {
      toFile.push(line)
    }
  }

  let rows = fresh
  for (const was of theirs.values()) {
    if (kept.has(was.id)) continue
    const changed = input.lines.some((line) => line.id === was.id)
    rows = await withdrawAdjustment({
      id: was.id,
      reason: changed ? CHANGED : REMOVED,
    })
  }
  for (const line of toFile) {
    rows = await fileAdjustment({
      place: input.place,
      period: input.period,
      employeeId: input.employeeId,
      componentCode: line.code,
      amountMinor: line.amountMinor,
      reason: line.name.trim(),
    })
  }
  return rows
}

/// File lines again, as new one-offs with the same component, total and words
/// — the Undo of a cancel. Adds only: unlike `saveLines` it withdraws nothing,
/// so a line filed from another till in the meantime is left where it is.
export async function refileLines(input: {
  place: string
  period: string
  employeeId: string
  lines: readonly PayLine[]
}): Promise<PayrollAdjustmentRow[]> {
  let rows: PayrollAdjustmentRow[] = []
  for (const line of input.lines) {
    rows = await fileAdjustment({
      place: input.place,
      period: input.period,
      employeeId: input.employeeId,
      componentCode: line.code,
      amountMinor: line.amountMinor,
      reason: line.name,
    })
  }
  return input.lines.length > 0
    ? rows
    : adjustmentsAt(input.place, input.period)
}

/// Take all of one person's lines for a month back — "Cancel adjustment".
/// Answers the rows read back and the lines that went, so they can be put
/// back (`refileLines`) while the shop still wants them.
export async function cancelLines(input: {
  place: string
  period: string
  employeeId: string
}): Promise<{ rows: PayrollAdjustmentRow[]; cancelled: PayLine[] }> {
  const fresh = await adjustmentsAt(input.place, input.period)
  const cancelled = storeLines(fresh, input.employeeId)
  let rows = fresh
  for (const line of cancelled) {
    rows = await withdrawAdjustment({ id: line.id, reason: CANCELLED })
  }
  return { rows, cancelled }
}
