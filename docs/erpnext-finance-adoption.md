# ERPNext Finance Adoption — rencana lengkap

**Status:** rencana eksekusi, menunggu persetujuan pemilik untuk mulai 0299.

> **Catatan 27 Sep 2026:** `account_map` diganti `account_link` + view
> `account_resolution` (0460): kait berjenjang per cakupan (site → jenis site →
> semua), tipe akun (`root_type`/`account_type`) di bagan, dan editor COA
> dengan persetujuan orang kedua (0461). `party_account` (§3.1) akan menjadi
> sumber `PARTY` di `account_link` dengan urutan `get_party_account` yang sama.
> Penyebutan `account_map` di bawah adalah sejarah.
Keputusan pemilik 22 September 2026: **tiru abis** arsitektur finance ERPNext
("bisa ga hanya party tapi keseluruhan arsitektur financenya", "baik just do").

Sumber yang dibaca untuk dokumen ini:

* klon segar `~/Documents/erpnext`, branch `develop` (klon lama
  `~/Documents/reference-erp` dari studi 12 September tetap ada, jangan dihapus);
* [`./erpnext-reference.md`](./erpnext-reference.md) — peta menu/workspace;
* [`./erpnext-banking.md`](./erpnext-banking.md) — bedah banking;
* [`./finance.md`](./finance.md) — model kita; putusan §0 masih berlaku untuk
  hal-hal yang dokumen ini tidak ubah;
* [`./bc-bank-reconciliation.md`](./bc-bank-reconciliation.md) — rencana R0–R4;
* rantai migrasi `backend/migrations/postgres/` sampai `0298`.

Jawaban atas pertanyaan yang membuka rencana ini: **ya, ERPNext extensible dan
tidak menuntut keputusan COA dulu.** Tidak ada satu tabel finance ERPNext pun
yang menyimpan kode akun secara permanen; ikatan akun hidup di tabel
konfigurasi (`Party Account` di tubuh party → default `Company`) dan COA
bawaannya cuma fixture yang bisa dibuang. Kita punya prinsip yang sama lewat
`account_map`, jadi adopsi ini **tidak menyentuh `ledger_account` sama sekali**
— sumbu party ditambahkan ke resolusi, semantic key tetap satu-satunya pintu
kode akun klien.

---

## 0. Dua keputusan yang ditimpa — dicatat jujur

Rantai kita menulis alasannya di file; keputusan yang diganti harus sama
tercatatnya. Dua esai keputusan berakhir dengan rencana ini:

1. **Brief §16 "larangan Party generik"** (disebut `finance-bank-audit.md` §3).
   Ditimpa keputusan pemilik 22 September 2026. Migrasi 0299 membuka dengan
   kalimat itu dan menamai penimbusnya.
2. **Pemisahan 0270** — "company bank account: our money; supplier bank
   account: where a payment goes; both hold an account number, which is the
   whole of their similarity". Peleburan 0302 menggabungkan keduanya kembali,
   mengikuti satu-doctype `Bank Account` ERPNext. Arah setengahnya sudah
   diantisipasi audit §F ("arah yang masuk akal adalah 0221 luruh ke 0151");
   0302 menuntaskannya satu langkah lebih jauh.

Satu pengecualian yang **tidak** ditimpa: 0214 memisahkan `bank_said` (kata
bank) dari kesimpulan kita. Itu tetap — dan bukan penyimpangan dari ERPNext:
`bank_transaction.json` memakai pasangan yang sama (`party_type`/`party` untuk
kesimpulan, `bank_party_name`/`bank_party_account_number`/`bank_party_iban`
untuk kata bank).

## 1. Kosakata tunggal: ke mana setiap kolom bergerak

Hari ini ada **tujuh** kolom kosakata party dengan **empat** isi berbeda:

| Tabel (migrasi) | Kolom hari ini | Isi | Menjadi |
|---|---|---|---|
| `cash_document` (0115) | `party_kind` | SUPPLIER/EMPLOYEE/OTHER | `party_type` |
| `advance` (0280) | `party_kind` | EMPLOYEE/SUPPLIER/OTHER | `party_type` |
| instruksi pembayaran (`payment_execution.rs`) | `party_kind` | SUPPLIER/EMPLOYEE/OTHER | `party_type` |
| `payment_ledger_entry` (0143) | `party_type` | SUPPLIER/ACQUIRER/EMPLOYEE/CUSTOMER/OTHER | tetap |
| `opening_subledger_line` (0158) | `party_type` | SUPPLIER/ACQUIRER/EMPLOYEE/CUSTOMER/OTHER | tetap |
| `payment_destination` (0151) | `party_type` | SUPPLIER/EMPLOYEE/OTHER | tetap |
| `bank_statement_line` (0214) | `counterparty_kind` | SUPPLIER/CUSTOMER/MEMBER/STAFF/OTHER | `party_type` + `party_id` + `party_name` |

Dua penyatuan isi: `STAFF` → `EMPLOYEE` (backfill, kosakata 0113/0115 yang
menang), `CUSTOMER` tetap berbeda dari `MEMBER` (register `member` ada,
`CUSTOMER` adalah pihak tanpa register — dua hal berbeda, keduanya sah).

`journal_line` hari ini hanya punya `supplier_id` (0051, typed FK). Meniru
ERPNext (`gl_entry.json`: `party_type` Link + `party` Dynamic Link, dua-duanya
`search_index`) berarti pindah ke pasangan polimorfik: `party_type` +
`party_id` (text) + `party_name` (beku, seperti `party_name` di 0143/0151).
Tiga typed-FK **bukan party** tetap: `asset_id`, `bank_account_id`,
`counter_site_id`.

## 2. Registry `party_type` — bentuk dan isinya

ERPNext: doctype `Party Type` = `party_type` (Link→DocType, unique) +
`account_type` (Payable|Receivable), `in_create`. Guard pemakainya:
`journal_entry.py:481` — akun pihak harus cocok `account_type` registry,
**kecuali Employee** ("they can be both payable and receivable").

Versi kita:

```sql
CREATE TABLE party_type (
    party_type   text PRIMARY KEY,          -- 'SUPPLIER', 'MEMBER', ...
    -- Register yang memegang barisnya; '' berarti pihak tanpa register
    -- (CUSTOMER, OTHER) -- party_id tetap text, boleh tak punya baris (0151).
    register     text NOT NULL DEFAULT '',
    account_type text CHECK (account_type IN ('PAYABLE', 'RECEIVABLE')),
    note         text,
    created_at   timestamptz NOT NULL DEFAULT now()
);
```

Baris seed, akun tipe mengikuti semantik ERPNext (`PAYABLE` = kita berutang,
`RECEIVABLE` = kita ditagih):

| party_type | register | account_type | catatan |
|---|---|---|---|
| `SUPPLIER` | `supplier` | PAYABLE | kategori 0212 tetap |
| `EMPLOYEE` | `employee` | PAYABLE | pengecualian dua arah ala `journal_entry.py:481` masuk guard 0300 |
| `ACQUIRER` | — | RECEIVABLE | acquirer menahan uang kita (0135) |
| `CUSTOMER` | — | RECEIVABLE | tanpa register; `party_id` text |
| `MEMBER` | `member` | *NULL* | lihat penyimpangan di bawah |
| `OTHER` | — | *NULL* | bukan akun kontrol |

**Satu penyimpangan yang diaku:** `account_type` dibolehkan NULL. ERPNext tidak
punya `OTHER` dan semua party type-nya bermuara akun kontrol; kita punya dua
(`MEMBER`, `OTHER`) yang tidak bermuara akun kontrol apa pun hari ini. NULL
adalah "bukan akun kontrol party", bukan "belum ditentukan".

Sebelum menulis 0299, seed `Party Type` ERPNext dibaca ulang dari fixture
klon untuk memastikan pemberian `account_type` per tipe mengikuti milik mereka
sejauh register kita beririsan.

## 3. Skema target, per komponen

### 3.1 `party_account` — ikatan akun di tubuh party (padanan child table ERPNext)

ERPNext: `party_account.json` = `company` + `account` + `advance_account`,
ditempel di Customer/Supplier (dan Group-nya); resolusi berjenjang di
`party.py:459 get_party_account`: party → group → `Party Type.account_type` →
default Company.

Versi kita — per **site**, karena `account_map` kita berjenjang per lokasi:

```sql
CREATE TABLE party_account (
    party_type          text NOT NULL REFERENCES party_type(party_type),
    party_id            text NOT NULL,
    site_id             text NOT NULL REFERENCES site(id),
    account_code        text NOT NULL,      -- daun bagan klien, diverifikasi
    advance_account_code text,
    set_by              text NOT NULL,
    set_at              timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (party_type, party_id, site_id)
);
```

Resolusi berjenjang di Rust `party.rs` (baru): baris `party_account` →
kalau kosong, semantic key menurut `account_type` registry
(`trade_payable` untuk PAYABLE, `receivable` untuk RECEIVABLE) lewat
`account_map` untuk site itu → kalau kosong lagi, **tolak dengan menyebut
kuncinya** (kebiasaan finance.md §3: tidak pernah di-default).

### 3.2 Peleburan `bank_account` (0302)

Satu tabel untuk empat peran, bentuk ERPNext `bank_account.json`
(`is_company_account` + `party_type`/`party`), membawa kolom terkuat tiap
lane kita:

```sql
CREATE TABLE bank_account (
    account_id   uuid PRIMARY KEY,
    bank_id      uuid NOT NULL REFERENCES bank(bank_id),
    is_company_account boolean NOT NULL,
    -- sisi company (is_company_account = 1): 0223/0269
    ledger_account_code text, site_id text REFERENCES site(id),
    kind text CHECK (kind IN ('GIRO','SAVINGS','TIME_DEPOSIT')),
    status text, opened_at date, is_primary boolean,
    -- sisi party (= 0): 0151/0221/0105
    party_type text REFERENCES party_type(party_type), party_id text,
    party_name text, account_holder text NOT NULL, branch text,
    -- identitas bersama
    account_no text, account_no_digits text,
    account_number_enc bytea, account_number_fingerprint text,
    verification_status text, owner_domain text, retired_at timestamptz,
    UNIQUE (bank_id, account_no_digits)
);
```

Constraint turunannya: `CHECK ((is_company_account) = (ledger_account_code IS NOT NULL
AND site_id IS NOT NULL))`, `CHECK ((NOT is_company_account) = (party_type IS NOT NULL))`,
unik `is_primary` per site (partial, dari 0223), unik tujuan hidup per party
(partial, dari 0151). Trigger 0151 yang menolak nomor berbentuk kode akun COA
ikut pindah. `giro.bank` teks bebas (0117) → `bank_id` FK.

Sumber backfill: `company_bank_account` (is_company_account=1),
`payment_destination` (party), `supplier_bank_account` (party SUPPLIER),
`payroll_identity` (party EMPLOYEE; nomor dienkripsi masuk
`account_number_enc`). Empat tabel lama **drop** setelah pembaca Rust
dialihkan — tanpa view jembatan, sesuai kebiasaan rantai. Audit mencatat
`supplier_bank_account`, `payment_destination`, `giro` masih 0 baris dan
`company_bank_account` 2 baris seed: **ini jendela termurah untuk peleburan,
dan menutupnya berarti membayar dua kali**.

### 3.3 Payment Ledger — penyempurnaan ke bentuk ERPNext

`payment_ledger_entry` (0143) sudah 90% `payment_ledger_entry.json` ERPNext.
Yang ditambah 0303: kolom `account_type` (dari registry), tabel
`advance_payment_ledger_entry` (uang muka party sebagai ledger tersendiri —
padanan langsung `advance_payment_ledger_entry/` ERPNext, memberi rumah
resmi untuk `advance` 0280 dan `SUPPLIER_ADVANCE`), dan antrean
`repost_payment_ledger` untuk posting backdated yang menggeser alokasi.

### 3.4 `party_link` — pihak lintas peran

`party_link(primary_role CHECK (Customer/Supplier padanan: SUPPLIER/
CUSTOMER), primary_party, secondary_role, secondary_party)` dengan tiga
keunikan seperti validasi `party_link.py:33-66`. Netting antar-peran jadi
mungkin tanpa melebur register.

### 3.5 Auto-match counterparty (0304) — padanan `auto_match_party.py`

Ekstraksi digit dari `bank_statement_line` (reference/description) → cocokkan
`bank_account.account_no_digits` / `account_number_fingerprint` milik baris
party → tulis **usulan** (`party_proposal`, kembar `bank_rule_proposal` 0116),
manusia menerima → baris diisi `party_type/party_id/party_name`, `bank_said`
tetap tak tersentuh. Fuzzy fallback (rapidfuzz, skor sama → menolak) opsional,
default mati.

### 3.6 Pelengkap non-party

* **0305 `budget`** — satu-satunya master finance ERPNext tanpa padanan kita:
  `budget(site_id, account_code/category, period, amount_minor)`, cek di
  posting (tolak/ingat, keputusan pemilik), varian di layar.
* **0306 mesin defer** — generalisasi 0278 (`a prepayment is used up a month
  at a time`) jadi jadwal amortisasi apa pun (prepaid rent, asuransi,
  langganan), padanan `process_deferred_accounting` + `deferred_revenue.py`.
* **0307 layar Ledger Health** — integrity runs 0123 + agreement 0145 + guard
  baru 0300 jadi satu layar monitor (padanan `ledger_health`/`ledger_health_monitor`
  v16); tidak ada tabel baru selain view.

## 4. Urutan eksekusi

**Progres 22 September 2026:** 0299, 0300, 0301 — **LANDED** (SQL + Rust +
endpoint; diterapkan di DB dev `inventory_edge_dev`, rantai 0001→301 bersih).
0302 SQL sudah ditulis dan berada di `backend/migrations/staged/` — **jangan
dipindah ke `migrations/postgres/` sebelum Rust-nya dialihkan**, karena
`MIGRATOR` meng-apply semua file saat startup `cloud`. Peta blast radius 0302
(terukur 22 September): `company_banks.rs` 5 fungsi, `supplier_banks.rs` 4,
`destinations.rs` 6 (termasuk `payment_destination_snapshot_for`; tabel
snapshot 0152 tetap sebagai riwayat, FK-nya saja yang lepas), http:
`finance.rs` 1, `mod.rs` 4, `payments_lane.rs` 4, `supplier_banks.rs` 7;
layar `finance-lab-2/bank-accounts.tsx` dan halaman supplier;
`giro.bank` → `bank_id`. `payroll_identity` tidak ikut merge (enkripsi butuh
kunci app; ERPNext sendiri mengecualikan Employee).

| # | Migrasi (nama kerja) | Isi satu kalimat | Rust yang ikut | Contract |
|---|---|---|---|---|
| 1 | `0299_a_party_is_named_by_a_registry_not_a_check.sql` | tabel `party_type` + seed; rename `party_kind`/`counterparty_kind` → `party_type`; FK dari tujuh tabel; backfill STAFF→EMPLOYEE | `advance.rs`, `cash.rs`, `payment_execution.rs`, `payment_ledger.rs`, `batches.rs`, `banking.rs` (literal KINDS dibaca registry) | ya — kolom JSON berubah nama |
| 2 | `0300_the_line_names_who_not_which_table.sql` | `party_type/party_id/party_name` di `journal_line`; backfill dari `supplier_id`; drop `supplier_id`; guard trigger akun-kontrol↔party (pengecualian EMPLOYEE dua arah, OPENING bebas) | `poster.rs`, semua pemanggil yang menulis `supplier_id` di jurnal | ya |
| 3 | `0301_an_account_can_be_chosen_by_the_party.sql` | `party_account` + modul `party.rs` resolusi berjenjang + endpoint CRUD | `party.rs` (baru), `http/` | ya |
| 4 | `0302_one_table_four_roles_one_bank_account.sql` | peleburan `bank_account` sesuai §3.2 + alih `giro.bank` | `company_banks.rs`, `supplier_banks.rs`, `destinations.rs`, `batches.rs`, `banking.rs`, layar supplier & cetak giro | ya |
| 5 | `0303_parties_link_and_advances_get_a_ledger.sql` | `party_link`; PLE `account_type`; `advance_payment_ledger_entry`; antrean repost | `payment_ledger.rs`, `advance.rs` | ya |
| 6 | `0304_a_line_proposes_its_own_counterparty.sql` | usulan party dari no. rekening (§3.5) | `banking.rs`, `http/money.rs` | ya |
| 7 | `0305_a_budget_is_a_promise_about_spending.sql` | master budget + cek posting | `budget.rs` (baru) | ya |
| 8 | `0306_a_prepayment_spreads_itself.sql` | mesin defer umum | `defer.rs` (baru, dari 0278) | ya |
| 9 | `0307_the_books_report_their_own_health.sql` | view + layar monitor | `reports` | ya |

Setiap migrasi membawa esai alasan (kebiasaan rantai), backfill idempoten,
dan guard `DO $$ ... RAISE EXCEPTION` di ekornya (kebiasaan 0298). Rename
constraint CHECK selalu restated-in-full (pelajaran 0257/0298).

## 5. Contract dan layar

Rust struct berubah nama field (`party_kind` → `party_type`) → `make contract`
wajib jalan setelah tiap fase, `contract-check` menjadi gerbang. Layar yang
menyentuh kosakata: `finance-lab-2/bank-accounts.tsx`, layar supplier, layar
rekonsiliasi (R0–R4 tetap jalan; mereka membaca kolom lewat nama baru —
direkonsiliasi di fase 1 bukan fase 4). Endpoint baru: CRUD `party-type`,
`party-account`, `party-link`, `party-proposal accept`, `budget`.

## 6. Verifikasi (mengikuti urutan repo)

1. `make db` — dev DB hidup; migrasi otomatis saat startup `cloud`
   (`MIGRATOR`, `postgres/mod.rs:235`).
2. Tes integrasi tertarget baru per fase di `backend/tests/` — menguji
   invarian baru, bukan plumbing: FK registry menolak kosakata asing; guard
   0300 menolak baris Receivable tanpa party dan menerima pengecualian
   EMPLOYEE; resolusi 0301 jatuh ke semantic key lalu menolak; backfill 0302
   mempertahankan hitungan (2 company + 0 + 0 + N payroll → jumlah baris
   sama); usulan 0304 tidak pernah menimpa `bank_said`.
3. Smoke: `make run-cloud` + `workplace-smoke.mjs` untuk jalur uang yang
   tersentuh fase itu.
4. Unit hanya kalau kegagalan integrasi menunjuk fungsi terisolasi.

**Terima bila** (per fase, contoh fase 1): dev DB naik tanpa manual step;
tujuh tabel memakai satu nama kolom; tidak ada baris STAFF tersisa;
`contract-check` hijau; tes integrasi fase hijau.

## 7. Risiko

* **Jendela dua-lane 0302** — antara migrasi dan alihan pembaca Rust, kode
  lama menunjuk tabel yang tidak ada. Mitigasi: satu commit atomik
  migrasi+Rust per fase; `cloud` startup menolak jalan kalau migrasi
  maju tanpa binari baru (sqlx checksum).
* **Contract drift** ke lima frontend — mitigasi §5.
* **Penyimpangan dua yang diaku** (§0, §2) — sudah ditulis di atas dan akan
  ditulis ulang di badan migrasinya.
* **R0–R4 bank reco bentrok nama kolom** — fase 1 mengubah nama yang layar
  itu baca; mitigasi: rekonsiliasi dilakukan di fase 1, bukan didefer.
* **Volume data** — hampir semua tabel penerima masih 0 baris (audit §4);
  risiko backfill rendah **hari ini**, naik setiap hari data masuk.

## 8. Yang tidak ditiru — dan mengapa (tetap berdiri)

Multi-company (estate satu perusahaan), multi-currency aktif dan FX
revaluation (GL single IDR; kolom `currency` 0269 sudah menunggu),
Finance Book, mesin pajak generik `taxes_and_totals.py` (pajak kita konkret
Indonesia), Dunning/Invoice Discounting/Bank Guarantee/Payment Request-Gateway
(bentuk bisnis B2C retail; QRIS/EDC lewat tender+acquirer). Mekanika A —
satu pintu posting, jurnal append-only, `account_map` — tetap
(finance.md §0 putusan 3; ERPNext tidak punya padanan yang lebih baik).

## 9. Keputusan terbuka untuk pemilik

1. `MEMBER.account_type` — NULL (usulan: bukan akun kontrol) atau RECEIVABLE?
2. Guard budget 0305: tolak atau ingatkan saat melampaui?
3. Fuzzy matching 0304: ikut `enable_fuzzy_matching` ERPNext (default mati)?
