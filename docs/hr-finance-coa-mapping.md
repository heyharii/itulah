# HR ↔ Finance: peta akun 267 yang belum tersambung

**Tanggal cek:** 25 September 2026  
**Database:** dev lokal (migrasi `0364` sudah diterapkan)  
**Pertanyaan:** apakah HR sudah tersambung ke Finance, dan akun 267 mana yang
harus dipakai?

## Jawaban singkat

Penulis jurnalnya sudah ada. Yang belum ada adalah **petanya**.

Di `account_map`, satu-satunya makna HR yang sudah terpasang adalah:

| semantic_key | account | site |
|---|---|---|
| `payroll_payable` | `2017` Biaya Gaji dan Upah YMHD | 14 site |

Semua makna HR lain **nol baris**:

- `payroll_expense`
- `payroll_bpjs`
- `employee_expense`
- `employee_claim_payable`
- `advance` (dan `advance_purchase`)
- `petty_cash`
- `store_manager_receivable`
- `pph21_payable`, `pph25_credit`

Akibatnya:

| Operasi | Status |
|---|---|
| Payroll handover | **Gagal** — `payroll_expense` tidak punya peta, jadi `poster::post` menolak dan transaksi rollback |
| Claim approve | **Gagal** — `employee_expense` / `employee_claim_payable` tidak punya peta; kode dinamis di `claims.rs` malah menunjuk `6010210014` yang sudah nonaktif |
| Claim payout | **Gagal** — `petty_cash` tidak punya peta |
| Full & Final settle | **Gagal** — `employee_claim_payable` dan `petty_cash` tidak punya peta |
| Advance employee | **Gagal** — `advance` tidak punya peta |
| Payroll payout lewat manajer | **Gagal** — `store_manager_receivable` tidak punya peta (walaupun `payroll_payable` sudah ada) |
| BPJS / PPh 21 | **Belum dihitung**, jadi belum ada baris untuk dipetakan |

Penyebabnya: migrasi `0351` dan `0348` mematikan akun lama (`6201`, `2301`,
`6010210014`, `1403`, dst.) lalu menghapus mapping yang menunjuk akun nonaktif.
Mapping HR tidak dipasang ulang ke daun 267.

## Peta yang saya usulkan

### Aman, tidak perlu akun baru

| semantic_key | scope | akun 267 | catatan |
|---|---|---|---|
| `payroll_payable` | semua site | `2017` | sudah ada; pertahankan |
| `payroll_expense` | store-01..13 | `6012` Biaya Gaji Karyawan | beban penjualan |
| `payroll_expense` | dc/ho | `6026` Biaya Gaji Pegawai | beban pegawai |
| `payroll_bpjs` | store-01..13 | `6017` Biaya Asuransi Pegawai / BPJS | nanti, saat BPJS dihitung |
| `payroll_bpjs` | dc/ho | `6031` Biaya Asuransi Pegawai / BPJS | nanti |
| `petty_cash` | semua site | `1003` PETTY CASH | dipakai claim payout dan F&F |
| `advance` | qualifier `ADVANCED_TRAVELLING` | `1051` | |
| `advance` | qualifier `ADVANCED_PURCHASE` | `1052` | |
| `advance` | qualifier `ADVANCED_TO_CONTRACTORS` | `1053` | |
| `advance` | qualifier `ADVANCED_OTHERS` | `1054` | |
| `advance_purchase` | semua site | `1052` | |
| `store_manager_receivable` | semua site | `1023` PIUTANG KEPALA TOKO | untuk payroll payout lewat manajer |
| `pph21_payable` | semua site | `2011` Hutang Pajak PPh 21 | nanti, saat PPh 21 dihitung |
| `pph25_credit` | semua site | `1046` Prepaid - PPh Pasal 25 | nanti |
| `prepaid_pph21` (bila ada) | semua site | `1045` Prepaid - PPh Pasal 21 | nanti |

### Butuh keputusan Finance/owner

Dua makna ini tidak punya daun yang benar-benar cocok di 267:

| semantic_key | masalah | opsi |
|---|---|---|
| `employee_expense` | 267 tidak punya daun "Biaya Klaim Karyawan" yang aktif | **Sudah dipilih:** `6076 Biaya Klaim Karyawan` di bawah `6025`, dengan tipe spesifik tetap ke `6016/6030/6047/6048/6041/6044` |
| `employee_claim_payable` | 267 tidak punya "Hutang Klaim Karyawan" | **Sudah dipilih:** `2049 Hutang Klaim Karyawan` di bawah `2016` |

Rekomendasi saya: pilih **A** untuk keduanya. Kalau memakai `2017` dan `6026`
apa adanya, laporan gaji dan laporan klaim akan bercampur di satu akun yang
sama, dan suatu hari rekonsiliasi payroll akan menghitung reimbursement sebagai
gaji.

## Perubahan kode yang menyertai

1. **Migrasi baru** `0367`:
   - pasang `account_map` untuk tabel "aman" di atas;
   - daun `6076` dan `2049` sudah ditambahkan oleh `0372`;
   - isi kategori `line_category` bila diperlukan (`advance_purpose`,
     `accrual_kind`).

2. **`backend/src/cloud/postgres/claims.rs`**:
   - kode dinamis yang meng-insert `employee_expense` ke `6010210014` harus
     diubah ke akun aktif (atau dihapus dan diganti migrasi mapping per tipe).

3. **`backend/src/cloud/postgres/ledger.rs`**:
   - `required_semantic_keys()` masih menyebut akun lama (`6201`, `2301`,
     `6010210014`). Hint-nya perlu diarahkan ke daun 267 supaya halaman Account
     Map tidak menyuruh orang memetakan ke akun nonaktif.

4. **`poster::post` BPJS/PPh 21**:
   - belum ada penulisnya. Mapping saja tidak cukup; perhitungan PPh 21/BPJS
     harus ada dulu supaya barisnya bisa dipetakan.

## Urutan yang saya sarankan

1. Pasang mapping aman + perbaiki `claims.rs` → payroll handover, claim
   approve/payout, advance, dan F&F mulai bisa berjalan.
2. Daun klaim (`6076`, `2049`) sudah dipilih; tidak ada keputusan tersisa.
3. Baru kerjakan perhitungan BPJS/PPh 21 dan mapping pajaknya.

## Yang sudah ditambahkan

Migrasi `0372_hr_claims_get_their_own_accounts.sql` menambahkan:

- `2049 Hutang Klaim Karyawan` di bawah `2016 ACCRUED EXPENSE`;
- `6076 Biaya Klaim Karyawan` di bawah `6025 BEBAN PEGAWAI`;
- memindahkan `employee_claim_payable` dari `2031 Hutang Lain - Lain` ke `2049`;
- memindahkan klaim umum dari `6064 Miscellaneous Expences` ke `6076`.

`claims.rs` juga diubah supaya tipe klaim baru yang tidak cocok dengan akun
spesifik memakai `6076`, bukan `6064`. Tipe yang sudah spesifik tetap ke daun
masing-masing (kesehatan `6016/6030`, perjalanan `6047`, transport `6048`,
ATK `6041`, telepon `6044`, makan `6014/6028`).
