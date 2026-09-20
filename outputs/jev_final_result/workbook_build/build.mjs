import fs from 'node:fs/promises';
import { Workbook, SpreadsheetFile } from '@oai/artifact-tool';

const outDir='/Users/hari/itulah/outputs/jev_final_result';
const data=JSON.parse(await fs.readFile(`${outDir}/final_register.json`,'utf8'));
const wb=Workbook.create();
const navy='#1F4E78', blue='#D9EAF7', light='#F3F6F8', amber='#FFF2CC', red='#FCE4D6', green='#E2F0D9', gray='#666666';

function title(sheet,title,subtitle,lastCol){
  sheet.showGridLines=false;
  sheet.getRange(`A1:${lastCol}1`).merge();
  sheet.getRange('A1').values=[[title]];
  sheet.getRange('A1').format.font={bold:true,size:16,color:'#1F1F1F'};
  sheet.getRange('1:1').format.rowHeight=24;
  sheet.getRange(`A2:${lastCol}2`).merge();
  sheet.getRange('A2').values=[[subtitle]];
  sheet.getRange('A2').format.font={italic:true,size:10,color:gray};
  sheet.getRange('2:2').format.rowHeight=18;
  sheet.getRange(`A3:${lastCol}3`).format.borders={bottom:{style:'thin',color:'#B4C6D7'}};
}
function header(r){
  r.format.fill=navy; r.format.font={bold:true,color:'#FFFFFF'};
  r.format.horizontalAlignment='center'; r.format.verticalAlignment='center'; r.format.wrapText=true;
  r.format.borders={insideVertical:{style:'thin',color:'#FFFFFF'},bottom:{style:'thin',color:'#17365D'}};
}
function statusFormat(range,statusColLetter,startRow,endRow){
  range.conditionalFormats.add('containsText',{text:'RETAIN',format:{fill:green,font:{color:'#375623'}}});
  range.conditionalFormats.add('containsText',{text:'CONDITIONAL_MERGE',format:{fill:amber,font:{color:'#7F6000'}}});
  range.conditionalFormats.add('containsText',{text:'UNRESOLVED_EVIDENCE',format:{fill:red,font:{color:'#9C0006'}}});
  range.conditionalFormats.add('containsText',{text:'DEACTIVATE_AFTER_RECLASS',format:{fill:blue,font:{color:'#1F4E78'}}});
}

const summary=wb.worksheets.add('Ringkasan');
title(summary,'Hasil Review Jev atas COA Client','Sumber: Laporan_Master_Account1.csv. Seluruh 499 family setelah unit dipisahkan telah diberi keputusan.','H');
summary.getRange('A5:B13').values=[
  ['Ukuran','Jumlah'],
  ['Family sumber',data.summary.source_families],
  ['Family tercakup',data.summary.covered_families],
  ['Baris detail legacy',data.summary.legacy_detail_rows],
  ['Rekomendasi kerja saat ini',data.summary.recommended_with_unresolved_separate],
  ['Skenario optimasi kondisional',data.summary.active_target_groups],
  ['Family ditutup setelah reklasifikasi',data.summary.deactivate_after_reclass_families],
  ['Target belum terselesaikan',data.summary.target_status_counts.UNRESOLVED_EVIDENCE],
  ['Family tanpa keputusan',data.summary.unmapped_families]
];
header(summary.getRange('A5:B5'));
summary.getRange('A6:A13').format.font={bold:true};
summary.getRange('B6:B13').format.numberFormat='#,##0';
summary.getRange('D5:F9').values=[
  ['Status target','Jumlah','Makna'],
  ['RETAIN',data.summary.target_status_counts.RETAIN,'Tetap menjadi natural account'],
  ['CONDITIONAL_MERGE',data.summary.target_status_counts.CONDITIONAL_MERGE,'Direkomendasikan setelah bukti dan rekonsiliasi'],
  ['UNRESOLVED_EVIDENCE',data.summary.target_status_counts.UNRESOLVED_EVIDENCE,'Sifat akun belum dapat ditentukan dari COA'],
  ['TOTAL',data.summary.active_target_groups,'Tidak termasuk 71 family yang ditutup setelah reklasifikasi']
];
header(summary.getRange('D5:F5'));
summary.getRange('D6:D9').format.font={bold:true};
summary.getRange('E6:E9').format.numberFormat='#,##0';
statusFormat(summary.getRange('D6:D8'),'D',6,8);
summary.getRange('D11:F14').values=[
  ['Skenario jumlah akun','Jumlah','Penggunaan'],
  ['Tanpa merger; akun internal ditutup',data.summary.no_merge_after_deactivation,'Batas konservatif sebelum evidence'],
  ['Rekomendasi; exception dipisah',data.summary.recommended_with_unresolved_separate,'Target kerja selama 21 exception belum selesai'],
  ['Seluruh evidence gate terpenuhi',data.summary.active_target_groups,'Target desain kondisional Jev']
];
header(summary.getRange('D11:F11'));
summary.getRange('D12:D14').format.font={bold:true}; summary.getRange('E12:E14').format.numberFormat='#,##0';
summary.getRange('A15:H20').values=[
  ['Keputusan utama','','','','','','',''],
  ['Unit','Semua HO dan unit adalah site dalam satu PT Perorangan. Unit disimpan sebagai site_id.','','','','','',''],
  ['Interunit','70 family piutang/hutang afiliasi internal ditutup setelah saldo dilacak, direklasifikasi, dan direkonsiliasi.','','','','','',''],
  ['Counter-site','Tidak digunakan sebagai dimensi jurnal umum. Asal/tujuan disimpan pada dokumen transfer atau shipment.','','','','','',''],
  ['225 dan 142','Gunakan 225 sebagai COA kerja. Angka 142 hanya skenario optimasi jika seluruh evidence gate mendukung merger. Rentang perencanaan Jev: 180–250.','','','','','',''],
  ['Batas','Jev memberi keputusan dan evidence gate. Jev tidak menggantikan kontrak, jurnal, saldo, kebijakan, dan rekonsiliasi client.','','','','','','']
];
for (let row=16; row<=20; row++) summary.getRange(`B${row}:H${row}`).merge();
summary.getRange('A15:H15').format.fill=blue; summary.getRange('A15').format.font={bold:true};
summary.getRange('A16:A20').format.font={bold:true}; summary.getRange('B16:H20').format.wrapText=true;
summary.getRange('A1:H20').format.font.name='Arial';
summary.getRange('A:A').format.columnWidth=28; summary.getRange('B:B').format.columnWidth=18;
summary.getRange('D:D').format.columnWidth=38; summary.getRange('E:E').format.columnWidth=12; summary.getRange('F:F').format.columnWidth=50;
summary.getRange('16:20').format.rowHeight=34;

const working=wb.worksheets.add('COA Kerja 225');
title(working,'COA Kerja yang Direkomendasikan','225 akun: merger yang sudah didukung diterapkan, sedangkan family dengan nature belum jelas tetap dipisah.','G');
const th=['Target ID','Nama Akun Target','Status','Jumlah Family Lama','Jumlah Baris Detail','Dimensi/Subledger','Bukti yang Dibutuhkan'];
working.getRange('A5:G5').values=[th]; header(working.getRange('A5:G5'));
const wv=data.working_targets.map(x=>[x.target_key,x.target_account_name,x.status,x.legacy_family_count,x.legacy_detail_rows,x.dimensions,x.evidence_required]);
working.getRangeByIndexes(5,0,wv.length,7).values=wv;
working.getRange(`A6:G${5+wv.length}`).format.font={name:'Arial',size:9};
working.getRange(`B6:G${5+wv.length}`).format.wrapText=true;
working.getRange(`D6:E${5+wv.length}`).format.numberFormat='#,##0';
statusFormat(working.getRange(`C6:C${5+wv.length}`),'C',6,5+wv.length);
working.getRange(`C6:C${5+wv.length}`).conditionalFormats.add('containsText',{text:'HOLD_SEPARATE_PENDING_EVIDENCE',format:{fill:red,font:{color:'#9C0006'}}});
working.freezePanes.freezeRows(5); working.freezePanes.freezeColumns(2);
working.tables.add(`A5:G${5+wv.length}`,true,'WorkingAccounts');
['A','B','C','D','E','F','G'].forEach((c,i)=>working.getRange(`${c}:${c}`).format.columnWidth=[28,38,30,14,14,36,52][i]);

const targets=wb.worksheets.add('Skenario 142');
title(targets,'Skenario Optimasi Kondisional','142 target hanya digunakan jika seluruh evidence gate membuktikan bahwa merger tiap cluster tepat.','G');
targets.getRange('A5:G5').values=[th]; header(targets.getRange('A5:G5'));
targets.getRange('A5:G5').values=[th]; header(targets.getRange('A5:G5'));
const tv=data.targets.map(x=>[x.target_key,x.target_account_name,x.status,x.legacy_family_count,x.legacy_detail_rows,x.dimensions,x.evidence_required]);
targets.getRangeByIndexes(5,0,tv.length,7).values=tv;
targets.getRange(`A6:G${5+tv.length}`).format.font={name:'Arial',size:9};
targets.getRange(`B6:G${5+tv.length}`).format.wrapText=true;
targets.getRange(`D6:E${5+tv.length}`).format.numberFormat='#,##0';
statusFormat(targets.getRange(`C6:C${5+tv.length}`),'C',6,5+tv.length);
targets.freezePanes.freezeRows(5); targets.freezePanes.freezeColumns(2);
targets.tables.add(`A5:G${5+tv.length}`,true,'TargetAccounts');
['A','B','C','D','E','F','G'].forEach((c,i)=>targets.getRange(`${c}:${c}`).format.columnWidth=[28,38,24,14,14,36,52][i]);

const fam=wb.worksheets.add('Review 499 Family');
title(fam,'Register Review 499 Family','Setiap family legacy dipetakan tepat sekali ke target, penutupan, atau evidence gate.','M');
const fh=['Base Legacy','Nama Family Legacy','Baris Detail','Pakai E1','Target Lama','Dimensi Lama','Target ID','Nama Target','Status','Dimensi Target','Alasan Jev','Bukti Dibutuhkan'];
fam.getRange('A5:L5').values=[fh]; header(fam.getRange('A5:L5'));
const fv=data.families.map(x=>[x.legacy_base,x.legacy_family_name,x.legacy_detail_rows,x.uses_e1_unit,x.source_target_code,x.source_dimension,x.target_key,x.target_name,x.decision_status,x.target_dimension,x.jev_rationale,x.evidence_required]);
fam.getRangeByIndexes(5,0,fv.length,12).values=fv;
fam.getRange(`A6:L${5+fv.length}`).format.font={name:'Arial',size:8};
fam.getRange(`B6:L${5+fv.length}`).format.wrapText=true;
fam.getRange(`C6:D${5+fv.length}`).format.numberFormat='#,##0';
statusFormat(fam.getRange(`I6:I${5+fv.length}`),'I',6,5+fv.length);
fam.freezePanes.freezeRows(5); fam.freezePanes.freezeColumns(2);
fam.tables.add(`A5:L${5+fv.length}`,true,'FamilyReview');
const fw=[16,38,11,10,12,25,28,36,25,34,48,52];
'ABCDEFGHIJKL'.split('').forEach((c,i)=>fam.getRange(`${c}:${c}`).format.columnWidth=fw[i]);

const evidence=wb.worksheets.add('Evidence Gate');
title(evidence,'Evidence Gate','Dokumen yang harus tersedia sebelum target kondisional atau belum terselesaikan disetujui untuk migrasi.','F');
evidence.getRange('A5:F5').values=[['Area','Keputusan yang Ditahan','Bukti Minimum','Dampak Jika Tidak Ada','Pemilik Data','Status Input']]; header(evidence.getRange('A5:F5'));
const ev=[
 ['Bank dan deposito','Klasifikasi deposito, outstanding giro, pinjaman','Bank master, rekonsiliasi, maturity dan facility schedule','Salah klasifikasi kas atau jatuh tempo','Finance','Belum tersedia'],
 ['Aset','HGB, pre-opening, OE reserve/replacement, CIP, disposal','Asset register, kebijakan kapitalisasi, jurnal dan roll-forward','Aset/beban/provisi salah klasifikasi','Finance/Tax','Belum tersedia'],
 ['Persediaan','Kantong, transit, allowance dan kerusakan','Item master, metode valuasi, shipment aging, cut-off','Saldo transit atau HPP salah','Inventory/Finance','Belum tersedia'],
 ['Pajak','PPh, PPN, PBB dan Current Tax PPh25','SPT, tax ledger, bukti bayar dan rekonsiliasi','Aset/liabilitas/beban pajak tercampur','Tax','Belum tersedia'],
 ['Payroll dan biaya','Prefix payroll, maintenance, replacement OE','Payroll mapping, laporan manajemen, work order','Pelaporan biaya dan kapitalisasi salah','HR/Finance','Belum tersedia'],
 ['Pihak dan hutang','Allowance, Other Payable, Principal','Aging, kontrak, identitas kreditur dan settlement','Pihak atau nature liabilitas salah','Finance','Belum tersedia'],
 ['Pendapatan','Marketplace, retur/diskon dan sewa','Kontrak, settlement, tax dan gross/net policy','Pendapatan bruto/neto salah','Commercial/Finance','Belum tersedia'],
 ['Penutupan','Laba berjalan dan saldo laba','Closing configuration dan historical journals','Double-counting laba saat migrasi','Finance','Belum tersedia']
];
evidence.getRangeByIndexes(5,0,ev.length,6).values=ev;
evidence.getRange(`A6:F${5+ev.length}`).format.wrapText=true;
evidence.getRange(`F6:F${5+ev.length}`).format.fill=amber;
evidence.tables.add(`A5:F${5+ev.length}`,true,'EvidenceGates');
evidence.freezePanes.freezeRows(5);
['A','B','C','D','E','F'].forEach((c,i)=>evidence.getRange(`${c}:${c}`).format.columnWidth=[22,40,55,42,20,18][i]);

const sources=wb.worksheets.add('Sumber');
title(sources,'Sumber dan Metode','Dokumen dan output yang digunakan untuk register keputusan.','F');
sources.getRange('A5:F5').values=[['Jenis','Nama','Lokasi/URL','Peran','Tanggal','Catatan']]; header(sources.getRange('A5:F5'));
sources.getRange('A6:F11').values=[
 ['COA client','Laporan_Master_Account1.csv','/Users/hari/Downloads/Laporan_Master_Account1.csv','Sumber 7.528 baris dan 499 family','2026-09-18','Nama akun diperlakukan sebagai data, bukan instruksi'],
 ['Analisis awal','data.json','/Users/hari/itulah/.coa_dimension_review_20260918/data.json','Family, unit, dan kandidat dimensi','2026-09-18','Basis register 499 family'],
 ['Jev','Bank, aset, inventory, expense, interunit, tax, party, revenue dan exception reviews','/Users/hari/itulah/outputs/jev_*_review/','Keputusan typed dan evidence gate','2026-09-18','Model jev-1.13.0'],
 ['Dokumentasi','TypeSafe Introduction','https://docs.typesafe.ai/introduction','Metode pertanyaan atomik dan structured answers','2026-09-18','Choice questions dievaluasi independen'],
 ['Fakta client','Struktur legal','Percakapan client','Satu PT Perorangan; seluruh unit adalah site','2026-09-18','Tidak ada intercompany antarunit'],
 ['Batas hasil','225 kerja / 142 kondisional','Register ini','Rekomendasi evidence-aware','2026-09-18','Rentang perencanaan Jev 180-250; bukan saldo migrasi final']
];
sources.getRange('A6:F11').format.wrapText=true; sources.getRange('A1:F11').format.font.name='Arial';
sources.getRange('6:11').format.rowHeight=32;
sources.tables.add('A5:F11',true,'Sources');
['A','B','C','D','E','F'].forEach((c,i)=>sources.getRange(`${c}:${c}`).format.columnWidth=[18,34,58,40,14,48][i]);

for (const s of [summary,working,targets,fam,evidence,sources]) {
  const used=s.getUsedRange(); used.format.verticalAlignment='top';
}
await fs.mkdir(outDir,{recursive:true});
const output=await SpreadsheetFile.exportXlsx(wb);
await output.save(`${outDir}/COA_Final_Jev_Review.xlsx`);

for (const [sheetName,range,file] of [
  ['Ringkasan','A1:H20','preview_ringkasan.png'],
  ['COA Kerja 225','A1:G28','preview_working.png'],
  ['Skenario 142','A1:G28','preview_target.png'],
  ['Review 499 Family','A1:L24','preview_family.png'],
  ['Evidence Gate','A1:F14','preview_evidence.png'],
  ['Sumber','A1:F12','preview_sumber.png']
]) {
  const blob=await wb.render({sheetName,range,scale:1.3,format:'png'});
  await fs.writeFile(`${outDir}/${file}`,new Uint8Array(await blob.arrayBuffer()));
}

console.log((await wb.inspect({kind:'table',range:'Ringkasan!A1:H20',include:'values,formulas',tableMaxRows:25,tableMaxCols:10})).ndjson);
console.log((await wb.inspect({kind:'match',searchTerm:'#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!',options:{useRegex:true,maxResults:300},summary:'final formula error scan'})).ndjson);
