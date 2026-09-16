# Rekening bank perusahaan — apa yang harus dikumpulkan

Phase 2B bagian B. Template: `docs/templates/company-bank-accounts.csv`.
Satu baris = satu rekening nyata. Baris kedua di template sengaja kosong: itu
bentuk baris untuk rekening yang **kita tahu ada tapi datanya belum lengkap**.

## Kolom, dan mana yang benar-benar wajib

| kolom | wajib? | kalau kosong | catatan |
|---|---|---|---|
| `bank_code` | **wajib** | ditolak | Salah satu dari enam yang sudah ada: `BCA MANDIRI BRI BNI BTN DANAMON`. Bank ketujuh perlu migrasi tersendiri — institusi bukan sesuatu yang lahir dari mengetik nama. |
| `account_no` | **wajib** | ditolak | Boleh ditulis dengan tanda hubung; identitas dihitung dari digitnya (`1234-5678` = `12345678`). 5–25 digit. |
| `account_holder` | **wajib** | ditolak | Nama yang tercetak di rekening. Sering BUKAN nama legal perusahaan untuk rekening operasional toko — tulis apa adanya, karena giro dicetak dari sini. |
| `kind` | **wajib** | ditolak | `GIRO` · `SAVINGS` · `TIME_DEPOSIT`. `GIRO` sengaja bukan `CURRENT`: itu kata klien sendiri dan kata yang tercetak di `1011002 CASH IN BANK GIRO`. |
| `ledger_account_code` | **wajib** | ditolak | Akun natural tempat saldonya duduk. Harus akun postable (bukan heading). Dua rekening nyata **boleh** menunjuk akun yang sama — itu justru yang 0269 buka. |
| `site_id` | **wajib** | ditolak | Hari ini selalu kantor pusat. Toko tidak memegang rekening eksternal; yang toko punya adalah TUJUAN setoran (`store_bank_destination`). |
| `currency` | opsional | `IDR` | Satu-satunya nilai yang dipakai hari ini. Ada sebagai kolom karena rekening valas adalah barang nyata yang dijual bank, dan begitu ada, rekonsiliasi harus menolak menjaringkannya dengan rupiah. |
| `status` | opsional | `ACTIVE` | `ACTIVE` · `DORMANT` (ada, tak dipakai) · `CLOSED` (ditutup). `CLOSED` harus disertai tanggal penutupan — pakai layar retire, bukan impor. |
| `is_primary` | opsional | otomatis | Rekening pertama di satu tempat jadi primary-nya. Yang dipakai kalau tak ada yang menyebut rekening — mis. giro dicetak dari sini. **Satu per tempat**, ditegakkan index. |
| `opened_at` | opsional | kosong | Tanggal rekening dibuka, kalau klien punya catatannya. Tidak menahan apa pun. |
| `branch` | opsional | kosong | Cabang. Muncul di cetakan giro sebagian bank. |
| `note` | opsional | kosong | Untuk manusia. |

**Empat kolom di brief yang TIDAK ada di sini:**
`bank_id` (diturunkan dari `bank_code`), `account_name` (itu `account_holder`),
`account_type` (itu `kind`), `closed_at` (itu `retired_at`, diisi oleh layar
retire supaya tanggal dan status tak bisa berselisih).

## Jalur API

`POST /api/v1/finance/bank-accounts` — satu rekening per panggilan.

```json
{
  "bank_code": "BCA",
  "account_no": "1234567890",
  "account_holder": "PT Contoh Busana Nusantara",
  "kind": "GIRO",
  "ledger_account_code": "1011002001",
  "site_id": "dc",
  "is_primary": true,
  "branch": "KCP Sudirman",
  "note": "operating account"
}
```

Mengirim nomor yang sama dua kali adalah **koreksi**, bukan rekening kedua:
identitas rekening adalah `(bank, digit nomor)`. Mengirim nomor BERBEDA pada
akun natural yang sama membuat rekening kedua — itu yang dimaksud "dua rekening
nyata boleh berbagi satu GL".

`bank_name` (teks) masih diterima demi layar lama, tapi ia **diselesaikan** ke
institusi dan **ditolak** kalau tak cocok. Mengetik "PT Bank Central Asia" tidak
lagi melahirkan bank ketujuh.

Rekening lain:
- `POST /api/v1/finance/bank-accounts/{id}/retire` — menutup (status jadi
  `CLOSED`, tanggalnya tercatat).
- `GET /api/v1/finance/banks` — enam institusi, dengan jumlah rekening kita,
  rekening pemasok, dan saldo buku kita di tiap bank.
- `GET /api/v1/finance/banking-readiness` — **apa yang masih kurang**. Kosong
  berarti selesai.

## Urutan yang benar

1. Petakan meaning-nya dulu atau belakangan — urutannya bebas, tapi **memetakan
   tanpa mendaftarkan rekening akan menghentikan posting** ke akun itu. Itu
   disengaja: peta adalah pernyataan "uang giro BCA kita ada di sini", dan
   pernyataan tanpa rekening adalah saldo bank yang tak bisa direkonsiliasi.
2. Daftarkan rekeningnya lewat template/API di atas.
3. Cek `GET /api/v1/finance/banking-readiness` sampai kosong.
4. Baru impor rekening koran. Statement wajib menyebut rekening nyata sejak
   0271; impor akan menolak kalau belum ada, dan menyebut nama layarnya.

## Yang tidak boleh dilakukan

- **Jangan mengarang rekening dari COA.** Chart menyebut enam bank di 14 akun;
  itu jenis saldo yang boleh ada, bukan bukti rekeningnya hidup. Lihat
  `docs/finance-bank-audit.md` §C.
- **Jangan membuat rekening per toko.** Kalau sebuah toko benar-benar memegang
  rekening atas namanya sendiri, itu perubahan asumsi bisnis — berhenti dan
  laporkan, jangan bikin 13 salinan.
