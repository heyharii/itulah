import fs from "node:fs/promises";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const outDir = "/Users/hari/Documents/itulah/outputs/coa_144_vs_43_20260921";
const targets = JSON.parse(await fs.readFile("/private/tmp/coa144-inspect/targets144.json", "utf8"));

const finance = {
  "1101": ["Cash On Hand", "unit", "pot"],
  "1102": ["Cash In Bank", "company", "bank_account_id"],
  "1201": ["Piutang Dagang", "unit", "tender"],
  "1202": ["Piutang Lain-lain", "unit", "party"],
  "1209": ["Cadangan Penghapusan Piutang Tak Tertagih", "unit", "party / receivable_class"],
  "1301": ["Persediaan", "unit", "item_class"],
  "1302": ["Barang Dalam Perjalanan", "unit", "item_class + counterparty_unit"],
  "1309": ["Cadangan Kerusakan atau Kehilangan Barang", "unit", "item_class"],
  "1401": ["Biaya Dibayar Dimuka", "unit", "prepaid_kind"],
  "1402": ["Pajak Bayar Dimuka", "company", "tax_kind"],
  "1403": ["Uang Muka", "unit", "advance_purpose"],
  "1501": ["Piutang (Hutang) Affiliasi Antar Unit", "unit", "interunit_reason + counterparty_unit"],
  "1601": ["Aktiva Tetap", "unit", "asset_class / asset_stage"],
  "1602": ["Intangible Asset", "unit", "asset_class"],
  "1609": ["Akumulasi Penyusutan Aktiva Tetap", "unit", "asset_class"],
  "1610": ["Reserve Replacement Operating Equipment", "unit", "asset_class"],
  "1619": ["Akumulasi Amortisasi", "unit", "asset_class"],
  "2101": ["Hutang Supplier", "company", "supplier_id / document_id"],
  "2102": ["Hutang Supplier - Suspend", "company", "supplier_id / GRN"],
  "2103": ["Outstanding Giro", "company", "giro / bank document"],
  "2201": ["Hutang Pajak", "company", "tax_kind"],
  "2301": ["Biaya Yang Masih Harus Dibayar", "unit", "accrual_kind"],
  "2401": ["Uang Muka Penjualan", "company", "deferred_revenue_kind"],
  "2402": ["Kewajiban Poin Member", "company", "—"],
  "2501": ["Pinjaman Bank", "company", "facility_id"],
  "2502": ["Pinjaman Principal", "company", "principal_id / facility_id"],
  "3101": ["Modal Setor", "company", "—"],
  "3102": ["Prive", "company", "—"],
  "3201": ["Laba (Rugi) Ditahan", "company", "—"],
  "4101": ["Penjualan", "unit", "tender"],
  "4201": ["Potongan Penjualan", "unit", "—"],
  "4202": ["Retur Penjualan", "unit", "—"],
  "4301": ["Pendapatan Lain-lain", "unit", "income_kind"],
  "5101": ["Harga Pokok Pembelian", "unit", "cost_kind"],
  "5102": ["Kehilangan Barang & Selisih Stock Opname", "unit", "loss_kind"],
  "6101": ["Biaya Penjualan", "unit", "expense_category"],
  "6201": ["Biaya Pegawai", "unit", "pay_component"],
  "6301": ["Biaya Administrasi dan Umum", "unit", "expense_category"],
  "6401": ["Biaya Sewa", "unit", "expense_category"],
  "7101": ["Biaya Depresiasi dan Amortisasi", "unit", "depreciation_kind"],
  "8101": ["Biaya Bunga", "company", "facility_id"],
  "8201": ["Pajak Penghasilan", "company", "tax_kind"],
  "8301": ["Biaya Lain-lain", "unit", "other_expense_kind"],
};

const map = new Map();
const set = (nos, code, relationship, note = "") => {
  for (const no of nos) map.set(no, { code, relationship, note });
};
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

set(range(1, 4), "2301", "many:1 via accrual_kind", "Akrual client tetap dibedakan lewat jenis akrual.");
set(range(5, 7), "1403", "many:1 via advance_purpose", "Tujuan uang muka tetap menjadi dimensi.");
set([7], "1403", "direct family via advance_purpose", "Supplier/kontraktor tetap dibedakan sebagai tujuan/party.");
set(range(8, 10), "1501", "many:1 via interunit_reason", "Tiga keluarga afiliasi client dipertahankan sebagai alasan transaksi dan counterparty.");
set([10], "1501", "many:1 via interunit_reason", "Saldo afiliasi lain-lain tetap memakai counterparty unit.");
set(range(11, 12 + 1), "1209", "many:1 via party / receivable_class", "Cadangan kartu dan pegawai berada pada satu akun kontra dengan detail kelas piutang.");
set([13], "1309", "direct family via item_class");
set([14, 16], "2101", "many:1 via supplier/document", "Hutang barang dan non-barang dibedakan lewat supplier/dokumen, bukan kode GL.");
set([15], "2102", "direct family", "Suspend tetap menjadi akun tersendiri.");
set([17], "1201", "direct family via tender");
set([18], "1202", "direct family via party");
set(range(19, 25), "1609", "many:1 via asset_class", "Jenis akumulasi penyusutan dipindahkan ke kelas aset.");
set(range(25, 33), "1601", "many:1 via asset_class / asset_stage", "CIP, HGB, FFE, OE, kendaraan, dan aset tetap lain dibedakan di asset register.");
set(range(33, 39), "7101", "many:1 via depreciation_kind", "Jenis depresiasi/amortisasi dipertahankan sebagai kategori.");
set(range(39, 42), "1102", "many:1 via bank_account_id", "Giro, tabungan, dan deposito tetap dibedakan pada rekening bank.");
set(range(42, 45), "1101", "many:1 via pot", "Cash on hand, petty cash, dan modal kasir tetap dibedakan sebagai pot.");
set([45, 48], "5101", "many:1 via cost_kind", "HPP dan potongan pembelian dibedakan sebagai kategori biaya.");
set([46], "5102", "direct family via loss_kind");
set([47], "4201", "direct family");
set([49], "4202", "direct family", "Retur dipisahkan dari potongan penjualan.");
set([50], "3101", "direct family");
set([51], "3102", "direct family");
set([52], "3201", "direct family");
set([53, 54], "8101", "many:1 via facility_id", "Bunga bank dan leasing tetap dibedakan oleh fasilitas pinjaman.");
set([55, 62, 128], "1619", "many:1 via asset_class", "Amortisasi software, land right, dan pre-opening masuk sub-ledger aset.");
set([56, 129], "1602", "many:1 via asset_class", "Software/intangible dan pre-opening tetap dibedakan sebagai kelas aset.");
set([57, 58], "1302", "many:1 via item_class + counterparty_unit");
set(range(59, 62), "1301", "many:1 via item_class");
set([63], "1601", "direct family via asset_class", "HGB mengikuti mapping client/runtime sebagai aktiva tetap.");
set([64], "6401", "direct category via expense_category");
set([65], "2401", "direct family");
set([66], "1501", "direct family via counterparty_unit", "Hutang lain-lain client berasal dari matriks antar-unit, bukan hutang operasional biasa.");
set([67], "2103", "direct family");
set([68, 70], "2502", "many:1 via principal_id / facility_id");
set([69], "2501", "direct family via facility_id");
set([71], "4301|8301", "split by sign / nature", "Akun client signed dipisah: pendapatan ke 4301, biaya/rugi ke 8301.");
set(range(72, 79), "6101", "many:1 via expense_category", "Rincian beban penjualan tetap tersedia sebagai kategori.");
set(range(79, 109), "6301", "many:1 via expense_category", "Rincian beban umum/administrasi tetap tersedia sebagai kategori.");
set([109, 110, 114], "6401", "many:1 via expense_category", "Rincian sewa tetap tersedia sebagai kategori.");
set([111, 113], "6301", "many:1 via expense_category", "Pemeliharaan tetap tersedia sebagai kategori biaya.");
set([112], "7101", "direct category via depreciation_kind", "Replacement OE dibedakan dari depresiasi melalui kategori REPLACEMENT.");
set(range(115, 128), "6201", "many:1 via pay_component", "13 komponen payroll tetap tersedia sebagai pay component.");
set([130], "7101", "direct category via depreciation_kind", "Amortisasi pre-opening.");
set([131, 132], "1401", "many:1 via prepaid_kind");
set([133, 134, 135, 137], "4301", "many:1 via income_kind");
set([136], "4101", "direct family via tender");
set([138], "4301|8301", "split by sign / nature", "Pembulatan positif masuk 4301; pembulatan rugi masuk 8301.");
set(range(139, 143), "1402", "many:1 via tax_kind");
set([143], "2201", "direct family via tax_kind");
set([144], "8201", "direct family via tax_kind");

if (map.size !== 144) throw new Error(`Mapping coverage is ${map.size}, expected 144`);

const rows = targets.map((t) => {
  const m = map.get(t.no);
  const codes = m.code.split("|");
  const names = codes.map((c) => `${c} ${finance[c][0]}`).join("; ");
  const dims = codes.map((c) => finance[c][2]).join("; ");
  return [t.no, t.client_name, t.group, m.code, names, m.relationship, dims, m.note || ""];
});

// Add active Finance accounts that do not have a direct natural-account row in the 144 list.
rows.push([null, "", "", "1610", "1610 Reserve Replacement Operating Equipment", "Finance-only balance account", "asset_class", "Reserve balance is separated from the client natural expense row 112."]);
rows.push([null, "", "", "2402", "2402 Kewajiban Poin Member", "Finance-only account", "—", "Active but BLOCKED until member-point valuation and lapse policy are defined."]);

const wb = Workbook.create();
const mapSheet = wb.worksheets.add("Mapping 144 vs 43");
const summary = wb.worksheets.add("Summary");

summary.getRange("A1:B8").values = [
  ["COA mapping review", "Client 144 natural accounts vs Finance runtime accounts"],
  ["Source client", "COA_144 (1).xlsm"],
  ["Client natural accounts", 144],
  ["Finance active accounts", 43],
  ["Finance-only rows shown", 2],
  ["Mapping principle", "Keep 144 visible; use 43 as posting account plus category/dimension detail"],
  ["Review focus", "Rows with split mapping or a judgement note"],
  ["Status", "PROPOSED MAPPING — review before changing Finance schema"],
];
summary.getRange("A1:B1").format = { fill: "#1F4E78", font: { color: "#FFFFFF", bold: true } };
summary.getRange("A2:A8").format = { font: { bold: true } };
summary.getRange("A1:B8").format.wrapText = true;
summary.getRange("A1:A8").format.columnWidth = 24;
summary.getRange("B1:B8").format.columnWidth = 78;

const headers = [["No. client", "Nama natural account client", "Kelompok client", "Kode Finance kandidat", "Nama akun Finance kandidat", "Relasi mapping", "Detail/category/dimension", "Catatan review"]];
mapSheet.getRange("A1:H1").values = [["Mapping client 144 ke Finance 43", "", "", "", "", "", "", ""]];
mapSheet.getRange("A2:H2").values = [["Satu baris per natural account client; 2 baris terakhir menunjukkan akun Finance yang belum punya baris natural account client langsung.", "", "", "", "", "", "", ""]];
mapSheet.getRange("A1:H1").merge();
mapSheet.getRange("A2:H2").merge();
mapSheet.getRange("A4:H4").values = headers;
mapSheet.getRange(`A5:H${4 + rows.length}`).values = rows;
mapSheet.getRange("A1:H1").format = { fill: "#1F4E78", font: { color: "#FFFFFF", bold: true, size: 14 } };
mapSheet.getRange("A2:H2").format = { fill: "#D9EAF7", font: { italic: true, color: "#404040" }, wrapText: true };
mapSheet.getRange("A4:H4").format = { fill: "#5B9BD5", font: { color: "#FFFFFF", bold: true }, wrapText: true, verticalAlignment: "center" };
mapSheet.getRange(`A4:H${4 + rows.length}`).format.borders = { preset: "all", style: "thin", color: "#D9E2F3" };
mapSheet.getRange(`A5:H${4 + rows.length}`).format.wrapText = true;
mapSheet.getRange("A:A").format.columnWidth = 10;
mapSheet.getRange("B:B").format.columnWidth = 38;
mapSheet.getRange("C:C").format.columnWidth = 22;
mapSheet.getRange("D:D").format.columnWidth = 20;
mapSheet.getRange("E:E").format.columnWidth = 42;
mapSheet.getRange("F:F").format.columnWidth = 28;
mapSheet.getRange("G:G").format.columnWidth = 34;
mapSheet.getRange("H:H").format.columnWidth = 60;
mapSheet.freezePanes.freezeRows(4);
summary.freezePanes.freezeRows(1);

const table = mapSheet.tables.add(`A4:H${4 + rows.length}`, true, "Coa144Vs43Mapping");
table.style = "TableStyleMedium2";
table.showFilterButton = true;

await fs.mkdir(outDir, { recursive: true });
const output = await SpreadsheetFile.exportXlsx(wb);
await output.save(`${outDir}/COA_144_vs_43_mapping.xlsx`);
console.log(JSON.stringify({ output: `${outDir}/COA_144_vs_43_mapping.xlsx`, mappingRows: rows.length, clientRows: 144, financeOnlyRows: 2 }, null, 2));
