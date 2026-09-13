/// The registers the domain menus read, beyond cash, bills and card takings.
///
/// Same rule as `data.ts`: a shape is only here because the client's own chart
/// or their July 2026 export says they keep it, and the figures are theirs or
/// plausible for them. What this file adds is the nine account families the
/// first menu review found homeless — payroll accruals, outstanding giro,
/// interunit other-payables, bags in transit and in stock, marketplace
/// settlement, pre-opening, equity, and disposed stock.
///
/// None of them became a menu of their own. Each one landed in the menu whose
/// work it is part of, which is why they are here as registers rather than as
/// screens: `2012201 Gaji YMHD` is a row in Payroll payables, and it is *also*
/// a row in Accounting's consolidated accrual control, and the same object
/// serves both.

import type { Day, Minor } from "./types"

// ---------------------------------------------------------------------------
// Payroll — 2012201 (the payroll third of it) and the expense side
// ---------------------------------------------------------------------------

/// One month's payroll for one unit.
///
/// Split into components because that is how it is both approved and posted:
/// basic pay and allowances are one cost centre's expense, overtime is
/// another's argument, and BPJS is split employer/employee with only the
/// employer half being a cost. A single `total` would be unauditable against
/// the client's own `7010101 Gaji` family.
export interface PayrollRun {
  readonly run_id: string
  readonly unit_id: string
  readonly period: string
  readonly headcount: number
  readonly basic: Minor
  readonly allowance: Minor
  readonly overtime: Minor
  /// Employer's share of BPJS Kesehatan and Ketenagakerjaan. A cost.
  readonly bpjs_employer: Minor
  /// Withheld from the employee and owed to the state, not a cost.
  readonly pph21: Minor
  /// Withheld from the employee and owed to BPJS, not a cost.
  readonly bpjs_employee: Minor
  readonly status: "DRAFT" | "APPROVED" | "POSTED" | "PAID"
  readonly paid_on?: Day
}

export const PAYROLL_RUNS: readonly PayrollRun[] = [
  {
    run_id: "PR-2607-HO",
    unit_id: "HO",
    period: "2026-07",
    headcount: 38,
    basic: 9_120_000_000,
    allowance: 2_280_000_000,
    overtime: 316_000_000,
    bpjs_employer: 478_000_000,
    pph21: 214_000_000,
    bpjs_employee: 114_000_000,
    status: "PAID",
    paid_on: "2026-07-28",
  },
  {
    run_id: "PR-2607-C006",
    unit_id: "C006",
    period: "2026-07",
    headcount: 24,
    basic: 4_320_000_000,
    allowance: 1_080_000_000,
    overtime: 325_000_000,
    bpjs_employer: 226_800_000,
    pph21: 0,
    bpjs_employee: 54_000_000,
    status: "POSTED",
  },
  {
    run_id: "PR-2607-C004",
    unit_id: "C004",
    period: "2026-07",
    headcount: 19,
    basic: 3_420_000_000,
    allowance: 855_000_000,
    overtime: 198_500_000,
    bpjs_employer: 179_550_000,
    pph21: 0,
    bpjs_employee: 42_750_000,
    status: "POSTED",
  },
  {
    run_id: "PR-2606-C006",
    unit_id: "C006",
    period: "2026-06",
    headcount: 24,
    basic: 4_320_000_000,
    allowance: 1_080_000_000,
    overtime: 402_000_000,
    bpjs_employer: 226_800_000,
    pph21: 0,
    bpjs_employee: 54_000_000,
    status: "PAID",
    paid_on: "2026-06-28",
  },
  {
    run_id: "PR-2605-C006",
    unit_id: "C006",
    period: "2026-05",
    headcount: 23,
    basic: 4_140_000_000,
    allowance: 1_035_000_000,
    overtime: 288_000_000,
    bpjs_employer: 217_350_000,
    pph21: 0,
    bpjs_employee: 51_750_000,
    status: "PAID",
    paid_on: "2026-05-28",
  },
  {
    run_id: "PR-2604-C006",
    unit_id: "C006",
    period: "2026-04",
    headcount: 23,
    basic: 4_140_000_000,
    allowance: 1_035_000_000,
    overtime: 512_000_000,
    bpjs_employer: 217_350_000,
    pph21: 0,
    bpjs_employee: 51_750_000,
    status: "PAID",
    paid_on: "2026-04-28",
  },
]

/// What payroll leaves behind in the balance sheet at the month end.
///
/// The client's `2012201` family carries five of these — Gaji YMHD, THR &
/// Insentif YMHD, Pengobatan YMHD, Asuransi/BPJS YMHD — and `2012101` carries
/// the PPh 21. They are shown together because the question at the month end
/// is "what does payroll still owe", and it is not answered by one account.
export interface PayrollPayable {
  readonly id: string
  readonly kind: string
  readonly account: string
  readonly unit_id: string
  readonly period: string
  readonly amount: Minor
  readonly settled: Minor
  readonly due_on: Day
}

export const PAYROLL_PAYABLES: readonly PayrollPayable[] = [
  {
    id: "PY-1",
    kind: "Gaji YMHD",
    account: "201220100106",
    unit_id: "C006",
    period: "2026-07",
    amount: 5_725_000_000,
    settled: 0,
    due_on: "2026-08-05",
  },
  {
    id: "PY-2",
    kind: "Gaji YMHD",
    account: "201220100104",
    unit_id: "C004",
    period: "2026-07",
    amount: 4_473_500_000,
    settled: 0,
    due_on: "2026-08-05",
  },
  {
    id: "PY-3",
    kind: "Asuransi / BPJS YMHD",
    account: "201220100506",
    unit_id: "C006",
    period: "2026-07",
    amount: 280_800_000,
    settled: 0,
    due_on: "2026-08-15",
  },
  {
    id: "PY-4",
    kind: "THR & Insentif YMHD",
    account: "201220100206",
    unit_id: "C006",
    period: "2026-07",
    amount: 1_800_000_000,
    settled: 0,
    due_on: "2026-12-20",
  },
  {
    id: "PY-5",
    kind: "Pengobatan YMHD",
    account: "201220100406",
    unit_id: "C006",
    period: "2026-07",
    amount: 92_400_000,
    settled: 41_000_000,
    due_on: "2026-08-20",
  },
  {
    id: "PY-6",
    kind: "PPh Pasal 21 terutang",
    account: "201210100100",
    unit_id: "HO",
    period: "2026-07",
    amount: 214_000_000,
    settled: 0,
    due_on: "2026-08-10",
  },
  {
    id: "PY-7",
    kind: "Gaji YMHD",
    account: "201220100106",
    unit_id: "C006",
    period: "2026-06",
    amount: 5_802_000_000,
    settled: 5_802_000_000,
    due_on: "2026-07-05",
  },
]

// ---------------------------------------------------------------------------
// Outstanding giro — 2012002, a status rather than a menu
// ---------------------------------------------------------------------------

/// A cheque or giro written and not yet presented.
///
/// The client's chart keeps 70 of these, one per unit per bank, and the reason
/// they matter is that the bank balance and the book balance disagree by
/// exactly this while a giro is out. Which is why it is not a menu: it is what
/// a Cash & Bank transaction *is* between being written and being cleared.
export interface Giro {
  readonly giro_id: string
  readonly number: string
  readonly bank_account_id: string
  readonly unit_id: string
  readonly payee: string
  readonly issued_on: Day
  readonly value_on: Day
  readonly amount: Minor
  readonly status: "OUTSTANDING" | "CLEARED" | "VOID"
  readonly cleared_on?: Day
  /// What it was written for, so the row can be traced back.
  readonly source?: string
}

export const GIROS: readonly Giro[] = [
  {
    giro_id: "G-1",
    number: "BCA 442190",
    bank_account_id: "BCA-GIRO-C006",
    unit_id: "C006",
    payee: "PT Pancasakti Sandang",
    issued_on: "2026-07-24",
    value_on: "2026-08-03",
    amount: 8_000_000_000,
    status: "OUTSTANDING",
    source: "INV/GT/26-07/0442",
  },
  {
    giro_id: "G-2",
    number: "BCA 442191",
    bank_account_id: "BCA-GIRO-C006",
    unit_id: "C006",
    payee: "PT Kencana Mode",
    issued_on: "2026-07-29",
    value_on: "2026-08-12",
    amount: 5_500_000_000,
    status: "OUTSTANDING",
    source: "INV/KM/26-07/0913",
  },
  {
    giro_id: "G-3",
    number: "BCA 442188",
    bank_account_id: "BCA-GIRO-C006",
    unit_id: "C006",
    payee: "PT Sinar Gemilang",
    issued_on: "2026-07-08",
    value_on: "2026-07-18",
    amount: 3_200_000_000,
    status: "CLEARED",
    cleared_on: "2026-07-18",
    source: "INV/SG/26-06/0771",
  },
  {
    giro_id: "G-4",
    number: "BCA 991002",
    bank_account_id: "BCA-GIRO-C004",
    unit_id: "C004",
    payee: "CV Gemilang Tekstil",
    issued_on: "2026-07-30",
    value_on: "2026-08-14",
    amount: 2_400_000_000,
    status: "OUTSTANDING",
    source: "INV/GT/26-07/0442",
  },
  {
    giro_id: "G-5",
    number: "BCA 991001",
    bank_account_id: "BCA-GIRO-C004",
    unit_id: "C004",
    payee: "PT Pancasakti Sandang",
    issued_on: "2026-06-28",
    value_on: "2026-07-08",
    amount: 1_750_000_000,
    status: "VOID",
    source: "Wrong amount — replaced by 991002",
  },
]

// ---------------------------------------------------------------------------
// Other receivables — 1011102, staff and management
// ---------------------------------------------------------------------------

/// Money lent to a person rather than owed by a customer.
///
/// The client's three sub-accounts are PEGAWAI, KEPALA TOKO and MANAJEMEN, and
/// the owner has confirmed that a store manager's balance here is a personal
/// loan, not a float and not an operating advance. Keeping it out of Advances
/// is the whole point: an advance is liquidated against receipts, a loan is
/// repaid out of pay.
export interface StaffLoan {
  readonly loan_id: string
  readonly person: string
  readonly role: "PEGAWAI" | "KEPALA TOKO" | "MANAJEMEN"
  readonly account: string
  readonly unit_id: string
  readonly issued_on: Day
  readonly principal: Minor
  readonly repaid: Minor
  /// Deducted from pay each month.
  readonly instalment: Minor
  readonly note?: string
}

export const STAFF_LOANS: readonly StaffLoan[] = [
  {
    loan_id: "SL-1",
    person: "Kepala Toko C006",
    role: "KEPALA TOKO",
    account: "101110200206",
    unit_id: "C006",
    issued_on: "2026-02-10",
    principal: 6_000_000_000,
    repaid: 2_500_000_000,
    instalment: 500_000_000,
    note: "Personal loan, recovered from pay",
  },
  {
    loan_id: "SL-2",
    person: "Kepala Toko C004",
    role: "KEPALA TOKO",
    account: "101110200204",
    unit_id: "C004",
    issued_on: "2026-05-02",
    principal: 4_000_000_000,
    repaid: 800_000_000,
    instalment: 400_000_000,
  },
  {
    loan_id: "SL-3",
    person: "Staf Gudang C006",
    role: "PEGAWAI",
    account: "101110200106",
    unit_id: "C006",
    issued_on: "2026-06-15",
    principal: 1_200_000_000,
    repaid: 200_000_000,
    instalment: 100_000_000,
  },
  {
    loan_id: "SL-4",
    person: "Kasir C006",
    role: "PEGAWAI",
    account: "101110200106",
    unit_id: "C006",
    issued_on: "2026-07-01",
    principal: 800_000_000,
    repaid: 0,
    instalment: 100_000_000,
    note: "Deductions have not started",
  },
  {
    loan_id: "SL-5",
    person: "Manajemen HO",
    role: "MANAJEMEN",
    account: "101110200300",
    unit_id: "HO",
    issued_on: "2025-11-20",
    principal: 25_000_000_000,
    repaid: 12_500_000_000,
    instalment: 1_250_000_000,
  },
]

// ---------------------------------------------------------------------------
// Inventory — the second stream, in transit and disposed
// ---------------------------------------------------------------------------

/// Goods that have left one unit and not arrived at the other.
///
/// The client keeps two families of these: `1011203 BDP Barang Dagangan` and
/// `1011204 BDP Kantong Belanja`, 196 accounts each. It is inventory, valued
/// at cost, and it belongs to nobody's shop floor for as long as it is on a
/// lorry — which is exactly why it needs a screen, and why the affiliate
/// credit the same movement raises is Interunit's business and not this one's.
export interface Shipment {
  readonly shipment_id: string
  readonly reference: string
  readonly from_unit: string
  readonly to_unit: string
  readonly klass: "Barang Dagangan" | "Kantong Belanja"
  readonly sent_on: Day
  readonly expected_on: Day
  readonly units: number
  readonly value: Minor
  readonly received_on?: Day
  /// Short on arrival. The reason this cannot simply clear itself.
  readonly variance?: Minor
}

export const SHIPMENTS: readonly Shipment[] = [
  {
    shipment_id: "SJ-1",
    reference: "SJ/HO/26-07/0881",
    from_unit: "HO",
    to_unit: "C006",
    klass: "Barang Dagangan",
    sent_on: "2026-07-28",
    expected_on: "2026-07-31",
    units: 1_240,
    value: 4_180_500_000,
  },
  {
    shipment_id: "SJ-2",
    reference: "SJ/HO/26-07/0884",
    from_unit: "HO",
    to_unit: "C004",
    klass: "Barang Dagangan",
    sent_on: "2026-07-29",
    expected_on: "2026-08-02",
    units: 860,
    value: 2_902_100_000,
  },
  {
    shipment_id: "SJ-3",
    reference: "SJ/HO/26-07/0870",
    from_unit: "HO",
    to_unit: "C006",
    klass: "Kantong Belanja",
    sent_on: "2026-07-22",
    expected_on: "2026-07-25",
    units: 12_000,
    value: 84_000_000,
    received_on: "2026-07-26",
  },
  {
    shipment_id: "SJ-4",
    reference: "SJ/HO/26-07/0865",
    from_unit: "HO",
    to_unit: "C006",
    klass: "Barang Dagangan",
    sent_on: "2026-07-18",
    expected_on: "2026-07-21",
    units: 1_010,
    value: 3_411_800_000,
    received_on: "2026-07-21",
    variance: 18_400_000,
  },
  {
    shipment_id: "SJ-5",
    reference: "SJ/C006/26-07/0021",
    from_unit: "C006",
    to_unit: "C004",
    klass: "Barang Dagangan",
    sent_on: "2026-07-30",
    expected_on: "2026-08-01",
    units: 240,
    value: 812_400_000,
  },
]

/// A bag class. The client's `1011202` splits plastic and paper by five sizes.
export interface BagClass {
  readonly code: string
  readonly name: string
  readonly units: number
  readonly value: Minor
}

export const BAGS: readonly BagClass[] = [
  {
    code: "1011202001",
    name: "Kantong Plastik KECIL",
    units: 42_000,
    value: 63_000_000,
  },
  {
    code: "1011202002",
    name: "Kantong Plastik SEDANG",
    units: 31_500,
    value: 78_750_000,
  },
  {
    code: "1011202003",
    name: "Kantong Plastik BESAR",
    units: 18_200,
    value: 72_800_000,
  },
  {
    code: "1011202004",
    name: "Kantong Plastik JUMBO",
    units: 6_400,
    value: 44_800_000,
  },
  {
    code: "1011202005",
    name: "Kantong Plastik SEPATU",
    units: 9_100,
    value: 31_850_000,
  },
  {
    code: "1011202006",
    name: "Kantong Kertas KECIL",
    units: 12_000,
    value: 48_000_000,
  },
  {
    code: "1011202007",
    name: "Kantong Kertas SEDANG",
    units: 8_800,
    value: 52_800_000,
  },
  {
    code: "1011202008",
    name: "Kantong Kertas BESAR",
    units: 5_200,
    value: 46_800_000,
  },
  {
    code: "1011202009",
    name: "Kantong Kertas JUMBO",
    units: 2_100,
    value: 25_200_000,
  },
  {
    code: "1011202010",
    name: "Kantong Kertas SEPATU",
    units: 3_400,
    value: 27_200_000,
  },
]

/// Stock written down, written off, or sold as disposed.
///
/// `1031801 Disposed Inventory` is an asset account in their chart, not an
/// expense: damaged stock is moved out of merchandise and carried at whatever
/// it can still fetch until it is actually cleared.
export interface StockAdjustment {
  readonly adj_id: string
  readonly on: Day
  readonly unit_id: string
  readonly kind: "SHRINKAGE" | "DAMAGE" | "DISPOSAL" | "COUNT"
  readonly reference: string
  readonly units: number
  readonly cost: Minor
  /// What it is carried at after the adjustment. Zero for a write-off.
  readonly residual: Minor
  readonly status: "SUBMITTED" | "APPROVED" | "POSTED"
  readonly note?: string
}

export const STOCK_ADJUSTMENTS: readonly StockAdjustment[] = [
  {
    adj_id: "ADJ-1",
    on: "2026-07-31",
    unit_id: "C006",
    kind: "COUNT",
    reference: "SO/C006/26-07",
    units: -142,
    cost: 486_200_000,
    residual: 0,
    status: "POSTED",
    note: "Month-end count variance",
  },
  {
    adj_id: "ADJ-2",
    on: "2026-07-19",
    unit_id: "C006",
    kind: "DAMAGE",
    reference: "BA/C006/26-07/03",
    units: -38,
    cost: 128_400_000,
    residual: 32_100_000,
    status: "POSTED",
    note: "Water damage, moved to disposed",
  },
  {
    adj_id: "ADJ-3",
    on: "2026-07-25",
    unit_id: "C004",
    kind: "SHRINKAGE",
    reference: "BA/C004/26-07/01",
    units: -21,
    cost: 71_300_000,
    residual: 0,
    status: "APPROVED",
  },
  {
    adj_id: "ADJ-4",
    on: "2026-07-30",
    unit_id: "C006",
    kind: "DISPOSAL",
    reference: "BA/C006/26-07/04",
    units: -104,
    cost: 289_000_000,
    residual: 60_000_000,
    status: "SUBMITTED",
    note: "Warehouse clearance, waiting on head office",
  },
]

// ---------------------------------------------------------------------------
// Interunit funding — 1021401/1021402/1021403 and 2012304
// ---------------------------------------------------------------------------

/// Head office putting money into a shop, or taking it back.
///
/// Three families do three different jobs and the client keeps them apart:
/// financing (cash), goods (stock sent), and principal (the owner's own
/// account). `2012304 Hutang Lain-lain` is the fourth, and it is the payable
/// leg of the same relationships, which is why it is shown here rather than
/// among supplier bills — every one of its 196 accounts is named after a unit.
export interface InterunitMove {
  readonly move_id: string
  readonly on: Day
  readonly from_unit: string
  readonly to_unit: string
  readonly family: "FINANCING" | "GOODS" | "PRINCIPAL" | "OTHER"
  readonly reference: string
  readonly amount: Minor
  readonly settled: Minor
  readonly note?: string
}

export const INTERUNIT_MOVES: readonly InterunitMove[] = [
  {
    move_id: "IU-1",
    on: "2026-07-15",
    from_unit: "HO",
    to_unit: "C004",
    family: "FINANCING",
    reference: "TRSF AC C4 UNIT",
    amount: 2_500_500_000,
    settled: 0,
    note: "Funding for the air-conditioning install",
  },
  {
    move_id: "IU-2",
    on: "2026-07-15",
    from_unit: "HO",
    to_unit: "C004",
    family: "FINANCING",
    reference: "TRSF AC C4 PEMASANGAN",
    amount: 139_000_000,
    settled: 0,
  },
  {
    move_id: "IU-3",
    on: "2026-07-21",
    from_unit: "HO",
    to_unit: "C006",
    family: "GOODS",
    reference: "SJ/HO/26-07/0865",
    amount: 3_411_800_000,
    settled: 3_411_800_000,
  },
  {
    move_id: "IU-4",
    on: "2026-07-28",
    from_unit: "HO",
    to_unit: "C006",
    family: "GOODS",
    reference: "SJ/HO/26-07/0881",
    amount: 4_180_500_000,
    settled: 0,
  },
  {
    move_id: "IU-5",
    on: "2026-07-06",
    from_unit: "C006",
    to_unit: "HO",
    family: "FINANCING",
    reference: "SETORAN C006 26-07-06",
    amount: 3_590_600_000,
    settled: 3_590_600_000,
    note: "Takings remitted to head office",
  },
  {
    move_id: "IU-6",
    on: "2026-07-25",
    from_unit: "HO",
    to_unit: "C006",
    family: "OTHER",
    reference: "BEBAN BERSAMA 26-07",
    amount: 184_000_000,
    settled: 0,
    note: "Shared IT and audit cost allocated",
  },
  {
    move_id: "IU-7",
    on: "2026-07-31",
    from_unit: "C006",
    to_unit: "HO",
    family: "PRINCIPAL",
    reference: "MGT FEE 26-07",
    amount: 620_000_000,
    settled: 0,
    note: "Management fee for the month",
  },
]

// ---------------------------------------------------------------------------
// Assets & projects — 1021508 CIP, 1031802 pre-opening, 1021607 reserve
// ---------------------------------------------------------------------------

/// A fit-out in progress. Nothing depreciates until it opens.
export interface Project {
  readonly project_id: string
  readonly name: string
  readonly unit_id: string
  readonly started_on: Day
  readonly budget: Minor
  readonly spent: Minor
  readonly status: "OPEN" | "READY" | "CAPITALISED"
  readonly capitalised_on?: Day
  readonly note?: string
}

export const PROJECTS: readonly Project[] = [
  {
    project_id: "PRJ-1",
    name: "Renovasi lantai 2 C006",
    unit_id: "C006",
    started_on: "2026-05-12",
    budget: 8_500_000_000,
    spent: 6_120_400_000,
    status: "OPEN",
  },
  {
    project_id: "PRJ-2",
    name: "New store C014 — Sarolangun",
    unit_id: "HO",
    started_on: "2026-04-01",
    budget: 42_000_000_000,
    spent: 38_940_000_000,
    status: "READY",
    note: "Waiting on an opening date to capitalise",
  },
  {
    project_id: "PRJ-3",
    name: "Air-conditioning install C004",
    unit_id: "C004",
    started_on: "2026-07-15",
    budget: 2_700_000_000,
    spent: 2_639_500_000,
    status: "CAPITALISED",
    capitalised_on: "2026-07-31",
  },
]

/// Pre-opening cost, and how much of it has been amortised.
///
/// `1031802` carries both the cost and its accumulated amortisation, which is
/// what makes it a deferred asset rather than a cost somebody forgot to book.
export interface PreOpening {
  readonly id: string
  readonly unit_id: string
  readonly opened_on: Day
  readonly cost: Minor
  readonly months: number
  readonly amortised_months: number
  readonly account: string
}

export const PRE_OPENING: readonly PreOpening[] = [
  {
    id: "PO-1",
    unit_id: "C013",
    opened_on: "2025-11-01",
    cost: 1_840_000_000,
    months: 36,
    amortised_months: 9,
    account: "103180200113",
  },
  {
    id: "PO-2",
    unit_id: "C012",
    opened_on: "2024-08-01",
    cost: 1_560_000_000,
    months: 36,
    amortised_months: 24,
    account: "103180200112",
  },
  {
    id: "PO-3",
    unit_id: "C006",
    opened_on: "2023-03-01",
    cost: 2_210_000_000,
    months: 36,
    amortised_months: 36,
    account: "103180200106",
  },
]

/// Money set aside against a cost that has not been incurred.
///
/// Two live ones in this client's chart: `1021607 Cadangan Penggantian OE`,
/// and the doubtful-debt allowance. The reserve is the interesting one — their
/// July journal has fifteen operating-equipment rows worth about Rp190m and
/// *no* posting to the reserve account, so whatever the manual says, they are
/// not accruing it monthly. Shown as a provision with a zero movement rather
/// than hidden, because a reserve nobody funds is a finding.
export interface Provision {
  readonly id: string
  readonly name: string
  readonly account: string
  readonly unit_id: string
  readonly opening: Minor
  readonly charged: Minor
  readonly used: Minor
  readonly basis: string
}

export const PROVISIONS: readonly Provision[] = [
  {
    id: "PV-1",
    name: "Cadangan Penggantian OE",
    account: "102160700106",
    unit_id: "C006",
    opening: 0,
    charged: 0,
    used: 0,
    basis:
      "Never funded — the 15 operating-equipment rows in July 2026 were expensed direct",
  },
  {
    id: "PV-2",
    name: "Cadangan Penggantian OE",
    account: "102160700104",
    unit_id: "C004",
    opening: 0,
    charged: 0,
    used: 0,
    basis: "Never funded",
  },
  {
    id: "PV-3",
    name: "Penyisihan piutang ragu-ragu",
    account: "101110900106",
    unit_id: "C006",
    opening: 120_000_000,
    charged: 0,
    used: 0,
    basis: "Card receivables over 30 days",
  },
]

// ---------------------------------------------------------------------------
// Equity — 3013001
// ---------------------------------------------------------------------------

/// A movement on the owner's account.
///
/// Retained earnings and the running result are marked `SYSTEM` because they
/// are produced by the close, not entered: showing them beside the two an
/// owner actually causes — capital in, drawings out — is what makes the
/// difference visible.
export interface EquityMove {
  readonly id: string
  readonly on: Day
  readonly kind:
    | "Modal Setor"
    | "Prive"
    | "Laba (Rugi) Ditahan"
    | "Laba (Rugi) bulan berjalan"
  readonly account: string
  readonly unit_id: string
  readonly amount: Minor
  readonly origin: "OWNER" | "SYSTEM"
  readonly note?: string
}

export const EQUITY_MOVES: readonly EquityMove[] = [
  {
    id: "EQ-1",
    on: "2026-07-01",
    kind: "Modal Setor",
    account: "301300100106",
    unit_id: "C006",
    amount: 124_840_000_000,
    origin: "OWNER",
    note: "Opening balance at cutover",
  },
  {
    id: "EQ-2",
    on: "2026-07-12",
    kind: "Prive",
    account: "301300100400",
    unit_id: "HO",
    amount: -1_500_000_000,
    origin: "OWNER",
    note: "Owner drawing",
  },
  {
    id: "EQ-3",
    on: "2026-07-26",
    kind: "Prive",
    account: "301300100400",
    unit_id: "HO",
    amount: -2_000_000_000,
    origin: "OWNER",
  },
  {
    id: "EQ-4",
    on: "2026-07-31",
    kind: "Laba (Rugi) bulan berjalan",
    account: "301300100300",
    unit_id: "HO",
    amount: 4_182_900_000,
    origin: "SYSTEM",
    note: "Produced by the July 2026 close",
  },
  {
    id: "EQ-5",
    on: "2026-06-30",
    kind: "Laba (Rugi) Ditahan",
    account: "301300100200",
    unit_id: "HO",
    amount: 28_400_000_000,
    origin: "SYSTEM",
    note: "Accumulated to June 2026",
  },
]

// ---------------------------------------------------------------------------
// Revenue that is not a sale — 4020110
// ---------------------------------------------------------------------------

export interface OtherRevenue {
  readonly id: string
  readonly on: Day
  readonly kind: string
  readonly account: string
  readonly unit_id: string
  readonly counterparty: string
  readonly amount: Minor
}

export const OTHER_REVENUE: readonly OtherRevenue[] = [
  {
    id: "OR-1",
    on: "2026-07-31",
    kind: "Management fee",
    account: "402011000106",
    unit_id: "HO",
    counterparty: "C006",
    amount: 620_000_000,
  },
  {
    id: "OR-2",
    on: "2026-07-31",
    kind: "Management fee",
    account: "402011000104",
    unit_id: "HO",
    counterparty: "C004",
    amount: 480_000_000,
  },
  {
    id: "OR-3",
    on: "2026-07-31",
    kind: "Bunga bank",
    account: "402010100106",
    unit_id: "C006",
    counterparty: "Bank BCA",
    amount: 428_300,
  },
]

// ---------------------------------------------------------------------------
// Tax — 1011302 prepaid against 2012101 payable
// ---------------------------------------------------------------------------

/// One tax, on whichever side of the balance sheet it currently sits.
///
/// The client keeps both: `1011302 PREPAID TAX` carries PPh 21/25/29, VAT
/// Masukan and PBB, and `2012101 HUTANG PAJAK` carries PPh 21, PPh 23
/// withheld, VAT Keluaran, PBB and PPh 25. A screen showing one side would
/// answer the wrong question every other month — VAT in particular is a
/// *position*, input against output, and whether it is an asset or a liability
/// is the answer, not the input.
export interface TaxPosition {
  readonly id: string
  readonly kind: string
  readonly period: string
  readonly unit_id: string
  readonly prepaid_account?: string
  readonly payable_account?: string
  /// Paid in advance or withheld from us — an asset.
  readonly prepaid: Minor
  /// Collected or withheld by us and owed on — a liability.
  readonly payable: Minor
  readonly due_on: Day
  readonly filed_on?: Day
}

export const TAX_POSITIONS: readonly TaxPosition[] = [
  {
    id: "TX-1",
    kind: "PPN — Masukan vs Keluaran",
    period: "2026-07",
    unit_id: "HO",
    prepaid_account: "101130200400",
    payable_account: "201210100300",
    prepaid: 4_820_400_000,
    payable: 6_142_900_000,
    due_on: "2026-08-31",
  },
  {
    id: "TX-2",
    kind: "PPh Pasal 21",
    period: "2026-07",
    unit_id: "HO",
    payable_account: "201210100100",
    prepaid: 0,
    payable: 214_000_000,
    due_on: "2026-08-10",
  },
  {
    id: "TX-3",
    kind: "PPh Pasal 23 dipotong",
    period: "2026-07",
    unit_id: "HO",
    payable_account: "201210100200",
    prepaid: 0,
    payable: 38_400_000,
    due_on: "2026-08-10",
  },
  {
    id: "TX-4",
    kind: "PPh Pasal 25",
    period: "2026-07",
    unit_id: "C006",
    prepaid_account: "101130200206",
    payable_account: "201210100506",
    prepaid: 0,
    payable: 125_000_000,
    due_on: "2026-08-15",
  },
  {
    id: "TX-5",
    kind: "PPh Pasal 25",
    period: "2026-06",
    unit_id: "C006",
    prepaid_account: "101130200206",
    payable_account: "201210100506",
    prepaid: 125_000_000,
    payable: 0,
    due_on: "2026-07-15",
    filed_on: "2026-07-14",
  },
  {
    id: "TX-6",
    kind: "PBB",
    period: "2026",
    unit_id: "C006",
    prepaid_account: "101130200506",
    payable_account: "201210100406",
    prepaid: 18_400_000,
    payable: 0,
    due_on: "2026-09-30",
  },
  {
    id: "TX-7",
    kind: "PPh Pasal 29 — kurang bayar tahunan",
    period: "2025",
    unit_id: "HO",
    prepaid_account: "101130200300",
    prepaid: 640_000_000,
    payable: 0,
    due_on: "2026-04-30",
    filed_on: "2026-04-28",
  },
]

// ---------------------------------------------------------------------------
// Financing — the schedule behind a loan
// ---------------------------------------------------------------------------

/// One month of a loan. Interest and principal kept apart because only one of
/// them is a cost, and only one of them reduces the liability.
export interface LoanPeriod {
  readonly loan_id: string
  readonly n: number
  readonly due_on: Day
  readonly interest: Minor
  readonly principal: Minor
  readonly balance_after: Minor
  readonly paid_on?: Day
}

/// Amortise `L-1` — Rp2,500,000,000 over 60 months at 10.5%, straight
/// principal with interest on the reducing balance, which is how this client's
/// facility is written.
export const LOAN_SCHEDULE: readonly LoanPeriod[] = (() => {
  const principal = 250_000_000_000
  const months = 60
  const rate = 1050 / 10_000 / 12
  const perMonth = Math.round(principal / months / 100) * 100
  const out: LoanPeriod[] = []
  let balance = principal
  for (let n = 1; n <= months; n++) {
    const interest = Math.round((balance * rate) / 100) * 100
    balance -= perMonth
    const d = new Date(2024, 2 + n, 1)
    const due = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`
    out.push({
      loan_id: "L-1",
      n,
      due_on: due,
      interest,
      principal: perMonth,
      balance_after: Math.max(0, balance),
      paid_on: n <= 29 ? due : undefined,
    })
  }
  return out
})()
