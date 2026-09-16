# Hari dagang punya satu otoritas

Phase 2B bagian D. Migrasi **0273**, commit di bawah.

## Cacatnya

Dua modul memposting takings satu hari, keduanya di bawah
`source_kind = 'SALE_DAY'`, masing-masing idempoten **terhadap dirinya sendiri**
dan buta terhadap yang lain:

| | `sales_posting.rs` | `sale_day.rs` |
|---|---|---|
| lahir | 2026-09-06 | 2026-09-14 (lewat merge lane) |
| `source_id` | uuid dokumen | `site:day` |
| penjaga | `UNIQUE (site_id, business_date)` di `sales_posting` | `PRIMARY KEY (site_id, trading_day)` di `sale_day_posting` |
| `purpose` | `ATTEMPT_n` | `MAIN` |

`ux_journal_entry_source_purpose` unik atas (`source_kind`, `source_id`,
`purpose`), dan **dua bentuk `source_id` itu tak pernah bertabrakan**. Jadi hari
Selasa satu toko bisa diposting lewat keduanya: pendapatan diakui dua kali, dan
neraca saldo seimbang dua-duanya.

0260 memperburuknya tanpa sengaja — ia membuang `ux_journal_entry_sale_day`
dengan alasan "satu penjaga, bukan dua yang berselisih", yang benar soal
duplikasinya dan meninggalkan komentar di `sale_day.rs:510` yang menjanjikan
jaminan yang sudah tidak ada.

Diperiksa di setiap database dev: **nol baris** di kedua tabel, nol entri
berbentuk `site:day`. Jadi belum ada hari yang benar-benar tergandakan — yang
ada adalah pintunya.

## Yang dipilih, dan mengapa

**`sales_posting` yang kanon.** Bukan karena lebih tua, tapi karena seluruh mesin
uang sudah tersambung padanya:

- ia membuka **Payment Ledger item per piutang acquirer**, ber-qualifier
  provider, dan `acquirer::acq_settlement_settle_ledger_items` menutupnya saat
  acquirer membayar. Hari yang diposting lewat jalur satunya menaruh piutang
  kartu di buku besar **tanpa open item** — utang yang tak bisa ditagih siapa
  pun, dan selisih yang `payment_ledger_integrity` laporkan selamanya;
- ia punya satu-satunya jalur koreksi yang dimiliki hari terposting: reverse,
  generate ulang di atas `posting_id` yang sama, post lagi sebagai `ATTEMPT_n`.
  `sale_day.rs` tak punya reversal sama sekali;
- ia membawa diskon, retur, dan uang yang tak tertender, dan tahu apa yang harus
  dilakukan pada tender yang tak dikenalnya: **menolaknya** dan menawarkan
  `retender`;
- uang QRIS-nya `qris_receivable` per provider, yang memang hakikat QRIS (0274).
  `sale_day.rs` memakai `qris_clearing`, meaning yang tak dibaca apa pun lagi di
  estate ini.

**Ini keputusan yang tidak nyaman, dan itu dicatat.** `sale_day.rs` punya 14 tes
integrasi yang ditulis untuk chart HARI INI, sementara suite `sales_posting`
merah — fixture-nya menulis kode 12 digit pra-collapse yang `ledger_account_carries_no_unit`
(0244) tolak. Fixture itu diperbaiki di commit yang sama, dan suite kanon
sekarang **12/12 hijau**. Jadi keputusannya terverifikasi, bukan diasumsikan.

## Dua hal yang dibawa pergi jalur yang dipensiunkan

**Pajak dari `sale.tax_minor` sendiri, bukan dihitung ulang dari tarif.**
Diukur pada 21.829 penjualan nyata:

```
pajak tercatat      1.359.033.170
dihitung 11% inklusif 1.359.022.320
selisih                     10.850   (0,0008%)
```

Jadi bukan salah tarif — pembulatan per-penjualan yang menumpuk, karena
`sales_posting` membulatkan sekali per keranjang tender sementara struk
membulatkan per penjualan. Angka tercatat tetap sumber yang lebih benar.
**Tidak diubah di sini**, karena mengubahnya mengubah angka dan itu keputusan
tersendiri. Tercatat sebagai tindak lanjut.

**Fee acquirer per hari.** Bukan kehilangan: fee milik settlement, bukan milik
hari. Acquirer membayar belakangan dan neto (0135), dan `acquirer_settlement`
adalah tempat fee-nya **diketahui**, bukan ditebak saat posting.

## Cara wewenangnya dicabut

Dihapus, bukan disembunyikan:

- `post_sale_day` beserta handler dan rutenya **dihapus** (≈300 baris);
- `journal_entry_sale_day_is_named_by_its_posting` — CHECK yang menolak setiap
  `source_id` SALE_DAY yang bukan uuid, jadi bentuk `site:day` tak bisa kembali
  lewat revert, merge, atau implementasi ketiga yang kelihatan masuk akal;
- trigger di `sale_day_posting` yang menolak baris baru. Tabelnya **tidak
  di-drop**: kalau ada environment yang berisi, itu yang pernah diposting dan
  pembacanya masih menampilkannya sebagai sejarah.

Pembacanya tetap ada dan **dialihkan**: "hari mana yang belum masuk buku" adalah
pertanyaan nyata yang daftar posting tak bisa jawab, dan sekarang dijawab dari
otoritasnya. Tanpa itu, sesudah penghapusan setiap hari akan terbaca belum
diposting — daftar yang bilang buku belum dengar soal hari yang sudah didengarnya
lebih buruk daripada tak ada daftar.

## Tes

`backend/tests/day_posting_authority.rs`, 6 tes:

1. tabel penulis pensiunan menolak baris baru;
2. entri hari hanya boleh dinamai oleh posting-nya (dan penamaan otoritasnya
   tetap diterima, jadi penjaganya bukan sekadar menolak segalanya);
3. satu toko satu hari = satu hasil akuntansi otoritatif;
4. daftar melaporkan hari yang diposting otoritas sebagai terposting;
5. QRIS punya piutang sendiri dan tender tak bernama tidak;
6. voucher punya kewajiban untuk diselesaikan.

Plus `sales_posting_integration` 12/12 hijau sesudah fixture-nya dipindah ke
chart yang sudah dikumpulkan.
