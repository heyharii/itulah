# Finance — COA: empat lapis, dan di mana setiap nama klien hidup

> **SUPERSEDED (25 Sep 2026).** The "43 akun final" model described below was
> retired by `FINANCE-CONNECT-BRIEF.md`: the chart the domains post to is now
> the **267 active client leaves seeded by migration `0348`**, mapped from
> meanings through `account_map`. The four-layer model below (posting account /
> category / register / report) still explains *why* the client's 381 names
> collapse, but the posting layer is 267 client codes, not 43 minted ones.
> Use `FINANCE-HARD-RULES.md` as the canonical summary, and
> `runs/finance-connect/2026-09-25/ACCOUNT-DECISIONS.md` for meaning→account.

**Status:** historical, kept for the reasoning. Menggantikan versi dokumen ini yang
mendeskripsikan bagan 7.528 baris — model itu sudah tidak ada.
**Sumber keputusan:** `COA_381_Owner_Domain.xlsx` (381 akun natural klien, sumbu unit
dibuang) · migrasi `0287`–`0294` (pemipihan bagan) · migrasi `0315` (jembatan penuh).

## Modelnya

| Lapis | Isi | Angka | Identitas |
|---|---|---:|---|
| **Akun posting** | perlakuan akuntansi yang berbeda | **43** daun aktif, 8 akar | kode akun (`6301`) |
| **Kategori** | pertanyaan yang berbeda | **153** | `category_code` + `legacy_code` |
| **Register** | benda yang berbeda | tanpa batas | `fixed_asset_id`, `bank_account`, `asset_class` (59 kelas) |
| **Laporan** | tampilan yang diinginkan | bebas | template; bentuk 381/7.528 bisa dihasilkan ulang sebagai view |

Aturan pertumbuhan: perlakuan baru → akun (rare, keputusan pemilik); pertanyaan baru →
kategori (murah); benda baru → baris register (gratis); tampilan baru → template.

## Ke mana 381 itu pergi

| Tujuan | Baris | Contoh |
|---|---:|---|
| `ACCOUNT` — langsung salah satu dari 43 | 85 | Modal Setor→3101, Outstanding Giro→2103, Pinjaman Bank→2501 |
| `CATEGORY` — akun + kategori | 99 | listrik→6301+`BIAYA_PEMAKAIAN_LISTRIK`, THR→6201+`TUNJANGAN_HARI_RAYA` |
| `CLASS` — register aset (`asset_class`) | 174 | 37 jenis OE, akumulasi, RR, depresiasi per kelas → 1601/1609/1610/1619/7101 |
| `BANK` — register rekening | 14 | giro/tabungan/deposito per bank → 1102 + `bank_account` |
| `QUALIFIER` — alasan antar unit | 9 | tiga keluarga afiliasi → 1501 + `FINANCING`/`GOODS`/`INTERUNIT_OTHER` |

Kategori baru yang ditambahkan jembatan: `ACCRUAL_OTHER`, `DISPOSED`, `ONLINE`,
`SHOPPING_BAG` — empat saja; 381 sisanya dijawab pustaka yang sudah ada.

## Jembatan migrasi

`ledger_account_remap` kini memuat **565 baris** — 188 warisan pemipihan plus satu
baris untuk **setiap** kode representatif 381 (`legacy_code` → `new_code` 43-akun →
`category_code` bila ada → `note` menyebut kelas/qualifier/bank). Verifikasi:
semua `new_code` adalah daun aktif; nol kategori tak dikenal; tidak ada kode ganda.

Skrip yang menghasilkan dan meninjau ulang pemetaan: `scripts/coa381_final.py`
(membaca xlsx + database, menulis tabel keputusan `/tmp/coa_final.tsv`).

## Kepemilikan domain (dari file, tetap berlaku)

Finance memegang klasifikasi dan uang; domain memegang peristiwa: GA 222 baris
(sebagian besar register aset), Finance 77, HR 28, Sales/POS 26, Inventory 22,
Procurement 6. Detail di `docs/finance.md` dan `FINANCE-ARCH-PLAN.md`.

## Yang masih terbuka

- `2402 Kewajiban Poin Member` masih `BLOCKED` menunggu keputusan pemilik.
- Dua penulis domain belum menyala: COGS (Inventory) dan sertifikasi domain di
  tutup buku — jalur P1/P2 di `FINANCE-ARCH-PLAN.md`.
