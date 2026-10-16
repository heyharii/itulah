# UI consistency guidelines — frontend-hub

Keputusan desain, 14 Oktober 2026. Acuan untuk semua menu di frontend-hub.

**Jika kebutuhan halaman mirip, gunakan pola layout yang sama. Jika kebutuhan berbeda, layout boleh berbeda dengan komponen dan perilaku yang tetap konsisten.**

Dokumen ini menetapkan standar visual dan pola halaman. `PATTERN.md` tetap menjelaskan query, mutation, registrasi route, state, dan cara memakai primitive. Jika aturan visual lama berbeda dengan dokumen ini, gunakan keputusan di sini. Instruksi langsung pengguna tetap menjadi acuan utama.

## 1. Tiga lapis konsistensi

| Lapis | Yang dibakukan | Yang mengikuti kebutuhan menu |
| --- | --- | --- |
| Foundation | Skala teks, warna, spacing, radius, ukuran control, motion | Data dan konten |
| Component | Button, Field, toolbar, table, KPI, Sheet, footer, empty/error state | Label, nilai, kolom, status, aksi yang tersedia |
| Page pattern | Urutan blok, tempat search/filter, struktur detail/form, posisi aksi | Jumlah blok, lebar sheet, tabel vs matrix/board, susunan isi |

Konsistensi diperiksa berdasarkan **peran komponen dan jenis pekerjaan**, bukan nama departemen. List supplier, list employee, dan list toko seharusnya terasa satu keluarga. Dashboard dan form tetap memakai bahasa desain yang sama, dengan susunan yang sesuai tugasnya.

## 2. Pilih pattern sebelum membuat layout

| Pattern | Cocok untuk | Anatomi dasar | Primitive yang sudah ada |
| --- | --- | --- | --- |
| List | Menemukan, memfilter, dan membuka banyak record | Header → KPI jika diperlukan → tabs jika dataset berbeda → toolbar → data → state | `ListHead` atau `PageHeader`, `KpiBox`, `Toolbar`, `DataTable`, `queryState` |
| Detail | Membaca satu record dan mengambil tindakan | Header record → facts/ringkasan → detail → totals/notes/activity → footer aksi | `Sheet`, `Facts`/`Fact`, `MiniTable`, `RecordPanel`, `SheetFooter` |
| Create/edit form | Membuat atau mengubah record | Header → kelompok field → lines jika diperlukan → summary → footer aksi | `Sheet`, `Section`, `Field`, control UI, `SheetFooter` |
| Dashboard/report | Membaca kondisi, tren, dan perbandingan | Header/scope → figures → chart/table → drill-down | Header dan scope bersama keluarga report, KPI, chart, table |
| Board/matrix | Membandingkan tahapan, lokasi, waktu, atau dua dimensi | Header → scope/filter → board/matrix → detail record | Toolbar/control bersama, renderer domain, `Sheet` untuk detail |
| Workspace | Mengolah dua bagian yang saling terkait | Header → toolbar → pane kerja → preview/detail → aksi | Shell dan control bersama, layout pane sesuai tugas, `Sheet size="workspace"` bila diperlukan |

`ListHead` untuk list dengan figures; `PageHeader` untuk halaman umum. Jangan memakai keduanya sekaligus hanya untuk mendapatkan gaya judul tertentu.

Dashboard/report boleh memakai template bersama dalam keluarganya, seperti `ReportPage` di Executive. Jangan memaksa report menjadi list atau membuat setiap report memiliki header sendiri.

### Keputusan layout

1. Tentukan pekerjaan utama: mencari banyak record, membaca satu record, mengisi form, membandingkan data, atau mengolah workspace.
2. Pilih pattern yang paling dekat dari tabel di atas.
3. Isi slot dengan komponen bersama; hilangkan blok yang tidak diperlukan.
4. Sesuaikan body untuk kebutuhan domain.
5. Buat variasi layout hanya jika pattern yang ada mengganggu pekerjaan, misalnya matrix membutuhkan sumbu ukuran × warna.

Perbedaan layout harus menjawab kebutuhan pengguna. Nama menu yang berbeda saja tidak menjadi alasan membuat pola baru. Jangan menambahkan KPI, tabs, atau card kosong hanya agar halaman terlihat sama.

## 3. Foundation yang tetap sama

- **Teks minimum 14 px** (`0.875rem` pada root 16 px). Isi utama 15 px (`0.9375rem`), judul standar 17 px (`1.0625rem`). Input sentuh 16 px bila diperlukan. Gunakan token/named scale; jangan mengecilkan teks untuk memuat lebih banyak konten.
- **Weight 400, 500, 600.** Hierarki dibentuk lewat weight, warna, dan ruang.
- **Warna berasal dari token.** Menu tidak membuat warna sendiri untuk aksi, status, atau focus.
- **Spacing memakai skala bersama.** Header, body, table, form, dan footer harus punya garis alignment yang sama. Gunakan primitive sebagai pemilik padding dan gap.
- **Control radius 8 px; sheet radius 16 px.** Sheet layar penuh menyesuaikan batas layar. Container harus memotong background anak agar sudut tetap bersih.
- **Motion dan layer memakai primitive bersama.** Menu tidak membuat scrim, slide, fokus, atau close behavior sendiri.

Data chart, barcode, dan dokumen cetak punya kebutuhan tersendiri. Perbedaannya dicatat sebagai kebutuhan konten, bukan dijadikan jalan pintas untuk merombak chrome halaman.

## 4. Button dan action semantics

| Peran | Gaya | Contoh |
| --- | --- | --- |
| Aksi utama/konfirmasi | Filled primary biru, memakai token CTA | Review PO, Add item, Submit, Review order, Save |
| Aksi pendukung | Ghost netral: teks/ikon gelap, background putih, hairline tipis bila perlu, hover abu lembut | Filter, Columns, Print, Close, ikon edit/hapus di tabel |
| Membatalkan | Filled merah | Cancel, Cancel order |
| Destruktif | Filled merah; konfirmasi sesuai perilaku yang diperlukan | Delete, Remove, Discard |
| Navigasi | Link/nav item, memakai state aktif navigasi | Breadcrumb, pindah menu, buka record |
| Pemilihan nilai | Control pilihan dengan selected state | Tabs, segmented, checkbox, radio |

Biru pekat khusus aksi utama pada masing-masing konteks. Aksi pendukung memakai ghost netral, dengan teks/ikon gelap di atas background putih dan abu lembut saat hover. Jangan memberi semua control penekanan biru yang sama. Ikon hapus pada baris adalah ghost; aksi konfirmasi destruktif menggunakan filled merah. Semua aksi tetap punya label atau accessible name yang jelas. Aksi konfirmasi berada paling kanan di footer; Cancel merah berada di sebelah kirinya. Hierarki dibantu penekanan visual, posisi, dan label.

Navigasi dan pemilihan nilai tetap memakai komponen semantiknya. Elemen HTML `button` di dalam radio/select/tab tidak otomatis menjadi aksi simpan atau pembatalan.

## 5. Sheet pattern

Semua sheet memakai kerangka berikut:

```text
Header: konteks + identitas/judul + status/caption + close/back
Body: ringkasan/field utama → isi domain → informasi tambahan
Footer: aksi yang berlaku pada record/form
```

Header dan footer tetap tersedia; body memiliki scroll. Isi detail adalah nilai baca, sedangkan isi form adalah input. Create dan edit untuk objek yang sama memakai template yang sama.

Gunakan `Sheet` dan `SheetFooter`. Lebar dipilih dari `rail`, `wide`, `table`, atau `workspace` berdasarkan isi, bukan ukuran khusus per menu. Detail pendek tidak perlu sheet seluas matrix.

Tabs tidak menjadi default untuk record atau form. Jika record benar-benar memiliki sub-workflow/dataset yang berbeda, variasinya harus dijelaskan dan memakai primitive tabs yang sama.

Backdrop bersama memakai veil abu netral `rgb(210 208 204 / 48%)` dan blur ringan `2px`. Permukaan yang tepat di belakang sheet aktif memudar ke abu terang; isi sheet aktif tetap putih solid dan tajam. Pada sheet bertingkat, veil menutup parent sheet secara lokal tanpa menumpuk scrim seluruh layar. Ini menjaga konteks sekaligus menegaskan fokus.

Close/Cancel kembali ke konteks induk. Sheet bersarang mempertahankan konteks induk dan mengembalikan fokus. URL, keyboard, dirty guard, serta scroll ditangani primitive yang sudah tersedia.

### Workspace dengan ruang tambahan

New Allotment memakai shell A dengan inner sidebar otomatis menjadi ikon 64 px pada desktop. Pengguna dapat expand/collapse inner sidebar serta rail departemen paling luar. Rail luar tetap terlihat: 64 px berisi ikon atau 180 px berisi ikon dan nama departemen. Kontrol rail berada di atas dekat logo. Inner sidebar kembali ke 216 px setelah Submit, Cancel, atau pindah menu. Toggle navigasi tidak mereset data form. Tablet/mobile tetap memakai drawer navigasi.

Transisi ruang memakai FLIP `translateX` 200 ms dengan `cubic-bezier(.77,0,.175,1)` dan opacity navigasi 160 ms dengan `cubic-bezier(.23,1,.32,1)`, tanpa animasi width. Navigasi keyboard dan reduced motion memakai perubahan posisi langsung.

## 6. Satu pattern di semua perangkat

Gunakan perilaku responsive milik komponen bersama:

- Shell mengatur navigasi desktop, tablet, dan phone.
- `DataTable` mengatur prioritas kolom dan tampilan kartu sesuai ruang yang tersedia.
- `Sheet` mengatur ukuran, modal/drawer, safe area, dan fokus.
- Field dan footer menyesuaikan jumlah kolom serta wrapping; target sentuh tetap sekitar 44 px.

Jangan membuat versi mobile terpisah untuk setiap menu atau menambah breakpoint ad hoc. Urutan informasi dan makna aksi tetap sama; cara menyusunnya mengikuti ruang.

## 7. Cara memastikan konsistensi

### Saat mengubah satu menu

- Catat pattern yang dipakai, misalnya List + Detail + Create/edit form.
- Cari menu lain dengan pekerjaan yang sama, kemudian gunakan primitive yang sama.
- Perubahan visual bersama dilakukan di component/token pemiliknya, bukan dengan override pada setiap screen.
- Variasi domain dibatasi pada body dan renderer data; tuliskan alasan jika mengubah struktur atau perilaku.
- Jika kebutuhan variasi muncul di menu kedua, pertimbangkan mempromosikannya menjadi primitive/pattern bersama.

### Saat mengubah primitive bersama

Periksa dampaknya pada setidaknya satu list, detail, form, dan keluarga khusus yang memakai primitive tersebut. Sertakan desktop, tablet, dan mobile. Periksa loading, empty, error, pending, disabled, dan nested sheet jika relevan.

### Pemeriksaan otomatis dan visual

`npm run design-lint` memeriksa sebagian foundation: font literal, warna literal, weight, dan overlay. `npm run build`/`typecheck` memeriksa integrasi. Keduanya tidak membuktikan layout rapi. Review browser diperlukan untuk alignment, wrapping, urutan blok, hierarchy, dan kemampuan mencapai konten terakhir.

Checklist review:

- Pattern paling dekat sudah digunakan; variasi punya alasan kerja yang jelas.
- Judul, toolbar, data, dan footer mengikuti urutan pattern.
- Label/action semantics sama dengan menu sekeluarga.
- Aksi utama filled biru, aksi pendukung ghost netral, dan Cancel merah.
- Teks minimum 14 px; tidak ada overflow pada ruang sempit.
- Header/body/footer sejajar dan radius bersih.
- State dan perilaku keyboard/close mengikuti primitive bersama.

## 8. Status adopsi

Pedoman ini adalah keputusan desain terbaru, **belum berarti seluruh menu sudah dimigrasikan**. Pondasi bersama sudah ada, tetapi pemeriksaan 14 Oktober 2026 menemukan aturan legacy yang berbeda:

- `PATTERN.md` sebelumnya menyebut satu CTA hitam dan control berbentuk pill.
- `button-style.ts` dan `white.css` masih perlu diperiksa bersama agar ghost mengikuti warna netral dan primary dipakai sesuai peran aksi.
- `SheetFooter` masih menggambar Cancel sebagai quiet.
- Heading dari component dan override look belum selalu memakai skala yang sama.
- `design-lint` saat diperiksa menghasilkan 60 temuan. Sebagian berasal dari dokumen cetak dan perlu ditriase sebelum dianggap pelanggaran UI.

Migrasi dilakukan per primitive dan keluarga pattern. Jangan menandai suatu keluarga selesai hanya karena pedomannya sudah tertulis. Bukti selesai adalah pemakaian komponen bersama, hasil check yang relevan, dan review tampilannya.

## Object exploration, search, AI, and notifications

- Remove the decorative C logo from the prototype rail. Keep expand/collapse arrows at the top.
- Global search lives in the outer rail and opens a centered dialog, also reachable with ⌘K/Ctrl+K. Do not keep a banner above the working surface. Search covers navigation across modules and available records; live integration must respect access and use a shared backend index. The prototype indexes 264 route declarations plus fictional records; unimplemented menus show route information.
- Objects with useful detail are interactive: article name opens article detail, thumbnail opens photo preview, SKU opens variant detail, related supplier opens supplier detail, and stock code opens allocation breakdown. Give every interaction a label and focus/hover state. Plain metadata does not need an artificial click action.
- Exploration can continue through related objects. Breadcrumbs and Close/Escape return to an earlier layer, preserving input, scroll, and allocation state. Reopening an object already in the path returns to that layer rather than creating a duplicate stack. Only the front sheet is interactive.
- Ask AI is highlighted with a soft violet navigation state in the outer rail. The desktop prototype uses a contextual companion panel; mobile uses a full-screen panel. Suggestions contain related clickable records and an explicit Apply to draft action; they never submit an allotment themselves. Current assistance is a deterministic demo, not a connected AI model.
- Use Number Flow for changing Allocated and Remaining totals, with tabular numbers, short timing, and reduced-motion support. Keep IDs, timestamps, table prices, and editable numbers stable. The prototype vendors number-flow 0.6.2 and esm-env 1.2.2.
- Messages, profile, and Logout live at the bottom of the outer rail. Their prototype interactions use fictional data and do not affect production authentication.
- Pending notifications use a strong red circular/pill badge with a white number, minimum 14 px text, hidden for zero and capped visually at 99+. Apply to page navigation and Messages using their pending counts; a department in the rail shows a red dot instead (the number is in its panel, 15 Oct). On the selected screen row (solid blue #2563eb, white text) the count stays red with a white ring — a notification never takes the selection colour. Active record totals are not automatically notifications.

### AI chat anatomy and tool transitions

AI uses a fixed header, scrollable conversation log, and a fixed composer at the bottom. Enter sends, Shift+Enter adds a line. Keep a per-page conversation while opening/closing the panel. Suggestions become chat responses with related records and explicit draft actions. Global search and AI are mutually exclusive: opening AI from search closes the search dialog first; opening search closes AI. Panel motion is interruptible WAAPI on transform/opacity, 240 ms in and 180 ms out with the shared drawer curve. Keyboard/reduced-motion changes are immediate. Mobile AI traps focus and makes background content inert.

## Finance uses one format with different bodies

Finance prototypes share the existing shell, type scale, action roles, backdrop, focus/keyboard handling, nested record paths, search, AI entry point, and responsive foundations. They do not introduce a second design system.

| Work | Reuse | Finance-specific body |
| --- | --- | --- |
| Purchase invoices | List → detail → form sheet | Due/outstanding figures; invoice items; payment records; a payment form capped by the outstanding balance |
| Journal entry | List + composer/detail sheet | Posting date and business unit; account/category lines; debit/credit totals and difference; block unbalanced, negative, fractional, dual-sided, or uncategorised income/expense rows |
| Bank reconciliation | Workspace + detail sheet | Statement and ledger views; inspect unique signed-amount/date candidates; explicitly confirm a match |
| Profit & Loss | Report pattern | Period filters before summary; account hierarchy; comparison columns; account → ledger → journal drill-down |
| Overview | Dashboard/task pattern | Actionable pending work, cash/expense figures, and links to the relevant workflow |

Posted journal entries are read-only in the prototype. Reports do not inherit transaction-list tabs or a submit footer simply to look alike. Financial table values remain aligned and tabular; desktop entry rows become labelled editing cards on mobile, while comparison reports may scroll horizontally inside their table container. Wide nested composers use the shared workspace width.

This is a demo of representative Finance patterns. It does not implement approvals, posting periods, tax/FX treatment, bank connections, or production accounting. The entire Finance module has not been migrated.

## Marketing keeps comparison work in a matrix

Marketing reuses the shared shell, sheet structure, typography, action roles, nested exploration, and responsive foundations. Pricelist uses an article/SKU × store matrix rather than a one-record-at-a-time list: company and store prices remain visible together on desktop, with expandable variants and clickable price sources. Compact the inner sidebar for this wide workspace; keep manual expansion available. On mobile, compare company price with a selected store without shrinking text below the shared minimum.

Changes and History use transaction lists with detail sheets. Regular, Markdown, Clearance, and Correction are price-change kinds, not separate navigation menus. Promotions hold discount rules and optional coupon gates; Campaigns hold objectives, budgets, and planned allocations. Vouchers hold monetary balances and spending records, separate from promotion discounts. Overview links to actionable work. These bodies differ while their surrounding structure stays consistent.

The standalone Marketing prototype contains fictional session-local state. Price overrides currently apply at article level to all variants; live SKU-specific pricing, approvals, actual campaign outcomes, voucher transactions, and API integration are not implemented. This is pattern exploration, not migration of the entire live Marketing module.
