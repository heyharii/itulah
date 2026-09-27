# GA prototype v2 — keputusan, alur, dan audit use case

24 September 2026. Fokus: UX GA lengkap dengan contoh serah-terima Finance. Ini rancangan produk dan prototype lokal, bukan perubahan backend/COA. Semua posting, persetujuan, dan pembayaran dalam demo adalah simulasi.

## Keputusan inti

Tujuh menu utama layak dipakai: **Vendors · Contracts · Assets · Maintenance · Workplace · Fleet · Letters**. Tambahkan fungsi operasional sebagai tab di dalam kelompok, bukan menu utama baru untuk setiap akun COA.

- Fleet/Vehicles adalah filter aset kelas kendaraan. Service adalah maintenance kendaraan, bukan tabel servis kedua.
- Workplace/Utilities adalah kontrak Langganan ditambah log pemakaian meter. Log meter merupakan fakta baru yang sah; bukan salinan nilai invoice.
- Supplies memerlukan permintaan dan pemenuhan barang, bukan sekadar akun default vendor. Inventory tetap pemilik stok dan mutasinya, Procurement pemilik pembelian.
- Cleaning memerlukan checklist pelaksanaan walaupun kontrak vendor sudah ada.
- Fasilitas, reservasi ruang, tamu, pemakaian kendaraan, dan BBM melengkapi kebutuhan operasi sehari-hari.
- File ditempel ke record sumber. Daftar dokumen global nantinya hanya indeks.
- Supplier, kontrak, dan aset memakai referensi ID. Demo tidak menyalin profil supplier ke Finance.
- Nilai kontrak legal tetap tidak dimodelkan mengikuti permintaan awal. Jangan menyebut agregat invoice sebagai nilai kontrak. Menyimpan nilai legal di masa depan tetap sah karena merupakan fakta berbeda; perlu amendemen dan basis nilai yang jelas.
- Catatan kontrak boleh menjelaskan ketentuan legal, termasuk termin. Jangan membangun jadwal pembayaran kedua yang bersaing dengan bill template Finance.

## Kelengkapan form

Semua form punya ID, status, lampiran, record terkait, serta riwayat perubahan. Field yang hanya berlaku pada jenis tertentu disembunyikan, misalnya plat kendaraan, seat software, nomor meter, atau pihak penyewa.

| Form | Data utama |
|---|---|
| Vendor | Nama legal/dagang, kategori, status, NPWP/PKP, alamat, PIC/kontak utama, email invoice, telepon, rekening/pemilik, status verifikasi, termin default, akun usulan |
| Kontrak | Jenis, pihak, nomor, site/aset, mulai/akhir, tanda tangan, penandatangan, notice/renewal, scope, SLA, nomor pelanggan/polis/izin, daya/meter, penerbit, PIC |
| Aset | Kelompok/kelas, tag, merek/model/serial, kepemilikan, vendor, lokasi/ruang, pemegang, departemen, diterima/digunakan, garansi, spesifikasi, referensi kontrak/PO |
| Kendaraan | Field aset + plat, rangka, mesin, tahun, bahan bakar, odometer |
| Software / Projects | Field aset + seat/lisensi/expiry atau milestone/progres |
| Perbaikan | Pelapor, tanggal, site/aset, prioritas, keluhan, vendor/kontrak, teknisi, jadwal, diagnosis, parts, hasil, downtime, odometer, selesai/pemeriksa |
| Jadwal | Aset, vendor/kontrak, frekuensi waktu/km, next due/km, pengingat, tim, checklist |
| Lokasi | Jenis, alamat, luas, kapasitas, jam buka, telepon, kontak darurat, kontrak |
| Meter | Sambungan, periode, satuan, pembacaan awal/akhir, pemakaian terhitung, anomali |
| Supplies | Pemohon, departemen, tanggal kebutuhan, item/SKU, qty/satuan, pemenuhan sebagian, jalur stok/pembelian/claim/kas kecil, referensi, penerima |
| Cleaning | Tanggal/shift/area, tim, checklist, rencana/selesai, pemeriksa, temuan |
| Dokumen kendaraan | Aset, jenis/nomor, penerbit, masa berlaku atau referensi kontrak, pengingat, tempat dokumen asli |
| Pemakaian kendaraan | Pengemudi, penumpang, tanggal, asal/tujuan/keperluan, kilometer awal/akhir, kondisi serah-terima |
| BBM | Kendaraan, tanggal, pengemudi, SPBU, liter, odometer, struk, jalur biaya |
| Fasilitas / insiden | Jenis, pelapor, tanggal, prioritas, kronologi, petugas, tindakan |
| Reservasi | Ruang, pemohon, tanggal/jam, peserta/kebutuhan; deteksi bentrok |
| Tamu | Perusahaan, host, tanggal, waktu masuk/keluar, badge, keperluan |
| Surat | Masuk/keluar, kategori, nomor, tanggal, pengirim/penerima, penandatangan, klasifikasi, isi, pengiriman |
| Bill | Supplier, nomor/tanggal/jatuh tempo, periode layanan, bukti, baris alokasi per objek/site, pajak/diskon, review, akun, prepaid |
| Recurring | Supplier/kontrak, nominal variabel/tetap, perkiraan, toleransi, frekuensi, periode berikutnya, hari invoice, termin, akhir/jeda, usulan akun/prepaid |

## Finance menerima apa?

**Finance menerima konteks + bukti + satu draft, bukan persetujuan membayar secara otomatis.**

Target handoff dalam prototype:

1. GA mengelola pekerjaan/kontrak dan bukti operasionalnya.
2. Jika invoice diterima GA, GA membuka “Ajukan invoice” dari record itu. Nomor, tanggal, periode, nominal, dan scan dimasukkan ke **draft Finance yang sama**. Status draft bukan AP.
3. GA mengajukan draft. Finance menerima ID bill itu di Inbox; tidak menyalin ke bill kedua.
4. Finance memeriksa bukti, invoice supplier, duplikasi, akun, pajak, alokasi lokasi, periode, prepaid, serta otorisasi yang berlaku.
5. Finance dapat mengembalikan atau menahan disertai alasan. Perubahan dan pengajuan ulang tetap memakai ID yang sama; hasil review direset saat diajukan ulang.
6. Setelah sesuai, Finance memposting. GA membaca biaya terkait. Pembayaran berjalan terpisah dan dapat bertahap.
7. Jika invoice langsung diterima Finance, Finance membuat draft langsung. GA tidak wajib menjadi pintu masuk semua invoice.

Alternatif bila GA tidak perlu mengetik angka: GA hanya menyertakan scan dan konteks, Finance melengkapi draft yang sama. Tidak wajib mengisi rincian pajak di lapangan.

**Pengecualian terhadap “semua uang lewat supplier bill”:** reimbursement tetap Claim HR; kas kecil tetap kas kecil; uang muka dan deposit memiliki alur tersendiri; kontrak Disewakan menghasilkan AR/customer invoice. Jangan membuat AP vendor fiktif untuk memaksa semua jalur sama.

Bukti pekerjaan selesai boleh diperlukan menurut jenis jasa/otorisasi, tetapi tidak identik dengan warehouse receipt. Untuk supplies yang dibeli sebagai barang stok, receipt dan matching tetap mengikuti Procurement/Inventory.

## Recurring listrik, air, internet, sewa

| Skenario | GA | Finance / generator | Kontrol |
|---|---|---|---|
| Listrik / air pascabayar | Sambungan, pelanggan, lokasi, meter/pemakaian | Template variabel → draft WAITING_INVOICE, nominal aktual kosong | Invoice aktual diisi pada draft yang sama; selisih atas perkiraan dijelaskan |
| Internet nominal tetap | Kontrak, paket, pelanggan, SLA | Draft dengan nominal usulan | Nomor invoice, bukti, periode dan nominal tetap diperiksa |
| Sewa 3 tahun dibayar tahunan | Kontrak 2027–2029 | 3 occurrence tahunan, masing-masing periode 12 bulan | Prepaid dari periode bill; tidak menyalin akhir kontrak 2029 ke bill 2027 |
| Cleaning bulanan | Kontrak + checklist | Bill bulanan | Pekerjaan kurang/penalti diklarifikasi, bukan auto bayar |
| PLN token / top-up | Pelanggan dan pemakaian | Pembelian/top-up sesuai bukti | Tidak dianggap invoice pascabayar bulanan |
| Invoice terlambat | GA/Finance mengejar vendor | Tetap WAITING_INVOICE | Bukan AP yang dibuat dari perkiraan; akrual Finance adalah kebutuhan terpisah |
| Kontrak dijeda / berakhir | Status dan alasan | Generator menolak periode baru | Bill historis dipertahankan |
| Prorata / akhir di tengah periode | Tanggal legal yang benar | Draft manual periode parsial | Generator prototype menolak periode penuh yang melewati akhir |
| Harga naik / addendum | Dokumen amendemen | Update template untuk occurrence berikutnya | Tidak mengubah invoice historis |
| Debit otomatis bank | Konteks layanan | Rekonsiliasi pembayaran terhadap invoice | Bukan bukti bahwa invoice/akun/pajak sudah diperiksa |

Pada prototype, generator **dijalankan dengan tombol**, bukan scheduler sungguhan. Menekan lagi untuk template+periode sama membuka draft yang sama. Frekuensi demo memakai awal bulan; bulanan, triwulanan dan tahunan tersedia. Hari 29–31 menyesuaikan akhir bulan. Periode berikutnya diubah manual setelah periode berjalan selesai diproses. Tanggal invoice/jatuh tempo aktual tetap harus diisi sesuai dokumen.

## Angka yang tampil di GA

Biaya terkait = subtotal **baris bill POSTED** yang menunjuk record tersebut. Draft, hold, dan bill yang dikembalikan tidak masuk.

Satu bill Rp10 juta dapat memiliki baris Rp6 juta untuk RP-001 dan Rp4 juta untuk RP-002. GA harus menunjukkan Rp6 juta dan Rp4 juta, bukan Rp10 juta pada keduanya. Demo menggunakan satu referensi sumber utama per baris. Jika diperlukan alokasi satu baris ke banyak objek, perlu tabel alokasi dan validasi jumlah yang seimbang.

Agregat demo belum memasukkan alokasi pajak/diskon/credit note ke objek. Label menyebut basis subtotal sebelum pajak dan diskon; jangan menggunakannya sebagai total biaya akuntansi final. Versi produksi perlu menentukan pajak recoverable/non-recoverable, net credit note, currency/rate, dan penanganan pembatalan. Untuk menghindari double count pada laporan gabungan, satu baris tidak boleh dihitung lagi hanya karena tampil melalui view kontrak sekaligus perbaikan/aset.

## Temuan source repository: ada vs target

Pembacaan pada workspace tanggal 24 September 2026, bukan jaminan semua branch/deployment sama.

| Area | Bukti source | Kesimpulan |
|---|---|---|
| Recurring ada di Finance | `backend/src/cloud/http/bill_template.rs`, `/api/v1/finance/bill-templates` | Bukan menu pengaturan recurring milik GA |
| Draft dari ekspektasi | `backend/src/cloud/postgres/bill_template.rs`, `bill_template_sweep` | Kode saat ini membuat draft dengan expected subtotal/tax. Cocokkan invoice asli tetap tindakan manusia |
| Keterbatasan template | `BillTemplate` / `RecordBillTemplateRequest` | Ada due_day, expected, tolerance; struct yang dibaca belum membawa contract_id, mode variable/fixed, frekuensi tahunan, start/end |
| Akhir bulan | `bill_template_sweep`: `if due_day > clamp { continue; }` | Hari 31 pada Februari terlewati, bertentangan dengan komentar yang mengklaim clamp. Perlu perbaikan + regression test backend terpisah |
| Due day berbeda dari due date | sweep memakai due_day untuk kemunculan, bill.due_date = akhir bulan | UI sebaiknya membedakan hari invoice diharapkan tiba dari jatuh tempo aktual |
| Idempotensi scheduler | Lookup run lalu `record_bill`, setelah itu insert `bill_template_run` | Perlu audit transaksi/konkurensi dan retry bersama constraint invoice; belum diuji pada DB dalam tugas ini |
| Payment request approval | `payment_instructions.rs`, fungsi keputusan meng-update status APPROVED/REFUSED dan supplier | Persetujuan **tidak otomatis membuat bill** pada fungsi yang dibaca. Proses mengikat bill/payment dilakukan terpisah |
| Satu bill multi-site | `payables.rs`, `RecordBillLine.site_id` | Fondasi alokasi lokasi sudah ada |
| Referensi GA / service period | `RecordBillRequest` dan `RecordBillLine` yang dibaca | Belum ada contract_id/repair_id atau periode layanan dalam struct tersebut. UX prototype membutuhkan dukungan API/migrasi |
| Duplicate invoice | `payables.rs`, komentar uniqueness supplier_id + invoice_number | Fondasi pencegahan duplikasi ada; normalisasi dan exception tetap perlu diperiksa pada implementasi produksi |
| Kontrak/Maintenance nav | `frontend-hub/src/screens/contracts/nav.ts` dan catatan sebelumnya | Menu placeholder bukan bukti form/backend sudah lengkap |

Tidak ada file backend, migrasi, COA, atau kontrol posting produksi yang diubah. Jangan menganggap tampilan demo sudah terintegrasi hanya karena field tersedia.

## Sebelum implementasi produksi

1. Tentukan owner dan hak edit: GA master/operasi, Finance accounting, Procurement pembelian, Inventory stok, HR claim. Role selector demo bukan otorisasi.
2. Sepakati angka legal/estimasi/budget. Approved budget memerlukan approver, timestamp, limit, perubahan versi; tidak cukup sebuah input bernama “approved”.
3. Finalkan kontrak+repair+invoice-line references dan alokasi. Hindari mengandalkan nama bebas untuk integrasi.
4. Sediakan invoice intake dengan satu ID dan lifecycle; dokumen yang sudah diposting immutable, koreksi melalui dokumen koreksi.
5. Recurring: occurrence, periode, status invoice diterima, idempotensi transaksi, toleransi, jeda, akhir, prorata, dan catch-up periode terlewat.
6. Tambahkan approval operasional yang perlu (pembelian, disposal, mutasi, budget), tidak otomatis mewajibkan approval berlapis untuk semua register.
7. Implementasikan reminder sesuai PIC/hari pengingat dan notice deadline; dashboard demo saat ini hanya ringkasan 60 hari.
8. File storage, audit append-only, pembatasan site, backup, dan akses dokumen terbatas di server.

## Batas prototype yang terlihat

18 jenis record/form, tujuh kelompok GA, dan contoh alur Finance. Bukan seluruh fungsi enterprise siap produksi. Beberapa kebutuhan hanya didokumentasikan: multi-kontak/rekening vendor, addendum berversi, budget approval, disposal, stock opname, e-sign, AR, credit note, mesin pajak, scheduler dan notifikasi. Supplies saat ini satu SKU per permintaan; checklist cleaning berupa teks dan hitungan, belum checklist per baris. Nilai uang demo hanya IDR. Snapshot tanggal operasional adalah 24 September 2026.

Lampiran lokal maksimum 500 KB/file, sekitar 2 MB total. File contoh yang sudah tersedia adalah label dummy, bukan scan asli. Perubahan bertahan melalui localStorage browser; data dapat diekspor JSON. `v1.html` menyimpan versi sebelumnya.

## Referensi pembanding

Form/alur mengadaptasi kebutuhan GA retail dari konteks pengguna dan memperbandingkan dokumentasi primer; tidak mengklaim semua aplikasi memakai struktur sama.

- [ERPNext Purchase Invoice](https://docs.frappe.io/erpnext/purchase-invoice): review invoice, akun, taxes, periode/due date dan dokumen pembelian; invoice langsung untuk biaya jasa/utilities.
- [ERPNext Auto Repeat](https://docs.frappe.io/erpnext/auto-repeat-recurring-orders-and-invoices): generator dokumen, pilihan review draft dan kontrol perubahan terms.
- [Odoo Maintenance requests](https://www.odoo.com/documentation/19.0/applications/inventory_and_mrp/maintenance/maintenance_requests.html): corrective/preventive, peralatan, prioritas, penugasan, instruksi, dan hasil pekerjaan.
- [Odoo Fleet Services](https://www.odoo.com/documentation/19.0/applications/hr/fleet/service.html): vehicle, driver, tanggal servis, odometer, vendor, catatan dan status.

## Matriks 51 use case

Matriks berikut juga tersedia melalui tombol **Peta use case** di prototype. Interaktif berarti alur inti dicontohkan, bukan integrasi production lengkap.

| ID | Skenario | Alur / keputusan | Cakupan |
|---|---|---|---|
| V01 | Vendor baru | Profil, kontak, rekening, pajak, lampiran. Supplier yang sama dibaca GA dan Finance. | Interaktif |
| V02 | Perubahan rekening | Rekening berubah → UNVERIFIED → Finance memeriksa lagi sebelum pembayaran. | Interaktif |
| V03 | Vendor duplikat / multi kontak | Normalisasi NPWP, merge supplier, beberapa kontak/rekening, maker-checker produksi. | Rancangan |
| C01 | Kontrak sewa 3 tahun | Satu kontrak; bill per tahun; periode prepaid berasal dari bill. | Interaktif |
| C02 | Jasa outsourcing | Ruang lingkup, SLA, PIC, kontrak cleaning/security, pekerjaan dan invoice terhubung. | Interaktif |
| C03 | Asuransi dan izin | Nomor polis/izin, penerbit, cakupan, masa berlaku, pengingat, dokumen. | Interaktif |
| C04 | Renewal / addendum / terminasi | Form ketentuan dan tanggal tersedia; versi addendum, approval dan scheduler notifikasi belum dibuat. | Rancangan |
| C05 | Disewakan | Pihak penyewa dicatat; supplier bill ditolak. Invoice pelanggan / AR tetap Finance. | Rancangan |
| C06 | Deposit / jaminan / retensi | Kewajiban legal terpisah dari invoice dan biaya. Pelacakan Finance belum disimulasikan. | Rancangan |
| A01 | Aset dan kendaraan satu register | Serial, plat, pemegang, kelas, garansi, kepemilikan; Fleet membuka ID aset yang sama. | Interaktif |
| A02 | Mutasi / serah terima | Perubahan lokasi dan pemegang tercatat di riwayat; approval serah terima dan tanda tangan belum dibuat. | Interaktif |
| A03 | Operating equipment | Kelompok terpisah, label/barcode dan pemegang. Stock opname, reserve dan penggantian massal belum dibuat. | Rancangan |
| A04 | Software | License ID, seat, pengguna, vendor, dan akhir lisensi tersedia. Assignment per seat belum dibuat. | Interaktif |
| A05 | Projects | CIP/pre-opening, milestone dan progres. Kapitalisasi serta bill termin berada di Finance. | Rancangan |
| A06 | Hilang / scrap / dijual | Kondisi dapat dicatat; approval disposal dan penghapusan nilai buku belum dibuat. | Rancangan |
| M01 | Perbaikan mendadak | Pelapor, prioritas, keluhan, vendor, teknisi, pekerjaan, parts, downtime, hasil, lampiran. | Interaktif |
| M02 | Preventive maintenance | Jadwal waktu/km → buat satu pekerjaan per occurrence; klik ulang tidak menggandakan. | Interaktif |
| M03 | Garansi / internal / tanpa biaya | Pekerjaan GA dapat selesai tanpa bill. Garansi dicatat pada aset. | Interaktif |
| M04 | Estimasi / budget / persetujuan | Estimasi adalah fakta berbeda dari bill. Budget harus memiliki approver, waktu, versi, dan limit. Belum dimodelkan. | Rancangan |
| M05 | Pekerjaan gagal / ulang | Hasil dan tindak lanjut tersedia; reopen formal, linked follow-up dan SLA eskalasi belum dibuat. | Rancangan |
| W01 | Profil lokasi | Alamat, tipe, luas, kapasitas, kontak darurat, jam buka, kontrak. | Interaktif |
| W02 | Meter listrik / air | Kontrak sambungan + pelanggan + log meter per periode; konsumsi terhitung; duplikat periode ditolak. | Interaktif |
| W03 | Reset meter / token prabayar | Reset meter perlu event penggantian; token adalah pembelian/top-up, bukan invoice bulanan otomatis. | Rancangan |
| W04 | Supplies dari stok / pengadaan | Permintaan, qty, pemenuhan sebagian, penerima, referensi Inventory/PO. Stok tidak berubah dari demo. | Interaktif |
| W05 | Cleaning | Shift, zona, petugas, checklist, jumlah tugas selesai, pemeriksa dan temuan. | Interaktif |
| W06 | Keamanan / fasilitas / insiden | Form permintaan dengan pelapor, prioritas, PIC dan tindak lanjut. Eskalasi darurat belum otomatis. | Interaktif |
| W07 | Reservasi ruang | Tanggal dan jam; pemesanan bertabrakan untuk ruang/lokasi sama ditolak. | Interaktif |
| W08 | Tamu / akses | Host, perusahaan, badge dan waktu masuk/keluar; tidak perlu salinan identitas sensitif. | Interaktif |
| F01 | Servis kendaraan | Pekerjaan yang sama tampil di Maintenance dan Fleet, lengkap odometer/parts. | Interaktif |
| F02 | STNK / KIR / polis | Dokumen menunjuk kendaraan; jika menunjuk kontrak, masa berlaku dibaca dari kontrak. | Interaktif |
| F03 | Pemakaian kendaraan | Pengemudi, tujuan, keperluan, kilometer awal/akhir, status serah terima. | Interaktif |
| F04 | BBM | Liter, odometer, struk, jalur pembayaran; uang tidak diketik pada log GA. | Interaktif |
| F05 | Kecelakaan / klaim / tilang | Pisahkan insiden, klaim asuransi, perbaikan dan pembayaran; tidak semua menjadi biaya vendor. | Rancangan |
| L01 | Surat masuk / keluar | Nomor, kategori, pihak, penandatangan, isi, klasifikasi dan lampiran. | Interaktif |
| L02 | Penomoran / tanda tangan | Sequence nomor, hak surat terbatas, e-sign dan pengiriman perlu backend. | Rancangan |
| B01 | Invoice diterima GA | GA memasukkan fakta invoice sekali; draft yang sama masuk antrean Finance. | Interaktif |
| B02 | Invoice langsung ke Finance | Finance membuat bill langsung tanpa menunggu GA; referensi operasional opsional. | Interaktif |
| B03 | Review / kembali / hold | Finance memeriksa dokumen, akun, periode; kembali/hold wajib beralasan. | Interaktif |
| B04 | Invoice duplikat | Nomor invoice + supplier sama ditolak; jangan buat bill baru untuk placeholder recurring. | Interaktif |
| B05 | Satu invoice banyak objek/lokasi | Baris dialokasikan per referensi/lokasi; total tidak dihitung penuh berulang pada semua objek. | Interaktif |
| B06 | Bayar sebagian / rekening belum sah | Sisa dihitung; lebih bayar dan rekening UNVERIFIED ditolak. Hanya simulasi. | Interaktif |
| B07 | Credit note / koreksi / pajak | Bill POSTED dikunci. Koreksi dan mesin pajak, multi-currency, alokasi diskon/pajak belum dibuat. | Rancangan |
| B08 | Claim / kas kecil / uang muka | Jalur biaya dipilih GA; claim tetap HR, kas kecil dan advance tetap Finance, bukan AP vendor secara paksa. | Rancangan |
| R01 | Listrik nominal variabel | Template membuat draft kosong nominal aktual; invoice datang mengisi draft yang sama. | Interaktif |
| R02 | Internet / sewa nominal tetap | Draft usulan dibuat; tetap wajib cocokkan invoice, periode, akun, dan bukti sebelum posting. | Interaktif |
| R03 | Bulanan / triwulanan / tahunan | Periode tagihan dan tanggal tiba dihitung; tanggal 31 menyesuaikan hari akhir bulan. | Interaktif |
| R04 | Jeda / berakhir / klik ulang | Template dijeda atau kontrak berakhir tidak menghasilkan draft; periode sama tidak menggandakan. | Interaktif |
| R05 | Selisih / tagihan belum datang | Ambang selisih memerlukan penjelasan review; draft WAITING_INVOICE tetap terlihat di Inbox. | Interaktif |
| R06 | Prorata / kenaikan harga / overlap | Periode parsial ditolak generator; perlu draft manual dan versi perubahan kontrak/template. | Rancangan |
| X01 | Permissions / audit / attachments | Simulasi role, riwayat perubahan dan file lokal. Enforcement server, storage aman, antivirus dan audit immutable belum dibuat. | Rancangan |
| X02 | Notifikasi / laporan | Tanggal dan PIC tersimpan. Email, push, eskalasi, pengingat harian dan laporan lintas site belum dibuat. | Rancangan |

**Perbedaan kontrak legal vs uang Finance.** Permintaan versi awal prototype meniadakan `nilai` kontrak, jadi field ini memang tidak ada. Jika nanti dibutuhkan, simpan total nilai yang tertera pada kontrak sebagai fakta legal GA, tampilkan terpisah dari bill. Jangan hitung `Total ditagih` seolah-olah nilai kontrak. Estimasi perbaikan operasional juga fakta GA; total aktual tetap hanya dari bill Finance.
