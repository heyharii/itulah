#!/usr/bin/env python3
"""Derive line_category and asset_class values from the CLIENT's own chart.

Names are the client's, verbatim. Codes are slugs of those names, so that a
category can be read back to the leaf it replaced without a lookup table.
"""
import csv, re, unicodedata, json, collections

rows=[]
with open('/Users/hari/Downloads/Laporan_Master_Account1.csv', newline='', encoding='utf-8-sig') as f:
    for r in csv.reader(f):
        if len(r)<5: continue
        c=r[1].strip(); n=r[2].strip()
        if c.isdigit() and n: rows.append((c,n))
has_kids=set(c[:10] for c,_ in rows if len(c)==12)
tmpl=[(c,n) for c,n in rows if len(c)==10 and c in has_kids]   # 493 templates

def slug(n, cap=44):
    n=unicodedata.normalize('NFKD',n).encode('ascii','ignore').decode()
    n=re.sub(r'\(.*?\)','',n)
    n=re.sub(r'[^A-Za-z0-9]+','_',n).strip('_').upper()
    n=re.sub(r'_+','_',n)
    return n[:cap].rstrip('_')

# ---- families whose values come from client leaf NAMES -------------------
NAME_FAM = {
 '1011301':'prepaid_kind',
 '1011303':'advance_purpose',
 '2012201':'accrual_kind',
 '6010110':'expense_category',   # minus 6010110008, which is a stock loss
 '6010310':'expense_category',
 '6010410':'expense_category',
 '7010110':'expense_category',
 '7010310':'expense_category',
 '7020310':'expense_category',
 '6010210':'pay_component',      # office and operation are the same 13 twins
 '6010111':'pay_component',
}
SKIP = {'6010110008'}            # → 5102 DAMAGE
# The office family (6010210) and the operation family (6010111) are the SAME
# thirteen components written twice — the difference between them is the unit,
# which every line already carries. Eleven of the twins slug identically and
# merge on their own; these two do not, because the client wrote a different
# word for "employee" in one and mistyped "Transport" in the other. Naming them
# here is the difference between a deliberate merge and a lucky one.
ALIAS = {
 '6010210001': 'BIAYA_GAJI_KARYAWAN',   # "Biaya Gaji Pegawai" — office wording
 '6010210004': 'UANG_TRANSPORT',        # "Uang Transpot" — a typo in the chart
}
cats=collections.OrderedDict()   # code -> (family, name, sort, legacy)
leaf={}                          # client 10-digit template code -> category code
def add(fam, code, name, legacy=None):
    if code in cats:
        assert cats[code][0]==fam, f"collision {code}: {cats[code][0]} vs {fam}"
        return
    cats[code]=(fam,name,len(cats),legacy)
for c,n in tmpl:
    fam=NAME_FAM.get(c[:7])
    if not fam or c in SKIP: continue
    value = ALIAS.get(c) or slug(n)
    add(fam, value, n, c)
    leaf[c] = value

# ---- families written by hand: the value is a tender, a pot, a class ------
HAND = [
 ('pot',[('DRAWER','Kas Laci'),('PETTY','Kas Kecil'),('FLOAT','Modal Kasir'),('TRANSIT','Setoran Dalam Perjalanan')]),
 ('tender',[('CASH','Tunai'),('DEBIT_BCA','Debit BCA'),('DEBIT_MANDIRI','Debit Mandiri'),('DEBIT_BRI','Debit BRI'),
            ('DEBIT_BNI','Debit BNI'),('CREDIT_VISA','Kartu Kredit VISA'),('CREDIT_MASTER','Kartu Kredit MasterCard'),
            ('QRIS','QRIS'),('ONLINE_OWN','Online Sendiri'),('ONLINE_MARKETPLACE','Online Market Place'),
            ('VOUCHER','Voucher'),('TENDER_OTHER','Tender Lain-lain'),
            # The client's `Piutang Kartu Kredit` and `Piutang Debit Card` are the
            # receivable NOT broken down by scheme or bank — the map carries the
            # breakdown in its qualifier and leaves one unqualified row as the
            # fallback for a settlement that names no acquirer. These two are
            # that fallback, and without them those rows have no category.
            ('CREDIT_CARD','Kartu Kredit (tanpa rincian jaringan)'),
            ('DEBIT_CARD','Kartu Debit (tanpa rincian bank)')]),
 ('party',[('EMPLOYEE','Pegawai'),('STORE_MANAGER','Kepala Toko'),('MANAGEMENT','Manajemen'),
           ('CARD_CREDIT','Kartu Kredit'),('CARD_DEBIT','Kartu Debit')]),
 ('item_class',[('MERCHANDISE','Barang Dagangan'),('SUPPLIES','Kantong Belanja & Perlengkapan')]),
 ('interunit_reason',[('FINANCING','Pembiayaan'),('GOODS','Atas Barang'),('INTERUNIT_OTHER','Lain-lain')]),
 ('tax_kind',[('PPH21','PPh Pasal 21'),('PPH23','PPh Pasal 23'),('PPH25','PPh Pasal 25'),('PPH29','PPh Pasal 29'),
              ('PPH_FINAL','PPh Pasal 4(2) Final'),('PPN_IN','PPN Masukan'),('PPN_OUT','PPN Keluaran'),
              ('PBB','Pajak Bumi & Bangunan'),('TAX_OTHER','Pajak Lainnya')]),
 ('deferred_revenue_kind',[('VOUCHER_LIABILITY','Hutang Voucher'),('CUSTOMER_DEPOSIT','Uang Muka Penjualan')]),
 ('deduction_kind',[('DISCOUNT','Discount / Potongan Penjualan'),('RETURN','Retur Penjualan')]),
 ('income_kind',[('INTEREST','Pendapatan Bunga Bank'),('ROUNDING','Selisih Pembulatan'),
                 ('RENT_BUILDING','Pendapatan Sewa Gedung'),('RENT_EQUIPMENT','Pendapatan Sewa Peralatan'),
                 ('MANAGEMENT_FEE','Management Fee'),('CASH_VARIANCE','Selisih Kas'),
                 ('ASSET_DISPOSAL','Laba (Rugi) Pelepasan Aset'),('INCOME_OTHER','Pendapatan (Biaya) Lain-Lain')]),
 ('cost_kind',[('COGS','Harga Pokok Pembelian'),('PURCHASE_DISCOUNT','Potongan Pembelian')]),
 ('loss_kind',[('SHRINKAGE','Kehilangan Barang atau Selisih Stock Opname'),
               ('DAMAGE','Biaya Kerusakan Persediaan Barang Dagangan')]),
]
for fam,vals in HAND:
    for code,name in vals: add(fam,code,name)   # no single client leaf behind these

# ---- asset classes: the client's own asset sub-types ----------------------
ASSET_FAM = {'1021501':'PPE','1021502':'PPE','1021503':'PPE','1021504':'PPE','1021505':'PPE','1021506':'PPE',
             '1021507':'OE','1021701':'INTANGIBLE','1031802':'DEFERRED','1031803':'PPE'}
# `1031802` holds the deferred cost AND its accumulated amortisation in one
# family. Only the first is an asset class; the second is the contra account
# that 0289 turns into `1619`, and letting it through would give the register a
# "class" of asset that nobody can ever buy.
NOT_A_CLASS = {'1031802002'}
classes=collections.OrderedDict()
for c,n in tmpl:
    kind=ASSET_FAM.get(c[:7])
    if not kind or c in NOT_A_CLASS: continue
    code=slug(n)
    if code in classes: continue
    classes[code]=(kind,n,c)

def q(s): return "'" + s.replace("'","''") + "'"
with open('outputs/coa_thirty/0287-data.sql','w') as f:
    f.write("INSERT INTO line_category (category_code, family, name, sort_order, legacy_code) VALUES\n")
    f.write(",\n".join(f"    ({q(c)}, {q(fam)}, {q(n)}, {i}, {q(lg) if lg else 'NULL'})"
                        for c,(fam,n,i,lg) in cats.items()))
    f.write(";\n\nINSERT INTO asset_class (class_code, name, kind, legacy_code) VALUES\n")
    f.write(",\n".join(f"    ({q(c)}, {q(n)}, {q(k)}, {q(lg)})" for c,(k,n,lg) in classes.items()))
    f.write(";\n")
json.dump({'categories':{c:{'family':f_,'name':n} for c,(f_,n,_,_l) in cats.items()},
           'classes':{c:{'kind':k,'name':n} for c,(k,n,_) in classes.items()},
           'leaf_category': leaf,
           'leaf_class': {c: code for code,(k,n,c) in classes.items()}},
          open('outputs/coa_thirty/categories.json','w'), indent=1, ensure_ascii=False)
print("categories:", len(cats), dict(collections.Counter(v[0] for v in cats.values())))
print("asset classes:", len(classes), dict(collections.Counter(v[0] for v in classes.values())))
