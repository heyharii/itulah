# Rekonsiliasi: apa yang dibandingkan dengan apa

Satu bentuk untuk semua: `GET /api/v1/finance/controls`.

| domain | subledger | buku besar | status |
|---|---|---|---|
| Prepaid | sisa jadwal aktif | `1401` (per `prepaid_kind`) | penuh |
| Pajak — utang | kewajiban − setoran, per masa | `2201`, `8201` — jenis bersifat PAYABLE | penuh |
| Pajak — kredit | kredit − pemakaian, per masa | `1402` — jenis bersifat CREDIT | penuh |
| Uang muka | nilai − pertanggungjawaban, per unit | `1403` (per `advance_purpose`) | penuh, + umur >30 hari |
| Pembiayaan | pokok − angsuran terbayar | `2501` (bank), `2502` (pemilik) | penuh |
| Hutang supplier | `supplier_invoice_standing` | `2101` per `supplier_id`; `2102` untuk yang belum ditagih | penuh |
| Antar unit | — | `1501` harus nol | penuh |
| Bank | rekening koran per rekening (0071) | `1102` per `bank_account_id` | ada, di modul Banking |
| Giro keluar | daftar giro belum cair | `2103` per `bank_account_id` | ada, di modul Banking |
| Aset tetap | register aset | `1601`/`1602` + `1609`/`1610`/`1619`, per `asset_id` | ada, di modul Assets |
| Payroll | run + slip | `2301 × BIAYA_GAJI_DAN_UPAH_YMHD` | ada, di modul People |
| Persediaan | — | `1301` | **belum**: stok belum bernilai uang |

## Kenapa "belum" ditulis, bukan dikosongkan

Panel yang diam-diam melewati persediaan terbaca sebagai "persediaan cocok".
Baris persediaan karenanya membawa `covered = false` dan alasannya, dan tutup
bulan melaporkannya sebagai UNKNOWN — bukan OK dan bukan BLOCKER.

## Setiap akun berkunci adalah akun kontrol

Dengan 40 akun, tabel di atas hampir seluruh neraca. Itu bukan kebetulan: aturan
bagan 40 — *sebuah akun ada hanya kalau ia baris laporan* — berarti tiap akun
yang membedakan sesuatu membedakannya lewat **kunci baris**, dan sebuah kunci
baris selalu punya master atau sub-ledger di baliknya. Jadi "saldo akun ini sama
dengan jumlah sub-ledgernya" bisa ditanyakan atas hampir semuanya, dan invariannya
lebih kuat daripada saat ada 190 akun, bukan lebih lemah.

Yang **tidak** punya pembanding, dan tidak seharusnya punya: `1101` (kas — yang
membandingkannya adalah cash count, bukan sub-ledger), `3101`/`3102` (punya
register `principal`, tapi register itu adalah dokumennya, bukan pembandingnya),
`3201` (laba ditahan) dan seluruh akun laba-rugi.

## Rekonsiliasi per kategori

Sebuah akun kontrol yang membawa kategori harus cocok dengan sub-ledgernya
**per kategori**, bukan hanya pada totalnya. `1401` yang totalnya cocok tetapi
yang `ASURANSI_BAYAR_DIMUKA`-nya tidak berarti dua jadwal saling menutupi.
Panel kontrol membandingkan pada tingkat yang sama dengan sub-ledgernya: prepaid
per jadwal, pajak per jenis per masa, uang muka per dokumen.

## Antar unit

Bukan subledger lawan buku besar, melainkan sifat: setiap piutang antar unit
adalah hutang unit lain, jadi **jumlah `1501` untuk seluruh perusahaan harus
nol**. Angka selain nol berarti satu kaki dari sepasang tidak pernah diposting.

Satu badan hukum (pemilik, 18 September 2026) adalah yang membuat ini sekeras
itu: dalam satu entitas saldo antar-unit bukan aset dan bukan kewajiban, ia
tereliminasi saat konsolidasi. Sebelum bagan 40 invarian yang sama tersebar di
lima akun afiliasi dan tidak pernah diuji sama sekali — sebuah aturan yang tidak
bisa ditulis sebagai satu query adalah aturan yang tidak dijalankan.

Rincian per pasangan tidak hilang: `counter_site_id` wajib pada `1501`, jadi
*gross* HO↔toko tetap terbaca meski akunnya satu.
