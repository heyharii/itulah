import { node } from "@/lib/api"
import type {
  AccountDetail,
  AccountMapPage,
  AccountMapping,
  AccountPage,
  AcquisitionGap,
  AllocateToBill,
  AssessAssetRequest,
  AssetPage,
  AssetRow,
  AssetSchedule,
  BalanceMatrix,
  BankStatementLineRow,
  BankStatementPage,
  BillPage,
  BookBankLineRequest,
  BankInstitution,
  CashCountRow,
  CompanyBankAccount,
  DescribeBankAccountRequest,
  PostCountRequest,
  RecordCountRequest,
  UpdateBankLineRequest,
  UpdateGiroPrintTemplateRequest,
  ConfirmMatchRequest,
  DepreciationRun,
  DisposeAssetRequest,
  CreateGiroPrintTemplateRequest,
  GeneralLedger,
  GiroPrintTemplate,
  ImportOutcome,
  ImportStatementRequest,
  JournalEntryDetail,
  JournalPage,
  LineSuggestions,
  MoneyOverview,
  PayablesAging,
  PaymentPage,
  PeriodPage,
  DecideInstructionRequest,
  DepositPage,
  InstructionPage,
  LandDepositRequest,
  PaymentInstruction,
  RaiseInstructionRequest,
  RecordBillRequest,
  RecordDepositRequest,
  RecordPaymentRequest,
  RegisterAssetRequest,
  SettleInstructionRequest,
  StoreDeposit,
  SetAccountMappingRequest,
  Statement,
  SupplierBill,
  SupplierPayment,
  TransferAssetRequest,
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

  /// Where the words go on each bank's giro leaf. One key for the lot: there
  /// are five banks and the calibration screen reads them all to draw its
  /// picker.
  giroPrintTemplates: (includeRetired: boolean) =>
    ["finance", "giro-print-templates", includeRetired] as const,

  accountChildren: (parent: string | null, inactive: boolean) =>
    ["finance", "accounts", "children", parent, inactive] as const,
  accountSearch: (needle: string, inactive: boolean) =>
    ["finance", "accounts", "search", needle, inactive] as const,
  /// `site` is part of the key because `accountDetail` takes it and the
  /// balance it fetches is a DIFFERENT balance for each one — "cash at
  /// Cikupa" is not a filtered view of "cash". Without it two units collided
  /// on one entry and the second to ask was served the first one's figure.
  ///
  /// Optional with a null default, so every existing caller keys exactly as
  /// it did.
  account: (code: string, asOf: string | null, site: string | null = null) =>
    ["finance", "accounts", "detail", code, asOf, site] as const,
  /// Every argument that changes the ANSWER, and not only the ones that
  /// change the window.
  ///
  /// `q`, `kind` and `limit` narrow the rows the server sends, so two
  /// searches of the same account over the same month are two different
  /// answers — and they were being held under one key, where the first to
  /// arrive was served to the second. The window totals are unaffected by
  /// any of them (see `GeneralLedger`), which is exactly why the collision
  /// was invisible: the headline figures agreed while the rows did not.
  ledger: (
    code: string,
    site: string | null,
    from: string | null,
    to: string | null,
    narrowing: {
      readonly q?: string | null
      readonly kind?: string | null
      readonly limit?: number | null
    } = {}
  ) =>
    [
      "finance",
      "ledger",
      code,
      site,
      from,
      to,
      narrowing.q ?? null,
      narrowing.kind ?? null,
      narrowing.limit ?? null,
    ] as const,

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
  /// Keyed by the month it was asked about, because the answer is about that
  /// month and a tab left open across midnight on the first should not keep
  /// showing December's answer.
  attention: (year: number, month: number) =>
    ["finance", "attention", year, month] as const,

  journal: (
    from: string | null,
    to: string | null,
    kind: string | null,
    site: string | null
  ) => ["finance", "journal", from, to, kind, site] as const,
  entry: (id: string) => ["finance", "journal", "entry", id] as const,

  /// The bill register. `site` is part of the key for the same reason
  /// `payments` already keys on one: `GET /finance/bills` has always taken it
  /// and narrows on the server, so a unit-filtered list is a different answer
  /// and not a slice of a wider one held here.
  bills: (status: string | null, site: string | null = null) =>
    ["finance", "bills", status, site] as const,
  /// One bill with what it was for. Its own key and not a slice of the list:
  /// the list deliberately sends `lines: null` — one query per row to draw a
  /// table is how a list gets slow without anybody being able to point at the
  /// reason — so "the bill" and "the bill and its lines" are two answers and
  /// must not overwrite each other.
  bill: (id: string) => ["finance", "bills", "detail", id] as const,
  unbilled: () => ["finance", "unbilled"] as const,

  /// What is owed, to whom, and how late — the server's own ageing rather than
  /// a bucketing of the bill list. Keyed on both arguments because both wind
  /// the report back: a bill invoiced after the reporting date is not yet a
  /// debt, and one location's payables is not another's.
  payablesAging: (asOf: string | null, site: string | null) =>
    ["finance", "payables-aging", asOf, site] as const,

  /// The payment register. Three filters, all of them the server's, so a
  /// narrowed list is a narrowed request and never a slice of a wider answer
  /// held in the browser.
  payments: (
    status: string | null,
    site: string | null,
    supplier: string | null
  ) => ["finance", "payments", status, site, supplier] as const,
  payment: (id: string) => ["finance", "payments", "detail", id] as const,

  assets: (unassessed: boolean, site: string | null) =>
    ["finance", "assets", unassessed, site] as const,
  /// What has actually been charged against one asset, month by month.
  assetSchedule: (id: string) => ["finance", "assets", "schedule", id] as const,
  /// The two halves of "what the books bought and what the register holds".
  /// No arguments: it is a whole-company exception report, not a filtered list.
  acquisitionGap: () => ["finance", "assets", "unbacked"] as const,

  /// Where the money sits, as at a date, at one location or all of them.
  money: (asOf: string | null, site: string | null) =>
    ["finance", "money", asOf, site] as const,
  /// What the bank has told us, for one unit or for all of them.
  ///
  /// `listBankStatements` takes `site` and narrows on the server, so the unit
  /// belongs in the key: without it a screen showing Store 03's statements and
  /// one showing the chain's were writing to the same entry, and whichever
  /// asked second read the other's rows.
  bankStatements: (site: string | null = null) =>
    ["finance", "bank-statements", site] as const,
  bankLines: (statementId: string) =>
    ["finance", "bank-statements", statementId, "lines"] as const,
  /// Counts of one drawer, or of all of them.
  /// Institutions gathered from every account that names one.
  bankInstitutions: () => ["finance", "banks"] as const,
  /// What our own accounts are, as opposed to where they post.
  companyBankAccounts: (site: string | null) =>
    ["finance", "bank-accounts", site] as const,
  cashCounts: (account: string | null, site: string | null) =>
    ["finance", "cash-counts", account, site] as const,
  bankSuggestions: (statementId: string, exact = true) =>
    ["finance", "bank-statements", statementId, "suggestions", exact] as const,

  /// The instruction queue. Both filters are the server's, so a narrowed list
  /// is a narrowed request and never a slice of a wider answer held in the
  /// browser — and both are in the key, because a key carrying neither would
  /// let one shop's queue overwrite the company's under the same entry.
  paymentInstructions: (status: string | null, site: string | null) =>
    ["finance", "payment-instructions", status, site] as const,
  paymentInstruction: (id: string) =>
    ["finance", "payment-instructions", "detail", id] as const,

  /// Deposits, narrowed on the server the same way.
  deposits: (status: string | null, site: string | null) =>
    ["finance", "deposits", status, site] as const,
  deposit: (id: string) => ["finance", "deposits", "detail", id] as const,
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
  options: { parent?: string; inactive?: boolean; cursor?: string } = {},
  signal?: AbortSignal
): Promise<AccountPage> {
  return node.get<AccountPage>(
    `/api/v1/finance/accounts${search({
      parent: options.parent,
      inactive: options.inactive,
      cursor: options.cursor,
    })}`,
    { signal }
  )
}

/// Find an account by code or by name. The server matches codes by prefix and
/// names anywhere, and it is the same endpoint as `accountChildren` — one
/// question ("which accounts am I looking at"), so a box that swapped
/// endpoints when somebody typed would have two loading states for one field.
export function searchAccounts(
  needle: string,
  options: {
    site?: string
    inactive?: boolean
    limit?: number
    sort?: string
    dir?: string
    cursor?: string
  } = {},
  signal?: AbortSignal
): Promise<AccountPage> {
  return node.get<AccountPage>(
    `/api/v1/finance/accounts${search({
      q: needle,
      site: options.site,
      inactive: options.inactive,
      limit: options.limit,
      sort: options.sort,
      dir: options.dir,
      cursor: options.cursor,
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
  options: {
    site?: string
    from?: string
    to?: string
    /// Narrows the ROWS only. `opening_minor`, `closing_minor` and the window
    /// totals stay totals of the whole window — see `GeneralLedger`.
    q?: string
    kind?: string
    sort?: string
    dir?: string
    cursor?: string
    limit?: number
  } = {},
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
  options: {
    as_of?: string
    site?: string
    /// Narrows the ROWS only. `total_debit_minor`, `total_credit_minor` and
    /// `balanced` stay figures about the whole ledger — see `TrialBalance`.
    q?: string
    class?: string
    sort?: string
    dir?: string
    cursor?: string
    limit?: number
  } = {},
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
/// Generated now — `AccountMapPage` — where it used to be transcribed by hand
/// because the handler built a `json!` of three separately generated pieces.
/// It carries the same three parts (`mappings` is `rows`), plus the envelope
/// every other finance list answers in and `unmapped_pairs`, which the server
/// counts over the whole map rather than over the page.
export type AccountMapView = AccountMapPage

/// The whole map by default, and deliberately.
///
/// The endpoint pages at 200; this asks for the server's ceiling instead,
/// because the Account Map screen's only real question — which (meaning,
/// location) pairs are still unset — is asked by walking every mapping against
/// every location, and cannot be answered from a page. 695 mappings at this
/// client against a ceiling of 1,000.
///
/// `total` is what makes that safe rather than hopeful: if the map ever
/// outgrows the ceiling, `rows.length < total` says so, and the server's own
/// `unmapped_pairs` — counted over everything, never over the page — is still
/// right either way.
export function accountMap(
  site?: string,
  signal?: AbortSignal,
  options: { q?: string; cursor?: string; limit?: number } = {}
): Promise<AccountMapPage> {
  return node.get<AccountMapPage>(
    `/api/v1/finance/account-map${search({
      site,
      q: options.q,
      cursor: options.cursor,
      limit: options.limit ?? 1000,
    })}`,
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

/// The three numbers the sidebar's Finance badge draws.
///
/// One request of about a hundred bytes, in place of the bill list, the period
/// list and the whole account map — 165 KB of mappings — which the sidebar
/// used to pull on every cold load of every screen in the app just to count
/// them.
///
/// The month is sent rather than left to the server: this browser's month is
/// the operator's month, and the node keeps UTC.
/// Only `month_not_open` is about the month that was asked for. The other two
/// are STANDING counts — every bill late today, every gap in the account map as
/// it stands — and the server now says so in `scopes` rather than leaving the
/// shape of the request to imply that all three move with the month.
export interface FinanceAttention {
  readonly overdue_bills: number
  readonly unmapped_pairs: number
  readonly month_not_open: number
  readonly attention: number
  /// The month the badge was asked about, echoed back.
  readonly year: number
  readonly month: number
  /// The day the STANDING counts were taken on, `YYYY-MM-DD`.
  readonly as_of: string
  /// `MONTH` or `STANDING`, per count.
  readonly scopes: {
    readonly overdue_bills: "STANDING"
    readonly unmapped_pairs: "STANDING"
    readonly month_not_open: "MONTH"
  }
}

export function financeAttention(
  year: number,
  month: number,
  signal?: AbortSignal
): Promise<FinanceAttention> {
  return node.get<FinanceAttention>(
    `/api/v1/finance/attention?year=${year}&month=${month}`,
    { signal }
  )
}

export function listPeriods(
  signal?: AbortSignal,
  options: { q?: string; cursor?: string; limit?: number } = {}
): Promise<PeriodPage> {
  return node.get<PeriodPage>(`/api/v1/finance/periods${search(options)}`, {
    signal,
  })
}

/// A month must be opened before anything can post into it — otherwise "post
/// into whatever month the date says" files a mistyped invoice in 2062. The
/// refusal comes from the database, not from a check here, and answers with
/// the whole list so the screen never has to guess what changed.
export function openPeriod(
  year: number,
  month: number,
  signal?: AbortSignal
): Promise<PeriodPage> {
  return node.post<PeriodPage>(
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

/// The register, narrowed by window, by what caused the entry, and by where.
///
/// `kind` is one of the source kinds the schema's own CHECK allows —
/// `MANUAL`, `SUPPLIER_INVOICE`, `PAYMENT`, `DEPRECIATION`, `REVERSAL` and the
/// three the till and the warehouse write. Absent means every kind, which is
/// what the register is for.
export function listJournal(
  options: {
    from?: string
    to?: string
    kind?: string
    site?: string
    limit?: number
    /// Free text over the entry number, the memo and the source document's
    /// own id. The SERVER searches; a browser filtering the page it holds can
    /// only find what it already fetched.
    q?: string
    sort?: string
    dir?: string
    cursor?: string
  } = {},
  signal?: AbortSignal
): Promise<JournalPage> {
  return node.get<JournalPage>(`/api/v1/finance/journal${search(options)}`, {
    signal,
  })
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

export type StatementKind = "BALANCE_SHEET" | "PROFIT_LOSS" | "CASH_FLOW"

/// The balance sheet, the profit and loss, or the cash flow.
///
/// The first two are built from the client's own root classes and come back as
/// the ledger holds them — debits positive — with the screen deciding how a
/// credit-natured class should read.
///
/// `CASH_FLOW` is a different report and says so on the wire. It is the DIRECT
/// method: the accounts the account map calls money are read, every entry that
/// touched one in the window is opened, and the cash is attributed to the other
/// side of that entry. Nothing is added back to a profit figure, because the
/// per-account operating/investing/financing classification the indirect method
/// needs is data this chart does not carry.
///
/// Two consequences for a screen drawing it. `amount_minor` is the CASH effect
/// and positive means money came in — the opposite of the sign convention on
/// the other two, deliberately. And `out_of_balance_minor` is a real check
/// rather than always zero: `opening_cash + result - closing_cash`, non-zero
/// when cash moved in a way the sections do not explain, which is worth showing
/// rather than hiding.
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

/// The bill register.
///
/// `GET /finance/bills` grew a search, a sort, a keyset cursor and facet
/// counts, and with them an envelope: `{ rows, next_cursor, total,
/// total_minor, outstanding_minor, facets }` rather than the bare array it
/// used to answer with.
///
/// This used to unwrap to `rows` behind a hand-written `{ rows: SupplierBill[]
/// }`, declared here because `make contract` had not been run for the
/// envelope. It has: `BillPage` is generated from the server's own struct. The
/// unwrap went with the local type, because the four fields it was throwing
/// away are the four a screen cannot compute — `total` is how many the server
/// has, and a browser that adds up a capped list to get `total_minor` or
/// `outstanding_minor` is reporting the size of its own page.
///
/// `site` is forwarded. The endpoint has always taken it and narrows on the
/// server; nothing here sent it, so a unit-filtered bill list was a
/// possibility the wrapper quietly withheld.
///
/// `limit` defaults to 200 and did not used to have to: the server's default
/// was 200 and is now "everything, unpaged", because a caller that asks for a
/// whole list and adds it up must not silently be answered with the first
/// page. Every screen behind this function is such a caller AND draws a table,
/// so the old ceiling is kept here deliberately — moving it is a decision about
/// a screen, not about a wrapper. `rows.length < total` is now how a screen
/// can see that it was capped.
export function listBills(
  options: {
    status?: string
    supplier?: string
    site?: string
    limit?: number
  } = {},
  signal?: AbortSignal
): Promise<BillPage> {
  return node.get<BillPage>(
    `/api/v1/finance/bills${search({ limit: 200, ...options })}`,
    { signal }
  )
}

/// One bill, and what it was for.
///
/// The list sends `lines: null` on every row deliberately — `lines` is fetched
/// per bill, and a hundred rows drawing a hundred and one queries is how a list
/// gets slow without anybody being able to point at the reason. So an expense
/// bill's lines are only ever read here.
///
/// `Some([])` and `null` are different answers and the caller has to keep them
/// apart: a merchandise bill genuinely has no lines, and a list row simply has
/// not been asked.
export function billDetail(
  invoiceId: string,
  signal?: AbortSignal
): Promise<SupplierBill> {
  return node.get<SupplierBill>(
    `/api/v1/finance/bills/${encodeURIComponent(invoiceId)}`,
    { signal }
  )
}

/// Write a supplier's invoice down. Recording and posting are two acts: a bill
/// can arrive, be queried and be held before anybody decides it may be paid.
///
/// `kind` decides what the posting will debit, and therefore whether `lines`
/// means anything: a MERCHANDISE bill is refused if it carries any, and an
/// EXPENSE bill is refused if it carries none. The answer comes back *with* its
/// lines, so a caller can seed `financeKeys.bill()` from it rather than reading
/// the bill it just wrote.
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

/// What is owed, to whom, and how late.
///
/// The server's ageing and not the browser's. Bucketing the bill list here
/// would look identical and be wrong twice: it ages the whole invoice rather
/// than what is still outstanding on it, and it cannot wind a payment back —
/// asking "as at the end of last month" has to un-count money that left the
/// bank since, which only a query over both sides can do.
export function payablesAging(
  options: { as_of?: string; site?: string } = {},
  signal?: AbortSignal
): Promise<PayablesAging> {
  return node.get<PayablesAging>(
    `/api/v1/finance/payables-aging${search(options)}`,
    { signal }
  )
}

// ---------------------------------------------------------------------------
// Supplier payments
// ---------------------------------------------------------------------------

/// The payment register.
///
/// `supplier` narrows on the *allocations* rather than on the payment: one
/// bank line settling two suppliers is an ordinary Friday, so a payment does
/// not have a supplier of its own.
///
/// Answers in the server's own envelope — see `listBills`, which says why the
/// hand-written `{ rows }` and the unwrap behind it are both gone.
export function listPayments(
  options: {
    status?: string
    site?: string
    supplier?: string
    limit?: number
  } = {},
  signal?: AbortSignal
): Promise<PaymentPage> {
  return node.get<PaymentPage>(
    `/api/v1/finance/payments${search({ limit: 200, ...options })}`,
    { signal }
  )
}

export function payment(
  paymentId: string,
  signal?: AbortSignal
): Promise<SupplierPayment> {
  return node.get<SupplierPayment>(
    `/api/v1/finance/payments/${encodeURIComponent(paymentId)}`,
    { signal }
  )
}

/// Write a payment down. It is not in the books yet — recording and posting
/// are two acts here for the same reason they are two acts on a bill: money
/// leaving the bank and the decision to book it are different moments, and one
/// of them can be keyed on a day the other cannot.
///
/// `account_key` + `account_qualifier` and never an account code: which
/// account `bank_giro` at store 07 *is* belongs to `account_map`, and storing
/// the code on the payment would be a second copy of the map that stops
/// agreeing with it.
///
/// The idempotency key is the caller's and is held across retries, exactly as
/// the journal's is: a double-clicked Record must write one payment and get
/// the same receipt twice, and this write reserves money against bills.
export function recordPayment(
  request: RecordPaymentRequest,
  idempotencyKey: string,
  signal?: AbortSignal
): Promise<SupplierPayment> {
  return node.post<SupplierPayment>("/api/v1/finance/payments", request, {
    signal,
    headers: { "Idempotency-Key": idempotencyKey },
  })
}

/// Put a recorded payment into the books. With no date the server posts it on
/// the payment date, which is what "post this payment" means without further
/// comment — and the date is separate because money that left on the 31st and
/// was keyed on the 2nd belongs to the month it left.
export function postPayment(
  paymentId: string,
  postingDate?: string,
  signal?: AbortSignal
): Promise<SupplierPayment> {
  return node.post<SupplierPayment>(
    `/api/v1/finance/payments/${encodeURIComponent(paymentId)}/post`,
    { posting_date: postingDate },
    { signal }
  )
}

/// One line of "what this payment is for", as the composer builds it.
///
/// Re-exported rather than imported at every call site for the same reason
/// `ManualLine` is spelled out above: a screen assembling a request should be
/// able to name the shape it is assembling without reaching past this file.
export type { AllocateToBill }

// ---------------------------------------------------------------------------
// Fixed assets
// ---------------------------------------------------------------------------

/// The register. `unassessed` asks for the open control gap directly — assets
/// Operations has registered that Finance has not yet decided a treatment for.
export function listAssets(
  options: {
    site?: string
    category?: string
    unassessed?: boolean
    q?: string
    decision?: string
    status?: string
    sort?: string
    dir?: string
    cursor?: string
    limit?: number
  } = {},
  signal?: AbortSignal
): Promise<AssetPage> {
  return node.get<AssetPage>(`/api/v1/finance/assets${search(options)}`, {
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

/// What was charged against one asset, month by month, and what is left.
///
/// The record and not a projection: a month the run never reached is simply not
/// in `charged`, which is the only way to see that a run has been quietly
/// skipping an asset. `months_remaining` comes from the calendar for the same
/// reason — counting entries would leave a small asset permanently short of its
/// last instalment.
export function assetSchedule(
  assetId: string,
  signal?: AbortSignal
): Promise<AssetSchedule> {
  return node.get<AssetSchedule>(
    `/api/v1/finance/assets/${encodeURIComponent(assetId)}/schedule`,
    { signal }
  )
}

/// Where the register and the books disagree about what was bought.
///
/// Two lists, because they are different faults with different fixes: a
/// capitalised asset with no bill line behind it is a cost the books never
/// bought, and a posted `10215*` bill line with no asset against it is a
/// capital purchase nobody put on the register. There is no acquisition posting
/// rule and there will not be one — an asset is bought by a supplier bill — so
/// this is the only place either side is visible.
export function acquisitionGap(signal?: AbortSignal): Promise<AcquisitionGap> {
  return node.get<AcquisitionGap>("/api/v1/finance/assets/unbacked", { signal })
}

/// Take an asset off the books: cost out, accumulated depreciation out,
/// proceeds in, and the difference to the gain-or-loss account.
///
/// Not reversible from any screen. The refusals are the server's and are worth
/// reading verbatim — it declines an asset that is not capitalised, one already
/// gone, one the depreciation run still owes a charge for the month it left in,
/// and any disposal at all while `asset_disposal_result` has no account at that
/// location.
export function disposeAsset(
  assetId: string,
  request: DisposeAssetRequest,
  signal?: AbortSignal
): Promise<AssetRow> {
  return node.post<AssetRow>(
    `/api/v1/finance/assets/${encodeURIComponent(assetId)}/dispose`,
    request,
    { signal }
  )
}

/// Move an asset, and move its cost and accumulated depreciation with it.
///
/// Both halves, because the client keeps a profit and loss per location: moving
/// the cost alone leaves two locations wrong by the same amount in opposite
/// directions, which a trial balance cannot see. A move to where the asset
/// already is is refused by the database — the entry would debit and credit the
/// same account at the same location, which balances perfectly and is a lie.
export function transferAsset(
  assetId: string,
  request: TransferAssetRequest,
  signal?: AbortSignal
): Promise<AssetRow> {
  return node.post<AssetRow>(
    `/api/v1/finance/assets/${encodeURIComponent(assetId)}/transfer`,
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

/// Every place money sits, what the books say it holds, and what the bank last
/// said.
///
/// One row per mapped money account per location — so it is the account map
/// read through the ledger, and a meaning nobody has mapped is simply not a
/// place money can sit yet. `per_books_minor` comes back in the account's own
/// sign and deliberately unflipped: `giro_outstanding` is a liability and is
/// negative, which is what it is.
///
/// `difference_minor` is absent rather than zero when no statement has been
/// imported. "We agree" and "there is nothing to agree with" are different
/// answers and must not render the same.
export function moneyOverview(
  options: { as_of?: string; site?: string } = {},
  signal?: AbortSignal
): Promise<MoneyOverview> {
  return node.get<MoneyOverview>(`/api/v1/finance/money${search(options)}`, {
    signal,
  })
}

export function listBankStatements(
  signal?: AbortSignal,
  options: {
    q?: string
    site?: string
    account?: string
    state?: string
    sort?: string
    dir?: string
    cursor?: string
    limit?: number
  } = {}
): Promise<BankStatementPage> {
  return node.get<BankStatementPage>(
    `/api/v1/finance/bank-statements${search(options)}`,
    { signal }
  )
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
  signal?: AbortSignal,
  /// ERPNext's *exact match* switch. Off widens the offer to vouchers that can
  /// only cover PART of the line — the only way to begin splitting one bank
  /// line across two bills, since a transfer paying two suppliers equals
  /// neither of them.
  exact = true
): Promise<LineSuggestions[]> {
  return node.get<LineSuggestions[]>(
    `/api/v1/finance/bank-statements/${encodeURIComponent(statementId)}/suggestions${
      exact ? "" : "?exact=0"
    }`,
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

/// What booking an unmatched bank line answers with. Hand-written — `json!()`,
/// not a struct.
export interface BookedBankLine {
  readonly entry_id: string
  readonly entry_number: string
  readonly journal_line_id: string
  readonly total_minor: number
  readonly matched: boolean
}

/// The other half of reconciling: a line the bank has and the books do not.
///
/// Matching says the bank confirmed something we already recorded. This says
/// the bank did something we never recorded — a monthly charge, interest
/// credited, a transfer that arrived without a document — and puts it in the
/// ledger. It is the one place in this screen that writes an entry, which is
/// why it takes a memo and why the memo is required: it is the only record of
/// the judgement somebody made, and a bank line booked with no explanation is
/// the entry an auditor asks about first.
///
/// The entry and the match are one transaction on the server, so the line never
/// exists in the state where it has been booked and nothing points at what
/// booked it.
export function bookBankLine(
  lineId: string,
  request: BookBankLineRequest,
  signal?: AbortSignal
): Promise<BookedBankLine> {
  return node.post<BookedBankLine>(
    `/api/v1/finance/bank-lines/${encodeURIComponent(lineId)}/book`,
    request,
    { signal }
  )
}

// ---------------------------------------------------------------------------
// Our own bank accounts
// ---------------------------------------------------------------------------

/// Every bank anybody has named — ours and our suppliers' together. Gathered
/// from the accounts that name them, never maintained as a list.
export function listBankInstitutions(
  signal?: AbortSignal
): Promise<BankInstitution[]> {
  return node.get<BankInstitution[]>("/api/v1/finance/banks", { signal })
}

/// What our accounts are — number, holder, branch, which one a place pays out
/// of. Separate from the account map, which says where their postings land.
export function listCompanyBankAccounts(
  signal?: AbortSignal,
  options: { site?: string } = {}
): Promise<CompanyBankAccount[]> {
  return node.get<CompanyBankAccount[]>(
    `/api/v1/finance/bank-accounts${search(options)}`,
    { signal }
  )
}

/// Describe an account, or correct what we said about it. One row per ledger
/// binding, so sending it twice is a correction and not a second account.
export function describeBankAccount(
  request: DescribeBankAccountRequest,
  signal?: AbortSignal
): Promise<CompanyBankAccount> {
  return node.post<CompanyBankAccount>(
    "/api/v1/finance/bank-accounts",
    request,
    { signal }
  )
}

export function retireBankAccount(
  accountId: string,
  signal?: AbortSignal
): Promise<CompanyBankAccount> {
  return node.post<CompanyBankAccount>(
    `/api/v1/finance/bank-accounts/${encodeURIComponent(accountId)}/retire`,
    {},
    { signal }
  )
}

// ---------------------------------------------------------------------------
// Cash counts
// ---------------------------------------------------------------------------

/// Every physical count, newest first.
export function listCashCounts(
  signal?: AbortSignal,
  options: { account?: string; site?: string } = {}
): Promise<CashCountRow[]> {
  return node.get<CashCountRow[]>(
    `/api/v1/finance/cash-counts${search(options)}`,
    { signal }
  )
}

/// Write down what was in the drawer. Posts nothing: a count is an
/// observation, and putting its difference in the books is a second act by
/// somebody who has read the reason.
export function recordCashCount(
  request: RecordCountRequest,
  signal?: AbortSignal
): Promise<CashCountRow> {
  return node.post<CashCountRow>("/api/v1/finance/cash-counts", request, {
    signal,
  })
}

/// Put the difference in the books. Refused when the count has no reason, when
/// the drawer and the books agree, and when it has been posted already.
export function postCashCount(
  countId: string,
  request: PostCountRequest = { reason: "" },
  signal?: AbortSignal
): Promise<CashCountRow> {
  return node.post<CashCountRow>(
    `/api/v1/finance/cash-counts/${encodeURIComponent(countId)}/post`,
    request,
    { signal }
  )
}

/// Say who the other side of a bank line was.
///
/// ERPNext's *Update Bank Transaction*, narrowed: the bank's own narration,
/// amount, date and reference are evidence and stay read-only, so this writes
/// only what a person concluded — the counterparty and a note.
export function updateBankLine(
  lineId: string,
  request: UpdateBankLineRequest,
  signal?: AbortSignal
): Promise<BankStatementLineRow> {
  return node.request<BankStatementLineRow>(
    "PATCH",
    `/api/v1/finance/bank-lines/${encodeURIComponent(lineId)}`,
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
  signal?: AbortSignal,
  /// One voucher's claim. Absent releases the line entirely, which is what
  /// this meant before a line could be settled by more than one.
  journalLineId?: string
): Promise<{ matched: boolean }> {
  return node.request<{ matched: boolean }>(
    "DELETE",
    `/api/v1/finance/bank-lines/${encodeURIComponent(lineId)}/match${
      journalLineId === undefined
        ? ""
        : `?journal_line=${encodeURIComponent(journalLineId)}`
    }`,
    undefined,
    { signal }
  )
}

// ---------------------------------------------------------------------------
// Giro printing
//
// Not a document we produce. A bilyet giro is the bank's own leaf, already
// carrying its number; what a printer adds is nine facts, and the whole problem
// is landing them on boxes that are already there. So these read and write
// COORDINATES — see `0222`.

export function giroPrintTemplates(
  includeRetired = false,
  signal?: AbortSignal
): Promise<GiroPrintTemplate[]> {
  const query = includeRetired ? "?include_retired=true" : ""
  return node.get<GiroPrintTemplate[]>(
    `/api/v1/finance/giro-print-templates${query}`,
    { signal }
  )
}

export function createGiroPrintTemplate(
  request: CreateGiroPrintTemplateRequest,
  idempotencyKey: string,
  signal?: AbortSignal
): Promise<GiroPrintTemplate> {
  return node.post<GiroPrintTemplate>(
    "/api/v1/finance/giro-print-templates",
    request,
    { signal, headers: { "Idempotency-Key": idempotencyKey } }
  )
}

/// Save a calibration. The whole layout goes at once, with the template's own
/// version as an `If-Match`: two people nudging the same leaf cannot both win,
/// and a half-saved layout is one that prints.
export function saveGiroPrintTemplate(
  templateId: string,
  request: UpdateGiroPrintTemplateRequest,
  version: number,
  idempotencyKey: string,
  signal?: AbortSignal
): Promise<GiroPrintTemplate> {
  return node.request<GiroPrintTemplate>(
    "PATCH",
    `/api/v1/finance/giro-print-templates/${encodeURIComponent(templateId)}`,
    request,
    {
      signal,
      headers: {
        "Idempotency-Key": idempotencyKey,
        "If-Match": `"${version}"`,
      },
    }
  )
}

// ---------------------------------------------------------------------------
// Payment instructions
// ---------------------------------------------------------------------------

/// The queue of asks: what shops have sent head office, and what happened to
/// each.
///
/// Answers the envelope `GET /finance/bills` and `GET /finance/payments`
/// answer in, and this one is NOT unwrapped here. The screen wants
/// `open_minor` and the status facet counts — a queue that could only say how
/// many rows it drew would be a queue nobody could work from — so the whole
/// page comes through.
///
/// `limit` is deliberately not sent: without one the server answers the whole
/// matched set unpaged, which is what a screen that adds a column up needs.
export function listPaymentInstructions(
  options: { status?: string; site?: string; sort?: string } = {},
  signal?: AbortSignal
): Promise<InstructionPage> {
  return node.get<InstructionPage>(
    `/api/v1/finance/payment-instructions${search(options)}`,
    { signal }
  )
}

export function paymentInstruction(
  instructionId: string,
  signal?: AbortSignal
): Promise<PaymentInstruction> {
  return node.get<PaymentInstruction>(
    `/api/v1/finance/payment-instructions/${encodeURIComponent(instructionId)}`,
    { signal }
  )
}

/// Raise one. `submit: true` sends it in the same act that writes it.
///
/// Nothing here reaches the ledger, now or at any later rung: the accounting
/// happens in the bill and the payment the ask becomes.
export function raisePaymentInstruction(
  request: RaiseInstructionRequest,
  signal?: AbortSignal
): Promise<PaymentInstruction> {
  return node.post<PaymentInstruction>(
    "/api/v1/finance/payment-instructions",
    request,
    { signal }
  )
}

/// Send a draft. The ask becomes head office's to answer.
export function submitPaymentInstruction(
  instructionId: string,
  signal?: AbortSignal
): Promise<PaymentInstruction> {
  return node.post<PaymentInstruction>(
    `/api/v1/finance/payment-instructions/${encodeURIComponent(instructionId)}/submit`,
    {},
    { signal }
  )
}

/// Head office's yes or no.
///
/// Approving means naming the vendor the payee turned out to be; the server
/// refuses without one, because until the payee is a vendor the ask cannot
/// become a payable anybody can age.
export function decidePaymentInstruction(
  instructionId: string,
  request: DecideInstructionRequest,
  signal?: AbortSignal
): Promise<PaymentInstruction> {
  return node.post<PaymentInstruction>(
    `/api/v1/finance/payment-instructions/${encodeURIComponent(instructionId)}/decide`,
    request,
    { signal }
  )
}

/// The shop takes its own ask back. Not a refusal — that is a decision head
/// office made, and one status could not tell the two apart afterwards.
export function withdrawPaymentInstruction(
  instructionId: string,
  signal?: AbortSignal
): Promise<PaymentInstruction> {
  return node.post<PaymentInstruction>(
    `/api/v1/finance/payment-instructions/${encodeURIComponent(instructionId)}/withdraw`,
    {},
    { signal }
  )
}

/// Bind the bill and the payment the ask became. The payment must already be
/// posted, which is what makes Paid a fact rather than a click.
export function settlePaymentInstruction(
  instructionId: string,
  request: SettleInstructionRequest,
  signal?: AbortSignal
): Promise<PaymentInstruction> {
  return node.post<PaymentInstruction>(
    `/api/v1/finance/payment-instructions/${encodeURIComponent(instructionId)}/settle`,
    request,
    { signal }
  )
}

// ---------------------------------------------------------------------------
// Deposits
// ---------------------------------------------------------------------------

/// Takings on their way from a drawer to a bank account.
///
/// The envelope comes through whole for `in_transit_minor`, which is the one
/// figure this list exists to report and the one a browser must not compute:
/// it is what the unit has in the air, not what the visible rows add up to, so
/// filtering to LANDED leaves it unchanged.
export function listDeposits(
  options: { status?: string; site?: string; sort?: string } = {},
  signal?: AbortSignal
): Promise<DepositPage> {
  return node.get<DepositPage>(`/api/v1/finance/deposits${search(options)}`, {
    signal,
  })
}

export function depositDetail(
  depositId: string,
  signal?: AbortSignal
): Promise<StoreDeposit> {
  return node.get<StoreDeposit>(
    `/api/v1/finance/deposits/${encodeURIComponent(depositId)}`,
    { signal }
  )
}

/// Write the slip down. Posts nothing unless `bank_now` says the bag has
/// already gone.
export function recordDeposit(
  request: RecordDepositRequest,
  signal?: AbortSignal
): Promise<StoreDeposit> {
  return node.post<StoreDeposit>("/api/v1/finance/deposits", request, {
    signal,
  })
}

/// The bag leaves the till: credit the drawer, debit cash in transit, on the
/// day it was banked.
export function bankDeposit(
  depositId: string,
  signal?: AbortSignal
): Promise<StoreDeposit> {
  return node.post<StoreDeposit>(
    `/api/v1/finance/deposits/${encodeURIComponent(depositId)}/bank`,
    {},
    { signal }
  )
}

/// The bank credited it: debit the bank, credit cash in transit, on the bank's
/// own date. This is the posting a statement line agrees with.
export function landDeposit(
  depositId: string,
  request: LandDepositRequest,
  signal?: AbortSignal
): Promise<StoreDeposit> {
  return node.post<StoreDeposit>(
    `/api/v1/finance/deposits/${encodeURIComponent(depositId)}/land`,
    request,
    { signal }
  )
}
