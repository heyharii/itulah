/* Values read from the user-provided finance workbooks. Original files unchanged. */
window.FINANCE_REFERENCE = {
  "company": "Central Fashion Store",
  "period": "Januari–Desember 2025",
  "comparison": "2024",
  "scope": "Kompilasi unit sesuai workbook; eliminasi konsolidasi belum dibuktikan.",
  "source": [
    {
      "id": 0,
      "file": "Summary__Penjualan_Per_Divisi_by_Harga_HPP_rata20 ALL UNIT JANUARY - DECEMBER 2025 BY SERVER HO DATA 02012026.xls",
      "sheet": "GAPNO KH",
      "errors": {
        "#DIV/0!": 2
      }
    },
    {
      "id": 1,
      "file": "Laporan_Neraca_Central_2_Tahunan1 (1).xls",
      "sheet": "sheet1",
      "errors": {
        "#NULL!": 407
      }
    },
    {
      "id": 2,
      "file": "Laba_Rugi_GL_Per_Cabang_2_Tahunan1 (2).xls",
      "sheet": "sheet1",
      "errors": {
        "#NULL!": 527
      }
    },
    {
      "id": 3,
      "file": "Laporan_Neraca_Central_2_Tahunan1.xls",
      "sheet": "sheet1",
      "errors": {
        "#NULL!": 407
      }
    },
    {
      "id": 4,
      "file": "Laba_Rugi_GL_Per_Cabang_2_Tahunan1 KOMPILASI UNIT 2025 - 2024 BY SERVER UNIT UPDATE 12-01-2026.xls",
      "sheet": "sheet1",
      "errors": {
        "#REF!": 21,
        "#N/A": 65
      }
    }
  ],
  "pl": {
    "sales": {
      "label": "Penjualan bersih",
      "current": 103676066725.0,
      "prior": 105921194470.0,
      "ref": "F32:I32",
      "source": 4
    },
    "cogs": {
      "label": "Beban pokok penjualan",
      "current": 62327940507.33512,
      "prior": 63999543808.57548,
      "ref": "F34:I34",
      "source": 4
    },
    "gross": {
      "label": "Laba usaha kotor",
      "current": 41348126217.66488,
      "prior": 41921650661.42452,
      "ref": "F36:I36",
      "source": 4
    },
    "opex": {
      "label": "Beban usaha",
      "current": 20384704875.323547,
      "prior": 17821415592.568,
      "ref": "F38:I38",
      "source": 4
    },
    "grossOperating": {
      "label": "Gross operating profit",
      "current": 20963421342.34133,
      "prior": 24100235068.85652,
      "ref": "F123:I123",
      "source": 4
    },
    "otherOpex": {
      "label": "Beban usaha lainnya",
      "current": 9553489070.720001,
      "prior": 8677010209.39,
      "ref": "F125:I125",
      "source": 4
    },
    "netOperating": {
      "label": "Net operating profit",
      "current": 11409932271.62133,
      "prior": 15423224859.466522,
      "ref": "F208:I208",
      "source": 4
    },
    "nonOperating": {
      "label": "Pendapatan / biaya nonoperasi",
      "current": -236598165.25904,
      "prior": -129473192.63732,
      "ref": "F210:I210",
      "source": 4
    },
    "pretax": {
      "label": "Laba sebelum pajak",
      "current": 11173334106.36229,
      "prior": 15293751666.829203,
      "ref": "F224:I224",
      "source": 4
    },
    "tax": {
      "label": "Pajak penghasilan",
      "current": 153514428.0,
      "prior": 158136381.76000002,
      "ref": "F226:I226",
      "source": 4
    },
    "profit": {
      "label": "Laba setelah pajak",
      "current": 11019819678.36229,
      "prior": 15135615285.069202,
      "ref": "F229:I229",
      "source": 4
    }
  },
  "divisions": [
    {
      "code": "1",
      "name": "DIVISI WANITA",
      "quantity": 307074.0,
      "grossSales": 32510927200.000004,
      "discount": 260553250.00000003,
      "returns": 21530250.0,
      "net": 32228948450.000004,
      "cost": 19572131785.035862,
      "grossProfit": 12656816664.964142,
      "margin": 0.3927157811121244,
      "ref": "A11:L11"
    },
    {
      "code": "2",
      "name": "DIVISI PRIA",
      "quantity": 299772.0,
      "grossSales": 41010008500.0,
      "discount": 257135900.00000003,
      "returns": 83597500.0,
      "net": 40669354100.0,
      "cost": 24360761191.26791,
      "grossProfit": 16308592908.73209,
      "margin": 0.4010044730150285,
      "ref": "A12:L12"
    },
    {
      "code": "3",
      "name": "DIVISI ANAK LAKI-LAKI",
      "quantity": 130830.00000000001,
      "grossSales": 15368212500.000002,
      "discount": 97695200.00000001,
      "returns": 27596700.000000004,
      "net": 15242946400.000002,
      "cost": 9230374869.97666,
      "grossProfit": 6012571530.023342,
      "margin": 0.3944494307231403,
      "ref": "A13:L13"
    },
    {
      "code": "4",
      "name": "DIVISI ANAK PEREMPUAN",
      "quantity": 81530.0,
      "grossSales": 9165560400.0,
      "discount": 160145600.0,
      "returns": 9519000.0,
      "net": 8995895800.0,
      "cost": 5689693600.47322,
      "grossProfit": 3306202199.52678,
      "margin": 0.36752339878445234,
      "ref": "A14:L14"
    },
    {
      "code": "5",
      "name": "DIVISI PERLENGKAPAN BAYI",
      "quantity": 4872.0,
      "grossSales": 342649300.0,
      "discount": 2919200.0000000005,
      "returns": 294600.0,
      "net": 339458900.0,
      "cost": 205510487.95064,
      "grossProfit": 133948412.04936,
      "margin": 0.3945939023821735,
      "ref": "A15:L15"
    },
    {
      "code": "6",
      "name": "DIVISI SANDAL DAN SEPATU",
      "quantity": 25605.000000000004,
      "grossSales": 3313745750.0000005,
      "discount": 20605200.0,
      "returns": 6565500.000000001,
      "net": 3286575050.0000005,
      "cost": 2022956788.27358,
      "grossProfit": 1263618261.7264204,
      "margin": 0.38447874839383944,
      "ref": "A16:L16"
    },
    {
      "code": "7",
      "name": "DIVISI TAS",
      "quantity": 5899.000000000001,
      "grossSales": 1022096200.0000001,
      "discount": 12308200.000000002,
      "returns": 557000.0,
      "net": 1009231000.0000001,
      "cost": 610905351.66668,
      "grossProfit": 398325648.33332014,
      "margin": 0.39468233569254224,
      "ref": "A17:L17"
    },
    {
      "code": "8",
      "name": "DIVISI ACCESORIES",
      "quantity": 34498.0,
      "grossSales": 1131637750.0,
      "discount": 17462425.0,
      "returns": 510150.00000000006,
      "net": 1113677025.0,
      "cost": 625742889.51621,
      "grossProfit": 487934135.48379004,
      "margin": 0.4381289409142566,
      "ref": "A18:L18"
    },
    {
      "code": "9",
      "name": "NON DIVISI",
      "quantity": 31333.000000000004,
      "grossSales": 790639000.0000001,
      "discount": 12000.000000000002,
      "returns": 0.0,
      "net": 790627000.0000001,
      "cost": 60000.0,
      "grossProfit": 790567000.0000001,
      "margin": 0.9999241108639093,
      "ref": "A19:L19"
    }
  ],
  "divisionTotals": {
    "quantity": 921413.0,
    "grossSales": 104655476600.0,
    "discount": 828836975.0000001,
    "returns": 150170700.0,
    "net": 103676713725.0,
    "cost": 62318136964.16077,
    "grossProfit": 41358576760.83924,
    "margin": 0.39891867011276877,
    "ref": "C21:L21"
  },
  "costDrivers": [
    {
      "label": "Kerusakan persediaan",
      "current": 1370863993.5935497,
      "prior": 82038764.258,
      "ref": "F49:I49",
      "source": 4
    },
    {
      "label": "Sewa toko & gudang",
      "current": 6135507081.72,
      "prior": 5687490081.39,
      "ref": "F131:I131",
      "source": 4
    },
    {
      "label": "Depresiasi FFE",
      "current": 1929872723.0,
      "prior": 1472624776.0,
      "ref": "F149:I149",
      "source": 4
    },
    {
      "label": "Perawatan bangunan",
      "current": 278896399.00000006,
      "prior": 44658600.0,
      "ref": "F115:I115",
      "source": 4
    }
  ],
  "checks": {
    "pl_subtotals_reconcile": true,
    "pl_totals_basis": "Cached numeric F/H read with xlrd; all primary subtotal arithmetic checked to < Rp0.01; workbook formulas not recalculated.",
    "division_sums_reconcile": true,
    "net_difference": 647000.0,
    "cost_difference": -9803543.174354553,
    "gross_profit_difference": 10450543.174362183,
    "balance_files_same_cells": true,
    "balance_scope": "C001 CIKUPA",
    "balance_scope_ref": "J14:J112",
    "branch_pl_scope_ref": "J5",
    "margin_basis": "GL G/I uses gross sales F9/H9. Prototype recomputes margins against net sales F32/H32 and labels the denominator.",
    "division_net_identity_difference": 244800.0,
    "division_net_identity_reconciles": false,
    "division_sums_reconcile_note": "Sum of printed division values matches printed total; gross less discount less returns differs from printed net by Rp244800."
  }
};
