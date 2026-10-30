;(() => {
/* ═════════ General ledger + accounting reports ═════════
   One demo ledger for October 2026 (September closed). Every screen below reads the same journals J. */
try {
  const st = document.createElement('style')
  st.textContent = `
.gl-wide{min-width:1000px}
.gl td{overflow:hidden;text-overflow:ellipsis}
.gl-car{display:inline-grid;place-items:center;width:18px;height:18px;margin-right:6px;vertical-align:middle;color:var(--line-ico);transition:rotate var(--t-hover) var(--ease-out)}
.gl-car.on{rotate:90deg}
.gl-nocar{display:inline-block;width:24px}
.tbl tr.gl-sub td{background:var(--soft);font-weight:500}
.tbl tr.gl-key td{background:var(--band);font-weight:600}
.gl-err{color:var(--bad-fg)}
.gl-ok{color:var(--ok-fg)}
.gl-split{display:grid;grid-template-columns:240px minmax(0,1fr);gap:24px;align-items:start}
.gl-pick{position:sticky;top:73px;max-height:calc(100vh - 90px);overflow:auto;padding-bottom:8px}
.gl-pick .nav-label{margin-left:0}
.gl-pick .nav-row-btn{height:auto;min-height:34px;padding-top:6px;padding-bottom:6px;line-height:20px}
.gl-in{width:100%;height:36px;padding:0 10px;border:1px solid var(--hairline-2);border-radius:var(--r-inner);background:var(--canvas);font:inherit;color:var(--ink)}
.gl-in:focus{outline:0;border-color:var(--accent);box-shadow:var(--shadow-focus)}
.gl-in.num{text-align:right;font-variant-numeric:tabular-nums}
.gl-foot{position:sticky;bottom:0;z-index:5;display:flex;align-items:center;justify-content:space-between;gap:16px;min-height:64px;margin-top:24px;background:var(--canvas);border-top:1px solid var(--hairline)}
.gl-checks{display:grid;grid-template-columns:1fr 1fr;gap:4px 32px}
.gl-check{display:flex;align-items:center;gap:10px;min-height:32px}
.gl-check .ds-ico{flex:none;color:var(--ok-fg)}
.gl-check.bad .ds-ico{color:var(--bad-fg)}
.gl-check span.fig{margin-left:auto;color:var(--body);font-variant-numeric:tabular-nums;white-space:nowrap}
.gl-vrow{display:flex;align-items:center;gap:20px;min-height:64px;border-bottom:1px solid var(--hairline)}
.gl-vrow .t{flex:1;font-weight:500}
.gl-vrow .r{flex:1}
.gl-list{margin:0;padding-left:22px;line-height:28px}
.gl-acts{display:flex;gap:8px;flex-wrap:wrap}
.gl-tick{display:inline-grid;place-items:center;width:18px;height:18px;border-radius:5px;background:var(--accent);color:var(--on-dark)}
.gl-tick.off{background:var(--canvas);border:1px solid var(--hairline-strong)}
.gl-selrow td{background:var(--accent-bg)}
.gl-note{margin:0 0 16px;color:var(--body)}
`
  document.head.appendChild(st)
} catch (e) { /* headless */ }

const L = LOC_CODES
const OCT1 = '2026-10-01', OCT31 = '2026-10-31', SEP30 = '2026-09-30'
const OPEN_PERIOD = 'Oct 2026'
const U4 = ['HO', 'C001', 'C002', 'C003']
const SHOPS = ['C001', 'C002', 'C003']
const pad3 = n => String(n).padStart(3, '0')
const aff = (p7, loc) => p7 + pad3(L.indexOf(loc) + 1)
const r10k = n => Math.round(n / 10000) * 10000
const numOf = s => parseInt(String(s).replace(/\D/g, ''), 10) || 0
const SRC = { PJ: 'Sales', PB: 'Purchases', INV: 'Stock', TRF: 'Transfers', BKM: 'Cash in', BKK: 'Cash out', GL: 'Manual' }
const name12 = (a, l) => accName(a) + ' ' + l
const pct = x => (x * 100).toFixed(1).replace('.', ',') + '%'
const credNormal = b => /^[234]/.test(b) || b.startsWith('8010')
const nat = b => (credNormal(b) ? -1 : 1)
const mute = s => `<span class="mute">${s}</span>`

/* ═════════ asset master (feeds the Depreciation button) ═════════ */
const ASSETS = [
  { id: 'FA-0001', name: 'Bangunan Utama', loc: 'HO', asset: '1021502001', dep: '7010210001', acc: '1021602001', cost: 3000000000, rate: 5, accum: 1150000000, method: 'Straight line' },
  { id: 'FA-0014', name: 'FFE Toko dan Gudang', loc: 'C001', asset: '1021506002', dep: '7010214002', acc: '1021606002', cost: 410000000, rate: 18, accum: 184500000, method: 'Straight line' },
  { id: 'FA-0015', name: 'FFE Toko dan Gudang', loc: 'C002', asset: '1021506002', dep: '7010214002', acc: '1021606002', cost: 352000000, rate: 18, accum: 158400000, method: 'Straight line' },
  { id: 'FA-0016', name: 'FFE Toko dan Gudang', loc: 'C003', asset: '1021506002', dep: '7010214002', acc: '1021606002', cost: 290000000, rate: 18, accum: 130500000, method: 'Straight line' },
  { id: 'FA-0031', name: 'Seventh Soft Application', loc: 'HO', asset: '1021701001', dep: '7010216001', acc: '1021702001', cost: 150000000, rate: 20, accum: 77500000, method: 'Straight line' },
]
const monthly = a => Math.round(a.cost * a.rate / 100 / 12 / 1000) * 1000

/* ═════════ opening balances = September closing. debit +, credit −. Each unit's books balance on their own. ═════════ */
const O = []
const o = (b, l, v) => O.push([b, l, v])
o('1011001001', 'HO', 18400000); o('1011001002', 'HO', 3250000); o('1011001003', 'HO', 1500000)
o('1011002001', 'HO', 1284750400); o('1011002002', 'HO', 412300000); o('1011003001', 'HO', 96500000)
o('1011201001', 'HO', 1386300000)
o('2012001001', 'HO', -214200000); o('2012002001', 'HO', -48600000); o('2012101001', 'HO', -7850000)
o('3013001001', 'HO', -2500000000)
o('6010210001', 'HO', 777600000); o('6010310004', 'HO', 2250000); o('8010110001', 'HO', -13020000)
ASSETS.forEach(a => { o(a.asset, a.loc, a.cost); o(a.acc, a.loc, -a.accum); o(a.dep, a.loc, 9 * monthly(a)) })
const RECV = { C001: 1520000000, C002: 1180000000, C003: 640000000 }      // shop's money held by head office
const GOODS = { C001: 612400000, C002: 498700000, C003: 355200000 }       // goods head office moved to the shop
const SH = {
  C001: { cash: 21350000, kasir: 5000000, bca: 64300000, db: 18150000, cc: 9320000, stock: 1372600000, f: 1 },
  C002: { cash: 17900000, kasir: 5000000, bca: 41600000, db: 14200000, cc: 6800000, stock: 1108900000, f: 0.78 },
  C003: { cash: 14200000, kasir: 5000000, bca: 29800000, db: 9600000, cc: 4100000, stock: 842700000, f: 0.55 },
}
const RENT = { C001: 28500000, C002: 24000000 }
SHOPS.forEach(s => {
  const x = SH[s], f = x.f
  o('1011001001', s, x.cash); o('1011001003', s, x.kasir); o('1011002001', s, x.bca)
  o('1011101002', s, x.db); o('1011101001', s, x.cc); o('1011201001', s, x.stock)
  o(aff('1021401', 'HO'), s, RECV[s]); o(aff('2012301', s), 'HO', -RECV[s])
  o(aff('1021402', s), 'HO', GOODS[s]); o(aff('2012302', 'HO'), s, -GOODS[s])
  const tn = r10k(2612400000 * f), db = r10k(1745300000 * f), cc = r10k(702800000 * f)
  o('4010110001', s, -tn); o('4010111001', s, -db); o('4010112001', s, -cc)
  o('5010110001', s, r10k((tn + db + cc) * 0.47)); o('6010111001', s, r10k(372600000 * f))
  o('6010110002', s, r10k(21450000 * f)); o('6010310006', s, r10k(36000000 * f))
  if (RENT[s]) o('7010110003', s, RENT[s] * 9)
})
o('2012201007', 'C001', -4120000)
U4.forEach(u => { const s = O.filter(x => x[1] === u).reduce((t, x) => t + x[2], 0); o('3013001002', u, -s) })
const OPENMAP = new Map()
O.forEach(([b, l, v]) => { const c = acc12(b, l); OPENMAP.set(c, (OPENMAP.get(c) || 0) + v) })

/* ═════════ October journals ═════════ */
const J = []
const D = (b, l, v, m) => [b, l, v, 0, m]
const C = (b, l, v, m) => [b, l, 0, v, m]
const jr = (src, date, ref, note, ls, x = {}) => J.push({ src, date, ref, note, st: 'New', auto: src !== 'GL', lines: ls.map(([a, l, d, c, m]) => ({ a, l, d: d || 0, c: c || 0, memo: m || '' })), ...x })
const SALES = { C001: 0, C002: 0, C003: 0 }
const sale = (date, s, from, cash, db, cc) => {
  SALES[s] += cash + db + cc
  jr('PJ', date, 'Takings ' + s, `Takings ${from}`, [
    D('1011001001', s, cash, 'Cash'), D('1011101002', s, db, 'Debit card, EDC'), D('1011101001', s, cc, 'Credit card, EDC'),
    C('4010110001', s, cash), C('4010111001', s, db), C('4010112001', s, cc)])
}
const settle = (date, s, rdb, rcc) => {
  const fee = Math.round(rdb * 0.0015) + Math.round(rcc * 0.012)
  jr('BKM', date, 'EDC ' + s, 'EDC settlement, card sales received in the bank', [
    D('1011002001', s, rdb + rcc - fee, 'Bank BCA'), D('6010110002', s, fee, 'Card fees'),
    C('1011101002', s, rdb, 'Debit card'), C('1011101001', s, rcc, 'Credit card')])
}
const setoran = (date, s, v) => {
  jr('BKK', date, 'Deposit ' + s, 'Cash sent to head office', [D(aff('1021401', 'HO'), s, v, 'Owed by head office'), C('1011001001', s, v, 'Cash on hand')])
  jr('BKM', date, 'Deposit ' + s, 'Cash received from shop ' + s, [D('1011002001', 'HO', v, 'Bank BCA'), C(aff('2012301', s), 'HO', v, 'Owed to ' + s)])
}
const paidByHO = (date, s, ref, note, acct, v) => {
  jr('BKK', date, ref, note, [D(aff('2012301', s), 'HO', v, 'Owed to ' + s), C('1011002001', 'HO', v, 'Bank BCA')])
  jr('BKK', date, ref, note, [D(acct, s, v), C(aff('1021401', 'HO'), s, v, 'Owed by head office')])
}
const move = (date, s, v) => {
  jr('TRF', date, 'To ' + s, 'Goods sent to shop ' + s, [D(aff('1021402', s), 'HO', v, 'Due from ' + s), C('1011201001', 'HO', v, 'Stock out')])
  jr('TRF', date, 'From HO', 'Goods received from head office', [D('1011201001', s, v, 'Stock in'), C(aff('2012302', 'HO'), s, v, 'Due to head office')])
}
jr('GL', '2026-10-01', 'GL-26-09-00003', 'Reverse September accrual, electricity C001', [D('2012201007', 'C001', 4120000, 'Accrual reversed'), C('6010310006', 'C001', 4120000)])
paidByHO('2026-10-01', 'C001', 'Rent Oct', 'Shop rent October', '7010110003', RENT.C001)
paidByHO('2026-10-01', 'C002', 'Rent Oct', 'Shop rent October', '7010110003', RENT.C002)
move('2026-10-05', 'C001', 185400000)
jr('PB', '2026-10-06', 'GMS/10/0457', 'Garmen Mitra Sentosa, PT', [D('1011201001', 'HO', 312500000, 'Goods received'), C('2012001001', 'HO', 312500000)])
jr('BKK', '2026-10-06', 'PLN Sep', 'Electricity bill September, paid from shop cash', [D('6010310006', 'C001', 4205000), C('1011001001', 'C001', 4205000, 'Cash on hand')])
jr('GL', '2026-10-09', 'SO-0910', 'Stock count difference, shop C002', [D('8010110006', 'C002', 3480000, 'Stock count loss'), C('1011201001', 'C002', 3480000, 'Stock adjusted')])
move('2026-10-12', 'C002', 142600000)
jr('PB', '2026-10-13', 'SS-2210', 'Sepatu Sejahtera, CV', [D('1011201001', 'HO', 128400000, 'Goods received'), C('2012001001', 'HO', 128400000)])
jr('BKK', '2026-10-12', 'BG-0975221', 'Giro cleared by the bank', [D('2012002001', 'HO', 48600000, 'Giro cleared'), C('1011002001', 'HO', 48600000, 'Bank BCA')])
jr('BKK', '2026-10-14', 'TRF-4471', 'Garmen Mitra Sentosa, PT', [D('2012001001', 'HO', 150000000, 'Supplier paid'), C('1011002001', 'HO', 150000000, 'Bank BCA')])
sale('2026-10-15', 'C001', '1–15 Oct', 142350000, 96800000, 38250000)
sale('2026-10-15', 'C002', '1–15 Oct', 118700000, 71400000, 24900000)
move('2026-10-19', 'C003', 96800000)
settle('2026-10-19', 'C001', SH.C001.db + 96800000, SH.C001.cc + 38250000)
settle('2026-10-19', 'C002', SH.C002.db + 71400000, SH.C002.cc + 24900000)
jr('PB', '2026-10-20', 'AT-8841', 'CV Anugrah Textile', [D('1011201001', 'HO', 96250000, 'Goods received'), C('2012001001', 'HO', 96250000)])
jr('BKK', '2026-10-20', 'BG-0975244', 'Giro BG-0975244 to Sepatu Sejahtera, CV, due 3 Nov', [D('2012001001', 'HO', 76350000, 'Supplier paid by giro'), C('2012002001', 'HO', 76350000, 'Giro outstanding')], { giro: true })
jr('PB', '2026-10-22', 'GC-1190', 'PT Graha Clean, cleaning service', [D('6010310001', 'HO', 4200000), C('2012001003', 'HO', 4200000)])
setoran('2026-10-22', 'C001', 250000000)
setoran('2026-10-22', 'C002', 190000000)
jr('GL', '2026-10-26', 'ACR-1026', 'Accrue October electricity, shop C001', [D('6010310006', 'C001', 4380000), C('2012201007', 'C001', 4380000, 'Accrued')])
jr('BKM', '2026-10-26', 'BCA Oct', 'Bank interest', [D('1011002001', 'HO', 1482500, 'Bank BCA'), C('8010110001', 'HO', 1482500)])
jr('BKK', '2026-10-25', 'Payroll Oct', 'Payroll October, paid by head office', [
  D('6010210001', 'HO', 86400000), D(aff('2012301', 'C001'), 'HO', 41200000, 'Owed to C001'), D(aff('2012301', 'C002'), 'HO', 36800000, 'Owed to C002'), C('1011002001', 'HO', 164400000, 'Bank BCA'),
  D('6010111001', 'C001', 41200000), C(aff('1021401', 'HO'), 'C001', 41200000, 'Owed by head office'),
  D('6010111001', 'C002', 36800000), C(aff('1021401', 'HO'), 'C002', 36800000, 'Owed by head office')])
sale('2026-10-27', 'C001', '16–27 Oct', 161900000, 109250000, 44700000)
sale('2026-10-27', 'C002', '16–27 Oct', 133450000, 83600000, 29300000)
sale('2026-10-27', 'C003', '1–27 Oct', 96350000, 58900000, 21450000)
SHOPS.forEach(s => jr('INV', '2026-10-27', 'HPP ' + s, 'Cost of goods sold, October to date', [D('5010110001', s, Math.round(SALES[s] * 0.47 / 1000) * 1000), C('1011201001', s, Math.round(SALES[s] * 0.47 / 1000) * 1000)]))
jr('BKK', '2026-10-27', 'BCA fee', 'Bank administration fee', [D('6010310004', 'HO', 285000), C('1011002001', 'HO', 285000, 'Bank BCA')])
const depLines = () => ASSETS.flatMap(a => [D(a.dep, a.loc, monthly(a), a.name), C(a.acc, a.loc, monthly(a), a.name)])
jr('GL', '2026-10-27', 'FA-DEP-2610', 'Depreciation Oct 2026', depLines(), { auto: true })
jr('GL', '2026-10-27', 'FA-DEP-2610', 'Depreciation Oct 2026, entered twice', depLines().slice(0, 2), { st: 'Delete' })
J.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
const SEQ = {}
J.forEach(j => { SEQ[j.src] = (SEQ[j.src] || 0) + 1; j.no = `${j.src}-26-10-${String(SEQ[j.src]).padStart(5, '0')}` })
const nextGL = () => `GL-26-10-${String(Math.max(0, ...J.filter(j => j.src === 'GL').map(j => +j.no.slice(-5))) + 1).padStart(5, '0')}`

/* ═════════ the ledger, derived from J ═════════ */
let cache = null
const LN = () => cache || (cache = J.filter(j => j.st !== 'Delete').flatMap(j => j.lines.map(l => ({ jno: j.no, src: j.src, date: j.date, ref: j.ref, note: j.note, a: l.a, l: l.l, code: acc12(l.a, l.l), d: l.d, c: l.c, memo: l.memo }))))
/* book(from,to): per 12-digit account — opening before `from`, movement from..to */
function book(from, to) {
  const m = new Map()
  const get = c => { let x = m.get(c); if (!x) { x = { code: c, a: c.slice(0, 10), l: L[+c.slice(10)], open: 0, d: 0, c: 0 }; m.set(c, x) } return x }
  OPENMAP.forEach((v, c) => { get(c).open = v })
  LN().forEach(x => { const t = get(x.code); if (x.date < from) t.open += x.d - x.c; else if (x.date <= to) { t.d += x.d; t.c += x.c } })
  const rows = [...m.values()].sort((a, b) => (a.code < b.code ? -1 : 1))
  rows.forEach(t => { t.close = t.open + t.d - t.c })
  return rows
}
const active = t => t.open || t.d || t.c
const byBase = rows => { const m = new Map(); rows.forEach(t => m.set(t.a, (m.get(t.a) || 0) + t.close)); return m }
const sumD = ls => ls.reduce((t, x) => t + x.d, 0)
const sumC = ls => ls.reduce((t, x) => t + x.c, 0)
const jTotal = j => j.lines.reduce((t, l) => t + l.d, 0)

/* ═════════ periods (shared by Month end and the journal form) ═════════ */
const MONTHS_L = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const lastDay = m => [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m]
const mkPeriod = (m, open) => ({ name: `${MONTHS_L[m]} 2026`, from: `2026-${String(m + 1).padStart(2, '0')}-01`, to: `2026-${String(m + 1).padStart(2, '0')}-${lastDay(m)}`, made: `2026-${String(m + 1).padStart(2, '0')}-01`, open })
const PER = Array.from({ length: 10 }, (_, m) => mkPeriod(m, m === 9))
const periodOf = date => PER.find(p => date >= p.from && date <= p.to)

/* ═════════ shared bits ═════════ */
const scroll = h => h.replace('<div class="ds-table-card">', '<div class="ds-table-card" style="overflow-x:auto">')
function tbl2(m) {
  const h = table({ ...m, foot: null })
  const tf = m.foot.map(f => `<tr>${m.cols.map(c => `<td class="${c.num ? 'is-num' : ''}">${f[c.k] ?? ''}</td>`).join('')}</tr>`).join('')
  return h.replace('</table>', `<tfoot>${tf}</tfoot></table>`)
}
const sel = (opts, cur, on) => `<div class="sel"><select onchange="${on}">${opts.map(([v, l]) => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>${ico('chevron-down')}</div>`
const link = (label, on) => `<button class="ds-link" type="button" onclick="event.stopPropagation();${on}">${label}</button>`
const redIf = (v, html) => (v < 0 ? `<span class="late">${html}</span>` : html)
const FROMTO = { oct: [OCT1, OCT31], h1: [OCT1, '2026-10-15'], h2: ['2026-10-16', OCT31] }
const PCHIPS = [['oct', 'Oct 2026'], ['h1', '1–15 Oct'], ['h2', '16–31 Oct']]

/* ═════════ sheets ═════════ */
window.glAcct = (code, from = OCT1, to = OCT31) => {
  const a = code.slice(0, 10), l = L[+code.slice(10)], sg = nat(a)
  const ls = LN().filter(x => x.code === code)
  let open = (OPENMAP.get(code) || 0) + ls.filter(x => x.date < from).reduce((t, x) => t + x.d - x.c, 0)
  const mv = ls.filter(x => x.date >= from && x.date <= to).sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : x.jno < y.jno ? -1 : 1))
  const d = sumD(mv), c = sumC(mv); let run = open * sg
  const rows = [{ cls: 'opening', c: { date: '', src: '', no: '', note: 'Opening balance', d: '', c: '', bal: num(run) } }]
  mv.forEach(x => { run += (x.d - x.c) * sg; rows.push({ on: `glJrnl('${x.jno}')`, c: { date: dayS(x.date), src: x.src, no: x.jno, note: esc(x.memo || x.note), d: x.d ? num(x.d) : '', c: x.c ? num(x.c) : '', bal: num(run) } }) })
  const body = kpisHTML([{ label: 'Opening', value: money(open * sg) }, { label: 'Debit', value: money(d) }, { label: 'Credit', value: money(c) }, { label: 'Closing', value: money(run) }]) +
    `<div style="height:24px"></div>` + table({ tbl: 'gl', empty: 'No lines in this period', cols: [{ l: 'Date', k: 'date', w: 80 }, { l: 'Source', k: 'src', w: 80 }, { l: 'Journal no', k: 'no', w: 160 }, { l: 'Note', k: 'note' }, { l: 'Debit', k: 'd', num: 1, w: 130 }, { l: 'Credit', k: 'c', num: 1, w: 130 }, { l: 'Balance', k: 'bal', num: 1, w: 140 }], rows })
  openSheet({ crumb: ['Sub-ledger'], title: `${code} · ${esc(name12(a, l))}`, body })
}
window.glJrnl = no => {
  const j = J.find(x => x.no === no); if (!j) return
  const d = jTotal(j), p = periodOf(j.date)
  const facts = `<dl class="ds-facts" style="margin-bottom:24px">
    <div class="ds-fact"><dt>Date</dt><dd>${day(j.date)}${j.time ? ' ' + j.time : ''}</dd></div><div class="ds-fact"><dt>Period</dt><dd>${p ? p.name : DASH}</dd></div>
    <div class="ds-fact"><dt>Reference</dt><dd>${esc(j.ref) || DASH}</dd></div><div class="ds-fact"><dt>Automatic</dt><dd>${j.auto ? 'Yes' : 'No'}</dd></div>
    <div class="ds-fact ds-fact--wide"><dt>Note</dt><dd>${esc(j.note) || DASH}</dd></div></dl>`
  const rows = j.lines.map(l => ({ on: `glAcct('${acc12(l.a, l.l)}')`, c: { code: acc12(l.a, l.l), name: esc(name12(l.a, l.l)), memo: esc(l.memo), d: l.d ? num(l.d) : '', c: l.c ? num(l.c) : '' } }))
  const body = facts + table({ tbl: 'gl', cols: [{ l: 'Code', k: 'code', w: 130 }, { l: 'Account', k: 'name' }, { l: 'Memo', k: 'memo', w: 180 }, { l: 'Debit', k: 'd', num: 1, w: 130 }, { l: 'Credit', k: 'c', num: 1, w: 130 }], rows, foot: { name: 'Total', d: num(d), c: num(sumC(j.lines)) } })
  openSheet({ crumb: ['Journals'], title: j.no, pill: `<span class="ds-pill">${j.st}</span>`, body, foot: j.st === 'New' && !j.auto ? btn('Reverse entry', `glRev('${no}')`) : '' })
}

/* ═════════ gl-info: Accounting info ═════════ */
const dtIn = (k, v) => `<input type="date" class="gl-in" style="width:150px" value="${v}" onchange="setFilt('gl-info','${k}',this.value)">`
const bar2 = (n, ...p) => `<div class="ds-bar">${p.join('')}<span class="bar-spacer"></span><span class="bar-count">${plural(n, 'row')}</span>${btn('Refresh', 'render()')}${btn('Excel', "nativeExport('accounting-info')")}</div>`
const GS = { open: new Set(['1', '2', '3', '4', '5', '6', '7', '8']) }
window.glTog = code => { GS.open.has(code) ? GS.open.delete(code) : GS.open.add(code); render() }

function accountsTab() {
  const loc = filt('gl-info', 'loc', 'all'), show = filt('gl-info', 'show', 'bal'), q = S.q['gl-info'] || ''
  const aper = filt('gl-info', 'aper', 'oct')
  const bk = (aper === 'sep' ? book(OCT1, SEP30) : book(OCT1, OCT31)).filter(t => loc === 'all' || t.l === loc)
  const sg = t => nat(t.a)
  const mk = (code, name, t, lvl, extra = {}) => ({ code, name, lvl, open: t.open * 1, d: t.d, c: t.c, close: t.close * 1, ...extra })
  const bar1 = bar2(bk.filter(active).length, search('gl-info', 'Search code or name'), chips('gl-info', 'aper', [['oct', 'Oct 2026'], ['sep', 'Sep 2026']], 'oct'), chips('gl-info', 'loc', [['all', 'All units'], ...U4.map(u => [u, u])], 'all'), chips('gl-info', 'show', [['bal', 'With balance'], ['all', 'All accounts']], 'bal'))
  const cols = [{ l: 'Code', k: 'code', w: 140 }, { l: 'Account', k: 'name' }, { l: 'Opening', k: 'open', num: 1, w: 130 }, { l: 'Debit', k: 'd', num: 1, w: 130 }, { l: 'Credit', k: 'c', num: 1, w: 130 }, { l: 'Closing', k: 'close', num: 1, w: 140 }]
  const cell = (r, t, tag) => ({ open: num(t.open), d: t.d ? num(t.d) : '', c: t.c ? num(t.c) : '', close: num(t.close), ...tag })
  if (q) {
    const rows = bk.filter(t => active(t) && hit(q, t.code, name12(t.a, t.l))).map(t => ({ on: `glAcct('${t.code}')`, c: cell(0, { open: t.open * sg(t), d: t.d, c: t.c, close: t.close * sg(t) }, { code: t.code, name: esc(name12(t.a, t.l)) }) }))
    return bar1 + scroll(table({ tbl: 'gl gl-wide', cols, rows, empty: 'No account matches' }))
  }
  const node = new Map()
  const add = (k, t) => { const n = node.get(k) || { open: 0, d: 0, c: 0, close: 0 }; n.open += t.open * sg(t); n.d += t.d; n.c += t.c; n.close += t.close * sg(t); node.set(k, n) }
  bk.forEach(t => [1, 3, 5, 7, 10].forEach(n => add(t.a.slice(0, n), t)))
  const rows = [], vis = new Set()
  for (const [code, name] of COA) {
    const n = code.length; if (![1, 3, 5, 7, 10].includes(n)) continue
    const par = n === 1 ? null : code.slice(0, n === 3 ? 1 : n === 5 ? 3 : n === 7 ? 5 : 7)
    if (par && !(vis.has(par) && GS.open.has(par))) continue
    const t = node.get(code) || { open: 0, d: 0, c: 0, close: 0 }
    if (show === 'bal' && !active(t)) continue
    vis.add(code)
    const units = n === 10 ? bk.filter(x => x.a === code && active(x)) : []
    const kids = n < 10 || units.length
    const caret = kids ? `<span class="gl-car ${GS.open.has(code) ? 'on' : ''}">${ico('chevron-right', 'ds-ico--14')}</span>` : '<span class="gl-nocar"></span>'
    const pad = Math.max(0, [1, 3, 5, 7, 10].indexOf(n)) * 16
    rows.push({ cls: n <= 3 ? 'gl-sub' : '', on: kids ? `glTog('${code}')` : '', c: cell(0, t, { code: mute(code), name: `<span style="padding-left:${pad}px">${caret}${esc(name)}</span>` }) })
    if (n === 10 && GS.open.has(code)) units.forEach(u => rows.push({ on: `glAcct('${u.code}')`, c: cell(0, { open: u.open * sg(u), d: u.d, c: u.c, close: u.close * sg(u) }, { code: mute(u.code), name: `<span style="padding-left:${pad + 40}px">${esc(name12(u.a, u.l))}</span>` }) }))
  }
  return bar1 + scroll(table({ tbl: 'gl gl-wide', cols, rows, empty: 'No account with a balance' }))
}

function journalsTab() {
  const st = filt('gl-info', 'jst', 'all'), q = S.q['gl-info'] || '', all = filt('gl-info', 'jall', 'y') === 'y', f = filt('gl-info', 'jfrom', OCT1), t = filt('gl-info', 'jto', OCT31)
  const man = J.filter(j => j.src === 'GL')
  const ms = man.filter(j => (st === 'all' || j.st === st) && (all || (j.date >= f && j.date <= t)) && hit(q, j.no, j.ref, j.note))
  const rows = ms.map(j => ({
    on: `glJrnl('${j.no}')`, cls: j.st === 'Delete' ? 'mute' : '',
    c: { date: dayS(j.date), no: j.no, ref: esc(j.ref), note: esc(j.note), tot: num(jTotal(j)), per: (periodOf(j.date) || {}).name || DASH, st: j.st, auto: j.auto ? 'Y' : 'N' },
  }))
  return bar2(ms.length, `<label class="ds-check"><input type="checkbox" class="cb7" ${all ? 'checked' : ''} onchange="setFilt('gl-info','jall',this.checked?'y':'n')">All dates</label>`, all ? '' : dtIn('jfrom', f) + dtIn('jto', t), search('gl-info', 'Search journal, reference or note'), chips('gl-info', 'jst', [['all', 'All', man.length], ['New', 'New', man.filter(j => j.st === 'New').length], ['Delete', 'Delete', man.filter(j => j.st === 'Delete').length]], 'all')) +
    scroll(table({ tbl: 'gl gl-wide', empty: 'No journal', cols: [{ l: 'Date', k: 'date', w: 80 }, { l: 'Journal no', k: 'no', w: 160 }, { l: 'Reference', k: 'ref', w: 140 }, { l: 'Note', k: 'note' }, { l: 'Total', k: 'tot', num: 1, w: 130 }, { l: 'Period', k: 'per', w: 100 }, { l: 'Status', k: 'st', w: 80 }, { l: 'Auto', k: 'auto', w: 60 }], rows }))
}

function entriesTab() {
  const sr = filt('gl-info', 'src', 'all'), q = S.q['gl-info'] || '', f = filt('gl-info', 'efrom', OCT1), t = filt('gl-info', 'eto', OCT31)
  const all = LN().filter(x => x.date >= f && x.date <= t)
  const cnt = s => all.filter(x => x.src === s).length
  const ls = all.filter(x => (sr === 'all' || x.src === sr) && hit(q, x.jno, x.ref, x.note, x.code, name12(x.a, x.l), x.memo))
    .sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : x.jno < y.jno ? -1 : 0))
  const rows = ls.map(x => ({ on: `glJrnl('${x.jno}')`, c: { date: dayS(x.date), src: `<span title="${SRC[x.src]}">${x.src}</span>`, no: x.jno, ref: esc(x.ref), acct: `${mute(x.code)} ${esc(name12(x.a, x.l))}`, d: x.d ? num(x.d) : '', c: x.c ? num(x.c) : '', note: esc(x.memo || x.note) } }))
  return bar2(ls.length, `<span class="mute">From</span>`, dtIn('efrom', f), `<span class="mute">To</span>`, dtIn('eto', t), search('gl-info', 'Search journal, account or note'), chips('gl-info', 'src', [['all', 'All', all.length], ...Object.keys(SRC).map(k => [k, SRC[k], cnt(k)])], 'all')) +
    scroll(table({ tbl: 'gl gl-wide', empty: 'No entry', cols: [{ l: 'Date', k: 'date', w: 70 }, { l: 'Source', k: 'src', w: 70 }, { l: 'Journal no', k: 'no', w: 150 }, { l: 'Reference', k: 'ref', w: 130 }, { l: 'Account', k: 'acct' }, { l: 'Debit', k: 'd', num: 1, w: 120 }, { l: 'Credit', k: 'c', num: 1, w: 120 }, { l: 'Note', k: 'note', w: 190 }], rows, foot: { acct: 'Total', d: num(sumD(ls)), c: num(sumC(ls)) } }))
}

function subRows(from, to, a, b) {
  return book(from, to).filter(t => active(t) && t.code >= a && t.code <= b)
}
function subTab() {
  const per = filt('gl-info', 'sper', 'oct'), until = filt('gl-info', 'suntil', OCT31), f = FROMTO[per][0], t = FROMTO[per][1] < until ? FROMTO[per][1] : until
  const accts = book(OCT1, OCT31).filter(active)
  const opts = accts.map(x => [x.code, `${x.code} · ${name12(x.a, x.l)}`])
  const from = filt('gl-info', 'from', opts[0][0]), to = filt('gl-info', 'to', opts[opts.length - 1][0])
  const rs = subRows(f, t, from, to)
  const rows = rs.map(x => ({ on: `glAcct('${x.code}','${f}','${t}')`, c: { code: x.code, name: esc(name12(x.a, x.l)), open: num(x.open * nat(x.a)), d: num(x.d), c: num(x.c), close: num(x.close * nat(x.a)) } }))
  return bar2(rs.length, `<span class="mute">Account</span>`, sel(opts, from, "setFilt('gl-info','from',this.value)"), `<span class="mute">to</span>`, sel(opts, to, "setFilt('gl-info','to',this.value)"), chips('gl-info', 'sper', PCHIPS, 'oct'), `<span class="mute">Until</span>`, dtIn('suntil', until)) +
    scroll(table({ tbl: 'gl gl-wide', empty: 'No account in this range', cols: [{ l: 'Code', k: 'code', w: 140 }, { l: 'Account', k: 'name' }, { l: 'Opening', k: 'open', num: 1, w: 140 }, { l: 'Debit', k: 'd', num: 1, w: 140 }, { l: 'Credit', k: 'c', num: 1, w: 140 }, { l: 'Closing', k: 'close', num: 1, w: 150 }], rows, foot: { name: 'Total', open: num(rs.reduce((s, x) => s + x.open * nat(x.a), 0)), d: num(rs.reduce((s, x) => s + x.d, 0)), c: num(rs.reduce((s, x) => s + x.c, 0)), close: num(rs.reduce((s, x) => s + x.close * nat(x.a), 0)) } }))
}

const TBASOF = { '0930': ['30 Sep', SEP30], '1015': ['15 Oct', '2026-10-15'], '1027': ['27 Oct', TODAY] }
function tbTable(asof, q = '') {
  const rs = book(OCT1, asof).filter(t => t.close && hit(q, t.code, name12(t.a, t.l)))
  const dr = rs.filter(t => t.close > 0).reduce((s, t) => s + t.close, 0), cr = -rs.filter(t => t.close < 0).reduce((s, t) => s + t.close, 0)
  const rows = rs.map(t => ({ on: `glAcct('${t.code}','${OCT1}','${asof}')`, c: { code: t.code, name: esc(name12(t.a, t.l)), d: t.close > 0 ? num(t.close) : '', c: t.close < 0 ? num(-t.close) : '' } }))
  const diff = dr - cr
  return { dr, cr, diff, html: tbl2({ tbl: 'gl', empty: 'No balance', cols: [{ l: 'Code', k: 'code', w: 140 }, { l: 'Account', k: 'name' }, { l: 'Debit', k: 'd', num: 1, w: 150 }, { l: 'Credit', k: 'c', num: 1, w: 150 }], rows, foot: [{ name: 'Total debit · Total credit', d: num(dr), c: num(cr) }, { name: 'Difference', d: diff === 0 ? `${num(0)} ${ico('check', 'ds-ico--14')}` : `<span class="late">${num(diff)}</span>` }] }) }
}
function tbTab() {
  const d = filt('gl-info', 'tbd', TODAY), q = S.q['gl-info'] || '', t = tbTable(d, q)
  return bar2(book(OCT1, d).filter(x => x.close).length, `<span class="mute">Until</span>`, dtIn('tbd', d), chips('gl-info', 'tbd', Object.values(TBASOF).map(x => [x[1], x[0]]), TODAY), search('gl-info', 'Search code or name')) + t.html
}

reg({
  id: 'gl-info', group: 'gl', label: 'Accounting info',
  render() {
    const tab = tabOf('gl-info', 'accounts')
    const ls = LN(), td = sumD(ls), tc = sumC(ls)
    const man = J.filter(j => j.src === 'GL' && j.st === 'New').length
    const tabs = [['accounts', 'Accounts'], ['journals', 'Journals', J.filter(j => j.src === 'GL').length], ['entries', 'All entries', ls.length], ['sub', 'Sub-ledger'], ['tb', 'Trial balance']]
    const actions = tab === 'accounts' ? [{ label: 'New account', icon: 'plus', on: 'glNewAcc()' }] : tab === 'journals' ? [{ label: 'New journal', icon: 'plus', on: "go('gl-journal')" }] : []
    const body = tab === 'accounts' ? accountsTab() : tab === 'journals' ? journalsTab() : tab === 'entries' ? entriesTab() : tab === 'sub' ? subTab() : tbTab()
    return page({
      title: 'Accounting info', actions, tabs, tab,
      kpis: [{ label: 'Journals in October', value: String(J.filter(j => j.st === 'New').length) }, { label: 'Manual journals', value: String(man) }, { label: 'Total debit', value: money(td) }, { label: 'Debit less credit', value: money(td - tc), bad: td !== tc }],
      body,
    })
  },
})
window.glNewAcc = () => {
  const groups = COA.filter(c => c[0].length === 7)
  const next = '1011001004'
  openSheet({
    crumb: ['Accounting info'], title: 'New account', size: 'rail',
    body: `<div style="display:grid;gap:24px">
      ${field('Parent group', select(groups.map(g => [g[0], `${g[0]} · ${g[1]}`]), '1011001'))}
      ${field('Account code', input(next))}
      ${field('Account name', input('', false, 'e.g. Petty Cash Shop'))}
      ${field('Type', select([['cash', 'Cash / bank'], ['general', 'General'], ['recv', 'Receivable'], ['pay', 'Payable']], 'cash'))}
      ${field('Normal balance', select(['Debit', 'Credit'], 'Debit'))}
      ${field('Units', select([['all', 'All units'], ...U4.map(u => [u, u])], 'all'))}</div>`,
    foot: btn('Save account', "closeSheet();soon('Account saved')"),
  })
}

/* ═════════ gl-journal: Journal entry ═════════ */
const blankLine = () => ({ acc: '', loc: 'HO', memo: '', d: 0, c: 0 })
const JF = { date: TODAY, time: '12:00', ref: '', note: 'Accrue October telephone, head office', auto: false, depWarn: '', lines: [{ acc: '6010310005', loc: 'HO', memo: '', d: 3150000, c: 0 }, { acc: '2012201006', loc: 'HO', memo: 'Accrued', d: 0, c: 3150000 }] }
const BASES = COA.filter(c => c[0].length === 10)
function resolveAcc(t) {
  t = String(t).trim(); const m = t.match(/^\d{10}/)
  if (m && COA_NAME[m[0]]) return m[0]
  const q = t.toLowerCase(); if (q.length < 3) return ''
  const h = BASES.find(([, n]) => n.toLowerCase() === q) || BASES.find(([, n]) => n.toLowerCase().includes(q))
  return h ? h[0] : ''
}
function jfIssue() {
  const ls = JF.lines.filter(l => l.d || l.c)
  const td = JF.lines.reduce((s, l) => s + l.d, 0), tc = JF.lines.reduce((s, l) => s + l.c, 0), diff = td - tc
  const p = periodOf(JF.date)
  let why = ''
  if (!p || !p.open) why = p ? `${p.name} is closed` : 'The date is outside an open period'
  else if (diff !== 0) why = `Difference ${money(Math.abs(diff))}: debit and credit must match`
  else if (ls.some(l => !l.acc)) why = 'Pick an account on every line'
  return { td, tc, diff, p, why, ok: !why && ls.length >= 2 && td > 0 }
}
function jfCalc() {
  const x = jfIssue(), g = id => document.getElementById(id)
  if (!g('jf-d')) return
  g('jf-d').textContent = money(x.td); g('jf-c').textContent = money(x.tc)
  g('jf-diff').textContent = money(x.diff); g('jf-diff').classList.toggle('is-bad', x.diff !== 0)
  g('jf-why').textContent = x.why
  g('jf-per').value = x.p ? x.p.name : ''
  g('jf-post').classList.toggle('is-disabled', !x.ok)
}
window.jfHdr = (k, v) => { JF[k] = v; jfCalc() }
window.jfDT = v => { const [d, t] = String(v).split('T'); JF.date = d || ''; JF.time = t || JF.time; jfCalc() }
window.jfClear = () => { JF.lines = [blankLine(), blankLine()]; JF.depWarn = ''; render() }
window.jfDiscard = () => { JF.ref = ''; JF.note = ''; JF.auto = false; JF.depWarn = ''; JF.date = TODAY; JF.time = '12:00'; JF.lines = [blankLine(), blankLine()]; render(); toast('Draft discarded') }
window.jfJournals = () => { S.tab['gl-info'] = 'journals'; go('gl-info') }
window.jfLine = (i, k, v) => {
  const l = JF.lines[i]
  if (k === 'acc') { l.acc = resolveAcc(v); const n = document.getElementById('jf-n' + i); if (n) n.innerHTML = l.acc ? `${mute(acc12(l.acc, l.loc))} ${esc(accName(l.acc))}` : (v ? '<span class="late">Not in the chart</span>' : ''); }
  else if (k === 'loc') { l.loc = v; const n = document.getElementById('jf-n' + i); if (n && l.acc) n.innerHTML = `${mute(acc12(l.acc, l.loc))} ${esc(accName(l.acc))}` }
  else if (k === 'memo') l.memo = v
  else { l[k] = numOf(v); const o = k === 'd' ? 'c' : 'd'; if (l[k] > 0 && l[o]) { l[o] = 0; const e = document.getElementById(`jf-${o}${i}`); if (e) e.value = '' } }
  jfCalc()
}
window.jfFmt = (el, i, k) => { el.value = JF.lines[i][k] ? dots(JF.lines[i][k]) : '' }
window.jfAcc = (el, i) => { jfLine(i, 'acc', el.value); if (JF.lines[i].acc) el.value = JF.lines[i].acc }
window.jfAdd = () => { JF.lines.push(blankLine()); render() }
window.jfDel = i => { JF.lines.splice(i, 1); if (!JF.lines.length) JF.lines.push(blankLine()); render() }
window.jfDep = () => {
  const dup = J.find(j => j.st === 'New' && j.note === 'Depreciation Oct 2026')
  JF.lines = ASSETS.flatMap(a => [{ acc: a.dep, loc: a.loc, memo: a.name, d: monthly(a), c: 0 }, { acc: a.acc, loc: a.loc, memo: a.name, d: 0, c: monthly(a) }])
  JF.note = 'Depreciation Oct 2026'; JF.ref = 'FA-DEP-2610'; JF.auto = true; JF.depWarn = dup ? dup.no : ''
  render(); toast('Depreciation filled', `${ASSETS.length} assets from the asset master`)
}
window.glRev = no => {
  const j = J.find(x => x.no === no); if (!j) return
  while (S.stack.length) S.stack.pop(); renderLayers()
  JF.lines = j.lines.map(l => ({ acc: l.a, loc: l.l, memo: l.memo, d: l.c, c: l.d }))
  JF.note = `Reversal of ${j.no}, ${j.note}`; JF.ref = j.no; JF.date = TODAY; JF.auto = false; JF.depWarn = ''
  go('gl-journal')
}
window.jfRevPick = () => {
  const rows = J.filter(j => j.src === 'GL' && j.st === 'New' && !j.auto).map(j => ({ on: `glRev('${j.no}')`, c: { date: dayS(j.date), no: j.no, note: esc(j.note), tot: num(jTotal(j)) } }))
  openSheet({ crumb: ['Journal entry'], title: 'Reverse entry', body: table({ tbl: 'gl', cols: [{ l: 'Date', k: 'date', w: 80 }, { l: 'Journal no', k: 'no', w: 160 }, { l: 'Note', k: 'note' }, { l: 'Total', k: 'tot', num: 1, w: 130 }], rows, empty: 'No manual journal to reverse' }) })
}
window.jfPost = () => {
  const x = jfIssue(); if (!x.ok) return
  const ls = JF.lines.filter(l => l.d || l.c)
  const no = nextGL()
  J.push({ no, src: 'GL', date: JF.date, time: JF.time, ref: JF.ref, note: JF.note, st: 'New', auto: JF.auto, lines: ls.map(l => ({ a: l.acc, l: l.loc, d: l.d, c: l.c, memo: l.memo })) })
  cache = null
  JF.ref = ''; JF.note = ''; JF.auto = false; JF.depWarn = ''; JF.date = TODAY; JF.time = '12:00'; JF.lines = [blankLine(), blankLine()]
  render(); toast(`${no} posted`, `${money(x.td)} in ${plural(ls.length, 'line')}`)
}
addEventListener('keydown', ev => { if ((ev.metaKey || ev.ctrlKey) && ev.key === 'Enter' && S.id === 'gl-journal') { ev.preventDefault(); jfPost() } })

reg({
  id: 'gl-journal', group: 'gl', label: 'Journal entry',
  render() {
    const x = jfIssue()
    const lines = JF.lines.map((l, i) => ({
      c: {
        n: String(i + 1),
        acc: `<input class="gl-in" list="jf-coa" value="${esc(l.acc)}" placeholder="Code or name" onchange="jfAcc(this,${i})">`,
        nm: `<span id="jf-n${i}">${l.acc ? `${mute(acc12(l.acc, l.loc))} ${esc(accName(l.acc))}` : ''}</span>`,
        loc: `<select class="gl-in" onchange="jfLine(${i},'loc',this.value)">${LOCS.map(([c]) => `<option ${c === l.loc ? 'selected' : ''}>${c}</option>`).join('')}</select>`,
        memo: `<input class="gl-in" value="${esc(l.memo)}" oninput="jfLine(${i},'memo',this.value)">`,
        d: `<input class="gl-in num" id="jf-d${i}" inputmode="numeric" value="${l.d ? dots(l.d) : ''}" oninput="jfLine(${i},'d',this.value)" onchange="jfFmt(this,${i},'d')">`,
        c: `<input class="gl-in num" id="jf-c${i}" inputmode="numeric" value="${l.c ? dots(l.c) : ''}" oninput="jfLine(${i},'c',this.value)" onchange="jfFmt(this,${i},'c')">`,
        x: `<button class="ds-btn ds-btn--quiet ds-btn--icon" type="button" aria-label="Remove line" onclick="jfDel(${i})">${ico('trash')}</button>`,
      },
    }))
    const hdr = `<div class="form-grid">
      ${field('Journal no', input(nextGL(), true))}
      ${field('Date and time', `<input type="datetime-local" value="${JF.date}T${JF.time}" onchange="jfDT(this.value)">`)}
      ${field('Reference', `<input value="${esc(JF.ref)}" oninput="jfHdr('ref',this.value)">`)}
      ${field('Accounting period', `<input id="jf-per" value="${x.p ? x.p.name : ''}" readonly>`)}
      ${field('Note', `<input value="${esc(JF.note)}" oninput="jfHdr('note',this.value)">`, 'span2')}
      ${field('Automatic', input(JF.auto ? 'Yes' : 'No', true))}
      ${field('Status', input('New', true))}</div>`
    const secRight = `${JF.depWarn ? `<span class="late">Depreciation Oct 2026 is already posted as ${JF.depWarn}</span>` : ''}${link('Add line', 'jfAdd()')}${link('Delete all lines', 'jfClear()')}${link('Reverse entry', 'jfRevPick()')}${link('Discard draft', 'jfDiscard()')}${link('Print', "soon('Print')")}${link('Journals', 'jfJournals()')}`
    const strip = `<div class="ds-kpis kpis" style="margin:24px 0 0"><div class="ds-kpi"><div class="ds-kpi-label">Total debit</div><div class="ds-kpi-value" id="jf-d">${money(x.td)}</div></div>
      <div class="ds-kpi"><div class="ds-kpi-label">Total credit</div><div class="ds-kpi-value" id="jf-c">${money(x.tc)}</div></div>
      <div class="ds-kpi"><div class="ds-kpi-label">Difference</div><div class="ds-kpi-value ${x.diff !== 0 ? 'is-bad' : ''}" id="jf-diff">${money(x.diff)}</div></div></div>`
    const body = hdr +
      `<div class="sec-head" style="gap:20px"><h3 class="ds-section-title">Lines <span class="mute">${JF.lines.length}</span></h3><span style="display:flex;gap:20px;align-items:center">${secRight}</span></div>` +
      table({ tbl: 'gl', cols: [{ l: '#', k: 'n', w: 40 }, { l: 'Account', k: 'acc', w: 150 }, { l: 'Name', k: 'nm' }, { l: 'Unit', k: 'loc', w: 100 }, { l: 'Memo', k: 'memo', w: 170 }, { l: 'Debit', k: 'd', num: 1, w: 140 }, { l: 'Credit', k: 'c', num: 1, w: 140 }, { l: '', k: 'x', w: 48 }], rows: lines }) +
      `<datalist id="jf-coa">${BASES.map(([c, n]) => `<option value="${c}">${esc(n)}</option>`).join('')}</datalist>` + strip +
      `<div class="gl-foot"><span class="late" id="jf-why">${esc(x.why)}</span><button id="jf-post" class="ds-btn ds-btn--primary ${x.ok ? '' : 'is-disabled'}" type="button" onclick="jfPost()">Post</button></div>`
    return page({ title: 'Journal entry', actions: [{ label: 'Depreciation', on: 'jfDep()' }, { label: 'Del All', on: 'jfClear()', kind: 'secondary' }, { label: 'Print', on: "printPage('Journal entry')", kind: 'secondary', icon: 'printer' }], body })
  },
})

/* ═════════ gl-closing: Month end ═════════ */
const CS = { sel: OPEN_PERIOD, tests: {}, ignore: false, rp: OPEN_PERIOD }
const sp = () => PER.find(p => p.name === CS.sel) || PER[PER.length - 1]
function findings(kind) {
  const giros = J.filter(j => j.giro && j.st === 'New')
  const girosOut = giros.map(j => ({ doc: j.no, detail: j.note, amt: jTotal(j) }))
  const unbal = J.filter(j => j.st === 'New' && j.lines.reduce((t, l) => t + l.d - l.c, 0) !== 0).map(j => ({ doc: j.no, detail: j.note, amt: Math.abs(j.lines.reduce((t, l) => t + l.d - l.c, 0)) }))
  const unitBad = U4.map(u => ({ u, v: book(OCT1, OCT31).filter(t => t.l === u).reduce((s, t) => s + t.close, 0) })).filter(x => x.v !== 0).map(x => ({ doc: x.u, detail: 'Unit books do not balance', amt: Math.abs(x.v) }))
  const abnormal = book(OCT1, OCT31).filter(t => t.close && ((/^1/.test(t.a) && !/^10(216|1702)/.test(t.a) && t.close < 0) || (/^2/.test(t.a) && t.close > 0))).map(t => ({ doc: t.code, detail: name12(t.a, t.l), amt: Math.abs(t.close) }))
  if (kind === 'trx') return [
    { name: 'Voucher without a period', items: [{ doc: 'BKK-26-11-00001', detail: 'Dated 1 Nov 2026, no open period', amt: 12500000 }] },
    { name: 'Giro not cleared at period end', items: girosOut },
    { name: 'Goods received, no supplier invoice', items: [{ doc: 'GR-26-10-00418', detail: 'Garmen Mitra Sentosa, PT', amt: 88400000 }, { doc: 'GR-26-10-00431', detail: 'Sumber Komputer', amt: 8374200 }] },
    { name: 'Shop takings not posted', items: [] },
  ]
  return [
    { name: 'Journal out of balance', items: [...unbal, { doc: 'Draft, prepaid insurance', detail: 'Draft journal, not posted', amt: 250000 }] },
    { name: 'Unit books not balanced', items: unitBad },
    { name: 'Account with an unusual balance', items: abnormal },
    { name: 'Posting to a group account', items: [] },
  ]
}
const probCount = () => Object.values(CS.tests).reduce((s, t) => s + (t ? t.reduce((a, c) => a + c.items.length, 0) : 0), 0)
function closeIssue() {
  const p = sp()
  if (!p.open) return `${p.name} is already closed`
  if (!CS.tests.trx || !CS.tests.acc) return 'Run both validations first'
  if (probCount() > 0 && !CS.ignore) return 'Tick Ignore validation to close with problems'
  return ''
}
window.glSelPer = n => { CS.sel = n; CS.tests = {}; CS.ignore = false; render() }
window.glTest = k => { CS.tests[k] = findings(k); const n = CS.tests[k].reduce((a, c) => a + c.items.length, 0); render(); toast(n ? `${plural(n, 'problem')} found` : 'No problem found', k === 'trx' ? 'Validate transactions' : 'Validate accounting') }
window.glView = k => {
  const rows = []
  CS.tests[k].filter(c => c.items.length).forEach(c => { rows.push({ group: `${esc(c.name)} · ${c.items.length}` }); c.items.forEach(i => rows.push({ c: { doc: esc(i.doc), detail: esc(i.detail), amt: num(i.amt) } })) })
  openSheet({ crumb: ['Month end'], title: k === 'trx' ? 'Transaction problems' : 'Accounting problems', body: table({ tbl: 'gl', cols: [{ l: 'Document', k: 'doc', w: 200 }, { l: 'Detail', k: 'detail' }, { l: 'Amount', k: 'amt', num: 1, w: 140 }], rows, empty: 'No problem' }) })
}
window.glSaldo = () => { CS.saldo = true; render(); toast('Opening balance processed', 'Into the opening balance sheet') }
window.glIgn = v => { CS.ignore = v; render() }
const lockList = p => `<ul class="gl-list"><li>New transactions dated in ${p.name} are refused</li><li>Giro can no longer be cleared in ${p.name}</li><li>Reprocess needs Undo closing first</li><li>Closing balances become the opening balances of the next period</li></ul>`
window.glClosing = () => {
  const why = closeIssue(); if (why) return
  const p = sp(), n = probCount()
  openSheet({ crumb: ['Month end'], title: `Close ${p.name}`, size: 'rail', body: (n ? `<p class="late" style="margin:0 0 16px">${plural(n, 'problem')} ignored</p>` : '') + lockList(p), foot: btn(`Close ${p.name}`, 'glDoClose()') })
}
window.glDoClose = () => { const p = sp(); p.open = false; CS.tests = {}; CS.ignore = false; closeSheet(); render(); toast(`${p.name} closed`, 'Balances carried to the next period') }
window.glUndo = () => {
  const p = sp(); if (p.open) return
  openSheet({ crumb: ['Month end'], title: `Undo closing of ${p.name}`, size: 'rail', body: `<ul class="gl-list"><li>${p.name} is open for transactions again</li><li>Reprocess becomes possible</li><li>Periods after it must be closed again</li></ul>`, foot: btn(`Undo closing of ${p.name}`, 'glDoUndo()') })
}
window.glDoUndo = () => { const p = sp(); p.open = true; closeSheet(); render(); toast(`${p.name} is open again`) }
window.glCreate = () => {
  const last = PER[PER.length - 1]
  if (last.open) { toast(`Close ${last.name} first`); return }
  const m = PER.length; if (m > 11) { toast('The year has no more months'); return }
  PER.push({ ...mkPeriod(m, true), made: TODAY }); CS.sel = PER[m].name; render(); toast(`${PER[m].name} created`, 'Open for transactions')
}
const RP = { stock: ['Reprocess stock', 'Recalculates every item’s stock from all movements'], cogs: ['Reprocess cost of goods', 'Recalculates the cost of every item and every sale'], acc: ['Reprocess accounting', 'Posts the journals of all transactions again'] }
window.glReproc = k => { CS.rp = (PER.find(p => p.name === CS.rp) ? CS.rp : OPEN_PERIOD); rpSheet(k, true) }
function rpSheet(k, push) {
  const p = PER.find(x => x.name === CS.rp) || sp()
  const o = { crumb: ['Month end'], title: RP[k][0], size: 'rail', body: `<div style="display:grid;gap:20px"><div class="field7"><span>Period</span>${sel(PER.map(x => [x.name, x.name]), p.name, `glRpPer('${k}',this.value)`)}</div>${p.open ? '' : `<p class="late" style="margin:0">${p.name} is closed. Undo closing first.</p>`}</div>`, foot: btn(RP[k][0], `glDoReproc('${k}')`, 'primary', p.open ? '' : 'is-disabled') }
  if (push) openSheet(o); else { S.stack[S.stack.length - 1] = o; renderLayers() }
}
window.glRpPer = (k, v) => { CS.rp = v; rpSheet(k, false) }
window.glDoReproc = k => { const p = PER.find(x => x.name === CS.rp); if (!p || !p.open) return; closeSheet(); toast(`${RP[k][0]} done`, p.name) }

reg({
  id: 'gl-closing', group: 'gl', label: 'Month end',
  render() {
    const p = sp(), open = PER.filter(x => x.open), why = closeIssue()
    const prob = CS.tests.trx && CS.tests.acc ? probCount() : null
    const giro = J.filter(j => j.giro && j.st === 'New').length
    const prows = PER.map(x => ({ cls: x.name === CS.sel ? 'gl-selrow' : '', on: `glSelPer('${x.name}')`, c: { n: x.name, made: day(x.made), y: String(2026), m: String(+x.from.slice(5, 7)), f: day(x.from), t: day(x.to), st: x.open ? `<span class="okc">${ico('check')}Open</span>` : mute('Closed') } })).reverse()
    const vrow = (k, label) => {
      const res = CS.tests[k], n = res ? res.reduce((a, c) => a + c.items.length, 0) : 0
      return `<div class="gl-vrow"><span class="t">${label}</span><span class="r">${!res ? mute('Not run') : n ? `<span class="late">${plural(n, 'problem')}</span> ${link('View problem', `glView('${k}')`)}` : `<span class="okc">${ico('check')}No problem</span>`}</span>${btn('Run test', `glTest('${k}')`)}</div>`
    }
    const body =
      `<div class="ds-banner ds-banner--warn" style="margin-bottom:24px">${ico('alert')}<span>No other user may be using the app while closing</span></div>` +
      section('Periods', scroll(table({ tbl: 'gl', cols: [{ l: 'Period', k: 'n', w: 120 }, { l: 'Created', k: 'made', w: 130 }, { l: 'Year', k: 'y', w: 80 }, { l: 'Month', k: 'm', w: 80 }, { l: 'From', k: 'f', w: 130 }, { l: 'To', k: 't', w: 130 }, { l: 'Status', k: 'st' }], rows: prows })), `<div class="gl-acts">${btn('Close', "go('gl-info')")}${btn('Create period', 'glCreate()')}${btn('Closing', 'glClosing()', 'primary', why ? 'is-disabled' : '')}${btn('Undo closing', 'glUndo()', 'primary', p.open ? 'is-disabled' : '')}</div>`) +
      section('Opening balance', `<div class="gl-vrow"><span class="t">Process program opening balance into opening balance sheet</span><span class="r">${CS.saldo ? `<span class="okc">${ico('check')}Processed</span>` : mute('Not run')}</span>${btn('Process', 'glSaldo()')}</div>`) +
      section(`Validate ${p.name}`, `<div>${vrow('trx', 'Validate transactions')}${vrow('acc', 'Validate accounting')}</div>
        <div style="display:flex;align-items:center;justify-content:space-between;gap:20px;min-height:64px"><label class="ds-check" style="gap:12px"><input type="checkbox" class="cb7" ${CS.ignore ? 'checked' : ''} onchange="glIgn(this.checked)">Ignore validation</label><span class="late">${esc(why)}</span></div>`) +
      section('Closing locks', lockList(p)) +
      section('Reprocess', `<div class="gl-acts">${Object.keys(RP).map(k => btn(RP[k][0], `glReproc('${k}')`)).join('')}</div>`)
    return page({
      title: 'Month end',
      kpis: [{ label: 'Open period', value: open.length ? open[open.length - 1].name : '—' }, { label: 'Closed through', value: (PER.filter(x => !x.open).pop() || {}).name || '—' }, { label: 'Problems found', value: prob == null ? '—' : String(prob), bad: prob > 0 }, { label: 'Giro not cleared', value: String(giro), bad: giro > 0 }],
      body,
    })
  },
})


/* ═════════ statements built from the ledger ═════════ */
const PLW = [0.104, 0.099, 0.113, 0.117, 0.111, 0.106, 0.119, 0.123, 0.108]
const CW = PLW.reduce((a, w) => (a.push((a[a.length - 1] || 0) + w), a), [])
const bsLike = b => /^[123]/.test(b)
/* signed P&L per base for month index k (0 Jan … 9 Oct): { m: month, y: year to date }.
   Oct is the real ledger; Jan–Sep spread the September year-to-date balances by fixed weights. */
function plAt(k) {
  const map = new Map()
  book(OCT1, OCT31).filter(t => !bsLike(t.a)).forEach(t => { const x = map.get(t.a) || { open: 0, oct: 0 }; x.open += t.open; x.oct += t.d - t.c; map.set(t.a, x) })
  const out = new Map()
  map.forEach((x, b) => {
    if (k === 9) out.set(b, { m: x.oct, y: x.open + x.oct })
    else { const y = k === 8 ? x.open : Math.round(x.open * CW[k]), y0 = k ? Math.round(x.open * CW[k - 1]) : 0; out.set(b, { m: y - y0, y }) }
  })
  return out
}
const vcells = v => Object.fromEntries(v.map((x, i) => ['v' + i, redIf(x, num(x))]))
const rowT = (label, v, cls = 'total') => ({ cls, vals: v, c: { code: '', name: label, ...vcells(v) } })
/* rows grouped by 5-digit sub-group; val(b) → number[] */
function tree(bases, val, n) {
  const rows = [], tot = Array(n).fill(0), g = new Map()
  bases.forEach(b => { const s = b.slice(0, 5); if (!g.has(s)) g.set(s, []); g.get(s).push(b) })
  g.forEach((bs, s) => {
    const sums = Array(n).fill(0); bs.forEach(b => val(b).forEach((v, i) => { sums[i] += v }))
    rows.push({ cls: 'gl-sub', vals: sums, c: { code: '', name: esc(COA_NAME[s] || s), ...vcells(sums) } })
    bs.forEach(b => { const v = val(b); rows.push({ vals: v, c: { code: mute(b), name: `<span style="padding-left:16px">${esc(accName(b))}</span>`, ...vcells(v) } }) })
    sums.forEach((v, i) => { tot[i] += v })
  })
  return { rows, tot }
}
function plStatement(k) {
  const cur = plAt(k)
  const keys = [...cur.keys()].filter(b => cur.get(b).m || cur.get(b).y).sort()
  const G = (d, label, sg) => {
    const bs = keys.filter(b => b[0] === d)
    if (!bs.length) return { rows: [], tot: [0, 0] }
    const t = tree(bs, b => [sg * cur.get(b).m, sg * cur.get(b).y], 2)
    return { rows: [{ group: label }, ...t.rows], tot: t.tot }
  }
  const r4 = G('4', 'Revenue', -1), r5 = G('5', 'Cost of sales', 1), r6 = G('6', 'Operating expenses', 1), r7 = G('7', 'Other operating expenses', 1), r8 = G('8', 'Non-operating income (expense)', -1)
  const two = f => [f(0), f(1)]
  const gp = two(i => r4.tot[i] - r5.tot[i]), op = two(i => gp[i] - r6.tot[i] - r7.tot[i]), np = two(i => op[i] + r8.tot[i])
  const rows = [...r4.rows, rowT('Total revenue', r4.tot, 'gl-sub'), ...r5.rows, rowT('Total cost of sales', r5.tot, 'gl-sub'), rowT('Gross profit', gp, 'gl-key'),
    ...r6.rows, rowT('Total operating expenses', r6.tot, 'gl-sub'), ...r7.rows, rowT('Total other operating expenses', r7.tot, 'gl-sub'), rowT('Operating profit', op, 'gl-key'),
    ...r8.rows, rowT('Net profit', np)]
  return { rows, rev: r4.tot, cos: r5.tot, gp, op, np, opex: two(i => r6.tot[i] + r7.tot[i]) }
}
/* balance sheet at one or more dates */
function bsView(asofs) {
  const n = asofs.length
  const books = asofs.map(a => book(OCT1, a)), maps = books.map(byBase)
  const pnl = books.map(bk => -bk.filter(t => !bsLike(t.a)).reduce((s, t) => s + t.close, 0))
  const keys = [...new Set(maps.flatMap(m => [...m.keys()]))].filter(b => bsLike(b) && maps.some(m => m.get(b))).sort()
  const sec = (d, sg) => {
    const bs = keys.filter(b => b[0] === d), out = [], tot = Array(n).fill(0), g3 = new Map()
    bs.forEach(b => { const s = b.slice(0, 3); if (!g3.has(s)) g3.set(s, []); g3.get(s).push(b) })
    g3.forEach((xs, s) => { out.push({ group: esc(COA_NAME[s] || s) }); const t = tree(xs, b => maps.map(m => sg * (m.get(b) || 0)), n); out.push(...t.rows); t.tot.forEach((v, i) => { tot[i] += v }) })
    return { rows: out, tot }
  }
  const A = sec('1', 1), Li = sec('2', -1), E0 = sec('3', -1)
  const eq = E0.tot.map((v, i) => v + pnl[i])
  const E = { rows: [...E0.rows, { cls: 'gl-sub', vals: pnl, c: { code: '', name: 'Current year profit', ...vcells(pnl) } }], tot: eq }
  return { A, Li, E, le: Li.tot.map((v, i) => v + eq[i]), pnl, maps }
}
const reflow = (rows, f) => rows.map(r => (r.vals ? { ...r, c: { ...r.c, ...Object.fromEntries(f(r.vals).map((s, i) => ['v' + i, s])) } } : r))
const BSDATES = { oct: [[OCT31, SEP30], ['Oct 2026', 'Sep 2026']], sep: [[SEP30], ['Sep 2026']] }
function bsReport(mode, per) {
  const [dates, labs] = mode === 'cmp' ? [[SEP30, OCT31], ['Sep 2026', 'Oct 2026']] : mode === 'cs' ? [[per === 'sep' ? SEP30 : OCT31], [per === 'sep' ? 'Sep 2026' : 'Oct 2026']] : BSDATES[per]
  const v = bsView(dates)
  const all = [{ group: 'Assets' }, ...v.A.rows, rowT('Total assets', v.A.tot), { group: 'Liabilities' }, ...v.Li.rows, rowT('Total liabilities', v.Li.tot, 'gl-sub'), { group: 'Equity' }, ...v.E.rows, rowT('Total equity', v.E.tot, 'gl-sub'), rowT('Total liabilities and equity', v.le)]
  const code = { l: 'Code', k: 'code', w: 100 }, nm = { l: 'Account', k: 'name' }
  const nc = (l, i) => ({ l, k: 'v' + i, num: 1, w: 125 })
  if (mode === 'cmp') return { v, html: scroll(table({ tbl: 'gl', cols: [code, nm, nc('Sep 2026', 0), nc('Oct 2026', 1), nc('Change', 2)], rows: reflow(all, x => [...x, x[1] - x[0]].map(y => num(y))) })) }
  if (mode === 'cs') { const ta = v.A.tot[0]; return { v, html: scroll(table({ tbl: 'gl', cols: [code, nm, nc(labs[0], 0), nc('% of total', 1)], rows: reflow(all, x => [num(x[0]), pct(x[0] / ta)]) })) } }
  if (mode === 'side') {
    const cols = [{ l: 'Assets', k: 'name' }, ...labs.map((l, i) => ({ ...nc(l, i), w: 110 }))], cols2 = [{ l: 'Liabilities and equity', k: 'name' }, ...labs.map((l, i) => ({ ...nc(l, i), w: 110 }))]
    const left = [...v.A.rows.filter(r => !r.group), rowT('Total assets', v.A.tot)]
    const right = [...v.Li.rows.filter(r => !r.group), rowT('Total liabilities', v.Li.tot, 'gl-sub'), ...v.E.rows.filter(r => !r.group), rowT('Total equity', v.E.tot, 'gl-sub'), rowT('Total liabilities and equity', v.le)]
    return { v, html: `<div class="two">${scroll(table({ tbl: 'gl', cols, rows: left }))}${scroll(table({ tbl: 'gl', cols: cols2, rows: right }))}</div>` }
  }
  return { v, html: scroll(table({ tbl: 'gl', cols: [code, nm, ...labs.map(nc)], rows: all })) }
}

/* cash flow, indirect */
function cfData() {
  const o = byBase(book(OCT1, SEP30)), c = byBase(book(OCT1, OCT31)), bases = new Set([...o.keys(), ...c.keys()])
  const eff = (...pre) => -pre.reduce((s, p) => s + [...bases].filter(b => b.startsWith(p)).reduce((t, b) => t + (c.get(b) || 0) - (o.get(b) || 0), 0), 0)
  const cash = m => [...bases].filter(b => b.startsWith('10110')).reduce((s, b) => s + (m.get(b) || 0), 0)
  const np = plStatement(9).np[0], dep = eff('10216', '1021702')
  const wc = [['Receivables', eff('10111')], ['Inventory', eff('10112')], ['Prepaid', eff('10113')], ['Trade payables', eff('20120')], ['Taxes payable', eff('20121')], ['Accrued expenses', eff('20122')]]
  const op = np + dep + wc.reduce((s, x) => s + x[1], 0)
  const inv = [['Fixed assets and other assets', eff('10215', '1021701', '103')]]
  const fin = [['Funding between units', eff('10214', '20123')], ['Loans', eff('20125', '202')], ['Capital', eff('301')]]
  const ti = inv.reduce((s, x) => s + x[1], 0), tf = fin.reduce((s, x) => s + x[1], 0), net = op + ti + tf
  return { np, dep, wc, op, inv, ti, fin, tf, net, open: cash(o), close: cash(c) }
}
function cfReport() {
  const d = cfData(), R = (name, v, cls = '', ind = 0) => ({ cls, c: { name: ind ? `<span style="padding-left:16px">${name}</span>` : name, v: v === null ? '' : redIf(v, v === 0 ? DASH : num(v)) } })
  const rows = [{ group: 'Operating activities' }, R('Net profit', d.np), R('Depreciation and amortisation', d.dep), ...d.wc.map(x => R(x[0], x[1], '', 1)), R('Net cash from operating activities', d.op, 'gl-sub'),
    { group: 'Investing activities' }, ...d.inv.map(x => R(x[0], x[1], '', 1)), R('Net cash from investing activities', d.ti, 'gl-sub'),
    { group: 'Financing activities' }, ...d.fin.map(x => R(x[0], x[1], '', 1)), R('Net cash from financing activities', d.tf, 'gl-sub'),
    R('Net change in cash', d.net, 'gl-key'), R('Cash at 30 Sep 2026', d.open), R('Cash at 31 Oct 2026', d.close, 'total')]
  return scroll(table({ tbl: 'gl', cols: [{ l: 'Cash flow', k: 'name' }, { l: 'Oct 2026', k: 'v', num: 1, w: 160 }], rows }))
}

/* month-end inventory */
function stkData() {
  const ls = LN().filter(x => x.a === '1011201001'), s = (l, src) => l.filter(x => x.src === src).reduce((t, x) => t + x.d - x.c, 0)
  const cols = U4.map(u => { const l = ls.filter(x => x.l === u), open = OPENMAP.get(acc12('1011201001', u)) || 0; return { u, open, pb: s(l, 'PB'), trf: s(l, 'TRF'), cogs: s(l, 'INV'), adj: s(l, 'GL'), close: open + l.reduce((t, x) => t + x.d - x.c, 0) } })
  const tot = ['open', 'pb', 'trf', 'cogs', 'adj', 'close'].reduce((o2, k) => (o2[k] = cols.reduce((t, c) => t + c[k], 0), o2), { u: 'Total' })
  return { cols: [...cols, tot], tot }
}
function stkReport() {
  const d = stkData(), lines = [['Opening', 'open'], ['Purchases', 'pb'], ['Transfers', 'trf'], ['Cost of sales', 'cogs'], ['Adjustments', 'adj'], ['Closing', 'close']]
  const rows = lines.map(([l, k]) => ({ cls: k === 'close' ? 'total' : '', c: { name: l, ...Object.fromEntries(d.cols.map((c, i) => ['v' + i, k === 'close' || k === 'open' ? num(c[k]) : c[k] ? num(c[k]) : DASH])) } }))
  return scroll(table({ tbl: 'gl', cols: [{ l: 'Inventory', k: 'name', w: 130 }, ...d.cols.map((c, i) => ({ l: c.u, k: 'v' + i, num: 1, w: 125 }))], rows }))
}

/* the checks 7Soft's manual (p.264–270) says must agree */
function checks() {
  const bk = book(OCT1, OCT31), dr = bk.filter(t => t.close > 0).reduce((s, t) => s + t.close, 0), cr = -bk.filter(t => t.close < 0).reduce((s, t) => s + t.close, 0)
  const v = bsView([OCT31]), st = stkData(), cf = cfData(), pl = plStatement(9)
  const stockBs = [...v.maps[0].entries()].filter(([b]) => b.startsWith('10112')).reduce((s, [, x]) => s + x, 0)
  const pbCred = LN().filter(x => x.src === 'PB' && x.a === '2012001001').reduce((s, x) => s + x.c, 0)
  const cogsPl = (plAt(9).get('5010110001') || { m: 0 }).m
  const subA = bk.filter(t => t.a[0] === '1').reduce((s, t) => s + t.close, 0)
  return [
    { t: 'Trial balance: debit equals credit', a: dr, b: cr },
    { t: 'Balance sheet: assets equal liabilities and equity', a: v.A.tot[0], b: v.le[0] },
    { t: 'Balance sheet profit equals profit and loss', a: v.pnl[0], b: pl.np[1] },
    { t: 'Closing cash equals cash and bank accounts', a: cf.close, b: bk.filter(t => t.a.startsWith('10110')).reduce((s, t) => s + t.close, 0), cfOk: cf.open + cf.net === cf.close },
    { t: 'Inventory report equals balance sheet stock', a: st.tot.close, b: stockBs },
    { t: 'Cost of sales: inventory report equals profit and loss', a: -st.tot.cogs, b: cogsPl },
    { t: 'Purchases: inventory report equals supplier payables', a: st.tot.pb, b: pbCred },
    { t: 'Balance sheet assets equal sub-ledger', a: v.A.tot[0], b: subA },
  ]
}
const agreeBox = () => {
  const ch = checks(), ok = c => c.a === c.b && c.cfOk !== false
  return `<div class="card7" style="margin-bottom:24px"><div class="sec-head" style="margin-bottom:8px"><h3 style="margin:0">These must agree</h3><span class="mute">${ch.filter(ok).length} of ${ch.length}</span></div>
    <div class="gl-checks">${ch.map(c => `<div class="gl-check ${ok(c) ? '' : 'bad'}">${ico(ok(c) ? 'check' : 'alert')}<span>${c.t}</span><span class="fig ${ok(c) ? '' : 'late'}">${ok(c) ? money(c.a) : `${money(c.a)} ≠ ${money(c.b)}`}</span></div>`).join('')}</div></div>`
}

/* ═════════ report catalogue ═════════ */
const MC = [['oct', 'Oct 2026'], ['sep', 'Sep 2026']], ONE = [['oct', 'Oct 2026']]
const gen = (cols, rows, foot, ons) => scroll(table({ tbl: 'gl', cols: cols.map(([l, n, w], i) => ({ l, k: 'c' + i, num: n, w })), rows: rows.map((r, ri) => ({ on: ons && ons[ri], c: Object.fromEntries(r.map((v, i) => ['c' + i, v])) })), foot: foot && Object.fromEntries(foot.map((v, i) => ['c' + i, v])) }))
const fz = per => (per === 'sep' ? 0.93 : 1)
const IT = [
  ['KMJ-0412', 'Batik shirt long sleeve M', 412, 98880000, 54340000], ['JNS-0233', 'Slim jeans men 32', 286, 114400000, 63060000], ['DRS-0871', 'Gamis dress floral L', 231, 138600000, 72590000],
  ['TSH-1120', 'T-shirt basic white L', 654, 65400000, 31250000], ['SHO-0307', 'Sneakers canvas 42', 118, 70800000, 41300000], ['JKT-0549', 'Bomber jacket black M', 97, 77600000, 39700000],
]
const sc = (x, per) => IT.map(([a, b, q, s, c]) => [a, b, Math.round(q * fz(per)), r10k(s * fz(per)), r10k(c * fz(per))])
const prof = (s, c) => num(s - c), mar = (s, c) => pct((s - c) / s)
function jrnReport(srcs, per) {
  const [f, t] = FROMTO[per], js = J.filter(j => j.st === 'New' && (!srcs || srcs.includes(j.src)) && j.date >= f && j.date <= t), rows = []
  js.forEach(j => { rows.push({ group: `${dayS(j.date)} · ${j.no} · ${esc(j.note)}` }); j.lines.forEach(l => rows.push({ on: `glAcct('${acc12(l.a, l.l)}')`, c: { acct: `${mute(acc12(l.a, l.l))} ${esc(name12(l.a, l.l))}`, d: l.d ? num(l.d) : '', c: l.c ? num(l.c) : '' } })) })
  return scroll(table({ tbl: 'gl', empty: 'No journal in this period', cols: [{ l: 'Account', k: 'acct' }, { l: 'Debit', k: 'd', num: 1, w: 130 }, { l: 'Credit', k: 'c', num: 1, w: 130 }], rows, foot: { acct: 'Total', d: num(js.reduce((s, j) => s + jTotal(j), 0)), c: num(js.reduce((s, j) => s + j.lines.reduce((t2, l) => t2 + l.c, 0), 0)) } }))
}
const jrnRep = (id, name, srcs) => ({ id, g: 'acc', name, chips: PCHIPS, render: per => jrnReport(srcs, per) })
const FAROWS = per => { const bk = book(OCT1, per === 'sep' ? SEP30 : OCT31); return ASSETS.map(a => { const ac = (bk.find(t => t.code === acc12(a.acc, a.loc)) || { close: 0 }).close; return { a, accum: -ac } }) }
const GROUPS_COA = [['1', 'Asset'], ['2', 'Liabilities'], ['3', 'Equity'], ['4', 'Revenue'], ['5', 'Cost of sales'], ['6', 'Operating expenses'], ['7', 'Other operating expenses'], ['8', 'Non-operating']]
const GRPS = [['Shirts', 1.9], ['Trousers', 2.4], ['Dresses', 2.1], ['T-shirts', 2.8], ['Footwear', 1.6], ['Outerwear', 1.2]]
window.glDet = (kind, i, per) => {
  const it = sc(0, per)
  if (kind === 'grp') { const [, , , s, c] = it[i], k = GRPS[i][1], S2 = r10k(s * k), C2 = r10k(c * k); const rows = [0.4, 0.3, 0.2, 0.1].map((sh, j) => ({ c: { n: CUST[(i + j) % CUST.length], s: num(r10k(S2 * sh)), c: num(r10k(C2 * sh)), p: prof(r10k(S2 * sh), r10k(C2 * sh)) } })); openSheet({ crumb: ['Profit by item group'], title: GRPS[i][0], body: table({ tbl: 'gl', cols: [{ l: 'Customer', k: 'n' }, { l: 'Sales', k: 's', num: 1, w: 140 }, { l: 'Cost', k: 'c', num: 1, w: 140 }, { l: 'Profit', k: 'p', num: 1, w: 140 }], rows }) }) }
  else { const rows = [0, 1, 2].map(j => { const [a, b, q, s, c] = it[(i + j) % 6], sh = [0.3, 0.2, 0.1][j]; return { c: { n: `${mute(a)} ${b}`, q: num(Math.round(q * sh)), s: num(r10k(s * sh)), c: num(r10k(c * sh)), p: prof(r10k(s * sh), r10k(c * sh)) } } }); openSheet({ crumb: ['Profit by customer'], title: CUST[i], body: table({ tbl: 'gl', cols: [{ l: 'Item', k: 'n' }, { l: 'Quantity', k: 'q', num: 1, w: 100 }, { l: 'Sales', k: 's', num: 1, w: 140 }, { l: 'Cost', k: 'c', num: 1, w: 140 }, { l: 'Profit', k: 'p', num: 1, w: 140 }], rows }) }) }
}
const CUST = ['Agung Jaya Sentosa', 'Citra Terang Sinar Mulyo', 'Toko Maju Jaya', 'Sari Wulandari', 'Rudi Hartono', 'Gunawan, Bpk Indah']
const SELLERS = ['Dewi Lestari', 'Rina Marlina', 'Budi Santoso', 'Anisa Putri', 'Eko Prasetyo', 'Yuni Astuti']
const BAS4 = [['q', 'Quantity'], ['v', 'Value'], ['f', 'Frequency'], ['p', 'Profit']]
const BASL = { q: 'Quantity', v: 'Value', f: 'Frequency', p: 'Profit' }
/* a calm ranked table in place of 7Soft's pie charts: ranked by the chosen basis */
const rank = (first, rows, b, desc) => { const r = rows.slice().sort((x, y) => (desc ? y[b] - x[b] : x[b] - y[b])); return gen([['#', 0, 50], first, ...(b === 'q' || b === 'v' && first[0] === 'Item' ? [] : []), [BASL[b], 1, 150]].filter(x => x), r.map((x, i) => [String(i + 1), x.n, num(x[b])])) }
const REPS = [
  { id: 'cogs', g: 'acc', name: 'Cost of goods calculation', chips: MC, render: per => gen([['Item', 0], ['Opening', 1, 90], ['In', 1, 80], ['Out', 1, 80], ['Closing', 1, 90], ['Average cost', 1, 120], ['Closing value', 1, 130]], sc(0, per).map(([a, b, q, s, c]) => { const op = q * 2 + 40, inn = q + 30, cl = op + inn - q, av = Math.round(c / q / 1000) * 1000; return [`${mute(a)} ${b}`, num(op), num(inn), num(q), num(cl), num(av), num(cl * av)] })) },
  jrnRep('jnl', 'Journal report', null), jrnRep('jnl-pb', 'Purchase journal', ['PB']), jrnRep('jnl-pj', 'Sales journal', ['PJ']), jrnRep('jnl-inv', 'Stock journal', ['INV', 'TRF']),
  jrnRep('jnl-bkk', 'BKK journal, cash paid', ['BKK']), jrnRep('jnl-bkm', 'BKM journal, cash received', ['BKM']),
  { id: 'sub', g: 'acc', name: 'Sub-ledger', chips: PCHIPS, render: per => { const [f, t] = FROMTO[per], rs = subRows(f, t, '', '~'); return scroll(table({ tbl: 'gl', cols: [{ l: 'Code', k: 'code', w: 140 }, { l: 'Account', k: 'name' }, { l: 'Opening', k: 'o', num: 1, w: 130 }, { l: 'Debit', k: 'd', num: 1, w: 130 }, { l: 'Credit', k: 'c', num: 1, w: 130 }, { l: 'Closing', k: 'x', num: 1, w: 130 }], rows: rs.map(x => ({ on: `glAcct('${x.code}','${f}','${t}')`, c: { code: x.code, name: esc(name12(x.a, x.l)), o: num(x.open * nat(x.a)), d: num(x.d), c: num(x.c), x: num(x.close * nat(x.a)) } })), foot: { name: 'Total', d: num(rs.reduce((s, x) => s + x.d, 0)), c: num(rs.reduce((s, x) => s + x.c, 0)) } })) } },
  { id: 'stk', g: 'acc', name: 'Month-end inventory', chips: ONE, render: stkReport },
  { id: 'master', g: 'acc', name: 'Master accounts', chips: [['all', 'All accounts']], render: () => { const used = new Set(book(OCT1, OCT31).filter(active).map(t => t.a)), rows = []; GROUPS_COA.forEach(([g, n]) => { rows.push({ group: `${g} · ${n}` }); COA.filter(c => c[0].length === 10 && c[0][0] === g).forEach(c => rows.push({ c: { code: c[0], name: esc(c[1]), used: used.has(c[0]) ? `<span class="okc">${ico('check')}Used</span>` : '' } })) }); return scroll(table({ tbl: 'gl', cols: [{ l: 'Code', k: 'code', w: 130 }, { l: 'Account', k: 'name' }, { l: 'In the ledger', k: 'used', w: 140 }], rows })) } },
  { id: 'fa', g: 'acc', name: 'Fixed assets and depreciation', chips: MC, render: per => gen([['Asset', 0], ['Method', 0, 120], ['Per year', 1, 130], ['Accumulated', 1, 130], ['Book value', 1, 140]], FAROWS(per).map(({ a, accum }) => [`${mute(a.id)} ${a.name} ${a.loc}`, `${a.method} ${a.rate}%`, num(monthly(a) * 12), num(accum), num(a.cost - accum)])) },
  { id: 'fa-y', g: 'acc', name: 'Fixed assets, yearly', chips: ONE, render: () => gen([['Asset', 0], ['Jan–Sep', 1, 120], ['Oct', 1, 120], ['Year to date', 1, 130], ['Book value', 1, 140]], FAROWS('oct').map(({ a, accum }) => [`${mute(a.id)} ${a.name} ${a.loc}`, num(9 * monthly(a)), num(monthly(a)), num(10 * monthly(a)), num(a.cost - accum)])) },

  { id: 'pl-item', g: 'fin', name: 'Profit by item', chips: MC, render: per => gen([['Item', 0], ['Quantity', 1, 100], ['Sales', 1, 125], ['Cost', 1, 125], ['Profit', 1, 125], ['Margin', 1, 90]], sc(0, per).map(([a, b, q, s, c]) => [`${mute(a)} ${b}`, num(q), num(s), num(c), prof(s, c), mar(s, c)])) },
  { id: 'pl-grp', g: 'fin', k: 'Detail by customer', name: 'Profit by item group', chips: MC, render: per => { const rs = GRPS.map(([n, k], i) => { const [, , q, s, c] = sc(0, per)[i]; return [n, num(Math.round(q * k)), num(r10k(s * k)), num(r10k(c * k)), prof(r10k(s * k), r10k(c * k)), mar(s, c)] }); return gen([['Group', 0], ['Quantity', 1, 100], ['Sales', 1, 125], ['Cost', 1, 125], ['Profit', 1, 125], ['Margin', 1, 90]], rs, null, rs.map((_, i) => `glDet('grp',${i},'${per}')`)) } },
  { id: 'pl-cust', g: 'fin', k: 'Detail by item', name: 'Profit by customer', chips: MC, render: per => { const rs = sc(0, per).map(([, , q, s, c], i) => [CUST[i], num(Math.round(q / 9)), num(s), num(c), prof(s, c)]); return gen([['Customer', 0], ['Invoices', 1, 100], ['Sales', 1, 130], ['Cost', 1, 130], ['Profit', 1, 130]], rs, null, rs.map((_, i) => `glDet('cust',${i},'${per}')`)) } },
  { id: 'pl-inv', g: 'fin', k: 'Invoice', name: 'Profit by invoice', chips: MC, render: per => gen([['Invoice', 0, 170], ['Date', 0, 90], ['Shop', 0, 80], ['Sales', 1, 125], ['Cost', 1, 125], ['Profit', 1, 125]], [['C001', 27, 1852000, 903000], ['C001', 26, 2419000, 1160000], ['C002', 26, 936500, 498000], ['C002', 24, 3380000, 1620000], ['C003', 23, 1284000, 701000], ['C001', 22, 689000, 352000]].map(([s, d, a, c], i) => [`INV-${s}-261${String(d).padStart(2, '0')}0${i + 1}`, `${d} ${per === 'sep' ? 'Sep' : 'Oct'}`, s, num(a), num(c), prof(a, c)])) },
  { id: 'pl-sales', g: 'fin', k: 'For sales commission', name: 'Profit by salesperson', chips: MC, render: per => gen([['Salesperson', 0], ['Invoices', 1, 100], ['Sales', 1, 130], ['Cost', 1, 130], ['Profit', 1, 130]], sc(0, per).map(([, , q, s, c], i) => [SELLERS[i], num(Math.round(q / 2.2)), num(s * 2), num(c * 2), prof(s * 2, c * 2)])) },
  { id: 'pl', g: 'fin', name: 'Profit and loss', chips: MC, render: per => { const k = per === 'sep' ? 8 : 9, s = plStatement(k); return scroll(table({ tbl: 'gl', cols: [{ l: 'Code', k: 'code', w: 100 }, { l: 'Account', k: 'name' }, { l: `${MONTHS_L[k]} 2026`, k: 'v0', num: 1, w: 125 }, { l: 'Year to date', k: 'v1', num: 1, w: 135 }], rows: s.rows })) } },
  { id: 'pl-g', g: 'fin', name: 'Profit and loss with goods', chips: ONE, render: () => {
    const st = stkData().tot, pl = plStatement(9), cogs = st.open + st.pb + st.adj - st.close
    const R = (n, v, cls = '') => ({ cls, c: { name: n, v: redIf(v, num(v)) } })
    return scroll(table({ tbl: 'gl', cols: [{ l: 'Oct 2026', k: 'name' }, { l: 'Amount', k: 'v', num: 1, w: 160 }], rows: [R('Net sales', pl.rev[0], 'gl-sub'), { group: 'Cost of goods sold' }, R('Opening inventory', st.open), R('Purchases', st.pb), R('Stock count differences', st.adj), R('Closing inventory', -st.close), R('Cost of goods sold', cogs, 'gl-sub'), R('Gross profit', pl.rev[0] - cogs, 'gl-key'), R('Operating and other expenses', pl.opex[0] + pl.cos[0] - cogs), R('Non-operating income (expense)', pl.np[0] - pl.op[0]), R('Net profit', pl.np[0], 'total')] }))
  } },
  { id: 'pl-y', g: 'fin', name: 'Profit and loss by month', chips: ONE, render: () => { const ms = Array.from({ length: 10 }, (_, k) => plStatement(k)), tt = f => ms.reduce((s, x) => s + f(x), 0); return gen([['Month', 0], ['Net sales', 1, 125], ['Cost of sales', 1, 125], ['Gross profit', 1, 125], ['Expenses, net', 1, 125], ['Net profit', 1, 125]], ms.map((x, k) => [`${MONTHS_L[k]} 2026`, num(x.rev[0]), num(x.cos[0]), num(x.gp[0]), num(x.gp[0] - x.np[0]), redIf(x.np[0], num(x.np[0]))]), ['Total', num(tt(x => x.rev[0])), num(tt(x => x.cos[0])), num(tt(x => x.gp[0])), num(tt(x => x.gp[0] - x.np[0])), num(tt(x => x.np[0]))]) } },
  { id: 'tb', g: 'fin', name: 'Trial balance', chips: MC, render: per => tbTable(per === 'sep' ? SEP30 : OCT31).html },
  { id: 'bs-r', g: 'fin', k: 'Fixed account format', name: 'Balance sheet, side by side', chips: MC, render: per => bsReport('side', per).html },
  { id: 'bs', g: 'fin', name: 'Balance sheet', chips: MC, render: per => bsReport('std', per).html },
  { id: 'bs-cmp', g: 'fin', name: 'Balance sheet, two months', chips: [['cmp', 'Sep and Oct 2026']], render: () => bsReport('cmp').html },
  { id: 'bs-cs', g: 'fin', name: 'Balance sheet, common size', chips: MC, render: per => bsReport('cs', per).html },
  { id: 'bs-y', g: 'fin', name: 'Balance sheet by month', chips: ONE, render: () => {
    const v = bsView([SEP30, OCT31]), A9 = v.A.tot[0], L9 = v.Li.tot[0]
    const rows = Array.from({ length: 10 }, (_, k) => { const a = k === 9 ? v.A.tot[0] : k === 8 ? A9 : Math.round(A9 * (0.86 + 0.0155 * k) / 1000) * 1000, l = k === 9 ? v.Li.tot[0] : k === 8 ? L9 : Math.round(L9 * (0.9 + 0.011 * k) / 1000) * 1000; return [`${MONTHS_L[k]} 2026`, num(a), num(l), num(a - l)] })
    rows[9] = [`Oct 2026`, num(v.A.tot[1]), num(v.Li.tot[1]), num(v.A.tot[1] - v.Li.tot[1])]; rows[8] = [`Sep 2026`, num(v.A.tot[0]), num(v.Li.tot[0]), num(v.A.tot[0] - v.Li.tot[0])]
    return gen([['Month end', 0], ['Total assets', 1, 150], ['Liabilities', 1, 150], ['Equity', 1, 150]], rows)
  } },
  { id: 'cf', g: 'fin', name: 'Cash flow', chips: ONE, render: cfReport },

  { id: 'fast', g: 'mgt', name: 'Fast-moving items', chips: MC, basis: BAS4, render: (per, b) => rank(['Item', 0], sc(0, per).map(([a, n, q, s, c]) => ({ n: `${mute(a)} ${n}`, q, v: s, f: Math.round(q * 0.8), p: s - c })), b, 1) },
  { id: 'fast-grp', g: 'mgt', name: 'Fast-moving item groups', chips: MC, basis: BAS4, render: (per, b) => rank(['Item group', 0], GRPS.map(([n, k], i) => { const [, , q, s, c] = sc(0, per)[i]; return { n, q: Math.round(q * k), v: r10k(s * k), f: Math.round(q * k * 0.8), p: r10k((s - c) * k) } }), b, 1) },
  { id: 'slow', g: 'mgt', name: 'Slow-moving items', chips: MC, basis: [['q', 'Quantity'], ['v', 'Value']], render: (per, b) => rank(['Item', 0], [['SHO-0188', 'Loafer leather 41', 3, 4960000], ['JKT-0211', 'Wool coat grey L', 2, 41800000], ['DRS-0402', 'Evening dress M', 4, 28350000], ['TSH-0870', 'Polo stripe XL', 6, 24480000], ['JNS-0099', 'Jeans wide leg 30', 5, 17850000], ['KMJ-0123', 'Linen shirt S', 7, 14400000]].map(([a, n, q, v]) => ({ n: `${mute(a)} ${n}`, q, v, f: q, p: 0 })), b, 0) },
  { id: 'top', g: 'mgt', name: 'Top 10 customers', chips: MC, basis: [['v', 'Value'], ['f', 'Frequency'], ['p', 'Profit']], render: (per, b) => rank(['Customer', 0], sc(0, per).map(([, , q, s, c], i) => ({ n: CUST[i], q: 0, v: s, f: Math.round(q / 8), p: s - c })), b, 1) },
]
const RAN = new Set(['tb'])
window.glRun = id => { RAN.add(id); render() }
window.glRp = id => { S.f['report-acc'] = {}; setTab('report-acc', id) }

reg({
  id: 'report-acc', group: 'report', label: 'Accounting reports',
  render() {
    const id = tabOf('report-acc', 'tb'), rep = REPS.find(r => r.id === id) || REPS[0]
    const cur = filt('report-acc', 'per', rep.chips[0][0]), per = rep.chips.some(c => c[0] === cur) ? cur : rep.chips[0][0]
    const curB = filt('report-acc', 'basis', rep.basis ? rep.basis[0][0] : ''), bas = rep.basis ? (rep.basis.some(b => b[0] === curB) ? curB : rep.basis[0][0]) : null
    const pl = plStatement(9), v = bsView([OCT31]), ch = checks(), okN = ch.filter(c => c.a === c.b && c.cfOk !== false).length
    const cashT = book(OCT1, OCT31).filter(t => t.a.startsWith('10110')).reduce((s, t) => s + t.close, 0)
    const pick = [['acc', 'Accounting'], ['fin', 'Financial'], ['mgt', 'Management']].map(([g, l]) => `<span class="nav-label">${l}</span><div>${REPS.filter(r => r.g === g).map((r, i) => `<button class="nav-row-btn ${r.id === rep.id ? 'on' : ''}" type="button" onclick="glRp('${r.id}')"><span>${i + 1}. ${r.name}</span></button>`).join('')}</div>`).join('')
    const pane = `<div class="sec-head" style="margin-bottom:12px"><h3 class="ds-section-title">${rep.name}${rep.k ? ` <span class="mute" style="font-weight:400">${rep.k}</span>` : ''}</h3><span style="display:flex;gap:20px">${link('Print', "printPage('Accounting reports')")}${link('Export', "nativeExport('accounting-report')")}</span></div>` +
      bar(rep.chips.length > 1 ? chips('report-acc', 'per', rep.chips, rep.chips[0][0]) : '', rep.basis ? chips('report-acc', 'basis', rep.basis, rep.basis[0][0]) : '', RAN.has(rep.id) ? '' : btn('Run report', `glRun('${rep.id}')`)) + (RAN.has(rep.id) ? rep.render(per, bas) : '')
    return page({
      title: 'Accounting reports',
      kpis: [{ label: 'Net profit Oct 2026', value: money(pl.np[0]), bad: pl.np[0] < 0 }, { label: 'Total assets', value: money(v.A.tot[0]) }, { label: 'Cash and bank', value: money(cashT) }, { label: 'Checks agreeing', value: `${okN} of ${ch.length}`, bad: okN < ch.length }],
      body: agreeBox() + `<div class="gl-split"><div class="gl-pick">${pick}</div><div style="min-width:0">${pane}</div></div>`,
    })
  },
})
})();
