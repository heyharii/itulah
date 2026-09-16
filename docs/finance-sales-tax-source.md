# Pajak hari dagang: tercatat, bukan dihitung ulang

Audit Phase 2B, 16-09-2026. Pertanyaannya: `sales_posting` memposting PPN yang
**dihitung ulang** dari tarif, sementara sumbernya sudah membawa angka pajaknya
sendiri. Mana yang otoritatif?

## 1. Field pajak apa yang tersimpan di sumber

Ada dua sumber penjualan, dan keduanya menyimpan pajak:

| sumber | kolom | nullable | ditulis oleh |
|---|---|---|---|
| `sale` (kasir pusat) | `tax_minor`, `net_minor` | **NOT NULL** | `sales.rs:271`, akumulasi dari tiap baris |
| `sale_line` | `tax_minor`, `tax_rate_bps`, `tax_inclusive`, `tax_category`, `commercial_publication_id` | NOT NULL | `sales.rs:268` |
| `edge_sale` (till toko, ikut sync) | `tax_total_minor`, `net_ex_tax_minor`, `charge_tax_minor` | **nullable** | `edge/sqlite.rs:5033` → `sync.rs:5924` |
| `edge_sale_line` | `tax_minor`, `net_ex_tax_minor` | nullable | idem |
| `sale_return` | — | — | **tidak ada kolom pajak sama sekali** |
| `sale_return_line` | — | — | hanya `refund_minor`, `sale_line_id`, `subject_id` |

## 2. Apakah nilai itu dari transaksi POS yang otoritatif

Ya, untuk penjualan.

* **Kasir pusat**: `sales.rs:235-270` mengambil `rate_bps` + `tax_inclusive` dari
  `commercial_tax_rule` **untuk kategori pajak produk itu, pada versi buku yang
  memberi harga baris itu**, dan **menolak** kalau buku tidak punya aturan untuk
  kategori tersebut. `calculate_line_totals` menghitungnya sekali per baris.
  Jadi `sale.tax_minor` adalah pajak yang benar-benar dipungut ke pelanggan.
* **Till toko**: `tax_total_minor` = jumlah `line.tax_minor` dari **quote mesin
  harga** yang dipakai saat transaksi, per baris, per kategori, offline
  sekalipun. NULL hanya kalau keranjang dihargai **tanpa buku yang berlaku** —
  dan komentar di till menyebutnya eksplisit: nol akan mengklaim semuanya barang,
  jadi ditulis NULL, bukan 0.

Artinya NULL di sini berarti **tidak diketahui**, bukan **nol**.

## 3. Kenapa `sales_posting` menghitung ulang

Bukan keputusan yang pernah diambil — warisan bentuk datanya. `read_day` hanya
menjumlahkan `total_minor`, `change_minor`, `discount_total_minor`, lalu
`build()` mengekstrak PPN dari **keranjang tender** dengan
`vat_within(receipts, day_vat_rate_bps())`. Tarifnya
`MAX(commercial_tax_rule.rate_bps)` pada **publikasi terbaru**, atau fallback 11%
kalau node belum pernah di-seed commercial.

Tiga hal yang salah arah di situ, dan ketiganya diam:

1. **Granularitas pembulatan.** Struk membulatkan sekali per penjualan; posting
   membulatkan sekali per keranjang tender. Selisihnya menumpuk.
2. **Kategori pajak diratakan.** `MAX(rate_bps)` dipilih karena "totals hari tak
   membawa kategori untuk memisahnya". Hari dengan dua kategori pajak diposting
   seolah semuanya di tarif tertinggi.
3. **Tarif hari ini dipakai untuk hari kemarin.** Ia membaca publikasi
   **terbaru**, bukan yang berlaku saat transaksi. Hari lama yang diposting
   setelah publikasi baru akan memakai tarif yang belum berlaku saat itu.

## 4. Apakah jurnal harus memakai pajak tercatat

Ya. Angka pungutan adalah kejadian, bukan turunan: PPN keluaran adalah uang
pihak lain yang sudah ditulis di struk pelanggan. Menghitung ulang berarti
membukukan angka yang **tidak pernah dipungut**, dan selisihnya bukan nol —
diukur pada 21.829 penjualan nyata (lihat `finance-day-posting-authority.md`):

```
tercatat                1.359.033.170
dihitung 11% inklusif   1.359.022.320
selisih                        10.850   (0,0008%)
```

Perhitungan tarif tetap dijalankan, tapi turun pangkat jadi **validasi**:
disimpan di `sales_posting.vat_recomputed_minor` pada setiap hari, sehingga
selisih terhadap `vat_recorded_minor` bisa dikueri, bukan sekadar dicatat di log.

## 5. Retur/refund

`sale_return` **tidak menyimpan pajak**. Hari ini refund di-unwind dengan
`vat_within(returns_minor, tarif hari ini)` — yang salah dua kali untuk retur
barang lama: tarif yang dipakai bisa bukan tarif saat barang itu dijual, dan
pembulatannya lagi-lagi per hari.

Pajaknya **bisa** diturunkan, karena `sale_return_line` menunjuk baris aslinya:

* `sale_return_line.sale_line_id` → `sale_line.tax_minor` (kasir pusat);
* `sale_return.sale_id` + `sale_return_line.subject_id` →
  `edge_sale_line.tax_minor` (till toko).

Refund sebagian diskalakan dengan `refund_minor / total_minor` baris itu.

## 6. Bisakah 21.829 penjualan historis diposting ulang deterministik

Untuk penjualan: ya — `sale.tax_minor` NOT NULL dan `edge_sale.tax_total_minor`
tidak berubah setelah sync, jadi hari yang sama menghasilkan angka yang sama
berapa kali pun digenerate ulang. Yang **tidak** deterministik justru perhitungan
ulangnya: ia membaca publikasi terbaru, jadi angkanya bisa berubah besok tanpa
satu pun penjualan berubah.

Dua syarat yang harus dipenuhi sebelum sebuah hari boleh disebut tercatat:

* tidak ada `edge_sale` di jendela itu dengan `tax_total_minor` NULL;
* setiap baris retur di jendela itu ketemu baris aslinya, dan jumlah
  `refund_minor` baris-barisnya sama dengan `refund_total_minor` di kepala retur.

Kalau salah satu tak terpenuhi, hari itu **tidak dicampur**: ia diposting dengan
tarif seperti sebelumnya, dan `vat_source = 'RATE'` mengatakannya di dokumen.

## Yang diubah

* migrasi `0276` — `sales_posting.vat_source`, `vat_recorded_minor`,
  `vat_recomputed_minor`, plus CHECK bahwa hari `RECORDED` punya angka tercatat;
* `read_day` membaca pajak tercatat penjualan dan retur;
* `build()` memakai angka tercatat kalau ada (dialokasikan ke keranjang tender
  dengan sisa-terbesar supaya jurnalnya tetap seimbang), kalau tidak ada tetap
  `vat_within` seperti sebelumnya;
* tak ada angka yang berubah pada hari yang sumbernya tak mencatat pajak — 12 tes
  `sales_posting_integration` yang ada tetap hijau dengan angka yang sama.
