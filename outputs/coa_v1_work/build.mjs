import fs from 'node:fs/promises';
import {Workbook,SpreadsheetFile} from '@oai/artifact-tool';
const dir='/Users/hari/itulah/outputs/coa_v1_work';
const output='/Users/hari/itulah/outputs/coa_v1_20260915';
await fs.mkdir(output,{recursive:true});
const base=JSON.parse(await fs.readFile(`${dir}/base.json`,'utf8'));
const fallback=JSON.parse(await fs.readFile(`${dir}/mapping_fallback.json`,'utf8'));
let review={mapping:[]};
try{review=JSON.parse(await fs.readFile(`${dir}/mapping_review.json`,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
const overrides=Array.isArray(review)?review:review.mapping??review.mappings;
if(!overrides) throw Error('Missing mapping array');
const merged=new Map(fallback.mapping.map(m=>[m.legacy_prefix,m]));
for(const m of overrides){
 const prior=merged.get(m.legacy_prefix);
 const normalized={...m,dimension_hint:prior?.dimension_hint||m.dimension_hint};
 normalized.confidence={high:'Nama / kelompok sepadan',medium:'Bersyarat',low:'Perlu keputusan'}[m.confidence]||m.confidence;
 if(!m.target_code){
  normalized.reason=prior?.reason||m.reason;
  if(m.legacy_prefix==='1011302001')normalized.reason='Prepaid PPh 21 belum terbukti substansinya. Target sengaja kosong sampai keputusan D03 selesai.';
  if(m.legacy_prefix.startsWith('1021607'))normalized.reason='Cadangan replacement OE belum punya kebijakan yang dikonfirmasi. Target kosong sampai keputusan D04 selesai; jangan otomatis anggap akumulasi penyusutan.';
  if(m.legacy_prefix.startsWith('7010215'))normalized.reason='Beban replacement OE menunggu kebijakan kapitalisasi/biaya aktual/cadangan pada D04. Target kosong sampai substansi jelas.';
  if(m.legacy_prefix.startsWith('2012303'))normalized.reason='Principal belum teridentifikasi. Target kosong sampai D05 selesai; nama toko tidak membuktikan utang afiliasi.';
  if(m.legacy_prefix==='600104')normalized.reason='Nama pendapatan berada di root biaya. 8101005 merupakan kandidat setelah memeriksa substansi jurnal; target belum disetujui.';
 }
 merged.set(m.legacy_prefix,normalized);
}
const mappings=[...merged.values()];
const mappingByCode=new Map(mappings.map(m=>[String(m.legacy_prefix),m]));
const accountByCode=new Map(base.accounts.map(a=>[a.code,a]));
const accountRows=new Map(base.accounts.map((a,i)=>[a.code,i+5]));
const wb=Workbook.create();
const tabs=['Panduan','COA 158','Aturan Posting','Mapping Legacy','Keputusan','Migrasi','Rekonsiliasi','Sumber'];
for(const name of tabs) wb.worksheets.add(name);
const specs=[];
function col(i){let s='';for(i++;i>0;i=Math.floor((i-1)/26))s=String.fromCharCode(65+(i-1)%26)+s;return s;}
function sheet(name,title,subtitle,headers,rows,widths){
 const s=wb.worksheets.getItem(name); const last=col(headers.length-1); const end=rows.length+4;
 s.showGridLines=false;
 s.getRange(`A1:${last}${end}`).format.font={name:'Arial',size:10,color:'#243247'};
 s.getRange(`A1:${last}${end}`).format.verticalAlignment='top';
 s.getRange('A1').values=[[title]];s.getRange('A1').format.font={name:'Arial',size:16,bold:true};
 s.getRange('A1').format.rowHeight=28;s.getRange('A2').format.rowHeight=23;s.getRange('A3').format.rowHeight=10;
 s.getRange('A2').values=[[subtitle]];s.getRange('A2').format.font={name:'Arial',size:10,color:'#526175'};
 s.getRange(`A4:${last}4`).values=[headers];
 s.getRange(`A4:${last}4`).format={fill:'#263C54',font:{name:'Arial',size:10,bold:true,color:'#FFFFFF'},wrapText:true,rowHeight:32};
 if(rows.length)s.getRange(`A5:${last}${end}`).values=rows;
 s.getRange(`A5:${last}${end}`).format.wrapText=true;
 s.getRange(`A5:${last}${end}`).format.rowHeight=62;
 widths.forEach((w,i)=>s.getRange(`${col(i)}4:${col(i)}${end}`).format.columnWidth=w);
 const table=s.tables.add(`A4:${last}${end}`,true,`Table${specs.length+1}`);table.showFilterButton=true;table.style='TableStyleLight1';
 s.freezePanes.freezeRows(4);s.freezePanes.freezeColumns(Math.min(headers.length,2));
 specs.push({name,end,last,cols:headers.length});return s;
}
const coaHeaders=['Kode baru','Nama akun','Kelompok laporan','Saldo normal','Status desain','Aktivasi produksi','Aturan ID','Modul sumber','Posting manual','Data wajib','Debit ketika','Kredit ketika','Batas penggunaan','Rekonsiliasi','Keputusan ID','Syarat aktivasi','Catatan perubahan'];
const coa=sheet('COA 158','COA v1 — 158 akun usulan','Status desain terpisah dari aktivasi produksi. Filter status dan Keputusan ID untuk tindak lanjut.',coaHeaders,base.accounts.map(a=>[a.code,a.name,a.group,a.normal,a.status,a.activation,a.rule,a.module,a.manual,a.required,a.debit,a.credit,a.exclude,a.recon,a.decision,a.gate,a.notes]),[14,43,28,23,22,24,13,25,33,55,46,46,65,55,15,55,50]);
coa.getRange('A5:A162').setNumberFormat('@');
coa.getRange('E5:E162').dataValidation={rule:{type:'list',values:['Siap konfigurasi','Bersyarat','Ditahan']}};
coa.getRange('F5:F162').dataValidation={rule:{type:'list',values:['Belum diaktifkan','Aktif','Nonaktif']}};
for(const [txt,fill] of [['Siap konfigurasi','#E9F2ED'],['Bersyarat','#FFF2CC'],['Ditahan','#FBE5DE']])coa.getRange('E5:E162').conditionalFormats.add('containsText',{text:txt,format:{fill}});
sheet('Aturan Posting','Aturan posting yang diusulkan','Seluruh aturan adalah rancangan kontrol; sesuaikan dengan engine ERP dan standar pelaporan yang dikonfirmasi.', ['Aturan ID','Kelompok transaksi','Modul sumber','Posting manual','Data wajib','Debit ketika','Kredit ketika','Larangan / batas penggunaan','Rekonsiliasi'],base.rules,[13,35,29,42,60,55,55,78,65]);

const migrationPrefixes=['1031801','1031802'];
const legacyMapRows=[];
let invalidTargets=[];
for(const r of base.legacy){
 const candidates=[...mappingByCode.keys()].filter(c=>r.code.startsWith(c)).sort((a,b)=>b.length-a.length);
 const m=candidates.length?mappingByCode.get(candidates[0]):null;
 let target=m?.target_code?String(m.target_code):'';
 if(target==='2202001')target='2107001';
 if(target && !accountByCode.has(target)){invalidTargets.push([r.code,target]);target='';}
 let action=target?'Gabung / petakan ke akun baru':'Perlu investigasi';
 let reason=m?.reason||'Belum ada dasar mapping dari nama dan hierarki; cek jurnal dan saldo.';
 if(r.has_children){action='Hierarki — cek posting aktual';target='';reason='Memiliki anak berdasarkan prefix kode. Jangan migrasikan saldo agregat bersama saldo anak. Jika pernah dipost langsung, petakan jurnal langsung tersendiri.';}
 else if(migrationPrefixes.some(p=>r.code.startsWith(p))){action='Migrasi khusus';target='';reason+=' Saldo tidak otomatis run-off; periksa substansi dan tentukan reclass/koreksi/write-off/lanjut pengakuan.';}
 else if(r.code.startsWith('1011302003')){action='Migrasi pajak';target='';reason='Prepaid PPh 29 tidak dipindah otomatis ke utang. Telusuri tahun pajak, pembayaran, kewajiban dan kemungkinan kelebihan bayar; lihat Migrasi M04.';}
 else if(/POTONGAN PEMBELIAN/i.test(r.name)){action='Alokasi inventory / HPP';target='';reason='Potongan pembelian dialokasikan ke stok tersisa dan HPP sesuai transaksi; bukan other income atau satu mapping saldo otomatis.';}
 const a=accountByCode.get(target);
 const confidence=r.has_children?'Hierarki inferred':m?.confidence||'Belum ditentukan';
 const status=r.has_children?'Cek posting parent':!target?'Perlu keputusan':a.status==='Ditahan'?'Target ditahan':'Usulan — perlu validasi';
 legacyMapRows.push([r.row,r.code,r.name,r.flag,r.level,r.parent,r.has_children?'Punya anak':'Tanpa anak',action,target,a?.name||'',status,confidence,r.unit,r.unit_basis,m?.dimension_hint||'',reason,'Belum diperiksa','Belum disetujui',a?.decision||'D01 / D12',target?'':'',r.has_children?'Posting aktual belum diketahui':'Leaf inferred; posting aktual belum diketahui',null]);
}
if(invalidTargets.length)throw Error(`Unknown targets ${JSON.stringify(invalidTargets.slice(0,20))}`);
const map=sheet('Mapping Legacy','Mapping seluruh legacy COA','Semua 7.528 baris berkode dicakup. Target adalah usulan; kolom kosong berarti keputusan diperlukan, bukan akun dihapus.', ['Baris CSV','Kode legacy','Nama legacy','Flag asli','Level asli','Parent inferred','Struktur inferred','Perlakuan usulan','Kode target usulan','Nama target usulan','Status awal mapping','Dasar keyakinan','Unit dari nama','Dasar unit','Dimensi / register lainnya','Alasan / data yang perlu dicek','Saldo dan jurnal','Persetujuan mapping','Keputusan ID awal','Status target terkini','Hak posting legacy','Jumlah kandidat leaf'],legacyMapRows,[12,19,52,11,11,19,22,31,18,43,28,24,17,40,58,85,24,25,18,23,40,22]);
map.getRange(`B5:B${legacyMapRows.length+4}`).setNumberFormat('@');map.getRange(`I5:I${legacyMapRows.length+4}`).setNumberFormat('@');
map.getRange(`Q5:Q${legacyMapRows.length+4}`).dataValidation={rule:{type:'list',values:['Belum diperiksa','Saldo nol dan tidak dipakai','Saldo/jurnal sudah diperiksa']}};
map.getRange(`R5:R${legacyMapRows.length+4}`).dataValidation={rule:{type:'list',values:['Belum disetujui','Disetujui','Perlu revisi']}};
map.getRange(`I5:I${legacyMapRows.length+4}`).dataValidation={rule:{type:'list',formula1:"'COA 158'!$A$5:$A$162"}};
map.getRange(`I5:I${legacyMapRows.length+4}`).format.fill='#FFF8E1';
map.getRange(`Q5:R${legacyMapRows.length+4}`).format.fill='#FFF8E1';
// Linked target attributes update when a reviewer changes the proposed target code.
map.getRange(`J5:J${legacyMapRows.length+4}`).formulas=legacyMapRows.map((r,i)=>[`=IF(I${i+5}="","",IF(COUNTIF('COA 158'!$A$5:$A$162,I${i+5})=1,INDEX('COA 158'!$B$5:$B$162,MATCH(I${i+5},'COA 158'!$A$5:$A$162,0)),"KODE TIDAK ADA"))`]);
map.getRange(`T5:T${legacyMapRows.length+4}`).formulas=legacyMapRows.map((r,i)=>[`=IF(I${i+5}="","",IF(COUNTIF('COA 158'!$A$5:$A$162,I${i+5})=1,INDEX('COA 158'!$E$5:$E$162,MATCH(I${i+5},'COA 158'!$A$5:$A$162,0)),"KODE TIDAK ADA"))`]);
map.getRange(`V5:V${legacyMapRows.length+4}`).formulas=legacyMapRows.map((r,i)=>[`=IF(G${i+5}="Tanpa anak",IF(I${i+5}="",0,1),0)`]);

const decisions=sheet('Keputusan','Keputusan yang belum selesai','Penanggung jawab adalah usulan peran. Tidak ada persetujuan atau pemilik bernama yang diasumsikan.', ['ID','Akun / lingkup','Status keputusan','Pokok keputusan','Bukti yang dibutuhkan','Usulan penanggung jawab','Perlakuan sementara'],base.decisions,[12,43,25,35,80,30,90]);
decisions.getRange(`C5:C${base.decisions.length+4}`).dataValidation={rule:{type:'list',values:['Belum diputuskan','Diputuskan','Perlu data tambahan']}};
const migRows=[
 ['M01','1031801 dan turunannya','Disposed Inventory','Tidak untuk transaksi baru sebelum nature jelas','Daftar SKU/aset, kuantitas fisik, saldo dan asal jurnal','Jika barang masih ada: klasifikasi/valuasi sesuai substansi. Jika sudah dilepas: rekonsiliasi disposal/write-off dan koreksi yang diperlukan.','Belum ditentukan; jangan parkir permanen sebagai other asset','Saldo source = reklasifikasi + koreksi disetujui + saldo yang valid tersisa'],
 ['M02','1031802 dan turunannya','Pre Opening dan akumulasi amortisasi','Tidak otomatis dibawa sebagai aset operasional baru','Rincian gross, akumulasi, biaya asal, periode dan kebijakan','Nilai apakah memenuhi pengakuan aset. Pilih reclass/koreksi/lanjut pengakuan; run-off hanya jika dibenarkan.','Belum ditentukan; akun migrasi sementara hanya jika perlu','Rekonsiliasi gross dan akumulasi terpisah; jangan hanya net lalu kehilangan jejak'],
 ['M03','1031803 dan turunannya','Contract In Progress (CIP)','Bersyarat','Kontrak/proyek, nature pengeluaran, completion status','Map 1202901 hanya bila memang aset dalam penyelesaian. Jangan samakan contract work dengan capital work tanpa bukti.','1202901 sebagai kandidat bersyarat','Schedule proyek = GL; koreksi klasifikasi didokumentasikan'],
 ['M04','Prepaid PPh 29 legacy','Pajak salah label','Tidak meneruskan label prepaid PPh 29','Bukti bayar, tahun pajak, perhitungan pajak, debit/kredit saldo','Jika pembayaran melunasi utang: settle utang tahun terkait. Jika kelebihan bayar: kaji aset pajak yang tepat.','2103006 hanya kandidat kewajiban; tidak otomatis memindahkan debit aset menjadi kredit utang','Rekonsiliasi beban, kredit, pembayaran dan utang per tahun'],
 ['M05','Potongan Pembelian legacy','Diskon pembelian','Posting baru net cost sesuai rancangan','Invoice/credit note, SKU dan proporsi barang sudah terjual','Alokasikan ke inventory/HPP; jurnal periode lama mengikuti periode cutover dan kebijakan koreksi','1104001 / 5101001 sesuai alokasi; bukan single target otomatis','Total potongan = alokasi stok + HPP + koreksi disetujui'],
 ['M06','204001','Giro Keluar','Mapping bersyarat','Nomor giro, rekening, penerima, status cair dan AP','Pilih 210200x menurut rekening aktual dan workflow; cek overlap saldo outstanding giro lain','Tidak satu target sampai rekening diketahui','Tidak double count AP dan outstanding giro'],
 ['M07','600104','Pendapatan lain-lain','Usulan penggabungan','Rincian jurnal dan periode','Map 8101005 hanya untuk nature lain-lain yang sesuai; klasifikasi material tetap dipisah','8101005','Jangan menjadi penyeimbang saldo migrasi'],
 ['M08','Seluruh parent dan flag Y/N','Hierarki dan izin posting','Jangan migrasi saldo agregat bersama anak','Data allow_posting/is_group; jurnal actual per kode','Pilih saldo per akun yang benar-benar menerima jurnal; saldo parent agregat tidak ditambahkan lagi','Mengikuti jurnal langsung dan mapping yang disetujui','Total source TB tidak double count parent/child'],
 ['M09','Semua akun bersaldo','Cutover','Belum dilakukan','TB cutoff, transaksi terbuka, subledger, saldo bank, register dan approver','Pisahkan mapping dari jurnal koreksi; muat saldo disetujui per entitas/unit/party/register','Mapping yang telah disetujui saja','Source TB + koreksi disetujui = opening GL baru = subledger terkait'],
];
sheet('Migrasi','Perlakuan migrasi legacy','Tidak ada saldo yang dihapus atau diubah dalam workbook ini. Tindakan dipilih setelah data saldo dan jurnal tersedia.', ['ID','Kode / lingkup legacy','Topik','Transaksi baru','Data yang diperlukan','Perlakuan yang diusulkan','Tujuan / kandidat','Kontrol saldo'],migRows,[12,35,32,50,65,100,65,70]);

const reconRows=[
 ['C01','Total TB per entitas','TB akhir source','Opening GL baru + koreksi terjelaskan','Per entitas dan mata uang',null,null,null,'Belum ada data'],
 ['C02','Kas','Cash count cutoff','GL kas per Unit','Per kas/Unit',null,null,null,'Belum ada data'],
 ['C03','Bank','Saldo buku terrekonsiliasi','GL bank','Per rekening; sertakan outstanding items',null,null,null,'Belum ada data'],
 ['C04','Piutang settlement','Daftar batch belum cair','GL settlement','Per provider dan batch',null,null,null,'Belum ada data'],
 ['C05','Hutang dagang','Aging supplier/invoice','GL AP','Per supplier dan mata uang',null,null,null,'Belum ada data'],
 ['C06','Persediaan','Valuasi SKU/gudang','GL persediaan','Gross; cadangan direkonsiliasi terpisah',null,null,null,'Belum ada data'],
 ['C07','Aset tetap','Register gross assets','GL gross assets','Per kategori dan Unit',null,null,null,'Belum ada data'],
 ['C08','Akumulasi aset','Register akumulasi','GL akumulasi','Per kategori dan Unit',null,null,null,'Belum ada data'],
 ['C09','Pinjaman','Saldo pokok loan schedule','GL pinjaman lancar + nonlancar','Per loan; bunga terpisah',null,null,null,'Belum ada data'],
 ['C10','Pajak','Schedule pajak per masa','GL pajak','Per jenis dan entitas; jangan netting lintas jenis',null,null,null,'Belum ada data'],
 ['C11','Afiliasi','Saldo piutang counterpart','Saldo hutang pasangan','Gunakan nilai magnitude dan jelaskan perbedaan',null,null,null,'Belum ada data'],
 ['C12','Uang muka penjualan','Outstanding order/customer','GL uang muka penjualan','Per order/customer',null,null,null,'Belum ada data'],
];
const rec=sheet('Rekonsiliasi','Rekonsiliasi saldo sebelum go-live','Template input, bukan hasil rekonsiliasi. Isi pasangan pada basis/tanda/mata uang sama; satu baris dapat dirinci di schedule pendukung.', ['ID','Kontrol','Sumber kiri','Sumber kanan','Basis perbandingan','Nilai kiri','Nilai kanan','Selisih kiri - kanan','Status perhitungan'],reconRows,[12,28,40,45,63,20,20,24,30]);
rec.getRange('F5:G16').format.fill='#FFF2CC';rec.getRange('F5:H16').setNumberFormat('#,##0.00;[Red](#,##0.00);–');
rec.getRange('H5:H16').formulas=reconRows.map((r,i)=>[`=IF(COUNT(F${i+5}:G${i+5})<2,"",F${i+5}-G${i+5})`]);
rec.getRange('I5:I16').formulas=reconRows.map((r,i)=>[`=IF(COUNT(F${i+5}:G${i+5})<2,"Belum ada data",IF(H${i+5}=0,"Cocok numerik; cek basis","Selisih perlu dijelaskan"))`]);

const sources=[
 ['S01','Laporan_Master_Account1.csv','Master legacy','Baris CSV tercantum di Mapping Legacy; 7.528 kode unik','Tanggal data tidak tercantum','Nama, kode, flag, level. Tidak memuat saldo/jurnal atau definisi flag.',''],
 ['S02','Usulan 157 akun dari lampiran percakapan','Rancangan pengguna','Tabel kode usulan','Versi percakapan','Basis daftar, direvisi menjadi 158 sesuai instruksi lanjutan',''],
 ['S03','Keputusan pengguna tentang 158 akun','Instruksi percakapan','Bunga leasing kembali; nama dan klasifikasi dikoreksi','2026-09-15','Baseline desain; tidak menganggap seluruh akun aktif produksi',''],
 ['S04','IAS 2 Inventories','Sumber primer','Cost, pengakuan beban, write-down','Diakses 2026-09-15','Rujukan prinsip inventory; standar pelaporan client belum dikonfirmasi','https://www.ifrs.org/issued-standards/list-of-standards/ias-2-inventories/'],
 ['S05','IAS 2 paragraf 11','Sumber primer','Trade discounts / rebates','Diperiksa dalam percakapan','Potongan pembelian mengurangi purchase cost','https://www.ifrs.org/content/dam/ifrs/publications/pdf-standards/english/2021/issued/part-a/ias-2-inventories.pdf'],
 ['S06','IFRS 16 Leases','Sumber primer','Aset hak-guna dan liabilitas sewa','Diakses 2026-09-15','Berlaku sebagai rujukan bersyarat sesuai standar client dan kontrak','https://www.ifrs.org/issued-standards/list-of-standards/ifrs-16-leases/'],
 ['S07','DJP: Penghitungan Angsuran PPh 25','Sumber primer','Angsuran PPh Pasal 25','Diakses 2026-09-15','PPh 25 merupakan angsuran; tidak dinamai beban pajak kini','https://www.pajak.go.id/id/penghitungan-angsuran-pph-pasal-25'],
 ['S08','Rancangan aturan dan mapping','Analisis usulan','COA 158, Aturan Posting, Mapping Legacy','2026-09-15','Pencocokan nama + prefix hierarki. Belum diverifikasi saldo, transaksi atau ERP.',''],
];
sheet('Sumber','Sumber dan batas pemeriksaan','Workbook tidak mengubah sistem client. Rujukan IFRS adalah prinsip pembanding, bukan penetapan standar pelaporan client.', ['ID','Sumber','Jenis','Bagian / referensi','Tanggal / versi','Penggunaan dan batas','URL'],sources,[12,48,26,65,28,95,80]);

const guideRows=[
 ['Lingkup','158 akun baseline desain; 7.528 baris legacy tercakup','Tidak ada akun diaktifkan atau saldo dipindah di sistem.'],
 ['Siap konfigurasi',null,'Nature dan aturan dasar tersedia; tetap uji jurnal, dimensi dan rekonsiliasi.'],
 ['Bersyarat',null,'Butuh konfigurasi/kontrak/policy sebelum aktivasi.'],
 ['Ditahan',null,'Jangan menerima transaksi baru sampai keputusan terkait selesai.'],
 ['Jumlah akun usulan',null,'Jumlah mengikuti tabel COA 158.'],
 ['Jumlah baris legacy',null,'Termasuk parent dan akun tanpa anak; tidak semuanya posting accounts.'],
 ['Tanpa anak (inferred)',null,'Ditentukan dari prefix kode, bukan flag hak posting.'],
 ['Punya anak (inferred)',null,'Periksa jurnal langsung; jangan hitung saldo agregat bersama saldo anak.'],
 ['Legacy tanpa anak dengan kandidat target',null,'Kandidat berdasarkan nama/hierarki; belum persetujuan migrasi.'],
 ['Legacy tanpa anak tanpa single target',null,'Investigasi, alokasi inventory/HPP atau migrasi khusus.'],
 ['Mapping disetujui',null,'Kolom persetujuan hanya diubah setelah pemeriksaan saldo/jurnal.'],
 ['Cara pakai 1','COA 158','Review status, aturan ID, syarat aktivasi dan Keputusan ID.'],
 ['Cara pakai 2','Mapping Legacy','Filter Tanpa anak. Periksa target, Unit dan register. Kosong bukan berarti hapus.'],
 ['Cara pakai 3','Keputusan dan Migrasi','Selesaikan isu substansi. Role penanggung jawab masih usulan.'],
 ['Cara pakai 4','Rekonsiliasi','Masukkan saldo aktual pada basis yang sama; tidak ada saldo contoh dibuat.'],
 ['Input reviewer','Sel kuning / dropdown','Kode target, pemeriksaan saldo, persetujuan dan input rekonsiliasi dapat diperbarui. Nama/status target mengikuti kode.'],
 ['Dimensi wajib umum','Entitas, Unit, source document','Department wajib bila dibutuhkan pemisahan fungsi/alokasi. Unit dari nama adalah kandidat.'],
 ['Bank','14 template giro/tabungan/deposito','Ganti/pecah menurut rekening aktual. Tidak menambah bank fiktif untuk mempertahankan jumlah.'],
 ['Posting parent','Belum diketahui','Flag Y/N asli dipertahankan; arti flag tidak diasumsikan. Seluruh level tetap dicakup.'],
 ['Data yang belum tersedia','TB cutoff, jurnal, subledger, master rekening','Akibatnya status aktif, saldo nol, klasifikasi hukum dan mapping final belum bisa diverifikasi.'],
 ['Standar pelaporan','Belum dikonfirmasi','Aturan pajak, sewa, HGB, kapitalisasi dan pengakuan legacy perlu keputusan client.'],
 ['Unit / pihak / objek','Dipisahkan dari natural account','Tidak menebak pihak dari nama toko. Register aset/SKU/loan menjaga detail.'],
 ['Aktivasi produksi','Belum diaktifkan untuk semua akun','Status desain tidak sama dengan izin posting; akun Ditahan tidak boleh diaktifkan sebelum keputusan.'],
 ['Akun ditahan tetapi diaktifkan',null,'Jika jumlah lebih dari nol, periksa status desain dan aktivasi produksi.'],
];
const guide=sheet('Panduan','Retail OS — daftar akun dan mapping','Baseline 158 akun • rancangan kerja 15 September 2026 • seluruh mapping masih usulan', ['Topik','Jumlah / pengaturan','Penjelasan'],guideRows,[45,48,105]);
guide.freezePanes.unfreeze();
guide.getRange('A5:C28').format.rowHeight=35;
guide.getRange('B6').formulas=[[`=COUNTIF('COA 158'!$E$5:$E$162,"Siap konfigurasi")`]];
guide.getRange('B7').formulas=[[`=COUNTIF('COA 158'!$E$5:$E$162,"Bersyarat")`]];
guide.getRange('B8').formulas=[[`=COUNTIF('COA 158'!$E$5:$E$162,"Ditahan")`]];
guide.getRange('B9').formulas=[[`=COUNTA('COA 158'!$A$5:$A$162)`]];
guide.getRange('B10').formulas=[[`=COUNTA('Mapping Legacy'!$B$5:$B$${legacyMapRows.length+4})`]];
guide.getRange('B11').formulas=[[`=COUNTIF('Mapping Legacy'!$G$5:$G$${legacyMapRows.length+4},"Tanpa anak")`]];
guide.getRange('B12').formulas=[[`=COUNTIF('Mapping Legacy'!$G$5:$G$${legacyMapRows.length+4},"Punya anak")`]];
guide.getRange('B13').formulas=[[`=SUM('Mapping Legacy'!$V$5:$V$${legacyMapRows.length+4})`]];
guide.getRange('B14').formulas=[['=B11-B13']];
guide.getRange('B15').formulas=[[`=COUNTIF('Mapping Legacy'!$R$5:$R$${legacyMapRows.length+4},"Disetujui")`]];
guide.getRange('B28').formulas=[[`=COUNTIFS('COA 158'!$E$5:$E$162,"Ditahan",'COA 158'!$F$5:$F$162,"Aktif")`]];
guide.getRange('B6:B15').setNumberFormat('#,##0');
console.log('COVERAGE',JSON.stringify(guide.getRange('B13').values),legacyMapRows.filter(r=>r[6]==='Tanpa anak'&&r[8]).length);
if(guide.getRange('B13').values[0][0]!==legacyMapRows.filter(r=>r[6]==='Tanpa anak'&&r[8]).length)throw Error('Mapping coverage count mismatch');

// Verify linked behavior with a reversible reviewer edit before export.
rec.getRange('F5:G5').values=[[100,97]];
if(rec.getRange('H5').values[0][0]!==3)throw Error('Reconciliation formula failed');
rec.getRange('F5:G5').clear({applyTo:'contents'});
if(rec.getRange('I5').values[0][0]!=='Belum ada data')throw Error('Missing inputs falsely accepted');
const testRow=legacyMapRows.findIndex(r=>r[8])+5;
const prior=map.getRange(`I${testRow}`).values[0][0];
map.getRange(`I${testRow}`).values=[['8201002']];
if(map.getRange(`J${testRow}`).values[0][0]!=='Biaya Bunga Leasing')throw Error('Mapping lookup failed');
map.getRange(`I${testRow}`).values=[[prior]];
console.log((await wb.inspect({kind:'table',range:'Panduan!A5:C15',tableMaxRows:11,tableMaxCols:3,maxChars:3500})).ndjson);
console.log((await wb.inspect({kind:'match',searchTerm:'#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!',options:{useRegex:true,maxResults:30},maxChars:1500})).ndjson);
for(const spec of specs){
 const preview=await wb.render({sheetName:spec.name,range:`A1:${col(Math.min(spec.cols,4)-1)}${Math.min(spec.end,9)}`,scale:1.25,format:'png'});
 await fs.writeFile(`${dir}/preview_${spec.name.replaceAll(' ','_')}.png`,new Uint8Array(await preview.arrayBuffer()));
}
for(const [name,range,file] of [['COA 158','E4:J8','coa_rules'],['Aturan Posting','E4:I7','posting_detail'],['Mapping Legacy','H4:L9','mapping_targets']]){
 const preview=await wb.render({sheetName:name,range,scale:1,format:'png'});
 await fs.writeFile(`${dir}/preview_${file}.png`,new Uint8Array(await preview.arrayBuffer()));
}
const xlsx=await SpreadsheetFile.exportXlsx(wb);await xlsx.save(`${output}/Retail_OS_COA_v1_158.xlsx`);
await fs.writeFile(`${dir}/verification.json`,JSON.stringify({accounts:base.accounts.length,legacyRows:legacyMapRows.length,mappingPrefixRules:mappings.length,withTarget:legacyMapRows.filter(r=>r[8]).length,withoutTarget:legacyMapRows.filter(r=>r[6]==='Tanpa anak'&&!r[8]).length,sheets:specs,invalidTargets},null,2));
console.log('SAVED '+output+'/Retail_OS_COA_v1_158.xlsx');
