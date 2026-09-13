/// The Finance contract, written as types a running engine obeys.
///
/// # Why this exists beside a backend that already posts
///
/// `backend/src/cloud/postgres/poster.rs` is the production door into the
/// journal and nothing here replaces it. What the backend does NOT have is a
/// place to answer "would this rule post, and what would it post, and why was
/// it refused" without a database, a migration and a seed. Every contract
/// defect found while writing this file — an ambiguous binding, a role with no
/// binding, a rule that charges cost of goods twice on a split tender — is a
/// defect that would otherwise have been found by posting it.
///
/// So this is a CONFORMANCE HARNESS. It runs in the browser, over fixtures
/// lifted from the client's own July 2026 journal, and it is labelled
/// Simulation everywhere it is shown. It is not a second ledger and must never
/// become one: nothing in here talks to the network.
///
/// # The three sources of truth the plan asks to keep apart
///
/// Every rule carries all three, because collapsing them is how "the COA has
/// an account for it" turns into "the system posts to it":
///
///   * [`Evidence`]    — what the accounting claim rests on.
///   * [`Readiness`]   — how far the implementation got.
///   * [`Activation`]  — whether it may run, for which book, from when.
///
/// A rule may be LOCKED in the old matrix, evidenced by an actual journal, and
/// still refuse to post because nobody activated it for this book. That
/// separation is the whole point.

// ---------------------------------------------------------------------------
// Money and time
// ---------------------------------------------------------------------------

/// Rupiah in minor units. The client's own journal is exported to two decimals
/// and every figure in it is a whole rupiah, so `minor` here is *sen*: 348,276
/// rupiah is 34_827_600.
///
/// Integer, never float. `26390000.000000004` is what the client's own asset
/// export contains for the air conditioner, and that number arriving in a
/// ledger is how a trial balance ends up out by four sen.
export type Minor = number

/// `YYYY-MM-DD`. Four different dates matter and they are never the same field:
/// see [`EventDates`].
export type Day = string

/// `YYYY-MM`.
export type Month = string

/// The four dates the plan insists on separating.
export interface EventDates {
  /// When the thing happened in the world. The installer came on the 12th.
  readonly occurred_on: Day
  /// The date on the piece of paper. The BKK is dated the 27th.
  readonly document_on: Day
  /// The date the books take it on. Usually the document date; not always —
  /// a late invoice lands in the open month.
  readonly posting_on: Day
  /// Derived from `posting_on`, carried so a screen never has to re-derive it
  /// and get a different answer at a month boundary.
  readonly period: Month
}

// ---------------------------------------------------------------------------
// Books, units, and who is asking
// ---------------------------------------------------------------------------

/// A set of books that balances on its own.
///
/// The client keeps one per legal entity; every unit posts into the entity's
/// book and carries its own dimension. A transfer between BOOKS is not the
/// same event as a transfer between units inside one book, which is the
/// distinction §5 of the plan asks for — see `TRANSFER_INTERBOOK` in `rules`.
export interface Book {
  readonly book_id: string
  readonly name: string
  readonly entity: string
  readonly currency: "IDR"
}

/// A unit: head office, a distribution centre, a shop. The client's own suffix
/// (`06` for C006) is what their account codes carry, so it is stored rather
/// than derived from a position in a list.
export interface Unit {
  readonly unit_id: string
  readonly book_id: string
  readonly name: string
  readonly kind: "HO" | "DC" | "STORE"
  /// The two digits the client's twelve-character leaves end with.
  readonly coa_suffix: string
}

/// What a person may do. GA never chooses a debit and a credit; that is the
/// division of labour §6 asks for, and it is enforced by the actions a role can
/// reach rather than by hiding a field.
export type Role = "GA" | "FINANCE" | "FINANCE_MANAGER" | "VIEWER"

// ---------------------------------------------------------------------------
// The chart, and the map into it
// ---------------------------------------------------------------------------

/// One account of the client's own chart, imported verbatim.
///
/// `postable` is the client's own `is_group` inverted, kept as the client
/// declared it. `blocked_units` is OURS and is separate on purpose: the plan
/// asks that the COA's own flags and our per-unit posting policy stay apart,
/// because "the master still lists supplier payable for a shop" and "a shop may
/// not post to it" are two different facts and the client's file only carries
/// the first.
export interface Account {
  readonly code: string
  readonly name: string
  readonly root_class: string
  readonly postable: boolean
  readonly unit_id?: string
  /// Units this account may not be posted to even though the chart lists it.
  /// Evidence: the client confirmed shops do not use the merchandise supplier
  /// payable, and the master still carries it.
  readonly blocked_units?: readonly string[]
}

/// A registered bank account. The plan's first resolver defect, fixed.
///
/// v0.1 resolved `BANK_CUSTODY` by bank name, so "BCA" could not choose
/// between `Cash In Bank Giro Bank BCA C006` and `Cash In Bank Tabungan Bank
/// BCA C006`. The dimension is therefore not a bank, it is a REGISTERED
/// ACCOUNT with its own identity, and the identity is what carries the ledger
/// code. Mandiri, BRI and BNI had the same defect and it is the same fix.
export interface BankAccount {
  readonly bank_account_id: string
  readonly unit_id: string
  readonly bank: "BCA" | "MANDIRI" | "BRI" | "BNI" | "DANAMON" | "BTN"
  readonly product: "GIRO" | "TABUNGAN" | "DEPOSITO"
  /// Masked. The prototype never holds a real number.
  readonly number_masked: string
  readonly label: string
}

// ---------------------------------------------------------------------------
// Roles a rule may name, and the bindings that answer them
// ---------------------------------------------------------------------------

/// A meaning a posting rule is allowed to ask for.
///
/// The list is closed and typed, which is the second resolver fix: v0.1 carried
/// free-text placeholders such as `<EXPENSE_ROLE>` and `<CASH_OR_BANK_ROLE>`
/// that a rule could fill with anything. A placeholder that is not in a
/// declared set is a rule that cannot be validated until it runs.
export type AccountRole =
  // cash and bank
  | "CASH_ON_HAND"
  | "PETTY_CASH"
  | "CASHIER_FLOAT"
  | "BANK"
  // trade
  | "INVENTORY"
  | "GOODS_IN_TRANSIT"
  | "COGS"
  | "SALES_REVENUE_CASH"
  | "SALES_REVENUE_CARD"
  | "SALES_RETURN"
  | "CARD_RECEIVABLE"
  | "CARD_FEE"
  // payroll
  | "SALARY_EXPENSE"
  | "BENEFIT_EXPENSE"
  | "SALARY_ACCRUAL"
  | "BENEFIT_ACCRUAL"
  | "ALLOWANCE_EXPENSE"
  // interunit
  | "AFFILIATE_GOODS_PAYABLE"
  | "AFFILIATE_FINANCING_PAYABLE"
  | "PRINCIPAL_PAYABLE"
  | "AFFILIATE_GOODS_RECEIVABLE"
  | "AFFILIATE_FINANCING_RECEIVABLE"
  | "PRINCIPAL_RECEIVABLE"
  // assets
  | "FIXED_ASSET"
  | "ACCUM_DEPRECIATION"
  | "DEPRECIATION_EXPENSE"
  | "OE_ASSET"
  | "REPLACEMENT_RESERVE"
  | "REPLACEMENT_EXPENSE"
  // sundry
  | "BANK_CHARGE"
  | "HOUSEKEEPING_EXPENSE"
  | "RENT_EXPENSE"
  | "PREPAID_RENT"
  | "SUPPLIER_PAYABLE"
  | "ROUNDING"
  | "INTEREST_INCOME"
  | "TIME_DEPOSIT"
  | "OUTSTANDING_GIRO"
  | "EMPLOYEE_RECEIVABLE"
  | "STORE_MANAGER_RECEIVABLE"
  | "DOUBTFUL_ALLOWANCE"
  // buying — the client keeps merchandise and non-merchandise payable apart,
  // on 2012001001 and 2012001003, so the roles are apart too
  | "VENDOR_PAYABLE"
  | "UTILITY_EXPENSE"
  | "ADVANCE"
  // tax, both sides of it
  | "TAX_PAYABLE"
  | "PREPAID_TAX"
  // financing
  | "BANK_LOAN"
  | "LOAN_CURRENT"
  | "INTEREST_EXPENSE"
  | "PAID_IN_CAPITAL"
  | "DRAWINGS"
  // long-lived costs that are not yet, or never were, a fixed asset
  | "CIP"
  | "PRE_OPENING"
  | "ACCUM_AMORTISATION"
  | "AMORTISATION_EXPENSE"
  // stock that leaves without a sale
  | "INVENTORY_LOSS"
  | "DISPOSED_INVENTORY"
  // the fourth affiliate family, 2012304, named after a unit like the rest
  | "AFFILIATE_OTHER_PAYABLE"

/// The dimensions a binding may be narrowed by. Typed, and the same key on
/// both sides.
///
/// The third resolver fix. v0.1 let a rule select on `SALARY` while the
/// binding was filed under `GAJI_PEGAWAI`, so the two never met and the failure
/// was an empty resolve at run time. Here a rule and a binding are narrowed by
/// the SAME record shape, so a mismatch is a type error rather than a silent
/// miss.
export interface Dimensions {
  readonly unit_id: string
  /// Which registered bank account. Required exactly when the role is `BANK`.
  readonly bank_account_id?: string
  /// The client's own asset family — `FFE_TOKO`, `FFE_KOMPUTER`, `OE_RAK_1`.
  readonly asset_class?: string
  /// The other unit, for an interunit leg.
  readonly counterparty_unit_id?: string
  /// Which tax. `PPH_21`, `PPH_23`, `VAT_OUT`, `PPH_25`, `PBB` — the client's
  /// own five, because `2012101` is five accounts and a payment names one.
  readonly tax_kind?: string
  /// Which card scheme took the money.
  readonly acquirer?: string
  /// Which expense. Closed set, not free text — see `EXPENSE_KINDS`.
  readonly expense_kind?: string
}

/// One row of the account map: this role, narrowed this far, is this account.
///
/// Carries validity and a version, which is the fourth resolver fix. A binding
/// with no dates cannot be corrected without rewriting history, and a reversal
/// that re-resolves would then post somewhere the original never touched.
export interface Binding {
  readonly binding_id: string
  readonly role: AccountRole
  /// Every dimension named here must match the request. A binding that names
  /// none is the unit-wide default; two bindings that both match is an error,
  /// never a preference.
  readonly narrows: Partial<Omit<Dimensions, "unit_id">> & { unit_id: string }
  readonly account_code: string
  readonly valid_from: Day
  readonly valid_to?: Day
  readonly version: number
  readonly set_by: string
  readonly note?: string
}

/// What a resolve produced, or why it could not.
///
/// Three outcomes and not two. "No binding" and "two bindings" are different
/// faults with different fixes, and a resolver that returned null for both
/// sends somebody to the wrong screen.
export type Resolution =
  | { readonly ok: true; readonly account: Account; readonly binding: Binding }
  | {
      readonly ok: false
      readonly reason: "MISSING" | "AMBIGUOUS" | "BLOCKED" | "NOT_POSTABLE"
      readonly message: string
      readonly candidates?: readonly Binding[]
    }

// ---------------------------------------------------------------------------
// Evidence, readiness, activation
// ---------------------------------------------------------------------------

/// What an accounting claim rests on, most authoritative first.
export type Evidence =
  /// A journal the client actually posted. Carries the document number.
  | {
      readonly kind: "ACTUAL_JOURNAL"
      readonly document: string
      readonly note: string
    }
  /// Someone at the client said so, in as many words.
  | { readonly kind: "CLIENT_STATEMENT"; readonly note: string }
  /// The chart has accounts that would fit. This is the weakest kind and on
  /// its own it never justifies posting — it is exactly how a replacement
  /// reserve gets accrued monthly because `1021607` exists.
  | { readonly kind: "COA_ONLY"; readonly note: string }
  /// Ours. A design we propose and have not had confirmed.
  | { readonly kind: "PROPOSAL"; readonly note: string }

export type Readiness = "DRAFT" | "VALIDATED" | "TESTED"

/// Whether a rule package may run, and where.
export interface Activation {
  readonly enabled: boolean
  /// Empty means "no book", which is what a disabled package has.
  readonly books: readonly string[]
  readonly units: readonly string[]
  readonly effective_from?: Day
  readonly effective_to?: Day
  /// Why it is off, shown to the person who wonders why nothing posted.
  readonly blocked_reason?: string
}

// ---------------------------------------------------------------------------
// Events and rules
// ---------------------------------------------------------------------------

export type PostingMode = "AUTO" | "ACTION" | "SCHEDULE" | "MANUAL"

/// A business event. The engine never takes a journal; it takes one of these.
export interface BusinessEvent {
  readonly event_id: string
  readonly type: string
  readonly book_id: string
  readonly unit_id: string
  readonly dates: EventDates
  /// The document a person would ask for: `C006-BKK-26-07-00046`.
  readonly document_ref: string
  /// The typed payload the rule package reads. Deliberately `unknown` at this
  /// level — each package declares its own shape and narrows.
  readonly payload: Readonly<Record<string, unknown>>
  /// What makes a retry a no-op. Posting is keyed on this, so pressing Pay
  /// twice produces one entry and one warning, never two entries.
  readonly idempotency_key: string
}

/// One side of one line a rule wants posted.
export interface RuleLine {
  readonly seq: number
  /// Lines that are ALTERNATIVES to one another, never both. The money side of
  /// a payment is one line whose role depends on where the money left from, and
  /// a funding receipt credits either the principal or the financing account
  /// but never the two. Without this the contract has to list them as separate
  /// lines and then say "not both" in prose, which no check can read — and a
  /// balancing line in each alternative looks like two balancing lines.
  readonly alt_group?: string
  readonly side: "DEBIT" | "CREDIT"
  readonly role: AccountRole
  /// Which dimensions this line reads off the event, by name. A structured
  /// selector rather than a sentence: v0.1 had `"expense_type from payment"`,
  /// which no validator can check.
  readonly narrow_by: readonly (keyof Dimensions)[]
  /// Where the amount comes from. A named basis, never an expression string.
  readonly basis: AmountBasis
  readonly memo?: string
}

/// The amount bases a rule may use. Closed, because "run this string as code"
/// is what §5 explicitly forbids.
export type AmountBasis =
  | { readonly kind: "FIELD"; readonly field: string }
  /// Sum of a repeated group — allocation lines, tender lines, asset cost
  /// components.
  | { readonly kind: "SUM"; readonly group: string; readonly field: string }
  /// One line per member of a repeated group. Produces N lines, not one.
  | { readonly kind: "PER"; readonly group: string; readonly field: string }
  /// The residual that makes the entry balance. At most one per rule, checked.
  | { readonly kind: "BALANCING" }

/// A package of rules, activated as a whole.
///
/// Activation is per package and never per line, which is §5's requirement:
/// half a rule is an entry that balances and means nothing.
export interface RulePackage {
  readonly package_id: string
  readonly version: string
  readonly event_type: string
  readonly title: string
  readonly mode: PostingMode
  readonly lines: readonly RuleLine[]
  readonly evidence: Evidence
  readonly readiness: Readiness
  readonly activation: Activation
  /// The `source_kind` the entry is filed under, matching the backend's own
  /// vocabulary so a rule ported across keeps its filing.
  readonly source_kind: string
  /// What the package refuses to guess, shown on the rule screen.
  readonly caveats?: readonly string[]
}

// ---------------------------------------------------------------------------
// The journal
// ---------------------------------------------------------------------------

export interface JournalLine {
  readonly line_no: number
  readonly account_code: string
  readonly account_name: string
  readonly unit_id: string
  readonly debit: Minor
  readonly credit: Minor
  readonly memo?: string
  readonly role?: AccountRole
  readonly binding_id?: string
}

export interface JournalEntry {
  readonly entry_id: string
  readonly entry_number: string
  readonly book_id: string
  readonly dates: EventDates
  readonly source_kind: string
  readonly source_id: string
  readonly document_ref: string
  /// `package@version`. What identifies the entries an old rule produced.
  readonly rule_version: string
  readonly total: Minor
  readonly memo?: string
  readonly lines: readonly JournalLine[]
  readonly posted_by: string
  readonly posted_at: string
  /// Set on the entry that undoes another.
  readonly reverses?: string
  /// True on every entry this engine writes. A screen that cannot tell a
  /// simulated posting from a real one is a screen that will be screenshotted
  /// into a meeting.
  readonly simulated: true
}

export type PostOutcome =
  | {
      readonly ok: true
      readonly entry: JournalEntry
      readonly replayed?: boolean
    }
  | {
      readonly ok: false
      readonly code: PostRefusal
      readonly message: string
      readonly detail?: readonly string[]
    }

export type PostRefusal =
  | "RULE_NOT_ACTIVE"
  | "RULE_NOT_FOUND"
  | "UNBALANCED"
  | "PERIOD_CLOSED"
  | "PERIOD_MISSING"
  | "ACCOUNT_UNRESOLVED"
  | "ACCOUNT_BLOCKED"
  | "NOT_AUTHORISED"
  | "BAD_PAYLOAD"

// ---------------------------------------------------------------------------
// Open items and payments
// ---------------------------------------------------------------------------

/// Anything that can be settled: a payable, an accrual, an advance, an
/// interunit balance. One shape, because a payment settles them the same way
/// and two shapes would mean two allocators.
export interface OpenItem {
  readonly item_id: string
  readonly kind: "PAYABLE" | "ACCRUAL" | "ADVANCE" | "INTERUNIT" | "RECEIVABLE"
  readonly book_id: string
  readonly unit_id: string
  readonly role: AccountRole
  readonly narrows: Partial<Omit<Dimensions, "unit_id">>
  readonly counterparty: string
  readonly description: string
  readonly opened_on: Day
  readonly due_on?: Day
  readonly original: Minor
  readonly source_ref: string
}

/// The lifecycle §5 asks for. Clicking Pay does not mean the bank moved.
export type PaymentStatus =
  | "REQUESTED"
  | "APPROVED"
  | "INSTRUCTED"
  | "SETTLED"
  | "FAILED"
  | "CANCELLED"
  | "RECONCILED"

/// One thing a payment answered. Either an existing obligation, or a cost
/// being incurred and paid in the same breath — the client's BKK does both in
/// one document and a model that forced everything through an open item would
/// have to invent a payable for a parking fee.
export type AllocationTarget =
  | { readonly kind: "OPEN_ITEM"; readonly item_id: string }
  | {
      readonly kind: "DIRECT_EXPENSE"
      readonly role: AccountRole
      readonly narrows: Partial<Omit<Dimensions, "unit_id">>
      readonly description: string
    }

export interface Allocation {
  readonly target: AllocationTarget
  readonly amount: Minor
}

export interface Payment {
  readonly payment_id: string
  readonly payment_number: string
  readonly book_id: string
  readonly unit_id: string
  readonly direction: "OUT" | "IN"
  readonly dates: EventDates
  readonly counterparty: string
  /// Where the money left from or arrived into.
  readonly source: PaymentSource
  readonly allocations: readonly Allocation[]
  readonly total: Minor
  readonly status: PaymentStatus
  /// Set once posted. A payment can exist without one — a request nobody
  /// approved is still a record.
  readonly entry_id?: string
  readonly failure_reason?: string
  readonly history: readonly PaymentEvent[]
  /// Which action produced it, so the same payment can appear under Cash &
  /// Bank and under Accruals as ONE record rather than two.
  readonly action: PaymentAction
}

export interface PaymentEvent {
  readonly at: string
  readonly status: PaymentStatus
  readonly actor: string
  readonly note?: string
}

export type PaymentSource =
  | { readonly kind: "CASH" }
  | { readonly kind: "PETTY_CASH" }
  | { readonly kind: "BANK"; readonly bank_account_id: string }

/// The verbs §7 asks for. "Buat BKK" is not one of them: the document is
/// produced by the action, it is not the action.
export type PaymentAction =
  | "PAY_PROCUREMENT"
  | "PAY_BILL"
  | "PAY_OE_REPLACEMENT"
  | "PAY_PAYROLL"
  | "RECEIVE_FUNDS"
  | "RECORD_EXPENSE"
  | "DEPOSIT_TAKINGS"

// ---------------------------------------------------------------------------
// Periods
// ---------------------------------------------------------------------------

export interface Period {
  readonly period: Month
  readonly book_id: string
  readonly status: "OPEN" | "CLOSED"
  readonly closed_by?: string
  readonly closed_at?: string
}

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------

/// What GA knows. Carries no money at all — that separation is the whole
/// GA/Finance division, and it is the same one `fixed_asset` makes in the
/// production schema.
export interface AssetFact {
  readonly asset_id: string
  readonly asset_number: string
  readonly name: string
  readonly unit_id: string
  readonly asset_class: string
  readonly quantity: number
  /// The date on the document. Kept even when the module files the addition at
  /// the start of a month — §4 asks for both and they are different facts.
  readonly document_on: Day
  /// Where the asset module files it. Since June 2026 the client uses the
  /// first of the month.
  readonly register_on: Day
  readonly location: string
  readonly custodian: string
  readonly condition: "NEW" | "GOOD" | "WORN" | "BROKEN"
  readonly serial?: string
  readonly photo_count: number
  readonly status:
    "PROPOSED" | "RECEIVED" | "INSTALLED" | "IN_SERVICE" | "DISPOSED"
  readonly notes?: string
}

/// What Finance decided. Absent means nobody has assessed it, which is a real
/// state and an open control gap.
export interface AssetTreatment {
  readonly asset_id: string
  readonly decision: "CAPITALISE" | "EXPENSE"
  readonly book_id: string
  readonly cost: Minor
  readonly salvage: Minor
  readonly life_months: number
  readonly method: "STRAIGHT_LINE" | "DECLINING" | "NONE"
  /// What the monthly charge is CALLED, which decides the pair of accounts.
  /// `NONE` is how operating equipment is treated here until the client
  /// confirms a reserve rate — see the argument in `rules.ts`.
  readonly charge:
    "DEPRECIATION" | "AMORTISATION" | "REPLACEMENT_RESERVE" | "NONE"
  readonly in_service_on: Day
  readonly assessed_by: string
  readonly reason: string
}

/// One payment line that helped buy one asset. Several may name the same
/// asset: the client pays for a unit and its installation separately and
/// capitalises both.
export interface AssetCostComponent {
  readonly component_id: string
  readonly asset_id: string
  readonly kind: "UNIT" | "INSTALLATION" | "FREIGHT" | "ADVANCE"
  readonly amount: Minor
  readonly document_ref: string
  readonly paid_on: Day
  /// The journal entry that already put this in the books, when one did.
  /// Present means recognition happened at PAYMENT and completing the register
  /// must not post a second acquisition entry.
  readonly entry_id?: string
}

export interface DepreciationCharge {
  readonly asset_id: string
  readonly period: Month
  readonly amount: Minor
  readonly asset_class: string
  readonly unit_id: string
  readonly skipped?: DepreciationSkip
}

export type DepreciationSkip =
  | "FULLY_DEPRECIATED"
  | "NOT_IN_SERVICE"
  | "NOT_CAPITALISED"
  | "NO_MONTHLY_CHARGE"
  | "DISPOSED"
