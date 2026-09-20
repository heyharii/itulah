"""Reconcile the supplied COA against executable prototype evidence.
Owner assignments are explicit design proposals, never runtime proof.

HISTORICAL — this produced `outputs/finance-proof-20260910` on 10 September
2026 and is kept so that report can be re-derived, not because it can be run
against the chart as it stands. It asserts `source.keys() == app.keys()`: every
one of the client's 7,528 codes present in the application, name for name. That
was true of the pre-0243 chart. It is not true of the 190-account chart and it
is not true of the 40-account one (0287-0292), where the seven-digit families
this file assigns menus to — `1011001`, `6010310`, `7010215` — are not accounts
at all any more and the distinctions they carried are `line_category` values.
Re-running it against a current database fails on the first assert, which is
the correct outcome and not a bug to fix here.
"""
import csv, json, collections, hashlib, re
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
OUT=ROOT/'outputs/finance-proof-20260910'
SOURCE=Path('/Users/hari/Downloads/Laporan_Master_Account1.csv')
r=json.loads((OUT/'runtime-evidence.json').read_text())
raw=list(csv.reader(SOURCE.open(encoding='utf-8-sig')))
accounts=[]
for rowno,row in enumerate(raw,1):
    if len(row)>4 and row[1].strip().isdigit():
        code=row[1].strip()
        accounts.append(dict(code=code,name=row[2].strip(),active=row[3].strip()=='Y',level=len(code),source_row=rowno))
assert len({a['code'] for a in accounts})==len(accounts)
source={a['code']:a for a in accounts}; app={a['code']:a for a in r['chart']}
terminal10={a['code'] for a in accounts if a['level']==10 and not any(b['level']==12 and b['code'].startswith(a['code']) for b in accounts)}
assert source.keys()==app.keys()
assert all(' '.join(a['name'].split())==app[a['code']]['name'] and a['active']==app[a['code']]['postable'] for a in accounts)
policy={}
def assign(keys,owner,flow,note='Penempatan menu merupakan usulan berdasarkan objek kerja; bukan bukti alur selesai.'):
    for k in keys.split():policy[k]=dict(owner=owner,flow=flow,note=note)
assign('1011001 1011002 1011003 1011004','Kas & Bank','Penerimaan, pengeluaran, transfer atau penempatan dana')
assign('1011101 1011102','Penjualan & Piutang','Pembentukan piutang, penagihan, penerimaan dan alokasi')
assign('1011103','Penjualan & Piutang','Evaluasi piutang dan pengakuan cadangan','Kontrol cadangan di Akuntansi; fixture provision memakai kode tidak ada di COA.')
assign('1011201 1011202','Persediaan','Penerimaan dan pengeluaran persediaan per kelas')
assign('1011203 1011204','Persediaan','Pengiriman dan penerimaan barang dalam perjalanan','Aturan penerimaan dinonaktifkan; BDP role hanya C006 dan kelas dagangan.')
assign('1011299 1031801','Persediaan','Penyesuaian, kehilangan dan disposal','Kontrol/persetujuan Akuntansi; rule penyesuaian tidak otomatis mencakup semua keluarga.')
assign('1011301','Tagihan & Pengeluaran','Pembayaran dimuka dan pelepasan berkala','Rule pembayaran/pelepasan hanya memetakan prepaid sewa toko.')
assign('1011302 2012101 8030112','Pajak','Pengakuan, pelaporan, pembayaran dan rekonsiliasi pajak','Posisi, pelaporan dan pembayaran belum mempunyai lifecycle yang terpisah penuh.')
assign('1011303','Tagihan & Pengeluaran','Pemberian dan pertanggungjawaban uang muka','Role hanya Advanced Others; liquidation memakai Biaya Rumah Tangga.')
assign('1021401 1021402 1021403 2012301 2012302 2012303 2012304','Antarunit','Pembentukan dan penyelesaian saldo per pihak lawan','Register antarunit dan rule penyelesaian belum konsisten untuk setiap keluarga; sisi HO tidak otomatis lengkap.')
assign('1021501 1021502 1021503 1021504 1021505 1021506 1021507','Aset & Proyek','Perolehan, registrasi, mutasi dan pelepasan aset','Binding perolehan terbatas pada lima kelas FFE dan satu kelas OE; bukan semua kelas aset.')
assign('1021601 1021602 1021603 1021604 1021605 1021606','Aset & Proyek','Akumulasi penyusutan menurut perlakuan aset','Kebijakan penyusutan tidak dapat disimpulkan hanya dari nama akun; coverage kelas terbatas.')
assign('1021607','Aset & Proyek','Cadangan penggantian OE','Rule reserve sengaja nonaktif, COA_ONLY; jangan diaktifkan hanya untuk menaikkan coverage.')
assign('1021701 1021702','Aset & Proyek','Perolehan software dan amortisasi','Tidak ada binding khusus software; keberadaan COA tidak membuktikan alurnya.')
assign('1031802','Aset & Proyek','Biaya pre-opening dan amortisasi','Amortisasi contoh tersedia; kebijakan pengakuan awal harus terpisah dan disetujui.')
assign('1031803','Aset & Proyek','Akumulasi biaya proyek dan kapitalisasi','Rule kapitalisasi tersedia; penambahan biaya proyek dan hubungan register aset perlu pembuktian lanjut.')
assign('2012001','Tagihan & Pengeluaran','Pengakuan tagihan dan alokasi pembayaran','Barang/nonbarang/suspend berbeda; expense invoice saat ini selalu didebit ke biaya listrik.')
assign('2012002','Kas & Bank','Penerbitan dan pencairan giro','Bank giro belum menjadi dimensi role OUTSTANDING_GIRO; uji Mandiri masuk BCA.')
assign('2012201','BERAGAM','Akrual berdasarkan asal kewajiban','Dibagi pada tingkat 10 digit: payroll, beban operasional atau bunga; kontrol gabungan di Akuntansi.')
assign('2012501 2012502 2022401 2022402 8020111','Pendanaan & Modal','Pencairan pinjaman, reklasifikasi jatuh tempo, angsuran dan bunga','Rule angsuran hanya memakai hutang bank BCA jangka panjang; LOAN_CURRENT belum digunakan rule.')
assign('3013001','BERAGAM','Transaksi pemilik dan hasil periode','Setoran/prive di Pendanaan; laba berjalan/ditahan di Akuntansi. Close hanya mengubah status, belum menghasilkan hasil periode.')
assign('4010110 4010111 4010112 4010113 4010214','Penjualan & Piutang','Penjualan per kanal, retur dan settlement','Contoh rule SALE: tunai/BCA debit; varian seluruh bank, kartu kredit dan online belum terbukti.')
assign('4010213','Penjualan & Piutang','Diskon penjualan','Rule SALE memakai penjualan neto dan tidak memposting akun diskon terpisah. Ini pilihan kebijakan, bukan otomatis bug.')
assign('4020110','Penjualan & Piutang','Penagihan management fee','Belum ditemukan rule khusus pengakuan/penagihan management fee; membutuhkan sumber tagihan pendapatan.')
assign('5010110','Persediaan','Harga pokok terkait penjualan','Menu kontrol nilai persediaan; event SALE mencatat HPP satu kali. Dibaca juga di Laba Rugi.')
assign('6010110 6010310 6010410 7010110 7020310','Tagihan & Pengeluaran','Pengakuan dan pembayaran biaya operasional','Kategori harus memilih akun sesuai tujuan biaya; satu fallback biaya listrik/rumah tangga tidak mencakup keluarga penuh.')
assign('6010111 6010210','Payroll','Perhitungan dan pengakuan biaya tenaga kerja','Beberapa biaya pegawai berbasis vendor/claim; owner per jenis di bawah merupakan usulan, bukan konfirmasi proses HR.')
assign('7010210 7010211 7010212 7010213 7010214 7010215 7010216','Aset & Proyek','Penyusutan, penggantian dan amortisasi','Rule dan binding spesifik kelas; keluarga lengkap belum terbukti.')
assign('7010310','BERAGAM','Asuransi properti dan biaya PBB','Kelompok turunan dari awalan akun detail; tidak ada baris induk 7010310 di CSV. Bukan akun baru.')
assign('8010110','BERAGAM','Pendapatan dan biaya nonoperasional','Dibagi berdasarkan perilaku akun pada tingkat 10 digit; klasifikasi laporan perlu diverifikasi untuk pendapatan dan beban.')
special={
 '204001':dict(owner='Kas & Bank (perlu konfirmasi)',flow='Giro keluar',note='Hubungan dengan 2012002 belum ditetapkan; tidak ada binding role atau rule khusus.'),
 '205001':dict(owner='Penjualan & Piutang (perlu konfirmasi)',flow='Uang muka pelanggan',note='Jangan disatukan dengan uang muka keluar; belum ada rule khusus.'),
 '600104':dict(owner='Penjualan & Piutang (perlu konfirmasi)',flow='Pendapatan lain-lain',note='Nama menunjukkan pendapatan tetapi prefix 6 masuk operating expenses pada report saat ini; perlu keputusan klasifikasi.')
}
families=[a for a in accounts if a['level']==7]
derived_prefixes={a['code'][:7] for a in accounts if a['level']==12}-{a['code'] for a in families}
assert set(policy)=={a['code'] for a in families}|derived_prefixes
derived_families=[dict(code=k,name='Asuransi & PBB (kelompok turunan; induk tidak ada di CSV)',active=True,level=7,source_row='',derived=True) for k in sorted(derived_prefixes)]
def owner_for(a):
    c=a['code'];p=c[:7];b=c[:10]
    if c in special:return dict(special[c])
    if p not in policy:return dict(owner='Pengaturan Finance / Laporan',flow='Akun induk untuk pengelompokan',note='Bukan bukti suatu transaksi boleh diposting ke akun induk.')
    d=dict(policy[p])
    if len(c)<10:return d
    if p=='2012201':
        d['owner']='Payroll' if b[-3:] in ['001','002','004','005'] else 'Pendanaan & Modal' if b.endswith('003') else 'Tagihan & Pengeluaran'
    elif p=='3013001':d['owner']='Akuntansi & Tutup Buku' if b[-3:] in ['002','003'] else 'Pendanaan & Modal'
    elif p in ['6010111','6010210'] and b[-3:] in ['008','009','010','011']:
        d['owner']='Tagihan & Pengeluaran';d['note']='Usulan: seragam, kegiatan, bantuan dan pelatihan melalui claim/vendor; konfirmasi apakah diproses melalui payroll.'
    elif p=='7010310':
        d['owner']='Tagihan & Pengeluaran' if b.endswith('001') else 'Pajak'
        d['note']='Owner usulan: asuransi melalui invoice/prepaid; PBB melalui kewajiban pajak. Konfirmasi sumber dokumen dan tautkan pembayaran yang sama. Induk 7 digit tidak ada di CSV.'
    elif b=='6010110002':
        d['owner']='Penjualan & Piutang';d['note']='Biaya kartu berasal dari settlement, meskipun klasifikasi akun adalah beban. Satu dokumen settlement; jangan membuat tagihan beban kedua.'
    elif b=='6010310003':
        d['note']='Kontrol kategori beban di Tagihan; akun yang sama dipakai payroll outside-help/rounding. Menu pemicu mengikuti kejadian asal, bukan klasifikasi akun.'
    elif b=='6010310004':
        d['owner']='Kas & Bank';d['note']='Kontrol biaya bank; pada perolehan aset biaya ini juga dibentuk oleh kejadian Aset. Tetap satu dokumen sumber, bukan pengeluaran kedua.'
    elif p=='8010110':
        d['owner']={'001':'Kas & Bank','002':'Akuntansi & Tutup Buku','003':'Tagihan & Pengeluaran','004':'Penjualan & Piutang','005':'Penjualan & Piutang','006':'Persediaan','007':'Akuntansi & Tutup Buku'}[b[-3:]]
    return d
byAccount=collections.defaultdict(list)
for b in r['bindings']:byAccount[b['account_code']].append(b)
byRole=collections.defaultdict(list)
for p in r['packages']:
    for role in set(l['role'] for l in p['lines']):byRole[role].append(p)
tested=collections.defaultdict(set)
for x in r['ruleSampleEntries']:
    for line in x['entry']['lines']:tested[line['account_code']].add(x['constant'])
ruleRoutes={p['constant']:sorted({route for s in r['screenFunctions'] if p['constant'] in s['rules'] for route in s['routes']}) for p in r['packages']}
matrix=[]
for a in accounts:
    c=a['code'];d=owner_for(a);bs=byAccount[c];roles=sorted({b['role'] for b in bs});pkgs={p['constant']:p for role in roles for p in byRole[role]};activePkgs=[p for p in pkgs.values() if p['activation']['enabled']]
    if c in terminal10:
        status='10 digit tanpa rincian / perlu keputusan'
        d['note']='Tidak memiliki rincian 12 digit di CSV sumber; izin posting dan rincian unit belum dapat disimpulkan.'
    elif a['level'] not in [6,12]:status='Induk / pengelompokan'
    elif not a['active']:status='Nonaktif / histori'
    elif c in special:status='Kode khusus / perlu keputusan'
    elif c in tested:status='Posting contoh teruji'
    elif activePkgs:status='Binding + aturan; akun belum diuji'
    elif bs:status='Binding tanpa aturan aktif'
    else:status='Belum ada binding role'
    report='Neraca' if c[0] in '123' else 'Laba Rugi'
    matrix.append({**a,**d,'unit':app[c].get('unit_id',''),'family':c[:7] if c[:7] in policy else c,'bindings':[b['binding_id'] for b in bs],'roles':roles,'rules':sorted(pkgs),'active_rules':sorted(p['constant'] for p in activePkgs),'tested_rules':sorted(tested[c]),'current_routes':sorted({route for p in pkgs for route in ruleRoutes[p]}),'status':status,'report':report+'; Neraca Saldo; Buku Besar','report_basis':'reports.ts useClasses: prefix kode; ledger.ts trialBalance. Klasifikasi detail belum disahkan.','evidence_scope':'Posting contoh bukan bukti alur lengkap/produksi; owner adalah usulan desain.'})
def aggregate(a):
    children=[x for x in matrix if x['code'].startswith(a['code']) and x['level']==12]
    policyrow=owner_for(a)
    if a['code'] in terminal10:policyrow['note']='Tidak ada rincian 12 digit pada CSV sumber. Konfirmasi apakah akun ini agregasi, akun posting, atau master belum lengkap.'
    return {**a,**policyrow,'owners':sorted({x['owner'] for x in children}) or [policyrow['owner']],'leaves':len(children),'active_leaves':sum(x['active'] for x in children),'bound_leaves':sum(bool(x['bindings']) for x in children),'tested_leaves':sum(bool(x['tested_rules']) for x in children),'rules':sorted({v for x in children for v in x['rules']}),'routes':sorted({v for x in children for v in x['current_routes']}),'report':('Neraca' if a['code'][0] in '123' else 'Laba Rugi')+'; Neraca Saldo; Buku Besar'}
familyMatrix=sorted([aggregate(a) for a in accounts if a['level']==7 or a['code'] in special]+[aggregate(a) for a in derived_families],key=lambda a:a['code'])
behaviorMatrix=[aggregate(a) for a in accounts if a['level']==10]
leaf=[a for a in matrix if a['level']==12]
assert sum(f['leaves'] for f in familyMatrix)==len(leaf)
assert all(sum(a['code'].startswith(f['code']) for f in familyMatrix)==1 for a in leaf)
assert all(a['owner'] not in ['Pengaturan Finance / Laporan','BERAGAM'] for a in leaf)
checks=[dict(id='scenario-'+s['id']+'-'+str(i+1),description=c['label'],expected=c.get('expected',''),actual=c.get('actual',''),evidence='engine/scenarios.ts; skenario bawaan, tidak independen',**{'pass':c['pass']}) for s in r['scenarios'] for i,c in enumerate(s['checks'])]+r['checks']
summary=dict(accounts=len(accounts),leaves=len(leaf),active_leaves=sum(a['active'] for a in leaf),inactive_leaves=sum(not a['active'] for a in leaf),families=len(families),special_codes=len(special),behaviors=len(behaviorMatrix),bindings=len(r['bindings']),bound_accounts=len(byAccount.keys()-{k for k,v in byAccount.items() if not v}),bound_leaves=sum(bool(a['bindings']) for a in leaf),tested_leaves=sum(bool(a['tested_rules']) for a in leaf),rules=len(r['packages']),enabled_rules=sum(p['activation']['enabled'] for p in r['packages']),rule_samples=len(r['ruleSampleEntries']),builtin_checks=sum(len(s['checks']) for s in r['scenarios']),builtin_passed=sum(c['pass'] for s in r['scenarios'] for c in s['checks']),additional_checks=len(r['checks']),additional_passed=sum(c['pass'] for c in r['checks']),status_counts=dict(collections.Counter(a['status'] for a in matrix)),source_sha256=hashlib.sha256(SOURCE.read_bytes()).hexdigest())
assert summary['tested_leaves']==sum(x['status']=='Posting contoh teruji' for x in matrix)
assert summary['active_leaves']==sum(summary['status_counts'][k] for k in ['Posting contoh teruji','Binding + aturan; akun belum diuji','Binding tanpa aturan aktif','Belum ada binding role'])
summary['derived_family_groups']=len(derived_families)
summary['logical_family_groups']=len(families)+len(derived_families)
summary['family_leaf_partition_verified']=sum(f['leaves'] for f in familyMatrix)
proof=dict(summary=summary,scope=r['scope'],source_file=SOURCE.name,generated_at=r['generated_at'],accounts=matrix,families=familyMatrix,behaviors=behaviorMatrix,checks=checks,rule_routes=ruleRoutes)
(OUT/'coverage-proof.json').write_text(json.dumps(proof,ensure_ascii=False,indent=2))
print(json.dumps(summary,ensure_ascii=False,indent=2))
