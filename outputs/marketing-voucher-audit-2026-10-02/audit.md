# Audit marketing cloud, voucher dan coupon — 2 Oktober 2026

## Ruang lingkup dan batas pembuktian

Review checkout workspace saat ini (termasuk perubahan lokal), backend cloud/edge, pricing engine, migration dan frontend POS/Hub. Tidak mengakses database produksi atau mengubah kode aplikasi. Karena itu, temuan menunjukkan risiko implementasi, bukan bukti bahwa uang sudah hilang atau versi ini sudah terdeploy. Luna diminta dengan reasoning max untuk eksplorasi tambahan.

Voucher stored-value berbeda dari coupon diskon. Stored-value bisa berupa uang pelanggan yang sudah dibayar; tidak semua issuance/redeem merupakan biaya marketing.

## Temuan prioritas

### 1. P1 — Campaign budget dan max uses dilampaui oleh promo stackable dalam satu basket

Lokasi: `backend/crates/pricing-engine/src/engine.rs:352-376`, `backend/src/edge/pricing.rs:268-301`, `backend/src/cloud/postgres/sync.rs:6925-6955`.

Setiap rule membaca sisa campaign yang sama sebelum scenario diterapkan; tidak ada pengurangan sisa campaign antar-rule dalam scenario. Dua rule stackable sama-sama memakai seluruh remainder. Penghitungan cloud kemudian menambah usage/spent per rule yang diaplikasikan.

**Reproduksi runtime berhasil pada salinan crate terisolasi:** harga 100.000, campaign budget 50.000, spent 40.000, dua rule 50% stackable → diskon **20.000** sementara remainder hanya **10.000**. Campaign max_uses=1 dengan dua rule stackable → **2 rule** diterapkan, sementara usage campaign dihitung per rule. Kedua test mengonfirmasi perilaku bug, bukan membuktikan limit aman.

Terjadi lewat checkout normal bila konfigurasi tersebut aktif. Alokasi hard cap tidak menyelesaikan ini karena allowance diubah menjadi Caps yang masuk ke engine yang sama. Dengan N rule, pengeluaran pada basket terakhir dapat mengambil remainder berulang hingga batas nilai barang/aturan stacking.

Perbaikan: setiap scenario harus memiliki sisa budget dan uses per campaign yang dikurangi setiap aplikasi rule; enforce untuk diskon dan definisi use yang konsisten dengan ledger cloud. Sementara: hindari beberapa rule stackable dalam campaign yang perlu hard cap.

### 2. P1 — Coupon satu kali pakai di POS masih memakai counter tersinkron, bukan lifecycle hold

Lokasi: `backend/src/edge/pricing.rs:750-778`, `backend/src/cloud/postgres/pricing.rs:727-772`, `backend/src/cloud/postgres/sync.rs:6857-6955`; lifecycle terpisah di `backend/src/cloud/postgres/coupons.rs`.

Pricing aktif membaca `commercial_coupon` dan `commercial_usage`, bukan `coupon_code`/`coupon_authorization`. Checkout POS mengirim `coupon_codes`, tidak mengotorisasi/commit coupon hold. Dua toko yang memiliki snapshot used=0 dapat sama-sama menerima coupon max_uses=1 sebelum usage toko lain datang. Local usage melindungi transaksi berikutnya di satu node, tetapi tidak mereservasi penggunaan lintas toko.

Tabel dan API lifecycle coupon sudah memiliki parent/code lock dan cap-redemptions-holds. Proteksi itu tidak berada pada jalur harga/checkout yang diperiksa. Jangan menganggap keberadaan API tersebut menjamin coupon POS single-use. Pembatalan lifecycle juga tidak otomatis mengubah `commercial_coupon` yang dibaca POS.

Perbaikan: satukan sumber coupon yang aktif, relay authorization untuk coupon terbatas, dan commit hold bersama sale fact; saat pusat tidak dapat dihubungi, tolak coupon yang memerlukan jaminan single-use. Budget biasa lintas toko adalah soft limit selama hanya bergantung pada usage terakhir.

### 3. P1 — Cloud menerima tender VOUCHER tanpa debit sah, dan replay hold lintas sale

Lokasi: `backend/src/cloud/domain/sync.rs:2522-2560`, `backend/src/cloud/postgres/sync.rs:6835-6855`, `backend/src/cloud/postgres/vouchers.rs:1505-1554`.

Parser cloud hanya memvalidasi method, nominal positif, posisi dan jumlah tender. Ia tidak menerapkan aturan `validate_tenders` yang mengharuskan voucher_authorization_id. Apply sale hanya memanggil commit jika id ada; VOUCHER tanpa id bisa menjadi sale yang dianggap dibayar tanpa debit voucher.

Jika hold ada dan sudah COMMITTED, fungsi commit langsung berhasil tanpa membuktikan sale_id yang baru adalah sale yang sebelumnya menghabiskan hold. Amount/site/code tender juga tidak dikirim untuk dibandingkan dengan hold. Sale baru dapat memakai hold lama tanpa debit kedua, atau melaporkan pembayaran lebih besar dari nominal hold.

**Prasyarat:** akses credential sync origin atau node yang salah/diubah; bukan bypass kasir normal lewat UI. Edge terbaru memeriksa hold lokal, jumlah maksimum, expiry dan penggunaan satu kali. Cloud tetap perlu menjaga invariant-nya sendiri agar menerima fakta node lama/buggy tidak menjadi celah finansial. UUID sale yang baru lolos guard idempotency per-sale.

Perbaikan: wajibkan hold untuk VOUCHER, bind origin/site, voucher code, amount dan sale; simpan unique settlement yang membuat satu hold hanya membayar satu sale. Replay hanya sukses jika seluruh binding identik. Validasi parser tidak boleh bergantung pada komentar yang menyatakan edge sudah memeriksa.

### 4. P1 — Redeem manual mengambil saldo yang sudah di-hold untuk checkout lain

Lokasi: `backend/src/cloud/postgres/vouchers.rs:994`, `backend/src/cloud/postgres/vouchers.rs:1230-1245`; invariant existing `backend/invariants/commercial/voucher_holds_within_balance.sql` sudah menandai gap ini.

Authorize menghitung available=balance-live holds di bawah lock. Direct redeem membandingkan amount dengan balance saja. Contoh saldo 100.000, live hold 80.000, direct redeem 100.000 → saldo nol sementara toko masih memiliki hold 80.000 yang valid. Bila barang sudah keluar, sale upload gagal karena saldo tidak mencukupi dan stream tertahan.

Endpoint redeem tersedia untuk role Cashier (`backend/src/cloud/domain/auth.rs:423`), walaupun akses aktual juga bergantung pada middleware/capability/deployment. Ini tidak menambah debit di atas saldo; kerugiannya berupa hold yang tidak lagi didukung dana, barang yang sudah keluar, dispute dan kebutuhan rekonsiliasi.

Perbaikan: direct redeem harus memakai available_minor di bawah lock yang sama atau seluruh redemption lewat hold. Jangan sekadar menambahkan warning UI.

### 5. P2 — Tender lebih kecil dari hold menghabiskan seluruh hold

Lokasi: `backend/src/edge/sqlite.rs:2228-2237`, `backend/src/cloud/postgres/vouchers.rs:1538-1554`.

Edge menolak tender > hold, tetapi menerima tender < hold. Cloud commit mengambil seluruh amount hold, bukan jumlah tender. Hold 100.000 dengan tender voucher 20.000 mengurangi voucher 100.000. UI POS yang diperiksa normalnya meminta hold dengan amount tender yang sama, sehingga pemicu memerlukan client/API yang mengirim jumlah berbeda. Dampak: pelanggan kehilangan saldo 80.000, liability dan pembayaran sale berbeda, dispute/kompensasi.

Perbaikan: wajibkan equality, atau dukung partial settlement eksplisit dengan pelepasan remainder dan rekonsiliasi atomik.

### 6. P1 control gap — Nilai voucher penukaran poin ditentukan caller

Temuan tambahan Luna, dikonfirmasi ulang: `backend/src/cloud/postgres/loyalty.rs:271-287,313-316,357-410`; HTTP route `backend/src/cloud/http/mod.rs:1886,3516-3527`.

Body direct endpoint `/api/v1/customers/{customer_id}/points/redeem` membawa `points` dan `voucher_value_minor` secara terpisah. Server memeriksa keduanya positif dan saldo poin mencukupi, tetapi tidak memverifikasi kurs, rasio nilai, batas nominal atau budget marketing. Dengan saldo setidaknya 1 poin, caller yang berhak dapat meminta 1 poin ditukar menjadi voucher GOODWILL bernilai misalnya 100 juta rupiah dalam unit penyimpanan IDR yang digunakan sistem. Nilai voucher berasal langsung dari body.

Prasyarat: login/capability yang mengizinkan route, secara role default Supervisor; bukan akses anonim atau pelanggan biasa. Komentar kode memang menyatakan rate diputuskan caller karena ledger tidak memiliki loyalty scheme. Ini adalah **celah kontrol pada HTTP boundary**, bukan kesalahan aritmetika ledger atau eskalasi hak akses: bila Supervisor memang sengaja diizinkan memberi goodwill bernilai bebas, itu keputusan governance yang perlu disadari. Jalur member-request confirmation memiliki konversi server tersendiri, tetapi tidak menutup direct endpoint ini.

Perbaikan: derive nilai dari skema konversi server pada HTTP/application layer; batasi atau pisahkan manual award dengan approval dan budget yang jelas. Larang caller customer/till menentukan kurs sendiri. Prioritaskan bila endpoint ini dipakai integrasi otomatis.

## Risiko hard cap tambahan dari pembacaan kode (belum diuji database)

- `cap_allocation.rs:341-397`: rebalance melakukan read/compute/write tanpa transaction atau lock per policy. Ia dipanggil dari watcher dan request set allocation; concurrent rebalance dengan snapshot grants berbeda dapat menggabungkan hasil yang menghabiskan pool yang sama. Trigger migration 0387 hanya mencegah grant mengecil, bukan membatasi total grant. Serialisasikan seluruh read/compute/write per `(kind,key,measure)`; uji interleaving dua worker di Postgres.
- `cap_allocation.rs:414` dan `edge/pricing.rs:268`: toko tanpa grant tetap memakai fleet count. Saat toko baru belum memiliki grant atau allowance belum diterima, hard cap tidak otomatis fail-closed pada setiap jalur. Selain itu grant awal dihitung dari total limit, bukan remaining setelah historical spending; mengaktifkan split saat campaign sudah berjalan perlu accounting pengeluaran terdahulu. Audit state deployment sebelum mengandalkan split sebagai jaminan pengeluaran.

## Validasi

Dua reproduksi pricing dijalankan pada copy crate di direktori temporary, sehingga source aplikasi tidak diubah. Hasil: remaining budget 10.000 / actual discount 20.000; remaining uses 1 / applied rules 2. Temuan database/cloud lainnya ditelusuri secara statis; belum diuji melalui transaksi Postgres atau production API. Tidak ada pentest terhadap sistem live.

## Urutan tindakan

1. Batasi nilai voucher penukaran poin pada boundary server; perbaiki shared campaign budget/uses pada setiap pricing scenario.
2. Satukan coupon POS dengan lifecycle authorization/commit untuk cap yang wajib dijamin.
3. Tutup validation dan binding voucher pada cloud ingest.
4. Jadikan manual redeem menghormati live holds; samakan amount tender dan settlement.
5. Serialisasikan allocator dan definisikan state hard-cap yang fail-closed.
6. Verifikasi exposure aktual read-only: campaign stackable aktif, coupon limited aktif, policy allocation, total grants vs limits, invariant holds vs balance, sale voucher vs voucher movement, dan failed sync streams.

Reproduksi tersimpan di `reproduce.py` dan `reproduction-tests.rs` dalam folder laporan. Jalankan `python3 outputs/marketing-voucher-audit-2026-10-02/reproduce.py` dari checkout. Assertion mengunci perilaku bug yang diamati; setelah bug diperbaiki, witness ini harus diganti dengan regression assertion yang membatasi diskon/uses.
