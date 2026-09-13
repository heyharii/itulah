# Commercial V1 — Acceptance Test Plan

Tanggal: 12 September 2026  
Cakupan: 200 skenario kernel/integration, 21 kelompok, 5 golden fixtures, 16 invariants, dan checklist UAT.  
Status aplikasi: semua 200 skenario di matriks adalah **NOT_RUN**. Dokumen ini adalah spesifikasi pengujian, bukan laporan kelulusan implementasi.

Bagian dari **baseline 1.0**: [acuan utama](commercial-v1.md), [data/state/command](commercial-v1-data-state-contract.md), [bukti dan tampilan client](commercial-v1-evidence-and-client-views.md), dan [kontrol perubahan](commercial-v1-change-control.md). Tambahan capability packing atau evidence dashboard memerlukan cases baru dan tidak otomatis termasuk dalam hitungan 200 ini.

Aturan yang dipakai ada di [Keputusan dan Invariant V1](commercial-v1-decisions-and-invariants.md). Semua D01–D14 di matriks sudah dipilih sebagai baseline V1; tidak ada expected result yang sengaja diserahkan kepada tebakan implementer. Konfigurasi spesifik seperti tarif pajak, tanggal, dan rate points tetap menjadi input fixture yang eksplisit.

Dokumen ini menguji integrasi lintas domain. Ia tidak menyatakan bahwa seluruh sale/tax/voucher/loyalty storage dimiliki modul Pricing, dan tidak mengklaim kesesuaian kode repository saat ini.

## 1. Prioritas, level, dan status

| Kode | Arti |
|---|---|
| P0 | Wajib lulus untuk merilis capability terkait: uang, saldo, hak penggunaan, angka utama, recovery, atau integrity. |
| P1 | Perilaku operasional, authoring, analytics, dan kinerja yang juga diuji sebelum scope itu dinyatakan siap. |
| UNIT | Pure domain/engine dengan input deterministik. |
| INT | Application service + persistence/adapters yang sebenarnya. |
| PROP | Property-based atau independent reference oracle, dengan seed dan minimal failing case tersimpan. |
| RACE | Minimal dua sesi/connection sungguhan dipaksa overlap dengan synchronization barrier. |
| FAULT | Gangguan sengaja disisipkan di titik tertentu: crash, timeout, disconnect, duplicate, restart. |
| E2E | Perjalanan lengkap dari command/UI hingga ledger, provider stub/sandbox, dan analytics. |
| PERF | Pengukuran pada workload/hardware yang dicatat. |

Jumlah prioritas: **183 P0**, **17 P1**.  
Level: UNIT 64, INT 78, PROP 18, RACE 9, FAULT 17, E2E 13, PERF 1.

Status hasil eksekusi: NOT_RUN, PASS, FAIL, atau BLOCKED. BLOCKED bukan PASS; tulis dependency/fitur yang belum tersedia. Capability yang belum diimplementasikan tetap punya test contract, tetapi tidak boleh diberi centang selesai.

Format satu hasil tes:

| Test ID | Build / schema / rule versions | Environment | Status | Expected / actual | Evidence / defect |
|---|---|---|---|---|---|
| contoh: PAY-006 | commit + migration + engine version | provider simulator, Postgres, target store | NOT_RUN | diisi ketika dijalankan | trace IDs + provider events + ledger assertions |

## 2. Lingkungan dan data uji

- Gunakan tenant, customers, stores, voucher/coupon codes, dan provider sandbox khusus test. Fault tests tidak memakai uang/customer produksi.
- Minimum dua stores dan dua registers, supaya global/per-customer limits tidak keliru menjadi local limits.
- Clock dapat dikendalikan; tes expiry tidak memakai sleep panjang atau tanggal laptop sebagai satu-satunya acuan.
- Postgres diuji dengan constraint dan isolation/concurrency nyata; SQLite diuji dengan konfigurasi constraint yang benar dan reopen setelah crash.
- Pure calculation oracle menggunakan exact rational/integer math yang terpisah dari engine production.
- Provider simulator dapat menyatakan: definitive success/failure, pending, response lost after success, delayed/out-of-order callbacks, serta genuine late failure.
- Simpan source configuration/version, quote hash, logical command ID, authorization generation, provider reference, dan ledger source IDs pada evidence.
- Stable IDs dan urutan canonical selalu eksplisit. Reorder payload transport tidak boleh menciptakan hasil baru.
- Jalankan setiap write/recovery case dengan request tunggal, retry berurutan, dan retry yang overlap bila relevan.

## 3. Invariant lintas skenario

Setiap test uang atau recovery memeriksa invariants yang relevan, bukan hanya respons HTTP.

| ID | Fokus |
|---|---|
| INV-01 | Exact values — Money final berupa integer rupiah; signed ledger entries boleh negatif, tetapi unit price/discount/refund allocation tidak negatif. Intermediate fractions dihitung exact. |
| INV-02 | Amount reconciliation — Sum net merchandise + merchandise tax + allocated charges gross = Amount Due. Unit/line/header totals konsisten. |
| INV-03 | Discount conservation — Sum discount_allocation = applied promotion discount; gross discount = ex-tax delta + tax delta; discount unit <= remaining unit amount. |
| INV-04 | Best Price — Hasil adalah minimum dari seluruh valid outcomes dalam contract V1, atau explicit evaluation failure; tidak ada silent approximate winner. |
| INV-05 | Historical evidence — Completed monetary snapshot dan rule version yang digunakan tidak berubah; perubahan melalui versi baru atau reversal. |
| INV-06 | Payment coverage — COMPLETED membutuhkan sum confirmed applied tenders = Amount Due; cash change bukan applied tender. Zero-due sale boleh tanpa tender. |
| INV-07 | Voucher balance — Ledger sum = current balance; available = spendable balance minus active holds; reserve/commit/release tidak menciptakan double spend. |
| INV-08 | Points balance — Available points sama dengan committed ledger sum; pending offline earning belum tersedia. Redemption tidak membuat saldo negatif; reversal yang sah boleh. |
| INV-09 | At-most-once business effect — Command logical ID/key + payload fingerprint hanya menimbulkan satu efek bisnis. Attempt/retry boleh banyak dengan hasil uang yang sama. |
| INV-10 | Durable references — Satu loyalty redemption menghasilkan paling banyak satu voucher; provider operations, ledger effects, dan successful restoration menunjuk source logical operation yang unik. |
| INV-11 | Scarcity reservation — Consumed + reserved <= limit; authorization hanya dapat dibukukan oleh checkout/quote/generation pemiliknya. Timer tidak membebaskan unresolved payment secara buta. |
| INV-12 | Return uniqueness — Satu sale_unit hanya dapat diterima dalam satu return. REQUESTED/REJECTED tidak mengonsumsi hak retur secara permanen. |
| INV-13 | Refund capacity — Sum non-cancelled committed allocations, termasuk pending/failed-retriable/succeeded, tidak melebihi original applied tender. Concurrent returns memakai kapasitas yang diserialisasi. |
| INV-14 | Refund conservation — Sum allocation = refund obligation. Semua units beserta allocated charges dikembalikan menghasilkan total refund persis original payment; partial refund memakai original values. |
| INV-15 | Status truth — UNKNOWN/PROCESSING bukan FAILED; completion tidak diumumkan tanpa bukti yang cukup. Recovery selalu dapat dilanjutkan dari durable intent/result. |
| INV-16 | Analytics replay — Campaign eligible unit dihitung sekali per metric; accepted return direverse sekali; replay/rebuild menghasilkan totals yang sama sesuai scope version. |

## 4. Golden fixtures

Angka fixture tersedia juga dalam [JSON](fixtures/commercial-v1-golden-fixtures.json). JSON adalah expected values, bukan hasil engine production.

### G01 — Golden cart tanpa pajak

Fixture tax = 0 secara eksplisit, supaya expected lama 1.076 points tetap benar. Customer C001 adalah member valid. U01 = Shirt, U02 = Shoes; T01 = Voucher, T02 = Card.

| Input | Nilai |
|---|---|
| Shirt regular | Rp299.000 |
| Shoes regular / markdown | Rp499.000 / Rp349.000 |
| Line promotion A | Shirt 20%; Combine; priority 100 |
| Basket promotion B | Rp50.000, minimum eligible displayed spend >= Rp500.000; Markdown Allow; Combine; priority 200 |
| Coupon | Unique single-use valid, diwajibkan promotion B |
| Loyalty | 1 point per Rp1.000 eligible ex-tax; 2x pada kedua units; combine monetary = Yes |
| Voucher applied | Rp100.000 |
| Charges | Rp0 |

| Expected | Shirt U01 | Shoes U02 | Total |
|---|---:|---:|---:|
| After line promotion | 239.200 | 349.000 | 588.200 |
| Basket allocation | 20.333 | 29.667 | 50.000 |
| Final gross = net ex-tax | 218.867 | 319.333 | 538.200 |
| Base points allocated | 219 | 319 | 538 |
| Awarded points 2x | 438 | 638 | 1.076 |

Promotion discount ex-tax = Rp109.800. Markdown reduction = Rp150.000 dan tidak masuk Promotion Discount Budget.

| Tahap | Voucher | Card | Total refund | Points reversal |
|---|---:|---:|---:|---:|
| Original payment | 100.000 | 438.200 | — | — |
| Shoes return | 59.334 | 259.999 | 319.333 | 638 |
| Shirt return berikutnya | 40.666 | 178.201 | 218.867 | 438 |
| Full return kumulatif | 100.000 | 438.200 | 538.200 | 1.076 |

Setelah Shoes return: retained Campaign Net Sales = Rp218.867; net Promotion Discount Spend = Rp80.133; coupon tetap consumed. Tidak ada basket requalification atau clawback.

### G02 — Inclusive/exclusive equivalence

Gunakan pajak hipotetis 10% sebagai fixture kalkulasi, bukan tarif produksi.

| Source | Net ex-tax | Tax | Displayed / due | Points 2x |
|---|---:|---:|---:|---:|
| Inclusive Rp110.000 | 100.000 | 10.000 | 110.000 | 200 |
| Exclusive Rp100.000 | 100.000 | 10.000 | 110.000 | 200 |
| Setelah discount 10% pada displayed amount | 90.000 | 9.000 | 99.000 | 180 |

Tidak ada charges. Currency IDR, tax component dibulatkan HALF_UP per unit pada fixture.

### G03 — Golden cart dengan fixture pajak 10%

Input displayed prices, promotions, coupon, dan tender sama dengan G01. Source prices tax-inclusive. Aturan points sekarang memakai ex-tax; expected points harus berubah.

| Expected | Shirt U01 | Shoes U02 | Total |
|---|---:|---:|---:|
| Final displayed gross | 218.867 | 319.333 | 538.200 |
| Tax component | 19.897 | 29.030 | 48.927 |
| Net ex-tax | 198.970 | 290.303 | 489.273 |
| Base points allocated | 199 | 290 | 489 |
| Awarded points 2x | 398 | 580 | 978 |

Line promotion ex-tax discount = Rp54.363. Basket promotion ex-tax discount = Rp45.455. Total Discount Budget usage = Rp99.818. Customer Discount Given termasuk tax = Rp109.800.

Shoes return tetap mengembalikan gross Rp319.333: voucher Rp59.334 dan card Rp259.999, tetapi points reversal = 580. Retained Net Sales = Rp198.970. Gunakan snapshot tax/net asal ketika current tax config berubah.

### G04 — Buy 2 Get 1 dengan leftover

Tax 0, tidak ada loyalty atau promotion lain. Units U01..U04 berharga Rp400.000, Rp300.000, Rp200.000, Rp100.000.

- Reward: U04, unit termurah Rp100.000.
- Buyers: U01 dan U02, dua unit termahal tersisa.
- Leftover: U03, tidak menerima bundle allocation.
- Total discount Rp100.000, dibagi ke participants U01/U02/U04 yang memiliki gross Rp800.000.

| Unit | Before | Discount allocation | Net refundable |
|---|---:|---:|---:|
| U01 buyer | 400.000 | 50.000 | 350.000 |
| U02 buyer | 300.000 | 37.500 | 262.500 |
| U03 leftover | 200.000 | 0 | 200.000 |
| U04 reward | 100.000 | 12.500 | 87.500 |
| Total | 1.000.000 | 100.000 | 900.000 |

Receipt dapat menjelaskan reward FREE sebagai mekanisme offer, tetapi refund mengikuti allocated unit values yang ditampilkan/dijelaskan dengan jelas. Return satu unit tidak membentuk bundle baru.

### G05 — Rounding dengan empat tender

Original tender balances: T01 Rp26.000, T02 Rp26.000, T03 Rp26.000, T04 Rp22.000. Refund amount Rp2.

Exact shares: 0,52 / 0,52 / 0,52 / 0,44. Floor semua nol; dua residual rupiah diberikan ke T01 dan T02 menurut stable tie-break.

Expected allocation: **[1, 1, 0, 0]**. Tidak menggunakan “last tender gets residual”.

## 5. Ringkasan cakupan

| Prefix | Area | Kasus |
|---|---|---:|
| CFG | Konfigurasi, versi, dan validasi | 10 |
| PRC | Regular price dan markdown | 8 |
| ELG | Scope, qualification, dan batas penggunaan | 10 |
| MON | Benefit moneter dan alokasi diskon | 10 |
| COM | Best Price, Exclusive, dan Combine | 10 |
| BXY | Buy X Get Y dan unit quantity | 8 |
| PTS | Perolehan dan promotion points | 10 |
| LRD | Points ditukar menjadi voucher | 8 |
| CPN | Coupon dan scarce usage | 11 |
| VCH | Voucher, saldo ledger, dan otorisasi | 12 |
| TAX | Pajak, charges, dan definisi nilai | 10 |
| PAY | Checkout dan payment state machine | 14 |
| RET | Retur, unit identity, dan reversal | 10 |
| RFD | Refund allocation, percobaan, dan sisa kewajiban | 12 |
| OFF | Offline, sinkronisasi, dan kesetaraan Cloud/Store | 10 |
| CAM | Campaign measurement dan promotion analytics | 12 |
| DAT | Persistensi, immutability, dan audit | 9 |
| SEC | Akses dan command boundaries | 6 |
| PRP | Property tests dan perhitungan referensi | 8 |
| E2E | Perjalanan bisnis lengkap | 8 |
| OPS | Kinerja dan pemulihan operasional | 4 |
| **Total** | | **200** |

## 6. Matriks pengujian

Seluruh kasus di bawah berstatus awal NOT_RUN. Kolom Aturan merujuk D01–D14 di keputusan V1; tanda — berarti invariant/common contract yang sudah dijelaskan berlaku.

### CFG — Konfigurasi, versi, dan validasi

| ID | Prioritas | Level | Skenario / input | Hasil yang wajib terbukti | Aturan |
|---|---|---|---|---|---|
| CFG-001 | P0 | UNIT | Definisi promotion valid disimpan dan dibaca kembali | Seluruh scope, benefit, limits, compatibility, schedule, dan version tetap identik secara semantik. | — |
| CFG-002 | P0 | INT | Promotion yang sudah dipakai diedit menjadi versi baru | Snapshot sale lama dan promotion_version_id lama tetap utuh; sale baru memakai versi yang dipilih secara eksplisit. | — |
| CFG-003 | P0 | INT | Update cart/rule ketika pembayaran mulai diproses | Pricing revision dan amount yang diotorisasi tidak berubah diam-diam; perubahan memerlukan alur repricing/otorisasi baru. | — |
| CFG-004 | P0 | UNIT | Persentase di luar rentang, amount negatif, X/Y tidak sah, currency tidak cocok | Aktivasi ditolak dengan alasan field yang spesifik; tidak ada rule parsial yang aktif. | — |
| CFG-005 | P1 | UNIT | Dua promotion Combine dalam kelompok konflik punya prioritas sama | Aktivasi ditolak; hasil tidak bergantung pada urutan pembuatan atau query. | — |
| CFG-006 | P0 | INT | Coupon sudah consumed lalu versi promotion berubah | Penggunaan lama tetap berlaku sesuai lifetime limit; versi baru tidak membuat kode terpakai menjadi unused. | D04 |
| CFG-007 | P1 | INT | Jadwal mulai, tepat akhir, paused, ended, dan resumed | Hanya rule yang berlaku pada waktu dan status tersebut masuk evaluasi; batas waktu mengikuti kontrak. | D09 |
| CFG-008 | P0 | INT | Payload rule rusak, versi format tidak didukung, atau paket hanya setengah terkirim | Tidak diaktifkan sebagian; konfigurasi aktif sebelumnya tetap utuh sesuai kebijakan validitas offline. | D07 |
| CFG-009 | P1 | UNIT | Template UI menghasilkan rule canonical | Template percentage, amount, fixed price, basket, BXGY, dan points memetakan field dengan benar; evaluator memakai rule yang sama. | — |
| CFG-010 | P0 | INT | Edit promotion saat limit sudah sebagian terpakai | Counter tidak ter-reset tanpa keputusan eksplisit; authority menghitung consumption dan reservations dengan identitas limit yang benar. | D04 |

### PRC — Regular price dan markdown

| ID | Prioritas | Level | Skenario / input | Hasil yang wajib terbukti | Aturan |
|---|---|---|---|---|---|
| PRC-001 | P0 | UNIT | SKU memiliki satu regular price yang valid | Harga awal memakai price entry yang benar untuk SKU, toko, currency, dan waktu. | — |
| PRC-002 | P0 | UNIT | Markdown aktif, belum mulai, dan sudah berakhir | Markdown menggantikan harga regular hanya saat aktif; setelah berakhir harga kembali melalui resolver. | — |
| PRC-003 | P0 | UNIT | Promotion mengecualikan markdown item | Item markdown tidak mendapat benefit dan tidak masuk eligible spend promotion itu. | — |
| PRC-004 | P0 | UNIT | Promotion mengizinkan markdown item | Persentase dihitung dari markdown/current price yang relevan, bukan regular price. | — |
| PRC-005 | P0 | UNIT | Dua price entry atau markdown bertumpang tindih | Resolver mengikuti precedence yang disepakati atau menolak konfigurasi; tidak memakai first row secara kebetulan. | D08 |
| PRC-006 | P0 | UNIT | Tidak ada harga sah atau currency berbeda | Evaluasi gagal secara eksplisit; tidak membuat harga nol atau mengambil harga dari toko lain. | — |
| PRC-007 | P1 | UNIT | Article sama memiliki beberapa SKU/variant | Harga, quantity, dan scope SKU/Article tidak tertukar. | — |
| PRC-008 | P0 | PROP | Line qty 3 dibanding tiga line identik dengan unit ID tetap | Hasil moneter total, eligibility, dan unit allocation identik setelah normalisasi. | — |

### ELG — Scope, qualification, dan batas penggunaan

| ID | Prioritas | Level | Skenario / input | Hasil yang wajib terbukti | Aturan |
|---|---|---|---|---|---|
| ELG-001 | P0 | UNIT | All merchandise, Division, Article, multiple articles, dan Tags | Hanya unit yang memenuhi selector mendapat benefit; unit di luar scope tidak ikut menerima alokasi. | — |
| ELG-002 | P0 | UNIT | Member dan coupon sama-sama diwajibkan | Kedua syarat harus terpenuhi; satu syarat saja tidak meloloskan promotion. | — |
| ELG-003 | P0 | UNIT | Minimum spend tepat di bawah, sama dengan, dan di atas threshold | Batas >= diterapkan pada basis spend yang disepakati; gunakan selisih Rp1. | D05 |
| ELG-004 | P0 | UNIT | Minimum spend setelah line discount | Line discount dapat membuat threshold gagal; voucher/cash/card tidak mengubah qualification. | — |
| ELG-005 | P0 | UNIT | Satu basket berisi eligible dan ineligible merchandise | Threshold dan discount allocation menggunakan eligible amount; bagian ineligible tidak ikut menambah nilai. | — |
| ELG-006 | P0 | UNIT | Minimum quantity di bawah, tepat, dan di atas batas | Hanya eligible units dihitung; qty nol/negatif ditolak sebelum promotion. | — |
| ELG-007 | P1 | UNIT | Promotion dibatasi toko dan jadwal | Store lain dan waktu di luar jadwal tidak eligible; timezone eksplisit. | D09 |
| ELG-008 | P0 | RACE | Limit tersisa satu diperebutkan dua checkout dengan key berbeda | Paling banyak satu reservasi/consumption berhasil; yang kalah menerima hasil yang dapat dijelaskan. | D04 |
| ELG-009 | P0 | INT | Max uses per customer melalui dua toko/register | Limit diterapkan pada identitas customer global; perubahan perangkat tidak mereset penggunaan. | — |
| ELG-010 | P1 | UNIT | Max discount, max quantity, dan max benefit per transaction bertemu | Cap diterapkan pada basis dan urutan yang disepakati; total benefit tidak melewati cap. | D10 |

### MON — Benefit moneter dan alokasi diskon

| ID | Prioritas | Level | Skenario / input | Hasil yang wajib terbukti | Aturan |
|---|---|---|---|---|---|
| MON-001 | P0 | UNIT | 20% off Rp300.000 | Discount Rp60.000 dan remaining Rp240.000; trace menjelaskan basis dan benefit. | — |
| MON-002 | P0 | UNIT | Rp25.000 off each untuk qty 3 | Total diskon Rp75.000 jika setiap unit mencukupi; tidak disalahartikan sebagai sekali per basket. | — |
| MON-003 | P0 | UNIT | Rp50.000 off basket dengan beberapa eligible units | Diskon total Rp50.000, bukan Rp50.000 per unit; alokasi kembali ke unit. | — |
| MON-004 | P0 | UNIT | Fixed price lebih rendah, sama, dan lebih tinggi dari current price | Discount = max(0, current - fixed); promotion tidak menaikkan harga. | — |
| MON-005 | P0 | UNIT | Amount off melebihi harga tersisa | Diskon dibatasi nilai eligible yang tersisa; tidak ada negative merchandise amount. | — |
| MON-006 | P0 | UNIT | Percentage off dengan maximum discount | Nilai minimum antara hasil persentase dan cap dipakai pada scope cap yang disepakati. | D10 |
| MON-007 | P0 | UNIT | Basket percentage ke units dengan nilai berbeda | Total diskon dihitung pada basis yang disepakati lalu dialokasikan; jumlah alokasi tepat sama dengan discount application. | D05 |
| MON-008 | P0 | PROP | Alokasi menghasilkan pecahan rupiah dan nilai eligible nol | Pembulatan deterministik; sum allocation tepat, setiap unit non-negatif dan tidak melebihi basis; tidak divide by zero. | D11 |
| MON-009 | P0 | INT | Persist lalu reload promotion applications dan allocations | Hasil unit, line, dan header dapat direkonsiliasi; rejected application tidak menambah discount spend. | — |
| MON-010 | P1 | UNIT | Diskon nol karena fixed price/cap/basis nol | Harga tidak berubah; pemakaian coupon/usage untuk benefit nol mengikuti keputusan eksplisit. | D10 |

### COM — Best Price, Exclusive, dan Combine

| ID | Prioritas | Level | Skenario / input | Hasil yang wajib terbukti | Aturan |
|---|---|---|---|---|---|
| COM-001 | P0 | UNIT | Harga Rp600.000; item 20% vs basket Rp150.000 minimum Rp500.000 | Pilih basket-only Rp450.000; item-only Rp480.000 dan no-promo Rp600.000 kalah. | — |
| COM-002 | P0 | UNIT | Alternatif no-promo, satu promo, dan beberapa promo | Semua kandidat yang dibandingkan sah; pemenang adalah final merchandise amount terkecil dalam ruang rule V1 yang didukung. | — |
| COM-003 | P0 | UNIT | Rp300.000: 20% lalu Rp50.000 dibanding urutan terbalik | Hasil Rp190.000 dan Rp200.000; basis Combine mengikuti remaining price. | — |
| COM-004 | P0 | UNIT | Beberapa Exclusive sama-sama eligible | Setiap alternatif dinilai sesuai scope Line/Basket; winner dan tie-break priority lalu stable ID dapat direproduksi. | — |
| COM-005 | P0 | UNIT | Exclusive Line mengenai satu unit dari basket | Blokir tepat interaksi yang dilarang; unit lain mengikuti compatibility contract. | D03 |
| COM-006 | P0 | UNIT | Exclusive Basket bertemu line, basket, dan points promotions | Monetary outcomes mengikuti exclusion basket; points tetap mengikuti compatibility tersendiri. | D03 |
| COM-007 | P0 | UNIT | Dua basket promotions digabung dan keduanya punya minimum spend | Qualification dan basis benefit mengikuti kebijakan yang disepakati; tidak tergantung urutan query. | D03 |
| COM-008 | P0 | PROP | Input rule dipermutasi dengan ID/prioritas sama | Winner, nilai, allocation, dan rejection reasons tetap identik. | — |
| COM-009 | P0 | PROP | Cart kecil dibanding evaluator referensi exhaustive | Hasil Best Price sama dengan seluruh outcome valid yang dihitung independen; bukan membandingkan engine dengan dirinya sendiri. | — |
| COM-010 | P0 | INT | Pencarian Best Price mencapai batas resource | Tidak diam-diam memakai greedy lalu mengklaim best price; hasil timeout/error/fallback mengikuti kontrak yang disepakati. | D13 |

### BXY — Buy X Get Y dan unit quantity

| ID | Prioritas | Level | Skenario / input | Hasil yang wajib terbukti | Aturan |
|---|---|---|---|---|---|
| BXY-001 | P0 | UNIT | Buy 2 Get 1 dengan qty 2, 3, 5, dan 6 | Reward count berturut-turut 0, 1, 1, 2; unit yang sama tidak dipakai dua kali oleh promotion yang sama. | — |
| BXY-002 | P0 | UNIT | Buy 1 Get 1: 300k, 280k, 250k, 220k, 180k, 150k | Reward units bernilai 220k, 180k, 150k; total diskon Rp550.000 untuk benefit 100%. | — |
| BXY-003 | P0 | UNIT | Buy 2 Get 1 dengan empat unit dan satu leftover | Reward termurah benar; unit peserta, leftover, dan distribution discount persis mengikuti kebijakan. | D01 |
| BXY-004 | P0 | UNIT | Harga reward sama pada beberapa unit | Pemilihan menggunakan stable unit ID/order; tidak berubah setelah reload atau retry. | — |
| BXY-005 | P0 | UNIT | Eligible merchandise bercampur scope lain dan markdown excluded | Unit di luar scope tidak memenuhi X/Y dan tidak mendapat allocated bundle discount. | — |
| BXY-006 | P0 | INT | Same SKU qty 3 kemudian retur satu unit | Refund dan points reversal memakai snapshot unit yang dipilih, bukan pembagian ulang 1/3 pada hari retur. | — |
| BXY-007 | P0 | UNIT | BXGY bertemu line/basket promotion | Unit reuse lintas promotion dan harga reward mengikuti compatibility/order yang eksplisit. | D03 |
| BXY-008 | P0 | INT | Retur barang berbayar sambil mempertahankan reward | Refund memakai allocated original unit net; tidak mengembalikan gross paid items penuh sambil menyisakan reward bernilai nol secara keliru. | D01 |

### PTS — Perolehan dan promotion points

| ID | Prioritas | Level | Skenario / input | Hasil yang wajib terbukti | Aturan |
|---|---|---|---|---|---|
| PTS-001 | P0 | UNIT | Base points pada nilai merchandise ex-tax Rp538.200 dengan rate 1/1.000 | Base points 538; pajak, charges, dan tender tidak masuk basis. | D02 |
| PTS-002 | P0 | UNIT | 2x dan 3x pada unit yang sama, ditambah fixed bonus 500 yang eligible | Multiplier tertinggi dipilih; base 400 menjadi 1.200 lalu +500 = 1.700. | D02 |
| PTS-003 | P0 | UNIT | Shirt 2x dan Shoes 3x dengan scope terpisah | Setiap unit memakai multiplier tertinggi yang eligible untuknya; 3x tidak menyebar ke Shirt. | D02 |
| PTS-004 | P0 | UNIT | Fixed bonus once-per-transaction dibanding per-unit | Jumlah bonus sesuai basis; bonus tetap tidak ikut dikalikan multiplier. | D02 |
| PTS-005 | P0 | UNIT | Beberapa fixed bonuses BestBonus dan Combine | Pilih maksimum antara tiap bonus eksklusif dan total kelompok Combine; tie-break stabil; tidak double award. | D02 |
| PTS-006 | P0 | UNIT | Points promotion tidak boleh combine dengan monetary discounts | Unit yang menerima monetary promotion dikeluarkan dari eligibility points promotion tersebut; base points reguler tetap mengikuti scheme. | D02 |
| PTS-007 | P0 | PROP | Base points dan fixed bonus perlu alokasi ke beberapa unit | Largest remainder dan stable unit order menghasilkan total tepat; sumber base/multiplier/fixed bonus tetap dapat ditelusuri. | D02 |
| PTS-008 | P0 | INT | Sale belum completed, gagal, atau void sebelum pembayaran selesai | Tidak ada available EARN; kalkulasi preview tidak mengubah saldo. | — |
| PTS-009 | P0 | INT | Sale completed menerima retry dan event EARN duplikat | Available points bertambah tepat sekali dengan referensi sale yang unik. | — |
| PTS-010 | P0 | INT | Retur setelah points sudah ditukar | Reverse original awarded points; saldo boleh negatif; earning berikutnya tetap masuk dan redemption memerlukan saldo mencukupi. | — |

### LRD — Points ditukar menjadi voucher

| ID | Prioritas | Level | Skenario / input | Hasil yang wajib terbukti | Aturan |
|---|---|---|---|---|---|
| LRD-001 | P0 | INT | Saldo 2.400 ditukar 2.000 points menjadi voucher Rp100.000 | Saldo 400; tepat satu redemption completed, satu voucher, satu ISSUE ledger, satu debit points. | — |
| LRD-002 | P0 | INT | Saldo kurang, negatif, atau request amount tidak valid | Ditolak tanpa perubahan saldo dan tanpa penerbitan voucher. | — |
| LRD-003 | P0 | FAULT | Gagal setelah debit points tetapi sebelum ISSUE voucher | Satu transaksi database rollback sepenuhnya; tidak ada redemption setengah berhasil. | — |
| LRD-004 | P0 | FAULT | Commit berhasil tetapi respons hilang | Retry key/payload sama mengembalikan voucher yang sama; tidak ada debit/issue kedua. | — |
| LRD-005 | P0 | RACE | Dua penukaran berbeda bersamaan dengan saldo hanya cukup satu | Hanya satu berhasil; saldo tidak negatif akibat redemption; negatif hanya boleh berasal dari operasi yang diizinkan. | — |
| LRD-006 | P0 | RACE | Dua request bersamaan dengan idempotency key sama | Satu logical redemption dan satu hasil; kedua respons konsisten setelah hasil tersedia. | — |
| LRD-007 | P0 | INT | Key sama dikirim dengan customer atau jumlah berbeda | Ditolak sebagai konflik payload; tidak mengganti redemption lama. | — |
| LRD-008 | P0 | INT | Penukaran dilakukan saat offline atau oleh user tanpa akses account | Ditolak; local cache tidak dipakai sebagai authority untuk mengurangi saldo. | D07 |

### CPN — Coupon dan scarce usage

| ID | Prioritas | Level | Skenario / input | Hasil yang wajib terbukti | Aturan |
|---|---|---|---|---|---|
| CPN-001 | P0 | UNIT | Shared unlimited coupon benar, salah, expired, dan promotion inactive | Hanya kode valid yang membuka promotion; kode tidak memberi benefit sendiri. | — |
| CPN-002 | P0 | INT | Unique coupon UNUSED → RESERVED → CONSUMED | Tiap transisi memiliki sale/authorization owner; hanya completion yang sah mengonsumsi kode. | — |
| CPN-003 | P0 | RACE | Unique code dipakai dua kasir bersamaan | Hanya satu checkout memperoleh reservation aktif; yang lain tidak ikut memperoleh diskon terjamin. | — |
| CPN-004 | P0 | FAULT | Checkout batal sebelum payment attempt dimulai | Reservation dilepas tepat sekali; usage tidak consumed. | — |
| CPN-005 | P0 | FAULT | Reservation mencapai expiry saat pembayaran hasilnya belum diketahui | Tidak otomatis tersedia bagi checkout lain; masuk rekonsiliasi hingga status pembayaran pasti. | — |
| CPN-006 | P0 | INT | Completed sale kemudian partial/full return | Unique code tetap consumed; shared code tetap aktif dan usage record transaksi tidak dihapus. | — |
| CPN-007 | P0 | INT | Versi promotion berubah saat kode masih unused atau reserved | Unused memakai rule baru saat quote berikut; in-flight quote tetap pinned; consumed tidak reset. | D04 |
| CPN-008 | P0 | RACE | Shared code dengan global/per-customer limit tersisa satu | Reservation dan consumption dihitung bersama; paling banyak satu checkout tambahan lolos. | D04 |
| CPN-009 | P0 | INT | Coupon valid tetapi promotion kalah Best Price atau benefit nol | Tidak mengonsumsi usage; reservasi spekulatif dilepas sebelum finalisasi jika pernah dibuat. | D10 |
| CPN-010 | P0 | INT | Kode sama beda kapital/whitespace; duplicate canonical code saat issue | Normalisasi kontrak konsisten; collision ditolak; tenant lain tidak dapat menebak/menggunakan saldo atau coupon secara lintas tenant. | D04 |
| CPN-011 | P0 | RACE | Otorisasi lama datang setelah reservation sah dilepas dan kode diotorisasi ulang | Token/generation lama tidak dapat commit reservation baru milik checkout lain; tidak ada dua completed uses. | — |

### VCH — Voucher, saldo ledger, dan otorisasi

| ID | Prioritas | Level | Skenario / input | Hasil yang wajib terbukti | Aturan |
|---|---|---|---|---|---|
| VCH-001 | P0 | INT | Issue voucher dan beberapa redemption parsial | Saldo ledger = current balance; jumlah penggunaan tidak melebihi issued + restorations. | — |
| VCH-002 | P0 | INT | Voucher balance 100k dengan active hold 60k | Saldo tersedia 40k; request 50k ditolak meskipun ledger balance masih 100k. | — |
| VCH-003 | P0 | RACE | Dua otorisasi key berbeda masing-masing 100k pada saldo 100k | Paling banyak satu hold berhasil; reserve check dan mutation tidak dapat berlomba. | — |
| VCH-004 | P0 | INT | Commit authorization yang sah | Hold menjadi COMMITTED dan ledger REDEEM tercatat satu kali secara konsisten; tidak terjadi debit dan hold ganda. | — |
| VCH-005 | P0 | FAULT | Cancel atau retry release sebelum payment attempt | Saldo tersedia pulih tepat sekali; release yang diulang tidak menambah ledger balance. | — |
| VCH-006 | P0 | INT | Authorization untuk sale/customer/currency lain dicoba dipakai | Ditolak; token tidak dapat dialihkan ke transaksi yang tidak berhak. | — |
| VCH-007 | P0 | INT | Voucher expired, cancelled, atau saldo nol digunakan untuk pembelian | Tidak dapat membuat otorisasi baru; pesan menyatakan alasan. | D06 |
| VCH-008 | P0 | INT | Retur ke voucher aktif | RESTORE mencantumkan refund_tender yang benar; retry tidak restore dua kali. | D06 |
| VCH-009 | P0 | INT | Retur ke voucher yang sudah expired | Terbit satu replacement sesuai D06; original tidak sekaligus dikreditkan; allocation tetap menunjuk tender asal. | D06 |
| VCH-010 | P0 | INT | Retur ke voucher cancelled | Refund memerlukan penanganan berwenang; tidak otomatis membuka kembali voucher cancelled. | D06 |
| VCH-011 | P0 | FAULT | Hold expired lalu request commit lama muncul terlambat | Tidak dapat membukukan hold yang telah sah dilepas/diganti; transaksi masuk recovery jika pembayaran eksternal terlanjur terjadi. | — |
| VCH-012 | P0 | PROP | Replay ISSUE/REDEEM/RESTORE dan pembacaan balance setelah restart | Ledger/source references tetap unik; current balance dapat direkonstruksi; tidak ada saldo tersedia negatif. | — |

### TAX — Pajak, charges, dan definisi nilai

| ID | Prioritas | Level | Skenario / input | Hasil yang wajib terbukti | Aturan |
|---|---|---|---|---|---|
| TAX-001 | P0 | UNIT | Tax-inclusive 110k pada fixture pajak hipotetis 10% | Net ex-tax 100k, tax 10k, due 110k; pajak tidak ditambahkan dua kali. | D05 |
| TAX-002 | P0 | UNIT | Tax-exclusive 100k pada fixture 10% | Displayed amount 110k; snapshot akhir sama dengan kasus inclusive ekuivalen. | D05 |
| TAX-003 | P0 | UNIT | 10% discount pada displayed 110k dengan fixture 10% tax | Displayed final 99k; net 90k, tax 9k; amount-off dan threshold mengikuti basis gross customer-facing. | D05 |
| TAX-004 | P0 | UNIT | Minimum basket 500k dengan campuran taxable/exempt units | Qualification memakai eligible value termasuk pajak setelah line promotions; bukan Net Sales dashboard. | D05 |
| TAX-005 | P0 | UNIT | Voucher membayar seluruh/sebagian Amount Due | Net sales dan tax tidak berubah akibat pilihan tender. | — |
| TAX-006 | P0 | UNIT | Tarif/treatment berbeda pada unit dalam basket | Setiap unit memakai tax treatment snapshot; alokasi diskon dan tax delta terjaga tanpa memakai satu tarif basket paksa. | D05 |
| TAX-007 | P0 | UNIT | Harga kecil menimbulkan pecahan tax dan discount | Fixture rounding eksplisit; net + tax = total dan gross discount = net discount + tax delta. | D11 |
| TAX-008 | P0 | INT | Retur setelah tax configuration berubah | Reverse net/tax/charges dari snapshot asli; tidak memakai tarif hari retur. | — |
| TAX-009 | P0 | INT | Charges refundable dialokasikan ke unit lalu partial/full return | Refund unit mencakup charges share dan tax share asal; full return mengembalikan seluruh refundable charges tepat sekali. | D12 |
| TAX-010 | P0 | UNIT | Golden cart lama sekarang memakai earning basis ex-tax | Fixture zero-tax menghasilkan 1.076 points; fixture 10% menghasilkan 978; jangan memakai satu expected points untuk keduanya. | D02,D05,D11 |

### PAY — Checkout dan payment state machine

| ID | Prioritas | Level | Skenario / input | Hasil yang wajib terbukti | Aturan |
|---|---|---|---|---|---|
| PAY-001 | P0 | E2E | Exact cash, exact card, voucher+card, dan voucher+card+cash | Jumlah tender applied = Amount Due; completion hanya setelah seluruh payment obligations terpenuhi. | — |
| PAY-002 | P0 | INT | Cash handed lebih besar daripada Amount Due | Change dicatat terpisah; sale_tender hanya jumlah yang applied; refund tidak mencakup uang kembalian. | D12 |
| PAY-003 | P0 | INT | Amount Due nol setelah diskon 100% | Sale dapat completed tanpa tender nol palsu; base points nol; coupon positive benefit mengikuti usage policy. | D12 |
| PAY-004 | P0 | INT | Tender kurang atau lebih dari due tanpa cash-change handling | Tidak completed; tidak menyembunyikan selisih sebagai discount atau saldo voucher. | — |
| PAY-005 | P0 | FAULT | Payment provider berhasil, respons diterima, proses mati sebelum finalisasi | Recovery memakai payment result tersimpan; tidak menagih lagi; snapshot/ledger selesai satu kali. | — |
| PAY-006 | P0 | FAULT | Provider mungkin berhasil tetapi respons timeout sebelum tersimpan | Status UNKNOWN/RECONCILING; recover dengan provider reference/idempotency yang sama; jangan langsung retry sebagai payment baru. | — |
| PAY-007 | P0 | FAULT | Local payment intent tersimpan lalu proses mati sebelum request provider | Recovery melanjutkan intent yang sama; tidak menghasilkan operasi provider kedua. | — |
| PAY-008 | P0 | FAULT | Sebagian tender berhasil, tender lain definitively gagal | Checkout tidak completed; retry hanya komponen yang belum berhasil atau jalankan kompensasi yang tercatat. | — |
| PAY-009 | P0 | INT | Webhook duplikat, terlambat, atau urutannya terbalik | Status tidak mundur karena event lama; business effects dan external payment reference tetap unik. | — |
| PAY-010 | P0 | INT | Client mengubah cart/amount saat PAYMENT_IN_PROGRESS | Perubahan ditolak atau melalui cancel/reprice flow yang sah; authorization tetap terikat pricing revision. | — |
| PAY-011 | P0 | INT | Client meminta CANCELLED ketika provider payment sedang unknown | Tidak melepaskan seluruh hold atau mengklaim batal sampai rekonsiliasi selesai. | — |
| PAY-012 | P0 | INT | Checkout selesai diulang dengan key sama/payload berbeda | Key sama+payload sama mengembalikan sale asli; payload berbeda konflik; no double sale/charge/points. | — |
| PAY-013 | P0 | INT | Semua payment sukses tetapi finalisasi database sempat gagal | Dapat dipulihkan dari durable intents/results; tidak ada completed sale tanpa snapshot dan ledger yang diperlukan. | — |
| PAY-014 | P1 | INT | Admin recovery atas payment unresolved | Aksi dibatasi izin dan diaudit; tidak dapat menandai payment success tanpa bukti yang disyaratkan. | — |

### RET — Retur, unit identity, dan reversal

| ID | Prioritas | Level | Skenario / input | Hasil yang wajib terbukti | Aturan |
|---|---|---|---|---|---|
| RET-001 | P0 | E2E | Retur Shoes pada golden cart G01 | Refund Rp319.333; voucher Rp59.334; card Rp259.999; points reversal 638. | — |
| RET-002 | P0 | E2E | Retur Shirt setelah Shoes pada G01 | Refund Rp218.867; voucher Rp40.666; card Rp178.201; points reversal 438; seluruh sale habis diretur. | — |
| RET-003 | P0 | INT | Retur membatalkan eligibility threshold basket awal | Tidak requalify atau clawback discount unit yang dipertahankan; gunakan original allocations. | — |
| RET-004 | P0 | INT | Current promotion, harga, scheme points, dan tax sudah berubah | Refund dan reversal tetap identik dengan original unit snapshot. | — |
| RET-005 | P0 | RACE | Dua return IDs berbeda untuk sale_unit yang sama | Hanya satu return accepted; idempotency key berbeda tidak mengizinkan double return. | — |
| RET-006 | P0 | INT | Return REQUESTED ditolak lalu customer mengajukan kembali | Penolakan tidak menghabiskan hak retur unit; tidak ada refund atau points reversal dari permintaan yang ditolak. | — |
| RET-007 | P0 | INT | Satu line qty 3, retur unit kedua lalu unit pertama | Masing-masing memakai allocation miliknya; original unit instance/order tidak hilang setelah reload. | — |
| RET-008 | P0 | INT | Unit bukan milik original sale atau sudah diretur | Ditolak sebelum refund allocation dibuat; foreign reference tidak dapat memindahkan hak refund. | — |
| RET-009 | P0 | INT | Accepted return tetapi refund kartu masih pending | Barang/points/analytics mengikuti accepted return; status refund terpisah dan tidak menyatakan seluruh uang sudah kembali. | D14 |
| RET-010 | P0 | FAULT | Retry AcceptReturn setelah respons hilang | Return, returned units, points reversals, dan refund instructions hanya dibuat sekali. | — |

### RFD — Refund allocation, percobaan, dan sisa kewajiban

| ID | Prioritas | Level | Skenario / input | Hasil yang wajib terbukti | Aturan |
|---|---|---|---|---|---|
| RFD-001 | P0 | UNIT | Refund 200k dari original voucher100k + card400k | Alokasi 40k voucher dan 160k card. | — |
| RFD-002 | P0 | UNIT | Empat tender berbobot 26/26/26/22%, refund Rp2 | Largest remainder memberi [1,1,0,0] pada stable tender order; tidak ada alokasi negatif. | D11 |
| RFD-003 | P0 | PROP | Refund bertahap pada 3–4 tender dengan jumlah kecil | Setiap allocation non-negatif, total tepat, cumulative hanya naik, dan setiap tender tidak melebihi original. | D11 |
| RFD-004 | P0 | INT | Refund pertama pending saat refund kedua dibuat | Sisa kapasitas mengurangi seluruh allocation terbuka; bagian pending tidak dapat dijanjikan kembali. | — |
| RFD-005 | P0 | RACE | Dua refund sah dari unit berbeda dibuat bersamaan | Lock/serialisasi per sale menjamin allocation memakai sisa terbaru; total committed+open allocations <= original per tender. | — |
| RFD-006 | P0 | INT | Voucher restore sukses, card pending lalu failed | Overall menunjukkan partial success/failure; retry kartu tidak restore voucher lagi. | — |
| RFD-007 | P0 | FAULT | Card refund mungkin sukses tetapi respons timeout | Status belum diketahui direkonsiliasi; tidak membuat refund provider baru sebelum hasil pasti. | — |
| RFD-008 | P0 | INT | Retry setelah card definitive failure | Logical allocation tetap sama; attempt baru tercatat tanpa mengubah hak refund dan tanpa mengulang tender sukses. | — |
| RFD-009 | P0 | INT | Provider callbacks duplicate, out-of-order, atau late failure yang benar-benar baru | Event lama tidak menimpa hasil baru; genuine late failure masuk rekonsiliasi dengan audit dan obligation yang tetap terlacak, tanpa mengulang tender lain yang sukses. | — |
| RFD-010 | P0 | INT | Refund attempt failed tetapi masih akan dipulihkan | Allocation tetap menahan kapasitas; operator tidak dapat membuat refund kedua untuk kewajiban yang sama. | — |
| RFD-011 | P0 | PROP | Semua units dan allocated charges sudah diretur | Total seluruh refund sama dengan original paid tender amounts; tidak ada sisa rupiah. | D12 |
| RFD-012 | P1 | PROP | Unit yang sama diretur dalam urutan pengelompokan berbeda | Total refund per unit tetap; intermediate tender shares boleh beda Rp1 karena remaining-balance policy; full refund totals tetap sama. | D11 |

### OFF — Offline, sinkronisasi, dan kesetaraan Cloud/Store

| ID | Prioritas | Level | Skenario / input | Hasil yang wajib terbukti | Aturan |
|---|---|---|---|---|---|
| OFF-001 | P0 | E2E | Offline cash sale menggunakan snapshot yang sah | Regular/markdown/unconstrained promotions berjalan; sale dan trace tersimpan durable sebelum UI sukses. | D07 |
| OFF-002 | P0 | INT | Offline voucher, points redemption, unique/limited coupon, card, atau return | Operasi online-only V1 tidak dijalankan; tidak ada mutation lokal yang dianggap otorisasi pusat. | D07 |
| OFF-003 | P0 | INT | Offline sale points dihitung sebagai pending | Tidak tersedia untuk redemption sebelum cloud menerima sale dan mem-post EARN sekali. | — |
| OFF-004 | P0 | FAULT | Offline sale dikirim ulang setelah timeout atau restart | Cloud menerima satu sale dengan ID stabil; tender, coupon usage, points, dan analytics tidak ganda. | — |
| OFF-005 | P0 | INT | Config berubah di cloud sebelum offline sale tersinkron | Cloud memvalidasi versi/waktu asal yang sah; tidak reprice history menggunakan current_version_id. | D07 |
| OFF-006 | P0 | FAULT | Store crash sebelum/sesudah local completion commit | Sebelum commit tidak tampil sebagai completed; sesudah commit dapat dipulihkan dan disinkronkan. | — |
| OFF-007 | P0 | INT | Snapshot expired, signature/digest salah jika digunakan, atau catalog dependency tidak cocok | Tidak melakukan partial activation atau menilai harga dari campuran versi; minta sinkronisasi/valid snapshot. | D07 |
| OFF-008 | P0 | PROP | Input canonical identik di shared engine, Postgres-backed path, dan SQLite-backed path | Nilai, winner, allocations, version references, dan canonical trace identik; adapter tidak menghitung ulang differently. | — |
| OFF-009 | P0 | INT | Event sale/return datang terlambat atau dependency belum tersedia | Dependency dipulihkan sebelum projection; tidak double reverse atau mem-post saldo sementara tanpa dasar. | — |
| OFF-010 | P1 | INT | Offline member-only promotion tanpa bukti membership valid yang tercache | Promotion tersebut tidak diloloskan berdasarkan asumsi; public rules tetap dapat dipakai. | D07 |

### CAM — Campaign measurement dan promotion analytics

| ID | Prioritas | Level | Skenario / input | Hasil yang wajib terbukti | Aturan |
|---|---|---|---|---|---|
| CAM-001 | P0 | UNIT | Dua promotions menyentuh unit yang sama | Campaign Net Sales menghitung unit sekali; masing-masing promotion attribution dapat overlap. | — |
| CAM-002 | P0 | UNIT | Campaign scope mencakup hanya satu kategori dalam mixed receipt | Hanya net ex-tax lines kategori itu masuk sales; Baskets menghitung distinct receipt sekali. | — |
| CAM-003 | P0 | UNIT | Units, identified customers, baskets, dan scoped ABV | Formula memakai denominator yang didefinisikan; guest tidak dihitung sebagai satu customer bersama; empty denominator menjadi N/A. | D14 |
| CAM-004 | P0 | INT | Accepted return setelah akhir periode campaign | Sale-date campaign view direstate berdasarkan origin; return activity juga terlihat pada actual return date; tidak mengurangi dua kali. | D14 |
| CAM-005 | P0 | INT | Return accepted tetapi provider refund masih pending/failed | Net merchandise performance sudah dikoreksi; refund payment status dilaporkan terpisah. | D14 |
| CAM-006 | P0 | UNIT | Markdown reduction, promotion discount, tax, voucher, dan points | Discount Budget memakai monetary promotion discount ex-tax net of accepted returns; customer Discount Given incl-tax ditampilkan sebagai metrik terpisah; markdown/tender/points tidak tercampur. | D14 |
| CAM-007 | P0 | E2E | Campaign Discount Budget mencapai/melebihi limit | Warning muncul; checkout tetap dapat selesai; tidak ada hard budget stop V1. | — |
| CAM-008 | P1 | UNIT | Actual 74% target, 86% waktu berlalu, tanpa planned curve | Tidak menghasilkan Ahead/Behind; tampilkan actual, target, time left, guardrails. | — |
| CAM-009 | P1 | UNIT | Planned-to-date tersedia atau baseline comparison tersedia | Behind/Ahead hanya terhadap plan; baseline change tidak dilabeli causal lift. | — |
| CAM-010 | P0 | INT | Campaign activity atau product tag/scope berubah setelah sale | Historical membership/attribution mengikuti frozen campaign scope version; tidak berubah karena current catalog atau current activity join. | D14 |
| CAM-011 | P1 | UNIT | Gross profit, margin, dan sell-through tanpa cost/stock baseline valid | Tampilkan N/A/unknown; tidak menganggap cost nol atau menciptakan stock base; denominator dan cost snapshot dapat diaudit. | D14 |
| CAM-012 | P0 | INT | Projection event sale/return diputar ulang atau dibangun ulang | Net/gross totals identik dari execution facts; tidak menjumlahkan child Promo Sales sebagai Campaign Sales. | — |

### DAT — Persistensi, immutability, dan audit

| ID | Prioritas | Level | Skenario / input | Hasil yang wajib terbukti | Aturan |
|---|---|---|---|---|---|
| DAT-001 | P0 | INT | Completed sale snapshot atau used promotion version dicoba diubah | Mutation ilegal ditolak; koreksi melalui version/reversal yang tercatat. | — |
| DAT-002 | P0 | INT | Points/voucher current balance sengaja dibandingkan dengan ledger sum | Rekonsiliasi mendeteksi mismatch; repair projection tidak membuat money movement baru. | — |
| DAT-003 | P0 | INT | Input money sangat besar, quantity besar, atau pecahan tidak sah | Overflow/precision loss ditolak; tidak menggunakan floating point untuk accounting values. | D11 |
| DAT-004 | P0 | INT | Sale header dibanding total lines/units/tenders | Rekonsiliasi net+tax+charges=due; sum unit allocations=application; sum applied tenders=due untuk completed sale. | — |
| DAT-005 | P0 | INT | Key idempotency sama dalam scope command yang sama, tetapi payload berbeda | Conflict tanpa mutation; key yang sama pada command type berbeda tetap namespace terpisah sesuai K06. | — |
| DAT-006 | P0 | FAULT | Event dispatch gagal setelah database commit | Outbox atau mekanisme recovery durable akhirnya memproses event satu kali secara bisnis; tidak mengandalkan proses memori. | — |
| DAT-007 | P0 | INT | Refund allocation, refund tender, attempts, dan voucher restoration di-join | Satu authority amount; duplikasi tabel tidak memberi dua hak refund; tiap attempt dan successful effect punya referensi unik. | — |
| DAT-008 | P0 | INT | Audit sale lama setelah data customer/catalog berubah | Harga, rule version, tax, source promotion, returned unit, dan payment references tetap dapat dijelaskan dari snapshot. | — |
| DAT-009 | P0 | INT | Constraint uniqueness, references, dan non-negative allocation pada Postgres/SQLite | Kedua adapter menolak data eksekusi yang melanggar invariant; schema/transaction setup tidak mengandalkan validasi UI. | — |

### SEC — Akses dan command boundaries

| ID | Prioritas | Level | Skenario / input | Hasil yang wajib terbukti | Aturan |
|---|---|---|---|---|---|
| SEC-001 | P0 | INT | Customer/store/tenant lain mengirim ID voucher, sale, return, atau redemption | Ditolak tanpa membocorkan data/saldo; identity dari client tidak menggantikan authority server. | — |
| SEC-002 | P0 | INT | Client mengirim discount, amount due, points, atau refund amount palsu | Server memakai calculation/snapshot authoritative; field uang dari client tidak dipercaya sebagai hasil. | — |
| SEC-003 | P0 | INT | Cashier mencoba issue/cancel/adjust voucher atau points tanpa izin | Command ditolak; operator berizin menghasilkan audit actor, reason, dan source yang dapat ditelusuri. | — |
| SEC-004 | P0 | INT | Webhook palsu atau provider event milik transaksi lain | Tidak mengubah payment/refund; verifikasi sumber dan reference dilakukan. | — |
| SEC-005 | P1 | INT | Log/error/debug trace memuat code voucher/coupon rahasia atau data kartu | Secret dimasking; trace tetap cukup untuk audit menggunakan IDs; tidak menyimpan credential pembayaran mentah. | — |
| SEC-006 | P0 | INT | EvaluateCart/Preview dijalankan berulang | Tidak mengonsumsi coupon/limits, mengurangi saldo, mengeluarkan points, atau membuat provider payment. | — |

### PRP — Property tests dan perhitungan referensi

| ID | Prioritas | Level | Skenario / input | Hasil yang wajib terbukti | Aturan |
|---|---|---|---|---|---|
| PRP-001 | P0 | PROP | Generate random carts, valid promotions, dan return sequences | Semua invariants INV-01 sampai INV-16 berlaku pada setiap langkah; failure menyimpan seed dan minimal repro. | — |
| PRP-002 | P0 | PROP | Random refund sizes sampai full refund pada 1–10 tenders | Largest remainder dengan remaining capacity tidak pernah melampaui capacity; total exactly conserved. | D11 |
| PRP-003 | P0 | PROP | Permutasi input unit/rule dengan stable IDs tetap | Canonical output tetap; perbedaan order transport tidak menjadi aturan bisnis. | — |
| PRP-004 | P0 | PROP | Split/merge sale line tanpa mengubah unit instances | Pricing, BXGY, points, dan refund tetap ekuivalen. | — |
| PRP-005 | P0 | PROP | Replay setiap command dan event 1–10 kali | Business result sama dengan sekali eksekusi; audit boleh mencatat attempt tambahan tanpa movement tambahan. | — |
| PRP-006 | P0 | PROP | Validasi Best Price dengan brute-force independent oracle untuk cart kecil | Winner sama dengan minimum valid total; termasuk kandidat yang sengaja melewati line promotion. | — |
| PRP-007 | P0 | PROP | Round-trip serialize Rust/JSON/SQLite/Postgres untuk canonical values | Tidak mengubah integer money, currency, unit IDs, rule versions, atau time boundaries. | — |
| PRP-008 | P1 | PROP | Sale lalu semua unit diretur dalam urutan acak | Net retained merchandise dan awarded net points nol untuk sale tersebut; coupons tetap sesuai policy; full monetary refund tepat. | — |

### E2E — Perjalanan bisnis lengkap

| ID | Prioritas | Level | Skenario / input | Hasil yang wajib terbukti | Aturan |
|---|---|---|---|---|---|
| E2E-001 | P0 | E2E | G01: regular + markdown + line + basket + coupon + 2x points + voucher/card → dua partial returns | Semua expected G01 cocok pada unit, sale, ledger, refund, coupon, dan campaign. | — |
| E2E-002 | P0 | E2E | G02: tax-inclusive dan tax-exclusive yang ekuivalen | Displayed amount dan canonical net/tax/points identik. | — |
| E2E-003 | P0 | E2E | G03: golden cart dengan fixture tax 10% → retur Shoes | Points 978, Shoes reversal 580; refund gross tetap seperti G01; retained net ex-tax Rp198.970. | D02,D05,D11 |
| E2E-004 | P0 | E2E | G04: BXGY dengan leftover → retur satu buyer lalu reward | Reward/participant selection dan net refund setiap unit sesuai G04; tidak requalify basket. | D01 |
| E2E-005 | P0 | E2E | Earn points → issue voucher → gunakan voucher → retur sale asal points | Voucher yang sudah issued tidak ditarik ulang; points boleh negatif dan redemption berikutnya dibatasi. | — |
| E2E-006 | P0 | E2E | Offline cash sale → restart → sync duplikat → online return | Sale/earn/reversal hanya sekali; historical pricing version tetap; available points direkonsiliasi. | D07 |
| E2E-007 | P0 | E2E | Payment unknown → terlambat sukses → finalization → refund unknown → sukses | Tidak ada double charge/refund, hold yang salah dilepas, atau completed status palsu. | — |
| E2E-008 | P0 | E2E | Coupon global last-use race pada dua toko; salah satu checkout batal | Satu otorisasi pada satu waktu; pembatalan sah mengembalikan kapasitas; completion mengonsumsi sekali. | — |

### OPS — Kinerja dan pemulihan operasional

| ID | Prioritas | Level | Skenario / input | Hasil yang wajib terbukti | Aturan |
|---|---|---|---|---|---|
| OPS-001 | P1 | PERF | Workload referensi 20 units, 10 eligible monetary promotions, 100 warm-up lalu 1.000 measured evaluations | Pada hardware target: engine-only p95 <=100ms, p99 <=250ms; nilai tetap cocok dengan oracle dan raw timings disimpan. | D13 |
| OPS-002 | P0 | FAULT | Worst-case kombinasi melewati deadline kalkulasi 2 detik | Checkout menerima error yang eksplisit sebelum tender dimulai; tidak memakai hasil parsial/greedy sebagai Best Price. | D13 |
| OPS-003 | P0 | FAULT | Worker/reconciliation process restart saat ada payment/refund unknown | Pekerjaan durable tetap ditemukan dan dipulihkan; tidak mengandalkan retry manual pelanggan. | — |
| OPS-004 | P1 | INT | Laporan rekonsiliasi harian sale/tender/refund/ledger/projection | Mendeteksi saldo/amount mismatch, orphan intents, expired holds unresolved, dan stuck operations dengan referensi tindakan. | — |

## 7. Jadwal eksekusi yang disarankan

1. Bekukan input/expected G01–G05 dan implementasikan pure reference assertions.
2. Jalankan PRC, ELG, MON, COM, BXY, PTS, TAX; cocokkan Best Price dengan independent exhaustive oracle pada cart kecil.
3. Jalankan DAT, LRD, CPN, VCH pada database nyata. RACE menggunakan minimal dua connections dan barrier; test sequential retry tidak cukup.
4. Jalankan PAY, RET, RFD dengan fault injection pada setiap boundary intent/provider/result/finalization.
5. Jalankan OFF dan Cloud/Store parity dengan paket/clock/versions yang sama, termasuk restart dan duplicate sync.
6. Jalankan CAM dan SEC terhadap execution records aktual; rebuild projections lalu bandingkan totals.
7. Jalankan E2E, property sequences, benchmark OPS, kemudian UAT layar dan receipt.

Urutan ini tidak mengharuskan UI selesai sebelum kernel diuji.

## 8. Checklist UAT untuk POS dan back office

Checklist manual ini melengkapi 200 test cases; tidak menggantikan ledger/database assertions.

- [ ] Receipt membedakan regular, markdown, promotion, net/tax, voucher sebagai pembayaran, dan remaining to pay.
- [ ] Same-SKU quantity return memilih unit/slice yang benar; staff dapat menjelaskan nilai refund allocated untuk BXGY.
- [ ] Offline UI hanya menawarkan capability V1 yang sah; points menampilkan Pending, bukan available.
- [ ] Cash handed, cash applied, dan change terbaca berbeda; refund tidak memasukkan change.
- [ ] Return accepted dapat tampil dengan card refund Pending/Failed; tombol retry tidak mengulang voucher restoration.
- [ ] Expired/cancelled voucher refund menampilkan replacement atau required operator action secara jelas.
- [ ] Campaign menampilkan Net Sales/Discount Budget ex-tax dan customer Discount Given incl-tax dengan label yang benar; tidak ada Ahead/Behind tanpa plan.
- [ ] Double-click, refresh, app restart, dan retry setelah error menampilkan transaksi yang sama tanpa memulai transaksi pembayaran baru.

## 9. Kriteria lulus sebelum rilis

- Semua P0 yang termasuk capability rilis PASS di build/schema/rule versions yang sama; tidak ada FAIL/BLOCKED/NOT_RUN yang disembunyikan.
- P1 yang termasuk scope rilis PASS; fitur yang ditunda dinyatakan di scope dan tidak dipresentasikan sebagai siap.
- Lima golden fixtures cocok sampai rupiah/points dan source IDs; tidak ada “toleransi” selisih uang sebagai pengganti rounding contract.
- RACE dan FAULT membuktikan invariants di storage dan provider simulator, bukan hanya kode respons.
- Ledger current balance dan analytics rebuild cocok dengan execution facts.
- Target OPS dipenuhi pada hardware/workload yang tercatat; tidak menyebut hasil laptop sebagai benchmark store tanpa keterangan.
- UAT receipt/status recovery selesai dan bukti hasil tersimpan.
- Test failures dapat direproduksi dengan seed, input snapshot, clock, command IDs, dan version evidence.

Passing suite memberikan bukti bahwa scope V1 memenuhi kontrak yang diuji; bukan janji tidak mungkin ada bug di luar kondisi pengujian.

## 10. Verifikasi yang sudah dilakukan saat menyusun dokumen

- Angka G01–G05 dihitung ulang menggunakan exact fractions/integer arithmetic.
- Reference algorithm remaining-balance + largest remainder lolos **10.000 urutan simulasi**, masing-masing sampai 8 tahap refund, dengan seed 20260912.
- Pemeriksaan tersebut hanya memverifikasi expected arithmetic/reference allocation. **Belum menjalankan engine, API, database, UI, atau provider adapter aplikasi.**
- Semua 200 production test cases tetap NOT_RUN sampai eksekusi sebenarnya dilakukan.

## 11. Fitur di luar scope V1

Direct points-as-tender/discount, offline card, offline constrained redemption/return, hard campaign budget stop, tiered discounts, cashback future purchase, free unrelated gift SKU, complex mix-and-match selector pools, ML pricing, non-refundable fees, dan charge-only sale tidak dijanjikan oleh suite ini. Payload fitur yang tidak didukung harus ditolak secara eksplisit; jangan diam-diam diinterpretasikan sebagai tipe lain.
