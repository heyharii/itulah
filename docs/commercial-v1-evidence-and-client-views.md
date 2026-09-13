# Commercial V1 — Bukti Kebenaran dan Tampilan Client

Baseline: **1.0 — 12 September 2026**  
Status: spesifikasi pembuktian dan tampilan yang akan dibangun; **dashboard belum diimplementasikan oleh pekerjaan dokumentasi ini**.  
Acuan: [Commercial V1](commercial-v1.md), [invariants](commercial-v1-decisions-and-invariants.md), [200 acceptance scenarios](commercial-v1-acceptance-test-plan.md).

## 1. Apa yang dibuktikan

| Lapisan | Pertanyaan | Bukti |
|---|---|---|
| Release readiness | Apakah aturan bekerja pada versi yang diuji? | Expected vs actual, test run, environment/build/config versions, evidence/defect |
| Transaction checks | Apakah transaksi ini dihitung dan dibukukan konsisten? | Pricing trace, original unit allocations, confirmed tenders, ledger/source links |
| Operational reconciliation | Apakah transaksi dan saldo di semua sumber tetap cocok? | Source coverage/cutoff, pending obligations, store sync, provider/settlement comparisons |
| Client UAT | Apakah perjalanan yang disepakati dapat dipakai dan dijelaskan? | Client-executed scenarios, linked real run results, comments dan sign-off per version |

Keempatnya saling melengkapi. Accounting totals yang cocok belum membuktikan eligibility/Best Price benar. Test PASS tidak membuktikan semua transaksi produksi bebas masalah. Screenshot hijau tanpa source/run evidence tidak cukup.

## 2. Tabel kesiapan fitur

Angka berikut adalah inventaris test plan, **bukan hasil pengujian aplikasi**.

| Area | Scenario count | Status baseline |
|---|---:|---|
| Configuration, pricing, eligibility, monetary, combination, BXGY | 56 | Semua NOT_RUN |
| Points earning dan redemption | 18 | Semua NOT_RUN |
| Coupon | 11 | Semua NOT_RUN |
| Voucher | 12 | Semua NOT_RUN |
| Tax / charges | 10 | Semua NOT_RUN |
| Checkout / payment | 14 | Semua NOT_RUN |
| Return / refund | 22 | Semua NOT_RUN |
| Offline | 10 | Semua NOT_RUN |
| Campaign | 12 | Semua NOT_RUN |
| Persistence / security | 15 | Semua NOT_RUN |
| Property tests | 8 | Semua NOT_RUN |
| Full journeys | 8 | Semua NOT_RUN |
| Operations / performance | 4 | Semua NOT_RUN |
| **Total** | **200** | **0 hasil eksekusi aplikasi tersedia** |

Client-facing columns setelah runner tersedia: Area | Total dalam scope | Lulus | Gagal | Terblokir | Belum diuji | Versi diuji | Terakhir diuji | Buka bukti.

Test statuses: NOT_RUN, PASS, FAIL, BLOCKED. BLOCKED/NOT_RUN tidak masuk PASS. Skipped/out-of-scope wajib ditampilkan beserta change reference, tidak dihilangkan dari denominator diam-diam. Last pass pada build lama tidak ditampilkan sebagai current pass untuk build baru tanpa valid evidence linkage.

Setiap result menyimpan test ID/version, build/schema/engine/rule versions, environment/provider simulator atau sandbox, seed/clock/input snapshot, expected/actual, timestamp, run ID, evidence URI, defect ID bila gagal. History run tetap tersedia; retry PASS tidak menghapus intermittent FAIL.

## 3. Tabel pemeriksaan satu transaksi

Contoh berikut memakai expected **G01: tax 0, charges 0**. Actual dan selisih sengaja kosong sampai aplikasi dijalankan.

| Pemeriksaan | Seharusnya | Hasil aplikasi | Selisih | Status |
|---|---:|---:|---:|---|
| Total regular | Rp798.000 | — | — | Belum diuji |
| Total setelah markdown | Rp648.000 | — | — | Belum diuji |
| Shirt line discount | Rp59.800 | — | — | Belum diuji |
| Basket discount | Rp50.000 | — | — | Belum diuji |
| Final Shirt | Rp218.867 | — | — | Belum diuji |
| Final Shoes | Rp319.333 | — | — | Belum diuji |
| Amount Due | Rp538.200 | — | — | Belum diuji |
| Voucher applied | Rp100.000 | — | — | Belum diuji |
| Card applied | Rp438.200 | — | — | Belum diuji |
| Points posted | 1.076 | — | — | Belum diuji |
| Shoes refund obligation | Rp319.333 | — | — | Belum diuji |
| Shoes voucher restoration | Rp59.334 | — | — | Belum diuji |
| Shoes card refund | Rp259.999 | — | — | Belum diuji |
| Shoes points reversal | 638 | — | — | Belum diuji |

Expected pada golden tests berasal dari independently calculated fixtures, bukan hasil engine yang disalin menjadi expected. Small-cart Best Price memakai independent exhaustive oracle. Transaksi umum memakai invariants dan versioned replay; sampled independent pricing checks dilabeli sample, bukan klaim seluruh basket sudah dibandingkan exhaustive oracle.

Klik transaksi membuka urutan regular → markdown → offers/eligibility → winner → unit allocations → net/tax/charges → due → tenders → coupon/points effects → return/refund timeline. Alasan promo tidak berlaku harus dapat dibaca: scope tidak cocok, threshold gagal, markdown excluded, coupon tidak valid, kalah Best Price, atau blocked exclusive.

Status calculation, payment, sync, packing, dan refund dipisahkan. Contoh keadaan sah: **angka cocok, sale paid, refund sebagian pending**. Paid bukan bukti barang sudah packed/handed over. Detail fulfillment dan tes tambahannya masih OPEN-04; jangan menyebutnya sudah tercakup oleh 200 tests.

## 4. Tabel rekonsiliasi operasional

| Pemeriksaan | Expected condition | Evidence / tindak lanjut |
|---|---|---|
| Amount Due | Unit net + merchandise tax + charge gross = due | Original unit/header facts; selisih IDR harus tepat nol |
| Discount | Allocations sum = applied benefit; gross = net delta + tax delta | Application/unit links; cap dan basis benar |
| Completed payment | Confirmed applied tenders = due | Provider/auth evidence + cash applied; change terpisah |
| Voucher | Ledger = balance projection; spendable available memperhitungkan holds/status | Per-voucher entries/auth; expired balance bukan available |
| Points | Committed ledger = available projection; offline pending terpisah | Per-customer entries; valid negative reversal bukan otomatis error |
| Scarce coupon | Reserved + consumed <= limit; owner/generation valid | Reservation/usage facts lintas toko |
| Accepted return | Original unit diklaim paling banyak satu accepted return | Unit claim dan original snapshot |
| Refund capacity | Successful + open non-cancelled allocations <= original tender | Allocation, bukan jumlah attempts |
| Refund completion | Setiap obligation cocok dengan confirmed per-tender effects | Outstanding amount, oldest pending, last provider check |
| Campaign | Rebuilt scoped facts = projection totals | Versioned scope, original sale dan accepted reversals |
| Store sync | Semua source stores/cutoff teridentifikasi | Last complete sync, backlog, rejected evidence |
| Provider payment | Local operation amount/status/ref cocok dengan provider facts | Unmatched/unknown dibedakan dari definitive mismatch |
| Settlement / bank | Batch receipts sesuai payments, refunds, fees, adjustments, timing | Jangan membandingkan gross sales langsung dengan net payout |

Provider behavior harus mengikuti adapter yang dipilih. Sebagai referensi, [Stripe payout reconciliation](https://docs.stripe.com/reports/payout-reconciliation) merekonsiliasi payout terhadap batch transaksi dan menampilkan gross, fee, net; itu mendukung pemisahan settlement dari sales. Referensi ini tidak berarti Stripe telah dipilih atau diintegrasikan.

Cadence rancangan: enforce critical invariants di command/commit; continuous recovery untuk unknown obligations; rekonsiliasi harian setelah source cutoff lengkap; independent replay/rebuild sesuai risk dan release. Jadwal/SLA provider, source availability, dan alert thresholds harus dikonfigurasi sebelum operasional (OPEN-06).

## 5. Aturan status dan denominator

| Label | Kapan dipakai |
|---|---|
| Cocok | Semua required inputs tersedia dan checks applicable selesai tanpa selisih |
| Ada selisih | Bukti lengkap menunjukkan ketidaksesuaian aturan/angka |
| Menunggu proses | Ada kewajiban belum selesai; tampilkan amount, age, owner dan next check |
| Bukti belum lengkap | Source belum sinkron, provider tidak diketahui, check belum berjalan, atau evidence hilang |
| Tidak berlaku | Check tidak applicable; alasan wajib tersedia |

Tidak ada data bukan berarti nol masalah. Overview wajib menampilkan scope toko/periode/currency, total expected transactions, checked count, unchecked count, matched/mismatched counts, unresolved payment/refund count dan amount, oldest pending, serta last complete source cutoff. Jika expected total tidak diketahui karena store offline, tampilkan **cakupan belum lengkap**, bukan 100%.

Check status dan operation status berada pada dimensi berbeda; transaksi bisa mempunyai beberapa pending operations. Summary wajib mendefinisikan apakah menghitung transaksi distinct, checks, atau operations agar angka tidak dijumlahkan secara salah. Pending melewati SLA berubah menjadi needs attention, bukan otomatis gagal finansial.

## 6. UAT bersama client

Client menjalankan perjalanan terpilih pada test tenant/sandbox, lalu melihat expected vs actual dari versi yang sama. Minimum demonstrasi mencakup G01–G05, coupon yang kalah/tidak valid, retry timeout sesudah payment sebenarnya sukses, partial refund satu tender berhasil, offline cash sync, dan campaign setelah accepted return. Gunakan case IDs yang sesuai dari test plan; demo tidak menggantikan 200 scenario coverage.

Tabel UAT: Journey | Test IDs | Expected | Actual / run link | Client verdict | Catatan / defect | Tester | Tanggal | Build / rule baseline.

Client verdict terpisah dari automated result. Sign-off tidak mengubah FAIL menjadi PASS. Simulasi provider berlabel simulator; sandbox berlabel sandbox; keduanya tidak diklaim live production proof.

## 7. Release gate dan akses

- Semua applicable P0 (183 pada full scope) wajib PASS; P1 dalam scope juga selesai sebelum capability dinyatakan siap. Full Commercial V1 membutuhkan seluruh 200, bukan persentase yang menyembunyikan critical failures.
- Scope changes tercatat sebelum keputusan release; proof gaps dan deferred capabilities terlihat pada client.
- UAT, recovery evidence, operational runbook, dan owners tersedia. Exact reconciliation required IDR tidak menggunakan tolerance Rp1 untuk menutupi rounding error.
- Client view read-only dan scoped tenant/stores; mask customer/coupon/voucher/payment secrets. Export mempertahankan filters, version, timestamp dan status completeness.
- Dashboard check logic juga memerlukan tes: missing data tidak hijau, stale run tidak current, cross-tenant access ditolak, denominator benar, status refund tidak disamakan dengan acceptance. Tes tambahan ini **belum ditambahkan ke jumlah 200**; daftarkan saat implementasi capability evidence.

Mulai dari hasil test runner yang dapat ditelusuri, lanjutkan transaction detail dan reconciliation report, kemudian ringkas untuk client. Jangan mengisi tabel dengan status sukses manual agar terlihat selesai.
