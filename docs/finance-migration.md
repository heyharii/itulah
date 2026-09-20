# Cutover: dari buku lama ke Retail OS

## Jalur saldo awal

Satu pintu: `POST /api/v1/finance/opening/balances`, `source_kind = 'OPENING'`.
Bukan jurnal manual — kernel posting menolak kas lewat jurnal tangan sejak 0261,
dan saldo awal bukan koreksi.

Berkasnya bentuk klien sendiri, ditambah satu kolom:

```
site_id,account_code,category_code,debit,credit,document_no,memo
dc,1101,DRAWER,122401000,,TB-2026-08,Saldo awal kas
dc,3101,,,122401000,TB-2026-08,Modal setor awal
```

`category_code` adalah kolom yang ditambahkan bagan 40 akun. `1101 Kas`
mendeklarasikan keluarga `pot`, jadi baris di atasnya yang tidak membawa
kategori **ditolak** oleh `assert_category_matches_account` — bukan diterima
diam-diam ke dalam pot yang tidak dipilih siapa pun. `3101 Modal disetor` tidak
mendeklarasikan keluarga apa pun, jadi kolomnya kosong dan sebuah kategori di
sana justru ditolak. Impor mengabaikan kolom yang tidak dikenalnya, jadi sheet
yang membawa kolom ini aman dibaca impor yang belum membacanya.

Yang divalidasi impor:

- **seimbang per unit** — sebuah tempat yang debitnya tidak sama dengan
  kreditnya ditolak, karena selisihnya akan mendarat di tempat yang tidak dipilih
  siapa pun;
- **periode cutover harus dibuka** — saldo awal bertanggal hari terakhir sistem
  lama, dan entri tetap harus mendarat di periode yang seseorang buka;
- **akun berdimensi perusahaan hanya di kantor pusat** — `3101 Modal disetor`
  ditolak di toko dengan menyebut alasannya;
- **kategori harus cocok dengan keluarga akunnya** — penolakannya menyebut akun,
  keluarga yang diminta, dan sampai lima kode yang sah;
- **rehearsal adalah run yang sama** — `commit` default `false`: ia mem-parse,
  me-resolve, memposting, dan me-rollback.

Kode yang ditulis di sheet adalah **kode kita** (4 digit), bukan kode klien.
Neraca saldo lama mereka dipetakan ke sana lewat `ledger_account_remap`, dan
arah sebaliknya — mencetak kode mereka kembali — ada di
[`finance-legacy-codes.md`](./finance-legacy-codes.md).

## Akun kontrol harus cocok dengan pendukungnya

Untuk tiap akun kontrol, saldo awal harus punya jadwal pendukung:

| kontrol | akun | pendukung yang harus ikut |
|---|---|---|
| Bank | `1102` | rekening nyata + saldo per rekening |
| Giro keluar | `2103` | daftar giro yang sudah ditulis dan belum cair |
| Hutang supplier | `2101`, `2102` | daftar faktur terbuka; GRNI terpisah dari yang sudah ditagih |
| Persediaan | `1301` | **belum bisa** — belum ada metode kos |
| Aset tetap | `1601`, `1602` | register aset (1.328 baris klien sudah diimpor), per kelas |
| Akumulasi | `1609`, `1610`, `1619` | per aset, bukan satu angka per kelas |
| Prepaid | `1401` | jadwal yang masih berjalan, per `prepaid_kind` |
| Pajak | `1402`, `2201` | saldo per jenis dan per masa |
| Uang muka | `1403` | daftar uang muka yang masih di tangan orang |
| Pembiayaan | `2501`, `2502` | jadwal angsuran per fasilitas / per pemilik |
| Antar unit | `1501` | pasangan piutang/hutang yang **jumlahnya nol** |

Dengan 40 akun, tabel di atas adalah **seluruh neraca** kecuali kas, ekuitas dan
laba ditahan. Itu invarian yang lebih kuat daripada sebelumnya, bukan lebih
lemah: setiap akun yang membawa kunci adalah akun kontrol, dan `finance_controls`
membandingkannya dengan sub-ledgernya.

**Tidak ada akun penyeimbang.** Selisih antara saldo awal dan jadwal
pendukungnya ditampilkan panel kontrol sebagai selisih dan dibiarkan terlihat.
Menutupnya dengan akun suspense berarti memindahkan pertanyaan ke tempat yang
tidak akan ditanyakan lagi.

## Urutan enam langkah, dan bukti selesai tiap langkah

Bentuk ini diambil dari sheet *Proposal* di
`outputs/coa_20260918/Proposed_30_Account_Structure.xlsx` — usulan 30 akun dari
pihak lain, 18 September 2026. Urutan dan kolom *completion evidence*-nya lebih
rapi daripada yang kita punya, dan tidak bergantung pada usulan bagan mana yang
dipakai. Yang di bawah adalah urutan itu dengan fakta kita di dalamnya; di mana
mereka menulis sebuah pertanyaan yang sudah kita jawab, jawabannya ditulis di
sini, bukan pertanyaannya.

| # | siapa | pekerjaan | bukti selesai |
|---|---|---|---|
| 1 | Finance + admin sistem | Sahkan arti sumbernya: hak posting, arti flag `Y`/`N`, jumlah badan hukum, daftar unit. | Daftar unit yang disetujui, dan definisi tiap kolom sumber. |
| 2 | Finance | Selesaikan pemetaan yang masih terbuka; sahkan akun tujuan, kategori, dan default dimensinya. | Setiap akun lama yang pernah dipakai punya tujuan yang disetujui, atau aturan pemecahan yang tertulis. |
| 3 | Admin sistem | Muat bagan dan master turunannya; nyalakan dimensi dan sub-ledger yang wajib. | Kombinasi yang tidak sah **ditolak** saat entri dan saat impor — dibuktikan dengan mencobanya. |
| 4 | Finance | Migrasi percobaan: saldo dan baris jurnal, dengan lawan transaksi, item terbuka, dan rincian stok/aset ikut. | Debit = kredit, total saldo tidak berubah kecuali penyesuaian yang disetujui, sub-ledger rekonsiliasi. |
| 5 | Finance | Uji laporan dan tutup buku: laba-rugi per unit, neraca, rincian pajak, rekonsiliasi bank, pencocokan antar-unit. | Laporan mereproduksi total yang disepakati **tanpa menghitung laba berjalan dua kali**. |
| 6 | Finance + admin sistem | Bekukan posting di sistem lama pada tanggal cutover; simpan riwayat dan versi crosswalk yang disahkan. | Rekonsiliasi yang ditandatangani, dan prosedur rollback/pengecualian yang terkendali. |

Apa yang sudah terjawab di langkah 1 dan 2, dan karenanya tidak perlu ditanyakan
lagi:

- **Satu badan hukum** (pemilik, 18 September 2026). Tidak ada tabel
  `legal_entity`; saldo antar-unit adalah kliring internal di `1501` yang wajib
  nol dan hilang saat konsolidasi.
- **Arah barang dalam perjalanan** sudah terbukti dari struktur kode klien
  (`docs/coa-cube.md`): pemilik adalah akhiran dua digit, lawannya adalah indeks
  template. Itu menjadi `counter_site_id` pada `1302`.
- **Flag `N`** berarti akun non-aktif — 104 daun, dan tidak satu pun template
  yang mati seluruhnya. Tidak ada baris yang dibuang; `is_active` yang menahannya.
- **`3013001003 Laba (Rugi) bulan berjalan`** tidak dimigrasikan ke akun mana
  pun. Ia **diturunkan**, tidak diposting. Ini persis peringatan langkah 5:
  memuat saldo hasil berjalan berikut laba-rugi yang menghasilkannya adalah
  menghitung laba tahun ini dua kali.
- **`1031801001 Disposed Inventory`** dipensiunkan: nol selama dua tahun buku
  yang klien kirim, dan tidak punya arti di model aset/persediaan kita. Kalau
  ada saldonya saat cutover, ia jadi pertanyaan, bukan jurnal.

Yang **belum** terjawab dan menahan langkah 4: metode penilaian persediaan
(`docs/finance-client-decisions.md` §13) dan prepaid/pajak yang masih berjalan
saat cutover (§12).

## Peta akun lama → Retail OS

`ledger_account_remap` menyimpan pemetaan kode lama ke kode sekarang. Sejak 0290
ia berisi **188 baris** — 190 akun posting lama dikurangi dua yang tidak menjadi
akun apa pun (laba berjalan dan Disposed Inventory) — masing-masing dengan akun
barunya dan, kalau ada, kategorinya. Pemetaan tidak memindahkan saldo; ia hanya
mengatakan baris lama ini sekarang bernama itu.

`journal_line` tidak disentuh satu baris pun. Ia append-only dan dijaga
`protect_journal()`, dan penjagaan itu bukan penghalang di sini melainkan
alasannya: sebuah posting mengatakan ke mana uang pergi pada hari ia pergi, dan
migrasi yang menulis ulang akun sebuah entri 2026 adalah migrasi yang menulis
ulang sejarah. Akun lama tetap di bagan, non-aktif, masih memegang postingnya.

Kode 4 digit pada keempat puluh akun baru adalah **milik kita**, bukan klien.
Semuanya ditandai `ledger_account.code_provenance = 'PENDING_CLIENT_CODE'`. Saat
klien mengeluarkan kode resminya: satu `UPDATE` per akun dan satu baris di
`ledger_account_remap`. Tidak ada jurnal yang bergerak.
