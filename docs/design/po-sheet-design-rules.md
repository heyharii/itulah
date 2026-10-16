# UI consistency guidelines — Procurement sheets

Aturan untuk Purchase Orders, detail PO, create/edit PO, dan Add item. Acuan implementasi: `po-shell-layers.html`. Berlaku untuk struktur dan komponen bersama; isi tiap permukaan mengikuti tugasnya.

## 1. Satu struktur permukaan

Urutan tetap:

```text
Surface
├── Header
│   ├── Konteks / jalur kembali
│   ├── Judul
│   └── Subtitle + aksi lokal / Close
├── Body yang bisa di-scroll
│   ├── Ringkasan atau informasi utama
│   ├── Kelompok isi
│   └── Informasi tambahan
└── Footer aksi, jika permukaan membutuhkan konfirmasi
```

Header dan footer tetap terlihat saat body di-scroll. Scroll dimiliki body, bukan keseluruhan sheet. Semua bagian memakai garis kiri dan kanan yang sama.

List boleh memakai tabs dan toolbar. Detail, create/edit, dan Add item tidak memakai tabs. Jangan menambahkan slot kosong hanya agar semua layout identik.

| Permukaan | Konteks dan judul | Urutan body | Aksi utama |
| --- | --- | --- | --- |
| Purchase Orders | Procurement → Purchase Orders | KPI → tabs → pencarian/filter → daftar | New order di header |
| Detail PO | Purchase Orders / ID PO → nama supplier | Ringkasan → Order items → Notes → Activity | Edit di footer |
| Create/edit PO | Purchase Orders / Draft atau ID PO → Create/Edit purchase order | Order details → Order items → totals → Additional information | Review order di footer |
| Add item | ID PO atau New purchase order / New item → Add item | Item information → Classification → Purchase details → item total | Add item di footer |

Create dan edit memakai template composer yang sama. Perbedaan ada pada judul, nilai awal, dan status. Detail memakai ringkasan baca, sedangkan composer memakai input.

## 2. Tipografi

| Fungsi | Ukuran | Weight |
| --- | --- | --- |
| Judul permukaan | 17 px | 600 |
| Nilai ringkasan | 16 px | 600 |
| Isi utama, nilai field, isi tabel | 15 px | 400–500 |
| Breadcrumb, subtitle, label, header tabel, status, tombol | Minimum 14 px | 400–600 |
| Judul kelompok | 14 px | 600 |
| Input di mobile | 16 px | 400 |

Tidak ada teks UI di bawah 14 px, termasuk metadata dan placeholder. Jangan mengecilkan font agar konten muat. Gunakan wrapping, ubah jumlah kolom, atau biarkan body di-scroll. Judul tetap kecil; hierarki dibentuk lewat weight, jarak, dan warna.

Gunakan angka tabular untuk quantity, harga, dan total. Angka tabel rata kanan di desktop. Di mobile, label dan nilai tetap berpasangan.

## 3. Spacing dan alignment

Gunakan langkah utama 4, 8, 12, 16, 20, 24, dan 28 px. Jarak terkait lebih dekat daripada jarak antar kelompok.

| Token bersama | Desktop | Tablet | Mobile |
| --- | --- | --- | --- |
| `--surface-gutter` | 28 px | 24 px | 20 px |
| `--surface-block` | 24 px | 24 px | 20 px |
| `--section-gap` | 16 px | 16 px | 20 px |
| `--field-gap` | 16 px | 16 px | 16 px |
| `--control-height` | 40 px | 40 px | 44 px |
| `--action-height` | 36 px | 36 px | 44 px |

Header, field, judul kelompok, tabel, dan footer memakai gutter yang sama. Jangan memberi padding khusus ke satu screen untuk memperbaiki alignment. Ubah token atau komponen bersama.

## 4. Surface dan radius

Desktop dan tablet memakai sheet putih dengan radius 16 px, shadow lembut, dan batas permukaan yang tenang. Control memakai radius 8 px. Variasi A–F pada prototipe adalah eksplorasi shell; struktur isi sheet tetap sama.

Permukaan wajib memotong background anak dengan `overflow: hidden`. Body di dalamnya tetap bisa di-scroll. Header putih tidak boleh menutup atau keluar dari sudut rounded.

Kelompok form memakai judul dan divider tipis. Hindari card bertumpuk di dalam sheet. Gunakan fill lembut hanya untuk bagian yang memang membutuhkan batas, misalnya input, thumbnail, dan table header.

## 5. Hierarki isi

Satu kelompok menjawab satu kebutuhan. Identitas item, klasifikasi, dan pembelian menjadi tiga kelompok terpisah. Label berada di atas input. Penanda Optional ditempelkan pada label, bukan menjadi pesan tambahan.

Ringkasan membantu membaca keputusan: quantity dan grand total mendapat penekanan. Metadata supplier, ID, dan tanggal tetap terbaca dengan font minimum 14 px. Jangan memberi semua nilai penekanan yang sama.

Gunakan warna utama untuk aksi dan focus. Status memakai warna bersama label teks. Semua Cancel, termasuk Cancel order, memakai filled merah. Biru pekat khusus aksi utama seperti Review PO, Add item, Submit, dan Review order. Aksi pendukung memakai ghost netral: teks gelap, background putih, hairline tipis bila perlu, dan abu lembut saat hover. Ikon edit/hapus di tabel juga ghost; warna merah dipakai untuk pembatalan dan konfirmasi destruktif.

## 6. Aksi dan navigasi

Gunakan satu filled primary biru per konteks aksi utama. Filter, Columns, Print, Close, dan ikon edit/hapus memakai ghost netral. Ghost tetap terbaca di atas permukaan putih; hindari teks biru untuk semua aksi pendukung. Aksi konfirmasi berada paling kanan, Cancel merah di sebelah kirinya, dan opsi tambahan di kiri. Hierarki aksi ditentukan lewat penekanan visual, posisi, dan label. Breadcrumb tetap berupa link navigasi. Aksi yang hanya berlaku pada suatu kelompok, seperti Add item, berada di header kelompok tersebut.

Close kembali satu tingkat. Cancel juga kembali ke konteks induk. Escape mengikuti urutan Add item → composer → detail/list. Breadcrumb menyediakan jalan kembali yang jelas.

Saat sheet baru terbuka, fokus berpindah ke dalam sheet. Saat ditutup, fokus kembali ke pemicunya. Permukaan di belakang sheet tidak menerima fokus atau input. Focus ring harus terlihat saat navigasi keyboard.

## 7. Responsive

| Lebar viewport | Perilaku |
| --- | --- |
| Di atas 1050 px | Rail + menu + halaman; sheet record lebar dan Add item lebih sempit. Konteks induk masih terlihat. |
| 601–1050 px | Menu samping disembunyikan, rail tetap ada. Sheet mengikuti ruang layar; field tetap dua kolom saat cukup. |
| 600 px ke bawah | Sheet layar penuh; breadcrumb menjadi penunjuk hierarki. Field satu kolom. List PO dan tabel item menjadi baris kartu dengan label nilai. |

Di mobile, radius sheet menjadi 0 karena sheet memenuhi layar. Halaman list yang berada di shell tetap menjadi permukaan tersendiri. Footer tidak ikut hilang saat scroll, dan konten terakhir harus bisa di-scroll sampai terlihat seluruhnya di atas footer.

Tidak boleh ada horizontal scroll untuk form, tombol, header, atau daftar mobile. Navigasi dan input yang dipakai dengan sentuhan membutuhkan area target sekitar 44 px. Ukuran font tidak berubah menjadi lebih kecil di tablet atau mobile.

## 8. Motion

Membuka lapisan baru menggunakan satu gerakan slide dari kanan: 340 ms masuk dan 200 ms keluar. Permukaan induk tetap diam, memudar lewat veil abu netral `rgb(210 208 204 / 48%)`, dan diberi blur ringan 2 px. Pada sheet bertingkat, backdrop tambahan hanya menutup parent sheet agar scrim seluruh layar tidak menumpuk. Sheet aktif tetap putih dan tajam. Pergantian detail ↔ edit menggunakan pergantian isi di permukaan yang sama, bukan sheet baru.

Hormati reduced motion dengan mengganti slide menjadi fade singkat. URL yang langsung membuka sheet harus tampil pada posisi akhir tanpa animasi masuk awal.

## 9. Pemetaan komponen

| Komponen | Selector prototipe |
| --- | --- |
| Surface | `.page`, `.sheet` |
| Scroll body | `.page-in`, `.pane-in` |
| Header bersama | `.head`, `.path`, `.sub`, `.close` |
| Kelompok informasi | `.form-group`, `.section-title`, `.section-bar` |
| Field | `.fields`, `.inp`, `.unit-input` |
| Ringkasan | `.kpis`, `.kpi`, `.item-total` |
| Data | `.tbl`, `.it` |
| Footer | `.foot`, `.primary`, `.plain` |

Saat menambah sheet baru, pakai komponen dan token ini dahulu. Tambahkan layout khusus hanya di body. Jangan membuat skala font, header, padding, footer, atau transisi baru untuk satu screen.

## 10. Pemeriksaan sebelum dianggap selesai

- Judul, subtitle, kelompok isi, dan footer mengikuti urutan bersama.
- Semua teks UI minimum 14 px; isi utama 15 px.
- Garis kiri/kanan header, body, dan footer sejajar.
- Radius terlihat bersih, termasuk saat header sticky dan body di-scroll.
- Biru pekat khusus aksi utama; aksi pendukung ghost netral; Cancel merah. Aksi konfirmasi di kanan dengan label spesifik seperti Add item atau Review order.
- Form dan daftar tidak terpotong pada lebar 320, 390, 768, dan 1280 px.
- Body bisa mencapai konten terakhir; footer tetap terlihat.
- Close, Cancel, Escape, dan fokus keyboard mengikuti konteks induk.
- Perubahan token diperiksa pada list, detail, create/edit, dan Add item sekaligus.

Prototipe memakai data contoh. Interaksi Add item diperbarui di halaman lokal selama sesi preview; integrasi penyimpanan backend berada di luar aturan layout ini.
