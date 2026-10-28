/* ═════════ Accounting › Assets · Month end ═════════
   Assets is 7Soft's Master Asset and Penyusutan: the register, the store-opening projects GA runs
   and Finance capitalises, the monthly run shown as 7Soft's Jurnal Umum, and disposals.
   Month end is Closing Periode Akuntansi: October's checklist read from the shared books, then the periods.
   Reports (scr-rep.js) reads window.ASSET_BOOK and window.FIN_CLOSE, so a charge or a capitalise shows there too. */
;(() => {
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const monL = y => `${MONTHS[+y.slice(5) - 1]} ${y.slice(0, 4)}`
const ymOf = iso => iso.slice(0, 7)
const ymAdd = (y, n) => { const t = +y.slice(0, 4) * 12 + (+y.slice(5) - 1) + n; return `${Math.floor(t / 12)}-${String(t % 12 + 1).padStart(2, '0')}` }
const ymDiff = (a, b) => (+b.slice(0, 4) - +a.slice(0, 4)) * 12 + (+b.slice(5) - +a.slice(5))
const pad2 = n => String(n).padStart(2, '0')
const pad4 = n => String(n).padStart(4, '0')
const nm = c => (window.COA_N && window.COA_N[c]) || GL[c] || ''
const NEWSHOP = { C014: 'Temanggung' }
const LOC = p => p === 'HO' ? '00' : STORE[p] ? STORE[p].loc : p.slice(2)
const placeName = p => p === 'HO' ? 'Head office' : STORE[p] ? `${p} · ${STORE[p].name}` : `${p} · ${NEWSHOP[p] || ''}`
const code = (base, p) => base + LOC(p)
const sum = (xs, f) => xs.reduce((s, x) => s + f(x), 0)
const now = () => new Date().toTimeString().slice(0, 5)
const hist = (menu, action, doc) => { if (window.FIN_HIST) window.FIN_HIST.unshift({ date: TODAY, time: now(), user: FIN, menu, action, doc }) }
const octDays = () => Array.from({ length: daysBetween('2026-10-01', TODAY) }, (_, i) => `2026-10-${pad2(i + 1)}`)
const goBill = no => { go('bills'); setTimeout(() => window.openBill && window.openBill(no), 30) }
const goGiro = no => { go('giro'); setTimeout(() => window.openGiro && window.openGiro(no), 30) }

/* journal numbers (Setting Menu: JU/HO/YYMM/####, reset monthly) */
const JU = window.FIN_JU = { n: 31 }
const juNo = n => `JU/HO/2610/${pad4(n)}`
const takeJU = () => juNo(JU.n++)

/* ═════════ the register ═════════
   A category carries its three accounts (base + location). Straight line, no residual; the charge
   starts in the month bought when bought by the 15th, else the month after. */
const CAT = {
  bld: { l: 'Building & renovation', s: 'BLD', life: 60, a: '1021502002', d: '7010210002', k: '1021602002' },
  ffe: { l: 'Furniture & fixtures', s: 'FFE', life: 48, a: '1021506002', d: '7010214002', k: '1021606002' },
  elc: { l: 'Electronics', s: 'ELC', life: 48, a: '1021506003', d: '7010214003', k: '1021606003' },
  veh: { l: 'Vehicles', s: 'VEH', life: 96, a: '1021505001', d: '7010213001', k: '1021605001' },
  pre: { l: 'Pre Opening', s: 'PRE', life: 24, a: '1031802001', d: '7010216002', k: '1031802002' },
}
const CATS = Object.keys(CAT)
const AS = [
  { id: 'AT-BLD-0001', n: 'Renovasi toko', cat: 'bld', place: 'C004', acq: '2024-08-01', cost: 186000000 },
  { id: 'AT-BLD-0002', n: 'Renovasi toko', cat: 'bld', place: 'C009', acq: '2025-05-02', cost: 214500000 },
  { id: 'AT-BLD-0003', n: 'Renovasi fasad', cat: 'bld', place: 'C006', acq: '2026-03-02', cost: 96000000, prj: 'PRJ-2026-02' },
  { id: 'AT-BLD-0004', n: 'Renovasi toko', cat: 'bld', place: 'C013', acq: '2026-07-01', cost: 248000000, prj: 'PRJ-2026-03' },
  { id: 'AT-FFE-0001', n: 'AC split 2 PK × 4', cat: 'ffe', place: 'C003', acq: '2024-09-05', cost: 26000000 },
  { id: 'AT-FFE-0003', n: 'Rak display dinding', cat: 'ffe', place: 'C002', acq: '2024-11-04', cost: 18750000 },
  { id: 'AT-FFE-0004', n: 'Meja kasir & backdrop', cat: 'ffe', place: 'C012', acq: '2025-01-15', cost: 12300000 },
  { id: 'AT-FFE-0005', n: 'AC cassette 5 PK × 2', cat: 'ffe', place: 'C010', acq: '2025-04-18', cost: 38500000 },
  { id: 'AT-FFE-0006', n: 'Rak display gondola', cat: 'ffe', place: 'C008', acq: '2025-08-22', cost: 22400000 },
  { id: 'AT-FFE-0007', n: 'Rak gudang besi', cat: 'ffe', place: 'HO', acq: '2024-06-10', cost: 16800000 },
  { id: 'AT-FFE-0008', n: 'Rak display & AC', cat: 'ffe', place: 'C013', acq: '2026-07-01', cost: 72000000, prj: 'PRJ-2026-03' },
  { id: 'AT-ELC-0002', n: 'POS set · 2 tills', cat: 'elc', place: 'C001', acq: '2025-03-10', cost: 14850000 },
  { id: 'AT-ELC-0004', n: 'POS set · 2 tills', cat: 'elc', place: 'C005', acq: '2025-06-02', cost: 14850000 },
  { id: 'AT-ELC-0005', n: 'CCTV 8 kamera', cat: 'elc', place: 'C007', acq: '2025-11-20', cost: 9600000 },
  { id: 'AT-ELC-0006', n: 'POS set · 2 tills', cat: 'elc', place: 'C013', acq: '2026-07-01', cost: 15400000 },
  { id: 'AT-ELC-0007', n: 'Printer struk × 6', cat: 'elc', place: 'HO', acq: '2026-10-11', cost: Math.round(8374200 * 100 / 111), bill: 'FB/HO/2610/0133' },
  { id: 'AT-VEH-0001', n: 'Mobil box L300', cat: 'veh', place: 'HO', acq: '2024-02-12', cost: 268000000 },
  { id: 'AT-VEH-0002', n: 'Gran Max blind van', cat: 'veh', place: 'HO', acq: '2025-09-03', cost: 185000000 },
  { id: 'AT-PRE-0001', n: 'Pre Opening', cat: 'pre', place: 'C012', acq: '2025-02-03', cost: 98000000 },
  { id: 'AT-PRE-0002', n: 'Pre Opening', cat: 'pre', place: 'C013', acq: '2026-07-01', cost: 132600000, prj: 'PRJ-2026-03' },
]
const DISP = [
  { id: 'AT-ELC-0003', n: 'Printer struk', cat: 'elc', place: 'C003', acq: '2023-02-06', cost: 2150000, out: '2026-10-14', how: 'Written off', proceeds: 0, ju: 'JU/HO/2610/0018', why: 'Rusak, tidak bisa diperbaiki' },
  { id: 'AT-FFE-0002', n: 'AC split 1 PK', cat: 'ffe', place: 'C008', acq: '2023-05-20', cost: 4800000, out: '2026-10-21', how: 'Sold', proceeds: 1250000, ju: 'JU/HO/2610/0024', why: 'Toko Elektronik Maju, Pasuruan' },
]
const AST = { oct: false, octJu: null, octAt: null }
const lifeOf = a => a.life || CAT[a.cat].life
const startOf = a => +a.acq.slice(8) <= 15 ? ymOf(a.acq) : ymAdd(ymOf(a.acq), 1)
const monthsThru = (a, y) => Math.max(0, Math.min(lifeOf(a), ymDiff(startOf(a), y) + 1))
const accumAt = (a, y) => Math.round(a.cost * monthsThru(a, y) / lifeOf(a))
const chargeIn = (a, y) => accumAt(a, y) - accumAt(a, ymAdd(y, -1))
const POSTED = () => AST.oct ? '2026-10' : '2026-09'
const bookOf = a => a.cost - accumAt(a, POSTED())
const leftOf = a => lifeOf(a) - monthsThru(a, POSTED())
const monthCharge = a => leftOf(a) ? chargeIn(a, startOf(a) > '2026-10' ? startOf(a) : POSTED() === '2026-10' ? ymAdd('2026-10', 1) : '2026-10') : 0
const octCharge = () => sum(AS, a => chargeIn(a, '2026-10'))
const dispAcc = a => accumAt(a, '2026-09'), dispBook = a => a.cost - dispAcc(a), dispGain = a => a.proceeds - dispBook(a)

/* ═════════ projects: GA runs the work, Finance pays the tranches into Uang Muka and capitalises ═════════ */
const CON = 'Karya Bangun Renovasi, CV'
const ADV = '1011303003'
const EXP = '6010410004'
const PRJ = [
  { id: 'PRJ-2026-04', n: 'C014 Temanggung opening', shop: 'C014', lead: 'Bambang Suryadi', budget: 420000000, handed: '2026-10-24', st: 'ready',
    tr: [['Uang muka 30%', '2026-08-12', 'BKK/HO/2608/0042', 120000000], ['Termin 2 · 40%', '2026-09-16', 'BKK/HO/2609/0038', 160000000], ['Termin 3 · 25%', '2026-10-10', 'BKK/HO/2610/0045', 100000000]],
    split: [['bld', 'Renovasi toko', 236000000], ['ffe', 'Rak display & AC', 98500000], ['pre', 'Hoarding, signage & cleaning', 38000000], ['exp', 'Perbaikan tembok tetangga', 7500000]] },
  { id: 'PRJ-2026-05', n: 'C002 Muaro Bungo refit', shop: 'C002', lead: 'Wahyu Pratomo', budget: 140000000, st: 'open',
    tr: [['Uang muka 40%', '2026-10-06', 'BKK/HO/2610/0041', 56000000]], split: [] },
  { id: 'PRJ-2026-03', n: 'C013 Wonosobo opening', shop: 'C013', lead: 'Bambang Suryadi', budget: 480000000, handed: '2026-06-27', st: 'done', capOn: '2026-07-01', ju: 'JU/HO/2607/0003',
    tr: [['Uang muka 30%', '2026-03-16', 'BKK/HO/2603/0031', 135780000], ['Termin 2 · 40%', '2026-05-04', 'BKK/HO/2605/0012', 181040000], ['Termin 3 · 30%', '2026-06-22', 'BKK/HO/2606/0040', 135780000]],
    split: [['bld', 'Renovasi toko', 248000000, 'AT-BLD-0004'], ['ffe', 'Rak display & AC', 72000000, 'AT-FFE-0008'], ['pre', 'Pre Opening', 132600000, 'AT-PRE-0002']] },
  { id: 'PRJ-2026-02', n: 'C006 Wiramode facade', shop: 'C006', lead: 'Wahyu Pratomo', budget: 100000000, handed: '2026-02-27', st: 'done', capOn: '2026-03-02', ju: 'JU/HO/2603/0002',
    tr: [['Uang muka 50%', '2026-01-19', 'BKK/HO/2601/0027', 48000000], ['Pelunasan 50%', '2026-02-23', 'BKK/HO/2602/0035', 48000000]],
    split: [['bld', 'Renovasi fasad', 96000000, 'AT-BLD-0003']] },
]
const trx = t => { const dpp = t[3], ppn = Math.round(dpp * .11), pph = Math.round(dpp * .02); return { name: t[0], date: t[1], bkk: t[2], dpp, ppn, pph, paid: dpp + ppn - pph } }
const prjSum = p => p.tr.map(trx).reduce((s, t) => ({ dpp: s.dpp + t.dpp, ppn: s.ppn + t.ppn, pph: s.pph + t.pph, paid: s.paid + t.paid }), { dpp: 0, ppn: 0, pph: 0, paid: 0 })
const PRJW = { open: ['Open', ''], ready: ['Ready to capitalise', 'info'], done: ['Capitalised', 'ok'] }

/* what Reports reads: the asset book at 30 Sep or now, and what the month's charges and disposals posted */
window.ASSET_BOOK = {
  at(end) {
    const asOf = end === '2026-09' ? '2026-09-30' : TODAY, thru = end === '2026-09' ? '2026-09' : POSTED()
    const r = { fixCost: 0, fixAcc: 0, preCost: 0, preAcc: 0, adv: 0, byAcc: {} }
    ;[...AS, ...DISP].filter(a => a.acq <= asOf && !(a.out && a.out <= asOf)).forEach(a => {
      const ac = accumAt(a, thru), c = CAT[a.cat]
      if (a.cat === 'pre') { r.preCost += a.cost; r.preAcc += ac } else { r.fixCost += a.cost; r.fixAcc += ac }
      r.byAcc[c.a] = (r.byAcc[c.a] || 0) + a.cost
      r.byAcc[c.k] = (r.byAcc[c.k] || 0) - ac
    })
    PRJ.forEach(p => { if (p.capOn && p.capOn <= asOf) return; p.tr.forEach(t => { if (t[1] <= asOf) r.adv += t[3] }) })
    return r
  },
  /* [{ loc, acc, amt }] booked to the P&L in a month: depreciation, capitalised expense, disposal gain or loss */
  charges(y) {
    if (y === '2026-10' && !AST.oct) return []
    const xs = y === '2026-10' ? AS : [...AS, ...DISP].filter(a => a.acq <= '2026-09-30')
    return xs.map(a => ({ loc: LOC(a.place), acc: CAT[a.cat].d, amt: chargeIn(a, y) })).filter(x => x.amt)
  },
  extras(y) {
    if (y !== '2026-10') return []
    const cap = PRJ.filter(p => p.capOn && p.capOn >= '2026-10-01').flatMap(p => p.split.filter(s => s[0] === 'exp').map(s => ({ loc: LOC(p.shop), acc: EXP, amt: s[2] })))
    return [...cap, ...DISP.map(a => ({ loc: LOC(a.place), acc: '8010110007', amt: -dispGain(a) }))]
  },
  /* contractor tranches paid in a month (PPN Masukan, PPh 23) */
  tranches: y => PRJ.flatMap(p => p.tr.map(trx).filter(t => t.date.startsWith(y)).map(t => ({ ...t, prj: p.id, shop: p.shop }))),
}

/* ═════════ Assets ═════════ */
reg({
  id: 'assets', group: 'acc', label: 'Assets',
  s7: [['Asset'], ['Penyusutan', 'depr'], ['Master Asset']],
  badge: () => { const n = PRJ.filter(p => p.st === 'ready').length; return n ? [n] : null },
  render() {
    const id = 'assets', tab = tabOf(id, 'reg')
    let kpis, body, actions = []
    if (tab === 'reg') {
      const cat = filt(id, 'cat', 'all'), place = filt(id, 'place', 'all')
      const list = AS.filter(a => (cat === 'all' || a.cat === cat) && (place === 'all' || a.place === place))
      const places = ['HO', ...STORES.map(s => s.code), ...Object.keys(NEWSHOP)].filter(p => AS.some(a => a.place === p))
      kpis = [
        { label: 'Cost', value: money(sum(AS, a => a.cost)) },
        { label: 'Book value', value: money(sum(AS, bookOf)) },
        { label: 'October charge', value: money(octCharge()), on: `setTab('${id}','depr')` },
        { label: 'Assets', value: String(AS.length) },
      ]
      body = bar(chips(id, 'cat', [['all', 'All', AS.length], ...CATS.map(k => [k, CAT[k].l, AS.filter(a => a.cat === k).length])], 'all'),
        selectBox([['all', 'Every place'], ...places.map(p => [p, placeName(p)])], place, `setFilt('${id}','place',this.value)`))
        + table({
          cols: [{ l: 'Asset', k: 'n' }, { l: 'Category', k: 'c', w: 190 }, { l: 'Place', k: 'p', w: 150 }, { l: 'Acquired', k: 'd', w: 115 }, { l: 'Cost', k: 'cost', num: 1, w: 150 }, { l: 'Book value', k: 'bv', num: 1, w: 150 }, { l: 'Monthly charge', k: 'm', num: 1, w: 150 }],
          rows: list.map(a => ({ on: `astOpen('${a.id}')`, c: { n: `<span class="nm">${esc(a.n)}</span>`, c: CAT[a.cat].l, p: placeName(a.place), d: day(a.acq), cost: money(a.cost), bv: money(bookOf(a)), m: monthCharge(a) ? money(monthCharge(a)) : DASH } })),
          foot: { n: plural(list.length, 'asset'), cost: money(sum(list, a => a.cost)), bv: money(sum(list, bookOf)), m: money(sum(list, monthCharge)) },
          empty: 'No asset matches',
        })
    } else if (tab === 'prj') {
      const f = filt(id, 'pst', 'all'), n = k => PRJ.filter(p => p.st === k).length
      const list = PRJ.filter(p => f === 'all' || p.st === f)
      kpis = [
        { label: 'In Uang Muka', value: money(sum(PRJ.filter(p => p.st !== 'done'), p => prjSum(p).dpp)) },
        { label: 'Ready to capitalise', value: String(n('ready')), on: `setFilt('${id}','pst','ready')` },
        { label: 'Capitalised in 2026', value: money(sum(PRJ.filter(p => p.st === 'done'), p => prjSum(p).dpp)) },
        { label: 'Projects', value: String(PRJ.length) },
      ]
      body = bar(chips(id, 'pst', [['all', 'All', PRJ.length], ['open', 'Open', n('open')], ['ready', 'Ready to capitalise', n('ready')], ['done', 'Capitalised', n('done')]], 'all'))
        + table({
          cols: [{ l: 'Project', k: 'n' }, { l: 'Shop', k: 's', w: 180 }, { l: 'GA lead', k: 'g', w: 180 }, { l: 'Handed over', k: 'h', w: 130 }, { l: 'Paid to contractor', k: 'p', num: 1, w: 170 }, { l: 'Status', k: 'st', w: 190 }],
          rows: list.map(p => { const [w, t] = PRJW[p.st]; return { on: `astPrj('${p.id}')`, c: { n: `<span class="nm">${esc(p.n)}</span>`, s: placeName(p.shop), g: esc(p.lead), h: p.handed ? dayS(p.handed) : DASH, p: money(prjSum(p).paid), st: st(w, t) } } }),
          foot: { n: plural(list.length, 'project'), p: money(sum(list, p => prjSum(p).paid)) },
          empty: 'No project matches',
        })
    } else if (tab === 'depr') {
      const lines = deprLines(), total = sum(lines, l => l.amt)
      const ytd = sum([...AS, ...DISP], a => accumAt(a, a.out ? '2026-09' : POSTED()) - accumAt(a, '2025-12'))
      kpis = [
        { label: 'October charge', value: money(total) },
        { label: 'Assets charged', value: String(sum(lines, l => l.n)) },
        { label: 'Charged in 2026', value: money(ytd) },
        { label: 'October', value: AST.oct ? 'Posted' : 'To charge', tone: AST.oct ? 'ok' : '' },
      ]
      if (!AST.oct) actions = [{ label: 'Charge October', on: 'astCharge()' }]
      body = deprJournal(lines, total)
    } else {
      const net = sum(DISP, dispGain)
      kpis = [
        { label: 'Disposed in 2026', value: String(DISP.length) },
        { label: 'Cost out', value: money(sum(DISP, a => a.cost)) },
        { label: 'Book value out', value: money(sum(DISP, dispBook)) },
        { label: 'Gain or loss', value: signed(net) },
      ]
      body = table({
        cols: [{ l: 'Asset', k: 'n' }, { l: 'Place', k: 'p', w: 160 }, { l: 'Disposed', k: 'd', w: 110 }, { l: 'How', k: 'h', w: 140 }, { l: 'Book value', k: 'bv', num: 1, w: 150 }, { l: 'Proceeds', k: 'pr', num: 1, w: 150 }, { l: 'Gain or loss', k: 'g', num: 1, w: 150 }],
        rows: DISP.map(a => ({ on: `astDisp('${a.id}')`, c: { n: `<span class="nm">${esc(a.n)}</span> <span class="mute">${a.id}</span>`, p: placeName(a.place), d: dayS(a.out), h: a.how, bv: money(dispBook(a)), pr: a.proceeds ? money(a.proceeds) : DASH, g: signed(dispGain(a)) } })),
        foot: { n: plural(DISP.length, 'asset'), bv: money(sum(DISP, dispBook)), pr: money(sum(DISP, a => a.proceeds)), g: signed(net) },
      })
    }
    return page({ title: 'Assets', actions, tabs: [['reg', 'Register', AS.length], ['prj', 'Projects', PRJ.length], ['depr', 'Depreciation'], ['disp', 'Disposals', DISP.length]], tab, kpis, body })
  },
})

/* one line per category and shop, as the run books it */
function deprLines() {
  const g = {}
  AS.forEach(a => {
    const ch = chargeIn(a, '2026-10'); if (!ch) return
    const k = a.cat + '|' + a.place
    g[k] = g[k] || { cat: a.cat, place: a.place, amt: 0, n: 0 }
    g[k].amt += ch; g[k].n++
  })
  return Object.values(g).sort((x, y) => CATS.indexOf(x.cat) - CATS.indexOf(y.cat) || LOC(x.place).localeCompare(LOC(y.place)))
}
/* 7Soft's Jurnal Umum, filled by the run (Otomatis) */
function deprJournal(lines, total) {
  const ju = AST.oct ? AST.octJu : juNo(JU.n)
  const ur = l => `${l.cat === 'pre' ? 'Amortisasi' : 'Penyusutan'} Okt 2026 · ${l.place}`
  const tr = (name, c, u, d, k) => `<tr><td>${esc(name)}</td><td class="mute">${c}</td><td>${esc(u)}</td><td class="r">${d ? dots(d) : ''}</td><td class="r">${k ? dots(k) : ''}</td></tr>`
  const head = `<div class="kl-head">
    <div class="kl-col">${field('No Jurnal', `<input value="${ju}" disabled>`, { optl: 'Otomatis' })}${field('Tanggal', '<input value="31 Oct 2026" disabled>')}</div>
    <div class="kl-col">${field('Keterangan', '<input value="Penyusutan & amortisasi aktiva, Oktober 2026" disabled>')}${field('Periode', '<input value="October 2026" disabled>')}</div>
    <div class="kl-total"><span class="lbl">Total</span><div class="big"><small>Rp</small>${dots(total)}</div><div class="words">${terbilang(total)}</div>
      <dl class="kl-mini"><div><dt>Debet</dt><dd>${dots(total)}</dd></div><div><dt>Kredit</dt><dd>${dots(total)}</dd></div><div><dt>Selisih</dt><dd>0</dd></div></dl></div>
  </div>`
  const grid = `<div class="kl-grid"><table><colgroup><col><col style="width:150px"><col style="width:250px"><col style="width:170px"><col style="width:170px"></colgroup>
    <thead><tr><th>Deskripsi Account</th><th>Kode</th><th>Uraian</th><th class="r">Debet</th><th class="r">Kredit</th></tr></thead>
    <tbody>${lines.map(l => { const c = CAT[l.cat]; return tr(nm(c.d), code(c.d, l.place), ur(l), l.amt, 0) + tr(nm(c.k), code(c.k, l.place), ur(l), 0, l.amt) }).join('')}</tbody>
    <tfoot><tr><td colspan="3">Total · ${plural(lines.length * 2, 'line')}</td><td class="r">${dots(total)}</td><td class="r">${dots(total)}</td></tr></tfoot></table></div>`
  return `<div class="sec-head"><h3>Jurnal Umum · ${ju}</h3><span style="display:flex;gap:8px">${AST.oct ? pill('Posted', 'ok') + pill('READ ONLY', 'ro') : pill('To charge', 'warn')}</span></div>
    ${head}${grid}${AST.oct ? `<div class="kl-status"><span>Posted by ${FIN} · ${dayS(TODAY)} ${AST.octAt}</span></div>` : ''}`
}
function astCharge() {
  if (AST.oct) return
  const total = octCharge()
  AST.oct = true; AST.octJu = takeJU(); AST.octAt = now()
  hist('Assets', 'Added', `${AST.octJu} · Penyusutan Oktober`)
  toast('October charged', `${AST.octJu} · ${money(total)}`)
  render()
}

/* one asset: what it cost, what is left, the next six charges */
function assetSheet(id) {
  const a = AS.find(x => x.id === id), c = CAT[a.cat], ac = accumAt(a, POSTED())
  const prj = a.prj && PRJ.find(p => p.id === a.prj)
  const from = a.bill ? lnk(a.bill, `finGoBill('${a.bill}')`) : prj ? lnk(prj.id, `astPrj('${prj.id}')`) : 'Saldo awal'
  const accF = base => `${code(base, a.place)}<br><span class="mute">${esc(nm(base))}</span>`
  const sched = Array.from({ length: 6 }, (_, i) => ymAdd('2026-10', i)).map(y => ({ y, ch: chargeIn(a, y), acc: accumAt(a, y) }))
  return {
    size: 'record', crumb: ['Assets', placeName(a.place)], title: esc(a.n), pill: `<span class="code">${a.id}</span>`,
    body: `${kpisHTML([{ label: 'Cost', value: money(a.cost) }, { label: 'Accumulated', value: money(ac) }, { label: 'Book value', value: money(a.cost - ac) }, { label: 'Months left', value: String(leftOf(a)) }])}
      ${facts([['Kode', a.id], ['Category', c.l], ['Place', placeName(a.place)], ['Acquired', day(a.acq)],
        ['Life', `${lifeOf(a)} months`], ['Method', 'Garis lurus'], ['Charge starts', monL(startOf(a))], ['From', from],
        ['Aktiva', accF(c.a)], [a.cat === 'pre' ? 'Biaya Amortisasi' : 'Biaya Depresiasi', accF(c.d)], ['Akumulasi', accF(c.k)], ['Moved', a.moved ? `From ${a.moved.from} · ${day(a.moved.on)}` : '—']])}
      ${sec('Next 6 months', table({
        cols: [{ l: 'Month', k: 'm' }, { l: 'Charge', k: 'ch', num: 1, w: 160 }, { l: 'Accumulated', k: 'ac', num: 1, w: 170 }, { l: 'Book value', k: 'bv', num: 1, w: 170 }, { l: 'Status', k: 'st', w: 160 }],
        rows: sched.map(s => ({ cls: s.ch ? '' : 'dim', c: { m: monL(s.y), ch: s.ch ? money(s.ch) : DASH, ac: money(s.acc), bv: money(a.cost - s.acc), st: !s.ch ? st('Fully charged') : s.y === '2026-10' ? (AST.oct ? st('Posted', 'ok') : st('To charge', 'warn')) : st('Planned') } })),
      }))}`,
    foot: `<div class="foot-left">${lnk('Print', "soon('Print the asset card')", 'printer')}</div>${btn('Move to another shop', `astMove('${a.id}')`)}`,
  }
}
const astOpen = id => openSheet(assetSheet(id))
function astMove(id) {
  const a = AS.find(x => x.id === id)
  const opts = ['HO', ...STORES.map(s => s.code)].filter(p => p !== a.place)
  openSheet({
    size: 'rail', crumb: ['Assets', a.id], title: 'Move to another shop',
    body: `${field('From', `<input value="${esc(placeName(a.place))}" disabled>`)}
      ${field('To', `<select id="ast-to">${opts.map(p => `<option value="${p}">${esc(placeName(p))}</option>`).join('')}</select>`, { req: 1 })}
      ${field('Moved on', `<input type="date" id="ast-on" value="${TODAY}">`, { req: 1 })}`,
    foot: btn('Move', `astMoveDo('${a.id}')`),
  })
}
function astMoveDo(id) {
  const a = AS.find(x => x.id === id), to = $('#ast-to').value, from = a.place, ju = takeJU()
  a.moved = { from, on: $('#ast-on').value || TODAY }; a.place = to
  hist('Assets', 'Edited', `${a.id} · ${from} → ${to}`)
  closeSheet()
  setTimeout(() => { refreshSheet(assetSheet(id)); render() }, 230)
  toast(`${a.n} moved to ${to}`, `${ju} moves cost and Akumulasi from location ${LOC(from)} to ${LOC(to)}`)
}

/* one project: the tranches paid into Uang Muka, and where each rupiah goes when it is capitalised */
function prjSheet(id) {
  const p = PRJ.find(x => x.id === id), s = prjSum(p), [w, t] = PRJW[p.st], L = LOC(p.shop)
  const trs = p.tr.map(trx)
  const split = p.split.map(([k, n, amt, aid]) => k === 'exp' ? { go: 'Expense', n, acc: EXP, amt, aid: '' } : { go: CAT[k].l, n, acc: CAT[k].a, amt, aid })
  const rows = split.length ? [...split, { go: 'PPN Masukan', n: 'PPN 12% · DPP 11/12', acc: '1011302004', loc: '00', amt: s.ppn, aid: '' }, { go: 'PPh 23 withheld', n: 'PPh 23 · 2% of DPP', acc: '2012101002', loc: '00', amt: -s.pph, aid: '' }] : []
  const foot = `<div class="foot-left">${lnk('Print', "soon('Print the project')", 'printer')}</div>` + (p.st === 'ready' ? btn('Capitalise', `astCap('${p.id}')`) : p.st === 'done' ? btn('Open journal', "go('journal')") : '')
  return {
    size: 'workspace', crumb: ['Assets', 'Projects'], title: esc(p.n), pill: pill(w, t),
    body: `${kpisHTML([{ label: 'Budget', value: money(p.budget) }, { label: 'Cost (DPP)', value: money(s.dpp) }, { label: 'PPN Masukan', value: money(s.ppn) }, { label: 'PPh 23 withheld', value: money(s.pph) }, { label: 'Paid to contractor', value: money(s.paid) }])}
      ${facts([['Project', p.id], ['Shop', placeName(p.shop)], ['GA lead', esc(p.lead)], ['Contractor', CON], ['Handed over', p.handed ? day(p.handed) : '—'], ['Capitalised', p.capOn ? day(p.capOn) : '—'], ['Journal', p.ju || '—'], ['Paid into', `${ADV}${L} · ${esc(nm(ADV))}`]])}
      ${sec('Tranches', table({
        cols: [{ l: 'Tranche', k: 'n' }, { l: 'Paid on', k: 'd', w: 110 }, { l: 'BKK', k: 'b', w: 200 }, { l: 'DPP', k: 'dpp', num: 1, w: 160 }, { l: 'PPN', k: 'ppn', num: 1, w: 150 }, { l: 'PPh 23', k: 'pph', num: 1, w: 150 }, { l: 'Paid', k: 'paid', num: 1, w: 170 }],
        rows: trs.map((x, i) => ({ on: `astTr('${p.id}',${i})`, c: { n: `<span class="nm">${esc(x.name)}</span>`, d: dayS(x.date), b: x.bkk, dpp: money(x.dpp), ppn: money(x.ppn), pph: money(-x.pph), paid: money(x.paid) } })),
        foot: { n: plural(trs.length, 'tranche'), dpp: money(s.dpp), ppn: money(s.ppn), pph: money(-s.pph), paid: money(s.paid) },
      }))}
      ${sec('Split', table({
        cols: [{ l: 'Goes to', k: 'g', w: 220 }, { l: 'What', k: 'n' }, { l: 'Asset', k: 'a', w: 150 }, { l: 'Account', k: 'c', w: 160 }, { l: 'Amount', k: 'amt', num: 1, w: 170 }],
        rows: rows.map(r => ({ on: r.aid ? `astOpen('${r.aid}')` : '', c: { g: `<span class="nm">${r.go}</span>`, n: esc(r.n), a: r.aid || (r.acc === EXP || r.loc ? DASH : '<span class="mute">New</span>'), c: `<span class="mute">${r.acc}${r.loc || L}</span>`, amt: money(r.amt) } })),
        foot: rows.length ? { g: 'Paid to contractor', amt: money(s.paid) } : null,
        empty: 'Split once GA hands the work over',
      }))}`,
    foot,
  }
}
const astPrj = id => openSheet(prjSheet(id))
/* one tranche: the journal its BKK posted */
function astTr(id, i) {
  const p = PRJ.find(x => x.id === id), x = trx(p.tr[i]), L = LOC(p.shop)
  const lines = [[ADV + L, nm(ADV), x.dpp, 0], ['1011302004' + '00', nm('1011302004'), x.ppn, 0], ['1011002001' + '00', nm('1011002001'), 0, x.paid], ['2012101002' + '00', nm('2012101002'), 0, x.pph]]
  openSheet({
    size: 'wide', crumb: ['Projects', p.id], title: esc(x.name), pill: `<span class="code">${x.bkk}</span>`,
    body: `${facts([['Paid on', day(x.date)], ['BKK', x.bkk], ['Paid to', CON], ['From', 'Giro BCA · 0262 113 488']])}
      ${sec('Journal', table({
        cols: [{ l: 'Account', k: 'n' }, { l: 'Kode', k: 'c', w: 160 }, { l: 'Debet', k: 'd', num: 1, w: 170 }, { l: 'Kredit', k: 'k', num: 1, w: 170 }],
        rows: lines.map(l => ({ c: { n: esc(l[1]), c: `<span class="mute">${l[0]}</span>`, d: l[2] ? money(l[2]) : '', k: l[3] ? money(l[3]) : '' } })),
        foot: { n: 'Total', d: money(x.dpp + x.ppn), k: money(x.paid + x.pph) },
      }))}`,
    foot: `<div class="foot-left">${lnk('Print BKK', "soon('Bukti Kas/Bank Keluar')", 'printer')}</div>`,
  })
}
function astCap(id) {
  const p = PRJ.find(x => x.id === id), ju = takeJU()
  const next = k => { const ns = [...AS, ...DISP].filter(a => a.cat === k).map(a => +a.id.slice(-4)); return `AT-${CAT[k].s}-${pad4(Math.max(0, ...ns) + 1)}` }
  p.split.forEach(s => {
    if (s[0] === 'exp') return
    const a = { id: next(s[0]), n: s[0] === 'pre' ? 'Pre Opening' : s[1], cat: s[0], place: p.shop, acq: TODAY, cost: s[2], prj: p.id }
    AS.push(a); s[3] = a.id
  })
  p.st = 'done'; p.capOn = TODAY; p.ju = ju
  hist('Assets', 'Added', `${ju} · ${p.n}`)
  const made = p.split.filter(s => s[0] !== 'exp').length, exp = sum(p.split.filter(s => s[0] === 'exp'), s => s[2])
  refreshSheet(prjSheet(id)); render()
  toast(`${p.n} capitalised`, `${ju} · ${plural(made, 'asset')}${exp ? ` · ${money(exp)} to expense` : ''}`)
}
/* one disposal and its journal */
function astDisp(id) {
  const a = DISP.find(x => x.id === id), c = CAT[a.cat], ac = dispAcc(a), g = dispGain(a)
  const L = [
    ...(a.proceeds ? [[code('1011001001', a.place), nm('1011001001'), a.proceeds, 0]] : []),
    [code(c.k, a.place), nm(c.k), ac, 0],
    ...(g < 0 ? [[code('8010110007', a.place), nm('8010110007'), -g, 0]] : []),
    [code(c.a, a.place), nm(c.a), 0, a.cost],
    ...(g > 0 ? [[code('8010110007', a.place), nm('8010110007'), 0, g]] : []),
  ]
  openSheet({
    size: 'wide', crumb: ['Assets', 'Disposals'], title: esc(a.n), pill: pill(a.how, ''),
    body: `${kpisHTML([{ label: 'Cost', value: money(a.cost) }, { label: 'Accumulated', value: money(ac) }, { label: 'Book value', value: money(a.cost - ac) }, { label: 'Proceeds', value: money(a.proceeds) }, { label: 'Gain or loss', value: signed(g) }])}
      ${facts([['Kode', a.id], ['Category', c.l], ['Place', placeName(a.place)], ['Acquired', day(a.acq)], ['Disposed', day(a.out)], ['How', a.how], [a.proceeds ? 'Sold to' : 'Reason', esc(a.why)], ['Journal', a.ju]])}
      ${sec('Journal', table({
        cols: [{ l: 'Account', k: 'n' }, { l: 'Kode', k: 'c', w: 160 }, { l: 'Debet', k: 'd', num: 1, w: 160 }, { l: 'Kredit', k: 'k', num: 1, w: 160 }],
        rows: L.map(l => ({ c: { n: esc(l[1]), c: `<span class="mute">${l[0]}</span>`, d: l[2] ? money(l[2]) : '', k: l[3] ? money(l[3]) : '' } })),
        foot: { n: 'Total', d: money(sum(L, l => l[2])), k: money(sum(L, l => l[3])) },
      }))}`,
    foot: `<div class="foot-left">${lnk('Print', "soon('Berita acara pelepasan aktiva')", 'printer')}</div>${btn('Open journal', "go('journal')")}`,
  })
}

/* ═════════ Month end ═════════ */
const ME = window.FIN_CLOSE = { acc: [true, false, false], prepaid: false, stock: false, tax: false, git: false, points: true, locked: false, dec: false }
const ACR = [
  { n: 'Listrik Oktober · 14 lokasi', d: '6010310006', c: 'BKK/HO/2610/0060', amt: 18452300, doc: 'BKK/HO/2610/0060' },
  { n: 'Air PDAM Oktober · 9 lokasi', d: '6010310007', c: '2012201008', amt: 3245000 },
  { n: 'Lembur & insentif Oktober', d: '6010111002', c: '2012201001', amt: 46800000 },
]
const PREP = [
  { n: 'Sewa toko C011 · Aug–Oct', bal: 15000000, share: 15000000 },
  { n: 'Sewa toko C011 · Nov–Jan', bal: 45000000, share: 0, doc: 'BKK/HO/2610/0050' },
]
const STOCK_DIFF = { C004: -2112000, C009: -1370500 }
const STOCK_W = [34, 5.2, 4.8, 5.1, 4.9, 5.3, 4.6, 5.0, 5.2, 4.7, 5.4, 5.0, 5.3, 5.5]
const GIT = [
  { shop: 'C003', sj: 'SJ/HO/2610/0412', sent: '2026-10-27', koli: 6, val: 18240000 },
  { shop: 'C010', sj: 'SJ/HO/2610/0413', sent: '2026-10-27', koli: 4, val: 12960000 },
  { shop: 'C013', sj: 'SJ/HO/2610/0409', sent: '2026-10-26', koli: 5, val: 17450000 },
]
const unit3 = p => p === 'HO' ? '001' : String(+LOC(p) + 1).padStart(3, '0')
const AFF = STORES.map((s, i) => { const ho = round(150e6 + ((i * 7907) % 97) * 1.1e6, 1000); return { code: s.code, ho, unit: s.code === 'C007' ? ho - 1250000 : ho } })
const POINTS = [['Saldo 1 Oct', 195250, 19525000], ['Earned at the tills', 84120, 8412000], ['Redeemed at the tills', -58600, -5860000], ['Expired', -4370, -437000]]
const PER = Array.from({ length: 11 }, (_, i) => { const m = i + 1, y = `2026-${pad2(m)}`; return { y, st: m <= 9 ? 'closed' : m === 10 ? 'open' : 'not', by: m <= 9 ? FIN : '', on: m <= 9 ? `2026-${pad2(m + 1)}-${m === 9 ? '09' : pad2(8 + (m % 3))}` : '' } })
const lastDay = y => { const [a, b] = y.split('-').map(Number); return `${y}-${pad2(new Date(Date.UTC(a, b, 0)).getUTCDate())}` }

/* tax for Coretax: PPN Keluaran from the closes, Masukan from October's bills and tranches, PPh 23 from the tranches */
function taxSum() {
  let kel = 0, gross = 0
  octDays().forEach(d => STORES.forEach(s => { const c = closeOf(d, s.code); kel += c.tax; gross += c.gross }))
  const bills = BILLS.filter(b => b.date >= '2026-10-01' && b.date <= TODAY).map(b => { const ppn = Math.round(b.total * 11 / 111); return { no: b.no, sup: b.sup, dpp: b.total - ppn, ppn } })
  const tr = PRJ.flatMap(p => p.tr.map(trx).filter(t => t.date >= '2026-10-01').map(t => ({ ...t, p })))
  const mas = sum(bills, b => b.ppn) + sum(tr, t => t.ppn)
  return { kel, dppK: gross - kel, bills, tr, mas, net: kel - mas, pph: sum(tr, t => t.pph) }
}
window.FIN_TAX = taxSum
function stockRows() {
  const adj = -sum(Object.values(STOCK_DIFF), x => x)
  const inv = ((window.FIN_BS && window.FIN_BS.inv()) || 9286400000) + (ME.stock ? adj : 0)
  const places = ['HO', ...STORES.map(s => s.code)]
  let left = inv
  return places.map((p, i) => {
    const base = i === places.length - 1 ? left : round(inv * STOCK_W[i] / 100, 1000)
    left -= base
    const sys = base + (STOCK_DIFF[p] || 0)
    return { p, sys, led: ME.stock ? sys : base }
  })
}
function closesOct() { const so = d => typeof stateOf === 'function' ? stateOf(d) : d.state; const all = octDays().flatMap(d => STORES.map(s => closeOf(d, s.code))); return { all, open: all.filter(d => so(d) !== 'posted'), so } }

function meRows() {
  const cl = closesOct()
  const banks = ACCOUNTS.filter(a => a.kind === 'bank'), recd = banks.filter(a => !a.toMatch && !a.upload)
  const gir = GIROS.filter(g => (g.state === 'with' && g.due < TODAY) || g.state === 'bounced')
  const mis = BILLS.filter(b => b.matchIssue)
  const accLeft = ACR.filter((a, i) => !ME.acc[i]).length
  const off = AFF.filter(a => a.ho !== a.unit), offAmt = sum(off, a => a.ho - a.unit)
  const tx = taxSum(), sd = sum(Object.values(STOCK_DIFF), x => x)
  return [
    { k: 'days', t: 'Store days posted', fig: `${cl.all.length - cl.open.length} of ${cl.all.length}`, done: !cl.open.length, block: 1, act: lnk('Daily close', `S.day='${addDays(TODAY, -1)}';go('daily-close')`) },
    { k: 'bank', t: 'Bank accounts reconciled', fig: `${recd.length} of ${banks.length}`, done: recd.length === banks.length, block: 1, act: lnk('Reconcile', "go('bank-rec')") },
    { k: 'giro', t: 'Giro checked', fig: gir.length ? `${plural(gir.length, 'giro')} to check` : 'Checked', done: !gir.length, block: 1, act: lnk('Giro', "go('giro')") },
    { k: 'bills', t: 'Bills matched', fig: mis.length ? `${plural(mis.length, 'bill')} to match` : 'Matched', done: !mis.length, block: 1, act: lnk('Bills', "go('bills')") },
    { k: 'acc', t: 'Accruals booked', fig: `${ACR.length - accLeft} of ${ACR.length} booked`, done: !accLeft, act: accLeft ? btn(`Book ${accLeft}`, 'mendAcc()') : '' },
    { k: 'pre', t: 'Prepaids amortised', fig: ME.prepaid ? 'Amortised' : money(sum(PREP, x => x.share)), done: ME.prepaid, act: ME.prepaid ? '' : btn('Amortise', 'mendPrepaid()') },
    { k: 'depr', t: 'Depreciation charged', fig: money(octCharge()), done: AST.oct, act: AST.oct ? '' : btn('Charge', 'astCharge()') },
    { k: 'stock', t: 'Stock vs ledger', fig: ME.stock ? 'Adjusted' : signed(sd), tone: ME.stock ? '' : 'bad', done: ME.stock, act: ME.stock ? '' : btn('Book adjustment', 'mendStock()') },
    { k: 'git', t: 'Goods in transit', fig: money(sum(GIT, g => g.val)), done: ME.git, act: ME.git ? '' : btn('Confirm', 'mendGit()') },
    { k: 'units', t: 'Between units', fig: off.length ? `${money(offAmt)} off` : 'Balanced', tone: off.length ? 'bad' : '', done: !off.length, block: 1, act: lnk('Ledger', "go('ledger','sub')") },
    { k: 'tax', t: 'PPN and PPh 23 for Coretax', fig: ME.tax ? 'Exported' : `PPN ${money(tx.net)}`, done: ME.tax, act: ME.tax ? '' : btn('Export XML', "mendOpen('tax')") },
    { k: 'points', t: 'Member points liability', fig: money(sum(POINTS, x => x[2])), done: ME.points, act: '' },
  ]
}
const checkRow = r => `<div class="check-row" onclick="mendOpen('${r.k}')"><span class="tick ${r.done ? 'done' : r.block ? 'todo' : ''}">${r.done ? ico('check') : ''}</span><span>${r.t}</span><span class="ds-num ${r.done ? 'mute' : r.tone || (r.block ? 'warn' : '')}">${r.fig}</span><span style="text-align:right">${r.done ? '' : r.act}</span></div>`

reg({
  id: 'month-end', group: 'acc', label: 'Month end',
  s7: [['Closing Periode Akuntansi'], ['Reproses Accounting'], ['Create Period', 'periods'], ['Tutup Buku']],
  badge: () => { const n = ME.locked ? 0 : meRows().filter(r => !r.done).length; return n ? [n, 'warn'] : null },
  render() {
    const id = 'month-end', tab = tabOf(id, 'check')
    let kpis, body, actions = []
    if (tab === 'check') {
      const rows = meRows(), open = rows.filter(r => !r.done), blockN = open.filter(r => r.block).length
      const left = daysBetween(TODAY, '2026-11-10')
      kpis = [
        { label: 'Done', value: `${rows.length - open.length} of ${rows.length}` },
        { label: 'To do', value: String(open.length - blockN) },
        { label: 'Blocking', value: String(blockN), tone: blockN ? 'bad' : '' },
        { label: 'Days to deadline', value: `${left} · 10 Nov`, tone: left <= 5 ? 'warn' : '' },
      ]
      const lock = ME.locked
        ? `<div class="check-row" style="cursor:default"><span class="tick done">${ico('check')}</span><span>Lock October</span><span class="mute">Locked · ${dayS(TODAY)}</span><span></span></div>`
        : `<div class="check-row" style="cursor:default"><span class="tick"></span><span>Lock October</span><span class="mute">${open.length ? `Waits on ${open.length}` : 'Ready'}</span><span style="text-align:right">${open.length ? '<button class="ds-btn ds-btn--primary" type="button" disabled>Lock October</button>' : btn('Lock October', 'mendLock()')}</span></div>`
      const yearEnd = `<div class="check-row" style="cursor:default"><span class="tick" style="border-style:dashed"></span><span class="mute">Year end · closes the year into 3013001002 Laba (Rugi) Ditahan</span><span class="mute">December only</span><span></span></div>`
      body = (open.length && !ME.locked ? `<div class="banner warn">${ico('alert')}<span>Lock October waits on ${open.map(r => r.t).join(' · ')}</span></div>` : '')
        + `<div class="ds-table-card">${rows.map(checkRow).join('')}${lock}${yearEnd}</div>`
    } else {
      const closed = PER.filter(p => p.st === 'closed'), last = closed[closed.length - 1]
      kpis = [
        { label: 'Closed', value: String(closed.length) },
        { label: 'Open', value: PER.filter(p => p.st === 'open').map(p => monL(p.y)).join(' · ') || '—' },
        { label: 'Last closed', value: last ? monL(last.y) : '—' },
      ]
      if (!ME.dec) actions = [{ label: 'Create period', icon: 'plus', on: 'mendDec()' }]
      const W = { closed: ['Closed', ''], open: ['Open', 'info'], not: ['Not yet', ''] }
      body = table({
        cols: [{ l: 'Period', k: 'p' }, { l: 'From', k: 'f', w: 100 }, { l: 'To', k: 't', w: 100 }, { l: 'Status', k: 's', w: 150 }, { l: 'Closed by', k: 'b', w: 190 }, { l: 'Closed on', k: 'o', w: 130 }, { l: '', k: 'act', cls: 'act', w: 160 }],
        rows: PER.map(p => ({
          cls: p.st === 'not' ? 'dim' : '', on: p.st === 'open' ? `setTab('${id}','check')` : p.st === 'closed' ? `mendPer('${p.y}')` : '',
          c: { p: `<span class="nm">${monL(p.y)}</span>`, f: dayS(p.y + '-01'), t: dayS(lastDay(p.y)), s: st(...W[p.st]), b: p.by ? esc(p.by) : DASH, o: p.on ? day(p.on) : DASH, act: p === last ? lnk('Undo closing', `mendUndo('${p.y}')`, 'undo') : '' },
        })),
      })
    }
    return page({ title: 'Month end', actions, tabs: [['check', 'October checklist'], ['periods', 'Periods', PER.length]], tab, kpis, body })
  },
})

/* the sheet behind each row's figure */
function mendSheet(k) {
  const base = { size: 'wide', crumb: ['Month end', 'October 2026'] }
  const pr = (label, act) => `<div class="foot-left">${lnk('Print', `soon('Print ${label}')`, 'printer')}</div>${act || ''}`
  if (k === 'days') {
    const cl = closesOct()
    return { ...base, title: 'Store days posted', pill: cl.open.length ? pill(`${cl.open.length} to post`, 'warn') : pill('All posted', 'ok'),
      body: `${kpisHTML([{ label: 'Shop days', value: String(cl.all.length) }, { label: 'Posted', value: String(cl.all.length - cl.open.length) }, { label: 'To post', value: String(cl.open.length), tone: cl.open.length ? 'warn' : '' }, { label: 'Not closed', value: String(cl.open.filter(d => cl.so(d) === 'open').length), tone: cl.open.some(d => cl.so(d) === 'open') ? 'bad' : '' }])}
        ${table({
          cols: [{ l: 'Day', k: 'd', w: 120 }, { l: 'Shop', k: 's' }, { l: 'Takings', k: 'g', num: 1, w: 160 }, { l: 'Cash difference', k: 'x', num: 1, w: 160 }, { l: 'Status', k: 'st', w: 160 }],
          rows: cl.open.map(d => { const [w, t] = CLOSE_WORD[cl.so(d)]; return { on: `openClose('${d.date}','${d.code}')`, c: { d: `${weekday(d.date)} ${dayS(d.date)}`, s: `<span class="nm">${d.code}</span> <span class="mute">${esc(STORE[d.code].name)}</span>`, g: money(d.gross), x: d.counted == null ? DASH : d.diff ? `<span class="${d.diff < 0 ? 'bad' : 'warn'}">${signed(d.diff)}</span>` : '<span class="mute">0</span>', st: st(w, t) } } }),
          empty: 'Every shop day of October is posted',
        })}`,
      foot: pr('the open days', btn('Open Daily close', `S.day='${addDays(TODAY, -1)}';go('daily-close')`)) }
  }
  if (k === 'bank') {
    const banks = ACCOUNTS.filter(a => a.kind === 'bank')
    return { ...base, title: 'Bank accounts reconciled', pill: pill(`${banks.filter(a => !a.toMatch && !a.upload).length} of ${banks.length}`, 'warn'),
      body: table({
        cols: [{ l: 'Account', k: 'a' }, { l: 'Statement', k: 's', w: 110 }, { l: 'Books', k: 'b', num: 1, w: 160 }, { l: 'Bank', k: 'k', num: 1, w: 160 }, { l: 'To match', k: 'm', num: 1, w: 110 }, { l: 'Status', k: 'st', w: 170 }],
        rows: banks.map(a => ({ on: `reconcile('${a.id}')`, c: { a: `<span class="nm">${a.name}</span> <span class="mute">${a.no}</span>`, s: dayS(a.stmt), b: money(a.books), k: money(a.bankBal), m: a.toMatch ? String(a.toMatch) : DASH, st: a.upload ? st('Upload statement', 'warn') : a.toMatch ? st('To match', 'warn') : st('Reconciled', 'ok') } })),
      }),
      foot: pr('the bank list', btn('Open Bank reconciliation', "go('bank-rec')")) }
  }
  if (k === 'giro') {
    const gs = GIROS.filter(g => (g.state === 'with' && g.due < TODAY) || g.state === 'bounced')
    return { ...base, title: 'Giro checked', pill: gs.length ? pill(`${gs.length} to check`, 'warn') : pill('Checked', 'ok'),
      body: table({
        cols: [{ l: 'BG', k: 'n', w: 110 }, { l: 'Supplier', k: 's' }, { l: 'BKK', k: 'b', w: 200 }, { l: 'Due', k: 'd', w: 100 }, { l: 'Amount', k: 'a', num: 1, w: 160 }, { l: 'Status', k: 'st', w: 200 }],
        rows: gs.map(g => ({ on: `finGoGiro('${g.no}')`, c: { n: `<span class="nm">${g.no}</span>`, s: esc(SUP[g.sup].name), b: g.bkk, d: `<span class="${g.state === 'bounced' ? '' : 'bad'}">${dayS(g.due)}</span>`, a: money(g.amt), st: g.state === 'bounced' ? st('Bounced', 'bad') : g.onStatement ? st('Cleared on statement', 'warn') : st('Late', 'bad') } })),
        empty: 'No giro to check',
      }),
      foot: pr('the giro list', btn('Open Giro', "go('giro')")) }
  }
  if (k === 'bills') {
    const bs = BILLS.filter(b => b.matchIssue)
    return { ...base, title: 'Bills matched', pill: bs.length ? pill(`${bs.length} to match`, 'warn') : pill('Matched', 'ok'),
      body: table({
        cols: [{ l: 'Bill', k: 'n', w: 190 }, { l: 'Supplier', k: 's', w: 240 }, { l: 'Issue', k: 'i' }, { l: 'Total', k: 't', num: 1, w: 160 }],
        rows: bs.map(b => ({ on: `finGoBill('${b.no}')`, c: { n: `<span class="nm">${b.no}</span>`, s: esc(SUP[b.sup].name), i: `<span class="one">${esc(b.matchIssue)}</span>`, t: money(b.total) } })),
        empty: 'Every bill matches its PO and receipt',
      }),
      foot: pr('the bills', btn('Open Bills', "go('bills')")) }
  }
  if (k === 'acc') {
    const left = ACR.filter((a, i) => !ME.acc[i]).length
    return { ...base, title: 'Accruals booked', pill: left ? pill(`${left} to book`, 'warn') : pill('Booked', 'ok'),
      body: table({
        cols: [{ l: 'Accrual', k: 'n' }, { l: 'Debit', k: 'd', w: 150 }, { l: 'Credit', k: 'c', w: 200 }, { l: 'Amount', k: 'a', num: 1, w: 160 }, { l: 'Status', k: 'st', w: 150 }],
        rows: ACR.map((a, i) => ({ on: a.doc ? `openDoc('bkk','${a.doc}')` : '', c: { n: `<span class="nm">${a.n}</span>`, d: `<span class="mute">${a.d}00</span>`, c: a.doc ? a.doc : `<span class="mute">${a.c}00</span>`, a: money(a.amt), st: a.doc ? st('Paid by BKK', 'ok') : ME.acc[i] ? st('Booked', 'ok') : st('To book') } })),
        foot: { n: plural(ACR.length, 'accrual'), a: money(sum(ACR, a => a.amt)) },
      }),
      foot: pr('the accruals', left ? btn(`Book ${plural(left, 'accrual')}`, 'mendAcc()') : btn('Open journal', "go('journal')")) }
  }
  if (k === 'pre') {
    return { ...base, title: 'Prepaids amortised', pill: ME.prepaid ? pill('Amortised', 'ok') : pill('To amortise', 'warn'),
      body: `${ME.prepaid ? '' : `<div class="banner info">${ico('clock')}<span>Amortise posts ${money(15000000)}: debit 701011000311 ${esc(nm('7010110003'))}, credit 101130100311 ${esc(nm('1011301003'))}</span></div>`}
        ${table({
          cols: [{ l: 'Prepaid', k: 'n' }, { l: 'Account', k: 'a', w: 150 }, { l: 'Balance 1 Oct', k: 'b', num: 1, w: 160 }, { l: 'October share', k: 's', num: 1, w: 160 }, { l: 'Left', k: 'l', num: 1, w: 160 }],
          rows: PREP.map(p => ({ on: p.doc ? `openDoc('bkk','${p.doc}')` : '', c: { n: `<span class="nm">${p.n}</span>`, a: '<span class="mute">101130100311</span>', b: money(p.bal), s: p.share ? money(p.share) : '<span class="mute">Starts Nov</span>', l: money(p.bal - (ME.prepaid ? p.share : 0)) } })),
          foot: { n: 'Sewa Toko Bayar Dimuka · C011', b: money(sum(PREP, p => p.bal)), s: money(sum(PREP, p => p.share)), l: money(sum(PREP, p => p.bal - (ME.prepaid ? p.share : 0))) },
        })}`,
      foot: pr('the prepaids', ME.prepaid ? btn('Open journal', "go('journal')") : btn('Amortise October', 'mendPrepaid()')) }
  }
  if (k === 'depr') {
    const by = CATS.map(c => ({ c, xs: AS.filter(a => a.cat === c && chargeIn(a, '2026-10')) })).filter(x => x.xs.length)
    return { ...base, title: 'Depreciation charged', pill: AST.oct ? pill('Posted', 'ok') : pill('To charge', 'warn'),
      body: table({
        cols: [{ l: 'Category', k: 'c' }, { l: 'Assets', k: 'n', num: 1, w: 120 }, { l: 'October charge', k: 'a', num: 1, w: 180 }],
        rows: by.map(x => ({ on: "go('assets','depr')", c: { c: `<span class="nm">${CAT[x.c].l}</span>`, n: String(x.xs.length), a: money(sum(x.xs, a => chargeIn(a, '2026-10'))) } })),
        foot: { c: AST.oct ? AST.octJu : juNo(JU.n), n: String(sum(by, x => x.xs.length)), a: money(octCharge()) },
      }),
      foot: pr('the run', AST.oct ? btn('Open the journal', "go('assets','depr')") : btn('Charge October', 'mendCharge()')) }
  }
  if (k === 'stock') {
    const rs = stockRows(), d = sum(rs, r => r.sys - r.led)
    return { ...base, title: 'Stock vs ledger', pill: ME.stock ? pill('Adjusted', 'ok') : pill(`${signed(sum(Object.values(STOCK_DIFF), x => x))} off`, 'bad'),
      body: `${ME.stock ? '' : `<div class="banner bad">${ico('alert')}<span>Stock counts ${money(-sum(Object.values(STOCK_DIFF), x => x))} less than the ledger at C004 and C009. Book adjustment posts it to 8010110006 ${esc(nm('8010110006'))}.</span></div>`}
        ${table({
          cols: [{ l: 'Place', k: 'p' }, { l: 'Stock', k: 's', num: 1, w: 190 }, { l: 'Ledger 1011201001', k: 'l', num: 1, w: 200 }, { l: 'Difference', k: 'd', num: 1, w: 160 }],
          rows: rs.map(r => ({ on: "go('ledger','sub')", c: { p: placeName(r.p), s: money(r.sys), l: money(r.led), d: r.sys - r.led ? `<span class="bad">${signed(r.sys - r.led)}</span>` : '<span class="mute">0</span>' } })),
          foot: { p: plural(rs.length, 'place'), s: money(sum(rs, r => r.sys)), l: money(sum(rs, r => r.led)), d: signed(d) },
        })}`,
      foot: pr('stock vs ledger', ME.stock ? btn('Open journal', "go('journal')") : btn('Book adjustment', 'mendStock()')) }
  }
  if (k === 'git') {
    return { ...base, title: 'Goods in transit', pill: ME.git ? pill('Confirmed', 'ok') : pill('To confirm', 'warn'),
      body: table({
        cols: [{ l: 'Shop', k: 's' }, { l: 'Surat jalan', k: 'j', w: 190 }, { l: 'Sent', k: 'd', w: 100 }, { l: 'Koli', k: 'k', num: 1, w: 80 }, { l: 'Account', k: 'a', w: 150 }, { l: 'Value', k: 'v', num: 1, w: 160 }],
        rows: GIT.map(g => ({ c: { s: placeName(g.shop), j: `<span class="nm">${g.sj}</span>`, d: dayS(g.sent), k: String(g.koli), a: `<span class="mute">1011203${unit3(g.shop)}00</span>`, v: money(g.val) } })),
        foot: { s: 'Barang Dalam Perjalanan', k: String(sum(GIT, g => g.koli)), v: money(sum(GIT, g => g.val)) },
      }),
      foot: pr('goods in transit', ME.git ? '' : btn('Confirm', 'mendGit()')) }
  }
  if (k === 'units') {
    const off = AFF.filter(a => a.ho !== a.unit)
    return { ...base, title: 'Between units', pill: off.length ? pill(`${off.length} pair off`, 'bad') : pill('Balanced', 'ok'),
      body: `${off.map(a => `<div class="banner bad">${ico('alert')}<span>${a.code} ${esc(STORE[a.code].name)} books ${money(a.ho - a.unit)} less than head office</span></div>`).join('')}
        ${table({
          cols: [{ l: 'Unit', k: 'u' }, { l: 'Piutang at HO', k: 'pc', w: 150 }, { l: 'HO says', k: 'h', num: 1, w: 160 }, { l: 'Hutang at unit', k: 'hc', w: 150 }, { l: 'Unit says', k: 'n', num: 1, w: 160 }, { l: 'Difference', k: 'd', num: 1, w: 140 }],
          rows: AFF.map(a => ({ on: "go('ledger','sub')", c: { u: placeName(a.code), pc: `<span class="mute">1021402${unit3(a.code)}00</span>`, h: money(a.ho), hc: `<span class="mute">2012302001${STORE[a.code].loc}</span>`, n: money(a.unit), d: a.ho - a.unit ? `<span class="bad">${signed(a.unit - a.ho)}</span>` : '<span class="mute">0</span>' } })),
          foot: { u: 'Affiliasi Atas Barang', h: money(sum(AFF, a => a.ho)), n: money(sum(AFF, a => a.unit)), d: signed(sum(AFF, a => a.unit - a.ho)) },
        })}`,
      foot: pr('the pairs', btn('Open Buku Besar Pembantu', "go('ledger','sub')")) }
  }
  if (k === 'tax') {
    const t = taxSum()
    const rows = [
      { group: 'PPN Keluaran' },
      { on: `S.day='${addDays(TODAY, -1)}';go('daily-close')`, c: { n: '<span class="nm">Penjualan 13 toko</span> <span class="mute">1–27 Oct</span>', a: '<span class="mute">201210100300</span>', b: money(t.dppK), x: money(t.kel) } },
      { group: 'PPN Masukan' },
      ...t.bills.map(b => ({ on: `finGoBill('${b.no}')`, c: { n: `<span class="nm">${b.no}</span> <span class="mute">${esc(SUP[b.sup].name)}</span>`, a: '<span class="mute">101130200400</span>', b: money(b.dpp), x: money(b.ppn) } })),
      ...t.tr.map(x => ({ on: `astPrj('${x.p.id}')`, c: { n: `<span class="nm">${x.bkk}</span> <span class="mute">${CON}</span>`, a: '<span class="mute">101130200400</span>', b: money(x.dpp), x: money(x.ppn) } })),
      { group: 'PPh 23 withheld' },
      ...t.tr.map(x => ({ on: `astPrj('${x.p.id}')`, c: { n: `<span class="nm">${x.bkk}</span> <span class="mute">${CON}</span>`, a: '<span class="mute">201210100200</span>', b: money(x.dpp), x: money(x.pph) } })),
    ]
    return { ...base, size: 'record', title: 'PPN and PPh 23 for Coretax', pill: ME.tax ? pill('Exported', 'ok') : pill('To export', 'warn'),
      body: `${kpisHTML([{ label: 'PPN Keluaran', value: money(t.kel) }, { label: 'PPN Masukan', value: money(t.mas) }, { label: 'PPN to pay', value: money(t.net) }, { label: 'PPh 23 withheld', value: money(t.pph) }])}
        ${table({ cols: [{ l: 'Line', k: 'n' }, { l: 'Account', k: 'a', w: 150 }, { l: 'DPP', k: 'b', num: 1, w: 170 }, { l: 'Tax', k: 'x', num: 1, w: 170 }], rows })}`,
      foot: pr('the tax lines', btn('Export Coretax XML', 'mendTax()')) }
  }
  if (k === 'points') {
    return { ...base, title: 'Member points liability', pill: pill('Booked nightly', 'ok'),
      body: table({
        cols: [{ l: 'Movement', k: 'n' }, { l: 'Points', k: 'p', num: 1, w: 150 }, { l: 'Amount', k: 'a', num: 1, w: 170 }],
        rows: POINTS.map(x => ({ c: { n: `<span class="nm">${x[0]}</span>`, p: num(x[1]), a: money(x[2]) } })),
        foot: { n: `Saldo ${dayS(addDays(TODAY, -1))} · 201230400100`, p: num(sum(POINTS, x => x[1])), a: money(sum(POINTS, x => x[2])) },
      }),
      foot: pr('the points', btn('Open journal', "go('journal')")) }
  }
}
const mendOpen = k => { const s = mendSheet(k); if (s) openSheet(s) }
const mendDone = (title, desc, k) => { hist('Month end', 'Added', desc); if (S.stack.length) refreshSheet(mendSheet(k)); render(); toast(title, desc) }
function mendAcc() { const ju = takeJU(), n = ME.acc.filter(x => !x).length; ME.acc = ME.acc.map(() => true); mendDone(`${plural(n, 'accrual')} booked`, `${ju} · Air PDAM and lembur Oktober`, 'acc') }
function mendPrepaid() { ME.prepaid = true; mendDone('Prepaid amortised', `${takeJU()} · Sewa toko C011 · ${money(15000000)}`, 'pre') }
function mendStock() { ME.stock = true; mendDone('Stock adjusted', `${takeJU()} · ${money(3482500)} to 8010110006`, 'stock') }
function mendGit() { ME.git = true; mendDone('Goods in transit confirmed', `${plural(GIT.length, 'surat jalan')} · ${money(sum(GIT, g => g.val))}`, 'git') }
function mendTax() { ME.tax = true; mendDone('Coretax XML exported', 'PPN and PPh 23 · October 2026', 'tax') }
function mendCharge() { astCharge(); refreshSheet(mendSheet('depr')) }
function mendLock() { ME.locked = true; const p = PER.find(x => x.y === '2026-10'); p.st = 'closed'; p.by = FIN; p.on = TODAY; hist('Month end', 'Edited', 'Closed October 2026'); render(); toast('October locked', 'Nothing more posts into October') }
function mendDec() { ME.dec = true; PER.push({ y: '2026-12', st: 'not', by: '', on: '' }); hist('Month end', 'Added', 'Period December 2026'); render(); toast('December 2026 created', '1 Dec – 31 Dec 2026') }
function mendPer(y) {
  const p = PER.find(x => x.y === y)
  openSheet({
    size: 'rail', crumb: ['Month end', 'Periods'], title: monL(y), pill: pill('Closed', ''),
    body: facts([['From', day(y + '-01')], ['To', day(lastDay(y))], ['Closed by', esc(p.by)], ['Closed on', day(p.on)]]),
    foot: `<div class="foot-left">${lnk('Print', "soon('Print the closing')", 'printer')}</div>`,
  })
}
function mendUndo(y) {
  openSheet({
    size: 'rail', crumb: ['Month end', 'Periods'], title: `Undo closing · ${monL(y)}`,
    body: `<div class="banner warn">${ico('alert')}<span>${monL(y)} opens again for posting and its closing journal is reversed</span></div>
      ${field('Reason', '<textarea id="mend-why" placeholder="Why it must open again"></textarea>', { req: 1 })}`,
    foot: btn('Undo closing', `mendUndoDo('${y}')`),
  })
}
function mendUndoDo(y) {
  const el = $('#mend-why'), why = (el && el.value || '').trim()
  if (!why) { el.style.borderColor = 'var(--bad-fg)'; el.focus(); toast('Say why first', 'The reason is kept in History', 'bad'); return }
  const p = PER.find(x => x.y === y); p.st = 'open'; p.by = ''; p.on = ''
  hist('Month end', 'Edited', `Undo closing ${monL(y)} · ${why}`)
  closeSheet(); render()
  toast(`${monL(y)} is open again`, 'The reason is kept in History')
}

Object.assign(window, {
  finGoBill: goBill, finGoGiro: goGiro,
  astOpen, astMove, astMoveDo, astPrj, astTr, astCap, astCharge, astDisp,
  mendOpen, mendAcc, mendPrepaid, mendStock, mendGit, mendTax, mendCharge, mendLock, mendDec, mendPer, mendUndo, mendUndoDo,
})
})()
