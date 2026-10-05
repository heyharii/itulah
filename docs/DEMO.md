# Demo — alamat, akun, dan cara reset

Demo berjalan di laptop ini (Cloud lokal, bukan Google Cloud) dalam **mode wajib
login**. Semua akun memakai password **`Password01`**. IP laptop saat ini
`192.168.1.224` — kalau WiFi berganti, lihat IP terbaru dengan
`scripts/demo-services.sh status`.

## Aplikasi

| Aplikasi | Alamat | Terhubung ke |
|---|---|---|
| Hub (kantor pusat) | http://localhost:5350 | Cloud :8180 + DC edge :8181 |
| Gudang DC | Hub → Operations (`/operations/*`, login DC) — Floor app `frontend-floor` sudah dipensiunkan 2026-09-26 | DC edge :8181 |
| Store app (back office toko) | http://192.168.1.224:5353 | Store edge :8182 (store-01) |
| Customer app (member) | http://192.168.1.224:5352 | Cloud :8180 |
| Kasir Windows (pos-desktop) | alamat node `http://192.168.1.224:8182`, terminal `POS-01` | Store edge :8182 |
| Handheld C5 | app **Central DC** / **Central Store** (sudah terisi) | DC :8181 / Store :8182 |

## Akun (password semua `Password01`)

| Login | Nama | Peran | Masuk di |
|---|---|---|---|
| `rina` | Rina Kusuma | HR manager / Finance HO (ADMIN) | Hub (Cloud); juga layar Operations di Hub (login DC) |
| `admin` | bootstrap admin | ADMIN — tanda tangan kedua Finance | Hub (Cloud) |
| `yusuf` | Yusuf Ramadhan | Kepala gudang DC (verifier) | Hub → Operations (login DC) |
| `nina` | Nina Oktaviani | Staf gudang DC (checker) | Hub → Operations (login DC), handheld Central DC |
| `maya` | Maya Anggraini | Kepala toko store-01 (SUPERVISOR) | Store app, kasir (approval supervisor) |
| `dian` | Dian Pertiwi | Admin toko / kasir (CASHIER) | Kasir POS-01, store app, handheld Central Store |

**Customer app:** member masuk dengan nomor kartu (= nomor HP) + kode 6 digit
yang berlaku 10 menit. Buat kode baru kapan saja:

```bash
scripts/demo-member-code.sh 081311110001
```

Member: Sari Wulandari `081311110001` (punya poin & riwayat belanja), Budi
Santoso `081311110002`, Ayu Lestari `081311110003`, Rizky Pratama `081311110004`.

**Kasir Windows:** masuk sebagai `dian`; shift POS-01 sudah terbuka dengan modal
Rp 500.000. Approval supervisor (void, retur): `maya`. Untuk kartu kredit pakai
jaringan VISA/Mastercard, jangan "Kredit <bank>" (belum dipetakan di Finance).

## Isi data demo (konsisten ke Finance)

- **Barang:** PO-DEMO-001 (PT Garmen Nusantara) & PO-DEMO-002 (CV Sepatu
  Sejahtera) → diterima, dihitung Nina, diverifikasi Yusuf, ditagih → 10
  artikel / 56 SKU → 60 unit ber-EPC. 32 unit dikirim ke store-01 (KOLI-1/2,
  SJ-1, truk DSP-1), sisanya di DC; ALT-2 sengaja setengah jalan.
- **Marketing:** 2 campaign (Pekan Sepatu, Gajian Hemat), promo 15% sepatu, 10%
  wanita, kupon HEMAT50, markdown Sandal Slide Karet, 3 voucher, 4 member, poin.
- **Penjualan:** 9 transaksi di POS-01 (tunai, debit, kredit, member, kupon,
  voucher, promo), shift ditutup tanpa selisih, hari penjualan diposting,
  settlement kartu BCA.
- **Finance:** hutang supplier, pembayaran (transfer + giro), uang muka, kas
  kecil store-01, rekening koran Giro BCA direkonsiliasi, jurnal manual,
  akrual, prabayar, pinjaman BCA, management fee, PPh 23.
- **GA/aset:** 13 aset (9 lewat tagihan, 4 aset lama), penyusutan Sep, 1
  write-off laptop, kontrak, perawatan, repair, supplies, surat, dokumen.
- **HR:** absensi 10 hari, cuti, lembur, klaim, rekrutmen, training, payroll
  Sep store-01 & HO (maker ≠ checker), slip gaji, handover & bayar ke Finance.

## Dogfooding oleh agent lain

Tempel instruksi di bawah ke agent, lalu ganti `<BAGIAN>` dengan salah satu
pembagian di tabel.

| Bagian | Aplikasi & halaman | Login |
|---|---|---|
| Finance | Hub `/finance/*`, `/executive/finance` | `rina` (tanda tangan kedua: `admin`) |
| HR & Profil | Hub `/people/*`, `/me/*`, `/executive/people` | `rina` |
| GA & Sistem | Hub `/assets/*`, `/maintenance/*`, `/contracts/*`, `/supplies`, `/vendors`, `/letters`, `/library`, `/system/*` | `rina` |
| Merchandise & Buying | Hub `/procurement/*`, `/master/*`, `/inventory/*`, `/allotment`, `/operations/*` | `rina` |
| Marketing & Selling | Hub `/commercial/*`, `/members/*`, `/sales/*`, `/executive/*` | `rina` |
| Gudang DC | Hub `/operations/*` (login DC) | `nina` (checker), `yusuf` (verifier) |
| Toko | Store app (semua layar) | `maya` (supervisor), `dian` (admin/kasir) |
| Member | Customer app | kartu + kode dari `scripts/demo-member-code.sh` |

```text
Kamu melakukan dogfooding demo aplikasi itulah: pakai aplikasinya seperti
pengguna sungguhan, lalu laporkan apa yang rusak, kosong, membingungkan, atau
angkanya tidak cocok antar halaman. Bagianmu: <BAGIAN>.

Baca dulu /Users/hari/Documents/itulah/docs/DEMO.md (alamat aplikasi, akun,
isi data). Semua password: Password01.

Cara pakai browser: gunakan CLI `agent-browser` dengan sesi sendiri
(`--session dog-<namamu>`): open <url>, wait 3000, get text body, snapshot,
click <selector|@ref>, keyboard type <teks>, press Enter, console. Di browser
headless ini `fill` tidak masuk ke form React; kalau form login tidak mau
submit, login dari dalam halaman:
  agent-browser --session S eval "fetch('/api/v1/auth/login',{method:'POST',
  credentials:'include',headers:{'content-type':'application/json'},
  body:JSON.stringify({username:'rina',password:'Password01'})}).then(r=>r.status)"
lalu buka ulang halamannya.

Yang boleh: membuka semua halaman di bagianmu, membuka detail, memakai fitur
seperti pengguna (membuat/menyetujui dokumen) sebagai orang yang memang
berwenang. Catat setiap aksi yang mengubah data (apa, sebagai siapa, jam).

Yang TIDAK boleh: reset demo (`rig.sh reset/down/new`), restart service,
menyentuh database langsung, mengedit file di repo, atau login sebagai orang
yang tidak berwenang untuk aksi itu. Penjualan kasir yang diketik hari ini
tidak masuk ke hari penjualan yang sudah diposting — itu wajar, bukan bug.

Laporan (ringkas):
1. Tabel: halaman → ✅ ada data / ⚪ kosong wajar (kutip teksnya) /
   ❌ rusak (pesan error persis, endpoint + status dari console/network).
2. Angka yang dicek silang antar halaman dan apakah cocok.
3. Daftar aksi yang kamu lakukan (kalau ada).
4. Masalah nyata, urut dari yang paling mengganggu demo.
```

## Reset (hanya oleh pemilik demo, bukan agent penguji)

```bash
scripts/rig.sh reset demo
```

±1,5 menit: hapus semua data → setup → semua stage (goods, outbound,
commercial, sales, ga, people, finance) → daftar ulang C5. Setelah itu cek:

```bash
python3 scripts/demo-financecheck.py --db sim_rig_demo
```

```bash
python3 scripts/demo-pagecheck.py --user rina
```

Catatan untuk penguji: penjualan yang diketik live hari ini **tidak** masuk ke
hari penjualan yang sudah diposting — `demo-financecheck` akan melaporkan
"till ≠ posted" sampai demo di-reset. Itu wajar.
