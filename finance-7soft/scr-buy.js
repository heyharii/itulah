(() => {
'use strict'
/* ═════════ Purchasing: purchase invoice · return · supplier hub · payables reports ═════════ */

/* ── helpers ── */
const A = { stock: '1011201001', vat: '1011302004', ap: '2012001001', susp: '2012001002', um: '1011303002', disc: '8010110003' }
const TERM_DAYS = { T7: 7, T14: 14, T30: 30, T45: 45, CASH: 0 }
const ms = iso => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10))
const addD = (iso, n) => new Date(ms(iso) + n * 864e5).toISOString().slice(0, 10)
const diffD = (a, b) => Math.round((ms(a) - ms(b)) / 864e5)
const sum = (xs, f = x => x) => xs.reduce((a, x) => a + f(x), 0)
const clean = s => String(s).replace(/\s+/g, ' ').trim()
const supOf = c => SUPPLIERS.find(s => s.code === c)
const shortName = c => supOf(c).name.replace(/,.*$/, '')
const pn = v => { const n = parseFloat(String(v).replace(/\./g, '').replace(',', '.')); return isFinite(n) ? n : 0 }
const mk = a => ({ item: a[0], q: a[1], u: a[2], p: a[3], d: a[4] || '', note: a[5] || '', dr: a[6] || 0 })
const TYPE_L = { M: 'Matching PO', S: 'Standard', U: 'Down payment' }
const PPN_OF = { 'S-0208': 0 }

try {
  document.head.insertAdjacentHTML('beforeend', `<style id="buy-css">
.cin{width:100%;height:36px;padding:0 10px;border:1px solid var(--hairline-2);border-radius:var(--r-inner);background:var(--canvas);font:inherit;color:var(--ink);font-variant-numeric:tabular-nums}
.cin.r{text-align:right}
.cin:focus{outline:0;border-color:var(--accent);box-shadow:var(--shadow-focus)}
.cin[readonly],.cin:disabled{background:transparent;border-color:transparent;opacity:1;-webkit-text-fill-color:var(--ink)}
.ib{display:inline-grid;place-items:center;width:32px;height:32px;border:0;border-radius:var(--r-inner);background:none;color:var(--ink)}
@media (hover:hover){.ib:hover{background:var(--soft-2)}}
.foot-row{display:flex;align-items:flex-start;justify-content:space-between;gap:24px;margin:20px 0 28px}
.foot-row .ds-kpis{margin-bottom:0}
.dsc{display:flex;gap:8px}.dsc input{flex:1;min-width:0}.dsc select{width:84px}
.ctl{height:36px;padding:0 12px;border:1px solid var(--hairline-2);border-radius:var(--r-inner);background:var(--canvas);font:inherit;color:var(--ink)}
.ctl:focus{outline:0;border-color:var(--accent);box-shadow:var(--shadow-focus)}
.ctl-l{display:inline-flex;align-items:center;gap:8px;color:var(--body)}
.rec{color:var(--accent);cursor:pointer;background:none;border:0;padding:0;font:inherit;font-weight:500}
.rp-wrap{display:grid;grid-template-columns:210px minmax(0,1fr);gap:28px;align-items:start}
.rp-pick{display:flex;flex-direction:column;gap:2px}
.rp-pick .nav-label{margin:14px 0 4px 0;align-self:flex-start}
.rp-pick .nav-label:first-child{margin-top:0}
.rp-scroll .ds-table-card{overflow-x:auto}
.rp-scroll .ds-table{min-width:var(--mw,720px)}
.ind{padding-left:24px;color:var(--body)}
.sheet-gap{margin-bottom:24px}
</style>`)
} catch (e) { /* headless */ }

/* ═════════ engine ═════════ */
const discF = s => String(s || '').split('+').map(parseFloat).filter(isFinite).reduce((a, d) => a * (1 - d / 100), 1)
const lineAmt = l => Math.max(0, Math.round(l.q * l.p * discF(l.d)) - (l.dr || 0))
function calc(lines, dm, dv, ppn) {
  const sub = sum(lines, lineAmt), v = Number(dv) || 0
  const disc = dm === '%' ? Math.round(sub * v / 100) : Math.min(Math.round(v), sub)
  const net = sub - disc, tax = Math.round(net * ppn / 100)
  return { sub, disc, net, tax, grand: net + tax, qty: sum(lines, l => l.q) }
}
function retCalc(src, qty) {
  const lines = src.lines.map((l, i) => ({ ...l, q: qty[i] || 0 }))
  const full = calc(src.lines, src.dm, src.dv, src.ppn)
  const dv = src.dm === '%' ? src.dv : (full.sub ? src.dv * sum(lines, lineAmt) / full.sub : 0)
  return { ...calc(lines, src.dm, dv, src.ppn), lines }
}

/* ═════════ demo data ═════════ */
const FREIGHT = ['Freight & handling', 'trip', 0]
const CAT = {
  'S-0102': [['Kemeja flanel kotak', 'pcs', 78000], ['Kaos polos basic', 'pcs', 28000], ['Celana chino slim', 'pcs', 92000], ['Jaket denim', 'pcs', 185000], ['Celana jeans', 'pcs', 128000]],
  'S-0045': [['Earphone bluetooth', 'pcs', 95000], ['Powerbank 10.000 mAh', 'pcs', 135000], ['Flashdisk 32 GB', 'pcs', 48000], ['Charger fast 20W', 'pcs', 62000]],
  'S-0131': [['Kain batik cap', 'meter', 42000], ['Kain katun combed', 'meter', 28000], ['Sarung tenun', 'pcs', 85000]],
  'S-0208': [['Deterjen cair 800 ml', 'box', 138000], ['Pewangi pakaian 1 L', 'box', 164000], ['Lap microfiber', 'pack', 36000]],
  'S-0077': [['Sneakers pria', 'pairs', 165000], ['Sandal jepit', 'pairs', 38000], ['Sepatu formal wanita', 'pairs', 210000], ['Kaos kaki', 'dozen', 54000]],
}
Object.values(CAT).forEach(c => c.push(FREIGHT))

const INV = []
const I = (no, date, sup, type, o) => INV.push({ kind: type === 'U' ? 'um' : 'inv', no, date, sup, type, po: '', grn: '', ref: '', wh: 'HO', dm: '%', dv: 0, ppn: PPN_OF[sup] ?? 11, um: [], ...o, term: o.term || supOf(sup).term, lines: o.lines.map(mk) })
const UMLINE = amt => [['Down payment', 1, '—', amt]]

/* Garmen Mitra Sentosa */
I('BLI-26-08-00031', '2026-08-22', 'S-0102', 'M', { po: 'PO-0102-0812', grn: 'GRN-HO-GUDANG-000118', ref: 'GMS/0822/0114', lines: [['Kemeja flanel kotak', 200, 'pcs', 78000, '10'], ['Kaos polos basic', 400, 'pcs', 28000]] })
I('BLI-26-09-00004', '2026-09-03', 'S-0102', 'M', { po: 'PO-0102-0902', grn: 'GRN-HO-GUDANG-000131', ref: 'GMS/0903/0127', lines: [['Celana chino slim', 220, 'pcs', 92000, '5+3'], ['Jaket denim', 90, 'pcs', 185000]] })
I('BLI-26-09-00019', '2026-09-19', 'S-0102', 'S', { ref: 'GMS/0919/0151', lines: [['Kaos polos basic', 250, 'pcs', 28000]] })
I('BLI-26-10-00005', '2026-10-08', 'S-0102', 'U', { po: 'PO-0102-1012', ref: 'GMS/UM/1008', ppn: 0, lines: UMLINE(20000000) })
I('BLI-26-10-00011', '2026-10-15', 'S-0102', 'M', { po: 'PO-0102-1012', grn: 'GRN-HO-GUDANG-000152', ref: 'GMS/1015/0188', um: [{ no: 'BLI-26-10-00005', amt: 12000000 }], lines: [['Celana jeans', 150, 'pcs', 128000, '8'], ['Kemeja flanel kotak', 100, 'pcs', 78000]] })
I('BLI-26-10-00018', '2026-10-23', 'S-0102', 'M', { po: 'PO-0102-1020', grn: 'GRN-HO-GUDANG-000158', ref: 'GMS/1023/0204', lines: [['Kaos polos basic', 300, 'pcs', 28000, '5'], ['Jaket denim', 8, 'pcs', 185000], ['Freight & handling', 1, 'trip', 159139]] })
/* Sumber Komputer */
I('BLI-26-09-00009', '2026-09-09', 'S-0045', 'S', { ref: 'SK-2209-0731', lines: [['Earphone bluetooth', 40, 'pcs', 95000]] })
I('BLI-26-10-00002', '2026-10-02', 'S-0045', 'S', { ref: 'SK-2210-0802', lines: [['Powerbank 10.000 mAh', 30, 'pcs', 135000, '5'], ['Flashdisk 32 GB', 50, 'pcs', 48000]] })
I('BLI-26-10-00014', '2026-10-20', 'S-0045', 'M', { po: 'PO-0045-1018', ref: 'SK-2210-0866', lines: [['Charger fast 20W', 60, 'pcs', 62000], ['Freight & handling', 1, 'trip', 279527]] })
/* CV Anugrah Textile */
I('BLI-26-08-00028', '2026-08-28', 'S-0131', 'S', { ref: 'AT/0828/311', lines: [['Kain batik cap', 200, 'meter', 42000, '5']] })
I('BLI-26-09-00012', '2026-09-12', 'S-0131', 'M', { po: 'PO-0131-0910', ref: 'AT/0912/327', lines: [['Sarung tenun', 100, 'pcs', 85000]] })
I('BLI-26-09-00026', '2026-09-26', 'S-0131', 'S', { ref: 'AT/0926/338', lines: [['Kain katun combed', 150, 'meter', 28000]] })
I('BLI-26-10-00008', '2026-10-10', 'S-0131', 'S', { ref: 'AT/1010/352', lines: [['Kain katun combed', 90, 'meter', 28000], ['Freight & handling', 1, 'trip', 196216]] })
/* PT Graha Clean (not PKP: no PPN) */
I('BLI-26-09-00015', '2026-09-15', 'S-0208', 'S', { ref: 'GC-0915-22', lines: [['Pewangi pakaian 1 L', 10, 'box', 164000]] })
I('BLI-26-10-00004', '2026-10-06', 'S-0208', 'S', { ref: 'GC-1006-31', lines: [['Deterjen cair 800 ml', 12, 'box', 138000]] })
I('BLI-26-10-00012', '2026-10-16', 'S-0208', 'M', { po: 'PO-0208-1014', grn: 'GRN-HO-GUDANG-000149', ref: 'GC-1016-37', lines: [['Pewangi pakaian 1 L', 10, 'box', 164000], ['Lap microfiber', 30, 'pack', 36000]] })
I('BLI-26-10-00019', '2026-10-23', 'S-0208', 'S', { ref: 'GC-1023-41', lines: [['Deterjen cair 800 ml', 10, 'box', 138000], ['Freight & handling', 1, 'trip', 100000]] })
/* Sepatu Sejahtera */
I('BLI-26-08-00033', '2026-08-25', 'S-0077', 'M', { po: 'PO-0077-0820', grn: 'GRN-HO-GUDANG-000121', ref: 'SS/0825/0907', lines: [['Sneakers pria', 250, 'pairs', 165000, '3'], ['Sandal jepit', 300, 'pairs', 38000]] })
I('BLI-26-09-00007', '2026-09-07', 'S-0077', 'M', { po: 'PO-0077-0903', grn: 'GRN-HO-GUDANG-000133', ref: 'SS/0907/0931', lines: [['Sepatu formal wanita', 120, 'pairs', 210000, '5+2'], ['Sneakers pria', 100, 'pairs', 165000]] })
I('BLI-26-09-00021', '2026-09-21', 'S-0077', 'M', { po: 'PO-0077-0918', grn: 'GRN-HO-GUDANG-000140', ref: 'SS/0921/0958', lines: [['Sneakers pria', 160, 'pairs', 165000, '2'], ['Kaos kaki', 40, 'dozen', 54000]] })
I('BLI-26-10-00007', '2026-10-09', 'S-0077', 'U', { po: 'PO-0077-1020', ref: 'SS/UM/1009', ppn: 0, lines: UMLINE(15000000) })
I('BLI-26-10-00015', '2026-10-19', 'S-0077', 'M', { po: 'PO-0077-1020', grn: 'GRN-HO-GUDANG-000155', ref: 'SS/1019/1012', um: [{ no: 'BLI-26-10-00007', amt: 9000000 }], lines: [['Sneakers pria', 200, 'pairs', 165000], ['Sepatu formal wanita', 60, 'pairs', 210000, '5'], ['Freight & handling', 1, 'trip', 394387]] })

const RET = []
const R = (no, date, sup, src, qty, ref) => RET.push({ kind: 'ret', no, date, sup, src, qty, ref, wh: 'HO', term: supOf(sup).term, um: [] })
R('RBL-26-09-00001', '2026-09-25', 'S-0131', 'BLI-26-09-00012', [12], 'AT/RT/0925')
R('RBL-26-10-00002', '2026-10-20', 'S-0102', 'BLI-26-09-00004', [20, 0], 'GMS/RT/1020')
R('RBL-26-10-00003', '2026-10-24', 'S-0077', 'BLI-26-09-00021', [6, 0], 'SS/RT/1024')

const ALL = [...INV, ...RET]
ALL.forEach(d => {
  d.due = addD(d.date, TERM_DAYS[d.term])
  if (d.kind === 'ret') { const s = INV.find(i => i.no === d.src); d.calc = retCalc(s, d.qty); d.amt = -d.calc.grand; d.grn = s.grn; d.ppn = s.ppn }
  else { d.calc = calc(d.lines, d.dm, d.dv, d.ppn); d.amt = d.calc.grand }
})
const docOf = no => ALL.find(d => d.no === no)

/* payments: lines [doc, pay | 'full', discount] — BKK pays, BKM receives (negative lines) */
const KAS_BCA = '1011002001', KAS_MDR = '1011002002', KAS_SAV = '1011003001', KAS_CASH = '1011001001', KAS_PETTY = '1011001002', GIRO_BCA = '2012002001'
const PAYS = []
const P = (no, date, sup, method, acct, giro, lines) => PAYS.push({ no, date, sup, method, acct, giro, lines: lines.map(l => ({ doc: l[0], pay: l[1], disc: l[2] || 0 })) })
P('BKK-26-09-00003', '2026-09-16', 'S-0045', 'Transfer', KAS_SAV, null, [['BLI-26-09-00009', 'full']])
P('BKK-26-09-00004', '2026-09-18', 'S-0102', 'Giro', GIRO_BCA, { no: 'BG-004512', due: '2026-09-21' }, [['BLI-26-08-00031', 24016400]])
P('BKK-26-09-00005', '2026-09-20', 'S-0208', 'Cash', KAS_PETTY, null, [['BLI-26-09-00015', 'full']])
P('BKK-26-09-00006', '2026-09-22', 'S-0077', 'Transfer', KAS_SAV, null, [['BLI-26-08-00033', 'full']])
P('BKK-26-09-00007', '2026-09-25', 'S-0131', 'Giro', GIRO_BCA, { no: 'BG-004521', due: '2026-10-08' }, [['BLI-26-08-00028', 'full', 100000]])
P('BKM-26-10-00001', '2026-10-02', 'S-0131', 'Transfer', KAS_SAV, null, [['RBL-26-09-00001', 'full']])
P('BKK-26-10-00001', '2026-10-03', 'S-0131', 'Cash', KAS_CASH, null, [['BLI-26-09-00026', 'full']])
P('BKK-26-10-00002', '2026-10-05', 'S-0077', 'Giro', GIRO_BCA, { no: 'BG-004530', due: '2026-11-05' }, [['BLI-26-09-00007', 30000000]])
P('BKK-26-10-00003', '2026-10-06', 'S-0102', 'Transfer', KAS_SAV, null, [['BLI-26-09-00004', 25000000]])
P('BKK-26-10-00004', '2026-10-09', 'S-0102', 'Transfer', KAS_MDR, null, [['BLI-26-10-00005', 'full']])
P('BKK-26-10-00005', '2026-10-10', 'S-0077', 'Transfer', KAS_SAV, null, [['BLI-26-10-00007', 'full']])
P('BKK-26-10-00006', '2026-10-12', 'S-0208', 'Cash', KAS_PETTY, null, [['BLI-26-10-00004', 'full']])
P('BKK-26-10-00007', '2026-10-14', 'S-0045', 'Transfer', KAS_SAV, null, [['BLI-26-10-00002', 3000000]])
P('BKK-26-10-00008', '2026-10-26', 'S-0077', 'Transfer', KAS_SAV, null, [['BLI-26-10-00015', 10000000], ['RBL-26-10-00003', -600000]])

const setl = (no, upTo) => sum(PAYS.filter(p => p.date <= upTo), p => sum(p.lines.filter(l => l.doc === no && typeof l.pay === 'number'), l => l.pay + l.disc))
const appl = (d, upTo) => d.date <= upTo ? sum(d.um || [], u => u.amt) : 0
const balAt = (d, upTo = TODAY) => d.date > upTo ? 0 : d.amt - setl(d.no, upTo) - appl(d, upTo)
/* resolve "full" lines in date order: pays what is left of the document */
;[...PAYS].sort((a, b) => a.date.localeCompare(b.date) || a.no.localeCompare(b.no)).forEach(p => p.lines.forEach(l => {
  if (l.pay !== 'full') return
  const d = docOf(l.doc)
  const prior = sum(PAYS.filter(q => q.date < p.date || (q.date === p.date && q.no < p.no)), q => sum(q.lines.filter(x => x.doc === l.doc && typeof x.pay === 'number'), x => x.pay + x.disc))
  l.pay = d.amt - appl(d, '9999') - prior - l.disc
}))
const bal = d => balAt(d, TODAY)
const statusOf = d => { const b = bal(d); return b === 0 ? 'Paid' : b === d.amt ? 'New' : 'Part paid' }
const owedAt = (s, d) => sum(ALL.filter(x => !s || x.sup === s), x => balAt(x, d))
const isLate = d => d.kind !== 'ret' && bal(d) > 0 && d.due < TODAY
const umUsed = (no, except) => sum(INV.filter(i => i.no !== except), i => sum(i.um.filter(u => u.no === no), u => u.amt))
const umLeft = (u, except) => u.calc.grand - umUsed(u.no, except)
const vchOf = no => PAYS.filter(p => p.lines.some(l => l.doc === no)).sort((a, b) => a.date.localeCompare(b.date) || a.no.localeCompare(b.no))
const KAS_NAME = c => (KAS.find(k => k.code === c) || {}).name || clean(accName(c))
const acctLabel = p => p.method === 'Giro' ? clean(accName(p.acct)) : KAS_NAME(p.acct)
const pDoc = no => no.startsWith('RBL') ? 'Return' : TYPE_L[docOf(no).type]

/* purchase orders and receipts: from matching invoices, plus a few open ones */
const POS = []
INV.filter(i => i.type === 'M').forEach(i => {
  let p = POS.find(x => x.no === i.po)
  if (!p) POS.push(p = { no: i.po, sup: i.sup, date: addD(i.date, -6), lines: i.lines.map(l => ({ ...l })), grns: [] })
  if (i.grn) p.grns.push({ no: i.grn, date: addD(i.date, -2) })
})
const extraPO = (no, sup, date, lines, grns = []) => POS.push({ no, sup, date, lines: lines.map(mk), grns })
extraPO('PO-0102-1026', 'S-0102', '2026-10-26', [['Kaos polos basic', 300, 'pcs', 28000], ['Celana chino slim', 100, 'pcs', 92000]], [{ no: 'GRN-HO-GUDANG-000163', date: '2026-10-27' }])
extraPO('PO-0077-1024', 'S-0077', '2026-10-24', [['Sandal jepit', 400, 'pairs', 38000], ['Kaos kaki', 60, 'dozen', 54000]])
extraPO('PO-0131-1022', 'S-0131', '2026-10-22', [['Kain batik cap', 120, 'meter', 42000]])
extraPO('PO-0208-1025', 'S-0208', '2026-10-25', [['Lap microfiber', 60, 'pack', 36000]])
extraPO('PO-0045-1025', 'S-0045', '2026-10-25', [['Earphone bluetooth', 60, 'pcs', 95000]])

/* the books must tie out to the suppliers' payable */
const RECON = SUPPLIERS.map(s => ({ code: s.code, want: s.hutang, got: owedAt(s.code, TODAY) }))
const reconOK = RECON.every(r => r.want === r.got)
if (!reconOK) console.error('Purchasing: payables do not tie to SUPPLIERS[].hutang', RECON)
window.__buy = { INV, RET, PAYS, ALL, POS, RECON, owedAt, balAt, calc, reconOK, fig, ledger }

/* ═════════ small renderers ═════════ */
const stat = w => `<span class="ds-status ${w === 'Paid' ? 'ds-status--ok' : w === 'Part paid' ? 'ds-status--info' : ''}">${w}</span>`
const sheetPill = w => pill(w, w === 'Paid' ? 'ok' : w === 'Part paid' ? 'warn' : '')
const rec = (no, kind) => `<button type="button" class="rec" onclick="event.stopPropagation();${kind === 'v' ? 'buyOpenVch' : 'buyOpenDoc'}('${esc(no)}')">${esc(no)}</button>`
const dueH = d => isLate(d) ? `<span class="late">${day(d.due)}</span>` : day(d.due)
const z = n => n ? num(n) : DASH
const mon = n => n ? money(n) : DASH
const inp = (v, on, o = {}) => `<input ${o.type ? `type="${o.type}"` : ''} value="${esc(v)}" ${o.ro ? 'readonly tabindex="-1"' : ''} ${on && !o.ro ? `onchange="${on}"` : ''} class="${o.cls || ''}">`
const sel = (opts, cur, on, o = {}) => `<select ${on && !o.ro ? `onchange="${on}"` : ''} ${o.ro ? 'disabled' : ''} class="${o.cls || ''}">${opts.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(cur) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`
const facts = xs => `<dl class="ds-facts">${xs.map(([k, v, w]) => `<div class="ds-fact ${w ? 'ds-fact--wide' : ''}"><dt>${k}</dt><dd>${v === '' || v == null ? DASH : v}</dd></div>`).join('')}</dl>`
const supOpts = SUPPLIERS.map(s => [s.code, `${s.name} · ${s.code}`])
const whOpts = LOCS.map(l => [l[0], l[1]])
const termOpts = TERMS.map(([v, l]) => [v, `${v} · ${l}`])
const itemOpts = (s, cur) => { const c = (CAT[s] || []).map(x => x[0]); if (cur && !c.includes(cur)) c.unshift(cur); return c.map(x => [x, x]) }
const accRow = (base, loc) => `<span class="mute">${acc12(base, loc)}</span> ${esc(clean(accName(base)))}`
const lineCols = [{ l: 'Item', k: 'item' }, { l: 'Quantity', k: 'q', num: 1, w: 96 }, { l: 'Unit', k: 'u', w: 80 }, { l: 'Price', k: 'p', num: 1, w: 130 }, { l: 'Disc %', k: 'd', w: 80 }, { l: 'Disc Rp', k: 'dr', w: 100 }, { l: 'Keterangan', k: 'note', w: 150 }, { l: 'Total', k: 't', num: 1, w: 130 }]
const roLines = lines => table({ cols: lineCols, rows: lines.map(l => ({ c: { item: esc(l.item), q: num(l.q), u: esc(l.u), p: num(l.p), d: l.d ? esc(l.d) : DASH, dr: l.dr ? num(l.dr) : DASH, note: l.note ? one(esc(l.note)) : DASH, t: num(lineAmt(l)) } })) })
const totalsK = (c, extra = []) => kpisHTML([{ label: 'Total', value: money(c.sub) }, ...(c.disc ? [{ label: 'Discount', value: money(-c.disc) }] : []), { label: 'PPN', value: c.tax ? money(c.tax) : DASH }, { label: 'Grand total', value: money(c.grand) }, ...extra])
const vchRows = (docNo, d) => {
  let run = d.amt - appl(d, '9999')
  return vchOf(docNo).map(p => { const l = p.lines.find(x => x.doc === docNo), before = run; run -= l.pay + l.disc; return { p, l, before, after: run } })
}
function vchTable(docNo) {
  const d = docOf(docNo), rows = vchRows(docNo, d)
  return table({
    cols: [{ l: 'Voucher', k: 'v' }, { l: 'Date', k: 'd', w: 120 }, { l: 'Payable', k: 'b', num: 1, w: 140 }, { l: 'Paid', k: 'p', num: 1, w: 140 }, { l: 'Discount', k: 'x', num: 1, w: 110 }, { l: 'Status', k: 's', w: 120 }],
    rows: rows.map(r => ({ on: `buyOpenVch('${r.p.no}')`, c: { v: `<span class="nm">${r.p.no}</span>`, d: day(r.p.date), b: num(r.before), p: num(r.l.pay), x: z(r.l.disc), s: stat(r.after === 0 ? 'Paid' : 'Part paid') } })),
    empty: 'Unpaid — no voucher yet',
  })
}

/* ═════════ journals ═════════ */
function invJournal(F) {
  const c = calc(F.lines, F.dm, F.dv, F.ppn), loc = F.wh, vat = c.tax ? [[A.vat, c.tax, 0]] : []
  const out = []
  if (F.type === 'U') out.push({ title: 'Down payment invoice', rows: [[A.um, c.grand, 0], [A.ap, 0, c.grand]] })
  else if (F.type === 'M' && F.grn) out.push({ title: 'Matching invoice, goods already received', rows: [[A.susp, c.net, 0], ...vat, [A.ap, 0, c.grand]] })
  else out.push({ title: F.type === 'M' ? 'Matching invoice, no receipt yet' : 'Standard invoice', rows: [[A.stock, c.net, 0], ...vat, [A.ap, 0, c.grand]] })
  const ap = sum(F.um, u => u.amt)
  if (ap) out.push({ title: 'Down payment applied', rows: [[A.ap, ap, 0], [A.um, 0, ap]] })
  return { blocks: out, loc }
}
function retJournal(src, c) {
  const vat = c.tax ? [[A.vat, 0, c.tax]] : []
  return { loc: src.wh, blocks: [{ title: src.grn ? 'Return of received goods' : 'Return without receipt', rows: [[A.ap, c.grand, 0], [src.grn ? A.susp : A.stock, 0, c.net], ...vat] }] }
}
function vchJournal(p) {
  const cash = sum(p.lines, l => l.pay), disc = sum(p.lines, l => l.disc), apn = cash + disc
  const rows = []
  if (apn > 0) rows.push([A.ap, apn, 0]); else if (apn < 0) rows.push([A.ap, 0, -apn])
  if (cash > 0) rows.push([p.acct, 0, cash]); else if (cash < 0) rows.push([p.acct, -cash, 0])
  if (disc) rows.push([A.disc, 0, disc])
  return { loc: 'HO', blocks: [{ title: p.method === 'Giro' ? 'Payment by giro' : cash < 0 ? 'Money received' : 'Payment', rows }] }
}
function journalSheet(j, crumb, title) {
  const body = j.blocks.map(b => section(b.title, table({
    cols: [{ l: 'Account', k: 'a' }, { l: 'Debit', k: 'd', num: 1, w: 150 }, { l: 'Credit', k: 'c', num: 1, w: 150 }],
    rows: b.rows.map(([a, d, c]) => ({ c: { a: accRow(a, j.loc), d: z(d), c: z(c) } })),
    foot: { a: 'Total', d: num(sum(b.rows, r => r[1])), c: num(sum(b.rows, r => r[2])) },
  }))).join('')
  openSheet({ crumb, title, body })
}

/* ═════════ sheets: invoice · return · voucher ═════════ */
function invSheet(no) {
  const d = docOf(no), c = d.calc, paid = sum(vchOf(no), p => sum(p.lines.filter(l => l.doc === no), l => l.pay + l.disc)), um = sum(d.um, u => u.amt), left = bal(d)
  const st = statusOf(d)
  const apps = INV.filter(i => i.um.some(u => u.no === no))
  const umSec = d.type === 'U'
    ? section('Applied to', table({ cols: [{ l: 'Invoice', k: 'i' }, { l: 'Date', k: 'd', w: 120 }, { l: 'Applied', k: 'a', num: 1, w: 150 }], rows: apps.map(i => ({ on: `buyOpenDoc('${i.no}')`, c: { i: `<span class="nm">${i.no}</span>`, d: day(i.date), a: num(i.um.find(u => u.no === no).amt) } })), empty: 'Not applied yet' }))
    : d.um.length ? section('Down payment', table({ cols: [{ l: 'Down payment invoice', k: 'i' }, { l: 'Total', k: 't', num: 1, w: 140 }, { l: 'Applied here', k: 'a', num: 1, w: 150 }, { l: 'Remaining', k: 'r', num: 1, w: 140 }], rows: d.um.map(u => { const x = docOf(u.no); return { on: `buyOpenDoc('${u.no}')`, c: { i: `<span class="nm">${u.no}</span>`, t: num(x.calc.grand), a: num(u.amt), r: num(umLeft(x)) } } }) })) : ''
  openSheet({
    crumb: ['Purchase invoice'], title: esc(no), pill: sheetPill(st),
    body: kpisHTML([{ label: 'Total', value: money(c.grand) }, { label: 'Down payment applied', value: mon(um) }, { label: 'Paid', value: mon(paid) }, { label: 'Left to pay', value: money(left), bad: isLate(d) }]) +
      `<div style="height:24px"></div>` + facts([['Supplier', esc(supOf(d.sup).name)], ['Invoice type', TYPE_L[d.type]], ['Date', day(d.date)], ['Due date', dueH(d)], ['PO no', d.po ? esc(d.po) : ''], ['Receipt no', d.grn ? esc(d.grn) : ''], ["Supplier's nota no", esc(d.ref)], ['Terms', d.term]]) +
      `<div style="height:32px"></div>` + section('Items', roLines(d.lines), `<span class="mute">${plural(d.lines.length, 'line')}</span>`) + umSec +
      section('Payment', vchTable(no)),
    foot: btn('Journal', `buyJournalOf('${no}')`) + btn('Open in invoice form', `buyOpenForm('${no}')`),
  })
}
function retSheet(no) {
  const d = docOf(no), src = docOf(d.src), c = d.calc, left = bal(d), st = statusOf(d)
  const lines = c.lines.map((l, i) => ({ ...l, q: d.qty[i] || 0 })).filter(l => l.q > 0)
  openSheet({
    crumb: ['Purchase return'], title: esc(no), pill: sheetPill(st),
    body: kpisHTML([{ label: 'Return value', value: money(c.grand) }, { label: 'Settled', value: mon(sum(vchOf(no), p => sum(p.lines.filter(l => l.doc === no), l => -(l.pay + l.disc)))) }, { label: 'Left to settle', value: money(-left) }]) +
      `<div style="height:24px"></div>` + facts([['Supplier', esc(supOf(d.sup).name)], ['Date', day(d.date)], ['Source invoice', rec(d.src)], ["Supplier's ref", esc(d.ref)], ['Receipt no', d.grn ? esc(d.grn) : ''], ['Due date', day(d.due)]]) +
      `<div style="height:32px"></div>` + section('Items returned', roLines(lines)) + section('Payment', vchTable(no)),
    foot: btn('Journal', `buyJournalOf('${no}')`),
  })
}
function vchSheet(no) {
  const p = PAYS.find(x => x.no === no), cash = sum(p.lines, l => l.pay), disc = sum(p.lines, l => l.disc)
  const gp = p.giro ? (p.giro.due <= TODAY ? 'Giro cleared' : 'Giro not cleared') : ''
  openSheet({
    crumb: [no.startsWith('BKM') ? 'Money in' : 'Money out'], title: esc(no), pill: gp ? pill(gp, p.giro.due <= TODAY ? 'ok' : 'warn') : '',
    body: kpisHTML([{ label: cash < 0 ? 'Received' : 'Paid', value: money(Math.abs(cash)) }, { label: 'Discount', value: mon(disc) }, { label: 'Date', value: day(p.date) }]) +
      `<div style="height:24px"></div>` + facts([['Supplier', esc(supOf(p.sup).name)], [p.method === 'Giro' ? 'Giro account' : 'Account', esc(acctLabel(p))], ['Method', p.method], ['Giro no', p.giro ? p.giro.no : ''], ['Giro due', p.giro ? day(p.giro.due) : '']]) +
      `<div style="height:32px"></div>` + section('Documents', table({
        cols: [{ l: 'Document', k: 'd' }, { l: 'Type', k: 't', w: 150 }, { l: 'Payable', k: 'b', num: 1, w: 140 }, { l: 'Paid', k: 'p', num: 1, w: 140 }, { l: 'Discount', k: 'x', num: 1, w: 110 }],
        rows: p.lines.map(l => { const d = docOf(l.doc), before = d.amt - appl(d, '9999') - sum(PAYS.filter(q => q.date < p.date || (q.date === p.date && q.no < p.no)), q => sum(q.lines.filter(x => x.doc === l.doc), x => x.pay + x.disc)); return { on: `buyOpenDoc('${l.doc}')`, c: { d: `<span class="nm">${l.doc}</span>`, t: pDoc(l.doc), b: num(before), p: num(l.pay), x: z(l.disc) } } }),
      })),
    foot: btn('Journal', `buyJournalVch('${no}')`),
  })
}
window.buyOpenDoc = no => no.startsWith('RBL') ? retSheet(no) : invSheet(no)
window.buyOpenVch = no => vchSheet(no)
window.buyJournalOf = no => { const d = docOf(no); if (d.kind === 'ret') journalSheet(retJournal(docOf(d.src), d.calc), ['Purchase return', no], 'Journal'); else journalSheet(invJournal(d), ['Purchase invoice', no], 'Journal') }
window.buyJournalVch = no => journalSheet(vchJournal(PAYS.find(p => p.no === no)), ['Voucher', no], 'Journal')
window.buyOpenForm = no => { loadInv(no); S.stack.length = 0; renderLayers(); go('buy-invoice') }

/* ═════════ 1 · purchase invoice form ═════════ */
const BI = { F: null }
const cloneF = i => ({ ...i, lines: i.lines.map(l => ({ ...l })), um: i.um.map(u => ({ ...u })) })
const firstPO = s => POS.find(p => p.sup === s)
const blankLine = s => { const c = CAT[s][0]; return { item: c[0], q: 1, u: c[1], p: c[2], d: '', note: '', dr: 0 } }
function loadInv(no) { BI.F = { ...cloneF(INV.find(i => i.no === no)), isNew: false, note: (INV.find(i => i.no === no).note || '') } }
function nextNo() { return 'BLI-26-10-' + String(1 + Math.max(...INV.filter(i => i.date >= '2026-10-01').map(i => +i.no.slice(-5)))).padStart(5, '0') }
function newInv() {
  const s = 'S-0102'
  BI.F = { kind: 'inv', isNew: true, no: nextNo(), date: TODAY, sup: s, type: 'S', po: '', grn: '', ref: '', wh: 'HO', note: '', dm: '%', dv: 0, ppn: PPN_OF[s] ?? 11, um: [], term: supOf(s).term, lines: [blankLine(s)] }
}
function pickPO(F, no) {
  const p = POS.find(x => x.no === no)
  F.po = no
  if (!p) { F.grn = ''; return }
  F.lines = p.lines.map(l => ({ ...l })); F.grn = p.grns.length ? p.grns[0].no : ''
}
window.buyPick = v => { v === '__new' ? newInv() : loadInv(v); render() }
window.buyF = (k, v) => {
  const F = BI.F
  if (k === 'sup') { F.sup = v; F.term = supOf(v).term; F.um = []; F.po = ''; F.grn = ''; F.ppn = F.type === 'U' ? 0 : (PPN_OF[v] ?? 11); if (F.type === 'M') pickPO(F, (firstPO(v) || {}).no); else if (F.type === 'S') F.lines = [blankLine(v)]; else F.lines = [{ item: 'Down payment', q: 1, u: '—', p: F.lines[0].p, d: '' }] }
  else if (k === 'type') {
    const was = F.type; F.type = v; F.um = []
    if (v === 'U') { F.lines = [{ item: 'Down payment', q: 1, u: '—', p: 10000000, d: '' }]; F.ppn = 0; F.dv = 0; F.grn = '' }
    else { if (was === 'U') { F.ppn = PPN_OF[F.sup] ?? 11; F.lines = [blankLine(F.sup)] }
      if (v === 'S') { F.po = ''; F.grn = '' } else if (v === 'M') pickPO(F, (firstPO(F.sup) || {}).no) }
  }
  else if (k === 'po') { if (F.type === 'U') F.po = v; else pickPO(F, v) }
  else if (k === 'dv') F.dv = pn(v)
  else if (k === 'ppn') F.ppn = +v
  else F[k] = v
  render()
}
window.buyLine = (i, k, v) => {
  const F = BI.F, l = F.lines[i]
  if (k === 'item') { const c = CAT[F.sup].find(x => x[0] === v); l.item = v; if (c) { l.u = c[1]; l.p = c[2] } }
  else if (k === 'note') l.note = v
  else if (k === 'd') l.d = v.replace(/[^0-9.+]/g, '')
  else if (k === 'dr') l.dr = Math.max(0, pn(v))
  else l[k] = Math.max(0, pn(v))
  render()
}
window.buyAddLine = () => { BI.F.lines.push(blankLine(BI.F.sup)); render() }
window.buyDelLine = i => { if (BI.F.lines.length > 1) BI.F.lines.splice(i, 1); render() }
window.buyJournal = () => journalSheet(invJournal(BI.F), ['Purchase invoice', BI.F.no], 'Journal')
window.buyDelete = () => { if (!BI.F) return; if (!BI.F.isNew) return toast('Posted invoice', 'Posted documents are not deleted; use a return or credit note'); buyPick('__new'); toast('Draft discarded') }
window.buyInfo = () => { if (!BI.F || BI.F.isNew) return toast('Not saved yet', 'Save the invoice first'); buyOpenDoc(BI.F.no) }
window.buySave = () => {
  const F = BI.F
  if (!F) return
  if (!F.sup || !F.lines.length || F.lines.some(l => !l.q || l.q <= 0)) return toast('Check the invoice', 'Supplier and at least one line with a quantity are required')
  const c = calc(F.lines, F.dm, F.dv, F.ppn)
  if (F.isNew) {
    const d = { ...cloneF(F), kind: F.type === 'U' ? 'um' : 'inv', isNew: undefined, due: addD(F.date, TERM_DAYS[F.term]), calc: c, amt: c.grand }
    INV.push(d); ALL.push(d); F.isNew = false
  } else {
    const d = INV.find(i => i.no === F.no); if (!d) return
    Object.assign(d, cloneF(F), { kind: F.type === 'U' ? 'um' : 'inv', due: addD(F.date, TERM_DAYS[F.term]), calc: c, amt: c.grand })
  }
  render(); toast('Invoice saved', `${F.no} · ${money(c.grand)}`)
}


function umAvail(F) { return INV.filter(u => u.type === 'U' && u.sup === F.sup && u.no !== F.no).map(u => ({ u, avail: umLeft(u, F.no), cur: (F.um.find(x => x.no === u.no) || {}).amt || 0 })).filter(x => x.avail > 0) }
window.buyApplyOpen = () => {
  const F = BI.F, c = calc(F.lines, F.dm, F.dv, F.ppn), xs = umAvail(F)
  const body = xs.length ? table({
    cols: [{ l: 'Down payment invoice', k: 'i' }, { l: 'Date', k: 'd', w: 120 }, { l: 'Total', k: 't', num: 1, w: 140 }, { l: 'Available', k: 'a', num: 1, w: 140 }, { l: 'Apply here', k: 'x', num: 1, w: 170 }],
    rows: xs.map(({ u, avail, cur }) => ({ c: { i: `<span class="nm">${u.no}</span>`, d: day(u.date), t: num(u.calc.grand), a: num(avail), x: `<input class="cin r" data-um="${u.no}" data-max="${avail}" value="${num(cur || Math.min(avail, c.grand))}">` } })),
  }) : `<div class="empty-note">No open down payment for ${esc(supOf(F.sup).name)}</div>`
  openSheet({ crumb: ['Purchase invoice', F.no], title: 'Apply down payment', body, foot: xs.length ? btn('Apply', 'buyApplyDo()') : '' })
}
window.buyApplyDo = () => {
  const F = BI.F, c = calc(F.lines, F.dm, F.dv, F.ppn), next = []
  let room = c.grand
  document.querySelectorAll('[data-um]').forEach(el => { const a = Math.min(Math.max(0, pn(el.value)), +el.dataset.max, room); if (a > 0) { next.push({ no: el.dataset.um, amt: a }); room -= a } })
  F.um = next; closeSheet(); render()
  toast('Down payment applied', `${money(sum(next, u => u.amt))} off this invoice`)
}

function renderInvoice() {
  if (!BI.F) loadInv('BLI-26-10-00011')
  const F = BI.F, c = calc(F.lines, F.dm, F.dv, F.ppn), due = addD(F.date, TERM_DAYS[F.term]), isU = F.type === 'U', isM = F.type === 'M'
  const existing = !F.isNew && INV.find(i => i.no === F.no)
  const paid = existing ? sum(vchOf(F.no), p => sum(p.lines.filter(l => l.doc === F.no), l => l.pay + l.disc)) : 0
  const um = sum(F.um, u => u.amt), left = c.grand - um - paid, late = left > 0 && due < TODAY
  const pos = POS.filter(p => p.sup === F.sup)
  const po = POS.find(p => p.no === F.po)
  const myUm = isU ? (F.isNew ? 0 : c.grand - umUsed(F.no, F.no)) : sum(umAvail(F), x => x.avail - x.cur)
  const remain = isU ? (F.isNew ? c.grand : c.grand - umUsed(F.no, F.no)) : myUm
  const fields = [
    field('Invoice no', inp(F.no, null, { ro: 1 })),
    field('Date', inp(F.date, "buyF('date',this.value)", { type: 'date' })),
    field('Supplier', sel(supOpts, F.sup, "buyF('sup',this.value)")),
    field('Invoice type', sel(Object.entries(TYPE_L), F.type, "buyF('type',this.value)")),
    ...(isM ? [field('PO no', sel(pos.length ? pos.map(p => [p.no, `${p.no} · ${dayS(p.date)}`]) : [['', 'No PO']], F.po, "buyF('po',this.value)")), field('Receipt no', sel([['', 'No receipt yet'], ...((po && po.grns) || []).map(g => [g.no, `${g.no} · ${dayS(g.date)}`])], F.grn, "buyF('grn',this.value)"))] : []),
    ...(isU ? [field('PO no', sel([['', 'No PO'], ...pos.map(p => [p.no, `${p.no} · ${dayS(p.date)}`])], F.po, "buyF('po',this.value)"))] : []),
    field('Terms', sel(termOpts, F.term, "buyF('term',this.value)")),
    field('Due date', inp(day(due), null, { ro: 1 })),
    field("Supplier's nota no", inp(F.ref, "buyF('ref',this.value)")),
    field('Warehouse', sel(whOpts, F.wh, "buyF('wh',this.value)")),
    field('Keterangan', inp(F.note || '', "buyF('note',this.value)"), 'span2'),
    ...(isU ? [] : [field('Total discount', `<div class="dsc">${inp(F.dv ? num(F.dv) : '', "buyF('dv',this.value)")}${sel([['%', '%'], ['Rp', 'Rp']], F.dm, "buyF('dm',this.value)")}</div>`), field('PPN', sel([[0, 'No PPN'], [11, 'PPN 11%']], F.ppn, "buyF('ppn',this.value)"))]),
  ].join('')
  const lines = table({
    cols: [...lineCols.map(x => ({ ...x })), { l: '', k: 'x', w: 52 }],
    rows: F.lines.map((l, i) => ({ c: {
      item: isU ? 'Down payment' : isM ? esc(l.item) : sel(itemOpts(F.sup, l.item), l.item, `buyLine(${i},'item',this.value)`, { cls: 'cin' }),
      q: isU ? '1' : inp(num(l.q), `buyLine(${i},'q',this.value)`, { cls: 'cin r' }),
      u: esc(l.u),
      p: isM ? num(l.p) : inp(num(l.p), `buyLine(${i},'p',this.value)`, { cls: 'cin r' }),
      d: isU ? DASH : isM ? (l.d ? esc(l.d) : DASH) : inp(l.d, `buyLine(${i},'d',this.value)`, { cls: 'cin r' }),
      dr: isU ? DASH : isM ? (l.dr ? esc(num(l.dr)) : DASH) : inp(num(l.dr || 0), `buyLine(${i},'dr',this.value)`, { cls: 'cin r' }),
      note: isU ? DASH : inp(l.note || '', `buyLine(${i},'note',this.value)`, { cls: 'cin' }),
      t: num(lineAmt(l)),
      x: isU || isM || F.lines.length < 2 ? '' : `<button type="button" class="ib" aria-label="Remove line" onclick="buyDelLine(${i})">${ico('trash')}</button>`,
    } })),
  })
  const tab = tabOf('buy-invoice', 'um')
  const umRows = isU
    ? INV.filter(i => i.um.some(u => u.no === F.no)).map(i => ({ on: `buyOpenDoc('${i.no}')`, c: { i: `<span class="nm">${i.no}</span>`, d: day(i.date), t: '', a: num(i.um.find(u => u.no === F.no).amt), r: '' } }))
    : F.um.map(u => { const x = docOf(u.no); return { on: `buyOpenDoc('${u.no}')`, c: { i: `<span class="nm">${u.no}</span>`, d: day(x.date), t: num(x.calc.grand), a: num(u.amt), r: num(umLeft(x, F.no) - u.amt) } } })
  const umTbl = isU
    ? table({ cols: [{ l: 'Applied to invoice', k: 'i' }, { l: 'Date', k: 'd', w: 120 }, { l: 'Applied', k: 'a', num: 1, w: 150 }], rows: umRows.map(r => ({ ...r, c: { i: r.c.i, d: r.c.d, a: r.c.a } })), empty: 'Not applied yet' })
    : table({ cols: [{ l: 'Down payment invoice', k: 'i' }, { l: 'Date', k: 'd', w: 120 }, { l: 'Total', k: 't', num: 1, w: 140 }, { l: 'Applied', k: 'a', num: 1, w: 140 }, { l: 'Remaining', k: 'r', num: 1, w: 140 }], rows: umRows, empty: 'No down payment applied' })
  const payTbl = existing ? vchTable(F.no) : table({ rows: [], empty: 'Unpaid — save the invoice, then pay it with a BKK' })
  const pbiHTML = !po
    ? `<div class="empty-note">This invoice has no PO to compare. Choose Invoice type Matching PO and a PO first.</div>`
    : table({ cols: [{ l: 'Item', k: 'i' }, { l: 'PO', k: 'po', num: 1, w: 90 }, { l: 'BPB', k: 'bpb', num: 1, w: 90 }, { l: 'Invoice', k: 'inv', num: 1, w: 100 }, { l: 'Sisa PO', k: 'sp', num: 1, w: 100 }, { l: 'Sisa BPB', k: 'sb', num: 1, w: 100 }, { l: 'Retur', k: 'ret', num: 1, w: 90 }], rows: F.lines.map((l, i) => { const p = po.lines[i] || { q: 0 }; const bpb = po.grns.length ? p.q : 0; const ret = sum(RET.filter(r => r.src === F.po), r => sum(r.qty.filter((q, j) => j === i), q => q)); return { c: { i: esc(l.item), po: p.q ? num(p.q) : DASH, bpb: bpb ? num(bpb) : DASH, inv: num(l.q), sp: p.q ? num(Math.max(0, p.q - l.q)) : DASH, sb: bpb ? num(Math.max(0, bpb - l.q)) : DASH, ret: ret ? num(ret) : DASH } } }), empty: 'No line on the PO' })
  const openList = [['__new', 'New invoice'], ...INV.slice().sort((a, b) => b.date.localeCompare(a.date) || b.no.localeCompare(a.no)).map(i => [i.no, `${i.no} · ${shortName(i.sup)} · ${money(i.calc.grand)}`])]
  return page({
    title: `Purchase invoice <span class="mute" style="font-weight:400">· ${esc(F.no)}</span>`,
    actions: [{ label: 'Save invoice', on: 'buySave()' }, { label: 'Journal', on: 'buyJournal()' }, { label: 'Del', on: 'buyDelete()', kind: 'secondary' }, { label: 'Info', on: 'buyInfo()', kind: 'secondary' }, { label: 'Print', on: "printPage('Purchase invoice')", kind: 'secondary', icon: 'printer' }],
    kpis: [{ label: 'Due', value: day(due), bad: late }, { label: 'Down payment applied', value: um ? money(um) : DASH }, { label: 'Paid', value: paid ? money(paid) : DASH }, { label: 'Left to pay', value: money(left), bad: late }],
    body: (existing && left <= 0 ? `<div class="ds-banner ds-banner--ok" style="margin-bottom:20px">${ico('check')}<span>READ ONLY · this invoice is fully paid</span></div>` : '') + bar(`<label class="ctl-l">Open <select class="ctl" onchange="buyPick(this.value)">${openList.map(([v, l]) => `<option value="${esc(v)}" ${(F.isNew ? '__new' : F.no) === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`) +
      `<div class="form-grid">${fields}</div>` +
      section('Items', lines, isU || isM ? '' : btn(`${ico('plus')}Add item`, 'buyAddLine()')) +
      `<div class="foot-row">${totalsK(c, [{ label: 'Remaining down payment', value: money(remain) }])}<div class="mute" style="text-align:right">Total hutang <b>${money(c.grand)}</b><br>Bayar <b>${money(paid)}</b><br>Sisa <b>${money(left)}</b></div>${isU ? '' : btn('Apply down payment', 'buyApplyOpen()')}</div>` +
      tabsHTML('buy-invoice', [['um', isU ? 'Applied to' : 'Down payment', isU ? umRows.length : F.um.length], ['pbi', 'PO-BPB-INVOICE'], ['pay', 'Payment', existing ? vchOf(F.no).length : 0]], tab) +
      (tab === 'pbi' ? pbiHTML : tab === 'pay' ? payTbl : umTbl),
  })
}
reg({ id: 'buy-invoice', group: 'buy', label: 'Purchase invoice', render: renderInvoice })

/* ═════════ 2 · purchase return ═════════ */
const RT = { no: '', isNew: true, date: TODAY, sup: 'S-0077', src: '', qty: [], ref: '' }
const srcOf = () => INV.find(i => i.no === RT.src)
const invsOf = s => INV.filter(i => i.sup === s && i.type !== 'U').sort((a, b) => b.date.localeCompare(a.date))
function newRet() { Object.assign(RT, { isNew: true, no: 'RBL-26-10-' + String(1 + Math.max(...RET.map(r => +r.no.slice(-5)))).padStart(5, '0'), date: TODAY, ref: '' }); setSrc(RT.sup, invsOf(RT.sup)[0].no) }
function setSrc(s, no) { RT.sup = s; RT.src = no; const l = srcOf().lines; RT.qty = l.map((x, i) => i === 0 && x.item !== 'Freight & handling' ? Math.min(2, x.q) : 0) }
function loadRet(no) { const r = RET.find(x => x.no === no); Object.assign(RT, { isNew: false, no, date: r.date, sup: r.sup, src: r.src, qty: r.qty.slice(), ref: r.ref }) }
window.buyRLoad = v => { v === '__new' ? newRet() : loadRet(v); S.f['buy-return'] = { mode: 'partial' }; render() }
window.buyR = (k, v) => { if (k === 'sup') setSrc(v, invsOf(v)[0].no); else if (k === 'src') setSrc(RT.sup, v); else RT[k] = v; render() }
window.buyRq = (i, v) => { RT.qty[i] = Math.min(Math.max(0, pn(v)), srcOf().lines[i].q); render() }
const rqEff = () => filt('buy-return', 'mode', 'partial') === 'full' ? srcOf().lines.map(l => l.q) : RT.qty
window.buyRJournal = () => { const c = retCalc(srcOf(), rqEff()); journalSheet(retJournal(srcOf(), c), ['Purchase return', RT.no], 'Journal') }
window.buyRSave = () => {
  const src = srcOf(); if (!src) return
  const qty = rqEff(), c = retCalc(src, qty)
  const due = addD(RT.date, TERM_DAYS[supOf(RT.sup).term])
  const d = RET.find(r => r.no === RT.no)
  if (d) Object.assign(d, { date: RT.date, sup: RT.sup, src: RT.src, qty: qty.slice(), ref: RT.ref, due, calc: c, amt: -c.grand, grn: src.grn, ppn: src.ppn })
  else { const row = { kind: 'ret', no: RT.no, date: RT.date, sup: RT.sup, src: RT.src, qty: qty.slice(), ref: RT.ref, wh: 'HO', term: supOf(RT.sup).term, um: [], due, calc: c, amt: -c.grand, grn: src.grn, ppn: src.ppn }; RET.push(row); ALL.push(row) }
  RT.isNew = false; render(); toast('Return saved', `${RT.no} · ${money(c.grand)}`)
}


function renderReturn() {
  const tab = tabOf('buy-return', 'form')
  if (tab === 'list') return returnList()
  if (!RT.src) newRet()
  const src = srcOf(), qty = rqEff(), c = retCalc(src, qty), mode = filt('buy-return', 'mode', 'partial')
  const exist = !RT.isNew && RET.find(r => r.no === RT.no)
  const owed = owedAt(RT.sup, TODAY), before = exist ? owed - bal(exist) : owed, after = exist ? owed : owed - c.grand
  const due = addD(RT.date, TERM_DAYS[supOf(RT.sup).term])
  const fields = [
    field('Return no', inp(RT.no, null, { ro: 1 })),
    field('Date', inp(RT.date, "buyR('date',this.value)", { type: 'date' })),
    field('Supplier', sel(supOpts, RT.sup, "buyR('sup',this.value)")),
    field('Source invoice', sel(invsOf(RT.sup).map(i => [i.no, `${i.no} · ${dayS(i.date)} · ${money(i.calc.grand)}`]), RT.src, "buyR('src',this.value)")),
    field('Terms', inp(supOf(RT.sup).term, null, { ro: 1 })),
    field('Due date', inp(day(due), null, { ro: 1 })),
    field("Supplier's ref", inp(RT.ref, "buyR('ref',this.value)")),
    field('Receipt no', inp(src.grn || 'No receipt', null, { ro: 1 })),
  ].join('')
  const full = mode === 'full'
  const lines = table({
    cols: [{ l: 'Item', k: 'item' }, { l: 'Invoiced', k: 'i', num: 1, w: 90 }, { l: 'Return quantity', k: 'q', num: 1, w: 130 }, { l: 'Unit', k: 'u', w: 80 }, { l: 'Price', k: 'p', num: 1, w: 120 }, { l: 'Discount', k: 'd', w: 90 }, { l: 'Total', k: 't', num: 1, w: 130 }],
    rows: src.lines.map((l, i) => ({ c: { item: esc(l.item), i: num(l.q), q: inp(num(qty[i] || 0), `buyRq(${i},this.value)`, { cls: 'cin r', ro: full }), u: esc(l.u), p: num(l.p), d: l.d ? esc(l.d) : DASH, t: num(lineAmt({ ...l, q: qty[i] || 0 })) } })),
  })
  const sets = RET.filter(r => r.sup === RT.sup)
  return page({
    title: `Purchase return <span class="mute" style="font-weight:400">· ${esc(RT.no)}</span>`,
    actions: [{ label: 'Save return', on: 'buyRSave()' }, { label: 'Journal', on: 'buyRJournal()' }, { label: 'Print', on: "printPage('Purchase return')", kind: 'secondary', icon: 'printer' }],
    tabs: [['form', 'Return'], ['list', 'All returns', RET.length]], tab,
    kpis: [{ label: 'Return value', value: money(c.grand) }, { label: 'Payable before', value: money(before) }, { label: 'Payable after', value: money(after) }, { label: 'Status', value: exist ? statusOf(exist) : 'New' }],
    body: bar(`<label class="ctl-l">Open <select class="ctl" onchange="buyRLoad(this.value)">${[['__new', 'New return'], ...RET.map(r => [r.no, `${r.no} · ${shortName(r.sup)}`])].map(([v, l]) => `<option value="${esc(v)}" ${(RT.isNew ? '__new' : RT.no) === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`, chips('buy-return', 'mode', [['partial', 'Partial return'], ['full', 'Full return']], 'partial')) +
      `<div class="form-grid">${fields}</div>` + section('Items', lines) +
      `<div class="foot-row">${totalsK(c)}</div>` + section('Payment', exist ? vchTable(exist.no) : table({ rows: [], empty: 'Not settled yet' })),
  })
}
function returnList() {
  const q = S.q['buy-return'] || ''
  const rows = RET.filter(r => hit(q, r.no, r.src, supOf(r.sup).name)).sort((a, b) => b.date.localeCompare(a.date))
  return page({
    title: 'Purchase return', actions: [{ label: 'New return', on: "buyRLoad('__new');setTab('buy-return','form')" }],
    tabs: [['form', 'Return'], ['list', 'All returns', RET.length]], tab: 'list',
    kpis: [{ label: 'Returns', value: String(RET.length) }, { label: 'Returned', value: money(sum(RET, r => r.calc.grand)) }, { label: 'Left to settle', value: money(-sum(RET, bal)) }],
    body: bar(search('buy-return', 'Search return, invoice or supplier')) + table({
      cols: [{ l: 'Return', k: 'n' }, { l: 'Date', k: 'd', w: 110 }, { l: 'Supplier', k: 's', w: 200 }, { l: 'Invoice', k: 'i', w: 160 }, { l: 'Amount', k: 'a', num: 1, w: 130 }, { l: 'Left', k: 'b', num: 1, w: 120 }, { l: 'Status', k: 't', w: 110 }],
      rows: rows.map(r => ({ on: `buyOpenDoc('${r.no}')`, c: { n: `<span class="nm">${r.no}</span>`, d: day(r.date), s: `<span class="one">${esc(supOf(r.sup).name)}</span>`, i: r.src, a: money(r.amt), b: money(bal(r)), t: stat(statusOf(r)) } })),
      foot: { n: 'Total', a: money(sum(rows, r => r.amt)), b: money(sum(rows, bal)) },
      empty: 'No return matches',
    }),
  })
}
reg({ id: 'buy-return', group: 'buy', label: 'Purchase return', render: renderReturn })

/* ═════════ 3 · supplier hub ═════════ */
const LEDGER_FROM = '2026-09-01'
function ledger(s, from) {
  const open = owedAt(s, addD(from, -1)), ev = []
  ALL.filter(d => d.sup === s && d.date >= from && d.date <= TODAY).forEach(d => {
    if (d.kind === 'ret') ev.push({ date: d.date, o: 1, doc: d.no, desc: 'Purchase return', dr: d.calc.grand, cr: 0 })
    else ev.push({ date: d.date, o: 0, doc: d.no, desc: d.kind === 'um' ? 'Down payment invoice' : 'Purchase invoice', dr: 0, cr: d.calc.grand })
    d.um.forEach(u => ev.push({ date: d.date, o: 2, doc: d.no, desc: 'Down payment ' + u.no + ' applied', dr: u.amt, cr: 0 }))
  })
  PAYS.filter(p => p.sup === s && p.date >= from && p.date <= TODAY).forEach(p => { const n = sum(p.lines, l => l.pay + l.disc); ev.push({ date: p.date, o: 3, doc: p.no, v: 1, desc: n < 0 ? 'Refund received' : p.method === 'Giro' ? 'Payment by giro' : 'Payment, ' + p.method.toLowerCase(), dr: n > 0 ? n : 0, cr: n < 0 ? -n : 0 }) })
  ev.sort((a, b) => a.date.localeCompare(b.date) || a.o - b.o || a.doc.localeCompare(b.doc))
  let b = open
  const rows = ev.map(e => { b += e.cr - e.dr; return { ...e, bal: b } })
  return { open, rows, close: b }
}
const ledgerTable = (L, from) => table({
  cols: [{ l: 'Date', k: 'd', w: 110 }, { l: 'Document', k: 'n', w: 170 }, { l: 'Description', k: 'x' }, { l: 'Debit', k: 'dr', num: 1, w: 120 }, { l: 'Credit', k: 'cr', num: 1, w: 120 }, { l: 'Balance', k: 'b', num: 1, w: 130 }],
  rows: [{ cls: 'opening', c: { d: day(from), n: '', x: 'Opening balance', dr: '', cr: '', b: num(L.open) } }, ...L.rows.map(e => ({ c: { d: day(e.date), n: rec(e.doc, e.v ? 'v' : 'd'), x: `<span class="one">${esc(e.desc)}</span>`, dr: z(e.dr), cr: z(e.cr), b: num(e.bal) } }))],
  foot: { x: 'Closing', dr: num(sum(L.rows, e => e.dr)), cr: num(sum(L.rows, e => e.cr)), b: num(L.close) },
})
function fig(s, from, to) {
  const inR = d => d >= from && d <= to, docs = ALL.filter(x => !s || x.sup === s), ps = PAYS.filter(p => (!s || p.sup === s) && inR(p.date))
  const purchases = sum(docs.filter(d => d.kind !== 'ret' && inR(d.date)), d => d.calc.grand)
  const returns = sum(docs.filter(d => d.kind === 'ret' && inR(d.date)), d => d.calc.grand)
  const dp = sum(docs.filter(d => inR(d.date)), d => sum(d.um, u => u.amt))
  const pays = sum(ps, p => sum(p.lines, l => l.pay)), disc = sum(ps, p => sum(p.lines, l => l.disc))
  const opening = owedAt(s, addD(from, -1))
  return { opening, purchases, returns, dp, pays, disc, closing: opening + purchases - returns - dp - pays - disc }
}
const hubSup = () => { const c = filt('buy-info', 'sup', 'S-0102'); return supOf(c) ? c : 'S-0102' }
function renderInfo() {
  const sc = hubSup(), s = supOf(sc), tab = tabOf('buy-info', 'docs'), q = S.q['buy-info'] || ''
  const docs = ALL.filter(d => d.sup === sc).sort((a, b) => b.date.localeCompare(a.date) || b.no.localeCompare(a.no))
  const owed = owedAt(sc, TODAY), overdue = sum(docs.filter(isLate), bal), dpOpen = sum(INV.filter(u => u.type === 'U' && u.sup === sc), u => umLeft(u))
  const lateN = docs.filter(isLate).length
  const sups = SUPPLIERS.filter(x => hit(q, x.name, x.code))
  const supChips = sups.length ? `<div class="chips" role="radiogroup">${sups.map(x => `<button class="chip" type="button" role="radio" aria-checked="${x.code === sc}" onclick="setFilt('buy-info','sup','${x.code}')">${esc(x.name)}</button>`).join('')}</div>` : '<span class="mute">No supplier matches</span>'
  const stF = filt('buy-info', 'st', 'all')
  let body = bar(search('buy-info', 'Search supplier'), supChips)
  if (tab === 'docs') {
    const cnt = k => docs.filter(d => k === 'all' || statusOf(d) === k).length
    const rows = docs.filter(d => stF === 'all' || statusOf(d) === stF)
    body += `<div class="ds-bar">${chips('buy-info', 'st', [['all', 'All', cnt('all')], ['New', 'New', cnt('New')], ['Part paid', 'Part paid', cnt('Part paid')], ['Paid', 'Paid', cnt('Paid')]], 'all')}</div>` + table({
      cols: [{ l: 'Document', k: 'n' }, { l: 'Date', k: 'd', w: 110 }, { l: 'Due', k: 'u', w: 110 }, { l: 'Total', k: 't', num: 1, w: 130 }, { l: 'Balance', k: 'b', num: 1, w: 130 }, { l: 'Status', k: 's', w: 110 }],
      rows: rows.map(d => ({ on: `buyOpenDoc('${d.no}')`, c: { n: `<span class="one"><span class="nm">${d.no}</span> <span class="mute">· ${d.kind === 'ret' ? 'Return' : TYPE_L[d.type]}</span></span>`, d: day(d.date), u: d.kind === 'ret' ? DASH : dueH(d), t: money(d.amt), b: isLate(d) ? `<span class="late">${money(bal(d))}</span>` : money(bal(d)), s: stat(statusOf(d)) } })),
      foot: { n: 'Total', t: money(sum(rows, d => d.amt)), b: money(sum(rows, bal)) },
      empty: 'Nothing here',
    })
  } else if (tab === 'pays') {
    const ps = PAYS.filter(p => p.sup === sc).sort((a, b) => b.date.localeCompare(a.date) || b.no.localeCompare(a.no))
    body += table({
      cols: [{ l: 'Voucher', k: 'v', w: 170 }, { l: 'Date', k: 'd', w: 110 }, { l: 'Paid', k: 'p', num: 1, w: 140 }, { l: 'Discount', k: 'x', num: 1, w: 120 }, { l: 'Account', k: 'a' }],
      rows: ps.map(p => ({ on: `buyOpenVch('${p.no}')`, c: { v: `<span class="nm">${p.no}</span>`, d: day(p.date), p: money(sum(p.lines, l => l.pay)), x: z(sum(p.lines, l => l.disc)), a: `<span class="one">${esc(acctLabel(p))}${p.giro ? ` <span class="mute">· ${p.giro.no}</span>` : ''}</span>` } })),
      foot: { v: 'Total', p: money(sum(ps, p => sum(p.lines, l => l.pay))), x: num(sum(ps, p => sum(p.lines, l => l.disc))) },
      empty: 'No payment yet',
    })
  } else if (tab === 'sum') {
    const cols = [['Sep 2026', '2026-09-01', '2026-09-30'], ['Oct 2026', '2026-10-01', '2026-10-31'], ['Sep–Oct', '2026-09-01', '2026-10-31']]
    const F = cols.map(c => fig(sc, c[1], c[2]))
    const lines = [['Opening balance', f => f.opening], ['Purchases on credit', f => f.purchases], ['Returns', f => -f.returns], ['Down payment applied', f => -f.dp], ['Payments', f => -f.pays], ['Discounts taken', f => -f.disc]]
    body += table({
      cols: [{ l: '', k: 'l' }, ...cols.map((c, i) => ({ l: c[0], k: 'c' + i, num: 1, w: 160 }))],
      rows: lines.map(([l, f]) => ({ c: { l, ...Object.fromEntries(F.map((x, i) => ['c' + i, z(f(x))])) } })),
      foot: { l: 'Closing balance', ...Object.fromEntries(F.map((x, i) => ['c' + i, num(x.closing)])) },
    })
  } else {
    const L = ledger(sc, LEDGER_FROM)
    body += ledgerTable(L, LEDGER_FROM)
  }
  return page({
    title: esc(s.name), actions: [{ label: 'New purchase', on: "go('buy-invoice')", icon: 'plus' }, { label: 'New return', on: "go('buy-return')", kind: 'secondary' }, { label: 'New supplier', on: "soon('Supplier created')", kind: 'secondary' }],
    tabs: [['docs', 'Invoices & returns', docs.length], ['pays', 'Payments'], ['sum', 'Payable summary'], ['ledger', 'Supplier ledger']], tab,
    kpis: [{ label: 'Terms', value: `${s.term} · ${TERM_DAYS[s.term]} days` }, { label: 'Payable limit', value: `${money(owed)} of ${money(s.limit)}` }, { label: 'Overdue', value: overdue ? `${money(overdue)} · ${plural(lateN, 'invoice')}` : DASH, bad: overdue > 0 }, { label: 'Down payment open', value: mon(dpOpen) }],
    body,
  })
}
reg({ id: 'buy-info', group: 'buy', label: 'Supplier hub', render: renderInfo })

/* ═════════ 4 · payables reports ═════════ */
const PERIODS_R = { sep: ['Sep 2026', '2026-09-01', '2026-09-30'], oct: ['Oct 2026', '2026-10-01', '2026-10-31'], both: ['Sep–Oct', '2026-09-01', '2026-10-31'] }
const bk = (basis, a) => basis === 'due' ? (a <= 0 ? 0 : a <= 30 ? 1 : a <= 60 ? 2 : a <= 90 ? 3 : 4) : (a <= 30 ? 0 : a <= 60 ? 1 : a <= 90 ? 2 : 3)
const supFilter = c => d => c.sup === 'all' || d.sup === c.sup
function rAging(c) {
  const docs = ALL.filter(d => balAt(d, c.asof) !== 0)
  const labels = c.basis === 'due' ? ['Not due', '1–30', '31–60', '61–90', '90+'] : ['0–30', '31–60', '61–90', '90+']
  const age = d => diffD(c.asof, c.basis === 'due' ? d.due : d.date)
  const bcols = labels.map((l, i) => ({ l, k: 'b' + i, num: 1, w: 112 }))
  const cells = ds => { const v = labels.map(() => 0); ds.forEach(d => { v[bk(c.basis, age(d))] += balAt(d, c.asof) }); return v }
  const mkc = v => ({ ...Object.fromEntries(v.map((x, i) => ['b' + i, z(x)])), t: num(sum(v)) })
  const tot = sum(docs, d => balAt(d, c.asof)), over = sum(docs.filter(d => age(d) > 60), d => balAt(d, c.asof))
  let tbl
  if (c.view === 'inv') {
    const rows = []
    SUPPLIERS.forEach(s => { const ds = docs.filter(d => d.sup === s.code).sort((a, b) => a.date.localeCompare(b.date)); if (!ds.length) return; rows.push({ group: `${esc(s.name)} <span class="mute">· ${plural(ds.length, 'document')}</span>` }); ds.forEach(d => rows.push({ on: `buyOpenDoc('${d.no}')`, c: { n: `<span class="nm">${d.no}</span>`, d: day(d.date), u: d.kind === 'ret' ? DASH : (d.due < c.asof && balAt(d, c.asof) > 0 ? `<span class="late">${day(d.due)}</span>` : day(d.due)), ...mkc(cells([d])) } })) })
    tbl = table({ cols: [{ l: 'Document', k: 'n', w: 170 }, { l: 'Date', k: 'd', w: 110 }, { l: 'Due', k: 'u', w: 110 }, ...bcols, { l: 'Total', k: 't', num: 1, w: 120 }], rows, foot: { n: 'Total', ...mkc(cells(docs)) } })
  } else {
    const rows = SUPPLIERS.filter(s => docs.some(d => d.sup === s.code)).map(s => ({ on: `setFilt('buy-info','sup','${s.code}');go('buy-info')`, c: { n: `<span class="one">${esc(s.name)}</span>`, ...mkc(cells(docs.filter(d => d.sup === s.code))) } }))
    tbl = table({ cols: [{ l: 'Supplier', k: 'n' }, ...bcols, { l: 'Total', k: 't', num: 1, w: 120 }], rows, foot: { n: 'Total', ...mkc(cells(docs)) } })
  }
  return { kpis: [{ label: 'Payable', value: money(tot) }, { label: 'Over 60 days', value: money(over), bad: over > 0 }, { label: 'Oldest', value: `${Math.max(0, ...docs.map(age))} days` }], tbl, mw: 760 }
}
function rDue(c) {
  const ds = ALL.filter(d => d.kind !== 'ret' && balAt(d, c.asof) > 0 && d.due <= c.asof && supFilter(c)(d)).sort((a, b) => a.due.localeCompare(b.due))
  const rows = []
  SUPPLIERS.forEach(s => { const x = ds.filter(d => d.sup === s.code); if (!x.length) return; rows.push({ group: `${esc(s.name)} <span class="mute">· ${plural(x.length, 'invoice')}</span>` }); x.forEach(d => rows.push({ on: `buyOpenDoc('${d.no}')`, c: { n: `<span class="nm">${d.no}</span>`, d: day(d.date), u: `<span class="late">${day(d.due)}</span>`, l: `<span class="late">${diffD(c.asof, d.due)} days</span>`, b: money(balAt(d, c.asof)) } })) })
  return { kpis: [{ label: 'Due payables', value: money(sum(ds, d => balAt(d, c.asof))), bad: ds.length > 0 }, { label: 'Invoices', value: String(ds.length) }, { label: 'Oldest', value: ds.length ? `${Math.max(...ds.map(d => diffD(c.asof, d.due)))} days late` : DASH }],
    tbl: table({ cols: [{ l: 'Invoice', k: 'n', w: 180 }, { l: 'Date', k: 'd', w: 120 }, { l: 'Due', k: 'u', w: 120 }, { l: 'Days late', k: 'l', w: 120 }, { l: 'Balance', k: 'b', num: 1 }], rows, foot: { n: 'Total', b: money(sum(ds, d => balAt(d, c.asof))) }, empty: 'Nothing is due on this date' }), mw: 640 }
}
function rRemain(c) {
  const docs = ALL.filter(d => balAt(d, c.asof) !== 0)
  let tbl
  if (c.view === 'inv') {
    const rows = []
    SUPPLIERS.forEach(s => { const x = docs.filter(d => d.sup === s.code).sort((a, b) => a.date.localeCompare(b.date)); if (!x.length) return; rows.push({ group: `${esc(s.name)} <span class="mute">· ${plural(x.length, 'document')}</span>` }); x.forEach(d => rows.push({ on: `buyOpenDoc('${d.no}')`, c: { n: `<span class="nm">${d.no}</span>`, d: day(d.date), u: d.kind === 'ret' ? DASH : day(d.due), b: money(balAt(d, c.asof)) } })) })
    tbl = table({ cols: [{ l: 'Document', k: 'n', w: 180 }, { l: 'Date', k: 'd', w: 120 }, { l: 'Due', k: 'u', w: 120 }, { l: 'Balance', k: 'b', num: 1 }], rows, foot: { n: 'Remaining', b: money(sum(docs, d => balAt(d, c.asof))) } })
  } else {
    const rows = SUPPLIERS.map(s => { const x = docs.filter(d => d.sup === s.code), a = sum(x.filter(d => d.kind !== 'ret'), d => balAt(d, c.asof)), r = sum(x.filter(d => d.kind === 'ret'), d => balAt(d, c.asof)); return { s, a, r } }).filter(x => x.a || x.r)
    tbl = table({ cols: [{ l: 'Supplier', k: 'n' }, { l: 'Invoices', k: 'a', num: 1, w: 150 }, { l: 'Returns', k: 'r', num: 1, w: 150 }, { l: 'Remaining payable', k: 't', num: 1, w: 170 }], rows: rows.map(x => ({ on: `setFilt('buy-info','sup','${x.s.code}');go('buy-info')`, c: { n: `<span class="one">${esc(x.s.name)}</span>`, a: money(x.a), r: x.r ? money(x.r) : DASH, t: money(x.a + x.r) } })), foot: { n: 'Total', a: money(sum(rows, x => x.a)), r: money(sum(rows, x => x.r)), t: money(sum(rows, x => x.a + x.r)) } })
  }
  const inv = sum(docs.filter(d => d.kind !== 'ret'), d => balAt(d, c.asof)), ret = sum(docs.filter(d => d.kind === 'ret'), d => balAt(d, c.asof))
  return { kpis: [{ label: 'Remaining payable', value: money(inv + ret) }, { label: 'Open invoices', value: money(inv) }, { label: 'Returns netted', value: ret ? money(ret) : DASH }], tbl, mw: 640 }
}
function rSummary(c) {
  const [, from, to] = PERIODS_R[c.period], rows = SUPPLIERS.map(s => ({ s, f: fig(s.code, from, to) }))
  const T = fig(null, from, to)
  const cell = f => ({ o: z(f.opening), p: z(f.purchases), r: z(-f.returns), d: z(-f.dp), y: z(-f.pays), x: z(-f.disc), c: num(f.closing) })
  return { kpis: [{ label: 'Opening', value: money(T.opening) }, { label: 'Purchases', value: money(T.purchases) }, { label: 'Payments', value: money(T.pays) }, { label: 'Closing', value: money(T.closing) }],
    tbl: table({ cols: [{ l: 'Supplier', k: 'n' }, { l: 'Opening', k: 'o', num: 1, w: 108 }, { l: 'Purchases', k: 'p', num: 1, w: 108 }, { l: 'Returns', k: 'r', num: 1, w: 100 }, { l: 'Down payment', k: 'd', num: 1, w: 118 }, { l: 'Payments', k: 'y', num: 1, w: 108 }, { l: 'Discounts', k: 'x', num: 1, w: 100 }, { l: 'Closing', k: 'c', num: 1, w: 112 }], rows: rows.map(({ s, f }) => ({ c: { n: `<span class="one">${esc(s.name)}</span>`, ...cell(f) } })), foot: { n: 'Total', ...cell(T) } }), mw: 940 }
}
function rDaily(c) {
  const [, from, to] = PERIODS_R[c.period], f = supFilter(c), s = c.sup === 'all' ? null : c.sup
  const dates = [...new Set([...ALL.filter(f).map(d => d.date), ...PAYS.filter(f).map(p => p.date)])].filter(d => d >= from && d <= to && d <= TODAY).sort()
  let run = owedAt(s, addD(from, -1))
  const rows = dates.map(d => { const g = fig(s, d, d); run = g.closing; return { c: { d: day(d), p: z(g.purchases), r: z(-g.returns - g.dp), y: z(-g.pays - g.disc), k: DASH, b: num(g.closing) } } })
  const T = fig(s, from, to)
  return { kpis: [{ label: 'Opening', value: money(T.opening) }, { label: 'Credit purchases', value: money(T.purchases) }, { label: 'Payments', value: money(T.pays + T.disc) }, { label: 'Closing', value: money(T.closing) }],
    tbl: table({ cols: [{ l: 'Date', k: 'd', w: 130 }, { l: 'Credit purchases', k: 'p', num: 1 }, { l: 'Returns & down payment', k: 'r', num: 1 }, { l: 'Payments', k: 'y', num: 1 }, { l: 'Cash purchases', k: 'k', num: 1 }, { l: 'Balance', k: 'b', num: 1 }], rows, foot: { d: 'Period', p: num(T.purchases), r: num(-T.returns - T.dp), y: num(-T.pays - T.disc), k: DASH, b: num(T.closing) } }), mw: 760 }
}
function rLedger(c) {
  const s = c.sup === 'all' ? SUPPLIERS[0].code : c.sup, L = ledger(s, LEDGER_FROM)
  return { kpis: [{ label: 'Opening', value: money(L.open) }, { label: 'Credit', value: money(sum(L.rows, e => e.cr)) }, { label: 'Debit', value: money(sum(L.rows, e => e.dr)) }, { label: 'Closing', value: money(L.close) }], tbl: ledgerTable(L, LEDGER_FROM), mw: 760 }
}
function rPayDetail(c) {
  const rows = []
  PAYS.filter(supFilter(c)).slice().sort((a, b) => a.date.localeCompare(b.date) || a.no.localeCompare(b.no)).forEach(p => p.lines.forEach(l => rows.push({ p, l })))
  const unclr = sum(PAYS.filter(p => p.giro && p.giro.due > TODAY && supFilter(c)(p)), p => sum(p.lines, l => l.pay))
  return { kpis: [{ label: 'Paid', value: money(sum(rows, r => r.l.pay)) }, { label: 'Vouchers', value: String(new Set(rows.map(r => r.p.no)).size) }, { label: 'Giro not cleared', value: mon(unclr) }],
    tbl: table({ cols: [{ l: 'Document', k: 'n', w: 170 }, { l: 'Supplier', k: 's', w: 170 }, { l: 'Voucher', k: 'v', w: 160 }, { l: 'Date', k: 'd', w: 110 }, { l: 'Account', k: 'a' }, { l: 'Paid', k: 'p', num: 1, w: 120 }, { l: 'Discount', k: 'x', num: 1, w: 100 }], rows: rows.map(({ p, l }) => ({ on: `buyOpenVch('${p.no}')`, c: { n: `<span class="nm">${l.doc}</span>`, s: `<span class="one">${esc(shortName(p.sup))}</span>`, v: p.no, d: day(p.date), a: `<span class="one">${esc(acctLabel(p))}</span>`, p: num(l.pay), x: z(l.disc) } })), foot: { n: 'Total', p: num(sum(rows, r => r.l.pay)), x: num(sum(rows, r => r.l.disc)) } }), mw: 1060 }
}
function rDpSum(c) {
  const ums = INV.filter(u => u.type === 'U' && supFilter(c)(u)), rows = []
  ums.forEach(u => {
    const apps = INV.filter(i => i.um.some(x => x.no === u.no)), ap = sum(apps, i => i.um.find(x => x.no === u.no).amt)
    rows.push({ on: `buyOpenDoc('${u.no}')`, c: { n: `<span class="nm">${u.no}</span> <span class="mute">· ${esc(shortName(u.sup))}</span>`, d: day(u.date), t: num(u.calc.grand), a: z(ap), r: z(u.calc.grand - ap) } })
    apps.forEach(i => rows.push({ cls: 'sub', on: `buyOpenDoc('${i.no}')`, c: { n: `<span class="ind">${i.no}</span>`, d: day(i.date), t: '', a: num(i.um.find(x => x.no === u.no).amt), r: '' } }))
  })
  const tot = sum(ums, u => u.calc.grand), ap = sum(ums, u => u.calc.grand - umLeft(u))
  return { kpis: [{ label: 'Down payments', value: money(tot) }, { label: 'Applied', value: money(ap) }, { label: 'Remaining', value: money(tot - ap) }],
    tbl: table({ cols: [{ l: 'Document', k: 'n' }, { l: 'Date', k: 'd', w: 120 }, { l: 'Total', k: 't', num: 1, w: 130 }, { l: 'Applied', k: 'a', num: 1, w: 130 }, { l: 'Remaining', k: 'r', num: 1, w: 130 }], rows, foot: { n: 'Total', t: num(tot), a: num(ap), r: num(tot - ap) }, empty: 'No down payment' }), mw: 700 }
}
function rDpOpen(c) {
  const ums = INV.filter(u => u.type === 'U' && umLeft(u) > 0 && supFilter(c)(u))
  return { kpis: [{ label: 'Open down payment', value: money(sum(ums, u => umLeft(u))) }, { label: 'Down payments', value: String(ums.length) }, { label: 'Oldest', value: ums.length ? `${Math.max(...ums.map(u => diffD(TODAY, u.date)))} days` : DASH }],
    tbl: table({ cols: [{ l: 'Down payment', k: 'n', w: 170 }, { l: 'Supplier', k: 's' }, { l: 'Date', k: 'd', w: 110 }, { l: 'PO no', k: 'p', w: 150 }, { l: 'Total', k: 't', num: 1, w: 120 }, { l: 'Applied', k: 'a', num: 1, w: 120 }, { l: 'Remaining', k: 'r', num: 1, w: 120 }], rows: ums.map(u => ({ on: `buyOpenDoc('${u.no}')`, c: { n: `<span class="nm">${u.no}</span>`, s: `<span class="one">${esc(supOf(u.sup).name)}</span>`, d: day(u.date), p: u.po ? esc(u.po) : DASH, t: num(u.calc.grand), a: z(u.calc.grand - umLeft(u)), r: num(umLeft(u)) } })), foot: { n: 'Total', t: num(sum(ums, u => u.calc.grand)), a: num(sum(ums, u => u.calc.grand - umLeft(u))), r: num(sum(ums, u => umLeft(u))) }, empty: 'No open down payment' }), mw: 900 }
}
const inPer = c => d => d.date >= PERIODS_R[c.period][1] && d.date <= PERIODS_R[c.period][2]
function rPSum(c) {
  const ds = INV.filter(d => inPer(c)(d) && supFilter(c)(d)).sort((a, b) => b.date.localeCompare(a.date))
  return { kpis: [{ label: 'Purchases', value: money(sum(ds, d => d.calc.grand)) }, { label: 'Invoices', value: String(ds.length) }, { label: 'Still owed', value: money(sum(ds, bal)) }],
    tbl: table({ cols: [{ l: 'Invoice', k: 'n', w: 170 }, { l: 'Date', k: 'd', w: 110 }, { l: 'Supplier', k: 's' }, { l: 'Type', k: 't', w: 130 }, { l: 'Total', k: 'g', num: 1, w: 130 }, { l: 'Status', k: 'st', w: 110 }], rows: ds.map(d => ({ on: `buyOpenDoc('${d.no}')`, c: { n: `<span class="nm">${d.no}</span>`, d: day(d.date), s: `<span class="one">${esc(supOf(d.sup).name)}</span>`, t: TYPE_L[d.type], g: num(d.calc.grand), st: stat(statusOf(d)) } })), foot: { n: 'Total', g: num(sum(ds, d => d.calc.grand)) }, empty: 'No invoice in this period' }), mw: 800 }
}
function rRSum(c) {
  const ds = RET.filter(d => inPer(c)(d) && supFilter(c)(d)).sort((a, b) => b.date.localeCompare(a.date))
  return { kpis: [{ label: 'Returned', value: money(sum(ds, d => d.calc.grand)) }, { label: 'Returns', value: String(ds.length) }, { label: 'Left to settle', value: mon(-sum(ds, bal)) }],
    tbl: table({ cols: [{ l: 'Return', k: 'n', w: 170 }, { l: 'Date', k: 'd', w: 110 }, { l: 'Supplier', k: 's' }, { l: 'Invoice', k: 'i', w: 160 }, { l: 'Amount', k: 'g', num: 1, w: 130 }, { l: 'Status', k: 'st', w: 110 }], rows: ds.map(d => ({ on: `buyOpenDoc('${d.no}')`, c: { n: `<span class="nm">${d.no}</span>`, d: day(d.date), s: `<span class="one">${esc(supOf(d.sup).name)}</span>`, i: d.src, g: num(d.amt), st: stat(statusOf(d)) } })), foot: { n: 'Total', g: num(sum(ds, d => d.amt)) }, empty: 'No return in this period' }), mw: 800 }
}
function rVat(c) {
  const ds = INV.filter(d => d.calc.tax > 0 && inPer(c)(d) && supFilter(c)(d)).sort((a, b) => b.date.localeCompare(a.date))
  return { kpis: [{ label: 'PPN input', value: money(sum(ds, d => d.calc.tax)) }, { label: 'Tax base', value: money(sum(ds, d => d.calc.net)) }, { label: 'Invoices', value: String(ds.length) }],
    tbl: table({ cols: [{ l: 'Invoice', k: 'n', w: 170 }, { l: 'Date', k: 'd', w: 110 }, { l: 'Supplier', k: 's' }, { l: 'Tax base', k: 'b', num: 1, w: 130 }, { l: 'PPN', k: 'v', num: 1, w: 120 }, { l: 'Total', k: 'g', num: 1, w: 130 }], rows: ds.map(d => ({ on: `buyOpenDoc('${d.no}')`, c: { n: `<span class="nm">${d.no}</span>`, d: day(d.date), s: `<span class="one">${esc(supOf(d.sup).name)}</span>`, b: num(d.calc.net), v: num(d.calc.tax), g: num(d.calc.grand) } })), foot: { n: 'Total', b: num(sum(ds, d => d.calc.net)), v: num(sum(ds, d => d.calc.tax)), g: num(sum(ds, d => d.calc.grand)) }, empty: 'No invoice with PPN in this period' }), mw: 800 }
}
function rSupList() {
  const rows = SUPPLIERS.map(s => ({ on: `go('buy-info')`, c: { n: `<span class="one">${esc(s.name)}</span>`, c: s.code, t: s.term, l: s.limit ? money(s.limit) : DASH, o: money(owedAt(s.code, TODAY)) } }))
  const total = sum(SUPPLIERS, s => owedAt(s.code, TODAY))
  return { kpis: [{ label: 'Suppliers', value: String(SUPPLIERS.length) }, { label: 'Payable', value: money(total) }, { label: 'Over limit', value: String(SUPPLIERS.filter(s => s.limit && owedAt(s.code, TODAY) > s.limit).length), bad: true }], tbl: table({ cols: [{ l: 'Supplier', k: 'n' }, { l: 'Code', k: 'c', w: 100 }, { l: 'Term', k: 't', w: 90 }, { l: 'Limit', k: 'l', num: 1, w: 140 }, { l: 'Payable', k: 'o', num: 1, w: 140 }], rows, foot: { n: 'Total', o: num(total) }, empty: 'No supplier' }), mw: 720 }
}
function rItemPurch(c) {
  const ds = INV.filter(d => inPer(c)(d) && supFilter(c)(d)), map = new Map()
  ds.forEach(d => d.lines.forEach(l => { const x = map.get(l.item) || { q: 0, v: 0 }; x.q += l.q; x.v += lineAmt(l); map.set(l.item, x) }))
  const rows = [...map.entries()].sort((a, b) => b[1].v - a[1].v).map(([n, x]) => ({ c: { n: esc(n), q: num(x.q), v: money(x.v) } }))
  return { kpis: [{ label: 'Items', value: String(rows.length) }, { label: 'Quantity', value: num(sum([...map.values()], x => x.q)) }, { label: 'Value', value: money(sum([...map.values()], x => x.v)) }], tbl: table({ cols: [{ l: 'Item', k: 'n' }, { l: 'Quantity', k: 'q', num: 1, w: 130 }, { l: 'Purchase value', k: 'v', num: 1, w: 170 }], rows, foot: { n: 'Total', q: num(sum([...map.values()], x => x.q)), v: money(sum([...map.values()], x => x.v)) }, empty: 'No purchase in this period' }), mw: 650 }
}
function rPoOpen(c) {
  const rows = []
  POS.filter(supFilter(c)).forEach(p => {
    const inv = INV.filter(i => i.po === p.no)
    p.lines.forEach((l, i) => { const q = sum(inv, x => (x.lines[i] || {}).q || 0); if (q < l.q) rows.push({ on: `go('buy-invoice')`, c: { p: p.no, n: esc(l.item), q: num(l.q), i: num(q), s: num(l.q - q), sup: `<span class="one">${esc(shortName(p.sup))}</span>` } }) })
  })
  return { kpis: [{ label: 'Open lines', value: String(rows.length) }, { label: 'PO', value: String(new Set(rows.map(r => r.c.p)).size) }, { label: 'Outstanding qty', value: num(sum(rows, r => +String(r.c.s).replace(/\./g, ''))) }], tbl: table({ cols: [{ l: 'PO', k: 'p', w: 160 }, { l: 'Supplier', k: 'sup', w: 190 }, { l: 'Item', k: 'n' }, { l: 'Ordered', k: 'q', num: 1, w: 100 }, { l: 'Invoiced', k: 'i', num: 1, w: 100 }, { l: 'Outstanding', k: 's', num: 1, w: 120 }], rows, empty: 'No open PO' }), mw: 820 }
}
function rPoSum(c) {
  const ps = POS.filter(p => inPer(c)(p) && supFilter(c)(p))
  const by = new Map(); ps.forEach(p => { const x = by.get(p.sup) || { n: 0, v: 0 }; x.n++; x.v += sum(p.lines, lineAmt); by.set(p.sup, x) })
  const rows = [...by.entries()].map(([s, x]) => ({ c: { s: `<span class="one">${esc(shortName(s))}</span>`, n: num(x.n), v: money(x.v) } }))
  return { kpis: [{ label: 'PO', value: String(ps.length) }, { label: 'Value', value: money(sum([...by.values()], x => x.v)) }], tbl: table({ cols: [{ l: 'Supplier', k: 's' }, { l: 'PO', k: 'n', num: 1, w: 100 }, { l: 'Ordered value', k: 'v', num: 1, w: 170 }], rows, foot: { s: 'Total', n: num(ps.length), v: money(sum([...by.values()], x => x.v)) }, empty: 'No PO in this period' }), mw: 650 }
}
function rItemDaily(c) {
  const rows = []
  INV.filter(d => inPer(c)(d) && supFilter(c)(d)).sort((a, b) => a.date.localeCompare(b.date)).forEach(d => d.lines.forEach(l => rows.push({ c: { d: day(d.date), n: d.no, i: esc(l.item), q: num(l.q), v: money(lineAmt(l)) } })))
  return { kpis: [{ label: 'Lines', value: String(rows.length) }, { label: 'Quantity', value: num(sum(rows, r => +String(r.c.q).replace(/\./g, ''))) }, { label: 'Value', value: money(sum(rows, r => +String(r.c.v).replace(/[^0-9-]/g, ''))) }], tbl: table({ cols: [{ l: 'Date', k: 'd', w: 100 }, { l: 'Invoice', k: 'n', w: 170 }, { l: 'Item', k: 'i' }, { l: 'Quantity', k: 'q', num: 1, w: 100 }, { l: 'Value', k: 'v', num: 1, w: 140 }], rows, empty: 'No purchase line' }), mw: 780 }
}
function rItemMonthly(c) {
  const by = new Map()
  INV.filter(d => inPer(c)(d) && supFilter(c)(d)).forEach(d => d.lines.forEach(l => { const k = d.date.slice(0, 7) + '|' + l.item; const x = by.get(k) || { m: d.date.slice(0, 7), n: l.item, q: 0, v: 0 }; x.q += l.q; x.v += lineAmt(l); by.set(k, x) }))
  const rows = [...by.values()].sort((a, b) => a.m.localeCompare(b.m) || b.v - a.v).map(x => ({ c: { m: x.m, i: esc(x.n), q: num(x.q), v: money(x.v) } }))
  return { kpis: [{ label: 'Rows', value: String(rows.length) }, { label: 'Value', value: money(sum([...by.values()], x => x.v)) }], tbl: table({ cols: [{ l: 'Month', k: 'm', w: 100 }, { l: 'Item', k: 'i' }, { l: 'Quantity', k: 'q', num: 1, w: 110 }, { l: 'Value', k: 'v', num: 1, w: 150 }], rows, empty: 'No purchase' }), mw: 650 }
}
function rItemSup(c) {
  const by = new Map()
  INV.filter(d => inPer(c)(d) && supFilter(c)(d)).forEach(d => d.lines.forEach(l => { const k = d.sup + '|' + l.item; const x = by.get(k) || { s: d.sup, n: l.item, q: 0, v: 0 }; x.q += l.q; x.v += lineAmt(l); by.set(k, x) }))
  const rows = [...by.values()].sort((a, b) => shortName(a.s).localeCompare(shortName(b.s)) || b.v - a.v).map(x => ({ c: { s: `<span class="one">${esc(shortName(x.s))}</span>`, i: esc(x.n), q: num(x.q), v: money(x.v) } }))
  return { kpis: [{ label: 'Rows', value: String(rows.length) }, { label: 'Value', value: money(sum([...by.values()], x => x.v)) }], tbl: table({ cols: [{ l: 'Supplier', k: 's' }, { l: 'Item', k: 'i' }, { l: 'Quantity', k: 'q', num: 1, w: 110 }, { l: 'Value', k: 'v', num: 1, w: 150 }], rows, empty: 'No purchase' }), mw: 720 }
}
function rGrnVal(c) {
  const ds = INV.filter(d => d.grn && inPer(c)(d) && supFilter(c)(d))
  const by = new Map(); ds.forEach(d => { const x = by.get(d.sup) || { n: 0, v: 0 }; x.n++; x.v += d.calc.net; by.set(d.sup, x) })
  const rows = [...by.entries()].map(([s, x]) => ({ c: { s: `<span class="one">${esc(shortName(s))}</span>`, n: num(x.n), v: money(x.v) } }))
  return { kpis: [{ label: 'Receipts', value: String(ds.length) }, { label: 'Value', value: money(sum(ds, d => d.calc.net)) }], tbl: table({ cols: [{ l: 'Supplier', k: 's' }, { l: 'Receipts', k: 'n', num: 1, w: 110 }, { l: 'Value', k: 'v', num: 1, w: 170 }], rows, foot: { s: 'Total', n: num(ds.length), v: money(sum(ds, d => d.calc.net)) }, empty: 'No receipt in this period' }), mw: 600 }
}
function rPriceList() {
  const rows = []
  Object.entries(CAT).forEach(([s, xs]) => xs.forEach(x => { if (x[0] !== 'Freight & handling') rows.push({ c: { s: `<span class="one">${esc(shortName(s))}</span>`, i: esc(x[0]), u: x[1], p: money(x[2]) } }) }))
  return { kpis: [{ label: 'Items', value: String(rows.length) }, { label: 'Suppliers', value: String(Object.keys(CAT).length) }], tbl: table({ cols: [{ l: 'Supplier', k: 's' }, { l: 'Item', k: 'i' }, { l: 'Unit', k: 'u', w: 90 }, { l: 'Price', k: 'p', num: 1, w: 140 }], rows, empty: 'No price' }), mw: 650 }
}
function rPriceHist(c) {
  const rows = []
  INV.filter(d => inPer(c)(d) && supFilter(c)(d)).sort((a, b) => b.date.localeCompare(a.date)).forEach(d => d.lines.forEach(l => rows.push({ c: { d: day(d.date), s: `<span class="one">${esc(shortName(d.sup))}</span>`, i: esc(l.item), p: money(l.p) } })))
  return { kpis: [{ label: 'Prices', value: String(rows.length) }], tbl: table({ cols: [{ l: 'Date', k: 'd', w: 110 }, { l: 'Supplier', k: 's' }, { l: 'Item', k: 'i' }, { l: 'Price', k: 'p', num: 1, w: 140 }], rows, empty: 'No price history' }), mw: 700 }
}
function rRetDet(c) {
  const rows = []
  RET.filter(d => inPer(c)(d) && supFilter(c)(d)).forEach(d => (d.calc?.lines || []).filter(l => l.q > 0).forEach(l => rows.push({ on: `buyOpenDoc('${d.no}')`, c: { n: d.no, d: day(d.date), i: esc(l.item), q: num(l.q), v: money(lineAmt(l)) } })))
  return { kpis: [{ label: 'Lines', value: String(rows.length) }, { label: 'Value', value: money(sum(rows, r => +String(r.c.v).replace(/[^0-9-]/g, ''))) }], tbl: table({ cols: [{ l: 'Return', k: 'n', w: 160 }, { l: 'Date', k: 'd', w: 100 }, { l: 'Item', k: 'i' }, { l: 'Quantity', k: 'q', num: 1, w: 100 }, { l: 'Value', k: 'v', num: 1, w: 140 }], rows, empty: 'No return line' }), mw: 700 }
}
const SUP_VIEWS = [['sup', 'Per supplier'], ['inv', 'Per invoice']]
const RPT = [
  { k: 'aging', g: 'Payables', l: 'Aging', basis: 1, views: SUP_VIEWS, build: rAging },
  { k: 'due', g: 'Payables', l: 'Due payables', asof: 1, supAll: 1, build: rDue },
  { k: 'remain', g: 'Payables', l: 'Remaining payable', asof: 1, views: [['sup', 'Per supplier'], ['inv', 'With invoices']], build: rRemain },
  { k: 'summary', g: 'Payables', l: 'Payable summary', period: 1, build: rSummary },
  { k: 'daily', g: 'Payables', l: 'Summary per date', period: 1, supAll: 1, build: rDaily },
  { k: 'ledger', g: 'Payables', l: 'Supplier ledger', sup1: 1, build: rLedger },
  { k: 'paydet', g: 'Payables', l: 'Payments of invoices', supAll: 1, build: rPayDetail },
  { k: 'dpsum', g: 'Down payment', l: 'Down payment summary', supAll: 1, build: rDpSum },
  { k: 'dpopen', g: 'Down payment', l: 'Down payment open', supAll: 1, build: rDpOpen },
  { k: 'psum', g: 'Purchases', l: 'Purchase summary', period: 1, supAll: 1, build: rPSum },
  { k: 'rsum', g: 'Purchases', l: 'Return summary', period: 1, supAll: 1, build: rRSum },
  { k: 'vat', g: 'Purchases', l: 'Purchase PPN', period: 1, supAll: 1, build: rVat },
  { k: 'suplist', g: 'Purchases', l: 'Supplier list', build: rSupList },
  { k: 'itempurch', g: 'Purchases', l: 'Item purchase', period: 1, supAll: 1, build: rItemPurch },
  { k: 'poopen', g: 'Purchases', l: 'PO outstanding', supAll: 1, build: rPoOpen },
  { k: 'posum', g: 'Purchases', l: 'PO summary', period: 1, supAll: 1, build: rPoSum },
  { k: 'itemdaily', g: 'Items', l: 'Item purchase daily', period: 1, supAll: 1, build: rItemDaily },
  { k: 'itemmonthly', g: 'Items', l: 'Item purchase monthly', period: 1, supAll: 1, build: rItemMonthly },
  { k: 'itemsup', g: 'Items', l: 'Item purchase by supplier', period: 1, supAll: 1, build: rItemSup },
  { k: 'grnval', g: 'Items', l: 'Goods received value', period: 1, supAll: 1, build: rGrnVal },
  { k: 'pricelist', g: 'Items', l: 'Price list', build: rPriceList },
  { k: 'pricehist', g: 'Items', l: 'Price history', period: 1, supAll: 1, build: rPriceHist },
  { k: 'retdet', g: 'Returns', l: 'Return detail', period: 1, supAll: 1, build: rRetDet },
]
function renderReports() {
  const id = 'buy-reports', r = RPT.find(x => x.k === filt(id, 'r', 'aging')) || RPT[0]
  const c = { asof: filt(id, 'asof', TODAY), period: filt(id, 'period', 'oct'), sup: filt(id, 'sup', 'all'), basis: filt(id, 'basis', 'inv'), view: filt(id, 'view', 'sup') }
  if (r.sup1 && c.sup === 'all') c.sup = SUPPLIERS[0].code
  const out = r.build(c)
  const supSel = (r.supAll || r.sup1) ? `<label class="ctl-l">Supplier <select class="ctl" onchange="setFilt('${id}','sup',this.value)">${[...(r.sup1 ? [] : [['all', 'All suppliers']]), ...SUPPLIERS.map(s => [s.code, s.name])].map(([v, l]) => `<option value="${esc(v)}" ${v === c.sup ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>` : ''
  const parts = [
    r.asof ? `<label class="ctl-l">As of <input type="date" class="ctl" value="${c.asof}" onchange="setFilt('${id}','asof',this.value||'${TODAY}')"></label>` : '',
    r.period ? chips(id, 'period', Object.entries(PERIODS_R).map(([k, v]) => [k, v[0]]), 'oct') : '',
    r.basis ? chips(id, 'basis', [['inv', 'Invoice age'], ['due', 'Past due']], 'inv') : '',
    r.views ? chips(id, 'view', r.views, 'sup') : '',
    supSel,
  ].filter(Boolean)
  const groups = [...new Set(RPT.map(x => x.g))]
  const picker = groups.map(g => `<span class="nav-label">${g}</span>${RPT.filter(x => x.g === g).map(x => `<button class="nav-row-btn ${x.k === r.k ? 'on' : ''}" type="button" onclick="setFilt('${id}','r','${x.k}')"><span>${x.l}</span></button>`).join('')}`).join('')
  return page({
    title: 'Payables reports', actions: [{ label: 'Print', icon: 'printer', on: "printPage('Payables reports')" }, { label: 'Export', icon: 'download', on: "nativeExport('payables-report')", kind: 'secondary' }],
    body: `<div class="rp-wrap"><div class="rp-pick">${picker}</div><div><h2 class="ds-title" style="margin:0 0 16px">${r.l}</h2>${kpisHTML(out.kpis)}${parts.length ? bar(...parts) : ''}<div class="rp-scroll" style="--mw:${out.mw || 720}px">${out.tbl}</div></div></div>`,
  })
}
reg({ id: 'buy-reports', group: 'report', label: 'Payables reports', render: renderReports })
})()
