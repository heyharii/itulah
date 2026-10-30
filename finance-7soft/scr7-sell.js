;(() => {
/* ═════════ 7Soft, as it is: Menu Penjualan ═════════
   Content of the manual (Petunjuk Pemakaian 7Soft, hal. 138–179, 240–253, 267–269) and of its screenshots.
   Labels, columns, tabs, buttons and status words are 7Soft's own; the data is the manual's example data. */

/* ─── 7Soft number and date forms ─── */
const grp = s => s.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
const f2 = n => (n < 0 ? '-' : '') + grp(String(Math.trunc(Math.abs(Math.round(n * 100) / 100)))) + '.' + (Math.abs(Math.round(n * 100) % 100)).toString().padStart(2, '0')
const f0 = n => (n < 0 ? '-' : '') + grp(String(Math.abs(Math.round(n))))
const fsp = n => (n < 0 ? '-' : '') + String(Math.trunc(Math.abs(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + '.' + (Math.abs(Math.round(n * 100) % 100)).toString().padStart(2, '0')
const sumq = (a, f) => a.reduce((s, x) => s + f(x), 0)

/* ─── look: Central tokens, 7Soft content ─── */
const CSS7 = `<style>
.v7tb{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:20px}
.v7tb .ds-btn[disabled]{opacity:.5;cursor:default}
.v7cnt{display:inline-flex;flex-direction:column;align-items:center;min-width:120px;padding:2px 14px;border:1px solid var(--hairline-2);border-radius:var(--r-inner)}
.v7cnt b{font-weight:600}
.v7ro{font-weight:600;padding:0 12px}
.v7f{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:0 48px;margin-bottom:20px}
.v7r{display:grid;grid-template-columns:132px minmax(0,1fr);gap:10px;align-items:center;margin-bottom:10px}
.v7r>span{font-weight:500}
.v7r input,.v7r select,.v7r textarea{width:100%;height:40px;padding:0 12px;border:1px solid var(--hairline-2);border-radius:var(--r-inner);background:var(--canvas);font:inherit;color:var(--ink)}
.v7r textarea{height:104px;padding:8px 12px;resize:none;line-height:22px}
.v7r input[readonly],.v7r select[disabled],.v7r textarea[readonly]{background:var(--soft);color:var(--ink)}
.v7pair{display:grid;grid-template-columns:minmax(0,1fr) 150px;gap:8px}
.v7pair.e{grid-template-columns:150px 20px 20px minmax(0,1fr);align-items:center}
.v7pct{display:flex;align-items:center;gap:8px}
.v7pct input{width:130px}
.v7big{font-size:64px;line-height:76px;font-weight:600;letter-spacing:-2px;text-align:right;color:var(--body);padding:12px 24px;background:var(--soft);border-radius:var(--r-card);font-variant-numeric:tabular-nums;margin-bottom:20px}
.v7sub{display:flex;flex-wrap:wrap;gap:4px 14px;align-items:center;margin:0 0 12px}
.v7dtb{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:20px 0 10px}
.v7sec{margin-top:20px}
.v7foot{display:flex;flex-wrap:wrap;gap:12px 32px;align-items:center;justify-content:space-between;padding:14px 16px;border:1px solid var(--hairline);border-radius:var(--r-card);margin-top:12px}
.v7acc{display:flex;flex-direction:column;gap:2px;font-weight:600}
.v7tot{display:grid;grid-template-columns:auto 190px;gap:8px 12px;align-items:center}
.v7tot span{text-align:right}
.v7tot b{display:block;padding:6px 12px;border:1px solid var(--hairline-2);border-radius:var(--r-inner);text-align:right;font-weight:600;font-variant-numeric:tabular-nums}
.v7stat{display:flex;gap:24px;align-items:center;padding:12px 16px;border-top:1px solid var(--hairline);margin-top:20px;font-weight:600}
.v7stat span:last-child{margin-left:auto;margin-right:auto}
.v7opts{display:flex;flex-wrap:wrap;gap:8px 20px;align-items:center;margin-bottom:16px}
.v7opts .ds-check{gap:8px}
.v7opts .v7d{display:inline-flex;align-items:center;gap:8px}
.v7opts .v7d input{width:150px;height:36px;padding:0 10px;border:1px solid var(--hairline-2);border-radius:var(--r-inner);background:var(--soft);font:inherit}
.v7g{table-layout:fixed;width:100%}
.v7g th{white-space:normal;text-align:center;font-weight:600}
.v7g td{overflow:hidden;text-overflow:ellipsis}
.v7g th.is-num{text-align:center}
.v7g tr.sel td{background:var(--accent-bg)}
.v7g tfoot td{font-weight:600}
.v7card{overflow-x:auto;border:1px solid var(--hairline);border-radius:var(--r-card)}
.v7card .v7g{border:0}
.v7kv{display:flex;flex-wrap:wrap;gap:12px 28px;align-items:center;margin:16px 0}
.v7kv label{display:flex;align-items:center;gap:8px}
.v7kv input{height:36px;padding:0 10px;border:1px solid var(--hairline-2);border-radius:var(--r-inner);background:var(--soft);font:inherit;text-align:right;width:150px}
.v7rep{margin-top:24px;padding:20px 24px;border:1px solid var(--hairline);border-radius:var(--r-card)}
.v7rep h2{margin:12px 0 2px;text-align:center;font-size:17px;font-weight:600}
.v7rep .c{text-align:center;color:var(--body);margin-bottom:12px}
.v7rep .co{font-weight:600;letter-spacing:4px}
.v7rep .pr{color:var(--body);margin-top:8px}
.v7dlg{display:flex;flex-direction:column;gap:14px;max-width:560px}
.v7dlg .v7r{margin:0}
.v7dlg .rng{display:grid;grid-template-columns:minmax(0,1fr) 24px minmax(0,1fr);gap:8px;align-items:center}
.v7dlg .rng i{font-style:normal;text-align:center}
</style>`
const ESC = esc
const btn7 = (label, on, dis) => `<button class="ds-btn ds-btn--primary ds-btn--sm" type="button" ${dis ? 'disabled' : `onclick="${on}"`}>${label}</button>`
const tb = items => `<div class="v7tb">${items.map(([l, on, d]) => btn7(l, on || `v7soon('${l}')`, d)).join('')}</div>`
const cnt = (st, i, n) => `<span class="v7cnt"><b>${st}</b><span>${i} of ${n}</span></span>`
const chk = (on, extra = '') => `<input type="checkbox" class="cb7" ${on ? 'checked' : ''} ${extra || 'disabled'}>`
const rw = (label, inner) => `<div class="v7r"><span>${label}</span><div>${inner}</div></div>`
const iv = (v, extra = '') => `<input value="${ESC(v)}" readonly ${extra}>`
const sv = (opts, cur, dis = true, on = '') => `<select ${dis ? 'disabled' : `onchange="${on}"`}>${opts.map(o => `<option ${o === cur ? 'selected' : ''}>${ESC(o)}</option>`).join('')}</select>`
const pair = (a, b) => `<div class="v7pair">${a}${b}</div>`
const dlgBtn = (label, on) => btn7(label, on)
window.v7soon = n => soon(n)

/* a grid in the 7Soft way: group headings over columns, rows that select */
function grid7(m) {
  const cols = m.cols, anyG = cols.some(c => c.g)
  let r1 = '', r2 = ''
  cols.forEach((c, i) => {
    const n = cols.filter(x => x.g === c.g).length
    if (c.g) { if (!cols[i - 1] || cols[i - 1].g !== c.g) r1 += `<th colspan="${n}">${c.g}</th>`; r2 += `<th>${c.l}</th>` }
    else r1 += `<th rowspan="${anyG ? 2 : 1}">${c.l}</th>`
  })
  const w = m.minw || sumq(cols, c => c.w || 120)
  const rows = m.rows.length ? m.rows.map(r => `<tr class="${r.on ? 'ds-opens' : ''} ${r.sel ? 'sel' : ''}" ${r.on ? `onclick="${r.on}"${r.ctx ? ` oncontextmenu="${r.ctx};return false"` : ''}` : ''}>${cols.map(c => `<td class="${c.num ? 'is-num' : ''}" ${c.ctx && r.ctx ? `oncontextmenu="${c.ctx(r)};return false"` : ''}>${r.c[c.k] ?? ''}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${cols.length}" style="height:140px"></td></tr>`
  return `<div class="v7card"><table class="ds-table tbl t7 v7g" style="min-width:${w}px"><colgroup>${cols.map(c => `<col style="width:${c.w || 120}px">`).join('')}</colgroup><thead><tr>${r1}</tr>${anyG ? `<tr>${r2}</tr>` : ''}</thead><tbody>${rows}</tbody>${m.foot ? `<tfoot><tr>${cols.map(c => `<td class="${c.num ? 'is-num' : ''}">${m.foot[c.k] ?? ''}</td>`).join('')}</tr></tfoot>` : ''}</table></div>`
}
const P7 = (title, body, tabs, tab) => page({ title, tabs, tab, body: CSS7 + body })

/* ═════════ the example documents of the manual ═════════ */
const GLU = { nama: 'GLUKOL LEM KERTAS SEDANG', kode: 'G10827', jml: 15, sat: 'UNIT', harga: 98000, hpp: 88094.56, disk: 0 }
const CON = { nama: 'CON FORM BESAR 14 7/8X11 3 PLY (SIDU)', kode: 'C10707', jml: 20, sat: 'UNIT', harga: 42000, hpp: 38745.68, disk: 0 }
const FP = [
  { no: 'PJL-07-08-00021', tgl: '03 Aug 2007  14:10:38', cust: 'JAYA SENTOSA TUNGGAL(8705476', kode: 'JT', lokasi: 'SURABAYA', alamat: 'RUNGKUT MADYA 115', term: 'T21', tempo: '24 Aug 2007  14:10:38', tipe: 'MATCHING',
    so: 'SO-07-08-00021', soRef: '013159/07', sj: 'SJ-07-08-00036', sjRef: '59025', sales: 'BENY/A', gudang: 'TOKO', ref: '59025', ppn: 'PPN0', ppnPct: 0, ket: '', status: 'LUNAS', cnt: [1, 2],
    lines: [GLU, CON], akun: '400001 - Penjualan Barang', sisaUM: 0,
    um: [], pel: [{ v: 'KM-07-08-00084', ref: '', tgl: '8/14/2007', kas: 'GIRO  MASUK', cek: '029016', pot: 0, bayar: 2310000, ket: '' }],
    info: [{ nama: CON.nama, kode: 'C10707', sat: 'UNIT', so: 20, sj: 20, pj: 20, sso: 0, ssj: 0, ret: 0 }, { nama: GLU.nama, kode: 'G10827', sat: 'UNIT', so: 15, sj: 15, pj: 15, sso: 0, ssj: 0, ret: 0 }] },
  { no: 'PJL-07-08-00732', tgl: '09 Aug 2007  14:47:50', cust: 'M. GRAHA NOOR', kode: 'M11', lokasi: 'SURABAYA', alamat: 'TELUK ARU SELATAN NO 1', term: 'T21', tempo: '30 Aug 2007  14:47:50', tipe: 'MATCHING',
    so: 'SO-07-08-00256', soRef: '012597/07', sj: 'SJ-07-08-00760', sjRef: 'M-03048', sales: 'KANTOR', gudang: 'Gudang1', ref: 'M-03048/07', ppn: 'PPN0', ppnPct: 0, ket: '', status: 'NEW', cnt: [1, 2], n5: 5,
    lines: [], akun: '', sisaUM: 3350000,
    um: [{ no: '17090', tgl: '7/31/2007 4:29:45 PM', ref: '', total: 21550000, apply: 18200000, sisa: 3350000 }], pel: [], info: [] },
]
const RJ = { no: 'RJ-07-08-00019', tgl: '22 Aug 2007  17:31:03', cust: 'KUNCORO,BPK SENTOSA', kode: 'K09', lokasi: 'SURABAYA', alamat: 'SURABAYA', term: 'T21', tempo: '12 Sep 2007  17:31:03', fak: 'PJL-07-08-00557', fakRef: 'M-65003',
  sales: 'KANTOR', gudang: 'Gudang1', ref: 'M-65003', ppn: 'PPN0', ket: 'BANJAR SUGIHAN NO 1', status: 'LUNAS',
  lines: [{ nama: 'CD RW ASUS 52X', kode: 'CDRW-ASUS', jml: 30, sat: 'UNIT', harga: 255000, disk: 0 }], akun: '410001 - Retur Penjualan',
  pel: [{ v: 'KM-07-09-00464', ref: '', tgl: '9/17/2007', kas: 'Kas Besar', cek: '', pot: 0, bayar: -7650000, ket: '' }] }
const CASHREC = { no: 'JL-09-05-0000', tgl: '27 May 2009  10:38', cust: 'CASH', kode: 'CSH', lokasi: 'SURABAYA', alamat: 'SURABAYA', gudang: 'TOKO', ref: '', dsk: '0', ppn: 'PPN10', ppnPct: 10, ket: '', status: 'NEW', cnt: [8, 9],
  lines: [{ barcode: '', nama: 'MONITOR PHILIPS 17" FLAT', kode: 'M-P17F', jml: 1, sat: 'UNIT', harga: 100000, disk: 0 }] }
const POSREC = { no: 'JLB-08-08-00002', tgl: '05 Aug 2008  11:01:24', dskPct: '1.00000', dskRp: 18000, status: 'NEW', cnt: [6, 12],
  lines: [{ barcode: '', nama: 'MONITOR LG 14', kode: 'M-LG 14', jml: 2, sat: 'UNIT', harga: 900000, disk: 0 }] }
const sub = l => l.jml * l.harga - (l.disk || 0)
const grossOf = ls => sumq(ls, sub)

/* ─── the item's stock and price history, opened with the right mouse button ─── */
window.v7stok = () => openSheet({
  title: 'INFO STOK dan KONVERSI', size: 'wide',
  body: `<div class="v7sub"><b style="flex:1;text-align:center">STOK GUDANG</b><b style="flex:1;text-align:center">KONVERSI</b></div><div style="display:grid;grid-template-columns:1fr 1fr;gap:24px">`
    + grid7({ cols: [{ l: 'GUDANG', w: 160 }, { l: 'STOK', w: 120, num: true }].map((c, i) => ({ ...c, k: 'k' + i })), rows: [['TOKO', 794], ['Bad Stok', 0], ['cc', 0], ['Gudang1', 1573], ['GUDANG2', 0], ['kkk', 0]].map(([g, s]) => ({ c: { k0: g, k1: f2(s) } })) })
    + grid7({ cols: [{ l: 'SATUAN', w: 120, k: 'k0' }, { l: 'JUMLAH', w: 120, num: true, k: 'k1' }], rows: [{ c: { k0: 'UNIT', k1: '1' } }] }) + '</div>',
  foot: btn('Close', 'closeSheet()'),
})
window.v7hist = () => openSheet({
  title: 'KETERANGAN', size: 'wide',
  body: grid7({
    cols: [{ l: 'NO FAKTUR', k: 'a', w: 170 }, { l: 'TANGGAL', k: 'b', w: 190 }, { l: 'JML', k: 'c', w: 80, num: true }, { l: 'SAT', k: 'd', w: 80 }, { l: 'HARGA', k: 'e', w: 120, num: true }, { l: 'DISKON 1', k: 'f', w: 110, num: true }, { l: 'DISKON %', k: 'g', w: 110, num: true }, { l: 'DISKON 2', k: 'h', w: 110, num: true }, { l: 'HARGA AKHIR', k: 'i', w: 130, num: true }],
    rows: [['PJL-07-08-00898', '30 Aug 2007  11:48:42', 3, 104500], ['PJL-07-08-00683', '24 Aug 2007  12:33:59', 8, 99900], ['PJL-07-08-00021', '03 Aug 2007  14:10:38', 15, 98000]].map(([a, b, c, e]) => ({ c: { a, b, c: f2(c), d: 'UNIT', e: f2(e), f: f2(0), g: '', h: f2(0), i: f2(e) } })),
  }),
  foot: btn('Close', 'closeSheet()'),
})

/* ═════════ shared parts of the invoice-like forms ═════════ */
const NAV = [['First', 'v7nav(\'fp\',\'first\')'], ['Prior', 'v7nav(\'fp\',\'prior\')'], ['Next', 'v7nav(\'fp\',\'next\')'], ['Last', 'v7nav(\'fp\',\'last\')']]
const detailTb = (label = 'Apply Uang Muka') => `<div class="v7dtb"><span class="mute">|◀ ◀◀ ◀ ▶ ▶▶ ▶| + − ⟳</span>${btn7('Del All', "v7soon('Del All')")}${btn7('Browse Item', '', true)}${label ? btn7(label, `v7soon('${label}')`) : ''}</div>`
const totBox = (rows) => `<div class="v7tot">${rows.map(([l, v]) => `<span>${l}</span><b>${v}</b>`).join('')}</div>`
const V = { fp: 0, fpNew: false, fpTipe: 'MATCHING', sel: 0, rj: 0, cashSel: 0, posSel: 0 }
window.v7nav = (w, d) => {
  if (w === 'fp') { const n = FP.length; V.fpNew = false; V.sel = 0; V.fp = d === 'first' ? 0 : d === 'last' ? n - 1 : d === 'next' ? Math.min(V.fp + 1, n - 1) : Math.max(V.fp - 1, 0) }
  render()
}
window.v7sel = (k, i) => { V[k] = i; render() }
window.v7new = () => { V.fpNew = true; V.fpTipe = 'MATCHING'; render() }
window.v7undo = () => { V.fpNew = false; render() }
window.v7tipe = v => { V.fpTipe = v; render() }

/* ═════════ Faktur Penjualan ═════════ */
function pgFP() {
  const draft = V.fpNew, r = draft ? { no: '', tgl: '', cust: '', kode: '', lokasi: '', alamat: '', term: '', tempo: '', tipe: V.fpTipe, so: '', soRef: '', sj: '', sjRef: '', sales: '', gudang: '', ref: '', ppn: 'PPN0', ppnPct: 0, ket: '', status: 'NEW', cnt: [1, 1], lines: [], akun: '', sisaUM: 0, um: [], pel: [], info: [] } : FP[V.fp]
  const tipe = draft ? V.fpTipe : r.tipe, ro = !draft
  const gross = grossOf(r.lines), ppn = Math.round(gross * r.ppnPct / 100)
  const total = Math.round(sumq(r.lines, sub))
  const left = [
    rw('NO FAKTUR', pair(iv(r.no), iv(r.tgl)).replace('150px', '210px')),
    rw('CUSTOMER*', pair(`<input value="${ESC(r.cust)}" ${ro ? 'readonly' : ''}>`, `<input value="${ESC(r.kode)}" ${ro ? 'readonly' : ''}>`)),
    rw('LOKASI', iv(r.lokasi)),
    rw('', `<textarea readonly>${ESC(r.alamat)}</textarea>`),
    rw('JANGKA WAKTU', sv(['T00', 'T07', 'T14', 'T21', 'T30'], r.term || 'T21', ro)),
    rw('J.TEMPO', iv(r.tempo)),
  ]
  const right = [
    rw('TIPE INVOICE', sv(['MATCHING', 'STANDARD', 'UANG MUKA'], tipe, ro, 'v7tipe(this.value)')),
    ...(tipe === 'MATCHING' || tipe === 'UANG MUKA' ? [rw('NO SO', pair(iv(r.so), iv(r.soRef)))] : []),
    ...(tipe === 'MATCHING' ? [rw('NO S.JALAN', pair(iv(r.sj), iv(r.sjRef)))] : []),
    rw('SALES', iv(r.sales)),
    rw('GUDANG', sv(['TOKO', 'Gudang1', 'GUDANG2', 'Bad Stok'], r.gudang || 'TOKO', ro)),
    rw('NO REF', iv(r.ref)),
    rw('TOTAL DISKON', `<div class="v7pct"><input readonly> % = <input readonly value="${f2(0)}" style="text-align:right"></div>`),
    rw('PPN', `<div class="v7pct">${sv(['PPN0', 'PPN10'], r.ppn, ro)}<span style="white-space:nowrap">${r.ppnPct} %</span></div>`),
    rw('KETERANGAN', iv(r.ket)),
  ]
  const tabs = [['detail', `Detail ${r.lines.length ? 1 : 0} of ${r.n5 || r.lines.length}`], ['um', 'Uang Muka'], ['pel', 'Pelunasan'], ['info', 'Info SO-SJ-INVOICE']]
  const cur = tabOf('fp7-tabs', 'detail')
  const sel = Math.min(V.sel, Math.max(0, r.lines.length - 1)), cl = r.lines[sel]
  let tabHTML = ''
  if (cur === 'detail') {
    tabHTML = grid7({
      cols: [{ l: 'NAMA ITEM*', k: 'a', w: 270 }, { l: 'KODE ITEM*', k: 'b', w: 120 }, { l: 'JUMLAH', k: 'c', w: 100, num: true }, { l: 'SATUAN', k: 'd', w: 90 }, { l: 'HARGA', k: 'e', w: 130, num: true }, { l: 'HPP', k: 'f', w: 130, num: true }, { g: 'DISKON', l: 'RP', k: 'g', w: 100, num: true }, { g: 'DISKON', l: '%', k: 'h', w: 70 }, { l: 'SUBTOTAL', k: 'i', w: 150, num: true }, { l: 'KETERANGAN', k: 'j', w: 150 }],
      rows: r.lines.map((l, i) => ({ on: `v7sel('sel',${i})`, ctx: 'v7stok()', sel: i === sel, c: { a: l.nama, b: l.kode, c: f2(l.jml), d: l.sat, e: `<span oncontextmenu="event.stopPropagation();v7hist();return false">${f2(l.harga)}</span>`, f: f2(l.hpp), g: f2(l.disk), h: '', i: f2(sub(l)), j: '' } })),
    })
  } else if (cur === 'um') {
    tabHTML = grid7({
      cols: [{ l: 'NO FAKTUR', k: 'a', w: 180 }, { l: 'TANGGAL', k: 'b', w: 210 }, { l: 'NO REFF', k: 'c', w: 180 }, { l: 'TOTAL', k: 'd', w: 170, num: true }, { l: 'YG SUDAH DIAPPLY', k: 'e', w: 180, num: true }, { l: 'SISA', k: 'f', w: 170, num: true }],
      rows: r.um.map(u => ({ c: { a: u.no, b: u.tgl, c: u.ref, d: f2(u.total), e: f2(u.apply), f: f2(u.sisa) } })),
    })
  } else if (cur === 'pel') {
    tabHTML = grid7({
      cols: [{ l: 'VOUCHER', k: 'a', w: 170 }, { l: 'NO REFF', k: 'b', w: 130 }, { l: 'TANGGAL', k: 'c', w: 130 }, { l: 'KAS/BANK', k: 'd', w: 160 }, { l: 'NO CEK/BG', k: 'e', w: 140 }, { l: 'POTONGAN', k: 'f', w: 130, num: true }, { l: 'BAYAR', k: 'g', w: 150, num: true }, { l: 'KETERANGAN', k: 'h', w: 150 }],
      rows: r.pel.map(p => ({ c: { a: p.v, b: p.ref, c: p.tgl, d: p.kas, e: p.cek, f: f2(p.pot), g: f2(p.bayar), h: p.ket } })),
    })
    const piut = r.pel.length ? total + ppn : 0, bayar = sumq(r.pel, p => p.bayar)
    tabHTML += `<div class="v7kv"><label>TOTAL PIUTANG <input readonly value="${fsp(piut)}"></label><label>TOTAL BAYAR <input readonly value="${fsp(bayar)}"></label><label>SISA <input readonly value="${r.pel.length ? Math.round(piut - bayar) : ''}"></label></div>`
  } else {
    tabHTML = grid7({
      cols: [{ l: '', k: 'x', w: 40 }, { l: 'NAMA ITEM', k: 'a', w: 280 }, { l: 'KODE ITEM', k: 'b', w: 130 }, { l: 'SATUAN', k: 'c', w: 120 }, { g: 'QTY', l: 'SO', k: 'd', w: 90, num: true }, { g: 'QTY', l: 'SJ', k: 'e', w: 90, num: true }, { g: 'QTY', l: 'PENJUALAN', k: 'f', w: 130, num: true }, { g: 'SISA', l: 'SO', k: 'g', w: 90, num: true }, { g: 'SISA', l: 'SJ', k: 'h', w: 90, num: true }, { l: 'RETUR', k: 'i', w: 120, num: true }],
      rows: r.info.map(x => ({ c: { x: '⊞', a: x.nama, b: x.kode, c: x.sat, d: f2(x.so), e: f2(x.sj), f: f2(x.pj), g: f2(x.sso), h: f2(x.ssj), i: f2(x.ret) } })),
    })
  }
  const body = tb([...NAV, ['New', 'v7new()'], ['Del', '', true], ['Filter'], ['Refresh'], ['Cash'], ['Pay'], ['Save', '', !draft], ['Undo', 'v7undo()', !draft], ['View'], ['Print'], ['Info'], ['Import']])
    + `<div class="v7tb" style="margin-top:-8px">${cnt(r.status, draft ? 1 : V.fp + 1, draft ? 1 : FP.length)}${ro ? '<span class="v7ro">READ ONLY</span>' : ''}</div>`
    + `<div class="v7f"><div>${left.join('')}</div><div>${right.join('')}</div></div>`
    + detailTb() + `<div class="sv-tabs" style="margin:8px 0 12px">${tabsHTML('fp7-tabs', tabs, cur)}</div>` + tabHTML
    + (cur === 'detail' ? `<div class="v7foot"><div class="v7acc"><span>${cl ? `${cl.kode} - ${cl.nama}` : ''}</span><span>${cl ? r.akun : ''}</span></div>${totBox([['TOTAL', f2(total)], ['PPN', f2(ppn)], ['GRAND TOTAL', f2(total + ppn)]])}</div>` : '')
    + `<div class="v7stat"><span>SISA UANG MUKA : Rp ${f0(r.sisaUM)}</span>${ro ? '<span>READ ONLY</span>' : '<span></span>'}</div>`
  return P7('Faktur Penjualan', body)
}

/* ═════════ Faktur Retur Jual ═════════ */
function pgRJ() {
  const r = RJ, total = grossOf(r.lines), cur = tabOf('rj7-tabs', 'detail')
  const left = [
    rw('NO RETUR', pair(iv(r.no), iv(r.tgl)).replace('150px', '210px')),
    rw('CUSTOMER*', pair(iv(r.cust), iv(r.kode))),
    rw('LOKASI', iv(r.lokasi)),
    rw('', `<textarea readonly>${ESC(r.alamat)}</textarea>`),
    rw('JANGKA WAKTU', sv(['T21'], r.term)),
    rw('J.TEMPO', iv(r.tempo)),
  ]
  const right = [
    rw('NO FAKTUR', pair(iv(r.fak), iv(r.fakRef))),
    rw('SALES', iv(r.sales)),
    rw('GUDANG', sv(['Gudang1', 'TOKO'], r.gudang)),
    rw('NO REF', iv(r.ref)),
    rw('TOTAL DISKON', `<div class="v7pct"><input readonly> % = <input readonly value="${f2(0)}" style="text-align:right"></div>`),
    rw('PPN', `<div class="v7pct">${sv(['PPN0', 'PPN10'], r.ppn)}<span>0 %</span></div>`),
    rw('KETERANGAN', iv(r.ket)),
  ]
  const tabs = [['detail', 'Detail 1 of 1'], ['pel', 'Pelunasan']]
  let tabHTML
  if (cur === 'detail') {
    tabHTML = grid7({
      cols: [{ l: 'NAMA ITEM*', k: 'a', w: 280 }, { l: 'KODE ITEM*', k: 'b', w: 170 }, { l: 'JUMLAH', k: 'c', w: 110, num: true }, { l: 'SATUAN', k: 'd', w: 100 }, { l: 'HARGA', k: 'e', w: 150, num: true }, { g: 'DISKON', l: 'RP', k: 'g', w: 100, num: true }, { g: 'DISKON', l: '%', k: 'h', w: 70 }, { l: 'SUBTOTAL', k: 'i', w: 160, num: true }, { l: 'KETERANGAN', k: 'j', w: 150 }],
      rows: r.lines.map((l, i) => ({ on: 'v7sel(\'rj\',' + i + ')', ctx: 'v7stok()', sel: true, c: { a: l.nama, b: l.kode, c: f2(l.jml), d: l.sat, e: `<span oncontextmenu="event.stopPropagation();v7hist();return false">${f2(l.harga)}</span>`, g: f2(l.disk), h: '', i: f2(sub(l)), j: '' } })),
    })
  } else {
    tabHTML = grid7({
      cols: [{ l: 'VOUCHER', k: 'a', w: 170 }, { l: 'NO REFF', k: 'b', w: 130 }, { l: 'TANGGAL', k: 'c', w: 130 }, { l: 'KAS/BANK', k: 'd', w: 160 }, { l: 'NO CEK/BG', k: 'e', w: 140 }, { l: 'POTONGAN', k: 'f', w: 130, num: true }, { l: 'BAYAR', k: 'g', w: 150, num: true }, { l: 'KETERANGAN', k: 'h', w: 150 }],
      rows: r.pel.map(p => ({ c: { a: p.v, b: p.ref, c: p.tgl, d: p.kas, e: p.cek, f: f2(p.pot), g: f2(p.bayar), h: p.ket } })),
    })
    tabHTML += `<div class="v7kv"><label>TOTAL PIUTANG <input readonly value="${fsp(-total)}"></label><label>TOTAL BAYAR <input readonly value="${fsp(sumq(r.pel, p => p.bayar))}"></label><label>SISA <input readonly value="0"></label></div>`
  }
  const body = tb([['First', '', true], ['Prior', '', true], ['Next'], ['Last'], ['New'], ['Del', '', true], ['Filter'], ['Refresh'], ['Cash'], ['Pay'], ['Save', '', true], ['Undo', '', true], ['View'], ['Print'], ['Info']])
    + `<div class="v7tb" style="margin-top:-8px">${cnt(r.status, 1, 1)}<span class="v7ro">READ ONLY</span></div>`
    + `<div class="v7f"><div>${left.join('')}</div><div>${right.join('')}</div></div>`
    + detailTb() + `<div class="sv-tabs" style="margin:8px 0 12px">${tabsHTML('rj7-tabs', tabs, cur)}</div>` + tabHTML
    + (cur === 'detail' ? `<div class="v7foot"><div class="v7acc"><span>${r.lines[0].kode} - ${r.lines[0].nama}</span><span>${r.akun}</span></div>${totBox([['TOTAL', f2(total)], ['PPN', f2(0)], ['GRAND TOTAL', f2(total)]])}</div>` : '')
    + `<div class="v7stat"><span>SISA UANG MUKA : Rp 0</span><span>READ ONLY</span></div>`
  return P7('Faktur Retur Jual', body)
}

/* ═════════ Penjualan Cash and Penjualan Barcode (POS) ═════════ */
function pgCash() {
  const tab = tabOf('sell-cash', 'cash'), tabs = [['cash', 'Penjualan Cash'], ['pos', 'Penjualan Barcode (POS)']]
  const stdTb = (r) => tb([['First', '', true], ['Prior'], ['Next'], ['Last'], ['New'], ['Del', '', true], ['Filter'], ['Refresh'], ['Cash'], ['Save', '', true], ['Undo', '', true], ['View'], ['Print'], ['Info'], ['Import']])
  if (tab === 'cash') {
    const r = CASHREC, tot = grossOf(r.lines), ppn = Math.round(tot * r.ppnPct / 100)
    const body = stdTb() + `<div class="v7tb" style="margin-top:-8px">${cnt(r.status, ...r.cnt)}<span class="v7ro">READ ONLY</span></div>`
      + `<div class="v7f"><div>${rw('NO FAKTUR', pair(iv(r.no), iv(r.tgl)).replace('150px', '210px'))}${rw('CUSTOMER*', pair(iv(r.cust), iv(r.kode)))}${rw('LOKASI', iv(r.lokasi))}${rw('', `<textarea readonly>${ESC(r.alamat)}</textarea>`)}${rw('KETERANGAN', iv(r.ket))}</div>`
      + `<div><div class="v7big">${f0(tot + ppn)}</div>${rw('GUDANG', sv(['TOKO', 'Gudang1'], r.gudang))}${rw('NO REF', iv(r.ref))}${rw('TOTAL DISKON', `<div class="v7pct"><input readonly value="${r.dsk}"> % = <input readonly value="${f2(0)}" style="text-align:right"></div>`)}${rw('PPN', `<div class="v7pct">${sv(['PPN0', 'PPN10'], r.ppn)}<span>${r.ppnPct} %</span></div>`)}</div></div>`
      + detailTb() + `<div class="sv-tabs" style="margin:8px 0 12px">${tabsHTML('cash7-tabs', [['d', 'Detail 1 of 1']], 'd')}</div>`
      + grid7({
        cols: [{ l: 'BARCODE*', k: 'a', w: 150 }, { l: 'NAMA ITEM*', k: 'b', w: 270 }, { l: 'KODE ITEM*', k: 'c', w: 130 }, { l: 'JML', k: 'd', w: 90, num: true }, { l: 'SATUAN', k: 'e', w: 100 }, { l: 'HARGA', k: 'f', w: 140, num: true }, { g: 'DISKON', l: 'RP', k: 'g', w: 100, num: true }, { g: 'DISKON', l: '%', k: 'h', w: 70 }, { l: 'SUBTOTAL', k: 'i', w: 150, num: true }, { l: 'KETERANGAN', k: 'j', w: 150 }],
        rows: r.lines.map((l, i) => ({ on: `v7sel('cashSel',${i})`, sel: true, c: { a: l.barcode, b: l.nama, c: l.kode, d: f2(l.jml), e: l.sat, f: f2(l.harga), g: f2(l.disk), h: '', i: f2(sub(l)), j: '' } })),
      })
      + `<div class="v7foot"><div class="v7acc"><span>${r.lines[0].kode} - ${r.lines[0].nama}</span></div><div class="v7tot" style="grid-template-columns:auto 170px auto 190px"><span>PPN</span><b>${f2(ppn)}</b><span>TOTAL</span><b>${f2(tot)}</b></div></div>`
      + `<div class="v7stat"><span>SISA UANG MUKA : Rp 0</span><span>READ ONLY</span></div>`
    return P7('Penjualan Cash', body, tabs, tab)
  }
  const r = POSREC, tot = grossOf(r.lines)
  const body = stdTb() + `<div class="v7tb" style="margin-top:-8px">${cnt(r.status, ...r.cnt)}<span class="v7ro">READ ONLY</span></div>`
    + `<div class="v7big">${f0(tot - r.dskRp)}</div>`
    + `<div class="v7f" style="grid-template-columns:auto auto 1fr;gap:12px 24px;align-items:end"><div><div class="mute">NO FAKTUR</div><div class="v7pair e" style="grid-template-columns:230px 230px">${iv(r.no)}${iv(r.tgl)}</div></div><div><div class="mute">TOTAL DISKON</div><div class="v7pct"><input readonly value="${r.dskPct}" style="width:110px"> % = <input readonly value="${f2(r.dskRp)}" style="text-align:right;width:150px"></div></div><span></span></div>`
    + detailTb() + `<div class="sv-tabs" style="margin:8px 0 12px">${tabsHTML('pos7-tabs', [['d', 'Detail 1 of 1']], 'd')}</div>`
    + grid7({
      cols: [{ l: 'BARCODE*', k: 'a', w: 150 }, { g: 'BARANG*', l: 'NAMA', k: 'b', w: 300 }, { g: 'BARANG*', l: 'KODE', k: 'c', w: 120 }, { l: 'JML', k: 'd', w: 90, num: true }, { l: 'SATU...', k: 'e', w: 100 }, { l: 'HARGA', k: 'f', w: 140, num: true }, { g: 'DISKON', l: 'RP', k: 'g', w: 100, num: true }, { g: 'DISKON', l: '%', k: 'h', w: 70 }, { l: 'SUBTOTAL', k: 'i', w: 160, num: true }],
      rows: r.lines.map((l, i) => ({ on: `v7sel('posSel',${i})`, sel: true, c: { a: l.barcode, b: l.nama, c: l.kode, d: f2(l.jml), e: l.sat, f: f2(l.harga), g: f2(l.disk), h: '', i: f2(sub(l)) } })),
    })
    + `<div class="v7foot"><div class="v7acc"><span>${r.lines[0].kode} - ${r.lines[0].nama}</span></div><div class="v7tot" style="grid-template-columns:auto 170px auto 190px"><span>PPN</span><b>${f2(0)}</b><span>TOTAL</span><b>${f2(tot)}</b></div></div>`
    + `<div class="v7stat"><span>SISA UANG MUKA : Rp 0</span><span>READ ONLY</span></div>`
  return P7('Penjualan Barcode (POS)', body, tabs, tab)
}

/* ═════════ Info Penjualan ═════════ */
const CUS = [
  ['00002', 'koko', 'ko', 'ko', '', '', '', 'T21', 500000000, 1], ['01', 'PUTRA SENTOSA JAYA/B', 'SURABAYA', 'KEDINDING LOR NO 44B', '', '', 'BENY', 'T21', 0, 1],
  ['07-07-00001', 'kkk', 'kk', 'kk', '', '', '', 'T21', 500000000, 1], ['09-09-00001', 'k', 'k', 'k', '', '', '', 'T21', 500000000, 1], ['1', '1', '1', '1', '', '', '', 'T21', 500000000, 1],
  ['2', '2', '2', '2', '', '', '', 'T21', 500000000, 1], ['23', '23', '2', '2', '', '', '', 'T21', 500000000, 1], ['3', '3', '3', '3', '', '', '', 'T21', 500000000, 1],
  ['9001', 'BAKTI PRIMA', 'SBY', 'JL. WONO PERMAI', '3333', '', 'BAKTI', 'T21', 5000000, 1], ['A', 'ABING.BPK JAYA (3521585)', 'SURABAYA', 'FAX 3555506', '', '', '', 'T21', 0, 1],
  ['A01', 'ABADI/B MAKMUR', 'SURABAYA', 'KLAMPIS', '', '', 'BENI', 'T21', 0, 1], ['A03', 'AMAN JAYA/D (3524632)', 'SURABAYA', 'JL DEMAK 236', '', '', 'DAVID', 'T21', 0, 1],
  ['A04', 'APRIAN JAYA NUR/B', 'SURABAYA', 'RUNGKUT MENANGGAL', '', '', 'BENI', 'T21', 0, 1], ['A05', 'ATLAS MAKMUR', 'SURABAYA', 'SURABAYA', '', '', '', 'T21', 0, 0],
  ['A07', 'AGUS LANGKAH TRIJAYA.BPK', 'SURABAYA', 'SIDOARJO', '', '', '', 'T21', 0, 1], ['A08', 'ABADI LANGKAH JAYA/B (8710980/', 'SURABAYA', 'PANDUGO A18', '', '', 'BENI', 'T01', 0, 1],
  ['A09', 'ARTHA GAYA KENCANA/B', 'SURABAYA', 'NGAGEL JAYA SELATAN 134', '', '', 'BENI', 'T21', 0, 1], ['A1', 'AA/D ABADI', 'SURABAYA', 'JL SIMO JAWAR 53', '', '', 'DAVID', 'T21', 0, 1],
  ['A10', 'ARTHA/B GAYA (5678878/5670428)', 'SURABAYA', 'JL MAYJEND SUNGKONO 129', '', '', 'BENI', 'T21', 0, 1], ['A11', 'ATUNG.BPK SAHABAT', 'SURABAYA', 'ABDUL KARIM 67', '', '', '', 'T21', 0, 1],
  ['A12', 'AZIZ.BPK SAHABAT', 'SURABAYA', 'SURABAYA', '', '', 'as', 'T21', 0, 0], ['A13', 'ANUGERAH JAYA JAYA M/B (692575', 'SURABAYA', 'JL MANYAR 21', '', '', 'BENI', 'T21', 0, 1],
  ['A15', 'ALEX.BPK SAHABAT', 'SURABAYA', 'LEBAK TIMUR 8/6', '', '', '', 'T21', 0, 1], ['A16', 'ANDI.BPK JAYA (8682852)', 'SURABAYA', 'GRIYO MAPAN SANTOSO NO. 5', '', '', '', 'T21', 0, 1],
  ['A17', 'ANTON.BPK SAHABAT', 'SURABAYA', 'SURABAYA', '', '', '', 'T21', 0, 1], ['A18', 'ASIA JAYA AFRIKA UD/B (5322361/5', 'SURABAYA', 'JL BASUKI RAHMAT 161', '', '', 'BENI', 'T21', 0, 1],
  ['A19', 'ARIF JAYA JAYA TOKO.B', 'SURABAYA', 'JL BRINGKANG MENGANTI', '', '', 'BENI', 'T21', 0, 1],
]
const so$ = n => (!n ? '' : Number.isInteger(n) ? f0(n) : grp(String(Math.trunc(n))) + '.' + String(n).split('.')[1])
const SOR = [
  ['31 Jan 2010', 'S-10-01-00001', 'NEW', '3', '3', '3', 'PPN10', 137500, '', 'T21', ''], ['12 Dec 2009', 'S-09-12-00001', 'NEW', 'A08', 'ABADI LANGKAH JAYA/B', 'SURABAYA', 'PPN10', 2002000, 'Fee', 'T01', ''],
  ['07 Oct 2009', 'S-09-10-00001', 'DELETE', '00002', 'koko', 'ko', 'PPN10', 0, '', 'T21', ''], ['19 Sep 2009', 'S-09-09-00001', 'NEW', 'J01', 'JAGAT ABADI BAJA.PT', 'SURABAYA', 'PPN10', 0, 'KANTOR', 'T21', ''],
  ['18 Sep 2009', 'S-09-09-00002', 'NEW', 'D12', '88 JAYA JAYA.B(5920302)', 'SURABAYA', 'PPN10', 137500, 'BENY/A', 'T21', ''], ['13 Aug 2009', 'S-09-08-00001', 'NEW', '23', '23', '2', 'PPN10', 330000, '', 'T21', ''],
  ['19 Dec 2008', 'S-08-12-00001', 'COMPLETE', 'S32', 'SAHABAT GAYA JAYA', 'BANGKALAN', 'PPN10', 5500, 'KANTOR', 'T21', ''], ['06 Oct 2008', 'S-08-10-00001', 'COMPLETE', 'CSH', 'CASH', 'SURABAYA', 'PPN0', 0, 'KANTOR', 'T00', 'R001'],
  ['19 Sep 2008', 'S-08-09-00002', 'NEW', 'D12', '88 JAYA JAYA.B(5920302)', 'SURABAYA', 'PPN0', 5000, 'BENY/A', 'T21', ''], ['11 Sep 2008', 'S-08-09-00001', 'NEW', 'M02', 'MAJU GRAHA SANTOSA', 'SURABAYA', 'PPN0', 520000, 'BENY/A', 'T21', ''],
  ['29 Aug 2008', 'S-08-08-00002', 'NEW', 'A37', 'AAB.BPK JAYA', 'SURABAYA', 'PPN0', 400, 'KANTOR', 'T21', ''], ['27 Aug 2008', 'S-08-08-00001', 'NEW', 'M22', 'MAJU LANGKAH JAYA K', 'SURABAYA', 'PPN0', 0, 'BENY/A', 'T21', ''],
  ['24 Jun 2008', 'S-08-06-00001', 'PARTIAL', 'M11', 'M. GRAHA NOOR', 'SURABAYA', 'PPN0', 45785.65, 'KANTOR', 'T21', ''], ['11 Mar 2008', 'S-08-03-00001', 'COMPLETE', 'M91', 'AGUNG EDY', 'WASIOR', 'PPN0', 1444000, 'Fee', 'T21', ''],
  ['03 Feb 2008', 'S-08-02-00001', 'PARTIAL', 'S32', 'SAHABAT GAYA JAYA', 'BANGKALAN', 'PPN0', 117800, 'KANTOR', 'T21', ''], ['28 Jan 2008', 'S-08-01-00004', 'DELETE', 'K38', 'AGUNG BARUK', 'SBY', 'PPN0', 0, 'KANTOR', 'T21', ''],
  ['28 Jan 2008', 'S-08-01-00003', 'NEW', 'A', 'ABING.BPK JAYA (35215', 'SURABAYA', 'PPN0', 320.4, 'KANTOR', 'T21', ''], ['28 Jan 2008', 'S-08-01-00002', 'DELETE', 'A01', 'ABADI/B MAKMUR', 'SURABAYA', 'PPN0', 0, 'BENY/A', 'T21', ''],
  ['28 Jan 2008', 'S-08-01-00001', 'DELETE', 'A37', 'AAB.BPK JAYA', 'SURABAYA', 'PPN0', 0, 'KANTOR', 'T21', ''],
  ['14 Nov 2007', 'SO-07-11-00402', 'PARTIAL', 'H06', 'HOSANA(8436595)/B INI', 'SURABAYA', 'PPN0', 127475000, 'BENY/A', 'T21', '005750.07'], ['14 Nov 2007', 'SO-07-11-00401', 'COMPLETE', 'C05', 'CONBLOK MAJU PT', 'SURABAYA', 'PPN0', 38190000, 'KANTOR', 'T01', '005603.07.1'],
  ['14 Nov 2007', 'SO-07-11-00400', 'PARTIAL', 'J19', 'JAYA JAYA ABADI M.B', 'SURABAYA', 'PPN0', 274465000, 'BENY/A', 'T21', '005739.07'], ['14 Nov 2007', 'SO-07-11-00399', 'COMPLETE', 'TS', 'SONI SENTOSA TOKO/', 'SURABAYA', 'PPN0', 4850000, 'BENY/B', 'T21', '005755.07'],
  ['14 Nov 2007', 'SO-07-11-00398', 'COMPLETE', 'BSM', 'BAJA SENTOSA SEJAHT', 'SURABAYA', 'PPN0', 10099200, 'KANTOR', 'T21', '005720.07'], ['14 Nov 2007', 'SO-07-11-00397', 'PARTIAL', 'B48', 'BRC.PT SENTOSA (5915', 'SURABAYA', 'PPN0', 6335000, 'KANTOR', 'T21', '015143.07'],
  ['14 Nov 2007', 'SO-07-11-00396', 'COMPLETE', 'S84', 'SPM JAYA (8499588/843', 'SURABAYA', 'PPN0', 4131000, 'KANTOR', 'T21', '005724.07'], ['14 Nov 2007', 'SO-07-11-00395', 'COMPLETE', 'S20', 'SARANA LANGKAH BAN', 'SURABAYA', 'PPN0', 3250000, 'KANTOR', 'T21', '005656.07'],
]
const HAN = ['H03', 'HANDI.BPK(7407682) INI', 'SURABAYA']
const PJR = [
  ['27 Jul 2007', 'PJL-07-09-00619', 'DELETE', 'M09', 'MERK MAKMUR MA', 'SORONG', 'TOKO', '17 Aug 2007', '', 'PPN0', 0], ['30 Jul 2007', 'PJL-07-09-00425', 'LUNAS', ...HAN, 'TOKO', '20 Aug 2007', '', 'PPN0', 247000],
  ['30 Jul 2007', 'PJL-99-12-00001', 'NEW', ...HAN, 'TOKO', '20 Aug 2007', '', 'PPN0', 0], ['30 Jul 2007', '17089', 'LUNAS', ...HAN, 'TOKO', '20 Aug 2007', '', 'PPN0', 2700000],
  ['31 Jul 2007', '17088', 'LUNAS', ...HAN, 'TOKO', '21 Aug 2007', '', 'PPN0', 830250], ['31 Jul 2007', '17090', 'LUNAS', 'M11', 'M. GRAHA NOOR', 'SURABAYA', 'TOKO', '21 Aug 2007', '', 'PPN0', 21550000],
  ['31 Jul 2007', '17091', 'LUNAS', 'S05', 'SETIA MAKMUR JAYA(5929040/592', 'SURABAYA', 'TOKO', '21 Aug 2007', '', 'PPN0', 86263500], ['01 Aug 2007', 'PJL-07-08-00268', 'LUNAS', 'B14', 'BANUWA GAYA AGUNG', 'SURABAYA', 'TOKO', '22 Aug 2007', 'A-03165/07', 'PPN0', 5610000],
  ['02 Aug 2007', 'PJL-07-08-00057', 'LUNAS', 'S17', 'SINAR MAKMUR TERANG', 'SURABAYA', 'Gudang1', '23 Aug 2007', 'M-03021/07', 'PPN0', 5587500], ['02 Aug 2007', 'PJL-07-08-00041', 'LUNAS', 'J06', 'JOYO ABADI MAS RGKT', 'SURABAYA', 'TOKO', '23 Aug 2007', 'A-02981/07', 'PPN0', 1725000],
  ['02 Aug 2007', 'PJL-07-08-00042', 'LUNAS', 'C21', 'AGUNG OKSIGEN/D', 'MOJOKERTO', 'TOKO', '23 Aug 2007', '58043/07', 'PPN0', 5150000], ['02 Aug 2007', 'PJL-07-08-00043', 'LUNAS', 'M03', 'MAKMUR.B GRAHA (593', 'SURABAYA', 'TOKO', '23 Aug 2007', 'A-02983/07', 'PPN0', 1225000],
  ['02 Aug 2007', 'PJL-07-08-00044', 'DELETE', 'CSH', 'CASH', 'SURABAYA', 'TOKO', '02 Aug 2007', 'A-02980/07', 'PPN0', 0], ['02 Aug 2007', 'PJL-07-08-00045', 'LUNAS', 'L08', 'LUMINTU JAYA TOKO', 'SURABAYA', 'TOKO', '02 Aug 2007', 'A-02984/07', 'PPN0', 156000],
  ['02 Aug 2007', 'PJL-07-08-00046', 'LUNAS', 'J03', 'JAYA ABADI ABADI.B 031-8492758/8480128', 'SURABAYA', 'TOKO', '23 Aug 2007', 'A-02985/07', 'PPN0', 245000], ['02 Aug 2007', 'PJL-07-08-00047', 'NEW', 'CSH', 'CASH', 'SURABAYA', 'TOKO', '23 Aug 2007', 'A-02988/07/CSH', 'PPN0', 0],
  ['02 Aug 2007', 'PJL-07-08-00048', 'LUNAS', 'A20', 'ANEKA JAYA UD.B (8662', 'SURABAYA', 'TOKO', '23 Aug 2007', '58041/07', 'PPN0', 2752500], ['02 Aug 2007', 'PJL-07-08-00049', 'LUNAS', 'P25', 'LOOK.BPK CORP.', 'SURABAYA', 'TOKO', '23 Aug 2007', '58042/07', 'PPN0', 991500],
  ['02 Aug 2007', 'PJL-07-08-00050', 'LUNAS', 'C21', 'AGUNG OKSIGEN/D', 'MOJOKERTO', 'TOKO', '23 Aug 2007', '58045/07', 'PPN0', 5000000], ['02 Aug 2007', 'PJL-07-08-00051', 'LUNAS', 'H06', 'HOSANA(8436595)/B INI', 'SURABAYA', 'TOKO', '23 Aug 2007', '58046/07', 'PPN0', 6025000],
  ['02 Aug 2007', 'PJL-07-08-00054', 'LUNAS', 'T21', 'TEGUH SENTOSA ANUG', 'SURABAYA', 'Gudang1', '23 Aug 2007', 'M-55039/07', 'PPN0', 4748500], ['02 Aug 2007', 'PJL-07-08-00055', 'LUNAS', 'S69', 'SINAR MAKMUR MULIA', 'SURABAYA', 'Gudang1', '23 Aug 2007', 'M-55040/07', 'PPN0', 1552500],
  ['02 Aug 2007', 'PJL-07-08-00056', 'LUNAS', 'Abg', 'ANANG.BPK MULYO', 'SURABAYA', 'Gudang1', '23 Aug 2007', 'M-03022/07', 'PPN0', 12508500], ['02 Aug 2007', 'PJL-07-08-00058', 'LUNAS', 'B52', 'BANGUN SENTOSA PEF', 'SURABAYA', 'Gudang1', '23 Aug 2007', 'M-03020/07', 'PPN0', 3975000],
  ['02 Aug 2007', 'PJL-07-08-00059', 'LUNAS', 'B03', 'BANGUN JAYA PERSAD', 'SURABAYA', 'Gudang1', '23 Aug 2007', 'M-03019/07', 'PPN0', 4850000], ['02 Aug 2007', 'PJL-07-08-00060', 'LUNAS', 'SMD', 'SAMUDAYA.BPK MULYC', 'SURABAYA', 'Gudang1', '23 Aug 2007', 'M-03018/07', 'PPN0', 2750000],
  ['02 Aug 2007', 'PJL-07-08-00061', 'LUNAS', 'C10', 'CENTRA MAKMUR GALA', 'SURABAYA', 'Gudang1', '23 Aug 2007', 'M-03017/07', 'PPN0', 3852500],
]
const KM = [
  ['7/30/2007', 'KM-07-09-00429', 'PJL-07-09-00425', 'Kas Besar', 'HANDI.BPK(7407682) INDAH', 'H03', 'SURABAYA', 247000, 0, 247000, ''], ['7/31/2007', '8530', '17089', 'Kas Besar', 'HANDI.BPK(7407682) INDAH', 'H03', 'SURABAYA', 2700000, 0, 2700000, ''],
  ['7/31/2007', 'KM-07-08-00565', '17090', 'Kas Besar', 'M. GRAHA NOOR', 'M11', 'SURABAYA', 21550000, 0, 21550000, ''], ['7/31/2007', 'KM-07-08-00566', '17091', 'Kas Besar', 'SETIA MAKMUR JAYA(5929040/592', 'S05', 'SURABAYA', 86263500, 0, 86263500, ''],
  ['7/31/2007', '8530', '17088', 'Kas Besar', 'HANDI.BPK(7407682) INDAH', 'H03', 'SURABAYA', 830250, 0, 830250, ''], ['8/2/2007', 'KM-07-08-00750', '0707727', 'GIRO  MASUK', 'ANANG.BPK TERANG (70666871)', 'A43', 'MADURA', 10601000, 0, 10601000, 'KM-07-08-00004'],
  ['8/2/2007', 'KM-07-08-00009', '0706719', 'Kas Besar', 'JAYA.B PUTRA', 'J15', 'MADURA', 4260000, 0, 4260000, ''], ['8/2/2007', 'KM-07-08-00006', '0706478', 'GIRO  MASUK', 'ASIA JAYA AFRIKA UD/B (5322361/5', 'A18', 'MADURA', 5379600, 0, 5379950, '207999'],
  ['8/2/2007', 'KM-07-08-00003', '0706578', 'Kas Besar', 'SURYA GRAHA JAYA', 'S15', 'MADURA', 2000000, 0, 4450000, ''], ['8/2/2007', 'KM-07-08-00013', '0707008', 'GIRO  MASUK', 'INDRA JAYA JAYA.B', 'I09', 'MADURA', 900000, 0, 900000, '0438670'],
  ['8/2/2007', 'KM-07-08-00012', '0707204', 'GIRO  MASUK', 'INDRA JAYA JAYA.B', 'I09', 'MADURA', 2991800, 13200, 3005000, '043869'], ['8/2/2007', 'KM-07-08-00010', '0707256', 'Kas Besar', 'LINTANG GRAHA MAS/B (8492072)', 'L01', 'MADURA', 242500, 0, 242500, ''],
  ['8/2/2007', 'KM-07-08-00013', '0707025', 'GIRO  MASUK', 'INDRA JAYA JAYA.B', 'I09', 'MADURA', 1951800, 13200, 1965000, '0438670'], ['8/2/2007', 'KM-07-08-00444', '707489', 'Kas Besar', 'YANTO JAYA WONOAYU', 'Y06', 'MADURA', 132000, 0, 132000, ''],
  ['8/2/2007', 'KM-07-08-00006', '0706465', 'GIRO  MASUK', 'ASIA JAYA AFRIKA UD/B (5322361/5', 'A18', 'MADURA', 3930000, 0, 3930000, '207999'], ['8/2/2007', 'KM-07-08-00005', '705417', 'Kas Besar', 'CITRA TERANG SINAR MULYO (752', 'C17', 'MADURA', 442850, 0, 442850, ''],
  ['8/2/2007', 'KM-07-08-00162', '0706865', 'Bank BCA', 'ABING.BPK JAYA (3521585)', 'A', 'MADURA', 5350000, 0, 5350000, ''], ['8/2/2007', '7561', '0706478', 'Kas Besar', 'ASIA JAYA AFRIKA UD/B (5322361/5', 'A18', 'MADURA', 350, 0, 5379950, ''],
  ['8/2/2007', 'KM-07-08-00515', 'PJL-07-08-00776', 'Kas Besar', 'AGUNG PRATAMA', 'B53', 'SURABAYA', 1290000, 0, 1290000, ''], ['8/2/2007', 'KM-07-08-00012', '0707240', 'GIRO  MASUK', 'INDRA JAYA JAYA.B', 'I09', 'MADURA', 3330000, 0, 3330000, '043869'],
  ['8/2/2007', 'KM-07-08-00007', '707030', 'Kas Besar', 'CAHAYA MAKMUR BARU/JUMADI/E', 'J24', 'MADURA', 2177500, 0, 2177500, ''], ['8/2/2007', 'KM-07-08-00013', '0707060', 'GIRO  MASUK', 'INDRA JAYA JAYA.B', 'I09', 'MADURA', 2210000, 0, 2210000, '0438670'],
  ['8/2/2007', 'KM-07-08-00163', '0705783', 'Bank BCA', 'ROSYID,BPK TERANG (PROYEK)', 'R24', 'MADURA', 2475000, 0, 2475000, ''], ['8/2/2007', 'KM-07-08-00002', '0707126', 'GIRO  MASUK', 'BINTANG GAYA TERANG.B (858223', 'B22', 'MADURA', 431250, 0, 431250, '056879'],
  ['8/2/2007', 'KM-07-08-00011', '0706605', 'Kas Besar', 'JOYO ABADI MAS WARU.B', 'J07', 'MADURA', 727500, 0, 727500, ''], ['8/2/2007', 'KM-07-08-00161', '0706871', 'Bank BCA', 'ABING.BPK JAYA (3521585)', 'A', 'MADURA', 20400000, 0, 20400000, ''],
  ['8/2/2007', 'KM-07-08-00008', '0706842', 'Kas Besar', 'SINAR MAKMUR TERANG M.B (5022', 'S17', 'MADURA', 621000, 0, 621000, ''],
]
const SMP = [
  ['2', '2', 5500, 0, 0], ['3', '3', 53900, 0, 0], ['88 JAYA JAYA.B(5920302)', 'D12', 0, 11000, 88.88], ['AA/D ABADI', 'A1', 3370000, 2000000, 0], ['AAB.BPK JAYA', 'A37', 0, 3666.3, 0], ['ABADI LANGKAH JAYA/B (8710980/', 'A08', 0, 0, 0],
  ['ABADI/B MAKMUR', 'A01', 36175000, 0, 0], ['ABING.BPK JAYA (3521585)', 'A', 20750000, 0, 0], ['ADI JAYA TEKNIK', 'AJT', 20663.2, 0, 0], ['ADI SENTOSA JAYA (8987947)/D', 'AD', 1234100, 0, 0], ['AGUNG ANUGERAH PT', 'D20', 0, 0, 0],
  ['AGUNG BANGUNAN', 'CB', 1220000, 0, 0], ['AGUNG DESI)', 'S101', 0, 0, 0], ['AGUNG EDY', 'M91', 2494000, 0, 0], ['AGUNG JAYA SENTOSA', 'M89', 13444500, 0, 0], ['AGUNG KEREP', 'SAC', 0, 0, 0], ['AGUNG MANDIRI', 'B60', 0, 0, 0],
  ['AGUNG MARGO', 'Y14', 0, 0, 0], ['AGUNG MAS/B', 'R37', 2918000, 0, 0], ['AGUNG OKSIGEN/D', 'C21', 0, 0, 0], ['AGUNG PLASTIK PABRIK', 'A58', 0, 0, 0], ['AGUNG PRAPTO', 'SC2', 495000, 0, 0], ['AGUNG PRATAMA', 'B53', 0, 0, 0],
  ['AGUNG PT', 'A50', 0, 0, 0], ['AGUNG ROKHIM,BPK', 'A51', 0, 0, 0], ['AGUNG SAN BPK.', 'G16', 5906000, 0, 0], ['AGUNG TOKO', 'J36', 0, 0, 0], ['AGUNG TUNGGAL', 'SD2', 1357500, 0, 0],
]
const BKM7 = 'BKM (Bukti Kas/Bank Masuk)', FPJ = 'Faktur Penjualan'
const KP = [
  ['', '', 'SALDO', 8535000, 0, 8535000, 'SALDO AWAL'],
  ['03 Aug 2007', 'PJL-07-08-00016', FPJ, 987500, 0, 9522500, ''], ['08 Aug 2007', 'PJL-07-08-00210', FPJ, 1225000, 0, 10747500, ''], ['13 Aug 2007', 'KM-07-08-00079', BKM7, 0, 1485000, 9262500, "'0707323"],
  ['14 Aug 2007', 'PJL-07-08-00374', FPJ, 1637500, 0, 10900000, ''], ['15 Aug 2007', 'PJL-07-08-00427', FPJ, 825000, 0, 11725000, ''], ['18 Aug 2007', 'PJL-07-08-00494', FPJ, 735000, 0, 12460000, ''],
  ['20 Aug 2007', 'KM-07-08-00296', BKM7, 0, 1502500, 10957500, "'0707527"], ['20 Aug 2007', 'KM-07-08-00296', BKM7, 0, 645000, 10312500, "'0707557"], ['21 Aug 2007', 'PJL-07-08-00561', FPJ, 840000, 0, 11152500, ''],
  ['24 Aug 2007', 'PJL-07-08-00637', FPJ, 0, 0, 11152500, ''], ['25 Aug 2007', 'PJL-07-08-00736', FPJ, 1485000, 0, 12637500, ''], ['28 Aug 2007', 'KM-07-08-00585', BKM7, 0, 417500, 12220000, "'0707623"],
  ['28 Aug 2007', 'KM-07-08-00585', BKM7, 0, 1470000, 10750000, "'0707884"], ['28 Aug 2007', 'KM-07-08-00585', BKM7, 0, 3015000, 7735000, "'0707812"], ['31 Aug 2007', 'PJL-07-08-00943', FPJ, 2920000, 0, 10655000, ''],
  ['04 Sep 2007', 'KM-07-09-00063', BKM7, 0, 1225000, 9430000, 'PJL-07-08-00210'], ['04 Sep 2007', 'KM-07-09-00063', BKM7, 0, 987500, 8442500, 'PJL-07-08-00016'], ['11 Sep 2007', 'KM-07-09-00214', BKM7, 0, 825000, 7617500, 'PJL-07-08-00427'],
  ['11 Sep 2007', 'KM-07-09-00214', BKM7, 0, 1637500, 5980000, 'PJL-07-08-00374'], ['19 Sep 2007', 'KM-07-09-00419', BKM7, 0, 1485000, 4495000, 'PJL-07-08-00736'], ['19 Sep 2007', 'KM-07-09-00419', BKM7, 0, 840000, 3655000, 'PJL-07-08-00561'],
  ['19 Sep 2007', 'KM-07-09-00419', BKM7, 0, 735000, 2920000, 'PJL-07-08-00494'], ['25 Sep 2007', 'PJL-07-09-00591', FPJ, 2650000, 0, 5570000, ''],
]
const IV = { so: { all: true, cust: false, out: false }, pj: { all: true, cust: false, pen: false, ret: false }, pl: { all: true, cust: false } }
window.v7opt = (a, b) => { const o = IV[a]; if (b === 'all') o.all = !o.all; else o[b] = !o[b]; render() }
const ck = (a, b, label) => `<label class="ds-check">${chk(IV[a][b], `onchange="v7opt('${a}','${b}')"`)} ${label}</label>`
const dts = (a) => `<span class="v7d">${ck(a, 'all', 'All')}<input readonly value="01 Feb 2016"> ▾ <input readonly value="29 Feb 2016"> ▾</span>`
const infoTb = (n) => tb([['First', '', true], ['Prior', '', true], ['Next'], ['Last'], ['Search'], ['Filter'], ['Refresh'], ['◆'], ['Go to', '', true], ['Format'], ['Default'], ['XLS']]) + `<div class="v7tb" style="margin-top:-8px"><span class="v7cnt"><span>1 of ${n}</span></span></div>`
const cusBar = `<div class="v7opts"><input readonly value="500" style="width:120px;height:40px;padding:0 12px;border:1px solid var(--hairline-2);border-radius:var(--r-inner)"><b>00002 koko</b></div>`
function pgInfo() {
  const tab = tabOf('sell-info', 'customer')
  const tabs = [['customer', 'CUSTOMER'], ['so', 'SO'], ['penjualan', 'PENJUALAN & RETUR'], ['pelunasan', 'PELUNASAN PIUTANG'], ['summary', 'SUMMARY PIUTANG'], ['kartu', 'KARTU PIUTANG']]
  let inner = ''
  if (tab === 'customer') {
    inner = infoTb(500) + cusBar + `<div class="v7opts">${btn7('Customer Baru', "v7soon('Customer Baru')")}</div>`
      + grid7({
        cols: [{ l: '', k: 'x', w: 40 }, { l: 'KODE', k: 'a', w: 120 }, { l: 'NAMA', k: 'b', w: 260 }, { l: 'LOKASI', k: 'c', w: 110 }, { l: 'ALAMAT', k: 'd', w: 240 }, { l: 'PHONE', k: 'e', w: 100 }, { l: 'FAX', k: 'f', w: 100 }, { l: 'KONTAK', k: 'g', w: 110 }, { l: 'TERMIN', k: 'h', w: 90 }, { l: 'BATAS PIUTANG', k: 'i', w: 170, num: true }, { l: 'AKTIF', k: 'j', w: 80 }],
        rows: CUS.map(c => ({ c: { x: '⊞', a: c[0], b: c[1], c: c[2], d: c[3], e: c[4], f: c[5], g: c[6], h: c[7], i: f2(c[8]), j: chk(c[9]) } })),
      })
  } else if (tab === 'so') {
    const o = IV.so
    const rows = SOR.filter(r => !o.out || r[2] === 'NEW' || r[2] === 'PARTIAL')
    inner = infoTb(500) + cusBar + `<div class="v7opts">${ck('so', 'cust', 'Customer')}${ck('so', 'out', 'Outstanding')}${dts('so')}${btn7('Close SO', "v7soon('Close SO')")}${btn7('Tambah', "v7soon('Tambah')")}</div>`
      + grid7({
        cols: [{ l: '', k: 'x', w: 40 }, { l: 'TANGGAL', k: 'a', w: 130 }, { l: 'NO SO', k: 'b', w: 150 }, { l: 'STATUS SO', k: 'c', w: 120 }, { g: 'CUSTOMER', l: 'KODE', k: 'd', w: 80 }, { g: 'CUSTOMER', l: 'NAMA', k: 'e', w: 220 }, { g: 'CUSTOMER', l: 'LOKASI', k: 'f', w: 110 }, { l: 'PPN', k: 'g', w: 90 }, { l: 'TOTAL', k: 'h', w: 130, num: true }, { l: 'SALES', k: 'i', w: 100 }, { l: 'JANGKA', k: 'j', w: 90 }, { l: 'NO REF', k: 'k', w: 130 }],
        rows: rows.map(r => ({ c: { x: '⊞', a: r[0], b: r[1], c: r[2], d: r[3], e: r[4], f: r[5], g: r[6], h: so$(r[7]), i: r[8], j: r[9], k: r[10] } })),
      })
  } else if (tab === 'penjualan') {
    inner = infoTb(500) + cusBar + `<div class="v7opts">${ck('pj', 'cust', 'Customer')}${ck('pj', 'pen', 'Penjualan')}${ck('pj', 'ret', 'Retur')}${dts('pj')}${btn7('Nota Baru', "go('sell-invoice')")}${btn7('Retur Baru', "go('sell-return')")}</div>`
      + grid7({
        cols: [{ l: '', k: 'x', w: 40 }, { l: 'TANGGAL', k: 'a', w: 130 }, { l: 'NO FAKTUR', k: 'b', w: 170 }, { l: 'STATUS', k: 'c', w: 100 }, { l: 'SHIFT', k: 'sh', w: 80 }, { g: 'CUSTOMER', l: 'KODE', k: 'd', w: 80 }, { g: 'CUSTOMER', l: 'NAMA', k: 'e', w: 230 }, { g: 'CUSTOMER', l: 'LOKASI', k: 'f', w: 110 }, { l: 'GUDANG', k: 'g', w: 110 }, { l: 'JATUH TEMPO', k: 'h', w: 130 }, { l: 'NO REF', k: 'i', w: 150 }, { l: 'PPN', k: 'j', w: 90 }, { l: 'TOTAL', k: 'k', w: 130, num: true }, { l: 'DISKON', k: 'l', w: 100, num: true }, { l: 'TOTAL BERSIH', k: 'm', w: 140, num: true }],
        rows: PJR.map(r => ({ c: { x: '⊞', a: r[0], b: r[1], c: r[2], sh: '', d: r[3], e: r[4], f: r[5], g: r[6], h: r[7], i: r[8], j: r[9], k: r[10] ? f0(r[10]) : '', l: '', m: r[10] ? f2(r[10]) : '.00' } })),
      })
  } else if (tab === 'pelunasan') {
    inner = infoTb(500) + cusBar + `<div class="v7opts">${ck('pl', 'cust', 'Customer')}${dts('pl')}${btn7('Pencairan Giro', "go('giro-board')")}</div>`
      + grid7({
        cols: [{ l: '', k: 'x', w: 40 }, { l: 'TGL TERIMA', k: 'a', w: 120 }, { l: 'NO VOUCER', k: 'b', w: 160 }, { l: 'NO_FAKTUR', k: 'c', w: 170 }, { l: 'BANK', k: 'd', w: 130 }, { g: 'CUSTOMER', l: 'NAMA', k: 'e', w: 260 }, { g: 'CUSTOMER', l: 'KODE', k: 'f', w: 80 }, { g: 'CUSTOMER', l: 'LOKASI', k: 'g', w: 110 }, { l: 'NILAI', k: 'h', w: 130, num: true }, { l: 'POTONGAN', k: 'i', w: 110, num: true }, { l: 'NILAI FAKTUR', k: 'j', w: 140, num: true }, { l: 'NO REFERENSI', k: 'k', w: 160 }],
        rows: KM.map(r => ({ c: { x: '⊞', a: r[0], b: r[1], c: r[2], d: r[3], e: r[4], f: r[5], g: r[6], h: f0(r[7]), i: r[8] ? f0(r[8]) : '', j: f0(r[9]), k: r[10] } })),
      })
  } else if (tab === 'summary') {
    inner = tb([['First', '', true], ['Prior', '', true], ['Next'], ['Last'], ['Search'], ['Filter'], ['◆'], ['Go to', '', true], ['Format'], ['Default'], ['XLS']]) + `<div class="v7tb" style="margin-top:-8px"><span class="v7cnt"><span>1 of 342</span></span></div>` + cusBar
      + `<div class="v7opts"><span>PERIODE</span>${sv(['DEC 2009', 'JAN 2010', 'FEB 2016'], 'DEC 2009', false, "v7soon('PERIODE')")}<span>SAMPAI TANGGAL</span><span class="v7d"><input readonly value="10 Feb 2016"> ▾</span>${btn7('Refresh', "v7soon('Refresh')")}</div>`
      + grid7({
        cols: [{ g: 'CUSTOMER', l: 'NAMA', k: 'a', w: 300 }, { g: 'CUSTOMER', l: 'KODE', k: 'b', w: 110 }, { l: 'SALDO AWAL', k: 'c', w: 160, num: true }, { l: 'DEBET', k: 'd', w: 150, num: true }, { l: 'KREDIT', k: 'e', w: 150, num: true }, { l: 'SALDO AKHIR', k: 'f', w: 160, num: true }],
        rows: SMP.map(r => ({ c: { a: r[0], b: r[1], c: f2(r[2]), d: f2(r[3]), e: f2(r[4]), f: f2(r[2] + r[3] - r[4]) } })),
      })
  } else {
    inner = tb([['First', '', true], ['Prior', '', true], ['Next'], ['Last'], ['Search'], ['Filter'], ['◆'], ['Go to', '', true], ['Format'], ['Default'], ['XLS']]) + `<div class="v7tb" style="margin-top:-8px"><span class="v7cnt"><span>1 of 51</span></span></div>` + cusBar
      + `<div class="v7opts"><span>CUSTOMER</span><span class="v7d"><input readonly value="88 JAYA JAYA.B(5920302)" style="width:300px"> …</span></div><div class="v7opts"><span>PERIODE</span>${sv(['JUL 2007', 'AUG 2007', 'SEP 2007'], 'JUL 2007', false, "v7soon('PERIODE')")}<span>SAMPAI TANGGAL</span><span class="v7d"><input readonly value="10 Feb 2016"> ▾</span>${btn7('Refresh', "v7soon('Refresh')")}</div>`
      + grid7({
        cols: [{ l: 'TANGGAL', k: 'a', w: 130 }, { l: 'NO TRANSAKSI', k: 'b', w: 170 }, { l: 'TRANSAKSI', k: 'c', w: 250 }, { l: 'DEBET', k: 'd', w: 140, num: true }, { l: 'KREDIT', k: 'e', w: 140, num: true }, { l: 'SALDO AKHIR', k: 'f', w: 150, num: true }, { l: 'KETERANGAN', k: 'g', w: 200 }],
        rows: KP.map(r => ({ c: { a: r[0], b: r[1], c: r[2], d: f2(r[3]), e: f2(r[4]), f: f2(r[5]), g: r[6] } })),
      })
      + `<div class="v7kv"><label>AWAL <input readonly value="8 535 000.00"></label><label>DEBET <input readonly value="29 998 172.00"></label><label>KREDIT <input readonly value="38 522 260.88"></label><label>AKHIR <input readonly value="10 911.12"></label></div>`
  }
  return P7('Info Penjualan', inner, tabs, tab)
}

/* ═════════ Laporan Penjualan ═════════ */
const RL = [
  ['Laporan Harian Detail Penjualan Item', 'Barang (Plus Retur)', 'dj'], ['Summary Penjualan', '', 'dfcgj'], ['Cetak Invoice Penjualan', 'Cetak Ulang Nota Penjualan', 'df'], ['Laporan Nota Penjualan', '', 'dj'], ['Rekap Detail Faktur Penjualan', '', 'dj'],
  ['Laporan Nilai Surat Jalan', 'PREMIUM', 'dk'], ['Laporan Penjualan tiap  User', 'untuk POS, Omzet tiap Operator', 'd'], ['Laporan Penjualan Bulanan', 'Penjualan selama 1 tahun + Grafik', 'mj'], ['Summary Penjualan PPN', '', 'd'],
  ['Penjualan Barang dan Jasa', '', 'd'], ['Laporan Harian Penjualan Item Detil Customer', 'Barang (Plus Retur)', 'dj'], ['Laporan Harian Penjualan Per Customer Detil Item', 'Barang (Plus Retur)', 'dj'],
  ['Laporan Bulanan Penjualan Item Detil Customer', 'Barang (Plus Retur)', 'mj'], ['Laporan Bulanan Penjualan Per Customer Detil Item', 'Barang (Plus Retur)', 'mj'], ['Laporan Summary SO', 'SO', 'd'], ['Laporan Detail SO', 'SO', 'dj'],
  ['Laporan Realisasi SO', 'SO - Premium', 'd'], ['SO Outstanding', 'SO - Pesanan Customer yang belum terpenuhi', 'dj'], ['SJ Outstanding Premium', 'SJ - Pesanan Customer yang belum dikirim', 'd'], ['Perbandingan SO Outstanding dengan stok saat ini', 'SO OUTSTANDING', ''],
  ['Laporan Komisi sales', 'Omzet Sales default 1% Jika pelunasan < 15hari J.tempo', 'ds'], ['Laporan Komisi sales berdasarkan tanggal BKM', 'Omzet Sales default 1% Jika pelunasan < 15hari J.tempo', 'ds'], ['Laporan Hasil Omzet sales', 'Omzet Sales', 'd'],
  ['Laporan Omzet Sales Group Customer', 'Omzet Sales - Grup Customer', 'd'], ['Laporan Omzet Sales Group Item', 'Omzet Sales - Grup Item', 'd'], ['Laporan Omzet Sales NOL', 'Omzet Sales', 'd'], ['Laporan Omzet Sales Nol Per Rayon', 'Hasil Sales', 'd'],
  ['Laporan Omset Penjualan Per Kota', '', 'd'],
  /* the screenshot stops at 28; the next ones are named in the manual, in its order */
  ['Laporan Summary Uang Muka Penjualan', '', 'd'], ['Laporan Summary Outstanding Uang Muka Penjualan', '', 'd'], ['Laporan Detail Uang Muka Penjualan', '', 'd'], ['Laporan Detail Outstanding Uang Muka Penjualan', '', 'd'],
  ['Laporan Summary Retur Penjualan', '', 'dfcgj'], ['Laporan Detail Retur Penjualan', '', 'dj'], ['Piutang Jatuh Tempo', '', 't'], ['Summary Piutang Dagang', '', 'm'], ['Summary Piutang Dagang Per Tanggal', '', 'd'],
  ['Kartu Piutang', '', 'cd'], ['Sisa Piutang Dagang', '', 't'], ['Umur Piutang Dagang Per Customer Per Faktur', '', 't'], ['Sisa Piutang Dagang Per Customer', '', 't'], ['Umur Piutang', '', 't'],
  ['Laporan Detail Pelunasan Nota Penjualan', '', 'd'], ['List Customer', '', ''],
]
const SAMPLE = { 1: 'detail', 36: 'jt', 39: 'kp' } /* 1-based report numbers that have a sample in the manual */
const RS = { open: 0, shown: 0, vals: {} }
window.v7rep = i => {
  RS.open = i
  const [nm, , p] = RL[i - 1], F = (l, inner) => rw(l, inner)
  const si = k => `<input readonly value="${ESC(k)}">`
  const range = (a, b) => `<div class="rng">${si(a)}<i>s/d</i>${si(b)}</div>`
  const sample = i === 1 ? ['01 May 2006', '13 May 2006'] : ['01 Feb 2016', '29 Feb 2016']
  const rows = []
  if (p.includes('d')) rows.push(F('Tanggal', range(...sample)))
  if (p.includes('t')) rows.push(F('Tanggal', si(i === 36 ? '04 Oct 2006' : '10 Feb 2016')))
  if (p.includes('m')) rows.push(F('Periode', sv(['FEB 2016', 'JAN 2016', 'DEC 2009'], 'FEB 2016', false, 'void 0')))
  if (p.includes('f')) rows.push(F('No Faktur', si('')))
  if (p.includes('c')) rows.push(F('Customer', si(i === 39 ? 'CASH' : '')))
  if (p.includes('s')) rows.push(F('Sales', si('')))
  if (p.includes('g')) rows.push(F('Gudang', sv(['All', 'TOKO', 'Gudang1', 'GUDANG2'], 'All', false, 'void 0')))
  if (p.includes('j')) rows.push(F('Jenis Item', sv(['All', 'Stok', 'Jasa', 'Uang Muka'], 'All', false, 'void 0')))
  if (p.includes('k')) rows.push(F('Jenis Item', sv(['All', 'Barang', 'Jasa', 'Uang Muka'], 'All', false, 'void 0')))
  openSheet({ crumb: ['Laporan Penjualan', String(i)], title: nm, size: 'rail', body: `<div class="v7dlg">${rows.length ? rows.join('') : '<span class="mute">—</span>'}</div>`, foot: btn('OK', `v7repGo(${i})`) })
}
window.v7repGo = i => { RS.shown = i; closeSheet() }
const rhead = (title, sub, extra = '') => `<div class="co">PT. X Y Z</div><h2>${title}</h2><div class="c">${sub}</div>${extra}`
function repBody(i) {
  const [nm] = RL[i - 1]
  if (i === 1) {
    const L = [['01/05/2006', '06-05-00003', 'CASH', 'SURABAYA', '01/05/2006', 'MENGANTI', '', 0, 115000, 115000, 'LUNAS', 'BERAS TANGAN BAWANG', 1, 'SAK', 115000], ['01/05/2006', '06-05-00006', 'CASH', 'SURABAYA', '01/05/2006', 'MENGANTI', '', 0, 116500, 116500, 'LUNAS', 'BERAS TANGAN BAWANG', 1, 'SAK', 116500],
      ['02/05/2006', '06-05-00020', 'CASH', 'SURABAYA', '02/05/2006', 'MENGANTI', '', 0, 219000, 116500, 'LUNAS', 'BERAS TANGAN BAWANG', 1, 'SAK', 116500], ['06/05/2006', '06-05-00098', 'CASH', 'SURABAYA', '06/05/2006', 'MENGANTI', '', 0, 117500, 117500, 'LUNAS', 'BERAS TANGAN BAWANG', 1, 'SAK', 117500],
      ['12/05/2006', '06-05-00216', 'CASH', 'SURABAYA', '12/05/2006', 'MENGANTI', '', 0, 123300, 117500, 'LUNAS', 'BERAS TANGAN BAWANG', 1, 'SAK', 117500], ['13/05/2006', '06-05-00228', 'CASH', 'SURABAYA', '13/05/2006', 'MENGANTI', '', 0, 117500, 117500, 'LUNAS', 'BERAS TANGAN BAWANG', 1, 'SAK', 117500],
      ['13/05/2006', '06-05-00231', 'CASH', 'SURABAYA', '13/05/2006', 'MENGANTI', '', 0, 284000, 117000, 'LUNAS', 'BERAS TANGAN BAWANG', 1, 'SAK', 117000]]
    const rows = []
    L.forEach(r => {
      rows.push({ c: { a: r[0], b: r[1], c: r[2], d: r[3], e: r[4], f: r[5], g: r[6], h: f2(r[7]), i: f2(r[8]), j: f2(r[9]), k: r[10] } })
      rows.push({ c: { a: '', b: `<span class="mute">${r[11]}</span>`, c: `${f2(r[12])} ${r[13]}`, d: '', e: '', f: '', g: f2(0), h: f2(0), i: f2(r[14]), j: '', k: '' } })
      rows.push({ c: { a: '<span class="mute">Dicetak oleh MERDA</span>' } })
    })
    return rhead('Laporan Detail Penjualan', '01/05/2006 - 13/05/2006') + grid7({
      cols: [{ l: 'TANGGAL', k: 'a', w: 110 }, { l: 'NO FAKTUR', k: 'b', w: 210 }, { g: 'CUSTOMER', l: 'NAMA', k: 'c', w: 100 }, { g: 'CUSTOMER', l: 'LOKASI', k: 'd', w: 110 }, { l: 'TANGGAL J.TEMPO', k: 'e', w: 130 }, { l: 'GUDANG', k: 'f', w: 110 }, { l: 'KETERANGAN', k: 'g', w: 110 }, { l: 'DISKON', k: 'h', w: 90, num: true }, { l: 'TOTAL', k: 'i', w: 120, num: true }, { l: 'TOTAL BERSIH', k: 'j', w: 130, num: true }, { l: 'STATUS', k: 'k', w: 90 }],
      rows,
    })
  }
  if (i === 36) {
    const JT = [['06-04-00245', 'ACHMAD', 'SURABAYA', '26-Apr-2006', -1470000], ['06-05-00189', 'YONO', 'SURABAYA', '10-May-2006', 9490000], ['06-08-00419', 'HENDRIK, BPK', 'SURABAY', '07-Sep-2006', 3850000], ['06-09-00032', 'KO SUNLY', 'SURABAYA', '09-Sep-2006', 7590000],
      ['06-09-00030', 'HENDRIK, BPK', 'SURABAYA', '09-Sep-2006', 2680000], ['06-09-00029', 'ABADI', 'SURABAYA', '09-Sep-2006', 4030000], ['06-09-00028', 'ERLINA', 'SURABAYA', '09-Sep-2006', 1507000], ['06-09-00027', 'LUKMAN,BPK', 'SURABAYA', '09-Sep-2006', 1750000],
      ['06-09-00025', 'RICKY', 'SURABAYA', '09-Sep-2006', 880000], ['06-09-00053', 'HENDRIK, BPK', 'SURABAYA', '11-Sep-2006', 2756500], ['06-09-00052', 'KO JTING', 'SURABAYA', '11-Sep-2006', 414000], ['06-09-00051', 'COOKIES BOX', 'SURABAYA', '11-Sep-2006', 758000],
      ['06-09-00050', 'WINNA', 'SURABAYA', '11-Sep-2006', 1940000], ['06-09-00049', 'ABADI', 'SURABAYA', '11-Sep-2006', 2439000], ['06-09-00048', 'SURYA TIMUR', 'SURABAYA', '11-Sep-2006', 2650000], ['06-09-00047', 'ALI.BPK', 'SURABAYA', '11-Sep-2006', 593000], ['06-09-00054', 'EXODUS', 'SURABAYA', '11-Sep-2006', 1648500]]
    return rhead('PIUTANG JATUH TEMPO', '04/10/2006 9:54') + grid7({
      cols: [{ l: 'NO TRANSAKSI', k: 'a', w: 150 }, { g: 'CUSTOMER', l: 'NAMA', k: 'b', w: 240 }, { g: 'CUSTOMER', l: 'LOKASI', k: 'c', w: 160 }, { l: 'TANGGAL JATUH TEMPO', k: 'd', w: 160 }, { l: 'TOTAL', k: 'e', w: 140, num: true }],
      rows: JT.map(r => ({ c: { a: r[0], b: r[1], c: r[2], d: r[3], e: f0(r[4]) } })), foot: { c: '', d: 'TOTAL', e: f0(sumq(JT, r => r[4])) },
    }) + '<div class="pr">Dicetak oleh MERDA</div>'
  }
  if (i === 39) {
    const R = [['', 'Saldo', '', '', 0, 0, 21300], ['19/05/2006', 'Invoice Penjualan', '06-05-00328', '', 24500, 0, 45800], ['19/05/2006', 'Invoice Penjualan', '06-05-00329', '', 139000, 0, 184800], ['19/05/2006', 'Invoice Penjualan', '06-05-00330', '', 192900, 0, 377700],
      ['19/05/2006', 'Invoice Penjualan', '06-05-00331', '', 171000, 0, 548700], ['19/05/2006', 'Pelunasan Piutang', 'KM-06-05-00213', '06-05-00331', 0, 171000, 377700], ['19/05/2006', 'Pelunasan Piutang', 'KM-06-05-00213', '06-05-00329', 0, 139000, 238700],
      ['19/05/2006', 'Pelunasan Piutang', 'KM-06-05-00213', '06-05-00327', 0, 85300, 153400], ['19/05/2006', 'Pelunasan Piutang', 'KM-06-05-00213', '06-05-00330', 0, 192900, -39500], ['19/05/2006', 'Pelunasan Piutang', 'KM-06-05-00213', '06-05-00328', 0, 24500, -64000], ['19/05/2006', 'Invoice Penjualan', '06-05-00327', '', 85300, 0, 21300]]
    return rhead('KARTU PIUTANG', '19/05/2006', '<div class="pr">CUSTOMER : CASH</div>') + grid7({
      cols: [{ l: 'TANGGAL', k: 'a', w: 120 }, { l: 'TRANSAKSI', k: 'b', w: 170 }, { l: 'NO TRANSAKSI', k: 'c', w: 160 }, { l: 'KETERANGAN', k: 'd', w: 130 }, { g: 'JUMLAH', l: 'DEBET', k: 'e', w: 120, num: true }, { g: 'JUMLAH', l: 'KREDIT', k: 'f', w: 120, num: true }, { g: 'JUMLAH', l: 'SALDO', k: 'g', w: 130, num: true }],
      rows: R.map(r => ({ c: { a: r[0], b: r[1], c: r[2], d: r[3], e: r[0] || r[1] !== 'Saldo' ? f2(r[4]) : '', f: r[0] ? f2(r[5]) : '', g: f2(r[6]) } })), foot: { c: '', d: 'Total', e: f2(634000), f: f2(612700) },
    }) + `<div class="v7kv"><b>GRAND TOTAL PIUTANG</b><label>DEBET <input readonly value="634,000.00"></label><label>KREDIT <input readonly value="612,700.00"></label><label>SALDO <input readonly value="21,300.00"></label></div><div class="pr">Dicetak oleh MERDA</div>`
  }
  return rhead(nm, RS.vals.sub || '01/02/2016 - 29/02/2016')
}
function pgRep() {
  const rows = RL.map(([a, b], i) => ({ on: `v7rep(${i + 1})`, sel: RS.open === i + 1, c: { n: String(i + 1), a, b } }))
  const body = grid7({ cols: [{ l: 'NO', k: 'n', w: 60, num: true }, { l: 'L A P O R A N', k: 'a', w: 440 }, { l: 'K E T E R A N G A N', k: 'b', w: 440 }], rows })
    + (RS.shown ? `<div class="v7rep">${repBody(RS.shown)}</div>` : '')
  return P7('Laporan Penjualan', body)
}

reg7({ id: 'sell-invoice', manual: 'Manual hal. 154–160, 240–253 · 5.6 Faktur Penjualan', render: pgFP })
reg7({ id: 'sell-return', manual: 'Manual hal. 161–164, 246–247 · 5.7 Transaksi Retur Penjualan', render: pgRJ })
reg7({ id: 'sell-cash', manual: 'Manual hal. 150–153 · 5.4 Penjualan Cash, 5.5 Penjualan Barcode (POS)', render: pgCash })
reg7({ id: 'sell-info', manual: 'Manual hal. 138–143 · 5.1 Info Penjualan', render: pgInfo })
reg7({ id: 'sell-reports', manual: 'Manual hal. 164–173 · 5.8 Laporan Penjualan', render: pgRep })
window.V7SELL = { FP, RJ, RL }
})()
