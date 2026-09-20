#!/usr/bin/env python3
"""Decide, for every one of the 190 head accounts and every account_map row,
which of the 40 accounts and which category it becomes.

Two different questions, and they have different answers:

  a RETIRED ACCOUNT gets a category only when it stands for exactly one. A
  client account that covered several — `Piutang Kartu Kredit` covers VISA and
  MasterCard — gets none, because the thing that told them apart was the map
  qualifier, not the account.

  a MAP ROW gets its category from the QUALIFIER when the meaning is qualified,
  and from the account it used to point at otherwise. That is where the detail
  actually lived.
"""
import subprocess, csv, json, re, unicodedata, collections, sys

_cj=json.load(open('outputs/coa_thirty/categories.json'))
cats=_cj['categories']
# The head's names are not always the client's — 0253 restored client names but
# later migrations tidied some, and the categories were slugged from the CSV. So
# the lookup is by CODE, which both sides agree on, and never by name.
LEAF=_cj['leaf_category']
chart=json.load(open('outputs/coa_thirty/chart40.json'))
def slug(n, cap=44):
    n=unicodedata.normalize('NFKD',n).encode('ascii','ignore').decode()
    n=re.sub(r'\(.*?\)','',n); n=re.sub(r'[^A-Za-z0-9]+','_',n).strip('_').upper()
    return re.sub(r'_+','_',n)[:cap].rstrip('_')

head={}
for l in subprocess.run(['psql','-d','itulah_dev','-tAF','\t','-c',
  "select account_code, name from ledger_account where not is_group order by 1"],
  capture_output=True,text=True).stdout.strip().splitlines():
    c,n=l.split('\t'); head[c]=n
base={r['old_code']:r['new_account'] for r in csv.DictReader(open('outputs/coa_thirty/remap-190-to-40.csv'))}

# One category, named, for the accounts that stand for exactly one.
ONE = {
 '1011001001':'DRAWER','1011001002':'PETTY','1011001003':'FLOAT','1011005001':'TRANSIT',
 '1011101003':'QRIS','1011101004':'TENDER_OTHER',
 '1011102001':'EMPLOYEE','1011102002':'STORE_MANAGER','1011102003':'MANAGEMENT',
 '1011103001':'CARD_CREDIT','1011103002':'CARD_DEBIT','1011103003':'EMPLOYEE',
 '1011201001':'MERCHANDISE','1011203001':'MERCHANDISE','1011204001':'SUPPLIES',
 '1011299001':'MERCHANDISE','1011299002':'SUPPLIES',
 '1021401001':'FINANCING','1021402001':'GOODS','1021403001':'INTERUNIT_OTHER',
 '2012301001':'FINANCING','2012302001':'GOODS','2012304001':'INTERUNIT_OTHER',
 '1011302001':'PPH21','1011302002':'PPH25','1011302003':'PPH29','1011302004':'PPN_IN',
 '1011302005':'PBB','1011302006':'TAX_OTHER',
 '2012101001':'PPH21','2012101002':'PPH23','2012101003':'PPN_OUT','2012101004':'PBB','2012101005':'PPH25',
 '2012101006':'PPH29','8030112001':'PPH25',
 '2012305001':'VOUCHER_LIABILITY','205001':'CUSTOMER_DEPOSIT',
 '4010110001':'CASH','4010114001':'QRIS','4010113001':'ONLINE_OWN','4010113002':'ONLINE_MARKETPLACE',
 '4010111001':'DEBIT_BCA','4010111002':'DEBIT_MANDIRI','4010111003':'DEBIT_BRI','4010111004':'DEBIT_BNI',
 '4010112001':'CREDIT_VISA','4010112002':'CREDIT_MASTER',
 '4010213001':'DISCOUNT','4010214001':'RETURN',
 '5010110001':'COGS','8010110003':'PURCHASE_DISCOUNT',
 '8010110006':'SHRINKAGE','6010110008':'DAMAGE',
 '8010110001':'INTEREST','8010110002':'ROUNDING','8010110004':'RENT_BUILDING',
 '8010110005':'RENT_EQUIPMENT','4020110001':'MANAGEMENT_FEE','8010110007':'INCOME_OTHER','600104':'INCOME_OTHER',
}
# These cover several categories at once; the qualifier told them apart.
SPANS = {'1011101001','1011101002'}
# Name-derived families: the category is the slug of the account's own name.
BY_NAME = {'1401','1403','2301','6101','6301','6401','6201'}
for _c in ('1011202001','1011202002','1011202003','1011202004','1011202005',
           '1011202006','1011202007','1011202008','1011202009','1011202010'):
    ONE[_c] = 'SUPPLIES'

rows=[]; unresolved=[]
for code, name in head.items():
    new = base[code]
    fam = chart.get(new,{}).get('family')
    cat=None
    if fam:
        if code in ONE: cat=ONE[code]
        elif code in SPANS: cat=None
        elif code in LEAF:
            cat=LEAF[code]
        else: unresolved.append((code,name,new,'?'))
        if cat and (cat not in cats or cats[cat]['family']!=fam):
            unresolved.append((code,name,new,f"{cat} is {cats.get(cat,{}).get('family')}, want {fam}"))
    rows.append({'old_code':code,'old_name':name,'new_account':new,'category_code':cat or ''})
if unresolved:
    print("UNRESOLVED:", file=sys.stderr)
    for u in unresolved: print("  ", u, file=sys.stderr)
    sys.exit(1)
with open('outputs/coa_thirty/remap-190-to-40.csv','w',newline='') as f:
    w=csv.DictWriter(f, fieldnames=['old_code','old_name','new_account','category_code']); w.writeheader(); w.writerows(rows)
print(f"{len(rows)} rows; {sum(1 for r in rows if r['category_code'])} carry a category, "
      f"{sum(1 for r in rows if not r['category_code'])} do not")
print("spanning (category comes from the qualifier):", sorted(SPANS))
