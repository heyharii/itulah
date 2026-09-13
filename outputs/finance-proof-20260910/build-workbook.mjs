import fs from 'node:fs/promises';
import {Workbook,SpreadsheetFile} from '@oai/artifact-tool';
const out=new URL('.',import.meta.url).pathname;
const p=JSON.parse(await fs.readFile(out+'coverage-proof.json','utf8'));
const r=JSON.parse(await fs.readFile(out+'runtime-evidence.json','utf8'));
const wb=Workbook.create();
const specs=[];
function table(name,title,note,headers,rows,widths,height=42){
 const s=wb.worksheets.add(name);s.showGridLines=false;
 s.getCell(0,0).values=[[title]];s.getCell(0,0).format.font={name:'Arial',size:16,bold:true};
 s.getCell(1,0).values=[[note]];s.getRangeByIndexes(1,0,2,headers.length).merge();s.getRangeByIndexes(1,0,2,headers.length).format={font:{name:'Arial',size:10,color:'#525252'},wrapText:true};
 s.getRangeByIndexes(4,0,1,headers.length).values=[headers];
 if(rows.length)s.getRangeByIndexes(5,0,rows.length,headers.length).values=rows;
 const all=s.getRangeByIndexes(4,0,rows.length+1,headers.length);all.format.font={name:'Arial',size:10};all.format.verticalAlignment='top';all.format.wrapText=true;
 all.format.rowHeight=height;
 s.getRangeByIndexes(4,0,1,headers.length).format={fill:'#253746',font:{name:'Arial',size:10,bold:true,color:'#FFFFFF'},rowHeight:32,wrapText:true};
 widths.forEach((w,i)=>s.getRangeByIndexes(0,i,rows.length+5,1).format.columnWidth=w);
 s.freezePanes.freezeRows(5);
 if(rows.length){const t=s.tables.add(s.getRangeByIndexes(4,0,rows.length+1,headers.length).address?.split('!').pop()||`A5:${String.fromCharCode(64+headers.length)}${rows.length+5}`,true,'T'+specs.length);t.showFilterButton=true;t.showBandedColumns=false;}
 specs.push({name,rows:rows.length,cols:headers.length,sheet:s});return s;
}
const join=x=>x.join(', ');
const flat=x=>typeof x==='object'?JSON.stringify(x):String(x??'');
const summaryRows=[
 ['Kode COA sumber',p.summary.accounts,'Cocok seluruhnya dengan kode aplikasi'],
 ['Akun detail 12 digit',p.summary.leaves,'Akun induk dihitung terpisah'],
 ['Akun detail aktif',p.summary.active_leaves,'Flag Y pada CSV'],
 ['Akun detail nonaktif',p.summary.inactive_leaves,'Untuk histori; izin posting perlu dibatasi'],
 ['Detail dengan binding',p.summary.bound_leaves,'Pemetaan peran; bukan seluruh workflow terbukti'],
 ['Detail aktif tanpa binding',p.summary.status_counts['Belum ada binding role'],'Tidak otomatis wajib diotomasi; sebagian butuh kebijakan/manual terkendali'],
 ['Binding tanpa aturan aktif',p.summary.status_counts['Binding tanpa aturan aktif'],'Role tersedia tetapi tidak digunakan deklarasi rule aktif'],
 ['Akun pada posting contoh',p.summary.tested_leaves,'35 akun pada 26 sampel rule; bukan audit semua varian'],
 ['Kelompok 7 digit',`${p.summary.families} + ${p.summary.derived_family_groups} turunan`,'75 induk sumber + 7010310 tanpa induk. Total 76 kelompok: 33 tanpa binding; 34 sebagian; 9 seluruh detail punya binding'],
 ['Perilaku 10 digit',p.summary.behaviors,'Owner usulan dipisahkan jika keluarga memiliki beberapa pekerjaan'],
 ['Kode khusus',p.summary.special_codes,'204001, 205001, 600104; belum ada keputusan pemetaan khusus'],
 ['Aturan / aktif',`${p.summary.rules} / ${p.summary.enabled_rules}`,'3 dinonaktifkan; tidak diubah dalam audit'],
 ['Pemeriksaan bawaan lulus',p.summary.builtin_passed,`Dari ${p.summary.builtin_checks}; berasal dari skenario repository`],
 ['Pemeriksaan tambahan lulus',p.summary.additional_passed,`Dari ${p.summary.additional_checks}; 20 belum memenuhi harapan cakupan/konsistensi`],
 ['Kode pada register tidak ada di COA',2,'101110900106 dan 402010100106'],
 ['Cakupan runtime','Prototipe lokal','Tidak menguji backend, database produksi, atau seluruh interaksi browser'],
 ['Arti owner','Usulan desain','Ditentukan dari objek kerja dan akun; bukan bukti kebijakan telah disetujui'],
 ['Arti laporan','Routing berdasarkan prefix','Neraca/Laba Rugi dan GL tersedia; klasifikasi detail belum disahkan'],
 ['Bukti jurnal asal','Tidak diperiksa ulang','Label ACTUAL_JOURNAL/CLIENT_STATEMENT di rule merupakan deklarasi kode'],
 ['Sumber','Laporan_Master_Account1.csv','CSV pengguna; tidak diubah'],
 ['Tanggal pemeriksaan','10 September 2026','Snapshot kode tersimpan di runtime-evidence.json']
];
const ss=table('Ringkasan','Pembuktian cakupan Finance','Kesimpulan: inventaris COA lengkap; alur operasional dan pemetaan belum lengkap. Tidak ada perubahan aplikasi atau transaksi produksi.',['Pemeriksaan','Hasil','Makna'],summaryRows,[34,24,88],34);
const aggRows=items=>items.map(a=>[a.code,a.name,join(a.owners),a.leaves,a.active_leaves,a.bound_leaves,a.tested_leaves,a.rules.length,a.report,a.note,a.source_row]);
table('Keluarga COA','Keluarga COA dan kode khusus','75 induk sumber + 1 kelompok turunan 7010310 + 3 kode khusus. Kelompok turunan bukan akun baru. Total rincian kelompok = 6.902. Owner usulan bukan bukti kebijakan telah disetujui.',['Kode','Nama','Owner usulan','Detail','Aktif','Binding','Uji contoh','Rule terkait','Laporan dari kode','Batas bukti / tindak lanjut','Baris CSV'],aggRows(p.families),[14,48,35,10,10,10,12,12,30,70,12],76);
table('Perilaku Akun','Perilaku akun 10 digit','496 akun induk perilaku. Pembagian ownership akrual, modal dan pendapatan lain dilakukan di tingkat ini. Detail unit ada di Seluruh COA.',['Kode','Nama','Owner usulan','Detail','Aktif','Binding','Uji contoh','Rule terkait','Laporan dari kode','Batas bukti / tindak lanjut','Baris CSV'],aggRows(p.behaviors),[16,48,35,10,10,10,12,12,30,70,12],76);
const accountRows=p.accounts.map(a=>[a.code,a.name,a.level,a.active?'Y':'N',a.unit,a.family,a.owner,a.status,join(a.roles),a.active_rules.length,join(a.tested_rules),a.report,a.source_row]);
const ac=table('Seluruh COA','Seluruh COA sumber','7.528 kode: 623 pada level agregasi (3 belum punya rincian), 6.902 detail dan 3 kode khusus. Role dapat dicocokkan ke Aturan Posting. Izin posting kode 10 digit tanpa rincian perlu dipastikan.',['Kode','Nama asli CSV','Digit','Aktif','Unit','Keluarga','Owner usulan','Status bukti','Role binding','Rule aktif','Rule uji contoh','Laporan dari kode','Baris CSV'],accountRows,[17,60,8,8,10,14,34,38,44,12,30,30,12],44);
const ruleRows=r.packages.map(a=>{const probe=r.ruleProbes.find(t=>t.id==='sample-'+a.constant);return[a.constant,a.package_id,a.event_type,a.activation.enabled?'Aktif':'Nonaktif',a.readiness,a.evidence.kind,join([...new Set(a.lines.map(l=>l.role))]),join(p.rule_routes[a.constant]),probe?.outcome.ok?'Posting contoh berhasil':probe?.outcome.code||'Belum diuji',a.activation.blocked_reason||'Satu sampel bukan seluruh unit/kelas/pihak lawan'];});
table('Aturan Posting','Aturan posting dan pintu menu','29 paket rule. Readiness dan jenis bukti merupakan label di kode; hasil uji contoh terpisah. Route kosong berarti tidak terdeteksi lewat call graph UI lokal, bukan bukti integrasi backend tidak ada.',['Konstanta rule','ID paket','Kejadian bisnis','Aktivasi','Readiness kode','Bukti dinyatakan','Role dalam deklarasi','Route UI terdeteksi','Hasil sampel','Batas bukti'],ruleRows,[28,32,30,12,15,23,75,80,28,65],112);
const labels={
 'bill-payment-register':'Pembayaran tagihan masuk register Payment yang sama',
 'giro-bank-dimension':'Giro Mandiri menggunakan outstanding giro Mandiri',
 'staff-loan-ledger':'Pengurangan piutang pegawai memiliki posting terkait',
 'interunit-family':'Pelunasan pendanaan mengurangi hutang pendanaan',
 'close-generates-result':'Tutup periode menghasilkan laba sistem yang diklaim',
 'register-account-validity':'Referensi akun fixture ada di COA'
};
table('Pengujian','Bukti pemeriksaan runtime','58 pemeriksaan bawaan + 56 tambahan. Belum terpenuhi mencakup gap cakupan serta cacat konsistensi, bukan hanya crash. Seluruhnya dijalankan pada salinan engine di direktori sementara.',['ID uji','Pemeriksaan','Harapan','Hasil aktual','Kesimpulan','Rujukan'],p.checks.map(c=>[c.id,labels[c.id]||c.description,flat(c.expected),flat(c.actual),c.pass?'Terpenuhi':'Belum terpenuhi',c.evidence]),[32,65,35,100,22,55],92);
table('Batas Menu','Pembuktian batas antarmenu','Satu sumber kejadian dapat tampil di beberapa menu. Yang harus sama adalah identitas dokumen, pemilihan akun dan status penyelesaiannya.',['Pertemuan menu','Objek yang harus tunggal','Bukti saat ini','Kesimpulan','Penyesuaian'],[
 ['Tagihan ↔ Kas & Bank','Payment dan alokasi tagihan','payBill menambah jurnal tetapi jumlah Payment tidak bertambah','Belum konsisten','Satukan payment_id dan allocation; daftar kas tetap membaca jurnal terkait'],
 ['Giro ↔ Rekening bank','Identitas instrumen dan bank','Giro Mandiri HO mengkredit outstanding giro BCA HO','Salah dimensi bank','Tambahkan bank_account_id pada resolusi outstanding giro'],
 ['Antarunit pembiayaan ↔ barang','Jenis hubungan dan pihak lawan','Settlement FINANCING mengurangi 2012302 hutang barang','Salah keluarga','Pisahkan rule berdasarkan family dan validasi pihak lawan'],
 ['Piutang pegawai ↔ Payroll','Potongan dan jurnal piutang','deductStaffLoan mengubah repaid tanpa jurnal baru','Register dan ledger belum terhubung','Hubungkan potongan ke posting payroll/penerimaan yang dapat ditelusuri'],
 ['Persediaan ↔ Antarunit','Pengiriman dan penerimaan','C006 dispatch lulus; C004/C013 gagal mapping; receipt nonaktif','Belum lengkap','Konfirmasi bukti penerimaan dan pasangan HO, lalu lengkapi binding'],
 ['Tutup buku ↔ Modal','Hasil periode yang dihitung','close mengubah status; tidak menambah jurnal atau memperbarui equityMoves','Klaim belum terbukti','Tentukan perhitungan/roll-forward laba dan tautkan ke periode'],
 ['Pendapatan ↔ Laporan','Sumber tagihan pendapatan','Management fee belum punya binding; 600104 diklasifikasi dari prefix 6','Perlu alur dan kebijakan','Tambahkan tagihan pendapatan jika diperlukan; putuskan klasifikasi kode khusus'],
 ['Pajak ↔ Payroll ↔ Kas & Bank','Kewajiban pajak dan pelunasannya','Dua pintu memanggil TAX_PAYMENT; payTax menyimpan filed_on','Pemisahan status belum lengkap','Satu tax obligation ID, status filed terpisah dari paid'],
 ['Akuntansi ↔ semua domain','Validasi akun yang sama','Empat uji akun manual terlarang justru berhasil diposting','Guardrail tidak seragam','Validasi aktif, induk/detail, izin unit pada satu pintu ledger']
],[36,40,85,28,80],78);
// Summary count checks remain formula-driven against delivered account rows.
ss.getRange('B6').formulas=[[`=COUNTA('Seluruh COA'!A6:A7533)`]];
ss.getRange('B7').formulas=[[`=COUNTIF('Seluruh COA'!C6:C7533,12)`]];
ss.getRange('B8').formulas=[[`=COUNTIFS('Seluruh COA'!C6:C7533,12,'Seluruh COA'!D6:D7533,"Y")`]];
ss.getRange('B9').formulas=[[`=COUNTIFS('Seluruh COA'!C6:C7533,12,'Seluruh COA'!D6:D7533,"N")`]];
ss.getRange('B11').formulas=[[`=COUNTIF('Seluruh COA'!H6:H7533,"Belum ada binding role")`]];
ss.getRange('B12').formulas=[[`=COUNTIF('Seluruh COA'!H6:H7533,"Binding tanpa aturan aktif")`]];
ss.getRange('B13').formulas=[[`=COUNTIF('Seluruh COA'!H6:H7533,"Posting contoh teruji")`]];
console.log((await wb.inspect({kind:'table',range:'Ringkasan!A5:C19',tableMaxRows:15,tableMaxCols:3,maxChars:3500})).ndjson);
console.log((await wb.inspect({kind:'match',searchTerm:'#REF!|#DIV/0!|#VALUE!|#NAME\\?|#NUM!|#N/A|#SPILL!',options:{useRegex:true,maxResults:20},maxChars:1000})).ndjson);
for(const spec of specs){const cols=Math.min(spec.cols,8);const end=String.fromCharCode(64+cols);const image=await wb.render({sheetName:spec.name,range:`A1:${end}8`,scale:1,format:'png'});await fs.writeFile(out+'preview-'+spec.name.replaceAll(' ','-')+'.png',new Uint8Array(await image.arrayBuffer()));}
await (await SpreadsheetFile.exportXlsx(wb)).save(out+'Pembuktian_Finance_COA.xlsx');
await fs.writeFile(out+'workbook-receipt.json',JSON.stringify({sheets:specs.map(({name,rows,cols})=>({name,rows,cols})),summary:p.summary},null,2));
console.log('Saved Pembuktian_Finance_COA.xlsx');
