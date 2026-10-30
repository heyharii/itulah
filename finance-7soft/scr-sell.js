(() => {
/* ═════════ Sales: customer invoices, returns, cash sales, receivables ═════════
   One demo set: 4 customers, 18 credit invoices (Aug–Oct 2026), 2 returns, collections (cash, transfer, giro).
   Everything on screen is computed from the arrays below; the open balance per customer must equal CUSTOMERS[].piutang. */

/* ─── catalogue, people, dates ─── */
const ITEMS = [
  { code: 'KF-001', name: 'Kemeja Flanel Pria', unit: 'Pcs', price: 185000, cost: 112000, bc: '8993001100011' },
  { code: 'KP-014', name: 'Kaos Polos Cotton Combed', unit: 'Pcs', price: 62500, cost: 38000, bc: '8993001100028' },
  { code: 'CC-203', name: 'Celana Chino Slim', unit: 'Pcs', price: 245000, cost: 148500, bc: '8993001100035' },
  { code: 'JP-077', name: 'Jaket Parka Wanita', unit: 'Pcs', price: 329000, cost: 204000, bc: '8993001100042' },
  { code: 'SS-310', name: 'Sepatu Kanvas Sneakers', unit: 'Pair', price: 275000, cost: 168000, bc: '8993001100059' },
  { code: 'TR-052', name: 'Tas Ransel Harian', unit: 'Pcs', price: 199000, cost: 121000, bc: '8993001100066' },
  { code: 'DB-118', name: 'Dress Batik Katun', unit: 'Pcs', price: 215000, cost: 131000, bc: '8993001100073' },
  { code: 'KK-009', name: 'Kaos Kaki Sport', unit: 'Dozen', price: 96000, cost: 58000, bc: '8993001100080' },
]
const itm = c => ITEMS.find(i => i.code === c)
const SALES = ['Rina Kusuma', 'Dewi Lestari', 'Budi Santoso']
const T0 = iso => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10))
const addD = (iso, n) => new Date(T0(iso) + n * 864e5).toISOString().slice(0, 10)
const dd = (a, b) => Math.round((T0(b) - T0(a)) / 864e5)
const termDays = t => (t === 'CASH' ? 0 : parseInt(String(t).slice(1), 10))
const termWord = t => (TERMS.find(x => x[0] === t) || [0, t])[1]
const sum = (a, f) => a.reduce((s, x) => s + f(x), 0)
const custOf = c => CUSTOMERS.find(x => x.code === c)
const pn = s => parseInt(String(s).replace(/[^\d]/g, ''), 10) || 0
const clone = o => JSON.parse(JSON.stringify(o))

/* ─── the documents ─── */
const INV = [], RET = [], COL = [], UMA = []
const L = (code, qty, price, disc = 0) => ({ code, qty, price: price ?? itm(code).price, disc })
/* type: match | std | dp. dp carries its amount in `dp`; ppn is a percent (0 or 11). */
const inv = (no, date, cust, type, x, lines = []) => INV.push(Object.assign({
  no, date, cust, type, term: type === 'dp' ? 'T7' : custOf(cust).term, so: '', sj: '', sales: SALES[0], disc: 0, ppn: 0, dp: 0, lines,
}, x))
const col = (no, date, cust, acct, alloc, x = {}) => COL.push(Object.assign({ no, date, cust, dir: 'in', acct, giro: null, alloc }, x))
const al = (inv, rec, disc = 0) => ({ inv, rec, disc })
const BCA = '1011002001', MDR = '1011002002', TAB = '1011003001', CASH = '1011001001'

/* Agung Jaya Sentosa · M89 */
inv('PJL/HO/2608/0412', '2026-08-24', 'M89', 'match', { so: 'SO/HO/2608/0031', sj: 'SJ/HO/2608/0027' }, [L('KF-001', 60), L('KP-014', 80)])
inv('PJL/HO/2608/0436', '2026-08-31', 'M89', 'std', { sales: SALES[1] }, [L('CC-203', 40, null, 300000)])
inv('PJL/HO/2609/0108', '2026-09-03', 'M89', 'std', {}, [L('KP-014', 200), L('JP-077', 30)])
inv('PJL/HO/2609/0131', '2026-09-10', 'M89', 'dp', { so: 'SO/HO/2609/0044', dp: 10000000 })
inv('PJL/HO/2609/0156', '2026-09-15', 'M89', 'match', { so: 'SO/HO/2609/0044', sj: 'SJ/HO/2609/0040' }, [L('SS-310', 50), L('TR-052', 40)])
inv('PJL/HO/2609/0177', '2026-09-18', 'M89', 'std', { sales: SALES[1] }, [L('KF-001', 20), L('KK-009', 10)])
inv('PJL/HO/2609/0201', '2026-09-28', 'M89', 'std', { sales: SALES[1], ppn: 11 }, [L('DB-118', 50, null, 125000)])
inv('PJL/HO/2610/0044', '2026-10-06', 'M89', 'match', { so: 'SO/HO/2610/0012', sales: SALES[2] }, [L('KK-009', 100)])
inv('PJL/HO/2610/0091', '2026-10-19', 'M89', 'std', {}, [L('KF-001', 30)])
/* Citra Terang Sinar Mulyo · C17 */
inv('PJL/HO/2609/0098', '2026-09-02', 'C17', 'std', { sales: SALES[1] }, [L('KP-014', 30), L('KK-009', 10), L('CC-203', 2)])
inv('PJL/HO/2610/0021', '2026-10-05', 'C17', 'std', { sales: SALES[2] }, [L('TR-052', 10), L('KF-001', 4)])
inv('PJL/HO/2610/0033', '2026-10-12', 'C17', 'std', { sales: SALES[2] }, [L('KP-014', 20), L('KK-009', 6)])
/* Gunawan, Bpk Indah · G03 */
inv('PJL/HO/2609/0170', '2026-09-20', 'G03', 'std', { sales: SALES[1] }, [L('KK-009', 5), L('KP-014', 6)])
inv('PJL/HO/2610/0058', '2026-10-09', 'G03', 'std', { sales: SALES[2] }, [L('SS-310', 4), L('DB-118', 2)])
/* Toko Maju Jaya · C-0212 */
inv('PJL/HO/2609/0120', '2026-09-08', 'C-0212', 'match', { so: 'SO/HO/2609/0029', sj: 'SJ/HO/2609/0026' }, [L('JP-077', 20), L('CC-203', 24)])
inv('PJL/HO/2609/0188', '2026-09-21', 'C-0212', 'std', { sales: SALES[1] }, [L('DB-118', 10), L('TR-052', 10)])
inv('PJL/HO/2610/0067', '2026-10-12', 'C-0212', 'dp', { so: 'SO/HO/2610/0019', dp: 3000000, sales: SALES[2] })
inv('PJL/HO/2610/0102', '2026-10-22', 'C-0212', 'std', { sales: SALES[2] }, [L('KF-001', 20)])
INV.forEach(v => { v.due = addD(v.date, termDays(v.term)) })

/* sales orders: the ones the matching invoices point at, and two still waiting to be invoiced */
const SOS = [
  ['SO/HO/2608/0031', 'M89', '2026-08-20', 'SJ/HO/2608/0027'], ['SO/HO/2609/0044', 'M89', '2026-09-09', 'SJ/HO/2609/0040'],
  ['SO/HO/2610/0012', 'M89', '2026-10-02', ''], ['SO/HO/2609/0029', 'C-0212', '2026-09-03', 'SJ/HO/2609/0026'],
].map(([no, cust, date, sj]) => { const v = INV.find(x => x.so === no && x.type === 'match'); return { no, cust, date, sj, sales: v.sales, term: v.term, lines: clone(v.lines) } })
SOS.push(
  { no: 'SO/HO/2610/0017', cust: 'M89', date: '2026-10-21', sj: 'SJ/HO/2610/0052', sales: SALES[0], term: 'T30', lines: [L('JP-077', 20), L('CC-203', 10)] },
  { no: 'SO/HO/2610/0019', cust: 'C-0212', date: '2026-10-10', sj: '', sales: SALES[2], term: 'T30', lines: [L('KF-001', 15), L('DB-118', 10)] },
)

RET.push(
  { no: 'RJL/HO/2610/0003', date: '2026-10-12', cust: 'M89', inv: 'PJL/HO/2609/0108', goods: true, lines: [{ code: 'KP-014', qty: 10 }] },
  { no: 'RJL/HO/2610/0005', date: '2026-10-08', cust: 'C17', inv: 'PJL/HO/2609/0098', goods: true, lines: [{ code: 'CC-203', qty: 2 }] },
)
UMA.push({ inv: 'PJL/HO/2609/0156', um: 'PJL/HO/2609/0131', amt: 10000000, date: '2026-09-15' })

/* collections: BKM in, BKK out (a refund is a BKK with a negative amount on the invoice) */
col('BKM/HO/2609/0047', '2026-09-21', 'M89', BCA, [al('PJL/HO/2608/0412', 16100000)], { giro: { no: '455871', bank: 'BCA', due: '2026-09-21', cleared: true } })
col('BKM/HO/2609/0061', '2026-09-29', 'M89', BCA, [al('PJL/HO/2608/0436', 6000000)])
col('BKM/HO/2609/0068', '2026-09-12', 'M89', BCA, [al('PJL/HO/2609/0131', 10000000)])
col('BKM/HO/2610/0071', '2026-10-01', 'M89', BCA, [al('PJL/HO/2609/0108', 8000000)], { giro: { no: '455902', bank: 'BCA', due: '2026-10-01', cleared: true } })
col('BKM/HO/2610/0078', '2026-10-14', 'M89', BCA, [al('PJL/HO/2609/0156', 5000000)])
col('BKM/HO/2610/0080', '2026-10-16', 'M89', BCA, [al('PJL/HO/2609/0177', 4660000)], { giro: { no: '455980', bank: 'BCA', due: '2026-10-30', cleared: false } })
col('BKM/HO/2610/0083', '2026-10-15', 'M89', BCA, [al('PJL/HO/2608/0436', 1500000)])
col('BKM/HO/2610/0090', '2026-10-20', 'M89', BCA, [al('PJL/HO/2609/0108', 11635500)])
col('BKM/HO/2609/0059', '2026-09-14', 'C17', CASH, [al('PJL/HO/2609/0098', 3325000)])
col('BKK/HO/2610/0012', '2026-10-09', 'C17', CASH, [al('PJL/HO/2609/0098', -490000)], { dir: 'out' })
col('BKM/HO/2610/0086', '2026-10-18', 'C17', BCA, [al('PJL/HO/2610/0021', 2287150)])
col('BKM/HO/2610/0092', '2026-10-22', 'C17', BCA, [al('PJL/HO/2610/0033', 1800000, 26000)])
col('BKM/HO/2609/0072', '2026-09-26', 'G03', CASH, [al('PJL/HO/2609/0170', 855000)])
col('BKM/HO/2610/0085', '2026-10-15', 'G03', TAB, [al('PJL/HO/2610/0058', 1495750)])
col('BKM/HO/2610/0075', '2026-10-06', 'C-0212', MDR, [al('PJL/HO/2609/0120', 10335000)], { giro: { no: '330012', bank: 'Mandiri', due: '2026-10-06', cleared: true } })
col('BKM/HO/2610/0081', '2026-10-17', 'C-0212', BCA, [al('PJL/HO/2609/0188', 4090000, 50000)])
col('BKM/HO/2610/0088', '2026-10-16', 'C-0212', MDR, [al('PJL/HO/2610/0067', 3000000)], { giro: { no: '330145', bank: 'Mandiri', due: '2026-11-02', cleared: false } })

/* ─── money ─── */
const lineTot = l => l.qty * l.price - l.disc
const gross = v => (v.type === 'dp' ? v.dp : sum(v.lines, lineTot))
const net = v => gross(v) - v.disc
const ppnOf = v => Math.round(net(v) * v.ppn / 100)
const grand = v => net(v) + ppnOf(v)
const costOf = v => sum(v.lines, l => l.qty * itm(l.code).cost)
const invOf = no => INV.find(x => x.no === no)
const settle = a => a.rec + a.disc
const rq = r => Object.fromEntries(r.lines.map(l => [l.code, l.qty]))
const retValue = (no, q) => sum(invOf(no).lines, l => (q[l.code] ? Math.round((l.qty * l.price - l.disc) * q[l.code] / l.qty) : 0))
const retPpn = (no, val) => Math.round(val * invOf(no).ppn / 100)
const retVal = r => retValue(r.inv, rq(r))
const retTotal = r => retVal(r) + retPpn(r.inv, retVal(r))
const retCost = r => sum(r.lines, l => l.qty * itm(l.code).cost)
function invBal(no, asof = TODAY) {
  const v = invOf(no)
  if (!v || v.date > asof) return 0
  let b = grand(v)
  UMA.forEach(a => { if (a.inv === no && a.date <= asof) b -= a.amt })
  RET.forEach(r => { if (r.inv === no && r.date <= asof) b -= retTotal(r) })
  COL.forEach(c => { if (c.date <= asof) c.alloc.forEach(a => { if (a.inv === no) b -= settle(a) }) })
  return b
}
const custBal = (c, asof = TODAY) => sum(INV.filter(v => v.cust === c), v => invBal(v.no, asof))
const umApplied = no => sum(UMA.filter(a => a.um === no), a => a.amt)
const umLeftAll = no => grand(invOf(no)) - umApplied(no)
const collectedOf = no => sum(COL, c => sum(c.alloc.filter(a => a.inv === no), settle))
const overdueDays = v => (invBal(v.no) > 0 && v.due < TODAY ? dd(v.due, TODAY) : 0)
const overdueOf = c => sum(INV.filter(v => v.cust === c && overdueDays(v) > 0), v => invBal(v.no))
const typeWord = t => ({ match: 'Matching SO', std: 'Standard', dp: 'Down payment' }[t])
const invState = v => {
  const b = invBal(v.no), g = grand(v)
  if (b === 0) return ['ok', 'Paid']
  if (b < 0) return ['warn', 'Credit']
  if (v.due < TODAY) return ['bad', 'Overdue']
  return b < g ? ['warn', 'Partly paid'] : ['neutral', 'Open']
}
const stat = ([tone, w]) => `<span class="ds-status ds-status--${tone}">${w}</span>`
const dueCell = v => (overdueDays(v) > 0 ? `<span class="late">${day(v.due)}</span>` : day(v.due))
const accN = c => (KAS.find(k => k.code === c) || {}).name || accName(c)
const methodOf = c => (c.giro ? `Giro ${c.giro.bank} ${c.giro.no}` : c.acct === CASH ? 'Cash' : 'Bank transfer')
const giroWord = c => (!c.giro ? '' : c.giro.cleared ? 'Giro cleared' : `Giro pending, due ${day(c.giro.due)}`)

/* reconciliation: open balance per customer is what CUSTOMERS says */
const CHECK = { ok: true, diffs: [] }
CUSTOMERS.forEach(c => { const b = custBal(c.code); if (b !== c.piutang) { CHECK.ok = false; CHECK.diffs.push(`${c.code}: ${b} vs ${c.piutang}`) } })
RET.forEach(r => { if (invOf(r.inv).disc) { CHECK.ok = false; CHECK.diffs.push(`${r.no}: source invoice has a header discount`) } })
if (!CHECK.ok) console.error('sell: receivables do not reconcile', CHECK.diffs)
window.SELL_CHECK = CHECK

/* ─── the ledger of one customer (Kartu Piutang) ─── */
function ledger(c, asof = TODAY) {
  const rows = []
  INV.filter(v => v.cust === c && v.date <= asof).forEach(v => rows.push({
    date: v.date, ord: 1, doc: v.no, kind: 'inv', open: `svOpenInv('${v.no}')`, desc: v.type === 'match' ? `Matching ${v.so}` : typeWord(v.type), due: v.due, dr: grand(v), cr: 0, v,
  }))
  UMA.filter(a => invOf(a.inv).cust === c && a.date <= asof).forEach(a => rows.push({
    date: a.date, ord: 3, doc: a.inv, kind: 'um', open: `svOpenInv('${a.inv}')`, desc: `Down payment applied from ${a.um}`, due: '', dr: 0, cr: a.amt,
  }))
  RET.filter(r => r.cust === c && r.date <= asof).forEach(r => rows.push({
    date: r.date, ord: 2, doc: r.no, kind: 'ret', open: `svOpenRet('${r.no}')`, desc: `Return of ${r.inv}`, due: '', dr: 0, cr: retTotal(r),
  }))
  COL.filter(x => x.cust === c && x.date <= asof).forEach(x => {
    const s = sum(x.alloc, settle)
    rows.push({ date: x.date, ord: x.dir === 'in' ? 4 : 5, doc: x.no, kind: x.dir, open: `svOpenBkm('${x.no}')`, desc: `${x.dir === 'in' ? 'Collected' : 'Refunded'} · ${methodOf(x)}`, due: '', dr: x.dir === 'out' ? -s : 0, cr: x.dir === 'in' ? s : 0 })
  })
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.ord - b.ord))
  let bal = 0
  rows.forEach(r => { bal += r.dr - r.cr; r.bal = bal })
  return rows
}

/* ─── receivable summary of one customer over a period ─── */
const PER = { sep: ['2026-09-01', '2026-09-30', 'Sep 2026'], oct: ['2026-10-01', TODAY, 'Oct 2026'] }
function summ(c, from, to) {
  const open = custBal(c, addD(from, -1))
  let sales = 0, dp = 0, ret = 0, cl = 0
  INV.filter(v => v.cust === c && v.date >= from && v.date <= to).forEach(v => { if (v.type === 'dp') dp += grand(v); else sales += grand(v) })
  UMA.filter(a => invOf(a.inv).cust === c && a.date >= from && a.date <= to).forEach(a => { dp -= a.amt })
  RET.filter(r => r.cust === c && r.date >= from && r.date <= to).forEach(r => { ret += retTotal(r) })
  COL.filter(x => x.cust === c && x.date >= from && x.date <= to).forEach(x => { cl += sum(x.alloc, settle) })
  const close = open + sales + dp - ret - cl
  if (close !== custBal(c, to)) { CHECK.ok = false; CHECK.diffs.push(`summary ${c} ${from}`) }
  return { open, sales, dp, ret, cl, close }
}

/* ─── page state ─── */
const V = { F: null, ap: {}, R: null }
const SH = { shop: 'C003' }
const CASHS = { lines: [{ code: 'KP-014', qty: 6, disc: 0 }, { code: 'KF-001', qty: 3, disc: 0 }, { code: 'KK-009', qty: 2, disc: 0 }], disc: 0, ppn: 0 }
const TILL = { cart: [{ code: 'SS-310', qty: 2 }, { code: 'KP-014', qty: 3 }], tender: '', sales: [{ no: 'PJP/C003/2610/0187', time: '10:42', total: 524000 }, { no: 'PJP/C003/2610/0188', time: '11:05', total: 1037500 }] }

/* ─── building blocks of this file ─── */
const CSS = `<style>
.sv-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:24px;margin-bottom:32px}
.sv-grid .s2{grid-column:span 2}
.cin{width:100%;height:36px;padding:0 10px;border:1px solid var(--hairline-2);border-radius:var(--r-inner);background:var(--canvas);font:inherit;color:var(--ink);text-align:right;font-variant-numeric:tabular-nums}
.cin:focus{outline:0;border-color:var(--accent);box-shadow:var(--shadow-focus)}
.cin.l{text-align:left}
select.cin{padding-right:6px}
.sv-split{display:grid;grid-template-columns:260px minmax(0,1fr);gap:28px;align-items:start}
.sv-big{font-size:56px;line-height:64px;font-weight:600;letter-spacing:-1.5px;font-variant-numeric:tabular-nums;margin:0 0 20px}
.sv-till{display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:28px;align-items:start}
.sv-tabs{margin:8px 0 16px}
.sv-end{display:flex;justify-content:flex-end;gap:8px;margin-bottom:12px}
.sv-pick .nav-row-btn{height:36px}
.sv-pick .nav-label{margin-left:0}
.sv-two{display:flex;flex-direction:column;gap:12px}
button.ds-btn[disabled]{opacity:.5;cursor:default}
</style>`
const inp = (v, on, o = {}) => `<input ${o.ro ? 'readonly' : ''} value="${esc(v)}" ${o.ph ? `placeholder="${esc(o.ph)}"` : ''} ${on ? `onchange="${on}"` : ''} ${o.num ? 'inputmode="numeric" style="text-align:right"' : ''}>`
const cin = (v, on, cls = '') => `<input class="cin ${cls}" value="${esc(v)}" inputmode="numeric" onchange="${on}">`
const sel = (opts, cur, on) => `<select onchange="${on}">${opts.map(([v, l]) => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`
const barSel = (opts, cur, on) => `<span class="sel"><select onchange="${on}">${opts.map(([v, l]) => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>${ico('chevron-down')}</span>`
const iconBtn = (name, on, label) => `<button class="ds-btn ds-btn--icon" type="button" aria-label="${label}" onclick="${on}">${ico(name)}</button>`
const facts = pairs => `<dl class="ds-facts" style="grid-template-columns:repeat(4,minmax(0,1fr));margin-bottom:32px">${pairs.map(([k, v]) => `<div class="ds-fact"><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>`
const two = (a, b) => `<span class="nm">${a}</span><span class="mute one">${b}</span>`
const dash0 = n => (n ? money(n) : DASH)
const stPill = v => { const [t, w] = invState(v); return `<span class="ds-pill ds-pill--${t === 'neutral' ? 'neutral' : t}">${w}</span>` }
const closeAll = () => { S.stack.length = 0; renderLayers() }

/* ─── journal sheets ─── */
const acc = (base, loc, name) => ({ code: acc12(base, loc), name: `${name || accName(base)} ${loc}` })
const AR = { code: '1011101xxx', name: 'Piutang Dagang', flag: true }
const UMA_ACC = { code: '205001', name: accName('205001') }
const acell = (a, cr) => `<span style="${cr ? 'padding-left:28px;' : ''}"><span class="nm">${esc(a.code)}</span> · ${esc(a.name)}${a.flag ? ' <span class="late">Not in the chart yet</span>' : ''}</span>`
const blk = (title, rows) => ({ title, rows })
const jr = (a, dr, cr) => ({ a, dr, cr })
function jSheet(crumb, title, pill, blocks) {
  const body = blocks.map(b => {
    const rows = b.rows.filter(r => r.dr || r.cr)
    const td = sum(rows, r => r.dr || 0), tc = sum(rows, r => r.cr || 0)
    return section(b.title, table({
      cols: [{ l: 'Account', k: 'a' }, { l: 'Debit', k: 'dr', num: true, w: 170 }, { l: 'Credit', k: 'cr', num: true, w: 170 }],
      rows: rows.map(r => ({ c: { a: acell(r.a, !!r.cr), dr: r.dr ? money(r.dr) : '', cr: r.cr ? money(r.cr) : '' } })),
      foot: { a: td === tc ? 'Balanced' : '<span class="late">Out of balance</span>', dr: money(td), cr: money(tc) },
    }))
  }).join('')
  openSheet({ crumb, title, pill, size: 'wide', body })
}
function jrInvoice(F) {
  const G = grand(F), N = net(F), P = ppnOf(F), blocks = []
  const ppnRow = P ? [jr(acc('2012101003', 'HO'), 0, P)] : []
  if (F.type === 'dp') {
    blocks.push(blk('Down payment invoice', [jr(AR, G, 0), jr(UMA_ACC, 0, N), ...ppnRow]))
  } else {
    const cost = costOf(F)
    const stock = [jr(acc('5010110001', 'HO'), cost, 0), jr(acc('1011201001', 'HO', 'Persediaan Barang Dagangan'), 0, cost)]
    if (F.type === 'match' && F.sj) {
      blocks.push(blk(`Invoice, matching ${F.so}`, [jr(AR, G, 0), jr(acc('4010110001', 'HO'), 0, N), ...ppnRow]))
      blocks.push(blk(`Stock out, already booked at delivery note ${F.sj}`, stock))
    } else {
      blocks.push(blk(F.type === 'match' ? `Invoice, matching ${F.so || 'SO'}, no delivery note` : 'Invoice, no sales order', [jr(AR, G, 0), jr(acc('4010110001', 'HO'), 0, N), ...ppnRow, ...stock]))
    }
  }
  const ap = sum(F.applied, a => a.amt)
  if (ap) blocks.push(blk('Down payment applied', [jr(UMA_ACC, ap, 0), jr(AR, 0, ap)]))
  return blocks
}

/* ─── sheets that read one document ─── */
function linesTable(v) {
  return table({
    cols: [{ l: 'Item', k: 'i' }, { l: 'Quantity', k: 'q', num: true, w: 110 }, { l: 'Price', k: 'p', num: true, w: 130 }, { l: 'Discount', k: 'd', num: true, w: 120 }, { l: 'Total', k: 't', num: true, w: 150 }],
    rows: v.type === 'dp'
      ? [{ c: { i: two('Uang Muka', 'Down payment'), q: '1 Lot', p: money(v.dp), d: DASH, t: money(v.dp) } }]
      : v.lines.map(l => ({ c: { i: two(itm(l.code).name, l.code), q: `${l.qty} ${itm(l.code).unit}`, p: money(l.price), d: dash0(l.disc), t: money(lineTot(l)) } })),
    foot: { i: 'Total', t: money(gross(v)) },
  })
}
function collTable(no) {
  const rows = COL.filter(c => c.alloc.some(a => a.inv === no)).sort((a, b) => (a.date < b.date ? -1 : 1))
  return table({
    cols: [{ l: 'Voucher', k: 'v' }, { l: 'Date', k: 'd', w: 120 }, { l: 'Account', k: 'a' }, { l: 'Received', k: 'r', num: true, w: 150 }],
    rows: rows.map(c => { const a = c.alloc.find(x => x.inv === no); return { on: `svOpenBkm('${c.no}')`, c: { v: c.no, d: day(c.date), a: two(esc(accN(c.acct)), esc(giroWord(c) || methodOf(c))), r: money(settle(a)) } } }),
    empty: 'No collection yet',
  })
}
window.svOpenInv = no => {
  const v = invOf(no), c = custOf(v.cust), ap = sum(UMA.filter(a => a.inv === no), a => a.amt), rt = sum(RET.filter(r => r.inv === no), retTotal)
  const ks = [{ label: 'Grand total', value: money(grand(v)) }, { label: 'Down payment applied', value: money(ap) }, { label: 'Returns', value: money(rt) }, { label: 'Collected', value: money(collectedOf(no)) }, { label: 'Left to collect', value: money(invBal(no)), bad: overdueDays(v) > 0 }]
  openSheet({
    crumb: ['Customers', c.name], title: v.no, pill: stPill(v), size: 'wide',
    body: `<div class="ds-kpis ds-kpis--in-sheet kpis" style="margin-bottom:32px">${kpisHTML(ks).replace(/^<div class="ds-kpis kpis">/, '').replace(/<\/div>$/, '')}</div>`
      + facts([['Type', typeWord(v.type)], ['Date', day(v.date)], ['Due', dueCell(v)], ['Terms', termWord(v.term)], ['Sales order', v.so || DASH], ['Delivery note', v.sj || DASH], ['Salesperson', v.sales], ['Warehouse', v.wh || 'HO'], ['No Ref', v.ref || DASH], ['Keterangan', v.note || DASH], ['PPN', v.ppn ? `${v.ppn}%` : DASH]])
      + section('Items', linesTable(v)) + section('Collections', collTable(no)),
    foot: btn('Journal', `svInvJournal('${no}')`) + btn('Open in Sales invoice', `svGoInv('${no}')`),
  })
}
window.svOpenRet = no => {
  const r = RET.find(x => x.no === no), v = invOf(r.inv), c = custOf(r.cust), val = retVal(r)
  openSheet({
    crumb: ['Customers', c.name], title: r.no, pill: '<span class="ds-pill ds-pill--ok">Posted</span>', size: 'wide',
    body: facts([['Date', day(r.date)], ['Invoice', v.no], ['Goods back to stock', r.goods ? 'Yes' : 'No'], ['Credit to customer', money(retTotal(r))]])
      + section('Items returned', table({
        cols: [{ l: 'Item', k: 'i' }, { l: 'Quantity', k: 'q', num: true, w: 120 }, { l: 'Total', k: 't', num: true, w: 150 }],
        rows: r.lines.map(l => ({ c: { i: two(itm(l.code).name, l.code), q: `${l.qty} ${itm(l.code).unit}`, t: money(retValue(r.inv, { [l.code]: l.qty })) } })),
        foot: { i: 'Total', t: money(val) },
      })),
    foot: btn('Journal', `svRetJournal('${no}')`) + btn('Open in Sales return', `svGoRet('${no}')`),
  })
}
window.svOpenBkm = no => {
  const c = COL.find(x => x.no === no), cu = custOf(c.cust)
  openSheet({
    crumb: ['Customers', cu.name], title: c.no, pill: c.giro ? `<span class="ds-pill ds-pill--${c.giro.cleared ? 'ok' : 'warn'}">${giroWord(c)}</span>` : `<span class="ds-pill ds-pill--ok">${c.dir === 'in' ? 'Received' : 'Refunded'}</span>`, size: 'wide',
    body: facts([['Date', day(c.date)], ['Account', accN(c.acct)], ['Method', methodOf(c)], ['Giro due', c.giro ? day(c.giro.due) : DASH]])
      + section('Invoices', table({
        cols: [{ l: 'Invoice', k: 'i' }, { l: 'Discount', k: 'd', num: true, w: 140 }, { l: c.dir === 'in' ? 'Received' : 'Refunded', k: 'r', num: true, w: 150 }],
        rows: c.alloc.map(a => ({ on: `svOpenInv('${a.inv}')`, c: { i: a.inv, d: dash0(a.disc), r: money(Math.abs(a.rec)) } })),
        foot: { i: 'Total', d: dash0(sum(c.alloc, a => a.disc)), r: money(Math.abs(sum(c.alloc, a => a.rec))) },
      })),
  })
}
window.svInvJournal = no => {
  const v = invOf(no)
  const F = Object.assign(clone(v), { applied: UMA.filter(a => a.inv === no).map(a => ({ um: a.um, amt: a.amt })) })
  jSheet(['Sales invoice', no], 'Journal', stPill(v), jrInvoice(F))
}
window.svRetJournal = no => {
  const r = RET.find(x => x.no === no)
  jSheet(['Sales return', no], 'Journal', '<span class="ds-pill ds-pill--ok">Posted</span>', jrReturn({ inv: r.inv, goods: r.goods, qty: rq(r) }))
}
window.svGoInv = no => { closeAll(); loadInv(no); go('sell-invoice') }
window.svGoRet = no => { closeAll(); loadRet(no); go('sell-return') }

/* ═════════ 1 · Sales invoice ═════════ */
const soOf = no => SOS.find(s => s.no === no)
const soFree = (cust, keep) => SOS.filter(s => s.cust === cust && (s.no === keep || !INV.some(v => v.type === 'match' && v.so === s.no)))
function loadInv(no) {
  const v = invOf(no)
  V.F = Object.assign(clone(v), { applied: UMA.filter(a => a.inv === no).map(a => ({ um: a.um, amt: a.amt })), isNew: false })
}
function newInv() {
  const c = CUSTOMERS[0]
  V.F = { no: '', date: TODAY, cust: c.code, type: 'std', term: c.term, due: addD(TODAY, termDays(c.term)), so: '', sj: '', sales: SALES[0], wh: 'HO', ref: '', note: '', disc: 0, ppn: 0, dp: 5000000, lines: [L('KF-001', 10)], applied: [], isNew: true }
}
function umLeft(um, F) {
  return grand(invOf(um)) - sum(UMA.filter(a => a.um === um && a.inv !== F.no), a => a.amt) - sum(F.applied.filter(a => a.um === um), a => a.amt)
}
const umAvail = F => sum(INV.filter(v => v.type === 'dp' && v.cust === F.cust && v.no !== F.no), v => Math.max(0, umLeft(v.no, F)))
function dueNow(F) {
  const rec = !F.isNew
  return grand(F) - sum(F.applied, a => a.amt) - (rec ? sum(RET.filter(r => r.inv === F.no), retTotal) + collectedOf(F.no) : 0)
}
function pickSO(F, no) {
  const s = soOf(no)
  F.so = no
  if (!s) { F.sj = ''; return }
  F.sj = s.sj; F.sales = s.sales; F.term = s.term; F.due = addD(F.date, termDays(s.term)); F.lines = clone(s.lines)
}
window.svDelete = () => { if (!V.F) return; if (!V.F.isNew) return toast('Posted invoice', 'Posted documents are not deleted'); svOpen('__new'); toast('Draft discarded') }
window.svInfo = () => { if (!V.F || V.F.isNew) return toast('Not saved yet', 'Save the invoice first'); svOpenInv(V.F.no) }
window.svSave = () => {
  const F = V.F
  if (!F) return
  if (!F.cust || !F.lines.length) return toast('Check the invoice', 'Customer and at least one line are required')
  let no = F.no
  if (F.isNew) {
    const max = Math.max(0, ...INV.filter(v => v.no.startsWith('PJL/HO/2610/')).map(v => +v.no.slice(-4)))
    no = 'PJL/HO/2610/' + String(1 + max).padStart(4, '0')
    F.no = no
  }
  const data = clone(F)
  delete data.isNew; delete data.applied
  data.no = no; data.due = addD(F.date, termDays(F.term))
  const existing = invOf(no)
  if (existing) Object.assign(existing, data); else INV.push(data)
  for (let i = UMA.length - 1; i >= 0; i--) if (UMA[i].inv === no) UMA.splice(i, 1)
  F.applied.forEach(a => UMA.push({ inv: no, um: a.um, amt: a.amt, date: F.date }))
  F.isNew = false
  loadInv(no)
  render(); toast('Invoice saved', `${no} · ${money(grand(invOf(no)))}`)
}
window.svOpen = no => { if (no === '__new') newInv(); else loadInv(no); render() }
window.svSet = (k, v) => {
  const F = V.F
  if (k === 'cust') {
    F.cust = v; F.term = custOf(v).term; F.due = addD(F.date, termDays(F.term)); F.applied = []
    if (F.type === 'match') { const f = soFree(v, '')[0]; if (f) pickSO(F, f.no); else { F.so = ''; F.sj = ''; F.lines = [] } }
  } else if (k === 'so') { if (F.type === 'match') pickSO(F, v); else F.so = v }
  else if (k === 'term') { F.term = v; F.due = addD(F.date, termDays(v)) }
  else if (k === 'ppn') F.ppn = +v
  else F[k] = v
  render()
}
window.svNum = (k, v) => { V.F[k] = pn(v); render() }
window.svDiscPct = v => { const F = V.F, g = gross(F); F.disc = g ? Math.round(g * pn(v) / 100) : 0; render() }

window.svType = t => {
  const F = V.F
  F.type = t
  if (t === 'match') { const f = soFree(F.cust, F.so)[0]; if (f) pickSO(F, f.no); else { F.so = ''; F.sj = ''; if (!F.lines.length) F.lines = [] } }
  else { if (t === 'std') { F.so = ''; F.sj = '' } if (t !== 'dp' && !F.lines.length) F.lines = [L('KF-001', 10)]; if (t === 'dp') F.sj = '' }
  if (t === 'dp') F.applied = []
  render()
}
window.svLine = (i, k, v) => {
  const l = V.F.lines[i]
  if (k === 'code') { l.code = v; l.price = itm(v).price } else l[k] = pn(v)
  render()
}
window.svDel = i => { V.F.lines.splice(i, 1); render() }
window.svAdd = () => { const F = V.F, free = ITEMS.find(i => !F.lines.some(l => l.code === i.code)) || ITEMS[0]; F.lines.push(L(free.code, 1)); render() }
window.svJr = () => { const F = V.F; jSheet(['Sales invoice', F.no || 'New invoice'], 'Journal', `<span class="ds-pill ds-pill--neutral">${typeWord(F.type)}</span>`, jrInvoice(F)) }
window.svApplyOpen = () => {
  const F = V.F, due = dueNow(F)
  const ums = INV.filter(v => v.type === 'dp' && v.cust === F.cust && v.no !== F.no && umLeft(v.no, F) > 0)
  let left = due
  V.ap = {}
  ums.forEach(u => { const a = Math.min(umLeft(u.no, F), Math.max(0, left)); V.ap[u.no] = a; left -= a })
  openSheet({
    crumb: ['Sales invoice', F.no || 'New invoice'], title: 'Apply down payment', size: 'wide',
    body: kpisHTML([{ label: 'Left to collect', value: money(due) }, { label: 'Down payment available', value: money(umAvail(F)) }]).replace('ds-kpis kpis', 'ds-kpis kpis" style="margin-bottom:24px') + table({
      cols: [{ l: 'Down payment invoice', k: 'i' }, { l: 'Date', k: 'd', w: 120 }, { l: 'Reference', k: 'r', w: 190 }, { l: 'Remaining', k: 'm', num: true, w: 140 }, { l: 'Apply', k: 'a', num: true, w: 150 }],
      rows: ums.map(u => ({ c: { i: u.no, d: day(u.date), r: u.so || DASH, m: money(umLeft(u.no, F)), a: cin(num(V.ap[u.no]), `svApAmt('${u.no}',this.value)`) } })),
      empty: 'No down payment left for this customer',
    }),
    foot: btn('Apply', 'svApplyGo()'),
  })
}
window.svApAmt = (um, v) => { V.ap[um] = pn(v) }
window.svApplyGo = () => {
  const F = V.F
  let n = 0
  Object.entries(V.ap).forEach(([um, amt]) => {
    const a = Math.min(amt, umLeft(um, F))
    if (a > 0) { F.applied.push({ um, amt: a }); n += a }
  })
  closeSheet()
  if (n) toast('Down payment applied', money(n))
  render()
}
function pgInvoice() {
  if (!V.F) loadInv('PJL/HO/2609/0156')
  const F = V.F, c = custOf(F.cust), g = grand(F), ap = sum(F.applied, a => a.amt), due = dueNow(F), col = F.isNew ? 0 : collectedOf(F.no)
  const od = !F.isNew && due > 0 && F.due < TODAY
  const bal = custBal(F.cust)
  const ks = [{ label: 'Left to collect', value: money(due), bad: od }, { label: 'Collected', value: money(col) }, { label: 'Down payment applied', value: money(ap) }, { label: 'Customer limit used', value: `${money(bal)} of ${money(c.limit)}` }]
  const recOpts = [['__new', 'New invoice'], ...INV.slice().sort((a, b) => (a.date < b.date ? 1 : -1)).map(v => [v.no, `${v.no} · ${custOf(v.cust).name}`])]
  const barHTML = bar(`<span class="mute">Invoice</span>`, barSel(recOpts, F.isNew ? '__new' : F.no, 'svOpen(this.value)'))
  const sos = soFree(F.cust, F.so)
  const flds = [
    field('Invoice no', inp(F.no, null, { ro: true, ph: 'Assigned when saved' })),
    field('Date', inp(day(F.date), null, { ro: true })),
    field('Customer', sel(CUSTOMERS.map(x => [x.code, `${x.name} · ${x.code}`]), F.cust, "svSet('cust',this.value)"), 's2'),
    field('Invoice type', sel([['match', 'Matching SO'], ['std', 'Standard'], ['dp', 'Down payment']], F.type, 'svType(this.value)')),
    field('Warehouse', sel(LOCS.map(l => [l[0], `${l[0]} · ${l[1]}`]), F.wh || 'HO', "svSet('wh',this.value)")),
    field('No Ref', inp(F.ref || '', "svSet('ref',this.value)")),
    field('Keterangan', inp(F.note || '', "svSet('note',this.value)"), 'span2'),
  ]
  if (F.type === 'match') {
    flds.push(field('SO no', sel(sos.length ? sos.map(s => [s.no, s.no]) : [['', 'No open order']], F.so, "svSet('so',this.value)")))
    const s = soOf(F.so)
    flds.push(field('Delivery note no', sel([['', 'None, stock goes out now'], ...(s && s.sj ? [[s.sj, s.sj]] : [])], F.sj, "svSet('sj',this.value)")))
  }
  if (F.type === 'dp') flds.push(field('SO no', sel([['', 'None'], ...SOS.filter(s => s.cust === F.cust).map(s => [s.no, s.no])], F.so, "svSet('so',this.value)")))
  flds.push(field('Salesperson', sel(SALES.map(s => [s, s]), F.sales, "svSet('sales',this.value)")))
  flds.push(field('Terms', sel(TERMS.map(t => [t[0], t[1]]), F.term, "svSet('term',this.value)")))
  flds.push(field('Due date', inp(day(F.due), null, { ro: true })))
  if (F.type !== 'dp') flds.push(field('Total discount', inp(num(F.disc), "svNum('disc',this.value)", { num: true })))
  if (F.type !== 'dp') flds.push(field('Discount %', inp(F.disc && gross(F) ? (F.disc / gross(F) * 100).toFixed(1) : '', 'svDiscPct(this.value)', { num: true })))
  flds.push(field('PPN', sel([['0', 'No PPN'], ['11', 'PPN 11%']], String(F.ppn), "svSet('ppn',this.value)")))
  /* lines */
  const ro = F.type === 'match'
  const lineRows = F.type === 'dp'
    ? [{ c: { i: two('Uang Muka', 'Down payment'), q: '1', u: 'Lot', p: cin(num(F.dp), "svNum('dp',this.value)"), d: DASH, t: money(F.dp), x: '' } }]
    : F.lines.map((l, i) => ({ c: {
      i: F.type === 'std' ? `<select class="cin l" onchange="svLine(${i},'code',this.value)">${ITEMS.map(t => `<option value="${t.code}" ${t.code === l.code ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select>` : two(itm(l.code).name, l.code),
      q: cin(num(l.qty), `svLine(${i},'qty',this.value)`), u: itm(l.code).unit,
      p: ro ? money(l.price) : cin(num(l.price), `svLine(${i},'price',this.value)`),
      d: ro ? dash0(l.disc) : cin(num(l.disc), `svLine(${i},'disc',this.value)`),
      t: money(lineTot(l)), h: money(itm(l.code).cost * l.qty), x: ro && F.lines.length < 2 ? '' : iconBtn('trash', `svDel(${i})`, 'Remove line'),
    } }))
  const linesHTML = table({
    cols: [{ l: 'Item', k: 'i' }, { l: 'Quantity', k: 'q', num: true, w: 100 }, { l: 'Unit', k: 'u', w: 76 }, { l: 'Price', k: 'p', num: true, w: 130 }, { l: 'Discount', k: 'd', num: true, w: 110 }, { l: 'Total', k: 't', num: true, w: 140 }, { l: 'HPP', k: 'h', num: true, w: 120 }, { l: '', k: 'x', w: 50 }],
    rows: lineRows, foot: { i: 'Total', q: F.type === 'dp' ? '' : num(sum(F.lines, l => l.qty)), t: money(gross(F)), h: money(sum(F.lines, l => itm(l.code).cost * l.qty)) }, empty: 'No items yet. Pick a sales order.',
  })
  const avail = F.type === 'dp' ? grand(F) - (F.isNew ? 0 : umApplied(F.no)) : umAvail(F)
  const canApply = F.type !== 'dp' && umAvail(F) > 0 && due > 0
  const totals = `<div class="kpi-row">${kpisHTML([{ label: 'Total', value: money(net(F)) }, { label: 'PPN', value: money(ppnOf(F)) }, { label: 'Grand total', value: money(g) }, { label: 'Remaining down payment', value: money(avail) }])}`
    + `${F.type === 'dp' ? '' : `<button class="ds-btn ds-btn--primary" type="button" ${canApply ? '' : 'disabled'} onclick="svApplyOpen()">Apply down payment</button>`}</div><p class="mute" style="margin:-12px 0 20px">Sales account 4010110001 · Penjualan</p>`
  /* tabs under the lines */
  const umRows = F.type === 'dp'
    ? [{ i: F.no || 'New invoice', d: day(F.date), r: F.so || DASH, t: money(g), a: money(F.isNew ? 0 : umApplied(F.no)), m: money(avail) }]
    : INV.filter(v => v.type === 'dp' && v.cust === F.cust && v.no !== F.no && (F.applied.some(a => a.um === v.no) || umLeft(v.no, F) > 0))
      .map(v => ({ i: v.no, d: day(v.date), r: v.so || DASH, t: money(grand(v)), a: money(sum(F.applied.filter(a => a.um === v.no), a => a.amt)), m: money(umLeft(v.no, F)) }))
  const umHTML = table({
    cols: [{ l: 'Down payment invoice', k: 'i' }, { l: 'Date', k: 'd', w: 120 }, { l: 'Reference', k: 'r', w: 190 }, { l: 'Total', k: 't', num: true, w: 140 }, { l: 'Applied', k: 'a', num: true, w: 140 }, { l: 'Remaining', k: 'm', num: true, w: 140 }],
    rows: umRows.map(r => ({ c: r })), empty: 'No down payment for this customer',
  })
  let before = F.isNew ? 0 : grand(F) - sum(F.applied, a => a.amt)
  const pays = F.isNew ? [] : COL.filter(x => x.alloc.some(a => a.inv === F.no)).sort((a, b) => (a.date < b.date ? -1 : 1))
  const payRows = pays.map(x => {
    const a = x.alloc.find(y => y.inv === F.no), rcv = before
    before -= settle(a)
    return { on: `svOpenBkm('${x.no}')`, c: { v: x.no, d: day(x.date), a: two(esc(accN(x.acct)), esc(methodOf(x))), r: money(rcv), g: money(a.rec), s: stat(x.giro ? [x.giro.cleared ? 'ok' : 'warn', giroWord(x)] : ['ok', x.dir === 'in' ? 'Received' : 'Refunded']) } }
  })
  const payHTML = table({
    cols: [{ l: 'Voucher', k: 'v' }, { l: 'Date', k: 'd', w: 120 }, { l: 'Account', k: 'a', w: 230 }, { l: 'Receivable', k: 'r', num: true, w: 130 }, { l: 'Received', k: 'g', num: true, w: 130 }, { l: 'Status', k: 's', w: 190 }],
    rows: payRows, empty: 'No collection yet',
    foot: pays.length ? { v: 'Total', g: money(sum(pays, x => sum(x.alloc.filter(a => a.inv === F.no), a => a.rec))) } : null,
  })
  const so = soOf(F.so)
  const flowRows = so ? so.lines.map(l => {
    const il = F.lines.find(x => x.code === l.code), sj = so.sj ? l.qty : 0, bq = il ? il.qty : 0
    return { c: { i: two(itm(l.code).name, l.code), a: num(l.qty), b: num(sj), c: num(bq), d: num(l.qty - sj), e: num(sj - bq) } }
  }) : []
  const flowHTML = table({
    cols: [{ l: 'Item', k: 'i' }, { l: 'SO', k: 'a', num: true, w: 100 }, { l: 'Delivered', k: 'b', num: true, w: 110 }, { l: 'Invoiced', k: 'c', num: true, w: 110 }, { l: 'Left on SO', k: 'd', num: true, w: 120 }, { l: 'Left to invoice', k: 'e', num: true, w: 140 }],
    rows: flowRows, empty: 'No sales order',
  })
  const tabs = [['um', 'Down payment', umRows.length], ['pay', 'Payment', pays.length], ...(F.type === 'match' ? [['flow', 'SO · SJ · Invoice']] : [])]
  const cur = tabOf('sell-invoice-lines', 'pay'), tab = tabs.some(t => t[0] === cur) ? cur : 'pay'
  const addBtn = F.type === 'std' ? btn('Add item', 'svAdd()') : ''
  const body = CSS + barHTML + `<div class="sv-grid">${flds.join('')}</div>` + section('Items', linesHTML, addBtn) + totals
    + `<div class="sv-tabs">${tabsHTML('sell-invoice-lines', tabs, tab)}</div>` + (tab === 'um' ? umHTML : tab === 'pay' ? payHTML : flowHTML)
  return page({ title: 'Sales invoice', actions: [{ label: 'Save invoice', on: 'svSave()' }, { label: 'Journal', on: 'svJr()' }, { label: 'Del', on: 'svDelete()', kind: 'secondary' }, { label: 'Info', on: 'svInfo()', kind: 'secondary' }, { label: 'New invoice', on: "svOpen('__new')", icon: 'plus' }, { label: 'Print', on: "printPage('Sales invoice')", kind: 'secondary', icon: 'printer' }], kpis: ks, body })
}

/* ═════════ 2 · Sales return ═════════ */
function loadRet(no) {
  const r = RET.find(x => x.no === no)
  V.R = { no, date: r.date, cust: r.cust, inv: r.inv, goods: r.goods, qty: rq(r), isNew: false }
}
function newRet() {
  const c = CUSTOMERS[0], v = INV.find(x => x.cust === c.code && x.type !== 'dp' && x.lines.length)
  V.R = { no: '', date: TODAY, cust: c.code, inv: v.no, goods: true, qty: { [v.lines[0].code]: 1 }, isNew: true }
}
const retInvs = c => INV.filter(v => v.cust === c && v.type !== 'dp' && !v.disc)
const retMax = (R, code) => { const l = invOf(R.inv).lines.find(x => x.code === code); return l.qty - sum(RET.filter(r => r.inv === R.inv && r.no !== R.no), r => sum(r.lines.filter(x => x.code === code), x => x.qty)) }
window.srSave = () => {
  const R = V.R
  if (!R) return
  const lines = Object.entries(R.qty).filter(([, q]) => q > 0).map(([code, qty]) => ({ code, qty }))
  if (!lines.length) return toast('Check the return', 'Pick at least one item to return')
  let no = R.no
  if (R.isNew) {
    const max = Math.max(0, ...RET.filter(r => r.no.startsWith('RJL/HO/2610/')).map(r => +r.no.slice(-4)))
    no = 'RJL/HO/2610/' + String(1 + max).padStart(4, '0')
    R.no = no
  }
  const data = { no, date: R.date, cust: R.cust, inv: R.inv, goods: R.goods, lines }
  const existing = RET.find(r => r.no === no)
  if (existing) Object.assign(existing, data); else RET.push(data)
  R.isNew = false
  render(); toast('Return saved', `${no} · ${money(retTotal(data))}`)
}
window.srOpen = no => { if (no === '__new') newRet(); else loadRet(no); render() }
window.srSet = (k, v) => {
  const R = V.R
  if (k === 'cust') { R.cust = v; R.inv = retInvs(v)[0].no; R.qty = { [invOf(R.inv).lines[0].code]: 1 } }
  else if (k === 'inv') { R.inv = v; R.qty = { [invOf(v).lines[0].code]: 1 } }
  else if (k === 'goods') R.goods = v === 'yes'
  render()
}
window.srQty = (code, v) => { const R = V.R; R.qty[code] = Math.min(pn(v), retMax(R, code)); render() }
function jrReturn(R) {
  const val = retValue(R.inv, R.qty), p = retPpn(R.inv, val), cost = sum(invOf(R.inv).lines, l => (R.qty[l.code] || 0) * itm(l.code).cost)
  const blocks = [blk('Return', [jr(acc('4010214001', 'HO'), val, 0), ...(p ? [jr(acc('2012101003', 'HO'), p, 0)] : []), jr(AR, 0, val + p)])]
  if (R.goods) blocks.push(blk('Goods back to the warehouse', [jr(acc('1011201001', 'HO', 'Persediaan Barang Dagangan'), cost, 0), jr(acc('5010110001', 'HO'), 0, cost)]))
  return blocks
}
window.srJr = () => { const R = V.R; jSheet(['Sales return', R.no || 'New return'], 'Journal', `<span class="ds-pill ds-pill--neutral">${R.goods ? 'Goods back' : 'Credit only'}</span>`, jrReturn(R)) }
function pgReturn() {
  if (!V.R) loadRet('RJL/HO/2610/0005')
  const R = V.R, v = invOf(R.inv), c = custOf(R.cust), val = retValue(R.inv, R.qty), p = retPpn(R.inv, val), tot = val + p
  const now = invBal(R.inv), before = R.isNew ? now : now + tot, after = R.isNew ? now - tot : now
  const ks = [{ label: 'Credit to customer', value: money(tot) }, { label: 'Invoice left before', value: money(before) }, { label: 'Invoice left after', value: money(after) }, { label: 'Customer receivable', value: money(custBal(R.cust) - (R.isNew ? tot : 0)) }]
  const recOpts = [['__new', 'New return'], ...RET.map(r => [r.no, `${r.no} · ${custOf(r.cust).name}`])]
  const barHTML = bar(`<span class="mute">Return</span>`, barSel(recOpts, R.isNew ? '__new' : R.no, 'srOpen(this.value)'))
  const invs = retInvs(R.cust)
  const flds = [
    field('Return no', inp(R.no, null, { ro: true, ph: 'Assigned when saved' })),
    field('Date', inp(day(R.date), null, { ro: true })),
    field('Customer', sel(CUSTOMERS.map(x => [x.code, `${x.name} · ${x.code}`]), R.cust, "srSet('cust',this.value)"), 's2'),
    field('Invoice', sel(invs.map(x => [x.no, `${x.no} · ${day(x.date)}`]), R.inv, "srSet('inv',this.value)"), 's2'),
    field('Terms', inp(termWord(v.term), null, { ro: true })),
    field('Due date', inp(day(v.due), null, { ro: true })),
    field('Goods back to the warehouse', sel([['yes', 'Yes, back into stock'], ['no', 'No, credit only']], R.goods ? 'yes' : 'no', "srSet('goods',this.value)")),
    field('PPN', inp(v.ppn ? `PPN ${v.ppn}%` : 'No PPN', null, { ro: true })),
  ]
  const rows = v.lines.map(l => {
    const q = R.qty[l.code] || 0, unit = (l.qty * l.price - l.disc) / l.qty
    return { c: { i: two(itm(l.code).name, l.code), s: `${l.qty} ${itm(l.code).unit}`, q: cin(num(q), `srQty('${l.code}',this.value)`), p: money(Math.round(unit)), t: money(retValue(R.inv, { [l.code]: q })) } }
  })
  const lines = table({
    cols: [{ l: 'Item', k: 'i' }, { l: 'Sold', k: 's', num: true, w: 110 }, { l: 'Return quantity', k: 'q', num: true, w: 150 }, { l: 'Unit price', k: 'p', num: true, w: 140 }, { l: 'Total', k: 't', num: true, w: 160 }],
    rows, foot: { i: 'Total', q: num(sum(Object.values(R.qty), x => x)), t: money(val) },
  })
  const totals = kpisHTML([{ label: 'Total', value: money(val) }, { label: 'PPN', value: money(p) }, { label: 'Credit to customer', value: money(tot) }]).replace('ds-kpis kpis', 'ds-kpis kpis" style="margin-bottom:24px')
  /* payment: the vouchers on the source invoice from the return on */
  const pays = COL.filter(x => x.alloc.some(a => a.inv === R.inv) && (R.isNew || x.date >= R.date)).sort((a, b) => (a.date < b.date ? -1 : 1))
  const payHTML = table({
    cols: [{ l: 'Voucher', k: 'v' }, { l: 'Date', k: 'd', w: 120 }, { l: 'Account', k: 'a', w: 230 }, { l: 'Direction', k: 'w', w: 120 }, { l: 'Amount', k: 'g', num: true, w: 150 }],
    rows: pays.map(x => ({ on: `svOpenBkm('${x.no}')`, c: { v: x.no, d: day(x.date), a: two(esc(accN(x.acct)), esc(methodOf(x))), w: x.dir === 'in' ? 'Money in' : 'Money out', g: money(x.alloc.filter(a => a.inv === R.inv).reduce((s, a) => s + a.rec, 0)) } })),
    empty: 'No voucher yet',
  })
  const body = CSS + barHTML + `<div class="sv-grid">${flds.join('')}</div>` + section('Items returned', lines) + totals
    + `<div class="sv-tabs">${tabsHTML('sell-return-tabs', [['pay', 'Payment', pays.length]], 'pay')}</div>` + payHTML
  return page({ title: 'Sales return', actions: [{ label: 'Save return', on: 'srSave()' }, { label: 'Journal', on: 'srJr()' }, { label: 'New return', on: "srOpen('__new')", icon: 'plus' }, { label: 'Print', on: "printPage('Sales return')", kind: 'secondary', icon: 'printer' }], kpis: ks, body })
}

/* ═════════ 3 · Cash sale & till ═════════ */
const shopName = s => (LOCS.find(l => l[0] === s) || [s, s])[1]
const shopOpts = LOCS.filter(l => l[0] !== 'HO').map(l => [l[0], l[1]])
const shopBar = () => bar(`<span class="mute">Shop</span>`, barSel(shopOpts, SH.shop, "svShop(this.value)"))
window.svShop = v => { SH.shop = v; render() }
const cashGross = C => sum(C.lines, lineTot2)
function lineTot2(l) { return l.qty * itm(l.code).price - (l.disc || 0) }
const cashNet = C => cashGross(C) - C.disc
const cashPpn = C => Math.round(cashNet(C) * C.ppn / 100)
const cashGrand = C => cashNet(C) + cashPpn(C)
const cashCost = lines => sum(lines, l => l.qty * itm(l.code).cost)
function jrCash(total, netv, ppn, cost) {
  const s = SH.shop
  return [blk(`Sale at ${shopName(s)}`, [
    jr({ code: acc12('1011001001', s), name: `Cash on Hand ${s}` }, total, 0),
    jr(acc('4010110001', s), 0, netv),
    ...(ppn ? [jr(acc('2012101003', s), 0, ppn)] : []),
    jr(acc('5010110001', s), cost, 0),
    jr(acc('1011201001', s, 'Persediaan Barang Dagangan'), 0, cost),
  ])]
}
window.svCash = (k, v) => { if (k === 'ppn') CASHS.ppn = +v; else CASHS[k] = pn(v); render() }
window.svCashQty = (i, v) => { CASHS.lines[i].qty = Math.max(1, pn(v)); render() }
window.svCashDisc = (i, v) => { CASHS.lines[i].disc = pn(v); render() }
window.svCashDel = i => { CASHS.lines.splice(i, 1); render() }
window.svCashJr = () => jSheet(['Cash sale', shopName(SH.shop)], 'Posts to', `<span class="ds-pill ds-pill--ok">Cash</span>`, jrCash(cashGrand(CASHS), cashNet(CASHS), cashPpn(CASHS), cashCost(CASHS.lines)))
window.svTillQty = (i, v) => { TILL.cart[i].qty = Math.max(1, pn(v)); render() }
window.svTillDel = i => { TILL.cart.splice(i, 1); render() }
window.svTender = v => { TILL.tender = String(pn(v) || ''); render() }
const tillTotal = () => sum(TILL.cart, l => l.qty * itm(l.code).price)
window.svTillJr = () => jSheet(['Till', shopName(SH.shop)], 'Posts to', `<span class="ds-pill ds-pill--ok">Cash</span>`, jrCash(tillTotal(), tillTotal(), 0, cashCost(TILL.cart)))
window.svCashSave = () => {
  const C = CASHS, g = cashGrand(C)
  if (!C.lines.length) return toast('Nothing to save', 'Add at least one item to the cash sale')
  TILL.sales.push({ no: `PJP/${SH.shop}/2610/${String(189 + TILL.sales.length - 1).padStart(4, '0')}`, time: '11:' + String(20 + TILL.sales.length).padStart(2, '0'), total: g })
  C.lines = []; C.disc = 0; C.ppn = 0
  render(); toast('Cash sale saved', money(g))
}
window.svPay = () => {
  const t = tillTotal()
  if (!t) { toast('Nothing to pay', 'Scan an item first'); return }
  const tender = pn(TILL.tender) || t
  if (tender < t) { toast('Not enough', `${money(t - tender)} short`); return }
  TILL.sales.push({ no: `PJP/${SH.shop}/2610/${String(188 + TILL.sales.length - 1).padStart(4, '0')}`, time: '11:' + String(20 + TILL.sales.length).padStart(2, '0'), total: t })
  TILL.cart = []; TILL.tender = ''
  toast('Drawer open', `${money(t)} in cash${tender > t ? `, change ${money(tender - t)}` : ''}`)
  render()
}
window.svScan = kind => {
  const el = $('.sv-scan input'), v = el ? el.value.trim() : ''
  if (!v) return
  const it = ITEMS.find(i => i.bc === v || i.code.toLowerCase() === v.toLowerCase())
  if (!it) { toast('No item with that barcode', v); if (el) el.select(); return }
  const arr = kind === 'cash' ? CASHS.lines : TILL.cart, l = arr.find(x => x.code === it.code)
  if (l) l.qty++; else arr.push({ code: it.code, qty: 1, disc: 0 })
  render()
  const n = $('.sv-scan input'); if (n) n.focus()
}
const scanBox = kind => `<label class="ds-search sv-scan" style="flex:1 1 320px;max-width:420px">${ico('search')}<input type="text" placeholder="Scan or type a barcode" onkeydown="if(event.key==='Enter'){event.preventDefault();svScan('${kind}')}"></label>`
function pgCash() {
  const tab = tabOf('sell-cash', 'cash'), s = SH.shop
  const tabs = [['cash', 'Cash sale'], ['till', 'Till (POS)']]
  if (tab === 'cash') {
    const C = CASHS, g = cashGrand(C)
    const ks = [{ label: 'Sale total', value: money(g) }, { label: 'Receivable created', value: money(0) }, { label: 'Paid in cash', value: money(g) }]
    const flds = [
      field('Invoice no', inp('', null, { ro: true, ph: 'Assigned when saved' })),
      field('Date', inp(day(TODAY), null, { ro: true })),
      field('Customer', inp('CASH · CSH', null, { ro: true })),
      field('Warehouse', inp(`Stock ${shopName(s)}`, null, { ro: true })),
      field('Total discount', inp(num(C.disc), "svCash('disc',this.value)", { num: true })),
      field('PPN', sel([['0', 'No PPN'], ['11', 'PPN 11%']], String(C.ppn), "svCash('ppn',this.value)")),
    ]
    const rows = C.lines.map((l, i) => ({ c: {
      bc: itm(l.code).bc, i: two(itm(l.code).name, l.code), q: cin(num(l.qty), `svCashQty(${i},this.value)`), u: itm(l.code).unit, p: money(itm(l.code).price),
      d: cin(num(l.disc), `svCashDisc(${i},this.value)`), t: money(lineTot2(l)), x: iconBtn('trash', `svCashDel(${i})`, 'Remove line'),
    } }))
    const lines = table({
      cols: [{ l: 'Barcode', k: 'bc', w: 150 }, { l: 'Item', k: 'i' }, { l: 'Quantity', k: 'q', num: true, w: 100 }, { l: 'Unit', k: 'u', w: 70 }, { l: 'Price', k: 'p', num: true, w: 120 }, { l: 'Discount', k: 'd', num: true, w: 110 }, { l: 'Total', k: 't', num: true, w: 130 }, { l: '', k: 'x', w: 56 }],
      rows, foot: { i: 'Total', q: num(sum(C.lines, l => l.qty)), t: money(cashGross(C)) }, empty: 'No items yet. Scan a barcode.',
    })
    const totals = kpisHTML([{ label: 'Total', value: money(cashNet(C)) }, { label: 'PPN', value: money(cashPpn(C)) }, { label: 'Grand total', value: money(g) }]).replace('ds-kpis kpis', 'ds-kpis kpis" style="margin-top:24px')
    const body = CSS + bar(`<span class="mute">Shop</span>`, barSel(shopOpts, s, 'svShop(this.value)'), scanBox('cash')) + `<div class="sv-big">${money(g)}</div><div class="sv-grid">${flds.join('')}</div>` + section('Items', lines) + totals
    return page({ title: 'Cash sale & till', tabs, tab, actions: [{ label: 'Posts to', on: 'svCashJr()' }, { label: 'Save sale', on: 'svCashSave()' }], kpis: ks, body })
  }
  /* till */
  const t = tillTotal(), tender = pn(TILL.tender) || t, change = Math.max(0, tender - t)
  const sessionCash = sum(TILL.sales, x => x.total), float = KAS[2].open
  const ks = [{ label: 'Sales this session', value: String(TILL.sales.length) }, { label: 'Cash taken', value: money(sessionCash) }, { label: 'In the drawer', value: money(float + sessionCash) }]
  const rows = TILL.cart.map((l, i) => ({ c: {
    i: two(itm(l.code).name, itm(l.code).bc), q: cin(num(l.qty), `svTillQty(${i},this.value)`), p: money(itm(l.code).price), t: money(l.qty * itm(l.code).price), x: iconBtn('trash', `svTillDel(${i})`, 'Remove line'),
  } }))
  const cart = table({
    cols: [{ l: 'Item', k: 'i' }, { l: 'Quantity', k: 'q', num: true, w: 100 }, { l: 'Price', k: 'p', num: true, w: 130 }, { l: 'Total', k: 't', num: true, w: 140 }, { l: '', k: 'x', w: 56 }],
    rows, foot: { i: 'Total', q: num(sum(TILL.cart, l => l.qty)), t: money(t) }, empty: 'Scan the first item',
  })
  const recent = table({
    cols: [{ l: 'Receipt', k: 'n' }, { l: 'Time', k: 'h', w: 100 }, { l: 'Cash', k: 't', num: true, w: 150 }],
    rows: TILL.sales.slice().reverse().map(x => ({ c: { n: x.no, h: x.time, t: money(x.total) } })), foot: { n: 'Total', t: money(sessionCash) },
  })
  const drawer = `<div class="card7 sv-two"><div class="sv-big" style="font-size:40px;line-height:48px;margin:0">${money(t)}</div>`
    + field('Cash received', inp(TILL.tender ? num(pn(TILL.tender)) : '', 'svTender(this.value)', { num: true, ph: money(t) }))
    + `<div class="ds-fact"><dt>Change</dt><dd>${money(change)}</dd></div>${btn('Pay cash', 'svPay()')}`
    + `<div class="ds-fact"><dt>Cash account</dt><dd>${acc12('1011001001', s)} · Cash on Hand ${s}</dd></div></div>`
  const body = CSS + shopBar().replace('<span class="bar-spacer"></span></div>', `${scanBox('till')}<span class="bar-spacer"></span></div>`)
    + `<div class="sv-till"><div>${section('Sale', cart)}${section('This session', recent)}</div><div>${drawer}</div></div>`
  return page({ title: 'Cash sale & till', tabs, tab, actions: [{ label: 'Posts to', on: 'svTillJr()' }], kpis: ks, body })
}

/* ═════════ 4 · Customer hub ═════════ */
function pgHub() {
  const id = 'sell-info', cu = filt(id, 'cust', CUSTOMERS[0].code), c = custOf(cu), tab = tabOf(id, 'inv'), q = S.q[id] || ''
  const bal = custBal(cu), od = overdueOf(cu)
  const ks = [{ label: 'Receivable', value: money(bal) }, { label: 'Limit used', value: `${money(bal)} of ${money(c.limit)}` }, { label: 'Overdue', value: money(od), bad: od > 0 }, { label: 'Terms', value: termWord(c.term) }]
  const invs = INV.filter(v => v.cust === cu), rets = RET.filter(r => r.cust === cu), cols = COL.filter(x => x.cust === cu)
  const tabs = [['inv', 'Invoices & returns', invs.length + rets.length], ['col', 'Collections', cols.length], ['sum', 'Receivable summary'], ['led', 'Customer ledger']]
  const pick = `<div class="ds-bar" style="margin-bottom:24px"><span class="mute">Customer</span>${chips(id, 'cust', CUSTOMERS.map(x => [x.code, x.name]), CUSTOMERS[0].code)}<span class="bar-spacer"></span></div>`
  let inner = ''
  if (tab === 'inv') {
    const f = filt(id, 'kind', 'all')
    const rows = []
    const list = [...invs.map(v => ({ k: 'inv', d: v.date, v })), ...rets.map(r => ({ k: 'ret', d: r.date, r }))].sort((a, b) => (a.d < b.d ? 1 : -1))
    const open = invs.filter(v => invBal(v.no) > 0).length
    list.forEach(x => {
      if (x.k === 'inv') {
        const v = x.v
        if (f === 'ret' || (f === 'open' && invBal(v.no) <= 0) || !hit(q, v.no, v.so, v.sj, typeWord(v.type))) return
        rows.push({ on: `svOpenInv('${v.no}')`, c: { n: two(v.no, esc(v.type === 'match' ? `Matching ${v.so}` : typeWord(v.type))), d: day(v.date), u: dueCell(v), t: money(grand(v)), l: money(invBal(v.no)), s: stat(invState(v)) }, tot: grand(v), left: invBal(v.no) })
      } else {
        const r = x.r
        if (f === 'inv' || f === 'open' || !hit(q, r.no, r.inv)) return
        rows.push({ on: `svOpenRet('${r.no}')`, c: { n: two(r.no, `Return of ${r.inv}`), d: day(r.date), u: DASH, t: money(-retTotal(r)), l: DASH, s: stat(['neutral', 'Posted']) }, tot: -retTotal(r), left: 0 })
      }
    })
    inner = bar(chips(id, 'kind', [['all', 'All', invs.length + rets.length], ['inv', 'Invoices', invs.length], ['ret', 'Returns', rets.length], ['open', 'Open', open]], 'all'), search(id, 'Search invoices'))
      + table({
        cols: [{ l: 'Document', k: 'n' }, { l: 'Date', k: 'd', w: 120 }, { l: 'Due', k: 'u', w: 120 }, { l: 'Total', k: 't', num: true, w: 140 }, { l: 'Left to collect', k: 'l', num: true, w: 150 }, { l: 'Status', k: 's', w: 130 }],
        rows, foot: { n: 'Total', t: money(sum(rows, r => r.tot)), l: money(sum(rows, r => r.left)) }, empty: 'No documents',
      })
  } else if (tab === 'col') {
    const rows = cols.filter(x => hit(q, x.no, ...x.alloc.map(a => a.inv))).sort((a, b) => (a.date < b.date ? 1 : -1)).map(x => ({
      on: `svOpenBkm('${x.no}')`,
      c: { n: x.no, d: day(x.date), i: x.alloc.length > 1 ? `${x.alloc[0].inv} +${x.alloc.length - 1}` : x.alloc[0].inv, r: money(sum(x.alloc, a => a.rec)), c: dash0(sum(x.alloc, a => a.disc)), a: two(esc(accN(x.acct)), esc(giroWord(x) || methodOf(x))) },
      rec: sum(x.alloc, a => a.rec), disc: sum(x.alloc, a => a.disc),
    }))
    inner = bar(search(id, 'Search vouchers'))
      + table({
        cols: [{ l: 'Voucher', k: 'n', w: 170 }, { l: 'Date', k: 'd', w: 115 }, { l: 'Invoice', k: 'i', w: 190 }, { l: 'Received', k: 'r', num: true, w: 130 }, { l: 'Discount', k: 'c', num: true, w: 100 }, { l: 'Account', k: 'a' }],
        rows, foot: { n: 'Total', r: money(sum(rows, r => r.rec)), c: dash0(sum(rows, r => r.disc)) }, empty: 'No collections',
      })
  } else if (tab === 'sum') {
    const ps = [PER.sep, PER.oct].map(p => ({ p, s: summ(cu, p[0], p[1]) }))
    const rows = ps.map(({ p, s }) => ({ c: { m: p[2], o: money(s.open), a: money(s.sales), d: money(s.dp), r: money(-s.ret), k: money(-s.cl), z: money(s.close) } }))
    const a = ps[0].s, z = ps[1].s
    inner = table({
      cols: [{ l: 'Month', k: 'm', w: 110 }, { l: 'Opening', k: 'o', num: true }, { l: 'Credit sales', k: 'a', num: true }, { l: 'Down payments', k: 'd', num: true }, { l: 'Returns', k: 'r', num: true }, { l: 'Collections', k: 'k', num: true }, { l: 'Closing', k: 'z', num: true }],
      rows, foot: { m: 'Total', o: money(a.open), a: money(a.sales + z.sales), d: money(a.dp + z.dp), r: money(-(a.ret + z.ret)), k: money(-(a.cl + z.cl)), z: money(z.close) },
    })
  } else {
    const rows = ledger(cu).filter(r => hit(q, r.doc, r.desc)).map(r => ({
      on: r.open, c: { d: day(r.date), n: two(r.doc, esc(r.desc)), u: r.due ? (r.v && overdueDays(r.v) > 0 ? `<span class="late">${day(r.due)}</span>` : day(r.due)) : DASH, dr: dash0(r.dr), cr: dash0(r.cr), b: money(r.bal) },
    }))
    const all = ledger(cu)
    inner = bar(search(id, 'Search ledger'))
      + table({
        cols: [{ l: 'Date', k: 'd', w: 115 }, { l: 'Document', k: 'n' }, { l: 'Due', k: 'u', w: 115 }, { l: 'Debit', k: 'dr', num: true, w: 130 }, { l: 'Credit', k: 'cr', num: true, w: 130 }, { l: 'Balance', k: 'b', num: true, w: 140 }],
        rows, foot: { d: 'Total', dr: money(sum(all, r => r.dr)), cr: money(sum(all, r => r.cr)), b: money(all.length ? all[all.length - 1].bal : 0) }, empty: 'No entries',
      })
  }
  return page({ title: 'Customer hub', actions: [{ label: 'New sale', on: "go('sell-cash')", icon: 'plus' }, { label: 'New invoice', on: "go('sell-invoice')", kind: 'secondary' }, { label: 'New return', on: "go('sell-return')", kind: 'secondary' }, { label: 'New customer', on: "soon('New customer')", kind: 'secondary' }], tabs, tab, body: CSS + pick + kpisHTML(ks) + inner })
}

/* ═════════ 5 · Receivables reports ═════════ */
const buckets = ['0–30 days', '31–60 days', '61–90 days', 'Over 90 days']
const bk = age => (age <= 30 ? 0 : age <= 60 ? 1 : age <= 90 ? 2 : 3)
const openInvs = () => INV.filter(v => invBal(v.no) > 0).sort((a, b) => CUSTOMERS.findIndex(c => c.code === a.cust) - CUSTOMERS.findIndex(c => c.code === b.cust) || (a.date < b.date ? -1 : 1))
const cname = c => custOf(c).name
const perChips = () => chips('sell-reports', 'per', [['sep', 'Sep 2026'], ['oct', 'Oct 2026']], 'oct')
const perOf = () => PER[filt('sell-reports', 'per', 'oct')]
const cashDay = d => 14000000 + ((Math.round(T0(d) / 864e5) * 7919) % 9) * 1130000
const USERS = [
  { n: 'Rina Kusuma', role: 'Sales', cash: { sep: 5920000, oct: 6840000 }, pos: { sep: 0, oct: 0 } },
  { n: 'Dewi Lestari', role: 'Sales', cash: { sep: 2840000, oct: 3215000 }, pos: { sep: 0, oct: 0 } },
  { n: 'Budi Santoso', role: 'Sales', cash: { sep: 4105000, oct: 4470000 }, pos: { sep: 0, oct: 0 } },
  { n: 'Sari Wulandari', role: 'Cashier', cash: { sep: 0, oct: 0 }, pos: { sep: 412380000, oct: 366450000 } },
  { n: 'Agus Pratama', role: 'Cashier', cash: { sep: 0, oct: 0 }, pos: { sep: 388920000, oct: 351790000 } },
]
function rCustList() {
  const rows = CUSTOMERS.map(c => ({ on: `go('sell-info')`, c: { n: `<span class="one">${esc(c.name)}</span>`, c: c.code, t: c.term, l: money(c.limit), b: money(custBal(c.code)) } }))
  return { kpis: [{ label: 'Customers', value: String(CUSTOMERS.length) }, { label: 'Receivable', value: money(sum(CUSTOMERS, c => custBal(c.code))) }, { label: 'Over limit', value: String(CUSTOMERS.filter(c => custBal(c.code) > c.limit).length), bad: true }], cols: [{ l: 'Customer', k: 'n' }, { l: 'Code', k: 'c', w: 100 }, { l: 'Term', k: 't', w: 90 }, { l: 'Limit', k: 'l', num: true, w: 140 }, { l: 'Receivable', k: 'b', num: true, w: 150 }], rows, foot: { n: 'Total', b: money(sum(CUSTOMERS, c => custBal(c.code))) }, empty: 'No customer' }
}
function rItemSales() {
  const p = perOf(), map = new Map()
  INV.filter(v => v.type !== 'dp' && v.date >= p[0] && v.date <= p[1]).forEach(v => v.lines.forEach(l => { const x = map.get(l.code) || { q: 0, s: 0, c: 0 }; x.q += l.qty; x.s += lineTot(l); x.c += l.qty * itm(l.code).cost; map.set(l.code, x) }))
  const rows = [...map.entries()].sort((a, b) => b[1].s - a[1].s).map(([code, x]) => ({ c: { i: two(itm(code).name, code), q: num(x.q), s: money(x.s), c: money(x.c), p: money(x.s - x.c) } }))
  const T = f => sum([...map.values()], f)
  return { bar: perChips(), kpis: [{ label: 'Items', value: String(rows.length) }, { label: 'Sales', value: money(T(x => x.s)) }, { label: 'Profit', value: money(T(x => x.s - x.c)) }], cols: [{ l: 'Item', k: 'i' }, { l: 'Quantity', k: 'q', num: true, w: 120 }, { l: 'Sales', k: 's', num: true, w: 150 }, { l: 'Cost', k: 'c', num: true, w: 150 }, { l: 'Profit', k: 'p', num: true, w: 150 }], rows, foot: { i: 'Total', q: num(T(x => x.q)), s: money(T(x => x.s)), c: money(T(x => x.c)), p: money(T(x => x.s - x.c)) }, empty: 'No item sale in this period' }
}
function rSJ() {
  const rows = SOS.map(s => ({ c: { n: s.no, d: day(s.date), c: esc(cname(s.cust)), j: s.sj || DASH, l: num(s.lines.length), v: money(sum(s.lines, lineTot)) } }))
  return { kpis: [{ label: 'SO', value: String(SOS.length) }, { label: 'With delivery note', value: String(SOS.filter(s => s.sj).length) }, { label: 'Value', value: money(sum(SOS, s => sum(s.lines, lineTot))) }], cols: [{ l: 'Sales order', k: 'n', w: 190 }, { l: 'Date', k: 'd', w: 110 }, { l: 'Customer', k: 'c' }, { l: 'Delivery note', k: 'j', w: 170 }, { l: 'Lines', k: 'l', num: true, w: 90 }, { l: 'Value', k: 'v', num: true, w: 150 }], rows, foot: { n: 'Total', v: money(sum(SOS, s => sum(s.lines, lineTot))) }, empty: 'No sales order' }
}
function rPPN() {
  const p = perOf(), vs = INV.filter(v => v.type !== 'dp' && v.ppn > 0 && v.date >= p[0] && v.date <= p[1])
  return { bar: perChips(), kpis: [{ label: 'PPN output', value: money(sum(vs, ppnOf)) }, { label: 'Tax base', value: money(sum(vs, net)) }, { label: 'Invoices', value: String(vs.length) }], cols: [{ l: 'Invoice', k: 'i', w: 190 }, { l: 'Date', k: 'd', w: 110 }, { l: 'Customer', k: 'c' }, { l: 'Tax base', k: 'b', num: true, w: 140 }, { l: 'PPN', k: 'v', num: true, w: 130 }, { l: 'Total', k: 't', num: true, w: 140 }], rows: vs.map(v => ({ on: `svOpenInv('${v.no}')`, c: { i: v.no, d: day(v.date), c: esc(cname(v.cust)), b: money(net(v)), v: money(ppnOf(v)), t: money(grand(v)) } })), foot: { i: 'Total', b: money(sum(vs, net)), v: money(sum(vs, ppnOf)), t: money(sum(vs, grand)) }, empty: 'No invoice with PPN' }
}
const CITY = { M89: 'Jakarta', C17: 'Cikupa', G03: 'Bandung', 'C-0212': 'Surabaya' }
function rMonthly() {
  const map = new Map()
  INV.filter(v => v.type !== 'dp').forEach(v => { const m = v.date.slice(0, 7), x = map.get(m) || { m, n: 0, s: 0, r: 0 }; x.n++; x.s += grand(v); map.set(m, x) })
  RET.forEach(r => { const m = r.date.slice(0, 7), x = map.get(m) || { m, n: 0, s: 0, r: 0 }; x.r += retTotal(r); map.set(m, x) })
  const rows = [...map.values()].sort((a, b) => a.m.localeCompare(b.m)).map(x => ({ c: { m: x.m, n: num(x.n), s: money(x.s), r: money(-x.r), t: money(x.s - x.r) } }))
  return { kpis: [{ label: 'Sales', value: money(sum([...map.values()], x => x.s)) }, { label: 'Returns', value: money(sum([...map.values()], x => x.r)) }, { label: 'Net', value: money(sum([...map.values()], x => x.s - x.r)) }], cols: [{ l: 'Month', k: 'm', w: 100 }, { l: 'Invoices', k: 'n', num: true, w: 100 }, { l: 'Sales', k: 's', num: true, w: 150 }, { l: 'Returns', k: 'r', num: true, w: 140 }, { l: 'Net', k: 't', num: true, w: 150 }], rows, foot: { m: 'Total', n: num(sum([...map.values()], x => x.n)), s: money(sum([...map.values()], x => x.s)), r: money(-sum([...map.values()], x => x.r)), t: money(sum([...map.values()], x => x.s - x.r)) }, empty: 'No sale' }
}
function rCommission() {
  const rows = USERS.map(u => { const credit = sum(INV.filter(v => v.type !== 'dp' && v.sales === u.n), grand), total = credit + u.cash.oct + u.pos.oct; return { u, credit, total, com: Math.round(total * 0.01) } })
  const T = f => sum(rows, f)
  return { kpis: [{ label: 'Sales', value: money(T(r => r.total)) }, { label: 'Commission 1%', value: money(T(r => r.com)) }], cols: [{ l: 'Salesperson', k: 'u' }, { l: 'Role', k: 'r', w: 110 }, { l: 'Sales', k: 's', num: true, w: 160 }, { l: 'Commission', k: 'c', num: true, w: 150 }], rows: rows.map(r => ({ c: { u: r.u.n, r: r.u.role, s: money(r.total), c: money(r.com) } })), foot: { u: 'Total', s: money(T(r => r.total)), c: money(T(r => r.com)) }, empty: 'No salesperson' }
}
function rCity() {
  const by = new Map(); CUSTOMERS.forEach(c => { const k = CITY[c.code] || 'Other'; const x = by.get(k) || { k, n: 0, s: 0, b: 0 }; x.n++; x.s += sum(INV.filter(v => v.cust === c.code), grand); x.b += custBal(c.code); by.set(k, x) })
  const rows = [...by.values()].sort((a, b) => b.s - a.s).map(x => ({ c: { k: x.k, n: num(x.n), s: money(x.s), b: money(x.b) } }))
  return { kpis: [{ label: 'Cities', value: String(rows.length) }, { label: 'Sales', value: money(sum([...by.values()], x => x.s)) }, { label: 'Receivable', value: money(sum([...by.values()], x => x.b)) }], cols: [{ l: 'City', k: 'k' }, { l: 'Customers', k: 'n', num: true, w: 110 }, { l: 'Sales', k: 's', num: true, w: 160 }, { l: 'Receivable', k: 'b', num: true, w: 160 }], rows, foot: { k: 'Total', n: num(CUSTOMERS.length), s: money(sum([...by.values()], x => x.s)), b: money(sum([...by.values()], x => x.b)) }, empty: 'No city' }
}
function rItemCust() {
  const by = new Map(); INV.filter(v => v.type !== 'dp').forEach(v => v.lines.forEach(l => { const k = v.cust + '|' + l.code; const x = by.get(k) || { c: v.cust, i: l.code, q: 0, s: 0 }; x.q += l.qty; x.s += lineTot(l); by.set(k, x) }))
  const rows = [...by.values()].sort((a, b) => cname(a.c).localeCompare(cname(b.c)) || b.s - a.s).map(x => ({ c: { c: esc(cname(x.c)), i: two(itm(x.i).name, x.i), q: num(x.q), s: money(x.s) } }))
  return { kpis: [{ label: 'Rows', value: String(rows.length) }, { label: 'Sales', value: money(sum([...by.values()], x => x.s)) }], cols: [{ l: 'Customer', k: 'c' }, { l: 'Item', k: 'i' }, { l: 'Quantity', k: 'q', num: true, w: 110 }, { l: 'Sales', k: 's', num: true, w: 160 }], rows, empty: 'No item sale' }
}
function rRetCust() {
  const by = new Map(); RET.forEach(r => { const x = by.get(r.cust) || { c: r.cust, n: 0, v: 0 }; x.n++; x.v += retTotal(r); by.set(r.cust, x) })
  const rows = [...by.values()].map(x => ({ c: { c: esc(cname(x.c)), n: num(x.n), v: money(x.v) } }))
  return { kpis: [{ label: 'Customers', value: String(rows.length) }, { label: 'Returns', value: money(sum([...by.values()], x => x.v)) }], cols: [{ l: 'Customer', k: 'c' }, { l: 'Returns', k: 'n', num: true, w: 110 }, { l: 'Value', k: 'v', num: true, w: 160 }], rows, foot: { c: 'Total', n: num(RET.length), v: money(sum(RET, retTotal)) }, empty: 'No return' }
}
function rPPNRet() {
  const rows = RET.map(r => { const val = retVal(r), p = retPpn(r.inv, val); return { r, val, p } }).filter(x => x.p > 0)
  return { kpis: [{ label: 'PPN returns', value: money(sum(rows, x => x.p)) }, { label: 'Returns', value: String(rows.length) }], cols: [{ l: 'Return', k: 'n', w: 190 }, { l: 'Date', k: 'd', w: 110 }, { l: 'Customer', k: 'c' }, { l: 'Base', k: 'b', num: true, w: 140 }, { l: 'PPN', k: 'p', num: true, w: 130 }], rows: rows.map(x => ({ on: `svOpenRet('${x.r.no}')`, c: { n: x.r.no, d: day(x.r.date), c: esc(cname(x.r.cust)), b: money(x.val), p: money(x.p) } })), foot: { n: 'Total', b: money(sum(rows, x => x.val)), p: money(sum(rows, x => x.p)) }, empty: 'No PPN return' }
}
const REP = [
  { id: 'due', g: 'Receivables', label: 'Due receivables', run() {
    const rows = openInvs().filter(v => overdueDays(v) > 0)
    const tot = sum(rows, v => invBal(v.no))
    return {
      kpis: [{ label: 'Overdue', value: money(tot), bad: tot > 0 }, { label: 'Invoices', value: String(rows.length) }, { label: 'Oldest', value: rows.length ? `${Math.max(...rows.map(overdueDays))} days` : '—' }, { label: 'Customers', value: String(new Set(rows.map(v => v.cust)).size) }],
      cols: [{ l: 'Invoice', k: 'i' }, { l: 'Customer', k: 'c', w: 230 }, { l: 'Due', k: 'd', w: 120 }, { l: 'Days overdue', k: 'o', num: true, w: 130 }, { l: 'Left to collect', k: 'l', num: true, w: 150 }],
      rows: rows.map(v => ({ on: `svOpenInv('${v.no}')`, c: { i: v.no, c: esc(cname(v.cust)), d: `<span class="late">${day(v.due)}</span>`, o: `<span class="late">${overdueDays(v)}</span>`, l: money(invBal(v.no)) } })),
      foot: { i: 'Total', l: money(tot) }, empty: 'Nothing is overdue',
    }
  } },
  { id: 'summary', g: 'Receivables', label: 'Receivable summary', run() {
    const p = perOf(), ss = CUSTOMERS.map(c => ({ c, s: summ(c.code, p[0], p[1]) }))
    const T = k => sum(ss, x => x.s[k])
    return {
      bar: perChips(),
      kpis: [{ label: 'Opening', value: money(T('open')) }, { label: 'Credit sales', value: money(T('sales')) }, { label: 'Collections', value: money(T('cl')) }, { label: 'Closing', value: money(T('close')) }],
      cols: [{ l: 'Customer', k: 'c' }, { l: 'Opening', k: 'o', num: true, w: 125 }, { l: 'Credit sales', k: 'a', num: true, w: 125 }, { l: 'Down payments', k: 'd', num: true, w: 125 }, { l: 'Returns', k: 'r', num: true, w: 115 }, { l: 'Collections', k: 'k', num: true, w: 125 }, { l: 'Closing', k: 'z', num: true, w: 125 }],
      rows: ss.map(({ c, s }) => ({ c: { c: esc(c.name), o: money(s.open), a: money(s.sales), d: money(s.dp), r: money(-s.ret), k: money(-s.cl), z: money(s.close) } })),
      foot: { c: 'Total', o: money(T('open')), a: money(T('sales')), d: money(T('dp')), r: money(-T('ret')), k: money(-T('cl')), z: money(T('close')) },
    }
  } },
  { id: 'bydate', g: 'Receivables', label: 'Receivable per date', run() {
    const p = perOf(), dates = new Set()
    INV.forEach(v => { if (v.date >= p[0] && v.date <= p[1]) dates.add(v.date) })
    COL.forEach(x => { if (x.date >= p[0] && x.date <= p[1]) dates.add(x.date) })
    RET.forEach(r => { if (r.date >= p[0] && r.date <= p[1]) dates.add(r.date) })
    UMA.forEach(a => { if (a.date >= p[0] && a.date <= p[1]) dates.add(a.date) })
    const all = c => sum(CUSTOMERS, u => custBal(u.code, c))
    const rows = [...dates].sort().map(d => {
      const cr = sum(INV.filter(v => v.date === d), grand) - sum(UMA.filter(a => a.date === d), a => a.amt)
      const rt = sum(RET.filter(r => r.date === d), retTotal), cl = sum(COL.filter(x => x.date === d), x => sum(x.alloc, settle))
      return { c: { d: day(d), a: dash0(cr), c: dash0(cashDay(d)), r: dash0(-rt), k: dash0(-cl), z: money(all(d)) }, cr, cs: cashDay(d), rt, cl }
    })
    return {
      bar: perChips(),
      kpis: [{ label: 'Opening', value: money(all(addD(p[0], -1))) }, { label: 'Credit sales', value: money(sum(rows, r => r.cr)) }, { label: 'Cash sales', value: money(sum(rows, r => r.cs)) }, { label: 'Closing', value: money(all(p[1])) }],
      cols: [{ l: 'Date', k: 'd' }, { l: 'Credit sales', k: 'a', num: true, w: 150 }, { l: 'Cash sales', k: 'c', num: true, w: 150 }, { l: 'Returns', k: 'r', num: true, w: 140 }, { l: 'Collections', k: 'k', num: true, w: 150 }, { l: 'Closing receivable', k: 'z', num: true, w: 160 }],
      rows, foot: { d: 'Total', a: money(sum(rows, r => r.cr)), c: money(sum(rows, r => r.cs)), r: money(-sum(rows, r => r.rt)), k: money(-sum(rows, r => r.cl)), z: money(all(p[1])) },
    }
  } },
  { id: 'ledger', g: 'Receivables', label: 'Customer ledger', run() {
    const cu = filt('sell-reports', 'cust', CUSTOMERS[0].code), rs = ledger(cu)
    return {
      bar: chips('sell-reports', 'cust', CUSTOMERS.map(x => [x.code, x.name]), CUSTOMERS[0].code),
      kpis: [{ label: 'Debit', value: money(sum(rs, r => r.dr)) }, { label: 'Credit', value: money(sum(rs, r => r.cr)) }, { label: 'Balance', value: money(rs.length ? rs[rs.length - 1].bal : 0) }],
      cols: [{ l: 'Date', k: 'd', w: 115 }, { l: 'Document', k: 'n' }, { l: 'Due', k: 'u', w: 115 }, { l: 'Debit', k: 'dr', num: true, w: 130 }, { l: 'Credit', k: 'cr', num: true, w: 130 }, { l: 'Balance', k: 'b', num: true, w: 140 }],
      rows: rs.map(r => ({ on: r.open, c: { d: day(r.date), n: two(r.doc, esc(r.desc)), u: r.due ? (r.v && overdueDays(r.v) > 0 ? `<span class="late">${day(r.due)}</span>` : day(r.due)) : DASH, dr: dash0(r.dr), cr: dash0(r.cr), b: money(r.bal) } })),
      foot: { d: 'Total', dr: money(sum(rs, r => r.dr)), cr: money(sum(rs, r => r.cr)), b: money(rs.length ? rs[rs.length - 1].bal : 0) },
    }
  } },
  { id: 'remaining', g: 'Receivables', label: 'Remaining receivable', run() {
    const mode = filt('sell-reports', 'rem', 'cust'), op = openInvs(), tot = sum(op, v => invBal(v.no))
    const barH = chips('sell-reports', 'rem', [['cust', 'By customer'], ['inv', 'By invoice']], 'cust')
    const kpis = [{ label: 'Remaining', value: money(tot) }, { label: 'Open invoices', value: String(op.length) }, { label: 'Customers', value: String(new Set(op.map(v => v.cust)).size) }]
    if (mode === 'cust') {
      return { bar: barH, kpis,
        cols: [{ l: 'Customer', k: 'c' }, { l: 'Terms', k: 't', w: 110 }, { l: 'Limit', k: 'm', num: true, w: 150 }, { l: 'Limit used', k: 'u', num: true, w: 120 }, { l: 'Remaining', k: 'r', num: true, w: 160 }],
        rows: CUSTOMERS.map(c => ({ c: { c: esc(c.name), t: termWord(c.term), m: money(c.limit), u: `${(custBal(c.code) / c.limit * 100).toFixed(1).replace('.', ',')}%`, r: money(custBal(c.code)) } })),
        foot: { c: 'Total', r: money(tot) } }
    }
    const rows = []
    CUSTOMERS.forEach(c => {
      const vs = op.filter(v => v.cust === c.code)
      if (!vs.length) return
      rows.push({ group: `${esc(c.name)} · ${money(sum(vs, v => invBal(v.no)))}` })
      vs.forEach(v => rows.push({ on: `svOpenInv('${v.no}')`, c: { i: v.no, d: day(v.date), u: dueCell(v), t: money(grand(v)), r: money(invBal(v.no)) } }))
    })
    return { bar: barH, kpis, cols: [{ l: 'Invoice', k: 'i' }, { l: 'Date', k: 'd', w: 125 }, { l: 'Due', k: 'u', w: 125 }, { l: 'Total', k: 't', num: true, w: 150 }, { l: 'Remaining', k: 'r', num: true, w: 160 }], rows, foot: { i: 'Total', r: money(tot) } }
  } },
  { id: 'aging-cust', g: 'Receivables', label: 'Aging per customer', run() {
    const op = openInvs(), rows = CUSTOMERS.map(c => {
      const b = [0, 0, 0, 0]
      op.filter(v => v.cust === c.code).forEach(v => { b[bk(dd(v.date, TODAY))] += invBal(v.no) })
      return { c, b }
    }).filter(x => sum(x.b, y => y)), T = [0, 1, 2, 3].map(i => sum(rows, x => x.b[i])), tot = sum(T, y => y)
    return {
      kpis: T.map((t, i) => ({ label: buckets[i], value: money(t), bad: i === 3 && t > 0 })),
      cols: [{ l: 'Customer', k: 'c' }, ...buckets.map((b, i) => ({ l: b, k: 'b' + i, num: true, w: 130 })), { l: 'Total', k: 't', num: true, w: 140 }],
      rows: rows.map(x => ({ c: Object.assign({ c: esc(x.c.name), t: money(sum(x.b, y => y)) }, ...x.b.map((n, i) => ({ ['b' + i]: dash0(n) }))) })),
      foot: Object.assign({ c: 'Total', t: money(tot) }, ...T.map((n, i) => ({ ['b' + i]: dash0(n) }))),
    }
  } },
  { id: 'aging-inv', g: 'Receivables', label: 'Aging per invoice', run() {
    const op = openInvs(), T = [0, 0, 0, 0]
    const rows = []
    CUSTOMERS.forEach(c => {
      const vs = op.filter(v => v.cust === c.code)
      if (!vs.length) return
      rows.push({ group: esc(c.name) })
      vs.forEach(v => {
        const age = dd(v.date, TODAY), i = bk(age), b = invBal(v.no)
        T[i] += b
        rows.push({ on: `svOpenInv('${v.no}')`, c: Object.assign({ i: two(v.no, `${age} days old`), u: dueCell(v), t: money(b) }, ...[0, 1, 2, 3].map(j => ({ ['b' + j]: j === i ? num(b) : DASH }))) })
      })
    })
    return {
      kpis: T.map((t, i) => ({ label: buckets[i], value: money(t), bad: i === 3 && t > 0 })),
      cols: [{ l: 'Invoice', k: 'i' }, { l: 'Due', k: 'u', w: 115 }, ...buckets.map((b, i) => ({ l: b, k: 'b' + i, num: true, w: 112 })), { l: 'Remaining', k: 't', num: true, w: 140 }],
      rows, foot: Object.assign({ i: 'Total', t: money(sum(T, y => y)) }, ...T.map((n, i) => ({ ['b' + i]: dash0(n) }))),
    }
  } },
  { id: 'collections', g: 'Collections', label: 'Collections per invoice', run() {
    const rows = []
    INV.slice().sort((a, b) => (a.date < b.date ? -1 : 1)).forEach(v => {
      COL.filter(x => x.alloc.some(a => a.inv === v.no)).sort((a, b) => (a.date < b.date ? -1 : 1)).forEach(x => {
        const a = x.alloc.find(y => y.inv === v.no)
        rows.push({ on: `svOpenBkm('${x.no}')`, c: { i: two(v.no, esc(cname(v.cust))), v: x.no, d: day(x.date), a: two(esc(accN(x.acct)), esc(giroWord(x) || methodOf(x))), r: money(a.rec), k: dash0(a.disc) }, rec: a.rec, disc: a.disc })
      })
    })
    return {
      kpis: [{ label: 'Received', value: money(sum(rows, r => r.rec)) }, { label: 'Discount given', value: money(sum(rows, r => r.disc)) }, { label: 'Vouchers', value: String(COL.length) }, { label: 'Giro pending', value: String(COL.filter(x => x.giro && !x.giro.cleared).length) }],
      cols: [{ l: 'Invoice', k: 'i' }, { l: 'Voucher', k: 'v', w: 165 }, { l: 'Date', k: 'd', w: 115 }, { l: 'Account', k: 'a', w: 200 }, { l: 'Received', k: 'r', num: true, w: 125 }, { l: 'Discount', k: 'k', num: true, w: 95 }],
      rows, foot: { i: 'Total', r: money(sum(rows, r => r.rec)), k: dash0(sum(rows, r => r.disc)) },
    }
  } },
  { id: 'dp', g: 'Sales', label: 'Down-payment sales open', run() {
    const dps = INV.filter(v => v.type === 'dp')
    const rows = dps.map(v => ({
      on: `svOpenInv('${v.no}')`, left: umLeftAll(v.no),
      c: { i: two(v.no, esc(cname(v.cust))), d: day(v.date), t: money(grand(v)), a: money(umApplied(v.no)), l: money(umLeftAll(v.no)), p: UMA.filter(a => a.um === v.no).map(a => a.inv).join(', ') || DASH },
    }))
    return {
      kpis: [{ label: 'Down payments', value: money(sum(dps, grand)) }, { label: 'Applied', value: money(sum(dps, v => umApplied(v.no))) }, { label: 'Still open', value: money(sum(rows, r => r.left)) }],
      cols: [{ l: 'Down payment invoice', k: 'i' }, { l: 'Date', k: 'd', w: 120 }, { l: 'Total', k: 't', num: true, w: 130 }, { l: 'Applied', k: 'a', num: true, w: 130 }, { l: 'Remaining', k: 'l', num: true, w: 130 }, { l: 'Applied to', k: 'p', w: 175 }],
      rows, foot: { i: 'Total', t: money(sum(dps, grand)), a: money(sum(dps, v => umApplied(v.no))), l: money(sum(rows, r => r.left)) },
    }
  } },
  { id: 'invoices', g: 'Sales', label: 'Sales invoices', run() {
    const p = perOf(), vs = INV.filter(v => v.date >= p[0] && v.date <= p[1]).sort((a, b) => (a.date < b.date ? -1 : 1))
    return {
      bar: perChips(),
      kpis: [{ label: 'Invoices', value: String(vs.length) }, { label: 'Invoiced', value: money(sum(vs, grand)) }, { label: 'Still open', value: money(sum(vs, v => invBal(v.no))) }],
      cols: [{ l: 'Invoice', k: 'i' }, { l: 'Date', k: 'd', w: 120 }, { l: 'Type', k: 'y', w: 140 }, { l: 'Total', k: 't', num: true, w: 140 }, { l: 'Left to collect', k: 'l', num: true, w: 150 }, { l: 'Status', k: 's', w: 120 }],
      rows: vs.map(v => ({ on: `svOpenInv('${v.no}')`, c: { i: two(v.no, esc(cname(v.cust))), d: day(v.date), y: typeWord(v.type), t: money(grand(v)), l: dash0(invBal(v.no)), s: stat(invState(v)) } })),
      foot: { i: 'Total', t: money(sum(vs, grand)), l: money(sum(vs, v => invBal(v.no))) }, empty: 'No invoices in this month',
    }
  } },
  { id: 'returns', g: 'Sales', label: 'Sales returns', run() {
    const rs = RET.slice().sort((a, b) => (a.date < b.date ? -1 : 1))
    return {
      kpis: [{ label: 'Returns', value: String(rs.length) }, { label: 'Credited', value: money(sum(rs, retTotal)) }, { label: 'Goods back', value: String(rs.filter(r => r.goods).length) }],
      cols: [{ l: 'Return', k: 'i' }, { l: 'Date', k: 'd', w: 120 }, { l: 'Invoice', k: 'v', w: 190 }, { l: 'Goods back', k: 'g', w: 120 }, { l: 'Credit', k: 't', num: true, w: 150 }],
      rows: rs.map(r => ({ on: `svOpenRet('${r.no}')`, c: { i: two(r.no, esc(cname(r.cust))), d: day(r.date), v: r.inv, g: r.goods ? 'Yes' : 'No', t: money(retTotal(r)) } })),
      foot: { i: 'Total', t: money(sum(rs, retTotal)) },
    }
  } },
  { id: 'monthly', g: 'Sales', label: 'Monthly sales', run: rMonthly },
  { id: 'commission', g: 'Sales', label: 'Commission per salesperson', run: rCommission },
  { id: 'city', g: 'Customers', label: 'Sales per city', run: rCity },
  { id: 'item-cust', g: 'Sales', label: 'Item sales per customer', run: rItemCust },
  { id: 'ret-cust', g: 'Customers', label: 'Returns per customer', run: rRetCust },
  { id: 'ppn-ret', g: 'Sales', label: 'PPN sales returns', run: rPPNRet },
  { id: 'cust-list', g: 'Customers', label: 'Customer list', run: rCustList },
  { id: 'item-sales', g: 'Sales', label: 'Item sales', run: rItemSales },
  { id: 'sj', g: 'Sales', label: 'SO & delivery notes', run: rSJ },
  { id: 'ppn-sales', g: 'Sales', label: 'PPN sales summary', run: rPPN },
  { id: 'sales-user', g: 'Sales', label: 'Sales by salesperson', run() {
    const k = filt('sell-reports', 'per', 'oct'), p = PER[k]
    const rows = USERS.map(u => {
      const cr = sum(INV.filter(v => v.type !== 'dp' && v.sales === u.n && v.date >= p[0] && v.date <= p[1]), grand)
      return { u, cr, cash: u.cash[k], pos: u.pos[k] }
    })
    const T = f => sum(rows, f), all = T(r => r.cr + r.cash + r.pos)
    return {
      bar: perChips(),
      kpis: [{ label: 'Credit', value: money(T(r => r.cr)) }, { label: 'Cash sales', value: money(T(r => r.cash)) }, { label: 'Till (POS)', value: money(T(r => r.pos)) }, { label: 'Total', value: money(all) }],
      cols: [{ l: 'User', k: 'u' }, { l: 'Role', k: 'r', w: 110 }, { l: 'Credit', k: 'a', num: true, w: 140 }, { l: 'Cash sale', k: 'b', num: true, w: 130 }, { l: 'Till (POS)', k: 'c', num: true, w: 150 }, { l: 'Total', k: 't', num: true, w: 150 }],
      rows: rows.map(r => ({ c: { u: r.u.n, r: r.u.role, a: dash0(r.cr), b: dash0(r.cash), c: dash0(r.pos), t: money(r.cr + r.cash + r.pos) } })),
      foot: { u: 'Total', a: money(T(r => r.cr)), b: money(T(r => r.cash)), c: money(T(r => r.pos)), t: money(all) },
    }
  } },
]
window.SELL_REPORTS = REP
CUSTOMERS.forEach(c => { const l = ledger(c.code); if (!l.length || l[l.length - 1].bal !== c.piutang) { CHECK.ok = false; CHECK.diffs.push(`ledger ${c.code}`) } const a = summ(c.code, PER.sep[0], PER.sep[1]), b = summ(c.code, PER.oct[0], PER.oct[1]); if (a.close !== b.open || b.close !== c.piutang) { CHECK.ok = false; CHECK.diffs.push(`summary ${c.code}`) } })
if (sum(openInvs(), v => invBal(v.no)) !== sum(CUSTOMERS, c => c.piutang)) { CHECK.ok = false; CHECK.diffs.push('aging total') }
function pgReports() {
  const id = tabOf('sell-reports', 'due'), r = REP.find(x => x.id === id) || REP[0], out = r.run()
  const groups = [...new Set(REP.map(x => x.g))]
  const picker = `<div class="sv-pick">${groups.map(g => `<span class="nav-label">${g}</span><div class="ds-nav">${REP.filter(x => x.g === g).map(x => `<button class="nav-row-btn ${x.id === r.id ? 'on' : ''}" type="button" onclick="setTab('sell-reports','${x.id}')"><span>${x.label}</span></button>`).join('')}</div>`).join('')}</div>`
  const right = `<div><div class="sec-head" style="margin-bottom:12px"><h3 class="ds-section-title">${r.label}</h3><span class="mute">As of ${day(TODAY)}</span></div>${kpisHTML(out.kpis)}${out.bar ? bar(out.bar) : ''}${table(out)}</div>`
  return page({ title: 'Receivables reports', actions: [{ label: 'Print report', on: `printPage('Receivables reports')`, icon: 'printer' }, { label: 'Export', on: `nativeExport('receivables-report')`, kind: 'secondary', icon: 'download' }], body: CSS + `<div class="sv-split">${picker}${right}</div>` })
}

reg({ id: 'sell-invoice', group: 'sell', label: 'Sales invoice', render: pgInvoice })
reg({ id: 'sell-return', group: 'sell', label: 'Sales return', render: pgReturn })
reg({ id: 'sell-cash', group: 'sell', label: 'Cash sale & till', render: pgCash })
reg({ id: 'sell-info', group: 'sell', label: 'Customer hub', render: pgHub })
reg({ id: 'sell-reports', group: 'report', label: 'Receivables reports', render: pgReports })
})()
