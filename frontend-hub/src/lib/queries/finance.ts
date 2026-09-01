import { node } from "@/lib/api"
import type {
  AccountDetail,
  AccountMapping,
  AssessAssetRequest,
  AssetRow,
  BalanceMatrix,
  BankStatementLineRow,
  BankStatementRow,
  BookLocation,
  ConfirmMatchRequest,
  DepreciationRun,
  FiscalPeriod,
  GeneralLedger,
  ImportOutcome,
  ImportStatementRequest,
  JournalEntryDetail,
  JournalEntryRow,
  LedgerAccount,
  LineSuggestions,
  RecordBillRequest,
  RegisterAssetRequest,
  SemanticKeyDoc,
  SetAccountMappingRequest,
  Statement,
  SupplierBill,
  TrialBalance,
  UnbilledReceipt,
} from "@itulah/contract"

/// The finance wire, and the keys its answers are held under.
///
/// Almost every type here is generated from the Rust struct the server
/// serialises, so there is nothing to keep in step by hand. The four
/// exceptions are marked where they appear: `/account-map`, `/periods/close`,
/// `/journal` (POST) and `/journal/{id}/reverse` answer with `json!()`
/// literals in `cloud/http/finance.rs` rather than with a struct, so ts-rs has
/// nothing to generate from and those shapes are transcribed. If one of them
/// starts reading `undefined`, this file is where it went stale.
///
/// One thing to know before reading any screen built on this: an account
/// `name` is the client's own, in Indonesian, and is never translated
/// anywhere. "Piutang Affiliasi Pembiayaan CIKUPA" is what the accountant
/// searches their own books for; an English rendering would be a different
/// account as far as they are concerned.
///
/// Money is minor units, always. Nothing here divides, and nothing that
/// reaches a screen is ever added with a float — `money()` from `@/lib/format`
/// is the only thing that turns one into a string.

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

/// Keys live beside the function that fetches them, and the first segment is
/// the domain namespace so signing out drops the whole module's answers by
/// prefix.
///
/// `accounts` is split three ways — `children`, `search`, `detail` — because
/// all three are addressed by a bare account code and a shared shape would let
/// a search for `1011001` overwrite the children of `1011001`.
export const financeKeys = {
  all: ["finance"] as const,

  accountChildren: (parent: string | null, inactive: boolean) =>
    ["finance", "accounts", "children", parent, inactive] as const,
  accountSearch: (needle: string, inactive: boolean) =>
    ["finance", "accounts", "search", needle, inactive] as const,
  account: (code: string, asOf: string | null) =>
    ["finance", "accounts", "detail", code, asOf] as const,
  ledger: (
    code: string,
    site: string | null,
    from: string | null,
    to: string | null
  ) => ["finance", "ledger", code, site, from, to] as const,

  trialBalance: (asOf: string | null, site: string | null) =>
    ["finance", "trial-balance", asOf, site] as const,
  balances: (family: string, asOf: string | null) =>
    ["finance", "balances", family, asOf] as const,
  statement: (
    kind: string,
    from: string | null,
    to: string | null,
    site: string | null
  ) => ["finance", "statement", kind, from, to, site] as const,

  accountMap: (site: string | null) =>
    ["finance", "account-map", site] as const,
  periods: () => ["finance", "periods"] as const,

  journal: (from: string | null, to: string | null, kind: string | null) =>
    ["finance", "journal", from, to, kind] as const,
  entry: (id: string) => ["finance", "journal", "entry", id] as const,

  bills: (status: string | null) => ["finance", "bills", status] as const,
  unbilled: () => ["finance", "unbilled"] as const,

  assets: (unassessed: boolean) => ["finance", "assets", unassessed] as const,

  bankStatements: () => ["finance", "bank-statements"] as const,
  bankLines: (statementId: string) =>
    ["finance", "bank-statements", statementId, "lines"] as const,
  bankSuggestions: (statementId: string) =>
    ["finance", "bank-statements", statementId, "suggestions"] as const,
}

/// Query string from whatever is actually set. An absent option and an empty
/// string mean the same thing to every handler here — take the default — so
/// neither is put on the wire.
function search(
  params: Readonly<Record<string, string | number | boolean | undefined | null>>
): string {
  const parts = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue
    parts.set(key, String(value))
  }
  const text = parts.toString()
  return text === "" ? "" : `?${text}`
}

// ---------------------------------------------------------------------------
// Chart of accounts
// ---------------------------------------------------------------------------

/// The accounts directly under one heading, or the eight roots when `parent`
/// is absent.
///
/// A level at a time, deliberately: the client's chart is 7,528 accounts and
/// about a megabyte of JSON, and somebody opening the screen wants eight rows.
export function accountChildren(
  options: { parent?: string; inactive?: boolean } = {},
  signal?: AbortSignal
): Promise<LedgerAccount[]> {
  return node.get<LedgerAccount[]>(
    `/api/v1/finance/accounts${search({ parent: options.parent, inactive: options.inactive })}`,
    { signal }
  )
}

/// Find an account by code or by name. The server matches codes by prefix and
/// names anywhere, and it is the same endpoint as `accountChildren` — one
/// question ("which accounts am I looking at"), so a box that swapped
/// endpoints when somebody typed would have two loading states for one field.
export function searchAccounts(
  needle: string,
  options: { site?: string; inactive?: boolean; limit?: number } = {},
  signal?: AbortSignal
): Promise<LedgerAccount[]> {
  return node.get<LedgerAccount[]>(
    `/api/v1/finance/accounts${search({
      q: needle,
      site: options.site,
      inactive: options.inactive,
      limit: options.limit,
    })}`,
    { signal }
  )
}

/// One account, the headings above it, and what it is worth.
export function accountDetail(
  code: string,
  options: { site?: string; as_of?: string } = {},
  signal?: AbortSignal
): Promise<AccountDetail> {
  return node.get<AccountDetail>(
    `/api/v1/finance/accounts/${encodeURIComponent(code)}${search(options)}`,
    { signal }
  )
}

/// One account's own movements, with the balance it opened on.
///
/// Asking for a heading works and is the point: matching is by code prefix, so
/// `1011001` is cash across every location. With no window the server answers
/// the current month, which is the unit a ledger is read in.
export function accountLedger(
  code: string,
  options: { site?: string; from?: string; to?: string } = {},
  signal?: AbortSignal
): Promise<GeneralLedger> {
  return node.get<GeneralLedger>(
    `/api/v1/finance/accounts/${encodeURIComponent(code)}/ledger${search(options)}`,
    { signal }
  )
}

/// Every account that has been posted to, and the server's own proof that
/// debits equal credits. `balanced` is sent rather than subtracted here on
/// purpose: a browser-side check over a list it had not finished loading could
/// say "balanced" about half the books.
export function trialBalance(
  options: { as_of?: string; site?: string } = {},
  signal?: AbortSignal
): Promise<TrialBalance> {
  return node.get<TrialBalance>(
    `/api/v1/finance/trial-balance${search(options)}`,
    { signal }
  )
}

// ---------------------------------------------------------------------------
// The account map
// ---------------------------------------------------------------------------

/// What `GET /account-map` answers with.
///
/// Hand-written: the handler builds a `json!({...})` of three separately
/// generated pieces rather than serialising one struct, so this envelope has
/// no generated counterpart even though everything inside it does.
export interface AccountMapView {
  readonly mappings: readonly AccountMapping[]
  /// The locations the books are kept for, derived from the chart itself
  /// rather than from the list of places a delivery can reach.
  readonly locations: readonly BookLocation[]
  /// Every meaning the posting rules ask for, generated from the Rust — so a
  /// key added to a rule appears here without anybody remembering to add it to
  /// a list in the browser.
  readonly required_keys: readonly SemanticKeyDoc[]
}

export function accountMap(
  site?: string,
  signal?: AbortSignal
): Promise<AccountMapView> {
  return node.get<AccountMapView>(
    `/api/v1/finance/account-map${search({ site })}`,
    { signal }
  )
}

/// Point a meaning at one of the client's accounts, for one location.
///
/// `qualifier` is part of the key, not a note: `bank_savings` legitimately has
/// one mapping per bank at the same site. Unqualified meanings send `""`.
export function setAccountMapping(
  request: SetAccountMappingRequest,
  signal?: AbortSignal
): Promise<AccountMapping> {
  return node.post<AccountMapping>("/api/v1/finance/account-map", request, {
    signal,
  })
}

// ---------------------------------------------------------------------------
// Periods
// ---------------------------------------------------------------------------

export function listPeriods(signal?: AbortSignal): Promise<FiscalPeriod[]> {
  return node.get<FiscalPeriod[]>("/api/v1/finance/periods", { signal })
}

/// A month must be opened before anything can post into it — otherwise "post
/// into whatever month the date says" files a mistyped invoice in 2062. The
/// refusal comes from the database, not from a check here, and answers with
/// the whole list so the screen never has to guess what changed.
export function openPeriod(
  year: number,
  month: number,
  signal?: AbortSignal
): Promise<FiscalPeriod[]> {
  return node.post<FiscalPeriod[]>(
    "/api/v1/finance/periods",
    { year, month },
    { signal }
  )
}

/// What closing a month reports. Hand-written — `json!()`, not a struct.
export interface PeriodCloseReceipt {
  readonly year: number
  readonly month: number
  readonly entries_sealed: number
}

/// Seal a month. Not reversible from any screen, and it cannot race a posting:
/// the gating trigger reads the period row `FOR SHARE`, so a close and a
/// posting serialise rather than interleaving.
export function closePeriod(
  year: number,
  month: number,
  signal?: AbortSignal
): Promise<PeriodCloseReceipt> {
  return node.post<PeriodCloseReceipt>(
    "/api/v1/finance/periods/close",
    { year, month },
    { signal }
  )
}

// ---------------------------------------------------------------------------
// The journal
// ---------------------------------------------------------------------------

export function listJournal(
  options: { from?: string; to?: string; kind?: string; limit?: number } = {},
  signal?: AbortSignal
): Promise<JournalEntryRow[]> {
  return node.get<JournalEntryRow[]>(
    `/api/v1/finance/journal${search(options)}`,
    { signal }
  )
}

export function journalEntry(
  id: string,
  signal?: AbortSignal
): Promise<JournalEntryDetail> {
  return node.get<JournalEntryDetail>(
    `/api/v1/finance/journal/${encodeURIComponent(id)}`,
    { signal }
  )
}

/// One side of a hand-written entry.
///
/// The account is named as a code and not as a meaning: choosing the account
/// IS the entry somebody came to make, and routing a manual correction through
/// `account_map` would leave an accountant able to post only to the handful of
/// accounts a posting rule happens to know about. `LineAccount` in
/// `postgres/poster.rs` is an internally tagged enum, hence the `kind`.
export interface ManualLine {
  readonly account: { readonly kind: "account"; readonly account_code: string }
  readonly site_id: string
  readonly debit_minor: number
  readonly credit_minor: number
  readonly supplier_id?: string | null
  readonly memo?: string | null
}

export interface ManualEntryRequest {
  readonly posting_date: string
  readonly currency?: string
  readonly memo?: string | null
  readonly lines: readonly ManualLine[]
}

/// What a posting answers with. Hand-written — `json!()`, not a struct.
export interface PostedEntry {
  readonly entry_id: string
  readonly entry_number: string
  readonly total_minor: number
}

/// Post an entry by hand. The database refuses an unbalanced one with a
/// deferred constraint at COMMIT, and refuses any entry at all into a closed
/// month; both refusals arrive as the trigger's own sentence, so nothing here
/// keeps a second copy of a rule Postgres is already enforcing.
///
/// The idempotency key is the caller's and is held across retries: a
/// double-clicked Post writes one entry and gets the same receipt twice.
export function postManualEntry(
  request: ManualEntryRequest,
  idempotencyKey: string,
  signal?: AbortSignal
): Promise<PostedEntry> {
  return node.post<PostedEntry>("/api/v1/finance/journal", request, {
    signal,
    headers: { "Idempotency-Key": idempotencyKey },
  })
}

/// What a reversal answers with. Hand-written — `json!()`, not a struct.
export interface ReversalReceipt {
  readonly entry_id: string
  readonly entry_number: string
}

/// Undo an entry by writing its mirror. The original stays exactly as posted —
/// the journal is append-only, and a reversal is an answer to an entry rather
/// than a deletion of it. The reason is required by the server because it is
/// the only record of why.
export function reverseEntry(
  id: string,
  reason: string,
  postingDate?: string,
  signal?: AbortSignal
): Promise<ReversalReceipt> {
  return node.post<ReversalReceipt>(
    `/api/v1/finance/journal/${encodeURIComponent(id)}/reverse`,
    { reason, posting_date: postingDate },
    { signal }
  )
}

// ---------------------------------------------------------------------------
// Positions and statements
// ---------------------------------------------------------------------------

/// What one account family holds, at each location.
///
/// `family` is any code in the chart and the tree lives in the codes, so the
/// caller picks the altitude: `1011001` is cash on hand, `10110` the whole of
/// KAS & SETARA KAS. One request shape behind every position screen there is.
export function balanceMatrix(
  family: string,
  asOf?: string,
  signal?: AbortSignal
): Promise<BalanceMatrix> {
  return node.get<BalanceMatrix>(
    `/api/v1/finance/balances${search({ family, as_of: asOf })}`,
    { signal }
  )
}

export type StatementKind = "BALANCE_SHEET" | "PROFIT_LOSS"

/// The balance sheet, or the profit and loss, from the client's own root
/// classes. Figures come back as the ledger holds them — debits positive — and
/// the screen decides how a credit-natured class should read.
export function statement(
  kind: StatementKind,
  options: { from?: string; to?: string; site?: string } = {},
  signal?: AbortSignal
): Promise<Statement> {
  return node.get<Statement>(
    `/api/v1/finance/statement${search({ kind, ...options })}`,
    { signal }
  )
}

// ---------------------------------------------------------------------------
// Supplier bills
// ---------------------------------------------------------------------------

export function listBills(
  options: { status?: string; supplier?: string; limit?: number } = {},
  signal?: AbortSignal
): Promise<SupplierBill[]> {
  return node.get<SupplierBill[]>(`/api/v1/finance/bills${search(options)}`, {
    signal,
  })
}

/// Write a supplier's invoice down. Recording and posting are two acts: a bill
/// can arrive, be queried and be held before anybody decides it may be paid.
export function recordBill(
  request: RecordBillRequest,
  signal?: AbortSignal
): Promise<SupplierBill> {
  return node.post<SupplierBill>("/api/v1/finance/bills", request, { signal })
}

/// Put a recorded bill into the books. With no date the server posts it on the
/// invoice date, which is what "post this bill" means without further comment.
export function postBill(
  invoiceId: string,
  postingDate?: string,
  signal?: AbortSignal
): Promise<SupplierBill> {
  return node.post<SupplierBill>(
    `/api/v1/finance/bills/${encodeURIComponent(invoiceId)}/post`,
    { posting_date: postingDate },
    { signal }
  )
}

/// Deliveries with no bill against them.
///
/// Not a balance, and every screen that shows it has to say so: the client
/// keeps no goods-received-not-invoiced account, so this exposure is in the
/// warehouse and nowhere in the books at all. At month end both inventory and
/// payables understate by it, and this list is the only place it is ever seen.
export function unbilledReceipts(
  signal?: AbortSignal
): Promise<UnbilledReceipt[]> {
  return node.get<UnbilledReceipt[]>("/api/v1/finance/unbilled", { signal })
}

// ---------------------------------------------------------------------------
// Fixed assets
// ---------------------------------------------------------------------------

/// The register. `unassessed` asks for the open control gap directly — assets
/// Operations has registered that Finance has not yet decided a treatment for.
export function listAssets(
  options: { site?: string; category?: string; unassessed?: boolean } = {},
  signal?: AbortSignal
): Promise<AssetRow[]> {
  return node.get<AssetRow[]>(`/api/v1/finance/assets${search(options)}`, {
    signal,
  })
}

/// Operations registers an asset's identity. No money is sent: what it is
/// worth and how it wears out are Finance's assessment, which comes after.
export function registerAsset(
  request: RegisterAssetRequest,
  signal?: AbortSignal
): Promise<AssetRow> {
  return node.post<AssetRow>("/api/v1/finance/assets", request, { signal })
}

/// Finance's decision on one asset. Corrections are new assessments and never
/// edits, so "expensed in January, capitalised in March" stays legible. The
/// reason is required on both decisions — an expensed asset with no reason is
/// the one somebody queries a year later.
export function assessAsset(
  assetId: string,
  request: AssessAssetRequest,
  signal?: AbortSignal
): Promise<AssetRow> {
  return node.post<AssetRow>(
    `/api/v1/finance/assets/${encodeURIComponent(assetId)}/assess`,
    request,
    { signal }
  )
}

/// Charge one month across every capitalised asset.
///
/// Safe to run twice — a unique index on (asset, period) refuses the second
/// entry, so a repeat reports every asset as already done rather than doubling
/// the charge. It refuses outright while any asset category is unmapped, and
/// names them, because a run that failed asset by asset would be read as a
/// month with nothing to depreciate.
export function runDepreciation(
  year: number,
  month: number,
  signal?: AbortSignal
): Promise<DepreciationRun> {
  return node.post<DepreciationRun>(
    "/api/v1/finance/depreciation/run",
    { year, month },
    { signal }
  )
}

// ---------------------------------------------------------------------------
// Bank reconciliation
// ---------------------------------------------------------------------------

export function listBankStatements(
  signal?: AbortSignal
): Promise<BankStatementRow[]> {
  return node.get<BankStatementRow[]>("/api/v1/finance/bank-statements", {
    signal,
  })
}

/// Load what the bank says happened. A re-import reports its duplicates rather
/// than dropping them quietly: "0 new" is the system confirming it did the
/// right thing, and a silent drop looks identical to a failed upload.
export function importBankStatement(
  request: ImportStatementRequest,
  signal?: AbortSignal
): Promise<ImportOutcome> {
  return node.post<ImportOutcome>("/api/v1/finance/bank-statements", request, {
    signal,
  })
}

export function bankStatementLines(
  statementId: string,
  signal?: AbortSignal
): Promise<BankStatementLineRow[]> {
  return node.get<BankStatementLineRow[]>(
    `/api/v1/finance/bank-statements/${encodeURIComponent(statementId)}/lines`,
    { signal }
  )
}

/// Every unmatched line scored against our own ledger. The reasons are what a
/// person reads before agreeing; the score only orders them, and `auto_match`
/// needs a unique leader — two identical payments on the same Friday match
/// nothing automatically, which is an ordinary week and not a failure.
export function bankSuggestions(
  statementId: string,
  signal?: AbortSignal
): Promise<LineSuggestions[]> {
  return node.get<LineSuggestions[]>(
    `/api/v1/finance/bank-statements/${encodeURIComponent(statementId)}/suggestions`,
    { signal }
  )
}

/// Agree that a bank line and a journal line are the same event. This posts
/// nothing — reconciling records that we booked something and the bank
/// confirmed it. A tool that posted here would stop checking the books and
/// start writing them.
export function confirmBankMatch(
  lineId: string,
  request: ConfirmMatchRequest,
  signal?: AbortSignal
): Promise<{ matched: boolean }> {
  return node.post<{ matched: boolean }>(
    `/api/v1/finance/bank-lines/${encodeURIComponent(lineId)}/match`,
    request,
    { signal }
  )
}

/// Take an agreement back. Also posts nothing, and it is the evidence the
/// auto-match threshold is wrong when the line it undoes was `automatic`.
///
/// `Node` exposes `get` and `post` as conveniences over `request`; a DELETE
/// goes through `request` directly, which still carries the session cookie and
/// the CSRF header a write needs.
export function unmatchBankLine(
  lineId: string,
  signal?: AbortSignal
): Promise<{ matched: boolean }> {
  return node.request<{ matched: boolean }>(
    "DELETE",
    `/api/v1/finance/bank-lines/${encodeURIComponent(lineId)}/match`,
    undefined,
    { signal }
  )
}
