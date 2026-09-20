import fs from 'node:fs/promises';
import { Workbook, SpreadsheetFile } from '@oai/artifact-tool';

const work = '/Users/hari/itulah/.coa_dimension_review_20260918';
const out = '/Users/hari/itulah/outputs/coa_dimension_review_20260918';
const data = JSON.parse(await fs.readFile(`${work}/data.json`, 'utf8'));
const { accounts, rules, target_coa: targetCoa, field_catalog: fieldCatalog, summary, units } = data;

const wb = Workbook.create();
const names = ['Ringkasan', 'Dimensi Minimal', 'Keluarga Akun', 'COA Client', 'COA 38', 'Unit E1'];
const sheets = Object.fromEntries(names.map(name => [name, wb.worksheets.add(name)]));
const font = 'Helvetica Neue';
const c = {
  navy: '#263C55', ink: '#243247', muted: '#607086', light: '#EEF2F6',
  blue: '#2463A3', green: '#36705B', amber: '#FFF1D0', red: '#FCE4E4',
  gray: '#F8FAFC'
};
const familyEnd = rules.length + 4;
const clientEnd = accounts.length + 4;
const codeCol = n => { let s = ''; for (let x = n + 1; x; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + (x - 1) % 26) + s; return s; };
// Account codes are at most 12 digits, so they are safe as numeric cell values.
// Numeric formats preserve the 2- and 3-digit hierarchy segments (01, 001, 00)
// while keeping the client-facing list readable in spreadsheet previews.
const id = value => {
  if (value === null || value === undefined || value === '') return '';
  const text = String(value);
  return /^\d+$/.test(text) ? Number(text) : text;
};

function setup(sheetName, title, subtitle, widths, endRow, grid = false) {
  const s = sheets[sheetName];
  s.showGridLines = grid;
  widths.forEach((width, index) => s.getRange(`${codeCol(index)}1:${codeCol(index)}${endRow}`).format.columnWidth = width);
  s.getRange('A1').values = [[title]];
  s.getRange('A1').format = { font: { name: font, size: 18, bold: true, color: c.ink } };
  s.getRange('A1').format.rowHeight = 30;
  s.getRange('A2').values = [[subtitle]];
  s.getRange('A2').format = { font: { name: font, size: 10, italic: true, color: c.muted }, wrapText: false };
  s.getRange(`A3:${codeCol(widths.length - 1)}3`).format = { borders: { bottom: { style: 'thin', color: '#BBC7D3' } } };
  s.getRange(`A3:${codeCol(widths.length - 1)}3`).format.rowHeight = 10;
  return s;
}

function addTable(sheet, row, headers, values, tableName, rowHeight = 36) {
  const lastRow = row + values.length;
  const lastCol = codeCol(headers.length - 1);
  sheet.getRange(`A${row}:${lastCol}${lastRow}`).values = [headers, ...values];
  sheet.tables.add(`A${row}:${lastCol}${lastRow}`, true, tableName);
  sheet.getRange(`A${row}:${lastCol}${row}`).format = {
    fill: c.navy,
    font: { name: font, color: '#FFFFFF', bold: true },
    rowHeight: 34,
    verticalAlignment: 'center',
    wrapText: true
  };
  if (values.length) {
    sheet.getRange(`A${row + 1}:${lastCol}${lastRow}`).format = { font: { name: font, size: 10, color: c.ink }, rowHeight, verticalAlignment: 'top', wrapText: true };
  }
  return { lastRow, lastCol };
}

function band(sheet, row, text, width) {
  const end = codeCol(width - 1);
  sheet.getRange(`A${row}:${end}${row}`).format = { fill: c.light, font: { name: font, size: 12, bold: true, color: c.ink }, rowHeight: 26, wrapText: false };
  sheet.getRange(`A${row}`).values = [[text]];
}

const targetByCode = new Map(targetCoa.map(([code, name, accountClass, normalBalance, fields]) => [code, { name, accountClass, normalBalance, fields }]));

// Summary
{
  const s = setup('Ringkasan', 'Review COA dan kandidat field', 'CENTRAL FASHION STORE · Dasar: Laporan_Master_Account1.csv · Detail client tetap tersedia pada tab COA Client', [39, 18, 60, 82], 48);
  const metrics = [
    ['Baris akun client', summary.source_rows, 'Seluruh kode numerik dari file sumber dipertahankan.', 'Termasuk kelompok laporan dan akun detail.'],
    ['Kelompok laporan', summary.headings, 'Kode yang mempunyai kode anak.', 'Tetap dipakai sebagai hirarki laporan; bukan akun posting.'],
    ['Akun detail / kandidat posting', summary.leaves, 'Kode tanpa kode anak.', 'Menjadi dasar review mapping dan input transaksi.'],
    ['Akun 12 digit dengan E1', summary.twelve_digit_leaves, '493 keluarga akun berulang untuk HO + C001–C013.', 'E1 adalah kandidat paling kuat untuk dipisah sebagai Unit/Cabang.'],
    ['Keluarga akun untuk direview', summary.base_rules, 'Satu keputusan dapat berlaku untuk 14 unit yang berulang.', 'Review dilakukan di tab Keluarga Akun, bukan per 7.528 baris.'],
    ['Akun utama target', summary.target_accounts, 'Akun utama untuk jurnal dan laporan keuangan.', 'Detail seperti listrik atau BCA tidak perlu menjadi akun utama terpisah.'],
    ['Keluarga dengan usulan awal', summary.proposed_families, 'Memiliki akun target dan field yang dapat dipindahkan.', 'Tetap perlu persetujuan client pada tab Keluarga Akun.'],
    ['Keluarga perlu review', summary.review_families, 'Nama akun saja belum cukup untuk menentukan perlakuan.', 'Contoh: PPh 25, pre-opening, contract in progress, reserve replacement.'],
  ];
  addTable(s, 4, ['Ukuran', 'Jumlah', 'Makna', 'Catatan'], metrics, 'SummaryMetrics', 55);
  s.getRange('B5:B12').setNumberFormat('#,##0');
  s.getRange('B11:B12').format.font.color = c.blue;

  band(s, 15, 'Cara menggunakan hasil review', 4);
  addTable(s, 17, ['Langkah', 'Tujuan', 'Yang dilakukan', 'Hasil yang diharapkan'], [
    ['1. Mulai dari keluarga akun', 'Hindari review per cabang', 'Filter tab Keluarga Akun berdasarkan status dan field kandidat.', 'Satu keputusan berlaku bagi akun HO dan C001–C013 yang identik.'],
    ['2. Pertahankan hirarki client', 'Menjaga familiaritas laporan', 'H1–H4 tetap menjadi kelompok laporan; kode client tetap ada di tab COA Client.', 'Laporan historis dan referensi kode lama tetap dapat ditelusuri.'],
    ['3. Pindahkan E1 ke Unit', 'Mengurangi akun duplikat', 'Gunakan Unit/Cabang sebagai field wajib, dengan nilai awal dari login toko.', 'User toko tidak perlu mencari akun yang berbeda hanya karena cabang berubah.'],
    ['4. Gunakan field kondisional', 'Mencegah form terlalu ramai', 'Munculkan jenis biaya, supplier, bank, aset, atau pajak hanya untuk transaksi yang relevan.', 'Form biaya listrik tidak menampilkan field aset; form bank tidak menampilkan supplier.'],
    ['5. Selesaikan review merah/kuning', 'Mencegah migrasi salah klasifikasi', 'Periksa saldo dan transaksi sumber sebelum memilih akun target.', 'Tidak ada saldo ambigu yang dipindahkan hanya berdasarkan nama akun.'],
  ], 'ReviewSteps', 66);

  band(s, 25, 'Batas dimensi untuk fase awal', 4);
  addTable(s, 27, ['Kelompok field', 'Dipakai oleh siapa', 'Aturan UI', 'Tidak perlu dijadikan dimensi umum'], [
    ['Unit/Cabang', 'Semua transaksi', 'Default dari user/toko; dapat diubah hanya oleh HQ atau user berotorisasi.', 'Tidak perlu membuat kode akun baru untuk setiap C001–C013.'],
    ['Jenis biaya / payroll / pendapatan', 'Hanya akun P&L terkait', 'Tampil setelah jenis transaksi atau akun utama dipilih.', 'Tidak perlu satu dropdown besar berisi semua jenis detail.'],
    ['Supplier, bank, item, aset, pajak, pinjaman', 'Form transaksi khusus', 'Tampil pada invoice, pembayaran, stok, aset, pajak, atau pinjaman.', 'Bukan field wajib di semua baris jurnal.'],
  ], 'UiPrinciples', 70);

  band(s, 33, 'Sumber dan batasan', 4);
  addTable(s, 35, ['Item', 'Nilai', 'Keterangan', 'Tindakan'], [
    ['Sumber', 'Laporan_Master_Account1.csv', 'Nama dan kode asli dipertahankan dalam tab COA Client beserta nomor baris sumber.', 'Gunakan sebagai referensi utama saat review.'],
    ['Dasar pemisahan Unit', 'Dua digit terakhir E1', '493 keluarga akun memiliki setiap nilai 00–13, setara HO dan C001–C013.', 'Verifikasi nama fisik dan entitas hukum masing-masing unit sebelum konfigurasi.'],
    ['Sifat rekomendasi', 'Usulan desain data', 'Bukan persetujuan posting atau migrasi saldo.', 'Finance harus menyetujui aturan yang berstatus Review diperlukan.'],
  ], 'SourceNotes', 64);
  s.freezePanes.freezeRows(4);
}

// Minimal fields and masters
{
  const s = setup('Dimensi Minimal', 'Field minimal untuk form', 'Unit adalah satu-satunya dimensi universal. Field lain bersifat kondisional atau berasal dari subledger/master data.', [28, 24, 61, 56, 80], fieldCatalog.length + 4);
  addTable(s, 4, ['Field', 'Jenis', 'Kapan diperlukan', 'Contoh', 'Perilaku di form'], fieldCatalog, 'MinimalFields', 58);
  s.getRange(`B5:B${fieldCatalog.length + 4}`).conditionalFormats.add('containsText', { text: 'Dimensi inti', format: { fill: '#DDEBF7', font: { bold: true, color: c.blue } } });
  s.getRange(`B5:B${fieldCatalog.length + 4}`).conditionalFormats.add('containsText', { text: 'Dimensi kondisional', format: { fill: c.amber } });
  s.freezePanes.freezeRows(4);
}

// Family decisions: review once, then use for all unit repetitions.
{
  const s = setup('Keluarga Akun', 'Keluarga akun client dan kandidat field', 'Satu baris mewakili satu keluarga akun lama. Kolom Keputusan Client dan Catatan Client disediakan untuk review bersama.', [19, 56, 14, 14, 14, 43, 43, 30, 22, 82, 28, 48], familyEnd);
  s.getRange(`A5:A${familyEnd}`).setNumberFormat('0');
  s.getRange(`E5:E${familyEnd}`).setNumberFormat('0');
  const rows = rules.map(r => [
    id(r.base), r.family_name, r.legacy_detail_count, r.uses_e1_unit,
    id(r.target_code || 'REVIEW'), r.target_name || 'Belum ditentukan',
    r.dimension_label || 'Tidak ada; perlu review', r.fields || 'Lihat catatan review', r.form,
    r.status, r.review, r.client_decision, r.client_note
  ]);
  addTable(s, 4, ['Base kode client', 'Nama keluarga akun client', 'Jumlah akun detail', 'Baris dengan E1', 'Akun utama usulan', 'Nama akun utama usulan', 'Detail yang dapat dipindahkan', 'Field / master yang disarankan', 'Form utama', 'Status', 'Catatan review', 'Keputusan Client', 'Catatan Client'], rows, 'FamilyReview', 64);
  s.getRange(`A5:A${familyEnd}`).setNumberFormat('0');
  s.getRange(`E5:E${familyEnd}`).setNumberFormat('0');
  s.getRange(`A5:B${familyEnd}`).format.font.color = c.green;
  s.getRange(`E5:F${familyEnd}`).format.font.color = c.blue;
  s.getRange(`L5:L${familyEnd}`).dataValidation = { rule: { type: 'list', values: ['Setuju', 'Tetap akun detail', 'Pindah ke field/dimensi', 'Butuh pembahasan'] } };
  s.getRange(`J5:J${familyEnd}`).conditionalFormats.add('containsText', { text: 'Review diperlukan', format: { fill: c.amber, font: { color: '#805600', bold: true } } });
  s.getRange(`E5:E${familyEnd}`).conditionalFormats.add('containsText', { text: 'REVIEW', format: { fill: c.red, font: { color: '#9B2424', bold: true } } });
  s.freezePanes.freezeRows(4); s.freezePanes.freezeColumns(2);
}

// Complete, familiar client list. All raw code hierarchy remains visible alongside the proposed handling.
{
  const s = setup('COA Client', 'Daftar COA client lengkap', 'Seluruh 7.528 kode sumber dipertahankan. H1–H4, D1, dan E1 dipisahkan agar kandidat Unit/Cabang terlihat tanpa menghapus kode client.', [11, 21, 58, 10, 10, 8, 8, 8, 8, 10, 8, 13, 30, 19, 16, 43, 38, 28, 21, 80], clientEnd);
  s.getRange(`B5:B${clientEnd}`).setNumberFormat('0');
  s.getRange(`F5:F${clientEnd}`).setNumberFormat('0');
  s.getRange(`G5:I${clientEnd}`).setNumberFormat('00');
  s.getRange(`J5:J${clientEnd}`).setNumberFormat('000');
  s.getRange(`K5:K${clientEnd}`).setNumberFormat('00');
  s.getRange(`N5:O${clientEnd}`).setNumberFormat('0');
  const rows = accounts.map(a => [
    a.source_row, id(a.code), a.name, a.flag, a.level, id(a.h1), id(a.h2), id(a.h3), id(a.h4), id(a.d1), id(a.e1), a.unit,
    a.role, id(a.base), id(a.target_code || 'REVIEW'), a.target_name || 'Belum ditentukan',
    a.dimension_label || '', a.form, a.status, a.review
  ]);
  addTable(s, 4, ['Baris sumber', 'Kode akun client', 'Nama akun client', 'Flag', 'Level', 'H1', 'H2', 'H3', 'H4', 'D1', 'E1', 'Unit dari E1', 'Peran', 'Base mapping', 'Akun utama usulan', 'Nama akun utama usulan', 'Kandidat field/dimensi', 'Form utama', 'Status', 'Catatan review'], rows, 'ClientCoa', 38);
  s.getRange(`B5:B${clientEnd}`).setNumberFormat('0');
  s.getRange(`F5:F${clientEnd}`).setNumberFormat('0');
  s.getRange(`G5:I${clientEnd}`).setNumberFormat('00');
  s.getRange(`J5:J${clientEnd}`).setNumberFormat('000');
  s.getRange(`K5:K${clientEnd}`).setNumberFormat('00');
  s.getRange(`N5:O${clientEnd}`).setNumberFormat('0');
  s.getRange(`B5:D${clientEnd}`).format.font.color = c.green;
  s.getRange(`O5:P${clientEnd}`).format.font.color = c.blue;
  s.getRange(`S5:S${clientEnd}`).conditionalFormats.add('containsText', { text: 'Review diperlukan', format: { fill: c.amber, font: { color: '#805600', bold: true } } });
  s.getRange(`M5:M${clientEnd}`).conditionalFormats.add('containsText', { text: 'Kelompok laporan', format: { fill: c.light, font: { color: c.muted } } });
  s.freezePanes.freezeRows(4); s.freezePanes.freezeColumns(3);
}

// Proposed smaller natural account chart, used only as a target list; it does not replace the client list above.
{
  const s = setup('COA 38', 'Akun utama usulan', 'Daftar ini adalah target akun utama. Detail client tetap dipelihara sebagai Unit, field kondisional, subledger, atau master data.', [16, 54, 18, 18, 76, 20], targetCoa.length + 4);
  s.getRange('A5:A42').setNumberFormat('0');
  const rows = targetCoa.map(([code, name, accountClass, normalBalance, fields]) => [id(code), name, accountClass, normalBalance, fields, summary.target_counts[code] || 0]);
  addTable(s, 4, ['Kode', 'Akun utama', 'Klasifikasi', 'Saldo normal', 'Detail di luar akun utama', 'Keluarga client'], rows, 'TargetCoa', 50);
  s.getRange('A5:A42').setNumberFormat('0');
  s.getRange('A5:B42').format.font.color = c.blue;
  s.getRange('F5:F42').setNumberFormat('#,##0');
  s.freezePanes.freezeRows(4);
}

// Explicit E1 conversion list.
{
  const s = setup('Unit E1', 'Konversi E1 menjadi Unit/Cabang', 'Pola sumber menunjukkan setiap keluarga berulang untuk 00–13. Unit tetap dibaca client, tetapi tidak lagi menjadi bagian dari nomor akun.', [14, 20, 35, 70], units.length + 4);
  s.getRange(`A5:A${units.length + 4}`).setNumberFormat('00');
  const rows = units.map(([e1, unit]) => [id(e1), unit, `Suffix kode akun ${e1}`, e1 === '00' ? 'Default untuk Head Office.' : 'Default sesuai unit user/login; HQ dapat mengganti bila berotorisasi.']);
  addTable(s, 4, ['E1 pada kode lama', 'Unit baru', 'Pola client', 'Aturan input'], rows, 'UnitMap', 50);
  s.getRange(`A5:A${units.length + 4}`).setNumberFormat('00');
  s.freezePanes.freezeRows(4);
}

await fs.mkdir(out, { recursive: true });
const check = await wb.inspect({ kind: 'table', range: 'Ringkasan!A4:D12', include: 'values,formulas', tableMaxRows: 12, tableMaxCols: 4, maxChars: 9000 });
console.log(check.ndjson);
const errors = await wb.inspect({ kind: 'match', searchTerm: '#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!', options: { useRegex: true, maxResults: 50 }, summary: 'Formula error scan', maxChars: 3000 });
console.log(errors.ndjson);

const renderRanges = {
  'Ringkasan': 'A1:D42',
  'Dimensi Minimal': 'A1:E16',
  'Keluarga Akun': 'A1:L11',
  'COA Client': 'A1:T12',
  'COA 38': 'A1:F15',
  'Unit E1': 'A1:D18'
};
for (const [sheetName, range] of Object.entries(renderRanges)) {
  const image = await wb.render({ sheetName, range, scale: 1.25, format: 'png' });
  await fs.writeFile(`${work}/${sheetName.replaceAll(' ', '_')}.png`, new Uint8Array(await image.arrayBuffer()));
  console.log(`Rendered ${sheetName}`);
}

const file = await SpreadsheetFile.exportXlsx(wb);
const destination = `${out}/COA_Client_Dimension_Review.xlsx`;
await file.save(destination);
await fs.writeFile(`${work}/verification.json`, JSON.stringify({
  sourceRows: accounts.length,
  familyRules: rules.length,
  targetAccounts: targetCoa.length,
  summary: { proposedFamilies: summary.proposed_families, reviewFamilies: summary.review_families, unresolvedFamilies: summary.missing_target_families }
}, null, 2));
console.log(`EXPORTED ${destination}`);
