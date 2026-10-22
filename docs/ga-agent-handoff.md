# Handoff konteks GA dan prototype

Diperbarui 17 Oktober 2026. Sumber keputusan: percakapan **Petakan hubungan menu GA**. Catatan ini dibuat atas permintaan pengguna agar agent lain memiliki konteks pekerjaan yang sudah selesai.

## Status dan cara membuka

**Yang selesai adalah prototype interaksi lokal dan pemeriksaan codebase/data referensi. Belum ada implementasi cloud, migrasi, impor Excel, pembayaran atau posting jurnal dari pekerjaan GA ini.** Perubahan produksi lain dalam working tree berasal dari pekerjaan lain; jangan dianggap bagian dari prototype atau ditimpa.

- Preview: http://127.0.0.1:8766/ga-asset-relations-prototype.html
- Jika server berhenti, jalankan `python3 -m http.server 8766` dari `/Users/hari/Documents/itulah`.
- Semua contoh fiktif, disimpan dalam memori; reload menghapus perubahan dan snooze. Tombol Sample Finance feedback hanya simulasi.
- Shortcut review: Review coverage, Vehicle example, Insurance example, Project example, Phone preview.
- Referensi desain detail aset: `asset-detail-prototype.html?o=A&a=avanza&d=desk`, tidak diubah.

## Keputusan pengguna dan model produk

1. Pertahankan 10 menu GA: **Overview, Supply Requests, Repairs, Service Schedule, Assets, Contracts, Sites, Suppliers, Letters, Files**. Jenis aset menjadi filter di satu register Assets. Tidak perlu sidebar/tabel baru per jenis.
2. Detail objek mengumpulkan hubungan dan aksi kontekstual. Form dari aset mengisi aset/site asal; form global meminta pilih target. Hubungan harus bermakna bisnis: target repair, objek servis, cakupan polis, subjek dokumen, custody, sumber bill. Bukan satu tabel graph atau tombol tautkan generik untuk semua proses.
3. **Perjalanan dinas berada di HR. Pemeriksaan fisik/stocktake fixed asset dikeluarkan dari scope.** Temuan inspeksi saat servis tetap diperlukan untuk tindak lanjut repair.
4. **Renovasi/kontraktor/CIP:** pintu GA di Assets → Projects. GA mengurus site/PIC/kontraktor, scope, milestone/progres, bukti/SPK, BAST, temuan dan usulan hasil. Finance Contractor Projects tetap mengurus uang muka, invoice, CIP dan kapitalisasi. Gunakan identitas/referensi proyek yang sama; jangan membuat ledger CIP atau proyek keuangan kedua.
5. **Listrik/air/internet:** GA mengurus langganan, site, nomor pelanggan/meter, pembacaan, kewajiban bulanan dan permintaan tagihan. Finance memposting, membayar dan merekonsiliasi. Status Finance kembali sebagai informasi baca. Nilai tagihan mengikuti invoice aktual, bukan estimasi meter otomatis.
6. **BPKB dan objek ganda:** mobil, metadata dokumen/scan, lembar asli, dan kejadian custody adalah objek berbeda. Pemegang mobil bisa berbeda dari pemegang BPKB asli. Assets → Controlled documents adalah tampilan pengendalian dokumen asli; tidak otomatis menjadikannya fixed asset yang dikapitalisasi. Files dan kartu mobil membaca dokumen asli/custody yang sama.
7. Polis, PDF polis dan objek pertanggungan juga berbeda. Satu polis dapat melindungi banyak aset. Kontrak tingkat site tidak otomatis berarti semua aset di site masuk roster pertanggungan.
8. **Letters:** isi barang/dokumen yang diserahkan berbeda dari konteks pendukung. Item campuran dapat menunjuk aset terdaftar, dokumen asli, salinan dokumen, atau teks bebas. Item baru bebas tidak otomatis menciptakan aset. Menerbitkan surat tidak memindahkan aset atau custody; gunakan aksi operasional eksplisit.
9. **Editor surat kaya dipertahankan.** Prototype writer asli diintegrasikan melalui adapter opsional. Implementasi produksi harus memperluas React writer yang ada, bukan memindahkan iframe prototype ke produksi.
10. Reminders berasal dari **kewajiban sumber + tindakan + PIC + jatuh tempo/periode/KM**, bukan sekadar per menu. Dedup perpanjangan kontrak/dokumen yang sama; pekerjaan selesai, lunas atau dokumen kembali mengakhiri reminder terkait. Snooze perlu tanggal mendatang dan alasan, tidak menyelesaikan pekerjaan sumber.
11. Bills dari GA adalah Draft Finance. Penyelesaian repair, persetujuan klaim dan penerimaan uang klaim merupakan kejadian berbeda. Tagihan tenant dan penerimaan sewa harus terpisah dari tagihan supplier.

## Cakupan prototype yang tersedia

- Seluruh 10 menu punya detail dan jalur relasi. Overview merupakan agregat, Sites memakai master lokasi yang sudah ada. Form tersedia untuk delapan menu create serta edit Site, dengan aksi turunan sesuai objek.
- **11 build aset / 59 kelas aktual:** LAND, BUILDING, TECH, VEHICLE, FFE, IT, AUDIO, OE, SOFTWARE, DEFERRED, CIP. Field spesifikasi dan pilihan kelas mengikuti build; DEFERRED/CIP tidak mendapat aksi pemeliharaan fisik.
- **17 tipe kontrak:** sewa masuk tanah/toko/rumah/kendaraan; maintenance/cleaning; asuransi properti/kendaraan; izin usaha/kendaraan/PBB/reklame; langganan listrik/air/telekom; sewa keluar gedung/peralatan. Kode lengkap ada di coverage dan data file.
- 7 kategori supplies dan 10 form surat manual. Surat sistem yang bersumber receipt/allotment tetap milik proses sumbernya.
- Repair: target aset/site, anggaran, persetujuan, pekerjaan, penyelesaian, evidence, klaim, penggantian dan Draft Finance.
- Service: target aset/site, provider/kontrak, interval tanggal atau KM, penyelesaian/history, next due dan repair dari temuan.
- Aset: identitas, lokasi/pemegang, dokumen, originals, kontrak/cakupan, servis, repair, klaim, mutasi, replacement/disposal request, bill dan surat terkait.
- Original: register tanpa harus sudah ada scan, serah/pinjam/kembali, pemegang/lokasi/batas kembali dan history terpisah dari aset.
- Projects: milestone, progress, BAST, temuan bertanggal, usulan output, submission closeout dan preview Finance pada referensi yang sama. Usulan hasil tidak otomatis menciptakan aset baru.
- Utilities: kewajiban per bulan, meter due, invoice expected-by, payment due, PIC, pembacaan, Draft Finance dan feedback simulasi.
- Operating receipts: BBM, ban/parts, oli/pelumas, genset, komputer dan biaya operasi lain dengan site/aset/supplier/bukti.
- Quantity: registered quantity/unit, penyerahan dan pengembalian sebagian, available/held/history; larangan over-issue/return dan whole-lot move saat masih ada unit dipegang. Supplies mendukung penerimaan sebagian dan pemakaian/penyerahan/return.
- Sewa keluar: charge request tenant, jumlah benar-benar diterima dan saldo belum dibayar terpisah dari supplier bills.
- Rich letter writer: toolbar, format/print, item references campuran, simpan/buka kembali isi, reconciliation recipient/references, issue locking, navigasi balik ke sumber.
- Overview: renewal, document expiry, servis tanggal/KM, batas kembali original, target repair/proyek/milestone/temuan, supplies, follow-up klaim, kewajiban utility, pembayaran supplier dan collection tenant. Ada source action, PIC, filter dan snooze.

## File yang menjadi sumber konteks

Semua path berikut relatif terhadap `/Users/hari/Documents/itulah`:

| File | Fungsi |
| --- | --- |
| `ga-asset-relations-prototype.html` | Shell 10 menu dan shortcut review |
| `ga-asset-relations-prototype.css` | Detail/form sheet desktop/phone dan layout writer |
| `ga-asset-relations-data.js` | Katalog aktual dan seed contoh |
| `ga-asset-relations-prototype.js` | Controller, forms, detail, typed relations dan alur utama |
| `ga-workspace-extension.js` | Project, reminders, utilities, operating receipts, quantity, receivable dan Finance feedback lokal |
| `letter-writer-prototype.html` | Rich writer referensi yang dipertahankan |
| `ga-letter-writer-adapter.js` | Adapter opsional aktif dengan `?ga=1`, sinkronisasi iframe dan surat lokal |
| `docs/ga-prototype-coverage.md` | Daftar cakupan dan QA terbaru, termasuk tambahan scope akhir |
| `docs/ga-asset-relations-cloud-plan.md` | Gap codebase, model usulan, fase API/database/frontend dan aturan integritas |
| `docs/ga-coverage-audit-2026-10-17.md` | Audit tiga workbook dan batas GA vs modul lain |

Untuk konflik wording lama di cloud plan, gunakan keputusan akhir di bagian ini dan coverage terbaru: aksi operasional/form kontekstual menggantikan konsep Link records generik. Rancangan endpoint/tabel pada cloud plan adalah usulan, bukan kontrak produksi yang telah tersedia.

## Hasil audit produksi yang penting untuk agent berikutnya

- Asset hub saat audit belum mengagregasi semua daftar hubungan. Gunakan FK/tabel existing; tambahkan pembacaan terkait dengan pagination/otorisasi. Jangan menyalin record ke tiap kartu detail.
- Insurance **sudah ada** sebagai tipe Contracts. Composer saat audit mengirim `asset_id: null`; schema kontrak punya satu referensi aset opsional. Roster multi-aset, validasi compatibility/site dan history coverage perlu implementasi.
- Metadata dokumen tanpa scan, physical originals/custody, claims dan odometer history/next-KM adalah usulan perlu data/proses tervalidasi. Jangan buat file_id palsu atau fixed_asset palsu untuk BPKB.
- Backend quantity registration sudah ada, tetapi pembacaan aset/UI perlu konsistensi quantity/unit. `scripts/import_client_assets.py` saat audit memaksa quantity nol menjadi satu: review sebelum import.
- Finance sudah memiliki kapitalisasi/depresiasi/disposal/CIP reclassification. Existing Contractor Projects berada di `backend/src/cloud/postgres/contractor_projects.rs` dan `frontend-hub/src/screens/finance/contractor-projects.tsx`, API `/api/v1/finance/contractor-projects`. Tambahkan/link operational GA tanpa mengganti state keuangan OPEN/CLOSED.
- Utilities sudah punya meter history/monthly upsert/recurring dan jalur Draft bill: `backend/src/cloud/postgres/ga_contracts.rs`, `frontend-hub/src/screens/contracts/hub.tsx`, `frontend-hub/src/screens/ga/bill-request.tsx`. Perlu perluasan kewajiban bulanan dan alur feedback, bukan billing engine kedua.
- Reminder engine sudah ada di `backend/src/cloud/postgres/reminders.rs` dan domain reminder: contract/document expiry, bill due, tax. Perluas engine existing untuk source obligations, dedup dan recipients. Jangan membuat notifier paralel.
- **Bug Finance/GA terkonfirmasi saat audit, belum diperbaiki oleh pekerjaan ini:** `frontend-hub/src/screens/contracts/hub.tsx` melabeli `row.billed_minor` sebagai Received to date pada kontrak DISEWAKAN, sedangkan `backend/src/cloud/postgres/ga_contracts.rs` menghitungnya dari posted supplier invoice expense lines. Itu bukan penerimaan tenant. Perlu sumber receivable/receipt yang benar. Prototype memisahkan konsepnya saja.
- Letters produksi: manual GENERAL/free-form; `WrittenItem` dan parser `itemsOf` di `frontend-hub/src/screens/letters/forms.ts` belum menyimpan typed references saat audit. Attachment document_link bukan referensi isi item surat. Perlu stable line IDs, refs opsional tervalidasi, snapshot cetak/issue freeze, reverse queries, template tanpa referensi transaksi. Existing React writer berada di `frontend-hub/src/screens/letters/writer.tsx` dan editor terkait.
- Regenerasi frontend-contract dari sumber kontrak resmi jika DTO berubah; jangan edit generated TS manual. Validasi semua scope/permission/ID/type di server dan simpan create+relasi secara atomik/idempotent.
- Karena working tree dipakai beberapa chat, path/line di atas adalah hasil audit waktu itu. Baca ulang kode terbaru sebelum implementasi, jaga perubahan agent/user lain.

## Workbook yang diperiksa, bukan diimpor

- `/Users/hari/Downloads/MASTER ASSET.xls`: 1.342 baris biaya/register, termasuk 668 CIP, 92 baris quantity > 1 dan 3 quantity nol. Ada barang campuran per baris; tidak cukup untuk langsung menyimpulkan serial/pemegang/unit fisik. Flag Y/N tidak otomatis berarti disposed.
- `/Users/hari/Downloads/Daftar asset.xls`: katalog lama 57 kelas bernomor dengan anotasi tambahan dan beberapa code/label mismatch. Jangan map ordinal secara buta.
- `/Users/hari/Downloads/Laporan_Master_Account1.xlsx`: 7.528 akun unik dengan pengulangan per unit; 59 kelas prototype cocok dengan label kelas aktual yang diperiksa. Akun biaya menunjukkan kebutuhan utilitas/BBM/supplies/maintenance/proyek/sewa, bukan alasan semua akun menjadi menu GA.
- Coverage kategori tidak berarti semua record sudah diimpor, dibersihkan atau semua kombinasi workflow teruji. Detail mismatch dan batas ownership ada di audit.

## Verifikasi dan batas klaim

- Syntax scripts lolos. Model checks: 75 seed records unik, referensi resolve, 11 build/59 kelas/17 kontrak, dedup reminder, penghapusan reminder selesai/lunas, quantity conservation/excess refusal, partial receipts, tenant receipts terpisah dan tidak ada CIP duplikat.
- Browser: semua kategori form, 10 menu/detail, create/edit, dirty cancellation, servis 50.000 → next 60.000 km, BPKB custody terpisah, Draft bill repair, project milestone/BAST/temuan/output, paid utility feedback, handover 5 lalu return 2 menyisakan 3 held dari registered 24, original return, operating receipt dan rich writer save/reopen/issue.
- Desktop dan phone ditinjau. Screenshot ada di `tmp/ga-completion-20261017/{overview,project,writer}.png`.
- Ini targeted prototype QA, **bukan** bukti integration production, persistence, permissions, concurrency, attachment upload, financial posting, atau regression semua kombinasi.

Handoff ini menyampaikan konteks. Implementasi/deploy cloud tidak dimulai melalui pesan konteks ini; ikuti permintaan aktif pengguna di chat masing-masing.
