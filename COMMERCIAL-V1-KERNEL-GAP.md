> ## ⚠ Dokumen ini BUKAN otoritas — digantikan 12 September 2026
>
> Ditulis sebelum penulisnya tahu paket spesifikasi terkunci ada di
> [`docs/commercial-v1.md`](docs/commercial-v1.md). Paket itulah kontraknya:
> baseline 1.0, D01–D14, K01–K06, INV-01–16, UI-001, 200 skenario, dan
> `docs/fixtures/commercial-v1-golden-fixtures.json` untuk angka expected.
>
> Yang masih berguna di sini adalah **bukti verifikasi** — angka yang benar-benar
> dijalankan terhadap database dan node hidup, dengan tanggal dan perintahnya.
> Yang **tidak** boleh dipakai dari sini adalah pernyataan tentang apa aturannya:
> di mana pun dokumen ini berbeda dari paket `docs/`, paket yang benar dan ini
> yang salah.
>
> Register gap yang hidup sekarang:
> [`COMMERCIAL-V1-CONSISTENCY.md`](COMMERCIAL-V1-CONSISTENCY.md) untuk selisih
> kode-terhadap-baseline, dan [`ACCEPTANCE-COVERAGE.md`](ACCEPTANCE-COVERAGE.md)
> untuk cakupan 200 skenario.
>
> Tidak dihapus: beberapa baris di bawah adalah satu-satunya catatan bahwa suatu
> angka pernah dibuktikan hidup, dan membuang bukti untuk merapikan daftar adalah
> kebiasaan yang mahal.

# Commercial V1 — register lengkap: apa yang sudah ada, apa yang belum

Diperbarui 2026-09-12. Sumber: pembacaan langsung `backend/crates/pricing-engine`,
`backend/src/edge`, `backend/src/cloud`, dan skema `inventory_scale`.

Ini bukan rencana — rencana Commercial V1 sudah dikunci di tempat lain. Ini
catatan verifikasi atas SELURUH putaran diskusi: domain structure, checkout
kernel, enam poin ambiguitas, dan data model + state machine.

Tiap klaim punya rujukan berkas. Yang tidak diperiksa, ditulis tidak diperiksa.

---

## Temuan utama: mesin kita menghitung jauh lebih banyak daripada yang disimpan

Ini bukan daftar fitur yang kurang. Empat kali berturut-turut polanya sama —
**engine sudah memproduksi faktanya, lalu fakta itu hilang di batas
penyimpanan atau tidak pernah dibaca siapa pun**:

| Fakta | Dihitung | Dikirim | Disimpan | Dibaca |
|---|---|---|---|---|
| Alokasi diskon per baris | ✅ `apply_price_effect` | ✅ `"lines":[…]` | ✅ `edge_sale_promotion_line` | ❌ **0 baris, 0 pembaca** |
| Alasan promo ditolak | ✅ `rejected_rules` + `RejectionReason` | ❌ hanya `applied` yang dikirim | ❌ | ❌ |
| Jejak perhitungan harga | ✅ `pricing_trace_id` | ✅ | ⚠️ **id-nya saja — tidak ada tabel trace** | ❌ |
| Baris penjualan per unit fisik | ✅ | ✅ | ✅ PK `(sale_id, subject_id)` + `epc` | ❌ retur tidak memakainya |

Konsekuensinya: sebagian besar §8–§11 dan §19–§21 dokumen data model Anda
**bukan pekerjaan membangun, melainkan pekerjaan menyambungkan.**

---

## SUDAH DIKERJAKAN (12 Sep, setelah register ini ditulis)

| Butir | Apa yang berubah | Bukti |
|---|---|---|
| **D1** basis minimum spend | `check_conditions` dipecah: kuantitas + prune yang sah di pra-lintas, uang diukur ulang per skenario di `check_amount` | tes `a_basket_threshold_is_measured_after_the_line_offers_have_come_off` |
| **Urutan line→basket** | `application_order` menaruh rule basket setelah rule line, di depan priority | sama |
| **D2** Best Price non-greedy | pencarian mencoba himpunan stackable **minus satu**, O(n) bukan 2^n | tes `best_price_is_the_cheapest_basket_not_the_first_offer_that_fits` → 450.000 |
| **B2** alasan penolakan | `Scenario.lapsed` merekam rule yang berhenti memenuhi syarat; laporan tidak lagi bilang "kalah oleh tawaran lain" padahal ambangnya yang tak tercapai | sama |
| Alokasi basket ke line | dibuktikan dengan angka emas | tes `a_basket_discount_is_allocated_back_to_the_lines_it_came_off` → 20.333 / 29.667 |
| **Poin 4 reviewer** multiplier per-unit | tarif earning dipilih **per baris** dari rule yang eligible untuk baris itu, bukan satu pemenang untuk seluruh basket | tes `the_earning_rate_is_chosen_per_line_not_for_the_whole_basket`, `the_better_rate_wins_the_line_both_offers_reach` |
| **E1** lubang voucher | migrasi 0162 `voucher_authorization`; rute `authorize`/`commit`/`release`; kasir menolak tender Voucher tanpa otorisasi | tes `a_voucher_the_centre_has_not_authorised_cannot_settle_a_basket` + bukti langsung dua kasir |
| **Invariant 1 reviewer** | `available = balance − Σ hold terbuka`, dihitung di dalam `SELECT … FOR UPDATE` pada baris voucher | terbukti: kasir B ditolak *"0 available … the difference is held by another checkout"* |

| **C1** pajak | `TaxRule` di engine; `split_tax` per baris **setelah** diskon; `net_ex_tax` / `tax_total` / `amount_due` di hasil; dimuat ke snapshot pusat & kasir; disimpan di `sale_line`/`sale` (sqlite 0031) dan `edge_sale_line`/`edge_sale` (pg 0163); dikirim lewat payload sync | 6 tes termasuk properti 24 kombinasi harga×tarif |
| **Poin 5 reviewer** dasar poin | `EarnBasis` default diubah ke `PostDiscountNet` = **net setelah diskon, tanpa pajak** — aturan terkunci. Default lama (pra-diskon) tidak pernah jadi kebijakan | tes `points_are_earned_on_the_goods_not_on_the_tax` |

| **D03** arah priority | dibalik ke **ascending** (lebih rendah dulu), tie-break jadi daftar `(priority, id)` terurut terkecil secara leksikografis. Gratis: 17 dari 17 rule terbit punya priority 0, jadi tak satu pun berubah artinya | 116 tes lulus setelah dibalik |
| **G01 · G02 · G03** | dibekukan sebagai tes yang berjalan — angka rencana, dihitung independen | lulus percobaan pertama, termasuk 978 vs 1.076 |
| **G04** | dibekukan sebagai kontrak `#[ignore]` dengan alasan tertulis | dipaksa jalan: gagal di 400.000 vs 350.000 — celahnya nyata |
| **INV-04 / COM-009 / PRP-006** | **oracle brute-force independen** — mengenumerasi tiap subset, aritmetikanya ditulis terpisah, bukan memanggil engine | engine sepakat di **324 dari 324** keranjang |

| **D11 / G05 / K04** alokasi refund | modul murni `backend/src/refund.rs`: proporsional terhadap **sisa kapasitas**, floor + largest remainder, pecahan disimpan sebagai pasangan bilangan bulat (tanpa float). Migrasi 0164: `original_tender_seq`, `status`, `attempt_count`, `last_error`, `external_refund_id` + unique `(return_id, tender_seq)`. `create_sale_return` kini **menghitung** alokasi, tidak menerimanya dari pemanggil | 8 tes: G05 `[1,1,0,0]`, sapuan 6 bentuk × 7 pembagian membuktikan kelima invariant |

| **D01 / G04** Buy X Get Y | varian `Effect::BuyXGetY { buy, get, reward_bps }` baru; reward = N termurah, buyer = N termahal dari sisa, leftover tanpa alokasi; diskon dibagi proporsional ke peserta dengan largest remainder. G04 tidak lagi `#[ignore]` | 6 tes: G04 + grup lengkap, pengulangan grup, setengah harga, alokasi tak terbagi, plafon |
| **D02 / K02 / INV-08 / INV-10** points | migrasi 0165: `points_account`, `points_ledger` (partial unique per sebab), `loyalty_redemption`. Modul `cloud/postgres/loyalty.rs`: earn di titik **pusat menerima** penjualan (bukan di kasir), reversal boleh negatif, dan **Points→Voucher satu transaksi** dengan `issue_in_transaction` | bukti langsung: 2.000 poin → voucher, retry key sama mengembalikan voucher yang **sama**, penukaran ketiga ditolak, 1 redemption = 1 voucher |

| **D02** poin per baris | `EarnAward.line_points`, dialokasikan dengan largest remainder atas basis tiap baris; disimpan di `sale_line`/`edge_sale_line` (0166 + sqlite 0032) dan dibawa payload sync | G01 438/638 dan G03 398/580 — persis angka per-unit rencana |
| **Pajak dua implementasi — DIPERBAIKI** | `split_tax` saya menduplikasi `src/tax.rs` dan **sudah berbeda hasilnya** (6 rupiah @10%: 6/0 lawan 5/1). Pajak dikeluarkan jadi crate `retail-tax`; engine sekarang memanggilnya, backend me-re-export di path lama | 126 engine + 2 retail-tax lulus |
| **Alokasi refund menunjuk model penjualan yang salah — DIPERBAIKI** | membaca `edge_sale_tender`, padahal `sale_return.sale_id → sale` dan tendernya `sale_payment`. Akan menemukan nol tender untuk setiap retur nyata | FK sekarang `original_tender_id → sale_payment(id)` |
| **Markdown policy** | `MarkdownPolicy { Exclude (default), Allow }` di `Rule`. Baris ber-markdown keluar dari **match**, bukan dari benefit — jadi ia tidak dapat diskon **dan tidak ikut menghitung minimum spend**. Mengecualikan dari salah satunya saja membuat rule lolos ambang berkat barang yang lalu ia tolak | 5 tes + bukti hidup dua buku: EXCLUDE → promo ditolak, ALLOW → 10% dari 120.000 (harga markdown), bukan dari 200.000 |
| **Alasan penolakan markdown** | `RejectionReason::MarkdownExcluded` — *"it does not apply to goods already marked down"*. Sebelumnya `NOTHING_MATCHED` (*"nothing in the basket qualifies"*) padahal SKU yang disebut rule ada di keranjang; itu mengirim merchandiser mencari bug scope yang tidak ada | 2 tes memisahkan kedua sebab + bukti hidup `MARKDOWN_EXCLUDED` |
| **`EarnBasis` doc menyesatkan — DIPERBAIKI** | doc enum masih menerangkan default lama (`PostMarkdownPreDiscount`) setelah defaultnya dibalik ke `PostDiscountNet`. Doc itu ikut ter-generate ke TypeScript, jadi browser membaca aturan yang sudah bukan aturan | `EarnBasis.ts` sekarang menyebut aturan terkunci |
| **Form promosi menulis basis poin yang salah — DIPERBAIKI** | `rule-form.tsx` meng-hardcode `POST_MARKDOWN_PRE_DISCOUNT`. Tiap promosi yang diarang lewat browser melanggar aturan poin terkunci — dan tak ada yang menangkapnya karena nilainya sah | sekarang `POST_DISCOUNT_NET`, dengan alasan ditulis di tempatnya |
| **Simulate menjatuhkan pajak dan poin per baris — DIPERBAIKI** | `/commercial/simulate` membangun JSON dengan tangan dan tak pernah ikut tumbuh: `net_ex_tax`, `tax`, `amount_due`, `line_points` semua hilang di batas itu. Merchandiser yang menguji keranjang melihat total yang tak sama dengan struk kasir | bukti hidup: `net_ex_tax_minor` 108.109 + `tax_minor` 11.891 = 120.000 |
| **Barrel kontrak tidak ikut di-generate — DIPERBAIKI** | `make contract` hanya menjalankan ts-rs; `src/index.ts` ditulis `generate-index.mjs` yang tak pernah dipanggil. Akibatnya `TaxRule.ts` **ada**, `contract-check` bilang bersih, dan `import { TaxRule }` tetap gagal — tipe yang sudah seminggu dikirim server tapi tak bisa disebut browser mana pun | `make contract` sekarang dua langkah; barrel 433 → 435 tipe |
| **Clearance tak bisa diakhiri di pusat — DIPERBAIKI** | query markdown memfilter jendela waktu **di samping** `DISTINCT ON`, bukan sesudahnya. Buku baru yang menyatakan `md-X` berakhir dibuang oleh filter sebelum pick, lalu baris lama yang tanpa tanggal akhir bertahan dan menang — **markdown terbit tanpa `effective_to` tidak pernah bisa dihentikan**. Kasir tidak begitu: `INSERT OR REPLACE` per `markdown_id` membuat toko memegang baris buku terbaru berikut tanggalnya, jadi kasir menghormati penarikan sementara HO terus mendiskon | dibuktikan pada data yang sama: bentuk lama mengembalikan baris buku 25 (120.000, `effective_to` NULL), bentuk baru mengembalikan nol. Empat loader lain diperiksa — hanya markdown yang berbentuk begini |
| **C6** state machine checkout | modul murni `backend/src/checkout.rs` (`CheckoutState` FINALIZING→COMPLETED/VOIDED/FAILED, `TenderState` 5 kata sama dengan 0164, `advance`, `recovery`). Tabel kasir `checkout` + `checkout_tender` (sqlite 0033), **di-commit sebelum terminal kartu ditanya**. Empat rute: declare · outcome tender · resolve · daftar belum selesai. `complete_sale` menautkan checkout ke sale **dalam transaksi yang sama**, jadi keduanya tak pernah berbeda | 11 tes modul murni + 9 tes kasir sungguhan |
| **Kenapa ini lubang** | penjualan ditulis atomik dalam satu transaksi SQLite — **uangnya diambil di luar transaksi itu**. Terminal menjawab "approved" beberapa detik kemudian, baru sale ditulis. Mati di celah itu = pembeli tertagih, toko tak punya catatan apa pun. Bukan catatan salah — **tidak ada catatan**. `sale.status` adalah `CHECK (status = 'COMPLETED')`, jadi memang tak ada tempat menuliskannya | tes `the_attempt_is_on_disk_before_the_terminal_is_asked_for_anything` |
| **Eskalasi ke pusat** | fakta `checkout.unresolved` + tabel `edge_checkout_exception` (+ tender-nya) pg 0168. Dikirim **hanya** ketika orang di konter menutup checkout sebagai FAILED padahal tender sudah settle — satu-satunya hasil yang tak bisa diperbaiki toko sendiri. Z report toko **tetap balance** (uangnya memang ada), jadi tanpa ini hanya pelanggan yang tahu ada masalah. Membawa referensi acquirer, karena jumlah+toko+tanggal tidak cukup untuk menemukan satu transaksi dalam batch sehari | `resolution` OPEN/REFUNDED/RECOVERED_AS_SALE/WRITTEN_OFF; redelivery `DO NOTHING` agar kasus yang sudah ditutup pusat tidak dibuka lagi |
| **C7** status per tender — **separuh sudah, separuh tidak perlu** | `sale_return_payment` sudah punya `status`/`attempt_count`/`last_error`/`external_refund_id` sejak 0164 — pembedaan "retur diterima" vs "refund berhasil" sudah berfondasi. `edge_sale_tender.status` **tidak** saya tambahkan: tender pada sale yang COMPLETED menurut definisi SUCCEEDED, jadi kolom itu akan punya satu nilai dan nol penulis. Yang bermakna — percobaan yang gagal, kartu yang ditolak, uang tertahan — sekarang ada di `checkout_tender`, di mana percobaannya memang hidup | chargeback/settlement batch gagal belum ada produsennya; ditulis di sini daripada dibuatkan kolom kosong |
| **Antrian yang bisa dilihat** | layar Finance → *Charges without a sale* (`/finance/unmatched-charges`) + badge amber di sidebar. Dua rute pusat: daftar (dengan `open_count` dan `open_money_held_minor` dihitung server, bukan dijumlah browser atas halaman yang sedang tampil) dan jawab-satu-kasus. Tanpa ini, tabel 0168 hanyalah simpanan tanpa pembaca — pola yang register ini sendiri keluhkan | referensi acquirer ada di baris, bukan di balik klik: itu satu-satunya pegangan saat menelepon bank, dan menemukannya adalah seluruh pekerjaannya |
| **C5** kupon jadi objek, bukan penghitung | `coupon_set` (SHARED vs UNIQUE) · `coupon_code` dengan state ISSUED→**RESERVED**→REDEEMED · `coupon_redemption` per (kode, penjualan) · `coupon_authorization`. Trio hold/commit/release mengikuti bentuk voucher yang sudah disepakati estate — dua mekanisme hold untuk satu masalah adalah bug-nya | pg 0170. Bukti hidup: kasir A menahan → **kasir B ditolak** *"that coupon has been used already"* → A commit → kasir ketiga ditolak |
| **C10** tiga field konfigurasi sisanya | `ExclusiveScope` (Line/Basket — eksklusif hanya pada baris yang disentuh, bukan memblokir seluruh keranjang) · `PointsCombination` (compound/add/highest) · `Caps.max_uses_per_customer`. Default tiap-tiap dipilih agar **tak satu pun buku terbit berubah artinya**. Alasan tolak `CustomerLimitReached` menyebut sebabnya | engine 131 → **147 tes lulus**. Server dulu menolak limit-per-pelanggan dgn alasan "tak ada yang menghitung riwayat" — alasan itu memang sudah salah, `commercial_usage_customer` ada |
| **C11** campaign mendeklarasikan dirinya | `campaign_activity` · `campaign_scope` · `campaign_guardrail` + `campaign_guardrail_breach`. Scope **dideklarasikan**, bukan diturunkan dari scope rule — campaign yang rule-nya kebetulan menyebut enam toko bukan pernyataan yang sama dengan campaign yang dideklarasikan berjalan di enam toko | pg 0173/0174. Bukti hidup: plan langsung melaporkan **3 rule menunjuk campaign tanpa dideklarasikan**; rail DISCOUNT_RATE_BPS terbaca 926 vs batas 100 → campaign **benar-benar berhenti** (`status=PAUSED`), pelanggaran satu baris berdiri (`seen_count` naik) bukan baris baru tiap pemeriksaan |
| **Guardrail = rem di pusat, bukan gerbang di kasir** | konsisten dengan posisi estate soal `publish_commercial_usage_to_fleet`: tak ada kasir yang tahu apa yang dijual toko lain pagi ini. Angka yang tak boleh dilewati adalah angka di pusat | rail yang dimatikan tetap **dibaca** — angkanya tetap berguna — dan tak pernah dinyatakan dilanggar |
| **Catatan peran, bukan temuan** | `GET /api/v1/checkout-exceptions` terdaftar sebagai **Cashier**, dan itu bukan kelonggaran rute ini: `required_role` di `edge/domain/auth.rs` memberi **setiap GET** peran Cashier, termasuk seluruh `/finance` dan buku besar. Tulisannya (`/resolve`) Supervisor. Apakah kasir boleh melihat uang terutang se-armada adalah pertanyaan yang sah — tapi itu pertanyaan yang sama dengan apakah kasir boleh melihat GL, dan itu keputusan estate, bukan milik rute ini | 38 rute baru diberkati ke `tests/testdata/routes.json` |
| **D12** charges | `pricing_engine::Charge` di context (bukan snapshot — biaya kirim properti *pesanan ini*, bukan buku harga). Dipajaki pada kategorinya sendiri, dilaporkan terpisah: `charge_net_ex_tax` / `charge_tax_total` / `charge_total`, dan `amount_due = total + charge_total` | engine 147 → **154 tes**; + 3 tes kasir sungguhan |
| **Empat batasan charges, dikunci** | ① **tak ada promosi menjangkaunya** — termasuk aturan seluruh-keranjang, yang justru satu-satunya yang akan ② **tak menghitung minimum spend** — 450.000 barang + 60.000 ongkir bukan 510.000 bagi tawaran yang minta 500.000 ③ **tak menghasilkan poin** — aturan terkunci Anda: barang setelah diskon, sebelum pajak, **tanpa charges** ④ **dipajaki pada kategorinya sendiri**, dan kategori yang buku tak sebut dilaporkan tanpa pajak, bukan ditebak | penegakannya letak, bukan konvensi: charges dihitung **setelah** pencarian skenario, ambang dan pembagian poin selesai — atas `states` yang hanya berisi barang. Tak ada pintu lebih awal untuk memasukkannya |
| **Penyimpanan fee** | `sale_charge` (sqlite 0034) + `edge_sale_charge` (pg 0169), plus tiga kolom di baris sale agar Net Sales terbaca tanpa join. NULL bila tak ada — nol fee diambil dan tak ada fee ditawarkan itu fakta berbeda | `total_minor` tetap **barang** dan artinya tak bergeser sedikit pun; `paid − change` sekarang `total + charges` |
| **Cacat yang saya buat lalu perbaiki** | sempat menulis jumlah tertagih (barang + fee) ke `sale.total_minor` — persis penggabungan yang migrasinya sendiri larang. Tertangkap tes: `left: 170000, right: 150000` | `SaleResult` sekarang membawa `total_minor` · `charge_total_minor` · `amount_due_minor` terpisah, supaya pemanggil tak bisa mengira satu sebagai yang lain |
| **Tender diukur terhadap yang benar-benar terutang** | `validate_tenders(amount_due_minor, …)`, bukan terhadap barang saja | tes `a_till_will_not_settle_a_basket_while_the_delivery_is_unpaid` — kartu untuk barang saja ditolak. Tanpa ini kasir menyerahkan barang, ongkir tak tertagih, **dan laci tetap balance karena tak pernah ditanya** |
| **C12** Pricing Changes / History | rute `GET /commercial/price-history` + bagian *How it got here* di sheet Pricelist. Datanya **sudah ada dan tak bisa ditanya**: buku ber-versi dan imutabel, tak ada yang menghapus atau mengubahnya | bukti hidup SKU-0001-002 @ store-07: 219.000 perusahaan → 179.000 harga toko (−40.000) → 199.000 (+20.000), tiap baris menyebut bukunya dan penerbitnya. Cocok tepat dengan `commercial_price_rule` v15/v17/v21 |
| **Kenapa ini memutar ulang engine, bukan membaca baris** | daftar tiap baris harga yang pernah menyebut satu SKU **bukan** riwayat — sebagian besar tak pernah berlaku. Harga perusahaan Maret dikalahkan harga toko April lalu kembali Mei saat buku April kedaluwarsa, dan siapa yang menang tiap instan diputuskan engine. Menulis pendapat kedua di sini adalah kegagalan yang estate ini sudah alami sekali: kasir dan pusat memeringkat markdown berbeda lalu menyebut harga berbeda untuk baju yang sama | kumpulkan tiap instan yang **bisa** mengubah jawaban, harga satu-baris lewat `price_cart` di tiap instan, keluarkan baris hanya bila jawabannya benar-benar bergerak |
| **Dua keputusan kecil yang layak disebut** | `price_cart` dan bukan `resolve_price` — yang kedua hanya tahu buku harga dan **buta terhadap clearance**, padahal clearance yang paling sering menggerakkan harga rak. Dan promosi tak bisa masuk bukan karena disaring: `load_site_price_book` memuat harga dan markdown, tak pernah rule, jadi snapshot-nya memang tak punya | diskon keranjang adalah properti keranjang, bukan properti produk |

Tes: **126** pricing-engine (dari 100), **449** backend lib (dari 448). 19 kegagalan yang tersisa
tetap di `edge::zpl`, `edge::printing`, `cloud::http::assistant` — berkas yang tidak disentuh.

Dua butir ternyata **sudah benar** dan tidak perlu dikerjakan:

- **Poin 6 reviewer** (identitas kupon vs versi): hitungan kupon dibaca dari
  `commercial_usage` global di pusat DAN di kasir, bukan kolom `used` yang beku
  di buku. Ganti versi tidak mereset batas pakai.
- **Poin 3 reviewer** (`+500 points` sekali atau per unit): sudah dibedakan
  secara tipe — `FixedPoints` sekali per transaksi, `PointsPerQuantity` per unit.

---

## A. Sudah sama — jangan dibangun ulang

| Aturan V1 | Di mana |
|---|---|
| Urutan kernel: regular → markdown → line promo → basket promo → alokasi ke line | `engine.rs` `settle_lines` → `apply_price_effect` |
| Alokasi basket discount proporsional, sisa rupiah ke baris terakhir | `engine.rs` arm `Effect::Amount`: `capped.share_of(totals[i], basis)` |
| Markdown delta **bukan** promotion spend | dipisah struktural: `benefit_minor` vs `clearance_minor` |
| Best Price = terbaik untuk **seluruh basket**, bukan greedy per tahap | `engine.rs` ~917: `run_scenario(&stackable)` lalu tiap rule solo, `scenario.beats(&best)` |
| Combine punya urutan eksplisit & deterministik | `selection_order` = priority menurun, `rule_id` naik sebagai pemutus — bukan urutan pembuatan |
| Tie-break akhir: priority → stable id | sama, `selection_order` |
| Plafon per rule dipotong sebelum diterapkan | `engine.rs`, blok `if let Some(ceiling)` |
| Dua 10% bertumpuk = 20% | `Effect::Percent { compound }`, basis default `gross_total` |
| **Config versioned immutable** (§2 data model Anda) | price book kita persis itu: `commercial_publication` beku + `commercial_rule` per publikasi, "newest book wins" |
| **`sale_unit` per unit fisik** (§9 Anda) | `edge_sale_line` PK `(sale_id, subject_id)` + kolom `epc`. RFID membuat tiap unit punya barisnya sendiri — **retur 1 dari 3 kaus sudah terpecahkan secara struktural**, dan `sale_return_line` sudah membawa `subject_id` |
| Snapshot harga asal per baris | `edge_sale_line`: `base_unit_price_minor`, `markdown_id`, `unit_price_minor`, `price_source`, `publication_version` |
| Voucher = tender setelah Amount Due | `PaymentMethod::Voucher`, di luar engine |
| Voucher ledger + 6 field | `voucher(issued_minor, balance_minor, member_id, expires_at, status)` + `voucher_movement` |
| Voucher redeem atomic + idempotent **di pusat** | `cloud/postgres/vouchers.rs`: `lock_voucher` + `begin_idempotent` |
| Campaign Sales tidak menjumlahkan promo anak | `performance.rs` CTE `folded` — satu baris per (campaign, sale) |
| Campaign membaca execution, bukan config | `performance.rs` membaca `edge_sale*`, bukan price book |

---

## B. Dihitung tapi tidak tersambung — pekerjaan paling murah

**B1. `edge_sale_promotion_line` tidak dibaca siapa pun.**
Tabel `(sale_id, rule_id, subject_id, benefit_minor)` ada dan ditulis
(`cloud/postgres/sync.rs:5673`), isinya 0 baris, tidak ada pembaca.
`performance.rs` masih atribusi per KERANJANG — itu sebabnya Promo Sales kita
overstate. Menyambungkannya menutup §11 (discount allocation), memperbaiki
atribusi, **dan** membuka refund per baris sekaligus.

Catatan: komentar modul di `performance.rs` yang berbunyi *"which lines the rule
matched was never recorded"* **sudah basi** dan menyesatkan. Saya sendiri
tertipu olehnya dua kali dan melaporkan gap yang tidak ada.

**B2. `rejected_rules` tidak pernah disimpan.**
Engine menghasilkan alasan penolakan bertipe (`DisplacedByExclusiveRule`,
`AdvisoryOnly`, `AmountTooLow`, `WrongSite`, …). Kasir hanya mengirim promo yang
`applied`. Jadi §10 Anda — menjawab *"kenapa Promo Rp50k tidak dipakai?"* —
datanya sudah ada di memori dan dibuang sebelum meninggalkan kasir.

**B3. `pricing_trace_id` adalah id tanpa jejak.**
`edge_sale.pricing_trace_id` disimpan; tidak ada tabel trace di mana pun.

**B4. Retur tidak memakai model per-unit yang sudah ada.**
`sale_return_line` punya `subject_id` tapi hanya menyimpan
`quantity, refund_minor, restock` — nilai bersih per unit asal tidak dibaca dari
`edge_sale_line` + `edge_sale_promotion_line`, melainkan dikirim pemanggil.

---

## C. Belum ada sama sekali

**C1. Pajak tidak dihitung di mana pun.**
Engine membawa `tax_category` per baris dan berhenti. `edge_sale` tidak punya
kolom pajak: `total_minor, paid_minor, change_minor, discount_total_minor,
points_earned`. `commercial_tax_rule(tax_category, rate_bps, tax_inclusive)`
diterbitkan ke kasir dan tidak dipakai saat menjual.
→ §5 dan §23 Anda (`net_amount_ex_tax` / `tax_amount` / `total_inc_tax` per unit)
belum punya satu pun kolomnya. Selama ini belum ada, Net Sales tidak bisa
dibedakan dari Amount Due.

**C2. Points: hanya total per struk.**
`edge_sale.points_earned` ada. Tidak ada: `points_account`, `points_ledger`,
points per unit, aturan kombinasi multiplier, `loyalty_redemption`.
`member` cuma `member_id, display_name, joined_on, blocked_at, created_at`.

**C3. Points → Voucher: tidak ada.**

**C4. `voucher_authorization` tidak ada.** Tidak ada AUTHORIZED/COMMITTED/RELEASED.

**C5. Coupon: tidak ada `coupon_set` / `coupon_code` / `coupon_redemption`.**
Yang ada hanya PENGHITUNG: `commercial_usage.uses` dan
`commercial_usage_customer(kind, key, customer_id, uses)`. Tidak ada state
`RESERVED`, tidak ada catatan penukaran per (kode, penjualan), tidak ada
pembedaan SHARED vs UNIQUE.

**C6. State machine checkout tidak ada.**
`edge_sale` **tidak punya kolom status**. Sebuah penjualan tertulis atau tidak.
Tidak ada `FINALIZING` — jadi skenario Anda (kartu sukses, server mati sebelum
snapshot) tidak punya tempat untuk dicatat.

**C7. Status per tender tidak ada.**
`edge_sale_tender(sale_id, tender_seq, method, amount_minor, reference,
tender_id, acquirer, terminal_id, batch_no, card_kind)` — tanpa status.
Sama di `sale_return_payment`. → §21 (`refund_tender` PENDING/SUCCEEDED/FAILED)
dan pembedaan "retur diterima" vs "refund berhasil" belum punya fondasi.

**C8. Alokasi refund: tidak ada.** Tidak ada `refund_allocation`, tidak ada
proporsional, kumulatif, pembulatan largest-remainder, maupun plafon per tender.

**C9. Buy X Get Y ditolak saat publish.** `Effect::FreeItem` ada di engine dan
di-gate di `cloud/postgres/commercial.rs`. Aturan grouping / N termurah /
pengulangan / tie-break belum ada.

**C10. Empat field konfigurasi promotion tidak bisa dinyatakan:**
Markdown `Exclude`/`Allow` · Exclusive scope `Line`/`Basket` · Bonus points
combination · Limit per customer.
Yang terakhir menarik: server menolaknya dengan alasan *"tidak ada yang
menghitung riwayat pelanggan"* — **alasan itu sudah tidak benar**, tabel
`commercial_usage_customer` ada dengan unique `(kind, key, customer_id)`.

**C11. Campaign: `campaign_activity`, `campaign_scope`, `campaign_guardrail`.**
Rule menyebut campaign lewat `definition->>'campaign_id'`; scope diturunkan dari
scope rule, bukan dideklarasikan; guardrail belum ada. Target model 2 dari 5
(`Reach`, `Keep below`).

**C12. Pricing: tidak ada `Changes` / `History`.** Kita punya Pricelist; markdown
ada sebagai `commercial_markdown` dalam book.

---

## D. Divergensi angka — keputusan, bukan bug

**D1. Basis minimum spend.**
Rencana: *"setelah line discount, sebelum basket discount"*.
Kode: `engine.rs` `check_conditions` menjumlahkan `states[i].gross_total` —
setelah markdown, **sebelum** promosi baris.

Contoh reviewer (Rp600.000; A = 20% baris; B = Rp150.000 basket min Rp500.000):

| | Hasil |
|---|---:|
| Greedy A dulu | Rp480.000 |
| B saja (jawaban Best Price Anda) | **Rp450.000** |
| Engine kita hari ini | **Rp330.000** |

Satu transaksi, tiga angka. Harus diputuskan sebelum apa pun dibangun di atasnya.

**D2. Best Price belum mencoba subset.**
Engine membandingkan (semua stackable bersama) lawan (tiap non-stackable
sendirian). Tidak pernah "stackable tanpa A". Definisi final Anda — *lowest final
merchandise amount dari SELURUH valid outcome*, termasuk `Option 1 No promo` —
menuntut pencarian yang lebih luas. Sekarang belum menggigit karena D1; begitu D1
diperbaiki, ia muncul.

---

## E. Lubang yang aktif sekarang, bukan fitur yang belum dibuat

**E1. Kasir menerima voucher tanpa otorisasi apa pun.**
`complete_sale` menerima `PaymentMethod::Voucher` dengan `reference` string apa
pun — tanpa cek saldo, tanpa validasi kode, tanpa memanggil pusat. Lihat uji
`a_voucher_settles_a_basket_and_stays_out_of_the_drawer` di `edge/sqlite.rs`.
Dua kasir bisa menghabiskan voucher yang sama.

**E2. Kode kupon sekali-pakai tidak bisa dibuktikan terpakai sekali.**
Hanya penghitung, bukan catatan penukaran per (kode, penjualan).

Idempotency yang kita punya mencegah permintaan yang SAMA diproses dua kali. Ia
tidak mencegah dua transaksi BERBEDA memakai saldo yang sama.

---

## F. Konflik dengan UI yang sudah dibangun (11–12 Sep)

- **Kolom `Status` Promotion.** Rencana memintanya kembali (Draft·Scheduled·
  Active·Paused·Ended). Sudah dihapus atas permintaan pemilik karena ada switch;
  sekarang ada sebagai TAB. `Draft` tidak akan pernah muncul — daftar dibangun
  dari book yang sudah terbit.
- **Chart.** Rencana: bar chart. Yang ada: combo garis + batang.
- **Menu Commercial.** Rencana: Overview · Pricing · Campaigns · Promotions ·
  Vouchers. Yang ada: Pricelist · Promotions · Campaign · Vouchers (tanpa
  Overview; "Pricing" bernama "Pricelist").

---

## Yang tidak diperiksa

- Apakah `commercial_tax_rule` dipakai di jalur selain penjualan.
- Perilaku `Effect::FreeItem` di dalam engine (ada, tapi tidak bisa diterbitkan).
- Apakah `edge_sale_promotion_line` pernah terisi di luar `inventory_scale`.
- Repo pembanding `~/Documents/fresh` dan `~/Documents/retail/internal` hanya
  dibaca strukturnya dan header modulnya, bukan implementasinya baris per baris.

---

## Urutan yang masuk akal dari kondisi ini

1. **E1** — tutup lubang voucher. Cacat aktif, bukan fitur kurang.
2. **D1** — putuskan basis minimum spend. Satu keputusan, tiga angka.
3. **B1** — sambungkan `edge_sale_promotion_line`. Satu pekerjaan, membuka
   atribusi per baris + refund per baris + memperbaiki overstatement Promo Sales.
4. **C1** — pajak. Tanpa ini Net Sales ≠ Amount Due tidak bisa dinyatakan.
5. **C7 + C8** — status per tender, lalu alokasi refund kumulatif.
6. **C2/C3** — points dari nol, lalu Points → Voucher.
7. **C5** — coupon set/code/redemption dengan state RESERVED.
8. **C6** — state machine checkout.

Butir 1–3 tidak butuh keputusan produk baru. Butir 4 ke bawah butuh.

---

## Prior art yang relevan (hanya struktur yang diperiksa)

- `~/Documents/fresh` — Rust, bahasa yang sama. `crates/promotion-allowance`
  (7.888 baris, 127 tes, "ratified 2026-07-28") memisahkan Cloud authority yang
  *fallible* dari Store admission yang *total* — menjawab E1 dan aturan offline.
  `crates/points-domain` (6.059 baris, 86 tes) punya `live_authority.rs`
  ("tidak pernah menerima saldo cache dari POS") dan `reversal.rs` dengan
  `RedemptionSnapshot` imutabel + grace window wajib — menjawab C2/C3.
  Keduanya pure domain: tanpa jam, I/O, database, HTTP — bisa diangkat jadi
  crate di workspace kita.
- `~/Documents/retail/internal` — Go, produk lain (`retailos/backbone`).
  Nilainya dibaca, bukan dipakai ulang: `checkoutbenefits` memodelkan voucher &
  points redemption sebagai `external_benefit` terpisah dari `commercial_effect`
  dengan `EarnTreatment` retain/reduce/suppress; `returnpolicy` memakai
  `CreditNetPaid` = harga terbayar imutabel.
- **Alokasi refund tender campuran tidak dijawab oleh keduanya** — itu pekerjaan
  baru di mana pun.
