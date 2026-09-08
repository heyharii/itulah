/// Fixtures, all of them from the client's own two exports.
///
/// * `Laporan_Jurnal1 C006 JULY 2026.csv` — 13,339 lines, 2,187 documents,
///   45 accounts, every document balancing. The scenarios replay documents
///   from it by number.
/// * `MASTER ASSET.xls` — 1,342 rows, of which 46 are C006's.
///
/// Nothing here is invented except where it says so, and the two places it is
/// invented are labelled: the installation scenario (§10 B, which the plan
/// itself calls a simulation) and the ambiguous-binding scenario (§10 G, which
/// needs a fault that does not exist in the real map).
///
/// # The one thing this file establishes that neither source states
///
/// **Depreciation starts in the month of TGL BELI, not in the register's
/// PERIODE column, and the monthly charge is truncated.** That was an open
/// question. It is now answered by arithmetic: over C006's 46 register rows,
///
///     start at PERIODE  → 13 assets charging, Rp15,748,763
///     start at TGL BELI →  9 assets charging, Rp 4,683,970
///
/// and the client's own July entry `GL-26-07-00004` is Rp4,683,970 across
/// exactly those nine. The four that fall away are the ten-year assets bought
/// 2016-01-01 and filed under PERIODE 201702: on the purchase-date convention
/// their last month was December 2025.

import type { AssetFact, AssetTreatment, Book, Unit } from "./types"

export const BOOKS: readonly Book[] = [
  { book_id: "CFS", name: "Central Fashion Store", entity: "PT Central Fashion Store", currency: "IDR" },
]

export const UNITS: readonly Unit[] = [
  { unit_id: "HO", book_id: "CFS", name: "Head office", kind: "HO", coa_suffix: "00" },
  { unit_id: "C004", book_id: "CFS", name: "C004", kind: "STORE", coa_suffix: "04" },
  { unit_id: "C006", book_id: "CFS", name: "C006 Wiramode Muara Bungo", kind: "STORE", coa_suffix: "06" },
]

/// One register row, as the client keeps it.
///
/// `register_on` is the PERIODE column — the month the asset module files the
/// addition under, which since June 2026 is the first of a month. It is kept
/// because §4 asks for it and because it is what their own report groups by;
/// it is NOT what the schedule starts from.
interface Row {
  readonly n: number
  readonly name: string
  readonly cls: string
  readonly cost: number
  readonly life: number
  readonly bought: string
  readonly registered: string
  readonly method: string
  readonly qty: number
}

const rows: Row[] = []
function a(
  n: number,
  name: string,
  cls: string,
  cost: number,
  life: number,
  bought: string,
  registered: string,
  method: string,
  qty: number
) {
  rows.push({ n, name, cls, cost, life, bought, registered, method, qty })
}

a(1, "GENSET", "OTHER_GENSET", 20300000000, 120, "2016-01-01", "2017-02-01", "STRAIGHT LINE", 1)
a(2, "INSTALASI MEKANIKAL ELEKTRIKAL", "OTHER_INSTALASI_MEKANIKAL_ELEKTRIKAL", 16697150000, 120, "2016-01-01", "2017-02-01", "STRAIGHT LINE", 1)
a(3, "AIR CONDITIONER", "OTHER_AIR_CONDITION", 44700000000, 120, "2016-01-01", "2017-02-01", "STRAIGHT LINE", 1)
a(4, "EXTERIOR", "FFE_EXTERIOR", 37648800000, 60, "2016-01-01", "2017-02-01", "STRAIGHT LINE", 1)
a(5, "INTERIOR", "FFE_INTERIOR", 20255335600, 60, "2016-01-01", "2017-02-01", "STRAIGHT LINE", 1)
a(6, "BANGUNAN TAMBAHAN", "OTHER_BANGUNAN_TAMBAHAN", 51080376500, 120, "2016-01-01", "2017-02-01", "STRAIGHT LINE", 1)
a(7, "TEMPAT SAMPAH", "FFE_TOKO", 662900000, 60, "2016-02-01", "2017-02-01", "STRAIGHT LINE", 1)
a(8, "PERALATAN KANTOR", "FFE_OFFICE", 279800000, 60, "2016-03-22", "2017-02-01", "STRAIGHT LINE", 1)
a(9, "TV PANASONIC", "FFE_OFFICE", 285000000, 60, "2016-03-22", "2017-02-01", "STRAIGHT LINE", 1)
a(10, "TAS BELANJA", "OE_RAK_1", 114750000, 60, "2016-04-01", "2017-02-01", "NON DEPRECIABLE", 1)
a(11, "PATUNG FULL BODY DEWASA", "OE_RAK_1", 2072400000, 60, "2016-04-01", "2017-02-01", "NON DEPRECIABLE", 1)
a(12, "PAJANGAN GANTUNGAN", "OE_RAK_1", 13770000000, 60, "2016-04-01", "2017-02-01", "NON DEPRECIABLE", 1)
a(13, "RAK", "OE_RAK_1", 2000000000, 60, "2016-04-01", "2017-02-01", "NON DEPRECIABLE", 1)
a(14, "PERALATAN KASIR", "FFE_KOMPUTER", 4293000000, 60, "2016-04-01", "2017-02-01", "STRAIGHT LINE", 1)
a(15, "PRINTER", "FFE_KOMPUTER", 237000000, 60, "2016-04-01", "2017-02-01", "STRAIGHT LINE", 1)
a(16, "PC", "FFE_KOMPUTER", 1100000000, 60, "2016-04-01", "2017-02-01", "STRAIGHT LINE", 1)
a(17, "CCTV", "FFE_KOMPUTER", 3191200000, 60, "2016-04-01", "2017-02-01", "STRAIGHT LINE", 1)
a(18, "LOKER", "FFE_TOKO", 119133300, 60, "2016-04-01", "2017-02-01", "STRAIGHT LINE", 1)
a(19, "LOGO WIRA MODE", "FFE_TOKO", 674700000, 60, "2016-04-01", "2017-02-01", "STRAIGHT LINE", 1)
a(20, "KURSI", "FFE_TOKO", 694076800, 60, "2016-04-01", "2017-02-01", "STRAIGHT LINE", 1)
a(21, "KACA", "FFE_TOKO", 148000000, 60, "2016-04-01", "2017-02-01", "STRAIGHT LINE", 1)
a(22, "BRANKAS", "FFE_OFFICE", 650000000, 60, "2016-04-08", "2017-02-01", "STRAIGHT LINE", 1)
a(23, "RAK", "OE_RAK_1", 998000000, 60, "2017-02-28", "2017-04-01", "NON DEPRECIABLE", 1)
a(24, "UPS", "FFE_KOMPUTER", 60200000, 60, "2017-03-16", "2018-04-01", "STRAIGHT LINE", 1)
a(25, "CUSTOMER DISPLAY", "FFE_KOMPUTER", 125000000, 60, "2017-05-22", "2017-07-01", "STRAIGHT LINE", 3)
a(26, "PAJANGAN SPM", "OE_RAK_1", 62500000, 60, "2017-08-31", "2017-10-01", "NON DEPRECIABLE", 1)
a(27, "FFE OFFICE", "FFE_OFFICE", 100000000, 60, "2018-08-08", "2018-10-01", "STRAIGHT LINE", 1)
a(28, "FFE TOKO DAN GUDANG", "FFE_TOKO", 100000000, 60, "2018-08-08", "2018-10-01", "STRAIGHT LINE", 1)
a(29, "RAK UNTUK C006", "OE_RAK_1", 330000000, 60, "2020-03-16", "2020-05-01", "NON DEPRECIABLE", 1)
a(30, "RAK UNTUK C006", "OE_RAK_1", 267100000, 60, "2020-03-17", "2020-05-01", "NON DEPRECIABLE", 1)
a(31, "HANGER BODY", "OE_RAK_1", 106666700, 60, "2020-03-24", "2020-06-01", "NON DEPRECIABLE", 1)
a(32, "RAK UNTUK C006", "OE_RAK_1", 316450000, 60, "2020-04-01", "2020-06-01", "NON DEPRECIABLE", 1)
a(33, "PAJANGAN", "OE_RAK_1", 120964800, 60, "2020-10-01", "2020-10-01", "NON DEPRECIABLE", 10)
a(34, "INTERIOR", "FFE_INTERIOR", 880000000, 60, "2020-10-01", "2020-10-01", "STRAIGHT LINE", 1)
a(35, "RAK BESI C6", "OE_RAK_1", 250000000, 60, "2021-04-12", "2021-04-01", "NON DEPRECIABLE", 1)
a(36, "PEKERJAAN KANOPI", "FFE_EXTERIOR", 8418069600, 60, "2021-11-15", "2021-12-01", "STRAIGHT LINE", 1)
a(37, "TELEVISI", "FFE_TOKO", 300000000, 60, "2022-02-25", "2022-03-01", "STRAIGHT LINE", 1)
a(38, "HANGER", "OE_RAK_1", 234000000, 60, "2022-04-19", "2022-05-01", "NON DEPRECIABLE", 1)
a(39, "KOMPUTER", "FFE_KOMPUTER", 2542300000, 60, "2022-06-20", "2022-07-01", "STRAIGHT LINE", 1)
a(40, "PRINTER", "FFE_KOMPUTER", 250000000, 60, "2022-08-02", "2022-08-01", "STRAIGHT LINE", 1)
a(41, "PARKIRAN", "FFE_EXTERIOR", 15973831000, 60, "2022-09-01", "2022-10-01", "STRAIGHT LINE", 1)
a(42, "INTERIOR", "FFE_INTERIOR", 260000000, 60, "2022-09-01", "2022-09-01", "STRAIGHT LINE", 1)
a(43, "PAJANGAN", "OE_RAK_1", 254296500, 60, "2022-09-01", "2022-09-01", "NON DEPRECIABLE", 24)
a(44, "SCANER BARCODE C6", "FFE_TOKO", 116730000, 60, "2023-02-01", "2023-03-01", "STRAIGHT LINE", 1)
a(45, "JET CLEANER C6", "FFE_TOKO", 110000000, 60, "2024-01-24", "2024-02-01", "STRAIGHT LINE", 1)
a(46, "SENSOR MEJA", "FFE_TOKO", 132910000, 60, "2026-01-26", "2026-02-01", "STRAIGHT LINE", 1)

/// C006's register, split into what GA knows and what Finance decided.
export const C006_ASSETS: readonly AssetFact[] = rows.map((r) => ({
  asset_id: `A-C006-${String(r.n).padStart(3, "0")}`,
  asset_number: `AST-C006-${String(r.n).padStart(4, "0")}`,
  name: r.name,
  unit_id: "C006",
  asset_class: r.cls,
  quantity: r.qty,
  document_on: r.bought,
  register_on: r.registered,
  location: "C006 Wiramode Muara Bungo",
  custodian: "Store manager C006",
  condition: "GOOD",
  photo_count: 0,
  status: "IN_SERVICE",
}))

/// What the client's own METHOD column says, translated once and only here.
///
/// `NON DEPRECIABLE` on an operating-equipment row does not mean the asset is
/// worthless-proof; it means the client does not call the charge depreciation.
/// The trap that costs money is believing it and stopping the charge — which
/// is why the translation is a named decision rather than a string comparison
/// scattered through the code.
///
/// Here every OE row becomes `charge: "NONE"`, and the reason is stated in the
/// treatment: no reserve rate has been confirmed and July charged nothing.
export const C006_TREATMENTS: readonly AssetTreatment[] = rows.map((r) => {
  const oe = r.method !== "STRAIGHT LINE"
  return {
    asset_id: `A-C006-${String(r.n).padStart(3, "0")}`,
    decision: "CAPITALISE" as const,
    book_id: "CFS",
    cost: r.cost,
    salvage: 0,
    life_months: r.life,
    method: oe ? ("NONE" as const) : ("STRAIGHT_LINE" as const),
    charge: oe ? ("NONE" as const) : ("DEPRECIATION" as const),
    // The convention the arithmetic proved: the month of purchase.
    in_service_on: r.bought,
    assessed_by: "imported from MASTER ASSET.xls",
    reason: oe
      ? "Operating equipment. The client's METHOD column says NON DEPRECIABLE and their July journal charged nothing for it. No reserve rate has been confirmed, so no monthly charge is raised."
      : "Straight line over the register's stated life, starting the month it was bought.",
  }
})

/// What the client actually charged for July 2026, line by line, so a replay
/// can be compared with it rather than with a total.
export const JULY_DEPRECIATION_ACTUAL: readonly {
  readonly account: string
  readonly name: string
  readonly amount: number
}[] = [
  { account: "701021400206", name: "Biaya Depresiasi FFE Toko Dan Gudang C006", amount: 5_000_000 },
  { account: "701021400206", name: "Biaya Depresiasi FFE Toko Dan Gudang C006", amount: 1_833_300 },
  { account: "701021400206", name: "Biaya Depresiasi FFE Toko Dan Gudang C006", amount: 2_215_100 },
  { account: "701021400206", name: "Biaya Depresiasi FFE Toko Dan Gudang C006", amount: 1_945_500 },
  { account: "701021400306", name: "Biaya Depresiasi FFE Komputer C006", amount: 4_166_600 },
  { account: "701021400306", name: "Biaya Depresiasi FFE Komputer C006", amount: 42_371_600 },
  { account: "701021400606", name: "Biaya Depresiasi FFE Interior C006", amount: 4_333_300 },
  { account: "701021400706", name: "Biaya Depresiasi FFE Exterior C006", amount: 140_301_100 },
  { account: "701021400706", name: "Biaya Depresiasi FFE Exterior C006", amount: 266_230_500 },
]

/// `GL-26-07-00004` totalled this. In minor units: Rp4,683,970.
export const JULY_DEPRECIATION_TOTAL = 468_397_000
