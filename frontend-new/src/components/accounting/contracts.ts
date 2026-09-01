/**
 * Wire schemas for cloud-hub's `/v1/accounting/*` read models.
 *
 * Every fetch in `./api.ts` goes `api.get<unknown>` into `arrayOf`/`listOf`
 * and then a defensive `read*` parser that already tolerates a missing or
 * malformed field by dropping the row or falling back. These schemas do not
 * replace that path — they run beside it, through `checkContract`, which
 * never throws in production. What they add is observability: today a
 * renamed or dropped field surfaces as a row that silently vanished from a
 * list, with nothing recorded about why.
 *
 * Field names are the wire's snake_case, matching what the `read*` functions
 * in `api.ts` read off `raw.*` — these schemas describe the payload, not the
 * mapped `Ledger*` shape it becomes.
 */

import { z } from "zod"

/**
 * Money on this hub — see the note above `amount()` in `./api.ts`: GL and
 * journal amounts are backed by `numeric(18,4)` and are marshaled as a bare
 * JSON number on some routes and a quoted decimal string on others. Both are
 * legitimate *encodings* of the same value, so this accepts either JSON
 * shape — that is not the same as widening the schema to accept a float.
 * The `.int()` at the end of the pipe still refuses anything that parses to
 * a fraction of a rupiah.
 *
 * That refusal is expected to fire. `numeric(18,4)` is a decimal type with
 * four fractional digits of storage, and nothing in this codebase divides or
 * rounds it before it reaches here. Per docs/money-contract.md, money must
 * be an integer in minor units — and for IDR the minor unit is the rupiah,
 * so a fractional value here is not a rounding artifact to shrug off, it is
 * exactly the "float reached a money field" bug the contract exists to
 * catch. See the report at the bottom of this migration for the finding.
 *
 * No currency field travels on any of these routes — this hub is IDR-only
 * today, so there is nothing to validate there.
 */
const money = z
  .union([z.number(), z.string()])
  .transform((value) => (typeof value === "string" ? Number(value) : value))
  .pipe(z.number().int())

export const AccountRow = z.object({
  // The uuid `/general-ledger?account_id=` takes. Dropping this silently
  // would not fail `readAccount` (it falls back to ""), but it would break
  // every downstream GL filter that keys off it — strict as an identifier.
  id: z.string(),
  // `readAccount` returns null (row dropped) when `code` is missing — the
  // schema mirrors that by requiring it.
  code: z.string(),
  name: z.string().nullish(),
  parent_code: z.string().nullish(),
  // Normalised through `readRootType`, which already falls back to "asset"
  // rather than rendering `undefined` for an unrecognised value — so this
  // stays a loose string rather than a `z.enum`, matching the "enums the UI
  // only displays" case, not the "switches on" one.
  root_type: z.string().nullish(),
  account_type: z.string().nullish(),
  erpnext_account_type: z.string().nullish(),
  account_subtype: z.string().nullish(),
  is_group: z.boolean().nullish(),
  is_active: z.boolean().nullish(),
  description: z.string().nullish(),
})
export type AccountRow = z.infer<typeof AccountRow>

export const FiscalYearRow = z.object({
  id: z.string(),
  name: z.string().nullish(),
  start_date: z.string().nullish(),
  end_date: z.string().nullish(),
  is_closed: z.boolean().nullish(),
})
export type FiscalYearRow = z.infer<typeof FiscalYearRow>

export const PeriodRow = z.object({
  id: z.string(),
  fiscal_year_id: z.string().nullish(),
  name: z.string().nullish(),
  start_date: z.string().nullish(),
  end_date: z.string().nullish(),
  // Drives `status` via `is_closed === true`, a boolean read with an "open"
  // default — no enum here, the same reasoning as `root_type` above.
  is_closed: z.boolean().nullish(),
})
export type PeriodRow = z.infer<typeof PeriodRow>

export const GeneralLedgerRow = z.object({
  // A bigint sequence value, so it arrives as a JSON number; `readGLEntry`
  // stringifies it and drops the row if it is null/undefined.
  id: z.union([z.number(), z.string()]),
  journal_entry_id: z.string().nullish(),
  journal_line_id: z.union([z.number(), z.string()]).nullish(),
  posting_date: z.string().nullish(),
  account_id: z.string().nullish(),
  account_code: z.string().nullish(),
  account_name: z.string().nullish(),
  // "Exactly one of debit/credit is non-zero on a posted line" (api.ts) —
  // both keys are expected on every row, so required rather than nullish.
  debit: money,
  credit: money,
  balance: money,
  created_at: z.string().nullish(),
})
export type GeneralLedgerRow = z.infer<typeof GeneralLedgerRow>

export const JournalEntryRow = z.object({
  id: z.string(),
  entry_number: z.string().nullish(),
  posting_date: z.string().nullish(),
  period_id: z.string().nullish(),
  fiscal_year_id: z.string().nullish(),
  memo: z.string().nullish(),
  source_type: z.string().nullish(),
  source_id: z.string().nullish(),
  total_debit: money,
  total_credit: money,
  // Displayed, not switched on: `JournalLine.entryStatus` types this as a
  // plain `string | null`.
  status: z.string().nullish(),
  created_by: z.string().nullish(),
})
export type JournalEntryRow = z.infer<typeof JournalEntryRow>

export const TrialBalanceRow = z.object({
  // `readTrialBalanceRow` drops the row when `account_code` is missing.
  account_code: z.string(),
  account_id: z.string().nullish(),
  account_name: z.string().nullish(),
  account_type: z.string().nullish(),
  debit: money,
  credit: money,
})
export type TrialBalanceRow = z.infer<typeof TrialBalanceRow>

/** The one payload shape shared by `/reports/trial-balance`'s envelope. */
export const TrialBalancePayload = z.object({
  as_of: z.string().nullish(),
  total_debit: money.nullish(),
  total_credit: money.nullish(),
  // `rows` is checked separately, row by row, against `TrialBalanceRow` —
  // see the `#rows` suffix on the `checkContract` call in `./api.ts`.
})
export type TrialBalancePayload = z.infer<typeof TrialBalancePayload>

export const StatementLineRow = z.object({
  // `readStatementLine` drops the line when `code` is missing.
  code: z.string(),
  account_id: z.string().nullish(),
  name: z.string().nullish(),
  amount: money,
})
export type StatementLineRow = z.infer<typeof StatementLineRow>

/** `/reports/balance-sheet`'s envelope, minus the three `accounts` arrays
 * nested inside `assets`/`liabilities`/`equity` — those are genuine row
 * lists and are checked separately against `StatementLineRow`. */
export const BalanceSheetPayload = z.object({
  as_of: z.string().nullish(),
  balanced: z.boolean().nullish(),
  total_assets: money.nullish(),
  total_liabilities_equity: money.nullish(),
})
export type BalanceSheetPayload = z.infer<typeof BalanceSheetPayload>

export const LedgerHealthIssueRow = z.object({
  // Displayed, not switched on — `LedgerHealthIssue.kind` is a plain string
  // and `readLedgerHealth` already falls back to "issue".
  kind: z.string().nullish(),
  issue_type: z.string().nullish(),
  detail: z.string().nullish(),
})
export type LedgerHealthIssueRow = z.infer<typeof LedgerHealthIssueRow>
