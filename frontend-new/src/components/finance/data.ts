/* Supplier invoices, generated from the catalogue's suppliers. There is no
 * accounting system behind this — amounts, invoice numbers and terms are
 * synthesized, but they add up consistently and age off real dates. */

import { SUPPLIERS } from "@/components/sourcing/catalogue"
import { addDays, noise, todayKey, type DayKey } from "@/lib/day"

export interface Invoice {
  id: string
  number: string
  supplierId: string
  issuedOn: DayKey
  dueOn: DayKey
  /** Rupiah, gross. */
  amount: number
  /** The order it was raised against, when there is one. */
  poRef?: string
  /** Share of the order received, when a receipt-match contract supplied it. */
  receivedPct?: number
}

const TERMS = [30, 45, 60]

function build(): Invoice[] {
  const invoices: Invoice[] = []

  SUPPLIERS.forEach((supplier, index) => {
    const count = 4 + (noise(`${supplier.id}-n`) % 5)
    for (let n = 0; n < count; n += 1) {
      const seed = `${supplier.id}-inv${n}`
      const issuedOn = addDays(todayKey(), -(4 + (noise(seed) % 96)))
      const term = TERMS[noise(`${seed}-t`) % TERMS.length]
      const received = noise(`${seed}-r`) % 100

      invoices.push({
        id: seed,
        number: `INV-2026-${String(index * 20 + n + 101).padStart(4, "0")}`,
        supplierId: supplier.id,
        issuedOn,
        dueOn: addDays(issuedOn, term),
        amount: (40 + (noise(`${seed}-a`) % 260)) * 1_000_000,
        poRef: `PO-${String(1200 + (noise(`${seed}-p`) % 400))}`,
        /* most invoices match what arrived; a few were billed short or long */
        receivedPct: received > 88 ? 90 + (noise(`${seed}-x`) % 8) : 100,
      })
    }
  })

  return invoices.sort((a, b) => a.dueOn.localeCompare(b.dueOn))
}

export const INVOICES = build()

export const invoicesOf = (supplierId: string) =>
  INVOICES.filter((i) => i.supplierId === supplierId)

/* ── how a payment lands on the debt ─────────────────────────── */

export interface Payment {
  id: string
  supplierId: string
  at: DayKey
  amount: number
  method: "transfer" | "cheque" | "cash"
  reference: string
  note?: string
}

export const SEED_PAYMENTS: Payment[] = SUPPLIERS.flatMap((supplier, index) => {
  const count = noise(`${supplier.id}-pay`) % 3
  return Array.from({ length: count }, (_, n) => ({
    id: `pay-seed-${index}-${n}`,
    supplierId: supplier.id,
    at: addDays(todayKey(), -(3 + (noise(`${supplier.id}-p${n}`) % 40))),
    amount: (30 + (noise(`${supplier.id}-pa${n}`) % 120)) * 1_000_000,
    method: "transfer" as const,
    reference: `TRF/${String(90210 + noise(`${supplier.id}-pr${n}`))}`,
  }))
})

export interface Applied {
  invoice: Invoice
  paid: number
  outstanding: number
  status: "paid" | "part-paid" | "open" | "overdue"
}

export interface Ledger {
  /** Everything billed, whether paid or not. */
  billed: number
  paid: number
  /** What is still owed across open invoices. */
  outstanding: number
  /** Money paid beyond what was billed — sits against the supplier. */
  credit: number
  lines: Applied[]
  oldestDue: DayKey | null
}

/**
 * A payment is not tied to an invoice: whatever is paid comes off the oldest
 * debt first, and anything left over stays as credit against the supplier.
 * That is what lets somebody pay a round number rather than an invoice total.
 */
export function applyPayments(
  invoices: Invoice[],
  payments: Payment[]
): Ledger {
  const ordered = [...invoices].sort((a, b) => a.dueOn.localeCompare(b.dueOn))
  let pot = payments.reduce((sum, p) => sum + p.amount, 0)
  const paidTotal = pot
  const today = todayKey()

  const lines: Applied[] = ordered.map((invoice) => {
    const paid = Math.min(pot, invoice.amount)
    pot -= paid
    const outstanding = invoice.amount - paid
    return {
      invoice,
      paid,
      outstanding,
      status:
        outstanding === 0
          ? "paid"
          : invoice.dueOn < today
            ? "overdue"
            : paid > 0
              ? "part-paid"
              : "open",
    }
  })

  const billed = ordered.reduce((sum, i) => sum + i.amount, 0)
  const outstanding = lines.reduce((sum, l) => sum + l.outstanding, 0)

  return {
    billed,
    paid: paidTotal,
    outstanding,
    credit: pot,
    lines,
    oldestDue: lines.find((l) => l.outstanding > 0)?.invoice.dueOn ?? null,
  }
}

/** Debt split by how late it is — the shape a finance team reads first. */
export const AGE_BANDS = [
  { id: "current", label: "Not due", from: -9999, to: -1, hue: "var(--grass)" },
  { id: "d30", label: "1–30 days", from: 0, to: 30, hue: "var(--honey)" },
  { id: "d60", label: "31–60 days", from: 31, to: 60, hue: "var(--coral)" },
  {
    id: "d60p",
    label: "Over 60 days",
    from: 61,
    to: 9999,
    hue: "var(--ember)",
  },
] as const

export function ageOfDebt(lines: Applied[]) {
  const today = new Date(`${todayKey()}T12:00:00`).getTime()
  return AGE_BANDS.map((band) => ({
    band,
    amount: lines
      .filter((line) => {
        if (line.outstanding === 0) return false
        const late = Math.round(
          (today - new Date(`${line.invoice.dueOn}T12:00:00`).getTime()) /
            86_400_000
        )
        return late >= band.from && late <= band.to
      })
      .reduce((sum, line) => sum + line.outstanding, 0),
  }))
}

export const rupiah = (value: number) =>
  `Rp ${Math.round(value).toLocaleString("id-ID")}`

/** Big numbers read better compressed in a summary tile. */
export const shortRupiah = (value: number) => {
  if (Math.abs(value) >= 1_000_000_000)
    return `Rp ${(value / 1_000_000_000).toFixed(1)}M`
  if (Math.abs(value) >= 1_000_000)
    return `Rp ${Math.round(value / 1_000_000)}jt`
  return rupiah(value)
}

/* ── what a store spends to keep the lights on ───────────────── */

export type ExpenseCategory =
  "rent" | "utilities" | "supplies" | "maintenance" | "marketing" | "travel"

export const EXPENSE_META: Record<
  ExpenseCategory,
  { label: string; hue: string }
> = {
  rent: { label: "Rent", hue: "var(--violet)" },
  utilities: { label: "Utilities", hue: "var(--sky)" },
  supplies: { label: "Supplies", hue: "var(--honey)" },
  maintenance: { label: "Maintenance", hue: "var(--coral)" },
  marketing: { label: "Marketing", hue: "var(--accent-base)" },
  travel: { label: "Travel", hue: "var(--grass)" },
}

export type ExpenseStatus = "pending" | "approved" | "paid" | "declined"

export interface Expense {
  id: string
  locationId: string
  category: ExpenseCategory
  amount: number
  incurredOn: DayKey
  raisedBy: string
  note: string
  status: ExpenseStatus
  decidedBy?: string
}

const EXPENSE_NOTES: Record<ExpenseCategory, string[]> = {
  rent: ["Monthly rent and service charge", "Quarterly rent top-up"],
  utilities: ["Electricity and water", "Internet and phone lines"],
  supplies: ["Hangers, tags and bags", "Cleaning supplies"],
  maintenance: ["Fitting room lights replaced", "Air conditioning service"],
  marketing: ["Window display refresh", "Local campaign print"],
  travel: ["Store visit, regional manager", "Stock transfer courier"],
}

export function buildExpenses(
  locations: { id: string; name: string }[]
): Expense[] {
  const categories = Object.keys(EXPENSE_META) as ExpenseCategory[]
  return locations.flatMap((location, index) =>
    Array.from({ length: 3 + (noise(`${location.id}-ex`) % 3) }, (_, n) => {
      const seed = `${location.id}-ex${n}`
      const category = categories[noise(seed) % categories.length]
      const notes = EXPENSE_NOTES[category]
      const status: ExpenseStatus =
        n === 0
          ? "pending"
          : noise(`${seed}-s`) % 100 > 72
            ? "approved"
            : "paid"

      return {
        id: `exp-${index}-${n}`,
        locationId: location.id,
        category,
        amount:
          category === "rent"
            ? (60 + (noise(`${seed}-a`) % 90)) * 1_000_000
            : (2 + (noise(`${seed}-a`) % 28)) * 1_000_000,
        incurredOn: addDays(todayKey(), -(2 + (noise(`${seed}-d`) % 54))),
        raisedBy: location.name,
        note: notes[noise(`${seed}-n`) % notes.length],
        status,
      }
    })
  )
}

/* ── one cash trail ──────────────────────────────────────────── */

export type CashKind = "sales" | "supplier" | "payroll" | "expense"

export const CASH_META: Record<
  CashKind,
  { label: string; hue: string; sign: 1 | -1 }
> = {
  sales: { label: "Sales takings", hue: "var(--grass)", sign: 1 },
  supplier: { label: "Supplier payment", hue: "var(--violet)", sign: -1 },
  payroll: { label: "Payroll", hue: "var(--accent-base)", sign: -1 },
  expense: { label: "Store expense", hue: "var(--honey)", sign: -1 },
}

export interface CashRow {
  id: string
  at: DayKey
  kind: CashKind
  label: string
  locationId?: string
  amount: number
  reference?: string
}
