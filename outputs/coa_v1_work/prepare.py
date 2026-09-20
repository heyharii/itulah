import csv,json,re,collections,pathlib
P=pathlib.Path('/Users/hari/itulah/outputs/coa_v1_work')
src='/Users/hari/Downloads/Laporan_Master_Account1.csv'
proposal='/Users/hari/.codex/attachments/58e6e26b-f8b3-426e-9dc1-760f3c468416/pasted-text.txt'
raw=list(csv.reader(open(src,encoding='utf-8-sig')))
legacy=[{'row':i+1,'code':r[1].strip(),'name':r[2].strip(),'flag':r[3].strip(),'level':r[4].strip()} for i,r in enumerate(raw) if len(r)>4 and r[1].strip().isdigit()]
codes={r['code'] for r in legacy}
parents={c[:n] for c in codes for n in range(1,len(c)) if c[:n] in codes}
bycode={r['code']:r for r in legacy}
for r in legacy:
 c=r['code']; r['has_children']=c in parents
 anc=[c[:n] for n in range(1,len(c)) if c[:n] in codes]
 r['parent']=anc[-1] if anc else ''
 r['unit']= next(iter(re.findall(r'\bC\d{3}\b|\bHO\b',r['name'].upper())), '')
 r['unit_basis']='Nama akun eksplisit; validasi master unit' if r['unit'] else 'Belum ditentukan; jangan infer dari suffix saja'
 r['raw']=raw[r['row']-1]
accounts=[]
for no,code,name in re.findall(r'\|\s*(\d+)\s*\|\s*(\d{7})\s*\|\s*([^|]+)\|',open(proposal).read()):
 if code=='2202001': code='2107001'
 name=name.strip().replace('*','')
 name={'2105009':'Hutang Lain-lain','8101003':'Pendapatan Sewa','6103012':'Biaya Penyisihan Kerugian Piutang'}.get(code,name)
 accounts.append({'code':code,'name':name})
accounts.append({'code':'8201002','name':'Biaya Bunga Leasing'})
accounts.sort(key=lambda a:a['code'])
assert len(accounts)==158 and len({a['code'] for a in accounts})==158

# All rules below are proposed configuration controls, not claims about current client practice.
rules=[]
def rule(id,name,module,manual,required,debit,credit,exclude,recon):
 rules.append([id,name,module,manual,required,debit,credit,exclude,recon])
rule('R01','Kas dan modal kasir','Kas / POS','Terbatas: koreksi disetujui','Entitas, Unit, kas/register, dokumen, tanggal','Penerimaan atau transfer masuk','Pengeluaran atau transfer keluar','Modal kasir adalah aset; bukan modal ekuitas. Transfer kas tidak membentuk pendapatan.','Cash count per kas, shift dan Unit; transfer berpasangan')
rule('R02','Bank dan deposito','Treasury / Bank','Terbatas: koreksi rekonsiliasi','Entitas, rekening aktual, mata uang, Unit/pemilik rekening, referensi bank','Dana masuk / penempatan','Dana keluar / pencairan','Nama bank saja tidak cukup; deposito bukan otomatis setara kas. Pisahkan bunga dari pokok.','Statement per rekening; deposito per sertifikat dan jatuh tempo')
rule('R03','Piutang settlement','POS / Settlement','Tidak langsung; koreksi melalui settlement','Unit, provider/acquirer, batch, metode, tanggal transaksi dan settlement','Nilai tagihan settlement bruto','Pelunasan, refund atau koreksi batch','Fee merchant terpisah; jangan netting penjualan dengan biaya. QRIS/marketplace perlu scope mapping.','Outstanding per provider/batch = saldo GL; aging settlement')
rule('R04','Piutang pegawai / manajemen','Receivable / Payroll','Terbatas dengan party wajib','Unit, party, jenis piutang, jadwal pelunasan, dokumen','Pemberian piutang','Pelunasan atau potongan payroll','Kepala toko/karyawan bisa tumpang tindih; satu transaksi hanya ke satu jenis. Piutang pemilik perlu identitas hukum.','Saldo per party dan aging = GL')
rule('R05','Penyisihan piutang','Closing / Receivable','Ya, berdasarkan perhitungan disetujui','Unit, portfolio/party, dasar estimasi, periode','Pembalikan cadangan atau penggunaan write-off disetujui','Pembentukan / penambahan cadangan','Write-off menggunakan cadangan yang tersedia; jangan membebankan kerugian dua kali.','Roll-forward cadangan; beban 6103012 dan daftar piutang')
rule('R06','Persediaan dan barang dalam perjalanan','Inventory / Procurement','Tidak langsung; adjustment melalui inventory','Unit/gudang, SKU, kuantitas, nilai, receipt/shipment, tanggal','Penerimaan / kepemilikan barang diperoleh','Penjualan ke HPP, transfer keluar, write-off','Potongan pembelian mengurangi cost; biaya inbound yang memenuhi syarat masuk cost. BDP mengikuti kepemilikan, bukan sekadar pesanan.','Valuasi inventory per SKU/gudang = GL; BDP ke dokumen perjalanan')
rule('R07','Penurunan nilai persediaan','Closing / Inventory','Ya, estimasi atau koreksi disetujui','Unit, SKU/kelompok, dasar nilai, periode','Pembalikan atau penggunaan cadangan sesuai kebijakan','Pembentukan cadangan yang didukung evaluasi','Barang hilang aktual perlu adjustment kuantitas; jangan menyisihkan lalu membebankan write-off dua kali.','Roll-forward cadangan dan inventory valuation')
rule('R08','Biaya dibayar dimuka','AP / Prepaid schedule','Terbatas dengan jadwal','Unit, kontrak, tanggal mulai/akhir, jadwal alokasi','Manfaat periode mendatang yang memenuhi syarat','Alokasi periode / pengembalian','Bukan tempat menyimpan biaya tanpa dasar manfaat masa depan.','Saldo jadwal prepaid = GL; review masa manfaat')
rule('R09','Pajak dibayar dimuka / PPN Masukan','Tax / AP','Terbatas: koreksi pajak disetujui','Entitas pajak, jenis pajak, masa/tahun, bukti bayar/faktur','Pembayaran/kredit pajak yang memenuhi syarat','Pengkreditan, kompensasi atau pengembalian','PPh 25 tidak langsung ke beban pajak kini; PPh 21 prepaid ditahan. PPN tidak dapat dikreditkan mengikuti cost/expense.','Rekonsiliasi per masa dan bukti pajak; tidak otomatis netting lintas entitas')
rule('R10','Uang muka pemasok / perjalanan','AP / Advance','Terbatas dengan party dan dokumen','Unit, party, tujuan/PO, jatuh penyelesaian','Pembayaran uang muka','Penyelesaian terhadap invoice/expense atau refund','Uang muka bukan beban/persediaan sampai syarat pengakuan terpenuhi.','Daftar uang muka per party = GL; aging dan settlement')
rule('R11','Piutang / hutang afiliasi','Interunit / Intercompany','Terbatas: jurnal berpasangan','Entitas, Unit, counterpart entity/unit, transaksi pasangan','Piutang bertambah / hutang berkurang','Hutang bertambah / piutang berkurang','Konfirmasi satu badan hukum vs beberapa entitas; klasifikasi lancar/nonlancar belum final. Jangan buat laba internal tanpa kebijakan.','Saldo pasangan dan eliminasi; unmatched item harus ditelusuri')
rule('R12','Aset tetap / software / CIP','Fixed asset / AP','Tidak langsung; koreksi register','Unit, asset/project ID, kategori, biaya, tanggal siap pakai','Kapitalisasi yang memenuhi kebijakan','Disposal / reklasifikasi / transfer','Batas kapitalisasi, HGB, software dan CIP perlu policy. Maintenance rutin ke biaya; CIP dipindah saat siap pakai.','Asset register + CIP schedule = GL per kategori')
rule('R13','Akumulasi penyusutan / amortisasi','Fixed asset closing','Tidak langsung; koreksi register','Unit, asset ID, kategori, umur, metode, periode','Pelepasan akumulasi saat disposal / koreksi','Penyusutan atau amortisasi periodik','HGB tidak otomatis diamortisasi; treatment mengikuti substansi hak dan kebijakan yang dikonfirmasi.','Roll-forward register; pasangan beban dan nilai buku')
rule('R14','Replacement OE belum diputuskan','Ditahan','Tidak diizinkan sebelum keputusan','Kebijakan OE, daftar barang, saldo lama, dasar perhitungan','Ditentukan setelah policy','Ditentukan setelah policy','Jangan membuat cadangan penggantian masa depan secara otomatis.','Tentukan apakah depresiasi, biaya aktual, impairment atau koreksi legacy')
rule('R15','Hutang dagang','AP / Procurement','Tidak langsung; koreksi dengan supplier','Entitas, Unit, supplier, invoice, jatuh tempo, PO/receipt bila relevan','Pembayaran, debit note, retur','Pengakuan invoice / kewajiban barang/jasa','Supplier bukan GL; nonbarang dan barang dipisah sesuai objek transaksi.','Aging AP per supplier/invoice = GL')
rule('R16','Hutang dagang suspense','Procurement / Clearing','Terbatas: koreksi clearing','Unit, PO, receipt, supplier, invoice saat tersedia','Penyelesaian clearing saat invoice match','Penerimaan belum ditagih hanya jika workflow mendukung','Bukan penampung permanen. Arti suspense legacy harus dikonfirmasi sebelum aktif.','Aging unmatched receipts; clearing per dokumen')
rule('R17','Giro keluar','Treasury / AP','Tidak langsung; void/reissue terkontrol','Unit, rekening aktual, nomor giro, penerima, tanggal efektif','Giro cair atau pembatalan dengan reversal','Penerbitan sesuai event kewajiban pada workflow','Tetapkan kapan AP ditutup; jangan menghitung hutang AP dan giro dua kali untuk kewajiban sama.','Daftar giro outstanding = GL; cocokkan bank dan AP')
rule('R18','Hutang pajak / PPN Keluaran','Tax / Payroll / Sales','Terbatas: koreksi pajak disetujui','Entitas pajak, jenis, masa/tahun, bukti potong/faktur','Penyetoran atau kompensasi yang valid','Pajak dipotong/dipungut atau kewajiban terukur','Hutang PPh 25 hanya bila ada kewajiban angsuran yang belum dibayar; hindari double count pajak tahunan.','SPT/bukti pajak dan saldo per masa = GL')
rule('R19','Accrued expense','Payroll / Closing / AP','Ya, perhitungan dan reversal terkontrol','Unit, periode jasa, party bila ada, dasar estimasi, tanggal reversal','Pembayaran, invoice settlement atau reversal','Beban yang sudah terjadi belum ditagih/dibayar','Invoice berikutnya harus menghapus accrual; jangan bebankan dua kali.','Schedule accrual, reversal dan invoice matching')
rule('R20','Hutang lain-lain / Principal','AP / Other payable','Terbatas dengan party','Unit, identitas party, perjanjian, sifat dan jatuh tempo','Pelunasan / pengurangan kewajiban','Pengakuan kewajiban yang didukung','Principal ditahan sampai identitas dan nature jelas; jangan asumsi afiliasi.','Saldo party = GL; review lancar/nonlancar')
rule('R21','Pinjaman','Treasury / Loan','Terbatas dengan kontrak pinjaman','Entitas, Unit, lender, loan ID, mata uang, jadwal','Pelunasan pokok / transfer ke bagian lancar dari nonlancar','Pencairan / transfer bagian lancar ke akun current','Pisahkan pokok dari bunga. Instrumen nonbank perlu disclosure pihak berelasi jika relevan.','Loan schedule = GL; current portion per tanggal laporan')
rule('R22','Uang muka penjualan','Sales / Customer advance','Tidak langsung; koreksi dengan customer','Unit, customer/order, penerimaan, pemenuhan order','Pengakuan penjualan saat kewajiban dipenuhi / refund','Dana diterima sebelum barang/jasa diserahkan','Jangan mengakui uang muka sebagai pendapatan saat penerimaan. Pajak mengikuti ketentuan transaksi.','Outstanding advance per order/customer = GL')
rule('R23','Ekuitas dan closing','Closing / Corporate','Terbatas: dokumen pemilik dan approval finance','Entitas, periode, dokumen modal/distribusi','Distribusi/kerugian atau jurnal close sesuai akun','Setoran modal/laba atau jurnal close sesuai akun','Prive hanya bila bentuk usaha mendukung. Laba berjalan adalah hasil laporan; mekanisme closing ERP harus dikonfirmasi.','Ekuitas awal + mutasi = akhir; laba rugi tidak di-post dua kali')
rule('R24','Penjualan dan management fee','POS / AR / Sales','Tidak langsung; koreksi melalui sumber','Unit, invoice/POS, channel, metode bayar, party bila relevan','Pembalikan penjualan yang valid','Penyerahan barang/jasa sesuai pengakuan','Metode pembayaran bukan nature pendapatan; exclude PPN. Management fee perlu kontrak dan pihak penerima.','POS/invoice net of tax = GL; penghubung ke settlement/kas/AP')
rule('R25','Potongan / retur penjualan','POS / Sales return','Tidak langsung; dokumen asal wajib','Unit, invoice asal, alasan, SKU untuk retur','Diskon/retur sebagai contra revenue','Pembalikan diskon/retur yang valid','Retur fisik punya jurnal inventory/HPP terpisah; jangan mengkredit kas dua kali.','Retur dan diskon per dokumen = GL; cocokkan refund dan inventory')
rule('R26','Harga pokok penjualan','Inventory / POS','Tidak langsung; cost adjustment terkontrol','Unit, SKU, delivery/POS, kuantitas, metode costing','Biaya barang terjual','Pembalikan HPP untuk retur / cost correction','Pembelian stok belum otomatis HPP. Diskon setelah invoice dialokasikan stok tersisa dan barang terjual secara terukur.','COGS detail inventory = GL; gross margin per Unit')
rule('R27','Beban operasional','AP / Payroll / Expense','Ya untuk accrual/koreksi disetujui','Unit, Department bila alokasi fungsi, dokumen, periode, party','Beban periode yang sesuai nature','Reversal / refund / koreksi','Tidak untuk pokok aset, uang muka, biaya periode depan atau inbound cost yang harus dikapitalisasi.','Rincian dokumen/payroll = GL; accrual dan prepaid tidak double count')
rule('R28','Beban penyusutan / amortisasi','Fixed asset closing','Tidak langsung; koreksi register','Unit, asset ID, kategori, periode','Beban periodik','Reversal / koreksi','Satu GL boleh hanya jika breakdown register lengkap; akun HGB menunggu policy.','Beban register = GL dan mutasi akumulasi')
rule('R29','Selisih stock opname','Inventory adjustment','Tidak langsung; count disetujui','Unit, gudang, SKU, count ID, alasan','Kekurangan yang ditetapkan ke akun ini','Kelebihan yang ditetapkan ke akun ini','Batas dengan 6102008 wajib: kehilangan/kerusakan teridentifikasi ke 6102008; residual count ke sini setelah investigasi. Jangan dua kali.','Adjustment kuantitas/nilai = GL; approval count')
rule('R30','Pendapatan/beban lain dan pembulatan','Bank / AP / Closing','Terbatas dengan dasar','Unit, sumber, nature, dokumen; objek sewa bila relevan','Beban atau reversal pendapatan','Pendapatan atau reversal beban','Pendapatan/beban material harus teridentifikasi untuk presentasi terpisah; misc bukan saldo penyeimbang migrasi.','Rincian nature = GL; bunga deposito terpisah pokok')
rule('R31','Bunga pinjaman / leasing','Loan / Lease schedule','Terbatas dengan perhitungan','Unit, loan/lease ID, lender, periode, jadwal','Bunga periode sesuai metode yang disetujui','Reversal / koreksi','Bukan cicilan pokok; lease memerlukan policy dan akun balance sheet yang sesuai.','Bunga jadwal = GL; cocokkan accrual dan pembayaran')
rule('R32','Beban pajak penghasilan kini','Tax closing','Ya, perhitungan pajak disetujui','Entitas pajak, tahun, rekonsiliasi fiskal, perhitungan','Beban pajak kini','Koreksi / pembalikan yang valid','Pembayaran PPh 25 bukan beban baru. Pajak tangguhan, jika applicable, perlu desain terpisah.','Beban pajak, utang, kredit pajak dan pembayaran direkonsiliasi')
rulemap={r[0]:r for r in rules}

def family(c):
 if c.startswith('1101'): return 'R01'
 if c.startswith(('1102',)): return 'R02'
 if c in ['1103001','1103002']: return 'R03'
 if c=='1103199': return 'R05'
 if c.startswith('11031'): return 'R04'
 if c=='1104199': return 'R07'
 if c.startswith('1104'): return 'R06'
 if c=='1105001': return 'R08'
 if c.startswith('11051'): return 'R09'
 if c.startswith('11052'): return 'R10'
 if c.startswith('1201') or c in ['2105001','2105002']: return 'R11'
 if c in ['1202691','7103001']: return 'R14'
 if c.startswith('120'): return 'R13' if 'Akumulasi' in next(a['name'] for a in accounts if a['code']==c) else 'R12'
 if c=='2101002': return 'R16'
 if c.startswith('2101'): return 'R15'
 if c.startswith('2102'): return 'R17'
 if c.startswith('2103'): return 'R18'
 if c.startswith('2104'): return 'R19'
 if c.startswith('2105'): return 'R20'
 if c.startswith(('2106','2201')): return 'R21'
 if c=='2107001': return 'R22'
 if c.startswith('3'): return 'R23'
 if c.startswith('4102'): return 'R25'
 if c.startswith('4'): return 'R24'
 if c.startswith('5'): return 'R26'
 if c in ['7101002','7102001','7104001']: return 'R28'
 if c.startswith(('6','7')): return 'R27'
 if c=='8101004': return 'R29'
 if c.startswith('810'): return 'R30'
 if c.startswith('820'): return 'R31'
 return 'R32'

decisions=[
 ['D01','Semua akun / mapping','Belum diputuskan','Data saldo, jurnal dan posting flag belum ada','Ekspor TB per unit, jurnal historis, master akun beserta is_group/allow_posting dan arti Y/N','Finance + implementor','Semua mapping tetap usulan; flag legacy tidak diartikan sebagai aktif'],
 ['D02','1102xxx; 2102xxx','Belum diputuskan','Rekening bank aktual dan giro keluar','Daftar rekening, mata uang, pemilik/unit, bank statement, daftar giro dan event AP settlement','Treasury','Akun bank dalam 158 adalah template; instantiate per rekening sesuai engine'],
 ['D03','1105101','Belum diputuskan','Prepaid PPh 21','Bukti setor, masa pajak, jenis saldo dan identitas wajib pajak','Tax','Tahan posting sampai substansi terbukti; bisa kelebihan setor withholding, bukan kredit PPh badan otomatis'],
 ['D04','1202691; 7103001','Belum diputuskan','Replacement OE','Kebijakan kapitalisasi, daftar OE, jurnal pembentukan dan pemakaian reserve','Finance','Tahan; tentukan biaya aktual, depresiasi, impairment atau koreksi'],
 ['D05','2105003','Belum diputuskan','Principal','Identitas pihak, kontrak, saldo dan jatuh tempo','Finance','Tahan; jangan anggap interunit atau pemilik tanpa bukti'],
 ['D06','1201001; 1201002; 1201009; 2105001; 2105002','Belum diputuskan','Unit vs entitas hukum','Struktur legal, master unit dan counterpart, settlement terms','Finance','Tahan; tentukan akun balancing cabang / intercompany dan current/noncurrent'],
 ['D07','8201002; 7101001','Belum diputuskan','Sewa dan leasing','Standar pelaporan, kontrak, jadwal kewajiban, daftar aset sewa','Finance','Bunga leasing dipertahankan bersyarat; aset hak-guna/liabilitas mungkin perlu tambahan'],
 ['D08','1202002; 1202092; 7101002','Belum diputuskan','Hak atas tanah / HGB','Sertifikat, jenis hak, rincian biaya dan policy pelaporan','Finance','Tahan amortisasi otomatis sampai klasifikasi hak/biaya jelas'],
 ['D09','2101002','Belum diputuskan','Arti suspense hutang dagang','Jurnal contoh receipt/invoice, aging suspense','AP + Procurement','Tahan; hanya aktifkan sebagai GRNI jika fungsi itu terbukti'],
 ['D10','1103001; 1103002','Belum diputuskan','Settlement provider dan piutang lain','Daftar payment provider, QRIS/marketplace, batch settlement dan kredit pelanggan','Finance + POS','Konfirmasi akun penampung dan dimensi; AR umum mungkin diperlukan'],
 ['D11','3101001; 3101002; 3101003','Belum diputuskan','Bentuk usaha dan closing','Dokumen bentuk usaha; skenario period close ERP','Finance','Prive ditahan sampai bentuk usaha tepat; laba berjalan tidak dibuat akun manual'],
 ['D12','1031801; 1031802; 1031803','Belum diputuskan','Saldo legacy aset lainnya','Saldo per dokumen, daftar aset/barang, asal CIP dan bukti manfaat','Finance','Tidak otomatis run-off; koreksi/reclass/write-off/lanjut pengakuan sesuai bukti'],
 ['D13','6102008; 8101004; 1104199','Belum diputuskan','Kerusakan dan selisih stok','Reason code adjustment, daftar cadangan, count dan write-off','Inventory + Finance','Gunakan satu jalur per kejadian; cadangan dan kerugian aktual tidak double count'],
 ['D14','6102006; 6102007; 5101001','Belum diputuskan','Inbound cost dan potongan pembelian','Contoh invoice diskon awal/akhir, landed cost, barang sudah terjual','Procurement + Finance','Diskon di cost; alokasi stok/HPP wajib. Biaya inbound eligible ke inventory'],
 ['D15','Blok pajak','Belum diputuskan','Desain kontrol pajak lengkap','Status PKP, bentuk WP, jenis pemotongan, kredit pajak, pajak final/tangguhan bila applicable','Tax','Akun tambahan bisa diperlukan berdasarkan transaksi; tidak dipaksakan ke misc'],
 ['D16','Seluruh akun aset tetap','Belum diputuskan','Kategori aset dan kapitalisasi','Register aset, threshold, masa manfaat, kategori mesin/FFE/OE','Finance + Fixed asset','Mapping aset berbasis kategori harus cocok register sebelum migrasi'],
 ['D17','6103xxx; 8101005','Belum diputuskan','Batas expense nature dan misc','Contoh supplies, transport, fee, donasi dan laporan yang dibutuhkan','Finance','Hindari overlap; misc material ditelusuri dan dipisah bila perlu'],
]

for a in accounts:
 c=a['code']; rid=family(c); rr=rulemap[rid]
 status='Siap konfigurasi'; gate='Uji jurnal dan rekonsiliasi sesuai aturan; bukan persetujuan aktivasi produksi.'; did='D01'
 if rid in ['R02','R03','R09','R12','R13','R17','R18','R21','R23','R31','R32','R07','R29']:
  status='Bersyarat'; gate='Validasi kebutuhan, dokumen dan kebijakan sebelum aktivasi.'
 if rid in ['R14','R11','R16'] or c in ['1105101','2105003','1202002','1202092','7101002','3101003']:
  status='Ditahan'; gate='Tidak menerima transaksi baru sebelum keputusan substansi selesai.'
 if rid in ['R02','R17']: did='D02'; gate='Rekening aktual, mata uang, pemilik dan rekonsiliasi harus tersedia.'
 if rid=='R03': did='D10'
 if rid in ['R09','R18','R32']: did='D15'
 if c=='1105101': did='D03'
 if rid=='R14': did='D04'
 if c=='2105003': did='D05'
 if rid=='R11': did='D06'
 if c in ['8201002','7101001']: did='D07'; status='Bersyarat'; gate='Konfirmasi kontrak, standar pelaporan dan kebutuhan akun sewa di neraca.'
 if c in ['1202002','1202092','7101002']: did='D08'
 if rid=='R16': did='D09'
 if rid=='R23': did='D11'
 if c in ['6102008','8101004','1104199']: did='D13'; status='Bersyarat'
 if c in ['6102006','6102007','5101001']: did='D14'; status='Bersyarat'
 if rid in ['R12','R13'] and did=='D01': did='D16'
 if c in ['6103001','6103002','6103003','6103013','6103015','6101004','6103009','8101005']: did='D17'; status='Bersyarat'
 group=('Aset lancar' if c.startswith('11') else 'Aset nonlancar — review afiliasi' if c.startswith('12') else 'Kewajiban lancar' if c.startswith('21') else 'Kewajiban nonlancar' if c.startswith('22') else 'Ekuitas' if c.startswith('3') else 'Pendapatan / contra' if c.startswith('4') else 'HPP' if c.startswith('5') else 'Biaya operasional' if c.startswith('6') else 'Sewa dan penyusutan' if c.startswith('7') else 'Lain-lain dan pajak')
 normal='Debit' if c[0] in '1567' or c.startswith(('820','830','4102')) or c=='3101003' else 'Kredit'
 if c in ['1103199','1104199','1202691'] or 'Akumulasi' in a['name']: normal='Kredit'
 if c in ['8101002','8101004','8101005']: normal='Debit / Kredit sesuai nature'
 notes=[]
 if c=='2107001': notes.append('Kode revisi dari 2202001 agar masuk kelompok lancar; tidak mengubah jumlah.')
 if c=='8201002': notes.append('Ditambahkan dari legacy 8020111002; keberadaan akun bukan bukti kontrak aktif.')
 if c=='6103012': notes.append('Debit beban penyisihan / kredit 1103199; write-off terhadap cadangan bukan beban kedua.')
 if c=='8101003': notes.append('Gabungan pendapatan sewa gedung/peralatan; objek wajib pada reference.')
 if c.startswith('1102'): notes.append('Template bank, bukan rekening aktual terverifikasi.')
 a.update(group=group,normal=normal,status=status,activation='Belum diaktifkan',rule=rid,module=rr[2],manual=rr[3],required=rr[4],debit=rr[5],credit=rr[6],exclude=rr[7],recon=rr[8],decision=did,gate=gate,notes=' '.join(notes))

payload={'accounts':accounts,'legacy':legacy,'rules':rules,'decisions':decisions,'stats':{'coded_rows':len(legacy),'unique_codes':len(codes),'leaves':sum(not r['has_children'] for r in legacy),'parents':len(parents),'flags':dict(collections.Counter(r['flag'] for r in legacy))}}
P.joinpath('base.json').write_text(json.dumps(payload,ensure_ascii=False,indent=2))
print(json.dumps(payload['stats'])); print(collections.Counter(a['status'] for a in accounts))
