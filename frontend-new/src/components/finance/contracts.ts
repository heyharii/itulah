/**
 * Wire schemas for Finance's read boundary — `/v1/masterdata/suppliers`,
 * `/v1/finance/invoices`, `/v1/finance/payments`,
 * `/v1/accounting/reports/profit-and-loss`, `/v1/accounting/reports/cash-flow`,
 * and `/v1/hr/reimbursements` (the last is HR's resource, read here too — see
 * `fetchFinanceReimbursements` in `./api.ts`).
 *
 * Every fetch in `./api.ts` goes `api.get<unknown>` into `list(payload,
 * keys)` and then a defensive `*FromApi` parser that already tolerates a
 * missing or malformed field by dropping the row or defaulting it. These
 * schemas do not replace that path — they run beside it, through
 * `checkContract`, which never throws in production. What they add is
 * observability: today a renamed or dropped field surfaces as a row that
 * silently vanished from a list, or a total that silently reads 0, with
 * nothing recorded about why.
 *
 * These replace the hand-written `ApiInvoice`/`ApiPayment`/… interfaces that
 * used to live in `./api.ts`, every field of which was typed `unknown` — a
 * placeholder, not a description. This file is the real description.
 *
 * Field names are the wire's snake_case, matching what the `*FromApi`
 * functions in `./api.ts` read off `raw.*`.
 */

import { z } from "zod"

/**
 * Money on this estate. `./api.ts`'s own `number()` helper accepts a bare
 * JSON number *or* a quoted decimal string for every amount field it reads —
 * the same encoding variance documented above `amount()` in
 * `../accounting/api.ts` for the sibling cloud-hub routes. Accepting both
 * JSON shapes here is decoding that variance faithfully, not widening the
 * schema to accept a float: the `.int()` at the end of the pipe still
 * refuses any value that parses to a fraction of a rupiah.
 *
 * Per docs/money-contract.md the Go-estate migration to integer money is
 * unfinished and IDR-only routes carry no currency field on the wire — so,
 * as in `../accounting/contracts.ts`, there is no currency to validate here,
 * and a fractional result out of this schema is a genuine finding, not a
 * false alarm to loosen away.
 */
const money = z
  .union([z.number(), z.string()])
  .transform((value) => (typeof value === "string" ? Number(value) : value))
  .pipe(z.number().int())

export const SupplierRow = z.object({
  // `supplierFromApi` drops the row without both `supplier_id` and `name`.
  supplier_id: z.string(),
  name: z.string(),
  code: z.string().nullish(),
  address: z.string().nullish(),
  status: z.string().nullish(),
  // Two shapes seen for this field: a plain division-name string, or an
  // object carrying `{ name }`. Both are read (`text(raw.primary_division)`
  // falls back to `record(raw.primary_division)?.name`), so this stays
  // `unknown` rather than picking one shape and reporting the other as a
  // violation of a distinction the backend itself does not make.
  primary_division: z.unknown(),
  division_name: z.string().nullish(),
  country: z.string().nullish(),
})
export type SupplierRow = z.infer<typeof SupplierRow>

export const InvoiceRow = z.object({
  // `invoiceFromApi` drops the row without both `id` and `party_id`.
  id: z.string(),
  party_id: z.string(),
  invoice_number: z.string().nullish(),
  invoice_type: z.string().nullish(),
  party_name: z.string().nullish(),
  posting_date: z.string().nullish(),
  due_date: z.string().nullish(),
  currency: z.string().nullish(),
  // The gross billed amount — what `Invoice.amount` becomes. Required: an
  // invoice with no total is the case this layer exists to surface, not to
  // paper over with `Math.max(0, NaN → 0)`.
  total_amount: money,
  // Read off the wire type but not mapped onto `Invoice` anywhere in
  // `./api.ts` today — kept loose since nothing downstream depends on their
  // shape yet.
  paid_amount: money.nullish(),
  outstanding_amount: money.nullish(),
  // Displayed nowhere yet (`Invoice` carries no status field) — loose.
  status: z.string().nullish(),
  purchase_order_id: z.string().nullish(),
})
export type InvoiceRow = z.infer<typeof InvoiceRow>

export const PaymentRow = z.object({
  // `paymentFromApi` drops the row without an `id`, and without a resolvable
  // `supplierId` (from `counterparty_id` or the matched invoice).
  id: z.string(),
  payment_number: z.string().nullish(),
  invoice_id: z.string().nullish(),
  counterparty_type: z.string().nullish(),
  counterparty_id: z.string().nullish(),
  amount: money,
  method: z.string().nullish(),
  reference: z.string().nullish(),
  payment_date: z.string().nullish(),
  // Not read by `paymentFromApi` — the "recorded" filter happens server-side
  // via the query string, not by inspecting this field client-side. Loose.
  status: z.string().nullish(),
})
export type PaymentRow = z.infer<typeof PaymentRow>

export const PnLAccountRow = z.object({
  account_id: z.string().nullish(),
  code: z.string().nullish(),
  name: z.string().nullish(),
  amount: money,
})
export type PnLAccountRow = z.infer<typeof PnLAccountRow>

/** `/reports/profit-and-loss`'s envelope. `revenue`/`expenses` are typed
 * `unknown` here on purpose — `pnlFromApi` in `./api.ts` reads their nested
 * `accounts` arrays itself via `pnlSection`, and those rows are checked
 * separately against `PnLAccountRow` once unwrapped. Describing the section
 * shape twice would just be the versioned-envelope trap in reverse. */
export const PnLPayload = z.object({
  period_from: z.string().nullish(),
  period_to: z.string().nullish(),
  net_income: money.nullish(),
  revenue: z.unknown(),
  expenses: z.unknown(),
})
export type PnLPayload = z.infer<typeof PnLPayload>

export const CashFlowLineRow = z.object({
  account_id: z.string().nullish(),
  account_code: z.string().nullish(),
  account_name: z.string().nullish(),
  amount: money,
})
export type CashFlowLineRow = z.infer<typeof CashFlowLineRow>

/** `/reports/cash-flow`'s envelope. `operating`/`investing`/`financing` are
 * `unknown` for the same reason `revenue`/`expenses` are on `PnLPayload`:
 * `cashFlowFromApi` reads their nested `lines` arrays itself, and those rows
 * are checked separately against `CashFlowLineRow` once unwrapped. */
export const CashFlowPayload = z.object({
  date_from: z.string().nullish(),
  date_to: z.string().nullish(),
  net_income: money.nullish(),
  operating: z.unknown(),
  investing: z.unknown(),
  financing: z.unknown(),
  opening_cash: money.nullish(),
  closing_cash: money.nullish(),
  net_cash_change: money.nullish(),
})
export type CashFlowPayload = z.infer<typeof CashFlowPayload>

/**
 * `/v1/hr/reimbursements`, as read by Finance. Deliberately kept in step
 * with `../hr/contracts.ts`'s `HrReimbursementRow` — same endpoint, same
 * wire shape — including its choice to leave `status` a plain string: the
 * Finance reimbursements screen (`views.tsx`) does switch color on it, but
 * degrades an unrecognised value to a neutral tone rather than rendering
 * `undefined`, so this stays "displayed", not "switched on" in the strict
 * sense the money-contract recipe means.
 */
export const FinanceReimbursementRow = z.object({
  id: z.string(),
  employee_id: z.string(),
  created_at: z.string(),
  reimbursement_type: z.string().nullish(),
  submitted_at: z.string().nullish(),
  approved_at: z.string().nullish(),
  approved_by: z.string().nullish(),
  paid_at: z.string().nullish(),
  status: z.string().nullish(),
  total_amount: money,
  notes: z.string().nullish(),
  journal_entry_id: z.string().nullish(),
  advance_offset: money.nullish(),
})
export type FinanceReimbursementRow = z.infer<typeof FinanceReimbursementRow>

export const FinanceReimbursementLineRow = z.object({
  id: z.string(),
  expense_date: z.string(),
  description: z.string().nullish(),
  amount: money,
  location_id: z.string().nullish(),
})
export type FinanceReimbursementLineRow = z.infer<
  typeof FinanceReimbursementLineRow
>
