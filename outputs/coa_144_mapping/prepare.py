import csv, json, re
from pathlib import Path

ROOT = Path('/Users/hari/itulah')
OUT = ROOT / 'outputs/coa_144_mapping'
OUT.mkdir(parents=True, exist_ok=True)

core_path = ROOT / 'outputs/jev_final_result/final_core_accounts_121.csv'
register_path = ROOT / 'outputs/jev_final_result/final_register.json'
data_path = ROOT / '.coa_dimension_review_20260918/data.json'

core = list(csv.DictReader(core_path.open(encoding='utf-8-sig')))
register = json.load(register_path.open())
data = json.load(data_path.open())

# Start from the approved 121, then replace three labels/keys with client-traceable families.
targets = []
for r in core:
    r = dict(r)
    if r['target_key'] == 'AP:GRNI':
        r.update(target_key='AP:MERCH_SUSPENSE', target_account_name='Hutang Supplier Barang Dagang - Suspend', status='CLIENT_RETAIN', dimensions='supplier_id, po_id, receipt_id, invoice_id')
    elif r['target_key'] == 'LOAN:CURRENT_BANK':
        r.update(target_key='LOAN:BANK', target_account_name='Pinjaman Bank', status='CLIENT_RETAIN', dimensions='bank_account_id, facility_id, maturity_schedule_id, cost_center')
    elif r['target_key'] == 'COGS:LOSS':
        r.update(target_key='COGS:INVENTORY_DAMAGE', target_account_name='Biaya Kerusakan/Kehilangan Persediaan', status='CLIENT_RETAIN', dimensions='item_id, reason_code, document_id, cost_center')
    targets.append(r)

adds = [
    ('AFFIL:FUNDING','Saldo Affiliasi Pembiayaan','cost_center, funding_document_id','Piutang/Hutang Affiliasi Pembiayaan'),
    ('AFFIL:GOODS','Saldo Affiliasi Atas Barang','cost_center, transfer_document_id','Piutang/Hutang Affiliasi Atas Barang'),
    ('AFFIL:OTHER','Saldo Affiliasi Lain-lain','cost_center, document_id, reason_code','Piutang Affiliasi Lain-lain'),
    ('INTANGIBLE:SOFTWARE_COST','Software / Intangible Asset','asset_id, software_id, cost_center','Software; Seventh Soft; Opti Tex'),
    ('INTANGIBLE:SOFTWARE_ACCUM','Akumulasi Amortisasi Software','asset_id, software_id, cost_center','Acc Amort Software'),
    ('COGS:HPP','Harga Pokok Pembelian / HPP','item_id, division_id, cost_center','Harga Pokok Pembelian 5010110001'),
    ('CONTRA:PURCHASE_DISCOUNT','Potongan Pembelian','supplier_id, invoice_id, item_id, cost_center','Potongan Pembelian 8010110003'),
    ('ASSET:CIP','Contract in Progress (CIP)','project_id, asset_id, cost_center','Contract In Progress 1031803001'),
    ('LOAN:PRINCIPAL','Pinjaman Principal','principal_id, facility_id, maturity_schedule_id, cost_center','PJP Principal; Pinjaman Jangka Panjang Principal'),
    ('LIAB:PRINCIPAL_OTHER','Hutang Principal / Pihak Berelasi','principal_id, document_id, cost_center','Hutang Lain-lain Principal'),
    ('TAX:INCOME_EXPENSE','Pajak Penghasilan / Beban Pajak Kini','tax_code, tax_period, cost_center','Current Tax Inc/Exp PPh Pasal 25 8030112001'),
    ('MIXED:OTHER','Pendapatan (Biaya) Lain-lain','reason_code, source_document_id, cost_center','Pendapatan (Biaya) Lain-Lain 8010110007'),
    ('INV:DISPOSED','Disposed Inventory','item_id, disposal_document_id, reason_code, cost_center','Disposed Inventory 1031801001'),
    ('OPEX:REPLACEMENT_OE','Biaya Replacement OE','asset_id, oe_type, reason_code, cost_center','Biaya Replacement OE families'),
    ('LAND:HGB_COST','Hak Sewa Tanah / HGB','facility_id, contract_id, cost_center','Hak Sewa Tanah/HGB 1021501002'),
    ('LAND:HGB_ACCUM','Akumulasi Amortisasi Land Right / HGB','facility_id, contract_id, cost_center','Acc Land Right/HGB 1021601002'),
    ('LAND:HGB_EXPENSE','Biaya Land Right','facility_id, contract_id, cost_center','Biaya Land Right 7010110002'),
    ('OPEX:LAND_RENT','Biaya Sewa Tanah','facility_id, contract_id, cost_center','Biaya Sewa Tanah 7010110001'),
    ('OPEX:STORE_RENT','Biaya Sewa Bangunan Toko dan Gudang','facility_id, contract_id, cost_center','Biaya Sewa Bangunan Toko/Gudang 7010110003'),
    ('OPEX:MESS_RENT','Biaya Sewa Rumah Dinas / Mess','facility_id, contract_id, cost_center','Biaya Sewa Rumah Dinas/Mess 7010110004'),
    ('PREOPEN:COST','Pre Opening','project_id, opening_id, cost_center','Pre Opening 1031802001'),
    ('PREOPEN:ACCUM','Akumulasi Amortisasi Pre Opening','project_id, opening_id, cost_center','Acc Amort Pre Opening 1031802002'),
    ('PREOPEN:EXPENSE','Biaya Amortisasi Pre Opening','project_id, opening_id, cost_center','Biaya Amortisasi Pre Opening 7010216002'),
]
for key, name, dims, trace in adds:
    targets.append({'target_key':key,'target_account_name':name,'status':'CLIENT_RETAIN','legacy_family_count':'','legacy_detail_rows':'','dimensions':dims,'evidence_required':trace})

# This workbook presents the approved production design, so prior review-stage
# labels such as CONDITIONAL_MERGE are normalized to one final core status.
for r in targets:
    r['status'] = 'CORE'

assert len(targets) == 144, len(targets)
assert len({r['target_key'] for r in targets}) == 144
target_by_key = {r['target_key']:r for r in targets}

family_by_base = {f['legacy_base']: f for f in register['families']}

def override(base, name, existing_key):
    n = re.sub(r'\s+', ' ', name.upper()).strip()
    # Client-only corrections and explicit owner decisions.
    if 'AFFILIASI' in n:
        if 'PEMBIAYAAN' in n: return 'AFFIL:FUNDING', 'Cost center replaces unit copies; internal control balance.'
        if 'ATAS BARANG' in n: return 'AFFIL:GOODS', 'Cost center replaces unit copies; goods flow remains separate.'
        return 'AFFIL:OTHER', 'Cost center replaces unit copies; controlled other-affiliation reason.'
    if base in {'1021701001','1021701002'} or (('SOFT' in n or 'OPTI TEX' in n) and 'ACC' not in n and 'AMORT' not in n and 'MAINT' not in n):
        return 'INTANGIBLE:SOFTWARE_COST', 'Software identity moves to intangible asset register.'
    if base in {'1021702001','1021702002'} or ('ACC AMORT' in n and ('SOFT' in n or 'OPTI' in n)):
        return 'INTANGIBLE:SOFTWARE_ACCUM', 'Software identity moves to intangible asset register.'
    if base == '5010110001' or 'HARGA POKOK PEMBELIAN' in n: return 'COGS:HPP', 'Client HPP family retained; unit/division become dimensions.'
    if base == '8010110003' or 'POTONGAN PEMBELIAN' in n: return 'CONTRA:PURCHASE_DISCOUNT', 'Client purchase discount family retained separately.'
    if base == '1031803001' or 'CONTRACT IN PROGRESS' in n: return 'ASSET:CIP', 'CIP lifecycle retained; project and site become dimensions.'
    if 'PJP JATUH TEMPO' in n and 'PRINCIPAL' in n: return 'LOAN:PRINCIPAL', 'Current/non-current derived from maturity schedule.'
    if 'PINJAMAN JANGKA PANJANG' in n and 'PRINCIPAL' in n: return 'LOAN:PRINCIPAL', 'Current/non-current derived from maturity schedule.'
    if 'HUTANG LAIN-LAIN PRINCIPAL' in n: return 'LIAB:PRINCIPAL_OTHER', 'One account replaces unit copies pending proof of formal-loan substance.'
    if ('PJP JATUH TEMPO' in n and 'BANK' in n) or ('PINJAMAN JANGKA PANJANG' in n and 'BANK' in n): return 'LOAN:BANK', 'Bank and maturity move to loan schedule.'
    if base == '8030112001' or 'CURRENT TAX INC/EXP' in n: return 'TAX:INCOME_EXPENSE', 'One tax-expense family; unit becomes cost center.'
    if base == '8010110007' or 'PENDAPATAN (BIAYA) LAIN-LAIN' in n: return 'MIXED:OTHER', 'One controlled client family; unit becomes cost center.'
    if base == '1031801001' or 'DISPOSED INVENTORY' in n: return 'INV:DISPOSED', 'Controlled disposal clearing; item/site in document.'
    if base == '6010110008' or 'KERUSAKAN PERSEDIAAN' in n: return 'COGS:INVENTORY_DAMAGE', 'One damage/loss account; item, cause and site become dimensions.'
    if existing_key == 'COGS:LOSS' or 'SELISIH STOCK OPNAME' in n: return 'COGS:INVENTORY_DAMAGE', 'Damage, loss and stock-count differences use one governed account with reason codes.'
    if base.startswith('1021607') or base.startswith('7010215') or 'REPLACEMENT OE' in n: return 'OPEX:REPLACEMENT_OE', 'Item-specific reserve/expense accounts collapse to one expense; capital items use OE assets.'
    if base == '1021501002' or 'HAK SEWA TANAH' in n: return 'LAND:HGB_COST', 'Facility/contract/site become dimensions.'
    if base == '1021601002' or ('LAND RIGHT' in n and ('AKUM' in n or 'ACC' in n)): return 'LAND:HGB_ACCUM', 'Facility/contract/site become dimensions.'
    if base == '7010110002' or 'BIAYA LAND RIGHT' in n: return 'LAND:HGB_EXPENSE', 'Facility/contract/site become dimensions.'
    if base == '7010110001' or 'BIAYA SEWA TANAH' in n: return 'OPEX:LAND_RENT', 'Facility/contract/site become dimensions.'
    if base == '7010110003' or 'SEWA BANGUNAN TOKO' in n: return 'OPEX:STORE_RENT', 'Facility/contract/site become dimensions.'
    if base == '7010110004' or 'SEWA RUMAH DINAS' in n: return 'OPEX:MESS_RENT', 'Facility/contract/site become dimensions.'
    if base == '1031802001' or n == 'PRE OPENING': return 'PREOPEN:COST', 'Opening project/site become dimensions.'
    if base == '1031802002' or 'AKUMULASI AMORTISASI PRE OPENING' in n: return 'PREOPEN:ACCUM', 'Opening project/site become dimensions.'
    if base == '7010216002' or 'AMORTISASI BIAYA PRE OPENING' in n: return 'PREOPEN:EXPENSE', 'Opening project/site become dimensions.'
    if 'GIRO KELUAR' in n: return 'LIAB:OUTSTANDING_GIRO', 'Giro Keluar retired; future lifecycle uses Outstanding Giro.'
    if base == '2012001002' or 'BARANG DAGANG - SUSPEND' in n: return 'AP:MERCH_SUSPENSE', 'Existing client suspend family retained; no invented GRNI.'
    return existing_key, 'Mapped by prior family review; unit identity moves to dimensions where applicable.'

mapping = []
unmapped_posting = []
for a in data['accounts']:
    base = a.get('base','')
    fam = family_by_base.get(base)
    key = fam['target_key'] if fam else ''
    rationale = ''
    if base:
        key, rationale = override(base, a['name'], key)
    if key and key not in target_by_key:
        # A family target omitted from the approved 121 must be resolved by explicit overrides above.
        key = ''
    t = target_by_key.get(key, {})
    role = a.get('role','')
    is_posting = a.get('role','').startswith('Akun detail')
    derived_profit = base == '3013001003' or 'LABA (RUGI) BULAN BERJALAN' in a['name'].upper()
    if is_posting and not key and not derived_profit:
        unmapped_posting.append((a['code'], a['name'], base, fam['target_key'] if fam else ''))
    mapping.append({
        'source_row':a['source_row'], 'legacy_code':a['code'], 'legacy_name':a['name'],
        'level':a['level'], 'role':role, 'legacy_family':base, 'legacy_unit':a.get('unit',''),
        'target_key':key, 'target_account':t.get('target_account_name',''),
        'dimensions':t.get('dimensions',''),
        'mapping_status':'MAPPED' if key else ('SYSTEM_DERIVED' if derived_profit else ('HIERARCHY' if not is_posting else 'UNMAPPED')),
        'mapping_note':rationale if key else ('Current-period profit is calculated from P&L and closed to retained earnings; no manual posting account.' if derived_profit else ('Reporting hierarchy; no posting target.' if not is_posting else 'Requires review.'))
    })

print('accounts',len(mapping),'posting',sum(1 for x in mapping if x['level']==12),'targets',len(targets),'unmapped_posting',len(unmapped_posting))
if unmapped_posting:
    print('sample unmapped',unmapped_posting[:30])
    raise SystemExit(1)

with (OUT/'targets_144.json').open('w') as f: json.dump(targets,f,ensure_ascii=False,indent=2)
with (OUT/'mapping_all_accounts.json').open('w') as f: json.dump(mapping,f,ensure_ascii=False)
with (OUT/'mapping_all_accounts.csv').open('w',newline='',encoding='utf-8-sig') as f:
    w=csv.DictWriter(f,fieldnames=mapping[0].keys()); w.writeheader(); w.writerows(mapping)
with (OUT/'targets_144.csv').open('w',newline='',encoding='utf-8-sig') as f:
    w=csv.DictWriter(f,fieldnames=targets[0].keys()); w.writeheader(); w.writerows(targets)
