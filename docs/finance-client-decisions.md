# Pertanyaan yang menunggu jawaban klien

Satu berkas, satu bentuk. Untuk tiap butir: **pertanyaannya**, **kenapa penting**,
**apa yang aman dilakukan sekarang**, dan **apa yang terbuka setelah dijawab**.

Aturannya: ketidakpastian **kode akun** tidak boleh menjadi ketidakpastian
**arti akuntansi**. Semua butir di bawah punya perilaku aman yang sudah jalan,
jadi tidak ada yang menahan pekerjaan lain.

---

## 1. Kode resmi untuk delapan akun yang kita cetak sendiri

**Pertanyaan.** Bagan klien tidak punya slot untuk delapan hal yang sistem ini
memang lakukan. Kita memakai kode dan nama pilihan sendiri. Apa kode resmi
mereka untuk masing-masing?

| kode kita | nama | untuk apa | dibuat |
|---|---|---|---|
| `1011005` / `1011005001` | Setoran Dalam Perjalanan | uang yang sudah keluar laci dan belum masuk bank | 0243, dihapus 0254, dikembalikan 0277 |
| `1011101003` | Piutang QRIS | QRIS ditagih ke provider, bukan ke acquirer kartu | 0274 |
| `4010114` / `4010114001` | Penjualan QRIS | pendapatan QRIS supaya bisa direkonsiliasi per provider | 0274 |
| `2012305` / `2012305001` | Hutang Voucher | voucher = uang yang sudah diterima | 0275 |
| `2012101006` | Hutang Pajak PPh Pasal 29 | PPh 29 harus punya tempat terutang | 0265 |

**Kenapa penting.** Kalau klien punya kode sendiri, laporan mereka dan laporan
kita akan menyebut baris yang sama dengan dua nomor.

**Aman sekarang.** Kedelapan baris ditandai
`ledger_account.code_provenance = 'PENDING_CLIENT_CODE'` (0277). Audit
`scripts/audit-chart-against-client.py` membacanya dan melaporkannya sebagai
pengecualian yang dideklarasikan — bukan sebagai kegagalan — dan tetap gagal
kalau muncul akun kesembilan yang tak dideklarasikan.

**Setelah dijawab.** Satu `UPDATE` per akun + satu baris `ledger_account_remap`.
Tidak ada jurnal yang bergerak.

---

## 2. PPh 29 — sebelum Tax

**Pertanyaan.** Untuk tahun berjalan: berapa PPh 29 terutang, dan apakah ada
saldo PPh 29 dibayar dimuka dari tahun lalu yang masih hidup?

**Kenapa penting.** `2012101006 Hutang Pajak PPh Pasal 29` (liability) dan
`1011302003 Prepaid - PPh Pasal 29` (asset) adalah dua hal berbeda. Menjaringkan
keduanya karena namanya mirip akan menyembunyikan salah satunya.

**Aman sekarang.** Keduanya ada, terpisah, dan tidak ada aturan yang menjaring
otomatis.

**Setelah dijawab.** Perhitungan dan penyelesaian PPh 29 di modul Tax.

---

## 3. Empat bank selain BCA

**Pertanyaan.** Rekening giro/tabungan mana yang nyata di Mandiri, BRI, BNI,
Danamon — nomor, pemegang, cabang?

**Kenapa penting.** `giro_outstanding` baru terpetakan untuk BCA; 56 pasang
(4 bank × 14 unit) belum. Giro yang ditulis di bank yang belum dipetakan tidak
bisa dikliringkan.

**Aman sekarang.** Posting menolak dengan menyebut bank yang belum dipetakan,
bukan menebak.

**Setelah dijawab.** Impor lewat `docs/templates/company-bank-accounts.csv`.

---

## 4. Rak: 36 baris atau satu

**Pertanyaan.** Bagan klien punya `Rak 1`…`Rak 36` di tiga famili (aset,
cadangan penggantian, beban penggantian). Kita menyimpan satu. Apakah mereka
benar-benar ingin 36 akun terpisah, atau satu akun dengan register aset di
belakangnya?

**Kenapa penting.** 980 pasangan pemetaan menunggu jawaban ini.

**Aman sekarang.** `Rak 1` dipetakan; aset rak lain ditolak saat dipetakan,
bukan salah posting.

---

## 5. Pembentukan cadangan penggantian (RR)

**Pertanyaan.** Apakah cadangan penggantian operating equipment masih dibentuk
tiap bulan, atau hanya dipakai saat rak diganti?

**Kenapa penting.** `1021607001` menolak posting `ASSET_RESERVE` hari ini —
sengaja (0263): jalurnya "ditahan menunggu kebijakan".

**Aman sekarang.** Penarikan boleh, pembentukan ditolak dengan alasan jelas.

---

## 6. Apakah ada kontrak leasing aktif

**Pertanyaan.** `8020111002 Biaya Bunga Leasing` ada di bagan. Apakah ada
kontrak leasing yang berjalan sekarang?

**Kenapa penting.** Menentukan apakah Financing perlu tipe `LEASE` sekarang atau
tidak sama sekali.

**Aman sekarang.** Kapabilitas lease dibiarkan dorman; bunga leasing tetap bisa
dicatat sebagai beban bunga biasa.

---

## 7. Dua penulis untuk satu setoran toko *(keputusan teknik, bukan klien)*

**Temuan.** Dua modul menulis setoran toko ke buku besar:

| | `deposits.rs` | `store_money.rs` |
|---|---|---|
| rute | `/api/v1/finance/deposits/{id}/bank` · `/land` | `/api/v1/store/…/deposits/{id}/hand-over` · `/confirm` |
| status | `banked_on` / `landed_on` | `PREPARED` → `DEPOSITED` → `CONFIRMED` |
| kaki bank | di **toko** | di **kantor pusat** (benar) |

**Kenapa penting.** Ini bentuk yang sama dengan dua penulis hari dagang yang
0273 tutup. Lebih jauh, kaki bank `deposits.rs` melanggar aturan dimensi
`company` yang kernel tegakkan sejak 0262 — akun bank memposting di `dc`, bukan
di toko — jadi `/land` menolak dengan *"belongs to the company and not to a
shop"* dan empat tes di `store_documents_integration` merah karenanya.

**Aman sekarang.** Jalur `store_money.rs` benar dan dipakai UI toko. Jalur
`deposits.rs` gagal dengan penolakan yang jelas, bukan dengan angka salah.

**Perlu keputusan.** Satu otoritas dipilih dan yang lain dihapus, seperti 0273 —
atau `deposits.rs` diperbaiki kaki banknya dan keduanya tetap hidup. Ini
menyentuh dua modul dan dicatat di sini alih-alih diputuskan sepihak.
