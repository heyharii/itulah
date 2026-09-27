# Finance API Test Brief — perbaiki semua, lalu buktikan lewat API integration test

**Tanggal:** 25 Sep 2026 · **Pemilik:** Hari · **Jangan berhenti sampai semua uji hijau** (kecuali kasus §0.7).
**Acuan keputusan:** `FINANCE-CONNECT-BRIEF.md` (seluruh isi, termasuk bagian tambahan 1–13 di akhir — yang
lebih akhir menang bila bertentangan) dan halaman "Peta Akun Finance" (artifact) yang merangkumnya.

## 0. Aturan kerja

1. Working tree berisi banyak pekerjaan pemilik yang belum di-commit (termasuk migrasi 0299–0376). Jangan
   revert/format ulang file yang tidak kamu sentuh. Commit hanya file yang kamu ubah (`git add <path>`), satu
   commit per fase/tahap, **tanpa push**, pesan diakhiri `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
   Commit pertama: checkpoint migrasi 0371–0376 + perubahan kode Finance yang sudah ada (pemilik setuju).
2. Mungkin ada agen GA paralel (`runs/ga-build/`). Jangan sentuh file GA. Cek nomor migrasi terakhir tepat sebelum
   membuat migrasi dan lagi sebelum commit.
3. Bagan = 267 akun klien (0348). **Tidak ada akun baru.** Tidak ada referensi ke 43 akun lama.
4. Disk: build dengan `CARGO_INCREMENTAL=0`. Kalau ruang kosong < 15 GB, jalankan `cargo clean` dulu.
5. DB dev: `postgres://inventory:inventory@localhost:5432/inventory_marketing_dogfood` (untuk `sqlx` saat build
   dan migrasi dev). Uji memakai `#[sqlx::test(migrations = "./migrations/postgres")]` (DB sekali pakai).
6. Hemat token: jangan memunculkan sub-agent; baca file per rentang; jalankan uji per file (`cargo test --test <nama>`).
7. Berhenti dan tanya hanya bila (a) ada keputusan pemilik yang belum ada di brief, atau (b) perbaikan menuntut
   akun baru. Catat di `runs/finance-api-tests/2026-09-25/OPEN-DECISIONS.md` lalu **lanjutkan skenario lain**.
8. **Jangan menyesuaikan uji dengan perilaku yang salah.** Kalau uji gagal, perbaiki kode/migrasi. `#[ignore]`
   dilarang, kecuali untuk skenario di OPEN-DECISIONS (sebutkan di REPORT).

## 1. Fase A — perbaiki semua sampai sesuai keputusan

Terapkan seluruh `FINANCE-CONNECT-BRIEF.md` yang belum terpasang. Ringkasan yang wajib (detail di brief):

- **Migrasi 0376** (aturan keras): terapkan, tetapi sesuaikan dengan koreksi pemilik — rekening bank per unit
  TETAP boleh (jangan tolak akun bank di site unit); hutang ke pihak luar (2002, 2004, giro, pinjaman) hanya
  di buku HO; Modal Kasir tidak untuk biaya; biaya bank & bunga bank dua kejadian.
- **Hapus** peta `cash_in_transit`. **2003, 4009, 4010, 1110, 2032** tidak dipakai. **6002** hanya manual.
- **PPN diabaikan:** setting `vat_enabled = false`; SALE_DAY tanpa `vat_out`, faktur tanpa `vat_in`.
- **PPh manual semua** kecuali PPh 21 payroll. PPh 21 **ditanggung perusahaan**: akrual Dr biaya gaji
  (6012/6026) / Cr 2011 (peta dapat dipindah ke 1045 bila akuntan memilih). Neto karyawan tidak dipotong PPh 21.
- **Payroll kredit per komponen:** gaji/lembur/makan/transport → 2017; THR (akrual 1/12 bulanan)/bonus/insentif/
  pesangon → 2018; medis → 2020; BPJS → `bpjs_payable` (peta 2021, TO_CONFIRM). Pembayaran mendebit hutang
  komponennya. Toko: dibayar dari 1003 Petty Cash; HO/DC: dari bank.
- **Afiliasi:** setiap lintas HO↔unit lewat Pembiayaan (1057/2028) / Atas Barang (1058/2029) / Lain-lain (1059
  dua arah); unit↔unit lewat HO; tiap site seimbang di bukunya. Dana HO→unit: HO Dr 1057 / Cr bank; unit
  Dr 1003 / Cr 2028 (dua dokumen: kirim & terima). Rekening site lain dipakai membayar → pemilik kewajiban
  mencatat hutang, pemilik rekening mencatat uang keluar, afiliasi di antaranya.
- **Pihak luar hanya HO:** penerimaan supplier langsung di toko → toko Dr 1029 / Cr 2029; HO Dr 1058 / Cr 2002.
  Tagihan milik toko (mis. listrik) → toko Dr biaya / Cr 2028; HO Dr 1057 / Cr 2004; HO bayar Dr 2004 / Cr bank.
- **Kas:** 1002 hasil penjualan; keluar hanya ke HO / kewajiban HO lewat afiliasi pembiayaan. 1004 hanya lewat
  kejadian shift/float yang disahkan.
- **Sales/POS:** QRIS = akun debit bank EDC + penanda tender; MDR dari tabel tarif (6005, di buku unit);
  voucher gratis & poin = 4012; kantong belanja Rp1.000 hangus (Cr penjualan, Dr 4012, Dr 6004 / Cr 1030 —
  **sambungkan ke SALE_DAY**, kuncinya belum dipakai); return tanpa uang keluar, selisih lebih murah → 8008;
  pembulatan 8003; kas kurang 1023 (sementara), lebih 8008; tender online ditolak jelas.
- **Inventory:** nilai per unit RFID (provenance); stok minus tidak menggagalkan hari (biaya menunggu);
  SJD: HO Dr 1031 / Cr 1029, unit Dr 1031 / Cr 2029; terima di unit: HO Dr 1058 / Cr 1031, unit Dr 1029 / Cr 1031;
  opname & hilang 8007; **barang hancur Dr 6011 / Cr 1029** (dicatat tim Inventory); tidak laku jual = stok retur
  (tanpa biaya); retur ke supplier via credit note Dr 2002 / Cr 1029 (**sambungkan** `stock_ledger_return_to_supplier`);
  selisih harga faktur → `cost_layer_correct_price` (**sambungkan**; terjual → 5002).
- **Procurement:** faktur mencocokkan hutang 2002 dari penerimaan (+ penyesuaian selisih); uang muka 1052/1053
  manual; PPh 23/4(2) manual di pembayaran; giro 2005–2009; rabat 8004.
- **GA:** perbaikan per objek (6066–6075); prepaid dibagi otomatis; penyusutan/cadangan OE/amortisasi/prepaid
  **otomatis default** (flag bisa mematikan); pre-opening default 12 bulan; CIP; pelepasan 8008; sewa kendaraan
  6064; jaminan sewa 1054; leasing 2031/8012; software baru 6050; pendapatan sewa 8005/8006 = Dr piutang/kas /
  Cr pendapatan.
- **Akrual otomatis (terkunci):** templat tagihan rutin → akhir bulan Dr biaya / Cr 2022–2026 bila tagihan
  belum di-post, dibalik saat tagihan asli di-post; bunga dari jadwal pinjaman → Dr 8011/8012 / Cr 2019.
  **Buat penulisnya.** Reklasifikasi pinjaman jatuh tempo < 1 th (2043–2048 → 2035–2040): **buat penulisnya**.
- **Management fee:** HO Dr 1059 / Cr 4016; unit Dr 7032 / Cr 1059 — **buat penulisnya** (dokumen HO).
- **Tutup buku:** tidak ada posting laba ditahan bulanan; 3003 menunggu keputusan akhir tahun.
- **Hak akses:** hanya Finance HO membuat jurnal manual/reversal/dokumen kas; peran toko ditolak.

## 2. Fase B — API integration test (lewat HTTP, bukan fungsi DB langsung)

Buat `backend/tests/finance_api_integration.rs` (boleh dipecah per domain `finance_api_<domain>.rs`) yang
membangun router aplikasi dengan cara yang sama seperti `tests/api_flow_integration.rs`, memakai migrasi asli
(**tanpa peta fixture** — peta adalah hasil kerja), login/peran sesuai (HR toko, kepala toko, Finance HO,
Inventory, GA), memanggil **endpoint domain yang sebenarnya**, lalu membaca buku lewat **endpoint Finance**
(jurnal / buku besar / neraca saldo per site) dan memeriksa baris Dr/Cr **per kode akun klien, site, dan
counter-site**, plus item payment ledger bila ada.

Setiap skenario wajib memeriksa: (1) jurnal seimbang; (2) **tiap site seimbang di bukunya sendiri**;
(3) afiliasi netto nol se-perusahaan; (4) tidak ada baris di akun "tidak dipakai"; (5) akun yang tepat.

### Skenario wajib (satu `#[sqlx::test]` per baris; nama uji = nama skenario)

**Sales/POS**
1. Hari penjualan campuran di toko: tunai, debit BCA, kredit VISA, QRIS lewat EDC BNI, diskon, voucher gratis,
   2 kantong belanja, pembulatan → satu SALE_DAY: 1002 / 1021(BCA) / 1020(VISA) / 1021(BNI, tender QRIS) Dr;
   4002/4003/4007/4006 Cr; 4012 Dr (diskon+voucher+kantong); 6004 Dr / 1030 Cr (biaya kantong); 8003;
   5002 Dr / 1029 Cr (HPP per unit); **tidak ada 2013 (PPN diabaikan)**.
2. QRIS tanpa bank & tender online → baris ditahan di antrean pengecualian, sisa hari tetap terposting.
3. Return ganti barang lebih murah: 4013 Dr, penjualan pengganti Cr, selisih → 8008 Cr; HPP dibalik untuk unit
   yang kembali dengan biaya unit itu; **tidak ada kas keluar**.
4. Settlement kartu BCA masuk rekening HO dengan tarif MDR default: unit Dr 1057 + Dr 6005 / Cr 1021; HO
   Dr bank / Cr 2028; selisih di atas toleransi → varian, bukan diposting diam-diam.
5. Setor kas penjualan ke rekening HO: unit Dr 1057 / Cr 1002; HO Dr bank / Cr 2028.
6. Tutup shift: kas kurang → Dr 1023; kas lebih → Cr 8008; modal kasir 1004 tidak bisa dipakai membayar biaya (ditolak).

**Inventory**
7. Terima barang di DC setelah verifikasi floor → HO Dr 1029 / Cr 2002; cost layer per unit terbentuk.
8. Supplier kirim langsung ke toko → toko Dr 1029 / Cr 2029; HO Dr 1058 / Cr 2002; tidak ada 2002 di buku toko.
9. SJD DC → toko lalu diterima → empat setengah-jurnal sesuai aturan akuntan; unit→unit lewat HO.
10. Opname kurang/lebih → 8007; barang hancur → 6011 / 1029; barang tidak laku jual → tanpa jurnal biaya.
11. Retur ke supplier via credit note → Dr 2002 / Cr 1029 sebesar biaya unit.
12. Faktur dengan harga beda PO: unit belum terjual → biaya unit dikoreksi; sudah terjual → selisih 5002.
13. Penjualan saat layer habis → hari tetap terposting, ditandai biaya menunggu, diluruskan saat layer masuk.

**Procurement**
14. Faktur barang dagangan mencocokkan hutang penerimaan (tidak membuat hutang kedua).
15. Uang muka supplier (manual) lalu alokasi ke faktur → 1052 terpakai habis.
16. Bayar tagihan jasa dengan PPh 23 manual → Dr 2004 / Cr bank + Cr 2012; **tidak ada PPh otomatis** tanpa input.
17. Bayar dengan giro: terbit Cr 2005 (BCA) → cair dari mutasi Dr 2005 / Cr bank; ditolak → dibalik.
18. HO bayar supplier HO dari rekening bank unit → HO Dr 2002 / Cr 2028; unit Dr 1057 / Cr bank unit.

**GA**
19. Tagihan listrik milik toko → toko Dr 6045 / Cr 2028; HO Dr 1057 / Cr 2004; HO bayar Dr 2004 / Cr bank.
20. Tagihan perbaikan AC di toko → akun dari objek (6072) di buku toko, hutang di HO.
21. Sewa toko dibayar di muka 12 bulan → 1038; agen bulanan → 7004 1/12; berjalan otomatis default.
22. Beli aset di atas batas kapitalisasi → kelas aset; di bawah batas → biaya objek; penyusutan bulanan otomatis.
23. CIP renovasi → dipindah ke kelas aset saat selesai; pelepasan aset → laba/rugi 8008.
24. Pre-opening → amortisasi 12 bulan otomatis.
25. Pendapatan sewa gedung → Dr piutang/kas / Cr 8005.

**HR**
26. Payroll 3 karyawan (2 toko, 1 HO) dengan gaji, lembur, makan, transport, bonus KPI, komponen medis, BPJS,
    THR bulanan, PPh 21 ditanggung → kredit per komponen (2017/2018/2020/2021/2011), beban per jenis site;
    neto tidak dipotong PPh 21.
27. HO kirim dana gaji ke toko (dua dokumen) → HO Dr 1057 / Cr bank; toko Dr 1003 / Cr 2028; toko bayar tgl 1
    Dr 2017 / Cr 1003; setelah semua dibayar 2017/2018/2020/2021 = 0.
28. Klaim medis → 6016 / 2020; klaim dinas → 6047 / 2031; uang muka dinas 1051 dipertanggungjawabkan.
29. Pinjaman karyawan dipotong payroll → Cr 1022; pesangon via full & final → 6023/6037 / 2018.

**Finance native**
30. Biaya admin bank dan bunga bank dari mutasi → dua jurnal terpisah (6043 / bank; bank / 8002).
31. Akrual otomatis: templat listrik tanpa tagihan di akhir bulan → Dr 6045 / Cr 2023; tagihan asli masuk →
    akrual dibalik, selisih ke biaya.
32. Pinjaman bank: angsuran (pokok + bunga), akrual bunga bulanan → 2019, reklasifikasi jatuh tempo → 2035–2040.
33. Management fee HO ke unit → HO Dr 1059 / Cr 4016; unit Dr 7032 / Cr 1059.
34. Tutup buku bulan → tidak ada jurnal ke 3003.

**Aturan & hak akses (negatif)**
35. Peran toko membuat jurnal manual / reversal → 403.
36. Posting yang membuka 2002/2004/giro/pinjaman di site toko → ditolak dengan pesan jelas.
37. Posting lintas site tanpa kaki afiliasi → ditolak.
38. Posting ke akun tidak dipakai (2003, 4009, 4010, 1110, 2032) → ditolak.
39. Jurnal manual ke 6002 oleh Finance HO → diterima; lewat jalur otomatis → tidak pernah.

### Uji cakupan akun
40. `every_client_leaf_has_its_route`: untuk setiap leaf aktif, cocokkan dengan kelas di Peta Akun —
    Otomatis/Terjadwal → minimal satu skenario di atas memposting ke akun itu (kumpulkan dari jurnal hasil uji);
    Manual → hanya bisa lewat jurnal manual Finance HO; Tidak dipakai → tidak ada peta & posting ditolak.
    Tulis tabelnya ke `runs/finance-api-tests/2026-09-25/COVERAGE.md`.

## 3. Loop

Ulangi: jalankan semua uji finance (`cargo test --test finance_api_integration` dan uji finance yang sudah ada:
`finance_connect_integration`, `finance_hard_rules`, `inventory_finance_wiring`, `payroll_components_integration`,
`ga_finance_handoff_integration`, `pos_integration`, `sales_money_sync_integration`, `posting_policy_coverage`)
→ perbaiki kode/migrasi → jalankan lagi, **sampai semuanya hijau**. Uji lama yang gagal karena masih memakai
43 akun lama atau keputusan lama: perbarui ke keputusan sekarang (catat di REPORT uji mana dan kenapa).

## 4. Laporan

`runs/finance-api-tests/2026-09-25/REPORT.md`: tabel skenario → status (hijau / OPEN-DECISIONS), daftar perbaikan
kode per skenario, uji lama yang diperbarui, COVERAGE.md, commit yang dibuat, dan hal yang sengaja ditunda.
Tulis satu baris progres di REPORT setiap fase/tahap selesai.
