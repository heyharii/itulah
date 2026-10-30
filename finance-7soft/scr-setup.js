(() => {
/* ═════ shared bits ═════ */
const IN = 'style="width:100%;height:36px;padding:0 10px;border:1px solid var(--hairline-2);border-radius:var(--r-inner);background:var(--canvas);font:inherit;color:var(--ink)"'
const INR = 'style="width:100%;height:36px;padding:0 10px;border:1px solid var(--hairline-2);border-radius:var(--r-inner);background:var(--canvas);font:inherit;color:var(--ink);text-align:right;font-variant-numeric:tabular-nums"'
const one = h => `<span class="one">${h}</span>`
const st = (t, tone = 'neutral') => `<span class="ds-status ds-status--${tone}">${t}</span>`
const sw = (on, fn, label = '') => `<button class="ds-switch ${on ? 'is-on' : ''}" type="button" role="switch" aria-checked="${on}" aria-label="${esc(label)}" onclick="event.stopPropagation();${fn}"></button>`
const cb = (on, fn = '', ro = false) => `<input type="checkbox" class="cb7" ${on ? 'checked' : ''} ${ro ? 'disabled' : ''} onclick="event.stopPropagation()" ${fn ? `onchange="${fn}"` : ''}>`
const sel = (opts, cur, on = '', extra = '') => `<select ${IN} ${extra} onchange="${on}">${opts.map(o => { const [v, l] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(v)}" ${String(v) === String(cur) ? 'selected' : ''}>${esc(l)}</option>` }).join('')}</select>`
const sm = (label, on) => btn(label, on, 'primary', 'ds-btn--sm cell')
const gv = id => { const e = document.getElementById(id); return e ? e.value : '' }
const pad = (n, l) => String(n).padStart(l, '0')
const sums = (xs, f) => xs.reduce((a, x) => a + f(x), 0)
const checkRow = (on, label, fn = '') => `<label class="ds-check" style="gap:10px">${cb(on, fn)}<span>${label}</span></label>`
const saveFoot = btn('Save', "closeSheet();toast('Saved','Prototype: nothing is saved')")

/* ═════ the chart, as a tree ═════
   groups (1 digit) → 3 → 5 → 7 digits are headers; 10-digit accounts (and three 6-digit ones) hold the postings. */
const GRPN = { 1: 'Asset', 2: 'Liabilities', 3: 'Modal', 4: 'Pendapatan', 5: 'Biaya pokok', 6: 'Biaya usaha', 7: 'Beban lain', 8: 'Non operasional' }
const added = [
  { c: '1011302007', n: 'Prepaid - PPh Pasal 22', type: 'Biaya dibayar dimuka', created: false },
  { c: '6010310025', n: 'Biaya Parkir & Tol', type: 'Biaya', created: false },
  { c: '1011101003', n: 'Piutang Dagang - Customer', type: 'Piutang', created: true },
  { c: '6010310001', n: 'Pembelian Jasa', type: 'Biaya', created: true },
  { c: '4010110001', n: 'Penjualan Jasa', type: 'Pendapatan', created: true },
]
const INACT = new Set(['1011002005', '1011004004', '8020111002'])
const TYPE_RULES = [['1011001', 'Kas/Bank'], ['1011002', 'Kas/Bank'], ['1011003', 'Kas/Bank'], ['1011004', 'Deposito'], ['10111', 'Piutang'], ['10112', 'Persediaan'], ['10113', 'Biaya dibayar dimuka'], ['10214', 'Piutang'], ['10215', 'Aktiva tetap'], ['10216', 'Akumulasi penyusutan'], ['10217', 'Aktiva tak berwujud'], ['103', 'Aktiva lain'], ['1', 'Aktiva'], ['2012001', 'Hutang'], ['2012002', 'Hutang'], ['20121', 'Hutang pajak'], ['20122', 'Biaya masih harus dibayar'], ['20123', 'Hutang'], ['20125', 'Pinjaman'], ['202', 'Pinjaman'], ['2', 'Hutang'], ['3', 'Modal'], ['4', 'Pendapatan'], ['5', 'HPP'], ['6', 'Biaya'], ['7', 'Biaya'], ['8', 'Lain-lain']].sort((a, b) => b[0].length - a[0].length)
const TYPES = ['Kas/Bank', 'Deposito', 'Piutang', 'Persediaan', 'Biaya dibayar dimuka', 'Aktiva tetap', 'Akumulasi penyusutan', 'Aktiva tak berwujud', 'Aktiva lain', 'Hutang', 'Hutang pajak', 'Biaya masih harus dibayar', 'Pinjaman', 'Modal', 'Pendapatan', 'HPP', 'Biaya', 'Lain-lain', 'AKTIVA LANCAR', 'AKTIVA TETAP', 'AKTIVA TAK BERWUJUD', 'AKTIVA LAIN - LAIN', 'INVESTASI JANGKA PANJANG']
const CREDIT_TYPES = ['Hutang', 'Hutang pajak', 'Biaya masih harus dibayar', 'Pinjaman', 'Modal', 'Pendapatan', 'Akumulasi penyusutan']
const typeOf = c => {
  const a = added.find(x => x.c === c); if (a) return a.type
  if (c === '600104') return 'Lain-lain'
  return (TYPE_RULES.find(([p]) => c.startsWith(p)) || [0, 'Aktiva'])[1]
}
const isLeaf = c => c.length === 10 || c.length === 6
const isActive = c => !INACT.has(c)
let _b = null
function build() {
  const rows = COA.concat(added.map(a => [a.c, a.n]))
  if (_b && _b.n === rows.length) return _b
  const exist = new Set(rows.map(r => r[0])), name = {}, kids = {}
  rows.forEach(([c, n]) => { name[c] = n })
  const par = c => { for (const l of [7, 5, 3, 1]) if (l < c.length && exist.has(c.slice(0, l))) return c.slice(0, l); return null }
  rows.forEach(([c]) => { const p = par(c); if (p) (kids[p] = kids[p] || []).push(c) })
  Object.keys(kids).forEach(p => kids[p].sort())
  return (_b = { n: rows.length, exist, name, kids, par })
}
const nm = c => build().name[c] || COA_NAME[c] || c
const known = c => build().exist.has(c)
const leaves = () => COA.concat(added.map(a => [a.c, a.n])).map(r => r[0]).filter(isLeaf)
const CM = { open: new Set(COA.map(r => r[0]).filter(c => c.length <= 3)), loc: new Set() }
window.coaTog = c => { CM.open.has(c) ? CM.open.delete(c) : CM.open.add(c); render() }
window.locTog = c => { CM.loc.has(c) ? CM.loc.delete(c) : CM.loc.add(c); render() }
const locGrid = c => `<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:8px 16px;padding:4px 0 4px ${c.length === 10 ? 40 : 0}px;font-weight:400">${LOCS.map(([l]) => `<span><span style="font-variant-numeric:tabular-nums;color:var(--ink)">${acc12(c, l)}</span> <span class="mute">${l}</span></span>`).join('')}</div>`

function treeRows(q, grp) {
  const B = build(), out = []
  const mk = (c, d) => {
    const leaf = isLeaf(c), hasKids = !!B.kids[c], o = CM.open.has(c)
    const lead = hasKids ? `<span style="display:inline-block;width:22px;vertical-align:middle;color:var(--line-ico)">${ico(o ? 'chevron-down' : 'chevron-right')}</span>` : `<span style="display:inline-block;width:22px"></span>`
    const w = c.length === 1 ? 600 : leaf ? 400 : 500
    const r = { c: { code: `<span class="${leaf ? '' : 'mute'}">${c}</span>`, name: `<span class="one" style="padding-left:${d * 22}px;font-weight:${w}">${lead}${esc(B.name[c])}</span>` } }
    if (leaf) {
      const w2 = added.find(a => a.c === c)
      r.c.type = esc(typeOf(c))
      r.c.loc = c.length === 10 ? `<span style="display:inline-flex;align-items:center;gap:4px;color:var(--accent);font-weight:500;cursor:pointer" onclick="event.stopPropagation();locTog('${c}')">${LOCS.length} locations ${ico(CM.loc.has(c) ? 'chevron-down' : 'chevron-right')}</span>` : '<span class="mute">One account</span>'
      r.c.act = w2 && !w2.created ? st('Waiting', 'warn') : isActive(c) ? 'Yes' : '<span class="mute">No</span>'
      r.on = `openAcc('${c}')`
    } else r.on = `coaTog('${c}')`
    return r
  }
  if (q) {
    leaves().concat(Object.keys(B.kids).filter(c => c.length === 7)).filter(c => (!grp || c[0] === grp) && hit(q, c, B.name[c])).sort().slice(0, 120).forEach(c => out.push(mk(c, 0)))
    return out
  }
  const walk = (c, d) => { out.push(mk(c, d)); if (CM.open.has(c) && B.kids[c]) B.kids[c].forEach(k => walk(k, d + 1)); if (CM.loc.has(c)) out.push({ group: locGrid(c) }) }
  Object.keys(GRPN).filter(g => !grp || g === grp).forEach(g => walk(g, 0))
  return out
}


reg({
  id: 'coa-master', group: 'master', label: 'Chart of accounts',
  render() {
    const grp = filt('coa-master', 'g', ''), q = S.q['coa-master'] || ''
    const L = leaves(), n10 = L.filter(c => c.length === 10).length
    const cnt = g => L.filter(c => c[0] === g).length
    const rows = treeRows(q, grp)
    const body = `${bar(search('coa-master', 'Search code or name'))}
      <div style="margin-bottom:12px">${chips('coa-master', 'g', [['', 'All groups', L.length]].concat(Object.keys(GRPN).map(g => [g, `${g} ${GRPN[g]}`, cnt(g)])), '')}</div>
      ${table({ tbl: 'coa', cols: [{ l: 'Code', k: 'code', w: 130 }, { l: 'Name', k: 'name' }, { l: 'Type', k: 'type', w: 190 }, { l: 'Locations', k: 'loc', w: 160 }, { l: 'Active', k: 'act', w: 90 }], rows, empty: 'No account matches' })}`
    return page({
      title: 'Chart of accounts', actions: [{ label: 'New account', on: 'newAcc()', icon: 'plus' }, { label: 'Create COA', on: 'createCoa()' }],
      kpis: [{ label: 'Accounts', value: num(L.length) }, { label: 'Accounts per location', value: num(n10 * LOCS.length) }, { label: 'Kas/Bank accounts', value: num(L.filter(c => typeOf(c) === 'Kas/Bank').length) }, { label: 'Waiting for Create COA', value: num(added.filter(a => !a.created).length) }],
      body
    })
  }
})

window.openAcc = c => {
  const B = build(), p = B.par(c), a = added.find(x => x.c === c), t = typeOf(c), ia = isActive(c)
  const locs = c.length === 10 ? table({ cols: [{ l: 'Unit', k: 'u' }, { l: 'Account', k: 'a', w: 180 }, { l: 'Active', k: 'x', w: 90 }], rows: LOCS.map(([l, n]) => ({ c: { u: `${esc(n)} <span class="mute">${l}</span>`, a: acc12(c, l), x: 'Yes' } })) }) : ''
  openSheet({
    crumb: ['Chart of accounts', GRPN[c[0]]], title: esc(B.name[c]), pill: a && !a.created ? st('Waiting for Create COA', 'warn') : '',
    body: `<div class="form-grid">
      ${field('Code', input(c, true))}${field('Name', input(B.name[c]), 'span2')}${field('Active', sel([['Y', 'Yes'], ['N', 'No']], ia ? 'Y' : 'N', '', 'id="ac-active"'))}
      ${field('Type', sel(TYPES, t, '', 'id="ac-type"'), 'span2')}${field('Parent', input(p ? `${p} · ${B.name[p]}` : '', true), 'span2')}
    </div>
    <div style="display:flex;flex-direction:column;gap:12px;margin-bottom:32px">
      <label class="ds-check" style="gap:10px">${cb(t === 'Kas/Bank', '', true)}<span>Kas/Bank — a choice in BKM and BKK</span></label>
      <label class="ds-check" style="gap:10px">${cb(t === 'Aktiva tak berwujud', '', true)}<span>Intangible</span></label>
    </div>
    ${locs ? section('Locations', locs) : ''}
    <div class="mute" style="margin-top:16px">${(() => { const h = HIST.find(x => x.doc.includes(c)); return h ? `Last changed ${day(h.d)} ${h.t} by ${h.u}` : 'No change since opening' })()}</div>`,
    foot: btn('Save', `saveAcc('${c}')`) + btn('Delete', `delAcc('${c}')`)
  })
}
window.delAcc = c => { const i = added.findIndex(a => a.c === c && !a.created); if (i < 0) { toast('Not deleted', 'This account has postings or location accounts'); return } added.splice(i, 1); closeSheet(); toast('Account deleted', `${c} removed before Create COA`); render() }
window.saveAcc = c => { gv('ac-active') === 'N' ? INACT.add(c) : INACT.delete(c); closeSheet(); toast('Account saved', `${c} · ${nm(c)}`); render() }

let NEWPRE = null
function nextCode(parent) {
  const ks = (build().kids[parent] || []).filter(c => c.length === 10 && !c.endsWith('99'))
  return ks.length ? String(Math.max(...ks.map(Number)) + 1) : parent + '001'
}
window.nextCodeOf = nextCode
window.newAcc = pre => {
  NEWPRE = pre || null
  const B = build(), heads = Object.keys(B.kids).filter(c => c.length === 7)
  const par = pre ? pre.parent : '1011302'
  openSheet({
    crumb: ['Chart of accounts'], title: 'New account',
    body: `<div class="form-grid">
      ${field('Parent', sel(heads.map(c => [c, `${c} · ${B.name[c]}`]), par, 'document.getElementById(\'na-code\').value=nextCodeOf(this.value)', 'id="na-parent"'), 'span2')}
      ${field('Code', `<input ${IN} id="na-code" value="${nextCode(par)}">`)}${field('Type', sel(TYPES, pre ? pre.type : typeOf(par + '001'), '', 'id="na-type"'))}
      ${field('Active', sel([['Y', 'Yes'], ['N', 'No']], 'Y', '', 'id="na-active"'))}
      ${field('Name', `<input ${IN} id="na-name" value="${esc(pre ? pre.name : '')}" placeholder="Account name">`, 'span4')}
    </div>`,
    foot: btn('Save account', 'saveNew()')
  })
}
window.saveNew = () => {
  const c = gv('na-code'), n = gv('na-name') || 'New account', t = gv('na-type') || 'Biaya'
  if (!known(c)) added.push({ c, n, type: t, created: false })
  if (gv('na-active') === 'N') INACT.add(c)
  if (NEWPRE && NEWPRE.slot != null) LINKS[NEWPRE.slot].acc = c
  NEWPRE = null; closeSheet(); toast('Account saved', `${c} · ${n} waits for Create COA`); render()
}
window.createCoa = () => {
  const w = added.filter(a => !a.created)
  openSheet({
    crumb: ['Chart of accounts'], title: 'Create COA',
    body: `${table({ cols: [{ l: 'Account', k: 'a', w: 150 }, { l: 'Name', k: 'n' }, { l: 'Type', k: 't', w: 200 }, { l: 'Location accounts', k: 'l', num: true, w: 160 }], rows: w.map(a => ({ c: { a: a.c, n: esc(a.n), t: esc(a.type), l: num(LOCS.length) } })), empty: 'No new account is waiting', foot: w.length ? { a: 'Total', l: num(w.length * LOCS.length) } : null })}`,
    foot: w.length ? btn('Create COA', 'doCreateCoa()') : ''
  })
}
window.doCreateCoa = () => { const n = added.filter(a => !a.created).length; added.forEach(a => { a.created = true }); closeSheet(); toast('COA created', `${num(n * LOCS.length)} location accounts opened. Next: Create new saldo`); render() }

/* ═════ the parties' opening documents (shared with the tie-out) ═════ */
const CUST = [
  { code: 'M89', name: 'Agung Jaya Sentosa', term: 'T30', grace: 7, limit: 500000000, owing: 37763250, tier: 'Wholesale', sales: 'Dewi', npwp: '01.234.567.8-051.000', also: false },
  { code: 'C17', name: 'Citra Terang Sinar Mulyo', term: 'T14', grace: 3, limit: 100000000, owing: 442850, tier: 'Reseller', sales: 'Rudi', npwp: '02.345.678.9-052.000', also: false },
  { code: 'G03', name: 'Gunawan, Bpk Indah', term: 'T7', grace: 0, limit: 20000000, owing: 34250, tier: 'Retail', sales: 'Dewi', npwp: '', also: false },
  { code: 'C-0212', name: 'Toko Maju Jaya', term: 'T30', grace: 5, limit: 150000000, owing: 5825000, tier: 'Reseller', sales: 'Rudi', npwp: '03.456.789.0-053.000', also: true },
]
const SUPP = [
  { code: 'S-0102', name: 'Garmen Mitra Sentosa, PT', term: 'T30', grace: 0, limit: 500000000, owing: 51014500, npwp: '05.678.901.2-055.000', also: false },
  { code: 'S-0045', name: 'Sumber Komputer', term: 'T14', grace: 0, limit: 100000000, owing: 8374200, npwp: '06.789.012.3-056.000', also: false },
  { code: 'S-0131', name: 'CV Anugrah Textile', term: 'T30', grace: 0, limit: 250000000, owing: 12450000, npwp: '07.890.123.4-057.000', also: true },
  { code: 'S-0208', name: 'PT Graha Clean', term: 'T7', grace: 0, limit: 50000000, owing: 4200000, npwp: '08.901.234.5-058.000', also: false },
  { code: 'S-0077', name: 'Sepatu Sejahtera, CV', term: 'T30', grace: 0, limit: 200000000, owing: 76350000, npwp: '09.012.345.6-059.000', also: false },
]
const recvTotal = () => sums(CUST, c => c.owing)
const payTotal = () => sums(SUPP, s => s.owing)
/* the per-invoice lines of a party always add up to what the party owes */
function invoicesOf(p, kind) {
  if (!p.owing) return []
  const pre = kind === 'c' ? 'PJL' : 'PB', k = +String(p.code).replace(/\D/g, '') || 7
  const n = p.owing > 20000000 ? 3 : p.owing > 1000000 ? 2 : 1, out = []
  let left = p.owing
  for (let i = 0; i < n; i++) {
    const v = i === n - 1 ? left : Math.round(p.owing * (i === 0 ? 0.5 : 0.3) / 50) * 50
    left -= v
    const m = 8 - i, d = 4 + ((k + i * 7) % 22), dd = `2026-${pad(m, 2)}-${pad(d, 2)}`
    const days = { T7: 7, T14: 14, T30: 30, T45: 45, CASH: 0 }[p.term]
    const due = new Date(Date.parse(dd) + days * 864e5).toISOString().slice(0, 10)
    out.push({ no: `${pre}-26-${pad(m, 2)}-${pad(100 + k * 3 + i, 5)}`, date: dd, due, total: v })
  }
  return out
}

/* ═════ the account links, first: the opening balances need the receivable account ═════ */
const LINKS = [
  { k: 'Default Kas Kecil', use: 'Default cash account in BKM, BKK', acc: '1011001002', by: 'BKM · BKK' },
  { k: 'Disc Pembelian', use: 'Purchase discount on goods items', acc: '8010110003', by: 'Item master · Purchase invoice' },
  { k: 'Disc Penjualan', use: 'Sales discount on goods items', acc: '4010213001', by: 'Item master · Sales invoice' },
  { k: 'HPP', use: 'Cost of goods on items', acc: '5010110001', by: 'Item master · Delivery' },
  { k: 'Hutang', use: 'Payable of a new supplier', acc: '2012001001', by: 'Supplier master · Purchase invoice' },
  { k: 'Hutang Suspend', use: 'Goods received, not yet invoiced', acc: '2012001002', by: 'Goods receipt' },
  { k: 'Laba', use: 'Current profit on balance sheet', acc: '3013001003', by: 'Balance sheet · Closing' },
  { k: 'Laba Ditahan', use: 'Retained earnings on balance sheet', acc: '3013001002', by: 'Balance sheet · Closing' },
  { k: 'Pembelian Jasa', use: 'Purchase account of service items', acc: '6010310001', by: 'Item master · Purchase invoice' },
  { k: 'Penjualan', use: 'Sales account of goods items', acc: '4010110001', by: 'Item master · Sales invoice' },
  { k: 'Penjualan Jasa', use: 'Sales account of service items', acc: '4010110001', by: 'Item master · Sales invoice' },
  { k: 'Persediaan Barang', use: 'Stock account of goods items', acc: '1011201001', by: 'Item master · Receipt' },
  { k: 'Piutang', use: 'Receivable of a new customer', acc: '1011101003', by: 'Customer master · Sales invoice' },
  { k: 'Potongan Hutang', use: 'Potongan column in BKK', acc: '8010110003', by: 'BKK' },
  { k: 'Potongan Piutang', use: 'Potongan column in BKM', acc: '4010213001', by: 'BKM' },
  { k: 'PPN Pembelian', use: 'VAT on purchases', acc: '1011302004', by: 'Purchase invoice' },
  { k: 'PPN Penjualan', use: 'VAT on sales', acc: '2012101003', by: 'Sales invoice' },
  { k: 'Retur Pembelian', use: 'Purchase returns of goods items', acc: '1011201001', by: 'Item master · Purchase return' },
  { k: 'Retur Penjualan', use: 'Sales returns of goods items', acc: '4010214001', by: 'Item master · Sales return' },
  { k: 'Stok Adjustment', use: 'Default in Stock adjustment', acc: '6010110008', by: 'Stock adjustment' },
  { k: 'Stok Opname', use: 'Default in Stock opname', acc: '8010110006', by: 'Stock opname' },
  { k: 'Uang Muka Pembelian', use: 'Down payment items, purchases', acc: '1011303002', by: 'Item master · Purchase invoice' },
  { k: 'Uang Muka Penjualan', use: 'Down payment items, sales', acc: '205001', by: 'Item master · Sales invoice' },
]
const linkOf = k => LINKS.find(l => l.k === k)
const accTxt = c => c ? `${c} · ${esc(nm(c))}` : ''

/* ═════ opening balances ═════ */
const OB = { fromStart: true, locked: false, month: 'Oct 2026', rows: [] }
const STOCK_GAP = 0, STOCK_BOOK = 1184320000, STOCK_DET = STOCK_BOOK - STOCK_GAP
const recvCode = () => linkOf('Piutang').acc || '1011101003'
function obSeed() {
  const R = (a, v, side) => OB.rows.push({ a: a + '00', v: side === 'd' ? v : -v, side })
  R('1011001001', 18400000, 'd'); R('1011001002', 3250000, 'd'); R('1011001003', 1500000, 'd')
  R('1011002001', 1284750400, 'd'); R('1011002002', 412300000, 'd'); R('1011003001', 96500000, 'd')
  R('RECV', recvTotal(), 'd')
  R('1011201001', STOCK_BOOK, 'd')
  R('1011301003', 96000000, 'd'); R('1011302004', 14260000, 'd')
  R('1021502001', 850000000, 'd'); R('1021505001', 320000000, 'd'); R('1021506003', 185000000, 'd'); R('1021507001', 142500000, 'd'); R('1021701001', 60000000, 'd')
  R('1021602001', 212500000, 'c'); R('1021605001', 80000000, 'c'); R('1021606003', 92500000, 'c'); R('1021607001', 35625000, 'c'); R('1021702001', 30000000, 'c')
  R('2012001001', payTotal(), 'c'); R('2012101001', 3640000, 'c'); R('2012101003', 18420000, 'c'); R('2012201001', 42000000, 'c')
  R('3013001002', 250000000, 'c'); R('3013001001', 0, 'c')
  obPlug()
  /* every postable account is in the 7Soft grid; the ones without an opening balance sit at zero */
  const have = new Set(OB.rows.map(r => rowCode(r)))
  leaves().forEach(c => {
    if (have.has(c)) return
    have.add(c)
    OB.rows.push({ a: c + '00', v: 0, side: CREDIT_TYPES.includes(typeOf(c)) ? 'c' : 'd' })
  })
  OB.rows.sort((a, b) => rowCode(a).localeCompare(rowCode(b)))
}
function obPlug() { const m = OB.rows.find(r => r.a === '301300100100'); m.v = 0; m.v = -sums(OB.rows, r => r.v) }
const obTotal = () => sums(OB.rows, r => r.v)
const rowCode = r => r.a === 'RECV00' ? recvCode() : r.a.slice(0, -2)
const stockRow = () => OB.rows.find(r => r.a === '101120100100')
const ties = () => [
  { k: 'Receivables', acc: OB.rows.find(r => r.a === 'RECV00').v, det: recvTotal(), go: "S.tab.parties='customers';go('parties')" },
  { k: 'Payables', acc: -OB.rows.find(r => r.a === '201200100100').v, det: payTotal(), go: "S.tab.parties='suppliers';go('parties')" },
  { k: 'Stock', acc: stockRow().v, det: STOCK_DET, go: "soon('Item opening balances')" },
]
window.obSet = (i, val) => { if (OB.locked) return; const r = OB.rows[i], n = parseInt(String(val).replace(/[^\d]/g, '') || '0', 10); r.v = r.side === 'd' ? n : -n; render() }
window.obFromStart = () => { OB.fromStart = !OB.fromStart; CFG.startbeg = OB.fromStart; if (OB.fromStart) OB.month = 'Oct 2026'; toast('Start from the beginning', OB.fromStart ? 'Yes' : 'No'); render() }
window.obMonth = v => { OB.month = v; toast('Balances month', v); render() }
window.obMatchStock = () => { const r = stockRow(), was = r.v; r.v = STOCK_DET; obPlug(); closeSheet(); toast('Stock matches the items', `Modal Setor moved by ${money(was - STOCK_DET)} to keep the total at zero`); render() }
window.createNewSaldo = () => {
  const mk = added.filter(a => a.created && !OB.rows.some(r => r.a === a.c + '00'))
  mk.forEach(a => OB.rows.splice(OB.rows.length - 2, 0, { a: a.c + '00', v: 0, side: CREDIT_TYPES.includes(typeOf(a.c)) ? 'c' : 'd' }))
  toast('Create new saldo', mk.length ? `${plural(mk.length, 'new account')} added to the grid` : 'No new account to add'); render()
}
window.obPost = () => {
  const bad = ties().filter(t => t.acc !== t.det), tot = obTotal(), blocked = bad.length || tot !== 0
  const res = d => d === 0 ? st('Tie', 'ok') : `<span class="late">Difference ${money(d)}</span>`
  const checks = table({ cols: [{ l: 'Check', k: 'a' }, { l: 'In the accounts', k: 'b', num: true, w: 170 }, { l: 'In the details', k: 'c', num: true, w: 170 }, { l: 'Result', k: 'r', w: 190 }],
    rows: [{ c: { a: 'Total of the grid', b: money(tot), c: money(0), r: res(tot) } }].concat(ties().map(t => ({ c: { a: t.k, b: money(t.acc), c: money(t.det), r: res(t.acc - t.det) } }))) })
  openSheet({
    crumb: ['Opening balances', OB.month], title: blocked ? 'Not ready to lock' : `Lock ${OB.month}`, body: checks,
    foot: blocked ? (bad.some(t => t.k === 'Stock') ? btn('Match stock to the items', 'obMatchStock()') : '') : btn('Lock opening balances', 'obLock()')
  })
}
window.obLock = () => { OB.locked = true; closeSheet(); toast('Opening balances locked', `${OB.month} · locked until that period closes`); render() }

reg({
  id: 'coa-opening', group: 'master', label: 'Opening balances',
  render() {
    if (!OB.rows.length) obSeed()
    const tot = obTotal(), dr = sums(OB.rows, r => r.v > 0 ? r.v : 0), cr = sums(OB.rows, r => r.v < 0 ? -r.v : 0)
    const toggle = `<div class="card7" style="margin-bottom:24px;display:flex;align-items:center;gap:24px;flex-wrap:wrap">
      <div style="display:flex;align-items:center;gap:12px">${sw(OB.fromStart, 'obFromStart()', 'Start from the beginning')}<span style="font-weight:500">Start from the beginning <span class="mute" style="font-weight:400">· ${OB.fromStart ? 'Yes' : 'No'}</span></span></div>
      <span style="flex:1"></span>
      <span>${OB.locked ? st('Closed', 'neutral') : st('Open', 'ok')}</span><div style="width:200px">${field('Balances month', sel(['Oct 2026', 'Nov 2026', 'Dec 2026'], OB.month, 'obMonth(this.value)', OB.fromStart || OB.locked ? 'disabled' : ''))}</div></div>`
    const oq = S.q['coa-opening'] || '', og = filt('coa-opening', 'g', '')
    const rows = OB.rows.map((r, i) => {
      const c = rowCode(r), miss = r.a === 'RECV00' && !known(c)
      const ed = side => r.side !== side ? '' : OB.locked ? (r.v ? money(Math.abs(r.v)) : '') : `<input ${INR} value="${r.v ? num(Math.abs(r.v)) : ''}" placeholder="0" onchange="obSet(${i},this.value)">`
      const lbl = miss ? `${c} · Piutang Dagang - Customer ${st('Missing in the chart', 'warn')}` : `${c} · ${esc(nm(c))} <span class="mute">${LOCS[+r.a.slice(-2)][0]}</span>`
      return { q: hit(oq, c, nm(c), LOCS[+r.a.slice(-2)][0]) && (!og || c[0] === og), c: { a: one(lbl), d: ed('d'), c: ed('c'), b: money(r.v) } }
    }).filter(r => r.q)
    const T = ties(), res = t => t.acc === t.det ? st('Tie', 'ok') : `<span class="late">Difference ${money(t.acc - t.det)}</span>`
    const body = `${toggle}${bar(search('coa-opening', 'Search account code or name'), chips('coa-opening', 'g', [['', 'All groups', OB.rows.length]].concat(Object.keys(GRPN).map(g => [g, `${g} ${GRPN[g]}`, OB.rows.filter(r => rowCode(r)[0] === g).length])), ''))}${table({ cols: [{ l: 'Account', k: 'a' }, { l: 'Debit', k: 'd', num: true, w: 190 }, { l: 'Credit', k: 'c', num: true, w: 190 }, { l: 'Balance', k: 'b', num: true, w: 170 }], rows,
      foot: { a: 'Total · must be zero', d: money(dr), c: money(cr), b: tot === 0 ? money(0) : `<span class="late">${money(tot)}</span>` } })}
      <div style="height:24px"></div>
      ${section('Sub-ledger tie-out', table({ cols: [{ l: 'Sub-ledger', k: 'k', w: 200 }, { l: 'In the accounts', k: 'a', num: true }, { l: 'Sum of the details', k: 'd', num: true }, { l: 'Result', k: 'r', w: 230 }], rows: T.map(t => ({ on: t.go, c: { k: t.k, a: money(t.acc), d: money(t.det), r: res(t) } })) }))}`
    return page({
      title: 'Opening balances', actions: OB.locked ? [] : [{ label: 'Refresh', on: "toast('Refreshed','Opening balances reloaded');render()" }, { label: 'Create new saldo', on: 'createNewSaldo()' }, { label: 'Post and lock', on: 'obPost()' }],
      kpis: [{ label: 'Total debit', value: money(dr) }, { label: 'Total credit', value: money(cr) }, { label: 'Out of balance', value: money(tot), bad: tot !== 0 }, { label: 'Status', value: OB.locked ? `Locked · ${OB.month}` : `Open · ${OB.month}` }],
      body
    })
  }
})

/* ═════ account links ═════ */
window.setLink = (i, v) => {
  const c = String(v).split(' · ')[0].trim()
  if (isLeaf(c) && known(c)) { LINKS[i].acc = c; toast(`${LINKS[i].k} now posts to`, `${c} · ${nm(c)}`) }
  render()
}
window.makeLink = i => { const s = LINKS[i].sug; newAcc({ parent: s.parent, type: s.type, name: s.name, slot: i }) }
const ITEM_ROWS = [
  ['Penjualan', 'Penjualan', 'Penjualan Jasa', 'Uang Muka Penjualan'],
  ['Persediaan', 'Persediaan Barang', null, null],
  ['Disc Penjualan', 'Disc Penjualan', 'Disc Penjualan', null],
  ['HPP', 'HPP', null, null],
  ['Ret Penjualan', 'Retur Penjualan', 'Retur Penjualan', null],
  ['Ret Pembelian', 'Retur Pembelian', null, null],
  ['Hutang Suspend', 'Hutang Suspend', null, null],
]
const itemCell = k => { if (!k) return '<span class="mute">—</span>'; const l = linkOf(k), a = l.acc; return a ? `<input ${IN} list="coa-dl" value="${esc(a + ' · ' + nm(a))}" onchange="setLink(${LINKS.indexOf(l)},this.value)" onfocus="this.select()">` : st('Missing', 'warn') }

reg({
  id: 'coa-links', group: 'master', label: 'Account links',
  render() {
    const tab = tabOf('coa-links', 'v', 'settings'), q = S.q['coa-links'] || '', f = filt('coa-links', 'f', 'all')
    const miss = LINKS.filter(l => !l.acc).length
    const list = LINKS.map((l, i) => ({ l, i })).filter(({ l }) => (f === 'all' || (f === 'missing' ? !l.acc : !!l.acc)) && hit(q, l.k, l.use, l.acc, l.acc && nm(l.acc), l.by))
    const rows = list.map(({ l, i }) => ({
      c: {
        k: `<span class="nm">${l.k}</span>`, u: one(l.use),
        a: l.acc ? `<input ${IN} list="coa-dl" value="${esc(l.acc + ' · ' + nm(l.acc))}" onchange="setLink(${i},this.value)" onfocus="this.select()">` : `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px">${st('Missing in the chart', 'warn')}${sm('Create account', `makeLink(${i})`)}</div>`,
        b: one(l.by)
      }
    }))
    const itemTbl = table({ cols: [{ l: 'Account of the item', k: 'r', w: 190 }, { l: 'Goods', k: 'g' }, { l: 'Service', k: 's' }, { l: 'Down payment', k: 'd' }], rows: ITEM_ROWS.map(([r, g, s, d]) => ({ c: { r, g: itemCell(g), s: itemCell(s), d: itemCell(d) } })) })
    const settings = `<datalist id="coa-dl">${leaves().map(c => `<option value="${esc(c + ' · ' + nm(c))}"></option>`).join('')}</datalist>
      ${bar(search('coa-links', 'Search slot or account'), chips('coa-links', 'f', [['all', 'All slots', LINKS.length], ['missing', 'Missing', miss], ['linked', 'Linked', LINKS.length - miss]], 'all'))}
      ${table({ tbl: 'lnk', cols: [{ l: 'Slot', k: 'k', w: 190 }, { l: 'What it is used for', k: 'u', w: 250 }, { l: 'Account', k: 'a' }, { l: 'Used by', k: 'b', w: 230 }], rows, empty: 'No slot matches' })}`
    const items = `<div class="ds-bar">${btn('Set as default', "toast('Item accounts','Saved as the default for new items')")}${btn('Sync accounts', "toast('Accounts synced','Posted documents moved from the old accounts to the new ones')")}</div>${itemTbl}`
    return page({ title: 'Account links', tabs: [['settings', 'Settings', LINKS.length], ['items', 'Item accounts', ITEM_ROWS.length]], tab,
      actions: [{ label: 'Refresh', on: 'render()', icon: 'undo' }],
      kpis: [{ label: 'Slots', value: LINKS.length }, { label: 'Linked', value: LINKS.length - miss }, { label: 'Missing in the chart', value: miss }, { label: 'Item accounts', value: ITEM_ROWS.length }],
      body: tab === 'items' ? items : settings })
  }
})

/* ═════ accounting settings ═════ */
const FOUR = [['yes', 'Yes'], ['warn', 'Yes with warning'], ['prompt', 'Yes with prompt'], ['no', 'No']]
const PRICE_SO = FOUR.concat([['notbelow', 'Not below price list'], ['belowwarn', 'Below price list with warning'], ['belowprompt', 'Below price list with prompt']])
const PRICE_INV = PRICE_SO.concat([['hppnot', 'Not below HPP'], ['hppwarn', 'Below HPP with warning'], ['hppprompt', 'Below HPP with prompt']])
const NUM_MODES = [['mauto', 'Monthly, automatic'], ['mman', 'Monthly, manual'], ['yauto', 'Yearly, automatic'], ['yman', 'Yearly, manual']]
const CFG = {
  numbering: 'mauto', bkdate: 'today', cost: 'avg', negstock: 'warn', negdate: 'warn', ordlimit: 'warn', invlimit: 'prompt', overpo: 'no', overso: 'no',
  addgr: true, adddn: true, addinv: false, pricepl: 'warn', priceinv: 'hppwarn', disc: 'warn', ppn: 'round', dcash: '0', dbar: '0', hpp: 'admin',
  edition: 'Standard', giro: true, cashform: true, barform: true, print: 'auto', lines: '12', startbeg: true,
  pre: { KM: 'KM', KK: 'KK', GL: 'GL', PJL: 'PJL', PO: 'PO', BD: 'BD', SJ: 'SJ', ADJ: 'ADJ', ADJN: 'ADJN', PAG: 'PAG', PR: 'PR', STK: 'STK' },
  start: '2026-10-01', histdel: false, decimals: '2', maxprint: '1', purflow: 'p1', salflow: 's1',
  co: { name: 'Central Fashion Store', logo: 'central-logo.png', addr: '00001', npwp: '01.234.567.8-051.000', seri: '010.000-26', pkp: '01.234.567.8-051.000', pkpdate: '2019-03-01' },
}
const PUR_FLOWS = [['p1', 'PO - receipt - invoice; return goods - return invoice; many receipts, one invoice'], ['p2', 'PO - receipt - invoice; return invoice; many receipts, one invoice'], ['p3', 'PO - invoice; return invoice'], ['p4', 'PO - receipt - invoice; return goods - return invoice; one receipt, one invoice'], ['p5', 'PO - receipt - invoice; return invoice; one receipt, one invoice']]
const SAL_FLOWS = [['s1', 'SO - delivery - invoice; return goods - return invoice; many deliveries, one invoice'], ['s2', 'SO - delivery - invoice; return invoice; many deliveries, one invoice'], ['s3', 'SO - invoice; return invoice'], ['s4', 'SO - delivery - invoice; return goods - return invoice; one delivery, one invoice'], ['s5', 'SO - delivery - invoice; return invoice; one delivery, one invoice']]
const MENU = {}
const PREFIX = [['KM', 'Cash in (BKM)', 231], ['KK', 'Cash out (BKK)', 418], ['GL', 'Journal entry', 45], ['PJL', 'Sales invoice', 1207], ['PO', 'Purchase order', 86], ['BD', 'Goods receipt', 140], ['SJ', 'Delivery note', 392], ['ADJ', 'Stock adjustment', 12], ['ADJN', 'Value adjustment', 3], ['PAG', 'Stock transfer', 58], ['PR', 'Assembly', 9], ['STK', 'Stock opname', 3]]
PREFIX.forEach(([p]) => { MENU[p] = { dt: true, first: false, auto: p === 'PR', bar: p === 'ADJ', ren: false, sort: 'Date', note: '' } })
const SETUP = {
  num: [
    ['Voucher numbering', [
      { k: 'numbering', l: 'Numbering', t: 'sel', o: NUM_MODES },
      { k: 'bkdate', l: 'Default BKK and BKM date', t: 'sel', o: [['today', 'Today'], ['manual', 'Manual']] },
      { k: 'cost', l: 'Cost method', t: 'ro', o: [['avg', 'Average']] },
      { k: 'startbeg', l: 'Opening balances start from the beginning', t: 'sw' },
    ]],
    ['Program', [
      { k: 'start', l: 'Program start date', t: 'date' },
      { k: 'histdel', l: 'Forget report history on exit', t: 'sw' },
      { k: 'decimals', l: 'Decimal digits', t: 'pct', unit: '' },
    ]],
    ['Document flow', [
      { k: 'purflow', l: 'Purchasing flow', t: 'sel', o: PUR_FLOWS },
      { k: 'salflow', l: 'Sales flow', t: 'sel', o: SAL_FLOWS },
    ]],
  ],
  limits: [
    ['Stock', [
      { k: 'negstock', l: 'Negative stock', t: 'sel', o: FOUR },
      { k: 'negdate', l: 'Negative stock on a back-dated date', t: 'sel', o: FOUR },
    ]],
    ['Credit limits', [
      { k: 'ordlimit', l: 'Order value over credit limit', t: 'sel', o: FOUR },
      { k: 'invlimit', l: 'Sale or purchase over credit limit', t: 'sel', o: FOUR },
    ]],
    ['Quantities', [
      { k: 'overpo', l: 'Quantity received over PO', t: 'sel', o: FOUR },
      { k: 'overso', l: 'Quantity delivered over SO', t: 'sel', o: FOUR },
    ]],
  ],
  prices: [
    ['Prices and discounts', [
      { k: 'pricepl', l: 'SO price differs from price list', t: 'sel', o: PRICE_SO },
      { k: 'priceinv', l: 'Invoice price differs from SO or price list', t: 'sel', o: PRICE_INV },
      { k: 'disc', l: 'Discount differs from SO', t: 'sel', o: FOUR },
      { k: 'hpp', l: 'Show HPP in sales and items', t: 'sel', o: [['all', 'Yes'], ['admin', 'Yes, admin only'], ['no', 'No']] },
    ]],
    ['Tax and cash sales', [
      { k: 'ppn', l: 'PPN rounding', t: 'sel', o: [['none', 'No rounding'], ['up', 'Round up'], ['down', 'Round down'], ['round', 'Round']] },
      { k: 'dcash', l: 'Default total discount, cash sales', t: 'pct' },
      { k: 'dbar', l: 'Default total discount, barcode sales', t: 'pct' },
    ]],
  ],
  forms: [
    ['Extra lines', [
      { k: 'addgr', l: 'Extra lines on goods receipt', t: 'sw' },
      { k: 'adddn', l: 'Extra lines on delivery note', t: 'sw' },
      { k: 'addinv', l: 'Extra lines on matching invoice', t: 'sw' },
    ]],
    ['Forms and printing', [
      { k: 'cashform', l: 'Cash sales form in the menu', t: 'sw' },
      { k: 'barform', l: 'Barcode sales form in the menu', t: 'sw' },
      { k: 'print', l: 'Print cash and barcode receipt', t: 'sel', o: [['auto', 'Automatic'], ['manual', 'Manual']] },
      { k: 'lines', l: 'Lines on a receipt', t: 'pct', unit: '' },
      { k: 'maxprint', l: 'Max prints per receipt', t: 'pct', unit: '' },
    ]],
    ['Edition', [
      { k: 'edition', l: 'Edition', t: 'sel', o: [['Lite', 'Lite'], ['Standard', 'Standard'], ['Premium', 'Premium']] },
      { k: 'giro', l: 'Giro management', t: 'sw', needs: 'Needs Standard edition or above' },
    ]],
  ],
}
const optLabel = r => { const v = CFG[r.k]; if (r.t === 'date') return v; if (r.t === 'sw') return v ? 'Yes' : 'No'; if (r.t === 'pct') return v + (r.unit === '' ? '' : '%'); const o = r.o.find(x => x[0] === v); return o ? o[1] : v }
const allSettings = () => Object.values(SETUP).reduce((a, gs) => a.concat(gs.reduce((b, g) => b.concat(g[1]), [])), [])
window.cfgSet = (k, v) => {
  const r = allSettings().find(x => x.k === k)
  if (r.t === 'sw') { if (k === 'giro' && CFG.edition === 'Lite') return; CFG[k] = !CFG[k] } else CFG[k] = v
  if (k === 'startbeg') OB.fromStart = CFG[k]
  if (k === 'edition' && v === 'Lite') CFG.giro = false
  toast(r.l, `Now: ${optLabel(r)}`); render()
}
const setRow = r => {
  const locked = r.k === 'giro' && CFG.edition === 'Lite'
  let ctl = ''
  if (r.t === 'sel') ctl = `<div style="width:300px">${sel(r.o, CFG[r.k], `cfgSet('${r.k}',this.value)`)}</div>`
  else if (r.t === 'ro') ctl = `<div style="width:300px">${input(optLabel(r), true)}</div>`
  else if (r.t === 'date') ctl = `<div style="width:300px"><input ${IN} type="date" value="${esc(CFG[r.k])}" onchange="cfgSet('${r.k}',this.value)"></div>`
  else if (r.t === 'pct') ctl = `<div style="width:120px"><input ${INR} value="${esc(CFG[r.k])}" onchange="cfgSet('${r.k}',this.value.replace(/[^0-9.]/g,'')||'0')"></div>`
  else ctl = `<span style="display:flex;align-items:center;gap:12px">${locked ? st(r.needs, 'warn') : ''}<span style="min-width:30px;text-align:right">${esc(optLabel(r))}</span>${sw(CFG[r.k], `cfgSet('${r.k}')`, r.l)}</span>`
  return `<div style="display:flex;align-items:center;justify-content:space-between;gap:24px;min-height:56px;padding:8px 20px;border-bottom:1px solid var(--row-line)"><span style="font-weight:500">${r.l}</span>${ctl}</div>`
}
const SU_TABS = [['company', 'Company'], ['num', 'Numbering'], ['limits', 'Stock and limits'], ['prices', 'Prices and tax'], ['forms', 'Forms and edition'], ['masters', 'Masters'], ['menus', 'Menus']]
window.coSet = (k, v) => { CFG.co[k] = v; toast('Company', `${k === 'name' ? 'Name' : 'Detail'} saved`) }
const companyHTML = () => `<div class="form-grid" style="max-width:760px">${[['name', 'Company name', 'span4'], ['logo', 'Logo file name', 'span2'], ['addr', 'Address code', 'span2'], ['npwp', 'NPWP', 'span2'], ['seri', 'Tax invoice series', 'span2'], ['pkp', 'PKP registration number', 'span2']].map(([k, l, c]) => field(l, `<input ${IN} value="${esc(CFG.co[k])}" onchange="coSet('${k}',this.value)">`, c)).join('')}${field('PKP registration date', `<input ${IN} type="date" value="${CFG.co.pkpdate}" onchange="coSet('pkpdate',this.value)">`, 'span2')}</div>`
const mastersHTML = () => table({ cols: [{ l: 'Master', k: 'm' }, { l: 'Opens in', k: 'o', w: 260 }], rows: [
  ['Chart of accounts', 'Chart of accounts', "go('coa-master')"], ['Account links', 'Account links', "go('coa-links')"], ['Credit terms', 'Customers & suppliers', "S.tab.parties='customers';go('parties')"], ['Taxes', 'Customers & suppliers', "S.tab.parties='customers';go('parties')"],
  ['Customers', 'Customers & suppliers', "S.tab.parties='customers';go('parties')"], ['Suppliers', 'Customers & suppliers', "S.tab.parties='suppliers';go('parties')"], ['Warehouses', 'Inventory', "soon('Warehouses')"], ['Units and conversions', 'Inventory', "soon('Units')"],
  ['Items and price lists', 'Inventory', "soon('Items')"], ['Opening stock', 'Opening batch', "go('native-opening')"], ['Employees', 'People', "soon('Employees')"]].map(([m, o, on]) => ({ on, c: { m, o } })) })
window.menuSet = (p, k, v) => { MENU[p][k] = v; toast('Menu', `${PREFIX.find(x => x[0] === p)[1]} updated`) }
/* the 7Soft Setting Menu rows, in the manual's order; Template files are dropped */
const MENU_EXTRA = [
  { d: 'Master', ord: 100, sort: '', note: '' },
  { d: 'Value list', ord: 101, sort: '', note: '' },
  { d: 'Item', ord: 110, sort: 'Nama Item', note: '' },
  { d: 'Formula (BOM)', ord: 111, sort: '', note: '' },
  { d: 'Unit', ord: 112, sort: '', note: '' },
  { d: 'Opening stock', ord: 114, sort: '', note: '' },
  { d: 'Item conversion', ord: 115, sort: '', note: '' },
  { d: 'Warehouse', ord: 120, sort: '', note: '' },
  { d: 'Credit term', ord: 121, sort: '', note: '' },
  { d: 'Address', ord: 122, sort: '', note: '' },
  { d: 'Tax', ord: 125, sort: '', note: '' },
  { d: 'Customer', ord: 150, sort: 'Kode Customer / Supplier', note: '' },
  { d: 'Supplier', ord: 155, sort: 'Kode Customer / Supplier', note: '' },
  { d: 'Employee', ord: 160, sort: '', note: '' },
  { d: 'Price list', ord: 165, sort: '', note: '' },
  { d: 'Asset', ord: 170, sort: '', note: '' },
  { d: 'Account', ord: 175, sort: '', note: '' },
  { d: 'Opening balances', ord: 179, sort: '', note: '' },
  { d: 'Account links', ord: 180, sort: '', note: '' },
  { d: 'Users & groups', ord: 190, sort: '', note: '' },
  { d: 'Menu settings', ord: 196, sort: '', note: '' },
  { d: 'Report list', ord: 198, sort: '', note: '' },
  { d: 'Item & stock info', ord: 210, sort: '', note: '' },
  { d: 'Supplier return', ord: 257, sort: '', note: '' },
  { d: 'Customer return', ord: 258, sort: '', note: '' },
]
MENU_EXTRA.forEach(e => { e.dt = true; e.first = false; e.auto = false; e.bar = false; e.ren = false })
window.menuExtraSet = (i, k, v) => { MENU_EXTRA[i][k] = v; toast('Menu', `${MENU_EXTRA[i].d} updated`) }
const menusHTML = () => {
  const th = (t, w) => `<th style="width:${w}px">${t}</th>`
  const grp = t => `<tr class="grp"><td colspan="11"><div class="grp-in">${t}</div></td></tr>`
  const doc = ([p, d, n]) => `<tr><td><span class="nm">${esc(d)}</span></td><td class="mute">—</td><td><input ${IN} value="${esc(CFG.pre[p])}" onchange="cfgPre('${p}',this.value)"></td><td>${exNo(CFG.pre[p], n)}</td><td>${cb(MENU[p].dt, `menuSet('${p}','dt',this.checked)`)}</td><td>${cb(MENU[p].first, `menuSet('${p}','first',this.checked)`)}</td><td>${cb(MENU[p].auto, `menuSet('${p}','auto',this.checked)`)}</td><td>${cb(MENU[p].bar, `menuSet('${p}','bar',this.checked)`)}</td><td>${cb(MENU[p].ren, `menuSet('${p}','ren',this.checked)`)}</td><td>${sel(['Date', 'Number', 'Name'], MENU[p].sort, `menuSet('${p}','sort',this.value)`)}</td><td><input ${IN} value="${esc(MENU[p].note)}" onchange="menuSet('${p}','note',this.value)"></td></tr>`
  const extra = (e, i) => `<tr><td><span class="nm">${esc(e.d)}</span></td><td><input ${IN} value="${esc(e.ord)}" onchange="menuExtraSet(${i},'ord',+this.value||0)"></td><td class="mute">—</td><td class="mute">—</td><td>${cb(e.dt, `menuExtraSet(${i},'dt',this.checked)`)}</td><td>${cb(e.first, `menuExtraSet(${i},'first',this.checked)`)}</td><td>${cb(e.auto, `menuExtraSet(${i},'auto',this.checked)`)}</td><td>${cb(e.bar, `menuExtraSet(${i},'bar',this.checked)`)}</td><td>${cb(e.ren, `menuExtraSet(${i},'ren',this.checked)`)}</td><td><input ${IN} value="${esc(e.sort)}" onchange="menuExtraSet(${i},'sort',this.value)"></td><td><input ${IN} value="${esc(e.note)}" onchange="menuExtraSet(${i},'note',this.value)"></td></tr>`
  const q = S.q['setup-menus'] || ''
  const docs = PREFIX.filter(([p]) => ['KM', 'KK', 'GL', 'PJL', 'PO', 'BD', 'SJ'].includes(p)).filter(([, d]) => hit(q, d))
  const inv = PREFIX.filter(([p]) => ['PAG', 'ADJ', 'ADJN', 'PR', 'STK'].includes(p)).filter(([, d]) => hit(q, d))
  const ex1 = MENU_EXTRA.slice(0, 22).map((e, i) => ({ e, i })).filter(({ e }) => hit(q, e.d, e.sort, e.note))
  const ex2 = MENU_EXTRA.slice(22).map((e, i) => ({ e, i: i + 22 })).filter(({ e }) => hit(q, e.d, e.sort, e.note))
  return `${bar(search('setup-menus', 'Search menu'))}<div class="ds-table-card" style="overflow:auto"><table class="ds-table tbl t7" style="min-width:1320px"><colgroup><col style="width:220px"><col style="width:80px"><col style="width:90px"><col style="width:150px"><col style="width:80px"><col style="width:70px"><col style="width:70px"><col style="width:80px"><col style="width:90px"><col style="width:140px"><col style="width:200px"></colgroup>
    <thead><tr>${th('Document', 220)}${th('Order', 80)}${th('Prefix', 90)}${th('Next', 150)}${th('Date edit', 80)}${th('First', 70)}${th('Auto', 70)}${th('Barcode', 80)}${th('Rename', 90)}${th('Sort by', 140)}${th('Note', 200)}</tr></thead>
    <tbody>${grp('MASTER')}${ex1.map(({ e, i }) => extra(e, i)).join('')}${grp('DOCUMENTS')}${docs.map(doc).join('')}${grp('INVENTORY')}${inv.map(doc).join('')}${ex2.map(({ e, i }) => extra(e, i)).join('')}</tbody></table></div>`
}
window.impMaster = () => openSheet({ crumb: ['Accounting settings'], title: 'Export or import master', size: 'rail', body: `<div style="display:flex;flex-direction:column;gap:24px">${field('Action', sel(['Export master', 'Import master'], 'Export master'))}${field('File', input('master.7z'))}${checkRow(true, 'With opening balances')}</div>`, foot: btn('OK', "closeSheet();toast('Done','Prototype: nothing is saved')") })
window.emptyDb = () => openSheet({ crumb: ['Accounting settings'], title: 'Empty database', size: 'rail', body: `${field('Type the company name to confirm', `<input ${IN} oninput="document.getElementById('emptybtn').disabled=this.value!==CFG_CO_NAME()">`)}`, foot: btn('Empty database', "closeSheet();toast('Database emptied','Prototype: nothing is deleted')").replace('<button', '<button disabled id="emptybtn"') })
window.CFG_CO_NAME = () => CFG.co.name
const exNo = (p, i) => CFG.numbering[0] === 'm' ? `${p}-26-10-${pad(i + 1, 5)}` : `${p}-26-${pad(i + 1, 5)}`
reg({
  id: 'setup-switches', group: 'master', label: 'Accounting settings',
  render() {
    const tab = tabOf('setup-switches', 'company')
    if (tab === 'company' || tab === 'masters' || tab === 'menus') return page({ title: 'Accounting settings', tabs: SU_TABS, tab, body: tab === 'company' ? companyHTML() : tab === 'masters' ? mastersHTML() : menusHTML() })
    const groups = SETUP[tab || 'num'].map(([t, rs]) => section(t, `<div class="ds-table-card">${rs.map(setRow).join('')}</div>`)).join('')
    const extra = tab === 'forms' ? section('Data', `<div style="display:flex;gap:8px;flex-wrap:wrap">${btn('Export or import master', 'impMaster()')}${btn('Restore defaults', "toast('Defaults restored','Settings back to the original values')")}${btn('Empty database', 'emptyDb()')}</div>`) : ''
    return page({
      title: 'Accounting settings',
      tabs: SU_TABS, tab,
      kpis: [{ label: 'Numbering', value: optLabel({ k: 'numbering', t: 'sel', o: NUM_MODES }) }, { label: 'Negative stock', value: optLabel({ k: 'negstock', t: 'sel', o: FOUR }) }, { label: 'Cost method', value: 'Average' }, { label: 'Edition', value: CFG.edition }],
      body: groups + extra
    })
  }
})
window.cfgPre = (p, v) => { CFG.pre[p] = v.trim() || p; toast('Prefix', `${PREFIX.find(x => x[0] === p)[1]} now starts with ${CFG.pre[p]}`); render() }

/* ═════ customers and suppliers ═════ */
const TERM_ROWS = [['T7', '7 days', 7, false, true], ['T14', '14 days', 14, false, true], ['T30', '30 days', 30, true, true], ['T45', '45 days', 45, false, true], ['CASH', 'Cash', 0, false, true]]
const TAX_ROWS = [['PPN 11%', 11, true, true], ['PPh 21', 5, false, true], ['PPh 23', 2, false, true], ['PPh 25', 0.75, false, true]]
const PCITY = ['Jakarta Barat', 'Surabaya', 'Bandung', 'Medan', 'Semarang', 'Makassar']
const BANKS = ['BCA 123 456 7890', 'Mandiri 140 00 1234567 8', 'BRI 0123 01 000123 50 1', 'BNI 0456 7890 12']
const partyOf = (kind, code) => (kind === 'c' ? CUST : SUPP).find(p => p.code === code)
const recvAcc = () => accTxt(linkOf('Piutang').acc || '1011101003')
const payAcc = () => accTxt(linkOf('Hutang').acc)
window.openParty = (kind, code) => {
  const isC = kind === 'c', p = code ? partyOf(kind, code) : { code: '', name: '', term: 'T30', grace: 0, limit: 0, owing: 0, tier: 'Retail', sales: '', npwp: '', also: false, discCode: '', dueLimit: '' }
  const k = Math.max(0, CUST.concat(SUPP).indexOf(p)) + 3, inv = invoicesOf(p, kind)
  const adr = [0, 1].map(i => ({ lok: PCITY[(k + i) % 6], l1: `${['Jl. Kenanga', 'Jl. Melati Raya', 'Jl. Pasar Baru'][(k + i) % 3]} no. ${10 + k * 3 + i}`, city: PCITY[(k + i) % 6], bank: BANKS[(k + i) % 4], ship: i === 0, bill: i === 1, tax: i === 1, active: true }))
  const adrCard = (x, i) => `<div class="card7" style="margin-bottom:16px"><div class="form-grid" style="margin-bottom:12px">
      ${field('Location', input(x.lok))}${field('Contact', input(''))}${field('Phone', input(''))}${field('Fax', input(''))}
      ${field('Address line 1', input(x.l1), 'span2')}${field('Address line 2', input(''), 'span2')}${field('Address line 3', input(''), 'span2')}${field('City', input(x.city))}${field('Province', input(''))}
      ${field('Bank account', input(x.bank), 'span2')}${isC ? field('Birth date', `<input ${IN} type="date">`) : ''}</div>
    <div style="display:flex;gap:28px;flex-wrap:wrap">${checkRow(x.active, 'Active')}${checkRow(x.ship, 'Default ship to')}${checkRow(x.bill, 'Default bill to')}${checkRow(x.tax, 'Default tax')}</div></div>`
  const invTbl = table({ cols: [{ l: 'Invoice', k: 'n' }, { l: 'Date', k: 'd', w: 130 }, { l: 'Due', k: 'u', w: 130 }, { l: 'Total', k: 't', num: true, w: 170 }],
    rows: inv.map(v => ({ c: { n: v.no, d: day(v.date), u: day(v.due), t: money(v.total) } })), empty: 'No opening invoice', foot: inv.length ? { n: 'Total', t: money(sums(inv, v => v.total)) } : null })
  const acct = a => `<div style="height:44px;display:flex;align-items:center">${a}</div>`
  openSheet({
    crumb: [isC ? 'Customers' : 'Suppliers', p.code || 'New'], title: esc(p.name || (isC ? 'New customer' : 'New supplier')), pill: pill('Active'),
    body: `<div class="form-grid">
      ${field('Code', input(p.code))}${field('Name', input(p.name), 'span2')}${field('Payment term', sel(TERMS, p.term))}
      ${field('Grace days past due', input(p.grace))}${field(isC ? 'Credit limit' : 'Payable limit', input(num(p.limit)))}${field(isC ? 'Receivable account' : 'Payable account', acct(isC ? recvAcc() : payAcc()), 'span2')}
      ${isC ? field('Price tier', sel(['Retail', 'Reseller', 'Wholesale'], p.tier)) + field('Salesperson', input(p.sales)) + field('Rayon', input(p.rayon || '')) + field('Due date limit', input(p.dueLimit || '')) : ''}${field('Discount code', input(p.discCode || ''))}${field('Discount %', input(p.disc || 0))}${field('NPWP', input(p.npwp), 'span2')}
      ${field('Status', sel([['Y', 'Active'], ['N', 'Inactive']], 'Y'))}${field('Note', input(p.note || ''), 'span4')}
    </div>
    <div style="margin-bottom:${p.also ? 16 : 32}px">${checkRow(p.also, isC ? 'Also a supplier' : 'Also a customer', "document.getElementById('pt-also').style.display=this.checked?'':'none'")}</div>
    <div id="pt-also" class="form-grid" style="${p.also ? '' : 'display:none'}">${field(isC ? 'Payable account' : 'Receivable account', acct(isC ? payAcc() : recvAcc()), 'span2')}</div>
    ${section('Addresses', adr.map(adrCard).join(''))}${section(isC ? 'Opening receivables' : 'Opening payables', invTbl, OB.locked ? st('Locked · period closed', 'neutral') : '')}`,
    foot: saveFoot + (code ? btn('Delete', `delParty('${kind}','${code}')`) : '')
  })
}
window.delParty = (kind, code) => {
  const arr = kind === 'c' ? CUST : SUPP, p = arr.find(x => x.code === code)
  if (p.owing) { toast('Not deleted', `${p.name} still has an open balance`); return }
  arr.splice(arr.indexOf(p), 1); closeSheet(); toast('Deleted', p.name); render()
}
const IMP = { Customer: 'KODE · NAMA · LIMIT_HUTANG · NPWP · CONTACT_PERSON · TELP1 · TELP2 · TELP3 · FAX', Supplier: 'KODE · NAMA · LIMIT_HUTANG · NPWP · CONTACT_PERSON · TELP1 · TELP2 · TELP3 · FAX', Item: 'KODE · NAMA · SATUAN · KELOMPOK · HPP_AWAL', 'Price list': 'KODE_ITEM · HARGA_BELI · HARGA_JUAL', Asset: 'KODE · NAMA · JUMLAH · NILAI_ASSET · UMUR · TANGGAL_BELI', BOM: 'KODE_ITEM · KODE_BAHAN · QTY' }
window.impSheet = type => openSheet({
  crumb: [type === 'Asset' ? 'Fixed assets' : 'Customers & suppliers'], title: 'Import', size: 'rail',
  body: `<div style="display:flex;flex-direction:column;gap:24px">${field('Import type', sel(Object.keys(IMP), type, "document.getElementById('imp-cols').textContent=IMPCOLS[this.value]"))}${field('Columns of the Excel file', `<div id="imp-cols" style="min-height:44px">${IMP[type]}</div>`)}${field('Excel file', input('', false, 'Choose a file'))}</div>`,
  foot: btn('Import', "closeSheet();toast('Imported','Prototype: nothing is saved')") + btn('Open Excel format', "toast('Excel format','Template downloaded — prototype')")
})
window.IMPCOLS = IMP
window.openTerm = c => { const r = TERM_ROWS.find(x => x[0] === c) || ['', '', 0, false, true]; openSheet({ crumb: ['Credit terms'], title: r[0] || 'New credit term', size: 'rail', body: `<div style="display:flex;flex-direction:column;gap:24px">${field('Code', input(r[0]))}${field('Name', input(r[1]))}${field('Days', input(r[2]))}${checkRow(r[3], 'Default')}${checkRow(r[4], 'Active')}</div>`, foot: saveFoot }) }
window.openTax = c => { const r = TAX_ROWS.find(x => x[0] === c) || ['', 0, false, true]; openSheet({ crumb: ['Taxes'], title: r[0] || 'New tax', size: 'rail', body: `<div style="display:flex;flex-direction:column;gap:24px">${field('Code', input(r[0]))}${field('Percent', input(r[1]))}${checkRow(r[2], 'Default')}${checkRow(r[3], 'Active')}</div>`, foot: saveFoot }) }

reg({
  id: 'parties', group: 'master', label: 'Customers & suppliers',
  render() {
    const tab = tabOf('parties', 'customers'), isC = tab === 'customers', isS = tab === 'suppliers', q = S.q.parties || ''
    const list = (isC ? CUST : SUPP).filter(p => hit(q, p.code, p.name, p.npwp, p.sales)), kind = isC ? 'c' : 's'
    const acc = isC ? recvAcc() : payAcc()
    const cols = isC
      ? [{ l: 'Code', k: 'code', w: 100 }, { l: 'Name', k: 'name' }, { l: 'Term', k: 'term', w: 80 }, { l: 'Grace days', k: 'gr', num: true, w: 110 }, { l: 'Credit limit', k: 'lim', num: true, w: 160 }, { l: 'Owes us', k: 'ow', num: true, w: 150 }, { l: 'Receivable account', k: 'acc', w: 250 }]
      : [{ l: 'Code', k: 'code', w: 100 }, { l: 'Name', k: 'name' }, { l: 'Term', k: 'term', w: 80 }, { l: 'Payable limit', k: 'lim', num: true, w: 160 }, { l: 'We owe', k: 'ow', num: true, w: 150 }, { l: 'Payable account', k: 'acc', w: 250 }]
    const rows = list.map(p => ({ on: `openParty('${kind}','${p.code}')`, c: { code: p.code, name: `<span class="one nm">${esc(p.name)}${p.also ? ` <span class="mute" style="font-weight:400">· ${isC ? 'also a supplier' : 'also a customer'}</span>` : ''}</span>`, term: p.term, gr: p.grace, lim: p.limit ? money(p.limit) : '<span class="mute">—</span>', ow: money(p.owing), acc: one(acc) } }))
    const termList = TERM_ROWS.filter(r => hit(q, r[0], r[1]))
    const termT = table({ cols: [{ l: 'Code', k: 'c', w: 120 }, { l: 'Name', k: 'n' }, { l: 'Days', k: 'd', num: true, w: 110 }, { l: 'Default', k: 'df', w: 120 }, { l: 'Active', k: 'a', w: 110 }], rows: termList.map(r => ({ on: `openTerm('${r[0]}')`, c: { c: r[0], n: r[1], d: r[2], df: r[3] ? 'Yes' : '<span class="mute">—</span>', a: r[4] ? 'Yes' : 'No' } })), empty: 'No credit term matches' })
    const taxList = TAX_ROWS.filter(r => hit(q, r[0], r[1] + '%'))
    const taxT = table({ cols: [{ l: 'Code', k: 'c', w: 120 }, { l: 'Percent', k: 'p', num: true }, { l: 'Default', k: 'df', w: 120 }, { l: 'Active', k: 'a', w: 110 }], rows: taxList.map(r => ({ on: `openTax('${r[0]}')`, c: { c: r[0], p: r[1] + '%', df: r[2] ? 'Yes' : '<span class="mute">—</span>', a: r[3] ? 'Yes' : 'No' } })), empty: 'No tax matches' })
    const holders = isC ? CUST : SUPP
    const actions = isC || isS
      ? [{ label: isC ? 'New customer' : 'New supplier', on: `openParty('${kind}','')`, icon: 'plus' }, { label: 'Import', on: `impSheet('${isC ? 'Customer' : 'Supplier'}')` }, { label: 'Refresh', on: 'render()', icon: 'undo' }]
      : tab === 'terms' ? [{ label: 'New credit term', on: "openTerm('')", icon: 'plus' }, { label: 'Refresh', on: 'render()', icon: 'undo' }] : [{ label: 'New tax', on: "openTax('')", icon: 'plus' }, { label: 'Refresh', on: 'render()', icon: 'undo' }]
    const kpis = isC || isS
      ? [{ label: isC ? 'Customers' : 'Suppliers', value: num(list.length) }, { label: isC ? 'Owed to us' : 'We owe', value: money(isC ? recvTotal() : payTotal()) }, { label: isC ? 'Credit limits' : 'Payable limits', value: money(sums(holders, p => p.limit)) }, { label: isC ? 'Also suppliers' : 'Also customers', value: holders.filter(p => p.also).length }]
      : tab === 'terms' ? [{ label: 'Credit terms', value: TERM_ROWS.length }, { label: 'Active', value: TERM_ROWS.filter(r => r[4]).length }, { label: 'Default', value: TERM_ROWS.filter(r => r[3]).length }, { label: 'Shortest', value: `${Math.min(...TERM_ROWS.map(r => r[2]))} days` }]
      : [{ label: 'Taxes', value: TAX_ROWS.length }, { label: 'Active', value: TAX_ROWS.filter(r => r[3]).length }, { label: 'Default', value: TAX_ROWS.filter(r => r[2]).length }, { label: 'Top rate', value: `${Math.max(...TAX_ROWS.map(r => r[1]))}%` }]
    const body = isC || isS
      ? `${bar(search('parties', isC ? 'Search customers' : 'Search suppliers'))}${table({ tbl: 'pty', cols, rows, empty: 'No match' })}`
      : `${bar(search('parties', tab === 'terms' ? 'Search credit term' : 'Search tax'))}${tab === 'terms' ? termT : taxT}`
    return page({
      title: 'Customers & suppliers', actions,
      tabs: [['customers', 'Customers', CUST.length], ['suppliers', 'Suppliers', SUPP.length], ['terms', 'Credit terms', TERM_ROWS.length], ['taxes', 'Taxes', TAX_ROWS.length]], tab,
      kpis, body
    })
  }
})

/* ═════ fixed assets ═════ */
const METHODS = [['SL', 'Straight line'], ['DD', 'Double declining'], ['ND', 'Non depreciable']]
const mName = m => METHODS.find(x => x[0] === m)[1]
const A = (code, name, qty, acc, dr, cr, loc, method, life, cost, buy, use, intang, type, note = '') => ({ code, name, qty, acc, dr, cr, loc, method, life, cost, buy, use, intang: !!intang, type: type || '', note, active: true })
const ASSETS = [
  A('A-0001', 'Bangunan Utama', 1, '1021502001', '7010210001', '1021602001', 'HO', 'SL', 20, 850000000, '2018-03-01', '2018-04-01', false, 'Building'),
  A('A-0002', 'Bangunan Tambahan', 1, '1021502002', '7010210002', '1021602002', 'HO', 'SL', 20, 240000000, '2020-02-10', '2020-03-01', false, 'Building'),
  A('A-0003', 'Mobil Operasional', 2, '1021505001', '7010213001', '1021605001', 'HO', 'DD', 4, 320000000, '2023-05-15', '2023-06-01', false, 'Vehicle'),
  A('A-0004', 'Sepeda Motor Kurir', 3, '1021505002', '7010213002', '1021605002', 'C001', 'SL', 4, 54000000, '2024-01-12', '2024-02-01', false, 'Vehicle'),
  A('A-0005', 'FFE Komputer', 12, '1021506003', '7010214003', '1021606003', 'HO', 'SL', 4, 185000000, '2023-08-01', '2023-08-15', false, 'Computer'),
  A('A-0006', 'FFE Office', 1, '1021506001', '7010214001', '1021606001', 'HO', 'SL', 8, 96000000, '2022-01-20', '2022-02-01', false, 'Office equipment'),
  A('A-0007', 'FFE Toko dan Gudang', 1, '1021506002', '7010214002', '1021606002', 'C001', 'SL', 8, 128000000, '2024-03-05', '2024-04-01', false, 'Store equipment'),
  A('A-0008', 'FFE Toko dan Gudang', 1, '1021506002', '7010214002', '1021606002', 'C002', 'SL', 8, 117500000, '2024-06-18', '2024-07-01', false, 'Store equipment'),
  A('A-0009', 'OE - Rak 1', 40, '1021507001', '7010215001', '1021607001', 'C001', 'SL', 5, 142500000, '2024-03-05', '2024-04-01', false, 'Operating equipment'),
  A('A-0010', 'OE - Rak 1', 36, '1021507001', '7010215001', '1021607001', 'C002', 'SL', 5, 128250000, '2024-06-18', '2024-07-01', false, 'Operating equipment'),
  A('A-0011', 'Seventh Soft Application', 1, '1021701001', '7010216001', '1021702001', 'HO', 'SL', 5, 60000000, '2022-09-01', '2022-09-01', true, 'Software'),
  A('A-0012', 'Opti Tex System', 1, '1021701002', '7010216003', '1021702002', 'HO', 'SL', 4, 90000000, '2025-02-03', '2025-03-01', true, 'Software'),
  A('A-0013', 'Tanah Hak Milik', 1, '1021501001', '', '', 'HO', 'ND', 0, 1250000000, '2017-11-20', '2017-11-20', false, 'Land'),
]
const AGRP = [['', 'All assets'], ['1021501', 'Land'], ['1021502', 'Buildings'], ['1021505', 'Vehicles'], ['1021506', 'FFE'], ['1021507', 'Operating equipment'], ['1021701', 'Software']]
const monthsBetween = (from, to) => { const [fy, fm] = from.split('-'), [ty, tm] = to.split('-'); return (+ty - +fy) * 12 + (+tm - +fm) }
/* depreciation charged up to the end of September 2026 (closed), and the October charge */
function dep(a) {
  if (a.method === 'ND' || !a.life) return { done: 0, month: 0 }
  const n = Math.max(0, Math.min(a.life * 12, monthsBetween(a.use, '2026-10')))
  let done = 0
  if (a.method === 'SL') done = Math.round(a.cost / (a.life * 12) * n)
  else for (let i = 0; i < n; i++) done += Math.round((a.cost - done) * (2 / a.life) / 12)
  const left = a.cost - done
  const m = a.method === 'SL' ? Math.round(a.cost / (a.life * 12)) : Math.round(left * (2 / a.life) / 12)
  return { done, month: Math.min(m, left) }
}
window.openAsset = code => {
  const a = code ? ASSETS.find(x => x.code === code) : A('', '', 1, '1021506002', '7010214002', '1021606002', 'HO', 'SL', 4, 0, '2026-10-01', '2026-10-01', false, 'Office equipment')
  const d = dep(a), accs = leaves().filter(c => c.startsWith('10215') || c.startsWith('10217')), exp = leaves().filter(c => c.startsWith('70102')), acm = leaves().filter(c => c.startsWith('10216') || c.startsWith('10217'))
  const pk = list => list.map(c => [c, `${c} · ${nm(c)}`])
  const rate = a.life ? Math.round(10000 / a.life) / 100 : 0
  const locked = !!(a.code && a.use && a.use < PERIOD.from)
  openSheet({
    crumb: ['Fixed assets', a.code || 'New'], title: esc(a.name || 'New asset'), pill: a.code ? pill(a.active ? 'Active' : 'Inactive') + (locked ? ' ' + st('Read only', 'neutral') : '') : '',
    body: `<div class="form-grid">
      ${field('Code', input(a.code))}${field('Name', input(a.name), 'span2')}${field('Quantity', input(a.qty))}
      ${field('Asset account', sel(pk(accs), a.acc), 'span2')}${field('Unit', sel(LOCS.map(l => [l[0], `${l[1]} · ${l[0]}`]), a.loc), 'span2')}
      ${field('Debit account (depreciation expense)', sel([['', '—']].concat(pk(exp)), a.dr), 'span2')}${field('Credit account (accumulated depreciation)', sel([['', '—']].concat(pk(acm)), a.cr), 'span2')}
      ${field('Method', sel(METHODS, a.method))}${field('Life in years', input(a.life))}${field('Rate % per year', input(rate))}${field('Type', input(a.type))}
      ${field('Purchase date', input(a.buy, locked))}${field('In use since', input(a.use, locked))}${field('Cost', input(num(a.cost), locked))}${field('Depreciated to date', input(num(d.done), true))}
      ${field('Note', input(a.note || ''), 'span4')}
    </div>
    <div style="display:flex;gap:32px">${checkRow(a.intang, 'Intangible')}${checkRow(a.active, 'Active')}</div>`,
    foot: saveFoot + (a.code ? btn('Delete', `delAsset('${a.code}')`) : '')
  })
}
window.delAsset = code => {
  const a = ASSETS.find(x => x.code === code)
  if (!a) return
  if (dep(a).done > 0) { toast('Not deleted', 'Asset has been depreciated'); return }
  ASSETS.splice(ASSETS.indexOf(a), 1); closeSheet(); toast('Asset deleted', `${code} · ${a.name}`); render()
}
const depLines = () => ASSETS.filter(a => a.active && dep(a).month > 0).map(a => ({ a, m: dep(a).month }))
window.depJournal = () => {
  const L = depLines(), dr = {}, cr = {}
  L.forEach(({ a, m }) => { const d = acc12(a.dr, a.loc), c = acc12(a.cr, a.loc); dr[d] = (dr[d] || 0) + m; cr[c] = (cr[c] || 0) + m })
  const t = sums(L, x => x.m), n12 = c => `${c} · ${esc(nm(c.slice(0, 10)))} <span class="mute">${LOCS[+c.slice(10)][0]}</span>`
  const jl = Object.entries(dr).map(([c, v]) => ({ c: { a: n12(c), u: 'Depreciation expense', d: money(v), k: '' } })).concat(Object.entries(cr).map(([c, v]) => ({ c: { a: n12(c), u: 'Accumulated depreciation', d: '', k: money(v) } })))
  openSheet({
    crumb: ['Fixed assets', 'Depreciation run'], title: `Journal for ${PERIOD.name}`, pill: pill('Read only'),
    body: `<div class="form-grid">${field('Journal no', input('GL-26-10-00046', true))}${field('Date', input(day(TODAY), true))}${field('Reference', input('', true))}${field('Note', input(`Depreciation ${PERIOD.name}`, true), 'span2')}</div>${table({ cols: [{ l: 'Account', k: 'a' }, { l: 'Description', k: 'u', w: 210 }, { l: 'Debit', k: 'd', num: true, w: 170 }, { l: 'Credit', k: 'k', num: true, w: 170 }], rows: jl, foot: { a: 'Total', d: money(t), k: money(t) } })}<div style="display:flex;justify-content:flex-end;gap:32px;margin-top:12px;font-weight:600"><span>Debit ${money(t)}</span><span>Credit ${money(t)}</span><span>Difference ${money(0)}</span></div>`,
    foot: btn('Send to Journal entry', `closeSheet();toast('Journal entry created','GL-26-10-00046 is waiting in Journal entry · ${money(t)}')`)
  })
}
reg({
  id: 'assets', group: 'master', label: 'Fixed assets',
  render() {
    const tab = tabOf('assets', 'list'), g = filt('assets', 'g', ''), q = S.q.assets || ''
    const D = ASSETS.map(a => ({ a, d: dep(a) }))
    const cost = sums(ASSETS, a => a.cost), done = sums(D, x => x.d.done), month = sums(D, x => x.d.month)
    let body
    if (tab === 'list') {
      const list = D.filter(({ a }) => (!g || a.acc.startsWith(g)) && hit(q, a.code, a.name, a.loc, a.type, a.note))
      const rows = list.map(({ a, d }) => ({ on: `openAsset('${a.code}')`, c: { code: a.code, name: `<span class="one nm">${esc(a.name)}</span>`, loc: a.loc, qty: num(a.qty), m: mName(a.method), cost: money(a.cost), done: d.done ? money(d.done) : '<span class="mute">—</span>', bv: money(a.cost - d.done) } }))
      body = `${bar(search('assets', 'Search code or name'))}<div style="margin-bottom:12px">${chips('assets', 'g', AGRP.map(([v, l]) => [v, l, ASSETS.filter(a => !v || a.acc.startsWith(v)).length]), '')}</div>
        <div class="hist-table-wrap">${table({ tbl: 'ast', cols: [{ l: 'Code', k: 'code', w: 100 }, { l: 'Name', k: 'name' }, { l: 'Unit', k: 'loc', w: 80 }, { l: 'Qty', k: 'qty', num: true, w: 70 }, { l: 'Method', k: 'm', w: 150 }, { l: 'Cost', k: 'cost', num: true, w: 140 }, { l: 'Depreciated', k: 'done', num: true, w: 140 }, { l: 'Book value', k: 'bv', num: true, w: 140 }], rows, empty: 'No asset matches' })}</div>`
    } else {
      const L = depLines()
      body = table({ cols: [{ l: 'Asset', k: 'a' }, { l: 'Method', k: 'm', w: 170 }, { l: 'Debit account', k: 'd', w: 290 }, { l: 'Credit account', k: 'c', w: 290 }, { l: 'Amount', k: 'v', num: true, w: 150 }],
        rows: L.map(({ a, m }) => ({ c: { a: one(`<span class="nm">${esc(a.name)}</span> <span class="mute">${a.code} · ${a.loc}</span>`), m: mName(a.method), d: one(`${acc12(a.dr, a.loc)} · ${esc(nm(a.dr))}`), c: one(`${acc12(a.cr, a.loc)} · ${esc(nm(a.cr))}`), v: money(m) } })), foot: { a: 'Total', v: money(sums(L, x => x.m)) } })
    }
    return page({
      title: 'Fixed assets', actions: tab === 'list' ? [{ label: 'New asset', on: "openAsset('')", icon: 'plus' }, { label: 'Import', on: "impSheet('Asset')", icon: 'download' }, { label: 'Refresh', on: 'render()', icon: 'undo' }] : [{ label: 'Create journal', on: 'depJournal()' }, { label: 'Refresh', on: 'render()', icon: 'undo' }],
      tabs: [['list', 'Assets', ASSETS.length], ['run', 'Depreciation run']], tab,
      kpis: [{ label: 'Cost', value: money(cost) }, { label: 'Depreciated to date', value: money(done) }, { label: 'Book value', value: money(cost - done) }, { label: `Depreciation ${PERIOD.name}`, value: money(month) }],
      body
    })
  }
})

/* ═════ between units ═════ */
const KINDS = [
  { id: 'goods', l: 'Atas barang', rec: '1021402', pay: '2012302', sendCr: '1011201001', recvDr: '1011201001' },
  { id: 'fin', l: 'Pembiayaan', rec: '1021401', pay: '2012301', sendCr: '1011002001', recvDr: '1011002001' },
  { id: 'other', l: 'Lain-lain', rec: '1021403', pay: '2012303', sendCr: '1011002001', recvDr: '6010310099' },
]
const kindOf = id => KINDS.find(k => k.id === id)
const NU = AFFIL.length
const sfx = i => pad(i + 1, 3)
const zero = () => Array.from({ length: NU }, () => Array(NU).fill(0))
const RECV = { goods: zero(), fin: zero(), other: zero() }, PAY = { goods: zero(), fin: zero(), other: zero() }
/* a pair booked on both sides: A's receivable from B = B's payable to A */
const both = (k, a, b, v) => { RECV[k][a][b] += v; PAY[k][b][a] += v }
for (let s = 1; s < NU; s++) both('goods', 0, s, (110 + ((s * 37) % 90)) * 1000000 + s * 250000)
both('goods', 2, 5, 38400000); both('goods', 8, 9, 21750000)
both('fin', 0, 3, 150000000); both('fin', 0, 9, 60000000); both('fin', 2, 7, 25000000)
both('other', 0, 1, 4250000); both('other', 0, 5, 1800000); both('other', 0, 11, 9600000)
/* the two seeded mismatches: a timing difference, and a pair booked on one side only */
RECV.goods[0][6] = 184350000; PAY.goods[6][0] = 142100000
RECV.fin[0][4] = 75000000
const mismatches = () => { const out = []; KINDS.forEach(K => { for (let a = 0; a < NU; a++) for (let b = 0; b < NU; b++) { const d = RECV[K.id][a][b] - PAY[K.id][b][a]; if (d !== 0) out.push({ k: K.id, a, b, d, recv: RECV[K.id][a][b], pay: PAY[K.id][b][a] }) } }); return out }
const U = i => AFFIL[i], L = i => LOCS[i][0]
const jline = (base, loc, dr, cr, state) => ({ c: { a: one(`${acc12(base, loc)} · ${esc(accName(base))} <span class="mute">${loc}</span>`), d: dr ? money(dr) : '', k: cr ? money(cr) : '', s: state === 'New' ? st('New', 'ok') : '<span class="mute">Booked</span>' } })
const jtable = rows => table({ cols: [{ l: 'Account', k: 'a' }, { l: 'Debit', k: 'd', num: true, w: 160 }, { l: 'Credit', k: 'k', num: true, w: 160 }, { l: '', k: 's', w: 90 }], rows })
window.fixPair = (kid, a, b) => {
  const K = kindOf(kid), m = mismatches().find(x => x.k === kid && x.a === a && x.b === b), d = Math.abs(m.d)
  const sideA = [jline(K.rec + sfx(b), L(a), m.recv, 0, 'Booked'), jline(K.sendCr, L(a), 0, m.recv, 'Booked')]
  const sideB = (m.pay ? [jline(K.recvDr, L(b), m.pay, 0, 'Booked'), jline(K.pay + sfx(a), L(b), 0, m.pay, 'Booked')] : [])
  let newA = [], newB = []
  if (m.d > 0) newB = [jline(K.recvDr, L(b), d, 0, 'New'), jline(K.pay + sfx(a), L(b), 0, d, 'New')]
  else newA = [jline(K.rec + sfx(b), L(a), d, 0, 'New'), jline(K.sendCr, L(a), 0, d, 'New')]
  openSheet({
    crumb: ['Between units', K.l], title: `${U(a)} and ${U(b)}`, pill: `<span class="late">Difference ${money(m.d)}</span>`,
    body: `${section(`${esc(U(a))} books`, jtable(sideA.concat(newA)))}${section(`${esc(U(b))} books`, jtable(sideB.concat(newB)))}`,
    foot: btn('Post correcting entry', `postFix('${kid}',${a},${b})`)
  })
}
window.postFix = (kid, a, b) => { PAY[kid][b][a] = RECV[kid][a][b]; closeSheet(); toast('Correcting entry posted', `${U(a)} and ${U(b)} agree again`); render() }
const xferHTML = (a, b, kid, amt) => {
  const K = kindOf(kid)
  return `${section(`${esc(U(a))} books · sender`, jtable([jline(K.rec + sfx(b), L(a), amt, 0, 'New'), jline(K.sendCr, L(a), 0, amt, 'New')]))}${section(`${esc(U(b))} books · receiver`, jtable([jline(K.recvDr, L(b), amt, 0, 'New'), jline(K.pay + sfx(a), L(b), 0, amt, 'New')]))}`
}
const xferRead = () => ({ a: +gv('xf-from'), b: +gv('xf-to'), k: gv('xf-kind'), v: parseInt(gv('xf-amt').replace(/[^\d]/g, '') || '0', 10) })
window.xferPreview = () => { const x = xferRead(); document.getElementById('xf-j').innerHTML = x.a === x.b ? '<div class="empty-note">Pick two different units</div>' : xferHTML(x.a, x.b, x.k, x.v) }
window.xferPost = () => {
  const x = xferRead()
  if (x.a === x.b || x.v <= 0) { toast('Check the transfer', 'Two different units and an amount'); return }
  both(x.k, x.a, x.b, x.v); closeSheet(); toast('Transfer posted', `${U(x.a)} to ${U(x.b)} · ${money(x.v)} · both journals booked`); render()
}
window.newXfer = () => {
  const unitOpts = AFFIL.map((n, i) => [i, `${LOCS[i][0]} · ${n}`])
  openSheet({
    crumb: ['Between units'], title: 'New transfer',
    body: `<div class="form-grid">
      ${field('From unit', sel(unitOpts, 0, 'xferPreview()', 'id="xf-from"'), 'span2')}${field('To unit', sel(unitOpts, 6, 'xferPreview()', 'id="xf-to"'), 'span2')}
      ${field('Kind', sel(KINDS.map(k => [k.id, k.l]), 'goods', 'xferPreview()', 'id="xf-kind"'), 'span2')}${field('Amount', `<input ${INR} id="xf-amt" value="${num(25000000)}" oninput="xferPreview()">`, 'span2')}
      ${field('Note', input(''), 'span4')}
    </div><div id="xf-j">${xferHTML(0, 6, 'goods', 25000000)}</div>`,
    foot: btn('Post transfer', 'xferPost()')
  })
}
reg({
  id: 'interunit', group: 'master', label: 'Between units',
  render() {
    const kid = filt('interunit', 'k', 'goods'), K = kindOf(kid), MM = mismatches(), mine = MM.filter(m => m.k === kid)
    const bad = new Set(mine.reduce((a, m) => a.concat([`${m.a}-${m.b}`, `${m.b}-${m.a}`]), []))
    const rows = AFFIL.map((n, a) => {
      const c = { u: `<span class="one"><span class="nm">${pad(a, 2)}</span> ${esc(n)}</span>` }
      for (let b = 0; b < NU; b++) { const v = RECV[kid][a][b] - PAY[kid][a][b]; c['c' + b] = v === 0 ? '' : bad.has(`${a}-${b}`) ? `<span class="late">${num(Math.round(v / 1e6))}</span>` : num(Math.round(v / 1e6)) }
      return { c }
    })
    const cols = [{ l: 'Unit', k: 'u', w: 170 }].concat(AFFIL.map((n, b) => ({ l: pad(b, 2), k: 'c' + b, num: true, w: 54 })))
    const mmRows = MM.map(m => ({ c: { p: one(`<span class="nm">${esc(U(m.a))}</span> → ${esc(U(m.b))} <span class="mute">· ${kindOf(m.k).l}</span>`), r: money(m.recv), y: money(m.pay), d: `<span class="late">${money(m.d)}</span>`, x: sm('Post correcting entry', `fixPair('${m.k}',${m.a},${m.b})`) } }))
    const totR = sums(RECV[kid], r => sums(r, x => x)), totP = sums(PAY[kid], r => sums(r, x => x))
    const body = `<style>.mx td,.mx th{padding-left:6px!important;padding-right:6px!important}.mx td:first-child,.mx th:first-child{padding-left:16px!important}</style>
      ${bar(chips('interunit', 'k', KINDS.map(x => [x.id, x.l, MM.filter(m => m.k === x.id).length || null]), 'goods'))}
      ${section('Net balance by unit, Rp million', table({ tbl: 'mx', cols, rows }))}
      ${section('Differences', table({ cols: [{ l: 'Receivable owner → counterparty', k: 'p' }, { l: 'Receivable', k: 'r', num: true, w: 140 }, { l: 'Payable', k: 'y', num: true, w: 140 }, { l: 'Difference', k: 'd', num: true, w: 140 }, { l: '', k: 'x', w: 210 }], rows: mmRows, empty: 'Every pair agrees' }))}`
    return page({
      title: 'Between units', actions: [{ label: 'New transfer', on: 'newXfer()', icon: 'plus' }],
      kpis: [{ label: 'Differences', value: MM.length, bad: MM.length > 0 }, { label: `${K.l} receivables`, value: money(totR) }, { label: `${K.l} payables`, value: money(totP) }, { label: 'Pairs checked', value: num(NU * (NU - 1)) }],
      body
    })
  }
})

/* ═════ users and permissions ═════ */
const MENU_GROUPS = [
  ['Master', ['Value list', 'Item', 'Formula (BOM)', 'Unit', 'Opening stock', 'Item conversion', 'Warehouse', 'Credit term', 'Address', 'Tax', 'Customer', 'Supplier', 'Employee', 'Price list', 'Asset', 'Account', 'Opening balances', 'Account links', 'Users & groups', 'Menu settings', 'Report list']],
  ['Inventory', ['Item & stock info', 'Stock transfer', 'Stock adjustment', 'Value adjustment', 'Supplier return', 'Customer return', 'Assembly', 'Stock opname']],
  ['Purchasing', ['Purchase order', 'Goods receipt', 'Purchase invoice', 'Purchase return']],
  ['Sales', ['Sales order', 'Delivery note', 'Cash sale', 'Barcode sale', 'Sales invoice', 'Sales return', 'Sales reports']],
  ['Cash & bank', ['Cash & bank info', 'Cash in (BKM)', 'Cash out (BKK)']],
  ['General ledger', ['Journal entry', 'Period closing', 'Accounting reports']],
  ['Analysis', ['Sales analysis', 'Stock analysis']],
  ['Facilities', ['Online users', 'Restore and patch', 'Backup', 'Export/import master', 'Archive data', 'History report', 'History']],
]
const MENUS = MENU_GROUPS.flatMap(([m, xs]) => xs.map(x => ({ m, x })))
const NO = [0, 0, 0, 0], VO = [1, 0, 0, 0], VAE = [1, 1, 1, 0], ALL = [1, 1, 1, 1]
const GRP_U = [
  { id: 'admin', name: 'Super Admin', note: '', on: true, perm: () => ALL },
  { id: 'fin', name: 'Finance manager', note: '', on: true, perm: m => m === 'Facilities' ? VO : VAE },
  { id: 'acc', name: 'Accounting', note: '', on: true, perm: m => ['Master', 'Cash & bank', 'General ledger', 'Analysis'].includes(m) ? VAE : VO },
  { id: 'kas', name: 'Cash & bank clerk', note: '', on: true, perm: m => m === 'Cash & bank' ? VAE : m === 'Sales' ? VAE : NO },
  { id: 'aud', name: 'Auditor', note: '', on: true, perm: () => VO },
]
const PERM = {}
GRP_U.forEach(g => { PERM[g.id] = MENUS.map(it => g.perm(it.m).map(Boolean)) })
const USERS = [
  { u: 'admin', full: 'Administrator', mail: 'admin@centralfashion.example', title: 'Finance director', note: '', g: 'admin', last: '2026-10-27 08:12', from: '2024-01-01', to: '', repAdmin: true, repTemplate: true, repExcel: true, on: true },
  { u: 'rina.fin', full: 'Rina Kusuma', mail: 'rina@centralfashion.example', title: 'Finance manager', note: '', g: 'fin', last: '2026-10-27 09:03', from: '2024-01-01', to: '', repAdmin: true, repTemplate: true, repExcel: true, on: true },
  { u: 'agus.acc', full: 'Agus Salim', mail: 'agus@centralfashion.example', title: 'Accountant', note: '', g: 'acc', last: '2026-10-27 08:47', from: '2024-03-01', to: '2027-03-01', repAdmin: true, repTemplate: false, repExcel: true, on: true },
  { u: 'dewi.kas', full: 'Dewi Lestari', mail: 'dewi@centralfashion.example', title: 'Cashier', note: '', g: 'kas', last: '2026-10-27 09:12', from: '2025-02-01', to: '2027-02-01', repAdmin: false, repTemplate: false, repExcel: true, on: true },
  { u: 'budi.cash', full: 'Budi Santoso', mail: 'budi@centralfashion.example', title: 'Cashier', note: '', g: 'kas', last: '2026-10-26 11:25', from: '2025-02-01', to: '2027-02-01', repAdmin: false, repTemplate: false, repExcel: true, on: true },
  { u: 'sari.aud', full: 'Sari Wulandari', mail: 'sari@centralfashion.example', title: 'Auditor', note: 'External audit', g: 'aud', last: '2026-10-22 10:20', from: '2026-10-22', to: '2026-12-31', repAdmin: true, repTemplate: false, repExcel: false, on: true },
  { u: 'toni.old', full: 'Toni Hartono', mail: 'toni@centralfashion.example', title: 'Cashier', note: 'Left the company', g: 'kas', last: '2026-06-14 15:02', from: '2024-01-01', to: '2026-06-30', repAdmin: false, repTemplate: false, repExcel: true, on: false },
]
const gName = id => GRP_U.find(g => g.id === id).name
window.permSet = (g, i, j, v) => { PERM[g][i][j] = v; toast('Permission', `${gName(g)} · ${MENUS[i].x} · ${['View', 'Add', 'Edit', 'Delete'][j]} ${v ? 'on' : 'off'}`) }
window.permAll = (g, on) => { PERM[g].forEach(p => p.fill(on)); toast('Permissions', `${gName(g)} · ${on ? 'all on' : 'all off'}`); S.stack.pop(); openGroup(g) }
window.permMod = (g, mod, j, on) => { const xs = MENU_GROUPS.find(([m]) => m === mod)[1]; xs.forEach(x => { const i = MENUS.findIndex(it => it.m === mod && it.x === x); if (i >= 0) PERM[g][i][j] = on }); toast('Permissions', `${gName(g)} · ${mod} · ${['View', 'Add', 'Edit', 'Delete'][j]} ${on ? 'on' : 'off'}`); S.stack.pop(); openGroup(g) }
window.copyPerms = target => { const src = gv('copy-group'); if (!src || src === target) return; PERM[target] = PERM[src].map(p => p.slice()); toast('Permissions copied', `${gName(src)} → ${gName(target)}`); S.stack.pop(); openGroup(target) }
window.groupOn = (id, v) => { const g = GRP_U.find(x => x.id === id); g.on = v === 'Y'; toast('Group', `${g.name} · ${g.on ? 'Active' : 'Inactive'}`) }
window.groupNote = (id, v) => { const g = GRP_U.find(x => x.id === id); g.note = v }
window.delGroup = id => {
  if (id === 'admin') { toast('Not deleted', 'Super Admin is required'); return }
  if (USERS.some(u => u.g === id)) { toast('Not deleted', 'Move the users out of this group first'); return }
  const g = GRP_U.find(x => x.id === id)
  GRP_U.splice(GRP_U.indexOf(g), 1); delete PERM[id]; closeSheet(); toast('Group deleted', g.name); render()
}
window.delUser = u => {
  if (u === 'admin') { toast('Not deleted', 'Administrator is required'); return }
  const x = USERS.find(y => y.u === u)
  USERS.splice(USERS.indexOf(x), 1); closeSheet(); toast('User deleted', x.full); render()
}
window.openGroup = id => {
  const g = GRP_U.find(x => x.id === id)
  const idx = (mod, x) => MENUS.findIndex(it => it.m === mod && it.x === x)
  const rows = MENU_GROUPS.map(([mod, xs]) => {
    const ids = xs.map(x => idx(mod, x))
    const gr = `<tr class="grp"><td>${esc(mod)}</td>${[0, 1, 2, 3].map(j => `<td style="text-align:center">${cb(xs.every((x, k) => PERM[id][ids[k]][j]), `permMod('${id}','${mod}',${j},this.checked)`)}</td>`).join('')}</tr>`
    return gr + xs.map((x, k) => `<tr><td>${esc(x)}</td>${[0, 1, 2, 3].map(j => `<td style="text-align:center">${cb(PERM[id][ids[k]][j], `permSet('${id}',${ids[k]},${j},this.checked)`)}</td>`).join('')}</tr>`).join('')
  }).join('')
  const copySel = `<label class="sel"><select aria-label="Copy permissions from" id="copy-group" style="min-width:210px">${GRP_U.filter(x => x.id !== id).map(x => `<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select>${ico('chevron-down')}</label>`
  openSheet({
    crumb: ['Users & permissions', 'Groups'], title: esc(g.name), pill: pill(`${USERS.filter(u => u.g === id).length} users`),
    body: `<div class="form-grid">${field('Group name', input(g.name), 'span2')}${field('Status', sel([['Y', 'Active'], ['N', 'Inactive']], g.on ? 'Y' : 'N', `groupOn('${id}',this.value)`), 'span2')}${field('Note', `<input ${IN} value="${esc(g.note)}" onchange="groupNote('${id}',this.value)">`, 'span4')}</div>
      <div class="ds-bar">${btn('Select all', `permAll('${id}',true)`, 'primary', 'ds-btn--sm')}${btn('Unselect', `permAll('${id}',false)`, 'primary', 'ds-btn--sm')}<span class="bar-spacer"></span>${copySel}${btn('Copy permissions', `copyPerms('${id}')`, 'primary', 'ds-btn--sm')}</div>
      <div class="ds-table-card" style="overflow:auto"><table class="ds-table tbl t7" style="min-width:560px"><colgroup><col><col style="width:90px"><col style="width:90px"><col style="width:90px"><col style="width:90px"></colgroup><thead><tr><th>Menu</th><th>View</th><th>Add</th><th>Edit</th><th>Delete</th></tr></thead><tbody>${rows}</tbody></table></div>`,
    foot: saveFoot + (id !== 'admin' ? btn('Delete', `delGroup('${id}')`) : '')
  })
}
window.openUser = (u, copy = false) => {
  const source = u ? USERS.find(y => y.u === u) : null
  const x = source ? (copy ? { ...source, u: '', full: source.full + ' (copy)', mail: '', on: true } : source) : { u: '', full: '', mail: '', title: '', note: '', g: 'kas', from: '2026-10-27', to: '', repAdmin: false, repTemplate: false, repExcel: true, on: true }
  openSheet({
    crumb: ['Users & permissions', 'Users'], title: copy ? 'Copy user' : esc(x.full || 'New user'), pill: x.u ? pill(x.on ? 'Active' : 'Inactive') : '',
    body: `<div class="form-grid">
      ${field('User name', input(x.u))}${field('Full name', input(x.full), 'span2')}${field('Group', sel(GRP_U.map(g => [g.id, g.name]), x.g))}
      ${field('Title', input(x.title))}${field('Email', input(x.mail), 'span2')}${field('Note', input(x.note), 'span2')}
      ${field('Valid from', input(x.from), 'span2')}${field('Valid until', input(x.to, false, 'No end date'), 'span2')}
      <div class="span4" style="display:flex;gap:24px;flex-wrap:wrap"><span style="font-weight:500;align-self:center">Report</span>${checkRow(x.repAdmin, 'Admin')}${checkRow(x.repTemplate, 'Template')}${checkRow(x.repExcel, 'To Excel')}</div>
    </div>${checkRow(x.on, 'Active')}`,
    foot: saveFoot + (u && !copy ? btn('Copy', `openUser('${u}',true)`) : '') + (u && !copy ? btn('Delete', `delUser('${u}')`) : '')
  })
}
reg({
  id: 'users', group: 'master', label: 'Users & permissions',
  render() {
    const tab = tabOf('users', 'groups'), q = S.q.users || ''
    let body, act
    if (tab === 'groups') {
      const rows = GRP_U.filter(g => hit(q, g.name)).map(g => ({ on: `openGroup('${g.id}')`, c: { n: `<span class="nm">${esc(g.name)}</span>`, u: USERS.filter(u => u.g === g.id).length, m: `${PERM[g.id].filter(p => p[0]).length} of ${MENUS.length}`, d: `${PERM[g.id].filter(p => p[3]).length} of ${MENUS.length}`, s: g.on ? 'Active' : 'Inactive' } }))
      body = `${bar(search('users', 'Search group'))}${table({ cols: [{ l: 'Group', k: 'n' }, { l: 'Users', k: 'u', num: true, w: 110 }, { l: 'Menus they see', k: 'm', w: 170 }, { l: 'Menus they delete in', k: 'd', w: 190 }, { l: 'Status', k: 's', w: 110 }], rows, empty: 'No group' })}`
      act = { label: 'New group', on: "openGroup('fin')", icon: 'plus' }
    } else {
      const rows = USERS.filter(u => hit(q, u.u, u.full, gName(u.g))).map(u => ({ on: `openUser('${u.u}')`, c: { u: `<span class="nm">${esc(u.u)}</span>`, f: esc(u.full), g: gName(u.g), l: `${dayS(u.last.slice(0, 10))} · ${u.last.slice(11)}`, v: u.to ? day(u.to) : '<span class="mute">No end</span>', a: u.on ? 'Yes' : 'No' } }))
      body = `${bar(search('users', 'Search users'))}${table({ cols: [{ l: 'User', k: 'u', w: 150 }, { l: 'Full name', k: 'f' }, { l: 'Group', k: 'g', w: 200 }, { l: 'Last sign-in', k: 'l', w: 170 }, { l: 'Valid until', k: 'v', w: 150 }, { l: 'Active', k: 'a', w: 90 }], rows, empty: 'No user' })}`
      act = { label: 'New user', on: "openUser('')", icon: 'plus' }
    }
    return page({
      title: 'Users & permissions', actions: [act, { label: 'Refresh', on: 'render()', icon: 'undo' }], tabs: [['groups', 'Groups', GRP_U.length], ['users', 'Users', USERS.length]], tab,
      kpis: [{ label: 'Groups', value: GRP_U.length }, { label: 'Users', value: USERS.length }, { label: 'Active users', value: USERS.filter(u => u.on).length }, { label: 'Signed in today', value: USERS.filter(u => u.last.startsWith(TODAY)).length }],
      body
    })
  }
})

/* ═════ history ═════ */
const H = (d, t, u, doc, act, ch) => ({ d, t, u, doc, act, ch })
const HIST = [
  H('2026-10-27', '09:41:12', 'dewi.kas', 'BKM KM-26-10-00231', 'Edited', 'Total 1.250.000 → 1.500.000'),
  H('2026-10-27', '09:12:48', 'dewi.kas', 'BKM KM-26-10-00231', 'Added', 'Total 1.250.000'),
  H('2026-10-27', '08:50:03', 'agus.acc', 'Journal GL-26-10-00045', 'Added', 'Total 12.400.000'),
  H('2026-10-27', '08:05:44', 'admin', 'LAPORAN EXPORT XLS Laporan Kas-Bank Detail Per Transaksi Periode 1', 'Exported', '34 rows · XLS'),
  H('2026-10-27', '07:58:19', 'admin', 'Faktur Penjualan PJL-26-10-00088', 'Added', 'Total 4.750.000'),
  H('2026-10-27', '07:42:06', 'admin', 'Surat Jalan SJ-26-10-00042', 'Added', '3 lines'),
  H('2026-10-26', '17:12:33', 'rina.fin', 'Sales Order S-26-10-00031', 'Added', '5 lines · 6.200.000'),
  H('2026-10-26', '16:48:20', 'agus.acc', 'Faktur Pembelian BLI-26-10-00022', 'Added', 'Total 18.900.000'),
  H('2026-10-26', '16:20:31', 'rina.fin', 'Account 6010310025', 'Added', 'Biaya Parkir & Tol'),
  H('2026-10-26', '16:19:11', 'admin', 'Barang Datang BPB-26-10-00018', 'Added', '4 lines'),
  H('2026-10-26', '15:45:02', 'rina.fin', 'Order Pembelian P-26-10-00012', 'Added', '6 lines'),
  H('2026-10-26', '15:03:57', 'rina.fin', 'Account 1011302007', 'Added', 'Prepaid - PPh Pasal 22'),
  H('2026-10-26', '11:30:09', 'budi.cash', 'BKK KK-26-10-00418', 'Added', 'Total 8.350.000'),
  H('2026-10-26', '10:02:44', 'admin', 'Setting Negative stock', 'Edited', 'Yes → Yes with warning'),
  H('2026-10-25', '14:44:18', 'agus.acc', 'Asset A-0012', 'Edited', 'Life 5 → 4 years'),
  H('2026-10-25', '13:10:52', 'dewi.kas', 'BKM KM-26-10-00228', 'Deleted', 'Total 640.000'),
  H('2026-10-25', '11:20:37', 'admin', 'Item A10587444', 'Edited', 'Price 189.000 → 199.000'),
  H('2026-10-24', '17:05:26', 'rina.fin', 'Customer K21', 'Edited', 'Credit limit 250.000.000 → 300.000.000'),
  H('2026-10-24', '15:38:54', 'admin', 'Satuan GELINTIR', 'Added', '1 gelintir = 12 pcs'),
  H('2026-10-24', '09:30:11', 'rina.fin', 'Supplier S-0077', 'Edited', 'Term T14 → T30'),
  H('2026-10-23', '15:48:39', 'agus.acc', 'Journal GL-26-10-00041', 'Edited', 'Debit 7010214003 → 7010214002'),
  H('2026-10-23', '10:26:18', 'admin', 'Formula ( BOM ) 11-10-00001', 'Added', '4 components'),
  H('2026-10-22', '16:30:07', 'budi.cash', 'BKK KK-26-10-00402', 'Edited', 'Date 21 Oct → 22 Oct'),
  H('2026-10-22', '14:03:29', 'admin', 'Custom Report 12', 'Edited', 'Columns 6 → 7'),
  H('2026-10-22', '10:15:23', 'admin', 'User sari.aud', 'Added', 'Group Auditor'),
  H('2026-10-21', '12:00:46', 'rina.fin', 'Account link Potongan Piutang', 'Edited', '4010214001 → 4010213001'),
  H('2026-10-21', '09:47:55', 'admin', 'Setting Menu Jual_Cash', 'Edited', 'Access added for Cash & bank clerk'),
  H('2026-10-20', '14:25:19', 'dewi.kas', 'Giro BG-0442', 'Edited', 'Open → Cleared'),
  H('2026-10-19', '09:55:02', 'agus.acc', 'Asset A-0003', 'Added', 'Cost 320.000.000'),
  H('2026-10-27', '09:30:22', 'superadmin', 'Setting User & Group SUPERADMIN', 'Edited', 'Menu rights 24 → 26'),
  H('2026-10-16', '11:11:35', 'rina.fin', 'Tax PPN 11%', 'Edited', 'Default No → Yes'),
  H('2026-10-14', '15:20:41', 'budi.cash', 'BKM KM-26-10-00190', 'Deleted', 'Total 1.900.000'),
  H('2026-10-12', '10:40:14', 'admin', 'Group Cash & bank clerk', 'Edited', 'Delete on BKK removed'),
  H('2026-10-08', '16:05:08', 'agus.acc', 'Journal GL-26-10-00019', 'Added', 'Total 3.250.000'),
  H('2026-10-05', '09:18:27', 'rina.fin', 'Credit term T45', 'Added', '45 days'),
  H('2026-10-02', '13:35:50', 'dewi.kas', 'BKK KK-26-10-00377', 'Added', 'Total 2.150.000'),
  H('2026-10-01', '08:30:05', 'rina.fin', 'Opening balances Oct 2026', 'Edited', 'Stock 1.186.670.000 → 1.184.320.000'),
  H('2026-09-30', '18:10:33', 'rina.fin', 'Closing Sep 2026', 'Added', 'Period closed'),
  H('2026-09-30', '17:40:12', 'agus.acc', 'Journal GL-26-09-00112', 'Added', 'Total 24.800.000'),
  H('2026-09-29', '11:25:48', 'dewi.kas', 'BKM KM-26-09-00502', 'Deleted', 'Total 300.000'),
  H('2026-09-26', '14:02:21', 'admin', 'Setting PPN rounding', 'Edited', 'Round down → Round'),
  H('2026-09-18', '10:10:09', 'budi.cash', 'BKK KK-26-09-00398', 'Edited', 'Total 5.100.000 → 5.400.000'),
  H('2026-09-10', '09:00:54', 'rina.fin', 'Account 8020111002', 'Edited', 'Active Yes → No'),
].sort((a, b) => (b.d + b.t).localeCompare(a.d + a.t))
const docType = d =>
  /^(Faktur Penjualan|Retur Penjualan|Sales Order|Surat Jalan)/.test(d) ? 'Sales' :
  /^(Faktur Pembelian|Invoice Retur Beli|Order Pembelian|Barang Datang)/.test(d) ? 'Purchase' :
  /^(Item|Satuan|Formula)/.test(d) ? 'Stock' :
  /^(Custom Report|LAPORAN EXPORT XLS)/.test(d) ? 'Report' :
  /^(BKM|BKK|Giro|Journal|Asset)/.test(d) ? d.split(' ')[0] :
  /^(Account link|Setting|Tax|Credit term)/.test(d) ? 'Setting' :
  /^Account/.test(d) ? 'Account' :
  /^(Customer|Supplier)/.test(d) ? 'Party' :
  /^(User|Group)/.test(d) ? 'Access' : 'Period'
const DTYPES = ['Sales', 'Purchase', 'Stock', 'Report', 'BKM', 'BKK', 'Giro', 'Journal', 'Account', 'Asset', 'Party', 'Setting', 'Access', 'Period']
const HUSERS = ['rina.fin', 'agus.acc', 'dewi.kas', 'budi.cash', 'admin', 'superadmin']
const sinceOf = r => r === 'today' ? TODAY : r === 'week' ? '2026-10-21' : r === 'month' ? '2026-10-01' : '0000'
/* the Menu wording 7Soft prints, kept so the After carries the same context */
const menuOf = d =>
  /^BKM/.test(d) ? 'BKM (Bukti Kas/Bank Masuk)' :
  /^BKK/.test(d) ? 'BKK (Bukti Kas/Bank Keluar)' :
  /^Giro/.test(d) ? 'Pencairan BG' :
  /^Journal/.test(d) ? 'Transaksi Jurnal' :
  /^Asset/.test(d) ? 'Asset' :
  /^Account link/.test(d) ? 'Setting COA' :
  /^Account/.test(d) ? 'Setting COA' :
  /^Setting User & Group/.test(d) ? 'Setting User & Group' :
  /^Setting Menu/.test(d) ? 'Setting Menu' :
  /^Setting COA/.test(d) ? 'Setting COA' :
  /^(Setting|Tax|Credit term)/.test(d) ? 'Set Up' :
  /^(Customer|Supplier)/.test(d) ? 'Customer · Supplier' :
  /^(User|Group)/.test(d) ? 'Setting User & Group' :
  /^(Opening|Closing|Period)/.test(d) ? 'Closing Periode' :
  /^Faktur Penjualan/.test(d) ? 'Faktur Penjualan' :
  /^Retur Penjualan/.test(d) ? 'Retur Penjualan' :
  /^Sales Order/.test(d) ? 'Sales Order' :
  /^Surat Jalan/.test(d) ? 'Surat Jalan' :
  /^Faktur Pembelian/.test(d) ? 'Faktur Pembelian' :
  /^Invoice Retur Beli/.test(d) ? 'Invoice Retur Beli' :
  /^Order Pembelian/.test(d) ? 'Order Pembelian' :
  /^Barang Datang/.test(d) ? 'Barang Datang' :
  /^Item/.test(d) ? 'Item' :
  /^Satuan/.test(d) ? 'Satuan' :
  /^Formula/.test(d) ? 'Formula ( BOM )' :
  /^Custom Report/.test(d) ? 'Custom Report' :
  /^LAPORAN EXPORT XLS/.test(d) ? 'LAPORAN EXPORT XLS' : 'Other'
const docNo = d => d.replace(/^(BKM|BKK|Giro|Journal|Asset|Account link|Account|Setting User & Group|Setting Menu|Setting COA|Setting|Tax|Credit term|Customer|Supplier|User|Group|Opening balances|Closing|Period|Faktur Penjualan|Retur Penjualan|Sales Order|Surat Jalan|Faktur Pembelian|Invoice Retur Beli|Order Pembelian|Barang Datang|Item|Satuan|Formula \( BOM \)|Custom Report|LAPORAN EXPORT XLS)\s+/, '')
const histSel = (id, key, opts, cur) => `<label class="sel"><select aria-label="${key}" onchange="setFilt('${id}','${key}',this.value)">${opts.map(([v, l, n]) => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(l)}${n != null ? ` (${n})` : ''}</option>`).join('')}</select>${ico('chevron-down')}</label>`
function histState() {
  const q = S.q.history || '', fu = filt('history', 'u', ''), ft = filt('history', 't', ''), fr = filt('history', 'r', 'month'), fa = filt('history', 'a', '')
  const range = HIST.filter(h => h.d >= sinceOf(fr))
  const byUser = range.filter(h => !fu || h.u === fu)
  const scope = byUser.filter(h => !ft || docType(h.doc) === ft)
  const found = scope.filter(h => hit(q, h.doc, h.ch, h.u, menuOf(h.doc), docNo(h.doc)))
  const list = found.filter(h => !fa || h.act === fa)
  return { q, fu, ft, fr, fa, range, byUser, scope, found, list }
}
window.histClear = () => { S.q.history = ''; delete S.f.history; render() }
window.histPrint = () => window.print()
window.histExport = () => {
  const { list } = histState()
  const csv = [['Time', 'User', 'Menu', 'Document', 'Action', 'What changed'], ...list.map(h => [`${h.d} ${h.t}`, h.u, menuOf(h.doc), docNo(h.doc), h.act, h.ch])]
    .map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\r\n')
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  a.download = 'history.csv'
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  toast('Export ready', `${list.length} ${list.length === 1 ? 'entry' : 'entries'} · history.csv`)
}
reg({
  id: 'history', group: 'master', label: 'History', stackBA: true,
  render() {
    const { q, fu, ft, fr, fa, range, byUser, found, list } = histState()
    const rows = list.map(h => ({ c: {
      t: `${day(h.d)} · ${h.t}`,
      u: h.u,
      m: `<span class="one" title="${esc(menuOf(h.doc))}">${esc(menuOf(h.doc))}</span>`,
      d: h.act === 'Exported' ? `<span class="one doc-wrap" title="${esc(docNo(h.doc))}">${esc(docNo(h.doc))}</span>` : `<span class="one" title="${esc(docNo(h.doc))}">${esc(docNo(h.doc))}</span>`,
      a: `<span class="hact hact--${h.act.toLowerCase()}">${h.act}</span>`,
      c: `<span class="one cell-wrap" title="${esc(h.ch)}">${esc(h.ch)}</span>`,
    } }))
    const kpi = (v, l, n) => `<button class="ds-kpi ${fa === v ? 'on' : ''}" type="button" aria-pressed="${fa === v}" title="${v ? `Show only ${l.toLowerCase()}` : 'Show all activity'}" onclick="setFilt('history','a','${fa === v ? '' : v}')"><div class="ds-kpi-label">${l}</div><div class="ds-kpi-value">${n}</div></button>`
    const count = a => found.filter(h => h.act === a).length
    const filtered = !!(q || fu || ft || fa || fr !== 'month')
    const periodLabel = fr === 'today' ? day(TODAY) : fr === 'week' ? '21–27 Oct 2026' : fr === 'month' ? '1–31 Oct 2026' : 'All periods'
    const body = `<div class="ds-kpis kpis hist-kpis">${kpi('', 'Activity', found.length)}${kpi('Added', 'Added', count('Added'))}${kpi('Edited', 'Edited', count('Edited'))}${kpi('Deleted', 'Deleted', count('Deleted'))}${kpi('Exported', 'Exported', count('Exported'))}</div>
      <div class="ds-bar hist-bar">${search('history', 'Search history')}${chips('history', 'r', [['today', 'Today'], ['week', '7 days'], ['month', 'This month'], ['all', 'All']], 'month')}${histSel('history', 'u', [['', 'All users', range.length]].concat(HUSERS.map(u => [u, u, range.filter(h => h.u === u).length])), fu)}<span class="bar-spacer"></span><span class="bar-count">${list.length} of ${range.length} entries</span>${filtered ? btn('Clear', 'histClear()', 'primary', 'ds-btn--sm') : ''}</div>
      <div class="hist-filters">${chips('history', 't', [['', 'All activity', byUser.length]].concat(DTYPES.map(t => [t, t, byUser.filter(h => docType(h.doc) === t).length])), '')}</div>
      <div class="hist-table-wrap">${table({ cols: [{ l: 'Time', k: 't', w: 190 }, { l: 'User', k: 'u', w: 104 }, { l: 'Menu', k: 'm', w: 244 }, { l: 'Document', k: 'd', w: 200 }, { l: 'Action', k: 'a', w: 96 }, { l: 'What changed', k: 'c' }], rows, empty: 'No activity matches these filters' })}</div>
      <div class="hist-foot"><span>${periodLabel} · ${list.length} ${list.length === 1 ? 'entry' : 'entries'}</span><span class="hist-sort">Signed in as admin · Demo data</span></div>`
    return page({
      title: 'History',
      actions: [{ label: 'Print', on: 'histPrint()', icon: 'printer' }, { label: 'Export', on: 'histExport()', icon: 'download' }],
      body
    })
  }
})

})()
