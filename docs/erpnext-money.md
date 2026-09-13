# ERPNext dan uang — dua pintu, satu corong, dan apa yang kita tiru

**Tanggal:** 13 September 2026. **Sumber:** `frappe/erpnext` `develop@0849f18` (kode, bukan
ingatan) + `frappe/hrms` + docs.frappe.io (`<slug>.md`), dibaca oleh tiga agen riset;
laporan mentahnya di `docs/research/2026-09-13-erpnext-money/`. Pendamping
[`erpnext-reference.md`](./erpnext-reference.md) (menu) dan
[`erpnext-banking.md`](./erpnext-banking.md) (rekonsiliasi bank). Visual:
<https://claude.ai/code/artifact/a7e55c82-fca2-4115-9c1b-7581f06ef3ab>.

Pertanyaan pemilik: *"tugas finance hanya 2 — membayar dan menerima — plus mencocokkan
dengan bank dan memindah-mindahkan uang; harusnya Payment Entry ERPNext tepat dong ya?
atau seluruh finance ERPNext? atau gimana?"*

---

## 0. Jawaban

1. **Tesisnya benar untuk layar Payments, kurang untuk Finance.** Bayar · terima ·
   cocokkan · pindahkan adalah inti operasional, dan keempatnya memang runtuh menjadi
   **satu dokumen + dua tool** (Payment Entry; Bank Reconciliation; Payment
   Reconciliation). Tetapi modul Accounting ERPNext mengerjakan hal lain yang bukan
   pergerakan uang: **mengakui** (invoice, akrual, deferral), **menilai** (stok ke GL,
   penyusutan, CWIP), **menutup** (Period Closing Voucher yang *memposting*), dan
   **melapor**. Dan pencocokan hanya ada karena pengakuan terjadi lebih dulu:
   `references[]` bermakna karena sesuatu menciptakan saldo terbuka.
2. **Payment Entry: tiru setengah verbatim, adaptasi seperempat, buang seperempat — dan
   tiru pintu keduanya.** ERPNext punya dua pintu uang: Payment Entry, dan Journal Entry
   ber-`voucher_type`. ERPNext sendiri **tidak** membayar gaji, petty cash, giro, tender
   POS, maupun antar-unit lewat Payment Entry; semuanya lewat Journal Entry. Meniru PE
   saja = meniru dokumen untuk ±40% pergerakan uang klien dan meninggalkan 60% tanpa
   rumah — keadaan ERPNext sendiri.
3. **Seluruh finance ERPNext: tidak.** Akun dipilih per dokumen lewat rantai default yang
   bisa menebak; invarian di Python dengan selisih ≤ 0,5 *disumbat* ke Round Off; tidak
   ada sumbu lokasi; tidak ada acquirer/MDR, giro, petty cash, cash count. §4.
4. **Kita sudah punya versi yang lebih baik, di branch D, belum menyala.**
   `cash_document` KK/KM/TF adalah Payment Entry dengan tiga perbaikan (§6). Bentuk akhir:
   **dua tier** — satu dokumen Payment untuk 15 pergerakan, dokumen sendiri untuk 11,
   Payment Ledger sebagai sekat. Menu final (`finance-menu.md`) tidak berubah.

---

## 1. Arsitektur modul Accounting ERPNext

Satu kalimat: *dokumen yang di-submit menyerahkan daftar dict ke satu fungsi modul, yang
memvalidasi, membentuk ulang, dan menggabungkan daftar itu, lalu memasukkan tiap baris
sebagai dokumen submittable `GL Entry` — dan secara terpisah mencerminkan baris
receivable/payable ke buku kedua.*

**Lapisan.** Masters (Company dengan **38** field `default_*_account`; Account tree dengan
`account_type` 35 nilai = tag, bukan lookup; Cost Center; Accounting Dimension; Fiscal Year;
Accounting Period dengan `closed_documents` + `exempted_role`; Mode of Payment + akun per
company; Payment Terms; Party dengan Party Account; Bank Account; Asset Category dengan 5
akun; Item/Item Group/Brand dengan Item Default; Warehouse.account; POS Profile) →
Dokumen (31 submittable di accounts; yang benar-benar memposting: Sales Invoice, Purchase
Invoice, Journal Entry, Payment Entry, PCV, Purchase Receipt, Delivery Note, Stock Entry,
Stock Reconciliation, Landed Cost, Asset (switchover CWIP), Asset Capitalization, Expense
Claim, Payroll Entry via JE; yang submit tapi **tidak** memposting: POS Invoice, POS
Opening/Closing, Merge Log, Bank Transaction, Salary Slip, Asset Movement) → Corong
(`AccountsController.validate` → `<Doctype>GLComposer.compose` → `make_gl_entries` →
`process_gl_map` (split cost center, merge dengan `against_voucher` di kunci, balik tanda)
→ `save_entries` (selisih ≤ 0,5 → **plug** Round Off; freeze; PCV) → `GL Entry.submit()`)
→ Ledger (GL Entry, Payment Ledger Entry, Advance PLE, Stock Ledger Entry, Account Closing
Balance) → Tools (Bank Reconciliation Tool, Payment Reconciliation `is_virtual`, Opening
Invoice Tool, COA Importer, Bisect, Ledger Health, Repost) → 52 laporan.

**Rantai pemilihan akun** (yang digantikan `account_map`): Income = Item Default → Item
Group → Brand → POS Profile/Company; Expense/COGS = Item.default_cogs → … → Company;
Inventory = Warehouse.account → leluhur → Company → **"satu-satunya akun bertipe Stock,
kalau tepat satu"** → throw; Party = Party Account → group → Company; Bank/Cash = Mode of
Payment Account → Company → **"satu-satunya akun bertipe itu"** → `{}`; Asset = Asset
Category → Company; GRNI = Company saja; Round off = Company. Arti implisit di nama field;
resolusi = jalan yang berakhir di Company; **tidak ada sumbu lokasi** (Cost Center adalah
kolom kedua, bukan akun berbeda).

**Jalur retail.** Default v17 `POS Settings.invoice_type = Sales Invoice` (posting per
penjualan); `POS Invoice` sebagai antrean + `POS Invoice Merge Log` (Queued · Failed ·
`error_message` · `retry()`) hanya untuk volume tinggi. Tender: `Sales Invoice Payment`
dengan akun dari Mode of Payment Account (throw jika kosong). **Tidak ada dokumen settlement
acquirer, tidak ada MDR, tidak ada gross vs net**; satu-satunya konsep biaya
`Bank Transaction.included_fee/excluded_fee` saat rekonsiliasi.

---

## 2. Payment Entry, dibedah

**Header.** `payment_type` Receive | Pay | Internal Transfer (satu enum); `party_type` +
`party` (Dynamic Link) + `party_name`; `paid_from` + `paid_to` (dua Link Account, wajib);
**tidak ada kolom party_account** — `setup_party_account_field()` menurunkan: Receive ⇒
party account = `paid_from`, Pay ⇒ `paid_to`, Transfer ⇒ tidak ada. `paid_amount` dan
`received_amount` ada dua **hanya karena mata uang**; dalam satu mata uang keduanya dipaksa
sama (kecuali Internal Transfer), sehingga "tagihan 10 jt, mendarat 9,83 jt" wajib dinamai
di `deductions[]`. `total_allocated`, `unallocated` (legal ⇒ advance), `difference_amount`
(read-only, **harus 0 saat submit**; tombol write-off menambah baris deduction, bukan sumbat
diam). `reference_no` + `reference_date` (wajib bila kaki = Bank — tapi hanya `paid_from`
yang dicek, jadi setoran kas→bank luput). `clearance_date` read-only, `no_copy` (amend →
kosong). `status` = `docstatus` (Draft → Submitted → Cancelled). `payment_order_status`
disematkan dari luar.

**Anak.** `references[]`: reference doc/name · due_date · total · outstanding (snapshot,
dibaca ulang tiap validate) · **`allocated_amount` satu-satunya angka yang bisa ditulis** ·
payment_term · payment_request (`payment_request_outstanding` = `@property` hidup).
`deductions[]`: account · cost_center · amount bertanda · description ·
`is_exchange_gain_loss` ("System Generated"). `taxes[]`: mesin pajak penuh (buang).

**Validasi (22 panggilan).** Party wajib untuk Receive/Pay; Transfer menolkan party dan
**mengosongkan references**; amount & rate tak boleh nol; reference harus ada di daftar
`get_valid_reference_doctypes()` (method — HRMS melebarkannya), party reference = party PE,
akun invoice = party account, invoice on_hold ditolak; JE hanya bila punya baris party yang
belum dijawab; duplikat (doctype, name, term, request) ditolak; **alokasi divalidasi ulang
terhadap Payment Ledger hidup saat submit** ("sudah dibayar sebagian, ambil ulang
outstanding"); supplier on_hold ditolak; `difference_amount` harus 0; Accounting Period
`closed_documents` per doctype; Budget bisa memblokir; GL: Receivable ⇒ Customer wajib,
Payable ⇒ Supplier wajib, P&L tanpa cost center ditolak.

**Posting per tipe** (`PaymentEntryGLComposer.compose`): Receive = Cr party per reference
(against_voucher = invoice) + Cr party sisa (tanpa against → PLE menunjuk PE sendiri =
"uang muka") + Dr paid_to + Dr deduction (negatif → Cr). Pay = cermin. Internal Transfer =
Cr paid_from · Dr paid_to, tanpa party. `voucher_subtype` = payment_type di tiap baris GL.
PLE **diturunkan dari gl_map** untuk baris Receivable/Payable saja, bertanda, dikelompokkan
per `against_voucher_no`.

**Delapan jurnal kerja** ada di laporan mentah (bayar penuh; 3 invoice + biaya bank; terima
dengan sisa uang muka; bank→bank; kas→bank; uang muka pegawai lewat `EmployeePaymentEntry`;
**gaji = dua Journal Entry, bukan PE**; settlement kartu neto MDR = Receive dengan
`deductions[]` — mekanik yang kita ambil).

**Di sekelilingnya.** Payment Request (Inward/Outward; ladder Draft → Requested → Initiated
→ Partially Paid → Paid; tekanan balik dari alokasi PE) → PE. Payment Order (batch ke bank)
**membuat Journal Entry** (`make_payment_records` → Bank/Cash Entry per supplier), bukan PE.
Bank Transaction ↔ PE lewat `Bank Transaction Payments` (`reconciliation_type` Matched |
Voucher Created; unmatch = hanya lepas, uncreate = cancel voucher). Payment Reconciliation
(`issingle` + `is_virtual`, nol simpanan) menulis ulang **PLE saja, GL utuh**. Unreconcile
Payment = dokumen submittable dengan `unlinked` per baris.

**Yang PE sengaja tidak lakukan** (dan ERPNext pakai apa): petty cash (prosedur manual),
giro/PDC (prosedur; `clearance_date` satu tanggal tanpa siklus), multi-pihak dalam satu
dokumen (JE), satu pembayaran dua bank (JE), payroll (Payroll Entry → 2 JE), tender POS
(Sales Invoice Payment), antar-unit satu company (JE/dimension), cash count (tidak ada),
approval sebelum uang bergerak (Workflow generik / Payment Request + Payment Order).

---

## 3. Dari Payment Entry: tiru · adaptasi · buang

**Tiru verbatim:** `payment_type` satu enum · `references[]` dengan `allocated_amount`
satu-satunya yang bisa ditulis · validasi ulang terhadap ledger hidup saat submit ·
`deductions[]` lima kolom · `difference_amount == 0` + write-off sebagai baris deduction ·
unallocated legal ⇒ uang muka · duplikat ditolak · baris nol dibuang saat validate ·
referensi wajib bila kaki bank (**periksa kedua kaki**) · `set_remarks` menyusun narasi BKK
· amend = dokumen baru, cancel = reversal, `clearance_date` no_copy ·
`get_valid_reference_doctypes()` sebagai method · `voucher_subtype` di baris GL ·
Unreconcile sebagai dokumen + `reconciliation_type` · master Mode of Payment (tanpa tabel
akun default-nya).

**Adaptasi:** `cost_center` → `site_id` (header, deduction, tax; P&L tanpa site ditolak) ·
Link Account + 38 default Company + Party Account + MoP Account → `account_key` +
qualifier lewat `account_map` per site, termasuk baris deduction · party_type/party →
`counterparty` ber-`kind` (0214) · `clearance_date` saja → akun kliring giro per bank
penerbit + register 5 rung, `clearance_date` tetap fakta bank · Draft→Submitted →
**tangga enam rung** (REQUESTED · APPROVED · INSTRUCTED · SETTLED + FAILED · RECONCILED)
dengan aturan ERPNext: tepat satu keadaan memposting, pembatalan membalik ·
`references[]` hanya ke dokumen ter-submit → **`lines[]` = alokasi item terbuka ATAU baris
akun langsung** (B: DIRECT_EXPENSE), amount bertanda memutuskan sisi. BKK gaji klien
(`C006-BKK-26-07-00046`) butuh persis ini: 3 akrual + 2 biaya langsung + 1 kaki petty cash.

**Buang:** multi-currency utuh (satu-satunya alasan paid ≠ received ada) · exchange
gain/loss + JE keduanya (**simpan** flag "System Generated") · Payment Order (membuat JE =
jalur posting kedua yang melewati poster) · separuh gateway dari Payment Request (**simpan**
separuhnya: jumlah diminta, outstanding hidup, ladder, tekanan balik = REQUESTED kita) ·
mesin withholding (PPh 23 = satu baris deduction) · Dunning · advance in separate party
account + Advance Payment Ledger · is_opening, auto_repeat, in_words, project, contact ·
Payment Reconciliation sebagai `issingle + is_virtual` (ambil pekerjaannya, bukan bentuknya)
· Bank Clearance.

---

## 4. ERPNext vs kita, lapis demi lapis

| Lapis | ERPNext | Kita | Putusan |
|---|---|---|---|
| Tempat menulis | satu sink `make_gl_entries`, banyak mulut (10 composer + Expense Claim + deferred + depreciation membangun JE) | `poster.rs:179 post()`, transaksi milik pemanggil | sama ide; kita lebih bersih + atomik dengan dokumen sumber |
| Cara memilih akun | per dokumen, rantai default ke Company, bisa **menebak** | `account_map` arti × site × qualifier; yang belum terpeta menolak dan menyebut kuncinya | **kita lebih ketat, dan punya sumbu lokasi yang mereka tak punya**; ambil `account_category` sebagai tag roll-up laporan |
| Invarian seimbang | Python; ≤ 0,5 disumbat ke Round Off | trigger deferred saat COMMIT | kita lebih ketat; pembulatan jadi baris eksplisit buatan aturan, bukan sumbat |
| Append-only | `docstatus`; immutable adalah *setting* off-default; Repost bisa menghapus | trigger tolak UPDATE/DELETE; `reversal_of` UNIQUE | kita lebih ketat; **ambil:** pembalikan bertanggal hari ini bila periode asal tertutup (kita bisa membalik *ke dalam* periode yang kita tolak) |
| Dua ledger | GL Entry + PLE dari gl_map yang sama, dijaga sinkron manual; dua laporan cari selisihnya | satu `journal_line` + `supplier_id` | kita lebih sederhana/aman; **ambil:** Trial Balance for Party, `against_voucher` |
| Party | wajib di Receivable/Payable | `supplier_id` nullable | **kita kurang satu cek**: tolak `trade_payable` tanpa counterparty |
| Lokasi | Cost Center wajib di P&L; Accounting Dimension + **offsetting entry otomatis** bila satu voucher melintasi dimensi | `site_id NOT NULL` + unit di kode akun | tak cocok, kecuali offsetting itu = kaki afiliasi kita (D 0120–0122) |
| Kunci periode | Fiscal Year; Accounting Period selektif + `exempted_role`; freeze + role; PCV | `fiscal_period` dengan **FOR SHARE** | kita lebih ketat mekanisme, mereka lebih kaya kebijakan; **ambil** `closed_documents` + `exempted_role` |
| Tutup buku | PCV memposting P&L ke laba ditahan, menolak bila prasyarat gagal, menulis status + alasan di dirinya | `close_period` membalik status tanpa uji (G7) | **kita kurang**; pola "dokumen yang gagal memposting berkata begitu di dirinya" |
| Saldo tersimpan | Account Closing Balance (escape `ignore_account_closing_balance`) | tidak ada | divergen sengaja; keputusan performa nanti |
| Repost | dokumen, kunci voucher, **`generate_preview()`** | tidak ada; reversal + `rule_version` | yang kita butuh bukan repost, tapi dry-run saat aturan berubah |
| Integritas | Ledger Health (GL≠PLE), Bisect | 24+8 uji; trigger membuat ketidakseimbangan mustahil | separuh monitor mereka moot; **Bisect** layak (kapan laporan mulai salah = perubahan peta) |
| Retail | POS Invoice = antrean posting dengan Queued/Failed/error/retry | SALE_DAY tanpa penulis (G1) | **ambil bentuknya**: dokumen posting per toko per hari yang bisa gagal beralasan |
| Acquirer / giro | tidak ada | G9/G8 terbuka; D sudah membangun | ERPNext tak punya apa-apa; kita di depan |

Kontras tertajam: *ERPNext memilih akun per dokumen dari rantai default yang bisa jatuh ke
tebakan; kita memilih per arti dari peta yang menolak. Invarian mereka Python dan bisa
dikonfigurasi; kita trigger. Ledger mereka dokumen yang bisa di-repost; kita tabel yang hanya
bisa ditambah.*

---

## 5. Model uang kita: empat badan

**A hidup:** `supplier_payment` PV- satu arah, satu `account_key` ∈ 4 pot, alokasi tagihan
saja (Σ = header, DRAFT mereservasi), `DRAFT → POSTED` tanpa VOID, GIRO tercatat cair
seketika; `bank_statement` + `bank_line_match` (0213/0214); `cash_count` (0216; `cash_variance`
dipakai tapi tidak terdaftar — cacat hidup); voucher, sqlite `store_expense`/`cash_shift`/
`sale_tender` tanpa jurnal. Tiga konstanta money-key yang saling beda (8/4/3).

**D branch:** `cash_document` KK/KM/TF (0115: `kind` **diturunkan dari dua sisi**, nomor
ikut arah, dua sisi masing-masing arti-atau-kode + site, party_kind, giro fields,
`DRAFT → APPROVED → POSTED → REVERSED` satu arah); `payment_ledger_entry` +
`_settlement` (0143–0145: akun kontrol sebagai **triple belum ter-resolve** → persamaan GL =
sub-ledger per triple; aturan 0143 *"money moving is NOT sufficient reason"*);
`payment_destination` terenkripsi + `snapshot` beku (0151/0152); `payment_batch` (0153:
"every executed item is ONE ORDINARY PAY", batch tanpa akuntansi) + `_event` (0154);
`PaymentPattern` 7 → 3 primitif; lane toko (`store_deposit` dua posting, `remittance_order`
memposting nol, `store_expense` ambang Rp 500rb + maker≠checker, `petty_cash_replenishment`,
`cash_shift`, `sales_posting` SALE_DAY); `giro` 5 rung dengan reject = reversal yang
membuka kembali tagihan (0117–0119); acquirer (0134–0136: gross − MDR = net, melunasi pada
gross tertua-dulu); antar-unit (0120–0122: kaki afiliasi ditumbuhkan poster, tanpa dokumen);
`supplier_advance` + withholding di pembayaran (0133); `transaction_category` (0155).
**Belum menyala:** `payment_allocation.rs::settle_through_payment_ledger` = penolakan
hard-coded; `payment_execution.rs` menulis `cash_document` lewat SQL mentah padahal `cash_*`
ada di pohon yang sama; **dua dokumen pembayaran dengan dua model alokasi** (bernama vs
tertua-dulu); `cash_document` tanpa INSTRUCTED/FAILED (hanya di batch item).

**B lab:** Payment dengan `direction`, satu sisi uang, `allocations[]` → OPEN_ITEM (5
jenis) atau DIRECT_EXPENSE, total diturunkan, tangga REQUESTED → APPROVED → INSTRUCTED →
SETTLED → RECONCILED + FAILED, **hanya SETTLED memposting**, `outstanding()` ≠ `reserved()`.

**C prototipe:** F02 Pembayaran · F03 Penerimaan · F04 Transfer · F05 Giro; S03 Alokasi;
tangga enam: Draf · disetujui · diproses · tereksekusi · gagal · dibalik.

---

## 6. 26 pergerakan uang → satu Payment, atau dokumen sendiri

**Satu Payment (15):** bayar tagihan barang · bayar tagihan vendor · biaya langsung tanpa
tagihan · isi petty cash (TRANSFER) · pasang modal kasir (TRANSFER) · pindah bank→bank ·
uang muka pegawai (terbit) · pinjaman staf (cair) · payout gaji (batch n × PAY) · refund
pelanggan · bayar pajak · beli aset (baris tagihan berkode aset) · uang muka pemasok
(terbit) · setoran modal / prive · biaya bank / bunga.

**Dokumen sendiri (11):** *memposting nol kali* — remittance order, cash movement, tender
reconciliation; *memposting dua kali di dua tanggal* — store_deposit (via cash_in_transit),
giro (terbit … cair/tolak), cash_shift (float + variance); *kontrol berbeda* — store_expense
(ambang Rp 500rb, maker≠checker, REJECTED beralasan), acquirer_settlement (gross − MDR =
net, referensi di 13 buku, 4 keadaan), custodian_handover (dua tanda tangan), cash_count
(pengamatan), voucher (tender + kewajiban); *bukan dokumen* — antar-unit (kaki ditumbuhkan
poster pada entri penyebab).

**Tanpa dokumen di mana pun (10):** voucher terjual (kewajiban tak tercatat) · refund
sebagai dokumen · pinjaman bank + jadwal · pertanggungjawaban uang muka · pemulihan pinjaman
staf lewat gaji · penyelesaian kas antar-unit (`INTERUNIT_SETTLE` tanpa penulis) ·
pengembalian modal kasir (`float_back_entry_id` tanpa penulis) · modal/prive · uang toko di A ·
payout gaji di A.

---

## 7. Putusan: dua tier

- **Tier 1 — satu dokumen Payment.** `cash_document` menyerap `supplier_payment` (bukan
  sebaliknya): nomor KK/KM/TF membawa arah, `kind` diturunkan, dua sisi kelas satu.
  Melebarkan PV- berarti empat trigger 0084 jadi kondisional dan FK satu sisi jadi baris
  lebar setengah NULL. Tangga **enam rung** B/C menang atas empat rung D: INSTRUCTED dan
  FAILED naik dari `payment_batch_item` ke dokumen tunggal; RECONCILED dibaca dari
  `bank_line_match`, tidak disimpan. Model alokasi: **bernama** (yang ERPNext validasi ulang
  terhadap ledger hidup); klaim tertua-dulu tinggal untuk acquirer settlement (Tier 2).
  `lines[]` satu tabel: alokasi item terbuka ATAU baris akun langsung.
- **Tier 2 — dokumen sendiri** untuk 11 pergerakan; semuanya sudah ditulis di D.
- **Sekat = Payment Ledger** dengan aturan 0143 sebagai uji tier.
- **Dua edit yang menyalakan lane D:** jalur tulis `settle_through_payment_ledger` dan
  `payment_execution.rs` memakai `cash_draft_from`/`cash_document_*`.
- **Dari ERPNext ke poster:** `voucher_subtype` di baris; kaki Payable wajib counterparty;
  pembalikan bertanggal hari ini bila periode asal tertutup; dry-run saat aturan berubah;
  dokumen yang gagal memposting menulis status + alasan di dirinya.
- **Menu final tidak berubah.** Baris Payments = Tier 1 (dokumen uang lintas-domain, tiga
  primitif), Journal entries = pintu kedua; sebelas dokumen Tier 2 sudah punya baris.

---

## 8. Koreksi untuk `erpnext-reference.md`

1. Card layer sudah kosong sejak `2a14b5d953` (27 Ags 2026): menu = Dock → Sidebar (satu
   per modul, Accounts 121 item) → Workspace (dashboard: satu chart + 3 number card).
2. Accounting Period **tidak** submittable di v17. Accounts Settings 66 field; Company 38
   field Account.
3. `Payment Reconciliation` tidak submittable: `issingle` + `is_virtual`.
4. `Cash Flow Mapping` tidak ada lagi; diganti Financial Report Template + Account Category
   + Custom Financial Statement — menyelesaikan ketegangan §8 (template ≠ query bebas).
5. `Accounts Frozen Upto` pindah ke `Company.accounts_frozen_till_date`.
6. PCV memposting per kombinasi dimensi tanpa centang.
7. Default POS v17 = Sales Invoice per penjualan; POS Invoice + Merge Log = opt-in volume
   tinggi.
8. Teknik: tambahkan `.md` ke URL docs.frappe.io untuk Markdown bersih.
