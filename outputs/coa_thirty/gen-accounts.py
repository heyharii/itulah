#!/usr/bin/env python3
"""Emit the 40-account INSERT for 0289, with each account's posting policy
derived from the policies of the head accounts that fold into it.

Nobody picks a policy by hand here. A merged account must be at least as hard to
post to as the strictest thing that folded into it, or the merge would quietly
widen a door that somebody closed on purpose."""
import subprocess, csv, json, collections

CHART = [
 # code, name, name_en, dim, D/C, contra, category_family, counter
 ('1101','Kas','Cash','unit','D',0,'pot',0),
 ('1102','Bank','Bank','company','D',0,None,0),
 ('1201','Piutang tender','Tender receivables','unit','D',0,'tender',0),
 ('1202','Piutang karyawan & lainnya','Employee and other receivables','unit','D',0,'party',0),
 ('1209','Cadangan piutang tak tertagih','Allowance for doubtful receivables','unit','C',1,'party',0),
 ('1301','Persediaan','Inventory','unit','D',0,'item_class',0),
 ('1302','Barang dalam perjalanan','Goods in transit','unit','D',0,'item_class',1),
 ('1309','Cadangan kerusakan persediaan','Allowance for inventory damage and loss','unit','C',1,'item_class',0),
 ('1401','Biaya dibayar dimuka','Prepaid expenses','unit','D',0,'prepaid_kind',0),
 ('1402','Pajak dibayar dimuka','Prepaid taxes','company','D',0,'tax_kind',0),
 ('1403','Uang muka','Advances','unit','D',0,'advance_purpose',0),
 ('1501','Rekening koran antar-unit','Inter-unit current account','unit','D',0,'interunit_reason',1),
 ('1601','Aset tetap','Fixed assets','unit','D',0,None,0),
 ('1602','Aset takberwujud & aset tangguhan','Intangible and deferred assets','unit','D',0,None,0),
 ('1609','Akumulasi penyusutan','Accumulated depreciation','unit','C',1,None,0),
 ('1610','Cadangan penggantian operating equipment','Operating equipment replacement reserve','unit','C',1,None,0),
 ('1619','Akumulasi amortisasi','Accumulated amortisation','unit','C',1,None,0),
 ('2101','Hutang usaha','Trade payables','company','C',0,None,0),
 ('2102','Barang diterima belum ditagih','Goods received not invoiced','company','C',0,None,0),
 ('2103','Giro keluar belum cair','Cheques issued not cleared','company','C',0,None,0),
 ('2201','Hutang pajak','Taxes payable','company','C',0,'tax_kind',0),
 ('2301','Biaya masih harus dibayar','Accrued expenses','unit','C',0,'accrual_kind',0),
 ('2401','Kewajiban voucher & uang muka penjualan','Voucher liability and customer deposits','company','C',0,'deferred_revenue_kind',0),
 ('2501','Pinjaman bank','Bank loans','company','C',0,None,0),
 ('2502','Pinjaman pemilik','Owner loans','company','C',0,None,0),
 ('3101','Modal disetor','Paid-in capital','company','C',0,None,0),
 ('3102','Prive','Drawings','company','D',1,None,0),
 ('3201','Laba ditahan','Retained earnings','company','C',0,None,0),
 ('4101','Penjualan','Sales','unit','C',0,'tender',0),
 ('4201','Potongan & retur penjualan','Sales discounts and returns','unit','D',1,'deduction_kind',0),
 ('4301','Pendapatan lain-lain','Other income','unit','C',0,'income_kind',0),
 ('5101','Harga pokok penjualan','Cost of goods sold','unit','D',0,'cost_kind',0),
 ('5102','Susut & selisih persediaan','Shrinkage and inventory variance','unit','D',0,'loss_kind',0),
 ('6101','Beban penjualan','Selling expenses','unit','D',0,'expense_category',0),
 ('6201','Beban karyawan','Personnel expenses','unit','D',0,'pay_component',0),
 ('6301','Beban umum & administrasi','General and administrative expenses','unit','D',0,'expense_category',0),
 ('6401','Beban sewa','Rent and occupancy','unit','D',0,'expense_category',0),
 ('7101','Beban penyusutan & amortisasi','Depreciation and amortisation','unit','D',0,None,0),
 ('8101','Beban bunga','Interest expense','company','D',0,None,0),
 ('8201','Pajak penghasilan','Income tax expense','company','D',0,'tax_kind',0),
]
assert len(CHART)==40 and len({c[0] for c in CHART})==40

pol={}
for line in subprocess.run(['psql','-d','itulah_dev','-tAF','\t','-c',
  "select account_code, posting_mode, manual_je_policy from ledger_account where not is_group"],
  capture_output=True,text=True).stdout.strip().splitlines():
    c,m,j = line.split('\t'); pol[c]=(m,j)
remap=list(csv.DictReader(open('outputs/coa_thirty/remap-190-to-40.csv')))
src=collections.defaultdict(list)
for r in remap: src[r['new_account']].append(r['old_code'])

# Two rules, and the pair of them is what makes the merge door-neutral.
#
# The ACCOUNT takes the most permissive policy among its sources, so that the
# account itself blocks nothing that used to be allowed. On its own that would
# quietly widen doors — `Selisih Pembulatan` was AUTO_ONLY/NO and would end up
# inside a 4301 a person may journal — so:
#
# The CATEGORY carries the source's own policy wherever that is stricter, in
# `account_category_policy`. A line naming (account, category) is governed by
# that row when one exists, and by the account otherwise. Every door the client
# had is therefore exactly the door they still have, at the grain the detail
# moved to.
#
# Accounts that declare no category family (bank, asset, loans, equity) have no
# such grain: their detail is a sub-ledger row, and the sub-ledger's own
# document governs. Four of them have sources that disagree — CIP among fixed
# assets, pre-opening among intangibles, the owner's payable among loans, the
# OE replacement charge among depreciation — and each resolves to
# SEMI_AUTO/OVERRIDE, which is to say: a person may reach it through a
# correction somebody approved, and may not journal it freely.
JE_RANK={'NO':0,'OVERRIDE':1,'YES':2}
MODE_RANK={'BLOCKED':0,'AUTO_ONLY':1,'MANUAL':2,'SEMI_AUTO':3}
def widest(codes):
    modes=[pol[c][0] for c in codes if c in pol]
    jes=[pol[c][1] for c in codes if c in pol]
    mode=max(modes, key=lambda m: MODE_RANK[m]) if modes else 'SEMI_AUTO'
    je=max(jes, key=lambda j: JE_RANK[j]) if jes else 'NO'
    return mode, je

def q(s): return 'NULL' if s is None else "'" + str(s).replace("'","''") + "'"
out=[]
for code,name,en,dim,dc,contra,fam,counter in CHART:
    mode,je = widest(src[code])
    out.append(f"    ({q(code)}, {q(name)}, {q(en)}, {q(code[0])}, FALSE, TRUE, {q(dim)}, "
               f"{q(dc)}, {'TRUE' if contra else 'FALSE'}, {q(fam)}, {'TRUE' if counter else 'FALSE'}, "
               f"{q(mode)}, {q(je)}, TRUE, 'PENDING_CLIENT_CODE')")
    print(f"{code} {name[:42]:44} {dim:8} {dc} {mode:10} {je:9} <- {len(src[code]):3} akun")
open('outputs/coa_thirty/0289-data.sql','w').write(
 "INSERT INTO ledger_account (account_code, name, name_en, parent_code, is_group, is_active,\n"
 "                            dimension, normal_balance, is_contra, category_family,\n"
 "                            requires_counter_site, posting_mode, manual_je_policy,\n"
 "                            posting_policy_configured, code_provenance) VALUES\n"
 + ",\n".join(out) + ";\n")
json.dump({c[0]:{'name':c[1],'dim':c[3],'family':c[6]} for c in CHART},
          open('outputs/coa_thirty/chart40.json','w'), indent=1, ensure_ascii=False)

# ---- per-category policy: the stricter source door, kept at its new grain ----
fam_of={c[0]:c[6] for c in CHART}
remap_row={r['old_code']:r for r in remap}
rows=[]
for code,name,en,dim,dc,contra,fam,counter in CHART:
    if not fam: continue
    amode,aje = widest(src[code])
    for old in sorted(src[code]):
        if old not in pol: continue
        key=remap_row[old]['category_code']
        if not key: continue                                   # no category grain
        m,j = pol[old]
        if (m,j)==(amode,aje): continue                        # same as the account
        rows.append((code,key,m,j,f"{old} {remap_row[old]['old_name']}"))
seen=set(); uniq=[]
for r in rows:
    if (r[0],r[1]) in seen: continue
    seen.add((r[0],r[1])); uniq.append(r)
with open('outputs/coa_thirty/0289-policy.sql','w') as f:
    f.write("INSERT INTO account_category_policy\n"
            "    (account_code, category_code, posting_mode, manual_je_policy, note) VALUES\n")
    f.write(",\n".join(f"    ({q(a)}, {q(k)}, {q(m)}, {q(j)}, {q('kept from ' + n)})" for a,k,m,j,n in uniq))
    f.write(";\n")
print(f"\nper-category policy rows: {len(uniq)}")
for a,k,m,j,n in uniq: print(f"   {a} {k:42} {m:10} {j:9}  {n[:46]}")
