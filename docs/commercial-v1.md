# Commercial V1 — Acuan Utama

Baseline: **1.0 — 12 September 2026**  
Status: **spesifikasi bisnis dibekukan untuk implementasi**. Ini bukan pernyataan bahwa aplikasi sudah lengkap, sudah diuji, atau sudah disetujui client untuk go-live.  
Bahasa normatif: **wajib** berarti kontrak; **boleh** berarti pilihan yang dibatasi kontrak; **ditunda** berarti tidak termasuk V1.

## 1. Cara memakai dokumentasi ini

Dokumen ini adalah pintu masuk resmi hasil bahasan Commercial. Implementer, reviewer, QA, dan client memakai baseline yang sama, bukan memilih contoh dari percakapan yang berbeda.

| Dokumen | Authority / tujuan |
|---|---|
| [Acuan utama ini](commercial-v1.md) | Boundary, scope, istilah, alur, aturan produk dan hubungan antarmodul |
| [Keputusan dan invariants](commercial-v1-decisions-and-invariants.md) | Detail algoritme D01–D14, recovery K01–K06, dan invariants INV-01–INV-16 |
| [Data, state, dan command](commercial-v1-data-state-contract.md) | Kontrak data logis, transisi, command, concurrency, publication, audit |
| [Pricing UI — UI-001](commercial-v1-pricing-ui.md) | Keputusan UI baru: matrix Article × Store, active store price, rentang SKU, drill-down, Changes dan History; business baseline tetap 1.0 |
| [Acceptance tests](commercial-v1-acceptance-test-plan.md) | 200 skenario yang harus dibuktikan, prioritas, lingkungan, dan UAT |
| [Golden fixtures](fixtures/commercial-v1-golden-fixtures.json) | Angka expected yang dapat dibaca mesin; bukan hasil aplikasi |
| [Bukti dan tampilan client](commercial-v1-evidence-and-client-views.md) | Status kesiapan, pemeriksaan transaksi, rekonsiliasi, dan bukti UAT |
| [Kontrol perubahan](commercial-v1-change-control.md) | Riwayat baseline, perbedaan dengan draft lama, hal terbuka, dan proses revisi |

Seluruh paket ini satu kontrak. Detail formula mengacu ke D/K/INV; tabel ringkasan tidak menggantikannya. Jika ada kontradiksi di dalam paket, catat defect dokumentasi dan hentikan perubahan perilaku terkait sampai terselesaikan. Jangan menjadikan urutan edit file sebagai penentu aturan bisnis.

[Rencana arsitektur 31 Agustus](commercial-architecture-plan.md) tetap referensi latar teknis, bukan authority atas scope atau formula yang berbeda dengan baseline ini. Catatan implementasi di dokumen lama tidak dianggap audit kondisi kode saat ini.

## 2. Tujuan dan batas janji

Commercial mengatur harga dan offer yang dapat dijelaskan serta mengukur business initiative. Integrasinya memastikan jumlah yang ditagih, saldo yang dipakai, points yang diberikan, retur, dan laporan berasal dari bukti transaksi yang konsisten.

Sistem harus dapat menjawab:

- Mengapa harga unit ini demikian, termasuk harga normal, markdown, dan promo yang menang atau tidak dipakai?
- Berapa merchandise, pajak, charges, Amount Due, dan pembayaran yang benar-benar terkonfirmasi?
- Saldo/coupon/points apa yang dicadangkan, dibukukan, atau dikembalikan?
- Jika satu unit diretur, berapa hak refund dan points reversal berdasarkan transaksi asal?
- Dari transaksi mana angka Promotion dan Campaign berasal?

Tidak ada klaim perangkat lunak akan selalu sempurna. Bukti kesiapan berasal dari tes yang lulus untuk versi tertentu; transaksi berjalan tetap memerlukan pemeriksaan, rekonsiliasi, dan recovery.

## 3. Domain, menu, dan ownership

| Konsep | Definisi | Authority |
|---|---|---|
| Pricing | Regular price dan markdown sebagai dasar penjualan | Commercial / Pricing |
| Promotion | Rule benefit transaksi, eligibility, combination, dan limits | Commercial / Promotions |
| Coupon | Akses ke promotion; tidak menyimpan nilai pembayaran | Child capability Promotions |
| Campaign | Initiative dengan objective, metric, target, scope, budget, activities | Commercial / Campaigns |
| Voucher | Stored value untuk membayar Amount Due | Voucher domain dan ledger tersendiri |
| Points | Loyalty balance; V1 ditukar menjadi voucher | Customer / Loyalty |
| Tax | Treatment, rate, dan tax rounding | Tax domain |
| Checkout / Sale | Quote, pembayaran, finalisasi, execution snapshot | Checkout / Sales |
| Return / Refund | Penerimaan retur dan penyelesaian kewajiban pengembalian | Returns / Payments terkait |
| Packing / Handover | Persiapan dan serah-terima barang | Fulfillment / store operations |
| Inventory / Cost | Stok, pergerakan, cost snapshot | Inventory / Costing |

Menu yang direncanakan:

```text
Commercial
├── Overview
├── Pricing
│   ├── Prices
│   ├── Changes (regular change, markdown, clearance, correction)
│   └── History
├── Promotions
│   └── Coupons
├── Campaigns
└── Vouchers (akses ke capability Voucher)

Customer
└── Loyalty
    ├── Members
    ├── Points
    └── Points Ledger
```

Penempatan Vouchers dalam navigasi tidak memindahkan ledger ke pricing engine. Commercial tidak menulis stok, menjalankan charge provider, atau menjadi authority saldo points. Campaign tidak menambahkan lapisan stacking policy yang tersembunyi.

## 4. Scope V1

| Termasuk | Batas |
|---|---|
| Regular price, markdown, versioned publication | Harga ambigu, overlap markdown, atau snapshot tidak sah ditolak |
| Item percentage/amount discount, fixed price | Benefit moneter tidak menaikkan harga atau membuat nilai unit negatif |
| Basket amount/percentage discount | Eligibility jelas dan seluruh discount dialokasikan ke units |
| Buy X Get Y | Satu eligible pool, complete groups, reward termurah; bukan unrelated gift |
| Points multiplier / fixed bonus | Terpisah dari Best Price moneter |
| Shared / unique coupon | Scarce limits memakai central online authority |
| Voucher dan points-to-voucher | Ledger, atomicity, authorization, idempotency |
| Cash / card / voucher split tender | Card dan voucher online; setiap tender mempunyai hasil sendiri |
| Partial/full return dan refund | Original unit values; per-tender frozen allocations dan recovery |
| Offline sale | Cash only dengan snapshot valid; points pending sampai cloud menerima |
| Campaign measurement | Observed performance; Discount Budget warn only |
| Bukti kebenaran | Test runs, transaction trace, ledger reconciliation, UAT |

Ditunda: points-as-tender, direct points discount, cashback future purchase, automatic future coupon, tiered discount, complex mix-and-match, free unrelated SKU, ML pricing, cross-campaign policy inheritance, hard Campaign budget stop, offline card/voucher/limited coupon/redemption/return, non-refundable charges, charge-only sale, dan tender tambahan di luar tiga tipe di atas.

Manual price override, detail packing/shipping, return eligibility policy, serta provider-specific behavior tidak boleh diasumsikan dari contoh. Daftar batas dan kebutuhan konfigurasi ada di [kontrol perubahan](commercial-v1-change-control.md).

## 5. Urutan dari harga sampai barang diserahkan

```text
Cart: SKU/unit, quantity, toko, customer, coupon, waktu
                         |
                         v
Pilih price list dan regular price yang sah
                         |
                         v
Markdown aktif menggantikan regular price sebagai basis
                         |
                         v
Tax service menormalkan basis ke harga displayed termasuk pajak
                         |
                         v
Bangun semua alternatif monetary outcome yang valid
  |-- line discount / Buy X Get Y
  |-- bekukan eligible spend untuk syarat basket
  |-- basket discount, berurutan pada remaining amount
                         |
                         v
Pilih complete basket outcome terbaik, termasuk kandidat tanpa promo
                         |
                         v
Final allocation per unit + net ex-tax + tax yang konsisten
                         |
                         v
Tambahkan charges yang dipilih dan alokasinya
                         |
                         v
AMOUNT DUE + estimasi points + quote ber-versi
                         |
                         v
Validasi akhir + reservasi voucher / constrained coupon
                         |
                         v
BeginPayment: pin quote, simpan intent, mulai tender
                         |
                         v
Voucher / Cash / Card -> seluruh applied amount terkonfirmasi
                         |
                         v
FinalizeSale -> COMPLETED + execution facts / dispatch durable
                         |
             +-----------+----------------+
             |           |                |
             v           v                v
      Points posting   Fulfillment    Reporting / reconciliation
```

Tahap line lalu basket adalah urutan menghitung **setiap alternatif**, bukan memilih pemenang line secara greedy. Komponen net/tax harus tetap konsisten selama perhitungan; harga inclusive tidak ditambah pajak sekali lagi. Charges yang masuk quote tidak dihitung sebagai qualifying merchandise spend.

Coupon diberikan sebagai input eligibility, tetapi penggunaan hanya consumed untuk winning positive benefit pada completed sale. Points sebelum selesai adalah estimasi. Online earning dibukukan konsisten dengan finalisasi; offline earning baru available setelah diterima cloud.

```text
Points yang sudah available -> RedeemPointsToVoucher -> Voucher
                                                        |
                                                        v
                                              Input tender checkout
```

Packing adalah status operasional terpisah. Arah proses POS yang dibahas: persiapan boleh dimulai saat checkout, serah-terima mengikuti payment confirmation. Detail scan, partial handover, pickup/delivery, dan pembatalannya belum menjadi kontrak Commercial V1; lihat OPEN-04. Biaya packing, jika didukung sebagai charge, harus diketahui sebelum quote dipin.

## 6. Pricing dan markdown

1. Resolve tepat satu active price list dari konteks tenant/toko/currency/waktu. Entry SKU menang atas Article fallback. Ambiguitas pada precedence sama ditolak; harga tidak ditemukan menghentikan evaluasi.
2. Maksimal satu markdown aktif untuk SKU/toko/waktu. Markdown adalah replacement price sementara dan tidak boleh melebihi regular price yang berlaku.
3. Perubahan regular price yang membuat markdown invalid wajib dibereskan sebelum publikasi. Perubahan tidak menulis ulang sale lama.
4. Promotion mengecualikan markdown item secara default. Jika `Markdown = Allow`, benefit dihitung dari markdown/current amount, bukan dari regular price.
5. Simpan regular source/version, markdown identity/version, catalog/price snapshot, timezone, dan evaluation time pada trace.
6. Validity memakai `[start, end)` dalam UTC; jadwal lokal memakai snapshot IANA timezone toko. Lihat D08–D09.

Istilah client: Regular Price, Markdown Price, Promotion, Final Price. Markdown reduction disajikan terpisah dari promotion discount dan Discount Budget.

## 7. Promotion rule model

Satu canonical definition, dengan form template yang sederhana:

| Bagian | Isi V1 |
|---|---|
| Identity | Stable ID, name, version, lifecycle, optional Campaign relationship |
| Scope | All merchandise, division, article/selected articles, tags; resolve ke unit eligibility dari catalog snapshot |
| Qualification | Everyone/member, coupon, minimum quantity, minimum eligible spend, store, schedule |
| Benefit | Item percentage, item amount, fixed price, basket percentage/amount, BXGY, points multiplier/fixed bonus |
| Compatibility | Markdown Allow/Exclude, monetary BestPrice/Exclusive/Combine, exclusive scope, priority, points compatibility |
| Limits | Lifetime uses, per-customer uses, maximum discount, benefit quantity / BXGY complete groups |
| Evidence | Definition version/hash, eligibility reasons, selected outcome, allocations |

Semua qualification wajib terpenuhi (AND). Selector produk harus dipublish menjadi definisi deterministik; UI tidak boleh menyisipkan semantik AND/OR baru tanpa contract revision. Minimum quantity/spend memakai seluruh eligible pool. Limit quantity membatasi benefit, bukan diam-diam memperkecil pool untuk qualification.

| Benefit | Perhitungan |
|---|---|
| Item percentage | Percentage atas current displayed amount per unit; HALF_UP per unit |
| Item amount | Amount off setiap beneficiary unit, dibatasi remaining amount |
| Fixed price | Discount = max(0, current amount − fixed price) |
| Basket percentage | Percentage atas eligible remaining total; HALF_UP sekali lalu alokasi |
| Basket amount | Potongan total sekali pada eligible basket, dibatasi kapasitas |
| BXGY | Lihat D01: floor(qty/(X+Y)) complete groups, reward termurah, buyer termahal dari sisanya |
| Points | Lihat D02; tidak mengurangi Amount Due |

### 7.1 Combination dan Best Price

- `BestPrice`: minimum final displayed merchandise total di antara seluruh valid outcomes. Kandidat tanpa promotion tetap ada.
- Dua monetary promotions yang menyentuh unit sama hanya boleh ditumpuk jika keduanya `Combine`. Offers pada unit disjoint dapat coexist sesuai exclusivity.
- `Exclusive Line` menghalangi monetary promotion lain pada unit yang disentuh. `Exclusive Basket` menghalangi seluruh monetary promotion lain dalam sale tersebut.
- Dalam tiap tahap, priority ascending. Combine priorities yang dapat aktif bersama harus unik. Urutan creation/database bukan kebijakan.
- Basket qualification dibekukan setelah line/BXGY dan sebelum basket discount pertama untuk masing-masing alternatif. Basket benefit berikutnya memakai remaining amount.
- Tie outcome memakai daftar priority + stable promotion ID yang terurut, lalu canonical unit IDs (D03).
- Tidak membandingkan rupiah discount dengan nilai points. Points diproses setelah monetary outcome dipilih.
- Exact result atau explicit evaluation failure sebelum tender. Deadline 2 detik; target performa D13 tidak boleh dicapai dengan silent approximation.

Contoh non-greedy: merchandise Rp600.000; A 20% menghasilkan Rp480.000; B basket Rp150.000 dengan minimum Rp500.000 menghasilkan Rp450.000 jika dipakai sendiri. Engine harus mempertimbangkan B sendiri, walaupun A membuat threshold B gagal.

### 7.2 BXGY dan alokasi

Hanya positive-current-value units masuk eligible BXGY pool. Reward = g×Y unit termurah; buyer = g×X unit termahal dari unit tersisa. Stable unit ID memecahkan tie. Satu unit tidak dipakai dua kali oleh promotion yang sama. Leftover tidak ikut bundle allocation.

Total reward discount dialokasikan proporsional ke semua buyer/reward participants. Label customer boleh menyebut free item; hak refund membaca allocated net setiap unit. Ini menghindari refund penuh atas buyer sementara reward dipertahankan tanpa alokasi potongan. Percentage reward/cap mengikuti canonical benefit definition; tidak menambahkan unrelated gift SKU.

### 7.3 Limits dan lifecycle

MaxDiscount adalah gross monetary benefit per promotion/transaksi. MaxBenefitQuantity memilih units dengan benefit maksimum dan stable tie; BXGY menggunakan maximum complete groups. Hanya positive applied benefit mengonsumsi usage. Losing/zero-benefit reservation dilepas.

Draft → Scheduled → Active → Paused/Ended adalah lifecycle yang ditampilkan. Published definitions immutable; edit membuat versi baru. Coupon limits tetap melekat pada stable promotion identity lintas versi. Campaign tidak otomatis menjadi schedule/stacking inheritance untuk child promotion; setiap executable version menyimpan scope dan schedule efektifnya.

## 8. Coupon

| Mode | Perilaku |
|---|---|
| Tanpa coupon | Qualification lain tetap diperiksa |
| Shared unlimited | Kode dapat dipakai banyak sale; setiap positive completed use tercatat |
| Shared constrained | Global/per-customer limits dihitung consumed + active reservations; online |
| Unique | Satu kode disediakan bagi satu penggunaan; reserve/consume secara atomic; online |

Coupon set dimiliki stable promotion identity, bukan promotion version. Redemption/authorization tetap menyimpan versi yang dipin checkout. Edit tidak mereset consumed atau reserved count. Penurunan limit di bawah consumed + reserved ditolak.

Codes dinormalisasi trim + uppercase ASCII A–Z/0–9/hyphen, collision dalam tenant ditolak. Codes/secret tidak tampil utuh dalam log. Per-customer limit membutuhkan identity sah; guest tidak diberi identity baru untuk menghindari batas.

Pre-payment cancellation melepas reservation. Unknown payment tidak otomatis melepasnya. Completed sale dengan benefit positif mengonsumsi penggunaan; return tidak mengembalikan penggunaan. Coupon gate yang gagal tidak boleh diam-diam ditampilkan sebagai applied.

## 9. Points dan voucher

### 9.1 Earning

Basis = eligible final merchandise **ex-tax**, tanpa charges. Voucher tender tidak mengurangi earning basis.

Base points = floor(total eligible net / scheme denominator); alokasikan integer base ke units melalui largest remainder. Highest eligible integer multiplier dipilih **per unit**, bukan satu multiplier menyebar ke seluruh basket. Default multiplier 1x.

Fixed bonus tidak dikalikan. Basis bonus wajib OncePerTransaction atau PerEligibleUnit. Untuk fixed bonuses, bandingkan tiap BestBonus offer dengan total Combine fixed offers, pilih yang tertinggi. Compatibility monetary diterapkan pada unit terkait; base earning reguler tetap mengikuti scheme. Zero positive eligible net tidak mendapat earning/promotional points.

Simpan base, multiplier bonus, fixed bonus, scheme/promotion version, dan total per unit. Return membalik original awarded points, bukan menghitung ulang floor saat retur. Saldo negatif karena reversal yang sah diperbolehkan; penukaran baru tidak boleh membuat saldo negatif.

### 9.2 Redeem points to voucher

Online, dalam satu central transaction: check saldo → debit points → create voucher → ISSUE ledger → redemption completed. Retry logical key sama mengembalikan redemption/voucher yang sama. Error sebelum commit membatalkan keseluruhan efek. Rate penukaran dan expiry issuance normal adalah konfigurasi scheme, bukan angka universal dari contoh.

### 9.3 Voucher tender

Voucher menyimpan original value, owner/claim, currency, expiry, operational status, ledger, dan active authorizations. Current balance adalah projection ledger; available memperhitungkan holds dan spendability. Expired/cancelled voucher mungkin masih mempunyai accounting balance, tetapi tidak spendable.

ISSUE menambah nilai, REDEEM mengurangi, RESTORE mengembalikan sesuai original tender. Adjustment wajib mempunyai source/reason/actor. Jangan menggunakan saldo cache sebagai satu-satunya bukti. Partial usage merupakan derived display, bukan pengganti operational state.

| Voucher saat refund restoration dieksekusi | Hasil |
|---|---|
| Active | RESTORE ke asal tanpa memperpanjang expiry |
| Expired | Satu replacement voucher, valid 365 hari, owner/claim asal terverifikasi; original tidak ikut dikredit |
| Cancelled | Memerlukan operator berwenang; tidak otomatis direactivate atau diganti |

## 10. Money, tax, charges, dan payment

```text
Sum final merchandise net ex-tax
+ Sum merchandise tax
+ Sum supported charges gross (termasuk pajak charges)
= Amount Due

Sum confirmed applied tenders = Amount Due pada COMPLETED
```

Monetary offers dan thresholds memakai displayed merchandise inclusive applicable tax. Tax domain menormalkan tax-exclusive source dan menghitung treatment/rounding. Jangan hardcode tarif fixture sebagai tarif produksi. Discount gross = net ex-tax delta + tax delta dari before/after snapshots.

Final IDR memakai integer rupiah; intermediate exact decimal/rational. Largest remainder menggunakan stable ID dan capacity caps. Header/line/unit wajib menjumlah persis (D11, INV-01–03).

Supported charges V1 seluruhnya refundable dan dialokasikan ke units proporsional net merchandise ex-tax; jika total net nol, equal allocation dengan stable remainder. Charges bukan merchandise sales atau points basis. Non-refundable fee/charge-only sale ditunda.

Cash applied berbeda dari cash handed dan change. Voucher adalah tender, bukan discount. Card success membutuhkan trusted provider evidence. Zero-due sale boleh completed tanpa fake zero tender.

Quote TTL sebelum BeginPayment adalah 5 menit, dibatasi expiry rule/snapshot yang lebih awal. Cart berubah → revision/re-evaluation. BeginPayment mem-pin quote dan authorizations; cart tidak boleh berubah diam-diam. Provider timeout → unknown/reconcile; bukan bukti gagal. Cancellation setelah ada successful tender memerlukan kompensasi dan recovery yang tercatat.

## 11. Return dan refund

Return acceptance dan refund completion adalah dua hal berbeda. Eligibility untuk menerima barang berasal dari Returns policy; setelah diterima, Commercial memakai aturan nilai berikut:

1. Resolve original sale units, termasuk satu unit dari line qty > 1. Satu unit hanya boleh diterima dalam satu return.
2. Refund entitlement = original unit gross + original allocated charges. Gunakan original tax dan discount/points allocations.
3. Jangan reprice remaining basket, mencabut threshold retroaktif, atau memakai promotion hari return.
4. Reverse original unit points dan sales/discount reporting sekali pada accepted return. Coupon usage tetap historical consumed.
5. Dalam transaksi penerimaan yang konsisten, claim units, freeze refund allocation, reserve tender capacity, dan catat reversal/obligation.
6. Remaining tender capacity = original applied amount − seluruh non-cancelled committed refund allocations, termasuk pending/processing/failed-retriable/succeeded.
7. Bagikan refund proporsional remaining capacity dengan largest remainder. Bekukan angka sebelum provider call; retry tidak menghitung ulang.
8. Jalankan per-tender refund. Tender yang sudah sukses tidak dijalankan lagi. Unknown outcome tetap direkonsiliasi.
9. Full return menghasilkan total refund tepat original applied payment, termasuk allocated charges. Intermediate split boleh berbeda akibat urutan pembulatan; total akhirnya harus sama.

Accepted return mengurangi retained sales walaupun card refund masih pending. Dashboard harus menampilkan keduanya secara terpisah. Failure refund tidak menghapus accepted-return facts atau membebaskan unit untuk return kedua.

## 12. Offline dan publication

Offline cash checkout hanya memakai complete verified snapshot yang masih valid. Snapshot memuat price, markdown, promotion, catalog references dan dependencies/version yang diperlukan; Tax/Loyalty tetap authority untuk definisinya masing-masing.

Allowed offline: regular/markdown, unconstrained promotion, shared unlimited coupon, member offer bila verified cached membership masih sah. Online-only: card, voucher, points redemption, unique/global/per-customer constrained usage, dan AcceptReturn/refund.

Publication harus versioned, scoped ke toko, diverifikasi, dan activated secara atomic. Store tidak mencampur sebagian rules baru dengan sebagian lama. Last-known-good boleh dipakai hanya bila masih valid. Invalid/expired snapshot menghentikan sale baru yang membutuhkannya.

Offline sale menyimpan original config version, event time/timezone, unit facts, tenders, logical ID, dan sync status. Cloud menerima original valid evidence tanpa repricing memakai rules sekarang. Replay tidak menggandakan earning, coupon usage projection, sales, atau inventory dispatch. Pending points menjadi available setelah cloud acceptance.

## 13. Promotion dan Campaign reporting

### 13.1 Promotion

List: Promotion | Status | Applies to | Benefit | Stores | Usage | Period.

Observed metrics: Promo Sales, Discount Given, Uses, Baskets Touched, Units Touched, dan Gross Profit bila cost tersedia. Promo Sales adalah retained eligible merchandise yang disentuh promotion, bukan sales yang terbukti disebabkan promotion. Basis gross/net dan return treatment harus ditulis pada metric.

Uses/Baskets Touched merupakan historical completed positive-benefit activity; return tidak mengurangi usage. Net financial metrics membalik original allocated amounts pada accepted return. Angka dua promotions bisa overlap; jangan jumlahkan Promo Sales anak untuk memperoleh Campaign Sales.

### 13.2 Campaign

Campaign menyimpan objective, metric, target model/value/unit, period, measurement scope, activities, Discount Budget, dan guardrails. Activity V1 hanya Promotion. Scope toko/produk/customer dan catalog cohort/activity links dibekukan per activation version; edit prospektif membuat versi baru.

Target model: Reach, Increase by, Reduce by, Keep above, Keep below. Increase/Reduce wajib menyebut absolute amount, relative percent, atau percentage points beserta baseline yang diperlukan. Metric yang memerlukan data belum tersedia tidak ditampilkan sebagai nol atau siap digunakan.

| Metric | Definisi V1 |
|---|---|
| Net Sales | Retained eligible merchandise ex-tax dari completed sales dikurangi accepted returns |
| Units | Retained eligible unit count |
| Baskets | Distinct original sales yang masih mempunyai retained eligible units |
| Customers | Distinct identified customers pada retained eligible scope; guest dikecualikan |
| ABV | Eligible retained Net Sales / retained eligible baskets; denominator nol = N/A |
| Discount Budget Used | Monetary promotion allocation ex-tax pada linked activities, net of accepted returns |
| Customer Discount Given | Monetary promotion discount incl-tax; terpisah dari budget basis |
| Gross Profit / Margin | Memerlukan original cost snapshot; cost tidak lengkap = N/A, bukan nol |
| Sell-through | Sold frozen opening-cohort units net of returns / opening cohort units |

Campaign scope menentukan sales eligibility; linked activities menentukan discount attribution. Unit yang disentuh dua child promotions dihitung sekali untuk Campaign Sales. Campaign yang scope-nya overlap juga tidak boleh dijumlahkan sebagai company total tanpa deduplication.

Markdown reduction, voucher tender, dan points tidak masuk Discount Budget. Budget V1 **warn only**, tidak menghentikan checkout. Replenishment/transfer tidak diam-diam mengubah opening-stock cohort.

Campaign-period view mengatribusikan return ke original sale/campaign walaupun retur setelah campaign berakhir. Activity-date view menampilkan kapan reversal diproses. Keduanya menggunakan source facts sama dengan tanggal pengelompokan yang jelas.

List: Campaign | Objective | Actual/Target | Budget | Period | Activities | Stores. Detail memperlihatkan metric, target, time left, budget, activities, dan guardrails. Ahead/Behind hanya jika planned-to-date curve tersedia; elapsed time tidak otomatis menjadi target linear. Previous period adalah comparison, bukan Expected atau causal lift.

## 14. Golden contoh yang menjadi acuan

G01 secara eksplisit **tax 0 dan charges 0**, member valid, markdown Allow, dua monetary offers Combine priority 100/200, unique coupon untuk basket, loyalty 1 point/Rp1.000 dengan 2x points.

| Tahap | Shirt | Shoes | Total |
|---|---:|---:|---:|
| Regular | Rp299.000 | Rp499.000 | Rp798.000 |
| Setelah markdown | Rp299.000 | Rp349.000 | Rp648.000 |
| Setelah Shirt 20% | Rp239.200 | Rp349.000 | Rp588.200 |
| Alokasi basket Rp50.000 | Rp20.333 | Rp29.667 | Rp50.000 |
| Final / Amount Due | Rp218.867 | Rp319.333 | Rp538.200 |
| Awarded points | 438 | 638 | 1.076 |

Payment: voucher Rp100.000 + card Rp438.200. Shoes return: Rp319.333 → voucher Rp59.334 + card Rp259.999; reverse 638 points. Shirt return berikutnya: Rp218.867 → voucher Rp40.666 + card Rp178.201; reverse 438 points.

G02/G03 menguji hypothetical tax 10%; G03 dengan displayed amounts sama menghasilkan **978 points**, bukan 1.076, karena basis ex-tax berubah. G04 menguji BXGY leftover; G05 menguji empat tender dan pembulatan. Semua detail ada dalam [fixtures](fixtures/commercial-v1-golden-fixtures.json) dan test plan.

## 15. Kesiapan, implementasi, dan penggunaan client

Urutan kerja:

```text
Baseline rules + expected fixtures
             |
             v
Logical data / state / command contracts
             |
             v
Physical schema + engine + adapters + recovery
             |
             v
Automated tests + evidence untuk build tertentu
             |
             v
Client UAT + transaction explanation + reconciliation
             |
             v
Release decision sesuai scope -> monitoring transaksi berjalan
```

Status saat baseline dibuat: 200 application scenarios **NOT_RUN** (183 P0, 17 P1). Reference arithmetic bukan bukti implementasi aplikasi. Packing detail dan kontrol dashboard baru belum otomatis tercakup dalam 200 scenarios tersebut.

Sebelum capability dinyatakan siap: seluruh tes dalam scope lulus, tidak ada P0 failed/blocked/not-run, semua missing dependencies dijelaskan, bukti sandbox dan recovery tersedia, UAT client dicatat pada versi yang sama, dan operational reconciliation dapat dijalankan. Perubahan scope hanya lewat [kontrol perubahan](commercial-v1-change-control.md), bukan mengganti FAIL menjadi waived secara diam-diam.
