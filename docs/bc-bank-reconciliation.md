# Business Central — bank reconciliation: layarnya, dan rencana agar kita punya

**Status:** rujukan + rencana. Diminta pemilik 21 September 2026 ("saya sangat
suka UX-nya"). Melanjutkan kebiasaan [`./erpnext-banking.md`](./erpnext-banking.md):
baca ERP lain sampai ke nama field, lalu bandingkan dengan apa yang sudah kita
punya, baru rencanakan.

Sumber, dibaca 21 September 2026:

* `learn.microsoft.com/.../bank-reconciliation-dynamics-365-business-central/`
  unit `1-manually`, `2-post`, `3-import`, `3a-undo`, `reconcile` (Copilot);
* tangkapan layar **Bank Acc. Reconciliation — CHECKING · 24** yang pemilik
  kirim. Angka di footer di bawah dihitung ulang dari gambar itu, bukan ditebak.
* **Videonya tidak dibaca.** Unit `reconcile` menutup dengan embed stream; isinya
  demo, dan halaman teksnya sudah menyebut kedua kemampuan Copilot. Kalau ada
  langkah yang hanya muncul di video, ia belum masuk dokumen ini.

Model kita: [`./finance.md`](./finance.md), migrasi 0071/0095/0116/0142/0155/
0213/0214/0245/0271/0272. Pipeline dokumen: [`../PO-IMPORT-DOCJEV-PLAN.md`](../PO-IMPORT-DOCJEV-PLAN.md)
§9 — bank rekonsiliasi adalah tahap **D2** di sana, dan dokumen ini adalah
isinya.

---

## 1. Anatomi layar itu, field demi field

Satu halaman, bukan satu daftar plus satu sheet. Tiga lapis:

**General (kepala).** Kiri: `Bank Account No.` (CHECKING), `Statement No.` (24),
`Statement Date` (1/31/2025). Kanan: `Balance Last Statement` (0.00) — saldo
akhir statement terakhir yang **sudah di-post** untuk rekening itu, diambil dari
Bank Account Card, bukan diketik; dan `Statement Ending Balance` (11.573,18) —
saldo akhir yang tertulis di kertas bank.

**Dua panel berdampingan.** Ini inti UX-nya, dan yang paling tidak kita punya.

| Kiri — Bank Statement Lines | Kanan — Bank Account Ledger Entries |
|---|---|
| Transaction Date, Description, **Statement Amount**, **Applied Amount**, **Difference** | **App…** (kotak centang Applied), Posting Date, Document Type, Document No., Description, Amount, Remaining Amount |
| kata bank | buku kita |

Baris yang cocok berubah hijau dan `Applied` tercentang di kedua sisi.

**Footer, dan aritmetikanya** (diverifikasi dari gambar):

| Angka | Nilai di gambar | Rumusnya |
|---|---|---|
| Total Balance (kiri) | 11.573,18 | Σ Statement Amount = 1.780,49 + 2.670,73 + 7.121,96 ✔ |
| Total Difference (kiri) | 11.573,18 | Σ (Statement Amount − Applied Amount); nol yang diterapkan, jadi sama dengan di atas ✔ |
| Balance To Reconcile (kanan) | 11.573,18 | Statement Ending Balance − Balance Last Statement ✔ |
| Total on Outstanding (kanan) | 0,00 | cek/setoran kita yang belum muncul di bank |
| Balance (kanan) | 36.737,20 | saldo buku rekening itu |
| Balance (kiri) | 1.780,49 | saldo berjalan di baris kursor — **ini dugaan**, satu-satunya angka yang tidak bisa saya buktikan dari gambar |

**Pita perintah:** `Transfer to General Journal…`, `Suggest Lines…`, `Post`;
tab `Home / Bank / Matching / Show`; dan tombol `Reconcile` (Copilot) di kanan
atas.

## 2. Lima perbuatan, dan aturannya

1. **Isi baris.** `Suggest Lines` (tanggal awal–akhir) menarik baris dari *bank
   account ledger entries* kita sendiri — dipakai kalau tak ada file. Kalau ada
   file: `Bank > Import Bank Statement`, format ditentukan di field
   `Bank Statement Import Format` pada kartu rekening (SEPA CAMT, Yodlee, dst).
2. **Cocokkan.** `Matching > Match Automatically` membuka dialog dengan satu
   parameter: **Transaction Date Tolerance (Days)** — 0/kosong berarti hanya
   tanggal posting yang sama persis. Yang cocok jadi hijau. `Matching > Remove
   Match` melepas.
3. **Buang yang bukan milik statement.** Cek yang belum dicairkan dan setoran
   yang belum masuk dihapus dari baris statement; aplikasinya lepas sendiri dan
   entri itu muncul lagi di rekonsiliasi berikutnya.
4. **Tambah yang cuma bank yang tahu** (biaya admin, bunga): baris baru ->
   `Transfer to General Journal` -> pilih template/batch -> post -> entri bank
   baru otomatis ikut dan ter-apply.
5. **Post.** Syarat: `Total Difference` = 0, **atau** sama dengan jumlah baris
   bertipe `Difference`. Ada `Posting > Test Report` untuk pratinjau. Hasilnya
   satu **Bank Account Statement** yang diposkan, tampil di kartu rekening;
   `Undo` mengembalikannya jadi rekonsiliasi terbuka, dengan nomor baru —
   `Change Statement No.` kalau mau nomor lama.

**Copilot** (unit `reconcile`) menambah dua hal saja: pencocokan AI untuk sisa
yang tidak dimenangkan aturan, dan usulan akun G/L untuk baris sisa, dengan opsi
**mengingat narasi itu** untuk rekonsiliasi berikutnya.

## 3. Yang sudah kita punya (dicek di kode, 21 September 2026)

| Kemampuan BC | Punya kita | Di mana |
|---|---|---|
| Statement + baris, anti-dobel | ✔ lebih kuat: fingerprint per rekening, dan re-upload **menggantikan** (0245) | `0071`, `0245` |
| Pencocokan otomatis | ✔ lebih kuat: amount-anchored, penugasan global, hanya pemenang tunggal yang auto, **setiap alasan ditulis sebagai kalimat** | `domain/bank_match.rs`, `postgres/banking.rs:841` |
| Terapkan / lepas | ✔ `POST/DELETE /finance/bank-lines/{id}/match`, satu baris bisa dipecah ke beberapa voucher (0213) | `banking.rs:1130`, `:1182` |
| Transfer to General Journal | ✔ **lebih baik**: `POST /finance/bank-lines/{id}/book` menulis satu entri bersumber `BANK_STATEMENT` + match-nya dalam satu transaksi, jadi tak ada celah dua-langkah (0095) | `banking.rs:1599` |
| Copilot "ingat narasi ini" | ✔ **sudah ada tanpa AI**: `bank_rule` -> `bank_rule_proposal`, aturan mengusulkan, manusia menerima (0116) | `0116`, `http/money.rs:174-230` |
| Import file | ~ setengah: gateway IMAP + folder pantau, CSV/XLSX/PDF-teks lewat **mapping tersimpan per sumber** (0142) | `cloud/intake/` |
| Layar rekonsiliasi | ~ satu sheet daftar-vertikal (`Still to agree` / `Agreed`) dan satu lab bentuk-ERPNext | `screens/finance/bank.tsx:785`, `finance-lab-2/bank-reconciliation.tsx` |
| Dua panel berdampingan | ✘ | — |
| Statement No. / Balance Last Statement | ✘ | — |
| Total Difference / Balance To Reconcile / Total on Outstanding | ✘ (hanya `difference_minor` di ringkasan uang) | `postgres/statements.rs:811` |
| Match Automatically sebagai satu aksi + toleransi hari | ✘ (jendela terkunci di `Ruleset::default`) | `bank_match.rs` |
| Baris bertipe `Difference` | ✘ | — |
| Post / Undo rekonsiliasi | ✘ | — |
| Upload file dari layar rekonsiliasi | ✘ — hari ini **tempel teks** ke textarea | `bank.tsx:1259` |
| OCR untuk rekening koran hasil scan | ✘ | `intake/pdf.rs` cuma regex atas text layer |

Ringkasnya: **mesinnya kita lebih baik dari BC, permukaannya jauh lebih miskin.**
Yang diminta pemilik adalah permukaannya.

## 4. Empat ketegangan, dan keputusannya

**(a) "Post" yang tidak mem-posting apa pun.** 0071 menyatakan dengan huruf
besar bahwa rekonsiliasi **tidak menulis jurnal** — mencocokkan berarti kita
sudah membukukan, bank baru mengonfirmasi. BC "post" karena di sana
rekonsiliasi memang tempat orang membukukan biaya bank. Kita tidak akan
mengubah itu: baris yang cuma bank yang tahu tetap dibukukan lewat `book`
(0095) atau proposal (0116), satu per satu, dengan dokumen di belakangnya.
**Maka `Post` kita bernama `Tutup statement`**: ia membekukan statement —
totalnya, selisih yang diterima beserta alasannya, siapa dan kapan — dan
menghasilkan objek yang persis sama gunanya dengan Bank Account Statement BC
(bukti untuk auditor, dasar `Balance Last Statement` berikutnya), tanpa
menciptakan satu entri pun. `Undo` membukanya kembali.

**(b) `Suggest Lines` dibalik.** Di BC aksi itu mengisi panel **kiri** dari buku
kita — masuk akal kalau tidak ada file. Bagi kita panel kiri adalah kata bank
dan hanya bank; mengisinya dari buku sendiri membuat rekonsiliasi memeriksa
dirinya sendiri. Jadi aksi bernama sama mengisi panel **kanan**: entri buku yang
masih terbuka pada rekening itu di jendela tanggalnya. Itulah yang sebenarnya
hilang dari layar kita.

**(c) Copilot -> Jev, dan batasnya.** `docs/jev-cross-domain-roadmap.md` §8:
Jev read-only, isi dokumen = data bukan instruksi, keputusan uang tetap
deterministik. Jadi Jev boleh **mengusulkan** pasangan untuk sisa yang tidak
dimenangkan matcher, dan **mengusulkan** akun untuk baris yang akan dibukukan,
lalu menawarkan menyimpan narasi itu sebagai `bank_rule` — yang persis fitur
"remember" Copilot, dan pintunya sudah ada sejak 0116. Jev **tidak pernah**
menetapkan match, tidak pernah mem-posting, tidak pernah menutup statement.

**(d) Baris `Difference`.** Kita butuh ini — tanpanya sebuah statement dengan
satu angka salah dari bank tak pernah bisa ditutup. Bentuknya: penanda pada
baris (bukan tipe baris baru) plus **alasan wajib**, sehingga `Total Difference`
boleh bukan nol asal setiap rupiahnya punya kalimat.

## 5. Rencana — enam tahap, masing-masing bisa dikirim sendirian

### R0 — papan kerja dua panel (nilai terbesar, perubahan skema nol)
* Layar baru `/finance/rekonsiliasi/:statementId`: kepala (rekening, periode,
  saldo awal/akhir), dua panel, footer total, pita aksi. Bentuk visual mengikuti
  gambar; komponen dari `components/ui` yang sudah ada.
* Satu tambahan backend: `GET /api/v1/finance/bank-statements/{id}/ledger-entries`
  — entri buku pada rekening itu di jendela periode ± toleransi, dengan status
  `applied` dan sisa. Sumbernya `candidates_for` yang sudah ada di
  `banking.rs`, cuma belum punya pintu.
* Cocokkan manual = pilih satu di kiri, satu di kanan, tekan `Terapkan` ->
  `POST /finance/bank-lines/{id}/match` yang sudah ada.
* Footer: `Total Balance` = Σ baris; `Total Difference` = Σ `unallocated_minor`;
  `Balance To Reconcile` = `closing_minor − balance_last_statement` (tahap ini:
  `opening_minor`); `Total on Outstanding` = Σ entri buku yang tak ter-apply.
* **Terima bila**: statement lama mana pun bisa direkonsiliasi penuh dari layar
  ini tanpa membuka sheet lama; keempat angka footer cocok dengan hitungan
  tangan atas data seed.

### R1 — aksi pencocokan
* `POST /finance/bank-statements/{id}/match-auto` dengan
  `date_tolerance_days` (default 3, yaitu `Ruleset::default`), mengembalikan apa
  yang dicocokkan beserta alasannya; satu transaksi, tetap memakai penugasan
  global — jadi seri tak bisa auto, sama seperti sekarang.
* `POST /finance/bank-statements/{id}/unmatch` untuk melepas terpilih/semua.
* Baris ter-apply diwarnai di kedua panel; alasan tampil sebagai kalimat
  (matcher sudah mengembalikannya — lab-2 sudah membuktikan ini enak dibaca).
* **Terima bila**: statement 18 baris tercocokkan dalam satu klik; menaikkan
  toleransi dari 0 ke 3 menambah pasangan dan tidak pernah mengurangi;
  melepas lalu mengulang menghasilkan hasil identik (order independence).

### R2 — identitas statement dan penutupan
* Migrasi: `statement_no` (unik per `bank_account_id`), `status` OPEN/CLOSED,
  `closed_by`/`closed_at`, `accepted_difference_minor`.
  `balance_last_statement` **diturunkan** dari statement CLOSED sebelumnya pada
  rekening yang sama — satu sumber, tak bisa melenceng seperti field di kartu
  rekening BC yang harus dibetulkan tangan setelah Undo.
* `POST .../close` menolak bila `Total Difference` ≠ jumlah selisih yang
  diterima; `POST .../reopen` = Undo BC; `GET .../close-preview` = Test Report.
* Kontrol baru yang BC tak punya: bila `opening_minor` yang diimpor ≠
  `balance_last_statement` turunan, layar mengatakannya. Itu justru bulan yang
  hilang.
* **Terima bila**: menutup lalu membuka kembali mengembalikan tepat keadaan
  sebelumnya; statement CLOSED menolak match baru; nomor berurut per rekening.

### R3 — baris selisih
* Penanda `difference` + alasan wajib pada baris, masuk hitungan footer, ikut
  dibekukan saat penutupan dan tercetak di preview.
* **Terima bila**: statement dengan satu angka salah dari bank bisa ditutup, dan
  dokumen penutupan menyebut selisih itu beserta alasannya.

### R4 — dokumen masuk: DocJev + LiteParse (yang pemilik minta)
Ini tahap D2 di `PO-IMPORT-DOCJEV-PLAN.md` §9.3, dan **kernelnya sudah ada**:
`cloud/intake/po/` sudah punya tangga OCR (OpenParser -> `litparse` lokal,
`ocr.rs:211`), mode degraded yang jujur, dan pembungkus UNTRUSTED.

Yang ditambahkan, sekecil mungkin:

1. **Unggah dari papan kerja** — route multipart
   `POST /api/v1/finance/bank-statements/import-file` -> pratinjau baris ->
   tombol impor. Menggantikan textarea tempel (`bank.tsx:1259`) yang hari ini
   satu-satunya jalan manual.
2. **Classify (pola DocJev)** — satu pertanyaan `Choice` per berkas:
   `rekening_koran / laporan_settlement / faktur / lainnya`. Yang bukan rekening
   koran ditolak dengan alasan, bukan dijadikan baris sampah.
3. **Split (pola DocJev)** — `category_N` + `boundary_N` per halaman, ambang 0,5;
   satu PDF berisi dua rekening atau dua bulan menjadi dua draft statement.
   Butuh teks **per halaman**: `litparse` hari ini dipanggil per berkas
   (`ocr.rs:211`), jadi tambahkan mode per halaman atau `pdftotext -f/-l`.
   Diputuskan saat R4 dikerjakan, sama seperti catatan B3 di plan PO.
4. **Scan tak butuh parser baru.** Ini kuncinya: mapping regex per sumber
   (`intake/parse.rs`, `intake/pdf.rs`) tetap kontraknya — OCR hanya *memasok
   teks* ke mapping yang sama. Jadi rekening koran hasil scan menempuh jalur
   yang sudah diuji, bukan jalur kedua.
5. **Rekening dikenali dari dokumennya.** Hari ini pemetaan berkas -> rekening
   berasal dari aturan pengirim (0142). Statement mencetak nomor rekeningnya
   sendiri; cocokkan ke `company_bank_account`, dan aturan pengirim tinggal
   menjadi cadangan.
* Tanpa key: classify/split dilewati, berkas dianggap satu rekening koran,
  scan gagal jujur — persis perilaku hari ini. Banner kesehatan mengatakannya.
* **Terima bila**: satu PDF hasil scan menjadi baris yang benar; satu PDF berisi
  dua rekening menjadi dua draft; faktur yang salah unggah ditolak dengan
  alasan; tanpa key semua bentuk keluaran tak berubah.

### R5 — asisten (setara Copilot, dengan batas §4c)
* Usulan Jev untuk sisa yang tidak dimenangkan matcher — ditandai sebagai
  usulan, alasannya kalimat, penerimaan tetap klik manusia.
* Usulan akun saat membukukan baris, dengan tawaran "ingat narasi ini" yang
  menulis `bank_rule` (0116) — bukan mekanisme baru.
* **Terima bila**: mematikan key mengembalikan layar ke R0–R4 tanpa lubang; tak
  ada jalur di mana usulan Jev menulis match atau jurnal.

## 6. Urutan, dan alasannya

R0 lebih dulu karena ia satu-satunya tahap yang **tidak menyentuh skema** dan
justru yang paling dirasakan: mesin kita sudah lebih pintar dari BC, orangnya
saja yang belum pernah melihatnya. R1 membuat papan itu cepat. R2 membuatnya
bisa ditutup, yang syaratnya baru masuk akal setelah footer benar. R3 kecil dan
menempel pada R2. R4 adalah yang pemilik minta secara eksplisit dan nilainya
besar, tetapi ia bergantung pada papan yang sudah ada tempat hasil unggahan
diperlihatkan; mengerjakannya lebih dulu berarti mengunggah ke layar lama. R5
paling akhir karena ia satu-satunya yang tidak berguna bila yang di bawahnya
belum benar.

## 7. Risiko

* **`litparse` per halaman belum terbukti.** Split bergantung padanya. Mitigasi
  sudah disebut (poppler), keputusannya ditunda sampai R4 — sama seperti B3.
* **Probabilitas Jev tidak terkalibrasi** (DocJev sendiri mengatakannya). 0,5 dan
  0,7 adalah kebijakan awal, bukan kebenaran.
* **Lisensi**: DocJev Apache-2.0. Kita mengambil logika keputusannya, bukan
  paketnya; satu baris NOTICE untuk desain boundary/ambangnya.
* **Statement CLOSED dan supersede (0245) harus sepakat**: mengganti statement
  yang sudah ditutup harus menolak, bukan diam-diam menggeser.
* **Dua layar lab (`finance-lab-2`) tidak dihapus oleh rencana ini.** Papan R0
  adalah bentuk ketiga; keputusan mana yang menang diambil setelah R1 dipakai
  sebulan, bukan sekarang.

---

## 8. Spec eksternal (21 September 2026) — apa yang diambil, apa yang tidak

Pemilik mengirim satu spesifikasi panjang (35 bagian) untuk modul ini. Di bawah
penilaiannya terhadap kode, bukan terhadap ingatan. Setiap baris "sudah punya"
menyebut buktinya.

### 8.1 Diambil — delapan hal yang rencana ini memang kurang

**(1) Volume: halaman, penghitung, dan saringan.** Ini temuan paling nyata.
`statement_lines` (`banking.rs:677`) mengembalikan **semua** baris tanpa
paginasi, dan `suggest_matches` (`:841`) menilai setiap baris terbuka terhadap
seluruh jendela kandidat di memori — O(baris × kandidat). Untuk statement 100
baris tak terasa; untuk 10.000 ia mati. Maka R0/R1 mendapat: paginasi sisi
server, penghitung status (`Belum cocok / Usulan / Bank saja / Buku menggantung
/ Perlu perhatian`), dan saringan atas penghitung itu.
**Tetapi angka 10.000 di spec itu asumsi, bukan data kita.** Ukur dulu statement
terbesar yang benar-benar diterima klien; rancang supaya tidak roboh, jangan
bangun mesin untuk beban yang belum pernah ada.

**(2) Daur hidup sisi buku: POSTED -> CLEARED -> RECONCILED.** Hari ini sebuah
baris jurnal hanya "punya match atau tidak". Tiga keadaan itu memberi panel
kanan arti yang sebenarnya, dan RECONCILED baru ada setelah R2 (penutupan).
Diambil ke R2.

**(3) Buku menggantung + umurnya.** BKK terbit 30 Sep, banknya baru bergerak
2 Okt — itu bukan kesalahan, itu jarak waktu. Rencana R0 hanya menyebut
`Total on Outstanding` sebagai angka; spec menjadikannya daftar dengan umur
(0–3 / 4–7 / 8–30 / >30 hari, ambangnya konfigurasi). Diambil ke R0 (daftarnya)
dan R2 (umurnya ikut dibekukan saat penutupan).

**(4) Pencocok transfer internal.** BCA −100jt dan Mandiri +100jt adalah satu
peristiwa yang muncul di **dua statement**. Matcher kita hanya melihat satu
rekening; bukti transfer (dua rekening milik sendiri, arah berlawanan, jumlah
sama, tanggal berdekatan) tidak pernah dipakai. Tidak ada di kode. Diambil.

**(5) Settlement EDC dengan MDR — dan ini setengah terbangun.** `0135` sudah
menyimpan `gross_minor`, `mdr_minor`, `net_minor`, `expected_net_minor`, dan
`difference_minor` dengan komentar yang menyebut angka ketiga itu ada "once the
bank statement has had its say". `0144` sudah membuat settlement sebagai
alokasi many-to-many. Tapi `banking.rs` **tidak menyebut settlement satu kali
pun**: jembatannya dirancang, tidak pernah dipasang. Aritmetikanya
deterministik (bruto − MDR = setoran bersih) dan Jev tidak menyentuhnya —
tugas Jev paling jauh mengenali narasi "EDC SETTLEMENT BCA…" sebagai keluarga
transaksi. Diambil, dan ini kandidat terkuat untuk naik antrean.

**(6) Exclude dengan alasan wajib.** Baris ganda hasil impor, baris sampah dari
parser. Harus tetap terlihat dan teraudit, dan **tidak boleh** jadi cara
memaksa selisih jadi nol. Diambil ke R3, bersama baris `Difference`.

**(7) Bukti pencocokan yang terstruktur.** Matcher kita sudah mengembalikan
alasan sebagai kalimat — itu justru yang spec minta di §18 ("jangan tampilkan
`confidence 0.934729`"). Yang belum: bentuk terstruktur di belakang kalimat itu
(`amount: EXACT | WITHIN_TOLERANCE | DIFFERENT`, `reference: EXACT | PARTIAL |
NONE`, `date_difference_days`, `counterparty: EXACT | ALIAS | SIMILAR | NONE`),
yang membuat kolom bukti bisa diurutkan dan disaring. Murah. Diambil ke R1.

**(8) Jejak keputusan Jev dan daftar alias lawan transaksi.** Simpan model,
versi, himpunan kandidat, pilihan, dan apakah manusia menerimanya — tanpa itu
mustahil menilai apakah Jev membantu. Dan "PT.CENTRAL / CENTRAL JKT / PT CENTRAL
IND" pantas jadi tabel alias yang diisi manusia sekali, bukan tebakan berulang.
Keduanya ke R5.

Ditambah satu hal kecil dari §30 yang benar dan mudah: panel kanan harus
menampilkan **dokumennya** (BKM-00182, BKK-00192), bukan hanya nomor entri
jurnal. `journal_entry` sudah membawa `source_kind` + `source_id` sejak 0051/0095,
jadi ini pekerjaan tampilan, bukan skema.

### 8.2 Sudah punya — dan beberapa lebih baik dari yang diminta

| Permintaan spec | Keadaan kita |
|---|---|
| "Cocokkan ke transaksi, jangan ke 144 akun COA" | Sudah sejak 0071: kandidat adalah `journal_line` pada rekening bank itu (`banking.rs:772`). COA baru muncul saat membukukan baris yang bank saja tahu. |
| "Upload statement tidak boleh membuat jurnal" | Aturan tertulis 0071, dan diuji. |
| "Record & Match lewat posting engine biasa" | `book_bank_line` (0095) menulis satu entri bersumber `BANK_STATEMENT` + match-nya dalam satu transaksi — lebih rapat dari dua langkah yang spec bayangkan. |
| "Jangan `bank_transaction.payment_entry_id`; pakai relasi alokasi" | Sudah: `bank_line_match.allocated_minor` (0213), satu baris bank bisa melunasi banyak voucher. |
| "Adapter impor jangan dipaku ke logika bisnis" | Sudah lebih baik: bentuk berkas adalah **mapping tersimpan per sumber** (0142), bukan enum format di kartu rekening seperti BC. |
| "Audit trail" | `audit_log` (0078) mencatat aktor/method/path untuk setiap permintaan; `bank_line_match` membawa `decided_by_kind`, `matched_by`, `matched_at`, `reasons`. |
| "Model permission terpisah jangan dibuat baru" | Setuju, dan tidak perlu: setiap route sudah membawa perannya (Admin/Supervisor). |
| "Jev jangan mengerjakan aritmetika/posting" | Sudah jadi aturan tertulis di §4c dan di roadmap §8. |

### 8.3 Tidak berlaku untuk kita

* **Mata uang.** `journal_line` (0051) tidak punya kolom mata uang; buku besar
  ini satu mata uang. Penjaga `currency: MATCH / MISMATCH` akan menjaga kasus
  yang tidak bisa terjadi.
* **`company_id` / legal entity.** Tidak ada kolom itu di mana pun; dimensinya
  `site_id`. Jangan menambah sumbu organisasi demi menyamai template.
* **Objek `BankReconciliation` baru di samping statement.** `bank_statement`
  sudah wadahnya, lengkap dengan aturan supersede (0245). Dua kepala untuk satu
  bulan berarti dua kebenaran.
* **`BankMatchGroup` dan many-to-many penuh.** Arah "satu baris bank -> banyak
  voucher" sudah ada. Arah sebaliknya **sengaja ditolak**: `UNIQUE
  (journal_line_id)` bertahan di 0213 dengan alasan yang masih benar — satu
  baris jurnal dilunasi dua kali adalah uang dihitung dua kali. *Pertanyaan
  terbuka, bukan perbaikan*: setoran borongan yang bank laporkan sebagai
  beberapa kredit atas satu baris buku. Cek dulu ke data nyata; kalau memang
  ada, ia layak migrasinya sendiri dengan argumennya sendiri.
* **"Fase 1: tulis BANK-RECON-AUDIT.md, jangan koding."** Auditnya adalah §3
  dokumen ini dan sudah selesai. Yang memang belum ditelusuri dan seharusnya
  — sebelum R4 — adalah **keluarga dokumen yang menjadi sasaran pencocokan**:
  BKM/BKK (`cash_document`, 0115), instruksi pembayaran (0153), transfer,
  settlement (0135/0144). Itu perluasan §3, bukan dokumen kedua.
* **Tombol "Reconcile with Jev".** Namanya menjanjikan perbuatan yang tidak
  boleh Jev lakukan. Namanya: *Usulkan pasangan*.

### 8.4 Akibatnya pada rencana §5

* **R0** bertambah: paginasi sisi server, penghitung status, saringan, daftar
  buku menggantung, dan nama dokumen di panel kanan.
* **R1** bertambah: bukti terstruktur di balik kalimat alasan.
* **R2** bertambah: keadaan CLEARED/RECONCILED dan umur menggantung yang ikut
  dibekukan.
* **R3** bertambah: `Exclude` beralasan, bersama baris `Difference`.
* **R5** bertambah: jejak keputusan Jev dan tabel alias lawan transaksi.
* **R6 baru — dua pencocokan khusus**: transfer internal antar rekening sendiri,
  dan settlement EDC (bruto − MDR = setoran bersih) yang menyambungkan `0135`
  ke statement. Boleh mendahului R3 kalau nyeri klien ada di situ; saya
  menduga begitu, karena jembatan 0135 sudah dirancang dan dibiarkan.
* **Daftar 30 kasus uji di §32 spec diambil apa adanya** sebagai daftar
  penerimaan, dikurangi nomor 30 (mata uang) dan disesuaikan nomor 27
  (konkurensi sudah dijawab oleh indeks unik, ujinya tetap ditulis).

---

---

---

## 9. Bentuk akhir setelah lima putaran prototipe (21 September 2026)

Lima bentuk dicoba dan dibuang. Yang bertahan jauh lebih kecil dari yang
dimulai, dan itu hasilnya, bukan komprominya.

### 9.1 Tiga keadaan, dua kata kerja

Mengikuti QuickBooks, bukan BC, karena BC menumpuk istilah yang tidak
menambah keputusan apa pun:

```
PENDING ──Match──> POSTED        Match  = hubungkan ke dokumen yang SUDAH ada
        ──Post───> POSTED        Post   = buat dokumen baru dari baris ini
        ──Exclude─> EXCLUDED     keduanya bisa di-Undo kembali ke PENDING
```

Yang sebelumnya kami sebut `Suggested`, `Bank only`, `Needs attention`,
`Books outstanding` **bukan keadaan** dan sebagian besarnya tidak dipakai sama
sekali. `Bank only` hanyalah "PENDING yang tidak punya pasangan di buku" —
itu bukan status, itu ketiadaan. `Books outstanding` dihapus dari layar ini:
dokumen yang belum muncul di bank adalah urusan penutupan, bukan urusan orang
yang sedang memproses baris bank.

Aturannya satu kalimat: **sudah ada di buku → Match. Belum ada → Post.**
Tidak ada `Review matches`, `Match selected`, `Match transfer`. Transfer adalah
jenis transaksi yang sedang dicocokkan, bukan jenis perbuatan.

Bagaimana sebuah baris sampai ke POSTED disimpan sebagai metadata
(`MATCHED_EXISTING`, `RECORDED`, `ADJUSTED_MATCH`, …) — jejak audit, bukan
mesin keadaan.

### 9.2 Tidak ada usulan. Orang yang memutuskan.

Usulan dibuang seluruhnya dari layar utama — dan itu justru yang menyembuhkan
kebingungan dua panel. Dua daftar sejajar membingungkan **karena ada usulan di
dalamnya** yang tidak bisa dinyatakan oleh bentuk itu. Tanpa usulan, dua panel
dengan kotak centang adalah bentuk yang tepat: meja kerja, bukan tebak-tebakan.
Kalau tidak cocok, ya tidak cocok.

(Matcher deterministik dan Jev tidak dibuang dari sistem — mereka keluar dari
layar ini. Kalau nanti dikembalikan, tempatnya adalah kolom terpisah yang bisa
dimatikan, bukan bentuk layarnya.)

### 9.3 Aturan yang menentukan seluruh tata letak

> **Kalau tidak match, tidak pernah sejajar.** Dan kebalikannya: kalau sejajar,
> berarti match — sekalipun tanggalnya sama.

Percobaan pertama menjamin ini dengan menggeser lajur kanan setengah tinggi
baris. Itu trik, dan tergantung pada semua baris bertinggi sama; begitu satu
baris membungkus dua baris teks, jaminannya bocor.

Bentuk yang dipakai menjaminnya **secara struktural**: satu tabel, dan di
Pending **setiap baris hanya terisi satu sisi** — baris bank, atau baris buku,
tidak pernah keduanya. Sisi yang lain digambar arsir abu-abu tanpa tulisan.
Maka dua hal yang belum dipasangkan tidak mungkin berhadapan, apa pun
tanggalnya, apa pun tinggi barisnya.

Konsekuensinya menyenangkan: **baris yang terisi dua sisi berarti sudah
dipasangkan**, dan kolom tengahnya tidak perlu menulis "MATCHED" — kesejajaran
itu sendiri yang mengatakannya. Di tab Posted, sisi yang lebih pendek memakai
`rowspan`, jadi 1↔N tetap satu kelompok yang rapi.

Dua strip sempit berarsir memisahkan ketiga zona, dan keduanya berisi aksi,
bukan keterangan:

| Strip | Isinya |
|---|---|
| antara bank dan buku | `Post` pada baris bank (buat dokumen baru dari baris itu); `Undo` pada baris yang sudah selesai |
| tepi kanan | `⋯` yang membuka sheet berisi **usulan** untuk baris itu — kandidat dari sisi seberang, lengkap dengan buktinya |

Usulan tidak pernah tampil di tabel. Ia ada, tetapi harus diminta — sehingga
tabel tetap menjadi catatan tentang apa yang benar-benar ada, bukan campuran
antara fakta dan tebakan.

### 9.4 Selisih tetap dihitung server, perlakuannya tetap dipilih orang

Bank 9.999.000 lawan kuitansi 10.000.000: kaki layar menyebut selisih 1.000 dan
menawarkan *Add an adjustment…*. Perlakuannya (biaya bank / MDR / pajak
dipotong / diskon / pembulatan / **pembayaran sebagian yang tidak membuat beban
apa pun**) dipilih orang, karena akibat akuntansinya berbeda-beda. Setelah
penyesuaian diposkan, kedua sisi berjumlah sama dan `Match` menyala.

### 9.5 Akibat untuk skema — tidak berubah, dan makin mendesak

N↔1 (dua baris bank melunasi satu dokumen) sekarang bisa dilakukan hanya dengan
mencentang dua baris di kiri — tidak ada perintah khusus yang menghalanginya di
UI. Yang menghalangi adalah database: `UNIQUE (journal_line_id)` di
`bank_line_match`. Gantinya tetap seperti §9 versi sebelumnya: batas
**jumlah alokasi ≤ nilai baris jurnal**, pola yang sudah dipakai 0213 untuk
arah sebaliknya. Prasyarat R0.

### 9.6 Post butuh akun, dan akunnya tidak boleh diketik bebas

`Post` tanpa akun bukan perbuatan. Maka baris bank yang tidak punya pasangan di
buku membawa **kolom pemilih akun** — autocomplete atas daun bagan akun klien,
dicari dengan kode, nama, atau apa peristiwanya — mengetik "bank charges"
menemukan `6010310004`. Kata bantu itu **ikut dicari tetapi tidak dicetak**;
daftarnya hanya menampilkan kode dan nama, karena keterangan di setiap baris
membuat daftar yang seharusnya dipindai jadi ramai. Tidak ada teks bebas: yang dipilih
selalu akun yang benar-benar ada, karena sebuah dokumen yang menunjuk akun
karangan adalah dokumen yang tidak bisa diposkan.

Prototipe punya dua bentuk, dan keduanya membaca data yang sama:

* **Dua tabel** — bank di kiri, buku di kanan, tiap baris satu sisi, centang
  dua sisi lalu `Match`. Untuk melihat keseimbangan dua dunia. Baris bank yang
  memang akan di-`Post` membawa pemilih akunnya **di sisi buku yang masih
  kosong** — tepat di tempat dokumen yang akan dibuat itu nanti mendarat. Itu
  sebuah formulir, bukan transaksi, jadi aturan §9.3 tetap utuh.
* **Satu tabel** (bentuk QuickBooks) — satu baris per baris bank, kolom
  *Match / categorise* berisi pemilih akun bila tidak ada pasangan, atau
  penanda usulan bila ada. Untuk memproses cepat.

**Koreksi yang perlu dicatat:** versi-versi awal prototipe menulis
`6010310001 Biaya Administrasi Bank`. Kode itu salah — di bagan klien
`6010310001` adalah **Biaya Kebersihan (Cleaning)**, dan satu-satunya akun
biaya bank yang ada adalah **`6010310004 Biaya Bank Head Office`**. Daftar
akun di prototipe sekarang dibaca dari basis data, bukan dari ingatan.

### 9.7 Auto match: hasilnya adalah kesejajaran, bukan lencana

`Auto match` tidak menggambar garis penghubung dan tidak menempelkan tulisan
"matched". Ia **memindahkan kedua sisi ke satu baris** — dan karena aturan §9.3
membuat kesejajaran mustahil terjadi secara kebetulan, satu baris yang tiba-tiba
terisi dua sisi sudah merupakan hasilnya. Di tengah baris itu ada **skor**.

| Bentuk | Yang berubah setelah Auto match |
|---|---|
| Dua tabel | Pasangan naik menjadi satu baris; sisi yang lebih pendek memakai `rowspan`; kolom tengah memuat skor dan `Remove`. Yang tidak tercocokkan tetap satu sisi. |
| Satu tabel | Kolom *Match / categorise* pada baris bank itu memuat dokumen pasangannya beserta skor; aksinya berubah menjadi `Remove`. |

**Skor adalah angka pengurut, bukan probabilitas.** DocJev sendiri mengatakan
probabilitasnya tidak terkalibrasi, dan matcher kita memberi 0–100 dari bobot
yang kita pilih sendiri. Maka warnanya hanya tiga tingkat — ≥90, 75–89, di
bawahnya — karena itulah sejauh mana angka yang tak terkalibrasi boleh
berpura-pura tahu. Di laci, skor selalu ditemani buktinya sebagai kalimat
(`Amount exact`, `Reference none`, `Date 1 day`), karena angka sendirian tidak
memberi tahu siapa pun *bidang mana* yang cocok.

**Yang sengaja TIDAK di-auto.** PT Central Abadi: bank membayar 9.999.000,
kuitansi 10.000.000, skor 78. Selisih 1.000 itu bisa biaya transfer, diskon,
atau pembayaran sebagian yang masih jadi piutang — akibat akuntansinya
berbeda-beda, jadi tidak boleh diputuskan diam-diam. Ia tetap di Pending dengan
penanda usulan; lacinya menerangkan *kenapa tidak dicocokkan untuk Anda*.

Yang auto-matched pun bukan keputusan akhir: `Remove` mengembalikannya ke dua
baris satu sisi, dan `Undo auto match` membatalkan seluruh jalannya. Sampai
statement ditutup, tidak ada yang mengeras.
