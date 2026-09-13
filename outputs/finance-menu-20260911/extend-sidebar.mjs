import fs from 'node:fs/promises';
import {SpreadsheetFile,FileBlob} from '@oai/artifact-tool';
import {forms,configs} from './sidebar-spec.mjs';
import {grids} from './sidebar-grids.mjs';
const out=new URL('.',import.meta.url).pathname;
const target=out+'Rancangan_Menu_dan_Tab_Finance.xlsx',source=out+'.before-sidebar.xlsx';
try{await fs.access(source);}catch{await fs.copyFile(target,source);}
const wb=await SpreadsheetFile.importXlsx(await FileBlob.load(source));
const menus=JSON.parse(await fs.readFile(out+'design-data.json','utf8'));
console.log((await wb.inspect({kind:'table',range:'03 Tagihan dan Pengeluaran!A14:H16',tableMaxRows:3,tableMaxCols:8,maxChars:1400})).ndjson);
if(process.argv.includes('--inspect-only')){const b=await wb.render({sheetName:'03 Tagihan dan Pengeluaran',range:'A11:H22',scale:1,format:'png'});await fs.writeFile(out+'sidebar-before.png',new Uint8Array(await b.arrayBuffer()));process.exit(0);}
const all=menus.flatMap((m,i)=>{if(configs[i].length!==m.tabs.length)throw Error('Tab mismatch '+m.name);return m.tabs.map((t,j)=>({menu:m.name,sheet:m.sheet,...t,...configs[i][j]}));});
for(const t of all)t.forms=[...new Set((t.forms+' '+t.actions.map(a=>a[4]).join(' ')).match(/F\d+/g)||[])].join(', ')||'—';
if(all.length!==54)throw Error('Expected 54 tabs');
for(const t of all){for(const id of t.forms.match(/F\d+/g)||[])if(!forms.find(f=>f.id===id))throw Error('Unknown form '+id);for(const id of t.grids.match(/S\d+/g)||[])if(!grids.find(g=>g.id===id))throw Error('Unknown grid '+id);}
const added=[];let tn=0;
function sheet(name,title,sub){const s=wb.worksheets.add(name);s.showGridLines=false;s.getRange('A1:H3').format.columnWidth=24;s.getRange('A1:H1').merge();s.getRange('A1').values=[[title]];s.getRange('A1:H1').format={font:{name:'Arial',size:17,bold:true,color:'#172B4D'},rowHeight:30};s.getRange('A2:H3').merge();s.getRange('A2').values=[[sub]];s.getRange('A2:H3').format={font:{name:'Arial',size:10,color:'#526176'},wrapText:true,verticalAlignment:'center',rowHeight:22};added.push({name,s});return s;}
function table(s,r,cols,rows,height=94){if(rows.some(x=>x.length!==cols.length))throw Error('Shape '+cols);s.getRangeByIndexes(r,0,1,cols.length).values=[cols];s.getRangeByIndexes(r+1,0,rows.length,cols.length).values=rows;s.getRangeByIndexes(r,0,rows.length+1,cols.length).format={font:{name:'Arial',size:10},wrapText:true,verticalAlignment:'top',rowHeight:height};s.getRangeByIndexes(r,0,1,cols.length).format={font:{name:'Arial',size:10,bold:true,color:'#FFFFFF'},fill:'#243B53',rowHeight:38};s.tables.add(`A${r+1}:${String.fromCharCode(64+cols.length)}${r+rows.length+1}`,true,'FinanceUX'+(++tn));cols.forEach((c,i)=>{if(c.includes('Rp'))s.getRangeByIndexes(r+1,i,rows.length,1).setNumberFormat('#,##0;[Red](#,##0);"—"');});return r+rows.length+2;}
function band(s,r,text){const q=s.getRangeByIndexes(r,0,1,8);q.merge();q.values=[[text]];q.format={font:{name:'Arial',size:12,bold:true,color:'#172B4D'},fill:'#E7EDF4',rowHeight:28};}
function note(s,r,label,text){s.getCell(r,0).values=[[label]];s.getRangeByIndexes(r,1,1,7).merge();s.getCell(r,1).values=[[text]];s.getRangeByIndexes(r,0,1,8).format={font:{name:'Arial',size:10,color:'#344054'},wrapText:true,verticalAlignment:'top',rowHeight:Math.max(36,Math.ceil(text.length/140)*15+12)};s.getCell(r,0).format.font.bold=true;}
function nextRow(s){const a=s.getUsedRange().address;const m=a.match(/\$?[A-Z]+\$?(\d+)$/);if(!m)throw Error('Cannot parse used range '+a);return Number(m[1])+2;}
const ds=sheet('16 Sidebar per Tab','Sidebar detail untuk seluruh tab Finance','54 tab tercakup. Header selalu menunjukkan identitas dokumen, unit, versi dan status yang relevan. Kolom/subtab hanya tampil bila dibutuhkan oleh objeknya.');
table(ds,4,['Menu / tab','Header detail','Bagian / subtab detail','Isi yang dibuka','Tabel anak','Form terkait','Bentuk layar','Aturan sumber'],all.map(t=>[t.menu+' / '+t.name,t.cols.filter(c=>c!=='Aksi').join('; ')+'; versi dokumen jika relevan',t.sections,t.detail,t.grids,t.forms,t.layout,'Dokumen sumber tetap satu. Status approval, posting, pembayaran dan rekonsiliasi ditampilkan terpisah jika relevan. Data sensitif mengikuti hak.']),124);ds.freezePanes.freezeRows(5);
const actions=all.flatMap(t=>t.actions.map(a=>[t.menu+' / '+t.name,a[0]+'\nPosisi: '+(/^(Buka|Lihat|Telusuri)/i.test(a[0])?'Isi panel':/balik|koreksi|nonaktif|buka ulang/i.test(a[0])?'Menu tindakan':/ubah|edit/i.test(a[0])?'Header sekunder':'Footer tindakan'),...a.slice(1),'Tanpa izin: sembunyikan. Tahap belum tepat: nonaktif dengan alasan. Periksa ulang izin, versi dan kondisi pada server.']));
const bs=sheet('17 Tombol Sidebar','Tombol, kondisi aktif dan akibatnya','Satu baris per tombol. Tidak semua tombol muncul bersamaan. Konfirmasi transaksi menampilkan sumber, unit, nominal, rekening dan dampak sebelum eksekusi.');table(bs,4,['Menu / tab','Tombol / posisi','Siapa','Aktif saat','Syarat / konfirmasi','Membuka form / sumber','Hasil','Jika belum memenuhi'],actions,110);bs.freezePanes.freezeRows(5);
const fields=forms.flatMap(f=>f.fields.map(v=>[f.id+' '+f.name,f.owner,...v,f.mode]));
const fsheet=sheet('18 Form dan Field','Field form Finance','35 jenis form. Field, sumber pilihan, kewajiban, validasi dan kondisi edit dirinci di sini. Nominal pajak, kebijakan dan mandat mengikuti keputusan yang sah; contoh tidak menetapkan aturan baru.');table(fsheet,4,['Form','Pemilik','Field','Bentuk input','Wajib','Sumber / pilihan','Validasi / batas','Dapat diubah saat'],fields,100);fsheet.freezePanes.freezeRows(5);
const flow=sheet('19 Alur Form dan Status','Form, tombol form dan perubahan status','Tombol sidebar detail membuka mode form yang jelas. Simpan draf belum posting. Tabel anak S01–S25 dijelaskan pada sheet 20–21.');table(flow,4,['Form','Dibuka dari','Urutan isi','Tabel anak','Tombol dalam form','Hasil','Batas setelah submit','Keluar / gagal'],forms.map(f=>[f.id+' '+f.name,[...new Set(all.filter(t=>t.forms.includes(f.id)).map(t=>t.menu))].join('; '),'Identitas/konteks → field '+f.id+' sesuai urutan sheet 18 → tabel anak bila ada → bukti → ringkasan tindakan. Rincian tab pemanggil: sheet 16–17.',f.grid,f.buttons,f.result,f.mode,'Bila ada perubahan: simpan draf jika didukung / buang / lanjut edit. Gagal simpan mempertahankan input; konflik versi meminta review ulang, bukan overwrite.']),145);flow.freezePanes.freezeRows(5);
let sr=forms.length+7;band(flow,sr++,'Status yang harus dibedakan');table(flow,sr,['Objek','Persetujuan','Pencatatan / pelaksanaan','Penyelesaian','Contoh tombol aktif','Yang tidak boleh disimpulkan'],[
['Tagihan','Draf → diajukan → disetujui / kembali / tolak','Belum tercatat → posted sesuai proses','Belum dibayar → sebagian → lunas','Bayar hanya untuk sisa yang sah','Disetujui tidak berarti dibayar'],
['Payment','Draf → disetujui','Disiapkan → diproses → berhasil / gagal','Alokasi dan rekonsiliasi terpisah','Eksekusi hanya sekali; retry memakai identitas yang sama','Terkirim ke bank belum tentu berhasil'],
['Giro','Disetujui sebelum terbit','Diterbitkan → cair / ditolak / dibatalkan','Outstanding sesuai bank sampai selesai','Catat cair hanya dengan bukti aktual','Jatuh tempo bukan tanggal cair otomatis'],
['Pajak','Dokumen/kewajiban direview','Status bayar terpisah dari status lapor','Bukti masing-masing tersimpan','Catat pelaporan dengan tanda terima','Dilaporkan tidak berarti sudah dibayar'],
['Payroll HR','Approved dan lengkap','Sealed → diterima Finance → kewajiban','Belum dibayar → sebagian → selesai','Terima batch hanya versi final sah','Finance tidak mengedit gaji HR'],
['Jurnal','Draf → review → disetujui','Diposting → dikoreksi/dibalik','Rekonsiliasi sesuai sumber','Posting hanya seimbang dan akun sah','Jurnal posted tidak dihapus untuk koreksi'],
['Periode','Persiapan → review','Terbuka → ditutup → dibuka ulang dengan mandat','Bukti dan versi terjaga','Tutup setelah kesiapan nyata','Mengubah label tidak membuktikan proses selesai']
],80);
const child=sheet('20 Contoh Subtable','Subtable dan contoh editable table','S01–S25 adalah tabel di dalam detail/form, bukan menu utama baru. Contoh antarblok berdiri sendiri. Input kuning hanya pada contoh S03, S06 dan S20; tabel lain memperlihatkan bentuk serta aturan aplikasi.');let cr=4;const ranges={};
for(const g of grids){const start=cr;band(child,cr++,g.id+' '+g.name);const header=cr;cr=table(child,cr,g.cols,g.rows,56);note(child,cr++,'Field dapat diedit',g.edit);note(child,cr++,'Tombol baris',g.actions);note(child,cr++,'Validasi',g.validation);note(child,cr++,'Sesudah submit',g.after);ranges[g.id]={start,header,first:header+2,last:header+1+g.rows.length,end:cr-1};cr+=2;}
const n=sheet('21 Aturan Edit Tabel','Aturan edit dan validasi tabel','Tabel anak mengikuti status dokumen induk. Sumber, saldo, pajak terhitung, snapshot HR, jurnal otomatis dan audit tidak menjadi sel editable untuk memaksa hasil.');table(n,4,['Tabel','Kunci baris','Field editable','Aksi baris','Validasi','Setelah submit','Perilaku app','Contoh Excel'],grids.map(g=>[g.id+' '+g.name,'ID baris + dokumen + versi; referensi sumber bila alokasi',g.edit,g.actions,g.validation,g.after,'Editor sel sesuai tipe. Simpan eksplisit; perubahan draf belum posting. Validasi di baris dan ringkasan.', ['S03','S06','S20'].includes(g.id)?'Input kuning dan rumus aktif sebagai ilustrasi.':'Contoh baca; aturan editable aplikasi dijelaskan.']),122);n.freezePanes.freezeRows(5);
let nr=grids.length+7;band(n,nr++,'Aturan interaksi bersama');table(n,nr,['Keadaan','Tampilan','Perilaku'],[
['Tambah baris','Baris draf dengan field wajib','Belum memengaruhi sumber final; tambah/undo sesuai izin'],['Hapus','Aksi pada baris draf','Baris posted/disetujui melalui koreksi; riwayat tidak dihapus'],['Pilih banyak','Jumlah dan cakupan pilihan','Aksi massal hanya jika setiap baris memenuhi izin/status; hasil parsial dijelaskan'],['Simpan gagal','Error per sel/baris dan ringkasan','Input tidak hilang; fokus ke kesalahan; jangan menutup form'],['Versi berubah','Pemberitahuan konflik','Tinjau versi terbaru dan bandingkan perubahan; jangan menimpa keputusan orang lain'],['Pengiriman tak pasti','Sedang diperiksa / gagal dengan alasan','Periksa hasil berdasarkan ID sama sebelum retry; cegah double payment/posting'],['Banyak baris','Cari, filter dan pemuatan bertahap','Total menjelaskan cakupan seluruh dokumen atau filter, bukan hanya halaman terlihat'],['Tidak punya akses','Data/tindakan terbatas','Izin diterapkan di server dan ekspor, bukan hanya menyembunyikan tombol'],['Belum siap','Tombol nonaktif + alasan','Contoh: akun belum terpetakan, periode tertutup, payroll belum sealed'],['Belum ada data','Kosong dengan tindakan relevan','Tidak mengganti ketidaktersediaan dengan nol atau angka contoh sebagai data nyata'],['Buka sumber lain','Tautan dokumen asli','Kembali mempertahankan filter/posisi daftar; hindari sidebar bertumpuk tanpa batas']
],72);
// Typed input examples and formula-driven results.
const r3=ranges.S03;child.getRange(`F${r3.first}:F${r3.last}`).format.fill='#FFF2CC';for(let r=r3.first;r<=r3.last;r++){child.getRange(`G${r}`).formulas=[[`=E${r}-F${r}`]];child.getRange(`F${r}`).dataValidation={rule:{type:'decimal',operator:'between',formula1:0,formula2:`E${r}`}};}
const r6=ranges.S06;child.getRange(`C${r6.first}:E${r6.last}`).format.fill='#FFF2CC';for(let r=r6.first;r<=r6.last;r++)child.getRange(`F${r}`).formulas=[[`=C${r}*D${r}-E${r}`]];
child.getRange(`C${r6.first}:D${r6.last}`).dataValidation={rule:{type:'decimal',operator:'greaterThan',formula1:0}};
for(let r=r6.first;r<=r6.last;r++)child.getRange(`E${r}`).dataValidation={rule:{type:'decimal',operator:'between',formula1:0,formula2:`C${r}*D${r}`}};
const r20=ranges.S20;child.getRange(`D${r20.first}:E${r20.last}`).format.fill='#FFF2CC';child.getRange(`D${r20.first}:E${r20.last}`).dataValidation={rule:{type:'decimal',operator:'greaterThanOrEqual',formula1:0}};
const balanceRow=r20.end+2;child.getRange(`A${balanceRow}`).values=[['Selisih jurnal Rp']];child.getRange(`D${balanceRow}`).formulas=[[`=SUM(D${r20.first}:D${r20.last})-SUM(E${r20.first}:E${r20.last})`]];child.getRange(`D${balanceRow}`).setNumberFormat('#,##0;[Red](#,##0);"—"');child.getRange(`F${balanceRow}`).formulas=[[`=IF(D${balanceRow}=0,"Seimbang","Belum seimbang")`]];
child.getRange(`A${balanceRow}:H${balanceRow}`).format.font={name:'Arial',size:10,bold:true};

const mock=sheet('22 Contoh Sidebar','Contoh detail, form dan pembayaran','Ilustrasi tagihan. Kiri: daftar. Kanan: panel detail yang berganti mode ketika form dibuka. Tombol adalah label desain, bukan tindakan aplikasi; angka hanya contoh.');mock.getRange('A1:D90').format.columnWidth=18;mock.getRange('E1:E90').format.columnWidth=3;mock.getRange('F1:H90').format.columnWidth=22;
function block(range,value,fill='#FFFFFF',bold=false,height=28){const q=mock.getRange(range);q.merge();q.values=[[value]];q.format={font:{name:'Arial',size:10,bold,color:fill==='#243B53'?'#FFFFFF':'#172B4D'},fill,wrapText:true,verticalAlignment:'center',rowHeight:height};}
table(mock,4,['Tagihan','Vendor','Total Rp','Status'],[['UI-BILL-001','Vendor A',2500000,'Disetujui'],['UI-BILL-002','Vendor B',1500000,'Draf']],44);
block('F5:H5','DETAIL TAGIHAN                              Tutup ×','#243B53',true);
block('F6:H6','UI-BILL-001 · HO · v2',undefined,true);
block('F7:H7','Disetujui · Tercatat · Belum dibayar','#FFF2CC');
block('F8:H8','Ringkasan  Rincian  Pembayaran  Jurnal  Riwayat','#E7EDF4',true);
block('F9:F9','Vendor',undefined,true);block('G9:H9','Vendor A');
block('F10:F10','Jatuh tempo',undefined,true);block('G10:H10','Tanggal jatuh tempo');
block('F11:H11','Rincian tagihan','#E7EDF4',true);
block('F12:G12','Jasa pemeliharaan');mock.getRange('H12').values=[[2000000]];mock.getRange('H12').setNumberFormat('#,##0');
block('F13:G13','Bahan operasional');mock.getRange('H13').values=[[500000]];mock.getRange('H13').setNumberFormat('#,##0');
block('F14:G14','Total / sisa Rp',undefined,true);mock.getRange('H14').formulas=[['=SUM(H12:H13)']];mock.getRange('H14').setNumberFormat('#,##0');
block('F15:H16','Contoh sederhana tanpa komponen pajak. Dokumen nyata mengikuti pajak/potongan yang berlaku pada sumber.');
block('F17:H18','Pembayaran: belum ada. Sesudah Bayar, PAY yang sama muncul di sini dan di Kas & Bank.');
block('F19:H20','Tagihan sudah tercatat: rincian baca saja. Koreksi melalui dokumen yang tertaut, bukan edit angka langsung.');
block('F22:G22','Bayar → F02','#243B53',true);block('H22:H22','Buka jurnal','#E7EDF4',true);
block('F23:H23','Tindakan lain: Ajukan koreksi / pembalikan');
block('A26:H26','Keadaan alternatif: form tagihan draf atau dikembalikan','#E7EDF4',true);
block('A28:D31','Detail berubah menjadi mode FORM. Contoh pada kanan memperlihatkan field dan tabel rincian editable. Form tidak terbuka bersamaan dengan detail aktif di atas.');
block('F28:H28','UBAH TAGIHAN                              Batal ×','#243B53',true);
block('F29:H29','UI-BILL-002 · HO · draf');
block('F30:F30','Vendor *',undefined,true);block('G30:H30','Vendor B ▾','#FFF2CC');
block('F31:F31','Nomor invoice *',undefined,true);block('G31:H31','Isi nomor vendor','#FFF2CC');
block('F32:F32','Tanggal *',undefined,true);block('G32:H32','Pilih tanggal','#FFF2CC');
block('F33:F33','Jatuh tempo *',undefined,true);block('G33:H33','Pilih tanggal / termin','#FFF2CC');
block('F34:H34','Rincian: uraian · kategori · qty · harga · potongan','#E7EDF4',true);
block('F35:G35','Jasa contoh, 1 × harga');mock.getRange('H35').values=[[1500000]];mock.getRange('H35').format.fill='#FFF2CC';mock.getRange('H35').setNumberFormat('#,##0');
block('F36:H36','+ Tambah baris · Ubah · Hapus baris draf');
block('F37:H38','Pajak/potongan: pilih aturan atau dokumen sah bila relevan. Total dihitung dari rincian.');
block('F39:H39','Lampiran *  Unggah / pratinjau / ganti draf');
block('F40:H41','Validasi: vendor/nomor tidak duplikat; kategori dan unit sah; error muncul di field atau baris tanpa menghapus input.');
block('F43:G43','Ajukan review','#243B53',true);block('H43:H43','Simpan draf','#E7EDF4',true);
block('F44:H44','Keluar: Simpan / Buang / Lanjut edit');
block('A47:H47','Keadaan berikutnya: Bayar membuka form pembayaran bersama','#E7EDF4',true);
block('F49:H49','SIAPKAN PEMBAYARAN                     Batal ×','#243B53',true);
block('F50:H50','Sumber UI-BILL-001 · HO · Vendor A');
block('F51:F51','Rekening *',undefined,true);block('G51:H51','Pilih rekening berizin ▾','#FFF2CC');
block('F52:F52','Metode *',undefined,true);block('G52:H52','Transfer / tunai / giro ▾','#FFF2CC');
block('F53:H53','Alokasi sumber: UI-BILL-001; sisa Rp2.500.000');
block('F54:G54','Nominal alokasi Rp');mock.getRange('H54').values=[[2500000]];mock.getRange('H54').format.fill='#FFF2CC';mock.getRange('H54').setNumberFormat('#,##0');
block('F55:H56','Metode giro membuka field nomor, bank dan jatuh tempo. Akun outstanding harus sesuai bank yang dipilih.');
block('F57:H58','Ajukan belum berarti dibayar. Eksekusi oleh Treasury setelah disetujui; hasil bank dan alokasi tercatat pada satu payment.');
block('F60:G60','Ajukan pembayaran','#243B53',true);block('H60:H60','Simpan draf','#E7EDF4',true);

// Append pointers to each existing menu while preserving original cells and tables.
const appendix=[];
for(const m of menus){const s=wb.worksheets.getItem(m.sheet);const r=nextRow(s);band(s,r,'Detail sidebar, tombol, form dan tabel anak');table(s,r+1,['Tab','Sidebar detail','Tombol','Form','Tabel anak','Bentuk layar'],all.filter(t=>t.menu===m.name).map(t=>[t.name,'Sheet 16: '+t.name,'Sheet 17: '+t.name,t.forms+'; sheet 18–19',t.grids+'; sheet 20–21',t.layout]),86);appendix.push({name:m.sheet,start:r});}
const home=wb.worksheets.getItem('00 Peta Menu');const hr=nextRow(home);note(home,hr,'Tambahan lengkap','Sheet 16–22 memuat sidebar detail untuk 54 tab, tombol beserta syarat/status, 35 form dan field, 25 subtable, aturan edit serta contoh layar detail, form tagihan dan pembayaran. Struktur 13 menu tetap sama.');
note(home,hr+1,'Cara mencoba','Di sheet 20, input kuning S03/S06/S20 dapat diubah untuk melihat contoh alokasi, neto baris dan keseimbangan jurnal. Itu ilustrasi Excel, bukan eksekusi transaksi aplikasi.');
console.log((await wb.inspect({kind:'match',searchTerm:'#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#SPILL!|#CALC!',options:{useRegex:true,maxResults:30},maxChars:1600})).ndjson);
console.log((await wb.inspect({kind:'table',range:`20 Contoh Subtable!A${r20.first}:H${balanceRow}`,tableMaxRows:9,tableMaxCols:8,maxChars:2200})).ndjson);
for(const x of added){const range=x.name==='22 Contoh Sidebar'?'A1:H23':x.name==='20 Contoh Subtable'?'A1:H12':'A1:H8';const b=await wb.render({sheetName:x.name,range,scale:1,format:'png'});await fs.writeFile(out+x.name.slice(0,2)+'-sidebar-preview.png',new Uint8Array(await b.arrayBuffer()));}
for(const [label,range]of [['form','A26:H44'],['payment','A47:H60'],['editable',`A${r6.start+1}:H${r6.end+1}`]]){const b=await wb.render({sheetName:label==='editable'?'20 Contoh Subtable':'22 Contoh Sidebar',range,scale:1,format:'png'});await fs.writeFile(out+label+'-sidebar-preview.png',new Uint8Array(await b.arrayBuffer()));}
// Inspect one appended menu and the appended guide; unchanged original sections retain their prior layout.
const ap=appendix.find(x=>x.name==='03 Tagihan dan Pengeluaran');const apb=await wb.render({sheetName:ap.name,range:`A${ap.start+1}:H${ap.start+7}`,scale:1,format:'png'});await fs.writeFile(out+'menu-appendix-preview.png',new Uint8Array(await apb.arrayBuffer()));
await(await SpreadsheetFile.exportXlsx(wb)).save(target);
await fs.writeFile(out+'sidebar-receipt.json',JSON.stringify({menus:menus.length,tabs:all.length,buttons:actions.length,forms:forms.length,fieldDefinitions:fields.length,subtables:grids.length,addedSheets:added.map(x=>x.name),appendix,exampleRanges:{allocation:r3,lines:r6,journal:r20,balanceRow}},null,2));
console.log('Updated Finance workbook');
