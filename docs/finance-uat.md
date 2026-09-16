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

## Yang belum punya skenario

- Rekonsiliasi rekening koran ujung ke ujung (ada di modul Banking, belum di
  daftar ini).
- Penutupan bulan penuh: `finance_close_readiness` diuji lewat panel kontrol,
  belum lewat skenario tutup-buka.
- Persediaan bernilai uang — menunggu metode kos (lihat client decisions).
