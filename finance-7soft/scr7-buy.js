;(() => {
'use strict'
/* ═════════ Pembelian, as 7Soft shows it: Info Pembelian · Faktur Pembelian · Retur Beli · Laporan Pembelian ═════════
   Content = the manual's screenshots (pp. 110–137 printed). Numbers in 7Soft's own format (1,234.00), dates as 7Soft prints them. */

const n7 = (x, d = 2) => (x == null || x === '' ? '' : Number(x).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }))
const nz = x => (x ? n7(x) : '.00')
const sp = x => n7(x).replace(/,/g, ' ')
const sum7 = (xs, f = x => x) => xs.reduce((a, x) => a + f(x), 0)
const MON7 = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const d7 = (iso, t = '') => { const [y, m, d] = iso.split('-'); return `${d} ${MON7[+m - 1]} ${y}${t ? '  ' + t : ''}` }
const addDays7 = (iso, n) => new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) + n * 864e5).toISOString().slice(0, 10)
const iso7 = s => { const m = String(s).match(/^(\d{2}) (\w{3}) (\d{4})/); return m ? `${m[3]}-${String(MON7.indexOf(m[2]) + 1).padStart(2, '0')}-${m[1]}` : '' }

try {
  document.head.insertAdjacentHTML('beforeend', `<style id="b7-css">
.b7in{width:100%;height:36px;padding:0 10px;border:1px solid var(--hairline-2);border-radius:var(--r-inner);background:var(--canvas);font:inherit;color:var(--ink);font-variant-numeric:tabular-nums;min-width:0}
.b7in.r{text-align:right}
.b7in:focus{outline:0;border-color:var(--accent);box-shadow:var(--shadow-focus)}
.b7in[readonly],.b7in:disabled{background:var(--soft);color:var(--body);opacity:1;-webkit-text-fill-color:var(--body)}
textarea.b7in{height:72px;padding:8px 10px;resize:none}
.b7-tb{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 16px;align-items:center}
.b7-tb .ds-btn{height:32px;padding:0 12px}
.b7-st{display:inline-flex;flex-direction:column;align-items:center;min-width:120px;padding:4px 14px;border:1px solid var(--hairline-2);border-radius:var(--r-inner);line-height:1.3}
.b7-st b{font-weight:600}
.b7-ro{padding:6px 14px;border-radius:var(--r-inner);background:var(--bad-bg);color:var(--bad-fg);font-weight:600}
.b7-f{display:grid;grid-template-columns:1fr 1fr;gap:0 36px;margin-bottom:20px}
.b7-r{display:flex;align-items:center;gap:8px;margin-bottom:10px;min-height:36px}
.b7-r>span{flex:none;width:128px;color:var(--body)}
.b7-r>span.m{width:auto}
.b7-r .eq{flex:none;color:var(--body)}
.b7-sub{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:0 0 12px}
.b7-sub .ds-btn{height:30px;padding:0 10px}
.b7-foot{display:flex;justify-content:space-between;gap:24px;margin:16px 0 8px;align-items:flex-start}
.b7-foot .acc{font-weight:600;line-height:1.7}
.b7-tot{display:grid;grid-template-columns:auto 170px;gap:6px 12px;align-items:center}
.b7-tot span{color:var(--body);text-align:right}
.b7-tot b{font-weight:600;text-align:right;padding:6px 10px;border:1px solid var(--hairline-2);border-radius:var(--r-inner);font-variant-numeric:tabular-nums}
.b7-bar{display:flex;justify-content:space-between;gap:16px;padding:10px 0 0;margin-top:12px;border-top:1px solid var(--hairline);font-weight:600}
.b7-sum{display:flex;flex-wrap:wrap;gap:8px 28px;align-items:center;padding:12px 0 0}
.b7-sum label{display:inline-flex;align-items:center;gap:8px;color:var(--body)}
.b7-sum .b7in{width:150px;text-align:right}
.g7-scroll{overflow-x:auto}
.g7-scroll table{min-width:var(--mw,720px)}
.g7 th{text-align:center;vertical-align:middle;white-space:nowrap}
.g7 th.is-num{text-align:center}
.g7 td{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.g7 th.g7c{border-bottom:1px solid var(--hairline)}
.g7 tr.g7sel td{background:var(--accent-bg)}
.g7 td.mk{padding:0;text-align:center;color:var(--accent);width:28px}
.ck7{display:inline-flex;align-items:center;gap:8px;margin-right:18px}
.b7-chk{display:flex;flex-wrap:wrap;align-items:center;gap:10px 8px;margin:0 0 14px}
.b7-chk .b7in{width:150px}
.paper7{background:#fff;border:1px solid var(--hairline);border-radius:var(--r-card);padding:20px 24px;margin-top:20px;overflow-x:auto}
.paper7 .co{font-size:17px;letter-spacing:3px;margin-bottom:6px}
.paper7 h3{margin:0;text-align:center;font-size:17px;font-weight:600}
.paper7 .sub{text-align:center;margin-bottom:10px}
.paper7 table{border-collapse:collapse;width:100%}
.paper7 th,.paper7 td{border:1px solid var(--ink);padding:3px 8px;white-space:nowrap}
.paper7 th{text-align:center;font-weight:600}
.paper7 td.r{text-align:right;font-variant-numeric:tabular-nums}
.paper7 td.nb{border:0}
.paper7 .by{margin-top:8px}
.paper7 tr.t td{font-weight:600}
</style>`)
} catch (e) { /* headless */ }

/* ─── shared pieces ─── */
const grid = o => {
  const cols = o.cols, grp = cols.some(c => c.g)
  let h1 = '', h2 = ''
  for (let i = 0; i < cols.length;) {
    const c = cols[i]
    if (c.g) { let j = i; while (j < cols.length && cols[j].g === c.g) j++; h1 += `<th colspan="${j - i}" class="g7c">${c.g}</th>`; for (let x = i; x < j; x++) h2 += `<th>${cols[x].l}</th>`; i = j }
    else { h1 += `<th ${grp ? 'rowspan="2"' : ''}>${c.l}</th>`; i++ }
  }
  const body = o.rows.length ? o.rows.map(r => r.span !== undefined ? `<tr><td colspan="${cols.length}">${r.span}</td></tr>` : `<tr class="${r.sel ? 'g7sel' : ''}" ${r.on ? `onclick="${r.on}"` : ''}>${cols.map(c => `<td class="${c.k === '_' ? 'mk' : c.num ? 'is-num' : ''} ${c.cls || ''}">${r.c[c.k] ?? ''}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${cols.length}" class="empty-note">${o.empty || ''}</td></tr>`
  const tw = sum7(cols, c => c.w || 120)
  return `<div class="ds-table-card g7"><div class="g7-scroll" style="--mw:${o.mw || tw}px"><table class="ds-table tbl t7" style="table-layout:fixed;min-width:${o.mw || tw}px"><colgroup>${cols.map(c => `<col style="width:${c.w || 120}px">`).join('')}</colgroup><thead><tr>${h1}</tr>${grp ? `<tr>${h2}</tr>` : ''}</thead><tbody>${body}</tbody></table></div></div>`
}
const mkc = sel => sel ? '▶' : ''
const tb = items => `<div class="b7-tb">${items.map(([l, on, off]) => `<button class="ds-btn ds-btn--primary" type="button" ${off ? 'disabled' : ''} onclick="${on}">${l}</button>`).join('')}</div>`
const sub = items => `<div class="b7-sub">${items.map(([l, on, off]) => `<button class="ds-btn ds-btn--primary" type="button" ${off ? 'disabled' : ''} onclick="${on}">${l}</button>`).join('')}</div>`
const cb = (label, on, checked, dis) => `<label class="ck7"><input type="checkbox" class="cb7" ${checked ? 'checked' : ''} ${dis ? 'disabled' : ''} onchange="${on}">${label}</label>`
const rd = (name, v, label, cur, on) => `<label class="ck7"><input type="radio" name="${name}" ${cur === v ? 'checked' : ''} onchange="${on}">${label}</label>`
const head7 = t => `<div class="door-head"><div class="door-top"><h1 class="ds-title">${t}</h1></div></div>`
const inp7 = (v, on, o = {}) => `<input class="b7in ${o.r ? 'r' : ''}" ${o.type ? `type="${o.type}"` : ''} value="${esc(v)}" ${o.ro ? 'readonly tabindex="-1"' : ''} ${on && !o.ro ? `onchange="${on}"` : ''}>`
const sel7 = (opts, cur, on, ro) => `<select class="b7in" ${ro ? 'disabled' : `onchange="${on}"`}>${opts.map(o => { const [v, l] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(v)}" ${String(v) === String(cur) ? 'selected' : ''}>${esc(l)}</option>` }).join('')}</select>`
const row7 = (l, inner, cls = '') => `<div class="b7-r ${cls}"><span>${l}</span>${inner}</div>`
const T7 = { inv: 'det', ret: 'det', info: 'sup' }
const tabs7 = (k, tabs) => `<div class="ds-tabs door-tabs" role="tablist">${tabs.map(([key, l]) => `<button class="ds-tab ${T7[k] === key ? 'is-selected' : ''}" role="tab" type="button" onclick="b7Tab('${k}','${key}')">${l}</button>`).join('')}</div>`
window.b7Tab = (k, key) => { T7[k] = key; render() }
const toastNo = what => toast(what, 'Prototipe: tidak ada yang disimpan')

/* ═════════ master data seen in the screenshots ═════════ */
const ITEMS = [
  { name: 'ABSOLUT  A3 80 GR2', kode: 'A10587444', u: 'PAK', p: 2000 },
  { name: 'AIRMAIL AMPLOP COKLAT DG TALI KABINET', kode: 'A10685', u: 'UNIT', p: 5000 },
  { name: 'AIRMAIL AMPLOP COKLAT DG TALI 1/2 FOLIO', kode: 'A10686', u: 'UNIT', p: 100 },
  { name: 'CD RW ASUS 52X', kode: 'CDRW-ASUS', u: 'UNIT', p: 235000 },
]
const SUPS = [['AGUNG LANGGENG', 'SS28'], ['MSC', 'SS03'], ['LANGGENG CD', 'SS01'], ['SUMBER KOMPUTER', 'SI02']]
const PPNS = [['PPN0', 'PPN0'], ['PPN10', 'PPN10']]
const GUDANGS = ['TOKO', 'Gudang1', 'GUDANG2']
const PO_OF = { SS28: [{ no: 'P-16-02-00001', ref: 'R-25/07', ppn: 'PPN10', gudang: 'TOKO', terima: ['BPB-16-02-00001'], items: [[0, 2], [1, 5], [2, 8]] }], SS03: [{ no: 'PO-NO07-08-00065', ref: 'T-02.07', ppn: 'PPN0', gudang: 'Gudang1', terima: [], items: [[3, 30]] }] }
const ppnPct = c => c === 'PPN10' ? 10 : 0
const mkLines = items => items.map(([i, q]) => ({ i, q, p: ITEMS[i].p }))
const calc7 = (lines, ppn) => { const total = sum7(lines, l => l.q * l.p), tax = total * ppnPct(ppn) / 100; return { total, tax, grand: total + tax } }
const jtempo = (tgl, jangka) => { const iso = iso7(tgl); return iso ? d7(addDays7(iso, 21), tgl.split('  ')[1] || '') : '' }

/* ═════════ Faktur / Invoice Pembelian ═════════ */
const FK = [
  { no: 'BLI-16-02-00001', tgl: '10 Feb 2016  08:44:25', sup: 'AGUNG LANGGENG', kode: 'SS28', lok: 'SURABAYA', alamat: 'SURABAYA', jangka: 'T21', tipe: 'MATCHING', po: 'P-16-02-00001', poRef: 'R-25/07', terima: 'BPB-16-02-00001', terimaRef: '', gudang: 'TOKO', ref: '', dv: '', ppn: 'PPN10', ket: '', status: 'LUNAS', ro: true, lines: mkLines([[0, 2], [1, 5], [2, 8]]),
    um: [{ no: 'BLI-16-02-00002', tgl: '2/10/2016 8:55:39 AM', ref: '', total: 10000, applied: 10000 }], pel: [{ v: 'KK-16-02-00002', ref: '', tgl: '2/10/2016 8:59:01 AM', kas: 'Kas Besar', cek: '', bayar: 21780, pot: 0, ket: '' }], hutang: 21780 },
  { no: 'BLI-16-02-00002', tgl: '10 Feb 2016  08:55:39', sup: 'AGUNG LANGGENG', kode: 'SS28', lok: 'SURABAYA', alamat: 'SURABAYA', jangka: 'T21', tipe: 'UANG MUKA', po: 'P-16-02-00001', poRef: 'R-25/07', terima: '', terimaRef: '', gudang: 'TOKO', ref: '', dv: '', ppn: 'PPN0', ket: '', status: 'NEW', ro: false, lines: [{ i: -1, q: 1, p: 10000 }], um: [], pel: [], hutang: 10000 },
]
const UM_NAME = 'UANG MUKA'
const FS = { i: 0, draft: null, line: 0 }
const fkCur = () => FS.draft || FK[FS.i]
const lineName = l => l.i < 0 ? UM_NAME : ITEMS[l.i].name
const lineUnit = l => l.i < 0 ? '' : ITEMS[l.i].u
const lineKode = l => l.i < 0 ? '' : ITEMS[l.i].kode
const umSisa = f => sum7(FK.filter(x => x.kode === f.kode && x.tipe === 'UANG MUKA'), x => x.lines[0].p) - sum7(FK, x => sum7(x.um.filter(u => FK.some(y => y.no === u.no && y.kode === f.kode)), u => u.applied))
const acctLine = f => f.tipe === 'UANG MUKA' ? 'Uang Muka Pembelian' : f.tipe === 'MATCHING' && f.terima ? '202101 - Utang Suspend' : '102101 - Persediaan Barang'
const fkNo = () => 'BLI-26-10-' + String(1 + FK.length).padStart(5, '0')
function newFk() {
  FS.draft = { no: fkNo(), tgl: d7('2026-10-27', '09:00:00'), sup: SUPS[0][0], kode: SUPS[0][1], lok: 'SURABAYA', alamat: 'SURABAYA', jangka: 'T21', tipe: 'STANDARD', po: '', poRef: '', terima: '', terimaRef: '', gudang: 'TOKO', ref: '', dv: '', ppn: 'PPN0', ket: '', status: 'NEW', ro: false, dirty: false, lines: [], um: [], pel: [], hutang: 0 }
  FS.line = 0
}
window.b7Nav = w => {
  FS.draft = null
  FS.i = w === 'first' ? 0 : w === 'last' ? FK.length - 1 : w === 'next' ? Math.min(FK.length - 1, FS.i + 1) : Math.max(0, FS.i - 1)
  FS.line = 0; render()
}
window.b7New = () => { newFk(); T7.inv = 'det'; render() }
window.b7F = (k, v) => {
  const f = fkCur(); f.dirty = true
  if (k === 'sup') { const s = SUPS.find(x => x[1] === v); f.sup = s[0]; f.kode = s[1]; f.po = ''; f.poRef = ''; f.terima = ''; f.lines = f.tipe === 'UANG MUKA' ? [{ i: -1, q: 1, p: 0 }] : [] }
  else if (k === 'tipe') { f.tipe = v; f.po = ''; f.poRef = ''; f.terima = ''; f.lines = v === 'UANG MUKA' ? [{ i: -1, q: 1, p: 0 }] : []; if (v === 'UANG MUKA') f.ppn = 'PPN0' }
  else if (k === 'po') { const p = (PO_OF[f.kode] || []).find(x => x.no === v); f.po = v; if (p) { f.poRef = p.ref; f.ppn = p.ppn; f.gudang = p.gudang; f.terima = p.terima[0] || ''; if (f.tipe === 'MATCHING') f.lines = mkLines(p.items) } else { f.poRef = ''; f.terima = '' } }
  else if (k === 'tgl') f.tgl = v
  else f[k] = v
  render()
}
window.b7L = (i, k, v) => {
  const f = fkCur(), l = f.lines[i]; f.dirty = true
  if (k === 'item') { const ix = +v; l.i = ix; l.p = ITEMS[ix].p } else l[k] = Math.max(0, parseFloat(String(v).replace(/,/g, '')) || 0)
  render()
}
window.b7Add = () => { const f = fkCur(); if (f.ro || f.tipe === 'UANG MUKA') return; f.dirty = true; f.lines.push({ i: 0, q: 1, p: ITEMS[0].p }); FS.line = f.lines.length - 1; render() }
window.b7Del = () => { const f = fkCur(); if (f.ro) return; f.lines.splice(FS.line, 1); FS.line = 0; f.dirty = true; render() }
window.b7DelAll = () => { const f = fkCur(); if (f.ro) return; f.lines = []; f.dirty = true; render() }
window.b7Line = i => { FS.line = i; render() }
window.b7Exp = i => { (FS.exp = FS.exp || {})[i] = !(i in FS.exp ? FS.exp[i] : i === 1); render() }
window.b7Stok = () => openSheet({ title: 'INFO STOK dan KONVERSI', size: 'wide', body: `<div class="two"><div><h3 class="ds-section-title" style="text-align:center;margin-bottom:12px">STOK GUDANG</h3>${grid({ cols: [{ l: 'GUDANG', k: 'g', w: 160 }, { l: 'STOK', k: 's', w: 120, num: 1 }], rows: [['TOKO', 221.1], ['Bad Stok', 0], ['cc', 0], ['Gudang1', 4], ['GUDANG2', 0], ['kkk', 0]].map(([g, s]) => ({ c: { g, s: n7(s) } })) })}</div><div><h3 class="ds-section-title" style="text-align:center;margin-bottom:12px">KONVERSI</h3>${grid({ cols: [{ l: 'SATUAN', k: 'u', w: 140 }, { l: 'JUMLAH', k: 'j', w: 160, num: 1 }], rows: [['UNIT', '1'], ['PAK', '0.10000'], ['GROSS', '144.00000'], ['KARTON', '1900.00000']].map(([u, j]) => ({ c: { u, j } })) })}</div></div>`, foot: btn('Close', 'closeSheet()') })
window.b7Hist = i => { const f = fkCur(), l = f.lines[i]; openSheet({ title: '7 HISTORY HARGA TRANSAKSI', size: 'wide', body: grid({ cols: [{ l: 'NO FAKTUR', k: 'n', w: 150 }, { l: 'TANGGAL', k: 't', w: 190 }, { l: 'JML', k: 'j', w: 80, num: 1 }, { l: 'SAT', k: 's', w: 70 }, { l: 'HARGA', k: 'h', w: 110, num: 1 }, { l: 'DISKON 1', k: 'd1', w: 100, num: 1 }, { l: 'DISKON %', k: 'dp', w: 100 }, { l: 'DISKON 2', k: 'd2', w: 100, num: 1 }, { l: 'HARGA AKHIR', k: 'a', w: 120, num: 1 }], rows: [{ c: { n: `<span style="color:var(--accent)">${f.no}</span>`, t: f.tgl, j: n7(l.q), s: lineUnit(l), h: n7(l.p), d1: '0.00', dp: '', d2: '0.00', a: n7(l.p) } }] }), foot: btn('Close', 'closeSheet()') }) }
window.b7Apply = () => {
  const f = fkCur(), ums = FK.filter(x => x.kode === f.kode && x.tipe === 'UANG MUKA' && x.no !== f.no)
  const used = no => sum7(FK, x => sum7(x.um.filter(u => u.no === no), u => u.applied))
  openSheet({ crumb: ['Faktur Pembelian', f.no], title: 'Apply Uang Muka', size: 'wide', body: grid({ cols: [{ l: 'NO FAKTUR', k: 'n', w: 180 }, { l: 'TANGGAL', k: 't', w: 180 }, { l: 'NO REFF', k: 'r', w: 120 }, { l: 'TOTAL', k: 'a', w: 130, num: 1 }, { l: 'UANG MUKA YG DIAPPLY', k: 'p', w: 170, num: 1 }, { l: 'SISA', k: 's', w: 130, num: 1 }], rows: ums.map(u => ({ c: { n: u.no, t: u.tgl, r: '', a: n7(u.lines[0].p), p: n7(used(u.no)), s: n7(u.lines[0].p - used(u.no)) } })), empty: '' }) })
}
function renderInvoice7() {
  const f = fkCur(), N = FK.length + (FS.draft ? 1 : 0), no = FS.draft ? N : FS.i + 1
  const c = calc7(f.lines, f.ppn), um = sum7(f.um, u => u.applied)
  const ro = f.ro, isUM = f.tipe === 'UANG MUKA', isM = f.tipe === 'MATCHING'
  const sline = f.lines[FS.line] || f.lines[0]
  const pos = PO_OF[f.kode] || []
  const t = T7.inv
  const toolbar = tb([['First', "b7Nav('first')", !FS.draft && FS.i === 0], ['Prior', "b7Nav('prior')", !FS.draft && FS.i === 0], ['Next', "b7Nav('next')", !FS.draft && FS.i === FK.length - 1], ['Last', "b7Nav('last')", !FS.draft && FS.i === FK.length - 1], ['New', 'b7New()'], ['Del', "toastNo7('Del')", ro], ['Filter', "toastNo7('Filter')"], ['Refresh', 'render()'], ['Cash', "toastNo7('Cash')"], ['Pay', "toastNo7('Pay')"], ['Save', "toastNo7('Save')", !f.dirty], ['Undo', 'newFk7()', !f.dirty], ['View', "toastNo7('View')"], ['Print', "toastNo7('Print')"], ['Info', "toastNo7('Info')"], ['DBF', "toastNo7('DBF')"], ['Import', "toastNo7('Import')"]])
  const fields = `<div class="b7-f"><div>
    ${row7('NO FAKTUR', `<div style="flex:1;min-width:0">${inp7(f.no, null, { ro: 1 })}</div><span class="m">TANGGAL</span><div style="flex:1.4;min-width:0">${inp7(f.tgl, "b7F('tgl',this.value)", { ro })}</div>`)}
    ${row7('SUPPLIER*', `<div style="flex:1.6;min-width:0">${sel7(SUPS.map(s => [s[1], s[0]]), f.kode, "b7F('sup',this.value)", ro || !FS.draft)}</div><div style="flex:1;min-width:0">${inp7(f.kode, null, { ro: 1 })}</div>`)}
    ${row7('LOKASI', inp7(f.lok, null, { ro: 1 }))}
    ${row7('', `<textarea class="b7in" readonly tabindex="-1">${esc(f.alamat)}</textarea>`)}
    ${row7('JANGKA WAKTU', `<div style="flex:1;min-width:0">${sel7(['T21'], f.jangka, '', true)}</div><span class="m">J.TEMPO</span><div style="flex:1.4;min-width:0">${inp7(jtempo(f.tgl, f.jangka), null, { ro: 1 })}</div>`)}
  </div><div>
    ${row7('TIPE INVOICE', `<div style="flex:1">${sel7(['MATCHING', 'STANDARD', 'UANG MUKA'], f.tipe, "b7F('tipe',this.value)", ro || !FS.draft)}</div>`)}
    ${row7('NO PO', `<div style="flex:1;min-width:0">${sel7([['', ''], ...pos.map(p => [p.no, p.no])], f.po, "b7F('po',this.value)", ro || !(isM || isUM) || !FS.draft)}</div><div style="flex:1;min-width:0">${inp7(f.poRef, null, { ro: 1 })}</div>`)}
    ${row7('NO TERIMA', `<div style="flex:1;min-width:0">${inp7(isM ? f.terima : '', null, { ro: 1 })}</div><div style="flex:1;min-width:0">${inp7(f.terimaRef, null, { ro: 1 })}</div>`)}
    ${row7('GUDANG', sel7(GUDANGS, f.gudang, "b7F('gudang',this.value)", ro))}
    ${row7('NO REF', inp7(f.ref, "b7F('ref',this.value)", { ro }))}
    ${row7('TOTAL DISKON', `<div style="flex:1;min-width:0">${inp7(f.dv, "b7F('dv',this.value)", { ro })}</div><span class="eq">% =</span><div style="flex:1.4;min-width:0">${inp7('0.00', null, { ro: 1, r: 1 })}</div>`)}
    ${row7('PPN', `<div style="flex:1">${sel7(PPNS, f.ppn, "b7F('ppn',this.value)", ro || isUM)}</div><span class="m">${ppnPct(f.ppn)} %</span>`)}
    ${row7('KETERANGAN', inp7(f.ket, "b7F('ket',this.value)", { ro }))}
  </div></div>`
  const subbar = sub([['Del All', 'b7DelAll()', ro], ['Browse Item', 'b7Add()', ro || isUM], ['Apply Uang Muka', 'b7Apply()', ro || isUM], ...(ro ? [] : [['+', 'b7Add()', isUM], ['−', 'b7Del()']])])
  const lineRows = f.lines.map((l, i) => ({ sel: i === FS.line, on: `b7Line(${i})`, c: {
    n: !ro && !isUM && !isM ? sel7(ITEMS.map((x, ix) => [ix, x.name]), l.i, `b7L(${i},'item',this.value)`) : `<span oncontextmenu="event.preventDefault();b7Line(${i});b7Stok()">${esc(lineName(l))}</span>`,
    q: isUM ? n7(l.q) : inp7(n7(l.q), `b7L(${i},'q',this.value)`, { r: 1, ro: ro }),
    u: lineUnit(l),
    h: `<span oncontextmenu="event.preventDefault();b7Hist(${i})">${isUM ? inp7(n7(l.p), `b7L(${i},'p',this.value)`, { r: 1, ro }) : isM || ro ? n7(l.p) : inp7(n7(l.p), `b7L(${i},'p',this.value)`, { r: 1 })}</span>`,
    t: n7(l.q * l.p) } }))
  let tab
  if (t === 'um') tab = grid({ cols: [{ l: 'NO FAKTUR', k: 'n', w: 200 }, { l: 'TANGGAL', k: 't', w: 190 }, { l: 'NO REFF', k: 'r', w: 160 }, { l: 'TOTAL', k: 'a', w: 130, num: 1 }, { l: 'UANG MUKA<br>YG DIAPPLY', k: 'p', w: 150, num: 1 }, { l: 'SISA', k: 's', w: 130, num: 1 }], rows: f.um.map(u => ({ c: { n: u.no, t: u.tgl, r: u.ref, a: n7(u.total), p: n7(u.applied), s: n7(u.total - u.applied) } })) })
  else if (t === 'pel') tab = grid({ cols: [{ l: 'VOUCHER', k: 'v', w: 160 }, { l: 'NO REFF', k: 'r', w: 100 }, { l: 'TANGGAL', k: 't', w: 190 }, { l: 'KAS/BANK', k: 'k', w: 130 }, { l: 'NO CEK/BG', k: 'c', w: 110 }, { l: 'BAYAR', k: 'b', w: 120, num: 1 }, { l: 'POTONGAN', k: 'p', w: 110, num: 1 }, { l: 'KETERANGAN', k: 'x', w: 140 }], rows: f.pel.map(p => ({ c: { v: p.v, r: p.ref, t: p.tgl, k: p.kas, c: p.cek, b: n7(p.bayar), p: n7(p.pot), x: p.ket } })) }) +
    `<div class="b7-sum"><label>TOTAL HUTANG ${inp7(sp(f.pel.length ? f.hutang : 0), null, { ro: 1, r: 1 })}</label><label>TOTAL BAYAR ${inp7(sp(sum7(f.pel, p => p.bayar)), null, { ro: 1, r: 1 })}</label><label>SISA ${inp7(String(Math.max(0, (f.pel.length ? f.hutang : 0) - sum7(f.pel, p => p.bayar))), null, { ro: 1, r: 1 })}</label></div>`
  else if (t === 'pbi') {
    const rows = []
    f.lines.forEach((l, i) => {
      const open = FS.exp && i in FS.exp ? FS.exp[i] : i === 1
      rows.push({ c: { x: `<button type="button" class="ib" style="width:24px;height:24px;border:0;background:none;color:var(--ink)" aria-label="Detail" onclick="b7Exp(${i})">${open ? '−' : '+'}</button>`, n: esc(lineName(l)), k: lineKode(l), s: lineUnit(l), qp: n7(l.q), qb: n7(isM && f.terima ? l.q : 0), qi: n7(l.q), sp: '0.00', sb: '0.00', r: '0.00' } })
      if (open) rows.push({ span: `<div style="display:flex;gap:28px;flex-wrap:wrap;padding-left:36px"><span><b>BPB</b> ${isM && f.terima ? `${f.terima} · ${d7(iso7(f.tgl))} · ${n7(l.q)} ${lineUnit(l)}` : '—'}</span><span><b>INVOICE</b> ${f.no} · ${d7(iso7(f.tgl))} · ${n7(l.q)} ${lineUnit(l)}</span><span><b>RETUR</b> —</span></div>` })
    })
    tab = grid({ cols: [{ l: '', k: 'x', w: 36 }, { l: 'NAMA ITEM', k: 'n', w: 280 }, { l: 'KODE ITEM', k: 'k', w: 130 }, { l: 'SATUAN', k: 's', w: 90 }, { g: 'QTY', l: 'PO', k: 'qp', w: 90, num: 1 }, { g: 'QTY', l: 'BPB', k: 'qb', w: 90, num: 1 }, { g: 'QTY', l: 'INVOICE', k: 'qi', w: 100, num: 1 }, { g: 'SISA', l: 'PO', k: 'sp', w: 80, num: 1 }, { g: 'SISA', l: 'BPB', k: 'sb', w: 80, num: 1 }, { l: 'RETUR', k: 'r', w: 90, num: 1 }], rows })
    // nested rows span: replace the single cell of detail rows
  } else tab = grid({ cols: [{ l: 'NAMA ITEM*', k: 'n', w: 320 }, { l: 'JML', k: 'q', w: 110, num: 1 }, { l: 'SATUAN', k: 'u', w: 100 }, { l: 'HARGA', k: 'h', w: 140, num: 1 }, { l: 'TOTAL', k: 't', w: 150, num: 1 }], rows: lineRows, empty: '' })
  const tabNames = [['det', `Detail ${f.lines.length ? FS.line + 1 : 0} of ${f.lines.length}`], ['um', 'Uang Muka'], ['pel', 'Pelunasan'], ['pbi', 'PO-BPB-INVOICE']]
  const base = head7('Faktur Pembelian') + `<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:16px">${toolbar}<div style="display:flex;gap:8px;align-items:center"><div class="b7-st"><b>${f.status}</b><span>${no} of ${N}</span></div>${ro ? '<div class="b7-ro">READ ONLY</div>' : ''}</div></div>` + fields +
    subbar + tabs7('inv', tabNames) + tab +
    `<div class="b7-foot"><div class="acc">${sline ? `${lineKode(sline) ? lineKode(sline) + ' - ' : ''}${esc(lineName(sline))}<br>` : ''}${acctLine(f)}</div><div class="b7-tot"><span>TOTAL</span><b>${n7(c.total)}</b><span>PPN</span><b>${n7(c.tax)}</b><span>GRAND TOTAL</span><b>${n7(c.grand)}</b></div></div>` +
    `<div class="b7-bar"><span>SISA UANG MUKA : Rp ${n7(umSisa(f), 0)}</span><span>${ro ? 'READ ONLY' : ''}</span></div>`
  return base
}
window.toastNo7 = w => toast(w, 'Prototipe: tidak ada yang disimpan')
window.newFk7 = () => { FS.draft ? newFk() : null; render() }
reg7({ id: 'buy-invoice', manual: 'Manual hal. 121–127 · Faktur / Invoice Pembelian (cases 1.1–1.7, 1.15)', render: renderInvoice7 })

/* ═════════ Retur Beli ═════════ */
const RB = [
  { no: 'RB-07-09-00003', tgl: '23 Aug 2007  12:07:24', sup: 'MSC', kode: 'SS03', lok: 'SURABAYA', alamat: 'SURABAYA', jangka: 'T21', tipe: 'MATCHING', po: 'PO-NO07-08-00065', poRef: 'T-02.07', terima: '', gudang: 'Gudang1', ref: 'D-1917.07', dv: '', ppn: 'PPN0', ket: '', status: 'LUNAS', ro: true,
    lines: [{ acc: '102101', accName: 'Persediaan Barang', i: 3, q: 30, p: 235000 }], pel: [{ v: 'KK-07-11-00090', ref: '', tgl: '11/1/2007', kas: 'Kas Besar', cek: '', hutang: -7050000, bayar: -7050000, pot: 0, sisa: 0, ket: '' }] },
]
const RS = { i: 0, draft: null, line: 0 }
const rbCur = () => RS.draft || RB[RS.i]
const rbCalc = f => calc7(f.lines, f.ppn)
function newRb() { RS.draft = { no: 'RB-26-10-00001', tgl: d7('2026-10-27', '09:00:00'), sup: SUPS[0][0], kode: SUPS[0][1], lok: 'SURABAYA', alamat: 'SURABAYA', jangka: 'T21', tipe: 'MATCHING', po: '', poRef: '', terima: '', gudang: 'TOKO', ref: '', dv: '', ppn: 'PPN0', ket: '', status: 'NEW', ro: false, dirty: false, lines: [], pel: [] }; RS.line = 0 }
window.b7RNav = w => { RS.draft = null; RS.i = 0; render() }
window.b7RNew = () => { newRb(); T7.ret = 'det'; render() }
window.b7RF = (k, v) => {
  const f = rbCur(); f.dirty = true
  if (k === 'sup') { const s = SUPS.find(x => x[1] === v); f.sup = s[0]; f.kode = s[1]; f.po = ''; f.poRef = ''; f.lines = [] }
  else if (k === 'po') { const p = (PO_OF[f.kode] || []).find(x => x.no === v); f.po = v; f.lines = []; if (p) { f.poRef = p.ref; f.ppn = p.ppn; f.gudang = p.gudang; f.lines = p.items.map(([i, q]) => ({ acc: '102101', accName: 'Persediaan Barang', i, q, p: ITEMS[i].p })) } else f.poRef = '' }
  else f[k] = v
  render()
}
window.b7RL = (i, v) => { const f = rbCur(); f.dirty = true; const max = f.lines[i].max ?? (f.lines[i].max = f.lines[i].q); f.lines[i].q = Math.min(max, Math.max(0, parseFloat(String(v).replace(/,/g, '')) || 0)); render() }
window.b7RLine = i => { RS.line = i; render() }
window.b7RDel = () => { const f = rbCur(); if (f.ro) return; f.lines.splice(RS.line, 1); RS.line = 0; f.dirty = true; render() }
window.b7RDelAll = () => { const f = rbCur(); if (f.ro) return; f.lines = []; f.dirty = true; render() }
function renderReturn7() {
  const f = rbCur(), N = RB.length + (RS.draft ? 1 : 0), no = RS.draft ? N : RS.i + 1, c = rbCalc(f), ro = f.ro, t = T7.ret
  const pos = PO_OF[f.kode] || [], sline = f.lines[RS.line] || f.lines[0]
  const toolbar = tb([['First', "b7RNav('first')", !RS.draft && RS.i === 0], ['Prior', "b7RNav('prior')", !RS.draft && RS.i === 0], ['Next', "b7RNav('next')", !RS.draft], ['Last', "b7RNav('last')", !RS.draft], ['New', 'b7RNew()'], ['Del', "toastNo7('Del')", ro], ['Filter', "toastNo7('Filter')"], ['Refresh', 'render()'], ['Cash', "toastNo7('Cash')"], ['Pay', "toastNo7('Pay')"], ['Save', "toastNo7('Save')", !f.dirty], ['Undo', 'b7RUndo()', !f.dirty], ['View', "toastNo7('View')"], ['Print', "toastNo7('Print')"], ['Info', "toastNo7('Info')"], ['DBF', "toastNo7('DBF')"]])
  const fields = `<div class="b7-f"><div>
    ${row7('NO FAKTUR', `<div style="flex:1;min-width:0">${inp7(f.no, null, { ro: 1 })}</div><span class="m">TANGGAL</span><div style="flex:1.4;min-width:0">${inp7(f.tgl, "b7RF('tgl',this.value)", { ro })}</div>`)}
    ${row7('SUPPLIER*', `<div style="flex:1.6;min-width:0">${sel7(SUPS.map(s => [s[1], s[0]]), f.kode, "b7RF('sup',this.value)", ro || !RS.draft)}</div><div style="flex:1;min-width:0">${inp7(f.kode, null, { ro: 1 })}</div>`)}
    ${row7('LOKASI', inp7(f.lok, null, { ro: 1 }))}
    ${row7('', `<textarea class="b7in" readonly tabindex="-1">${esc(f.alamat)}</textarea>`)}
    ${row7('JANGKA WAKTU', `<div style="flex:1;min-width:0">${sel7(['T21'], f.jangka, '', true)}</div><span class="m">J.TEMPO</span><div style="flex:1.4;min-width:0">${inp7(jtempo(f.tgl, f.jangka), null, { ro: 1 })}</div>`)}
  </div><div>
    ${row7('TIPE INVOICE', `<div style="flex:1">${sel7(['MATCHING'], f.tipe, '', true)}</div>`)}
    ${row7('NO PO', `<div style="flex:1;min-width:0">${sel7([['', ''], ...pos.map(p => [p.no, p.no]), ...(ro ? [[f.po, f.po]] : [])], f.po, "b7RF('po',this.value)", ro || !RS.draft)}</div><div style="flex:1;min-width:0">${inp7(f.poRef, null, { ro: 1 })}</div>`)}
    ${row7('NO TERIMA', `<div style="flex:1;min-width:0">${inp7(f.terima, null, { ro: 1 })}</div><div style="flex:1;min-width:0">${inp7('', null, { ro: 1 })}</div>`)}
    ${row7('GUDANG', sel7(GUDANGS, f.gudang, "b7RF('gudang',this.value)", ro))}
    ${row7('NO REF', inp7(f.ref, "b7RF('ref',this.value)", { ro }))}
    ${row7('TOTAL DISKON', `<div style="flex:1;min-width:0">${inp7(f.dv, "b7RF('dv',this.value)", { ro })}</div><span class="eq">% =</span><div style="flex:1.4;min-width:0">${inp7('0.00', null, { ro: 1, r: 1 })}</div>`)}
    ${row7('PPN', `<div style="flex:1">${sel7(PPNS, f.ppn, "b7RF('ppn',this.value)", ro)}</div><span class="m">${ppnPct(f.ppn)} %</span>`)}
    ${row7('KETERANGAN', inp7(f.ket, "b7RF('ket',this.value)", { ro }))}
  </div></div>`
  const subbar = sub([['Del All', 'b7RDelAll()', ro], ['Browse Item', "toastNo7('Browse Item')", true]])
  const detail = grid({ cols: [{ l: 'KODE ACC', k: 'a', w: 100 }, { l: 'NAMA ACCOUNT', k: 'an', w: 160 }, { l: 'NAMA ITEM*', k: 'n', w: 200 }, { l: 'KODE IT..', k: 'k', w: 110 }, { l: 'JML', k: 'q', w: 90, num: 1 }, { l: 'SATUAN', k: 'u', w: 90 }, { l: 'HARGA', k: 'h', w: 120, num: 1 }, { g: 'DISKON', l: 'RP', k: 'dr', w: 80, num: 1 }, { g: 'DISKON', l: '%', k: 'dp', w: 70 }, { l: 'SUBTOTAL', k: 's', w: 130, num: 1 }, { l: 'KETERANGAN', k: 'x', w: 120 }], rows: f.lines.map((l, i) => ({ sel: i === RS.line, on: `b7RLine(${i})`, c: { a: l.acc, an: l.accName, n: esc(ITEMS[l.i].name), k: ITEMS[l.i].kode, q: ro ? n7(l.q) : inp7(n7(l.q), `b7RL(${i},this.value)`, { r: 1 }), u: ITEMS[l.i].u, h: n7(l.p), dr: '0.00', dp: '', s: n7(l.q * l.p), x: '' } })) })
  const pel = grid({ cols: [{ l: 'VOUCHER', k: 'v', w: 150 }, { l: 'NO REFF', k: 'r', w: 100 }, { l: 'TANGGAL', k: 't', w: 130 }, { l: 'KAS/BANK', k: 'k', w: 130 }, { l: 'NO CEK/BG', k: 'c', w: 110 }, { l: 'HUTANG', k: 'h', w: 140, num: 1 }, { l: 'BAYAR', k: 'b', w: 140, num: 1 }, { l: 'POTONGAN', k: 'p', w: 110, num: 1 }, { l: 'SISA', k: 's', w: 100, num: 1 }, { l: 'KETERANGAN', k: 'x', w: 130 }], rows: f.pel.map(p => ({ c: { v: p.v, r: p.ref, t: p.tgl, k: p.kas, c: p.cek, h: n7(p.hutang), b: n7(p.bayar), p: n7(p.pot), s: n7(p.sisa), x: p.ket } })) }) +
    `<div class="b7-sum"><label>TOTAL HUTANG ${inp7(sp(sum7(f.pel, p => p.hutang)), null, { ro: 1, r: 1 })}</label><label>TOTAL BAYAR ${inp7(sp(sum7(f.pel, p => p.bayar)), null, { ro: 1, r: 1 })}</label><label>SISA ${inp7(String(sum7(f.pel, p => p.sisa)), null, { ro: 1, r: 1 })}</label></div>`
  return head7('Retur Beli') + `<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:16px">${toolbar}<div style="display:flex;gap:8px;align-items:center"><div class="b7-st"><b>${f.status}</b><span>${no} of ${N}</span></div>${ro ? '<div class="b7-ro">READ ONLY</div>' : ''}</div></div>` + fields + subbar +
    tabs7('ret', [['det', `Detail ${f.lines.length ? RS.line + 1 : 0} of ${f.lines.length}`], ['pel', 'Pelunasan']]) + (t === 'pel' ? pel : detail) +
    `<div class="b7-foot"><div class="acc">${sline ? `${ITEMS[sline.i].kode} - ${esc(ITEMS[sline.i].name)}<br>${sline.acc} - ${sline.accName}` : ''}</div><div class="b7-tot"><span>TOTAL</span><b>${n7(c.total)}</b><span>PPN</span><b>${n7(c.tax)}</b><span>GRAND TOTAL</span><b>${n7(c.grand)}</b></div></div>` +
    `<div class="b7-bar"><span>SISA UANG MUKA : Rp 0</span><span>${ro ? 'READ ONLY' : ''}</span></div>`
}
window.b7RUndo = () => { RS.draft ? newRb() : null; render() }
reg7({ id: 'buy-return', manual: 'Manual hal. 128–131 · Invoice Retur Beli (cases 1.5)', render: renderReturn7 })

/* ═════════ Info Pembelian ═════════ */
const SUP_ROWS = [
  ['1210', 'abc', 'Surabaya', 'Rungkut', '', '', '', 500000000, 1], ['A001', 'FUJIAN', 'SBY', 'RAYA BUKIT DARMO 35', '', '', '', 500000000, 1], ['ADDD', 'AFAT', 'D', 'D', '', '', '', 500, 1],
  ['S105', 'MURAH MURAH', 'SURABAYA', 'BREBEK INDUSTRI I/', '8476502', '', '', null, 1], ['S106', 'SUKA SUMBER', 'SURABAYA', 'JL ARIEF RAHMAN HAKIM  (KLAMPIS', '0315929040', '', 'jj', 500000000, 1],
  ['SA01', 'LANGGENG KARYA', 'SURABAYA', 'SURABAYA', '', '', '', 0, 1], ['SA02', 'LANGGENG RAYA', 'SURABAYA', 'JL.NGAGEL JY SELATAN 161', '', '', '', 0, 1], ['SA03', 'LANGGENG KENCANA', 'SURABAYA', 'NGAGEL JAYA', '', '', '', 0, 1],
  ['SA04', 'AGUNG METAL', 'SURABAYA', 'JL DUPAK NO 61 H-61 I', '', '', '', 0, 1], ['SA06', 'LANGGENG PT', 'SURABAYA', 'SURABAYA', '', '', '', 0, 1], ['SA07', 'LANGGENG METAL', 'SURABAYA', 'SURABAYA', '', '', '', 0, 1],
  ['Sasdfa', 'PC MULYO', 'asd', 'asdas', '', '', '', 500000000, 0], ['SB00', 'BIMAK', 'SURABAYA', 'SURABAYA', '', '', '', 0, 1], ['SB01', 'BINA USAHA', 'SURABAYA', 'JL KALI RUNGKUT', '', '', '', 0, 1],
  ['SB02', 'LANGGENG JAYA', 'SURABAYA', 'SURABAYA', '', '', '', 0, 1], ['SB03', 'LANGGENG ECERAN', 'SURABAYA', 'SURABAYA', '', '', '', 0, 1], ['SB04', 'LANGGENG MAS', 'SURABAYA', 'SURABAYA', '', '', '', 0, 1],
  ['SB05', 'BETA KOMP', 'SURABAYA', 'SURABAYA', '', '', '', 0, 0], ['SB06', 'LANGGENG MARGO  (WO)', 'SURABAYA', 'SURABAYA', '', '', '', 0, 1], ['SB07', 'SYUKUR INDAH', 'SURABAYA', 'GUNUNG ANYAR 26', '', '', '', 0, 1],
  ['SB08', 'LANGGENG TIMUR', 'SURABAYA', 'SURABAYA', '', '', '', 0, 1], ['SB09', 'AGUNG PUTRA', 'SURABAYA', 'SURABAYA', '', '', '', 0, 1], ['SB10', 'AGUNG KARYA', 'SURABAYA', 'SURABAYA', '', '', '', 0, 1],
  ['SB11', 'AGUNG MANDIRI (0318783801)', 'SURABAYA', 'JL RAYA KALIRUNGKUT 139', '', '', '', 0, 1], ['SB12', 'AGUNG SEJAHTERA MANDIRI', 'SURABAYA', 'SURABAYA', '', '', '', 0, 1], ['SBIN', 'LANGGENG JAYA', 'SURABAYA', 'SURABAYA', '', '', '', 0, 1],
]
const PO_ROWS = [
  ['17 Jan 2008', 'PO-08-01-00001', '', 'NEW', '1/17/2008', 'MAKMUR PC', 'SURABAYA', 'cc', 'PPN0', 3000, 'T21'], ['02 May 2009', 'PO-09-05-00001', '', 'PARTIAL', '5/2/2009 12:28:1', 'MAKMUR PC', 'SURABAYA', 'Gudang1', 'PPN10', 306262, 'T21'],
  ['16 Dec 2008', 'PO-08-12-00002', '', 'NEW', '12/16/2008', 'JAKARTA KOMPUTER', 'SURABAYA', 'Gudang1', 'PPN0', 0, 'T21'], ['16 Dec 2008', 'PO-08-12-00001', '', 'NEW', '12/16/2008', 'MAKMUR PC', 'SURABAYA', 'Gudang1', 'PPN0', 6000000, 'T21'],
  ['23 Jan 2008', 'PO-08-01-00002', '', 'NEW', '1/23/2008', 'BANDUNG KOMPUTER', 'SURABAYA', 'Gudang1', 'PPN0', 10000, 'T21'], ['12 Nov 2007', 'PO-NO07-11-00058', 'V-18/09/07/OUT.1', 'PARTIAL', '11/13/2007', 'SUMBER KOMPUTER', 'SURABAYA', 'Gudang1', 'PPN0', 11685123, 'T21'],
  ['14 Sep 2007', 'PO-NO07-09-00026', 'U-05', 'PARTIAL', '9/15/2007', 'LANGGENG BERKAT STEEL', 'SURABAYA', 'Gudang1', 'PPN0', 93343000, 'T21'], ['06 Sep 2007', 'PO-NO07-09-00013', 'U-01/IX/07', 'PARTIAL', '9/7/2007', 'AGUNG KARYA', 'SURABAYA', 'Gudang1', 'PPN0', 9251053200, 'T21'],
  ['04 Sep 2007', 'PO-NO07-09-00005', 'T-34.09.07', 'PARTIAL', '9/5/2007', 'SUMBER KOMPUTER', 'SURABAYA', 'Gudang1', 'PPN0', 521085000, 'T21'], ['15 Aug 2007', 'PO-NO07-08-00101', 'S-21/07', 'NEW', '8/25/2007', 'LANGGENG KUMPUL', 'SURABAYA', 'Gudang1', 'PPN0', 13861188, 'T21'],
  ['13 Aug 2007', 'PO-NO07-08-00043', 'S-20/VIII/07', 'PARTIAL', '8/14/2007', 'SUMBER KOMPUTER', 'SURABAYA', 'Gudang1', 'PPN0', 143733302, 'T21'], ['10 Aug 2007', 'PO-NO07-08-00039', 'S-13/07', 'PARTIAL', '8/13/2007', 'SUMBER KOMPUTER', 'SURABAYA', 'Gudang1', 'PPN0', 142322976, 'T21'],
  ['02 Aug 2007', 'PO-NO07-08-00044', 'R38/VIII', 'NEW', '8/14/2007', 'AGUNG KARYA', 'SURABAYA', 'Gudang1', 'PPN0', 115931750, 'T21'], ['06 Sep 2007', 'PO-NO07-09-00010', 'T-33/VIII/07', 'PARTIAL', '9/7/2007', 'DAMAI SAJA', 'SURABAYA', 'GUDANG2', 'PPN0', 57000000, 'T21'],
  ['03 Sep 2007', 'PO-NO07-09-00004', 'T-32/08/07', 'PARTIAL', '9/4/2007', 'LANGGENG BERKAT STEEL', 'SURABAYA', 'GUDANG2', 'PPN0', 31737500, 'T21'], ['10 Aug 2007', 'PO-NO07-08-00098', 'S-08/07', 'NEW', '8/25/2007', 'MSC', 'SURABAYA', 'GUDANG2', 'PPN0', 7865000, 'T21'],
  ['03 Nov 2015', 'P-15-11-00001', '', 'NEW', '11/3/2015 10:04', 'AGUNG KARYA', 'SURABAYA', 'TOKO', 'PPN10', 0, 'T21'], ['26 Aug 2014', 'PO-260814001', '', 'NEW', '8/26/2014 10:14', 'GTC', 'SURABAYA', 'TOKO', 'PPN10', 46750, 'T21'],
  ['14 May 2014', 'PO-14-05-00001', '', 'PARTIAL', '5/14/2014 11:40', 'DAMAI SAJA', 'SURABAYA', 'TOKO', 'PPN10', 77000000, 'T21'], ['08 Jul 2013', 'PO-13-07-00004', '', 'NEW', '7/8/2013 2:52:06', 'AFAT', 'D', 'TOKO', 'PPN10', 36666.3, 'T21'],
  ['08 Jul 2013', 'PO-13-07-00003', '', 'NEW', '7/8/2013 2:49:43', 'AFAT', 'D', 'TOKO', 'PPN10', 73332.6, 'T21'], ['08 Jul 2013', 'PO-13-07-00002', '', 'NEW', '7/8/2013 2:49:18', 'AFAT', 'D', 'TOKO', 'PPN10', 36666.3, 'T21'],
  ['26 Mar 2013', 'PO-13-03-00001', '', 'NEW', '3/26/2013 3:01:4', 'AGUNG BARU', 'SURABAYA', 'TOKO', 'PPN10', 0, 'T21'], ['02 Nov 2012', 'P-12-11-00001', '', 'NEW', '11/2/2012 1:00:3', 'MURAH MURAH', 'SURABAYA', 'TOKO', 'PPN10', 7858.4, 'T21'],
  ['23 Jan 2010', 'PO-10-01-00001', '', 'PARTIAL', '1/23/2010 4:34:1', 'KURNIA MULYO', 'SURABAYA', 'TOKO', 'PPN10', 7990400, 'T21'],
]
const PEM_ROWS = [
  ['21 Jul 2007', '6538', 'LUNAS', 'ST02', 'LANGGENG JAYA SENT', 'SURABAYA', 'TOKO', 54195560, '', 'PPN0', '', 'T21', '11 Aug 2007'], ['30 Jul 2007', '6616', 'LUNAS', 'ST02', 'LANGGENG JAYA SENT', 'SURABAYA', 'TOKO', 1000000, '', 'PPN0', '', 'T21', '20 Aug 2007'],
  ['31 Jul 2007', '6506', 'LUNAS', 'SN02', 'LANGGENG INTERINDO', 'SURABAYA', 'TOKO', 200000000, '', 'PPN0', '', 'T21', '21 Aug 2007'], ['01 Aug 2007', '07-08-00002', 'NEW', 'SP01', 'LANGGENG PUTRA PEF', 'SURABAYA', 'TOKO', 0, 'PO-NO07-08-00002', 'PPN0', 'M-365/07', 'T21', '22 Aug 2007'],
  ['01 Aug 2007', '07-08-00003', 'NEW', 'SP01', 'LANGGENG PUTRA PEF', 'SURABAYA', 'TOKO', 0, 'PO-NO07-08-00004', 'PPN0', 'D-392/07', 'T21', '22 Aug 2007'], ['01 Aug 2007', '07-08-00004', 'NEW', 'SSDK', 'LANGGENG KUMPUL', 'SURABAYA', 'TOKO', 0, 'PO-NO07-08-00005', 'PPN0', 'D-390/07', 'T21', '22 Aug 2007'],
  ['01 Aug 2007', '07-08-00005', 'NEW', 'ST05', 'LANGGENG JAYA', 'SURABAYA', 'TOKO', 0, 'PO-NO07-08-00006', 'PPN0', 'D-391/07', 'T21', '22 Aug 2007'], ['01 Aug 2007', '07-08-00006', 'NEW', 'ST02', 'LANGGENG JAYA SENT', 'SURABAYA', 'TOKO', 0, 'PO-NO07-08-00007', 'PPN0', 'D-393/07', 'T21', '22 Aug 2007'],
  ['02 Aug 2007', '07-08-00012', 'LUNAS', 'SP01', 'LANGGENG PUTRA PEF', 'SURABAYA', 'TOKO', 45712000, 'PO-NO07-08-00008', 'PPN0', 'R-377/VII/07', 'T21', '23 Aug 2007'], ['02 Aug 2007', '07-08-00013', 'LUNAS', 'ST02', 'LANGGENG JAYA SENT', 'SURABAYA', 'Gudang1', 7311400, 'PO-NO07-08-00009', 'PPN0', '', 'T21', '23 Aug 2007'],
  ['02 Aug 2007', '07-08-00014', 'LUNAS', 'ST02', 'LANGGENG JAYA SENT', 'SURABAYA', 'Gudang1', 27505800, 'PO-NO07-08-00010', 'PPN0', 'R-16/VII', 'T21', '23 Aug 2007'], ['02 Aug 2007', '07-08-00015', 'LUNAS', 'ST02', 'LANGGENG JAYA SENT', 'SURABAYA', 'Gudang1', 21943800, 'PO-NO07-08-00011', 'PPN0', 'R-31/VII', 'T21', '23 Aug 2007'],
  ['03 Aug 2007', '07-08-00007', 'LUNAS', 'SD01', 'DAMAI SAJA', 'SURABAYA', 'Gudang1', 20749500, 'PO-NO07-08-00002', 'PPN0', 'M-369/07', 'T21', '24 Aug 2007'], ['03 Aug 2007', '07-08-00008', 'LUNAS', 'SS23', 'RMI KOMP', 'SURABAYA', 'GUDANG2', 2360470, 'PO-NO07-08-00003', 'PPN0', 'D-393/07', 'T21', '24 Aug 2007'],
  ['03 Aug 2007', '07-08-00009', 'LUNAS', 'SS23', 'RMI KOMP', 'SURABAYA', 'GUDANG2', 2856960, 'PO-NO07-08-00004', 'PPN0', 'D-394/07', 'T21', '24 Aug 2007'], ['03 Aug 2007', '07-08-00010', 'LUNAS', 'SS23', 'RMI KOMP', 'SURABAYA', 'GUDANG2', 9542555, 'PO-NO07-08-00005', 'PPN0', 'R-27/07', 'T21', '24 Aug 2007'],
  ['03 Aug 2007', '07-08-00011', 'LUNAS', 'ST02', 'LANGGENG JAYA SENT', 'SURABAYA', 'GUDANG2', 49002450, 'PO-NO07-08-00005', 'PPN0', 'R-35/07', 'T21', '24 Aug 2007'], ['03 Aug 2007', '07-08-00041', 'LUNAS', 'SH04', 'AGUNG KARYA', 'SURABAYA', 'Gudang1', 48825003, 'PO-NO07-08-0008', 'PPN0', '12', 'T21', '24 Aug 2007'],
  ['04 Aug 2007', '07-08-00109', 'LUNAS', 'SN02', 'LANGGENG INTERINDO', 'SURABAYA', 'Gudang1', 91698084, 'PO-NO07-08-00016', 'PPN0', 'Q34/VII', 'T21', '25 Aug 2007'], ['04 Aug 2007', '07-08-00017', 'LUNAS', 'SH04', 'AGUNG KARYA', 'SURABAYA', 'Gudang1', 45395100, 'PO-NO07-08-00013', 'PPN0', 'S-02/VII', 'T21', '25 Aug 2007'],
  ['04 Aug 2007', '07-08-00018', 'LUNAS', 'SP01', 'LANGGENG PUTRA PEF', 'SURABAYA', 'TOKO', 44702000, 'PO-NO07-08-00014', 'PPN0', 'Q-32/VII', 'T21', '25 Aug 2007'], ['04 Aug 2007', '07-08-00019', 'NEW', 'SN02', 'LANGGENG INTERINDO', 'SURABAYA', 'TOKO', 0, 'PO-NO07-08-00016', 'PPN0', 'Q34/VII', 'T21', '25 Aug 2007'],
  ['04 Aug 2007', '07-08-00020', 'LUNAS', 'SD01', 'DAMAI SAJA', 'SURABAYA', 'TOKO', 42261500, 'PO-NO07-08-00014', 'PPN0', 'R-14/VII', 'T21', '25 Aug 2007'], ['04 Aug 2007', '07-08-00022', 'LUNAS', 'SS21', 'LANGGENG REJEKI', 'SURABAYA', 'GUDANG2', 1212000, 'PO-NO07-08-00018', 'PPN0', 'S-01/VIII', 'T21', '25 Aug 2007'],
  ['06 Aug 2007', '07-08-00138', 'LUNAS', 'SI02', 'SUMBER KOMPUTER', 'SURABAYA', 'TOKO', 143750000, '', 'PPN0', '', 'T21', '27 Aug 2007'],
]
const PEL_ROWS = [
  ['7/1/2007', 'KK-07-09-00122', 'BLI-12-12-00002', 'GIRO', 'AGUNG JAYA', 'SS31', 'SURABAYA', 2310, '', 2310, '', '12345', '12/29/2007'], ['7/1/2007', 'KK-07-09-00122', 'BLI-12-12-00001', 'GIRO', 'AGUNG JAYA', 'SS31', 'SURABAYA', 2200, '', 2200, '', '12345', '12/29/2007'],
  ['7/1/2007', 'KK-07-09-00122', 'BLI-12-11-00003', 'GIRO', 'AGUNG JAYA', 'SS31', 'SURABAYA', 41800000, '', 20000000, '', '12345', '12/29/2007'], ['7/1/2007', 'KK-07-09-00122', 'B-08-03-00001', 'GIRO', 'AGUNG JAYA', 'SS31', 'SURABAYA', 32400, '', 32400, '', '12345', '12/29/2007'],
  ['7/30/2007', 'KK-07-08-00322', '6616', 'Kas Besar', 'LANGGENG JAYA SENT', 'ST02', 'SURABAYA', 1000000, '', 1000000, '', '', ''], ['7/31/2007', '6793', '6538', 'Kas Besar', 'LANGGENG JAYA SENT', 'ST02', 'SURABAYA', 54195560, '', 54195560, '', '', ''],
  ['7/31/2007', '6790', '6506', 'Kas Besar', 'LANGGENG INTERINDO', 'SN02', 'SURABAYA', 200000000, '', 200000000, '', '', ''], ['8/2/2007', 'KK-07-08-00096', '0707165', 'GIRO EKON INDUK BR', 'AGUNG KARYA', 'SH04', 'MADURA', 20560000, '', 20560000, '', '142047.07', '8/2/2007'],
  ['8/3/2007', 'KK-07-08-00196', '158', 'GIRO EKON INDUK BR', 'SUMBER KOMPUTER', 'SI02', 'MADURA', 1616592.4, '', 1616592.4, '', '142064/07', '8/3/2007'], ['8/6/2007', 'KK-07-08-00218', '07-08-00138', 'GIRO EKON INDUK BR', 'SUMBER KOMPUTER', 'SI02', 'SURABAYA', 143750000, '', 143750000, '', '142065', '8/6/2007'],
  ['8/8/2007', 'KK-07-08-00087', '0707145', 'GIRO EKON RKT BR', 'LANGGENG JAYA', 'ST05', 'MADURA', 1537800, '', 1537800, '', '142187', '8/31/2007'], ['8/8/2007', 'KK-07-08-00131', '0707162', 'GIRO EKON INDUK BR', 'MSC', 'SS03', 'MADURA', 11034000, '', 11034000, '', '142075', '8/23/2007'],
  ['8/8/2007', 'KK-07-08-00198', '0707157', 'GIRO EKON INDUK BR', 'LANGGENG BERKAT STEEL', 'SS16', 'MADURA', 52002960, '', 31422960, '', '142079', '8/24/2007'], ['8/8/2007', 'KK-07-08-00127', '0707141', 'GIRO EKON INDUK BR', 'LANGGENG PUTRA PEF', 'SP01', 'MADURA', 10965000, '', 10965000, '', '142071', '8/17/2007'],
  ['8/8/2007', 'KK-07-08-00086', '0707144', 'GIRO EKON RKT BR', 'LANGGENG JAYA', 'ST05', 'MADURA', 13185000, '', 13185000, '', '142186', '8/29/2007'], ['8/8/2007', 'KK-07-08-00130', '0707161', 'GIRO EKON INDUK BR', 'SEJAHTERA', 'SS04', 'MADURA', 11940000, '', 11940000, '', '142074', '8/23/2007'],
  ['8/8/2007', 'KK-07-08-00092', '0707134', 'GIRO EKON RKT BR', 'LANGGENG PUTRA PEF', 'SP01', 'MADURA', 45846000, '', 19883840, '', '142192', '8/17/2007'], ['8/8/2007', 'KK-07-08-00323', '07-08-00024', 'Kas Besar', 'LANGGENG INTERINDO', 'SN02', 'SURABAYA', 46933600, '', 46933600, '', '', ''],
  ['8/8/2007', 'KK-07-08-00197', '0707157', 'GIRO EKON INDUK BR', 'LANGGENG BERKAT STEEL', 'SS16', 'MADURA', 52002960, '', 20580000, '', '142080/07', '8/10/2007'], ['8/8/2007', 'KK-07-08-00134', '0707153', 'GIRO EKON INDUK BR', 'BANDUNG KOMPUTER', 'SS09', 'MADURA', 7416000, '', 7416000, '', '142078', '8/31/2007'],
  ['8/8/2007', 'KK-07-08-00127', '0707140', 'GIRO EKON INDUK BR', 'LANGGENG PUTRA PEF', 'SP01', 'MADURA', 22058000, '', 22058000, '', '142071', '8/17/2007'], ['8/8/2007', 'KK-07-08-00085', '0708005', 'GIRO EKON RKT BR', 'LANGGENG JAYA', 'ST05', 'MADURA', 11400000, '', 11400000, '', '142185', '8/29/2007'],
  ['8/8/2007', 'KK-07-08-00129', '0707163', 'GIRO EKON INDUK BR', 'JAKARTA KOMPUTER', 'SS08', 'MADURA', 1262000, '', 1262000, '', '142073', '8/27/2007'], ['8/8/2007', 'KK-07-08-00091', '0707134', 'GIRO EKON RKT BR', 'LANGGENG PUTRA PEF', 'SP01', 'MADURA', 45846000, '', 20243520, '', '142191', '8/16/2007'],
  ['8/8/2007', 'KK-07-08-00134', '0707152', 'GIRO EKON INDUK BR', 'BANDUNG KOMPUTER', 'SS09', 'MADURA', 13530000, '', 13530000, '', '142078', '8/31/2007'],
]
const SUM_ROWS = [
  ['AFAT', 'ADDD', 25410, 115000, 110000, 20410], ['AGUNG AGUNG (3571819)', 'SS27', 3232983, 0, 0, 3232983], ['AGUNG BARU', 'SV02', 13940000, 0, 0, 13940000], ['AGUNG JAYA', 'SS31', 21800000, 0, 0, 21800000], ['AGUNG JAYA UTAMA.PT', 'SP03', 55000, 0, 0, 55000],
  ['AGUNG KARYA', 'SB10', 40000, 0, 0, 40000], ['AGUNG KARYA', 'SH04', 0, 0, 0, 0], ['AGUNG KUMPUL', 'ST07', -40000, 0, 0, -40000], ['AGUNG MAKMUR', 'SD03', 27720, 0, 0, 27720], ['AGUNG METAL', 'SA04', 0, 0, 0, 0],
  ['AGUNG PUTRA', 'SB09', 0, 0, 0, 0], ['AGUNG SEJAHTERA MANDIRI', 'SB12', 0, 0, 0, 0], ['BANDUNG KOMPUTER', 'SS09', 4200000, 0, 0, 4200000], ['BIG KOMPUTER', 'SM01', 30700000, 0, 0, 30700000], ['BINA USAHA', 'SB01', 0, 0, 0, 0],
  ['DAMAI SAJA', 'SD01', 42306705, 0, 0, 42306705], ['FUJIAN', 'A001', -84400, 0, 0, -84400], ['GTC', 'SS11', 0, 0, 0, 0], ['HASINDO', 'SH03', 55139000, 0, 0, 55139000], ['JAKARTA KOMPUTER', 'SS08', 137821750, 0, 0, 137821750],
  ['KURNIA MULYO', 'SKU', 737000, 0, 0, 737000], ['LANCAR JAYA', 'SK01', 0, 0, 0, 0], ['LANGGENG ABADI', 'SS25', 308861.21, 0, 0, 308861.21], ['LANGGENG BAJA', 'SC02', 302500000, 0, 0, 302500000],
  ['LANGGENG BERKAT STEEL', 'SS16', 111765000, 0, 0, 111765000], ['LANGGENG CD', 'SS01', 120438450, 0, 0, 120438450],
]
const KARTU = [
  ['15 Aug 2007', '07-08-00067', 'Faktur Pembelian', 0, 0, 0, ''], ['15 Aug 2007', '07-08-00129', 'Faktur Pembelian', 0, 60637500, 60637500, ''], ['24 Aug 2007', '07-08-00121', 'Faktur Pembelian', 0, 33854750, 94492250, ''], ['24 Aug 2007', '07-08-00122', 'Faktur Pembelian', 0, 93834936, 188327186, ''],
  ['27 Aug 2007', '07-08-00146', 'Faktur Pembelian', 0, 28530150, 216857336, ''], ['27 Aug 2007', '07-08-00147', 'Faktur Pembelian', 0, 41241370, 258098706, ''], ['29 Aug 2007', 'KK-07-08-00254', 'BKK (Bukti Kas/Bank Keluar)', 20426680, 0, 237672026, '07-08-00129'],
  ['29 Aug 2007', 'KK-07-08-00253', 'BKK (Bukti Kas/Bank Keluar)', 30000000, 0, 207672026, '07-08-00129'], ['29 Aug 2007', 'KK-07-08-00252', 'BKK (Bukti Kas/Bank Keluar)', 10210820, 0, 197461206, '07-08-00129'], ['13 Sep 2007', 'KK-07-09-00081', 'BKK (Bukti Kas/Bank Keluar)', 44984613, 0, 152476593, '07-08-00122'],
  ['13 Sep 2007', 'KK-07-09-00080', 'BKK (Bukti Kas/Bank Keluar)', 41241370, 0, 111235223, '07-08-00147'], ['13 Sep 2007', 'KK-07-09-00080', 'BKK (Bukti Kas/Bank Keluar)', 28530150, 0, 82705073, '07-08-00146'], ['13 Sep 2007', 'KK-07-09-00079', 'BKK (Bukti Kas/Bank Keluar)', 48850323, 0, 33854750, '07-08-00122'],
  ['13 Sep 2007', 'KK-07-09-00079', 'BKK (Bukti Kas/Bank Keluar)', 33854750, 0, 0, '07-08-00121'], ['27 Sep 2007', '07-09-00090', 'Faktur Pembelian', 0, 5074920, 5074920, ''], ['01 Oct 2007', '07-10-00003', 'Faktur Pembelian', 0, 7270500, 12345420, ''],
  ['01 Oct 2007', '07-10-00004', 'Faktur Pembelian', 0, 48525750, 60871170, ''], ['03 Oct 2007', '07-10-00010', 'Faktur Pembelian', 0, 31267500, 92138670, ''], ['04 Oct 2007', '07-10-00018', 'Faktur Pembelian', 0, 42626200, 134764870, ''],
  ['24 Oct 2007', 'KK-07-10-00191', 'BKK (Bukti Kas/Bank Keluar)', 31267500, 0, 103497370, '07-10-00010'], ['24 Oct 2007', 'KK-07-10-00191', 'BKK (Bukti Kas/Bank Keluar)', 1490750, 0, 102006620, '07-10-00004'], ['24 Oct 2007', 'KK-07-10-00191', 'BKK (Bukti Kas/Bank Keluar)', 7270500, 0, 94736120, '07-10-00003'],
]
const IS = { sel: { sup: 0, po: 0, pem: 0, pel: 0, sum: 0, kartu: 0 }, chk: { poSup: false, poOut: true, poAll: true, pemSup: false, pemPem: false, pemRet: false, pemAll: true, pelSup: false, pelAll: true }, from: '2016-02-01', to: '2016-02-29', periode: 'JUN 2015', sampai: '2016-02-09', kPeriode: 'JUL 2007', kSup: 'LANGGENG CD' }
window.b7Chk = (k, v) => { IS.chk[k] = v; IS.sel[T7.info] = 0; render() }
window.b7I = (k, v) => { IS[k] = v; render() }
window.b7Sel = (t, i) => { IS.sel[t] = i; render() }
window.b7INav = w => { const n = (infoRows().length); const t = T7.info; IS.sel[t] = w === 'first' ? 0 : w === 'last' ? n - 1 : w === 'next' ? Math.min(n - 1, IS.sel[t] + 1) : Math.max(0, IS.sel[t] - 1); render() }
const supSel = () => SUP_ROWS[IS.sel.sup] || SUP_ROWS[0]
const inRange = iso => !iso || (iso >= IS.from && iso <= IS.to)
function infoRows() {
  const t = T7.info, s = supSel()
  if (t === 'sup') return SUP_ROWS
  if (t === 'po') return PO_ROWS.filter(r => (!IS.chk.poSup || r[5] === s[1]) && (!IS.chk.poOut || ['NEW', 'PARTIAL'].includes(r[3])) && (IS.chk.poAll || inRange(iso7(r[0]))))
  if (t === 'pem') return PEM_ROWS.filter(r => (!IS.chk.pemSup || r[4] === s[1]) && (!IS.chk.pemPem || true) && (IS.chk.pemAll || inRange(iso7(r[0]))))
  if (t === 'pel') return PEL_ROWS.filter(r => (!IS.chk.pelSup || r[4] === s[1]) && (IS.chk.pelAll || true))
  if (t === 'sum') return SUM_ROWS
  return KARTU
}
function renderInfo7() {
  const t = T7.info, rows = infoRows(), si = Math.min(IS.sel[t], Math.max(0, rows.length - 1)), s = supSel()
  const toolbar = tb([['First', "b7INav('first')", si === 0], ['Prior', "b7INav('prior')", si === 0], ['Next', "b7INav('next')", si >= rows.length - 1], ['Last', "b7INav('last')", si >= rows.length - 1], ['Search', "toastNo7('Search')"], ['Filter', "toastNo7('Filter')"], ['Refresh', 'render()'], ['', '', 1], ['Go to', "toastNo7('Go to')", true], ['Format', "toastNo7('Format')"], ['Default', "toastNo7('Default')"], ['XLS', "toastNo7('XLS')"]].filter(b => b[0]))
  const nofn = `<div class="b7-st"><span>${rows.length ? si + 1 : 0} of ${rows.length}</span></div>`
  const dates = (on) => `<span class="ck7">${cb('All', on, t === 'po' ? IS.chk.poAll : t === 'pem' ? IS.chk.pemAll : IS.chk.pelAll)}<input type="date" class="b7in" style="width:150px" value="${IS.from}" onchange="b7I('from',this.value)"> <input type="date" class="b7in" style="width:150px" value="${IS.to}" onchange="b7I('to',this.value)"></span>`
  let top = '', tbl = ''
  const mk = i => i === si
  if (t === 'sup') {
    top = `<div class="b7-sub">${btn('Supplier Baru', "toastNo7('Supplier Baru')")}</div>`
    tbl = grid({ mw: 1500, cols: [{ l: '', k: '_', w: 28 }, { l: 'KODE SUPPLIER', k: 'a', w: 120 }, { l: 'SUPPLIER', k: 'b', w: 200 }, { l: 'LOKASI', k: 'c', w: 110 }, { l: 'ALAMAT', k: 'd', w: 260 }, { l: 'PHONE', k: 'e', w: 110 }, { l: 'FAX', k: 'f', w: 90 }, { l: 'KONTAK', k: 'g', w: 90 }, { l: 'JANGKA', k: 'h', w: 80 }, { l: 'LIMIT HUTANG', k: 'i', w: 150, num: 1 }, { l: 'AKTIF', k: 'j', w: 70 }],
      rows: rows.map((r, i) => ({ sel: mk(i), on: `b7Sel('sup',${i})`, c: { _: mkc(mk(i)), a: r[0], b: esc(r[1]), c: r[2], d: esc(r[3]), e: r[4], f: r[5], g: r[6], h: 'T21', i: r[7] == null ? '' : n7(r[7]), j: `<input type="checkbox" class="cb7" disabled ${r[8] ? 'checked' : ''}>` } })) })
  } else if (t === 'po') {
    top = `<div class="b7-chk">${cb('Supplier', "b7Chk('poSup',this.checked)", IS.chk.poSup)}${cb('Outstanding', "b7Chk('poOut',this.checked)", IS.chk.poOut)}${dates("b7Chk('poAll',this.checked)")}${btn('Close PO', "toastNo7('Close PO')")}${btn('Tambah', "toastNo7('Tambah')")}</div>`
    tbl = grid({ mw: 1500, cols: [{ l: '', k: '_', w: 28 }, { l: 'TANGGAL', k: 'a', w: 110 }, { l: 'NO PO', k: 'b', w: 160 }, { l: 'NO REF', k: 'c', w: 150 }, { l: 'STATUS<br>PO', k: 'd', w: 90 }, { l: 'DIBUTUHKAN', k: 'e', w: 140 }, { g: 'SUPPLIER', l: 'NAMA', k: 'f', w: 190 }, { g: 'SUPPLIER', l: 'LOKASI', k: 'g', w: 100 }, { l: 'GUDANG', k: 'h', w: 100 }, { l: 'PPN', k: 'i', w: 80 }, { l: 'TOTAL', k: 'j', w: 150, num: 1 }, { l: 'JANGKA', k: 'k', w: 80 }, { l: 'KETERANGAN', k: 'l', w: 160 }],
      rows: rows.map((r, i) => ({ sel: mk(i), on: `b7Sel('po',${i})`, c: { _: mkc(mk(i)), a: r[0], b: r[1], c: esc(r[2]), d: r[3], e: r[4], f: esc(r[5]), g: r[6], h: r[7], i: r[8], j: nz(r[9]), k: r[10], l: '' } })) })
  } else if (t === 'pem') {
    top = `<div class="b7-chk">${cb('Supplier', "b7Chk('pemSup',this.checked)", IS.chk.pemSup)}${cb('Pembelian', "b7Chk('pemPem',this.checked)", IS.chk.pemPem)}${cb('Retur', "b7Chk('pemRet',this.checked)", IS.chk.pemRet)}${dates("b7Chk('pemAll',this.checked)")}${btn('Nota Pembelian Baru', "b7New();go('buy-invoice')")}${btn('Retur Pembelian Baru', "b7RNew();go('buy-return')")}</div>`
    tbl = grid({ mw: 1500, cols: [{ l: '', k: '_', w: 28 }, { l: 'TANGGAL', k: 'a', w: 110 }, { l: 'NO FAKTUR', k: 'b', w: 130 }, { l: 'STATUS', k: 'c', w: 90 }, { g: 'SUPPLIER', l: 'KODE', k: 'd', w: 70 }, { g: 'SUPPLIER', l: 'NAMA', k: 'e', w: 190 }, { g: 'SUPPLIER', l: 'LOKASI', k: 'f', w: 100 }, { l: 'GUDANG', k: 'g', w: 100 }, { l: 'TOTAL', k: 'h', w: 140, num: 1 }, { l: 'NO PO', k: 'i', w: 170 }, { l: 'PPN', k: 'j', w: 70 }, { l: 'NO REF', k: 'k', w: 130 }, { l: 'JANGKA', k: 'l', w: 80 }, { l: 'JTEMPO', k: 'm', w: 120 }],
      rows: rows.map((r, i) => ({ sel: mk(i), on: `b7Sel('pem',${i})`, c: { _: mkc(mk(i)), a: r[0], b: r[1], c: r[2], d: r[3], e: esc(r[4]), f: r[5], g: r[6], h: nz(r[7]), i: r[8], j: r[9], k: esc(r[10]), l: r[11], m: r[12] } })) })
  } else if (t === 'pel') {
    top = `<div class="b7-chk">${cb('Supplier', "b7Chk('pelSup',this.checked)", IS.chk.pelSup)}${dates("b7Chk('pelAll',this.checked)")}${btn('Pencairan Giro', "go('giro-board')")}</div>`
    tbl = grid({ mw: 1700, cols: [{ l: '', k: '_', w: 28 }, { l: 'TANGGAL', k: 'a', w: 110 }, { l: 'NO VOUCER', k: 'b', w: 150 }, { l: 'NO FAKTUR', k: 'c', w: 150 }, { l: 'BANK', k: 'd', w: 170 }, { g: 'SUPPLIER', l: 'NAMA', k: 'e', w: 200 }, { g: 'SUPPLIER', l: 'KODE', k: 'f', w: 70 }, { g: 'SUPPLIER', l: 'LOKASI', k: 'g', w: 100 }, { l: 'NILAI FAKTUR', k: 'h', w: 140, num: 1 }, { l: 'POTONGAN', k: 'i', w: 100, num: 1 }, { l: 'BAYAR', k: 'j', w: 140, num: 1 }, { l: 'NO REFF', k: 'k', w: 100 }, { g: 'GIRO', l: 'NO', k: 'l', w: 110 }, { g: 'GIRO', l: 'JTEMPO', k: 'm', w: 110 }],
      rows: rows.map((r, i) => ({ sel: mk(i), on: `b7Sel('pel',${i})`, c: { _: mkc(mk(i)), a: r[0], b: r[1], c: r[2], d: r[3], e: esc(r[4]), f: r[5], g: r[6], h: n7(r[7]), i: r[8] === '' ? '' : n7(r[8]), j: n7(r[9]), k: r[10], l: r[11], m: r[12] } })) })
  } else if (t === 'sum') {
    top = `<div class="b7-chk"><label class="ck7">PERIODE <select class="b7in" style="width:150px" onchange="b7I('periode',this.value)">${['JUN 2015'].map(x => `<option ${x === IS.periode ? 'selected' : ''}>${x}</option>`).join('')}</select></label><label class="ck7">SAMPAI TANGGAL <input type="date" class="b7in" style="width:160px" value="${IS.sampai}" onchange="b7I('sampai',this.value)"></label>${btn('Refresh', 'render()')}</div>`
    tbl = grid({ mw: 760, cols: [{ l: '', k: '_', w: 28 }, { g: 'SUPPLIER', l: 'NAMA', k: 'a', w: 230 }, { g: 'SUPPLIER', l: 'KODE', k: 'b', w: 90 }, { l: 'SALDO AWAL', k: 'c', w: 130, num: 1 }, { l: 'DEBET', k: 'd', w: 120, num: 1 }, { l: 'KREDIT', k: 'e', w: 120, num: 1 }, { l: 'SALDO AKHIR', k: 'f', w: 130, num: 1 }],
      rows: rows.map((r, i) => ({ sel: mk(i), on: `b7Sel('sum',${i})`, c: { _: mkc(mk(i)), a: esc(r[0]), b: r[1], c: n7(r[2]), d: n7(r[3]), e: n7(r[4]), f: n7(r[5]) } })) })
  } else {
    top = `<div class="b7-chk"><label class="ck7">SUPPLIER <select class="b7in" style="width:260px" onchange="b7I('kSup',this.value)">${SUM_ROWS.map(r => `<option ${r[0] === IS.kSup ? 'selected' : ''}>${esc(r[0])}</option>`).join('')}</select></label><label class="ck7">PERIODE <select class="b7in" style="width:140px" onchange="b7I('kPeriode',this.value)">${['JUL 2007'].map(x => `<option>${x}</option>`).join('')}</select></label><label class="ck7">SAMPAI TANGGAL <input type="date" class="b7in" style="width:160px" value="${IS.sampai}" onchange="b7I('sampai',this.value)"></label>${btn('Refresh', 'render()')}</div>`
    const own = IS.kSup === 'LANGGENG CD'
    tbl = grid({ mw: 880, cols: [{ l: '', k: '_', w: 28 }, { l: 'TANGGAL', k: 'a', w: 110 }, { l: 'NO TRANSAKSI', k: 'b', w: 140 }, { l: 'TRANSAKSI', k: 'c', w: 220 }, { l: 'DEBET', k: 'd', w: 120, num: 1 }, { l: 'KREDIT', k: 'e', w: 120, num: 1 }, { l: 'SALDO AKHIR', k: 'f', w: 130, num: 1 }, { l: 'KETERANGAN', k: 'g', w: 140 }],
      rows: (own ? rows : []).map((r, i) => ({ sel: mk(i), on: `b7Sel('kartu',${i})`, c: { _: mkc(mk(i)), a: r[0], b: r[1], c: r[2], d: n7(r[3]), e: n7(r[4]), f: n7(r[5]), g: r[6] } })) })
    tbl += `<div class="b7-sum"><label>AWAL ${inp7(own ? '0' : '', null, { ro: 1, r: 1 })}</label><label>DEBET ${inp7(own ? sp(447002224) : '', null, { ro: 1, r: 1 })}</label><label>KREDIT ${inp7(own ? sp(567440674) : '', null, { ro: 1, r: 1 })}</label><label>AKHIR ${inp7(own ? sp(120438450) : '', null, { ro: 1, r: 1 })}</label></div>`
  }
  const hdr = `<div class="b7-r"><div style="width:140px">${inp7('1000', null, { ro: 1 })}</div><span class="m" style="font-size:17px;color:var(--ink)">${esc(s[0])} ${esc(s[1])}</span></div>`
  const tabNames = [['sup', 'SUPPLIER'], ['po', 'PO'], ['pem', 'PEMBELIAN & RETUR'], ['pel', 'PELUNASAN HUTANG'], ['sum', 'SUMMARY HUTANG'], ['kartu', 'KARTU HUTANG']]
  return head7('Info Pembelian') + `<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:16px">${toolbar}${nofn}</div>` + hdr + tabs7('info', tabNames) + top + tbl
}
reg7({ id: 'buy-info', manual: 'Manual hal. 110–114 · Info Pembelian (Supplier · PO · Pembelian & Retur · Pelunasan Hutang · Summary Hutang · Kartu Hutang)', render: renderInfo7 })

/* ═════════ Laporan Pembelian ═════════ */
const REPS = [
  ['Laporan Harian Detail Pembelian Item', 'Barang (Plus Retur)', ['tanggal', 'jenis']], ['Laporan Pembelian Bulanan', 'Default Pembelian barang', ['periode', 'jenis']], ['Summary Pembelian', '', ['dari', 'sampai', 'nofaktur', 'supplier', 'gudang', 'jenis']],
  ['Rekap Detail Faktur Pembelian', '', ['dari', 'sampai', 'jenis'], 'detail'], ['Laporan Barang Datang (Nilai)', 'PREMIUM', ['dari', 'sampai', 'supplier']], ['Laporan Harian Pembelian Item Detail Supplier', 'Barang (Plus Retur)', ['dari', 'sampai', 'jenis']],
  ['Laporan Harian Pembelian Per Supplier Detail Item', 'Barang (Plus Retur)', ['dari', 'sampai', 'jenis']], ['Laporan Bulanan Pembelian Item Detail Supplier', 'Barang (Plus Retur)', ['periode', 'jenis']], ['Laporan Bulanan Pembelian Per Supplier Detail Item', 'Barang (Plus Retur)', ['periode', 'jenis']],
  ['Laporan Daftar Harga', '', []], ['Laporan History Harga Pembelian', '', ['item']], ['Summary Pembelian PPN', '', []],
  ['Laporan Summary Uang Muka Pembelian', 'Uang Muka', []], ['Laporan Detail Uang Muka Pembelian', 'Uang Muka', []], ['Laporan Summary Outstanding  Uang Muka Pembelian', 'Uang Muka', []], ['Laporan Detail Outstanding Uang Muka Pembelian', 'Uang Muka', []],
  ['Laporan Summary PO', 'PO', ['dari', 'sampai'], 'summaryPO'], ['Laporan Detail PO', 'PO', ['dari', 'sampai', 'jenis']], ['Perbandingan PO Outstanding dengan stok saat ini', 'PO', []], ['PO Outstanding', 'PO', ['dari', 'sampai', 'jenis'], 'poOut'],
  ['Laporan Realisasi PO', 'PO - Premium', []], ['Laporan Summary Retur Pembelian', 'Retur', ['dari', 'sampai', 'nofaktur', 'supplier', 'gudang', 'jenis']], ['Laporan Detail Retur Pembelian', 'Retur', ['jenis']],
  ['Laporan Detail Pelunasan Nota Pembelian', 'Hutang', [], 'pelunasan'], ['Hutang Jatuh Tempo', 'Hutang', ['tanggal'], 'jatuhTempo'], ['Summary Hutang Dagang', 'Hutang', ['periode'], 'summaryHutang'], ['Summary Hutang Dagang Per Tanggal', 'Hutang', ['dari', 'sampai'], 'perTanggal'],
  ['Kartu Hutang Kumala', 'Hutang Kumala', ['supplier', 'tanggal'], 'kartu'], ['Sisa Hutang Dagang', '', ['tanggal'], 'sisa'], ['Umur Hutang Dagang Per Supplier Per Faktur', '', [], 'umurFaktur'], ['Sisa Hutang Dagang per Supplier', '', ['tanggal'], 'sisaFaktur'], ['Umur Hutang', '', [], 'umur'], ['List Supplier', '', [], 'listSup'],
].map(([l, k, p, s], i) => ({ n: i + 1, l, k, p, s }))
const RP = { sel: -1, par: {}, shown: -1 }
const paper = (title, subt, head, rows, o = {}) => `<div class="paper7"><div class="co">PT. X Y Z</div><h3>${title}</h3><div class="sub">${subt}</div><table><thead>${head}</thead><tbody>${rows}</tbody></table><div class="by">Dicetak oleh MERDA</div></div>`
const pth = cells => { let r1 = '', r2 = ''; const two = cells.some(c => Array.isArray(c)); cells.forEach(c => { if (Array.isArray(c)) { r1 += `<th colspan="${c[1].length}">${c[0]}</th>`; r2 += c[1].map(s => `<th>${s}</th>`).join('') } else r1 += `<th ${two ? 'rowspan="2"' : ''}>${c}</th>` }); return `<tr>${r1}</tr>${two ? `<tr>${r2}</tr>` : ''}` }
const ptd = (cells, cls = '') => `<tr class="${cls}">${cells.map(c => { const [v, r] = Array.isArray(c) ? c : [c, /^[−-]?[\d,]+(\.\d+)?$/.test(String(c))]; return `<td class="${r ? 'r' : ''}">${v}</td>` }).join('')}</tr>`
const OPEN_INV = [['07-09-00090', '27 Sep 2007', 5074920, 0], ['07-10-00004', '01 Oct 2007', 48525750, 1490750], ['07-10-00018', '04 Oct 2007', 42626200, 0]]
const openRows = () => OPEN_INV.map(([no, tgl, tot, bayar]) => ({ no, tgl, jt: d7(addDays7(iso7(tgl), 21)), tot, bayar, sisa: tot - bayar }))
const SAMPLES = {
  summaryPO: () => paper('Laporan Summary Order Pembelian', 'SEMUA', pth(['TANGGAL', 'NO PO', ['SUPPLIER', ['NAMA', 'LOKASI']], 'NO REF.', 'KIRIM KE', 'TANGGAL DATANG', 'KETERANGAN', 'TOTAL', 'STATUS']), [['27/04/2006', 'PO-06-04-00007', 'SUMBER BERKAT INDUK', 'DARMO', '29/IV/06', 'Menganti', '29/04/2006', '', '23,840,000', 'NEW'], ['27/04/2006', 'PO-06-04-00008', 'SUMBER BERKAT INDUK', 'DARMO', '', 'Menganti', '29/04/2006', '', '43,800,000', 'NEW'], ['08/06/2006', 'PO-06-06-00001', 'SUMBER BERKAT INDUK', 'DARMO', 'A-29', 'Menganti', '09/06/2006', '', '0', 'DELETE']].map(r => ptd(r)).join('') + `<tr><td class="nb" colspan="7"></td><td class="nb r">Total</td><td class="r">67,640,000</td><td></td></tr>`),
  detail: () => { const H = [['02/05/2006', '06-05-00001', '21,500,000', [['GULA KREMBUNG', '80.00', 'SAK', '268,750', '21,500,000']]], ['05/05/2006', '06-05-00002', '32,640,000', [['GULA RRT', '120.00', 'SAK', '272,000', '32,640,000']]], ['05/05/2006', '06-05-00003', '402,500', [['TEPUNG RODA BIRU', '5.00', 'SAK', '80,500', '402,500']]], ['06/05/2006', '06-05-00004', '40,420,000', [['GULA KREMBUNG', '80.00', 'SAK', '271,250', '21,700,000'], ['TEPUNG BRGH', '120.00', 'SAK', '85,500', '10,260,000'], ['TEPUNG CAKRA', '90.00', 'SAK', '94,000', '8,460,000']]], ['06/05/2006', '06-05-00005', '2,355,000', [['TEPUNG RODA BIRU', '30.00', 'SAK', '78,500', '2,355,000']]]]
    return paper('Laporan Detail Pembelian', '01/05/2006 - 06/05/2006', pth(['TANGGAL', 'NO FAKTUR', ['SUPPLIER', ['NAMA', 'LOKASI']], 'TANGGAL J.TEMPO', 'GUDANG', 'KETERANGAN', 'DISKON', 'TOTAL', 'STATUS']), H.map(([t, n, tot, it]) => ptd([t, n, 'SUMBER BERKAT INDUK', 'DARMO', t, 'MENGANTI', '', '0.00', tot, 'LUNAS']) + it.map(([nm, q, s, h, tt]) => ptd(['', '', nm, q, s, h, '0', '0.00', tt, ''])).join('')).join('')) },
  poOut: () => paper('PO OUTSTANDING', 'SEMUA', pth(['NO', 'No PO', 'TANGGAL', 'TANGGAL BUTUH', 'NAMA VENDOR', 'ITEM', ['QTY', ['PO', 'REALISASI']], 'SISA']), [['1', 'PO-06-04-00007', '27/04/06', '29/04/06', 'SUMBER BERKAT INDUK', 'TEPUNG BRGH', '75.00', '0.00', '75.00'], ['2', 'PO-06-04-00007', '27/04/06', '29/04/06', 'SUMBER BERKAT INDUK', 'TEPUNG CAKRA', '75.00', '0.00', '75.00'], ['3', 'PO-06-04-00007', '27/04/06', '29/04/06', 'SUMBER BERKAT INDUK', 'TEPUNG KANJI 50 KG', '80.00', '0.00', '80.00'], ['4', 'PO-06-04-00008', '27/04/06', '29/04/06', 'SUMBER BERKAT INDUK', 'TEPUNG NAGA HIJAU', '600.00', '0.00', '600.00']].map(r => ptd(r)).join('') + `<tr class="t"><td class="nb" colspan="6" style="text-align:right">TOTAL</td><td class="r">830.00</td><td class="r">0.00</td><td class="r">830.00</td></tr>`),
  pelunasan: () => paper('Laporan Detail Pelunasan Nota Pembelian', 'SEMUA', pth(['NO FAKTUR', 'NO VOUCHER', 'TANGGAL', 'KAS/BANK', 'NILAI FAKTUR', 'POTONGAN', 'BAYAR']), PEL_ROWS.filter(r => r[4] === 'LANGGENG JAYA SENT' || r[4] === 'LANGGENG INTERINDO').map(r => ptd([r[2], r[1], r[0], r[3], n7(r[7]), '', n7(r[9])])).join('')),
  jatuhTempo: () => paper('Hutang Jatuh Tempo', `Sampai tanggal ${RP.par.tanggal ? d7(RP.par.tanggal) : '09 Feb 2016'} · LANGGENG CD`, pth(['NO FAKTUR', 'TANGGAL', 'JTEMPO', 'TOTAL', 'BAYAR', 'SISA']), openRows().map(r => ptd([r.no, r.tgl, r.jt, n7(r.tot), n7(r.bayar), n7(r.sisa)])).join('') + ptd(['', '', '', n7(sum7(openRows(), r => r.tot)), n7(sum7(openRows(), r => r.bayar)), n7(sum7(openRows(), r => r.sisa))], 't')),
  summaryHutang: () => paper('Summary Hutang Dagang', `Periode ${IS.periode} · sampai ${d7(IS.sampai)}`, pth([['SUPPLIER', ['NAMA', 'KODE']], 'SALDO AWAL', 'DEBET', 'KREDIT', 'SALDO AKHIR']), SUM_ROWS.map(r => ptd([r[0], r[1], n7(r[2]), n7(r[3]), n7(r[4]), n7(r[5])])).join('') + ptd(['TOTAL', '', ...[2, 3, 4, 5].map(i => n7(sum7(SUM_ROWS, r => r[i])))], 't')),
  perTanggal: () => { const by = {}; KARTU.forEach(r => { const o = by[r[0]] = by[r[0]] || { k: 0, d: 0 }; o.k += r[4]; o.d += r[3] }); let b = 0; return paper('Summary Hutang Dagang Per Tanggal', 'LANGGENG CD · 15 Aug 2007 - 24 Oct 2007', pth(['TANGGAL', 'PEMBELIAN KREDIT', 'PELUNASAN', 'PEMBELIAN TUNAI', 'SALDO AKHIR']), Object.entries(by).map(([t, o]) => { b += o.k - o.d; return ptd([t, n7(o.k), n7(o.d), '0.00', n7(b)]) }).join('')) },
  kartu: () => paper('Kartu Hutang Kumala', 'LANGGENG CD · Jul 2007 - 09 Feb 2016', pth(['TANGGAL', 'NO TRANSAKSI', 'TRANSAKSI', 'DEBET', 'KREDIT', 'SALDO AKHIR', 'KETERANGAN']), ptd(['', '', 'Saldo awal', '', '', '0.00', '']) + KARTU.map(r => ptd([r[0], r[1], r[2], n7(r[3]), n7(r[4]), n7(r[5]), r[6]])).join('')),
  sisa: () => paper('Sisa Hutang Dagang', `Per tanggal ${RP.par.tanggal ? d7(RP.par.tanggal) : '09 Feb 2016'}`, pth(['NAMA', 'KODE', 'SISA HUTANG']), SUM_ROWS.map(r => ptd([r[0], r[1], n7(r[5])])).join('') + ptd(['TOTAL', '', n7(sum7(SUM_ROWS, r => r[5]))], 't')),
  umurFaktur: () => paper('Umur Hutang Dagang Per Supplier Per Faktur', 'LANGGENG CD · per 09 Feb 2016', pth(['NO FAKTUR', 'TANGGAL', 'JTEMPO', 'SISA', '0 - 30', '31 - 60', '61 - 90', '> 90']), openRows().map(r => ptd([r.no, r.tgl, r.jt, n7(r.sisa), '0.00', '0.00', '0.00', n7(r.sisa)])).join('')),
  sisaFaktur: () => paper('Sisa Hutang Dagang per Supplier', `Per tanggal ${RP.par.tanggal ? d7(RP.par.tanggal) : '09 Feb 2016'} · LANGGENG CD`, pth(['NO FAKTUR', 'TANGGAL', 'JTEMPO', 'TOTAL', 'BAYAR', 'SISA']), openRows().map(r => ptd([r.no, r.tgl, r.jt, n7(r.tot), n7(r.bayar), n7(r.sisa)])).join('') + ptd(['', '', '', n7(sum7(openRows(), r => r.tot)), n7(sum7(openRows(), r => r.bayar)), n7(sum7(openRows(), r => r.sisa))], 't')),
  umur: () => paper('Umur Hutang', 'per 09 Feb 2016', pth([['SUPPLIER', ['NAMA', 'KODE']], 'TOTAL', '0 - 30', '31 - 60', '61 - 90', '> 90']), SUM_ROWS.filter(r => r[5] > 0).map(r => ptd([r[0], r[1], n7(r[5]), '0.00', '0.00', '0.00', n7(r[5])])).join('')),
  listSup: () => paper('List Supplier', 'SEMUA', pth(['KODE SUPPLIER', 'SUPPLIER', 'LOKASI', 'ALAMAT', 'PHONE', 'KONTAK', 'JANGKA', 'LIMIT HUTANG', 'AKTIF']), SUP_ROWS.map(r => ptd([r[0], r[1], r[2], r[3], r[4], r[6], 'T21', r[7] == null ? '' : n7(r[7]), r[8] ? 'Y' : 'N'])).join('')),
}
window.b7Rep = i => { RP.sel = i; const r = REPS[i]; if (!r.p.length) { RP.shown = i; render(); return } RP.par = RP.par.n === i ? RP.par : { n: i }; openRepDlg(i) }
function openRepDlg(i) {
  const r = REPS[i], P = RP.par
  const F = {
    tanggal: ['TANGGAL', `<input class="b7in" type="date" value="${P.tanggal || '2016-02-09'}" onchange="RP7('tanggal',this.value)">`],
    dari: ['DARI TANGGAL', `<input class="b7in" type="date" value="${P.dari || '2016-02-01'}" onchange="RP7('dari',this.value)">`], sampai: ['SAMPAI TANGGAL', `<input class="b7in" type="date" value="${P.sampai || '2016-02-09'}" onchange="RP7('sampai',this.value)">`],
    periode: ['PERIODE', `<select class="b7in"><option>JUN 2015</option><option>JUL 2007</option></select>`], supplier: ['SUPPLIER', `<select class="b7in"><option>SEMUA</option>${SUM_ROWS.map(x => `<option>${esc(x[0])}</option>`).join('')}</select>`],
    nofaktur: ['NO FAKTUR', `<input class="b7in">`], gudang: ['GUDANG', `<select class="b7in"><option>SEMUA</option>${GUDANGS.map(g => `<option>${g}</option>`).join('')}</select>`], item: ['ITEM', `<input class="b7in">`],
    jenis: ['JENIS ITEM', `<div>${['All', 'Stok', 'Jasa', 'Uang Muka'].map((x, ix) => `<label class="ck7"><input type="radio" name="jn" ${ix === 0 ? 'checked' : ''}>${x}</label>`).join('')}</div>`],
  }
  openSheet({ crumb: ['Laporan Pembelian'], title: esc(r.l), size: 'rail', body: r.p.map(k => `<div class="b7-r"><span>${F[k][0]}</span><div style="flex:1;min-width:0">${F[k][1]}</div></div>`).join(''), foot: btn('OK', `b7RepOK(${i})`) })
}
window.RP7 = (k, v) => { RP.par[k] = v }
window.b7RepOK = i => { RP.shown = i; closeSheet(); render() }
function renderReports7() {
  const rows = REPS.map((r, i) => ({ sel: i === RP.sel, on: `b7Rep(${i})`, c: { _: mkc(i === RP.sel), n: r.n, l: esc(r.l), k: esc(r.k) } }))
  const shown = RP.shown >= 0 ? REPS[RP.shown] : null
  const out = shown ? (shown.s ? SAMPLES[shown.s]() : `<div class="paper7"><h3>${esc(shown.l)}</h3><div class="sub mute">Tidak ada contoh tampilan di manual</div></div>`) : ''
  return head7('Laporan Pembelian') + grid({ mw: 880, cols: [{ l: '', k: '_', w: 28 }, { l: 'NO', k: 'n', w: 60 }, { l: 'L A P O R A N', k: 'l', w: 400 }, { l: 'K E T E R A N G A N', k: 'k', w: 300 }], rows }) + out
}
reg7({ id: 'buy-reports', manual: 'Manual hal. 131–137 · Laporan Pembelian (33 laporan; contoh hal. 137)', render: renderReports7 })
})()
;
