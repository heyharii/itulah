# Commercial V1 — Keputusan dan Invariant

Tanggal: 12 September 2026  
Status: aturan V1 yang dipilih untuk spesifikasi dan acceptance tests; implementasi aplikasi belum diverifikasi.

Bagian dari **baseline 1.0**. Mulai dari [Commercial V1 — Acuan Utama](commercial-v1.md). Revisi semantics mengikuti [kontrol perubahan](commercial-v1-change-control.md); detail data/state/command ada di [kontrak logis](commercial-v1-data-state-contract.md).

Dokumen ini menetapkan pilihan yang masih terbuka dalam percakapan agar tim mempunyai satu hasil yang diharapkan. Ia digunakan bersama [acceptance test plan](commercial-v1-acceptance-test-plan.md) dan [golden fixtures](fixtures/commercial-v1-golden-fixtures.json).

Cakupan adalah integrasi Pricing, Promotions, Checkout, Voucher, Loyalty, Returns, Tax, dan Campaign. Nama menu tidak memindahkan kepemilikan ledger/domain. Dokumen arsitektur repository yang lebih lama tidak dianggap otomatis mencerminkan seluruh keputusan V1 terbaru di sini.

## Pilihan dengan konsekuensi operasional

| Pilihan | Konsekuensi V1 |
|---|---|
| Offline cash only | Offline card, voucher, constrained coupon, points redemption, dan return ditunda sampai online. |
| Minimum spend dan monetary offers memakai harga displayed termasuk pajak | Harga label dan syarat promo cocok; Net Sales/points tetap ex-tax. |
| Discount Budget ex-tax | Customer Discount Given incl-tax dan budget tidak selalu angka yang sama. |
| Semua supported charges refundable | Non-refundable fees belum didukung. |
| Expired voucher refund menjadi replacement | Valid 365 hari; cancelled voucher memerlukan operator berwenang. |
| Bundle leftover tidak ikut allocation | Hanya buyer/reward participants menerima bundle discount dan net refund terkait. |
| Exact Best Price atau explicit timeout | Tidak ada fallback diam-diam yang mengubah janji harga terbaik. |

## Daftar keputusan

### D01 — Peserta Buy X Get Y dan leftover

V1 memakai satu eligible pool untuk buy dan reward. g = floor(eligible positive-value units / (X + Y)). Pilih g × Y unit termurah sebagai reward, lalu g × X unit termahal dari unit tersisa sebagai buyer. Leftover tidak menerima alokasi bundle discount. Harga pembanding adalah current displayed amount tepat sebelum promotion tersebut dijalankan. Jika harga sama, gunakan stable unit ID. Total reward discount dialokasikan proporsional ke buyer + reward participants, dengan batas current amount setiap unit. Satu unit dipakai sekali oleh promotion yang sama. Interaksi dengan promotion lain mengikuti D03.

Alasan: Pemilihan global reward termurah tetap mengikuti keputusan sebelumnya, sementara peserta dan refund menjadi deterministik.

### D02 — Base points, scope multiplier, dan fixed bonus

Rate points berlaku pada eligible net merchandise ex-tax, tanpa charges/tender. Base points = floor(total eligible net / rate denominator), lalu alokasikan integer base points ke unit dengan largest remainder berdasarkan eligible net ex-tax. Setiap unit memakai integer multiplier tertinggi yang eligible untuk unit itu; default 1x. Multiplier yang sama tie-break priority ascending lalu stable promotion ID. Fixed bonus tidak dikalikan. Fixed bonus wajib OncePerTransaction atau PerEligibleUnit. Untuk fixed bonuses, bandingkan tiap BestBonus offer dengan total semua Combine fixed offers, lalu pilih total tertinggi; tie-break deterministik. Pemilihan fixed bonus tidak menghilangkan multiplier. OncePerTransaction dialokasikan hanya ke eligible units dengan largest remainder. Points promotion yang melarang kombinasi moneter mengecualikan unit yang menerima monetary promotion; base earning reguler tetap berlaku. Unit net ex-tax nol tidak mendapat base atau promotional points V1. Simpan base, multiplier bonus, fixed bonus, dan source/version per unit.

Alasan: Mencegah 3x untuk Shoes menyebar ke Shirt, bonus ikut dikalikan, dan perbedaan jumlah akibat pembulatan per line.

### D03 — Kombinasi moneter, qualification, dan urutan

Best Price memilih total displayed merchandise termasuk pajak terendah dari semua valid outcomes; tax/charge/tender tidak diperlakukan sebagai promotion. No-promo selalu menjadi kandidat. Dua monetary promotions yang menyentuh unit sama hanya dapat ditumpuk jika keduanya Combine. BestPrice offers pada unit yang disjoint boleh berjalan bersamaan. Exclusive Line melarang monetary promotion lain menyentuh unitnya; Exclusive Basket melarang semua monetary promotion lain dalam sale. Points diatur oleh D02. Tahap line dan BXGY mendahului basket; tiap tahap memakai priority ascending. Combine priorities harus unik di antara rule dengan toko/waktu yang dapat aktif bersamaan. Basket qualifications diperiksa pada snapshot setelah seluruh line/BXGY discounts dan sebelum basket discounts pertama; snapshot qualification ini tetap untuk semua basket promotions. Benefit basket berikutnya dihitung dari remaining displayed amount setelah benefit sebelumnya. Tie outcome: pilih daftar (priority, stable promotion ID) terurut yang paling kecil secara leksikografis, kemudian canonical unit IDs. Semua qualification member/coupon/quantity/spend digabung AND.

Alasan: Global Best Price tetap benar dan urutan benefit tidak mengubah threshold secara tersembunyi. Golden fixture A+B harus secara eksplisit memakai Combine.

### D04 — Lifetime coupon, promotion limits, dan perubahan versi

Coupon set dimiliki identitas promotion yang stabil, bukan dibuat ulang otomatis per rule version. Kode unused membuka versi aktif pada quote baru; quote/reservation yang berjalan tetap menunjuk versi yang diotorisasi. Completed positive-benefit use mengonsumsi satu usage; accepted returns tidak mengembalikan usage. Unique code tetap consumed. Shared unlimited code tetap aktif. Global/per-customer max uses dihitung lintas versi sebagai consumed + active reservations. Penurunan limit di bawah consumed + reserved ditolak. Currency/store/customer restrictions diverifikasi server. Codes V1 memakai ASCII A–Z, 0–9, dan hyphen; trim outer whitespace dan uppercase sebelum lookup; reject karakter lain dan collision canonical dalam tenant. Voucher/coupon secret tidak muncul utuh di log.

Alasan: Edit promotion tidak mereset scarcity dan normalisasi kode tidak membuka pemakaian kedua.

### D05 — Basis harga customer-facing, threshold, dan pajak

Semua monetary offers dan minimum eligible spend V1 dinyatakan dalam displayed merchandise amount termasuk applicable tax, setelah diskon tahap yang relevan; charges dan tender dikecualikan. Source tax-exclusive dinormalisasi menjadi displayed tax-inclusive quote oleh Tax service sebelum monetary evaluation. Tax service tetap authority atas treatment/rate; Commercial tidak hardcode tarif. Setelah setiap perubahan harga unit, simpan gross amount, net ex-tax, dan tax component yang konsisten. Amount Due = final unit gross + allocated charges termasuk pajak charges. Net Sales dan points memakai merchandise ex-tax. Discount allocation menyimpan gross discount serta net ex-tax delta dan tax delta dari snapshot sebelum/sesudah, bukan membagi diskon dengan tarif dan membulatkan terpisah. Tarif 10% di fixture hanya angka uji, bukan ketentuan pajak produksi.

Alasan: Customer melihat minimum belanja dan potongan yang cocok dengan harga label; dashboard dan points tetap ex-tax.

### D06 — Refund voucher aktif, expired, dan cancelled

Voucher aktif menerima RESTORE ke voucher asal tanpa memperpanjang expiry. Jika voucher asal expired ketika refund restoration dieksekusi, buat satu replacement voucher sebesar alokasi refund, valid 365 hari sejak issue, dengan recipient/customer yang sama atau claim yang diverifikasi dari transaksi asal. Original expired voucher tidak sekaligus dikreditkan. Link replacement ISSUE ke original_tender, refund_tender, dan source voucher agar total refund tetap terlacak. Untuk voucher cancelled, jangan aktifkan atau issue replacement otomatis: tandai refund membutuhkan penanganan operator berwenang; keputusan dan alasan wajib diaudit. Retry pada semua jalur tidak membuat restorations/replacements kedua.

Alasan: Refund tidak hilang dalam saldo expired, sementara cancellation tetap dihormati.

### D07 — Operasi offline dan validitas snapshot

V1 offline menerima cash sale saja, dengan price/promotion/catalog/tax/loyalty snapshot yang telah tervalidasi dan masih sah. Card, voucher redemption, points redemption, unique/limited coupon, serta AcceptReturn/refund memerlukan online authority. Shared unlimited coupon dan unconstrained promotions dapat berjalan offline. Member-only offer memerlukan verified cached membership yang belum expired; jika tidak ada, offer tidak eligible. Pending points belum tersedia sampai cloud menerima sale. Cloud memvalidasi original version dan waktu sale, tidak menghitung ulang dengan current rules. Expired/corrupt/incomplete snapshot tidak digunakan; refresh harus atomic. Perubahan cloud yang belum sampai store tidak membatalkan completed offline sale sah yang memakai snapshot pinned; flag reconciliation bila bukti tidak valid. Simpan waktu lokal, timezone, config version, dan server sync receipt terpisah.

Alasan: Batas offline V1 dapat diuji dan tidak menjanjikan global scarcity saat koneksi terputus. Dukungan offline card ditunda.

### D08 — Resolusi regular price dan markdown

Dalam konteks toko/currency/waktu, gunakan tepat satu price list aktif hasil assignment; entry SKU mengalahkan Article fallback. Jika pada precedence yang sama ada lebih dari satu entry sah, activation ditolak. Jika tidak ada harga sah, checkout tidak menebak harga. Maksimal satu markdown aktif untuk SKU/toko/waktu; overlap ditolak saat authoring/publish. Markdown tidak boleh lebih tinggi dari applicable regular price pada validity window; publish perubahan regular yang membuat konflik memerlukan pembetulan markdown terlebih dahulu. Persist price list/entry version dan markdown identity/version di execution evidence.

Alasan: Tidak memakai creation order, first database row, atau harga dari toko lain sebagai fallback.

### D09 — Waktu dan batas jadwal

Semua validity windows memakai start inclusive, end exclusive: start <= event_time < end. Timestamp disimpan UTC, dengan store timezone IANA yang disnapshot untuk schedule lokal. Jadwal weekend/jam toko dievaluasi dalam timezone toko. Quote/authorization merekam waktu dan versi; pembayaran yang sedang unresolved mengikuti recovery, bukan kehilangan hak hanya karena wall clock melewati expiry. Snapshot offline melewati valid_until tidak boleh dipakai untuk sale baru.

Alasan: Tepat pada pergantian hari atau akhir promo hanya ada satu hasil yang benar.

### D10 — Caps, quantity benefit, dan usage nol

Minimum spend/qty memakai seluruh qualified scope. MaxQuantity pada benefit diartikan sebagai MaxBenefitQuantity dan tidak diam-diam memperkecil qualification pool. Jika benefit hanya mencakup N units, pilih unit yang memberi total monetary discount terbesar dengan stable ID sebagai tie-break. Untuk BXGY, limit quantity dinyatakan sebagai maximum complete groups agar tidak memotong satu bundle. MaxDiscount membatasi total gross monetary discount per promotion per transaction; alokasi hasil yang dicap tetap proporsional ke beneficiary units. Setiap diskon dibatasi remaining amount unit. Coupon/usage hanya consumed jika promotion menang, benefit positif, dan sale completed; benefit 100% tetap positif walau final due nol. Reservation spekulatif untuk losing/zero-benefit promotion dilepas.

Alasan: Limit memiliki unit dan cakupan yang jelas; pelanggan tidak kehilangan coupon tanpa benefit.

### D11 — Pembulatan money, points, dan refund

Money final IDR memakai integer rupiah; fraction sementara memakai exact rational/decimal, bukan binary float. Item percentage dibulatkan HALF_UP per unit; basket percentage dibulatkan HALF_UP sekali atas eligible total, lalu dialokasikan. Semua proportional integer allocations memakai floor lalu largest fractional remainder; tie stable unit/tender ID ascending dan tidak melampaui capacity. Base points mengikuti D02. Tax rounding mengikuti Tax service; fixture memakai HALF_UP per unit tax component, lalu net = displayed - tax. Refund baru dihitung proporsional dari remaining tender capacity, yaitu original applied amount dikurangi semua successful dan open committed refund allocations. Allocation dibekukan sebelum provider call. Failed-but-retriable tetap open; pembatalan obligation yang definitif memerlukan audit. Setiap allocation non-negatif, total tepat, cumulative hanya naik, full refund tepat. Urutan partial returns boleh mengubah intermediate tender shares sebesar efek pembulatan; full totals tidak berubah.

Alasan: Algoritme remaining-balance menghindari pengurangan refund yang sudah dibayar dan menjaga total walau ada banyak tender.

### D12 — Charges, pembayaran tunai, dan Amount Due nol

Charges yang didukung V1 refundable sepenuhnya dan dialokasikan saat checkout ke units proporsional terhadap net merchandise ex-tax; jika seluruh merchandise net nol, gunakan pembagian equal per unit dengan stable remainder. Snapshot charges gross/net/tax per unit; partial return mengembalikan original share. Non-refundable fees dan charge-only sale ditunda. Cash handed dan change dicatat terpisah; sale_tender.amount hanya amount applied pada due. Zero-due sale boleh completed tanpa tender; tidak membuat debit voucher nol. Points earning/promotional points nol bila tidak ada positive eligible net merchandise. Full return semua units mengembalikan seluruh due termasuk allocated charges.

Alasan: Full-refund invariant tetap berlaku dan uang kembalian tidak menjadi hak refund tambahan.

### D13 — Best Price deadline dan target kinerja V1

Tidak ada silent greedy/approximate fallback. Deadline kalkulasi engine 2 detik; jika outcome optimal belum ditemukan dalam ruang rule V1, evaluasi gagal eksplisit sebelum tender dimulai. Target release pada hardware store yang dicatat: workload 20 units dan 10 eligible monetary rules, setelah warm-up, p95 <=100 ms dan p99 <=250 ms untuk engine-only. I/O provider dikecualikan dari benchmark ini. Beban lebih besar menjadi stress test dengan hasil exact atau explicit timeout; jangan melabeli hasil parsial sebagai Best Price. Dataset dan hardware harus dicatat bersama hasil.

Alasan: Ada target yang terukur tanpa menjanjikan optimasi kombinasi tanpa batas.

### D14 — Campaign, return timing, dan metrik

Net Sales = retained merchandise ex-tax dari completed sales, dikurangi accepted returns. Accepted return membalik merchandise/points analytics walau provider refund masih pending; payment reporting terpisah. Campaign scope/catalog cohort/activity links dibekukan saat activation dan diberi version; perubahan berikutnya berlaku prospektif pada versi baru. Campaign-period view mengatribusikan returns ke original sale/campaign version, termasuk returns setelah campaign berakhir; tampilkan pula activity-date view agar tanggal proses retur terlihat. Discount Budget V1 memakai monetary promotion discount ex-tax net of accepted returns. Customer Discount Given incl-tax adalah metrik terpisah. Markdown, voucher tender, dan points tidak masuk Discount Budget. Uses/Baskets Touched promotion adalah gross historical activity; tidak dikurangi karena return. Campaign Baskets = distinct original sales dengan retained eligible units; scoped ABV = retained eligible net sales / retained eligible baskets; identified customers mengabaikan guest, denominator nol = N/A. Gross profit membutuhkan cost snapshot; jika missing, N/A. Sell-through V1 memakai frozen opening-stock cohort: sold cohort units net of returns / opening cohort units; replenishment/transfer bukan sales dan tidak diam-diam mengubah cohort. Increase/Reduce target harus menyebut absolute amount, relative percent, atau percentage points. Baseline adalah perbandingan, bukan bukti causal lift.

Alasan: Angka campaign tidak berubah karena current joins dan definisi laporan tetap konsisten dengan snapshot transaksi.

## Aturan transaksi dan pemulihan

### K01 — Quote dan payment intent

Quote mempunyai ID, revision/hash, pricing snapshot, customer/store/currency, dan waktu expiry. TTL quote sebelum payment dimulai adalah 5 menit, dibatasi akhir validity rule/snapshot yang lebih awal. Reprice diperlukan jika quote kedaluwarsa sebelum BeginPayment. BeginPayment mem-pin quote dan authorization; cart tidak dapat diedit diam-diam setelah tahap ini.

Simpan payment intent, payload fingerprint, logical operation ID, dan provider idempotency/reference sebelum mengirim request eksternal. Hasil yang tidak diketahui tetap UNKNOWN/RECONCILING. Jika provider idempotency window sudah berakhir, query/reconcile existing operation dahulu; jangan membuat charge baru secara buta.

### K02 — Reservasi saldo dan penggunaan

V1 central voucher, points, coupon usage, dan loyalty redemption berada dalam satu transactional boundary Postgres. Check saldo + reservation/debit memakai row lock atau conditional mutation yang setara; BEGIN/COMMIT saja tidak menggantikan concurrency control. Locks diambil dalam urutan konsisten dan tidak ditahan selama HTTP call ke provider.

Available voucher balance mengurangi holds aktif. Setiap authorization terikat checkout ID, quote revision, dan generation/fencing token. Pre-payment hold boleh habis bersama quote. Setelah payment attempt dimulai, expiry memicu rekonsiliasi; tidak otomatis membuat saldo/kode dapat dipakai oleh pelanggan lain ketika hasil pembayaran belum diketahui.

### K03 — Finalisasi sale dan pembatalan

FINALIZING dapat diulang tanpa mengulang pembayaran yang sukses. Finalization membukukan snapshot yang dipin, voucher debit, coupon consumption, points earning, dan durable dispatch event secara konsisten. Semua core local writes yang saling bergantung berada dalam transaksi database yang sama atau mempunyai protocol recovery yang menjaga invariant di atas.

Pembatalan sebelum payment attempt melepas reservation. Jika sebagian payment telah berhasil, cancellation menjadi proses kompensasi yang tercatat; jangan langsung menandai CANCELLED sambil meninggalkan tagihan. Keberhasilan yang datang terlambat tetap direkonsiliasi.

Operational status dapat berubah; yang immutable adalah completed calculation/execution facts. Jangan menyamakan immutability snapshot dengan larangan memperbarui status recovery.

### K04 — AcceptReturn dan kapasitas refund

AcceptReturn selalu online. Dalam transaksi yang konsisten, klaim sale_units agar tidak diterima oleh return lain, catat accepted return dan original value reversals, buat/freeze refund allocations, serta cadangkan kapasitas tender. Serialize per original sale/tender capacity saat dua returns bersamaan.

Remaining capacity = original applied tender − seluruh non-cancelled committed refund allocations. Alokasi yang pending, processing, succeeded, atau failed tetapi masih akan dipulihkan tetap masuk hitungan sekali. Jangan hanya mengurangi successful provider refunds.

### K05 — Percobaan refund

Refund allocation adalah authority jumlah. Refund tender menunjuk allocation itu; attempts merekam setiap interaksi provider tanpa menciptakan hak refund baru. Jumlah tidak dihitung ulang saat retry. Jangan mengulang voucher restoration yang sudah sukses ketika card refund gagal.

Bedakan callback lama/duplikat dari genuine late failure baru dari provider. Genuine late failure direkonsiliasi sebagai kewajiban yang belum terselesaikan dengan audit/compensating facts yang benar; jangan menghapus riwayat dan jangan mengulang tender lain yang sukses.

Voucher replacement untuk expired voucher tetap menutup allocation pada original tender. Original balance tidak ikut direstore sehingga tidak ada dua sumber nilai.

### K06 — Idempotency dan audit

Key di-scope ke tenant + command type + logical operation. Simpan request fingerprint; key sama dengan payload berbeda adalah conflict. Provider operation ID, ledger source reference, accepted returned unit, serta voucher hasil loyalty redemption mempunyai uniqueness yang ditegakkan pada storage/transaction boundary.

Simpan actor, source sale/unit, rule/scheme version, authorization IDs, timestamps, reason untuk adjustment, serta external references. Replay event boleh menambah delivery/attempt audit, tetapi tidak menambah efek uang/points.

## Invariant yang wajib diuji

| ID | Area | Harus selalu benar |
|---|---|---|
| INV-01 | Exact values | Money final berupa integer rupiah; signed ledger entries boleh negatif, tetapi unit price/discount/refund allocation tidak negatif. Intermediate fractions dihitung exact. |
| INV-02 | Amount reconciliation | Sum net merchandise + merchandise tax + allocated charges gross = Amount Due. Unit/line/header totals konsisten. |
| INV-03 | Discount conservation | Sum discount_allocation = applied promotion discount; gross discount = ex-tax delta + tax delta; discount unit <= remaining unit amount. |
| INV-04 | Best Price | Hasil adalah minimum dari seluruh valid outcomes dalam contract V1, atau explicit evaluation failure; tidak ada silent approximate winner. |
| INV-05 | Historical evidence | Completed monetary snapshot dan rule version yang digunakan tidak berubah; perubahan melalui versi baru atau reversal. |
| INV-06 | Payment coverage | COMPLETED membutuhkan sum confirmed applied tenders = Amount Due; cash change bukan applied tender. Zero-due sale boleh tanpa tender. |
| INV-07 | Voucher balance | Ledger sum = current balance; available = spendable balance minus active holds; reserve/commit/release tidak menciptakan double spend. |
| INV-08 | Points balance | Available points sama dengan committed ledger sum; pending offline earning belum tersedia. Redemption tidak membuat saldo negatif; reversal yang sah boleh. |
| INV-09 | At-most-once business effect | Command logical ID/key + payload fingerprint hanya menimbulkan satu efek bisnis. Attempt/retry boleh banyak dengan hasil uang yang sama. |
| INV-10 | Durable references | Satu loyalty redemption menghasilkan paling banyak satu voucher; provider operations, ledger effects, dan successful restoration menunjuk source logical operation yang unik. |
| INV-11 | Scarcity reservation | Consumed + reserved <= limit; authorization hanya dapat dibukukan oleh checkout/quote/generation pemiliknya. Timer tidak membebaskan unresolved payment secara buta. |
| INV-12 | Return uniqueness | Satu sale_unit hanya dapat diterima dalam satu return. REQUESTED/REJECTED tidak mengonsumsi hak retur secara permanen. |
| INV-13 | Refund capacity | Sum non-cancelled committed allocations, termasuk pending/failed-retriable/succeeded, tidak melebihi original applied tender. Concurrent returns memakai kapasitas yang diserialisasi. |
| INV-14 | Refund conservation | Sum allocation = refund obligation. Semua units beserta allocated charges dikembalikan menghasilkan total refund persis original payment; partial refund memakai original values. |
| INV-15 | Status truth | UNKNOWN/PROCESSING bukan FAILED; completion tidak diumumkan tanpa bukti yang cukup. Recovery selalu dapat dilanjutkan dari durable intent/result. |
| INV-16 | Analytics replay | Campaign eligible unit dihitung sekali per metric; accepted return direverse sekali; replay/rebuild menghasilkan totals yang sama sesuai scope version. |

## Kontrak command yang diturunkan dari aturan ini

| Command | Syarat/hasil utama |
|---|---|
| EvaluateCart | Pure preview; tidak consume usage, mengurangi saldo, atau memanggil provider payment. |
| AuthorizeCoupon / AuthorizeVoucher | Quote sah, ownership/generation benar, capacity cukup; atomic reservation. |
| BeginPayment | Durable intent + provider key tersimpan; quote dipin. |
| RecordPaymentResult / ReconcilePayment | Verifikasi evidence; unknown tidak diperlakukan sebagai definitive failure. |
| FinalizeSale | Uang sudah tertutup; core execution facts committed satu kali. |
| RedeemPointsToVoucher | Check/debit points + voucher ISSUE atomic dan idempotent di central DB. |
| AcceptReturn | Unit unik; original snapshot; freeze refund obligation/allocation dan reverse points sekali. |
| ExecuteRefund / ReconcileRefund | Gunakan frozen allocation; hanya logical tender yang masih unresolved dijalankan. |
| SyncOfflineSale | Validasi original evidence; post available points dan analytics sekali. |

## Batas dokumen

Tanggal/tarif/jumlah di fixtures adalah input uji, bukan hasil test aplikasi atau aturan pajak yurisdiksi tertentu. UI authoring, schema SQL, exact Rust types, dan provider adapters harus diturunkan dari aturan ini. Jika salah satu aturan berubah, ubah versi keputusan dan expected fixtures/test terkait sebelum menyebut test passing.
