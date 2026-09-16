# Cutover: dari buku lama ke Retail OS

## Jalur saldo awal

Satu pintu: `POST /api/v1/finance/opening/balances`, `source_kind = 'OPENING'`.
Bukan jurnal manual — kernel posting menolak kas lewat jurnal tangan sejak 0261,
dan saldo awal bukan koreksi.

Berkasnya bentuk klien sendiri:

```
site_id,account_code,debit,credit,document_no,memo
dc,1011001001,122401000,,TB-2026-08,Saldo awal kas
dc,3013001001,,122401000,TB-2026-08,Modal setor awal
```

Yang divalidasi impor:

- **seimbang per unit** — sebuah tempat yang debitnya tidak sama dengan
  kreditnya ditolak, karena selisihnya akan mendarat di tempat yang tidak dipilih
  siapa pun;
- **periode cutover harus dibuka** — saldo awal bertanggal hari terakhir sistem
  lama, dan entri tetap harus mendarat di periode yang seseorang buka;
- **akun berdimensi perusahaan hanya di kantor pusat** — `3013001001 Modal Setor`
  ditolak di toko dengan menyebut alasannya;
- **rehearsal adalah run yang sama** — `commit` default `false`: ia mem-parse,
  me-resolve, memposting, dan me-rollback.

## Akun kontrol harus cocok dengan pendukungnya

Untuk tiap akun kontrol, saldo awal harus punya jadwal pendukung:

| kontrol | pendukung yang harus ikut |
|---|---|
| Bank | rekening nyata + saldo per rekening |
| Hutang supplier | daftar faktur terbuka |
| Persediaan | **belum bisa** — belum ada metode kos |
| Aset tetap | register aset (1.328 baris klien sudah diimpor) |
| Prepaid | jadwal yang masih berjalan |
| Pajak | saldo per jenis dan per masa |
| Uang muka | daftar uang muka yang masih di tangan orang |
| Pembiayaan | jadwal angsuran per fasilitas |
| Antar unit | pasangan piutang/hutang yang harus nol |

**Tidak ada akun penyeimbang.** Selisih antara saldo awal dan jadwal
pendukungnya ditampilkan panel kontrol sebagai selisih dan dibiarkan terlihat.
Menutupnya dengan akun suspense berarti memindahkan pertanyaan ke tempat yang
tidak akan ditanyakan lagi.

## Peta akun lama → Retail OS

`ledger_account_remap` menyimpan pemetaan kode lama ke kode sekarang (dipakai
0244 saat bagan dikumpulkan). Pemetaan tidak memindahkan saldo; ia hanya
mengatakan baris lama ini sekarang bernama itu.

Delapan akun yang kodenya milik kita — bukan klien — ditandai
`ledger_account.code_provenance = 'PENDING_CLIENT_CODE'` (0277). Saat klien
mengeluarkan kode resminya: satu `UPDATE` per akun dan satu baris di
`ledger_account_remap`. Tidak ada jurnal yang bergerak.
