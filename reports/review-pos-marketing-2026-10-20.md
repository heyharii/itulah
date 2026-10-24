# Review POS × Marketing × Store edge × Cloud — 20 Okt 2026

Dogfood di rig demo (cloud :8180, store-01 :8182) + review kode oleh 3 agent (read-only).
POS web dites lewat **ego lite** (`till.localhost:5387/?kasir=2`, Dian · Kasir 2), hub lewat `hub.localhost:5350` (rina).

**Tanda bukti:** 🟢 = dibuktikan live di rig/ego lite · 🔵 = terkonfirmasi dengan membaca kode dua sisi (tidak dijalankan, mis. tablet/Tauri, atau akan memblokir sync rig).

**Jawaban singkat:** belum. Promo otomatis dasar (persen, potongan nominal, harga tetap, buy X get Y; scope artikel/divisi/tag/seluruh keranjang; minimum item/nilai; markdown; jadwal; toko campaign; pause/resume) **jalan** di POS web. Tapi banyak opsi marketing di hub yang mati atau salah di till, uang retur/void tidak sampai ke HO, dan beberapa kesalahan kecil kasir (salah ketik kupon/kode voucher) bisa membuat penjualan hilang atau memblokir sync satu toko.

Cakupan yang **belum** dites live: tablet Android dan desktop Tauri (tidak ada device/build — hanya baca kode), printer struk, customer display, modul cloud di luar POS/marketing (HR, GA, finance non-penjualan).

---

## A. Fitur marketing di POS

### Yang jalan (🟢 live)
| Fitur | Bukti |
|---|---|
| Persen off — scope SKU, artikel, divisi, tag | QA 20% UJ19 99.000→79.200; Celana 25%; Wanita 10%; tag Aksesori 15% |
| Harga tetap + minimum 2 item | 1 item tidak dapat, 2 item → 79.000/pcs |
| Buy 2 get 1 | 3 × 99.000 → 66.000/pcs (diskon disebar, retur 1 unit refund 66.000) |
| Potongan nominal + minimum nilai | 1 kemeja 199.000 tidak dapat; 2 kemeja → −30.000 |
| Members only | tanpa member ditolak; dengan member 10% + poin |
| Markdown: "Not on sale items" vs "Sale items too" | Blus L markdown 129.000 tidak dapat promo; Kaos Basic XL markdown 69.000 + 10% (ALLOW) |
| Jadwal mulai besok, campaign khusus store-02 | ditolak "not started yet" / "does not run at this shop" |
| Kupon biasa (QAKUPON) | −15% hanya dengan kode |
| Kupon terbatas HEMAT50 / sekali pakai QASEKALI | hold online di HO → dipakai → COMMITTED; QASEKALI kedua kali 409 SET_EXHAUSTED; lepas chip kupon → hold RELEASED |
| Voucher gift card (sebagian) | hold 60.000 → sale → COMMITTED, saldo 40.000; via UI 40.000 + tunai |
| Poin member + balik saat void | Budi +14 → void → kembali 33 |
| Tukar poin → voucher → dipakai bayar | kode 734200 → voucher DRJ64S2YXYAP → part payment |
| Budget promo (rem lokal) | budget 30.000: unit ke-2 dipotong sisa 10.200; "Sync usage" tidak menghitung ganda |
| Pause/resume campaign & promo | sampai ke node ±5 detik |
| Publish dari form hub | "QA Hub 30% Tas" sampai node ±8 detik, langsung berlaku |
| Counter pemakaian campaign | QA Dogfood = Rp 256.550 / 7 transaksi (cocok hitungan manual) |

### Yang rusak / kurang (urut dampak)
| # | Masalah | Bukti | Lokasi utama |
|---|---|---|---|
| M1 | **Satu keranjang hanya dapat satu promo.** Form hub selalu menulis `stacking: ALONE`; opsi "Blocks offers on its items" (LINE) tidak berefek karena engine hanya mengajak rule STACKABLE. Keranjang UJ19(20%)+Celana(25%)+Blus(10%)+Sneakers(15%) cuma dapat Celana: Rp 773.750 vs Rp 688.700 kalau 4 struk terpisah. Kasir tidak diberi tahu promo lain hilang. | 🟢 | `rule-form.tsx:639`, `pricing-engine/src/engine.rs:1094-1130, 1813-1845` |
| M2 | **Promo ber-scope SKU melebar ke seluruh artikel** setelah "freeze" eligibility (`qa-sku-20` 2 SKU → 4, `qa-camp-budget-10` 1 → 6). Final price di hub sudah memakai set yang salah; till akan ikut setelah broadcast berikutnya (dipicu `qa-future` mulai **00:00 WIB malam ini**). Set beku juga tidak pernah dikirim ke toko saat publish dan tidak pernah dihitung ulang saat promo diubah. | 🟢 data cloud | `cloud/postgres/eligibility.rs:154-168, 425-442, 199-211`; `commercial.rs:664` |
| M3 | **Campaign status "Scheduled" tidak pernah jalan** — waktu mulai lewat, till tetap "the promotion is not active". Hub menampilkannya sama seperti campaign terjadwal yang benar. | 🟢 | `campaigns.tsx:2364-2377`; `engine.rs:328`; `price.rs:321` |
| M4 | **"Max. per shopper" membuat promo mati di semua till** ("this shop cannot tell how often this shopper has used it"). | 🟢 | `engine.rs:412-424`; `edge/pricing.rs:391-407` |
| M5 | **Salah ketik kupon → semua promo hilang, tombol Pay tetap aktif, uang diterima, lalu node menolak penjualan.** Layar bilang "resent automatically" padahal penolakan permanen; kasir hanya bisa Discard. | 🟢 UI | `edge/pricing.rs:2173-2193`; `till.tsx:1221-1229, 2850-2855` |
| M6 | **Nomor member teks bebas.** Placeholder sendiri "0812 3456 7788" (pakai spasi): sale UI dengan "0813 1111 0002" → 62 poin masuk akun hantu, member asli tetap 33. Teks apa pun ("nobody-999") membuka promo khusus member. | 🟢 | `till.tsx:1390-1401`; `engine.rs:352-359`; `loyalty.rs:51-69` |
| M7 | **Nilai poin hard-coded 1 poin = Rp 1** (20 poin → voucher Rp 20; poin didapat 1 per Rp 10.000 → nilai 0,01%). Tidak ada setting di hub. | 🟢 | `cloud/postgres/loyalty.rs:289-294` |
| M8 | **Poin tidak terlihat**: tidak ada "+N poin" di till (aturan poin tampil "−Rp 0"), struk selalu `points_earned: 0` (node tidak menyimpan member/poin di `sale`). | 🟢 | `till.tsx:409, 1169-1179`; `edge/till.rs:2009` |
| M9 | **Voucher terikat member bisa dipakai siapa saja** (till tidak mengirim customer saat authorize). | 🟢 QARIZKY50 | `cloud/postgres/vouchers.rs:1256-1379` |
| M10 | **Void tidak mengembalikan voucher, kupon terpakai tetap habis, counter/budget promo tidak turun.** Voucher QAGIFT100: 60.000 hilang setelah void. | 🟢 | `cloud/postgres/sync.rs:7639-7686`; schema `voucher_movement.kind` tanpa reversal |
| M11 | **Retur tidak membalik poin** (retur tidak pernah jadi fact uang, lihat C1). Member bisa tukar poin → beli → retur → dapat tunai + poin tetap. | 🟢 | `edge/sqlite.rs:9504-9651` |
| M12 | **Kode voucher dengan tanda "-" (seperti tercetak) memblokir seluruh sync toko** di HO; menghentikan voucher di hub saat sedang di-hold till juga. Tidak ada tombol operator untuk melepas. | 🔵 (tidak dijalankan: akan memblokir rig demo) | `cloud/postgres/vouchers.rs:1622-1629, 1046-1118`; `edge/http.rs:2871` |
| M13 | Tablet Android: tidak ada member, kupon, kupon terbatas, voucher (tile selalu ditolak), poin, kantong. | 🔵 | `TillViewModel.kt:481/544/581`; `TenderScreen.kt:125-127` |
| M14 | Coupon sets (kode unik/massal) tidak bisa dipakai di till mana pun; tidak ada UI hub. | 🔵 | `edge/pricing.rs:2173-2193` |
| M15 | Markdown dari sheet harga berakhir sehari lebih awal; markdown tanpa tanggal akhir tidak bisa diakhiri. | 🔵 | `change-price-sheet.tsx:79-81, 553, 566` |
| M16 | Priority hanya pemecah seri (10% prio 10 kalah dari 15% prio 0), tidak sesuai teks hub. | 🟢 | `engine.rs:142-150` |
| M17 | Keranjang yang dipromo jadi Rp 0 (100% / harga 0) tidak bisa dijual. | 🔵 | `tender.rs:202-204, 319-321` |
| M18 | Pajak di till hanya dari price book terbaru — sekarang store-01 tidak punya tax rule (laten selama tarif 0%). | 🔵 + data | `edge/pricing.rs:2737-2762` |
| M19 | Hari/jam (weekday, happy hour) didukung engine tapi tidak bisa diatur di form promo. | 🔵 | `rule-form.tsx` (days/time_window selalu kosong) |
| M20 | Kosmetik hub: kolom "Ends" bilang "No end" padahal campaign berakhir; potongan nominal ber-scope SKU tertulis "off the basket"; promo khusus store-02 tampil "3 / 3" toko; "Add the extra" (poin) terdengar menjumlah padahal "di atas tarif harian". | 🟢 | `promotions.tsx`, `shared.ts` |

---

## B. Fitur POS

### Yang jalan di POS web (🟢 ego lite)
Masuk (sidik jari simulasi) · scan tag · hapus baris dengan persetujuan kepala toko · kantong · tunai dengan kembalian · debit (penjaga nomor kartu) · QRIS · voucher sebagian · kupon terbatas (hold & release) · Redeem points · retur (pakai sale ID) · Sale complete.

### Yang rusak
| # | Masalah | Bukti | Lokasi |
|---|---|---|---|
| P1 | **Till desktop (Tauri) tidak bisa buka shift**: ID terminal "POS-01" / label "Kasir 2", sedangkan kursi node "KASIR-2" → ShiftGate "not set up as a kasir yet". Layar Setelan tidak bisa dibuka. | 🔵 | `src-tauri/src/edge.rs:158`; `join.rs:369`; `screens/shift.tsx:556-566` |
| P2 | **Pay tetap aktif saat quote gagal** (kupon salah, unit gudang/terjual, tanpa harga, hold kedaluwarsa) → uang diterima, node menolak, keranjang dibersihkan, pesan "resent automatically" keliru. | 🟢 | `till.tsx:715-721, 1221-1229, 2842-2855` |
| P3 | **Till hanya memuat 100 SKU pertama** dari katalog (tanpa paging). Dengan ±12 ribu artikel klien, sebagian besar barang tampil "Not in the price book"; rig demo (95 SKU) menutupi bug ini. | 🔵 | `pos-desktop/ui/src/api.ts:213-222`; `edge/pricing.rs:1016` |
| P4 | **Retur/void tidak bisa dari struk kertas**: layar minta sale UUID, menolak nomor struk; struk hanya mencetak nomor struk; tidak ada daftar penjualan untuk kasir. Tablet hanya bisa transaksi terakhir. | 🟢 | `screens/returns.tsx:111, 726-732`; `escpos.rs:290` |
| P5 | Penjualan antre (offline) dicatat atas nama/laci siapa pun yang login saat terkirim; "Finish shift" dari menu melewati penjaga penjualan belum terkirim. | 🔵 | `edge/http.rs:2367`; `sqlite.rs:7785, 7956`; `shift.tsx:652-670` |
| P6 | Saldo karyawan bisa hilang (sale ditolak/Discard/gagal dikembalikan); aturan "tidak dengan promo" hanya dicek till. | 🔵 | `till.tsx:2189-2302`; `cloud/postgres/benefit.rs:508-522` |
| P7 | Web tidak bisa cetak struk / buka laci (setelan printer tak terjangkau); desktop tidak mencetak penjualan antre. | 🔵 | `web.ts:69-117`; `till.tsx:2794-2829` |
| P8 | Struk tidak memuat kantong → Total/Bayar/Kembali tidak klop (sale `2d01c230…`: 444.750 / 450.000 / 4.750). | 🟢 | `edge/till.rs:1891-2012` |
| P9 | Esc/× di dialog bayar membuang tender yang sudah diambil (termasuk kartu yang sudah digesek). | 🔵 | `till.tsx:2223-2236, 2464-2472` |
| P10 | Node set ke FINGERPRINT mengunci till desktop (scanner masih stub, form password hilang). | 🔵 | `src-tauri/src/device.rs:84-86`; `login.tsx:142-213` |
| P11 | Tablet: setor/ambil kas tandanya terbalik (setor 1 jt → selisih 2 jt), shift tidak kenal kursi, kunci idempotensi baru tiap tekan Pay, tanpa persetujuan supervisor untuk hapus/batal. | 🔵 | `ShiftScreen.kt:171`; `TillViewModel.kt:539, 609-622` |
| P12 | Kecil: rincian "Hand back" kehilangan Rp 50 (kembalian 4.750 ditulis 2×2.000+500+200); overlay menampilkan UUID bukan nomor struk; teks Indonesia tersisa ("2 · Konfirmasi", "Permintaan ditemukan", "Nilai voucher"); waktu retur tampil ISO mentah; konfirmasi Discard pakai `window.confirm`. | 🟢 | `till.tsx:208-223, 2856`; `screens/redeem.tsx`; `returns.tsx` |

---

## C. Store edge → Cloud (uang, laporan, sync)

| # | Masalah | Bukti | Lokasi |
|---|---|---|---|
| C1 | **Retur toko tidak pernah sampai ke HO sebagai uang** — hanya pergerakan stok. Ledger, laporan, Sales Explorer, poin, saldo karyawan, PPN mengabaikan refund. Rig: 4 retur di node (termasuk 304.200 tunai), 0 di `sale_return` cloud; hari 20 Okt store-01 sudah di-POSTED dengan retur 0. | 🟢 | `edge/sqlite.rs:9504-9660`; `cloud/postgres/sales_posting.rs:21-24` |
| C2 | **Void hanya mengubah status + poin**: voucher/kupon/saldo karyawan tidak kembali, refund tidak dipecah per tender, tidak terikat laci; retur lalu void dihitung dobel di laporan Z. | 🟢 | `cloud/postgres/sync.rs:7639-7686`; `edge/sqlite.rs:9368-9500`; `edge/till.rs:1233-1295` |
| C3 | **Laporan penjualan HO ikut menghitung penjualan yang di-void** dan memakai jam, bukan business date: store-01 20 Okt 1.916.200/10 vs yang benar 1.199.350/6. | 🟢 | `cloud/postgres/reports.rs:61-63, 246-249, 389-391` |
| C4 | **Persamaan laci di HO salah untuk setiap shift** (tidak mengurangi kembalian, ikut void, tanpa refund): shift `4b9d521e` HO 1.240.000 vs toko 1.184.000; `a20f8ba9` 1.272.650 vs 592.900. | 🟢 | `cloud/postgres/store_money.rs:435-518` |
| C5 | Biaya kantong tercatat sebagai penjualan barang (tanpa detail charge, PPN-nya hilang): `edge_sale.charge_total_minor` NULL, `edge_sale_charge` kosong. | 🟢 | `sync.rs:7280-7290`; fact `sqlite.rs:8164` |
| C6 | Satu masalah voucher memblokir seluruh stream toko; tidak ada cara operator melepas (lihat M12). | 🔵 | `sync.rs:2454-2459, 2356` |
| C7 | Tender saldo karyawan tidak terikat ke spend di HO (referensi apa pun lolos). | 🔵 | `tender.rs:246-259` |
| C8 | Kode voucher (nilai bearer) tersimpan polos sebagai referensi tender dan tampil di laporan. | 🟢 | `edge_sale_tender.reference` |
| C9 | Fakta petty-cash/expense tidak diterapkan dan terhapus setelah 14 hari. | 🔵 | `sync.rs:2733, 5717-5729` |
| C10 | Void tidak diikat ke toko asalnya; void tanpa sale hilang diam-diam. Waktu sale = waktu tiba di node, bukan waktu dibayar. Kartu di toko dengan >1 bank EDC bisa masuk bank yang salah. | 🔵 | `sync.rs:7639`; `sqlite.rs:7785`; `sales_posting.rs:898-925` |

**Kesehatan sync sekarang:** sehat — tidak ada stream terblokir, dead letter, atau integrity alert. Masalahnya ada di isi uangnya, bukan pengirimannya.

---

## D. Data test yang dibuat di rig demo
- store-01: 53 pcs dipindah gudang → floor (2 tas hitam sengaja tetap di gudang); kursi **Kasir 2** ditambah (`till_count` 2); shift Dian terbuka di Kasir 2 (modal 500.000).
- Price book v29–v34: campaign **QA Dogfood Oktober** (store-01, 10 hari), **QA Budget Kecil**, **QA Store 02 Only**, 18 rule `qa-*`, 2 markdown (Kaos Basic XL 69.000, Blus L 129.000), promo hub **"QA Hub 30% Tas" (tanpa campaign → berlaku di SEMUA toko)**, campaign `qa-scheduled` (sudah CANCELLED).
- Voucher: QAGIFT100 (habis), QARIZKY75, QARIZKY50, QACANCEL30 (dihentikan), DRJ64S2YXYAP (hasil tukar poin, habis).
- ±12 penjualan (4 di-void, 4 retur), akun poin hantu "0813 1111 0002" (62 poin), member Budi poin 13.
- **Peringatan 00:00 WIB:** saat `qa-future` mulai, broadcast eligibility akan mengirim set SKU yang melebar (M2) ke toko — harga QA di till akan berubah. Akhiri campaign QA sebelum itu kalau tidak mau efek ini.

---

## E. Urutan perbaikan yang disarankan
1. **Hentikan kebocoran uang di kasir**: kunci Pay saat quote bermasalah + penanganan sale ditolak (P2/M5); retur jadi fact uang ke HO (C1/M11); void mengembalikan voucher/kupon/saldo + refund per tender (C2/M10); normalisasi kode voucher + jangan blokir stream (M12/C6); filter COMPLETED di laporan + persamaan laci (C3/C4).
2. **Kebenaran promo**: scope SKU & broadcast eligibility (M2), campaign Scheduled (M3), per-shopper (M4), validasi nomor member (M6), tampilkan poin (M8), voucher terikat member (M9).
3. **Kelengkapan POS**: ID kursi desktop (P1), paging katalog (P3), retur dari nomor struk (P4), cetak struk web (P7), struk dengan kantong (P8), parity tablet (P11/M13).

**Keputusan owner yang dibutuhkan:**
- Boleh promo berbeda pada barang berbeda digabung dalam satu keranjang? (sekarang: hanya satu promo per keranjang).
- Nilai 1 poin = Rp berapa, minimum penukaran?
- Void/retur promo: kembalikan kuota kupon & budget?
- Barang yang dibayar voucher/saldo karyawan: refund ke voucher/saldo saja, atau boleh tunai?
- Pembulatan tunai untuk total berakhiran Rp 50 (kembalian yang tak bisa diberikan)?

Laporan rinci per agent (file:line lengkap, test API yang disarankan) dan screenshot ego lite ada di [`review-2026-10-20/`](review-2026-10-20/): `review-marketing-pos.md`, `review-pos-features.md`, `review-sale-sync.md`, `till-satu-promo-per-keranjang.png`, `till-kupon-salah-sale-ditolak.png`, `till-20-poin-rp20.png`.
