# Naskah: membuka toko baru, dari hub sampai server toko online

10 Oktober 2026. Narasi UI/UX untuk Admin HO, teknisi atau kepala toko di lokasi, dan supervisor kasir. Ada dua naskah. **Naskah A** mengikuti kode sekarang (cloud, frontend-hub, server toko, pos-desktop). **Naskah B** adalah alur yang diusulkan, karena alur sekarang belum mulus. Label dan tombol ditulis dalam English seperti di aplikasi; narasi dalam Indonesia.

Sumber: penelusuran working tree branch `handheld-rfid` (hub `screens/stores/`, `screens/setup/`, `screens/system/`; backend `cloud/postgres/setup.rs`, `stores.rs`, `node_enrolment.rs`, `edge/enrolment.rs`; `deploy/windows/store.wxs`; `pos-desktop/src/join.tsx`; `desktop-first-run-prototype.html`).

## Pemeran dan tempat

| Siapa | Di mana | Tugasnya |
|---|---|---|
| Admin HO (Rina Kusuma) | Central (hub) | Menambah toko, menerbitkan kode pasang, menyetujui server, membuka toko |
| Teknisi atau kepala toko | PC back-office toko | Memasang server toko, membacakan angka verifikasi |
| Supervisor toko | Store app, kasir | Menyetujui kasir baru |
| Kasir | pos-desktop | Bergabung ke server toko, mulai berjualan |

---

## Naskah A · Alur sekarang

Tanda ⚠ menandai bagian yang belum mulus atau belum bisa direkam apa adanya.

### Bab 1 · Menambah toko di hub
Layar: Stores → **Open a new store** → sheet "Open store". Satu baris per toko: kode C0xx (otomatis), nama, kota (zona waktu ditebak), manajer (wajib). Simpan → dialog "Store C014 created · Install its server from C014's own page." → sheet "Send these links": link undangan manajer, Copy dan WhatsApp, berlaku 72 jam, ditampilkan sekali.

> Admin menambah toko cukup dengan nama, kota, dan manajernya. Central langsung menyiapkan unit, gudang toko, dan undangan untuk manajernya.

⚠ Tombol "Open store" dipakai untuk *membuat* toko, padahal di halaman toko "Open store 🎉" berarti *mulai beroperasi*. Dialog tanda terima menutup sendiri dalam 3 detik tanpa tombol ke halaman toko. Wizard menjanjikan "a code to pair its store server", padahal membuat toko belum menerbitkan kode apa pun.

### Bab 2 · Kode pasang server
Layar: halaman toko → tab **Server** → **Install server** → kotak "Activation code" `XXXXX-XXXXX`, QR, "valid until …", dan tiga langkah: buka tautan installer, ketik kode, setujui di bawah.

> Dari halaman toko, Admin menerbitkan kode pasang. Kode ini dipakai sekali dan berlaku 24 jam.

⚠ Tidak ada tombol Copy. Tautan installer `/downloads/itulah-store-setup.msi` tidak ada filenya. Kalau halaman ditinggal, kodenya hilang dan harus diterbitkan ulang. Jalur kedua di System › Store Servers punya stepper, tombol Copy, dan hitung mundur, tapi menunjuk ke halaman GitHub Releases yang tidak pernah dibuat CI. Kode yang sama disebut "pairing code", "install code", "Activation code", dan "code".

### Bab 3 · Memasang di toko
Di PC toko: jalankan MSI (belum bertanda tangan, muncul peringatan SmartScreen) → layanan Windows terpasang, browser membuka `http://localhost:8082/setup` → "Install store server": kolom **Activation code** dan **Cloud address** → **Connect**.

> Di toko, teknisi memasang server, lalu mengetik kode dari HO.

⚠ Kolom Cloud address muncul kalau alamat cloud tidak tertanam saat build. Halaman setup hanya terbuka di PC itu sendiri; di Linux tanpa layar harus lewat perintah `store enroll`. Teksnya menunjuk "Hub → System → Nodes", padahal menunya bernama Store Servers. MSI Windows belum pernah dijalankan di PC toko sungguhan.

### Bab 4 · Mencocokkan angka
Layar toko: "Waiting for approval" dengan angka besar `482 913`. Layar hub (tab Server): "Verification" dengan angka yang sama → **The numbers match — approve** atau **Reject**.

> Server toko menunjukkan enam angka. Admin mencocokkannya, lalu menyetujui. Dengan begitu hanya mesin yang benar yang menerima data toko.

⚠ Admin tidak diberi tahu bahwa ada server yang menunggu; ia harus sedang membuka tab Server. Angka dibacakan lewat telepon.

### Bab 5 · Data pertama
Layar toko: "Connected · Initial data is coming from the cloud", lalu pindah ke store app setelah 6 detik. Hub: "Pulling its first data", lalu "Online".

> Setelah disetujui, katalog, harga, dan akun staf mengalir ke server toko.

⚠ Tidak ada progres. "Online" muncul pada heartbeat pertama walau katalog masih mengalir 20 perintah per siklus. Sebelum data akun tiba, belum ada yang bisa masuk. Metode pembayaran baru datang sampai 60 detik kemudian. Kalau bootstrap gagal di tengah, tidak ada coba ulang otomatis.

### Bab 6 · Kasir bergabung
pos-desktop ("itulah kasir"): "Kasir ini belum tergabung ke node toko. **Gabungkan**" → "Cari node" (mDNS) atau ketik alamat → **Minta bergabung** → kode kasir `7K4-P9Q` dan nomor verifikasi → supervisor menyetujui. Kasir pertama boleh disetujui supervisor dengan sandi; kasir berikutnya harus dengan jari atau PIN di kasir yang sudah bergabung → "Kasir 2".

> Kasir menemukan server toko di jaringan yang sama, lalu supervisor menyetujuinya.

⚠ Bahasa layar kasir masih Indonesia dan nama aplikasinya masih "itulah kasir". Firewall Windows untuk kasir harus diizinkan manual, dan jaringan toko harus berprofil Private. Store app hanya bisa menyetujui kasir pertama. Belum ada pembaruan otomatis untuk kasir.

### Bab 7 · Siap buka
Halaman toko, Overview: daftar "Ready to open" dengan lima syarat (Store server, Tills, Team, Payments, First stock) → **Open store 🎉** aktif setelah semuanya hijau → konfirmasi "Open C014?".

> Begitu lima syarat hijau, Admin membuka toko.

⚠ Baris daftar tidak bisa diklik, dan halaman tidak memperbarui sendiri. Kartu di beranda ("Pair the store servers") membuka daftar toko, bukan toko yang perlu dikerjakan. Toko baru tidak muncul di System › Store Servers sampai servernya terdaftar.

### Kesimpulan Naskah A
Bagian yang sudah dibangun cukup lengkap: kode sekali pakai, pencocokan enam angka, data pertama, mDNS untuk kasir, dan daftar kesiapan. Tapi alur ini belum bisa direkam ujung ke ujung karena tiga hal: belum ada installer yang bisa diunduh, MSI belum pernah berjalan di Windows sungguhan, dan Admin harus tahu sendiri kapan harus melihat tab Server.

---

## Yang membuat alur sekarang tersendat (diurutkan dari yang paling memblokir)

1. **Tidak ada installer untuk diunduh.** Tautan default 404, CI hanya menyimpan artefak 30 hari, nama file berbeda, dan mengganti tautan butuh SQL.
2. **Alamat cloud bisa kosong.** Perintah diam (silent) untuk Windows tidak membawa `CLOUD_URL`; teknisi bisa diminta mengetik alamat cloud.
3. **Admin tidak diberi tahu** saat server toko menunggu persetujuan atau saat data pertama selesai.
4. **"Online" bukan "siap".** Tidak ada progres data pertama, tidak ada status Ready, dan bootstrap berjalan di dalam request approve tanpa coba ulang.
5. **Dua jalur pemasangan yang berbeda** (tab Server toko vs System › Store Servers) dengan istilah, masa berlaku kode, dan tautan yang berbeda.
6. **Istilah tumpang tindih:** "Open store" untuk membuat dan untuk membuka; empat nama untuk satu kode; "Reject" vs "Refuse".
7. **Kasir:** firewall manual, store app hanya bisa menyetujui kasir pertama, tidak ada pembaruan otomatis, nama dan bahasa belum Central.
8. **Jalan buntu kecil:** dialog tanda terima tanpa tombol lanjut, kode hilang kalau halaman ditinggal, tautan manajer tidak bisa dikirim ulang, baris kesiapan tidak bisa diklik.
9. **Runbook lama masih ada** (master key, file env ditempel manual, Tailscale) dan bertentangan dengan alur pendaftaran baru.
10. **Pembaruan server** butuh developer: keygen, build khusus, menempel JSON rilis.

---

## Tiga bagian yang berbeda: server toko, store app, kasir

| | Server toko | Store app | Kasir (Central POS) |
|---|---|---|---|
| Apa | Layanan latar (`store`), satu per toko | Aplikasi back-office toko di browser | Aplikasi di tiap PC kasir |
| Dipasang di | PC back-office atau mini PC khusus | Tidak dipasang. Dibuka dari HP atau PC mana pun di jaringan toko; disajikan oleh server toko di port 8082 | Tiap kasir, dari installer Central POS |
| Dipakai oleh | Tidak ada yang memakainya langsung. Hanya ada lampu status | Manajer, supervisor, staf: penerimaan barang, stok, retur, tim, persetujuan kasir | Kasir: jualan, shift, laci |
| Tugasnya | Menyimpan data toko, tetap jalan saat internet putus, sinkron dengan cloud | Pekerjaan toko sehari-hari | Transaksi di depan pelanggan |
| Masuk dengan | Install code sekali saat dipasang | Password Central masing-masing | Disetujui supervisor sekali, lalu sidik jari atau PIN kasir |

Urutannya selalu: server dulu, lalu store app bisa dibuka, lalu kasir bergabung ke server.

---

## Naskah B · Alur yang diusulkan (revisi 10 Okt, masukan Hari)

Alurnya: **Admin menambah toko → hub menampilkan install code → di toko, installer meminta kode itu → hub langsung menerima konfirmasi.** Tidak ada pencocokan angka. Install code sendiri yang jadi bukti: dibuat oleh Admin, sekali pakai, berlaku singkat, dan hanya untuk toko itu. Setelah tersambung, hub menunjukkan mesin mana yang memakai kodenya, dengan tombol **Disconnect** kalau ternyata salah mesin.

Istilah:

| Lama | Baru |
|---|---|
| Open a new store / Open store (membuat) | **Add store** |
| Open store 🎉 (mulai beroperasi) | **Open store** |
| pairing code / install code / Activation code | **Install code** |
| Online (heartbeat pertama) | **Getting data** → **Ready** |

### Bab 1 · Tambah toko di hub (±30 detik)
Layar: Stores → **Add store** → nama, kota, manajer → **Add store**. Langsung terbuka halaman C014, tab **Server**: install code besar `KGD4-TX7Q` dengan **Copy**, "Valid for 1 hour · once", dan status hidup "Waiting for the server…". Di bawahnya tautan **Download Central Store Server**.

1. Membuka toko baru dimulai dari Central, di menu Stores.
2. Cukup nama, kota, dan manajernya. Central menyiapkan unit, gudang toko, dan undangan untuk manajernya.
3. Halaman toko langsung menampilkan install code untuk server tokonya.

### Bab 2 · Pasang server di toko (±35 detik)
Ada dua jenis mesin (keputusan Hari, 10 Okt), dan keduanya memakai install code yang sama:

- **PC back-office Windows yang sudah ada:** jalankan installer **Central Store Server** (MSI bertanda tangan, alamat cloud sudah tertanam). Halaman kedua installer: "Install code" `____-____` → **Install**. Installer memasang layanan Windows dan membuka port 8082 dan 5353 untuk kasir. PC tetap bisa dipakai untuk pekerjaan lain, jadi tidak dikunci.
- **Mini PC Linux khusus server:** HO menyiapkannya di kantor dengan satu perintah, `sudo ./install-store.sh --code KGD4-TX7Q --appliance --lock`, lalu mengirimnya ke toko. Di toko cukup colok listrik dan LAN. Layar mesin hanya menampilkan status, tanpa login.

4. Di toko, server dipasang di PC back-office yang sudah ada, atau berupa mini PC yang sudah disiapkan HO.
5. Installer meminta install code. Teknisi mengetiknya sambil melihat kode dari HO.
6. Alamat cloud sudah ada di dalam installer, jadi tidak ada lagi yang perlu diisi.

### Bab 3 · Hub menerima konfirmasi (±30 detik)
Hub, tab Server C014, tanpa ada yang ditekan: "Connected · SHOP-PC-C014 · Windows 11 · 10 Oct 2026, 09:41", lalu progres **Getting data**: Articles 12.480 ✓, Prices ✓, Staff ✓, Payment methods ✓, Promotions ✓ → **Ready**. Notifikasi ke Admin: "C014's server is ready." Di layar installer muncul hal yang sama, ditutup "Ready. Open the store app: http://c014.local:8082" beserta QR.

7. Begitu kodenya dipakai, hub langsung menerima konfirmasi, lengkap dengan nama mesinnya.
8. Data toko mengalir: katalog, harga, akun staf, metode bayar. Progresnya terlihat di hub dan di toko.
9. Kalau ternyata mesinnya salah, Admin cukup menekan Disconnect.

### Bab 4 · Store app (±30 detik)
Manajer toko memindai QR dari layar server dengan HP → store app terbuka → masuk dengan akun Central yang dibuatnya dari undangan → beranda toko: Receiving, Stock, Team, Tills.

10. Store app tidak perlu dipasang. Manajer cukup membukanya dari HP atau PC di jaringan toko.
11. Ia masuk dengan akun Central-nya sendiri, akun yang sama dengan undangan dari HO.

### Bab 5 · Kasir bergabung (±35 detik)
PC kasir: pasang **Central POS** → aplikasi menemukan "C014 server" sendiri → **Ask to join**. Kasir pertama: supervisor masuk di kasir itu dan menyetujuinya. Kasir berikutnya: di kasir yang sudah bergabung, Settings › Tills waiting → "Kasir 2 asks to join" → supervisor menyetujui dengan **PIN** (nanti wajib sidik jari, keputusan Hari 10 Okt). Kasir baru: uji printer struk dan laci → "Kasir 2 is ready". Store app menampilkan daftar kasir dan statusnya.

12. Kasir menemukan server toko di jaringan yang sama, tanpa mengetik alamat.
13. Supervisor menyetujuinya dengan PIN di kasir yang sudah bergabung. Nanti persetujuan ini wajib dengan sidik jari.

### Bab 6 · Buka toko (±25 detik)
Halaman toko, Overview: "Ready to open" yang memperbarui sendiri. Setiap baris menyebut siapa yang mengerjakannya dan membuka layar milik departemen itu:

| Syarat | Dikerjakan oleh | Di mana |
|---|---|---|
| Store server | Admin HO | Halaman toko › Server |
| Tills | Toko (manajer/supervisor). HO hanya menentukan jumlah seat | Di kasir dan store app |
| Team | HR. Manajer toko sudah dinamai saat Add store; staf lainnya ditempatkan HR | People › Add employee, unit Purwokerto |
| Payments | Finance: tunai sudah aktif; QRIS dan debit dengan rekening bank EDC-nya | Finance › Shop Payment Methods |
| First stock | MD membuat allotment pertama; toko menerima dengan hitung buta | Allotment, lalu store app |

Semua hijau → Admin menekan **Open store**.

14. Setiap syarat dikerjakan oleh pemiliknya: HR untuk tim, Finance untuk pembayaran, MD untuk stok pertama, dan toko untuk kasirnya.
15. Halaman toko mengumpulkan semuanya di satu tempat. Setelah semuanya hijau, Admin membuka toko.

Durasi total ±3 menit. Narasi berhenti saat toko dibuka; kontrol HO setelahnya dan tutup toko dibahas terpisah di bawah.

---

## Untuk nanti (di luar narasi toko baru): kontrol jarak jauh dari HO

**Sudah dibangun** (belum diuji ujung ke ujung):
- Menu **Actions** di halaman toko (`cloud/postgres/store_actions.rs`): Restart server, Resend initial data, Back up now, Diagnose, Sync now, dan untuk perangkat: Test print, Suspend, Reactivate, Revoke. Restart, Resend initial data, dan Revoke minta konfirmasi. Restart menunggu laci kasir tertutup.
- Jalurnya satu arah: perintah HO menumpang balasan atas upload toko (`sync/node_ops.rs`), ditandatangani dan berurutan. Cloud tidak pernah menghubungi toko, jadi toko tidak perlu port masuk dari internet.
- Linux: `sudo ./install-store.sh --code <kode> --cloud <url> --appliance` memasang layanan dan mendaftarkan server dalam satu perintah. `--appliance` menambah watchdog (reboot otomatis kalau OS macet), pembaruan keamanan otomatis jam 03:00, batas log, dan NTP.
- `deploy/edge/nftables-store.conf`: firewall yang mengunci mesin hanya untuk lalu lintas fleet (control server, relay, WireGuard, DNS, NTP). Ini bagian dari jalur Tailscale/Headscale lama dan tidak dipasang oleh installer.

**Belum ada:**
- **Update server** ada di menu tapi belum aktif. Pembaruan masih butuh developer (keygen, build khusus, menempel JSON rilis), dan di Windows MSI-nya harus dijalankan manual.
- **Mengunci mesin.** `--appliance` membuat mesin lebih awet, tapi tidak menguncinya: login lokal, desktop, SSH, dan USB tetap seperti biasa, dan firewall belum dipasang otomatis.
- **Akses IT jarak jauh** (shell atau desktop) tidak ada, dan itu disengaja. Server Headscale lama sudah mati.

**Usulan: mini PC Linux headless yang hanya diurus dari HO**

Arsitektur "headless Linux, administrasi hanya dari pusat" yang Hari tempel cocok, dengan beberapa penyesuaian untuk Central:

| Komponen | Usulan untuk Central | Catatan |
|---|---|---|
| Sistem operasi | Ubuntu Server 24.04 LTS minimal | Installer kita sudah memakai systemd dan apt; tidak perlu porting |
| Pekerjaan harian dari HO | Menu Actions di Central (restart, sync, backup, diagnose, update) | Tanpa SSH: perintah menumpang jalur sinkron, dan toko tidak membuka port masuk |
| Akses IT darurat | SSH dengan kunci saja lewat Tailscale; ACL hanya mengizinkan tag IT ke port 22 di toko | Mati secara default, dinyalakan dari Actions untuk 2 jam |
| Login lokal | `getty` dimatikan; tty1 menampilkan layar status (toko, Ready/Offline, "data up to …", QR store app) | Teknisi tetap bisa melihat status tanpa bisa login |
| Desktop | Tidak dipasang | |
| Boot | Secure Boot, password firmware, boot dari USB dimatikan | |
| Enkripsi disk | LUKS dengan buka otomatis lewat TPM2 (`systemd-cryptenroll --tpm2-device=auto`) | Wajib otomatis: kalau minta passphrase, server tidak bisa menyala sendiri setelah listrik padam |
| Pembaruan | Server toko: feed bertanda tangan milik Central. OS: unattended-upgrades jam 03:00 | `--appliance` sudah memasang yang kedua |
| Pengelolaan banyak mesin | Cukup Actions + feed pembaruan untuk puluhan toko. Ansible lewat Tailscale nanti, kalau konfigurasi OS mulai berbeda-beda | |
| Pemulihan hardware | Watchdog (sudah ada di `--appliance`), BIOS "Restore on AC power loss = On", dan satu mini PC cadangan di HO yang bisa didaftarkan ulang | Intel vPro/AMT bagus tapi membuat mini PC jauh lebih mahal; opsional |
| Fisik | Mini PC di lemari atau casing berkunci di back-office | Akses fisik tetap risiko: listrik dan LAN bisa dicabut, tapi data aman karena disk terenkripsi |

Perintahnya tetap satu:

```
sudo ./install-store.sh --code KGD4-TX7Q --appliance --lock
```

`--lock` (baru) memasang semua baris di atas: firewall (keluar hanya ke cloud, DNS, NTP; masuk hanya 8082 dan 5353 dari jaringan toko), tanpa login lokal, layar status di tty1, SSH dengan kunci saja lewat Tailscale yang mati secara default, LUKS dengan TPM2, dan pembaruan otomatis. Urutannya harus aman: kunci baru dipasang setelah Tailscale, SSH, dan jalur pemulihan teruji, supaya mesin tidak terkunci dari semua orang.

**PC back-office Windows** tidak dikunci karena masih dipakai untuk hal lain. Di sana cukup layanan Windows, firewall untuk 8082 dan 5353, Actions dari HO, dan Tailscale untuk akses IT darurat. Pembaruan server di Windows juga perlu berjalan otomatis lewat MSI dari feed yang sama; sekarang baru diunduh dan menunggu dijalankan manual.

## Untuk nanti (di luar narasi toko baru): siklus hidup toko dari HO

Status toko di hub: **Getting ready → Open → Closed** (`cloud/postgres/stores.rs`, `status_of`).

| Kontrol HO | Sekarang | Usulan |
|---|---|---|
| Add store | Ada (sheet "Open store", nama diganti Add store) | |
| Open store | Ada. Tombol aktif setelah lima syarat hijau. Sebelum itu kasir menolak membuka shift: "This store is not open yet — head office opens it from the hub." (`edge/till.rs:271`) | |
| Pause trading (tutup sementara) | Tidak ada | Alasan dan tanggal buka lagi. Kasir menolak shift baru dengan pesan yang menyebut tanggalnya. Data tetap sinkron, store app tetap bisa dipakai untuk stok dan penerimaan. **Resume trading** atau otomatis pada tanggalnya |
| Close store (tutup permanen) | Status `CLOSED` sudah ada di tabel `unit` dan hub sudah bisa menampilkan "Closed", tapi belum ada tombol, endpoint, maupun pemeriksaan di kasir | Daftar penutupan: stok kembali ke HO, shift dan kas selesai, kasir dicabut, server dicadangkan lalu diputus. Unit tetap ada untuk buku dan laporan |
| Jumlah kasir per toko | Ada (Till seats) | |
| Metode bayar per toko | Ada (Payments) | |
| Tim dan PIC | Ada (Team, undangan) | |
| Actions server | Ada: Restart, Resend initial data, Back up now, Diagnose, Sync now. Update server belum aktif | Aktifkan Update server |
| Actions kasir | Ada: Test print, Suspend, Reactivate, Revoke | |
| Ganti mesin server | Ada: mendaftar ulang sebagai generasi baru | Tombol **Replace server** di tab Server, memakai install code yang sama |
| Disconnect server | Tidak ada tombol | Mencabut kredensial server dari tab Server |

Catatan untuk Pause dan Close: server toko yang sedang offline tetap berjualan dengan status terakhir yang ia tahu (`site_profile::own_store_is_open` memilih tetap jualan kalau belum mendengar apa-apa). Perintah tutup baru berlaku begitu server tersambung lagi. Itu konsekuensi toko yang bisa jalan tanpa internet.

---

## Perubahan yang dibutuhkan untuk Naskah B

Diurutkan menurut seberapa memblokir. Belum ada yang dikerjakan.

**Wajib supaya bisa direkam sama sekali**
1. **Rilis installer server toko** ke GCS (bucket Jakarta, seperti Central desktop) dengan nama stabil dan `latest.json`. MSI bertanda tangan, dan `ITULAH_DEFAULT_CLOUD_URL` ditanam saat build. Tautan unduh dibaca dari manifest, bukan SQL. (CI, `deploy/windows/store.wxs`, `cloud/postgres/stores.rs:53`)
2. **Installer meminta install code** di halamannya sendiri (dialog MSI/NSIS), bukan lewat halaman browser `localhost:8082/setup`. Kolom alamat cloud dihapus.
3. **Uji MSI dan layanan Windows di PC sungguhan** (riza-1), termasuk firewall 8082/5353 dan profil jaringan Private.
4. **Tanpa pencocokan angka:** klaim kode langsung disetujui (`node_enrolment.rs` claim → approve dalam satu langkah), hub mencatat nama mesin, OS, dan waktu, lalu ada tombol **Disconnect** (cabut kredensial). Masa berlaku kode default 1 jam.

**Membuat alurnya mulus**
5. **Satu jalur pemasangan:** tab Server di halaman toko memakai stepper System › Store Servers (Copy, hitung mundur, status hidup), dan System menunjuk ke halaman toko.
6. **Progres data pertama dan status Ready:** server melaporkan perintah yang sudah di-ack per jenis lewat heartbeat, dan status `SYNCING` dipecah menjadi Getting data → Ready. Bootstrap dipindah ke job latar dengan coba ulang otomatis. Metode bayar ikut dalam bootstrap.
7. **Notifikasi ke Admin** saat server tersambung dan saat Ready.
8. **Alamat store app di layar server** (`c014.local:8082` beserta QR) setelah Ready.
9. **Persetujuan kasir** tetap di kasir yang sudah bergabung, dengan PIN supervisor sekarang dan sidik jari nanti (keputusan Hari 10 Okt). Sudah sesuai kode sekarang; yang ditambah hanya teks English dan daftar kasir di store app.
10. **Kasir:** nama "Central POS", teks English, firewall di installer, pembaruan otomatis, uji printer dan laci setelah bergabung.
11. **Update server dari HO** lewat feed bertanda tangan, untuk Linux dan Windows. Aktifkan Actions › Update server.
12. **`--lock`** untuk mini PC Linux: firewall, tanpa login lokal, layar status di tty1, SSH kunci saja lewat Tailscale yang dinyalakan dari Actions, LUKS dengan TPM2, Secure Boot. Dan untuk Windows: Tailscale untuk akses IT darurat serta pembaruan MSI otomatis.

13. **Pause trading dan Close store:** status Paused dengan tanggal, Resume, daftar penutupan, dan kasir menolak shift baru di toko yang Paused atau Closed. Tambahkan juga **Disconnect** dan **Replace server** di tab Server.

**Merapikan**
14. **Halaman toko cukup Overview dan Server** (masukan Hari, 10 Okt). Tab Devices, Activity, Team, Payments, Stock, dan Facilities dikeluarkan: kasir diurus di toko (store app dan kasir), tim di HR (People), pembayaran di Finance (Shop Payment Methods), stok di Inventory dan Allotment, fasilitas di GA. Jumlah seat kasir, keputusan HO, pindah ke fakta Overview. Baris "Ready to open" membuka layar milik departemennya.
15. **Istilah:** Add store vs Open store, Install code; perbaiki "Hub → System → Nodes".
16. **Jalan buntu:** kirim ulang tautan manajer dari People (HR), baris kesiapan bisa diklik dan memperbarui sendiri, kartu beranda langsung ke toko yang perlu dikerjakan, toko baru langsung muncul di System › Store Servers sebagai "Not installed".
17. **Runbook:** tandai `deploy/scripts/provision-store.sh` dan jalur master key sebagai khusus developer, lalu buat satu runbook teknisi yang mengikuti Naskah B.

## Keputusan Hari (10 Okt)

1. **Mesin server toko:** dua-duanya didukung. PC back-office Windows (tidak dikunci) dan mini PC Linux khusus (dikunci dengan `--lock`, disiapkan HO).
2. **Persetujuan kasir:** tetap di kasir yang sudah bergabung. Sekarang dengan PIN supervisor, nanti wajib sidik jari.
3. **Tanpa pencocokan angka** saat server toko tersambung; install code sudah jadi buktinya.
4. Mini PC memakai Ubuntu Server LTS dengan `--lock`.
