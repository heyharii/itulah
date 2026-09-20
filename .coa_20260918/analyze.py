import csv,json,re,collections,pathlib

ROOT=pathlib.Path('/Users/hari/itulah/.coa_20260918')
src='/Users/hari/Downloads/Laporan_Master_Account1.csv'
rows=list(csv.reader(open(src,encoding='utf-8-sig')))
accounts=[]
for i,r in enumerate(rows,1):
    if len(r)>4 and r[1].strip().isdigit():
        accounts.append(dict(source_row=i,code=r[1].strip(),name=r[2].strip(),flag=r[3].strip(),level=int(r[4].strip())))
bycode={a['code']:a for a in accounts}
parents=set()
for a in accounts:
    for n in range(1,len(a['code'])):
        if a['code'][:n] in bycode: parents.add(a['code'][:n])
for a in accounts:
    a['role']='Heading' if a['code'] in parents else 'Leaf candidate'
    a['base']=a['code'][:10] if len(a['code'])==12 else (a['code'] if a['role']=='Leaf candidate' else '')
    a['branch']=('HO' if a['code'][-2:]=='00' else 'C'+a['code'][-2:].zfill(3)) if len(a['code'])==12 else ''

# Thirty proposed natural accounts. Classification detail is compulsory where a main account combines reporting lines.
coa=[
['1100','Kas, bank dan deposito','Asset','Debit','Cash/bank register; instrument type; maturity; currency'],
['1200','Piutang dagang dan settlement','Asset','Debit','Customer/acquirer; open item; payment method'],
['1210','Piutang lainnya dan antarunit','Asset','Debit','Counterparty; receivable type; related unit; maturity'],
['1290','Cadangan kerugian piutang','Contra asset','Credit','Receivable class; counterparty or allowance pool'],
['1300','Persediaan','Asset','Debit','Item; warehouse; inventory class; in-transit status'],
['1390','Cadangan penurunan persediaan','Contra asset','Credit','Inventory class; valuation/allowance schedule'],
['1400','Biaya dibayar dimuka dan uang muka','Asset','Debit','Prepayment/advance type; schedule; counterparty; maturity'],
['1410','Pajak dibayar dimuka dan dapat dipulihkan','Asset','Debit','Tax type; recoverability; period; tax document'],
['1500','Aset tetap dan konstruksi dalam pengerjaan','Asset','Debit','Asset register; asset class; project; ready-for-use status'],
['1590','Akumulasi penyusutan aset tetap','Contra asset','Credit','Asset register; asset class; depreciation schedule'],
['1600','Aset takberwujud dan aset tangguhan lainnya','Asset','Debit','Asset type; recognition basis; amortization schedule'],
['1690','Akumulasi amortisasi','Contra asset','Credit','Intangible/deferred asset type; amortization schedule'],
['2100','Hutang pemasok','Liability','Credit','Vendor; invoice/open item; payable type; maturity'],
['2110','Giro keluar dan clearing pembayaran','Liability','Credit','Bank account; giro/instrument; settlement status'],
['2200','Akrual, hutang lainnya dan antarunit','Liability','Credit','Liability type; counterparty; related unit; maturity'],
['2300','Hutang pajak','Liability','Credit','Tax type; period; tax document'],
['2400','Pinjaman jatuh tempo jangka pendek','Liability','Credit','Loan contract; lender; maturity schedule'],
['2500','Pinjaman jangka panjang','Liability','Credit','Loan contract; lender; maturity schedule'],
['2600','Uang muka pelanggan','Liability','Credit','Customer; order/contract; advance balance'],
['3100','Modal dan prive','Equity','Credit / contra debit','Owner; equity component; separate capital and drawings reporting'],
['3200','Saldo laba','Equity','Credit / loss debit','Earnings component; closing period; current profit from P&L'],
['4100','Penjualan barang','Revenue','Credit','Sales channel; payment method; item/category where available'],
['4190','Retur dan potongan penjualan','Contra revenue','Debit','Adjustment type; original sale; channel; payment method'],
['4200','Pendapatan jasa dan pendapatan lainnya','Revenue','Credit','Income type; counterparty; operating/non-operating report line'],
['5100','Harga pokok penjualan','Cost of sales','Debit','Cost type; item/category; inventory movement; contra purchase discount'],
['6100','Beban pegawai','Expense','Debit','Expense type; function/cost center; payroll reference'],
['6200','Beban operasional lainnya','Expense','Debit','Expense type; function/cost center; report line'],
['6300','Beban penyusutan dan amortisasi','Expense','Debit','Asset class; depreciation/amortization type; function'],
['7100','Beban keuangan','Expense','Debit','Finance cost type; loan/lender; function where relevant'],
['8100','Beban pajak penghasilan','Expense','Debit','Current/deferred tax type; tax provision; period'],
]
assert len(coa)==30
gls={x[0] for x in coa}
units=['HEAD OFFICE','CIKUPA','MUARO BUNGO','PURBALINGGA','BUMIAYU','JAMBI','WIRAMODE','BREBES','PASURUAN','WMJB','WMBA','SIPIN','BANJARAN','WONOSOBO']
bases=[a for a in accounts if len(a['code'])==10 or (a['role']=='Leaf candidate' and len(a['code'])<10)]
rules=[]
for a in bases:
    c,n=a['code'],a['name']; u=n.upper(); gl=''; detail=''; dims={}; issues=[]
    bank=re.search(r'\b(BCA|MANDIRI|BRI|BNI|DANAMON|BTN)\b',u)
    if bank: dims['bank_name']=bank.group(1)
    if c.startswith(('10214','201230','1011203','1011204')):
        for unit in units:
            if u.endswith(unit):
                dims['related_unit_name']=unit
                break
    def use(g,d):
        global gl,detail
        gl,detail=g,d
    if c.startswith('1011001'):
        use('1100',{'001':'Cash on hand','002':'Petty cash','003':'Till float'}[c[-3:]])
    elif c.startswith(('1011002','1011003','1011004')):
        use('1100',{'2':'Bank current account','3':'Bank savings account','4':'Term deposit'}[c[6]])
        if c.startswith('1011004'): issues.append('Confirm maturity/restrictions and cash-equivalent vs investment reporting; branch missing on three short accounts.')
    elif c.startswith('1011101'):
        use('1200','Card settlement receivable'); dims['payment_method']='Credit card' if c.endswith('001') else 'Debit card'
    elif c.startswith('1011102'):
        use('1210',n.title())
    elif c.startswith('1011103'):
        use('1290','Receivable allowance'); dims['receivable_class']={'001':'Credit card','002':'Debit card','003':'Employee'}[c[-3:]]
    elif c.startswith('101120'):
        typ=c[6]
        use('1300',{'1':'Merchandise inventory','2':'Shopping bag inventory','3':'Merchandise in transit','4':'Shopping bags in transit'}[typ])
        if typ=='2': dims['item_variant']=n
        if typ in '34': issues.append('Confirm whether named unit is shipment origin or destination; do not equate it to posting branch.')
    elif c.startswith('1011299'):
        use('1390','Inventory allowance'); dims['inventory_class']='Merchandise' if c.endswith('001') else 'Shopping bags'
    elif c.startswith('1011301'):
        use('1400','Prepaid expense'); dims['expense_type']=n
    elif c.startswith('1011302'):
        use('1410','Tax receivable / prepayment'); dims['tax_type']=n.replace('Prepaid - ','')
        issues.append('Verify tax recoverability and legal entity; a prepaid label alone does not establish a recoverable tax asset.')
    elif c.startswith('1011303'):
        use('1400','Advance'); dims['advance_type']=n
    elif c.startswith('10214'):
        use('1210',{'1':'Affiliate financing receivable','2':'Affiliate goods receivable','3':'Other affiliate receivable'}[c[6]])
        issues.append('Confirm same-entity branch vs separate legal entity, counterparty, maturity and elimination treatment.')
    elif c.startswith('10215'):
        use('1500','PPE cost'); dims['asset_class']=bycode[c[:7]]['name']; dims['asset_type']=n
        if c=='1021501002': issues.append('Review HGB/land-right contract and applicable accounting policy before classifying as PPE, lease right or intangible.')
        if c.startswith('1021507'): issues.append('Confirm operating-equipment capitalization policy and asset register before conversion.')
    elif c.startswith('10216'):
        use('1590','Accumulated depreciation'); assetcode='10215'+c[5:]
        dims['asset_type']=bycode[assetcode]['name'] if assetcode in bycode else n
        dims['asset_class']=bycode['10215'+c[5:7]]['name']
        if c.startswith('1021607'): issues.append('Reserve Replacement is provisional: establish whether this is accumulated depreciation, inventory allowance or a provision.')
        if c=='1021601002': issues.append('Review HGB/land-right amortization together with underlying asset classification.')
    elif c.startswith('1021701'):
        use('1600','Software cost'); dims['asset_type']=n
    elif c.startswith('1021702'):
        use('1690','Software accumulated amortization'); dims['asset_type']=bycode['1021701'+c[-3:]]['name']
    elif c=='1031801001':
        detail='Disposed inventory'; issues.append('Unresolved: determine whether balance is inventory, disposal loss or disposed fixed assets. Route to 1300, 5100/6200 or asset disposal entries from evidence.')
    elif c=='1031802001':
        use('1600','Pre-opening deferred cost'); issues.append('Provisional legacy carry-forward only. Review recognition basis; do not assume pre-opening costs qualify as assets. Approved adjustments may be required.')
    elif c=='1031802002':
        use('1690','Pre-opening accumulated amortization'); issues.append('Review with pre-opening cost balance and recognition policy before migration.')
    elif c=='1031803001':
        detail='Contract in progress'; issues.append('Unresolved: confirm construction asset (1500) vs customer contract/receivable (1210 or additional account). Name alone is insufficient.')
    elif c.startswith('2012001'):
        use('2100',{'001':'Merchandise supplier payable','002':'Supplier payable suspense','003':'Non-merchandise supplier payable'}[c[-3:]])
        if c.endswith('002'): issues.append('Resolve supplier suspense items and preserve invoice/vendor reconciliation.')
    elif c.startswith('2012002') or c=='204001':
        use('2110','Outgoing giro clearing')
        if c=='204001': issues.append('Standalone code: supply bank, branch and settlement detail; check overlap with outstanding giro accounts.')
    elif c.startswith('2012101'):
        use('2300','Tax payable'); dims['tax_type']=n
    elif c.startswith('2012201'):
        use('2200','Accrued expense'); dims['expense_type']=n
    elif c.startswith('201230'):
        use('2200',{'1':'Affiliate financing payable','2':'Affiliate goods payable','3':'Principal payable','4':'Other payable'}[c[6]])
        issues.append('Confirm counterparty, legal-entity relationship and maturity; preserve interunit matching without netting balances.')
    elif c.startswith('20125'):
        use('2400','Current portion of loan'); dims['lender_type']='Principal' if c.startswith('2012501') else 'Bank'
    elif c.startswith('20224'):
        use('2500','Long-term loan'); dims['lender_type']='Principal' if c.startswith('2022401') else 'Bank'
    elif c=='205001':
        use('2600','Customer advance'); issues.append('Standalone code: supply branch, customer and order/contract reference.')
    elif c.startswith('3013001'):
        gl={'001':'3100','002':'3200','003':'3200','004':'3100'}[c[-3:]]
        detail={'001':'Paid-in capital','002':'Retained earnings','003':'Current-period result (closing control)','004':'Owner drawings'}[c[-3:]]
        if c.endswith('003'): issues.append('Closing control only: reconcile current result with P&L. Never import both current-result balances and the same underlying P&L twice.')
    elif c.startswith('40101'):
        use('4100','Merchandise sales')
        if c.startswith('4010110'): dims['payment_method']='Cash'
        elif c.startswith('4010111'): dims['payment_method']='Debit card'
        elif c.startswith('4010112'):
            dims['payment_method']='Credit card'; dims['card_scheme']='Visa' if c.endswith('001') else 'Mastercard'
        else: dims['sales_channel']='Own online' if c.endswith('001') else 'Marketplace'
    elif c.startswith('4010213'): use('4190','Sales discount')
    elif c.startswith('4010214'): use('4190','Sales return')
    elif c.startswith('40201'): use('4200','Management fee income')
    elif c.startswith('50101'):
        use('5100','Merchandise purchases / COGS'); issues.append('Source says purchases. Confirm periodic vs perpetual inventory and closing-stock entries before treating as COGS.')
    elif c=='600104':
        use('4200','Other income'); issues.append('Income name under expense prefix: confirm transaction nature and branch.')
    elif c.startswith(('6010111','6010210')):
        use('6100','Payroll and employee benefits'); dims['expense_type']=n; dims['function']='Store operations' if c.startswith('6010111') else 'Office'
        if c.endswith('001'): dims['expense_type']='Gaji / wages'
        if c.endswith('004'): dims['expense_type']='Uang transport'
    elif c.startswith('601'):
        use('6200','Operating expense'); dims['expense_type']=n
        dims['function']='Selling' if c.startswith('6010110') else ('Administration' if c.startswith('6010310') else 'Maintenance')
        if c=='6010110008':
            use('5100','Inventory damage'); issues.append('Confirm damage/write-down presentation and whether adjustment is direct or uses inventory allowance.')
    elif c.startswith('7010110'):
        use('6200','Rent / occupancy'); dims['expense_type']=n
        issues.append('Review lease terms and applicable policy; lease assets/liabilities may require additional accounts beyond this source-based set.')
    elif c.startswith('7010215'):
        use('6200','Operating-equipment replacement'); dims['asset_type']=bycode['1021507'+c[-3:]]['name']; dims['asset_class']='Operating Equipment'
        issues.append('Provisional expense: confirm replacement policy and link to Reserve Replacement balances. May require asset/depreciation treatment.')
    elif c.startswith('701021'):
        use('6300','Amortization' if c.startswith('7010216') else 'Depreciation')
        if c.startswith('7010216'):
            dims['asset_type']={'001':'Seventh Soft Application','002':'Pre Opening','003':'Opti Tex System'}[c[-3:]]
        else:
            assetcode='102150'+str(int(c[6])+2)+c[-3:]
            dims['asset_type']=bycode[assetcode]['name']; dims['asset_class']=bycode[assetcode[:7]]['name']
        if c=='7010216002': issues.append('Review pre-opening amortization together with the underlying deferred cost.')
    elif c.startswith(('701031','702031')):
        use('6200','Operating expense'); dims['expense_type']=n
    elif c.startswith('8010110'):
        end=c[-3:]
        if end=='001': use('4200','Bank interest income')
        elif end=='002':
            use('6200','Rounding difference'); issues.append('Confirm treatment of rounding gains/losses and report-line rules.')
        elif end=='003':
            use('5100','Purchase discount (contra cost)'); issues.append('Allocate purchase discounts to inventory/COGS consistently with inventory policy; do not treat automatically as other income.')
        elif end in ('004','005'): use('4200','Building rental income' if end=='004' else 'Equipment rental income')
        elif end=='006':
            use('5100','Inventory shrinkage / stocktake difference'); issues.append('Confirm shrinkage presentation and source of adjustment; retain gains/losses and inventory reconciliation.')
        else:
            detail='Mixed other income / expense'; issues.append('Unresolved: split by transaction substance into 4200 income or 6200 expense. Debit/credit sign alone is insufficient because reversals exist.')
    elif c.startswith('8020111'):
        use('7100','Bank loan interest' if c.endswith('001') else 'Lease interest')
    elif c.startswith('8030112'):
        detail='Current tax / PPh 25'; issues.append('Unresolved: tax instalment/prepayment belongs in 1410; assessed income-tax expense belongs in 8100. Inspect tax provision and payment entries.')
    else: raise ValueError((c,n))
    if gl: assert gl in gls
    rules.append(dict(base=c,name=n,gl=gl,detail=detail,defaults=dims,review=' '.join(issues),decision='Unresolved' if not gl else ('Review required' if issues else 'Proposed')))

detailids={}
for r in rules:
    key=(r['gl'],r['detail'])
    if key not in detailids: detailids[key]='D'+str(len(detailids)+1).zfill(3)
    r['detail_id']=detailids[key]
rulemap={r['base']:r for r in rules}
leaf=[a for a in accounts if a['role']=='Leaf candidate']
for a in leaf: assert a['base'] in rulemap
for a in accounts:
    if a['role']=='Leaf candidate':
        r=rulemap[a['base']]
        a['gl']=r['gl'];a['detail_id']=r['detail_id'];a['decision']=r['decision']
        # Branch is inferred from the consistent code suffix, never from the name's related unit.
        a['data_note']='Flag N: source meaning unconfirmed; preserve history.' if a['flag']=='N' else ''
        if len(a['code'])<12: a['data_note']+=' Posting branch not present in source.'
        if len(a['code'])==12 and not re.search(r'(?:HO|C\d{3})$',a['name']): a['data_note']+=' Name suffix typo; branch inferred from code.'
    else: a.update(gl='',detail_id='',decision='',data_note='Hierarchy inferred from code prefix; verify posting restrictions.')

stats=dict(rows=len(accounts),parents=len(parents),leaves=len(leaf),twelve_digit=sum(len(a['code'])==12 for a in accounts),base_rules=len(rules),detail_types=len(detailids),flag_n=sum(a['flag']=='N' for a in accounts),unresolved=sum(not a['gl'] for a in leaf),review=sum(a['decision']=='Review required' for a in leaf),proposed=sum(a['decision']=='Proposed' for a in leaf),branch_count=14)
data=dict(accounts=accounts,coa=coa,rules=rules,stats=stats,units=units)
(ROOT/'data.json').write_text(json.dumps(data,ensure_ascii=False,indent=2))
print(json.dumps(stats,indent=2));print('TARGET COUNTS',dict(collections.Counter(a['gl'] or 'UNRESOLVED' for a in leaf)))
print('DETAIL TYPES',len(detailids));print('RULE DECISIONS',dict(collections.Counter(r['decision'] for r in rules)))
