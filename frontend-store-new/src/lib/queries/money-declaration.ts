import { useQuery } from "@tanstack/react-query"
import { useSyncExternalStore } from "react"

import { node } from "@/lib/api"
import { shiftKey } from "@/lib/till"
import { cashSalesOf, dropsOf, type Session } from "@/lib/queries/sessions"
import type { ShiftReport, ShiftSale } from "@itulah/contract"

/// The Money declaration: at the end of a day the admin counts what each
/// cashier handed in — the cash note by note, the EDC slips machine by
/// machine — against what the POS says, and a cashier is closed when both
/// have gone through.
///
/// What the node already keeps is read from it, as the sessions screens do:
/// the sessions of a day (`GET /shifts?business_date=`), each session's
/// temporary deposits (`movements`, with the notes each was counted from), the
/// notes the cashier counted at the close (`counted`), the slips the cashier
/// counted per machine (`edc_slips`) and the card and QRIS payments with the
/// machine each was rung on (`GET /shifts/{id}/sales`, `tenders[].acquirer`).
///
/// ## What the node has no place for (yet)
///
/// The admin's own work is kept in this browser (`declarations` below) until
/// the node has a table for it. TODO(edge): `money_declaration` — per shift
/// the admin's note counts, the EDC machine picked for each payment, and
/// who closed it and when — behind
///   `GET  /api/v1/store/money-declaration?business_date=`
///   `POST /api/v1/store/money-declaration/{shift_id}/cash`
///   `POST /api/v1/store/money-declaration/{shift_id}/edc`
/// with the EDC picks moving each tender's `acquirer`. The two writes below
/// (`declareCash`, `declareEdc`) are the only places that would change.

// ─────────────────────────────────────────────────────────────────────────────
// What the node serves and the generated contract has not caught up with

/// The report's EDC line for one machine (`till.rs::ShiftEdcSlip`).
export interface EdcSlipLine {
  readonly machine_id: string
  readonly machine_name: string
  /// As the cashier counted them; null until the drawer is counted.
  readonly slips: number | null
  /// Every card and QRIS tender rung on the machine in the shift.
  readonly expected: number
}

/// A report with the fields the contract's generated type is missing.
export type ReportWithSlips = ShiftReport & {
  edc_slips?: readonly EdcSlipLine[]
  float_end_minor?: number
}

export const slipsOf = (report: ShiftReport): readonly EdcSlipLine[] =>
  (report as ReportWithSlips).edc_slips ?? []

// ─────────────────────────────────────────────────────────────────────────────
// A session's sales

export type SaleWithPieces = ShiftSale & { pcs?: number }

export const shiftSalesKey = (shiftId: string) =>
  [...shiftKey(), "sales", shiftId] as const

/// Every sale of one drawer, with how each was paid.
export function useShiftSales(shiftId: string) {
  return useQuery({
    queryKey: shiftSalesKey(shiftId),
    queryFn: ({ signal }) =>
      node.get<SaleWithPieces[]>(
        `/api/v1/store/shifts/${encodeURIComponent(shiftId)}/sales`,
        { signal },
      ),
    staleTime: 0,
  })
}

/// One card or QRIS payment, as the declare-EDC table lists it.
export interface EdcPayment {
  /// Stable across reads: the sale and the tender's place on it.
  readonly key: string
  readonly saleId: string
  readonly receipt: string
  readonly at: string
  /// The machine the POS recorded it on — `BCA`, `MANDIRI`.
  readonly machine: string
  readonly kind: "Debit" | "Credit" | "QRIS"
  readonly amount: number
}

export const machineOf = (name: string | null | undefined): string =>
  (name ?? "").trim().toUpperCase()

export function paymentsOf(sales: readonly ShiftSale[]): readonly EdcPayment[] {
  return sales.flatMap((sale) =>
    sale.tenders.flatMap((tender, index) => {
      if (tender.method !== "CARD" && tender.method !== "QRIS") return []
      const machine = machineOf(tender.acquirer)
      if (machine === "") return []
      return [
        {
          key: `${sale.sale_id}#${index}`,
          saleId: sale.sale_id,
          receipt: sale.receipt_no,
          at: sale.completed_at,
          machine,
          kind:
            tender.method === "QRIS"
              ? ("QRIS" as const)
              : tender.card_kind === "CREDIT"
                ? ("Credit" as const)
                : ("Debit" as const),
          amount: tender.amount_minor,
        },
      ]
    }),
  )
}

/// The cash a sale took, net of the change it gave back.
export function cashReceiptsOf(
  sales: readonly ShiftSale[],
): readonly { id: string; at: string; receipt: string; amount: number }[] {
  return sales.flatMap((sale) => {
    if (sale.status === "VOIDED") return []
    const cash = sale.tenders
      .filter((tender) => tender.method === "CASH")
      .reduce((sum, tender) => sum + tender.amount_minor, 0)
    if (cash === 0) return []
    return [
      {
        id: sale.sale_id,
        at: sale.completed_at,
        receipt: sale.receipt_no,
        amount: cash - sale.change_minor,
      },
    ]
  })
}

/// The store's machines for this session, by id and as named.
export function machinesOf(
  session: Session,
  payments: readonly EdcPayment[],
): readonly { id: string; name: string }[] {
  const named = new Map<string, string>()
  for (const line of slipsOf(session.report)) {
    named.set(line.machine_id.trim().toUpperCase(), line.machine_name)
  }
  for (const payment of payments) {
    if (!named.has(payment.machine)) named.set(payment.machine, payment.machine)
  }
  return [...named.entries()].map(([id, name]) => ({ id, name }))
}

// ─────────────────────────────────────────────────────────────────────────────
// The deposits, as a matrix of notes

/// Banknotes and coins a count lists, largest first.
export const DENOMINATIONS = [
  100_000, 50_000, 20_000, 10_000, 5_000, 2_000, 1_000, 500, 200, 100,
] as const

export interface CashColumn {
  readonly label: string
  /// `HH:MM`, under the label.
  readonly at: string
  readonly amount: number
  /// Pieces by denomination, as the cashier counted them. Empty when the
  /// deposit was written by amount alone.
  readonly pieces: Readonly<Record<number, number>>
}

const piecesOf = (
  counted: readonly { value_minor: number; pieces: number }[],
): Record<number, number> => {
  const by: Record<number, number> = {}
  for (const line of counted) {
    by[line.value_minor] = (by[line.value_minor] ?? 0) + line.pieces
  }
  return by
}

/// What the cashier handed in: the closing (when the drawer was counted) and
/// each temporary deposit, one column each, in the order they happened.
export function cashColumns(
  report: ShiftReport,
  clock: (iso: string | null) => string,
): readonly CashColumn[] {
  const drops = dropsOf(report)
    .filter((movement) => movement.kind === "DROP")
    .map((movement, index) => ({
      label: `Temporary ${index + 1}`,
      at: clock(movement.occurred_at),
      amount: Math.abs(movement.amount_minor),
      pieces: piecesOf(movement.counted),
    }))
  const closing =
    report.declared_cash_minor === null
      ? []
      : [
          {
            label: "Closing",
            at: clock(report.closed_at),
            amount: Math.max(
              0,
              report.declared_cash_minor -
                ((report as ReportWithSlips).float_end_minor ?? 0),
            ),
            pieces: piecesOf(report.counted),
          },
        ]
  return [...closing, ...drops]
}

/// The denominations a matrix needs: the usual ones, and any other the
/// cashiers' counts carry (a 75.000 note, a coin).
export function rowsOf(columns: readonly CashColumn[]): readonly number[] {
  const seen = new Set<number>(DENOMINATIONS)
  for (const column of columns) {
    for (const value of Object.keys(column.pieces)) seen.add(Number(value))
  }
  return [...seen].sort((a, b) => b - a)
}

export const piecesSum = (pieces: Readonly<Record<number, number>>): number =>
  Object.entries(pieces).reduce((sum, [value, n]) => sum + Number(value) * n, 0)

/// What the day asks the admin to match: the cash the cashier took.
export const cashTargetOf = (report: Session["report"]): number =>
  cashSalesOf(report)

// ─────────────────────────────────────────────────────────────────────────────
// The admin's declarations (kept here until the node has a table for them)

/// Same bank / Other bank (on-us / off-us) — the node's tender does not carry
/// it yet, so only what the admin picked is known.
export type CardBank = "SAME" | "OTHER"

export interface ShiftDeclaration {
  readonly cash?: {
    /// Empty: the admin declares the total, not note by note.
    readonly pieces: Readonly<Record<number, number>>
    readonly total: number
    readonly at: string
    /// The admin who declared it.
    readonly by?: string
  }
  readonly edc?: {
    /// Payment key → the machine the admin picked from the slip.
    readonly picks: Readonly<Record<string, string>>
    /// Payment key → Debit / Credit / QRIS, only where the admin changed it.
    readonly kinds?: Readonly<Record<string, EdcPayment["kind"]>>
    /// Payment key → Same / Other bank, where the admin set it.
    readonly cards?: Readonly<Record<string, CardBank>>
    readonly at: string
  }
  readonly closedAt?: string
  readonly closedBy?: string
  /// The admin's note on the cashier.
  readonly note?: string
}

const STORE_KEY = "money.declaration.v1"

function read(): Readonly<Record<string, ShiftDeclaration>> {
  try {
    const held = window.localStorage.getItem(STORE_KEY)
    return held === null
      ? {}
      : (JSON.parse(held) as Record<string, ShiftDeclaration>)
  } catch {
    return {}
  }
}

let held = read()
const listeners = new Set<() => void>()

function write(next: Readonly<Record<string, ShiftDeclaration>>) {
  held = next
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(next))
  } catch {
    // Storage refused: the declaration still stands for this tab.
  }
  listeners.forEach((listener) => listener())
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/// Every shift's declaration, live.
export function useDeclarations(): Readonly<Record<string, ShiftDeclaration>> {
  return useSyncExternalStore(
    subscribe,
    () => held,
    () => held,
  )
}

const hhmm = (when: Date) =>
  `${String(when.getHours()).padStart(2, "0")}:${String(when.getMinutes()).padStart(2, "0")}`

/// A cashier is closed the moment both declarations have gone through.
function closed(was: ShiftDeclaration, by: string): ShiftDeclaration {
  if (
    was.closedAt !== undefined ||
    was.cash === undefined ||
    was.edc === undefined
  )
    return was
  return { ...was, closedAt: hhmm(new Date()), closedBy: by }
}

/// The admin declares the cash as one total (no per-note pieces).
export function declareCash(shiftId: string, total: number, by: string) {
  const was = held[shiftId] ?? {}
  const next: ShiftDeclaration = {
    ...was,
    cash: { pieces: {}, total, at: hhmm(new Date()), by },
  }
  write({ ...held, [shiftId]: closed(next, by) })
}

export function declareEdc(
  shiftId: string,
  picks: Readonly<Record<string, string>>,
  by: string,
  extra: {
    readonly kinds?: Readonly<Record<string, EdcPayment["kind"]>>
    readonly cards?: Readonly<Record<string, CardBank>>
  } = {},
) {
  const was = held[shiftId] ?? {}
  const next: ShiftDeclaration = {
    ...was,
    edc: { picks, ...extra, at: hhmm(new Date()) },
  }
  write({ ...held, [shiftId]: closed(next, by) })
}

export function saveNote(shiftId: string, note: string) {
  write({ ...held, [shiftId]: { ...(held[shiftId] ?? {}), note } })
}

export const isClosed = (declaration: ShiftDeclaration | undefined): boolean =>
  declaration?.closedAt !== undefined

/// The machine each payment is on: the one the admin picked, else the one the
/// POS recorded.
export const machineFor = (
  payment: EdcPayment,
  declaration: ShiftDeclaration | undefined,
): string => declaration?.edc?.picks[payment.key] ?? payment.machine

/// The type of a payment: the admin's fix, else the cashier's.
export const kindFor = (
  payment: EdcPayment,
  declaration: ShiftDeclaration | undefined,
): EdcPayment["kind"] => declaration?.edc?.kinds?.[payment.key] ?? payment.kind

/// Same / Other bank as the admin set it; undefined while nobody has.
export const cardFor = (
  payment: EdcPayment,
  declaration: ShiftDeclaration | undefined,
): CardBank | undefined => declaration?.edc?.cards?.[payment.key]

/// The cash a drawer should hold, by its parts — read off the report's
/// movements (`PICKUP` = float added, `DROP` = temporary deposit).
export interface CashParts {
  readonly added: readonly { at: string; amount: number }[]
  readonly drops: readonly { at: string; amount: number }[]
  readonly addedTotal: number
  readonly dropsTotal: number
}

export function cashPartsOf(report: ShiftReport): CashParts {
  const pick = (kind: string, sign: 1 | -1) =>
    report.movements
      .filter((movement) => movement.kind === kind)
      .map((movement) => ({
        at: movement.occurred_at,
        amount: sign * movement.amount_minor,
      }))
  const added = pick("PICKUP", 1)
  const drops = pick("DROP", -1)
  return {
    added,
    drops,
    addedTotal: added.reduce((sum, one) => sum + one.amount, 0),
    dropsTotal: drops.reduce((sum, one) => sum + one.amount, 0),
  }
}
