//! What the state takes, and what the company adds: PPh 21 and BPJS.
//!
//! # Law in code, rates in the database
//!
//! Two kinds of number live here, and they change at different speeds.
//!
//! * **The tax tables** — the three TER tables of PP 58/2023, the Pasal 17
//!   brackets of UU HPP, the PTKP amounts and *biaya jabatan*. They change by
//!   regulation, a few times a decade, and a wrong one is a wrong slip for
//!   every employee. They are constants below, each pinned by
//!   `tests/payroll_statutory_integration.rs` against the regulation's own
//!   figures.
//! * **The BPJS rates and wage caps** — [`BpjsRates`]. The JP cap moves every
//!   March, and JKK depends on the company's risk class. They are data, kept
//!   effective-dated in `statutory_rate` and edited by head office; the
//!   [`Default`] here is only the value a fresh database is seeded with.
//!
//! # Money
//!
//! Whole rupiah in `i64`, as everywhere in payroll. A rate is in *hundredths of
//! a percent* (`bp`): TER 1,75 % is `175`, JKK 0,24 % is `24`. Products are
//! taken in `i128` and truncated toward zero, which is how DJP's own worked
//! examples round a withholding.
//!
//! # The two months
//!
//! PMK 168/2023 splits the year:
//!
//! * every month but the last, PPh 21 is **gross × TER** for the employee's
//!   PTKP category — [`monthly_tax`];
//! * in the **last** month (December, or the month employment ends) it is the
//!   year's Pasal 17 tax on the year's *actual* income, minus what the other
//!   months withheld — [`final_tax`]. Nothing is annualised: PMK 168 dropped
//!   that, and the worked example in its explanation (Tuan R, K/0,
//!   Rp10.000.000 a month) is the first case in the integration test.
//!
//! # Who bears it
//!
//! [`TaxMethod`] is chosen per employee, as Talenta does:
//!
//! * `Gross` — withheld from the employee's pay;
//! * `GrossUp` — the company adds a *tunjangan PPh 21* exactly large enough to
//!   pay the tax on itself, then withholds the tax: net pay is untouched and
//!   the allowance is taxable income;
//! * `Netto` — the company pays the tax and it is not the employee's income.
//!
//! # Taxable gross
//!
//! PPh 21 is levied on more than the cash paid. The company's share of BPJS
//! Kesehatan, JKK and JKM counts as the employee's income (they are premiums
//! paid for the employee); the company's JHT and JP do not. So the taxable
//! gross of a month is cash earnings + those three — [`BpjsContribution::taxable_benefit`].

use super::identity::PtkpStatus;
use chrono::{Datelike, NaiveDate};
use pricing_engine::Money;
use serde::{Deserialize, Serialize};

/// Hundredths of a percent: `10_000` is 100 %.
const WHOLE_BP: i128 = 10_000;

fn share(amount: Money, bp: i64) -> Money {
    Money::new(((i128::from(amount.minor) * i128::from(bp)) / WHOLE_BP) as i64)
}

// ── PTKP and the TER category ───────────────────────────────────────────────

/// PTKP a year, UU HPP / PMK 101/2016: Rp54.000.000 for the taxpayer, plus
/// Rp4.500.000 if married and Rp4.500.000 for each dependant up to three.
pub fn ptkp_amount(ptkp: PtkpStatus) -> Money {
    let mut minor = 54_000_000;
    if ptkp.married() {
        minor += 4_500_000;
    }
    minor += 4_500_000 * i64::from(ptkp.dependants());
    Money::new(minor)
}

/// The TER table a PTKP status selects (PP 58/2023 Pasal 2 ayat (4)).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub enum TerCategory {
    /// TK/0, TK/1, K/0.
    A,
    /// TK/2, TK/3, K/1, K/2.
    B,
    /// K/3.
    C,
}

impl TerCategory {
    pub const fn of(ptkp: PtkpStatus) -> Self {
        match (ptkp.married(), ptkp.dependants()) {
            (false, 0 | 1) | (true, 0) => Self::A,
            (false, _) | (true, 1 | 2) => Self::B,
            (true, _) => Self::C,
        }
    }

    pub const fn as_str(self) -> &'static str {
        match self {
            Self::A => "A",
            Self::B => "B",
            Self::C => "C",
        }
    }

    /// The table: `(upper bound of monthly gross, rate)`, ascending. The last
    /// row has no upper bound.
    pub const fn table(self) -> &'static [(Option<i64>, i64)] {
        match self {
            Self::A => TER_A,
            Self::B => TER_B,
            Self::C => TER_C,
        }
    }
}

const M: i64 = 1_000_000;

/// Lampiran A, PP 58/2023 — 44 rows.
const TER_A: &[(Option<i64>, i64)] = &[
    (Some(5_400_000), 0),
    (Some(5_650_000), 25),
    (Some(5_950_000), 50),
    (Some(6_300_000), 75),
    (Some(6_750_000), 100),
    (Some(7_500_000), 125),
    (Some(8_550_000), 150),
    (Some(9_650_000), 175),
    (Some(10_050_000), 200),
    (Some(10_350_000), 225),
    (Some(10_700_000), 250),
    (Some(11_050_000), 300),
    (Some(11_600_000), 350),
    (Some(12_500_000), 400),
    (Some(13_750_000), 500),
    (Some(15_100_000), 600),
    (Some(16_950_000), 700),
    (Some(19_750_000), 800),
    (Some(24_150_000), 900),
    (Some(26_450_000), 1_000),
    (Some(28 * M), 1_100),
    (Some(30_050_000), 1_200),
    (Some(32_400_000), 1_300),
    (Some(35_400_000), 1_400),
    (Some(39_100_000), 1_500),
    (Some(43_850_000), 1_600),
    (Some(47_800_000), 1_700),
    (Some(51_400_000), 1_800),
    (Some(56_300_000), 1_900),
    (Some(62_200_000), 2_000),
    (Some(68_600_000), 2_100),
    (Some(77_500_000), 2_200),
    (Some(89 * M), 2_300),
    (Some(103 * M), 2_400),
    (Some(125 * M), 2_500),
    (Some(157 * M), 2_600),
    (Some(206 * M), 2_700),
    (Some(337 * M), 2_800),
    (Some(454 * M), 2_900),
    (Some(550 * M), 3_000),
    (Some(695 * M), 3_100),
    (Some(910 * M), 3_200),
    (Some(1_400 * M), 3_300),
    (None, 3_400),
];

/// Lampiran B, PP 58/2023 — 40 rows.
const TER_B: &[(Option<i64>, i64)] = &[
    (Some(6_200_000), 0),
    (Some(6_500_000), 25),
    (Some(6_850_000), 50),
    (Some(7_300_000), 75),
    (Some(9_200_000), 100),
    (Some(10_750_000), 150),
    (Some(11_250_000), 200),
    (Some(11_600_000), 250),
    (Some(12_600_000), 300),
    (Some(13_600_000), 400),
    (Some(14_950_000), 500),
    (Some(16_400_000), 600),
    (Some(18_450_000), 700),
    (Some(21_850_000), 800),
    (Some(26 * M), 900),
    (Some(27_700_000), 1_000),
    (Some(29_350_000), 1_100),
    (Some(31_450_000), 1_200),
    (Some(33_950_000), 1_300),
    (Some(37_100_000), 1_400),
    (Some(41_100_000), 1_500),
    (Some(45_800_000), 1_600),
    (Some(49_500_000), 1_700),
    (Some(53_800_000), 1_800),
    (Some(58_500_000), 1_900),
    (Some(64 * M), 2_000),
    (Some(71 * M), 2_100),
    (Some(80 * M), 2_200),
    (Some(93 * M), 2_300),
    (Some(109 * M), 2_400),
    (Some(129 * M), 2_500),
    (Some(163 * M), 2_600),
    (Some(211 * M), 2_700),
    (Some(374 * M), 2_800),
    (Some(459 * M), 2_900),
    (Some(555 * M), 3_000),
    (Some(704 * M), 3_100),
    (Some(957 * M), 3_200),
    (Some(1_405 * M), 3_300),
    (None, 3_400),
];

/// Lampiran C, PP 58/2023 — 41 rows.
const TER_C: &[(Option<i64>, i64)] = &[
    (Some(6_600_000), 0),
    (Some(6_950_000), 25),
    (Some(7_350_000), 50),
    (Some(7_800_000), 75),
    (Some(8_850_000), 100),
    (Some(9_800_000), 125),
    (Some(10_950_000), 150),
    (Some(11_200_000), 175),
    (Some(12_050_000), 200),
    (Some(12_950_000), 300),
    (Some(14_150_000), 400),
    (Some(15_550_000), 500),
    (Some(17_050_000), 600),
    (Some(19_500_000), 700),
    (Some(22_700_000), 800),
    (Some(26_600_000), 900),
    (Some(28_100_000), 1_000),
    (Some(30_100_000), 1_100),
    (Some(32_600_000), 1_200),
    (Some(35_400_000), 1_300),
    (Some(38_900_000), 1_400),
    (Some(43 * M), 1_500),
    (Some(47_400_000), 1_600),
    (Some(51_200_000), 1_700),
    (Some(55_800_000), 1_800),
    (Some(60_400_000), 1_900),
    (Some(66_700_000), 2_000),
    (Some(74_500_000), 2_100),
    (Some(83_200_000), 2_200),
    (Some(95_600_000), 2_300),
    (Some(110 * M), 2_400),
    (Some(134 * M), 2_500),
    (Some(169 * M), 2_600),
    (Some(221 * M), 2_700),
    (Some(390 * M), 2_800),
    (Some(463 * M), 2_900),
    (Some(561 * M), 3_000),
    (Some(709 * M), 3_100),
    (Some(965 * M), 3_200),
    (Some(1_419 * M), 3_300),
    (None, 3_400),
];

/// The TER rate for a month's gross: the first row whose bound it does not
/// exceed ("sampai dengan" includes the bound).
pub fn ter_rate(category: TerCategory, monthly_gross: Money) -> i64 {
    category
        .table()
        .iter()
        .find(|(upper, _)| upper.is_none_or(|upper| monthly_gross.minor <= upper))
        .map_or(3_400, |(_, rate)| *rate)
}

// ── Pasal 17 and the year ───────────────────────────────────────────────────

/// Pasal 17 ayat (1) huruf a, UU PPh as amended by UU HPP.
const PASAL_17: &[(Option<i64>, i64)] = &[
    (Some(60 * M), 500),
    (Some(250 * M), 1_500),
    (Some(500 * M), 2_500),
    (Some(5_000 * M), 3_000),
    (None, 3_500),
];

/// The Pasal 17 layers: `(upper bound of the year's taxable income, rate)`.
pub const fn pasal_17_layers() -> &'static [(Option<i64>, i64)] {
    PASAL_17
}

/// Tax on a year's taxable income, layer by layer.
pub fn pasal_17(taxable: Money) -> Money {
    let mut remaining = i128::from(taxable.minor.max(0));
    let mut floor = 0i128;
    let mut tax = 0i128;
    for (upper, bp) in PASAL_17 {
        if remaining <= 0 {
            break;
        }
        let width = upper.map_or(remaining, |upper| i128::from(upper) - floor);
        let slice = remaining.min(width);
        tax += slice * i128::from(*bp) / WHOLE_BP;
        remaining -= slice;
        floor += width;
    }
    Money::new(tax as i64)
}

/// *Biaya jabatan*: 5 % of gross, at most Rp500.000 for each month worked
/// (Rp6.000.000 a full year) — PMK 168/2023 Pasal 12.
pub fn biaya_jabatan(annual_gross: Money, months: u8) -> Money {
    let ceiling = Money::new(500_000 * i64::from(months.max(1)));
    share(annual_gross, 500).at_most(ceiling)
}

/// PKP is rounded down to the whole thousand before Pasal 17 is applied.
pub fn taxable_income(annual_net: Money, ptkp: PtkpStatus) -> Money {
    let above = (annual_net.minor - ptkp_amount(ptkp).minor).max(0);
    Money::new(above / 1_000 * 1_000)
}

// ── BPJS ────────────────────────────────────────────────────────────────────

/// The rates and wage caps in force. Seeded from the 2026 figures; head office
/// keeps them current in `statutory_rate`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct BpjsRates {
    /// BPJS Kesehatan, company share (4 %).
    pub kesehatan_company_bp: i64,
    /// BPJS Kesehatan, employee share (1 %).
    pub kesehatan_employee_bp: i64,
    /// The wage Kesehatan is levied on at most (Perpres 64/2020: Rp12.000.000).
    pub kesehatan_cap_minor: i64,
    /// Jaminan Hari Tua, company share (3,7 %).
    pub jht_company_bp: i64,
    /// Jaminan Hari Tua, employee share (2 %).
    pub jht_employee_bp: i64,
    /// Jaminan Pensiun, company share (2 %).
    pub jp_company_bp: i64,
    /// Jaminan Pensiun, employee share (1 %).
    pub jp_employee_bp: i64,
    /// The wage JP is levied on at most; revised every March (Rp11.086.300
    /// from March 2026).
    pub jp_cap_minor: i64,
    /// Jaminan Kecelakaan Kerja, company only; by risk class (0,24 % very low).
    pub jkk_bp: i64,
    /// Jaminan Kematian, company only (0,3 %).
    pub jkm_bp: i64,
}

impl Default for BpjsRates {
    fn default() -> Self {
        Self {
            kesehatan_company_bp: 400,
            kesehatan_employee_bp: 100,
            kesehatan_cap_minor: 12_000_000,
            jht_company_bp: 370,
            jht_employee_bp: 200,
            jp_company_bp: 200,
            jp_employee_bp: 100,
            jp_cap_minor: 11_086_300,
            jkk_bp: 24,
            jkm_bp: 30,
        }
    }
}

/// Which programmes an employee is enrolled in. Enrolment is read off the
/// payroll identity: a BPJS Kesehatan number enrols Kesehatan, a BPJS
/// Ketenagakerjaan number enrols JHT, JP, JKK and JKM. Nobody is charged for a
/// programme payroll cannot show they belong to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Enrolment {
    pub kesehatan: bool,
    pub ketenagakerjaan: bool,
}

/// One month's contributions, each side.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize)]
pub struct BpjsContribution {
    /// The wage contributions are levied on: base plus fixed allowances.
    pub wage: Money,
    pub kesehatan_base: Money,
    pub jp_base: Money,
    pub kesehatan_employee: Money,
    pub kesehatan_company: Money,
    pub jht_employee: Money,
    pub jht_company: Money,
    pub jp_employee: Money,
    pub jp_company: Money,
    pub jkk_company: Money,
    pub jkm_company: Money,
}

impl BpjsContribution {
    /// What is taken from the employee's pay.
    pub fn employee_total(&self) -> Money {
        Money::new(self.kesehatan_employee.minor + self.jht_employee.minor + self.jp_employee.minor)
    }

    /// The employee's own pension contributions, deductible from gross in the
    /// year's tax (*iuran pensiun / JHT*).
    pub fn pension_contribution(&self) -> Money {
        Money::new(self.jht_employee.minor + self.jp_employee.minor)
    }

    /// The company's premiums that are the employee's income for PPh 21.
    pub fn taxable_benefit(&self) -> Money {
        Money::new(self.kesehatan_company.minor + self.jkk_company.minor + self.jkm_company.minor)
    }
}

pub fn bpjs(wage: Money, rates: &BpjsRates, enrolment: Enrolment) -> BpjsContribution {
    let mut out = BpjsContribution {
        wage,
        ..BpjsContribution::default()
    };
    if enrolment.kesehatan {
        out.kesehatan_base = wage.at_most(Money::new(rates.kesehatan_cap_minor));
        out.kesehatan_employee = share(out.kesehatan_base, rates.kesehatan_employee_bp);
        out.kesehatan_company = share(out.kesehatan_base, rates.kesehatan_company_bp);
    }
    if enrolment.ketenagakerjaan {
        out.jp_base = wage.at_most(Money::new(rates.jp_cap_minor));
        out.jht_employee = share(wage, rates.jht_employee_bp);
        out.jht_company = share(wage, rates.jht_company_bp);
        out.jp_employee = share(out.jp_base, rates.jp_employee_bp);
        out.jp_company = share(out.jp_base, rates.jp_company_bp);
        out.jkk_company = share(wage, rates.jkk_bp);
        out.jkm_company = share(wage, rates.jkm_bp);
    }
    out
}

// ── PPh 21 for one month ────────────────────────────────────────────────────

/// Who bears the tax, per employee.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub enum TaxMethod {
    #[default]
    Gross,
    GrossUp,
    Netto,
}

impl TaxMethod {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Gross => "GROSS",
            Self::GrossUp => "GROSS_UP",
            Self::Netto => "NETTO",
        }
    }

    pub fn parse(raw: &str) -> Option<Self> {
        match raw.trim().to_uppercase().as_str() {
            "GROSS" => Some(Self::Gross),
            "GROSS_UP" | "GROSS UP" | "GROSSUP" => Some(Self::GrossUp),
            "NETTO" | "NET" => Some(Self::Netto),
            _ => None,
        }
    }
}

/// A month's PPh 21, worked out.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct MonthTax {
    /// The taxable gross the rate was applied to, *including* a gross-up
    /// allowance.
    pub taxable_gross: Money,
    /// The TER rate applied (`None` in the last month, which uses Pasal 17).
    pub ter_rate_bp: Option<i64>,
    /// The tax for the month. Negative only in a last month, when the other
    /// months withheld more than the year owes: the excess goes back to the
    /// employee.
    pub tax: Money,
    /// The *tunjangan PPh 21* a gross-up adds (zero otherwise).
    pub allowance: Money,
    /// The year's tax, in a last month.
    pub annual_tax: Option<Money>,
}

/// A fixed point of `allowance = tax(gross + allowance)`, found by iteration.
///
/// The tax is monotone and rises by less than the allowance does, so the
/// sequence climbs and settles in a few steps; at a bracket edge it can settle
/// on either side, and the larger allowance is kept so the tax is always
/// covered.
fn gross_up(tax_on: impl Fn(Money) -> Money, gross: Money) -> Money {
    let mut allowance = Money::ZERO;
    for _ in 0..64 {
        let next = tax_on(Money::new(gross.minor + allowance.minor)).floor_at_zero();
        if next == allowance {
            return allowance;
        }
        if next.minor < allowance.minor {
            // Crossed a bracket edge downward: the smaller allowance no longer
            // covers the tax on itself, the larger one does. Keep the larger.
            return allowance;
        }
        allowance = next;
    }
    allowance
}

/// PPh 21 in every month but the last: `taxable gross × TER`.
pub fn monthly_tax(category: TerCategory, taxable_gross: Money, method: TaxMethod) -> MonthTax {
    let tax_on = |gross: Money| share(gross, ter_rate(category, gross));
    let allowance = match method {
        TaxMethod::GrossUp => gross_up(tax_on, taxable_gross),
        TaxMethod::Gross | TaxMethod::Netto => Money::ZERO,
    };
    let gross = Money::new(taxable_gross.minor + allowance.minor);
    let rate = ter_rate(category, gross);
    MonthTax {
        taxable_gross: gross,
        ter_rate_bp: Some(rate),
        tax: share(gross, rate),
        allowance,
        annual_tax: None,
    }
}

/// What the earlier months of the tax year came to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct YearToDate {
    /// Taxable gross of the earlier months, gross-up allowances included.
    pub taxable_gross: Money,
    /// The employee's JHT + JP of those months.
    pub pension_contribution: Money,
    /// PPh 21 already withheld (or borne) in those months.
    pub tax: Money,
    /// How many earlier months have a slip.
    pub months: u8,
}

/// The year's tax on the year's gross.
pub fn annual_tax(ptkp: PtkpStatus, annual_gross: Money, pension: Money, months: u8) -> Money {
    let net = annual_gross.minor - biaya_jabatan(annual_gross, months).minor - pension.minor;
    pasal_17(taxable_income(Money::new(net), ptkp))
}

/// PPh 21 in the last month of the tax year: the year's Pasal 17 tax on its
/// actual gross, minus what the other months withheld.
pub fn final_tax(
    ptkp: PtkpStatus,
    earlier: YearToDate,
    taxable_gross: Money,
    pension_contribution: Money,
    method: TaxMethod,
) -> MonthTax {
    let months = earlier.months.saturating_add(1);
    let pension = Money::new(earlier.pension_contribution.minor + pension_contribution.minor);
    let owed_on = |this_month: Money| {
        let year = Money::new(earlier.taxable_gross.minor + this_month.minor);
        Money::new(annual_tax(ptkp, year, pension, months).minor - earlier.tax.minor)
    };
    let allowance = match method {
        TaxMethod::GrossUp => gross_up(&owed_on, taxable_gross),
        TaxMethod::Gross | TaxMethod::Netto => Money::ZERO,
    };
    let gross = Money::new(taxable_gross.minor + allowance.minor);
    let year = Money::new(earlier.taxable_gross.minor + gross.minor);
    let annual = annual_tax(ptkp, year, pension, months);
    MonthTax {
        taxable_gross: gross,
        ter_rate_bp: None,
        tax: Money::new(annual.minor - earlier.tax.minor),
        allowance,
        annual_tax: Some(annual),
    }
}

// ── THR ─────────────────────────────────────────────────────────────────────

/// Whole months of continuous service from `from` (the hire) to `to` (the
/// holiday): 5 January to 4 March is one month, to 5 March two.
pub fn service_months(from: NaiveDate, to: NaiveDate) -> i64 {
    if to < from {
        return 0;
    }
    let mut months = i64::from(to.year() - from.year()) * 12
        + i64::from(to.month()) - i64::from(from.month());
    if to.day() < from.day() {
        months -= 1;
    }
    months.max(0)
}

/// THR under Permenaker 6/2016: one month's wage after twelve months of
/// service, `months / 12` of it after at least one, nothing before. Returns
/// the amount and the months counted (at most twelve).
pub fn thr(wage: Money, service_months: i64) -> Option<(Money, i64)> {
    if service_months < 1 {
        return None;
    }
    let counted = service_months.min(12);
    let amount = (i128::from(wage.minor) * i128::from(counted)) / 12;
    Some((Money::new(amount as i64), counted))
}
