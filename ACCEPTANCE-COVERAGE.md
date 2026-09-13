# Commercial V1 — acceptance coverage

Diperbarui 2026-09-12. Dihasilkan oleh `backend/tests/acceptance.rs`; angka di
bawah adalah keluaran harness itu sendiri, bukan ringkasan tulisan tangan.

```
CARGO_INCREMENTAL=0 cargo test --test acceptance
```

Harness ini menjawab [acceptance test plan](docs/commercial-v1-acceptance-test-plan.md)
baris demi baris. Nilai expected dibaca saat berjalan dari
[golden fixtures](docs/fixtures/commercial-v1-golden-fixtures.json) — file itu
authority-nya, dan tidak ada satu pun angka di dalamnya yang disalin ke dalam
kode Rust.

> **Empat skenario GAGAL. Itu cacat kernel, bukan cacat fixture.** Lihat
> [§3](#3-yang-gagal--empat-cacat-kernel). Tidak ada satu pun yang saya
> perbaiki: berkasnya bukan milik saya, dan fixture yang dibengkokkan agar
> cocok dengan kode menghapus satu-satunya bukti yang ada.

---

## 1. Ringkasan

| | Jumlah | Arti |
|---|---:|---|
| **PASS** | 44 | dijalankan di sini, melawan kernel sungguhan, cocok |
| **FAIL** | 4 | dijalankan, **tidak** cocok — cacat, lihat §3 |
| **ADOPTED** | 20 | dikunci oleh tes yang sudah ada; harness memverifikasi tes itu masih ada |
| **NO_KERNEL_SURFACE** | 15 | rencana mengunci hasil yang kernel tidak punya cara menyatakannya — §4 |
| **NOT_SPECIFIED** | 0 | tidak ada. Paket spesifikasi lengkap; lihat §6 |
| **NOT_ENCODED** | 117 | butuh Postgres, provider simulator, dua sesi, atau hardware |
| **Terbukti** | **64 / 200** | PASS + ADOPTED |

Nol NOT_SPECIFIED adalah temuan tersendiri dan patut dikatakan terang-terangan:
**paket V1 tidak meninggalkan satu pun expected value untuk ditebak
implementer.** Setiap baris yang tidak terbukti di sini tidak terbukti karena
harness ini kurang permukaan, atau karena kernel kurang konsep — bukan karena
dokumennya diam.

### Per keputusan terkunci

Kolom `DECISION` adalah kolom *Aturan* milik rencana itu sendiri; `—` adalah
tanda rencana untuk "kontrak umum yang sudah dijelaskan", bukan ketiadaan
aturan.

```
  DECISION      PASS    FAIL   ADOPT  NOSURF  NOSPEC  NOTENC   TOTAL
  D01              0       0       2       0       0       1       3
  D02              2       0       2       3       0       0       7
  D02,D05,D11      0       0       2       0       0       0       2
  D03              2       1       1       0       0       0       4
  D04              0       0       0       0       0       6       6
  D05              5       0       2       0       0       0       7
  D06              0       0       0       0       0       4       4
  D07              0       0       0       0       0       8       8
  D08              1       0       0       0       0       0       1
  D09              2       0       0       0       0       0       2
  D10              3       0       0       0       0       1       4
  D11              4       1       1       0       0       1       7
  D12              1       0       0       3       0       0       4
  D13              0       0       0       0       0       3       3
  D14              0       0       0       3       0       4       7
  —               24       2      10       6       0      89     131
  ALL             44       4      20      15       0     117     200
```

**Keputusan yang belum punya satu pun skenario berjalan: D04 (coupon lifetime),
D06 (refund voucher expired/cancelled), D07 (offline), D13 (Best Price
deadline & kinerja), D14 (metrik campaign).** Keempat yang pertama butuh
database; D13 butuh hardware yang dicatat; D14 dibahas di §4.

**D12 (charges) adalah yang paling timpang**: 1 PASS lawan 3 NO_KERNEL_SURFACE.
Tiga dari empat barisnya tidak dapat dibuktikan seperti tertulis — lihat §4.1.

### Per level

```
  LEVEL         PASS    FAIL   ADOPT  NOSURF  NOSPEC  NOTENC   TOTAL
  E2E              1       0       4       0       0       8      13
  FAULT            0       0       0       0       0      17      17
  INT              3       0       0       2       0      73      78
  PERF             0       0       0       0       0       1       1
  PROP             5       2       5       1       0       5      18
  RACE             0       0       0       0       0       9       9
  UNIT            35       2      11      12       0       4      64
  ALL             44       4      20      15       0     117     200
```

Dari 64 baris UNIT, **46 terbukti dan 12 tidak dapat menjadi unit test sama
sekali seperti estate ini dibangun** (§4). Empat sisanya adalah baris authoring
CFG yang validatornya privat dan terikat database.

Yang belum tersentuh seluruhnya: **FAULT 17/17, RACE 9/9, PERF 1/1**. Tidak ada
satu pun yang dapat didekati tanpa fault injection, dua koneksi sungguhan, dan
hardware toko yang dicatat. Rencana §2 sudah mensyaratkan itu; harness ini
tidak menggantikannya.

---

## 2. Cara harness ini bekerja

Tiga hal yang membedakannya dari sekadar kumpulan `#[test]`:

**Skenario adalah data.** `backend/tests/acceptance/plan.rs` memuat 200 baris
rencana, ditranskripsi **secara mekanis** dari §6 dokumen (script, bukan
tangan) — kolom `scenario` dan `must_prove` tetap dalam bahasa aslinya supaya
kontraknya tidak bercabang jadi dua bahasa. `checks()` menyebut baris mana yang
punya jawaban. Runner menggabungkan keduanya, sehingga **baris yang belum
ditulis tesnya tetap terlihat**, bukan hilang. Daftar fungsi `#[test]` biasa
tidak bisa melakukan itu: yang hilang darinya tidak meninggalkan jejak.

**Angka dibaca, bukan ditulis.** `Fixtures::load()` membaca
`docs/fixtures/commercial-v1-golden-fixtures.json` saat berjalan. Menyalin
angkanya ke literal Rust lebih pendek dan justru itu yang tidak boleh: salinan
tangan adalah pendapat kedua yang cocok pada hari ia ditulis lalu menyimpang
diam-diam, dan suite tetap hijau melawan angka yang tak seorang pun kunci.

**Skenario yang sudah ada diadopsi, bukan ditulis ulang.** Beberapa tes
pricing-engine sudah merupakan golden scenario dalam segala hal kecuali
namanya. `Check::Adopted` menyebut nama tesnya dan **membuktikan nama itu masih
ada** (lewat `include_str!` atas berkas sumbernya). Mengganti nama atau
menghapus salah satunya menggagalkan harness — satu-satunya properti yang
membuat tautan seperti itu layak dimiliki. Tes yang diadopsi diberi label
`// Acceptance: XXX-000` di tempatnya.

**Laporan selalu tercetak**, lulus atau gagal, lewat stdout proses langsung —
bukan `println!`, yang ditangkap libtest dan hanya ditampilkan untuk tes yang
GAGAL. Itu persis kasus di mana ringkasan cakupan paling dibutuhkan: run hijau
yang sebagian besar rencananya belum terbukti.

**Register cacat.** `KNOWN_DEFECTS` di `acceptance.rs` memuat empat kegagalan
di §3. Ia bekerja dua arah: kegagalan yang **tidak** terdaftar memerahkan
suite, dan entri yang **berhenti** gagal juga memerahkan suite — supaya cacat
yang sudah diperbaiki dicoret secara sengaja dan daftarnya tidak membusuk jadi
permintaan maaf permanen. Tidak ada yang disembunyikan: keempatnya tetap
tercetak sebagai FAIL dan tetap dihitung FAIL di setiap matriks.

---

## 3. Yang gagal — empat cacat kernel

Keempatnya dijalankan melawan kernel sungguhan dengan fixture yang
merepresentasikan baris rencananya. **Jangan tutup satu pun dengan mengubah
angka expected.**

### 3.1 MON-008 [D11] — konservasi diskon putus pada keranjang kecil

```
keranjang: tiga baris @ Rp1;  aturan: Rp2 off basket
kernel   : lines [1, 1, 0], discount_total 2, total 2
expected : barang (3) = sisa + yang diambil
kernel   : 3 ≠ 2 + 2
```

Mesin melaporkan diskon Rp2 dan hanya benar-benar menurunkan Rp1. Struk
mengatakan pembeli hemat Rp2 sambil menagih Rp2 atas barang Rp3.

Penyebabnya terbaca jelas dari bentuknya: `discount_total` adalah **benefit
yang aturan itu maksudkan**, bukan jumlah yang benar-benar sampai ke baris.
Ini melanggar **INV-03** (*Sum discount_allocation = applied promotion
discount*) dan **INV-02** secara bersamaan. Nilainya sepele; jalur kodenya
tidak — ia yang menangani seluruh alokasi basket.

Tiga bentuk lain dalam sapuan yang sama lulus; yang ini adalah kasus di mana
setiap baris terlalu kecil untuk menyerap bagiannya.

### 3.2 COM-007 [D03] — snapshot kualifikasi basket tidak dibekukan

```
keranjang: Rp600.000
B1: Rp100.000 off, min Rp500.000, priority 100, Combine
B2: Rp100.000 off, min Rp550.000, priority 200, Combine
kernel   : ["B1 applied", "B2 refused as AmountTooLow"] → Rp500.000
expected : Rp400.000
```

D03 menyatakannya dengan kata-kata yang tidak ambigu:

> Basket qualifications diperiksa pada snapshot setelah seluruh line/BXGY
> discounts dan sebelum basket discounts pertama; **snapshot qualification ini
> tetap untuk semua basket promotions.**

Kernel mengukur ulang B2 terhadap sisa setelah B1 (Rp500.000), bukan terhadap
snapshot beku Rp600.000. Akibatnya **urutan priority di antara dua tawaran
basket mengubah tawaran mana yang lolos ambangnya** — persis efek tersembunyi
yang alasan D03 katakan hendak dicegah.

### 3.3 BXY-004 — unit reward dipilih menurut urutan scan, bukan stable ID

```
keranjang: A 300k, B 200k, C 100k, D 100k;  Buy 2 Get 1
scan [A,B,C,D] → C 83.333, D 100.000   (C yang jadi reward)
scan [D,C,B,A] → C 100.000, D 83.333   (D yang jadi reward)
```

D01: *"Jika harga sama, gunakan stable unit ID."* Rencana BXY-004:
*"Pemilihan menggunakan stable unit ID/order; tidak berubah setelah reload atau
retry."*

Total keranjang sama di kedua urutan, jadi ini tidak terlihat di kasir. Ia
terlihat saat **satu unit diretur**: nilai refund unit C bergantung pada urutan
kasir men-scan-nya. Itu tepat konsekuensi yang membuat D01 harus dinyatakan.

### 3.4 PRP-003 — tie-break largest-remainder mengikuti posisi keranjang

```
scan [SHIRT,SHOES,HAT] → HAT 91.795, SHIRT 221.797
scan [HAT,SHOES,SHIRT] → HAT 91.797, SHIRT 221.795
```

Satu rupiah berpindah antar baris ketika keranjang dipermutasi. D11:
*"tie stable unit/tender ID ascending"*. Akar masalahnya sama dengan §3.3.

Total tidak berubah, jadi ini tak terlihat sampai salah satu baris itu diretur
sendirian. Rencana PRP-003 menyebutnya langsung: *"perbedaan order transport
tidak menjadi aturan bisnis."*

> §3.3 dan §3.4 hampir pasti satu cacat: pemutus seri alokasi memakai indeks
> baris, bukan stable ID. Saya tidak memperbaikinya — berkasnya bukan milik
> saya — tetapi keduanya kemungkinan besar tutup bersamaan.

---

## 4. Yang kernel tidak punya cara menyatakannya (15)

Ini bukan tes yang belum ditulis. Ini baris yang **tidak bisa ditulis** sampai
kernel berubah, dan tiap satu adalah keputusan terkunci yang tidak punya
padanan di kode.

### 4.1 D12 — charges (3 baris: TAX-009, RFD-011, PAY-003)

- **TAX-009 / RFD-011.** D12 mensyaratkan charges **dialokasikan ke unit**
  proporsional terhadap net merchandise ex-tax, supaya retur sebagian
  mengembalikan bagian unit itu. Engine melaporkan charges **hanya di level
  header** (`charge_net_ex_tax`, `charge_tax_total`, `charge_total`);
  `LineResult` tidak punya bagian charge. Tidak ada yang bisa diretur per unit.
- **PAY-003.** D12: *"Zero-due sale boleh completed tanpa tender."*
  `tender::validate_tender` menolak total nol (`EmptyOrZeroSale`) dan
  `validate_tenders` menolak daftar tender kosong (`NoTender`). Keranjang yang
  didiskon habis **tidak dapat diselesaikan sama sekali**.

### 4.2 D02 — model points (3 baris: PTS-002, PTS-005, PTS-006)

- **PTS-002.** Rencana mengunci base 400 → 1.200 pada 3x, plus fixed 500 =
  1.700. Kernel **tidak punya integer multiplier**: kelipatan dinyatakan dengan
  membagi rate, dan 3x atas 1 poin per Rp1.000 adalah Rp333⅓ per poin, yang
  `Money` tidak dapat simpan. Rp333 memberi 1.201; Rp334 memberi 1.197. 2x
  kebetulan bisa (Rp500 tepat) — itu sebabnya G01 lolos dan PTS-002 tidak.
- **PTS-005.** D02 ingin tiap fixed bonus BestBonus dibandingkan dengan total
  seluruh fixed bonus Combine. `PointsCombination` mengatur **rate**;
  `EarnEffect::FixedPoints` tidak punya pembedaan BestBonus/Combine untuk
  diset.
- **PTS-006.** Butuh points rule yang mengecualikan unit yang menerima monetary
  promotion. Tidak ada field di `Rule` yang menyatakannya —
  `markdown_policy` mengecualikan barang clearance, tidak ada yang
  mengecualikan barang berdiskon.

### 4.3 D14 — metrik campaign (7 baris: CAM-001/002/003/006/008/009/011)

Rencana menandai ketujuhnya **UNIT** — klaim bahwa metrik campaign adalah
fungsi yang bisa dipanggil dengan sebuah keranjang lalu diperiksa. Di estate
ini bukan: metrik dihitung dalam **SQL** (`cloud/postgres/performance.rs`, CTE
`folded`), dan tidak ada satu pun fungsi metrik murni untuk dipanggil.
`reporting.rs` hanya memuat kalender sumbu laporan.

**Seperti dibangun, ketujuh baris ini tidak dapat menjadi unit test.** Mereka
butuh Postgres dan baris di `edge_sale*`. Ini keputusan arsitektur yang layak
diangkat: rencana mengasumsikan kernel metrik yang tidak ada.

### 4.4 Dua sisanya

- **MON-002.** Rencana ingin Rp25.000 off **setiap** dari tiga unit = Rp75.000.
  `Effect::Amount` berlaku sekali per keranjang, dan tes engine
  `a_flat_amount_comes_off_the_cart_once_not_once_per_line` menguncinya begitu.
  Tidak ada effect "amount per unit". Memakai `Percent` sebagai gantinya akan
  membuktikan aturan yang lain.
- **TAX-005.** Meminta pilihan tender tidak menggeser net sales atau pajak.
  `price_cart` **tidak punya argumen tender sama sekali**, jadi tidak ada
  fixture di sini yang bisa memvariasikan hal yang baris itu variasikan.
  Propertinya benar menurut bentuk kernel dan hanya dapat **diamati** di kasir.

---

## 5. Yang diadopsi (20)

Tes yang sudah mengunci skenarionya, diberi label `// Acceptance: XXX-000` di
`backend/crates/pricing-engine/src/tests.rs` (perubahan komentar saja — tidak
satu pun assertion atau angka disentuh; 154 tes tetap lulus).

| Baris | Tes yang memilikinya |
|---|---|
| E2E-001 | `golden_g01_zero_tax_cart` |
| E2E-002 | `golden_g02_inclusive_and_exclusive_agree` |
| E2E-003, TAX-010 | `golden_g03_ten_per_cent_tax_cart` |
| E2E-004, BXY-003 | `golden_g04_buy_two_get_one_with_leftover` |
| COM-001 | `best_price_is_the_cheapest_basket_not_the_first_offer_that_fits` |
| COM-005 | `an_exclusive_line_offer_leaves_the_rest_of_the_basket_alone` |
| COM-008 | `the_order_rules_arrive_in_changes_nothing` |
| COM-009 | `best_price_matches_an_exhaustive_oracle_over_generated_baskets` |
| PRP-006 | `best_price_matches_an_exhaustive_oracle_on_the_reviewers_case` |
| ELG-004 | `a_basket_threshold_is_measured_after_the_line_offers_have_come_off` |
| PRC-003 | `a_cleared_line_that_is_excluded_does_not_count_toward_the_threshold_either` |
| PRC-004 | `a_clearance_event_can_say_that_stacking_is_the_point` |
| PTS-003 | `the_earning_rate_is_chosen_per_line_not_for_the_whole_basket` |
| PTS-007 | `the_parts_of_an_award_always_come_to_the_whole` |
| TAX-001 | `an_inclusive_price_is_split_rather_than_grossed_up` |
| TAX-002 | `an_exclusive_price_has_the_tax_added_on_top` |
| RFD-001 | `refund.rs::a_partial_refund_goes_back_in_the_shape_it_arrived` |
| RFD-003 | `refund.rs::the_invariants_hold_across_a_sweep_of_partial_returns` |

`backend/src/refund.rs` tidak diberi label — berkas itu bukan milik saya.
Tautannya tetap diverifikasi: harness membaca berkasnya dan gagal bila nama
tesnya hilang.

---

## 6. Kondisi paket spesifikasi

Saya menyisir ketujuh dokumen paket dan fixtures JSON untuk mencari kontradiksi
internal, sesuai perintah `commercial-v1.md` §1 bahwa kontradiksi dicatat
sebagai **defect dokumentasi** dan tidak diselesaikan sendiri.

**Tidak ada kontradiksi angka dan tidak ada kontradiksi aturan.** Yang
diverifikasi:

- Seluruh G01–G05 di JSON direkonsiliasi dengan prosa rencana §4,
  `commercial-v1.md` §14, dan dokumen evidence §3 — cocok semua, dihitung ulang
  dengan aritmetika eksak.
- **INV-01…INV-16 identik karakter demi karakter** antara rencana §3 dan
  register keputusan.
- Seluruh hitungan yang diklaim benar: 200 baris; 183 P0 / 17 P1; UNIT 64 /
  INT 78 / PROP 18 / RACE 9 / FAULT 17 / E2E 13 / PERF 1; dan kedua puluh satu
  angka tabel per-prefix §5. Saya menghitungnya secara mekanis dari matriks.
- Konstanta yang dinyatakan di lebih dari satu tempat sepakat: TTL quote 5
  menit, deadline Best Price 2 detik, voucher pengganti 365 hari, G01 1.076 /
  G03 978.

Tiga ketidakkonsistenan kecil — **tidak satu pun mengubah nilai atau aturan**,
dilaporkan sebagai defect dokumentasi:

1. **Jadwal eksekusi §7 melewatkan kelompok CFG seluruhnya (10 kasus, 8 di
   antaranya P0).** Langkah 1–7 menyebut 20 dari 21 kelompok; CFG-001…010 tidak
   punya slot, sementara §9 mensyaratkan setiap P0 dalam scope rilis PASS.
   (`docs/commercial-v1-acceptance-test-plan.md:505` lawan `:170`)
2. **Satu metrik dinamai tiga cara.** "net Promotion Discount Spend" (plan:109)
   lawan "Discount Budget Used" (`commercial-v1.md:338`) lawan "Total Discount
   Budget usage" (plan:135). Nilainya benar; labelnya berbeda, sementara
   change-control:142 mensyaratkan *"satu interpretasi"*.
3. **Jumlah langkah reference run.** JSON `"steps_per_sequence": 8` (tepat 8)
   lawan plan:543 *"masing-masing sampai 8 tahap"* (hingga 8).

Satu hal untuk diputuskan, bukan kontradiksi: RFD-011 (P0) dan PRP-008 (P1)
menegaskan invariant konservasi uang yang sama (INV-14) pada prioritas berbeda.

**Catatan operasional:** `docs/` dan `docs/fixtures/` **belum di-track git**.
Harness membaca fixture saat berjalan, jadi berkas yang hilang menghentikan
suite dengan pesan yang menyebut path-nya — bukan error kompilasi tanpa
kalimat. Tetapi authority atas setiap angka uang di V1 saat ini hanya ada di
satu disk.

---

## 7. Apa yang harus dilakukan berikutnya

Tidak ada lagi baris yang dapat dijangkau harness ini tanpa database — semuanya
sudah ditulis. Urutan yang masuk akal dari sini:

1. **Empat cacat §3.** §3.3 dan §3.4 kemungkinan satu perbaikan (stable ID
   sebagai pemutus seri alokasi, bukan indeks baris). §3.1 dan §3.2 berdiri
   sendiri.
2. **Putuskan lima baris NO_KERNEL_SURFACE yang merupakan gap fitur** —
   alokasi charges per unit (D12), zero-due sale (D12), integer multiplier
   points (D02). Ketiganya keputusan terkunci yang kernelnya belum punya
   konsepnya; tidak ada tes yang dapat ditulis lebih dulu.
3. **Angkat pertanyaan CAM (§4.3)** ke pemilik: rencana mengasumsikan metrik
   campaign adalah kernel murni; estate menghitungnya di SQL. Salah satu dari
   keduanya harus bergerak sebelum ketujuh baris itu punya arti.
4. **Harness INT.** 78 baris INT adalah blok terbesar. Butuh Postgres uji dan
   SQLite uji; rencana §2 sudah menyebut bentuknya.
5. **FAULT dan RACE (26 baris, semua P0).** Butuh fault injection di boundary
   yang disebut dan barrier sungguhan. Rencana §2 eksplisit bahwa retry
   berurutan tidak cukup.

---

## 8. Berkas

| Berkas | Isi |
|---|---|
| `backend/tests/acceptance.rs` | harness: tipe skenario, runner, laporan, register cacat |
| `backend/tests/acceptance/plan.rs` | 200 baris rencana, ditranskripsi mekanis |
| `backend/tests/acceptance/fixtures.rs` | pemuat golden fixtures + pembangun fixture engine |
| `backend/tests/acceptance/pricing.rs` | skenario yang dijalankan ke `price_cart` |
| `backend/tests/acceptance/settlement.rs` | skenario yang dijalankan ke `tender` dan `refund` |

Verifikasi yang dijalankan:

- `cargo test --test acceptance` — lulus, mencetak laporan di atas.
- `cargo test -p pricing-engine` — **154 passed, 0 failed** (tidak berubah;
  suntingan saya di sana komentar saja).
- `cargo clippy --all-targets` — nol temuan di berkas milik saya; nol
  `unwrap()`/`expect()` telanjang.

  **Peringatan tentang perintah clippy itu.** `cargo clippy --all-targets`
  berhenti di *lib* dengan 3 error yang sudah ada sebelumnya (di
  `cloud/domain/leave/tests.rs`, `cloud/domain/pay/tests.rs`,
  `cloud/domain/overtime/tests.rs`, dan lainnya — 63 error total, semuanya
  `unwrap_used`/`expect_used` di berkas yang bukan milik saya). Karena lib
  gagal, **clippy tidak pernah sampai ke target tes sama sekali** — jadi "nol
  temuan di berkas saya" dari perintah polos itu tidak membuktikan apa pun.

  Berkas saya diverifikasi dengan dua cara lain: `cargo test --test acceptance
  --no-run` (rustc melintasinya penuh — nol warning), dan `cargo clippy
  --all-targets -- -A clippy::unwrap_used -A clippy::expect_used`, yang
  membiarkan lib lolos sehingga clippy benar-benar melint target tes — juga
  nol temuan.

  Ini layak diketahui di luar konteks harness ini: selama 63 error itu berdiri,
  **tidak ada target tes di repo yang sedang di-lint clippy sama sekali.**
