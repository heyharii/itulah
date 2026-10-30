/* Cash & bank group: Cash & bank info (7Soft Info Kas Bank) · Cash & bank reports (Laporan Kas/Bank) · Shop cash.
   One demo ledger feeds all three: vouchers (BKM / BKK) → journal lines → entries on the cash and bank accounts. */
(() => {
try {
  document.head.insertAdjacentHTML('beforeend', `<style id="kas-css">
.kas-filter{display:flex;flex-wrap:wrap;align-items:center;gap:10px 16px;margin:0 0 16px}
.kas-filter .ctl{height:36px;padding:0 10px;border:1px solid var(--hairline-2);border-radius:var(--r-inner);background:var(--canvas);font:inherit;color:var(--ink)}
.kas-filter .ctl:focus{outline:0;border-color:var(--accent);box-shadow:var(--shadow-focus)}
.kas-act{display:inline-flex;flex-wrap:wrap;gap:6px}
.kas-mini{height:28px;padding:0 10px;border:1px solid var(--hairline-2);border-radius:var(--r-inner);background:var(--canvas);font:inherit;font-size:13px;color:var(--ink);cursor:pointer;white-space:nowrap}
.kas-mini:hover{background:var(--soft-2)}
.kas-mini:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
.tbl td .kas-act{vertical-align:middle}
</style>`)
} catch (e) { /* headless */ }
/* ═════════ dates ═════════ */
const dt = iso => new Date(iso + 'T00:00:00Z')
const addD = (iso, n) => new Date(dt(iso).getTime() + n * 864e5).toISOString().slice(0, 10)
const gap = (a, b) => Math.round((dt(a) - dt(b)) / 864e5)
const wd = iso => dt(iso).getUTCDay()
const rangeD = (a, b) => { const r = []; for (let d = a; d <= b; d = addD(d, 1)) r.push(d); return r }
const pad = (n, w) => String(n).padStart(w, '0')
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const PER = {
  oct: { from: '2026-10-01', to: TODAY, label: 'October 2026', short: 'Oct 2026' },
  sep: { from: '2026-09-01', to: '2026-09-30', label: 'September 2026', short: 'Sep 2026' },
  day: { from: TODAY, to: TODAY, label: '27 Oct 2026', short: '27 Oct 2026' },
}
const perText = p => p.from === p.to ? day(p.from) : `${dayS(p.from)} – ${day(p.to)}`
const perOf = iso => (iso.slice(5, 7) === '09' ? 'Sep 2026' : iso.slice(5, 7) === '10' ? 'Oct 2026' : 'Aug 2026')
const rng = seed => { let s = seed | 0; return () => { s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 } }

/* ═════════ accounts ═════════ */
const nice = s => (s === s.toUpperCase() && /[A-Z]/.test(s)) ? s.charAt(0) + s.slice(1).toLowerCase() : s
const tcase = s => s.split(' ').map(w => /^[^AEIOU]+$/.test(w) ? w : w.charAt(0) + w.slice(1).toLowerCase()).join(' ')
const LC = LOC_CODES
const SHOP = {}; LC.forEach((l, i) => { SHOP[l] = i ? tcase(AFFIL[i]) : 'Head office' })
const CASH = '1011001001', PETTY = '1011001002', FLOAT = '1011001003', GBCA = '1011002001', GMDR = '1011002002', TBCA = '1011003001', OBCA = '2012002001', OMDR = '2012002002'
const a12 = (b, l = 'HO') => acc12(b, l)
const BCA = a12(GBCA), MDR = a12(GMDR), TAB = a12(TBCA), OGB = a12(OBCA), OGM = a12(OMDR)
const locOf = c => LC[+String(c).slice(10)]
const an = c => nice(accName(c))
const alab = c => `${an(c)} ${locOf(c)}`
const ACCTS = []
LC.forEach(loc => {
  const add = (b, grp) => ACCTS.push({ code: a12(b, loc), base: b, loc, grp, name: an(b) })
  ;[CASH, PETTY, FLOAT].forEach(b => add(b, 'Cash'))
  if (loc === 'HO') { [GBCA, GMDR, TBCA].forEach(b => add(b, 'Bank')); [OBCA, OMDR].forEach(b => add(b, 'Giro')) }
})
const AM = Object.fromEntries(ACCTS.map(a => [a.code, a]))
const AP = a12('2012001001'), AR = a12('1011101002')

/* account metadata: what the bank book needs beyond the COA name */
const bankOf = name => /BCA/i.test(name) ? 'Bank BCA' : /MANDIRI/i.test(name) ? 'Bank Mandiri' : /BRI/i.test(name) ? 'Bank BRI' : ''
const numberOf = (grp, name) => grp === 'Cash' || grp === 'Giro' ? '' : /BCA/i.test(name) ? '•••• 4821' : /MANDIRI/i.test(name) ? '•••• 7714' : ''
ACCTS.forEach(a => {
  a.active = true
  a.note = a.note || ''
  a.bank = a.grp === 'Cash' ? '' : bankOf(a.name)
  a.number = numberOf(a.grp, a.name)
})
/* in-memory work the prototype can actually do */
const COUNTS = {}        // loc → { date, book, counted, diff }
const RECON_STATE = {}   // line id → { state: matched|unmatched|ignored|posted, match }
const RECON_DONE = {}    // account → date reconciled
let POST_SEQ = 9000
let TRF_SEQ = 1

/* ═════════ vouchers: head office, written out ═════════ */
const RAW = []
const add = (type, date, acct, party, note, lines, o = {}) => RAW.push({ type, date, acct, party, note, lines, by: 'Rina Kusuma', ...o, i: RAW.length })
const P = (code, name) => ({ code, name })
const O = (acc10, desc, amt, loc = 'HO') => ({ t: 'o', acc: a12(acc10, loc), desc, amt })
const Oa = (acc, desc, amt) => ({ t: 'o', acc, desc, amt })
const Sl = (doc, due, owed, pay, pot = 0, potAcc = '', acc = '') => ({ t: 's', doc, due, owed, pay, pot, potAcc: potAcc ? a12(potAcc) : '', acc: acc ? a12(acc) : '' })
const GMS = P('S-0102', 'Garmen Mitra Sentosa, PT'), SKP = P('S-0045', 'Sumber Komputer'), CAT = P('S-0131', 'CV Anugrah Textile'), GCL = P('S-0208', 'PT Graha Clean'),
  SSJ = P('S-0077', 'Sepatu Sejahtera, CV'), GNU = P('S-0160', 'Garmen Nusantara, PT'), BAL = P('S-0171', 'Busana Anggun Lestari, CV'), CAP = P('S-0190', 'Cahaya ATK & Percetakan, CV')
const NOP = P('', '')
const giro = (date, out, bank, party, no, due, state, on, lines, note = '') => add('BKK', date, out, party, note, lines, { giro: { no, bank, due, state, on: on || '' } })

// ── September: BKK
add('BKK', '2026-09-01', BCA, P('', 'Properti Cikupa, PT'), 'Rent · Shop C002 · Sep – Nov 2026', [O('1011301003', 'Rent paid in advance · Sep – Nov', 64500000)])
add('BKK', '2026-09-01', a12(CASH), P('', 'Toko Sumber Rejeki'), 'Pantry supplies', [O('6010310003', 'Pantry supplies', 120000)])
add('BKK', '2026-09-02', BCA, GNU, 'Bill INV/GN/2026/0811', [Sl('INV/GN/2026/0811', '2026-09-02', 24800000, 24800000)])
add('BKK', '2026-09-03', BCA, P('', 'Asuransi Sinar Mas, PT'), 'Vehicle insurance · 2 vans', [O('1011301001', 'Vehicle insurance · 2 vans', 2350000)])
add('BKK', '2026-09-04', BCA, NOP, 'Cash withdrawal for HO cash', [O(CASH, 'Cash withdrawal', 5000000)])
add('BKK', '2026-09-05', BCA, NOP, 'Top-up · petty cash HO', [O(PETTY, 'Top-up · petty cash HO', 1000000)])
add('BKK', '2026-09-09', BCA, GMS, 'Bills INV/GMS/2026/0788 and 0795', [Sl('INV/GMS/2026/0788', '2026-09-09', 71200000, 71200000), Sl('INV/GMS/2026/0795', '2026-09-09', 76800000, 76800000)])
add('BKK', '2026-09-12', BCA, P('', 'Telkom Indonesia (IndiHome Bisnis)'), 'Internet & phone · August 2026', [O('6010310005', 'Internet & phone · August', 6120000)])
add('BKK', '2026-09-16', BCA, SSJ, 'Bills INV/SS/2026/0861 and 0870', [Sl('INV/SS/2026/0861', '2026-09-16', 52400000, 52400000), Sl('INV/SS/2026/0870', '2026-09-16', 44000000, 44000000)])
add('BKK', '2026-09-16', a12(PETTY), P('', 'Toko ATK Jaya'), 'Stationery', [O('6010310002', 'Stationery', 60000)])
add('BKK', '2026-09-18', BCA, P('', 'PLN (Persero)'), 'Electricity · 9 shops · August 2026', [O('6010310006', 'Electricity · 9 shops · August', 13960000)])
add('BKK', '2026-09-19', a12(PETTY), P('', 'Ojek online'), 'Courier · documents', [O('6010110007', 'Courier · documents', 40000)])
add('BKK', '2026-09-22', BCA, P('', 'Auto Mandiri Bekasi, PT'), 'Delivery van service', [O('6010410006', 'Delivery van service', 2400000)])
add('BKK', '2026-09-22', BCA, NOP, 'Top-up · petty cash HO', [O(PETTY, 'Top-up · petty cash HO', 185000)])
add('BKK', '2026-09-23', BCA, GNU, 'Bills INV/GN/2026/0842 and 0855', [Sl('INV/GN/2026/0842', '2026-09-23', 58250000, 58250000), Sl('INV/GN/2026/0855', '2026-09-23', 60000000, 60000000)])
add('BKK', '2026-09-24', MDR, P('', 'Karya Bangun Renovasi, CV'), 'Renovation · Shop C005 · stage 2', [O('1031803001', 'Renovation · Shop C005 · stage 2', 114600000)])
add('BKK', '2026-09-25', BCA, NOP, 'Payroll · September', [O('6010111001', 'Salaries · shops · September', 241300000), O('6010210001', 'Salaries · head office · September', 63800000)])
add('BKK', '2026-09-26', BCA, P('', 'Bank BCA'), 'Bank charges · September 2026', [O('6010310004', 'Bank charges', 25000)])
add('BKK', '2026-09-30', MDR, SKP, 'Bill INV/SK/2026/0388', [Sl('INV/SK/2026/0388', '2026-09-30', 96500000, 96500000)])
// ── September: giro out
giro('2026-09-01', OGB, BCA, GMS, 'BCA-GRV-0250', '2026-09-14', 'Cleared', '2026-09-14', [Sl('INV/GMS/2026/0790', '2026-09-14', 20000000, 20000000)], 'Bill INV/GMS/2026/0790')
giro('2026-09-10', OGB, BCA, CAP, 'BCA-GRV-0254', '2026-09-28', 'Bounced', '2026-09-29', [Sl('INV/CA/2026/0388', '2026-09-28', 1125000, 1125000)], 'Bill INV/CA/2026/0388')
giro('2026-09-15', OGB, BCA, SSJ, 'BCA-GRV-0256', '2026-10-05', 'Cleared', '2026-10-05', [Sl('INV/SS/2026/0905', '2026-10-05', 12000000, 12000000)], 'Bill INV/SS/2026/0905')
giro('2026-09-29', OGB, BCA, BAL, 'BCA-GRV-0257', '2026-10-14', 'Cleared', '2026-10-14', [Sl('INV/BAL/2026/0712', '2026-10-14', 19500000, 19500000)], 'Bill INV/BAL/2026/0712')
// ── September: BKM
add('BKM', '2026-09-01', BCA, P('', 'Hendra Wijaya'), "Owner's capital", [O('3013001001', "Owner's capital", 150000000)])
add('BKM', '2026-09-08', BCA, GMS, 'Refund · price difference INV/GMS/2026/0802', [O('2012001001', 'Refund · price difference', 1240000)])
add('BKM', '2026-09-20', a12(CASH), P('', 'Pengepul Barokah'), 'Scrap sale', [O('8010110007', 'Scrap sale', 230000)])
add('BKM', '2026-09-26', a12(CASH), P('', 'Maya Anggraini'), 'Advance returned · ADV-000019', [O('1011102001', 'Advance returned', 80000)])
add('BKM', '2026-09-30', MDR, P('', 'Bank Mandiri'), 'Interest · September 2026', [O('8010110001', 'Bank interest', 96300)])
add('BKM', '2026-09-30', BCA, P('', 'Bank BCA'), 'Interest · September 2026', [O('8010110001', 'Bank interest', 405300)])

// ── October: BKK
add('BKK', '2026-10-01', BCA, P('', 'Asuransi Sinar Mas, PT'), 'Property insurance · DC · Oct 2026 – Sep 2027', [O('1011301001', 'Property insurance · 12 months', 1200000)])
add('BKK', '2026-10-03', BCA, P('', 'Digital Print Nusantara, PT'), 'Promo banners · October', [O('6010110003', 'Promo banners · October', 2175000)])
add('BKK', '2026-10-05', BCA, CAP, 'Replaces giro BCA-GRV-0254 · bounced', [Sl('INV/CA/2026/0388', '2026-09-28', 1125000, 1125000)], { replaces: 'BCA-GRV-0254' })
add('BKK', '2026-10-05', BCA, NOP, 'Cash withdrawal for HO cash', [O(CASH, 'Cash withdrawal', 5000000)])
add('BKK', '2026-10-06', BCA, SKP, 'Bill INV/SK/2026/0421', [Sl('INV/SK/2026/0421', '2026-10-20', 8374200, 8374200)])
add('BKK', '2026-10-06', a12(CASH), P('', 'Toko ATK Jaya'), 'Printer paper & receipt rolls', [O('6010310002', 'Printer paper & receipt rolls', 385000)])
add('BKK', '2026-10-07', a12(PETTY), P('', 'Ojek online'), 'Courier · documents to Shop C003', [O('6010110007', 'Courier · documents', 45000)])
add('BKK', '2026-10-08', BCA, P('', 'Dingin Sejuk AC Service, CV'), 'AC service · DC', [O('6010410007', 'AC service · DC', 1152750)])
add('BKK', '2026-10-09', BCA, P('', 'JNE Express'), 'Delivery · September 2026', [O('6010110007', 'Delivery · September', 2790000)])
add('BKK', '2026-10-10', BCA, P('', 'Properti Cikupa, PT'), 'Rent · Shop C001 · Oct – Dec 2026', [O('1011301003', 'Rent paid in advance · Oct – Dec', 97500000)])
add('BKK', '2026-10-12', BCA, P('', 'PDAM Tirta'), 'Water · 6 shops · September 2026', [O('6010310007', 'Water · 6 shops · September', 1870000)])
add('BKK', '2026-10-13', BCA, CAT, 'Bill INV/AT/2026/0610 · 2% early-payment discount', [Sl('INV/AT/2026/0610', '2026-10-27', 12450000, 12200000, 250000, '8010110003')])
add('BKK', '2026-10-14', BCA, P('', 'Telkom Indonesia (IndiHome Bisnis)'), 'Internet & phone · 14 units · September', [O('6010310005', 'Internet & phone · September', 6245000)])
add('BKK', '2026-10-14', BCA, NOP, 'Top-up · petty cash HO', [O(PETTY, 'Top-up · petty cash HO', 1000000)])
add('BKK', '2026-10-15', BCA, P('', 'PLN (Persero)'), 'Electricity · 9 shops · September 2026', [O('6010310006', 'Electricity · 9 shops · September', 14820000)])
add('BKK', '2026-10-16', a12(PETTY), P('', 'Toko Sumber Rejeki'), 'Drinking water & soap', [O('6010310003', 'Drinking water & soap', 85000)])
add('BKK', '2026-10-17', a12(CASH), P('', 'Yusuf Ramadhan'), 'Advance · trip to supplier in Bandung', [O('1011102001', 'Advance · trip to supplier', 750000)])
add('BKK', '2026-10-19', BCA, GCL, 'Bill INV/GC/2026/0188', [Sl('INV/GC/2026/0188', '2026-10-14', 4200000, 4200000)])
add('BKK', '2026-10-20', MDR, P('', 'Karya Bangun Renovasi, CV'), 'Renovation · Shop C005 · final stage', [O('1031803001', 'Renovation · Shop C005 · final stage', 38200000)])
add('BKK', '2026-10-22', BCA, P('', 'Solusi Komputer Prima, PT'), 'Laptops · 2 units · Finance', [O('1021506003', 'Laptops · 2 units', 17980000)])
add('BKK', '2026-10-25', BCA, NOP, 'Payroll · October', [O('6010111001', 'Salaries · shops · October', 248600000), O('6010210001', 'Salaries · head office · October', 63800000)])
add('BKK', '2026-10-26', BCA, P('', 'Bank BCA'), 'Bank charges · October 2026', [O('6010310004', 'Bank charges', 25000)])
// ── October: giro out
giro('2026-10-02', OGB, BCA, GMS, 'BCA-GRV-0258', '2026-10-12', 'Cleared', '2026-10-12', [Sl('INV/GMS/2026/0877', '2026-10-12', 58000000, 58000000)], 'Bill INV/GMS/2026/0877')
giro('2026-10-09', OGB, BCA, SSJ, 'BCA-GRV-0260', '2026-10-19', 'Cleared', '2026-10-19', [Sl('INV/SS/2026/0918', '2026-10-19', 15750000, 15750000)], 'Bill INV/SS/2026/0918')
giro('2026-10-11', OGB, BCA, GMS, 'BCA-GRV-0259', '2026-10-25', 'Cleared', '2026-10-25', [Sl('INV/GMS/2026/0901', '2026-10-25', 32500000, 32500000)], 'Bill INV/GMS/2026/0901')
giro('2026-10-13', OGB, BCA, GNU, 'BCA-GRV-0261', '2026-10-20', 'Cleared', '2026-10-20', [Sl('INV/GN/2026/1102', '2026-10-20', 37840000, 37840000)], 'Bill INV/GN/2026/1102')
giro('2026-10-14', OGM, MDR, GNU, 'MDR-GRV-2204', '2026-10-28', 'New', '', [Sl('INV/GN/2026/1131', '2026-10-28', 9800000, 9800000)], 'Bill INV/GN/2026/1131')
giro('2026-10-15', OGB, BCA, SSJ, 'BCA-GRV-0262', '2026-10-30', 'New', '', [Sl('INV/SS/2026/0931', '2026-10-30', 25600000, 25600000), Sl('INV/SS/2026/0935', '2026-10-30', 23000000, 23000000)], 'Bills INV/SS/2026/0931 and 0935')
giro('2026-10-16', OGB, BCA, BAL, 'BCA-GRV-0263', '2026-11-06', 'New', '', [Sl('INV/BAL/2026/0788', '2026-11-06', 21300000, 21300000)], 'Bill INV/BAL/2026/0788')
giro('2026-10-17', OGB, BCA, CAT, 'BCA-GRV-0264', '2026-10-24', 'New', '', [Sl('INV/AT/2026/0644', '2026-10-24', 18000000, 18000000)], 'Bill INV/AT/2026/0644')
// ── October: BKM
add('BKM', '2026-10-02', BCA, P('', 'Bank BCA'), 'Bank loan · drawdown', [O('2022402001', 'Bank loan · drawdown', 150000000)])
add('BKM', '2026-10-06', a12(CASH), P('', 'Dian Pertiwi'), 'Advance returned · ADV-000025', [O('1011102001', 'Advance returned', 340000)])
add('BKM', '2026-10-09', BCA, GNU, 'Refund · short delivery PO-101026-003', [O('2012001001', 'Refund · short delivery', 3060000)])
add('BKM', '2026-10-12', a12(CASH), P('', 'Pengepul Barokah'), 'Scrap sale · hangers & cartons', [O('8010110007', 'Scrap sale · hangers & cartons', 315000)])
add('BKM', '2026-10-16', BCA, P('', 'Asuransi Sinar Mas, PT'), 'Insurance claim · water damage Shop C005', [O('8010110007', 'Insurance claim · water damage', 4250000)])
// ── card and QRIS settled by the banks, every week (the cash side of the receivable)
const EDC = (bank, tag, code, rows) => rows.forEach(([date, owed]) => {
  const pot = Math.round(owed * 0.007 / 50) * 50, end = addD(date, -1)
  add('BKM', date, bank, P(code, `Bank ${tag} · card settlement`), `Debit, credit and QRIS takings · week ending ${dayS(end)}`, [Sl(`EDC-${tag}-${end.slice(2)}`, date, owed, owed - pot, pot, '6010110002', '1011101002')])
})
EDC(BCA, 'BCA', 'B-001', [['2026-09-07', 268412500], ['2026-09-14', 279650000], ['2026-09-21', 262938500], ['2026-09-28', 281175000], ['2026-10-05', 274206000], ['2026-10-12', 288930500], ['2026-10-19', 266418000], ['2026-10-26', 283704500]])
EDC(MDR, 'MDR', 'B-002', [['2026-09-08', 112240000], ['2026-09-15', 118905500], ['2026-09-22', 109372000], ['2026-09-29', 121860500], ['2026-10-06', 114538000], ['2026-10-13', 120144500], ['2026-10-20', 111026000], ['2026-10-27', 117912500]])

/* ═════════ vouchers: the shops, generated (cash takings → deposit to bank, petty cash) ═════════ */
const SH = [
  { loc: 'C001', base: 1350000, bank: BCA, gap: 2, petty: 650000, flt: 500000, shorts: { '2026-10-09': 15000 } },
  { loc: 'C002', base: 1700000, bank: MDR, gap: 3, stop: '2026-10-23', petty: 800000, flt: 500000 },
  { loc: 'C003', base: 1100000, bank: BCA, gap: 2, petty: 500000, flt: 500000, shorts: { '2026-10-19': 42000 }, spend: [['2026-09-12', 'Fuel for van', 260000, '6010310017'], ['2026-09-22', 'Drinking water & cleaning', 345000, '6010310001'], ['2026-10-02', 'AC repair', 750000, '6010410007'], ['2026-10-15', 'Staff meal · stock count', 300000, '6010310014'], ['2026-10-24', 'Parking & courier', 94000, '6010310009']] },
  { loc: 'C004', base: 950000, bank: BCA, gap: 3, petty: 700000, flt: 300000 },
  { loc: 'C005', base: 1500000, bank: MDR, gap: 2, stop: '2026-10-22', petty: 600000, flt: 500000, diffs: { '2026-10-12': -20000 } },
  { loc: 'C006', base: 1250000, bank: BCA, gap: 2, petty: 550000, flt: 400000, shorts: { '2026-09-18': 8000 } },
  { loc: 'C007', base: 1050000, bank: BCA, gap: 3, petty: 480000, flt: 400000 },
  { loc: 'C008', base: 1200000, bank: BCA, gap: 2, petty: 250000, flt: 500000, noTop: true, spend: [['2026-09-20', 'Fuel for van', 120000, '6010310017'], ['2026-10-05', 'Light bulbs', 95000, '6010310015'], ['2026-10-15', 'AC repair', 210000, '6010410007']] },
  { loc: 'C009', base: 1600000, bank: BCA, gap: 2, petty: 720000, flt: 500000, diffs: { '2026-09-28': 10000 } },
  { loc: 'C010', base: 900000, bank: BCA, gap: 3, petty: 530000, flt: 300000 },
  { loc: 'C011', base: 1450000, bank: MDR, gap: 2, petty: 610000, flt: 500000, lastFloat: '2026-10-12' },
  { loc: 'C012', base: 1000000, bank: BCA, gap: 3, petty: 450000, flt: 400000 },
  { loc: 'C013', base: 1150000, bank: BCA, gap: 2, petty: 580000, flt: 500000 },
]
const SPEND = [['Fuel for van', '6010310017', 90, 280], ['Drinking water & cleaning', '6010310001', 40, 140], ['Stationery', '6010310002', 30, 120], ['Parking & courier', '6010310009', 20, 110], ['Light bulbs', '6010310015', 40, 150], ['Staff meal · stock count', '6010310014', 150, 320]]
const VENDOR = ['Toko Sumber Rejeki', 'Ojek online', 'Toko ATK Jaya', 'SPBU Pertamina', 'Warung Bu Ani', 'Toko Listrik Abadi']
const SHM = {}, SALES = [], OPEN0 = {}
SH.forEach((s, k) => {
  const r = rng(11 + k * 12), loc = s.loc, cash = a12(CASH, loc), petty = a12(PETTY, loc)
  const days = rangeD('2026-08-31', '2026-10-26').map(d => ({ date: d, amt: Math.round(s.base * (.55 + r() * .9) * ([0, 6].includes(wd(d)) ? 1.25 : 1) / 50) * 50, short: 0, dep: null }))
  OPEN0[cash] = days[0].amt; OPEN0[petty] = s.petty; OPEN0[a12(FLOAT, loc)] = s.flt
  days.slice(1).forEach(d => SALES.push({ loc, date: d.date, amt: d.amt }))
  let i0 = 0, lastDep = ''
  for (;;) {
    const batch = days.slice(i0, i0 + s.gap)
    if (batch.length < s.gap) break
    const dd = addD(batch[batch.length - 1].date, 1)
    if (dd > TODAY || (s.stop && dd > s.stop)) break
    let total = 0, short = 0
    batch.forEach(d => { d.short = (s.shorts || {})[d.date] || 0; total += d.amt; short += d.short })
    const a = batch[0].date, b = batch[batch.length - 1].date
    const lines = [Oa(s.bank, `Deposit · takings ${a === b ? dayS(a) : dayS(a) + ' – ' + dayS(b)}`, total - short)]
    if (short) lines.push(O('8010110007', `Cash short at count · ${dayS(batch.find(d => d.short).date)}`, short, loc))
    add('BKK', dd, cash, NOP, `Takings ${a === b ? dayS(a) : dayS(a) + ' – ' + dayS(b)} · deposit to ${s.bank === BCA ? 'Bank BCA' : 'Bank Mandiri'}`, lines, { by: `Shop head ${loc}`, deposit: true })
    const v = RAW[RAW.length - 1]; batch.forEach(d => { d.dep = v }); lastDep = dd; i0 += s.gap
  }
  // petty cash: spends, and a top-up from head office the day before the box runs low
  const ev = s.spend ? s.spend.map(x => x) : (() => {
    const out = []; for (let n = 0; n < 8; n++) { const sp = SPEND[Math.floor(r() * SPEND.length)]; const d = n < 4 ? addD('2026-09-03', Math.floor(r() * 26)) : addD('2026-10-02', Math.floor(r() * 24)); out.push([d, sp[0], Math.round((sp[2] + r() * (sp[3] - sp[2])) / 5) * 5 * 1000, sp[1]]) } return out.sort((x, y) => x[0].localeCompare(y[0]))
  })()
  let pb = s.petty
  ev.forEach(([d, what, amt, acc], n) => {
    if (!s.noTop && pb - amt < 150000) { add('BKK', addD(d, -1), BCA, P('', `Top-up · petty cash ${loc}`), `Top-up · petty cash ${loc}`, [Oa(petty, `Top-up · petty cash ${loc}`, 1000000)], { topup: loc }); pb += 1000000 }
    pb -= amt
    add('BKK', d, petty, P('', VENDOR[(k + n) % VENDOR.length]), what, [O(acc, what, amt, loc)], { by: `Shop head ${loc}` })
  })
  // weekly float counts, Mondays
  const fl = rangeD('2026-09-07', '2026-10-26').filter(d => wd(d) === 1 && (!s.lastFloat || d <= s.lastFloat)).map(d => ({ date: d, should: s.flt, counted: s.flt + ((s.diffs || {})[d] || 0) }))
  SHM[loc] = { name: SHOP[loc], days, fl, cc: lastDep, pc: addD('2026-10-26', -Math.floor(r() * 9)), fc: fl.length ? fl[fl.length - 1].date : '', short: s.shorts || {} }
})

/* ═════════ numbering, journal lines, entries ═════════ */
RAW.sort((x, y) => x.date.localeCompare(y.date) || x.i - y.i)
const VOUCHERS = RAW, VBY = {}, seq = {}
VOUCHERS.forEach(v => {
  const loc = locOf(v.acct), k = `${v.type}|${loc}|${v.date.slice(2, 7)}`
  seq[k] = (seq[k] || 0) + 1
  v.loc = loc
  v.no = loc === 'HO' ? `${v.type}-${v.date.slice(2, 4)}-${v.date.slice(5, 7)}-${pad(seq[k], 5)}` : `${v.type}-${loc}-${v.date.slice(2, 4)}-${v.date.slice(5, 7)}-${pad(seq[k], 4)}`
  v.period = perOf(v.date)
  v.total = v.lines.reduce((a, l) => a + (l.t === 's' ? l.pay : l.amt), 0)
  VBY[v.no] = v
})
VOUCHERS.forEach(v => {
  const bkk = v.type === 'BKK', jr = []
  jr.push(bkk ? { acc: v.acct, dr: 0, cr: v.total } : { acc: v.acct, dr: v.total, cr: 0 })
  v.lines.forEach(l => {
    if (l.t === 's') {
      const ac = l.acc || (bkk ? AP : AR), side = n => bkk ? { dr: n, cr: 0 } : { dr: 0, cr: n }, other = n => bkk ? { dr: 0, cr: n } : { dr: n, cr: 0 }
      jr.push({ acc: ac, ...side(l.pay + l.pot) })
      if (l.pot) jr.push({ acc: l.potAcc, ...other(l.pot) })
    } else jr.push({ acc: l.acc, dr: bkk ? l.amt : 0, cr: bkk ? 0 : l.amt })
  })
  v.jr = jr
  if (v.replaces) { const g = VOUCHERS.find(x => x.giro && x.giro.no === v.replaces); if (g) g.repl = v.no }
})
const partyOf = (v, acc) => {
  if (v.party && v.party.name) return v.party.name
  if (acc === v.acct) { const o = v.jr.find(r => r.acc !== v.acct); return o ? alab(o.acc) : '' }
  return alab(v.acct)
}
const ENT = []
const push = (acc, date, no, type, party, dr, cr, v) => { if (AM[acc]) ENT.push({ acc, date, no, type, party, dr, cr, v, i: ENT.length }) }
VOUCHERS.forEach(v => {
  v.jr.forEach(r => push(r.acc, v.date, v.no, v.type, partyOf(v, r.acc), r.dr, r.cr, v))
  const g = v.giro
  if (g && g.state === 'Cleared' && g.on <= TODAY) { push(g.bank, g.on, v.no, 'Giro cleared', partyOf(v, v.acct), 0, v.total, v); push(v.acct, g.on, v.no, 'Giro cleared', partyOf(v, v.acct), v.total, 0, v) }
  if (g && g.state === 'Bounced' && g.on <= TODAY) push(v.acct, g.on, v.no, 'Giro bounced', partyOf(v, v.acct), v.total, 0, v)
})
SALES.forEach(s => push(a12(CASH, s.loc), s.date, `SD-${s.loc}-${s.date.slice(2, 4)}-${s.date.slice(5, 7)}-${s.date.slice(8)}`, 'Daily sales', 'Cash sales', s.amt, 0, null))
ENT.sort((x, y) => x.date.localeCompare(y.date) || x.i - y.i)
const E_BY = {}
ENT.forEach(e => (E_BY[e.acc] = E_BY[e.acc] || []).push(e))
/* runtime postings must reach both the flat list and the per-account index */
function postEntry(acc, date, no, type, party, dr, cr, v) {
  if (!AM[acc]) return
  const e = { acc, date, no, type, party, dr, cr, v, i: ENT.length }
  ENT.push(e); (E_BY[acc] = E_BY[acc] || []).push(e)
  E_BY[acc].sort((a, b) => a.date.localeCompare(b.date))
}

/* opening balances: head office from the books at 1 Oct, the shops from their last count; 1 Sep is derived */
const net = (acc, before) => (E_BY[acc] || []).reduce((a, e) => a + (e.date < before ? e.dr - e.cr : 0), 0)
const OCT_HO = { [a12(CASH)]: KAS[0].open, [a12(PETTY)]: KAS[1].open, [a12(FLOAT)]: KAS[2].open, [BCA]: KAS[3].open, [MDR]: KAS[4].open, [TAB]: KAS[5].open }
OCT_HO[OGB] = -VOUCHERS.filter(v => v.giro && v.acct === OGB && v.date < '2026-10-01' && (!v.giro.on || v.giro.on >= '2026-10-01')).reduce((a, v) => a + v.total, 0)
OCT_HO[OGM] = -VOUCHERS.filter(v => v.giro && v.acct === OGM && v.date < '2026-10-01' && (!v.giro.on || v.giro.on >= '2026-10-01')).reduce((a, v) => a + v.total, 0)
Object.keys(OCT_HO).forEach(a => { OPEN0[a] = OCT_HO[a] - net(a, '2026-10-01') })
ACCTS.forEach(a => { if (OPEN0[a.code] == null) OPEN0[a.code] = 0 })

function flows(acc, p) {
  const es = E_BY[acc] || []; let open = OPEN0[acc] || 0, dr = 0, cr = 0
  for (const e of es) { if (e.date < p.from) open += e.dr - e.cr; else if (e.date <= p.to) { dr += e.dr; cr += e.cr } }
  return { open, dr, cr, close: open + dr - cr }
}
const bal = (acc, to = TODAY) => flows(acc, { from: '0000', to }).close
const entriesIn = (acc, p) => (E_BY[acc] || []).filter(e => e.date >= p.from && e.date <= p.to)

/* ── reconciliation: statement lines vs book entries ──
   The bank statement is the book plus the lines the bank knows and the books do not.
   A line can be matched to its voucher, ignored, or turned into a real BKK/BKM. */
const EXTRA_LINES = acc => {
  if (acc !== BCA && acc !== MDR) return []
  const base = `${acc}|extra`
  return [
    { id: `${base}|charge`, date: '2026-10-26', desc: 'Bank charges · October', amount: -25000, extra: true },
    ...(acc === BCA ? [{ id: `${base}|credit`, date: '2026-10-24', desc: 'Transfer from Toko Maju Jaya', amount: 12500000, extra: true }] : []),
  ]
}
const reconState = (id, fallback) => (RECON_STATE[id] = RECON_STATE[id] || { state: fallback, match: '' })
function stmtFor(acc, p) {
  const rows = []
  entriesIn(acc, p).forEach(e => {
    const id = `${acc}|${e.no}|${e.date}|${e.type}|${e.dr - e.cr}`
    const h = [...id].reduce((a, c) => a + c.charCodeAt(0), 0)
    const st = reconState(id, e.date < TODAY && h % 31 === 0 ? 'unmatched' : 'matched')
    if (st.state === 'posted') return
    rows.push({ id, date: e.date, desc: `${e.type} · ${e.party || an(acc)}`, amount: e.dr - e.cr, doc: e.no, extra: false, state: st.state, match: st.match || (st.state === 'matched' ? e.no : '') })
  })
  EXTRA_LINES(acc).forEach(x => {
    const st = reconState(x.id, 'unmatched')
    if (st.state === 'posted') return
    rows.push({ ...x, doc: '', state: st.state, match: st.match || '' })
  })
  return rows.sort((a, b) => a.date.localeCompare(b.date))
}
function reconSummary(acc, p) {
  const lines = stmtFor(acc, p), book = flows(acc, p).close
  const openExtras = lines.filter(l => l.extra && l.state !== 'ignored')
  const extraNet = openExtras.reduce((a, l) => a + l.amount, 0)
  const statement = book + extraNet
  return { lines, book, statement, diff: statement - book, extraNet, unmatched: lines.filter(l => l.state === 'unmatched').length, ignored: lines.filter(l => l.state === 'ignored').length, openExtras }
}
const bankAccount = () => {
  const code = filt(ID, 'racct', BCA), a = AM[code]
  return a && a.grp === 'Bank' ? code : BCA
}

/* ═════════ small pieces ═════════ */
const m = n => n ? num(n) : DASH
const sel = (id, key, opts, cur, label) => `<div class="sel"><select aria-label="${label || key}" onchange="setFilt('${id}','${key}',this.value)">${opts.map(([v, l]) => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>${ico('chevron-down')}</div>`
const seg = h => h.replace('class="chips"', 'class="chips seg"')
const one = s => `<span class="one">${s}</span>`
const fact = (t, v, wide) => `<div class="ds-fact ${wide ? 'ds-fact--wide' : ''}"><dt>${t}</dt><dd>${v}</dd></div>`
const facts = xs => `<dl class="ds-facts">${xs.join('')}</dl>`
const scroll = h => `<div style="overflow-x:auto">${h}</div>`
const dayCell = d => `<span class="mute">${dayS(d)}</span>`
const partyCode = v => v.party && v.party.code ? esc(v.party.code) : DASH
const partyName = v => v.party && v.party.name ? one(esc(v.party.name)) : DASH
const giroState = v => { const g = v.giro; if (!g) return ''; if (g.state === 'Cleared') return 'Cleared'; if (g.state === 'Bounced') return 'Bounced'; return g.due < TODAY ? 'Overdue' : 'New' }
const kpi = (label, value, bad) => ({ label, value, bad })

/* ═════════ the voucher, as a sheet: facts, lines, journal ═════════ */
window.openVoucher = (no, crumbHead) => {
  const v = VBY[no]; if (!v) return
  const bkk = v.type === 'BKK', g = v.giro, gs = giroState(v)
  const fx = [
    fact('Date', day(v.date)),
    fact(bkk ? 'Paid from' : 'Received into', esc(`${v.acct} · ${an(v.acct)} ${v.loc}`)),
    fact(bkk ? 'Paid to' : 'Received from', v.party && v.party.name ? esc((v.party.code ? v.party.code + ' · ' : '') + v.party.name) : DASH),
    fact('Cheque / giro no', g ? esc(`${g.no} · due ${day(g.due)}`) : DASH),
    fact('Cleared at', g && g.state === 'Cleared' ? esc(`${an(g.bank)} · ${day(g.on)}`) : g && g.state === 'Bounced' ? `Bounced ${day(g.on)}` : DASH),
    fact('Period', v.period), fact('Entered by', esc(v.by)),
    fact('Note', esc(v.note), true),
  ]
  const sl = v.lines.filter(l => l.t === 's'), ol = v.lines.filter(l => l.t === 'o')
  let body = facts(fx)
  if (sl.length) body += section(bkk ? 'Payables settled' : 'Receivables settled', table({
    cols: [{ l: 'Invoice', k: 'd' }, { l: 'Due', k: 'due', w: 100 }, { l: bkk ? 'Owed' : 'Billed', k: 'ow', num: 1, w: 130 }, { l: 'Discount', k: 'po', num: 1, w: 110 }, { l: bkk ? 'Paid' : 'Received', k: 'pa', num: 1, w: 130 }],
    rows: sl.map(l => ({ c: { d: esc(l.doc), due: dayCell(l.due), ow: num(l.owed), po: m(l.pot), pa: num(l.pay) } })),
    foot: { d: 'Total', ow: num(sl.reduce((a, l) => a + l.owed, 0)), po: m(sl.reduce((a, l) => a + l.pot, 0)), pa: num(sl.reduce((a, l) => a + l.pay, 0)) },
  }))
  if (ol.length) body += section('Other lines', table({
    cols: [{ l: 'Account', k: 'a', w: 330 }, { l: 'For', k: 'f' }, { l: 'Amount', k: 'm', num: 1, w: 140 }],
    rows: ol.map(l => ({ c: { a: one(esc(`${l.acc} · ${an(l.acc)}`)), f: one(esc(l.desc)), m: num(l.amt) } })),
    foot: ol.length > 1 ? { a: 'Total', m: num(ol.reduce((a, l) => a + l.amt, 0)) } : null,
  }))
  body += section('Journal', table({
    cols: [{ l: 'Account', k: 'a' }, { l: 'Debit', k: 'dr', num: 1, w: 140 }, { l: 'Credit', k: 'cr', num: 1, w: 140 }],
    rows: v.jr.map(r => ({ c: { a: one(esc(`${r.acc} · ${an(r.acc)} ${locOf(r.acc) === 'HO' ? '' : locOf(r.acc)}`.trim())), dr: m(r.dr), cr: m(r.cr) } })),
    foot: { a: 'Total', dr: num(v.jr.reduce((a, r) => a + r.dr, 0)), cr: num(v.jr.reduce((a, r) => a + r.cr, 0)) },
  }))
  openSheet({
    crumb: [...(crumbHead || ['Cash & bank']), v.type], title: esc(v.no), size: 'wide',
    pill: g ? pill(gs, gs === 'Bounced' || gs === 'Overdue' ? 'bad' : gs === 'Cleared' ? 'ok' : '') : pill('Posted'),
    body, foot: btn('Print', `printSheet('${v.no}')`),
  })
}

/* ═════════ 1 · Cash & bank info ═════════ */
const ID = 'kas-info'
const inLoc = (a, loc) => loc === 'ALL' || a.loc === loc

/* ── filters: a preset month, or any range the reader types ── */
function periodNow() {
  const f = S.f[ID] || {}
  if (f.per === 'custom') {
    let from = f.from || PER.oct.from, to = f.to || PER.oct.to
    if (from > to) { const t = from; from = to; to = t }
    return { from, to, label: 'Custom range', short: 'Custom' }
  }
  return PER[f.per || 'oct'] || PER.oct
}
window.setRange = (k, v) => { const f = S.f[ID] = S.f[ID] || {}; f[k] = v; f.per = 'custom'; render() }
window.resetKasFilters = () => { S.f[ID] = { per: 'oct' }; S.q[ID] = ''; render() }
window.refreshKas = () => { toast('Refreshed', 'The account balances were read again'); render() }

/* ── small helpers for real actions ── */
const toNum = v => { const n = Number(String(v ?? '').replace(/[^\d-]/g, '')); return isFinite(n) ? n : 0 }
const plain = s => String(s ?? '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()
function csvDownload(name, rows) {
  const csv = rows.map(r => r.map(c => `"${plain(c).replace(/"/g, '""')}"`).join(',')).join('\r\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob); a.download = name
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}
window.printPage = title => {
  const src = document.querySelector('.ds-page-content')
  if (!src) return window.print()
  const w = window.open('', '_blank')
  if (!w) return window.print()
  const c = src.cloneNode(true)
  c.querySelectorAll('.door-actions,.v7bar,.kas-filter,.ds-search,.chips,.ds-tabs').forEach(x => x.remove())
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>body{font:13px/1.45 Inter,system-ui,sans-serif;padding:24px;color:#1d1d1f}table{width:100%;border-collapse:collapse;margin:12px 0}th,td{padding:6px 8px;border-bottom:1px solid #ddd;text-align:left;vertical-align:top}th{background:#f4f6f9}.is-num{text-align:right}.ds-kpi{display:inline-block;margin-right:28px;margin-bottom:10px}.ds-kpi-label{color:#666;font-size:12px}.ds-kpi-value{font-weight:600;font-size:18px}.pill7{display:inline-block;padding:1px 6px;border:1px solid #ddd;border-radius:10px;font-size:11px}.grp-in{font-weight:600;background:#f4f6f9;padding:6px}h1{font-size:20px;margin:0 0 16px}.ds-section-title{font-size:16px;margin:20px 0 8px}.mute{color:#666}.late{color:#b25000}.ds-empty{padding:16px;color:#666}</style></head><body><h1>${esc(title)}</h1>${c.innerHTML}</body></html>`)
  w.document.close(); w.focus(); setTimeout(() => w.print(), 150)
}

window.printSheet = title => {
  const sheet = document.querySelector('.ds-sheet')
  if (!sheet) return printPage(title)
  const w = window.open('', '_blank')
  if (!w) return window.print()
  const c = sheet.cloneNode(true)
  c.querySelectorAll('.ds-sheet-close,.ds-sheet-foot,.ds-btn,.kas-act').forEach(x => x.remove())
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>body{font:13px/1.45 Inter,system-ui,sans-serif;padding:24px;color:#1d1d1f}table{width:100%;border-collapse:collapse;margin:12px 0}th,td{padding:6px 8px;border-bottom:1px solid #ddd;text-align:left;vertical-align:top}th{background:#f4f6f9}.is-num{text-align:right}.ds-facts{display:grid;grid-template-columns:1fr 1fr;gap:8px 24px}.ds-fact{display:flex;gap:12px}.ds-fact dt{color:#666;min-width:130px}.ds-fact dd{margin:0;font-weight:500}.ds-sheet-title{font-size:20px;margin:0 0 16px}.ds-sheet-crumb{color:#666;font-size:12px;margin-bottom:6px}.ds-section-title{font-size:16px;margin:20px 0 8px}.mute{color:#666}.late{color:#b25000}.pill7{display:inline-block;padding:1px 6px;border:1px solid #ddd;border-radius:10px;font-size:11px}</style></head><body>${c.innerHTML}</body></html>`)
  w.document.close(); w.focus(); setTimeout(() => w.print(), 150)
}

/* ── accounts: create, edit, deactivate ── */
function openAccountForm(code) {
  if (S.stack.length) closeSheet()
  const a = code ? AM[code] : null
  const locDefault = filt(ID, 'loc', 'HO') === 'ALL' ? 'HO' : filt(ID, 'loc', 'HO')
  const grpDefault = ['Bank', 'Giro'].includes(filt(ID, 'type', 'all')) ? filt(ID, 'type', 'all') : 'Cash'
  const body = `<div class="form-grid">
    ${field('Account code *', `<input id="acct-code" value="${a ? a.code : ''}" ${a ? 'readonly' : ''} placeholder="10 or 12 digits">`, 'span2')}
    ${field('Name *', `<input id="acct-name" value="${a ? esc(a.name) : ''}" placeholder="Cash In Bank Giro Bank BCA">`, 'span2')}
    ${field('Type', `<select id="acct-grp">${['Cash', 'Bank', 'Giro'].map(g => `<option ${a ? (a.grp === g ? 'selected' : '') : (grpDefault === g ? 'selected' : '')}>${g}</option>`).join('')}</select>`)}
    ${field('Location', `<select id="acct-loc" ${a ? 'disabled' : ''}>${LC.map(l => `<option value="${l}" ${a ? (a.loc === l ? 'selected' : '') : (l === locDefault ? 'selected' : '')}>${l} · ${esc(SHOP[l])}</option>`).join('')}</select>`)}
    ${field('Bank', `<input id="acct-bank" value="${a ? esc(a.bank || '') : ''}" placeholder="Bank BCA">`)}
    ${field('Account number', `<input id="acct-num" value="${a ? esc(a.number || '') : ''}" placeholder="•••• 4821">`)}
    ${field('Keterangan', `<input id="acct-note" value="${a ? esc(a.note || '') : ''}" placeholder="What this account is for">`, 'span2')}
    ${field('Opening balance', `<input id="acct-open" value="${a ? num(OPEN0[a.code] || 0) : '0'}" inputmode="numeric">`)}
    ${field('Status', `<label style="height:44px;display:flex;align-items:center;gap:8px"><input type="checkbox" id="acct-active" ${!a || a.active ? 'checked' : ''}> Active</label>`)}
  </div><p class="page-sub">The code is the 12-digit account: 10-digit COA + 2-digit location (00 head office, 01–13 shops). Leave the code at 10 digits and the form appends the location.</p>`
  openSheet({
    crumb: ['Cash & bank'], title: a ? `Edit ${a.code}` : 'New account', size: 'wide', body,
    foot: btn('Save account', `saveAccount('${a ? a.code : ''}')`),
  })
}
window.openAccountForm = openAccountForm
window.saveAccount = orig => {
  const el = id => document.getElementById(id)
  let code = (el('acct-code')?.value || '').replace(/\D/g, '')
  const loc = el('acct-loc')?.value || 'HO'
  const grp = el('acct-grp')?.value || 'Cash'
  const name = (el('acct-name')?.value || '').trim()
  if (!orig && code.length === 10) code += String(LOC_CODES.indexOf(loc)).padStart(2, '0')
  if (!/^\d{12}$/.test(code)) return toast('Check the account code', 'Use 10 digits plus a location, or 12 digits in total')
  const locSuffix = String(LOC_CODES.indexOf(loc)).padStart(2, '0')
  if (code.slice(10) !== locSuffix) return toast('Code and location do not match', `${loc} uses suffix ${locSuffix}; the code ends with ${code.slice(10)}`)
  if (!name) return toast('Name is required', 'Give the account a name people recognise')
  if (!orig && AM[code]) return toast('That code already exists', code)
  const opening = toNum(el('acct-open')?.value)
  const active = !!el('acct-active')?.checked
  let bank = (el('acct-bank')?.value || '').trim()
  let number = (el('acct-num')?.value || '').trim()
  const note = (el('acct-note')?.value || '').trim()
  if (grp === 'Cash') { bank = ''; number = '' }
  if (orig) {
    const a = AM[orig]; if (!a) return
    a.name = name; a.grp = grp; a.bank = bank; a.number = number; a.note = note; a.active = active; a.base = code.slice(0, 10)
    OPEN0[orig] = opening
    AM[orig] = a
  } else {
    const a = { code, base: code.slice(0, 10), loc, grp, name, bank, number, note, active }
    ACCTS.push(a); AM[code] = a; OPEN0[code] = opening
  }
  closeSheet()
  toast(orig ? 'Account updated' : 'Account added', `${code} · ${name}`)
  render()
}
window.toggleAccount = code => {
  const a = AM[code]; if (!a) return
  a.active = !a.active
  closeSheet(); render(); openManageAccounts()
  toast(a.active ? 'Account active' : 'Account deactivated', `${a.code} · ${a.name}`)
}
function openManageAccounts() {
  const rows = ACCTS.map(a => ({
    c: {
      code: a.code, name: one(esc(a.name + (a.loc === 'HO' ? '' : ' · ' + a.loc))), type: a.grp, loc: a.loc,
      bank: a.grp === 'Cash' ? DASH : one(esc(`${a.bank || '—'} ${a.number || ''}`.trim())),
      status: pill(a.active ? 'Active' : 'Inactive', a.active ? 'ok' : 'bad'),
      act: `<span class="kas-act"><button type="button" class="kas-mini" onclick="event.stopPropagation();openAccountForm('${a.code}')">Edit</button><button type="button" class="kas-mini" onclick="event.stopPropagation();toggleAccount('${a.code}')">${a.active ? 'Deactivate' : 'Activate'}</button></span>`,
    },
  }))
  openSheet({
    crumb: ['Cash & bank'], title: 'Manage accounts', size: 'workspace',
    body: table({ cols: [{ l: 'Code', k: 'code', w: 130 }, { l: 'Name', k: 'name' }, { l: 'Type', k: 'type', w: 80 }, { l: 'Loc', k: 'loc', w: 70 }, { l: 'Bank / number', k: 'bank', w: 180 }, { l: 'Status', k: 'status', w: 90 }, { l: '', k: 'act', w: 170 }], rows, empty: 'No accounts yet' }),
    foot: btn('New account', 'openAccountForm()'),
  })
}
window.openManageAccounts = openManageAccounts

/* ── post a document into the demo ledger ── */
const EXP_ACCS = ['6010310004', '6010310002', '6010310005', '6010410007', '6010110007', '6010310003', '6010310006']
const INC_ACCS = ['8010110007', '8010110001', '8010110003']
function postVoucher({ type, date, acct, party, note, contra, amt }) {
  const no = `${type}-${date.slice(2, 4)}-${date.slice(5, 7)}-${String(POST_SEQ++).padStart(4, '0')}`
  const v = { type, date, acct, party: party || NOP, note, lines: [{ t: 'o', acc: contra, desc: note, amt }], by: 'Rina Kusuma', loc: locOf(acct), no, period: perOf(date), total: amt }
  v.jr = type === 'BKK'
    ? [{ acc: acct, dr: 0, cr: amt }, { acc: contra, dr: amt, cr: 0 }]
    : [{ acc: acct, dr: amt, cr: 0 }, { acc: contra, dr: 0, cr: amt }]
  VOUCHERS.push(v); VBY[no] = v
  postEntry(acct, date, no, type, (party && party.name) || note, type === 'BKM' ? amt : 0, type === 'BKK' ? amt : 0, v)
  return v
}
function voucherForm(type, opts = {}) {
  const isIn = type === 'BKM'
  const accs = ACCTS.filter(a => a.active && a.grp !== 'Giro')
  const acctOpts = accs.map(a => `<option value="${a.code}" ${a.code === (opts.acct || BCA) ? 'selected' : ''}>${a.code} · ${esc(a.name)} ${a.loc}</option>`).join('')
  const contra = isIn ? INC_ACCS : EXP_ACCS
  const contraOpts = contra.map(c => `<option value="${c}" ${c === (opts.contra || contra[0]) ? 'selected' : ''}>${c} · ${esc(accName(c))}</option>`).join('')
  const body = `<div class="form-grid">
    ${field('Date', `<input type="date" id="nv-date" value="${opts.date || TODAY}">`)}
    ${field(isIn ? 'Received into' : 'Paid from', `<select id="nv-acct">${acctOpts}</select>`)}
    ${field('Amount', `<input id="nv-amt" inputmode="numeric" value="${opts.amt ? num(opts.amt) : ''}" placeholder="0">`)}
    ${field(isIn ? 'Income account' : 'Expense account', `<select id="nv-contra">${contraOpts}</select>`)}
    ${field('Party', `<input id="nv-party" value="${opts.party ? esc(opts.party) : ''}" placeholder="Name on the document">`, 'span2')}
    ${field('Note', `<input id="nv-note" value="${opts.note ? esc(opts.note) : ''}" placeholder="What this is for">`, 'span2')}
  </div><p class="page-sub">Posting here changes the demo ledger immediately: the account balance, the ledger card, the reports and the reconciliation all read it.</p>`
  openSheet({
    crumb: ['Cash & bank', type], title: opts.title || `New ${type}`, size: 'wide', body,
    foot: btn(`Post ${type}`, `saveVoucher('${type}')`),
  })
}
window.openNewVoucher = type => voucherForm(type)
window.saveVoucher = type => {
  const el = id => document.getElementById(id)
  const acct = el('nv-acct')?.value, date = el('nv-date')?.value, contra = el('nv-contra')?.value
  const amt = toNum(el('nv-amt')?.value), party = (el('nv-party')?.value || '').trim(), note = (el('nv-note')?.value || '').trim()
  if (!acct || !date || !contra || !amt) return toast('Check the document', 'Date, account, amount and account code are required')
  const v = postVoucher({ type, date, acct, party: P('', party), note: note || `${type} ${date}`, contra, amt })
  closeSheet(); toast(`${type} posted`, `${v.no} · ${money(amt)}`); render()
}

/* ── transfers and deposits ── */
function transferForm(fromPref, toPref, amtPref) {
  const accs = ACCTS.filter(a => a.active && a.grp !== 'Giro')
  const opts = cur => accs.map(a => `<option value="${a.code}" ${a.code === cur ? 'selected' : ''}>${a.code} · ${esc(a.name)} ${a.loc}</option>`).join('')
  const body = `<div class="form-grid">
    ${field('From', `<select id="tr-from">${opts(fromPref || BCA)}</select>`, 'span2')}
    ${field('To', `<select id="tr-to">${opts(toPref || a12(CASH))}</select>`, 'span2')}
    ${field('Date', `<input type="date" id="tr-date" value="${TODAY}">`)}
    ${field('Amount', `<input id="tr-amt" inputmode="numeric" value="${amtPref ? num(Math.round(amtPref)) : ''}" placeholder="0">`)}
    ${field('Note', `<input id="tr-note" value="Transfer between accounts">`, 'span2')}
  </div><p class="page-sub">A transfer posts both sides: money out of one cash/bank account and into the other. A shop deposit is the same movement, from the shop's cash box to its bank.</p>`
  openSheet({
    crumb: ['Cash & bank'], title: 'Transfer or deposit', size: 'wide', body,
    foot: btn('Post transfer', 'saveTransfer()'),
  })
}
window.openTransfer = (from, to, amt) => transferForm(from, to, amt)
window.saveTransfer = () => {
  const el = id => document.getElementById(id)
  const from = el('tr-from')?.value, to = el('tr-to')?.value, date = el('tr-date')?.value, amt = toNum(el('tr-amt')?.value)
  const note = (el('tr-note')?.value || '').trim() || 'Transfer between accounts'
  if (!from || !to || !date || !amt) return toast('Check the transfer', 'From, to, date and amount are required')
  if (from === to) return toast('Pick two different accounts', 'A transfer needs a source and a destination')
  const no = `TRF-${date.slice(2, 4)}-${date.slice(5, 7)}-${String(TRF_SEQ++).padStart(4, '0')}`
  const v = { type: 'BKK', date, acct: from, party: NOP, note, lines: [{ t: 'o', acc: to, desc: note, amt }], by: 'Rina Kusuma', loc: locOf(from), no, period: perOf(date), total: amt, transfer: true }
  v.jr = [{ acc: from, dr: 0, cr: amt }, { acc: to, dr: amt, cr: 0 }]
  VOUCHERS.push(v); VBY[no] = v
  postEntry(from, date, no, 'Transfer', note, 0, amt, v)
  postEntry(to, date, no, 'Transfer', note, amt, 0, v)
  const fromAcc = AM[from]
  if (fromAcc && fromAcc.base === CASH && SHM[fromAcc.loc]) SHM[fromAcc.loc].cc = date
  closeSheet(); toast('Transfer posted', `${money(amt)} · ${an(from)} → ${an(to)}`); render()
}

/* ── physical cash counts ── */
const countOf = loc => COUNTS[loc] || { date: '', diff: 0 }
window.openCount = loc => {
  const acc = a12(CASH, loc), book = bal(acc), c = COUNTS[loc]
  const body = `<div class="form-grid">
    ${field('Location', `<input value="${loc} · ${esc(SHOP[loc])}" readonly>`, 'span2')}
    ${field('Book balance', `<input value="${num(book)}" readonly>`)}
    ${field('Counted in the drawer', `<input id="ct-counted" inputmode="numeric" value="${c ? num(c.counted) : num(book)}">`)}
    ${field('Counted on', `<input type="date" id="ct-date" value="${TODAY}">`)}
    ${field('Note', `<input id="ct-note" placeholder="Who counted, and what they found">`)}
  </div><p class="page-sub">A cash count is the drawer, not the bank. The difference is counted − book; it becomes a decision, not an automatic journal.</p>`
  openSheet({ crumb: ['Cash & bank', 'Physical cash'], title: `Count cash · ${loc}`, size: 'wide', body, foot: btn('Save count', `saveCount('${loc}')`) })
}
window.saveCount = loc => {
  const el = id => document.getElementById(id)
  const book = bal(a12(CASH, loc)), counted = toNum(el('ct-counted')?.value)
  const date = el('ct-date')?.value || TODAY
  COUNTS[loc] = { date, book, counted, diff: counted - book }
  closeSheet(); toast('Cash count saved', `${loc} · ${money(counted - book)} difference`); render()
}
window.openTransferTo = loc => {
  const from = a12(CASH, loc), amt = bal(from)
  if (amt <= 0) return toast('Nothing to deposit', `${loc} has no cash on hand`)
  transferForm(from, BCA, amt)
}

/* ── reconciliation actions ── */
window.matchLine = id => {
  const p = periodNow(), line = stmtFor(bankAccount(), p).find(l => l.id === id)
  if (!line) return
  if (line.extra) return openLineEntry(id)
  RECON_STATE[id] = { state: 'matched', match: line.doc }
  toast('Line matched', `${line.doc} · ${money(line.amount)}`); render()
}
window.unmatchLine = id => { RECON_STATE[id] = { state: 'unmatched', match: '' }; render() }
window.ignoreLine = id => { RECON_STATE[id] = { state: 'ignored', match: '' }; render() }
window.restoreLine = id => { RECON_STATE[id] = { state: 'unmatched', match: '' }; render() }
window.finishRecon = () => {
  const acc = bankAccount(), p = periodNow(), s = reconSummary(acc, p)
  if (s.diff !== 0 || s.unmatched !== 0) return toast('Reconciliation is not finished', `${s.unmatched} line(s) open · difference ${money(s.diff)}`)
  RECON_DONE[acc] = TODAY
  toast('Reconciled', `${an(acc)} · ${day(TODAY)}`); render()
}
function openLineEntry(id) {
  const acc = bankAccount(), p = periodNow(), line = stmtFor(acc, p).find(l => l.id === id)
  if (!line || !line.extra) return
  const type = line.amount < 0 ? 'BKK' : 'BKM'
  const contra = type === 'BKK' ? EXP_ACCS : INC_ACCS
  const contraOpts = contra.map(c => `<option value="${c}" ${c === (type === 'BKK' ? '6010310004' : '8010110007') ? 'selected' : ''}>${c} · ${esc(accName(c))}</option>`).join('')
  const body = `<div class="form-grid">
    ${field('Date', `<input value="${day(line.date)}" readonly>`)}
    ${field(type === 'BKK' ? 'Paid from' : 'Received into', `<input value="${acc} · ${esc(an(acc))}" readonly>`)}
    ${field('Amount', `<input value="${num(Math.abs(line.amount))}" readonly>`)}
    ${field(type === 'BKK' ? 'Expense account' : 'Income account', `<select id="le-contra">${contraOpts}</select>`)}
    ${field('Party', `<input id="le-party" value="${esc(line.desc)}">`, 'span2')}
    ${field('Note', `<input id="le-note" value="${esc(line.desc)}">`, 'span2')}
  </div><p class="page-sub">This bank line is not in the books yet. Posting it creates a real ${type} and moves the book balance to the statement.</p>`
  openSheet({ crumb: ['Cash & bank', 'Reconciliation'], title: line.desc, size: 'wide', body, foot: btn(`Post ${type}`, `saveLineEntry('${id}')`) })
}
window.openLineEntry = openLineEntry
window.saveLineEntry = id => {
  const el = id => document.getElementById(id)
  const acc = bankAccount(), p = periodNow(), line = stmtFor(acc, p).find(l => l.id === id)
  if (!line) return
  const type = line.amount < 0 ? 'BKK' : 'BKM'
  const contra = el('le-contra')?.value, party = (el('le-party')?.value || '').trim(), note = (el('le-note')?.value || '').trim()
  const v = postVoucher({ type, date: line.date, acct: acc, party: P('', party), note: note || line.desc, contra, amt: Math.abs(line.amount) })
  RECON_STATE[id] = { state: 'posted', match: v.no }
  closeSheet(); toast(`${type} posted`, `${v.no} · ${money(Math.abs(line.amount))}`); render()
}

/* ── exports ── */
window.exportAccounts = () => {
  const p = periodNow(), loc = filt(ID, 'loc', 'HO'), type = filt(ID, 'type', 'all'), status = filt(ID, 'status', 'active')
  const rows = [['Code', 'Name', 'Type', 'Location', 'Bank', 'Number', 'Opening', 'Debit', 'Credit', 'Closing', 'Active']]
  ACCTS.filter(a => inLoc(a, loc) && (type === 'all' || a.grp === type) && (status === 'all' || (status === 'active' ? a.active : !a.active)))
    .forEach(a => { const f = flows(a.code, p); rows.push([a.code, a.name, a.grp, a.loc, a.bank, a.number, f.open, f.dr, f.cr, f.close, a.active ? 'yes' : 'no']) })
  csvDownload(`cash-bank-${p.from}-${p.to}.csv`, rows)
  toast('Exported', 'The accounts are in your downloads')
}
window.exportLedger = () => {
  const acc = filt(ID, 'acct', BCA), p = periodNow(), f = flows(acc, p)
  const rows = [['Date', 'Voucher', 'Type', 'Party', 'Debit', 'Credit', 'Balance'], ['', '', 'Opening balance', '', '', '', f.open]]
  let run = f.open
  entriesIn(acc, p).forEach(e => { run += e.dr - e.cr; rows.push([e.date, e.no, e.type, e.party, e.dr, e.cr, run]) })
  csvDownload(`ledger-${acc}-${p.from}-${p.to}.csv`, rows)
  toast('Exported', 'The ledger card is in your downloads')
}
window.exportRecon = () => {
  const acc = bankAccount(), p = periodNow(), s = reconSummary(acc, p)
  const rows = [['Date', 'Description', 'Amount', 'Document', 'Status']]
  s.lines.forEach(l => rows.push([l.date, l.desc, l.amount, l.doc, l.state]))
  csvDownload(`reconciliation-${acc}-${p.from}-${p.to}.csv`, rows)
  toast('Exported', 'The statement lines are in your downloads')
}

window.openCard = code => { (S.f[ID] = S.f[ID] || {}).acct = code; setTab(ID, 'card') }
function reconCell(a, p) {
  if (a.grp === 'Giro') return `<span class="mute">Giro register</span>`
  if (a.grp === 'Cash') {
    const c = countOf(a.loc), diff = c.diff || 0
    return c.date ? `<span class="${diff ? 'late' : ''}">${diff ? money(diff) : 'Counted'}</span><span class="mute"> · ${dayS(c.date)}</span>` : `<span class="mute">Not counted</span>`
  }
  if (!entriesIn(a.code, p).length) return `<span class="mute">No statement</span>`
  const s = reconSummary(a.code, p)
  if (s.diff === 0 && s.unmatched === 0) return `${pill('Reconciled', 'ok')}<span class="mute"> ${RECON_DONE[a.code] ? dayS(RECON_DONE[a.code]) : ''}</span>`
  return `<span class="${s.diff ? 'late' : ''}">${s.unmatched} open${s.diff ? ' · ' + money(s.diff) : ''}</span>`
}
const accRows = (list, p, ALL, withRecon) => {
  const out = []; let tot = { open: 0, dr: 0, cr: 0, close: 0 }
  ;['Cash', 'Bank', 'Giro'].forEach(grp => {
    const xs = list.filter(a => a.grp === grp); if (!xs.length) return
    if (grp !== 'Giro') out.push({ group: grp === 'Cash' ? 'Cash' : 'Bank' })
    xs.forEach(a => {
      const f = flows(a.code, p); if (grp !== 'Giro') for (const k in tot) tot[k] += f[k]
      const c = {
        code: a.code,
        name: one(esc(a.name + (ALL ? ' · ' + a.loc : ''))),
        bank: a.grp === 'Cash' ? DASH : one(esc(`${a.bank || '—'} ${a.number || ''}`.trim())),
        status: pill(a.active ? 'Active' : 'Inactive', a.active ? 'ok' : 'bad'),
        note: a.note ? one(esc(a.note)) : DASH,
        open: num(f.open), dr: m(f.dr), cr: m(f.cr), close: num(f.close),
      }
      if (withRecon) c.recon = reconCell(a, p)
      out.push({ on: `openCard('${a.code}')`, c })
    })
  })
  return { rows: out, tot }
}
const ACC_COLS = [{ l: 'Account code', k: 'code', w: 140 }, { l: 'Name', k: 'name' }, { l: 'Opening', k: 'open', num: 1, w: 140 }, { l: 'Debit', k: 'dr', num: 1, w: 140 }, { l: 'Credit', k: 'cr', num: 1, w: 140 }, { l: 'Closing', k: 'close', num: 1, w: 140 }]
const KAS_COLS = [{ l: 'Account code', k: 'code', w: 140 }, { l: 'Name', k: 'name' }, { l: 'Bank / number', k: 'bank', w: 180 }, { l: 'Status', k: 'status', w: 90 }, { l: 'Keterangan', k: 'note', w: 180 }, { l: 'Opening', k: 'open', num: 1, w: 130 }, { l: 'Debit', k: 'dr', num: 1, w: 130 }, { l: 'Credit', k: 'cr', num: 1, w: 130 }, { l: 'Closing', k: 'close', num: 1, w: 130 }, { l: 'Reconciliation', k: 'recon', w: 170 }]

function tabAccounts(p) {
  const loc = filt(ID, 'loc', 'HO'), q = S.q[ID] || ''
  const type = filt(ID, 'type', 'all'), status = filt(ID, 'status', 'active')
  const ok = a => (type === 'all' || a.grp === type) && (status === 'all' || (status === 'active' ? a.active : !a.active))
  const scope = ACCTS.filter(a => a.grp !== 'Giro' && inLoc(a, loc) && ok(a))
  const k = scope.reduce((t, a) => { const f = flows(a.code, p); return { open: t.open + f.open, dr: t.dr + f.dr, cr: t.cr + f.cr, close: t.close + f.close } }, { open: 0, dr: 0, cr: 0, close: 0 })
  const vis = ACCTS.filter(a => inLoc(a, loc) && ok(a) && hit(q, a.code, a.name, a.loc, SHOP[a.loc], a.bank, a.number, a.note))
  const main = accRows(vis.filter(a => a.grp !== 'Giro'), p, loc === 'ALL', true)
  const giro = accRows(vis.filter(a => a.grp === 'Giro'), p, loc === 'ALL', true)
  const locs = [['ALL', 'All locations'], ...LC.map(l => [l, l === 'HO' ? `${l} · Head office` : `${l} · ${SHOP[l]}`])]
  const types = [['all', 'All types'], ['Cash', 'Cash'], ['Bank', 'Bank'], ['Giro', 'Giro']]
  const states = [['active', 'Active'], ['inactive', 'Inactive'], ['all', 'All statuses']]
  let body = bar(
    search(ID, 'Search accounts, bank, number'),
    sel(ID, 'loc', locs, loc, 'Location'),
    sel(ID, 'type', types, type, 'Type'),
    sel(ID, 'status', states, status, 'Status'),
  )
  body += scroll(table({ cols: KAS_COLS, rows: main.rows, empty: 'No cash or bank account matches', foot: main.rows.length ? { name: 'Total cash & bank', open: num(main.tot.open), dr: num(main.tot.dr), cr: num(main.tot.cr), close: num(main.tot.close) } : null }))
  if (giro.rows.length) body += `<div style="height:24px"></div>` + section('Giro issued, not yet cleared', scroll(table({ cols: KAS_COLS, rows: giro.rows })))

  if (type === 'all' || type === 'Cash') {
    const phys = LC.map(l => ({ l, cash: flows(a12(CASH, l), p).close, petty: flows(a12(PETTY, l), p).close, flt: flows(a12(FLOAT, l), p).close, c: COUNTS[l], dep: SHM[l] ? SHM[l].cc : '' }))
    const t = phys.reduce((a, x) => ({ cash: a.cash + x.cash, petty: a.petty + x.petty, flt: a.flt + x.flt, diff: a.diff + (x.c ? x.c.diff : 0) }), { cash: 0, petty: 0, flt: 0, diff: 0 })
    const rows = phys.map(x => ({
      c: {
        loc: one(`${x.l} · ${esc(SHOP[x.l])}`),
        cash: num(x.cash), petty: num(x.petty), flt: num(x.flt),
        count: x.c ? dayCell(x.c.date) : DASH,
        diff: x.c && x.c.diff ? `<span class="${x.c.diff < 0 ? 'late' : 'ok'}">${money(x.c.diff)}</span>` : DASH,
        dep: x.dep ? dayCell(x.dep) : DASH,
        act: `<span class="kas-act"><button type="button" class="kas-mini" onclick="event.stopPropagation();openCount('${x.l}')">Count</button><button type="button" class="kas-mini" onclick="event.stopPropagation();openTransferTo('${x.l}')">Deposit</button></span>`,
      },
    }))
    body += section('Physical cash · the drawer, not the bank',
      `<p class="page-sub" style="margin:-6px 0 12px">Cash on hand, petty cash and the cashier float are counted in the shop. The count is compared with the book; a difference is a decision, not an automatic journal.</p>` +
      scroll(table({
        cols: [{ l: 'Location', k: 'loc' }, { l: 'Cash on hand', k: 'cash', num: 1, w: 120 }, { l: 'Petty cash', k: 'petty', num: 1, w: 115 }, { l: 'Cashier float', k: 'flt', num: 1, w: 115 }, { l: 'Last count', k: 'count', w: 100 }, { l: 'Difference', k: 'diff', num: 1, w: 120 }, { l: 'Last deposit', k: 'dep', w: 100 }, { l: '', k: 'act', w: 160 }],
        rows, foot: { loc: 'Total physical cash', cash: num(t.cash), petty: num(t.petty), flt: num(t.flt), diff: t.diff ? money(t.diff) : DASH },
      })))
  }

  return {
    kpis: [kpi('Opening', money(k.open)), kpi('Money in', money(k.dr)), kpi('Money out', money(k.cr)), kpi('Closing', money(k.close))],
    body,
    actions: [
      { label: 'New account', on: 'openAccountForm()', icon: 'plus' },
      { label: 'Manage accounts', on: 'openManageAccounts()', kind: 'secondary' },
      { label: 'Transfer', on: 'openTransfer()', kind: 'secondary' },
      { label: 'Export', on: 'exportAccounts()', kind: 'secondary', icon: 'download' },
      { label: 'Print', on: `printPage('Cash & bank')`, kind: 'secondary', icon: 'printer' },
    ],
  }
}

function acctSelect(cur) {
  const groups = LC.map(l => `<optgroup label="${l} · ${esc(SHOP[l])}">${ACCTS.filter(a => a.loc === l).map(a => `<option value="${a.code}" ${a.code === cur ? 'selected' : ''}>${a.code} · ${esc(a.name)}</option>`).join('')}</optgroup>`).join('')
  return `<div class="sel"><select aria-label="Cash or bank account" style="min-width:380px" onchange="setFilt('${ID}','acct',this.value)">${groups}</select>${ico('chevron-down')}</div>`
}
function ledgerRows(acc, p) {
  const es = entriesIn(acc, p), f = flows(acc, p); let run = f.open
  const rows = [{ cls: 'opening', c: { party: 'Opening balance', bal: num(f.open) } }]
  es.forEach(e => {
    run += e.dr - e.cr
    rows.push({ on: e.v ? `openVoucher('${e.no}')` : '', c: { date: dayCell(e.date), no: esc(e.no), type: e.type, party: one(esc(e.party)), dr: m(e.dr), cr: m(e.cr), bal: num(run) } })
  })
  return { rows, f }
}
const LEDGER_COLS = [{ l: 'Date', k: 'date', w: 84 }, { l: 'Voucher', k: 'no', w: 190 }, { l: 'Type', k: 'type', w: 128 }, { l: 'Party', k: 'party' }, { l: 'Debit', k: 'dr', num: 1, w: 128 }, { l: 'Credit', k: 'cr', num: 1, w: 128 }, { l: 'Balance', k: 'bal', num: 1, w: 138 }]
function tabCard(p) {
  const acc = filt(ID, 'acct', BCA), { rows, f } = ledgerRows(acc, p)
  const body = bar(acctSelect(acc)) + table({ cols: LEDGER_COLS, rows, foot: { party: 'Total', dr: num(f.dr), cr: num(f.cr), bal: num(f.close) } })
  return { kpis: [kpi('Opening', money(f.open)), kpi('Debit', money(f.dr)), kpi('Credit', money(f.cr)), kpi('Closing', money(f.close))], body, actions: [{ label: 'Print', on: `printPage('Ledger card')`, icon: 'printer' }, { label: 'Export', on: 'exportLedger()', kind: 'secondary', icon: 'download' }] }
}

function tabVouchers(p, type) {
  const acc = filt(ID, 'acct', BCA), only = filt(ID, 'only', '1') === '1', q = S.q[ID] || ''
  const own = v => v.acct === acc || (v.giro && v.giro.bank === acc)
  const base = VOUCHERS.filter(v => v.type === type && v.date >= p.from && v.date <= p.to)
  const nThis = base.filter(own).length
  const list = base.filter(v => (!only || own(v)) && hit(q, v.no, v.party && v.party.name, v.party && v.party.code, v.giro && v.giro.no, v.note)).sort((a, b) => b.date.localeCompare(a.date) || b.no.localeCompare(a.no))
  const cols = [{ l: 'Date', k: 'date', w: 84 }, { l: 'Voucher', k: 'no', w: 190 }, ...(only ? [] : [{ l: 'Cash / bank', k: 'acc', w: 150 }]), { l: 'Party code', k: 'code', w: 100 }, { l: 'Party', k: 'party' }, { l: 'Cheque / giro no', k: 'giro', w: 150 }, { l: 'Total', k: 'tot', num: 1, w: 130 }, { l: 'Note', k: 'note', w: 250 }, { l: 'Period', k: 'per', w: 100 }]
  const rows = list.map(v => ({ on: `openVoucher('${v.no}')`, c: { date: dayCell(v.date), no: esc(v.no), acc: one(esc(`${an(v.acct)} ${v.loc}`)), code: partyCode(v), party: partyName(v), giro: v.giro ? esc(v.giro.no) : DASH, tot: num(v.total), note: one(esc(v.note)), per: `<span class="mute">${v.period}</span>` } }))
  const total = list.reduce((a, v) => a + v.total, 0)
  const open = list.filter(v => v.giro && v.giro.state === 'New')
  const late = open.filter(v => v.giro.due < TODAY).length
  const k = [kpi(`${type} vouchers`, String(list.length)), kpi(type === 'BKM' ? 'Total received' : 'Total paid', money(total)), kpi(type === 'BKM' ? 'Largest' : 'Giro not cleared', type === 'BKM' ? money(Math.max(0, ...list.map(v => v.total))) : `${open.length}${late ? ` · ${late} overdue` : ''}`, type === 'BKK' && late > 0)]
  const body = bar(search(ID, `Search ${type}`), chips(ID, 'only', [['1', `This account · ${acc.slice(0, 10)}`, nThis], ['0', 'All accounts', base.length]], '1')) +
    table({ cols, rows, empty: `No ${type} in this period`, foot: rows.length ? { no: 'Total', tot: num(total) } : null })
  return { kpis: k, body, actions: [{ label: `New ${type}`, on: `openNewVoucher('${type}')`, icon: 'plus' }, { label: 'Print', on: `printPage('${type}')`, kind: 'secondary', icon: 'printer' }] }
}

function tabRecon(p) {
  const acc = bankAccount(), s = reconSummary(acc, p)
  const bankOpts = ACCTS.filter(a => a.grp === 'Bank').map(a => [a.code, `${a.code} · ${a.name} ${a.loc}${a.active ? '' : ' · inactive'}`])
  const only = filt(ID, 'rfilter', 'open')
  const lines = only === 'open' ? s.lines.filter(l => l.state === 'unmatched') : s.lines
  const rows = lines.map(l => {
    let act
    if (l.extra) act = `<span class="kas-act"><button type="button" class="kas-mini" onclick="event.stopPropagation();openLineEntry('${l.id}')">Create ${l.amount < 0 ? 'BKK' : 'BKM'}</button><button type="button" class="kas-mini" onclick="event.stopPropagation();${l.state === 'ignored' ? `restoreLine('${l.id}')` : `ignoreLine('${l.id}')`}">${l.state === 'ignored' ? 'Restore' : 'Ignore'}</button></span>`
    else if (l.state === 'matched') act = `<button type="button" class="kas-mini" onclick="event.stopPropagation();unmatchLine('${l.id}')">Unmatch</button>`
    else if (l.state === 'ignored') act = `<button type="button" class="kas-mini" onclick="event.stopPropagation();restoreLine('${l.id}')">Restore</button>`
    else act = `<button type="button" class="kas-mini" onclick="event.stopPropagation();matchLine('${l.id}')">Match</button>`
    return {
      c: {
        date: dayCell(l.date),
        desc: one(esc(l.desc)),
        amt: `<span class="${l.amount < 0 ? '' : 'ok'}">${num(l.amount)}</span>`,
        doc: l.doc ? esc(l.doc) : DASH,
        st: pill(l.state === 'matched' ? 'Matched' : l.state === 'ignored' ? 'Ignored' : 'Unmatched', l.state === 'matched' ? 'ok' : l.state === 'ignored' ? '' : 'warn'),
        act,
      },
    }
  })
  const total = lines.reduce((a, l) => a + l.amount, 0)
  const note = `<p class="page-sub" style="margin:-4px 0 12px">Book <b>${money(s.book)}</b> · statement <b>${money(s.statement)}</b> · difference <b class="${s.diff ? 'late' : 'ok'}">${money(s.diff)}</b>. ${s.openExtras.length} bank-only line(s) not in the books.${RECON_DONE[acc] ? ` Last reconciled ${day(RECON_DONE[acc])}.` : ''}</p>`
  const body = bar(
    sel(ID, 'racct', bankOpts, acc, 'Bank account'),
    chips(ID, 'rfilter', [['open', 'Open lines', s.unmatched], ['all', 'All lines', s.lines.length]], 'open'),
  ) + note + scroll(table({
    cols: [{ l: 'Date', k: 'date', w: 84 }, { l: 'Description', k: 'desc' }, { l: 'Amount', k: 'amt', num: 1, w: 140 }, { l: 'Document', k: 'doc', w: 190 }, { l: 'Status', k: 'st', w: 110 }, { l: '', k: 'act', w: 210 }],
    rows, empty: 'No statement lines in this range', foot: rows.length ? { desc: 'Total of the lines shown', amt: num(total) } : null,
  }))
  return {
    kpis: [kpi('Book balance', money(s.book)), kpi('Bank statement', money(s.statement)), kpi('Difference', money(s.diff), s.diff !== 0), kpi('Unmatched', String(s.unmatched), s.unmatched > 0)],
    body,
    actions: [
      { label: 'Finish reconciliation', on: 'finishRecon()' },
      { label: 'Export', on: 'exportRecon()', kind: 'secondary', icon: 'download' },
      { label: 'Print', on: `printPage('Bank reconciliation')`, kind: 'secondary', icon: 'printer' },
    ],
  }
}

reg({
  id: ID, group: 'cash', label: 'Cash & bank info',
  render() {
    const tab = tabOf(ID, 'accounts'), p = periodNow()
    const r = tab === 'recon' ? tabRecon(p) : tab === 'card' ? tabCard(p) : tab === 'bkm' ? tabVouchers(p, 'BKM') : tab === 'bkk' ? tabVouchers(p, 'BKK') : tabAccounts(p)
    const pbar = `<div class="kas-filter">${seg(chips(ID, 'per', [['sep', 'September 2026'], ['oct', 'October 2026'], ['custom', 'Custom']], 'oct'))}<label class="ctl-l">From <input type="date" class="ctl" value="${p.from}" onchange="setRange('from',this.value)"></label><label class="ctl-l">Sampai tanggal <input type="date" class="ctl" value="${p.to}" onchange="setRange('to',this.value)"></label><span class="mute">${p.label}</span><button class="chip" type="button" onclick="refreshKas()">Refresh</button><button class="chip" type="button" onclick="resetKasFilters()">Reset</button></div>`
    return page({ title: 'Cash & bank info', sub: 'Accounts, reconciliation and physical cash. The actions change this demo ledger in memory; reloading the page resets it.', actions: r.actions, tabs: [['accounts', 'Accounts'], ['recon', 'Reconciliation'], ['card', 'Ledger card'], ['bkm', 'BKM'], ['bkk', 'BKK']], tab, kpis: r.kpis, body: pbar + r.body })
  },
})

/* ═════════ 2 · Cash & bank reports ═════════ */
const RID = 'kas-report'
const vIn = (p, sc, f) => { const acct = filt(RID, 'acct', ''); return VOUCHERS.filter(v => v.date >= p.from && v.date <= p.to && (sc === 'ALL' || v.loc === sc) && (!acct || v.acct === acct || (v.giro && v.giro.bank === acct)) && (!f || f(v))) }
const accsIn = sc => { const acct = filt(RID, 'acct', ''); return ACCTS.filter(a => a.grp !== 'Giro' && (sc === 'ALL' || a.loc === sc) && (!acct || a.code === acct)) }
const T = (cols, rows, foot, empty) => scroll(table({ cols, rows, foot, empty: empty || 'Nothing in this period' }))
const gl = v => v.giro
const pty = v => (v.party && v.party.name) ? one(esc(v.party.name)) : one(esc(v.type === 'BKK' ? (v.jr.find(r => r.acc !== v.acct) ? alab(v.jr.find(r => r.acc !== v.acct).acc) : '') : alab(v.acct)))
const sumL = (ls, k) => ls.reduce((a, l) => a + l[k], 0)

const REPORTS = [
  ['Balances', [
    ['daily', 'Daily balance'], ['dailyv', 'Daily balance · by voucher'], ['dailyl', 'Daily balance · every line'], ['perl', 'Mutation · every line'], ['per', 'Mutation per account'], ['perv', 'Mutation per account · by voucher'],
  ]],
  ['Settlements', [['arS', 'Receivables settled · summary'], ['arD', 'Receivables settled · detail'], ['apS', 'Payables settled · summary'], ['apD', 'Payables settled · detail']]],
  ['Other cash in and out', [['inS', 'BKM other income · summary'], ['inD', 'BKM other income · detail'], ['outS', 'BKK other expenses · summary'], ['outD', 'BKK other expenses · detail']]],
  ['Giro', [['gIn', 'Giro in'], ['gOut', 'Giro out'], ['gInOpen', 'Giro in not yet cleared'], ['gOutOpen', 'Giro out not yet cleared'], ['gInBad', 'Giro in bounced'], ['gOutBad', 'Giro out bounced']]],
]
const RNAME = Object.fromEntries(REPORTS.flatMap(([, xs]) => xs))
const AS_OF = new Set(['gInOpen', 'gOutOpen'])

/* giro in: the banks' own slips, kept as a short list */
const GIN = [
  { bkm: 'BKM-26-10-00031', no: 'BCA-GM-771204', who: 'Toko Maju Jaya', code: 'C-0212', made: '2026-10-14', due: '2026-10-28', bank: 'Bank BCA', amt: 5825000, state: 'New' },
  { bkm: 'BKM-26-10-00033', no: 'MDR-GM-338810', who: 'Agung Jaya Sentosa', code: 'M89', made: '2026-10-16', due: '2026-10-24', bank: 'Bank Mandiri', amt: 20000000, state: 'New' },
  { bkm: 'BKM-26-10-00034', no: 'BCA-GM-771250', who: 'Citra Terang Sinar Mulyo', code: 'C17', made: '2026-10-19', due: '2026-11-02', bank: 'Bank BCA', amt: 442850, state: 'New' },
  { bkm: 'BKM-26-09-00019', no: 'BCA-GM-770981', who: 'Toko Maju Jaya', code: 'C-0212', made: '2026-09-12', due: '2026-09-26', bank: 'Bank BCA', amt: 12750000, state: 'Cleared', on: '2026-09-26' },
  { bkm: 'BKM-26-09-00022', no: 'MDR-GM-338702', who: 'Gunawan, Bpk Indah', code: 'G03', made: '2026-09-18', due: '2026-10-02', bank: 'Bank Mandiri', amt: 34250, state: 'Bounced', on: '2026-10-02', repl: 'BKM-26-10-00027' },
  { bkm: 'BKM-26-09-00025', no: 'BCA-GM-770990', who: 'Agung Jaya Sentosa', code: 'M89', made: '2026-09-22', due: '2026-10-06', bank: 'Bank BCA', amt: 17763250, state: 'Cleared', on: '2026-10-06' },
]
const gInState = g => g.state === 'New' && g.due < TODAY ? 'Overdue' : g.state
const stCell = s => pill(s, s === 'Bounced' || s === 'Overdue' ? 'bad' : s === 'Cleared' ? 'ok' : '')
const late = n => n > 0 ? `<span class="late">${n} ${n === 1 ? 'day' : 'days'}</span>` : DASH

const RB = {
  daily(p, sc) {
    const accs = accsIn(sc)
    if (p.from === p.to) {
      const rows = accs.map(a => ({ f: flows(a.code, p), a })).filter(x => x.f.open || x.f.dr || x.f.cr).map(({ a, f }) => ({ c: { code: a.code, name: one(esc(a.name + (sc === 'ALL' ? ' · ' + a.loc : ''))), open: num(f.open), dr: m(f.dr), cr: m(f.cr), close: num(f.close) } }))
      const t = accs.reduce((s, a) => { const f = flows(a.code, p); return { o: s.o + f.open, d: s.d + f.dr, c: s.c + f.cr, x: s.x + f.close } }, { o: 0, d: 0, c: 0, x: 0 })
      return { kpis: [kpi('Opening', money(t.o)), kpi('Money in', money(t.d)), kpi('Money out', money(t.c)), kpi('Closing', money(t.x))], html: T(ACC_COLS, rows, { name: 'Total', open: num(t.o), dr: num(t.d), cr: num(t.c), close: num(t.x) }) }
    }
    const by = {}; accs.forEach(a => entriesIn(a.code, p).forEach(e => { const x = by[e.date] = by[e.date] || { dr: 0, cr: 0 }; x.dr += e.dr; x.cr += e.cr }))
    let run = accs.reduce((s, a) => s + flows(a.code, p).open, 0); const open0 = run, rows = []; let td = 0, tc = 0
    rangeD(p.from, p.to).forEach(d => { const x = by[d] || { dr: 0, cr: 0 }, o = run; run += x.dr - x.cr; td += x.dr; tc += x.cr; rows.push({ c: { d: dayCell(d), open: num(o), dr: m(x.dr), cr: m(x.cr), close: num(run) } }) })
    return { kpis: [kpi('Opening', money(open0)), kpi('Money in', money(td)), kpi('Money out', money(tc)), kpi('Closing', money(run))], html: T([{ l: 'Date', k: 'd', w: 90 }, { l: 'Opening', k: 'open', num: 1 }, { l: 'Debit', k: 'dr', num: 1 }, { l: 'Credit', k: 'cr', num: 1 }, { l: 'Closing', k: 'close', num: 1 }], rows, { d: 'Total', dr: num(td), cr: num(tc) }) }
  },
  per(p, sc) {
    const accs = accsIn(sc), { rows, tot } = accRows(accs, p, sc === 'ALL')
    return { kpis: [kpi('Opening', money(tot.open)), kpi('Money in', money(tot.dr)), kpi('Money out', money(tot.cr)), kpi('Closing', money(tot.close))], html: T(ACC_COLS, rows, { name: 'Total', open: num(tot.open), dr: num(tot.dr), cr: num(tot.cr), close: num(tot.close) }) }
  },
  byVoucher(p, sc) {
    const accs = accsIn(sc).filter(a => a.grp === 'Bank'), acc = accs[0] ? accs[0].code : BCA, { rows, f } = ledgerRows(acc, p)
    return { kpis: [kpi(an(acc), acc), kpi('Debit', money(f.dr)), kpi('Credit', money(f.cr)), kpi('Closing', money(f.close))], html: T(LEDGER_COLS, rows) }
  },
  everyLine(p, sc) {
    const vs = vIn(p, sc).filter(v => v.deposit !== true)
    const rows = []; vs.forEach(v => v.jr.forEach(r => rows.push({ c: { d: dayCell(v.date), no: esc(v.no), a: one(esc(`${r.acc} · ${an(r.acc)}`)), dr: m(r.dr), cr: m(r.cr) } })))
    return { kpis: [kpi('Vouchers', String(vs.length)), kpi('Lines', String(rows.length)), kpi('Debit', money(rows.length ? vs.reduce((a, v) => a + sumL(v.jr, 'dr'), 0) : 0)), kpi('Credit', money(vs.reduce((a, v) => a + sumL(v.jr, 'cr'), 0)))], html: T([{ l: 'Date', k: 'd', w: 90 }, { l: 'Voucher', k: 'no', w: 190 }, { l: 'Account', k: 'a' }, { l: 'Debit', k: 'dr', num: 1, w: 130 }, { l: 'Credit', k: 'cr', num: 1, w: 130 }], rows) }
  },
  settleS(p, sc, type) {
    const vs = vIn(p, sc, v => v.type === type && v.lines.some(l => l.t === 's')), cash = v => sumL(v.lines.filter(l => l.t === 's'), 'pay')
    const rows = vs.map(v => ({ on: `openVoucher('${v.no}')`, c: { d: dayCell(v.date), no: esc(v.no), who: pty(v), cash: num(cash(v)), note: one(esc(v.note)) } }))
    const tot = vs.reduce((a, v) => a + cash(v), 0)
    return { kpis: [kpi('Vouchers', String(vs.length)), kpi(type === 'BKK' ? 'Paid in cash' : 'Received in cash', money(tot))], html: T([{ l: 'Date', k: 'd', w: 90 }, { l: 'Voucher', k: 'no', w: 190 }, { l: type === 'BKK' ? 'Supplier' : 'Customer / bank', k: 'who' }, { l: type === 'BKK' ? 'Paid' : 'Received', k: 'cash', num: 1, w: 140 }, { l: 'Note', k: 'note', w: 260 }], rows, { no: 'Total', cash: num(tot) }) }
  },
  settleD(p, sc, type) {
    const vs = vIn(p, sc, v => v.type === type), rows = []; let st = 0, ds = 0, pa = 0
    vs.forEach(v => v.lines.filter(l => l.t === 's').forEach(l => { st += l.pay + l.pot; ds += l.pot; pa += l.pay; rows.push({ on: `openVoucher('${v.no}')`, c: { d: dayCell(v.date), no: esc(v.no), who: pty(v), doc: esc(l.doc), set: num(l.pay + l.pot), po: m(l.pot), pa: num(l.pay) } }) }))
    return { kpis: [kpi('Settled', money(st)), kpi('Discount', money(ds)), kpi(type === 'BKK' ? 'Paid in cash' : 'Received in cash', money(pa))], html: T([{ l: 'Date', k: 'd', w: 90 }, { l: 'Voucher', k: 'no', w: 190 }, { l: type === 'BKK' ? 'Supplier' : 'Customer / bank', k: 'who' }, { l: 'Invoice', k: 'doc', w: 190 }, { l: 'Settled', k: 'set', num: 1, w: 130 }, { l: 'Discount', k: 'po', num: 1, w: 110 }, { l: type === 'BKK' ? 'Paid' : 'Received', k: 'pa', num: 1, w: 130 }], rows, { doc: 'Total', set: num(st), po: num(ds), pa: num(pa) }) }
  },
  otherS(p, sc, type) {
    const vs = vIn(p, sc, v => v.type === type && v.lines.some(l => l.t === 'o')), tot = v => sumL(v.lines.filter(l => l.t === 'o'), 'amt')
    const rows = vs.map(v => ({ on: `openVoucher('${v.no}')`, c: { d: dayCell(v.date), no: esc(v.no), who: pty(v), tot: num(tot(v)), note: one(esc(v.note)) } }))
    const all = vs.reduce((a, v) => a + tot(v), 0)
    return { kpis: [kpi('Vouchers', String(vs.length)), kpi(type === 'BKM' ? 'Other income' : 'Other expenses', money(all))], html: T([{ l: 'Date', k: 'd', w: 90 }, { l: 'Voucher', k: 'no', w: 190 }, { l: type === 'BKK' ? 'Paid to' : 'Received from', k: 'who' }, { l: 'Total', k: 'tot', num: 1, w: 140 }, { l: 'Note', k: 'note', w: 260 }], rows, { no: 'Total', tot: num(all) }) }
  },
  otherD(p, sc, type) {
    const vs = vIn(p, sc, v => v.type === type), rows = []; let all = 0
    vs.forEach(v => v.lines.filter(l => l.t === 'o').forEach(l => { all += l.amt; rows.push({ on: `openVoucher('${v.no}')`, c: { d: dayCell(v.date), no: esc(v.no), who: pty(v), a: one(esc(`${l.acc} · ${an(l.acc)}`)), f: one(esc(l.desc)), amt: num(l.amt) } }) }))
    return { kpis: [kpi('Lines', String(rows.length)), kpi(type === 'BKM' ? 'Other income' : 'Other expenses', money(all))], html: T([{ l: 'Date', k: 'd', w: 90 }, { l: 'Voucher', k: 'no', w: 190 }, { l: type === 'BKK' ? 'Paid to' : 'Received from', k: 'who', w: 200 }, { l: 'Account', k: 'a', w: 280 }, { l: 'For', k: 'f' }, { l: 'Amount', k: 'amt', num: 1, w: 130 }], rows, { f: 'Total', amt: num(all) }) }
  },
  gOut(p, sc) {
    const vs = vIn(p, sc, v => v.giro), tot = sumL(vs, 'total')
    const rows = vs.map(v => ({ on: `openVoucher('${v.no}')`, c: { no: esc(v.giro.no), who: pty(v), made: dayCell(v.date), due: dayCell(v.giro.due), on: v.giro.on ? dayCell(v.giro.on) : DASH, amt: num(v.total), st: stCell(giroState(v)) } }))
    return { kpis: [kpi('Giro', String(vs.length)), kpi('Total', money(tot)), kpi('Not cleared', String(vs.filter(v => v.giro.state === 'New').length))], html: T([{ l: 'Giro no', k: 'no', w: 150 }, { l: 'Supplier', k: 'who' }, { l: 'Created', k: 'made', w: 90 }, { l: 'Due', k: 'due', w: 90 }, { l: 'Cleared / bounced', k: 'on', w: 150 }, { l: 'Amount', k: 'amt', num: 1, w: 130 }, { l: 'Status', k: 'st', w: 120 }], rows, { who: 'Total', amt: num(tot) }) }
  },
  gOutOpen() {
    const vs = VOUCHERS.filter(v => v.giro && v.giro.state === 'New'), by = {}
    vs.forEach(v => (by[v.party.name] = by[v.party.name] || []).push(v))
    const rows = []
    Object.keys(by).sort().forEach(n => {
      rows.push({ group: `${esc(n)} · ${money(sumL(by[n], 'total'))}` })
      by[n].sort((a, b) => a.giro.due.localeCompare(b.giro.due)).forEach(v => rows.push({ on: `openVoucher('${v.no}')`, c: { no: esc(v.giro.no), bkk: esc(v.no), made: dayCell(v.date), due: dayCell(v.giro.due), late: late(gap(TODAY, v.giro.due)), bank: one(esc(an(v.giro.bank))), amt: num(v.total) } }))
    })
    const lt = vs.filter(v => v.giro.due < TODAY)
    return { kpis: [kpi('Giro out', String(vs.length)), kpi('Not yet cleared', money(sumL(vs, 'total'))), kpi('Overdue', `${lt.length} · ${money(sumL(lt, 'total'))}`, lt.length > 0)], html: T([{ l: 'Giro no', k: 'no', w: 150 }, { l: 'BKK', k: 'bkk', w: 190 }, { l: 'Created', k: 'made', w: 90 }, { l: 'Due', k: 'due', w: 90 }, { l: 'Overdue', k: 'late', w: 100 }, { l: 'Paying bank', k: 'bank' }, { l: 'Amount', k: 'amt', num: 1, w: 130 }], rows, { bank: 'Total', amt: num(sumL(vs, 'total')) }) }
  },
  gOutBad(p, sc) {
    const vs = VOUCHERS.filter(v => v.giro && v.giro.state === 'Bounced')
    const rows = vs.map(v => ({ on: `openVoucher('${v.no}')`, c: { no: esc(v.giro.no), who: pty(v), on: dayCell(v.giro.on), amt: num(v.total), repl: v.repl ? esc(v.repl) : `<span class="late">Not replaced</span>`, st: v.repl ? stCell('Cleared') : stCell('Overdue') } }))
    rows.forEach((r, i) => { if (vs[i].repl) r.c.st = pill('Replaced', 'ok'); else r.c.st = pill('Open', 'bad') })
    return { kpis: [kpi('Bounced giro', String(vs.length)), kpi('Amount', money(sumL(vs, 'total'))), kpi('Not replaced', String(vs.filter(v => !v.repl).length), vs.some(v => !v.repl))], html: T([{ l: 'Giro no', k: 'no', w: 150 }, { l: 'Supplier', k: 'who' }, { l: 'Bounced on', k: 'on', w: 110 }, { l: 'Amount', k: 'amt', num: 1, w: 130 }, { l: 'Replaced by', k: 'repl', w: 190 }, { l: 'Status', k: 'st', w: 110 }], rows, null, 'No giro has bounced') }
  },
  gIn(p) {
    const xs = GIN.filter(g => g.made >= p.from && g.made <= p.to || true)
    const rows = xs.map(g => ({ c: { bkm: esc(g.bkm), no: esc(g.no), who: one(esc(g.who)), made: dayCell(g.made), due: dayCell(g.due), bank: one(esc(g.bank)), amt: num(g.amt), st: stCell(gInState(g)) } }))
    return { kpis: [kpi('Giro in', String(xs.length)), kpi('Total', money(sumL(xs, 'amt'))), kpi('Not cleared', String(xs.filter(g => g.state === 'New').length))], html: T([{ l: 'BKM', k: 'bkm', w: 170 }, { l: 'Giro no', k: 'no', w: 150 }, { l: 'Customer', k: 'who' }, { l: 'Created', k: 'made', w: 90 }, { l: 'Due', k: 'due', w: 90 }, { l: 'Bank', k: 'bank', w: 130 }, { l: 'Amount', k: 'amt', num: 1, w: 130 }, { l: 'Status', k: 'st', w: 120 }], rows, { who: 'Total', amt: num(sumL(xs, 'amt')) }) }
  },
  gInOpen() {
    const xs = GIN.filter(g => g.state === 'New' || g.state === 'Bounced'), by = {}
    xs.forEach(g => (by[g.who] = by[g.who] || []).push(g))
    const rows = []
    Object.keys(by).sort().forEach(n => { rows.push({ group: `${esc(n)} · ${money(sumL(by[n], 'amt'))}` }); by[n].forEach(g => rows.push({ c: { bkm: esc(g.bkm), no: esc(g.no), made: dayCell(g.made), due: dayCell(g.due), late: late(g.state === 'New' ? gap(TODAY, g.due) : 0), bank: one(esc(g.bank)), amt: num(g.amt) } })) })
    const lt = xs.filter(g => g.state === 'New' && g.due < TODAY)
    return { kpis: [kpi('Giro in', String(xs.length)), kpi('Not yet cleared', money(sumL(xs, 'amt'))), kpi('Overdue', `${lt.length} · ${money(sumL(lt, 'amt'))}`, lt.length > 0)], html: T([{ l: 'BKM', k: 'bkm', w: 170 }, { l: 'Giro no', k: 'no', w: 150 }, { l: 'Created', k: 'made', w: 90 }, { l: 'Due', k: 'due', w: 90 }, { l: 'Overdue', k: 'late', w: 100 }, { l: 'Bank', k: 'bank' }, { l: 'Amount', k: 'amt', num: 1, w: 130 }], rows, { bank: 'Total', amt: num(sumL(xs, 'amt')) }) }
  },
  gInBad() {
    const xs = GIN.filter(g => g.state === 'Bounced')
    const rows = xs.map(g => ({ c: { no: esc(g.no), who: one(esc(g.who)), on: dayCell(g.on), amt: num(g.amt), repl: g.repl ? esc(g.repl) : DASH, st: pill(g.repl ? 'Replaced' : 'Open', g.repl ? 'ok' : 'bad') } }))
    return { kpis: [kpi('Bounced giro', String(xs.length)), kpi('Amount', money(sumL(xs, 'amt')))], html: T([{ l: 'Giro no', k: 'no', w: 150 }, { l: 'Customer', k: 'who' }, { l: 'Bounced on', k: 'on', w: 110 }, { l: 'Amount', k: 'amt', num: 1, w: 130 }, { l: 'Replaced by', k: 'repl', w: 190 }, { l: 'Status', k: 'st', w: 110 }], rows) }
  },
}
const BUILD = {
  daily: RB.daily, dailyv: RB.byVoucher, dailyl: RB.everyLine, perl: RB.everyLine, per: RB.per, perv: RB.byVoucher,
  arS: (p, s) => RB.settleS(p, s, 'BKM'), arD: (p, s) => RB.settleD(p, s, 'BKM'), apS: (p, s) => RB.settleS(p, s, 'BKK'), apD: (p, s) => RB.settleD(p, s, 'BKK'),
  inS: (p, s) => RB.otherS(p, s, 'BKM'), inD: (p, s) => RB.otherD(p, s, 'BKM'), outS: (p, s) => RB.otherS(p, s, 'BKK'), outD: (p, s) => RB.otherD(p, s, 'BKK'),
  gIn: RB.gIn, gOut: RB.gOut, gInOpen: RB.gInOpen, gOutOpen: RB.gOutOpen, gInBad: RB.gInBad, gOutBad: RB.gOutBad,
}

function reportPeriod() {
  const f = S.f[RID] || {}
  if (f.per === 'custom') {
    let from = f.from || PER.oct.from, to = f.to || PER.oct.to
    if (from > to) { const t = from; from = to; to = t }
    return { from, to, label: 'Custom range', short: 'Custom' }
  }
  return PER[f.per || 'oct'] || PER.oct
}
window.setReportRange = (k, v) => { const f = S.f[RID] = S.f[RID] || {}; f[k] = v; f.per = 'custom'; render() }
window.resetReportPeriod = () => { S.f[RID] = { rep: filt(RID, 'rep', 'apD'), per: 'oct' }; render() }
window.refreshReport = () => { toast('Refreshed', 'The report was read again'); render() }

reg({
  id: RID, group: 'cash', label: 'Cash & bank reports',
  render() {
    const rep = filt(RID, 'rep', 'apD'), sc = filt(RID, 'sc', 'HO'), p = reportPeriod(), asOf = AS_OF.has(rep)
    const r = BUILD[rep](p, sc)
    const picker = REPORTS.map(([g, xs]) => `<span class="nav-label" style="margin-left:0">${g}</span><div class="ds-nav" style="margin-bottom:4px">${xs.map(([k, l]) => `<button class="nav-row-btn ${k === rep ? 'on' : ''}" type="button" style="height:auto;min-height:34px;padding:6px 10px;line-height:1.3" onclick="setFilt('${RID}','rep','${k}')"><span>${l}</span></button>`).join('')}</div>`).join('')
    const locs = [['ALL', 'All locations'], ...LC.map(l => [l, l === 'HO' ? 'Head office' : `${l} · ${SHOP[l]}`])]
    const acctOpts = [['', 'All accounts'], ...ACCTS.map(a => [a.code, `${a.code} · ${a.name} ${a.loc}`])]
    const ctl = bar(asOf ? '' : seg(chips(RID, 'per', [['sep', 'September'], ['oct', 'October'], ['day', 'Today'], ['custom', 'Custom']], 'oct')), asOf ? '' : `<label class="ctl-l">From <input type="date" class="ctl" value="${p.from}" onchange="setReportRange('from',this.value)"></label><label class="ctl-l">Sampai tanggal <input type="date" class="ctl" value="${p.to}" onchange="setReportRange('to',this.value)"></label><button class="chip" type="button" onclick="refreshReport()">Refresh</button><button class="chip" type="button" onclick="resetReportPeriod()">Reset</button>`, /^g/.test(rep) ? '' : sel(RID, 'sc', locs, sc, 'Location'), /^g/.test(rep) ? '' : sel(RID, 'acct', acctOpts, filt(RID, 'acct', ''), 'Account'))
    const scName = /^g/.test(rep) ? 'All banks' : sc === 'ALL' ? 'All locations' : sc === 'HO' ? 'Head office' : `${sc} · ${SHOP[sc]}`
    const paper = `<div class="sec-head" style="margin-bottom:12px"><h3 class="ds-section-title">${RNAME[rep]}</h3><span class="mute">${asOf ? 'As of ' + day(TODAY) : perText(p)} · ${scName}</span></div>${r.html}`
    const body = `<div style="display:grid;grid-template-columns:260px minmax(0,1fr);gap:28px;align-items:start"><div>${picker}</div><div style="min-width:0">${ctl}${paper}</div></div>`
    return page({ title: 'Cash & bank reports', actions: [{ label: 'Print', icon: 'printer', on: `printPage('Cash & bank reports')` }, { label: 'Export', icon: 'download', on: `nativeExport('cash-bank-report')` }], kpis: r.kpis, body })
  },
})

/* ═════════ 3 · Shop cash ═════════ */
const SID = 'store-cash'
window.openShop = loc => { S.tab[SID] = 'deposit'; setFilt(SID, 'shop', loc) }
const LATE_DAYS = 3
function shopStat(loc) {
  const mm = SHM[loc], unb = mm ? mm.days.filter(d => !d.dep) : []
  const since = unb.length ? unb[0].date : ''
  return {
    loc, cash: bal(a12(CASH, loc)), petty: bal(a12(PETTY, loc)), flt: bal(a12(FLOAT, loc)), since, age: since ? gap(TODAY, since) : 0, wait: unb.reduce((a, d) => a + d.amt, 0),
    cc: mm ? mm.cc : '2026-10-26', pc: mm ? mm.pc : '2026-10-19', fc: mm ? mm.fc : '2026-10-26',
  }
}
const badShop = s => s.age >= LATE_DAYS || s.petty < 0 || (s.fc && gap(TODAY, s.fc) > 7)
const lateCls = c => c ? 'late' : ''
function shopList() {
  const q = S.q[SID] || '', all = LC.map(shopStat), flag = filt(SID, 'f', 'all')
  const stats = all.filter(s => hit(q, s.loc, SHOP[s.loc]) && (flag === 'all' || badShop(s)))
  const rows = stats.map(s => ({ on: `openShop('${s.loc}')`, c: {
    shop: one(`${s.loc} · ${esc(SHOP[s.loc])}`), cash: num(s.cash), since: s.since ? `<span class="${lateCls(s.age >= LATE_DAYS)}">${s.age} ${s.age === 1 ? 'day' : 'days'}</span>` : DASH, cc: dayCell(s.cc),
    petty: `<span class="${lateCls(s.petty < 0)}">${num(s.petty)}</span>`, pc: dayCell(s.pc), flt: num(s.flt), fc: `<span class="${lateCls(s.fc && gap(TODAY, s.fc) > 7)}">${s.fc ? dayS(s.fc) : '—'}</span>`,
  } }))
  const sum = k => stats.reduce((a, s) => a + s[k], 0), shops = all.filter(s => s.loc !== 'HO'), lateN = shops.filter(s => s.age >= LATE_DAYS).length
  const k = [kpi('Cash in shops', money(shops.reduce((a, s) => a + s.cash, 0))), kpi('Late to bank', `${lateN} ${lateN === 1 ? 'shop' : 'shops'}`, lateN > 0), kpi('Petty cash', money(all.reduce((a, s) => a + s.petty, 0)), all.some(s => s.petty < 0)), kpi('Cashier float', money(all.reduce((a, s) => a + s.flt, 0)))]
  const body = bar(search(SID, 'Search shop'), chips(SID, 'f', [['all', 'All shops', all.length], ['bad', 'Needs a look', all.filter(badShop).length]], 'all')) +
    scroll(table({
      cols: [{ l: 'Shop', k: 'shop' }, { l: 'Cash on hand', k: 'cash', num: 1, w: 130 }, { l: 'Not banked for', k: 'since', w: 130 }, { l: 'Counted', k: 'cc', w: 90 }, { l: 'Petty cash', k: 'petty', num: 1, w: 120 }, { l: 'Counted', k: 'pc', w: 90 }, { l: 'Cashier float', k: 'flt', num: 1, w: 120 }, { l: 'Counted', k: 'fc', w: 90 }],
      rows, empty: 'No shop matches', foot: rows.length ? { shop: 'Total', cash: num(sum('cash')), petty: num(sum('petty')), flt: num(sum('flt')) } : null,
    }))
  return page({ title: 'Shop cash', kpis: k, body })
}

const dayName = d => `${WD[wd(d)]} ${dayS(d)}`
function shopDeposit(loc, p) {
  const mm = SHM[loc], from = p.from, to = p.to < TODAY ? p.to : '2026-10-26'
  if (!mm) { // head office keeps no takings: its cash box is a plain ledger
    const { rows, f } = ledgerRows(a12(CASH), p)
    return { f, html: table({ cols: LEDGER_COLS, rows, foot: { party: 'Total', dr: num(f.dr), cr: num(f.cr), bal: num(f.close) } }) }
  }
  const ds = mm.days.filter(d => d.date >= from && d.date <= to).reverse()
  const rows = ds.map(d => {
    const left = d.dep ? 0 : d.amt, old = left && gap(TODAY, d.date) >= LATE_DAYS
    return { on: d.dep ? `openVoucher('${d.dep.no}',['Shop cash','${loc}'])` : '', c: { d: dayName(d.date), tk: num(d.amt), bk: d.dep ? num(d.amt - d.short) : DASH, sh: d.short ? `<span class="late">${num(d.short)}</span>` : DASH, left: left ? `<span class="${lateCls(old)}">${num(left)}</span>` : DASH, on: d.dep ? dayCell(d.dep.date) : DASH } }
  })
  const t = ds.reduce((a, d) => ({ tk: a.tk + d.amt, bk: a.bk + (d.dep ? d.amt - d.short : 0), sh: a.sh + d.short, left: a.left + (d.dep ? 0 : d.amt) }), { tk: 0, bk: 0, sh: 0, left: 0 })
  return { html: table({ cols: [{ l: 'Day', k: 'd' }, { l: 'Taken in cash', k: 'tk', num: 1, w: 140 }, { l: 'Banked', k: 'bk', num: 1, w: 140 }, { l: 'Short at count', k: 'sh', num: 1, w: 140 }, { l: 'Left in shop', k: 'left', num: 1, w: 140 }, { l: 'Banked on', k: 'on', w: 110 }], rows, foot: { d: 'Total', tk: num(t.tk), bk: num(t.bk), sh: m(t.sh), left: m(t.left) } }) }
}
function shopPetty(loc, p) {
  const acc = a12(PETTY, loc), f = flows(acc, p); let run = f.open
  const rows = [{ cls: 'opening', c: { what: 'Opening balance', left: num(f.open) } }]
  entriesIn(acc, p).forEach(e => {
    run += e.dr - e.cr
    rows.push({ on: `openVoucher('${e.no}',['Shop cash','${loc}'])`, c: { d: dayCell(e.date), what: one(esc(e.cr ? e.v.lines[0].desc + (e.v.party.name ? ' · ' + e.v.party.name : '') : 'Top-up from head office')), no: esc(e.no), sp: m(e.cr), tp: m(e.dr), left: `<span class="${lateCls(run < 0)}">${num(run)}</span>` } })
  })
  return { f, html: table({ cols: [{ l: 'Date', k: 'd', w: 84 }, { l: 'What for', k: 'what' }, { l: 'Voucher', k: 'no', w: 190 }, { l: 'Spent', k: 'sp', num: 1, w: 120 }, { l: 'Topped up', k: 'tp', num: 1, w: 120 }, { l: 'Left', k: 'left', num: 1, w: 130 }], rows, foot: { what: 'Total', sp: num(f.cr), tp: m(f.dr), left: num(f.close) } }) }
}
function shopFloat(loc, p) {
  const mm = SHM[loc], fl = mm ? mm.fl : [], base = bal(a12(FLOAT, loc))
  const xs = (fl.length ? fl : rangeD(p.from, p.to).filter(d => wd(d) === 1 && d <= TODAY).map(d => ({ date: d, should: base, counted: base }))).filter(c => c.date >= p.from && c.date <= p.to).reverse()
  const rows = xs.map(c => ({ c: { d: dayName(c.date), sh: num(c.should), ct: num(c.counted), df: c.counted === c.should ? DASH : `<span class="late">${(c.counted > c.should ? '+' : '') + num(c.counted - c.should)}</span>` } }))
  return { html: table({ cols: [{ l: 'Counted on', k: 'd' }, { l: 'Should be', k: 'sh', num: 1, w: 150 }, { l: 'Counted', k: 'ct', num: 1, w: 150 }, { l: 'Difference', k: 'df', num: 1, w: 150 }], rows, empty: 'No float count in this period' }) }
}

reg({
  id: SID, group: 'cash', label: 'Shop cash',
  render() {
    const loc = filt(SID, 'shop', '')
    if (!loc) return shopList()
    const tab = tabOf(SID, 'deposit'), p = PER[filt(SID, 'per', 'oct')] || PER.oct, s = shopStat(loc)
    const r = tab === 'petty' ? shopPetty(loc, p) : tab === 'count' ? shopFloat(loc, p) : shopDeposit(loc, p)
    const bad = s.age >= LATE_DAYS
    const k = [kpi('Cash on hand', money(s.cash)), kpi('Not banked for', s.since ? `${s.age} ${s.age === 1 ? 'day' : 'days'}` : '—', bad), kpi('Petty cash', money(s.petty), s.petty < 0), kpi('Cashier float', money(s.flt))]
    const title = `<span class="ds-link" style="cursor:pointer" onclick="setFilt('${SID}','shop','')">Shop cash</span> <span class="mute">/</span> ${loc} · ${esc(SHOP[loc])}`
    const body = bar(seg(chips(SID, 'per', [['sep', 'September'], ['oct', 'October']], 'oct'))) + r.html
    return page({ title, tabs: [['deposit', 'Deposit'], ['petty', 'Top up'], ['count', 'Count']], tab, kpis: k, body })
  },
})

})()
