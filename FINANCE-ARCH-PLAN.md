# Finance Architecture Fix Plan — menyelesaikan adopsi ERPNext tanpa melepas disiplin sendiri

**Tanggal:** 22 September 2026. **Status:** usulan, menunggu persetujuan pemilik.
**Dasar:** riset audit 22 Sep (5 scout: ledger core, posting coverage, banking/giro,
AP/pajak/tutup buku, dokumen internal) + verifikasi langsung ke skema Postgres (DB dev
berhenti di migrasi **298**) + kode ERPNext `develop` (dipin via `docs/erpnext-money.md`
`0849f18` dan verifikasi ulang `general_ledger.py`, `gl_entry.json`).

**Tesis:** kita tidak salah meniru ERPNext. Bug dan lubang yang ada TIDAK berada di
bagian yang ditiru — melainkan (1) satu bug implementasi, (2) dua domain yang belum
dihubungkan ke pintu, (3) adopsi ERPNext yang berhenti setengah, (4) UI terpecah empat.
Rencana ini menyelesaikan keempatnya, lalu mengambil dari ERPNext sisa bagian yang
membuat sistemnya bisa dipakai akuntan harian.

---

## 0. Temuan yang jadi dasar (bukti di audit 22 Sep)

| # | Temuan | Bukti | Fase |
|---|---|---|---|
| H1 | Semua REVERSAL gagal runtime: bind baca `supplier_id` (kolom sudah jadi `party_type/party_id` per 0300), 13 bind untuk 14 placeholder | `poster.rs:663-737` | P0 |
| H2 | Endpoint alokasi Payment Ledger selalu gagal | `payment_allocation.rs:436-445` | P0 |
| H3 | Payroll tidak pernah posting; `payroll_payable` hanya didebit → saldo minus | `pay.rs` tanpa PostingIntent; `finance_control.rs:343-347` mengaku | P1 |
| H4 | Persediaan/COGS mati: consume/transfer/count tanpa pemanggil | `stock_ledger.rs:713,894,1053,1145` | P1 |
| H5 | Satu `bank_statement_line` bisa diklaim giro + booking kas + match sekaligus | `ux_giro_cleared_line` 0117 vs `ux_cash_document_statement_line` 0115 vs UNIQUE 0213, tak saling cek | P2 |
| M1 | Multi-currency diterima bebas, dijumlah buta di semua pembacaan | `journal_entry.currency` vs `ledger.rs:1928,2062` | P3 |
| M2 | Tiga jalur close tidak setuju; checklist di luar transaksi | `finance_control.rs:698` vs `period_close.rs:648` vs `ledger.rs:4071` | P2 |
| M3 | readiness `unwrap_or(0)` menelan error DB | `finance_control.rs:570-672` | P3 |
| M4 | `bank_key`/`cash_key` tanpa whitelist di 4 writer | `tax.rs:475`, `financing.rs:366`, `store_money.rs:3118,799` | P3 |
| — | DB dev tertinggal: kode bicara `party_type/party_id`, skema masih `supplier_id` | `_sqlx_migrations` max = 298 | P0 |
| — | 4 modul frontend finance hidup bersamaan (95 file, 2 pintu nav) | `navigation.ts:224-227,354-372` | P4 |

---

## 1. P0 — buku yang bisa mengoreksi diri (±1 hari, memblokir semua)

1. **Perbaiki `poster::reverse`.** SELECT sudah benar (`party_type, party_id`); perbaiki
   INSERT: bind 14 kolom berurutan — `party_type` dan `party_id` disalin dari baris asli
   (persis seperti `account_code`/`category_code`/`counter_site_id`: pembalikan membatalkan
   apa yang diposting, bukan apa yang aturan akan posting hari ini). Ubah dobel-reversal
   dari 500 menjadi 409 (`as_already_posted` pada INSERT header, tangkap 23505).
   **Uji:** reverse entri ber-party, ber-asset, ber-bank_account, ber-counter_site;
   keempat dimensi hadir identik di baris cermin; reverse kedua → 409.
2. **Migrasikan DB dev ke 310.** Kode dan skema sedang tidak sepakat; semua verifikasi
   berikut bergantung ini. Setelah migrasi: pastikan trigger `journal_line_names_its_party`
   terpasang (`0300`) dan `party_type` terisi 7 nilai registry.
3. **`settle_through_payment_ledger`: wire atau hapus.** Usul: **wire** — ini padanan
   Payment Reconciliation ERPNext dan pintu kerja harian AP. Kalau wire-nya menunggu
   P3 (PLE-in-intent), hapus route-nya dulu (`payments_lane.rs:239`); stub yang selalu
   menolak lebih buruk daripada tidak ada endpoint.

## 2. P1 — buku yang berkata benar (domain mati; ±1 minggu)

4. **COGS/persediaan.** Pintu dan writer sudah ada, tinggal dipanggil:
   `stock_ledger_consume` dipanggil dari SALE_DAY (atau COGS_DAY harian dari cost layer),
   `stock_ledger_record_transfer` dari allotment/dispatch lintas unit,
   `record_count` dari official count (selisih → `stock_loss`), `cost_layer_correct_price`
   dari price amendment. Valuasi: cost layer yang sudah dipakai `opening.rs:1025`.
   ERPNext meniru *hasilnya* (SLE→GL), bukan mekanismenya.
   **Uji:** jual 3 pcs ber-cost layer → entri COGS senilai 3×cost; opname minus 2 →
   `stock_loss` 2×cost; saldo akun persediaan = Σ cost layer on hand.
5. **Payroll posting.** Pola ERPNext Payroll Entry → 2 Journal Entry: satu `PAYROLL_RUN`
   per periode → entri akrual (Dr beban `pay_component`, Cr `payroll_payable` per
   komponen) + entri payout saat eksekusi (yang sekarang didebit sendirian).
   **Uji:** setelah run + payout, `payroll_payable` nol; beban muncul di P&L periode.
6. **Tagihan rutin (recurring bills) + standing instruction.** `bill_template`
   (lihat §6.2) + `run_bill_template_agent` menumbuhkan DRAFT bill bulanan;
   tagihan asli dicocokkan dalam toleransi, di luar toleransi masuk antrean varian.
   Lapis opsional: setelah post, payment instruction otomatis `REQUESTED` — approval
   tetap manusia. **Uji:** template listrik site-01 → 1 DRAFT bill per bulan, idempoten
   di-restart; bill asli Rp2,15 jt vs perkiraan Rp2,1 mt (toleransi 5%) → match siap;
   selisih 40% → antrean varian.

## 3. P2 — uang tidak terposting dua kali (±4 hari)

6. **Satu tabel klaim untuk `bank_statement_line`.** Tiga mekanisme (giro clear, booking
   dokumen kas, bank match) mengklaim line lewat kolomnya masing-mail. Bentuk: satu
   kolom `claimed_by` (atau tabel `bank_line_claim`) yang dicek ketiganya dalam satu
   transaksi + `giro_clear` memvalidasi statement line berasal dari bank/site giro.
   **Uji:** clear giro pada line yang sudah dibooking → ditolak menyebut pemilik klaim.
7. **Satu jalur close + PCV.** Hapus `ledger::close_period` lama; checklist masuk ke
   dalam transaksi close; `finance_close_month` dan `period_close` jadi satu fungsi
   (aturan: SOFT_CLOSED hanya boleh ditutup jalur yang membaca checklist).
   Tambah padanan **Period Closing Voucher**: dokumen yang saat close MEMPOSTING
   P&L → laba ditahan (opsional per pemilik), gagal bercerita di dirinya, membawa
   alasan dan siapa. Ambil juga `closed_documents` + `exempted_role` per periode
   (kebijakan per jenis dokumen, bukan allowlist global SOFT_CLOSED).

## 4. P3 — jaminan struktural di pintu (±1 minggu)

8. **PLE jadi bagian dari `PostingIntent`.** Intent menyatakan per baris party:
   `ple: Open | Settle | None`; poster mengeksekusinya di transaksi yang sama.
   Aturan 0143 ("money moving is NOT sufficient reason") tetap berlaku — None legal,
   yang hilang adalah ketergantungan pada disiplin pemanggil. Monitor
   `payment_ledger.control_accounts` (`integrity.rs:576+`) tetap sebagai jaring kedua.
   **Uji:** flow yang lupa mendeklarasikan Open untuk baris PAYABLE → ditolak poster.
9. **Tutup pintu multi-currency.** `CHECK (currency = 'IDR')` di `journal_entry`
   (klien retail IDR). Buka kembali HANYA kalau membangun versi penuh: 4 kolom kurs
   + JE Exchange Gain/Loss ala ERPNext. Setengah mata uang lebih berbahaya dari
   tidak ada.
10. **Kebersihan murah:** ganti `unwrap_or(0)` readiness dengan error yang naik;
    whitelist `bank_key/cash_key` di tax/financing/petty/store-deposit (pola
    `acquirer.rs:1662`); lock baris budget di `enforce_budgets`; `unmatch` membawa
    aktor; validasi `opening + Σline = closing` saat import statement; PPN 11%
    fallback dihapus (wajib `commercial_tax_rule`).

## 5. P4 — satu pintu untuk manusia (±1 minggu, paralel setelah P0)

11. **Lebur 4 modul frontend** (`finance`, `finance-lab`, `finance-final`,
    `finance-lab-2` — 95 file, dua pintu nav) ke satu menu per `docs/finance-menu.md`
    (13 menu, role-based). Lab dipensiunkan setelah kontrak aturannya pindah ke uji
    Rust (keputusan lama §11.3 yang belum dijalankan).
12. **Refresh dokumen basi**: `docs/finance.md` §7/G7 (close sudah punya checklist),
    klaim 7.528 akun → 43 daun + dimensi, `0050:123` rujukan 0048, posisi `poster.rs:179`.

---

## 6. Keputusan desain yang menyertai rencana ini

### 6.1 Scheduler — ambil kebutuhannya, bukan mesinnya

Kita SUDAH punya pola scheduler in-process: 7 agent di `src/bin/cloud.rs:51-63`
(auth policy refresh, catalog publisher, ageing work, asset month-end, integrity,
sync apply, statement intake mail gateway dengan ticker `intake/mod.rs:314`).
Frappe scheduler tidak perlu ditiru — semua run kita idempoten lewat
`(source_kind, source_id, purpose)` UNIQUE, jadi agent = `tokio::spawn` + interval,
bukan cron eksternal. **Yang ditambah (P1):**
- `run_prepaid_month_end_agent` — alokasi prepaid bulanan (`prepaid.rs:522`;
  tanpa ini kewajiban/prepaid diam dan beban salah periode — padanan
  *Process Deferred Accounting* ERPNext);
- `run_sale_day_agent` — posting harian per toko (`sales_posting.rs`) + retry yang
  gagal beralasan (padanan antrean POS Invoice Merge Log mereka, sudah dibenarkan
  0273 satu penulis).

### 6.2 Recurring bill & recurring payment — dua hal beda; listrik adalah yang pertama

Fakta ERPNext dulu: `Auto Repeat` + `Subscription` menghasilkan **dokumen berulang**
(invoice/JE dibuat ulang berkala oleh scheduler); Payment Entry TIDAK PERNAH dibuat
otomatis oleh core. Auto-charge hanya via payment gateway (Stripe/Razorpay) untuk
e-commerce. Jadi "recurring payment" ala ERPNext = recurring **dokumen**, bukan
recurring uang.

**Untuk kita, bedakan dua kebutuhan:**

1. **Recurring BILL (tagihan rutin) — inilah biaya listrik.** Yang berulang adalah
   *kewajibannya*, bukan pembayarannya: listrik, air, internet/ISP, sewa ruko & gudang,
   keamanan & kebersihan, sewa mesin EDC/terminal QRIS, langganan software/lisensi,
   kontrak servis AC/lift (lihat `scripts/seed-expenses-bills.sql` — semuanya bulanan).
   Bentuk: **`bill_template`** (supplier, `expense_key` + kategori, nominal perkiraan
   + toleransi, tanggal jatuh tempo tiap bulan, site, template payment_terms) →
   `run_bill_template_agent` menumbuhkan **DRAFT** bill tiap periode → tagihan asli
   yang masuk (intake email/statement) dicocokkan: dalam toleransi → match siap di-post;
   di luar toleransi → antrean varian. Manusia tetap match/post.
2. **Recurring PAYMENT (standing instruction) — opsional, lapis kedua.** Setelah bill
   rutin di-post, payment instruction otomatis dibuat **REQUESTED** (contoh: listrik
   PLN site 01, giro otomatis tanggal 10). Yang otomatis berhenti di situ: approval
   dan eksekusi tetap jalur dua tangan yang sudah ada. Auto-debit bank TIDAK dibangun.

**Yang SUDAH punya rumah berulang dan TIDAK ikut `bill_template`** (jangan dobel):
cicilan pinjaman bank/principal (`financing.rs` facilities + jadwal instalment),
premi & sewa dibayar dimuka (`prepaid.rs` jadwal alokasi bulanan), gaji (`PAYROLL_RUN`
P1), kewajiban pajak per periode (`tax_period`), setoran harian toko (`store_deposit`).

### 6.3 Payment schedule (cicilan) — SUDAH diambil, tidak perlu lagi

`payment_terms.rs` sudah meniru `Payment Term.due_date_based_on` ERPNext (tiga dasar
penanggalan, instalment, template); `b0b16f7` membuat bill jatuh tempo berkali-kali,
ageing dihitung dari cicilan berikutnya (`ab25c04`). Yang tersisa dari PAYMENT-TERMS-PLAN:
metode bayar pindah ke baris instalment + keputusan pemilik soal tanggal giro.

### 6.4 voucher_type — pintu manual tiga tombol, sesederhana ERPNext tanpa kolom baru

Pemilih: bentuk ERPNext yang simple. Yang membuatnya terasa simple di ERPNext bukan
kolomnya, tapi **satu layar + pilihan jenis + prefilled**. Kita ambil itu, dan karena
KM/KK kita sudah punya dokumennya sendiri (lebih baik dari JE Cash Entry mereka),
hasilnya malah lebih sederhana:

- **Pintu manual jadi tiga tombol:** `Kas Masuk (KM)` · `Kas Keluar (KK)` · `Jurnal Umum (KJ)`.
  - KM/KK → `cash_document` yang sudah ada: nomor KK/KM sendiri, dua sisi, kebijakan
    approve, dan pasangan statement-line — bukan lewat JE manual.
  - KJ → `MANUAL` JV (`JV-{n:08}`) seperti sekarang.
- **Register jurnal menampilkan label jenis** (`voucher` di read-model): turunan
  `source_kind` + jenis dokumen sumber — KK/KM dari cash document, JV dari manual,
  dan setiap aturan menyebut namanya sendiri. Tidak ada kolom baru yang bisa ditulis
  user; satu sumbu kebenaran tetap `source_kind`.
- **Quick entry** = tombolnya sendiri: KM/KK prefilled satu kaki kas/bank dari
  `account_map` per site; `manual_je_policy` tetap berlaku.
- (Kalau pemilik tetap ingin kolom fisik: hanya CHECK closed-list `KM|KK|KJ`,
  NOT NULL hanya untuk `source_kind='MANUAL'` — tidak pernah free text.)


### 6.5 Yang diambil FULL dari ERPNext (status)

| Yang diambil | Status 22 Sep | Fase |
|---|---|---|
| Party Type registry + party di baris GL | **sudah** (0299–0301; DB menunggu migrasi) | P0 |
| Guard party Receivable/Payable | **sudah**, sebagai trigger DB (lebih dalam dari mereka) | P0 |
| Payment Schedule / cicilan | **sudah** (`payment_terms.rs`) | — |
| Supplier sebagai party penuh (people, NPWP, terms) + merge bank_account | staged `0302` | P3 |
| Payment Reconciliation (worklist di atas PLE) | **belum** (endpoint mati) | P0/P3 |
| PCV: close yang memposting P&L→RE dan bercerita di dirinya | belum | P2 |
| `closed_documents` + `exempted_role` per periode | belum (allowlist global saja) | P2 |
| Scheduler run periodik (deferred, POS queue) | pola agent sudah; prepaid + sale-day belum | P1 |
| Recurring documents (Auto Repeat/Subscription) | belum → `bill_template` + standing instruction | P1 |
| Dry-run saat aturan berubah (padanan Repost preview/Bisect) | belum | P3 |
| Trial Balance for Party | belum (party sudah di baris → murah) | P3 |
| Account Category sebagai tag roll-up laporan | sebagian (`category_family` 0288) | P4 |
| Multi-currency penuh | **tidak diambil**; kunci IDR-only | P3 |

### 6.6 Yang TIDAK ditiru (tetap, dicatat supaya tidak dibuka ulang)

Sumbat Round Off ≤ 0,5 • invarian seimbang di aplikasi • rantai default akun yang bisa
jatuh ke tebakan • ledger yang bisa di-repost/dihapus • Payment Order yang membuat JE
(pintu posting kedua) • menu sebagai data tanpa rumah • mesin pajak di dalam dokumen
pembayaran.

### 6.7 Simplifikasi yang menyertai (meniru yang simple dari ERPNext, menata yang kita sendiri)

| Simplifikasi | Bukti/kenapa | Fase |
|---|---|---|
| Pintu manual 3 tombol KM/KK/KJ (§6.4) | satu layar seperti JE mereka; KM/KK sudah punya dokumen & nomor sendiri | P4 |
| Satu jalur close; hapus `ledger::close_period` | tiga jalur tidak setuju (M2) | P2 |
| Satu keluarga deposit: gabung `DEPOSIT` (deposits.rs) & `STORE_DEPOSIT` (store_money.rs) — register hanya membaca kolom satu pihak (`deposits.rs:257`) | dua aturan, dua status machine, satu tabel | P3 |
| `payment_execution.rs` pakai `cash_draft_from`; hapus SQL duplikat penulis-kedua | "bridge, meant to be deleted" | P3 |
| Prune `source_kind` yang tetap tanpa penulis setelah P1 (REMITTANCE, dsb) | CHECK 41 nilai mengecil; doc §12.8 terpenuhi sebagai daftar sengaja | P3 |
| Satu model alokasi pembayaran (bernama); tertua-dulu hanya acquirer | dua model = dua kebenaran umur (putusan `erpnext-money.md` §7, dijalankan) | P3 |
| Multi-currency dikunci `CHECK currency='IDR'` | setengah mata uang lebih berbahaya dari tidak ada | P3 |
| 4 modul frontend finance → 1 menu | 95 file, dua pintu nav | P4 |

Yang SENGAJA tetap, bukan disederhanakan: `account_map` yang menolak tanpa default,
katalog 75 arti sebagai daftar pekerjaan, menu sebagai kode (build gagal kalau ada
menu tanpa layar — kebalikan 28 doctype ERPNext tanpa pintu).

---

## 7. Urutan & dependensi

```
P0 (1 hari) ──► P1 COGS + payroll + tagihan rutin + 2 agent (1 minggu) ──► P3 struktur (1 minggu)
   │                                                        ▲
   └──► P2 bank claim + satu close/PCV (4 hari) ────────────┘
P4 frontend lebur: paralel setelah P0, selesai sebelum P1 landing (UI ikut domain baru)
```

Total ~3 minggu kerja efektif. P0 memblokir semuanya; tanpa reversal yang hidup,
verifikasi semua fase sesudahnya tidak bisa dipercaya.


---

## 8. Menu Finance final — keputusan atas perbandingan, bukan warisan

Kandidat yang diperbandingkan: menu 13 Sep (`docs/finance-menu.md`, 37 baris, sumbu
domain kerja) · rekomendasi Jev 19/9 (13 baris, union per role) · bentuk ERPNext asli
(4 workspace, 121 link, sumbu jenis benda) · prototipe 11/9 (13 menu, 67 tab).

**Putusan: bentuk domain-kerja satu pintu menang; isi lengkapnya 43 baris · 14 seksi**
(menu di bawah). Alasan singkat: satu baris = satu layar (bukan tab di dalam baris —
kesalahan 67 tab tidak diulang); sumbu "pekerjaan siapa" mengalahkan "jenis benda"
untuk orang yang menutup bulan; `audience` memberi toko 7 barisnya tanpa modul kedua;
`keep_closed` mengikuti irama harian/bulanan; dan menu adalah kode — build gagal kalau
ada menu tanpa layar (ERPNext: 28 doctype tanpa pintu). Yang diambil dari yang kalah:
dari Jev — grup Tax & Financing, Giro printing dilipat ke settings, line categories
masuk layar Posting rules; dari ERPNext — kosakata kind (dashboard·document·tool·
report·setting), pola keep_closed, laporan inti di kaki; dari prototipe — isi layar
(8 keadaan, form, format cetak), bukan bentuk menunya.

```
FINANCE                                             /finance
────────────────────────────────────────────────────────────────
     Overview                            dashboard
▾ Store money          Sales days · Deposits · Petty cash
▾ Cash & Bank          Cash · Cash Counts · Banks · Bank Accounts ·
                       Bank Transactions · Bank Reconciliation
▾ Receivables          Settlements · Charges without a sale
▾ Payables             Supplier bills · Recurring bills · Giro register ·
                       Advances & claims
▾ Payments             Payments · Payment reconciliation · Journal entries (KM/KK/KJ)
▾ Inter-unit           Inter-unit transfers · Due from / Due to
▾ Tax                  Tax periods                      ← baru (Jev 19/9; 7 endpoint hidup)
▾ Financing & equity   Loans & instalments · Capital & drawings   ← baru (facilities, principals)
▸ Assets               Assets · Depreciation · Projects in progress     [keep_closed]
▸ Payroll              Payroll postings · Staff loans                  [keep_closed]
▸ Periodic & closing   Prepaids & accruals · Period close (+PCV) ·
                       Opening balances                                [keep_closed]
▾ Reports              Financial statements · Ledger (+TB per party) ·
                       Stock value · Integrity checks
▸ Setup                Chart of accounts · Account map · Posting rules ·
                       Party accounts · Payment terms · Budgets ·
                       Finance settings                                [keep_closed]
```

Yang **bukan baris baru** padahal plan menambahnya: pintu manual 3 tombol → baris
*Journal entries*; PCV → baris *Period close*; TB per party → view di *Ledger*;
katalog recurring yang sudah berumah (cicilan→Financing, premi→Prepaids, gaji→Payroll,
pajak→Tax) tidak dapat baris sendiri.