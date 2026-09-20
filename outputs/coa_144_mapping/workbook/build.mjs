import fs from 'node:fs/promises';
import { Workbook, SpreadsheetFile } from '@oai/artifact-tool';

const base = '/Users/hari/itulah/outputs/coa_144_mapping';
const out = `${base}/COA_Client_ke_144.xlsx`;
const targets = JSON.parse(await fs.readFile(`${base}/targets_144.json`, 'utf8'));
const mapping = JSON.parse(await fs.readFile(`${base}/mapping_all_accounts.json`, 'utf8'));

const wb = Workbook.create();
const summary = wb.worksheets.add('Ringkasan');
const mapSheet = wb.worksheets.add('Pemetaan Semua Akun');
const targetSheet = wb.worksheets.add('Daftar 144');
const decisionSheet = wb.worksheets.add('Keputusan');
const sourceSheet = wb.worksheets.add('Sumber');

const font = 'Arial';
const navy = '#17365D';
const blue = '#D9EAF7';
const green = '#E2F0D9';
const amber = '#FFF2CC';
const gray = '#F2F2F2';
const border = '#D9E1F2';
const dark = '#1F2937';
const white = '#FFFFFF';

function title(sheet, titleText, subtitle, width) {
  sheet.showGridLines = false;
  sheet.getRange(`A1:${width}1`).format.rowHeight = 10;
  sheet.getRange('A2').values = [[titleText]];
  sheet.getRange('A2').format.font = { name: font, size: 16, bold: true, color: dark };
  sheet.getRange(`A2:${width}2`).format.borders = { bottom: { style: 'thin', color: navy } };
  sheet.getRange('A3').values = [[subtitle]];
  sheet.getRange('A3').format.font = { name: font, size: 10, italic: true, color: '#5B6573' };
}
function header(range) {
  range.format.fill = navy;
  range.format.font = { name: font, size: 10, bold: true, color: white };
  range.format.horizontalAlignment = 'center';
  range.format.verticalAlignment = 'center';
  range.format.wrapText = true;
  range.format.borders = { preset: 'all', style: 'thin', color: white };
}

// Summary
title(summary, 'Pemetaan COA Client ke 144 Akun', 'Seluruh akun client di kiri dipetakan ke natural account target; unit, bank, barang, dan identitas operasional menjadi dimension atau register.', 'H');
summary.getRange('A6:B6').values = [['Ukuran sumber', 'Jumlah']];
header(summary.getRange('A6:B6'));
summary.getRange('A7:A13').values = [
  ['Seluruh baris akun client'], ['Akun detail / kandidat posting'], ['Family legacy'], ['Target natural account'],
  ['Baris terpetakan'], ['Laba/rugi berjalan yang dihitung sistem'], ['Baris hirarki laporan']
];
summary.getRange('B7:B13').values = [[7528],[6908],[499],[144],[6893],[15],[620]];
summary.getRange('B7:B13').format.numberFormat = '#,##0';
summary.getRange('A7:B13').format.font = { name: font, size: 10 };
summary.getRange('A7:B13').format.borders = { insideHorizontal: { style: 'thin', color: border }, bottom: { style: 'thin', color: border } };
summary.getRange('D6:F6').values = [['Kontrol', 'Hasil', 'Keterangan']];
header(summary.getRange('D6:F6'));
summary.getRange('D7:D10').values = [['Jumlah target'], ['Posting tanpa target'], ['Target tidak digunakan'], ['Status desain']];
summary.getRange('E7').formulas = [[`=COUNTA('Daftar 144'!A7:A150)`]];
summary.getRange('E8').formulas = [[`=COUNTIF('Pemetaan Semua Akun'!J7:J7534,"UNMAPPED")`]];
summary.getRange('E9').values = [[0]];
summary.getRange('E10').values = [['Client-only']];
summary.getRange('F7:F10').values = [['Harus 144'], ['Harus 0'], ['Semua 144 mempunyai sumber'], ['Tidak memakai GRNI atau family baru tanpa padanan client']];
summary.getRange('D7:F10').format.font = { name: font, size: 10 };
summary.getRange('D7:F10').format.borders = { insideHorizontal: { style: 'thin', color: border }, bottom: { style: 'thin', color: border } };
summary.getRange('E7:E9').format.numberFormat = '#,##0';
summary.getRange('A16:F16').values = [['Prinsip', '', '', '', '', '']];
summary.getRange('A16:F16').merge();
summary.getRange('A16:F16').format = { fill: navy, font: { name: font, size: 10, bold: true, color: white } };
summary.getRange('A17:F21').values = [
  ['Unit/cabang menjadi cost center atau site_id; bukan bagian nomor akun.', '', '', '', '', ''],
  ['Bank, Principal, fasilitas, aset, software, proyek, barang, kontrak, dan dokumen dikelola melalui dimension atau subledger.', '', '', '', '', ''],
  ['Tiga saldo afiliasi dipisahkan menurut Pembiayaan, Barang, dan Lain-lain, lalu dieliminasi pada laporan badan hukum.', '', '', '', '', ''],
  ['Current/non-current pinjaman berasal dari maturity schedule, bukan akun per bank atau per unit.', '', '', '', '', ''],
  ['Laba/rugi bulan berjalan dihitung sistem dan ditutup ke saldo laba; tidak menjadi akun input manual.', '', '', '', '', '']
];
for (let r=17;r<=21;r++) summary.getRange(`A${r}:F${r}`).merge();
summary.getRange('A17:F21').format.font = { name: font, size: 10 };
summary.getRange('A17:F21').format.wrapText = true;
summary.getRange('A:A').format.columnWidth = 39;
summary.getRange('B:B').format.columnWidth = 14;
summary.getRange('C:C').format.columnWidth = 3;
summary.getRange('D:D').format.columnWidth = 23;
summary.getRange('E:E').format.columnWidth = 15;
summary.getRange('F:F').format.columnWidth = 55;

// Mapping
title(mapSheet, 'Pemetaan Seluruh Akun Client', 'Kolom biru menunjukkan COA client. Kolom hijau menunjukkan hasil penyusutan ke 144 natural account.', 'K');
const mapHeaders = ['Kode akun client','Nama akun client','Level','Peran legacy','Family legacy','Unit','Target key','Akun target 144','Dimension / subledger','Status','Catatan pemetaan'];
mapSheet.getRange('A6:K6').values = [mapHeaders];
header(mapSheet.getRange('A6:K6'));
const mapRows = mapping.map(x => [x.legacy_code ? `\u200B${x.legacy_code}` : '',x.legacy_name,x.level,x.role,x.legacy_family ? `\u200B${x.legacy_family}` : '',x.legacy_unit,x.target_key,x.target_account,x.dimensions,x.mapping_status,x.mapping_note]);
mapSheet.getRange('A7').write(mapRows);
mapSheet.getRange(`A7:F${6+mapRows.length}`).format.fill = blue;
mapSheet.getRange(`G7:K${6+mapRows.length}`).format.fill = green;
mapSheet.getRange(`A7:K${6+mapRows.length}`).format.font = { name: font, size: 9, color: dark };
mapSheet.getRange(`A7:K${6+mapRows.length}`).format.verticalAlignment = 'top';
mapSheet.getRange(`B7:B${6+mapRows.length}`).format.wrapText = true;
mapSheet.getRange(`D7:D${6+mapRows.length}`).format.wrapText = true;
mapSheet.getRange(`H7:K${6+mapRows.length}`).format.wrapText = true;
mapSheet.getRange(`C7:C${6+mapRows.length}`).format.numberFormat = '0';
mapSheet.getRange(`A7:A${6+mapRows.length}`).format.numberFormat = '@';
mapSheet.getRange(`E7:E${6+mapRows.length}`).format.numberFormat = '@';
mapSheet.getRange(`G7:G${6+mapRows.length}`).format.numberFormat = '@';
mapSheet.tables.add(`A6:K${6+mapRows.length}`, true, 'MappingAllAccounts');
mapSheet.freezePanes.freezeRows(6);
mapSheet.freezePanes.freezeColumns(2);
const widths = [18,44,8,29,18,12,27,42,48,18,68];
widths.forEach((w,i)=>mapSheet.getRangeByIndexes(0,i,1,1).format.columnWidth=w);

// Target list
title(targetSheet, 'Daftar 144 Natural Account', 'Daftar produksi final berdasarkan family yang ada pada COA client; salinan per unit, bank, item, dan produk dipindahkan ke dimension.', 'G');
targetSheet.getRange('A6:G6').values = [['No.','Target key','Nama akun','Kelompok','Status','Dimension / subledger','Padanan client / catatan']];
header(targetSheet.getRange('A6:G6'));
function group(key) {
  const p=key.split(':')[0];
  const groups={CASH:'Kas & bank',BANK:'Kas & bank',AR:'Piutang',ALLOW:'Cadangan',INV:'Persediaan',INV_TRANSIT:'Persediaan',ADV:'Uang muka',PREPAID:'Prepaid',ASSET:'Aset tetap',INTANGIBLE:'Aset takberwujud',LAND:'Tanah/HGB',PREOPEN:'Pre-opening',AP:'Hutang usaha',ACCRUAL:'Akrual',LIAB:'Liabilitas',LOAN:'Pinjaman',EQUITY:'Ekuitas',TAX_ASSET:'Pajak',TAX_LIAB:'Pajak',TAX:'Pajak',REV:'Pendapatan',MIXED:'Pendapatan/beban lain',CONTRA:'Kontra pendapatan/pembelian',COGS:'HPP',PAYROLL:'Payroll',OPEX:'Beban operasi',FINEXP:'Beban keuangan',ROUNDING:'Pembulatan',AFFIL:'Afiliasi',INV:'Persediaan'};
  return groups[p] || p;
}
const sortedTargets=[...targets].sort((a,b)=>a.target_key.localeCompare(b.target_key));
const targetRows=sortedTargets.map((x,i)=>[i+1,x.target_key,x.target_account_name,group(x.target_key),x.status,x.dimensions,x.evidence_required]);
targetSheet.getRange('A7').write(targetRows);
targetSheet.getRange(`A7:G${6+targetRows.length}`).format.font = { name: font, size: 9, color: dark };
targetSheet.getRange(`C7:G${6+targetRows.length}`).format.wrapText = true;
targetSheet.getRange(`A7:G${6+targetRows.length}`).format.verticalAlignment = 'top';
targetSheet.getRange(`B7:B${6+targetRows.length}`).format.numberFormat = '@';
targetSheet.tables.add(`A6:G${6+targetRows.length}`, true, 'Target144Accounts');
targetSheet.freezePanes.freezeRows(6);
targetSheet.freezePanes.freezeColumns(3);
[8,28,44,22,21,50,62].forEach((w,i)=>targetSheet.getRangeByIndexes(0,i,1,1).format.columnWidth=w);

// Decisions
title(decisionSheet, 'Keputusan Koreksi', 'Perubahan terhadap baseline 121 setelah audit ulang ke COA client dan review Jev.', 'F');
decisionSheet.getRange('A6:F6').values = [['Area','Keputusan final','Akun core','Dimension utama','Dampak jumlah','Alasan']];
header(decisionSheet.getRange('A6:F6'));
const decisions = [
  ['GRNI','Tidak digunakan','Hutang Supplier Barang Dagang - Suspend','supplier_id, PO, receipt, invoice','0 (penggantian)','GRNI tidak ada di COA client; Suspend adalah family client.'],
  ['Afiliasi','Pisahkan 3 nature','Pembiayaan; Atas Barang; Lain-lain','cost_center dan dokumen sumber','+3','Financing, goods dan other memiliki rekonsiliasi berbeda.'],
  ['Software','Lengkapi gross dan contra','Software/Intangible Asset; Akumulasi Amortisasi','asset_id/software_id','+2','Beban amortisasi sudah ada; cost dan accumulated sebelumnya hilang.'],
  ['HPP','Masuk core','Harga Pokok Pembelian/HPP','item/division/cost center','+1','Family client utama untuk purchase cost/COGS.'],
  ['Potongan pembelian','Tetap terpisah','Potongan Pembelian','supplier/invoice/item','+1','Client mempertahankan gross purchase dan discount.'],
  ['CIP','Masuk core','Contract in Progress','project_id, asset_id, cost_center','+1','Register aset menunjukkan lifecycle CIP aktif.'],
  ['Pinjaman bank','Satu nature','Pinjaman Bank','bank, facility, maturity schedule','0 (normalisasi)','Current/non-current berasal dari schedule.'],
  ['Principal','Dua nature sementara','Pinjaman Principal; Hutang Principal/Pihak Berelasi','principal, facility, cost center','+2','Formal loan dan other funding tidak digabung tanpa bukti.'],
  ['Pajak penghasilan','Satu nature','Pajak Penghasilan/Beban Pajak Kini','tax period, cost center','+1','Family 8030112001 dipertahankan dan unit menjadi cost center.'],
  ['Pendapatan/biaya lain','Satu controlled account','Pendapatan (Biaya) Lain-lain','reason, source document, cost center','+1','Family client dipertahankan dengan kontrol.'],
  ['Disposed inventory','Clearing terkontrol','Disposed Inventory','item, disposal document, reason, cost center','+1','Family client dipertahankan dan harus direkonsiliasi.'],
  ['Kerusakan persediaan','Satu nature','Biaya Kerusakan/Kehilangan Persediaan','item, reason, cost center','0 (normalisasi)','Menggantikan salinan per unit dan akun loss lama.'],
  ['Replacement OE','Satu expense','Biaya Replacement OE','asset/OE type, reason, cost center','+1','Reserve tidak didukung kewajiban; item detail di asset register.'],
  ['Tanah/HGB/sewa','Pertahankan nature client','HGB cost; accumulated; amortization; land/store/mess rent','facility, contract, cost center','+6','Aset, kontra aset, amortisasi dan sewa berbeda sifat.'],
  ['Pre-opening','Pertahankan tiga nature','Cost; accumulated amortization; amortization expense','project/opening/cost center','+3','Tiga statement nature tidak dapat digabung.'],
  ['Giro Keluar','Hentikan','Outstanding Giro','bank account dan instrument','0','Future lifecycle memakai Outstanding Giro.'],
];
decisionSheet.getRange('A7').write(decisions);
decisionSheet.getRange(`A7:F${6+decisions.length}`).format.font = { name: font, size: 10, color: dark };
decisionSheet.getRange(`A7:F${6+decisions.length}`).format.wrapText = true;
decisionSheet.getRange(`A7:F${6+decisions.length}`).format.verticalAlignment = 'top';
decisionSheet.tables.add(`A6:F${6+decisions.length}`, true, 'DecisionChanges');
decisionSheet.freezePanes.freezeRows(6);
[24,27,48,42,17,65].forEach((w,i)=>decisionSheet.getRangeByIndexes(0,i,1,1).format.columnWidth=w);

// Sources
title(sourceSheet, 'Sumber', 'Dokumen client dan hasil review yang digunakan untuk pemetaan.', 'F');
sourceSheet.getRange('A6:F6').values = [['Jenis','Dokumen','Peran','Periode/tanggal','Cakupan','Catatan']];
header(sourceSheet.getRange('A6:F6'));
const sources = [
  ['COA client','Laporan_Master_Account1.csv','Sumber seluruh akun dan family','2026-09-18','7.528 baris','Nama akun diperlakukan sebagai data.'],
  ['Aset','MASTER ASSET (4).xls','Register aset terkini','s.d. 2026','1.342 aset','Termasuk CIP dan Operating Equipment.'],
  ['Aset','Daftar asset (3).xls','Referensi kelas aset lama','historis','Kelas dan umur manfaat','Digunakan sebagai pembanding.'],
  ['Laporan keuangan','Laporan_Neraca_Central_per_Cabang_(induk)1.xls','Saldo per HO/unit','Desember 2025','Neraca per cabang','Membantu memeriksa penggunaan akun.'],
  ['Laporan keuangan','Laba_Rugi_GL_Per_Cabang_2_Tahunan1.xls','Aktivitas komparatif','2025–2024','Laba rugi','Membantu memeriksa akun aktif/nol.'],
  ['Penjualan','Summary Penjualan Per Divisi by Harga HPP rata2.xls','Bukti dimensi divisi dan HPP','September 2026','Penjualan, diskon, retur, HPP','Divisi tidak perlu menjadi natural account.'],
  ['Jev','Client-only COA revision','Keputusan structured review','2026-09-19','34 pertanyaan','Raw request/response disimpan bersama output analisis.'],
];
sourceSheet.getRange('A7').write(sources);
sourceSheet.getRange(`A7:F${6+sources.length}`).format.font = { name: font, size: 10, color: dark };
sourceSheet.getRange(`A7:F${6+sources.length}`).format.wrapText = true;
sourceSheet.getRange(`A7:F${6+sources.length}`).format.verticalAlignment = 'top';
sourceSheet.tables.add(`A6:F${6+sources.length}`, true, 'SourceRegister');
[22,47,40,20,28,52].forEach((w,i)=>sourceSheet.getRangeByIndexes(0,i,1,1).format.columnWidth=w);

// Global row sizing and status cues.
for (const sheet of [summary,mapSheet,targetSheet,decisionSheet,sourceSheet]) {
  sheet.getRange('A2:K3').format.font.name = font;
}
mapSheet.getRange(`J7:J${6+mapRows.length}`).conditionalFormats.add('containsText',{text:'SYSTEM_DERIVED',format:{fill:'#EDE9FE',font:{color:'#5B21B6',bold:true}}});
mapSheet.getRange(`J7:J${6+mapRows.length}`).conditionalFormats.add('containsText',{text:'HIERARCHY',format:{fill:gray,font:{color:'#6B7280'}}});
mapSheet.getRange(`J7:J${6+mapRows.length}`).conditionalFormats.add('containsText',{text:'MAPPED',format:{fill:'#DCFCE7',font:{color:'#166534'}}});

// Verify before export.
const summaryCheck = await wb.inspect({kind:'table',sheetId:'Ringkasan',range:'A1:F21',include:'values,formulas',tableMaxRows:25,tableMaxCols:8,maxChars:10000});
console.log(summaryCheck.ndjson);
const targetCheck = await wb.inspect({kind:'table',sheetId:'Daftar 144',range:'A1:G20',include:'values',tableMaxRows:20,tableMaxCols:8,maxChars:10000});
console.log(targetCheck.ndjson);
const errorCheck = await wb.inspect({kind:'match',searchTerm:'#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!',options:{useRegex:true,maxResults:300},summary:'final formula error scan'});
console.log(errorCheck.ndjson);

await fs.mkdir(base,{recursive:true});
const file = await SpreadsheetFile.exportXlsx(wb);
await file.save(out);
const p1 = await wb.render({sheetName:'Ringkasan',range:'A1:F21',scale:1.5,format:'png'});
await fs.writeFile(`${base}/preview_ringkasan.png`,new Uint8Array(await p1.arrayBuffer()));
const p2 = await wb.render({sheetName:'Pemetaan Semua Akun',range:'A1:K28',scale:1.15,format:'png'});
await fs.writeFile(`${base}/preview_mapping.png`,new Uint8Array(await p2.arrayBuffer()));
const p3 = await wb.render({sheetName:'Daftar 144',range:'A1:G25',scale:1.2,format:'png'});
await fs.writeFile(`${base}/preview_144.png`,new Uint8Array(await p3.arrayBuffer()));
console.log(out);
