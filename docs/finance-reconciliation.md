# Rekonsiliasi: apa yang dibandingkan dengan apa

Satu bentuk untuk semua: `GET /api/v1/finance/controls`.

| domain | subledger | buku besar | status |
|---|---|---|---|
| Prepaid | sisa jadwal aktif | akun `prepaid_expense` yang dipetakan | penuh |
| Pajak — utang | kewajiban − setoran, per masa | akun jenis pajak (sifat PAYABLE) | penuh |
| Pajak — kredit | kredit − pemakaian, per masa | akun jenis pajak (sifat CREDIT) | penuh |
| Uang muka | nilai − pertanggungjawaban, per unit | akun `advance` | penuh, + umur >30 hari |
| Pembiayaan | pokok − angsuran terbayar | akun `loan_principal` | penuh |
| Hutang supplier | `supplier_invoice_standing` | `trade_payable`, `non_merchandise_payable` | penuh |
| Antar unit | — | `affiliate_receivable` + `affiliate_payable` harus nol | penuh |
| Bank | rekening koran per rekening (0071) | akun bank | ada, di modul Banking |
| Aset tetap | register aset | akun aset + akumulasi | ada, di modul Assets |
| Payroll | run + slip | `payroll_payable` | ada, di modul People |
| Persediaan | — | `inventory` | **belum**: stok belum bernilai uang |

## Kenapa "belum" ditulis, bukan dikosongkan

Panel yang diam-diam melewati persediaan terbaca sebagai "persediaan cocok".
Baris persediaan karenanya membawa `covered = false` dan alasannya, dan tutup
bulan melaporkannya sebagai UNKNOWN — bukan OK dan bukan BLOCKER.

## Antar unit

Bukan subledger lawan buku besar, melainkan sifat: setiap piutang antar unit
adalah hutang unit lain, jadi jumlah seluruh akun afiliasi harus nol. Angka
selain nol berarti satu kaki dari sepasang tidak pernah diposting.
