# Bagan akun sebagai kubus — 6.902 daun, 376 pilihan

**Tanggal:** 13 September 2026 · **Status:** usulan, diturunkan dari data klien
**Sumber:** `/Users/hari/Downloads/Laporan_Master_Account1.csv` (7.528 baris), diuraikan
ulang di sesi ini; rekonstruksinya cocok 6.902/6.902.

Pemilik: *"COA klien terlalu banyak akun dan ribet, kita mau simplify pakai unit mungkin;
di prototipe tidak harus memilih akun toko apa, tapi bisa pakai unit; dua sumbu mungkin,
atau tiga."*

Jawabannya: **bagannya sudah kubus, cuma disajikan sebagai daftar.** Tidak ada yang perlu
dihapus dari bagan klien. Yang berubah hanya cara orang memilihnya.

---

## 1. Struktur yang terbukti

```
tangga kode   1      3      5      6      7      10      12
jumlah        8     14     30      3     75     496   6.902
              root  ...           off-   keluarga  template  daun
                                  ladder
```

**Setiap satu dari 493 template rung-10 punya tepat 14 anak**, dan 14 akhiran itu adalah
unit: `00` = HO, `01`–`13` = C001–C013. Tidak ada satu pun pengecualian.

```
493 template × 14 unit = 6.902 daun     ← cocok persis
```

Dari 493 template itu, **126 milik 9 keluarga yang anaknya bernama UNIT**, bukan barang:

| Keluarga | Nama | Isi |
|---|---|---|
| `1011203` | Barang Dalam Perjalanan Barang Dagangan | 14 × 14 |
| `1011204` | Barang Dalam Perjalanan Kantong Belanja | 14 × 14 |
| `1021401` | PIUTANG AFFILIASI PEMBIAYAAN | 14 × 14 |
| `1021402` | PIUTANG AFFILIASI ATAS BARANG | 14 × 14 |
| `1021403` | PIUTANG AFFILIASI LAIN-LAIN | 14 × 14 |
| `2012301` | HUTANG AFFILIASI PEMBIAYAAN | 14 × 14 |
| `2012302` | HUTANG AFFILIASI ATAS BARANG | 14 × 14 |
| `2012303` | HUTANG LAIN-LAIN PRINCIPAL | 14 × 14 |
| `2012304` | HUTANG LAIN - LAIN | 14 × 14 |

Contoh daun: `102140100206` = `Piutang Affiliasi Pembiayaan CIKUPA - C006` — **pemilik C006,
lawan CIKUPA**. Pemilik ada di akhiran 2 digit, lawan ada di rung-10.

**Jadi bagan ini adalah kubus tiga sumbu yang diratakan:**

```
sumbu 1  ARTI          367 template biasa  +  9 template matriks   =  376
sumbu 2  UNIT          14   (HO + C001..C013)                          pemilik buku
sumbu 3  UNIT LAWAN    14   hanya untuk 9 template matriks

367 × 14        = 5.138
  9 × 14 × 14   = 1.764
                 ------
                  6.902  ✓
```

**Orang memilih dari 376, bukan 6.902. Delapan belas kali lebih sedikit.**

---

## 2. Yang TIDAK dilakukan

**Bagan klien tidak diubah, tidak dipangkas, tidak diganti.** Itu bagan akuntan mereka,
dipakai Seventhsoft, dipakai laporan statutori, dan nomor-nomornya ada di kertas yang sudah
diarsipkan. Menyederhanakan bagan berarti memutus riwayat dan memaksa rekonsiliasi yang
tidak ada gunanya.

Yang disederhanakan adalah **permukaan pilih**. Kode 12 digit tetap ditulis ke
`journal_line.account_code` persis seperti sekarang; ia dihitung dari sumbu, bukan diketik.
Ini juga bukan barang baru: `account_map` sudah melakukannya untuk aturan posting
(`semantic_key × site × qualifier → account_code`). Kubus ini memberi hal yang sama kepada
**manusia** yang menulis jurnal manual atau memilih akun beban di sebuah tagihan.

Dan ini persis argumen yang ERPNext pakai untuk menolak bagan seperti ini — mereka bilang
akun per produk dan per wilayah *"would make its Chart of Accounts enormous"*, lalu
menawarkan Cost Center. Klien sudah memilih jalan yang ERPNext peringatkan. Kubus ini
mengambil kenyamanan Cost Center **tanpa** mengubah bagan: sumbu ada di layar, bukan di
kolom kedua entri.

---

## 3. Anomali yang tetap harus ditangani

Enam daun tidak ikut pola dan harus diputuskan sendiri:

| Kode | Nama | Masalah |
|---|---|---|
| `1011004002` | TIME DEPOSIT BANK MANDIRI | daun rung-10, tanpa ekspansi unit |
| `1011004003` | TIME DEPOSIT BANK BRI | idem |
| `1011004004` | TIME DEPOSIT BANK BNI | idem |
| `204001` | Giro Keluar | 6 digit, induknya root `2` langsung |
| `205001` | Uang Muka - Penjualan | idem — dan ini benar: voucher bisa ditebus di toko mana pun |
| `600104` | Pendapatan lain-lain | akun **pendapatan** di bawah root beban `6` |

Di kubus, keenamnya tampil sebagai **arti tanpa sumbu unit** — dipilih langsung, satu
pilihan satu kode. Itu jujur dan tidak menyembunyikan cacatnya.

Cacat lain yang kubus justru menyorot, bukan menutupi: `7020310003/004/005` yang seharusnya
`7010310…`, dan `102160400305` yang namanya `C006` padahal akhirannya `05`. Begitu akun
dipilih lewat sumbu, nama yang berselisih dengan akhiran **tidak bisa lagi menyesatkan**,
karena unit datang dari chip yang diklik, bukan dari nama.

---

## 4. Model akses: toko tidak punya rekening apa pun

Aturan pemilik, dan konsekuensinya di kubus:

> Semua rekening toko hanya bisa diakses HO. Toko tidak punya akses ke rekening apa pun,
> hanya petty cash dan uang penjualan sebelum disetor.

| Yang boleh disentuh toko | Kode template | Arti |
|---|---|---|
| Uang penjualan sebelum disetor | `1011001001` | Cash on Hand |
| Kas kecil harian | `1011001002` | Petty Cash |
| Modal kasir (tetap, tak pernah dibelanjakan) | `1011001003` | Modal Kasir |

**Tiga arti × satu unit (miliknya sendiri) = 3 akun, dari 6.902.** Dan 33 template yang
menyebut bank **tidak ditawarkan sama sekali** — bukan disembunyikan setelah dipilih,
melainkan tidak pernah masuk daftar.

Konsekuensi yang mengikuti dengan sendirinya, dan sudah jadi bentuk menu:

- Belanja petty cash di bawah Rp 500.000 adalah **hak toko** — dicatat di buku kas
  kecilnya sendiri (`Petty cash`) dan langsung membukukan. Di atas ambang itu barulah
  perlu izin HO, dan izinnya adalah satu field pada baris, bukan satu layar antrean.
- Setoran harian adalah **dokumen dua tanggal** (`Deposits`): uang meninggalkan laci hari
  ini, mendarat di rekening HO ketika bank mengakuinya.
- Selisih laci lahir dari **hitungan fisik** (`Cash Counts`), bukan dari rekening koran.
- Tujuh baris menu untuk kepala toko, 30 baris `audience: "employer"`.

Ini juga yang membuat pemilih akun di prototipe bisa dipakai apa adanya oleh kasir:
daftarnya tiga baris, unitnya terkunci, dan tidak ada yang perlu dihafal.

---

## 5. Dua sumbu atau tiga?

**Tiga, tapi sumbu ketiga hanya menyala untuk 9 arti.**

Memaksakan dua sumbu berarti memperlakukan `Piutang Affiliasi Pembiayaan CIKUPA` sebagai
126 arti berbeda — yang persis keadaan hari ini dan persis yang membuat bagan terasa ribet.
Memaksakan tiga sumbu untuk semua arti berarti meminta "unit lawan" pada pembelian listrik,
yang tidak punya jawaban.

Jadi: sumbu ketiga adalah **properti dari arti**, bukan dari layar. Sembilan arti
mendeklarasikan dirinya bermatriks; sisanya tidak. Layar membaca deklarasi itu.

Sumbu keempat (kanal, kategori barang, proyek) **tidak diusulkan**. Bagan ini tidak
mengkodekannya, dan menambah sumbu yang bagannya tak punya berarti mengarang data.

---

## 6. Bagaimana ini bertemu `account_map`

Keduanya bukan saingan; keduanya menjawab pertanyaan berbeda dengan jawaban yang sama.

```
aturan posting  →  semantic_key × site × qualifier  →  account_map  →  kode 12 digit
manusia         →  arti × unit × (unit lawan)       →  kubus       →  kode 12 digit
```

`account_map` adalah **pilihan kebijakan Finance** (34 kunci hari ini): "arti `inventory`
di C006 mendarat di akun ini". Kubus adalah **navigasi seluruh bagan** (376 arti): "semua
yang ada di bagan, disusun sebagaimana bagan menyusunnya".

Karena itu keduanya harus saling menguji:

- Setiap baris `account_map` **harus** menunjuk kode yang kubus bisa hasilkan. Kalau tidak,
  petanya menunjuk akun yang bukan daun, atau salah unit — dan hari ini tidak ada yang
  memeriksa itu.
- Layar `Account map` bisa memakai pemilih kubus untuk mengisi `account_code`, sehingga
  pemetaan salah-unit menjadi mustahil dikeyik.

Satu hal yang kubus **tidak** ubah: aturan posting tetap tidak pernah menyebut kode akun.
Itu tetap `poster.rs` dan tetap arti.

---

## 7. Apa yang perlu dibangun

| # | Pekerjaan | Ukuran |
|---|---|---|
| 1 | **Endpoint kubus** — `GET /finance/account-cube` mengembalikan 376 arti + 14 unit + 9 deklarasi matriks + pohon 75 keluarga (±38 KB, statis, di-cache) | kecil |
| 2 | **Komponen pemilih akun** dua/tiga sumbu, dipakai di jurnal manual, baris beban tagihan, dan Account map | sedang |
| 3 | **Cakupan per audience** — daftar arti yang boleh ditawarkan per peran; toko = 3 | kecil |
| 4 | **Uji silang `account_map` ↔ kubus** — setiap pemetaan menunjuk daun yang sah | kecil |
| 5 | Enam daun off-ladder ditandai eksplisit di pemilih | kecil |

Yang **tidak** perlu: migrasi, perubahan `ledger_account`, perubahan `journal_line`,
perubahan aturan posting. Kubus seluruhnya diturunkan dari bagan yang sudah ada di database.

---

## 8. Yang masih perlu diputuskan pemilik

1. **Nama 14 unit belum dikonfirmasi.** Kubus memakai nama dari rung affiliasi klien
   (HEAD OFFICE · CIKUPA · MUARO BUNGO · PURBALINGGA · BUMIAYU · JAMBI · WIRAMODE · BREBES ·
   PASURUAN · WMJB · WMBA · SIPIN · BANJARAN · WONOSOBO) dan memetakannya ke `C001`–`C013`
   lewat offset ordinal. Offset itu asumsi, dan semua saldo antar-unit bergantung padanya.
2. **Enam daun off-ladder**: diberi kode tangga yang benar, atau diterima apa adanya?
3. **Apakah pemilih boleh menawarkan akun non-aktif** (104 daun) untuk riwayat, dengan
   tanda? Usul: ya, ditandai, dan ditolak saat posting.
