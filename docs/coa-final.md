# Bagan akun yang disederhanakan — satu sumbu `unit`

**Tanggal:** 13 September 2026 · **Status:** usulan, diturunkan dari data klien
**Sumber:** `~/Downloads/Laporan_Master_Account1.csv` (7.538 baris fisik / 7.528 baris akun),
diurai ulang di sesi ini. Kerangka berpikirnya dari `/Users/hari/itulah/docs/coa-cube.md`,
yang diverifikasi ulang terhadap CSV dan **cocok persis** (lihat §2).

Bacaan pendamping: `docs/finance-menu.md`, `docs/erpnext-money.md`, `docs/finance.md`.
`docs/erpnext-reference.md` basi dan tidak dipakai.

> Perbedaan dengan `coa-cube.md`: dokumen itu **tidak mengubah bagan klien** sama sekali — ia
> hanya menyederhanakan *permukaan pilih*. Dokumen ini menjawab pertanyaan yang berbeda dan
> lebih keras: **bagan seperti apa yang seharusnya ditulis modul finance baru**, kalau buku
> besarnya punya satu dimensi `unit` dan tidak punya cost center. Keduanya tidak bertabrakan:
> kubus adalah cara menavigasi bagan lama (untuk rekonsiliasi dan riwayat); bagan di sini
> adalah bagan yang ditulis ke depan.

---

## 1. Bentuk file yang sebenarnya

Ini dump laporan, bukan tabel. Strukturnya, setelah diperiksa:

- **8 baris banner** di atas (nama toko, alamat, telepon, legenda lebar kolom `1,1,2,2,3,3,4,4,6,6,9`,
  judul `ACCOUNT` … `CODE`) dan **2 baris kosong** di bawah. Tidak ada banner yang berulang di
  tengah — tidak ada page-break. 7.538 − 8 − 2 = **7.528 baris akun**.
- Kolom yang berisi: **kolom 2 = kode**, **kolom 3 = nama**, **kolom 4 = flag aktif `Y`/`N`**,
  **kolom 5 = panjang kode**, kolom 6–15 = tangga indentasi kosong (spasi), **kolom 16 = kode
  diulang**. Kolom 1 dan 17 selalu kosong.
- **Kolom 4 bukan flag "group".** Ia terbaca `Y` pada daun juga; 104 baris `N` = akun non-aktif.
- Nama mengandung koma dan harus di-parse sebagai CSV ber-quote — 45 baris `"Cad, Penghapusan …"`
  pecah kalau dipotong dengan `split(',')`.
- Verifikasi integritas: `len(kode) == kolom 5` untuk **semua** 7.528 baris; kolom 16 == kolom 2
  untuk semua; **tidak ada kode duplikat**.

---

## 2. Rekonsiliasi hitungan

### 2.1 Baris mentah menurut panjang kode

| panjang kode | jumlah | peran |
|---|---:|---|
| 1 | 8 | akar |
| 3 | 14 | |
| 5 | 30 | |
| 6 | **3** | akun posting di luar tangga |
| 7 | 75 | keluarga |
| 10 | 496 | 493 template + **3** akun posting |
| 12 | 6.902 | daun |
| **total** | **7.528** | |

### 2.2 Struktur vs posting

```
baris struktur (group)   8 + 14 + 30 + 75 + 493  =    620
akun posting             6.902 + 3 + 3           =  6.908
                                                   -------
                                                    7.528  ✓
```

### 2.3 Kubusnya benar — diverifikasi, bukan diasumsikan

Setiap satu dari **493 template rung-10 punya tepat 14 anak**, dan akhirannya persis `00`–`13`.
Nol pengecualian; dicek atas keseluruhan 6.902 daun.

```
sumbu 1  ARTI         367 template biasa + 9 keluarga matriks  =  376
sumbu 2  UNIT         14  (HO + C001..C013)                       pemilik buku
sumbu 3  UNIT LAWAN   14  hanya untuk 9 arti matriks

  367 × 14      =  5.138
    9 × 14 × 14 =  1.764
                   -----
                   6.902  ✓   (cocok persis dengan jumlah daun)
+ 6 akun di luar pola      →  6.908 akun posting
```

**Jadi 382 arti berbeda, bukan 6.908.** 6.526 dari 6.908 akun posting (94,5%) ada semata-mata
karena 382 arti dikali-silang dengan 14 unit.

### 2.4 Sembilan keluarga matriks (unit × unit)

| Keluarga | Nama | Sel | Runtuh ke |
|---|---|---:|---|
| `1011203` | Barang Dalam Perjalanan Barang Dagangan | 14×14 | `1-1303` |
| `1011204` | Barang Dalam Perjalanan Kantong Belanja | 14×14 | `1-1304` |
| `1021401` | PIUTANG AFFILIASI PEMBIAYAAN | 14×14 | `1-2101` |
| `1021402` | PIUTANG AFFILIASI ATAS BARANG | 14×14 | `1-2101` |
| `1021403` | PIUTANG AFFILIASI LAIN-LAIN | 14×14 | `1-2101` |
| `2012301` | HUTANG AFFILIASI PEMBIAYAAN | 14×14 | `1-2101` |
| `2012302` | HUTANG AFFILIASI ATAS BARANG | 14×14 | `1-2101` |
| `2012304` | HUTANG LAIN - LAIN | 14×14 | `1-2101` |
| `2012303` | HUTANG LAIN-LAIN PRINCIPAL | 14×14 | `2-1501` (lawannya **bukan** unit) |

Pemilik buku ada di akhiran 2 digit; lawan ada di indeks template 3 digit, dengan **offset ordinal**
(`001` = HEAD OFFICE → akhiran `00`; `002` = CIKUPA → `01` = C001; …; `014` = WONOSOBO → `13` = C013).
Contoh: `102140100206` = `Piutang Affiliasi Pembiayaan CIKUPA - C006` → pemilik **C006**, lawan **CIKUPA**.

### 2.5 Bagan lama → bagan baru

| Tahap | Jumlah | Faktor |
|---|---:|---|
| Akun posting di bagan klien | 6.908 | |
| Arti berbeda (runtuh sumbu unit + sumbu lawan) | **382** | 18,1× |
| Akun posting di bagan usulan | **175** | 2,2× lagi |
| Group / heading di bagan usulan | 44 | (klien: 620) |
| **Total baris bagan usulan** | **219** | **34,4×** lebih kecil dari 7.528 |

Ke mana 382 arti itu pergi:

| Peleburan | arti | akun |
|---|---:|---:|
| A. Matriks unit × unit jadi kolom counterparty | 9 | 4 |
| B. Jenis aset tingkat-barang pindah ke asset register | 172 | 28 |
| C. Rincian persediaan tingkat-SKU pindah ke inventory ledger | 13 | 3 |
| D. Pendapatan yang dipecah per tender/kanal jadi satu akun | 9 | 1 |
| E. Rekening bank tetap 1:1, tapi jadi company-wide | 14 | 14 |
| F. Identitas pemberi pinjaman pindah ke loan register | 18 | 5 |
| G. Arti kembar: gaji toko vs gaji kantor | 26 | 13 |
| H. Arti nyaris-kembar dilebur | 27 | 11 |
| I. Dibawa satu-lawan-satu | 94 | 94 |
| J. Akun baru (tidak ada di bagan klien) | 0 | 2 |
| **TOTAL** | **382** | **175** |

Sepuluh peleburan terbesar, dalam daun:

| Daun lama | → | Akun baru |
|---:|---|---|
| 1.176 | → | `1-2101` Rekening Koran Antar-Unit (84 template dari 6 keluarga) |
| 504 | → | `1-2208` Operating Equipment (36 template) |
| 504 | → | `1-2308` Cadangan Penggantian OE (36 template) |
| 504 | → | `7-2006` Beban Penggantian OE (36 template) |
| 196 | → | `1-1303` BDP Barang Dagangan |
| 196 | → | `1-1304` BDP Perlengkapan |
| 196 | → | `2-1501` Hutang kepada Pemilik |
| 140 | → | `1-1302` Persediaan Perlengkapan Toko (10 SKU kantong) |
| 126 | → | `4-1001` Penjualan Barang Dagangan (9 tender/kanal) |
| 98 | → | `1-2207` FFE (7 sub-kelas) |

---

## 3. Satu sumbu: `unit`

**14 unit: `HO` + `C001`…`C013`.** Konsisten di seluruh 6.902 daun; nol pengecualian.

Di repo ini sumbunya sudah ada dengan nama lain: `journal_line.site_id` (`NOT NULL`,
`REFERENCES site(id)`, nilai `dc` + `store-01`…`store-13`). Yang perlu diputuskan: **kunci
sumbu `unit` seharusnya `org_place`, bukan `site`.** `org_place` sudah tepat 14 baris sejak
migrasi 0230 menghapus `dc` dan 0236 menyetel `org_place('ho').site_id = 'dc'` — dan HO, bukan
DC, yang jadi unit finance. `site` juga 14 baris tetapi baris pertamanya bernama `dc`, dan
gudang bukan unit akuntansi.

Aturan yang dipakai bagan ini:

1. **Setiap baris jurnal selalu membawa `unit`. Tidak pernah NULL.** Dimensi yang boleh kosong
   langsung melahirkan dua jalur kode dan dua definisi neraca.
2. Akun ber-`dimension: company` **dipaksa `unit = HO`** oleh satu CHECK saat posting —
   bukan dengan membolehkan NULL.
3. **Tidak ada cost center. Tidak ada sumbu keempat.** Kanal, kategori barang, proyek: bagan
   klien tidak mengkodekannya, dan menambah sumbu yang datanya tak punya berarti mengarang data.
4. `counterparty_unit` **bukan dimensi umum**: ia properti dari **3 akun** saja
   (`1-1303`, `1-1304`, `1-2101`), wajib di sana dan terlarang di mana pun. Satu kolom boolean
   `requires_counterparty` di tabel akun menegakkannya.

> **Catatan konflik.** Prototipe `frontend-hub/src/screens/finance-lab/engine/types.ts` sudah
> memuat `Dimensions { unit_id, bank_account_id?, asset_class?, counterparty_unit_id?, tax_kind?,
> acquirer?, expense_kind? }` — **tujuh** dimensi opsional dan ±55 `AccountRole`. Itu desain yang
> berbeda dari yang diminta di sini. Salah satunya harus menang sebelum ada kode backend ditulis.

---

## 4. Akun antar-unit — keputusan

### 4.1 Putusan

**Satu akun posting: `1-2101 Rekening Koran Antar-Unit` (Inter-unit current account),
bertanda (signed), membawa `unit` DAN `counterparty_unit`.**
Ia menyerap **enam** keluarga matriks — 3 piutang afiliasi dan 3 hutang afiliasi —
yaitu **1.176 daun menjadi 1 akun**.

Yang **tidak** ikut:

- `1011203` / `1011204` **Barang Dalam Perjalanan** tetap akun sendiri (`1-1303`, `1-1304`),
  juga ber-`counterparty_unit`. Alasannya: itu **nilai barang**, bukan utang. Saldonya harus
  ikat ke pool in-transit di inventory ledger, dan menguburnya ke dalam rekening koran akan
  membuat selisih stok terbaca sebagai selisih uang.
- `2012303` **HUTANG LAIN-LAIN PRINCIPAL** keluar dari matriks sepenuhnya → `2-1501 Hutang
  kepada Pemilik`, ber-`unit` saja. Lihat bukti di §4.2 butir 4.
- Alasan transaksi (**pembiayaan / atas barang / lain-lain**) **tidak** jadi tiga akun. Ia
  atribut baris jurnal (satu enum `reason`), karena alasan itu sudah ada di dokumen yang
  melahirkan barisnya dan tidak pernah mengubah cara saldonya diselesaikan.

### 4.2 Kenapa — dari apa yang CSV benar-benar tunjukkan

1. **Matriksnya dibangkitkan, bukan dipakai.** Kesembilan keluarga padat 14×14 tanpa satu pun
   lubang, **termasuk 126 sel diagonal** — unit berutang kepada dirinya sendiri
   (`101120300100` = `BDP Barang Dagangan HEAD OFFICE - HO`). Sel yang mustahil punya arti
   hanya ada kalau daftarnya dikali-silang oleh mesin.
2. **Sisi piutang dan hutang adalah cermin.** Untuk setiap pasangan (A,B), `Piutang Affiliasi X`
   di buku A terhadap B dan `Hutang Affiliasi X` di buku B terhadap A adalah **satu fakta yang
   ditulis dua kali**. 1.176 daun karenanya memuat paling banyak 196 angka. Dengan satu akun
   bertanda, cermin itu otomatis: debit A **adalah** kredit B, di baris yang sama.
3. **Sebagian besar sel tak akan pernah terisi.** Barang hanya bisa bergerak DC↔toko:
   `AllotmentType` di `backend/src/cloud/domain/allotment.rs` hanya punya
   `ToStore | ReturnToDc | ReturnToSupplier`, dan `validate_create_line` memaku `ToStore` ke
   sumber `dc`. Uang juga hub-and-spoke: kebijakan pemilik adalah toko tidak memegang rekening
   apa pun. Jadi dari 196 pasangan berurutan per keluarga, paling banyak **26** (HO→13 toko,
   13 toko→HO) bisa terjadi.

   ```
   1.764 sel matriks
     222 mungkin terisi   (8 keluarga × 26, ditambah 14 untuk keluarga PRINCIPAL)
   1.542 (87,4%) tidak akan pernah terisi
   ```
4. **Satu dari sembilan keluarga bahkan bukan matriks.** `2012303 HUTANG LAIN-LAIN PRINCIPAL`
   memakai sumbu lawan berisi 14 nama unit, tetapi lawannya adalah **pemilik**, bukan unit.
   196 sel untuk 14 fakta. Sumbu lawan di situ hasil salin-tempel dari keluarga afiliasi.
5. **Invarian jadi satu baris.** Dengan satu akun:
   `SELECT sum(debit)-sum(credit) FROM journal_line WHERE account='1-2101'` **harus 0**, selalu.
   Dengan enam akun terpisah per arah, ujinya adalah "jumlah piutang A-terhadap-B sama dengan
   jumlah hutang B-terhadap-A untuk 196 pasangan" — uji yang tidak pernah dijalankan siapa pun,
   dan justru itulah sebabnya akun antar-unit selalu melenceng di sistem lama.
6. **Akun itu ada semata-mata supaya neraca tiap unit seimbang.** Bagan klien mereplikasi
   **ekuitas** ke 14 unit juga (`3013001001 Modal Setor` … `3013001004 Prive`, masing-masing
   ×14). Itu ciri **14 set buku dalam satu file**. Di tingkat badan hukum, rekening koran
   antar-unit harus nol dan hilang dari laporan konsolidasi; ia hanya tampil di laporan per unit.

### 4.3 Penyajian

Neraca per unit menyajikan **gross berdasarkan tanda**: saldo positif per (unit, counterparty)
tampil sebagai *Piutang Antar-Unit*, negatif sebagai *Hutang Antar-Unit*. Itu justru yang
**tidak bisa** dilakukan ERPNext — di sana Cost Center adalah kolom kedua dan bukan akun, sehingga
due-to/due-from harus jadi dua akun. Buku besar berdimensi bisa memutar tandanya saat melapor.

### 4.4 Konsekuensi yang harus ditelan

Kalau ekuitas jadi company-wide (§8 butir 1), neraca satu unit tidak lagi seimbang sendiri tanpa
sesuatu yang menutup selisihnya — dan penutup itu memang `1-2101`. Saat migrasi, untuk tiap unit
`u ≠ HO`:

```
saldo awal 1-2101 (unit=u, counterparty=HO)
    = Modal Setor_u + Laba Ditahan_u + Laba berjalan_u − Prive_u
      + posisi neto afiliasi_u
```

dan HO memegang ekuitas yang sebenarnya. Aturan itu harus ditulis sebagai satu langkah migrasi
yang bisa diuji, bukan sebagai penyesuaian manual.

---

## 5. Bagan usulan

219 baris: **44 group + 175 akun posting**.

| Type | group | posting |
|---|---:|---:|
| Asset | 17 | 67 |
| Liability | 9 | 19 |
| Equity | 1 | 4 |
| Income | 3 | 8 |
| Expense | 14 | 77 |
| **Total** | **44** | **175** |

Dari 175 akun posting: **147 ber-dimensi `unit`**, **28 company-wide**, **3 juga membawa
`counterparty_unit`**, **14 contra**, **2 baru** (tidak ada padanannya di bagan klien).

Kalau setiap akun ber-`unit` dibuka di seluruh 14 unit, buku besar memegang
**147 × 14 + 28 = 2.086** kombinasi akun-unit — tetapi itu baris data, bukan baris bagan.
Orang memilih dari **175**.

Format kode: `N-NNNN`, satu digit tipe + empat digit — sengaja dibuat tidak mungkin tertukar
dengan kode 12-digit lama.

| Kode | Nama (ID) | English | Type | Group/Posting | Induk | D/C | Dimensi |
|---|---|---|---|---|---|---|---|
| `1-0000` | **ASET** | _Assets_ | Asset | group | — | — | — |
| `1-1000` | &nbsp;&nbsp;&nbsp;**ASET LANCAR** | _Current assets_ | Asset | group | `1-0000` | — | — |
| `1-1100` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;**Kas & Setara Kas** | _Cash and cash equivalents_ | Asset | group | `1-1000` | — | — |
| `1-1101` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Kas di Tangan | _Cash on hand_ | Asset | posting | `1-1100` | D | unit |
| `1-1102` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Kas Kecil | _Petty cash_ | Asset | posting | `1-1100` | D | unit |
| `1-1103` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Modal Kasir | _Till float_ | Asset | posting | `1-1100` | D | unit |
| `1-1104` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Setoran Dalam Perjalanan | _Deposits in transit_ | Asset | posting | `1-1100` | D | unit |
| `1-1110` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;**Bank — Giro** | _Bank current accounts_ | Asset | group | `1-1100` | — | — |
| `1-1111` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Bank BCA — Giro | _Bank BCA — current account_ | Asset | posting | `1-1110` | D | company |
| `1-1112` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Bank Mandiri — Giro | _Bank Mandiri — current account_ | Asset | posting | `1-1110` | D | company |
| `1-1113` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Bank BRI — Giro | _Bank BRI — current account_ | Asset | posting | `1-1110` | D | company |
| `1-1114` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Bank BNI — Giro | _Bank BNI — current account_ | Asset | posting | `1-1110` | D | company |
| `1-1115` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Bank Danamon — Giro | _Bank Danamon — current account_ | Asset | posting | `1-1110` | D | company |
| `1-1120` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;**Bank — Tabungan** | _Bank savings accounts_ | Asset | group | `1-1100` | — | — |
| `1-1121` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Bank BCA — Tabungan | _Bank BCA — savings account_ | Asset | posting | `1-1120` | D | company |
| `1-1122` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Bank Mandiri — Tabungan | _Bank Mandiri — savings account_ | Asset | posting | `1-1120` | D | company |
| `1-1123` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Bank BRI — Tabungan | _Bank BRI — savings account_ | Asset | posting | `1-1120` | D | company |
| `1-1124` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Bank BNI — Tabungan | _Bank BNI — savings account_ | Asset | posting | `1-1120` | D | company |
| `1-1125` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Bank BTN — Tabungan | _Bank BTN — savings account_ | Asset | posting | `1-1120` | D | company |
| `1-1130` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;**Deposito Berjangka** | _Time deposits_ | Asset | group | `1-1100` | — | — |
| `1-1131` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Deposito BCA | _Time deposit — BCA_ | Asset | posting | `1-1130` | D | company |
| `1-1132` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Deposito Mandiri | _Time deposit — Mandiri_ | Asset | posting | `1-1130` | D | company |
| `1-1133` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Deposito BRI | _Time deposit — BRI_ | Asset | posting | `1-1130` | D | company |
| `1-1134` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Deposito BNI | _Time deposit — BNI_ | Asset | posting | `1-1130` | D | company |
| `1-1200` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;**Piutang** | _Receivables_ | Asset | group | `1-1000` | — | — |
| `1-1201` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Piutang Kartu Kredit | _Credit-card settlement receivable_ | Asset | posting | `1-1200` | D | unit |
| `1-1202` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Piutang Kartu Debit | _Debit-card settlement receivable_ | Asset | posting | `1-1200` | D | unit |
| `1-1203` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Piutang Karyawan | _Employee receivable_ | Asset | posting | `1-1200` | D | unit |
| `1-1204` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Piutang Kepala Toko | _Store-manager personal loan_ | Asset | posting | `1-1200` | D | unit |
| `1-1205` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Piutang Manajemen | _Management receivable_ | Asset | posting | `1-1200` | D | unit |
| `1-1209` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Cadangan Piutang Tak Tertagih | _Allowance for doubtful receivables_ | Asset (contra) | posting | `1-1200` | C | unit |
| `1-1300` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;**Persediaan** | _Inventory_ | Asset | group | `1-1000` | — | — |
| `1-1301` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Persediaan Barang Dagangan | _Merchandise inventory_ | Asset | posting | `1-1300` | D | unit |
| `1-1302` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Persediaan Perlengkapan Toko | _Store supplies inventory_ | Asset | posting | `1-1300` | D | unit |
| `1-1303` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Barang Dalam Perjalanan — Barang Dagangan | _Merchandise in transit_ | Asset | posting | `1-1300` | D | unit + counterparty |
| `1-1304` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Barang Dalam Perjalanan — Perlengkapan | _Store supplies in transit_ | Asset | posting | `1-1300` | D | unit + counterparty |
| `1-1309` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Cadangan Kerusakan Persediaan | _Allowance for inventory damage and loss_ | Asset (contra) | posting | `1-1300` | C | unit |
| `1-1400` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;**Biaya Dibayar Dimuka** | _Prepayments_ | Asset | group | `1-1000` | — | — |
| `1-1401` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Asuransi Dibayar Dimuka | _Prepaid insurance_ | Asset | posting | `1-1400` | D | unit |
| `1-1402` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Sewa Dibayar Dimuka | _Prepaid rent_ | Asset | posting | `1-1400` | D | unit |
| `1-1403` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Kontrak Pemeliharaan Dibayar Dimuka | _Prepaid maintenance contracts_ | Asset | posting | `1-1400` | D | unit |
| `1-1404` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Biaya Promosi Dibayar Dimuka | _Prepaid promotion_ | Asset | posting | `1-1400` | D | unit |
| `1-1405` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Biaya Perijinan Dibayar Dimuka | _Prepaid permits and licences_ | Asset | posting | `1-1400` | D | unit |
| `1-1409` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Biaya Dibayar Dimuka Lainnya | _Other prepayments_ | Asset | posting | `1-1400` | D | unit |
| `1-1410` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;**Pajak Dibayar Dimuka** | _Prepaid tax_ | Asset | group | `1-1400` | — | — |
| `1-1411` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;PPh Pasal 21 Dibayar Dimuka | _Prepaid income tax art. 21_ | Asset | posting | `1-1410` | D | unit |
| `1-1412` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;PPh Pasal 25 Dibayar Dimuka | _Prepaid income tax art. 25_ | Asset | posting | `1-1410` | D | unit |
| `1-1413` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;PPh Pasal 29 Dibayar Dimuka | _Prepaid income tax art. 29_ | Asset | posting | `1-1410` | D | unit |
| `1-1414` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;PPN Masukan | _Input VAT_ | Asset | posting | `1-1410` | D | unit |
| `1-1415` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;PBB Dibayar Dimuka | _Prepaid land and building tax_ | Asset | posting | `1-1410` | D | unit |
| `1-1419` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Pajak Dibayar Dimuka Lainnya | _Other prepaid tax_ | Asset | posting | `1-1410` | D | unit |
| `1-1420` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;**Uang Muka** | _Advances_ | Asset | group | `1-1400` | — | — |
| `1-1421` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Uang Muka Perjalanan Dinas | _Travel advance_ | Asset | posting | `1-1420` | D | unit |
| `1-1422` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Uang Muka Pembelian | _Purchase advance_ | Asset | posting | `1-1420` | D | unit |
| `1-1423` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Uang Muka Kontraktor | _Contractor advance_ | Asset | posting | `1-1420` | D | unit |
| `1-1429` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Uang Muka Lainnya | _Other advances_ | Asset | posting | `1-1420` | D | unit |
| `1-2000` | &nbsp;&nbsp;&nbsp;**ASET TIDAK LANCAR** | _Non-current assets_ | Asset | group | `1-0000` | — | — |
| `1-2100` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;**Rekening Antar-Unit** | _Inter-unit accounts_ | Asset | group | `1-2000` | — | — |
| `1-2101` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Rekening Koran Antar-Unit | _Inter-unit current account_ | Asset | posting | `1-2100` | D | unit + counterparty |
| `1-2200` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;**Aset Tetap** | _Fixed assets_ | Asset | group | `1-2000` | — | — |
| `1-2201` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Tanah Hak Milik | _Freehold land_ | Asset | posting | `1-2200` | D | unit |
| `1-2202` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Hak Guna Bangunan (HGB) | _Leasehold land rights_ | Asset | posting | `1-2200` | D | unit |
| `1-2203` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Bangunan | _Buildings_ | Asset | posting | `1-2200` | D | unit |
| `1-2204` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Instalasi Mekanikal & Elektrikal | _Mechanical and electrical installations_ | Asset | posting | `1-2200` | D | unit |
| `1-2205` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Mesin & Peralatan | _Machinery and plant_ | Asset | posting | `1-2200` | D | unit |
| `1-2206` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Kendaraan | _Vehicles_ | Asset | posting | `1-2200` | D | unit |
| `1-2207` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Furniture, Fixture & Equipment | _Furniture, fixtures and equipment_ | Asset | posting | `1-2200` | D | unit |
| `1-2208` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Operating Equipment | _Operating equipment_ | Asset | posting | `1-2200` | D | unit |
| `1-2209` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Aset Dalam Pengerjaan (CIP) | _Construction in progress_ | Asset | posting | `1-2200` | D | unit |
| `1-2300` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;**Akumulasi Penyusutan** | _Accumulated depreciation_ | Asset | group | `1-2000` | — | — |
| `1-2302` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Akm. Penyusutan — HGB | _Accumulated amortisation — land rights_ | Asset (contra) | posting | `1-2300` | C | unit |
| `1-2303` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Akm. Penyusutan — Bangunan | _Accumulated depreciation — buildings_ | Asset (contra) | posting | `1-2300` | C | unit |
| `1-2304` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Akm. Penyusutan — Instalasi | _Accumulated depreciation — installations_ | Asset (contra) | posting | `1-2300` | C | unit |
| `1-2305` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Akm. Penyusutan — Mesin & Peralatan | _Accumulated depreciation — machinery_ | Asset (contra) | posting | `1-2300` | C | unit |
| `1-2306` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Akm. Penyusutan — Kendaraan | _Accumulated depreciation — vehicles_ | Asset (contra) | posting | `1-2300` | C | unit |
| `1-2307` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Akm. Penyusutan — FFE | _Accumulated depreciation — FFE_ | Asset (contra) | posting | `1-2300` | C | unit |
| `1-2308` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Cadangan Penggantian Operating Equipment | _Operating equipment replacement reserve_ | Asset (contra) | posting | `1-2300` | C | unit |
| `1-2400` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;**Aset Tak Berwujud** | _Intangible assets_ | Asset | group | `1-2000` | — | — |
| `1-2401` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Perangkat Lunak | _Software_ | Asset | posting | `1-2400` | D | unit |
| `1-2402` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Akm. Amortisasi Perangkat Lunak | _Accumulated amortisation — software_ | Asset (contra) | posting | `1-2400` | C | unit |
| `1-3000` | &nbsp;&nbsp;&nbsp;**ASET LAIN-LAIN** | _Other assets_ | Asset | group | `1-0000` | — | — |
| `1-3001` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Persediaan Barang Rusak | _Disposed inventory_ | Asset | posting | `1-3000` | D | unit |
| `1-3002` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Biaya Pra-Operasi | _Pre-opening costs_ | Asset | posting | `1-3000` | D | unit |
| `1-3003` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Akm. Amortisasi Biaya Pra-Operasi | _Accumulated amortisation — pre-opening_ | Asset (contra) | posting | `1-3000` | C | unit |
| `2-0000` | **KEWAJIBAN** | _Liabilities_ | Liability | group | — | — | — |
| `2-1000` | &nbsp;&nbsp;&nbsp;**KEWAJIBAN JANGKA PENDEK** | _Current liabilities_ | Liability | group | `2-0000` | — | — |
| `2-1100` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;**Hutang Usaha** | _Trade payables_ | Liability | group | `2-1000` | — | — |
| `2-1101` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Hutang Supplier Barang Dagangan | _Merchandise supplier payable_ | Liability | posting | `2-1100` | C | unit |
| `2-1102` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Hutang Supplier Barang Dagangan — Ditahan | _Merchandise supplier payable — suspended_ | Liability | posting | `2-1100` | C | unit |
| `2-1103` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Hutang Supplier Non-Barang Dagangan | _Non-merchandise supplier payable_ | Liability | posting | `2-1100` | C | unit |
| `2-1104` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Giro Keluar Belum Cair | _Outstanding cheques (giro)_ | Liability | posting | `2-1100` | C | company |
| `2-1200` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;**Hutang Pajak** | _Tax payable_ | Liability | group | `2-1000` | — | — |
| `2-1201` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Hutang PPh Pasal 21 | _Income tax payable art. 21_ | Liability | posting | `2-1200` | C | unit |
| `2-1202` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Hutang PPh Pasal 23 | _Withholding tax payable art. 23_ | Liability | posting | `2-1200` | C | unit |
| `2-1203` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Hutang PPN Keluaran | _Output VAT payable_ | Liability | posting | `2-1200` | C | unit |
| `2-1204` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Hutang PBB | _Land and building tax payable_ | Liability | posting | `2-1200` | C | unit |
| `2-1205` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Hutang PPh Pasal 25 | _Income tax payable art. 25_ | Liability | posting | `2-1200` | C | unit |
| `2-1300` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;**Biaya Yang Masih Harus Dibayar** | _Accrued expenses_ | Liability | group | `2-1000` | — | — |
| `2-1301` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Beban Pegawai YMHD | _Accrued employee costs_ | Liability | posting | `2-1300` | C | unit |
| `2-1302` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Beban Utilitas YMHD | _Accrued utilities_ | Liability | posting | `2-1300` | C | unit |
| `2-1303` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Beban Sewa YMHD | _Accrued rent_ | Liability | posting | `2-1300` | C | unit |
| `2-1304` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Beban Bunga YMHD | _Accrued interest_ | Liability | posting | `2-1300` | C | unit |
| `2-1400` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;**Uang Muka Pelanggan** | _Customer deposits_ | Liability | group | `2-1000` | — | — |
| `2-1401` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Uang Muka Penjualan & Voucher | _Customer deposits and vouchers_ | Liability | posting | `2-1400` | C | company |
| `2-1500` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;**Hutang Lain-lain** | _Other payables_ | Liability | group | `2-1000` | — | — |
| `2-1501` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Hutang kepada Pemilik | _Due to principal (owner)_ | Liability | posting | `2-1500` | C | unit |
| `2-1600` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;**Pinjaman Jatuh Tempo Dalam Satu Tahun** | _Current portion of long-term debt_ | Liability | group | `2-1000` | — | — |
| `2-1601` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Pinjaman Jatuh Tempo — Pemilik | _Current portion — owner loan_ | Liability | posting | `2-1600` | C | company |
| `2-1602` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Pinjaman Jatuh Tempo — Bank | _Current portion — bank loans_ | Liability | posting | `2-1600` | C | company |
| `2-2000` | &nbsp;&nbsp;&nbsp;**KEWAJIBAN JANGKA PANJANG** | _Long-term liabilities_ | Liability | group | `2-0000` | — | — |
| `2-2001` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Pinjaman Jangka Panjang — Pemilik | _Long-term owner loan_ | Liability | posting | `2-2000` | C | company |
| `2-2002` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Pinjaman Jangka Panjang — Bank | _Long-term bank loans_ | Liability | posting | `2-2000` | C | company |
| `3-0000` | **EKUITAS** | _Equity_ | Equity | group | — | — | — |
| `3-1001` | &nbsp;&nbsp;&nbsp;Modal Disetor | _Paid-in capital_ | Equity | posting | `3-0000` | C | company |
| `3-1002` | &nbsp;&nbsp;&nbsp;Laba Ditahan | _Retained earnings_ | Equity | posting | `3-0000` | C | company |
| `3-1003` | &nbsp;&nbsp;&nbsp;Laba (Rugi) Tahun Berjalan | _Current-year result_ | Equity | posting | `3-0000` | C | company |
| `3-1004` | &nbsp;&nbsp;&nbsp;Prive | _Owner's drawings_ | Equity (contra) | posting | `3-0000` | D | company |
| `4-0000` | **PENDAPATAN** | _Revenue_ | Income | group | — | — | — |
| `4-1000` | &nbsp;&nbsp;&nbsp;**Penjualan** | _Sales_ | Income | group | `4-0000` | — | — |
| `4-1001` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Penjualan Barang Dagangan | _Merchandise sales_ | Income | posting | `4-1000` | C | unit |
| `4-1002` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Potongan Penjualan | _Sales discounts_ | Income (contra) | posting | `4-1000` | D | unit |
| `4-1003` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Retur Penjualan | _Sales returns_ | Income (contra) | posting | `4-1000` | D | unit |
| `4-2000` | &nbsp;&nbsp;&nbsp;**Pendapatan Lain-lain** | _Other income_ | Income | group | `4-0000` | — | — |
| `4-2001` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Management Fee | _Management fee income_ | Income | posting | `4-2000` | C | unit |
| `4-2002` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Pendapatan Bunga Bank | _Bank interest income_ | Income | posting | `4-2000` | C | company |
| `4-2003` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Potongan Pembelian | _Purchase discounts received_ | Income | posting | `4-2000` | C | unit |
| `4-2004` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Pendapatan Sewa | _Rental income_ | Income | posting | `4-2000` | C | unit |
| `4-2009` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Pendapatan Lain-lain | _Sundry income_ | Income | posting | `4-2000` | C | unit |
| `5-0000` | **HARGA POKOK PENJUALAN** | _Cost of goods sold_ | Expense | group | — | — | — |
| `5-1001` | &nbsp;&nbsp;&nbsp;Harga Pokok Penjualan | _Cost of goods sold_ | Expense | posting | `5-0000` | D | unit |
| `6-0000` | **BEBAN USAHA** | _Operating expenses_ | Expense | group | — | — | — |
| `6-1000` | &nbsp;&nbsp;&nbsp;**Beban Penjualan** | _Selling expenses_ | Expense | group | `6-0000` | — | — |
| `6-1001` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Perlengkapan Pelanggan | _Customer supplies_ | Expense | posting | `6-1000` | D | unit |
| `6-1002` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Biaya Kartu Kredit & Debit | _Card acquiring fees_ | Expense | posting | `6-1000` | D | unit |
| `6-1003` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Biaya Promosi | _Promotion_ | Expense | posting | `6-1000` | D | unit |
| `6-1004` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Biaya Dekorasi | _Store decoration_ | Expense | posting | `6-1000` | D | unit |
| `6-1005` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Biaya Iklan | _Advertising_ | Expense | posting | `6-1000` | D | unit |
| `6-1006` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Biaya Bongkar Muat | _Loading and unloading_ | Expense | posting | `6-1000` | D | unit |
| `6-1007` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Biaya Pengiriman Barang | _Freight out_ | Expense | posting | `6-1000` | D | unit |
| `6-1008` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Kerusakan Persediaan | _Merchandise damage_ | Expense | posting | `6-1000` | D | unit |
| `6-2000` | &nbsp;&nbsp;&nbsp;**Beban Pegawai** | _Employee costs_ | Expense | group | `6-0000` | — | — |
| `6-2001` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Gaji & Upah | _Salaries and wages_ | Expense | posting | `6-2000` | D | unit |
| `6-2002` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Biaya Lembur | _Overtime_ | Expense | posting | `6-2000` | D | unit |
| `6-2003` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Uang Makan | _Meal allowance_ | Expense | posting | `6-2000` | D | unit |
| `6-2004` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Uang Transport | _Transport allowance_ | Expense | posting | `6-2000` | D | unit |
| `6-2005` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Kesehatan & Pengobatan | _Medical_ | Expense | posting | `6-2000` | D | unit |
| `6-2006` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Asuransi Pegawai & BPJS | _Employee insurance and BPJS_ | Expense | posting | `6-2000` | D | unit |
| `6-2007` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Tunjangan Hari Raya (THR) | _Religious holiday allowance_ | Expense | posting | `6-2000` | D | unit |
| `6-2008` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Seragam Kerja | _Uniforms_ | Expense | posting | `6-2000` | D | unit |
| `6-2009` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Olahraga & Rekreasi | _Sport and recreation_ | Expense | posting | `6-2000` | D | unit |
| `6-2010` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Sumbangan Duka | _Funeral contribution_ | Expense | posting | `6-2000` | D | unit |
| `6-2011` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Pengembangan SDM | _Manpower development_ | Expense | posting | `6-2000` | D | unit |
| `6-2012` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Pesangon | _Severance_ | Expense | posting | `6-2000` | D | unit |
| `6-2013` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Komisi, Bonus & Insentif | _Commission, bonus and incentive_ | Expense | posting | `6-2000` | D | unit |
| `6-3000` | &nbsp;&nbsp;&nbsp;**Beban Administrasi & Umum** | _Administrative and general expenses_ | Expense | group | `6-0000` | — | — |
| `6-3001` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Biaya Kebersihan | _Cleaning_ | Expense | posting | `6-3000` | D | unit |
| `6-3002` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;ATK & Barang Cetakan | _Stationery and printing_ | Expense | posting | `6-3000` | D | unit |
| `6-3003` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Biaya Rumah Tangga Kantor | _Office housekeeping_ | Expense | posting | `6-3000` | D | unit |
| `6-3004` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Biaya Bank | _Bank charges_ | Expense | posting | `6-3000` | D | unit |
| `6-3005` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Telepon, Faksimili & Internet | _Telecommunications_ | Expense | posting | `6-3000` | D | unit |
| `6-3006` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Biaya Listrik | _Electricity_ | Expense | posting | `6-3000` | D | unit |
| `6-3007` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Biaya Air (PDAM) | _Water_ | Expense | posting | `6-3000` | D | unit |
| `6-3008` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Biaya Perjalanan Dinas | _Business travel_ | Expense | posting | `6-3000` | D | unit |
| `6-3009` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Biaya Transport Lokal | _Local transport_ | Expense | posting | `6-3000` | D | unit |
| `6-3010` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Biaya Perijinan | _Permits and licences_ | Expense | posting | `6-3000` | D | unit |
| `6-3011` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Beban Komputer | _Computer expenses_ | Expense | posting | `6-3000` | D | unit |
| `6-3012` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Penyisihan Kerugian Piutang | _Bad-debt provision_ | Expense | posting | `6-3000` | D | unit |
| `6-3013` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Perlengkapan Toko & Kantor | _Store and office supplies_ | Expense | posting | `6-3000` | D | unit |
| `6-3014` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Biaya Stock Opname | _Stock-count costs_ | Expense | posting | `6-3000` | D | unit |
| `6-3015` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Peralatan Listrik | _Electrical supplies_ | Expense | posting | `6-3000` | D | unit |
| `6-3016` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Ban & Suku Cadang Kendaraan | _Tyres and vehicle parts_ | Expense | posting | `6-3000` | D | unit |
| `6-3017` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Bahan Bakar & Pelumas | _Fuel and lubricants_ | Expense | posting | `6-3000` | D | unit |
| `6-3018` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Peralatan Kerja (Tools) | _Tools_ | Expense | posting | `6-3000` | D | unit |
| `6-3021` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Donasi, CSR & Zakat | _Donations, CSR and zakat_ | Expense | posting | `6-3000` | D | unit |
| `6-3022` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Biaya Konsultan | _Professional fees_ | Expense | posting | `6-3000` | D | unit |
| `6-3023` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Lisensi Kendaraan (STNK, KIR) | _Vehicle licences_ | Expense | posting | `6-3000` | D | unit |
| `6-3024` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Perlengkapan Mess | _Staff-house supplies_ | Expense | posting | `6-3000` | D | unit |
| `6-3099` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Beban Administrasi Lain-lain | _Miscellaneous administrative expenses_ | Expense | posting | `6-3000` | D | unit |
| `6-4000` | &nbsp;&nbsp;&nbsp;**Beban Perawatan & Pemeliharaan** | _Repairs and maintenance_ | Expense | group | `6-0000` | — | — |
| `6-4001` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Perawatan FFE | _FFE maintenance_ | Expense | posting | `6-4000` | D | unit |
| `6-4002` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Perawatan Perangkat Lunak | _Software maintenance_ | Expense | posting | `6-4000` | D | unit |
| `6-4003` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Perawatan Komputer | _Computer maintenance_ | Expense | posting | `6-4000` | D | unit |
| `6-4004` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Perawatan Bangunan | _Building maintenance_ | Expense | posting | `6-4000` | D | unit |
| `6-4005` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Perawatan Mess | _Staff-house maintenance_ | Expense | posting | `6-4000` | D | unit |
| `6-4006` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Perawatan Kendaraan | _Vehicle maintenance_ | Expense | posting | `6-4000` | D | unit |
| `6-4007` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Perawatan AC & Pendingin | _Air-conditioning and refrigeration_ | Expense | posting | `6-4000` | D | unit |
| `6-4008` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Biaya Power Plant | _Power plant and genset_ | Expense | posting | `6-4000` | D | unit |
| `6-4009` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Perawatan Lift | _Lift maintenance_ | Expense | posting | `6-4000` | D | unit |
| `7-0000` | **BEBAN USAHA LAINNYA** | _Occupancy and non-cash operating expenses_ | Expense | group | — | — | — |
| `7-1000` | &nbsp;&nbsp;&nbsp;**Beban Sewa** | _Rent_ | Expense | group | `7-0000` | — | — |
| `7-1001` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Sewa Tanah | _Land rent_ | Expense | posting | `7-1000` | D | unit |
| `7-1002` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Amortisasi Hak Guna Bangunan | _Land-right amortisation_ | Expense | posting | `7-1000` | D | unit |
| `7-1003` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Sewa Bangunan Toko & Gudang | _Shop and warehouse rent_ | Expense | posting | `7-1000` | D | unit |
| `7-1004` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Sewa Rumah Dinas | _Staff-house rent_ | Expense | posting | `7-1000` | D | unit |
| `7-2000` | &nbsp;&nbsp;&nbsp;**Beban Penyusutan & Amortisasi** | _Depreciation and amortisation_ | Expense | group | `7-0000` | — | — |
| `7-2001` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Penyusutan Bangunan | _Depreciation — buildings_ | Expense | posting | `7-2000` | D | unit |
| `7-2002` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Penyusutan Instalasi | _Depreciation — installations_ | Expense | posting | `7-2000` | D | unit |
| `7-2003` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Penyusutan Mesin & Peralatan | _Depreciation — machinery_ | Expense | posting | `7-2000` | D | unit |
| `7-2004` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Penyusutan Kendaraan | _Depreciation — vehicles_ | Expense | posting | `7-2000` | D | unit |
| `7-2005` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Penyusutan FFE | _Depreciation — FFE_ | Expense | posting | `7-2000` | D | unit |
| `7-2006` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Beban Penggantian Operating Equipment | _Operating equipment replacement charge_ | Expense | posting | `7-2000` | D | unit |
| `7-2007` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Amortisasi Perangkat Lunak | _Amortisation — software_ | Expense | posting | `7-2000` | D | unit |
| `7-2008` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Amortisasi Biaya Pra-Operasi | _Amortisation — pre-opening costs_ | Expense | posting | `7-2000` | D | unit |
| `7-3000` | &nbsp;&nbsp;&nbsp;**Beban Usaha Lainnya** | _Other operating expenses_ | Expense | group | `7-0000` | — | — |
| `7-3001` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Asuransi Properti & Kebakaran | _Property and fire insurance_ | Expense | posting | `7-3000` | D | unit |
| `7-3002` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Pajak Bumi & Bangunan (PBB) | _Land and building tax_ | Expense | posting | `7-3000` | D | unit |
| `7-3003` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Pajak Reklame | _Signage tax_ | Expense | posting | `7-3000` | D | unit |
| `7-3004` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Biaya Management Fee | _Management fee expense_ | Expense | posting | `7-3000` | D | unit |
| `7-3005` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Asuransi Kendaraan | _Vehicle insurance_ | Expense | posting | `7-3000` | D | unit |
| `8-0000` | **BEBAN NON OPERASIONAL** | _Non-operating expenses_ | Expense | group | — | — | — |
| `8-1000` | &nbsp;&nbsp;&nbsp;**Beban Lain-lain** | _Other expenses_ | Expense | group | `8-0000` | — | — |
| `8-1001` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Selisih Pembulatan | _Rounding difference_ | Expense | posting | `8-1000` | D | unit |
| `8-1002` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Selisih Stock Opname | _Stock-count loss_ | Expense | posting | `8-1000` | D | unit |
| `8-1003` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Selisih Kas | _Cash over and short_ | Expense | posting | `8-1000` | D | unit |
| `8-2000` | &nbsp;&nbsp;&nbsp;**Beban Bunga** | _Interest expense_ | Expense | group | `8-0000` | — | — |
| `8-2001` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Bunga Pinjaman Bank | _Bank loan interest_ | Expense | posting | `8-2000` | D | company |
| `8-2002` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Bunga Leasing | _Lease interest_ | Expense | posting | `8-2000` | D | company |
| `8-3000` | &nbsp;&nbsp;&nbsp;**Pajak Penghasilan** | _Income tax_ | Expense | group | `8-0000` | — | — |
| `8-3001` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Beban Pajak Penghasilan | _Income tax expense_ | Expense | posting | `8-3000` | D | company |

**Catatan per akun** (alasan, jebakan, dan keputusan) ada di `coa-final.json`, field `note`.

---

## 6. Tabel pemetaan — cukup untuk menulis migrasinya

### 6.1 Dua fungsi yang dibutuhkan

```
unit_of(suffix)          '00' → HO ;  '01'..'13' → C001..C013
counterparty_of(index)   '001' → HO ; '002'..'014' → C001..C013      (ordinal − 1)
```

`counterparty_of` **hanya** dipanggil untuk akun yang membawa counterparty (`1-1303`, `1-1304`,
`1-2101`). Offset ordinal itu **asumsi** yang belum dikonfirmasi klien, dan semua saldo antar-unit
bergantung padanya — ia sudah ditandai sebagai asumsi di `scripts/import-coa.py` dan tetap begitu.

### 6.2 Aturan per baris

```
template     = kode[0:10]          (untuk daun 12-digit)
suffix       = kode[10:12]
akun_baru    = MAP[template]
unit         = unit_of(suffix)                             kalau akun ber-dimensi unit
unit         = HO                                          kalau akun company-wide  (§6.3)
counterparty = counterparty_of(kode[7:10])                 hanya untuk 3 akun di atas
```

### 6.3 Satu pemeriksaan yang WAJIB jalan sebelum migrasi

28 akun jadi **company-wide**, padahal di bagan lama masing-masing punya 14 daun. Untuk setiap
akun company-wide, saldo di 13 unit toko **harus nol**. Kalau tidak:

```sql
-- Saldo yang akan hilang kalau akun ini dijadikan company-wide.
-- Harus mengembalikan NOL baris sebelum migrasi dijalankan.
SELECT l.account_code, l.site_id, sum(l.debit_minor - l.credit_minor) AS saldo
FROM journal_line l
WHERE l.account_code IN (:kode_lama_company_wide)
  AND l.site_id <> 'dc'
GROUP BY 1, 2
HAVING sum(l.debit_minor - l.credit_minor) <> 0;
```

Kalau ada baris keluar, pilihannya dua dan keduanya harus ditulis eksplisit: sapu saldonya ke HO
lewat `1-2101`, atau batalkan keputusan company-wide untuk akun itu. Jangan diam-diam menjumlahkan.

### 6.4 Peta lengkap

`uu` = akhiran unit 2 digit. Jumlah daun adalah jumlah akun posting lama yang diserap.

| Pola kode lama | Daun | → Akun baru | `unit` | `counterparty_unit` |
|---|---:|---|---|---|
| 1011001001 + `uu` | 14 | `1-1101` Kas di Tangan | `unit` = unit_of(code[10:12]) | — |
| 1011001002 + `uu` | 14 | `1-1102` Kas Kecil | `unit` = unit_of(code[10:12]) | — |
| 1011001003 + `uu` | 14 | `1-1103` Modal Kasir | `unit` = unit_of(code[10:12]) | — |
| 1011002001 + `uu` | 14 | `1-1111` Bank BCA — Giro | `unit` = HO (see §6.3) | — |
| 1011002002 + `uu` | 14 | `1-1112` Bank Mandiri — Giro | `unit` = HO (see §6.3) | — |
| 1011002003 + `uu` | 14 | `1-1113` Bank BRI — Giro | `unit` = HO (see §6.3) | — |
| 1011002004 + `uu` | 14 | `1-1114` Bank BNI — Giro | `unit` = HO (see §6.3) | — |
| 1011002005 + `uu` | 14 | `1-1115` Bank Danamon — Giro | `unit` = HO (see §6.3) | — |
| 1011003001 + `uu` | 14 | `1-1121` Bank BCA — Tabungan | `unit` = HO (see §6.3) | — |
| 1011003002 + `uu` | 14 | `1-1122` Bank Mandiri — Tabungan | `unit` = HO (see §6.3) | — |
| 1011003003 + `uu` | 14 | `1-1123` Bank BRI — Tabungan | `unit` = HO (see §6.3) | — |
| 1011003004 + `uu` | 14 | `1-1124` Bank BNI — Tabungan | `unit` = HO (see §6.3) | — |
| 1011003005 + `uu` | 14 | `1-1125` Bank BTN — Tabungan | `unit` = HO (see §6.3) | — |
| 1011004001 + `uu` | 14 | `1-1131` Deposito BCA | `unit` = HO (see §6.3) | — |
| 1011004002 + `uu` | 1 | `1-1132` Deposito Mandiri | `unit` = HO (see §6.3) | — |
| 1011004003 + `uu` | 1 | `1-1133` Deposito BRI | `unit` = HO (see §6.3) | — |
| 1011004004 + `uu` | 1 | `1-1134` Deposito BNI | `unit` = HO (see §6.3) | — |
| 1011101001 + `uu` | 14 | `1-1201` Piutang Kartu Kredit | `unit` = unit_of(code[10:12]) | — |
| 1011101002 + `uu` | 14 | `1-1202` Piutang Kartu Debit | `unit` = unit_of(code[10:12]) | — |
| 1011102001 + `uu` | 14 | `1-1203` Piutang Karyawan | `unit` = unit_of(code[10:12]) | — |
| 1011102002 + `uu` | 14 | `1-1204` Piutang Kepala Toko | `unit` = unit_of(code[10:12]) | — |
| 1011102003 + `uu` | 14 | `1-1205` Piutang Manajemen | `unit` = unit_of(code[10:12]) | — |
| 1011103001–003 + `uu` | 42 | `1-1209` Cadangan Piutang Tak Tertagih | `unit` = unit_of(code[10:12]) | — |
| 1011201001 + `uu` | 14 | `1-1301` Persediaan Barang Dagangan | `unit` = unit_of(code[10:12]) | — |
| 1011202001–010 + `uu` | 140 | `1-1302` Persediaan Perlengkapan Toko | `unit` = unit_of(code[10:12]) | — |
| 1011203001–014 + `uu` | 196 | `1-1303` Barang Dalam Perjalanan — Barang Dagangan | `unit` = unit_of(code[10:12]) | `counterparty_unit` = counterparty_of(code[7:10]) |
| 1011204001–014 + `uu` | 196 | `1-1304` Barang Dalam Perjalanan — Perlengkapan | `unit` = unit_of(code[10:12]) | `counterparty_unit` = counterparty_of(code[7:10]) |
| 1011299001–002 + `uu` | 28 | `1-1309` Cadangan Kerusakan Persediaan | `unit` = unit_of(code[10:12]) | — |
| 1011301001 + `uu` | 14 | `1-1401` Asuransi Dibayar Dimuka | `unit` = unit_of(code[10:12]) | — |
| 1011301002–004, 1011301006 + `uu` | 56 | `1-1402` Sewa Dibayar Dimuka | `unit` = unit_of(code[10:12]) | — |
| 1011301005 + `uu` | 14 | `1-1403` Kontrak Pemeliharaan Dibayar Dimuka | `unit` = unit_of(code[10:12]) | — |
| 1011301007 + `uu` | 14 | `1-1404` Biaya Promosi Dibayar Dimuka | `unit` = unit_of(code[10:12]) | — |
| 1011301008 + `uu` | 14 | `1-1405` Biaya Perijinan Dibayar Dimuka | `unit` = unit_of(code[10:12]) | — |
| 1011301009 + `uu` | 14 | `1-1409` Biaya Dibayar Dimuka Lainnya | `unit` = unit_of(code[10:12]) | — |
| 1011302001 + `uu` | 14 | `1-1411` PPh Pasal 21 Dibayar Dimuka | `unit` = unit_of(code[10:12]) | — |
| 1011302002 + `uu` | 14 | `1-1412` PPh Pasal 25 Dibayar Dimuka | `unit` = unit_of(code[10:12]) | — |
| 1011302003 + `uu` | 14 | `1-1413` PPh Pasal 29 Dibayar Dimuka | `unit` = unit_of(code[10:12]) | — |
| 1011302004 + `uu` | 14 | `1-1414` PPN Masukan | `unit` = unit_of(code[10:12]) | — |
| 1011302005 + `uu` | 14 | `1-1415` PBB Dibayar Dimuka | `unit` = unit_of(code[10:12]) | — |
| 1011302006 + `uu` | 14 | `1-1419` Pajak Dibayar Dimuka Lainnya | `unit` = unit_of(code[10:12]) | — |
| 1011303001 + `uu` | 14 | `1-1421` Uang Muka Perjalanan Dinas | `unit` = unit_of(code[10:12]) | — |
| 1011303002 + `uu` | 14 | `1-1422` Uang Muka Pembelian | `unit` = unit_of(code[10:12]) | — |
| 1011303003 + `uu` | 14 | `1-1423` Uang Muka Kontraktor | `unit` = unit_of(code[10:12]) | — |
| 1011303004 + `uu` | 14 | `1-1429` Uang Muka Lainnya | `unit` = unit_of(code[10:12]) | — |
| 1021401001–014; 1021402001–014; 1021403001–014; 2012301001–014; 2012302001–014; 2012304001–014 + `uu` | 1,176 | `1-2101` Rekening Koran Antar-Unit | `unit` = unit_of(code[10:12]) | `counterparty_unit` = counterparty_of(code[7:10]) |
| 1021501001 + `uu` | 14 | `1-2201` Tanah Hak Milik | `unit` = unit_of(code[10:12]) | — |
| 1021501002 + `uu` | 14 | `1-2202` Hak Guna Bangunan (HGB) | `unit` = unit_of(code[10:12]) | — |
| 1021502001–003 + `uu` | 42 | `1-2203` Bangunan | `unit` = unit_of(code[10:12]) | — |
| 1021503001 + `uu` | 14 | `1-2204` Instalasi Mekanikal & Elektrikal | `unit` = unit_of(code[10:12]) | — |
| 1021504001–004 + `uu` | 56 | `1-2205` Mesin & Peralatan | `unit` = unit_of(code[10:12]) | — |
| 1021505001–002 + `uu` | 28 | `1-2206` Kendaraan | `unit` = unit_of(code[10:12]) | — |
| 1021506001–007 + `uu` | 98 | `1-2207` Furniture, Fixture & Equipment | `unit` = unit_of(code[10:12]) | — |
| 1021507001–036 + `uu` | 504 | `1-2208` Operating Equipment | `unit` = unit_of(code[10:12]) | — |
| 1031803001 + `uu` | 14 | `1-2209` Aset Dalam Pengerjaan (CIP) | `unit` = unit_of(code[10:12]) | — |
| 1021601002 + `uu` | 14 | `1-2302` Akm. Penyusutan — HGB | `unit` = unit_of(code[10:12]) | — |
| 1021602001–003 + `uu` | 42 | `1-2303` Akm. Penyusutan — Bangunan | `unit` = unit_of(code[10:12]) | — |
| 1021603001 + `uu` | 14 | `1-2304` Akm. Penyusutan — Instalasi | `unit` = unit_of(code[10:12]) | — |
| 1021604001–004 + `uu` | 56 | `1-2305` Akm. Penyusutan — Mesin & Peralatan | `unit` = unit_of(code[10:12]) | — |
| 1021605001–002 + `uu` | 28 | `1-2306` Akm. Penyusutan — Kendaraan | `unit` = unit_of(code[10:12]) | — |
| 1021606001–007 + `uu` | 98 | `1-2307` Akm. Penyusutan — FFE | `unit` = unit_of(code[10:12]) | — |
| 1021607001–036 + `uu` | 504 | `1-2308` Cadangan Penggantian Operating Equipment | `unit` = unit_of(code[10:12]) | — |
| 1021701001–002 + `uu` | 28 | `1-2401` Perangkat Lunak | `unit` = unit_of(code[10:12]) | — |
| 1021702001–002 + `uu` | 28 | `1-2402` Akm. Amortisasi Perangkat Lunak | `unit` = unit_of(code[10:12]) | — |
| 1031801001 + `uu` | 14 | `1-3001` Persediaan Barang Rusak | `unit` = unit_of(code[10:12]) | — |
| 1031802001 + `uu` | 14 | `1-3002` Biaya Pra-Operasi | `unit` = unit_of(code[10:12]) | — |
| 1031802002 + `uu` | 14 | `1-3003` Akm. Amortisasi Biaya Pra-Operasi | `unit` = unit_of(code[10:12]) | — |
| 2012001001 + `uu` | 14 | `2-1101` Hutang Supplier Barang Dagangan | `unit` = unit_of(code[10:12]) | — |
| 2012001002 + `uu` | 14 | `2-1102` Hutang Supplier Barang Dagangan — Ditahan | `unit` = unit_of(code[10:12]) | — |
| 2012001003 + `uu` | 14 | `2-1103` Hutang Supplier Non-Barang Dagangan | `unit` = unit_of(code[10:12]) | — |
| 204001; 2012002001–005 + `uu` | 71 | `2-1104` Giro Keluar Belum Cair | `unit` = HO (see §6.3) | — |
| 2012101001 + `uu` | 14 | `2-1201` Hutang PPh Pasal 21 | `unit` = unit_of(code[10:12]) | — |
| 2012101002 + `uu` | 14 | `2-1202` Hutang PPh Pasal 23 | `unit` = unit_of(code[10:12]) | — |
| 2012101003 + `uu` | 14 | `2-1203` Hutang PPN Keluaran | `unit` = unit_of(code[10:12]) | — |
| 2012101004 + `uu` | 14 | `2-1204` Hutang PBB | `unit` = unit_of(code[10:12]) | — |
| 2012101005 + `uu` | 14 | `2-1205` Hutang PPh Pasal 25 | `unit` = unit_of(code[10:12]) | — |
| 2012201001–002, 2012201004–005 + `uu` | 56 | `2-1301` Beban Pegawai YMHD | `unit` = unit_of(code[10:12]) | — |
| 2012201006–008 + `uu` | 42 | `2-1302` Beban Utilitas YMHD | `unit` = unit_of(code[10:12]) | — |
| 2012201009–010 + `uu` | 28 | `2-1303` Beban Sewa YMHD | `unit` = unit_of(code[10:12]) | — |
| 2012201003 + `uu` | 14 | `2-1304` Beban Bunga YMHD | `unit` = unit_of(code[10:12]) | — |
| 205001 + `uu` | 1 | `2-1401` Uang Muka Penjualan & Voucher | `unit` = HO (see §6.3) | — |
| 2012303001–014 + `uu` | 196 | `2-1501` Hutang kepada Pemilik | `unit` = unit_of(code[10:12]) | — |
| 2012501001 + `uu` | 14 | `2-1601` Pinjaman Jatuh Tempo — Pemilik | `unit` = HO (see §6.3) | — |
| 2012502001–005 + `uu` | 70 | `2-1602` Pinjaman Jatuh Tempo — Bank | `unit` = HO (see §6.3) | — |
| 2022401001 + `uu` | 14 | `2-2001` Pinjaman Jangka Panjang — Pemilik | `unit` = HO (see §6.3) | — |
| 2022402001–005 + `uu` | 70 | `2-2002` Pinjaman Jangka Panjang — Bank | `unit` = HO (see §6.3) | — |
| 3013001001 + `uu` | 14 | `3-1001` Modal Disetor | `unit` = HO (see §6.3) | — |
| 3013001002 + `uu` | 14 | `3-1002` Laba Ditahan | `unit` = HO (see §6.3) | — |
| 3013001003 + `uu` | 14 | `3-1003` Laba (Rugi) Tahun Berjalan | `unit` = HO (see §6.3) | — |
| 3013001004 + `uu` | 14 | `3-1004` Prive | `unit` = HO (see §6.3) | — |
| 4010110001; 4010111001–004; 4010112001–002; 4010113001–002 + `uu` | 126 | `4-1001` Penjualan Barang Dagangan | `unit` = unit_of(code[10:12]) | — |
| 4010213001 + `uu` | 14 | `4-1002` Potongan Penjualan | `unit` = unit_of(code[10:12]) | — |
| 4010214001 + `uu` | 14 | `4-1003` Retur Penjualan | `unit` = unit_of(code[10:12]) | — |
| 4020110001 + `uu` | 14 | `4-2001` Management Fee | `unit` = unit_of(code[10:12]) | — |
| 8010110001 + `uu` | 14 | `4-2002` Pendapatan Bunga Bank | `unit` = HO (see §6.3) | — |
| 8010110003 + `uu` | 14 | `4-2003` Potongan Pembelian | `unit` = unit_of(code[10:12]) | — |
| 8010110004–005 + `uu` | 28 | `4-2004` Pendapatan Sewa | `unit` = unit_of(code[10:12]) | — |
| 600104; 8010110007 + `uu` | 15 | `4-2009` Pendapatan Lain-lain | `unit` = unit_of(code[10:12]) | — |
| 5010110001 + `uu` | 14 | `5-1001` Harga Pokok Penjualan | `unit` = unit_of(code[10:12]) | — |
| 6010110001 + `uu` | 14 | `6-1001` Perlengkapan Pelanggan | `unit` = unit_of(code[10:12]) | — |
| 6010110002 + `uu` | 14 | `6-1002` Biaya Kartu Kredit & Debit | `unit` = unit_of(code[10:12]) | — |
| 6010110003 + `uu` | 14 | `6-1003` Biaya Promosi | `unit` = unit_of(code[10:12]) | — |
| 6010110004 + `uu` | 14 | `6-1004` Biaya Dekorasi | `unit` = unit_of(code[10:12]) | — |
| 6010110005 + `uu` | 14 | `6-1005` Biaya Iklan | `unit` = unit_of(code[10:12]) | — |
| 6010110006 + `uu` | 14 | `6-1006` Biaya Bongkar Muat | `unit` = unit_of(code[10:12]) | — |
| 6010110007 + `uu` | 14 | `6-1007` Biaya Pengiriman Barang | `unit` = unit_of(code[10:12]) | — |
| 6010110008 + `uu` | 14 | `6-1008` Kerusakan Persediaan | `unit` = unit_of(code[10:12]) | — |
| 6010111001; 6010210001 + `uu` | 28 | `6-2001` Gaji & Upah | `unit` = unit_of(code[10:12]) | — |
| 6010111002; 6010210002 + `uu` | 28 | `6-2002` Biaya Lembur | `unit` = unit_of(code[10:12]) | — |
| 6010111003; 6010210003 + `uu` | 28 | `6-2003` Uang Makan | `unit` = unit_of(code[10:12]) | — |
| 6010111004; 6010210004 + `uu` | 28 | `6-2004` Uang Transport | `unit` = unit_of(code[10:12]) | — |
| 6010111005; 6010210005 + `uu` | 28 | `6-2005` Kesehatan & Pengobatan | `unit` = unit_of(code[10:12]) | — |
| 6010111006; 6010210006 + `uu` | 28 | `6-2006` Asuransi Pegawai & BPJS | `unit` = unit_of(code[10:12]) | — |
| 6010111007; 6010210007 + `uu` | 28 | `6-2007` Tunjangan Hari Raya (THR) | `unit` = unit_of(code[10:12]) | — |
| 6010111008; 6010210008 + `uu` | 28 | `6-2008` Seragam Kerja | `unit` = unit_of(code[10:12]) | — |
| 6010111009; 6010210009 + `uu` | 28 | `6-2009` Olahraga & Rekreasi | `unit` = unit_of(code[10:12]) | — |
| 6010111010; 6010210010 + `uu` | 28 | `6-2010` Sumbangan Duka | `unit` = unit_of(code[10:12]) | — |
| 6010111011; 6010210011 + `uu` | 28 | `6-2011` Pengembangan SDM | `unit` = unit_of(code[10:12]) | — |
| 6010111012; 6010210012 + `uu` | 28 | `6-2012` Pesangon | `unit` = unit_of(code[10:12]) | — |
| 6010111013; 6010210013 + `uu` | 28 | `6-2013` Komisi, Bonus & Insentif | `unit` = unit_of(code[10:12]) | — |
| 6010310001 + `uu` | 14 | `6-3001` Biaya Kebersihan | `unit` = unit_of(code[10:12]) | — |
| 6010310002 + `uu` | 14 | `6-3002` ATK & Barang Cetakan | `unit` = unit_of(code[10:12]) | — |
| 6010310003 + `uu` | 14 | `6-3003` Biaya Rumah Tangga Kantor | `unit` = unit_of(code[10:12]) | — |
| 6010310004 + `uu` | 14 | `6-3004` Biaya Bank | `unit` = unit_of(code[10:12]) | — |
| 6010310005, 6010310020 + `uu` | 28 | `6-3005` Telepon, Faksimili & Internet | `unit` = unit_of(code[10:12]) | — |
| 6010310006 + `uu` | 14 | `6-3006` Biaya Listrik | `unit` = unit_of(code[10:12]) | — |
| 6010310007 + `uu` | 14 | `6-3007` Biaya Air (PDAM) | `unit` = unit_of(code[10:12]) | — |
| 6010310008 + `uu` | 14 | `6-3008` Biaya Perjalanan Dinas | `unit` = unit_of(code[10:12]) | — |
| 6010310009 + `uu` | 14 | `6-3009` Biaya Transport Lokal | `unit` = unit_of(code[10:12]) | — |
| 6010310010 + `uu` | 14 | `6-3010` Biaya Perijinan | `unit` = unit_of(code[10:12]) | — |
| 6010310011 + `uu` | 14 | `6-3011` Beban Komputer | `unit` = unit_of(code[10:12]) | — |
| 6010310012 + `uu` | 14 | `6-3012` Penyisihan Kerugian Piutang | `unit` = unit_of(code[10:12]) | — |
| 6010310013 + `uu` | 14 | `6-3013` Perlengkapan Toko & Kantor | `unit` = unit_of(code[10:12]) | — |
| 6010310014 + `uu` | 14 | `6-3014` Biaya Stock Opname | `unit` = unit_of(code[10:12]) | — |
| 6010310015 + `uu` | 14 | `6-3015` Peralatan Listrik | `unit` = unit_of(code[10:12]) | — |
| 6010310016 + `uu` | 14 | `6-3016` Ban & Suku Cadang Kendaraan | `unit` = unit_of(code[10:12]) | — |
| 6010310017, 6010310019 + `uu` | 28 | `6-3017` Bahan Bakar & Pelumas | `unit` = unit_of(code[10:12]) | — |
| 6010310018 + `uu` | 14 | `6-3018` Peralatan Kerja (Tools) | `unit` = unit_of(code[10:12]) | — |
| 6010310021 + `uu` | 14 | `6-3021` Donasi, CSR & Zakat | `unit` = unit_of(code[10:12]) | — |
| 6010310022 + `uu` | 14 | `6-3022` Biaya Konsultan | `unit` = unit_of(code[10:12]) | — |
| 6010310023 + `uu` | 14 | `6-3023` Lisensi Kendaraan (STNK, KIR) | `unit` = unit_of(code[10:12]) | — |
| 6010310024 + `uu` | 14 | `6-3024` Perlengkapan Mess | `unit` = unit_of(code[10:12]) | — |
| 6010310099 + `uu` | 14 | `6-3099` Beban Administrasi Lain-lain | `unit` = unit_of(code[10:12]) | — |
| 6010410001 + `uu` | 14 | `6-4001` Perawatan FFE | `unit` = unit_of(code[10:12]) | — |
| 6010410002 + `uu` | 14 | `6-4002` Perawatan Perangkat Lunak | `unit` = unit_of(code[10:12]) | — |
| 6010410003 + `uu` | 14 | `6-4003` Perawatan Komputer | `unit` = unit_of(code[10:12]) | — |
| 6010410004, 6010410009 + `uu` | 28 | `6-4004` Perawatan Bangunan | `unit` = unit_of(code[10:12]) | — |
| 6010410005 + `uu` | 14 | `6-4005` Perawatan Mess | `unit` = unit_of(code[10:12]) | — |
| 6010410006 + `uu` | 14 | `6-4006` Perawatan Kendaraan | `unit` = unit_of(code[10:12]) | — |
| 6010410007 + `uu` | 14 | `6-4007` Perawatan AC & Pendingin | `unit` = unit_of(code[10:12]) | — |
| 6010410008 + `uu` | 14 | `6-4008` Biaya Power Plant | `unit` = unit_of(code[10:12]) | — |
| 6010410010 + `uu` | 14 | `6-4009` Perawatan Lift | `unit` = unit_of(code[10:12]) | — |
| 7010110001 + `uu` | 14 | `7-1001` Sewa Tanah | `unit` = unit_of(code[10:12]) | — |
| 7010110002 + `uu` | 14 | `7-1002` Amortisasi Hak Guna Bangunan | `unit` = unit_of(code[10:12]) | — |
| 7010110003 + `uu` | 14 | `7-1003` Sewa Bangunan Toko & Gudang | `unit` = unit_of(code[10:12]) | — |
| 7010110004 + `uu` | 14 | `7-1004` Sewa Rumah Dinas | `unit` = unit_of(code[10:12]) | — |
| 7010210001–003 + `uu` | 42 | `7-2001` Penyusutan Bangunan | `unit` = unit_of(code[10:12]) | — |
| 7010211001 + `uu` | 14 | `7-2002` Penyusutan Instalasi | `unit` = unit_of(code[10:12]) | — |
| 7010212001–004 + `uu` | 56 | `7-2003` Penyusutan Mesin & Peralatan | `unit` = unit_of(code[10:12]) | — |
| 7010213001–002 + `uu` | 28 | `7-2004` Penyusutan Kendaraan | `unit` = unit_of(code[10:12]) | — |
| 7010214001–007 + `uu` | 98 | `7-2005` Penyusutan FFE | `unit` = unit_of(code[10:12]) | — |
| 7010215001–036 + `uu` | 504 | `7-2006` Beban Penggantian Operating Equipment | `unit` = unit_of(code[10:12]) | — |
| 7010216001, 7010216003 + `uu` | 28 | `7-2007` Amortisasi Perangkat Lunak | `unit` = unit_of(code[10:12]) | — |
| 7010216002 + `uu` | 14 | `7-2008` Amortisasi Biaya Pra-Operasi | `unit` = unit_of(code[10:12]) | — |
| 7010310001 + `uu` | 14 | `7-3001` Asuransi Properti & Kebakaran | `unit` = unit_of(code[10:12]) | — |
| 7010310002 + `uu` | 14 | `7-3002` Pajak Bumi & Bangunan (PBB) | `unit` = unit_of(code[10:12]) | — |
| 7020310003 + `uu` | 14 | `7-3003` Pajak Reklame | `unit` = unit_of(code[10:12]) | — |
| 7020310004 + `uu` | 14 | `7-3004` Biaya Management Fee | `unit` = unit_of(code[10:12]) | — |
| 7020310005 + `uu` | 14 | `7-3005` Asuransi Kendaraan | `unit` = unit_of(code[10:12]) | — |
| 8010110002 + `uu` | 14 | `8-1001` Selisih Pembulatan | `unit` = unit_of(code[10:12]) | — |
| 8010110006 + `uu` | 14 | `8-1002` Selisih Stock Opname | `unit` = unit_of(code[10:12]) | — |
| 8020111001 + `uu` | 14 | `8-2001` Bunga Pinjaman Bank | `unit` = HO (see §6.3) | — |
| 8020111002 + `uu` | 14 | `8-2002` Bunga Leasing | `unit` = HO (see §6.3) | — |
| 8030112001 + `uu` | 14 | `8-3001` Beban Pajak Penghasilan | `unit` = HO (see §6.3) | — |

---

## 7. Cacat dan keanehan di bagan klien

Semua angka dihitung dari CSV, bukan diperkirakan.

### 7.1 Dimensi yang dipanggang ke dalam kode akun — 6.526 dari 6.908 (94,5%)

Cacat induk. 382 arti dikali 14 unit (dan 9 di antaranya dikali 14 lagi). Akibat langsungnya:
setiap arti baru berarti 14 kode baru yang harus dibuat, dinamai, dan dipetakan dengan benar —
dan sekali saja salah satunya salah, jurnalnya tetap seimbang dan tidak ada neraca yang bisa melihatnya.

### 7.2 Matriks yang dibangkitkan padat — 1.542 dari 1.764 sel (87,4%) tak terjangkau

- **126 sel diagonal** (unit melawan dirinya sendiri), mis. `101120300100`
  `BDP Barang Dagangan HEAD OFFICE - HO`.
- Barang hanya bisa DC↔toko (`AllotmentType` tidak punya toko→toko sama sekali), uang hub-and-spoke.
  Maksimal 26 dari 196 pasangan per keluarga.
- **`2012303` bukan matriks sama sekali** — lawannya "PRINCIPAL", bukan unit. 196 sel untuk 14 fakta.

### 7.3 Arti kembar — 13 pasang, 364 daun untuk 13 arti

`6010111` **BIAYA PEGAWAI OPERATION** dan `6010210` **BEBAN PEGAWAI OFFICE** memuat 13 arti yang
sama, dua kali. **11 dari 13 namanya identik huruf-per-huruf** (`Biaya Lembur`, `Uang Makan`,
`Tunjangan Hari Raya (THR)`, `Funeral Contribution`, …); dua sisanya berbeda hanya karena kata
dan salah ketik (`Biaya Gaji Karyawan` vs `Biaya Gaji Pegawai`; `Uang Transport` vs `Uang Transpot`).

Bedanya cuma apakah pegawainya bekerja di toko atau di kantor — **dan itu unit.**
Buktinya ada di flag aktif: di keluarga OPERATION, `Biaya Lembur`, `Uang Transport`, dan
`Biaya Manpower Development` **hidup hanya di unit `00` (HO)** dan mati di 13 toko, sementara
salinan OFFICE-nya hidup di seluruh 14 unit. Persis terbalik dari yang namanya janjikan.

### 7.4 Akun yang sebenarnya dimensi atau master data

| Yang dipecah | Template | Daun | Seharusnya tinggal di |
|---|---:|---:|---|
| Jenis barang Operating Equipment (rak, patung, hanger) | 108 (3 keluarga × 36) | 1.512 | asset register |
| Identitas bank / pemberi pinjaman | 33 | 462 | bank account & loan register |
| Sub-kelas FFE | 21 (3 keluarga × 7) | 294 | asset register |
| Tender & kanal penjualan (tunai, debit per bank, VISA, Master, web, marketplace) | 9 | 126 | sisi pembayaran (tender) |
| SKU kantong belanja (plastik/kertas × 5 ukuran) | 10 | 140 | inventory ledger |

Yang terakhir soal bank layak ditekankan: **33 template bank × 14 unit = 462 daun untuk paling
banyak 14 rekening bank nyata**, padahal kebijakan pemilik adalah **toko tidak memegang rekening
bank sama sekali**.

> Konsekuensi nyata di repo ini: `fixed_asset.category_code` adalah
> `REFERENCES ledger_account(account_code)`, dan `scripts/import_client_assets.py` menyimpan
> sub-jenis **10 karakter** (`1021507027`) ke sana, sementara `scripts/seed-finance.py`
> memetakan qualifier `account_map` di **7 karakter** (`1021507`). Kategori hasil impor tidak
> punya pemetaan, dan depreciation run menolaknya. Bagan dipakai sebagai daftar kategori aset,
> dan hari ini itu sudah rusak. Meleburkan OE ke satu akun **mengharuskan** `asset_class` jadi
> tabel milik asset register — yang sekaligus memperbaiki bug tadi.

### 7.5 Akun salah induk

| Kode | Masalah | Daun |
|---|---|---:|
| `7020310` (3 template) | menggantung di rung-5 `70203` yang **tidak ada**; seharusnya `7010310` | 42 |
| `7010310` | punya 2 template tapi **tidak ada baris rung-7**-nya — group-nya tersirat, tak pernah dideklarasikan | 28 |
| `8010110001/003/004/005/007` | akun **pendapatan** (bunga bank, potongan pembelian, sewa, lain-lain) di bawah akar **beban** `8` | 70 |
| `600104` | akun **pendapatan** ("Pendapatan lain-lain") di bawah akar **beban** `6`, 6 digit, induk langsung ke akar | 1 |
| `204001`, `205001` | 6 digit, induk langsung ke akar `2`; melompati dua rung | 2 |
| `1031803` Contract In Progress | difilekan di **Other Assets** (103), padahal aset tetap yang menunggu kapitalisasi | 14 |
| `1021601` | indeks template mulai dari `002`; tidak ada `001` | — |
| `1011004` | 1 dari 4 template diekspansi ×14, **3 sisanya tidak punya daun sama sekali** — tiga akun posting duduk di kedalaman group | 3 |

### 7.6 Akun mati — 104 daun, 0 template mati seluruhnya

Semua 104 baris `N` ada di rung-12; tak satu pun template mati di seluruh 14 unit, jadi tidak ada
satu arti pun yang bisa dibuang bersih. Yang paling tajam:

- `4010113001/002` **Penjualan Online** (Sendiri + Market Place): **26 dari 28 daun mati**.
  Yang hidup hanya unit `13` (C013). Kanal online yang ada di bagan tapi praktis tidak dipakai.
- `6010111002/004/011` (Lembur, Uang Transport, Manpower Development): masing-masing 13 dari 14 mati.
- Sisanya tersebar tipis di 19 template lain.

### 7.7 Nama yang berselisih dengan kodenya

- **`102160400305`** bernama `Akum-Penyu Mesin - Esklator **C006**` padahal akhirannya `05` = **C005**.
  Satu-satunya kasus di 6.902 daun, dan satu-satunya yang bisa membuat orang memposting ke unit
  yang salah sambil membaca nama yang benar.
- **`6010310004`** template-nya bernama `Biaya Bank **HO**` tetapi tetap diekspansi ×14, sehingga
  bagan memuat `Biaya Bank HO` di HO dan `Biaya Bank C001` di toko — nama template memanggang
  sebuah unit yang kemudian dibantah oleh akhirannya.
- 4 daun tidak memuat token unit yang terbaca: `Prepaid - PPh Pasal 25 **H0**` dan
  `PPh Pasal 29 **H0**` (angka nol, bukan huruf O), `Tanah Hak Milik**C008**` dan
  `Biaya Lembur**C001**` (spasi hilang).

### 7.8 Kebersihan nama

| Pola | Baris |
|---|---:|
| spasi ganda di tengah nama | 1.231 |
| `Penyusu` (potongan dari `Penyusutan`) | 186 |
| `Cad,` — koma di dalam nama, memaksa quoting CSV | 45 |
| huruf berspasi (`F u e l  & O I l`) | 45 |
| `Esklator` (seharusnya `Eskalator`, dan `1021504003` menulisnya benar) | 15 |
| `Transpot` (seharusnya `Transport`) | 15 |
| `Expences` (seharusnya `Expenses`) | 3 |
| `H0` dengan angka nol | 2 |
| `Sevent Soft` (seharusnya `Seventh Soft`) | 1 |

Semuanya sepele satu per satu; totalnya berarti nama akun **tidak bisa dipakai sebagai kunci**
untuk apa pun, termasuk untuk mencocokkan bagan lama dengan bagan baru. Pemetaan harus lewat kode.

### 7.9 Cacat di sisi kita, bukan di bagan klien

`scripts/import-coa.py` mendeklarasikan `MATRIX_FAMILIES = ("1011203", "1011204")` — **dua dari
sembilan**. Tujuh keluarga afiliasi (`1021401/02/03`, `2012301/02/03/04`) karenanya diimpor dengan
`counterparty_site_id = NULL`, dan indeks rung-10-nya diperlakukan sebagai template biasa.
**1.372 daun antar-unit masuk tanpa lawan.** Docstring skrip itu sendiri memperingatkan persis
kesalahan ini ("the first transfer posted against them is wrong in a way no trial balance can see,
because it still balances") — peringatannya benar, cakupannya kurang tujuh keluarga.

---

## 8. Yang masih harus diputuskan pemilik

1. **Apakah 14 unit itu satu badan hukum atau empat belas?** Ini satu-satunya pertanyaan yang
   mengubah jawaban.
   - *Satu badan hukum* (default yang dipakai di sini, dan yang konsisten dengan repo: satu
     tabel `site`, satu ledger): **ekuitas company-wide** (`3-1001`…`3-1004`), `1-2101` harus
     nol secara total dan hilang saat konsolidasi, dan saldo ekuitas per unit di bagan lama
     disapu ke `1-2101` saat migrasi (§4.4).
   - *Badan hukum terpisah*: **balik empat akun ekuitas jadi `dimension: unit`**, dan `1-2101`
     menjadi saldo pihak berelasi yang **tidak** dieliminasi. **Bagannya tidak berubah selain
     satu flag di empat baris.**
2. **Nama 14 unit.** Bagan lama menyebut HEAD OFFICE · CIKUPA · MUARO BUNGO · PURBALINGGA ·
   BUMIAYU · JAMBI · WIRAMODE · BREBES · PASURUAN · WMJB · WMBA · SIPIN · BANJARAN · WONOSOBO
   di sumbu lawan, dan `C001`–`C013` di akhiran, tetapi **tidak pernah menyambungkan keduanya**.
   Offset ordinal adalah tebakan. Semua saldo antar-unit bergantung padanya.
3. **Pendapatan per tender/kanal** (`4-1001`). Usulan: satu akun; tender ada di sisi pembayaran.
   Kalau pemilik ingin pendapatan per kanal, itu **sumbu kedua** dan harus diputuskan sengaja —
   bukan diwarisi dari 9 akun yang 26 dari 28 daun online-nya sudah mati.
4. **Akrual** (`2-1301`…`2-1304`). 10 akrual klien jadi 4. Bisa juga jadi 1 (akrual dibalik
   periode berikutnya dan detailnya ada di dokumennya). Kunci `accrued_expense` di repo sudah
   *qualified*, jadi 4 aman.
5. **Enam akun di luar tangga** (3 time deposit, `204001`, `205001`, `600104`): bagan baru
   sudah memberi rumah yang benar kepada keenamnya. Yang perlu dikonfirmasi hanya satu:
   `205001 Uang Muka - Penjualan` dibuat **company-wide** karena voucher bisa ditebus di toko
   mana pun — sehingga kewajibannya milik jaringan, bukan milik toko yang menjualnya.
6. **`fixed_asset.category_code`** berhenti menunjuk `ledger_account` dan jadi tabel
   `asset_class` milik asset register (§7.4). Tanpa itu, peleburan OE tidak bisa dijalankan —
   dan dengan itu, bug qualifier 10-vs-7 karakter yang ada sekarang ikut hilang.
7. **Akun yang tidak ada di bagan klien dan dibutuhkan — daftar lengkapnya, EMPAT**. Ini
   satu-satunya akun di bagan ini yang MILIK KITA, bukan milik klien, dan karena itu ditulis
   di sini sebagai daftar dan bukan ditemukan belakangan. Keempatnya kecil dan keempatnya
   wajib:
   - `1-1104 Setoran Dalam Perjalanan` — setoran harian adalah dokumen dua tanggal.
   - `8-1003 Selisih Kas` — migrasi 0216 membiarkan akun selisihnya dipilih saat posting.
   - `1-1206 Piutang QRIS` (`1011101003`, dari 0248) — bagan klien **lebih tua dari QRIS**,
     jadi tidak ada akun kliennya dan tidak mungkin ada. QRIS diselesaikan lewat rel lain,
     di hari lain, dengan MDR lain, dan terhadap laporan settlement lain daripada kartu;
     tanpa akun sendiri ia tak punya lawan rekonsiliasi sama sekali.
   - `1-1207 Piutang Tender Lain-Lain` (`1011101004`, dari 0248) — tidak ada tender TRANSFER,
     jadi transfer di konter masuk sebagai OTHER. Uang yang belum bernama harus tetap terlihat
     sampai ada yang menamainya.

   Keempatnya ditandai `NEW.` di `coa-final.json` dengan `legacy_templates` kosong — itulah
   yang menyatakan **tidak ada akun klien yang menjadi akun ini**. Yang ditanyakan ke pemilik
   hanya satu hal: apakah bagan mereka boleh bertambah empat baris. Artinya tidak dikarang —
   kasir sudah menerima QRIS selama ini.

---

## 9. Berkas

- `coa-final.json` — **300** objek akun, machine-readable (219 waktu dokumen ini ditulis; §10
  menjelaskan 79 rung yang ditambahkan 0247 dan 2 akun yang datang dari 0248). Field: `code`,
  `client_code`, `name`, `name_en`, `type`, `kind` (`group`/`posting`), `parent`, `dimension`
  (`unit`/`company`), `counterparty_unit`, `normal_balance`, `contra`, `legacy_templates`,
  `legacy_leaves`, `note`.
- Rekonstruksi diverifikasi oleh skrip: setiap satu dari **499** kode posting lama
  (493 template + 3 rung-10 tanpa anak + 3 rung-6) terpetakan **tepat satu kali**, menutupi
  seluruh **6.908** akun posting klien. Skrip menolak memancarkan hasil kalau ada satu saja
  yang tak terpetakan atau terpetakan dua kali.

---

## 10. Tangga yang hilang — dan 0247 yang mengembalikannya

Ditulis **2026-09-14**, setelah bagan §5 dipasang. Analisis di atas tidak berubah; bagian ini
mencatat satu hal yang **potongan pertama** salah lakukan, dan apa yang mengembalikannya.

### 10.1 Apa yang jatuh

Bagan klien memanjat tangga lima anak tangga dan **tidak pernah melewatinya**: 1 digit untuk
kelas, 3 untuk seksi, 5 untuk grup, 7 untuk keluarga, 10 untuk akun (12 di berkas impor, dua
digit terakhir adalah unit yang dicopot 0243). Ketujuh-ribu-lima-ratus-dua-puluh-delapan akun
mereka ada di tangga itu. Anak tangga 7 digit saja ada **76**.

`coa-final.json` versi pertama menyimpan 44 grup dan **hanya lima** dari 76 keluarga itu — dan
membuangnya **tidak rata**. Di bawah `10113 Biaya Dibayar Dimuka`, dua dari tiga saudara
mempertahankan rung-nya (`1011302 Pajak Dibayar Dimuka`, `1011303 Uang Muka`) dan satu tidak:
enam akun `1011301*` digantung langsung ke `10113`.

Dihitung di bagan 219 itu, hanya **24 dari 175** akun posting yang duduk di tempat yang akan
klien pilih:

| anak → induk | baris | |
|---|---:|---|
| 3 → 1 | 7 | di tangga |
| 5 → 1 | 10 | melewati rung 3 digit |
| 5 → 3 | 14 | di tangga |
| 7 → 5 | 5 | di tangga |
| 10 → 1 | 5 | melewati tiga rung |
| 10 → 3 | 13 | melewati dua |
| 10 → 5 | **133** | melewati satu |
| 10 → 7 | 24 | di tangga |

### 10.2 Kenapa itu salah

Bukan karena tangganya indah. Karena bagan yang punya **dua bentuk** tidak bisa dibaca dengan
satu aturan:

1. **Aplikasinya mati, bukan bagannya yang terlihat aneh.** Dua layar berhenti — `not found:
   account 1011301` di Prepaids dan `not found: account 1011101` di Receivables — karena
   keduanya membaca satu keluarga **di kode grupnya**, yang memang cara bagan klien dibaca.
2. **Dua induk memegang grup dan posting sekaligus** (`10110`, `10113`). Bagan klien tidak
   pernah melakukan itu di mana pun. `10113` bukan pengganti `1011301`: ia juga memegang
   `1011302` dan `1011303`, jadi membacanya di situ menghitung dua keluarga lain dua kali.
3. **Namanya ikut naik.** Di beberapa tempat potongan pertama bukan hanya membuang rung-nya,
   tapi memindahkan **nama** rung itu ke grup di atasnya — `10113` yang di bagan klien bernama
   `PREPAID` muncul sebagai `Biaya Dibayar Dimuka`, yaitu nama `1011301`. Jadi rung-nya hilang
   dan jejaknya ikut hilang.

### 10.3 Yang mengembalikannya — migrasi 0247

`0247_every_posting_sits_on_the_clients_own_ladder.sql` membuat **79 rung yang hilang** — 7 di
tiga digit, 8 di lima, 64 di tujuh — lalu menggantung ulang **setiap** akun ke kode grup
terpanjang yang menjadi awalannya.

| rung | sebelum | sesudah |
|---:|---:|---:|
| 1 | 8 | 8 |
| 3 | 7 | 14 |
| 5 | 24 | 32 |
| 7 | 5 | 69 |
| **grup** | **44** | **123** |
| posting | 175 | 175 |

Bagan jadi **298 baris**. Masih 25× lebih kecil dari 7.528 milik klien, dan sekarang
**berbentuk sama** dengan punya mereka.

**Nama diambil dari bagan klien, bukan dikarang.** Tiga aturan, berurutan: (1) klien punya baris
di kode itu — pakai nama mereka, hanya **huruf besar-kecilnya** disesuaikan ke konvensi bagan
ini (`PIUTANG DAGANG` → `Piutang Dagang`; `dan`, `atau`, `di`, `and`, `on` tetap kecil;
`LAIN - LAIN` ditulis `Lain-lain`), kata dan ejaannya tidak — termasuk `Akumulasi Penyusu -Tanah`
dan `AFFILIASI` yang memang begitu di berkas mereka; (2) kodenya kita yang cetak tapi klien
menyimpan akun yang sama di kode lain — nama diambil dari **sana** (`1021508` dari `1031803`,
`2012401` dari `205001`, `7010310` dari `70103`, `40202`/`4020210` dari `80101`/`8010110`);
(3) tidak ada padanannya sama sekali — satu rung, `1011005`, memakai nama akun yang ia pegang.
`name_en` sengaja **NULL** di ke-79-nya: kolom Inggris itu milik kita, dan menerjemahkan rung
klien akan menjadi otoritas kedua.

Dua akibat yang dibiarkan kelihatan, bukan dirapikan: sebuah rung sering **mengulang nama
induknya** (`70103 Beban Usaha Lainnya` di atas `7010310 Biaya Usaha Lainnya`) — itu memang
bagan klien, di mana grup dengan satu keluarga dieja dua kali; dan dua rung kini memegang lebih
dari yang namanya sebut, karena 0244 melebur keluarga (`1021401 Piutang Affiliasi Pembiayaan`
juga memegang 1021402/1021403 dan 2012301/2012302/2012304; `6010210 Beban Pegawai Office` juga
memegang gaji lantai toko dari `6010111`). Peleburannya tercatat di `ledger_account_remap` —
mengganti nama rung-nya justru akan menyembunyikannya.

### 10.4 Tidak ada satu rupiah pun yang bergerak

`journal_line` tidak disentuh sama sekali; yang berubah hanya `ledger_account.parent_code` dan
79 baris grup baru. Neraca saldo **per akun dan per site** di-snapshot sebelum dan dibandingkan
sesudah, **di dalam transaksi migrasi itu sendiri** — 126 pasang akun/site, 14 site, 4.377 baris
jurnal, Rp 89.670.739,87 debit dan kredit, identik. Uji terima yang sama yang harus dilewati
0244; `scripts/verify-coa-collapse.py` adalah bentuk panjangnya (angka 219/44/175 di skrip itu
adalah angka 0244, sebelum 0247).

### 10.5 Empat invarian, ditegakkan bukan diharapkan

0247 menolak commit kalau salah satu dari ini tidak benar — bukan dicek belakangan oleh skrip:

1. Setiap akun posting menggantung di grup **7 digit**.
2. **Tidak ada rung yang dilewati**: 7 di bawah 5, 5 di bawah 3, 3 di bawah 1, kelas 1 digit di
   bawah tidak ada.
3. **Tidak ada induk yang memegang grup dan posting sekaligus.**
4. **Tidak ada grup tanpa anak** — rung yang dibuat lalu dibiarkan kosong adalah jenis
   ketidaktertiban baru, bukan perbaikan.

Rung yang perlu dibuat **diturunkan dari akun yang ada**, bukan dari daftar 79 kode, supaya akun
yang ditambahkan migrasi lain ikut dapat rung-nya. Yang didaftar hanya **namanya**; rung yang
dibutuhkan tapi tak bernama menghentikan migrasi dengan kodenya di pesan error, bukan diberi nama
karangan. Migrasinya idempoten: dijalankan dua kali, `INSERT 0 0` / `UPDATE 0`, invarian tetap
diperiksa.

### 10.6 Fixture-nya ikut, dan satu yang masih terbuka

`coa-final.json` sekarang **300 baris** — 123 grup + 177 posting; dua posting terakhir
(`1011101003 Piutang QRIS`, `1011101004 Piutang Tender Lain-Lain`) datang dari 0248, bukan dari
sini. Setiap baris sekarang punya `client_code`, sehingga fixture dan migrasi bisa **dicocokkan
baris demi baris** dan bukan hanya dipercaya: 298 baris bagan dicek, 0 selisih. Rung yang
dipulihkan memakai **digit klien sendiri** sebagai `code`-nya, karena skema `1-1100` tidak punya
slot untuk rung — skema itulah yang membuangnya.

Yang tadinya terbuka sudah **ditutup**: 0248 sempat menulis `parent_code = '10111'` untuk kedua
akun QRIS-nya, yang setelah 0247 akan menggantung dua posting di grup 5 digit lagi dan membuat
`10111` jadi induk campuran. Sekarang keduanya lahir di `1011101 Piutang Dagang`, bersebelahan
dengan `1011101002` yang uangnya diambil dari sana — tiga saudara di satu rung. Dengan itu
tangga ini sudah bisa dijadikan CHECK permanen (`length(parent_code)` = rung sebelumnya); hari
ini belum dipasang, dan alasannya bukan lagi 0248.

---

## 11. Nama-namanya milik klien — dan 0253 yang mengembalikannya

### 11.1 Aturannya

Pemilik memutuskannya setelah menemukan `1021401001 Rekening Koran Antar-Unit` di bagan kita —
nama yang **tidak ada di bagan klien mana pun**, duduk di kode milik klien yang di file mereka
berbunyi `Piutang Affiliasi Pembiayaan HEAD OFFICE`:

> **Kita tidak boleh mengarang akun yang tidak dimiliki klien, dan tidak boleh mengganti nama
> akun yang mereka miliki.** Bagan mereka adalah otoritasnya — termasuk inkonsistensinya,
> HURUF BESARNYA, campuran Inggris-Indonesianya, spasi gandanya, dan salah ketiknya.

Putusan itu punya dua paruh, dan yang kedua mempersempit yang pertama
(*"jangan terjemahkan, jangan beda kata, huruf besar / spasi / tanda baca tidak apa"*):

* **kata**-nya tidak boleh berubah, dan tidak boleh diterjemahkan;
* **huruf besar, spasi dan tanda baca bebas** — `LAIN - LAIN` dan `Lain-lain` adalah nama yang
  sama, dan tidak sepadan dengan sebuah migrasi.

Ujinya karena itu mekanis, dan **ditegakkan di dalam 0253**, bukan dikira-kira: buang semua
karakter non-alfanumerik dari kedua nama, kecilkan hurufnya, harus sama.

Satu hal yang bagan klien lakukan dan **tidak** kita tiru: **memotong kata**. `Akum-Penyusu`,
`Acc Amort`, `Cad,`, `YMHD`, `PJP`, `OE`, `BDP`, `FFE` dan `HO` dieja penuh — melengkapi kata
yang dipotong bukan menerjemahkannya dan bukan menggantinya (lihat §7.8, yang sudah menghitung
pola-pola ini di sisi klien). Akronim yang **bukan** potongan kata tetap: nama bank (BCA,
Mandiri, BRI, BNI, BTN, Danamon), nama pajak (PPN, PPh, PBB, VAT), lembaga (BPJS, PDAM), STNK,
KIR, CSR, HGB dan CIP.

### 11.2 Apa yang 0253 kerjakan

| | jumlah |
|---|---:|
| nama dikembalikan ke kata klien | **177** |
| nama yang singkatannya dieja penuh | **40** (30 di antaranya juga termasuk 177 di atas) |
| nama dibiarkan apa adanya — sudah lolos uji | **99** |
| total nama yang berubah | **187** (185 lewat `UPDATE`, 2 ikut pindah kode) |
| `name_en` dijadikan NULL | **212** (209 di tempat, 3 ikut relokasi) |
| akun yang tercakup tabel nama | **286** |

Sepuluh di antara 177 itu adalah yang paling berbahaya, karena **kodenya tetap milik klien dan
yang berubah ARTINYA** — tidak ada yang tampak berubah:

| kode | nama klien (dikembalikan) | nama kita (dibuang) |
|---|---|---|
| `4010110001` | Penjualan Tunai | Penjualan Barang Dagangan |
| `5010110001` | Harga Pokok Pembelian | Harga Pokok Penjualan |
| `1021401001` | Piutang Affiliasi Pembiayaan HEAD OFFICE | Rekening Koran Antar-Unit |
| `1021507001` | Operating Equipment - Rak 1 | Operating Equipment |
| `1021504001` | Air Conditioner | Mesin & Peralatan |
| `1021505001` | Mobil | Kendaraan |
| `1021701001` | Seventh Soft Application | Perangkat Lunak |
| `1011202001` | Kantong Belanja  Plastik Ukuran KECIL | Persediaan Perlengkapan Toko |
| `402` | MANAGEMENT FEE | Pendapatan Lain-lain |
| `80101` | PENDAPATAN DAN (BIAYA) LAIN - LAIN | Beban Lain-lain |

Ejaan penuh yang dipakai, dan salah ketik yang sekalian dibetulkan:

`Penyusu`/`Penyu` → `Penyusutan` (11) · `Akum`/`Acc` → `Akumulasi` (12) · `Amort` →
`Amortisasi` (3) · `Cad` → `Cadangan` (1) · `FFE` → `Furniture, Fixture & Equipment` (6) ·
`YMHD` → `Yang Masih Harus Dibayar` (4) · `PJP` → `Pinjaman Jangka Panjang` (4) · `OE` →
`Operating Equipment` (3) · `BDP` → `Barang Dalam Perjalanan` (2) · `HO` → `Head Office` (1) ·
`Inc`/`Exp` → `Income`/`Expense` (1) · `Sevent`/`SeventSoft` → `Seventh (Soft)` (2) ·
`Expences`/`Ekspences` → `Expenses` (4) · `withold` → `withhold` (1) · huruf berspasi
`F u e l  & O I l` → `Fuel & Oil` (2). `Transpot` → `Transport` sudah benar di bagan kita dan
karena itu tidak dihitung sebagai perubahan.

Perluasan mengikuti huruf besar-kecil nama yang ditumpanginya: `PJP JATUH TEMPO` menjadi
`PINJAMAN JANGKA PANJANG JATUH TEMPO`, bukan campuran.

### 11.3 Empat akun yang memang milik KITA

Ditandai `"ours": true` di `docs/fixtures/coa-final.json` — konvensi kunci sparse yang sudah
dipakai file itu untuk `note` — supaya pembaca berikutnya tahu nama mana yang **boleh** disentuh:

| kode | nama | kenapa milik kita |
|---|---|---|
| `1011005001` | Setoran Dalam Perjalanan | setoran harian adalah dokumen dua tanggal; bagan klien tak punya tempat untuk jedanya |
| `8010110008` | Selisih Kas | hitungan fisik laci menghasilkan selisih yang butuh rumah |
| `1011101003` | Piutang QRIS | bagan klien lebih tua dari QRIS (0248) |
| `1011101004` | Piutang Tender Lain-Lain | tender konter yang belum dinamai siapa pun (0248) |

**Dan ada yang kelima**, bukan akun melainkan grup: **`1011005`** — rung yang terpaksa dicetak
0247 supaya `1011005001` bisa menggantung di keluarga 7 digit seperti posting lain. Ikut ditandai
`"ours": true` dengan catatan bahwa ia bukan arti kelima, hanya tangga untuk arti pertama.

### 11.4 Tiga arti pulang ke kode klien, enam tidak

0243/0244 memakai **18 kode yang tidak dimiliki klien** (20 setelah 0248). Empat—lima di atas
memang milik kita. Sisanya adalah arti klien sendiri yang diarsipkan di kode pilihan kita. Tiga
di antaranya pulang:

| dari | ke | catatan |
|---|---|---|
| `1021508001` | `1031803001` | Contract In Progress (CIP), di bawah Other Assets seperti di bagan klien. `backend/tests/asset_banking_integration.rs` **sudah** mengharapkan kode ini untuk `work_in_progress`; 662 baris `fixed_asset` ikut dipindah, 14 baris `account_map` ikut, grup `1021508` yang jadi kosong dihapus. |
| `4020210001` | `8010110001` | Pendapatan Bunga Bank |
| `4020210009` | `8010110007` | Pendapatan (Biaya) Lain-Lain (menyerap juga `600104` klien, yang di bagan mereka sendiri menggantung di luar tangga) |

Enam **tidak dipaksakan**, dan alasannya ditulis, bukan disiasati:

* **`2012401001 Uang Muka Penjualan & Voucher` → `205001`.** Kode klien itu **enam digit**.
  Tangga 0247 adalah 1 → 3 → 5 → 7 → 10 dan posting harus menggantung di keluarga 7 digit;
  `205001` butuh `205`, `2050` dan `20500` yang **tidak satu pun dimiliki klien**. Mengembalikan
  satu akun berarti mengarang tiga. Akun ini juga sekarang memikul kewajiban voucher, yang tidak
  pernah ada di `205001`.
* **`4020210002 Potongan Pembelian` → `8010110003`.** Tangganya mau menerima. Akun ini memikul
  **5 baris jurnal, Rp 8.877.350 kredit**, dan memindahkannya akan terlihat sebagai neraca saldo
  per akun yang berubah — satu-satunya hal yang migrasi ini janjikan tidak terjadi. **Ini
  satu-satunya relokasi yang terhalang uang, bukan bagan, dan ini yang perlu ditanyakan ke
  pemilik.**
* **`4020210003 Pendapatan Sewa` → `8010110004`/`8010110005`.** Ini **dua** akun klien yang
  dilipat jadi satu (Sewa Gedung dan Sewa Peralatan). Kode mana pun yang dipilih akan menjadi
  kode klien dengan arti yang bukan arti mereka — persis cacat yang migrasi ini bereskan. Tetap
  di kode kita, dengan nama kita, mengatakan persis apa yang dipikulnya.
* **`7010310003/004/005` → `7020310003/004/005`.** Keluarga `7020310` klien menggantung di grup
  `70203` yang **tidak ada di bagan mereka**, begitu juga `702`; itu justru alasan 0244
  memindahkannya. Mengembalikannya berarti mencetak dua kode yang tidak dimiliki klien. Tiga akun
  ini tetap di kode kita — **tetapi mengambil KATA klien** (`Biaya Pajak Reklame`,
  `Biaya Management FEE`, `Biaya Asuransi Kendaraan`), karena masing-masing pembawa satu-lawan-satu
  dari satu akun klien.

Setelah itu, **14 kode** di bagan bukan milik klien: 5 milik kita (§11.3) dan 9 adalah enam
penolakan di atas beserta rung-nya. Invarian ke-8 di 0253 **menyebutkannya dengan RAISE NOTICE,
bukan EXCEPTION**, karena lane lain masih mencetak akun posting di 0248/0249 dan daftar tetap di
sini hanya akan berkelahi dengan mereka atau jadi basi. Dua akun `7010310003/005` tidak muncul di
notice itu meski kodenya milik kita, karena tabel namanya memang memetakan keduanya ke nama klien —
disebut di sini supaya tidak jadi kejutan.

### 11.5 Tidak ada satu rupiah pun yang bergerak

Tidak satu baris `journal_line` ditulis. Relokasi **ditolak keras** kalau akun yang dipindah punya
posting — jadi "tidak ada uang yang pindah" bersifat struktural, bukan janji. Neraca saldo per akun
dan per site di-snapshot sebelum dan dibandingkan sesudah **di dalam transaksi yang sama**, persis
cara 0247: **126 pasang akun/site saat 0253 jalan, 4.377 baris jurnal, Rp 89.670.739,87 debit
dan kredit — identik.** (0248 kemudian memecah QRIS keluar dari `1011101002` dan pasangannya jadi
139; itu perpindahan milik 0248, dan totalnya tetap sama.) Kelima invarian tangga 0247 di-assert ulang di akhir 0253 dan lolos; bentuk bagan tetap
123 grup / 175 posting (satu rung `1021508` hilang, satu rung `1031803` lahir).

### 11.6 Yang tidak ikut berubah

`docs/fixtures/coa-final.json` **tidak** diubah nama-namanya. File itu adalah catatan tentang apa
yang 0243 muat, dan tidak ada kode yang membacanya saat jalan. Yang ditambahkan hanya penanda
`"ours"`. **Kalau suatu saat fixture itu dipakai ulang untuk memuat bagan, ia akan memasukkan lagi
177 terjemahan yang baru saja dibuang** — pakai `ledger_account` sebagai otoritas nama, bukan
fixture.
