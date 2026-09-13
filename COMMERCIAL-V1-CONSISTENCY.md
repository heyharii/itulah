# Commercial V1 — audit konsistensi kode terhadap baseline

Diperiksa 12 September 2026 terhadap `docs/commercial-v1.md` baseline **1.0** dan
`docs/commercial-v1-pricing-ui.md` **UI-001 revisi 1**.

Ini bukan klaim bahwa sisanya sudah benar. Yang diperiksa adalah bagian yang
disentuh sesi ini ditambah permukaan Pricing yang UI-001 atur langsung. Yang
tidak diperiksa, ditulis tidak diperiksa.

Baseline menyatakan: *"Jika ada kontradiksi di dalam paket, catat defect
dokumentasi dan hentikan perubahan perilaku terkait sampai terselesaikan."*
Dokumen ini mencatat arah sebaliknya — kode yang berbeda dari paket — dan tidak
mengubah satu pun aturan bisnis untuk menutupnya.

---

## ⚠ Dua hal yang mendesak, ditemukan 12 Sep sore

### Paket spesifikasi terkunci TIDAK TERLACAK GIT

`docs/commercial-v1.md`, `commercial-v1-acceptance-test-plan.md`,
`commercial-v1-decisions-and-invariants.md`, `commercial-v1-pricing-ui.md`, dan
`fixtures/commercial-v1-golden-fixtures.json` — **tak satu pun ada di git.**
`docs/` tidak di-ignore; berkas-berkas itu memang belum pernah di-add.

Otoritas atas setiap angka uang di V1, 200 skenario, dan fixture yang dibaca
harness saat runtime hidup di satu disk tanpa riwayat. Satu `git clean -fd`
menghapusnya. Saya tidak meng-commit-nya sendiri — itu dokumen Anda — tetapi ini
perlu diputuskan hari ini.

### Empat cacat kernel terbukti oleh harness acceptance

Dijalankan terhadap fixture emas, bukan terhadap keluaran aplikasi. Tak satu pun
diperbaiki — memperbaiki kernel agar cocok dengan fixture yang sama yang
mengujinya akan menghapus buktinya.

| ID | Cacat | Akibat |
|---|---|---|
| **MON-008** [D11] | Tiga baris Rp1 dikurangi Rp2: kernel mengembalikan baris `[1,1,0]`, `discount_total 2`, total 2 — padahal barangnya 3. **Melaporkan diskon Rp2 dan hanya memberikan Rp1** | Melanggar INV-02 dan INV-03. `discount_total` adalah niat rule, bukan yang sampai ke baris |
| **COM-007** [D03] | Dua basket offer Combine atas Rp600.000 (min 500k, min 550k): diharapkan **400.000**, kernel memberi **500.000** (B2 ditolak `AmountTooLow`) | D03 mematok snapshot kualifikasi untuk **semua** basket promotion; kernel mengukur ulang tiap offer terhadap sisa yang ditinggalkan offer sebelumnya |
| **BXY-004** [D01] | Dua unit berharga sama: **urutan scan** menentukan mana yang gratis | Tak terlihat di kasir; mengubah nilai retur satu unit |
| **PRP-003** [D11] | Mempermutasi keranjang memindahkan satu rupiah antar baris | Tie-break alokasi memakai indeks baris, bukan id unit yang stabil |

Dua terakhir hampir pasti **satu** cacat: tie-break alokasi memakai posisi, bukan
identitas.

Cakupan: **64 dari 200 terbukti** (44 PASS · 4 FAIL · 20 ADOPTED · 15 tanpa
permukaan kernel · 117 belum di-encode). **Nol NOT_SPECIFIED** — paketnya tidak
menyisakan satu angka pun untuk ditebak. D04, D06, D07, D13, D14 belum punya satu
skenario berjalan; FAULT 17/17, RACE 9/9, PERF 1/1 belum tersentuh.

---

## A. Prices — matrix Article × Store (UI-001 §2–§5)

| # | Baseline | Kode hari ini | Berat |
|---|---|---|---|
| A1 | §2 "Cell default = harga sebelum promo dari versi **yang aktif di store**, bukan latest HO publication" | Matrix menghitung harga dari `load_site_price_book` — **buku terbaru yang berlaku di HO**. Bukti aktivasi toko (`commercial_publication_activation`, 164 baris) dibaca di layar detail buku, **tidak** dipakai untuk menentukan angka di cell | **Tinggi** |
| A2 | §3 enam keadaan bukti, masing-masing tampilan berbeda (pending, rollout gagal, stale/offline, tanpa bukti aktivasi, POS tak seragam) | Tak satu pun ada. Cell selalu menampilkan satu angka tanpa menyatakan bukti di baliknya | **Tinggi** — konsekuensi langsung A1 |
| A3 | §3 "Jangan fallback diam-diam ke latest HO" | Itu persis yang terjadi, karena tak ada jalur lain | **Tinggi** |
| A4 | §2 range min–max + label "varies by SKU" | **Ada** (`min_unit_price_minor`/`max_unit_price_minor`, label "priced per size") | ✅ |
| A5 | §2 "SKU dengan harga missing/error tidak boleh diam-diam dibuang" | Belum diperiksa | — |
| A6 | §1 "Jangan memperkenalkan Price Stack" | Layar memakai istilah `stack` secara harfiah: `ShopPriceStack.stack: Vec<PriceRung>` dengan `rank`, tampil sebagai "Why this price" | **Perlu putusan** — §4 mengizinkan *price explanation*; yang dilarang adalah stack sebagai model harga. Penamaannya bertabrakan dengan larangan meski perilakunya penjelasan |
| A7 | §4 nama client untuk angka ini wajib **"Harga sebelum promo"**, atau bila memakai `Current` definisinya wajib sama | Layar menulis **"PRICE NOW"** | **Rendah**, tapi nyata: ini nama yang dilihat client |

**A1 adalah akar tiga baris pertama.** Selama harga cell berasal dari buku HO,
tak ada tempat untuk badge pending, stale, atau rollout gagal — tak ada dua
angka untuk dibedakan.

---

## B. Changes (UI-001 §6)

Dibangun sesi ini sebagai proyeksi dari `commercial_publication`, tanpa entitas
baru. Tiga hal semula tidak konsisten dan **sudah diperbaiki**:

| # | Baseline | Semula | Sekarang |
|---|---|---|---|
| B1 | §6 "business period dan rollout progress sebagai **dimensi terpisah**, bukan satu enum lifecycle" | Satu enum `ChangeStatus` | `status` (jendela bisnis) + `rollout` (aktivasi toko), dua bidang terpisah |
| B2 | §6 contoh baris menyebut "10/13 stores · 2 pending, 1 failed" | Tak ada dimensi rollout sama sekali | `RolloutProgress { activated, target, pending, failed }` dari `commercial_publication_activation` |
| B3 | §6 "Regular change boleh keluar dari default list setelah penerapan pada seluruh target terselesaikan"; "period berakhir tidak otomatis menyelesaikan pending activation work" | Filter memakai jendela | Filter memakai **pekerjaan**, dan bergantung jenis: regular yang rollout-nya selesai keluar walau jendelanya terbuka selamanya; markdown bertahan selama active period dan tetap bertahan setelah periodenya tutup bila ada toko tertinggal |

Dua hal **tidak bisa diturunkan** dari data yang ada, dan dilaporkan kosong
alih-alih ditebak:

| # | Baseline | Kenapa tidak bisa |
|---|---|---|
| B4 | §6 "Types tetap Regular Price Change, Markdown, **Clearance**, **Correction**" | **DISELESAIKAN oleh UI-002** (`commercial_publication.change_type`, migrasi 0182). Alasan semula tetap benar: Clearance dan Correction adalah *maksud penulis*. Clearance dan markdown akhir musim adalah baris yang sama; correction dan re-price adalah baris yang sama. Membaca nama buku untuk kata "clearance" adalah tebakan — buku bernama "Q3 Clearance" yang berisi harga dasar adalah re-price. **Perbaikan terkecil: satu kolom nullable `commercial_publication.change_type`.** Tidak saya tambahkan: Anda membatasi penambahan pada name/scope/effective period/status, dan type tidak termasuk |
| B5 | §6 "pending **dan failed** stores" | **DISELESAIKAN oleh UI-003.** `commercial_publication_rollout` (0179) membawa PENDING/ACTIVE/FAILED dengan waktu percobaan dan kata-kata toko sendiri; nama lama menjadi view atas baris ACTIVE sehingga enam pembaca lama tak berubah artinya. **Satu koreksi atas tulisan saya semula:** pusat tidak *sepenuhnya* buta — blok dari kasir memang sampai sebagai `sync_command_cursor.blocked_at_seq/blocked_reason`. Tapi itu diagnostik lane berkunci nomor urut, satu per origin, terhapus begitu toko lewat, dan tak ada yang menyambungkannya ke publication. Isi B5 tetap berlaku |

---

## C. History (UI-001 §7)

Dibangun sesi ini sebagai timeline effective-price, memutar ulang `price_cart`
di tiap instan yang bisa mengubah jawaban.

| # | Baseline | Kode hari ini | Berat |
|---|---|---|---|
| C1 | §7 "History dapat menerima events ketika Change masih **Scheduled**, rollout, atau Active" | Timeline harga tak bisa menampilkan buku yang belum berlaku — belum ada harga yang berubah | **Tinggi** — ini perbedaan konsep, bukan bidang yang kurang |
| C2 | §7 "**Publication/activation/failure/expiry events dibedakan** agar publication tidak dibaca sebagai bukti harga sudah aktif" | Hanya satu jenis peristiwa: harga berubah. Aktivasi dan kedaluwarsa tak muncul | **Tinggi** |
| C3 | §7 event memuat actor/system source, **reason**, **evidence** | Ada: waktu, before/after, version, publisher. Tidak ada: reason, evidence, event type | Sedang |
| C4 | §7 "satu program dapat tampil di Changes **dan** mempunyai events di History pada saat bersamaan" | Kompatibel — keduanya membaca sumber yang sama, tak ada yang memindahkan baris | ✅ |
| C5 | §7 History read-only; correction menghasilkan version baru, bukan mengedit audit lama | Read-only ✅. Buku imutabel ✅ | ✅ |

**Ringkasnya:** yang dibangun adalah *effective-price view* yang Anda minta di
pesan Anda, dan itu benar sejauh itu. §7 meminta sesuatu yang lebih besar —
*event/audit timeline* yang membedakan terbit, aktif, gagal, dan kedaluwarsa.
Yang ada adalah separuhnya.

---

## D. D07 — operasi offline

D07 **lengkap tersepesifikasi**. Saya keliru menyebutnya butuh keputusan; yang
ada adalah celah implementasi. Tujuh klausa, tiga ditegakkan:

| Klausa D07 | Kode | |
|---|---|---|
| "voucher redemption memerlukan online authority" | `validate_tenders` menolak tender Voucher tanpa `voucher_authorization_id`, dan hanya pusat yang bisa mencetaknya | ✅ |
| "points redemption memerlukan online authority" | Rutenya hanya ada di cloud; kasir tak punya | ✅ struktural |
| "Pending points belum tersedia sampai cloud menerima sale" | Earn terjadi saat pusat menerima penjualan | ✅ |
| **"V1 offline menerima cash sale saja"** — kartu butuh online | `tender.rs` menyebut kata online/offline **dua kali**, keduanya di pesan voucher. Kartu diterima tanpa syarat | ❌ |
| **"unique/limited coupon memerlukan online authority"**; shared unlimited boleh offline | Kasir memuat `commercial_coupon` dari buku dan **tak tahu jenisnya** — tak ada kolom kind di sisi kasir. Mekanisme RESERVED yang dibangun sesi ini hidup di pusat dan kasir tak tahu apa-apa tentangnya | ❌ |
| **"AcceptReturn/refund memerlukan online authority"** | Kasir menulis `sale_return` lokal tanpa memeriksa apa pun | ❌ |
| **"Expired/corrupt/incomplete snapshot tidak digunakan"** | Snapshot harga di kasir **tak punya masa berlaku sama sekali** | ❌ |
| "Member-only offer memerlukan verified cached membership yang belum expired" | Belum diperiksa | — |
| "Simpan waktu lokal, timezone, config version, server sync receipt terpisah" | Belum diperiksa | — |

### Akar penyebabnya satu

**Kasir tak punya konsep konektivitasnya sendiri.** Satu-satunya kata
"reachable" di `src/edge/` adalah tentang printer. Tak ada `is_online`, tak ada
`last_sync_at` yang dibaca sebagai gerbang, tak ada masa berlaku snapshot.

Satu aturan D07 yang berjalan — voucher — berjalan **bukan** karena kasir tahu
ia online, melainkan karena tender wajib membawa token yang hanya pusat bisa
cetak. Itu pola yang lebih baik daripada menebak konektivitas: gagal-tertutup
secara konstruksi, dan berlaku sama saat jaringan putus di tengah transaksi.

**Pola yang sama belum dipakai untuk empat hal lain yang D07 minta.** Itulah
pekerjaannya, dan tak satu pun butuh kebijakan baru.

---

## E. D12 — charges

Dibangun sesi ini: charges ada, dipajaki pada kategorinya sendiri, dan tak
terjangkau promosi/ambang/poin. Itu **fondasi yang benar dan separuh dari D12**.

| Klausa D12 | Kode | |
|---|---|---|
| "Points earning nol bila tidak ada positive eligible net merchandise" | Charges tak menghasilkan poin | ✅ |
| Charges refundable sepenuhnya | Tak ada yang menghalangi | ✅ dasar |
| **"dialokasikan saat checkout ke units proporsional terhadap net merchandise ex-tax"** | **Tidak ada.** Charges saya tingkat-keranjang, tak dialokasikan ke unit | ❌ |
| **"Snapshot charges gross/net/tax per unit"** | Disimpan per-charge, bukan per-unit | ❌ |
| **"partial return mengembalikan original share"** | Mustahil tanpa alokasi per unit | ❌ konsekuensi |
| "jika seluruh merchandise net nol, pembagian equal per unit dengan stable remainder" | Tidak ada | ❌ |
| **"Zero-due sale boleh completed tanpa tender"** | `validate_tenders` mengembalikan `NoTender` untuk daftar kosong tanpa syarat | ❌ |
| **"Cash handed dan change dicatat terpisah; `sale_tender.amount` hanya amount applied pada due"** | Kasir menulis `tender.amount_minor` mentah — yaitu uang yang **diserahkan**, bukan yang **dikenakan**. Untuk tunai 200.000 atas tagihan 170.000, baris tender mencatat 200.000 | ❌ **laten** |

Soal yang terakhir: data benih tidak punya satu pun penjualan berkembalian
(`sum(change_minor) = 0` pada 21.829 baris), jadi cacat ini belum pernah
menggigit. Ia menggigit pada penjualan tunai nyata pertama yang memberi
kembalian, dan yang salah adalah setiap penjumlahan `amount_minor` — kelebihan
sebesar kembalian yang diberikan.

---

## F. Model penjualan kanonik

Keputusan Anda: `sale` kanonik, `sale.customer_id` diisi dari
`edge_sale.customer_id` saat sync/finalisasi.

Dilaksanakan. Satu temuan yang mengubah artinya:

**Ruang id `sale` dan `edge_sale` terpisah total** — nol dari 48 edge sale cocok
dengan satu pun dari 21.829 sale kanonik. **Tidak ada apa pun yang
mengkanonikalisasi sebuah edge sale.** Jadi premis "sync mengubah fakta
`edge_sale` menjadi fakta kanonik" belum berlaku hari ini. Pembawaan
`customer_id` benar dan terbukti hidup, tetapi hanya menyala ketika kedua id
kebetulan sama — yaitu pada penjualan yang pusat finalisasi setelah fakta toko
yang cocok tiba.

`edge_sale_tender` juga **nol baris** untuk 48 edge sale itu.

---

## Yang tidak diperiksa

`commercial-v1-data-state-contract.md`, `commercial-v1-evidence-and-client-views.md`,
dan `commercial-architecture-plan.md` belum dibaca baris demi baris terhadap
kode. D01–D06, D08–D11, D13–D14, K01–K06 dan INV-01–INV-16 belum diaudit satu
per satu — hanya bagian yang disentuh sesi ini.
