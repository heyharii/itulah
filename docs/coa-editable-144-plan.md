# Rencana Chart of Accounts Editable — Seed 144

## Keputusan

Chart of Accounts baru memakai **144 posting account hasil pemetaan COA client** sebagai seed awal. Angka 144 bukan batas permanen. Finance dapat menambah, mengganti nama/kode, memindahkan grouping, dan menonaktifkan account melalui Account Master dengan guardrail.

Unit tidak lagi menjadi bagian kode account. Unit/HO disimpan sebagai `cost_center_id` atau `site_id` pada journal line. Bank, supplier, aset, pinjaman, principal, dan pihak lain tetap berada di master/subledger masing-masing.

Sistem tidak boleh mencari account berdasarkan kode atau nama. Modul memilih peran akuntansi stabil melalui assignment, kemudian memperoleh `account_id` yang berlaku. Kode dan nama account dapat berubah tanpa memutus modul atau histori.

## Kondisi saat ini

- Sumber client: 7.528 baris COA, 6.908 kandidat posting, 499 family setelah unit dilepas.
- Workbook final: 144 target; 6.894 detail account dipetakan, 14 detail laba berjalan diturunkan sistem, dan tidak ada detail posting yang menggantung.
- Repository resmi (`HEAD`) masih berhenti pada migration 0286. Database yang terpasang harus diverifikasi, tetapi bukti internal menunjukkan model sekitar 190 posting account.
- Migration 0287–0297 yang menghasilkan 43 leaf account masih berada di working tree dan belum boleh dianggap sudah berjalan di cloud.
- API dan UI Chart of Accounts saat ini bersifat baca saja.
- Journal lama bersifat append-only dan tidak boleh ditulis ulang.

Implikasinya: pekerjaan berikut tidak boleh dimulai dengan asumsi cloud sudah memakai 43 akun. Pertama-tama kita harus mencatat versi migration yang benar-benar terpasang. Setelah itu kita menambahkan model Account Master yang stabil, seed 144, memindahkan account map dan aturan posting ke 144, lalu mempertahankan account 190 dan, bila migration eksperimental 43 pernah dipakai di suatu environment, account 43 sebagai histori/alias.

Mapping artifact berisi 7.528 baris: 6.894 detail account berstatus `MAPPED`, 619 hierarchy/non-posting, dan 15 baris `SYSTEM_DERIVED`. Empat belas detail laba berjalan tidak dipetakan sebagai account posting baru karena nilainya diturunkan sistem.

## Prinsip model

### Account

```text
account
- id UUID / stable internal id, immutable
- company_id
- code
- name
- parent_account_id nullable
- root_type: ASSET | LIABILITY | EQUITY | INCOME | EXPENSE
- account_type
- normal_balance: DEBIT | CREDIT
- is_group
- is_postable
- is_active
- control_class: SYSTEM_CRITICAL | CONTROL | NORMAL
- posting_policy: MANUAL_ALLOWED | MANUAL_APPROVED | SEMI_AUTO | AUTO_ONLY | SYSTEM_ONLY
- currency nullable
- effective_from
- effective_to nullable
- replacement_account_id nullable
- created_by / created_at
```

`account.id` menjadi foreign key journal dan subledger. `code` unik dalam company pada masa berlakunya, tetapi bukan primary key.

### Assignment peran sistem

Gunakan tabel assignment, bukan satu kolom tunggal yang hanya dapat menampung satu peran:

```text
account_role_assignment
- id
- company_id
- role
- scope_type: COMPANY | SITE | BANK_ACCOUNT | ASSET_CLASS | TAX_KIND | ...
- scope_id nullable
- account_id
- effective_from
- effective_to nullable
- is_required
- priority
```

Contoh role awal: `INVENTORY_ASSET`, `INVENTORY_TRANSIT`, `COGS`, `INVENTORY_DAMAGE`, `AP_TRADE`, `AR_ACQUIRER`, `CASH_ON_HAND`, `PETTY_CASH`, `CASHIER_FLOAT`, `BANK`, `OUTSTANDING_GIRO`, `FIXED_ASSET_COST`, `ACCUMULATED_DEPRECIATION`, `CIP`, `INTANGIBLE_COST`, `ACCUMULATED_AMORTIZATION`, `TAX_ASSET`, `TAX_PAYABLE`, `INCOME_TAX_EXPENSE`, `BANK_LOAN`, `PRINCIPAL_LOAN`, `RETAINED_EARNINGS`, dan tiga role afiliasi.

### Governance dan histori

```text
account_alias
- account_id
- former_code
- former_name
- valid_from
- valid_to

account_version
- account_id
- version
- snapshot_json
- effective_from
- effective_to
- approved_by

account_dimension_policy
- account_id
- dimension
- requirement: REQUIRED | OPTIONAL | FORBIDDEN | DERIVED
- allowed_values/rule nullable

account_change_request
- requested operation and before/after
- impact preview
- status
- requested_by / approved_by / applied_at

account_change_log
- immutable audit event
```

## Tiga kelas account

### System-critical

Persediaan, barang dalam perjalanan, HPP, kerusakan/cadangan persediaan, retained earnings, dan pembulatan. Modul bergantung pada account-role assignment-nya. Account ini tidak dapat dihapus atau dinonaktifkan selama role aktif. Perubahan type, root, role, atau parent memerlukan preview dan approval.

### Control

Kas, petty cash, modal kasir, bank, outstanding giro, AP/AR, accrual, payroll payable, prepaid, pajak, aset, software, CIP, HGB, pre-opening, pinjaman, principal, dan afiliasi. Pada fase awal dapat memakai `MANUAL_APPROVED`; setelah modul siap policy dinaikkan menjadi `SEMI_AUTO` atau `AUTO_ONLY`.

### Normal

Mayoritas pendapatan dan beban operasional. Finance dapat membuat account baru, rename, reparent, dan disable selama root/type tetap valid dan tidak mematahkan laporan.

## Guardrail perubahan

1. Group account tidak boleh menerima posting; hanya leaf aktif dan postable.
2. Parent harus group, berada dalam company yang sama, dan tidak boleh membentuk siklus.
3. Account yang pernah dipakai tidak boleh dihapus. Gunakan disable dengan tanggal efektif.
4. Disable control account hanya boleh jika saldo nol, tidak ada open item, schedule, recurring entry, default, atau role aktif; account pengganti wajib jika masih dirujuk.
5. Code/name boleh berubah. Alias lama dan audit trail selalu disimpan.
6. Perubahan `root_type`, `account_type`, `normal_balance`, currency, atau group/leaf setelah transaksi dilarang, kecuali melalui proses migrasi khusus.
7. Reparent account bertransaksi harus menampilkan dampak terhadap Neraca/Laba Rugi, laporan historis, mapping, dan rule sebelum approval.
8. Posted journal tidak boleh diedit atau dihapus. Koreksi menggunakan reversal.
9. Account inactive tidak muncul di selector transaksi baru, tetapi tetap tampil dalam histori dan laporan periode lama.
10. Semua P&L wajib memiliki unit/cost center, baik dipilih user maupun diturunkan dari dokumen sumber. Transaksi HO memakai cost center HO.
11. Permission terpisah dari dimensi. `owner_unit_id` rekening bank dipakai untuk pelaporan; hanya Finance HO yang memperoleh akses dan hak posting.
12. Supplier, bank account, asset, facility, principal, customer, dan tax kind bukan accounting dimension generik bila sudah memiliki subledger/master sendiri.

## Perilaku UI

Chart of Accounts ditampilkan sebagai tree berbasis `parent_account_id`. Keputusan presentasi root harus ditetapkan secara eksplisit: mempertahankan delapan root client atau memetakannya ke lima root laporan (Asset, Liability, Equity, Income, Expense). Group dan posting account dibedakan secara visual. Kode tidak lagi menentukan hierarchy.

Finance memperoleh aksi berikut:

- Add Group
- Add Account
- Edit name/code
- Move to another parent
- Disable/Reactivate
- Replace Account
- View mapping and role usage
- View journal/history
- View change history

Form Add/Edit menampilkan field berdasarkan kelas account. Untuk normal account, form singkat. Untuk control/system-critical, tampilkan account type, policy, dimension rules, role assignments, dan approval.

Sebelum Move, Disable, Replace, atau perubahan sensitif, UI menampilkan Impact Preview:

- saldo dan jumlah journal line
- open items dan schedule aktif
- modul/system role yang memakai account
- laporan dan grouping sebelum/sesudah
- recurring/template/mapping yang terdampak
- alasan penolakan bila perubahan tidak aman

Selector jurnal hanya menampilkan leaf yang aktif, postable, diizinkan policy, dan cocok dengan tanggal serta konteks transaksi.

## Migrasi dari kondisi sekarang

### Fase 0 — Bekukan kontrak bisnis

- Periksa tabel migration pada setiap environment dan catat apakah titik awalnya 190 atau pernah menerima rangkaian 0287–0297.
- Putuskan nasib migration 0287–0297 sebelum commit/deploy; jangan menjalankannya menuju 43 bila 144 telah menjadi target final.
- Tetapkan workbook 144 sebagai source seed.
- Lengkapi 144 dengan tree, root/type, normal balance, control class, posting policy, role, dan dimension policy.
- Tutup tiga keputusan: cost center wajib untuk seluruh P&L; Disposed Inventory sebagai clearing/expense; dan alur Purchase → Inventory → HPP.

### Fase 1 — Tambahkan identity dan governance

- Tambah stable `account_id`; pertahankan `account_code` sebagai business key.
- Tambah alias, version, role assignment, dimension policy, change request, dan audit log.
- Backfill ID untuk seluruh account yang benar-benar terdapat pada environment; 43 hanya disertakan bila pernah diterapkan.
- Tambahkan `journal_line.account_id` secara nullable dan lakukan dual-write bersama snapshot kode lama selama masa kompatibilitas.
- Ubah foreign key dokumen dan journal secara bertahap ke `account_id` tanpa menulis ulang nilai ekonomi jurnal.

### Fase 2 — Seed 144 dan bridge

- Impor 144 sebagai account aktif baru beserta hierarchy.
- Jadikan account lama yang terdapat pada environment inactive untuk posting baru setelah cutover, tetap dapat dibaca pada histori.
- Buat bridge `legacy account → account 144`, termasuk 6.894 detail yang dipetakan, 499 family, sekitar 190 account unit-free, dan 43 account intermediate hanya jika pernah diterapkan.
- Pindahkan `account_map`, category, source rules, dan role assignments ke account 144.
- Validasi bahwa setiap semantic key hanya menghasilkan satu account yang berlaku untuk scope/tanggal tersebut.

### Fase 3 — Posting engine

- Resolver menerima `role + scope + posting date`, lalu mengembalikan `account_id` atau menolak dengan pesan jelas.
- Validasi leaf/active/company/currency/policy/dimension sebelum journal disimpan.
- Manual journal mengikuti policy dan approval; module journal mengikuti role assignment.
- Tambahkan preview/dry-run untuk perubahan map dan rule.

### Fase 4 — API dan UI Account Master

- Read tree/search/detail/history/usage.
- Create group/account.
- Rename/change code.
- Move parent dengan impact preview.
- Disable/reactivate/replace.
- Assign roles dan dimension policies.
- Approval queue serta immutable audit log.

### Fase 5 — Opening dan rekonsiliasi

- Bawa saldo 6.908 ke 144 berdasarkan mapping serta unit/subledger.
- Rekonsiliasi bank, inventory, AP/AR, asset, loan, principal, tax, affiliation, CIP, dan pre-opening.
- Pastikan total debit/kredit, Neraca, Laba Rugi, dan laporan per unit sama dengan sumber pada tanggal cutover.

### Fase 6 — Rollout bertahap

- Mulai dengan GL-first: control account menggunakan `MANUAL_APPROVED`.
- Inventory dan retained earnings tetap ketat sejak awal.
- Aktifkan automation per domain; setelah stabil, ubah policy ke `SEMI_AUTO`, `AUTO_ONLY`, atau `SYSTEM_ONLY` tanpa mengganti account.
- Buka kemampuan tambah normal account kepada Finance setelah approval dan audit trail terbukti berjalan.

## Pengujian penerimaan

1. Seluruh 6.894 detail account yang memang dipetakan memiliki jalur ke satu dari 144 seed account; baris laba berjalan tetap system-derived dan hierarchy tidak menjadi posting account.
2. Seluruh 144 seed account dipakai dan memiliki metadata lengkap.
3. Tidak ada posting ke group, inactive, salah company, atau account di luar effective date.
4. Rename code/name tidak mengubah histori atau merusak modul.
5. Delete account yang pernah dipakai ditolak; disable tetap mempertahankan laporan lama.
6. Reparent menampilkan dampak dan menghasilkan grouping laporan yang disetujui.
7. P&L tanpa cost center ditolak; dokumen yang dapat menurunkannya otomatis berhasil.
8. Rekening bank milik unit dapat direkonsiliasi per `bank_account_id`, tetapi tidak dapat dilihat/diposting oleh user unit.
9. Account role yang kosong, ganda pada scope sama, inactive, atau salah type menyebabkan posting berhenti sebelum journal terbentuk.
10. Opening trial balance, Neraca, Laba Rugi, dan total per unit cocok dengan sumber.
11. Reversal mempertahankan account ID dan dimensi dari posting asli.
12. Perubahan policy dari manual ke automated tidak memerlukan perubahan COA atau histori.

## Definition of done

- 144 account aktif sebagai seed production dan tree dapat dikelola Finance.
- Seluruh account lama yang benar-benar pernah digunakan tetap dapat ditelusuri tetapi tidak dipakai untuk posting baru.
- Tidak ada business module yang hard-code account code/name.
- Role assignment, dimension policy, approval, dan audit history tersedia.
- Opening balance dan subledger telah direkonsiliasi.
- Finance dapat membuat normal account baru tanpa deployment atau database migration.
- Semua perubahan sensitif memiliki impact preview dan approval.

## Referensi ERPNext yang diadopsi

- Account tree, leaf-only posting, disabled/frozen account, dan perlindungan account yang sudah memiliki GL Entry.
- Default/module account configuration, dimension validation, controlled rename, dan initial COA importer.
- Kita tidak mengikuti identitas dokumen ERPNext yang berbasis nama account. Sistem ini memakai immutable `account_id`.
- Kita juga tidak membuat satu GL account per rekening bank. Rekening tetap berada di bank subledger dengan `owner_unit_id`, sementara akses dipusatkan pada Finance HO.
