import csv
import json
import re
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path('/Users/hari/itulah')
SRC = ROOT / '.coa_dimension_review_20260918/data.json'
OUT = ROOT / 'outputs/jev_final_result'
OUT.mkdir(parents=True, exist_ok=True)

data = json.loads(SRC.read_text())
rules = data['rules']

def result(key, name, status='RETAIN', dimension='', rationale='', evidence=''):
    return dict(target_key=key, target_name=name, decision_status=status,
                target_dimension=dimension, jev_rationale=rationale,
                evidence_required=evidence)

def asset_class(name):
    u = name.upper()
    if 'HGB' in u or 'LAND RIGHT' in u or 'HAK SEWA TANAH' in u or 'HAK  PENGELOLAAN TANAH' in u:
        return 'HGB', 'Hak Tanah / HGB'
    if 'TANAH HAK MILIK' in u:
        return 'LAND', 'Tanah Hak Milik'
    if 'BANGUNAN' in u or 'STAFF HOUSE' in u or 'MESS' in u:
        return 'BUILDING', 'Bangunan'
    if 'MEKANIKAL' in u or 'MECHANICAL' in u or 'ELECTRICAL' in u:
        return 'ME', 'Instalasi Mekanikal dan Elektrikal'
    if any(x in u for x in ['AIR CONDITION', 'LIFT', 'ESKALATOR', 'GENSET']):
        return 'MACHINE', 'Mesin dan Peralatan'
    if 'MOBIL' in u or 'SEPEDA MOTOR' in u or 'KENDARAAN' in u:
        return 'VEHICLE', 'Kendaraan'
    if 'FFE' in u or 'FURNITURE' in u:
        return 'FFE', 'Furniture, Fixture and Equipment'
    if 'SOFTWARE' in u or 'SEVENT' in u or 'OPTI TEX' in u:
        return 'SOFTWARE', 'Software'
    if any(x in u for x in ['RACK', 'RAK ', 'PAJANGAN', 'MEJA', 'BOX OB', 'HOLO', 'BREKET', 'BELALAI', 'PATUNG', 'HANGER', 'PIN /', 'KERANJANG']):
        return 'OE', 'Operating Equipment'
    return 'OTHER', 'Aset Lainnya'

payroll_order = {}
payroll_rows = [r for r in rules if r.get('dimension_label') == 'Komponen payroll']
for i, r in enumerate(payroll_rows):
    payroll_order[r['base']] = i % 13 + 1
payroll_names = [
    'Gaji', 'Lembur', 'Uang Makan', 'Transport', 'Kesehatan dan Pengobatan',
    'Asuransi Pegawai / BPJS', 'THR', 'Seragam Kerja', 'Sport dan Rekreasi',
    'Funeral Contribution', 'Pengembangan SDM', 'Pesangon', 'Komisi / Bonus / Insentif'
]

def decide(r):
    b, n, dim = r['base'], r['family_name'], r.get('dimension_label') or ''
    u = n.upper()
    # Cash and banking
    if dim == 'Kas / lokasi kas':
        return result('CASH:'+b, n, 'RETAIN', 'cash_location_id, site_id', 'Different physical-cash purposes remain separate pending control review.')
    if dim == 'Rekening bank':
        if 'GIRO' in u: k, nm = 'BANK:GIRO', 'Bank - Giro'
        elif 'TABUNGAN' in u: k, nm = 'BANK:SAVINGS', 'Bank - Tabungan'
        else: k, nm = 'BANK:DEPOSIT', 'Deposito Berjangka'
        return result(k, nm, 'CONDITIONAL_MERGE', 'bank_account_id, associated_site_id', 'Bank identity is subledger detail.', 'Bank master and reconciliation; deposit maturity/restriction schedule.')
    if dim == 'Rekening bank / giro':
        if 'GIRO KELUAR' in u:
            return result('LIAB:GIRO_OUT', 'Giro Keluar', 'UNRESOLVED_EVIDENCE', 'instrument_id', 'Nature not proven identical to outstanding giro.', 'Posting lifecycle and counterpart accounts.')
        return result('LIAB:OUTSTANDING_GIRO', 'Outstanding Giro', 'CONDITIONAL_MERGE', 'bank_account_id, instrument_id', 'Bank name is instrument detail.', 'Issue, clearing and cancellation lifecycle reconciliation.')
    # Receivables and inventory
    if dim == 'Tender / acquirer':
        return result('AR:ACQUIRER', 'Piutang Acquirer Kartu', 'CONDITIONAL_MERGE', 'tender_type, acquirer_id', 'Tender identity belongs in settlement subledger.', 'Settlement, fee and chargeback reconciliation.')
    if dim == 'Pihak terkait':
        return result('AR:EMPLOYEE', 'Piutang Pegawai dan Manajemen', 'CONDITIONAL_MERGE', 'person_id, role_type', 'Role is party detail.', 'Terms, authorization, aging and tax/disclosure review.')
    if dim == 'Kelas piutang':
        if 'PEGAWAI' in u:
            k, nm = 'ALLOW:EMPLOYEE_AR', 'Cadangan Piutang Pegawai'
        else:
            k, nm = 'ALLOW:CARD_AR', 'Cadangan Piutang Acquirer Kartu'
        return result(k, nm, 'CONDITIONAL_MERGE', 'receivable_class', 'Allowance stays separate from gross receivable.', 'Loss method and write-off posting review.')
    if dim == 'Item / gudang':
        if 'PERSEDIAAN BARANG DAGANGAN' in u:
            return result('INV:MERCH', 'Persediaan Barang Dagangan', 'RETAIN', 'item_id, warehouse_id, site_id', 'Merchandise remains a distinct inventory nature.')
        return result('INV:BAGS', 'Persediaan Kantong Belanja', 'CONDITIONAL_MERGE', 'item_id, material, size, warehouse_id', 'Bag material and size are item attributes.', 'Recognition, valuation, counting and issue policy.')
    if dim == 'Item / transit':
        if 'BARANG DAGANGAN' in u: k, nm = 'INV_TRANSIT:MERCH', 'Barang Dagangan dalam Perjalanan'
        else: k, nm = 'INV_TRANSIT:BAGS', 'Kantong Belanja dalam Perjalanan'
        return result(k, nm, 'CONDITIONAL_MERGE', 'shipment_id, origin_site_id, destination_site_id', 'Location belongs in shipment workflow.', 'Ownership cut-off and shipment reconciliation.')
    if dim == 'Kelas stok':
        return result('ALLOW:INVENTORY', 'Cadangan Kerusakan/Kehilangan Persediaan', 'CONDITIONAL_MERGE', 'inventory_class', 'Allowance is separate from gross inventory.', 'Measurement method and roll-forward.')
    # Schedules, tax, advances
    if dim == 'Jenis biaya + jadwal':
        if 'SEWA' in u: k, nm = 'PREPAID:RENT', 'Sewa Dibayar Dimuka'
        else: k, nm = 'PREPAID:GENERAL', 'Biaya Dibayar Dimuka'
        return result(k, nm, 'CONDITIONAL_MERGE', 'prepaid_type, contract_id, schedule_id', 'Prepaid type belongs in schedule.', 'Contract, recognition and amortization reconciliation.')
    if dim == 'Jenis pajak':
        if b.startswith('101'):
            if any(x in u for x in ['PPH PASAL 21','PPH PASAL 25','PPH PASAL 29']): k,nm='TAX_ASSET:INCOME','Kredit/Pajak Penghasilan Dibayar Dimuka'
            elif 'VAT' in u or 'PPN MASUKAN' in u: k,nm='TAX_ASSET:INPUT_VAT','PPN Masukan'
            elif 'LAND TAX' in u or 'PBB' in u: k,nm='TAX_ASSET:PBB','PBB Dibayar Dimuka'
            else: k,nm='TAX_ASSET:OTHER','Pajak Lain Dibayar Dimuka'
            return result(k,nm,'CONDITIONAL_MERGE','tax_code, tax_period','Tax code belongs in tax ledger.','Tax return and recoverability reconciliation.')
        if b.startswith('201'):
            return result('TAX_LIAB:PAYABLE','Hutang Pajak','CONDITIONAL_MERGE','tax_code, tax_period','Tax code belongs in tax ledger.','Statutory return, due-date and payment reconciliation.')
        return result('EXCEPTION:CURRENT_TAX','Current Tax PPh 25 - Review','UNRESOLVED_EVIDENCE','tax_code, tax_period','Mixed tax label cannot determine nature.','Entries and tax returns separating expense, credit, payable and true-up.')
    if dim == 'Tujuan uang muka':
        if 'TRAVELL' in u: k,nm='ADV:EMPLOYEE','Uang Muka Karyawan/Perjalanan'
        elif 'OTHER' in u: k,nm='ADV:OTHER','Uang Muka Lainnya'
        else: k,nm='ADV:SUPPLIER','Uang Muka Supplier/Kontraktor'
        return result(k,nm,'CONDITIONAL_MERGE','party_id, advance_purpose, document_id','Purpose and party belong in advance subledger.','Aging, settlement and tax reconciliation.')
    # Interunit single legal entity
    if dim == 'Pihak antarunit':
        return result('', 'Tidak ada akun afiliasi permanen', 'DEACTIVATE_AFTER_RECLASS', 'site_id, transfer/shipment reference', 'All sites are within one PT Perorangan.', 'Trace, match, reclassify and reconcile every legacy balance.')
    # Assets
    if dim == 'Register / kelas aset':
        cls, label = asset_class(n)
        if b.startswith('10215'): nature='COST'; nm=label
        elif b.startswith('10216'): nature='ACCUM'; nm='Akumulasi '+label
        else: nature='EXP'; nm='Beban Penyusutan/Amortisasi '+label
        status='UNRESOLVED_EVIDENCE' if cls=='HGB' or 'PRE OPENING' in u else 'CONDITIONAL_MERGE'
        ev='Legal right/policy and posting review.' if status=='UNRESOLVED_EVIDENCE' else 'Asset register, useful-life policy and GL reconciliation.'
        return result(f'ASSET:{nature}:{cls}',nm,status,'asset_id, asset_class_id, associated_site_id', 'Asset identity belongs in register; cost, accumulated and expense remain separate.',ev)
    if dim == 'Register aset':
        return result('ASSET:RESERVE_OE','Reserve Replacement Operating Equipment','UNRESOLVED_EVIDENCE','asset_id, item_class','May compress only after balance-sheet nature is proven.','Entries, normal balance, counterpart, policy and roll-forward.')
    if dim == 'Item / aset':
        return result('EXCEPTION:DISPOSED','Disposed Inventory - Review','UNRESOLVED_EVIDENCE','item_id, asset_id','Label does not establish inventory, asset disposal, clearing or loss.','Transaction and counterpart review.')
    if dim == 'Dasar pengakuan':
        return result('EXCEPTION:PREOPEN:'+b,n,'UNRESOLVED_EVIDENCE','project_id','Legacy account does not prove asset recognition.','Capitalization policy and transaction review.')
    if dim == 'Proyek / kontrak':
        return result('EXCEPTION:CIP','Contract in Progress - Review','UNRESOLVED_EVIDENCE','project_id, contract_id','Could be own-asset CIP or customer contract.','Contract and posting-flow review.')
    # Payables/accruals/loans
    if dim == 'Supplier':
        return result('AP:MERCH' if 'BARANG DAGANGAN' in u else 'AP:NONMERCH', n, 'RETAIN','supplier_id, invoice_id','Trade class retained pending process evidence.','AP aging and purchasing/tax reconciliation.')
    if dim == 'Supplier / GRN':
        return result('AP:GRNI','Barang Diterima Belum Ditagih / GRNI','RETAIN','supplier_id, po_id, grn_id','Unmatched receipt is a separate clearing state.','PO-GRN-invoice matching and aging.')
    if dim == 'Jenis akrual':
        if any(x in u for x in ['GAJI','THR','PENGOBATAN','ASURANSI','BPJS']): k,nm='ACCRUAL:EMPLOYEE','Akrual Pegawai dan Imbalan Kerja'
        elif 'BUNGA' in u: k,nm='ACCRUAL:INTEREST','Akrual Bunga Pinjaman'
        elif 'SEWA' in u: k,nm='ACCRUAL:RENT','Akrual Sewa'
        else: k,nm='ACCRUAL:UTILITIES','Akrual Utilitas'
        return result(k,nm,'CONDITIONAL_MERGE','accrual_type, facility_id, contract_id','Accrual detail belongs in schedule.','Roll-forward, reversal, settlement and reporting reconciliation.')
    if dim == 'Jenis hutang':
        return result('LIAB:OTHER','Hutang Lain-lain','CONDITIONAL_MERGE','liability_type, party_id, site_id','Site name is attribution, not legal counterparty.','Aging, party, document and balance reconciliation.')
    if dim == 'Pemberi pinjaman':
        if b.startswith('2012303'):
            return result('LIAB:PRINCIPAL_UNKNOWN','Hutang Principal - Kreditur Belum Teridentifikasi','UNRESOLVED_EVIDENCE','creditor_id, facility_id, site_id','Principal does not prove creditor or equity nature.','Creditor identity, contract and settlement terms.')
        if 'PRINCIPAL' in u:
            return result('LOAN:LT_PRINCIPAL','Pinjaman Jangka Panjang Principal - Review','UNRESOLVED_EVIDENCE','creditor_id, facility_id','Creditor is unknown.','Contract and creditor evidence.')
        return result('LOAN:LT_BANK','Pinjaman Bank Jangka Panjang','CONDITIONAL_MERGE','facility_id, bank_account_id','Bank identity belongs in facility master.','Loan contract and schedule reconciliation.')
    if dim == 'Fasilitas / jatuh tempo':
        if 'PRINCIPAL' in u:
            return result('LOAN:CURRENT_PRINCIPAL','Bagian Lancar Pinjaman Principal - Review','UNRESOLVED_EVIDENCE','creditor_id, facility_id','Creditor is unknown.','Contract and maturity schedule.')
        return result('LOAN:CURRENT_BANK','Bagian Lancar Pinjaman Bank','CONDITIONAL_MERGE','facility_id','Bank identity belongs in facility master.','Maturity schedule reconciliation.')
    if dim == 'Fasilitas / pemberi pinjaman':
        return result('FINEXP:BANK' if 'BANK' in u else 'FINEXP:LEASE','Beban Bunga Pinjaman Bank' if 'BANK' in u else 'Beban Bunga Leasing','RETAIN','facility_id','Financing types remain separate pending reporting review.')
    if dim == 'Pelanggan / voucher':
        return result('LIAB:CUSTOMER_ADVANCE','Uang Muka Penjualan','RETAIN','customer_id, voucher_id, order_id','Advance remains liability until performance/redemption/refund.')
    # Revenue and cost
    if dim == 'Tender / channel':
        return result('REV:MERCH_SALES','Penjualan Barang Dagangan','CONDITIONAL_MERGE','channel_id, tender_type, acquirer_id','Channel identity is dimensional.','Marketplace gross/net, fees, returns and settlement reconciliation.')
    if dim == 'Jenis pengurang':
        return result('CONTRA:DISCOUNT' if 'DISCOUNT' in u or 'POTONGAN' in u else 'CONTRA:RETURN', n, 'RETAIN','adjustment_type, return_id','Discount and return remain distinguishable.')
    if dim == 'Jenis pendapatan':
        if 'SEWA GEDUNG' in u or 'SEWA PERALATAN' in u:
            return result('REV:RENTAL','Pendapatan Sewa','CONDITIONAL_MERGE','leased_object_type, contract_id','Object is contract detail.','Contract, tax and reporting alignment.')
        return result('REV:'+b,n,'RETAIN','income_type','Distinct operating/financing income nature retained.')
    if dim == 'Jenis transaksi':
        if 'PEMBULATAN' in u:
            return result('ROUNDING','Selisih Pembulatan','RETAIN','transaction_type','Dedicated controlled tolerance account.')
        return result('EXCEPTION:MIXED_OTHER','Pendapatan/Biaya Lain-lain - Pecah','UNRESOLVED_EVIDENCE','transaction_type','Mixed income/expense account must be split.','Posting-by-posting nature review.')
    if dim == 'Item / pergerakan stok':
        return result('COGS:PURCHASE','Harga Pokok/Pembelian - Review','UNRESOLVED_EVIDENCE','item_id, movement_type','Mapping depends on periodic versus perpetual inventory.','Inventory method and closing-flow review.')
    if dim == 'Jenis diskon pembelian':
        return result('COGS:PURCHASE_DISCOUNT','Potongan Pembelian','UNRESOLVED_EVIDENCE','supplier_id, item_id','Must consistently reduce inventory/purchases/COGS.','Inventory method and tax policy.')
    if dim == 'Item / jenis selisih':
        return result('COGS:DAMAGE' if 'KERUSAKAN' in u else 'COGS:LOSS','Beban Kerusakan Persediaan' if 'KERUSAKAN' in u else 'Kehilangan/Selisih Persediaan','UNRESOLVED_EVIDENCE' if 'KERUSAKAN' in u else 'RETAIN','item_id, variance_type','Direct loss versus allowance use must be reconciled.','Allowance policy and postings.')
    # Payroll and operating expenses
    if dim == 'Komponen payroll':
        idx=payroll_order[b]; nm=payroll_names[idx-1]
        return result(f'PAYROLL:{idx:02d}', 'Beban '+nm, 'CONDITIONAL_MERGE','payroll_component, employee_id, function_id, cost_center_id','Duplicate legacy function axis moves to dimensions.','Payroll/statutory and old-report reconciliation.')
    if dim == 'Jenis biaya / register aset':
        return result('OPEX:REPLACEMENT_OE','Beban Replacement Operating Equipment','UNRESOLVED_EVIDENCE','asset_id, item_class, work_order_id','Item name is detail; expense versus capitalization unresolved.','Capitalization policy and reserve posting mechanism.')
    if dim == 'Jenis biaya':
        if b.startswith('601041'):
            if 'SOFTWARE' in u:
                return result('OPEX:SOFTWARE_MAINT','Beban Pemeliharaan Software','RETAIN','software_id, contract_id','Software service/capitalization treatment remains distinct.')
            return result('OPEX:PHYSICAL_MAINT','Beban Perbaikan dan Pemeliharaan','CONDITIONAL_MERGE','asset_id, asset_class_id, work_order_id','Maintained object is register detail.','Capitalization control and management-report reconciliation.')
        return result('OPEX:'+b,n,'RETAIN','expense_type, party_id, contract_id','Distinct expense nature retained.')
    if dim == 'Objek sewa / kontrak':
        return result('LEASE_EXP:'+b,n,'UNRESOLVED_EVIDENCE','contract_id, leased_object_id','Lease/land-right treatment requires contract review.','Contract-by-contract ROU/short-term/service assessment.')
    # Equity and closing
    if dim == 'Pemilik':
        return result('EQUITY:CAPITAL' if 'MODAL' in u else 'EQUITY:DRAW','Modal Disetor' if 'MODAL' in u else 'Prive/Penarikan Pemilik','RETAIN','owner_id','Capital and owner draw remain separate.')
    if dim == 'Periode penutupan':
        if 'BULAN BERJALAN' in u:
            return result('', 'Laba/Rugi Berjalan Dihitung Sistem','DEACTIVATE_AFTER_RECLASS','period_id','Current profit is system-derived, not manual posting.','Closing configuration and retained-earnings roll-forward.')
        return result('EQUITY:RETAINED','Saldo Laba','RETAIN','period_id','Accumulated results remain distinct equity.')
    # Any uncaught family remains individually reviewed and retained.
    return result('RETAIN:'+b,n,'RETAIN',dim,'No supported compression identified; retain family pending evidence.')

rows=[]
for r in rules:
    d=decide(r)
    rows.append({
        'legacy_base': r['base'], 'legacy_family_name': r['family_name'],
        'legacy_detail_rows': r.get('legacy_detail_count',0), 'uses_e1_unit': r.get('uses_e1_unit',0),
        'source_target_code': r.get('target_code') or '', 'source_dimension': r.get('dimension_label') or '',
        **d
    })

fields=list(rows[0])
with (OUT/'jev_review_499.csv').open('w',newline='',encoding='utf-8-sig') as f:
    w=csv.DictWriter(f,fieldnames=fields); w.writeheader(); w.writerows(rows)

active=[x for x in rows if x['target_key']]
groups=defaultdict(list)
for x in active: groups[x['target_key']].append(x)
target_rows=[]
for k,items in sorted(groups.items()):
    statuses=Counter(x['decision_status'] for x in items)
    priority=['UNRESOLVED_EVIDENCE','RETAIN','CONDITIONAL_MERGE']
    status=next((s for s in priority if statuses[s]), items[0]['decision_status'])
    target_rows.append({
        'target_key':k,'target_account_name':items[0]['target_name'],'status':status,
        'legacy_family_count':len(items),'legacy_detail_rows':sum(int(x['legacy_detail_rows']) for x in items),
        'dimensions':items[0]['target_dimension'],'evidence_required':items[0]['evidence_required']
    })
with (OUT/'recommended_target_accounts.csv').open('w',newline='',encoding='utf-8-sig') as f:
    w=csv.DictWriter(f,fieldnames=list(target_rows[0])); w.writeheader(); w.writerows(target_rows)

# Working design: keep every unresolved-evidence legacy family separate, while
# applying the supported retain/conditional groupings elsewhere.
working_groups=defaultdict(list)
for x in active:
    wk = f"HOLD:{x['legacy_base']}" if x['decision_status']=='UNRESOLVED_EVIDENCE' else x['target_key']
    working_groups[wk].append(x)
working_rows=[]
for k,items in sorted(working_groups.items()):
    hold=k.startswith('HOLD:')
    working_rows.append({
        'target_key':k,
        'target_account_name':items[0]['legacy_family_name'] if hold else items[0]['target_name'],
        'status':'HOLD_SEPARATE_PENDING_EVIDENCE' if hold else items[0]['decision_status'],
        'legacy_family_count':len(items),
        'legacy_detail_rows':sum(int(x['legacy_detail_rows']) for x in items),
        'dimensions':items[0]['target_dimension'],
        'evidence_required':items[0]['evidence_required']
    })
with (OUT/'recommended_working_accounts_225.csv').open('w',newline='',encoding='utf-8-sig') as f:
    w=csv.DictWriter(f,fieldnames=list(working_rows[0])); w.writeheader(); w.writerows(working_rows)

summary={
    'source_families':len(rows),
    'covered_families':sum(1 for x in rows if x['decision_status']),
    'active_target_groups':len(target_rows),
    'deactivate_after_reclass_families':sum(x['decision_status']=='DEACTIVATE_AFTER_RECLASS' for x in rows),
    'family_status_counts':dict(Counter(x['decision_status'] for x in rows)),
    'target_status_counts':dict(Counter(x['status'] for x in target_rows)),
    'legacy_detail_rows':sum(int(x['legacy_detail_rows']) for x in rows),
    'unmapped_families':sum(not x['target_key'] and x['decision_status']!='DEACTIVATE_AFTER_RECLASS' for x in rows)
}
summary['no_merge_after_deactivation'] = summary['source_families'] - summary['deactivate_after_reclass_families']
summary['recommended_with_unresolved_separate'] = summary['active_target_groups'] + summary['family_status_counts']['UNRESOLVED_EVIDENCE'] - summary['target_status_counts']['UNRESOLVED_EVIDENCE']
(OUT/'summary.json').write_text(json.dumps(summary,indent=2,ensure_ascii=False))
(OUT/'final_register.json').write_text(json.dumps({'summary':summary,'families':rows,'targets':target_rows,'working_targets':working_rows},indent=2,ensure_ascii=False))
print(json.dumps(summary,indent=2,ensure_ascii=False))
