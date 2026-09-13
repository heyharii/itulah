/// The rows the Finance screens read.
///
/// Every figure here comes from CENTRAL FASHION STORE's own July 2026 export
/// for C006 — 13,339 journal lines across 2,187 documents — or from their asset
/// register. Where a screen needs something the export does not contain (a
/// supplier bill's due date, a loan schedule), the shape is real and the
/// numbers are plausible for this client rather than invented at random.
///
/// This is a frontend prototype: there is no server. What the screens must
/// still get right is the arithmetic, and they do — every balance below is
/// summed from the journal the engine posted, never typed twice.

import type { Day, Minor } from "./types"

// ---------------------------------------------------------------------------
// Receivables — card settlement
// ---------------------------------------------------------------------------

/// The client banks a card sale immediately and moves what has not settled to
/// `Piutang Debit Card` at the period end. So a receivable here is a batch of
/// card takings waiting on the acquirer, not a customer who owes money — this
/// client sells nothing on credit.
export interface CardBatch {
  readonly batch_id: string
  readonly unit_id: string
  /// Which settlement channel this is.
  ///
  /// Added when `Card settlements` widened to `Settlements`. A marketplace
  /// payout behaves exactly like a card batch — captured on one date, paid
  /// over on another, net of a fee the platform decides — and the client's
  /// `4010113002 Penjualan Online Market Place` proves they already sell that
  /// way. Two screens for one behaviour would have meant two ageing reports
  /// that have to be added up by hand.
  readonly channel: "DEBIT" | "CREDIT" | "MARKETPLACE"
  readonly acquirer: string
  /// Which of our accounts the acquirer pays into. Not one per store: a shop
  /// can have an EDC from two banks and each settles into its own account, so
  /// "the shop's bank" is not enough to reconcile a settlement against.
  readonly settles_into: string
  readonly captured_on: Day
  readonly expected_on: Day
  readonly gross: Minor
  /// The acquirer's fee, known from the schedule and confirmed on settlement.
  readonly fee: Minor
  readonly settled_on?: Day
  readonly settled_net?: Minor
}

/// Asking the acquirer where the money is.
///
/// A batch past its expected date is not yet a loss and not yet an error — it
/// is a question, and the question has a life of its own: raised, chased,
/// answered. Without somewhere to record it, the same overdue batch gets
/// queried by three people in a fortnight and the answer lives in a WhatsApp
/// thread.
export interface Inquiry {
  readonly inquiry_id: string
  readonly batch_id: string
  readonly raised_on: Day
  readonly raised_by: string
  readonly reference?: string
  readonly status: "OPEN" | "ANSWERED" | "RESOLVED"
  readonly note?: string
  readonly answered_on?: Day
}

export const CARD_BATCHES: readonly CardBatch[] = [
  {
    batch_id: "BCA-260728",
    unit_id: "C006",
    channel: "DEBIT",
    acquirer: "BCA Debit",
    settles_into: "BCA-TAB-C006",
    captured_on: "2026-07-28",
    expected_on: "2026-07-30",
    gross: 128_450_000,
    fee: 1_926_750,
    settled_on: "2026-07-30",
    settled_net: 126_523_250,
  },
  {
    batch_id: "BCA-260729",
    unit_id: "C006",
    channel: "DEBIT",
    acquirer: "BCA Debit",
    settles_into: "BCA-TAB-C006",
    captured_on: "2026-07-29",
    expected_on: "2026-07-31",
    gross: 96_200_000,
    fee: 1_443_000,
    settled_on: "2026-07-31",
    settled_net: 94_757_000,
  },
  {
    batch_id: "BCA-260730",
    unit_id: "C006",
    channel: "DEBIT",
    acquirer: "BCA Debit",
    settles_into: "BCA-TAB-C006",
    captured_on: "2026-07-30",
    expected_on: "2026-08-03",
    gross: 174_800_000,
    fee: 2_622_000,
  },
  {
    batch_id: "BNI-260731",
    unit_id: "C006",
    channel: "DEBIT",
    acquirer: "BNI Debit",
    settles_into: "BNI-TAB-C006",
    captured_on: "2026-07-31",
    expected_on: "2026-08-04",
    gross: 234_700_000,
    fee: 3_520_500,
  },
  {
    batch_id: "BCA-260726",
    unit_id: "C004",
    channel: "DEBIT",
    acquirer: "BCA Debit",
    settles_into: "BCA-TAB-C004",
    captured_on: "2026-07-26",
    expected_on: "2026-07-28",
    gross: 88_300_000,
    fee: 1_324_500,
  },
  {
    batch_id: "BCA-260720",
    unit_id: "C006",
    channel: "CREDIT",
    acquirer: "BCA Credit",
    settles_into: "BCA-GIRO-C006",
    captured_on: "2026-07-20",
    expected_on: "2026-07-23",
    gross: 41_600_000,
    fee: 832_000,
  },
  {
    batch_id: "TP-260725",
    unit_id: "C006",
    channel: "MARKETPLACE",
    acquirer: "Tokopedia",
    settles_into: "BCA-TAB-C006",
    captured_on: "2026-07-25",
    expected_on: "2026-08-01",
    gross: 62_400_000,
    fee: 3_744_000,
  },
  {
    batch_id: "SP-260722",
    unit_id: "C006",
    channel: "MARKETPLACE",
    acquirer: "Shopee",
    settles_into: "BCA-TAB-C006",
    captured_on: "2026-07-22",
    expected_on: "2026-07-29",
    gross: 88_150_000,
    fee: 5_289_000,
  },
  {
    batch_id: "SP-260715",
    unit_id: "C006",
    channel: "MARKETPLACE",
    acquirer: "Shopee",
    settles_into: "BCA-TAB-C006",
    captured_on: "2026-07-15",
    expected_on: "2026-07-22",
    gross: 71_900_000,
    fee: 4_314_000,
    settled_on: "2026-07-23",
    settled_net: 67_586_000,
  },
  {
    batch_id: "TT-260728",
    unit_id: "C004",
    channel: "MARKETPLACE",
    acquirer: "TikTok Shop",
    settles_into: "BCA-TAB-C004",
    captured_on: "2026-07-28",
    expected_on: "2026-08-04",
    gross: 34_200_000,
    fee: 2_394_000,
  },
]

export const INQUIRIES: readonly Inquiry[] = [
  {
    inquiry_id: "Q-1",
    batch_id: "BCA-260720",
    raised_on: "2026-07-27",
    raised_by: "finance@lab",
    reference: "TIKET-BCA-88214",
    status: "ANSWERED",
    answered_on: "2026-07-30",
    note: "Acquirer says the terminal batch closed twice; the second is void.",
  },
]

// ---------------------------------------------------------------------------
// Payables — supplier bills
// ---------------------------------------------------------------------------

/// Bills sit at head office. The client confirmed that shops do not carry the
/// merchandise supplier payable at all — a shop owes head office for goods,
/// which is the affiliate account on Interunit, not a supplier account here.
/// A trading party's own record. One master, read through two screens.
///
/// `kind` is what splits them, and the split is the client's, not ours:
/// `2012001001 Hutang Suppliers Barang Dagangan` carries merchandise and
/// `2012001003 Hutang Supplier Non Barang Dagang` carries everything else, so
/// Suppliers and Vendors are two ageing reports and therefore two menus. What
/// stays single is this list — the party a purchase order goes to is the party
/// a bill comes from and the party a payment reaches, and two masters would
/// mean two spellings of one name.
export interface Vendor {
  readonly vendor_id: string
  readonly name: string
  readonly kind: "MERCHANDISE" | "SERVICE" | "UTILITY"
  readonly phone?: string
  readonly email?: string
  /// Days from invoice to due. What the bills' own due dates are derived from,
  /// and what makes a missing one visible.
  readonly terms_days?: number
  readonly bank?: string
  readonly npwp?: string
  readonly withholding?: boolean
}

export const VENDORS: readonly Vendor[] = [
  {
    vendor_id: "V-PS",
    name: "PT Pancasakti Sandang",
    kind: "MERCHANDISE",
    phone: "0741 555 210",
    email: "ar@pancasakti.co.id",
    terms_days: 30,
    bank: "BCA •••• 8871",
    npwp: "01.234.567.8-901.000",
  },
  {
    vendor_id: "V-GT",
    name: "CV Gemilang Tekstil",
    kind: "MERCHANDISE",
    phone: "0741 555 334",
    email: "finance@gemilang.id",
    terms_days: 30,
    bank: "Mandiri •••• 2019",
    npwp: "02.345.678.9-012.000",
  },
  {
    vendor_id: "V-KM",
    name: "PT Kencana Mode",
    kind: "MERCHANDISE",
    phone: "021 555 7788",
    email: "billing@kencanamode.com",
    terms_days: 30,
    bank: "BCA •••• 4402",
  },
  {
    vendor_id: "V-SG",
    name: "PT Sinar Gemilang",
    kind: "MERCHANDISE",
    phone: "021 555 1122",
    terms_days: 30,
  },
  { vendor_id: "V-PLN", name: "PLN", kind: "UTILITY", terms_days: 15 },
  { vendor_id: "V-TLK", name: "Telkom", kind: "UTILITY", terms_days: 15 },
  { vendor_id: "V-PDAM", name: "PDAM Bungo", kind: "UTILITY", terms_days: 15 },
]

export interface Bill {
  readonly bill_id: string
  readonly number: string
  readonly supplier: string
  readonly unit_id: string
  readonly kind: "MERCHANDISE" | "EXPENSE"
  readonly issued_on: Day
  readonly due_on: Day
  readonly total: Minor
  readonly paid: Minor
  readonly status: "DRAFT" | "OPEN" | "PART_PAID" | "PAID"
}

export const BILLS: readonly Bill[] = [
  {
    bill_id: "B-1",
    number: "INV/PS/26-07/1188",
    supplier: "PT Pancasakti Sandang",
    unit_id: "HO",
    kind: "MERCHANDISE",
    issued_on: "2026-07-02",
    due_on: "2026-08-01",
    total: 18_512_339_100,
    paid: 18_512_339_100,
    status: "PAID",
  },
  {
    bill_id: "B-2",
    number: "INV/GT/26-07/0442",
    supplier: "CV Gemilang Tekstil",
    unit_id: "HO",
    kind: "MERCHANDISE",
    issued_on: "2026-07-11",
    due_on: "2026-08-10",
    total: 15_998_402_226,
    paid: 8_000_000_000,
    status: "PART_PAID",
  },
  {
    bill_id: "B-3",
    number: "INV/KM/26-07/0913",
    supplier: "PT Kencana Mode",
    unit_id: "HO",
    kind: "MERCHANDISE",
    issued_on: "2026-07-20",
    due_on: "2026-08-19",
    total: 12_538_104_000,
    paid: 0,
    status: "OPEN",
  },
  {
    bill_id: "B-4",
    number: "PLN/26-07/C006",
    supplier: "PLN",
    unit_id: "C006",
    kind: "EXPENSE",
    issued_on: "2026-07-05",
    due_on: "2026-07-20",
    total: 486_320_000,
    paid: 486_320_000,
    status: "PAID",
  },
  {
    bill_id: "B-5",
    number: "TLK/26-07/C006",
    supplier: "Telkom",
    unit_id: "C006",
    kind: "EXPENSE",
    issued_on: "2026-07-05",
    due_on: "2026-07-20",
    total: 61_450_000,
    paid: 0,
    status: "OPEN",
  },
  {
    bill_id: "B-6",
    number: "PDAM/26-07/C006",
    supplier: "PDAM Bungo",
    unit_id: "C006",
    kind: "EXPENSE",
    issued_on: "2026-07-06",
    due_on: "2026-07-21",
    total: 18_900_000,
    paid: 0,
    status: "OPEN",
  },
  {
    bill_id: "B-7",
    number: "INV/SG/26-06/0771",
    supplier: "PT Sinar Gemilang",
    unit_id: "HO",
    kind: "MERCHANDISE",
    issued_on: "2026-06-14",
    due_on: "2026-07-14",
    total: 9_420_000_000,
    paid: 0,
    status: "OPEN",
  },
]

// ---------------------------------------------------------------------------
// Prepaids & advances
// ---------------------------------------------------------------------------

export interface Prepaid {
  readonly prepaid_id: string
  readonly description: string
  readonly unit_id: string
  readonly account: string
  readonly starts_on: Day
  readonly months: number
  readonly total: Minor
  /// How many months have been released by the end of July 2026.
  readonly released_months: number
}

export const PREPAIDS: readonly Prepaid[] = [
  {
    prepaid_id: "P-1",
    description: "Store and warehouse rent C006",
    unit_id: "C006",
    account: "101130100306",
    starts_on: "2026-01-01",
    months: 12,
    total: 10_000_000_000,
    released_months: 6,
  },
  {
    prepaid_id: "P-2",
    description: "Staff housing rent C006",
    unit_id: "C006",
    account: "101130100406",
    starts_on: "2026-03-01",
    months: 12,
    total: 3_600_000_000,
    released_months: 5,
  },
  {
    prepaid_id: "P-3",
    description: "Fire insurance C006",
    unit_id: "C006",
    account: "101130100306",
    starts_on: "2026-05-01",
    months: 12,
    total: 1_440_000_000,
    released_months: 3,
  },
]

export interface Advance {
  readonly advance_id: string
  readonly holder: string
  readonly unit_id: string
  readonly issued_on: Day
  readonly purpose: string
  readonly amount: Minor
  readonly liquidated: Minor
}

export const ADVANCES: readonly Advance[] = [
  {
    advance_id: "A-1",
    holder: "Store manager C006",
    unit_id: "C006",
    issued_on: "2026-07-18",
    purpose: "Business trip to head office",
    amount: 250_000_000,
    liquidated: 187_500_000,
  },
  {
    advance_id: "A-2",
    holder: "GA staff C006",
    unit_id: "C006",
    issued_on: "2026-07-24",
    purpose: "Store supplies purchase",
    amount: 150_000_000,
    liquidated: 0,
  },
]

// ---------------------------------------------------------------------------
// Tax
// ---------------------------------------------------------------------------

export interface TaxItem {
  readonly tax_id: string
  readonly kind: string
  readonly account: string
  readonly period: string
  readonly unit_id: string
  readonly base: Minor
  readonly amount: Minor
  readonly due_on: Day
  readonly paid_on?: Day
}

export const TAXES: readonly TaxItem[] = [
  {
    tax_id: "T-1",
    kind: "PPh Pasal 25 OP",
    account: "201210100506",
    period: "2026-07",
    unit_id: "C006",
    base: 0,
    amount: 125_000_000,
    due_on: "2026-08-15",
  },
  {
    tax_id: "T-2",
    kind: "PPh Pasal 25 OP",
    account: "201210100506",
    period: "2026-06",
    unit_id: "C006",
    base: 0,
    amount: 125_000_000,
    due_on: "2026-07-15",
    paid_on: "2026-07-14",
  },
  {
    tax_id: "T-3",
    kind: "PPh Pasal 21",
    account: "201210100506",
    period: "2026-07",
    unit_id: "C006",
    base: 5_725_000_000,
    amount: 0,
    due_on: "2026-08-10",
  },
]

// ---------------------------------------------------------------------------
// Financing
// ---------------------------------------------------------------------------

export interface Loan {
  readonly loan_id: string
  readonly lender: string
  readonly unit_id: string
  readonly drawn_on: Day
  readonly principal: Minor
  readonly rate_bps: number
  readonly months: number
  readonly paid_months: number
}

export const LOANS: readonly Loan[] = [
  {
    loan_id: "L-1",
    lender: "Bank BCA — kredit investasi",
    unit_id: "HO",
    drawn_on: "2024-03-01",
    principal: 250_000_000_000,
    rate_bps: 1050,
    months: 60,
    paid_months: 29,
  },
]

// ---------------------------------------------------------------------------
// Inventory valuation
// ---------------------------------------------------------------------------

/// What the shop floor says it holds, per class. The general-ledger figure it
/// is compared against is summed from the journal, never typed here — that is
/// the whole point of the screen.
export interface StockClass {
  readonly klass: string
  readonly units: number
  readonly counted_value: Minor
}

export const STOCK: readonly StockClass[] = [
  { klass: "Pria", units: 4_812, counted_value: 18_240_500_000 },
  { klass: "Wanita", units: 6_105, counted_value: 24_870_100_000 },
  { klass: "Anak", units: 3_290, counted_value: 9_115_400_000 },
  { klass: "Aksesoris", units: 1_744, counted_value: 2_402_800_000 },
]

// ---------------------------------------------------------------------------
// Revenue
// ---------------------------------------------------------------------------

/// The month's trade at C006, by day, as the sale documents record it.
export interface DayTrade {
  readonly on: Day
  readonly cash: Minor
  readonly card: Minor
  readonly returns: Minor
  readonly cogs: Minor
}

export const TRADE: readonly DayTrade[] = [
  {
    on: "2026-07-01",
    cash: 1_462_650_000,
    card: 284_500_000,
    returns: 0,
    cogs: 1_135_647_500,
  },
  {
    on: "2026-07-02",
    cash: 1_377_395_000,
    card: 312_200_000,
    returns: 18_500_000,
    cogs: 1_087_236_750,
  },
  {
    on: "2026-07-03",
    cash: 1_313_400_000,
    card: 268_900_000,
    returns: 0,
    cogs: 1_028_395_000,
  },
  {
    on: "2026-07-04",
    cash: 1_688_200_000,
    card: 401_750_000,
    returns: 24_900_000,
    cogs: 1_346_167_500,
  },
  {
    on: "2026-07-05",
    cash: 1_902_400_000,
    card: 455_300_000,
    returns: 0,
    cogs: 1_532_505_000,
  },
  {
    on: "2026-07-06",
    cash: 1_204_800_000,
    card: 226_400_000,
    returns: 12_300_000,
    cogs: 928_180_000,
  },
  {
    on: "2026-07-07",
    cash: 1_118_950_000,
    card: 198_700_000,
    returns: 0,
    cogs: 855_922_500,
  },
]

// ---------------------------------------------------------------------------
// Bank statements
// ---------------------------------------------------------------------------

/// What the bank says, line by line, against what the books say. A line is
/// matched when a journal entry answers it; the ones that are not are the
/// screen's whole job.
export interface StatementLine {
  readonly line_id: string
  readonly bank_account_id: string
  readonly on: Day
  readonly description: string
  readonly amount: Minor
  readonly direction: "IN" | "OUT"
  readonly matched_entry?: string
}

export const STATEMENT: readonly StatementLine[] = [
  {
    line_id: "S-1",
    bank_account_id: "BCA-TAB-C006",
    on: "2026-07-27",
    description: "TRSF E-BANKING DB TELEPON KABEL",
    amount: 34_827_600,
    direction: "OUT",
    matched_entry: "SJV-000010",
  },
  {
    line_id: "S-2",
    bank_account_id: "BCA-TAB-C006",
    on: "2026-07-30",
    description: "SETTLE BCA DEBIT 260728",
    amount: 126_523_250,
    direction: "IN",
    matched_entry: "SJV-000016",
  },
  {
    line_id: "S-3",
    bank_account_id: "BCA-TAB-C006",
    on: "2026-07-31",
    description: "SETTLE BCA DEBIT 260729",
    amount: 94_757_000,
    direction: "IN",
  },
  {
    line_id: "S-4",
    bank_account_id: "BCA-TAB-C006",
    on: "2026-07-31",
    description: "BIAYA ADM",
    amount: 1_500_000,
    direction: "OUT",
  },
  {
    line_id: "S-5",
    bank_account_id: "BCA-TAB-C006",
    on: "2026-07-31",
    description: "BUNGA BANK",
    amount: 428_300,
    direction: "IN",
  },
  {
    line_id: "S-6",
    bank_account_id: "BCA-TAB-C004",
    on: "2026-07-15",
    description: "TRSF AC C4 UNIT",
    amount: 2_500_500_000,
    direction: "OUT",
    matched_entry: "SJV-000011",
  },
  {
    line_id: "S-7",
    bank_account_id: "BCA-TAB-C004",
    on: "2026-07-15",
    description: "TRSF AC C4 PEMASANGAN",
    amount: 139_000_000,
    direction: "OUT",
    matched_entry: "SJV-000012",
  },
]

// ---------------------------------------------------------------------------
// Store sales reconciliation
// ---------------------------------------------------------------------------

/// One trading day at one store, three ways: what the till rang up, what the
/// manager counted, and what reached head office.
///
/// The three disagree for ordinary reasons — a card batch settles the next day,
/// a float is topped up, someone banks late — and for one that is not ordinary.
/// Keeping them as three columns rather than one "variance" is what lets the
/// reason be read off the row.
export interface StoreDay {
  readonly day_id: string
  readonly unit_id: string
  readonly on: Day
  /// What the till recorded.
  readonly rung_cash: Minor
  readonly rung_card: Minor
  /// What the manager counted in the drawer at close.
  readonly counted_cash: Minor
  /// What was banked or handed over, and when.
  readonly deposited: Minor
  readonly deposited_on?: Day
  readonly note?: string
}

export const STORE_DAYS: readonly StoreDay[] = [
  {
    day_id: "D-1",
    unit_id: "C006",
    on: "2026-07-01",
    rung_cash: 1_462_650_000,
    rung_card: 284_500_000,
    counted_cash: 1_462_650_000,
    deposited: 1_462_650_000,
    deposited_on: "2026-07-01",
  },
  {
    day_id: "D-2",
    unit_id: "C006",
    on: "2026-07-02",
    rung_cash: 1_377_395_000,
    rung_card: 312_200_000,
    counted_cash: 1_377_395_000,
    deposited: 1_377_395_000,
    deposited_on: "2026-07-02",
  },
  {
    day_id: "D-3",
    unit_id: "C006",
    on: "2026-07-03",
    rung_cash: 1_313_400_000,
    rung_card: 268_900_000,
    counted_cash: 1_313_350_000,
    deposited: 1_313_400_000,
    deposited_on: "2026-07-03",
    note: "Rp500 short in the drawer",
  },
  {
    day_id: "D-4",
    unit_id: "C006",
    on: "2026-07-04",
    rung_cash: 1_688_200_000,
    rung_card: 401_750_000,
    counted_cash: 1_688_200_000,
    deposited: 0,
    note: "Not banked — the bank had closed",
  },
  {
    day_id: "D-5",
    unit_id: "C006",
    on: "2026-07-05",
    rung_cash: 1_902_400_000,
    rung_card: 455_300_000,
    counted_cash: 1_902_400_000,
    deposited: 3_590_600_000,
    deposited_on: "2026-07-06",
    note: "Two days banked together",
  },
  {
    day_id: "D-6",
    unit_id: "C004",
    on: "2026-07-05",
    rung_cash: 984_200_000,
    rung_card: 188_300_000,
    counted_cash: 981_700_000,
    deposited: 981_700_000,
    deposited_on: "2026-07-06",
    note: "Short Rp25,000",
  },
]

// ---------------------------------------------------------------------------
// Store expense review
// ---------------------------------------------------------------------------

/// What a store spent out of petty cash, waiting for head office to agree.
///
/// The client centralises spending: a store holds a fixed float and spends it
/// on small, listed things. Anything outside that list, or above the ceiling,
/// is head office's decision — which is why this is a review queue and not a
/// report.
export interface StoreExpense {
  readonly expense_id: string
  readonly unit_id: string
  readonly on: Day
  readonly description: string
  readonly category: string
  readonly amount: Minor
  readonly submitted_by: string
  readonly receipt: boolean
  readonly status: "SUBMITTED" | "APPROVED" | "REJECTED" | "POSTED"
  readonly note?: string
}

/// The ceiling a single store expense may not pass without head office.
export const STORE_EXPENSE_CEILING = 50_000_000

export const STORE_EXPENSES: readonly StoreExpense[] = [
  {
    expense_id: "E-1",
    unit_id: "C006",
    on: "2026-07-02",
    description: "Bank parking",
    category: "Biaya Bank",
    amount: 200_000,
    submitted_by: "Store manager C006",
    receipt: true,
    status: "POSTED",
  },
  {
    expense_id: "E-2",
    unit_id: "C006",
    on: "2026-07-02",
    description: "2 water gallons",
    category: "Biaya Rumah Tangga",
    amount: 1_000_000,
    submitted_by: "Store manager C006",
    receipt: true,
    status: "POSTED",
  },
  {
    expense_id: "E-3",
    unit_id: "C006",
    on: "2026-07-02",
    description: "2 fire extinguisher refills",
    category: "Biaya Rumah Tangga",
    amount: 27_000_000,
    submitted_by: "Store manager C006",
    receipt: true,
    status: "APPROVED",
  },
  {
    expense_id: "E-4",
    unit_id: "C006",
    on: "2026-07-09",
    description: "Cashier room AC service",
    category: "Biaya Rumah Tangga",
    amount: 65_000_000,
    submitted_by: "Store manager C006",
    receipt: true,
    status: "SUBMITTED",
    note: "Above the store ceiling",
  },
  {
    expense_id: "E-5",
    unit_id: "C006",
    on: "2026-07-14",
    description: "Delivery fuel",
    category: "Fuel & Oil",
    amount: 15_000_000,
    submitted_by: "GA staff C006",
    receipt: false,
    status: "SUBMITTED",
    note: "No receipt",
  },
  {
    expense_id: "E-6",
    unit_id: "C004",
    on: "2026-07-16",
    description: "Rolling door repair",
    category: "Biaya Rumah Tangga",
    amount: 120_000_000,
    submitted_by: "Store manager C004",
    receipt: true,
    status: "SUBMITTED",
    note: "Above the store ceiling",
  },
  {
    expense_id: "E-7",
    unit_id: "C006",
    on: "2026-07-21",
    description: "Meeting refreshments",
    category: "Biaya Rumah Tangga",
    amount: 8_500_000,
    submitted_by: "Store manager C006",
    receipt: true,
    status: "REJECTED",
    note: "Not a store expense",
  },
]

// ---------------------------------------------------------------------------
// Counterparties
// ---------------------------------------------------------------------------

/// Who money goes to and comes from, for the From/To column.
///
/// Vendors come from the bills; the rest are the parties this client's own July
/// journal names — the bank itself, the acquirer, head office, and the staff a
/// petty-cash payment reaches. A bank narrative rarely names them in a form a
/// machine can read, which is why this is a list somebody picks from rather
/// than something parsed out of the description.
export interface Party {
  readonly id: string
  readonly name: string
  readonly kind: "Vendor" | "Customer" | "Employee" | "Bank" | "Interunit"
}

export const PARTIES: readonly Party[] = [
  { id: "V-PS", name: "PT Pancasakti Sandang", kind: "Vendor" },
  { id: "V-GT", name: "CV Gemilang Tekstil", kind: "Vendor" },
  { id: "V-KM", name: "PT Kencana Mode", kind: "Vendor" },
  { id: "V-SG", name: "PT Sinar Gemilang", kind: "Vendor" },
  { id: "V-PLN", name: "PLN", kind: "Vendor" },
  { id: "V-TLK", name: "Telkom", kind: "Vendor" },
  { id: "V-PDAM", name: "PDAM Bungo", kind: "Vendor" },
  { id: "B-BCA", name: "Bank BCA", kind: "Bank" },
  { id: "B-BNI", name: "Bank BNI", kind: "Bank" },
  { id: "A-BCA", name: "BCA Debit (acquirer)", kind: "Bank" },
  { id: "I-HO", name: "HEAD OFFICE", kind: "Interunit" },
  { id: "E-KT6", name: "Store manager C006", kind: "Employee" },
  { id: "E-GA6", name: "GA staff C006", kind: "Employee" },
  { id: "E-STAFF", name: "Staff C006", kind: "Employee" },
]
