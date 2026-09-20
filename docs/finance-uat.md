# UAT Finance — skenario, bukan layar

Yang diuji adalah **hasil akuntansinya**, bukan HTTP 200. Setiap skenario di
bawah punya tes integrasi yang memeriksa jurnalnya: debit, kredit, unit,
`source_kind`, idempotensi.

| skenario | tes |
|---|---|
| Penjualan tunai, kartu, QRIS; hari dagang jadi satu jurnal | `sales_posting_integration` |
| Pajak hari dagang dari struk, bukan hitung ulang tarif | `sales_posting_integration` (5 tes) |
| Kartu dideklarasikan vs ditebak jatuh di satu keranjang | `sales_posting_integration` |
| Retur mengembalikan pajak pada tarif saat dijual | `sales_posting_integration` |
| Setoran toko: keluar laci, masuk bank | `store_documents_integration` |
| Prepaid: jadwal, alokasi bulanan, replay, pembatalan | `prepaid_integration` |
| Pajak: kewajiban, replay, setoran, kredit ≠ utang | `tax_integration` |
| Uang muka: minta, setujui, bayar, pertanggungjawaban, kembalian | `finance_domains_integration` |
| Pemilik: modal, prive, pinjaman pemilik | `finance_domains_integration` |
| Pembiayaan: angsuran terbagi pokok/bunga, bayar dua kali ditolak | `finance_domains_integration` |
| Panel kontrol menyebut domain yang belum terjangkau | `finance_domains_integration` |
| Neraca seimbang setelah pergerakan | `finance_domains_integration` |
| Kebijakan posting per akun | `posting_policy_integration` |
| Satu otoritas hari dagang | `day_posting_authority` |
| Identitas bank & rekening | `bank_identity_integration` |
| Akun yang kita cetak dideklarasikan | `accounting_closure` |
| Saldo awal lewat jalur OPENING | `opening_cutover_integration` |

## Yang dituntut bagan 40 akun

Tidak ada skenario di atas yang berubah **isinya**: sebuah hari dagang tetap
menjadi satu jurnal, sebuah retur tetap mengembalikan pajak pada tarif saat
dijual. Yang berubah adalah apa yang diperiksa tesnya di baris jurnal — akun
yang lebih sedikit, ditambah kategori. Fixture memakai bagan milik migrasi, jadi
sebagian besar ikut otomatis.

Yang **baru** dan harus punya skenarionya sendiri:

| skenario | apa yang membuktikan |
|---|---|
| Baris pada akun berkeluarga tanpa kategori **ditolak** | `assert_category_matches_account` butir 1 — dan pesannya menyebut keluarganya |
| Baris berkategori pada akun tanpa keluarga **ditolak** | butir 2; ini arah yang mudah terlewat |
| Kategori dari keluarga yang salah **ditolak** | butir 3 — mis. `PPH21` pada `1101` |
| Kategori non-aktif ditolak untuk posting baru, tetapi riwayatnya tetap terbaca | butir 4 |
| Pembalikan membawa kategori entri aslinya | `reverse` menyalin, tidak me-resolve ulang |
| `1501` berjumlah nol setelah pergerakan antar-unit dua arah | invarian satu badan hukum |
| `1501` **tidak** nol memblokir tutup bulan | bahwa invariannya ditegakkan, bukan dilaporkan |
| Neraca saldo dalam kode klien mencetak angka yang sama dengan neraca saldo 4 digit | `legacy_code()` + `ledger_account_remap` |
| Saldo tiap akun baru = jumlah saldo akun lama yang dilebur ke dalamnya | peleburan tidak memindahkan uang |

Dua terakhir adalah bentuk panjang dari apa yang `DO $$` di 0290 periksa saat
migrasi berjalan; sebagai skenario, keduanya harus bisa dijalankan kapan saja,
bukan sekali saat migrasi.

## Yang belum punya skenario

- Rekonsiliasi rekening koran ujung ke ujung (ada di modul Banking, belum di
  daftar ini).
- Penutupan bulan penuh: `finance_close_readiness` diuji lewat panel kontrol,
  belum lewat skenario tutup-buka.
- Persediaan bernilai uang — menunggu metode kos (lihat client decisions).
- Seluruh tabel *Yang dituntut bagan 40 akun* di atas: ditulis sebagai daftar
  yang harus ada, bukan sebagai daftar yang sudah ada. `backend/tests/` dipegang
  lane lain dan belum diperiksa ulang terhadap daftar ini.
