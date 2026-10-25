# POS — web till (`pos-desktop/ui`, web edition) and the store app (`frontend-store-new`) — branch map (9 Oct 2026, read from source)

Rig: store-01 node :8582 (cloud :8580, DC :8581). Till = Vite `--mode web` :5584, `/api` proxied to the node. Store app = Vite :5582
(`/api` → node, `/api/v1/store/central/*` relays HR/GA/chat to the cloud). Password `Password01` for everyone.
Only one till seat on the rig: **Kasir 1 = terminal `KASIR-1`** (`GET /api/v1/store/tills`). Payment methods master is empty
(`GET /api/v1/store/payment-methods` → `[]`), so the till uses its fallback tiles.

Not covered (no engine): the Tauri desktop shell (fingerprint, PIN, R3 reader, drawer, USB printer, customer-display window button, device
pairing/joining, peripherals screen, `Layar pelanggan`) and the Android tablet till. `edition.ts` hides all of them in web.

## 1. Till (labels are Indonesian, exact)

State machine in `src/app.tsx`: session? → `LoginScreen` → `ShiftGate` (seat picker / count owed) → `Till` (+ utility screens by `where`).
A 30 s poll (`app.tsx:~100`) drops the cashier to the picker when the seat is taken. 10 min idle → lock (warning toast "Layar terkunci dalam N detik" + "Saya di sini").
Token in `sessionStorage` (`web.ts`), terminal id `WEB-XXXX` in localStorage: sessions of the e2e framework do not carry it → sign in inside each test (`support/pos.ts: signInTill/openCounter`).

### 1.1 Sign-in and setup (`screens/login.tsx`)
| Branch | Labels / behaviour | Endpoint |
|---|---|---|
| Sign-in card | h3 "Masuk ke konter"; textboxes "Nama pengguna", "Kata sandi"; button "Masuk" (disabled until both filled; "Memeriksa…" while busy); footer shows `<terminal> · <host>`; button "Setelan" | `POST /api/v1/auth/login`, `GET /api/v1/auth/me`, `GET /api/v1/auth/methods` (web: no PIN tab, no fingerprint button, no "Gabungkan") |
| Refusal | node's own sentence under the form, e.g. `unauthorized: invalid username or password`; password field emptied | |
| Setelan terminal (`login.tsx:372`) | h1 "Setelan terminal"; web: read-only "Alamat node toko" = page origin; "Nomor terminal" (empty → "Nomor terminal tidak boleh kosong — …"); "Alamat printer struk", "Port printer", "Lebar kertas" (NARROW/WIDE); "Batal"/"Simpan". No devices/pairing in web | localStorage only |
| Sign out | topbar icon button "Keluar" (`till.tsx:~1170`) | `POST /api/v1/auth/logout` |

### 1.2 Seat and shift (`screens/shift.tsx`)
| Branch | Labels | Endpoint |
|---|---|---|
| Gate | "Memuat shift…" → one of: count owed (`uncounted[0]`), open shift → straight to counter, else seat picker | `GET /api/v1/store/shifts/mine`, `GET /api/v1/store/tills` |
| Seat picker (`:541`) | h1 "Pilih kasir"; row h3 "Kasir 1", sub "Kosong" or "Dipegang <user> sejak HH:MM"; buttons "Pakai Kasir 1" (free) / "Ambil alih" (held) | |
| Take-over warning | notice "Shift <who> di <seat> akan berakhir. <who> menghitung lacinya sendiri nanti."; buttons "Ambil alih Kasir 1", "Batal" | |
| Opening | h1 = seat, p "Hitung uang di laci Anda, lalu isi modal awalnya."; amount input aria "Modal awal di laci" + numpad; submit "Buka shift · Rp N" ("Membuka…"); "Pilih kasir lain" | `POST /api/v1/store/shifts/take-over {terminal_id, opening_float_minor, actor_id, idempotency_key}` (free seats only; a held seat is refused, owner 23 Oct 2026) |
| Count owed (`:593`) | h1 "Hitung laci Kasir 1", "Shift Anda diambil alih oleh <who> pada HH:MM…"; denomination rows (aria "Jumlah lembar Rp 100.000", "Tambah Rp …", "Kurangi Rp …"), "Total dihitung", "Lanjut" → "Periksa hitungan" → "Kunci hitungan" / "Hitung ulang" | `POST /api/v1/store/shifts/{id}/count` |
| Seat lost while selling | topbar poll or at "Selesaikan transaksi": gate notice "Kasir 1 sudah diambil alih oleh <who> — pilih kasir lagi." (`app.tsx:90`); basket stays mounted | `GET shifts/mine` |
| Shift & kas (`F12` or utility "Shift & kas") | h1 "Shift & kas"; stats "Modal awal", "Transaksi", "Dibuka"; "Void N transaksi" badge; radiogroup "Jenis pergerakan": "Setor ke brankas" (−) / "Tambah uang laci" (+); fields "Nominal" (+numpad), "Alasan"; "Catat · Rp N"; list "Pergerakan kas". Errors "Isi nominalnya.", "Alasan wajib diisi." | `POST /api/v1/store/shifts/{id}/movements` |
| Close shift | "Tutup shift" (disabled while the outbox holds sales: "N penjualan belum terkirim ke node — tunggu sampai terkirim sebelum menutup shift." / "N penjualan ditolak node — selesaikan di layar konter sebelum menutup shift."); "Tutup shift · hitung uang di laci" blind count → "Lanjut" → "Periksa hitungan" (+ "Catatan (opsional)") → "Kunci hitungan & tutup shift" → "Shift ditutup", "Uang yang Anda hitung", "Pilih kasir" | `POST /api/v1/store/shifts/{id}/close {declared_cash_minor, counted[], note}` |

### 1.3 Counter (`till.tsx`)
Left: scan form (textbox "Pindai tag atau cari barang", button "Tambahkan"), "Cek harga" list ("Tutup cek harga"), "Kupon & member" block (textbox "Kode kupon" + "Pakai"; chip button "Lepas kupon CODE"; notice "CODE belum memberi potongan."; textbox "Nomor member"), utility tiles: "Tahan", "Ditahan" (F9, count badge), "Kantong" (F4), "Dari handheld" (F6), "Retur" (F3), "Void", "Shift & kas" (F12). Right: "Keranjang N unit", rows (sku, `…last8`, name, price, button "Lepas <name>"), totals: Subtotal, bag charges (+ "lepas"), applied promotion rows `−Rp N`, "Gratis · name × n", "Perkiraan poin +N", "TOTAL", quote problem text ("Menghitung…", "Sementara — node belum menjawab", "Ada unit tanpa harga"), buttons "Batal" (F8) and "Bayar Rp N" (F10).
| Branch | Labels / behaviour | Endpoint |
|---|---|---|
| Scan EPC | adds unit; name+price from `GET /store/catalog`; unknown SKU → "Tidak ada di buku harga" + flag "TANPA HARGA" + badge "Ada unit tanpa harga" | `POST /api/v1/store/quote {epcs, coupon_codes, customer_id, charges}` after 250 ms and every 2 s while open |
| Duplicate | notice "Tag itu sudah ada di keranjang. Satu tag adalah satu barang." | |
| Name search / SKU | ≤ 8 rows under "Cek harga"; none → "Tidak ada yang cocok dengan “x”. Pindai tag garmennya, atau ketik sebagian namanya." | |
| Member card | scan `M1:<id>` → notice "Kartu member <id> terbaca." and fills "Nomor member" | |
| Promotion / points | row with the promotion name and `−Rp N`; "Perkiraan poin +N" only with a member | quote |
| Coupon | quota-limited coupon HEMAT50: quote answers "this limited coupon must be authorized online" and the till never authorizes → never applies (BUG TILL-41b) | |
| Bag | sheet "Kantong belanja": Kantong kertas kecil/besar (Gratis), plastik kecil Rp 500, plastik besar Rp 1.000; charge line + "lepas" | `charges[]` on quote and sale |
| Remove a unit | "Lepas <name>" → approval sheet (EDIT_CART) | `POST /api/v1/store/approvals` |
| Cancel basket | "Batal"/F8 → card "Batalkan transaksi ini?" (reasons: Pembeli berubah pikiran / Barang salah terpindai / Harga dipersoalkan / Barang tidak tersedia, or textbox "Alasan lain"; "Batalkan transaksi"; "Kembali ke keranjang") → approval (CANCEL_BASKET) → note "Transaksi dibatalkan — <reason> · disetujui <who>" | approvals |
| Hold / resume | "Tahan" parks the basket in localStorage `pos.holds.v1`; "Ditahan" → sheet "Transaksi ditahan": "Lanjutkan", "Buang" → "Ya, buang" → approval (DROP_HOLD) | |
| Approval sheet (`approval.tsx:206`) | dialog "Persetujuan kepala toko": textbox "Kode supervisor", "Kata sandi" (web: password only), "Setujui"/"Batal"; wrong password → node's sentence | `POST /api/v1/store/approvals {action, supervisor{username,password}, …}` |
| From handheld | sheet "Ambil dari handheld": "Belum ada sesi pindai" or rows "N tag · M pemindai" + "Tarik" (≤ 2000 tags) | `GET /api/v1/rfid/sessions`, `/{id}` |
| Lock | "Kunci" → card "Konter terkunci"; "Nama pengguna" (prefilled), "Kata sandi", "Buka konter"; wrong → `unauthorized: invalid username or password`; basket survives | `POST /auth/login` |
| Customer display | `/?display` renders `CustomerScreen` ("Selamat datang" / "Selamat berbelanja"); the opening button is desktop-only | BroadcastChannel |

### 1.4 Payment (`till.tsx:1624`)
Header "Metode pembayaran", tiles (fallback list): "Tunai", "Debit", "Kredit", "QRIS", "Voucher", "Saldo karyawan" (disabled with a promo in the basket: "Tidak berlaku dengan promo"). Debit/Kredit/QRIS: radiogroup "Bank" (BCA, Mandiri, BRI, BNI). Fields: "Kode approval EDC" / "Nomor referensi QRIS" / "Kode voucher" / "Kode saldo karyawan"; "Nominal pembayaran" (+ numpad and presets for cash). Pay button "Bayar Rp N" (suffix " · Debit BCA"), partial "Bayar sebagian Rp N", benefit "Cek saldo" / "Pakai saldo Rp N". Side: "Kembali ke keranjang" (Esc), "Item", "TOTAL", "Barang", "Kupon", "Diterima" list, "Sisa" or (settled) "Kembalian" + "Kembalikan" note breakdown. Settled: "Lunas" ("Kembalian Rp N" / "Tanpa kembalian"), button "Selesaikan transaksi" ("Membukukan…").
Validation (before the node): "Pilih banknya.", "Masukkan kode approval, minimal 4 karakter.", "Itu seperti nomor kartu. Tulis kode approval-nya saja." (≥ 12 digits), "Hanya tunai yang boleh melebihi sisa — kembalian keluar dari laci, bukan dari kartu.", "Masukkan kode voucher.", "Kode saldo karyawan terdiri dari 6 angka.", "Saldo karyawan tidak berlaku bersama promo."
| Tender | Wire | Notes |
|---|---|---|
| Cash | `{method:'CASH', amount_minor: amount applied}` | **BUG TILL-35**: tendered cash is not sent, receipt `paid_minor`=total, `change_minor`=0 although the till shows change |
| Debit/Credit | `CARD` + `acquirer`, `card_kind`, reference `"BCA · 771234"` | |
| QRIS | `QRIS`, reference | |
| Voucher | held first: `POST /api/v1/store/vouchers/{code}/authorize` (relayed to cloud) → tender carries `voucher_authorization_id`; cloud commits on sync | unknown code → `not found: not found: Voucher` |
| Saldo karyawan | `POST /api/v1/store/benefit/lookup|spend|return`, tender `BENEFIT` with `sale_ref` UUID as reference | **BUG TILL-73**: UUID reference has ≥ 12 digits → node refuses the sale; cashier cannot spend own balance ("a cashier does not ring up their own benefit") |
| Complete | `POST /api/v1/store/sales {epcs, tenders, actor_id, idempotency_key, coupon_codes, customer_id, charges}` through the outbox (`outbox.ts`) | before it, `GET shifts/mine` re-checks the seat |
Result card (`Sale`, `till.tsx:2366`): dialog "Transaksi selesai" (total, "Kembalian", sale id uuid, "Cetak ulang" only if a printer is set, "Transaksi berikutnya") or dialog "Tersimpan di terminal" + notice "Menunggu terkirim ke node — dikirim ulang otomatis." + the node's sentence.
Outbox: unsent → topbar badge "N belum terkirim" + statusbar "N penjualan menunggu terkirim"; resent when the counter is at rest; HTTP 4xx (not 401/408/429) = refused → banner "N penjualan ditolak node — selesaikan sebelum tutup shift." with entry line + button "Buang" (window.confirm). Statusbar "Semua penjualan terkirim".

### 1.5 Retur / Void / Poin / Daftar member
| Screen | Labels | Endpoint |
|---|---|---|
| Void (`returns.tsx:1497`) | h1 "Void penjualan"; "ID penjualan" + "Buka penjualan"; summary (Nomor struk, Waktu, Kasir, Dibayar dengan, Total); "Alasan pembatalan"; "Nama pengguna supervisor", "Kata sandi supervisor"; red button "Batalkan seluruh penjualan Rp N"; done: "Penjualan dibatalkan" (+ "Disetujui oleh", "Unit yang pulang"), "Selesai". Errors: "Belum ada otorisasi supervisor…", node's refusal. Receipt stamp becomes `** BATAL **`. Receipt-number hint "Itu nomor struk, bukan ID penjualan" never fires for `STORE-01-…` numbers (BUG TILL-61b) | `GET /store/sales/{id}/receipt`, `POST /store/sales/{id}/void` |
| Retur (`returns.tsx:1162`) | h1 "Retur barang"; steps 1–4; "Pindai tag yang kembali"; per tag chips "Layak jual" (→ floor) / "Rusak" (→ reject pool), badges "Tujuan belum dipilih", "SKU tidak ada di struk ini", notices "N tag belum diberi tujuan.", "Tag untuk <sku> lebih banyak daripada yang terjual di struk ini…", "Tag itu sudah ada di daftar…", "Itu kode produk, bukan barang yang mana…", "“x” bukan tag yang dikenali terminal ini."; "Alasan retur"; "Uang kembali lewat": Tunai / Kartu / QRIS / E-Wallet / Lainnya (+ "Kembali ke saldo karyawan" if the sale had a BENEFIT tender); "Referensi pengembalian (boleh kosong)" (card-like → "Referensi itu menyerupai nomor kartu…"); supervisor fields; "Catat retur"; done "Retur tercatat", "Disetujui oleh", "Uang kembali lewat", "Masih di tangan pelanggan N unit" | `POST /api/v1/store/returns` |
| Poin (Bayar row, `till.tsx` `Payment`; the F11 screen is gone) | Row "Poin": mid "Saldo N poin" + button "Minta persetujuan" (Enter), amount box "Poin" `aria-label` "Jumlah poin" (cashier types; prefilled min(balance, still owed), nothing sent before Enter). Waiting: mid "N poin = Rp N" + × "Batalkan permintaan poin", one line "Menunggu pelanggan — kode dikirim ke WhatsApp 0812****7890, atau setujui di app member" (or "Minta pelanggan menyetujui di app member · <why>") + countdown, amount box "Kode dari pelanggan" (6 digits). Polls every 2 s; approved → note "N poin ditukar · Rp N", row paid by the voucher. Ends: "Pelanggan menolak penukaran poin.", "Waktu persetujuan habis — minta lagi.", "Poin member hanya N." Closing Bayar / Pembayaran diterima / × cancels a waiting ask | `POST /api/v1/store/points/redeem-requests` (ask), `/{id}/progress`, `/{id}/cancel`, `/lookup`, `/{id}/confirm`. The shopper side (`pos.memberApp`): `POST /api/v1/members/{id}/pairing-code` (cashier, cloud) → `POST /api/v1/member/session` → `GET/POST /api/v1/member/points/redeem-requests[/{id}/approve\|decline]`; the WhatsApp code is never returned to a test |
| Daftar member (`screens/member.tsx`, F5) | "Nomor HP" with inline "Kirim kode" (Enter on the phone), then "Kode dari pelanggan" (6 digits) + "Kirim ulang · N" (30 s) and "Kode dikirim ke WhatsApp 0812****7890"; "Daftar" sends `otp_challenge_id` + `otp_code`. Head office without WhatsApp: no code row, as before. Errors in the form: "Kode salah atau sudah kedaluwarsa…", "Nomor … tidak terdaftar di WhatsApp." | `POST /api/v1/store/members/otp`, `POST /api/v1/store/members` |

Keyboard: F1 scan, F2/F10 pay, F3 retur, F4 bags, F6 handheld, F8 cancel, F9 holds, F12 shift, Esc leaves payment / closes panel (`shortcuts.ts`).

## 2. Store app — screens, routes, labels

Shell: left rail modules (Catalogue, Promotions, Stock, Money, Discuss, "Cashier (opens in a new tab)" → till URL), per-module sidebar, top bar "Sync: <state>" link to /node/sync, "Sign out". People (/hr/*) and GA (/ga*) have no rail icon (reachable by URL, `HIDDEN_FROM_RAIL`). Sign-in door: h1 "Sign in"; "Username", "Password" (name "Password Show password"), button "Sign in"; refusal "invalid username or password". Cookie session + CSRF from the node.

| Route | Component | What it shows / does | Node endpoints |
|---|---|---|---|
| /catalogue | `catalogue.tsx` | "By article" / "By SKU", "Search the range" (+ "Clear the search"), "N articles", tag picker, product sheet (prices, Price source, Barcode) | `GET /store/catalog` |
| /promotions, /campaigns, /price-changes, /vouchers | `promotions/*` | Active · N / Scheduled · N / All · N; offers from the node (HEMAT50, Diskon 15% Sandal & Sepatu, Diskon 10% Koleksi Wanita, Poin member) | `GET /store/offers` |
| /stock | `stock.tsx` | pools "Stockroom", "Shop floor", "Return stock" cards; KPIs On hand / Allotted / Missing; "Everything · N" / "Missing · N"; "Move stock", "Stock ledger"; pool sheet (Last movements) | `GET /inventory/pools` |
| Move stock sheet | `stock/move-sheet.tsx` | comboboxes From / To (Base UI: tap the combobox, then the option), scan field "Scan the garment's tag…", "Ready to move", "Why" (placeholder "e.g. Put out on the rail"), button "Move to <place>", "Drop it", "Moved just now · N"; notes: barcode "Moving stock needs the garment's own tag…", "“x” is not a tag this shop can read…", "A garment cannot be moved to where it already is." Needs SUPERVISOR (dian refused) | `POST /store/movements` |
| /receive | `receive.tsx`, `stock/delivery-sheet.tsx` | In transit · N / Received · N / All; card per delivery (shipment reference, "N cartons", "Receive"); sheet: blind count — scan field "Scan a barcode or type a SKU" (`SKU`, `SKU x3`), row input aria "Quantity for <name>", "Remove <name>", "Total Counted", "Submit count"; after: Items Sent/Counted, "Complete" / "N missing" / "N extra", "Tags missing · N", verdict pill | `GET /store/inbound?status=IN_TRANSIT|RECEIVED|ALL`, `POST /store/inbound/{id}/receive-count` |
| /stock/count | `count.tsx`, `stock/count-sheet.tsx` | To count · N / Done · N; sheet "Nothing counted yet. Sweep this pool with the handheld."; "Submit count" → window.confirm ("Submit an empty count?" / "Submit N pcs? You can't change it after.") — the shop cannot enter quantities, only the handheld sweep fills it | `GET /store/counts`, `POST /store/counts/{id}/submit` |
| /stock/returns | `return-to-ho.tsx` | requests head office raised (RETURN_TO_WAREHOUSE allotment); card "ALT-…", "Pack and send" (window.confirm "Send N pcs to HO?") → banner "<SJ-…> · N pcs on the way to HO"; empty "Nothing to send." A shop cannot start a return | `GET /store/return-requests`, `POST /store/return-requests/{id}/send` |
| /stock/movements | `movements.tsx` | "Search the ledger", All/In/Out/Inside, "Show the last 500", empty "No match for “q”." | `GET /inventory/movements?limit=` |
| /money/sales | `money/sales.tsx` | presets Today / 7 days / 30 days / 90 days / This month / Custom (buttons), views Days/Weeks/Months/Weekdays/Hours/Cashiers/Payment (tabs), KPIs Sales / Receipts / Average / Items | `GET /store/reports/sales/window`, `/series` |
| /money/reconciliation | | "Coming soon" | |
| /money/expenses | `money/expenses.tsx` | Balance / Received / Spent; "New float" (Amount, Reference, Note, "Counted with" = a second SUPERVISOR, "Their password"; "Create float"); "New expense" (Amount, Kind, "Paid to", "For", "Approval code from Finance" above Rp 500.000; "Create expense"; "Petty cash holds Rp N." guard) | `GET /store/petty-cash`, `/expenses`, `POST /store/expenses`, `/petty-cash/top-ups` |
| /money/cash-count | `money/cash-count.tsx` | boxes Cash on hand / Petty cash / Cashier float with "Count"; notes & coins steppers, "Reason for the difference", "Witness", "Date"; "Past counts" table | cloud `GET/POST /store-cash/boxes|counts?site=` via relay |
| /reports | `money/reports.tsx` | Today / 7 days / 30 days; Takings, Average sale, Items sold, "In the drawer", "How it was paid" | sales window |
| /news | `discuss.tsx`, `news.tsx` | "Chat" / "Notices", "New chat", conversation "Store 01", textbox "Message", button "Send" | relay `/chat/conversations` |
| /node/sync | `sync.tsx` | "Send now", figures Not yet at head office / Confirmed through / Rejected by head office / Last sent, "The sender", "This node" | `GET /sync/status`, `POST /sync/trigger` |
| /node/password | `password.tsx` | "Your current password", "New password", "New password again" ("The two do not match."), "Change password"; identity facts (Name, Sign-in name, Role, Account, Shop) | `POST /auth/password` |
| /hr/* (overview, roster, leave, directory, overtime, recruitment, lifecycle, attendance, payroll, expenses, benefits, changes) | `screens/hr/*` | head-office data of this shop through the relay ("Cikupa · from head office") | cloud via `/store/central/*` |
| /ga, /ga/assets, contracts, servicing, repairs, supplies | `screens/ga/*` | overview tiles; "New supply request" (Category radio, Item, Quantity, "Create supply request"); "New repair request" (kind radio, "In one line"; with no supplier and no asset it cannot be sent: "No supplier on record for this shop. Pick an asset to leave a note, or call GA.") | cloud via relay |

## 3. Setup helpers the tests use (all in `support/pos.ts`)
- Units: `floorUnits()` classifies the floor by the node's quote (`plain`, `shoe` 15%, `wanita` 10%, `markdown`); `pickUnit(kind)` picks from the **end** of the EPC list.
- `sellByApi`, `voidByApi`/`restoreSale` (supervisor void puts the unit back), `ensureShift`/`closeMyShift`/`countUncounted`.
- `sendDelivery(skus)` = allot (rina) → picklist/pack/shipment/dispatch (nina, yusuf) → IN_TRANSIT at the shop (~15 s); `askReturn(sku)` (RETURN_TO_WAREHOUSE from `store-01.floor`); `askCount(pool)`; `memberApp(member)` (the shopper side of a points ask: `waiting()`, `approve(id)`, `decline(id)`), `pointsOf(member)`.
