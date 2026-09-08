/// The posting rules, each one carrying its evidence, its readiness and its
/// activation — three facts the old matrix kept as one.
///
/// # Reading a package
///
/// `lines` is the CONTRACT: which roles, which side, which dimensions, which
/// amount basis. `build` is the IMPLEMENTATION: it reads a typed payload and
/// emits the lines. They are checked against each other by
/// [`conformance`] — a builder that emits a role its own declaration never
/// named is a rule that drifted, and that is exactly how a rule ends up
/// posting somewhere its documentation says it does not.
///
/// # Why activation is per package
///
/// Half a rule balances. A sale rule with revenue enabled and cost of goods
/// disabled produces entries that pass every check in `poster.ts` and leave
/// inventory permanently overstated, and no report says so. So a package is on
/// or off, whole.
///
/// # The rules that are deliberately OFF
///
/// Three of them, and each refusal is the point of writing it down:
///
///   * `OE_RESERVE_ACCRUED` — evidence is `COA_ONLY`. The chart carries
///     `1021607* Reserve Replacement` and `7010215* Biaya Replacement` for
///     thirty-six classes. C006's July journal posts to NEITHER, in a month
///     where its register holds fifteen operating-equipment rows worth about
///     Rp190 million. Accounts existing is not a rule.
///   * `CARD_CLEARING_AT_CHECKOUT` — a proposed policy change, not current
///     practice. The client banks card sales directly and reclasses the
///     uncleared part to `Piutang Debit Card` at the period end
///     (`C006-GL-26-07-00003`). Modernising is a decision somebody makes, not
///     something a prototype does quietly.
///   * `GOODS_RECEIVED` — the entry that would clear BDP. July shows
///     Rp470,488,453.26 of BDP debits across 147 dispatches and not one
///     credit. Until the receipt journal is in hand the rule is a guess, so it
///     is declared, shown, and refused.

import type {
  AccountRole,
  Dimensions,
  Evidence,
  Minor,
  RulePackage,
} from "./types"
import type { IntentLine } from "./ledger"

// ---------------------------------------------------------------------------
// Payload shapes
// ---------------------------------------------------------------------------

export interface TenderLine {
  readonly method: "CASH" | "CARD"
  readonly acquirer?: string
  readonly amount: Minor
}

export interface SalePayload {
  readonly unit_id: string
  /// After discount. The engine posts revenue NET, and the reason is written
  /// down in the package's caveats.
  readonly net_revenue: Minor
  readonly discount: Minor
  readonly cost_of_goods: Minor
  readonly tenders: readonly TenderLine[]
  /// Which bank account a card tender lands in, per acquirer.
  readonly card_bank: Readonly<Record<string, string>>
  readonly return_revenue?: Minor
  readonly return_cost?: Minor
}

export interface DispatchPayload {
  readonly unit_id: string
  readonly from_unit_id: string
  readonly amount: Minor
}

export interface DepositPayload {
  readonly unit_id: string
  readonly to_unit_id: string
  readonly amount: Minor
  readonly from: "CASH_ON_HAND" | "PETTY_CASH"
}

export interface PayrollAccrualPayload {
  readonly unit_id: string
  readonly salary: Minor
  readonly benefits: Minor
  readonly outside_help: Minor
}

export interface FundingPayload {
  readonly unit_id: string
  readonly from_unit_id: string
  readonly amount: Minor
  /// The P0 question v0.1 raised and this engine refuses to guess. An event
  /// that does not say is refused rather than defaulted.
  readonly funding_type: "AFFILIATE_FINANCING" | "PRINCIPAL_REIMBURSEMENT"
  readonly into: "PETTY_CASH" | "CASH_ON_HAND" | "BANK"
  readonly bank_account_id?: string
}

export interface AssetAcquisitionPayload {
  readonly unit_id: string
  readonly asset_class: string
  readonly amount: Minor
  readonly source: { readonly kind: "BANK"; readonly bank_account_id: string } | { readonly kind: "PETTY_CASH" }
  /// A bank charge in the same document is NOT part of the asset. The client's
  /// own BKK carries one and the split cannot be inferred from the total.
  readonly bank_charge?: Minor
}

export interface DepreciationPayload {
  readonly unit_id: string
  readonly charges: readonly { readonly asset_class: string; readonly amount: Minor }[]
}

export interface ReplacementPayload {
  readonly unit_id: string
  readonly asset_class: string
  readonly amount: Minor
  readonly source: { readonly kind: "BANK"; readonly bank_account_id: string } | { readonly kind: "PETTY_CASH" }
}

export interface CardReclassPayload {
  readonly unit_id: string
  readonly acquirer: string
  readonly bank_account_id: string
  readonly amount: Minor
}

export interface CardSettlementPayload {
  readonly unit_id: string
  readonly acquirer: string
  readonly bank_account_id: string
  readonly gross: Minor
  readonly fee: Minor
}

export interface PrepaidPayload {
  readonly unit_id: string
  readonly amount: Minor
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const D = (role: AccountRole, dims: Dimensions, amount: Minor, memo?: string): IntentLine => ({
  side: "DEBIT",
  role,
  dims,
  amount,
  memo,
})
const C = (role: AccountRole, dims: Dimensions, amount: Minor, memo?: string): IntentLine => ({
  side: "CREDIT",
  role,
  dims,
  amount,
  memo,
})

const journal = (document: string, note: string): Evidence => ({
  kind: "ACTUAL_JOURNAL",
  document,
  note,
})

function on(books: string[], units: string[], from = "2026-01-01") {
  return { enabled: true, books, units, effective_from: from }
}
function off(reason: string) {
  return { enabled: false, books: [], units: [], blocked_reason: reason }
}

const ALL_UNITS = ["HO", "C004", "C006"]
const BOOK = ["CFS"]

// ---------------------------------------------------------------------------
// The packages
// ---------------------------------------------------------------------------

/// A package plus the function that builds its lines.
export interface Rule<P> {
  readonly pkg: RulePackage
  readonly build: (p: P) => readonly IntentLine[]
}

export const SALE: Rule<SalePayload> = {
  pkg: {
    package_id: "retail_sale",
    version: "2",
    event_type: "SALE_COMPLETED",
    title: "A sale, however it was tendered",
    mode: "AUTO",
    source_kind: "SALE_DAY",
    evidence: journal(
      "1,958 Penjualan Cash documents, C006 July 2026",
      "1,648 pure cash, 290 pure BCA debit, 2 split cash+card, 3 with a return. " +
        "Every one of them debits Harga Pokok Pembelian and credits Persediaan exactly once."
    ),
    readiness: "TESTED",
    activation: on(BOOK, ALL_UNITS),
    lines: [
      { seq: 1, side: "DEBIT", role: "CASH_ON_HAND", narrow_by: ["unit_id"], basis: { kind: "PER", group: "tenders", field: "amount" }, memo: "cash tender" },
      { seq: 2, side: "DEBIT", role: "BANK", narrow_by: ["unit_id", "bank_account_id"], basis: { kind: "PER", group: "tenders", field: "amount" }, memo: "card tender, banked" },
      { seq: 3, side: "CREDIT", role: "SALES_REVENUE_CASH", narrow_by: ["unit_id"], basis: { kind: "FIELD", field: "net_revenue" } },
      { seq: 4, side: "CREDIT", role: "SALES_REVENUE_CARD", narrow_by: ["unit_id", "acquirer"], basis: { kind: "PER", group: "tenders", field: "amount" } },
      { seq: 5, side: "DEBIT", role: "COGS", narrow_by: ["unit_id"], basis: { kind: "FIELD", field: "cost_of_goods" } },
      { seq: 6, side: "CREDIT", role: "INVENTORY", narrow_by: ["unit_id"], basis: { kind: "FIELD", field: "cost_of_goods" } },
      { seq: 7, side: "DEBIT", role: "SALES_RETURN", narrow_by: ["unit_id"], basis: { kind: "FIELD", field: "return_revenue" } },
      { seq: 8, side: "CREDIT", role: "CASH_ON_HAND", narrow_by: ["unit_id"], basis: { kind: "FIELD", field: "return_revenue" }, memo: "refund" },
      { seq: 9, side: "DEBIT", role: "INVENTORY", narrow_by: ["unit_id"], basis: { kind: "FIELD", field: "return_cost" } },
      { seq: 10, side: "CREDIT", role: "COGS", narrow_by: ["unit_id"], basis: { kind: "FIELD", field: "return_cost" } },
    ],
    caveats: [
      "Revenue is posted NET of discount and the discount never appears as a line. " +
        "The client's own sale documents carry no discount account, so a gross-plus-contra " +
        "shape would invent one — and posting both a gross revenue and a discount contra " +
        "is how the same reduction gets taken off twice.",
      "Cost of goods is ONE pair of lines per sale, computed from the sale, never from the " +
        "tenders. A per-tender cost is the defect this rule exists to make impossible.",
      "A card tender is banked directly, because that is what the client does. The clearing-" +
        "receivable model is a separate package and it is off.",
    ],
  },
  build: (p) => {
    const lines: IntentLine[] = []
    let cardTotal = 0
    for (const t of p.tenders) {
      if (t.method === "CASH") {
        lines.push(D("CASH_ON_HAND", { unit_id: p.unit_id }, t.amount, "cash tender"))
      } else {
        const acquirer = t.acquirer ?? "BCA_DEBIT"
        const bank = p.card_bank[acquirer]
        lines.push(
          D("BANK", { unit_id: p.unit_id, bank_account_id: bank }, t.amount, `${acquirer} tender`)
        )
        lines.push(C("SALES_REVENUE_CARD", { unit_id: p.unit_id, acquirer }, t.amount))
        cardTotal += t.amount
      }
    }
    // The cash half of revenue is what the tenders did not cover by card. One
    // subtraction, and it is here rather than in the payload so a sale cannot
    // declare a revenue split that disagrees with how it was paid.
    const cashRevenue = p.net_revenue - cardTotal
    if (cashRevenue > 0) {
      lines.push(C("SALES_REVENUE_CASH", { unit_id: p.unit_id }, cashRevenue))
    }
    // Once. Not per tender.
    if (p.cost_of_goods > 0) {
      lines.push(D("COGS", { unit_id: p.unit_id }, p.cost_of_goods))
      lines.push(C("INVENTORY", { unit_id: p.unit_id }, p.cost_of_goods))
    }
    if (p.return_revenue) {
      lines.push(D("SALES_RETURN", { unit_id: p.unit_id }, p.return_revenue))
      lines.push(C("CASH_ON_HAND", { unit_id: p.unit_id }, p.return_revenue, "refund"))
    }
    if (p.return_cost) {
      lines.push(D("INVENTORY", { unit_id: p.unit_id }, p.return_cost, "goods back on the shelf"))
      lines.push(C("COGS", { unit_id: p.unit_id }, p.return_cost))
    }
    return lines
  },
}

export const DISPATCH: Rule<DispatchPayload> = {
  pkg: {
    package_id: "interunit_dispatch",
    version: "1",
    event_type: "GOODS_DISPATCHED",
    title: "Head office sends stock to a shop (Surat Jalan Distribusi)",
    mode: "AUTO",
    source_kind: "TRANSFER",
    evidence: journal(
      "147 Surat Jalan Distribusi, C006 July 2026",
      "Every one: Dr BDP Barang Dagangan WIRAMODE - C006 / Cr Hutang Affiliasi Atas Barang " +
        "HEAD OFFICE - C006. Rp470,488,453.26 of debits in the month."
    ),
    readiness: "TESTED",
    activation: on(BOOK, ALL_UNITS),
    lines: [
      { seq: 1, side: "DEBIT", role: "GOODS_IN_TRANSIT", narrow_by: ["unit_id", "counterparty_unit_id"], basis: { kind: "FIELD", field: "amount" } },
      { seq: 2, side: "CREDIT", role: "AFFILIATE_GOODS_PAYABLE", narrow_by: ["unit_id", "counterparty_unit_id"], basis: { kind: "FIELD", field: "amount" } },
    ],
    caveats: [
      "The GOODS payable, not the financing one. The client keeps three affiliate families " +
        "and they are not interchangeable.",
      "Head office's mirror leg is not posted here: this fixture holds the shop's book only, " +
        "and the HO journal has not been supplied.",
    ],
  },
  build: (p) => [
    D("GOODS_IN_TRANSIT", { unit_id: p.unit_id, counterparty_unit_id: p.from_unit_id }, p.amount),
    C("AFFILIATE_GOODS_PAYABLE", { unit_id: p.unit_id, counterparty_unit_id: p.from_unit_id }, p.amount),
  ],
}

export const RECEIPT: Rule<DispatchPayload> = {
  pkg: {
    package_id: "interunit_receipt",
    version: "0",
    event_type: "GOODS_RECEIVED",
    title: "The shop receives the stock and BDP clears",
    mode: "AUTO",
    source_kind: "TRANSFER",
    evidence: {
      kind: "PROPOSAL",
      note:
        "No receipt journal has been supplied. July shows 147 BDP debits and zero credits, " +
        "while sales credit Persediaan — so something moves BDP into inventory and nobody has " +
        "shown us what. Two shapes are plausible and they are not equivalent: BDP → Persediaan " +
        "at receipt, or BDP → Persediaan at sale. The balances differ by whatever is on the " +
        "shelf, which is the whole point of an inventory account.",
    },
    readiness: "DRAFT",
    activation: off("Waiting on the receipt-side journal. Asked for as P0 in the revised matrix."),
    lines: [
      { seq: 1, side: "DEBIT", role: "INVENTORY", narrow_by: ["unit_id"], basis: { kind: "FIELD", field: "amount" } },
      { seq: 2, side: "CREDIT", role: "GOODS_IN_TRANSIT", narrow_by: ["unit_id", "counterparty_unit_id"], basis: { kind: "FIELD", field: "amount" } },
    ],
  },
  build: (p) => [
    D("INVENTORY", { unit_id: p.unit_id }, p.amount),
    C("GOODS_IN_TRANSIT", { unit_id: p.unit_id, counterparty_unit_id: p.from_unit_id }, p.amount),
  ],
}

export const DEPOSIT: Rule<DepositPayload> = {
  pkg: {
    package_id: "takings_deposit",
    version: "1",
    event_type: "TAKINGS_DEPOSITED",
    title: "The shop banks its takings to head office",
    mode: "ACTION",
    source_kind: "PAYMENT",
    evidence: journal(
      "C006-BKK-26-07-00001 and 22 more, July 2026",
      "Dr Hutang Affiliasi Atas Barang HEAD OFFICE - C006 / Cr Cash on Hand C006. " +
        "The takings do not leave as revenue; they pay down what the shop owes for goods."
    ),
    readiness: "TESTED",
    activation: on(BOOK, ALL_UNITS),
    lines: [
      { seq: 1, side: "DEBIT", role: "AFFILIATE_GOODS_PAYABLE", narrow_by: ["unit_id", "counterparty_unit_id"], basis: { kind: "FIELD", field: "amount" } },
      { seq: 2, side: "CREDIT", role: "CASH_ON_HAND", narrow_by: ["unit_id"], basis: { kind: "FIELD", field: "amount" }, alt_group: "money" },
      { seq: 3, side: "CREDIT", role: "PETTY_CASH", narrow_by: ["unit_id"], basis: { kind: "FIELD", field: "amount" }, alt_group: "money" },
    ],
  },
  build: (p) => [
    D("AFFILIATE_GOODS_PAYABLE", { unit_id: p.unit_id, counterparty_unit_id: p.to_unit_id }, p.amount),
    p.from === "CASH_ON_HAND"
      ? C("CASH_ON_HAND", { unit_id: p.unit_id }, p.amount)
      : C("PETTY_CASH", { unit_id: p.unit_id }, p.amount),
  ],
}

export const PAYROLL_ACCRUAL: Rule<PayrollAccrualPayload> = {
  pkg: {
    package_id: "payroll_accrual",
    version: "1",
    event_type: "PAYROLL_RECOGNISED",
    title: "The month's payroll becomes a cost and a liability",
    mode: "SCHEDULE",
    source_kind: "MANUAL",
    evidence: journal(
      "C006-GL-26-07-00004, 31 July 2026",
      "Dr Biaya Gaji Karyawan 57,250,000 + Biaya Asuransi/BPJS 3,163,228 / " +
        "Cr Biaya Gaji dan Upah YMHD 57,250,000 + Biaya Asuransi dan BPJS YMHD 3,163,228. " +
        "Two separate YMHD accounts, which is why this rule has two credit lines and not one."
    ),
    readiness: "TESTED",
    activation: on(BOOK, ALL_UNITS),
    lines: [
      { seq: 1, side: "DEBIT", role: "SALARY_EXPENSE", narrow_by: ["unit_id"], basis: { kind: "FIELD", field: "salary" } },
      { seq: 2, side: "DEBIT", role: "BENEFIT_EXPENSE", narrow_by: ["unit_id"], basis: { kind: "FIELD", field: "benefits" } },
      { seq: 3, side: "CREDIT", role: "SALARY_ACCRUAL", narrow_by: ["unit_id"], basis: { kind: "FIELD", field: "salary" } },
      { seq: 4, side: "CREDIT", role: "BENEFIT_ACCRUAL", narrow_by: ["unit_id"], basis: { kind: "FIELD", field: "benefits" } },
    ],
    caveats: [
      "Salary and benefits are separate liabilities and must stay separate lines: one " +
        "settles to the staff and the other to BPJS, on different days, and a single lumped " +
        "accrual cannot be allocated against.",
      "Outside help (GAJI PETUGAS LUAR) is NOT accrued — the client pays it in the same " +
        "document and codes it straight to Biaya Rumah Tangga. It is a direct expense on the " +
        "payment, not a payroll liability.",
      "The client accrues, funds and pays on the same day (31 July). Nothing in this package " +
        "assumes the first of the month.",
    ],
  },
  build: (p) => {
    const lines: IntentLine[] = []
    if (p.salary > 0) {
      lines.push(D("SALARY_EXPENSE", { unit_id: p.unit_id }, p.salary))
      lines.push(C("SALARY_ACCRUAL", { unit_id: p.unit_id }, p.salary))
    }
    if (p.benefits > 0) {
      lines.push(D("BENEFIT_EXPENSE", { unit_id: p.unit_id }, p.benefits))
      lines.push(C("BENEFIT_ACCRUAL", { unit_id: p.unit_id }, p.benefits))
    }
    return lines
  },
}

export const FUNDING: Rule<FundingPayload> = {
  pkg: {
    package_id: "interunit_funding",
    version: "1",
    event_type: "FUNDS_RECEIVED",
    title: "Head office sends a unit money",
    mode: "ACTION",
    source_kind: "PAYMENT",
    evidence: journal(
      "C006-BKM-26-07-00003, 31 July 2026",
      "Dr PETTY CASH C006 61,913,500 / Cr Hutang Lain-lain Principal HEAD OFFICE - C006. " +
        "Payroll money arrives against PRINCIPAL, not against the financing account — which " +
        "is why funding_type is a required field and never inferred."
    ),
    readiness: "VALIDATED",
    activation: on(BOOK, ALL_UNITS),
    lines: [
      { seq: 1, side: "DEBIT", role: "PETTY_CASH", narrow_by: ["unit_id"], basis: { kind: "FIELD", field: "amount" }, alt_group: "into" },
      { seq: 2, side: "CREDIT", role: "PRINCIPAL_PAYABLE", narrow_by: ["unit_id", "counterparty_unit_id"], basis: { kind: "FIELD", field: "amount" }, alt_group: "owed" },
      { seq: 3, side: "CREDIT", role: "AFFILIATE_FINANCING_PAYABLE", narrow_by: ["unit_id", "counterparty_unit_id"], basis: { kind: "FIELD", field: "amount" }, alt_group: "owed" },
      { seq: 4, side: "DEBIT", role: "BANK", narrow_by: ["unit_id", "bank_account_id"], basis: { kind: "FIELD", field: "amount" }, alt_group: "into" },
      { seq: 5, side: "DEBIT", role: "CASH_ON_HAND", narrow_by: ["unit_id"], basis: { kind: "FIELD", field: "amount" }, alt_group: "into" },
    ],
    caveats: [
      "Lines 2 and 3 are alternatives chosen by funding_type, never both. What SELECTS " +
        "between financing and principal is still an open policy question — the engine refuses " +
        "an event that does not say rather than defaulting to one of them.",
    ],
  },
  build: (p) => {
    const into: IntentLine =
      p.into === "BANK"
        ? D("BANK", { unit_id: p.unit_id, bank_account_id: p.bank_account_id }, p.amount)
        : p.into === "PETTY_CASH"
          ? D("PETTY_CASH", { unit_id: p.unit_id }, p.amount)
          : D("CASH_ON_HAND", { unit_id: p.unit_id }, p.amount)
    const owed: AccountRole =
      p.funding_type === "PRINCIPAL_REIMBURSEMENT" ? "PRINCIPAL_PAYABLE" : "AFFILIATE_FINANCING_PAYABLE"
    return [
      into,
      C(owed, { unit_id: p.unit_id, counterparty_unit_id: p.from_unit_id }, p.amount),
    ]
  },
}

export const ASSET_ACQUISITION: Rule<AssetAcquisitionPayload> = {
  pkg: {
    package_id: "asset_acquisition",
    version: "1",
    event_type: "ASSET_ACQUIRED",
    title: "An asset is bought and paid for",
    mode: "ACTION",
    source_kind: "PAYMENT",
    evidence: journal(
      "KK-26-07-00276, 27 July 2026",
      "Dr FFE Office C006 348,276 / Cr Cash In Bank Tabungan Bank BCA C006. " +
        "The acquisition IS the payment document — there is no separate capitalisation entry, " +
        "which is why registering the asset afterwards must not post a second one."
    ),
    readiness: "TESTED",
    activation: on(BOOK, ALL_UNITS),
    lines: [
      { seq: 1, side: "DEBIT", role: "FIXED_ASSET", narrow_by: ["unit_id", "asset_class"], basis: { kind: "FIELD", field: "amount" } },
      { seq: 2, side: "DEBIT", role: "BANK_CHARGE", narrow_by: ["unit_id"], basis: { kind: "FIELD", field: "bank_charge" } },
      { seq: 3, side: "CREDIT", role: "BANK", narrow_by: ["unit_id", "bank_account_id"], basis: { kind: "BALANCING" }, alt_group: "money" },
      { seq: 4, side: "CREDIT", role: "PETTY_CASH", narrow_by: ["unit_id"], basis: { kind: "BALANCING" }, alt_group: "money" },
    ],
    caveats: [
      "A bank charge in the same document is NOT part of the asset. The client's air-" +
        "conditioner BKK carries Rp5,000 of ADM alongside Rp26,390,000 of asset cost, and the " +
        "split cannot be inferred from the document total.",
      "Installation billed separately IS part of the cost, and arrives as a second event " +
        "against the same asset. See ASSET_COST_ADDITION.",
    ],
  },
  build: (p) => {
    const lines: IntentLine[] = [
      D("FIXED_ASSET", { unit_id: p.unit_id, asset_class: p.asset_class }, p.amount),
    ]
    if (p.bank_charge) {
      lines.push(D("BANK_CHARGE", { unit_id: p.unit_id }, p.bank_charge))
    }
    const total = p.amount + (p.bank_charge ?? 0)
    lines.push(
      p.source.kind === "BANK"
        ? C("BANK", { unit_id: p.unit_id, bank_account_id: p.source.bank_account_id }, total)
        : C("PETTY_CASH", { unit_id: p.unit_id }, total)
    )
    return lines
  },
}

export const DEPRECIATION: Rule<DepreciationPayload> = {
  pkg: {
    package_id: "depreciation_run",
    version: "1",
    event_type: "DEPRECIATION_CHARGED",
    title: "The month's depreciation",
    mode: "SCHEDULE",
    source_kind: "DEPRECIATION",
    evidence: journal(
      "GL-26-07-00004, 31 July 2026",
      "Nine charge lines totalling Rp4,683,970 across four FFE classes at C006. " +
        "Every one reconciles to a row of the client's own MASTER ASSET register at cost ÷ life " +
        "in months, TRUNCATED, not rounded."
    ),
    readiness: "TESTED",
    activation: on(BOOK, ALL_UNITS),
    lines: [
      { seq: 1, side: "DEBIT", role: "DEPRECIATION_EXPENSE", narrow_by: ["unit_id", "asset_class"], basis: { kind: "PER", group: "charges", field: "amount" } },
      { seq: 2, side: "CREDIT", role: "ACCUM_DEPRECIATION", narrow_by: ["unit_id", "asset_class"], basis: { kind: "PER", group: "charges", field: "amount" } },
    ],
    caveats: [
      "One line per asset, not per class. The client's own entry carries nine lines for four " +
        "classes, so a run that summed by class would produce an entry their accountant cannot " +
        "tie back to a row of the register.",
      "Re-running a month is a no-op: the idempotency key is the book, the period and the run, " +
        "so the second press returns the first entry.",
    ],
  },
  build: (p) =>
    p.charges.flatMap((c) => [
      D("DEPRECIATION_EXPENSE", { unit_id: p.unit_id, asset_class: c.asset_class }, c.amount),
      C("ACCUM_DEPRECIATION", { unit_id: p.unit_id, asset_class: c.asset_class }, c.amount),
    ]),
}

export const OE_REPLACEMENT: Rule<ReplacementPayload> = {
  pkg: {
    package_id: "oe_replacement",
    version: "1",
    event_type: "OE_REPLACED",
    title: "Operating equipment is replaced",
    mode: "ACTION",
    source_kind: "PAYMENT",
    evidence: {
      kind: "CLIENT_STATEMENT",
      note:
        "The owner's instruction: a replacement purchase becomes replacement expense directly. " +
        "It does not add to the register, does not start a depreciation schedule, and does not " +
        "draw a reserve. The register's value for the original stays as it is.",
    },
    readiness: "VALIDATED",
    activation: on(BOOK, ALL_UNITS),
    lines: [
      { seq: 1, side: "DEBIT", role: "REPLACEMENT_EXPENSE", narrow_by: ["unit_id", "asset_class"], basis: { kind: "FIELD", field: "amount" } },
      { seq: 2, side: "CREDIT", role: "BANK", narrow_by: ["unit_id", "bank_account_id"], basis: { kind: "FIELD", field: "amount" }, alt_group: "money" },
      { seq: 3, side: "CREDIT", role: "PETTY_CASH", narrow_by: ["unit_id"], basis: { kind: "FIELD", field: "amount" }, alt_group: "money" },
    ],
    caveats: [
      "Not Dr REPLACEMENT_RESERVE. Drawing the reserve would be right only if the reserve had " +
        "been accrued, and it has not — see OE_RESERVE_ACCRUED, which is off.",
      "No asset row is created and no schedule starts. That is the point of the rule.",
    ],
  },
  build: (p) => [
    D("REPLACEMENT_EXPENSE", { unit_id: p.unit_id, asset_class: p.asset_class }, p.amount),
    p.source.kind === "BANK"
      ? C("BANK", { unit_id: p.unit_id, bank_account_id: p.source.bank_account_id }, p.amount)
      : C("PETTY_CASH", { unit_id: p.unit_id }, p.amount),
  ],
}

export const OE_RESERVE: Rule<DepreciationPayload> = {
  pkg: {
    package_id: "oe_reserve_accrual",
    version: "0",
    event_type: "OE_RESERVE_ACCRUED",
    title: "A monthly replacement reserve for operating equipment",
    mode: "SCHEDULE",
    source_kind: "DEPRECIATION",
    evidence: {
      kind: "COA_ONLY",
      note:
        "The only support is that 1021607* and 7010215* exist, 36 classes each. C006 posted " +
        "to neither in July 2026 while holding 15 operating-equipment rows worth about " +
        "Rp190 million. The owner's instruction says not to accrue one because the account is " +
        "there. Two independent designs in this repository assumed otherwise.",
    },
    readiness: "DRAFT",
    activation: off(
      "No evidence of a monthly accrual, and an explicit instruction not to invent one. " +
        "Needs: a rate, a basis, and one actual reserve journal."
    ),
    lines: [
      { seq: 1, side: "DEBIT", role: "REPLACEMENT_EXPENSE", narrow_by: ["unit_id", "asset_class"], basis: { kind: "PER", group: "charges", field: "amount" } },
      { seq: 2, side: "CREDIT", role: "REPLACEMENT_RESERVE", narrow_by: ["unit_id", "asset_class"], basis: { kind: "PER", group: "charges", field: "amount" } },
    ],
  },
  build: (p) =>
    p.charges.flatMap((c) => [
      D("REPLACEMENT_EXPENSE", { unit_id: p.unit_id, asset_class: c.asset_class }, c.amount),
      C("REPLACEMENT_RESERVE", { unit_id: p.unit_id, asset_class: c.asset_class }, c.amount),
    ]),
}

export const CARD_RECLASS: Rule<CardReclassPayload> = {
  pkg: {
    package_id: "card_reclass",
    version: "1",
    event_type: "CARD_UNCLEARED_RECLASSED",
    title: "Card takings not yet cleared move to a receivable",
    mode: "ACTION",
    source_kind: "MANUAL",
    evidence: journal(
      "C006-GL-26-07-00003, 31 July 2026",
      "Dr Piutang Debit Card C006 / Cr Cash In Bank Tabungan Bank BCA C006. " +
        "The bank was credited at checkout; at the period end the part that has not settled is " +
        "moved out again."
    ),
    readiness: "TESTED",
    activation: on(BOOK, ALL_UNITS),
    lines: [
      { seq: 1, side: "DEBIT", role: "CARD_RECEIVABLE", narrow_by: ["unit_id", "acquirer"], basis: { kind: "FIELD", field: "amount" } },
      { seq: 2, side: "CREDIT", role: "BANK", narrow_by: ["unit_id", "bank_account_id"], basis: { kind: "FIELD", field: "amount" } },
    ],
    caveats: [
      "This preserves current practice. It is the counterpart of a clearing model, not a " +
        "step towards one — the two are alternatives and only one may be active.",
    ],
  },
  build: (p) => [
    D("CARD_RECEIVABLE", { unit_id: p.unit_id, acquirer: p.acquirer }, p.amount),
    C("BANK", { unit_id: p.unit_id, bank_account_id: p.bank_account_id }, p.amount),
  ],
}

export const CARD_SETTLEMENT: Rule<CardSettlementPayload> = {
  pkg: {
    package_id: "card_settlement",
    version: "1",
    event_type: "CARD_SETTLED",
    title: "The acquirer pays, net of its fee",
    mode: "ACTION",
    source_kind: "PAYMENT",
    evidence: journal(
      "C006-BKM-26-07-00002, July 2026",
      "Dr Cash In Bank Tabungan Bank BCA + Dr Credit Card Expenses / Cr Piutang Debit Card."
    ),
    readiness: "TESTED",
    activation: on(BOOK, ALL_UNITS),
    lines: [
      { seq: 1, side: "DEBIT", role: "BANK", narrow_by: ["unit_id", "bank_account_id"], basis: { kind: "BALANCING" } },
      { seq: 2, side: "DEBIT", role: "CARD_FEE", narrow_by: ["unit_id"], basis: { kind: "FIELD", field: "fee" } },
      { seq: 3, side: "CREDIT", role: "CARD_RECEIVABLE", narrow_by: ["unit_id", "acquirer"], basis: { kind: "FIELD", field: "gross" } },
    ],
  },
  build: (p) => [
    D("BANK", { unit_id: p.unit_id, bank_account_id: p.bank_account_id }, p.gross - p.fee),
    ...(p.fee > 0 ? [D("CARD_FEE", { unit_id: p.unit_id }, p.fee)] : []),
    C("CARD_RECEIVABLE", { unit_id: p.unit_id, acquirer: p.acquirer }, p.gross),
  ],
}

export const CARD_CLEARING: Rule<SalePayload> = {
  pkg: {
    package_id: "card_clearing_at_checkout",
    version: "0",
    event_type: "SALE_COMPLETED",
    title: "Card sales land in a clearing receivable instead of the bank",
    mode: "AUTO",
    source_kind: "SALE_DAY",
    evidence: {
      kind: "PROPOSAL",
      note:
        "A deliberate change of accounting policy, not current practice. It would make the " +
        "bank balance agree with the bank from the first day and turn the period-end reclass " +
        "into a settlement match. It also changes what every past comparative means, so it is " +
        "a decision for the client and not a default.",
    },
    readiness: "DRAFT",
    activation: off("A policy change nobody has approved. Mutually exclusive with card_reclass."),
    lines: [
      { seq: 1, side: "DEBIT", role: "CARD_RECEIVABLE", narrow_by: ["unit_id", "acquirer"], basis: { kind: "PER", group: "tenders", field: "amount" } },
      { seq: 2, side: "CREDIT", role: "SALES_REVENUE_CARD", narrow_by: ["unit_id", "acquirer"], basis: { kind: "PER", group: "tenders", field: "amount" } },
    ],
  },
  build: (p) =>
    p.tenders
      .filter((t) => t.method === "CARD")
      .flatMap((t) => [
        D("CARD_RECEIVABLE", { unit_id: p.unit_id, acquirer: t.acquirer ?? "BCA_DEBIT" }, t.amount),
        C("SALES_REVENUE_CARD", { unit_id: p.unit_id, acquirer: t.acquirer ?? "BCA_DEBIT" }, t.amount),
      ]),
}

export const PREPAID_RELEASE: Rule<PrepaidPayload> = {
  pkg: {
    package_id: "prepaid_release",
    version: "1",
    event_type: "PREPAID_RECOGNISED",
    title: "A month of prepaid rent becomes a cost",
    mode: "SCHEDULE",
    source_kind: "MANUAL",
    evidence: journal(
      "C006-GL-26-07-00001, July 2026",
      "Dr Biaya Sewa Bangunan Toko dan Gudang C006 / Cr Sewa Toko Bayar dimuka C006."
    ),
    readiness: "VALIDATED",
    activation: on(BOOK, ALL_UNITS),
    lines: [
      { seq: 1, side: "DEBIT", role: "RENT_EXPENSE", narrow_by: ["unit_id"], basis: { kind: "FIELD", field: "amount" } },
      { seq: 2, side: "CREDIT", role: "PREPAID_RENT", narrow_by: ["unit_id"], basis: { kind: "FIELD", field: "amount" } },
    ],
  },
  build: (p) => [
    D("RENT_EXPENSE", { unit_id: p.unit_id }, p.amount),
    C("PREPAID_RENT", { unit_id: p.unit_id }, p.amount),
  ],
}

// ---------------------------------------------------------------------------
// The register, and the check that a rule matches its own contract
// ---------------------------------------------------------------------------

/// Every package, in the order a person would read them.
export const PACKAGES: readonly RulePackage[] = [
  SALE.pkg,
  CARD_CLEARING.pkg,
  DISPATCH.pkg,
  RECEIPT.pkg,
  DEPOSIT.pkg,
  CARD_RECLASS.pkg,
  CARD_SETTLEMENT.pkg,
  PAYROLL_ACCRUAL.pkg,
  FUNDING.pkg,
  ASSET_ACQUISITION.pkg,
  DEPRECIATION.pkg,
  OE_REPLACEMENT.pkg,
  OE_RESERVE.pkg,
  PREPAID_RELEASE.pkg,
]

export function packageById(id: string): RulePackage | undefined {
  return PACKAGES.find((p) => p.package_id === id)
}

export function ruleVersion(pkg: RulePackage): string {
  return `${pkg.package_id}@${pkg.version}`
}

/// May this package post, here, now?
export function activeFor(pkg: RulePackage, book_id: string, unit_id: string, on: string): string | null {
  const a = pkg.activation
  if (!a.enabled) return a.blocked_reason ?? "the rule package is not enabled"
  if (!a.books.includes(book_id)) return `not activated for book ${book_id}`
  if (!a.units.includes(unit_id)) return `not activated for unit ${unit_id}`
  if (a.effective_from && on < a.effective_from) return `not effective until ${a.effective_from}`
  if (a.effective_to && on > a.effective_to) return `stopped being effective on ${a.effective_to}`
  return null
}

/// Does the builder only touch roles its declaration named, on the sides it
/// declared?
///
/// Cheap, and it is the check that keeps the contract honest. A rule whose
/// documentation and behaviour disagree is worse than one with no
/// documentation, because somebody trusts it.
export function conformance(
  pkg: RulePackage,
  built: readonly IntentLine[]
): readonly string[] {
  const declared = new Set(pkg.lines.map((l) => `${l.side}:${l.role}`))
  const problems: string[] = []
  for (const l of built) {
    const key = `${l.side}:${l.role}`
    if (!declared.has(key)) {
      problems.push(`${pkg.package_id} built a ${l.side} to ${l.role}, which its contract does not declare`)
    }
  }
  // At most one balancing line may actually FIRE, so alternatives in one group
  // count as one. Two independent balancing lines is a rule that cannot say
  // which of them absorbs the difference.
  const groups = new Set(
    pkg.lines.filter((l) => l.basis.kind === "BALANCING").map((l) => l.alt_group ?? `seq:${l.seq}`)
  )
  if (groups.size > 1) {
    problems.push(
      `${pkg.package_id} declares ${groups.size} independent balancing lines; at most one may be`
    )
  }
  return problems
}
