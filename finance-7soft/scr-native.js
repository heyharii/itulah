/* Finance features the ERP has and 7Soft does not: Overview · Stores · Payables · Cash & Bank ·
   Journal · Month End · Assets · Reports · Setup · Inter-unit · Payroll · Opening.
   These rows sit in the sidebar group "Di luar 7Soft" (native), never inside the 7Soft order. */
(() => {
try {
  document.head.insertAdjacentHTML('beforeend', `<style id="native-css">
.native-note{color:var(--body);margin:-4px 0 12px}
.native-actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
</style>`)
} catch (e) { /* headless */ }

const KP = (label, value, bad) => ({ label, value, bad })
const SHOP_NAME = Object.fromEntries(LOCS)
const one = s => `<span class="one">${s}</span>`
const SC = h => `<div style="overflow-x:auto">${h}</div>`
const TB = (cols, rows, foot, empty) => SC(table({ cols, rows, foot, empty }))
const R = c => ({ c })
const SP = s => pill(s, /over|open|review|due|pending|draft/i.test(s) ? 'warn' : /posted|pass|active|paid|cleared|reconciled|approved/i.test(s) ? 'ok' : '')
const EXPORT = name => ({ label: 'Export', on: `nativeExport('${name}')`, kind: 'secondary', icon: 'download' })
const PRINT = name => ({ label: 'Print', on: `printPage('${name}')`, kind: 'secondary', icon: 'printer' })

/* ── the generic form: real additions to the demo tables ── */
let NF = null
window.nativeOpen = cfg => {
  NF = cfg
  const inner = cfg.fields.map(f => {
    const id = 'nf-' + f.k
    if (f.kind === 'select') return field(f.l, `<select id="${id}">${f.options.map(o => `<option value="${esc(o[0])}">${esc(o[1])}</option>`).join('')}</select>`, f.wide ? 'span2' : '')
    return field(f.l, `<input id="${id}" type="${f.kind === 'number' ? 'text' : (f.kind || 'text')}" value="${esc(f.value || '')}" ${f.kind === 'number' ? 'inputmode="numeric"' : ''}>`, f.wide ? 'span2' : '')
  }).join('')
  openSheet({
    crumb: ['Di luar 7Soft'], title: cfg.title, size: 'wide',
    body: `<div class="form-grid">${inner}</div><p class="page-sub">${esc(cfg.note || 'Saved in the prototype; reloading resets it.')}</p>`,
    foot: btn('Save', 'nativeSave()'),
  })
}
window.nativeSave = () => {
  if (!NF) return
  const data = {}
  NF.fields.forEach(f => { data[f.k] = document.getElementById('nf-' + f.k)?.value || '' })
  NF.save(data)
  if (NF.id && NF.tab) S.tab[NF.id] = NF.tab
  NF = null
  closeSheet(); toast('Saved', 'The row is in the demo table'); render()
}
window.nativeExport = name => {
  const table = document.querySelector('.ds-page-content table.ds-table')
  if (!table) return toast('Nothing to export', 'This screen has no table')
  const csv = [...table.querySelectorAll('tr')].map(tr => [...tr.children].map(td => `"${td.innerText.trim().replace(/"/g, '""')}"`).join(',')).join('\r\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob); a.download = `${name}.csv`
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  toast('Exported', `${name}.csv`)
}

window.openDeposit = () => openTransfer('101100100101', '101100200100')
window.newOpeningBatch = () => nativeOpen({
  id: 'native-opening', title: 'Import opening batch',
  fields: [
    { k: 'b', l: 'Batch', value: 'OB-2026-04' },
    { k: 's', l: 'Source', value: 'Opening import' },
    { k: 'd', l: 'Debit', kind: 'number' },
    { k: 'c', l: 'Credit', kind: 'number' },
  ],
  save: d => { OP_BATCH.unshift([d.b || 'OB-2026-04', d.s || 'Opening import', 0, Number(String(d.d).replace(/\D/g, '')) || 0, Number(String(d.c).replace(/\D/g, '')) || 0, 'Review']) },
})

/* ═════════ data ═════════ */
const OV_ATT = [
  ['4 bank statement lines unmatched', 'Cash & Bank', 'Rp 12.475.000', 'Open'],
  ['INV/GMS/2026/0901 · Garmen Mitra Sentosa', 'Payables', 'Rp 32.500.000', 'Overdue'],
  ['Cash count C008 · difference', 'Stores', '−Rp 175.000', 'Review'],
  ['Giro BCA-GRV-0264 · due 24 Oct', 'Cash & Bank', 'Rp 18.000.000', 'Overdue'],
  ['October books · checklist 6 of 8', 'Month End', '—', 'Open'],
]
const OV_PAY = [
  ['Garmen Mitra Sentosa, PT', 'INV/GMS/2026/0901', '25 Oct 2026', 32500000, 'Overdue'],
  ['Sepatu Sejahtera, CV', 'INV/SS/2026/0931', '30 Oct 2026', 25600000, 'Due'],
  ['CV Anugrah Textile', 'INV/AT/2026/0644', '24 Oct 2026', 18000000, 'Overdue'],
  ['Sumber Komputer', 'INV/SK/2026/0421', '20 Oct 2026', 8374200, 'Overdue'],
  ['PT Graha Clean', 'INV/GC/2026/0188', '14 Oct 2026', 4200000, 'Paid'],
]
const OV_CASH = [
  ['101100100100', 'Cash on hand', 22920000],
  ['101100100200', 'Petty cash', 4120000],
  ['101100100300', 'Modal kasir', 1500000],
  ['101100200100', 'Cash In Bank Giro Bank BCA', 2196858050],
  ['101100200200', 'Cash In Bank Giro Bank MANDIRI', 954680700],
]
const OV_FLOW = [['Opening cash & bank', 1816700400], ['Money in', 2171990300], ['Money out', -712111950], ['Closing cash & bank', 3276578750]]

const ST_SALES = [
  ['C001', 'Cikupa', 18450000, 8250000, 10100000, 5000, 'Posted'],
  ['C002', 'Muaro Bungo', 17200000, 7400000, 9750000, 5000, 'Posted'],
  ['C003', 'Purbalingga', 15350000, 6800000, 8550000, 0, 'Posted'],
  ['C004', 'Bumiayu', 14100000, 6100000, 7950000, 5000, 'Posted'],
  ['C005', 'Jambi', 16800000, 7250000, 9550000, 0, 'Posted'],
  ['C006', 'Wiramode', 14950000, 5400000, 9550000, 0, 'Review'],
]
const ST_DEP = [
  ['C001', '26 Oct 2026', 16580000, 'Bank BCA', 'Cleared', 'BKK-C001-26-10-0017'],
  ['C002', '26 Oct 2026', 15250000, 'Bank Mandiri', 'Cleared', 'BKK-C002-26-10-0013'],
  ['C003', '26 Oct 2026', 13700000, 'Bank BCA', 'Cleared', 'BKK-C003-26-10-0016'],
  ['C004', '27 Oct 2026', 12650000, 'Bank BCA', 'In transit', 'BKK-C004-26-10-0013'],
  ['C005', '27 Oct 2026', 14800000, 'Bank Mandiri', 'In transit', 'BKK-C005-26-10-0013'],
]
const ST_COUNT = [
  ['C001', 1282600, 1282600, 0, 'Pass'],
  ['C002', 3200000, 3200000, 0, 'Pass'],
  ['C003', 1300800, 1300800, 0, 'Pass'],
  ['C008', 995500, 1170500, -175000, 'Review'],
  ['C009', 2312150, 2312150, 0, 'Pass'],
]
const ST_EDC = [
  ['Bank BCA · debit', 148250000, 1037750, 147212250, 0, 'Matched'],
  ['Bank BCA · credit', 96300000, 962999, 95337001, 0, 'Matched'],
  ['Bank Mandiri · debit', 78200000, 547400, 77652600, 12500, 'Review'],
  ['QRIS · acquirer', 41800000, 209000, 41591000, 0, 'Matched'],
]

const PAY_DUE = [
  ['Garmen Mitra Sentosa, PT', 'INV/GMS/2026/0901', '25 Oct 2026', 32500000, '1–30 days', 'Overdue'],
  ['CV Anugrah Textile', 'INV/AT/2026/0644', '24 Oct 2026', 18000000, '1–30 days', 'Overdue'],
  ['Sumber Komputer', 'INV/SK/2026/0421', '20 Oct 2026', 8374200, '31–60 days', 'Overdue'],
  ['Sepatu Sejahtera, CV', 'INV/SS/2026/0931', '30 Oct 2026', 25600000, 'Not due', 'Due'],
  ['Garmen Nusantara, PT', 'INV/GN/2026/1131', '28 Oct 2026', 9800000, 'Not due', 'Due'],
  ['PT Graha Clean', 'INV/GC/2026/0188', '14 Oct 2026', 4200000, '1–30 days', 'Paid'],
]
const PAY_REC = [
  ['Properti Cikupa, PT', 'Rent · Shop C001', 9750000, '01 Nov 2026', 'Active'],
  ['Telkom Indonesia', 'Internet & phone', 6245000, '05 Nov 2026', 'Active'],
  ['PLN (Persero)', 'Electricity · 9 shops', 14820000, '05 Nov 2026', 'Active'],
  ['Bank BCA', 'Bank charges', 25000, '26 Nov 2026', 'Active'],
  ['Asuransi Sinar Mas, PT', 'Property insurance', 1200000, '01 Nov 2026', 'Review'],
]
const PAY_LOANS = [
  ['Bank BCA · working capital', 1500000000, 980000000, '05 Nov 2026', 'Current'],
  ['Owner loan · Budi Santoso', 500000000, 350000000, '—', 'Current'],
  ['Bank Mandiri · vehicle', 320000000, 148000000, '20 Nov 2026', 'Current'],
  ['Koperasi karyawan', 75000000, 75000000, '—', 'No schedule'],
]
const PAY_BATCH = [
  ['PAY-26-10-0004', '27 Oct 2026', 6, 148250000, 'Ready'],
  ['PAY-26-10-0003', '24 Oct 2026', 4, 98250000, 'Executed'],
  ['PAY-26-10-0002', '20 Oct 2026', 8, 214600000, 'Executed'],
  ['PAY-26-10-0001', '15 Oct 2026', 3, 45600000, 'Executed'],
]

const CASH_RULES = [
  ['Bank charge', 'Description contains "BIAYA BANK"', '6010310004 · Bank charges', 'Active'],
  ['Card settlement', 'Description starts "EDC-"', '1011101002 · Card receivable', 'Active'],
  ['Transfer between own accounts', 'Both sides are bank accounts', '999999 · Transfer', 'Active'],
  ['Giro clearing', 'Reference starts "BCA-GRV"', '2012002001 · Giro outstanding', 'Active'],
  ['QRIS settlement', 'Acquirer is QRIS', '1011101002 · Card receivable', 'Review'],
]
const CASH_ADV = [
  ['Yusuf Ramadhan', 'Trip to supplier · Bandung', 750000, 750000, 'Open'],
  ['Maya Anggraini', 'Store opening · C013', 1200000, 400000, 'Partial'],
  ['Dian Pertiwi', 'Training · Jakarta', 2500000, 0, 'Settled'],
  ['Rina Kusuma', 'Office supplies', 350000, 0, 'Settled'],
]
const CASH_SUM = [
  ['Bank BCA', 1284750400, 1584754600, 672646950, 2196858050, '4 lines'],
  ['Bank Mandiri', 412300000, 580580700, 38200000, 954680700, '2 lines'],
  ['Bank BCA · savings', 96500000, 0, 0, 96500000, '—'],
  ['Cash on hand', 18400000, 5655000, 1135000, 22920000, 'Not counted'],
  ['Petty cash', 3250000, 1000000, 130000, 4120000, 'Not counted'],
]

const J_TMPL = [
  ['Monthly depreciation', '7010210001 · Depreciation', '1021602001 · Accumulated depreciation', 'Monthly'],
  ['Payroll accrual', '6010111001 · Salaries', '2012101001 · Salary payable', 'Monthly'],
  ['Rent prepaid', '1011301003 · Prepaid rent', '6010310001 · Rent', 'Monthly'],
  ['Card settlement', '1011002001 · Bank BCA', '1011101002 · Card receivable', 'Weekly'],
  ['Giro clearing', '2012002001 · Giro outstanding', '1011002001 · Bank BCA', 'On clearing'],
]
const J_ACCR = [
  ['Unbilled electricity · October', '6010310006 · Electricity', 14820000, 'Oct 2026', 'Open'],
  ['Unbilled internet · October', '6010310005 · Internet', 6245000, 'Oct 2026', 'Open'],
  ['Audit fee · 2026', '6010310019 · Professional fees', 45000000, 'Dec 2026', 'Scheduled'],
  ['Bonus accrual · 2026', '6010111002 · Bonus', 85000000, 'Dec 2026', 'Scheduled'],
]
const J_PRE = [
  ['Property insurance · 12 months', '1011301001 · Prepaid insurance', 14400000, 1200000, 13200000],
  ['Rent · Shop C001 · Oct–Dec', '1011301003 · Prepaid rent', 97500000, 32500000, 65000000],
  ['Rent · Shop C002 · Sep–Nov', '1011301003 · Prepaid rent', 64500000, 21500000, 43000000],
  ['Software subscription · 12 months', '1011301004 · Prepaid software', 24000000, 2000000, 22000000],
]

const ME_INV = [
  ['Shirts', 1284500000, 1284500000, 0, 'Pass'],
  ['Trousers', 965200000, 965200000, 0, 'Pass'],
  ['Dresses', 842000000, 842000000, 0, 'Pass'],
  ['Footwear', 1128000000, 1122500000, -5500000, 'Review'],
  ['Outerwear', 684500000, 684500000, 0, 'Pass'],
  ['Accessories', 392000000, 392000000, 0, 'Pass'],
]
const ME_TAX = [
  ['PPN output · October', 'Oct 2026', 4128000000, 454080000, '15 Nov 2026', 'Open'],
  ['PPN input · October', 'Oct 2026', 2874000000, 316140000, '15 Nov 2026', 'Open'],
  ['PPh 21 · October', 'Oct 2026', 318400000, 12736000, '10 Nov 2026', 'Open'],
  ['PPh 23 · October', 'Oct 2026', 84500000, 16900000, '10 Nov 2026', 'Open'],
  ['PPh 25 · October', 'Oct 2026', 0, 42000000, '15 Nov 2026', 'Paid'],
]
const ME_CHECKS = [
  ['Bank accounts reconciled', 'Cash & Bank', 'Pass'],
  ['Sales days posted', 'Stores', 'Pass'],
  ['Stock value agrees to ledger', 'Inventory', 'Review'],
  ['Payables aging reviewed', 'Payables', 'Pass'],
  ['Accruals and prepaids posted', 'Accounting', 'Pass'],
  ['Tax payables calculated', 'Tax', 'Pass'],
  ['Asset depreciation posted', 'Assets', 'Review'],
  ['Trial balance agrees', 'Accounting', 'Pass'],
]
let meRun = false
window.runMonthEnd = () => { meRun = true; toast('Month-end checks', '7 of 8 pass; one review remains'); render() }

const AS_PROJ = [
  ['Renovation · Shop C005', 152800000, 152800000, 0, 'Capitalised'],
  ['Store opening · Shop C013', 84500000, 61200000, 23300000, 'In progress'],
  ['Warehouse racking', 42000000, 42000000, 0, 'Capitalised'],
  ['Office fit-out · HO', 67500000, 24800000, 42700000, 'In progress'],
]
const AS_DISP = [
  ['FA-0018 · Delivery van', '12 Oct 2026', 85000000, 72000000, 13000000],
  ['FA-0024 · Forklift', '05 Oct 2026', 42000000, 51000000, -9000000],
  ['FA-0009 · POS terminal', '28 Sep 2026', 2500000, 1800000, 700000],
]
const AS_CLASS = [
  ['Building', 20, 'Straight line', '1021502001', '1021602001'],
  ['FFE · shop', 5, 'Straight line', '1021506002', '1021606002'],
  ['Vehicle', 8, 'Straight line', '1021504001', '1021604001'],
  ['Software', 5, 'Straight line', '1021701001', '1021702001'],
  ['Leasehold improvement', 5, 'Straight line', '1021503001', '1021603001'],
]

const REP_UNIT = [
  ['HO', 1845000000, 1120000000, 725000000, 412000000, 313000000],
  ['C001 · Cikupa', 2845000000, 1840000000, 1005000000, 482000000, 523000000],
  ['C002 · Muaro Bungo', 2410000000, 1580000000, 830000000, 391000000, 439000000],
  ['C003 · Purbalingga', 1980000000, 1310000000, 670000000, 302000000, 368000000],
  ['C004 · Bumiayu', 1720000000, 1140000000, 580000000, 261000000, 319000000],
  ['C005 · Jambi', 2050000000, 1350000000, 700000000, 318000000, 382000000],
]
const REP_DIM = [
  ['Fashion · women', 4820000000, 1410000000, 29.3],
  ['Fashion · men', 3180000000, 912000000, 28.7],
  ['Footwear', 1240000000, 318000000, 25.6],
  ['Accessories', 640000000, 182000000, 28.4],
  ['Other', 210000000, 42000000, 20.0],
]
const REP_BS = [
  ['Cash and bank', 2960000000, 3276578750, 316578750],
  ['Receivables', 412000000, 486000000, 74000000],
  ['Inventory', 5860000000, 6120000000, 260000000],
  ['Fixed assets', 4820000000, 4690000000, -130000000],
  ['Payables', 1240000000, 1186000000, -54000000],
  ['Equity', 8420000000, 8860000000, 440000000],
]
const REP_EQ = [
  ['Opening equity', 8420000000],
  ['Net profit · year to date', 486000000],
  ['Owner contribution', 0],
  ['Dividends', -46000000],
  ['Closing equity', 8860000000],
]
const REP_DIV = [
  ['Retail · Java', 6420000000, 1840000000, 28.7],
  ['Retail · Sumatra', 2810000000, 792000000, 28.2],
  ['Online', 640000000, 182000000, 28.4],
  ['Wholesale', 410000000, 92000000, 22.4],
]

const SET_READY = [
  ['Sales posting', '4010101001 · Sales', 'Mapped'],
  ['Card receivable', '1011101002 · Card receivable', 'Mapped'],
  ['Card MDR', '6010110002 · MDR', 'Mapped'],
  ['COGS', '5010101001 · Cost of sales', 'Mapped'],
  ['Inventory', '1011201001 · Inventory', 'Mapped'],
  ['Giro outstanding', '2012002001 · Giro outstanding', 'Gap'],
  ['Cash variance', '— · Cash variance', 'Gap'],
  ['Payroll payable', '2012101001 · Salary payable', 'Gap'],
]
const SET_PAY = [
  ['Cash', 'Cash', '0%', '1011001001 · Cash on hand', 'Active'],
  ['Debit BCA', 'Bank', '0.7%', '1011002001 · Bank BCA', 'Active'],
  ['Credit BCA', 'Bank', '1.8%', '1011002001 · Bank BCA', 'Active'],
  ['QRIS', 'Acquirer', '0.5%', '1011002001 · Bank BCA', 'Active'],
  ['Transfer', 'Bank', '0%', '1011002001 · Bank BCA', 'Active'],
  ['E-wallet', 'Acquirer', '1.5%', '1011101002 · Card receivable', 'Review'],
]
const SET_TAX = [
  ['PPN', '11%', '2011301001 · PPN output'],
  ['PPh 21', '5%', '2012201001 · PPh 21 payable'],
  ['PPh 23', '2%', '2012202001 · PPh 23 payable'],
  ['PPh 25', '—', '2012203001 · PPh 25 payable'],
  ['PPh 29', '—', '2012204001 · PPh 29 payable'],
]
const SET_CLASS = [
  ['Building', 20, 'Straight line'],
  ['FFE · shop', 5, 'Straight line'],
  ['Vehicle', 8, 'Straight line'],
  ['Software', 5, 'Straight line'],
  ['Leasehold improvement', 5, 'Straight line'],
]

const IU_BAL = LOCS.slice(0, 8).map(([loc, name], i) => [`${loc} · ${AFFIL[i]}`, 125000000 + i * 22500000, 98000000 + i * 18300000, 27000000 + i * 4200000])
const IU_TRF = [
  ['24 Oct 2026', 'HO', 'C001 · Cikupa', 'Goods', 18500000, 'Posted'],
  ['22 Oct 2026', 'C002 · Muaro Bungo', 'HO', 'Goods', 12400000, 'Posted'],
  ['18 Oct 2026', 'HO', 'C005 · Jambi', 'Financing', 25000000, 'Posted'],
  ['15 Oct 2026', 'C003 · Purbalingga', 'C004 · Bumiayu', 'Goods', 6200000, 'Review'],
]
const PR_POS = [
  ['Oct 2026', 318400000, 38200000, 280200000, 'Posted'],
  ['Sep 2026', 305100000, 36600000, 268500000, 'Posted'],
  ['Aug 2026', 298400000, 35800000, 262600000, 'Posted'],
]
const PR_LOANS = [
  ['Yusuf Ramadhan', 12000000, 4000000, 1000000, 'Current'],
  ['Maya Anggraini', 6000000, 1500000, 500000, 'Current'],
  ['Dian Pertiwi', 9000000, 0, 0, 'Settled'],
]
const OP_BATCH = [
  ['OB-2026-01', 'Trial balance · 1 Oct 2026', 303, 8420000000, 8420000000, 'Balanced'],
  ['OB-2026-02', 'Stock · 1 Oct 2026', 0, 5860000000, 5860000000, 'Balanced'],
  ['OB-2026-03', 'Subledger · suppliers', 0, 1240000000, 1240000000, 'Review'],
]

/* global save functions so inline handlers can reach the module's arrays */
window.saveRecurringBill = d => { PAY_REC.unshift([d.sup || 'Supplier', d.label || 'Recurring charge', Number(String(d.amt).replace(/\D/g, '')) || 0, d.next ? day(d.next) : '01 Nov 2026', 'Active']) }
window.savePaymentBatch = d => { PAY_BATCH.unshift(['PAY-26-10-0005', d.d ? day(d.d) : '27 Oct 2026', 0, Number(String(d.t).replace(/\D/g, '')) || 0, 'Draft']) }
window.saveBankRule = d => { CASH_RULES.unshift([d.r || 'New rule', d.w || 'Description contains …', d.t || 'Choose an account', 'Review']) }
window.saveJournalTemplate = d => { J_TMPL.unshift([d.n || 'New template', d.d || '—', d.c || '—', d.f || 'Monthly']) }
window.saveProject = d => { AS_PROJ.unshift([d.p || 'New project', Number(String(d.b).replace(/\D/g, '')) || 0, Number(String(d.s).replace(/\D/g, '')) || 0, 0, 'In progress']) }
window.savePaymentMethod = d => { SET_PAY.unshift([d.m || 'New method', d.s || 'Bank', d.d || '0%', d.a || '—', 'Review']) }
window.saveInterunit = d => { IU_TRF.unshift(['27 Oct 2026', d.f || 'HO', d.t || 'C001 · Cikupa', d.k || 'Goods', Number(String(d.a).replace(/\D/g, '')) || 0, 'Review']) }
window.saveOpeningBatch = d => { OP_BATCH.unshift([d.b || 'OB-2026-04', d.s || 'Opening import', 0, Number(String(d.d).replace(/\D/g, '')) || 0, Number(String(d.c).replace(/\D/g, '')) || 0, 'Review']) }
window.postPayroll = () => { PR_POS.unshift(['Nov 2026', 318400000, 38200000, 280200000, 'Draft']); S.tab['native-payroll'] = 'postings'; toast('Payroll queued', 'November 2026 · draft'); render() }

window.newRecurringBill = () => nativeOpen({ id: 'native-payables', tab: 'recurring', title: 'New recurring bill', fields: [{ k: 'sup', l: 'Supplier', kind: 'select', options: SUPPLIERS.map(s => [s.name, s.name]) }, { k: 'label', l: 'Label' }, { k: 'amt', l: 'Amount', kind: 'number' }, { k: 'next', l: 'Next date', kind: 'date', value: '2026-11-01' }], save: saveRecurringBill })
window.newPaymentBatch = () => nativeOpen({ id: 'native-payables', tab: 'batches', title: 'New payment batch', fields: [{ k: 'd', l: 'Date', kind: 'date', value: '2026-10-27' }, { k: 't', l: 'Total', kind: 'number' }], save: savePaymentBatch })
window.newProject = () => nativeOpen({ id: 'native-assets', tab: 'projects', title: 'New project', fields: [{ k: 'p', l: 'Project' }, { k: 'b', l: 'Budget', kind: 'number' }, { k: 's', l: 'Spent', kind: 'number' }], save: saveProject })
window.newInterunit = () => nativeOpen({ id: 'native-interunit', tab: 'transfers', title: 'New inter-unit transfer', fields: [{ k: 'f', l: 'From', kind: 'select', options: LOCS.map(l => [l[0], l[0] + ' · ' + l[1]]) }, { k: 't', l: 'To', kind: 'select', options: LOCS.map(l => [l[0], l[0] + ' · ' + l[1]]) }, { k: 'k', l: 'Kind', kind: 'select', options: [['Goods', 'Goods'], ['Financing', 'Financing'], ['Other', 'Other']] }, { k: 'a', l: 'Amount', kind: 'number' }], save: saveInterunit })

/* ═════════ Overview ═════════ */
reg({
  id: 'native-overview', group: 'native', label: 'Overview',
  render() {
    const body =
      section('Needs attention', TB(
        [{ l: 'What', k: 'what' }, { l: 'Area', k: 'area', w: 140 }, { l: 'Amount', k: 'amt', num: 1, w: 160 }, { l: 'Status', k: 'st', w: 110 }],
        OV_ATT.map(([what, area, amt, st]) => R({ what: one(esc(what)), area, amt, st: SP(st) })),
        null, 'Nothing needs attention',
      )) +
      section('Upcoming payments', TB(
        [{ l: 'Supplier', k: 'sup' }, { l: 'Document', k: 'doc', w: 190 }, { l: 'Due', k: 'due', w: 110 }, { l: 'Amount', k: 'amt', num: 1, w: 140 }, { l: 'Status', k: 'st', w: 100 }],
        OV_PAY.map(([sup, doc, due, amt, st]) => R({ sup: one(esc(sup)), doc: esc(doc), due, amt: num(amt), st: SP(st) })),
        null, 'No payments due',
      )) +
      section('Cash and bank', TB(
        [{ l: 'Account', k: 'acc' }, { l: 'Name', k: 'name' }, { l: 'Closing', k: 'close', num: 1, w: 150 }],
        OV_CASH.map(([acc, name, close]) => R({ acc, name: one(esc(name)), close: num(close) })),
        { name: 'Total', close: num(3276578750) },
      )) +
      section('Cash flow · October 2026', TB(
        [{ l: 'Line', k: 'line' }, { l: 'Amount', k: 'amt', num: 1, w: 160 }],
        OV_FLOW.map(([line, amt]) => R({ line, amt: money(amt) })),
      ))
    return page({
      title: 'Finance overview',
      sub: 'Cash, payables, stock and the few things that need a person today.',
      kpis: [KP('Cash & bank', 'Rp 3.276.578.750'), KP('Payables due', 'Rp 1.240.000.000'), KP('Inventory', 'Rp 6.120.000.000'), KP('Needs attention', '5', true)],
      body,
      actions: [EXPORT('finance-overview'), PRINT('Finance overview')],
    })
  },
})

/* ═════════ Stores ═════════ */
reg({
  id: 'native-stores', group: 'native', label: 'Stores',
  render() {
    const id = 'native-stores', t = tabOf(id, 'sales')
    let body, kpis
    if (t === 'sales') {
      kpis = [KP('Sales today', 'Rp 96.800.000'), KP('Cash takings', 'Rp 41.200.000'), KP('Card & QRIS', 'Rp 54.300.000'), KP('Posted', '6 of 6')]
      body = section('Sales day · 27 October 2026', TB(
        [{ l: 'Shop', k: 'shop', w: 140 }, { l: 'Sales', k: 'sales', num: 1, w: 140 }, { l: 'Cash', k: 'cash', num: 1, w: 130 }, { l: 'Card', k: 'card', num: 1, w: 130 }, { l: 'Rounding', k: 'round', num: 1, w: 100 }, { l: 'Status', k: 'st', w: 100 }],
        ST_SALES.map(([loc, name, sales, cash, card, round, st]) => R({ shop: `${loc} · ${name}`, sales: num(sales), cash: num(cash), card: num(card), round: num(round), st: SP(st) })),
        { shop: 'Total', sales: num(96800000), cash: num(41200000), card: num(54300000), round: num(10000) },
      ))
    } else if (t === 'deposits') {
      kpis = [KP('Deposits today', 'Rp 70.750.000'), KP('In transit', '2'), KP('Banked this week', 'Rp 462.300.000')]
      body = section('Deposits · shop cash to bank', TB(
        [{ l: 'Shop', k: 'shop', w: 140 }, { l: 'Date', k: 'd', w: 110 }, { l: 'Amount', k: 'amt', num: 1, w: 140 }, { l: 'Bank', k: 'bank', w: 130 }, { l: 'Status', k: 'st', w: 100 }, { l: 'Voucher', k: 'v', w: 190 }],
        ST_DEP.map(([shop, d, amt, bank, st, v]) => R({ shop, d, amt: num(amt), bank, st: SP(st), v: esc(v) })),
        { shop: 'Total', amt: num(70750000) },
      ))
    } else if (t === 'counts') {
      kpis = [KP('Counted today', '5 shops'), KP('Difference', '−Rp 175.000', true), KP('Waiting', '1')]
      body = section('Cash counts · the drawer', TB(
        [{ l: 'Shop', k: 'shop', w: 130 }, { l: 'Counted', k: 'c', num: 1, w: 140 }, { l: 'Book', k: 'b', num: 1, w: 140 }, { l: 'Difference', k: 'd', num: 1, w: 130 }, { l: 'Status', k: 'st', w: 100 }],
        ST_COUNT.map(([shop, c, b, d, st]) => R({ shop, c: num(c), b: num(b), d: `<span class="${d ? 'late' : ''}">${num(d)}</span>`, st: SP(st) })),
      ))
    } else {
      kpis = [KP('Card gross', 'Rp 364.550.000'), KP('MDR', 'Rp 2.753.149'), KP('Variance', 'Rp 12.500', true), KP('Matched', '3 of 4')]
      body = section('Card & EDC settlement', TB(
        [{ l: 'Acquirer / tender', k: 'a' }, { l: 'Gross', k: 'g', num: 1, w: 150 }, { l: 'MDR', k: 'm', num: 1, w: 120 }, { l: 'Net', k: 'n', num: 1, w: 150 }, { l: 'Variance', k: 'v', num: 1, w: 120 }, { l: 'Status', k: 'st', w: 100 }],
        ST_EDC.map(([a, g, m, n, v, st]) => R({ a, g: num(g), m: num(m), n: num(n), v: `<span class="${v ? 'late' : ''}">${num(v)}</span>`, st: SP(st) })),
      ))
    }
    return page({
      title: 'Stores · daily money', tabs: [['sales', 'Sales day'], ['deposits', 'Deposits'], ['counts', 'Cash counts'], ['edc', 'Card & EDC']], tab: t, kpis, body,
      actions: [{ label: 'New deposit', on: 'openDeposit()' }, EXPORT('stores-' + t), PRINT('Stores · ' + t)],
    })
  },
})

/* ═════════ Payables ═════════ */
reg({
  id: 'native-payables', group: 'native', label: 'Payables',
  render() {
    const id = 'native-payables', t = tabOf(id, 'due')
    let body, kpis, actions
    if (t === 'due') {
      kpis = [KP('Due this week', 'Rp 75.600.000'), KP('Overdue', 'Rp 58.874.200', true), KP('Not due', 'Rp 35.400.000'), KP('Suppliers', '5')]
      body = section('Due dates · aging', TB(
        [{ l: 'Supplier', k: 'sup' }, { l: 'Invoice', k: 'inv', w: 190 }, { l: 'Due', k: 'due', w: 110 }, { l: 'Amount', k: 'amt', num: 1, w: 140 }, { l: 'Bucket', k: 'b', w: 120 }, { l: 'Status', k: 'st', w: 100 }],
        PAY_DUE.map(([sup, inv, due, amt, b, st]) => R({ sup: one(esc(sup)), inv: esc(inv), due, amt: num(amt), b, st: SP(st) })),
        { sup: 'Total', amt: num(110214200) },
      ))
      actions = [EXPORT('payables-due'), PRINT('Payables · due dates')]
    } else if (t === 'recurring') {
      kpis = [KP('Recurring monthly', 'Rp 33.245.000'), KP('Next 30 days', 'Rp 33.245.000'), KP('Review', '1', true)]
      body = section('Recurring bills', TB(
        [{ l: 'Supplier', k: 'sup' }, { l: 'Label', k: 'l' }, { l: 'Amount', k: 'amt', num: 1, w: 140 }, { l: 'Next', k: 'next', w: 110 }, { l: 'Status', k: 'st', w: 100 }],
        PAY_REC.map(([sup, l, amt, next, st]) => R({ sup: one(esc(sup)), l, amt: num(amt), next, st: SP(st) })),
      ))
      actions = [
        { label: 'New recurring bill', on: 'newRecurringBill()' },
        EXPORT('payables-recurring'), PRINT('Payables · recurring'),
      ]
    } else if (t === 'loans') {
      kpis = [KP('Principal', 'Rp 2.395.000.000'), KP('Outstanding', 'Rp 1.473.000.000'), KP('Next instalment', 'Rp 148.000.000')]
      body = section('Loans', TB(
        [{ l: 'Lender', k: 'l' }, { l: 'Principal', k: 'p', num: 1, w: 150 }, { l: 'Outstanding', k: 'o', num: 1, w: 150 }, { l: 'Next', k: 'n', w: 110 }, { l: 'Status', k: 'st', w: 110 }],
        PAY_LOANS.map(([l, p, o, n, st]) => R({ l: one(esc(l)), p: num(p), o: num(o), n, st: SP(st) })),
      ))
      actions = [EXPORT('payables-loans'), PRINT('Payables · loans')]
    } else {
      kpis = [KP('Batches this month', '4'), KP('Ready to pay', 'Rp 148.250.000'), KP('Executed', 'Rp 358.450.000')]
      body = section('Payment batches', TB(
        [{ l: 'Batch', k: 'b', w: 180 }, { l: 'Date', k: 'd', w: 110 }, { l: 'Items', k: 'i', num: 1, w: 80 }, { l: 'Total', k: 't', num: 1, w: 150 }, { l: 'Status', k: 'st', w: 100 }],
        PAY_BATCH.map(([b, d, i, t, st]) => R({ b: esc(b), d, i: num(i), t: num(t), st: SP(st) })),
      ))
      actions = [{ label: 'New payment batch', on: 'newPaymentBatch()' }, EXPORT('payables-batches'), PRINT('Payables · batches')]
    }
    return page({ title: 'Payables · what is due', tabs: [['due', 'Due dates'], ['recurring', 'Recurring'], ['loans', 'Loans'], ['batches', 'Batches']], tab: t, kpis, body, actions })
  },
})

/* ═════════ Cash & Bank (native) ═════════ */
reg({
  id: 'native-cash', group: 'native', label: 'Cash & Bank',
  render() {
    const id = 'native-cash', t = tabOf(id, 'rules')
    let body, kpis
    if (t === 'rules') {
      kpis = [KP('Rules', '5'), KP('Active', '4'), KP('Review', '1', true)]
      body = section('Bank rules · how a statement line gets a category', TB(
        [{ l: 'Rule', k: 'r' }, { l: 'When', k: 'w' }, { l: 'Then', k: 't' }, { l: 'Status', k: 'st', w: 100 }],
        CASH_RULES.map(([r, w, t, st]) => R({ r: one(esc(r)), w, t, st: SP(st) })),
      ))
    } else if (t === 'advances') {
      kpis = [KP('Open advances', 'Rp 1.150.000'), KP('Partial', 'Rp 400.000'), KP('Settled this month', 'Rp 2.850.000')]
      body = section('Employee advances', TB(
        [{ l: 'Person', k: 'p' }, { l: 'Purpose', k: 'u' }, { l: 'Amount', k: 'a', num: 1, w: 130 }, { l: 'Outstanding', k: 'o', num: 1, w: 130 }, { l: 'Status', k: 'st', w: 100 }],
        CASH_ADV.map(([p, u, a, o, st]) => R({ p: one(esc(p)), u: esc(u), a: num(a), o: num(o), st: SP(st) })),
      ))
    } else {
      kpis = [KP('Cash & bank', 'Rp 3.276.578.750'), KP('Unreconciled', '4 lines', true), KP('Banks', '5')]
      body = section('Month summary · bank and cash', TB(
        [{ l: 'Account', k: 'a' }, { l: 'Opening', k: 'o', num: 1, w: 150 }, { l: 'In', k: 'i', num: 1, w: 140 }, { l: 'Out', k: 'u', num: 1, w: 140 }, { l: 'Closing', k: 'c', num: 1, w: 150 }, { l: 'Statement', k: 's', w: 120 }],
        CASH_SUM.map(([a, o, i, u, c, s]) => R({ a, o: num(o), i: num(i), u: num(u), c: num(c), s })),
      ))
    }
    return page({
      title: 'Cash & Bank · controls', tabs: [['rules', 'Bank rules'], ['advances', 'Advances'], ['summary', 'Month summary']], tab: t, kpis, body,
      actions: [
        { label: 'Open reconciliation', on: "S.tab['kas-info']='recon';go('kas-info')", kind: 'secondary' },
        { label: 'New rule', on: `nativeOpen({id:'${id}',tab:'rules',title:'New bank rule',fields:[{k:'r',l:'Rule'},{k:'w',l:'When'},{k:'t',l:'Then'}],save: saveBankRule})` },
        EXPORT('cash-bank-' + t), PRINT('Cash & Bank · ' + t),
      ],
    })
  },
})

/* ═════════ Journal ═════════ */
reg({
  id: 'native-journal', group: 'native', label: 'Journal',
  render() {
    const id = 'native-journal', t = tabOf(id, 'templates')
    let body, kpis
    if (t === 'templates') {
      kpis = [KP('Templates', '5'), KP('Monthly', '3'), KP('Recurring', '2')]
      body = section('Journal templates', TB(
        [{ l: 'Name', k: 'n' }, { l: 'Debit', k: 'd' }, { l: 'Credit', k: 'c' }, { l: 'Frequency', k: 'f', w: 120 }],
        J_TMPL.map(([n, d, c, f]) => R({ n: one(esc(n)), d, c, f })),
      ))
    } else if (t === 'accruals') {
      kpis = [KP('Open accruals', 'Rp 21.065.000'), KP('Scheduled', 'Rp 130.000.000'), KP('This month', '2')]
      body = section('Accruals · expense before the bill', TB(
        [{ l: 'Accrual', k: 'a' }, { l: 'Account', k: 'ac' }, { l: 'Amount', k: 'amt', num: 1, w: 140 }, { l: 'Period', k: 'p', w: 100 }, { l: 'Status', k: 'st', w: 100 }],
        J_ACCR.map(([a, ac, amt, p, st]) => R({ a: one(esc(a)), ac, amt: num(amt), p, st: SP(st) })),
      ))
    } else {
      kpis = [KP('Prepaid left', 'Rp 143.200.000'), KP('Amortised this month', 'Rp 58.700.000')]
      body = section('Prepaids · cash paid before the expense', TB(
        [{ l: 'Prepayment', k: 'p' }, { l: 'Account', k: 'a' }, { l: 'Paid', k: 'paid', num: 1, w: 140 }, { l: 'This month', k: 'm', num: 1, w: 130 }, { l: 'Left', k: 'l', num: 1, w: 140 }],
        J_PRE.map(([p, a, paid, m, l]) => R({ p: one(esc(p)), a, paid: num(paid), m: num(m), l: num(l) })),
      ))
    }
    return page({
      title: 'Journal · templates and schedules', tabs: [['templates', 'Templates'], ['accruals', 'Accruals'], ['prepaids', 'Prepaids']], tab: t, kpis, body,
      actions: [{ label: 'New template', on: `nativeOpen({id:'${id}',tab:'templates',title:'New journal template',fields:[{k:'n',l:'Name'},{k:'d',l:'Debit account'},{k:'c',l:'Credit account'},{k:'f',l:'Frequency',kind:'select',options:[['Monthly','Monthly'],['Weekly','Weekly'],['On clearing','On clearing']]}],save: saveJournalTemplate})` }, EXPORT('journal-' + t), PRINT('Journal · ' + t)],
    })
  },
})

/* ═════════ Month End ═════════ */
reg({
  id: 'native-monthend', group: 'native', label: 'Month End',
  render() {
    const id = 'native-monthend', t = tabOf(id, 'inventory')
    let body, kpis
    if (t === 'inventory') {
      kpis = [KP('Stock value', 'Rp 6.120.000.000'), KP('Ledger value', 'Rp 6.114.500.000'), KP('Difference', '−Rp 5.500.000', true), KP('Categories', '6')]
      body = section('Inventory · stock vs ledger', TB(
        [{ l: 'Category', k: 'c' }, { l: 'Stock', k: 's', num: 1, w: 160 }, { l: 'Ledger', k: 'l', num: 1, w: 160 }, { l: 'Difference', k: 'd', num: 1, w: 140 }, { l: 'Status', k: 'st', w: 100 }],
        ME_INV.map(([c, s, l, d, st]) => R({ c, s: num(s), l: num(l), d: `<span class="${d ? 'late' : ''}">${num(d)}</span>`, st: SP(st) })),
        { c: 'Total', s: num(6120000000), l: num(6114500000), d: num(-5500000) },
      ))
    } else if (t === 'tax') {
      kpis = [KP('PPN payable', 'Rp 137.940.000'), KP('PPh payable', 'Rp 71.636.000'), KP('Due', '15 Nov 2026'), KP('Paid', '1 of 5')]
      body = section('Tax payables', TB(
        [{ l: 'Tax', k: 't' }, { l: 'Period', k: 'p', w: 100 }, { l: 'Base', k: 'b', num: 1, w: 150 }, { l: 'Amount', k: 'a', num: 1, w: 140 }, { l: 'Due', k: 'd', w: 110 }, { l: 'Status', k: 'st', w: 100 }],
        ME_TAX.map(([t, p, b, a, d, st]) => R({ t: one(esc(t)), p, b: num(b), a: num(a), d, st: SP(st) })),
      ))
    } else {
      const checks = ME_CHECKS.map(([i, o, s]) => meRun && s === 'Review' ? [i, o, 'Pass'] : [i, o, s])
      const pass = meRun ? 8 : 7
      kpis = [KP('Checks', `${pass} of 8`), KP('Last run', meRun ? '27 Oct 2026' : '—'), KP('Blocking', meRun ? '0' : '1', !meRun)]
      body = section('Closing checklist · October 2026', TB(
        [{ l: 'Check', k: 'i' }, { l: 'Owner', k: 'o', w: 140 }, { l: 'Status', k: 'st', w: 100 }],
        checks.map(([i, o, st]) => R({ i: one(esc(i)), o, st: SP(st) })),
      ))
    }
    return page({
      title: 'Month End · inventory, tax, closing', tabs: [['inventory', 'Inventory'], ['tax', 'Tax'], ['checks', 'Closing']], tab: t, kpis, body,
      actions: [{ label: 'Run checks', on: 'runMonthEnd()' }, EXPORT('month-end-' + t), PRINT('Month End · ' + t)],
    })
  },
})

/* ═════════ Assets ═════════ */
reg({
  id: 'native-assets', group: 'native', label: 'Assets',
  render() {
    const id = 'native-assets', t = tabOf(id, 'projects')
    let body, kpis
    if (t === 'projects') {
      kpis = [KP('Projects', '4'), KP('Budget', 'Rp 346.800.000'), KP('Spent', 'Rp 280.900.000'), KP('Committed', 'Rp 66.000.000')]
      body = section('Projects in progress', TB(
        [{ l: 'Project', k: 'p' }, { l: 'Budget', k: 'b', num: 1, w: 150 }, { l: 'Spent', k: 's', num: 1, w: 150 }, { l: 'Committed', k: 'c', num: 1, w: 140 }, { l: 'Status', k: 'st', w: 120 }],
        AS_PROJ.map(([p, b, s, c, st]) => R({ p: one(esc(p)), b: num(b), s: num(s), c: num(c), st: SP(st) })),
      ))
    } else if (t === 'disposals') {
      kpis = [KP('Disposals', '3'), KP('Proceeds', 'Rp 129.500.000'), KP('Gain / loss', 'Rp 4.800.000')]
      body = section('Asset disposals', TB(
        [{ l: 'Asset', k: 'a' }, { l: 'Date', k: 'd', w: 110 }, { l: 'Proceeds', k: 'p', num: 1, w: 140 }, { l: 'NBV', k: 'n', num: 1, w: 140 }, { l: 'Gain / loss', k: 'g', num: 1, w: 130 }],
        AS_DISP.map(([a, d, p, n, g]) => R({ a: one(esc(a)), d, p: num(p), n: num(n), g: `<span class="${g < 0 ? 'late' : 'ok'}">${num(g)}</span>` })),
      ))
    } else {
      kpis = [KP('Classes', '5'), KP('Straight line', '5')]
      body = section('Asset classes', TB(
        [{ l: 'Class', k: 'c' }, { l: 'Life (years)', k: 'l', num: 1, w: 110 }, { l: 'Method', k: 'm', w: 130 }, { l: 'Asset account', k: 'a', w: 150 }, { l: 'Accumulated', k: 'u', w: 150 }],
        AS_CLASS.map(([c, l, m, a, u]) => R({ c, l: num(l), m, a, u })),
      ))
    }
    return page({
      title: 'Assets · projects, disposals, classes', tabs: [['projects', 'Projects'], ['disposals', 'Disposals'], ['classes', 'Classes']], tab: t, kpis, body,
      actions: [{ label: 'New project', on: 'newProject()' }, EXPORT('assets-' + t), PRINT('Assets · ' + t)],
    })
  },
})

/* ═════════ Reports (native) ═════════ */
reg({
  id: 'native-reports', group: 'native', label: 'Reports',
  render() {
    const id = 'native-reports', t = tabOf(id, 'unit')
    let body, kpis
    if (t === 'unit') {
      kpis = [KP('Revenue', 'Rp 12.900.000.000'), KP('Gross profit', 'Rp 4.505.000.000'), KP('Net profit', 'Rp 2.005.000.000'), KP('Margin', '15.5%')]
      body = section('Profit and loss · by unit', TB(
        [{ l: 'Unit', k: 'u' }, { l: 'Revenue', k: 'r', num: 1, w: 150 }, { l: 'COGS', k: 'c', num: 1, w: 150 }, { l: 'Gross', k: 'g', num: 1, w: 140 }, { l: 'Expenses', k: 'e', num: 1, w: 140 }, { l: 'Net', k: 'n', num: 1, w: 140 }],
        REP_UNIT.map(([u, r, c, g, e, n]) => R({ u, r: num(r), c: num(c), g: num(g), e: num(e), n: num(n) })),
      ))
    } else if (t === 'dimension') {
      kpis = [KP('Revenue', 'Rp 10.090.000.000'), KP('Profit', 'Rp 2.864.000.000'), KP('Margin', '28.4%')]
      body = section('Profit and loss · by dimension', TB(
        [{ l: 'Dimension', k: 'd' }, { l: 'Revenue', k: 'r', num: 1, w: 160 }, { l: 'Profit', k: 'p', num: 1, w: 160 }, { l: 'Margin', k: 'm', num: 1, w: 100 }],
        REP_DIM.map(([d, r, p, m]) => R({ d, r: num(r), p: num(p), m: `${m}%` })),
        { d: 'Total', r: num(10090000000), p: num(2864000000), m: '28.4%' },
      ))
    } else if (t === 'bs2') {
      kpis = [KP('Assets 2026', 'Rp 14.578.578.750'), KP('Liabilities', 'Rp 5.718.000.000'), KP('Equity', 'Rp 8.860.578.750')]
      body = section('Balance sheet · two years', TB(
        [{ l: 'Line', k: 'l' }, { l: '2025', k: 'a', num: 1, w: 160 }, { l: '2026', k: 'b', num: 1, w: 160 }, { l: 'Change', k: 'c', num: 1, w: 150 }],
        REP_BS.map(([l, a, b, c]) => R({ l, a: num(a), b: num(b), c: `<span class="${c < 0 ? 'late' : 'ok'}">${num(c)}</span>` })),
      ))
    } else if (t === 'equity') {
      kpis = [KP('Opening equity', 'Rp 8.420.000.000'), KP('Closing equity', 'Rp 8.860.000.000'), KP('Movement', 'Rp 440.000.000')]
      body = section('Statement of changes in equity', TB(
        [{ l: 'Line', k: 'l' }, { l: 'Amount', k: 'a', num: 1, w: 180 }],
        REP_EQ.map(([l, a]) => R({ l, a: money(a) })),
      ))
    } else {
      kpis = [KP('Sales', 'Rp 10.280.000.000'), KP('Profit', 'Rp 2.906.000.000'), KP('Margin', '28.3%')]
      body = section('Sales by division', TB(
        [{ l: 'Division', k: 'd' }, { l: 'Sales', k: 's', num: 1, w: 160 }, { l: 'Profit', k: 'p', num: 1, w: 160 }, { l: 'Margin', k: 'm', num: 1, w: 100 }],
        REP_DIV.map(([d, s, p, m]) => R({ d, s: num(s), p: num(p), m: `${m}%` })),
      ))
    }
    return page({
      title: 'Reports · the views ERP adds', tabs: [['unit', 'P&L by unit'], ['dimension', 'By dimension'], ['bs2', 'Balance sheet 2 years'], ['equity', 'Equity'], ['division', 'Sales by division']], tab: t, kpis, body,
      actions: [EXPORT('reports-' + t), PRINT('Reports · ' + t)],
    })
  },
})

/* ═════════ Setup (native) ═════════ */
reg({
  id: 'native-setup', group: 'native', label: 'Setup',
  render() {
    const id = 'native-setup', t = tabOf(id, 'readiness')
    let body, kpis
    if (t === 'readiness') {
      kpis = [KP('Mapped', '5 of 8'), KP('Gaps', '3', true), KP('Posting ready', 'No', true)]
      body = section('Posting readiness · a posting stops when the account is missing', TB(
        [{ l: 'Meaning', k: 'm' }, { l: 'Account', k: 'a' }, { l: 'Status', k: 'st', w: 100 }],
        SET_READY.map(([m, a, st]) => R({ m: one(esc(m)), a, st: SP(st === 'Gap' ? 'Review' : 'Pass') })),
      ))
    } else if (t === 'payments') {
      kpis = [KP('Methods', '6'), KP('Acquirers', '2'), KP('MDR range', '0–1.8%')]
      body = section('Payment methods · settlement, MDR, account', TB(
        [{ l: 'Method', k: 'm' }, { l: 'Settlement', k: 's', w: 130 }, { l: 'MDR', k: 'd', w: 100 }, { l: 'Account', k: 'a' }, { l: 'Status', k: 'st', w: 100 }],
        SET_PAY.map(([m, s, d, a, st]) => R({ m, s, d, a, st: SP(st) })),
      ))
    } else if (t === 'tax') {
      kpis = [KP('Tax types', '5'), KP('Withholding', '3'), KP('PPN', '11%')]
      body = section('Tax types and withholding', TB(
        [{ l: 'Code', k: 'c', w: 100 }, { l: 'Rate', k: 'r', w: 100 }, { l: 'Account', k: 'a' }],
        SET_TAX.map(([c, r, a]) => R({ c, r, a })),
      ))
    } else {
      kpis = [KP('Classes', '5'), KP('Longest life', '20 years')]
      body = section('Asset classes', TB(
        [{ l: 'Class', k: 'c' }, { l: 'Life (years)', k: 'l', num: 1, w: 110 }, { l: 'Method', k: 'm', w: 140 }],
        SET_CLASS.map(([c, l, m]) => R({ c, l: num(l), m })),
      ))
    }
    return page({
      title: 'Setup · what must be right before posting', tabs: [['readiness', 'Posting readiness'], ['payments', 'Payment methods'], ['tax', 'Tax types'], ['classes', 'Asset classes']], tab: t, kpis, body,
      actions: [{ label: 'New payment method', on: `nativeOpen({id:'${id}',tab:'payments',title:'New payment method',fields:[{k:'m',l:'Method'},{k:'s',l:'Settlement',kind:'select',options:[['Cash','Cash'],['Bank','Bank'],['Acquirer','Acquirer']]},{k:'d',l:'MDR'},{k:'a',l:'Account'}],save: savePaymentMethod})` }, EXPORT('setup-' + t), PRINT('Setup · ' + t)],
    })
  },
})

/* ═════════ Inter-unit ═════════ */
reg({
  id: 'native-interunit', group: 'native', label: 'Inter-unit',
  render() {
    const id = 'native-interunit', t = tabOf(id, 'balances')
    let body, kpis
    if (t === 'balances') {
      kpis = [KP('Due from', 'Rp 1.125.000.000'), KP('Due to', 'Rp 980.000.000'), KP('Net', 'Rp 145.000.000')]
      body = section('Due from / Due to · one row per unit', TB(
        [{ l: 'Unit', k: 'u' }, { l: 'Due from', k: 'f', num: 1, w: 160 }, { l: 'Due to', k: 't', num: 1, w: 160 }, { l: 'Net', k: 'n', num: 1, w: 150 }],
        IU_BAL.map(([u, f, t, n]) => R({ u: one(esc(u)), f: num(f), t: num(t), n: num(n) })),
      ))
    } else {
      kpis = [KP('Transfers this month', '4'), KP('Value', 'Rp 62.100.000'), KP('Review', '1', true)]
      body = section('Inter-unit transfers', TB(
        [{ l: 'Date', k: 'd', w: 110 }, { l: 'From', k: 'f' }, { l: 'To', k: 't' }, { l: 'Kind', k: 'k', w: 110 }, { l: 'Amount', k: 'a', num: 1, w: 140 }, { l: 'Status', k: 'st', w: 100 }],
        IU_TRF.map(([d, f, t, k, a, st]) => R({ d, f: one(esc(f)), t: one(esc(t)), k, a: num(a), st: SP(st) })),
      ))
    }
    return page({
      title: 'Inter-unit · balances and transfers', tabs: [['balances', 'Due from / Due to'], ['transfers', 'Transfers']], tab: t, kpis, body,
      actions: [{ label: 'New transfer', on: 'newInterunit()' }, EXPORT('interunit-' + t), PRINT('Inter-unit · ' + t)],
    })
  },
})

/* ═════════ Payroll ═════════ */
reg({
  id: 'native-payroll', group: 'native', label: 'Payroll',
  render() {
    const id = 'native-payroll', t = tabOf(id, 'postings')
    let body, kpis
    if (t === 'postings') {
      kpis = [KP('Net payroll', 'Rp 280.200.000'), KP('Deductions', 'Rp 38.200.000'), KP('Posted', '3 of 3')]
      body = section('Payroll postings', TB(
        [{ l: 'Period', k: 'p', w: 100 }, { l: 'Gross', k: 'g', num: 1, w: 150 }, { l: 'Deductions', k: 'd', num: 1, w: 140 }, { l: 'Net', k: 'n', num: 1, w: 150 }, { l: 'Status', k: 'st', w: 100 }],
        PR_POS.map(([p, g, d, n, st]) => R({ p, g: num(g), d: num(d), n: num(n), st: SP(st) })),
      ))
    } else {
      kpis = [KP('Outstanding', 'Rp 5.500.000'), KP('Staff with loans', '2'), KP('Settled', '1')]
      body = section('Staff loans', TB(
        [{ l: 'Employee', k: 'e' }, { l: 'Principal', k: 'p', num: 1, w: 140 }, { l: 'Outstanding', k: 'o', num: 1, w: 140 }, { l: 'Monthly', k: 'm', num: 1, w: 130 }, { l: 'Status', k: 'st', w: 100 }],
        PR_LOANS.map(([e, p, o, m, st]) => R({ e: one(esc(e)), p: num(p), o: num(o), m: num(m), st: SP(st) })),
      ))
    }
    return page({
      title: 'Payroll · postings and staff loans', tabs: [['postings', 'Postings'], ['loans', 'Staff loans']], tab: t, kpis, body,
      actions: [{ label: 'Post payroll', on: 'postPayroll()' }, EXPORT('payroll-' + t), PRINT('Payroll · ' + t)],
    })
  },
})

/* ═════════ Opening ═════════ */
reg({
  id: 'native-opening', group: 'native', label: 'Opening',
  render() {
    const body = section('Opening balances · cutover batches', TB(
      [{ l: 'Batch', k: 'b', w: 140 }, { l: 'Source', k: 's' }, { l: 'Accounts', k: 'a', num: 1, w: 100 }, { l: 'Debit', k: 'd', num: 1, w: 150 }, { l: 'Credit', k: 'c', num: 1, w: 150 }, { l: 'Status', k: 'st', w: 110 }],
      OP_BATCH.map(([b, s, a, d, c, st]) => R({ b: esc(b), s, a: num(a), d: num(d), c: num(c), st: SP(st) })),
      { b: 'Total', a: num(303), d: num(8420000000), c: num(8420000000) },
    ))
    return page({
      title: 'Opening balances · cutover', sub: 'The first trial balance, stock and subledger the books start from.',
      kpis: [KP('Accounts', '303'), KP('Debit', 'Rp 8.420.000.000'), KP('Credit', 'Rp 8.420.000.000'), KP('Difference', 'Rp 0')],
      body,
      actions: [{ label: 'Import opening', on: 'newOpeningBatch()' }, EXPORT('opening'), PRINT('Opening balances')],
    })
  },
})
})()
