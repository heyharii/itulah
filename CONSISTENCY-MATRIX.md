# Matriks konsistensi — setiap aturan data, dan di mana ia dijaga

**Tanggal:** 26 Sep 2026 · **Status:** hidup — ubah bersama kode yang mengubah penjagaan aturan

Data konsisten kalau aturannya **dipaksakan saat data ditulis**. Mengecek setelahnya
hanya jaring pengaman. Dokumen ini menjawab satu pertanyaan per aturan: *kalau ada
yang melanggar, apa yang menghentikannya?*

| Tingkat | Arti | Kekuatan |
|---|---|---|
| **DB** | `CHECK`, FK, unique index, trigger, constraint trigger | Menahan semua penulis, termasuk script seed, migrasi, dan penulis kedua yang belum ada |
| **Rust** | Satu fungsi penulis (poster, stock ledger, loyalty, …) | Menahan jalur API saja. Script SQL, migrasi, dan fungsi lain yang menulis tabel yang sama akan lolos |
| **Cek** | Invariant di `backend/invariants/` (ditandai `id`) | Tidak menahan apa pun; hanya **menemukan** pelanggaran setelah terjadi |
| **Test** | Hanya di test | Membuktikan jalur yang dites. Jalur lain tidak dijaga |
| **—** | Tidak di mana pun | |

Penjaga yang ada:
- **Katalog invariant**, `backend/invariants/**/*.sql`. Sudah 35 aturan. Runner-nya `scripts/check-invariants.py`, dan katalognya dijaga oleh `backend/tests/invariant_catalogue.rs`.
- **Balapan (race)**, `backend/tests/consistency_under_concurrency.rs`. Test untuk jalur yang aman berjalan normal; untuk jalur yang masih bolong, test-nya berisi perilaku yang *seharusnya* dan diberi `#[ignore]` sampai diperbaiki.

---

## 1. Finance (buku besar)

HO = site `dc`. Guard membandingkan literal `'dc'`, bukan `site.kind`.

| Aturan | Dijaga di | Cek |
|---|---|---|
| Entry seimbang, header = baris (I3) | **DB**: constraint trigger `journal_entry_balances` / `journal_line_balances` (0051). **Rust**: `poster::check_balanced` | `finance.entry_balances` |
| Setiap site seimbang di bukunya sendiri (I3) | **DB**: `journal_line_balances_per_site` (0120; hanya INSERT, baris sebelum 0120 tidak divalidasi ulang). **Rust**: `poster::balanced_per_site` | `finance.site_balances` |
| Jurnal append-only | **DB**: trigger `journal_*_append_only` (0051). Pernah dimatikan sementara oleh migrasi 0083/0140/0244/0248/0254 | — |
| Reversal = cermin persis entry aslinya | **Rust**: `poster::reverse` menyalin baris. **DB**: hanya `UNIQUE reversal_of` | `finance.reversal_mirrors` |
| Satu entry per dokumen per langkah | **DB**: `ux_journal_entry_source_purpose` (0140) | — (index tidak bisa di-bypass) |
| Periode terbuka; SOFT_CLOSED hanya menerima jenis koreksi | **DB**: trigger `journal_entry_period_open`, fungsi `assert_period_open` (versi terakhir 0283) | `finance.period_discipline` |
| Akun heading tidak bisa diposting | **DB**: CHECK `is_group = false` + FK komposit | `finance.no_postings_on_retired_accounts` |
| Akun pensiun tidak bisa diposting | **Rust saja**: `ledger::assert_postable`. Reversal sengaja melewatinya (membalik yang dulu sah) | `finance.no_postings_on_retired_accounts` |
| BLOCKED / AUTO_ONLY / `manual_je_policy` | **Rust saja**: `validate_account_posting`. Saat ini tidak berpengaruh, karena semua 263 leaf aktif MANUAL/YES | — |
| `account_source_rule`: 1004 hanya CASH_SHIFT/OPENING (I6), 1110 hanya manual (I12), 3004 (P21) | **Rust saja**: `validate_account_posting`. Tidak ada trigger yang membaca tabel ini | `finance.source_rules` |
| Hutang supplier/pinjaman hanya di HO (I4) | **DB**: trigger `journal_line_external_party_is_head_office` (0376/0380; OPENING dikecualikan). **Rust**: `dimension='company'` | `finance.external_party_at_head_office` |
| Semua akun `dimension='company'` hanya di HO | **Rust saja** untuk 1016, 1017, 1018, 2033, 6002. DB hanya menjaga subset registry | `finance.company_accounts_at_head_office` |
| Sisi afiliasi: HO = piutang 1057/1058/1059, unit = hutang 2028/2029/2030 (I7) | **Hanya data** (`account_map` per site). **Tidak ada yang menolak baris yang menyebut akun langsung** | `finance.affiliate_side` · gap **G1** |
| Lawan afiliasi selalu HO ↔ unit, tidak pernah unit ↔ unit (I8) | Hanya perilaku balancer. **Tidak ada penolakan** | `finance.affiliate_counter_site` · gap **G1** |
| Akun `requires_counter_site` harus menyebut lawan | **Rust saja** (hanya memeriksa ada tidaknya) | `finance.counter_site_named` |
| Saldo antar-unit saling menghapus (I7) | Hanya checklist tutup buku (`finance_control` INTERUNIT_NETS) | `finance.interunit_nets_to_zero` |
| Laba ditahan 3003 tidak ditulis otomatis (I10) | **—** | `finance.retained_earnings_derived` · gap **G5** |
| Biaya bank ≠ bunga bank (I11) | **—** | `finance.bank_charge_is_not_interest` |
| `account_map` menunjuk leaf aktif (I9) | FK untuk heading. Aktif hanya dijaga DO-block sekali jalan (0364–0380) dan Rust | `finance.map_points_at_live_leaves` |
| Chart = 263 leaf aktif (P1) | **—** | `finance.chart_is_the_clients` |
| Budget STOP tidak terlampaui | **Rust**: `poster::enforce_budgets`, tanpa lock (race **R1**) | `finance.stop_budgets_hold` |
| Kategori baris cocok dengan akun | **DB**: trigger `journal_line_category_fits` (0288) | — |
| Baris bank menyebut rekening bank yang benar | **DB**: FK komposit (0308) | — |

## 2. Stok, costing, sync

| Aturan | Dijaga di | Cek |
|---|---|---|
| `inventory_projection` = lipatan `movement` | **Rust**: penulis tunggal `movements::refresh_projection_positions` dalam transaksi yang sama. Rebuild `control::run_repost` | `stock.projection_matches_movements` |
| Tidak pernah negatif; satu UNIT (EPC) hanya di satu tempat | **Rust**: `movements::apply_line` (FOR UPDATE subject). DB hanya menjaga isi projection | `stock.never_negative` |
| Posisi toko di pusat = lipatan fakta toko | **Rust**: `sync::apply_fact_position_delta`. **Tidak ada fungsi rebuild atau pembanding** | `stock.edge_position_matches_facts` |
| `qty_after` / `stock_value_after` = running sum | **Rust**: semua penulis mengambil `lock_article_basis`, **kecuali unwind** (bug **S1**) | `stock.ledger_running_totals` |
| Layer tidak keluar melebihi yang masuk | **Rust**: `read_queue` (FOR UPDATE + advisory lock). `cost_layer_remaining` hanya view | `stock.cost_layers_hold` |
| Satu RECEIPT per layer | **Rust**: `cost_layer_create` penulis tunggal | `stock.layer_has_one_receipt` |
| Outflow bernilai punya jurnal; receipt/transfer tidak | **Rust**: jurnal diposting sebelum baris ditulis | `stock.outflow_has_journal` |
| Nilai stok = saldo GL persediaan (satu perusahaan) | Checker HTTP saja. Registry `stock.value_vs_gl` hanya placeholder yang **tidak pernah didaftarkan** (**S5**) | `stock.ledger_value_matches_gl` |
| Serial EPC tidak dipakai ulang | **Rust**: `allocate_serials` FOR UPDATE. DB tidak mencegah rentang tumpang tindih | `stock.epc_serials_never_reused` |
| Ingest idempoten | **DB**: PK (origin, generation, seq) + `UNIQUE event_id`. **Rust**: watermark FOR UPDATE | test `an_upload_delivered_twice_at_once_lands_once` |
| `applied_seq ≤ durable_seq` | **Rust**: `apply_one` | `sync.applied_not_ahead_of_durable`, `sync.movement_facts_applied` |
| Nomor PO tidak dobel (0385) | **Rust**: upsert counter dalam transaksi. **DB**: `UNIQUE po_number` | `sync.po_counter_not_behind` |

## 3. Commercial (poin, voucher, promo)

| Aturan | Dijaga di | Cek |
|---|---|---|
| Saldo poin = jumlah ledger poin | **Rust**: `loyalty::append` di bawah `lock_account` (UPDATE atomik) | `commercial.points_balance_is_ledger` |
| Redemption mengambil poin tepat sekali | **DB**: partial unique (0165). **Rust**: satu transaksi | `commercial.redemption_matches_points` |
| Saldo voucher = jumlah movement | **DB**: trigger `voucher_movement_consistency` (0090, hanya saat INSERT movement) | `commercial.voucher_balance_is_movements` |
| Hold voucher ≤ saldo | **Rust**: `authorize_voucher`. **Tidak dijaga oleh `redeem_voucher`** (gap **G3**) | `commercial.voucher_holds_within_balance` |
| Pemakaian promo = fakta penjualan | **Rust**: `apply_sale` penulis tunggal. **Tidak ada rebuild** | `commercial.usage_matches_sale_facts` |
| Pembagian limit promo per toko ≤ limit (0387) | Kernel murni `split::rebalance` saja. `rebalance_allocations` tanpa lock (race **R2**) | `commercial.cap_grants_within_limit` |
| Kupon sekali pakai hanya sekali | **DB**: partial unique + trigger (0170) | — |

---

## 4. Balapan: dua request di detik yang sama

Isolasi DB READ COMMITTED; tidak ada `SERIALIZABLE` di mana pun.

| Jalur | Verdict | Mekanisme | Test |
|---|---|---|---|
| Unit terakhir dijual dua kali | **Aman** | advisory lock per artikel + layer FOR UPDATE | `the_last_unit_is_sold_once` |
| Gift card dipakai dua kasir | **Aman** | voucher FOR UPDATE | `a_gift_card_is_spent_once` |
| Poin dipakai dua layar | **Aman** | points_account FOR UPDATE | `points_are_never_overspent` |
| Nomor jurnal | **Aman** | sequence + UNIQUE | `journals_posted_together_are_numbered_apart` |
| Tutup buku saat ada posting | **Aman** | trigger FOR SHARE vs UPDATE status | `a_month_closes_between_postings_never_through_one` |
| Upload sync dobel bersamaan | **Aman** | watermark FOR UPDATE | `an_upload_delivered_twice_at_once_lands_once` |
| Nomor PO | **Aman** | satu upsert + UNIQUE | — |
| **R1** Budget STOP | **BOLONG** | `enforce_budgets` menjumlah tanpa lock: dua posting yang masing-masing di bawah batas bersama-sama melewatinya | `a_stop_budget_holds_against_two_postings_at_once` (ignored) |
| **R2** Split limit promo | **BOLONG** | Dua rebalance dengan snapshot berbeda, dan `GREATEST` menyimpan keduanya. Contoh: limit 1.000.000 terbagi 1.166.666 | `a_split_limit_is_never_over_granted` (ignored) |
| **R3** Satu redeem request aktif per member | **BOLONG** (kecil) | SELECT autocommit lalu INSERT, tanpa lock/partial unique. Poin tetap tidak bisa negatif | `a_member_has_one_live_redeem_request` (ignored) |
| **D1** Checklist tutup buku | Lemah | `period_checklist` berjalan di luar transaksi close; entry yang masuk di sela-selanya tertutup tanpa dicek | — |
| **D2** Deadlock | Mungkin | Sales day mengunci artikel tanpa `ORDER BY`. `commit_voucher_hold` dan `…_for_fact` mengunci voucher/otorisasi dalam urutan terbalik. Hasilnya 40P01 → 500 (tidak ada data rusak) | — |
| **D3** `MAX+1` tanpa lock | Aman tapi kasar | segments, saved_reports, assets, assistant, `ensure_leaf`: yang kalah dapat 23505 → **500**, bukan 409 | — |

## 5. Celah dan bug yang ditemukan

| ID | Apa | Di mana | Saran perbaikan |
|---|---|---|---|
| **G1** | Akun afiliasi di sisi yang salah (1057 di toko, 2028 di HO) dan unit ↔ unit **diterima**. Fixture `posting_matrix` mengharapkan REFUSE, tapi tidak ada kode yang menolaknya | `ledger::validate_account_posting` | Trigger DB di `journal_line` seperti 0376: 1057/1058/1059 ⇒ `site_id='dc'` dan counter = unit; 2028/2029/2030 ⇒ `site_id<>'dc'` dan counter = `dc` |
| **G2** | Akun pensiun, BLOCKED, dan `account_source_rule` hanya dijaga Rust | ledger.rs | Trigger yang membaca `ledger_account.is_active` dan `account_source_rule` (kecualikan REVERSAL/OPENING) |
| **G3** | `redeem_voucher` mengabaikan hold aktif; hold itu nanti ditolak saat commit dan stream sync toko tersumbat | vouchers.rs:~900 | Bandingkan dengan `available_minor` (saldo − hold), seperti `authorize_voucher` |
| **G5** | Tidak ada yang menolak posting otomatis ke 3003 | — | `account_source_rule` ALLOW untuk 3003 (MANUAL, RECLASS, ADJUSTMENT, OPENING) |
| **G6** | Rust dan DB berbeda sikap soal OPENING di akun company: DB mengizinkan di unit, Rust menolak | 0376 vs ledger.rs:3336 | Owner memutuskan salah satu, lalu samakan |
| **G7** | Trigger party 0300 **tidak mungkin menyala**: menguji `category_family IN ('RECEIVABLE','PAYABLE')`, padahal CHECK kolom itu `^[a-z]…` | 0300 / 0288 | Perbaiki kondisi atau hapus triggernya |
| **G8** | `account_map` → leaf aktif hanya dicek oleh DO-block migrasi. Mempensiunkan akun yang sudah dipetakan tidak dicegah | — | Trigger di `ledger_account` UPDATE `is_active` |
| **S1** | Unwind COGS (`sales_posting_unconsume_cost`) menulis stock ledger tanpa lock artikel, dan `qty_after` diambil dari baris asli, bukan posisi saat ini. Running total bisa rusak | sales_posting.rs:~1693 | `lock_article_basis` + `running_position` seperti penulis lain |
| **S2** | Stok kurang **membatalkan** sales day, padahal owner memutuskan "short stock never stops the sales day". `Insufficient` → `Conflict`, sedangkan fallback hanya menangkap `Validation` | sales_posting.rs:~1632 + stock_ledger.rs:454 | Tangkap `Conflict` dari `Insufficient` juga, atau petakan ke `Validation` |
| **S3** | CHECK `price_rule_names_one_level` hilang (ter-drop bersama kolom `tier` di 0080). Diverifikasi: tidak ada di DB 0387 | 0033/0080 | Tambahkan lagi |
| **S4** | Snapshot memakai `stock = on_hand + allotted + missing`, padahal dokumen bilang `stock + shortfall = …`. Snapshot dengan shortfall ditolak | 0012 / `sync/inventory.rs` | Samakan dengan dokumen |
| **S5** | Cek integritas `stock.quantity_position` & `stock.value_vs_gl` hanya placeholder, tidak pernah didaftarkan | integrity.rs:1547 | Daftarkan, atau panggil katalog ini |
| **S6** | `edge_inventory_fact_position`, `commercial_usage`, dan running total stock ledger tidak punya fungsi rebuild | — | Rebuild dari fakta, dengan query cek di katalog sebagai spesifikasinya |
| **B1** | Tabel `budget` dibaca poster, tapi **tidak ada penulis** di Rust: budget hanya bisa diisi lewat SQL | — | Endpoint Finance HO untuk menetapkan budget |
| **B2** | `SUM(bigint)` di Postgres bernilai `numeric`, dan `numeric` tidak bisa di-decode ke `i64`. Akibatnya **setiap posting yang terkena budget STOP gagal 500** ("database operation failed"); tidak ada test yang pernah menyentuhnya. **Sudah diperbaiki** di `poster::enforce_budgets` (`::bigint`). Pola yang sama masih ada di `exit.rs:385` dan `:406` (hitungan uang muka dan klaim saat karyawan keluar); file itu belum di-commit dan sedang ditulis lane lain | poster.rs, exit.rs | Tambahkan `::bigint` di `exit.rs` |
| **Q1** | Script seed menulis SQL langsung: `COPY edge_sale_promotion`, `DELETE`/`INSERT commercial_usage`, fakta edge buatan. Data seed melanggar invariant yang dijaga penulis asli | `scripts/seed-*.py` | Seed lewat API atau `crates/sim`. Jalankan `check-invariants.py` sesudah setiap seed |

Catatan: `sales_posting.rs`, `vouchers.rs`, `loyalty.rs`, `period_close.rs`, dan `cap_allocation.rs`
sedang diedit session lain saat dokumen ini ditulis. Perbaikan S1/S2/G3/R2/R3 harus
dikoordinasikan dengan lane itu.

## 6. Temuan di database lokal (26 Sep 2026)

| DB (migrasi) | Temuan | Sebab |
|---|---|---|
| `inventory_marketing_dogfood`, `inventory_perf_big2` (383–384) | 4 baris VOUCHER_ISSUE di periode terbuka duduk di akun **6101/2401 yang sudah pensiun** | Migrasi chart mempensiunkan akun tanpa memindahkan baris di periode yang masih terbuka |
| sama | `commercial_usage` ≠ fakta penjualan (DOGCOUPON: 23.106 fakta vs 6 terhitung) | Q1: fakta di-`COPY`, pemakaian dihitung ulang manual |
| sama | Posisi toko −1 di `store-07.floor` | Q1: fakta penjualan unit yang tidak pernah masuk lewat fakta |
| `inventory_e2e` (298) | 2.032 baris projection di tempat non-company (`external/customer`) | Data dari kode lama sebelum projection dibatasi ke tempat company |
| semua DB lama | Jumlah akun aktif ≠ 263 | Level migrasi berbeda; wajar |

## 7. Cara menjalankan

```bash
# semua aturan, read-only, aman di produksi
python3 scripts/check-invariants.py --db "$DATABASE_URL" --json hasil.json

# buktikan setiap pemeriksa bisa merah (lokal saja, selalu di-rollback)
python3 scripts/check-invariants.py --db postgresql:///nama_db --mutation-check

# katalog tetap sesuai skema dan tidak buta
cd backend && cargo test --test invariant_catalogue

# balapan: yang aman harus hijau; yang bolong dijalankan dengan --ignored
cd backend && cargo test --test consistency_under_concurrency
cd backend && cargo test --test consistency_under_concurrency -- --ignored
```

Kapan dijalankan: di CI (test di atas), sesudah `seed-everything.sh`, sesudah migrasi di
clone, dan tiap malam di produksi (runner read-only, `--fail-on high`).
