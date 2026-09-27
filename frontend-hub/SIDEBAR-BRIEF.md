# Satu sidebar, dengan sub-menu

Dibangun 2026-09-03 atas permintaan Hari. Rujukan visual: sidebar "Ace Studio"
— chip workspace, Quick actions, daftar berlabel, kaki help + akun. Alasan:
*we keep things simple.* Rail ikon 58px + sidebar 248px adalah dua lapis
navigasi untuk sebelas modul.

**Status: sudah jalan.** Dokumen ini catatan keputusan, bukan rencana. Yang
mengikat ada di kode: `components/shell/sidebar.tsx` dan `lib/navigation.ts`.

Draf pertama mengganti sub-menu dengan tab di dalam halaman. Hari menolaknya
("kita mau ada sub menu, bukan tabs"), jadi arahnya dibalik: **sub-menu di
sidebar, dan tiga tab strip yang sudah ada justru dihapus.**

## Bentuk

Satu kolom 248px, dari atas ke bawah:

1. **Chip** — mark + nama node + tombol collapse.
2. **Quick actions ⌘K** dan **Ask ⌘J**. Keduanya di atas daftar modul dan
   bukan di dalamnya, karena tak satu pun dari keduanya adalah *tempat*: satu
   membuka pencarian, satu membuka percakapan, keduanya meninggalkan Anda di
   layar yang sama.
3. **Strip ikon** — Discussions · Chat · Files · Documents · Reports. Lima
   layar yang bukan bagian dari bisnis, jadi bukan baris. Lihat "Aside".
4. **Sembilan baris modul.** Modul yang sedang dibuka mekar jadi layar-layar di
   bawahnya, menjorok, tanpa ikon. Yang lain tertutup.
5. **Kaki** — Help & resources, kartu akun, sign out.

Label grup seperti "Back office" **tidak dipakai**. Label satu-satunya muncul
di dalam modul yang mekar (Finance: Work · Books · Setup; Inventory:
Distribution · Counting · Ledger). Dua tingkat label sekaligus membuat kolom
ini ramai, dan label di dalam modul yang sedang dibaca adalah yang berguna.

## Aturan yang menahannya

**Yang mekar adalah modul yang aktif, dan tidak ada yang lain.** Tidak ada
state buka/tutup di file mana pun — modul mana yang terbuka dibaca dari URL.
Itu yang menahan panjang kolom (sebelas baris + satu modul), dan itu yang
membuat tautan yang dikirim ke kolega membuka sidebar sama seperti pengirimnya.
State harus dipulihkan, disinkronkan dengan navigasi, dan tetap salah di tab
kedua.

**Baris modul bernavigasi, bukan sekadar membuka.** `home` adalah layar nyata,
jadi klik yang hanya membentangkan daftar adalah klik yang tak ke mana-mana.
Mendarat di modul membuatnya aktif, dan itulah yang memekarkannya — jadi
disclosure dan navigasi satu gerakan yang tak bisa berselisih.

**Modul dengan satu layar tidak mekar** (`visibleItems(module).length > 1`).
Home begitu: chevron yang membuka satu sub-item "Brief" di bawah baris "Home"
mengatakan kata yang sama dua kali.

**⌘B menyempitkan ke kolom ikon 58px, bukan menghilangkan.** Navigasi yang
hilang total hanya punya jalan kembali lewat shortcut, dan tak ada apa pun di
layar yang mengatakannya. Baris memakai `title` bawaan saat menyempit —
tooltip buatan sendiri hidup di dalam area scroll `nav` dan terklip olehnya.

**Badge Finance jadi titik saat menyempit.** Angka itu ada supaya diperhatikan
orang yang belum membuka modulnya, dan itu persis orang yang sedang melihat
kolom 58px. Titik: klaim yang sama, tanpa lebar.

## Yang dihapus

- `components/shell/icon-rail.tsx`. Empat tombolnya punya rumah: Search →
  Quick actions; Toggle → tombol di chip; Help → kaki; Settings → baris System.
  Tombol asisten → baris **Ask**.
- `RailTint` dan `tint` di sebelas `nav.ts`, beserta prosa soal hue.
- `screens/{commercial,procurement,articles}/tabs.tsx` dan 14 pemakaiannya.
  Strip itu adalah apa yang harus ditumbuhkan modul tanpa baris sidebar.

## `hidden` sekarang berarti satu hal

*Ter-route dan bisa dicari, tapi bukan sub-item.* Untuk layar yang dicapai
lewat tautan dari layar lain, bukan dengan menuju ke sana dari dingin. Sidebar
adalah daftar tempat yang orang **tuju**; ini tempat yang orang **sampai** ke
sana.

Empat yang tersisa, semuanya di Procurement: Outstanding, Price amendments,
Catalogue, Destinations. Sembilan lain yang dulu `hidden` (Commercial 3,
Articles 2, Procurement 2) kini sub-item biasa — mereka diberi `hidden` hanya
supaya tidak jadi baris sidebar sendiri, dan itu masalah yang sudah tidak ada.

## Article setups bukan menu, dan bukan layar

Diminta Hari saat sidebar sedang dikerjakan: *"setups harusnya ga menu baru,
tapi di articles bisa, ada trigger terus ngebuka dialog, karna setup per
receive."*

Betul, dan bukan cuma soal menu: **setup dilakukan pada satu delivery**, jadi
ia aksi atas daftar article, bukan tempat di sebelahnya. Rute
`/articles/setups` dihapus dan `ArticleSetups` diganti `SetupSheets` — tiga
sheet ber-URL di atas `/articles`, satu panel pada satu waktu:

| URL | Pertanyaannya |
|---|---|
| `?setups=true` | Delivery yang mana? |
| `?receipt=<line>` | Delivery itu, sedang diberi identitas. Belum ada sesi. |
| `?setup=<session>` | Sesinya, tempat varian dideklarasikan. |

Preseden `cart` di `lib/sheets.ts`: flag, bukan id, "which is why it is no
longer a screen in the menu". Trigger-nya tombol **Set up deliveries** di
header Articles, memakai jumlah antrean sebagai badge — nama tombol menyatakan
sesuatu ada, angkanya menyatakan tiga delivery duduk di gudang dengan kode yang
tak bisa dijual.

Sheet dipasang oleh layar Articles tanpa syarat, bukan di belakang trigger:
`?setup=<id>` adalah tautan yang diikuti detail article kembali ke delivery
yang mencetaknya. Sheet yang hanya ada setelah tombolnya ditekan adalah tautan
yang bekerja untuk penekannya saja.

**Konsekuensi yang diterima:** antrean setup tidak lagi muncul di ⌘K, karena
⌘K dibangun dari path nav dan sheet bukan path. Sama seperti `cart`. Kalau
nanti terasa hilang, obatnya mendaftarkan sheet ke palette — bukan
mengembalikan menunya.

## Efek samping

- **Lebar konten.** Commercial, Procurement dan Articles dulu jalan tanpa
  sidebar sama sekali; kolomnya kini menyempit ~190px. Delapan modul lain
  melebar 58px. Yang paling terasa grid Pricelist. ⌘B mengembalikannya.
- **Finance dan Inventory panjang** (10 dan 11 sub-item). Terbaca di layar
  penuh; di jendela pendek `nav` men-scroll. Kalau terasa penuh, obatnya
  memindahkan layar bulanan ke `hidden` — tetap ter-route, tetap di ⌘K.
  Kandidat: Finance → Account map, Period close; Inventory → As of, Control,
  Time machine.
- **Tidak ada baris Home buatan.** Home ada karena modulnya ada (brief), bukan
  supaya mirip rujukan.

## Terverifikasi di layar

Di `frontend-hub` pada node cloud dev: Home aktif tanpa chevron; Finance mekar
dengan tiga label grup dan badge 3 pindah ke Supplier bills; Inventory mekar
sebelas sub-item; Commercial empat sub-item tanpa tab strip;
`/procurement/amendments` menyorot baris Procurement tanpa sub-item aktif; ⌘B
menyempit ke ikon dengan titik merah di Finance; trigger Articles → antrean
tiga delivery → form isian dengan sepuluh slot colourway.

`tsc`, `eslint`, `design-lint` dan `endpoint-audit` bersih untuk setiap file
yang disentuh.


## Master data jadi satu modul

Diminta Hari 2026-09-03: *"dipindah saja jadi satu master ya, kecuali coa,
khusus yg suppliers, tags, sizes, colors divisions, articles."*

Modul `master` di `/master`, dua bagian:

| Bagian | Isi |
|---|---|
| *(tanpa label)* | Articles · Suppliers |
| Vocabulary | Divisions · Colours · Sizes · Tags |

**Yang pindah:** `screens/articles/` → `screens/master/`; `/articles` →
`/master`; `/articles/colours` → `/master/colours`;
`procurement/suppliers.tsx` → `master/suppliers.tsx` di `/master/suppliers`.
Procurement tinggal dua sub-item, Sourcing dan Purchase orders — layar
supplier masih membaca `queries/procurement`, karena tempat layar hidup dan
tempat datanya datang adalah dua pertanyaan berbeda.

**COA sengaja tidak ikut**, sesuai permintaan, dan alasannya berdiri sendiri:
tak seorang pun mencari akun di luar Finance, dan aturan posting yang
memakainya cuma tiga baris dari situ di sidebar modul itu.

**Risiko yang diambil sadar.** Procurement pernah memfilekan empat layar di
bawah heading "Master data" dan mereka tak dibaca sebulan sementara memakan
separuh panel — komentar itu masih ada di `procurement/nav.ts`. Bedanya
sekarang keenam layar ini adalah *subjek* modulnya, bukan lampiran modul yang
lebih sibuk, dan dua di antaranya (Articles, Suppliers) layar harian yang
menjaga barisnya tetap hangat.

## Divisions, sizes, tags: tabel yang tak bisa diedit

Tiga menu yang Hari minta itu **belum punya endpoint sama sekali**. Tabelnya
ada sejak 0022 dan 0027 — sengaja, karena teks bebas tidak gagal saat salah
tulis, ia diam-diam membuat division berisi satu dan memecah setiap laporan
yang mengelompokkan dengannya. Tapi tak pernah ada jalan masuk: setiap term
adalah baris yang di-`INSERT` seseorang di migrasi, jadi menambah size berarti
merilis versi baru.

Jadi ini dibangun sekalian:

- **Migrasi 0091** menambah `version` ke `division`, `size_code`, `tag`
  (untuk If-Match yang sudah dipakai colour) dan `display_order` ke `tag`.
- **`GET/POST /api/v1/vocabulary/{kind}`** dan
  **`PATCH /api/v1/vocabulary/{kind}/{code}`**, satu pasang rute untuk tiga
  daftar. Satu bentuk data, satu handler — sembilan handler yang beda satu kata
  adalah tempat yang kesembilan lupa memeriksa auth.
- **Satu layar** `screens/master/vocabulary.tsx` diekspor tiga kali. Colours
  tetap punya layar sendiri: ia punya hex, digambar sebagai swatch, dan punya
  picker.

Tidak ada delete, hanya retire. Term yang sudah dipakai article tak bisa
dihapus tanpa meninggalkan baris menunjuk ke ketiadaan, dan foreign key-nya
akan menolak.

**Terverifikasi:** `tests/vocabulary_integration.rs`, 8 test lulus terhadap
Postgres nyata — kode size wajib dua digit (itu dua karakter terakhir SKU
11 digit), kode division dinormalkan ke satu bentuk, retire tidak melepas
barangnya, master tetap memperlihatkan yang di-retire sementara picker
menyembunyikannya, If-Match usang jadi conflict, POST diulang me-replay
bukan menggandakan, dan vocabulary tak dikenal jadi 404 bukan daftar kosong.

## Aside: lima layar yang bukan tempat

Diminta Hari 2026-09-03: *"discussions, chat, files itu diluar ya jangan
submenu tapi mungkin pake icon atau apa"* dan *"reports juga diluar, ga ada
menu analytics."*

Daftar modul adalah peta bisnis — apa yang dibeli, dipegang, dijual, biayanya,
siapa yang mengerjakan. Jendela chat bukan salah satunya, dan "Workplace"
sebagai modul terbaca sebagai departemen yang tak ada orangnya.

Jadi lima ini jadi ikon di atas daftar: Discussions, Chat, Files, Documents,
Reports. Path-nya naik ke akar (`/chat`, bukan `/workplace/chat`) karena tak
ada lagi Workplace untuk dinaungi.

**Mekanismenya satu flag,** `aside: true` di `AppModule`. Masing-masing
dideklarasikan sebagai modul satu-layar, yang shell sudah tahu tidak
dimekarkan. Routing, ⌘K, `moduleForPath` dan sorotan aktif memperlakukannya
sama seperti modul lain — itu intinya: satu flag, bukan jenis entri nav kedua
yang harus dipelajari empat pembaca.

**Analytics dibubarkan.** Tiga layarnya bukan satu subjek, hanya tiga
pertanyaan orang berbeda yang kebetulan menggambar grafik:

| Layar | Pindah ke | Alasan |
|---|---|---|
| Reports (harian satu toko) | Store ops, `Day report` | Satu toko, satu hari, sampai isi drawer |
| Sales analysis | Store ops | Omzet tiap toko lawan periode sebelumnya |
| Margin | Commercial | Sisa setelah pajak — pertanyaan yang dijawab sebuah harga |

Nama "Analytics" menyebut *tekniknya*, bukan subjeknya, dan itu cara modul
berakhir tak dibaca siapa pun: orang yang punya pertanyaannya tidak merasa
sedang melakukan analytics.

Aside **Reports** yang tinggal adalah modul saved-reports yang ditulis lane
lain — setiap laporan yang disusun siapa pun, termasuk yang belum ada saat app
dibangun. Dua layar boleh berbagi kata tanpa berbagi rumah.

## HR dan GA dipangkas (2026-09-27)

Diminta Hari: *"how can we simplify HR dan GA menu"*, lalu *"all in English,
kerjakan"*. Pemicunya temuan QA 26 Sep: di layar 800px menu HR dan GA
kepotong, dan scrollbar sidebar disembunyikan, jadi baris terbawah hilang tanpa
tanda.

**Satu aturan:** satu baris = tempat yang dibuka minimal tiap minggu.
Kelompok/jenis dari tabel yang sama jadi **chip**, pekerjaan bulanan jadi
**tombol** di layar terkait, setup yang jarang dibuka dicapai dari layar
setup-nya. Yang keluar dari sidebar tetap `hidden` — ter-route, ada di ⌘K, dan
menyalakan baris induknya lewat `alsoLights`.

| | Sebelum | Sesudah |
|---|---|---|
| HR · HO | 20 baris, 3 judul | 9 baris, garis tipis |
| HR · toko | 13 baris | 7 baris |
| GA | 18 baris, 4 judul | 10 baris, garis tipis |

- **GA:** Kontrak 6 baris → 1 (chip `?contract-group=`; Subscriptions memakai
  bacaan per lokasi yang dulu view Utilities). Aset 3 baris + 7 view
  tersembunyi → 1 (chip `?asset-view=`; Software dan Projects kini benar-benar
  menyaring lewat `build`). Penggantian keluar sidebar, menyalakan Repairs.
  Maintenance jadi dua modul satu-baris (Repairs, Service schedule) supaya GA
  tetap satu daftar datar. `conciseGa` dan `sidebarSection` dihapus; diganti
  `AppModule.divider` (garis tipis).
- **HR:** Overview jadi satu kotak masuk — layar Requests (cuti, koreksi,
  tukar jadwal) digambar di dalamnya, dan klaim, usulan karyawan serta payroll
  yang menunggu jadi baris di daftar perhatiannya; barisnya membawa angka
  (`usePeopleWaitingCount`). New employees dari Employees, Overtime dari
  Roster, Period close dari Attendance. Pay agreements dan seragam jadi tab
  **Pay** (hanya HO) dan **Uniforms** di lembar karyawan; layar Pay
  agreements dan Benefits dihapus. Time policy jadi **Settings**
  (`/people/settings`), dengan Punch stations dan Scheduler dibuka dari
  header-nya. Leave, Rule numbers, Salary structures, dan semua draf yang tak
  pernah di-route (Performance, Recruitment, Training, Changes, Exits,
  Lifecycle) **dihapus** — ada di git (66f6815) bila perlu kembali.
- **Bahasa:** label dan teks layar GA jadi bahasa Inggris seperti bagian hub
  lain. Isi kertas surat (STB, SJ) tetap bahasa Indonesia karena itu dokumen
  yang dicetak.

- **Siapa melihat apa:** rail desktop kini memakai aturan launcher HP
  (owner, 2026-09-25) — CASHIER tidak ditawari departemen, Files, Reports;
  System hanya ADMIN. Satu sumber: `officeFor`/`systemFor` di `lib/apps.ts`.
  Pemicunya QA 26 Sep: "Dian" (Admin toko, login CASHIER) melihat HR dan GA.

**Belum:** badge di Overview GA sengaja tidak dibuat — endpoint
`/api/v1/ga/overview` memotong tiap bagian di 10 baris, jadi angkanya akan
salah untuk register besar. Wawancara exit dan penyelesaian F&F tidak punya
layar (drafnya tak pernah di-route); tempatnya kelak tab Exit di lembar
karyawan.
