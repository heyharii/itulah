;(() => {
/* ═════════ 7Soft, as it is: GL / Info Accounting, Transaksi Jurnal, Closing Periode, Laporan ═════════
   Content = the manual (printed pp. 200–212) and its screenshots. Numbers are written the way 7Soft writes them (1,234.00). */
try {
  const st = document.createElement('style')
  st.textContent = `
.g7-tb{display:flex;align-items:center;flex-wrap:wrap;gap:6px;margin-bottom:12px}
.g7-tb .ds-btn{height:32px;padding:0 12px}
.g7-cnt{display:inline-flex;align-items:center;justify-content:center;min-width:150px;height:32px;padding:0 12px;border:1px solid var(--hairline-2);border-radius:var(--r-inner);background:var(--soft);font-weight:500;font-variant-numeric:tabular-nums}
.g7-cnt.red{background:var(--bad-bg);color:var(--bad-fg)}
.g7-in{height:36px;padding:0 10px;border:1px solid var(--hairline-2);border-radius:var(--r-inner);background:var(--canvas);font:inherit;color:var(--ink);min-width:0}
.g7-in:focus{outline:0;border-color:var(--accent);box-shadow:var(--shadow-focus)}
.g7-in[readonly]{background:var(--soft)}
.g7-in.num{text-align:right;font-variant-numeric:tabular-nums}
.g7-row{display:flex;align-items:center;flex-wrap:wrap;gap:12px 16px;margin-bottom:16px}
.g7-row label{display:inline-flex;align-items:center;gap:8px}
.g7-box{display:flex;align-items:center;flex-wrap:wrap;gap:12px 24px;padding:16px 0 0}
.g7-box label{display:inline-flex;align-items:center;gap:10px}
.g7-box .g7-in{width:190px}
.g7-tree .tp{display:inline-grid;place-items:center;width:18px;height:18px;margin-right:8px;border:1px solid var(--hairline-strong);border-radius:3px;font-size:15px;line-height:1;font-weight:500;vertical-align:middle;cursor:pointer;user-select:none}
.g7-tree .tp.off{cursor:default;color:var(--faint)}
.g7-tree tr.cur td{background:var(--accent-bg)}
.g7-stat{display:flex;gap:40px;margin-top:24px;padding-top:12px;border-top:1px solid var(--hairline);color:var(--body)}
.g7 td,.g7 th{white-space:nowrap}
.g7 th{text-align:center}
.g7 th.is-num{text-align:center}
.g7 td{overflow:hidden;text-overflow:ellipsis}
.g7 tr.sub td{font-weight:600}
.g7 tr.tot td{font-weight:600;border-top:2px solid var(--ink)}
.g7 .red{color:var(--bad-fg)}
.g7-title{margin:16px 0 4px;text-align:center;font-weight:600;font-size:17px}
.g7-warn{margin:32px 0 0;font-weight:600;font-size:17px;text-align:center;text-transform:uppercase}
.g7-link{margin-left:12px}
`
  document.head.appendChild(st)
} catch (e) { /* headless */ }

const fmt = n => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const pn = v => parseFloat(String(v).replace(/,/g, '')) || 0
const STATUS = `<div class="g7-stat"><span>ADMIN</span><span>PERIODE : FEB 2016 &nbsp; 2/1/2016 - 2/29/2016</span><span>SERVER : Demo on Localhost</span></div>`
const P7 = ['DEC 2009', 'JAN 2010', 'FEB 2010', 'MAR 2010', 'APR 2010', 'MAY 2010', 'JUN 2010', 'JUL 2010', 'NOV 2007']
const sel7 = (opts, cur, on) => `<div class="sel"><select onchange="${on}">${opts.map(o => `<option ${o === cur ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>${ico('chevron-down')}</div>`
const dt7 = (k, v, w = 150) => `<input class="g7-in" style="width:${w}px" value="${esc(v)}" oninput="G7.${k}=this.value">`
/* the toolbar every 7Soft window has: [label, enabled] and the record counter */
const tb7 = (btns, cnt, red) => `<div class="g7-tb">${btns.map(([l, on]) => `<button class="ds-btn ds-btn--primary ${on === false ? 'is-disabled' : ''}" type="button" onclick="${l === 'Refresh' ? 'render()' : `soon('${l}')`}">${l}</button>`).join('')}<span class="g7-cnt ${red ? 'red' : ''}">${cnt}</span></div>`
const BTN_INFO = (first) => [['First', !first], ['Prior', !first], ['Next'], ['Last'], ['Search'], ['Filter'], ['Refresh'], ['Go to', false], ['Format'], ['Default'], ['XLS']]
const infoTb = (cnt, first) => tb7(BTN_INFO(first), cnt) + `<div class="g7-row"><input class="g7-in" style="width:120px" value="500"></div>`
/* a grid with 7Soft's two-row heading: cols [{l,k?,w,num,g}] rows [{c:[html…], on, cls}] */
function g7(cols, rows, o = {}) {
  const grp = cols.some(c => c.g)
  let head
  if (!grp) head = `<tr>${cols.map(c => `<th>${c.l}</th>`).join('')}</tr>`
  else {
    let r1 = '', r2 = '', i = 0
    while (i < cols.length) {
      const c = cols[i]
      if (!c.g) { r1 += `<th rowspan="2">${c.l}</th>`; i++; continue }
      let j = i; while (j < cols.length && cols[j].g === c.g) j++
      r1 += `<th colspan="${j - i}">${c.g}</th>`; for (let x = i; x < j; x++) r2 += `<th>${cols[x].l}</th>`; i = j
    }
    head = `<tr>${r1}</tr><tr>${r2}</tr>`
  }
  const body = rows.map(r => r.html ? `<tr><td colspan="${cols.length}">${r.html}</td></tr>` : `<tr class="${r.on ? 'ds-opens' : ''} ${r.cls || ''}" ${r.on ? `onclick="${r.on}"` : ''}>${cols.map((c, i) => `<td class="${c.num ? 'is-num' : ''}">${r.c[i] ?? ''}</td>`).join('')}</tr>`).join('')
  return `<div class="ds-table-card" style="overflow-x:auto"><table class="ds-table tbl t7 g7 ${o.cls || ''}" style="min-width:${o.min || 900}px"><colgroup>${cols.map(c => `<col${c.w ? ` style="width:${c.w}px"` : ''}>`).join('')}</colgroup><thead>${head}</thead><tbody>${body}</tbody></table></div>`
}
const foot7 = items => `<div class="g7-box">${items.map(([l, v]) => `<label>${l}<input class="g7-in num" readonly value="${esc(v)}" style="width:190px"></label>`).join('')}</div>`

const G7 = {
  open: new Set(['1', '10', '100', '1000']), per: 'DEC 2009', jAll: true, jFrom: '01 Feb 2016', jTo: '29 Feb 2016', jExp: false,
  aFrom: '01 Feb 2006', aTo: '10 Feb 2016', bFrom: '100001', bTo: '100001', bPer: 'NOV 2007', bUntil: '30 Nov 2007', nUntil: '30 Nov 2007',
  jnl: { mode: 'view', lines: [] }, sel: 0, tTrx: false, tAcc: false, saldo: true, ignore: false, rep: { sel: null, per: 'OKTOBER-2007' },
  cl: [
    ['DEC 2009', '08 Dec 2009', 2009, 12, '01 Dec 2009', '31 Dec 2009', true], ['JAN 2010', '11 Jan 2010', 2010, 1, '01 Jan 2010', '31 Jan 2010', true],
    ['FEB 2010', '24 Feb 2010', 2010, 2, '01 Feb 2010', '28 Feb 2010', true], ['MAR 2010', '24 Feb 2010', 2010, 3, '01 Mar 2010', '31 Mar 2010', true],
    ['APR 2010', '24 Feb 2010', 2010, 4, '01 Apr 2010', '30 Apr 2010', true], ['MAY 2010', '24 Feb 2010', 2010, 5, '01 May 2010', '31 May 2010', true],
    ['JUN 2010', '24 Jun 2010', 2010, 6, '01 Jun 2010', '30 Jun 2010', true], ['JUL 2010', '24 Jul 2010', 2010, 7, '01 Jul 2010', '31 Jul 2010', true],
  ],
}
window.G7 = G7

/* ═════════ Info Accounting ═════════ */
const TREE = [
  { c: '1', n: 'AKTIVA', v: '14,774,988,172.21', k: [
    { c: '10', n: 'AKTIVA LANCAR', v: '10,705,268,158.71', k: [
      { c: '100', n: 'Kas/ Bank', v: '-50,957,294.62', k: [
        { c: '1000', n: 'Kas', v: '774,141,738.83', k: [{ c: '100001', n: 'Kas Kecil', v: '133,428,550.00' }, { c: '100002', n: 'Kas Besar', v: '640,258,185.83' }, { c: '100003', n: 'AYAT PERANTARA', v: '3.00' }, { c: '100004', n: 'Kas kecil kecil', v: '455,000.00' }] },
        { c: '1001', n: 'Bank', v: '-825,099,033.44', more: 1 }, { c: '1002', n: 'GIRO', v: '0.00', more: 1 }] },
      { c: '101', n: 'Piutang', v: '7,214,492,737.70', more: 1 }, { c: '102', n: 'Persediaan', v: '2,639,395,960.63', more: 1 }, { c: '103', n: 'Uang Muka', v: '901,979,755.00', more: 1 },
      { c: '104', n: 'Biaya & Pajak Dibayar di Muka', v: '357,000.00', more: 1 }, { c: '105', n: '', v: '0.00' }] },
    { c: '11', n: 'AKTIVA TETAP', v: '4,069,720,013.50', more: 1 }, { c: '12', n: 'AKTIVA TAK BERWUJUD', v: '0.00', more: 1 }, { c: '13', n: 'AKTIVA LAIN-LAIN', v: '0.00', more: 1 }, { c: '14', n: 'INVESTASI JANGKA PANJANG', v: '0.00', more: 1 }] },
  { c: '2', n: 'KEWAJIBAN', v: '-4,387,524,699.77', more: 1 }, { c: '3', n: 'EKUITAS', v: '-10,389,925,730.89', more: 1 }, { c: '4', n: 'PENJUALAN', v: '0.00', more: 1 },
  { c: '5', n: 'BIAYA', v: '2,462,258.44', more: 1 }, { c: '6', n: 'PENDAPATAN/ BEBAN LAIN-LAIN', v: '0.00', more: 1 },
]
window.g7Tog = c => { G7.open.has(c) ? G7.open.delete(c) : G7.open.add(c); render() }
function treeRows(ns, lvl, out) {
  ns.forEach(n => {
    const has = !!n.k, op = G7.open.has(n.c)
    const tp = has ? `<span class="tp" onclick="event.stopPropagation();g7Tog('${n.c}')">${op ? '−' : '+'}</span>` : n.more ? `<span class="tp off">+</span>` : `<span class="tp" style="border-color:transparent"></span>`
    out.push({ cls: n.c === '1000' ? 'cur' : lvl < 3 ? 'sub' : '', c: [`<span style="padding-left:${lvl * 20}px">${tp}${n.c} &nbsp; ${esc(n.n)}</span>`, n.v] })
    if (has && op) treeRows(n.k, lvl + 1, out)
  })
  return out
}
const accTab = () => `<div class="g7-row"><label>PERIODE ${sel7(P7, G7.per, 'G7.per=this.value')}</label>${btn('Refresh', 'render()')}${btn('Account Baru', "soon('Account Baru')")}</div>` +
  g7([{ l: 'ACCOUNT' }, { l: 'SALDO AKHIR', w: 220, num: 1 }], treeRows(TREE, 0, []), { cls: 'g7-tree', min: 600 })

const J7 = [
  ['2007-08-30', '30 Aug 07 &nbsp;11:42:47', 'GL-07-08-00001', '', '', '4,092,000,000.00', 200708, 'NEW', 'N'], ['2007-09-30', '30 Sep 07 &nbsp;11:11:25', 'GL-07-09-00002', '', 'PENYUS', '36,550,000.00', 200709, 'NEW', 'N'],
  ['2007-09-30', '30 Sep 07 &nbsp;13:08:28', 'GL-07-09-00001', '', '', '0.00', 200709, 'DELETE', 'N'], ['2007-09-30', '30 Sep 07 &nbsp;15:03:35', 'GL-07-09-00003', '', '', '17,023,643.50', 200709, 'NEW', 'N'],
  ['2007-10-25', '25 Oct 07 &nbsp;19:12:38', 'GL-07-10-00001', '', '', '0.00', 200710, 'DELETE', 'N'], ['2007-10-31', '31 Oct 07 &nbsp;15:09:24', 'GL-07-10-00002', '', 'PENYUSUTAN OKT\'07', '17,023,643.00', 200710, 'NEW', 'N'],
  ['2007-10-31', '31 Oct 07 &nbsp;15:12:55', 'GL-07-10-00003', '', 'GAJI', '14,500,000.00', 200710, 'NEW', 'N'], ['2008-07-26', '26 Jul 08 &nbsp;14:30:48', 'GL-08-07-00002', '', '', '0.00', 200807, 'DELETE', 'N'],
  ['2008-08-07', '07 Aug 08 &nbsp;16:42:04', 'GL-08-08-00001', '', '', '3.00', 200808, 'NEW', 'N'], ['2008-12-22', '22 Dec 08 &nbsp;13:57:14', 'GL-08-12-00001', '', 'BUNGA BANK', '1,200.00', 200812, 'NEW', 'N'],
  ['2011-03-02', '02 Mar 11 &nbsp;23:30:51', 'GL-11-03-00001', '', '', '0.00', 201103, 'NEW', 'N'],
]
const JL = [
  ['Bangunan', '110002', '1,000,000,000.00', '0.00'], ['Bangunan', '110002', '600,000,000.00', '0.00'], ['Bangunan', '110002', '1,500,000,000.00', '0.00'],
  ['Kendaraan - Komersial', '110004', '300,000,000.00', '0.00'], ['Kendaraan - Komersial', '110004', '300,000,000.00', '0.00'], ['Kendaraan - Komersial', '110004', '300,000,000.00', '0.00'],
  ['Sarana dan Instalasi', '110009', '15,000,000.00', '0.00'], ['Peralatan Kantor', '110006', '5,000,000.00', '0.00'], ['Peralatan Kantor', '110006', '10,000,000.00', '0.00'],
  ['Kendaraan - Karyawan', '110005', '20,000,000.00', '0.00'], ['Peralatan Komputer', '110007', '7,000,000.00', '0.00'], ['Kendaraan - Komersial', '110004', '35,000,000.00', '0.00'], ['Modal', '300001', '0.00', '4,092,000,000.00'],
]
const JCOLS = [{ l: 'DESKRIPSI ACCOUNT', w: 280 }, { l: 'KODE ACCOUNT', w: 150 }, { l: 'URAIAN' }, { l: 'DEBET', g: 'JUMLAH', w: 190, num: 1 }, { l: 'KREDIT', g: 'JUMLAH', w: 190, num: 1 }]
window.g7JExp = () => { G7.jExp = !G7.jExp; render() }
window.g7JAll = v => { G7.jAll = v; render() }
const jurTab = () => {
  const from = Date.parse(G7.jFrom), to = Date.parse(G7.jTo)
  const rs = J7.filter(r => G7.jAll || (Date.parse(r[0]) >= from && Date.parse(r[0]) <= to))
  const rows = []
  rs.forEach((r, i) => {
    rows.push({ c: [r[2] === 'GL-07-08-00001' ? `<span class="tp" style="display:inline-grid;place-items:center;width:18px;height:18px;border:1px solid var(--hairline-strong);border-radius:3px;cursor:pointer" onclick="g7JExp()">${G7.jExp ? '−' : '+'}</span>` : `<span class="tp" style="display:inline-grid;place-items:center;width:18px;height:18px;border:1px solid var(--hairline-strong);border-radius:3px;color:var(--faint)">+</span>`, r[1], r[2], r[3], esc(r[4]), r[5], r[6], r[7], r[8]] })
    if (G7.jExp && r[2] === 'GL-07-08-00001') rows.push({ html: g7(JCOLS, JL.map(l => ({ c: [l[0], l[1], '', l[2], l[3]] })), { min: 800 }) })
  })
  return `<div class="g7-row"><label><input type="checkbox" class="cb7" ${G7.jAll ? 'checked' : ''} onchange="g7JAll(this.checked)"><b>All</b></label>${dt7('jFrom', G7.jFrom)}${dt7('jTo', G7.jTo)}${btn('Jurnal Baru', "g7NewJ()")}</div>` +
    g7([{ l: '', w: 44 }, { l: 'TANGGAL', w: 190 }, { l: 'NO JURNAL', w: 170 }, { l: 'NO REF', w: 120 }, { l: 'KETERANGAN' }, { l: 'TOTAL', w: 170, num: 1 }, { l: 'PERIODE', w: 100, num: 1 }, { l: 'STATUS', w: 100 }, { l: 'OTOMATIS', w: 110 }], rows, { min: 1000 })
}
const BKM = 'BKM (Bukti Kas/Bank Ma', BKK = 'BKK (Bukti Kas/Bank Kel'
const AJ = [
  ['7/1/2007', BKM, '8638', '101301', 'GIRO  MASUK', '7,700,000.00', '0.00'], ['7/1/2007', BKM, '8638', '612105', 'Beban Lain Lain', '0.00', '7,700,000.00'],
  ['7/21/2007 4:24:53 PM', 'Faktur Pembelian', '6538', '103001', 'Uang Muka - Pembelian', '4,195,560.00', '0.00'], ['7/21/2007 4:24:53 PM', 'Faktur Pembelian', '6538', '201001', 'Utang Dagang - Supplier', '0.00', '4,195,560.00'],
  ['7/30/2007', BKK, '6350', '612105', 'Beban Lain Lain', '2,656,000.00', '0.00'], ['7/30/2007', BKK, '6350', '100201', 'GIRO', '0.00', '2,656,000.00'],
  ['7/30/2007', BKK, '6351', '612105', 'Beban Lain Lain', '10,092,144.00', '0.00'], ['7/30/2007', BKK, '6351', '100201', 'GIRO', '0.00', '10,092,144.00'],
  ['7/30/2007', BKK, '6352', '612105', 'Beban Lain Lain', '10,566,240.00', '0.00'], ['7/30/2007', BKK, '6352', '100201', 'GIRO', '0.00', '10,566,240.00'],
  ['7/30/2007', BKK, '6353', '612105', 'Beban Lain Lain', '13,614,715.00', '0.00'], ['7/30/2007', BKK, '6353', '204002', 'GIRO EKON RKT BR', '0.00', '13,614,715.00'],
  ['7/30/2007', BKK, '6354', '612105', 'Beban Lain Lain', '10,000,000.00', '0.00'], ['7/30/2007', BKK, '6354', '204002', 'GIRO EKON RKT BR', '0.00', '10,000,000.00'],
  ['7/30/2007', BKK, '6355', '612105', 'Beban Lain Lain', '10,000,000.00', '0.00'], ['7/30/2007', BKK, '6355', '100201', 'GIRO', '0.00', '10,000,000.00'],
  ['7/30/2007', BKK, '6356', '612105', 'Beban Lain Lain', '10,000,000.00', '0.00'], ['7/30/2007', BKK, '6356', '204002', 'GIRO EKON RKT BR', '0.00', '10,000,000.00'],
  ['7/30/2007', BKK, '6357', '612105', 'Beban Lain Lain', '10,000,000.00', '0.00'], ['7/30/2007', BKK, '6357', '204002', 'GIRO EKON RKT BR', '0.00', '10,000,000.00'],
  ['7/30/2007', BKK, '6359', '612105', 'Beban Lain Lain', '10,834,337.00', '0.00'], ['7/30/2007', BKK, '6359', '100201', 'GIRO', '0.00', '10,834,337.00'],
  ['7/30/2007', BKK, '6360', '612105', 'Beban Lain Lain', '13,073,740.00', '0.00'], ['7/30/2007', BKK, '6360', '100201', 'GIRO', '0.00', '13,073,740.00'], ['7/30/2007', BKK, '6361', '612105', 'Beban Lain Lain', '12,322,720.00', '0.00'],
]
const allTab = () => `<div class="g7-row"><label>TANGGAL ${dt7('aFrom', G7.aFrom, 150)}</label><label>s.d. ${dt7('aTo', G7.aTo, 150)}</label>${btn('Refresh', 'render()')}</div>` +
  g7([{ l: 'TANGGAL', w: 170 }, { l: 'KETERANGAN', w: 190 }, { l: 'NO JURNAL', w: 100 }, { l: 'NO REF.', w: 110 }, { l: 'KODE', g: 'ACCOUNT', w: 100 }, { l: 'NAMA', g: 'ACCOUNT', w: 240 }, { l: 'DEBET', w: 140, num: 1 }, { l: 'KREDIT', w: 140, num: 1 }, { l: 'URAIAN' }], AJ.map(r => ({ c: [r[0], r[1], r[2], '', r[3], esc(r[4]), r[5], r[6], ''] })), { min: 1250 }) +
  foot7([['TOTAL DEBET', '126547 973 998.76'], ['TOTAL KREDIT', '126547 973 998.76']])
const BB = [
  ['11/1/2007', '00024', '0.00', '6,041,500.00', '-6,041,500.00', ''], ['11/1/2007', '00027', '1,000,000.00', '0.00', '-5,041,500.00', 'KAS RUNGKUT'], ['11/2/2007', '00035', '0.00', '4,967,000.00', '-10,008,500.00', ''],
  ['11/2/2007', '00036', '0.00', '760,000.00', '-10,768,500.00', 'TUNAI RKT'], ['11/2/2007', '00037', '4,000,000.00', '0.00', '-6,768,500.00', 'KAS RKT'], ['11/3/2007', '00038', '0.00', '3,754,500.00', '-10,523,000.00', 'Kas Rkt'],
  ['11/3/2007', '00042', '1,000,000.00', '0.00', '-9,523,000.00', 'KAS RKT'], ['11/5/2007', '00050', '0.00', '588,000.00', '-10,111,000.00', 'Kas Rkt'], ['11/5/2007', '00058', '1,000,000.00', '0.00', '-9,111,000.00', 'KAS RKT'],
  ['11/6/2007', '00068', '0.00', '409,000.00', '-9,520,000.00', 'Kas Rkt'], ['11/7/2007', '00075', '0.00', '1,171,500.00', '-10,691,500.00', 'Kas Rkt'], ['11/7/2007', '00080', '2,000,000.00', '0.00', '-8,691,500.00', 'KAS RKT'],
  ['11/8/2007', '00108', '0.00', '952,000.00', '-9,643,500.00', 'Kas Rkt'], ['11/8/2007', '00109', '0.00', '280,000.00', '-9,923,500.00', ''], ['11/8/2007', '00111', '1,000,000.00', '0.00', '-8,923,500.00', 'KAS RKT'],
  ['11/9/2007', '00121', '0.00', '409,000.00', '-9,332,500.00', 'Kas Rkt'], ['11/9/2007', '00122', '2,000,000.00', '0.00', '-7,332,500.00', 'KAS RKT'], ['11/10/2007', '00131', '0.00', '3,084,000.00', '-10,416,500.00', ''],
  ['11/10/2007', '00132', '0.00', '262,500.00', '-10,679,000.00', 'TUNAI'], ['11/10/2007', '00141', '2,000,000.00', '0.00', '-8,679,000.00', 'KAS RKT'], ['11/13/2007', '00168', '1,000,000.00', '0.00', '-7,679,000.00', 'KAS RKT'],
  ['11/14/2007', '00172', '0.00', '976,500.00', '-8,655,500.00', 'Kas Rkt (Tgl 12-11-2007)'], ['11/14/2007', '00173', '0.00', '520,000.00', '-9,175,500.00', 'Kas Rkt (Tgl 13-11-2007)'],
]
const lookup = (k, v) => `<input class="g7-in" style="width:110px" value="${v}" oninput="G7.${k}=this.value">${btn('…', "soon('Pilih account')", 'primary', 'ds-btn--sm')}<input class="g7-in" style="width:250px" value="Kas Kecil" readonly>`
const bbpTab = () => `<div class="g7-row"><label>ACCOUNT ${lookup('bFrom', G7.bFrom)}</label><label>s.d. ${lookup('bTo', G7.bTo)}</label></div>
  <div class="g7-row"><label>PERIODE ${sel7(P7, G7.bPer, 'G7.bPer=this.value')}</label><label>SAMPAI TANGGAL ${dt7('bUntil', G7.bUntil, 150)}</label>${btn('Refresh', 'render()')}</div>` +
  g7([{ l: 'TANGGAL', w: 100 }, { l: 'KETERANGAN', w: 200 }, { l: 'NO JURNAL', w: 140 }, { l: 'NO REFF', w: 100 }, { l: 'KODE', g: 'ACCOUNT', w: 90 }, { l: 'NAMA', g: 'ACCOUNT', w: 110 }, { l: 'AWAL', w: 110, num: 1 }, { l: 'DEBET', w: 120, num: 1 }, { l: 'KREDIT', w: 120, num: 1 }, { l: 'SALDO', w: 130, num: 1 }, { l: 'URAIAN', w: 220 }],
    BB.map(r => ({ c: [r[0], BKK, 'KK-07-11-' + r[1], '', '100001', 'Kas Kecil', '0.00', r[2], r[3], r[4], esc(r[5])] })), { min: 1400 }) +
  foot7([['AWAL', '11 164 500.00'], ['DEBET', '16 000 000.00'], ['KREDIT', '24 936 000.00'], ['SALDO AKHIR', '2 228 500.00']])
const NS = [
  ['100001', 'Kas Kecil', '2,228,500.00', '0.00'], ['100002', 'Kas Besar', '22,741,333.00', '0.00'], ['100003', 'AYAT PERANTARA', '0.00', '0.00'], ['100004', 'Kas kecil kecil', '0.00', '0.00'], ['100101', 'Bank BRI', '0.00', '960,956,735.91'],
  ['100102', 'Bank BCA', '2,999,985.50', '0.00'], ['100103', 'Bank MEGA', '13,144,828.10', '0.00'], ['100104', 'Bank Danamon', '4,699,688.87', '0.00'], ['100105', 'Cadangan Perputaran - Bank Ekonomi', '0.00', '0.00'], ['100201', 'GIRO', '0.00', '0.00'],
  ['1003', 'bank ekon coba', '0.00', '0.00'], ['101001', 'Piutang Dagang - Customer', '4,431,087,034.00', '0.00'], ['101002', 'Piutang Dagang - Cadangan Kerugian', '0.00', '0.00'], ['101101', 'Piutang 146', '2,567,343,982.00', '0.00'],
  ['101102', 'Piutang Karyawan', '0.00', '0.00'], ['101103', 'Piutang Direksi', '0.00', '0.00'], ['101104', 'Piutang Penukaran', '0.00', '0.00'], ['101105', 'Piutang Lain - Lain', '0.00', '0.00'], ['101106', 'Piutang Amir', '0.00', '0.00'],
  ['101201', 'Piutang Suspense - Dagang', '0.00', '0.00'], ['101202', 'Piutang Titipan', '0.00', '0.00'], ['101301', 'GIRO  MASUK', '631,743,400.00', '0.00'], ['102101', 'Persediaan Barang', '2,610,417,571.92', '0.00'], ['102102', 'BRG JADI', '0.00', '0.00'],
]
const nerTab = () => `<div class="g7-row"><label>SAMPAI TANGGAL ${dt7('nUntil', G7.nUntil, 150)}</label>${btn('Refresh', 'render()')}</div>` +
  g7([{ l: 'KODE', g: 'ACCOUNT', w: 200 }, { l: 'NAMA', g: 'ACCOUNT' }, { l: 'DEBET', w: 230, num: 1 }, { l: 'KREDIT', w: 230, num: 1 }], NS.map(r => ({ c: [r[0], esc(r[1]), r[2], r[3]] })), { min: 800 }) +
  foot7([['TOTAL DEBET', '2 228 500.00'], ['TOTAL KREDIT', '0'], ['SELISIH', '2 228 500.00']])

const CNT = { accounts: '4 of 303', journals: '1 of 11', entries: '1 of 30292', sub: '1 of 26', tb: '1 of 197' }
reg7({
  id: 'gl-info', manual: 'Manual hal. 200–203 · Info Accounting',
  render() {
    const t = ['accounts', 'journals', 'entries', 'sub', 'tb'].includes(tabOf('gl-info', 'accounts')) ? tabOf('gl-info', 'accounts') : 'accounts'
    const body = { accounts: accTab, journals: jurTab, entries: allTab, sub: bbpTab, tb: nerTab }[t]()
    return page({ title: 'Info Accounting', tabs: [['accounts', 'ACCOUNT'], ['journals', 'JURNAL'], ['entries', 'ALL JURNAL'], ['sub', 'BUKU BESAR PEMBANTU'], ['tb', 'NERACA SALDO']], tab: t, body: infoTb(CNT[t], t === 'accounts' || t === 'journals') + body + STATUS })
  },
})

/* ═════════ Transaksi Jurnal ═════════ */
window.g7NewJ = () => { G7.jnl = { mode: 'new', no: 'GL-26-10-00001', date: '27 Oct 2026', ref: '', note: '', lines: Array.from({ length: 8 }, () => ({ d: '', k: '', u: '', db: '', kr: '' })) }; S.tab['gl-info'] = 'journals'; go('gl-journal') }
window.g7JIn = (i, k, v) => {
  G7.jnl.lines[i][k] = v
  const td = G7.jnl.lines.reduce((s, l) => s + pn(l.db), 0), tc = G7.jnl.lines.reduce((s, l) => s + pn(l.kr), 0), g = id => document.getElementById(id)
  if (g('g7-td')) { g('g7-td').value = fmt(td); g('g7-tc').value = fmt(tc); g('g7-sel').value = fmt(td - tc) }
}
window.g7JBack = () => { G7.jnl = { mode: 'view', lines: [] }; render() }
reg7({
  id: 'gl-journal', manual: 'Manual hal. 203–205 · Transaksi Jurnal',
  render() {
    const nw = G7.jnl.mode === 'new', ro = nw ? '' : 'readonly'
    const td = nw ? G7.jnl.lines.reduce((s, l) => s + pn(l.db), 0) : 4092000000, tc = nw ? G7.jnl.lines.reduce((s, l) => s + pn(l.kr), 0) : 4092000000
    const inp = (v, k, i, cls = '') => `<input class="g7-in ${cls}" style="width:100%" value="${esc(v)}" oninput="g7JIn(${i},'${k}',this.value)">`
    const rows = nw ? G7.jnl.lines.map((l, i) => ({ c: [inp(l.d, 'd', i), inp(l.k, 'k', i), inp(l.u, 'u', i), inp(l.db, 'db', i, 'num'), inp(l.kr, 'kr', i, 'num')] })) : JL.map(l => ({ c: [l[0], l[1], '', l[2], l[3]] }))
    const hdr = `<div class="form-grid" style="grid-template-columns:repeat(3,1fr)">
      ${field('NO JURNAL', `<input value="${nw ? G7.jnl.no : 'GL-07-08-00001'}" readonly>`)}
      ${field('TANGGAL', `<input value="${nw ? G7.jnl.date : '30 Aug 2007  11:42:47'}" ${ro} oninput="G7.jnl.date=this.value">`)}
      ${field('PERIODE ACC', `<input value="${nw ? 'OCT 2026' : '200708'}" readonly>`)}
      ${field('NO REFERENSI', `<input value="${nw ? esc(G7.jnl.ref) : ''}" ${ro} oninput="G7.jnl.ref=this.value">`)}
      ${field('KETERANGAN', `<input value="${nw ? esc(G7.jnl.note) : ''}" ${ro} oninput="G7.jnl.note=this.value">`, 'span2')}
      <label class="field7"><span>STATUS OTOMATIS</span><span style="height:44px;display:flex;align-items:center"><input type="checkbox" class="cb7" disabled></span></label></div>`
    const tbar = tb7([['First', false], ['Prior', false], ['Next'], ['Last'], ['New'], ['Del', false], ['Filter'], ['Refresh', false], ['Save', nw], ['Undo', false], ['View'], ['Print'], ['Info']], nw ? 'NEW' : '1 of 11', nw)
    const state = nw ? '' : `<span class="g7-cnt" style="min-width:0;font-weight:600;color:var(--bad-fg)">READ ONLY</span>`
    const detail = `<div class="g7-tb">${btn('Del All', "soon('Del All')")}${btn('PENYUSUTAN', "soon('PENYUSUTAN')")}<span class="g7-cnt" style="min-width:0">Detail 1 of ${nw ? G7.jnl.lines.length : 13}</span></div>`
    const foot = `<div class="g7-box"><label>TOTAL<input class="g7-in num" id="g7-td" readonly value="${fmt(td)}"><input class="g7-in num" id="g7-tc" readonly value="${fmt(tc)}"></label></div><div class="g7-box" style="padding-top:12px"><label>SELISIH<input class="g7-in num" id="g7-sel" readonly value="${fmt(td - tc)}"></label></div>`
    return page({ title: 'Transaksi Jurnal', body: `<div style="display:flex;align-items:flex-start;gap:16px">${tbar}${state}</div>${hdr}${detail}${g7(JCOLS, rows, { min: 900 })}${foot}${STATUS}` })
  },
})

/* ═════════ Closing Periode Akuntansi ═════════ */
window.g7Cl = i => { G7.sel = i; render() }
const NXT = [['AUG 2010', 8, '31 Aug 2010'], ['SEP 2010', 9, '30 Sep 2010'], ['OCT 2010', 10, '31 Oct 2010'], ['NOV 2010', 11, '30 Nov 2010'], ['DEC 2010', 12, '31 Dec 2010']]
window.g7Create = () => { const x = NXT[G7.cl.length - 8]; if (!x) return; const mon = x[0].slice(0, 1) + x[0].slice(1, 3).toLowerCase(); G7.cl.push([x[0], day(TODAY), 2010, x[1], `01 ${mon} 2010`, x[2], true]); render() }
window.g7Closing = on => { const r = G7.cl[G7.sel]; if (!r) return; r[6] = on; render(); toast(on ? 'Undo Closing' : 'Closing', r[0]) }
window.g7Test = k => { G7[k] = true; render() }
window.g7Prob = () => openSheet({ crumb: ['Closing Periode Akuntansi'], title: 'View Problem', size: 'rail', body: '<div class="empty-note">Nothing listed</div>' })
reg7({
  id: 'gl-closing', manual: 'Manual hal. 205–206 · Closing Periode Akuntansi',
  render() {
    const rows = G7.cl.map((r, i) => ({ cls: i === G7.sel ? 'cur' : '', on: `g7Cl(${i})`, c: [r[0], r[1], r[2], r[3], r[4], r[5], `<input type="checkbox" class="cb7" ${r[6] ? 'checked' : ''} disabled>`] }))
    const chk = (v, on) => `<input type="checkbox" class="cb7" ${v ? 'checked' : ''} ${on ? `onchange="${on}"` : 'disabled'}>`
    const lbl = t => `<span style="font-weight:600;font-size:17px;min-width:420px;display:inline-block">${t}</span>`
    const body = `<div class="g7-row" style="margin-bottom:24px">${btn('Close', "go(SCREENS[0].id)")}${btn('Create Period', 'g7Create()')}${btn('Closing', 'g7Closing(false)')}${btn('Undo Closing', 'g7Closing(true)')}</div>` +
      g7([{ l: 'PERIODE', w: 130 }, { l: 'TANGGAL', w: 150 }, { l: 'TAHUN', w: 90, num: 1 }, { l: 'BULAN', w: 90, num: 1 }, { l: 'MULAI', g: 'TANGGAL', w: 150 }, { l: 'AKHIR', g: 'TANGGAL', w: 150 }, { l: 'STATUS', w: 100 }], rows, { min: 880 }) +
      `<div style="display:grid;gap:14px;margin-top:20px">
        <div class="g7-row" style="margin:0">${lbl('PROSES SALDO AWAL PROGRAM KE NERACA AWAL')}${chk(G7.saldo)}${btn('Proses', "soon('Proses')")}</div>
        <div class="g7-row" style="margin:0">${lbl('TEST VALIDASI TRANSAKSI')}${chk(G7.tTrx)}${btn('Test', "g7Test('tTrx')")}${btn('View Problem', 'g7Prob()')}</div>
        <div class="g7-row" style="margin:0">${lbl('TEST VALIDASI ACCOUNTING')}${chk(G7.tAcc)}${btn('Test', "g7Test('tAcc')")}${btn('View Problem', 'g7Prob()')}</div>
        <div class="g7-row" style="margin:0">${lbl('SETUJU ABAIKAN VALIDASI')}${chk(G7.ignore, 'G7.ignore=this.checked')}</div></div>
        <div style="height:36px;margin-top:20px;border:1px solid var(--hairline-2);border-radius:var(--r-inner);background:var(--soft)"></div>
        <p class="g7-warn">PASTIKAN TIDAK ADA USER LAIN YANG MASUK ATAU MENGGUNAKAN APLIKASI 7SOFT !!!</p>`
    return page({ title: 'Closing Periode Akuntansi', body: body + STATUS })
  },
})

/* ═════════ Laporan Accounting / Keuangan / Manajerial ═════════ */
const LACC = ['Perhitungan HPP', 'Laporan Jurnal', 'Laporan Jurnal Pembelian', 'Laporan Jurnal Penjualan', 'Laporan Jurnal Persediaan', 'Laporan Jurnal Pengeluaran Kas (BKK)', 'Laporan Jurnal Penerimaan Kas (BKM)', 'Buku Besar Pembantu', 'Laporan Persediaan Akhir Bulan', 'Laporan Master Account', 'Laporan Aktiva Tetap dan Penyusutan', 'Laporan Aktiva Tetap dan  Penyusutan Tahunan'].map(n => [n, ''])
const LKEU = [['Laba/Rugi Penjualan Per Item', ''], ['Laba Rugi  Item / Barang', 'Detil Customer'], ['Laba Rugi Customer', 'Detil Item'], ['Laba Rugi Nota', 'FAKTUR'], ['Laporan Laba Rugi Per sales', 'Utk Menghitung Komisi sales'], ['Laba Rugi GL', ''], ['Laba Rugi (Barang)', ''], ['Laba Rugi Tahunan', ''], ['Neraca Saldo', ''],
  ['Laporan Neraca Ke Kanan', 'Format Akun tidak berubah'], ['Laporan Neraca Standard', 'Format Akun Fleksibel'], ['Laporan Neraca Perbandingan 2 Bulan', 'Format Akun Fleksibel'], ['Laporan Neraca (Common Sized)', 'Format Akun Fleksibel'], ['Laporan Neraca Tahunan', 'Format Akun Fleksibel'], ['Laporan Arus Kas', '']]
const LMAN = [['Laporan Fast Moving Item', 'Berdasarkan Qty,Nilai,Frek,laba'], ['Laporan Fast Moving Kelompok Item', 'Berdasarkan Qty,Nilai,Frek,laba'], ['Laporan Slow Moving Item', 'Berdasarkan Qty,Nilai,Frek,laba'], ['Laporan 10 Top Customer', 'Berdasarkan Nilai,Frek,Laba transaksi']]
const REPM = { lacc: ['Laporan Accounting', LACC], lkeu: ['Laporan Keuangan', LKEU], lman: ['Laporan Manajerial', LMAN] }
/* the one sample the manual prints: Laporan Neraca (Ke Kanan), OKTOBER-2007 */
const NL = [
  ['1', 'AKTIVA', '', '', 'h'], ['', '', '', ''], ['10', 'AKTIVA LANCAR', '', '', 'h'], ['100', 'Kas/ Bank', '(1,216,871,011.44)', '(1,593,321,904.60)', 's', 1], ['1000', '  - Kas', '107,256,998.00', '107,246,388.00'], ['1001', '  - Bank', '(1,324,128,009.44)', '(1,701,168,292.60)', '', 1],
  ['1002', '  - GIRO', '0.00', '0.00'], ['1003', '  - bank ekon coba', '0.00', '0.00'], ['101', 'Piutang', '7,116,521,881.00', '7,478,351,851.00', 's'], ['1010', '  - Piutang Dagang', '3,662,913,884.00', '3,426,664,439.00'], ['1011', '  - Piutang Lain-Lain', '2,902,140,047.00', '2,677,461,752.00'],
  ['1012', '  - Piutang Suspense', '0.00', '0.00'], ['1013', '  - Piutang Giro', '551,467,950.00', '1,374,225,660.00'], ['102', 'Persediaan', '1,730,763,089.92', '2,569,684,845.66', 's'], ['1021', '  - Persediaan', '1,730,763,089.92', '2,569,684,845.66'],
  ['1022', '  - Retur & Potongan Pembelian', '0.00', '0.00'], ['103', 'Uang Muka', '813,663,299.00', '72,247,800.00', 's'], ['1030', '  - Uang Muka', '813,663,299.00', '72,247,800.00'], ['1031', '  - Uang Muka - Lain-Lain', '0.00', '0.00'],
  ['1032', '  - Uang Muka - Yang Akan Diterima', '0.00', '0.00'], ['1033', '  - Uang Muka - Iklan dan Promosi', '0.00', '0.00'], ['104', 'Biaya & Pajak Dibayar di Muka', '0.00', '0.00', 's'], ['1040', '  - Biaya Dibayar di Muka', '0.00', '0.00'],
  ['1041', '  - Pajak Dibayar di Muka', '0.00', '0.00'], ['', '', '', ''], ['105', '', '0.00', '0.00', 's'], ['', '', '', ''], ['', 'TOTAL  AKTIVA LANCAR', '8,444,077,258.48', '8,526,362,592.06', 't'],
]
const NR = [
  ['2', 'KEWAJIBAN DAN EKUITAS', '', '', 'h'], ['', '', '', ''], ['20', 'Kewajiban Lancar', '', '', 'h'], ['200', 'Utang Pihak ketiga', '800,000,000.00', '800,000,000.00', 's'], ['2000', '  - Utang Bank', '800,000,000.00', '800,000,000.00'], ['', '', '0.00', '0.00'], ['', '', '0.00', '0.00'], ['', '', '0.00', '0.00'],
  ['201', 'Utang Dagang', '781,254,930.00', '1,391,883,055.00', 's'], ['2010', '  - Utang Dagang', '781,254,930.00', '1,391,883,055.00'], ['', '', '0.00', '0.00'], ['', '', '0.00', '0.00'], ['', '', '0.00', '0.00'],
  ['202', 'Utang Lain-Lain', '14,500,000.00', '36,550,000.00', 's'], ['2020', '  - Utang Lain-Lain', '14,500,000.00', '36,550,000.00'], ['2021', '  - Utang Suspense', '0.00', '0.00'], ['203', 'Utang Pajak', '0.00', '0.00', 's'], ['2030', '  - Utang PPN', '0.00', '0.00'],
  ['', '', '0.00', '0.00'], ['', '', '0.00', '0.00'], ['', '', '0.00', '0.00'], ['204', 'Utang Giro', '1,065,470,750.00', '782,813,120.00', 's'], ['2040', '  - Utang Giro', '1,065,470,750.00', '782,813,120.00'], ['2041', '  - GIRO EKON RUNGKUT', '0.00', '0.00'],
  ['2042', '  - GIRO EKON MARGO', '0.00', '0.00'], ['205', 'Uang Muka', '70,731,900.00', '(800,100.00)', 's', 1], ['2050', '  - Uang Muka Penjualan', '70,731,900.00', '-800,100.00'], ['', 'TOTAL  Kewajiban Lancar', '2,731,957,580.00', '3,010,446,075.00', 't'],
]
const neg = (v, f) => (f ? `<span class="red">${v}</span>` : v)
const neraca = () => {
  const n = Math.max(NL.length, NR.length), rows = []
  for (let i = 0; i < n; i++) {
    const l = NL[i] || ['', '', '', ''], r = NR[i] || ['', '', '', '']
    const f = x => x[4]
    rows.push({ cls: f(l) === 't' ? 'tot' : f(l) === 'h' || f(l) === 's' ? 'sub' : '', c: [l[0], esc(l[1]).replace(/ /g, '&nbsp;'), neg(l[2], l[5]), l[3], r[0], esc(r[1]).replace(/ /g, '&nbsp;'), neg(r[2], r[5]), r[3]] })
  }
  const cols = [{ l: 'KODE REK.', w: 90 }, { l: 'KETERANGAN', w: 270 }, { l: 'BLN INI', w: 170, num: 1 }, { l: 'BLN LALU', w: 170, num: 1 }, { l: 'KODE REK.', w: 90 }, { l: 'KETERANGAN', w: 270 }, { l: 'BLN INI', w: 170, num: 1 }, { l: 'BLN LALU', w: 170, num: 1 }]
  return `<p style="margin:0;font-weight:600">XYZ</p><p class="g7-title">LAPORAN NERACA</p><p style="text-align:center;margin:0 0 12px">${esc(G7.rep.per)}</p>` + g7(cols, rows, { min: 1400 })
}
window.g7Rep = (m, i) => {
  const [name, list] = REPM[m], r = list[i]
  G7.rep.sel = r[0]
  openSheet({ crumb: [name], title: esc(r[0]), size: 'rail', body: `<div style="display:grid;gap:24px"><label class="field7"><span>PERIODE</span>${sel7(['OKTOBER-2007', 'NOVEMBER-2007', 'SEPTEMBER-2007'], G7.rep.per, 'G7.rep.per=this.value')}</label></div>`, foot: btn('Proses', 'g7RepRun()') })
}
window.g7RepRun = () => {
  const r = G7.rep.sel, top = S.stack[S.stack.length - 1]
  top.size = 'workspace'; top.title = esc(r); top.foot = ''
  top.body = r === 'Laporan Neraca Ke Kanan' ? neraca() : '<div class="empty-note">The manual shows no sample of this report</div>'
  renderLayers()
}
reg7({
  id: 'report-acc', manual: 'Manual hal. 206–212 · Laporan Accounting, Laporan Keuangan, Laporan Manajerial',
  render() {
    const t = REPM[tabOf('report-acc', 'lacc')] ? tabOf('report-acc', 'lacc') : 'lacc', [name, list] = REPM[t]
    const rows = list.map((r, i) => ({ on: `g7Rep('${t}',${i})`, cls: i === 0 ? 'cur' : '', c: [String(i + 1), r[0], esc(r[1])] }))
    return page({ title: name, tabs: [['lacc', 'Laporan Accounting'], ['lkeu', 'Laporan Keuangan'], ['lman', 'Laporan Manajerial']], tab: t, body: g7([{ l: 'NO', w: 60 }, { l: 'LAPORAN', w: 420 }, { l: 'KETERANGAN' }], rows, { min: 800 }) + STATUS })
  },
})
})();
