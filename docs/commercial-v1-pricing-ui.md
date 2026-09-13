# Commercial V1 — Pricing UI

Keputusan UI: **UI-001, revisi 1 — 12 September 2026**  
Business baseline: **1.0**, tidak berubah.  
Status: keputusan dokumentasi UI yang disetujui melalui pembahasan; bukan bukti layar sudah diimplementasikan atau diuji.

Acuan: [Commercial V1](commercial-v1.md), [data/state contract](commercial-v1-data-state-contract.md), dan [kontrol perubahan](commercial-v1-change-control.md).

## 1. Keputusan dan batas

Default Pricing HO adalah **matrix Article × Store**. Ini keputusan UI baru, bukan business rule baru dan bukan penggantian resolution policy.

```text
Store/context -> satu applicable Price List -> Regular Price
             -> Markdown jika aktif -> Harga sebelum promo
             -> Promotion evaluation dalam konteks checkout -> Final Price
```

Harga toko lain adalah comparison data. Jangan memperkenalkan Price Stack, Resolved Price, channel/store override layers, atau backend pricing entities baru hanya untuk mendukung layout ini. Article bisa mempunyai SKU dengan harga berbeda; satu SKU/context tetap menghasilkan satu harga deterministik.

Navigasi tetap `Prices | Changes | History`. Markdown dikelola melalui Changes. Coupon tetap di Promotions; Points di Customer / Loyalty; Voucher tetap stored-value tender dengan ownership terpisah.

## 2. Prices: matrix default

| Article | Store 01 | Store 03 | Store 05 |
|---|---:|---:|---:|
| Jacket Classic | Rp499k | Rp479k | Rp349k · Markdown |
| Oxford Shirt | Rp299k | Rp299k | Rp299k |
| Sneakers | Rp699k | Rp679k | Rp459k–499k · varies by SKU |

Angka ini ilustrasi UI, bukan hasil aplikasi atau tambahan golden fixture.

- Rows = Articles; columns = Stores.
- Cell default = **harga sebelum promo dari versi yang aktif di store**, termasuk applicable tax sesuai konteks, bukan latest HO publication.
- Satu angka hanya jika seluruh relevant SKUs resolve ke displayed amount yang sama. Perbedaan price source/markdown tetap dapat diperiksa pada detail SKU walaupun angkanya sama.
- Jika harga SKU berbeda, tampilkan numeric min–max range dan label **varies by SKU** / **berbeda per SKU**. Range hanya meringkas SKUs dalam Article × Store tersebut, bukan range antartoko atau hasil promotion.
- Relevant SKUs mengikuti scope katalog/assortment/filter yang dinyatakan pada view. Tampilkan cakupan pada detail. SKU dengan harga missing/error tidak boleh diam-diam dibuang agar cell tampak lengkap; tandai cakupan harga belum lengkap.
- Filter toko/periode/konteks boleh membantu navigasi; tidak mengganti default matrix menjadi All Stores range table.
- Jangan menaruh nama promotion di setiap cell. Jika markdown aktif, indikator ringkas dengan regular/markdown detail tersedia; jangan menyamarkan markdown reduction sebagai promotion discount.
- Detail menyediakan angka rupiah penuh; compact formatting tidak boleh menyembunyikan perbedaan SKU atau menghasilkan range yang tampak identik karena pembulatan label.

Header/view menyebut waktu acuan, currency, tax basis, dan freshness. Jika koneksi/evidence belum mutakhir, tampilkan **harga aktif terakhir terkonfirmasi** beserta waktu konfirmasi. Jangan mengklaim kondisi POS saat ini secara pasti tanpa bukti yang cukup. Expired/invalid source bukan harga aktif yang sah.

## 3. Active store price dan publication pending

| Bukti yang tersedia | Tampilan |
|---|---|
| Store telah mengonfirmasi versi aktif, tidak ada update baru | Harga dari active version + waktu konfirmasi |
| HO punya publication lebih baru, store belum activate | Active store price tetap utama; badge publication baru/pending dan detail harga versi baru |
| Rollout gagal pada store | Active price yang masih sah + failed rollout/reason; jangan mengganti angka dengan harga target |
| Store evidence stale/offline | Last confirmed active price dengan freshness warning; latest HO price hanya informasi target |
| Tidak ada valid activation evidence | Belum terkonfirmasi / harga aktif tidak tersedia; jangan fallback diam-diam ke latest HO |
| POS dalam satu store belum seragam, jika kondisi ini terjadi | Tandai aktivasi belum seragam dan buka detail POS; jangan memilih satu seolah berlaku di semua POS |

Contoh: store masih aktif Rp459k, HO mempublikasikan markdown Rp349k tetapi belum activated. Cell tetap **Rp459k · pembaruan pending**. Detail menunjukkan active Rp459k dan pending Rp349k secara terpisah. Setelah activation terkonfirmasi dan validity berlaku, cell menjadi Rp349k.

Delivery, activation, schedule validity, dan usage adalah bukti berbeda. Reaching scheduled start saja tidak membuktikan POS sudah memakai publication. UI tidak membuat status rollout baru menjadi pricing precedence.

## 4. Drill-down

| Klik | Hasil |
|---|---|
| Store header | Store pricing view: Article, Regular, Markdown, Harga sebelum promo, Informasi promotion, activation/freshness |
| Article | Cross-store view: Store, Regular, Markdown, Harga sebelum promo, Informasi promotion; tabs Overview / Store Prices / History |
| Article × Store cell | Price explanation untuk konteks itu; SKU breakdown bila variasi atau source berbeda |
| SKU | Exact regular, markdown, harga sebelum promo, source/version, validity, dan relevant promotion information |

Store/article views menggunakan range bila SKU bervariasi; tidak memilih representative SKU sebagai harga Article. Jika Regular dan Markdown masing-masing mempunyai variasi, tampilkan dengan label/cakupan jelas; exact pairing tersedia pada SKU detail.

Cell detail memuat Article/SKU, store/context, currency/tax basis, Price List/version, regular, markdown program/amount/period, harga sebelum promo, activated version/time, serta pending publication bila ada. Nama client untuk harga ini **Harga sebelum promo**; jika menggunakan `Current`, definisinya wajib sama.

## 5. Promotion adalah informasi kontekstual

Promotion di samping pricing menunjukkan relevant offer, bukan guaranteed Final Price. Berikan benefit dan syarat ringkas: member, coupon, quantity/spend, period/store, dan markdown compatibility.

| Kondisi | Penjelasan yang ditampilkan |
|---|---|
| Item markdown, offer Exclude markdown | Tidak berlaku pada item markdown |
| Article berisi SKU campuran | Berlaku/tidak berlaku pada SKU terkait; detail eligibility per SKU |
| Member/coupon diperlukan | Memerlukan member / kode; belum menjamin qualification lainnya |
| Offer tampak relevan, basket belum dievaluasi | Hasil akhir ditentukan saat checkout, termasuk threshold dan combination |

Jangan menampilkan universal Final Price pada matrix/store/article view. Final Price membutuhkan complete evaluation input; simulator jika tersedia harus menyebut konteksnya. No-promo final yang kebetulan sama dengan harga sebelum promo tidak mengubah definisi kedua kolom.

## 6. Changes: pekerjaan operasional yang masih perlu perhatian

Satu row adalah satu pricing change/program, bukan satu Article. Types tetap Regular Price Change, Markdown, Clearance, Correction. Clearance bukan pricing layer tambahan.

Changes mencakup scheduled changes, rollout/partial activation, active period, dan pending/failed stores. Tampilkan business period dan rollout progress sebagai dimensi terpisah, bukan memaksa seluruhnya menjadi satu enum lifecycle.

| Change | Jenis | Period / kondisi | Aktivasi | Perhatian |
|---|---|---|---|---|
| Q3 Clearance | Markdown | Active period sampai 30 Sep | 10/13 stores | 2 pending, 1 failed |
| October Price Update | Regular Price | Scheduled 1 Oct | Bukti distribusi tersedia pada detail | Belum berlaku |

Regular change boleh keluar dari default operational list setelah penerapan pada seluruh target terselesaikan dan tidak ada outstanding action. Period-based markdown tetap relevan selama active period; period berakhir tidak otomatis menyelesaikan pending recovery/activation work. Semua source records tetap dapat ditelusuri melalui detail/history.

**Keputusan ini tidak menambahkan Draft sebagai lifecycle Pricing Change.** Authoring Draft merupakan keputusan terpisah. Pembahasan generic draft configuration/promotion di dokumen lain tidak otomatis menetapkan lifecycle Pricing Change. Pending/failed rollout tetap harus terlihat tanpa menunggu keputusan authoring Draft.

## 7. History: event/audit timeline

History dapat menerima events ketika Change masih Scheduled, rollout, atau Active. History bukan folder eksklusif untuk completed Changes; satu program dapat tampil di Changes dan mempunyai events di History pada saat bersamaan.

Event view memuat waktu, event type, change/version, target store/SKU, before/after jika applicable, actor/system source, reason, dan evidence. Publication/activation/failure/expiry events dibedakan agar publication tidak dibaca sebagai bukti harga sudah aktif. Event non-price-change boleh mempunyai before/after tidak applicable.

History read-only. Source lama tidak dipindahkan/dihapus saat row keluar dari Changes. Correction menghasilkan version/event baru sesuai baseline, bukan mengedit audit lama.

## 7a. Bukti aktivasi sebagai dasar harga — catatan implementasi

Ditambahkan 12 September 2026. Ini bukan aturan baru; ini pencatatan bagaimana
§2 dan §3 dipenuhi, dan apa yang terungkap ketika dipenuhi.

Cell matrix sekarang dihargai dari **himpunan versi yang toko laporkan telah
diaktifkan** — bukan versi tertinggi, melainkan himpunannya. Aktivasi dicatat
per (publication, origin), dan sebuah toko dapat memegang v15 dan v22 tanpa
pernah menerapkan v20; sebuah plafon akan diam-diam memasukkan harga v20 ke
dalam buku yang toko itu tidak punya.

Himpunan itu dipakai untuk **mempersempit kandidat, bukan mengubah peringkat**.
Yang menang di antara kandidat yang tersisa tetap diputuskan engine — publication
terbaru, lalu scope, lalu tanggal mulai. Tidak ada resolver kedua.

Konsekuensi yang perlu dinyatakan: pada estate dev per tanggal ini, **satu-satunya
buku yang memberi harga katalog (v15, 2.722 SKU) tidak punya satu pun bukti
aktivasi.** Maka jawaban jujur untuk hampir setiap cell adalah "belum
terkonfirmasi", dan itulah §3 baris terakhir bekerja sebagaimana mestinya —
bukan regresi. Layar yang sebelumnya menampilkan harga HO di bawah nama toko
membuat klaim yang estate ini tidak punya buktinya.

## 8. Acceptance checklist UI-001

Checklist berikut tambahan UI; **tidak dihitung sebagai bagian dari 200 kernel scenarios**.

Status diperbarui 12 September 2026 terhadap implementasi backend. **Kolom Status di bawah menyatakan bukti backend saja** — sebuah baris PASS berarti server menghasilkan jawaban yang benar dan dapat diperiksa, bukan bahwa layarnya sudah digambar dan dilihat orang. Baris apa pun yang menuntut bukti visual tetap NOT_RUN.

| ID | Skenario | Expected | Status backend |
|---|---|---|---|
| UI-001-01 | Buka Prices HO | Matrix Article × Store, bukan All Stores range table | NOT_RUN — butuh bukti layar |
| UI-001-02 | Semua relevant SKU mempunyai harga sama | Satu angka dan cakupan jelas | NOT_RUN |
| UI-001-03 | Harga SKU berbeda | Numeric min–max + varies by SKU + exact SKU drill-down | NOT_RUN |
| UI-001-04 | Sebagian SKU missing/error | Data incomplete terlihat; tidak disembunyikan oleh angka/range | NOT_RUN |
| UI-001-05 | Latest HO publication belum activated | Active price tetap utama; pending target terpisah | **PASS (backend)** — ART-DENIM di 12 toko dihargai Rp139.000 dari **v12**, buku yang toko aktifkan, sementara v15 (2.722 SKU, tanpa aktivasi) tidak dipakai; tiap kolom membawa `active_version` dan `pending_publication` terpisah |
| UI-001-06 | Offline/stale/invalid activation evidence | Freshness/unknown/invalid dinyatakan; tidak mengklaim latest price sudah aktif | **SEBAGIAN** — "tanpa bukti aktivasi" terbukti: store-13 tidak menghasilkan harga sama sekali, bukan harga HO. Stale/invalid **belum**: snapshot tidak punya masa berlaku (FIND-05) |
| UI-001-07 | Klik store, article, cell, SKU | Navigasi dan angka konsisten pada konteks/version yang sama | **SEBAGIAN** — Prices dan History kini memakai dasar versi yang sama; konsistensi drill-down belum diuji |
| UI-001-08 | Markdown Exclude vs Allow, termasuk mixed SKU | Inapplicability eksplisit; offer tidak dijamin menjadi Final Price | **PASS (kernel)** — `MarkdownPolicy` + alasan tolak `MARKDOWN_EXCLUDED`; mixed SKU belum diuji di layar |
| UI-001-09 | Rollout 10/13, pending dan failed stores | Changes menampilkan outstanding actions, tidak seluruhnya Applied | **SEBAGIAN** — pending/target hidup (`aktivasi 0/13`); **failed** menunggu UI-003 |
| UI-001-10 | Active Change menghasilkan event | Event muncul di History sementara Change tetap di Changes | NOT_RUN — History belum event timeline (bagian C audit konsistensi) |
| UI-001-11 | Regular selesai / markdown active period berakhir | Visibility mengikuti outstanding operational work; audit tetap tersedia | **PASS (backend)** — filter memakai pekerjaan dan bergantung jenis; dikunci 8 tes |
| UI-001-12 | Authoring lifecycle | Tidak memperkenalkan Pricing Change Draft melalui perubahan ini | **PASS** — tidak ada Draft ditambahkan |
| UI-001-13 | Currency/tax/time dan compact labels | Konteks eksplisit, angka penuh tersedia, variasi tidak hilang karena formatting | NOT_RUN |
| UI-001-14 | Store mempunyai bukti aktivasi POS berbeda | Perbedaan terlihat dan dapat diperiksa; tidak menampilkan satu harga sebagai pasti seragam | **BELUM DAPAT DIUJI** — `active_version` per toko mengambil himpunan seluruh origin di toko itu tanpa melaporkan ketidakseragamannya. Perlu keputusan: lapor per-origin, atau nyatakan satu-POS-per-toko |

Hasil implementasi nantinya melaporkan screens/columns/tabs yang berubah, matrix/drill-down behavior, remaining discrepancies, test evidence, dan konfirmasi business rules tetap baseline 1.0. Pekerjaan dokumentasi ini tidak menyatakan implementation checklist sudah lulus.
