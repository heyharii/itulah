import json,pathlib
p=pathlib.Path('/Users/hari/itulah/outputs/coa_v1_work')
b=json.loads((p/'base.json').read_text()); exact={}; broad={}
def series(old,new,n,start=1):
 for i in range(start,start+n):exact[old+str(i).zfill(3)]=new+str(i).zfill(3)
series('1011001','1101',3)
# Cash proposal uses 1101001 etc.; new prefixes are four digits.
series('1011002','1102',5)
for i in range(1,6):exact['1011003'+str(i).zfill(3)]='11021'+str(i).zfill(2)
for i in range(1,5):exact['1011004'+str(i).zfill(3)]='11022'+str(i).zfill(2)
exact.update({'1011101001':'1103001','1011101002':'1103002','1011102001':'1103101','1011102002':'1103102','1011102003':'1103103'})
broad.update({'1011103':'1103199','1011201':'1104001','1011202':'1104002','1011203':'1104101','1011204':'1104102','1011299':'1104199','1011301':'1105001','1021401':'1201001','1021402':'1201002','1021403':'1201009','1021502':'1202101','1021503':'1202201','1021504':'1202301','1021505':'1202401','1021506':'1202501','1021507':'1202601','1021602':'1202191','1021603':'1202291','1021604':'1202391','1021605':'1202491','1021606':'1202591','1021607':'1202691','1021701':'1202701','1021702':'1202791','2012301':'2105001','2012302':'2105002','2012303':'2105003','2012304':'2105009','2012501':'2106001','2012502':'2106001','2022401':'2201001','2022402':'2201001','4010110':'4101001','4010111':'4101001','4010112':'4101001','4010113':'4101001','4010213':'4102001','4010214':'4102002','4020110':'4201001','5010110':'5101001','7010210':'7102001','7010211':'7102001','7010212':'7102001','7010213':'7102001','7010214':'7102001','7010215':'7103001'})
exact.update({'1011302001':'1105101','1011302002':'1105102','1011302003':'','1011302004':'1105103','1011302005':'1105104','1011302006':'1105109','1011303001':'1105201','1011303002':'1105202','1011303003':'1105203','1011303004':'1105209','1021501001':'1202001','1021501002':'1202002','1021601002':'1202092','1031801001':'','1031802001':'','1031802002':'','1031803001':''})
series('2012001','2101',3);series('2012002','2102',5);series('2012101','2103',5)
for i,t in enumerate(['2104001','2104002','2104003','2104002','2104002','2104004','2104004','2104004','2104005','2104005'],1):exact['2012201'+str(i).zfill(3)]=t
exact.update({'204001':'','205001':'2107001','600104':'8101005','3013001001':'3101001','3013001002':'3101002','3013001003':'','3013001004':'3101003'})
for i in range(1,9):exact['6010110'+str(i).zfill(3)]='6102'+str(i).zfill(3)
for pref in ['6010111','6010210']:
 for i in range(1,14):exact[pref+str(i).zfill(3)]='6101'+str(i).zfill(3)
for i in range(1,16):exact['6010310'+str(i).zfill(3)]='6103'+str(i).zfill(3)
for i,t in {16:'6103016',17:'6103016',18:'',19:'6103016',20:'',21:'6103017',22:'6103018',23:'6103019',24:'6103003',99:'6103099'}.items():exact['6010310'+str(i).zfill(3)]=t
for i,t in enumerate(['6104002','6104003','6104003','6104001','6104001','6104004','6104005','6104006','','6104005'],1):exact['6010410'+str(i).zfill(3)]=t
exact.update({'7010110001':'7101001','7010110002':'7101002','7010110003':'7101001','7010110004':'7101001','7010216001':'7104001','7010216002':'','7010216003':'7104001','7010310001':'7105001','7010310002':'7106001','7020310003':'7106002','7020310004':'7107001','7020310005':'7105002','8010110001':'8101001','8010110002':'8101002','8010110003':'','8010110004':'8101003','8010110005':'8101003','8010110006':'8101004','8010110007':'8101005','8020111001':'8201001','8020111002':'8201002','8030112001':'8301001'})
account={a['code']:a for a in b['accounts']}
out=[]
for r in b['legacy']:
 c=r['code']
 if len(c) not in [6,10]:continue
 t=exact.get(c,broad.get(c[:7],'')); reason='Kandidat berdasarkan nama dan kelompok legacy; cocokkan saldo/jurnal sebelum persetujuan.'
 confidence='Nama / kelompok sepadan' if t else 'Perlu keputusan'
 hint='Unit dari nama/master unit; dokumen asal tetap dipertahankan.'
 if c.startswith('101100'):hint+=' Register kas atau rekening bank aktual; jangan infer nomor rekening dari nama bank.'
 if c.startswith(('101110','2012001')):hint+=' Party dan invoice/batch wajib sesuai nature.'
 if c.startswith(('101120','101129')):hint+=' SKU/ukuran/material dan gudang di inventory subledger.'
 if c.startswith(('10215','10216','10217','701021')):hint+=' Asset ID/kategori/lokasi di register; mapping kategori perlu policy.'
 if c.startswith(('10214','20123')):hint+=' Nama cabang bisa menunjukkan counterpart, bukan Unit pemilik; konfirmasi arah transaksi.'
 if c.startswith(('20125','20224','8020111')):hint+=' Lender/loan/lease ID dan jatuh tempo di schedule.'
 if c.startswith('401011'):hint+=' Metode bayar, acquirer/card network dan channel di transaksi; bukan revenue nature.'
 if c.startswith('6010111'):hint+=' Department kandidat Operation sesuai parent legacy; validasi master department.'
 if c.startswith('6010210'):hint+=' Department kandidat Office sesuai parent legacy; validasi master department.'
 if t and account[t]['status']=='Ditahan':confidence='Kandidat — target ditahan';reason+=' Target belum boleh diaktifkan; lihat '+account[t]['decision']+'.'
 if c=='1011302003':reason='PPh 29 perlu rekonsiliasi pajak tahun terkait; tidak otomatis memindahkan debit prepaid ke utang.'
 if c.startswith('103180'):reason='Periksa substansi saldo legacy; reclass/koreksi/write-off/lanjut pengakuan sesuai bukti. CIP bukan otomatis capital work.'
 if c=='3013001003':reason='Laba bulan berjalan adalah hasil laporan/closing. Rekonsiliasi terhadap P&L; jangan migrasi dua kali.'
 if c=='204001':reason='Pilih outstanding giro per rekening setelah memastikan workflow dan tidak overlap AP/giro existing.'
 if c=='8010110003':reason='Potongan pembelian ke cost inventory/HPP sesuai proporsi; bukan single target GL otomatis.'
 if c=='7010216002':reason='Amortisasi Pre Opening terkait akun legacy; kaji validitas pengakuan sebelum transaksi baru.'
 if c in ['6010310018','6010310020','6010410009']:reason='Nama tools/telephone equipment/paint belum menentukan objek dan kapitalisasi. Periksa invoice; pilih expense nature atau aset yang tepat.'
 if c=='5010110001':confidence='Bersyarat';reason='Legacy bernama Harga Pokok Pembelian. Map ke HPP hanya bila jurnal benar-benar cost of goods sold; pembelian stok perlu inventory/periodic close treatment.'
 if c in ['6010110006','6010110007']:confidence='Bersyarat';reason='Pisahkan inbound cost yang eligible masuk inventory dari outbound/operational expense; dapat memerlukan split per transaksi.'
 if c=='8010110006':confidence='Bersyarat';reason='Nama menggabungkan kehilangan dan stock opname; pisahkan loss teridentifikasi ke 6102008 vs residual count ke 8101004 sesuai reason code.'
 out.append({'legacy_prefix':c,'target_code':t,'confidence':confidence,'reason':reason,'dimension_hint':hint})
assert len(out)==499
(p/'mapping_fallback.json').write_text(json.dumps({'mapping':out},ensure_ascii=False,indent=2))
print('499 prefixes;',sum(bool(m['target_code']) for m in out),'candidate targets')
