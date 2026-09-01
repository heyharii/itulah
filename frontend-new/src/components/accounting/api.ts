/*
 * Accounting's backend boundary — cloud-hub (Go, `github.com/retailos/backbone`).
 *
 * The ledger lives under `/api/v1/accounting`, not `/api/v1/ledger`. Every
 * route below was read out of `internal/cloud/accounting/handlers.go` and then
 * verified against the running hub; nothing here is derived from a route that
 * this adapter has not actually seen answer.
 *
 * What this module owns:
 *   GET  /v1/accounting/accounts                the chart of accounts (593 rows)
 *   GET  /v1/accounting/fiscal-years            FY 2025 / 2026 / 2027
 *   GET  /v1/accounting/periods?fiscal_year_id= the monthly periods of ONE year
 *   GET  /v1/accounting/general-ledger          posted GL lines
 *   GET  /v1/accounting/journal-entries         journal headers
 *   GET  /v1/accounting/reports/trial-balance   per-account debit/credit
 *   GET  /v1/accounting/reports/balance-sheet   assets vs liabilities + equity
 *   GET  /v1/accounting/ledger-health           posted-ledger integrity scan
 *   POST /v1/accounting/periods/{id}/close      the period lock
 *
 * Things this backend does that are easy to get wrong:
 *
 *  1. `/periods` takes `fiscal_year_id` and returns SQL NULL — decoded as JSON
 *     `null`, not `[]` — when it is missing. The store's query is
 *     `WHERE fiscal_year_id = $1`, so an unfiltered call matches nothing. The
 *     38 periods in `finance_periods` are real; they just have to be asked for
 *     one fiscal year at a time, which is what `fetchPeriods` does.
 *
 *  2. Reports are DATE-ranged, not period-ranged. `/reports/trial-balance`
 *     demands `date_from`+`date_to` (or `as_of_date`, which it expands to a
 *     single day — so `as_of_date=2026-12-31` legitimately returns nothing when
 *     the only posting is dated 2026-01-01). `/reports/balance-sheet` demands
 *     `as_of`. `/general-ledger` filters on `account_id` + `date_from`/`date_to`
 *     and knows nothing about periods, so a period filter is applied here by
 *     translating the period into its own start and end dates.
 *
 *  3. Money is MAJOR units. `journal_lines.debit_amount` is `numeric(18,4)` and
 *     the Go `money.Money` type marshals a bare decimal. Some routes quote it
 *     as a JSON string, others emit a number; `amount()` accepts both. Nothing
 *     is divided by 100 anywhere in this app.
 *
 *  4. `root_type` is title-cased ("Asset") while `account_type` is lower-cased
 *     and calls income "revenue". Both are normalised to one lower-case
 *     RootType here so the screens have a single vocabulary.
 *
 *  5. The GL rows carry `period_id` and `fiscal_year_id` transposed in the seed
 *     data (`period_id: "fy-2027"`, `fiscal_year_id: "fp-2027-12"`). Neither is
 *     trusted for filtering; dates are.
 *
 * Writes: the only mutation this app exposes is the period close, and it is
 * deliberately never fired automatically — see `closePeriod`.
 */

import { api, checkContract, qs, useDomainQuery, type ApiRequestOptions, type ApiResource } from "@/lib/api"
import {
  AccountRow,
  BalanceSheetPayload,
  FiscalYearRow,
  GeneralLedgerRow,
  JournalEntryRow,
  LedgerHealthIssueRow,
  PeriodRow,
  StatementLineRow,
  TrialBalancePayload,
  // Aliased: this module already exports a `TrialBalanceRow` interface for
  // the mapped domain shape — the wire schema describes the row before
  // `readTrialBalanceRow` gets to it.
  TrialBalanceRow as TrialBalanceRowContract,
} from "./contracts"
import { accountingQueries } from "./queries"

// ---------------------------------------------------------------------------
// domain
// ---------------------------------------------------------------------------

export type RootType = "asset" | "liability" | "equity" | "income" | "expense"

export const ROOT_TYPES: RootType[] = [
  "asset",
  "liability",
  "equity",
  "income",
  "expense",
]

export const ROOT_LABEL: Record<RootType, string> = {
  asset: "Assets",
  liability: "Liabilities",
  equity: "Equity",
  income: "Income",
  expense: "Expenses",
}

export interface LedgerAccount {
  /** The uuid `/general-ledger?account_id=` takes. */
  id: string
  code: string
  name: string
  parentCode: string | null
  rootType: RootType
  /** ERPNext account type ("Bank", "Cash", "Stock"…) where the hub states one. */
  erpnextType: string | null
  subtype: string | null
  isGroup: boolean
  isActive: boolean
  description: string | null
}

export interface FiscalYear {
  id: string
  name: string
  startsOn: string
  endsOn: string
  isClosed: boolean
}

export type PeriodStatus = "open" | "closed"

export interface LedgerPeriod {
  id: string
  fiscalYearId: string
  name: string
  startsOn: string
  endsOn: string
  status: PeriodStatus
  /** The fiscal year the periods table groups on. */
  year: string
}

/** One posted general-ledger line, as `/general-ledger` returns it. */
export interface GeneralLedgerEntry {
  id: string
  journalEntryId: string
  journalLineId: string
  postingDate: string
  accountId: string
  accountCode: string
  accountName: string
  /** Major units. Exactly one of debit/credit is non-zero on a posted line. */
  debit: number
  credit: number
  /** The hub's own signed balance for the line. */
  balance: number
  createdAt: string
}

/** A journal header — the voucher a GL line belongs to. */
export interface JournalEntry {
  id: string
  entryNumber: string
  postingDate: string
  periodId: string
  fiscalYearId: string
  memo: string
  sourceType: string
  sourceId: string
  totalDebit: number
  totalCredit: number
  status: string
  createdBy: string
}

/** A GL line joined to its journal header — what the Journal screen renders. */
export interface JournalLine extends GeneralLedgerEntry {
  entryNumber: string | null
  memo: string | null
  sourceType: string | null
  sourceId: string | null
  entryStatus: string | null
}

export interface TrialBalanceRow {
  accountId: string
  accountCode: string
  accountName: string
  accountType: string
  /** Major units. */
  debit: number
  credit: number
}

export interface TrialBalance {
  asOf: string
  rows: TrialBalanceRow[]
  totalDebit: number
  totalCredit: number
}

export interface StatementLine {
  accountId: string
  code: string
  name: string
  /** Major units. */
  amount: number
}

export interface StatementSection {
  label: string
  lines: StatementLine[]
  total: number
}

export interface BalanceSheet {
  asOf: string
  assets: StatementSection
  liabilities: StatementSection
  equity: StatementSection
  /** The hub's own verdict — it compares to within 0.01. */
  balanced: boolean
  totalAssets: number
  totalLiabilitiesEquity: number
  /** assets − (liabilities + equity), in major units. Zero when the book ties. */
  difference: number
}

export interface LedgerHealthIssue {
  kind: string
  detail: string
}

export interface LedgerHealth {
  scannedAt: string
  totalIssues: number
  issues: LedgerHealthIssue[]
}

/** An inclusive posting-date window; every report on this backend needs one. */
export interface DateRange {
  from: string
  to: string
}

// ---------------------------------------------------------------------------
// defensive parsing
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value : fallback
}

function optionalStr(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null
}

/**
 * Money as this hub emits it: a bare JSON number on some routes, a quoted
 * decimal string on others. Already major units — never divided here.
 */
function amount(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return 0
}

function int(value: unknown, fallback = 0): number {
  const parsed = amount(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

/** `2026-01-01T00:00:00Z` and `2026-01-01` both reduce to the calendar day. */
function day(value: unknown): string {
  const text = str(value)
  return text.length >= 10 ? text.slice(0, 10) : text
}

function arrayOf(payload: unknown): unknown[] {
  return Array.isArray(payload) ? payload : []
}

/** `{key: [...]}` on the paged routes, a bare array on the legacy ones. */
function listOf(payload: unknown, key: string): unknown[] {
  if (Array.isArray(payload)) return payload
  if (!isRecord(payload)) return []
  const value = payload[key]
  return Array.isArray(value) ? value : []
}

/**
 * `root_type` is "Asset"/"Liability"/"Income"…; `account_type` is
 * "asset"/"revenue"/… Three of the 593 accounts carry an empty root_type, so
 * account_type is the fallback and "revenue" is folded into income.
 */
function readRootType(rootType: unknown, accountType: unknown): RootType {
  const candidates = [str(rootType).toLowerCase(), str(accountType).toLowerCase()]
  for (const candidate of candidates) {
    if (candidate === "revenue") return "income"
    if ((ROOT_TYPES as string[]).includes(candidate)) return candidate as RootType
  }
  return "asset"
}

function readAccount(raw: unknown): LedgerAccount | null {
  if (!isRecord(raw)) return null
  const code = str(raw.code)
  if (!code) return null
  return {
    id: str(raw.id),
    code,
    name: str(raw.name, code),
    parentCode: optionalStr(raw.parent_code),
    rootType: readRootType(raw.root_type, raw.account_type),
    erpnextType: optionalStr(raw.erpnext_account_type),
    subtype: optionalStr(raw.account_subtype),
    isGroup: raw.is_group === true,
    isActive: raw.is_active !== false,
    description: optionalStr(raw.description),
  }
}

function readFiscalYear(raw: unknown): FiscalYear | null {
  if (!isRecord(raw)) return null
  const id = str(raw.id)
  if (!id) return null
  return {
    id,
    name: str(raw.name, id),
    startsOn: day(raw.start_date),
    endsOn: day(raw.end_date),
    isClosed: raw.is_closed === true,
  }
}

function readPeriod(raw: unknown): LedgerPeriod | null {
  if (!isRecord(raw)) return null
  const id = str(raw.id)
  if (!id) return null
  const fiscalYearId = str(raw.fiscal_year_id)
  const startsOn = day(raw.start_date)
  return {
    id,
    fiscalYearId,
    name: str(raw.name, id),
    startsOn,
    endsOn: day(raw.end_date),
    status: raw.is_closed === true ? "closed" : "open",
    year: fiscalYearId || startsOn.slice(0, 4) || "—",
  }
}

function readGLEntry(raw: unknown): GeneralLedgerEntry | null {
  if (!isRecord(raw)) return null
  // `id` is a bigint sequence value, so it arrives as a JSON number.
  const id = raw.id == null ? "" : String(raw.id)
  if (!id) return null
  return {
    id,
    journalEntryId: str(raw.journal_entry_id),
    journalLineId: raw.journal_line_id == null ? "" : String(raw.journal_line_id),
    postingDate: day(raw.posting_date),
    accountId: str(raw.account_id),
    accountCode: str(raw.account_code),
    accountName: str(raw.account_name),
    debit: amount(raw.debit),
    credit: amount(raw.credit),
    balance: amount(raw.balance),
    createdAt: str(raw.created_at),
  }
}

function readJournalEntry(raw: unknown): JournalEntry | null {
  if (!isRecord(raw)) return null
  const id = str(raw.id)
  if (!id) return null
  return {
    id,
    entryNumber: str(raw.entry_number, id),
    postingDate: day(raw.posting_date),
    periodId: str(raw.period_id),
    fiscalYearId: str(raw.fiscal_year_id),
    memo: str(raw.memo),
    sourceType: str(raw.source_type),
    sourceId: str(raw.source_id),
    totalDebit: amount(raw.total_debit),
    totalCredit: amount(raw.total_credit),
    status: str(raw.status, "unknown"),
    createdBy: str(raw.created_by),
  }
}

function readTrialBalanceRow(raw: unknown): TrialBalanceRow | null {
  if (!isRecord(raw)) return null
  const accountCode = str(raw.account_code)
  if (!accountCode) return null
  return {
    accountId: str(raw.account_id),
    accountCode,
    accountName: str(raw.account_name, accountCode),
    accountType: str(raw.account_type),
    debit: amount(raw.debit),
    credit: amount(raw.credit),
  }
}

function readStatementLine(raw: unknown): StatementLine | null {
  if (!isRecord(raw)) return null
  const code = str(raw.code)
  if (!code) return null
  return {
    accountId: str(raw.account_id),
    code,
    name: str(raw.name, code),
    amount: amount(raw.amount),
  }
}

function readSection(raw: unknown, fallbackLabel: string, path: string): StatementSection {
  const record = isRecord(raw) ? raw : {}
  const lines = arrayOf(record.accounts)
  checkContract(StatementLineRow, lines, path)
  return {
    label: str(record.label, fallbackLabel),
    lines: lines
      .map(readStatementLine)
      .filter((line): line is StatementLine => line !== null),
    total: amount(record.total),
  }
}

// ---------------------------------------------------------------------------
// requests
// ---------------------------------------------------------------------------

function readOptions(signal?: AbortSignal): ApiRequestOptions | undefined {
  return signal ? { signal } : undefined
}

/** cloud-hub's idempotency middleware keys replays off this header. */
function idempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID()
  }
  const hex = "0123456789abcdef"
  let out = ""
  for (let index = 0; index < 36; index += 1) {
    if (index === 8 || index === 13 || index === 18 || index === 23) out += "-"
    else if (index === 14) out += "4"
    else if (index === 19) out += hex[(Math.floor(Math.random() * 16) & 0x3) | 0x8]
    else out += hex[Math.floor(Math.random() * 16)]
  }
  return out
}

export async function fetchAccounts(signal?: AbortSignal): Promise<LedgerAccount[]> {
  // Passing no list params keeps the legacy contract: the whole chart, unpaged.
  const path = "/v1/accounting/accounts"
  const payload = await api.get<unknown>(path, readOptions(signal))
  const rows = arrayOf(payload)
  checkContract(AccountRow, rows, path)
  return rows
    .map(readAccount)
    .filter((account): account is LedgerAccount => account !== null)
    .sort((a, b) => a.code.localeCompare(b.code))
}

export async function fetchFiscalYears(signal?: AbortSignal): Promise<FiscalYear[]> {
  const path = "/v1/accounting/fiscal-years"
  const payload = await api.get<unknown>(path, readOptions(signal))
  const rows = arrayOf(payload)
  checkContract(FiscalYearRow, rows, path)
  return rows
    .map(readFiscalYear)
    .filter((year): year is FiscalYear => year !== null)
    .sort((a, b) => a.startsOn.localeCompare(b.startsOn))
}

/**
 * The periods of every fiscal year. `/periods` filters on `fiscal_year_id` with
 * no "all" mode — omitting it matches no row and the handler answers `null` —
 * so the years are enumerated first and asked for one at a time.
 */
export async function fetchPeriods(
  fiscalYears: FiscalYear[],
  signal?: AbortSignal,
): Promise<LedgerPeriod[]> {
  const pages = await Promise.all(
    fiscalYears.map((year) => {
      const path = `/v1/accounting/periods${qs({ fiscal_year_id: year.id })}`
      return api.get<unknown>(path, readOptions(signal)).then((payload) => ({ path, payload }))
    }),
  )
  const rows = pages.flatMap(({ payload }) => arrayOf(payload))
  // One report is enough here even though the loop above fires several
  // requests: `checkContract` already dedupes by path, and every page shares
  // the same `/v1/accounting/periods` shape.
  if (pages.length > 0) checkContract(PeriodRow, rows, "/v1/accounting/periods")
  return rows
    .map(readPeriod)
    .filter((period): period is LedgerPeriod => period !== null)
    .sort((a, b) => a.startsOn.localeCompare(b.startsOn) || a.id.localeCompare(b.id))
}

export interface JournalQuery {
  accountId?: string | null
  range?: DateRange | null
  limit?: number
}

/** `glSortSpec` caps `limit` at 1000; the route pages with limit+offset. */
export const JOURNAL_LIMIT = 1000

/**
 * The journal: GL lines joined to the journal headers that produced them.
 * `/general-ledger` carries no memo, source or voucher number, so the headers
 * are read alongside it and matched on `journal_entry_id`. A line whose header
 * is outside the requested window keeps null header fields rather than
 * borrowing another voucher's.
 */
export async function fetchJournal(
  query: JournalQuery = {},
  signal?: AbortSignal,
): Promise<JournalLine[]> {
  const limit = query.limit ?? JOURNAL_LIMIT
  const glPath = `/v1/accounting/general-ledger${qs({
    account_id: query.accountId ?? "",
    date_from: query.range?.from ?? "",
    date_to: query.range?.to ?? "",
    limit,
    sort_by: "posting_date",
    sort_dir: "asc",
  })}`
  const headerPath = `/v1/accounting/journal-entries${qs({
    date_from: query.range?.from ?? "",
    date_to: query.range?.to ?? "",
    limit,
  })}`
  const [glPayload, headerPayload] = await Promise.all([
    api.get<unknown>(glPath, readOptions(signal)),
    api.get<unknown>(headerPath, readOptions(signal)),
  ])

  const headerRows = listOf(headerPayload, "journal_entries")
  checkContract(JournalEntryRow, headerRows, headerPath)
  const headers = new Map(
    headerRows
      .map(readJournalEntry)
      .filter((entry): entry is JournalEntry => entry !== null)
      .map((entry) => [entry.id, entry] as const),
  )

  const glRows = listOf(glPayload, "entries")
  checkContract(GeneralLedgerRow, glRows, glPath)
  return glRows
    .map(readGLEntry)
    .filter((entry): entry is GeneralLedgerEntry => entry !== null)
    .map<JournalLine>((entry) => {
      const header = headers.get(entry.journalEntryId)
      return {
        ...entry,
        entryNumber: header?.entryNumber ?? null,
        memo: header?.memo || null,
        sourceType: header?.sourceType || null,
        sourceId: header?.sourceId || null,
        entryStatus: header?.status ?? null,
      }
    })
}

/** The journal headers on their own — the vouchers, not their lines. */
export async function fetchJournalEntries(
  range?: DateRange | null,
  signal?: AbortSignal,
): Promise<JournalEntry[]> {
  const path = `/v1/accounting/journal-entries${qs({
    date_from: range?.from ?? "",
    date_to: range?.to ?? "",
    limit: JOURNAL_LIMIT,
  })}`
  const payload = await api.get<unknown>(path, readOptions(signal))
  const rows = listOf(payload, "journal_entries")
  checkContract(JournalEntryRow, rows, path)
  return rows
    .map(readJournalEntry)
    .filter((entry): entry is JournalEntry => entry !== null)
}

/** `date_from` and `date_to` are both mandatory — the route 400s without them. */
export async function fetchTrialBalance(
  range: DateRange,
  signal?: AbortSignal,
): Promise<TrialBalance> {
  const path = `/v1/accounting/reports/trial-balance${qs({
    date_from: range.from,
    date_to: range.to,
  })}`
  const payload = await api.get<unknown>(path, readOptions(signal))
  checkContract(TrialBalancePayload, [payload], path)
  const record = isRecord(payload) ? payload : {}
  const rows = arrayOf(record.rows)
  checkContract(TrialBalanceRowContract, rows, `${path}#rows`)
  return {
    asOf: str(record.as_of, range.to),
    rows: rows
      .map(readTrialBalanceRow)
      .filter((row): row is TrialBalanceRow => row !== null),
    totalDebit: amount(record.total_debit),
    totalCredit: amount(record.total_credit),
  }
}

/** `as_of` is mandatory — and it is `as_of`, not `as_of_date`, on this route. */
export async function fetchBalanceSheet(
  asOf: string,
  signal?: AbortSignal,
): Promise<BalanceSheet> {
  const path = `/v1/accounting/reports/balance-sheet${qs({ as_of: asOf })}`
  const payload = await api.get<unknown>(path, readOptions(signal))
  checkContract(BalanceSheetPayload, [payload], path)
  const record = isRecord(payload) ? payload : {}
  const totalAssets = amount(record.total_assets)
  const totalClaims = amount(record.total_liabilities_equity)
  return {
    asOf: str(record.as_of, asOf),
    assets: readSection(record.assets, "Assets", `${path}#assets`),
    liabilities: readSection(record.liabilities, "Liabilities", `${path}#liabilities`),
    equity: readSection(record.equity, "Equity", `${path}#equity`),
    balanced: record.balanced === true,
    totalAssets,
    totalLiabilitiesEquity: totalClaims,
    difference: totalAssets - totalClaims,
  }
}

/** The posted-ledger integrity scan (ERPNext `invalid_ledger_entries`). */
export async function fetchLedgerHealth(signal?: AbortSignal): Promise<LedgerHealth> {
  const path = "/v1/accounting/ledger-health"
  const payload = await api.get<unknown>(path, readOptions(signal))
  const record = isRecord(payload) ? payload : {}
  const issues = arrayOf(record.issues)
  checkContract(LedgerHealthIssueRow, issues, `${path}#issues`)
  return {
    scannedAt: str(record.scanned_at),
    totalIssues: int(record.total_issues),
    issues: issues
      .map<LedgerHealthIssue | null>((raw) =>
        isRecord(raw)
          ? { kind: str(raw.kind, str(raw.issue_type, "issue")), detail: str(raw.detail) }
          : null,
      )
      .filter((issue): issue is LedgerHealthIssue => issue !== null),
  }
}

/**
 * Close a period — `POST /v1/accounting/periods/{id}/close`.
 *
 * The route exists and is wired to the confirmation sheet, but this app never
 * fires it on its own: a closed period rejects every later posting in its date
 * range, and `/reopen` is an administrative act rather than an undo. Nothing
 * calls this without an explicit, named confirmation from the operator.
 */
export async function closePeriod(
  periodId: string,
  closedBy: string,
  signal?: AbortSignal,
): Promise<PeriodStatus> {
  const payload = await api.post<unknown>(
    `/v1/accounting/periods/${encodeURIComponent(periodId)}/close`,
    { closed_by: closedBy },
    {
      headers: { "Idempotency-Key": idempotencyKey() },
      ...(signal ? { signal } : {}),
    },
  )
  const record = isRecord(payload) ? payload : {}
  return str(record.status) === "closed" ? "closed" : "open"
}

// ---------------------------------------------------------------------------
// hooks
// ---------------------------------------------------------------------------

export interface LedgerReference {
  accounts: LedgerAccount[]
  fiscalYears: FiscalYear[]
  periods: LedgerPeriod[]
  /** The whole book: earliest fiscal-year start to latest fiscal-year end. */
  bookRange: DateRange | null
}

/** Chart of accounts, fiscal calendar and periods — the app's reference data. */
export function useLedgerReference(): ApiResource<LedgerReference> {
  return useDomainQuery(accountingQueries.reference())
}

/** The reporting window when no single period is selected. */
export function rangeOfYears(fiscalYears: FiscalYear[]): DateRange | null {
  const starts = fiscalYears.map((year) => year.startsOn).filter(Boolean).sort()
  const ends = fiscalYears.map((year) => year.endsOn).filter(Boolean).sort()
  if (starts.length === 0 || ends.length === 0) return null
  return { from: starts[0], to: ends[ends.length - 1] }
}

/**
 * The journal for one account × one date window. Both halves are in the key,
 * because they are the whole identity of the read — two screens asking for
 * different windows must not share a cached answer.
 */
export function useJournal(
  query: JournalQuery,
  enabled: boolean,
): ApiResource<JournalLine[]> {
  const { accountId, range } = query
  const from = range?.from ?? null
  const to = range?.to ?? null
  return useDomainQuery({
    ...accountingQueries.journal(
      accountId ?? null,
      from && to ? { from, to } : null,
    ),
    enabled: enabled && Boolean(from && to),
  })
}

export function useTrialBalance(range: DateRange | null): ApiResource<TrialBalance> {
  return useDomainQuery(accountingQueries.trialBalance(range))
}

export function useBalanceSheet(asOf: string | null): ApiResource<BalanceSheet> {
  return useDomainQuery(accountingQueries.balanceSheet(asOf))
}

/**
 * One account out of the chart, by code — what the detail sheet is showing.
 *
 * There is no `/accounts/{code}` route on this hub: the chart arrives whole,
 * so the "fetch" is a lookup against the cached reference read. Keeping it a
 * hook means the sheet takes a code out of the URL and nothing else.
 */
export function useLedgerAccount(
  accounts: LedgerAccount[],
  code: string | null | undefined,
): LedgerAccount | null {
  if (!code) return null
  return accounts.find((account) => account.code === code) ?? null
}

/**
 * The period close — the app's only write, and money (§M4). It now lives in
 * `./mutations`, built directly on `useMutation`; re-exported here so
 * `accounting.tsx` keeps importing it from this module unchanged.
 */
export { useClosePeriod } from "./mutations"

// ---------------------------------------------------------------------------
// formatting
// ---------------------------------------------------------------------------

/** The house rupiah format: `Rp 1.234.567`. Input is already major units. */
export function money(value: number): string {
  const rounded = Math.round(value)
  const sign = rounded < 0 ? "-" : ""
  return `${sign}Rp ${Math.abs(rounded).toLocaleString("id-ID")}`
}

/** An empty column reads better as an em dash than as `Rp 0`. */
export function moneyOrDash(value: number): string {
  return value === 0 ? "—" : money(value)
}

/**
 * Debit-positive, the convention a bookkeeper reading one account expects. The
 * hub sends debit and credit as separate columns, so the sign is made here.
 */
export function signedAmount(line: Pick<JournalLine, "debit" | "credit">): number {
  return line.debit - line.credit
}

/**
 * The trial balance reports debit and credit but no net column, so the balance
 * is formed here on the same debit-positive convention: a credit-normal account
 * (liability, equity, income) therefore reads negative, which is what the sign
 * means rather than an error.
 */
export function trialBalanceOf(row: TrialBalanceRow): number {
  return row.debit - row.credit
}
