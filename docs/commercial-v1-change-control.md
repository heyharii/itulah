# Commercial V1 — Baseline dan Kontrol Perubahan

Baseline: **1.0 — 12 September 2026**  
Pintu masuk: [Commercial V1 — Acuan Utama](commercial-v1.md).

## 1. Apa arti dikunci

Baseline mengunci semantics bisnis untuk implementasi dan pengujian. D01–D14, K01–K06, INV-01–16 serta boundary/scope pada acuan utama tidak boleh berubah melalui UI defaults, provider adapter, migration, atau refactor tanpa change record.

Mengunci spesifikasi tidak berarti client sudah sign-off, code sudah memenuhi kontrak, atau semua konfigurasi deployment sudah tersedia. Status harus terpisah:

| Dimensi | Status saat baseline dibuat |
|---|---|
| Business specification | Baseline 1.0 ditetapkan dari hasil pembahasan |
| Detail algorithms / recovery | D01–D14, K01–K06, INV-01–16 terdokumentasi |
| Logical data / state / command | Terdokumentasi sebagai kontrak, belum physical implementation audit |
| Expected arithmetic | Lima golden fixtures; reference arithmetic tersedia |
| Application acceptance tests | 200 NOT_RUN; 183 P0 dan 17 P1 |
| Client evidence dashboard | Spec tersedia; implementasi belum dilakukan dalam pekerjaan ini |
| Client UAT / release approval | Belum ada bukti sign-off |
| Packing/fulfillment details | Terpisah, belum dibekukan dalam Commercial V1 |

## 2. Riwayat baseline

| Versi | Tanggal | Isi | Bukti implementasi |
|---|---|---|---|
| 1.0 | 2026-09-12 | Konsolidasi boundary, pricing/promo/checkout, voucher/loyalty, return/refund, Campaign, data/state/command, 200 test contracts, evidence dan change control | Belum diverifikasi; bukan release aplikasi |

Sumber utama: draft final domain, Promotion Rule Model, Checkout Kernel, data/state drafts yang diberikan user, kemudian keputusan D01–D14 dan K01–K06 dari penutupan aturan yang belum diputuskan. Ringkasan algoritme hanya mengutip baseline terbaru; tabel konflik di bawah menjelaskan bagian draft lama yang tidak berlaku.

## 3. Koreksi terhadap draft lama

### Tambahan keputusan UI-001 — diterima 12 September 2026

[Pricing UI revisi 1](commercial-v1-pricing-ui.md) mencatat refinement yang disetujui user: matrix Article × Store; numeric range bila relevant SKU prices berbeda; active store price sebagai acuan dengan newer publication/rollout state terpisah; Changes untuk outstanding operational work; History sebagai event timeline bahkan ketika Change masih aktif; promotion hanya contextual offer dengan markdown inapplicability eksplisit. Tidak menambahkan Pricing Change Draft.

Jenis perubahan: tambahan kontrak UI, **business baseline 1.0 tidak berubah**. D01–D14, K01–K06, INV-01–16 dan expected golden values tetap. Empat belas checklist UI ditambahkan di dokumen UI dan semuanya NOT_RUN, terpisah dari 200 kernel scenarios. Tidak ada implementasi UI dalam perubahan dokumentasi ini.

### Tambahan keputusan UI-002 dan UI-003 — diterima 12 September 2026

Dua keputusan disetujui user saat implementasi UI-001 menemukan bahwa dua hal
yang §6 minta tidak dapat direpresentasikan oleh data yang ada. Keduanya
**tambahan kontrak data; business baseline 1.0 tidak berubah.** D01–D14,
K01–K06, INV-01–16 dan seluruh expected golden values tetap.

#### UI-002 — `change_type` pada publication

| Field | Isi |
|---|---|
| Change ID / tanggal | UI-002, 2026-09-12 |
| Baseline asal → target | 1.0 → 1.0 (tambahan kontrak data, bukan revisi business rule) |
| Problem | UI-001 §6 menetapkan empat Types: Regular Price Change, Markdown, **Clearance**, **Correction**. Hanya dua yang dapat diturunkan dari baris yang ada. Clearance dan markdown akhir musim adalah baris `commercial_markdown` yang identik; correction dan re-price adalah baris `commercial_price_rule` yang identik. Membaca nama buku untuk kata "clearance" adalah tebakan yang salah justru ketika penting — buku bernama "Q3 Clearance" yang berisi harga dasar adalah re-price |
| Before / after | Before: Changes hanya bisa menyebut MARKDOWN untuk seluruh keluarga markdown. After: klasifikasi dibaca dari `commercial_publication.change_type` yang dideklarasikan penulisnya |
| D/K/INV terdampak | Tidak ada. **Engine tidak pernah membaca kolom ini.** Clearance memakai mekanika pricing markdown sepenuhnya — UI-001 §6 "Clearance bukan pricing layer tambahan" tetap berlaku |
| Data/state | Kolom nullable pada `commercial_publication`, CHECK pada empat nilai. Nullable untuk 26 buku legacy: backfill apa pun akan memasukkan klasifikasi bisnis yang tak seorang pun putuskan ke dalam audit trail. `NOT NULL` ditegakkan di aplikasi untuk publication baru, bukan oleh constraint, karena `NOT NULL` pada tabel berisi legacy menuntut default — dan default itulah tebakan yang ditolak di atas |
| Tests/fixtures | Tidak ada expected value yang berubah. Klasifikasi `UNCLASSIFIED` untuk buku pra-kolom diuji terpisah |
| Rollout | Buku terbit tidak berubah; kolom kosong berarti "dicetak sebelum kolom ini ada" |
| Decision | **Accepted** — user, 12 September 2026 |

#### UI-003 — rollout state pada bukti aktivasi

| Field | Isi |
|---|---|
| Change ID / tanggal | UI-003, 2026-09-12 |
| Baseline asal → target | 1.0 → 1.0 (tambahan kontrak data) |
| Problem | UI-001 §6 meminta "pending **dan failed** stores"; §3 meminta enam keadaan bukti termasuk "Rollout gagal pada store". `commercial_publication_activation` adalah catatan **keberhasilan saja** — barisnya ada berarti toko mengaktifkan, dan ketiadaannya tidak membedakan "belum pernah diberi tahu", "sudah punya belum diterapkan", dan "sudah dicoba dan gagal". `sync_command_delivery` adalah ledger pengiriman tanpa kolom status |
| Before / after | Before: pending hanya bisa dikurangkan (target − activated) dan failed tidak dapat dinyatakan sama sekali. After: state per (publication, store) yang dapat menyatakan **Pending / Active / Failed**, dengan waktu percobaan dan bukti kegagalan dalam kata-kata toko sendiri |
| D/K/INV terdampak | Tidak ada. Ini bukti operasional, bukan aturan harga. **Bukti aktivasi tetap satu sumber kebenaran** — model yang ada diperluas, bukan diduplikasi |
| Data/state | Kolom tambahan pada `commercial_publication_activation`. Baris lama seluruhnya adalah keberhasilan dan di-default ke ACTIVE lalu default dilepas, pola yang sama dengan migrasi refund allocation |
| Reporting/client impact | §6 "10/13 stores · 2 pending, 1 failed" menjadi dapat ditampilkan. §3 baris "Rollout gagal pada store" menjadi dapat dibedakan dari "belum aktivasi" |
| Rollout | Tidak mengubah harga mana pun. Toko yang tak pernah melapor tetap tak pernah melapor |
| Decision | **Accepted** — user, 12 September 2026 |

### Koreksi business drafts

| Topik | Isi lama / ambigu | Authority baseline 1.0 |
|---|---|---|
| Batas Commercial | Scope dokumen dibaca seolah semua ledger dimiliki Pricing | Navigasi lintas domain boleh; ownership Voucher/Loyalty/Tax/Sale/Return tetap terpisah |
| Coupon set | Terikat promotion_version_id | Dimiliki stable promotion identity; execution mem-pin versi (D04) |
| Best Price | Line winner berpotensi dipilih greedy | Minimum complete valid basket outcome termasuk no-promo (D03) |
| Combine priorities | Tie dapat memakai creation order | Reject ambiguous Combine priority; deterministic explicit order (D03) |
| Basket threshold | Dicek setelah diskon basket sebelumnya | Frozen after line/BXGY sebelum basket pertama pada tiap outcome (D03) |
| BXGY grouping | Reward/leftover/participants belum lengkap | Global cheapest rewards, highest remaining buyers, leftover excluded (D01) |
| Points multiplier | Highest multiplier dapat dibaca sebagai basket-global | Highest applicable per-unit multiplier; fixed bonus terpisah (D02) |
| Monetary/tax basis | Tax hanya disebut belakangan, basis threshold tidak jelas | Displayed inclusive basis; Tax normalization dan consistent net/tax snapshots (D05) |
| G01 points | 1.076 dapat dibaca berlaku dengan pajak apa pun | G01 tax 0; G03 hypothetical 10% menghasilkan 978 |
| Refund proportion | Original proportions atau successful refunds saja | Remaining capacity mengurangi semua open committed allocations (D11/K04) |
| Partial refund retry | Overall failure dapat mengulang seluruh tender | Frozen per-tender operations; retry unresolved saja (K05) |
| Hold timeout | Timer otomatis melepas setelah payment dimulai | Unknown payment tetap held dan direkonsiliasi (K01/K02) |
| Offline tender | Cash/card according to POS capability | V1 cash only (D07) |
| Voucher expired refund | Restoration bisa masuk saldo expired | Satu replacement 365 hari; cancelled needs operator (D06) |
| Campaign budget | Gross discount atau strict stop pada rencana lama | Ex-tax promotion discount net returns; warn only (D14) |
| Campaign health | Time elapsed otomatis menentukan Ahead/Behind | Hanya bila planned-to-date curve tersedia |
| Campaign totals | Menjumlahkan Promo Sales atau current scope joins | Deduplicate original unit facts dan frozen scope/activity version (D14) |
| Quantities / return | Hanya sale line aggregate | Stable sale unit allocations untuk partial qty return (INV-12/14) |
| Status immutable | Semua operational state seolah tidak boleh berubah | Facts immutable; operational state + audit dapat berkembang (K03) |

[Rencana arsitektur 31 Agustus](commercial-architecture-plan.md) dipertahankan sebagai latar teknis. Strict offline budget allowance, manual override, advanced rule families, atau feature lain di rencana lama tidak otomatis menjadi scope V1. Detail teknis yang kompatibel, seperti verified atomic artifact activation dan trace, tetap relevan. Pernyataan current-code dalam rencana lama perlu audit baru sebelum dipakai sebagai evidence.

## 4. Hal terbuka dan batas implementasi

Ini bukan placeholder untuk mengubah D01–D14. Tabel ini memisahkan konfigurasi bisnis/deployment, detail domain lain, dan pekerjaan implementasi dari formula Commercial yang sudah dipilih. Jangan memakai nilai fixture sebagai production default.

| ID | Hal yang belum ditetapkan | Dampak / gate | Penanggung jawab peran |
|---|---|---|---|
| OPEN-01 | Production Tax mapping, rate, treatment, rounding sesuai toko/yurisdiksi | Tax configuration wajib sah sebelum toko go-live; 10% hanya fixture | Tax owner + implementer |
| OPEN-02 | Loyalty earn rate, eligible customer/product policy, redemption options, expiry issuance normal, adjustment permissions | Pin scheme version sebelum loyalty diaktifkan; 1/Rp1.000 dan contoh Rp100.000 bukan universal default | Loyalty/business owner |
| OPEN-03 | Return eligibility: window, receipt/identity, condition, damaged goods/disposition, cross-store permission | Returns menentukan apakah boleh menerima; accepted return memakai value rules yang sudah locked | Returns/operations owner |
| OPEN-04 | Packing/handover: scan evidence, partial fulfillment, pickup/delivery, failed handover, cancellation, inventory timing | Fulfillment state contract dan tests terpisah sebelum diklaim siap; belum termasuk 200-case proof | Store operations / Fulfillment |
| OPEN-05 | Jenis charge yang diaktifkan, tarif, taxable treatment, kapan charge dipilih | Hanya supported fully refundable charges dalam V1; quote harus memuatnya sebelum payment | Business + Tax + Checkout |
| OPEN-06 | Payment provider, supported methods, definitive/unknown mapping, idempotency window, refund/settlement timing dan recovery SLA | Adapter contract + sandbox/fault evidence + operational owner wajib sebelum live tender | Payments / operations |
| OPEN-07 | Physical schema, exact API payloads/error codes, types, dependency topology dan migration mapping | Harus sesuai logical contract dan invariants; audit sebelum implementasi dinyatakan siap | Engineering |
| OPEN-08 | Role/approval matrix, threshold adjustment/refund/publish, client store scope dan retention/access policy | Enforced authorization sebelum capability dibuka; read-only evidence bukan repair permission | Business administrator + engineering |
| OPEN-09 | Manual price override, additional tenders, stock-sensitive/free-gift behavior | Tidak diaktifkan sebagai implicit V1 behavior; butuh scope/change record dan tests | Product/domain owner |
| OPEN-10 | New evidence dashboard implementation, source coverage, missing/stale data behavior, check tests | Spec tersedia; tambah tests tanpa mengklaim termasuk 200 lama | QA + reporting/engineering |
| OPEN-11 | Advanced Campaign metrics di luar formula terdokumentasi, planned curves, baseline/cohort sources | Metric unavailable = N/A; jangan menawarkan target terukur tanpa sumber dan formula | Campaign/reporting owner |
| OPEN-12 | Multi-selector AND/OR authoring syntax, multi-code input UX dan conflict diagnostics | Compiled scope/access harus eksplisit; jangan rilis authoring kombinasi ambigu tanpa schema/fixture tambahan | Commercial product + engineering |


### Temuan implementasi 12 September 2026

Ini bukan hal terbuka pada spesifikasi. Paket ini menetapkan aturannya; yang di
bawah adalah tempat kode belum memenuhinya, ditemukan saat implementasi UI-001
dan saat harness acceptance pertama dijalankan. Dicatat di sini agar klaim
kesiapan tidak dibuat di atasnya. Rujukan lengkap dengan bukti:
[`COMMERCIAL-V1-CONSISTENCY.md`](../COMMERCIAL-V1-CONSISTENCY.md) dan
[`ACCEPTANCE-COVERAGE.md`](../ACCEPTANCE-COVERAGE.md) di akar repositori.

| ID | Temuan | Status |
|---|---|---|
| FIND-01 | **Paket spesifikasi ini tidak terlacak git.** `commercial-v1*.md` dan `fixtures/commercial-v1-golden-fixtures.json` hidup di satu disk tanpa riwayat. Harness membaca fixture saat runtime | Perlu keputusan pemilik |
| FIND-02 | **MON-008 [D11]** — tiga baris Rp1 dikurangi Rp2 menghasilkan baris `[1,1,0]` dengan `discount_total 2`: melaporkan diskon Rp2 dan memberikan Rp1. Melanggar INV-02 dan INV-03 | Cacat kernel, belum diperbaiki |
| FIND-03 | **COM-007 [D03]** — dua basket offer Combine: diharapkan 400.000, kernel memberi 500.000. Kernel mengukur ulang tiap offer terhadap sisa yang ditinggalkan offer sebelumnya alih-alih memakai snapshot kualifikasi yang dipatok D03 | Cacat kernel, belum diperbaiki |
| FIND-04 | **BXY-004 [D01]** dan **PRP-003 [D11]** — tie-break alokasi memakai posisi keranjang, bukan identitas unit yang stabil. Urutan scan menentukan unit mana yang gratis, dan mempermutasi keranjang memindahkan rupiah antar baris. Hampir pasti satu cacat | Cacat kernel, belum diperbaiki |
| FIND-05 | **D07 belum ditegakkan di empat dari tujuh klausanya.** Kartu offline, unique/limited coupon, AcceptReturn offline, dan validitas snapshot. Akar tunggal: kasir tidak punya konsep konektivitasnya sendiri | Pekerjaan implementasi |
| FIND-06 | **D12 separuh.** Charges tidak dialokasikan ke unit, zero-due sale ditolak `NoTender`, dan `sale_tender.amount` mencatat uang yang diserahkan bukan yang dikenakan | Pekerjaan implementasi |
| FIND-07 | **Ruang id `sale` dan `edge_sale` terpisah.** Nol dari 48 edge sale cocok dengan 21.829 sale kanonik; tidak ada yang mengkanonikalisasi edge sale. `sale.customer_id` hanya terisi ketika kedua id kebetulan sama | Perlu jembatan pemetaan eksplisit |
| FIND-08 | **Tujuh baris CAM yang plan tandai UNIT tidak dapat menjadi unit test** — metrik campaign hidup di SQL tanpa fungsi metrik murni di mana pun | Perlu keputusan: pindahkan metrik ke kernel murni, atau tandai ulang sebagai integration |

Empat belas checklist UI-001 §8 tetap **NOT_RUN**: UI-001-05 dan UI-001-06 baru
menjadi *dapat* diuji setelah UI-002/UI-003; sisanya belum dijalankan.

Peran di atas merupakan responsibility yang perlu diisi saat implementasi, bukan penugasan ke orang yang belum menyetujui. Gate terkait hanya memblok capability yang bergantung padanya; tidak menghalangi pekerjaan independent seperti engine fixtures.

## 5. Jenis perubahan

| Jenis | Contoh | Proses |
|---|---|---|
| Editorial | Ejaan, link, penjelasan tanpa mengubah output | Catat patch revision; periksa tidak mengubah semantics |
| Configuration | Promo baru, rate scheme baru, tanggal campaign | Gunakan versioned configuration dan activation; original executions tidak berubah |
| Technical equivalent | Index/layout/refactor dengan output dan recovery identik | Mapping + relevant regression evidence; tidak perlu mengubah business rule |
| Business semantics | Threshold basis, rounding, refund capacity, offline capability | Change proposal, impact matrix, explicit business approval, revised baseline/fixtures/tests |
| Scope addition | New tender, packing state contract, new promotion family | Feature contract, ownership, data/recovery, acceptance cases, release gate |

Setiap perubahan arti perilaku menaikkan nomor baseline; perubahan yang tidak backward-compatible wajib menyebut migration/compatibility strategy. Nomor baseline dokumen berbeda dari software build, promotion version, schema version, dan artifact generation. Semua harus tercatat pada bukti sesuai kegunaannya.

## 6. Alur perubahan

```text
Usulan perubahan dengan contoh before/after
                   |
                   v
Impact: rules + data + states + commands + fixtures + tests + laporan
                   |
                   v
Keputusan business owner + technical/QA review dicatat
                   |
                   v
Revisi baseline dan expected tests / fixtures
                   |
                   v
Implementasi + regression / recovery evidence
                   |
                   v
Versioned rollout + client acceptance bila flow/outcome berubah
```

Jangan membuat implementasi yang berbeda lalu mengubah expected agar tes terlihat PASS tanpa keputusan semantics. Defect fix berarti membuat aplikasi kembali sesuai kontrak; perubahan kontrak harus dinyatakan sebagai perubahan kontrak.

Original sale/refund allocations tidak ditulis ulang oleh rule migration. Koreksi financial facts melalui audited reversals/adjustments dengan source jelas. Definition version yang pernah dipakai harus tetap dapat dibaca/replay selama retention policy yang berlaku.

## 7. Template change record

| Field | Isi wajib |
|---|---|
| Change ID / tanggal / pengusul | Stable reference |
| Baseline asal → target | Jangan menimpa identitas versi lama |
| Problem / alasan | Trigger konkret dan dampak ke user |
| Before / after | Contoh input sama dengan hasil sebelum/sesudah |
| D/K/INV / bagian terdampak | Exact references; invariants yang tetap harus berlaku |
| Data/state/command | Schema mapping, history, atomicity/recovery implications |
| Tests/fixtures | Case IDs baru/berubah, expected values, regression scope |
| Reporting/client impact | Definisi metric, receipt, UAT, evidence |
| Rollout / compatibility | Active quotes, published artifacts, offline stores, original sales |
| Decision | Accepted / rejected / deferred, business decision evidence dan reviewers |
| Implementation evidence | Build/config/run IDs, defects, rollout record |

## 8. Checklist konsistensi saat revisi

- Definisi voucher/coupon/points dan ownership tidak bergeser.
- Urutan calculation, tax basis, rounding, allocation, partial return tetap satu interpretasi.
- Unknown external outcome tetap mempunyai recovery dan tidak double effect.
- New version tidak mereset usage/saldo atau mengubah original facts.
- Semua normative links valid; fixtures cocok dengan contoh; jumlah test/status dilaporkan akurat.
- Deferred/open capability tidak dipresentasikan sebagai implemented/verified.
- Client dapat mengetahui baseline/build yang diuji dan membuka bukti hasilnya.
