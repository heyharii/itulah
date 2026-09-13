const SCREENS = {
  "/finance": {
    title: "Overview",
    kind: "dashboard",
    group: null,
    store: true,
    job: "Menentukan pekerjaan finance yang perlu didahulukan hari ini, untuk HO maupun untuk satu toko.",
    why: "Satu layar, dua bacaan — kepala toko melihat antreannya sendiri, HO melihat ke-14 unit. Sembilan layar 'Overview' per-grup dibubarkan: sembilan pintu ke satu pertanyaan adalah sembilan layar yang berhenti dibuka.",
    erp: "Workspace (satu chart + 3 number card)",
    status: "live",
    toolbar: ["unit", "period"],
    kpis: [
      { label: "Perlu perhatian", value: "23", tone: "bad" },
      { label: "Jatuh tempo 7 hari", value: "Rp 153.930.000", tone: "warn" },
      { label: "Kas belum disetor", value: "Rp 40.315.000", tone: "warn" },
      { label: "Kontrol gagal", value: "2 dari 10", tone: "bad" }
    ],
    columns: [
      { k: "item", label: "Antrean" },
      { k: "unit", label: "Unit", w: "90px" },
      { k: "age", label: "Umur", w: "90px" },
      { k: "amt", label: "Nilai", num: true },
      { k: "st", label: "Status", tag: true }
    ],
    rows: [
      { item: "Selisih laci tidak bisa diposting — arti `cash_variance` belum punya akun", unit: "C001", age: "1 hari", amt: "50.000", st: ["Tertahan", "bad"], _unit: "C001", _goto: "/finance/account-map" },
      { item: "Tagihan lewat jatuh tempo di atas 30 hari", unit: "HO", age: "60 hari", amt: "47.630.000", st: ["Telat", "bad"], _unit: "HO", _goto: "/finance/bills" },
      { item: "Setoran SB-26-09-0236 masih PREPARED sejak kemarin", unit: "C008", age: "1 hari", amt: "8.285.000", st: ["PREPARED", "warn"], _unit: "C008", _goto: "/finance/deposits" },
      { item: "Petty cash toko tinggal di bawah satu minggu belanja", unit: "C003 · C012", age: "hari ini", amt: "1.325.000", st: ["Perlu pengisian", "warn"], _unit: "HO", _goto: "/finance/petty-cash" },
      { item: "Giro jatuh tempo hari ini — belum ada dana di rekening penerbit", unit: "HO", age: "hari ini", amt: "180.000.000", st: ["DUE", "warn"], _unit: "HO", _goto: "/finance/giro" },
      { item: "Settlement acquirer tidak cocok dengan penjualan 10 Sep", unit: "C002", age: "3 hari", amt: "340.000", st: ["EXCEPTION", "bad"], _unit: "C002", _goto: "/finance/settlements" },
      { item: "Baris rekening koran belum dicocokkan", unit: "HO", age: "2 hari", amt: "15.405.500", st: ["7 baris", "warn"], _unit: "HO", _goto: "/finance/bank-reconciliation" },
      { item: "Kartu tertagih tanpa penjualan — pembeli menunggu refund", unit: "4 toko", age: "19 hari", amt: "3.380.000", st: ["3 belum dijawab", "bad"], _unit: "HO", _goto: "/finance/unmatched-charges" },
      { item: "Agustus belum bisa ditutup — 3 dokumen menahan", unit: "HO", age: "13 hari", amt: "—", st: ["4 dari 5 kontrol", "warn"], _unit: "HO", _goto: "/finance/periods" },
      { item: "Sel antarunit belum disepakati kedua pihak", unit: "C008 · C011", age: "9 hari", amt: "615.380.000", st: ["2 sel", "warn"], _unit: "HO", _goto: "/finance/unit-balances" },
      { item: "Baris penyusutan September belum diposting", unit: "Semua", age: "hari ini", amt: "38.837.291", st: ["3 baris draf", "warn"], _unit: "HO", _goto: "/finance/depreciation" },
      { item: "Payroll HO September tertahan — `site` tidak punya baris `ho` di peta akun", unit: "HO", age: "2 hari", amt: "376.110.000", st: ["Tertahan", "bad"], _unit: "HO", _goto: "/finance/payroll-postings" },
      { item: "Piutang kepala toko tanpa jadwal potong payroll", unit: "3 toko", age: "11 bulan", amt: "63.000.000", st: ["3 pinjaman", "bad"], _unit: "HO", _goto: "/finance/staff-loans" },
      { item: "CIP berjalan lebih dari 6 bulan tanpa kapitalisasi", unit: "C005 · C008 · C012", age: "17 bulan", amt: "303.700.000", st: ["3 proyek", "warn"], _unit: "HO", _goto: "/finance/projects" },
      { item: "Saldo petty cash negatif", unit: "C009", age: "2 hari", amt: "-145.000", st: ["Dibiarkan", "warn"], _unit: "C009", _goto: "/finance/cash" },
      { item: "Unit yang pool-nya belum pernah dihitung sama sekali", unit: "9 toko", age: "sejak go-live", amt: "1.013.100.000", st: ["Belum dihitung", "bad"], _unit: "HO", _goto: "/finance/stock-value" }
    ],
    actions: [
      { label: "Jalankan kontrol malam", primary: false, form: null },
      { label: "Buka periode berikutnya", primary: false, form: "F_PERIOD" }
    ],
    note: "Antrean ini hanya menunjuk; setiap baris dikerjakan di layar pemiliknya. Tidak ada tombol posting di sini."
  },

  "/finance/sales-days": {
    title: "Sales days",
    kind: "document",
    group: "Store money",
    store: true,
    job: "Menjadikan satu hari dagang satu unit sebagai satu dokumen: pecahan tender, diskon, retur, dan pembulatan.",
    why: "Tiga kolom yang tidak pernah dilebur jadi satu selisih — tercatat kasir, dihitung, disetor — karena dua di antaranya dikerjakan orang yang berbeda. 'Status tidak pernah satu kata.'",
    erp: "POS Closing Entry / Cashier Closing",
    status: "branchD",
    toolbar: ["unit", "period", "search"],
    segments: ["Semua hari", "Belum diposting", "Ada selisih"],
    kpis: [
      { label: "Bruto 12 Sep (13 toko)", value: "Rp 186.640.000", tone: "plain" },
      { label: "Hari belum diposting", value: "2", tone: "warn" },
      { label: "Selisih laci bulan ini", value: "Rp 125.000", tone: "bad" },
      { label: "Hari dibalik", value: "1", tone: "bad" }
    ],
    columns: [
      { k: "tgl", label: "Hari dagang", w: "110px" },
      { k: "unit", label: "Unit", w: "80px" },
      { k: "cash", label: "Tunai", num: true },
      { k: "card", label: "Kartu + QRIS", num: true },
      { k: "gross", label: "Bruto", num: true },
      { k: "counted", label: "Dihitung", num: true },
      { k: "dep", label: "Disetor", num: true },
      { k: "st", label: "Status", tag: true }
    ],
    rows: [
      { tgl: "12/09/2026", unit: "C006", cash: "14.280.000", card: "18.420.000", gross: "32.700.000", counted: "14.280.000", dep: "14.280.000", st: ["POSTED", "good"], _unit: "C006" },
      { tgl: "12/09/2026", unit: "C001", cash: "21.640.000", card: "21.540.000", gross: "43.180.000", counted: "21.590.000", dep: "21.590.000", st: ["Selisih -50.000", "warn"], _unit: "C001" },
      { tgl: "12/09/2026", unit: "C005", cash: "11.930.000", card: "4.180.000", gross: "16.110.000", counted: "11.930.000", dep: "11.930.000", st: ["POSTED", "good"], _unit: "C005" },
      { tgl: "12/09/2026", unit: "C013", cash: "9.120.000", card: "8.600.000", gross: "17.720.000", counted: "9.120.000", dep: "9.120.000", st: ["POSTED · online aktif", "good"], _unit: "C013" },
      { tgl: "12/09/2026", unit: "C011", cash: "13.470.000", card: "7.320.000", gross: "20.790.000", counted: "13.470.000", dep: "13.470.000", st: ["POSTED", "good"], _unit: "C011" },
      { tgl: "12/09/2026", unit: "C008", cash: "8.260.000", card: "2.960.000", gross: "11.220.000", counted: "8.285.000", dep: "8.285.000", st: ["Selisih +25.000", "warn"], _unit: "C008" },
      { tgl: "12/09/2026", unit: "C004", cash: "6.940.000", card: "1.980.000", gross: "8.920.000", counted: "6.940.000", dep: "6.940.000", st: ["POSTED", "good"], _unit: "C004" },
      { tgl: "13/09/2026", unit: "C006", cash: "12.150.000", card: "15.830.000", gross: "27.980.000", counted: "12.150.000", dep: "—", st: ["DRAFT", "plain"], _unit: "C006" },
      { tgl: "13/09/2026", unit: "C001", cash: "19.880.000", card: "20.110.000", gross: "39.990.000", counted: "19.880.000", dep: "—", st: ["DRAFT", "plain"], _unit: "C001" },
      { tgl: "11/09/2026", unit: "C002", cash: "7.510.000", card: "5.640.000", gross: "13.150.000", counted: "7.510.000", dep: "7.510.000", st: ["POSTED · settlement eksepsi", "warn"], _unit: "C002" },
      { tgl: "11/09/2026", unit: "C009", cash: "10.320.000", card: "3.450.000", gross: "13.770.000", counted: "10.320.000", dep: "10.320.000", st: ["POSTED", "good"], _unit: "C009" },
      { tgl: "11/09/2026", unit: "C003", cash: "5.870.000", card: "1.240.000", gross: "7.110.000", counted: "5.870.000", dep: "5.870.000", st: ["POSTED", "good"], _unit: "C003" },
      { tgl: "10/09/2026", unit: "C007", cash: "6.430.000", card: "2.180.000", gross: "8.610.000", counted: "6.380.000", dep: "6.380.000", st: ["Selisih -50.000", "warn"], _unit: "C007" },
      { tgl: "10/09/2026", unit: "C012", cash: "4.980.000", card: "1.520.000", gross: "6.500.000", counted: "4.980.000", dep: "4.980.000", st: ["POSTED", "good"], _unit: "C012" },
      { tgl: "09/09/2026", unit: "C010", cash: "5.240.000", card: "1.860.000", gross: "7.100.000", counted: "5.240.000", dep: "5.240.000", st: ["REVERSED", "bad"], _unit: "C010" }
    ],
    actions: [
      { label: "Konfirmasi hari", primary: true, form: "F_SALES_DAY" },
      { label: "Post", form: null },
      { label: "Balik hari", form: "F_REVERSE" }
    ],
    journal: [
      { dr: "cash", cr: "revenue_cash", note: "tunai, per unit — 4010110 lawan 1011001001" },
      { dr: "card_receivable_debit", cr: "revenue_debit", note: "per acquirer, qualifier = bank (4 bank debit)" },
      { dr: "card_receivable_credit", cr: null, note: "Visa/Master via BCA — 1011101001" },
      { dr: "qris_receivable", cr: null, note: "bagan tidak punya `revenue_qris` yang jujur — baris ini menunggu keputusan pemilik" },
      { dr: "voucher_liability", cr: "revenue_cash", note: "voucher ditebus; penjualannya masih belum ada yang mencatat" },
      { dr: "cogs", cr: "inventory", note: "relief 5010110 dari 1011201 — belum ada penulisnya (G3)" },
      { dr: null, cr: "cash_variance", note: "pembulatan POS ke 8010110002" }
    ],
    note: "Dua baris terbuka: §11.2 (pendapatan POS diposting harian atau tidak sama sekali) dan `revenue_qris` yang tidak punya padanan di bagan. QRIS sudah hidup di till."
  },

  "/finance/deposits": {
    title: "Deposits",
    kind: "document",
    group: "Store money",
    store: true,
    job: "Setoran tunai hari ini ke bank, top-up petty cash yang mendarat, dan modal kasir yang tetap.",
    why: "Lubang yang §9 docs/finance.md temukan sendiri: setoran kas toko ke bank tidak punya dokumen. `cash_in_transit` tidak dipakai — pemilik memutuskan setoran hari yang sama, dan bagan memang tidak punya akunnya.",
    erp: "Payment Entry (Internal Transfer)",
    status: "branchD",
    toolbar: ["unit", "period", "search"],
    segments: ["Setoran ke bank", "Top-up petty cash", "Modal kasir"],
    kpis: [
      { label: "Disetor 12 Sep", value: "Rp 85.615.000", tone: "plain" },
      { label: "Belum berangkat", value: "Rp 20.435.000", tone: "warn" },
      { label: "Top-up menunggu HO", value: "1", tone: "warn" },
      { label: "Modal kasir tertempat", value: "Rp 65.000.000", tone: "good" }
    ],
    columns: [
      { k: "no", label: "Nomor", w: "180px" },
      { k: "tgl", label: "Tanggal", w: "100px" },
      { k: "unit", label: "Unit", w: "80px" },
      { k: "bank", label: "Rekening tujuan" },
      { k: "amt", label: "Nilai", num: true },
      { k: "st", label: "Status", tag: true }
    ],
    rows: [
      { no: "SB-26-09-0231", tgl: "12/09/2026", unit: "C006", bank: "BCA giro (HO)", amt: "14.280.000", st: ["CONFIRMED", "good"], _unit: "C006" },
      { no: "SB-26-09-0232", tgl: "12/09/2026", unit: "C001", bank: "BCA giro (HO)", amt: "21.590.000", st: ["CONFIRMED", "good"], _unit: "C001" },
      { no: "SB-26-09-0233", tgl: "12/09/2026", unit: "C005", bank: "Mandiri giro (HO)", amt: "11.930.000", st: ["DEPOSITED", "info"], _unit: "C005" },
      { no: "SB-26-09-0234", tgl: "12/09/2026", unit: "C013", bank: "BRI giro (HO)", amt: "9.120.000", st: ["CONFIRMED", "good"], _unit: "C013" },
      { no: "SB-26-09-0235", tgl: "12/09/2026", unit: "C011", bank: "BCA giro (HO)", amt: "13.470.000", st: ["DEPOSITED", "info"], _unit: "C011" },
      { no: "SB-26-09-0236", tgl: "12/09/2026", unit: "C008", bank: "BNI giro (HO)", amt: "8.285.000", st: ["PREPARED · 1 hari", "warn"], _unit: "C008" },
      { no: "SB-26-09-0237", tgl: "12/09/2026", unit: "C004", bank: "Mandiri giro (HO)", amt: "6.940.000", st: ["CONFIRMED", "good"], _unit: "C004" },
      { no: "SB-26-09-0239", tgl: "13/09/2026", unit: "C006", bank: "BCA giro (HO)", amt: "12.150.000", st: ["PREPARED", "plain"], _unit: "C006" },
      { no: "SB-26-09-0240", tgl: "13/09/2026", unit: "C001", bank: "BCA giro (HO)", amt: "19.880.000", st: ["PREPARED", "plain"], _unit: "C001" },
      { no: "SB-26-09-0228", tgl: "11/09/2026", unit: "C002", bank: "BCA giro (HO)", amt: "7.510.000", st: ["Dibalik · salah rekening", "bad"], _unit: "C002" },
      { no: "KK-RPL-26-09-0044", tgl: "11/09/2026", unit: "C006", bank: "dari BCA giro (HO)", amt: "2.500.000", st: ["POSTED", "good"], _unit: "C006" },
      { no: "KK-RPL-26-09-0045", tgl: "12/09/2026", unit: "C011", bank: "dari BCA giro (HO)", amt: "1.800.000", st: ["POSTED", "good"], _unit: "C011" },
      { no: "KK-RPL-26-09-0046", tgl: "13/09/2026", unit: "C003", bank: "dari Mandiri giro (HO)", amt: "2.000.000", st: ["Menunggu HO", "warn"], _unit: "C003" },
      { no: "MK-26-08-0007", tgl: "28/08/2026", unit: "C006", bank: "dari BCA giro (HO)", amt: "5.000.000", st: ["Tetap · tidak bergerak", "good"], _unit: "C006" },
      { no: "MK-26-09-0009", tgl: "02/09/2026", unit: "C013", bank: "dari BCA giro (HO)", amt: "5.000.000", st: ["POSTED · penempatan", "good"], _unit: "C013" }
    ],
    actions: [
      { label: "Siapkan setoran", primary: true, form: "F_DEPOSIT" },
      { label: "Tandai disetor", form: null },
      { label: "Konfirmasi dari koran", form: null }
    ],
    journal: [
      { dr: "bank_giro", cr: "cash", note: "setoran: satu langkah, tanpa `cash_in_transit` — qualifier = bank tujuan, site kas = toko" },
      { dr: "petty_cash", cr: "bank_giro", note: "top-up KK-RPL-: petty cash di site toko, bank di HO" },
      { dr: "cashier_float", cr: "bank_giro", note: "modal kasir: sekali per toko, dari HO, tidak pernah dibelanjakan" },
      { dr: "affiliate_receivable", cr: "affiliate_payable", note: "kaki afiliasi otomatis karena kedua site berbeda (PEMBIAYAAN)" }
    ],
    note: "Rekening tujuan selalu milik HO — toko tidak punya akses ke satu rekening bank pun."
  },


  "/finance/petty-cash": {
    title: "Petty cash",
    kind: "document",
    group: "Store money",
    store: true,
    job: "Buku kas kecil satu toko: apa yang masuk dari HO, apa yang dibelanjakan, dan sisanya.",
    why: "Belanja di bawah Rp 500.000 adalah HAK toko, bukan permintaan — dicatat lalu langsung membukukan, tanpa antrean dan tanpa menunggu siapa pun. Ambang itu satu aturan pada form, bukan satu layar kedua; di atas ambang barisnya tidak bisa disimpan tanpa menyebut siapa di HO yang mengizinkan.",
    erp: "— (ERPNext tidak punya petty cash; hanya prosedur di manual)",
    status: "branchD",
    toolbar: ["unit", "period", "search"],
    kpis: [
      { label: "Saldo petty cash sekarang", value: "Rp 2.845.000", tone: "plain" },
      { label: "Dibelanjakan bulan ini", value: "Rp 7.215.000", tone: "plain" },
      { label: "Sisa sebelum pengisian berikutnya", value: "Rp 2.845.000 · 7 hari lagi", tone: "warn" },
      { label: "Ambang tanpa izin HO", value: "Rp 500.000", tone: "plain" }
    ],
    columns: [
      { k: "tgl", label: "Tanggal", w: "100px" },
      { k: "no", label: "Nomor", w: "200px", mono: true },
      { k: "ket", label: "Untuk apa" },
      { k: "masuk", label: "Masuk", num: true },
      { k: "keluar", label: "Keluar", num: true },
      { k: "saldo", label: "Saldo", num: true },
      { k: "st", label: "Status", tag: true }
    ],
    rows: [
      { tgl: "13/09/2026", no: "KK-STORE-06-26-09-00112", ket: "Iuran sampah & kebersihan", masuk: "—", keluar: "75.000", saldo: "2.845.000", st: ["Dibukukan", "good"], _unit: "C006" },
      { tgl: "13/09/2026", no: "KK-STORE-06-26-09-00111", ket: "ATK & tinta printer struk", masuk: "—", keluar: "145.000", saldo: "2.920.000", st: ["Dibukukan", "good"], _unit: "C006" },
      { tgl: "12/09/2026", no: "KK-STORE-06-26-09-00110", ket: "Perbaikan pintu kaca depan — izin HO: Dewi Lestari (Adm HO)", masuk: "—", keluar: "1.850.000", saldo: "3.065.000", st: ["Izin HO", "info"], _unit: "C006" },
      { tgl: "12/09/2026", no: "KK-STORE-06-26-09-00109", ket: "Parkir & tol antar barang", masuk: "—", keluar: "35.000", saldo: "4.915.000", st: ["Dibukukan", "good"], _unit: "C006" },
      { tgl: "12/09/2026", no: "KK-STORE-06-26-09-00108", ket: "Air galon 4 galon", masuk: "—", keluar: "80.000", saldo: "4.950.000", st: ["Dibukukan", "good"], _unit: "C006" },
      { tgl: "11/09/2026", no: "KK-STORE-06-26-09-00107", ket: "Servis AC toko 2 unit — izin HO: Dewi Lestari (Adm HO)", masuk: "—", keluar: "1.250.000", saldo: "5.030.000", st: ["Izin HO", "info"], _unit: "C006" },
      { tgl: "10/09/2026", no: "KK-STORE-06-26-09-00106", ket: "Konsumsi rapat toko", masuk: "—", keluar: "185.000", saldo: "6.280.000", st: ["Dibukukan", "good"], _unit: "C006" },
      { tgl: "09/09/2026", no: "KK-STORE-06-26-09-00105", ket: "Servis kunci & gembok rolling door", masuk: "—", keluar: "420.000", saldo: "6.465.000", st: ["Dibukukan", "good"], _unit: "C006" },
      { tgl: "08/09/2026", no: "KK-STORE-06-26-09-00104", ket: "Bensin antar barang ke C007", masuk: "—", keluar: "120.000", saldo: "6.885.000", st: ["Dibukukan", "good"], _unit: "C006" },
      { tgl: "07/09/2026", no: "KK-STORE-06-26-09-00103", ket: "Air galon 8 galon", masuk: "—", keluar: "160.000", saldo: "7.005.000", st: ["Dibukukan", "good"], _unit: "C006" },
      { tgl: "05/09/2026", no: "KK-RPL-26-09-00044", ket: "Pengisian dari HO — transfer BCA giro", masuk: "3.000.000", keluar: "—", saldo: "7.165.000", st: ["Diterima", "good"], _unit: "C006" },
      { tgl: "05/09/2026", no: "KK-STORE-06-26-09-00102", ket: "Gaji Agustus — 3 staf harian & kebersihan", masuk: "—", keluar: "2.400.000", saldo: "4.165.000", st: ["Dibukukan", "good"], _unit: "C006" },
      { tgl: "04/09/2026", no: "KK-STORE-06-26-09-00101", ket: "Materai 10.000 × 10 lembar", masuk: "—", keluar: "110.000", saldo: "6.565.000", st: ["Dibukukan", "good"], _unit: "C006" },
      { tgl: "02/09/2026", no: "KK-STORE-06-26-09-00099", ket: "ATK & kertas struk kasir", masuk: "—", keluar: "235.000", saldo: "6.675.000", st: ["Dibukukan", "good"], _unit: "C006" },
      { tgl: "01/09/2026", no: "KK-STORE-06-26-09-00098", ket: "Iuran lingkungan & keamanan September", masuk: "—", keluar: "150.000", saldo: "6.910.000", st: ["Dibukukan", "good"], _unit: "C006" },
      { tgl: "31/08/2026", no: "—", ket: "Saldo awal September", masuk: "—", keluar: "—", saldo: "7.060.000", st: ["Saldo awal", "plain"], _unit: "C006" }
    ],
    actions: [
      { label: "Catat belanja", primary: true, fields: [["Unit", "chip"], ["Tanggal", "date"], ["Untuk apa", "text"], ["Nilai", "amount", "Di atas Rp 500.000 wajib menyebut siapa di HO yang mengizinkan"], ["Bukti/nota", "text"]] },
      { label: "Catat pengisian dari HO", form: "F_RPL" }
    ],
    journal: [
      { dr: "expense_by_category", cr: null, note: "akun beban sesuai kategori, di unit toko" },
      { dr: null, cr: "petty_cash", note: "di unit toko — tidak pernah cash on hand" },
      { dr: "petty_cash", cr: "bank_giro", note: "pengisian KK-RPL-: petty cash di toko, bank di HO" },
      { dr: "payroll_payable", cr: "petty_cash", note: "gaji di unit dibayar lewat petty cash (kebijakan pemilik)" }
    ],
    note: "Uang penjualan di laci tidak pernah membayar apa pun. Sumbernya selalu petty cash."
  },

  "/finance/cash": {
    title: "Cash",
    kind: "report",
    group: "Cash & Bank",
    store: true,
    job: "Di mana uang tunai berada, per unit, dalam tiga pot: kas penjualan, petty cash, dan modal kasir.",
    why: "Kas tidak simetris dengan bank: bank dicocokkan dengan rekening koran, kas dicocokkan dengan hitungan fisik. Karena itu tidak ada Cash Account, Cash Transaction, atau Cash Reconciliation — hanya layar baca ini dan Cash Counts.",
    erp: "— (Cash tidak simetris dengan Bank)",
    status: "partial",
    toolbar: ["unit", "asof"],
    kpis: [
      { label: "Tunai belum disetor", value: "Rp 40.315.000", tone: "warn" },
      { label: "Petty cash 14 unit", value: "Rp 33.727.000", tone: "plain" },
      { label: "Modal kasir (tetap)", value: "Rp 65.000.000", tone: "good" },
      { label: "Unit dengan pot negatif", value: "1", tone: "bad" }
    ],
    columns: [
      { k: "unit", label: "Unit", w: "90px" },
      { k: "nama", label: "Nama" },
      { k: "cash", label: "Kas penjualan", num: true },
      { k: "petty", label: "Petty cash", num: true },
      { k: "float", label: "Modal kasir", num: true },
      { k: "total", label: "Total", num: true },
      { k: "st", label: "Keadaan", tag: true }
    ],
    rows: [
      { unit: "HO", nama: "Head Office (00)", cash: "—", petty: "12.400.000", float: "—", total: "12.400.000", st: ["Tidak menerima tunai", "plain"], _unit: "HO" },
      { unit: "C001", nama: "CIKUPA", cash: "19.880.000", petty: "1.640.000", float: "5.000.000", total: "26.520.000", st: ["Belum disetor hari ini", "warn"], _unit: "C001" },
      { unit: "C002", nama: "MUARO BUNGO", cash: "—", petty: "2.180.000", float: "5.000.000", total: "7.180.000", st: ["Bersih", "good"], _unit: "C002" },
      { unit: "C003", nama: "PURBALINGGA", cash: "—", petty: "385.000", float: "5.000.000", total: "5.385.000", st: ["Petty cash menipis", "warn"], _unit: "C003" },
      { unit: "C004", nama: "BUMIAYU", cash: "—", petty: "1.920.000", float: "5.000.000", total: "6.920.000", st: ["Bersih", "good"], _unit: "C004" },
      { unit: "C005", nama: "JAMBI", cash: "—", petty: "2.460.000", float: "5.000.000", total: "7.460.000", st: ["Bersih", "good"], _unit: "C005" },
      { unit: "C006", nama: "WIRAMODE", cash: "12.150.000", petty: "2.845.000", float: "5.000.000", total: "19.995.000", st: ["Belum disetor hari ini", "warn"], _unit: "C006" },
      { unit: "C007", nama: "BREBES", cash: "—", petty: "1.372.000", float: "5.000.000", total: "6.372.000", st: ["Bersih", "good"], _unit: "C007" },
      { unit: "C008", nama: "PASURUAN", cash: "8.285.000", petty: "2.050.000", float: "5.000.000", total: "15.335.000", st: ["Setoran tertahan 1 hari", "bad"], _unit: "C008" },
      { unit: "C009", nama: "WMJB", cash: "—", petty: "-145.000", float: "5.000.000", total: "4.855.000", st: ["Petty cash negatif", "bad"], _unit: "C009" },
      { unit: "C010", nama: "WMBA", cash: "—", petty: "1.650.000", float: "5.000.000", total: "6.650.000", st: ["Bersih", "good"], _unit: "C010" },
      { unit: "C011", nama: "SIPIN", cash: "—", petty: "1.800.000", float: "5.000.000", total: "6.800.000", st: ["Bersih", "good"], _unit: "C011" },
      { unit: "C012", nama: "BANJARAN", cash: "—", petty: "940.000", float: "5.000.000", total: "5.940.000", st: ["Petty cash menipis", "warn"], _unit: "C012" },
      { unit: "C013", nama: "WONOSOBO", cash: "—", petty: "2.230.000", float: "5.000.000", total: "7.230.000", st: ["Bersih", "good"], _unit: "C013" }
    ],
    actions: [
      { label: "Ekspor posisi kas", form: null }
    ],
    note: "Tiga akun: 1011001001 CASH ON HAND · 1011001002 PETTY CASH · 1011001003 MODAL KASIR. Saldo negatif C009 dibiarkan, bukan ditolak — §11.4 masih keputusan pemilik yang terbuka."
  },

  "/finance/cash-counts": {
    title: "Cash Counts",
    kind: "document",
    group: "Cash & Bank",
    store: true,
    job: "Menghitung laci dalam pecahan, membandingkannya dengan saldo buku, dan membukukan selisihnya dengan alasan.",
    why: "Sumber kebenaran kas adalah orang, bukan rekening koran — jadi yang dibandingkan adalah hitungan fisik dengan saldo buku. Selisihnya tidak pernah disimpan sebagai kolom: ia dihitung ulang dari dua angka yang disimpan.",
    erp: "prosedur Petty Cash (kita lebih maju)",
    status: "partial",
    toolbar: ["unit", "period", "search"],
    segments: ["Semua", "Belum dihitung", "Ada selisih"],
    kpis: [
      { label: "Selisih belum terbukukan", value: "Rp 125.000", tone: "bad" },
      { label: "Posting tertahan", value: "3", tone: "bad" },
      { label: "Belum dihitung hari ini", value: "3", tone: "warn" },
      { label: "Hitungan bulan ini", value: "118", tone: "plain" }
    ],
    columns: [
      { k: "tgl", label: "Tanggal", w: "100px" },
      { k: "unit", label: "Unit", w: "80px" },
      { k: "pot", label: "Pot" },
      { k: "books", label: "Per buku", num: true },
      { k: "counted", label: "Dihitung", num: true },
      { k: "vari", label: "Selisih", num: true },
      { k: "st", label: "Status", tag: true }
    ],
    rows: [
      { tgl: "12/09/2026", unit: "C006", pot: "CASH ON HAND", books: "14.280.000", counted: "14.280.000", vari: "0", st: ["POSTED", "good"], _unit: "C006" },
      { tgl: "12/09/2026", unit: "C001", pot: "CASH ON HAND", books: "21.640.000", counted: "21.590.000", vari: "-50.000", st: ["Tertahan · cash_variance", "bad"], _unit: "C001" },
      { tgl: "12/09/2026", unit: "C008", pot: "CASH ON HAND", books: "8.260.000", counted: "8.285.000", vari: "25.000", st: ["Tertahan · cash_variance", "bad"], _unit: "C008" },
      { tgl: "12/09/2026", unit: "C006", pot: "PETTY CASH", books: "2.845.000", counted: "2.845.000", vari: "0", st: ["POSTED", "good"], _unit: "C006" },
      { tgl: "12/09/2026", unit: "C006", pot: "MODAL KASIR", books: "5.000.000", counted: "5.000.000", vari: "0", st: ["POSTED", "good"], _unit: "C006" },
      { tgl: "11/09/2026", unit: "C005", pot: "CASH ON HAND", books: "11.930.000", counted: "11.930.000", vari: "0", st: ["POSTED", "good"], _unit: "C005" },
      { tgl: "11/09/2026", unit: "C003", pot: "PETTY CASH", books: "385.000", counted: "385.000", vari: "0", st: ["POSTED", "good"], _unit: "C003" },
      { tgl: "10/09/2026", unit: "C007", pot: "CASH ON HAND", books: "6.430.000", counted: "6.380.000", vari: "-50.000", st: ["Tertahan · cash_variance", "bad"], _unit: "C007" },
      { tgl: "12/09/2026", unit: "C011", pot: "CASH ON HAND", books: "13.470.000", counted: "13.470.000", vari: "0", st: ["POSTED", "good"], _unit: "C011" },
      { tgl: "12/09/2026", unit: "C013", pot: "CASH ON HAND", books: "9.120.000", counted: "9.120.000", vari: "0", st: ["POSTED", "good"], _unit: "C013" },
      { tgl: "12/09/2026", unit: "C009", pot: "PETTY CASH", books: "-145.000", counted: "-145.000", vari: "0", st: ["POSTED · saldo negatif", "warn"], _unit: "C009" },
      { tgl: "13/09/2026", unit: "C004", pot: "CASH ON HAND", books: "6.940.000", counted: "—", vari: "—", st: ["Belum dihitung", "warn"], _unit: "C004" },
      { tgl: "13/09/2026", unit: "C002", pot: "CASH ON HAND", books: "7.510.000", counted: "—", vari: "—", st: ["Belum dihitung", "warn"], _unit: "C002" },
      { tgl: "13/09/2026", unit: "C010", pot: "PETTY CASH", books: "1.650.000", counted: "—", vari: "—", st: ["Belum dihitung", "warn"], _unit: "C010" },
      { tgl: "09/09/2026", unit: "HO", pot: "PETTY CASH", books: "12.400.000", counted: "12.400.000", vari: "0", st: ["POSTED", "good"], _unit: "HO" }
    ],
    actions: [
      { label: "Hitung laci", primary: true, form: "F_COUNT" },
      { label: "Post selisih", form: null }
    ],
    journal: [
      { dr: "cash", cr: "cash_variance", note: "kalau hitungan LEBIH dari buku — akun pot mengikuti pilihan, site = unit" },
      { dr: "cash_variance", cr: "cash", note: "kalau hitungan KURANG dari buku" },
      { dr: "petty_cash", cr: "cash_variance", note: "pot petty cash, unit yang sama" },
      { dr: "cashier_float", cr: "cash_variance", note: "pot modal kasir — selisih di sini selalu jadi temuan, bukan jurnal rutin" }
    ],
    note: "Tiga hitungan tertahan: `cash_variance` dipakai cash_counts.rs:33 tapi tidak dideklarasikan di required_semantic_keys(), jadi Account Map tidak melihatnya dan Period close mengira peta lengkap. Keputusan COA 7 Sep mengarahkan ke 8010110007; belum di-seed."
  },

  "/finance/banks": {
    title: "Banks",
    kind: "setting",
    group: "Cash & Bank",
    store: false,
    job: "Master institusi bank — enam, bukan lima — beserta peran masing-masing: giro, tabungan, acquirer.",
    why: "Bagan memakai dua daftar bank yang berbeda: giro dan pinjaman memakai BCA/Mandiri/BRI/BNI/Danamon, tabungan memakai BCA/Mandiri/BRI/BNI/BTN. Master ini adalah gabungannya, bukan salah satu daftarnya.",
    erp: "Bank",
    status: "partial",
    toolbar: ["search"],
    kpis: [
      { label: "Institusi", value: "6", tone: "good" },
      { label: "Rekening kami", value: "10", tone: "plain" },
      { label: "Berperan acquirer", value: "3", tone: "plain" },
      { label: "Punya blanko giro", value: "5", tone: "plain" }
    ],
    columns: [
      { k: "nama", label: "Institusi" },
      { k: "kode", label: "Kode", w: "80px" },
      { k: "giro", label: "Giro", tag: true },
      { k: "tab", label: "Tabungan", tag: true },
      { k: "acq", label: "Acquirer", tag: true },
      { k: "rek", label: "Rekening", num: true },
      { k: "st", label: "Status", tag: true }
    ],
    rows: [
      { nama: "Bank Central Asia (BCA)", kode: "014", giro: ["Ya", "good"], tab: ["Ya", "good"], acq: ["Debit · Kredit · QRIS", "info"], rek: "2", st: ["Aktif", "good"], _unit: "HO" },
      { nama: "Bank Mandiri", kode: "008", giro: ["Ya", "good"], tab: ["Ya", "good"], acq: ["Debit", "info"], rek: "2", st: ["Aktif", "good"], _unit: "HO" },
      { nama: "Bank Rakyat Indonesia (BRI)", kode: "002", giro: ["Ya", "good"], tab: ["Ya", "good"], acq: ["Debit", "info"], rek: "2", st: ["Aktif", "good"], _unit: "HO" },
      { nama: "Bank Negara Indonesia (BNI)", kode: "009", giro: ["Ya", "good"], tab: ["Ya", "good"], acq: ["—", "plain"], rek: "2", st: ["Aktif", "good"], _unit: "HO" },
      { nama: "Bank Danamon", kode: "011", giro: ["Ya", "good"], tab: ["Tidak ada di bagan", "warn"], acq: ["—", "plain"], rek: "1", st: ["Aktif", "good"], _unit: "HO" },
      { nama: "Bank Tabungan Negara (BTN)", kode: "200", giro: ["Tidak ada di bagan", "warn"], tab: ["Ya", "good"], acq: ["—", "plain"], rek: "1", st: ["Aktif · hanya tabungan", "info"], _unit: "HO" }
    ],
    actions: [
      { label: "Tambah institusi", primary: true, form: "F_BANK" }
    ],
    note: "Enam baris, dan memang hanya enam: master ini sengaja tidak lebih panjang dari kenyataan bagan. Danamon tidak punya tabungan dan BTN tidak punya giro — dua kolom yang berbeda, satu daftar."
  },

  "/finance/bank-accounts": {
    title: "Bank Accounts",
    kind: "setting",
    group: "Cash & Bank",
    store: false,
    job: "Rekening kami dan rekening pemasok: nomor, pemegang, cabang, dan apakah ia giro atau tabungan.",
    why: "Setiap rekening bank milik head office; tidak ada satu pun toko yang punya akses ke rekening. Master ini tidak memutuskan ke mana posting mendarat — 'peta yang masih memutuskan itu' — ia hanya menyimpan nomornya.",
    erp: "Bank Account",
    status: "partial",
    toolbar: ["search", "segmented"],
    segments: ["Rekening kami", "Rekening pemasok", "Ditutup"],
    kpis: [
      { label: "Rekening kami", value: "10", tone: "plain" },
      { label: "Dipegang toko", value: "0", tone: "good" },
      { label: "Rekening pemasok terverifikasi", value: "4 dari 5", tone: "warn" },
      { label: "Ditutup", value: "2", tone: "plain" }
    ],
    columns: [
      { k: "bank", label: "Bank", w: "110px" },
      { k: "no", label: "Nomor", w: "150px", mono: true },
      { k: "holder", label: "Pemegang" },
      { k: "cab", label: "Cabang" },
      { k: "kind", label: "Jenis", tag: true },
      { k: "own", label: "Milik", w: "90px" },
      { k: "st", label: "Status", tag: true }
    ],
    rows: [
      { bank: "BCA", no: "206 300 **** 41", holder: "PT Central Fashion Store", cab: "Tangerang", kind: ["GIRO", "info"], own: "Kami", st: ["Aktif", "good"], _unit: "HO" },
      { bank: "Mandiri", no: "137 000 **** 82", holder: "PT Central Fashion Store", cab: "Jakarta Kota", kind: ["GIRO", "info"], own: "Kami", st: ["Aktif", "good"], _unit: "HO" },
      { bank: "BRI", no: "0209 01 **** 307", holder: "PT Central Fashion Store", cab: "Purbalingga", kind: ["GIRO", "info"], own: "Kami", st: ["Aktif", "good"], _unit: "HO" },
      { bank: "BNI", no: "088 461 **** 5", holder: "PT Central Fashion Store", cab: "Jambi", kind: ["GIRO", "info"], own: "Kami", st: ["Aktif", "good"], _unit: "HO" },
      { bank: "Danamon", no: "003 570 **** 9", holder: "PT Central Fashion Store", cab: "Tangerang", kind: ["GIRO", "info"], own: "Kami", st: ["Aktif", "good"], _unit: "HO" },
      { bank: "BCA", no: "206 188 **** 06", holder: "PT Central Fashion Store", cab: "Tangerang", kind: ["TABUNGAN", "plain"], own: "Kami", st: ["Aktif", "good"], _unit: "HO" },
      { bank: "Mandiri", no: "137 004 **** 15", holder: "PT Central Fashion Store", cab: "Jakarta Kota", kind: ["TABUNGAN", "plain"], own: "Kami", st: ["Aktif", "good"], _unit: "HO" },
      { bank: "BRI", no: "0209 01 **** 512", holder: "PT Central Fashion Store", cab: "Purbalingga", kind: ["TABUNGAN", "plain"], own: "Kami", st: ["Aktif", "good"], _unit: "HO" },
      { bank: "BNI", no: "088 462 **** 1", holder: "PT Central Fashion Store", cab: "Jambi", kind: ["TABUNGAN", "plain"], own: "Kami", st: ["Ditutup 08/2026", "plain"], _unit: "HO" },
      { bank: "BTN", no: "0031 01 **** 44", holder: "PT Central Fashion Store", cab: "Semarang", kind: ["TABUNGAN", "plain"], own: "Kami", st: ["Aktif", "good"], _unit: "HO" },
      { bank: "BCA", no: "180 833 **** 1", holder: "PT Anugrah Busana", cab: "Bandung", kind: ["GIRO", "info"], own: "Pemasok", st: ["Terverifikasi", "good"], _unit: "HO" },
      { bank: "Mandiri", no: "130 006 **** 77", holder: "CV Mitra Tekstil", cab: "Solo", kind: ["GIRO", "info"], own: "Pemasok", st: ["Terverifikasi", "good"], _unit: "HO" },
      { bank: "BCA", no: "588 041 **** 2", holder: "PT Sinar Rejeki Garment", cab: "Bandung", kind: ["GIRO", "info"], own: "Pemasok", st: ["Terverifikasi", "good"], _unit: "HO" },
      { bank: "BNI", no: "071 993 **** 4", holder: "CV Berkah Sandang", cab: "Pekalongan", kind: ["TABUNGAN", "plain"], own: "Pemasok", st: ["Belum terverifikasi", "bad"], _unit: "HO" },
      { bank: "BRI", no: "3021 01 **** 889", holder: "PT Karya Mode Indonesia", cab: "Surabaya", kind: ["GIRO", "info"], own: "Pemasok", st: ["Terverifikasi", "good"], _unit: "HO" },
      { bank: "Danamon", no: "003 118 **** 2", holder: "PT Central Fashion Store", cab: "Pasuruan", kind: ["GIRO", "info"], own: "Kami", st: ["Ditutup 2025", "plain"], _unit: "HO" }
    ],
    actions: [
      { label: "Tambah rekening", primary: true, form: "F_BANKACC" },
      { label: "Verifikasi rekening pemasok", form: null }
    ],
    note: "Nomor disimpan terenkripsi; yang tampil adalah mask. Salinan tak-berubah dari nomor tujuan ikut setiap pembayaran (payment_destination_snapshot), supaya bukti transfer tidak berpindah kalau master diedit."
  },

  "/finance/bank-transactions": {
    title: "Bank Transactions",
    kind: "document",
    group: "Cash & Bank",
    store: false,
    job: "Baris rekening koran yang masuk ke sistem, dan riwayat imporya dari mana.",
    why: "Aturan kategorisasi koran dan sumber statement adalah lembar dari toolbar layar ini, bukan baris menu sendiri — 'sebuah aturan MENGUSULKAN, ia tidak pernah memposting'.",
    erp: "Bank Transaction + Bank Statement Import",
    status: "partial",
    toolbar: ["unit", "period", "search", "segmented"],
    segments: ["Baris koran", "Riwayat impor"],
    kpis: [
      { label: "Belum dicocokkan", value: "7", tone: "warn" },
      { label: "Belum dibukukan", value: "4", tone: "warn" },
      { label: "Impor terakhir", value: "13/09 06:10 · IMAP", tone: "good" },
      { label: "Diusulkan aturan", value: "12", tone: "plain" }
    ],
    columns: [
      { k: "tgl", label: "Tanggal", w: "100px" },
      { k: "bank", label: "Rekening", w: "130px" },
      { k: "ket", label: "Keterangan koran" },
      { k: "masuk", label: "Masuk", num: true },
      { k: "keluar", label: "Keluar", num: true },
      { k: "st", label: "Status", tag: true }
    ],
    rows: [
      { tgl: "13/09/2026", bank: "BCA giro", ket: "JASA GIRO", masuk: "1.284.500", keluar: "—", st: ["Belum dibukukan", "warn"], _unit: "HO" },
      { tgl: "13/09/2026", bank: "BCA giro", ket: "PAJAK JASA GIRO", masuk: "—", keluar: "256.900", st: ["Belum dibukukan", "warn"], _unit: "HO" },
      { tgl: "12/09/2026", bank: "BCA giro", ket: "SETORAN TUNAI C006 WIRAMODE", masuk: "14.280.000", keluar: "—", st: ["Terbuku", "good"], _unit: "C006" },
      { tgl: "12/09/2026", bank: "BCA giro", ket: "SETORAN TUNAI C001 CIKUPA", masuk: "21.590.000", keluar: "—", st: ["Terbuku", "good"], _unit: "C001" },
      { tgl: "12/09/2026", bank: "BCA giro", ket: "TRSF E-BANKING CR BCA MERCHANT 11SEP", masuk: "9.465.780", keluar: "—", st: ["Terbuku", "good"], _unit: "HO" },
      { tgl: "12/09/2026", bank: "BCA giro", ket: "BIAYA ADM", masuk: "—", keluar: "25.000", st: ["Belum dibukukan", "warn"], _unit: "HO" },
      { tgl: "12/09/2026", bank: "BCA giro", ket: "TRSF DB PT ANUGRAH BUSANA", masuk: "—", keluar: "95.005.000", st: ["Terbuku", "good"], _unit: "HO" },
      { tgl: "12/09/2026", bank: "BCA giro", ket: "TRSF KE MANDIRI 137000****82", masuk: "—", keluar: "200.000.000", st: ["Terbuku", "good"], _unit: "HO" },
      { tgl: "12/09/2026", bank: "Mandiri giro", ket: "TRSF MASUK DARI BCA 206300****41", masuk: "200.000.000", keluar: "—", st: ["Terbuku", "good"], _unit: "HO" },
      { tgl: "12/09/2026", bank: "Mandiri giro", ket: "SETORAN TUNAI C005 JAMBI", masuk: "11.930.000", keluar: "—", st: ["Belum dicocokkan", "warn"], _unit: "C005" },
      { tgl: "12/09/2026", bank: "Mandiri giro", ket: "TRSF MASUK MANDIRI MERCHANT 11SEP", masuk: "3.168.000", keluar: "—", st: ["Terbuku", "good"], _unit: "HO" },
      { tgl: "12/09/2026", bank: "BRI giro", ket: "SETORAN TUNAI C013 WONOSOBO", masuk: "9.120.000", keluar: "—", st: ["Belum dicocokkan", "warn"], _unit: "C013" },
      { tgl: "12/09/2026", bank: "BCA giro", ket: "TRSF MASUK TANPA BERITA", masuk: "5.000.000", keluar: "—", st: ["Tanpa lawan", "bad"], _unit: "HO" },
      { tgl: "11/09/2026", bank: "BNI giro", ket: "TRSF DB CV BERKAH SANDANG", masuk: "—", keluar: "34.950.000", st: ["Terbuku", "good"], _unit: "HO" },
      { tgl: "11/09/2026", bank: "BNI giro", ket: "TOLAKAN TRANSFER — REKENING TIDAK SESUAI", masuk: "34.950.000", keluar: "—", st: ["Tolakan · belum dicocokkan", "bad"], _unit: "HO" }
    ],
    actions: [
      { label: "Impor koran", primary: true, form: "F_IMPORT" },
      { label: "Bukukan baris", form: "F_BOOK" },
      { label: "Aturan kategorisasi", form: "F_RULES" },
      { label: "Sumber statement", form: "F_SOURCES" }
    ],
    journal: [
      { dr: "bank_admin_fee", cr: "bank_giro", note: "biaya adm & pajak jasa giro, dibukukan dari baris koran" },
      { dr: "bank_giro", cr: "bank_interest", note: "jasa giro masuk ke 8010110001" },
      { dr: null, cr: null, note: "mencocokkan baris dengan voucher TIDAK memposting apa pun — hanya menandai" }
    ],
    note: "Intake otomatis dari IMAP/folder (0106): sumber → aturan → tiga pembaca → impor. Mapping adalah data; saldo tidak pernah dikarang. EDC belum masuk."
  },

  "/finance/bank-reconciliation": {
    title: "Bank Reconciliation",
    kind: "tool",
    group: "Cash & Bank",
    store: false,
    job: "Mencocokkan baris rekening koran dengan voucher kami, per rekening per periode.",
    why: "Namanya tidak boleh dipendekkan jadi 'Reconciliation': modul ini suatu hari berutang Payment Reconciliation — pembayaran lawan tagihan — dan itu pekerjaan yang berbeda yang akan berebut satu kata.",
    erp: "Bank Reconciliation Tool",
    status: "partial",
    toolbar: ["period", "search"],
    kpis: [
      { label: "Selisih terbuka", value: "Rp 15.405.500", tone: "warn" },
      { label: "Baris belum dicocokkan", value: "7", tone: "warn" },
      { label: "Sesi terbuka", value: "3", tone: "warn" },
      { label: "Rekening cocok", value: "7 dari 10", tone: "good" }
    ],
    columns: [
      { k: "akun", label: "Rekening" },
      { k: "per", label: "Periode", w: "100px" },
      { k: "book", label: "Saldo buku", num: true },
      { k: "stmt", label: "Saldo koran", num: true },
      { k: "diff", label: "Selisih", num: true },
      { k: "open", label: "Item terbuka", num: true },
      { k: "st", label: "Status", tag: true }
    ],
    rows: [
      { akun: "BCA giro (HO)", per: "Sep 2026", book: "543.560.000", stmt: "549.845.500", diff: "6.285.500", open: "5", st: ["Sesi terbuka", "warn"], _unit: "HO" },
      { akun: "Mandiri giro (HO)", per: "Sep 2026", book: "284.300.000", stmt: "284.300.000", diff: "0", open: "0", st: ["Cocok", "good"], _unit: "HO" },
      { akun: "BRI giro (HO)", per: "Sep 2026", book: "96.480.000", stmt: "105.600.000", diff: "9.120.000", open: "1", st: ["Sesi terbuka", "warn"], _unit: "HO" },
      { akun: "BNI giro (HO)", per: "Sep 2026", book: "48.200.000", stmt: "48.200.000", diff: "0", open: "2", st: ["Tolakan saling hapus", "bad"], _unit: "HO" },
      { akun: "Danamon giro (HO)", per: "Sep 2026", book: "12.400.000", stmt: "12.400.000", diff: "0", open: "0", st: ["Cocok", "good"], _unit: "HO" },
      { akun: "BCA tabungan (HO)", per: "Sep 2026", book: "186.300.000", stmt: "186.300.000", diff: "0", open: "0", st: ["Cocok", "good"], _unit: "HO" },
      { akun: "Mandiri tabungan (HO)", per: "Sep 2026", book: "42.800.000", stmt: "42.800.000", diff: "0", open: "0", st: ["Cocok", "good"], _unit: "HO" },
      { akun: "BRI tabungan (HO)", per: "Sep 2026", book: "18.600.000", stmt: "18.600.000", diff: "0", open: "0", st: ["Cocok", "good"], _unit: "HO" },
      { akun: "BNI tabungan (HO)", per: "Sep 2026", book: "9.400.000", stmt: "9.400.000", diff: "0", open: "0", st: ["Cocok · ditutup", "plain"], _unit: "HO" },
      { akun: "BTN tabungan (HO)", per: "Sep 2026", book: "24.150.000", stmt: "24.150.000", diff: "0", open: "0", st: ["Cocok", "good"], _unit: "HO" },
      { akun: "BCA giro (HO)", per: "Agu 2026", book: "486.200.000", stmt: "486.200.000", diff: "0", open: "0", st: ["Tertutup", "good"], _unit: "HO" },
      { akun: "Mandiri giro (HO)", per: "Agu 2026", book: "312.400.000", stmt: "312.400.000", diff: "0", open: "0", st: ["Tertutup", "good"], _unit: "HO" }
    ],
    actions: [
      { label: "Buka sesi", primary: true, form: "F_RECON" },
      { label: "Cocokkan otomatis", form: null },
      { label: "Lepas pencocokan", form: null }
    ],
    journal: [
      { dr: null, cr: null, note: "mencocokkan tidak memposting — UNIQUE(journal_line_id) menjaga satu baris jurnal hanya dipakai sekali" },
      { dr: "bank_admin_fee", cr: "bank_giro", note: "kalau baris koran dibukukan langsung dari sini (book_bank_line)" }
    ],
    note: "'Apa yang berbeda' ditunda — keputusan pemilik 13 Sep. Bank Guarantee, Plaid, Bank Account Type/Subtype dan Bank Clearance dijatuhkan dari ERPNext atas keputusan pemilik."
  },

  "/finance/settlements": {
    title: "Settlements",
    kind: "document",
    group: "Receivables",
    store: false,
    job: "Uang kartu dan marketplace yang masih di jalan: kotor dikurangi MDR sama dengan neto, per acquirer per hari dagang.",
    why: "MDR adalah biaya yang kita tanggung, bukan diskon yang acquirer tawar dari utangnya — jadi sub-ledger dilunasi pada BRUTO dan MDR mendarat di akun beban sendiri.",
    erp: "— (tak ada padanan; Payment Ledger Entry terdekat)",
    status: "branchD",
    toolbar: ["unit", "period", "search", "segmented"],
    segments: ["DEBIT", "CREDIT", "MARKETPLACE"],
    kpis: [
      { label: "Di jalan (T+1 / T+2)", value: "Rp 33.300.000", tone: "plain" },
      { label: "MDR bulan ini", value: "Rp 586.080", tone: "plain" },
      { label: "Eksepsi", value: "1", tone: "bad" },
      { label: "Belum ada laporan acquirer", value: "1", tone: "warn" }
    ],
    columns: [
      { k: "no", label: "Nomor", w: "150px", mono: true },
      { k: "tgl", label: "Hari dagang", w: "100px" },
      { k: "acq", label: "Acquirer" },
      { k: "unit", label: "Unit", w: "80px" },
      { k: "gross", label: "Bruto", num: true },
      { k: "mdr", label: "MDR", num: true },
      { k: "net", label: "Neto", num: true },
      { k: "st", label: "Status", tag: true }
    ],
    rows: [
      { no: "SET-26-09-0301", tgl: "11/09/2026", acq: "BCA Debit (0,15%)", unit: "C006", gross: "9.480.000", mdr: "14.220", net: "9.465.780", st: ["MATCHED", "good"], _unit: "C006" },
      { no: "SET-26-09-0302", tgl: "11/09/2026", acq: "Mandiri Debit (1,00%)", unit: "C006", gross: "3.200.000", mdr: "32.000", net: "3.168.000", st: ["MATCHED", "good"], _unit: "C006" },
      { no: "SET-26-09-0303", tgl: "11/09/2026", acq: "Visa/Master via BCA (2,00%)", unit: "C006", gross: "6.750.000", mdr: "135.000", net: "6.615.000", st: ["MATCHED", "good"], _unit: "C006" },
      { no: "SET-26-09-0304", tgl: "11/09/2026", acq: "QRIS via BCA (0,30%)", unit: "C006", gross: "2.430.000", mdr: "7.290", net: "2.422.710", st: ["CURATED", "info"], _unit: "C006" },
      { no: "SET-26-09-0305", tgl: "11/09/2026", acq: "BCA Debit (0,15%)", unit: "C001", gross: "12.640.000", mdr: "18.960", net: "12.621.040", st: ["MATCHED", "good"], _unit: "C001" },
      { no: "SET-26-09-0306", tgl: "11/09/2026", acq: "BRI Debit (1,00%)", unit: "C005", gross: "4.180.000", mdr: "41.800", net: "4.138.200", st: ["MATCHED", "good"], _unit: "C005" },
      { no: "SET-26-09-0307", tgl: "11/09/2026", acq: "Visa/Master via BCA (2,00%)", unit: "C001", gross: "8.900.000", mdr: "178.000", net: "8.722.000", st: ["MATCHED", "good"], _unit: "C001" },
      { no: "SET-26-09-0308", tgl: "12/09/2026", acq: "BCA Debit (0,15%)", unit: "C011", gross: "7.320.000", mdr: "10.980", net: "7.309.020", st: ["CURATED", "info"], _unit: "C011" },
      { no: "SET-26-09-0309", tgl: "12/09/2026", acq: "QRIS via BCA (0,30%)", unit: "C013", gross: "1.870.000", mdr: "5.610", net: "1.864.390", st: ["CURATED", "info"], _unit: "C013" },
      { no: "SET-26-09-0310", tgl: "12/09/2026", acq: "Mandiri Debit (1,00%)", unit: "C008", gross: "2.960.000", mdr: "29.600", net: "2.930.400", st: ["CURATED", "info"], _unit: "C008" },
      { no: "SET-26-09-0311", tgl: "10/09/2026", acq: "BCA Debit (0,15%)", unit: "C002", gross: "5.640.000", mdr: "8.460", net: "5.631.540", st: ["EXCEPTION · lebih 340.000 dari penjualan", "bad"], _unit: "C002" },
      { no: "SET-26-09-0312", tgl: "10/09/2026", acq: "Visa/Master via BCA (2,00%)", unit: "C009", gross: "3.450.000", mdr: "69.000", net: "3.381.000", st: ["MATCHED", "good"], _unit: "C009" },
      { no: "SET-26-09-0313", tgl: "12/09/2026", acq: "BNI Debit (1,00%)", unit: "C004", gross: "1.980.000", mdr: "19.800", net: "1.960.200", st: ["CURATED", "info"], _unit: "C004" },
      { no: "SET-26-09-0314", tgl: "12/09/2026", acq: "BCA Debit (0,15%)", unit: "C006", gross: "10.240.000", mdr: "15.360", net: "10.224.640", st: ["DRAFT · laporan acquirer belum masuk", "warn"], _unit: "C006" }
    ],
    actions: [
      { label: "Impor laporan acquirer", primary: true, form: "F_ACQ" },
      { label: "Kurasi", form: null },
      { label: "Ajukan Inquiry", form: "F_INQUIRY" }
    ],
    journal: [
      { dr: "bank_giro", cr: null, note: "neto yang benar-benar mendarat, qualifier = bank penerima, site = dc" },
      { dr: "card_fee", cr: null, note: "MDR, site = toko, qualifier = acquirer — 6010110002, termasuk untuk QRIS" },
      { dr: null, cr: "card_receivable_debit", note: "BRUTO, per (site, jenis tender) — 1011101002" },
      { dr: null, cr: "card_receivable_credit", note: "BRUTO untuk kartu kredit — 1011101001" },
      { dr: null, cr: "qris_receivable", note: "BRUTO QRIS — meminjam akun debit sampai pemilik memutuskan" },
      { dr: "affiliate_receivable", cr: "affiliate_payable", note: "kaki afiliasi: piutang ada di toko, uangnya mendarat di rekening HO" }
    ],
    note: "CHECK net = gross − mdr ditegakkan di tabel; bank_statement_line_id UNIQUE supaya satu baris koran tidak menutup dua settlement. Inquiry adalah objek kelas satu: diajukan → dikejar → dijawab."
  },

  "/finance/unmatched-charges": {
    title: "Charges without a sale",
    kind: "tool",
    group: "Receivables",
    store: false,
    job: "Kartu yang tertagih tanpa penjualan di baliknya — pembeli yang sedang menunggu uangnya kembali.",
    why: "Baris di sini tidak terlihat oleh cabang, karena laporan hari cabang itu sendiri balance. Karena itu layar ini selalu amber walau kosong: yang menunggu adalah orang, bukan angka.",
    erp: "—",
    status: "live",
    toolbar: ["unit", "period", "search"],
    kpis: [
      { label: "Belum dijawab", value: "3", tone: "bad" },
      { label: "Sedang dikejar", value: "4", tone: "warn" },
      { label: "Nilai tertahan", value: "Rp 6.965.000", tone: "warn" },
      { label: "Terlama", value: "19 hari", tone: "bad" }
    ],
    columns: [
      { k: "tgl", label: "Tanggal tagih", w: "110px" },
      { k: "unit", label: "Unit", w: "80px" },
      { k: "acq", label: "Acquirer" },
      { k: "ref", label: "Referensi", w: "150px", mono: true },
      { k: "amt", label: "Nilai", num: true },
      { k: "age", label: "Umur", w: "80px" },
      { k: "st", label: "Status", tag: true }
    ],
    rows: [
      { tgl: "12/09/2026", unit: "C003", acq: "BCA Debit", ref: "APPRV 883017", amt: "295.000", age: "1 hari", st: ["Baru", "warn"], _unit: "C003" },
      { tgl: "09/09/2026", unit: "C002", acq: "BCA Debit", ref: "APPRV 483012", amt: "340.000", age: "4 hari", st: ["Belum dijawab", "bad"], _unit: "C002" },
      { tgl: "08/09/2026", unit: "C006", acq: "Visa/Master via BCA", ref: "APPRV 771204", amt: "1.250.000", age: "5 hari", st: ["Diajukan ke acquirer", "warn"], _unit: "C006" },
      { tgl: "07/09/2026", unit: "C001", acq: "BCA Debit", ref: "APPRV 118940", amt: "675.000", age: "6 hari", st: ["Diajukan ke acquirer", "warn"], _unit: "C001" },
      { tgl: "05/09/2026", unit: "C011", acq: "Mandiri Debit", ref: "APPRV 226733", amt: "420.000", age: "8 hari", st: ["Dijawab · refund diproses", "good"], _unit: "C011" },
      { tgl: "04/09/2026", unit: "C005", acq: "QRIS via BCA", ref: "TRX 90224118", amt: "185.000", age: "9 hari", st: ["Dijawab · refund diproses", "good"], _unit: "C005" },
      { tgl: "03/09/2026", unit: "C013", acq: "BCA Debit", ref: "APPRV 554021", amt: "890.000", age: "10 hari", st: ["Belum dijawab", "bad"], _unit: "C013" },
      { tgl: "02/09/2026", unit: "C008", acq: "BRI Debit", ref: "APPRV 330117", amt: "1.100.000", age: "11 hari", st: ["Diajukan ke acquirer", "warn"], _unit: "C008" },
      { tgl: "31/08/2026", unit: "C006", acq: "BCA Debit", ref: "APPRV 908214", amt: "245.000", age: "13 hari", st: ["Ditutup · penjualan ditemukan", "plain"], _unit: "C006" },
      { tgl: "29/08/2026", unit: "C009", acq: "Visa/Master via BCA", ref: "APPRV 610337", amt: "2.150.000", age: "15 hari", st: ["Belum dijawab", "bad"], _unit: "C009" },
      { tgl: "27/08/2026", unit: "C004", acq: "BCA Debit", ref: "APPRV 447108", amt: "380.000", age: "17 hari", st: ["Ditutup · retender", "plain"], _unit: "C004" },
      { tgl: "25/08/2026", unit: "C012", acq: "Mandiri Debit", ref: "APPRV 205914", amt: "560.000", age: "19 hari", st: ["Diajukan ke acquirer", "warn"], _unit: "C012" }
    ],
    actions: [
      { label: "Ajukan ke acquirer", primary: true, form: "F_INQUIRY" },
      { label: "Tautkan ke penjualan", form: null },
      { label: "Tutup dengan alasan", form: "F_CLOSE" }
    ],
    note: "Alat, bukan dokumen: ia mengubah dokumen lain (settlement, retur) dan tidak memposting apa pun sendiri. Refund yang lahir dari sini memposting dari dokumen returnya."
  },

  "/finance/bills": {
    title: "Supplier bills",
    kind: "document",
    group: "Payables",
    store: false,
    job: "Mengakui tagihan pemasok barang dan non-barang, mencocokkannya dengan penerimaan, lalu memposting.",
    why: "Ageing lima ember sudah dihitung server dan sudah jadi kolom di sini — jadi tidak ada baris menu 'Aged Payables'. 'Status bukan menu': antrean adalah kolom, bukan tempat.",
    erp: "Purchase Invoice",
    status: "live",
    toolbar: ["unit", "period", "search", "segmented"],
    segments: ["Merchandise", "Expenses", "Unbilled deliveries"],
    kpis: [
      { label: "Jatuh tempo 7 hari", value: "Rp 153.930.000", tone: "warn" },
      { label: "Lewat jatuh tempo", value: "Rp 126.030.000", tone: "bad" },
      { label: "Total utang terbuka", value: "Rp 521.595.000", tone: "plain" },
      { label: "Terkirim belum ditagih", value: "Rp 90.750.000", tone: "warn" }
    ],
    columns: [
      { k: "no", label: "Nomor", w: "150px", mono: true },
      { k: "tgl", label: "Tanggal", w: "95px" },
      { k: "sup", label: "Pemasok" },
      { k: "unit", label: "Unit", w: "80px" },
      { k: "due", label: "Jatuh tempo", w: "105px" },
      { k: "amt", label: "Nilai", num: true },
      { k: "out", label: "Sisa", num: true },
      { k: "st", label: "Status", tag: true }
    ],
    rows: [
      { no: "BILL-26-09-0041", tgl: "02/09/2026", sup: "PT Anugrah Busana", unit: "HO", due: "02/10/2026", amt: "184.500.000", out: "184.500.000", st: ["POSTED", "good"], _unit: "HO" },
      { no: "BILL-26-09-0042", tgl: "03/09/2026", sup: "CV Mitra Tekstil", unit: "HO", due: "03/10/2026", amt: "96.200.000", out: "46.200.000", st: ["Sebagian dibayar", "info"], _unit: "HO" },
      { no: "BILL-26-09-0043", tgl: "04/09/2026", sup: "PT Sinar Rejeki Garment", unit: "HO", due: "19/09/2026", amt: "142.870.000", out: "142.870.000", st: ["POSTED", "good"], _unit: "HO" },
      { no: "BILL-26-08-0037", tgl: "12/08/2026", sup: "PT Karya Mode Indonesia", unit: "HO", due: "11/09/2026", amt: "78.400.000", out: "78.400.000", st: ["Telat 2 hari", "warn"], _unit: "HO" },
      { no: "BILL-26-07-0021", tgl: "28/07/2026", sup: "CV Berkah Sandang", unit: "HO", due: "27/08/2026", amt: "34.950.000", out: "34.950.000", st: ["Telat 17 hari", "bad"], _unit: "HO" },
      { no: "BILL-26-06-0014", tgl: "15/06/2026", sup: "CV Berkah Sandang", unit: "HO", due: "15/07/2026", amt: "12.680.000", out: "12.680.000", st: ["Telat 60 hari", "bad"], _unit: "HO" },
      { no: "BILL-26-09-0044", tgl: "08/09/2026", sup: "PLN (Persero)", unit: "C006", due: "20/09/2026", amt: "4.318.000", out: "4.318.000", st: ["POSTED", "good"], _unit: "C006" },
      { no: "BILL-26-09-0045", tgl: "08/09/2026", sup: "PLN (Persero)", unit: "C001", due: "20/09/2026", amt: "6.742.000", out: "6.742.000", st: ["POSTED", "good"], _unit: "C001" },
      { no: "BILL-26-09-0046", tgl: "09/09/2026", sup: "PDAM Tirta", unit: "C006", due: "22/09/2026", amt: "385.000", out: "385.000", st: ["POSTED", "good"], _unit: "C006" },
      { no: "BILL-26-09-0047", tgl: "09/09/2026", sup: "Telkom Indonesia", unit: "HO", due: "25/09/2026", amt: "2.150.000", out: "2.150.000", st: ["POSTED", "good"], _unit: "HO" },
      { no: "BILL-26-09-0048", tgl: "01/09/2026", sup: "Bpk. Hasan (pemilik ruko C006)", unit: "C006", due: "01/09/2026", amt: "180.000.000", out: "0", st: ["POSTED · sewa 12 bulan ke prepaid", "good"], _unit: "C006" },
      { no: "BILL-26-09-0049", tgl: "10/09/2026", sup: "PT Cipta Bersih (cleaning)", unit: "HO", due: "24/09/2026", amt: "8.400.000", out: "8.400.000", st: ["POSTED · PPh 23 2%", "good"], _unit: "HO" },
      { no: "BILL-26-09-0050", tgl: "11/09/2026", sup: "CV Jaya Ekspedisi", unit: "HO", due: "25/09/2026", amt: "11.240.000", out: "—", st: ["DRAFT", "plain"], _unit: "HO" },
      { no: "BILL-26-09-0051", tgl: "12/09/2026", sup: "Percetakan Mandiri", unit: "HO", due: "26/09/2026", amt: "3.680.000", out: "—", st: ["DRAFT", "plain"], _unit: "HO" },
      { no: "GR-26-09-0219", tgl: "11/09/2026", sup: "PT Anugrah Busana", unit: "HO", due: "—", amt: "62.300.000", out: "—", st: ["Terkirim, belum ditagih", "warn"], _unit: "HO" },
      { no: "GR-26-09-0221", tgl: "12/09/2026", sup: "PT Sinar Rejeki Garment", unit: "HO", due: "—", amt: "28.450.000", out: "—", st: ["Terkirim, belum ditagih", "warn"], _unit: "HO" }
    ],
    actions: [
      { label: "Catat tagihan", primary: true, form: "F_BILL" },
      { label: "Cocokkan penerimaan", form: null },
      { label: "Post", form: null },
      { label: "Bayar", form: "F_PAYMENT" }
    ],
    journal: [
      { dr: "inventory", cr: "trade_payable", note: "barang dagangan: 1011201 lawan 2012001001, per alokasi, di site tagihan" },
      { dr: "expense_by_category", cr: "non_merchandise_payable", note: "non-barang: akun beban root 6/7 lawan 2012001003" },
      { dr: "prepaid_expense", cr: "non_merchandise_payable", note: "sewa dibayar di muka masuk 1011301, dilepas bulanan di Prepaids & accruals" },
      { dr: "fixed_asset", cr: "trade_payable", note: "baris tagihan yang menyebut aset ADALAH perolehannya (0099) — tidak ada dokumen kedua" }
    ],
    note: "Tidak ada GRNI dan tidak akan diadakan — klien tidak punya akunnya. Karena itu 'Unbilled deliveries' adalah daftar penerimaan, bukan saldo di buku besar. Ambang pembulatan pencocokan (§11.6) masih keputusan terbuka."
  },

  "/finance/giro": {
    title: "Giro register",
    kind: "document",
    group: "Payables",
    store: false,
    job: "Register instrumen bayar-nanti: diterbitkan, diserahkan, jatuh tempo, lalu cair atau ditolak.",
    why: "'Outstanding' adalah status dan tidak ada baris menu bernama begitu — tetapi giro sendiri adalah instrumen: lima keadaan, akun kliring per bank PENERBIT, dan tanggal valuta yang membedakannya dari cek. Itu objek, jadi ia sebuah register.",
    erp: "— (ERPNext tidak punya fitur PDC; bentuk dokumen diambil darinya)",
    status: "branchD",
    toolbar: ["period", "search", "segmented"],
    segments: ["Belum cair", "Cair", "Ditolak"],
    kpis: [
      { label: "Outstanding", value: "Rp 566.000.000", tone: "warn" },
      { label: "Jatuh tempo hari ini", value: "Rp 180.000.000", tone: "bad" },
      { label: "Jatuh tempo 30 hari", value: "Rp 322.870.000", tone: "warn" },
      { label: "Ditolak bulan ini", value: "1", tone: "bad" }
    ],
    columns: [
      { k: "no", label: "Nomor giro", w: "145px", mono: true },
      { k: "bank", label: "Bank penerbit", w: "110px" },
      { k: "sup", label: "Penerima" },
      { k: "issue", label: "Terbit", w: "95px" },
      { k: "due", label: "Jatuh tempo", w: "105px" },
      { k: "amt", label: "Nilai", num: true },
      { k: "st", label: "Status", tag: true }
    ],
    rows: [
      { no: "BG-BCA-0031", bank: "BCA", sup: "Bpk. Hasan (pemilik ruko C006)", issue: "01/09/2026", due: "13/09/2026", amt: "180.000.000", st: ["DUE", "bad"], _unit: "HO" },
      { no: "BG-BCA-0032", bank: "BCA", sup: "PT Anugrah Busana", issue: "02/09/2026", due: "02/10/2026", amt: "142.870.000", st: ["DELIVERED", "info"], _unit: "HO" },
      { no: "BG-MDR-0018", bank: "Mandiri", sup: "CV Mitra Tekstil", issue: "03/09/2026", due: "03/10/2026", amt: "46.200.000", st: ["DELIVERED", "info"], _unit: "HO" },
      { no: "BG-BCA-0033", bank: "BCA", sup: "PT Sinar Rejeki Garment", issue: "05/09/2026", due: "05/10/2026", amt: "96.400.000", st: ["DELIVERED", "info"], _unit: "HO" },
      { no: "BG-BRI-0009", bank: "BRI", sup: "PT Karya Mode Indonesia", issue: "08/09/2026", due: "08/10/2026", amt: "78.400.000", st: ["ISSUED", "plain"], _unit: "HO" },
      { no: "BG-BNI-0014", bank: "BNI", sup: "CV Berkah Sandang", issue: "10/09/2026", due: "10/10/2026", amt: "22.130.000", st: ["ISSUED", "plain"], _unit: "HO" },
      { no: "BG-DNM-0005", bank: "Danamon", sup: "CV Jaya Ekspedisi", issue: "11/09/2026", due: "11/10/2026", amt: "11.240.000", st: ["ISSUED", "plain"], _unit: "HO" },
      { no: "BG-BCA-0028", bank: "BCA", sup: "PT Anugrah Busana", issue: "05/08/2026", due: "05/09/2026", amt: "126.400.000", st: ["CLEARED", "good"], _unit: "HO" },
      { no: "BG-MDR-0016", bank: "Mandiri", sup: "CV Mitra Tekstil", issue: "06/08/2026", due: "06/09/2026", amt: "58.900.000", st: ["CLEARED", "good"], _unit: "HO" },
      { no: "BG-BCA-0029", bank: "BCA", sup: "PT Cipta Bersih (cleaning)", issue: "08/08/2026", due: "08/09/2026", amt: "8.232.000", st: ["CLEARED", "good"], _unit: "HO" },
      { no: "BG-BRI-0008", bank: "BRI", sup: "Percetakan Mandiri", issue: "10/08/2026", due: "10/09/2026", amt: "4.860.000", st: ["CLEARED", "good"], _unit: "HO" },
      { no: "BG-BNI-0013", bank: "BNI", sup: "CV Berkah Sandang", issue: "01/08/2026", due: "01/09/2026", amt: "12.820.000", st: ["REJECTED · dana tidak cukup", "bad"], _unit: "HO" },
      { no: "BG-BCA-0030", bank: "BCA", sup: "PT Karya Mode Indonesia", issue: "12/08/2026", due: "12/09/2026", amt: "34.600.000", st: ["CLEARED", "good"], _unit: "HO" },
      { no: "BG-MDR-0019", bank: "Mandiri", sup: "PT Sinar Rejeki Garment", issue: "12/09/2026", due: "12/11/2026", amt: "89.160.000", st: ["ISSUED", "plain"], _unit: "HO" }
    ],
    actions: [
      { label: "Terbitkan giro", primary: true, form: "F_GIRO" },
      { label: "Tandai diserahkan", form: null },
      { label: "Cairkan", form: null },
      { label: "Tolak dengan alasan", form: "F_REJECT" },
      { label: "Cetak", form: null }
    ],
    journal: [
      { dr: "trade_payable", cr: "giro_outstanding", note: "terbit: menumpang jurnal pembayarannya sendiri, kreditnya ditukar ke akun kliring bank penerbit (2012002 x5)" },
      { dr: "giro_outstanding", cr: "bank_giro", note: "cair: GIRO/giro/1, qualifier bank sama di kedua kaki" },
      { dr: "giro_outstanding", cr: "trade_payable", note: "ditolak: pembalikan jurnal terbit — pembayaran jadi REVERSED dan tagihannya terbuka lagi" },
      { dr: null, cr: "giro_payable_offladder", note: "204001 Giro Keluar, akun off-ladder yang ikut tinggal di sini" }
    ],
    note: "UNIQUE(bank, direction, number): nomor giro hanya unik di dalam satu bank. CHEQUE sudah dihapus (0220). Apakah 204001 diberi kode tangga atau diterima off-ladder masih keputusan terbuka."
  },

  "/finance/advances": {
    title: "Advances & claims",
    kind: "document",
    group: "Payables",
    store: false,
    job: "Uang muka pemasok dan pegawai, pertanggungjawabannya, dan nota kredit pemasok.",
    why: "Uang muka dan nota kredit ditampilkan terpisah dan tidak pernah di-net diam-diam. Dari ERPNext diambil dua angka yang sama-sama disimpan: yang diminta dan yang disetujui.",
    erp: "Employee Advance + Expense Claim",
    status: "new",
    toolbar: ["unit", "period", "search", "segmented"],
    segments: ["Uang muka pemasok", "Uang muka pegawai", "Nota kredit pemasok"],
    kpis: [
      { label: "Uang muka terbuka", value: "Rp 96.400.000", tone: "plain" },
      { label: "Belum dipertanggungjawabkan > 30 hari", value: "3", tone: "warn" },
      { label: "Nota kredit belum dipakai", value: "Rp 14.230.000", tone: "plain" },
      { label: "Diminta vs disetujui (selisih)", value: "Rp 3.150.000", tone: "warn" }
    ],
    columns: [
      { k: "no", label: "Nomor", w: "145px", mono: true },
      { k: "tgl", label: "Tanggal", w: "95px" },
      { k: "party", label: "Pihak" },
      { k: "unit", label: "Unit", w: "80px" },
      { k: "amt", label: "Diminta", num: true },
      { k: "sanc", label: "Disetujui", num: true },
      { k: "out", label: "Belum dipertanggungjawabkan", num: true },
      { k: "st", label: "Status", tag: true }
    ],
    rows: [
      { no: "AV-26-09-0031", tgl: "02/09/2026", party: "PT Anugrah Busana", unit: "HO", amt: "40.000.000", sanc: "40.000.000", out: "40.000.000", st: ["Dibayar · PO-26-08-0114", "good"], _unit: "HO" },
      { no: "AV-26-09-0032", tgl: "05/09/2026", party: "PT Sinar Rejeki Garment", unit: "HO", amt: "30.000.000", sanc: "30.000.000", out: "18.600.000", st: ["Sebagian diterapkan", "info"], _unit: "HO" },
      { no: "AV-26-08-0028", tgl: "12/08/2026", party: "CV Mitra Tekstil", unit: "HO", amt: "25.000.000", sanc: "25.000.000", out: "25.000.000", st: ["Terbuka 32 hari", "warn"], _unit: "HO" },
      { no: "AV-26-08-0012", tgl: "05/07/2026", party: "PT Karya Mode Indonesia", unit: "HO", amt: "18.000.000", sanc: "18.000.000", out: "12.800.000", st: ["Terbuka 70 hari", "bad"], _unit: "HO" },
      { no: "EA-26-09-0044", tgl: "08/09/2026", party: "Dewi Lestari (Adm HO)", unit: "HO", amt: "6.000.000", sanc: "5.000.000", out: "5.000.000", st: ["Dipotong 1.000.000", "warn"], _unit: "HO" },
      { no: "EA-26-09-0045", tgl: "09/09/2026", party: "Bambang Sutrisno (Ka. Toko C006)", unit: "C006", amt: "4.500.000", sanc: "4.500.000", out: "0", st: ["Dipertanggungjawabkan penuh", "good"], _unit: "C006" },
      { no: "EA-26-09-0046", tgl: "11/09/2026", party: "Sri Wahyuni (Adm C006)", unit: "C006", amt: "2.400.000", sanc: "2.400.000", out: "2.400.000", st: ["Terbuka 2 hari", "plain"], _unit: "C006" },
      { no: "EA-26-08-0039", tgl: "02/08/2026", party: "Ka. Toko C011", unit: "C011", amt: "5.000.000", sanc: "3.850.000", out: "3.850.000", st: ["Terbuka 42 hari", "bad"], _unit: "C011" },
      { no: "EA-26-09-0047", tgl: "12/09/2026", party: "Ka. Toko C013", unit: "C013", amt: "3.200.000", sanc: "2.200.000", out: "2.200.000", st: ["Dipotong 1.000.000", "warn"], _unit: "C013" },
      { no: "CN-26-09-0008", tgl: "06/09/2026", party: "PT Karya Mode Indonesia", unit: "HO", amt: "6.150.000", sanc: "6.150.000", out: "0", st: ["Diterima tunai", "good"], _unit: "HO" },
      { no: "CN-26-09-0009", tgl: "10/09/2026", party: "CV Berkah Sandang", unit: "HO", amt: "8.430.000", sanc: "8.430.000", out: "8.430.000", st: ["Belum dipakai", "info"], _unit: "HO" },
      { no: "CN-26-08-0006", tgl: "20/08/2026", party: "CV Mitra Tekstil", unit: "HO", amt: "5.800.000", sanc: "5.800.000", out: "5.800.000", st: ["Belum dipakai", "info"], _unit: "HO" },
      { no: "EA-26-09-0048", tgl: "13/09/2026", party: "Ka. Toko C004", unit: "C004", amt: "3.850.000", sanc: "—", out: "—", st: ["REQUESTED", "plain"], _unit: "C004" }
    ],
    actions: [
      { label: "Ajukan uang muka", primary: true, form: "F_ADVANCE" },
      { label: "Pertanggungjawabkan", form: "F_CLAIM" },
      { label: "Terapkan ke tagihan", form: null },
      { label: "Kembalikan sisa", form: null }
    ],
    journal: [
      { dr: "advance", cr: "bank_giro", note: "uang muka pemasok AV-: 1011303 lawan bank, PO wajib disebut" },
      { dr: "trade_payable", cr: "advance", note: "diterapkan ke tagihan pada TANGGALNYA SENDIRI, bukan tanggal uang muka" },
      { dr: "expense_by_category", cr: "advance", note: "pertanggungjawaban pegawai: beban sesuai kategori melawan uang muka" },
      { dr: "employee_receivable", cr: "advance", note: "sisa yang tidak dikembalikan jadi piutang pegawai, bukan beban" },
      { dr: "non_merchandise_payable", cr: "supplier_credit", note: "nota kredit ditampilkan terpisah; tidak pernah di-net dengan uang muka" }
    ],
    note: "amount vs sanctioned_amount adalah dua angka yang keduanya disimpan — supaya 'diminta 6 juta, disetujui 5 juta' tetap terbaca setahun kemudian."
  },

  "/finance/payments": {
    title: "Payments",
    kind: "document",
    group: "Payments",
    store: false,
    job: "Satu dokumen uang keluar, uang masuk, dan pindah antar rekening — dengan baris alokasi dan baris potongan.",
    why: "Payments adalah tempat, bukan tombol di detail tagihan: satu dokumen melunasi beberapa tagihan plus satu biaya langsung, dan pelebaran ke Pay/Receive/Internal Transfer mustahil kalau ia bukan sebuah tempat. Queue adalah kolom status, run adalah aksi batch.",
    erp: "Payment Entry",
    status: "live",
    toolbar: ["unit", "period", "search", "segmented"],
    segments: ["Pay", "Receive", "Internal transfer"],
    kpis: [
      { label: "Menunggu persetujuan", value: "2", tone: "warn" },
      { label: "Terinstruksi belum settle", value: "3", tone: "plain" },
      { label: "Gagal", value: "1", tone: "bad" },
      { label: "Keluar 13 Sep", value: "Rp 345.842.000", tone: "plain" }
    ],
    columns: [
      { k: "no", label: "Nomor", w: "145px", mono: true },
      { k: "tgl", label: "Tanggal", w: "95px" },
      { k: "jenis", label: "Jenis", tag: true },
      { k: "party", label: "Pihak" },
      { k: "acct", label: "Rekening" },
      { k: "amt", label: "Nilai", num: true },
      { k: "st", label: "Status", tag: true }
    ],
    rows: [
      { no: "PV-26-09-0118", tgl: "12/09/2026", jenis: ["Pay", "plain"], party: "PT Anugrah Busana", acct: "BCA giro", amt: "95.005.000", st: ["SETTLED", "good"], _unit: "HO" },
      { no: "PV-26-09-0119", tgl: "12/09/2026", jenis: ["Pay", "plain"], party: "CV Mitra Tekstil", acct: "Mandiri giro", amt: "50.000.000", st: ["SETTLED", "good"], _unit: "HO" },
      { no: "PV-26-09-0120", tgl: "13/09/2026", jenis: ["Pay", "plain"], party: "PT Sinar Rejeki Garment", acct: "BCA giro", amt: "142.870.000", st: ["INSTRUCTED", "info"], _unit: "HO" },
      { no: "PV-26-09-0121", tgl: "13/09/2026", jenis: ["Pay", "plain"], party: "PT Cipta Bersih (cleaning)", acct: "BCA giro", amt: "8.232.000", st: ["APPROVED", "info"], _unit: "HO" },
      { no: "PV-26-09-0122", tgl: "13/09/2026", jenis: ["Pay", "plain"], party: "PLN (Persero)", acct: "Mandiri giro", amt: "11.060.000", st: ["REQUESTED", "warn"], _unit: "HO" },
      { no: "PV-26-09-0123", tgl: "11/09/2026", jenis: ["Pay", "plain"], party: "CV Berkah Sandang", acct: "BNI giro", amt: "34.950.000", st: ["FAILED · rekening tidak sesuai", "bad"], _unit: "HO" },
      { no: "PV-26-09-0124", tgl: "13/09/2026", jenis: ["Pay", "plain"], party: "Bpk. Hasan (pemilik ruko C006)", acct: "BCA giro → BG-BCA-0031", amt: "180.000.000", st: ["INSTRUCTED · giro", "info"], _unit: "C006" },
      { no: "PV-26-09-0125", tgl: "09/09/2026", jenis: ["Pay", "plain"], party: "Telkom Indonesia", acct: "BCA giro", amt: "2.150.000", st: ["RECONCILED", "good"], _unit: "HO" },
      { no: "PV-26-09-0126", tgl: "13/09/2026", jenis: ["Pay", "plain"], party: "Percetakan Mandiri", acct: "BCA giro", amt: "3.680.000", st: ["REQUESTED", "warn"], _unit: "HO" },
      { no: "KM-26-09-0067", tgl: "12/09/2026", jenis: ["Receive", "info"], party: "BCA (acquirer debit)", acct: "BCA giro", amt: "9.465.780", st: ["RECONCILED", "good"], _unit: "C006" },
      { no: "KM-26-09-0068", tgl: "12/09/2026", jenis: ["Receive", "info"], party: "Mandiri (acquirer debit)", acct: "Mandiri giro", amt: "3.168.000", st: ["SETTLED", "good"], _unit: "C006" },
      { no: "KM-26-09-0069", tgl: "10/09/2026", jenis: ["Receive", "info"], party: "PT Karya Mode Indonesia (nota kredit)", acct: "BCA giro", amt: "6.150.000", st: ["SETTLED", "good"], _unit: "HO" },
      { no: "KM-26-09-0070", tgl: "13/09/2026", jenis: ["Receive", "info"], party: "BCA (acquirer QRIS)", acct: "BCA giro", amt: "2.422.710", st: ["INSTRUCTED", "info"], _unit: "C006" },
      { no: "TF-26-09-0033", tgl: "12/09/2026", jenis: ["Internal transfer", "plain"], party: "—", acct: "BCA giro → Mandiri giro", amt: "200.000.000", st: ["RECONCILED", "good"], _unit: "HO" },
      { no: "TF-26-09-0034", tgl: "12/09/2026", jenis: ["Internal transfer", "plain"], party: "—", acct: "Kas C006 → BCA giro", amt: "14.280.000", st: ["SETTLED", "good"], _unit: "C006" },
      { no: "TF-26-09-0035", tgl: "13/09/2026", jenis: ["Internal transfer", "plain"], party: "—", acct: "BCA giro → Petty cash C003", amt: "2.000.000", st: ["APPROVED", "info"], _unit: "C003" }
    ],
    actions: [
      { label: "Buat pembayaran", primary: true, form: "F_PAYMENT" },
      { label: "Setujui", form: null },
      { label: "Instruksikan", form: null },
      { label: "Tandai settled", form: null },
      { label: "Buat batch", form: "F_BATCH" }
    ],
    journal: [
      { dr: "trade_payable", cr: null, note: "satu Dr per baris alokasi, di site tagihan — 2012001001 untuk barang" },
      { dr: "non_merchandise_payable", cr: null, note: "alokasi ke tagihan non-barang — 2012001003" },
      { dr: "expense_by_category", cr: null, note: "target DIRECT_EXPENSE: biaya langsung tanpa tagihan, tidak mengarang payable" },
      { dr: "bank_admin_fee", cr: null, note: "deductions[]: biaya bank, pembulatan" },
      { dr: null, cr: "pph23_payable", note: "deductions[]: PPh 23 yang dipotong dari pemasok jasa" },
      { dr: null, cr: "bank_giro", note: "satu Cr, qualifier = bank; totalnya = alokasi + biaya − potongan" }
    ],
    note: "PV-26-09-0118 = tiga tagihan (40.000.000 + 30.000.000 + 25.000.000) + biaya bank 5.000. Hanya SETTLED yang memposting, sekali; RECONCILED dibaca dari pencocokan koran, bukan diketik."
  },

  "/finance/journal": {
    title: "Journal entries",
    kind: "document",
    group: "Payments",
    store: false,
    job: "Kejadian yang memang butuh akuntansi langsung, dengan pembalikan sebagai satu-satunya bentuk koreksi.",
    why: "Dua kolom nyata dengan footer selisih, bukan satu kolom bertanda. `journal_line` sendiri tidak punya baris menu di mana pun — persis seperti GL Entry di ERPNext: yang punya menu adalah dokumen yang menyebabkannya.",
    erp: "Journal Entry",
    status: "live",
    toolbar: ["unit", "period", "search", "segmented"],
    segments: ["Semua", "Draf", "Pembalikan"],
    kpis: [
      { label: "Draf", value: "3", tone: "warn" },
      { label: "Terposting bulan ini", value: "38", tone: "plain" },
      { label: "Pembalikan bulan ini", value: "2", tone: "plain" },
      { label: "Tidak seimbang", value: "0", tone: "good" }
    ],
    columns: [
      { k: "no", label: "Nomor", w: "145px", mono: true },
      { k: "tgl", label: "Tanggal", w: "95px" },
      { k: "unit", label: "Unit", w: "80px" },
      { k: "desc", label: "Keterangan" },
      { k: "dr", label: "Debit", num: true },
      { k: "cr", label: "Kredit", num: true },
      { k: "st", label: "Status", tag: true }
    ],
    rows: [
      { no: "JE-26-09-0214", tgl: "13/09/2026", unit: "HO", desc: "Penyisihan kerugian piutang Q3", dr: "18.500.000", cr: "18.500.000", st: ["DRAFT", "plain"], _unit: "HO" },
      { no: "JE-26-09-0213", tgl: "13/09/2026", unit: "C001", desc: "Selisih laci 12 Sep", dr: "50.000", cr: "50.000", st: ["Tertahan · cash_variance", "bad"], _unit: "C001" },
      { no: "JE-26-09-0212", tgl: "13/09/2026", unit: "HO", desc: "Management fee September ke 13 toko", dr: "65.000.000", cr: "65.000.000", st: ["DRAFT", "plain"], _unit: "HO" },
      { no: "JE-26-09-0211", tgl: "13/09/2026", unit: "HO", desc: "Koreksi salah unit BDP C008 ke C005", dr: "4.180.000", cr: "4.180.000", st: ["DRAFT", "plain"], _unit: "HO" },
      { no: "JE-26-09-0210", tgl: "12/09/2026", unit: "HO", desc: "Akrual listrik September 13 unit", dr: "48.620.000", cr: "48.620.000", st: ["POSTED", "good"], _unit: "HO" },
      { no: "JE-26-09-0209", tgl: "12/09/2026", unit: "C006", desc: "Pelepasan sewa dibayar dimuka September", dr: "15.000.000", cr: "15.000.000", st: ["POSTED", "good"], _unit: "C006" },
      { no: "JE-26-09-0208", tgl: "12/09/2026", unit: "HO", desc: "Reklas biaya bank Agustus", dr: "1.240.000", cr: "1.240.000", st: ["POSTED", "good"], _unit: "HO" },
      { no: "JE-26-09-0207", tgl: "11/09/2026", unit: "HO", desc: "Reklas porsi lancar pinjaman BCA", dr: "120.000.000", cr: "120.000.000", st: ["POSTED", "good"], _unit: "HO" },
      { no: "JE-26-09-0206", tgl: "10/09/2026", unit: "C013", desc: "Amortisasi pre-opening bulan ke-9", dr: "3.750.000", cr: "3.750.000", st: ["POSTED", "good"], _unit: "C013" },
      { no: "JE-26-09-0205", tgl: "09/09/2026", unit: "HO", desc: "Pembalikan JE-26-09-0201", dr: "2.860.000", cr: "2.860.000", st: ["Pembalikan", "info"], _unit: "HO" },
      { no: "JE-26-09-0204", tgl: "09/09/2026", unit: "C011", desc: "Retender kartu ke tunai 08 Sep", dr: "1.240.000", cr: "1.240.000", st: ["POSTED", "good"], _unit: "C011" },
      { no: "JE-26-09-0201", tgl: "08/09/2026", unit: "HO", desc: "Bunga bank BCA Agustus (salah akun)", dr: "2.860.000", cr: "2.860.000", st: ["REVERSED", "bad"], _unit: "HO" },
      { no: "JE-26-08-0193", tgl: "31/08/2026", unit: "HO", desc: "Akrual gaji Agustus 14 unit", dr: "612.480.000", cr: "612.480.000", st: ["POSTED", "good"], _unit: "HO" },
      { no: "JE-26-08-0192", tgl: "31/08/2026", unit: "HO", desc: "Penyusutan Agustus (dari run)", dr: "87.420.000", cr: "87.420.000", st: ["POSTED", "good"], _unit: "HO" }
    ],
    actions: [
      { label: "Buat jurnal", primary: true, form: "F_JOURNAL" },
      { label: "Post", form: null },
      { label: "Balik", form: "F_REVERSE" }
    ],
    journal: [
      { dr: "any_account", cr: "any_account", note: "kedua sisi dipilih dari kubus akun; tiap baris boleh menyebut unit lawannya" },
      { dr: null, cr: null, note: "footer menunjukkan selisih; submit ditolak selama selisih bukan nol, per jurnal DAN per unit" },
      { dr: "affiliate_receivable", cr: "affiliate_payable", note: "kaki penyeimbang antarunit ditambahkan mesin, bukan diketik" }
    ],
    note: "Koreksi hanya lewat pembalikan, dan pembalikan memakai akun asli — bukan akun 'koreksi'. REVERSED tidak bisa dibalik lagi: pembalikan kedua akan seimbang sempurna sambil menggandakan uangnya."
  },

  "/finance/interunit": {
    title: "Inter-unit transfers",
    kind: "document",
    group: "Inter-unit",
    store: false,
    job: "Satu dokumen yang memiliki KEDUA kaki: HO mendanai unit, unit membayar balik, barang berpindah.",
    why: "Satu dari lima akun postable perusahaan ini ada untuk mencatat uang HO-ke-toko — 1.386 daun, tujuh matriks 14x14. Layar Journal tidak bisa dipercaya memilih satu sel dari 196; dan `funding_type` wajib, tidak pernah disimpulkan.",
    erp: "Inter Company Journal Entry (invariannya saja)",
    status: "branchD",
    toolbar: ["unit", "period", "search", "segmented"],
    segments: ["PEMBIAYAAN", "BARANG", "Ditolak"],
    kpis: [
      { label: "Bergerak bulan ini", value: "Rp 486.740.000", tone: "plain" },
      { label: "Menunggu kaki kedua", value: "2", tone: "warn" },
      { label: "Ditolak mesin", value: "2", tone: "bad" },
      { label: "Management fee September", value: "Rp 65.000.000", tone: "plain" }
    ],
    columns: [
      { k: "no", label: "Nomor", w: "145px", mono: true },
      { k: "tgl", label: "Tanggal", w: "95px" },
      { k: "from", label: "Dari", w: "80px" },
      { k: "to", label: "Ke", w: "80px" },
      { k: "kind", label: "Keluarga", tag: true },
      { k: "ket", label: "Untuk apa" },
      { k: "amt", label: "Nilai", num: true },
      { k: "st", label: "Status", tag: true }
    ],
    rows: [
      { no: "IU-26-09-0149", tgl: "13/09/2026", from: "HO", to: "C007", kind: ["—", "bad"], ket: "Dana operasional mingguan", amt: "12.400.000", st: ["Ditolak · funding_type kosong", "bad"], _unit: "C007" },
      { no: "IU-26-09-0148", tgl: "13/09/2026", from: "C008", to: "HO", kind: ["PEMBIAYAAN", "info"], ket: "Pelunasan kiriman barang Agustus", amt: "9.400.000", st: ["Ditolak · melunasi utang barang dengan keluarga pendanaan", "bad"], _unit: "C008" },
      { no: "IU-26-09-0147", tgl: "13/09/2026", from: "C006", to: "HO", kind: ["PEMBIAYAAN", "info"], ket: "Pelunasan beban yang dibayar HO", amt: "14.280.000", st: ["DRAFT", "plain"], _unit: "C006" },
      { no: "IU-26-09-0146", tgl: "13/09/2026", from: "HO", to: "C008", kind: ["PEMBIAYAAN", "info"], ket: "Listrik & air September", amt: "18.960.000", st: ["DRAFT", "plain"], _unit: "C008" },
      { no: "IU-26-09-0145", tgl: "12/09/2026", from: "HO", to: "C013", kind: ["BARANG", "plain"], ket: "Kiriman DC ke toko", amt: "94.180.000", st: ["POSTED", "good"], _unit: "C013" },
      { no: "IU-26-09-0144", tgl: "12/09/2026", from: "HO", to: "C005", kind: ["BARANG", "plain"], ket: "Kiriman DC ke toko", amt: "128.400.000", st: ["POSTED", "good"], _unit: "C005" },
      { no: "IU-26-09-0143", tgl: "12/09/2026", from: "HO", to: "C001", kind: ["PEMBIAYAAN", "info"], ket: "Sewa & utilitas dibayar HO", amt: "62.740.000", st: ["POSTED", "good"], _unit: "C001" },
      { no: "IU-26-09-0142", tgl: "12/09/2026", from: "HO", to: "C006", kind: ["PEMBIAYAAN", "info"], ket: "Sewa & utilitas dibayar HO", amt: "48.300.000", st: ["POSTED", "good"], _unit: "C006" },
      { no: "IU-26-09-0141", tgl: "11/09/2026", from: "C009", to: "HO", kind: ["BARANG", "plain"], ket: "Retur barang ke DC", amt: "6.820.000", st: ["POSTED", "good"], _unit: "C009" },
      { no: "IU-26-09-0140", tgl: "11/09/2026", from: "HO", to: "C011", kind: ["PEMBIAYAAN", "info"], ket: "Gaji & THR dibayar HO", amt: "31.500.000", st: ["POSTED", "good"], _unit: "C011" },
      { no: "IU-26-09-0139", tgl: "10/09/2026", from: "HO", to: "C004", kind: ["BARANG", "plain"], ket: "Kiriman DC ke toko", amt: "76.500.000", st: ["POSTED", "good"], _unit: "C004" },
      { no: "IU-26-09-0138", tgl: "10/09/2026", from: "HO", to: "C003", kind: ["PEMBIAYAAN", "info"], ket: "Sewa & utilitas dibayar HO", amt: "24.180.000", st: ["POSTED", "good"], _unit: "C003" },
      { no: "IU-26-09-0137", tgl: "09/09/2026", from: "HO", to: "C002", kind: ["BARANG", "plain"], ket: "Kiriman DC ke toko", amt: "58.900.000", st: ["POSTED", "good"], _unit: "C002" },
      { no: "IU-26-09-0136", tgl: "09/09/2026", from: "HO", to: "C012", kind: ["PEMBIAYAAN", "info"], ket: "Perbaikan & pemeliharaan", amt: "19.740.000", st: ["POSTED", "good"], _unit: "C012" },
      { no: "IU-26-09-0135", tgl: "08/09/2026", from: "HO", to: "C010", kind: ["PEMBIAYAAN", "info"], ket: "Dana operasional (salah unit)", amt: "27.360.000", st: ["REVERSED", "bad"], _unit: "C010" }
    ],
    actions: [
      { label: "Buat transfer antarunit", primary: true, form: "F_INTERUNIT" },
      { label: "Post", form: null },
      { label: "Balik", form: "F_REVERSE" }
    ],
    journal: [
      { dr: "affiliate_receivable", cr: null, note: "di unit pemberi, qualifier = PEMBIAYAAN:<unit lawan> — 1021401 / 1021402 / 1021403" },
      { dr: null, cr: "affiliate_payable", note: "di unit penerima, qualifier = PEMBIAYAAN:<unit lawan> — 2012301 / 2012302 / 2012303 / 2012304" },
      { dr: "inventory", cr: "inventory", note: "kaki BARANG memakai keluarga barang; BDP 1011203/1011204 berpindah antara dua unit" },
      { dr: "affiliate_receivable", cr: "management_fee_revenue", note: "4020110 di HO lawan 7020310004 di toko — dua keluarga rata x14 yang harus net nol" }
    ],
    note: "Aturan keluarga ditegakkan sebagai PENOLAKAN, bukan peringatan: pendanaan melunasi pendanaan, barang melunasi barang. Posting ditolak sampai kedua kaki resolve — spanduk 'tidak satu pun saldo ini terbukti' jadi penolakan."
  },

  "/finance/unit-balances": {
    title: "Due from / Due to",
    kind: "report",
    group: "Inter-unit",
    store: true,
    job: "Matriks 14x14 diringkas per unit: baris berkata ia berutang pada kolom, dan seluruhnya harus net nol.",
    why: "Satu layar dua bacaan: toko membaca barisnya sendiri, HO membaca matriksnya. 'Disepakati' adalah properti yang diperiksa orang — net nol tidak membuktikan kedua pihak setuju.",
    erp: "Party Ledger",
    status: "new",
    toolbar: ["unit", "asof", "search"],
    kpis: [
      { label: "Net lintas 14 unit", value: "Rp 0", tone: "good" },
      { label: "Piutang HO ke unit", value: "Rp 4.057.460.000", tone: "plain" },
      { label: "Sel belum disepakati", value: "2", tone: "warn" },
      { label: "Terlama tanpa gerakan", value: "C004 · 41 hari", tone: "warn" }
    ],
    columns: [
      { k: "unit", label: "Unit", w: "90px" },
      { k: "nama", label: "Nama" },
      { k: "dueFrom", label: "Due from", num: true },
      { k: "dueTo", label: "Due to", num: true },
      { k: "net", label: "Net", num: true },
      { k: "agreed", label: "Disepakati", tag: true }
    ],
    rows: [
      { unit: "HO", nama: "Head Office (00)", dueFrom: "4.057.460.000", dueTo: "106.270.000", net: "3.951.190.000", agreed: ["Cocok", "good"], _unit: "HO" },
      { unit: "C001", nama: "CIKUPA", dueFrom: "12.400.000", dueTo: "402.150.000", net: "-389.750.000", agreed: ["Cocok", "good"], _unit: "C001" },
      { unit: "C002", nama: "MUARO BUNGO", dueFrom: "8.900.000", dueTo: "318.640.000", net: "-309.740.000", agreed: ["Cocok", "good"], _unit: "C002" },
      { unit: "C003", nama: "PURBALINGGA", dueFrom: "6.150.000", dueTo: "286.900.000", net: "-280.750.000", agreed: ["Cocok", "good"], _unit: "C003" },
      { unit: "C004", nama: "BUMIAYU", dueFrom: "4.300.000", dueTo: "241.780.000", net: "-237.480.000", agreed: ["Cocok · 41 hari diam", "warn"], _unit: "C004" },
      { unit: "C005", nama: "JAMBI", dueFrom: "9.760.000", dueTo: "364.520.000", net: "-354.760.000", agreed: ["Cocok", "good"], _unit: "C005" },
      { unit: "C006", nama: "WIRAMODE", dueFrom: "15.200.000", dueTo: "418.960.000", net: "-403.760.000", agreed: ["Cocok", "good"], _unit: "C006" },
      { unit: "C007", nama: "BREBES", dueFrom: "5.480.000", dueTo: "259.340.000", net: "-253.860.000", agreed: ["Cocok", "good"], _unit: "C007" },
      { unit: "C008", nama: "PASURUAN", dueFrom: "3.920.000", dueTo: "228.470.000", net: "-224.550.000", agreed: ["Belum disepakati", "bad"], _unit: "C008" },
      { unit: "C009", nama: "WMJB", dueFrom: "7.640.000", dueTo: "297.180.000", net: "-289.540.000", agreed: ["Cocok", "good"], _unit: "C009" },
      { unit: "C010", nama: "WMBA", dueFrom: "6.830.000", dueTo: "274.560.000", net: "-267.730.000", agreed: ["Cocok", "good"], _unit: "C010" },
      { unit: "C011", nama: "SIPIN", dueFrom: "11.240.000", dueTo: "386.910.000", net: "-375.670.000", agreed: ["Belum disepakati", "bad"], _unit: "C011" },
      { unit: "C012", nama: "BANJARAN", dueFrom: "5.070.000", dueTo: "246.330.000", net: "-241.260.000", agreed: ["Cocok", "good"], _unit: "C012" },
      { unit: "C013", nama: "WONOSOBO", dueFrom: "9.380.000", dueTo: "331.720.000", net: "-322.340.000", agreed: ["Cocok", "good"], _unit: "C013" }
    ],
    actions: [
      { label: "Buka sel 14x14", form: null },
      { label: "Ekspor matriks", form: null }
    ],
    note: "Due from HO (4.057.460.000) persis sama dengan jumlah Due to ke-13 toko, dan Due to HO (106.270.000) persis jumlah Due from mereka — jumlah kolom Net adalah nol. Nama 14 unit masih kandidat; keputusan pemilik nomor 5 belum ditutup."
  },

  "/finance/assets": {
    title: "Assets",
    kind: "document",
    group: "Assets",
    store: false,
    job: "Separuh uang dari register aset: biaya perolehan, keputusan kapitalisasi, umur, transfer, dan pelepasan.",
    why: "GA memegang separuh yang lain — di mana bendanya, siapa yang memegang — dan keduanya adalah dua pintu ke SATU register, bukan dua register. Baris tagihan yang menyebut aset adalah perolehannya; tidak ada dokumen kedua.",
    erp: "Asset",
    status: "live",
    toolbar: ["unit", "period", "search", "segmented"],
    segments: ["Aktif", "Dilepas", "Perlu perhatian"],
    kpis: [
      { label: "Nilai perolehan", value: "Rp 6.485.250.000", tone: "plain" },
      { label: "Nilai buku", value: "Rp 4.001.559.375", tone: "plain" },
      { label: "Tanpa jadwal susut", value: "1", tone: "bad" },
      { label: "Tanpa kategori", value: "1", tone: "warn" }
    ],
    columns: [
      { k: "no", label: "Kode", w: "120px", mono: true },
      { k: "nama", label: "Aset" },
      { k: "unit", label: "Unit", w: "80px" },
      { k: "cat", label: "Kelas", w: "110px" },
      { k: "acq", label: "Perolehan", w: "105px" },
      { k: "cost", label: "Biaya", num: true },
      { k: "nbv", label: "Nilai buku", num: true },
      { k: "st", label: "Status", tag: true }
    ],
    rows: [
      { no: "AST-00-0104", nama: "Bangunan Kantor Pusat", unit: "HO", cat: "Bangunan", acq: "12/03/2019", cost: "4.800.000.000", nbv: "3.120.000.000", st: ["Aktif", "good"], _unit: "HO" },
      { no: "AST-01-0087", nama: "Eskalator", unit: "C001", cat: "Mesin", acq: "02/09/2020", cost: "480.000.000", nbv: "264.000.000", st: ["Aktif", "good"], _unit: "C001" },
      { no: "AST-00-0121", nama: "Lisensi Seventh Soft Application", unit: "HO", cat: "Software", acq: "01/02/2021", cost: "240.000.000", nbv: "102.000.000", st: ["Aktif", "good"], _unit: "HO" },
      { no: "AST-00-0119", nama: "Kendaraan Box L300", unit: "HO", cat: "Kendaraan", acq: "07/06/2023", cost: "210.000.000", nbv: "129.500.000", st: ["Aktif", "good"], _unit: "HO" },
      { no: "AST-12-0141", nama: "Genset 10 kVA", unit: "C012", cat: "Mesin", acq: "22/11/2021", cost: "140.000.000", nbv: "56.000.000", st: ["Dilepas 31/08/2026", "plain"], _unit: "C012" },
      { no: "AST-13-0402", nama: "Instalasi Listrik Toko", unit: "C013", cat: "Instalasi", acq: "15/12/2025", cost: "128.000.000", nbv: "116.000.000", st: ["Aktif", "good"], _unit: "C013" },
      { no: "AST-06-0311", nama: "Rak Display Gondola 24 unit", unit: "C006", cat: "Operating Eq.", acq: "18/04/2024", cost: "96.000.000", nbv: "43.000.000", st: ["Aktif", "good"], _unit: "C006" },
      { no: "AST-06-0312", nama: "AC Split 2 PK x6", unit: "C006", cat: "FFE", acq: "18/04/2024", cost: "72.000.000", nbv: "37.200.000", st: ["Aktif", "good"], _unit: "C006" },
      { no: "AST-05-0221", nama: "Manekin & Patung 40 unit", unit: "C005", cat: "Operating Eq.", acq: "11/01/2025", cost: "54.000.000", nbv: "44.250.000", st: ["Aktif", "good"], _unit: "C005" },
      { no: "AST-08-0178", nama: "Rolling Door Elektrik", unit: "C008", cat: "Instalasi", acq: "09/05/2023", cost: "45.000.000", nbv: "24.750.000", st: ["Aktif", "good"], _unit: "C008" },
      { no: "AST-11-0155", nama: "Meja Kasir 3 unit", unit: "C011", cat: "FFE", acq: "20/08/2022", cost: "31.200.000", nbv: "7.150.000", st: ["Aktif", "good"], _unit: "C011" },
      { no: "AST-09-0133", nama: "CCTV 16 kanal", unit: "C009", cat: "FFE", acq: "14/07/2024", cost: "26.400.000", nbv: "19.800.000", st: ["Aktif", "good"], _unit: "C009" },
      { no: "AST-03-0192", nama: "Rak Dinding Aluminium", unit: "C003", cat: "Operating Eq.", acq: "03/03/2026", cost: "18.500.000", nbv: "16.187.500", st: ["Tanpa jadwal susut", "bad"], _unit: "C003" },
      { no: "AST-04-0166", nama: "Signage & Neon Box", unit: "C004", cat: "Operating Eq.", acq: "05/05/2025", cost: "14.400.000", nbv: "9.600.000", st: ["Aktif", "good"], _unit: "C004" },
      { no: "AST-07-0209", nama: "Etalase Kaca 12 unit", unit: "C007", cat: "—", acq: "10/10/2025", cost: "9.750.000", nbv: "7.921.875", st: ["Tanpa kategori", "warn"], _unit: "C007" }
    ],
    actions: [
      { label: "Daftarkan aset", primary: true, form: "F_ASSET" },
      { label: "Transfer antar unit", form: "F_ASSET_MOVE" },
      { label: "Lepas / hapus buku", form: "F_DISPOSE" },
      { label: "Penyesuaian nilai", form: "F_ADJUST" },
      { label: "Buka di GA", form: null }
    ],
    journal: [
      { dr: "fixed_asset", cr: "trade_payable", note: "perolehan: baris tagihan yang menyebut aset ADALAH perolehannya (0099)" },
      { dr: "fixed_asset", cr: "construction_in_progress", note: "kapitalisasi dari CIP 1031803 ke keluarga 10215" },
      { dr: "accumulated_depreciation", cr: "fixed_asset", note: "pelepasan: akumulasi dikeluarkan, sisanya ke laba/rugi pelepasan" },
      { dr: "fixed_asset", cr: "fixed_asset", note: "transfer antar unit: akun yang sama, site berbeda — kaki afiliasi menyusul" }
    ],
    note: "Cadangan penggantian OE tidak punya baris di sini: pemilik membebankan penggantian langsung, jadi 1.008 daun (1021607 + 7010215) tidur dengan sadar. Bahwa mereka tidak pernah bergerak adalah temuan — tempatnya di Integrity checks."
  },

  "/finance/depreciation": {
    title: "Depreciation",
    kind: "document",
    group: "Assets",
    store: false,
    job: "Jadwal penyusutan tersimpan dengan satu jurnal per baris, dan run bulanannya.",
    why: "Jadwal adalah dokumen yang di-submit, bukan hasil hitung ulang setiap kali dibuka — dan replay duduk di sebelah tombol Post supaya orang melihat angkanya sebelum ia masuk buku.",
    erp: "Asset Depreciation Schedule",
    status: "partial",
    toolbar: ["unit", "period", "search", "segmented"],
    segments: ["September 2026", "Draf", "Habis umur"],
    kpis: [
      { label: "Beban susut September", value: "Rp 38.837.291", tone: "plain" },
      { label: "Baris belum diposting", value: "3", tone: "warn" },
      { label: "Aset habis umur bulan ini", value: "1", tone: "plain" },
      { label: "Selisih replay", value: "Rp 0", tone: "good" }
    ],
    columns: [
      { k: "aset", label: "Aset", w: "120px", mono: true },
      { k: "nama", label: "Keterangan" },
      { k: "unit", label: "Unit", w: "80px" },
      { k: "cat", label: "Kelas", w: "110px" },
      { k: "base", label: "Dasar", num: true },
      { k: "life", label: "Umur", w: "80px" },
      { k: "amt", label: "Beban bulan ini", num: true },
      { k: "st", label: "Status", tag: true }
    ],
    rows: [
      { aset: "AST-00-0104", nama: "Bangunan Kantor Pusat", unit: "HO", cat: "Bangunan", base: "4.800.000.000", life: "20 thn", amt: "20.000.000", st: ["POSTED", "good"], _unit: "HO" },
      { aset: "AST-00-0121", nama: "Lisensi Seventh Soft", unit: "HO", cat: "Software", base: "240.000.000", life: "5 thn", amt: "4.000.000", st: ["POSTED", "good"], _unit: "HO" },
      { aset: "AST-00-0119", nama: "Kendaraan Box L300", unit: "HO", cat: "Kendaraan", base: "210.000.000", life: "8 thn", amt: "2.187.500", st: ["POSTED", "good"], _unit: "HO" },
      { aset: "AST-01-0087", nama: "Eskalator", unit: "C001", cat: "Mesin", base: "480.000.000", life: "20 thn", amt: "2.000.000", st: ["POSTED", "good"], _unit: "C001" },
      { aset: "AST-06-0311", nama: "Rak Display Gondola 24 unit", unit: "C006", cat: "Operating Eq.", base: "96.000.000", life: "4 thn", amt: "2.000.000", st: ["POSTED", "good"], _unit: "C006" },
      { aset: "AST-13-0402", nama: "Instalasi Listrik Toko", unit: "C013", cat: "Instalasi", base: "128.000.000", life: "8 thn", amt: "1.333.333", st: ["POSTED · dipotong ke rupiah utuh", "info"], _unit: "C013" },
      { aset: "AST-12-0141", nama: "Genset 10 kVA", unit: "C012", cat: "Mesin", base: "140.000.000", life: "8 thn", amt: "1.458.333", st: ["Berhenti · dilepas Agustus", "plain"], _unit: "C012" },
      { aset: "AST-06-0312", nama: "AC Split 2 PK x6", unit: "C006", cat: "FFE", base: "72.000.000", life: "5 thn", amt: "1.200.000", st: ["POSTED", "good"], _unit: "C006" },
      { aset: "AST-05-0221", nama: "Manekin & Patung 40 unit", unit: "C005", cat: "Operating Eq.", base: "54.000.000", life: "4 thn", amt: "1.125.000", st: ["POSTED", "good"], _unit: "C005" },
      { aset: "AST-08-0178", nama: "Rolling Door Elektrik", unit: "C008", cat: "Instalasi", base: "45.000.000", life: "5 thn", amt: "750.000", st: ["POSTED", "good"], _unit: "C008" },
      { aset: "AST-11-0155", nama: "Meja Kasir 3 unit", unit: "C011", cat: "FFE", base: "31.200.000", life: "4 thn", amt: "650.000", st: ["POSTED · habis umur Sep", "warn"], _unit: "C011" },
      { aset: "AST-09-0133", nama: "CCTV 16 kanal", unit: "C009", cat: "FFE", base: "26.400.000", life: "4 thn", amt: "550.000", st: ["DRAFT", "plain"], _unit: "C009" },
      { aset: "AST-04-0166", nama: "Signage & Neon Box", unit: "C004", cat: "Operating Eq.", base: "14.400.000", life: "4 thn", amt: "300.000", st: ["POSTED", "good"], _unit: "C004" },
      { aset: "AST-07-0209", nama: "Etalase Kaca 12 unit", unit: "C007", cat: "Operating Eq.", base: "9.750.000", life: "4 thn", amt: "203.125", st: ["DRAFT", "plain"], _unit: "C007" },
      { aset: "AST-03-0192", nama: "Rak Dinding Aluminium", unit: "C003", cat: "Operating Eq.", base: "18.500.000", life: "4 thn", amt: "385.416", st: ["Belum berjadwal", "bad"], _unit: "C003" }
    ],
    actions: [
      { label: "Jalankan run bulanan", primary: true, form: "F_DEPR_RUN" },
      { label: "Replay", form: null },
      { label: "Post", form: null }
    ],
    journal: [
      { dr: "depreciation_expense", cr: "accumulated_depreciation", note: "satu jurnal per baris jadwal, site = unit aset, kelas menentukan pasangan akun" },
      { dr: "depreciation_expense", cr: null, note: "7010210 Bangunan · 7010211 Instalasi · 7010212 Mesin · 7010213 Kendaraan · 7010214 FFE · 7010216 Intangible" },
      { dr: null, cr: "accumulated_depreciation", note: "1021602 Bangunan · 1021603 Instalasi · 1021604 Mesin · 1021605 Kendaraan · 1021606 FFE · 1021702 Software" }
    ],
    note: "Tarif dan umur adalah satu angka yang sama dilihat dua arah (120_000/bps); beban dipotong ke rupiah utuh dan mulai dari bulan TANGGAL BELI. Routing penyusutan bisa salah diam-diam sampai perbaikan bagan A2/A3 selesai."
  },

  "/finance/projects": {
    title: "Projects in progress",
    kind: "document",
    group: "Assets",
    store: false,
    job: "Contract in progress (1031803) dan pre-opening (1031802) sampai keduanya dikapitalisasi.",
    why: "Hanya hidup ketika sebuah toko sedang dibangun — dan justru karena itu ia perlu rumah: biaya yang menumpuk di akun aset lain tanpa jadwal susut adalah biaya yang tidak pernah jadi beban.",
    erp: "Asset Capitalization / CWIP",
    status: "partial",
    toolbar: ["unit", "period", "search"],
    kpis: [
      { label: "CIP berjalan", value: "Rp 1.671.400.000", tone: "plain" },
      { label: "Pre-opening belum habis", value: "Rp 329.100.000", tone: "plain" },
      { label: "Lewat 6 bulan", value: "3", tone: "warn" },
      { label: "Siap dikapitalisasi", value: "2", tone: "good" }
    ],
    columns: [
      { k: "no", label: "Nomor", w: "120px", mono: true },
      { k: "nama", label: "Proyek" },
      { k: "unit", label: "Unit", w: "80px" },
      { k: "mulai", label: "Mulai", w: "100px" },
      { k: "spent", label: "Terpakai", num: true },
      { k: "target", label: "Jadi kelas", w: "120px" },
      { k: "age", label: "Umur", w: "80px" },
      { k: "st", label: "Status", tag: true }
    ],
    rows: [
      { no: "CIP-26-0009", nama: "Perluasan gudang DC", unit: "HO", mulai: "04/03/2026", spent: "742.300.000", target: "Bangunan", age: "6 bln", st: ["Berjalan", "info"], _unit: "HO" },
      { no: "CIP-26-0007", nama: "Renovasi fasad & interior", unit: "C013", mulai: "02/01/2026", spent: "418.600.000", target: "FFE + Instalasi", age: "8 bln", st: ["Berjalan", "info"], _unit: "C013" },
      { no: "CIP-26-0010", nama: "Ganti eskalator", unit: "C001", mulai: "11/06/2026", spent: "310.000.000", target: "Mesin", age: "3 bln", st: ["Berjalan", "info"], _unit: "C001" },
      { no: "CIP-26-0012", nama: "Sistem CCTV terpusat", unit: "HO", mulai: "18/07/2026", spent: "212.500.000", target: "FFE", age: "2 bln", st: ["Siap dikapitalisasi", "good"], _unit: "HO" },
      { no: "CIP-26-0008", nama: "Toko baru Wonosobo — pre-opening", unit: "C013", mulai: "15/11/2025", spent: "186.400.000", target: "Pre-opening", age: "10 bln", st: ["Amortisasi berjalan", "good"], _unit: "C013" },
      { no: "CIP-26-0011", nama: "Signage baru 4 toko", unit: "HO", mulai: "01/08/2026", spent: "148.000.000", target: "Operating Eq.", age: "1 bln", st: ["Berjalan", "info"], _unit: "HO" },
      { no: "CIP-25-0003", nama: "Pre-opening Banjaran", unit: "C012", mulai: "03/04/2025", spent: "142.700.000", target: "Pre-opening", age: "17 bln", st: ["Lewat 6 bulan", "warn"], _unit: "C012" },
      { no: "CIP-25-0004", nama: "Instalasi listrik ulang", unit: "C008", mulai: "20/08/2025", spent: "96.800.000", target: "Instalasi", age: "13 bln", st: ["Lewat 6 bulan", "warn"], _unit: "C008" },
      { no: "CIP-25-0005", nama: "Renovasi toilet & mushola", unit: "C005", mulai: "12/09/2025", spent: "64.200.000", target: "Bangunan", age: "12 bln", st: ["Lewat 6 bulan", "warn"], _unit: "C005" },
      { no: "CIP-26-0013", nama: "Rak display baru", unit: "C011", mulai: "25/08/2026", spent: "58.900.000", target: "Operating Eq.", age: "1 bln", st: ["Siap dikapitalisasi", "good"], _unit: "C011" },
      { no: "CIP-26-0014", nama: "Perbaikan atap", unit: "C004", mulai: "05/09/2026", spent: "34.600.000", target: "Bangunan", age: "0 bln", st: ["DRAFT", "plain"], _unit: "C004" }
    ],
    actions: [
      { label: "Buka proyek", primary: true, form: "F_CIP" },
      { label: "Tambahkan biaya", form: null },
      { label: "Kapitalisasi", form: "F_CAPITALISE" }
    ],
    journal: [
      { dr: "construction_in_progress", cr: "non_merchandise_payable", note: "biaya menumpuk di 1031803 CIP, per unit" },
      { dr: "preopening_cost", cr: "non_merchandise_payable", note: "biaya pra-buka toko di 1031802" },
      { dr: "fixed_asset", cr: "construction_in_progress", note: "kapitalisasi: satu tanggal switchover yang idempoten — dijalankan dua kali tidak menambah dua kali" },
      { dr: "depreciation_expense", cr: "preopening_cost", note: "pre-opening diamortisasi lewat 7010216002, bukan disusutkan" }
    ],
    note: "AssetCostComponent: beberapa pembayaran boleh menyebut satu aset tanpa memposting dua kali. Tiga proyek lewat 6 bulan — biaya yang menumpuk di akun aset tanpa jadwal adalah laba yang belum diakui hilang."
  },

  "/finance/payroll-postings": {
    title: "Payroll postings",
    kind: "document",
    group: "Payroll",
    store: false,
    job: "Menerima batch tersegel dari HR, lalu memposting akrual, kewajiban, dan pembayarannya.",
    why: "Tidak ada 'buat payroll baru' di sini: tempat kedua untuk menghitung gaji adalah jawaban kedua atas apa yang orang terima. Finance mulai dari batch HR dan berhenti di jurnal.",
    erp: "Salary Slip ke GL (hrms)",
    status: "new",
    toolbar: ["unit", "period", "search", "segmented"],
    segments: ["Agustus 2026", "September 2026", "Belum dibayar"],
    kpis: [
      { label: "Akrual Agustus", value: "Rp 612.480.000", tone: "plain" },
      { label: "Belum dibayar", value: "Rp 86.303.000", tone: "warn" },
      { label: "PPh 21 Agustus", value: "Rp 24.518.000", tone: "plain" },
      { label: "Batch tersegel menunggu", value: "3", tone: "info" }
    ],
    columns: [
      { k: "no", label: "Batch", w: "150px", mono: true },
      { k: "bulan", label: "Bulan", w: "100px" },
      { k: "unit", label: "Unit", w: "80px" },
      { k: "heads", label: "Orang", num: true },
      { k: "gross", label: "Bruto", num: true },
      { k: "ded", label: "Potongan", num: true },
      { k: "net", label: "Neto dibayar", num: true },
      { k: "st", label: "Status", tag: true }
    ],
    rows: [
      { no: "PR-26-09-HO", bulan: "Sep 2026", unit: "HO", heads: "42", gross: "414.800.000", ded: "38.690.000", net: "376.110.000", st: ["Tertahan · site `ho` tidak ada di peta", "bad"], _unit: "HO" },
      { no: "PR-26-09-C001", bulan: "Sep 2026", unit: "C001", heads: "14", gross: "78.400.000", ded: "5.880.000", net: "72.520.000", st: ["Batch tersegel HR", "info"], _unit: "C001" },
      { no: "PR-26-09-C006", bulan: "Sep 2026", unit: "C006", heads: "13", gross: "71.500.000", ded: "5.362.000", net: "66.138.000", st: ["Batch tersegel HR", "info"], _unit: "C006" },
      { no: "PR-26-08-HO", bulan: "Agu 2026", unit: "HO", heads: "42", gross: "412.600.000", ded: "38.470.000", net: "374.130.000", st: ["POSTED · dibayar", "good"], _unit: "HO" },
      { no: "PR-26-08-C001", bulan: "Agu 2026", unit: "C001", heads: "14", gross: "78.400.000", ded: "5.880.000", net: "72.520.000", st: ["POSTED · dibayar", "good"], _unit: "C001" },
      { no: "PR-26-08-C006", bulan: "Agu 2026", unit: "C006", heads: "12", gross: "66.300.000", ded: "4.972.000", net: "61.328.000", st: ["POSTED · dibayar", "good"], _unit: "C006" },
      { no: "PR-26-08-C005", bulan: "Agu 2026", unit: "C005", heads: "11", gross: "59.840.000", ded: "4.488.000", net: "55.352.000", st: ["POSTED · dibayar", "good"], _unit: "C005" },
      { no: "PR-26-08-C013", bulan: "Agu 2026", unit: "C013", heads: "9", gross: "48.600.000", ded: "3.645.000", net: "44.955.000", st: ["POSTED · dibayar", "good"], _unit: "C013" },
      { no: "PR-26-08-C011", bulan: "Agu 2026", unit: "C011", heads: "10", gross: "52.100.000", ded: "3.907.000", net: "48.193.000", st: ["Akrual terposting · belum dibayar", "warn"], _unit: "C011" },
      { no: "PR-26-08-C012", bulan: "Agu 2026", unit: "C012", heads: "8", gross: "41.200.000", ded: "3.090.000", net: "38.110.000", st: ["Akrual terposting · belum dibayar", "warn"], _unit: "C012" },
      { no: "PR-26-08-C008", bulan: "Agu 2026", unit: "C008", heads: "9", gross: "44.700.000", ded: "3.352.000", net: "41.348.000", st: ["POSTED · dibayar", "good"], _unit: "C008" },
      { no: "PR-26-08-C002", bulan: "Agu 2026", unit: "C002", heads: "8", gross: "39.600.000", ded: "2.970.000", net: "36.630.000", st: ["POSTED · dibayar", "good"], _unit: "C002" },
      { no: "PR-26-08-C003", bulan: "Agu 2026", unit: "C003", heads: "8", gross: "38.400.000", ded: "2.880.000", net: "35.520.000", st: ["POSTED · dibayar", "good"], _unit: "C003" },
      { no: "PR-26-08-C004", bulan: "Agu 2026", unit: "C004", heads: "7", gross: "34.300.000", ded: "2.572.000", net: "31.728.000", st: ["POSTED · dibayar", "good"], _unit: "C004" },
      { no: "PR-26-08-C009", bulan: "Agu 2026", unit: "C009", heads: "9", gross: "45.900.000", ded: "3.442.000", net: "42.458.000", st: ["POSTED · dibayar", "good"], _unit: "C009" }
    ],
    actions: [
      { label: "Terima batch HR", primary: true, form: "F_PAYROLL_BATCH" },
      { label: "Post akrual", form: null },
      { label: "Post pembayaran", form: null }
    ],
    journal: [
      { dr: "payroll_expense", cr: "payroll_payable", note: "akrual bulanan: 6010111 toko (13 komponen) / 6010210 kantor (13 komponen) lawan 2012201001/002" },
      { dr: null, cr: "pph21_payable", note: "potongan PPh 21 ke 2012101001 — dilepas saat setoran, bukan saat gaji dibayar" },
      { dr: "payroll_payable", cr: "petty_cash", note: "pembayaran tanggal 1 bulan berikut: gaji di unit dibayar LEWAT PETTY CASH (kebijakan pemilik)" },
      { dr: "payroll_payable", cr: "bank_giro", note: "pegawai HO dan pegawai bergaji transfer" },
      { dr: "affiliate_receivable", cr: "affiliate_payable", note: "kalau HO mendanai unit untuk membayar — pasangan PEMBIAYAAN, bukan BARANG" },
      { dr: "payroll_payable", cr: "employee_receivable", note: "angsuran pinjaman staf dinetkan sebelum uangnya berangkat" }
    ],
    note: "Menutup lubang 'payroll tidak menulis jurnal': hari ini ada 13 rute payroll dan nol jurnal. Baris PR-26-09-HO tertahan karena account_map.site tidak punya baris `ho` — keputusan pemilik nomor 6."
  },

  "/finance/staff-loans": {
    title: "Staff loans",
    kind: "document",
    group: "Payroll",
    store: false,
    job: "Pinjaman pegawai (1011102001) dan piutang kepala toko (1011102002), yang keduanya ditagih lewat potongan payroll.",
    why: "Piutang kepala toko adalah PINJAMAN PRIBADI, bukan piutang dagang — keputusan pemilik 7 September. Ia tidak punya rumah di kelima rancangan sebelumnya; sekarang punya, dan rumahnya ada di sebelah cara ia ditagih.",
    erp: "Employee Advance (polanya)",
    status: "new",
    toolbar: ["unit", "search", "segmented"],
    segments: ["Pinjaman pegawai", "Piutang kepala toko", "Lunas"],
    kpis: [
      { label: "Pinjaman pegawai", value: "Rp 14.150.000", tone: "plain" },
      { label: "Piutang kepala toko", value: "Rp 80.000.000", tone: "warn" },
      { label: "Tanpa jadwal potong", value: "3", tone: "bad" },
      { label: "Dipotong lewat payroll Sep", value: "Rp 4.950.000", tone: "plain" }
    ],
    columns: [
      { k: "no", label: "Nomor", w: "130px", mono: true },
      { k: "peg", label: "Pegawai" },
      { k: "unit", label: "Unit", w: "80px" },
      { k: "jenis", label: "Jenis", tag: true },
      { k: "pokok", label: "Pokok", num: true },
      { k: "sisa", label: "Sisa", num: true },
      { k: "angs", label: "Angsuran/bln", num: true },
      { k: "st", label: "Status", tag: true }
    ],
    rows: [
      { no: "SL-25-10-0038", peg: "Ka. Toko C012", unit: "C012", jenis: ["Piutang kepala toko", "warn"], pokok: "25.000.000", sisa: "25.000.000", angs: "0", st: ["Tanpa jadwal potong · 11 bulan", "bad"], _unit: "C012" },
      { no: "SL-25-11-0041", peg: "Ka. Toko C011", unit: "C011", jenis: ["Piutang kepala toko", "warn"], pokok: "20.000.000", sisa: "20.000.000", angs: "0", st: ["Tanpa jadwal potong", "bad"], _unit: "C011" },
      { no: "SL-25-12-0047", peg: "Ka. Toko C004", unit: "C004", jenis: ["Piutang kepala toko", "warn"], pokok: "18.000.000", sisa: "18.000.000", angs: "0", st: ["Tanpa jadwal potong", "bad"], _unit: "C004" },
      { no: "SL-26-05-0018", peg: "Bambang Sutrisno (Ka. Toko C006)", unit: "C006", jenis: ["Piutang kepala toko", "warn"], pokok: "15.000.000", sisa: "9.000.000", angs: "1.500.000", st: ["Aktif", "good"], _unit: "C006" },
      { no: "SL-26-06-0023", peg: "Ka. Toko C008", unit: "C008", jenis: ["Piutang kepala toko", "warn"], pokok: "12.000.000", sisa: "8.000.000", angs: "1.000.000", st: ["Aktif", "good"], _unit: "C008" },
      { no: "SL-26-01-0004", peg: "Dewi Lestari (Adm HO)", unit: "HO", jenis: ["Pinjaman pegawai", "plain"], pokok: "10.000.000", sisa: "2.000.000", angs: "1.000.000", st: ["Aktif", "good"], _unit: "HO" },
      { no: "SL-26-07-0029", peg: "Staf Gudang HO", unit: "HO", jenis: ["Pinjaman pegawai", "plain"], pokok: "8.000.000", sisa: "6.000.000", angs: "500.000", st: ["Aktif", "good"], _unit: "HO" },
      { no: "SL-26-03-0012", peg: "Sri Wahyuni (Adm C006)", unit: "C006", jenis: ["Pinjaman pegawai", "plain"], pokok: "6.000.000", sisa: "2.500.000", angs: "500.000", st: ["Aktif", "good"], _unit: "C006" },
      { no: "SL-26-03-0011", peg: "Pramuniaga C009", unit: "C009", jenis: ["Pinjaman pegawai", "plain"], pokok: "5.000.000", sisa: "0", angs: "0", st: ["Lunas 31/07/2026", "good"], _unit: "C009" },
      { no: "SL-26-02-0009", peg: "Kasir C001", unit: "C001", jenis: ["Pinjaman pegawai", "plain"], pokok: "4.000.000", sisa: "0", angs: "0", st: ["Lunas 31/08/2026", "good"], _unit: "C001" },
      { no: "SL-26-04-0015", peg: "Pramuniaga C005", unit: "C005", jenis: ["Pinjaman pegawai", "plain"], pokok: "3.000.000", sisa: "1.250.000", angs: "250.000", st: ["Aktif", "good"], _unit: "C005" },
      { no: "SL-26-08-0033", peg: "Kasir C013", unit: "C013", jenis: ["Pinjaman pegawai", "plain"], pokok: "2.400.000", sisa: "2.400.000", angs: "200.000", st: ["Mulai dipotong September", "info"], _unit: "C013" }
    ],
    actions: [
      { label: "Catat pinjaman", primary: true, form: "F_LOAN" },
      { label: "Pasang jadwal potong", form: "F_SCHEDULE" },
      { label: "Catat pelunasan", form: null }
    ],
    journal: [
      { dr: "employee_receivable", cr: "petty_cash", note: "pinjaman pegawai dibayarkan dari petty cash unit — 1011102001" },
      { dr: "store_head_receivable", cr: "bank_giro", note: "piutang kepala toko dari rekening HO — 1011102002, pinjaman pribadi" },
      { dr: "payroll_payable", cr: "employee_receivable", note: "angsuran: dipotong dari neto payroll, bukan dibayar tunai" },
      { dr: "payroll_payable", cr: "store_head_receivable", note: "angsuran kepala toko lewat jalan yang sama" }
    ],
    note: "Tiga piutang kepala toko tanpa jadwal potong sama sekali — Rp 63.000.000 yang tidak pernah ditagih siapa pun. Ini yang membuat baris ini ada."
  },

  "/finance/schedules": {
    title: "Prepaids & accruals",
    kind: "document",
    group: "Periodic & closing",
    store: false,
    job: "Jadwal bulanan dua arah: yang dibayar di muka dilepas, yang sudah terpakai tapi belum dibayar diakui.",
    why: "ACCRUED EXPENSE punya 140 daun dengan tiga pemilik — payroll, beban, pendanaan — jadi ia DINAIKKAN di masing-masing domain dan hanya DIBACA sebagai kontrol di sini. 'Satu keluarga akun bukan satu menu.'",
    erp: "Journal Entry Template",
    status: "new",
    toolbar: ["unit", "period", "search", "segmented"],
    segments: ["Prepaid", "Akrual", "Habis bulan ini"],
    kpis: [
      { label: "Prepaid tersisa", value: "Rp 430.716.664", tone: "plain" },
      { label: "Akrual berjalan", value: "Rp 721.665.000", tone: "plain" },
      { label: "Dilepas September", value: "Rp 55.816.666", tone: "plain" },
      { label: "Jadwal habis bulan ini", value: "1", tone: "warn" }
    ],
    columns: [
      { k: "no", label: "Nomor", w: "130px", mono: true },
      { k: "jenis", label: "Jenis", tag: true },
      { k: "ket", label: "Keterangan" },
      { k: "unit", label: "Unit", w: "80px" },
      { k: "monthly", label: "Per bulan", num: true },
      { k: "sisa", label: "Sisa", num: true },
      { k: "st", label: "Status", tag: true }
    ],
    rows: [
      { no: "SCH-26-0031", jenis: ["Prepaid", "info"], ket: "Sewa ruko C006 — Bpk. Hasan, 12 bulan", unit: "C006", monthly: "15.000.000", sisa: "165.000.000", st: ["Aktif · 11 dari 12", "good"], _unit: "C006" },
      { no: "SCH-26-0033", jenis: ["Prepaid", "info"], ket: "Sewa ruko C001 — 24 bulan", unit: "C001", monthly: "11.500.000", sisa: "172.500.000", st: ["Aktif · 15 dari 24", "good"], _unit: "C001" },
      { no: "SCH-26-0032", jenis: ["Prepaid", "info"], ket: "Asuransi Property All Risk & Fire", unit: "HO", monthly: "8.400.000", sisa: "33.600.000", st: ["Aktif · 4 dari 12", "good"], _unit: "HO" },
      { no: "SCH-26-0043", jenis: ["Prepaid", "info"], ket: "Sewa ruko C013 — 12 bulan", unit: "C013", monthly: "9.166.666", sisa: "36.666.664", st: ["Pembulatan · sisa 2 rupiah di bulan terakhir", "warn"], _unit: "C013" },
      { no: "SCH-26-0034", jenis: ["Prepaid", "info"], ket: "PBB 14 unit", unit: "HO", monthly: "3.200.000", sisa: "12.800.000", st: ["Aktif · 8 dari 12", "good"], _unit: "HO" },
      { no: "SCH-26-0041", jenis: ["Prepaid", "info"], ket: "Asuransi kendaraan", unit: "HO", monthly: "1.450.000", sisa: "10.150.000", st: ["Aktif · 5 dari 12", "good"], _unit: "HO" },
      { no: "SCH-26-0035", jenis: ["Prepaid", "info"], ket: "Promo katalog Lebaran", unit: "HO", monthly: "6.750.000", sisa: "0", st: ["Habis Agustus", "plain"], _unit: "HO" },
      { no: "SCH-26-0037", jenis: ["Akrual", "plain"], ket: "Gaji & THR yang masih harus dibayar", unit: "HO", monthly: "612.480.000", sisa: "612.480.000", st: ["Dinaikkan dari Payroll", "info"], _unit: "HO" },
      { no: "SCH-26-0036", jenis: ["Akrual", "plain"], ket: "Listrik 13 toko (YMHD)", unit: "HO", monthly: "48.620.000", sisa: "48.620.000", st: ["Aktif", "good"], _unit: "HO" },
      { no: "SCH-26-0039", jenis: ["Akrual", "plain"], ket: "Sewa ruko C005 — belum ditagih 3 bulan", unit: "C005", monthly: "9.800.000", sisa: "29.400.000", st: ["Aktif", "good"], _unit: "C005" },
      { no: "SCH-26-0044", jenis: ["Akrual", "plain"], ket: "Jasa ekspedisi September", unit: "HO", monthly: "11.240.000", sisa: "11.240.000", st: ["DRAFT", "plain"], _unit: "HO" },
      { no: "SCH-26-0038", jenis: ["Akrual", "plain"], ket: "Bunga pinjaman BCA", unit: "HO", monthly: "9.375.000", sisa: "9.375.000", st: ["Dinaikkan dari Pendanaan", "info"], _unit: "HO" },
      { no: "SCH-26-0042", jenis: ["Akrual", "plain"], ket: "Cleaning service 13 toko", unit: "HO", monthly: "8.400.000", sisa: "8.400.000", st: ["Aktif", "good"], _unit: "HO" },
      { no: "SCH-26-0040", jenis: ["Akrual", "plain"], ket: "Telepon & internet", unit: "HO", monthly: "2.150.000", sisa: "2.150.000", st: ["Aktif", "good"], _unit: "HO" }
    ],
    actions: [
      { label: "Buat jadwal", primary: true, form: "F_SCHEDULE" },
      { label: "Lepas bulan ini", form: null },
      { label: "Balik akrual saat tagihan datang", form: null }
    ],
    journal: [
      { dr: "expense_by_category", cr: "prepaid_expense", note: "pelepasan prepaid: 7010110 sewa, 6010310 asuransi & PBB, lawan 1011301 (9 jenis)" },
      { dr: "expense_by_category", cr: "accrued_expense", note: "pengakuan akrual: beban root 6/7 lawan 2012201 (10 jenis YMHD)" },
      { dr: "accrued_expense", cr: "non_merchandise_payable", note: "saat tagihan akhirnya datang, akrual dibalik ke utang — bukan dibebankan dua kali" },
      { dr: "prepaid_expense", cr: "non_merchandise_payable", note: "pembentukan prepaid datang dari baris tagihan, bukan diketik di sini" }
    ],
    note: "Strip 12 bulan adalah 12 tanda, satu per bulan: yang sudah dilepas, yang bulan ini, yang belum. Kontrol akrual di sini read-only — ia dibaca sebagai total, dinaikkan di domainnya masing-masing."
  },

  "/finance/periods": {
    title: "Period close",
    kind: "document",
    group: "Periodic & closing",
    store: false,
    job: "Mengunci bulan secara selektif, dan memposting hasil periode ke ekuitas.",
    why: "Checklist lima baris harus MENAHAN di server dan menyebut nomor dokumennya, bukan sekadar membalik status. Centang 'setuju abaikan validasi' yang dipakai di produksi pesaing ditolak dengan sengaja.",
    erp: "Accounting Period + Period Closing Voucher",
    status: "live",
    toolbar: ["period"],
    kpis: [
      { label: "Bulan terbuka", value: "September 2026", tone: "plain" },
      { label: "Dokumen menahan Agustus", value: "3", tone: "warn" },
      { label: "Laba Jan–Agu ke ekuitas", value: "Rp 2.486.340.000", tone: "plain" },
      { label: "Unit tanpa jurnal bulan ini", value: "0", tone: "good" }
    ],
    columns: [
      { k: "per", label: "Periode", w: "150px" },
      { k: "scope", label: "Cakupan", w: "110px" },
      { k: "checks", label: "Checklist", w: "100px" },
      { k: "blockers", label: "Menahan", num: true },
      { k: "by", label: "Ditutup oleh" },
      { k: "st", label: "Status", tag: true }
    ],
    rows: [
      { per: "September 2026", scope: "Semua unit", checks: "1 dari 5", blockers: "26", by: "—", st: ["Terbuka", "plain"], _unit: "HO" },
      { per: "Agustus 2026", scope: "Semua unit", checks: "4 dari 5", blockers: "3", by: "—", st: ["Menunggu · 3 dokumen menahan", "warn"], _unit: "HO" },
      { per: "Juli 2026", scope: "Semua unit", checks: "5 dari 5", blockers: "0", by: "Dewi Lestari (Adm HO)", st: ["Tertutup · kunci selektif", "info"], _unit: "HO" },
      { per: "Juni 2026", scope: "Semua unit", checks: "5 dari 5", blockers: "0", by: "Dewi Lestari (Adm HO)", st: ["Tertutup", "good"], _unit: "HO" },
      { per: "Mei 2026", scope: "Semua unit", checks: "5 dari 5", blockers: "0", by: "Dewi Lestari (Adm HO)", st: ["Tertutup", "good"], _unit: "HO" },
      { per: "April 2026", scope: "Semua unit", checks: "5 dari 5", blockers: "0", by: "Dewi Lestari (Adm HO)", st: ["Tertutup", "good"], _unit: "HO" },
      { per: "Maret 2026", scope: "Semua unit", checks: "5 dari 5", blockers: "0", by: "Dewi Lestari (Adm HO)", st: ["Tertutup", "good"], _unit: "HO" },
      { per: "Februari 2026", scope: "Semua unit", checks: "5 dari 5", blockers: "0", by: "Dewi Lestari (Adm HO)", st: ["Tertutup", "good"], _unit: "HO" },
      { per: "Januari 2026", scope: "Semua unit", checks: "5 dari 5", blockers: "0", by: "Dewi Lestari (Adm HO)", st: ["Tertutup", "good"], _unit: "HO" },
      { per: "Desember 2025 (saldo awal)", scope: "Semua unit", checks: "5 dari 5", blockers: "0", by: "Dewi Lestari (Adm HO)", st: ["Tertutup · go-live", "good"], _unit: "HO" }
    ],
    actions: [
      { label: "Jalankan checklist", primary: true, form: null },
      { label: "Kunci selektif", form: "F_LOCK" },
      { label: "Post hasil periode ke ekuitas", form: "F_PCV" },
      { label: "Ekspor paket penutupan", form: null }
    ],
    journal: [
      { dr: "revenue_cash", cr: "retained_earnings", note: "Period Closing Voucher: saldo P&L dipindah ke 3013001003, per unit" },
      { dr: "retained_earnings", cr: "cogs", note: "sisi beban dari penutupan yang sama" },
      { dr: "bad_debt_expense", cr: "receivable_provision", note: "cadangan piutang 1011103 — bagian layar ini, bukan menu sendiri" },
      { dr: "stock_loss", cr: "inventory_provision", note: "cadangan kerusakan 1011299 dari hasil opname" }
    ],
    note: "Periode adalah properti buku, bukan unit: HO dan 13 toko adalah satu badan usaha dan satu buku. Provisions dan Equity sengaja tidak jadi baris menu — 126 daun yang bergerak beberapa kali setahun adalah bagian layar ini."
  },

  "/finance/opening": {
    title: "Opening balances",
    kind: "tool",
    group: "Periodic & closing",
    store: false,
    job: "Memindahkan saldo awal 14 unit menjadi dokumen terbuka — tagihan, giro, uang muka — bukan satu jurnal gelondongan.",
    why: "Go-live 14 unit butuh workbench migrasi, bukan form jurnal generik: saldo utang yang masuk sebagai satu angka tidak bisa dibayar per tagihan sesudahnya.",
    erp: "COA Importer + Opening Invoice Creation Tool",
    status: "branchD",
    toolbar: ["unit", "search"],
    kpis: [
      { label: "Unit siap", value: "7 dari 14", tone: "warn" },
      { label: "Baris saldo awal", value: "5.667", tone: "plain" },
      { label: "Register aset terimpor", value: "1.328 baris", tone: "good" },
      { label: "Selisih tersisa", value: "Rp 4.320.000", tone: "bad" }
    ],
    columns: [
      { k: "unit", label: "Unit", w: "90px" },
      { k: "nama", label: "Nama" },
      { k: "lines", label: "Baris", num: true },
      { k: "dr", label: "Debit", num: true },
      { k: "cr", label: "Kredit", num: true },
      { k: "diff", label: "Selisih", num: true },
      { k: "st", label: "Status", tag: true }
    ],
    rows: [
      { unit: "HO", nama: "Head Office (00)", lines: "1.842", dr: "8.640.200.000", cr: "8.640.200.000", diff: "0", st: ["Siap", "good"], _unit: "HO" },
      { unit: "C001", nama: "CIKUPA", lines: "312", dr: "486.300.000", cr: "486.300.000", diff: "0", st: ["Siap", "good"], _unit: "C001" },
      { unit: "C002", nama: "MUARO BUNGO", lines: "288", dr: "342.100.000", cr: "342.100.000", diff: "0", st: ["Siap", "good"], _unit: "C002" },
      { unit: "C003", nama: "PURBALINGGA", lines: "274", dr: "318.700.000", cr: "318.700.000", diff: "0", st: ["Siap", "good"], _unit: "C003" },
      { unit: "C004", nama: "BUMIAYU", lines: "261", dr: "296.400.000", cr: "296.400.000", diff: "0", st: ["Siap", "good"], _unit: "C004" },
      { unit: "C005", nama: "JAMBI", lines: "305", dr: "402.800.000", cr: "402.800.000", diff: "0", st: ["Siap", "good"], _unit: "C005" },
      { unit: "C006", nama: "WIRAMODE", lines: "327", dr: "518.900.000", cr: "518.900.000", diff: "0", st: ["Siap", "good"], _unit: "C006" },
      { unit: "C007", nama: "BREBES", lines: "249", dr: "271.600.000", cr: "271.600.000", diff: "0", st: ["DRAFT", "plain"], _unit: "C007" },
      { unit: "C008", nama: "PASURUAN", lines: "256", dr: "284.300.000", cr: "281.150.000", diff: "3.150.000", st: ["Tidak seimbang", "bad"], _unit: "C008" },
      { unit: "C009", nama: "WMJB", lines: "268", dr: "302.500.000", cr: "302.500.000", diff: "0", st: ["DRAFT", "plain"], _unit: "C009" },
      { unit: "C010", nama: "WMBA", lines: "262", dr: "289.700.000", cr: "289.700.000", diff: "0", st: ["DRAFT", "plain"], _unit: "C010" },
      { unit: "C011", nama: "SIPIN", lines: "298", dr: "372.400.000", cr: "372.400.000", diff: "0", st: ["DRAFT", "plain"], _unit: "C011" },
      { unit: "C012", nama: "BANJARAN", lines: "244", dr: "258.900.000", cr: "258.900.000", diff: "0", st: ["DRAFT", "plain"], _unit: "C012" },
      { unit: "C013", nama: "WONOSOBO", lines: "281", dr: "329.800.000", cr: "328.630.000", diff: "1.170.000", st: ["Tidak seimbang", "bad"], _unit: "C013" }
    ],
    actions: [
      { label: "Impor saldo awal", primary: true, form: "F_OPENING" },
      { label: "Impor sub-ledger terbuka", form: "F_OPENING_SUB" },
      { label: "Kunci saldo awal", form: null }
    ],
    journal: [
      { dr: "any_account", cr: "opening_equity", note: "tiap baris saldo awal berpasangan dengan ekuitas pembuka, per unit" },
      { dr: "opening_equity", cr: "trade_payable", note: "utang pemasok masuk sebagai TAGIHAN TERBUKA satu per satu, bukan satu angka" },
      { dr: "inventory", cr: "opening_equity", note: "persediaan awal per pool, dari opening_stock_line" },
      { dr: "fixed_asset", cr: "opening_equity", note: "1.328 baris register aset klien — sudah terimpor, sisa buku belum" }
    ],
    note: "Dua unit masih tidak seimbang sebesar Rp 4.320.000 total. Alat ini mengubah dokumen lain dan tidak punya record sendiri — karena itu kind-nya tool, bukan document."
  },

  "/finance/reports": {
    title: "Financial statements",
    kind: "report",
    group: "Reports",
    store: false,
    job: "Neraca, laba rugi, arus kas dan konsolidasi — sebagai template bernama yang tersimpan, bukan sebagai menu masing-masing.",
    why: "'Filter adalah titik perluasan, bukan baris menu.' Dua belas laporan yang rancangan lain jadikan layar tersendiri adalah template di sini; bentuk tersimpan dan bernama tidak sama dengan query bebas, dan query bebas tidak pernah jadi laporan resmi.",
    erp: "Balance Sheet / P&L / Financial Report Template",
    status: "live",
    toolbar: ["unit", "period", "search", "segmented"],
    segments: ["Semua", "Neraca", "Laba rugi", "Arus kas"],
    kpis: [
      { label: "Template tersimpan", value: "14", tone: "plain" },
      { label: "Dijalankan 30 hari", value: "212", tone: "plain" },
      { label: "Punya baris eliminasi", value: "2", tone: "good" },
      { label: "Periode terakhir tertutup", value: "Juli 2026", tone: "warn" }
    ],
    columns: [
      { k: "nama", label: "Template" },
      { k: "jenis", label: "Jenis", tag: true },
      { k: "scope", label: "Cakupan", w: "110px" },
      { k: "basis", label: "Basis", w: "90px" },
      { k: "run", label: "Terakhir", w: "130px" },
      { k: "st", label: "Status", tag: true }
    ],
    rows: [
      { nama: "Neraca konsolidasi 14 unit", jenis: ["Neraca", "info"], scope: "Semua", basis: "Akrual", run: "13/09 06:10", st: ["Aktif", "good"], _unit: "HO" },
      { nama: "Laba rugi konsolidasi (dengan baris eliminasi)", jenis: ["Laba rugi", "plain"], scope: "Semua", basis: "Akrual", run: "13/09 06:10", st: ["Aktif", "good"], _unit: "HO" },
      { nama: "Laba rugi per toko", jenis: ["Laba rugi", "plain"], scope: "13 toko", basis: "Akrual", run: "13/09 06:12", st: ["Aktif", "good"], _unit: "HO" },
      { nama: "Laba rugi HO", jenis: ["Laba rugi", "plain"], scope: "HO", basis: "Akrual", run: "13/09 06:12", st: ["Aktif", "good"], _unit: "HO" },
      { nama: "Arus kas metode langsung", jenis: ["Arus kas", "info"], scope: "Semua", basis: "Kas", run: "12/09 22:00", st: ["Aktif", "good"], _unit: "HO" },
      { nama: "AP ageing 5 ember", jenis: ["Saldo", "plain"], scope: "HO", basis: "Akrual", run: "13/09 07:00", st: ["Aktif", "good"], _unit: "HO" },
      { nama: "Neraca saldo per counterparty", jenis: ["Saldo", "plain"], scope: "Semua", basis: "Akrual", run: "13/09 07:00", st: ["Aktif", "good"], _unit: "HO" },
      { nama: "Bank reconciliation statement", jenis: ["Jembatan", "info"], scope: "HO", basis: "Kas", run: "13/09 07:05", st: ["Aktif", "good"], _unit: "HO" },
      { nama: "Penjualan per tender per toko", jenis: ["Operasional", "plain"], scope: "13 toko", basis: "Kas", run: "13/09 06:30", st: ["Aktif", "good"], _unit: "HO" },
      { nama: "Beban per kelas per unit", jenis: ["Operasional", "plain"], scope: "Semua", basis: "Akrual", run: "13/09 06:30", st: ["Aktif", "good"], _unit: "HO" },
      { nama: "Perbandingan 13 toko", jenis: ["Operasional", "plain"], scope: "13 toko", basis: "Akrual", run: "12/09 22:10", st: ["Aktif", "good"], _unit: "HO" },
      { nama: "Ringkasan manajemen bulanan", jenis: ["Paket", "info"], scope: "Semua", basis: "Akrual", run: "01/09 08:00", st: ["Aktif", "good"], _unit: "HO" },
      { nama: "Laba rugi per toko (revisi kategori COA)", jenis: ["Laba rugi", "plain"], scope: "13 toko", basis: "Akrual", run: "—", st: ["DRAFT · menunggu perbaikan A2", "warn"], _unit: "HO" },
      { nama: "Neraca per unit (roll-up beban usaha lainnya)", jenis: ["Neraca", "info"], scope: "Semua", basis: "Akrual", run: "13/09 06:10", st: ["Roll-up salah · 7020310 di root 7", "bad"], _unit: "HO" }
    ],
    actions: [
      { label: "Buat template", primary: true, form: "F_TEMPLATE" },
      { label: "Jalankan", form: null },
      { label: "Ekspor", form: null }
    ],
    note: "Account Category ERPNext dipakai sebagai tag roll-up laporan — untuk 7.528 akun ia bernilai lebih dari apa pun di menu ini. Satu template salah roll-up karena 7020310 hang di root 7, bukan di 70103."
  },

  "/finance/ledger": {
    title: "Ledger",
    kind: "report",
    group: "Reports",
    store: false,
    job: "Neraca saldo sebelum akun dipilih, dan buku besar sesudahnya.",
    why: "Layar lama 'Cash transactions' — satu baris per baris jurnal — bukan baris menu sendiri: itu layar ini yang belum dipilih akunnya. Dua puluh enam filter adalah titik perluasannya.",
    erp: "Trial Balance + General Ledger",
    status: "live",
    toolbar: ["unit", "period", "asof", "search"],
    kpis: [
      { label: "Total debit", value: "Rp 41.286.430.000", tone: "plain" },
      { label: "Total kredit", value: "Rp 41.286.430.000", tone: "plain" },
      { label: "Selisih", value: "Rp 0", tone: "good" },
      { label: "Akun bergerak bulan ini", value: "412", tone: "plain" }
    ],
    columns: [
      { k: "kode", label: "Kode", w: "130px", mono: true },
      { k: "nama", label: "Akun" },
      { k: "unit", label: "Unit", w: "90px" },
      { k: "dr", label: "Debit", num: true },
      { k: "cr", label: "Kredit", num: true },
      { k: "saldo", label: "Saldo", num: true }
    ],
    rows: [
      { kode: "1011001001", nama: "CASH ON HAND", unit: "Semua", dr: "1.284.600.000", cr: "1.244.285.000", saldo: "40.315.000", _unit: "HO" },
      { kode: "1011001002", nama: "PETTY CASH", unit: "Semua", dr: "86.400.000", cr: "52.673.000", saldo: "33.727.000", _unit: "HO" },
      { kode: "1011001003", nama: "MODAL KASIR", unit: "Semua", dr: "65.000.000", cr: "0", saldo: "65.000.000", _unit: "HO" },
      { kode: "1011002001", nama: "CASH IN BANK GIRO — BCA", unit: "HO", dr: "4.862.300.000", cr: "4.318.740.000", saldo: "543.560.000", _unit: "HO" },
      { kode: "1011101002", nama: "PIUTANG DEBIT CARD", unit: "Semua", dr: "486.200.000", cr: "452.900.000", saldo: "33.300.000", _unit: "HO" },
      { kode: "1011201", nama: "Persediaan Barang Dagang", unit: "Semua", dr: "12.486.300.000", cr: "8.942.100.000", saldo: "3.544.200.000", _unit: "HO" },
      { kode: "1021401", nama: "PIUTANG AFFILIASI PEMBIAYAAN", unit: "Semua", dr: "4.284.600.000", cr: "227.140.000", saldo: "4.057.460.000", _unit: "HO" },
      { kode: "2012001001", nama: "HUTANG SUPPLIER BARANG DAGANGAN", unit: "HO", dr: "1.842.600.000", cr: "2.334.195.000", saldo: "-491.595.000", _unit: "HO" },
      { kode: "2012001003", nama: "HUTANG SUPPLIER NON BARANG DAGANG", unit: "HO", dr: "128.400.000", cr: "158.400.000", saldo: "-30.000.000", _unit: "HO" },
      { kode: "2012002001", nama: "OUTSTANDING GIRO — BCA", unit: "HO", dr: "386.000.000", cr: "566.000.000", saldo: "-180.000.000", _unit: "HO" },
      { kode: "2012301", nama: "HUTANG AFFILIASI PEMBIAYAAN", unit: "Semua", dr: "227.140.000", cr: "4.284.600.000", saldo: "-4.057.460.000", _unit: "HO" },
      { kode: "4010110", nama: "Penjualan Tunai", unit: "13 toko", dr: "0", cr: "3.842.600.000", saldo: "-3.842.600.000", _unit: "C001" },
      { kode: "6010111", nama: "BIAYA PEGAWAI OPERATION", unit: "13 toko", dr: "4.128.400.000", cr: "0", saldo: "4.128.400.000", _unit: "C001" },
      { kode: "8010110002", nama: "Selisih pembulatan", unit: "13 toko", dr: "1.284.000", cr: "3.462.000", saldo: "-2.178.000", _unit: "C001" }
    ],
    actions: [
      { label: "Pilih akun", primary: true, form: null },
      { label: "Simpan sebagai template", form: "F_TEMPLATE" },
      { label: "Ekspor", form: null }
    ],
    note: "Piutang afiliasi (4.057.460.000) dan utang afiliasi (-4.057.460.000) saling menghapus persis — itulah bentuk kontrol 'matriks net nol' yang dibaca Integrity checks."
  },

  "/finance/stock-value": {
    title: "Stock value",
    kind: "report",
    group: "Reports",
    store: false,
    job: "Nilai persediaan per unit dan per kelas, BDP yang menua, dan selisih hitung versus buku.",
    why: "Menggantikan seluruh menu 'Inventory accounting' — UI stok kedua adalah tempat kedua stok berubah. Isi finansialnya cuma tiga dan ketiganya DIBACA lalu diputuskan, bukan dicatat: keyboardnya ada di gudang.",
    erp: "Stock Balance",
    status: "branchD",
    toolbar: ["unit", "asof", "search"],
    kpis: [
      { label: "Nilai persediaan 14 unit", value: "Rp 3.544.200.000", tone: "plain" },
      { label: "BDP di jalan", value: "Rp 214.720.000", tone: "warn" },
      { label: "Selisih opname", value: "Rp 760.000", tone: "warn" },
      { label: "Pool pernah dihitung", value: "3 dari 112", tone: "bad" }
    ],
    columns: [
      { k: "unit", label: "Unit", w: "90px" },
      { k: "kelas", label: "Kelas" },
      { k: "qty", label: "Qty", num: true },
      { k: "value", label: "Nilai", num: true },
      { k: "bdp", label: "BDP di jalan", num: true },
      { k: "vari", label: "Selisih opname", num: true },
      { k: "st", label: "Status", tag: true }
    ],
    rows: [
      { unit: "HO (DC)", kelas: "Barang dagang", qty: "184.620", value: "2.486.300.000", bdp: "342.100.000", vari: "0", st: ["Cocok", "good"], _unit: "HO" },
      { unit: "C006", kelas: "Barang dagang", qty: "13.860", value: "186.400.000", bdp: "28.900.000", vari: "480.000", st: ["Selisih opname", "warn"], _unit: "C006" },
      { unit: "C001", kelas: "Barang dagang", qty: "12.480", value: "168.400.000", bdp: "24.600.000", vari: "-1.240.000", st: ["Selisih opname", "warn"], _unit: "C001" },
      { unit: "C005", kelas: "Barang dagang", qty: "11.320", value: "152.700.000", bdp: "31.800.000", vari: "—", st: ["Belum pernah dihitung", "bad"], _unit: "C005" },
      { unit: "C011", kelas: "Barang dagang", qty: "10.480", value: "142.300.000", bdp: "21.600.000", vari: "—", st: ["Belum pernah dihitung", "bad"], _unit: "C011" },
      { unit: "C009", kelas: "Barang dagang", qty: "9.760", value: "128.900.000", bdp: "6.820.000", vari: "—", st: ["Belum pernah dihitung", "bad"], _unit: "C009" },
      { unit: "C013", kelas: "Barang dagang", qty: "9.580", value: "126.400.000", bdp: "18.900.000", vari: "—", st: ["Belum pernah dihitung", "bad"], _unit: "C013" },
      { unit: "C002", kelas: "Barang dagang", qty: "9.240", value: "124.800.000", bdp: "18.200.000", vari: "0", st: ["Cocok", "good"], _unit: "C002" },
      { unit: "C010", kelas: "Barang dagang", qty: "8.940", value: "116.700.000", bdp: "0", vari: "—", st: ["Belum pernah dihitung", "bad"], _unit: "C010" },
      { unit: "C003", kelas: "Barang dagang", qty: "8.670", value: "112.300.000", bdp: "0", vari: "0", st: ["Cocok", "good"], _unit: "C003" },
      { unit: "C007", kelas: "Barang dagang", qty: "8.120", value: "104.200.000", bdp: "0", vari: "—", st: ["Belum pernah dihitung", "bad"], _unit: "C007" },
      { unit: "C004", kelas: "Barang dagang", qty: "7.940", value: "98.600.000", bdp: "12.400.000", vari: "—", st: ["Belum pernah dihitung", "bad"], _unit: "C004" },
      { unit: "C008", kelas: "Barang dagang", qty: "7.480", value: "94.600.000", bdp: "9.400.000", vari: "—", st: ["BDP lebih dari 14 hari", "warn"], _unit: "C008" },
      { unit: "C012", kelas: "Barang dagang", qty: "7.240", value: "89.400.000", bdp: "0", vari: "—", st: ["Belum pernah dihitung", "bad"], _unit: "C012" },
      { unit: "Semua", kelas: "Kantong belanja", qty: "48.600", value: "38.200.000", bdp: "0", vari: "0", st: ["Cocok", "good"], _unit: "HO" }
    ],
    actions: [
      { label: "Ekspor nilai persediaan", form: null },
      { label: "Buka di Inventory", form: null }
    ],
    note: "Nilai stok masih belum punya kabel penuh ke buku besar: COGS tidak ditulis siapa pun sampai keputusan §11.2 diambil. Tiga dari 112 pool yang pernah dihitung adalah angka sebenarnya, bukan contoh."
  },

  "/finance/integrity": {
    title: "Integrity checks",
    kind: "report",
    group: "Reports",
    store: false,
    job: "Sepuluh persamaan kontrol yang dijalankan malam hari, dan yang gagal disebut namanya.",
    why: "Bukan grup dan bukan tab: ia dijalankan malam hari, tidak dibuka dari dalam layar lain. 'Reposts' tidak ikut — kita tidak pernah menyimpan saldo, jadi tidak ada yang perlu di-repost.",
    erp: "Ledger Health + Invalid Ledger Entries",
    status: "branchD",
    toolbar: ["asof"],
    kpis: [
      { label: "Lolos", value: "8 dari 10", tone: "warn" },
      { label: "Gagal", value: "2", tone: "bad" },
      { label: "Run terakhir", value: "13/09 03:00", tone: "plain" },
      { label: "Gagal sejak", value: "05/09/2026", tone: "bad" }
    ],
    columns: [
      { k: "no", label: "#", w: "50px" },
      { k: "eq", label: "Persamaan kontrol" },
      { k: "scope", label: "Cakupan", w: "120px" },
      { k: "last", label: "Terakhir lolos", w: "120px" },
      { k: "diff", label: "Selisih / jumlah", num: true },
      { k: "st", label: "Hasil", tag: true }
    ],
    rows: [
      { no: "1", eq: "Debit sama dengan kredit di setiap jurnal", scope: "Semua unit", last: "13/09 03:00", diff: "0", st: ["Lolos", "good"], _unit: "HO" },
      { no: "2", eq: "Debit sama dengan kredit PER UNIT di setiap jurnal", scope: "Semua unit", last: "13/09 03:00", diff: "0", st: ["Lolos", "good"], _unit: "HO" },
      { no: "3", eq: "Sub-ledger terutang sama dengan saldo GL per (arti, qualifier, site)", scope: "trade_payable", last: "05/09 03:00", diff: "4.318.500", st: ["Gagal", "bad"], _unit: "HO" },
      { no: "4", eq: "Matriks afiliasi net nol lintas 14 unit", scope: "1021401 / 2012301", last: "13/09 03:00", diff: "0", st: ["Lolos", "good"], _unit: "HO" },
      { no: "5", eq: "Setiap baris jurnal menyebut dokumen yang sudah di-submit", scope: "Semua unit", last: "13/09 03:00", diff: "0", st: ["Lolos", "good"], _unit: "HO" },
      { no: "6", eq: "Setiap arti yang dipakai kode punya akun terpeta", scope: "35 arti", last: "—", diff: "3", st: ["Gagal", "bad"], _unit: "HO" },
      { no: "7", eq: "Giro outstanding sama dengan giro belum cair per bank penerbit", scope: "5 bank", last: "13/09 03:00", diff: "0", st: ["Lolos", "good"], _unit: "HO" },
      { no: "8", eq: "Kas toko nol pada tutup hari (setoran hari yang sama)", scope: "13 toko", last: "13/09 03:00", diff: "0", st: ["Lolos", "good"], _unit: "HO" },
      { no: "9", eq: "Piutang acquirer sama dengan bruto belum settle per acquirer", scope: "5 acquirer", last: "13/09 03:00", diff: "0", st: ["Lolos", "good"], _unit: "HO" },
      { no: "10", eq: "Modal kasir tetap: tidak ada pergerakan selain penempatan dari HO", scope: "13 toko", last: "13/09 03:00", diff: "0", st: ["Lolos", "good"], _unit: "HO" }
    ],
    actions: [
      { label: "Jalankan sekarang", primary: true, form: null },
      { label: "Buka daftar perhatian", form: null }
    ],
    note: "Kontrol 6 gagal karena `cash_variance` — tiga posting cash-count tertahan. Kontrol 3 gagal sejak 5 September. Temuan yang belum jadi persamaan: cadangan penggantian OE (1.008 daun) tidak pernah bergerak sejak go-live — sengaja, dan justru karena itu dicatat di sini."
  },

  "/finance/accounts": {
    title: "Chart of accounts",
    kind: "setting",
    group: "Setup",
    store: false,
    job: "7.528 akun klien, dengan AKTIF dan IZIN POSTING sebagai dua kolom yang berbeda.",
    why: "Batas 300 baris dan tiga pilihan unit dihapus. Pencarinya WAJIB menampilkan kode: 152 nama daun payroll toko dan kantor byte-identik, dan 43% nama grup berbeda dari nama daunnya.",
    erp: "Chart of Accounts",
    status: "live",
    toolbar: ["unit", "search", "segmented"],
    segments: ["Semua", "Aktif", "Nonaktif", "Anomali"],
    kpis: [
      { label: "Akun", value: "7.528", tone: "plain" },
      { label: "Daun postable", value: "6.908", tone: "plain" },
      { label: "Nonaktif", value: "104", tone: "warn" },
      { label: "Pilihan di pemilih (kubus)", value: "376", tone: "good" }
    ],
    columns: [
      { k: "kode", label: "Kode", w: "110px", mono: true },
      { k: "nama", label: "Keluarga" },
      { k: "leaves", label: "Daun", num: true },
      { k: "sub", label: "Sub-akun", num: true },
      { k: "inact", label: "Nonaktif", num: true },
      { k: "post", label: "Izin posting", tag: true },
      { k: "st", label: "Aktif", tag: true }
    ],
    rows: [
      { kode: "1011001", nama: "CASH ON HAND (3 pot toko)", leaves: "42", sub: "3", inact: "0", post: ["Boleh", "good"], st: ["Aktif", "good"], _unit: "HO" },
      { kode: "1011002", nama: "CASH IN BANK GIRO", leaves: "70", sub: "5", inact: "1", post: ["Boleh", "good"], st: ["Aktif", "good"], _unit: "HO" },
      { kode: "1011101", nama: "PIUTANG DAGANG (kartu)", leaves: "28", sub: "2", inact: "0", post: ["Boleh", "good"], st: ["Aktif", "good"], _unit: "HO" },
      { kode: "1011203", nama: "Barang Dalam Perjalanan Barang Dagangan", leaves: "196", sub: "14", inact: "2", post: ["Boleh · matriks 14x14", "info"], st: ["Aktif", "good"], _unit: "HO" },
      { kode: "1021401", nama: "PIUTANG AFFILIASI PEMBIAYAAN", leaves: "196", sub: "14", inact: "0", post: ["Boleh · matriks 14x14", "info"], st: ["Aktif", "good"], _unit: "HO" },
      { kode: "1021507", nama: "Operating Equipment (36 jenis fixture)", leaves: "504", sub: "36", inact: "1", post: ["Boleh", "good"], st: ["Aktif", "good"], _unit: "HO" },
      { kode: "1021607", nama: "Reserve Replacement — Operating Equipment", leaves: "504", sub: "36", inact: "0", post: ["Aturan OFF", "plain"], st: ["Aktif · tidur", "plain"], _unit: "HO" },
      { kode: "2012001", nama: "HUTANG SUPPLIER (barang · suspend · non-barang)", leaves: "42", sub: "3", inact: "0", post: ["Boleh", "good"], st: ["Aktif", "good"], _unit: "HO" },
      { kode: "2012002", nama: "OUTSTANDING GIRO (5 bank penerbit)", leaves: "70", sub: "5", inact: "0", post: ["Boleh", "good"], st: ["Aktif", "good"], _unit: "HO" },
      { kode: "2012201", nama: "ACCRUED EXPENSE (YMHD, 10 jenis)", leaves: "140", sub: "10", inact: "1", post: ["Boleh", "good"], st: ["Aktif", "good"], _unit: "HO" },
      { kode: "4010113", nama: "Penjualan Online", leaves: "28", sub: "2", inact: "26", post: ["Boleh · hanya C013", "warn"], st: ["Aktif di 1 unit", "warn"], _unit: "C013" },
      { kode: "6010111", nama: "BIAYA PEGAWAI OPERATION (13 komponen)", leaves: "182", sub: "13", inact: "68", post: ["Boleh", "good"], st: ["Aktif · 68 daun mati", "warn"], _unit: "HO" },
      { kode: "7020310", nama: "BIAYA USAHA LAINNYA (induk salah)", leaves: "42", sub: "3", inact: "0", post: ["Boleh", "good"], st: ["Menggantung di root 7", "bad"], _unit: "HO" },
      { kode: "204001", nama: "Giro Keluar (off-ladder, 6 digit)", leaves: "1", sub: "0", inact: "0", post: ["Boleh", "good"], st: ["Off-ladder", "warn"], _unit: "HO" },
      { kode: "600104", nama: "Pendapatan lain-lain (off-ladder, 6 digit)", leaves: "1", sub: "0", inact: "0", post: ["Tidak boleh", "bad"], st: ["Yatim · induk root beban 6", "bad"], _unit: "HO" }
    ],
    actions: [
      { label: "Tambah akun", primary: true, form: "F_ACCOUNT" },
      { label: "Ubah izin posting", form: null },
      { label: "Nonaktifkan", form: null }
    ],
    note: "Pemilih akun adalah KUBUS, bukan daftar: 376 pilihan (keluarga x qualifier), bukan 6.902 daun — unit dipilih di tempat lain dan disusun mesin. Tiga anomali bagan masih terbuka: 7020310 di root salah, 102160400305 diberi label C006 padahal sufiksnya 05, dan 600104 adalah akun pendapatan di bawah root beban."
  },

  "/finance/account-map": {
    title: "Account map",
    kind: "setting",
    group: "Setup",
    store: false,
    job: "Memetakan arti semantik kali site kali qualifier ke kode akun — dan menolak posting untuk arti yang belum terpeta.",
    why: "Menggantikan 30-an field `default_*_account` milik ERPNext. Resolver punya tiga keluaran dan tidak pernah memilih sendiri: DUA kecocokan sama kerasnya dengan NOL kecocokan. Merah, bukan amber: arti tak terpeta menolak posting, itu penghentian bukan antrean.",
    erp: "— (tak ada padanan)",
    status: "live",
    toolbar: ["unit", "search", "segmented"],
    segments: ["Semua", "Terpeta", "Belum terpeta", "Ambigu"],
    kpis: [
      { label: "Arti terdeklarasi", value: "34", tone: "plain" },
      { label: "Arti dipakai kode", value: "35", tone: "warn" },
      { label: "Belum terpeta", value: "1", tone: "bad" },
      { label: "Binding aktif", value: "486", tone: "plain" }
    ],
    columns: [
      { k: "meaning", label: "Arti", w: "200px", mono: true },
      { k: "unit", label: "Unit", w: "80px" },
      { k: "qualifier", label: "Qualifier", w: "150px" },
      { k: "account", label: "Akun", w: "150px", mono: true },
      { k: "state", label: "Keadaan", tag: true }
    ],
    rows: [
      { meaning: "cash_variance", unit: "—", qualifier: "—", account: "—", state: ["Belum terpeta", "bad"], _unit: "HO" },
      { meaning: "qris_receivable", unit: "C006", qualifier: "BCA", account: "101110100207", state: ["Meminjam akun debit", "warn"], _unit: "C006" },
      { meaning: "trade_payable", unit: "HO", qualifier: "—", account: "201200100100", state: ["Terpeta", "good"], _unit: "HO" },
      { meaning: "trade_payable", unit: "C006", qualifier: "—", account: "201200100107", state: ["Terpeta", "good"], _unit: "C006" },
      { meaning: "non_merchandise_payable", unit: "HO", qualifier: "—", account: "201200100300", state: ["Terpeta", "good"], _unit: "HO" },
      { meaning: "cash", unit: "C006", qualifier: "—", account: "101100100107", state: ["Terpeta", "good"], _unit: "C006" },
      { meaning: "petty_cash", unit: "C006", qualifier: "—", account: "101100100207", state: ["Terpeta", "good"], _unit: "C006" },
      { meaning: "cashier_float", unit: "C006", qualifier: "—", account: "101100100307", state: ["Terpeta", "good"], _unit: "C006" },
      { meaning: "bank_giro", unit: "HO", qualifier: "BCA", account: "101100200100", state: ["Terpeta", "good"], _unit: "HO" },
      { meaning: "bank_giro", unit: "HO", qualifier: "Danamon", account: "101100200500", state: ["Terpeta", "good"], _unit: "HO" },
      { meaning: "bank_savings", unit: "HO", qualifier: "BTN", account: "101100300500", state: ["Terpeta", "good"], _unit: "HO" },
      { meaning: "giro_outstanding", unit: "HO", qualifier: "BCA", account: "201200200100", state: ["Terpeta", "good"], _unit: "HO" },
      { meaning: "card_receivable_debit", unit: "C006", qualifier: "BCA", account: "101110100207", state: ["Terpeta", "good"], _unit: "C006" },
      { meaning: "card_receivable_credit", unit: "C006", qualifier: "Visa/Master", account: "101110100107", state: ["Terpeta", "good"], _unit: "C006" },
      { meaning: "card_fee", unit: "C006", qualifier: "BCA", account: "601011000207", state: ["Terpeta", "good"], _unit: "C006" },
      { meaning: "affiliate_payable", unit: "C006", qualifier: "PEMBIAYAAN:HO", account: "201230100107", state: ["Terpeta", "good"], _unit: "C006" },
      { meaning: "affiliate_receivable", unit: "HO", qualifier: "PEMBIAYAAN:C006", account: "102140100107", state: ["Terpeta", "good"], _unit: "HO" },
      { meaning: "payroll_payable", unit: "HO", qualifier: "—", account: "201220100100", state: ["Terpeta", "good"], _unit: "HO" },
      { meaning: "payroll_expense", unit: "ho", qualifier: "office", account: "—", state: ["Site `ho` tidak ada", "bad"], _unit: "HO" },
      { meaning: "pph23_payable", unit: "HO", qualifier: "—", account: "201210100300", state: ["Terpeta", "good"], _unit: "HO" },
      { meaning: "employee_receivable", unit: "C006", qualifier: "—", account: "101110200107", state: ["Terpeta", "good"], _unit: "C006" },
      { meaning: "store_head_receivable", unit: "C006", qualifier: "—", account: "101110200207", state: ["Terpeta", "good"], _unit: "C006" }
    ],
    actions: [
      { label: "Petakan arti", primary: true, form: "F_MAP" },
      { label: "Lihat riwayat binding", form: null }
    ],
    note: "Cacat hidup: `cash_variance` dipakai cash_counts.rs:33 tapi tidak dideklarasikan di required_semantic_keys() — peta tidak melihatnya, Period close mengira lengkap, lalu posting cash-count gagal. Perbaikannya dua baris. Koreksi selalu binding BARU dengan valid_from/valid_to/version, tidak pernah edit di tempat."
  },

  "/finance/posting-rules": {
    title: "Posting rules",
    kind: "setting",
    group: "Setup",
    store: false,
    job: "Aturan posting sebagai objek: bukti, kesiapan, aktivasi — termasuk yang sengaja dimatikan.",
    why: "Ini separuh yang menanggung beban, dan layar terbaiknya dulu tidak punya rute sama sekali — itulah sebabnya tiga aturan bisa OFF dengan sengaja tanpa ada yang bisa melihatnya. Harness yang lebih permisif dari produksi tidak membuktikan apa pun.",
    erp: "— (tak ada padanan)",
    status: "new",
    toolbar: ["search", "segmented"],
    segments: ["Aktif", "Terblokir", "Sengaja OFF"],
    kpis: [
      { label: "Paket aturan", value: "15", tone: "plain" },
      { label: "Aktif", value: "9", tone: "good" },
      { label: "Terblokir", value: "3", tone: "bad" },
      { label: "Sengaja OFF", value: "3", tone: "plain" }
    ],
    columns: [
      { k: "paket", label: "Paket aturan", w: "220px", mono: true },
      { k: "evidence", label: "Bukti", tag: true },
      { k: "readiness", label: "Kesiapan", tag: true },
      { k: "activation", label: "Aktivasi", tag: true },
      { k: "domain", label: "Domain", w: "130px" },
      { k: "ver", label: "Versi", w: "70px" }
    ],
    rows: [
      { paket: "supplier_bill/1", evidence: ["ACTUAL_JOURNAL", "good"], readiness: ["Siap", "good"], activation: ["Aktif", "good"], domain: "Payables", ver: "v3", _unit: "HO" },
      { paket: "supplier_payment/1", evidence: ["ACTUAL_JOURNAL", "good"], readiness: ["Siap", "good"], activation: ["Aktif", "good"], domain: "Payments", ver: "v4", _unit: "HO" },
      { paket: "cash_document/1", evidence: ["ACTUAL_JOURNAL", "good"], readiness: ["Siap", "good"], activation: ["Aktif", "good"], domain: "Payments", ver: "v2", _unit: "HO" },
      { paket: "bank_line/1", evidence: ["ACTUAL_JOURNAL", "good"], readiness: ["Siap", "good"], activation: ["Aktif", "good"], domain: "Cash & Bank", ver: "v2", _unit: "HO" },
      { paket: "depreciation/1", evidence: ["ACTUAL_JOURNAL", "good"], readiness: ["Siap", "good"], activation: ["Aktif", "good"], domain: "Assets", ver: "v2", _unit: "HO" },
      { paket: "store_expense/1", evidence: ["ACTUAL_JOURNAL", "good"], readiness: ["Siap", "good"], activation: ["Aktif", "good"], domain: "Store money", ver: "v1", _unit: "HO" },
      { paket: "giro/1", evidence: ["CLIENT_STATEMENT", "info"], readiness: ["Siap", "good"], activation: ["Aktif", "good"], domain: "Payables", ver: "v2", _unit: "HO" },
      { paket: "acq_settlement/1", evidence: ["CLIENT_STATEMENT", "info"], readiness: ["Siap", "good"], activation: ["Aktif", "good"], domain: "Receivables", ver: "v2", _unit: "HO" },
      { paket: "interunit/1", evidence: ["COA_ONLY", "warn"], readiness: ["Siap", "good"], activation: ["Aktif", "good"], domain: "Inter-unit", ver: "v3", _unit: "HO" },
      { paket: "cash_count/1", evidence: ["ACTUAL_JOURNAL", "good"], readiness: ["Butuh akun `cash_variance`", "warn"], activation: ["Terblokir", "bad"], domain: "Cash & Bank", ver: "v1", _unit: "HO" },
      { paket: "sale_day/1", evidence: ["CLIENT_STATEMENT", "info"], readiness: ["Butuh keputusan §11.2 + `revenue_qris`", "warn"], activation: ["Terblokir", "bad"], domain: "Store money", ver: "v1", _unit: "HO" },
      { paket: "payroll/1", evidence: ["CLIENT_STATEMENT", "info"], readiness: ["Butuh site `ho` di peta", "warn"], activation: ["Terblokir", "bad"], domain: "Payroll", ver: "v1", _unit: "HO" },
      { paket: "oe_replacement_reserve/1", evidence: ["COA_ONLY", "warn"], readiness: ["Siap", "good"], activation: ["Sengaja OFF", "plain"], domain: "Assets", ver: "—", _unit: "HO" },
      { paket: "grni_accrual/1", evidence: ["PROPOSAL", "plain"], readiness: ["Tanpa akun — klien tidak punya GRNI", "bad"], activation: ["Sengaja OFF", "plain"], domain: "Payables", ver: "—", _unit: "HO" },
      { paket: "interunit_settle/1", evidence: ["PROPOSAL", "plain"], readiness: ["Tanpa penulis", "bad"], activation: ["Sengaja OFF", "plain"], domain: "Inter-unit", ver: "—", _unit: "HO" }
    ],
    actions: [
      { label: "Buka kontrak aturan", primary: true, form: "F_RULE" },
      { label: "Aktifkan paket", form: null },
      { label: "Lihat bukti uji", form: null },
      { label: "Catat caveat", form: "F_CAVEAT" }
    ],
    note: "Tiga aturan mati dengan sengaja dan alasannya tertulis: cadangan penggantian OE dibebankan langsung (keputusan pemilik), GRNI tidak ada dan tidak diadakan, dan pelunasan antarunit menolak sampai ada yang menulis kaki keduanya. Delapan skenario akseptansi bukan layar — mereka uji Rust."
  },

  "/finance/payment-terms": {
    title: "Payment terms",
    kind: "setting",
    group: "Setup",
    store: false,
    job: "Termin pembayaran dan template termin — karena satu tagihan bisa jatuh tempo lebih dari sekali.",
    why: "`next_due_date` kami adalah cicilan belum dibayar yang PALING AWAL; ERPNext memakai max(). Itu perbedaan yang disengaja: yang menagih perhatian adalah yang jatuh duluan, bukan yang terakhir.",
    erp: "Payment Term + Payment Terms Template",
    status: "partial",
    toolbar: ["search"],
    kpis: [
      { label: "Termin", value: "12", tone: "plain" },
      { label: "Template", value: "5", tone: "plain" },
      { label: "Belum pernah dipakai", value: "2", tone: "plain" },
      { label: "Tagihan dengan cicilan", value: "18", tone: "plain" }
    ],
    columns: [
      { k: "nama", label: "Termin" },
      { k: "basis", label: "Basis", tag: true },
      { k: "hari", label: "Hari", num: true },
      { k: "porsi", label: "Porsi", w: "80px" },
      { k: "tpl", label: "Template" },
      { k: "used", label: "Pernah dipakai", tag: true }
    ],
    rows: [
      { nama: "Net 30", basis: ["DAYS_AFTER_BILL", "plain"], hari: "30", porsi: "100%", tpl: "Standar Pemasok Barang", used: ["Dipakai", "good"], _unit: "HO" },
      { nama: "Net 45", basis: ["DAYS_AFTER_BILL", "plain"], hari: "45", porsi: "100%", tpl: "Standar Pemasok Barang", used: ["Dipakai", "good"], _unit: "HO" },
      { nama: "Net 14", basis: ["DAYS_AFTER_BILL", "plain"], hari: "14", porsi: "100%", tpl: "Utilitas", used: ["Dipakai", "good"], _unit: "HO" },
      { nama: "30% di muka", basis: ["DAYS_AFTER_BILL", "plain"], hari: "0", porsi: "30%", tpl: "Garment Kontrak", used: ["Dipakai", "good"], _unit: "HO" },
      { nama: "70% 60 hari", basis: ["DAYS_AFTER_BILL", "plain"], hari: "60", porsi: "70%", tpl: "Garment Kontrak", used: ["Dipakai", "good"], _unit: "HO" },
      { nama: "50/50 — bagian 1", basis: ["DAYS_AFTER_BILL", "plain"], hari: "15", porsi: "50%", tpl: "Ekspedisi", used: ["Dipakai", "good"], _unit: "HO" },
      { nama: "50/50 — bagian 2", basis: ["DAYS_AFTER_BILL", "plain"], hari: "45", porsi: "50%", tpl: "Ekspedisi", used: ["Dipakai", "good"], _unit: "HO" },
      { nama: "Akhir bulan + 10", basis: ["DAYS_AFTER_MONTH_END", "info"], hari: "10", porsi: "100%", tpl: "Jasa Bulanan", used: ["Dipakai", "good"], _unit: "HO" },
      { nama: "Akhir bulan + 45 (giro)", basis: ["DAYS_AFTER_MONTH_END", "info"], hari: "45", porsi: "100%", tpl: "Giro Pemasok", used: ["Dipakai", "good"], _unit: "HO" },
      { nama: "Tunai saat terima", basis: ["DAYS_AFTER_BILL", "plain"], hari: "0", porsi: "100%", tpl: "—", used: ["Dipakai", "good"], _unit: "HO" },
      { nama: "Akhir bulan + 30", basis: ["DAYS_AFTER_MONTH_END", "info"], hari: "30", porsi: "100%", tpl: "Jasa Bulanan (usulan)", used: ["Belum pernah", "plain"], _unit: "HO" },
      { nama: "Net 90", basis: ["DAYS_AFTER_BILL", "plain"], hari: "90", porsi: "100%", tpl: "—", used: ["Belum pernah", "plain"], _unit: "HO" }
    ],
    actions: [
      { label: "Buat termin", primary: true, form: "F_TERM" },
      { label: "Buat template", form: "F_TERM_TPL" },
      { label: "Pensiunkan", form: null }
    ],
    note: "`ever_used` menentukan pensiun versus hapus: termin yang pernah menyentuh satu tagihan pun tidak boleh hilang, karena tagihan itu masih menunjuk padanya. Porsi di dalam satu template selalu berjumlah 100%."
  },

  "/finance/giro-print": {
    title: "Giro printing",
    kind: "setting",
    group: "Setup",
    store: false,
    job: "Koordinat milimeter per bank penerbit dan per versi blanko, dikalibrasi sekali terhadap kertas asli.",
    why: "Setup, bukan pekerjaan: dilakukan sekali terhadap blanko sungguhan lalu tidak dipikirkan lagi — dan kalau salah sekali, ia salah untuk setiap giro yang bank itu cetak.",
    erp: "Cheque Print Template",
    status: "live",
    toolbar: ["search"],
    kpis: [
      { label: "Template", value: "10", tone: "plain" },
      { label: "Terkalibrasi", value: "7", tone: "good" },
      { label: "Belum dikalibrasi", value: "2", tone: "bad" },
      { label: "Belum diuji ke blanko asli", value: "1", tone: "warn" }
    ],
    columns: [
      { k: "bank", label: "Bank penerbit", w: "120px" },
      { k: "blanko", label: "Blanko" },
      { k: "fields", label: "Field", num: true },
      { k: "offx", label: "Offset X (mm)", num: true },
      { k: "offy", label: "Offset Y (mm)", num: true },
      { k: "kal", label: "Kalibrasi", w: "110px" },
      { k: "st", label: "Status", tag: true }
    ],
    rows: [
      { bank: "BCA", blanko: "Bilyet Giro BG-2024", fields: "7", offx: "12,5", offy: "8,0", kal: "04/09/2026", st: ["Terkalibrasi", "good"], _unit: "HO" },
      { bank: "BCA", blanko: "Bilyet Giro BG-2019 (lama)", fields: "7", offx: "12,0", offy: "9,5", kal: "11/02/2025", st: ["Arsip", "plain"], _unit: "HO" },
      { bank: "Mandiri", blanko: "Bilyet Giro BG-2023", fields: "7", offx: "10,0", offy: "7,5", kal: "04/09/2026", st: ["Terkalibrasi", "good"], _unit: "HO" },
      { bank: "Mandiri", blanko: "Bilyet Giro BG-2021 (lama)", fields: "7", offx: "10,0", offy: "6,0", kal: "08/01/2025", st: ["Arsip", "plain"], _unit: "HO" },
      { bank: "BRI", blanko: "Bilyet Giro BG-2025", fields: "7", offx: "14,0", offy: "8,5", kal: "05/09/2026", st: ["Terkalibrasi", "good"], _unit: "HO" },
      { bank: "BNI", blanko: "Bilyet Giro BG-2022", fields: "7", offx: "11,5", offy: "7,0", kal: "05/09/2026", st: ["Belum diuji ke blanko asli", "warn"], _unit: "HO" },
      { bank: "Danamon", blanko: "Bilyet Giro BG-2024", fields: "7", offx: "13,0", offy: "9,0", kal: "—", st: ["Belum dikalibrasi", "bad"], _unit: "HO" },
      { bank: "BCA", blanko: "Amplop giro", fields: "3", offx: "20,0", offy: "25,0", kal: "04/09/2026", st: ["Terkalibrasi", "good"], _unit: "HO" },
      { bank: "Mandiri", blanko: "Amplop giro", fields: "3", offx: "18,0", offy: "24,0", kal: "04/09/2026", st: ["Terkalibrasi", "good"], _unit: "HO" },
      { bank: "BRI", blanko: "Amplop giro", fields: "3", offx: "21,0", offy: "26,0", kal: "—", st: ["Belum dikalibrasi", "bad"], _unit: "HO" }
    ],
    actions: [
      { label: "Kalibrasi", primary: true, form: "F_CALIBRATE" },
      { label: "Cetak halaman uji", form: null },
      { label: "Salin dari bank lain", form: null }
    ],
    note: "Lima bank penerbit, dua bentuk cetak, dan versi blanko lama disimpan sebagai arsip — giro yang sudah dicetak dengan koordinat lama tetap harus bisa dicetak ulang sama persis."
  },

  "/finance/settings": {
    title: "Finance settings",
    kind: "setting",
    group: "Setup",
    store: false,
    job: "Kebijakan yang menyebut Role: ambang, ember ageing, kas negatif, tarif lawan umur, dan siapa yang boleh mengubahnya.",
    why: "Menggantikan tab 'Access & Approvals': izin tidak duduk di layar sendiri, ia jadi kebijakan yang menyebut Role plus RBAC di rute. Menyembunyikan baris Payments dari kepala toko tanpa RBAC adalah kenyamanan yang berpura-pura menjadi kontrol.",
    erp: "Accounts Settings",
    status: "new",
    toolbar: ["search", "segmented"],
    segments: ["Semua", "Ambang", "Perilaku", "Akses"],
    kpis: [
      { label: "Kebijakan", value: "14", tone: "plain" },
      { label: "Menunggu keputusan pemilik", value: "3", tone: "warn" },
      { label: "Rute finance tanpa otorisasi", value: "107", tone: "bad" },
      { label: "Terakhir diubah", value: "07/09/2026", tone: "plain" }
    ],
    columns: [
      { k: "keb", label: "Kebijakan" },
      { k: "nilai", label: "Nilai" },
      { k: "role", label: "Boleh mengubah", w: "170px", mono: true },
      { k: "scope", label: "Berlaku", w: "110px" },
      { k: "st", label: "Status", tag: true }
    ],
    rows: [
      { keb: "Ambang belanja toko tanpa izin HO", nilai: "Rp 500.000", role: "FINANCE_MANAGER", scope: "13 toko", st: ["Berlaku", "good"], _unit: "HO" },
      { keb: "Modal kasir per toko (tetap, sekali)", nilai: "Rp 5.000.000", role: "FINANCE_MANAGER", scope: "13 toko", st: ["Berlaku", "good"], _unit: "HO" },
      { keb: "Ember ageing utang", nilai: "0-30 · 31-60 · 61-90 · 91-120 · >120", role: "FINANCE_MANAGER", scope: "Semua", st: ["Berlaku · data, bukan kode", "good"], _unit: "HO" },
      { keb: "Setoran kas harus hari yang sama", nilai: "Ya — tidak ada akun kas di jalan", role: "SYSTEM_OWNER", scope: "13 toko", st: ["Berlaku", "good"], _unit: "HO" },
      { keb: "Saldo kas negatif", nilai: "Diangkat sebagai eksepsi, tidak ditolak", role: "SYSTEM_OWNER", scope: "Semua", st: ["Menunggu keputusan pemilik §11.4", "warn"], _unit: "HO" },
      { keb: "Ambang pembulatan pencocokan tagihan", nilai: "Rp 1.000 (sementara)", role: "FINANCE_MANAGER", scope: "Payables", st: ["Menunggu keputusan pemilik §11.6", "warn"], _unit: "HO" },
      { keb: "Tarif penyusutan lawan umur", nilai: "120_000 bps per tahun = 1 tahun", role: "FINANCE_MANAGER", scope: "Assets", st: ["Berlaku", "good"], _unit: "HO" },
      { keb: "Maker tidak boleh sama dengan checker", nilai: "Ditegakkan di tabel (CHECK)", role: "SYSTEM_OWNER", scope: "Store money", st: ["Berlaku", "good"], _unit: "HO" },
      { keb: "Koreksi hanya lewat pembalikan", nilai: "Ya, memakai akun asli", role: "SYSTEM_OWNER", scope: "Semua", st: ["Berlaku", "good"], _unit: "HO" },
      { keb: "Kunci periode", nilai: "Selektif per jenis dokumen", role: "FINANCE_MANAGER", scope: "Semua", st: ["Berlaku", "good"], _unit: "HO" },
      { keb: "GRNI", nilai: "Tidak ada dan tidak diadakan", role: "SYSTEM_OWNER", scope: "Payables", st: ["Ditutup, jangan dibuka lagi", "plain"], _unit: "HO" },
      { keb: "Cadangan penggantian OE", nilai: "OFF — penggantian dibebankan langsung", role: "SYSTEM_OWNER", scope: "Assets", st: ["Ditutup, jangan dibuka lagi", "plain"], _unit: "HO" },
      { keb: "Pajak sebagai workspace", nilai: "Di luar cakupan", role: "SYSTEM_OWNER", scope: "Semua", st: ["Ditutup, jangan dibuka lagi", "plain"], _unit: "HO" },
      { keb: "Otorisasi di rute finance", nilai: "Belum ada satu pun", role: "SYSTEM_OWNER", scope: "107 rute", st: ["Belum dipasang", "bad"], _unit: "HO" }
    ],
    actions: [
      { label: "Ubah kebijakan", primary: true, form: "F_POLICY" },
      { label: "Lihat riwayat perubahan", form: null }
    ],
    note: "Hari ini setiap operator terautentikasi bisa memposting jurnal, menutup periode, dan memetakan ulang akun — `audience` di nav menyembunyikan baris, ia tidak memberi izin. RBAC diambil DULUAN, sebelum satu baris pun di-merge."
  }
};
