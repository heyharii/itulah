# Riset Next.js untuk Frontend Hub

Tanggal: 10 Oktober 2026. Metode: membaca source Hub dan dokumentasi resmi Next.js/TanStack. Ini studi arsitektur, bukan benchmark atau implementasi migrasi. Versi yang ditampilkan dokumentasi Next.js saat diperiksa: 16.4.0; nomor tersebut bukan verifikasi versi registry yang akan dipasang.

## Kesimpulan

Next.js lebih lengkap untuk menggabungkan React Server Components, cache hasil komponen, streaming, prefetch, dan pelestarian halaman. Tetapi belum ada bukti bahwa migrasi seluruh Hub akan lebih cepat. Hub sudah memiliki banyak mekanisme yang diminta pengguna. Alasan terkuat untuk Next.js adalah HTML awal berisi data dari server dan integrasi cache UI; bukan sekadar stale-while-revalidate data.

Rekomendasi: jika HTML awal dari server wajib, evaluasi Next.js App Router dengan Cache Components melalui satu halaman representatif terlebih dahulu. Rust tetap pemilik API, aturan bisnis, autentikasi, dan data. Jika syaratnya hanya data terakhir langsung tampil lalu update, memperbaiki stack sekarang tetap merupakan alternatif yang valid.

## Kondisi source yang diperiksa

- `frontend-hub/src/main.tsx`: `createRoot`, TanStack Query, default staleTime 30 detik, refetch fokus dimatikan, persistensi dimulai bersamaan dengan startup. Ini CSR, bukan hydration SSR.
- `frontend-hub/src/lib/query-persist.ts`: IndexedDB menyimpan query terpilih; cache dipisahkan menurut build, username, role, dan business. Pemulihan menunggu identitas/tenancy, tidak menimpa data yang lebih baru. HR/payroll/people dan sesi dikecualikan. Tidak semua layar sudah dipersistensikan.
- `frontend-hub/src/routes.tsx`: router diturunkan dari navigation registry, lazy chunk per modul, prefetch kode/data saat intent/navigasi. Memakai `import.meta.glob`, spesifik Vite.
- `frontend-hub/src/sw.ts`: shell offline, aset hash cache-first, dokumen network-first, Web Push. Next.js memerlukan penyesuaian strategi service worker; worker SPA ini tidak boleh langsung dipakai untuk HTML personal dan respons RSC.
- `frontend-hub/src/App.tsx`: gate sesi/tenancy dan URL dibaca melalui `window`; perlu refactor untuk SSR.
- `frontend-hub/src/lib/api.ts`: API cloud satu origin, cookie SameSite Strict; edge memakai bearer di sessionStorage. Server Next.js tidak bisa membaca sessionStorage perangkat.
- `frontend-hub/desktop/package.json`: desktop Tauri membuka Hub hosted. Bukan bukti bahwa runtime Node perlu dibundel dalam desktop, tetapi akses server dan perilaku offline perlu diverifikasi.
- `backend/src/cloud/http/mod.rs`: Rust menyajikan frontend statis melalui ServeDir.

Catatan pengukuran lama: `outputs/sales-explorer-performance/recheck-20261009/README.md` mencatat median lokal sekitar 763,7 ms untuk SKU/tahun dengan stock+matrix dan 136,5 ms ketika keduanya dimatikan. Ini tiga panggilan lokal backend melalui serialisasi JSON, tanpa HTTP/network/browser dan bukan p95 atau kondisi produksi. Migrasi framework tidak menghilangkan biaya query pada cache miss.

## Fungsi mekanisme Next.js

| Mekanisme | Pekerjaan yang dikurangi | Penggunaan Hub | Batas |
|---|---|---|---|
| Server Components | Kode pembentuk UI tidak harus dikirim/dijalankan di browser | Komposisi halaman, ringkasan, pembacaan awal | Tidak otomatis di-cache; bukan event handler browser |
| SSR | Browser mendapat HTML awal | Buka URL langsung dengan data | Interaksi Client Components tetap perlu hydration |
| `use cache` | Mengulang fungsi/hasil komponen yang sama | Snapshot laporan dengan parameter eksplisit | Akses request seperti cookies harus di luar scope |
| `use cache: remote` | Cache dibagi melalui penyimpanan eksternal | Beberapa instance Next.js | Handler/infrastruktur dan tambahan akses storage |
| `use cache: private` | Pemakaian ulang hasil personal oleh router browser | UI berbasis sesi | Bukan cache server lintas request; hilang setelah reload |
| Router cache + prefetch | Menunggu hasil route setelah klik | Sales ke Inventory dan kembali | Memori dan data dapat belum terbaru |
| Activity dengan Cache Components | Unmount/remount halaman | Kembali ke filter, scroll, draft | Halaman disimpan terbatas; effects perlu lifecycle yang benar |
| TanStack Query + IndexedDB | Fetch dan menunggu data lama setelah reopen | Widget live dan layar yang dipersistensikan | Tetap perlu aturan kesegaran dan pemisahan pengguna |

Server Components dan Client Components dapat sama-sama menghasilkan HTML pada pembukaan awal. `use client` tidak berarti komponen tersebut selalu hanya dirender di browser. RSC payload pada navigasi adalah hasil terstruktur React, bukan sekadar HTML. [Server/Client Components](https://nextjs.org/docs/app/getting-started/server-and-client-components).

Hasil cache dapat berada di server, HTML prerender, dan router browser. Cache Components bukan perintah untuk men-cache seluruh dashboard pengguna pada build. [Caching](https://nextjs.org/docs/app/getting-started/caching).

Private cache menjalankan fungsi pada request dan tidak menyimpan hasil lintas request di server. [Private cache](https://nextjs.org/docs/app/api-reference/directives/use-cache-private).

Temuan relevan untuk permintaan “tidak membangun UI lagi”: dengan Cache Components aktif, Next.js mempertahankan state dan DOM halaman menggunakan Activity, sampai tiga route menurut dokumentasi yang diperiksa. Ini navigasi dalam aplikasi, bukan full reload. Memori meningkat; effects dibersihkan ketika disembunyikan dan aktif lagi ketika ditampilkan. [Preserving UI state](https://nextjs.org/docs/app/guides/preserving-ui-state).

## Autentikasi dan cache personal

Sesi perlu diperiksa pada request; tidak bisa dimasukkan begitu saja ke shell statis saat build. Sesudah autentikasi/otorisasi, data turunannya bisa di-cache dengan nilai eksplisit sebagai input. [Authentication with Cache Components](https://nextjs.org/docs/app/guides/authentication-with-cache-components).

Usulan kunci cache Hub: tenant + identitas atau cakupan izin terverifikasi + versi izin + filter ternormalisasi + versi data/schema. Role saja belum tentu cukup bila dua orang dengan role sama memiliki akses toko berbeda. Ini usulan desain, bukan audit lengkap izin source.

Tetap validasi akses sebelum mengembalikan cache hit. Perubahan izin, tenant, sign-out, dan sesi yang dicabut harus memengaruhi cache UI/data. Jangan memperpanjang validitas sesi hanya karena router menyimpan halaman. Rust menjadi sumber keputusan akses; kredensial server dan bearer edge jangan diserialisasi ke props browser tanpa kebutuhan.

## Update dan invalidasi

Memperbarui cache server berbeda dengan memperbarui tab pengguna. Revalidasi cache tidak sama dengan push real-time. Untuk layar terbuka, pilih background fetch/polling atau event yang menginvalidasi query.

`revalidateTag(..., 'max')` menggunakan stale-while-revalidate; `updateTag` segera mengakhiri cache untuk read-your-own-writes tetapi hanya tersedia di Server Actions. [Revalidating](https://nextjs.org/docs/app/getting-started/revalidating).

Karena transaksi Hub tetap di Rust, Next.js tidak otomatis mengetahui perubahan dari POS, sinkronisasi edge, job, atau admin. Butuh jalur invalidasi dari Rust ke cache Next.js, atau versi data/TTL yang dapat diterima. Jika ada dua lapis cache, invalidasi harus mencapai keduanya; cache Next.js jangan diisi ulang dari cache Rust yang masih lama.

Tetapkan pemilik update per widget: bila TanStack Query memperbarui widget, data SSR harus menjadi seed query; jangan mempertahankan angka yang sama dalam RSC statis dan query live secara terpisah.

## Arsitektur yang disarankan jika memakai Next.js

Satu origin publik, routing frontend ke Next.js dan `/api/*` ke Rust; edge sesuai pola sekarang. Next.js dan Rust sebaiknya berdekatan secara jaringan.

Request awal: Next.js membaca cookie dan meneruskannya hanya ke Rust yang dipercaya untuk identitas/izin. Setelah valid, ambil snapshot dari cache dengan parameter yang tepat. Kirim shell dan ringkasan; bagian lambat streaming. Seed QueryClient per request untuk Client Components. Browser melanjutkan interaksi dan update kecil dari Rust, mempertahankan persistensi yang aman.

Server Components: komposisi halaman, ringkasan awal, konten read-only yang tidak perlu kode browser. Client Components: TanStack Table, virtualisasi, filter, editor, chart interaktif, offline outbox, integrasi Tauri. Jangan memindahkan semua klik/filter ke server.

Streaming hanya memisahkan kapan bagian tampil; bukan otomatis mengisi bagian lambat dengan data lama. Instant navigation juga memerlukan cache/prefetch yang tersedia. [Instant navigation](https://nextjs.org/docs/app/guides/instant-navigation). Respons interaktif tetap membutuhkan pending feedback, optimistic update jika semantiknya benar, dan pengurangan JavaScript/blocking work. [Interactive apps](https://nextjs.org/docs/app/guides/interactive-apps).

## Tradeoff performa dan operasi

- Cache hit server dapat mengurangi compute dan waktu ke tampilan; cache miss memerlukan sesi, Rust, render, dan serialisasi.
- Next.js menambah runtime/proses; tidak harus VM lain. Static export saja tidak menyediakan kebutuhan SSR runtime ini.
- Mengirim HTML, RSC, serta JavaScript untuk bagian interaktif bisa menambah ukuran transfer. Pengurangan bundle dari RSC tergantung bagian UI yang benar-benar dipindahkan dari client.
- Tabel besar yang tetap interaktif masih memerlukan JavaScript dan render browser. Virtualisasi tetap penting; SSR ribuan baris bukan solusi umum.
- Banyak kombinasi tenant/filter membuat cache hit rendah. Ukur hit rate dan ukuran sebelum memutuskan cache seluruh hasil render.
- Cache browser dapat lebih cepat daripada network request server saat kunjungan ulang. SSR tidak menjamin kemenangan pada kondisi ini.
- Next.js dapat self-host; beberapa instance memerlukan cache bersama dan koordinasi tag. Reverse proxy harus mendukung streaming tanpa buffering. [Self-hosting](https://nextjs.org/docs/app/guides/self-hosting).

## Migrasi

Migrasi Vite ke Next.js dimungkinkan bertahap, tetapi wrapper CSR sebagai tahap awal tidak membuktikan keuntungan SSR. [Panduan migrasi](https://nextjs.org/docs/app/guides/migrating/from-vite).

Untuk Hub: ganti routing/prefetch/navigation hooks, import.meta env/glob, gate auth, global browser initialization, service worker, deployment aset, dan pengelolaan cache per request. Komponen UI/kontrak Rust/query domain dapat banyak digunakan ulang. Perlu verifikasi SSE assistant, logout lintas tab, business switching, edge bearer, offline PO, printing/downloads desktop, serta deep link sheet/search.

TanStack Start tetap layak untuk SSR karena dekat dengan Router/Query saat ini. Dokumentasinya mendukung cache HTML via HTTP/CDN, sementara RSC masih experimental. Ini berbeda dari cache komponen terintegrasi Next.js; bukan berarti Start tidak bisa cache server. [TanStack ISR](https://tanstack.com/start/latest/docs/framework/react/guide/isr), [TanStack RSC](https://tanstack.com/start/latest/docs/framework/react/guide/server-components).

## Benchmark sebelum keputusan penuh

Bandingkan production build Hub sekarang dan satu halaman Next.js yang berfungsi, dengan Rust/data/region yang sama. Gunakan halaman ringkasan dan Sales Explorer tabel, karena beban berbeda.

Skenario: perangkat baru; reopen dengan IndexedDB; server cache miss/hit; navigasi belum/sudah prefetch; kembali ke halaman; filter baru; transaksi lalu baca; izin dicabut/tenant berganti; jaringan lambat/offline; deploy baru dan sesi lama.

Ukur p50/p95 waktu sampai data bermakna terlihat, waktu sampai filter/tabel bisa dipakai, latensi interaksi, waktu sampai data terbaru, total transfer HTML/RSC/JS, CPU/memori browser dan server, panggilan Rust, hit rate cache, dan kebenaran data/izin. Jangan hanya membandingkan skeleton atau TTFB.

Keputusan migrasi harus berdasarkan perbaikan yang konsisten pada metrik pengguna tanpa regresi use case penting. Belum ada benchmark Next.js versus Hub yang dijalankan dalam riset ini, sehingga tidak ada klaim persen peningkatan atau pemenang performa.
