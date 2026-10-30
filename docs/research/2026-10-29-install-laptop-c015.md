# Install toko baru di laptop — kenapa C015 gagal (28 Okt 2026)

Sumber: transkrip sesi "Store page not found after Windows install" (28 Okt, laptop C015 `DESKTOP-6Q3F7V9`) dan kode di working tree hari ini.

## Yang terjadi, urut

| # | Di layar | Akar masalah | Bukti di kode/bucket |
|---|---|---|---|
| 1 | Setelah install, tombol "Open store app" membuka `store-c015.local:8082` → *page can't be found* | Nama `.local` (mDNS) tidak bisa dibuka Windows untuk dirinya sendiri, dan Chrome Android tidak mencari `.local` sama sekali | Perbaikan ke IP LAN ada di `backend/src/edge/discovery.rs` + `enrolment_setup.html` — **belum di-build, belum di-commit** |
| 2 | `192.168.0.249:8082` juga *not found*, padahal `netstat` = `0.0.0.0:8082` | **Installer yang dipakai tidak membawa aplikasi toko.** Yang diunduh = `store-server/Central-Store-Server-setup.exe` (NSIS, build tangan 25 Okt, ke `Program Files\Central Store`) — tanpa folder `web\`. `/console` jalan karena tertanam di `store.exe`; `/` 404 | Bucket `itulah-central-desktop`: hanya exe itu. MSI dari CI (`deploy/windows/store.wxs`) **membawa** `web\**`, tapi tidak pernah dipublish |
| 3 | Operator disuruh cari folder `itulah Store\web`, ternyata foldernya `Central Store` | Ada **dua installer** dengan nama folder berbeda (MSI: `itulah Store`, NSIS: `Central Store`) | `store.wxs:59` vs NSIS 25 Okt |
| 4 | Link install di hub | Default hub menunjuk `store-server/latest.msi` — **file itu tidak ada (404)** | `backend/src/cloud/postgres/stores.rs:54` |
| 5 | Akhirnya `store-web.zip` diunggah, folder `web` dibuat manual, `Restart-Service` | Workaround di depan audiens | `gs://…/store/store-web.zip` |
| 6 | `/setup` 404 setelah connect → dikira error | Halaman setup memang hilang setelah enrol; tidak ada halaman "Ready" yang tetap | `edge/enrolment.rs` |
| 7 | POS di laptop yang sama: "perangkat ini belum diatur sebagai kasir" | POS **sudah pernah join ke server lain**, jadi tombol *Gabungkan kasir ini ke server toko* disembunyikan | `pos-desktop/ui/src/screens/login.tsx:586` — tombol hanya muncul kalau `pairing_id === null` dan layar sidik jari |
| 8 | Disuruh kill proses + rename `node.json` di `%APPDATA%\id.itulah.kasir.desktop` — tetap tidak muncul | POS menulis ulang `node.json` saat ditutup; tidak ada jalan "Pindah toko" dari UI. **Sesi berakhir belum beres** | `pos-desktop/src-tauri/src/edge.rs:201` |
| 9 | Seat kasir C015 = 1, diubah ke 2 lewat **database**; kebijakan baru sampai ke server ±6 menit kemudian | Tidak ada "tambah seat lalu approve" dari layar persetujuan; republish policy tidak langsung | sesi: 03:54 → 04:00 UTC |
| 10 | Approve POS lewat database, bukan hub | Presenter tidak login hub di laptop demo | — |
| 11 | Laptop server di baterai 75% | Kalau tidur, server mati di tengah demo | heartbeat C015 |
| 12 | Tablet/POS lain tidak bisa membuka server | Rule firewall dibuat `store.exe` hanya untuk profil **Private/Domain** (sengaja: laptop di Wi-Fi kafe tetap tertutup). Wi-Fi baru di Windows defaultnya **Public**, jadi diblokir, dan installer tidak memberi tahu | `backend/src/edge/winservice.rs:221-246` |

Ringkasnya: **installer yang dipublish ≠ installer yang dites CI**, dan **semua masalah baru ketahuan di depan audiens**, karena installer tidak memeriksa laptopnya sendiri dan tidak punya layar "Ready" yang membuktikan semuanya jalan. Operator akhirnya mengetik ±12 perintah (`ipconfig`, `netstat`, `sc`, `Restart-Service`, `Set-NetConnectionProfile`, rename file di `%APPDATA%`).

## Perbaikan, urut prioritas

**Wajib sebelum demo berikutnya**
1. **Satu installer.** Publish MSI hasil CI (sudah bawa `web\`, sudah ada smoke test) ke alamat yang dipakai hub; tarik `Central-Store-Server-setup.exe`. Smoke test ditambah: `GET /` harus 200 dan berisi aplikasi toko. GitHub Actions masih kena billing → jalankan di Cloud Build.
2. **Alamat = IP LAN**, bukan `.local` (kode sudah ada, tinggal build). Tampilkan `127.0.0.1`, bukan `localhost`.
3. **Jaringan Public ketahuan saat install**: installer menyebut nama Wi-Fi-nya dan menawarkan "Jadikan Private" (rule firewall tetap Private/Domain saja).
4. **POS: "Pindah ke toko ini"** selalu ada di layar pintu POS kalau POS terhubung ke server lain atau ada server di PC ini (`127.0.0.1:8082`). Tidak ada lagi rename file.
5. **Gladi bersih** sehari sebelum: laptop Windows bersih, unduh dari link hub, stopwatch.

**Berikutnya**
6. **Cek laptop sebelum install** (layar pertama installer): port 8082 kosong, jaringan Private, colokan listrik, sleep, server lain sudah terpasang, POS terhubung ke toko lain.
7. **Layar Ready yang memeriksa dirinya sendiri**: aplikasi toko terbuka, bisa dibuka dari Wi-Fi, Central terhubung, sleep mati — tiap baris bisa diklik.
8. **Approve di hub: "Tambah seat dan setujui"** dalam satu klik, policy dikirim saat itu juga.
9. Sleep dimatikan saat dicolok selama server jalan (`powercfg`); peringatan kalau di baterai.
10. Code signing (SmartScreen).

Prototype: `store-opening-prototype.html` → bagian **Laptop install**.
