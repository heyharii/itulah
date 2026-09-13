/// The account map: which client account carries which meaning, here, now.
///
/// # The four defects in v0.1 this file fixes, and how
///
/// 1. **`BANK_CUSTODY` + `BCA` was ambiguous.** The client keeps a giro and a
///    savings account at each of BCA, Mandiri, BRI and BNI, so a dimension
///    that named the BANK could not choose between `Cash In Bank Giro Bank BCA
///    C006` and `Cash In Bank Tabungan Bank BCA C006`. Here the dimension is a
///    REGISTERED ACCOUNT — `BCA-TAB-C006` — and the registry below is what
///    connects that identity to the ledger code. Four banks × two products ×
///    three units and not one of them is ambiguous, because the identity is
///    the thing being bound.
///
/// 2. **Role names and binding keys did not match.** v0.1's rules selected on
///    `SALARY` while its bindings were filed under `GAJI_PEGAWAI`. Both sides
///    now use `AccountRole`, which is a closed union: a rule naming a role
///    that has no binding is a compile error on the role name and a resolve
///    refusal on the binding, and neither can be silent.
///
/// 3. **`ALLOWANCE_EXPENSE` had no binding at all.** It has one now — and the
///    evidence for it is specific: `C006-BKK-26-07-00046` pays
///    `GAJI PETUGAS LUAR` of Rp1,500,000 out of the payroll run and codes it
///    to `601031000306 Biaya Rumah Tangga C006`, not to salary. An outside
///    attendant is not on the payroll and the client's own document says where
///    it goes.
///
/// 4. **Bindings had no validity and no version.** Every row here carries
///    `valid_from`, an optional `valid_to` and a `version`. A correction is a
///    new row, not an edit — which is what lets `poster.reverse` use the
///    ORIGINAL entry's accounts and still be explicable a year later.
///
/// # What a binding is not
///
/// It is not a default. `resolve` refuses on nothing found and refuses on more
/// than one found, and both refusals name the role and the dimensions. An
/// invented account is a mistake that balances, which is the kind that
/// survives a year.

import { CHART } from "./chart"
import type { AccountRole, BankAccount, Binding } from "./types"

// ---------------------------------------------------------------------------
// The registered bank accounts
// ---------------------------------------------------------------------------

/// Every bank account the books know, with its identity separate from its
/// bank. `number_masked` is a placeholder: the prototype never holds a real
/// account number, and the fixtures are the client's journal, which does not
/// carry them either.
/// Derived from the chart, not typed by hand.
///
/// The client keeps FIVE banks × TWO products × FOURTEEN units = 140 bank leaf
/// accounts, plus 42 cash accounts. Hand-listing them was fine while the
/// fixture held three units and would have been a lie about the shape of the
/// problem: at 140 a card per account is a wall, not a rail, and every screen
/// that touches money has to be scoped to a unit before it draws anything.
///
/// So the registry is generated from the chart's own `1011002` (giro) and
/// `1011003` (tabungan) families, which is where the truth already is.
function fromChart(): BankAccount[] {
  const out: BankAccount[] = []
  for (const a of CHART) {
    const family = a.code.slice(0, 7)
    if (family !== "1011002" && family !== "1011003" && family !== "1011004")
      continue
    if (!a.unit_id) continue
    const bank = (
      /Bank\s+(BCA|MANDIRI|BRI|BNI|DANAMON|BTN)/i.exec(a.name)?.[1] ?? "BCA"
    ).toUpperCase() as BankAccount["bank"]
    const product =
      family === "1011002"
        ? "GIRO"
        : family === "1011004"
          ? "DEPOSITO"
          : "TABUNGAN"
    out.push({
      bank_account_id: `${bank}-${product === "GIRO" ? "GIRO" : product === "DEPOSITO" ? "DEP" : "TAB"}-${a.unit_id}`,
      unit_id: a.unit_id,
      bank,
      product,
      number_masked: `•••• ${a.code.slice(-4)}`,
      label: a.name.replace("Cash In Bank ", ""),
    })
  }
  return out
}

const HAND_PICKED: readonly BankAccount[] = [
  {
    bank_account_id: "BCA-TAB-C006",
    unit_id: "C006",
    bank: "BCA",
    product: "TABUNGAN",
    number_masked: "•••• 1006",
    label: "BCA savings — C006",
  },
  {
    bank_account_id: "BCA-GIRO-C006",
    unit_id: "C006",
    bank: "BCA",
    product: "GIRO",
    number_masked: "•••• 2006",
    label: "BCA giro — C006",
  },
  {
    bank_account_id: "BNI-TAB-C006",
    unit_id: "C006",
    bank: "BNI",
    product: "TABUNGAN",
    number_masked: "•••• 4006",
    label: "BNI savings — C006",
  },
  {
    bank_account_id: "BCA-TAB-C004",
    unit_id: "C004",
    bank: "BCA",
    product: "TABUNGAN",
    number_masked: "•••• 1004",
    label: "BCA savings — C004",
  },
  {
    bank_account_id: "BCA-GIRO-C004",
    unit_id: "C004",
    bank: "BCA",
    product: "GIRO",
    number_masked: "•••• 2004",
    label: "BCA giro — C004",
  },
  {
    bank_account_id: "BCA-TAB-HO",
    unit_id: "HO",
    bank: "BCA",
    product: "TABUNGAN",
    number_masked: "•••• 1000",
    label: "BCA savings — HO",
  },
  {
    bank_account_id: "BCA-GIRO-HO",
    unit_id: "HO",
    bank: "BCA",
    product: "GIRO",
    number_masked: "•••• 2000",
    label: "BCA giro — HO",
  },
  {
    bank_account_id: "MANDIRI-GIRO-HO",
    unit_id: "HO",
    bank: "MANDIRI",
    product: "GIRO",
    number_masked: "•••• 3000",
    label: "Mandiri giro — HO",
  },
]

/// Every account the chart declares, with the hand-picked ones taking
/// precedence where the ids collide — those carry the labels the fixtures use.
export const BANK_ACCOUNTS: readonly BankAccount[] = (() => {
  const byId = new Map<string, BankAccount>()
  for (const a of fromChart()) byId.set(a.bank_account_id, a)
  for (const a of HAND_PICKED) byId.set(a.bank_account_id, a)
  return [...byId.values()].sort(
    (x, y) =>
      x.unit_id.localeCompare(y.unit_id) ||
      x.bank_account_id.localeCompare(y.bank_account_id)
  )
})()

/// The two rows v0.1 could not tell apart, kept next to each other so the
/// ambiguity scenario can point at something real. Scenario G registers a
/// second savings account at BCA for C006 with an overlapping validity and the
/// resolver refuses — that is the fault v0.1 would have posted through.
export const AMBIGUOUS_DEMO_BANK: BankAccount = {
  bank_account_id: "BCA-TAB-C006-OLD",
  unit_id: "C006",
  bank: "BCA",
  product: "TABUNGAN",
  number_masked: "•••• 9006",
  label: "BCA savings — C006 (closed, still mapped)",
}

// ---------------------------------------------------------------------------
// The map
// ---------------------------------------------------------------------------

let seq = 0
function bind(
  role: AccountRole,
  narrows: Binding["narrows"],
  account_code: string,
  note?: string,
  valid_from = "2016-01-01"
): Binding {
  seq += 1
  return {
    binding_id: `B-${String(seq).padStart(4, "0")}`,
    role,
    narrows,
    account_code,
    valid_from,
    version: 1,
    set_by: "finance-lab fixture",
    note,
  }
}

/// The client's asset families, by the name the register uses, mapped to the
/// ten-digit rung of the three parallel blocks. The suffix is the unit's.
///
/// Read off `MASTER ASSET.xls` and `Laporan_Master_Account1.csv` together:
/// `1021506 FURNITURE FIXTURE & EQUIPMENT` has the FFE classes,
/// `1021606` their accumulated depreciation and `7010214` their expense.
const FFE: readonly [cls: string, suffix: string][] = [
  ["FFE_OFFICE", "01"],
  ["FFE_TOKO", "02"],
  ["FFE_KOMPUTER", "03"],
  ["FFE_INTERIOR", "06"],
  ["FFE_EXTERIOR", "07"],
]

function ffeBindings(unit: string, u: string): Binding[] {
  const out: Binding[] = []
  for (const [cls, s] of FFE) {
    out.push(
      bind(
        "FIXED_ASSET",
        { unit_id: unit, asset_class: cls },
        `10215060${s}${u}`
      ),
      bind(
        "ACCUM_DEPRECIATION",
        { unit_id: unit, asset_class: cls },
        `10216060${s}${u}`
      ),
      bind(
        "DEPRECIATION_EXPENSE",
        { unit_id: unit, asset_class: cls },
        `70102140${s}${u}`
      )
    )
  }
  return out
}

/// Operating equipment. Bound for COST only.
///
/// `REPLACEMENT_RESERVE` is deliberately NOT bound, and that absence is the
/// design. The client's chart carries `1021607* Reserve Replacement` and
/// `7010215* Biaya Replacement` for thirty-six classes, and the presence of
/// those accounts is the entire evidence anybody has for a monthly reserve —
/// which is `COA_ONLY`, the weakest kind. The July 2026 journal for C006 posts
/// to neither, in a month where C006's register carries fifteen operating-
/// equipment rows worth about Rp190 million. The owner's own instruction says
/// the same thing: do not accrue a monthly reserve because the account exists.
///
/// So the reserve role resolves to nothing, the reserve rule is deactivated,
/// and the refusal names both. When the client confirms a rate, this is one
/// row and one activation.
function oeBindings(unit: string, u: string): Binding[] {
  return [
    bind(
      "OE_ASSET",
      { unit_id: unit, asset_class: "OE_RAK_1" },
      `1021507001${u}`
    ),
    bind(
      "REPLACEMENT_EXPENSE",
      { unit_id: unit, asset_class: "OE_RAK_1" },
      `7010215001${u}`
    ),
  ]
}

function unitBindings(unit: string, u: string, bankTab: string): Binding[] {
  return [
    bind("CASH_ON_HAND", { unit_id: unit }, `1011001001${u}`),
    bind("PETTY_CASH", { unit_id: unit }, `1011001002${u}`),
    bind("CASHIER_FLOAT", { unit_id: unit }, `1011001003${u}`),
    bind(
      "BANK",
      { unit_id: unit, bank_account_id: bankTab },
      `1011003001${u}`,
      "BCA savings"
    ),
    bind(
      "BANK",
      { unit_id: unit, bank_account_id: bankTab.replace("TAB", "GIRO") },
      `1011002001${u}`,
      "BCA giro"
    ),
    bind("INVENTORY", { unit_id: unit }, `1011201001${u}`),
    bind("COGS", { unit_id: unit }, `5010110001${u}`),
    bind("SALES_REVENUE_CASH", { unit_id: unit }, `4010110001${u}`),
    bind(
      "SALES_REVENUE_CARD",
      { unit_id: unit, acquirer: "BCA_DEBIT" },
      `4010111001${u}`
    ),
    bind("SALES_RETURN", { unit_id: unit }, `4010214001${u}`),
    bind(
      "CARD_RECEIVABLE",
      { unit_id: unit, acquirer: "BCA_DEBIT" },
      `1011101002${u}`
    ),
    bind("CARD_FEE", { unit_id: unit }, `6010110002${u}`),
    bind("SALARY_EXPENSE", { unit_id: unit }, `6010210001${u}`),
    bind("BENEFIT_EXPENSE", { unit_id: unit }, `6010210006${u}`),
    bind("SALARY_ACCRUAL", { unit_id: unit }, `2012201001${u}`),
    bind("BENEFIT_ACCRUAL", { unit_id: unit }, `2012201005${u}`),
    // Defect 3, closed. `GAJI PETUGAS LUAR` on C006-BKK-26-07-00046.
    bind(
      "ALLOWANCE_EXPENSE",
      { unit_id: unit },
      `6010310003${u}`,
      "Outside attendant pay — the client codes it to Biaya Rumah Tangga"
    ),
    bind("HOUSEKEEPING_EXPENSE", { unit_id: unit }, `6010310003${u}`),
    bind("BANK_CHARGE", { unit_id: unit }, `6010310004${u}`),
    bind("RENT_EXPENSE", { unit_id: unit }, `7010110003${u}`),
    bind("PREPAID_RENT", { unit_id: unit }, `1011301003${u}`),
    bind(
      "INTEREST_INCOME",
      { unit_id: unit },
      `8010110001${u}`,
      "Pendapatan Bunga Bank"
    ),
    bind(
      "EMPLOYEE_RECEIVABLE",
      { unit_id: unit },
      `1011102001${u}`,
      "Piutang Pegawai"
    ),
    // A store manager's balance is a PERSONAL loan at this client, confirmed —
    // not an operating float. It sits in receivables, not in cash.
    bind(
      "STORE_MANAGER_RECEIVABLE",
      { unit_id: unit },
      `1011102002${u}`,
      "Piutang Kepala Toko"
    ),
    bind(
      "OUTSTANDING_GIRO",
      { unit_id: unit },
      `2012002001${u}`,
      "Outstanding Giro Bank BCA"
    ),
    bind(
      "ROUNDING",
      { unit_id: unit },
      `6010310003${u}`,
      "The client rounds into Biaya Rumah Tangga, not into a rounding account"
    ),
    // Buying. The client's two payables are two accounts and therefore two
    // roles: a merchandise bill and the landlord's bill do not share a ledger
    // line, and the ageing reports that read them are two reports.
    bind(
      "VENDOR_PAYABLE",
      { unit_id: unit },
      `2012001003${u}`,
      "Hutang Supplier Non Barang Dagang"
    ),
    bind(
      "UTILITY_EXPENSE",
      { unit_id: unit },
      `6010310006${u}`,
      "Biaya Pemakaian Listrik — the family PLN, Telkom and PDAM are coded to"
    ),
    bind("ADVANCE", { unit_id: unit }, `1011303004${u}`, "Advanced - Others"),
    // Tax, per kind. `2012101` is five accounts and a payment names one of
    // them, so the role is narrowed rather than guessed.
    bind(
      "TAX_PAYABLE",
      { unit_id: unit, tax_kind: "PPH_21" },
      `2012101001${u}`
    ),
    bind(
      "TAX_PAYABLE",
      { unit_id: unit, tax_kind: "PPH_23" },
      `2012101002${u}`
    ),
    bind(
      "TAX_PAYABLE",
      { unit_id: unit, tax_kind: "VAT_OUT" },
      `2012101003${u}`
    ),
    bind("TAX_PAYABLE", { unit_id: unit, tax_kind: "PBB" }, `2012101004${u}`),
    bind(
      "TAX_PAYABLE",
      { unit_id: unit, tax_kind: "PPH_25" },
      `2012101005${u}`
    ),
    bind(
      "PREPAID_TAX",
      { unit_id: unit, tax_kind: "PPH_21" },
      `1011302001${u}`
    ),
    bind(
      "PREPAID_TAX",
      { unit_id: unit, tax_kind: "PPH_25" },
      `1011302002${u}`
    ),
    bind(
      "PREPAID_TAX",
      { unit_id: unit, tax_kind: "PPH_29" },
      `1011302003${u}`
    ),
    bind(
      "PREPAID_TAX",
      { unit_id: unit, tax_kind: "VAT_IN" },
      `1011302004${u}`
    ),
    bind("PREPAID_TAX", { unit_id: unit, tax_kind: "PBB" }, `1011302005${u}`),
    // Financing.
    bind(
      "BANK_LOAN",
      { unit_id: unit },
      `2022402001${u}`,
      "Pinjaman Jangka Panjang Bank BCA"
    ),
    bind(
      "LOAN_CURRENT",
      { unit_id: unit },
      `2012502001${u}`,
      "PJP Jatuh Tempo Bank BCA"
    ),
    bind(
      "INTEREST_EXPENSE",
      { unit_id: unit },
      `8020111001${u}`,
      "Biaya Bunga Pinjaman Bank"
    ),
    bind("PAID_IN_CAPITAL", { unit_id: unit }, `3013001001${u}`, "Modal Setor"),
    bind("DRAWINGS", { unit_id: unit }, `3013001004${u}`, "Prive"),
    // Long-lived costs that are not a fixed asset yet, or never will be.
    bind("CIP", { unit_id: unit }, `1031803001${u}`, "Contract In Progress"),
    bind("PRE_OPENING", { unit_id: unit }, `1031802001${u}`),
    bind(
      "ACCUM_AMORTISATION",
      { unit_id: unit },
      `1031802002${u}`,
      "Akumulasi Amortisasi Pre Opening"
    ),
    bind(
      "AMORTISATION_EXPENSE",
      { unit_id: unit },
      `7010216002${u}`,
      "Biaya Amortisasi Biaya Pre Opening"
    ),
    // Stock that leaves without a sale.
    bind(
      "INVENTORY_LOSS",
      { unit_id: unit },
      `6010310014${u}`,
      "Biaya Stock Opname — where the client codes a count difference"
    ),
    bind("DISPOSED_INVENTORY", { unit_id: unit }, `1031801001${u}`),
    ...ffeBindings(unit, u),
    ...oeBindings(unit, u),
  ]
}

/// Interunit, both legs, both directions.
///
/// The client keeps three separate pairs and they are NOT interchangeable —
/// this is the P0 open question in v0.1 and the July journal answers two-
/// thirds of it:
///
///   * `2012302 Hutang Affiliasi Atas Barang` — what a shop owes for GOODS.
///     Raised by every Surat Jalan Distribusi (147 of them in July) and
///     reduced by every takings deposit (23 BKK).
///   * `2012301 Hutang Affiliasi Pembiayaan` — FINANCING. Five BKK in July
///     repay it from the shop's bank.
///   * `2012303 Hutang Lain-lain Principal` — the principal's own money.
///     `C006-BKM-26-07-00003` receives the payroll float against it.
///
/// What the journal does NOT settle is the rule that picks between financing
/// and principal, so `funding_type` is an explicit field on the event and the
/// rule reads it. Guessing it is what the plan forbids.
function interunitBindings(
  unit: string,
  u: string,
  counter: string
): Binding[] {
  return [
    bind(
      "AFFILIATE_GOODS_PAYABLE",
      { unit_id: unit, counterparty_unit_id: counter },
      `2012302001${u}`
    ),
    bind(
      "AFFILIATE_FINANCING_PAYABLE",
      { unit_id: unit, counterparty_unit_id: counter },
      `2012301001${u}`
    ),
    bind(
      "PRINCIPAL_PAYABLE",
      { unit_id: unit, counterparty_unit_id: counter },
      `2012303001${u}`
    ),
    // The fourth family. Every one of its 196 accounts is named after a unit,
    // which is what makes it interunit rather than a general creditor.
    bind(
      "AFFILIATE_OTHER_PAYABLE",
      { unit_id: unit, counterparty_unit_id: counter },
      `2012304001${u}`
    ),
  ]
}

/// The fourteen units, and the two-digit suffix the client puts on the end of
/// every twelve-character leaf.
///
/// # Why all fourteen and not the three the scenarios use
///
/// Because the registers carry all fourteen. `PRE_OPENING` holds C013, and an
/// action on it was refused with "not activated for unit C013" — a rule that
/// works for a shop in Jambi and not for one in Wonosobo, for no reason except
/// which three units somebody typed first. The chart holds every account for
/// every unit and the suffix rule is theirs, so the bindings are generated
/// rather than listed.
const UNIT_SUFFIX: readonly [string, string][] = [
  ["HO", "00"],
  ["C001", "01"],
  ["C002", "02"],
  ["C003", "03"],
  ["C004", "04"],
  ["C005", "05"],
  ["C006", "06"],
  ["C007", "07"],
  ["C008", "08"],
  ["C009", "09"],
  ["C010", "10"],
  ["C011", "11"],
  ["C012", "12"],
  ["C013", "13"],
]

export const BINDINGS: readonly Binding[] = [
  ...UNIT_SUFFIX.flatMap(([unit, u]) =>
    unitBindings(unit, u, `BCA-TAB-${unit}`)
  ),
  bind(
    "BANK",
    { unit_id: "C006", bank_account_id: "BNI-TAB-C006" },
    "101100300406",
    "BNI savings"
  ),
  bind(
    "BANK",
    { unit_id: "HO", bank_account_id: "MANDIRI-GIRO-HO" },
    "101100200200",
    "Mandiri giro"
  ),
  ...UNIT_SUFFIX.filter(([unit]) => unit !== "HO").flatMap(([unit, u]) =>
    interunitBindings(unit, u, "HO")
  ),
  // Head office's side of the same three balances. Bound so the interunit
  // two-way check has something to compare against; the goods leg is a
  // receivable at HO and a payable at the shop, and one rule writes both.
  bind(
    "AFFILIATE_GOODS_RECEIVABLE",
    { unit_id: "HO", counterparty_unit_id: "C006" },
    "102140200100"
  ),
  bind(
    "AFFILIATE_FINANCING_RECEIVABLE",
    { unit_id: "HO", counterparty_unit_id: "C006" },
    "102140100100"
  ),
  bind(
    "PRINCIPAL_RECEIVABLE",
    { unit_id: "HO", counterparty_unit_id: "C006" },
    "102140300100"
  ),
  bind(
    "GOODS_IN_TRANSIT",
    { unit_id: "C006", counterparty_unit_id: "HO" },
    "101120300706"
  ),
  bind("SUPPLIER_PAYABLE", { unit_id: "HO" }, "201200100100"),
]

/// The roles a rule may name that have no binding at all, computed rather than
/// listed so it cannot go stale. The Account map screen opens on this.
export function unboundRoles(
  bindings: readonly Binding[],
  roles: readonly AccountRole[]
): readonly AccountRole[] {
  const bound = new Set(bindings.map((b) => b.role))
  return roles.filter((r) => !bound.has(r))
}
