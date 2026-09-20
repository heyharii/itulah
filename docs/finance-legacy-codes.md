# Kode lama: bagaimana akuntan mendapat nomornya sendiri kembali

**Tanggal:** 18 September 2026 · **Status:** jembatan sudah ada (0290–0292); dua
batasnya ditulis di sini apa adanya, bukan ditutup.

40 akun adalah bagan yang benar untuk memegang buku dan bagan yang salah untuk
disodorkan kepada orang yang sudah bertahun-tahun membaca yang satunya. Laporan
2024 dan 2025 klien memakai kode 12 digit; SPT yang sudah dilaporkan memakai
kode 12 digit; dan akuntan yang harus menandatangani set berikutnya akan
merekonsiliasinya terhadap set terakhir.

Kalau bagan baru tidak bisa mencetak nomor lama, jawaban atas *"apakah ini
perusahaan yang sama"* adalah sebuah spreadsheet yang dirawat seseorang dengan
tangan. Jadi jembatannya adalah fungsi, dan ia **eksak di mana ia bisa eksak dan
NULL di mana ia tidak** — bukan menebak.

---

## 1. Bagian-bagian jembatan

| | apa | dari |
|---|---|---|
| `ledger_account_remap` | 188 baris: `legacy_code → (new_code, category_code)` | 0290 |
| `line_category.legacy_code` | template 10 digit klien yang melahirkan tiap kategori — 87 dari 140; NULL untuk nilai yang memang tidak pernah jadi akun mereka (tender, pot, alasan antar-unit) | 0287 |
| `asset_class.legacy_code` | sub-tipe aset klien, **NOT NULL** — setiap kelas memang salah satu sub-tipe mereka | 0287 |
| `company_bank_account.legacy_ledger_account_code` | kode lama tiap rekening | 0291 |
| `legacy_account_code(account_code, category_code, bank_account_id, is_debit)` | membalik arah itu, mengembalikan kode **10 digit** klien atau NULL | 0292 |
| `journal_line_legacy` | satu baris per baris jurnal, dengan `legacy_code` di sampingnya | 0292 |

`journal_line_legacy` bisa dijumlahkan menjadi neraca saldo dalam kode klien,
atau dibaca berdampingan dengan buku besar 2024/2025 mereka.

**Kode lama adalah *view*, bukan kunci.** Tidak ada yang memposting ke sana,
tidak ada yang mencarinya, dan tidak ada FK yang menunjuk ke sana. Ia dihitung
saat dibaca dari fakta yang sudah ada di baris jurnal.

## 2. Empat cara sebuah baris tahu kode lamanya

**Kategorinya tahu** — 130 dari 188. Peleburannya satu-untuk-satu:
`6010310006 Biaya Pemakaian Listrik` menjadi `6301` yang membawa
`BIAYA_PEMAKAIAN_LISTRIK`, dan tidak ada hal lain yang menjadi pasangan itu.
`ledger_account_remap` karenanya bisa dibalik pada `(new_code, category_code)`.
0292 memeriksanya saat migrasi: setiap baris ber-kategori **wajib** terbaca
kembali menjadi dirinya sendiri, kalau tidak migrasinya berhenti.

**Rekening banknya tahu** — 14 akun bank klien menjadi satu `1102`, dan yang
membedakannya adalah `bank_account_id`. 0291 menyimpan kode lama tiap rekening di
`company_bank_account.legacy_ledger_account_code` justru untuk ini. Giro BCA,
tabungan BTN dan deposito BNI semuanya mencetak kode mereka sendiri kembali.

**Tandanya tahu** — lima famili afiliasi klien (tiga piutang, dua hutang)
menjadi satu akun bertanda, `1501`. Piutang dari Cikupa dan hutang Cikupa kepada
kita adalah satu fakta yang ditulis dua kali, dan satu akun bertanda membuat
cerminannya otomatis. Akibatnya pasangan (`1501`, `FINANCING`) berdiri untuk
**dua** akun klien — piutang dan hutang — dan yang membedakannya adalah di sisi
mana uang itu berada. Debit = piutang (akar 1), kredit = hutang (akar 2). Karena
itu fungsinya menerima sisi. (`INTERUNIT_OTHER` hanya punya satu kandidat —
klien tidak pernah membuka famili hutang untuk *Affiliasi Lain-lain* — jadi ia
terbalik tanpa perlu tanda.)

0292 hanya mengizinkan pasangan ambigu **kalau kandidatnya berada di akar yang
berbeda**, yaitu hanya kalau tandanya benar-benar memutuskan. Tabrakan jenis lain
menghentikan migrasi.

**Register asetnya tahu, dan fungsi ini tidak.** Sebuah baris aset membawa
`asset_id`, asetnya membawa kelasnya, dan kelasnya membawa sub-tipe klien
sendiri — `OE_RAK_27` adalah `1021507027`. Tetapi **akunnya** yang memutuskan
dari famili aset klien yang mana kode itu diambil: perolehan `1021507`, cadangan
penggantian `1021607`, beban penggantian `7010215`. Korespondensi itu bukan
aturan string — `1021504 Machineries` menyusut ke `7010212` sementara
`1021506 FFE` ke `7010214`, dan tanah tidak menyusut sama sekali — dan
merekonstruksinya dengan pola berarti mengarang pemetaan yang belum pernah
diperiksa siapa pun. Jadi baris aset mengembalikan **NULL** di sini dan
direkonsiliasi lewat register, yang membawa sub-tipe klien di setiap barisnya.

## 3. Apa yang mengembalikan NULL, dan apa gantinya

`legacy_account_code` mengembalikan NULL ketimbang menebak. Daftar lengkap akun
yang belum bisa dibalik dari baris jurnal saja:

| akun | berapa akun klien melebur | apa yang sebenarnya membedakannya | status |
|---|---:|---|---|
| `1601` `1602` `1609` `1619` `7101` | 9 · 2 · 6 · 2 · 8 | kelas aset + famili akun | **sengaja NULL** — lewat register aset |
| `1201` Piutang tender | 2 (kartu kredit, kartu debit) | kategori `tender` (`CREDIT_VISA`, `DEBIT_BCA`, …) | **bisa ditutup**, lihat §6 |
| `2101` Hutang usaha | 2 (barang dagangan, non-barang) | `supplier.category` (0212) | **bisa ditutup**, lihat §6 |
| `2501` Pinjaman bank | 2 (jangka panjang, jatuh tempo) | jadwal `financing_installment` pada tanggal neraca | **bisa ditutup**, lihat §6 |
| `2502` Pinjaman pemilik | 3 (pinjaman, jatuh tempo, hutang lain-lain) | jadwal + jenis gerakan `principal_transaction` | **bisa ditutup**, lihat §6 |
| `8101` Beban bunga | 2 (bunga bank, bunga leasing) | `financing_facility.kind` | **bisa ditutup**, lihat §6 |

Yang **selalu** berhasil tanpa kunci tambahan: `1610`, `2102`, `2103`, `3101`,
`3102`, `3201` — masing-masing hanya satu akun klien yang melebur ke dalamnya.

## 4. Batas yang sebenarnya: 10 digit eksak, 12 digit belum

Ini batas yang lebih tua daripada bagan 40 dan tidak diciptakan olehnya.

Fungsi di atas mengembalikan kode **10 digit** klien — satu baris per arti.
Daun 12 digit mereka adalah kode itu ditambah **akhiran dua digit unit**:

```
1011001001    CASH ON HAND                 ← yang dikembalikan fungsi
101100100100  CASH ON HAND · HEAD OFFICE   ← daun yang dicetak laporan mereka
101100100103  CASH ON HAND · unit ke-3
```

Akhiran itu tersedia: `journal_line.site_id` ada di setiap baris. Yang **belum**
tersedia adalah pemetaan dari 14 **nama unit** klien ke akhiran `00`–`13`.

`docs/coa-cube.md` §8 butir 1 mencatatnya: kubus memakai nama dari rung
afiliasi klien — HEAD OFFICE · CIKUPA · MUARO BUNGO · PURBALINGGA · BUMIAYU ·
JAMBI · WIRAMODE · BREBES · PASURUAN · WMJB · WMBA · SIPIN · BANJARAN ·
WONOSOBO — dan memetakannya ke `C001`–`C013` lewat **offset ordinal**. Offset itu
**asumsi**, pemilik belum pernah mengkonfirmasinya, dan seluruh saldo antar-unit
dalam cetakan kode lama bergantung padanya.

Jadi, tegasnya:

- **10 digit pertama: eksak.** Diturunkan dari `ledger_account_remap`, yang
  diperiksa migrasi.
- **2 digit terakhir: belum.** Sebuah tebakan yang beralasan, dan tidak boleh
  dicetak seolah-olah fakta.

Konsekuensinya untuk layar *Trial balance (kode klien)*: cetak 10 digit, dan
tampilkan unitnya sebagai **nama** di kolom sendiri. Menggabungkan keduanya
menjadi 12 digit berarti menerbitkan asumsi itu sebagai angka. Itu bisa dilakukan
kapan saja setelah pemilik menjawab satu pertanyaan — dan menjawabnya tidak
memindahkan satu rupiah pun, karena bagan baru sama sekali tidak memakai akhiran
itu.

## 5. Dua akun klien yang tidak punya kode baru

`ledger_account_remap` berisi 188 baris, bukan 190. Dua akun posting lama tidak
dipetakan ke apa pun, dan itu disengaja:

- **`3013001003 Laba (Rugi) bulan berjalan`** — **diturunkan**, tidak diposting.
  Hasil tahun berjalan bukan sesuatu yang diposting; ia adalah apa yang
  dijumlahkan laba-rugi. Membawanya serta adalah cara sebuah migrasi menghitung
  laba tahun ini dua kali: sekali di akun-akun yang menghasilkannya, sekali lagi
  di saldo yang menyalinnya.
- **`1031801001 Disposed Inventory`** — dipensiunkan. Nol selama dua tahun buku
  yang klien kirim, dan tidak punya arti di model aset/persediaan yang kita
  bangun.

Neraca saldo dalam kode klien karenanya tidak akan menampilkan dua baris ini, dan
itu jawaban yang benar. Kalau akuntan mencarinya, jawabannya adalah kalimat di
atas, bukan sebuah angka.

## 6. Pertanyaan terbuka

1. **Lima akun di §3 yang "bisa ditutup"** — masing-masing punya kunci yang
   sebenarnya membedakan akun klien yang melebur ke dalamnya, dan
   `legacy_account_code` belum membacanya. Yang paling mudah: `1201`, di mana
   kategorinya **sudah** ada di baris tetapi baris remap-nya membawa NULL —
   karena satu akun klien (`1011101001 Piutang Kartu Kredit`) berdiri untuk tiga
   tender (`CREDIT_VISA`, `CREDIT_MASTER`, `CREDIT_CARD`) dan satu baris remap
   hanya bisa memegang satu kategori. Menutupnya butuh pemetaan banyak-ke-satu
   di samping remap, atau aturan "tender apa pun yang berawalan `CREDIT` →
   `1011101001`". Yang mana, belum diputuskan.
2. **Sisi perolehan aset** — `asset_class.legacy_code` `NOT NULL`, jadi baris
   `1601`/`1602` sebenarnya **bisa** dibalik lewat `asset_id → kelas →
   legacy_code`. Yang tetap tidak bisa adalah sisi kontra dan bebannya
   (`1609`, `1610`, `1619`, `7101`), karena akunnya yang memutuskan famili mana
   dari keempat famili paralel klien, dan korespondensinya bukan aturan string.
   Menutup separuhnya saja membuat fungsi ini menjawab untuk sebagian baris aset
   dan diam untuk sebagian lain — apakah itu lebih baik daripada diam untuk
   semuanya, belum diputuskan.
3. **Nama 14 unit dan urutannya** (§4) — satu pertanyaan untuk pemilik, dan
   satu-satunya hal yang menghalangi cetakan 12 digit.
4. **Apakah akuntan memang memintanya.** Seluruh dokumen ini berdiri di atas
   perkiraan bahwa akuntan klien menerima bagan ringkas *dengan syarat* kode lama
   tetap bisa dicetak. Perkiraan itu belum dikonfirmasi langsung kepada
   akuntannya; kalau ternyata mereka ingin memegang buku dalam kode lama, yang
   berubah bukan dokumen ini melainkan putusannya.
