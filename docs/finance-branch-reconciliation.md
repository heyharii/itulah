# Rekonsiliasi dua cabang finance

**Tanggal:** 16 September 2026. **Cabang:** `feat/finance-control` (`ea1f48c1`)
di-merge ke `feat/handheld-rfid` (`9dacdec6`), merge-base `d2e97196`.
Merge sudah diperbaiki sampai compile bersih dan gate CI hijau, **belum
di-commit** saat dokumen ini ditulis.

Deliverable Phase 0. Perintahnya: *dokumentasikan dulu, jangan hapus salah satu
implementasi hanya karena tampak redundan; dan berhenti kalau ada ambiguitas
migrasi yang destruktif.* Ada satu. Bagian 1.

---

## 0. Angka

| | finance-control | handheld-rfid |
|---|---:|---:|
| migrasi Postgres baru | 49 (0106–0158) | 70 (0159–0255) |
| migrasi SQLite baru | 1 (0033) | — |
| tabel yang dibuat | 66 | 51 |
| modul Rust baru | 53 | — |
| rute baru | 136 | — |
| file tes integrasi baru | 18 | — |

Nomor yang bertabrakan: **0106** dan **0107**, dipakai kedua sisi dengan isi
berbeda. Diselesaikan dengan memindah punya handheld (yang lebih baru menurut
tanggal file — 9 dan 13 Sep vs 6 Sep):

- `0106_a_statement_can_arrive_on_its_own` → **0142** (harus tetap < 0244, yang merujuk `bank_statement_source`)
- `0107_a_staff_purchase_is_counted_against_an_allowance` → **0258**

**0256 tidak boleh dipakai.** Ia dipegang lane rename kantor pusat
(`dc`+`dc-01` → satu site `ho`), yang `9b273f83` sisihkan karena menolak `dc`
— dan delapan komentar di `src/` sudah menarasikan "since 0256". Dicatat di
`RESERVED` (`backend/tests/migration_hygiene.rs`).

---

## 1. BERHENTI — satu hari dagang bisa diposting dua kali

Ini satu-satunya temuan yang menahan Phase berikutnya.

**Dua jalur posting hidup, keduanya punya rute, keduanya menulis
`source_kind = 'SALE_DAY'` untuk (unit, hari) yang sama, dan tidak ada yang
menahan keduanya berjalan berurutan.**

| | lane handheld | lane finance |
|---|---|---|
| modul | `postgres/sale_day.rs` | `postgres/sales_posting.rs` |
| rute | `GET /finance/sale-days`, `POST /finance/sale-days/{site}/{day}/post` | `sales_posting::lane_a_routes` — 6 rute `/finance/sales-postings` |
| tabel | `sale_day_posting` (0238), PK `(site_id, trading_day)` | `sales_posting` + `_line` (0107), UNIQUE `(site_id, business_date)` |
| `source_id` | `"{site_id}:{trading_day}"` | `posting_id` (uuid) |
| tahu yang lain? | nol rujukan ke `sales_posting` | nol rujukan ke `sale_day_posting` |

0238 **mengantisipasi** ini. Ia memasang penjaga kedua di sisi jurnal:

```sql
CREATE UNIQUE INDEX ux_journal_entry_sale_day
    ON journal_entry (source_id) WHERE source_kind = 'SALE_DAY';
```

dengan komentar: *"refuses a second SALE_DAY entry for one day even if it were
written by something that never touched the table above — a repair script, a
hand-rolled insert, **a future second rule**."*

Lane finance **adalah** "a future second rule" itu. Tapi penjaganya bekerja
pada `source_id`, dan kedua jalur menulis bentuk yang berbeda — satu
`store-03:2026-09-15`, satu UUID. Index unik pada dua nilai berbeda tidak
menahan apa pun. Jadi hari yang sama bisa masuk buku dua kali: pendapatan
ganda, kas ganda, piutang kartu ganda.

### 1a. Dan penjaga itu mematahkan hal lain — sudah diperbaiki (0260)

Membaca ulang keduanya memunculkan hal kedua, dan itu membatalkan mitigasi yang
mula-mula ditulis di sini.

`ux_journal_entry_sale_day` (0238) unik pada `source_id` saja. 0140 — tiga
minggu lebih tua, dari lane finance — unik pada `(source_kind, source_id,
purpose)`: **satu entri per dokumen per LANGKAH**. Itu yang membuat
`sales_posting` bisa memposting ulang satu hari setelah dibalik, dengan menamai
tiap percobaan `ATTEMPT_n`.

0238 mengabaikan langkahnya. Jadi `ATTEMPT_2` bertabrakan dengan `ATTEMPT_1`
pada `source_id` saja dan **ditolak database — hari dagang yang sudah dibalik
tidak bisa diposting ulang sama sekali.**

Dan yang diinginkan 0238 ternyata sudah diberikan 0140: aturan yang ia tulis
untuk itu memposting `source_id = '<site>:<day>'` tanpa purpose, jadi langkahnya
`MAIN`, dan `(SALE_DAY, '<site>:<day>', 'MAIN')` hanya boleh ada satu. Tidak ada
yang hilang.

**Migrasi 0260 membuang indeks 0238.** Diverifikasi di database yang dibangun
dari rantai penuh: 208 migrasi bersih, dan hanya
`ux_journal_entry_source_purpose` yang tersisa di `journal_entry`.

### 1b. Yang masih terbuka, dan tiga pilihannya

Posting ganda lintas lane **belum tertutup** — 0260 tidak menutupnya, dan tidak
boleh disalahpahami begitu: indeks yang dibuangnya memang tak pernah
menahannya, karena kedua sisi menulis `source_id` berbeda bentuk.

**Tidak saya putuskan sendiri.** Dua implementasi berjalan, keduanya punya
konsumen, dan yang dipertaruhkan angka uang.

1. **Lane finance jadi kanon**, jalur `sale-days` dipensiunkan. Ia lebih kaya:
   dokumen berbaris, `RETENDER`, reverse, posting ulang ber-attempt, 6 rute.
   Biayanya: `sale_day_posting` kehilangan gunanya, dan pemanggil
   `/finance/sale-days/{site}/{day}/post` harus pindah.
2. **Lane handheld jadi kanon**, `sales_posting` dipensiunkan. Biayanya paling
   besar — 6 rute, 2 tabel, retender dan kemampuan posting ulang ikut hilang.
3. **Keduanya dipertahankan, dengan satu penjaga bersama.** Bukan menyatukan
   `source_id` — itu yang mula-mula saya sarankan dan itu salah: menyeragamkan
   ke `'<site>:<day>'` membuat setiap attempt sesudah yang pertama ditolak.
   Yang benar adalah penjaga terpisah di luar `source_id`, misalnya indeks unik
   pada satu kolom turunan `(site_id, trading_day)` untuk kind `SALE_DAY`, yang
   kedua rule isi dengan cara masing-masing.

Saran saya: **(1)**, karena dokumen berbaris dan retender adalah kebutuhan
nyata di `docs/finance-menu.md`, dan karena lane itu satu-satunya yang bisa
memposting ulang hari yang dibalik.

**Tapi (1) punya biaya yang harus disebut**, diukur 16 Sep dengan menjalankan
kedua binary tes:

| | lolos | catatan |
|---|---|---|
| `sale_day_integration` (handheld) | **13 dari 14** | satu-satunya yang gagal adalah `qris_has_a_receivable_of_its_own_and_only_one` — itu keputusan QRIS di §6, bukan cacat |
| `sales_posting_integration` (finance) | **0 dari 12** | semuanya terhalang `ledger_account_carries_no_unit` |

Fixture lane finance memodelkan chart **sebelum 0243** mengeluarkan unit dari
kode: ia menyisipkan daun per-unit (`101100100101` = `1011001001` + `01`),
memetakan arti ke daun itu, lalu memeriksa saldo padanya. Setelah 0243 chart
hanya memegang akun 10 digit dan unitnya hidup di `journal_line.site_id` —
prinsip yang rencana Finance tegaskan. Jadi fixture-nya usang, bukan CHECK-nya;
tapi memperbaikinya berarti menulis ulang model fixture 12 tes, bukan satu
`sed`.

Artinya lane handheld **lebih dekat ke bisa dikirim** hari ini, dan lane finance
lebih kaya tapi berhutang tes. Itu tidak membalik saran di atas — fitur lebih
mahal dari hutang fixture — tapi siapa pun yang memilih (1) harus tahu bahwa
verifikasinya belum ada.

---

## 2. Konsep yang punya dua nama — dan yang ternyata tidak

Diperiksa satu per satu. Hanya satu yang benar-benar bersaing (Bagian 1).

| konsep | lane finance | lane handheld | putusan |
|---|---|---|---|
| hari dagang | `sales_posting` 0107 — dokumen berbaris | `sale_day_posting` 0238 — baris idempotensi + 2 penjaga | **BERSAING**, lihat Bagian 1 |
| laci dihitung | `cash_shift*` 0110 — sesi: float, variance, persetujuan | `cash_count` 0216 — satu pengukuran, selisih DITURUNKAN | **saling melengkapi.** Sesi ≠ pengukuran. Keduanya dipertahankan. |
| uang muka pemasok | `supplier_advance` + `_application` 0133 | — | satu implementasi; advance non-PO belum ada (Phase 4C) |
| setoran toko | `store_deposit` 0111 | — | satu implementasi |
| dokumen kas | `cash_document` 0115 | — | satu implementasi |
| penyelesaian dana | `fund_settlement` 0113 **dan** `payment_ledger_settlement` 0144 | — | **dua-duanya lane finance**, bukan tabrakan cabang. Belum diperiksa; bukan penghalang Phase 0. |
| akun antar-unit | `journal_line.counter_site_id` 0120 + akun berpasangan 0122 | — | satu implementasi, dan ini yang ERPNext tak punya |
| saldo awal | `opening_balance_line` + `opening_stock_line` + `opening_subledger_line` 0158 | — | satu implementasi |
| giro | `giro` 0117 + `_slip` 0118 + jejak di pembayaran 0119 | — | satu implementasi |
| nota kredit | `supplier_credit_note` 0132 | — | satu implementasi |
| landed cost | `LANDED_COST` source kind, `costing.rs` | — | satu implementasi |
| COGS | `COGS_DAY` dari `stock_ledger.rs` | — | satu implementasi |

---

## 3. Kode yang bergantung pada migrasi cabang lain

Tiga tempat, semuanya sudah diperbaiki dalam merge ini:

1. **`journal_entry_source_kind_check`** — lane finance menaikkan kosakata
   11→32 (0107, 0158); lane handheld melebarkan **11 yang dikenalnya** di 0216,
   0241, 0242. Nomornya selang-seling, 0242 jalan terakhir, 14 miliknya jadi
   hukum, **21 kind terkunci** — 20 di antaranya ditulis kode. Dipulihkan
   migrasi **0257** (union 35). Lihat catatannya di file itu.
2. **`ASSET_ACCOUNT_FAMILY`** — const lane finance yang lane handheld sudah
   gantikan dengan `ASSET_FAMILIES` + `is_asset_account()` (0159 memperlebar,
   0213 menambah `1031803`). Empat pemanggil diarahkan ke pengganti.
3. **Chart klien di `ledger_account`** — migrasi handheld (0243/0247/0253/0254/
   0255) memuatnya; 15 file tes lane finance masih menyisipkan akun fixture-nya
   sendiri. 23 titik diberi `ON CONFLICT (account_code) DO NOTHING`.

Satu lagi yang bukan lintas-cabang tapi ditemukan di jalan: `domain::ids::
HEAD_OFFICE_SITE_ID` mengatakan `"ho"` sementara tak ada baris `site` yang
bernama begitu. Akibatnya nyata — `RETURN_TO_DC` dan `RETURN_TO_SUPPLIER`
menuntut site id yang tak ada, dan `queries.rs` menghitung kolom `allotted`
untuk **setiap** pool karena `site_id <> 'ho'` benar di semua baris. Keduanya
diperbaiki ke `dc`, dengan catatan apa yang harus ikut bergerak saat 0256
mendarat.

---

## 4. Tabel di DB dev yang tak bisa direproduksi dari satu cabang

Tidak ada. Seluruh rantai **206 migrasi** diterapkan ke database kosong dengan
cara yang sama seperti sqlx (satu transaksi per file) dan lolos 206/206.
Percobaan pertama gagal di 0009 justru karena tidak begitu:
`CREATE TEMP TABLE … ON COMMIT DROP` hanya hidup di dalam satu transaksi.

```bash
for f in $(ls *.sql | sort -t_ -k1,1n); do
  psql -d "$DB" -q -1 -v ON_ERROR_STOP=1 -f "$f" || break
done
```

---

## 5. Empat modul finance di frontend — bukan empat versi satu hal

92 layar terpasang di router sekaligus. Bukan duplikasi: cakupannya berbeda.

| modul | layar | isi |
|---|---:|---|
| `finance` | 14 | **GL**: chart of accounts, general ledger, journal, periods, account map, assets, bank |
| `finance-final` | 15 | **operasi uang**: receivable, payable, cash, deposits, expenses, prepaids, payment & sales reconciliation |
| `finance-lab-2` | 7 | **Banking** — banks, bank accounts, bank transactions, reconciliation, cash counts. Ini baris 10–13 menu final, bukan lab. |
| `finance-lab` | 32 | eksplorasi terluas: accruals, capital, financing, interunit, payroll, tax, vendors, scenarios, signature, rules |

Targetnya **sudah diputuskan** dan tidak perlu dipilih lagi: `docs/finance-menu.md`
(15 Sep) — **37 baris, 12 seksi, satu pintu**, dengan status per baris dan
padanan ERPNext-nya. Keempat modul di atas adalah artefak *pra*-keputusan.

Karena itu Phase 0 **tidak memensiunkan satu pun**. Menggabungkan 92 layar
menjadi 37 baris adalah pekerjaan tersendiri, bukan pembersihan merge — dan
membuang `finance-lab` sekarang berarti membuang satu-satunya implementasi
accruals, capital, financing, payroll dan tax yang ada.

---

## 6. Keputusan yang masih terbuka

1. **Hari dagang diposting dua kali** — Bagian 1. Penghalang.
2. **QRIS.** 0248 membuat `1011101003 Piutang QRIS` dengan alasan kuat (acquirer
   QRIS bukan acquirer kartu: rel, hari, MDR, statement berbeda); 0254
   menghapusnya sebagai akun karangan dan mengarahkannya ke `1011101002 Piutang
   Debit Card` atas dasar chart klien adalah otoritas. 0254 menang karena
   bernomor lebih tinggi, jadi penyelesaian QRIS dan debit kini jatuh di satu
   akun. Chart klien juga tak punya akun **pendapatan** QRIS.
3. **`cash_in_transit` tak punya akun.** 0254 menghapus `1011005001 Setoran
   Dalam Perjalanan` sebagai karangan, tanpa pengganti. Meaning-nya masih
   menunjuk ke sana — empat tes gagal dengan `no account 1011005001 in the
   chart`.
4. **`fund_settlement` vs `payment_ledger_settlement`** — dua tabel penyelesaian
   dalam satu lane. Belum diperiksa.
