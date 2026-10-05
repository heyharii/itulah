# The dynamic estate — connected, admin-editable, no developer for routine change

**Status:** plan of record, written 28 Sep 2026 (evening). Sumber: architecture
review 28 Sep 2026 (cloud, DC, store, handheld/tablet, customer, pos-desktop,
deploy) + finance kernel/scope review + audit
[`INCONSISTENCY-AUDIT-2026-09-28.md`](INCONSISTENCY-AUDIT-2026-09-28.md).

Tujuan satu kalimat, meminjam keputusan owner 27 Sep (*"sedinamis ERPNext
tanpa developer"*):

> Setiap perubahan yang hanya **menambah instance** — EDC, bank, akun, link
> akun, metode pembayaran, komponen gaji, toko, perangkat, kebijakan —
> dikerjakan seorang Admin dari layar, tanpa commit, tanpa release, tanpa
> developer.

Dua kalimat penegas batas, supaya goal ini tidak berbohong pada dirinya
sendiri:

> **"Terhubung dan modular" tidak menghapus development; ia memindahkannya.**
> Developer membangun mekanisme sekali; Admin mengubah isinya selamanya.
> Ada satu gelombang penyelesaian (Fase 0–3 di bawah) yang harus dikerjakan
> sebelum kalimat di atas menjadi benar, dan ada himpunan tertutup perubahan
> yang **selamanya** milik developer (§7).

Dokumen pembanding yang sudah ada dan tidak digantikan oleh file ini:
[`STORE-SERVER-PLAN.md`](STORE-SERVER-PLAN.md) (server toko),
[`FINANCE-HARD-RULES.md`](FINANCE-HARD-RULES.md) (invarian finance),
[`docs/finance-posting-kernel.md`](docs/finance-posting-kernel.md) (kernel).
File ini yang mengatur **gelombang penyelesaian lintas domain** menuju
estate yang dinamis penuh.

---

## 0. Rulings — sudah diputuskan, jangan diligitasi ulang di tengah file

| Pertanyaan | Ruling |
|---|---|
| Rules engine / dynamic form builder? | **Tidak.** Setiap konsep dapat pola 4 lapis (§2): tabel bertipe, validasi saat save, refuse-dengan-kalimat, changelog+gate. Engine generik menghancurkan properti tipe dan exhaustiveness yang membuat estate ini kuat. |
| Apa yang boleh jadi data? | **Instance.** Baris di `edc_terminal`, `payment_method`, `ledger_account`, `account_link`, `job_role`, `pool_template`, `asset_class`, `flow_template`, publication. |
| Apa yang tetap kode? | **Kosakata.** `MovementCause`, `PoolRole`, `source_kind`, tender kind, `CommercialChannel`, rung auth, `HAND_KEYED_KINDS`. Aturan praktis: mengubahnya mengubah cara *membaca data lama* → kode; hanya menambah instance → baris tabel. Bukti payung: dua kosakata `PoolRole` dan dua `MovementCause` (audit §A3/§A6) sudah menghasilkan drift, bukan fleksibilitas. |
| Unresolved = default? | **Tidak pernah.** Satu-satunya pelanggaran hari ini (`kind_for_source` default diam ke PEMBIAYAAN) ditutup di Fase 0. Standar estate: `resolve_account` tanpa fallback, penolakan menyebut qualifier yang ada. |
| Layar Admin tinggal di mana? | **frontend-hub**, satu konsol. `frontend-cloud` mati setelah migrasi CLOUDHUB selesai (lihat §4 Fase 0.1). |
| Bagaimana konfigurasi sampai ke toko? | **Signed command lane** (pola `payment.methods.replace`), tidak pernah HTTP langsung dari browser ke node. |
| Approval untuk perubahan konfigurasi? | **Changelog tanpa approval** (keputusan P1, 27 Sep, mengikuti ERPNext/7Soft). Penggantinya adalah coverage gate di CI (§4 Fase 3), bukan antrian persetujuan. |

---

## 1. Di mana kita hari ini — katalog yang sudah jalan (bukti)

Yang berikut **sudah** self-service hari ini; Fase-fase berikut tidak
membangunnya, hanya menyelesaikan sisa di sekitarnya.

| Kemampuan | Mekanisme | Bukti |
|---|---|---|
| Tambah EDC terminal (toko ↔ bank) | `POST /finance/edc-terminals` → `edc_terminal` | `cloud/postgres/finance_setup.rs:35-52, 181-217` |
| Set MDR per bank/jenis | `acquirer_fee_rate`; settlement cek variance | `finance_setup.rs:57-70`, `acquirer.rs` `mdr_check` |
| Tambah bank baru | "Tambah bank": buat leaf + map receivable/fee/dispute + seed method & terminal | `finance_setup.rs:113-117, 433-542` |
| Metode pembayaran baru (e-wallet/bank) | `payment_method` — *"a row here and its links, not a release"*; role akun digenerate `payment_method_roles`; `unlinked_roles` per unit terhitung | `payment_methods.rs:6-7, 76-87` |
| Aktifkan metode per toko | `payment_method_site`; site baru otomatis CASH | `http/finance.rs:723-741`, `setup.rs:651-655` |
| Distribusi ke kasir | `payment.methods.replace` → node → `/store/payment-methods` → cache till | `bin/cloud.rs:247-251`, `sync.rs:5350`, `edge/http.rs:438-439` |
| QRIS tanpa terminal terdaftar | Exception queue yang menyuruh operator daftarkan terminal di Finance | `domain/sales_posting.rs:362-366` |
| Tambah/pindah/freeze akun + link | Chart editor + Account Links per UNIT/KIND/ALL, changelog | P1, `0461`, `0460/0465/0606`, layar `0471` |
| Kebijakan akun | `posting_mode`/`manual_je_policy`/`account_source_rule` dari layar; registry external-party | `0261-0268`, `0471`; gate `posting_policy_configured` + `tests/posting_policy_coverage.rs` |
| Tutup periode | Period Closing Voucher (I10, 27 Sep) | `period_close.rs`, `0464` |
| Komponen gaji → akun | `account_link` source `PAY_COMPONENT` | `0466`, `account_links.rs:239` |
| Job role (+rung/section/flow role/sign-in server) | Data Admin edit + override `0472` | `domain/job_role.rs` |
| GA: kelas aset, makna, periode pre-opening | `asset_class` data; link P9; setting | P9, `finance_setting` |
| Site/unit baru → pool otomatis | `pool_template` per site_kind + trigger | `0610`, `setup.rs:13-22` |
| Harga/assortment/pajak/override per site | Commercial publication DRAFT→PUBLISHED | `commercial_publication` et al. |
| RFID reader / punch station / printer | Register + rotate dari hub | `auth_policy.rs:718-760`, `devices.rsx` |
| Kasir baru | Self-join (kode + approval supervisor) | `pos-desktop/src-tauri/src/join.rs` |
| Node baru | Enrolment code + verifikasi telepon | `STORE-SERVER-PLAN.md` §2 |
| Kontrol node dari jauh | `node.*` signed commands | `sync/node_ops.rs` |

---

## 2. Arsitektur yang membuat ini possible — pola 4 lapis + 3 penghubung

```text
┌─ PER KONSEP ───────────────────────────────────────────────────┐
│ 1. Tabel bertipe     edc_terminal · payment_method ·            │
│                      account_link · job_role · pool_template    │
│ 2. Validasi save     posting_role cek tipe akun; qualifier      │
│                      divalidasi ke tabel asalnya                │
│ 3. Refuse + kalimat  unmapped meaning → nama makna + unit +     │
│                      qualifier yang tersedia (tidak pernah      │
│                      default)                                   │
│ 4. Changelog + gate  ledger_account_change ·                    │
│                      posting_policy_configured + test CI        │
└─────────────────────────────────────────────────────────────────┘
┌─ PENGHUBUNG ANTAR DOMAIN ──────────────────────────────────────┐
│ A. Katalog makna × unit  + coverage test                        │
│ B. Readiness dari fakta derivatif (model: postgres/stores.rs)   │
│ C. Distribusi via signed command lane ke node offline           │
└─────────────────────────────────────────────────────────────────┘
```

Lapis 3 dan 4 bukan hiasan: **dinamis tanpa refuse adalah sistem yang salah
diam; dinamis tanpa gate adalah sistem yang berhenti di tempat yang tidak
terlihat.**

---

## 3. Definition of done — skenario yang bisa dites

Setiap skenario: diukur **0 commit** pada repo.

| # | Skenario | Status hari ini |
|---|---|---|
| D1 | Tambah EDC + MDR + aktif per toko → 3 layar hub; kasir menawarkan metode baru setelah satu siklus sync | ✅ backend siap; ❌ hub belum dideploy (Fase 0.1) |
| D2 | Tambah akun + kaitkan ke makna di unit mana pun → 2 layar (chart editor + account links) | ✅ idem |
| D3 | Buka toko baru → 1 wizard; unit, org_place, link akun, PIC, metode, node enrolled; semua item hijau dari fakta, bukan checkbox | ❌ Fase 1.3 (butuh 0.2) |
| D4 | Ubah MDR / tambah komponen gaji / ubah periode prepaid → 1 layar | ✅ (hub) |
| D5 | Matikan metode pembayaran → kasir berhenti menawarkannya setelah siklus sync berikut | ✅ (verifikasi e2e sekali di Fase 3.1) |
| D6 | Second warehouse site (bukan `dc`) dibaca benar oleh semua layar hub | ❌ Fase 0.2 |
| D7 | Source_kind baru yang tak terdaftar → refusal bernama, bukan masuk keluarga PEMBIAYAAN | ❌ Fase 0.3 |
| D8 | Budget disetel dari layar; poster menolak lewat cap (dengan lock) | ❌ Fase 2.1 |
| D9 | Tagihan berulang (sewa) accrue + reverse otomatis lintas bulan virtual | ❌ Fase 2.2 |

---

## 4. Fase-fase

### Fase 0 — Prasyarat: membuat "dinamis" tidak bohong

Tanpa fase ini, semua tabel dinamis di §1 tetap ada tapi site/data baru salah
dibaca dan layarnya tidak hidup.

**0.1 Deploy frontend-hub + selesaikan proxy `/edge`.**
Dependensi: keputusan topologi (edge Render publik vs tailnet — review Deploy
S1). Dua opsi yang sah: (a) rewrite `/edge/*` di host statis hub ke node DC
target; (b) modul Operations hub direlay via cloud. Pilih satu, tulis di
sini, hapus opsi lain.
Selesaikan juga migrasi CLOUDHUB (`CLOUDHUB-BRIEF.md`) lalu **hapus
`frontend-cloud`** dari `Makefile FRONTENDS`, `render.yaml`, docs.
*Acceptance:* hub reachable di produksi, Operations membaca node DC nyata
(lewat SSO ticket), `make front` hanya mem-build app yang ada.

**0.2 Bunuh semua literal identitas.**
`frontend-hub/src/screens/inventory/shared.ts:145` (`WAREHOUSE_SITE_ID="dc"`),
`executive/stock.tsx:78`, `executive/places.tsx:36`;
`frontend-cloud/src/lib/allotments.ts:519-535` + `components/finance/position.tsx:228`
(matikan bersama app-nya); SQL masa depan meniru `head_office_site_id()`
(`0603:230-244`) — **migrasi lama tidak diedit**;
`tablet/.../TillViewModel.kt:583-586,617-618` (`DEFAULT_SITE="store-07"` +
kepercayaan pada prefix string terminal id → ganti site dari identitas node,
refuse bila tidak diketahui).
*Acceptance (D6):* site baru kind WAREHOUSE tampil benar di hub; tablet
dengan terminal id tak dikenal menolak posting, bukan menulis ke store-07.

**0.3 `kind_for_source` refuse.**
`domain/interunit.rs`: source_kind tak dikenal → `Validation` menyebut
kind-nya, bukan default PEMBIAYAAN. Tambahkan test paralel dengan
`finance_hard_rules`.
*Acceptance (D7).*

**0.4 Hygiene kecil:** pecah `.env.example` jadi `cloud.env.example` +
`edge.env.example` (dua definisi `INVENTORY_AUTH_MODE`, path SQLite di file
cloud — sumber node hybride).

### Fase 1 — Jaringan penghubung

**1.1 Katalog Makna × Unit (hub, System → Setup).**
Satu layar: baris per (makna, unit) dengan status resolve. Sumber:
`required_semantic_keys` (~78) finance + pendaftaran domain lain;
generalisasi pola `unlinked_roles` milik `payment_method`.
*Acceptance:* untuk setiap makna yang test
`every_meaning_a_writer_names_resolves_at_every_site` kenal, layar sepakat;
link yang dihapus muncul merah dalam satu refresh dengan kalimat penolakan
poster-nya sendiri.

**1.2 Daftarkan makna domain non-finance.**
PAY_COMPONENT (sudah), GA (P9), EDC/bank (sudah via payment_method_roles);
audit sisa: HR leave/claim kinds, tax template. Setiap domain yang menulis
jurnal wajib punya baris katalog + coverage test.

**1.3 Store-Open Wizard (hub).**
Urutan readiness **dari fakta derivatif**, model `postgres/stores.rs`
(*"a checkbox somebody ticks would say what they believed; this says what
is"*): unit+site → pool (otomatis dari template) → link akun resolve di unit
baru → org_place → `payment_method_site` (CASH otomatis) → EDC (opsional) →
PIC → enrolment node (kode + verifikasi). Setiap item merah = tombol ke
layar penutupnya. Ini menutup gap STORE-SERVER-PLAN §8 dengan tidak
mengubah model data.
*Acceptance (D3):* buka `store-14` percobaan end-to-end dari hub, 0 commit.

**1.4 Satu daftar capability node.**
`edge/status.rs` jadi satu-satunya sumber; `/health` membacanya; hapus
`STORE_INBOUND_CAPABILITY` yang mati (audit §A5).

### Fase 2 — Writer yang mesinnya sudah menunggu

**2.1 Budget:** endpoint CRUD + tampilan; perbaiki race `enforce_budgets`
(lock per akun; review finance R1).
**2.2 Recurring bill / jurnal berulang:** writer accrual + reversal atas
`journal_templates`/`journal_repeat` (`0473`); aktif tanpa
`finance_automation_enabled` untuk sweep yang owner minta jalan terjadwal.
**2.3 Supplier return:** **tertahan keputusan pemilik, bukan teknis** —
credit note tanpa quantity vs return menamai layer; wiring keduanya =
dobel Dr 2002/Cr 1029 (tercatat di `runs/finance-guards`). Plan ini hanya
mengunci: keputusan dulu, writer kemudian.
**2.4 Poin sebagai pembayaran (T3):** Finance menambah akun expense loyalty
dari chart editor (0 commit); menjadikan POINTS tender kind adalah satu
perubahan wire — **developer by design** (§7).

### Fase 3 — Distribusi & gerbang

**3.1 Audit distribusi:** setiap konfigurasi baru yang dibaca edge wajib
naik command lane (pola `payment.methods.replace`); auditi mana yang masih
pull-only atau tidak versioned.
**3.2 Coverage gate CI (generalisasi `posting_policy_configured`):**
tabel konfigurasi baru tanpa keputusan default = gagal test; registrasikan
response `json!` edge (envelope toko, member points) ke `frontend-contract`
supaya layar dinamis tidak mengetik tipe dua kali.
**3.3 Changelog untuk semua tabel dinamis** (pola
`ledger_account_change`): inventarisasi mana yang belum punya jejak.

---

## 5. Urutan & dependensi

```text
0.1 hub deploy ──┬──► 1.1 katalog ──► 1.2 ──► 1.3 wizard (butuh 0.2)
0.2 literal ─────┘              └───► 1.4
0.3 refuse ──► (mandiri)
Fase 2 (2.1/2.2 mandiri; 2.3 menunggu keputusan; 2.4 setelah T3 akun ada)
Fase 3 setelah 1.1 (katalog) dan 2.1 (budget) — gate menutup yang terbuka
```

Fase 0 dan 2.1/2.2 bisa paralel. Fase 1.3 adalah item bernilai terbesar
(membuka 30-toko scale tanpa koordinasi manual) tapi bergantung 0.1+0.2.

## 6. Non-goals

- Tidak membangun rules engine / form builder / workflow designer generik.
- Tidak menjadikan kosakata domain data (§0 ruling).
- Tidak menambah konsol kedua; satu hub.
- Tidak memulai produk ke-enam (`frontend-page`/link-in-bio) sebelum D1–D3
  hijau.

## 7. Himpunan tertutup: yang selamanya developer

1. Kosakata baru: tender kind (POINTS), cause, channel, source_kind,
   pool role — mengubah cara membaca data lama.
2. Perubahan wire contract: sync fact/command, tipe `frontend-contract`
   yang lahir dari struct Rust.
3. Bug, performa, dan keamanan.

Di luar tiga itu: baris tabel + link + layar yang sudah ada. Jika sebuah
perubahan rutin ternyata butuh developer, itu **bug terhadap plan ini** —
catat sebagai pelanggaran D1–D9, bukan diterima sebagai normal.

## 8. Ikut tapi bukan scope file ini (dilacak terpisah)

Koreksi benar yang ditemukan review arsitektur dan **tidak** ditutup di
sini karena bukan syarat goal dinamis: posted-day drift
(`sales_posting.rs:1820-1845` + sweep `bin/cloud.rs:499-535`), kontrol
`stock.value_vs_gl` yang belum teregistrasi, trigger afiliasi G1, decoder
BCD tablet, update channel pos-desktop, keputusan topologi Render-vs-
tailnet (dependensi 0.1, keputusannya sendiri di luar file ini).
