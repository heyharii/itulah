# Alur PO: kita vs Seventhsoft

**Tanggal:** 20 September 2026. Diperiksa dari skema `itulah_dev`, rute HTTP cloud & edge,
dan layar `frontend-hub` — bukan dari ingatan.

---

## 1. Rantai mereka

Halaman depan modul PEMBELIAN adalah diagram, dan ikonnya tombol:

```
Order Pembelian ──→ Barang Datang ──→ Faktur Beli ──→ Pelunasan
                                            ↓
                                       Retur Beli
```

Empat langkah, satu modul, satu rail. Dokumen PO mereka:

```
NO PO      PO-19-12-00002        GUDANG    PUSAT-BELAKANG
SUPPLIER   ABADI  S-0038         KIRIM KE  KONTAINER
LOKASI     SURABAYA              NO REF
TERMIN     30                    TOTAL DISKON   __ %  =  0.00
DIBUTUHKAN 24 Dec 2019           PPN            PPN10  10 %
                                 KETERANGAN

tab   Detail 1 of 1  │  PO-BPB-INVOICE        ← pencocokan tiga arah, DI DALAM PO
baris NAMA ITEM · KODE · JUMLAH · SATUAN · HARGA INPUT · HARGA · DISKON %/Rp · SUBTOTAL
tombol … Copy · Closed · Import
```

## 2. Rantai kita

Ekonominya sama. Tempatnya **tidak**: tiga modul, dua aplikasi.

```
PO                 /procurement/orders          hub      purchase_order
                                                         DRAFT → ISSUED → CLOSED / CANCELLED
Barang datang      /operations/intake           hub      goods_receipt
                   + aplikasi edge DC                    OPEN → COMPLETED / REJECTED
Tagging RFID       /operations/tagging          hub      ← langkah yang mereka tak punya
Faktur beli        /finance/bills               hub      supplier_invoice  POSTED / VOID
Pelunasan          /finance/payments            hub      supplier_payment + allocation
Retur beli         (tidak ada layar)            —        stock_ledger_return_to_supplier
```

Penerimaan barang **tidak punya rute di cloud sama sekali** — ia milik edge:
`/api/v1/dc/goods-receipts` · `/api/v1/dc/intake` · `/api/v1/dc/tagging-jobs` ·
`/api/v1/dc/tagging-confirmations`. Hub hanya membacanya.

---

## 3. Di mana kita LEBIH BAIK

### 3.1 Pencocokan tiga arah tersimpan per BARIS, bukan hanya ditampilkan

```sql
supplier_invoice_line(invoice_line_id, invoice_id, line_number,
                      po_line_id,          ← baris PO mana
                      receipt_line_id,     ← baris penerimaan mana
                      description, quantity, unit_price_minor, line_amount_minor, tax_minor)

supplier_invoice_receipt(invoice_id, receipt_id, matched_by, matched_at)
```

Satu faktur boleh menjawab banyak penerimaan, dan **tiap baris faktur tahu baris PO dan
baris penerimaannya sendiri**. Seventhsoft memperlihatkan pencocokan di sebuah tab; kita
menyimpannya sebagai data, lengkap dengan siapa yang mencocokkan dan kapan.

### 3.2 Kelebihan terima adalah KEPUTUSAN, bukan selisih

```sql
purchase_excess_decision(receipt_line_id, outcome,
                         agreed_unit_price_minor, reason, decided_by, decided_at)
```

Barang datang lebih banyak dari PO → seseorang memutuskan: terima dengan harga yang
disepakati, atau tolak — beralasan dan bertanda tangan. Tidak ada padanannya di video mana pun.

### 3.3 Tiga hal lagi yang mereka tak punya

- **Tagging RFID** antara penerimaan dan stok — satu langkah penuh.
- **Penerimaan tahan putus**: `goods_receipt` membawa `generation`/`seq`, dikerjakan di
  DC dan disinkronkan; DC tetap bekerja saat jaringan mati.
- **`purchase_price_amendment`** dan **`purchase_order_line_tag`** — perubahan harga dan
  penandaan baris punya riwayatnya sendiri.

---

## 4. Di mana mereka LEBIH BAIK

### 4.1 Satu modul lawan tiga modul dua aplikasi

Pertanyaan "PO ini sampai mana" di tempat mereka dijawab di **satu layar**. Di tempat kita
butuh tiga: `/procurement/orders` → `/operations/intake` → `/finance/bills`.

Bagi pembeli, itu tiga tempat untuk satu pekerjaan.

### 4.2 Tab **PO-BPB-INVOICE** — datanya kita punya, layarnya tidak

Kita menyimpan `po_line_id` dan `receipt_line_id` di tiap baris faktur, dan
`supplier_invoice_receipt` menjembatani faktur ke penerimaan. **Tetapi tidak ada layar yang
menampilkannya di atas PO.** Untuk menjawab "PO ini sudah datang berapa, ditagih berapa"
orang harus membuka `/procurement/outstanding` lalu `/finance/unbilled` — dua layar,
dua modul, dan tak satu pun adalah PO-nya.

> **Ini perbaikan termurah di seluruh dokumen ini:** satu tab di layar PO, memakai data yang
> sudah ada. Nol migrasi, nol akun, dan `/procurement/outstanding` bisa lebur ke dalamnya.

### 4.3 Header PO kita kehilangan empat field yang membuat totalnya bisa dibandingkan

| field mereka | kita |
|---|---|
| `TERMIN` 30 hari | **tidak ada di PO** — termin hidup di supplier dan faktur |
| `PPN` PPN10 10% | **tidak ada di PO** — pajak baru muncul di faktur |
| `TOTAL DISKON` % dan Rp | `discount_minor` ada, tetapi tanpa persentase |
| `DIBUTUHKAN` (tanggal butuh) | **tidak ada** |
| `KIRIM KE` teks bebas | `destination_site_id` — lebih ketat, dan itu benar |

Akibat yang paling terasa: **tanpa PPN di PO, total PO tidak sebanding dengan total faktur.**
Pencocokan tiga arah jadi membandingkan angka sebelum pajak dengan angka sesudah pajak, dan
selisihnya harus dijelaskan orang setiap kali.

### 4.4 Retur Beli adalah dokumen kelas satu di sana, fungsi tanpa layar di sini

`stock_ledger_return_to_supplier` ada dan memposting `CREDIT_NOTE` dengan benar. Yang tidak
ada: layar untuk memulainya. Di diagram mereka, Retur Beli bercabang dari Faktur Beli dan
punya dokumennya sendiri.

### 4.5 Dua tombol kecil yang berguna

- **`Closed`** pada PO — menutup pesanan secara sadar, bukan menunggu semua baris habis.
  Kita punya status `CLOSED`; yang perlu dicek apakah ada tombolnya.
- **`Import`** — memasukkan PO dari Excel. Untuk pemasok yang mengirim daftar dalam
  spreadsheet, itu menghemat pengetikan satu musim penuh.

---

## 5. Perbandingan status

| langkah | Seventhsoft | kita |
|---|---|---|
| PO | (tak terlihat; ada tombol `Closed`) | `DRAFT` → `ISSUED` → `CLOSED` · `CANCELLED` |
| baris PO | — | `OPEN` → `CLOSED` · `CANCELLED` |
| penerimaan | — | `OPEN` → `COMPLETED` · `REJECTED` (+ `rejected_reason`) |
| faktur | — | `DRAFT` → `MATCHED` → `POSTED` · `REJECTED` · `VOID` |
| pelunasan | ☑ LUNAS per baris di BKK | `supplier_payment_allocation` per faktur |

Status kita jauh lebih rinci di tiga langkah pertama. Di langkah terakhir mereka lebih
baik: centang **LUNAS** per baris faktur di dalam BKK, dengan kolom **POTONGAN** —
alokasi dan potongan pelunasan dalam satu layar (lihat `seventhsoft-vs-kita-2026-09.md` §1.1).

---

## 6. Yang saya usulkan

| # | perbaikan | ongkos | dampak menu | dampak akun |
|---|---|---|---|---|
| **1** | **Tab pencocokan PO–penerimaan–faktur di layar PO** | layar saja; datanya sudah ada | **−1 baris** (`/procurement/outstanding` lebur) | nol |
| **2** | **PPN dan termin di header PO** | 2 kolom + form | nol | nol |
| **3** | **Layar Retur Beli** | 1 layar di atas fungsi yang sudah ada | **+1 baris** | nol |
| **4** | Halaman depan Procurement = **diagram alur** yang bisa diklik | layar | nol | nol |
| **5** | Tanggal `DIBUTUHKAN` di PO | 1 kolom | nol | nol |
| — | Import PO dari Excel | 1 layar | nol | nol |

Nomor 1 dan 2 bersama-sama membuat pencocokan tiga arah **benar-benar bisa dibaca**:
satu layar, dan angka yang dibandingkan akhirnya sebanding.

**Yang tidak diambil:** menyatukan semuanya ke satu modul. Penerimaan barang kita hidup di
DC dan harus tetap bekerja saat jaringan mati — itu alasan arsitektur, bukan kelalaian menu.
Yang bisa kita ambil adalah **rasanya** satu tempat: tab di PO, dan alur bergambar di depan.
