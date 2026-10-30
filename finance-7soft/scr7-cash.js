;(() => {
/* 7Soft as it is: Info Kas/Bank · Laporan Kas/Bank · Pencairan BG Masuk / Keluar.
   Words, columns, ticks and example rows are those of the manual (hal. 174–199) and its screenshots. */
const f2 = n => (n < 0 ? '-' : '') + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const f0 = n => Math.round(n).toLocaleString('en-US')
const td = (h, n) => `<td class="${n ? 'is-num' : ''}">${h}</td>`
const th = (l, o = '') => `<th ${o}>${l}</th>`
const t7 = (w, head, rows, foot) => `<div class="ds-table-card" style="overflow-x:auto"><table class="ds-table tbl t7" style="min-width:${w.reduce((a, b) => a + b, 0)}px"><colgroup>${w.map(x => `<col style="width:${x}px">`).join('')}</colgroup><thead>${head}</thead><tbody>${rows}</tbody>${foot ? `<tfoot>${foot}</tfoot>` : ''}</table></div>`
const fld = (l, inner) => `<label class="field7" style="flex-direction:row;align-items:center;gap:10px;min-width:0"><span>${l}</span>${inner}</label>`
const inp = (v, w = 150) => `<input value="${esc(v)}" style="width:${w}px">`
const tick = (on, label, act) => `<label style="display:inline-flex;align-items:center;gap:8px;cursor:pointer;font-weight:500"><input type="checkbox" class="cb7" ${on ? 'checked' : ''} onchange="${act}">${label}</label>`
const link = (l, on) => `<span class="ds-link" style="cursor:pointer" onclick="${on}">${l}</span>`
const tb = (labels, count, acts = {}) => `<div style="display:flex;align-items:center;flex-wrap:wrap;gap:6px 20px;margin:0 0 16px">${labels.map(l => acts[l] ? link(l, acts[l]) : `<span class="mute">${l}</span>`).join('')}<span style="margin-left:auto;border:1px solid var(--hairline-2);border-radius:var(--r-inner);padding:6px 24px;background:var(--canvas)">${count}</span></div>`

/* ═════════ Info Kas / Bank (hal. 174–179) ═════════ */
const ID = 'kas-info'
const KB = [ // KAS/BANK tab, as on the screenshot
  ['100001', 'Kas Kecil', 133428550, 0, 0, 133428550], ['100002', 'Kas Besar', 642282185.83, 68970, 19057512.64, 623293643.19], ['100003', 'AYAT PERANTARA', 3, 0, 0, 3], ['100004', 'Kas kecil kecil', 455000, 0, 0, 455000],
  ['100101', 'Bank BRI', -868449735.91, 88.88, 88.88, -868449735.91], ['100102', 'Bank BCA', 25506185.5, 0, 0, 25506185.5], ['100103', 'Bank MEGA', 13144828.1, 0, 0, 13144828.1], ['100104', 'Bank Danamon', 4699688.87, 0, 0, 4699688.87],
  ['100105', 'Cadangan Peputaran - Bank Ekonomi', 0, 0, 0, 0], ['100201', 'GIRO', 0, 0, 0, 0], ['101101', 'Piutang 146', 2567343982, 0, 0, 2567343982], ['101106', 'Piutang Amir', 0, 0, 0, 0],
  ['101301', 'GIRO  MASUK', 653490400, 177.76, 88.88, 653490488.88], ['204001', 'GIRO EKON INDUK BR', -1350249513, 0, 0, -1350249513], ['204002', 'GIRO EKON RKT BR', -287652948, 0, 0, -287652948], ['204003', 'GIRO EKON MRG BR', -332710229, 0, 0, -332710229],
]
const CARD = [ // KARTU KAS/BANK, Kas Kecil, as on the screenshot: [tanggal, no, debet, kredit]
  ['02 Aug 07', 'KK-07-08-00109', 1000000, 0], ['02 Aug 07', 'KK-07-08-00041', 0, 4688000], ['03 Aug 07', 'KK-07-08-00110', 2500000, 0], ['03 Aug 07', 'KK-07-08-00046', 0, 1298000], ['04 Aug 07', 'KK-07-08-00111', 1000000, 0], ['04 Aug 07', 'KK-07-08-00053', 0, 2475000],
  ['06 Aug 07', 'KK-07-08-00112', 2180000, 0], ['06 Aug 07', 'KK-07-08-00058', 0, 2553500], ['07 Aug 07', 'KK-07-08-00113', 1000000, 0], ['07 Aug 07', 'KK-07-08-00064', 0, 482500], ['08 Aug 07', 'KK-07-08-00065', 0, 334000], ['09 Aug 07', 'KK-07-08-00114', 3000000, 0],
  ['09 Aug 07', 'KK-07-08-00069', 0, 1035500], ['10 Aug 07', 'KK-07-08-00115', 1000000, 0], ['10 Aug 07', 'KK-07-08-00072', 0, 2692000], ['13 Aug 07', 'KK-07-08-00073', 0, 1177500], ['13 Aug 07', 'KK-07-08-00116', 1000000, 0], ['14 Aug 07', 'KK-07-08-00117', 1000000, 0],
  ['14 Aug 07', 'KK-07-08-00015', 0, 618000], ['15 Aug 07', 'KK-07-08-00118', 1000000, 0], ['15 Aug 07', 'KK-07-08-00031', 0, 1120500], ['16 Aug 07', 'KK-07-08-00032', 0, 1620500], ['16 Aug 07', 'KK-07-08-00033', 3000000, 0],
]
// BKM: [tanggal, no, kas/bank, kode, nama, no cek/giro/card, total]
const BKM = [
  ['01 Jul 07', '8638', 'GIRO  MASUK', 'B62', 'BARUNA SENTOSA JAYA', '188021/07', 7700000], ['27 Jul 07', 'KM-07-09-00622', 'Kas Besar', 'M09', 'MERK MAKMUR MA', '', 0], ['30 Jul 07', '7570', 'GIRO  MASUK', '', '', '778831', 6037000],
  ['30 Jul 07', '7575', 'GIRO  MASUK', 'B14', 'BANUWA GAYA AGUNG', '863899', 3912500], ['30 Jul 07', '7576', 'GIRO  MASUK', 'SU02', 'LANGGENG SARI', '010342', 2146000], ['30 Jul 07', '7577', 'GIRO  MASUK', 'S20', 'SARANA LANGKAH BAN', '778961', 10125000],
  ['30 Jul 07', '7578', 'GIRO  MASUK', 'N48', 'NOVAL TERANG UTAMA', '425369', 2500000], ['30 Jul 07', '7579', 'GIRO  MASUK', 'N48', 'NOVAL TERANG UTAMA', '425368', 3062500], ['30 Jul 07', '7580', 'GIRO  MASUK', 'R15', 'RAHAYU JAYA UD(0813', '776553', 2643750],
  ['30 Jul 07', '7581', 'GIRO  MASUK', 'R15', 'RAHAYU JAYA UD(0813', '776551', 2762500], ['30 Jul 07', '7582', 'GIRO  MASUK', 'SS18', 'LANGGENG GADUKAN', '965392', 31300000], ['30 Jul 07', '7585', 'GIRO  MASUK', 'SS18', 'LANGGENG GADUKAN', '965393', 12764000],
  ['30 Jul 07', '7586', 'GIRO  MASUK', 'SS18', 'LANGGENG GADUKAN', '965394', 26165000], ['30 Jul 07', '7587', 'GIRO  MASUK', 'B19', 'BATU GAYA MAS.B', '699989', 3225000], ['30 Jul 07', '7588', 'GIRO  MASUK', 'S20', 'SARANA LANGKAH BAN', '778989', 13330000],
  ['30 Jul 07', '7589', 'GIRO  MASUK', 'K02', 'KURNIA ABADI JAYA.B', '472881', 27250000], ['30 Jul 07', '7590', 'GIRO  MASUK', 'K02', 'KURNIA ABADI JAYA.B', '472880', 21780000], ['30 Jul 07', '7591', 'GIRO  MASUK', 'N51', 'AKA JAYA JAYA', '821048', 7920000],
  ['30 Jul 07', '7592', 'GIRO  MASUK', 'N51', 'AKA JAYA JAYA', '821049', 12000000], ['30 Jul 07', '7593', 'GIRO  MASUK', 'I09', 'INDRA JAYA JAYA.B', '043861', 4217500], ['30 Jul 07', '7594', 'GIRO  MASUK', 'P19', 'PENDOWO SAHABAT', '417439', 3800000],
  ['30 Jul 07', '7595', 'GIRO  MASUK', 'M58', 'MAJU MAKMUR JAYA S.', '727135', 8010000], ['30 Jul 07', '7596', 'GIRO  MASUK', 'B52', 'BANGUN SENTOSA PER', '217774', 10000000], ['30 Jul 07', '7597', 'GIRO  MASUK', 'J04', 'JAYA ABADI MAKMUR K', '677891', 8808000],
  ['30 Jul 07', '7599', 'GIRO  MASUK', 'D21', 'AGUNG REJO', '191107', 21930000], ['30 Jul 07', '7600', 'GIRO  MASUK', 'R15', 'RAHAYU JAYA UD(0813', '776587', 2412500], ['30 Jul 07', '7601', 'GIRO  MASUK', 'J12', 'JOYO LANGKAH MAKMU', '37502', 4700000],
  ['30 Jul 07', '7602', 'GIRO  MASUK', 'L12', 'LESTARI TERANG TOKO', '7138031', 7000000],
]
// BKK: [tanggal, no, nama kas/bank, kode, nama, total, no cek/giro/card]
const BKK = [
  ['01 Jul 07', 'KK-07-09-00122', 'Kas Besar', '', '', 0, ''], ['30 Jul 07', '6349', 'GIRO EKON INDUK BR', 'SS23', 'RMI KOMP', 0, '141864/EKON'], ['30 Jul 07', '6350', 'GIRO', 'ST05', 'LANGGENG JAYA', 2656000, '141870/EKON'],
  ['30 Jul 07', '6351', 'GIRO', 'SS07', 'MAKMUR PC', 10092144, '141871/EKON'], ['30 Jul 07', '6352', 'GIRO', 'SP01', 'LANGGENG PUTRA PEF', 40566240, '141875/EKON'], ['30 Jul 07', '6353', 'GIRO EKON RKT BR', 'SSDK', 'LANGGENG KUMPUL', 3614715, '142777/EKON'],
  ['30 Jul 07', '6354', 'GIRO EKON RKT BR', 'ST01', 'PC LANGGENG JAYA', 30000000, '142178'], ['30 Jul 07', '6355', 'GIRO EKON RKT BR', 'SS08', 'JAKARTA KOMPUTER', 30000000, '142179/EKON'], ['30 Jul 07', '6356', 'GIRO EKON RKT BR', 'SS08', 'JAKARTA KOMPUTER', 40000000, '142180'],
  ['30 Jul 07', '6357', 'GIRO EKON RKT BR', 'SS08', 'JAKARTA KOMPUTER', 40000000, '142181/EKON'], ['30 Jul 07', '6358', 'GIRO EKON INDUK BR', 'SD01', 'DAMAI SAJA', 0, '142182/EKON'], ['30 Jul 07', '6359', 'GIRO', 'SS06', 'SUMBER KOMPUTER', 10834337, '142183'],
  ['30 Jul 07', '6360', 'GIRO', '', '', 8073740, '141868/EKON'], ['30 Jul 07', '6361', 'GIRO', '', '', 20322720, '141874/EKON'], ['30 Jul 07', '6362', 'GIRO EKON INDUK BR', '', '', 0, '141862/EKON'], ['30 Jul 07', '6363', 'GIRO', '', '', 32374999, '141863/EKON'],
  ['30 Jul 07', '6364', 'GIRO', '', '', 1460641, '141872/EKON'], ['30 Jul 07', '6365', 'GIRO', '', '', 5055311, '141873/EKON'], ['30 Jul 07', '6366', 'GIRO EKON INDUK BR', '', '', 0, '1412176/EKON'], ['30 Jul 07', '6367', 'GIRO', '', '', 36450000, '141864/EKON'],
  ['30 Jul 07', '6368', 'GIRO EKON INDUK BR', 'SS23', 'RMI KOMP', 0, '141892/EKON'], ['30 Jul 07', '6369', 'GIRO', 'SS01', 'LANGGENG CD', 50000000, '141895/EKON'], ['30 Jul 07', '6370', 'GIRO', 'SS08', 'JAKARTA KOMPUTER', 26964960, '141897/EKON'],
  ['30 Jul 07', '6371', 'GIRO', 'SS08', 'JAKARTA KOMPUTER', 4300884, '141898/EKON'], ['30 Jul 07', '6372', 'GIRO', 'SS07', 'MAKMUR PC', 24668160, '141898'], ['30 Jul 07', '6373', 'GIRO', 'ST05', 'LANGGENG JAYA', 0, '141900/EKON'],
  ['30 Jul 07', '6374', 'GIRO', 'ST05', 'LANGGENG JAYA', 6511000, '142201/EKON'], ['30 Jul 07', '6375', 'GIRO', 'SSDK', 'LANGGENG KUMPUL', 776705, '142202/07'],
]
const LAST = KB.length - 1
const rec = () => filt(ID, 'rec', 0)
const recHead = () => { const r = rec(); return `<div style="display:flex;align-items:center;gap:16px;margin:0 0 16px"><input value="${r === 0 ? '500' : KB[r][0]}" style="width:140px;height:44px;padding:0 12px;border:1px solid var(--hairline-2);border-radius:var(--r-inner);font:inherit;font-weight:600"><span style="font-size:20px;font-weight:500">${esc(KB[r][1])}</span></div>` }
const nav = () => ({ First: `setFilt('${ID}','rec',0)`, Prior: `setFilt('${ID}','rec',${Math.max(0, rec() - 1)})`, Next: `setFilt('${ID}','rec',${Math.min(LAST, rec() + 1)})`, Last: `setFilt('${ID}','rec',${LAST})`, Refresh: `soon('Refresh')`, Search: `soon('Search')`, Filter: `soon('Filter')`, Format: `soon('Format')`, Default: `soon('Default')`, XLS: `soon('XLS')` })
const TB_INFO = ['First', 'Prior', 'Next', 'Last', 'Search', 'Filter', 'Refresh', 'Go to', 'Format', 'Default', 'XLS']

function tabKas() {
  const rows = KB.map(r => `<tr>${td(r[0])}${td(esc(r[1]))}${td(f2(r[2]), 1)}${td(f2(r[3]), 1)}${td(f2(r[4]), 1)}${td(f2(r[5]), 1)}</tr>`).join('')
  return `<div style="display:flex;align-items:center;gap:28px;flex-wrap:wrap;margin:0 0 16px">${fld('PERIODE', select(['DEC 2009'], 'DEC 2009'))}${fld('SAMPAI TANGGAL', inp('10 Feb 2016'))}${btn('Refresh', `soon('Refresh')`)}</div>` +
    t7([130, 330, 170, 150, 170, 170], `<tr>${th('KODE ACC')}${th('NAMA KAS/BANK')}${th('SALDO AWAL', 'class="is-num"')}${th('DEBET', 'class="is-num"')}${th('KREDIT', 'class="is-num"')}${th('SALDO AKHIR', 'class="is-num"')}</tr>`, rows)
}
function tabKartu() {
  const r = rec(), open = r === 0 ? 5853500 : KB[r][2]
  let run = open, dr = 0, cr = 0
  let rows = `<tr class="opening">${td('')}${td('')}${td('SALDO AWAL')}${td('')}${td(f2(open), 1)}${td(f2(0), 1)}${td(f2(open), 1)}</tr>`
  if (r === 0) CARD.forEach(c => { run += c[2] - c[3]; dr += c[2]; cr += c[3]; rows += `<tr>${td(c[0] + '  00:00:00')}${td(c[1])}${td('BKK (Bukti Kas/Bank Keluar)')}${td('')}${td(f2(c[2]), 1)}${td(f2(c[3]), 1)}${td(f2(run), 1)}</tr>` })
  const foot = r === 0 ? { a: 5853500, d: 238678250, k: 111103200, e: 133428550 } : { a: open, d: 0, k: 0, e: open }
  const box = (l, v) => fld(l, `<input value="${f2(v)}" readonly style="width:160px;text-align:right">`)
  return `<div style="display:flex;align-items:center;gap:28px;flex-wrap:wrap;margin:0 0 8px">${fld('KAS/BANK', inp(KB[r][1], 360))}</div>` +
    `<div style="display:flex;align-items:center;gap:28px;flex-wrap:wrap;margin:0 0 16px">${fld('PERIODE', select(['JUL 2007'], 'JUL 2007'))}${fld('SAMPAI TANGGAL', inp('10 Feb 2016'))}${btn('Refresh', `soon('Refresh')`)}</div>` +
    t7([170, 170, 250, 160, 160, 160, 170], `<tr>${th('TANGGAL')}${th('NO TRANSAKSI')}${th('TIPE')}${th('NAMA CLIENT')}${th('DEBET', 'class="is-num"')}${th('KREDIT', 'class="is-num"')}${th('SALDO', 'class="is-num"')}</tr>`, rows) +
    `<div style="display:flex;gap:24px;flex-wrap:wrap;margin-top:16px">${box('AWAL', foot.a)}${box('DEBET', foot.d)}${box('KREDIT', foot.k)}${box('AKHIR', foot.e)}</div>`
}
function listTab(kind) {
  const kb = filt(ID, 'kb', 0) === 1, all = filt(ID, 'all', 1) === 1, name = KB[rec()][1].toLowerCase(), isM = kind === 'BKM'
  let xs = isM ? BKM : BKK
  const kasOf = r => isM ? r[2] : r[2]
  if (kb) xs = xs.filter(r => kasOf(r).toLowerCase() === name)
  if (!all) xs = []
  const rows = xs.map(r => isM
    ? `<tr>${td('+')}${td(r[0] + '  00:00:00')}${td(r[1])}${td(esc(r[2]))}${td(r[3])}${td(esc(r[4]))}${td(r[5])}${td(f2(r[6]), 1)}${td('')}${td('200707')}</tr>`
    : `<tr>${td('+')}${td(r[0] + '  00:00:00')}${td(r[1])}${td(esc(r[2]))}${td(r[3])}${td(esc(r[4]))}${td(f2(r[5]), 1)}${td(r[6])}${td('')}${td('200707')}</tr>`).join('')
  const head = isM
    ? `<tr>${th('')}${th('TANGGAL')}${th('NO BKM')}${th('KAS/BANK')}${th('KODE CLIENT')}${th('NAMA CLIENT')}${th('NO CEK/ GIRO/ CARD')}${th('TOTAL', 'class="is-num"')}${th('KETERANGAN')}${th('PERIODE')}</tr>`
    : `<tr>${th('')}${th('TANGGAL')}${th('NO BKK')}${th('NAMA KAS/ BANK')}${th('KODE CLIENT')}${th('NAMA CLIENT')}${th('TOTAL', 'class="is-num"')}${th('NO CEK/GIRO/CARD')}${th('KETERANGAN')}${th('PERIODE')}</tr>`
  const w = isM ? [44, 200, 170, 170, 120, 230, 160, 150, 170, 100] : [44, 200, 170, 220, 120, 230, 150, 160, 170, 100]
  return `<div style="display:flex;align-items:center;gap:28px;flex-wrap:wrap;margin:0 0 16px">${tick(kb, 'Kas/Bank', `setFilt('${ID}','kb',${kb ? 0 : 1})`)}${tick(all, 'All', `setFilt('${ID}','all',${all ? 0 : 1})`)}${fld('', inp('01 Feb 2016', 150))}${fld('', inp('29 Feb 2016', 150))}${btn(`${kind} Baru`, `soon('${kind} Baru')`)}</div>` + t7(w, head, rows)
}
reg7({
  id: ID, manual: 'Manual hal. 174–179',
  render() {
    const tab = tabOf(ID, 'accounts')
    const body = tb(TB_INFO, `${rec() + 1} of ${KB.length}`, nav()) + recHead() + (tab === 'card' ? tabKartu() : tab === 'bkm' ? listTab('BKM') : tab === 'bkk' ? listTab('BKK') : tabKas())
    return page({ title: 'Info Kas / Bank', tabs: [['accounts', 'KAS/BANK'], ['card', 'KARTU KAS/BANK'], ['bkm', 'BKM'], ['bkk', 'BKK']], tab, body })
  },
})

/* ═════════ Laporan Kas/Bank (hal. 192–199) ═════════ */
const RID = 'kas-report'
const REP = [
  ['Laporan Harian Kas & Bank', 'Kas/ Bank Per Tanggal'], ['Laporan Harian Kas-Bank Detail', 'Kas/ Bank'], ['Laporan Harian Kas-Bank Detail Per Transaksi', 'Kas/ Bank'], ['Laporan Kas-Bank Detail Per Transaksi Periodik', 'Periodik'],
  ['Laporan Kas-Bank Per Periode', 'Kas/ Bank TANGGAL ... S/D ...'], ['Laporan Kas-Bank Per Periode Detail', 'Kas/ Bank'], ['Summary Pelunasan Piutang', 'Penerimaan dari sisi Kas/Bank'], ['Detail Pelunasan Piutang', 'Penerimaan dari sisi Kas/Bank'],
  ['Summary Pelunasan Hutang', 'Pengeluaran dari sisi Kas/Bank'], ['Detail Pelunasan Hutang', 'Pengeluaran dari sisi Kas/Bank'], ['Summary Bukti Kas Masuk (BKM)', 'BKM'], ['Detail Bukti Kas Masuk (BKM)', 'BKM'],
  ['Summary Bukti Kas Keluar (BKK)', 'BKK'], ['Detail Bukti Kas Keluar (BKK)', 'BKK'], ['Laporan Giro Masuk', 'GIRO'], ['Laporan Giro Keluar', 'GIRO'], ['Laporan Giro Masuk Belum Cair', 'GIRO'], ['Laporan Giro Keluar Belum Cair', 'GIRO'],
  ['Laporan Perincian Tolakan Giro Masuk', 'GIRO'], ['Laporan Perincian Tolakan Giro Keluar', 'GIRO'],
]
const params = n => {
  const kas = fld('Kas/Bank', select(['Kas Kecil'], 'Kas Kecil')), d1 = fld('Tanggal', inp('01 Feb 2016', 140)), d2 = fld('S/D', inp('29 Feb 2016', 140))
  if (n === 1) return kas + fld('Tanggal', inp('26 May 2006', 140))
  if (n === 2 || n === 3) return kas + fld('Tanggal', inp('26 May 2006', 140))
  if (n === 4) return fld('Periode', select(['JUL 2007'], 'JUL 2007')) + kas
  if (n === 5 || n === 6) return kas + d1 + d2
  if (n <= 14) return d1 + d2
  return fld('No Dokumen', inp('', 150)) + fld(n % 2 ? 'Customer' : 'Supplier', inp('', 180)) + d1 + d2 + ['ALL', 'NEW', 'CAIR', 'TOLAKAN'].map((s, i) => `<label style="display:inline-flex;align-items:center;gap:6px"><input type="radio" name="st${n}" class="cb7" ${i === 0 ? 'checked' : ''}>${s}</label>`).join('')
}
const paper = (title, sub, inner, by = 'MERDA') => `<div class="card7" style="margin-top:24px;overflow-x:auto"><div style="font-weight:500;margin-bottom:8px">PT. X Y Z</div><div style="text-align:center;margin-bottom:12px"><div style="font-size:20px;font-weight:600">${esc(title)}</div><div>${sub}</div></div>${inner}<div style="margin-top:8px">Dicetak oleh ${by}</div></div>`
const sm = (w, labels, rows, foot) => t7(w, `<tr>${labels.map((l, i) => th(l, i === labels.length - 1 && 0 ? '' : '')).join('')}</tr>`, rows, foot)
const nl = (x, d) => d ? f2(x) : f0(x)
function sample(n) {
  const H9 = ['TANGGAL', 'NO TRANSAKSI', 'KAS/BANK', 'KETERANGAN', 'TOTAL', 'NO CHEQUE', 'JATUH TEMPO', 'STATUS'], W9 = [120, 170, 150, 200, 140, 140, 120, 100]
  const r9 = (a, d) => `<tr>${td(a[0])}${td(a[1])}${td(a[2])}${td('')}${td(nl(a[3], d), 1)}${td('')}${td('')}${td('NEW')}</tr>`
  if (n === 9) return paper('Laporan Pembayaran Ke Supplier', '01/04/2006 - 31/05/2006', sm(W9, H9, [['24/04/2006', 'KK-06-04-00041', 'KAS KECIL', 1207500], ['11/05/2006', 'KK-06-05-00175', 'KAS KECIL', 1200000], ['12/05/2006', 'KK-06-05-00176', 'KAS KECIL', 309250], ['15/05/2006', 'KK-06-05-00174', 'KAS KECIL', 25245750]].map(a => r9(a)).join(''), `<tr>${td('')}${td('')}${td('')}${td('<b>TOTAL</b>', 1)}${td('27,962,500', 1)}${td('')}${td('')}${td('')}</tr>`))
  if (n === 10) {
    const g = [['01/05/2006', 'KK-06-05-00149', 12295250, [['06-04-00059', 12295250]]], ['01/05/2006', 'KK-06-05-00151', 21704750, [['06-04-00012', 5204750], ['06-05-00001', 16500000]]], ['01/05/2006', 'KK-06-05-00152', 9600000, [['06-04-00012', 9600000]]], ['01/05/2006', 'KK-06-05-00153', 9955000, [['06-04-00012', 9955000]]], ['02/05/2006', 'KK-06-05-00150', 10000000, [['06-04-00012', 5000000], ['06-05-00001', 5000000]]]]
    const rows = g.map(x => `<tr>${td(x[0])}${td(x[1])}${td('KAS KECIL')}${td('SUMBER BERKAT INDUK')}${td('')}${td(f0(x[2]), 1)}${td('')}${td('')}${td('NEW')}</tr>` + x[3].map(s => `<tr>${td('')}${td(s[0])}${td('')}${td('')}${td('')}${td(f0(s[1]), 1)}${td('')}${td('')}${td('')}</tr>`).join('') + `<tr><td colspan="9">Dicetak oleh MERDA</td></tr>`).join('')
    return paper('Laporan Pembayaran Ke Supplier', '01/05/2006 - 02/05/2006', t7([120, 170, 130, 220, 130, 130, 130, 120, 90], `<tr>${['TANGGAL', 'NO TRANSAKSI', 'KAS/BANK', 'SUPPLIER', 'KETERANGAN', 'TOTAL', 'NO CHEQUE', 'JATUH TEMPO', 'STATUS'].map(l => th(l)).join('')}</tr>`, rows), '').replace('<div style="margin-top:8px">Dicetak oleh </div>', '')
  }
  if (n === 13) {
    const xs = [['01/07/2006', 'KK-06-07-00002', 512250], ['01/07/2006', 'KK-06-07-00003', 2350000], ['03/07/2006', 'KK-06-07-00004', 257000], ['04/07/2006', 'KK-06-07-00005', 6388000], ['05/07/2006', 'KK-06-07-00006', 181000], ['06/07/2006', 'KK-06-07-00007', 143750], ['07/07/2006', 'KK-06-07-00008', 55000], ['08/07/2006', 'KK-06-07-00009', 415000], ['10/07/2006', 'KK-06-07-00010', 33600]]
    return paper('Laporan Pengeluaran Kas / Bank', '01/07/2006 - 10/07/2006', sm(W9, H9, xs.map(x => r9([x[0], x[1], 'KAS KECIL', x[2]], 1)).join(''), `<tr>${td('')}${td('')}${td('')}${td('<b>TOTAL</b>', 1)}${td('10,335,600.00', 1)}${td('')}${td('')}${td('')}</tr>`))
  }
  if (n === 11) {
    const xs = [['29/04/2006', 'KM-06-04-00001', 17000], ['02/05/2006', 'KM-99-12-00001', 0], ['13/05/2006', 'KM-06-05-00136', 47500], ['19/05/2006', 'KM-06-05-00137', 0], ['19/05/2006', 'KM-06-05-00138', 0], ['24/07/2006', 'KM-06-07-00001', 20000], ['23/08/2006', 'KM-06-08-00001', 4364750], ['30/08/2006', 'KM-06-08-00002', 10000000], ['02/09/2006', 'KM-06-09-00001', 50000]]
    return paper('Laporan Penerimaan Kas / Bank', 'SEMUA', sm(W9, H9, xs.map(x => r9([x[0], x[1], 'KAS KECIL', x[2]])).join(''), `<tr>${td('')}${td('')}${td('')}${td('<b>TOTAL</b>', 1)}${td('14,499,250', 1)}${td('')}${td('')}${td('')}</tr>`), 'fatra')
  }
  if (n === 8) {
    const g = [['03/06/2006', 'KM-06-06-00019', 460000, '06-06-00013'], ['09/06/2006', 'KM-06-06-00047', 664000, '06-06-00077'], ['14/06/2006', 'KM-06-06-00081', 460000, '06-06-00166'], ['21/06/2006', 'KM-06-06-00145', 662000, '06-06-00254'], ['27/06/2006', 'KM-06-06-00246', 0, ''], ['27/06/2006', 'KM-06-06-00257', 357000, '06-06-00351'], ['29/06/2006', 'KM-06-06-00313', 760000, '06-06-00412']]
    const rows = g.map(x => `<tr>${td(x[0])}${td(x[1])}${td('COOKIES BOX')}${td('KAS KECIL')}${td('')}${td(f0(x[2]), 1)}${td('')}${td('')}${td('NEW')}</tr>` + (x[3] ? `<tr>${td(x[3])}${td('')}${td('')}${td('')}${td('')}${td(f0(x[2]), 1)}${td('')}${td('')}${td('')}</tr>` : '')).join('')
    return paper('Laporan Pelunasan Kas / Bank', '01/06/2006 - 30/06/2006', t7([130, 170, 150, 140, 130, 120, 100, 110, 90], `<tr>${['TANGGAL', 'NO TRANSAKSI', 'CUSTOMER', 'KAS/BANK', 'KETERANGAN', 'TOTAL', 'NO CHEQUE', 'JATUH TEMPO', 'STATUS'].map(l => th(l)).join('')}</tr>`, rows))
  }
  if (n >= 2 && n <= 6 && n !== 5) {
    const L = [['26/05/2006', 'Pelunasan Hutang', 'KK-06-05-00219', '', 0, 1700000], ['26/05/2006', 'Pelunasan Piutang', 'KM-06-05-00257', '', 167000, 0], ['26/05/2006', 'Pelunasan Piutang', 'KM-06-05-00257', '', 91000, 0], ['26/05/2006', 'Pelunasan Piutang', 'KM-06-05-00257', '', 191000, 0], ['26/05/2006', 'Pelunasan Piutang', 'KM-06-05-00257', '', 142000, 0], ['26/05/2006', 'Pelunasan Piutang', 'KM-06-05-00257', '', 790000, 0], ['26/05/2006', 'Pelunasan Piutang', 'KM-06-05-00257', '', 95500, 0], ['26/05/2006', 'Pelunasan Piutang', 'KM-06-05-00257', '', 132000, 0], ['26/05/2006', 'Pelunasan Piutang', 'KM-06-05-00258', '', 380000, 0], ['26/05/2006', 'BKK (Bukti Kas/Ban', 'KK-06-05-00155', 'AGUS', 0, 10000], ['26/05/2006', 'BKK (Bukti Kas/Ban', 'KK-06-05-00155', 'AGUS', 0, 10000], ['26/05/2006', 'BKK (Bukti Kas/Ban', 'KK-06-05-00155', 'KELEBIHAN GAJI AGUS', 0, 6000], ['26/05/2006', 'BKK (Bukti Kas/Ban', 'KK-06-05-00155', '', 0, 30000], ['26/05/2006', 'BKK (Bukti Kas/Ban', 'KK-06-05-00155', '', 0, 21200], ['26/05/2006', 'BKK (Bukti Kas/Ban', 'KK-06-05-00155', '', 0, 22500]]
    let run = 429519.85; let rows = `<tr>${td('')}${td('Saldo awal')}${td('')}${td('')}${td('')}${td('')}${td(f2(run), 1)}</tr>`
    L.forEach(x => { run += x[4] - x[5]; rows += `<tr>${td(x[0])}${td(x[1])}${td(x[2])}${td(esc(x[3]))}${td(f2(x[4]), 1)}${td(f2(x[5]), 1)}${td(f2(run), 1)}</tr>` })
    const inner = `<div style="margin:0 0 8px">KAS / BANK : <b>KAS KECIL</b></div>` + t7([120, 170, 170, 210, 130, 130, 140], `<tr>${['TANGGAL', 'TIPE', 'NO TRANSAKSI', 'KETERANGAN', 'DEBET', 'KREDIT', 'SALDO'].map((l, i) => th(l, i > 3 ? 'class="is-num"' : '')).join('')}</tr>`, rows, `<tr>${td('')}${td('')}${td('')}${td('<b>T O T A L</b>', 1)}${td('1,988,500.00', 1)}${td('1,799,700.00', 1)}${td('')}</tr>`)
    return paper('Laporan Kas / Bank', '26/05/2006', inner)
  }
  if (n >= 15) {
    const cols = ['NO BKM', 'NO CEK', 'TANGGAL BUAT', 'TANGGAL JATUH TEMPO', 'TANGGAL CAIR', 'BANK TUJUAN', 'STATUS'], isIn = n % 2 === 1
    if (!isIn) cols[0] = 'NO BKK'
    const src = (isIn ? GIN : GOUT).filter(r => n === 15 || n === 16 ? true : n === 17 || n === 18 ? (r[10] === 'NEW' || r[10] === 'TOLAKAN') : r[10] === 'TOLAKAN')
    const pick = r => isIn ? { who: r[1], no: r[0], bk: r[2], cr: r[5], jt: r[6], ca: r[7], tj: r[9], st: r[10] } : { who: r[1], no: r[0], bk: r[2], cr: r[4], jt: r[5], ca: r[6], tj: r[8], st: r[9] }
    const xs = src.slice(0, 12).map(pick)
    const grouped = n === 17 || n === 18, outRows = []
    const line = x => `<tr>${td(x.bk)}${td(esc(x.no))}${td(x.cr)}${td(x.jt)}${td(x.ca || '')}${td(x.tj || '')}${td(x.st)}</tr>`
    if (grouped) { const by = {}; xs.forEach(x => (by[x.who] = by[x.who] || []).push(x)); Object.keys(by).forEach(k => { outRows.push(`<tr class="grp"><td colspan="7"><div class="grp-in">${esc(k)}</div></td></tr>`); by[k].forEach(x => outRows.push(line(x))) }) } else xs.forEach(x => outRows.push(line(x)))
    const t = n >= 19 ? 'Laporan Perincian Tolakan Giro ' + (isIn ? 'Masuk' : 'Keluar') : n >= 17 ? 'Laporan Giro ' + (isIn ? 'Masuk' : 'Keluar') + ' Belum Cair' : 'Laporan Giro ' + (isIn ? 'Masuk' : 'Keluar')
    return paper(t, 'ALL', t7([130, 150, 130, 170, 130, 150, 110], `<tr>${cols.map(l => th(l)).join('')}</tr>`, outRows.join('')))
  }
  return paper(REP[n - 1][0], '', '')
}
const GRO_HEAD = ''
reg7({
  id: RID, manual: 'Manual hal. 192–199',
  render() {
    const n = filt(RID, 'no', 1)
    const rows = REP.map((r, i) => `<tr class="ds-opens ${i + 1 === n ? 'sel7' : ''}" style="${i + 1 === n ? 'background:var(--accent-bg)' : ''}" onclick="setFilt('${RID}','no',${i + 1})">${td(i + 1)}${td(esc(r[0]))}${td(esc(r[1]))}</tr>`).join('')
    const list = t7([60, 420, 320], `<tr>${th('NO')}${th('LAPORAN')}${th('KETERANGAN')}</tr>`, rows)
    const ctl = `<div style="display:flex;align-items:center;gap:24px;flex-wrap:wrap;margin:24px 0 0">${params(n)}${btn('Cetak ke layar', `soon('Cetak ke layar')`)}${btn('Cetak ke printer', `soon('Cetak ke printer')`)}</div>`
    return page({ title: 'Laporan Kas/Bank', body: list + ctl + sample(n) })
  },
})

/* ═════════ Pencairan BG Masuk / Keluar (hal. 187–192) ═════════ */
const GID = 'giro-board'
// BG masuk: [no bg, customer, no bkm, bank, total, buat, jatuh tempo, cair, tolak, bank tujuan, status, closed, periode]
const GIN = [
  ['056879', 'BINTANG G', 'KM-07-08-0', 'BRI', 1393750, '02 Aug 2007', '08 Aug 2007', '08 Aug 2007', '09 Aug 2007', 'Bank BRI', 'TOLAKAN', 'C', '200708'], ['207999', 'ASIA JAYA', 'KM-07-08-0', 'METRO EXPRESS', 9309600, '02 Aug 2007', '08 Aug 2007', '08 Aug 2007', '', 'Bank BRI', 'CAIR', 'C', '200708'],
  ['043869', 'INDRA JAY', 'KM-07-08-0', 'BII', 10417800, '02 Aug 2007', '12 Aug 2007', '20 Aug 2007', '', 'Bank BRI', 'CAIR', 'C', '200708'], ['0438670', 'INDRA JAY', 'KM-07-08-0', 'BII', 7141800, '02 Aug 2007', '15 Aug 2007', '15 Aug 2007', '', 'Bank BRI', 'CAIR', 'C', '200708'],
  ['778831', '', '7570', 'BRI', 6037000, '30 Jul 2007', '03 Aug 2007', '03 Aug 2007', '', 'Bank BRI', 'CAIR', 'C', '200708'], ['015920', 'BAMBANG', '7573', 'CNB', 0, '31 Jul 2007', '05 Aug 2007', '02 Mar 2011', '', 'Kas Kecil', 'CAIR', '', '201103'],
  ['863899', 'BANUWA G', '7575', 'BRI', 3912500, '30 Jul 2007', '28 Aug 2007', '28 Aug 2007', '', 'Bank BRI', 'CAIR', 'C', '200708'], ['010342', 'LANGGENG', '7576', 'PRIMA', 2146000, '30 Jul 2007', '17 Aug 2007', '20 Aug 2007', '', 'Bank BRI', 'CAIR', 'C', '200708'],
  ['778961', 'SARANA LA', '7577', 'MASPION', 10125000, '30 Jul 2007', '23 Aug 2007', '23 Aug 2007', '', 'Bank BRI', 'CAIR', 'C', '200708'], ['425369', 'NOVAL TE', '7578', 'MANDIRI', 2500000, '30 Jul 2007', '30 Aug 2007', '30 Aug 2007', '', 'Bank BRI', 'CAIR', 'C', '200708'],
  ['425368', 'NOVAL TE', '7579', 'MANDIRI', 3062500, '30 Jul 2007', '07 Sep 2007', '07 Sep 2007', '', 'Bank BRI', 'CAIR', 'C', '200709'], ['776553', 'RAHAYU JA', '7580', 'MASPION', 2643750, '30 Jul 2007', '08 Sep 2007', '10 Sep 2007', '', 'Bank BRI', 'CAIR', 'C', '200709'],
  ['776551', 'RAHAYU JA', '7581', 'MASPION', 2762500, '30 Jul 2007', '06 Sep 2007', '06 Sep 2007', '', 'Bank BRI', 'CAIR', 'C', '200709'], ['965392', 'LANGGENG', '7582', 'LIPPO', 31300000, '30 Jul 2007', '20 Aug 2007', '20 Aug 2007', '', 'Bank BRI', 'CAIR', 'C', '200708'],
  ['965393', 'LANGGENG', '7585', 'LIPPO', 12764000, '30 Jul 2007', '22 Aug 2007', '22 Aug 2007', '', 'Bank BRI', 'CAIR', 'C', '200708'], ['965394', 'LANGGENG', '7586', 'LIPPO', 26165000, '30 Jul 2007', '01 Sep 2007', '03 Sep 2007', '', 'Bank BRI', 'CAIR', 'C', '200709'],
  ['699989', 'BATU GAYA', '7587', 'MANDIRI', 3225000, '30 Jul 2007', '04 Aug 2007', '06 Aug 2007', '', 'Bank BRI', 'CAIR', 'C', '200708'], ['778989', 'SARANA LA', '7588', 'NISP', 13330000, '30 Jul 2007', '08 Aug 2007', '08 Aug 2007', '', 'Bank BRI', 'CAIR', 'C', '200708'],
  ['472881', 'KURNIA AE', '7589', 'MANDIRI', 27250000, '30 Jul 2007', '14 Aug 2007', '20 Aug 2007', '21 Aug 2007', 'Bank BRI', 'TOLAKAN', 'C', '200708'], ['472880', 'KURNIA AE', '7590', 'MANDIRI', 21780000, '30 Jul 2007', '17 Aug 2007', '20 Aug 2007', '21 Aug 2007', 'Bank BRI', 'TOLAKAN', 'C', '200708'],
  ['821048', 'AKA JAYA J', '7591', 'BRI', 7920000, '30 Jul 2007', '20 Aug 2007', '20 Aug 2007', '21 Aug 2007', 'Bank BRI', 'TOLAKAN', 'C', '200708'], ['821049', 'AKA JAYA J', '7592', 'BRI', 12000000, '30 Jul 2007', '25 Aug 2007', '25 Aug 2007', '', 'Bank BRI', 'CAIR', 'C', '200708'],
  ['043861', 'INDRA JAY', '7593', 'BII', 4217500, '30 Jul 2007', '04 Aug 2007', '06 Aug 2007', '', 'Bank BRI', 'CAIR', 'C', '200708'], ['417439', 'PENDOWO', '7594', 'MANDIRI', 3800000, '30 Jul 2007', '08 Aug 2007', '08 Aug 2007', '', 'Bank BRI', 'CAIR', 'C', '200708'],
  ['727135', 'MAJU MAK', '7595', 'ANK', 8010000, '30 Jul 2007', '10 Aug 2007', '10 Aug 2007', '', 'Bank BRI', 'CAIR', 'C', '200708'], ['217774', 'BANGUN S', '7596', 'JATIM', 10000000, '30 Jul 2007', '12 Aug 2007', '13 Aug 2007', '', 'Bank BRI', 'CAIR', 'C', '200708'],
  ['677891', 'JAYA ABAD', '7597', 'BCA', 8808000, '30 Jul 2007', '09 Aug 2007', '09 Aug 2007', '', 'Bank BRI', 'CAIR', 'C', '200708'], ['191107', 'AGUNG RE', '7599', 'BNI', 21930000, '30 Jul 2007', '17 Aug 2007', '24 Aug 2007', '', 'Bank BRI', 'CAIR', 'C', '200708'],
  ['776587', 'RAHAYU JA', '7600', 'NISP', 2412500, '30 Jul 2007', '25 Aug 2007', '25 Aug 2007', '', 'Bank BRI', 'CAIR', 'C', '200708'], ['37502', 'JOYO LANG', '7601', 'BCA', 4700000, '30 Jul 2007', '14 Aug 2007', '14 Aug 2007', '', 'Bank BRI', 'CAIR', 'C', '200708'],
  ['7138031', 'LESTARI T', '7602', 'DANAMON', 7000000, '30 Jul 2007', '04 Aug 2007', '06 Aug 2007', '', 'Bank BRI', 'CAIR', 'C', '200708'],
]
// BG keluar: [no bg, supplier, no bkk, total, buat, jatuh tempo, cair, bank tujuan, tolak, status, closed, periode]  (tolak index 8)
const K = (a, b, c, d, e, f, g, bank, st) => [a, b, c, d, '30 Jul 2007', e, f, bank, g, st, st === 'CAIR' ? 'C' : '', st === 'CAIR' ? '200708' : '']
const GOUT = [
  K('141864/EKON', 'RMI KOMP', '6349', 0, '08 Aug 2007', '', '', '', 'NEW'), K('141870/EKON', 'LANGGENG', '6350', 2656000, '09 Aug 2007', '09 Aug 2007', '', 'Bank MEGA', 'CAIR'), K('141871/EKON', 'MAKMUR P', '6351', 10092144, '18 Aug 2007', '20 Aug 2007', '', 'Bank MEGA', 'CAIR'),
  K('141875/EKON', 'LANGGENG', '6352', 40566240, '09 Aug 2007', '09 Aug 2007', '', 'Bank MEGA', 'CAIR'), K('142777/EKON', 'LANGGENG', '6353', 3614715, '21 Aug 2007', '21 Aug 2007', '', 'Bank MEGA', 'CAIR'), K('142178', 'PC LANGGI', '6354', 30000000, '21 Aug 2007', '21 Aug 2007', '', 'Bank MEGA', 'CAIR'),
  K('142179/EKON', 'JAKARTA K', '6355', 30000000, '17 Aug 2007', '20 Aug 2007', '', 'Bank MEGA', 'CAIR'), K('142180', 'JAKARTA K', '6356', 40000000, '21 Aug 2007', '21 Aug 2007', '', 'Bank MEGA', 'CAIR'), K('142181/EKON', 'JAKARTA K', '6357', 40000000, '23 Aug 2007', '23 Aug 2007', '', 'Bank MEGA', 'CAIR'),
  K('142182/EKON', 'DAMAI SAJ', '6358', 0, '14 Aug 2007', '', '', '', 'DELETE'), K('142183', 'SUMBER K', '6359', 10834337, '11 Aug 2007', '13 Aug 2007', '', 'Bank MEGA', 'CAIR'), K('141868/EKON', '', '6360', 8073740, '02 Aug 2007', '02 Aug 2007', '', 'Bank MEGA', 'CAIR'),
  K('141874/EKON', '', '6361', 20322720, '04 Aug 2007', '06 Aug 2007', '', 'Bank MEGA', 'CAIR'), K('141862/EKON', '', '6362', 0, '07 Aug 2007', '', '', '', 'DELETE'), K('141863/EKON', '', '6363', 32374999, '07 Aug 2007', '07 Aug 2007', '', 'Bank MEGA', 'CAIR'),
  K('141872/EKON', '', '6364', 1460641, '07 Aug 2007', '07 Aug 2007', '', 'Bank MEGA', 'CAIR'), K('141873/EKON', '', '6365', 5055311, '14 Aug 2007', '07 Aug 2007', '', 'Bank MEGA', 'CAIR'), K('1412176/EKON', '', '6366', 0, '07 Aug 2007', '07 Aug 2007', '', 'Bank Danamon', 'NEW'),
  K('141864/EKONA', '', '6367', 36450000, '07 Aug 2007', '07 Aug 2007', '', 'Bank MEGA', 'CAIR'), K('141892/EKON', 'RMI KOMP', '6368', 0, '18 Aug 2007', '', '', '', 'DELETE'), K('141895/EKON', 'LANGGENG', '6369', 50000000, '08 Aug 2007', '08 Aug 2007', '', 'Bank Danamon', 'CAIR'),
  K('141897/EKON', 'JAKARTA K', '6370', 26964960, '11 Aug 2007', '11 Aug 2007', '', 'Bank Danamon', 'CAIR'), K('141898/EKON', 'JAKARTA K', '6371', 4300884, '11 Aug 2007', '11 Aug 2007', '', 'Bank Danamon', 'CAIR'), K('141898', 'MAKMUR P', '6372', 24668160, '23 Aug 2007', '23 Aug 2007', '', 'Bank Danamon', 'CAIR'),
  K('141900/EKON', 'LANGGENG', '6373', 0, '14 Aug 2007', '', '', '', 'DELETE'), K('142201/EKON', 'LANGGENG', '6374', 6511000, '14 Aug 2007', '14 Aug 2007', '', 'Bank Danamon', 'CAIR'), K('142202/07', 'LANGGENG', '6375', 776705, '13 Aug 2007', '13 Aug 2007', '', 'Bank Danamon', 'CAIR'),
  K('142203/EKON', 'LANGGENG', '6376', 12305040, '13 Aug 2007', '13 Aug 2007', '', 'Bank Danamon', 'CAIR'), K('142204/EKON', 'SMI SUKA', '6377', 6250000, '17 Aug 2007', '16 Aug 2007', '', 'Bank Danamon', 'CAIR'), K('142205/EKON', 'LANGGENG', '6378', 40000000, '14 Aug 2007', '14 Aug 2007', '', 'Bank Danamon', 'CAIR'),
  K('142206/EKON', 'HASINDO', '6379', 20000000, '11 Aug 2007', '11 Aug 2007', '', 'Bank Danamon', 'CAIR'),
]
const marked = new Set()
window.__tanda7 = (k, on) => { on ? marked.add(k) : marked.delete(k) }
const RADIO = [['ALL', 'ALL'], ['JT', 'J.TEMPO'], ['NEW', 'NEW'], ['CAIR', 'CAIR'], ['TOLAK', 'TOLAK']]
const stFilter = (f, s) => f === 'ALL' || (f === 'JT' && s === 'NEW') || (f === 'NEW' && s === 'NEW') || (f === 'CAIR' && s === 'CAIR') || (f === 'TOLAK' && s === 'TOLAKAN')
function bgList(isIn) {
  const f = filt(GID, 'st', 'ALL'), key = isIn ? 'in' : 'out'
  const xs = (isIn ? GIN : GOUT).filter(r => stFilter(f, isIn ? r[10] : r[9]))
  const rows = xs.map(r => {
    const o = isIn ? { no: r[0], who: r[1], doc: r[2], bank: r[3], tot: r[4], b: r[5], j: r[6], c: r[7], t: r[8], bt: r[9], st: r[10], cl: r[11], p: r[12] } : { no: r[0], who: r[1], doc: r[2], bank: null, tot: r[3], b: r[4], j: r[5], c: r[6], t: r[8], bt: r[7], st: r[9], cl: r[10], p: r[11] }
    const k = `${key}${o.no}${o.doc}`
    return `<tr>${td(esc(o.no))}${td(esc(o.who))}${td(esc(o.doc))}${isIn ? td(esc(o.bank)) : ''}${td(f2(o.tot), 1)}${td(o.b)}${td(o.j)}${td(o.c)}${td(o.t)}${td(esc(o.bt))}${td(o.p, 1)}${td('')}${td(o.st)}${td(`<input type="checkbox" class="cb7" ${marked.has(k) ? 'checked' : ''} onchange="__tanda7('${k}',this.checked)">`)}${td(o.cl)}</tr>`
  }).join('')
  const head = `<tr>${th('NO BG', 'rowspan="2"')}${th(isIn ? 'CUSTOMER' : 'SUPPLIER', 'rowspan="2"')}${th(isIn ? 'NO BKM' : 'NO BKK', 'rowspan="2"')}${isIn ? th('BANK', 'rowspan="2"') : ''}${th('TOTAL', 'rowspan="2" class="is-num"')}${th('TANGGAL', 'colspan="4" style="text-align:center"')}${th('BANK TUJUAN', 'rowspan="2"')}${th('PERIODE', 'rowspan="2" class="is-num"')}${th('KETERANGAN', 'rowspan="2"')}${th('STATUS', 'rowspan="2"')}${th('TANDA', 'rowspan="2"')}${th('CLOSED', 'rowspan="2"')}</tr><tr>${th('BUAT')}${th('JATUH TEMPO')}${th('CAIR')}${th('TOLAK')}</tr>`
  const w = isIn ? [120, 130, 130, 140, 140, 130, 140, 130, 130, 130, 100, 130, 110, 80, 80] : [130, 130, 100, 140, 130, 140, 130, 130, 140, 100, 130, 110, 80, 80]
  const radios = RADIO.map(([v, l]) => `<label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer"><input type="radio" name="bgst" class="cb7" ${f === v ? 'checked' : ''} onchange="setFilt('${GID}','st','${v}')">${l}</label>`).join('')
  return { count: xs.length, html: `<div style="display:flex;align-items:center;gap:28px;flex-wrap:wrap;margin:0 0 16px">${radios}<span class="bar-spacer"></span>${['Cair', 'Tolak', 'Batal Cair', 'Checked'].map(b => btn(b, `soon('${b}')`)).join('')}</div>` + t7(w, head, rows) }
}
function bgSaldo(isIn) {
  const head = `<tr>${th('NO BG', 'rowspan="2"')}${th('GIRO', 'rowspan="2"')}${th('TOTAL', 'rowspan="2" class="is-num"')}${th('TANGGAL', 'colspan="2" style="text-align:center"')}${th('KETERANGAN', 'rowspan="2"')}${th('STATUS', 'rowspan="2"')}</tr><tr>${th('BUAT')}${th('JATUH TEMPO')}</tr>`
  return t7([160, 260, 160, 160, 170, 260, 140], head, `<tr>${td('&nbsp;')}${td('')}${td('')}${td('')}${td('')}${td('')}${td('')}</tr>`)
}
reg7({
  id: GID, manual: 'Manual hal. 187–192',
  render() {
    const dir = filt(GID, 'dir', 'in'), isIn = dir === 'in', tab = tabOf(GID, 'list')
    const sw = `<div style="margin:0 0 16px"><div class="chips seg" role="radiogroup">${[['in', 'Pencairan BG Masuk'], ['out', 'Pencairan BG Keluar']].map(([v, l]) => `<button class="chip" type="button" role="radio" aria-checked="${dir === v}" onclick="setFilt('${GID}','dir','${v}')">${l}</button>`).join('')}</div></div>`
    const l = tab === 'list' ? bgList(isIn) : null
    const TB = ['First', 'Prior', 'Next', 'Last', 'New', 'Search', 'Filter', 'Refresh', 'Format', 'Default', 'Save', 'Undo', 'Info', 'View', 'Print']
    const body = sw + tb(TB, tab === 'list' ? `1 of ${l.count}` : '0 of 0', { New: `soon('New')`, Refresh: `soon('Refresh')`, Print: `soon('Print')`, Search: `soon('Search')`, Filter: `soon('Filter')`, Info: `soon('Info')` }) + (tab === 'list' ? l.html : bgSaldo(isIn))
    return page({ title: isIn ? 'Pencairan BG Masuk' : 'Pencairan BG Keluar', tabs: [['list', 'List BG'], ['saldo', 'Saldo Awal']], tab, body })
  },
})
})()
