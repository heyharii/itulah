import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query"

import { node } from "@/lib/api"
import {
  listPurchaseOrders,
  paymentTermsBook,
  procurementKeys,
} from "@/lib/queries/procurement"
import type {
  AccountBalance,
  AccountDetail,
  AccountLink,
  AccountLinkChange,
  AccountLinkPage,
  AccountPage,
  AcquisitionGap,
  AssetDepreciationStatus,
  AllocateToBill,
  AssessAssetRequest,
  AssetPage,
  AssetRow,
  AssetSchedule,
  BalanceMatrix,
  BankRuleRow,
  BankRuleRunOutcome,
  BankStatementLineRow,
  BankStatementPage,
  BillPage,
  BillWarning,
  BookBankLineRequest,
  BookOnlyLine,
  BankInstitution,
  ChartChange,
  ChartChangeRequest,
  CashCountRow,
  CompanyBankAccount,
  DescribeBankAccountRequest,
  PeriodEvent,
  RecordBankRuleRequest,
  TransactionCategoryRow,
  PostCountRequest,
  RecordCountRequest,
  SettleGiroRequest,
  UpdateBankLineRequest,
  UpdateGiroPrintTemplateRequest,
  ConfirmMatchRequest,
  CreditNote,
  CreditNoteRefundRequest,
  CreditNoteRequest,
  DepreciationRun,
  EdcMachine,
  EdcMachineBook,
  DisposeAssetRequest,
  CreateGiroPrintTemplateRequest,
  GeneralLedger,
  GiroPrintTemplate,
  GiroRow,
  ImportOutcome,
  ImportStatementRequest,
  JournalEntryDetail,
  JournalPage,
  LineSuggestions,
  MoneyOverview,
  PartyMovements,
  PayablesAging,
  PaymentLedgerView,
  PaymentPage,
  PeriodPage,
  PostingReadiness,
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
  SetAccountLinkRequest,
  Statement,
  SupplierAdvance,
  SupplierAdvanceApplyRequest,
  SupplierBill,
  SupplierPayment,
  TransferAssetRequest,
  TrialBalance,
  UnbilledPage,
  UnbilledReceipt,
  AccountingDimension,
  AccountSourceRule,
  DimensionResult,
  DimensionValue,
  ExpenseCategory,
  FinanceSetting,
  HeadOfficeAccount,
  PayComponentPosting,
  PaymentMethodSetting,
  PeriodClosingRequest,
  PeriodClosingVoucher,
  PostingSwitch,
  PostingSwitches,
  RolePermission,
  SaveAssetClassRequest,
  SaveDimensionRequest,
  SaveEdcMachineRequest,
  SaveExpenseCategoryRequest,
  SavePaymentMethodRequest,
  SetShopOtherMethodsRequest,
  SetSitePaymentMethodsRequest,
  SitePaymentMethod,
  SetAutomaticPostingRequest,
  SetFinanceSettingRequest,
  SetPayComponentPostingRequest,
  TaxTemplate,
  TaxType,
  TaxTypeSetting,
  JournalRepeat,
  JournalRepeatSweep,
  JournalTemplate,
  SaveJournalRepeatRequest,
  SaveJournalTemplateRequest,
} from "@itulah/contract"

/// The finance wire, and the keys its answers are held under.
///
/// Almost every type here is generated from the Rust struct the server
/// serialises, so there is nothing to keep in step by hand. The exceptions
/// are marked where they appear: `/periods/close`,
/// the period checklist, `/journal` (POST) and `/journal/{id}/reverse` answer
/// with JSON values rather than generated DTOs, so their shapes are
/// transcribed here. If one of them starts reading `undefined`, this file is
/// where it went stale.
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

  /// Stock at cost, per article and site; `unit` narrows it to one unit.
  inventoryValuation: (unit: string | null) =>
    ["finance", "inventory-valuation", unit] as const,
  stockVsLedger: () => ["finance", "stock-vs-ledger"] as const,
  /// Every shop's EDC machines, the banks and the accounts they settle to.
  edcMachines: () => ["finance", "edc-machines"] as const,
  goodsInTransit: () => ["finance", "goods-in-transit"] as const,
  cogs: (year: number) => ["finance", "cogs", year] as const,
  stockAdjustments: () => ["finance", "stock-adjustments"] as const,

  /// Where the words go on each bank's giro leaf. One key for the lot: there
  /// are five banks and the calibration screen reads them all to draw its
  /// picker.
  giroPrintTemplates: (includeRetired: boolean) =>
    ["finance", "giro-print-templates", includeRetired] as const,

  /// One party's ledger over a window. Every argument changes the answer.
  partyMovements: (
    partyType: string,
    partyId: string,
    from: string,
    to: string,
    unit: string | null
  ) =>
    ["finance", "party-movements", partyType, partyId, from, to, unit] as const,

  /// The recurring-bill promises — one list, unfiltered by the server. See
  /// `listBillTemplates`.
  billTemplates: () => ["finance", "bill-templates"] as const,

  /// The credit notes, narrowed on the server by status and supplier — a
  /// narrowed list is a narrowed request, not a slice of a wider one held here.
  creditNotes: (status: string | null, supplier: string | null) =>
    ["finance", "credit-notes", status, supplier] as const,

  /// Every asset the register holds under one narrowing, followed to the last
  /// page. Under `assets` so a disposal or an assessment, which invalidates
  /// that prefix, refreshes the two asset reports as well.
  assetsAll: (
    decision: string | null,
    status: string | null,
    site: string | null
  ) => ["finance", "assets", "all", decision, status, site] as const,

  accountChildren: (parent: string | null, inactive: boolean) =>
    ["finance", "accounts", "children", parent, inactive] as const,
  /// Under `accounts` so posting anything that invalidates the chart's reads
  /// catches the figures beside it too.
  accountBalances: (parent: string | null, unit: string | null) =>
    ["finance", "accounts", "balances", parent, unit] as const,
  accountSearch: (needle: string, inactive: boolean) =>
    ["finance", "accounts", "search", needle, inactive] as const,
  /// `unit` is part of the key because `accountDetail` takes it and the
  /// balance it fetches is a DIFFERENT balance for each one — "cash in
  /// Cikupa's books" is not a filtered view of "cash". Without it two units
  /// collided on one entry and the second to ask was served the first one's
  /// figure.
  ///
  /// Optional with a null default, so every existing caller keys exactly as
  /// it did.
  account: (code: string, asOf: string | null, unit: string | null = null) =>
    ["finance", "accounts", "detail", code, asOf, unit] as const,
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
    unit: string | null,
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
      unit,
      from,
      to,
      narrowing.q ?? null,
      narrowing.kind ?? null,
      narrowing.limit ?? null,
    ] as const,

  trialBalance: (asOf: string | null, unit: string | null) =>
    ["finance", "trial-balance", asOf, unit] as const,
  balances: (family: string, asOf: string | null) =>
    ["finance", "balances", family, asOf] as const,
  statement: (
    kind: string,
    from: string | null,
    to: string | null,
    unit: string | null
  ) => ["finance", "statement", kind, from, to, unit] as const,

  /// The categories a journal line may carry, and the families they belong
  /// to. One key per family plus one for the lot, because the picker asks for
  /// one family at a time and the reference screen asks for all of them —
  /// two different answers, and a shared key would let the narrow one
  /// overwrite the wide one.
  ///
  /// `null` is "every family", which is what the reference screen reads.
  lineCategories: (family: string | null) =>
    ["finance", "line-categories", family] as const,
  /// The client's asset classes. Not a category family: an asset account's
  /// identity is the asset it names, and the class is read off the register.
  assetClasses: () => ["finance", "asset-classes"] as const,

  /// Everything read off the account links lives under one prefix, so a
  /// link saved or removed invalidates the list, the readiness matrix, the
  /// history and every unit's resolved accounts with one call:
  /// `invalidateQueries({ queryKey: financeKeys.accountLinksAll })`.
  accountLinksAll: ["finance", "account-links"] as const,
  accountLinks: (q: string | null, role: string | null) =>
    ["finance", "account-links", "page", q, role] as const,
  accountLinkHistory: (role: string | null) =>
    ["finance", "account-links", "history", role] as const,
  postingReadiness: () => ["finance", "account-links", "readiness"] as const,
  unitAccounts: (unit: string | null) =>
    ["finance", "account-links", "unit", unit] as const,
  /// The chart's own change log. Under `accounts` so the same invalidation
  /// that refreshes the tree after a change refreshes the history too.
  chartChanges: (account: string | null) =>
    ["finance", "accounts", "changes", account] as const,
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
    unit: string | null
  ) => ["finance", "journal", from, to, kind, unit] as const,
  entry: (id: string) => ["finance", "journal", "entry", id] as const,

  /// The bill register. `site` is part of the key for the same reason
  /// `payments` keys on its unit: `GET /finance/bills` has always taken it and
  /// narrows on the server, so a site-filtered list is a different answer and
  /// not a slice of a wider one held here. A bill stays at the site it was
  /// received at; its books are the unit owning that site.
  ///
  /// `draftFrom` is the GA inbox's own filter: `?draft_from=GA` answers the
  /// drafts Operations filed and Finance is to inspect, which are a different
  /// population from the rest of the DRAFT bills and so a different answer
  /// under a different key.
  bills: (
    status: string | null,
    site: string | null = null,
    draftFrom: string | null = null
  ) => ["finance", "bills", status, site, draftFrom] as const,
  /// One bill with what it was for. Its own key and not a slice of the list:
  /// the list deliberately sends `lines: null` — one query per row to draw a
  /// table is how a list gets slow without anybody being able to point at the
  /// reason — so "the bill" and "the bill and its lines" are two answers and
  /// must not overwrite each other.
  bill: (id: string) => ["finance", "bills", "detail", id] as const,
  /// What the server warns about before a bill is posted. Its own key because
  /// it is asked for on demand, one bill at a time, and never appears in any
  /// list read.
  billWarnings: (id: string) => ["finance", "bills", "warnings", id] as const,
  /// A bill's item lines, and what has settled it. Under `bills` so posting,
  /// paying or applying an advance — all of which invalidate `finance` — read
  /// them again.
  billLines: (id: string) => ["finance", "bills", "lines", id] as const,
  billSettlements: (id: string) =>
    ["finance", "bills", "settlements", id] as const,
  advance: (id: string) =>
    ["finance", "supplier-advances", "detail", id] as const,
  unbilled: () => ["finance", "unbilled"] as const,

  /// What is owed, to whom, and how late — the server's own ageing rather than
  /// a bucketing of the bill list. Keyed on both arguments because both wind
  /// the report back: a bill invoiced after the reporting date is not yet a
  /// debt, and one unit's payables is not another's.
  payablesAging: (asOf: string | null, unit: string | null) =>
    ["finance", "payables-aging", asOf, unit] as const,

  /// The deliveries the payables ageing counts that no supplier bill covers
  /// yet — open items of the payment ledger, one per goods receipt. Under the
  /// same `finance` prefix, and wound back the same two ways, so a screen
  /// that draws the ageing and this list is drawing one set of documents.
  openDeliveries: (asOf: string | null, unit: string | null) =>
    ["finance", "payables-deliveries", asOf, unit] as const,

  /// The payment register. Three filters, all of them the server's, so a
  /// narrowed list is a narrowed request and never a slice of a wider answer
  /// held in the browser.
  payments: (
    status: string | null,
    unit: string | null,
    supplier: string | null
  ) => ["finance", "payments", status, unit, supplier] as const,
  payment: (id: string) => ["finance", "payments", "detail", id] as const,

  assets: (unassessed: boolean, site: string | null) =>
    ["finance", "assets", unassessed, site] as const,
  depreciationStatus: (year: number, month: number) =>
    ["finance", "assets", "depreciation-status", year, month] as const,
  closeChecklist: (period: string | null) =>
    ["finance", "period-checklist", period] as const,
  /// Every close and reopen one month has had. Under `periods` so the
  /// invalidation that refreshes the calendar refreshes this too.
  periodEvents: (period: string | null) =>
    ["finance", "periods", "events", period] as const,
  /// What has actually been charged against one asset, month by month.
  assetSchedule: (id: string) => ["finance", "assets", "schedule", id] as const,
  /// The two halves of "what the books bought and what the register holds".
  /// No arguments: it is a whole-company exception report, not a filtered list.
  acquisitionGap: () => ["finance", "assets", "unbacked"] as const,

  /// Where the money sits, as at a date, in one unit's books or all of them.
  money: (asOf: string | null, unit: string | null) =>
    ["finance", "money", asOf, unit] as const,
  /// Giros in one status — the server filters, so each status is its own
  /// request and its own entry.
  giros: (status: string | null) => ["finance", "giros", status] as const,
  /// What the bank has told us, for one unit or for all of them.
  ///
  /// `listBankStatements` takes `unit` and narrows on the server, so the unit
  /// belongs in the key: without it a screen showing C003's statements and one
  /// showing the chain's were writing to the same entry, and whichever asked
  /// second read the other's rows.
  bankStatements: (unit: string | null = null) =>
    ["finance", "bank-statements", unit] as const,
  bankLines: (statementId: string) =>
    ["finance", "bank-statements", statementId, "lines"] as const,
  /// Counts of one drawer, or of all of them.
  /// Institutions gathered from every account that names one.
  bankInstitutions: () => ["finance", "banks"] as const,
  /// What our own accounts are, as opposed to where they post.
  companyBankAccounts: (unit: string | null) =>
    ["finance", "bank-accounts", unit] as const,
  cashCounts: (account: string | null, site: string | null) =>
    ["finance", "cash-counts", account, site] as const,
  bankSuggestions: (statementId: string, exact = true) =>
    ["finance", "bank-statements", statementId, "suggestions", exact] as const,
  bankBookOnly: (statementId: string) =>
    ["finance", "bank-statements", statementId, "book-only"] as const,
  /// The rules that recognise a bank line. Retired ones are a separate entry:
  /// the server hides them unless asked, so "show retired" is a different
  /// request and not a filter over the same rows.
  bankRules: (includeRetired: boolean) =>
    ["finance", "bank-rules", includeRetired] as const,
  /// What a bank line, a payment or a rule can be said to mean.
  transactionCategories: () => ["finance", "transaction-categories"] as const,

  /// The instruction queue. Both filters are the server's, so a narrowed list
  /// is a narrowed request and never a slice of a wider answer held in the
  /// browser — and both are in the key, because a key carrying neither would
  /// let one shop's queue overwrite the company's under the same entry.
  paymentInstructions: (status: string | null, site: string | null) =>
    ["finance", "payment-instructions", status, site] as const,
  paymentInstruction: (id: string) =>
    ["finance", "payment-instructions", "detail", id] as const,

  /// Deposits, narrowed on the server by status and by the unit whose money
  /// it is.
  deposits: (status: string | null, unit: string | null) =>
    ["finance", "deposits", status, unit] as const,
  deposit: (id: string) => ["finance", "deposits", "detail", id] as const,

  /// Finance's master data — the settings a person changes from a screen
  /// rather than a migration. Each list is one answer, fetched whole.
  expenseCategories: () => ["finance", "expense-categories"] as const,
  payComponents: () => ["finance", "pay-components"] as const,
  paymentMethods: () => ["finance", "payment-methods"] as const,
  sitePaymentMethods: (site: string) =>
    ["finance", "payment-methods", "site", site] as const,
  taxTemplates: () => ["finance", "tax-templates"] as const,
  taxTypes: () => ["finance", "tax", "types"] as const,
  dimensions: () => ["finance", "dimensions"] as const,
  dimensionResults: (
    dimension: string,
    from: string,
    to: string,
    unit: string | null
  ) => ["finance", "dimension-results", dimension, from, to, unit] as const,
  sourceRules: () => ["finance", "policies", "source-rules"] as const,
  headOfficeAccounts: () =>
    ["finance", "policies", "head-office-accounts"] as const,
  postingSwitches: () => ["finance", "policies", "posting"] as const,
  permissions: () => ["finance", "permissions"] as const,
  periodClosings: () => ["finance", "period-closing-vouchers"] as const,
  /// The same key `sales-setup.tsx` reads the settings under, so a value
  /// changed on the settings screen is the value shown there too.
  settings: () => ["finance", "settings"] as const,
  journalTemplates: () => ["finance", "journal-templates"] as const,
  journalRepeats: () => ["finance", "journal-repeats"] as const,
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
/// The balance beside every account of one level of the chart — headings
/// summed over what hangs under them — as ERPNext's Chart of Accounts prints
/// it. `parent` absent means the root classes; `unit` absent, the company.
export function accountBalances(
  options: { parent?: string; unit?: string } = {},
  signal?: AbortSignal
): Promise<AccountBalance[]> {
  return node.get<AccountBalance[]>(
    `/api/v1/finance/accounts/balances${search(options)}`,
    { signal }
  )
}

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

// ---------------------------------------------------------------------------
// Line categories and asset classes
// ---------------------------------------------------------------------------

/// One of the things an account's family can be narrowed to.
///
/// The chart collapsed from 190 postable accounts to 40, and what used to tell
/// two accounts apart — which rack, which bank, PPh 21 or PPh 23, electricity
/// or water — is this, carried on the journal line instead of baked into a
/// code. `ledger_account.category_family` says which family an account takes:
/// 24 of the 40 declare one, and the 16 that do not are the accounts whose
/// detail is already a row somewhere else — bank, the five asset accounts,
/// trade payables, goods received not invoiced, cheques issued, both loans,
/// capital, drawings, retained earnings, depreciation and interest. An account
/// that declares a family refuses a line without a category from it, and an
/// account that declares none refuses a line that carries one. Both refusals
/// come from the database.
///
/// `category_code` is an `UPPER_SNAKE` slug of the client's own account name —
/// `BIAYA_PEMAKAIAN_LISTRIK`, `TUNJANGAN_HARI_RAYA`, `DEBIT_BCA`, `PPH21` — so
/// a picker can search the code and find what somebody half remembers the name
/// of.
///
/// `name` is the client's own Indonesian and is NEVER translated. An
/// accountant is looking for "Biaya Pemakaian Listrik"; `name_en` is a gloss
/// for a reader who does not have the chart in their head, and never a
/// replacement.
///
/// Transcribed rather than imported: the Rust side of this is being written in
/// a parallel lane and ts-rs has nothing to generate from yet. The shape is
/// the frozen one in `docs/coa-40-contract.md` §1. When `LineCategory` appears
/// in `@itulah/contract`, this goes and the import takes its place.
export interface LineCategory {
  readonly category_code: string
  /// `expense_category`, `pay_component`, `tax_kind`… Lowercase, and the same
  /// string an account puts in `category_family`.
  readonly family: string
  readonly name: string
  readonly name_en?: string | null
  readonly sort_order: number
  /// A retired category still explains the lines that already carry it, and is
  /// refused for new postings. Shown and disabled rather than hidden, like a
  /// retired account.
  readonly is_active: boolean
}

export interface LineCategoryPage {
  readonly categories: readonly LineCategory[]
}

/// The client's asset classes, now a table of their own.
///
/// `fixed_asset.category_code` used to point at a ledger account, which is how
/// the chart came to carry 36 racks and seven furniture families as accounts.
/// It points here instead, and the asset accounts — 1601, 1609, 7101 and the
/// rest — take no category at all: their identity is the asset the line names.
///
/// Generated, where it used to be transcribed: the class now carries its
/// `build` (0356), and a hand-written mirror of that list would have kept the
/// register guessing which form a class is filled in on.
import type { AssetClassList } from "@itulah/contract"

export type { AssetClass, AssetClassList } from "@itulah/contract"

/// Every category, or one family's.
///
/// The whole list is about a hundred and fifty rows and is imported once, so
/// the family filter is a convenience for the picker rather than a size
/// bargain — unlike `searchAccounts`, which asks the server on every keystroke
/// because its list is a megabyte.
export function listLineCategories(
  family?: string | null,
  signal?: AbortSignal
): Promise<LineCategoryPage> {
  return node.get<LineCategoryPage>(
    `/api/v1/finance/line-categories${search({ family })}`,
    { signal }
  )
}

export function listAssetClasses(
  signal?: AbortSignal
): Promise<AssetClassList> {
  return node.get<AssetClassList>("/api/v1/finance/asset-classes", { signal })
}

// ---------------------------------------------------------------------------
// Chart of accounts, continued
// ---------------------------------------------------------------------------

/// One account, the headings above it, and what it is worth — in one unit's
/// books when `unit` names one, the company's when it does not.
export function accountDetail(
  code: string,
  options: { unit?: string; as_of?: string } = {},
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
/// `1011001` is cash across every unit's books. With no window the server
/// answers the current month, which is the span a ledger is read in. `unit`
/// narrows the opening balance too: one unit's cash is a ledger of its own.
export function accountLedger(
  code: string,
  options: {
    unit?: string
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
    /// One unit's books; the company's when absent.
    unit?: string
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
// Account links
// ---------------------------------------------------------------------------

/// Every link, whole, with the roles the posting rules name and the units the
/// books are kept for (`locations`).
///
/// Not paged, on the server's word: a few hundred links a person reads top to
/// bottom to find the exception. `gaps` is counted over everything and never
/// narrowed by `q` — a search that hid the gaps would be the screen reporting
/// them fixed.
export function accountLinks(
  params: { q?: string; role?: string } = {},
  signal?: AbortSignal
): Promise<AccountLinkPage> {
  return node.get<AccountLinkPage>(
    `/api/v1/finance/account-links${search(params)}`,
    { signal }
  )
}

/// Point a role at an account for a scope, or move it. An upsert: the scope
/// is part of the key, so saving a link that already exists moves it.
export function setAccountLink(
  request: SetAccountLinkRequest,
  signal?: AbortSignal
): Promise<AccountLink> {
  return node.post<AccountLink>("/api/v1/finance/account-links", request, {
    signal,
  })
}

/// Remove a link. Answers 409 naming the units that would be left with no
/// account; `force` removes it anyway.
export function removeAccountLink(
  linkId: number,
  force = false
): Promise<void> {
  return node.delete<void>(
    `/api/v1/finance/account-links/${linkId}${search({ force: force || undefined })}`
  )
}

export function accountLinkHistory(
  role?: string | null,
  signal?: AbortSignal,
  limit = 50,
  /// The last `history_id` of the previous page. A page that comes back
  /// full may have another behind it; a short one is the end.
  before?: number
): Promise<AccountLinkChange[]> {
  return node.get<AccountLinkChange[]>(
    `/api/v1/finance/account-link-history${search({ role, limit, before })}`,
    { signal }
  )
}

/// "If this happened now in this unit's books, would it post?" — every role
/// and source, against every unit.
export function postingReadiness(
  signal?: AbortSignal
): Promise<PostingReadiness> {
  return node.get<PostingReadiness>("/api/v1/finance/posting-readiness", {
    signal,
  })
}

/// What one role, from one source, lands on in a unit's books — the answer
/// the old per-site map used to hold as rows.
export interface UnitAccount {
  readonly role: string
  /// `COMPANY`, or the master the decision belongs to.
  readonly source_type: string
  readonly source_id: string
  readonly account_code: string
  readonly account_name: string
  /// Which scope decided it: `ALL`, `UNIT_KIND` or `UNIT`.
  readonly scope_type: string | null
}

/// Every (role, source) that resolves in `unit`'s books, or — with no unit —
/// the first unit each one resolves in. A caller holding a site asks for the
/// unit that owns it: the books are a unit's, never a premises'.
///
/// Composed from the readiness matrix (which account wins where) and the link
/// list (what that account is called), because the server resolves and the
/// browser must not: the most-specific-wins rule lives in
/// `account_resolution`, and a copy of it here would be a second opinion.
export async function unitAccounts(
  unit: string | null,
  signal?: AbortSignal
): Promise<UnitAccount[]> {
  const [readiness, links] = await Promise.all([
    postingReadiness(signal),
    accountLinks({}, signal),
  ])
  const names = new Map<string, string>()
  for (const link of links.rows) names.set(link.account_code, link.account_name)
  const out: UnitAccount[] = []
  for (const row of readiness.rows) {
    const cell = row.cells.find(
      (one) =>
        one.account_code !== null && (unit === null || one.unit_id === unit)
    )
    if (cell === undefined || cell.account_code === null) continue
    out.push({
      role: row.role,
      source_type: row.source_type,
      source_id: row.source_id,
      account_code: cell.account_code,
      account_name: names.get(cell.account_code) ?? "",
      scope_type: cell.scope_type,
    })
  }
  return out
}

// ---------------------------------------------------------------------------
// Changing the chart
// ---------------------------------------------------------------------------

/// What changed in the chart, newest first; one account's when given.
export function chartChanges(
  account?: string | null,
  signal?: AbortSignal,
  limit = 100,
  /// The last `change_id` of the previous page. A page that comes back full
  /// may have another behind it; a short one is the end.
  before?: number
): Promise<ChartChange[]> {
  return node.get<ChartChange[]>(
    `/api/v1/finance/chart-changes${search({ account, limit, before })}`,
    { signal }
  )
}

/// Add, edit, retire or revive an account. Applies at once — no approval, the
/// owner's decision — and is kept in the history with who and why.
export function changeChart(
  request: ChartChangeRequest,
  signal?: AbortSignal
): Promise<ChartChange> {
  return node.post<ChartChange>("/api/v1/finance/chart-changes", request, {
    signal,
  })
}

// ---------------------------------------------------------------------------
// Master data: the settings Finance changes without a developer
// ---------------------------------------------------------------------------

/// The kinds of cost a shop or an employee files under. A category's account
/// is an account link (role `expense`, source `EXPENSE_CATEGORY`).
export function listExpenseCategories(
  signal?: AbortSignal
): Promise<ExpenseCategory[]> {
  return node.get<ExpenseCategory[]>("/api/v1/finance/expense-categories", {
    signal,
  })
}

/// Add a category or change one. `code` is the key and never changes.
export function saveExpenseCategory(
  request: SaveExpenseCategoryRequest
): Promise<ExpenseCategory> {
  return node.post<ExpenseCategory>(
    "/api/v1/finance/expense-categories",
    request
  )
}

/// Every pay component, with how it posts and how many units it reaches.
export function listPayComponentPostings(
  signal?: AbortSignal
): Promise<PayComponentPosting[]> {
  return node.get<PayComponentPosting[]>("/api/v1/finance/pay-components", {
    signal,
  })
}

export function setPayComponentPosting(
  code: string,
  request: SetPayComponentPostingRequest
): Promise<PayComponentPosting> {
  return node.put<PayComponentPosting>(
    `/api/v1/finance/pay-components/${encodeURIComponent(code)}`,
    request
  )
}

/// The payment methods the company accepts (ERPNext Mode of Payment).
export function listPaymentMethods(
  signal?: AbortSignal
): Promise<PaymentMethodSetting[]> {
  return node.get<PaymentMethodSetting[]>("/api/v1/finance/payment-methods", {
    signal,
  })
}

export function savePaymentMethod(
  request: SavePaymentMethodRequest
): Promise<PaymentMethodSetting> {
  return node.post<PaymentMethodSetting>(
    "/api/v1/finance/payment-methods",
    request
  )
}

/// One shop's payment-method setup: every method, and whether the shop
/// takes it (ERPNext POS Profile → Payments, per shop).
export function sitePaymentMethods(
  site: string,
  signal?: AbortSignal
): Promise<SitePaymentMethod[]> {
  return node.get<SitePaymentMethod[]>(
    `/api/v1/finance/sites/${encodeURIComponent(site)}/payment-methods`,
    { signal }
  )
}

/// Set one shop's machine of one bank: what it takes and where each lands.
/// The shop's card and QRIS methods follow it.
export function saveEdcMachine(
  site: string,
  bank: string,
  request: SaveEdcMachineRequest
): Promise<EdcMachine> {
  return node.put<EdcMachine>(
    `/api/v1/finance/sites/${encodeURIComponent(site)}/edc-machines/${encodeURIComponent(bank)}`,
    request
  )
}

/// Take a bank's machine off a shop.
export function removeEdcMachine(site: string, bank: string): Promise<void> {
  return node.delete<void>(
    `/api/v1/finance/sites/${encodeURIComponent(site)}/edc-machines/${encodeURIComponent(bank)}`
  )
}

/// Say which cash, voucher, employee-balance and points methods a shop takes.
export function setShopOtherMethods(
  site: string,
  request: SetShopOtherMethodsRequest
): Promise<SitePaymentMethod[]> {
  return node.put<SitePaymentMethod[]>(
    `/api/v1/finance/sites/${encodeURIComponent(site)}/other-methods`,
    request
  )
}

/// Say which methods a shop takes; anything not named is switched off there.
export function setSitePaymentMethods(
  site: string,
  request: SetSitePaymentMethodsRequest
): Promise<SitePaymentMethod[]> {
  return node.put<SitePaymentMethod[]>(
    `/api/v1/finance/sites/${encodeURIComponent(site)}/payment-methods`,
    request
  )
}

/// Add an asset class or change one. Answers with the whole list.
export function saveAssetClass(
  request: SaveAssetClassRequest
): Promise<AssetClassList> {
  return node.post<AssetClassList>("/api/v1/finance/asset-classes", request)
}

/// The withholding templates (ERPNext Tax Withholding Category).
export function listTaxTemplates(signal?: AbortSignal): Promise<TaxTemplate[]> {
  return node.get<TaxTemplate[]>("/api/v1/finance/tax-templates", { signal })
}

/// Add a template or change one. Answers with the whole list.
export function saveTaxTemplate(template: TaxTemplate): Promise<TaxTemplate[]> {
  return node.post<TaxTemplate[]>("/api/v1/finance/tax-templates", template)
}

/// The tax types, read as settings. The GET answers `TaxType` — the same
/// fields, with `note` always present.
export function listTaxTypeSettings(signal?: AbortSignal): Promise<TaxType[]> {
  return node.get<TaxType[]>("/api/v1/finance/tax/types", { signal })
}

export function saveTaxType(tax: TaxTypeSetting): Promise<TaxTypeSetting> {
  return node.post<TaxTypeSetting>("/api/v1/finance/tax/types", tax)
}

/// The accounting dimensions and their values (ERPNext Accounting Dimension).
export function listDimensions(
  signal?: AbortSignal
): Promise<AccountingDimension[]> {
  return node.get<AccountingDimension[]>("/api/v1/finance/dimensions", {
    signal,
  })
}

export function saveDimension(
  request: SaveDimensionRequest
): Promise<AccountingDimension[]> {
  return node.post<AccountingDimension[]>("/api/v1/finance/dimensions", request)
}

export function saveDimensionValue(
  dimension: string,
  value: DimensionValue
): Promise<AccountingDimension[]> {
  return node.post<AccountingDimension[]>(
    `/api/v1/finance/dimensions/${encodeURIComponent(dimension)}/values`,
    value
  )
}

/// The profit and loss cut by one dimension: a row per value, and one with no
/// value for the lines that carry none, so the rows add up to the whole.
export function dimensionResults(
  params: { dimension: string; from: string; to: string; unit?: string | null },
  signal?: AbortSignal
): Promise<DimensionResult[]> {
  return node.get<DimensionResult[]>(
    `/api/v1/finance/reports/dimension-results${search(params)}`,
    { signal }
  )
}

/// Which documents may reach which account.
export function listSourceRules(
  signal?: AbortSignal
): Promise<AccountSourceRule[]> {
  return node.get<AccountSourceRule[]>(
    "/api/v1/finance/policies/source-rules",
    { signal }
  )
}

export function setSourceRule(
  rule: AccountSourceRule
): Promise<AccountSourceRule[]> {
  return node.post<AccountSourceRule[]>(
    "/api/v1/finance/policies/source-rules",
    rule
  )
}

export function removeSourceRule(rule: {
  account_code: string
  source_kind: string
  category_code?: string | null
}): Promise<AccountSourceRule[]> {
  return node.delete<AccountSourceRule[]>(
    `/api/v1/finance/policies/source-rules${search({
      account: rule.account_code,
      source_kind: rule.source_kind,
      category: rule.category_code,
    })}`
  )
}

/// Accounts that belong to head office only.
export function listHeadOfficeAccounts(
  signal?: AbortSignal
): Promise<HeadOfficeAccount[]> {
  return node.get<HeadOfficeAccount[]>(
    "/api/v1/finance/policies/head-office-accounts",
    { signal }
  )
}

export function setHeadOfficeAccount(
  account: HeadOfficeAccount
): Promise<HeadOfficeAccount[]> {
  return node.post<HeadOfficeAccount[]>(
    "/api/v1/finance/policies/head-office-accounts",
    account
  )
}

export function removeHeadOfficeAccount(
  code: string
): Promise<HeadOfficeAccount[]> {
  return node.delete<HeadOfficeAccount[]>(
    `/api/v1/finance/policies/head-office-accounts/${encodeURIComponent(code)}`
  )
}

/// Whether automatic posting runs, globally and per document kind.
export function postingSwitches(
  signal?: AbortSignal
): Promise<PostingSwitches> {
  return node.get<PostingSwitches>("/api/v1/finance/policies/posting", {
    signal,
  })
}

export function setAutomaticPosting(
  request: SetAutomaticPostingRequest
): Promise<PostingSwitches> {
  return node.put<PostingSwitches>("/api/v1/finance/policies/posting", request)
}

export function setPostingSwitch(
  posting: PostingSwitch
): Promise<PostingSwitches> {
  return node.post<PostingSwitches>(
    "/api/v1/finance/policies/posting/sources",
    posting
  )
}

/// Who may call what — the overrides on top of the built-in roles.
export function listRolePermissions(
  signal?: AbortSignal
): Promise<RolePermission[]> {
  return node.get<RolePermission[]>("/api/v1/finance/permissions", { signal })
}

export function setRolePermission(
  permission: RolePermission
): Promise<RolePermission[]> {
  return node.post<RolePermission[]>("/api/v1/finance/permissions", permission)
}

export function removeRolePermission(key: {
  method: string
  path_prefix: string
}): Promise<RolePermission[]> {
  return node.delete<RolePermission[]>(
    `/api/v1/finance/permissions${search(key)}`
  )
}

/// The closing vouchers, newest period first.
export function listPeriodClosings(
  signal?: AbortSignal
): Promise<PeriodClosingVoucher[]> {
  return node.get<PeriodClosingVoucher[]>(
    "/api/v1/finance/period-closing-vouchers",
    { signal }
  )
}

/// Close a date range into retained earnings.
export function postPeriodClosing(
  request: PeriodClosingRequest
): Promise<PeriodClosingVoucher> {
  return node.post<PeriodClosingVoucher>(
    "/api/v1/finance/period-closing-vouchers",
    request
  )
}

/// Cancel the last closing voucher by reversing its entry.
export function cancelPeriodClosing(
  voucherId: string
): Promise<PeriodClosingVoucher> {
  return node.post<PeriodClosingVoucher>(
    `/api/v1/finance/period-closing-vouchers/${encodeURIComponent(voucherId)}/cancel`,
    {}
  )
}

/// The tolerances, windows and switches kept as numbers.
export function listFinanceSettings(
  signal?: AbortSignal
): Promise<FinanceSetting[]> {
  return node.get<FinanceSetting[]>("/api/v1/finance/settings", { signal })
}

export function setFinanceSetting(
  key: string,
  request: SetFinanceSettingRequest
): Promise<FinanceSetting> {
  return node.put<FinanceSetting>(
    `/api/v1/finance/settings/${encodeURIComponent(key)}`,
    request
  )
}

/// Journal Entry Templates: manual-journal lines saved once. `lines` are the
/// same `PostingLine` objects the composer posts.
export function listJournalTemplates(
  signal?: AbortSignal
): Promise<JournalTemplate[]> {
  return node.get<JournalTemplate[]>("/api/v1/finance/journal-templates", {
    signal,
  })
}

/// Create a template (no `template_id`) or change one.
export function saveJournalTemplate(
  request: SaveJournalTemplateRequest
): Promise<JournalTemplate> {
  return node.post<JournalTemplate>(
    "/api/v1/finance/journal-templates",
    request
  )
}

/// Repeating journals (ERPNext Auto Repeat): a template raised as a draft — or
/// posted, with `auto_post` — on its date, and the date moved on.
export function listJournalRepeats(
  signal?: AbortSignal
): Promise<JournalRepeat[]> {
  return node.get<JournalRepeat[]>("/api/v1/finance/journal-repeats", {
    signal,
  })
}

export function saveJournalRepeat(
  request: SaveJournalRepeatRequest
): Promise<JournalRepeat> {
  return node.post<JournalRepeat>("/api/v1/finance/journal-repeats", request)
}

/// Raise every repeat due today now, instead of waiting for the hourly sweep.
export function runJournalRepeats(): Promise<JournalRepeatSweep> {
  return node.post<JournalRepeatSweep>(
    "/api/v1/finance/journal-repeats/run",
    {}
  )
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

/// Seal a month. Undo closing takes it back (`reopenPeriod`), and it cannot race a posting:
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

/// Take a sealed month back. The reason is required and is kept with who asked
/// and when. Refused with 409 while a later month is still closed (undo the
/// newest first) or a year-end voucher covers the month; the message names why
/// and is shown as it arrives. Answers with the period page, like opening does.
export function reopenPeriod(
  year: number,
  month: number,
  reason: string,
  signal?: AbortSignal
): Promise<PeriodPage> {
  return node.post<PeriodPage>(
    `/api/v1/finance/periods/${year}-${String(month).padStart(2, "0")}/reopen`,
    { reason },
    { signal }
  )
}

/// Every close and reopen this month has had, newest first.
export function periodEvents(
  period: string,
  signal?: AbortSignal
): Promise<PeriodEvent[]> {
  return node.get<PeriodEvent[]>(
    `/api/v1/finance/periods/${encodeURIComponent(period)}/events`,
    { signal }
  )
}

// ---------------------------------------------------------------------------
// The journal
// ---------------------------------------------------------------------------

/// The register, narrowed by window, by what caused the entry, and by whose
/// books a line of it is in.
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
    /// Entries with ANY line in this unit's books: an entry has no unit of
    /// its own, and a payment can settle two stores' bills at once.
    unit?: string
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

/// What a manual journal entry sends.
///
/// Mirrors `ManualEntryRequest` on the server, which wraps the same
/// `PostingLine` every posting rule builds. Two things about it are easy to
/// get wrong from the browser and are spelled out here because the server's
/// refusal arrives after the typing, not during it:
///
///   * `account` is a TAGGED union. `kind: "account"` names a client code a
///     person chose; `kind: "meaning"` resolves through the account map. A
///     manual entry is always the first — the person is reading a code off a
///     document — so the form never offers the second.
///   * `category_code` is required on an account that declares a category
///     family and refused on one that does not. The server names the codes
///     that would have worked, which is what the form shows.
export interface ManualJournalLine {
  readonly account: {
    readonly kind: "account"
    readonly account_code: string
    readonly category_code?: string | null
  }
  /// Whose books the line is in: a unit id, never a site's.
  readonly unit_id: string
  readonly debit_minor: number
  readonly credit_minor: number
  readonly memo?: string | null
}

export interface ManualJournalRequest {
  readonly posting_date: string
  readonly currency?: string
  readonly memo?: string | null
  readonly lines: readonly ManualJournalLine[]
}

/// What it answers with. A `json!()` literal on the server rather than a
/// struct, so ts-rs has nothing to generate from — transcribed, and this is
/// where it goes stale if a field moves.
export interface PostedEntry {
  readonly entry_id: string
  readonly entry_number: string
  readonly total_minor: number
}

/// Post a journal entry by hand.
///
/// There is no draft: `poster::post` writes a balanced entry or refuses, so
/// what this sends is final. Everything the entry has to satisfy — the two
/// sides agreeing, the month being open, the account accepting a manual
/// journal at all — is checked there and comes back as a sentence.
export function recordJournal(
  request: ManualJournalRequest,
  idempotencyKey: string,
  signal?: AbortSignal
): Promise<PostedEntry> {
  return node.post<PostedEntry>("/api/v1/finance/journal", request, {
    signal,
    headers: { "Idempotency-Key": idempotencyKey },
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
  readonly account: {
    readonly kind: "account"
    readonly account_code: string
    /// Required when the account declares a `category_family`, and refused
    /// when it does not. `LineAccount::Account` carries it beside the code
    /// because the two are one answer: choosing 6301 has not said what the
    /// cost was until the category is chosen too.
    readonly category_code?: string | null
  }
  /// Whose books the line is in: a unit id, never a site's.
  readonly unit_id: string
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

/// What one account family holds, in each unit's books.
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
  options: { from?: string; to?: string; unit?: string } = {},
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
///
/// `draftFrom` becomes `draft_from` on the wire: the GA inbox asks for the
/// drafts Operations filed (`draft_from=GA`), which the server filters rather
/// than the browser, because "what did GA send us" is a population and not a
/// narrowing of a page already in hand.
export function listBills(
  options: {
    status?: string
    supplier?: string
    site?: string
    draftFrom?: string
    limit?: number
    /// Free text over the invoice number and the supplier's name. The SERVER
    /// searches.
    q?: string
    /// `date`, `due`, `supplier`, `total` or `outstanding`, with
    /// `dir: "desc"`.
    sort?: string
    dir?: string
    /// The previous page's `next_cursor`.
    cursor?: string
    /// `MERCHANDISE` or `EXPENSE`, narrowed on the server — the bills screen
    /// pages each of its two tabs on its own.
    kind?: string
  } = {},
  signal?: AbortSignal
): Promise<BillPage> {
  const { draftFrom, ...rest } = options
  return node.get<BillPage>(
    `/api/v1/finance/bills${search({
      limit: 200,
      ...rest,
      draft_from: draftFrom,
    })}`,
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

/// The six things the server checks before a bill is posted, as warnings.
///
/// A warning is NOT a block: `post_bill` refuses only a held bill, and posting
/// with a warning on the list is the point — the reader is told what is odd and
/// decides. So nothing in the screen locks a button because one of these came
/// back.
export function billWarnings(
  invoiceId: string,
  signal?: AbortSignal
): Promise<BillWarning[]> {
  return node.get<BillWarning[]>(
    `/api/v1/finance/bills/${encodeURIComponent(invoiceId)}/warnings`,
    { signal }
  )
}

/// Hold a bill so nothing pays it, with the reason it is held (required) and
/// the day it is planned to be released (optional — unset means "until somebody
/// decides"). Holding a posted bill is allowed; it still cannot be paid.
export function holdBill(
  invoiceId: string,
  request: { readonly reason: string; readonly release_date?: string | null },
  signal?: AbortSignal
): Promise<SupplierBill> {
  return node.post<SupplierBill>(
    `/api/v1/finance/bills/${encodeURIComponent(invoiceId)}/hold`,
    request,
    { signal }
  )
}

/// Release a held bill. Clears the reason and the planned date with it, so
/// "released" and "held with a blank reason" cannot both be true.
export function releaseBill(
  invoiceId: string,
  signal?: AbortSignal
): Promise<SupplierBill> {
  return node.post<SupplierBill>(
    `/api/v1/finance/bills/${encodeURIComponent(invoiceId)}/release`,
    {},
    { signal }
  )
}

/// Return a draft to GA with the reason it is coming back.
///
/// A return is not a delete: the bill keeps its id and its GA mark and stays a
/// DRAFT, so Operations can fix it and file it again. `reason` is required
/// because a returned draft with no reason is one GA cannot act on.
export function returnBill(
  invoiceId: string,
  request: { readonly reason: string },
  signal?: AbortSignal
): Promise<SupplierBill> {
  return node.post<SupplierBill>(
    `/api/v1/finance/bills/${encodeURIComponent(invoiceId)}/return`,
    request,
    { signal }
  )
}

/// Deliveries with no bill against them.
///
/// Each is already a debt in the books — the goods receipt posts the supplier's
/// payable the day it is valued, and the payables ageing counts it (see
/// `openDeliveries`). What this list adds is the paperwork side: the supplier's
/// own invoice figure where one came, and how long the delivery has waited. Its
/// value is the order's price, so it can sit a few rupiah off the ledger's.
export function unbilledReceipts(
  signal?: AbortSignal
): Promise<UnbilledReceipt[]> {
  return node.get<UnbilledReceipt[]>("/api/v1/finance/unbilled", { signal })
}

/// The same deliveries, a keyset page at a time and oldest first, with the
/// count and the value of EVERY unbilled delivery beside the page.
///
/// A sibling rather than a change to `unbilledReceipts`: the route answers the
/// bare array to a plain ask, which other screens read, and the envelope only
/// to `paged=true` — so neither caller's shape moves under the other.
export function unbilledPage(
  options: { cursor?: string; limit?: number } = {},
  signal?: AbortSignal
): Promise<UnbilledPage> {
  return node.get<UnbilledPage>(
    `/api/v1/finance/unbilled${search({ paged: true, ...options })}`,
    { signal }
  )
}

/// What is owed, to whom, and how late.
///
/// The server's ageing and not the browser's. Bucketing the bill list here
/// would look identical and be wrong twice: it ages the whole invoice rather
/// than what is still outstanding on it, and it cannot wind a payment back —
/// asking "as at the end of last month" has to un-count money that left the
/// bank since, which only a query over both sides can do.
export function payablesAging(
  options: {
    as_of?: string
    /// One unit's books. A bill counts in the unit owning the site it was
    /// received at.
    unit?: string
  } = {},
  signal?: AbortSignal
): Promise<PayablesAging> {
  return node.get<PayablesAging>(
    `/api/v1/finance/payables-aging${search(options)}`,
    { signal }
  )
}

/// The goods receipts the payables ageing counts as debt before their bill
/// arrives — each an open item of the payment ledger on the trade-payable
/// account, with the due date its supplier's terms gave it.
///
/// The ageing's own second leg: `payables_aging` adds the posted bills and
/// then these (`open_receipt`), so a list of both is the same population as
/// the figure, and a screen that drew only the bills would say "nothing is
/// owed" over a card that says otherwise. `unbilledReceipts` is the same
/// deliveries priced at the order and not at what the ledger booked, which is
/// why it is not used for money here.
///
/// One request, unpaged: the server clamps it at a thousand open items, and
/// a house with more unbilled deliveries than that has a different problem.
export function openDeliveries(
  options: { as_of?: string; unit?: string } = {},
  signal?: AbortSignal
): Promise<PaymentLedgerView> {
  return node.get<PaymentLedgerView>(
    `/api/v1/finance/payment-ledger${search({
      account: "trade_payable",
      side: "PAYABLE",
      party_type: "SUPPLIER",
      voucher_kind: "GOODS_RECEIPT",
      open_only: true,
      limit: 1000,
      ...options,
    })}`,
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
    /// The unit whose bank the payment left.
    unit?: string
    supplier?: string
    limit?: number
    /// Free text over the payment number, the bank reference and the names
    /// of the suppliers it settled. The SERVER searches.
    q?: string
    /// `date`, `total` or `number`, with `dir: "desc"`.
    sort?: string
    dir?: string
    /// The previous page's `next_cursor`.
    cursor?: string
    /// The payment-date window, `YYYY-MM-DD`, both ends inclusive.
    from?: string
    to?: string
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
/// account `bank_giro` in C007's books *is* belongs to the account links, and
/// storing the code on the payment would be a second copy of them that stops
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
// A bill's own pages: its item lines, and the advances set against it
// ---------------------------------------------------------------------------

/// One item line of a supplier invoice, as the paper states it. What
/// 7Soft's Faktur Pembelian prints in its Detail tab: name, quantity, price,
/// total. Read-only here — the lines are written by receiving and matching in
/// Procurement, never keyed in Finance.
export interface BillItemLine {
  readonly line_number: number
  /// The article the delivery line was for, joined from the purchase order.
  readonly article_code: string | null
  readonly description: string
  readonly quantity: number
  readonly unit_price_minor: number
  readonly line_amount_minor: number
  readonly tax_minor: number
  /// The two documents the line came from: the order and the delivery.
  readonly po_number: string | null
  readonly receipt_number: string | null
}

export function billItemLines(
  invoiceId: string,
  signal?: AbortSignal
): Promise<BillItemLine[]> {
  return node.get<BillItemLine[]>(
    `/api/v1/finance/bills/${encodeURIComponent(invoiceId)}/lines`,
    { signal }
  )
}

/// What the payment ledger holds against one bill: the bill's own open item
/// and, under `settlements`, every document that has answered part of it —
/// payments, advances and credit notes alike. The settler is the row's
/// `against_voucher_kind` / `against_voucher_id`.
export function billSettlements(
  invoiceId: string,
  signal?: AbortSignal
): Promise<PaymentLedgerView> {
  return node.get<PaymentLedgerView>(
    `/api/v1/finance/payment-ledger${search({
      party_type: "SUPPLIER",
      voucher_kind: "SUPPLIER_INVOICE",
      voucher: invoiceId,
      open_only: false,
      limit: 50,
    })}`,
    { signal }
  )
}

/// What is open against every supplier, as at a day: the bills and the
/// deliveries the payables ageing is made of, one row each, with the due date
/// each was given. The server's own reading, wound back to `as_of`, so a report
/// of "what was owed on the 15th" is not a guess from today's bill list.
export function openPayables(
  options: { as_of?: string; unit?: string } = {},
  signal?: AbortSignal
): Promise<PaymentLedgerView> {
  return node.get<PaymentLedgerView>(
    `/api/v1/finance/payment-ledger${search({
      side: "PAYABLE",
      party_type: "SUPPLIER",
      open_only: true,
      limit: 1000,
      ...options,
    })}`,
    { signal }
  )
}

/// Every advance with money still in it, of every supplier.
export function listOpenAdvances(
  signal?: AbortSignal
): Promise<SupplierAdvance[]> {
  return node.get<SupplierAdvance[]>(
    `/api/v1/finance/supplier-advances${search({ limit: 500 })}`,
    { signal }
  )
}

export function supplierAdvance(
  advanceId: string,
  signal?: AbortSignal
): Promise<SupplierAdvance> {
  return node.get<SupplierAdvance>(
    `/api/v1/finance/supplier-advances/${encodeURIComponent(advanceId)}`,
    { signal }
  )
}

/// Set money already paid to a supplier against one of its bills. Its own act
/// on its own date; the server refuses an advance of another supplier, unit
/// or currency, and says which.
export function applySupplierAdvance(
  advanceId: string,
  request: SupplierAdvanceApplyRequest,
  signal?: AbortSignal
): Promise<SupplierAdvance> {
  return node.post<SupplierAdvance>(
    `/api/v1/finance/supplier-advances/${encodeURIComponent(advanceId)}/apply`,
    request,
    { signal }
  )
}

// ---------------------------------------------------------------------------
// Fixed assets
// ---------------------------------------------------------------------------

/// The server's close checklist. This is the same verdict the close endpoint
/// evaluates, so the screen does not keep a second, drifting set of gates.
export interface PeriodCheckPointer {
  readonly kind: string
  readonly id: string
  readonly label: string
}

export type PeriodCheckOutcome =
  | { readonly state: "PASS" }
  | {
      readonly state: "FAIL"
      readonly count: number
      readonly where: readonly PeriodCheckPointer[]
    }
  | { readonly state: "PENDING" | "BLOCKED"; readonly reason: string }

export interface PeriodCheckResult {
  readonly key: string
  readonly title: string
  readonly critical: boolean
  readonly outcome: PeriodCheckOutcome
}

export interface PeriodChecklist {
  readonly period: { readonly year: number; readonly month: number }
  readonly may_close: boolean
  readonly blocked_by: readonly string[]
  readonly checks: readonly PeriodCheckResult[]
}

export function periodChecklist(
  period: string,
  signal?: AbortSignal
): Promise<PeriodChecklist> {
  return node.get<PeriodChecklist>(
    `/api/v1/finance/periods/${encodeURIComponent(period)}/checklist`,
    { signal }
  )
}

/// Whether a month's asset charges are actually complete, asked of the
/// register rather than inferred from a depreciation run receipt.
export function assetDepreciationStatus(
  year: number,
  month: number,
  signal?: AbortSignal
): Promise<AssetDepreciationStatus> {
  const period = `${year}-${String(month).padStart(2, "0")}`
  return node.get<AssetDepreciationStatus>(
    `/api/v1/finance/assets/depreciation/status?period=${period}`,
    { signal }
  )
}

/// Rehearse a month's depreciation without writing journals or ledger rows.
export function previewDepreciation(
  year: number,
  month: number,
  signal?: AbortSignal
): Promise<DepreciationRun> {
  return node.post<DepreciationRun>(
    "/api/v1/finance/depreciation/preview",
    { year, month },
    { signal }
  )
}

/// The register. `unassessed` asks for the open control gap directly — assets
/// Operations has registered that Finance has not yet decided a treatment for.
///
/// `group` reads one of the register's three views — `register`, `software`,
/// `projects` — so the GA menu's three doors ask the server for the rows each
/// means, and the screen never spells a class list of its own.
export function listAssets(
  options: {
    site?: string
    category?: string
    unassessed?: boolean
    q?: string
    decision?: string
    status?: string
    group?: string
    /// The eleven forms a thing can come in, comma-separated when a view means
    /// more than one — Property is land and buildings. See `lib/builds.ts`.
    build?: string
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
/// and any disposal at all while `asset_disposal_result` has no account in the
/// books of the unit owning the asset's site.
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
/// Both halves, because the client keeps a profit and loss per unit: moving the
/// cost alone leaves two units wrong by the same amount in opposite directions,
/// which a trial balance cannot see. The legs are in the books of the unit
/// owning each site, so a move between two sites of ONE unit changes no books
/// and writes no entry — the move itself is still recorded. A move to where
/// the asset already is is refused.
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
  const period = `${year}-${String(month).padStart(2, "0")}`
  return node.post<DepreciationRun>(
    `/api/v1/finance/assets/depreciation/run?period=${period}`,
    {},
    { signal }
  )
}

// ---------------------------------------------------------------------------
// Bank reconciliation
// ---------------------------------------------------------------------------

/// Every place money sits, what the books say it holds, and what the bank last
/// said.
///
/// One row per mapped money account per unit — so it is the account links
/// read through the ledger, and a meaning nobody has linked is simply not a
/// place money can sit yet. `per_books_minor` comes back in the account's own
/// sign and deliberately unflipped: `giro_outstanding` is a liability and is
/// negative, which is what it is.
///
/// `difference_minor` is absent rather than zero when no statement has been
/// imported. "We agree" and "there is nothing to agree with" are different
/// answers and must not render the same.
export function moneyOverview(
  options: { as_of?: string; unit?: string } = {},
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
    unit?: string
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

/// In the books, not on the bank (ERPNext: *Amounts not reflected in bank*).
/// Postings on the statement's account, up to its last day, that no bank line
/// has claimed — reaching back to the account's first statement, so a giro
/// from last month that still has not cleared is here too.
export function bookOnlyLines(
  statementId: string,
  signal?: AbortSignal
): Promise<BookOnlyLine[]> {
  return node.get<BookOnlyLine[]>(
    `/api/v1/finance/bank-statements/${encodeURIComponent(statementId)}/book-only`,
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

/// What our accounts are — number, holder, branch, which one a unit pays out
/// of. Separate from the account links, which say where their postings land.
/// `unit` narrows to the accounts kept in one unit's books.
export function listCompanyBankAccounts(
  signal?: AbortSignal,
  options: { unit?: string } = {}
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
// Bank rules
//
// A rule recognises a bank line by its narration and names the category it
// means; running the rules writes PROPOSALS and nothing else. A person accepts
// a proposal on the reconciliation screen (`lib/queries/bank-recon.ts`), and
// accepting is what creates the cash document.

/// Every rule, lowest priority first. Retired rules are hidden unless asked
/// for: a proposal names the rule that made it, so "why was this booked there"
/// still has an answer once somebody has turned the rule off.
export function listBankRules(
  options: { include_retired?: boolean } = {},
  signal?: AbortSignal
): Promise<BankRuleRow[]> {
  return node.get<BankRuleRow[]>(
    `/api/v1/finance/bank-rules${search({
      include_retired: options.include_retired === true ? true : undefined,
    })}`,
    { signal }
  )
}

export function recordBankRule(
  request: RecordBankRuleRequest,
  signal?: AbortSignal
): Promise<BankRuleRow> {
  return node.post<BankRuleRow>("/api/v1/finance/bank-rules", request, {
    signal,
  })
}

/// The whole rule again, not a patch of one field: the server re-checks the
/// pair of (category, meaning) and the pattern every time, so a half-sent rule
/// would be refused for what it left out.
export function updateBankRule(
  ruleId: string,
  request: RecordBankRuleRequest,
  signal?: AbortSignal
): Promise<BankRuleRow> {
  return node.patch<BankRuleRow>(
    `/api/v1/finance/bank-rules/${encodeURIComponent(ruleId)}`,
    request,
    { signal }
  )
}

/// Retire, never delete: the rule stays readable beside the proposals it made.
export function retireBankRule(
  ruleId: string,
  signal?: AbortSignal
): Promise<BankRuleRow> {
  return node.delete<BankRuleRow>(
    `/api/v1/finance/bank-rules/${encodeURIComponent(ruleId)}`,
    { signal }
  )
}

/// Run the active rules over every open bank line (or one statement's), and
/// write a proposal for each line one recognises. Posts nothing.
export function evaluateBankRules(
  options: { statementId?: string } = {},
  signal?: AbortSignal
): Promise<BankRuleRunOutcome> {
  return node.post<BankRuleRunOutcome>(
    "/api/v1/finance/bank-rules/evaluate",
    { statement_id: options.statementId ?? null },
    { signal }
  )
}

/// The categories a line can be said to mean, active ones unless asked.
/// `direction` is `OUTFLOW` or `INFLOW`; the server also returns `BOTH`.
export function listTransactionCategories(
  options: { direction?: string; include_retired?: boolean } = {},
  signal?: AbortSignal
): Promise<TransactionCategoryRow[]> {
  return node.get<TransactionCategoryRow[]>(
    `/api/v1/finance/transaction-categories${search({
      direction: options.direction,
      include_retired: options.include_retired === true ? true : undefined,
    })}`,
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

/// The register paged all the way through, sorted by due date, for a screen
/// that ADDS it up (Payment Projection, the Bank Account summary) and so must
/// not be answered with the first page. `listBills`'s own comment explains why
/// its callers page; these two sum, which is the one place a short page is a
/// silent wrong total.
export async function listAllBills(
  status: string,
  site: string | undefined,
  signal?: AbortSignal
): Promise<SupplierBill[]> {
  const rows: SupplierBill[] = []
  let cursor: string | undefined
  // A step, not a ceiling; and a safety valve against an unbounded loop, not
  // a real limit — forty thousand open bills is not a shape this client takes.
  for (let page = 0; page < 40; page++) {
    const answer = await listBills(
      { status, site, limit: 200, cursor, sort: "due", dir: "asc" },
      signal
    )
    rows.push(...answer.rows)
    if (answer.next_cursor === null) break
    cursor = answer.next_cursor
  }
  return rows
}

// ---------------------------------------------------------------------------
// Giro printing
//
// Not a document we produce. A bilyet giro is the bank's own leaf, already
// carrying its number; what a printer adds is nine facts, and the whole problem
// is landing them on boxes that are already there. So these read and write
// COORDINATES — see `0222`.

/// Giros, in one status or all of them, due date first. `OUT` we wrote,
/// `IN` somebody gave us.
export function listGiros(
  options: {
    status?: string
    bank?: string
    direction?: string
    as_of?: string
    limit?: number
  } = {},
  signal?: AbortSignal
): Promise<GiroRow[]> {
  return node.get<GiroRow[]>(`/api/v1/finance/giros${search(options)}`, {
    signal,
  })
}

/// The bank took it, on `on` — the day on the statement, not today. Posts the
/// clearing entry.
export function clearGiro(
  giroId: string,
  on: string,
  signal?: AbortSignal
): Promise<GiroRow> {
  const request: SettleGiroRequest = {
    on,
    statement_line_id: null,
    reason: null,
  }
  return node.post<GiroRow>(
    `/api/v1/finance/giros/${encodeURIComponent(giroId)}/clear`,
    request,
    { signal }
  )
}

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
// Recurring bills
//
// The promise, not the paper: what a supplier is expected to invoice every
// month, before the bill itself has arrived. `GET /finance/bill-templates`
// answers `serde_json::Value`-free but still has no `ts_rs` export — see
// `backend/src/cloud/postgres/bill_template.rs::BillTemplate` — so this is
// typed by hand, the way `fleet.ts` explains at its own top: field names and
// shapes transcribed from the struct's own doc comments, and a mismatch is
// this file's bug.
// ---------------------------------------------------------------------------

/// One recurring charge — `BillTemplate` on the wire.
export interface BillTemplateRow {
  readonly template_id: string
  readonly supplier_id: string
  readonly supplier_name: string | null
  readonly site_id: string
  readonly expense_account_code: string
  readonly expense_category_code: string | null
  readonly expense_site_id: string
  readonly expected_subtotal_minor: number
  readonly expected_tax_minor: number
  readonly tolerance_bps: number
  /// The day of the month it is expected, 1–31 — clamped to the month's own
  /// length by a reader that projects it forward, since not every month has
  /// a 31st.
  readonly due_day: number
  readonly label: string
  readonly note: string | null
  readonly active: boolean
  readonly contract_id: string | null
  readonly created_by: string
}

/// Every recurring bill template, retired ones included. The route takes no
/// filter — `GET /finance/bill-templates` always answers the whole list, and
/// a caller wanting only the live ones filters on `active` itself.
export function listBillTemplates(
  signal?: AbortSignal
): Promise<BillTemplateRow[]> {
  return node.get<BillTemplateRow[]>("/api/v1/finance/bill-templates", {
    signal,
  })
}

// ---------------------------------------------------------------------------
// Credit notes
// ---------------------------------------------------------------------------

/// The supplier credit notes, newest first. `status` is `DRAFT`, `POSTED` or
/// `REFUNDED`; `supplier` is the code a bill carries in its `supplier_id`.
/// The server clamps `limit` to 500 and answers a bare array, so a list that
/// comes back that long may have been cut off.
export function listCreditNotes(
  options: {
    status?: string
    supplier?: string
    invoice?: string
    limit?: number
  } = {},
  signal?: AbortSignal
): Promise<CreditNote[]> {
  return node.get<CreditNote[]>(
    `/api/v1/finance/credit-notes${search({ limit: 500, ...options })}`,
    { signal }
  )
}

/// Record a credit note against one purchase invoice. Not in the books yet:
/// it is a DRAFT until somebody posts it.
export function createCreditNote(
  request: CreditNoteRequest,
  signal?: AbortSignal
): Promise<CreditNote> {
  return node.post<CreditNote>("/api/v1/finance/credit-notes", request, {
    signal,
  })
}

/// Put a draft credit note in the ledger: it lowers what is owed on the
/// invoice without any money moving. With no date the server posts it on the
/// credit date.
export function postCreditNote(
  creditNoteId: string,
  postingDate?: string,
  signal?: AbortSignal
): Promise<CreditNote> {
  return node.post<CreditNote>(
    `/api/v1/finance/credit-notes/${encodeURIComponent(creditNoteId)}/post`,
    { posting_date: postingDate },
    { signal }
  )
}

/// The supplier sent the money back instead of letting the next bill absorb
/// it. A second act with its own date, which re-opens the debt the note had
/// answered.
export function refundCreditNote(
  creditNoteId: string,
  request: CreditNoteRefundRequest,
  signal?: AbortSignal
): Promise<CreditNote> {
  return node.post<CreditNote>(
    `/api/v1/finance/credit-notes/${encodeURIComponent(creditNoteId)}/refund`,
    request,
    { signal }
  )
}

// ---------------------------------------------------------------------------
// The register, whole
// ---------------------------------------------------------------------------

/// Every asset a narrowing matches, however many pages it takes.
///
/// `GET /finance/assets` is a keyset-paged list that answers 200 rows unless
/// told otherwise and never more than 1,000. The two asset reports add up
/// cost, depreciation and book value, and a total summed over a first page is
/// a wrong figure that looks right — so this follows `next_cursor` to the end.
/// The client's register is about 1,300 rows: two requests, not twenty.
///
/// `complete` is false only if the safety stop of twenty pages was reached,
/// which no register here comes near; a report that gets it says so rather
/// than printing a partial total as the whole.
export async function listAllAssets(
  options: { decision?: string; status?: string; site?: string } = {},
  signal?: AbortSignal
): Promise<{ rows: AssetRow[]; complete: boolean }> {
  const rows: AssetRow[] = []
  let cursor: string | undefined
  for (let page = 0; page < 20; page += 1) {
    const answer = await listAssets({ ...options, limit: 1000, cursor }, signal)
    rows.push(...answer.rows)
    if (answer.next_cursor === null || answer.next_cursor === undefined)
      return { rows, complete: true }
    cursor = answer.next_cursor
  }
  return { rows, complete: false }
}

/// One party's movements over a window, with the balance walking down them
/// — the supplier's Kartu Hutang.
///
/// Read from the general ledger's own party lines, so the closing figure is
/// the balance the books carry. The balance is credits less debits: what is
/// owed to the party, which a bill raises and a payment or an advance lowers.
/// `from` defaults to 1 January of `to`'s year and `to` to today.
export function partyMovements(
  partyType: string,
  partyId: string,
  options: { from?: string; to?: string; unit?: string } = {},
  signal?: AbortSignal
): Promise<PartyMovements> {
  return node.get<PartyMovements>(
    `/api/v1/finance/payment-ledger/${encodeURIComponent(partyType)}/${encodeURIComponent(partyId)}/movements${search(options)}`,
    { signal }
  )
}

/// What `POST /finance/bill-templates` takes — `RecordBillTemplateRequest`.
///
/// `supplier_id` is the supplier's CODE, as on a bill. `expense_site_id`
/// defaults to `site_id` on the server, which is the only pairing that posts
/// today (a cost at another site needs an inter-unit credit).
export interface RecordBillTemplateRequest {
  readonly supplier_id: string
  readonly supplier_name?: string | null
  readonly site_id: string
  readonly expense_account_code: string
  readonly expense_category_code?: string | null
  readonly expense_site_id?: string | null
  readonly expected_subtotal_minor: number
  readonly expected_tax_minor: number
  /// Basis points either side of the expected figure a raised draft may
  /// differ by before it is flagged. The server defaults to 500 (5%).
  readonly tolerance_bps?: number
  readonly due_day: number
  readonly label: string
  readonly note?: string | null
}

/// Write a promise down. The server checks the account is postable and the
/// category belongs to it, and answers in words when it does not.
export function recordBillTemplate(
  request: RecordBillTemplateRequest
): Promise<BillTemplateRow> {
  return node.post<BillTemplateRow>("/api/v1/finance/bill-templates", request)
}

/// Stop a promise. Drafts it already raised stay.
export function retireBillTemplate(
  templateId: string
): Promise<{ retired: string }> {
  return node.post<{ retired: string }>(
    `/api/v1/finance/bill-templates/${encodeURIComponent(templateId)}/retire`,
    {}
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
  options: { status?: string; unit?: string; sort?: string } = {},
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

// ---------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------

export type InventoryValuationRow = {
  unit_id: string
  site_id: string
  site_name: string
  in_transit: boolean
  division_code: string | null
  article_code: string
  article_name: string
  quantity: number
  unit_cost_minor: number
  value_minor: number
  cost_source: "RECEIPT" | "PO" | "NONE"
  po_numbers: string | null
  po_count: number
}

export type AwaitingSetupRow = {
  unit_id: string
  receipt_number: string
  po_number: string | null
  supplier_id: string | null
  received_on: string | null
  lines: number
  quantity: number
  value_minor: number
}

export type InventoryValuation = {
  as_of: string
  rows: InventoryValuationRow[]
  awaiting_setup: AwaitingSetupRow[]
}

export type StockLedgerUnitRow = {
  unit_id: string
  unit_name: string
  on_hand_minor: number
  awaiting_setup_minor: number
  stock_minor: number
  ledger_minor: number
  difference_minor: number
  in_transit_stock_minor: number
  in_transit_ledger_minor: number
  in_transit_difference_minor: number
}

/// What the stock is worth: pieces on hand × the price each was bought at.
export function inventoryValuation(
  options: { unit?: string | null } = {},
  signal?: AbortSignal
): Promise<InventoryValuation> {
  return node.get<InventoryValuation>(
    `/api/v1/finance/inventory/valuation${search({ unit: options.unit })}`,
    { signal }
  )
}

/// Each unit's stock at cost against its inventory account and 1031.
export function stockVsLedger(
  signal?: AbortSignal
): Promise<StockLedgerUnitRow[]> {
  return node.get<StockLedgerUnitRow[]>(
    "/api/v1/finance/inventory/stock-vs-ledger",
    { signal }
  )
}

/// One piece-line head office has sent that the shop has not counted in yet.
export type GoodsInTransitRow = {
  allotment_line_id: string
  shipment_reference: string | null
  koli_number: string | null
  destination_site_id: string
  destination_name: string
  destination_unit_id: string
  sku_code: string
  article_code: string | null
  article_name: string | null
  quantity: number
  value_minor: number
  dispatched_on: string | null
  days: number
  status: "ON_THE_ROAD" | "SHORT"
}

/// BDP (1031): goods sent and not yet counted in.
export function goodsInTransit(
  signal?: AbortSignal
): Promise<GoodsInTransitRow[]> {
  return node.get<GoodsInTransitRow[]>("/api/v1/finance/inventory/in-transit", {
    signal,
  })
}

export type CogsMonthRow = {
  unit_id: string
  unit_name: string
  year: number
  month: number
  revenue_minor: number
  cogs_minor: number
  gross_margin_minor: number
}

/// Net sales against the cost of what was sold, per unit and month.
export function cogsByMonth(
  year: number,
  signal?: AbortSignal
): Promise<CogsMonthRow[]> {
  return node.get<CogsMonthRow[]>(
    `/api/v1/finance/inventory/cogs${search({ year })}`,
    { signal }
  )
}

export type StockAdjustmentRow = {
  state: "BOOKED" | "SHORT_IN_TRANSIT" | "MISSING"
  unit_id: string
  on_date: string | null
  reference: string
  kind: string
  description: string
  quantity: number | null
  /// Signed: negative takes value off stock.
  value_minor: number
}

/// Stock value changed by anything other than buying, moving or selling.
export function stockAdjustments(
  signal?: AbortSignal
): Promise<StockAdjustmentRow[]> {
  return node.get<StockAdjustmentRow[]>(
    "/api/v1/finance/inventory/adjustments",
    { signal }
  )
}

// ---------------------------------------------------------------------------
// Query options
// ---------------------------------------------------------------------------

/// What a screen asks for, written once. A screen reads these with
/// `useSuspenseQuery` and `screens/finance/prefetch.ts` warms them, so the
/// server's first HTML and the browser's first render are the same read under
/// the same key (`lib/prefetch.ts`). Held as long as the data moves: lists the
/// client edits about once a year for five minutes, anything a posting changes
/// for thirty seconds (the client's default).

const FIVE_MINUTES = 5 * 60 * 1000

/// The month calendar, as the rows every reader of this key holds. `useWindow`
/// filters it as an array, so the envelope is unwrapped once, here.
export const periodsQuery = () =>
  queryOptions({
    queryKey: financeKeys.periods(),
    queryFn: ({ signal }) => listPeriods(signal).then((page) => page.rows),
    staleTime: 60_000,
  })

/// The client's asset classes, with how many assets each holds.
export const assetClassesQuery = () =>
  queryOptions({
    queryKey: financeKeys.assetClasses(),
    queryFn: ({ signal }) => listAssetClasses(signal),
    staleTime: FIVE_MINUTES,
  })

/// Finance's master data lists, each one answer fetched whole.
export const expenseCategoriesQuery = () =>
  queryOptions({
    queryKey: financeKeys.expenseCategories(),
    queryFn: ({ signal }) => listExpenseCategories(signal),
    staleTime: FIVE_MINUTES,
  })

export const payComponentsQuery = () =>
  queryOptions({
    queryKey: financeKeys.payComponents(),
    queryFn: ({ signal }) => listPayComponentPostings(signal),
    staleTime: FIVE_MINUTES,
  })

export const paymentMethodsQuery = () =>
  queryOptions({
    queryKey: financeKeys.paymentMethods(),
    queryFn: ({ signal }) => listPaymentMethods(signal),
    staleTime: FIVE_MINUTES,
  })

export const taxTemplatesQuery = () =>
  queryOptions({
    queryKey: financeKeys.taxTemplates(),
    queryFn: ({ signal }) => listTaxTemplates(signal),
    staleTime: FIVE_MINUTES,
  })

export const dimensionsQuery = () =>
  queryOptions({
    queryKey: financeKeys.dimensions(),
    queryFn: ({ signal }) => listDimensions(signal),
    staleTime: FIVE_MINUTES,
  })

/// The taxes the company owes or claims per period, each named by the role its
/// account answers to.
export const taxTypesQuery = () =>
  queryOptions({
    queryKey: financeKeys.taxTypes(),
    queryFn: ({ signal }) => listTaxTypeSettings(signal),
  })

/// The saved journal templates and the schedules that repeat them.
export const journalTemplatesQuery = () =>
  queryOptions({
    queryKey: financeKeys.journalTemplates(),
    queryFn: ({ signal }) => listJournalTemplates(signal),
  })

export const journalRepeatsQuery = () =>
  queryOptions({
    queryKey: financeKeys.journalRepeats(),
    queryFn: ({ signal }) => listJournalRepeats(signal),
  })

/// The numbers Finance's rules read — tolerances, windows, thresholds.
export const financeSettingsQuery = () =>
  queryOptions({
    queryKey: financeKeys.settings(),
    queryFn: ({ signal }) => listFinanceSettings(signal),
  })

/// The route-rung overrides.
export const rolePermissionsQuery = () =>
  queryOptions({
    queryKey: financeKeys.permissions(),
    queryFn: ({ signal }) => listRolePermissions(signal),
  })

/// Which document kinds post by themselves, and the master switch over them.
export const postingSwitchesQuery = () =>
  queryOptions({
    queryKey: financeKeys.postingSwitches(),
    queryFn: ({ signal }) => postingSwitches(signal),
  })

/// Every shop's EDC machines, the banks one can be of, and the Cash In Bank
/// accounts one can settle to.
export const edcMachinesQuery = () =>
  queryOptions({
    queryKey: financeKeys.edcMachines(),
    queryFn: ({ signal }) =>
      node.get<EdcMachineBook>("/api/v1/finance/edc-machines", { signal }),
  })

/// Where the words go on each bank's giro leaf.
export const giroPrintTemplatesQuery = (includeRetired = false) =>
  queryOptions({
    queryKey: financeKeys.giroPrintTemplates(includeRetired),
    queryFn: ({ signal }) => giroPrintTemplates(includeRetired, signal),
  })

/// Which (role, source, unit) resolves to no account — the readiness matrix.
/// Read under this one key by the Posting readiness screen, the Account links
/// screen and the sidebar's badge.
export const postingReadinessQuery = () =>
  queryOptions({
    queryKey: financeKeys.postingReadiness(),
    queryFn: ({ signal }) => postingReadiness(signal),
    staleTime: 60_000,
  })

/// Every account link with the roles the posting rules name and the units the
/// books are kept for. One key for the lot: the Account links screen, every
/// unit picker and `useUnitName` read it, so a module full of them is one
/// request. Held for five minutes — the client opens a store about once a
/// year — and a save invalidates it (`financeKeys.accountLinksAll`).
export const accountLinksQuery = (
  q: string | null = null,
  role: string | null = null
) =>
  queryOptions({
    queryKey: financeKeys.accountLinks(q, role),
    queryFn: ({ signal }) =>
      accountLinks({ q: q ?? undefined, role: role ?? undefined }, signal),
    staleTime: FIVE_MINUTES,
  })

/// The ranges closed into retained earnings, newest first.
export const periodClosingsQuery = () =>
  queryOptions({
    queryKey: financeKeys.periodClosings(),
    queryFn: ({ signal }) => listPeriodClosings(signal),
  })

/// The recurring-bill promises, retired ones included.
export const billTemplatesQuery = () =>
  queryOptions({
    queryKey: financeKeys.billTemplates(),
    queryFn: ({ signal }) => listBillTemplates(signal),
  })

/// A cost booked before its bill — the month's telephone, electricity — that
/// waits until the supplier's bill replaces it.
export interface AccrualRow {
  readonly entry_id: string
  readonly entry_number: string
  readonly posting_date: string
  readonly unit_id: string
  readonly account_code: string
  readonly account_name: string
  readonly expense_code: string | null
  readonly expense_name: string | null
  readonly amount_minor: number
  readonly memo: string | null
  readonly status: "OPEN" | "SETTLED"
  readonly settled_on: string | null
  readonly invoice_id: string | null
  readonly invoice_number: string | null
  readonly supplier_name: string | null
  readonly invoice_total_minor: number | null
}

export const accrualKeys = {
  all: ["finance", "accruals"] as const,
  list: (status: string) => ["finance", "accruals", status] as const,
}

export function listAccruals(status: string, signal?: AbortSignal) {
  return node.get<AccrualRow[]>(
    `/api/v1/finance/accruals${status === "ALL" ? "" : `?status=${status}`}`,
    { signal }
  )
}

/// Every accrual in one read, so each tab can say how many it holds.
export const accrualsQuery = () =>
  queryOptions({
    queryKey: accrualKeys.list("ALL"),
    queryFn: ({ signal }) => listAccruals("ALL", signal),
  })

/// Work paid ahead to a contractor — a renovation, a fit-out — invoiced over
/// the months it takes and split at the end into assets and expense.
export interface ContractorProject {
  readonly project_id: string
  readonly project_number: string
  readonly name: string
  /// `CONTRACTOR` (0720's), `STORE_OPENING` or `RENOVATION` (0997).
  readonly kind: "CONTRACTOR" | "STORE_OPENING" | "RENOVATION"
  readonly supplier_id: string | null
  readonly supplier_name: string | null
  readonly unit_id: string
  readonly site_id: string | null
  readonly opens_on: string | null
  readonly note: string | null
  /// GA closes a project (`READY`); Finance capitalises it (0997).
  readonly status: "OPEN" | "READY" | "CAPITALISED"
  readonly ready_on: string | null
  readonly opened_at: string
  readonly closed_on: string | null
  readonly advanced_minor: number
  readonly invoiced_minor: number
  readonly applied_minor: number
  readonly advance_left_minor: number
  readonly owed_minor: number
  readonly advance_count: number
  readonly invoice_count: number
}

export const contractorProjectKeys = {
  all: ["finance", "contractor-projects"] as const,
  one: (id: string) => ["finance", "contractor-projects", id] as const,
}

export const contractorProjectsQuery = () =>
  queryOptions({
    queryKey: contractorProjectKeys.all,
    queryFn: ({ signal }) =>
      node.get<ContractorProject[]>("/api/v1/finance/contractor-projects", {
        signal,
      }),
  })

/// The credit notes, narrowed by status on the server.
export const creditNotesQuery = (status = "") =>
  queryOptions({
    queryKey: financeKeys.creditNotes(status || null, null),
    queryFn: ({ signal }) =>
      listCreditNotes({ status: status || undefined }, signal),
  })

/// Every bill in one status, followed to the last page, as the Payment
/// Projection and the Overview read them: what is due and what is coming.
/// `site` is a unit's sites, comma-separated; absent means every unit.
export const projectionBillsQuery = (
  status: "POSTED" | "DRAFT",
  site?: string
) =>
  queryOptions({
    queryKey: [...financeKeys.bills(status, site ?? null), "projection"],
    queryFn: ({ signal }) => listAllBills(status, site, signal),
    staleTime: 30_000,
  })

/// The giros we wrote, whatever their status — the projection drops the
/// cleared ones itself.
export const projectionGirosQuery = () =>
  queryOptions({
    queryKey: ["finance", "giros", "projection", "OUT"] as const,
    queryFn: ({ signal }) =>
      listGiros({ direction: "OUT", limit: 1000 }, signal),
    staleTime: 30_000,
  })

/// Goods received that no bill covers yet.
export const projectionUnbilledQuery = () =>
  queryOptions({
    queryKey: ["finance", "unbilled", "projection"] as const,
    queryFn: ({ signal }) => unbilledReceipts(signal),
    staleTime: 30_000,
  })

/// The purchase orders, for the "ordered, not received" estimate.
export const projectionOrdersQuery = () =>
  queryOptions({
    queryKey: procurementKeys.orders(),
    queryFn: ({ signal }) => listPurchaseOrders(undefined, signal),
    staleTime: 30_000,
  })

/// The payment terms the estimate reads a payment date from.
export const projectionTermsQuery = () =>
  queryOptions({
    queryKey: procurementKeys.paymentTerms(),
    queryFn: ({ signal }) => paymentTermsBook(signal),
    staleTime: 5 * 60_000,
  })

/// What the bank accounts held at one date, in the books, as one figure — the
/// Overview's balance chart draws twelve of these, and the whole overview of
/// each (a hundred kilobytes of accounts) would be twelve times too much to
/// send. Under the overview's own key, so a posting that refreshes the
/// overview refreshes this too.
export const bankTotalQuery = (asOf: string) =>
  queryOptions({
    queryKey: [...financeKeys.money(asOf, null), "bank-total"] as const,
    queryFn: ({ signal }) =>
      moneyOverview({ as_of: asOf }, signal).then((overview) =>
        overview.rows
          .filter((row) => row.pot === "BANK")
          .reduce((sum, row) => sum + row.per_books_minor, 0)
      ),
  })

/// What is owed to suppliers as at a day, for all units or one: the server's
/// own ageing, so every screen that says "payables" says the same figure.
export const payablesAgingQuery = (asOf: string, unit: string | null = null) =>
  queryOptions({
    queryKey: financeKeys.payablesAging(asOf, unit),
    queryFn: ({ signal }) =>
      payablesAging({ as_of: asOf, unit: unit ?? undefined }, signal),
  })

/// The deliveries inside that figure, one row each.
export const openDeliveriesQuery = (asOf: string, unit: string | null = null) =>
  queryOptions({
    queryKey: financeKeys.openDeliveries(asOf, unit),
    queryFn: ({ signal }) =>
      openDeliveries({ as_of: asOf, unit: unit ?? undefined }, signal),
  })

/// Stock on hand against what the ledger carries, per unit.
export const stockVsLedgerQuery = () =>
  queryOptions({
    queryKey: financeKeys.stockVsLedger(),
    queryFn: ({ signal }) => stockVsLedger(signal),
  })

/// Boxes sent and not yet counted in.
export const goodsInTransitQuery = () =>
  queryOptions({
    queryKey: financeKeys.goodsInTransit(),
    queryFn: ({ signal }) => goodsInTransit(signal),
  })

/// What one of a shop's cash boxes holds on a day (`limit: 1`: only the
/// balance is wanted, not the movements). Finance › Stores draws one per shop
/// and box.
export const storeBoxQuery = (
  unit: string,
  role: string,
  code: string,
  day: string
) =>
  queryOptions({
    queryKey: [...financeKeys.all, "store-box", unit, role, day] as const,
    queryFn: ({ signal }) =>
      accountLedger(code, { unit, from: day, to: day, limit: 1 }, signal),
    staleTime: 60_000,
  })

/// One cash box's movements over a month, a page at a time.
export const storeBoxLedgerQuery = (
  unit: string,
  role: string,
  code: string,
  from: string,
  to: string,
  q: string
) =>
  infiniteQueryOptions({
    queryKey: [...financeKeys.all, "store-box-ledger", unit, role, from, to, q],
    queryFn: ({ pageParam, signal }) =>
      accountLedger(
        code,
        {
          unit,
          from,
          to,
          q: q === "" ? undefined : q,
          limit: 100,
          cursor: pageParam,
        },
        signal
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  })

/// Every cash count, held under the shop it is being read for.
export const storeCashCountsQuery = (unit: string) =>
  queryOptions({
    queryKey: [...financeKeys.all, "cash-counts", "unit", unit] as const,
    queryFn: ({ signal }) => listCashCounts(signal),
  })

/// Stock at cost, per article and site; `unit` narrows it to one unit.
export const inventoryValuationQuery = (unit: string | null = null) =>
  queryOptions({
    queryKey: financeKeys.inventoryValuation(unit),
    queryFn: ({ signal }) => inventoryValuation({ unit }, signal),
  })

/// The cost of goods sold, month by month, for one year.
export const cogsQuery = (year: number) =>
  queryOptions({
    queryKey: financeKeys.cogs(year),
    queryFn: ({ signal }) => cogsByMonth(year, signal),
  })

/// Stock value changed by anything other than buying, moving or selling.
export const stockAdjustmentsQuery = () =>
  queryOptions({
    queryKey: financeKeys.stockAdjustments(),
    queryFn: ({ signal }) => stockAdjustments(signal),
  })

/// The profit and loss cut by one accounting dimension over a window.
export const dimensionResultsQuery = (
  dimension: string,
  from: string,
  to: string,
  unit: string | null = null
) =>
  queryOptions({
    queryKey: financeKeys.dimensionResults(dimension, from, to, unit),
    queryFn: ({ signal }) =>
      dimensionResults({ dimension, from, to, unit }, signal),
  })

/// The balance sheet at one date. No `from`: a balance sheet is cumulative,
/// and the server drops it. Under `financeKeys.statement` with the window's
/// start left null, so it never shares an entry with a profit and loss.
export const balanceStatementQuery = (at: string, unit: string | null = null) =>
  queryOptions({
    queryKey: financeKeys.statement("BALANCE_SHEET", null, at, unit),
    queryFn: ({ signal }) =>
      statement("BALANCE_SHEET", { to: at, unit: unit ?? undefined }, signal),
  })

/// The profit and loss over a window, as a statement.
export const resultStatementQuery = (
  from: string,
  to: string,
  unit: string | null = null
) =>
  queryOptions({
    queryKey: financeKeys.statement("PROFIT_LOSS", from, to, unit),
    queryFn: ({ signal }) =>
      statement("PROFIT_LOSS", { from, to, unit: unit ?? undefined }, signal),
  })

/// Every asset the register holds under one narrowing, followed to the last
/// page (the Fixed Asset Register and Asset Disposals both total over it).
export const assetsAllQuery = (
  decision: string | null,
  status: string | null,
  site = ""
) =>
  queryOptions({
    queryKey: financeKeys.assetsAll(decision, status, site || null),
    queryFn: ({ signal }) =>
      listAllAssets(
        {
          decision: decision ?? undefined,
          status: status ?? undefined,
          site: site || undefined,
        },
        signal
      ),
  })

/// The giros in one status — the server filters, so each status is its own
/// request. `limit` is the screen's: the Giro Board pages 300 of each, Bank
/// Clearance asks for 500.
export const girosQuery = (status: string, limit: number) =>
  queryOptions({
    queryKey: financeKeys.giros(status),
    queryFn: ({ signal }) => listGiros({ status, limit }, signal),
  })

/// The Giro Board's reads: one per status the board has a lane for, 300 of
/// each.
export const giroBoardQueries = () =>
  ["ISSUED", "DELIVERED", "DUE", "CLEARED", "REJECTED"].map((status) =>
    girosQuery(status, 300)
  )

/// Bank Clearance's reads: the giros written and not yet taken by the bank,
/// and — when "Include reconciled" is ticked — the cleared ones.
export const giroClearanceQueries = (withCleared: boolean) =>
  ["ISSUED", "DELIVERED", "DUE", ...(withCleared ? ["CLEARED"] : [])].map(
    (status) => girosQuery(status, 500)
  )

/// The rules that recognise a bank line. Retired ones are a separate entry:
/// the server hides them unless asked.
export const bankRulesQuery = (includeRetired = false) =>
  queryOptions({
    queryKey: financeKeys.bankRules(includeRetired),
    queryFn: ({ signal }) =>
      listBankRules({ include_retired: includeRetired }, signal),
  })

/// The asset register, a page at a time. The location, the search and the
/// order are the server's — `treatment` included, so the not-assessed rows are
/// still the first screenful — and the table reads on as somebody scrolls.
export const assetPagesQuery = (
  site: string,
  scope: { q?: string; sort?: string; dir?: string }
) => {
  const ask = {
    site: site || undefined,
    q: scope.q,
    sort: scope.sort,
    dir: scope.dir,
    limit: 100,
  }
  return infiniteQueryOptions({
    queryKey: [...financeKeys.assets(false, site || null), "pages", ask],
    queryFn: ({ pageParam, signal }) =>
      listAssets({ ...ask, cursor: pageParam }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  })
}

/// How many assets nobody has assessed yet at a location, counted by the
/// server (the register's facets ignore the location).
export const unassessedAssetsQuery = (site: string) =>
  queryOptions({
    queryKey: [...financeKeys.assets(true, site || null), "count"],
    queryFn: ({ signal }) =>
      listAssets(
        { site: site || undefined, decision: "UNASSESSED", limit: 1 },
        signal
      ),
  })

/// The accounts directly under one heading (or the eight roots when `parent`
/// is null). A branch is safely whole: no heading in this client's chart has
/// more than 36 children, against a page of 200. The chart is imported once
/// and then sits for months, so a branch reopened twice in a session does not
/// ask twice.
export const accountChildrenQuery = (
  parent: string | null,
  inactive: boolean
) =>
  queryOptions({
    queryKey: financeKeys.accountChildren(parent, inactive),
    queryFn: ({ signal }) =>
      accountChildren({ parent: parent ?? undefined, inactive }, signal).then(
        (page) => page.rows
      ),
    staleTime: 10 * 60 * 1000,
  })

/// The balance beside every account of one level, by account code. Beside the
/// rows rather than inside them: the chart sits for months, the balances move
/// with every posting, so they are read on their own clock. A plain record and
/// not a `Map`, so it crosses from the server to the browser as it is.
export const accountBalancesQuery = (
  parent: string | null,
  unit: string | null
) =>
  queryOptions({
    queryKey: financeKeys.accountBalances(parent, unit),
    queryFn: ({ signal }) =>
      accountBalances(
        { parent: parent ?? undefined, unit: unit ?? undefined },
        signal
      ).then((rows) =>
        Object.fromEntries(
          rows.map((row) => [row.account_code, row.balance_minor])
        )
      ),
    staleTime: 30_000,
  })

/// A search of the chart, a page at a time, read on as the card scrolls. 101
/// matches 1,248 accounts in this client's chart.
export const accountSearchPagesQuery = (needle: string, inactive: boolean) =>
  infiniteQueryOptions({
    queryKey: [...financeKeys.accountSearch(needle, inactive), "pages"],
    queryFn: ({ pageParam, signal }) =>
      searchAccounts(
        needle,
        { inactive, limit: 100, cursor: pageParam },
        signal
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    staleTime: 60_000,
  })

/// The trial balance as at one day, for all units or one. The report reads two
/// of these (the day before its window opens, and the day it closes) and
/// subtracts, so each is the same endpoint under its own date.
export const trialBalanceQuery = (asOf: string, unit: string | null = null) =>
  queryOptions({
    queryKey: financeKeys.trialBalance(asOf, unit),
    queryFn: ({ signal }) =>
      trialBalance(
        { as_of: asOf, unit: unit ?? undefined, limit: 2000 },
        signal
      ),
  })

/// The cash flow statement over a window: every entry that touched a cash or
/// bank account, with its other side filed by activity.
export const cashFlowStatementQuery = (
  from: string,
  to: string,
  unit: string | null = null
) =>
  queryOptions({
    queryKey: financeKeys.statement("CASH_FLOW", from, to, unit),
    queryFn: ({ signal }) =>
      statement("CASH_FLOW", { from, to, unit: unit ?? undefined }, signal),
  })

/// What the money accounts hold, for all units or one: the Cash report, Cash
/// Transactions, Petty Cash, Deposits and the bank screens all read it, so a
/// posting that refreshes one refreshes the rest.
export const moneyOverviewQuery = (
  unit: string | null = null,
  asOf: string | null = null
) =>
  queryOptions({
    queryKey: financeKeys.money(asOf, unit),
    queryFn: ({ signal }) =>
      moneyOverview(
        { as_of: asOf ?? undefined, unit: unit ?? undefined },
        signal
      ),
  })

/// One account's ledger window, for all units or one, as the report screens
/// read it: `closing_minor` and the window's totals are properties of the
/// window and not of the page, so `limit: 1` keeps the movements nobody is
/// reading off the wire. A one-day window (`from == to`) is how a balance is
/// asked for "as at" a day. The key carries the unit, so two units are two
/// entries and never one answer wearing both names.
export const ledgerWindowQuery = (
  code: string,
  unit: string | null,
  from: string,
  to: string
) =>
  queryOptions({
    queryKey: financeKeys.ledger(code, unit, from, to),
    queryFn: ({ signal }) =>
      accountLedger(
        code,
        { unit: unit ?? undefined, from, to, limit: 1 },
        signal
      ),
  })

/// Every physical count, newest first and never narrowed: the Cash report,
/// Deposits and Cash Counts all read the one list.
export const cashCountsQuery = () =>
  queryOptions({
    queryKey: financeKeys.cashCounts(null, null),
    queryFn: ({ signal }) => listCashCounts(signal),
  })

/// The posted bills a page at a time, as Accounts Payable reads them: narrowed
/// to a unit's sites by the server (a comma-joined list, empty for every
/// site), and read on as the table scrolls.
export const postedBillPagesQuery = (sites: string) =>
  infiniteQueryOptions({
    queryKey: [...financeKeys.bills("POSTED", sites || null), "pages"],
    queryFn: ({ pageParam, signal }) =>
      listBills(
        {
          status: "POSTED",
          site: sites || undefined,
          limit: 100,
          cursor: pageParam,
        },
        signal
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  })

/// The bank statements that have arrived, newest first: the first page, for
/// all units or one (the unit is part of the key, so a unit's list never
/// overwrites the company's). Bank Reconciliation, Deposits and the sidebar's
/// count of lines nobody has agreed yet all read it.
export const bankStatementsQuery = (unit: string | null = null) =>
  queryOptions({
    queryKey: financeKeys.bankStatements(unit),
    queryFn: ({ signal }) =>
      listBankStatements(signal, unit === null ? {} : { unit }),
  })

/// What our own bank accounts are — the bank, the number, the holder — as
/// opposed to where they post. Small and edited about once a year.
export const companyBankAccountsQuery = () =>
  queryOptions({
    queryKey: financeKeys.companyBankAccounts(null),
    queryFn: ({ signal }) => listCompanyBankAccounts(signal),
    staleTime: 5 * 60_000,
  })

/// Every category a journal line may carry, with the family each belongs to.
/// The line-category reference reads it; the journal's pickers read the same
/// list a family at a time under their own keys.
export const lineCategoriesQuery = () =>
  queryOptions({
    queryKey: financeKeys.lineCategories(null),
    queryFn: ({ signal }) => listLineCategories(null, signal),
    staleTime: 5 * 60 * 1000,
  })
