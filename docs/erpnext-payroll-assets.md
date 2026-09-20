# ERPNext: alur HR/payroll dan alur aset → finance

**Tanggal:** 19 September 2026. **Sumber:** klon lokal `~/Documents/reference-erp/erpnext`
(`0849f187e7`) untuk aset, dan `github.com/frappe/hrms@develop` yang dibaca langsung untuk
payroll. Semua klaim menyebut berkas dan fungsinya.

> **Catatan struktur:** HR dan payroll **bukan bagian ERPNext**. Mereka app terpisah,
> `frappe/hrms`. Yang tinggal di ERPNext hanyalah akibat akuntansinya — dua Journal Entry.
> Itu batas yang sama yang kita pakai: payroll menghasilkan *run*, finance yang memposting.

---

## 1. Payroll — rantai dokumennya

```
Salary Structure                     template komponen
  └─ Salary Structure Assignment     per pegawai, berlaku sejak tanggal
       └─ Payroll Entry              satu run, satu periode, satu perusahaan
            └─ Salary Slip           per pegawai   Draft → Submitted
                 ├─ Journal Entry    AKRUAL   — satu JE untuk seluruh run
                 └─ Journal Entry    BANK     — saat dibayar
```

`Payroll Entry.status`: `Draft · Submitted · Cancelled · Queued · Failed`.
Dua status terakhir ada karena run besar dijalankan di latar belakang.

## 2. Dua jurnal, bukan satu

**Akrual** — `payroll_entry.py :: make_accrual_jv_entry`, dipanggil saat slip di-submit:

```
Dr  <akun tiap komponen EARNING>        gaji, lembur, tunjangan…
    Cr  <akun tiap komponen DEDUCTION>  PPh 21, iuran, potongan…
    Cr  payroll_payable_account         sisanya — utang bersih ke pegawai
```

**Pembayaran** — `payroll_entry.py :: set_accounting_entries_for_bank_entry`:

```
Dr  payroll_payable_account
    Cr  payment_account                 rekening bank pembayar
```

**Ini persis pola akrual → bayar yang sudah kita rencanakan (D1 → D2).** Tidak ada yang
perlu diubah dari arah desain kita; yang berguna adalah konfirmasinya.

## 3. Akun ditentukan per KOMPONEN, bukan per pegawai

`Salary Component` punya tabel anak **`Salary Component Account`** = `(company, account)`.
Jadi "Gaji Pokok" menunjuk satu akun, "BPJS" menunjuk akun lain, dan payroll tidak pernah
menyebut kode akun di dalam kodenya.

Padanan kita sudah ada dan lebih halus: `account_map(semantic_key, site_id, qualifier)`
ditambah mesin komponen gaji dari migrasi 0235–0236. Yang perlu ditambahkan hanyalah
**satu baris peta per komponen**, bukan mekanisme baru.

Bonus yang ERPNext punya dan kita belum: `Salary Component.do_not_include_in_accounts` —
komponen statistik yang muncul di slip tetapi tidak pernah masuk jurnal. Murah, dan
mencegah komponen informatif mengotori buku besar.

## 4. Tiga hal yang ERPNext lakukan dan **tidak cocok** untuk kita

| # | ERPNext | kenapa tidak cocok |
|---|---|---|
| 1 | **Satu `cost_center` untuk seluruh run** | Beban gaji kita harus duduk di unit tempat orangnya bekerja. Satu run kita wajib menghasilkan **jurnal per unit**, bukan satu jurnal gabungan — dan aturan 0120 memang menolak entri yang tak seimbang per unit. |
| 2 | **Satu `payment_account` untuk seluruh run** | Pembayaran gaji kita keluar dari **petty cash tiap unit**, bukan dari satu rekening bank. Sisi bayar karena itu jadi satu BKK per unit, bukan satu bank entry. |
| 3 | **`Salary Component.formula` = ekspresi Python yang dievaluasi** | Sudah ditolak sejak awal: tarif dan rumus kita berupa himpunan basis tertutup yang disahkan, bukan kode yang diketik pengguna. Keputusan itu tidak berubah. |

Opsi `Payroll Settings.process_payroll_accounting_entry_based_on_employee` memecah utang
gaji per pegawai (party = Employee). Berguna untuk umur utang per orang; nilainya kecil
untuk 13 toko, jadi **tidak diambil** sekarang.

---

## 5. Aset → finance: akun datang dari KATEGORI aset

`Asset Category` punya tabel anak **`Asset Category Account`** dengan empat akun per
perusahaan:

```
fixed_asset_account
accumulated_depreciation_account
depreciation_expense_account
capital_work_in_progress_account
```

`depreciation.py :: get_depreciation_accounts(asset_category, company)` membacanya, dan
jatuh ke default perusahaan kalau kategorinya tidak mengisi. **Tidak ada kode akun yang
ditulis di dalam kode** — pola yang sama dengan `account_map` kita.

## 6. Rantai dokumen aset

```
Purchase Receipt / Purchase Invoice
  └─ Asset        Draft → Submitted → Partially Depreciated → Fully Depreciated
                                    → Scrapped / Sold / Cancelled
       └─ Asset Depreciation Schedule      satu per finance book
            └─ Journal Entry per baris jadwal
```

Jurnal penyusutannya (`depreciation.py :: make_depreciation_entry`):

```
Dr  depreciation_expense_account          cost center milik asetnya
    Cr  accumulated_depreciation_account
```

Sama dengan E3 kita. `Asset.depr_entry_posting_status` (`Successful`/`Failed`) menyimpan
hasil posting terakhir — kolom kecil yang membuat kegagalan jadwal terlihat, bukan diam.

## 7. Empat dokumen aset lain — dua di antaranya lubang kita

| dokumen ERPNext | akibat akuntansinya | kita |
|---|---|---|
| **Asset Capitalization** | menggabungkan stok + jasa + aset jadi aset baru | **ada** (`ASSET_CAPITALIZATION`) |
| **Asset Movement** | pindah `location` dan `custodian` (Employee) — **NOL JURNAL** | **belum**, dan lihat §8 |
| **Asset Repair** | biaya perbaikan: dibebankan **atau** dikapitalisasi ke nilai aset | **belum — lubang nyata** |
| **Asset Value Adjustment** | revaluasi nilai buku, jadwal penyusutan dihitung ulang | **belum — lubang nyata** |

`Asset Repair` penting untuk klien ini: rak, genset dan kendaraan diperbaiki terus, dan
pertanyaan "ini beban atau menambah nilai aset" muncul tiap bulan. Sekarang jawabannya
hanya bisa lewat jurnal manual.

## 8. `Asset Movement` — preseden untuk prinsip custody kita

ERPNext memindahkan aset antar lokasi dan antar penanggung jawab **tanpa menulis satu baris
GL pun**. Nilai asetnya tidak berubah; yang berubah siapa yang memegangnya.

> Itu **prinsip yang sama** yang kita pakai untuk buka/tutup shift, serah-terima modal
> kasir, dan hitung kas: *custody bukan akuntansi*. Bagus untuk diketahui — pola kita bukan
> karangan sendiri, ia sudah jadi praktik di ERP yang matang.

## 9. Satu flag yang kita butuhkan dari ERPNext

`Asset Category.non_depreciable_category` — tanah tidak disusutkan.

Kita butuh pembedaan yang sama untuk dua hal: `Tanah Hak Milik`, dan `Operating Equipment`
yang **klien memang tidak susutkan** melainkan dibebankan ke cadangan penggantian.
Pembedanya di model kita sudah ada bentuknya — `asset_class.kind` dengan nilai
`PPE · OE · INTANGIBLE · DEFERRED` — jadi yang perlu ditulis hanyalah aturan
"kind = OE tidak masuk jadwal penyusutan, ia masuk jadwal cadangan".

## 10. CWIP: ERPNext per kategori, kita satu akun

ERPNext menaruh `capital_work_in_progress_account` **per kategori aset**. Kita punya satu
akun `Contract in Progress (CIP)` ditambah `asset_id` di baris jurnalnya.

Kita lebih sederhana dan tidak kehilangan apa pun: kategori pekerjaan yang sedang berjalan
tetap terbaca dari asetnya. Tidak perlu ditiru.

---

## 11. Yang diambil, dan yang tidak

**Diambil**

1. Dua jurnal terpisah: akrual saat slip disahkan, pembayaran saat uang keluar.
2. Akun ditentukan per komponen gaji dan per kategori aset — lewat peta, bukan kode.
3. `do_not_include_in_accounts` untuk komponen statistik.
4. Kolom hasil posting jadwal (`Successful`/`Failed`) supaya kegagalan terlihat.
5. **Asset Repair** dan **Asset Value Adjustment** sebagai dokumen baru — dua lubang nyata.
6. Aturan `kind = OE` tidak masuk jadwal penyusutan.

**Tidak diambil**

1. Satu cost center dan satu rekening pembayar untuk seluruh payroll run — kita per unit.
2. Rumus komponen berupa ekspresi Python.
3. Utang gaji per pegawai sebagai default.
4. CWIP per kategori aset.

## 12. Akibat untuk desain grup berikutnya

- **Group Payroll** wajib menyatakan: satu run → **N jurnal akrual**, satu per unit; dan
  pembayaran → **N BKK**, satu per unit, dari petty cash masing-masing. Ini perbedaan
  paling tajam dengan ERPNext dan sumber bug paling mahal kalau dilewatkan.
- **Group Aset** bertambah dua kejadian bisnis: perbaikan aset, dan penyesuaian nilai.
- Keduanya belum masuk `docs/finance-proses-bisnis.html`; menyusul saat grupnya ditulis.
