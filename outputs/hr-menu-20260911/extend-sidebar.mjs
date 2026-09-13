import fs from 'node:fs/promises';
import {Workbook,SpreadsheetFile,FileBlob} from '@oai/artifact-tool';
const out=new URL('.',import.meta.url).pathname;
const target=out+'Rancangan_HR_Menu_Kewenangan_dan_Form.xlsx';
const source=out+'.before-sidebar.xlsx';
try{await fs.access(source);}catch{await fs.copyFile(target,source);}
const wb=await SpreadsheetFile.importXlsx(await FileBlob.load(source));
const design=JSON.parse(await fs.readFile(out+'design.json','utf8'));
const baseline=(await wb.inspect({kind:'table',range:'12 Form dan Field!A5:H9',tableMaxRows:5,tableMaxCols:8,maxChars:2600})).ndjson;
console.log(baseline);
if(process.argv.includes('--inspect-only')){const b=await wb.render({sheetName:'13 Perilaku Sidebar',range:'A1:H9',scale:1,format:'png'});await fs.writeFile(out+'sidebar-before.png',new Uint8Array(await b.arrayBuffer()));process.exit(0);}
const newSheets=[];let tn=0;
function sheet(name,title,context){const s=wb.worksheets.add(name);s.showGridLines=false;s.getRange('A1:H3').format.columnWidth=24;s.getRange('A1:H1').merge();s.getRange('A1').values=[[title]];s.getRange('A1:H1').format={font:{name:'Arial',size:17,bold:true,color:'#172B4D'},rowHeight:30};s.getRange('A2:H3').merge();s.getRange('A2').values=[[context]];s.getRange('A2:H3').format={font:{name:'Arial',size:10,color:'#526176'},wrapText:true,verticalAlignment:'center',rowHeight:22};newSheets.push({name,s});return s;}
function table(s,r,cols,rows,height=88){if(rows.some(x=>x.length!==cols.length))throw Error('shape '+cols);s.getRangeByIndexes(r,0,1,cols.length).values=[cols];s.getRangeByIndexes(r+1,0,rows.length,cols.length).values=rows;s.getRangeByIndexes(r,0,rows.length+1,cols.length).format={font:{name:'Arial',size:10},wrapText:true,verticalAlignment:'top',rowHeight:height};s.getRangeByIndexes(r,0,1,cols.length).format={font:{name:'Arial',size:10,bold:true,color:'#FFFFFF'},fill:'#243B53',wrapText:true,rowHeight:38};s.tables.add(`A${r+1}:${String.fromCharCode(64+cols.length)}${r+rows.length+1}`,true,'DetailUX'+(++tn));cols.forEach((c,i)=>{if(c.includes('Rp'))s.getRangeByIndexes(r+1,i,rows.length,1).setNumberFormat('#,##0;[Red](#,##0);"—"');});return r+rows.length+2;}
function note(s,r,label,text){s.getCell(r,0).values=[[label]];s.getRangeByIndexes(r,1,1,7).merge();s.getCell(r,1).values=[[text]];s.getRangeByIndexes(r,0,1,8).format={font:{name:'Arial',size:10,color:'#344054'},wrapText:true,verticalAlignment:'top',rowHeight:Math.max(36,Math.ceil(text.length/140)*15+12)};s.getCell(r,0).format.font.bold=true;}
function band(s,r,text){const q=s.getRangeByIndexes(r,0,1,8);q.merge();q.values=[[text]];q.format={font:{name:'Arial',size:12,bold:true,color:'#172B4D'},fill:'#E7EDF4',rowHeight:28};}

// Reusable child grids are referenced by ID from each sidebar, rather than duplicated sources.
const grids=[
['S01','Komponen usulan kompensasi','F06; F12','Komponen|Jenis|Nilai Rp|Mulai berlaku|Dasar|Sumber|Perubahan|Aksi baris',[
['Gaji pokok','Penghasilan',4000000,'Sesuai tanggal form','Usulan penerimaan','HIR-001','Baru','Ubah'],['Tunjangan tetap','Penghasilan',300000,'Sesuai tanggal form','Usulan penerimaan','HIR-001','Baru','Hapus draf']],
'Komponen (pilihan), nominal dan dasar; hanya pada draf/dikembalikan. Tanggal mengikuti header kecuali kebijakan membolehkan beda tanggal.',
'Tambah baris; ubah; hapus baris draf. Komponen sah dan tidak ganda; nominal sesuai jenis. Jumlah terhitung, tidak diedit.',
'Saat diajukan semua baris terkunci. Reviewer melihat delta. Revisi material meminta approval versi baru.'],
['S02','Checklist kesiapan / serah terima','F05','Tugas|Owner|Tenggat|Wajib|Status|Bukti|Sumber|Aksi baris',[
['Lengkapi kontrak','HR unit','Tanggal mulai','Ya','Belum selesai',null,'Kontrak','Buka tugas'],['Aktifkan akun','Admin akun','Tanggal mulai','Ya','Menunggu keputusan',null,'ACC-001','Buka sumber']],
'Owner/tenggat oleh koordinator kasus; hasil dan bukti oleh owner tugas. Status proses akun/payroll otomatis dari sumber.',
'Tambah tugas tambahan; tandai selesai; tidak berlaku dengan alasan sesuai mandat. Tugas wajib tidak dihapus untuk memaksa selesai.',
'Setelah kasus selesai, tugas dibaca saja. Koreksi melalui buka kasus sesuai mandat dan alasan.'],
['S03','Riwayat kontrak dan penempatan','F03','Versi|Unit|Jabatan|Jenis kontrak|Mulai|Akhir|Keputusan|Aksi',[
['v1','Toko 01','Kasir','Jenis disahkan','Tanggal terdahulu','Sebelum mutasi','DEC-001','Buka versi'],['v2','Toko 02','Kasir','Jenis disahkan','Tanggal efektif',null,'DEC-002','Buka versi']],
'Tidak dapat diedit di detail. Form F03 menyimpan usulan perubahan terpisah.',
'Buka versi; ajukan perubahan. Cek masa berlaku dan bentrok penempatan/kontrak.',
'Riwayat tidak ditimpa. Keputusan baru menghasilkan versi bertanggal yang dapat ditelusuri.'],
['S04','Perbandingan sebelum dan sesudah','F02; F03; F04; F12; F15; F16; F17','Field|Nilai saat ini|Nilai usulan|Berlaku mulai|Alasan|Sumber|Dampak|Tinjauan',[
['Unit','Toko 01','Toko 02','Tanggal efektif','Mutasi','CHG-001','Akses dan payroll','Perlu review'],['Peran akses','Karyawan','Karyawan','Tanggal efektif','Cakupan unit berubah','ACC terkait','Cakupan unit','Perlu review']],
'Baca saja bagi reviewer. Pemohon mengubah nilai usulan lewat form sumber dalam draf/dikembalikan.',
'Buka sumber; tinjau perubahan. Masking field sensitif mengikuti hak, termasuk pada versi lama.',
'Delta dan keputusan disimpan per versi. Tidak mengedit nilai lama di grid.'],
['S05','Kalender roster','F07','Pegawai|Sen|Sel|Rab|Kam|Jum|Sab|Min',[
['Pegawai A','Pagi','Pagi','Libur','Pagi','Pagi','Pagi','Libur'],['Pegawai B','Siang','Libur','Siang','Siang','Siang','Libur','Siang']],
'Sel hari memakai dropdown shift/libur; memilih sel membuka detail jam/lokasi. Header unit dan minggu wajib.',
'Salin pola; isi rentang; kosongkan sel draf; undo sebelum simpan. Validasi bentrok, penempatan, cuti dan versi shift.',
'Kalender besar memakai halaman penuh. Jadwal terbit hanya diubah melalui revisi versi, bukan edit diam-diam.'],
['S06','Bukti presensi dan koreksi','F08','Kejadian|Tanggal|Jam asli|Sumber|Jam usulan|Alasan|Keputusan|Aksi',[
['Masuk','Tanggal kerja',null,'Belum tersambung',null,null,null,'Periksa sumber'],['Keluar','Tanggal kerja',null,'Belum tersambung','17:05','Lupa keluar','Menunggu','Buka COR-001']],
'Data asli baca saja. Jam/klasifikasi usulan hanya di F08, bukan grid asli.',
'Buka sumber; ajukan koreksi; lihat bukti. Tidak membuat presensi aktual dari rencana roster.',
'Periode terkunci menampilkan penghalang dan jalur revisi yang sah. Data tidak tersedia tetap kosong.'],
['S07','Checklist kelengkapan periode','F09','Pemeriksaan|Jumlah terbuka|Kesiapan|Sumber|Owner|Dampak|Aksi|Bukti',[
['Koreksi',1,'Belum siap','Koreksi kehadiran','HR unit','Fakta belum final','Buka daftar',null],['Sumber presensi',null,'Belum tersedia','Integrasi presensi','Pemilik sistem','Tidak dapat final','Buka sumber',null]],
'Jumlah dan kesiapan dihitung dari sumber. Reviewer hanya menambah penjelasan/bukti pada pengecualian yang memang diperbolehkan.',
'Buka baris masalah. Checklist tidak dapat dicentang manual untuk mengabaikan fakta yang belum lengkap.',
'Saat ditutup simpan snapshot fakta. Pembukaan berdampak payroll final mengikuti keputusan pusat dan review Finance.'],
['S08','Rincian tanggal cuti / izin','F10','Tanggal|Jadwal|Jenis hari|Durasi hari|Hak terpakai hari|Status|Sumber|Aksi',[
['Tanggal mulai','Pagi','Kerja',1,null,'Usulan','LEV-001','Lihat dasar']],
'Tanggal/jenis dipilih di form; rincian per hari dan pemakaian hak terhitung dari kebijakan yang tersedia.',
'Tinjau bentrok dan jadwal. Setengah hari hanya jika kebijakan mendukung; bukan input bebas semua durasi.',
'Sebelum kebijakan ada, pemakaian hak tidak dianggap nol. Keputusan memperbarui sumber yang sama.'],
['S09','Rencana dan realisasi lembur','F11','Pegawai|Tanggal|Rencana menit|Aktual menit|Kesediaan|Bukti|Verifikasi|Aksi',[
['Pegawai A','Tanggal kerja',120,null,'Setuju',null,'Belum diverifikasi','Buka rincian']],
'HR/atasan mengisi rencana dalam mandat. Realisasi diisi/diverifikasi setelah kerja dengan sumber bukti; persetujuan pegawai tidak diedit HR.',
'Tambah pegawai saat draf; ubah rencana; catat realisasi; buka persetujuan. Bedakan rencana, kesediaan dan fakta.',
'Sesudah fakta masuk periode tertutup, perubahan melalui koreksi versi. Tidak menyalin rencana menjadi aktual otomatis.'],
['S10','Mutasi hak cuti','F17','Tanggal|Jenis mutasi|Perubahan hari|Saldo setelah hari|Dasar|Keputusan|Sumber|Aksi',[
['Tanggal berlaku','Penyesuaian',1,null,'Menunggu kebijakan','Menunggu','ADJ-001','Review']],
'Grid riwayat baca saja. Nominal hari usulan, tanggal dan alasan di F17.',
'Ajukan penyesuaian; buka sumber. Tanpa dasar hak, saldo tidak dikarang; mutasi tidak menghapus pemakaian lama.',
'Keputusan menambah mutasi baru. Perbaikan menggunakan mutasi koreksi dengan jejak.'],
['S11','Rincian pegawai dalam payroll','F13','Pegawai|Unit biaya|Penghasilan Rp|Potongan Rp|Neto Rp|Kontribusi perusahaan Rp|Kelengkapan|Aksi',[
['Pegawai A','Toko 01',4300000,null,null,null,'Komponen belum lengkap','Buka komponen']],
'Identitas dan gaji berlaku baca saja. Input hanya komponen variabel/penyesuaian yang memang diizinkan, melalui S12.',
'Buka pegawai; lihat sumber fakta; tinjau selisih; tandai verifikasi. Angka belum lengkap tidak menjadi nol/siap bayar.',
'Grid batch halaman penuh. Sesudah diajukan, komponen terkunci; revisi menghasilkan versi dan review ulang.'],
['S12','Komponen dan penyesuaian payroll','F13','Komponen|Jenis|Nominal Rp|Dasar/satuan|Sumber|Cara isi|Alasan|Aksi',[
['Gaji pokok','Penghasilan',4000000,'Perjanjian berlaku','SAL-001','Terhitung',null,'Buka sumber'],['Penyesuaian','Penghasilan',100000,'Dokumen disetujui','ADJ-002','Input terbatas','Koreksi periode','Ubah draf']],
'Baris otomatis tidak dapat diedit. Baris penyesuaian membutuhkan jenis, nominal, alasan, bukti dan tanggal/periodenya.',
'Tambah penyesuaian; ubah/hapus hanya draf; pratinjau dampak; buka sumber. Cegah komponen/rujukan duplikat.',
'Semua perubahan material setelah verifikasi meminta verifikasi/approval ulang versi terkait.'],
['S13','Serah terima dan pembayaran Finance','F14','Versi HR|ID serah terima|Finance|Kewajiban|Pembayaran|Nilai Rp|Status|Aksi',[
['v2','HOF-001','Diterima','FIN-PR-001',null,4500000,'Belum dibayar','Buka Finance']],
'Tidak dapat mengedit hasil Finance, ID, versi atau nominal snapshot di sidebar HR.',
'Kirim versi lengkap/approved/sealed; kirim ulang versi sama secara idempotent; buka hasil; ajukan revisi.',
'Batch dibayar tidak ditimpa. Status diterima, kewajiban tercatat dan dibayar ditampilkan terpisah.'],
['S14','Peran dan cakupan akses','F15','Aplikasi|Peran|Cakupan|Mulai|Akhir|Dasar|Status|Aksi baris',[
['Karyawan','Layanan diri','Diri sendiri','Tanggal mulai',null,'Pekerjaan','Usulan','Ubah'],['People','HR unit','Toko 01','Tanggal tugas','Akhir tugas','Penugasan HR','Usulan','Hapus draf']],
'Dropdown aplikasi, peran, cakupan dan masa berlaku. Hanya kombinasi yang boleh diminta; bukan role teknis bebas.',
'Tambah grant; ubah; hapus draf. Validasi kesesuaian tugas, masa berlaku, cakupan dan grant duplikat.',
'Pusat memutuskan; admin melaksanakan. Grant saat ini tetap baca saja. Tidak ada password/token pada grid HR.'],
['S15','Parameter kebijakan / mandat','F16','Parameter|Tipe|Nilai usulan|Satuan|Lingkup|Mulai berlaku|Dasar|Status',[
['Reviewer penerimaan','Peran','HR pusat',null,'14 unit','Tanggal berlaku','Mandat organisasi','Usulan']],
'Form dinamis sesuai kebijakan: pilihan, angka atau tanggal. Tidak membiarkan semua parameter menjadi teks bebas.',
'Tambah/ubah baris yang sah; cek versi bertumpuk dan objek terdampak; tampilkan delta.',
'Publikasi hanya sesudah keputusan berwenang. Hak akses penetapan kebijakan tidak berasal dari pilihan unit HO.'],
['S16','Dokumen pendukung','Semua form dengan bukti','Dokumen|Jenis|Versi|Diupload oleh|Tanggal|Akses|Status|Aksi',[
['Bukti kebutuhan','Dokumen internal','v1','HR unit','Tanggal unggah','Reviewer terkait','Tersedia','Buka'],['Dokumen belum ada','Persyaratan','Belum ada',null,null,'Reviewer terkait','Belum lengkap','Unggah saat draf']],
'Unggah, ganti atau hapus hanya lampiran draf yang boleh diubah. Jenis wajib mengikuti konteks form.',
'Unggah; pratinjau; unduh bila boleh; hapus draf; tambah versi. Tampilkan proses unggah/gagal dan validasi tipe/ukuran menurut konfigurasi.',
'Setelah pengajuan, lampiran bukti versi tersebut tidak dihapus diam-diam. Dokumen sensitif dibatasi termasuk ekspor.'],
['S17','Persetujuan dan riwayat','Semua detail berkeputusan','Tahap|Reviewer|Versi|Keputusan|Waktu|Alasan|Pelaksanaan|Aksi',[
['Review pusat','Reviewer pusat','v1','Dikembalikan','Waktu keputusan','Lengkapi dasar gaji','Belum berjalan','Lihat versi'],['Pengajuan ulang','Reviewer pusat','v2','Menunggu',null,null,'Belum berjalan','Review']],
'Baca saja. Keputusan baru hanya melalui tombol dan F01 sesuai tahap/madant.',
'Lihat versi; bandingkan; buka keputusan. Tidak mengubah nama reviewer/waktu/keputusan lewat grid.',
'Riwayat append-only. Perubahan versi dan hasil pelaksanaan tetap dapat ditelusuri.']
];

// Button tuple: label, actor, enabled state, guard, form/destination, outcome, placement.
const btn=(label,actor,state,guard,dest,outcome,place='Footer utama')=>[label,actor,state,guard,dest,outcome,place];
const review=()=>[
 btn('Setujui','Reviewer sesuai mandat','Menunggu keputusan','Versi terbaru; lengkap; bukan pengaju; unit/tindakan sah','F01','Keputusan tercatat untuk versi ini'),
 btn('Kembalikan','Reviewer sesuai mandat','Menunggu keputusan','Alasan dan bagian yang perlu diperbaiki wajib','F01','Dikembalikan; pemohon bisa revisi','Footer sekunder'),
 btn('Tolak','Reviewer sesuai mandat','Menunggu keputusan','Alasan wajib; tampilkan dampak penolakan','F01','Ditolak; pengajuan tidak dieksekusi','Menu tindakan')];
const draft=(form,owner='Pemohon / HR unit')=>[
 btn('Ubah draf',owner,'Draf / dikembalikan','Versi milik pengaju dan dalam cakupan',form,'Masuk mode form; belum mengubah sumber final','Header sekunder'),
 btn('Ajukan',owner,'Draf / dikembalikan','Field/bukti wajib lengkap; tampilkan ringkasan dan tujuan reviewer',form,'Terkirim, terkunci untuk review'),
 btn('Tarik pengajuan',owner,'Diajukan, belum diputuskan','Belum diproses final; alasan dan otorisasi sesuai kebijakan',form,'Kembali ke status yang diizinkan; riwayat penarikan tersimpan','Menu tindakan')];
const open=(label,dest)=>btn(label,'Pembaca berizin','Semua status yang terlihat','Hak ke objek tujuan diperiksa',dest,'Buka sumber yang sama; tidak mengubah data','Isi panel');
const spec=(sections,children,buttons,layout='Sidebar detail; form menggantikan isi panel dengan header mode yang jelas')=>({sections,children,buttons,layout});
const cfg={
'Hari ini':spec('Header pekerjaan; Penyebab; Tenggat dan owner; Dokumen terkait','S17',[open('Buka dokumen','Menu sumber'),btn('Ambil pekerjaan','Petugas dalam cakupan','Belum ditangani','Penugasan diizinkan','Penugasan pekerjaan','Owner diperbarui; tidak mengubah keputusan')]),
'Persetujuan saya':spec('Header ID/unit/versi; Ringkasan dampak; Rincian sumber; Perubahan; Bukti; Keputusan','S04; S16; S17',[open('Buka sumber','Detail domain'),...review()]),
'Pengecualian':spec('Header kasus; Penyebab; Dampak; Owner; Bukti tindak lanjut','S16; S17',[open('Buka sumber masalah','Domain sumber'),btn('Tugaskan','Koordinator berizin','Terbuka','Owner tujuan berwenang','Penugasan kasus','Owner dan tenggat tercatat'),btn('Selesaikan kasus','Owner / reviewer','Ditangani','Bukti sumber sudah teratasi; tidak hanya centang manual','Pemeriksaan hasil','Kasus selesai; riwayat tersimpan','Footer sekunder')]),
'Daftar karyawan':spec('Header nomor/nama/status/unit; Ringkasan kerja; Data pribadi terbatas; Kontrak; Dokumen; Riwayat','S03; S16; S17',[btn('Ajukan perubahan data','Pegawai sendiri / HR berizin','Pegawai tersedia','Field sesuai izin; tidak langsung edit register','F02','Draf permintaan perubahan'),btn('Ajukan perubahan kerja','HR unit','Status memungkinkan','Mandat unit dan transisi valid','F03 / F04','Draf perubahan bertanggal','Menu tindakan'),open('Lihat gaji','Kesepakatan gaji dengan hak nominal'),open('Lihat akun','Akun & Akses')]),
'Kontrak & penempatan':spec('Header CHG/pegawai/unit/versi; Kondisi kini; Usulan; Dampak unit/gaji/akses; Dokumen; Keputusan','S03; S04; S16; S17',[...draft('F03'),...review(),open('Lihat riwayat','Riwayat kontrak dan penempatan')]),
'Perubahan status':spec('Header STS/pegawai/versi; Status lama dan usulan; Tanggal efektif; Dasar; Dampak; Keputusan','S04; S16; S17',[...draft('F04'),...review(),open('Buka offboarding terkait','Kasus OFF jika diperlukan')]),
'Offboarding':spec('Header OFF/pegawai/hari terakhir; Dasar keputusan; Checklist; Akses; Finance; Riwayat','S02; S13; S16; S17',[btn('Perbarui tugas','Owner tugas','Berjalan','Hanya tugas milik/izin; sumber akun dan Finance tidak diubah manual','F05','Hasil/bukti tugas tersimpan'),btn('Selesaikan kasus','Koordinator HR','Semua tugas wajib selesai','Keputusan efektif; bukti semua owner; tidak menganggap uang sudah dibayar','F05 ringkasan selesai','Kasus selesai','Footer utama'),open('Buka akses','ACC sumber'),open('Buka payroll akhir','Batch sumber')]),
'Usulan penerimaan':spec('Header HIR/calon/unit/versi; Kebutuhan; Jabatan dan mulai; Usulan kompensasi; Bukti; Keputusan','S01; S16; S17',[...draft('F06'),...review(),open('Buka onboarding','ONB hanya jika sudah terbentuk')]),
'Onboarding':spec('Header ONB/pegawai/unit/mulai; Dasar hire; Kontrak/gaji; Checklist; Akun; Riwayat','S02; S16; S17',[btn('Perbarui tugas','Owner tugas','Berjalan','Hanya tugas berizin; bukti wajib jika selesai','F05','Checklist diperbarui'),btn('Ajukan akun','HR unit','Belum ada permintaan aktif','Hire sah; kebutuhan peran/cakupan jelas','F15','Satu ACC terkait; tidak membuat akun langsung','Isi panel'),btn('Selesaikan onboarding','Koordinator HR','Tugas wajib lengkap','Kontrak/kesiapan dan mulai kerja sesuai keputusan','F05 ringkasan','Onboarding selesai')]),
'Roster':spec('Header unit/minggu/versi; Kalender; Ringkasan bentrok; Perubahan; Riwayat','S05; S17',[btn('Ubah jadwal','Penyusun unit','Draf','Cakupan unit; pegawai sah','F07','Kalender masuk mode edit'),btn('Terbitkan','Pejabat unit berwenang','Draf valid','Tidak ada bentrok wajib; pratinjau pegawai terdampak','F07 ringkasan publikasi','Versi terbit terlihat ke karyawan'),btn('Buat revisi','Penyusun unit','Terbit','Alasan wajib; data asli tetap ada','F07 versi baru','Draf versi berikutnya','Menu tindakan')],'Halaman kalender penuh; klik sel membuka sidebar shift/pegawai'),
'Kehadiran':spec('Header pegawai/tanggal/unit; Rencana; Bukti aktual; Kelengkapan; Koreksi terkait','S06; S17',[btn('Ajukan koreksi','Pegawai sendiri / HR unit','Fakta belum sesuai','Sumber asli dipertahankan; periode terkunci melalui jalur khusus','F08','COR diajukan; fakta tidak langsung berubah'),open('Lihat jadwal','Roster'),open('Buka koreksi','COR sumber')]),
'Koreksi':spec('Header COR/pegawai/tanggal/versi; Data asli; Usulan; Bukti; Dampak periode; Keputusan','S06; S04; S16; S17',[...draft('F08'),...review(),open('Buka periode','Periode yang terdampak')]),
'Tutup periode':spec('Header unit/periode/versi fakta; Kesiapan; Masalah terbuka; Payroll terkait; Riwayat','S07; S17',[btn('Tutup periode','Pejabat unit','Terbuka dan lengkap','Tidak ada fakta wajib hilang; kesiapan server valid','F09','Versi fakta ditutup'),btn('Ajukan buka ulang','HR unit','Ditutup','Alasan dan dampak payroll/Finance terlihat','F09','Menunggu keputusan yang diperlukan','Menu tindakan'),btn('Setujui buka ulang','Pusat sesuai mandat','Menunggu keputusan','Bukan pengaju; review dampak final selesai','F01','Otorisasi revisi, bukan menimpa payroll paid')]),
'Cuti & izin':spec('Header LEV/pegawai/unit; Tanggal/jenis; Rincian hari; Hak; Bukti; Dampak tim; Keputusan','S08; S16; S17',[...draft('F10','Karyawan / HR yang mewakili'),...review(),btn('Ajukan pembatalan','Pemohon','Sudah disetujui','Kebijakan memungkinkan; dampak periode ditinjau','Permintaan pembatalan LEV','Belum membalik hak sampai keputusan','Menu tindakan')]),
'Lembur':spec('Header OT/unit/tanggal; Rencana; Pegawai; Kesediaan; Realisasi; Bukti; Payroll terkait','S09; S16; S17',[btn('Ubah rencana','Atasan / HR unit','Draf','Dalam mandat; perubahan setelah persetujuan perlu proses revisi','F11','Rencana berubah; bukan aktual'),btn('Terbitkan permintaan','Atasan / HR unit','Rencana lengkap','Mandat atau persetujuan pengecualian sudah ada','F11','Pegawai menerima permintaan kesediaan'),btn('Catat realisasi','HR unit / verifier','Sesudah pekerjaan','Bukti aktual ada; tidak menyalin rencana tanpa bukti','F11','Realisasi menunggu/sudah verifikasi menurut mandat'),btn('Setuju lembur','Pegawai terkait','Menunggu kesediaan','Hanya pegawai yang diminta; dari aplikasi sendiri','Jawaban lembur','Kesediaan tercatat','Aplikasi karyawan saja'),btn('Tidak bersedia','Pegawai terkait','Menunggu kesediaan','Hanya pegawai yang diminta','Jawaban lembur','Penolakan/keterangan tercatat','Aplikasi karyawan saja')]),
'Hak & saldo cuti':spec('Header pegawai/jenis/periode; Dasar kebijakan; Mutasi hak; Pemakaian; Penyesuaian terkait','S10; S17',[btn('Ajukan penyesuaian','HR unit','Dasar hak tersedia','Alasan/bukti dan periode benar','F17','Draf penyesuaian; saldo asli tidak diedit'),open('Buka pengajuan cuti','LEV sumber'),open('Buka kebijakan','Kebijakan hak berlaku')]),
'Kesepakatan gaji':spec('Header SAL/pegawai/unit/versi; Berlaku mulai; Komponen; Perbandingan; Dasar; Keputusan','S01; S04; S16; S17',[...draft('F12'),...review(),open('Buka riwayat','Versi kesepakatan gaji')]),
'Payroll per unit':spec('Header batch/unit/periode/versi; Kelengkapan; Beban dan neto; Pegawai; Komponen; Perubahan; Keputusan; Handoff','S11; S12; S04; S16; S17',[btn('Buka ruang kerja','Penyusun/verifier berizin','Draf / dikembalikan','Hak nominal dan unit; versi terbaru','F13 halaman penuh','Rincian dapat disusun/verifikasi'),btn('Verifikasi unit','Verifier unit','Draf lengkap','Komponen/fakta lengkap; sumber dapat ditelusuri','F13 ringkasan','Verifikasi versi tercatat'),btn('Ajukan beban ke HO','HR unit','Terverifikasi','Tidak ada perubahan sesudah verifikasi','F13','Menunggu keputusan pusat'),...review(),btn('Kunci versi','HR berwenang','Approved dan lengkap','Versi belum digantikan; konsekuensi immutable jelas','Konfirmasi seal','Versi sealed; siap handoff'),btn('Ajukan revisi','HR berwenang','Sudah diputuskan/dikunci','Alasan dan dampak Finance; jangan timpa versi paid','F13 versi baru','Draf revisi; perlu review ulang','Menu tindakan')],'Halaman payroll penuh; sidebar satu pegawai/komponen; keputusan dari ringkasan batch'),
'Serah terima Finance':spec('Header batch/unit/versi sealed; Tanda tangan; Snapshot; Hasil penerimaan; Kewajiban; Pembayaran; Riwayat','S13; S17',[btn('Kirim ke Finance','HR berwenang','Lengkap, approved, sealed','Snapshot final dan referensi unik','F14 konfirmasi','Handoff idempotent tercatat'),btn('Kirim ulang','HR berwenang','Gagal kirim / hasil belum pasti','Pakai ID handoff sama; tidak membuat kewajiban baru','F14','Status pengiriman diperbarui','Footer sekunder'),btn('Ajukan revisi','HR berwenang','Finance meminta perbaikan / ada koreksi','Tinjau status pembayaran dan versi','F14 revisi','Versi pengganti melalui approval','Menu tindakan'),open('Buka hasil Finance','Kewajiban/pembayaran sumber')]),
'Permintaan akses':spec('Header ACC/pegawai/unit/versi; Akses kini; Grant diminta; Dasar; Keputusan; Eksekusi','S14; S04; S16; S17',[...draft('F15'),...review(),btn('Laksanakan akses','Administrator berwenang','Approved dan tanggal sesuai','Keputusan sah; identitas/grant valid; tidak meminta password lewat HR','Provisioning terkontrol','Hasil aktif/gagal tercatat di ACC'),btn('Coba ulang eksekusi','Administrator berwenang','Gagal','Operasi yang sama; cek hasil sebelumnya untuk cegah ganda','Provisioning terkontrol','Hasil diperbarui','Menu tindakan')]),
'Daftar akun':spec('Header pegawai/akun/status; Peran dan cakupan; Tanggal akses; Dasar; Riwayat','S14; S17',[btn('Ajukan perubahan akses','HR unit','Akun tersedia','Mandat dan alasan; grant kini baca saja','F15','ACC baru terkait'),btn('Ajukan pencabutan','HR unit','Akses masih aktif','Tanggal dan dasar pencabutan jelas','F15 cabut','Permintaan pencabutan; bukan langsung ubah status','Menu tindakan'),open('Buka permintaan','ACC sumber')]),
'Riwayat akses':spec('Header kejadian/pegawai/waktu; Sebelum-sesudah; Keputusan; Pelaksana; Hasil','S04; S17',[open('Buka permintaan','ACC sumber'),open('Buka akun','Akun terkait')]),
'Tenaga kerja':spec('Header unit/tanggal/filter; Definisi angka; Rincian pegawai; Sumber perubahan','S03',[open('Buka pegawai','Karyawan'),open('Buka perubahan','CHG/STS sumber'),btn('Ekspor rincian','Pembaca dengan izin ekspor','Data tersedia','Cakupan/filter/field sensitif ikut izin','Ekspor','File hasil sesuai filter','Header sekunder')],'Halaman laporan penuh; sidebar rincian angka/pegawai'),
'Waktu & ketidakhadiran':spec('Header unit/periode/filter; Kelengkapan sumber; Rincian pengecualian; Dokumen waktu','S06; S07',[open('Buka kasus','COR/LEV/OT sumber'),open('Buka periode','Periode sumber'),btn('Ekspor rincian','Pembaca dengan izin ekspor','Data tersedia','Pisahkan data rencana/aktual/belum tersedia','Ekspor','Hasil sesuai filter','Header sekunder')],'Halaman laporan penuh; sidebar satu pegawai/hari'),
'Beban gaji':spec('Header unit/periode/versi; Usulan/disetujui/paid; Komponen; Delta; Sumber','S11; S12; S13',[open('Buka batch untuk review','PAY sumber'),open('Buka pembayaran','Finance sumber'),btn('Ekspor rincian','Pembaca dengan izin nominal/ekspor','Data tersedia','Field dan unit sesuai izin','Ekspor','Hasil tidak mencampur versi','Header sekunder')],'Halaman laporan penuh; sidebar unit/pegawai'),
'Unit & penanggung jawab':spec('Header unit/jenis/status; HR unit; Atasan; Reviewer pusat; Penugasan; Versi','S15; S17',[btn('Ajukan perubahan','Pemilik struktur berizin','Konfigurasi tersedia','Tidak mengubah akses lewat lokasi saja','F16','Draf struktur/penugasan'),...review(),btn('Terapkan versi','Admin konfigurasi','Approved','Tanggal berlaku dan mandat sah','F16 publikasi','Struktur berlaku dengan riwayat')]),
'Kebijakan waktu':spec('Header jenis/lingkup/versi; Masa berlaku; Parameter; Dampak; Dasar; Keputusan','S15; S04; S16; S17',[...draft('F16','Pemilik kebijakan'),...review(),btn('Publikasikan','Admin konfigurasi','Approved','Versi berlaku tidak ambigu; dampak ditinjau','F16 publikasi','Versi kebijakan berlaku')]),
'Komponen payroll':spec('Header komponen/jenis/versi; Definisi; Lingkup; Parameter; Hubungan Finance; Keputusan','S15; S04; S16; S17',[...draft('F16','Pemilik HR/Finance berwenang'),...review(),btn('Publikasikan','Admin konfigurasi','Approved','Definisi HR dan mapping Finance tidak dicampur; dampak jelas','F16 publikasi','Komponen versi berlaku')]),
'Kewenangan & persetujuan':spec('Header mandat/peran/versi; Tindakan; Cakupan; Kondisi eskalasi; Pemisahan orang; Keputusan','S15; S04; S17',[...draft('F16','Pemilik mandat'),...review(),btn('Aktifkan mandat','Admin berwenang','Approved','Pemutus memiliki mandat memberi hak; tidak self-grant','F16 publikasi','Mandat berlaku dengan audit')])
};
const tabs=design.menus.flatMap(m=>m.tabs.map(t=>({menu:m.name,...t})));
if(tabs.length!==29||tabs.some(t=>!cfg[t.name]))throw Error('Sidebar coverage incomplete');
const dt=sheet('16 Detail per Tab','Sidebar detail untuk setiap tab','Rancangan target. Tombol dirinci pada sheet 17, form pada sheet 18 dan 12, tabel anak pada sheet 19–20. Tidak semua detail harus memiliki tombol ubah.');
table(dt,4,['Menu / tab','Header detail','Bagian / subtab detail','Isi utama','Tabel anak','Form terkait','Bentuk layar','Batas edit'],tabs.map(t=>{const c=cfg[t.name];return[t.menu+' / '+t.name,t.columns.filter(x=>x!=='Aksi').join('; ')+'; versi jika dokumen berubah',c.sections,t.detail,c.children,t.form,c.layout,'Sumber final dan riwayat baca saja. Edit lewat form/status berizin; aksi tersembunyi bila tidak punya mandat, dinonaktifkan dengan alasan bila tahap belum tepat.'];}),116);dt.freezePanes.freezeRows(5);
const acts=tabs.flatMap(t=>cfg[t.name].buttons.map(b=>[t.menu+' / '+t.name,b[0]+' — '+b[6],b[1],b[2],b[3],b[4],b[5],'UI dan server memeriksa izin, unit, versi dan transisi. Konflik menampilkan alasan tanpa menimpa.']));
const bs=sheet('17 Tombol Sidebar','Tombol di sidebar detail','Satu baris per tombol. Tombol tidak selalu muncul bersamaan: pilih menurut peran, status dan konteks. Tombol aplikasi karyawan tidak ditampilkan sebagai tindakan HR.');table(bs,4,['Menu / tab','Tombol / posisi','Siapa','Aktif saat','Syarat / konfirmasi','Membuka','Hasil','Jika tidak memenuhi'],acts,100);bs.freezePanes.freezeRows(5);

const formRules={F01:['Keputusan dengan ringkasan dokumen di atas','S04; S16; S17','Simpan keputusan; Batal','Tidak ada simpan draf keputusan. Kembalikan/tolak wajib alasan; cek versi sekali lagi saat submit.'],F02:['Form perubahan profil dengan nilai lama/usulan','S04; S16','Simpan draf; Ajukan; Batal','Field sensitif mengikuti izin; perubahan bukan edit langsung profil.'],F03:['Form bertahap jenis perubahan → kondisi kini → usulan → dampak','S03; S04; S16','Simpan draf; Ajukan; Batal','Unit/jabatan/kontrak muncul sesuai jenis; dampak gaji/akses sebagai referensi keputusan lain.'],F04:['Form status dengan dasar dan tanggal efektif','S04; S16','Simpan draf; Ajukan; Batal','Transisi status valid; dampak offboarding eksplisit; tidak menyatakan pembayaran selesai.'],F05:['Panel tugas dengan owner, tenggat dan bukti','S02; S16','Simpan tugas; Selesaikan tugas; Batal','Status akun/Finance mengikuti sumber; tugas wajib tidak dapat dihapus untuk melewati proses.'],F06:['Form usulan penerimaan dengan kompensasi dan bukti','S01; S16','Simpan draf; Ajukan ke HO; Batal','Tambahkan total usulan dari komponen; calon tidak masuk daftar aktif sebelum keputusan.'],F07:['Halaman kalender; sidebar editor satu sel/rentang','S05','Simpan draf; Pratinjau publikasi; Terbitkan; Batal','Mass edit menampilkan jumlah sel terdampak; konflik shift/penempatan diblok; undo sebelum simpan.'],F08:['Perbandingan sumber asli dan nilai koreksi','S06; S04; S16','Simpan draf; Ajukan koreksi; Batal','Sumber asli terkunci; periode final dialihkan ke alur revisi yang sah.'],F09:['Panel checklist dan konfirmasi tutup/buka','S07; S17','Tutup periode / Ajukan buka ulang; Batal','Tombol sesuai kondisi; jumlah masalah berasal dari sumber; bukan centang manual semua siap.'],F10:['Form jenis/tanggal lalu pratinjau per hari','S08; S16','Simpan draf; Ajukan; Batal','Hak/durasi mengikuti kebijakan; saldo belum tersedia ditandai kosong, bukan nol.'],F11:['Form rencana atau form realisasi dengan mode terpisah','S09; S16','Simpan rencana; Terbitkan / Simpan realisasi; Batal','Tombol kesediaan hanya pegawai terkait; realisasi bukan otomatis dari rencana.'],F12:['Form gaji dengan komponen dan perbandingan','S01; S04; S16','Simpan draf; Ajukan ke HO; Batal','Tanggal berlaku dan komponen sah; data gaji sesuai izin.'],F13:['Halaman batch penuh; sidebar pegawai dan editor penyesuaian','S11; S12; S04; S16','Simpan draf; Verifikasi; Ajukan ke HO','Masing-masing tindakan sesuai mandat. Angka otomatis terkunci; penyesuaian memiliki bukti.'],F14:['Panel snapshot, kesiapan dan konfirmasi kirim','S13; S17','Kirim / Kirim ulang; Ajukan revisi; Tutup','Hanya lengkap/approved/sealed; ID pengiriman sama saat retry; tidak mengubah snapshot.'],F15:['Form akun dengan grid peran/cakupan','S14; S04; S16','Simpan draf; Ajukan ke HO; Batal','Tidak memasukkan password, token atau role teknis sembarang; hasil provisioning baca saja.'],F16:['Form dinamis berdasarkan jenis kebijakan','S15; S04; S16','Simpan draf; Ajukan; Publikasikan setelah approved','Jenis input mengikuti parameter; versi dan masa berlaku tidak ambigu.'],F17:['Form mutasi hak dengan saldo kini dan hasil usulan','S10; S16','Simpan draf; Ajukan; Batal','Saldo terhitung hanya bila dasar ada. Tidak mengubah histori pemakaian.']};
const fm=sheet('18 Form Saat Dibuka','Form yang dibuka dari detail','Melengkapi sheet 12 Form dan Field. ID F01–F17 tetap sama. Tombol form dan tombol detail adalah dua keadaan UI yang berbeda.');table(fm,4,['Form','Bentuk / urutan','Field lengkap','Subtable','Tombol form','Perilaku khusus','Keluar / gagal simpan','Setelah berhasil'],design.forms.map(f=>[f.id+' '+f.name,formRules[f.id][0],'Sheet 12: '+f.fields.map(x=>x[0]).join('; '),formRules[f.id][1],formRules[f.id][2],formRules[f.id][3],'Perubahan belum tersimpan: Simpan draf bila didukung / Buang / Lanjut edit. Error di field; simpan gagal mempertahankan input.',f.effect]),125);fm.freezePanes.freezeRows(5);

const child=sheet('19 Contoh Subtable','Contoh tabel anak dan tabel editable','S01–S17 merupakan tabel di dalam detail/form, bukan menu aplikasi tambahan. Data ilustrasi; status contoh antarblok berdiri sendiri. Kolom berwarna kuning hanya pada contoh yang memang boleh diedit.');let cr=4;const gridRanges=[];
for(const g of grids){const start=cr;band(child,cr++,`${g[0]} ${g[1]} — ${g[2]}`);cr=table(child,cr,g[3].split('|'),g[4],54);note(child,cr++,'Yang dapat diedit',g[5]);note(child,cr++,'Aksi / validasi',g[6]);note(child,cr++,'Setelah submit',g[7]);gridRanges.push({id:g[0],start,end:cr-1,dataStart:start+2,rows:g[4].length});cr+=2;}
// Demonstrate true worksheet inputs/derived totals without pretending the Excel is the app.
const c1=gridRanges.find(x=>x.id==='S01');const vstart=c1.dataStart+1;child.getRange(`C${vstart}:C${vstart+1}`).format.fill='#FFF2CC';child.getRange(`C${vstart}:C${vstart+1}`).dataValidation={rule:{type:'decimal',operator:'greaterThanOrEqual',formula1:0}};
const totalRow=c1.end+1;child.getRange(`A${totalRow+1}`).values=[['Total ilustrasi Rp']];child.getRange(`C${totalRow+1}`).formulas=[[`=SUM(C${vstart}:C${vstart+1})`]];child.getRange(`C${totalRow+1}`).setNumberFormat('#,##0');child.getRange(`A${totalRow+1}:C${totalRow+1}`).format.font={name:'Arial',size:10,bold:true};
const cg=gridRanges.find(x=>x.id==='S05');child.getRange(`B${cg.dataStart+1}:H${cg.dataStart+cg.rows}`).dataValidation={rule:{type:'list',values:['Pagi','Siang','Libur']}};child.getRange(`B${cg.dataStart+1}:H${cg.dataStart+cg.rows}`).format.fill='#FFF2CC';
const rs=sheet('20 Aturan Edit Tabel','Aturan perubahan tabel anak','Edit di dalam tabel hanya untuk data draf yang memang menjadi input. Tabel sumber, angka turunan, persetujuan, log dan status Finance tetap baca saja.');table(rs,4,['Tabel','Dipakai pada form','Kunci baris','Yang dapat diubah','Aksi baris','Validasi','Sesudah diajukan','Contoh Excel'],grids.map(g=>[g[0]+' '+g[1],g[2],g[0]==='S05'?'Pegawai + tanggal + versi roster':'ID baris sumber + ID dokumen + versi',g[5],g[6].split('.')[0],g[6],g[7],['S01','S05'].includes(g[0])?'Contoh input kuning; dropdown/validasi aktif di sheet 19.':'Ilustrasi tampilan; hak edit aplikasi dijelaskan, bukan dieksekusi Excel.']),120);rs.freezePanes.freezeRows(5);
let xr=grids.length+7;band(rs,xr++,'Aturan interaksi umum');table(rs,xr,['Keadaan','Yang tampil','Perilaku yang diperlukan'],[
['Baris baru','Penanda draf; field wajib','Belum menjadi transaksi sampai disimpan; batalkan baris tanpa mengubah sumber'],['Hapus','Aksi hanya pada baris draf yang diizinkan','Data yang sudah diposting/disetujui memakai pembatalan atau revisi dengan alasan'],['Banyak baris','Pencarian, pagination/virtualisasi dan ringkasan','Total/jumlah harus menjelaskan cakupan seluruh data atau filter; bukan hanya halaman terlihat'],['Pilihan banyak baris','Jumlah dan cakupan terpilih','Aksi massal hanya bila izin/status seluruh baris sesuai; hasil parsial ditampilkan per baris'],['Validasi','Pesan pada sel/baris dan ringkasan','Jangan menutup form jika invalid; pertahankan input; fokus ke kesalahan'],['Perubahan bersamaan','Versi berubah oleh orang lain','Tolak overwrite diam-diam; tampilkan versi terbaru dan pilihan meninjau perubahan'],['Submit','Ringkasan perubahan + tombol sedang memproses','Cegah double-submit; hasil tak pasti dicek lewat ID yang sama sebelum mengulang'],['Tidak punya izin','Aksi tidak ditampilkan','Field/data sensitif juga dibatasi pada server dan ekspor'],['Tahap belum tepat','Aksi nonaktif dengan alasan','Contoh: Kirim ke Finance belum aktif karena belum lengkap/sealed'],['Sumber belum tersedia','Kosong dengan alasan dan tindak lanjut','Tidak mengisi angka nol atau data contoh sebagai hasil nyata'],['Membuka sumber','Tautan dokumen asli','Pertahankan konteks/filter daftar ketika kembali; tidak menambah sidebar bertingkat tanpa batas']
],72);

const mock=sheet('21 Contoh Sidebar','Contoh susunan detail dan form','Ilustrasi HIR-001. Kiri: daftar tetap terlihat. Kanan: satu panel yang berganti antara detail dan form. Tombol pada Excel adalah label rancangan, bukan tindakan aplikasi.');
mock.getRange('A1:D60').format.columnWidth=18;mock.getRange('E1:E60').format.columnWidth=3;mock.getRange('F1:H60').format.columnWidth=21;
function block(s,range,value,fill='#FFFFFF',bold=false,height=28){const q=s.getRange(range);q.merge();q.values=[[value]];q.format={font:{name:'Arial',size:10,bold,color:fill==='#243B53'?'#FFFFFF':'#172B4D'},fill,wrapText:true,verticalAlignment:'center',rowHeight:height};}
table(mock,4,['Usulan','Calon','Unit','Status'],[['HIR-001','Calon A','Toko 01','Menunggu HO'],['HIR-002','Calon B','Toko 02','Draf']],44);
block(mock,'F5:H5','DETAIL PENERIMAAN                         Tutup ×','#243B53',true);
block(mock,'F6:H6','HIR-001 · Toko 01 · v1',undefined,true);
block(mock,'F7:H7','Menunggu keputusan HR pusat','#FFF2CC');
block(mock,'F8:H8','Ringkasan   Rincian   Bukti   Riwayat','#E7EDF4',true);
block(mock,'F9:F9','Calon',undefined,true);block(mock,'G9:H9','Calon A');
block(mock,'F10:F10','Jabatan',undefined,true);block(mock,'G10:H10','Kasir');
block(mock,'F11:F11','Kebutuhan',undefined,true);block(mock,'G11:H11','Pengganti posisi');
block(mock,'F12:F12','Mulai kerja',undefined,true);block(mock,'G12:H12','Tanggal yang diajukan');
block(mock,'F13:H13','Usulan kompensasi','#E7EDF4',true);
block(mock,'F14:G14','Gaji pokok');mock.getRange('H14').values=[[4000000]];mock.getRange('H14').setNumberFormat('#,##0');
block(mock,'F15:G15','Tunjangan tetap');mock.getRange('H15').values=[[300000]];mock.getRange('H15').setNumberFormat('#,##0');
block(mock,'F16:G16','Total usulan',undefined,true);mock.getRange('H16').formulas=[['=SUM(H14:H15)']];mock.getRange('H16').setNumberFormat('#,##0');
block(mock,'F17:H18','Dokumen: dasar kebutuhan, identitas calon dan usulan kontrak. Buka dokumen sesuai hak akses.');
block(mock,'F19:H20','Reviewer melihat versi terbaru dan tidak boleh menjadi pengaju. Setujui belum mengaktifkan akun.');
block(mock,'F22:G22','Setujui → buka F01','#243B53',true);block(mock,'H22:H22','Kembalikan','#E7EDF4',true);
block(mock,'F23:H23','Tindakan lain: Tolak dengan alasan');
block(mock,'A26:H26','Keadaan alternatif: pemohon mengubah draf/dikembalikan','#E7EDF4',true);
block(mock,'A28:D30','Panel yang sama masuk mode FORM. Nilai lama dan riwayat tetap tersimpan. Contoh ini bukan form yang aktif bersamaan dengan keputusan di atas.');
block(mock,'F28:H28','UBAH USULAN PENERIMAAN                Batal ×','#243B53',true);
block(mock,'F29:H29','HIR-001 · v2 draf · HR Toko 01');
block(mock,'F30:F30','Unit *',undefined,true);block(mock,'G30:H30','Toko 01 — sesuai penugasan');
block(mock,'F31:F31','Jabatan *',undefined,true);block(mock,'G31:H31','Kasir ▾','#FFF2CC');
block(mock,'F32:F32','Mulai kerja *',undefined,true);block(mock,'G32:H32','Pilih tanggal','#FFF2CC');
block(mock,'F33:F33','Kebutuhan *',undefined,true);block(mock,'G33:H33','Pengganti ▾','#FFF2CC');
block(mock,'F34:H34','Komponen                    Nilai Rp          Aksi','#E7EDF4',true);
block(mock,'F35:G35','Gaji pokok');mock.getRange('H35').values=[[4000000]];mock.getRange('H35').format.fill='#FFF2CC';mock.getRange('H35').setNumberFormat('#,##0');
block(mock,'F36:G36','Tunjangan tetap');mock.getRange('H36').values=[[300000]];mock.getRange('H36').format.fill='#FFF2CC';mock.getRange('H36').setNumberFormat('#,##0');
block(mock,'F37:H37','+ Tambah komponen  ·  Hapus baris draf');
block(mock,'F38:F38','Alasan *',undefined,true);block(mock,'G38:H39','Isi dasar kebutuhan dan perubahan','#FFF2CC');
block(mock,'F40:H40','Lampiran *  ·  Unggah / pratinjau / ganti draf');
block(mock,'F41:H42','Jika belum lengkap: pesan muncul dekat field, input tetap tersimpan. Nominal di sini masih usulan.');
block(mock,'F44:G44','Ajukan ke HO','#243B53',true);block(mock,'H44:H44','Simpan draf','#E7EDF4',true);
block(mock,'F45:H45','Keluar dengan perubahan: Simpan / Buang / Lanjut edit');

// Add an appendix on each menu sheet, without replacing its existing content.
for(const m of design.menus){const s=wb.worksheets.getItem(m.sheet);const last=m.sections.at(-1).end+4;band(s,last,'Rincian sidebar, tombol dan tabel anak');table(s,last+1,['Tab','Detail','Tombol','Form','Subtable','Bentuk layar'],m.tabs.map(t=>[t.name,'Sheet 16: '+t.name,'Sheet 17: '+t.name,t.form+'; lihat sheet 18 dan 12',cfg[t.name].children+'; lihat sheet 19–20',cfg[t.name].layout]),80);}
const home=wb.worksheets.getItem('00 Prinsip dan Peta');note(home,36,'Rincian tambahan','Sheet 16–21: detail setiap tab, tombol menurut peran/status, form, contoh subtable/editable table, aturan edit, dan contoh susunan sidebar. Tambahan ini tidak mengubah 9 menu dan 29 tab aplikasi.');
const errors=(await wb.inspect({kind:'match',searchTerm:'#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#SPILL!',options:{useRegex:true,maxResults:30},maxChars:1400})).ndjson;console.log(errors);
console.log((await wb.inspect({kind:'table',range:`19 Contoh Subtable!A${vstart}:H${totalRow+1}`,tableMaxRows:8,tableMaxCols:8,maxChars:2200})).ndjson);
for(const x of newSheets){const range=x.name==='21 Contoh Sidebar'?'A1:H23':x.name==='19 Contoh Subtable'?'A1:H12':'A1:H8';const b=await wb.render({sheetName:x.name,range,scale:1,format:'png'});await fs.writeFile(out+x.name.slice(0,2)+'-detail-preview.png',new Uint8Array(await b.arrayBuffer()));}
const fb=await wb.render({sheetName:'21 Contoh Sidebar',range:'A26:H45',scale:1,format:'png'});await fs.writeFile(out+'21-form-preview.png',new Uint8Array(await fb.arrayBuffer()));
await(await SpreadsheetFile.exportXlsx(wb)).save(target);
await fs.writeFile(out+'sidebar-receipt.json',JSON.stringify({tabs:tabs.length,buttons:acts.length,forms:design.forms.length,subtables:grids.length,newSheets:newSheets.map(x=>x.name)},null,2));
console.log('Updated workbook with sidebar specifications');
