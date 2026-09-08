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

import type { AccountRole, BankAccount, Binding } from "./types"

// ---------------------------------------------------------------------------
// The registered bank accounts
// ---------------------------------------------------------------------------

/// Every bank account the books know, with its identity separate from its
/// bank. `number_masked` is a placeholder: the prototype never holds a real
/// account number, and the fixtures are the client's journal, which does not
/// carry them either.
export const BANK_ACCOUNTS: readonly BankAccount[] = [
  { bank_account_id: "BCA-TAB-C006", unit_id: "C006", bank: "BCA", product: "TABUNGAN", number_masked: "•••• 1006", label: "BCA savings — C006" },
  { bank_account_id: "BCA-GIRO-C006", unit_id: "C006", bank: "BCA", product: "GIRO", number_masked: "•••• 2006", label: "BCA giro — C006" },
  { bank_account_id: "BNI-TAB-C006", unit_id: "C006", bank: "BNI", product: "TABUNGAN", number_masked: "•••• 4006", label: "BNI savings — C006" },
  { bank_account_id: "BCA-TAB-C004", unit_id: "C004", bank: "BCA", product: "TABUNGAN", number_masked: "•••• 1004", label: "BCA savings — C004" },
  { bank_account_id: "BCA-GIRO-C004", unit_id: "C004", bank: "BCA", product: "GIRO", number_masked: "•••• 2004", label: "BCA giro — C004" },
  { bank_account_id: "BCA-TAB-HO", unit_id: "HO", bank: "BCA", product: "TABUNGAN", number_masked: "•••• 1000", label: "BCA savings — HO" },
  { bank_account_id: "BCA-GIRO-HO", unit_id: "HO", bank: "BCA", product: "GIRO", number_masked: "•••• 2000", label: "BCA giro — HO" },
  { bank_account_id: "MANDIRI-GIRO-HO", unit_id: "HO", bank: "MANDIRI", product: "GIRO", number_masked: "•••• 3000", label: "Mandiri giro — HO" },
]

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
      bind("FIXED_ASSET", { unit_id: unit, asset_class: cls }, `10215060${s}${u}`),
      bind("ACCUM_DEPRECIATION", { unit_id: unit, asset_class: cls }, `10216060${s}${u}`),
      bind("DEPRECIATION_EXPENSE", { unit_id: unit, asset_class: cls }, `70102140${s}${u}`)
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
    bind("OE_ASSET", { unit_id: unit, asset_class: "OE_RAK_1" }, `1021507001${u}`),
    bind("REPLACEMENT_EXPENSE", { unit_id: unit, asset_class: "OE_RAK_1" }, `7010215001${u}`),
  ]
}

function unitBindings(unit: string, u: string, bankTab: string): Binding[] {
  return [
    bind("CASH_ON_HAND", { unit_id: unit }, `1011001001${u}`),
    bind("PETTY_CASH", { unit_id: unit }, `1011001002${u}`),
    bind("CASHIER_FLOAT", { unit_id: unit }, `1011001003${u}`),
    bind("BANK", { unit_id: unit, bank_account_id: bankTab }, `1011003001${u}`, "BCA savings"),
    bind("BANK", { unit_id: unit, bank_account_id: bankTab.replace("TAB", "GIRO") }, `1011002001${u}`, "BCA giro"),
    bind("INVENTORY", { unit_id: unit }, `1011201001${u}`),
    bind("COGS", { unit_id: unit }, `5010110001${u}`),
    bind("SALES_REVENUE_CASH", { unit_id: unit }, `4010110001${u}`),
    bind("SALES_REVENUE_CARD", { unit_id: unit, acquirer: "BCA_DEBIT" }, `4010111001${u}`),
    bind("SALES_RETURN", { unit_id: unit }, `4010214001${u}`),
    bind("CARD_RECEIVABLE", { unit_id: unit, acquirer: "BCA_DEBIT" }, `1011101002${u}`),
    bind("CARD_FEE", { unit_id: unit }, `6010110002${u}`),
    bind("SALARY_EXPENSE", { unit_id: unit }, `6010210001${u}`),
    bind("BENEFIT_EXPENSE", { unit_id: unit }, `6010210006${u}`),
    bind("SALARY_ACCRUAL", { unit_id: unit }, `2012201001${u}`),
    bind("BENEFIT_ACCRUAL", { unit_id: unit }, `2012201005${u}`),
    // Defect 3, closed. `GAJI PETUGAS LUAR` on C006-BKK-26-07-00046.
    bind("ALLOWANCE_EXPENSE", { unit_id: unit }, `6010310003${u}`, "Outside attendant pay — the client codes it to Biaya Rumah Tangga"),
    bind("HOUSEKEEPING_EXPENSE", { unit_id: unit }, `6010310003${u}`),
    bind("BANK_CHARGE", { unit_id: unit }, `6010310004${u}`),
    bind("RENT_EXPENSE", { unit_id: unit }, `7010110003${u}`),
    bind("PREPAID_RENT", { unit_id: unit }, `1011301003${u}`),
    bind("ROUNDING", { unit_id: unit }, `6010310003${u}`, "The client rounds into Biaya Rumah Tangga, not into a rounding account"),
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
function interunitBindings(unit: string, u: string, counter: string): Binding[] {
  return [
    bind("AFFILIATE_GOODS_PAYABLE", { unit_id: unit, counterparty_unit_id: counter }, `2012302001${u}`),
    bind("AFFILIATE_FINANCING_PAYABLE", { unit_id: unit, counterparty_unit_id: counter }, `2012301001${u}`),
    bind("PRINCIPAL_PAYABLE", { unit_id: unit, counterparty_unit_id: counter }, `2012303001${u}`),
  ]
}

export const BINDINGS: readonly Binding[] = [
  ...unitBindings("C006", "06", "BCA-TAB-C006"),
  ...unitBindings("C004", "04", "BCA-TAB-C004"),
  ...unitBindings("HO", "00", "BCA-TAB-HO"),
  bind("BANK", { unit_id: "C006", bank_account_id: "BNI-TAB-C006" }, "101100300406", "BNI savings"),
  bind("BANK", { unit_id: "HO", bank_account_id: "MANDIRI-GIRO-HO" }, "101100200200", "Mandiri giro"),
  ...interunitBindings("C006", "06", "HO"),
  ...interunitBindings("C004", "04", "HO"),
  // Head office's side of the same three balances. Bound so the interunit
  // two-way check has something to compare against; the goods leg is a
  // receivable at HO and a payable at the shop, and one rule writes both.
  bind("AFFILIATE_GOODS_RECEIVABLE", { unit_id: "HO", counterparty_unit_id: "C006" }, "102140200100"),
  bind("AFFILIATE_FINANCING_RECEIVABLE", { unit_id: "HO", counterparty_unit_id: "C006" }, "102140100100"),
  bind("PRINCIPAL_RECEIVABLE", { unit_id: "HO", counterparty_unit_id: "C006" }, "102140300100"),
  bind("GOODS_IN_TRANSIT", { unit_id: "C006", counterparty_unit_id: "HO" }, "101120300706"),
  bind("SUPPLIER_PAYABLE", { unit_id: "HO" }, "201200100100"),
]

/// The roles a rule may name that have no binding at all, computed rather than
/// listed so it cannot go stale. The Account map screen opens on this.
export function unboundRoles(bindings: readonly Binding[], roles: readonly AccountRole[]): readonly AccountRole[] {
  const bound = new Set(bindings.map((b) => b.role))
  return roles.filter((r) => !bound.has(r))
}
