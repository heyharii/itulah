# Celah store, terminal, kasir & akun — audit 24 Okt 2026

Empat audit baca-kode (tidak ada build/test). Bukti `file:line` dari `backend/`, `frontend-hub/`, `frontend-store-new/`, `pos-desktop/`. Ukuran: S kecil, M sedang, L besar.

## Prioritas lintas area (kerjakan dulu)

| # | Celah | Area | Ukuran |
|---|---|---|---|
| 1 | Karyawan keluar lewat **People › Changes** (Separation) tetap bisa login di HO, di semua toko, dan **jualan pakai sidik jari** — `close_login` dan penutupan posting hanya ada di jalur TERMINATE langsung (`cloud/http/people.rs:1018-1033` vs `cloud/http/employment.rs:917-924`; reconcile `0635:76-95` tidak melihat status kerja) | akun + kasir | S |
| 2 | Transaksi belum terkirim **hilang** saat HO Stop/Remove till: layar Stopped tidak pernah flush outbox, guard uninstall POS hanya cek `Held` (`pos-desktop/ui/src/app.tsx:144-152`, `till.tsx:1077`, `screens/stopped.tsx:63-73`, `src-tauri/wix/uninstall-guard.wxs`) | terminal | M |
| 3 | Kode install bisa diterbitkan saat server masih **terhubung**; siapa pun yang memakainya diam-diam mengganti mesin yang jalan (`cloud/postgres/stores.rs:1507`, `node_enrolment.rs:184`) | store | S |
| 4 | Admin bisa reset password / membuat **Owner** (tidak ada cek pangkat) (`cloud/postgres/users.rs:1053-1099`, `:890`, `invitations.rs:289-298`); aturan "permissions tetap Admin" bisa ditembus override path pendek (`permissions.rs:69`) | akun | S |
| 5 | Supervisor bisa **menyetujui aksinya sendiri** (void, payout, koreksi); jalur sidik jari supervisor melewati stop HO, lease, lockout; password supervisor bisa ditebak tanpa batas (`edge/till.rs:1084-1097`, `:1709-1727`, `edge/fingerprint.rs:529-571`) | kasir | S |
| 6 | Label till bebas ("Kasir Depan") **mematikan kursinya** — shift & Stop HO hanya kenal "Kasir N"; join tidak membaca jumlah kursi (`edge/devices.rs:495-690`, `:608-623`, `screens/shift.tsx:733-735`, `pos_stop.rs:221-241`) | terminal | S |
| 7 | HO kehilangan **siapa void & alasannya** (hanya status disimpan) (`cloud/postgres/sync.rs:7773-7779`); persetujuan keranjang tidak pernah naik ke HO | kasir | M |
| 8 | **Tidak bisa jualan saat server toko mati** — Bayar hanya buka kalau server menjawab (`pos-desktop/ui/src/till.tsx:1115-1117`) | terminal | L |
| 9 | Tidak ada **2FA** untuk Owner/Admin/IT, padahal hash password mereka ada di setiap PC toko; tidak ada throttle login per klien | akun | L / S–M |
| 10 | **Edit toko** (nama, kota, zona waktu) tidak ada; zona waktu ditebak dari daftar kota → toko WITA/WIT bisa salah hari bisnis (`setup.rs:949`) | store | M |

## Store management

**Fitur kurang**
1. Edit nama/kota/zona waktu toko (M) — hanya open/stop/resume/remove dan till seats (`stores.rs:1340`, `pos_access.rs:222/249/309`, `stores.rs:1432`).
2. Remove store tidak menutup apa-apa (L): stok di toko, kiriman di jalan (`allotments.rs:2438` hanya menolak baris baru), record belum terkirim, dana kas toko (`store_money.rs:3410`), staf & PIC tetap terpasang (`pos_access.rs:279-305`).
3. Toko yang belum pernah buka tidak bisa di-stop/remove (S) (`pos_access.rs:215`, `store-stop.tsx:38-39`).
4. Tidak ada riwayat di halaman toko (M); tab Activity sudah dibuat tapi tidak dipakai (`actions.tsx:356`); log audit hanya path (`http/audit.rs:170`).
5. Readiness gate sebagian kosong (S–M): Payments selalu hijau karena Cash otomatis aktif (`setup.rs:651`); harga, EDC, modal awal, alamat tidak dicek.
6. Stop/Remove toko tidak memberi tahu siapa pun (S) (`stores.rs:1356` hanya Open).

**Bug**
- Test print & aksi per-perangkat tidak terjangkau: `devices-tab.tsx` tidak diimpor (`detail.tsx:103-106`).
- Toko Stopped/Removed menampilkan "Ready to open" (`overview-tab.tsx` ±118).
- Till seats bisa diubah di toko yang sudah Removed (`stores.rs:1406-1430`).
- Open store & ubah kursi tetap dikirim ke server yang sudah Disconnect (`stores.rs` ±1374, ±1452).
- Checklist setup menghitung toko Removed dan server Disconnect (`setup.rs:239-252`).

## Terminal management (till, printer, laci, fingerprint, RFID, EDC)

**Bug**
1. Outbox till terlantar saat Stop/Remove (lihat prioritas #2).
2. Label bebas mematikan kursi; join mengabaikan jumlah kursi (prioritas #6).
3. Tombol Test print hub tidak terjangkau (`devices-tab.tsx:212`).
4. Printer jaringan tidak bisa didaftarkan — `POST /api/v1/devices/printers` tanpa pemanggil (`edge/http.rs:809`).
5. Cek "shift masih terbuka" saat ganti till adalah kode mati (`edge/devices.rs:710-720`, shift kini di `KASIR-n`).
6. Pesan error hub menyuruh "switch device di toko" padahal toko dilarang (`cloud/postgres/devices.rs:616`, `edge/devices.rs:893-906`).
7. Till Removed hanya diblok layar till; sesi login tidak ikut berakhir (`devices.rs` `apply_status`) — belum diverifikasi saat jalan.

**Fitur kurang**
1. Jualan offline saat server toko mati (L).
2. Update software till (M–L) — tidak ada updater Tauri; versi till hanya dicatat saat join (`devices.rs:222,655`).
3. Kesehatan till ke HO (M): backlog belum terkirim, fingerprint reader, printer/laci USB tidak dilaporkan (`sync/device.rs:241-245`, `src-tauri/src/peripherals.rs:164-211`).
4. Ganti PC till rusak (M): outbox di storage browser PC lama tidak bisa diekspor (`outbox.ts`); toko 1 till tidak bisa menyetujui penggantinya (`devices.rs:529-556`, `till-approvals.tsx:209`).
5. Store app hanya menampilkan permintaan join, tidak ada daftar till/printer/status (M).
6. ZKTeco belum pernah diuji di hardware asli.

## Cashier management

**Bug**
1. Separation via People › Changes → kasir tetap aktif di till, sidik jari tetap jalan (prioritas #1).
2. Klaim sidik jari SUPERVISOR melewati stop HO, lease, lockout; password supervisor tanpa batas coba (`fingerprint.rs:529-571`, `http.rs:5713`, `till.rs:1709-1727`).
3. Supervisor menyetujui aksinya sendiri (`till.rs:1084-1097`, `1802`; benefit sudah punya cek di `http.rs:2849`).
4. HO tidak menyimpan pelaku/alasan void (`cloud/postgres/sync.rs:7773-7779`); `till_approval` tidak naik ke HO.
5. "Buka kasir atas nama" hanya baris log (`http.rs:5021`).
6. Grant supervisor tidak terikat ke till/aksi (`fingerprint.rs:744-775`).
7. Resume kasir menghapus siapa/kenapa Stop (`pos_access.rs:410-418`), tidak ada tabel riwayat.
8. Sale diterima tanpa laci terbuka (`till.rs:767-773`) → kasnya di luar variance shift mana pun.
9. "Password kasir ditolak" hanya di UI (`login.tsx:161-167`; server `http.rs:4628-4633`).

**Fitur kurang**
1. Siklus sidik jari POS (M–L): template hanya di server toko, tidak disinkron/di-backup ke luar PC (`fingerprint.rs:315`, `edge/backup.rs`); tidak ada layar daftar/retire; template karyawan keluar tidak dihapus (risiko UU PDP); kepala toko bisa enrol jari siapa saja tanpa saksi.
2. Jendela pencabutan offline sampai 7 hari (lease 604800 s, `0635:111`) — keputusan Anda.
3. Batas per peran (nominal void/retur/payout) tidak ada (`contract.rs:27-31`).
4. Laporan per kasir tipis (M): tidak ada dataset shift/variance per kasir; selisih dibebankan ke unit (`store_money.rs:596,717-736`).
5. Tidak terkait roster/absensi: yang belum absen tetap bisa buka laci (M).
6. Tidak ada tugas sementara di toko lain (M).
7. Modal awal diketik bebas, tidak ada standar per kursi dari HO (S).

**Sudah jalan end-to-end (menurut kode):** Stop till/kasir/toko termasuk outbox yang sudah menunggu, ambil alih kursi di tengah shift, serah modal (FLOAT_RETURN), tutup buta, approval & posting variance di HO.

## User account management

**Bug**
1. Separation via People › Changes tidak menutup login (`people.rs:1018-1031`; daftar akun menandai `LEFT_OPEN`).
2. Ganti password di store app gagal untuk semua akun Central (`frontend-store-new/src/screens/password.tsx:59`, `edge/auth.rs:1093-1096`).
3. "Wajib ganti password sementara" hanya di layar hub; server toko menerima password sementara tanpa batas (`users.rs:305-316`, `:1085`).
4. "Unlock now" di hub tidak membuka kunci di server toko (`users.rs:989-1003`, `edge/sync.rs:2177-2188`).
5. Admin bisa mengambil alih / membuat Owner (`users.rs:1053-1099`, `:890`, `invitations.rs:289-298`).
6. Aturan "permissions tetap Admin" bisa ditembus override (`permissions.rs:69`, `http/auth.rs:456-465`).
7. Login/logout & lockout tidak masuk audit log (`http/audit.rs:131-135`).

**Fitur kurang**
1. 2FA untuk Owner/Admin/IT (L).
2. Throttle login per klien (S–M) — hanya lockout per akun; akun `admin` bisa dikunci terus oleh siapa saja (`users.rs:156-175`).
3. Manajemen sesi: daftar sesi, cabut satu, "sign out everywhere" (M).
4. Jangkauan beberapa toko (area manager) — API `upsertEdgeAssignment` ada, layar tidak ada (M).
5. Melihat pencabutan yang belum sampai ke toko offline (M).
6. Service account / API key (M).
7. Kebijakan password: hanya panjang 8 (S).
8. Akun bootstrap `admin` dari env tidak pernah diminta ganti; dua route lama masih membiarkan admin mengetik password orang lain (S) (`users.rs:90`, `:376`, `:1133`; `edge/sync.rs:2133`).
